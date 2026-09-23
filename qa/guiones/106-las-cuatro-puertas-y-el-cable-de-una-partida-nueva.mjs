/** LAS CUATRO PUERTAS DE UNA PARTIDA NUEVA, Y EL CABLE.
 *
 *  Guion de QA de la PR 1 de la tanda A «el dinero no miente». El 105 mide la
 *  ESQUINA de la decisión del usuario —«sin tocar nada no se gasta» y «un
 *  click enciende Imagen IA»—, que son dos de las cuatro combinaciones
 *  posibles. Éste mide LA TABLA ENTERA, más los dos estados del sistema que
 *  ningún guion visita y por los que se puede pagar sin querer:
 *
 *  1 · LAS CUATRO COMBINACIONES (escenarios × personajes). El criterio del
 *      usuario es literal: *«pulsar "Nueva partida" y jugar no gasta un
 *      céntimo sin un click explícito»*. Eso no se cumple por faceta sino por
 *      PAR: una partida en Maqueta 3D con personajes en Imagen IA gasta
 *      (skins) y una en Imagen IA con personajes en maqueta gasta (atlas), así
 *      que las cuatro celdas son cuatro respuestas distintas. Cada una se
 *      afirma con lo que se abrió de verdad —la puerta del atlas
 *      (`pintar-superficies`) y la de los skins (`/skin_sprite_sheet`)— y con
 *      lo que el BRIDGE escribió en el save, no con el color de un botón.
 *
 *      Cómo se lee: NINGUNA celda abre una puerta que no esté en su columna de
 *      clicks, y la celda SIN clicks sale a cero en las dos.
 *
 *  2 · EL TOGGLE QUE VIENE DE AYER. `nefan.aichar` es un booleano que el chip
 *      del HUD deja escrito en el navegador del jugador en cuanto enciende los
 *      personajes IA una vez (`ui/modos-de-graficos.ts`), y sobrevive a la
 *      partida, a la pestaña y a la máquina. Es el toggle al que caen los
 *      gates cuando NO hay modo de sesión (`gatesDeImagen`, faceta vacía). La
 *      pregunta que no hace ningún guion: el que ayer jugó en Imagen IA y hoy
 *      pulsa «Nueva partida» sin tocar nada, ¿paga? La batería corre con
 *      perfil de navegador limpio, así que este estado no lo visita nadie.
 *
 *  3 · EL CABLE. `start_session` sin `renderMode` y con `renderMode: ""` son
 *      los dos mensajes que decide el fallback del wire, y el cliente no los
 *      manda nunca (siempre rellena el campo), así que ese fallback —«el que
 *      decide de verdad», dice el propio commit— no lo ejercía nada de la
 *      batería. Se mandan aquí COMO OTRO CLIENTE, por el mismo gateway que usa
 *      la página, y se lee el modo con el que nació la sesión en la respuesta
 *      del bridge. El control es el tercero: con `renderMode: "image"`
 *      explícito la sesión nace en imagen, o el bloque no probaría nada.
 *
 *  Las puertas se afirman con `expectEspera` sondeando `/dev/counters` DESDE
 *  LA PÁGINA: el positivo vuelve en cuanto se abre y el negativo es una
 *  expiración observada —«el timeout ES el éxito»— con sus muestras contadas,
 *  no un sleep (`qa-guiones-sin-espera-por-reloj`).
 *
 *  Cero créditos: preset `e2e-sin-creditos`; quien «cobra» es el motor falso.
 */
import { readFileSync } from "node:fs";

import { abrirSelectorDeMundos, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { esperarPartidaEnDisco, rutaDelSave } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";
import { preguntarPorElCable } from "../lib/cable.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Cuánto se sondea antes de dar una puerta por NO abierta. El positivo de la
 *  misma tabla mide lo que tarda de verdad en abrirse (se imprime), y es el
 *  testigo de que este plazo sobra. */
const PLAZO_MS = 10_000;

/** Las dos puertas, cada una con el contador que la cuenta: el atlas por
 *  PUERTA EJERCIDA (`ejercicio`, porque con la librería caliente pintar sale a
 *  $0 y el de dinero no se movería) y los skins por gasto (el motor falso no
 *  cachea skins, así que ahí gasto y puerta son lo mismo). */
const PUERTAS = {
  atlas: { mapa: "ejercicio", clave: "pintar-superficies", rotulo: "el ATLAS de superficies" },
  skins: { mapa: "gasto", clave: "/skin_sprite_sheet", rotulo: "los SKINS de personaje" },
};

async function contadores() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  return res.json();
}

