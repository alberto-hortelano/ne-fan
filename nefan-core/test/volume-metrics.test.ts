/** Huella y altura de un volumen: la métrica que comparten el manifest del
 *  greybox, la colisión declarada y la ambientación de la vista fps.
 *
 *  Por qué existe este fichero. `volumeFootprintCells` y `volumeHeightM`
 *  vivían dentro del builder del PLATÓ y su única cobertura directa era
 *  `stage-greybox.test.ts`, que muere con el proscenio. Al bajarlas a
 *  `blueprint/volume-metrics.ts` su invariante baja con ellas, y deja de
 *  depender de una suite condenada.
 *
 *  El invariante caro es el PRIMERO: la huella que publica el manifest tiene
 *  que contener lo que de verdad bloquea el paso. Cuando divergen no se rompe
 *  nada de golpe — el jugador choca con aire, o atraviesa una torre, y nadie
 *  sabe por qué. Ya mordió una vez: la torre usaba `r ?? 3` en la huella y
 *  `r ?? 6` en la colisión (ver el comentario de `volumeSolidDiscRadiusCells`). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  volumeFootprintCells,
  volumeHeightM,
} from "../src/scene/blueprint/volume-metrics.js";
import { rotatedRectCorners } from "../src/scene/blueprint/footprint.js";
import {
  volumeCollisionGrid,
  volumeSolidDiscRadiusCells,
} from "../src/scene/blueprint/collision.js";
import type { Volume } from "../src/scene/blueprint/volumes.js";
import type { WorldRect } from "../src/scene/tile.js";

/** Tile de 64 m centrado en el origen: el grid de colisión es 128×128 @0,5 m
 *  y sus índices de celda son las MISMAS unidades que declara el volumen. */
const RECT: WorldRect = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };

/** Celdas que la colisión declara sólidas para un volumen suelto. */
function celdasSolidas(v: Volume): [number, number][] {
  const g = volumeCollisionGrid([v], RECT);
  if (!g) return [];
  const solido = g.solid_chars![0];
  const out: [number, number][] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) if (g.grid[r][c] === solido) out.push([c, r]);
  }
  return out;
}

/** Celdas sólidas que caen FUERA de la huella del manifest.
 *
 *  La huella es continua (`[c0, r0, w, h]` con decimales) y la colisión
 *  trabaja por celdas enteras, que marca redondeando hacia AFUERA: la
 *  comparación honesta es contra la huella redondeada hacia afuera también.
 *  Es la versión PERMISIVA del invariante — si aun así sobra una celda, la
 *  divergencia es de metros, no de redondeo. */
function celdasFueraDeLaHuella(v: Volume): [number, number][] {
  const fp = volumeFootprintCells(v);
  assert.ok(fp, "un volumen con colisión no puede quedarse sin huella");
  const [c0, r0, w, d] = fp;
  const cMin = Math.floor(c0);
  const rMin = Math.floor(r0);
  const cMax = Math.ceil(c0 + w) - 1;
  const rMax = Math.ceil(r0 + d) - 1;
  return celdasSolidas(v).filter(([c, r]) => c < cMin || c > cMax || r < rMin || r > rMax);
}

/** Casa ABIERTA EN CORTE con una puerta en el muro sur. `cutaway` porque es la
 *  ÚNICA rama en la que la colisión talla las `doors` (`collision.ts`: un
 *  cuerpo cerrado es un bloque macizo, puerta o no); sin él este ejemplar
 *  llevaba una puerta que nadie tallaba. Lo que la puerta hace de verdad lo
 *  sujeta su propio `it()` más abajo, no la tabla: el invariante de la tabla
 *  («huella ⊇ sólidos») no puede romperse QUITANDO sólidos. */
const CASA_PUERTA: Volume = {
  id: "casa_puerta", label: "casa con puerta", type: "building", rect: [50, 50, 8, 6], cutaway: true,
  doors: [{ edge: "s", at: 4, w: 2 }],
};

/** Un ejemplar de cada tipo del union, con sus variantes que ramifican
 *  (`angle` en building y prop, prop por rect y por punto, building en corte).
 *  `bush` entra aunque no colisione: su ausencia de la colisión es parte del
 *  contrato. */
