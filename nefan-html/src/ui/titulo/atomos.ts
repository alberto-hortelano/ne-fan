/** Los ÁTOMOS del título: el vocabulario que comparten sus pantallas.
 *
 *  Primer corte de #346. Aquí vive lo que tiene DOS O MÁS dueños entre las
 *  siete pantallas —las constantes de CSS, los escapes, las URLs de los dos
 *  servicios y la portada— y nada más: lo que solo usa una pantalla viaja con
 *  ella, a su módulo, en su PR. El criterio no es de gusto sino medido (quién
 *  llama a qué), porque el fallo que este troceo tiene que evitar es el
 *  god-file repartido: un módulo «común» que acaba tocando cualquier retoque
 *  de UI y que todos importan.
 *
 *  Por eso este fichero es la ÚNICA excepción del candado
 *  `las-hojas-del-titulo-no-se-atan-entre-si` (arch-rules.json): un módulo de
 *  `ui/titulo/` no puede importar a otro salvo a éste. Y puede serlo porque no
 *  tiene nada que atar — cero estado, cero `this`: son constantes, tipos y
 *  funciones que reciben datos y devuelven string. El día que algo de aquí
 *  necesite un colaborador, no es un átomo y no es de aquí.
 *
 *  CON UNA SALVEDAD MEDIDA, que no es «cero colaboradores» del todo: las dos
 *  constantes de URL de abajo llaman a `serviceUrl` AL CARGAR el módulo, y
 *  `serviceUrl` lee `location.search`. O sea que importar este fichero en Node
 *  revienta con `location is not defined` — QA-1 (H6) lo descubrió al tener que
 *  stubear el DOM para poder medirlo. Importa porque este módulo lo van a
 *  importar las SIETE hojas del título, así que mientras siga así ninguna se
 *  puede testear en Node sin arrastrar ese stub. Hacerlas perezosas (funciones
 *  en vez de constantes) ARREGLA eso —probado— pero perturbó dos corridas de
 *  dos del guion 80 sin que nadie encontrara el mecanismo, así que NO viaja en
 *  esta PR de movimiento: tiene issue propio. Un cambio que no se sabe explicar
 *  no entra en la PR que promete no cambiar el comportamiento.
 *
 *  La excepción declarada al criterio de los dos dueños es la TARJETA de mundo
 *  (`worldCardHtml` + `generationChipsHtml`), que hoy solo pinta el selector:
 *  partir la tarjeta entre dos módulos —la caja de la portada aquí, el resto
 *  allí— es peor que tenerla entera en un sitio. Al cerrar #346 esa excepción
 *  dejó de ser un juicio y tiene su NÚMERO: devolverle la tarjeta al selector
 *  lo llevaría de 432 a ~471 líneas, o sea POR ENCIMA del tope de 450 que este
 *  programa acaba de conseguir. Se queda medida, no opinada.
 *
 *  LA TRAYECTORIA, para que nadie tenga que reconstruirla (#558): del primer
 *  corte al sexto este fichero fue de 196 a 218 líneas, y las 22 que subió son
 *  PROSA — el código BAJÓ de 98 a 95 líneas y los exports de 19 a 17, porque
 *  los cortes se llevaron de aquí más de lo que trajeron. Por eso NO tiene
 *  tope propio y sigue bajo el régimen general de 450
 *  (`data/contract/client-file-size.json`): un número recortado a la medida de
 *  este fichero estaría midiendo sobre todo el comentario que lo explica, y
 *  ponerlo hoy sería inventarse un umbral — el anti-patrón que
 *  `quality-thresholds.json` prohíbe por escrito.
 *
 *  LA SEÑAL DE ACTUAR, y va AQUÍ porque es donde se lee justo cuando toca:
 *  añadiendo un export. Se actúa —trocear los átomos, o devolverle a su
 *  pantalla lo que se coló— cuando pase una de estas dos:
 *
 *    1. el export nuevo entra con UN SOLO dueño y sin excepción declarada
 *       arriba (eso es lo de una pantalla viajando de gorra en el vocabulario
 *       común, que es el god-file repartido empezando otra vez); o
 *    2. el censo de exports con DOS O MÁS dueños baja de la mitad.
 *
 *  Hoy son **9 de 17**, y «dueño» es una HOJA de `ui/titulo/` que lo importa:
 *  ni el enrutador ni este fichero cuentan. Los OCHO que no llegan a dos son
 *  exactamente las dos excepciones de arriba —los cinco de la tarjeta de mundo
 *  (`worldCardHtml`, `generationChipsHtml`, `COVER_BOX`, `COVER_MARK_CSS`,
 *  `marcadorHtml`) y `BADGE_CSS`— más las dos URL de servicio: o sea que hoy
 *  el censo no tiene ni un hueco sin motivo escrito, y esa es la condición que
 *  el punto 1 vigila. El número se RECUENTA, no se cree:
 *
 *      grep -c "^export " nefan-html/src/ui/titulo/atomos.ts
 *      grep -lw <export> nefan-html/src/ui/titulo/*.ts | grep -v atomos.ts | wc -l
 */
