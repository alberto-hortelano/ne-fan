/** WebSocket bridge — runs GameSimulation + ScenarioRunner, communicates with Godot on :9877. */

import { WebSocketServer, WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { ScenarioRunner } from "../src/scenario/scenario-runner.js";
import type { CombatConfig } from "../src/types.js";
import type { ClientMessage, StateUpdateMessage } from "../src/protocol/messages.js";
import type { ScenarioUpdate } from "../src/scenario/scenario-types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve paths relative to project root (works from both src/ and dist/)
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "data").replace("/dist/data", "/data");
const PORT = 9877;
const GAMES_DIR = resolve(dataDir, "games");

// Load combat config
const configPath = resolve(dataDir, "combat_config.json");
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(configPath, "utf-8")),
);

const store = new GameStore();
let sim = new GameSimulation(config, store, Date.now());
const scenario = new ScenarioRunner();

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
    }
  });

  ws.on("close", () => {
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
