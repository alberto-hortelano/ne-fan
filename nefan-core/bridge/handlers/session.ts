/** Handlers de ciclo de vida de sesión: listado de juegos/sesiones, start,
 *  resume y delete.
 *
 *  Guardar NO es un handler: el save se escribe donde el mundo cambia (trece
 *  sitios) y lleva el runtime del jugador fresco porque `reseedSimForSession`
 *  TOMA EL MUNDO para la sesión (`bridge/world-claim.ts`). */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createCombatant } from "../../src/combat/combatant.js";
import { combatRegistry } from "../../src/combat/registry.js";
import {
  GameMetaSchema,
  listGames,
  listStyles,
  loadGameMeta,
  BASE_UI_THEME,
  loadStyleManifest,
  resolveUiTheme,
  type UiTheme,
  styleCharacterRefs,
  styleCompatibleWithGame,
  styleFaceRefs,
  loadWorldDoc,
  type StyleManifest,
} from "../../src/games/loader.js";
import {
  gameGenerationStatus,
  loadWorldSnapshot,
  type WorldSnapshot,
} from "../../src/games/world-snapshot.js";
import { listStyleApplications } from "../../src/games/style-application.js";
import { WorldMapManager } from "../../src/world-map/world-map.js";
import { loadGamePluginManifests } from "../../src/plugins/loader.js";
import {
  activarPluginsDeSesionNueva,
  atarPluginsDeResume,
  vaciarPluginsActivos,
} from "../plugins-activos.js";
import {
  broadcastScene,
  createSessionNpcBehavior,
  generationBusyKey,
  npcSync,
  type BridgeContext,
  type ClientSocket,
} from "../context.js";
import { avisoDeIlegibles, sessionDataForClient } from "../wire-scene.js";
import { avisoDeFueraDelMundo, type FueraDelMundo } from "../../src/session/mundo-persistido.js";
import { npcBehaviorRegistry } from "../../src/simulation/npc-behavior-registry.js";
import { applyRenderModeChange } from "../../src/narrative/render-mode.js";
import { runBootstrapTile } from "./bootstrap-tile.js";
import type {
  CreateGameMessage,
  DeleteSessionMessage,
  SetRenderModeMessage,
  ListGamesMessage,
  ListSessionsMessage,
  ResumeSessionMessage,
  SessionEnteredMessage,
  StartSessionMessage,
} from "../../src/protocol/messages.js";

/** Catálogo de refs de estilo que ve el motor narrativo (`world.style_refs`):
 *  las de personaje (una por NPC) y las temáticas de CARA, cada una con su
 *  descripción en español. Se recalcula del manifest en start_session Y
 *  resume_session — editar un pack a mano se refleja al reanudar (el save
 *  solo lo cachea).
 *
 *  NO hay catálogo de ESCENA: la `style_ref` de escena elegía la lámina que
 *  guiaba el repintado del tile y murió con él. La primera persona pinta con
 *  style_token + lámina de superficies + refs de cara. */
export function styleRefCatalog(style: StyleManifest): {
  characters: Array<{ id: string; description: string }>;
  fps_faces?: Array<{ id: string; description: string }>;
} {
  const entry = (r: { id: string; description: string }) => ({
    id: r.id,
    description: r.description,
  });
  const out: ReturnType<typeof styleRefCatalog> = {
    characters: styleCharacterRefs(style).map(entry),
  };
  // Refs de CARA (carpeta `faces/` del pack): el motor las elige por
  // cara de volumen (`surface_ref`) para el atlas de superficies. Omitido
  // cuando el pack no declara ninguna (el pre-flight trata la ausencia como
  // "sin catálogo").
  const faces = styleFaceRefs(style).map(entry);
  if (faces.length > 0) out.fps_faces = faces;
  return out;
}

