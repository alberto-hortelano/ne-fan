/** EL A* DEL NPC (#618, pieza A), medido contra una definición DISTINTA.
 *
 *  El aserto que sujeta el fichero es la optimalidad contra un Dijkstra de
 *  referencia escrito aquí, sin heurística ni montículo: si los dos dan la
 *  misma longitud en 200 rejillas sembradas, el A* no es «la misma cuenta dos
 *  veces». Lo demás son las reglas que el módulo promete y que un jugador ve:
 *  no cortar esquinas (el cuerpo rozaría el sólido), el tope exacto y el
 *  determinismo del sim. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buscarCamino, type Celda, type RejillaDePaso } from "../src/simulation/busca-camino.js";
import { SeededRng } from "../src/rng.js";

/** Rejilla desde filas de texto: `#` sólido, cualquier otra cosa libre. */
function rejilla(filas: string[]): RejillaDePaso {
  return {
    cols: filas[0].length,
    rows: filas.length,
    libre: (c, r) => filas[r][c] !== "#",
  };
}

/** Longitud de un camino de celdas: 1 en ortogonal, √2 en diagonal. */
function longitud(celdas: ReadonlyArray<Celda>): number {
  let l = 0;
  for (let k = 1; k < celdas.length; k++) {
    const d = Math.abs(celdas[k][0] - celdas[k - 1][0]) + Math.abs(celdas[k][1] - celdas[k - 1][1]);
    l += d === 2 ? Math.SQRT2 : 1;
  }
  return l;
}

/** Que el camino es ANDABLE: celdas libres, vecinas, y ninguna diagonal que
 *  corte una esquina sólida. */
function afirmarAndable(rej: RejillaDePaso, celdas: ReadonlyArray<Celda>): void {
  for (const [c, r] of celdas) assert.ok(rej.libre(c, r), `celda (${c},${r}) sólida en el camino`);
  for (let k = 1; k < celdas.length; k++) {
    const [c0, r0] = celdas[k - 1];
    const [c1, r1] = celdas[k];
    assert.ok(Math.abs(c1 - c0) <= 1 && Math.abs(r1 - r0) <= 1 && (c1 !== c0 || r1 !== r0), "no vecinas");
    if (c1 !== c0 && r1 !== r0) {
      assert.ok(rej.libre(c1, r0) && rej.libre(c0, r1), `diagonal (${c0},${r0})→(${c1},${r1}) corta esquina`);
    }
  }
}

/** DIJKSTRA DE REFERENCIA: barrido ingenuo O(n²) sin heurística, con las
 *  mismas reglas de paso. Devuelve la distancia, o `Infinity`. */
function dijkstra(rej: RejillaDePaso, a: Celda, b: Celda): number {
  const n = rej.cols * rej.rows;
  const dist = new Array<number>(n).fill(Infinity);
  const hecho = new Array<boolean>(n).fill(false);
  const libre = (c: number, r: number) => c >= 0 && r >= 0 && c < rej.cols && r < rej.rows && rej.libre(c, r);
  if (!libre(a[0], a[1]) || !libre(b[0], b[1])) return Infinity;
  dist[a[1] * rej.cols + a[0]] = 0;
  for (;;) {
    let i = -1;
    for (let k = 0; k < n; k++) if (!hecho[k] && dist[k] < Infinity && (i < 0 || dist[k] < dist[i])) i = k;
    if (i < 0) return Infinity;
    const c = i % rej.cols;
    const r = Math.floor(i / rej.cols);
    if (c === b[0] && r === b[1]) return dist[i];
    hecho[i] = true;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        if (!libre(c + dc, r + dr)) continue;
        if (dc && dr && (!libre(c + dc, r) || !libre(c, r + dr))) continue;
        const j = (r + dr) * rej.cols + (c + dc);
        const d = dist[i] + (dc && dr ? Math.SQRT2 : 1);
        if (d < dist[j]) dist[j] = d;
      }
    }
  }
}

