/** Lo que se PINTA de un volumen contra lo que COLISIONA y lo que el scatter
 *  deja libre. «Render ≠ colisión» permite que difieran, así que aquí no se
 *  exige igualdad: se fija, caso a caso, la relación que el jugador nota —
 *  un vano pintado se cruza, no se choca con aire, el detalle del suelo no
 *  pisa lo construido— y, donde difieren, cuánto y por qué. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { volumeCollisionGrid, volumeSolidDiscRadiusCells } from "../src/scene/blueprint/collision.js";
import { rotatedRectCorners } from "../src/scene/blueprint/footprint.js";
import { buildScatterExclusions } from "../src/scene/blueprint/scatter.js";
import type { BuildingVolume, GateVolume, Volume } from "../src/scene/blueprint/volumes.js";
import type { GreyboxPrimitive } from "../src/scene/greybox/common.js";
import { volumePrimsForTile } from "../src/scene/greybox/volume-prims.js";
import { tileWorldRect } from "../src/scene/tile.js";

const RECT = tileWorldRect(0, 0);
const EPS = 1e-9;

function prims(vols: Volume[]): GreyboxPrimitive[] {
  const gates = vols.filter((v): v is GateVolume => v.type === "gate");
  return vols.flatMap((v) => volumePrimsForTile(v, gates));
}

/** Esquinas XZ de una caja pintada (rotY con el convenio de las prims). */
function esquinasCaja(p: GreyboxPrimitive): [number, number][] {
  const [w, , d] = p.size;
  const a = p.rotY ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as const).map(
    ([dx, dz]) => [p.pos[0] + dx * c + dz * s, p.pos[2] - dx * s + dz * c] as [number, number],
  );
}

/** Contorno XZ de lo pintado A RAS DE SUELO (base en y≈0): lo que se ve
 *  plantado. Una copa, un tejado o un dintel no ocupan el suelo. */
function contornoASuelo(p: GreyboxPrimitive): [number, number][] {
  if (p.shape === "polygon") return p.points!;
  if (p.shape === "box" || p.shape === "gable") return esquinasCaja(p);
  // cylinder / cone / sphere: el círculo de su base (size[0] = radio inferior).
  const r = p.size[0];
  return Array.from({ length: 16 }, (_, k) => {
    const a = (k / 16) * Math.PI * 2;
    return [p.pos[0] + Math.cos(a) * r, p.pos[2] + Math.sin(a) * r] as [number, number];
  });
}

/** ¿Cae (u,v) dentro de la planta de una caja pintada? */
function dentroDeCaja(p: GreyboxPrimitive, u: number, v: number): boolean {
  const [w, , d] = p.size;
  const a = p.rotY ?? 0;
  const du = u - p.pos[0];
  const dv = v - p.pos[2];
  // Marco local: inversa del giro de esquinasCaja.
  const lu = du * Math.cos(a) - dv * Math.sin(a);
  const lv = du * Math.sin(a) + dv * Math.cos(a);
  return Math.abs(lu) < w / 2 && Math.abs(lv) < d / 2;
}

/** ¿Pisa alguna prim de muro/edificio (a ras de suelo) el punto? */
function pintadoEn(ps: GreyboxPrimitive[], u: number, v: number): boolean {
  // Suelos (0,1 de alto) y remates elevados fuera: no cierran el paso.
  return ps.some((p) => p.shape === "box" && p.pos[1] <= 0.05 && p.size[1] >= 1 && dentroDeCaja(p, u, v));
}

function solida(grid: string[], u: number, v: number): boolean {
  return grid[Math.floor(v)][Math.floor(u)] === "S";
}

