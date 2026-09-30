/** Tests de la colisión analítica de volúmenes: huellas en espacio de mundo,
 *  independientes de la perspectiva pintada. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { volumeCollisionGrid } from "../src/scene/blueprint/index.js";
import type { Volume } from "../src/scene/blueprint/index.js";
import { TILE_CELLS } from "../src/scene/tile.js";

const RECT = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };

function solidAt(grid: string[], c: number, r: number): boolean {
  return grid[r][c] === "S";
}

/** ¿Se llega andando de `a` a `b`? Relleno 4-conexo por celdas libres: es la
 *  pregunta del jugador («¿puedo entrar por ahí?»), no la de una celda suelta. */
function alcanzable(grid: string[], a: [number, number], b: [number, number]): boolean {
  if (solidAt(grid, a[0], a[1]) || solidAt(grid, b[0], b[1])) return false;
  const visto = new Set<number>([a[1] * grid[0].length + a[0]]);
  const cola: Array<[number, number]> = [a];
  while (cola.length > 0) {
    const [c, r] = cola.pop()!;
    if (c === b[0] && r === b[1]) return true;
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as const) {
      if (nr < 0 || nc < 0 || nr >= grid.length || nc >= grid[0].length) continue;
      const k = nr * grid[0].length + nc;
      if (visto.has(k) || solidAt(grid, nc, nr)) continue;
      visto.add(k);
      cola.push([nc, nr]);
    }
  }
  return false;
}

