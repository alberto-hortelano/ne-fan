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

function shootingSim(store?: GameStore): GameSimulation {
  return new GameSimulation(config, store, 42, combatRegistry.create("shooting", config));
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

function shoot(sim: GameSimulation, player: { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } }): CombatEvent[] {
  const first = sim.tick(0.016, {
    playerPosition: player.position,
    playerForward: player.forward,
    playerMoving: false,
    attackRequested: true,
    attackType: "shoot",
  });
  // 30 ticks ≈ 0.48s > 0.15s de wind-up.
  return [...first.events, ...tickIdle(sim, player, 30)];
}

describe("ShootingCombatSystem", () => {
  it("exposes a single-attack catalog", () => {
    const combat = combatRegistry.create("shooting", config);
    assert.equal(combat.attacks.length, 1);
    assert.equal(combat.attacks[0].id, "shoot");
    assert.equal(combat.attacks[0].displayRange, 12.0);
    assert.equal(combat.normalizeAttack("shoot"), "shoot");
    assert.equal(combat.normalizeAttack("quick"), null);
  });

  it("shot in range and inside the cone deals fixed damage", () => {
    const sim = shootingSim();
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("droid_01", 60, "unarmed",
      { x: 0, y: 0, z: -10 }); // lejos, pero justo delante
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const events = shoot(sim, player);
    const landed = events.filter((e) => e.type === "attack_landed");
    assert.equal(landed.length, 1);
    assert.equal(landed[0].targetId, "droid_01");
    assert.equal(landed[0].damage, 20);
    assert.equal(enemy.health, 40);
  });

  it("shot misses out of range", () => {
    const sim = shootingSim();
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("droid_01", 60, "unarmed",
      { x: 0, y: 0, z: -15 }); // fuera de los 12 m
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const events = shoot(sim, player);
    assert.equal(events.filter((e) => e.type === "attack_landed").length, 0);
    assert.equal(enemy.health, 60);
  });

  it("shot misses a target outside the frontal cone", () => {
    const sim = shootingSim();
    // Player mirando a -Z; enemigo en rango pero DETRÁS (+Z).
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("droid_01", 60, "unarmed",
      { x: 0, y: 0, z: 5 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const events = shoot(sim, player);
    assert.equal(events.filter((e) => e.type === "attack_landed").length, 0);
    assert.equal(enemy.health, 60);
  });

  it("shot misses a target off to the side (>15°) even in range", () => {
    const sim = shootingSim();
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    // A 45° del forward: dentro de rango, fuera del cono de 15°.
    const enemy = createCombatant("droid_01", 60, "unarmed",
      { x: 5, y: 0, z: -5 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const events = shoot(sim, player);
    assert.equal(events.filter((e) => e.type === "attack_landed").length, 0);
    assert.equal(enemy.health, 60);
  });

  it("with two targets in the cone, the nearest one takes the hit", () => {
    const sim = shootingSim();
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const near = createCombatant("droid_near", 60, "unarmed",
      { x: 0, y: 0, z: -4 });
    const far = createCombatant("droid_far", 60, "unarmed",
      { x: 0, y: 0, z: -9 });
    sim.addCombatant(player);
    sim.addCombatant(near);
    sim.addCombatant(far);

    const events = shoot(sim, player);
    const landed = events.filter((e) => e.type === "attack_landed");
    assert.equal(landed.length, 1);
    assert.equal(landed[0].targetId, "droid_near");
    assert.equal(near.health, 40);
    assert.equal(far.health, 60);
  });

  it("rejects attack types from the standard catalog with a clear error", () => {
    const sim = shootingSim();
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
      /unknown attack type 'quick' for combat system 'shooting'/,
    );
  });

  it("enemy AI shoots and can kill the player (store notified)", () => {
    const store = new GameStore();
    const sim = shootingSim(store);
    const player = createCombatant("player", 30, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    // La IA encara siempre al objetivo (updateMovement), así que dispara
    // dentro de su cono; combat_range amplio como haría una personalidad
    // spawneada para este sistema.
    const enemy = createCombatant("droid_01", 60, "unarmed",
      { x: 0, y: 0, z: -6 }, { x: 0, y: 0, z: 1 });
    sim.addCombatant(player);
    sim.addCombatant(enemy, {
      aggression: 1.0,
      // Personalidad con ataques estándar: el sistema los filtra y la IA cae
      // al catálogo (shoot).
      preferred_attacks: ["quick", "medium"],
      reaction_time: 0.1,
      combat_range: 10.0,
    });

    const events = tickIdle(sim, player, 300);
    const started = events.filter((e) => e.type === "attack_started" && e.combatantId === "droid_01");
    assert.ok(started.length > 0, "enemy should shoot");
    assert.ok(started.every((e) => e.attackType === "shoot"), "enemy attacks must be shoot");
    assert.equal(player.health, 0, "player should be dead after enough shots");
    assert.ok(events.some((e) => e.type === "died" && e.combatantId === "player"));
    assert.equal(store.state.player.hp, 0, "store should reflect player death");
  });

  it("player can kill the enemy (enemy_died dispatched)", () => {
    const store = new GameStore();
    const sim = shootingSim(store);
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("droid_01", 40, "unarmed",
      { x: 0, y: 0, z: -8 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const all: CombatEvent[] = [];
    for (let round = 0; round < 3; round++) {
      all.push(...shoot(sim, player));
    }
    assert.equal(enemy.health, 0);
    assert.ok(all.some((e) => e.type === "died" && e.combatantId === "droid_01"));
  });
});
