/** Esperas por el estado de un PUERTO, para los guiones que levantan su propio
 *  servicio.
 *
 *  El resto de esperas de un guion van por `ctx.waitFor`, que evalúa DENTRO de
 *  la página: sirve para todo lo que vive en el DOM o en `window.__nefan`, que
 *  hasta ahora era todo. Un guion que arranca su propio bridge —para provocar
 *  un fallo sin matar el que comparte la batería— necesita esperar a algo que
 *  no está en la página: un socket TCP. Eso se sondea desde node, y por eso
 *  vive aquí.
 *
 *  Aquí y no en el guion a propósito: `qa-guiones-sin-espera-por-reloj`
 *  (arch-rules.json, severidad `error`) prohíbe `new Promise(r =>
 *  setTimeout(r, N))` en `qa/guiones/**` y exime `qa/lib` justo para esto —
 *  «qa/lib ofrece las esperas por estado». Y no es una fuga: lo que la regla
 *  persigue es el SLEEP, esperar un tiempo de pared y dar por hecho que ya
 *  pasó. Estas dos funciones esperan por una CONDICIÓN (el puerto acepta / el
 *  puerto se suelta); el `setTimeout` es el intervalo de sondeo y el `maxMs`
 *  es un cortafuegos de deadlock, no la condición de parada. Si alguien mete
 *  aquí un sleep de verdad, ya no lo para ningún candado: que se note.
 */
import net from "node:net";
import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";

/** ¿Hay alguien escuchando? Una conexión que abre y se cierra: no manda nada,
 *  así que vale igual para un WebSocket que para un HTTP.
 *
 *  ES LA ÚNICA COPIA, y eso importa más de lo que parece. Llegó a haber CINCO
 *  —esta, dos en `run.mjs`, una en `dos-corridas.mjs` y otra en `presets.mjs`—
 *  y los cortafuegos ya habían divergido: 500 ms aquí, 800 ms allí. La que
 *  elige el bloque de puertos de una corrida decide si dos baterías colisionan,
 *  o sea el criterio 3 entero: no puede ser una copia con otro reloj.
 *
 *  `timeoutMs` es un cortafuegos, no la condición: la respuesta normal llega
 *  por `connect` o por `error` en microsegundos sobre loopback. Solo se agota
 *  con un puerto filtrado por firewall, y entonces «no contesta» = «no está». */
export function puertoOcupado(port, { host = "127.0.0.1", timeoutMs = 500 } = {}) {
  return new Promise((res) => {
    const s = net.connect({ port, host });
    const fin = (v) => {
      s.destroy();
      res(v);
    };
    s.once("connect", () => fin(true));
    s.once("error", () => fin(false));
    setTimeout(() => fin(false), timeoutMs);
  });
}

/** Espera a que `port` acepte conexión.
 *
 *  `siMuere` es la segunda condición de parada, y es la que evita el peor
 *  fallo de esta espera: que el proceso que tenía que abrir el puerto se haya
 *  caído y el guion se coma el cortafuegos entero para reportar un timeout
 *  genérico en vez del error de arranque. Devuelve el motivo (lo que haya
 *  escrito el proceso) o null si sigue vivo.
 *
 *  Lanza si no llega: un servicio que no arranca no es una espera que se
 *  agota, es un guion que no puede probar nada. */
export async function esperarPuertoArriba(
  port,
  { maxMs = 90_000, quien = `:${port}`, siMuere = () => null, intervaloMs = 300 } = {},
) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await puertoOcupado(port)) return true;
    const muerto = siMuere();
    if (muerto) throw new Error(`${quien} murió al arrancar: ${muerto}`);
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  throw new Error(`${quien} no levantó :${port} en ${Math.round(maxMs / 1000)} s`);
}

/** Espera a que `port` quede libre (cierre del servicio).
 *
 *  NO lanza, y la diferencia con la de arriba es deliberada: esto corre en el
 *  desmontaje, donde una excepción taparía el veredicto del guion. Devuelve si
 *  se soltó para que quien llama lo diga; la consecuencia de no soltarse la
 *  cobra la SIGUIENTE corrida, que se encuentra el puerto ocupado y falla al
 *  arrancar con un mensaje que sí explica qué pasa. */
