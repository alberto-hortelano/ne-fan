/** EL MURO Y EL REGISTRO SE LEEN EN TODOS LOS PACKS (tanda BA, #748 y el
 *  «aparte» de #755).
 *
 *  #748: en el muro de fallo con tema claro el hueco antes de «Cerrar» era el
 *  doble que el de título→detalle (`.elapsed` vacío seguía ocupando su `gap`, y
 *  los botones sumaban `margin-top`), y «Cerrar» se leía mal. Midiendo los
 *  cinco packs salió peor: el muro pintaba el texto directamente sobre el velo
 *  `fade`, y en `anime` «Cerrar» era tinta oscura sobre velo oscuro (1,03:1).
 *  Ahora lo que se lee va sobre un panel `surface`, y los botones son la
 *  acción principal RELLENA (`accent` + `accent_ink`): los pares que mide
 *  `nefan-core/test/ui-theme.test.ts` contra la pila real del muro.
 *
 *  #755, aparte: el registro (`#combat-log`) era gris atenuado sin fondo sobre
 *  la escena, y sobre el suelo claro de un tile no se leía. Cada línea es
 *  ahora un subtítulo `ink` sobre `surface`.
 *
 *   REGISTRO · pack a pack, una línea del registro tiene fondo `--nf-surface`
 *              y texto `--nf-ink` (estilo CALCULADO). Captura en
 *              `acuarela_luminosa`, sobre el suelo del tile.
 *   MURO     · un viaje que se rompe (como el 174) deja «No se pudo llegar».
 *              Pack a pack: el panel es `surface`, el botón visible es
 *              `accent`/`accent_ink`, el título es `danger`, y el hueco
 *              detalle→botón es el de título→detalle (±1 px). Captura en los
 *              cinco packs.
 *
 *  Los packs se leen de `nefan-core/data/styles` con el MISMO `listStyles` de
 *  core que usa el test de tema (desde `nefan-core/dist`) y se aplican con el
 *  hook `ui.setTheme`: el tema que se pinta es el que el bridge pondría.
 *
 *  PROBADO EN NEGATIVO (2026-09-24, a mano, salida en implementacion.md):
 *  - devolviendo `margin-top: 6px` a `#narrative-loader .dismiss` → rojo el
 *    hueco en los cinco packs;
 *  - quitando `background` de `#combat-log > div` → rojo el registro;
 *  - bajando `#narrative-loader .nf-action` a `.muro-panel .nf-action` Y
 *    quitando el `:hover` propio del muro → rojo HOVER en los cinco packs,
 *    con la tinta del color del fondo (el genérico `.nf-action:hover` gana).
 *    Cada una de las dos por separado deja HOVER verde: hoy lo sujetan las
 *    dos, y cualquiera basta.
 *
 *   HOVER    · con el puntero sobre «Cerrar», el botón sigue siendo
 *              `accent_ink` sobre `accent`: el hover genérico de `.nf-action`
 *              pinta el texto de `accent` y lo haría invisible.
 *
 *  LO QUE NO MIDE: el muro de ARRANQUE, que necesita un `combat_config.json`
 *  roto (ver el 174), ni el foco por teclado (`:focus-visible`), que sigue el
 *  anillo por defecto del navegador.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso; su conducta se
 *  cambia con `POST /dev/tiles` y se devuelve en `finally`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { ViajeRoto, viajarPorSalidas } from "../lib/viaje.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
const MS_DEL_TILE_LENTO = 4_000;
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

async function conducta(ctx, cambio) {
  const res = await fetch(`${URLS.fake_ai}/dev/tiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cambio),
  });
  if (!res.ok) throw new Error(`POST /dev/tiles HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Estilo CALCULADO frente a los tokens del tema vigente, normalizados por el
 *  propio navegador (un token puede venir en hex y el calculado sale en rgb). */
