/** Pre-generación del mundo de un juego (generate_game): bootstrap + anillo
 *  3×3 + places clave en una sesión EFÍMERA, persistidos como snapshot en
 *  data/games/{id}/world/{branch}.json — start_session lo replayea sin motor.
 *
 *  El job corre en la cola compartida (el motor narrativo atiende una
 *  petición a la vez) con la misma política anti-takeover que start_session:
 *  encolar generate_game abandona la generación en vuelo, y un start/resume
 *  posterior abandona a su vez el gamegen (sus guardias de sesión descartan
 *  resultados tardíos). El progreso viaja por narrative_status kind
 *  "game_gen"; el save efímero se borra SIEMPRE al terminar. */
import { combatRegistry } from "../../src/combat/registry.js";
import {
  loadGameMeta,
  loadStyleManifest,
  loadWorldDoc,
  WORLD_VIEWS,
} from "../../src/games/loader.js";
import { branchForView, type WorldBranch } from "../../src/games/world-snapshot.js";
import {
  activatePluginsForNewSession,
  loadGamePluginManifests,
} from "../../src/plugins/loader.js";
import { createHash } from "node:crypto";

import {
  generationBusyKey,
  writeSessionSnapshot,
  type BridgeContext,
  type ClientSocket,
} from "../context.js";
import { generateBootstrapTileScene } from "./bootstrap-tile.js";
import { generateBootstrapStageScene } from "./bootstrap-stage.js";
import { generateTileScene } from "./tile.js";
import { realizePlaceScene } from "./scene.js";
import type { GenerateGameMessage } from "../../src/protocol/messages.js";
import type { Place } from "../../src/world-map/types.js";

/** Tope de places pre-realizados por job — acota la duración (cada realize es
 *  una llamada LLM de minutos). Lo que quede fuera se REPORTA en el status
 *  final, nunca se omite en silencio. */
const MAX_PREREALIZED_PLACES = 8;

/** Anillo 3×3 alrededor del tile (0,0), en orden de lectura. */
const RING: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export async function handleGenerateGame(
  msg: GenerateGameMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const fail = (error: string): void => {
    console.error(`Bridge: generate_game failed: ${error}`);
    ctx.send(ws, { type: "game_generated", requestId: msg.requestId, ok: false, error });
  };
  let branch: WorldBranch;
  try {
    const meta = loadGameMeta(ctx.gamesDir, msg.gameId);
    const view = msg.view || meta.view || "overworld";
    if (!(WORLD_VIEWS as readonly string[]).includes(view)) {
      throw new Error(`vista desconocida "${view}" (esperaba ${WORLD_VIEWS.join("|")})`);
    }
    branch = branchForView(view);
  } catch (err) {
    return fail((err as Error).message ?? String(err));
  }
  // Anti-takeover (misma política que start_session): el gamegen usa el
  // NarrativeState singleton — una generación en vuelo de otra sesión queda
  // abandonada de forma segura (su guardia de sesión descarta el resultado).
  const busyKey = generationBusyKey(ctx);
  if (busyKey) {
    console.warn(
      `Bridge: generate_game con generación en vuelo ("${busyKey}") — abandonada`,
    );
    ctx.sceneGen.abandonAll();
  }
  const queued = ctx.sceneGen.enqueue({
    key: `gamegen:${msg.gameId}:${branch}`,
    blocking: false,
    run: () => runGameGeneration(ctx, msg.gameId, branch),
  });
  ctx.send(ws, {
    type: "game_generated",
    requestId: msg.requestId,
    ok: true,
    gameId: msg.gameId,
    queued,
  });
}

/** Places clave aún sin escena: todo lo realizable por el jugador (se excluye
 *  la jerarquía alta world/region, que nunca se realiza). */
function pickKeyPlaces(ctx: BridgeContext): { picked: Place[]; skipped: Place[] } {
  const candidates = Object.values(ctx.narrative.worldMap.map.places).filter(
    (p) =>
      p.kind !== "world" &&
      p.kind !== "region" &&
      !(p.realized_scene_id && ctx.narrative.scenes_loaded[p.realized_scene_id]),
  );
  return {
    picked: candidates.slice(0, MAX_PREREALIZED_PLACES),
    skipped: candidates.slice(MAX_PREREALIZED_PLACES),
  };
}

/** Corre DENTRO de la cola. Cada sub-paso (tile vecino, place) captura su
 *  error y se reporta en el resumen final: un vecino fallido no tira la
 *  génesis entera — el snapshot se escribe con lo que sí se generó. */
