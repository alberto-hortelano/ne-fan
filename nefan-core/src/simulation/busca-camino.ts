/** A* SOBRE UNA REJILLA DE PASO — el buscador de caminos del NPC (#618, pieza A).
 *
 *  Genérico a propósito: no sabe de metros, ni de tiles, ni de quién es
 *  sólido. Recibe una rejilla que contesta «¿esta celda es LIBRE?» y devuelve
 *  la secuencia de celdas. Quien traduce el mundo a esa rejilla —y el camino
 *  de vuelta a metros— es `ruta-por-el-suelo.ts`; quien sabe la verdad de la
 *  colisión es el proveedor del bridge (`bridge/sim-collision.ts`).
 *
 *  Lo canónico del dominio, sin inventos:
 *  - 8-vecindad, coste 1 en ortogonal y √2 en diagonal, heurística OCTIL
 *    (admisible y consistente con esos costes: el primer pop de la meta es
 *    óptimo y una celda cerrada no se reabre).
 *  - **No se cortan esquinas**: una diagonal exige libres sus DOS ortogonales.
 *    Con esa regla el cuerpo que va de centro a centro de dos celdas libres no
 *    toca sólido (ver `ruta-por-el-suelo.ts`), que es lo que permite seguir el
 *    camino con el steering de siempre.
 *  - Fuera de la rejilla la celda NO es libre.
 *  - Desempate DETERMINISTA en el montículo (menor f, luego menor h, luego
 *    menor índice): el sim es reproducible con el mismo seed, y un camino que
 *    dependiera del orden de inserción haría intermitente al banco del NPC.
 *
 *  Un inicio o una meta no libres, o una meta aislada, son `sin-camino`: es un
 *  estado de juego, no una excepción. El tope de expansiones existe porque una
 *  meta encerrada obliga a vaciar la ventana entera (147k celdas, 188 ms
 *  medidos en el plan de la tanda BO) antes de saber que no hay camino. */

export interface RejillaDePaso {
  readonly cols: number;
  readonly rows: number;
  /** ¿Cabe el cuerpo con su centro en el centro de esta celda? Solo se llama
   *  con índices dentro de la rejilla. */
  libre(c: number, r: number): boolean;
}

export type Celda = readonly [number, number];

export type Camino =
  | { ok: true; celdas: ReadonlyArray<Celda>; expansiones: number }
  | { ok: false; motivo: "sin-camino" | "tope"; expansiones: number };

const SQRT2 = Math.SQRT2;

/** Heurística octil: exacta en una rejilla vacía con estos costes. */
function octil(dc: number, dr: number): number {
  const a = Math.abs(dc);
  const b = Math.abs(dr);
  return a > b ? a + (SQRT2 - 1) * b : b + (SQRT2 - 1) * a;
}

/** Montículo binario de índices ordenado por (f, h, índice). Los arrays van
 *  en paralelo para no reservar un objeto por nodo. */
class Monticulo {
  private idx: number[] = [];
  private f: number[] = [];
  private h: number[] = [];

  get vacio(): boolean {
    return this.idx.length === 0;
  }

  private menor(a: number, b: number): boolean {
    if (this.f[a] !== this.f[b]) return this.f[a] < this.f[b];
    if (this.h[a] !== this.h[b]) return this.h[a] < this.h[b];
    return this.idx[a] < this.idx[b];
  }

  private cambiar(a: number, b: number): void {
    const i = this.idx[a];
    this.idx[a] = this.idx[b];
    this.idx[b] = i;
    const f = this.f[a];
    this.f[a] = this.f[b];
    this.f[b] = f;
    const h = this.h[a];
    this.h[a] = this.h[b];
    this.h[b] = h;
  }

  meter(i: number, f: number, h: number): void {
    this.idx.push(i);
    this.f.push(f);
    this.h.push(h);
    let k = this.idx.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!this.menor(k, p)) break;
      this.cambiar(k, p);
      k = p;
    }
  }

  sacar(): number {
    const top = this.idx[0];
    const ult = this.idx.length - 1;
    this.cambiar(0, ult);
    this.idx.pop();
    this.f.pop();
    this.h.pop();
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      const r = l + 1;
      let m = k;
      if (l < this.idx.length && this.menor(l, m)) m = l;
      if (r < this.idx.length && this.menor(r, m)) m = r;
      if (m === k) break;
      this.cambiar(k, m);
      k = m;
    }
    return top;
  }
}

/** Los ocho vecinos: ortogonales primero (el orden no cambia el coste del
 *  camino, solo cuál de los empatados se encuentra, y ese lo fija el
 *  desempate del montículo). */
const VECINOS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** EL CAMINO MÁS CORTO de `inicio` a `meta` por celdas libres, o por qué no.
 *
 *  `expansiones` cuenta las celdas cerradas antes de encontrar la meta; el
 *  resultado es `tope` exactamente cuando hacían falta MÁS de `maxExpansiones`. */
export function buscarCamino(
  rej: RejillaDePaso,
  inicio: Celda,
  meta: Celda,
  maxExpansiones: number,
): Camino {
  const { cols, rows } = rej;
  const dentro = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  const libre = (c: number, r: number) => dentro(c, r) && rej.libre(c, r);
  if (!libre(inicio[0], inicio[1]) || !libre(meta[0], meta[1])) {
    return { ok: false, motivo: "sin-camino", expansiones: 0 };
  }

  // DISPERSO a propósito: la ventana del NPC tiene 147k celdas y un plan típico
  // toca unos cientos. Reservar y rellenar tres buffers de la ventana entera
  // costaba más que la búsqueda en las rutas cortas (perfil de la tanda BO).
  const g = new Map<number, number>();
  const padre = new Map<number, number>();
  const cerrada = new Set<number>();
  const ini = inicio[1] * cols + inicio[0];
  const fin = meta[1] * cols + meta[0];
  const abiertos = new Monticulo();
  g.set(ini, 0);
  const h0 = octil(meta[0] - inicio[0], meta[1] - inicio[1]);
  abiertos.meter(ini, h0, h0);

  let expansiones = 0;
  while (!abiertos.vacio) {
    const i = abiertos.sacar();
    if (cerrada.has(i)) continue;
    if (i === fin) return { ok: true, celdas: reconstruir(padre, fin, cols), expansiones };
    if (expansiones >= maxExpansiones) return { ok: false, motivo: "tope", expansiones };
    expansiones++;
    cerrada.add(i);
    const gi = g.get(i)!;
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr] of VECINOS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!libre(nc, nr)) continue;
      const diagonal = dc !== 0 && dr !== 0;
      // Sin cortar esquinas: la diagonal pide sus dos ortogonales libres.
      if (diagonal && (!libre(c + dc, r) || !libre(c, r + dr))) continue;
      const j = nr * cols + nc;
      if (cerrada.has(j)) continue;
      const gj = gi + (diagonal ? SQRT2 : 1);
      if (gj >= (g.get(j) ?? Infinity)) continue;
      g.set(j, gj);
      padre.set(j, i);
      const hj = octil(meta[0] - nc, meta[1] - nr);
      abiertos.meter(j, gj + hj, hj);
    }
  }
  return { ok: false, motivo: "sin-camino", expansiones };
}

function reconstruir(padre: ReadonlyMap<number, number>, fin: number, cols: number): Celda[] {
  const celdas: Celda[] = [];
  for (let k: number | undefined = fin; k !== undefined; k = padre.get(k)) celdas.push([k % cols, Math.floor(k / cols)]);
  return celdas.reverse();
}
