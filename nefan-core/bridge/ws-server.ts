/** WebSocket bridge — runs GameSimulation, communicates with Godot on :9877. */

import { WebSocketServer, WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import type { CombatConfig } from "../src/types.js";
import type { ClientMessage, StateUpdateMessage } from "../src/protocol/messages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 9877;

// Load combat config
const configPath = resolve(__dirname, "../data/combat_config.json");
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(configPath, "utf-8")),
);

const store = new GameStore();
let sim = new GameSimulation(config, store, Date.now());

// Add player
sim.addCombatant(
  createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
);

const wss = new WebSocketServer({ port: PORT });
console.log(`NEFan Logic Bridge listening on ws://localhost:${PORT}`);

wss.on("connection", (ws: WebSocket) => {
  console.log("Bridge: client connected");

  ws.on("message", (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "input": {
        const result = sim.tick(msg.delta, msg.inputs);

        // Build compact response
        const enemies: StateUpdateMessage["enemies"] = [];
        for (const [id, c] of Object.entries(sim)) {
          // Access combatants through getCombatant
        }

        const response: StateUpdateMessage = {
          type: "state_update",
          events: result.events,
          playerHp: sim.getCombatant("player")?.health ?? 0,
          enemies: getEnemyStates(),
        };

        ws.send(JSON.stringify(response));
        break;
      }

      case "load_room": {
        // Reset simulation for new room
        sim.reset();
        sim.addCombatant(
          createCombatant("player", store.state.player.hp, store.state.player.weapon_id,
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
        );

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
        ws.send(JSON.stringify({ type: "pong" }));
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
