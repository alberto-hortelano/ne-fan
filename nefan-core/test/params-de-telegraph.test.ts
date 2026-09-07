/** Los parámetros del aro del telegraph (#504, PR 4 de #241): con qué arma y
 *  con qué ataque se dibuja el círculo al que el jugador tiene que acercarse.
 *
 *  Se mide contra el `combat_config.json` REAL y contra los catálogos reales
 *  de los sistemas de combate, no contra fixtures inventadas: lo que sujeta
 *  este módulo es que el aro diga lo mismo que el sim, y el sim resuelve con
 *  ese fichero. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { paramsDeTelegraph } from "../src/combat/params-de-telegraph.js";
import { getEffectiveParams, loadConfig } from "../src/combat/combat-data.js";
import { combatRegistry } from "../src/combat/registry.js";
import type { AttackSpec } from "../src/combat/combat-system.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(
  JSON.parse(readFileSync(resolve(__dirname, "../data/combat_config.json"), "utf-8")),
);
const estandar = combatRegistry.create(undefined, config).attacks;
const basico = combatRegistry.create("basic", config).attacks;

describe("paramsDeTelegraph — un ataque del combat_config", () => {
  it("da EXACTAMENTE lo que el sim resuelve con esa arma (la misma función)", () => {
    for (const tipo of Object.keys(config.attack_types)) {
      for (const arma of ["unarmed", "short_sword", "war_hammer"]) {
        assert.deepEqual(
          paramsDeTelegraph(tipo, config, arma, estandar),
          getEffectiveParams(tipo, config.attack_types, config.weapons[arma]),
          `${tipo} con ${arma}`,
        );
      }
    }
  });

  it("el arma CAMBIA el aro: espada y manos difieren en los cinco ataques", () => {
    // Si no difirieran, el test de arriba pasaría con cualquier arma y este
    // módulo podría ignorar el parámetro sin que nadie se enterara.
    for (const tipo of Object.keys(config.attack_types)) {
      const espada = paramsDeTelegraph(tipo, config, "short_sword", estandar);
      const manos = paramsDeTelegraph(tipo, config, "unarmed", estandar);
      assert.notEqual(espada.optimal_distance, manos.optimal_distance, tipo);
    }
  });

  it("un arma que el config no conoce pega como las manos desnudas", () => {
    const desconocida = paramsDeTelegraph("quick", config, "espada_laser", estandar);
    assert.deepEqual(desconocida, paramsDeTelegraph("quick", config, "unarmed", estandar));
    assert.notDeepEqual(desconocida, paramsDeTelegraph("quick", config, "short_sword", estandar));
  });

  it("y `\"\"` (todavía sin frame del bridge) también", () => {
    assert.deepEqual(
      paramsDeTelegraph("heavy", config, "", estandar),
      paramsDeTelegraph("heavy", config, "unarmed", estandar),
    );
  });

  it("no depende del catálogo: con el catálogo VACÍO sale lo mismo", () => {
    assert.deepEqual(
      paramsDeTelegraph("medium", config, "short_sword", []),
      paramsDeTelegraph("medium", config, "short_sword", estandar),
    );
  });

  it("el config MANDA sobre el catálogo cuando los dos declaran el ataque", () => {
    // El catálogo estándar declara los cinco (con `displayRange` = distancia
    // óptima base). Si el orden se invirtiera, el aro pasaría a ser el
    // sintético y perdería los modificadores del arma.
    const quick = estandar.find((a) => a.id === "quick");
    assert.ok(quick, "el catálogo estándar declara quick");
    const p = paramsDeTelegraph("quick", config, "short_sword", estandar);
    assert.equal(p.optimal_distance, 1.3, "1.5 base − 0.2 de la espada");
    assert.notEqual(p.optimal_distance, quick.displayRange / 2);
    assert.equal(p.base_damage > 0, true, "un ataque del config trae daño, no cero");
  });
});

describe("paramsDeTelegraph — un ataque que solo existe en el catálogo", () => {
  const strike = basico.find((a) => a.id === "strike") as AttackSpec;

  it("el `strike` del combate básico no está en combat_config (si entrara, este bloque medía otra cosa)", () => {
    assert.ok(strike, "el sistema basic declara strike");
    assert.equal(config.attack_types["strike"], undefined);
  });

  it("el aro cubre [0, displayRange] y el radio del área es el alcance entero", () => {
    const p = paramsDeTelegraph("strike", config, "short_sword", basico);
    assert.equal(p.optimal_distance - p.distance_tolerance, 0, "el borde cercano cae a los pies");
    assert.equal(p.optimal_distance + p.distance_tolerance, strike.displayRange, "y el lejano, al alcance");
    assert.equal(p.optimal_distance, strike.displayRange / 2);
    assert.equal(p.area_radius, strike.displayRange);
  });

  it("daño, reducción y wind-up van a CERO: aquí no se conocen, los resuelve el sim", () => {
    const p = paramsDeTelegraph("strike", config, "short_sword", basico);
    assert.equal(p.base_damage, 0);
    assert.equal(p.damage_reduction, 0);
    assert.equal(p.wind_up_time, 0);
  });

  it("el arma NO toca el aro sintético: sin números en el config no hay modificador que aplicar", () => {
    assert.deepEqual(
      paramsDeTelegraph("strike", config, "war_hammer", basico),
      paramsDeTelegraph("strike", config, "unarmed", basico),
    );
  });

  it("el catálogo de OTRO sistema con el mismo id da SU alcance", () => {
    // `shoot` (12 m) frente a `strike` (2 m): el aro sale del spec que trae la
    // sesión, no de una tabla global.
    const disparo = combatRegistry.create("shooting", config).attacks.find((a) => a.id === "shoot");
    assert.ok(disparo);
    const p = paramsDeTelegraph("shoot", config, "unarmed", [disparo]);
    assert.equal(p.area_radius, disparo.displayRange);
    assert.notEqual(p.area_radius, strike.displayRange);
    // En metros y a mano, para que un `/ 3` en la mitad del alcance no pueda
    // salir verde por comparar la fórmula consigo misma.
    assert.equal(disparo.displayRange, 12);
    assert.equal(p.optimal_distance, 6);
    assert.equal(p.distance_tolerance, 6);
  });
});

describe("paramsDeTelegraph — el ataque que no está en ninguno de los dos", () => {
  it("lanza nombrando el ataque (no devuelve un aro inventado)", () => {
    assert.throws(
      () => paramsDeTelegraph("patada_voladora", config, "short_sword", basico),
      /patada_voladora/,
    );
  });

  it("con el catálogo vacío, el ataque del catálogo de OTRA sesión también lanza", () => {
    assert.throws(() => paramsDeTelegraph("strike", config, "short_sword", []), /strike/);
  });
});
