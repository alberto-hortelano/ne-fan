/** DEL MUNDO A LA REJILLA Y DE VUELTA: la ruta de un NPC en metros (#618).
 *
 *  `busca-camino.ts` busca sobre celdas; esto decide QUÉ celdas, DÓNDE está la
 *  meta y cómo se vuelve a metros. El suelo lo pone quien sabe la colisión —en
 *  producción, el proveedor del bridge con sus TRES fuentes (terreno, plan y
 *  cajas de runtime)—, y NO la `WalkableMap` de `scene-validate.ts`: esa
 *  máscara sale de la escena cruda y no sabe de cajas de runtime, así que una
 *  ruta sobre ella rodearía el granero del tile y cruzaría el del motor (#583
 *  del revés).
 *
 *  Cuatro decisiones, cada una con su porqué:
 *
 *  1. **LA META ES UN SITIO LIBRE** (la mitad de #646 que va dentro de A):
 *     `resolvePlaceTarget` devuelve el centro del `anchor.rect`, y el centro de
 *     un edificio está ocupado (13 de 13 en robledo y puerto). Ningún buscador
 *     llega a una celda sólida, así que la meta pasa por `sitioParaAparecer`,
 *     la MISMA cuenta que pone al jugador en la puerta del lugar
 *     (`handlers/scene.ts`). Una sola idea de «dónde se está en un lugar».
 *
 *  2. **LA VENTANA son los 3×3 tiles alrededor del tile del PUNTO MEDIO**,
 *     alineada con las celdas del terreno (múltiplos de `TILE_MPC`). Con
 *     extremos a ≤ 128 m (`MAX_GOTO_DIST` del NPC) los dos caben siempre: cada
 *     uno está a ≤ 64 m del medio, y la ventana se extiende 64 m más allá del
 *     tile del medio por cada lado. Si la meta libre se ha ido fuera (el
 *     `sitioParaAparecer` la movió), el resultado es `lejos` y no una ruta
 *     inventada.
 *
 *  3. **LA REJILLA ES PEREZOSA**: una celda se pregunta al suelo la primera
 *     vez que el A* la pisa y se memoiza. Rasterizar la ventana entera cuesta
 *     66 ms sin cajas y 160 con 200 (medido en el plan); una ruta típica toca
 *     unas centenas de celdas. «Libre» es el cuerpo con el RADIO EXACTO y el
 *     solape ABIERTO, la convención con la que el sim decide el paso
 *     (`solidoBloquea`): así pasan las puertas de 3 celdas (1,5 m, #289), que
 *     es lo que se pide —«llegan a la puerta»—.
 *
 *  4. **EL ALISADO ES SÓLIDO, no optimista.** De los centros de celda se quedan
 *     solo los puntos donde cambia la línea de vista (string-pulling voraz).
 *     `visible(a, b)` muestrea el segmento cada `MPC/4` y exige libres las
 *     celdas que toca la caja `p ± (MPC/2 + MPC/8)` de cada muestra. Por qué
 *     basta: el cuerpo en `p` (radio `ρ ≥ MPC/2`) queda cubierto por la unión
 *     de los cuerpos centrados en las cuatro celdas que rodean a `p` —para un
 *     punto `q` del cuadrante, `|q − c|² ≤ ρ² − ρ·MPC + MPC²/2 ≤ ρ²` si
 *     `ρ ≥ MPC/2`—, y esas cuatro celdas las toca la caja de cualquier punto a
 *     ≤ `MPC/8` de una muestra. Con `ρ < MPC/2` el argumento no vale, y por eso
 *     es precondición (`RangeError`), no un caso más.
 *
 *  LO QUE NO GARANTIZA: el tramo desde `desde` real hasta su celda de anclaje
 *  y el de la última celda a la `meta` real miden menos de una celda y los
 *  cubre el seguidor local (el abanico del NPC), no esta cuenta. Si la línea de
 *  vista desde el punto real no se puede afirmar, la ruta arranca por el centro
 *  de su celda.
 *
 *  EL COSTE está medido junto al tope que lo acota (`MAX_EXPANSIONES`). */

