/** WebSocket bridge — runs GameSimulation + ScenarioRunner, communicates with Godot on :9877. */

import { WebSocketServer, WebSocket } from "ws";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { ScenarioRunner } from "../src/scenario/scenario-runner.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { FsSessionStorage } from "../src/narrative/session-storage.js";
import { AiClient } from "../src/narrative/ai-client.js";
import { dispatchConsequences } from "../src/narrative/consequence-handler.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import { WorldMapManager } from "../src/world-map/world-map.js";
import { InitialSceneCache } from "../src/dev/initial-scene-cache.js";
import {
  loadGamePluginManifests,
  activatePluginsForNewSession,
  bindPluginsForResume,
} from "../src/plugins/loader.js";
import {
  dispatchPluginEvents,
  type PluginAppliedEffect,
  type PluginEventInput,
} from "../src/plugins/dispatcher.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
import { inspectPlugin } from "../src/plugins/views.js";
import type { PluginManifest } from "../src/plugins/types.js";
import { CONFIG } from "../src/config.js";
import { createStateHttpServer } from "./state-http-server.js";
import type { CombatConfig } from "../src/types.js";
import type { PlaceTriggerSpec } from "../src/world-map/types.js";
import type {
  ClientMessage,
  StateUpdateMessage,
  ServerMessage,
} from "../src/protocol/messages.js";
import type { ScenarioUpdate } from "../src/scenario/scenario-types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve paths relative to project root (works from both src/ and dist/)
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "data").replace("/dist/data", "/data");
const PORT = 9877;
// State HTTP API for the narrative engine's tools (map / entities / inventory).
const STATE_HTTP_PORT = Number(process.env.NEFAN_STATE_HTTP_PORT ?? 9878);
const GAMES_DIR = resolve(dataDir, "games");

// Saves live in a shared filesystem location accessible to every client
// (HTML cannot read user:// from Godot). Override with NEFAN_SAVES_DIR.
const SAVES_DIR =
  process.env.NEFAN_SAVES_DIR ?? resolve(homedir(), "code", "ne-fan", "saves");
const AI_SERVER_URL = process.env.NEFAN_AI_SERVER ?? "http://127.0.0.1:8765";

// Load combat config
const configPath = resolve(dataDir, "combat_config.json");
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(configPath, "utf-8")),
);

const store = new GameStore();
let sim = new GameSimulation(config, store, Date.now());
const scenario = new ScenarioRunner();
const sessionStorage = new FsSessionStorage(SAVES_DIR);
const narrative = new NarrativeState(sessionStorage);
const aiClient = new AiClient({ baseUrl: AI_SERVER_URL });
const npcDirector = new NpcDirector(narrative);
const mapTriggers = new MapTriggerEvaluator(narrative);
const initialSceneCache = new InitialSceneCache(
  resolve(dataDir, "initial_scene_cache"),
);

// Players currently subscribed to narrative events (broadcast targets).
const narrativeSubscribers = new Set<WebSocket>();

// Manifests de los plugins activos de la sesión en curso (id → manifest).
// Se puebla en start_session/resume_session y lo consume el dispatcher de
// plugins (F4). Se resetea al entrar a ambos handlers para que una sesión
// sin plugins no herede los de la anterior.
let activePlugins: Map<string, PluginManifest> = new Map();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastNarrative(msg: ServerMessage): void {
  for (const ws of narrativeSubscribers) send(ws, msg);
}

/** Attach the current place's outgoing links to the scene as `exits`, so the
 *  2D client can show a travel panel without pulling the whole world map.
 *  Mutates `scene` in place (same object recordSceneLoaded stored by ref). */
function enrichSceneWithExits(scene: Record<string, unknown>): void {
  const placeId =
    (typeof scene.place_id === "string" && scene.place_id) ||
    narrative.worldMap.serialize().active_place_id;
  if (!placeId) return;
  const links = narrative.worldMap.getOutgoingLinks(placeId);
  scene.exits = links.map((l) => {
    const targetId = l.from === placeId ? l.to : l.from;
    return {
      place_id: targetId,
      name: narrative.worldMap.get(targetId)?.name ?? targetId,
      link_kind: l.kind,
      travel_hours: l.travel_hours,
      description: l.description,
    };
  });
}

