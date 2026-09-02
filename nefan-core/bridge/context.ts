/** Shared state + helpers for the bridge message handlers.
 *
 *  `BridgeContext` encapsula todo lo que antes eran globals de ws-server.ts,
 *  de forma que cada handler sea una función (msg, ws, ctx) testeable con
 *  fakes (socket capturador, AiClient falso) sin abrir sockets reales. */

import { createHash } from "node:crypto";

import type { GameSimulation } from "../src/simulation/game-loop.js";
import type { CombatConfig } from "../src/types.js";
import type { GameStore } from "../src/store/game-store.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { SessionStorage } from "../src/narrative/session-storage.js";
import type { AiClient } from "../src/narrative/ai-client.js";
import type { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import type { NpcDirector } from "../src/world-map/npc-director.js";
import { loadWorldDoc } from "../src/games/loader.js";
import {
  WORLD_SNAPSHOT_SCHEMA_VERSION,
  writeWorldSnapshot,
} from "../src/games/world-snapshot.js";
import { loadWorldVocabulary } from "../src/games/vocabulary.js";
import type { PluginManifest } from "../src/plugins/types.js";
import type { SceneRecord } from "../src/narrative/types.js";
import type { NpcBehaviorSystem } from "../src/simulation/npc-behavior.js";
import { npcBehaviorRegistry } from "../src/simulation/npc-behavior-registry.js";
import { isHostileRole } from "../src/simulation/npc-roles.js";
import { seededRng } from "../src/rng.js";
import { resolvePlaceTarget } from "../src/world-map/place-target.js";
import type { SimCollisionProvider } from "./sim-collision.js";
import {
  describePluginTickError,
  dispatchPluginEvents,
  type PluginAppliedEffect,
  type PluginEventInput,
} from "../src/plugins/dispatcher.js";
import { dispatchConsequences } from "../src/narrative/consequence-handler.js";
import { escenaParaElWire } from "./wire-scene.js";
import { SceneGenQueue } from "./scene-gen-queue.js";
import type { PlaceTriggerSpec } from "../src/world-map/types.js";
import type {
  NarrativeStatusDeJuego,
  ServerMessage,
  SinSelloDeSesion,
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import type { WorldClaim } from "./world-claim.js";

/** Superficie mínima de socket que usan los handlers — un WebSocket de `ws`
 *  la cumple, y los tests pueden pasar un capturador. */
export interface ClientSocket {
  send(data: string): void;
  readyState: number;
  OPEN: number;
}

/** Lo que los handlers necesitan del AiClient — permite fakes en tests. */
export type NarrativeAiClient = Pick<
  AiClient,
  "notifySessionStart" | "generateScene" | "reportPlayerChoice" | "developWorld"
>;

export interface BridgeContext {
  sim: GameSimulation;
  /** Config de combate del bootstrap — los handlers de sesión la usan para
   *  instanciar el CombatSystem que declare el game.json (systems.combat). */
  combatConfig: CombatConfig;
  store: GameStore;
  narrative: NarrativeState;
  sessionStorage: SessionStorage;
  aiClient: NarrativeAiClient;
  mapTriggers: MapTriggerEvaluator;
  /** Estado de mapa de los NPC (place/transit/directive) — la capa de
   *  intención que el NpcBehaviorSystem ejecuta. */
  npcDirector: NpcDirector;
  /** Colisión server-side por tile para el movimiento de NPCs. */
  simCollision: SimCollisionProvider;
  gamesDir: string;
  /** Directorio de style packs (data/styles) — manifests + imágenes de
   *  referencia; el State API los sirve como estáticos. */
  stylesDir: string;
  /** Escribir snapshots de mundo en data/games/{id}/world/ al terminar un
   *  bootstrap/generate_game. true en producción; los tests lo apagan para
   *  no contaminar sus fixtures (inyección, como el resto del ctx). */
  persistWorldSnapshots: boolean;
  /** Manifests de los plugins activos de la sesión en curso (id → manifest).
   *  Se reasigna al entrar a start_session/resume_session para que una sesión
   *  sin plugins no herede los de la anterior. */
  activePlugins: Map<string, PluginManifest>;
  /** Cola de generación de escenas/tiles: el motor narrativo atiende una
   *  petición a la vez; los prefetch de tiles se encolan (FIFO con dedupe y
   *  prioridad blocking) en vez de perderse. */
  sceneGen: SceneGenQueue;
  /** Tracking de la activación por posición (tile/place bajo el jugador),
   *  gateado por cambio de celda para no costar nada en el hot loop.
   *  `tileKey` es el gate del save por cambio de TILE (#395): una escritura
   *  por 64 m, no una por celda. */
  posTracking: { cellKey: string | null; tileKey: string | null; placeId: string | null };
  /** El dueño del mundo del sim: quién puede escribir en él y si la partida
   *  guardada está escuchando (`bridge/world-claim.ts`). Tomar el mundo y
   *  decidir si el save escucha son la MISMA llamada — separarlos es lo que
   *  dejaba el `state.json` de una partida con las coordenadas del muñeco de
   *  una fixture dentro. */
  world: WorldClaim;
  /** Añade el socket a los suscriptores de eventos narrativos. */
  subscribe(ws: ClientSocket): void;
  /** Respuesta a UN socket. NO admite los mensajes que llevan sello: para
   *  esos está `enviarNarrativo`, y así «el sello lo escribe el transporte»
   *  es inexpresablemente falso en vez de cierto por costumbre. */
  send(ws: ClientSocket, msg: SinSello): void;
  /** Difunde a todos los suscriptores SELLANDO la sesión vigente. El mensaje
   *  llega sin `sessionId` y sale con él: ninguno de los 23 emisores puede
   *  olvidarse de ponerlo ni ponerlo mal (#282).
   *
   *  Solo acepta lo que SE DIRECCIONA POR SESIÓN (`ConSelloDeSesion`). Lo que
   *  se direcciona por juego va por `difundirDeJuego` y no pasa por aquí. */
  broadcastNarrative(msg: SinSelloDeSesion<ConSelloDeSesion>): void;
  /** Lo mismo a UN socket. Existe para que «el sello lo escribe el
   *  transporte» sea cierto también en el unicast: el rechazo de un frame
   *  inválido contesta un `narrative_status`, y con `send` a secas el
   *  `sessionId` se escribía a mano — o sea, un segundo escritor. Que hoy
   *  hubiera solo uno era un accidente, no un mecanismo. */
  enviarNarrativo(ws: ClientSocket, msg: SinSelloDeSesion<ConSelloDeSesion>): void;
  /** Difunde un mensaje que se direcciona POR JUEGO y NO LLEVA SELLO (#313).
   *
   *  Es un verbo propio y no una bandera de `broadcastNarrative` porque lo que
   *  cambia no es una opción del envío: es que este mensaje no tiene sesión que
   *  sellar. La pre-generación de mundo la pide el título —que no tiene
   *  partida— y el bridge la corre en una sesión efímera que descarta después,
   *  así que cualquier `sessionId` que se le estampara sería una mentira: la de
   *  la partida que el bridge tuviera cargada por casualidad al emitir.
   *
   *  El sello de #282 no se afloja con esto, se REPARTE: los mensajes de
   *  partida siguen sin poder salir sin él (el campo es requerido y el emisor
   *  no puede escribirlo), y los de juego no pueden salir sin `gameId`. Lo que
   *  ya no es expresable es un mensaje con el campo de direccionamiento del
   *  otro esquema. */
  difundirDeJuego(msg: NarrativeStatusDeJuego): void;
}

/** Escribe el snapshot de mundo de la sesión actual como artefacto del juego
 *  (`data/games/{id}/world/{branch}.json`): TODAS las escenas registradas —
 *  en el bootstrap vivo, solo la de entrada; en generate_game, el anillo 3×3
 *  y los places realizados. Best-effort REPORTADO: un fallo de escritura no
 *  tumba el arranque de la sesión, se loguea como warning. */
export function writeSessionSnapshot(
  ctx: BridgeContext,
  gameId: string,
  entrySceneId: string,
): void {
  if (!ctx.persistWorldSnapshots) return;
  try {
    const worldDoc = loadWorldDoc(ctx.gamesDir, gameId);
    const scenes: Record<string, Record<string, unknown>> = {};
    for (const [id, rec] of Object.entries(ctx.narrative.scenes_loaded)) {
      scenes[id] = structuredClone(rec.scene_data);
    }
    writeWorldSnapshot(ctx.gamesDir, {
      schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
      game_id: gameId,
      world_doc_hash: createHash("sha256").update(worldDoc, "utf-8").digest("hex"),
      generated_at: new Date().toISOString(),
      world_map: structuredClone(ctx.narrative.worldMap.serialize()),
      scenes,
      entry_scene_id: entrySceneId,
    });
    console.log(
      `Bridge: world snapshot escrito para "${gameId}" ` +
        `(${Object.keys(scenes).length} escenas)`,
    );
  } catch (err) {
    console.warn(`Bridge: world snapshot no se pudo escribir para "${gameId}":`, err);
  }
}

/** Adjunta el vocabulario canónico del juego (si existe y está vigente) al
 *  contexto de un turno de tile/realize. Un vocabulario ilegible se REPORTA
 *  y no rompe la generación (el turno va sin él). */
export function attachWorldVocabulary(
  ctx: BridgeContext,
  llmCtx: import("../src/narrative/types.js").LlmContext,
): void {
  try {
    const vocab = loadWorldVocabulary(
      ctx.gamesDir,
      ctx.narrative.game_id,
      ctx.narrative.world.world_doc_hash,
    );
    if (vocab && vocab.entries.length > 0) {
      llmCtx.world_vocabulary = vocab.entries;
    }
  } catch (err) {
    console.warn(
      `Bridge: world vocabulary ilegible para "${ctx.narrative.game_id}":`,
      err,
    );
  }
}

/** Guardia anti-takeover de sesión: key del job de generación en vuelo (o del
 *  primero encolado), o null con la cola vacía. `ctx.narrative` es un
 *  SINGLETON: si un start/resume cambia la sesión activa con un job en vuelo,
 *  el job escribiría su escena (y el motor sus tools de mapa) en la sesión
 *  NUEVA — reproducido el 2026-08-17 contaminando el world_map de otro save.
 *  Mientras esta función devuelva key, cambiar de sesión debe rechazarse. */
export function generationBusyKey(ctx: BridgeContext): string | null {
  return ctx.sceneGen.current ?? ctx.sceneGen.pending[0] ?? null;
}

/** Defensa en profundidad de los jobs con awaits largos: al resolver
 *  `generateScene`/`reportPlayerChoice`, si la sesión activa ya no es la que
 *  originó el job, el resultado se DESCARTA sin escribir (el caller difunde
 *  su narrative_status de error con este mensaje). */
export function sessionChangedError(ctx: BridgeContext, jobSessionId: string): string | null {
  if (ctx.narrative.session_id === jobSessionId) return null;
  return (
    `la sesión activa cambió durante la generación (era ${jobSessionId}, ` +
    `ahora ${ctx.narrative.session_id}) — resultado descartado sin escribir`
  );
}

/** Añade a `sceneIds` los ids de escena del vecindario 3×3 alrededor del tile
 *  de `rec` (no-op si `rec` no es un tile). Criterio compartido por la
 *  proyección de enemigos y la vida ambiental de NPCs: el mundo es continuo y
 *  lo "cercano" es el tile más sus 8 adyacentes. */
export function addNeighborhoodSceneIds(
  ctx: BridgeContext,
  rec: SceneRecord | undefined,
  sceneIds: Set<string>,
): void {
  if (!rec?.tile) return;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const n = ctx.narrative.getTile(rec.tile.tx + dx, rec.tile.ty + dy);
      const id = n ? (n.scene_data.scene_id as string | undefined) : undefined;
      if (id) sceneIds.add(id);
    }
  }
}

