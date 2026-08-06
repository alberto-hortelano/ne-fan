/** Sistemas de combate alternativos del registry (basic y shooting): mismo
 *  contrato — catálogo de UN ataque, daño fijo, rechazo del catálogo estándar,
 *  IA enemiga con fallback al catálogo — parametrizado por sistema, más los
 *  casos propios de cada uno (facing en basic, cono frontal en shooting). */
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

type Vec = { x: number; y: number; z: number };
type PlayerLike = { position: Vec; forward: Vec };

function makeSim(systemId: string, store?: GameStore): GameSimulation {
  return new GameSimulation(config, store, 42, combatRegistry.create(systemId, config));
}

function tickIdle(sim: GameSimulation, player: PlayerLike, n: number): CombatEvent[] {
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

/** Un ataque completo: request + 30 ticks ≈ 0.48s (> wind-up de ambos sistemas). */
function fireAttack(sim: GameSimulation, player: PlayerLike, attackType: string): CombatEvent[] {
  const first = sim.tick(0.016, {
    playerPosition: player.position,
    playerForward: player.forward,
    playerMoving: false,
    attackRequested: true,
    attackType,
  });
  return [...first.events, ...tickIdle(sim, player, 30)];
}

interface SystemCase {
  id: string;
  attackId: string;
  damage: number;
  displayRange?: number;
  enemyId: string;
  /** Delante del player (forward −Z), dentro del alcance del sistema. */
  inRange: Vec;
  /** Delante del player pero fuera del alcance. */
  outOfRange: Vec;
  /** Posición del enemigo para el duelo IA (la IA encara al objetivo). */
  aiEnemyPos: Vec;
  /** HP del enemigo que muere en 3 ataques del player. */
  killableHp: number;
  personality: Record<string, unknown>;
}

const SYSTEMS: SystemCase[] = [
  {
    id: "basic",
    attackId: "strike",
    damage: 15,
    enemyId: "skeleton_01",
    inRange: { x: 0, y: 0, z: -1.5 },
    outOfRange: { x: 0, y: 0, z: -5 }, // fuera de los 2.0 m
    aiEnemyPos: { x: 0, y: 0, z: -1.5 },
    killableHp: 30,
    personality: { aggression: 1.0, preferred_attacks: ["quick", "medium"], reaction_time: 0.1 },
  },
  {
    id: "shooting",
    attackId: "shoot",
    damage: 20,
    displayRange: 12.0,
    enemyId: "droid_01",
    inRange: { x: 0, y: 0, z: -10 }, // lejos, pero justo delante
    outOfRange: { x: 0, y: 0, z: -15 }, // fuera de los 12 m
    aiEnemyPos: { x: 0, y: 0, z: -6 },
    killableHp: 40,
    // combat_range amplio como haría una personalidad spawneada para este sistema.
    personality: { aggression: 1.0, preferred_attacks: ["quick", "medium"], reaction_time: 0.1, combat_range: 10.0 },
  },
];

for (const sys of SYSTEMS) {
  describe(`${sys.id} combat system`, () => {
    it("exposes a single-attack catalog", () => {
      const combat = combatRegistry.create(sys.id, config);
      assert.equal(combat.attacks.length, 1);
      assert.equal(combat.attacks[0].id, sys.attackId);
      if (sys.displayRange !== undefined) {
        assert.equal(combat.attacks[0].displayRange, sys.displayRange);
      }
      assert.equal(combat.normalizeAttack(sys.attackId), sys.attackId);
      assert.equal(combat.normalizeAttack("quick"), null);
    });

    it("attack in range deals fixed damage and emits attack_landed", () => {
      const sim = makeSim(sys.id);
      const player = createCombatant("player", 100, "unarmed",
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
      const enemy = createCombatant(sys.enemyId, 60, "unarmed", sys.inRange);
      sim.addCombatant(player);
      sim.addCombatant(enemy);

      sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
        attackRequested: true,
        attackType: sys.attackId,
      });
      assert.equal(player.state, "winding_up");

      const events = tickIdle(sim, player, 30);
      const landed = events.filter((e) => e.type === "attack_landed");
      assert.equal(landed.length, 1);
      assert.equal(landed[0].targetId, sys.enemyId);
      assert.equal(landed[0].damage, sys.damage);
      assert.equal(enemy.health, 60 - sys.damage);
    });

    it("attack misses out of range", () => {
      const sim = makeSim(sys.id);
      const player = createCombatant("player", 100, "unarmed",
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
      const enemy = createCombatant(sys.enemyId, 60, "unarmed", sys.outOfRange);
      sim.addCombatant(player);
      sim.addCombatant(enemy);

      const events = fireAttack(sim, player, sys.attackId);
      assert.equal(events.filter((e) => e.type === "attack_landed").length, 0);
      assert.equal(enemy.health, 60);
    });

    it("rejects attack types from the standard catalog with a clear error", () => {
      const sim = makeSim(sys.id);
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
        new RegExp(`unknown attack type 'quick' for combat system '${sys.id}'`),
      );
    });

    it("enemy AI attacks with the catalog and can kill the player (store notified)", () => {
      const store = new GameStore();
      const sim = makeSim(sys.id, store);
      const player = createCombatant("player", 30, "unarmed",
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
      const enemy = createCombatant(sys.enemyId, 60, "unarmed",
        sys.aiEnemyPos, { x: 0, y: 0, z: 1 });
      sim.addCombatant(player);
      // La personalidad pide ataques estándar: el sistema los filtra y la IA
      // cae al catálogo del sistema.
      sim.addCombatant(enemy, sys.personality);

      const events = tickIdle(sim, player, 300);
      const started = events.filter((e) => e.type === "attack_started" && e.combatantId === sys.enemyId);
      assert.ok(started.length > 0, "enemy should attack");
      assert.ok(started.every((e) => e.attackType === sys.attackId), `enemy attacks must be ${sys.attackId}`);
      assert.equal(player.health, 0, "player should be dead after enough attacks");
      assert.ok(events.some((e) => e.type === "died" && e.combatantId === "player"));
      assert.equal(store.state.player.hp, 0, "store should reflect player death");
    });

    it("player can kill the enemy (enemy_died dispatched)", () => {
      const store = new GameStore();
      const sim = makeSim(sys.id, store);
      const player = createCombatant("player", 100, "unarmed",
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
      const enemy = createCombatant(sys.enemyId, sys.killableHp, "unarmed", sys.inRange);
      sim.addCombatant(player);
      sim.addCombatant(enemy);

      const all: CombatEvent[] = [];
      for (let round = 0; round < 3; round++) {
        all.push(...fireAttack(sim, player, sys.attackId));
      }
      assert.equal(enemy.health, 0);
      assert.ok(all.some((e) => e.type === "died" && e.combatantId === sys.enemyId));
    });
  });
}

describe("BasicCombatSystem (específicos)", () => {
  it("hits the target regardless of facing (no precision factor)", () => {
    const sim = makeSim("basic");
    // Player mirando en la dirección OPUESTA al enemigo.
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.0 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const events = fireAttack(sim, player, "strike");
    assert.equal(events.filter((e) => e.type === "attack_landed").length, 1);
    assert.equal(enemy.health, 45);
  });
});

describe("ShootingCombatSystem (específicos)", () => {
  it("shot misses a target outside the frontal cone", () => {
    const sim = makeSim("shooting");
    // Player mirando a -Z; enemigo en rango pero DETRÁS (+Z).
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("droid_01", 60, "unarmed",
      { x: 0, y: 0, z: 5 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const events = fireAttack(sim, player, "shoot");
    assert.equal(events.filter((e) => e.type === "attack_landed").length, 0);
    assert.equal(enemy.health, 60);
  });

  it("shot misses a target off to the side (>15°) even in range", () => {
    const sim = makeSim("shooting");
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    // A 45° del forward: dentro de rango, fuera del cono de 15°.
    const enemy = createCombatant("droid_01", 60, "unarmed",
      { x: 5, y: 0, z: -5 });
    sim.addCombatant(player);
    sim.addCombatant(enemy);

    const events = fireAttack(sim, player, "shoot");
    assert.equal(events.filter((e) => e.type === "attack_landed").length, 0);
    assert.equal(enemy.health, 60);
  });

  it("with two targets in the cone, the nearest one takes the hit", () => {
    const sim = makeSim("shooting");
    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const near = createCombatant("droid_near", 60, "unarmed",
      { x: 0, y: 0, z: -4 });
    const far = createCombatant("droid_far", 60, "unarmed",
      { x: 0, y: 0, z: -9 });
    sim.addCombatant(player);
    sim.addCombatant(near);
    sim.addCombatant(far);

    const events = fireAttack(sim, player, "shoot");
    const landed = events.filter((e) => e.type === "attack_landed");
    assert.equal(landed.length, 1);
    assert.equal(landed[0].targetId, "droid_near");
    assert.equal(near.health, 40);
    assert.equal(far.health, 60);
  });
});