export function handleListGames(
  msg: ListGamesMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  // CONTESTA SIEMPRE. `listGames` lanza si el directorio de juegos no existe
  // (instalación rota, `NEFAN_GAMES_DIR` mal), y `routeMessage` no envuelve a
  // sus handlers: el throw salía como unhandled rejection, nadie respondía y
  // el cliente se comía los 30 s de su timeout para acabar diciendo «el
  // servidor no contesta» — plausible y falso, porque el servidor está vivo.
  // Un listado vacío tampoco vale: «no hay ningún mundo instalado» es otra
  // mentira distinta. Va el motivo, y el cliente lo traduce.
  let listado: ReturnType<typeof listGames>;
  try {
    listado = listGames(ctx.gamesDir);
  } catch (err) {
    console.error("Bridge: list_games falló:", err);
    ctx.send(ws, {
      type: "games_listed",
      requestId: msg.requestId,
      error: `games_dir_unreadable: ${(err as Error).message ?? err}`,
      games: [],
      styles: [],
    });
    return;
  }
  ctx.send(ws, {
    type: "games_listed",
    requestId: msg.requestId,
    games: listado.map((g) => {
      let worldDocHash = "";
      try {
        worldDocHash = createHash("sha256")
          .update(loadWorldDoc(ctx.gamesDir, g.game_id), "utf-8")
          .digest("hex");
      } catch (err) {
        console.warn(`handleListGames: world.md ilegible para "${g.game_id}":`, err);
      }
      return {
        ...g,
        generation: gameGenerationStatus(ctx.gamesDir, g.game_id),
        styles_applied: worldDocHash
          ? listStyleApplications(ctx.gamesDir, g.game_id, worldDocHash)
          : [],
      };
    }),
    styles: listStyles(ctx.stylesDir),
  });
}

/** Mundo subido por el jugador: el borrador se desarrolla con el motor
 *  narrativo (POST /develop_world → MCP kind develop_world) y el resultado se
 *  escribe como data/games/user_{slug}/. Fail-loud en cada paso — un mundo a
 *  medias no debe aparecer en el listado. */
export async function handleCreateGame(
  msg: CreateGameMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const fail = (error: string): void => {
    console.error(`Bridge: create_game failed: ${error}`);
    ctx.send(ws, { type: "game_created", requestId: msg.requestId, ok: false, error });
  };
  const draft = (msg.draftText ?? "").trim();
  if (draft.length < 20) {
    return fail("draft_too_short: describe el mundo con al menos unas frases");
  }
  if (draft.length > 64_000) {
    return fail("draft_too_long: máximo ~64k caracteres");
  }

  const res = await ctx.aiClient.developWorld(draft);
  if (!res.ok) {
    return fail(`develop_world: ${res.error}`);
  }
  const game = res.game;

  // Slug propio con prefijo user_ (el id que sugiera el LLM es solo una
  // base); dedupe con sufijo numérico si ya existe.
  const base = `user_${String(game.game_id || game.title || "mundo")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "mundo"}`;
  let gameId = base;
  for (let i = 2; existsSync(join(ctx.gamesDir, gameId)); i++) {
    gameId = `${base}_${i}`;
  }

  // El estilo sugerido debe existir; si no, el primer estilo COMPATIBLE con
  // los tags del mundo (o el primero disponible como último recurso).
  const styles = listStyles(ctx.stylesDir);
  if (styles.length === 0) {
    return fail("no_styles_available: no hay estilos en data/styles");
  }
  const gameTags = Array.isArray(game.tags) ? game.tags.map((t) => String(t)) : [];
  const styleId = styles.some((st) => st.style_id === game.style_id)
    ? game.style_id
    : (styles.find((st) => styleCompatibleWithGame(st.tags, gameTags)) ?? styles[0]).style_id;

  const meta = GameMetaSchema.safeParse({
    game_id: gameId,
    title: game.title,
    description: game.description,
    style_id: styleId,
    world_brief: game.world_brief,
    // Etiquetas temáticas del mundo (el prompt de develop_world las exige;
    // filtran qué estilos ofrece el título). Malformadas ⇒ mundo sin tags
    // (compatible con todo), mejor que abortar una génesis de 1-3 min.
    tags: Array.isArray(game.tags)
      ? game.tags.map((t) => String(t).trim()).filter((t) => t.length > 0)
      : undefined,
  });
  if (!meta.success) {
    return fail(`develop_world produced invalid game meta: ${meta.error.message.slice(0, 500)}`);
  }
  if (typeof game.world_md !== "string" || game.world_md.length < 2000) {
    return fail("develop_world produced a world_md too short (<2000 chars)");
  }

  const dir = join(ctx.gamesDir, gameId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "game.json"), JSON.stringify(meta.data, null, 2) + "\n", "utf-8");
  writeFileSync(join(dir, "world.md"), game.world_md, "utf-8");
  console.log(`Bridge: mundo de usuario creado: ${gameId} ("${meta.data.title}")`);
  ctx.send(ws, {
    type: "game_created",
    requestId: msg.requestId,
    ok: true,
    gameId,
    title: meta.data.title,
  });
}