/** Los mensajes que SÍ llevan sello de sesión: lo que el sellador puede
 *  aceptar. Se deriva del propio `ServerMessage` en vez de enumerarse, así que
 *  un mensaje nuevo con `sessionId` requerido entra solo — y uno que se
 *  direcciona de otra forma queda fuera solo, que es lo que hace falta desde
 *  #313: `NarrativeStatusDeJuego` no tiene `sessionId`, así que sellarlo no es
 *  que esté desaconsejado, es que NO COMPILA. Sin este estrechamiento el
 *  sellador seguía aceptándolo (un `Omit<T,"sessionId">` sobre un tipo que no
 *  lo tiene es el tipo entero) y la pre-generación volvía a salir con un sello
 *  inventado, con el criterio de #313 cumplido solo por casualidad. */
export type ConSelloDeSesion = Extract<ServerMessage, { sessionId: string }>;

/** Los mensajes de servidor que NO llevan sello de sesión: lo que `send`
 *  puede mandar sin pasar por el sellador. Se deriva del propio tipo, así que
 *  un mensaje nuevo con `sessionId` requerido queda fuera solo.
 *
 *  Excluye ADEMÁS el arma de juego a mano, y esta es la única entrada
 *  enumerada del tipo: `NarrativeStatusDeJuego` no tiene `sessionId`, así que
 *  el `Exclude` de arriba lo dejaría pasar y `send` podría emitir un
 *  `narrative_status` a un socket suelto — o sea, un segundo camino de salida
 *  para el mensaje que acaba de ganar el suyo (`difundirDeJuego`). El
 *  invariante que declara `send` («no admito los mensajes que llevan sello»)
 *  se habría ensanchado en silencio a «no admito los que llevan ESE sello». */
