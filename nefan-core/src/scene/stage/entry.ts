/** Zonas de salida y spawn de entrada del plató — lógica pura en metros de
 *  MUNDO (la consumen las transiciones del cliente y los tests). */

import type { ComposedStage, ComposedStageExit } from "./scene.js";

/** Distancia hacia el interior del plató a la que spawnea el jugador desde el
 *  borde interior de la zona de su salida de entrada — fuera de la zona, para
 *  no re-disparar la transición nada más llegar. */
const ENTRY_INSET_M = 0.8;

/** Primera salida cuya zona contiene (x, z), o null. */
export function exitZoneAt(stage: ComposedStage, x: number, z: number): ComposedStageExit | null {
  for (const exit of stage.exits) {
    const r = exit.rect;
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return exit;
  }
  return null;
}

/** Punto de aparición al ENTRAR al plató viniendo de `fromPlaceId`: el centro
 *  de la zona de la salida que lleva de vuelta allí, desplazado hacia el
 *  interior según su edge (cámara al sur: north=telón, south=embocadura).
 *  null si ninguna salida apunta a ese place (el caller degrada a
 *  __player_start con aviso). */
export function spawnPointForEntry(
  stage: ComposedStage,
  fromPlaceId: string,
): { x: number; z: number } | null {
  const exit = stage.exits.find((e) => e.to_place_id === fromPlaceId);
  if (!exit) return null;
  const r = exit.rect;
  let x = (r.minX + r.maxX) / 2;
  let z = (r.minZ + r.maxZ) / 2;
  switch (exit.edge) {
    case "north": z = r.maxZ + ENTRY_INSET_M; break;
    case "south": z = r.minZ - ENTRY_INSET_M; break;
    case "east": x = r.minX - ENTRY_INSET_M; break;
    case "west": x = r.maxX + ENTRY_INSET_M; break;
  }
  const b = stage.bounds;
  return {
    x: Math.min(b.maxX, Math.max(b.minX, x)),
    z: Math.min(b.maxZ, Math.max(b.minZ, z)),
  };
}