/** Push a freshly loaded/realized scene to every narrative subscriber, reusing
 *  the scene_init spawn_entity effect the clients already render. Only real
 *  scenes pass through here — there is no "fallback minimal scene" any more. */
function broadcastScene(
  sceneId: string,
  scene: Record<string, unknown>,
  elapsedMs?: number,
): void {
  enrichSceneWithExits(scene);
  broadcastNarrative({
    type: "narrative_event",
    eventId: "scene_init",
    consequences: [],
    effects: [
      {
        kind: "spawn_entity",
        entityId: sceneId,
        entityKind: "object",
        description: String(
          scene.room_description ?? scene.scene_description ?? sceneId,
        ),
        position: [0, 0, 0],
        data: { scene },
        eventId: "scene_init",
      },
    ],
  });
  broadcastNarrative({
    type: "narrative_status",
    phase: "ready",
    kind: "scene",
    elapsedMs,
  });
}

/** Evaluate the map triggers crossed by a place transition and dispatch their
 *  consequences. Fires player_left on the old place, player_entered/first_visit
 *  on the new one. Pre-authored by the narrative engine via map_add_trigger. */
async function fireMapTriggers(prevPlaceId: string, newPlaceId: string): Promise<void> {
  const fired: PlaceTriggerSpec[] = [];
  if (prevPlaceId && prevPlaceId !== newPlaceId) {
    fired.push(...mapTriggers.evaluateLeave(prevPlaceId));
  }
  fired.push(...mapTriggers.evaluateEnter(newPlaceId));
  if (fired.length === 0) return;
  // evaluateEnter may have stamped first_visit triggers — persist that.
  await narrative.save();

  const consequences = fired.flatMap((t) => t.consequences);
  if (consequences.length === 0) return;
  const eventId = "map_trigger";
  const playerPos = store.state.player.pos;
  const dispatched = dispatchConsequences(narrative, eventId, consequences, {
    playerPosition: { x: playerPos[0], y: playerPos[1], z: playerPos[2] },
    playerForward: { x: 0, y: 0, z: -1 },
  });
  const pluginFx = runPluginTick(eventId, dispatched.pluginEvents);
  await narrative.save();
  broadcastNarrative({
    type: "narrative_event",
    eventId,
    consequences,
    effects: [...dispatched.effects, ...pluginFx],
  });
}

/** Nivel 3 del tick (§7.4): pasa los plugin_events recolectados por
 *  dispatchConsequences al dispatcher de plugins. El tick es transaccional:
 *  en error no se commitea nada, se loguea y se propaga narrative_status al
 *  cliente (las consequences core ya aplicadas se conservan). El save lo hace
 *  el caller — un único save por tick. */
function runPluginTick(eventId: string, events: PluginEventInput[]): PluginAppliedEffect[] {
  if (events.length === 0) return [];
  const result = dispatchPluginEvents(narrative, activePlugins, events);
  if (!result.ok) {
    console.error(`Bridge: plugin tick aborted for ${eventId}:`, result.error);
    broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "consequences",
      message: `plugin ${result.error?.code}: ${JSON.stringify(result.error)}`,
    });
    return [];
  }
  return result.effects;
}