export type SinSello = Exclude<ServerMessage, ConSelloDeSesion | NarrativeStatusDeJuego>;

/** Estampa el sello de sesión en un mensaje que sale hacia un cliente (#282).
 *
 *  NO existe por el tipado. Comprobado el 2026-08-28: el spread en línea
 *  —`{ ...msg, sessionId }`, sin cast y sin función— compila, es asignable a
 *  `ServerMessage` y `SinSelloDeSesion` sigue rechazando al emisor que escriba
 *  el sello por su cuenta. Lo que NO valía era el `as ServerMessage`: ese sí
 *  deja pasar un difusor que se olvide del sello, y también está medido.
 *
 *  Existe porque hay TRES sitios que sellan —el broadcast y el unicast de
 *  `ws-server.ts` y el doble de `test/helpers.ts`— y tienen que hacerlo
 *  EXACTAMENTE igual: si el doble sellara distinto, los tests de bridge
 *  medirían un cable que no existe y el sello se podría romper en producción
 *  con todo en verde. Una función es lo que hace que «igual» no dependa de
 *  que alguien copie bien. */
export function sellarSesion<T extends { type: string }>(
  msg: T,
  sessionId: string,
): T & { sessionId: string } {
  return { ...msg, sessionId };
}

/** Push a freshly loaded/realized scene to every narrative subscriber, reusing
 *  the scene_init spawn_entity effect the clients already render. Only real
 *  scenes pass through here — there is no "fallback minimal scene" any more. */