describe("el vano pintado es el vano por el que se pasa", () => {
  it("gate `orient:\"y\"`: a lo largo del eje del muro, celda libre ⇔ ninguna prim de muro la pisa", () => {
    const vols: Volume[] = [
      { id: "muro", label: "muralla", type: "wall", points: [[64, 20], [64, 108]], width: 3, h: 7 },
      { id: "puerta", label: "portón", type: "gate", at: [64, 64], w: 8, orient: "y" },
    ];
    const ps = prims(vols);
    const g = volumeCollisionGrid(vols, RECT)!;
    let libres = 0;
    for (let r = 40; r < 88; r++) {
      const pintada = pintadoEn(ps, 64.5, r + 0.5);
      assert.equal(solida(g.grid, 64.5, r + 0.5), pintada, `fila ${r}: pintada=${pintada}`);
      if (!pintada) libres++;
    }
    assert.equal(libres, 8, "el vano mide lo que declara el gate (w 8)");
  });

  for (const width of [3, 12]) {
    it(`muro de width ${width} que acaba en campo abierto: a lo largo del eje, sólido ⇔ pintado, puntas incluidas`, () => {
      const muro: Volume = { id: "muro", label: "tapia", type: "wall", points: [[70, 90], [100, 90]], width, h: 7 };
      const ps = prims([muro]);
      const g = volumeCollisionGrid([muro], RECT)!;
      for (let c = 55; c < 115; c++) {
        const pintada = pintadoEn(ps, c + 0.5, 90.5);
        assert.equal(solida(g.grid, c + 0.5, 90.5), pintada, `columna ${c}: pintada=${pintada}`);
      }
    });
  }

  it("cutaway: el grosor del muro que colisiona contiene al pintado y lo sobrepasa menos de una celda", () => {
    // DECISIÓN (render ≠ colisión): el anillo colisiona con 1,5 celdas de
    // grosor y se pinta con 1,2. Lo que se fija es la relación, por los cuatro
    // muros: (1) todo lo pintado es sólido (nadie mete el cuerpo en una pared
    // que ve) y la cara EXTERIOR coincide; (2) hacia dentro, lo sólido acaba
    // a menos de una celda de la cara pintada (hoy 0,8: el 1,5 redondeado a
    // celdas contra el 1,2 pintado). Un muro pintado más grueso que su
    // colisión rompe (1); uno que colisiona muy por delante de lo que se ve, (2).
    const casa: Volume = { id: "casa", label: "casa", type: "building", rect: [20, 20, 20, 16], cutaway: true };
    const ps = prims([casa]);
    const g = volumeCollisionGrid([casa], RECT)!;
    // Por cada muro: punto medio de la cara, eje de barrido y sentido «hacia dentro».
    const muros = [
      { edge: "n", fijo: 30.5, desde: 20, dentro: 1, ejeU: false },
      { edge: "s", fijo: 30.5, desde: 36, dentro: -1, ejeU: false },
      { edge: "w", fijo: 28.5, desde: 20, dentro: 1, ejeU: true },
      { edge: "e", fijo: 28.5, desde: 40, dentro: -1, ejeU: true },
    ];
    for (const { edge, fijo, desde, dentro, ejeU } of muros) {
      let caraPintada = -Infinity;
      let caraSolida = -Infinity;
      for (let k = -1; k <= 4; k += 0.05) {
        const x = desde + dentro * k;
        const [u, v] = ejeU ? [x, fijo] : [fijo, x];
        const pintada = pintadoEn(ps, u, v);
        const solidaAqui = solida(g.grid, u, v);
        if (pintada) {
          assert.ok(solidaAqui, `${edge}: pintado y sin colisión a ${k.toFixed(2)} de la cara exterior`);
          caraPintada = Math.max(caraPintada, k);
        }
        if (solidaAqui) caraSolida = Math.max(caraSolida, k);
        if (k < 0) assert.equal(solidaAqui, false, `${edge}: sólido FUERA de la casa a ${k.toFixed(2)}`);
      }
      const sobra = caraSolida - caraPintada;
      assert.ok(caraPintada > 0.5, `${edge}: hay muro pintado (${caraPintada})`);
      assert.ok(sobra >= 0 && sobra < 1, `${edge}: la colisión sobrepasa lo pintado ${sobra.toFixed(2)} hacia dentro`);
    }
  });

  for (const edge of ["n", "s", "w", "e"] as const) {
    it(`cutaway, puerta \`${edge}\` (y dos en el mismo muro): el hueco pintado es el hueco libre`, () => {
      // Dos puertas en el mismo borde: el segundo corte se hace sobre un muro
      // ya partido en dos tramos (el tramo que no toca se conserva entero).
      const casa: Volume = {
        id: "casa", label: "casa", type: "building", rect: [20, 20, 20, 16], cutaway: true,
        doors: [{ edge, at: 2, w: 4 }, { edge, at: 9, w: 4 }],
      };
      const ps = prims([casa]);
      const g = volumeCollisionGrid([casa], RECT)!;
      const esX = edge === "n" || edge === "s";
      // Línea media del muro pintado (grosor 1.2) de ese borde.
      const linea = { n: 20.6, s: 35.4, w: 20.6, e: 39.4 }[edge];
      const [desde, hasta] = esX ? [20, 40] : [20, 36];
      const huecos: number[] = [];
      // Muro entero, esquinas incluidas: el tramo de esquina que no toca
      // ninguna puerta también tiene que seguir en pie.
      for (let k = desde; k < hasta; k++) {
        const [u, v] = esX ? [k + 0.5, linea] : [linea, k + 0.5];
        const pintada = pintadoEn(ps, u, v);
        assert.equal(solida(g.grid, u, v), pintada, `${edge} celda ${k}: pintada=${pintada}`);
        if (!pintada) huecos.push(k);
      }
      assert.deepEqual(huecos, [22, 23, 24, 25, 29, 30, 31, 32], "dos huecos de 4 donde se declararon");
    });
  }
});

