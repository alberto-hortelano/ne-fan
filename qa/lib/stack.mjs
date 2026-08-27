/** Los puertos del stack, para los procesos de QA que corren en NODE.
 *
 *  Ni una constante copiada: el bloque BASE se lee del snapshot que ya escribe
 *  `nefan-core/scripts/dump-config.ts` (`data/runtime_config.json`), el canal
 *  por el que los procesos no-TS del repo (ai_server, narrative-mcp,
 *  `qa/sprites-sin-servicio.mjs`) reciben la fuente única de
 *  `nefan-core/src/config.ts`. Antes el banco declaraba los suyos a mano —
 *  una constante `FAKE_AI` con el puerto del motor falso, una tabla `PUERTOS`,
 *  un `ws://127.0.0.1:<bridge>`— y esa copia no era solo duplicación: era lo único
 *  que de verdad sujetaba el guardarraíl de cero créditos, que se limitaba a
 *  leerla de vuelta.
 *
 *  Sobre el bloque base se suma `NEFAN_PORT_OFFSET`, que es como caben varias
 *  corridas a la vez en la misma máquina. Se lee del entorno EN CADA ACCESO y
 *  no una vez al importar, a propósito: `qa/run.mjs` elige el bloque libre
 *  después de arrancar (necesita sondear puertos) y los guiones se cargan
 *  después, así que un valor congelado al importar sería el del mundo sin
 *  desplazar. El snapshot NO lleva el offset —es uno por checkout y dos
 *  corridas se lo pisarían—, por eso cada consumidor lo suma.
 *
 *  Lo que corre DENTRO de la página no pasa por aquí: eso lo resuelve el
 *  cliente con `window.__nefan.servicios()`, que es la URL que el juego usa de
 *  verdad. Aquí solo vive lo que node necesita antes de que haya página
 *  (esperar un puerto, arrancar el stack, abrir un WebSocket de diagnóstico).
 *
 *  Fail-loud: un snapshot sin la clave que se pide, o un offset que no es un
 *  entero, son errores con nombre — no un `?? 9877` que deja el banco midiendo
 *  otro proceso.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SNAPSHOT = join(repoRoot, "nefan-core", "data", "runtime_config.json");

function leerSnapshot() {
  try {
    return JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  } catch (err) {
    throw new Error(
      `no puedo leer ${SNAPSHOT} (${err.message}). Es el snapshot de la fuente ` +
        `única de puertos: regenéralo con \`cd nefan-core && npm run dump-config\`.`,
    );
  }
}

const snapshot = leerSnapshot();

/** El bloque BASE tal cual lo declara la fuente única, SIN desplazar. Es lo
 *  que hace falta para buscar un bloque libre (sondear base+0, base+100…). */
export const PUERTOS_BASE = Object.freeze({ ...(snapshot.ports ?? {}) });

/** Desplazamiento vigente de ESTE proceso. Misma regla que `portOffset` en
 *  `nefan-core/src/contracts/service-registry.ts`: dígitos decimales, 0..40000,
 *  y LANZA si no. Colapsar un valor raro a 0 sería arrancar encima del stack
 *  del vecino justo cuando alguien creía haberlo separado. */
export function offsetActual(env = process.env) {
  const raw = env.NEFAN_PORT_OFFSET;
  if (raw === undefined || raw === "") return 0;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n > 40000) {
    throw new Error(`NEFAN_PORT_OFFSET inválido: ${JSON.stringify(raw)} (entero de 0 a 40000)`);
  }
  return n;
}

function puerto(clave) {
  const v = PUERTOS_BASE[clave];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(
      `runtime_config.json no declara ports.${clave} (hay: ${Object.keys(PUERTOS_BASE).join(", ")})`,
    );
  }
  return v + offsetActual();
}

/** Los puertos que el banco necesita nombrar desde node, ya desplazados. */
export const PUERTOS = {
  get bridge() { return puerto("bridge"); },
  get state_api() { return puerto("state_api"); },
  get html() { return puerto("html"); },
  get fake_ai() { return puerto("fake_ai"); },
};

/** El bloque entero, ya desplazado. Lo usan los guiones sueltos que hablan con
 *  servicios que la batería no levanta (remote-gen, asset-store, sprite-forge). */
export const PUERTOS_TODOS = new Proxy(
  {},
  {
    get: (_t, k) => (typeof k === "string" ? puerto(k) : undefined),
    has: (_t, k) => typeof k === "string" && k in PUERTOS_BASE,
    ownKeys: () => Object.keys(PUERTOS_BASE),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);

export const URLS = {
  get html() { return `http://localhost:${PUERTOS.html}`; },
  get bridge_ws() { return `ws://127.0.0.1:${PUERTOS.bridge}`; },
  get state_api() { return `http://127.0.0.1:${PUERTOS.state_api}`; },
  get fake_ai() { return `http://127.0.0.1:${PUERTOS.fake_ai}`; },
};