describe("blueprint/collision", () => {
  it("tile vacío → null", () => {
    assert.equal(volumeCollisionGrid([], RECT), null);
  });

  it("bush no bloquea; prop passable tampoco", () => {
    const vols: Volume[] = [
      { id: "m", label: "mata", type: "bush", at: [20, 20] },
      { id: "t", label: "toldo", type: "prop", at: [40, 40], shape: "box", passable: true },
    ];
    assert.equal(volumeCollisionGrid(vols, RECT), null);
  });

  it("building cutaway: anillo de muros con hueco de puerta, interior libre", () => {
    const vols: Volume[] = [
      {
        id: "casa",
        label: "casa",
        type: "building",
        rect: [20, 20, 20, 16],
        cutaway: true,
        doors: [{ edge: "s", at: 8, w: 4 }],
      },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(g);
    assert.equal(g.cols, TILE_CELLS);
    assert.deepEqual(g.origin, [-32, -32]);
    assert.ok(solidAt(g.grid, 30, 20), "muro norte");
    assert.ok(solidAt(g.grid, 20, 28), "muro oeste");
    assert.ok(solidAt(g.grid, 39, 28), "muro este");
    assert.ok(solidAt(g.grid, 24, 35), "muro sur (fuera de la puerta)");
    assert.ok(!solidAt(g.grid, 30, 35), "hueco de puerta sur (at=8..12 → col 28..32)");
    assert.ok(!solidAt(g.grid, 30, 28), "interior libre");
  });

  it("building CON techo: escenografía — huella completamente sólida, la puerta es decorativa", () => {
    const vols: Volume[] = [
      {
        id: "casa",
        label: "casa",
        type: "building",
        rect: [20, 20, 20, 16],
        roof: { kind: "gable" },
        doors: [{ edge: "s", at: 8, w: 4 }],
      },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(g);
    assert.ok(solidAt(g.grid, 30, 28), "interior sólido");
    assert.ok(solidAt(g.grid, 30, 35), "sin hueco de puerta");
    assert.ok(solidAt(g.grid, 20, 20) && solidAt(g.grid, 39, 35), "esquinas sólidas");
    assert.ok(!solidAt(g.grid, 19, 28) && !solidAt(g.grid, 40, 28), "fuera de la huella libre");
  });

  it("wall + gate: la banda bloquea y el vano queda libre", () => {
    const vols: Volume[] = [
      { id: "muro", label: "muralla", type: "wall", points: [[0, 68], [128, 68]], width: 6, h: 7 },
      { id: "puerta", label: "puerta", type: "gate", at: [64, 68], w: 9, orient: "x" },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(solidAt(g.grid, 20, 68), "muro bloquea");
    assert.ok(solidAt(g.grid, 110, 66), "muro bloquea (banda)");
    assert.ok(!solidAt(g.grid, 64, 68), "vano central libre");
    assert.ok(!solidAt(g.grid, 62, 66), "vano libre en todo el grosor");
    assert.ok(solidAt(g.grid, 56, 68), "jamba oeste sólida");
  });

  it("wall GRUESO + gate: el vano cruza TODO el grosor (holgura del ancho del muro)", () => {
    // Regresión: la holgura fija de 3.5 no atravesaba un muro width 12 (±6) →
    // quedaban celdas sólidas a ±(3.5..6) del centro: puerta abierta, colisión
    // bloqueada. Ahora la profundidad del vano sale del grosor del anfitrión.
    const vols: Volume[] = [
      { id: "muralla", label: "muralla ciclópea", type: "wall", points: [[0, 68], [128, 68]], width: 12, h: 10 },
      { id: "puerta", label: "puerta", type: "gate", at: [64, 68], w: 9, orient: "x" },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(!solidAt(g.grid, 64, 68), "vano central libre");
    // Borde grueso del muro (fila 63: dentro de ±6 del muro, MÁS ALLÁ del 3.5
    // viejo): antes sólido, ahora libre.
    assert.ok(!solidAt(g.grid, 64, 63), "vano libre en el grosor completo del muro");
    assert.ok(!solidAt(g.grid, 64, 73), "vano libre también en el otro borde");
    // El muro lejos de la puerta sigue sólido en todo su grosor.
    assert.ok(solidAt(g.grid, 20, 63), "muro grueso bloquea lejos de la puerta");
    assert.ok(solidAt(g.grid, 20, 73), "muro grueso bloquea (otro borde)");
    // Jamba fuera del vano, sólida.
    assert.ok(solidAt(g.grid, 54, 68), "jamba oeste sólida");
  });

  it("tower y tree: discos según radio", () => {
    const vols: Volume[] = [
      { id: "torre", label: "torre", type: "tower", at: [40, 40], r: 6 },
      { id: "roble", label: "roble", type: "tree", at: [90, 90] },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(solidAt(g.grid, 40, 40), "centro de torre");
    assert.ok(solidAt(g.grid, 45, 40), "borde de torre");
    assert.ok(!solidAt(g.grid, 47, 40), "fuera de torre");
    assert.ok(solidAt(g.grid, 90, 90), "tronco");
    assert.ok(!solidAt(g.grid, 94, 90), "la copa NO bloquea");
  });

  it("huellas parcialmente fuera del tile se recortan sin lanzar", () => {
    const vols: Volume[] = [
      { id: "muro", label: "muralla", type: "wall", points: [[-8, 10], [136, 10]], width: 4, h: 7 },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(solidAt(g.grid, 0, 10));
    assert.ok(solidAt(g.grid, 127, 10));
  });

  it("v7: building con angle — huella rotada, no el AABB", () => {
    // Rect 20×8 centrado en (40,40), girado 45°: el centro sigue sólido, el
    // punto en el eje largo LOCAL rotado también; la esquina del AABB que el
    // rect rotado ya no cubre queda libre.
    const vols: Volume[] = [
      { id: "casa", label: "casona girada", type: "building", rect: [30, 36, 20, 8], angle: 45 },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(solidAt(g.grid, 40, 40), "centro sólido");
    // Eje largo local u girado +45° (antihorario ⇒ v decrece): (40+6/√2, 40−6/√2).
    assert.ok(solidAt(g.grid, 44, 36), "punta del eje largo rotado");
    // Esquina del AABB sin rotar (49,43): con 45° el rect ya no llega ahí.
    assert.ok(!solidAt(g.grid, 49, 43), "esquina del AABB fuera del rect rotado");
    // Sin angle esa esquina SÍ es sólida (control del test).
    const g0 = volumeCollisionGrid(
      [{ id: "casa", label: "casona", type: "building", rect: [30, 36, 20, 8] }],
      RECT,
    )!;
    assert.ok(solidAt(g0.grid, 49, 43));
  });
});

describe("blueprint/collision: por dónde se pasa", () => {
  // Muro norte-sur que parte el tile en dos: sin vano no hay forma de cruzar.
  const muroNS = (width: number): Volume => (
    { id: "muro", label: "muralla", type: "wall", points: [[64, 0], [64, 128]], width, h: 7 }
  );
  const puertaY: Volume = { id: "puerta", label: "portón", type: "gate", at: [64, 64], w: 8, orient: "y" };

  it("gate `orient:\"y\"` en un muro norte-sur: se cruza de oeste a este por el vano, y sin él no", () => {
    const g = volumeCollisionGrid([muroNS(3), puertaY], RECT)!;
    assert.ok(alcanzable(g.grid, [40, 64], [90, 64]), "el portón deja cruzar el muro");
    const sinPuerta = volumeCollisionGrid([muroNS(3)], RECT)!;
    assert.equal(alcanzable(sinPuerta.grid, [40, 64], [90, 64]), false, "control: el muro sin portón sella");
    // El vano (w 8 → filas 60..67) está libre en todo el grosor del muro.
    for (let r = 60; r <= 67; r++) for (let c = 62; c <= 65; c++) assert.ok(!solidAt(g.grid, c, r), `vano (${c},${r})`);
    assert.ok(solidAt(g.grid, 64, 59) && solidAt(g.grid, 64, 68), "las jambas, a cada lado del vano, bloquean");
    assert.ok(solidAt(g.grid, 64, 20), "el muro lejos del portón bloquea");
  });

  it("gate `orient:\"y\"` en un muro GRUESO: el vano cruza los 12 de grosor, no solo la holgura fija", () => {
    // Con 3.5 de holgura el vano dejaría sólidas las columnas 58-59 y 68-69
    // del muro (±6): puerta pintada abierta y muro invisible en medio.
    const g = volumeCollisionGrid([muroNS(12), puertaY], RECT)!;
    for (let r = 60; r <= 67; r++) for (let c = 55; c <= 73; c++) assert.ok(!solidAt(g.grid, c, r), `vano (${c},${r})`);
    assert.ok(alcanzable(g.grid, [40, 64], [90, 64]));
    assert.ok(solidAt(g.grid, 58, 20) && solidAt(g.grid, 69, 20), "el muro grueso bloquea en todo su grosor lejos del portón");
  });

  it("muro que acaba en campo abierto: se llega hasta donde se VE acabar, no se choca con aire", () => {
    // Antes la banda llevaba una tapa redonda de width/2 más allá de cada
    // punta: con width 12, 3 m de muro invisible (QA de la tanda BT, H1).
    for (const width of [3, 5, 12]) {
      const g = volumeCollisionGrid([
        { id: "muro", label: "tapia", type: "wall", points: [[70, 90], [100, 90]], width, h: 7 },
      ], RECT)!;
      assert.ok(solidAt(g.grid, 99, 90) && solidAt(g.grid, 70, 90), `width ${width}: el muro colisiona hasta sus dos puntas`);
      assert.ok(!solidAt(g.grid, 100, 90) && !solidAt(g.grid, 69, 90), `width ${width}: la celda de delante de cada punta está libre`);
      assert.ok(alcanzable(g.grid, [120, 90], [100, 90]) && alcanzable(g.grid, [50, 90], [69, 90]), `width ${width}: se llega andando a las dos puntas`);
      assert.ok(solidAt(g.grid, 85, 90 + Math.ceil(width / 2) - 1), `width ${width}: el costado sigue ocupando su medio grosor`);
    }
  });

  it("las esquinas de un muro de varios tramos siguen cerradas (la tapa solo sobra en las puntas LIBRES)", () => {
    // Patio cuadrado con UNA polilínea abierta (arranca y acaba a media cara,
    // solapando): sus cuatro esquinas son vértices compartidos. Y un rombo
    // cerrado y fino, donde la esquina diagonal es la que abriría rendija.
    const patios: Array<{ nombre: string; v: Volume; dentro: [number, number]; fuera: [number, number] }> = [
      {
        nombre: "patio abierto",
        v: { id: "p", label: "cerca", type: "wall", points: [[50, 30], [70, 30], [70, 70], [30, 70], [30, 30], [52, 30]], width: 2, h: 3 },
        dentro: [50, 50], fuera: [10, 10],
      },
      {
        nombre: "rombo cerrado",
        v: { id: "r", label: "cerca", type: "wall", points: [[50, 20], [80, 50], [50, 80], [20, 50], [50, 20]], width: 1.2, h: 3 },
        dentro: [50, 50], fuera: [5, 5],
      },
      // Cerca irregular de grosor 1,35 (hallada por búsqueda: sin la tapa en
      // los vértices, la rejilla abre una rendija de una celda en una esquina
      // en ángulo). Cerrada, y la misma abierta por un pelo en su arranque.
      // Cerrada, arrancando en CADA vértice: el de arranque también es
      // compartido (primer punto = último) y necesita su tapa.
      ...[0, 1, 2, 3].map((k) => {
        const anillo: Array<[number, number]> = [[92.4, 69.5], [56.4, 86.8], [48.6, 60.5], [68.1, 25.5]];
        const pts = [...anillo.slice(k), ...anillo.slice(0, k)];
        return {
          nombre: `cerca irregular cerrada desde el vértice ${k}`,
          v: { id: "c", label: "cerca", type: "wall", points: [...pts, pts[0]], width: 1.35, h: 3 } as Volume,
          dentro: [64, 64] as [number, number], fuera: [1, 1] as [number, number],
        };
      }),
      {
        nombre: "cerca irregular abierta",
        v: { id: "c", label: "cerca", type: "wall", points: [[92.4, 69.5], [56.4, 86.8], [48.6, 60.5], [68.1, 25.5], [92.41, 69.5]], width: 1.35, h: 3 },
        dentro: [64, 64], fuera: [1, 1],
      },
    ];
    for (const { nombre, v, dentro, fuera } of patios) {
      const g = volumeCollisionGrid([v], RECT)!;
      assert.equal(alcanzable(g.grid, fuera, dentro), false, `${nombre}: sin puerta no se entra (ninguna rendija en las esquinas)`);
    }
  });

  // Casa enterable [20,20]..[40,36]: interior (30,28); fuera, (10,10) y (50,28).
  const casa = (doors: Array<{ edge: "n" | "s" | "e" | "w"; at: number; w?: number }>): Volume => (
    { id: "casa", label: "casa", type: "building", rect: [20, 20, 20, 16], cutaway: true, doors }
  );
  const DENTRO: [number, number] = [30, 28];

  it("cutaway sin puertas: el anillo sella el interior (control de los de abajo)", () => {
    const g = volumeCollisionGrid([casa([])], RECT)!;
    assert.equal(alcanzable(g.grid, [10, 10], DENTRO), false);
  });

  for (const [edge, fuera, hueco, muro] of [
    ["n", [30, 10], [[28, 20], [31, 21]], [27, 20]],
    ["w", [10, 28], [[20, 26], [21, 29]], [20, 25]],
    ["e", [50, 28], [[39, 26], [38, 29]], [39, 30]],
  ] as Array<["n" | "w" | "e", [number, number], Array<[number, number]>, [number, number]]>) {
    it(`cutaway con puerta \`${edge}\`: se entra desde fuera por ella`, () => {
      const g = volumeCollisionGrid([casa([{ edge, at: edge === "n" ? 8 : 6, w: 4 }])], RECT)!;
      assert.ok(alcanzable(g.grid, fuera, DENTRO), `desde ${fuera} se llega al interior por la puerta ${edge}`);
      for (const [c, r] of hueco) assert.ok(!solidAt(g.grid, c, r), `hueco (${c},${r})`);
      assert.ok(solidAt(g.grid, muro[0], muro[1]), `el muro junto a la puerta ${edge} sigue sólido`);
    });
  }

  it("cutaway con DOS puertas en el mismo muro: se abren las dos y el tramo entre ellas sigue en pie", () => {
    const g = volumeCollisionGrid([casa([{ edge: "n", at: 2, w: 4 }, { edge: "n", at: 12, w: 4 }])], RECT)!;
    for (const c of [22, 25, 32, 35]) assert.ok(!solidAt(g.grid, c, 20), `hueco en la columna ${c}`);
    for (const c of [21, 26, 29, 31, 36]) assert.ok(solidAt(g.grid, c, 20), `muro en la columna ${c}`);
    assert.ok(alcanzable(g.grid, [23, 10], DENTRO) && alcanzable(g.grid, [33, 10], DENTRO));
  });
});

describe("#788: lo que ya bloqueaba no cambia (muros de eje, coordenadas enteras o medias)", () => {
  // Rejilla ESPERADA escrita a mano, no copiada del código: un muro de eje con
  // la banda [c − w/2, c + w/2] ocupa las filas que esa banda pisa con área
  // (tocar la frontera no cuenta) y las columnas [ini, fin) — punta plana.
  // Pasar de «centro de celda» a «solape» no puede mover ni una celda aquí.
  function celdas(g: ReturnType<typeof volumeCollisionGrid>): Set<string> {
    const s = new Set<string>();
    g?.grid.forEach((fila, r) => [...fila].forEach((ch, c) => { if (ch === "S") s.add(`${c},${r}`); }));
    return s;
  }
  function rect(c0: number, c1: number, r0: number, r1: number): string[] {
    const out: string[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(`${c},${r}`);
    return out;
  }
  const casos: Array<{ w: number; v: number; filas: [number, number] }> = [
    { w: 1, v: 30, filas: [29, 30] }, { w: 1, v: 30.5, filas: [30, 30] },
    { w: 2, v: 30, filas: [29, 30] }, { w: 2, v: 30.5, filas: [29, 31] },
    { w: 3, v: 30, filas: [28, 31] }, { w: 3, v: 30.5, filas: [29, 31] },
    { w: 12, v: 30, filas: [24, 35] }, { w: 12, v: 30.5, filas: [24, 36] },
  ];
  for (const { w, v, filas } of casos) {
    it(`width ${w} en v ${v}: filas ${filas[0]}..${filas[1]}, columnas 20..99`, () => {
      const g = volumeCollisionGrid([{ id: "m", label: "tapia", type: "wall", points: [[20, v], [100, v]], width: w }], RECT);
      assert.deepEqual([...celdas(g)].sort(), rect(20, 99, filas[0], filas[1]).sort());
    });
  }

  it("L de width 3 con vértice compartido: los dos tramos más la tapa de la esquina por centro", () => {
    const g = volumeCollisionGrid([{ id: "m", label: "tapia", type: "wall", points: [[20, 30], [100, 30], [100, 80]], width: 3 }], RECT);
    const esperado = new Set([
      ...rect(20, 99, 28, 31), // tramo este-oeste, punta oeste plana
      ...rect(98, 101, 30, 79), // tramo norte-sur, punta sur plana
      "100,29", // tapa: el único centro de la esquina exterior a ≤ 1,5 del vértice
    ]);
    assert.deepEqual([...celdas(g)].sort(), [...esperado].sort());
  });
});
