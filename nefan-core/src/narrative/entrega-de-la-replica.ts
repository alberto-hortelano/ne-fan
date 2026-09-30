/** CÓMO SE ENTREGA la réplica del motor a un turno del jugador (tanda BW, H1).
 *
 *  Lo que salió jugando (playtest del 2026-09-30): el jugador elige una opción
 *  o escribe un texto libre, el panel se cierra, y el motor tarda de 5 a 100 s
 *  en contestar. Mientras tanto la partida sigue —el sim no se pausa, y está
 *  bien—: empieza una pelea, o el jugador se va de viaje. La réplica llegaba
 *  después y abría el panel MODAL igual, sin mirar nada: en combate soltaba el
 *  ratón y apagaba el ataque mientras el hostil seguía pegando (el jugador
 *  murió así), y tras un viaje de 4 h la posadera seguía la conversación en
 *  la otra punta del mapa.
 *
 *  La regla, en una frase: la réplica que llega cuando esa conversación YA NO
 *  ES LA ACTUAL no abre el panel; va al registro, entera y sin reescribir.
 *  «Ya no es la actual» se mira AL LLEGAR, en este orden:
 *
 *   1. el jugador se ha puesto a PELEAR: ha empezado algún ataque desde que
 *      pidió la réplica (`GameSimulation.ataquesDelJugador`, contado antes y
 *      después del `await`). Es lo que pasó jugando: Brasco bajó de 60 a 21
 *      antes de que llegara la réplica de Orio. NO se mira «algún hostil le
 *      tiene enganchado» (decisión del 2026-09-30, opción B): el enganche no
 *      se suelta hasta que el jugador muere, así que un hostil que te enganchó
 *      en otro tile mandaría al registro todas las réplicas, y en el banco el
 *      bandido engancha a 4,6 m del tabernero.
 *      HUECO CONOCIDO, y no se cierra aquí: si un hostil te pega y TÚ no has
 *      atacado, la réplica abre el panel igual. Cerrarlo pide rehacer el banco:
 *      21 guiones hablan hoy con el tabernero con el bandido enganchado;
 *   2. hay un VIAJE EN CURSO al llegar la réplica: el jugador pidió ir a otro
 *      sitio y el motor aún lo está generando (un job BLOQUEANTE en la cola de
 *      generación del bridge: salida de «Salidas», frontera confirmada). Es el
 *      orden más probable con un motor real (la réplica tarda segundos, el
 *      tile minutos) y lo cazó la QA de la tanda (guion 344): el tile y la
 *      posición son aún los de salida, así que sin esto la réplica abría el
 *      panel detrás del «Viajando…» y seguía abierta en el destino;
 *   3. el jugador ha DADO POR TERMINADA una conversación desde que pidió
 *      (botón «terminar» o Esc, tanda BX; contador del bridge, foto antes y
 *      después como los ataques). Global y no por hablante: quien acaba de
 *      decir «basta» a una conversación no quiere que la réplica que llega
 *      después le meta en otra. Con «elijo y espero» no puede pasar —sin
 *      panel abierto no hay botón—: solo si entretanto se abrió OTRA línea
 *      (un E a otro NPC, un diálogo del motor) y el jugador la cortó;
 *   4. el jugador está en OTRO TILE que cuando se pidió (`active_scene_id`);
 *   5. el hablante está más LEJOS que el alcance del nombre del HUD
 *      (`ALCANCE_DEL_NOMBRE_M`). Sin posición del hablante —el narrador, o un
 *      nombre sin entidad detrás— esta pregunta no se hace.
 *
 *  LO QUE NO TRATA, y por construcción: los diálogos que abre el motor por su
 *  cuenta (el despertar, un `map_trigger`, un evento programado) no pasan por
 *  aquí. Llegan, por naturaleza, DESPUÉS de un cambio de sitio, y degradarlos
 *  rompería el despertar. Solo el handler de la réplica (`bridge/handlers/
 *  dialogue.ts`, `reportAndDispatch`) llama a `entregarReplica`.
 *
 *  «El motor decide»: aquí no se cambia QUÉ dijo, solo CÓMO y CUÁNDO se ve.
 *  El texto viaja idéntico; las opciones no viajan porque sin panel no hay
 *  dónde elegirlas —la conversación se retoma hablándole otra vez—.
 *
 *  Módulo puro: el bridge le pasa la foto y él decide. */

import { ALCANCE_DEL_NOMBRE_M } from "../scene/aim.js";
import type { ConsequenceEffect } from "./types.js";

/** Por qué la réplica ya no era la conversación actual. */
export type MotivoDeDiferir = "combate" | "viaje" | "terminada" | "otro_tile" | "lejos";

