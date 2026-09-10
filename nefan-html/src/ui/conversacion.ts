/** LA CONVERSACIÓN: abrir y cerrar el diálogo con un personaje, con lo que va
 *  pegado a cada mitad —soltar el ratón al abrir y devolverlo al cerrar— y la
 *  elección del jugador camino del motor.
 *
 *  Es presentación y nada más: quién habla lo decide el bridge
 *  (`speaker-resolve`), qué provoca la elección lo decide el motor, y aquí
 *  solo se pinta la línea, se recogen la opción o el texto libre y se mandan
 *  tal cual. El dueño único del panel es este módulo: el resto del cliente
 *  PREGUNTA si hay conversación (`abierta()`) en vez de guardar una copia. */

import type { ClientSession } from "@nefan-core/src/session/session-facets.js";
import type { NarrativeClient } from "../net/narrative-client.js";
import { paso } from "./async-ui.js";
import { DialoguePanel, type DialogueSpeaker } from "./dialogue-panel.js";

export interface DepsDeConversacion {
  /** El lienzo del mundo: a él se le pide de vuelta el pointer lock al cerrar. */
  lienzo(): HTMLElement;
  /** Sin partida no hay motor al que mandar la elección. */
  session: Pick<ClientSession, "active">;
  /** La elección, camino del bridge. */
  enviarEleccion: NarrativeClient["sendDialogueChoice"];
}

export interface Conversacion {
  /** El panel, para quien necesita más que abrir, cerrar o preguntar: el
   *  seam del banco (elegir, avanzar, leer la línea visible) y el retrato
   *  (`setPortrait`). */
  readonly panel: DialoguePanel;
  /** Pinta la línea del hablante con sus opciones y suelta el ratón. */
  abrir(speaker: string, text: string, choices: string[], who?: DialogueSpeaker): void;
  /** El panel fuera y el ratón devuelto si lo teníamos. Idempotente. */
  cerrar(): void;
  /** ¿Hay una conversación en pantalla ahora mismo? Derivado del panel, que
   *  es la única representación (#314). */
  abierta(): boolean;
}

/** ABRIR Y CERRAR UN DIÁLOGO SON DOS COSAS QUE TIENEN QUE IR JUNTAS (#311).
 *
 *  «Hay una conversación abierta» vivía en dos sitios que nadie obligaba a
 *  coincidir: el panel y el gate del input —un campo público del proveedor que
 *  suprimía moverse y atacar—. Estaban emparejados A MANO en cinco sitios, y
 *  bastaba apagar uno sin su `hide()` —o al revés— para dejar al jugador con
 *  el panel puesto y el mundo respondiendo, o con el panel fuera y los
 *  controles muertos. Eso compilaba, pasaba lint y pasaba la batería.
 *
 *  #311 le puso un dueño único, que son `abrir` y `cerrar`. #314 se llevó el
 *  espejo entero: el proveedor PREGUNTA por `abierta()` en vez de guardar una
 *  copia, así que ya no hay par que desemparejar — queda UNA representación
 *  (el panel) y su reflejo en el DOM, que #314 no funde a propósito. Las dos
 *  funciones siguen existiendo porque abrir y cerrar tienen más partes que el
 *  panel (el ratón, que el panel suelta y no devuelve), y el sink de la faceta
 *  `dialogo` va ENCIMA y cubre otra cosa: que volver al título lo deshaga
 *  aunque nadie se acuerde. */
