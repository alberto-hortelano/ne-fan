/** Cuando el socket falla, el título DEJA DE AFIRMAR que su lista está al día.
 *
 *  Escrito con la PR 6 de #346, la que cierra el programa: la caja de avisos
 *  (`#ts-error`) sale de `ui/title-screen.ts` a `ui/titulo/avisos.ts`.
 *
 *  POR QUÉ ESTE Y NO OTRO. De las cinco puertas de esa caja, cuatro las
 *  ejercen ya la batería (`avisar` y `repintar` en el 69 y el 70, `retirar` en
 *  el 78, `mostrarAccion` en el 52). La quinta —`caducarEstadoDeSaves`, la
 *  media línea que se cuela dentro de `avisar`— no la pisaba NADIE, y es
 *  justamente la que este corte convirtió en una costura ENTRE DOS MÓDULOS:
 *
 *    · `ui/titulo/home.ts` ESCRIBE «Bridge OK — N partidas guardadas» en
 *      `#ts-status` (salió en la PR 4),
 *    · `ui/titulo/avisos.ts` LO LEE por su prefijo para saber si esa frase
 *      todavía es cierta (sale en esta PR).
 *
 *  Antes eran dos métodos de la misma clase; hoy son dos ficheros unidos por
 *  un prefijo de cadena y un id, o sea por nada que compile. Si alguien
 *  reescribe el rótulo del home —«Bridge conectado — 3 partidas»— el título se
 *  queda diciendo que la lista está al día DESPUÉS de que el socket se caiga,
 *  el `tsc` sale verde, `npm test` sale verde y ningún guion se entera. Esto
 *  es lo que se entera.
 *
 *  LO QUE AFIRMA, y las dos mitades hacen falta:
 *
 *   1 · Un aviso que NO es del socket (el chunk del renderer que no llega) no
 *       toca la frase: la lista sigue siendo la que trajo el bridge y decir lo
 *       contrario sería un aviso falso. Es la guarda `source === "bridge"`,
 *       que un refactor descuidado se lleva por delante sin que nada chille.
 *   2 · Un aviso del SOCKET sí: la frase pasa a «Esta lista es de antes del
 *       fallo: puede que ya no esté al día.» en gris, y las tarjetas SE
 *       QUEDAN — siguen sirviendo para reanudar, que es la mitad de la
 *       decisión y la que distingue esto de vaciar la lista.
 *
 *  CÓMO SE PROVOCA EL FALLO DEL SOCKET, sin tocar ningún proceso: por el
 *  socket YA ABIERTO se le entrega al cliente una trama que no es JSON. Es el
 *  mismo camino que el bloque 4 del guion 70 (ahí para el aviso, aquí para lo
 *  que el aviso le hace a la lista) y la misma técnica de entrega que el 38 y
 *  el 100: el frame viaja por `sock.onmessage`, que es por donde viajan todos.
 *  No es estado sintético — es exactamente lo que pasa cuando el bridge se
 *  reinicia a media trama.
 *
 *  LO QUE ESTE GUION NO ES EL PRIMERO EN VER, dicho para que nadie lo cuente
 *  de más: si la divergencia se inyecta por el lado del ESCRITOR (renombrar el
 *  rótulo en `home.ts`), quien salta primero es el helper compartido
 *  `esperarListaDeSaves`, que casa ese mismo prefijo y expira antes de llegar
 *  aquí. Esa red ya existía y no es de este guion. La que sí es suya es la del
 *  lado del LECTOR —cambiar el prefijo en `avisos.ts`—, que ningún otro guion
 *  ve y que deja el bloque 1 en verde y el 2 en rojo (medido).
 *
 *  Cero créditos: motor falso; se juega una partida para tener tarjetas que
 *  mirar y no se le pide nada más a nadie.
 */
export const aisla = ["saves"];

import { clonarSaves } from "../lib/saves.mjs";
import {
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
  nuevaPartida,
  recargarAlTitulo,
} from "../lib/sesion.mjs";

const CADUCADO = "Esta lista es de antes del fallo: puede que ya no esté al día.";
const AVISO_SOCKET = "La partida respondió algo que no se entiende";
const AVISO_RENDER = "No se puede dibujar el mundo";

/** Lo que el jugador tiene delante: la frase de estado, su color y las
 *  tarjetas que puede pulsar. */
function foto() {
  const el = document.getElementById("ts-status");
  const filas = [...document.querySelectorAll(".ts-save")];
  return {
    status: el?.textContent ?? "",
    color: el ? getComputedStyle(el).color : "",
    tarjetas: filas.length,
    reanudables: filas.filter((f) => f.querySelector('[data-action="resume"]')).length,
    avisos: [...document.querySelectorAll("#ts-error [data-aviso]")].map((e) =>
      e.getAttribute("data-aviso"),
    ),
  };
}

/** Espera a que el título enseñe ese aviso. Por ESTADO, como el 70. */
function esperarAviso(ctx, titulo, maxMs = 25_000) {
  return ctx.waitFor(
    `el título enseña el aviso «${titulo}»`,
    (t) =>
      [...document.querySelectorAll("#ts-error [data-aviso]")].some(
        (e) => e.getAttribute("data-aviso") === t,
      )
        ? { visto: true }
        : null,
    maxMs,
    titulo,
  );
}