export function broadcastScene(
  ctx: BridgeContext,
  sceneId: string,
  scene: Record<string, unknown>,
  elapsedMs?: number,
  meta?: {
    edge?: import("../src/world-map/types.js").Edge;
    /** Punto de aparición que se PIDE al cliente en el `ready` (viaje a un
     *  place anclado): el cliente es dueño de su posición. */
    spawn?: { x: number; z: number };
    /** De dónde sale esta escena: generada ahora, ya en sesión, o del mundo
     *  pre-generado. Viaja en el `ready` para que el cliente pueda AFIRMAR la
     *  diferencia en vez de suponerla. */
    source?: "engine" | "cache" | "snapshot";
  },
): void {
  // Contrato de render único: los clientes reciben la world scene normalizada
  // (objects/npcs en metros, __player_start, world_rect, __format_d con el
  // crudo) CON el combate vivo y las salidas del lugar encima. La persistencia
  // (scenes_loaded, saves, serializeForLlm) sigue en Format D crudo — sólo se
  // normaliza el wire, y por una sola puerta (`bridge/wire-scene.ts`).
  const worldScene = escenaParaElWire(ctx, sceneId, scene);
  // Aquí vivía una segunda vía a `GameStore.enemies`: una "proyección
  // canónica" NarrativeState.entities → enemies que REEMPLAZABA la lista
  // entera en cada broadcast. Se retiró con `state-projection.ts` (#323) y no
  // vuelve, por dos razones que se descubrieron midiendo:
  //
  //  1. Nunca tuvo productor. Filtraba por `type === "enemy"`, y ninguna
  //     entity del juego lo es: el enum de `spawn_entity` son npc/building/
  //     object y `EmittedSceneSchema` rechaza `kind:"enemy"`. Su único test
  //     fabricaba la entrada a mano.
  //  2. Y estando muerta hacía daño: como `getEnemyStates` ITERA
  //     `store.state.enemies`, el primer cambio de tile tras un
  //     `add_combatants` borraba del `state_update` a un enemigo que seguía
  //     vivo en el sim. La barra de vida se congelaba y el combate se perdía.
  //
  // La vía viva —la única— es world scene → `npcs[].combat` → cliente →
  // `add_combatants` → `sim.addCombatant`, y ésa sí añade combatiente al sim,
  // que es lo que `getEnemyStates` exige para emitir nada.
  ctx.broadcastNarrative({
    type: "narrative_event",
    eventId: "scene_init",
    consequences: [],
    effects: [
      {
        kind: "spawn_entity",
        entityId: sceneId,
        entityKind: "object",
        description: String(scene.scene_description ?? sceneId),
        position: [0, 0, 0],
        data: { scene: worldScene },
        eventId: "scene_init",
      },
    ],
  });
  // El ready lleva las coords del tile (si lo es) para el velo/notificación
  // direccional del cliente.
  const rawTile = scene.tile as { tx?: number; ty?: number } | undefined;
  const isTile = rawTile && Number.isInteger(rawTile.tx) && Number.isInteger(rawTile.ty);
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "ready",
    kind: isTile ? "tile" : "scene",
    tile: isTile ? { tx: rawTile.tx!, ty: rawTile.ty! } : undefined,
    edge: meta?.edge,
    spawn: meta?.spawn,
    source: meta?.source,
    elapsedMs,
  });
  // La escena difundida puede traer NPCs nuevos (registrados por
  // recordSceneLoaded) — engancharlos a la vida ambiental.
  npcSync(ctx);
}

