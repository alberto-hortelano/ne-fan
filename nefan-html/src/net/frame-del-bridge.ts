/** EL FRAME que el transporte entrega al game loop: lo que dijo el último
 *  `state_update` del bridge, y cómo se juntan dos que llegan entre dos
 *  frames de pantalla. Vive aparte de `game-client.ts` para que el cliente del
 *  bridge quepa en su tope de líneas; `game-client.ts` lo re-exporta. */

import type { CombatEvent, Vec3 } from "@nefan-core/src/types.js";
import type { StateUpdateMessage } from "@nefan-core/src/protocol/messages.js";

export interface FrameResult {
  events: CombatEvent[];
  playerHp: number;
  /** Sobre cuánta vida, y con qué pega. Los dos los dice el bridge en cada
   *  `state_update` (#504): antes eran dos constantes de `main.ts` y el
   *  cliente decidía por su cuenta el máximo de la barra y el arma con la que
   *  se calcula el aro del telegraph. */
  playerMaxHp: number;
  playerWeaponId: string;
  enemies: {
    id: string;
    hp: number;
    state: string;
    alive: boolean;
    pos?: { x: number; y: number; z: number };
    forward?: { x: number; y: number; z: number };
    attackType?: string;
  }[];
  /** Vida ambiental de NPCs del bridge (state_update.npcs). */
  npcs?: StateUpdateMessage["npcs"];
  /** Dónde reaparece el jugador: SOLO en el frame que contesta a `respawn`
   *  (`StateUpdateMessage.reaparicion`). Lo decide el sim del bridge (#613);
   *  el game loop lo copia a la posición del jugador. */
  reaparicion?: Vec3;
}

/** Junta un frame recién llegado con el que nadie ha consumido aún: el estado
 *  (vida, enemigos, NPCs) es el del NUEVO, que describe el sim de ahora; los
 *  eventos son los de los DOS, en orden, porque cada uno pasó una sola vez; y
 *  el punto de reaparición sobrevive si lo traía cualquiera de los dos. Es
 *  transporte, no juego: decide qué frames se entregan, no qué significan. */
export function acumularFrame(
  pendiente: FrameResult | null,
  nuevo: FrameResult,
  reaparicion: Vec3 | undefined,
): FrameResult {
  const punto = reaparicion ?? pendiente?.reaparicion;
  const eventos = pendiente ? [...pendiente.events, ...nuevo.events] : nuevo.events;
  return punto ? { ...nuevo, events: eventos, reaparicion: punto } : { ...nuevo, events: eventos };
}
