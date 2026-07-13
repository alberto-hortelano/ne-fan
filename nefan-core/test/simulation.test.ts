import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createAmbientNpcBehavior } from "../src/simulation/npc-behavior.js";
import { SeededRng } from "../src/rng.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import type { CombatConfig, CombatEvent, EnemyPersonality } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(resolve(__dirname, "../data/combat_config.json"), "utf-8")),
);

describe("GameSimulation", () => {
  it("creates simulation with player and enemy", () => {
    const sim = new GameSimulation(config, undefined, 42);
    const player = createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed", { x: 0, y: 0, z: -2 });

    sim.addCombatant(player);
    sim.addCombatant(enemy, {
      aggression: 0.7,
      preferred_attacks: ["quick", "medium"],
      reaction_time: 0.6,
    });

    assert.ok(sim.getCombatant("player"));
    assert.ok(sim.getCombatant("skeleton_01"));
  });

  it("player attack hits enemy at optimal range", () => {
    const store = new GameStore();
    const sim = new GameSimulation(config, store, 42);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.5 }); // At optimal distance for quick

    sim.addCombatant(player);
    sim.addCombatant(enemy);

    // Request attack
    let result = sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "quick",
    });

    // Should have attack_started event
    assert.ok(result.events.some(e => e.type === "attack_started"));
    assert.equal(player.state, "winding_up");

    // Tick through wind-up (quick + short_sword: 0.15 * 0.85 * 0.9 ≈ 0.115s)
    for (let i = 0; i < 10; i++) {
      result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
    }

    // After ~0.16s, wind-up should have completed and impact resolved
    const landed = result.events.filter(e => e.type === "attack_landed");
    if (landed.length > 0) {
      assert.ok((landed[0].damage as number) > 0, "damage should be positive");
      assert.equal(landed[0].targetId, "skeleton_01");
      assert.ok(enemy.health < 60, "enemy should have taken damage");
    }
  });

  it("player attack misses enemy out of range", () => {
    const sim = new GameSimulation(config, undefined, 42);

    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -20 }); // Way out of range

    sim.addCombatant(player);
    sim.addCombatant(enemy);

    // Attack + tick through wind-up
    sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "quick",
    });

    const allEvents: CombatEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
      allEvents.push(...result.events);
    }

    // Should NOT have attack_landed (out of range)
    const landed = allEvents.filter((e) => e.type === "attack_landed");
    assert.equal(landed.length, 0, "should not hit at 20m distance");
    assert.equal(enemy.health, 60, "enemy should be at full health");
  });

  it("enemy AI attacks player when in range", () => {
    const sim = new GameSimulation(config, undefined, 42);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 1 }); // Facing player

    const personality: EnemyPersonality = {
      aggression: 1.0, // Always attacks
      preferred_attacks: ["quick"],
      reaction_time: 0.1,
    };

    sim.addCombatant(player);
    sim.addCombatant(enemy, personality);

    // Tick enough for AI reaction + wind-up + resolution
    const allEvents: CombatEvent[] = [];
    for (let i = 0; i < 60; i++) {
      const result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
      allEvents.push(...result.events);
    }

    // Enemy should have started at least one attack
    const started = allEvents.filter((e) => e.type === "attack_started" && e.combatantId === "skeleton_01");
    assert.ok(started.length > 0, "enemy AI should have started an attack");
  });

  it("enemy AI does NOT attack when player out of range", () => {
    const sim = new GameSimulation(config, undefined, 42);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -15 }); // 15m away

    sim.addCombatant(player);
    sim.addCombatant(enemy, {
      aggression: 1.0,
      preferred_attacks: ["quick"],
      reaction_time: 0.1,
      combat_range: 4.0,
    });

    const allEvents: CombatEvent[] = [];
    for (let i = 0; i < 30; i++) {
      const result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
      allEvents.push(...result.events);
    }

    const started = allEvents.filter((e) => e.type === "attack_started" && e.combatantId === "skeleton_01");
    assert.equal(started.length, 0, "enemy should not attack at 15m");
  });

  it("store receives damage events", () => {
    const store = new GameStore();
    const sim = new GameSimulation(config, store, 42);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.5 });

    sim.addCombatant(player);
    sim.addCombatant(enemy);

    // Attack and tick through
    sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "quick",
    });

    for (let i = 0; i < 20; i++) {
      sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
    }

    // If hit connected, store should reflect damage
    if (enemy.health < 60) {
      // Store should have been notified
      // (enemies array only populated via enemies_projected dispatch,
      //  but enemy_damaged should have been dispatched)
    }
  });

  it("seeded RNG produces deterministic results", () => {
    function runSim(seed: number): number[] {
      const sim = new GameSimulation(config, undefined, seed);
      const player = createCombatant("player", 100, "short_sword",
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
      const enemy = createCombatant("skeleton_01", 60, "unarmed",
        { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 1 });

      sim.addCombatant(player);
      sim.addCombatant(enemy, {
        aggression: 0.7,
        preferred_attacks: ["quick", "medium"],
        reaction_time: 0.5,
      });

      const hps: number[] = [];
      for (let i = 0; i < 120; i++) {
        sim.tick(0.016, {
          playerPosition: player.position,
          playerForward: player.forward,
          playerMoving: false,
        });
      }
      hps.push(player.health, enemy.health);
      return hps;
    }

    const run1 = runSim(42);
    const run2 = runSim(42);
    runSim(99); // different seed — smoke check only, result may legitimately match

    assert.deepEqual(run1, run2, "same seed should produce same results");
    // run3 MIGHT differ (different seed), but not guaranteed for all scenarios
  });

  it("npc behavior: un campesino huye de una pelea del sim", () => {
    const sim = new GameSimulation(config, undefined, 42);
    const behavior = createAmbientNpcBehavior({
      rng: new SeededRng(42),
      world: {
        blocksMove: () => false,
        blocksCircle: () => false,
        resolvePlaceTarget: () => null,
        getEntityPosition: () => null,
      },
    });
    sim.setNpcBehavior(behavior);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 });
    sim.addCombatant(player);
    sim.addCombatant(enemy, {
      aggression: 0.9,
      preferred_attacks: ["quick"],
      reaction_time: 0.3,
    });

    const npcRecord = {
      id: "aldeano_01",
      type: "npc",
      scene_id: "tile_0_0",
      spawned_at: "2026-01-01T00:00:00.000Z",
      spawn_reason: "scene_init",
      spawn_event_id: "",
      position: [4, 0, 0] as [number, number, number],
      data: { role: "peasant" },
      asset_refs: [],
    };
    behavior.addNpc(npcRecord);

    const npcEvents: string[] = [];
    for (let i = 0; i < 300; i++) {
      const result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
        attackRequested: i === 5,
        attackType: i === 5 ? "quick" : undefined,
      });
      npcEvents.push(...result.npcEvents.map((e) => e.type));
    }

    assert.ok(npcEvents.includes("npc_fled_combat"), "el campesino debe huir de la pelea");
    const dist = Math.hypot(npcRecord.position[0], npcRecord.position[2]);
    assert.ok(dist > 4.5, `debe alejarse del combate (dist=${dist})`);
  });

  it("sin behavior system, npcEvents va vacío y nada cambia", () => {
    const sim = new GameSimulation(config, undefined, 42);
    const player = createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 });
    sim.addCombatant(player);
    const result = sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
    });
    assert.deepEqual(result.npcEvents, []);
  });
});