function medirElRegistro() {
  const sonda = document.createElement("div");
  document.getElementById("game-ui").append(sonda);
  const token = (v) => {
    sonda.style.color = `var(${v})`;
    return getComputedStyle(sonda).color;
  };
  const linea = document.querySelector("#combat-log > div");
  const cs = linea ? getComputedStyle(linea) : null;
  const r = {
    texto: linea?.textContent ?? null,
    fondo: cs?.backgroundColor ?? null,
    tinta: cs?.color ?? null,
    surface: token("--nf-surface"),
    ink: token("--nf-ink"),
  };
  sonda.remove();
  return r;
}

function medirElMuro() {
  const sonda = document.createElement("div");
  document.getElementById("game-ui").append(sonda);
  const token = (v) => {
    sonda.style.color = `var(${v})`;
    return getComputedStyle(sonda).color;
  };
  const muro = document.getElementById("narrative-loader");
  const panel = muro?.querySelector(".muro-panel");
  const titulo = document.getElementById("narrative-loader-title");
  const detalle = document.getElementById("narrative-loader-detail");
  const boton = [...(muro?.querySelectorAll("button") ?? [])].find((b) => b.getBoundingClientRect().height > 0);
  const rT = titulo?.getBoundingClientRect();
  const rD = detalle?.getBoundingClientRect();
  const rB = boton?.getBoundingClientRect();
  const r = {
    visible: Boolean(muro?.classList.contains("visible")),
    error: Boolean(muro?.classList.contains("error")),
    titulo: titulo?.textContent ?? "",
    boton: boton?.textContent ?? null,
    panel: panel ? getComputedStyle(panel).backgroundColor : null,
    colorDelTitulo: titulo ? getComputedStyle(titulo).color : null,
    fondoDelBoton: boton ? getComputedStyle(boton).backgroundColor : null,
    tintaDelBoton: boton ? getComputedStyle(boton).color : null,
    huecoTituloDetalle: rT && rD ? rD.top - rT.bottom : null,
    huecoDetalleBoton: rD && rB ? rB.top - rD.bottom : null,
    surface: token("--nf-surface"),
    accent: token("--nf-accent"),
    accentInk: token("--nf-accent-ink"),
    danger: token("--nf-danger"),
  };
  sonda.remove();
  return r;
}