/** Nivel 3 del tick (§7.4): pasa los plugin_events recolectados por
 *  dispatchConsequences al dispatcher de plugins. El tick es transaccional:
 *  en error no se commitea nada, se loguea y se propaga narrative_status al
 *  cliente (las consequences core ya aplicadas se conservan). El save lo hace
 *  el caller — un único save por tick. */
export function runPluginTick(
  ctx: BridgeContext,
  eventId: string,
  events: PluginEventInput[],
): PluginAppliedEffect[] {
  if (events.length === 0) return [];
  const result = dispatchPluginEvents(ctx.narrative, ctx.activePlugins, events);
  // Referencia colgante: se dice ENTERA en el log (es donde se depura) y el
  // turno sigue con los demás eventos. Lo que el jugador nota es que ese
  // tenderete no le vende, no un overlay a pantalla completa.
  for (const u of result.undelivered) {
    console.warn(
      `Bridge: evento '${u.type}' no entregado en ${eventId} (${u.reason}, ` +
        `plugin ${u.pluginId.slice(0, 12)}…) — se omite ese evento; el resto del tick sigue`,
    );
  }
  if (!result.ok) {
    console.error(`Bridge: plugin tick aborted for ${eventId}:`, result.error);
    // `plugin` y no `consequences` (#352): un sistema del juego reventó su
    // turno. El cuerpo ya nombraba al plugin; el titular decía «el motor
    // narrativo rechazó la respuesta» y mandaba a mirar el sitio equivocado.
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "plugin",
      // Al jugador, la frase; el volcado del error ya está en el log de arriba.
      message: result.error
        ? describePluginTickError(result.error, (id) => ctx.narrative.resolvePluginRecord(id)?.name)
        : "Un sistema del juego no pudo completar el turno.",
    });
    return [];
  }
  return result.effects;
}

/** Evaluate the map triggers crossed by a place transition and dispatch their
 *  consequences. Fires player_left on the old place, player_entered/first_visit
 *  on the new one. Pre-authored by the narrative engine via map_add_trigger. */
export async function fireMapTriggers(
  ctx: BridgeContext,
  prevPlaceId: string,
  newPlaceId: string,
): Promise<void> {
  const fired: PlaceTriggerSpec[] = [];
  if (prevPlaceId && prevPlaceId !== newPlaceId) {
    fired.push(...ctx.mapTriggers.evaluateLeave(prevPlaceId));
  }
  fired.push(...ctx.mapTriggers.evaluateEnter(newPlaceId));
  if (fired.length === 0) return;
  // evaluateEnter may have stamped first_visit triggers — persist that.
  await ctx.narrative.save();

  const consequences = fired.flatMap((t) => t.consequences);
  if (consequences.length === 0) return;
  const eventId = "map_trigger";
  const playerPos = ctx.store.state.player.pos;
  const dispatched = dispatchConsequences(ctx.narrative, eventId, consequences, {
    playerPosition: { x: playerPos[0], y: playerPos[1], z: playerPos[2] },
    playerForward: { x: 0, y: 0, z: -1 },
  });
  const pluginFx = runPluginTick(ctx, eventId, dispatched.pluginEvents);
  await ctx.narrative.save();
  ctx.broadcastNarrative({
    type: "narrative_event",
    eventId,
    consequences,
    effects: [...dispatched.effects, ...pluginFx],
  });
}