const cuanto = (c, p) => c?.[p.mapa]?.rutas?.[p.clave] ?? 0;

function modosDelSave(sessionId) {
  const ruta = rutaDelSave(sessionId);
  if (!ruta) return null;
  const world = JSON.parse(readFileSync(ruta, "utf8")).world ?? {};
  return { render: world.render_mode, personajes: world.character_mode };
}

/** Afirma si una puerta se abrió (o no) desde la muestra `base`, sondeando el
 *  contador del motor falso desde la página. */
function afirmarPuerta(ctx, puerta, debeAbrirse, base, etiqueta) {
  const p = PUERTAS[puerta];
  return ctx.expectEspera(
    `${etiqueta}: se abre la puerta de ${p.rotulo}`,
    debeAbrirse,
    async ([url, mapa, clave, b]) => {
      const c = await (await fetch(`${url}/dev/counters`)).json();
      const n = c?.[mapa]?.rutas?.[clave] ?? 0;
      return n > b ? { abierta: n - b } : null;
    },
    {
      ms: debeAbrirse ? 30_000 : PLAZO_MS,
      arg: [URLS.fake_ai, p.mapa, p.clave, base],
      aserto: `«${etiqueta}»: la puerta de ${p.rotulo} ${debeAbrirse ? "SE ABRE (y por eso lo de al lado significa algo)" : "NO se abre ni una vez"}`,
    },
  );
}

/** Una partida nueva desde el título pulsando SOLO los clicks que se le pidan
 *  (`[]` = sin tocar nada). Devuelve la muestra de contadores de ANTES, el
 *  save que escribió el bridge y el id. */
async function partidaCon(ctx, clicks) {
  await recargarAlTitulo(ctx);
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);
  for (const sel of clicks) await ctx.page.click(sel);
  const antes = await contadores();
  const p = await comenzar(ctx);
  await esperarPartidaEnDisco(ctx, p.sessionId);
  return {
    base: { atlas: cuanto(antes, PUERTAS.atlas), skins: cuanto(antes, PUERTAS.skins) },
    sessionId: p.sessionId,
    save: modosDelSave(p.sessionId),
  };
}

/** `start_session` por el gateway del juego, como otro cliente, con el cuerpo
 *  EXACTO que se le pase. Devuelve el `session_started`. */
async function startSessionCrudo(ctx, extra, etiqueta) {
  const m = await preguntarPorElCable(
    ctx,
    { type: "start_session", requestId: etiqueta, gameId: GAME_ID, ...extra },
    { respuesta: "session_started" },
  );
  return {
    ok: m.ok,
    error: m.error ?? null,
    render: m.state?.world?.render_mode ?? null,
    personajes: m.state?.world?.character_mode ?? null,
  };
}

