/** El título NO se calla medio minuto mientras espera la lista de partidas.
 *
 *  #425. El home pide `list_sessions` al bridge y escribe «Cargando saves desde
 *  el bridge...» mientras espera. Esa `request` tiene 30 s de timeout
 *  (`net/bridge-client.ts`), así que con el socket ABIERTO y el bridge mudo el
 *  jugador se quedaba medio minuto delante del MISMO texto. Medio minuto de
 *  texto fijo es indistinguible de un cuelgue: no hay forma de saber si queda un
 *  segundo o si no va a volver nunca.
 *
 *  EL REPRO DEL ISSUE NO VALÍA, y por eso este guion no lo usa. Decía
 *  «`./start.sh --preset html-fixtures` y cronometra»: sin bridge el título NO
 *  SE PINTA —`bootstrap` sale por su `catch` y `runTitleFlow()` no llega a
 *  llamarse (`main.ts`)— y, aunque se pintara, `request()` rechaza al instante
 *  con «Bridge not connected» porque no hay socket. Los 30 s mudos son del
 *  bridge que SÍ está y no contesta: el servidor vivo pero atascado, `saves/` en
 *  un volumen que no responde, una generación comiéndose el proceso. Eso es lo
 *  que se monta aquí, tragándose por el socket YA ABIERTO la respuesta a
 *  `list_sessions` y SOLO esa (misma técnica que el bloque 2 del guion 70).
 *
 *  LAS TRES MITADES, y las tres hacen falta:
 *
 *   **A · el caso feliz sigue callado.** Con el bridge contestando, el hueco NO
 *   dice nada de esperas: pasa de «Cargando saves…» a «Bridge OK — N partidas»
 *   y ya. Sin esto, un contador que hablara siempre sería ruido en la pantalla
 *   que ve todo el mundo al abrir el juego, y este guion saldría verde igual.
 *
 *   **B · con el bridge mudo, habla, y habla PRONTO.** Antes de que se cumpla
 *   un tercio del timeout el hueco dice cuánto lleva esperando, y la cifra
 *   CRECE: lo que convierte una pantalla congelada en una pantalla viva no es
 *   una frase más, es que el número se mueva. Se afirma además que el sello
 *   `data-lista` sigue en «pidiendo» —la petición no ha terminado, y el sello no
 *   puede mentir para que la frase quede bonita— y que «Nueva partida» sigue
 *   pulsable, que es la salida que le queda al jugador.
 *
 *   **C · el desenlace se lee igual.** Cuando la petición por fin expira, el
 *   hueco dice lo que pasó y el contador no sobrevive: si el último latido
 *   pisara el resultado, el título acabaría contando segundos de una espera que
 *   ya terminó.
 *
 *  EN NEGATIVO (probado al escribirlo, la sonda revertida — ver el informe):
 *  dejando `contarLaEspera` sin efecto en `ui/titulo/home.ts`, el bloque B sale
 *  rojo entero —los tres asertos, con el último valor sondeado «Cargando saves
 *  desde el bridge...» tras 66 sondeos en 10 s— mientras A y C siguen verdes,
 *  que es lo que dice que cada bloque mide lo suyo.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, y aquí ni siquiera se abre partida.
 */
export const sinMotor =
  "mira solo el título con la respuesta del bridge a `list_sessions` retenida; no abre partida " +
  "ni le pide nada al motor";

import { esperarListaDeSaves, esperarTituloListo } from "../lib/sesion.mjs";

export const aisla = ["saves"];

const CARGANDO = "Cargando saves desde el bridge...";

/** Lo que el jugador tiene delante del hueco de estado. */
const fotoDelEstado = () => {
  const el = document.getElementById("ts-status");
  const btn = document.getElementById("ts-new");
  return {
    texto: el?.textContent?.trim() ?? "",
    sello: el?.dataset.lista ?? "",
    nuevaPartida: Boolean(btn) && btn.disabled === false,
  };
};

/** Los segundos que anuncia la frase de espera, o `null` si no es esa frase. */
const segundosDe = (texto) => {
  const m = /todavía no ha contestado \((\d+) s\)/.exec(texto);
  return m ? Number(m[1]) : null;
};