export async function handleListSessions(
  msg: ListSessionsMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  // Sin poda: ya no nacen saves vacíos que podar. Una partida solo existe en
  // disco cuando el jugador entró en ella (#279), así que el listado es
  // espejo fiel de `saves/` y borrar es cosa del jugador desde «Continuar».
  const sessions = await ctx.sessionStorage.list();
  ctx.send(ws, { type: "sessions_listed", requestId: msg.requestId, sessions });
}

/** Resembra el sim para la sesión vigente: runtime nuevo (sin este reset el
 *  sim arrastra los combatientes y el HP de la sesión anterior del proceso) +
 *  player con el HP/posición del NarrativeState (defaults en start, save en
 *  resume — misma fuente). Común a start_session y resume_session. */
function reseedSimForSession(
  ctx: BridgeContext,
  ws: ClientSocket,
  combatId: string,
  npcBehaviorId: string | undefined,
): void {
  ctx.sim.reset();
  ctx.sim.setCombatSystem(combatRegistry.create(combatId, ctx.combatConfig));
  ctx.sim.setNpcBehavior(createSessionNpcBehavior(ctx, npcBehaviorId));
  const hp = ctx.narrative.player.health;
  const pos = ctx.narrative.player.position;
  ctx.sim.addCombatant(
    createCombatant(
      "player",
      hp,
      ctx.store.state.player.weapon_id,
      { x: pos[0], y: pos[1], z: pos[2] },
      { x: 0, y: 0, z: -1 },
    ),
  );
  ctx.store.dispatch("player_respawned", { hp, pos: [...pos] });
  // …y la proyección de enemigos se vacía con él. `sim.reset()` se lleva los
  // combatientes pero `store.state.enemies` es OTRA lista, y arrastraba la de
  // la sesión anterior del proceso: el `add_combatants` del resume ve su id ya
  // proyectado (`projected.some`) y NO actualiza la fila, así que un enemigo
  // reanudado a 12 PV se quedaba con los 60 de la partida de antes.
  //
  // Esto NO es la vía revertida de #323, y la diferencia es toda: aquello
  // reemplazaba la lista en CADA `broadcastScene`, o sea a mitad de pelea, y
  // por eso el primer tile nuevo borraba del `state_update` a un enemigo vivo.
  // Aquí se vacía en el reseed de SESIÓN —donde el sim tampoco tiene a nadie—
  // y se vuelve a poblar por la misma vía de siempre. El guion 42 lo canda por
  // fuera: sigue verde porque su sujeto es el cambio de tile.
  ctx.store.dispatch("enemies_projected", { enemies: [] });
  // Sembrar el sim y TOMAR EL MUNDO son el mismo acto: a partir de aquí
  // conduce este socket y CUALQUIER save() del bridge lleva la posición y la
  // vida vivas del combatiente. Sin esto el save solo sabía dónde empezó la
  // partida (reanudar te devolvía al origen y te curaba a 100).
  ctx.world.claimForSession(ws);
}

/** Le dice al JUGADOR qué combatientes se ha dejado fuera su partida porque
 *  el save no deja leer en qué estado quedaron.
 *
 *  Va por `narrative_status: error` —el canal fail-loud del bridge (CLAUDE.md
 *  § Errores)— y DESPUÉS del `session_started`: un `console.warn` del proceso
 *  del servidor no es el canal de algo que el jugador ve, y hasta esta vuelta
 *  eso era todo lo que había (QA 2026-08-31, H-2). Sin ilegibles no dice nada:
 *  el silencio aquí sí es correcto, porque no falta nadie.
 *
 *  `kind: "restore"` y no `"consequences"` (#352): el cuerpo ya era exacto y
 *  estaba en idioma de jugador, pero salía bajo «El motor narrativo rechazó la
 *  respuesta» — un titular que nombra a otro culpable encima de un texto que
 *  habla del save. Aquí el motor narrativo no ha rechazado nada; ni siquiera
 *  ha intervenido.
 */
function avisarDeIlegibles(ctx: BridgeContext, ilegibles: readonly string[]): void {
  if (ilegibles.length === 0) return;
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "error",
    kind: "restore",
    message: avisoDeIlegibles(ilegibles),
  });
}

/** Gemelo del de arriba para la POSICIÓN (#382): una entity cuya posición
 *  viva no cae en ningún tile del save se dice con nombre y coordenada, por
 *  el mismo canal y con el mismo `kind` — la partida vuelve sin algo que
 *  tenía. La escena carga igual: es un aviso, no un bloqueo. */
function avisarDeFueraDelMundo(ctx: BridgeContext, fuera: readonly FueraDelMundo[]): void {
  if (fuera.length === 0) return;
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "error",
    kind: "restore",
    message: avisoDeFueraDelMundo(fuera),
  });
}