import { tileWorldRect, worldToTile, TILE_MPC, TILE_CELLS } from "../scene/tile.js";
import { buscarCamino, type Celda, type RejillaDePaso } from "./busca-camino.js";
import { sitioParaAparecer, type SueloSolido } from "./salida-del-solido.js";

export type Punto = { x: number; z: number };

export type Ruta =
  | { ok: true; meta: Punto; puntos: ReadonlyArray<Punto>; expansiones: number }
  | {
    ok: false;
    motivo: "sin-camino" | "tope" | "meta-sin-sitio" | "inicio-encerrado" | "lejos";
    expansiones: number;
  };

/** Tope de celdas cerradas por plan: las de UN tile (128²). Una meta
 *  encerrada vacía la ventana entera (146.656 expansiones, 188 ms medidos en
 *  el plan) antes de saber que no hay camino, y el tope lo corta.
 *
 *  POR QUÉ ESTE NÚMERO Y NO 4.096, que es el que proponía el plan: medido
 *  sobre 200 pares de puntos libres al azar por fixture, TODOS con camino,
 *  robledo necesita hasta 5.078 expansiones y puerto hasta 11.584 (el puerto
 *  obliga a rodear el agua). Con 4.096 fallaban 52 de 200 rutas legítimas del
 *  puerto y 2 de robledo, que volvían al steering que pisa en el sitio. Con
 *  16.384, 0 de 600.
 *
 *  LO QUE CUESTA (Ryzen 7 5800X, Node 26, mediana de 7, `buscarRuta` del
 *  proveedor del bridge con las cajas en foto): meta encerrada en robledo,
 *  19 ms sin cajas de runtime y 29 ms con 200 — el peor plan posible, uno por
 *  tick como mucho y reintentado cada `ESPERA_TRAS_FALLO_S`. Una ruta normal:
 *  p50 0,4–1,2 ms y p90 0,9–9 ms según la fixture. */
export const MAX_EXPANSIONES = 16_384;

/** Tiles de la ventana por lado. */
const TILES_VENTANA = 3;
const LADO = TILES_VENTANA * TILE_CELLS;
/** Paso del muestreo de `visible` y dilatación de su caja (ver cabecera, 4). */
const PASO_VISTA = TILE_MPC / 4;
const SEMI_CAJA_VISTA = TILE_MPC / 2 + PASO_VISTA / 2;

/** La ventana de búsqueda en metros y su rejilla memoizada sobre el suelo. */
class Ventana implements RejillaDePaso {
  readonly cols = LADO;
  readonly rows = LADO;
  readonly x0: number;
  readonly z0: number;
  /** 0 = sin preguntar, 1 = libre, 2 = ocupada. */
  private memo = new Uint8Array(LADO * LADO);

  constructor(
    medio: Punto,
    private readonly radio: number,
    private readonly suelo: SueloSolido,
  ) {
    const t = worldToTile(medio.x, medio.z);
    const rect = tileWorldRect(t.tx - 1, t.ty - 1);
    this.x0 = rect.minX;
    this.z0 = rect.minZ;
  }

  celdaDe(p: Punto): Celda | null {
    const c = Math.floor((p.x - this.x0) / TILE_MPC);
    const r = Math.floor((p.z - this.z0) / TILE_MPC);
    return c >= 0 && r >= 0 && c < LADO && r < LADO ? [c, r] : null;
  }

  centro(c: number, r: number): Punto {
    return { x: this.x0 + (c + 0.5) * TILE_MPC, z: this.z0 + (r + 0.5) * TILE_MPC };
  }

