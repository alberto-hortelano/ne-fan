/** CUÁNTO TARDA UN TILE DEL BRIDGE EN LLEGAR AL CLIENTE, con el motor falso y
 *  en esta máquina — la DISTRIBUCIÓN, no un caso (#677).
 *
 *  Quince esperas del banco tienen por sujeto «un tile del bridge» y hasta
 *  #677 presupuestaban con cuatro números (60, 90, 180 y 240 s) que nadie
 *  había medido contra nada. Esto es la medida, con recibo: 32 tiles de los anillos
 *  2 y 3 pedidos por el cable en UNA partida (`handleRequestTile` no exige
 *  adyacencia y `makeTile` del falso fabrica cualquier `(tx,ty)`), cada uno
 *  cronometrado DESDE NODE alrededor de `pedirYEsperarTile` —o sea lo que paga
 *  el banco, con sus dos `evaluate` y la cadencia de 150 ms de `waitFor`
 *  dentro—, y de ahí p50, p95 y máximo.
 *
 *  ── LO QUE ESTA MEDIDA PUEDE DECIR Y LO QUE NO ──────────────────────────
 *  Es un SUELO, no la fuente del número. El motor falso contesta con retraso 0
 *  (`labs/narrative/fake-ai-server.ts`, `TILE_DELAY_MS ?? 0`), así que lo que
 *  se mide es el camino entero del bridge —cola, `runTileGeneration`,
 *  normalización, difusión— y la entrada del tile en el cliente, sin el LLM.
 *  Con ese suelo, cualquier cortafuegos entre 10 s y 240 s es defendible: el
 *  número lo decide el coste del CUELGUE y está escrito junto a `MS_DEL_TILE`
 *  en `qa/lib/tile-episodio.mjs`. Lo que ESTE guion afirma es que el
 *  cortafuegos está al menos a 10× del p95 medido hoy, en esta máquina —si un
 *  día el bridge se hace diez veces más lento por el camino feliz, esto se
 *  pone rojo ANTES de que alguien suba el número «porque rozaba»—. Y afirma
 *  que los 32 los sirvió el MOTOR (el contador del falso sube 32), porque un
 *  tile de caché llega en otros milisegundos y sería otra medida.
 *
 *  FUERA, y se dice: la medida «en CI» (no hay runner de navegador en ningún
 *  job) y «con el motor real» (gasta créditos y es otro contrato). Y no se
 *  corre bajo el dial de carga de `qa/bajo-carga.mjs`: el suelo es el de la
 *  máquina en reposo, y bajo carga lo que se mide es otra cosa (#545).
 *
 *  La medida del día en que nació (2026-09-20, Ryzen 7 5800X, con otras once
 *  tandas encima y `load 19`): ver la fila de `qa/README.md`, que es donde se
 *  actualiza; aquí solo se deja dicho que se midió con N = 32, tres corridas,
 *  y que el aserto del suelo nació con 335×, 508× y 455× de margen. **Probado en negativo**:
 *  `TILE_DELAY_MS=12000` al falso → el p95 sube a ~12 s y se pone ROJO el
 *  aserto del suelo (12 s × 10 > 90 s) y NO el de «llegado»: distinguir «va
 *  lento» de «no llega» es la razón de que sean dos asertos.
 *
 *  Cero créditos: `aisla: ["saves", "fake-ai"]`, motor falso.
 */
import { URLS } from "../lib/stack.mjs";
import { comenzar, nuevaPartida, pedirYEsperarTile } from "../lib/sesion.mjs";
import { LLEGADO, MS_DEL_TILE } from "../lib/tile-episodio.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME = "alta_fantasia";
/** Treinta y dos: N ≥ 30 para poder hablar de percentiles, y dos anillos
 *  enteros no hacen falta (2 → 16 tiles, 3 → 24): se toman los 16 del anillo
 *  2 y los 16 primeros del 3. */