describe("edificio con techo y `angle`: lo pintado sigue al rect ROTADO", () => {
  const casona: BuildingVolume = {
    id: "casona", label: "casona girada", type: "building", rect: [40, 40, 20, 12], angle: 30,
    roof: { kind: "flat" }, wall_h: 6,
    doors: [
      { edge: "n", at: 3, w: 3 }, { edge: "s", at: 10 }, { edge: "e", at: 2, w: 4 }, { edge: "w", at: 5, w: 3 },
    ],
  };

  it("cada puerta se asienta sobre SU cara rotada, a `at + w/2` de la esquina del lado", () => {
    const ps = volumePrimsForTile(casona, []);
    // Esquinas del rect rotado, en el orden de rotatedRectCorners:
    // NO, NE, SE, SO (locales). Cada lado: [origen, fin] con el origen en la
    // esquina NO del lado (donde cuenta `at`).
    const [no, ne, se, so] = rotatedRectCorners([40, 40, 20, 12], 30);
    const lados = { n: [no, ne], s: [so, se], w: [no, so], e: [ne, se] } as const;
    const puertas = ps.filter((p) => p.color === "#2a2018");
    assert.equal(puertas.length, 4, "una prim por puerta");
    casona.doors!.forEach((dr, i) => {
      const [a, b] = lados[dr.edge];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = (dr.at ?? 0) + (dr.w ?? 3) / 2;
      const esperado = [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len];
      const p = puertas[i];
      assert.ok(Math.abs(p.pos[0] - esperado[0]) < 1e-6 && Math.abs(p.pos[2] - esperado[1]) < 1e-6,
        `puerta ${dr.edge}: pintada en (${p.pos[0]}, ${p.pos[2]}), su cara pide (${esperado})`);
      assert.ok(Math.abs((p.rotY ?? 0) - Math.PI / 6) < EPS, `puerta ${dr.edge} girada con el edificio`);
    });
  });

  it("tejado `flat`: losa sobre los muros, más ancha que el cuerpo y girada con él", () => {
    const ps = volumePrimsForTile(casona, []);
    const [cuerpo, losa] = ps;
    assert.equal(losa.pos[1], 6, "la losa arranca en wall_h");
    assert.ok(losa.size[0] > cuerpo.size[0] && losa.size[2] > cuerpo.size[2], "vuela sobre los muros");
    assert.ok(losa.size[1] < 1, "es una losa, no un piso");
    assert.equal(losa.rotY, cuerpo.rotY);
    assert.deepEqual([losa.pos[0], losa.pos[2]], [cuerpo.pos[0], cuerpo.pos[2]]);
  });
});

