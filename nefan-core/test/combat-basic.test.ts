import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { combatRegistry } from "../src/combat/registry.js";
import { GameStore } from "../src/store/game-store.js";
import type { CombatConfig, CombatEvent } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(resolve(__dirname, "../data/combat_config.json"), "utf-8")),
);

function basicSim(store?: GameStore): GameSimulation {
  return new GameSimulation(config, store, 42, combatRegistry.create("basic", config));
}

function tickIdle(sim: GameSimulation, player: { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } }, n: number): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (let i = 0; i < n; i++) {
    const result = sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
    });
    events.push(...result.events);
  }
  return events;
}

describe("BasicCombatSystem", () => {
  it("exposes a single-attack catalog", () => {
    const combat = combatRegistry.create("basic", config);
    assert.equal(combat.attacks.length, 1);
    assert.equal(combat.attacks[0].id, "strike");
    assert.equal(combat.normalizeAttack("strike"), "strike");
    assert.equal(combat.normalizeAttack("quick"), null);
  });

  it("strike in range deals fixed damage and emits attack_landed", () => {
    const sim = basicSim();
    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.5 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "strike",
    });
    assert.equal(player.state, "winding_up");

    const events = tickIdle(sim, player, 30); // 0.48s > 0.35s de wind-up
    const landed = events.filter((e) => e.type === "attack_landed");
    assert.equal(landed.length, 1);
    assert.equal(landed[0].targetId, "skeleton_01");
    assert.equal(landed[0].damage, 15);
    assert.equal(enemy.health, 45);
  });

  it("strike misses out of range", () => {
    const sim = basicSim();
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -5 }); // fuera de los 2.0 m
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "strike",
    });
    const events = tickIdle(sim, player, 30);
    assert.equal(events.filter((e) => e.type === "attack_landed").length, 0);
    assert.equal(enemy.health, 60);
  });

  it("hits the target regardless of facing (no precision factor)", () => {
    const sim = basicSim();
    // Player mirando en la dirección OPUESTA al enemigo.
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.0 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "strike",
    });
    const events = tickIdle(sim, player, 30);
    assert.equal(events.filter((e) => e.type === "attack_landed").length, 1);
    assert.equal(enemy.health, 45);
  });

  it("rejects attack types from the standard catalog with a clear error", () => {
    const sim = basicSim();
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    sim.addCombatant(player);

    assert.throws(
      () => sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
        attackRequested: true,
        attackType: "quick",
      }),
      /unknown attack type 'quick' for combat system 'basic'/,
    );
  });

  it("enemy AI attacks with strike and can kill the player (store notified)", () => {
    const store = new GameStore();
    const sim = basicSim(store);
    const player = createCombatant("player", 30, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 });
    sim.addCombatant(player);
    sim.addCombatant(enemy, {
      aggression: 1.0,
      // La personalidad pide ataques estándar: el sistema básico los filtra
      // y la IA cae al catálogo (strike).
      preferred_attacks: ["quick", "medium"],
      reaction_time: 0.1,
    });

    const events = tickIdle(sim, player, 300);
    const started = events.filter((e) => e.type === "attack_started" && e.combatantId === "skeleton_01");
    assert.ok(started.length > 0, "enemy should attack");
    assert.ok(started.every((e) => e.attackType === "strike"), "enemy attacks must be strike");
    assert.equal(player.health, 0, "player should be dead after enough strikes");
    assert.ok(events.some((e) => e.type === "died" && e.combatantId === "player"));
    assert.equal(store.state.player.hp, 0, "store should reflect player death");
  });

  it("player can kill the enemy (enemy_died dispatched)", () => {
    const store = new GameStore();
    const sim = basicSim(store);
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 30, "unarmed",
      { x: 0, y: 0, z: -1.0 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const all: CombatEvent[] = [];
    for (let round = 0; round < 3; round++) {
      const r = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
        attackRequested: true,
        attackType: "strike",
      });
      all.push(...r.events);
      all.push(...tickIdle(sim, player, 30));
    }
    assert.equal(enemy.health, 0);
    assert.ok(all.some((e) => e.type === "died" && e.combatantId === "skeleton_01"));
  });
});

describe("GameSimulation.setCombatSystem", () => {
  it("swaps the system after reset()", () => {
    const sim = new GameSimulation(config, undefined, 42);
    assert.equal(sim.combatSystem.id, "standard");
    sim.reset();
    sim.setCombatSystem(combatRegistry.create("basic", config));
    assert.equal(sim.combatSystem.id, "basic");
  });

  it("refuses to swap with live enemy AIs (they capture the system)", () => {
    const sim = new GameSimulation(config, undefined, 42);
    sim.addCombatant(createCombatant("player"));
    sim.addCombatant(createCombatant("skeleton_01"), { aggression: 0.5 });
    assert.throws(
      () => sim.setCombatSystem(combatRegistry.create("basic", config)),
      /call reset\(\) first/,
    );
  });
});