describe("buscarCamino", () => {
  it("rodea una U: sale por la boca, que da la espalda a la meta, y llega detrás", () => {
    const rej = rejilla([
      "...........",
      "..#.....#..",
      "..#.....#..",
      "..#.....#..",
      "..#######..",
      "...........",
      "...........",
    ]);
    const r = buscarCamino(rej, [5, 2], [5, 6], 10_000);
    assert.ok(r.ok);
    afirmarAndable(rej, r.celdas);
    assert.deepEqual(r.celdas[0], [5, 2]);
    assert.deepEqual(r.celdas.at(-1), [5, 6]);
    assert.ok(r.celdas.some(([, f]) => f === 0), "sale por la boca (fila 0)");
    // Recto serían 4; el rodeo por fuera de la U es mucho más.
    assert.ok(longitud(r.celdas) > 12, `rodea: longitud ${longitud(r.celdas).toFixed(2)}`);
  });

  it("no corta esquinas: dos sólidos en diagonal cierran el paso", () => {
    const rej = rejilla([".#", "#."]);
    const r = buscarCamino(rej, [0, 0], [1, 1], 100);
    assert.deepEqual(r, { ok: false, motivo: "sin-camino", expansiones: 1 });
    // Control: con UNA de las dos ortogonales libre, la diagonal sigue
    // prohibida pero se llega por la libre.
    const control = buscarCamino(rejilla(["..", "#."]), [0, 0], [1, 1], 100);
    assert.ok(control.ok);
    assert.deepEqual(control.celdas, [[0, 0], [1, 0], [1, 1]]);
  });

  it("sin-camino: meta aislada, inicio o meta sólidos o fuera de la rejilla", () => {
    const rej = rejilla([
      ".......",
      "...###.",
      "...#.#.",
      "...###.",
    ]);
    const aislada = buscarCamino(rej, [0, 0], [4, 2], 10_000);
    assert.equal(aislada.ok, false);
    assert.equal(!aislada.ok && aislada.motivo, "sin-camino");
    assert.ok(aislada.expansiones > 10, "la meta aislada se descubre vaciando lo alcanzable");
    assert.deepEqual(buscarCamino(rej, [3, 1], [0, 0], 10), { ok: false, motivo: "sin-camino", expansiones: 0 });
    assert.deepEqual(buscarCamino(rej, [0, 0], [3, 1], 10), { ok: false, motivo: "sin-camino", expansiones: 0 });
    assert.deepEqual(buscarCamino(rej, [0, 0], [7, 0], 10), { ok: false, motivo: "sin-camino", expansiones: 0 });
    assert.deepEqual(buscarCamino(rej, [-1, 0], [0, 0], 10), { ok: false, motivo: "sin-camino", expansiones: 0 });
    assert.deepEqual(buscarCamino(rej, [0, 0], [0, 4], 10), { ok: false, motivo: "sin-camino", expansiones: 0 });
  });

  it("inicio = meta: camino de una celda y cero expansiones", () => {
    assert.deepEqual(buscarCamino(rejilla(["..."]), [1, 0], [1, 0], 0), { ok: true, celdas: [[1, 0]], expansiones: 0 });
  });

  it("el tope es EXACTO: `tope` si y solo si hacían falta más expansiones que el máximo", () => {
    const rej = rejilla([
      "..........",
      ".########.",
      ".#......#.",
      ".#.####.#.",
      ".#....#.#.",
      ".######.#.",
      "........#.",
    ]);
    const libre = buscarCamino(rej, [2, 2], [9, 6], 100_000);
    assert.ok(libre.ok);
    const E = libre.expansiones;
    assert.ok(E > 5, `caso con trabajo de verdad: ${E} expansiones`);
    const justo = buscarCamino(rej, [2, 2], [9, 6], E);
    assert.ok(justo.ok, "con el máximo igual a lo necesario, llega");
    assert.deepEqual(justo.celdas, libre.celdas);
    assert.deepEqual(buscarCamino(rej, [2, 2], [9, 6], E - 1), { ok: false, motivo: "tope", expansiones: E - 1 });
  });

  it("es ÓPTIMO: misma longitud que un Dijkstra de referencia en 200 rejillas sembradas de 40×40", () => {
    const rng = new SeededRng(618);
    let conCamino = 0;
    for (let k = 0; k < 200; k++) {
      const densidad = 0.15 + rng.next() * 0.25;
      const filas: string[] = [];
      for (let r = 0; r < 40; r++) {
        let f = "";
        for (let c = 0; c < 40; c++) f += rng.next() < densidad ? "#" : ".";
        filas.push(f);
      }
      const a: Celda = [rng.nextInt(40), rng.nextInt(40)];
      const b: Celda = [rng.nextInt(40), rng.nextInt(40)];
      const rej = rejilla(filas);
      const ref = dijkstra(rej, a, b);
      const r = buscarCamino(rej, a, b, 1_000_000);
      if (ref === Infinity) {
        assert.equal(r.ok, false, `rejilla ${k}: Dijkstra no llega y el A* sí`);
        continue;
      }
      conCamino++;
      assert.ok(r.ok, `rejilla ${k}: Dijkstra llega (${ref}) y el A* no`);
      afirmarAndable(rej, r.celdas);
      assert.deepEqual(r.celdas[0], a);
      assert.deepEqual(r.celdas.at(-1), b);
      assert.ok(Math.abs(longitud(r.celdas) - ref) < 1e-9, `rejilla ${k}: A* ${longitud(r.celdas)} ≠ Dijkstra ${ref}`);
    }
    assert.ok(conCamino > 80, `la muestra tiene caminos de verdad: ${conCamino} de 200`);
  });

  it("es DETERMINISTA: entre caminos empatados elige siempre el mismo", () => {
    // Campo abierto: hay muchísimos caminos óptimos de (0,0) a (9,5).
    const rej = rejilla(Array.from({ length: 8 }, () => ".........."));
    const a = buscarCamino(rej, [0, 0], [9, 5], 10_000);
    const b = buscarCamino(rej, [0, 0], [9, 5], 10_000);
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a, b);
    assert.ok(Math.abs(longitud(a.celdas) - (4 + 5 * Math.SQRT2)) < 1e-9);
  });
});