export function crearConversacion(deps: DepsDeConversacion): Conversacion {
  const panel = new DialoguePanel();

  /** ¿Tenía el jugador el ratón capturado cuando se abrió la conversación? Lo
   *  apunta `abrir` porque el panel lo suelta por dentro. */
  let ratonCapturadoAntesDelDialogo = false;

  function abrir(speaker: string, text: string, choices: string[], who?: DialogueSpeaker): void {
    // El panel SUELTA el ratón al abrirse (dialogue-panel.ts: sin cursor no se
    // pueden clicar las opciones). Hay que apuntar si lo teníamos, porque
    // devolverlo al cerrar es cosa nuestra y hasta el 2026-08-29 no lo hacía
    // nadie — ver `cerrar`.
    //
    // SE APUNTA EN LA TRANSICIÓN cerrado→abierto, NO EN CADA LÍNEA (#502). El
    // motor puede mandar dos `dialogue` en una sola respuesta (son entradas de
    // `consequences[]`, y el cliente las abre una detrás de otra), o programar
    // una línea con la conversación ya en pantalla. La segunda `abrir()`
    // encontraba el lock YA SOLTADO por la primera —`pointerLockElement` se
    // vacía síncrono tras `exitPointerLock()`— y pisaba el apunte con `false`,
    // así que al cerrar el ratón no volvía y el jugador se quedaba pegándole a
    // un enemigo sin hacer daño, que es exactamente el caso de #323.
    if (!panel.isVisible) {
      ratonCapturadoAntesDelDialogo = document.pointerLockElement !== null;
    }
    // Y con el panel en pantalla, el input de juego queda suprimido solo: el
    // proveedor PREGUNTA por `abierta()`, que es este mismo panel (#314).
    // Aquí había un flag del proveedor que había que levantar a mano junto al
    // `show()`, y apagar a mano junto al `hide()` de `cerrar`.
    panel.show(speaker, text, choices, who);
  }

  /** Cierra el diálogo: el panel fuera y el input devuelto al jugador.
   *
   *  Idempotente a propósito — el panel se cierra a sí mismo antes de invocar
   *  sus callbacks (`chooseByIndex`, `advance`), así que este `hide()` suele ser
   *  el segundo, y `hide()` solo asigna. Poder llamarlo de más es lo que permite
   *  que el sink de la faceta lo use sin saber si había algo abierto. */
  function cerrar(): void {
    panel.hide();
    devolverElRatonTrasElDialogo();
  }

  /** DEVOLVER EL RATÓN AL CERRAR ES PARTE DE CERRAR (#323).
   *
   *  El panel suelta el pointer lock al abrirse y hasta hoy no lo recuperaba
   *  nadie. Con NPCs pacíficos eso solo era un click de más; con enemigos es una
   *  ejecución: atacar con LMB exige el lock
   *  (`keyboard-input-provider.ts`: «e.button === 0 && document.pointerLockElement
   *  !== null»), así que tras hablar el jugador se quedaba pegando a un enemigo a
   *  1,5 m SIN HACER DAÑO y sin que nada se lo dijera. Medido por QA: 50 s a cero
   *  de daño y muerto; recapturando el ratón a mano, el mismo enemigo cayó en 3 s.
   *
   *  Va emparejado con `abrir` y por el mismo motivo que #311: soltar y
   *  devolver son las dos mitades de un acto, y separarlas deja al jugador con
   *  los controles a medias sin que nada falle.
   *
   *  Solo se devuelve si lo teníamos: quien estaba en modo cursor (mirando
   *  fixtures, con el título recién cerrado) no quiere que una conversación le
   *  capture el ratón por su cuenta. Y el navegador puede NEGARSE (pide gesto
   *  del usuario, y rechaza un lock pedido demasiado pronto tras soltarlo): por
   *  eso va por `paso()`, que lo deja escrito en el registro de errores en vez
   *  de tragárselo. El click sobre el mundo sigue siendo la vía de recuperación. */
  function devolverElRatonTrasElDialogo(): void {
    if (!ratonCapturadoAntesDelDialogo) return;
    ratonCapturadoAntesDelDialogo = false;
    if (document.pointerLockElement !== null) return;
    paso(
      deps.lienzo().requestPointerLock(),
      "input",
      "no se pudo devolver el ratón al cerrar la conversación: haz click en el mundo para volver a atacar",
    );
  }

  panel.onAdvanced = () => {
    cerrar();
  };

  panel.onChoice = (idx, text) => {
    cerrar();
    if (!deps.session.active) return;
    const cur = panel.current();
    deps.enviarEleccion({
      eventId: `client_${Date.now()}`,  // bridge generates the canonical id
      choiceIndex: idx,
      speaker: cur.speaker,
      speakerId: cur.speakerId,
      chosenText: text,
    });
  };

  panel.onFreeText = (freeText) => {
    cerrar();
    if (!deps.session.active) return;
    const cur = panel.current();
    deps.enviarEleccion({
      eventId: `client_${Date.now()}`,
      choiceIndex: -1,
      speaker: cur.speaker,
      speakerId: cur.speakerId,
      chosenText: freeText,
      freeText,
    });
  };

  return {
    panel,
    abrir,
    cerrar,
    abierta: () => panel.isVisible,
  };
}
