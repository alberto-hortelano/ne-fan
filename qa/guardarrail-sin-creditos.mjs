#!/usr/bin/env node
/** ¿Se NIEGA de verdad el guardarraíl de cero créditos?
 *
 *  Es el candado del criterio que toca dinero, y existe porque el guardarraíl
 *  anterior daba verde sin medir nada: `backendEsFalso` leía el `?ai=` de la
 *  página y comprobaba si contenía el puerto del motor falso — o sea, leía de
 *  vuelta la constante que el propio runner acababa de escribir en esa URL.
 *  Ejecutado el par URL/regex, SIEMPRE devolvía `true`. Los tres guiones que se
 *  creían protegidos (07, 15, 21) llevaban meses corriendo detrás de un `if`
 *  que no podía dar `false`, y nadie se enteró porque un guardarraíl que no se
 *  dispara nunca se ve exactamente igual que uno que funciona.
 *
 *  Así que lo que hay que probar NO es que deje pasar al motor falso: es que se
 *  NIEGUE en los desenlaces malos. Aquí se le pone delante, uno a uno, cada
 *  backend que no debe bendecir — y se ejerce la función DE VERDAD
 *  (`diagnosticoDeCreditos` de qa/lib/sesion.mjs) desde una página real en
 *  Chromium, con su CORS y sus fetch, no una copia de su lógica.
 *
 *  Los backends son servidores de pega en puertos EFÍMEROS: eso demuestra de
 *  paso lo que el criterio 5 pide en su tercer desenlace —que el guardarraíl
 *  siga funcionando con el motor falso en un puerto desplazado—, porque aquí
 *  no hay ni un número de puerto escrito a mano.
 *
 *  Uso:  node qa/guardarrail-sin-creditos.mjs [--headed]
 *  Cero créditos: no arranca ningún servicio real. Son cuatro `http.Server`
 *  que contestan JSON y una página estática.
 */
import http from "node:http";
import { chromium } from "playwright-core";
import { abrirNavegador } from "./lib/navegador.mjs";
import { diagnosticoDeCreditos } from "./lib/sesion.mjs";
import { PUERTOS } from "./lib/stack.mjs";

const HEADED = process.argv.includes("--headed");
const fallos = [];
const servidores = [];
/** Cuántos desenlaces se han ejercido de verdad. Se cuenta y no se escribe a
 *  mano: la versión anterior decía «siete» cuando eran ocho. */
let ejercidos = 0;

const ok = (t) => {
  ejercidos++;
  console.log(`  ✔ ${t}`);
};
const mal = (t, detalle) => {
  ejercidos++;
  console.log(`  ✘ ${t}${detalle ? ` — ${detalle}` : ""}`);
  fallos.push(t);
};

/** Un servidor de pega que contesta `body` en /health, con CORS abierto — que
 *  es lo que hacen tanto el motor falso como la State API del bridge, así que
 *  no hay caso que necesite cerrarlo. (El desenlace «el CORS no deja leer» ya
 *  está cubierto: se resuelve por la misma rama que «no contesta».) */
function servidor(body) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const cors = { "Access-Control-Allow-Origin": "*" };
      if (req.method === "OPTIONS") {
        resp.writeHead(204, cors);
        return resp.end();
      }
      resp.writeHead(200, { "Content-Type": "application/json", ...cors });
      resp.end(JSON.stringify(typeof body === "function" ? body() : body));
    });
    srv.listen(0, "127.0.0.1", () => {
      servidores.push(srv);
      res({ srv, url: `http://127.0.0.1:${srv.address().port}` });
    });
  });
}

/** Una página real servida por HTTP (no `about:blank`: el guardarraíl hace
 *  fetch cross-origin y sin origen de verdad el CORS no significaría nada).
 *  Publica `__nefan.servicios()` exactamente como el cliente. */
function paginaConServicios() {
  return new Promise((res) => {
    const srv = http.createServer((_req, resp) => {
      resp.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      resp.end(
        `<!doctype html><title>guardarrail</title><script>
           window.__nefan = { servicios: () => JSON.parse(document.getElementById("u").textContent) };
         </script><pre id="u">{}</pre>`,
      );
    });
    srv.listen(0, "127.0.0.1", () => {
      servidores.push(srv);
      res({ url: `http://127.0.0.1:${srv.address().port}/` });
    });
  });
}