export default async function (ctx) {
  const temas = await packs();
  if (!Array.isArray(temas)) return ctx.sinMedir(`sin \`nefan-core/dist\` no hay packs que aplicar (cd nefan-core && npm run build): ${temas.error}`);
  ctx.expect("los cinco packs se leen de nefan-core/data/styles", temas.length === 5, JSON.stringify(temas.map((t) => t.id)));
  const acuarela = temas.find((t) => t.id === "acuarela_luminosa");

  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  // ══ REGISTRO · cada línea es un subtítulo `ink` sobre `surface` ══════════
  await ctx.waitFor("el registro de la partida tiene alguna línea", () => (document.querySelector("#combat-log > div") ? true : null), TECHO_MS);
  for (const { id, tema } of temas) {
    await ctx.page.evaluate((t) => window.__nefan.ui.setTheme(t), tema);
    const r = await ctx.page.evaluate(medirElRegistro);
    ctx.expect(
      `REGISTRO · ${id}: la línea tiene fondo \`surface\` y texto \`ink\``,
      r.fondo === r.surface && r.tinta === r.ink,
      JSON.stringify(r),
    );
  }
  await ctx.page.evaluate((t) => window.__nefan.ui.setTheme(t), acuarela.tema);
  await ctx.shot("195-registro-acuarela_luminosa");

  // ══ MURO · un viaje que se rompe ═════════════════════════════════════════
  const salidas = await ctx.nefan("exits");
  if (!salidas.length) return ctx.sinMedirBloque(`el panel «Salidas» no ofrece destino: ${JSON.stringify(salidas)}`);
  const inicial = await fetch(`${URLS.fake_ai}/dev/tiles`).then((r) => r.json());
  let fin;
  try {
    await conducta(ctx, { delay_ms: MS_DEL_TILE_LENTO });
    const pedidoPrevio = await ctx.page.evaluate(() => window.__nefan.viaje?.pedido ?? null);
    const viaje = viajarPorSalidas(ctx, salidas[0].name, `el viaje a «${salidas[0].name}» que se rompe`).then(
      (llegada) => ({ llegada }),
      (err) => ({ err }),
    );
    await ctx.waitFor(
      "el bridge acusa el viaje y el jugador lee «Viajando...»",
      (previo) => {
        const v = window.__nefan.viaje;
        const t = document.getElementById("narrative-loader-title")?.textContent;
        return v && v.pedido !== previo && v.encolado !== null && t === "Viajando..." ? v : null;
      },
      TECHO_MS,
      pedidoPrevio,
    );
    await conducta(ctx, { mode: "error" });
    fin = await viaje;
  } finally {
    await conducta(ctx, inicial);
  }
  ctx.expect(
    "MURO · el viaje se rompe (ViajeRoto) y deja el muro de fallo",
    fin.err instanceof ViajeRoto,
    fin.err ? `${fin.err.name}: ${fin.err.message}` : `llegó: ${JSON.stringify(fin.llegada)}`,
  );

  for (const { id, tema } of temas) {
    await ctx.page.evaluate((t) => window.__nefan.ui.setTheme(t), tema);
    const m = await ctx.page.evaluate(medirElMuro);
    ctx.log(`MURO · ${id}: ${JSON.stringify(m)}`);
    ctx.expect(
      `MURO · ${id}: es el de fallo, con su título en \`danger\``,
      m.visible && m.error && m.titulo === "No se pudo llegar" && m.colorDelTitulo === m.danger,
      JSON.stringify({ titulo: m.titulo, color: m.colorDelTitulo, danger: m.danger }),
    );
    ctx.expect(
      `MURO · ${id}: el contenido va sobre un panel \`surface\``,
      m.panel !== null && m.panel === m.surface,
      JSON.stringify({ panel: m.panel, surface: m.surface }),
    );
    ctx.expect(
      `MURO · ${id}: el botón «${m.boton}» es la acción RELLENA, \`accent_ink\` sobre \`accent\``,
      m.fondoDelBoton === m.accent && m.tintaDelBoton === m.accentInk,
      JSON.stringify({ fondo: m.fondoDelBoton, tinta: m.tintaDelBoton, accent: m.accent, accentInk: m.accentInk }),
    );
    ctx.expect(
      `MURO · ${id}: el hueco detalle→botón es el de título→detalle (±1 px)`,
      m.huecoDetalleBoton !== null && m.huecoTituloDetalle !== null && Math.abs(m.huecoDetalleBoton - m.huecoTituloDetalle) <= 1,
      `título→detalle ${m.huecoTituloDetalle} px · detalle→botón ${m.huecoDetalleBoton} px`,
    );
    await ctx.shot(`195-muro-${id}`);
  }
  // HOVER · el genérico de `.nf-action` pinta el texto de `accent`, que
  // sobre el botón relleno lo haría desaparecer.
  for (const { id, tema } of temas) {
    await ctx.page.evaluate((t) => window.__nefan.ui.setTheme(t), tema);
    await ctx.page.hover("#narrative-loader-dismiss");
    const m = await ctx.page.evaluate(medirElMuro);
    ctx.expect(
      `HOVER · ${id}: con el puntero encima, «Cerrar» sigue siendo \`accent_ink\` sobre \`accent\``,
      m.fondoDelBoton === m.accent && m.tintaDelBoton === m.accentInk,
      JSON.stringify({ fondo: m.fondoDelBoton, tinta: m.tintaDelBoton, accent: m.accent, accentInk: m.accentInk }),
    );
    if (id === "anime") await ctx.shot("195-hover-anime");
  }
  // El camino del jugador: «Cerrar», con el puntero (falla si algo lo tapa).
  await ctx.page.click("#narrative-loader-dismiss");
}
