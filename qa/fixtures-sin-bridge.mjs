#!/usr/bin/env node
/** ¿PINTA el preset `html-fixtures`?
 *
 *  Vive fuera de `qa/run.mjs` porque su stack es el contrario: run.mjs levanta
 *  `e2e-sin-creditos` (CON bridge) y todos sus guiones lo dan por hecho. Lo que
 *  aquí se prueba es justo lo que promete el preset sin backend —«iterar
 *  renderer y UI con las fixtures del selector Room, cero backend»—, así que
 *  necesita arrancar solo.
 *
 *  Nace del issue #215, y la lección que lo abrió está en su enunciado:
 *  verificar un preset comprobando que sus puertos están arriba NO BASTA.
 *  `qa/presets.mjs` daba verde a `html-fixtures` mientras el lienzo se quedaba
 *  NEGRO con la escena cargada — `gameClient` se quedaba a null sin bridge y el
 *  game loop salía por su guarda antes de `render()`.
 *
 *  El candado NO son píxeles: es `fps().frames`, los frames que el renderer ha
 *  EMITIDO. Un renderer «ready» con tiles instalados no demuestra nada (era
 *  exactamente el estado del bug). Y leer el lienzo desde la página tampoco
 *  vale: `getImageData` sobre un canvas WebGL sin `preserveDrawingBuffer`
 *  devuelve negro AUNQUE el juego esté pintando — ese falso negativo se comió
 *  media hora durante el arreglo. La captura queda para el ojo, no para el
 *  veredicto.
 *
 *  Uso:  node qa/fixtures-sin-bridge.mjs [--headed] [--keep]
 *  Cero créditos: sin ai_server, sin asset-store, sin generadores.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { puertoOcupado } from "./lib/puertos.mjs";
import { chromium } from "playwright-core";
import { abrirNavegador } from "./lib/navegador.mjs";
import { ctxDeSonda } from "./lib/sonda.mjs";
import { cargarFixture } from "./lib/fixtures.mjs";
import { PUERTOS, offsetActual } from "./lib/stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const SHOTS = join(here, "capturas");
const HEADED = process.argv.includes("--headed");
const KEEP = process.argv.includes("--keep");
const PORT = PUERTOS.html;
/** El navegador no tiene entorno: el bloque de puertos viaja en la URL (mismo
 *  criterio que `run.mjs`; con offset 0 no se escribe). Sin él, la página
 *  resolvería el bridge al bloque DE SIEMPRE — medido el 2026-08-31: con otra
 *  corrida en la máquina, el muro «sin bridge» no aparecía porque la página
 *  había encontrado el bridge del stack de al lado. */
const OFFSET = offsetActual();
/** El socket movido a OTRO host y OTRO puerto, que es lo que hace `?bridge=`
 *  en el stack E2E de labs/narrative. Ni el host ni el puerto salen del
 *  snapshot: si el muro cita el snapshot, miente en los dos (#341). `127.0.0.2`
 *  es loopback igual que el `.1` —así que la conexión se rechaza en el acto y
 *  el muro sale— pero no lo escribe nadie más en el repo. */
const HOST_MOVIDO = "127.0.0.2";
const BRIDGE_MOVIDO = `ws://${HOST_MOVIDO}:${PUERTOS.bridge + 3}`;

/** Espera booleana (no lanza): este guion afirma sobre el arranque en vez de
 *  morir con una excepción. El sondeo es el compartido. */
