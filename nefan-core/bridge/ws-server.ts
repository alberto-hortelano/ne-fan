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
import type { CombatConfig } from "../src/types.js";
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

// Players currently subscribed to narrative events (broadcast targets).
const narrativeSubscribers = new Set<WebSocket>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastNarrative(msg: ServerMessage): void {
  for (const ws of narrativeSubscribers) send(ws, msg);
}

function listGames(): Array<{ game_id: string; title: string; description?: string }> {
  if (!existsSync(GAMES_DIR)) return [];
  const out: Array<{ game_id: string; title: string; description?: string }> = [];
  for (const entry of readdirSync(GAMES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const gameJson = resolve(GAMES_DIR, entry.name, "game.json");
    if (!existsSync(gameJson)) continue;
    try {
      const def = JSON.parse(readFileSync(gameJson, "utf-8")) as {
        game_id?: string;
        title?: string;
        description?: string;
      };
      out.push({
        game_id: def.game_id ?? entry.name,
        title: def.title ?? entry.name,
        description: def.description,
      });
    } catch {
      // skip malformed
    }
  }
  return out;
}

// Add player
sim.addCombatant(
  createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
);

const wss = new WebSocketServer({ port: PORT });
console.log(`NEFan Logic Bridge listening on ws://localhost:${PORT}`);

wss.on("connection", (ws: WebSocket) => {
  console.log("Bridge: client connected");

  ws.on("message", async (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
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
              store.dispatch("room_changed", {
                room_id: store.state.world.room_id,
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

        store.dispatch("room_changed", {
          room_id: msg.roomId,
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
          if (sceneData) {
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
          }
        }).catch((err) => {
          console.error(`Bridge: failed to load game '${msg.gameId}':`, err);
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
        narrative.startNewSession(msg.gameId);
        if (msg.appearance) {
          narrative.updatePlayerAppearance(msg.appearance.model_id, msg.appearance.skin_path);
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
        // Generate the initial scene asynchronously and broadcast it as a
        // narrative_event so all subscribed clients render the same world.
        const ctx = narrative.serializeForLlm();
        aiClient.generateScene(ctx).then(async (res) => {
          if (res.ok && res.scene) {
            const sceneId = String(res.scene.room_id ?? `scene_${Date.now()}`);
            narrative.recordSceneLoaded(sceneId, res.scene);
            await narrative.save();
            broadcastNarrative({
              type: "narrative_event",
              eventId: "scene_init",
              consequences: [],
              effects: [
                {
                  kind: "spawn_entity",
                  entityId: sceneId,
                  entityKind: "object",
                  description: String(res.scene.room_description ?? sceneId),
                  position: [0, 0, 0],
                  data: { scene: res.scene },
                  eventId: "scene_init",
                },
              ],
            });
          }
        }).catch((err) => {
          console.warn("Bridge: generate_scene failed:", err);
        });
        break;
      }

      case "resume_session": {
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
        const ctx = narrative.serializeForLlm();
        const consequences = await aiClient.reportPlayerChoice({
          eventId,
          speaker: msg.speaker,
          chosenText: msg.chosenText,
          freeText: msg.freeText ?? "",
          context: ctx,
        });
        const playerPos = store.state.player.pos;
        const dispatched = dispatchConsequences(narrative, eventId, consequences, {
          playerPosition: { x: playerPos[0], y: playerPos[1], z: playerPos[2] },
          playerForward: { x: 0, y: 0, z: -1 },
        });
        await narrative.save();
        broadcastNarrative({
          type: "narrative_event",
          eventId,
          consequences,
          effects: dispatched.effects,
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