export default async function (ctx) {
  // ─── A · CON EL BRIDGE CONTESTANDO, EL HUECO NO HABLA DE ESPERAS ────────
  //
  // Se apunta TODO lo que pasa por `#ts-status` desde antes de que la app
  // cargue: mirar al final no valdría, porque la frase de espera —si saliera—
  // se la habría llevado el desenlace.
  await ctx.page.addInitScript(() => {
    window.__qa121 = [];
    const obs = new MutationObserver(() => {
      const el = document.getElementById("ts-status");
      const t = el?.textContent?.trim() ?? "";
      if (t && window.__qa121.at(-1) !== t) window.__qa121.push(t);
    });
    obs.observe(document, { childList: true, subtree: true, characterData: true });
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const dichoEnElCasoFeliz = await ctx.page.evaluate(() => window.__qa121);
  ctx.log(`caso feliz · el hueco dijo: ${JSON.stringify(dichoEnElCasoFeliz)}`);
  ctx.expect(
    "PRECONDICIÓN — el hueco de estado se usa de verdad (si no, A saldría verde vacío)",
    dichoEnElCasoFeliz.some((t) => t.startsWith("Cargando")) &&
      dichoEnElCasoFeliz.some((t) => t.startsWith("Bridge OK")),
    JSON.stringify(dichoEnElCasoFeliz),
  );
  ctx.expect(
    "con el bridge contestando, el título NO cuenta segundos de espera: no hay nada que contar",
    dichoEnElCasoFeliz.every((t) => segundosDe(t) === null),
    JSON.stringify(dichoEnElCasoFeliz),
  );

  // ─── B · CON EL BRIDGE MUDO, HABLA, Y LA CIFRA CRECE ────────────────────
  //
  // Se le quita al bridge la respuesta a `list_sessions` y SOLO esa: el socket
  // sigue abierto y todo lo demás pasa. Es lo que le pasa al jugador cuyo
  // servidor está vivo pero atascado.
  const gateway = await ctx.page.evaluate(() => window.__nefan.servicios()["game-gateway"]);
  await ctx.page.routeWebSocket(gateway, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      let tipo = "";
      try {
        tipo = JSON.parse(String(m)).type ?? "";
      } catch {
        tipo = "";
      }
      if (tipo === "list_sessions") return; // se traga SOLO esa
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);

  // 10 s de cortafuegos sobre un timeout de 30: si la frase tardara más que un
  // tercio del plazo, el silencio que abre el issue seguiría ahí en su parte
  // más cara. `expectEspera` y no `waitFor` (#261): el hecho de que el título
  // hable ES el aserto, con su último valor sondeado si no ocurre.
  const primera = await ctx.expectEspera(
    "con el bridge mudo, el título dice que sigue esperando ANTES de que expire la petición",
    true,
    () => {
      const el = document.getElementById("ts-status");
      const t = el?.textContent?.trim() ?? "";
      return /todavía no ha contestado \(\d+ s\)/.test(t) ? t : null;
    },
    { ms: 10_000 },
  );
  const texto1 = typeof primera.ultimo === "string" ? primera.ultimo : "";
  ctx.log(`bridge mudo · primera frase: "${texto1}"`);
  await ctx.shot("espera-de-la-lista-contada");

  const enEspera = await ctx.page.evaluate(fotoDelEstado);
  ctx.expect(
    "…y el sello NO miente por quedar bien: la petición sigue en «pidiendo»",
    enEspera.sello === "pidiendo",
    `data-lista="${enEspera.sello}" · texto "${enEspera.texto}"`,
  );
  ctx.expect(
    "…y le deja al jugador la salida que tiene: «Nueva partida» sigue pulsable",
    enEspera.nuevaPartida === true,
    JSON.stringify(enEspera),
  );
  ctx.expect(
    "…y el texto de espera SUSTITUYE al fijo, no se apila debajo",
    enEspera.texto !== CARGANDO && !enEspera.texto.includes(CARGANDO),
    `"${enEspera.texto}"`,
  );

  // LA AFIRMACIÓN QUE IMPORTA: la cifra se MUEVE. Una frase fija que dijera
  // «todavía no ha contestado» es otro texto congelado, y el jugador no puede
  // distinguirlo de un cuelgue — que es exactamente el issue con una frase más.
  const crecido = await ctx.expectEspera(
    "…y la cifra CRECE: la pantalla se ve viva, no congelada con otra frase",
    true,
    ([antes]) => {
      const t = document.getElementById("ts-status")?.textContent?.trim() ?? "";
      const m = /todavía no ha contestado \((\d+) s\)/.exec(t);
      return m && Number(m[1]) > antes ? t : null;
    },
    { ms: 12_000, arg: [segundosDe(texto1) ?? 0] },
  );
  ctx.log(`bridge mudo · después: "${crecido.ultimo}"`);

  // ─── C · EL DESENLACE SE LEE IGUAL ─────────────────────────────────────
  // El request expira a los 30 s: la espera es por SELLO y el maxMs es el
  // cortafuegos. Lo que se afirma es que el contador no sobrevive al resultado.
  const final = await ctx.expectEspera(
    "cuando la petición expira, el título dice qué pasó con las partidas",
    true,
    () => {
      const el = document.getElementById("ts-status");
      if (el?.dataset.lista !== "error") return null;
      return el.textContent?.trim() || "(sellado y vacío)";
    },
    { ms: 60_000 },
  );
  const texto3 = typeof final.ultimo === "string" ? final.ultimo : "";
  ctx.log(`desenlace · "${texto3}"`);
  ctx.expect(
    "…y el contador no sobrevive al desenlace: se lee el motivo, no los segundos",
    /No se pudieron cargar las partidas guardadas/.test(texto3) && segundosDe(texto3) === null,
    `"${texto3}"`,
  );
  await ctx.shot("espera-de-la-lista-desenlace");
}
