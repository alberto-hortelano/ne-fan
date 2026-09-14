/** El bridge que LLEGA después de que el bootstrap fallara por su ausencia te
 *  OFRECE entrar, y se entra sin recargar la página (#478).
 *
 *  Lo que pasaba hasta el 2026-09-14: el muro «Sin conexión con la partida» se
 *  retiraba solo al abrir el socket —lo puso un aviso, y `resuelto("bridge")`
 *  se lo llevaba con su causa— y detrás no quedaba el juego sino el VISOR de
 *  fixtures, sin un botón que llevara al título («Volver al título» está oculto
 *  en ese muro, que el aviso pinta con la salida `cerrar`). Con el chip diciendo
 *  «Disconnected» sobre un socket abierto. La única salida era recargar.
 *
 *  El usuario eligió la opción (b) —que te lo OFREZCA, no que se rearranque
 *  solo—, así que lo que se mide aquí es: el muro deja de ser el del aviso y
 *  pasa a ofrecer «Reintentar», el chip dice la verdad, y pulsar ese botón abre
 *  el título SIN recargar.
 *
 *  LO QUE ESTE GUION PERDIÓ, y es decisión escrita, no olvido: afirmaba «el muro
 *  se retira» y «se queda retirado». La oferta SUSTITUYE al muro del aviso en el
 *  mismo turno síncrono (`connected` pinta antes de que corra la microtarea de
 *  `resuelto`), así que esa retirada no se puede observar desde fuera sin meter
 *  un parpadeo, y un parpadeo es peor que el aserto. La fila «aviso → resuelto →
 *  se retira» de la tabla de `ui/muro-de-carga.ts` sigue viva en el OTRO
 *  escenario —caída y reconexión con partida en marcha—, que hoy no tiene
 *  guion: es el #584.
 *
 *  Cómo se llega, sin tocar ningún proceso ajeno: se pide al kernel un puerto
 *  libre (como el 20) y el socket de la página se apunta ahí con `?bridge=`
 *  ANTES de que exista nadie; se deja fallar el bootstrap —por ESTADO: la
 *  entrada `session` «bootstrap failed» del registro— y se afirma UN muro con
 *  ese titular y un detalle en el idioma del jugador. Entonces LLEGA el
 *  bridge: uno de verdad (`bridge/ws-server.ts`) en ese puerto, con su propio
 *  disco de saves y el motor apuntado a un puerto muerto (no se le pide nada;
 *  aquí ni siquiera hay partida). `bridge-client` reintenta cada 5 s, el
 *  siguiente intento abre, y `onopen` emite `connected`.
 *
 *  Se intentó antes con `page.routeWebSocket` de Playwright atendiendo la URL
 *  muerta (sin servidor detrás): el socket NO llegó a abrir (0 `connected` en
 *  60 s, medido el 2026-09-06), así que el bridge real es el camino.
 *
 *  PROBADO EN NEGATIVO (2026-09-14): con el cuerpo de `atarLaOfertaDeEntrar`
 *  vaciado (`ui/la-partida-llego-tarde.ts`), el socket abre y el muro se queda
 *  siendo el del aviso: ROJOS los tres asertos nuevos —la oferta, el chip y el
 *  título sin recargar—. Restaurado después.
 *
 *  Cero créditos: no hay partida, y el bridge que llega tiene el motor en un
 *  puerto muerto. No se pulsa «Comenzar»: se llega al título y se para ahí.
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
/** El titular del muro que pone el AVISO de «no hay servidor de partida». La
 *  oferta tiene que dejar de ser este, y por eso se nombra una sola vez. */
const MURO_DEL_AVISO = "Sin conexión con la partida";
/** La marca que demuestra que NO hubo navegación: una recarga estrena contexto
 *  de JS y se la lleva por delante. */
const MARCA = "__qa78_mismoContexto";

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

/** El muro tal y como lo ve quien juega (mismo lector que el 20, el 71 y el
 *  77): un botón se ve si OCUPA SITIO, no por su atributo `hidden`. */
