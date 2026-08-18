/** Bootstrap del PLATÓ inicial de una sesión proscenio (world.view =
 *  "proscenium") — espejo de bootstrap-tile.ts para mundos de escenas
 *  discretas: el motor siembra el world map con las tools de mapa y responde
 *  la primera escena como stage plan (Format D clásico + bloque `stage`
 *  obligatorio, con player). Corre dentro de la cola de generación. */
import { loadWorldDoc } from "../../src/games/loader.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { validateScene, type PlaceContext } from "../../src/scene/scene-validate.js";
import { resolveExitEdge } from "../../src/world-map/edges.js";
import {
  broadcastScene,
  sessionChangedError,
  writeSessionSnapshot,
  type BridgeContext,
} from "../context.js";

/** placeContext con links (destino + edge efectivo) desde el world map del
 *  bridge — la regla proscenio exits⇔links del validador lo necesita. */
export function stagePlaceContext(ctx: BridgeContext): (placeId: string) => PlaceContext | null {
  return (placeId) => {
    const wm = ctx.narrative.worldMap;
    const place = wm.get(placeId);
    if (!place) return { exists: false, outgoing_links: 0 };
    const links = wm.getOutgoingLinks(placeId).map((l) => ({
      to: l.from === placeId ? l.to : l.from,
      edge: resolveExitEdge(wm, placeId, l) ?? undefined,
    }));
    return { exists: true, kind: place.kind, outgoing_links: links.length, links };
  };
}

/** Núcleo del bootstrap de plató, compartido por la sesión en vivo y por
 *  generate_game. LANZA en cualquier fallo — el caller difunde el status. */
export async function generateBootstrapStageScene(
  ctx: BridgeContext,
  sessionGameId: string,
  opts: { generateVocabulary?: boolean } = {},
): Promise<{ sceneId: string; scene: Record<string, unknown> }> {
  const jobSession = ctx.narrative.session_id;
  const llmCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
  llmCtx.bootstrap_world_map = true;
  llmCtx.world_document = loadWorldDoc(ctx.gamesDir, sessionGameId);
  if (opts.generateVocabulary) llmCtx.generate_world_vocabulary = true;
  llmCtx.stage_request = { bootstrap: true };
  const res = await ctx.aiClient.generateScene(llmCtx);
  // Defensa en profundidad: takeover colado ⇒ descartar sin escribir.
  const changed = sessionChangedError(ctx, jobSession);
  if (changed) throw new Error(changed);
  if (!res.ok || !res.scene) {
    throw new Error(`No se pudo generar el escenario. ${res.error ?? "Revisa el motor narrativo."}`);
  }
  // El plató inicial DEBE ser una escena stage: sin bloque `stage` no hay
  // salidas físicas y el jugador quedaría encerrado — fail-loud.
  if (res.scene.stage === undefined) {
    throw new Error(
      "El motor narrativo respondió una escena sin bloque `stage` en un mundo proscenio — el plató necesita sus salidas declaradas",
    );
  }
  const sceneId = String(res.scene.scene_id ?? res.scene.room_id ?? `scene_${Date.now()}`);
  res.scene.scene_id = sceneId;
  res.scene.room_id = sceneId;
  // El validador permite platós sin player (realizes: se entra por una
  // salida), pero el BOOTSTRAP no tiene entrada — el player es obligatorio
  // aquí, donde sabemos que lo es.
  const hasPlayer = Array.isArray(res.scene.entities) &&
    (res.scene.entities as Array<{ kind?: string }>).some((e) => e?.kind === "player");
  if (!hasPlayer) {
    throw new Error('el plató inicial necesita la entity kind "player" (es el bootstrap de la sesión)');
  }
  const check = validateScene(res.scene, stagePlaceContext(ctx));
  if (!check.ok) {
    throw new Error(`El escenario inicial no es jugable: ${check.errors.join(" · ")}`);
  }
  res.scene = expandScenePrimitives(res.scene);
  ctx.narrative.recordSceneLoaded(sceneId, res.scene);
  await ctx.narrative.save();
  return { sceneId, scene: res.scene };
}

export async function runBootstrapStage(
  ctx: BridgeContext,
  sessionGameId: string,
): Promise<void> {
  const sceneStart = Date.now();
  const fail = (message: string): void =>
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "scene",
      message,
      elapsedMs: Date.now() - sceneStart,
    });
  try {
    const { sceneId, scene } = await generateBootstrapStageScene(ctx, sessionGameId);
    // Snapshot pasivo ANTES de que broadcastScene añada `exits` (ver
    // bootstrap-tile.ts) — el siguiente arranque de este juego es instantáneo.
    writeSessionSnapshot(ctx, sessionGameId, "stage", sceneId);
    broadcastScene(ctx, sceneId, scene, Date.now() - sceneStart);
    // broadcastScene añade `exits` desde el world map — persistirlos.
    await ctx.narrative.save();
  } catch (err) {
    console.warn("Bridge: generate_scene (stage) failed:", err);
    fail(`Error: ${(err as Error).message ?? err}`);
  }
}