const EJEMPLARES: Array<[string, Volume]> = [
  ["building", { id: "casa", label: "casa", type: "building", rect: [50, 50, 8, 6], wall_h: 5 }],
  ["building con angle", { id: "casa_giro", label: "casa girada", type: "building", rect: [50, 50, 8, 6], wall_h: 5, angle: 20 }],
  ["building con puerta", CASA_PUERTA],
  ["wall", { id: "muralla", label: "muralla en L", type: "wall", points: [[40, 40], [56, 40], [56, 56]], width: 3, h: 5 }],
  ["tower", { id: "torre", label: "torre del homenaje", type: "tower", at: [60, 60] }],
  ["tower con r", { id: "torreta", label: "torreta", type: "tower", at: [60, 60], r: 4 }],
  ["tree", { id: "roble", label: "roble", type: "tree", at: [60, 60] }],
  ["tree pequeño", { id: "arbolillo", label: "arbolillo", type: "tree", at: [60, 60], s: 0.4 }],
  ["tree grande", { id: "roble_viejo", label: "roble viejo", type: "tree", at: [60, 60], s: 1.8 }],
  ["bush", { id: "matorral", label: "matorral", type: "bush", at: [60, 60] }],
  ["rock", { id: "roca", label: "roca", type: "rock", at: [60, 60], s: 1.5 }],
  ["fountain", { id: "fuente", label: "fuente de la plaza", type: "fountain", at: [60, 60] }],
  ["prop con rect", { id: "carro", label: "carro de heno", type: "prop", shape: "box", rect: [50, 50, 4, 2], h: 2 }],
  ["prop con rect y angle", { id: "carro_giro", label: "carro atravesado", type: "prop", shape: "box", rect: [50, 50, 4, 2], h: 2, angle: 35 }],
  ["prop por punto", { id: "barril", label: "barril", type: "prop", shape: "cylinder", at: [60, 60], h: 1.5 }],
  ["prism", { id: "arco", label: "arco de piedra", type: "prism", points: [[50, 50], [58, 50], [58, 56], [50, 56]], h: 6 }],
  ["custom", { id: "noria", label: "noria", type: "custom", at: [60, 60], parts: [{ shape: "box", size: [4, 3, 2] }, { shape: "cylinder", rBottom: 2, h: 3, pos: [3, 0, 0] }] }],
  ["gate", { id: "porton", label: "portón", type: "gate", at: [60, 60], w: 8, orient: "x" }],
];

describe("huella del volumen", () => {
  it("cubre TODOS los tipos del union (si alguien añade uno, este fichero se entera)", () => {
    const tipos = new Set(EJEMPLARES.map(([, v]) => v.type));
    assert.deepEqual(
      [...tipos].sort(),
      ["building", "bush", "custom", "fountain", "gate", "prism", "prop", "rock", "tower", "tree", "wall"].sort(),
      "faltan tipos en EJEMPLARES",
    );
  });

  for (const [nombre, v] of EJEMPLARES) {
    it(`${nombre}: la huella contiene toda celda que la colisión bloquea`, () => {
      const fuera = celdasFueraDeLaHuella(v);
      assert.deepEqual(
        fuera,
        [],
        `${fuera.length} celdas sólidas fuera de la huella ${JSON.stringify(volumeFootprintCells(v))} — ` +
          `el jugador choca donde el manifest dice que no hay nada (primera: ${JSON.stringify(fuera[0])})`,
      );
    });
  }

  it("el matorral no bloquea el paso — y por eso su huella no tiene que contener nada", () => {
    assert.deepEqual(celdasSolidas({ id: "m", label: "matorral", type: "bush", at: [60, 60] }), []);
  });

  // La PUERTA estuvo congelada aquí como deuda: `volumeFootprintCells`
  // publicaba el VANO y la colisión estampaba las JAMBAS, y las dos huellas
  // eran DISJUNTAS (36 celdas sólidas, 0 dentro). Arreglada en #187 delegando
  // en `volumeFootprint`, sube a EJEMPLARES y la cubre el mismo `it()`
  // paramétrico que los otros diez. Lo que se queda aquí es lo que aquel test
  // congelado NO comprobaba: que sigue habiendo jambas que bloquear —una
  // huella que contiene «nada» cumpliría el invariante sin significar nada— y
  // que el VANO, que es el hueco por el que se cruza, sigue abierto.
  it("la puerta tiene jambas que bloquean y un vano por el que se cruza", () => {
    const puerta: Volume = { id: "porton", label: "portón", type: "gate", at: [60, 60], w: 8, orient: "x" };
    const solidas = celdasSolidas(puerta);
    assert.equal(solidas.length, 36, "las jambas siguen ahí");
    assert.deepEqual(celdasFueraDeLaHuella(puerta), [], "y todas caen DENTRO de la huella publicada");
    // El centro del vano (at) no lo bloquea ninguna: por ahí se pasa.
    assert.equal(solidas.filter(([c, r]) => c === 60 && r === 60).length, 0, "el vano sigue abierto");
  });

  // El mismo control para la puerta de un BUILDING, que es otra rama de la
  // colisión (`doors` de `cutaway`, no `gate`). Sin esto la tabla salía verde
  // con la puerta quitada, movida fuera del muro o con la casa cerrada (QA de
  // #231b, H2): un caso de UN elemento no distingue una regla de su contraria.
  it("la puerta de un building en corte abre su vano; cerrada o sin puerta, esas celdas son muro", () => {
    // Las cuatro celdas del vano: `at: 4, w: 2` sobre el muro sur (grosor 1,5)
    // del rect [50, 50, 8, 6] → columnas 54-55, filas 54-55.
    const vano: [number, number][] = [[54, 54], [55, 54], [54, 55], [55, 55]];
    const solidasEnElVano = (v: Volume) =>
      celdasSolidas(v).filter(([c, r]) => vano.some(([vc, vr]) => vc === c && vr === r)).length;
    assert.equal(solidasEnElVano(CASA_PUERTA), 0, "con la casa en corte, por la puerta se pasa");
    assert.equal(solidasEnElVano({ ...CASA_PUERTA, doors: [] }), vano.length, "sin puerta, ahí hay muro");
    assert.equal(
      solidasEnElVano({ ...CASA_PUERTA, cutaway: false }),
      vano.length,
      "cerrada es un bloque macizo: la misma puerta no talla nada",
    );
    // Y el resto de la casa sigue en pie: solo se van las cuatro del vano.
    assert.equal(celdasSolidas({ ...CASA_PUERTA, doors: [] }).length - celdasSolidas(CASA_PUERTA).length, vano.length);
  });
});