const leerMuro = (ctx) =>
  ctx.page.evaluate(() => {
    const l = document.getElementById("narrative-loader");
    const volver = document.getElementById("narrative-loader-back");
    const cerrar = document.getElementById("narrative-loader-dismiss");
    const reintentar = document.getElementById("narrative-loader-retry");
    return {
      visible: Boolean(l?.classList.contains("visible")),
      enError: Boolean(l?.classList.contains("error")),
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
      volverVisible: Boolean(volver) && volver.offsetParent !== null,
      cerrarVisible: Boolean(cerrar) && cerrar.offsetParent !== null,
      reintentarVisible: Boolean(reintentar) && reintentar.offsetParent !== null,
      reintentarTexto: reintentar?.textContent ?? "",
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
    `sin bridge el jugador ve el muro «${MURO_DEL_AVISO}» (puesto por el aviso)`,
    puesto.visible && puesto.enError && puesto.titulo === MURO_DEL_AVISO,
    `«${puesto.titulo}»`,
  );
  ctx.expect(
    "…con un detalle en su idioma: ni `bridge`, ni `ws://`, ni ms (#469)",
    puesto.detalle.length > 0 && !JERGA.test(puesto.detalle),
    puesto.detalle,
  );
  ctx.expect(
    "…y sin nada que pulsar que lleve al juego: ese es el callejón de #478",
    puesto.reintentarVisible === false && puesto.volverVisible === false,
    JSON.stringify({ reintentar: puesto.reintentarVisible, volver: puesto.volverVisible }),
  );
  await ctx.shot("478-muro-antes-de-que-llegue-el-bridge");

  // ── 3 · el bridge llega tarde y el muro pasa a OFRECER ──────────────────
  const { proc, dir } = await llegaElBridge(ctx);
  try {
    // El reintento del socket es cada 5 s; el margen cubre dos. Se espera al
    // BOTÓN, que es lo que el jugador busca en pantalla.
    const ofrecido = await ctx.absorbe(
      "la oferta se afirma justo debajo con el muro leído después: una expiración aquí ES el rojo de esos asertos",
      () =>
        ctx.waitFor(
          "el socket abre y el muro pasa a ofrecer «Reintentar»",
          () => {
            const b = document.getElementById("narrative-loader-retry");
            return b && b.offsetParent !== null ? true : null;
          },
          15_000,
        ),
    );
    const oferta = await leerMuro(ctx);
    ctx.log(`tras llegar el bridge: ${JSON.stringify(oferta)} · conexiones: ${conexiones.length}`);
    // NO CONCLUYENTE antes que rojo: si el socket no llegó a abrir, lo que se
    // probaría es el bridge de prueba, no la oferta.
    ctx.expect(
      "el socket llegó a abrir (`BridgeClient: connected` en consola): si no, este guion no prueba lo suyo",
      conexiones.length >= 1,
      `${conexiones.length} conexión(es)`,
    );
    ctx.expect(
      "#478: el muro ya NO es el del aviso — otro titular, y sigue sin jerga",
      ofrecido === true &&
        oferta.visible &&
        oferta.titulo !== MURO_DEL_AVISO &&
        oferta.titulo.length > 0 &&
        !JERGA.test(oferta.detalle),
      JSON.stringify({ titulo: oferta.titulo, detalle: oferta.detalle }),
    );
    ctx.expect(
      "…y ofrece «Reintentar» CON «Cerrar» al lado, y no el título (detrás está el visor de fixtures)",
      oferta.reintentarVisible && oferta.cerrarVisible && oferta.volverVisible === false,
      JSON.stringify({
        reintentar: `${oferta.reintentarTexto}/${oferta.reintentarVisible}`,
        cerrar: oferta.cerrarVisible,
        volver: oferta.volverVisible,
      }),
    );
    // ASCIENDE A ASERTO (hasta hoy solo se logueaba): el chip decía
    // «Disconnected» con el socket abierto, que es la mitad barata de #478.
    ctx.expect(
      "#478: el chip dice la verdad — «Bridge» con el socket abierto",
      oferta.conexion === "Bridge",
      `«${oferta.conexion}» (#ts-error=${JSON.stringify(oferta.tsError)})`,
    );
    await ctx.shot("478-la-oferta-de-entrar");

    // ── 4 · se entra por el botón, y SIN recargar ────────────────────────
    await ctx.page.evaluate((marca) => {
      window[marca] = true;
    }, MARCA);
    await ctx.page.click("#narrative-loader-retry");
    const enElTitulo = await ctx.absorbe(
      "el título se afirma justo debajo: una expiración aquí ES el rojo de ese aserto",
      () => ctx.waitFor("«Reintentar» abre la pantalla de título", () => window.__nefan.status().title || null, 30_000),
    );
    const despues = await ctx.page.evaluate(
      (marca) => ({
        marca: Boolean(window[marca]),
        muroVisible: Boolean(document.getElementById("narrative-loader")?.classList.contains("visible")),
        conexion: document.getElementById("connection-status")?.textContent ?? "",
      }),
      MARCA,
    );
    ctx.log(`tras pulsar «Reintentar»: ${JSON.stringify(despues)}`);
    ctx.expect(
      "#478: pulsar «Reintentar» lleva al título Y NO RECARGA la página (la marca del contexto sigue puesta)",
      enElTitulo === true && despues.marca === true,
      JSON.stringify({ titulo: enElTitulo, marca: despues.marca }),
    );
    ctx.expect(
      "…y la oferta se va al aceptarla: no queda muro tapando el título",
      despues.muroVisible === false,
      `visible=${despues.muroVisible}`,
    );
    ctx.expect(
      "…con el chip todavía diciendo la verdad, ahora desde el cliente de verdad",
      despues.conexion === "Bridge",
      `«${despues.conexion}»`,
    );
    await ctx.shot("478-el-titulo-sin-recargar");
  } finally {
    // El GRUPO entero (ver `detached`), esperando a que suelte el puerto.
    try { process.kill(-proc.pid, "SIGTERM"); } catch { /* ya se había ido */ }
    if (!(await esperarPuertoLibre(PUERTO_WS, { maxMs: 15_000 }))) {
      ctx.log(`⚠ :${PUERTO_WS} sigue ocupado tras 15 s`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
