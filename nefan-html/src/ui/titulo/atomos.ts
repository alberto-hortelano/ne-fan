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
 *  allí— es peor que tenerla entera en un sitio, y además es lo que deja al
 *  selector por debajo del tope de 450 cuando le toque salir.
 */
import type { GameInfo, StyleInfo } from "../../net/narrative-client.js";
import type { Modo } from "@nefan-core/src/session/gates-de-imagen.js";
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
 *  hojas compartan un tipo por ningún otro camino. */
export type DestinoDelTitulo =
  | { a: "home"; aviso?: string; tono?: "error" | "aviso" }
  | { a: "selector"; preselect?: string }
  | { a: "crear-mundo" }
  | { a: "subir-estilo" }
  | { a: "editor"; game: GameInfo; styleId: string; renderMode: Modo; characterMode: Modo };

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
export const BTN_SMALL_PRIMARY_CSS = [
  "background:#3a6","color:#fff","border:none","padding:5px 12px",
  "font-family:inherit","font-size:12px","cursor:pointer","border-radius:3px",
].join(";");
export const BTN_SMALL_DANGER_CSS = [
  "background:transparent","color:#a55","border:1px solid #533","padding:5px 12px",
  "font-family:inherit","font-size:12px","cursor:pointer","border-radius:3px",
].join(";");
export const SELECT_CSS = [
  "width:100%","padding:8px 10px","background:#1a1a22","color:#ddd",
  "border:1px solid #444","font-family:inherit","font-size:13px",
].join(";");
export const INPUT_CSS = SELECT_CSS;

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
