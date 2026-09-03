/** El DIAL del bosque: `density` en ejemplares/m², y su techo.
 *
 *  Dos cosas que el contrato le PROMETE al motor narrativo y que sin este
 *  fichero serían prosa:
 *
 *  1. **La curva se entrega**: si pide 0,05 ejemplares/m² sobre una zona,
 *     planta exactamente los que salen de multiplicar. Un dial que se queda
 *     corto en silencio no es un dial, es una sugerencia — y la ruta vieja
 *     saturaba en 12 árboles pidiera lo que pidiera.
 *  2. **Siempre queda camino**: la cota superior no la vigila un aserto a
 *     posteriori, la garantiza la geometría. Aquí se comprueba que la
 *     garantía es cierta sobre lo que el jugador colisiona de verdad —el grid
 *     rasterizado—, no solo sobre los centros. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveVolumesFromSchema } from "../src/scene/blueprint/derive.js";
import { treeTrunkRadiusCells, volumeCollisionGrid } from "../src/scene/blueprint/collision.js";
import {
  MAX_VEG_DENSITY,
  MIN_SEP_TREE,
  PASO_LIBRE_CELDAS,
  parseVegetationZones,
  sepEntreTroncos,
  VEG_TREE_S_MAX,
  zoneAreaM2,
  type VegetationZone,
} from "../src/scene/blueprint/vegetation.js";
import { BODY_RADIUS_M, NPC_RADIUS_M, PLAYER_RADIUS_M, celdasLibresParaRadio } from "../src/scene/terrain-collision.js";
import { TILE_CELLS, TILE_MPC, tileWorldRect } from "../src/scene/tile.js";
import type { Volume } from "../src/scene/blueprint/volumes.js";

type Area = VegetationZone["area"];

function planta(area: Area, density: number, seed = "tile_0_0", declared: Volume[] = []): Volume[] {
  const parsed = parseVegetationZones([{ type: "pino", area, density }]);
  assert.ok(parsed.ok, !parsed.ok ? parsed.error : "");
  return deriveVolumesFromSchema(
    { seed, vegetation_zones: parsed.ok ? parsed.zones : [] },
    declared,
  ).vegetation;
}

const arboles = (vs: Volume[]): Extract<Volume, { type: "tree" }>[] =>
  vs.filter((v): v is Extract<Volume, { type: "tree" }> => v.type === "tree");

/** Los tres anclajes que el contrato le enseña al motor, más los extremos. */
const CURVA = [0.01, 0.02, 0.04, 0.05, 0.06, MAX_VEG_DENSITY];
const ZONAS: Array<{ nombre: string; area: Area }> = [
  { nombre: "zona pequeña 46×26 (la de robledo_tile)", area: [2, 50, 46, 26] },
  { nombre: "zona media 64×64", area: [30, 30, 64, 64] },
  { nombre: "tile entero", area: "rest" },
];

