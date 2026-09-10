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
import { getEffectiveParams, loadConfig, motivoDeConfigInvalido } from "../src/combat/combat-data.js";
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

/** LO QUE EL CONFIG DEBE TRAER, y qué pasa si no lo trae (#241, PR 8).
 *
 *  `loadConfig` es la ÚNICA puerta del `combat_config.json`: la cruzan el
 *  bridge al arrancar y el cliente al montar el HUD y el paso del jugador. Los
 *  números del bloque `player` entraron aquí porque el cliente los tenía
 *  escritos a mano encima de los del config (`ARCADE_SPEED_SCALE`,
 *  `INTERACT_RANGE_M`), así que lo que hay que afirmar es que NO hay default:
 *  un `?? 2.2` escondido en la puerta sería la misma mentira por el otro lado
 *  —el config diciendo una cosa y el juego haciendo otra— y nadie se enteraría
 *  hasta jugar. */
describe("loadConfig · el config del jugador es obligatorio", () => {
  /** El de verdad, clonado, para poder quitarle cosas de una en una. */
  const bueno = () => JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;

  it("el combat_config.json REAL carga y trae los cuatro números del jugador", () => {
    const p = loadConfig(bueno()).player;
    assert.equal(typeof p.walk_speed, "number");
    assert.equal(typeof p.sprint_speed, "number");
    assert.equal(typeof p.speed_scale, "number");
    assert.equal(typeof p.interact_range_m, "number");
    // Y son los del juego: si alguien los cambia, este aserto lo dice.
    assert.deepEqual(
      { w: p.walk_speed, s: p.sprint_speed, e: p.speed_scale, i: p.interact_range_m },
      { w: 1.9, s: 3.8, e: 2.2, i: 2.5 },
    );
  });

  it("sin bloque `player` no hay partida: lanza nombrando lo que falta", () => {
    const sinJugador = bueno();
    delete sinJugador.player;
    assert.throws(() => loadConfig(sinJugador), /player/);
  });

  it("cada uno de los cuatro campos, por separado, es obligatorio", () => {
    for (const campo of ["walk_speed", "sprint_speed", "speed_scale", "interact_range_m"]) {
      const roto = bueno();
      delete (roto.player as Record<string, unknown>)[campo];
      assert.throws(
        () => loadConfig(roto),
        new RegExp(`player\\.${campo}`),
        `quitar player.${campo} tiene que fallar en la puerta, no a mitad de partida`,
      );
    }
  });

  it("un campo que no es un número finito tampoco pasa (ni string, ni null, ni NaN)", () => {
    for (const valor of ["2.2", null, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      const roto = bueno();
      (roto.player as Record<string, unknown>).speed_scale = valor;
      assert.throws(() => loadConfig(roto), /player\.speed_scale/, `${JSON.stringify(valor)} no es una velocidad`);
    }
  });

  it("el error nombra TODOS los campos que faltan, no solo el primero", () => {
    const roto = bueno();
    delete (roto.player as Record<string, unknown>).speed_scale;
    delete (roto.player as Record<string, unknown>).interact_range_m;
    assert.throws(() => loadConfig(roto), /player\.speed_scale, player\.interact_range_m/);
  });

  it("las tres secciones de siempre siguen siendo obligatorias", () => {
    for (const seccion of ["attack_types", "weapons", "tactical_matrix"]) {
      const roto = bueno();
      delete roto[seccion];
      assert.throws(() => loadConfig(roto), /attack_types, weapons y tactical_matrix/);
    }
  });

  /** #539-H5: el TIPO no era el criterio. `speed_scale: -1` (el jugador anda
   *  hacia atrás) e `interact_range_m: 0` (la `E` no alcanza a nadie) cargaban
   *  sin una queja, y el fallo no se veía en el arranque sino jugando: la tecla
   *  no hacía nada y no había dónde mirar. Un valor imposible es un error de
   *  configuración, y su sitio es la puerta. */
  it("los cuatro son ESTRICTAMENTE positivos: el 0 y el negativo no son configuraciones", () => {
    for (const campo of ["walk_speed", "sprint_speed", "speed_scale", "interact_range_m"]) {
      for (const valor of [0, -1, -0.0001]) {
        const roto = bueno();
        (roto.player as Record<string, unknown>)[campo] = valor;
        assert.throws(
          () => loadConfig(roto),
          new RegExp(`player\\.${campo} vale ${valor === 0 ? "0" : "-"}`),
          `player.${campo} = ${valor} tiene que fallar en la puerta`,
        );
      }
    }
  });

  it("el motivo del rango dice el campo, el valor, el fichero y QUÉ pasaría con él", () => {
    const roto = bueno();
    (roto.player as Record<string, unknown>).interact_range_m = 0;
    const motivo = motivoDeConfigInvalido(roto);
    assert.ok(motivo, "un alcance de 0 m no es un config válido");
    assert.match(motivo, /combat_config\.json/, "el jugador tiene que saber QUÉ fichero mirar");
    assert.match(motivo, /player\.interact_range_m vale 0/);
    assert.match(motivo, /mayor que 0/);
    assert.match(motivo, /la tecla E no alcanzaría a nadie/, "y qué le pasaría al jugar");
  });

  it("el config REAL no tiene motivo: `motivoDeConfigInvalido` devuelve null", () => {
    // Sin esto, «devuelve el motivo» podría estar devolviendo siempre algo.
    assert.equal(motivoDeConfigInvalido(bueno()), null);
  });

  it("`motivoDeConfigInvalido` y `loadConfig` son el MISMO criterio", () => {
    // Dos puertas con dos criterios es la enfermedad que este módulo cierra:
    // el cliente pinta lo que dice la primera y el bridge muere por la segunda.
    for (const romper of [
      (c: Record<string, unknown>) => delete c.weapons,
      (c: Record<string, unknown>) => delete (c.player as Record<string, unknown>).walk_speed,
      (c: Record<string, unknown>) => ((c.player as Record<string, unknown>).speed_scale = -2),
      (c: Record<string, unknown>) => ((c.player as Record<string, unknown>).sprint_speed = "rápido"),
    ]) {
      const roto = bueno();
      romper(roto);
      const motivo = motivoDeConfigInvalido(roto);
      assert.ok(motivo, "el criterio tiene que ver el config roto");
      assert.throws(() => loadConfig(roto), new RegExp(motivo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("`jump_velocity` no vuelve: se retiró sin lector (#539-H7)", () => {
    // El grep está a cero; lo que este aserto impide es que alguien lo
    // reintroduzca en el JSON creyendo que el juego lo lee.
    assert.equal((bueno().player as Record<string, unknown>).jump_velocity, undefined);
  });
});