export async function handleStartSession(
  msg: StartSessionMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  // Anti-takeover: NarrativeState es un singleton — con una generación en
  // vuelo, cambiar de sesión haría que el job (y las tools de mapa del motor)
  // escribieran en la sesión nueva (reproducido 2026-08-17). El takeover se
  // PERMITE (el título debe poder arrancar partidas aunque una generación de
  // 15 min siga en vuelo) pero la generación saliente queda ABANDONADA de
  // forma segura: cola purgada, resultado tardío descartado por la guardia de
  // sesión del job, y tools del motor rechazadas con 409 por el State API.
  const busyKey = generationBusyKey(ctx);
  if (busyKey) {
    console.warn(
      `Bridge: start_session con generación en vuelo ("${busyKey}", sesión ` +
        `${ctx.narrative.session_id}) — generación abandonada, su resultado se descartará`,
    );
    ctx.sceneGen.abandonAll();
  }
  // El juego debe existir y validar ANTES de crear la sesión — arrancar un
  // mundo roto en silencio dejaría al motor narrativo sin identidad de mundo.
  let worldDocHash: string;
  // Tema de la UI de juego del pack: NO se persiste (el save no lo necesita
  // y `world` viaja entero al modelo en cada turno) — se recalcula aquí y en
  // cada resume, así que retocar una paleta se ve al reanudar.
  let uiTheme: UiTheme;
  let combatId: string;
  let npcBehaviorId: string | undefined;
  try {
    const meta = loadGameMeta(ctx.gamesDir, msg.gameId);
    // Estilo: el elegido por el jugador o el por defecto del juego. Un
    // styleId inexistente aborta (fail-loud), no degrada en silencio.
    const style = loadStyleManifest(ctx.stylesDir, msg.styleId || meta.style_id);
    // Modo de render: imagen IA (créditos) o mundo vectorial (blueprints
    // compuestos). Congelado como el estilo: mezclar tiles pintados y
    // vectoriales rompe la continuidad visual entre vecinos.
    const renderMode = msg.renderMode || "image";
    if (renderMode !== "image" && renderMode !== "vector") {
      throw new Error(`modo de render desconocido "${renderMode}" (esperaba image|vector)`);
    }
    // Personajes por separado: skins IA o base y_bot. Default = el modo de
    // escenarios (una sola elección sigue funcionando como siempre).
    const characterMode = msg.characterMode || renderMode;
    if (characterMode !== "image" && characterMode !== "vector") {
      throw new Error(`modo de personajes desconocido "${characterMode}" (esperaba image|vector)`);
    }
    // Compatibilidad TEMÁTICA estilo↔juego (tags): warning, no abort — el
    // matching es heurístico sobre vocabulario libre y el selector del
    // título ya filtra; un typo en un tag no debe brickear una partida.
    if (!styleCompatibleWithGame(style.tags, meta.tags)) {
      console.warn(
        `Bridge: estilo "${style.style_id}" (tags: ${style.tags.join(",")}) no casa ` +
          `temáticamente con el juego "${msg.gameId}" (tags: ${(meta.tags ?? []).join(",")})`,
      );
    }
    // Sistema de combate: el que declare game.json (systems.combat) o el
    // estándar. Queda CONGELADO en el save como el estilo/perspectiva; un id
    // fuera del registro aborta (fail-loud), no degrada en silencio.
    combatId = meta.systems?.combat ?? combatRegistry.defaultId;
    if (!combatRegistry.has(combatId)) {
      throw new Error(
        `sistema de combate desconocido "${combatId}" (esperaba ${combatRegistry.ids().join("|")})`,
      );
    }
    // Vida ambiental de NPCs: no se congela en el save (v1, una sola
    // implementación) pero el id se valida igual de fail-loud.
    npcBehaviorId = meta.systems?.npc_behavior;
    if (npcBehaviorId !== undefined && !npcBehaviorRegistry.has(npcBehaviorId)) {
      throw new Error(
        `sistema npc_behavior desconocido "${npcBehaviorId}" (esperaba ${npcBehaviorRegistry.ids().join("|")})`,
      );
    }
    const worldDoc = loadWorldDoc(ctx.gamesDir, msg.gameId);
    worldDocHash = createHash("sha256").update(worldDoc, "utf-8").digest("hex");
    vaciarPluginsActivos(ctx);
    ctx.narrative.startNewSession(msg.gameId);
    ctx.narrative.setWorldInfo({
      name: meta.title,
      description: meta.world_brief,
      style_id: style.style_id,
      style_token: style.style_token,
      world_doc_hash: worldDocHash,
      render_mode: renderMode,
      character_mode: characterMode,
      combat_system: combatId,
      // Catálogo de refs elegibles por el motor: personajes (`style_ref` por
      // NPC) y caras (`surface_ref` por volumen), con sus descripciones.
      style_refs: styleRefCatalog(style),
    });
    uiTheme = resolveUiTheme(style.ui);
  } catch (err) {
    console.error("Bridge: game load failed on start_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `game_load_failed: ${(err as Error).message ?? err}`,
    });
    return;
  }
  if (msg.appearance) {
    ctx.narrative.updatePlayerAppearance(msg.appearance.model_id, msg.appearance.skin_path);
  }
  // Génesis de plugins shipped (F3): validación + projections. Un
  // manifest inválido aborta el arranque de sesión — fail-loud.
  try {
    const loaded = loadGamePluginManifests(ctx.gamesDir, msg.gameId);
    activarPluginsDeSesionNueva(ctx, loaded);
  } catch (err) {
    console.error("Bridge: plugin load failed on start_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `plugin_load_failed: ${(err as Error).message ?? err}`,
    });
    return;
  }
  reseedSimForSession(ctx, ws, combatId, npcBehaviorId);
  await ctx.aiClient.notifySessionStart(ctx.narrative.session_id, msg.gameId, false);
  // Aquí NO se guarda (#279). La sesión nace provisional —en memoria y en
  // ningún otro sitio— y solo se escribe cuando el cliente confirma que el
  // jugador entró (`session_entered`). El único trabajo de aquel save era
  // crear el fichero antes de tiempo, y con él la tarjeta de partida de un
  // arranque que todavía podía fallar.
  ctx.subscribe(ws);
  const paraElCliente = sessionDataForClient(ctx, ctx.narrative.toSessionData());
  ctx.send(ws, {
    type: "session_started",
    requestId: msg.requestId,
    ok: true,
    sessionId: ctx.narrative.session_id,
    gameId: ctx.narrative.game_id,
    isResume: false,
    state: paraElCliente.state,
    uiTheme,
  });
  avisarDeIlegibles(ctx, paraElCliente.ilegibles);
  avisarDeFueraDelMundo(ctx, paraElCliente.fueraDelMundo);
  // Snapshot de mundo pre-generado (data/games/{id}/world/): replay del
  // bootstrap por la ruta normal — el jugador entra sin esperar al motor. Un
  // snapshot malformado se REPORTA y degrada al bootstrap vivo (nunca se
  // sirve contenido dudoso ni se deja al jugador sin partida).
  let snapshot: WorldSnapshot | null = null;
  try {
    snapshot = loadWorldSnapshot(ctx.gamesDir, msg.gameId, worldDocHash);
  } catch (err) {
    console.error(`Bridge: world snapshot ilegible para "${msg.gameId}":`, err);
  }
  if (snapshot) {
    console.log(
      `Bridge: world snapshot HIT para "${msg.gameId}" ` +
        `(${Object.keys(snapshot.scenes).length} escenas, generado ${snapshot.generated_at}) ` +
        `— bootstrap sin motor`,
    );
    await replayWorldSnapshot(ctx, snapshot);
    return;
  }

  // Generate the initial TILE (0,0) asynchronously (via the shared queue) and
  // broadcast it as a narrative_event so all subscribed clients render the
  // same world. Emit lifecycle hints so the client can show a loader.
  const sessionGameId = msg.gameId;
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "generating",
    kind: "tile",
    tile: { tx: 0, ty: 0 },
    message: "Generando mundo inicial...",
  });
  ctx.sceneGen.enqueue({
    key: "bootstrap",
    blocking: true,
    run: () => runBootstrapTile(ctx, sessionGameId),
  });
}

