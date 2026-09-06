/** El bridge que LLEGA después de que el bootstrap fallara por su ausencia
 *  retira el muro «Sin conexión con la partida» (#469, política de
 *  `muroPuestoPorAviso`).
 *
 *  Es la fila de la tabla de `ui/muro-de-carga.ts` que nadie ejercía: el muro
 *  lo puso un AVISO (fuente `bridge`), así que `resuelto("bridge")` —que
 *  `bridge-client` llama al abrir el socket— lo retira. Hasta #469 salía igual
 *  por accidente: `fallo()` no tocaba la propiedad y el muro del bootstrap
 *  heredaba la fuente del aviso. Ahora `fallo()` la pone a `null` y el muro
 *  que se retira es el del aviso, que es el único que hay.
 *
 *  Cómo se llega, sin tocar ningún proceso ajeno: se pide al kernel un puerto
 *  libre (como el 20) y el socket de la página se apunta ahí con `?bridge=`
 *  ANTES de que exista nadie; se deja fallar el bootstrap —por ESTADO: la
 *  entrada `session` «bootstrap failed» del registro— y se afirma UN muro con
 *  ese titular y un detalle en el idioma del jugador. Entonces LLEGA el
 *  bridge: uno de verdad (`bridge/ws-server.ts`) en ese puerto, con su propio
 *  disco de saves y el motor apuntado a un puerto muerto (no se le pide nada;
 *  aquí ni siquiera hay partida). `bridge-client` reintenta cada 5 s, el
 *  siguiente intento abre, `onopen` llama `errors.resuelto("bridge")` y el
 *  muro se va.
 *
 *  Se intentó antes con `page.routeWebSocket` de Playwright atendiendo la URL
 *  muerta (sin servidor detrás): el socket NO llegó a abrir (0 `connected` en
 *  60 s, medido el 2026-09-06), así que el bridge real es el camino.
 *
 *  Lo que se LOGUEA y no se afirma (backlog, no de esta PR): tras un bootstrap
 *  fallido el cliente es un visor hasta recargar, así que el bridge que llega
 *  no rearranca nada y `#connection-status` se queda en «Disconnected» con el
 *  socket abierto. Y `#ts-error`: el título no llega a pintarse en este flujo,
 *  así que la retirada en el título no tiene DOM donde medirse aquí (la mide
 *  el 70 con el título delante).
 *
 *  PROBADO EN NEGATIVO (2026-09-06): con `if (muroPuestoPorAviso === e.source)
 *  ocultar();` anulado en `muro-de-carga.ts`, el socket abre (`connected` en
 *  consola) y el muro se queda puesto: ROJO en «retira el muro» y en «se queda
 *  retirado». Restaurado después.
 *
 *  Cero créditos: no hay partida, y el bridge que llega tiene el motor en un
 *  puerto muerto.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { esperarPuertoArriba, esperarPuertoLibre, puertoOcupado, puertosLibres } from "../lib/puertos.mjs";

export const sinMotor =
  "apunta el socket de la página a un puerto libre donde aún no hay nadie (`?bridge=`) y luego levanta ahí " +
  "un bridge con el motor en un puerto muerto; no hay partida ni se le pide nada al motor";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Puertos LIBRES pedidos al kernel, fuera del catálogo de `start.sh` (misma
 *  razón que el 20: dos baterías a la vez no pueden pedir el mismo literal). */
const [PUERTO_WS, PUERTO_STATE] = await puertosLibres(2);
/** Un puerto donde NO hay nada: el motor "caído" sin matar a nadie. */
const MOTOR_MUERTO = "http://127.0.0.1:9";
/** Jerga de desarrollo que no puede llegar al muro del jugador (#469). */
const JERGA = /bridge|ws:\/\/|\d+\s*ms\b/i;

/** El bridge tardío: disco de saves propio (no escribe en el del repo) y el
 *  motor en un puerto muerto. Se arranca DESPUÉS de que el cliente haya
 *  fallado, que es todo el punto. */
async function llegaElBridge(ctx) {
  if (await puertoOcupado(PUERTO_WS)) {
    throw new Error(`:${PUERTO_WS} está ocupado y este guion necesita ese puerto para su bridge tardío`);
  }
  const dir = mkdtempSync(join(tmpdir(), "qa78-"));
  mkdirSync(join(dir, "saves"), { recursive: true });
  const proc = spawn("npx", ["tsx", "bridge/ws-server.ts"], {
    cwd: join(RAIZ, "nefan-core"),
    stdio: ["ignore", "pipe", "pipe"],
    // Grupo propio: `npx` es un envoltorio y matarlo a él deja vivo al `tsx`
    // de dentro, que es quien tiene el puerto (medido en el 20).
    detached: true,
    env: {
      ...process.env,
      NEFAN_BRIDGE_PORT: String(PUERTO_WS),
      NEFAN_STATE_HTTP_PORT: String(PUERTO_STATE),
      NEFAN_AI_SERVER: MOTOR_MUERTO,
      NEFAN_SAVES_DIR: join(dir, "saves"),
    },
  });
  const salida = [];
  proc.stdout.on("data", (b) => salida.push(String(b)));
  proc.stderr.on("data", (b) => salida.push(String(b)));
  await esperarPuertoArriba(PUERTO_WS, {
    maxMs: 90_000,
    quien: "el bridge que llega tarde",
    siMuere: () => (proc.exitCode !== null ? salida.join("").slice(-500) : null),
  });
  ctx.log(`el bridge llegó a :${PUERTO_WS} (disco propio ${dir})`);
  return { proc, dir };
}

