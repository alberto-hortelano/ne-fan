/** EL FRAME que el transporte entrega al game loop: lo que dijo el último
 *  `state_update` del bridge, y cómo se juntan dos que llegan entre dos
 *  frames de pantalla. Vive aparte de `game-client.ts` para que el cliente del
 *  bridge quepa en su tope de líneas; `game-client.ts` lo re-exporta. */

import type { CombatEvent, Vec3 } from "@nefan-core/src/types.js";
import type { StateUpdateMessage } from "@nefan-core/src/protocol/messages.js";
import type { GameStore } from "@nefan-core/src/store/game-store.js";

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
  /** Dónde despierta el jugador: SOLO en el frame que lo levanta
   *  (`StateUpdateMessage.reaparicion`). Lo decide el motor en partida (#613);
   *  el game loop lo copia a la posición del jugador. */
  reaparicion?: Vec3;
  /** Y hacia dónde mira al despertar (`StateUpdateMessage.miradaAlDespertar`). */
  miradaAlDespertar?: number;
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
  mirada?: number,
): FrameResult {
  const punto = reaparicion ?? pendiente?.reaparicion;
  const yaw = mirada ?? pendiente?.miradaAlDespertar;
  const eventos = pendiente ? [...pendiente.events, ...nuevo.events] : nuevo.events;
  return {
    ...nuevo,
    events: eventos,
    ...(punto ? { reaparicion: punto } : {}),
    ...(yaw !== undefined ? { miradaAlDespertar: yaw } : {}),
  };
}

/** Aplica el DESPERTAR de un frame (#613): copia el punto a la posición del
 *  jugador y, si viene, la mirada (QA S3 de BN). Devuelve si había despertar.
 *  Fuera del game loop para que se pruebe y no le sume ramas (CRAP del
 *  cliente). */
export function aplicarElDespertar(
  frame: Pick<FrameResult, "reaparicion" | "miradaAlDespertar">,
  pos: { x: number; z: number },
  ponYaw: (yaw: number) => void,
): boolean {
  if (!frame.reaparicion) return false;
  pos.x = frame.reaparicion.x;
  pos.z = frame.reaparicion.z;
  if (frame.miradaAlDespertar !== undefined) ponYaw(frame.miradaAlDespertar);
  return true;
}

/** El frame con el que se pinta ANTES del primer `state_update`: el arma y el
 *  máximo del store, que son los MISMOS con los que arranca el bridge (el
 *  mismo `createInitialState`), sin enemigos ni NPCs. La vida, la que diga
 *  quien empieza — la del save al reanudar (`empezarPartida`); sin partida, el
 *  máximo. Aquí no se escribe ningún literal: el día que el jugador nazca con
 *  otra arma, nace en un sitio. */
export function frameDeArranque(store: GameStore, playerHp = store.state.player.max_hp): FrameResult {
  return {
    events: [],
    playerHp,
    playerMaxHp: store.state.player.max_hp,
    playerWeaponId: store.state.player.weapon_id,
    enemies: [],
    npcs: [],
  };
}