async function waitPort(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await puertoOcupado(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Espera el muro de arranque y afirma que cita la URL EFECTIVA del socket
 *  (#341): la que la propia página dice haber resuelto con `serviceUrl`, ya
 *  aplicados los overrides de la query. Se compara contra lo que declara la
 *  página y NO contra una URL que escriba este guion, porque escribirla aquí
 *  sería la tautología de siempre: el runner afirmando su propio texto.
 *
 *  La aserción vieja —`/bridge/i.test(detalle)`— la implica y se fue con ella:
 *  la palabra «bridge» sale igual en un muro que manda a mirar al puerto
 *  equivocado. */
async function muroCitaElSocket(page, ctx, fallos, etiqueta) {
  // Se espera al muro DE BOOTSTRAP por su titular, no a «un muro cualquiera en
  // rojo». Desde #306 el `onerror` del socket pinta el suyo un instante antes
  // (a los ~0 ms, contra los 5 s que tarda el timeout de `createGameClient`):
  // esperar por la clase `error` a secas mediría ese, y este candado dejaría de
  // mirar el mensaje que #341 arregla.
  await ctx.waitFor(
    `el muro de arranque del bridge · ${etiqueta}`,
    () =>
      document.getElementById("narrative-loader")?.classList.contains("error") === true &&
      (document.getElementById("narrative-loader-title")?.textContent ?? "").includes(
        "No se pudo arrancar la partida",
      ),
    20000,
  );
  const { detalle, socket } = await page.evaluate(() => ({
    detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
    socket: window.__nefan.servicios()["game-gateway"],
  }));
  console.log(`· ${etiqueta} · socket efectivo ${socket}`);
  console.log(`  muro: "${detalle.slice(0, 100)}…"`);
  if (!detalle.includes(socket)) {
    fallos.push(
      `${etiqueta}: el muro no cita la URL efectiva del socket (${socket}) — dice "${detalle.slice(0, 130)}"`,
    );
  }
  return detalle;
}

// La espera por ESTADO es la de `qa/lib/sonda.mjs` — la MISMA que usa el
// runner, no una tercera copia con su propio reloj (#332).

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const fallos = [];
  let child = null;

  if (await puertoOcupado(PORT)) {
    console.log(`· :${PORT} ya está arriba — lo uso tal cual, no arranco nada`);
  } else {
    // Por SLUG, no por número: los números de preset se renumeran.
    console.log("· arrancando ./start.sh --preset html-fixtures…");
    child = spawn("./start.sh", ["--preset", "html-fixtures"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child.stdout.on("data", (b) => process.env.QA_VERBOSE && process.stdout.write(`  | ${b}`));
    if (!(await waitPort(PORT, 60000))) throw new Error(`el preset no levantó :${PORT} en 60 s`);
  }

  const browser = await abrirNavegador(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const ctx = ctxDeSonda(page);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  try {
    await page.goto(`http://localhost:${PORT}/${OFFSET ? `?offset=${OFFSET}` : ""}`, {
      waitUntil: "domcontentloaded",
    });
    await ctx.waitFor("window.__nefan", () => Boolean(window.__nefan));

    // Sin bridge, el arranque de partida falla a propósito (require_bridge) y
    // el jugador ve el muro de error. Eso es CORRECTO y se comprueba: lo que
    // no puede pasar es que además se lleve por delante el visor.
    //
    // Se espera por el MURO concreto (#narrative-loader en estado error), no
    // por «un botón que ponga Cerrar»: el título tiene el suyo y aparece al
    // instante, así que esa espera devolvía el control ~4 s antes de que el
    // bootstrap terminara y medía el juego a medio arrancar.
    // Y ANTES que el muro del arranque, el aviso del SOCKET (#306). Es la otra
    // mitad del canal: con el título todavía sin pintar no hay `#ts-error`
    // donde escribir, así que el aviso va al muro — el sitio que el jugador
    // tiene delante en ese instante. Sin esto, el cliente se queda cinco
    // segundos mudo mientras el socket ya ha fallado.
    const avisoDelSocket = await ctx
      .waitFor(
        "el aviso del socket llega al muro antes que el timeout del arranque",
        () =>
          (document.getElementById("narrative-loader-title")?.textContent ?? "").includes(
            "Sin conexión con la partida",
          )
            ? { detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "" }
            : null,
        4000,
      )
      .catch(() => null);
    if (!avisoDelSocket) {
      fallos.push(
        "el fallo del socket no se dice: el jugador espera al timeout del arranque sin saber nada (#306)",
      );
    } else {
      console.log(`· aviso del socket: "${avisoDelSocket.detalle.slice(0, 80)}"`);
    }

    await muroCitaElSocket(page, ctx, fallos, "sin bridge");
    await page.screenshot({ path: join(SHOTS, "sin-bridge-01-error-de-arranque.png") });
    await page.evaluate(() => document.getElementById("narrative-loader-dismiss")?.click());

    // AFIRMA qué escena quedó puesta y espera el tile pintable (#332): la
    // espera propia por `status().scene` era el patrón de #308. Sin bridge la
    // lib vale igual — si algún día `fps()` no se poblara sin bridge, el
    // timeout lo NOMBRA en vez de dejar el candado midiendo a medio arrancar.
    await cargarFixture(ctx, "robledo_tile");

    // EL CANDADO: frames emitidos. Dos muestras separadas — que haya frames no
    // basta, tienen que seguir saliendo.
    const f0 = await page.evaluate(() => window.__nefan.fps().frames);
    await new Promise((r) => setTimeout(r, 1500));
    const f1 = await page.evaluate(() => window.__nefan.fps().frames);
    console.log(`· frames emitidos: ${f0} → ${f1}`);
    if (typeof f1 !== "number") fallos.push("fps().frames no existe: el renderer no lo publica");
    else if (f1 <= f0) fallos.push(`el renderer NO pinta: frames ${f0} → ${f1} (el lienzo se queda negro)`);

    const st = await page.evaluate(() => window.__nefan.fps());
    console.log(`· tiles: ${JSON.stringify(st.tiles)} · billboards: ${st.billboards}`);
    if (!st.tiles?.length) fallos.push("ningún tile instalado en el renderer");
    if (!st.billboards) fallos.push("0 billboards: la fixture trae NPCs y no se montó ninguno");

    await page.screenshot({ path: join(SHOTS, "sin-bridge-02-fixture-pintada.png") });

    // SEGUNDA PASADA, y es la que le da dientes al candado de arriba: el
    // socket movido a otro host y otro puerto con `?bridge=`. Con el bloque de
    // puertos por defecto, `ws://localhost:<snapshot>` y la URL efectiva solo
    // se diferencian en el nombre del host, así que un muro mentiroso casi
    // colaba; aquí no coincide nada. Es además el caso REAL del stack E2E de
    // labs/narrative, donde el muro mandaba a mirar a una máquina que no era.
    const q = new URLSearchParams();
    if (OFFSET) q.set("offset", String(OFFSET));
    q.set("bridge", BRIDGE_MOVIDO);
    await page.goto(`http://localhost:${PORT}/?${q}`, { waitUntil: "domcontentloaded" });
    await ctx.waitFor("window.__nefan (bridge movido)", () => Boolean(window.__nefan));
    const detalleMovido = await muroCitaElSocket(page, ctx, fallos, "bridge movido");
    if (!detalleMovido.includes(HOST_MOVIDO)) {
      fallos.push(`con \`?bridge=\` el muro no nombra el host al que apunta el socket (${HOST_MOVIDO})`);
    }
    await page.screenshot({ path: join(SHOTS, "sin-bridge-03-bridge-movido.png") });

    if (pageErrors.length) fallos.push(`${pageErrors.length} excepción(es) en la página: ${pageErrors[0]}`);
  } finally {
    await browser.close();
    if (child && !KEEP) process.kill(-child.pid, "SIGINT");
    else if (child) console.log("· stack sigue arriba (--keep)");
  }

  console.log(`\n${"─".repeat(60)}`);
  if (fallos.length === 0) {
    console.log("✔ html-fixtures pinta sin backend · capturas en qa/capturas/");
    process.exit(0);
  }
  for (const f of fallos) console.log(`✘ ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`✘ ERROR: ${err.message}`);
  process.exit(2);
});