/** Crea el NpcBehaviorSystem de la sesión con el adapter real del bridge
 *  (colisión server-side + world map + entities). id ausente → default
 *  "ambient"; id desconocido → throw (fail-loud, el caller decide abortar). */
export function createSessionNpcBehavior(
  ctx: BridgeContext,
  id: string | undefined,
): NpcBehaviorSystem {
  return npcBehaviorRegistry.create(id, {
    // Sembrado por sesión (no por reloj): el wander es reproducible entre
    // resumes y en tests — la flakiness de bridge-npc venía de Date.now().
    rng: seededRng(`${ctx.narrative.session_id}:npc`),
    world: {
      blocksMove: (fx, fz, tx, tz, r) => ctx.simCollision.blocksMove(fx, fz, tx, tz, r),
      blocksCircle: (x, z, r) => ctx.simCollision.blocksCircle(x, z, r),
      resolvePlaceTarget: (placeId) => resolvePlaceTarget(ctx.narrative, placeId),
      getEntityPosition: (entityId) => {
        const e = ctx.narrative.getEntity(entityId);
        return e ? { x: e.position[0], y: e.position[1], z: e.position[2] } : null;
      },
    },
  });
}

/** Reconcilia el behavior system con NarrativeState.entities: gestiona los
 *  NPC cuyo scene_id cae en el vecindario 3×3 del tile activo (más la escena
 *  activa); los que salen se retiran y quedan congelados en su última
 *  posición (ya persistida en el EntityRecord). Llamar tras cargar/activar
 *  escenas y tras spawns dinámicos — nunca per-tick. */
export function npcSync(ctx: BridgeContext): void {
  const behavior = ctx.sim.npcBehaviorSystem;
  if (!behavior) return;
  const activeId = ctx.narrative.world.active_scene_id;
  const sceneIds = new Set<string>();
  if (activeId) sceneIds.add(activeId);
  addNeighborhoodSceneIds(ctx, activeId ? ctx.narrative.scenes_loaded[activeId] : undefined, sceneIds);
  const want = new Set<string>();
  for (const e of ctx.narrative.entities) {
    if (e.type !== "npc" || !sceneIds.has(e.scene_id)) continue;
    // Un HOSTIL no entra en la vida ambiental. No es higiene: `NpcBehaviorSystem`
    // MUTA `record.position` in situ cada tick, y a un combatiente lo mueve la
    // IA de combate del sim. Los dos a la vez son dos dueños de la misma
    // posición — el enemigo parpadearía entre dos sitios, saldría por los DOS
    // canales del `state_update` (`getNpcStates` y `getEnemyStates`) y, con
    // `flees_from_combat`, huiría de su propia pelea. Hasta hoy nada lo
    // impedía porque nunca hubo enemigos.
    if (isHostileRole(e.data.role)) continue;
    want.add(e.id);
    behavior.addNpc(e);
  }
  for (const id of behavior.ids()) {
    if (!want.has(id)) behavior.removeNpc(id);
  }
}

/** Nombre legible de un NPC para el log ambiental (data.name o el id). */
export function npcLabel(ctx: BridgeContext, npcId: string): string {
  const name = ctx.narrative.getEntity(npcId)?.data.name;
  return typeof name === "string" && name ? name : npcId;
}

export function getNpcStates(ctx: BridgeContext): StateUpdateMessage["npcs"] {
  const behavior = ctx.sim.npcBehaviorSystem;
  if (!behavior) return undefined;
  return behavior.states().map((s) => ({
    id: s.id,
    pos: s.pos,
    forward: s.forward,
    moving: s.moving,
    run: s.run,
    anim: s.anim,
    state: s.mode,
  }));
}

export function getEnemyStates(ctx: BridgeContext): StateUpdateMessage["enemies"] {
  const result: StateUpdateMessage["enemies"] = [];
  // Iterate store enemies since we can't enumerate combatants map directly
  for (const e of ctx.store.state.enemies) {
    const c = ctx.sim.getCombatant(e.id);
    if (c) {
      result.push({
        id: c.id,
        hp: c.health,
        state: c.state,
        alive: c.health > 0,
        pos: { x: c.position.x, y: c.position.y, z: c.position.z },
        forward: { x: c.forward.x, y: c.forward.y, z: c.forward.z },
        attackType: c.currentAttackType || undefined,
      });
    }
  }
  return result;
}