function listGames(): Array<{ game_id: string; title: string; description?: string }> {
  if (!existsSync(GAMES_DIR)) {
    throw new Error(`games directory not found: ${GAMES_DIR}`);
  }
  const out: Array<{ game_id: string; title: string; description?: string }> = [];
  for (const entry of readdirSync(GAMES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const gameJson = resolve(GAMES_DIR, entry.name, "game.json");
    if (!existsSync(gameJson)) continue;
    let def: { game_id?: string; title?: string; description?: string };
    try {
      def = JSON.parse(readFileSync(gameJson, "utf-8"));
    } catch (err) {
      throw new Error(`game.json malformed (${gameJson}): ${(err as Error).message}`);
    }
    out.push({
      game_id: def.game_id ?? entry.name,
      title: def.title ?? entry.name,
      description: def.description,
    });
  }
  return out;
}

// Add player
sim.addCombatant(
  createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
);

// Don't crash the bridge if a downstream service (ai_server) is offline.
process.on("unhandledRejection", (reason) => {
  console.warn("Bridge: unhandled rejection:", reason);
});

const wss = new WebSocketServer({ port: PORT });
console.log(`NEFan Logic Bridge listening on ws://localhost:${PORT}`);

// State HTTP API: the narrative engine (Claude via narrative-mcp tools) queries
// and mutates the authoritative NarrativeState here, instead of receiving the
// whole world in the LLM context.
createStateHttpServer({
  port: STATE_HTTP_PORT,
  narrative,
  npcDirector,
  onMutation: async () => {
    await narrative.save();
  },
  plugins: {
    register: (raw) => {
      const result = registerRuntimePlugin(narrative, activePlugins, raw);
      console.log(
        `Bridge: plugin '${result.manifest.name}' v${result.manifest.version} ` +
          `activado en runtime (${result.id.slice(0, 12)}…, ${result.fixturesPassed} fixtures)`,
      );
      // plugin_activated (§7.3 paso 5): se notifica con el status existente
      // para no tocar los parsers de cliente.
      broadcastNarrative({
        type: "narrative_status",
        phase: "ready",
        kind: "consequences",
        message: `Plugin activado: ${result.manifest.name} (${result.id.slice(0, 12)}…)`,
      });
      return {
        id: result.id,
        name: result.manifest.name,
        version: result.manifest.version,
        fixturesPassed: result.fixturesPassed,
      };
    },
    list: () =>
      [...activePlugins.entries()].map(([id, m]) => ({
        id,
        name: m.name,
        version: m.version,
        description: m.description,
        origin_author: narrative.getPluginRecord(id)?.origin.author ?? m.origin.author,
        events_consumed: m.events_consumed.map((e) => e.type),
        events_produced: m.events_produced,
        derived_views: m.derived_views.map((v) => v.name),
      })),
    inspect: (id, view) =>
      inspectPlugin(
        {
          plugins: narrative.plugins,
          world: narrative.world,
          player: narrative.player,
          entities: narrative.entities,
        },
        activePlugins,
        id,
        view,
      ) as unknown as Record<string, unknown>,
  },
});

wss.on("connection", (ws: WebSocket) => {
  console.log("Bridge: client connected");

  ws.on("message", async (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch (err) {
      const preview = raw.toString().slice(0, 200);
      console.error(`Bridge: invalid WS frame, dropping: ${preview}`, err);
      send(ws, {
        type: "narrative_status",
        phase: "error",
        kind: "scene",
        message: `Bridge recibió un frame WS inválido: ${(err as Error).message}`,
      });
      return;
    }

    switch (msg.type) {
      case "input": {
        const result = sim.tick(msg.delta, msg.inputs);

        // Tick scenario runner
        const playerPos = msg.inputs.playerPosition;
        const scenarioResult = scenario.isActive
          ? await scenario.tick(msg.delta, playerPos)
          : null;

        // Process pending enemies from scenario
        if (scenario.isActive) {
          const pendingEnemies = scenario.drainPendingEnemies();
          for (const enemy of pendingEnemies) {
            if (enemy) {
              const combatant = createCombatant(
                enemy.id,
                enemy.combat.health,
                enemy.combat.weapon_id,
                { x: enemy.position[0], y: enemy.position[1], z: enemy.position[2] },
                { x: 0, y: 0, z: 1 },
              );
              sim.addCombatant(combatant, enemy.combat.personality);
              store.dispatch("enemies_projected", {
                enemies: [
                  ...store.state.enemies,
                  {
                    id: enemy.id,
                    pos: enemy.position,
                    hp: enemy.combat.health,
                    max_hp: enemy.combat.health,
                    weapon_id: enemy.combat.weapon_id,
                    combat_state: "idle",
                    alive: true,
                  },
                ],
              });
            }
          }

          // Update enemy alive status for trigger evaluation
          const anyAlive = store.state.enemies.some((e) => e.alive);
          scenario.setAllEnemiesDead(!anyAlive || store.state.enemies.length === 0);
        }

        // Send one state_update per scenario update to avoid Object.assign overwriting
        const playerHpNow = sim.getCombatant("player")?.health ?? 0;
        const enemyStates = getEnemyStates();
        const npcStates = scenarioResult?.npcs;

        if (scenarioResult && scenarioResult.scenarioUpdates.length > 0) {
          // First message includes combat events + first scenario update
          const firstUpdate = scenarioResult.scenarioUpdates[0];
          ws.send(JSON.stringify({
            type: "state_update",
            events: result.events,
            playerHp: playerHpNow,
            enemies: enemyStates,
            npcs: npcStates,
            scenario: firstUpdate,
          } satisfies StateUpdateMessage));

          // Remaining scenario updates sent as separate messages
          for (let i = 1; i < scenarioResult.scenarioUpdates.length; i++) {
            ws.send(JSON.stringify({
              type: "state_update",
              events: [],
              playerHp: playerHpNow,
              enemies: enemyStates,
              npcs: npcStates,
              scenario: scenarioResult.scenarioUpdates[i],
            } satisfies StateUpdateMessage));
          }
        } else {
          ws.send(JSON.stringify({
            type: "state_update",
            events: result.events,
            playerHp: playerHpNow,
            enemies: enemyStates,
            npcs: npcStates,
          } satisfies StateUpdateMessage));
        }
        break;
      }

      case "load_room": {
        // Reset simulation for new room
        sim.reset();
        // Always use max HP when loading a new room (player starts fresh)
        const playerMaxHp = store.state.player.max_hp || 100;
        store.dispatch("player_respawned", { hp: playerMaxHp, pos: [0, 0, 0] });
        sim.addCombatant(
          createCombatant("player", playerMaxHp, store.state.player.weapon_id,
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
        );

        // Set room bounds for AI clamping
        if (msg.dimensions) {
          sim.setRoomBounds(msg.dimensions.width, msg.dimensions.depth);
        }

        // Add enemies from room data
        for (const enemy of msg.enemies) {
          const combatant = createCombatant(
            enemy.id, enemy.health, enemy.weaponId, enemy.position,
            { x: 0, y: 0, z: 1 }, // Default forward
          );
          sim.addCombatant(combatant, enemy.personality);
        }

        store.dispatch("room_changed", { room_id: msg.roomId });
        store.dispatch("enemies_projected", {
          enemies: msg.enemies.map(e => ({
            id: e.id,
            pos: [e.position.x, e.position.y, e.position.z],
            hp: e.health,
            max_hp: e.health,
            weapon_id: e.weaponId,
            combat_state: "idle",
            alive: true,
          })),
        });

        console.log(`Bridge: room loaded '${msg.roomId}' with ${msg.enemies.length} enemies`);
        // Send state_update with reset HP so Godot gets the fresh state
        const roomResponse: StateUpdateMessage = {
          type: "state_update",
          events: [{ type: "player_respawned", hp: playerMaxHp }],
          playerHp: playerMaxHp,
          enemies: getEnemyStates(),
        };
        ws.send(JSON.stringify(roomResponse));
        break;
      }

      case "respawn": {
        const events = sim.respawn();
        const response: StateUpdateMessage = {
          type: "state_update",
          events,
          playerHp: sim.getCombatant("player")?.health ?? 100,
          enemies: getEnemyStates(),
        };
        ws.send(JSON.stringify(response));
        console.log("Bridge: player respawned");
        break;
      }

      case "load_game": {
        // Reset simulation
        sim.reset();
        scenario.loadGame(GAMES_DIR, msg.gameId).then(async (sceneData) => {
          if (!sceneData) {
            // No initial scene materialized — the scenario runner expected
            // one but loadSceneData returned null. Reply directly to the
            // requesting socket: `load_game` is the legacy bypass path so
            // the caller is not necessarily in `narrativeSubscribers`, and
            // a `broadcastNarrative` would not reach them.
            const message = `load_game '${msg.gameId}': scenario produced no initial scene`;
            console.warn(`Bridge: ${message}`);
            send(ws, {
              type: "narrative_status",
              phase: "error",
              kind: "scene",
              message,
            });
            return;
          }

          // Set up player
          const playerHp = 100;
          store.dispatch("player_respawned", { hp: playerHp, pos: [0, 0, 0] });
          sim.addCombatant(
            createCombatant("player", playerHp, "unarmed",
              { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
          );

          // Send scene data first so Godot rebuilds the room
          const sceneResponse: StateUpdateMessage = {
            type: "state_update",
            events: [{ type: "player_respawned", hp: playerHp }],
            playerHp,
            enemies: [],
            scenario: { change_scene: sceneData },
          };
          ws.send(JSON.stringify(sceneResponse));

          // Run an initial tick to execute first beat actions (spawn NPCs, dialogue, etc.)
          const initialTick = await scenario.tick(0, { x: 0, y: 0, z: 0 });

          // Send beat actions after a short delay so Godot has time to build the scene
          if (initialTick.scenarioUpdates.length > 0) {
            setTimeout(() => {
              for (const u of initialTick.scenarioUpdates) {
                const beatResponse: StateUpdateMessage = {
                  type: "state_update",
                  events: [],
                  playerHp,
                  enemies: [],
                  npcs: initialTick.npcs,
                  scenario: u,
                };
                ws.send(JSON.stringify(beatResponse));
              }
            }, 500);
          }

          console.log(`Bridge: game '${msg.gameId}' loaded`);
        }).catch((err: unknown) => {
          // Reply directly to the requesting socket — see the !sceneData
          // branch above for why we don't `broadcastNarrative` here.
          const message = `load_game '${msg.gameId}' failed: ${(err as Error).message ?? String(err)}`;
          console.error(`Bridge: ${message}`);
          send(ws, {
            type: "narrative_status",
            phase: "error",
            kind: "scene",
            message,
          });
        });
        break;
      }

      case "scenario_event": {
        const updates: ScenarioUpdate[] = [];
        switch (msg.event) {
          case "dialogue_advanced":
            scenario.handleDialogueAdvanced();
            break;
          case "dialogue_choice":
            if (msg.data?.choiceIndex !== undefined) {
              const choiceUpdates = await scenario.handleDialogueChoice(msg.data.choiceIndex);
              updates.push(...choiceUpdates);
            }
            break;
          case "exit_entered":
            if (msg.data?.exitWall) {
              scenario.handleExitEntered(msg.data.exitWall);
            }
            break;
        }
        if (updates.length > 0) {
          for (const u of updates) {
            const response: StateUpdateMessage = {
              type: "state_update",
              events: [],
              playerHp: sim.getCombatant("player")?.health ?? 0,
              enemies: getEnemyStates(),
              scenario: u,
            };
            ws.send(JSON.stringify(response));
          }
        }
        break;
      }

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      case "list_games": {
        send(ws, { type: "games_listed", requestId: msg.requestId, games: listGames() });
        break;
      }

      case "list_sessions": {
        const sessions = await sessionStorage.list();
        send(ws, { type: "sessions_listed", requestId: msg.requestId, sessions });
        break;
      }

      case "start_session": {
        activePlugins = new Map();
        narrative.startNewSession(msg.gameId);
        if (msg.appearance) {
          narrative.updatePlayerAppearance(msg.appearance.model_id, msg.appearance.skin_path);
        }
        // Génesis de plugins shipped (F3): validación + projections. Un
        // manifest inválido aborta el arranque de sesión — fail-loud.
        try {
          const loaded = loadGamePluginManifests(GAMES_DIR, msg.gameId);
          activePlugins = activatePluginsForNewSession(narrative, loaded);
        } catch (err) {
          console.error("Bridge: plugin load failed on start_session:", err);
          send(ws, {
            type: "session_started",
            requestId: msg.requestId,
            ok: false,
            error: `plugin_load_failed: ${(err as Error).message ?? err}`,
          });
          break;
        }
        await aiClient.notifySessionStart(narrative.session_id, msg.gameId, false);
        await narrative.save();
        narrativeSubscribers.add(ws);
        send(ws, {
          type: "session_started",
          requestId: msg.requestId,
          ok: true,
          sessionId: narrative.session_id,
          gameId: narrative.game_id,
          isResume: false,
          state: narrative.toSessionData(),
        });
        // Dev-only shortcut: replay a cached bootstrap (world_map + first
        // scene) for the same gameId instead of paying the ~90 s LLM cost.
        // Gated by CONFIG.dev.cache_initial_scene; off in production.
        const cached = CONFIG.dev.cache_initial_scene
          ? initialSceneCache.get(msg.gameId)
          : null;
        if (cached) {
          console.log(
            `Bridge: initial_scene_cache HIT for gameId="${msg.gameId}" ` +
              `(cached_at=${cached.cached_at}); skipping LLM bootstrap`,
          );
          // Restore the world map that the narrative engine bootstrapped on
          // the cached run, then replay the scene through the normal
          // recordSceneLoaded + broadcastScene path so NPCs, exits and the
          // visited flag all line up.
          narrative.worldMap = WorldMapManager.fromSerialized(
            JSON.parse(JSON.stringify(cached.world_map)),
          );
          const cachedScene = JSON.parse(
            JSON.stringify(cached.scene),
          ) as Record<string, unknown>;
          const sceneId = String(cachedScene.room_id ?? `scene_${Date.now()}`);
          narrative.recordSceneLoaded(sceneId, cachedScene);
          await narrative.save();
          broadcastScene(sceneId, cachedScene, 0);
          await narrative.save();
          break;
        }

        // Generate the initial scene asynchronously and broadcast it as a
        // narrative_event so all subscribed clients render the same world.
        // Emit lifecycle hints so the client can show a loader instead of a
        // blank canvas while we wait on the LLM.
        const ctx = narrative.serializeForLlm(activePlugins);
        // Fresh session: ask the narrative engine to bootstrap the world map
        // (3-5 places + sites + links) via the map tools before it builds the
        // starting scene. Progressive expansion happens later, via the tools.
        ctx.bootstrap_world_map = true;
        const sceneStart = Date.now();
        const sessionGameId = msg.gameId;
        broadcastNarrative({
          type: "narrative_status",
          phase: "generating",
          kind: "scene",
          message: "Generando mundo inicial...",
        });
        aiClient.generateScene(ctx).then(async (res) => {
          const elapsedMs = Date.now() - sceneStart;
          if (!res.ok || !res.scene) {
            broadcastNarrative({
              type: "narrative_status",
              phase: "error",
              kind: "scene",
              message: `No se pudo generar la escena. ${res.error ?? "Revisa el motor narrativo."}`,
              elapsedMs,
            });
            return;
          }
          const sceneId = String(res.scene.room_id ?? `scene_${Date.now()}`);
          narrative.recordSceneLoaded(sceneId, res.scene);
          await narrative.save();
          // Snapshot the bootstrap before broadcastScene mutates the scene
          // with `exits`. Replays go through broadcastScene again, which
          // re-attaches exits from the restored world map.
          if (CONFIG.dev.cache_initial_scene) {
            try {
              initialSceneCache.set(
                sessionGameId,
                res.scene,
                narrative.worldMap.serialize(),
              );
              console.log(
                `Bridge: initial_scene_cache SET for gameId="${sessionGameId}"`,
              );
            } catch (cacheErr) {
              console.warn(
                `Bridge: initial_scene_cache SET failed for "${sessionGameId}":`,
                cacheErr,
              );
            }
          }
          broadcastScene(sceneId, res.scene, elapsedMs);
          // broadcastScene mutated the scene with `exits` — persist them.
          await narrative.save();
        }).catch((err) => {
          console.warn("Bridge: generate_scene failed:", err);
          broadcastNarrative({
            type: "narrative_status",
            phase: "error",
            kind: "scene",
            message: `Error: ${(err as Error).message ?? err}`,
            elapsedMs: Date.now() - sceneStart,
          });
        });
        break;
      }

      case "resume_session": {
        activePlugins = new Map();
        const ok = await narrative.loadSession(msg.sessionId);
        if (!ok) {
          send(ws, {
            type: "session_started",
            requestId: msg.requestId,
            ok: false,
            error: "session_not_found",
          });
          break;
        }
        // Bind de plugins shipped (F3): el slice vive en el save, el manifest
        // se relee del FS y se casa por id (integridad fail-loud).
        try {
          const loaded = loadGamePluginManifests(GAMES_DIR, narrative.game_id);
          activePlugins = bindPluginsForResume(narrative, loaded);
        } catch (err) {
          console.error("Bridge: plugin bind failed on resume_session:", err);
          send(ws, {
            type: "session_started",
            requestId: msg.requestId,
            ok: false,
            error: `plugin_integrity: ${(err as Error).message ?? err}`,
          });
          break;
        }
        await aiClient.notifySessionStart(narrative.session_id, narrative.game_id, true);
        narrativeSubscribers.add(ws);
        send(ws, {
          type: "session_started",
          requestId: msg.requestId,
          ok: true,
          sessionId: narrative.session_id,
          gameId: narrative.game_id,
          isResume: true,
          state: narrative.toSessionData(),
        });
        break;
      }

      case "delete_session": {
        const ok = await sessionStorage.delete(msg.sessionId);
        send(ws, { type: "session_deleted", requestId: msg.requestId, ok });
        break;
      }

      case "save_session": {
        const ok = await narrative.save();
        send(ws, { type: "session_saved", requestId: msg.requestId, ok });
        break;
      }

      case "dialogue_choice": {
        const eventId = narrative.recordDialogueEvent(
          msg.speaker,
          msg.chosenText,
          [],
          msg.choiceIndex,
          msg.freeText ?? "",
        );
        const ctx = narrative.serializeForLlm(activePlugins);
        const result = await aiClient.reportPlayerChoice({
          eventId,
          speaker: msg.speaker,
          chosenText: msg.chosenText,
          freeText: msg.freeText ?? "",
          context: ctx,
        });
        if (!result.ok) {
          console.warn(`Bridge: reportPlayerChoice failed for ${eventId}: ${result.error}`);
          broadcastNarrative({
            type: "narrative_status",
            phase: "error",
            kind: "consequences",
            message: `Narrative engine error: ${result.error}`,
          });
          break;
        }
        const consequences = result.consequences;
        const playerPos = store.state.player.pos;
        const dispatched = dispatchConsequences(narrative, eventId, consequences, {
          playerPosition: { x: playerPos[0], y: playerPos[1], z: playerPos[2] },
          playerForward: { x: 0, y: 0, z: -1 },
        });
        const pluginFx = runPluginTick(eventId, dispatched.pluginEvents);
        await narrative.save();
        broadcastNarrative({
          type: "narrative_event",
          eventId,
          consequences,
          effects: [...dispatched.effects, ...pluginFx],
        });
        break;
      }

      case "player_entered_place": {
        const placeId = msg.placeId;
        const place = narrative.worldMap.get(placeId);
        if (!place) {
          broadcastNarrative({
            type: "narrative_status",
            phase: "error",
            kind: "scene",
            message: `Lugar desconocido en el mapa: ${placeId}`,
          });
          break;
        }
        // Captured before the place becomes active, so we can fire player_left.
        const prevPlaceId = narrative.worldMap.serialize().active_place_id;

        // Already realized → re-activate and re-broadcast the cached scene.
        const cachedSceneId = place.realized_scene_id;
        if (cachedSceneId && narrative.scenes_loaded[cachedSceneId]) {
          const cachedScene = narrative.scenes_loaded[cachedSceneId].scene_data;
          // recordSceneLoaded re-activates the place AND (re-)registers the
          // scene's NPCs into entities so the narrative engine sees them.
          narrative.recordSceneLoaded(cachedSceneId, cachedScene);
          await narrative.save();
          broadcastScene(cachedSceneId, cachedScene);
          await fireMapTriggers(prevPlaceId, placeId);
          break;
        }

        // Lazy realize: ask the narrative engine for this place's low-level scene.
        const realizeCtx = narrative.serializeForLlm(activePlugins);
        realizeCtx.realize_place = {
          id: place.id,
          kind: place.kind,
          name: place.name,
          description: place.description,
          attrs: place.attrs,
          sites: narrative.worldMap.getChildren(placeId).map((s) => ({
            id: s.id,
            kind: s.kind,
            name: s.name,
            description: s.description,
          })),
          links: narrative.worldMap.getOutgoingLinks(placeId),
        };
        const realizeStart = Date.now();
        broadcastNarrative({
          type: "narrative_status",
          phase: "generating",
          kind: "scene",
          message: `Generando ${place.name}...`,
        });
        aiClient.generateScene(realizeCtx).then(async (res) => {
          const elapsedMs = Date.now() - realizeStart;
          if (!res.ok || !res.scene) {
            broadcastNarrative({
              type: "narrative_status",
              phase: "error",
              kind: "scene",
              message: `No se pudo generar ${place.name}. ${res.error ?? "Revisa el motor narrativo."}`,
              elapsedMs,
            });
            return;
          }
          const sceneId = String(
            res.scene.room_id ?? res.scene.scene_id ?? `scene_${Date.now()}`,
          );
          // Tag the scene with the place so recordSceneLoaded attaches it.
          res.scene.place_id = placeId;
          narrative.recordSceneLoaded(sceneId, res.scene);
          await narrative.save();
          broadcastScene(sceneId, res.scene, elapsedMs);
          await fireMapTriggers(prevPlaceId, placeId);
        }).catch((err) => {
          console.warn("Bridge: lazy realize failed:", err);
          broadcastNarrative({
            type: "narrative_status",
            phase: "error",
            kind: "scene",
            message: `Error: ${(err as Error).message ?? err}`,
            elapsedMs: Date.now() - realizeStart,
          });
        });
        break;
      }

      case "interact_entity": {
        // The player walked up to an NPC and pressed E. Report it to the
        // narrative engine via the same path as a dialogue choice; it replies
        // with consequences (a `dialogue` effect that opens the dialogue UI).
        //
        // Framing matters: a parenthetical stage direction like "(el jugador
        // inicia conversación con X)" reads as narration and nudges the engine
        // to answer with a story_update (3rd-person narration) instead of a
        // `dialogue` consequence — so the dialogue modal never opens. We send
        // an explicit first-person greeting as the player's line plus an
        // approach marker in chosen_text; the engine then naturally replies
        // AS the NPC. The MCP prompt's narrative_event section reinforces that
        // an approach/greeting MUST open with the NPC speaking.
        const approachLine = "Saludos. ¿Puedes hablar conmigo un momento?";
        const eventId = narrative.recordDialogueEvent(
          msg.entityName,
          "(el jugador se acerca y saluda)",
          [],
          -1,
          approachLine,
        );
        const ctx = narrative.serializeForLlm(activePlugins);
        const result = await aiClient.reportPlayerChoice({
          eventId,
          speaker: msg.entityName,
          chosenText: "(el jugador se acerca y saluda)",
          freeText: approachLine,
          context: ctx,
        });
        if (!result.ok) {
          console.warn(`Bridge: reportPlayerChoice (interact_entity ${msg.entityName}) failed: ${result.error}`);
          broadcastNarrative({
            type: "narrative_status",
            phase: "error",
            kind: "consequences",
            message: `Narrative engine error: ${result.error}`,
          });
          break;
        }
        const consequences = result.consequences;
        const playerPos = store.state.player.pos;
        const dispatched = dispatchConsequences(narrative, eventId, consequences, {
          playerPosition: { x: playerPos[0], y: playerPos[1], z: playerPos[2] },
          playerForward: { x: 0, y: 0, z: -1 },
        });
        const pluginFx = runPluginTick(eventId, dispatched.pluginEvents);
        await narrative.save();
        broadcastNarrative({
          type: "narrative_event",
          eventId,
          consequences,
          effects: [...dispatched.effects, ...pluginFx],
        });
        break;
      }

    }
  });

  ws.on("close", () => {
    narrativeSubscribers.delete(ws);
    console.log("Bridge: client disconnected");
  });
});

function getEnemyStates(): StateUpdateMessage["enemies"] {
  const result: StateUpdateMessage["enemies"] = [];
  // Iterate store enemies since we can't enumerate combatants map directly
  for (const e of store.state.enemies) {
    const c = sim.getCombatant(e.id);
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