/** Replay del snapshot de mundo por la ruta normal del bootstrap: restaura el
 *  world map, registra TODAS las escenas (las no-entrada sin activar — el
 *  anillo y los places pre-realizados quedan disponibles para request_tile y
 *  player_entered_place al instante) y difunde la de entrada, que re-adjunta
 *  sus exits desde el world map restaurado. */
async function replayWorldSnapshot(ctx: BridgeContext, snap: WorldSnapshot): Promise<void> {
  ctx.narrative.worldMap = WorldMapManager.fromSerialized(structuredClone(snap.world_map));
  for (const [id, scene] of Object.entries(snap.scenes)) {
    if (id === snap.entry_scene_id) continue;
    ctx.narrative.recordSceneLoaded(id, structuredClone(scene), [], { activate: false });
  }
  const entryScene = structuredClone(snap.scenes[snap.entry_scene_id]);
  ctx.narrative.recordSceneLoaded(snap.entry_scene_id, entryScene);
  await ctx.narrative.save();
  broadcastScene(ctx, snap.entry_scene_id, entryScene, 0, { source: "snapshot" });
  await ctx.narrative.save();
}


export async function handleResumeSession(
  msg: ResumeSessionMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  // Anti-takeover (misma política que start_session): reanudar OTRA sesión
  // con una generación en vuelo la abandona de forma segura. Reanudar la
  // MISMA sesión (reconexión del cliente durante un bootstrap largo) no
  // cambia la identidad — su generación sigue viva.
  const busyKey = generationBusyKey(ctx);
  if (busyKey && msg.sessionId !== ctx.narrative.session_id) {
    console.warn(
      `Bridge: resume_session(${msg.sessionId}) con generación en vuelo ("${busyKey}", sesión ` +
        `${ctx.narrative.session_id}) — generación abandonada, su resultado se descartará`,
    );
    ctx.sceneGen.abandonAll();
  }
  // El load VA PRIMERO y los plugins se vacían DESPUÉS: al revés, un resume
  // que falla (id rancio, save borrado, y desde #279 también la partida que
  // aún no existe en disco porque el jugador sigue arrancándola) dejaba la
  // sesión VIVA sin plugins el resto de la partida — `loadSession` no muta
  // nada cuando el save no está, así que el bridge seguía sirviendo la
  // partida buena con el catálogo del motor vacío. Alcanzable con la tecla
  // `H`: el libro de historia pide `resume_session` de la sesión activa.
  //
  // Dos fallos DISTINTOS con dos respuestas: `false` = el save no existe
  // (`session_not_found`); un THROW = el save existe pero no vale — versión
  // vieja o escena que viola el contrato (#334/#336) — y se contesta
  // `save_invalido` con el motivo, mismo molde que `plugin_integrity`.
  let ok: boolean;
  try {
    ok = await ctx.narrative.loadSession(msg.sessionId);
  } catch (err) {
    console.error("Bridge: save inválido en resume_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `save_invalido: ${(err as Error).message ?? err}`,
    });
    return;
  }
  if (!ok) {
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: "session_not_found",
    });
    return;
  }
  vaciarPluginsActivos(ctx);
  // Bind de plugins shipped (F3): el slice vive en el save, el manifest
  // se relee del FS y se casa por id (integridad fail-loud).
  try {
    const loaded = loadGamePluginManifests(ctx.gamesDir, ctx.narrative.game_id);
    atarPluginsDeResume(ctx, loaded);
  } catch (err) {
    console.error("Bridge: plugin bind failed on resume_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `plugin_integrity: ${(err as Error).message ?? err}`,
    });
    return;
  }
  // Sistema de combate congelado en el save (saves previos sin campo →
  // estándar). Un id fuera del registro aborta el resume — fail-loud, igual
  // que un plugin narrativo desaparecido.
  const combatId = ctx.narrative.world.combat_system || combatRegistry.defaultId;
  if (!combatRegistry.has(combatId)) {
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `combat_system_unknown: "${combatId}" (esperaba ${combatRegistry.ids().join("|")})`,
    });
    return;
  }
  // Vida ambiental: no congelada en el save (v1, una sola implementación) —
  // se lee del game.json vigente. El game dir existe (el bind de plugins de
  // arriba ya lo leyó); un id fuera del registro aborta como el de combate.
  let npcBehaviorId: string | undefined;
  try {
    npcBehaviorId = loadGameMeta(ctx.gamesDir, ctx.narrative.game_id).systems?.npc_behavior;
  } catch (err) {
    console.error("Bridge: game load failed on resume_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `game_load_failed: ${(err as Error).message ?? err}`,
    });
    return;
  }
  if (npcBehaviorId !== undefined && !npcBehaviorRegistry.has(npcBehaviorId)) {
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `npc_behavior_unknown: "${npcBehaviorId}" (esperaba ${npcBehaviorRegistry.ids().join("|")})`,
    });
    return;
  }
  // Catálogo de refs de estilo: recalculado del style.json vigente (editar
  // el pack a mano se refleja al reanudar). Manifest ilegible (pack borrado
  // o roto) ⇒ warning y se conserva el catálogo cacheado en el save — las
  // imágenes ya generadas siguen sirviéndose de caché.
  let uiTheme: UiTheme = BASE_UI_THEME;
  try {
    const style = loadStyleManifest(ctx.stylesDir, ctx.narrative.world.style_id);
    ctx.narrative.setStyleRefs(styleRefCatalog(style));
    uiTheme = resolveUiTheme(style.ui);
  } catch (err) {
    console.warn(
      `Bridge: style.json ilegible en resume (estilo "${ctx.narrative.world.style_id}") — ` +
        `catálogo de refs del save conservado: ${(err as Error).message ?? err}`,
    );
  }
  reseedSimForSession(ctx, ws, combatId, npcBehaviorId);
  // Los NPC del save vuelven a la vida ambiental donde se quedaron (su
  // posición vive en el EntityRecord persistido).
  npcSync(ctx);
  await ctx.aiClient.notifySessionStart(ctx.narrative.session_id, ctx.narrative.game_id, true);
  ctx.subscribe(ws);
  const alCliente = sessionDataForClient(ctx, ctx.narrative.toSessionData());
  ctx.send(ws, {
    type: "session_started",
    requestId: msg.requestId,
    ok: true,
    sessionId: ctx.narrative.session_id,
    gameId: ctx.narrative.game_id,
    isResume: true,
    state: alCliente.state,
    uiTheme,
  });
  avisarDeIlegibles(ctx, alCliente.ilegibles);
  avisarDeFueraDelMundo(ctx, alCliente.fueraDelMundo);
  // Aquí vivía el reintento del bootstrap: una sesión sin NINGUNA escena era
  // un arranque cuyo tile falló, y reanudarla re-encolaba la generación. Se
  // quedó sin sujeto con #279 — ya no nacen saves de cero escenas, así que
  // una partida en disco siempre trae mundo. Con él se va el «reanudar ES el
  // reintento» que el repo eligió a propósito en `1dc55ff`: un bootstrap
  // interrumpido se repaga entero (minutos del motor, cero créditos de
  // imagen), decidido con el coste delante.
}

