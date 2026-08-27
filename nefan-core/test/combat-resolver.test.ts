import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FRONT_COS,
  isInFront,
  calculateDistanceFactor,
  calculatePrecisionFactor,
  calculateOffsetFromAttackCenter,
  resolveAttack,
  applyDefensiveReduction,
} from "../src/combat/combat-resolver.js";
import { getEffectiveParams, loadConfig } from "../src/combat/combat-data.js";
import type { CombatConfig, EffectiveParams, Vec3 } from "../src/types.js";

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

  it("returns 0 when target is behind attacker (even within melee range)", () => {
    const weapon = config.weapons["unarmed"];
    const params = getEffectiveParams("medium", config.attack_types, weapon);

    // Objetivo A LA ESPALDA pero DENTRO del alcance (a optimal_distance): sin
    // el gate frontal daba calidad perfecta (offset 0). Debe ser 0 por estar
    // detrás, no por distancia.
    const damage = resolveAttack(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 }, // mirando a -Z
      { x: 0, y: 0, z: params.optimal_distance }, // a +Z: justo detrás, en alcance
      "idle",
      params,
      config.tactical_matrix,
      "medium",
    );
    assert.equal(damage, 0);
  });

  it("lands damage on a target directly in front at optimal distance", () => {
    const weapon = config.weapons["unarmed"];
    const params = getEffectiveParams("medium", config.attack_types, weapon);
    const damage = resolveAttack(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -params.optimal_distance }, // al frente, en alcance
      "idle",
      params,
      config.tactical_matrix,
      "medium",
    );
    assert.ok(damage > 0, `esperaba daño frontal > 0, fue ${damage}`);
  });
});

describe("el borde exacto del cono frontal", () => {
  // El cono es de ±60°, y su borde tiene que caer del MISMO lado en las dos
  // mitades del combate: `isInFront` decide el daño y `conoMargin` dibuja el
  // arco (`attack-area.ts`). Ambas dicen FUERA justo en el filo. La barrida
  // punto por punto de `attack-area.test.ts` no lo ve porque nunca aterriza en
  // el filo EXACTO: hay que construirlo.
  const atacante: Vec3 = { x: 0, y: 0, z: 0 };
  const mirandoA: Vec3 = { x: 0, y: 0, z: 1 };
  // A 60° del forward y a distancia 3: el coseno sale EXACTAMENTE FRONT_COS.
  const enElFilo: Vec3 = { x: 1.5 * Math.sqrt(3), y: 0, z: 1.5 };

  it("el punto de prueba está en el filo, no cerca de él", () => {
    // La precondición se AFIRMA: si un día la aritmética flotante deja de dar
    // el 0.5 clavado, este test tiene que ponerse rojo diciendo que ya no está
    // midiendo el borde — no seguir verde midiendo un punto cualquiera.
    const dirZ = enElFilo.z / Math.hypot(enElFilo.x, enElFilo.z);
    assert.equal(dirZ, FRONT_COS, "el punto de prueba ya no cae en el borde del cono");
  });

  it("justo en el filo NO se golpea: el borde es de fuera", () => {
    assert.equal(isInFront(mirandoA, atacante, enElFilo), false);
  });

  it("un pelo por dentro sí", () => {
    assert.equal(isInFront(mirandoA, atacante, { x: 1.4 * Math.sqrt(3), y: 0, z: 1.5 }), true);
  });
});

describe("un config degenerado no produce NaN", () => {
  // `distance_tolerance` sale tal cual del JSON y `area_radius` de multiplicar
  // por un modificador del arma: los dos son editables sin recompilar, así que
  // un 0 es escribible. Sin la guarda, la fórmula divide por él y el daño sale
  // NaN — que no es 0 ni es un número, y viaja hasta los puntos de vida.
  it("tolerancia de distancia nula: 0 de calidad, no NaN", () => {
    assert.equal(calculateDistanceFactor(5, 5, 0), 0);
    assert.equal(calculateDistanceFactor(7, 5, 0), 0);
  });

  it("radio de área nulo: 0 de calidad, no NaN", () => {
    assert.equal(calculatePrecisionFactor(0, 0), 0);
    assert.equal(calculatePrecisionFactor(3, 0), 0);
  });

  it("y el ataque entero sale 0, con el objetivo clavado delante", () => {
    const params: EffectiveParams = {
      optimal_distance: 2,
      distance_tolerance: 1,
      area_radius: 0,
      base_damage: 40,
      damage_reduction: 0,
      wind_up_time: 0,
    };
    const damage = resolveAttack(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -2 },
      "idle",
      params,
      { quick: { idle: 1 } },
      "quick",
    );
    assert.equal(Number.isNaN(damage), false, "el daño no puede ser NaN");
    assert.equal(damage, 0);
  });
});

describe("el daño es el PRODUCTO de los cuatro factores", () => {
  // Los tests de integración de arriba solo miran el signo (>0 / ===0), y con
  // eso una fórmula que dividiera por el daño base o por el factor táctico
  // seguiría dando un número positivo. Aquí se afirma el valor exacto, con los
  // cuatro factores distintos de 1 para que ninguno pueda esconderse.
  const params: EffectiveParams = {
    optimal_distance: 2,
    distance_tolerance: 1,
    area_radius: 1,
    base_damage: 40,
    damage_reduction: 0,
    wind_up_time: 0,
  };

  it("distancia × precisión × táctica × daño base", () => {
    const damage = resolveAttack(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -2.5 }, // desviación 0.5 de tolerancia 1 ⇒ distancia 0.5
      "block",
      params,
      { quick: { block: 0.5 } }, // táctica 0.5
      "quick",
    );
    // 0.5 (distancia) × 1 (precisión, offset 0) × 0.5 (táctica) × 40 = 10
    assert.equal(damage, 10);
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
