/** Tests del tema de UI declarado por un style pack (src/games/ui-theme.ts):
 *  merge sobre el base, validación estricta del bloque `ui` dentro del
 *  manifest, y comprobación objetiva de LEGIBILIDAD (contraste WCAG) de los
 *  cinco temas shipped — un tema bonito que no se lee es un tema roto. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { listStyles, StyleManifestSchema } from "../src/games/loader.js";
import {
  BASE_UI_THEME,
  UiThemeSchema,
  resolveUiTheme,
  VELO_DEL_MURO,
  type UiTheme,
  type UiThemeInput,
} from "../src/games/ui-theme.js";

const REAL_STYLES = fileURLToPath(new URL("../data/styles", import.meta.url));
const PLANTILLA = fileURLToPath(new URL("../data/styles/_plantilla/style.json.example", import.meta.url));

/** Todo tema que un jugador puede llegar a VER, no solo los cinco shipped: el
 *  base (fixtures, arranque sin bridge, y lo que rellena lo que un pack no
 *  declara) y la plantilla de la que nace un pack de usuario. Hasta #758 esos
 *  dos no los medía nadie y el filete del base daba 1,99:1. */
function temasALeer(): Array<{ style_id: string; ui_theme: UiTheme }> {
  const plantilla = JSON.parse(readFileSync(PLANTILLA, "utf8")) as { ui: unknown };
  return [
    ...listStyles(REAL_STYLES),
    { style_id: "BASE_UI_THEME", ui_theme: BASE_UI_THEME },
    { style_id: "_plantilla", ui_theme: resolveUiTheme(UiThemeSchema.parse(plantilla.ui)) },
  ];
}

/** Manifest mínimo válido al que colgarle un bloque `ui`. */
function manifestWith(ui: unknown): Record<string, unknown> {
  return {
    style_id: "tema_test",
    name: "Tema test",
    description: "d",
    style_token: "t",
    cover: "cover.jpg",
    tags: ["medieval"],
    refs: [
      { id: "fps_surfaces", file: "surfaces/surfaces.jpg", description: "muestras" },
      { id: "fachada", file: "faces/fachada.jpg", description: "una fachada" },
      { id: "commoner", file: "characters/commoner.jpg", description: "una persona" },
    ],
    ui,
  };
}

/** Canal sRGB → lineal (WCAG 2.x). */
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa de un color del tema. Acepta #rgb, #rrggbb y rgba():
 *  el alfa se compone sobre `under` (el mundo detrás del panel), porque un
 *  panel translúcido se lee sobre lo que hay debajo, no sobre el vacío. */
function luminance(color: string, under: [number, number, number] = [128, 128, 128]): number {
  const [r, g, b, a] = parseColor(color);
  const mix = (c: number, u: number): number => c * a + u * (1 - a);
  return (
    0.2126 * channel(mix(r, under[0])) +
    0.7152 * channel(mix(g, under[1])) +
    0.0722 * channel(mix(b, under[2]))
  );
}

function parseColor(color: string): [number, number, number, number] {
  const hex = color.trim();
  if (hex.startsWith("#")) {
    const h = hex.slice(1);
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    ];
  }
  const nums = hex.replace(/^[a-z]+\(|\)$/g, "").split(/[,\s/]+/).filter(Boolean).map(Number);
  return [nums[0], nums[1], nums[2], nums[3] === undefined ? 1 : nums[3]];
}

/** Un color del tema compuesto (con su alfa) sobre un fondo ya opaco. */
function sobre(color: string, under: [number, number, number]): [number, number, number] {
  const [r, g, b, a] = parseColor(color);
  return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)];
}