/** El jugador ENTRÓ en la partida (vestido ∧ mundo pintado): a partir de aquí
 *  existe en disco. Es el único sitio del bridge que puede establecerla, y lo
 *  canda `arch-rules.json` — que un handler cualquiera llame a `establecer()`
 *  «por si acaso» compilaría igual de bien.
 *
 *  Sin respuesta: el cliente no espera nada. Los dos casos que no establecen
 *  se dicen en el log, no en silencio. */
export async function handleSessionEntered(
  msg: SessionEnteredMessage,
  ctx: BridgeContext,
): Promise<void> {
  if (msg.sessionId !== ctx.narrative.session_id) {
    // Takeover: entre el arranque y el ack alguien cambió la sesión activa
    // (otra pestaña, una pre-generación de mundo). Esa partida no se escribe:
    // el singleton ya no la tiene. Se dice, porque es la señal de que un save
    // que el jugador esperaba no va a existir.
    console.warn(
      `Bridge: session_entered de ${msg.sessionId} con ${ctx.narrative.session_id || "(ninguna)"} ` +
        `activa — ack de una sesión que ya no es la de este bridge, no se establece`,
    );
    return;
  }
  if (ctx.narrative.enDisco) return; // resume: la partida ya existía
  await ctx.narrative.establecer();
  console.log(`Bridge: partida ${ctx.narrative.session_id} establecida en disco (el jugador entró)`);
}