export async function esperarPuertoLibre(port, { maxMs = 15_000, intervaloMs = 200 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (!(await puertoOcupado(port))) return true;
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  return false;
}

/** `n` puertos que el sistema declara libres AHORA MISMO.
 *
 *  Se los pide al kernel (bind al puerto 0, mirar cuál tocó, soltarlo) en vez
 *  de fijarlos a mano. La diferencia importa desde que en esta máquina puede
 *  haber dos baterías de QA a la vez: un guion que necesita su propio bridge y
 *  se lo clava en :9977 hace que la segunda corrida muera al arrancarlo, y ese
 *  rojo no es del juego.
 *
 *  Queda una ventana entre soltarlo y volver a tomarlo — inevitable sin
 *  heredar el socket—, así que quien lo use sigue teniendo que fallar claro si
 *  el puerto se le ha llevado alguien; lo que esto quita es la colisión
 *  SEGURA de dos números escritos a mano. */
export function puertosLibres(n = 1) {
  const abrir = () =>
    new Promise((res, rej) => {
      const srv = net.createServer();
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", () => res(srv));
    });
  return (async () => {
    const abiertos = [];
    for (let i = 0; i < n; i++) abiertos.push(await abrir());
    const puertos = abiertos.map((s) => s.address().port);
    await Promise.all(abiertos.map((s) => new Promise((r) => s.close(r))));
    return puertos;
  })();
}

/** Quién escucha en cada puerto, hasta donde el sistema deje verlo.
 *
 *  Existe porque «este puerto está ocupado» no basta para decidir de QUIÉN es
 *  el rojo (#296): en esta máquina trabajan varios agentes y los puertos del
 *  catálogo son los mismos para todos, así que un ocupante ajeno a mitad de
 *  corrida se le imputaba al preset que estaba pasando por ahí.
 *
 *  Mismo par de herramientas que `start.sh` (`ss` para saber quién escucha,
 *  `/proc/<pid>` para saber de dónde sale) y la misma frontera: se dice lo que
 *  se puede LEER, nunca lo que se supone. Un `/proc/<pid>/cwd` ilegible no se
 *  convierte en «ajeno» aquí —a diferencia de `start.sh`, donde el fallo caro
 *  es matar lo de otro— porque sprite-forge vive en otro repositorio y su cwd
 *  es el suyo aunque lo haya arrancado este launcher: llamarle ajeno dejaría el
 *  preset `play` en «no medido» para siempre. Quien decide es el llamador, con
 *  esto y con lo que ya sabía.
 *
 *  Devuelve un Map puerto → { procesos: [{ pid, comando, cwd, pgid }] }. Un
 *  puerto sin nadie NO aparece; un puerto cuyo dueño no se deja leer aparece
 *  con `procesos: []`. */
export function duenyosDeLosPuertos() {
  const porPuerto = new Map();
  let salida;
  try {
    salida = execFileSync("ss", ["-H", "-ltnp"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // Sin `ss` no se sabe de quién es ningún puerto. Es una respuesta legítima
    // ("no lo sé"), no un error: el llamador ya tiene el sondeo TCP.
    return porPuerto;
  }
  for (const linea of salida.split("\n")) {
    if (!linea.trim()) continue;
    // LISTEN 0 511 127.0.0.1:8767 0.0.0.0:* users:(("node",pid=123,fd=20))
    const campos = linea.trim().split(/\s+/);
    const local = campos[3] ?? "";
    const puerto = Number(local.slice(local.lastIndexOf(":") + 1));
    if (!Number.isInteger(puerto)) continue;
    const pids = [...linea.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
    const procesos = pids.map((pid) => ({ pid, ...procInfo(pid) }));
    const previo = porPuerto.get(puerto);
    if (previo) previo.procesos.push(...procesos);
    else porPuerto.set(puerto, { procesos });
  }
  return porPuerto;
}

/** Lo que `/proc/<pid>` deja leer de un proceso: comando, cwd y grupo. Cada
 *  campo por separado, porque cada uno puede faltar por su cuenta. */
function procInfo(pid) {
  let comando = null;
  let cwd = null;
  let pgid = null;
  try {
    comando = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ").slice(0, 80);
  } catch { /* el proceso murió entre el `ss` y esto, o no es nuestro */ }
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch { /* cwd ilegible: no se sabe de dónde sale, y eso NO es «ajeno» */ }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // El `comm` va entre paréntesis y puede llevar espacios: se corta por el
    // ÚLTIMO ')'. Tras él: state(3) ppid(4) pgrp(5).
    const tras = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const g = Number(tras[2]);
    if (Number.isInteger(g)) pgid = g;
  } catch { /* idem */ }
  return { comando, cwd, pgid };
}
