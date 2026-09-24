/** Aplicación del tema de UI del estilo activo.
 *
 *  El tema lo declara el style pack (`ui` en su style.json, schema en
 *  nefan-core/src/games/ui-theme.ts) y llega al cliente en `session_started`
 *  — recalculado por el bridge en start Y en resume, así que retocar una
 *  paleta y reanudar la partida basta para verla.
 *
 *  Los tokens se escriben en #game-ui, NO en :root: la UI de desarrollo
 *  (barra de estado, menú de imágenes, error-log) vive fuera de ese árbol y
 *  no puede verse alterada por el tema de un pack — que puede haberlo subido
 *  un jugador. El tema base vive en game-ui.css; aquí solo se sobrescribe. */
import { BASE_UI_THEME, VELO_DEL_MURO, type UiTheme } from "@nefan-core/src/games/ui-theme.js";

export type { UiTheme };
export { BASE_UI_THEME };

/** Campo del tema → custom property. Fuente única de los nombres. */
const CSS_VAR: Record<keyof UiTheme, string> = {
  surface: "--nf-surface",
  raised: "--nf-raised",
  border: "--nf-border",
  ink: "--nf-ink",
  ink_dim: "--nf-ink-dim",
  accent: "--nf-accent",
  accent_ink: "--nf-accent-ink",
  danger: "--nf-danger",
  fade: "--nf-fade",
  font: "--nf-font",
  font_display: "--nf-font-display",
  radius_px: "--nf-radius",
  hairline_px: "--nf-hairline",
  tracking_em: "--nf-tracking",
  glow: "--nf-glow",
};

/** Se emite en `#game-ui` al terminar de aplicar un tema, SÍNCRONO: quien
 *  mide algo que depende de él (la barra de ataques, cuyo ancho cambia con la
 *  fuente) lo mide ya, sin esperar al siguiente fotograma. */
export const EVENTO_TEMA_APLICADO = "nf-tema-aplicado";

let current: UiTheme = BASE_UI_THEME;

function root(): HTMLElement | null {
  return document.getElementById("game-ui");
}

/** Vuelca el tema en las custom properties de #game-ui. Idempotente. */
export function applyUiTheme(theme: UiTheme | undefined | null): void {
  const t = theme ?? BASE_UI_THEME;
  current = t;
  const el = root();
  if (!el) return;
  for (const [field, cssVar] of Object.entries(CSS_VAR) as [keyof UiTheme, string][]) {
    const value = t[field];
    if (field === "radius_px" || field === "hairline_px") {
      el.style.setProperty(cssVar, `${value as number}px`);
    } else if (field === "tracking_em") {
      el.style.setProperty(cssVar, `${value as number}em`);
    } else if (field === "glow") {
      // El halo del acento es la única "forma" derivada: un booleano en el
      // pack, una sombra aquí (el pack no escribe CSS crudo).
      el.style.setProperty(cssVar, value ? `0 0 14px ${t.accent}33` : "none");
    } else {
      el.style.setProperty(cssVar, String(value));
    }
  }
  // No es del pack sino de la ESTRUCTURA del muro, pero su fuente es core:
  // el test de tema mide el contraste del muro con este mismo número (#748).
  el.style.setProperty("--nf-velo-del-muro", `${VELO_DEL_MURO * 100}%`);
  el.dispatchEvent(new Event(EVENTO_TEMA_APLICADO));
}

/** Tema vigente. Ya no lo consume ningún renderer —el mundo no lleva texto
 *  pintado en el lienzo desde que la vista es 3D— pero sí el hook de bench,
 *  que compara lo aplicado con lo que declara el style pack. */
export function currentUiTheme(): UiTheme {
  return current;
}