export async function handleDeleteSession(
  msg: DeleteSessionMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  // Por `ctx.narrative` y NO por `ctx.sessionStorage` (#365): es el único que
  // suelta la sesión activa cuando se borra su propio save. Saltárselo dejaba
  // `narrative.session_id` apuntando a un directorio que ya no existe.
  //
  // El desenlace viaja tal cual: `deleted` y `not_found` son cosas distintas
  // para quien acaba de pulsar Borrar. Un EACCES/EBUSY LANZA desde aquí y lo
  // convierte el router en `outcome:"failed"` CON su motivo.
  const outcome = await ctx.narrative.deleteSession(msg.sessionId);
  ctx.send(ws, { type: "session_deleted", requestId: msg.requestId, outcome });
}

/** Cambia el modo de render de un save por faceta y en ambos sentidos
 *  (image⇄vector), desde el título o en plena partida — la sesión no tiene
 *  por qué estar activa. Bajar a vector no borra lo pintado: el cliente
 *  conserva las imágenes existentes y solo deja de generar nuevas. */
export async function handleSetRenderMode(
  msg: SetRenderModeMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const fail = (error: string): void =>
    ctx.send(ws, { type: "render_mode_set", requestId: msg.requestId, ok: false, error });
  if (msg.renderMode !== "image" && msg.renderMode !== "vector") {
    // El wire es JSON sin validar en este punto — rechazar en vez de adivinar.
    return fail(`renderMode desconocido ${JSON.stringify(msg.renderMode)} (válidos: image, vector)`);
  }
  const facet = msg.facet ?? "scenes";
  if (facet !== "scenes" && facet !== "characters") {
    // El wire es JSON sin validar: un typo caería en la rama else y activaría
    // los skins de otra faceta — rechazar en vez de adivinar.
    return fail(`facet desconocido ${JSON.stringify(facet)} (válidos: scenes, characters)`);
  }
  // Sesión ACTIVA: el escritor único del save es NarrativeState. Mutar el
  // mundo EN MEMORIA (la autoridad) y persistir con su save() — NUNCA un
  // read-modify-write de disco independiente: ese toma un snapshot en el read
  // y, si un save() concurrente (posición del jugador, tiles explorados,
  // entities) escribe entremedias, el write posterior lo PISA (lost update).
  if (ctx.narrative.session_id === msg.sessionId) {
    const res = applyRenderModeChange(ctx.narrative.world, facet, msg.renderMode);
    if (!res.ok) return fail(res.error);
    let escrito: boolean;
    try {
      ({ escrito } = await ctx.narrative.save());
    } catch (err) {
      return fail(`no se pudo escribir la partida: ${err instanceof Error ? err.message : String(err)}`);
    }
    // La partida aún no existe (el bootstrap sigue en vuelo): el cambio se
    // aplicó en memoria pero NO se persistió. Contestar `ok` sería prometer
    // algo que el siguiente resume no va a encontrar.
    //
    // La frase habla de lo que el jugador VE, no del estado interno. «Aún no
    // ha empezado / entra en ella» era falso justo cuando este caso ocurre:
    // con un motor lento el título ya se fue y el jugador está DENTRO, delante
    // del loader, cuando toca el chip de gráficos. Es la misma familia de
    // mentira amable que #277 vino a quitar.
    if (!escrito) {
      return fail(
        "el mundo todavía no ha llegado: espera a verlo en pantalla y vuelve a cambiar el modo",
      );
    }
    console.log(`Bridge: modo de render cambiado en ${msg.sessionId} (${facet} → ${msg.renderMode}, sesión activa)`);
    ctx.send(ws, {
      type: "render_mode_set",
      requestId: msg.requestId,
      ok: true,
      facet,
      renderMode: msg.renderMode,
    });
    // Push para el resto de clientes de la sesión (el requester ya tiene el
    // eco en la respuesta; re-aplicarlo es idempotente). El sello lo pone el
    // transporte: esta rama es la de la partida ACTIVA (lo comprueba el `if`
    // de arriba), así que es el mismo id que escribiría aquí.
    ctx.broadcastNarrative({
      type: "render_mode_changed",
      facet,
      renderMode: msg.renderMode,
    });
    return;
  }

  // Partida INACTIVA: el read-modify-write de disco es el único escritor.
  let data;
  try {
    data = await ctx.sessionStorage.read(msg.sessionId);
  } catch (err) {
    return fail(`no se pudo leer la partida: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!data) return fail(`la partida ${msg.sessionId} no existe`);
  if (!data.world) return fail(`la partida ${msg.sessionId} no tiene bloque world (save corrupto)`);
  const res = applyRenderModeChange(data.world, facet, msg.renderMode);
  if (!res.ok) return fail(res.error);
  data.updated_at = new Date().toISOString();
  // `writeExisting` y no `write`: desde #279 el tipo de `ctx.sessionStorage`
  // no tiene `write`, porque un save solo puede NACER cuando el jugador entra
  // en la partida. Aquí solo se PISA lo que se acaba de leer; si desapareció
  // entremedias, se dice en vez de resucitarlo.
  try {
    if (!(await ctx.sessionStorage.writeExisting(msg.sessionId, data))) {
      return fail(`la partida ${msg.sessionId} ya no existe`);
    }
  } catch (err) {
    return fail(`no se pudo escribir la partida: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`Bridge: modo de render cambiado en ${msg.sessionId} (${facet} → ${msg.renderMode})`);
  ctx.send(ws, {
    type: "render_mode_set",
    requestId: msg.requestId,
    ok: true,
    facet,
    renderMode: msg.renderMode,
  });
}