export default async function (ctx) {
  // ─── siembra: tarjetas de verdad que mirar ────────────────────────────
  await esperarTituloListo(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  const jugada = await comenzar(ctx);
  clonarSaves(jugada.sessionId, 2);

  // El gateway que la PÁGINA usa (con `?offset=` no es el del snapshot), y la
  // ruta del chunk RETENIDA: el guion decide cuándo falla el renderer, así que
  // el bloque 1 mide con el home ya pintado y no contra una carrera.
  const gateway = await ctx.page.evaluate(() => window.__nefan.servicios()["game-gateway"]);
  let inyectar = null;
  await ctx.page.routeWebSocket(gateway, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    // El socket queda a mano para entregarle al cliente una trama rota cuando
    // toque, sin cortar el de verdad: todo lo demás sigue pasando.
    inyectar = () => ws.send("}{ esto no es json");
  });
  let soltarElChunk;
  const chunkRetenido = new Promise((r) => {
    soltarElChunk = r;
  });
  await ctx.page.route("**/fps-gl*", async (route) => {
    await chunkRetenido;
    await route.abort("failed");
  });

  await recargarAlTitulo(ctx);
  await esperarListaDeSaves(ctx);
  const antes = await ctx.page.evaluate(foto);
  ctx.log(`al entrar: ${JSON.stringify(antes)}`);

  // NO CONCLUYENTE ANTES QUE VERDE: sin la frase de «Bridge OK» y sin
  // tarjetas, los dos bloques de abajo saldrían verdes sin medir nada — el
  // primero porque no hay frase que conservar y el segundo porque
  // `caducarEstadoDeSaves` se va por su guarda antes de tocar nada.
  ctx.expect(
    "el título AFIRMA que su lista está al día, y hay tarjetas que mirar",
    /^Bridge OK/.test(antes.status) && antes.tarjetas >= 3 && antes.reanudables >= 3,
    JSON.stringify(antes),
  );
  ctx.expect(
    "…y no hay ningún aviso puesto todavía",
    antes.avisos.length === 0,
    JSON.stringify(antes.avisos),
  );

  // ─── 1 · un aviso que NO es del socket no toca la frase ───────────────
  soltarElChunk();
  await esperarAviso(ctx, AVISO_RENDER);
  const conRender = await ctx.page.evaluate(foto);
  ctx.log(`con el aviso del renderer: ${JSON.stringify(conRender)}`);
  ctx.expect(
    "un fallo del RENDERER no le quita la palabra al bridge: la lista sigue diciendo que está al día",
    conRender.status === antes.status,
    `"${antes.status}" → "${conRender.status}"`,
  );
  ctx.expect(
    "…y el aviso sí se lee (si no, arriba no habría pasado nada que pudiera tocarla)",
    conRender.avisos.includes(AVISO_RENDER),
    JSON.stringify(conRender.avisos),
  );
  await ctx.shot("qa-101-el-fallo-del-renderer-no-caduca-la-lista");

  // ─── 2 · un aviso del SOCKET sí, y las tarjetas se quedan ─────────────
  ctx.expect(
    "el socket de la página está interceptado (sin esto no hay trama que entregar)",
    typeof inyectar === "function",
    String(inyectar),
  );
  inyectar();
  // SE ESPERA A LA FRASE, no al aviso, y está medido por qué: el aviso del
  // socket es el único de los cuatro que se RETIRA solo — cualquier trama
  // buena posterior llama a `errors.resuelto("bridge")` desde `dispatch`— así
  // que esperarlo sería una carrera contra el siguiente mensaje del bridge. La
  // frase, en cambio, se queda hasta el siguiente pintado del home, y llegar a
  // ella PRUEBA que el aviso pasó por aquí: nadie más escribe ese texto.
  const despues = await ctx.waitFor(
    "el título deja de afirmar que la lista está al día",
    ({ caducado, tituloDelAviso }) => {
      const el = document.getElementById("ts-status");
      const t = el?.textContent ?? "";
      return t === caducado
        ? {
            status: t,
            color: getComputedStyle(el).color,
            tarjetas: document.querySelectorAll(".ts-save").length,
            reanudables: document.querySelectorAll('.ts-save [data-action="resume"]').length,
            avisoTodaviaEnPantalla: [...document.querySelectorAll("#ts-error [data-aviso]")].some(
              (e) => e.getAttribute("data-aviso") === tituloDelAviso,
            ),
          }
        : null;
    },
    20_000,
    { caducado: CADUCADO, tituloDelAviso: AVISO_SOCKET },
  );
  ctx.log(`tras la trama rota: ${JSON.stringify(despues)}`);
  ctx.expect(
    "con el socket roto la lista deja de decir «Bridge OK» y dice de cuándo es",
    despues.status === CADUCADO,
    despues.status,
  );
  ctx.expect(
    "…y CAMBIA de color al decirlo: el gris de «esto ya no es de ahora», no el de la lista viva",
    despues.color === "rgb(136, 136, 136)" && antes.color !== despues.color,
    `${antes.color} → ${despues.color}`,
  );
  // LA OTRA MITAD DE LA DECISIÓN: la frase caduca, las tarjetas NO. Vaciar la
  // lista dejaría al jugador sin la única salida que le queda —reanudar lo que
  // ya tiene— por un fallo que puede durar cinco segundos.
  ctx.expect(
    "…y las tarjetas se quedan: siguen estando todas y siguen ofreciendo Reanudar",
    despues.tarjetas === antes.tarjetas && despues.reanudables === antes.reanudables,
    `${antes.tarjetas}/${antes.reanudables} → ${despues.tarjetas}/${despues.reanudables}`,
  );
  await ctx.shot("qa-101-la-lista-dice-de-cuando-es");
}
