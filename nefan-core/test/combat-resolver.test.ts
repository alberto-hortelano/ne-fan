import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  calculateDistanceFactor,
  calculatePrecisionFactor,
  calculateOffsetFromAttackCenter,
  resolveAttack,
  applyDefensiveReduction,
} from "../src/combat/combat-resolver.js";
import { getEffectiveParams, loadConfig } from "../src/combat/combat-data.js";
import type { CombatConfig, Vec3 } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../data/combat_config.json");
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(configPath, "utf-8")),
);

describe("calculateDistanceFactor", () => {
  it("returns 1.0 at optimal distance", () => {
    assert.equal(calculateDistanceFactor(1.5, 1.5, 1.0), 1.0);
  });

  it("returns 0.0 at edge of tolerance", () => {
    assert.equal(calculateDistanceFactor(2.5, 1.5, 1.0), 0.0);
  });

  it("returns 0.5 at half tolerance", () => {
    assert.equal(calculateDistanceFactor(2.0, 1.5, 1.0), 0.5);
  });

  it("returns 0.0 beyond tolerance", () => {
    assert.equal(calculateDistanceFactor(10.0, 1.5, 1.0), 0.0);
  });
});

describe("calculatePrecisionFactor", () => {
  it("returns 1.0 at center", () => {
    assert.equal(calculatePrecisionFactor(0, 1.0), 1.0);
  });

  it("returns 0.0 at edge", () => {
    assert.equal(calculatePrecisionFactor(1.0, 1.0), 0.0);
  });

  it("returns 0.5 at half radius", () => {
    assert.equal(calculatePrecisionFactor(0.5, 1.0), 0.5);
  });
});

describe("calculateOffsetFromAttackCenter", () => {
  it("returns 0 when defender is directly ahead", () => {
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const fwd: Vec3 = { x: 0, y: 0, z: -1 };
    const def: Vec3 = { x: 0, y: 0, z: -2 };
    assert.ok(calculateOffsetFromAttackCenter(pos, fwd, def) < 0.001);
  });

  it("returns positive when defender is to the side", () => {
    const pos: Vec3 = { x: 0, y: 0, z: 0 };
    const fwd: Vec3 = { x: 0, y: 0, z: -1 };
    const def: Vec3 = { x: 2, y: 0, z: -2 };
    assert.ok(calculateOffsetFromAttackCenter(pos, fwd, def) > 1.0);
  });
});

describe("getEffectiveParams with combat_config.json", () => {
  it("merges quick attack + short_sword correctly", () => {
    const weapon = config.weapons["short_sword"];
    const params = getEffectiveParams("quick", config.attack_types, weapon);

    // base quick: base_damage=15
    // short_sword modifiers for quick: damage_multiplier=1.3
    assert.equal(params.base_damage, 15 * 1.3);
    assert.ok(params.wind_up_time > 0);
  });

  it("merges heavy attack + war_hammer correctly", () => {
    const weapon = config.weapons["war_hammer"];
    const params = getEffectiveParams("heavy", config.attack_types, weapon);

    // war_hammer: wind_up_modifier=1.2, heavy: wind_up_time=1.4 (doubled for testing)
    // heavy mod: wind_up_multiplier=1.0
    const expectedWindUp = 1.4 * 1.2 * 1.0;
    assert.ok(Math.abs(params.wind_up_time - expectedWindUp) < 0.001);
  });
});

describe("resolveAttack integration", () => {
  it("returns positive damage at optimal range facing target", () => {
    const weapon = config.weapons["short_sword"];
    const params = getEffectiveParams("quick", config.attack_types, weapon);

    const damage = resolveAttack(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -1.5 },
      "idle",
      params,
      config.tactical_matrix,
      "quick",
    );

    assert.ok(damage > 0, `expected positive damage, got ${damage}`);
  });

  it("returns 0 damage when target is out of range", () => {
    const weapon = config.weapons["unarmed"];
    const params = getEffectiveParams("quick", config.attack_types, weapon);

    const damage = resolveAttack(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -20 },
      "idle",
      params,
      config.tactical_matrix,
      "quick",
    );

    assert.equal(damage, 0);
  });

  it("returns 0 when target is behind attacker", () => {
    const weapon = config.weapons["unarmed"];
    const params = getEffectiveParams("medium", config.attack_types, weapon);

    const damage = resolveAttack(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 5 }, // behind
      "idle",
      params,
      config.tactical_matrix,
      "medium",
    );

    // At 5m distance with optimal ~1.5 and tolerance ~1.0, distance factor = 0
    assert.equal(damage, 0);
  });
});

describe("applyDefensiveReduction", () => {
  it("reduces damage by percentage", () => {
    assert.equal(applyDefensiveReduction(100, 0.5), 50);
  });

  it("clamps reduction to 0-1", () => {
    assert.equal(applyDefensiveReduction(100, 1.5), 0);
    assert.equal(applyDefensiveReduction(100, -0.5), 100);
  });
});