describe("tejado a dos aguas: la cumbrera corre por el lado largo y el alero cubre el cuerpo", () => {
  for (const [rect, axis] of [
    [[40, 40, 20, 12], undefined], // ancho > fondo: cumbrera en x
    [[40, 40, 12, 20], undefined], // fondo > ancho: cumbrera en y
    [[40, 40, 20, 12], "y"], // declarada contra el lado largo: manda la declaración
  ] as Array<[[number, number, number, number], "x" | "y" | undefined]>) {
    it(`rect ${rect[2]}×${rect[3]}, axis ${axis ?? "por defecto"}`, () => {
      const v: Volume = { id: "c", label: "casa", type: "building", rect, roof: axis ? { kind: "gable", axis } : { kind: "gable" } };
      const [cuerpo, tejado] = volumePrimsForTile(v, []);
      assert.equal(tejado.shape, "gable");
      // La cumbrera va a lo largo de size[2] antes de girar (contrato de
      // common.ts): girada por rotY, su dirección en planta es (sin, cos).
      const r = tejado.rotY ?? 0;
      const cumbreraEnX = Math.abs(Math.sin(r)) > 0.5;
      const esperada = axis ?? (rect[2] >= rect[3] ? "x" : "y");
      assert.equal(cumbreraEnX ? "x" : "y", esperada);
      // En planta, el tejado sobresale del cuerpo por los cuatro lados.
      const [ex, ez] = cumbreraEnX ? [tejado.size[2], tejado.size[0]] : [tejado.size[0], tejado.size[2]];
      assert.ok(ex > cuerpo.size[0] && ez > cuerpo.size[2], `alero ${ex}×${ez} sobre cuerpo ${cuerpo.size[0]}×${cuerpo.size[2]}`);
      assert.ok(ex - cuerpo.size[0] < 2 && ez - cuerpo.size[2] < 2, "un alero, no otro edificio");
      assert.equal(tejado.pos[1], cuerpo.size[1], "arranca donde acaban los muros");
    });
  }
});

describe("prop: lo que se pinta y lo que colisiona", () => {
  // DECISIÓN (render ≠ colisión, 2026-09-30): el prop-punto se pinta con
  // media anchura 1,4 celdas y colisiona con un disco de radio 1,3. No se
  // igualan: lo que se fija es que el disco CONTINUO de colisión cabe en lo
  // pintado (el jugador nunca choca con aire), y que la rejilla de 0,5 m,
  // que marca la celda entera si su centro cae en el disco, añade como mucho
  // MEDIA celda por eje (con `at` en semicelda markDisc marca hasta ±1,5).
  // Igualar los dos radios cambia la exclusión del scatter y repaga el atlas.
  for (const shape of ["box", "cylinder"] as const) {
    for (const at of [[40, 40], [40.5, 40.5]] as Array<[number, number]>) {
      it(`prop-punto ${shape} en (${at}): el disco cabe en lo pintado y la rejilla no pasa de media celda`, () => {
        const v: Volume = { id: "barril", label: "barril", type: "prop", at, shape };
        const [cuerpo] = volumePrimsForTile(v, []);
        assert.equal(cuerpo.shape, shape);
        assert.deepEqual([cuerpo.pos[0], cuerpo.pos[2]], at, "centrado en su `at`");
        const media = shape === "box" ? Math.min(cuerpo.size[0], cuerpo.size[2]) / 2 : cuerpo.size[0];
        const r = volumeSolidDiscRadiusCells(v)!;
        assert.ok(r <= media, `disco ${r} dentro de lo pintado (${media})`);
        const g = volumeCollisionGrid([v], RECT)!;
        let celdas = 0;
        for (let row = 30; row < 50; row++) {
          for (let col = 30; col < 50; col++) {
            if (!solida(g.grid, col, row)) continue;
            celdas++;
            for (const [x, c] of [[col, at[0]], [row, at[1]]]) {
              assert.ok(x >= c - media - 0.5 - EPS && x + 1 <= c + media + 0.5 + EPS, `celda (${col},${row}) fuera de lo pintado + ½`);
            }
          }
        }
        assert.ok(celdas > 0 && solida(g.grid, at[0], at[1]), "colisiona en su centro");
      });
    }
  }

  it("prop con rect: la caja pintada ES el rect; con `angle`, sus medidas reales giradas", () => {
    const recto: Volume = { id: "mesa", label: "mesa", type: "prop", rect: [30, 30, 6, 2], shape: "box", h: 1 };
    const [m] = volumePrimsForTile(recto, []);
    assert.deepEqual(m.size, [6, 1, 2]);
    assert.deepEqual([m.pos[0], m.pos[2]], [33, 31]);
    assert.equal(m.rotY, undefined, "sin angle no gira");
    const girado: Volume = { ...recto, id: "mesa2", angle: 40 };
    const [g] = volumePrimsForTile(girado, []);
    assert.deepEqual([g.size[0], g.size[2]], [6, 2], "medidas del rect, no del AABB rotado");
    assert.ok(Math.abs(g.pos[0] - 33) < EPS && Math.abs(g.pos[2] - 31) < EPS, "centrada en el rect");
    assert.ok(Math.abs(g.rotY! - (40 * Math.PI) / 180) < EPS);
    // Y colisiona donde se pinta, a la resolución de la rejilla: una celda es
    // sólida si y solo si su CENTRO cae en la caja pintada.
    const grid = volumeCollisionGrid([girado], RECT)!;
    let celdas = 0;
    for (let row = 25; row < 38; row++) {
      for (let col = 26; col < 41; col++) {
        const pintada = dentroDeCaja(g, col + 0.5, row + 0.5);
        assert.equal(solida(grid.grid, col, row), pintada, `celda (${col},${row})`);
        if (pintada) celdas++;
      }
    }
    assert.ok(celdas >= 10, `la mesa girada ocupa celdas (${celdas})`);
  });

  it("prop cilindro con rect: el radio es el del lado corto", () => {
    const v: Volume = { id: "pozo", label: "pozo", type: "prop", rect: [30, 30, 6, 4], shape: "cylinder", h: 2 };
    const [cuerpo, remate] = volumePrimsForTile(v, []);
    assert.deepEqual(cuerpo.size, [2, 2]);
    assert.deepEqual(cuerpo.pos, [33, 0, 32]);
    assert.equal(remate.pos[1], 2, "el remate corona el cuerpo");
  });
});