describe("vegetation_zones · density es ejemplares/m² y se entrega EXACTA", () => {
  for (const zona of ZONAS) {
    for (const d of CURVA) {
      it(`${zona.nombre} @ ${d}/m² planta los que pide`, () => {
        const pedidos = Math.round(zoneAreaM2(zona.area) * d);
        // Tres seeds: si el objetivo solo se alcanzara con un sorteo
        // afortunado, la promesa del contrato dependería del tile.
        for (const seed of ["tile_0_0", "tile_1_-2", "tile_-3_4"]) {
          const puestos = planta(zona.area, d, seed).length;
          assert.equal(puestos, pedidos, `${seed}: pedidos ${pedidos}, puestos ${puestos}`);
        }
      });
    }
  }

  it("el techo del contrato es el que el zod deja pasar: 0.09 se rebota con la unidad y los anclajes", () => {
    const fuera = parseVegetationZones([{ type: "pino", area: "rest", density: MAX_VEG_DENSITY + 0.01 }]);
    assert.equal(fuera.ok, false);
    if (fuera.ok) return;
    assert.match(fuera.error, /EJEMPLARES POR m²/, fuera.error);
    assert.match(fuera.error, /pinar cerrado/, fuera.error);
    // Y el tope exacto SÍ pasa: un rango cuyo extremo se rechaza es un rango
    // mal escrito, y el motor lo descubriría a base de rebotes.
    assert.equal(parseVegetationZones([{ type: "pino", area: "rest", density: MAX_VEG_DENSITY }]).ok, true);
    assert.equal(parseVegetationZones([{ type: "pino", area: "rest", density: 0 }]).ok, false, "0 no es una zona");
  });

  it("una densidad vieja (fracción de celdas) ya no cuela: el campo cambió de unidad", () => {
    // `density: 0.5` significaba «la mitad de las celdas» en la ruta retirada.
    // Leído como ejemplares/m² serían 2.048 árboles en un tile: se rebota con
    // el motivo en vez de saturar callando, que es lo que hacía la ruta vieja.
    assert.equal(parseVegetationZones([{ type: "pino", area: "rest", density: 0.5 }]).ok, false);
    assert.equal(parseVegetationZones([{ type: "pino", area: "rest", density: 1 }]).ok, false);
  });

  it("el zod es el MISMO que compone el plan: un campo inventado se rebota", () => {
    // `.strict()`: una clave que la zona no declara no la lee nadie, así que
    // aceptarla sería prometer algo que no ocurre.
    assert.equal(parseVegetationZones([{ type: "pino", area: "rest", density: 0.02, color: "verde" }]).ok, false);
    assert.equal(parseVegetationZones([{ type: "pino", area: [0, 0, 200, 10], density: 0.02 }]).ok, false, "area fuera del tile");
    assert.equal(parseVegetationZones([{ type: "", area: "rest", density: 0.02 }]).ok, false, "sin planta no hay zona");
  });
});