import type { GameInfo, StyleInfo } from "../../net/narrative-client.js";
import { serviceUrl } from "../../net/service-urls.js";

export type TitleAction =
  | { kind: "resume"; sessionId: string }
  | {
      kind: "new_game";
      gameId: string;
      /** Estilo visual elegido ("" = el por defecto del juego). */
      styleId: string;
      /** Modo de render, congelado en la sesión: imagen IA o maqueta 3D clay
       *  (id interno "vector", heredado del compositor SVG — congelado en
       *  saves y contratos, NO renombrar). */
      renderMode: "image" | "vector";
      /** Modo de imagen de los PERSONAJES (skins IA vs base y_bot),
       *  independiente de los escenarios. */
      characterMode: "image" | "vector";
      appearance: { model_id: string; skin_path: string };
    };

/** A DÓNDE va el título cuando una pantalla termina.
 *
 *  El tipo que hace posible el troceo: sin él, cada pantalla necesitaría un
 *  puñado de callbacks de navegación (uno por destino) y el corte
 *  reintroduciría por la puerta de atrás el objeto de contexto que esta casa
 *  rechaza. Con él, una pantalla tiene UN colaborador de vuelta —`ir(destino)`—
 *  y quien enruta es la raíz, que es la única que puede importarlas todas.
 *
 *  Lo estrena la PR 2 de #346; nace aquí porque el candado no deja que dos
 *  hojas compartan un tipo por ningún otro camino.
 *
 *  Los dos modos del editor son los literales y NO el `Modo` de core, que la
 *  PR 1 escribió aquí sin consumidor: `Modo` incluye `""` («sin elegir») y el
 *  editor de personaje exige uno de los dos: quien llega hasta él ya eligió en
 *  el selector. Con `Modo`, el enrutador de la PR 2 no compilaba. Es el mismo
 *  par de literales que usa `TitleAction` doce líneas más arriba, que es a
 *  donde va a parar esta elección. */
export type DestinoDelTitulo =
  | { a: "home"; aviso?: string; tono?: "error" | "aviso" }
  | { a: "selector"; preselect?: string }
  | { a: "crear-mundo" }
  | { a: "subir-estilo" }
  | {
      a: "editor";
      game: GameInfo;
      styleId: string;
      /** Los dos modos son `"image" | "vector"` y no `Modo`: el `""` de core
       *  significa «sin decidir» y aquí ya está decidido — es lo que viaja
       *  dentro de `TitleAction`, que no admite el vacío. */
      renderMode: "image" | "vector";
      characterMode: "image" | "vector";
    };

/** asset-store — sirve las covers de los estilos como estáticos, con o sin
 *  ai_server (movido desde el State API en F2; preset 4 arranca el store). */
export const ASSET_STORE_URL = serviceUrl("asset-store");
/** remote-gen (proceso propio desde F4) — subida de estilos y generación de las
 *  categorías que falten (Meshy). Sin él, "Subir estilo" falla con error
 *  visible. */
export const AI_SERVER_HTTP = serviceUrl("remote-gen");

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export const BTN_PRIMARY_CSS = [
  "background:#da6","color:#111","border:none","padding:10px 22px",
  "font-family:inherit","font-size:14px","cursor:pointer","border-radius:3px",
].join(";");
export const BTN_SECONDARY_CSS = [
  "background:transparent","color:#999","border:1px solid #444","padding:10px 22px",
  "font-family:inherit","font-size:14px","cursor:pointer","border-radius:3px",
].join(";");
// Los dos botones pequeños de la fila de save (`BTN_SMALL_PRIMARY_CSS` y
// `BTN_SMALL_DANGER_CSS`) vivían aquí y se fueron a `home.ts` al cerrarse #346:
// el censo por importador dio UN dueño, el home, así que dejaron de ser
// vocabulario en cuanto la PR 4 sacó esa pantalla. Ver la cabecera.
export const SELECT_CSS = [
  "width:100%","padding:8px 10px","background:#1a1a22","color:#ddd",
  "border:1px solid #444","font-family:inherit","font-size:13px",
].join(";");
export const INPUT_CSS = SELECT_CSS;

/** El badge base. Su ÚNICO importador de fuera es `home.ts` (el badge de modo
 *  del save), así que por el censo de importadores tocaba irse con él al cerrar
 *  #346 — como se fueron los dos botones pequeños de arriba. **Se queda, y el
 *  motivo es el candado**: `generationChipsHtml`, aquí abajo, lo usa para los
 *  chips de la tarjeta de mundo. Si la constante se mudara a `home.ts`, este
 *  fichero tendría que importarla de vuelta, y `las-hojas-del-titulo-no-se-atan-entre-si`
 *  prohíbe exactamente eso. El censo por IMPORTADOR no ve el uso que un módulo
 *  hace de lo suyo: con ese uso dentro, BADGE_CSS tiene dos dueños y es
 *  vocabulario. */
export const BADGE_CSS = "display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;background:#23222c;border:1px solid #3a3846;color:#a99";

/** Chips de estado de generación de la tarjeta: si el mundo está generado y
 *  qué estilos aplicados — "los generados" visibles de un vistazo. */