describe("fuente: el pilón pintado tiene el radio que colisiona", () => {
  for (const r of [undefined, 7]) {
    it(`r ${r ?? "por defecto"}`, () => {
      const v: Volume = r === undefined
        ? { id: "f", label: "fuente", type: "fountain", at: [50, 50] }
        : { id: "f", label: "fuente", type: "fountain", at: [50, 50], r };
      const [pilon, agua, surtidor] = volumePrimsForTile(v, []);
      assert.equal(pilon.size[0], volumeSolidDiscRadiusCells(v));
      assert.ok(agua.size[0] < pilon.size[0] && agua.pos[1] > 0, "el agua queda dentro y encima del pilón");
      assert.ok(surtidor.size[1] > pilon.size[1], "el surtidor asoma");
      for (const p of [pilon, agua, surtidor]) assert.deepEqual([p.pos[0], p.pos[2]], [50, 50]);
    });
  }
});

describe("el scatter no pisa lo construido (exclusión = huella declarada + margen)", () => {
  // Por cada tipo de volumen: (1) todo lo pintado a ras de suelo queda
  // excluido; (2) también un respiro de 0,1 celdas alrededor (el margen no
  // es cero); (3) a 1,5 celdas del borde pintado (margen 0,5 + 1) ya se
  // siembra: la exclusión no deja un calvero alrededor. `extra` es lo que la
  // huella declarada sobresale de lo pintado A PROPÓSITO, con su motivo.
  const casos: Array<{ v: Volume; extra?: number; porque?: string }> = [
    { v: { id: "b", label: "casa", type: "building", rect: [40, 40, 20, 12], doors: [{ edge: "s", at: 4 }] } },
    { v: { id: "b", label: "casa girada", type: "building", rect: [40, 40, 20, 12], angle: 30 } },
    { v: { id: "b", label: "casa abierta", type: "building", rect: [40, 40, 20, 12], cutaway: true, doors: [{ edge: "w", at: 4 }] } },
    { v: { id: "p", label: "barril", type: "prop", at: [50, 50], shape: "box" } },
    { v: { id: "p", label: "mesa", type: "prop", rect: [44, 46, 8, 4], shape: "box" } },
    { v: { id: "p", label: "mesa girada", type: "prop", rect: [44, 46, 8, 4], shape: "box", angle: 25 } },
    {
      v: { id: "w", label: "tapia", type: "wall", points: [[30, 40], [70, 40], [70, 70]], width: 4 },
      extra: 2, porque: "la huella DECLARADA del muro (AABB del trazo ± medio grosor) sobresale medio grosor en las puntas; la colisión ya no, pero mover la exclusión del scatter cambia el tile canónico y repaga el atlas",
    },
    {
      v: { id: "w", label: "cerca sin grosor declarado", type: "wall", points: [[30, 40], [70, 40]] },
      extra: 1.5, porque: "la misma tapa, con el grosor por defecto",
    },
    { v: { id: "t", label: "torre", type: "tower", at: [50, 50], r: 5 } },
    { v: { id: "t", label: "torre sin radio declarado", type: "tower", at: [50, 50] } },
    { v: { id: "g", label: "portón", type: "gate", at: [50, 50], w: 8, orient: "x" } },
    { v: { id: "g", label: "portón sin vano declarado", type: "gate", at: [50, 50], orient: "y" } },
    { v: { id: "f", label: "fuente", type: "fountain", at: [50, 50] } },
    {
      v: {
        id: "c", label: "carreta", type: "custom", at: [50, 50], angle: 20,
        parts: [
          { shape: "box", size: [6, 1.6, 3], pos: [0, 1.1, 0] },
          { shape: "cylinder", rBottom: 0.9, h: 0.3, pos: [-1.8, 0, 1.5], rotX: 1.5708 },
        ],
      },
    },
    {
      v: {
        id: "c", label: "bolardo con bola tumbada", type: "custom", at: [50, 50],
        parts: [{ shape: "box", size: [1, 2, 1] }, { shape: "sphere", r: 1.2, pos: [0, 2, 0], rotZ: 0.8 }],
      },
    },
    { v: { id: "x", label: "ala en L", type: "prism", points: [[40, 40], [60, 40], [60, 48], [48, 48], [48, 60], [40, 60]], h: 6 } },
    { v: { id: "r", label: "peña", type: "rock", at: [50, 50], s: 2 } },
    { v: { id: "a", label: "roble", type: "tree", at: [50, 50] } },
    { v: { id: "m", label: "mata", type: "bush", at: [50, 50], s: 1.5 } },
  ];
  for (const { v, extra = 0, porque } of casos) {
    it(`${v.type} «${v.label}»${porque ? ` (+${extra}: ${porque})` : ""}`, () => {
      const excluido = buildScatterExclusions([v], []);
      const suelo = prims([v]).filter((p) => p.pos[1] < 0.05 || v.type === "custom");
      assert.ok(suelo.length > 0, "algo pintado a ras de suelo");
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (const p of suelo) {
        const contorno = contornoASuelo(p);
        // Hacia el centroide del contorno (el `pos` de un polygon es el origen).
        const cu = contorno.reduce((acc, q) => acc + q[0], 0) / contorno.length;
        const cv = contorno.reduce((acc, q) => acc + q[1], 0) / contorno.length;
        for (const [u, vv] of contorno) {
          minU = Math.min(minU, u); maxU = Math.max(maxU, u);
          minV = Math.min(minV, vv); maxV = Math.max(maxV, vv);
          // Un pelo hacia dentro del borde pintado: excluido.
          assert.ok(excluido(u + (cu - u) * 0.02, vv + (cv - vv) * 0.02), `borde pintado (${u.toFixed(2)},${vv.toFixed(2)}) sin excluir`);
        }
      }
      const [mu, mv] = [(minU + maxU) / 2, (minV + maxV) / 2];
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const borde = (d: number) => [du > 0 ? maxU + d : du < 0 ? minU - d : mu, dv > 0 ? maxV + d : dv < 0 ? minV - d : mv] as const;
        assert.ok(excluido(...borde(0.1)), `respiro de 0,1 hacia (${du},${dv})`);
        assert.equal(excluido(...borde(1.5 + extra)), false, `a 1,5${extra ? `+${extra}` : ""} del borde hacia (${du},${dv}) ya se siembra`);
      }
    });
  }
});
