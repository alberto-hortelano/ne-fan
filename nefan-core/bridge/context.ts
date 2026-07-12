/** Shared state + helpers for the bridge message handlers.
 *
 *  `BridgeContext` encapsula todo lo que antes eran globals de ws-server.ts,
 *  de forma que cada handler sea una función (msg, ws, ctx) testeable con
 *  fakes (socket capturador, AiClient falso) sin abrir sockets reales. */

import type { GameSimulation } from "../src/simulation/game-loop.js";
import type { CombatConfig } from "../src/types.js";
import type { GameStore } from "../src/store/game-store.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { SessionStorage } from "../src/narrative/session-storage.js";
import type { AiClient } from "../src/narrative/ai-client.js";
import type { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import type { NpcDirector } from "../src/world-map/npc-director.js";
import type { InitialSceneCache } from "../src/dev/initial-scene-cache.js";
import type { PluginManifest } from "../src/plugins/types.js";
import type { SceneRecord } from "../src/narrative/types.js";
import type { NpcBehaviorSystem } from "../src/simulation/npc-behavior.js";
import { npcBehaviorRegistry } from "../src/simulation/npc-behavior-registry.js";
import { SeededRng } from "../src/rng.js";
import { resolvePlaceTarget } from "../src/world-map/place-target.js";
import type { SimCollisionProvider } from "./sim-collision.js";
import {
  dispatchPluginEvents,
  type PluginAppliedEffect,
  type PluginEventInput,
} from "../src/plugins/dispatcher.js";
import { dispatchConsequences } from "../src/narrative/consequence-handler.js";
import { projectEnemiesFromEntities } from "../src/store/state-projection.js";
import { SceneGenQueue } from "./scene-gen-queue.js";
import type { PlaceTriggerSpec } from "../src/world-map/types.js";
import { resolveExitEdge } from "../src/world-map/edges.js";
import type { SceneExit, ServerMessage, StateUpdateMessage } from "../src/protocol/messages.js";

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
  initialSceneCache: InitialSceneCache;
  gamesDir: string;
  /** Directorio de style packs (data/styles) — manifests + imágenes de
   *  referencia; el State API los sirve como estáticos. */
  stylesDir: string;
  /** CONFIG.dev.cache_initial_scene inyectado (tests lo apagan). */
  cacheInitialScene: boolean;
  /** Manifests de los plugins activos de la sesión en curso (id → manifest).
   *  Se reasigna al entrar a start_session/resume_session para que una sesión
   *  sin plugins no herede los de la anterior. */
  activePlugins: Map<string, PluginManifest>;
  /** Cola de generación de escenas/tiles: el motor narrativo atiende una
   *  petición a la vez; los prefetch de tiles se encolan (FIFO con dedupe y
   *  prioridad blocking) en vez de perderse. */
  sceneGen: SceneGenQueue;
  /** Tracking de la activación por posición (tile/place bajo el jugador),
   *  gateado por cambio de celda para no costar nada en el hot loop. */
  posTracking: { cellKey: string | null; placeId: string | null };
  /** Añade el socket a los suscriptores de eventos narrativos. */
  subscribe(ws: ClientSocket): void;
  send(ws: ClientSocket, msg: ServerMessage): void;
  broadcastNarrative(msg: ServerMessage): void;
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
      const id = n ? ((n.scene_data.scene_id ?? n.scene_data.room_id) as string | undefined) : undefined;
      if (id) sceneIds.add(id);
    }
  }
}

/** Attach the current place's outgoing links to the scene as `exits`, so the
 *  2D client can show a travel panel without pulling the whole world map.
 *  Mutates `scene` in place (same object recordSceneLoaded stored by ref). */
export function enrichSceneWithExits(ctx: BridgeContext, scene: Record<string, unknown>): void {
  const placeId =
    (typeof scene.place_id === "string" && scene.place_id) ||
    ctx.narrative.worldMap.serialize().active_place_id;
  if (!placeId) return;
  const links = ctx.narrative.worldMap.getOutgoingLinks(placeId);
  scene.exits = links.map((l): SceneExit => {
    const targetId = l.from === placeId ? l.to : l.from;
    return {
      place_id: targetId,
      name: ctx.narrative.worldMap.get(targetId)?.name ?? targetId,
      link_kind: l.kind,
      travel_hours: l.travel_hours,
      description: l.description,
      // Lado de esta escena por el que sale el link (para la transición
      // continua del cliente). null → undefined: exit sin orientación.
      edge: resolveExitEdge(ctx.narrative.worldMap, placeId, l) ?? undefined,
    };
  });
}

/** Push a freshly loaded/realized scene to every narrative subscriber, reusing
 *  the scene_init spawn_entity effect the clients already render. Only real
 *  scenes pass through here — there is no "fallback minimal scene" any more. */
export function broadcastScene(
  ctx: BridgeContext,
  sceneId: string,
  scene: Record<string, unknown>,
  elapsedMs?: number,
  meta?: { edge?: import("../src/world-map/types.js").Edge },
): void {
  enrichSceneWithExits(ctx, scene);
  // Proyección canónica NarrativeState.entities → GameStore.enemies para la
  // escena que se difunde. Con tiles, la proyección cubre el VECINDARIO 3×3
  // del tile difundido más la escena activa — los enemigos de los tiles
  // adyacentes siguen vivos en el sim (el mundo es continuo, no una arena).
  const sceneIds = new Set<string>([sceneId, ctx.narrative.world.active_scene_id]);
  addNeighborhoodSceneIds(ctx, ctx.narrative.scenes_loaded[sceneId], sceneIds);
  ctx.store.dispatch("enemies_projected", {
    enemies: [...sceneIds].flatMap((id) =>
      projectEnemiesFromEntities(ctx.narrative.entities, { sceneId: id }),
    ),
  });
  ctx.broadcastNarrative({
    type: "narrative_event",
    eventId: "scene_init",
    consequences: [],
    effects: [
      {
        kind: "spawn_entity",
        entityId: sceneId,
        entityKind: "object",
        description: String(scene.room_description ?? scene.scene_description ?? sceneId),
        position: [0, 0, 0],
        data: { scene },
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
  if (!result.ok) {
    console.error(`Bridge: plugin tick aborted for ${eventId}:`, result.error);
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "consequences",
      message: `plugin ${result.error?.code}: ${JSON.stringify(result.error)}`,
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
    rng: new SeededRng(Date.now()),
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