export function generationChipsHtml(g: GameInfo): string {
  const STATUS_CHIP: Record<string, { icon: string; color: string }> = {
    ready: { icon: "✓", color: "#4a4" },
    stale: { icon: "⟳", color: "#da6" },
    missing: { icon: "—", color: "#555" },
  };
  const chip = (label: string, status: string): string => {
    const s = STATUS_CHIP[status] ?? STATUS_CHIP.missing;
    return `<span style="${BADGE_CSS};color:${s.color}">${escapeHtml(label)} ${s.icon}</span>`;
  };
  const chips = [
    chip("Mundo", g.generation ?? "missing"),
    ...(g.styles_applied ?? []).map((a) => chip(`🎨 ${a.style_id}`, a.status)),
  ];
  return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${chips.join(" ")}</div>`;
}

/** Caja de la portada. 3:2 — la MISMA proporción a la que se capturan
 *  (`qa/capturar-portadas.mjs`, viewport 1536×1024), así que `object-fit:
 *  cover` no recorta nada. A 96×64 una captura de juego era un sello de
 *  correos: la portada existe para enseñar qué se va a ver, y a ese tamaño
 *  no enseñaba nada. */
const COVER_W = 192;
const COVER_H = 128;
export const COVER_BOX = `width:${COVER_W}px;height:${COVER_H}px;flex:none;border:1px solid #333`;

/** La portada NO elige entre imagen y marcador (#218): el marcador —el nombre
 *  del ESTILO— está SIEMPRE debajo y la imagen se pinta encima cuando hay
 *  `cover_url`. Antes eran dos ramas excluyentes, así que una portada
 *  declarada que no llegaba (el asset-store caído, un pack a medias, el fake
 *  del bench sin esa ruta) dejaba el icono de imagen rota del navegador: lo
 *  primero que ve quien abre el juego, y sin rastro en ningún sitio. Con el
 *  marcador debajo, quitar el `<img>` basta para degradar a algo legible —lo
 *  hace `vigilarPortadas`, que además deja la entrada en el error-log. */
export const COVER_MARK_CSS =
  "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:11px;text-align:center;padding:4px";

/** El marcador que hay debajo de toda portada, en sus DOS estados, y juntos a
 *  propósito: son lo mismo visto por quien mira la tarjeta, y hasta ahora se
 *  veían IGUAL.
 *
 *  - `hueco`: el pack no declara portada (`cover_url` ausente — `loader.ts`
 *    solo la pone si el fichero existe). Nada ha fallado: es un mundo sin arte
 *    de portada todavía, y se pinta apagado y en silencio.
 *  - `fallo`: la portada estaba declarada y NO llegó (asset-store caído, pack
 *    a medias, ruta que el bench no sirve). Eso es una avería y se dice, con
 *    el mismo texto que el registro de errores guarda entero.
 *
 *  Sin la diferencia, un asset-store caído y un pack sin arte eran el mismo
 *  cuadro gris y lo único que los separaba era una entrada del error-log que
 *  el título esconde (#218; hallazgo C2/H2 de QA). */
export function marcadorHtml(nombre: string, fallo: boolean): string {
  const fondo = fallo
    ? "background:linear-gradient(135deg,#2c211d,#1a1512);border:1px solid #6b4636"
    : "background:linear-gradient(135deg,#23202b,#161419)";
  const aviso = fallo
    ? `<div data-cover-aviso style="color:#c9825e;font-size:10px;letter-spacing:0.3px">⚠ portada no disponible</div>`
    : "";
  return `<div data-cover-marker style="${COVER_MARK_CSS};${fondo};color:${fallo ? "#9a8880" : "#555"}"><div data-cover-nombre>${escapeHtml(nombre)}</div>${aviso}</div>`;
}

export function coverHtml(g: GameInfo, style: StyleInfo | undefined): string {
  const marcador = marcadorHtml(style?.name ?? g.style_id, false);
  const img = style?.cover_url
    ? `<img data-cover-img="${escapeAttr(style.style_id)}" alt="${escapeAttr(style.name)}" src="${escapeAttr(ASSET_STORE_URL + style.cover_url)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">`
    : "";
  return `<div data-cover-for="${escapeAttr(g.game_id)}" style="${COVER_BOX};overflow:hidden;position:relative">${marcador}${img}</div>`;
}

export function worldCardHtml(g: GameInfo, style: StyleInfo | undefined): string {
  return `
    <div data-game-id="${escapeAttr(g.game_id)}" style="display:flex;gap:12px;padding:10px;background:#181820;border:2px solid #2a2a30;cursor:pointer;border-radius:4px">
      ${coverHtml(g, style)}
      <div style="flex:1;min-width:0">
        <div style="color:#dcb;font-size:14px;margin-bottom:3px">${escapeHtml(g.title)} <span data-style-label-for="${escapeAttr(g.game_id)}" style="color:#666;font-size:11px;font-weight:normal">· Estilo: ${escapeHtml(style?.name ?? g.style_id)}</span></div>
        <div style="color:#999;font-size:11px;line-height:1.45">${escapeHtml(g.description)}</div>
        ${generationChipsHtml(g)}
      </div>
    </div>
  `;
}
