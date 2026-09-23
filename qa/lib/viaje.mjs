/** UN VIAJE POR EL PANEL «SALIDAS», DE PUNTA A PUNTA — el clic y la espera
 *  que para por ESTADO (#693).
 *
 *  ── EL DEFECTO QUE CIERRA ────────────────────────────────────────────────
 *  Once esperas de viaje en diez guiones (08, 09, 15, 49 ×2, 60, 65, 74, 75,
 *  144, 154) tenían cada una SU predicado de llegada, y siete de ellas no
 *  miraban `window.__nefan.viaje.error`: si el bridge declaraba el viaje roto
 *  —`narrative_status` de error de un `kind` que termina el viaje
 *  (`esperasQueTermina`, `src/protocol/status-reparto.ts`)—, la espera seguía
 *  hasta `MS_DEL_TILE` y salía roja por expiración, sin el nombre de la causa.
 *  Es el MUDO que #656 cerró en el camino del `request_tile`, en el camino del
 *  viaje. Las cuatro que sí lo miraban lo hacían con cuatro copias a mano del
 *  mismo `if (v && v.error) return {__roto}`, y cada una lanzaba a su manera.
 *
 *  ── LO QUE ES «LLEGADO», UNA VEZ ─────────────────────────────────────────
 *  El ledger de viaje del cliente (`nefan-html/src/ui/travel-ledger.ts`) se
 *  cierra con `spawnAplicado` o con `error`, y el bridge pide el spawn TAMBIÉN
 *  al viajar a un lugar ya realizado (`bridge/handlers/scene.ts`). Así que un
 *  viaje ha llegado cuando, sobre el ledger de ESTE viaje:
 *    · el spawn se aplicó,
 *    · el jugador está en OTRO tile que el de partida, y
 *    · su posición cae dentro del `world_rect` de la escena activa (el
 *      `scene_init` se adelanta al `ready` que trae el spawn).
 *  Y ha fallado cuando el ledger de este viaje trae `error`. «De ESTE viaje» es
 *  la otra mitad del defecto, que nadie veía: el ledger sobrevive al episodio,
 *  así que sin comparar `pedido` con el de antes del clic, el `error` de un
 *  viaje ANTERIOR pararía el siguiente, y su `spawnAplicado` lo daría por
 *  llegado sin haberse movido.
 *
 *  Por eso el clic vive aquí: quien abre el registro del ledger es él, y leer
 *  el `pedido` previo y pulsar tienen que ser el mismo paso.
 *
 *  ── LO QUE ESTO NO PARA ──────────────────────────────────────────────────
 *  El RECHAZO de intake: si el bridge rechaza el `player_entered_place` por
 *  contrato, contesta `narrative_status {kind:"protocolo"}`, y ese `kind` NO
 *  termina el viaje (`ESPERA_POR_KIND.protocolo = null`), así que el ledger se
 *  queda abierto y esto paga `MS_DEL_TILE` entero. Arreglarlo es una decisión
 *  del núcleo —¿un rechazo de protocolo sin `placeId` termina el viaje
 *  abierto?— y no del banco; al expirar, al menos, `pasoMuerto` dice que el
 *  bridge no acusó recibo, que es exactamente lo que se vería.
 *
 *  Quién presupuesta con `MS_DEL_TILE` aquí lo canda
 *  `data/contract/esperas-de-tile.json`, y que ningún guion pulse el panel por
 *  su cuenta lo canda el caso (d) de `test/el-cortafuegos-del-tile-tiene-
 *  dueno.test.ts`. La parte pura (`sondaDeViaje`, `pasoMuerto`) se prueba sin
 *  navegador en `nefan-core/test/viaje.test.ts`; que pare DE VERDAD en segundos
 *  con un viaje roto lo mide el guion 168.
 */
import { MS_DEL_TILE } from "./tile-episodio.mjs";
import { esperaExpiradaEn } from "./esperas.mjs";

/** El botón de cada salida del panel. Vive aquí y no en cada guion: el caso
 *  (d) del candado del cortafuegos exige que este literal solo aparezca en
 *  este fichero o en un eximido con motivo. */
const SELECTOR_DE_SALIDA = "#travel-panel button.travel-exit";

/** El panel no ofrece la salida que se pidió. Clase propia para que quien lo
 *  quiera declarar `⊘` (49, 60, 65: sin salida no hay nada que medir) lo
 *  distinga de un viaje que se pidió y no llegó, que es otra cosa. */
export class SalidaAusente extends Error {
  constructor(nombre, botones) {
    super(`el panel «Salidas» no ofrece «${nombre}»; ofrece: ${JSON.stringify(botones)}`);
    this.name = "SalidaAusente";
    this.nombre = nombre;
    this.botones = botones;
  }
}

/** El bridge declaró el viaje roto. Un `Error` sin `EsperaExpirada` en la
 *  cadena, a propósito: `ctx.absorbe` NO lo traga, así que un viaje roto es
 *  ✘ con su causa aunque la espera vaya dentro de un `absorbe`. */
export class ViajeRoto extends Error {
  constructor(mensaje, ledger) {
    super(mensaje);
    this.name = "ViajeRoto";
    this.ledger = ledger;
  }
}

/** Los textos de los botones del panel, en su orden. */
export function botonesDeSalida(ctx) {
  return ctx.page.$$eval(SELECTOR_DE_SALIDA, (bs) => bs.map((b) => (b.textContent ?? "").trim()));
}