describe("vegetation_zones · la cota deja SIEMPRE un camino", () => {
  /** La distancia mínima entre dos troncos sale de la geometría, no de una
   *  constante: dos radios de tronco más el paso libre del CUERPO MAYOR. Se
   *  derivaba solo del jugador (#289), o sea que dos árboles podían dejar un
   *  paso que él cruzaba y un NPC no. A mpc 0,5 el número no se mueve, pero la
   *  derivación sí, y es la derivación la que protege. */
  it("MIN_SEP_TREE se deriva del tronco y del CUERPO MAYOR, con la MISMA regla que el validador", () => {
    assert.equal(PASO_LIBRE_CELDAS, celdasLibresParaRadio(BODY_RADIUS_M, TILE_MPC));
    assert.equal(BODY_RADIUS_M, NPC_RADIUS_M, "el cuerpo mayor es el del NPC, no el del jugador");
    assert.ok(BODY_RADIUS_M > PLAYER_RADIUS_M);
    assert.equal(MIN_SEP_TREE, 2 * treeTrunkRadiusCells(VEG_TREE_S_MAX) + PASO_LIBRE_CELDAS);
    // El techo es la densidad cuya separación es exactamente ese suelo: por
    // encima, el suelo mandaría y el motor pediría lo que no se le puede dar.
    const sepDelTecho = 0.75 / (Math.sqrt(MAX_VEG_DENSITY) * TILE_MPC);
    assert.ok(sepDelTecho >= MIN_SEP_TREE, `sep en el techo ${sepDelTecho} < suelo ${MIN_SEP_TREE}`);
    const sepPasado = 0.75 / (Math.sqrt(MAX_VEG_DENSITY + 0.01) * TILE_MPC);
    assert.ok(sepPasado < MIN_SEP_TREE, "un escalón por encima del techo ya no cabría");
  });

  it("para toda densidad del rango y todo seed, ningún par de troncos se pisa el paso", () => {
    for (const d of CURVA) {
      for (const seed of ["tile_0_0", "tile_9_9", "tile_-7_3"]) {
        const ts = arboles(planta("rest", d, seed));
        for (let i = 0; i < ts.length; i++) {
          for (let j = i + 1; j < ts.length; j++) {
            const a = ts[i];
            const b = ts[j];
            const dist = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
            const exigida = sepEntreTroncos(treeTrunkRadiusCells(a.s ?? 1), treeTrunkRadiusCells(b.s ?? 1));
            assert.ok(
              dist >= exigida,
              `d=${d} ${seed}: ${a.id}${JSON.stringify(a.at)} y ${b.id}${JSON.stringify(b.at)} a ${dist.toFixed(2)} celdas (exigidas ${exigida.toFixed(2)})`,
            );
          }
        }
      }
    }
  });

  it("y también contra los árboles GRANDES que declara el motor a mano", () => {
    // Un roble declarado puede llegar a s=1.8: su tronco es más gordo, así que
    // el hueco que hay que dejarle es mayor. Con una separación fija (la del
    // par derivado) el pino de zona se le pegaría y cerraría el paso.
    const declarado: Volume[] = [
      { id: "roble", label: "roble", type: "tree", at: [64, 64], s: 1.8 },
    ];
    const puestos = arboles(planta("rest", MAX_VEG_DENSITY, "tile_0_0", declarado));
    const exigida = sepEntreTroncos(treeTrunkRadiusCells(1.8), treeTrunkRadiusCells(VEG_TREE_S_MAX));
    for (const v of puestos) {
      const dist = Math.hypot(v.at[0] - 64, v.at[1] - 64);
      assert.ok(dist >= exigida - 1e-9, `${v.id} a ${dist.toFixed(2)} del roble (exigidas ${exigida.toFixed(2)})`);
    }
  });

  it("en el GRID que colisiona el jugador, entre dos troncos vecinos caben dos celdas libres", () => {
    // La garantía no vale sobre los centros: vale sobre la máscara que
    // bloquea, que redondea el tronco a la celda entera. Se mide sobre el
    // bosque más cerrado que se puede pedir.
    const bosque = arboles(planta("rest", MAX_VEG_DENSITY, "tile_0_0"));
    const grid = volumeCollisionGrid(bosque, tileWorldRect(0, 0));
    assert.ok(grid, "un bosque cerrado tiene que marcar celdas");
    if (!grid) return;
    const solido = (c: number, r: number) => c >= 0 && r >= 0 && c < TILE_CELLS && r < TILE_CELLS && grid.grid[r][c] === "S";
    // Para cada pareja de vecinos cercanos, el corredor que los separa: se
    // recorre el segmento entre sus centros contando celdas libres seguidas.
    const anchoDelPasoCeldas = Math.ceil((2 * PLAYER_RADIUS_M) / TILE_MPC); // 2 celdas de AABB
    let peor = Infinity;
    for (let i = 0; i < bosque.length; i++) {
      for (let j = i + 1; j < bosque.length; j++) {
        const a = bosque[i];
        const b = bosque[j];
        const dist = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
        if (dist > MIN_SEP_TREE + 1) continue; // solo los vecinos que se tocan
        let libres = 0;
        const pasos = Math.ceil(dist * 4);
        for (let k = 0; k <= pasos; k++) {
          const t = k / pasos;
          const c = Math.floor(a.at[0] + (b.at[0] - a.at[0]) * t);
          const r = Math.floor(a.at[1] + (b.at[1] - a.at[1]) * t);
          if (!solido(c, r)) libres = Math.max(libres, contarLibresEnLinea(solido, a, b, t));
        }
        peor = Math.min(peor, libres);
        assert.ok(
          libres >= anchoDelPasoCeldas,
          `${a.id} y ${b.id} a ${dist.toFixed(2)} celdas dejan ${libres} celda(s) libres: el jugador mide ${anchoDelPasoCeldas}`,
        );
      }
    }
    assert.ok(peor === Infinity || peor >= anchoDelPasoCeldas, `el peor corredor deja ${peor} celdas`);
  });
});

/** Cuántas celdas libres SEGUIDAS hay en la línea entre dos troncos, alrededor
 *  del punto `t`. Se cuenta sobre la recta que los une, que es donde el
 *  corredor es más estrecho. */
function contarLibresEnLinea(
  solido: (c: number, r: number) => boolean,
  a: Extract<Volume, { type: "tree" }>,
  b: Extract<Volume, { type: "tree" }>,
  t: number,
): number {
  const dx = b.at[0] - a.at[0];
  const dy = b.at[1] - a.at[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = a.at[0] + dx * t;
  const py = a.at[1] + dy * t;
  const celdas = new Set<string>();
  for (let s = -6; s <= 6; s += 0.25) {
    const c = Math.floor(px + ux * s);
    const r = Math.floor(py + uy * s);
    if (solido(c, r)) {
      if (s < 0) celdas.clear();
      else break;
    } else {
      celdas.add(`${c},${r}`);
    }
  }
  return celdas.size;
}