function rgb(c: [number, number, number]): string {
  return `rgb(${c.map((v) => v.toFixed(3)).join(", ")})`;
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe("tema de UI — resolución", () => {
  it("sin bloque declarado devuelve el tema base", () => {
    assert.deepEqual(resolveUiTheme(), BASE_UI_THEME);
    assert.deepEqual(resolveUiTheme(null), BASE_UI_THEME);
  });

  it("un pack puede declarar SOLO lo que cambia", () => {
    const t = resolveUiTheme({ accent: "#4fd8ef" });
    assert.equal(t.accent, "#4fd8ef");
    assert.equal(t.ink, BASE_UI_THEME.ink, "el resto sigue siendo el base");
    assert.equal(t.radius_px, BASE_UI_THEME.radius_px);
  });

  it("la tipografía de titular sigue a la del cuerpo si no se declara", () => {
    const t = resolveUiTheme({ font: "Georgia, serif" });
    assert.equal(t.font_display, "Georgia, serif");
    // …pero declararla gana.
    const t2 = resolveUiTheme({ font: "Georgia, serif", font_display: "Impact, sans-serif" });
    assert.equal(t2.font_display, "Impact, sans-serif");
  });

  it("resolver es idempotente (el tema resuelto vuelve a resolver igual)", () => {
    const once = resolveUiTheme({ accent: "#4fd8ef", radius_px: 0 });
    assert.deepEqual(resolveUiTheme(once as UiThemeInput), once);
  });
});

describe("tema de UI — validación estricta", () => {
  it("acepta un bloque parcial dentro del manifest", () => {
    const parsed = StyleManifestSchema.parse(manifestWith({ accent: "#4fd8ef" }));
    assert.equal(parsed.ui?.accent, "#4fd8ef");
  });

  it("rechaza un campo no modelado (typo en un pack subido)", () => {
    assert.throws(() => UiThemeSchema.parse({ acccent: "#fff" }));
  });

  it("rechaza colores que no sean hex/rgb/hsl", () => {
    assert.throws(() => UiThemeSchema.parse({ accent: "rebeccapurple" }));
    assert.throws(() => UiThemeSchema.parse({ accent: "url(http://evil/x.png)" }));
    assert.throws(() => UiThemeSchema.parse({ accent: "#ff" }));
  });

  it("rechaza una tipografía que no sean nombres de familia", () => {
    // Un pack de usuario no puede colar una fuente remota (fuga de red) ni
    // cerrar la declaración para inyectar más CSS.
    assert.throws(() => UiThemeSchema.parse({ font: "url(http://evil/f.woff2)" }));
    assert.throws(() => UiThemeSchema.parse({ font: "serif; background: url(x)" }));
    assert.doesNotThrow(() => UiThemeSchema.parse({ font: "Georgia, 'Times New Roman', serif" }));
  });

  it("rechaza formas fuera de rango", () => {
    assert.throws(() => UiThemeSchema.parse({ radius_px: 99 }));
    assert.throws(() => UiThemeSchema.parse({ hairline_px: 0 }));
  });

  it("un `ui` inválido tumba el manifest entero (fail-loud, como una ref rota)", () => {
    assert.throws(() => StyleManifestSchema.parse(manifestWith({ accent: "verde" })));
  });
});

describe("temas shipped", () => {
  const styles = listStyles(REAL_STYLES);

  it("los cinco packs declaran tema propio (ninguno se quedó en el base)", () => {
    assert.equal(styles.length, 5);
    for (const s of styles) {
      assert.notDeepEqual(s.ui_theme, BASE_UI_THEME, `${s.style_id} no declara tema`);
    }
  });

  it("el texto se lee sobre su panel (WCAG AA), también en el base y la plantilla", () => {
    for (const s of temasALeer()) {
      const t = s.ui_theme;
      assert.ok(
        contrast(t.ink, t.surface) >= 4.5,
        `${s.style_id}: texto sobre panel ${contrast(t.ink, t.surface).toFixed(2)}:1 (<4.5)`,
      );
      // El secundario es TEXTO NORMAL, no grande: `ink_dim` pinta el detalle
      // del muro (13 px), las notas y fechas del historial y del panel de
      // gráficos (11-12 px) y las etiquetas de vida. WCAG solo da el 3:1 al
      // texto de ≥ 24 px (o ≥ 18,66 px en negrita), y aquí no hay ninguno
      // (#758): en `acuarela_luminosa` las notas se quedaban en 3,2:1.
      assert.ok(
        contrast(t.ink_dim, t.surface) >= 4.5,
        `${s.style_id}: texto atenuado ${contrast(t.ink_dim, t.surface).toFixed(2)}:1 (<4.5)`,
      );
      // El filete (`border`) es la silueta de paneles y botones `.nf-action`:
      // componente de interfaz, 3:1 (WCAG 1.4.11). Hasta #758 no lo medía
      // nadie y en cuatro packs daba 1,5-1,8:1: el botón no tenía borde.
      assert.ok(
        contrast(t.border, t.surface) >= 3,
        `${s.style_id}: filete ${contrast(t.border, t.surface).toFixed(2)}:1 (<3)`,
      );
      // Acento: elemento gráfico y titulares, 3:1.
      assert.ok(
        contrast(t.accent, t.surface) >= 3,
        `${s.style_id}: acento ${contrast(t.accent, t.surface).toFixed(2)}:1 (<3)`,
      );
      // El título de un fallo (el muro, el aviso del chip) va en `danger`
      // sobre un panel: hasta #748 no lo medía nadie, y en dos packs no
      // llegaba a 3:1.
      assert.ok(
        contrast(t.danger, t.surface) >= 3,
        `${s.style_id}: peligro ${contrast(t.danger, t.surface).toFixed(2)}:1 (<3)`,
      );
      // El acento también se usa RELLENO, con su propio color de texto.
      assert.ok(
        contrast(t.accent_ink, t.accent) >= 4.5,
        `${s.style_id}: texto sobre acento ${contrast(t.accent_ink, t.accent).toFixed(2)}:1 (<4.5)`,
      );
    }
  });
});

/** EL MURO (#748) no se pinta sobre el mundo a secas: es el `fade` del pack al
 *  `VELO_DEL_MURO` sobre el mundo (el gris neutro del helper), y encima el
 *  panel `surface` con el texto. Se mide contra ESA pila, que es la que ve el
 *  jugador. Antes el muro pintaba el texto directamente sobre el velo y nadie
 *  medía ese par: en `anime` «Cerrar» era tinta oscura sobre `fade` oscuro,
 *  1,03:1, invisible. */
describe("el muro se lee (#748)", () => {
  /** El fondo opaco del panel del muro, tal como lo compone el navegador. */
  function fondoDelMuro(t: UiTheme): [number, number, number] {
    const [fr, fg, fb] = parseColor(t.fade);
    const velo = sobre(`rgba(${fr}, ${fg}, ${fb}, ${VELO_DEL_MURO})`, [128, 128, 128]);
    return sobre(t.surface, velo);
  }

  it("título, detalle y botón relleno pasan en los cinco packs, el base y la plantilla", () => {
    for (const s of temasALeer()) {
      const t = s.ui_theme;
      const fondo = fondoDelMuro(t);
      const panel = rgb(fondo);
      const boton = rgb(sobre(t.accent, fondo));
      const pares: Array<[string, string, string, number]> = [
        ["título de fallo (danger)", t.danger, panel, 3],
        ["título de espera y oferta (accent)", t.accent, panel, 3],
        // Texto normal de 13 px: 4,5 (#758), no el 3:1 del texto grande.
        ["detalle (ink_dim)", t.ink_dim, panel, 4.5],
        ["filete del panel (border)", t.border, panel, 3],
        ["silueta del botón (accent)", t.accent, panel, 3],
        ["texto del botón (accent_ink sobre accent)", t.accent_ink, boton, 4.5],
        // La oferta (issue 478): «Cerrar» es SECUNDARIO, sin relleno.
        ["texto del botón secundario (ink)", t.ink, panel, 4.5],
        ["silueta del botón secundario (ink_dim)", t.ink_dim, panel, 3],
      ];
      for (const [que, fg, bg, min] of pares) {
        const c = contrast(rgb(sobre(fg, parseColor(bg).slice(0, 3) as [number, number, number])), bg);
        assert.ok(c >= min, `${s.style_id}: ${que} ${c.toFixed(2)}:1 (<${min})`);
      }
    }
  });
});
