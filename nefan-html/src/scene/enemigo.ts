/** LA puerta por la que un enemigo entra al cliente.
 *
 *  Hay dos vías por las que el motor narrativo pone algo hostil delante del
 *  jugador —la escena inicial (`npcs[].combat` de la world scene) y el spawn
 *  en runtime (`spawn_entity` con `role:"hostile"`)—, y las dos terminan aquí:
 *  un `RoomEnemy` para `add_combatants` (lo que hace que exista para el sim,
 *  que es quien resuelve el daño) y una `Entity` para pintarlo y ponerle su
 *  barra de vida. Si hubiera dos constructores, uno de los dos se olvidaría de
 *  la mitad — que es justo lo que hacía la rama muerta que esto sustituye: la
 *  de `objects[].combat` tiraba `description` y `style_ref`, así que un
 *  enemigo se pintaba desde su id.
 *
 *  El cliente NO decide nada del balance NI qué bloque es utilizable: los
 *  números los deriva el core (`combatForHostileRole`) y quien los comprueba es
 *  `parseHostileCombat` (core, PR 6 de #241), que es el MISMO criterio que
 *  aplica el bridge en el borde WS — antes eran dos, y no decían lo mismo. Lo
 *  que queda aquí es de cliente: mandar el motivo del rechazo al registro de
 *  errores (`errors.push`) y construir la `Entity` que se pinta.
 */
import type { Vec3 } from "@nefan-core/src/types.js";
import { parseHostileCombat } from "@nefan-core/src/combat/hostil-desde-combat.js";
import { npcSkinStyleRef } from "@nefan-core/src/games/style-categories.js";
import type { RoomEnemy } from "../net/game-client.js";
import type { DuenoDeEntity, Entity } from "../renderer/types.js";
import { errors } from "../ui/error-log.js";

/** Colores del rótulo/silueta de la barra de vida — sin arte propio todavía,
 *  distinguen a dos enemigos en pantalla. */
const ENEMY_COLORS = ["#c44", "#4a4", "#48c", "#ca4"];

export interface EnemigoNuevo {
  /** Lo que se manda al bridge (`add_combatants` → `sim.addCombatant`). */
  combatiente: RoomEnemy;
  /** Lo que se pinta y lo que lleva la barra de vida del HUD. */
  entidad: Entity;
}

export interface DatosDeEnemigo {
  id: string;
  pos: Vec3;
  /** El bloque `{health, max_health, weapon_id, personality}` derivado por el
   *  core, con la vida VIVA si viene de un save. */
  combat: unknown;
  /** Prompt del skin IA: la DESCRIPCIÓN del motor, no el id. */
  descripcion?: string;
  /** Ref de personaje elegida por el motor, si la eligió. */
  styleRef?: string;
  /** Nombre propio para el rótulo bajo la mirilla. */
  nombre?: string;
  /** Índice para rotar el color entre varios enemigos en pantalla. */
  indiceColor?: number;
  /** De quién es (gobierna la purga al re-emitir un tile). OBLIGATORIO, y no
   *  un `tileKey?` como hasta #350: un spawn de runtime tiene que DECIR que lo
   *  es, en vez de compartir el `undefined` con el que se olvidó de ponerlo. */
  dueno: DuenoDeEntity;
}

/** Construye el enemigo, o `null` si el bloque `combat` no es utilizable (y
 *  entonces lo deja escrito en el registro de errores, con el id y el motivo
 *  que dio el core). Devolver `null` y no un enemigo a medias es deliberado: un
 *  combatiente con vida NaN entra en el sim y ya no se puede matar. */
export function enemigoDesdeCombat(datos: DatosDeEnemigo): EnemigoNuevo | null {
  const { id, pos } = datos;
  const comprobado = parseHostileCombat(datos.combat);
  if (!comprobado.ok) {
    errors.push("scene", `enemigo "${id}" descartado: ${comprobado.error}`);
    return null;
  }
  const { health, max_health: maxHealth, weapon_id: weaponId, personality } = comprobado.hostil;

  // El prompt del skin es la DESCRIPCIÓN, como en cualquier NPC: es lo que
  // pinta al personaje, y con el id se pintaría "bandido_1".
  const prompt = datos.descripcion || datos.nombre || id;
  const color = ENEMY_COLORS[(datos.indiceColor ?? 0) % ENEMY_COLORS.length];

  return {
    combatiente: { id, position: pos, health, maxHealth, weaponId, personality },
    entidad: {
      id,
      pos,
      forward: { x: 0, y: 0, z: -1 },
      radius: 7,
      color,
      label: datos.nombre ?? prompt,
      name: datos.nombre ?? id,
      hp: health,
      maxHp: maxHealth,
      alive: true,
      category: "creature",
      skinPrompt: prompt,
      // Vestuario: la ref elegida por el motor o el default por rol (hostile →
      // warrior). Se deriva con la MISMA función que los NPCs o la clave de
      // caché del skin diverge y se paga dos veces.
      styleRole: npcSkinStyleRef({ style_ref: datos.styleRef, role: "hostile" }),
      dueno: datos.dueno,
    },
  };
}
