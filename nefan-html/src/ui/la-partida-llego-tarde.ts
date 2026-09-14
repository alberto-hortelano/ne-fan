/** LA PARTIDA QUE LLEGA TARDE (#478): el servidor de la partida aparece
 *  DESPUÉS de que el arranque se rindiera, y el juego lo OFRECE.
 *
 *  Lo que pasaba hasta el 2026-09-14: arrancabas sin bridge, veías el muro
 *  «Sin conexión con la partida», levantabas el bridge, y el muro se retiraba
 *  solo —`bridge-client` llama `errors.resuelto("bridge")` al abrir el socket
 *  y el muro del aviso se va con su causa—. Detrás no quedaba el juego sino el
 *  VISOR de fixtures, porque `bootstrap()` ya había retornado y al bucle del
 *  título solo se entra por su camino de éxito o por «Volver al título», que en
 *  ese muro está oculto (el aviso lo pinta con la salida `cerrar`). Y el chip
 *  decía «Disconnected» con el socket abierto, porque las suscripciones que lo
 *  corrigen viven en la rama de éxito y el cliente visor no emite nada. Dos
 *  mentiras y una sola salida: recargar.
 *
 *  De las tres opciones que se pusieron sobre la mesa, el usuario eligió la
 *  (b): que te lo OFREZCA. No se rearranca nada solo —la (a), descartada—:
 *  aparece un botón, y lo pulsa quien juega.
 *
 *  Los DOS TEXTOS viven aquí y no en `main.ts`, que es la regla de #469: la
 *  causa entra al canal desde quien la conoce, y quien sabe que el servidor de
 *  la partida acaba de contestar es este módulo. `main.ts` no decide ni una
 *  palabra de lo que se lee en pantalla.
 *
 *  Se ata SOLO desde el `catch` del arranque, o sea solo en el estado que
 *  existe para arreglarse: con partida en marcha esto no está atado a nada, y
 *  una caída y vuelta del socket no puede pintarle un muro encima al jugador. */

import type { BridgeClient } from "../net/bridge-client.js";
import type { MuroDeCarga } from "./muro-de-carga.js";

/** El titular de la oferta. Dice lo que ES —la partida está disponible—, no lo
 *  que falló: el fallo ya lo leyó el jugador en el muro anterior. */
const TITULO_DE_LA_OFERTA = "La partida ya está disponible";
/** Y el cuerpo, en el idioma del jugador: ni `bridge`, ni `ws://`, ni ms. Dice
 *  las dos cosas que hacen falta para decidir — que el servidor contestó, y que
 *  entrar no cuesta recargar. */
const DETALLE_DE_LA_OFERTA =
  "El servidor de la partida ha respondido. Puedes entrar al juego sin recargar la página.";

export interface DepsDeLaOferta {
  /** El socket que puede llegar tarde. Se escucha en los dos sentidos: la
   *  oferta solo vale mientras sea cierta, y `isConnected` es a quien se le
   *  pregunta la verdad cuando hemos dejado de escuchar. */
  bridge: Pick<BridgeClient, "on" | "off" | "isConnected">;
  /** El único pintor del muro. */
  muro: Pick<MuroDeCarga, "ofrecer" | "ocultar">;
  /** El chip de conexión, que en este estado no lo escribe nadie más: el
   *  cliente visor no emite `connected` ni `disconnected` (su `on()` es un
   *  no-op), así que sin esto se queda en «Disconnected» con el socket
   *  abierto. El literal lo pone quien lo pinta; aquí solo se dice el HECHO. */
  chip(conectado: boolean): void;
  /** Entrar al juego por el título, con el socket ya abierto y sin recargar
   *  (`entrarPorElTitulo` en `main.ts`): el camino de ÉXITO del arranque,
   *  extraído para poder recorrerlo DOS veces. Hasta #478 solo se llegaba a él
   *  por el arranque, y por eso el bridge que llegaba tarde no tenía adónde
   *  llevar: el título no se pinta desde ningún sitio que no sea eso o
   *  `volverAlTitulo()`. `createGameClient` resuelve AL INSTANTE con el socket
   *  ya abierto, así que la segunda vuelta no espera nada; si el socket se fue
   *  entre medias, rechaza por su timeout con el aviso de siempre.
   *
   *  QUÉ PASA CON LA FIXTURE QUE SE ESTUVIERA MIRANDO: se queda, y no es un
   *  olvido. Aquí no se llama a `session.leave()` porque en este estado NUNCA
   *  hubo partida: las facetas ya están en su neutro y `porValor`
   *  (`session-facets.ts`) se salta el vaciado del mundo por diseño, así que
   *  llamarlo sería un no-op disfrazado de limpieza. El pueblo de la fixture se
   *  queda detrás del título, que lo tapa entero, y se va cuando
   *  `session.enter()` vea cambiar el id de sesión — o sea, en el instante en
   *  que empieza la partida de verdad, antes de que llegue su primer tile. Es
   *  exactamente el estado que ya tiene quien mira fixtures con el bridge
   *  arriba (guion 25). */
  entrar(): Promise<void>;
}

export function atarLaOfertaDeEntrar(deps: DepsDeLaOferta): void {
  /** ¿Está la oferta puesta en el muro? Solo para no ocultar un muro que no es
   *  nuestro cuando el socket se cae. Si el jugador ya la cerró, `ocultar()`
   *  no hace nada y tampoco pasa nada. */
  let ofertaEnPantalla = false;

  const alConectar = (): void => {
    deps.chip(true);
    ofertaEnPantalla = true;
    deps.muro.ofrecer(TITULO_DE_LA_OFERTA, DETALLE_DE_LA_OFERTA, tomarLaOferta);
  };

  const alDesconectar = (): void => {
    deps.chip(false);
    // Y la oferta se RETIRA, porque ha dejado de ser cierta: un muro que dice
    // «ya está disponible» sobre un socket caído es la misma pantalla que
    // miente que este módulo viene a apagar.
    if (!ofertaEnPantalla) return;
    ofertaEnPantalla = false;
    deps.muro.ocultar();
  };

  function armar(): void {
    deps.bridge.on("connected", alConectar);
    deps.bridge.on("disconnected", alDesconectar);
  }

  function soltar(): void {
    deps.bridge.off("connected", alConectar);
    deps.bridge.off("disconnected", alDesconectar);
  }

  /** Aceptar la oferta. Los oyentes se sueltan ANTES de entrar y no después:
   *  `entrar()` no resuelve hasta que arranca una partida —el título es un
   *  bucle—, y un socket que parpadee mientras el jugador elige mundo pintaría
   *  la oferta detrás del título, para que le saltara a la cara al cerrarlo.
   *  Desde aquí el chip es del `GameClient` de verdad, que sí emite.
   *
   *  Si entrar FALLA (el socket se fue entre el clic y la petición), la oferta
   *  vuelve a armarse: quedarse sin ella sería devolver al jugador al callejón
   *  del que acaba de salir. */
  async function tomarLaOferta(): Promise<void> {
    ofertaEnPantalla = false;
    soltar();
    try {
      await deps.entrar();
    } catch (err) {
      // No entró. Mientras estábamos sordos el socket ha podido caerse —que es
      // la razón más probable de acabar aquí—, así que el chip se resincroniza
      // con el cable de verdad antes de volver a escuchar: quedarse en «Bridge»
      // sobre un socket muerto es la mentira que este módulo apaga.
      deps.chip(deps.bridge.isConnected);
      armar();
      throw err;
    }
  }

  armar();
}
