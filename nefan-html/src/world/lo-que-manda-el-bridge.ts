/** DÓNDE ESTÁ CADA CUERPO: lo dice el bridge, y el cliente lo copia.
 *
 *  La posición y el rumbo de NPCs y enemigos NO son del cliente: los mueve el
 *  bridge (la vida ambiental de los NPCs y la persecución de los hostiles) y
 *  llegan en el `state_update` de cada frame. Aquí solo se copian sobre los
 *  cuerpos que ya están en el mundo — es la mitad VIVA de la partición que
 *  gobierna `entidades-del-tile.ts` en core, vista desde el otro lado: lo que
 *  el tile declara se re-aplica al re-emitirse, y esto no, porque esto lo
 *  escribe alguien cada frame.
 *
 *  UN ID QUE EL BRIDGE NOMBRA Y EL CLIENTE NO TIENE ES UN DEFECTO, y se dice.
 *  Aquí ponía «es de un tile aún no cargado — se ignora», y esa justificación
 *  tapaba un fallo real: el NPC pacífico de un spawn de runtime volvía vivo del
 *  ledger al reanudar y el cliente lo tiraba aquí, así que ANDABA INVISIBLE por
 *  el mundo (#326). Con dedupe por id, porque esto se lee a 60 fps y sin él el
 *  registro de errores sería una línea por frame.
 */

import { errors } from "../ui/error-log.js";
import type { MundoDelCliente } from "./mundo-del-cliente.js";

/** Lo que el bridge dice de un NPC ambiental este frame. */
interface NpcVivo {
  id: string;
  pos: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
  anim?: string;
  run?: boolean;
}

/** Lo que el sim dice de un combatiente este frame. */
interface EnemigoVivo {
  id: string;
  pos?: { x: number; y: number; z: number };
  forward?: { x: number; y: number; z: number };
  hp: number;
  alive: boolean;
  state?: string;
  attackType?: string;
}

/** Vuelca sobre los cuerpos del mundo lo que el bridge manda de ellos. */
export function aplicarLoQueMandaElBridge(
  mundo: MundoDelCliente,
  frame: { npcs?: readonly NpcVivo[]; enemies: readonly EnemigoVivo[] },
): void {
  for (const npc of frame.npcs ?? []) {
    const cuerpo = mundo.npc(npc.id);
    if (!cuerpo) {
      if (mundo.esNuevoNpcSinCuerpo(npc.id)) {
        errors.push(
          "scene",
          `el bridge mueve al NPC "${npc.id}" y el cliente no lo tiene en escena: ` +
            `anda invisible (¿un spawn que no se rehidrató al reanudar?)`,
        );
      }
      continue;
    }
    cuerpo.pos = { x: npc.pos.x, y: npc.pos.y, z: npc.pos.z };
    cuerpo.forward = { x: npc.forward.x, y: npc.forward.y, z: npc.forward.z };
    cuerpo.requestedAnim = npc.anim;
    cuerpo.npcRun = npc.run;
  }

  for (const enemigo of frame.enemies) {
    const cuerpo = mundo.enemigo(enemigo.id);
    // Un enemigo del sim sin cuerpo aquí NO se reporta, al contrario que un
    // NPC: el sim conserva a los combatientes de tiles que el cliente pudo no
    // haber pintado todavía, y decirlo sesenta veces por segundo sería ruido
    // sobre un estado legal.
    if (!cuerpo) continue;
    if (enemigo.pos) cuerpo.pos = { x: enemigo.pos.x, y: enemigo.pos.y, z: enemigo.pos.z };
    if (enemigo.forward) {
      cuerpo.forward = { x: enemigo.forward.x, y: enemigo.forward.y, z: enemigo.forward.z };
    }
    cuerpo.hp = enemigo.hp;
    cuerpo.alive = enemigo.alive;
    cuerpo.attacking = enemigo.state === "winding_up" || enemigo.state === "attacking";
    cuerpo.attackType = enemigo.attackType;
  }
}