describe("la huella de los discos sólidos sale del mismo radio que la colisión", () => {
  // Los cuatro que delegan en `volumeSolidDiscRadiusCells`. Es el arco que ya
  // se rompió una vez (r ?? 3 aquí, r ?? 6 allí) y el único que no se puede
  // dejar a la vista de un ojo humano: los dos defaults se leen igual de bien.
  const DISCOS: Array<[string, Volume]> = [
    ["tower", { id: "t", label: "torre", type: "tower", at: [60, 60] }],
    ["rock", { id: "r", label: "roca", type: "rock", at: [60, 60], s: 1.5 }],
    ["fountain", { id: "f", label: "fuente", type: "fountain", at: [60, 60] }],
    ["prop por punto", { id: "p", label: "barril", type: "prop", shape: "cylinder", at: [60, 60], h: 1.5 }],
  ];

  for (const [nombre, v] of DISCOS) {
    it(`${nombre}: la huella es el cuadrado circunscrito a ESE radio`, () => {
      const r = volumeSolidDiscRadiusCells(v);
      assert.ok(typeof r === "number", `${nombre} debe ser un disco sólido uniforme`);
      const at = (v as Extract<Volume, { at: [number, number] }>).at;
      assert.deepEqual(volumeFootprintCells(v), [at[0] - r, at[1] - r, 2 * r, 2 * r]);
    });
  }

  it("el árbol NO sale de ahí: la copa se dibuja ancha y solo colisiona el tronco", () => {
    const roble: Volume = { id: "a", label: "roble", type: "tree", at: [60, 60], s: 1 };
    assert.equal(volumeSolidDiscRadiusCells(roble), null);
    // Huella 3.2 celdas de lado (la copa) contra un tronco de 0,9 de radio.
    assert.deepEqual(volumeFootprintCells(roble), [58.4, 58.4, 3.2, 3.2]);
  });

  it("un prop CON rect tampoco: su huella es el rect declarado, no un disco", () => {
    const carro: Volume = { id: "c", label: "carro", type: "prop", shape: "box", rect: [50, 50, 4, 2], h: 2 };
    assert.equal(volumeSolidDiscRadiusCells(carro), null);
    assert.deepEqual(volumeFootprintCells(carro), [50, 50, 4, 2]);
  });

  it("un prop sin rect y sin at no tiene huella razonable: null, no un cero que engaña", () => {
    assert.equal(volumeFootprintCells({ id: "x", label: "nada", type: "prop", h: 1 } as Volume), null);
  });
});