/** Un puerto donde NO hay nadie: se abre y se cierra para saber que existe y
 *  está libre, que es más honesto que inventarse un número. */
async function puertoMuerto() {
  const { srv } = await servidor({});
  const url = `http://127.0.0.1:${srv.address().port}`;
  await new Promise((r) => srv.close(r));
  servidores.splice(servidores.indexOf(srv), 1);
  return url;
}

const SALUD_FALSA = { status: "ready", fake: true };
// El shape real de ai_server/main.py (GET /health).
const SALUD_REAL = {
  status: "ready",
  fake: false,
  mode: "narrative",
  cache_total_bytes: 0,
  cache_max_bytes: 0,
  cache_over_limit: false,
};
// El shape que tenía el motor falso ANTES de esta tanda: contesta poco y no
// declara nada. Es el caso que la alternativa descartada —«es falso si le
// faltan los campos del real»— habría bendecido.
const SALUD_MUDA = { status: "ready" };

async function main() {
  const falso = await servidor(SALUD_FALSA);
  const real = await servidor(SALUD_REAL);
  const parco = await servidor(SALUD_MUDA);
  const muerto = await puertoMuerto();
  const pagina = await paginaConServicios();

  /** El gateway que la página dice usar. Los casos lo mueven para ejercer la
   *  identidad de la vía del bridge. */
  // Derivados, no escritos: la regla `nadie-inventa-un-puerto` cazó estos
  // literales en cuanto los escribí, que es exactamente su trabajo. El «otro»
  // gateway solo tiene que ser DISTINTO — modela el `?bridge=` de un guion que
  // levanta el suyo.
  const GATEWAY = `ws://127.0.0.1:${PUERTOS.bridge}`;
  const OTRO_GATEWAY = `ws://127.0.0.1:${PUERTOS.bridge + 10000}`;
  let gatewayDelBridge = GATEWAY;
  let gatewayDeLaPagina = GATEWAY;

  /** La State API del bridge: declara a qué motor habla (criterio 5 bis) y con
   *  qué gateway está emparejada (la identidad de esa vía). */
  let motorDelBridge = falso.url;
  const stateApi = await servidor(() => ({
    ok: true,
    session_id: null,
    has_session: false,
    game_id: null,
    ai_server_url: motorDelBridge,
    gateway_url: gatewayDelBridge,
  }));
  /** Una State API que NO publica el motor (un bridge anterior a esta tanda). */
  const stateApiMuda = await servidor(() => ({
    ok: true, session_id: null, has_session: false, game_id: null, gateway_url: gatewayDelBridge,
  }));
  /** Una que no dice DE QUIÉN es: publica el motor pero no su gateway. */
  const stateApiSinIdentidad = await servidor(() => ({
    ok: true, session_id: null, has_session: false, game_id: null, ai_server_url: motorDelBridge,
  }));

  const browser = await abrirNavegador(chromium, { headed: HEADED });
  const page = await browser.newPage();
  await page.goto(pagina.url, { waitUntil: "domcontentloaded" });
  const ctx = { page, log: (m) => console.log(`      ${m}`) };

  /** Pone el mapa de servicios que verá la página y pregunta al guardarraíl. */
  async function preguntar({ cliente, state }) {
    await page.evaluate(
      (v) => {
        document.getElementById("u").textContent = JSON.stringify(v);
      },
      { "narrative-llm": cliente, "world-state": state, "game-gateway": gatewayDeLaPagina },
    );
    return diagnosticoDeCreditos(ctx, 2500);
  }

  const casos = [
    {
      // (c) del criterio 5 — el ÚNICO que debe correr.
      titulo: "fake en un puerto cualquiera (desplazado) + bridge al fake → CORRE",
      cliente: falso.url,
      state: stateApi.url,
      motor: falso.url,
      espera: true,
    },
    {
      // (a) del criterio 5 — el que cuesta dólares.
      titulo: "la PÁGINA apunta al motor REAL → se niega",
      cliente: real.url,
      state: stateApi.url,
      motor: falso.url,
      espera: false,
    },
    {
      // (a) por la SEGUNDA vía: la que el `?ai=` nunca cubrió. El cliente ve
      // el fake y el bridge pide escenas al motor real: se gasta igual.
      titulo: "el BRIDGE apunta al motor REAL aunque la página vea el fake → se niega",
      cliente: falso.url,
      state: stateApi.url,
      motor: real.url,
      espera: false,
    },
    {
      // (b) del criterio 5.
      titulo: "el motor del cliente no contesta (puerto muerto) → se niega",
      cliente: muerto,
      state: stateApi.url,
      motor: falso.url,
      espera: false,
    },
    {
      titulo: "la State API no contesta → se niega (no se sabe con quién habla el bridge)",
      cliente: falso.url,
      state: muerto,
      motor: falso.url,
      espera: false,
    },
    {
      titulo: "la State API no publica ai_server_url → se niega",
      cliente: falso.url,
      state: stateApiMuda.url,
      motor: falso.url,
      espera: false,
    },
    {
      // La alternativa DESCARTADA en los requisitos, ejercida: un backend que
      // «contesta poco» no es un backend gratis.
      titulo: "un backend que contesta {status:ready} sin declarar `fake` → se niega",
      cliente: parco.url,
      state: stateApi.url,
      motor: falso.url,
      espera: false,
    },
    {
      titulo: "el motor del BRIDGE contesta poco y no declara `fake` → se niega",
      cliente: falso.url,
      state: stateApi.url,
      motor: parco.url,
      espera: false,
    },
    {
      // H3, el agujero que QA midió con el cliente real: `?bridge=` mueve el
      // gateway y NO mueve `world-state`, así que la State API del bloque base
      // avalaba a un bridge que la página no estaba usando — y un bridge sin
      // `NEFAN_AI_SERVER` apunta por defecto al ai_server REAL, que cobra.
      titulo: "la State API es de OTRO bridge que el que la página usa → se niega",
      cliente: falso.url,
      state: stateApi.url,
      motor: falso.url,
      gatewayPagina: OTRO_GATEWAY,
      gatewayBridge: GATEWAY,
      espera: false,
    },
    {
      titulo: "la State API no dice de qué gateway es → se niega",
      cliente: falso.url,
      state: stateApiSinIdentidad.url,
      motor: falso.url,
      espera: false,
    },
    {
      // Y la contraparte: con `?bridge=` a un bridge que SÍ es el que contesta,
      // el guardarraíl no estorba. Si no, el arreglo sería un «niégate siempre».
      titulo: "con `?bridge=` a un bridge que SÍ es el suyo y es falso → CORRE",
      cliente: falso.url,
      state: stateApi.url,
      motor: falso.url,
      gatewayPagina: OTRO_GATEWAY,
      gatewayBridge: OTRO_GATEWAY,
      espera: true,
    },
  ];

  for (const c of casos) {
    motorDelBridge = c.motor;
    gatewayDelBridge = c.gatewayBridge ?? GATEWAY;
    gatewayDeLaPagina = c.gatewayPagina ?? GATEWAY;
    const d = await preguntar(c);
    const bien = d.ok === c.espera;
    (bien ? ok : mal)(c.titulo, bien ? "" : `devolvió ${d.ok} · ${d.motivo}`);
    if (bien && !c.espera) console.log(`      motivo: ${d.motivo}`);
  }

  // Y la comprobación que hace falta porque el fallo de ayer fue justo este:
  // que la página SIN el hook no bendiga nada.
  await page.evaluate(() => {
    delete window.__nefan;
  });
  const sinHook = await diagnosticoDeCreditos(ctx, 2500);
  (sinHook.ok === false ? ok : mal)(
    "una página que no publica __nefan.servicios() → se niega",
    sinHook.ok === false ? "" : `devolvió ${sinHook.ok}`,
  );

  await browser.close();
}

try {
  await main();
} catch (err) {
  console.error("guardarrail-sin-creditos:", err);
  fallos.push(`ERROR: ${err.message}`);
} finally {
  await Promise.all(servidores.map((s) => new Promise((r) => s.close(r))));
}

console.log(`\n${fallos.length === 0 ? `✔ el guardarraíl decide bien en los ${ejercidos} desenlaces (${ejercidos - 2} malos, 2 buenos)` : `✘ ${fallos.length} fallo(s)`}`);
process.exit(fallos.length === 0 ? 0 : 1);