export default async function (ctx) {
  // ── 1 · La tabla entera ──────────────────────────────────────────────────
  const CASOS = [
    {
      nombre: "sin tocar nada",
      clicks: [],
      save: { render: "vector", personajes: "vector" },
      atlas: false,
      skins: false,
    },
    {
      nombre: "un click en Imagen IA (los personajes le siguen)",
      clicks: ['#ts-rendermode [data-rendermode="image"]'],
      save: { render: "image", personajes: "image" },
      atlas: true,
      skins: true,
    },
    {
      nombre: "Imagen IA en escenarios + personajes de vuelta a maqueta",
      clicks: ['#ts-rendermode [data-rendermode="image"]', '#ts-charmode [data-charmode="vector"]'],
      save: { render: "image", personajes: "vector" },
      atlas: true,
      skins: false,
    },
    {
      nombre: "maqueta en escenarios + personajes en Imagen IA",
      clicks: ['#ts-charmode [data-charmode="image"]'],
      save: { render: "vector", personajes: "image" },
      atlas: false,
      skins: true,
    },
  ];

  const tabla = [];
  for (const caso of CASOS) {
    const r = await partidaCon(ctx, caso.clicks);
    ctx.log(`[${caso.nombre}] clicks=${caso.clicks.length} · save=${JSON.stringify(r.save)}`);
    ctx.expect(
      `«${caso.nombre}»: el SAVE guarda los dos modos que se pidieron (${caso.save.render}/${caso.save.personajes})`,
      r.save?.render === caso.save.render && r.save?.personajes === caso.save.personajes,
      JSON.stringify(r.save),
    );
    const atlas = await afirmarPuerta(ctx, "atlas", caso.atlas, r.base.atlas, caso.nombre);
    const skins = await afirmarPuerta(ctx, "skins", caso.skins, r.base.skins, caso.nombre);
    tabla.push({
      caso: caso.nombre,
      clicks: caso.clicks.length,
      atlas: atlas.ocurrio,
      skins: skins.ocurrio,
    });
  }

  // El criterio del usuario, leído de la TABLA y no de una celda: lo único que
  // se juega sin un solo click es la partida sin clicks, y ésa no abre ninguna
  // de las dos puertas.
  const sinClicks = tabla.filter((f) => f.clicks === 0);
  ctx.expect(
    "NINGUNA partida sin un solo click abre una puerta de gasto (el criterio del usuario, sobre la tabla entera)",
    sinClicks.length > 0 && sinClicks.every((f) => !f.atlas && !f.skins),
    JSON.stringify(sinClicks),
  );
  ctx.expect(
    "…y las dos puertas se abren de verdad cuando su click está puesto (si no, lo de arriba no prueba nada)",
    tabla.some((f) => f.atlas) && tabla.some((f) => f.skins),
    JSON.stringify(tabla),
  );
  await ctx.shot("tabla-de-modos");

  // ── 2 · El toggle que viene de ayer ──────────────────────────────────────
  // `nefan.aichar` = "1" es lo que deja escrito el chip del HUD la primera vez
  // que el jugador enciende personajes IA. No se limpia al empezar otra
  // partida: mañana sigue ahí.
  await ctx.page.evaluate(() => localStorage.setItem("nefan.aichar", "1"));
  const heredado = await partidaCon(ctx, []);
  ctx.log(`[toggle heredado] save=${JSON.stringify(heredado.save)}`);
  ctx.expect(
    "con el toggle de personajes IA encendido de una partida anterior, «Nueva partida» sigue naciendo en maqueta",
    heredado.save?.render === "vector" && heredado.save?.personajes === "vector",
    JSON.stringify(heredado.save),
  );
  await afirmarPuerta(ctx, "skins", false, heredado.base.skins, "toggle heredado de ayer");
  await afirmarPuerta(ctx, "atlas", false, heredado.base.atlas, "toggle heredado de ayer");
  await ctx.page.evaluate(() => localStorage.removeItem("nefan.aichar"));

  // ── 3 · El cable ─────────────────────────────────────────────────────────
  const sinCampo = await startSessionCrudo(ctx, {}, "qa-106-sin-campo");
  ctx.log(`start_session SIN renderMode → ${JSON.stringify(sinCampo)}`);
  ctx.expect(
    "un `start_session` SIN `renderMode` nace en maqueta en las dos facetas (el fallback del wire)",
    sinCampo.ok === true && sinCampo.render === "vector" && sinCampo.personajes === "vector",
    JSON.stringify(sinCampo),
  );

  const vacio = await startSessionCrudo(ctx, { renderMode: "" }, "qa-106-vacio");
  ctx.log(`start_session con renderMode:"" → ${JSON.stringify(vacio)}`);
  ctx.expect(
    '…y con `renderMode: ""` tampoco nace gastando: el vacío no es «imagen»',
    vacio.ok === true && vacio.render === "vector" && vacio.personajes === "vector",
    JSON.stringify(vacio),
  );

  const explicito = await startSessionCrudo(ctx, { renderMode: "image" }, "qa-106-image");
  ctx.log(`start_session con renderMode:"image" → ${JSON.stringify(explicito)}`);
  ctx.expect(
    'control: con `renderMode: "image"` explícito SÍ nace en imagen (si no, los dos de arriba no prueban nada)',
    explicito.ok === true && explicito.render === "image",
    JSON.stringify(explicito),
  );
}
