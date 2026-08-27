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

/** ¿Hay alguien escuchando? Una conexión que abre y se cierra: no manda nada,
 *  así que vale igual para un WebSocket que para un HTTP. */
export function puertoOcupado(port, host = "127.0.0.1") {
  return new Promise((res) => {
    const s = net.connect({ port, host });
    const fin = (v) => {
      s.destroy();
      res(v);
    };
    s.once("connect", () => fin(true));
    s.once("error", () => fin(false));
    setTimeout(() => fin(false), 500);
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