describe("huella de un rect girado", () => {
  it("un building con angle da el AABB de rotatedRectCorners, no el rect original", () => {
    const rect: [number, number, number, number] = [50, 50, 8, 6];
    const casa: Volume = { id: "casa", label: "casa girada", type: "building", rect, wall_h: 5, angle: 20 };
    const esquinas = rotatedRectCorners(rect, 20);
    const us = esquinas.map(([u]) => u);
    const vs = esquinas.map(([, v]) => v);
    const esperado = [
      Math.min(...us),
      Math.min(...vs),
      Math.max(...us) - Math.min(...us),
      Math.max(...vs) - Math.min(...vs),
    ];
    assert.deepEqual(volumeFootprintCells(casa), esperado);
    // Y girar ENSANCHA: si esto dejara de cumplirse, el AABB no sería tal.
    const recto = volumeFootprintCells({ ...casa, angle: undefined } as Volume)!;
    assert.ok(esperado[2] > recto[2] && esperado[3] > recto[3], "el AABB de un rect girado es mayor");
  });

  it("angle 0 es la identidad: la huella es el rect tal cual", () => {
    const casa: Volume = { id: "c", label: "casa", type: "building", rect: [50, 50, 8, 6], wall_h: 5, angle: 0 };
    assert.deepEqual(volumeFootprintCells(casa), [50, 50, 8, 6]);
  });

  it("un prop con rect y angle sigue la misma regla que el building", () => {
    const rect: [number, number, number, number] = [50, 50, 4, 2];
    const carro: Volume = { id: "c", label: "carro", type: "prop", shape: "box", rect, h: 2, angle: 35 };
    const fp = volumeFootprintCells(carro)!;
    assert.ok(fp[2] > 4 && fp[3] > 2, "girado ocupa más planta que el rect declarado");
  });
});

