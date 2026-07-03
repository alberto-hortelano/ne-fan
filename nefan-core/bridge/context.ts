/** Shared state + helpers for the bridge message handlers.
 *
 *  `BridgeContext` encapsula todo lo que antes eran globals de ws-server.ts,
 *  de forma que cada handler sea una función (msg, ws, ctx) testeable con
 *  fakes (socket capturador, AiClient falso) sin abrir sockets reales. */

import type { GameSimulation } from "../src/simulation/game-loop.js";
import type { GameStore } from "../src/store/game-store.js";
import type { ScenarioRunner } from "../src/scenario/scenario-runner.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { SessionStorage } from "../src/narrative/session-storage.js";
import type { AiClient } from "../src/narrative/ai-client.js";
import type { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import type { InitialSceneCache } from "../src/dev/initial-scene-cache.js";
import type { PluginManifest } from "../src/plugins/types.js";
import {
  dispatchPluginEvents,
  type PluginAppliedEffect,
  type PluginEventInput,
} from "../src/plugins/dispatcher.js";
import { dispatchConsequences } from "../src/narrative/consequence-handler.js";
import { projectEnemiesFromEntities } from "../src/store/state-projection.js";
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
  "notifySessionStart" | "generateScene" | "reportPlayerChoice"
>;

export interface BridgeContext {
  sim: GameSimulation;
  store: GameStore;
  scenario: ScenarioRunner;
  narrative: NarrativeState;
  sessionStorage: SessionStorage;
  aiClient: NarrativeAiClient;
  mapTriggers: MapTriggerEvaluator;
  initialSceneCache: InitialSceneCache;
  gamesDir: string;
  /** CONFIG.dev.cache_initial_scene inyectado (tests lo apagan). */
  cacheInitialScene: boolean;
  /** Manifests de los plugins activos de la sesión en curso (id → manifest).
   *  Se reasigna al entrar a start_session/resume_session para que una sesión
   *  sin plugins no herede los de la anterior. */
  activePlugins: Map<string, PluginManifest>;
  /** Añade el socket a los suscriptores de eventos narrativos. */
  subscribe(ws: ClientSocket): void;
  send(ws: ClientSocket, msg: ServerMessage): void;
  broadcastNarrative(msg: ServerMessage): void;
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
): void {
  enrichSceneWithExits(ctx, scene);
  // Proyección canónica NarrativeState.entities → GameStore.enemies para la
  // escena que se difunde. Los dos dispatch inline que quedan en
  // handlers/simulation.ts proyectan fuentes NO narrativas (enemigos que el
  // cliente declara en load_room y el ScenarioRunner legacy de load_game).
  ctx.store.dispatch("enemies_projected", {
    enemies: projectEnemiesFromEntities(ctx.narrative.entities, { sceneId }),
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
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "ready",
    kind: "scene",
    elapsedMs,
  });
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
