/** La TARJETA de una partida guardada: la fila `.ts-save` que el home pinta
 *  una vez por save, con su resumen, su fecha, sus dos botones y los badges que
 *  cambian el modo del save ANTES de cargarlo.
 *
 *  Sale de `ui/titulo/home.ts` en #663, y sale entera —fila, badges, botones
 *  pequeños y el formato de fecha—: partirla entre dos módulos es lo que el
 *  propio `atomos.ts` mide como peor que tenerla en un sitio.
 *
 *  ES PURA: recibe `SessionMetadata` y devuelve string. Ni DOM, ni red, ni
 *  reloj — quien engancha los clicks de esos botones es el home, que es quien
 *  tiene el elemento. Por eso entra en el banco (`nefan-html/test/`), y por eso
 *  la clase `ts-save` que pinta aquí se puede comparar con la que el chasis
 *  cuenta, fuera del navegador.
 *
 *  POR QUÉ VIVE EN `ui/` Y NO EN `ui/titulo/`, que es donde se pinta: los dos
 *  candados del título. Una hoja de `ui/titulo/` solo puede importar
 *  `atomos.ts` (`las-hojas-del-titulo-no-se-atan-entre-si`), así que estando
 *  dentro no podría alcanzar sus escapes salvo colándose en el vocabulario
 *  común — el cajón que aquel fichero existe para impedir. Desde fuera importa
 *  `ui/atomos-de-html.ts`, que nació con este corte por este motivo.
 *
 *  QUÉ NO DECIDE: nada de juego. El modo efectivo de una faceta lo dice core
 *  (`modoEfectivoDePersonajes`, `nefan-core/src/session/gates-de-imagen.ts`);
 *  aquí solo se pinta lo que conteste.
 */
import type { SessionMetadata } from "@nefan-core/src/narrative/types.js";
import { CONFIG } from "@nefan-core/src/config.js";
import {
  modoEfectivoDePersonajes,
  normalizarModo,
  type Modo,
} from "@nefan-core/src/session/gates-de-imagen.js";
import { BADGE_CSS, escapeAttr, escapeHtml } from "./atomos-de-html.js";
import {
  CHAR_MODE_LABELS,
  costeDelModo,
  RENDER_MODE_ICONS,
  RENDER_MODE_LABELS,
} from "./mode-labels.js";

/** Los dos botones de la fila de una partida guardada. Vivían en `atomos.ts`
 *  hasta el cierre de #346 y de ahí se fueron a `home.ts`: el censo por
 *  importador dio UN dueño —esta fila— en cuanto la PR 4 sacó la pantalla, y
 *  lo que tiene un dueño viaja con él. En #663 el dueño se independiza del
 *  home y ellos viajan otra vez, por el mismo criterio y sin discutirlo. */
const BTN_SMALL_PRIMARY_CSS = [
  "background:#3a6","color:#fff","border:none","padding:5px 12px",
  "font-family:inherit","font-size:12px","cursor:pointer","border-radius:3px",
].join(";");
const BTN_SMALL_DANGER_CSS = [
  "background:transparent","color:#a55","border:1px solid #533","padding:5px 12px",
  "font-family:inherit","font-size:12px","cursor:pointer","border-radius:3px",
].join(";");

/** Modo de una faceta del save; la regla (personajes sin campo sigue a escenarios) es de core.
 *
 *  Exportada porque `onModeBadge` (en `home.ts`, que es quien engancha el
 *  click) necesita saber de qué modo se parte para decidir a cuál se va. */
export function modoDelSave(s: SessionMetadata, facet: "scenes" | "characters"): Modo {
  const renderMode = normalizarModo(s.render_mode);
  return facet === "scenes" ? renderMode : modoEfectivoDePersonajes({ renderMode, characterMode: normalizarModo(s.character_mode) });
}

/** Badge de modo CLICABLE (selector antes de cargar): misma silueta que el
 *  badge informativo, con cursor y hover del lado de button. */
const MODE_BADGE_CSS = `${BADGE_CSS};cursor:pointer;font-family:inherit`;

/** Badge-selector del modo de una faceta del save. Click = alternar
 *  image⇄vector ANTES de cargar (onModeBadge). Saves legacy sin el campo: sin
 *  badge (no adivinar). */
function modeBadgeHtml(s: SessionMetadata, facet: "scenes" | "characters", paga: boolean): string {
  const mode = modoDelSave(s, facet);
  if (mode !== "image" && mode !== "vector") return "";
  const labels = facet === "scenes" ? RENDER_MODE_LABELS : CHAR_MODE_LABELS;
  const target = mode === "image" ? "vector" : "image";
  const facetEs = facet === "scenes" ? "Escenarios" : "Personajes";
  // Encender skins con el backend apagado por config: badge muerto con motivo
  // (mismo criterio que el chip de gráficos).
  const blocked = facet === "characters" && target === "image" && !CONFIG.graphics.ai_skin;
  const title = blocked
    ? "Backend de skins apagado por config: activa graphics.ai_skin en nefan-core/src/config.ts"
    : `${facetEs}: click para cambiar a ${labels[target]} antes de cargar (${costeDelModo(target, paga)})`;
  return `<button data-mode-facet="${facet}" data-session-id="${escapeAttr(s.session_id)}"${blocked ? " disabled" : ""} title="${escapeAttr(title)}" style="${MODE_BADGE_CSS}${blocked ? ";opacity:.45;cursor:default" : ""}">${RENDER_MODE_ICONS[mode]} ${escapeHtml(labels[mode])}</button>`;
}

/** La fila de un save. `class="ts-save"` NO es decoración: es lo que la banda
 *  de «↓ hay N partidas más» del chasis cuenta para saber cuántas quedan fuera
 *  de la columna (`loQueCuentaLaBanda` en `ui/titulo/chasis.ts`). Renombrarla
 *  dejaba el aviso mudo en silencio; desde #663 lo dice el banco. */
/** `paga`: qué pagaría encender Imagen IA en cada faceta
 *  (`loQuePagaImagenIA`, core), para que el tooltip del badge no prometa gasto
 *  en desarrollo (QA de la tanda AS, H1). */
export function tarjetaDePartidaHtml(s: SessionMetadata, paga: { escenarios: boolean; personajes: boolean }): string {
  const summary = s.summary || "(sin narrativa todavía)";
  const updated = s.updated_at ? formatDate(s.updated_at) : "?";
  const badges = [
    modeBadgeHtml(s, "scenes", paga.escenarios),
    modeBadgeHtml(s, "characters", paga.personajes),
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="ts-save" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;background:#181820;border:1px solid #2a2a30">
      <div style="flex:1;min-width:0">
        <div style="color:#bdf;font-size:13px">${escapeHtml(s.game_id)} <span style="color:#666;font-size:11px">· ${escapeHtml(s.session_id)}</span>${badges ? " " + badges : ""}</div>
        <div style="color:#999;font-size:12px;margin-top:3px">${escapeHtml(summary)}</div>
        <div style="color:#666;font-size:11px;margin-top:3px">${updated} · ${s.scene_count} escenas · ${s.entity_count} entidades</div>
      </div>
      <div style="display:flex;gap:6px;margin-left:14px">
        <button data-action="resume" data-session-id="${escapeAttr(s.session_id)}" style="${BTN_SMALL_PRIMARY_CSS}">Reanudar</button>
        <button data-action="delete" data-session-id="${escapeAttr(s.session_id)}" style="${BTN_SMALL_DANGER_CSS}">Borrar</button>
      </div>
    </div>
  `;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
