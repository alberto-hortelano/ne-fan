/** Pre-generación del mundo de un juego (generate_game) en una sesión
 *  EFÍMERA, persistida como snapshot en data/games/{id}/world/{branch}.json —
 *  start_session lo replayea sin motor. Se pre-genera el bootstrap y su
 *  anillo 3×3; los places se realizan al VIAJAR a ellos, anclándolos a un
 *  tile libre.
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
  deleteStyleApplication,
  listStyleApplications,
  styleApplicationPinRef,
} from "../../src/games/style-application.js";
import { resolveServiceUrl } from "../../src/contracts/common.js";
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
import { generateTileScene } from "./tile.js";
import type { GenerateGameMessage } from "../../src/protocol/messages.js";

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
    if (view === "proscenium") {
      throw new Error(
        'la vista "proscenio" (plató) se retiró: no hay mundo de platós que pre-generar',
      );
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
  // El solicitante está en el TÍTULO (sin sesión): suscribirlo a los
  // broadcasts o el progreso kind "game_gen" nunca le llegaría (los clientes
  // solo se suscriben en start/resume_session).
  ctx.subscribe(ws);
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

/** Vistas cuyo contenido cuelga de una rama de snapshot. */
const VIEWS_BY_BRANCH: Record<WorldBranch, string[]> = {
  tile: ["overworld", "fps"],
};

/** Un snapshot NUEVO invalida las aplicaciones de estilo de su rama: sus
 *  celdas/skins describen las escenas del snapshot viejo. Se borra el
 *  registro (el chip vuelve a "sin aplicar") y se despinean sus assets en el
 *  asset-store (best-effort REPORTADO — sin el store arriba, los pins viejos
 *  quedan hasta el siguiente batch, que re-pinea bajo el mismo ref). */
async function invalidateStyleApplications(
  ctx: BridgeContext,
  gameId: string,
  branch: WorldBranch,
): Promise<void> {
  const assetStoreUrl = resolveServiceUrl("asset-store", process.env);
  // Hash irrelevante para ENUMERAR (solo cambia el status devuelto).
  const records = listStyleApplications(ctx.gamesDir, gameId, "");
  for (const rec of records) {
    if (!VIEWS_BY_BRANCH[branch].includes(rec.view)) continue;
    deleteStyleApplication(ctx.gamesDir, gameId, rec.view, rec.style_id);
    const ref = styleApplicationPinRef(gameId, rec.view, rec.style_id);
    try {
      const res = await fetch(`${assetStoreUrl}/assets/pin/${encodeURIComponent(ref)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.warn(`Bridge: unpin de "${ref}" falló (asset-store caído?):`, err);
    }
    console.log(
      `Bridge: aplicación de estilo "${rec.style_id}" (${rec.view}) invalidada por el snapshot nuevo`,
    );
  }
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
    const view = meta.view && branchForView(meta.view) === "tile" ? meta.view : "overworld";
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

    const { sceneId: entrySceneId } = await generateBootstrapTileScene(ctx, gameId, {
      generateVocabulary: true,
    });

    // La pre-generación es el anillo 3×3 y nada más. Los places se realizan al
    // VIAJAR a ellos, anclándolos a un tile; pre-realizarlos producía escenas
    // sueltas, que ya no existen.
    const failures: string[] = [];
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

    writeSessionSnapshot(ctx, gameId, branch, entrySceneId);
    await invalidateStyleApplications(ctx, gameId, branch);
    const sceneCount = Object.keys(ctx.narrative.scenes_loaded).length;
    const parts = [`Mundo de ${meta.title} generado: ${sceneCount} escenas (rama ${branch}).`];
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