export async function runGameGeneration(
  ctx: BridgeContext,
  gameId: string,
  branch: WorldBranch,
): Promise<void> {
  const start = Date.now();
  const status = (phase: "generating" | "progress" | "ready" | "error", message: string): void =>
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase,
      kind: "game_gen",
      message,
      elapsedMs: Date.now() - start,
    });
  let ephemeralSession = "";
  try {
    const meta = loadGameMeta(ctx.gamesDir, gameId);
    const style = loadStyleManifest(ctx.stylesDir, meta.style_id);
    const view =
      branch === "stage"
        ? "proscenium"
        : meta.view && branchForView(meta.view) === "tile"
          ? meta.view
          : "overworld";
    status("generating", `Generando el mundo de ${meta.title}: mapa y escena inicial...`);

    // Sesión EFÍMERA: las map tools del motor (State API) escriben en
    // ctx.narrative, que es un singleton — no hay otra forma de recoger el
    // world map que siembra el bootstrap. El save se borra en el finally; el
    // snapshot queda como único artefacto.
    ctx.activePlugins = new Map();
    ephemeralSession = ctx.narrative.startNewSession(gameId);
    const worldDoc = loadWorldDoc(ctx.gamesDir, gameId);
    ctx.narrative.setWorldInfo({
      name: meta.title,
      description: meta.world_brief,
      style_id: style.style_id,
      style_token: style.style_token,
      world_doc_hash: createHash("sha256").update(worldDoc, "utf-8").digest("hex"),
      render_mode: "vector",
      character_mode: "vector",
      combat_system: meta.systems?.combat ?? combatRegistry.defaultId,
      view,
    });
    // Plugins activos como en un start_session real: el motor genera con el
    // mismo contexto que verá en partida (sus slices mueren con el save).
    const manifests = loadGamePluginManifests(ctx.gamesDir, gameId);
    ctx.activePlugins = activatePluginsForNewSession(ctx.narrative, manifests);
    await ctx.aiClient.notifySessionStart(ephemeralSession, gameId, false);

    const { sceneId: entrySceneId } =
      branch === "stage"
        ? await generateBootstrapStageScene(ctx, gameId, { generateVocabulary: true })
        : await generateBootstrapTileScene(ctx, gameId, { generateVocabulary: true });

    const failures: string[] = [];
    if (branch === "tile") {
      for (let i = 0; i < RING.length; i++) {
        const [tx, ty] = RING[i];
        status("progress", `Generando el anillo de tiles (${i + 1}/${RING.length})...`);
        try {
          await generateTileScene(ctx, tx, ty);
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          // Un takeover de sesión aborta el job entero, no solo el tile.
          if (msg.includes("la sesión activa cambió")) throw err;
          console.warn(`Bridge: gamegen tile (${tx},${ty}) falló:`, err);
          failures.push(`tile (${tx},${ty}): ${msg}`);
        }
      }
    }

    const { picked, skipped } = pickKeyPlaces(ctx);
    for (let i = 0; i < picked.length; i++) {
      const place = picked[i];
      status("progress", `Generando ${place.name} (${i + 1}/${picked.length})...`);
      try {
        await realizePlaceScene(ctx, place.id, { activate: false });
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        if (msg.includes("la sesión activa cambió")) throw err;
        console.warn(`Bridge: gamegen place "${place.id}" falló:`, err);
        failures.push(`${place.name}: ${msg}`);
      }
    }

    writeSessionSnapshot(ctx, gameId, branch, entrySceneId);
    const sceneCount = Object.keys(ctx.narrative.scenes_loaded).length;
    const parts = [`Mundo de ${meta.title} generado: ${sceneCount} escenas (rama ${branch}).`];
    if (skipped.length) {
      parts.push(
        `Places sin pre-generar (tope ${MAX_PREREALIZED_PLACES}): ` +
          skipped.map((p) => p.name).join(", ") + " — se generarán al visitarlos.",
      );
    }
    if (failures.length) {
      parts.push(`Fallos parciales (se generarán en partida): ${failures.join(" · ")}`);
    }
    status("ready", parts.join(" "));
  } catch (err) {
    console.warn(`Bridge: generate_game "${gameId}" falló:`, err);
    status("error", `La generación del mundo falló: ${(err as Error).message ?? err}`);
  } finally {
    // El save efímero se borra SIEMPRE — el snapshot es el artefacto. Si un
    // takeover reemplazó la sesión, borrar por id sigue siendo seguro (el id
    // efímero es único) y deleteSession no toca la sesión activa ajena.
    if (ephemeralSession) {
      const ok = await ctx.narrative.deleteSession(ephemeralSession);
      if (!ok) console.warn(`Bridge: no se pudo borrar el save efímero ${ephemeralSession}`);
    }
  }
}