describe("altura del volumen", () => {
  const mpc = 0.5;

  it("un edificio a dos aguas levanta más que uno de tejado plano", () => {
    const base = { id: "c", label: "casa", type: "building" as const, rect: [0, 0, 8, 6] as [number, number, number, number], wall_h: 5 };
    const plano = volumeHeightM({ ...base, roof: { kind: "flat" } } as Volume, mpc);
    const gable = volumeHeightM({ ...base, roof: { kind: "gable" } } as Volume, mpc);
    assert.equal(plano, 5 * mpc + 0.3);
    assert.equal(gable, 5 * mpc * 1.5);
    assert.ok(gable > plano);
  });

  it("sin tejado declarado, a dos aguas — es el default del builder", () => {
    const casa: Volume = { id: "c", label: "casa", type: "building", rect: [0, 0, 8, 6], wall_h: 5 };
    assert.equal(volumeHeightM(casa, mpc), volumeHeightM({ ...casa, roof: { kind: "gable" } } as Volume, mpc));
  });

  it("`derive` puede invertir la altura de un edificio: h = wall_h·mpc·1.5", () => {
    // derive.ts:179 despeja wall_h = h/(1.5·mpc) para reconstruir un volumen
    // desde una entity con `h` en metros. Si la fórmula cambiara aquí, el
    // round-trip se torcería en silencio.
    const wallH = 7;
    const casa: Volume = { id: "c", label: "casa", type: "building", rect: [0, 0, 8, 6], wall_h: wallH, roof: { kind: "gable" } };
    const h = volumeHeightM(casa, mpc);
    assert.equal(h / (1.5 * mpc), wallH);
  });

  it("el tejado a dos aguas nunca añade menos de un metro, por bajo que sea el muro", () => {
    // wall_h 1 con mpc 0.5 son 0,5 m de muro: el 50 % daría 0,25 y el
    // caballete se perdería. El Math.max(1, …) es el suelo.
    const chabola: Volume = { id: "c", label: "chabola", type: "building", rect: [0, 0, 4, 4], wall_h: 1 };
    assert.equal(volumeHeightM(chabola, mpc), 0.5 + 1);
  });

  it("un muro almenado levanta 40 cm más que el mismo muro liso", () => {
    const liso: Volume = { id: "m", label: "muro", type: "wall", points: [[0, 0], [10, 0]], h: 5 };
    assert.equal(volumeHeightM(liso, mpc), 2.5);
    assert.equal(volumeHeightM({ ...liso, crenellated: true } as Volume, mpc), 2.9);
  });

  it("los defaults en CELDAS escalan con mpc: torre, puerta, muro, prop", () => {
    const dobles = (v: Volume) => volumeHeightM(v, 1) / volumeHeightM(v, 0.5);
    assert.equal(volumeHeightM({ id: "t", label: "torre", type: "tower", at: [0, 0] }, 0.5), 12 * 0.5 + 0.5);
    assert.equal(volumeHeightM({ id: "g", label: "puerta", type: "gate", at: [0, 0], orient: "x" }, 0.5), 8 * 0.5);
    assert.ok(dobles({ id: "g", label: "puerta", type: "gate", at: [0, 0], orient: "x" }) === 2, "la puerta es celdas puras");
    assert.equal(volumeHeightM({ id: "p", label: "barril", type: "prop", shape: "cylinder", at: [0, 0] }, 0.5), 2 * 0.5);
    assert.equal(volumeHeightM({ id: "m", label: "arco", type: "prism", points: [[0, 0], [4, 0], [4, 4]], h: 6 }, 0.5), 3);
  });

  it("árbol, arbusto, roca y fuente vienen ya en METROS: mpc no los toca", () => {
    // Asimetría real del contrato y fácil de romper al reordenar el switch.
    // `derive.ts:173` depende de ella (s = h/4.83, sin mpc por ningún lado).
    const vegetales: Volume[] = [
      { id: "a", label: "roble", type: "tree", at: [0, 0], s: 1 },
      { id: "b", label: "matorral", type: "bush", at: [0, 0], s: 1 },
      { id: "r", label: "roca", type: "rock", at: [0, 0], s: 1 },
      { id: "f", label: "fuente", type: "fountain", at: [0, 0] },
    ];
    for (const v of vegetales) {
      assert.equal(volumeHeightM(v, 0.5), volumeHeightM(v, 1), `${v.type} no debe escalar con mpc`);
      assert.equal(volumeHeightM(v, 0.5), volumeHeightM(v, 2.5), `${v.type} no debe escalar con mpc`);
    }
    assert.ok(Math.abs(volumeHeightM(vegetales[0], 0.5) - 4.83) < 0.01, "la constante que invierte derive.ts");
  });

  it("el tamaño del árbol escala su altura, y `derive` la invierte con 4.83", () => {
    const roble = (s: number): Volume => ({ id: "a", label: "roble", type: "tree", at: [0, 0], s });
    assert.ok(volumeHeightM(roble(1.8), 0.5) > volumeHeightM(roble(1), 0.5));
    const h = volumeHeightM(roble(1.4), 0.5);
    assert.ok(Math.abs(h / 4.83 - 1.4) < 1e-9, "s = h/4.83 (derive.ts:173)");
  });

  it("un custom mide lo que su pieza MÁS ALTA, no la suma ni la primera", () => {
    const noria: Volume = {
      id: "n", label: "noria", type: "custom", at: [0, 0],
      parts: [
        { shape: "box", size: [4, 2, 2] },
        { shape: "box", size: [1, 6, 1], pos: [3, 0, 0] },
        { shape: "box", size: [2, 1, 2], pos: [-3, 0, 0] },
      ],
    };
    assert.equal(volumeHeightM(noria, 0.5), 3, "la pieza de 6 celdas manda: 6·0,5");
  });

  it("una altura declarada gana al default en todos los tipos que la admiten", () => {
    assert.equal(volumeHeightM({ id: "t", label: "torre", type: "tower", at: [0, 0], h: 20 }, 0.5), 20 * 0.5 + 0.5);
    assert.equal(volumeHeightM({ id: "g", label: "puerta", type: "gate", at: [0, 0], orient: "x", h: 4 }, 0.5), 2);
    assert.equal(volumeHeightM({ id: "p", label: "barril", type: "prop", shape: "cylinder", at: [0, 0], h: 3 }, 0.5), 1.5);
    assert.equal(volumeHeightM({ id: "m", label: "muro", type: "wall", points: [[0, 0], [4, 0]], h: 9 }, 0.5), 4.5);
  });

  it("ningún tipo mide cero o menos: una altura nula es un volumen invisible", () => {
    for (const [nombre, v] of EJEMPLARES) {
      const h = volumeHeightM(v, 0.5);
      assert.ok(h > 0 && Number.isFinite(h), `${nombre} mide ${h}`);
    }
  });
});