/** Pulsa el botón que nombra `nombre` (el camino del jugador: un clic en
 *  «Salidas», no una llamada a la API). `false` si el panel no lo ofrece: cada
 *  llamante decide si eso es rojo o `⊘`. */
export async function pulsarSalida(ctx, nombre) {
  const botones = await botonesDeSalida(ctx);
  const idx = botones.findIndex((t) => t.includes(nombre));
  if (idx < 0) return false;
  await ctx.page.$$eval(SELECTOR_DE_SALIDA, (bs, i) => bs[i].click(), idx);
  return true;
}

/** LA SONDA. Corre DENTRO de la página (Playwright la serializa con
 *  `String(fn)`), así que no puede tocar nada de este módulo: solo
 *  `window.__nefan`. El test la ejecuta serializada contra un `window` de
 *  mentira por eso mismo.
 *
 *  `null` mientras no hay desenlace de ESTE viaje; `{estado:"fallo"}` en cuanto
 *  el ledger nuevo trae `error`; `{estado:"llegado", …}` con la foto de lo que
 *  el jugador tiene delante al llegar. El `error` gana al spawn: un ledger no
 *  puede traer los dos (se cierra con el primero), y si algún día los trajera,
 *  decir el fallo vale más que callarlo. */
export function sondaDeViaje({ desde, pedidoPrevio }) {
  const hook = window.__nefan;
  const v = hook.viaje;
  if (!v || v.pedido === pedidoPrevio) return null;
  if (v.error) return { estado: "fallo", ledger: v };
  if (!v.spawnAplicado) return null;
  const tile = hook.currentTile;
  if (!tile || tile === desde) return null;
  const s = hook.scene;
  const r = s ? s.world_rect : null;
  const p = hook.state().pos;
  if (!r || p.x < r.minX || p.x >= r.maxX || p.z < r.minZ || p.z >= r.maxZ) return null;
  return {
    estado: "llegado",
    tile,
    scene_id: s.scene_id,
    pos: { x: p.x, z: p.z },
    rect: r,
    exits: (hook.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
    ledger: v,
  };
}

/** Qué paso del viaje está muerto, leído del ledger (movido tal cual del guion
 *  09, que era el único que lo nombraba). Sin esto, un viaje que no llega
 *  NUNCA y uno que tarda dan el mismo veredicto —«timeout esperando…»—, que
 *  es lo que dejó el cuelgue del 12,5 % sin diagnosticar durante ocho
 *  corridas. `pedidoPrevio` distingue «no hay ledger de este viaje» de «hay
 *  uno, de otro viaje». */
export function pasoMuerto(l, desde, pedidoPrevio = null) {
  if (!l || l.pedido === pedidoPrevio) {
    return "el cliente no registró este viaje: no llegó ni a pedírselo al bridge";
  }
  if (l.error) return `el bridge abortó el viaje: ${l.error}`;
  if (!l.encolado && !l.escenaRecibida) {
    return "el bridge no acusó recibo (ni «Viajando a…» ni escena): la petición murió antes de la cola, o la rechazó el intake";
  }
  if (!l.escenaRecibida) {
    return `el bridge encoló el viaje (${l.encolado}) pero nunca difundió la escena del destino: el job murió en la cola`;
  }
  if (!l.spawnAplicado) {
    return `la escena ${l.escenaRecibida} llegó, pero nadie pidió el spawn: el jugador se quedó donde estaba`;
  }
  return (
    `el spawn se aplicó en ${JSON.stringify(l.spawnAplicado)} y aun así el jugador no está dentro de otro ` +
    `tile que ${desde}`
  );
}

/** Pulsa la salida `nombre` y espera a que el viaje TERMINE: llegado → la foto
 *  de `sondaDeViaje`; roto → `ViajeRoto` con `pasoMuerto`, al instante; el
 *  panel sin esa salida → `SalidaAusente`, antes de pulsar nada.
 *
 *  Al expirar el cortafuegos se relanza un `Error` que NOMBRA el paso muerto y
 *  lleva la `EsperaExpirada` como `cause`: así `ctx.absorbe` la sigue
 *  reconociendo (busca por la cadena, `esperaExpiradaEn`) y el ⊘ de los
 *  guiones que absorben no se convierte en ✘ por añadir el diagnóstico. */
export async function viajarPorSalidas(ctx, nombre, desc) {
  const antes = await ctx.page.evaluate(() => ({
    tile: window.__nefan.currentTile,
    pedido: window.__nefan.viaje?.pedido ?? null,
  }));
  if (!(await pulsarSalida(ctx, nombre))) throw new SalidaAusente(nombre, await botonesDeSalida(ctx));
  let r;
  try {
    r = await ctx.waitFor(desc, sondaDeViaje, MS_DEL_TILE, { desde: antes.tile, pedidoPrevio: antes.pedido });
  } catch (err) {
    if (!esperaExpiradaEn(err)) throw err;
    const l = await ctx.page.evaluate(() => window.__nefan.viaje);
    throw new Error(
      `${desc}: ${pasoMuerto(l, antes.tile, antes.pedido)} (agotó el cortafuegos del tile) · ledger=${JSON.stringify(l)}`,
      { cause: err },
    );
  }
  if (r.estado === "fallo") {
    throw new ViajeRoto(
      `${desc}: ${pasoMuerto(r.ledger, antes.tile, antes.pedido)} · ledger=${JSON.stringify(r.ledger)}`,
      r.ledger,
    );
  }
  return r;
}