/** El effect de una réplica que llegó tarde: lo que dijo el hablante, sin
 *  panel. Es un kind PROPIO y no un `show_dialogue` con una bandera a
 *  propósito: así es inexpresable que el cliente lo abra como modal. Vive aquí
 *  y no en `protocol/messages.ts` porque `protocol → narrative` es la
 *  dirección permitida; el wire lo importa (`EfectoEnElWire`). */
export interface ReplicaDiferidaEffect {
  kind: "replica_diferida";
  speaker: string;
  /** El texto del motor, IDÉNTICO al del `show_dialogue` del que sale. */
  text: string;
  /** La entidad que habla, si el bridge la resolvió. */
  speakerId?: string;
  motivo: MotivoDeDiferir;
  /** ¿Hay una pelea DE VERDAD al llegar (algún hostil vivo le tiene
   *  enganchado)? Solo elige la pista: un golpe al aire cuenta como «se puso
   *  a pelear» (motivo `combate`), pero sin nadie enfrente decirle «cuando
   *  acabe la pelea» le habla de una pelea que no existe. */
  hayPelea: boolean;
}

interface PuntoXZ {
  x: number;
  z: number;
}

/** La foto con la que se decide: dos momentos (al pedir y al llegar) y dónde
 *  está cada cuerpo AL LLEGAR. */
export interface ContextoDeLaReplica {
  escenaAlPedir: string | null;
  escenaAhora: string | null;
  /** ¿Ha empezado el jugador algún ataque entre el pedir y el llegar? */
  atacoDesdeQuePidio: boolean;
  /** ¿Hay un viaje pedido y todavía sin llegar? */
  viajeEnCurso: boolean;
  /** ¿Ha dado el jugador por terminada alguna conversación (botón o Esc)
   *  entre el pedir y el llegar? */
  terminoUnaConversacionDesdeQuePidio: boolean;
  /** ¿Algún hostil vivo le tiene enganchado al llegar? Solo elige la pista. */
  hayPelea: boolean;
  jugador: PuntoXZ;
}

export type Vigencia = { vigente: true } | { vigente: false; motivo: MotivoDeDiferir };

/** ¿Sigue siendo la conversación actual? Ver el orden en la cabecera. */
export function vigenciaDeLaReplica(ctx: ContextoDeLaReplica, hablante?: PuntoXZ): Vigencia {
  if (ctx.atacoDesdeQuePidio) return { vigente: false, motivo: "combate" };
  if (ctx.viajeEnCurso) return { vigente: false, motivo: "viaje" };
  if (ctx.terminoUnaConversacionDesdeQuePidio) return { vigente: false, motivo: "terminada" };
  if (ctx.escenaAlPedir !== ctx.escenaAhora) return { vigente: false, motivo: "otro_tile" };
  if (hablante && Math.hypot(hablante.x - ctx.jugador.x, hablante.z - ctx.jugador.z) > ALCANCE_DEL_NOMBRE_M) {
    return { vigente: false, motivo: "lejos" };
  }
  return { vigente: true };
}

/** Los effects de la réplica tal como se difunden: cada `show_dialogue` que
 *  ya no es vigente pasa a `replica_diferida`; todo lo demás (spawns, story,
 *  plugins) pasa intacto y en su orden. `posDe` dice dónde está AHORA una
 *  entidad por id (o `undefined` si no hay tal). */
export function entregarReplica(
  effects: readonly ConsequenceEffect[],
  ctx: ContextoDeLaReplica,
  posDe: (id: string) => PuntoXZ | undefined,
): Array<ConsequenceEffect | ReplicaDiferidaEffect> {
  return effects.map((e) => {
    if (e.kind !== "show_dialogue") return e;
    const v = vigenciaDeLaReplica(ctx, e.speakerId ? posDe(e.speakerId) : undefined);
    if (v.vigente) return e;
    return {
      kind: "replica_diferida",
      speaker: e.speaker,
      text: e.text,
      ...(e.speakerId ? { speakerId: e.speakerId } : {}),
      motivo: v.motivo,
      hayPelea: ctx.hayPelea,
    };
  });
}

/** La línea del registro con la que el cliente pinta una réplica diferida.
 *  Aquí y no en el cliente porque la pista depende del motivo, y esa es una
 *  decisión: si el jugador está peleando CON ALGUIEN, «vuelve a hablarle con
 *  E» le invita a soltar la pelea a medias; se dice «cuando acabe la pelea».
 *  Un golpe al aire sin nadie enganchado lleva la pista neutra. Sin
 *  entidad detrás no hay a quién volver a hablarle. */
export function lineaDeReplicaDiferida(r: ReplicaDiferidaEffect): string {
  const dicho = `💬 ${r.speaker}: «${r.text}»`;
  if (!r.speakerId) return dicho;
  if (r.motivo === "combate" && r.hayPelea) return `${dicho} (vuelve a hablarle cuando acabe la pelea)`;
  return `${dicho} (vuelve a hablarle con E)`;
}
