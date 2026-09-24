/** EL REGISTRO NO SE METE DEBAJO DE LA BARRA DE ATAQUES (QA de la tanda BA,
 *  el «aparte» de #755).
 *
 *  Desde la tanda BA cada línea de `#combat-log` es un subtítulo `ink` sobre
 *  `surface`. El registro vive en `#ui-bottom-left` (34vw) y la barra de
 *  ataques (`#action-bar`, en `#ui-bottom-center`) va centrada y POR ENCIMA
 *  (z-prompt sobre z-panel). Una línea larga ya pasaba por detrás del primer
 *  botón antes de la tanda; con la pastilla `surface` debajo, el botón —cuyo
 *  fondo `raised` es translúcido— deja ver la pastilla a través y su rótulo
 *  pierde contraste. En los packs de fuente sans (`anime`, `acero_neon`) la
 *  línea del atlas del arranque llega a 447 px a 1280 de ancho y el botón
 *  «Quick» empieza en 385.
 *
 *  Por cada pack: NINGUNA línea del registro se cruza con NINGÚN botón de la
 *  barra (rectángulos del DOM). Captura en `anime` y `acero_neon`.
 *
 *  NACIÓ ROJO (QA, 2026-09-24): es el hallazgo, medido. El día que se ajuste
 *  el ancho de la región o el fondo de la barra, se pone verde solo.
 *
 *  LO QUE NO MIDE: el contraste del rótulo del botón sobre la pastilla (lo
 *  mide a ojo la captura), ni otras resoluciones que la del bench (1280×800).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, sin pintar nada.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
const TECHO_MS = 20_000;

/** Los cinco packs con su tema RESUELTO, o `{ error }` sin `nefan-core/dist`. */
async function packs() {
  try {
    const { listStyles } = await import(path.join(RAIZ, "nefan-core", "dist", "src", "games", "loader.js"));
    return listStyles(path.join(RAIZ, "nefan-core", "data", "styles")).map((s) => ({ id: s.style_id, tema: s.ui_theme }));
  } catch (err) {
    return { error: String(err) };
  }
}

/** Qué líneas del registro se cruzan con qué botones de la barra, en píxeles
 *  del DOM, más el borde derecho más lejano del registro y el izquierdo del
 *  primer botón, para que el rojo diga cuánto sobra. */
function medirSolape() {
  const lineas = [...document.querySelectorAll("#combat-log > div")];
  const botones = [...document.querySelectorAll("#action-bar button")].filter((b) => b.getBoundingClientRect().width > 0);
  const solapes = [];
  for (const l of lineas) {
    const a = l.getBoundingClientRect();
    for (const b of botones) {
      const r = b.getBoundingClientRect();
      const w = Math.min(a.right, r.right) - Math.max(a.left, r.left);
      const h = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
      if (w > 0 && h > 0) solapes.push({ linea: (l.textContent ?? "").slice(0, 48), boton: b.textContent?.trim() ?? "", px: [Math.round(w), Math.round(h)] });
    }
  }
  return {
    lineas: lineas.length,
    botones: botones.length,
    bordeDerechoDelRegistro: Math.round(Math.max(0, ...lineas.map((l) => l.getBoundingClientRect().right))),
    primerBoton: botones.length ? Math.round(botones[0].getBoundingClientRect().left) : null,
    solapes,
  };
}

export default async function (ctx) {
  const temas = await packs();
  if (!Array.isArray(temas)) return ctx.sinMedir(`sin \`nefan-core/dist\` no hay packs que aplicar (cd nefan-core && npm run build): ${temas.error}`);
  ctx.expect("los cinco packs se leen de nefan-core/data/styles", temas.length === 5, JSON.stringify(temas.map((t) => t.id)));

  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  await ctx.waitFor(
    "el registro tiene líneas y la barra de ataques está pintada",
    () => (document.querySelector("#combat-log > div") && document.querySelector("#action-bar button") ? true : null),
    TECHO_MS,
  );

  for (const { id, tema } of temas) {
    await ctx.page.evaluate((t) => window.__nefan.ui.setTheme(t), tema);
    const m = await ctx.page.evaluate(medirSolape);
    ctx.log(`${id}: ${JSON.stringify(m)}`);
    ctx.expect(
      `${id}: ninguna línea del registro se cruza con ningún botón de la barra de ataques`,
      m.lineas > 0 && m.botones > 0 && m.solapes.length === 0,
      `registro hasta ${m.bordeDerechoDelRegistro} px · primer botón en ${m.primerBoton} px · solapes ${JSON.stringify(m.solapes)}`,
    );
    if (id === "anime" || id === "acero_neon") await ctx.shot(`196-registro-y-barra-${id}`);
  }
}