/** El muro tal y como lo ve quien juega (mismo lector que el 20, el 71 y el 77). */
const leerMuro = (ctx) =>
  ctx.page.evaluate(() => {
    const l = document.getElementById("narrative-loader");
    return {
      visible: Boolean(l?.classList.contains("visible")),
      enError: Boolean(l?.classList.contains("error")),
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
      conexion: document.getElementById("connection-status")?.textContent ?? "",
      tsError: document.getElementById("ts-error")?.textContent ?? null,
    };
  });

/** ¿Ha fallado ya el bootstrap? Lo dice el registro, no el reloj. */
const bootstrapFallido = () =>
  [...document.querySelectorAll(".error-log__entry")].some(
    (e) =>
      (e.querySelector(".error-log__source")?.textContent ?? "").trim() === "session" &&
      (e.querySelector(".error-log__msg")?.textContent ?? "").includes("bootstrap failed"),
  )
    ? true
    : null;

export default async function (ctx) {
  // ── 1 · el socket, a un puerto donde AÚN no hay nadie ───────────────────
  const gateway = await ctx.page.evaluate(() => window.__nefan.servicios()["game-gateway"]);
  const url = new URL(ctx.page.url());
  url.searchParams.set("bridge", `ws://127.0.0.1:${PUERTO_WS}`);
  ctx.log(`socket apuntado a ws://127.0.0.1:${PUERTO_WS}, todavía sin nadie (el real era ${gateway})`);
  const conexiones = [];
  ctx.page.on("console", (m) => {
    if (m.text().startsWith("BridgeClient: connected")) conexiones.push(m.text());
  });
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin bridge", () => Boolean(window.__nefan));

  // ── 2 · el bootstrap falla y el jugador ve UN muro, en su idioma ────────
  await ctx.waitFor("el bootstrap falla sin bridge (entrada «bootstrap failed» del registro)", bootstrapFallido, 20_000);
  const puesto = await leerMuro(ctx);
  ctx.log(`con el bootstrap fallido: ${JSON.stringify(puesto)}`);
  ctx.expect(
    "sin bridge el jugador ve el muro «Sin conexión con la partida» (puesto por el aviso)",
    puesto.visible && puesto.enError && puesto.titulo === "Sin conexión con la partida",
    `«${puesto.titulo}»`,
  );
  ctx.expect(
    "…con un detalle en su idioma: ni `bridge`, ni `ws://`, ni ms (#469)",
    puesto.detalle.length > 0 && !JERGA.test(puesto.detalle),
    puesto.detalle,
  );
  await ctx.shot("469-muro-antes-de-que-llegue-el-bridge");

  // ── 3 · el bridge llega tarde ───────────────────────────────────────────
  const { proc, dir } = await llegaElBridge(ctx);
  try {
    // El reintento del socket es cada 5 s; el margen cubre dos.
    const retirado = await ctx.absorbe(
      "la retirada se afirma justo debajo con el estado del muro leído después: una expiración aquí ES el rojo de ese aserto",
      () =>
        ctx.waitFor(
          "el socket abre y el muro se retira solo (resuelto(\"bridge\") → muroPuestoPorAviso)",
          () => (document.getElementById("narrative-loader")?.classList.contains("visible") ? null : true),
          15_000,
        ),
    );
    const despues = await leerMuro(ctx);
    ctx.log(`tras llegar el bridge: ${JSON.stringify(despues)} · conexiones: ${conexiones.length}`);
    // NO CONCLUYENTE antes que rojo: si el socket no llegó a abrir, lo que se
    // probaría es el bridge de prueba, no la política del muro.
    ctx.expect(
      "el socket llegó a abrir (`BridgeClient: connected` en consola): si no, este guion no prueba lo suyo",
      conexiones.length >= 1,
      `${conexiones.length} conexión(es)`,
    );
    ctx.expect(
      "#469: el bridge que llega tarde retira el muro puesto por el aviso (fila «aviso» de la tabla de muro-de-carga.ts)",
      retirado === true && despues.visible === false,
      JSON.stringify(despues),
    );
    // Y no vuelve a ponerse solo: un socket abierto no es una noticia.
    const quieto = await ctx.page.evaluate(
      () =>
        new Promise((r) => {
          setTimeout(() => r(document.getElementById("narrative-loader")?.classList.contains("visible") ?? false), 1500);
        }),
    );
    ctx.expect("…y se queda retirado", quieto === false, `visible=${quieto}`);
    ctx.log(
      `backlog (se loguea, no se afirma): #connection-status=«${despues.conexion}» con el socket abierto; ` +
        `#ts-error=${JSON.stringify(despues.tsError)} (el título no se pintó en este flujo)`,
    );
    await ctx.shot("469-muro-retirado-al-llegar-el-bridge");
  } finally {
    // El GRUPO entero (ver `detached`), esperando a que suelte el puerto.
    try { process.kill(-proc.pid, "SIGTERM"); } catch { /* ya se había ido */ }
    if (!(await esperarPuertoLibre(PUERTO_WS, { maxMs: 15_000 }))) {
      ctx.log(`⚠ :${PUERTO_WS} sigue ocupado tras 15 s`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