  libre(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= LADO || r >= LADO) return false;
    const i = r * LADO + c;
    if (this.memo[i] === 0) {
      const p = this.centro(c, r);
      this.memo[i] = this.suelo.ocupado(p.x, p.z, this.radio) ? 2 : 1;
    }
    return this.memo[i] === 1;
  }

  /** La celda libre más cercana a `p` entre la suya y sus ocho vecinas. */
  anclar(p: Punto): Celda | null {
    const propia = this.celdaDe(p);
    if (!propia) return null;
    let mejor: Celda | null = null;
    let mejorD = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = propia[0] + dc;
        const r = propia[1] + dr;
        if (!this.libre(c, r)) continue;
        const q = this.centro(c, r);
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < mejorD) {
          mejor = [c, r];
          mejorD = d;
        }
      }
    }
    return mejor;
  }

  /** ¿Puede ir el cuerpo en línea recta de `a` a `b` sin tocar sólido? Sólido
   *  en el sentido de la cabecera (4): si dice que sí, es que sí. */
  visible(a: Punto, b: Punto): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / PASO_VISTA));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (!this.cajaLibre(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  private cajaLibre(x: number, z: number): boolean {
    const c0 = Math.floor((x - SEMI_CAJA_VISTA - this.x0) / TILE_MPC);
    const c1 = Math.floor((x + SEMI_CAJA_VISTA - this.x0) / TILE_MPC);
    const r0 = Math.floor((z - SEMI_CAJA_VISTA - this.z0) / TILE_MPC);
    const r1 = Math.floor((z + SEMI_CAJA_VISTA - this.z0) / TILE_MPC);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) if (!this.libre(c, r)) return false;
    }
    return true;
  }
}

/** Los vértices del camino de celdas: donde cambia el rumbo. Lo que hay entre
 *  dos vértices es una recta de centros de celda y no aporta nada al alisado,
 *  que así mira decenas de puntos y no cientos. */
function vertices(celdas: ReadonlyArray<Celda>): Celda[] {
  if (celdas.length <= 2) return [...celdas];
  const out: Celda[] = [celdas[0]];
  for (let k = 1; k < celdas.length - 1; k++) {
    const [a, b, c] = [celdas[k - 1], celdas[k], celdas[k + 1]];
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) out.push(b);
  }
  out.push(celdas[celdas.length - 1]);
  return out;
}

/** Alisado voraz hacia delante: desde cada punto se avanza mientras el
 *  siguiente se vea. Si desde el punto real no se ve ni el siguiente, se
 *  avanza igual (ver «lo que no garantiza»): ese tramo es el de la celda de
 *  anclaje, y el camino de celdas lo da por bueno. */
function alisar(v: Ventana, pts: Punto[]): Punto[] {
  const out: Punto[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && v.visible(pts[i], pts[j + 1])) j++;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** LA RUTA del cuerpo `(desde, radio)` hasta un sitio libre junto a `hasta`.
 *
 *  `puntos` no incluye `desde` y acaba en `meta`. `RangeError` si el radio es
 *  menor que media celda (el alisado dejaría de ser sólido) o si
 *  `sitioParaAparecer` lo lanza: son precondiciones rotas, no estados. */
export function rutaPorElSuelo(
  desde: Punto,
  hasta: Punto,
  radio: number,
  suelo: SueloSolido,
  maxExpansiones = MAX_EXPANSIONES,
): Ruta {
  if (!(radio >= TILE_MPC / 2)) {
    throw new RangeError(`rutaPorElSuelo: radio ${radio} < media celda (${TILE_MPC / 2} m)`);
  }
  const meta = sitioParaAparecer(hasta, radio, suelo);
  if (!meta) return { ok: false, motivo: "meta-sin-sitio", expansiones: 0 };

  const v = new Ventana({ x: (desde.x + meta.x) / 2, z: (desde.z + meta.z) / 2 }, radio, suelo);
  if (!v.celdaDe(desde) || !v.celdaDe(meta)) return { ok: false, motivo: "lejos", expansiones: 0 };
  const ini = v.anclar(desde);
  if (!ini) return { ok: false, motivo: "inicio-encerrado", expansiones: 0 };
  const fin = v.anclar(meta);
  if (!fin) return { ok: false, motivo: "meta-sin-sitio", expansiones: 0 };

  const camino = buscarCamino(v, ini, fin, maxExpansiones);
  if (!camino.ok) return camino;
  const pts: Punto[] = [desde, ...vertices(camino.celdas).map(([c, r]) => v.centro(c, r)), meta];
  return { ok: true, meta, puntos: alisar(v, pts), expansiones: camino.expansiones };
}
