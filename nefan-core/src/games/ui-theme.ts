/** Tema de la INTERFAZ DE JUEGO declarado por un style pack.
 *
 * Módulo PURO (sin node:fs) — el cliente 2D lo importa en el bundle del
 * navegador, igual que style-refs.ts / style-application-schema.ts;
 * `games/loader.ts` lo enchufa al manifest y lo re-exporta.
 *
 * El pack ya fija la dirección de arte de TODO lo generado (mundo, platós,
 * personajes). El tema extiende esa dirección a la UI: los mismos paneles y
 * componentes, vestidos con la paleta del estilo. Un pack declara SOLO lo
 * que quiera cambiar (`ui` es opcional y todos sus campos también): lo que
 * falte cae al BASE_UI_THEME.
 *
 * Estética base: DIEGÉTICA SOBRIA — panel translúcido (el mundo se ve
 * detrás), filete fino, sin marco ornamental, una familia tipográfica y un
 * acento. Los temas cambian paleta, tipografía y forma; NUNCA el layout.
 */
import { z } from "zod";

/** Color CSS admitido en un tema: hex, rgb(a) o hsl(a). Deliberadamente
 *  laxo dentro de esas tres formas (no se admiten nombres ni `var()`: el
 *  tema se resuelve también fuera del DOM, para el texto que los renderers
 *  pintan dentro del canvas). */
export const UI_THEME_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))$/;

const Color = z.string().regex(UI_THEME_COLOR, "color CSS inválido (usa #hex, rgb(a) o hsl(a))");

/** Nombres de familia separados por coma y nada más. */
export const UI_THEME_FONT = /^[A-Za-z0-9 ,'"_-]+$/;
const FontStack = z
  .string()
  .min(1)
  .max(160)
  .regex(UI_THEME_FONT, "font: solo nombres de familia separados por coma (sin url(), ; ni {})");

/** Lo que un pack puede declarar. Todo opcional: un estilo que solo quiera
 *  cambiar el acento declara `{"accent": "#4fd8ef"}`. */
export const UiThemeSchema = z
  .object({
    /** Fondo de los paneles. CON ALFA: el mundo debe verse detrás. */
    surface: Color.optional(),
    /** Fondo de los elementos interactivos dentro de un panel (botones). */
    raised: Color.optional(),
    /** Filete de 1 px de paneles y botones. */
    border: Color.optional(),
    /** Texto principal. */
    ink: Color.optional(),
    /** Texto secundario (teclas, notas, descripciones). */
    ink_dim: Color.optional(),
    /** Color de énfasis del estilo: nombre del hablante, opción con foco,
     *  tecla activa, salidas. */
    accent: Color.optional(),
    /** Texto sobre un fondo de acento (chips rellenos). */
    accent_ink: Color.optional(),
    /** Daño, muerte, errores del jugador (no el error-log de dev). */
    danger: Color.optional(),
    /** Color del corte de transición entre escenas. No siempre es negro: en
     *  un mundo de acuarela el corte a blanco de papel es lo coherente. */
    fade: Color.optional(),
    /** Stack CSS de la tipografía de la UI. Solo familias: un pack subido
     *  por un jugador es dato no confiable y no puede colar `url()` (fuente
     *  remota = fuga de red) ni cerrar la declaración. */
    font: FontStack.optional(),
    /** Stack CSS para nombres y titulares; sin él, `font`. */
    font_display: FontStack.optional(),
    /** Radio de esquina en px (0 = aristas vivas). */
    radius_px: z.number().int().min(0).max(24).optional(),
    /** Grosor del filete en px (el manga lo quiere grueso). */
    hairline_px: z.number().min(0.5).max(4).optional(),
    /** Espaciado entre letras de los titulares (em). */
    tracking_em: z.number().min(0).max(0.4).optional(),
    /** Halo del acento en bordes y focos (sci-fi). */
    glow: z.boolean().optional(),
  })
  .strict();

/** Lo declarado en el `style.json` (parcial). */
export type UiThemeInput = z.infer<typeof UiThemeSchema>;

/** Tema RESUELTO: lo que consume el cliente, sin campos ausentes. */
export interface UiTheme {
  surface: string;
  raised: string;
  border: string;
  ink: string;
  ink_dim: string;
  accent: string;
  accent_ink: string;
  danger: string;
  fade: string;
  font: string;
  font_display: string;
  radius_px: number;
  hairline_px: number;
  tracking_em: number;
  glow: boolean;
}

/** Stacks de sistema: el cliente se juega en local y los presets sin red
 *  deben verse igual — ninguna fuente remota. */
export const UI_FONT_SANS = "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif";
export const UI_FONT_SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
export const UI_FONT_MONO = "'Courier New', ui-monospace, monospace";

/** Tema por defecto: sin estilo (fixtures del selector Room, arranque
 *  offline, sesión sin bridge) y base sobre la que se funde el del pack.
 *  Gris neutro con el acento ámbar que ya usa el proyecto. */
export const BASE_UI_THEME: UiTheme = {
  surface: "rgba(12, 12, 16, 0.88)",
  raised: "rgba(255, 255, 255, 0.06)",
  border: "#4a4a55",
  ink: "#d9d9e0",
  ink_dim: "#8b8b98",
  accent: "#d8a657",
  accent_ink: "#141017",
  danger: "#c04a4a",
  fade: "#08060e",
  font: UI_FONT_SANS,
  font_display: UI_FONT_SANS,
  radius_px: 4,
  hairline_px: 1,
  tracking_em: 0.04,
  glow: false,
};

/** Funde lo declarado por el pack sobre el tema base. `font_display` sigue a
 *  `font` cuando el pack cambia la tipografía pero no declara titular. */
export function resolveUiTheme(declared?: UiThemeInput | null): UiTheme {
  if (!declared) return { ...BASE_UI_THEME };
  const merged = { ...BASE_UI_THEME } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(declared)) {
    if (value !== undefined) merged[key] = value;
  }
  if (declared.font && !declared.font_display) merged.font_display = declared.font;
  return merged as unknown as UiTheme;
}