const MUESTRAS = 32;
/** El cortafuegos tiene que estar al menos a ESTO del p95 medido. No es la
 *  `HOLGURA_DEL_TECHO` de un reloj (1,25×, varianza entre corridas): es el
 *  margen que separa «el camino feliz» de «un cuelgue», y si se pone rojo con
 *  los tiles llegando, es la máquina —se dice con las tres cifras— y no se
 *  sube el 10× ni el número. */
const HOLGURA_MINIMA = 10;

/** Los tiles cuyo radio de Chebyshev es exactamente `n`, en orden estable. */
function anillo(n) {
  const out = [];
  for (let ty = -n; ty <= n; ty += 1) {
    for (let tx = -n; tx <= n; tx += 1) {
      if (Math.max(Math.abs(tx), Math.abs(ty)) === n) out.push([tx, ty]);
    }
  }
  return out;
}

/** Percentil por rango más próximo (nearest-rank), sobre una copia ordenada:
 *  con N = 32, p50 es el 16.º y p95 el 31.º. Sin interpolar, para que cada
 *  cifra sea una muestra que existió. */
function percentil(xs, p) {
  const ord = [...xs].sort((a, b) => a - b);
  const k = Math.max(1, Math.ceil((p / 100) * ord.length));
  return ord[k - 1];
}

/** Cuántas veces ha cobrado el fake por `/generate_scene`: la medida de «fue
 *  el motor» frente a «fue la caché». Mismo helper que el 120 y el 127. */
async function generacionesServidas() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters HTTP ${r.status}`);
  const c = await r.json();
  return c?.gasto?.rutas?.["/generate_scene"] ?? 0;
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  const coords = [...anillo(2), ...anillo(3)].slice(0, MUESTRAS);
  const antes = await generacionesServidas();
  const tiempos = [];
  const estados = {};
  for (const [tx, ty] of coords) {
    const key = `tile_${tx}_${ty}`;
    const t0 = performance.now();
    // Si una espera EXPIRA, `pedirYEsperarTile` deja el ✘ y LANZA (H-4 de
    // #687): el guion termina ahí con `ERROR:` y no mide 31 cuelgues más.
    const v = await pedirYEsperarTile(ctx, key, tx, ty);
    const dt = performance.now() - t0;
    estados[v.estado] = (estados[v.estado] ?? 0) + 1;
    if (v.estado === LLEGADO) tiempos.push(dt);
  }
  const despues = await generacionesServidas();

  const n = tiempos.length;
  const p50 = n ? percentil(tiempos, 50) : NaN;
  const p95 = n ? percentil(tiempos, 95) : NaN;
  const max = n ? Math.max(...tiempos) : NaN;
  const ms = (x) => `${Math.round(x)} ms`;
  ctx.log(`N = ${n} llegados de ${coords.length} pedidos · estados ${JSON.stringify(estados)}`);
  ctx.log(`p50 ${ms(p50)} · p95 ${ms(p95)} · máx ${ms(max)} · mín ${ms(Math.min(...tiempos))}`);
  ctx.log(`muestras (ms): [${tiempos.map((t) => Math.round(t)).join(", ")}]`);
  ctx.log(`cortafuegos MS_DEL_TILE = ${MS_DEL_TILE} ms → ${(MS_DEL_TILE / p95).toFixed(1)}× el p95`);

  ctx.expect(
    `los ${coords.length} tiles llegaron al mundo del cliente (N suficiente para hablar de distribución)`,
    n === coords.length && n >= 30,
    JSON.stringify(estados),
  );
  ctx.expect(
    `los ${coords.length} los sirvió el MOTOR, no la caché: /generate_scene sube exactamente ${coords.length}`,
    despues - antes === coords.length,
    `/generate_scene ${antes} → ${despues}`,
  );
  ctx.expect(
    `el cortafuegos está al menos a ${HOLGURA_MINIMA}× del p95 medido (p95 × ${HOLGURA_MINIMA} ≤ MS_DEL_TILE)`,
    n > 0 && p95 * HOLGURA_MINIMA <= MS_DEL_TILE,
    `p95 ${ms(p95)} × ${HOLGURA_MINIMA} = ${ms(p95 * HOLGURA_MINIMA)} contra ${MS_DEL_TILE} ms`,
  );
}
