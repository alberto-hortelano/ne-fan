/** TRANSITORIO (fase 3 del rediseño de estilos lo elimina): el rol de
 *  personaje derivado del rol de mundo del NPC. El formato de packs de refs
 *  libres vive en style-refs.ts; la selección por bioma/categoría murió con
 *  la elección explícita del motor (`style_ref` por NPC).
 */
import { NPC_ROLES, type NpcRole } from "../simulation/npc-roles.js";
import { SAFE_ID } from "./style-refs.js";

export { SAFE_ID };

/** Refs de personaje que un pack de estilo trae de serie (`characters/`).
 *  `noble` sigue existiendo en los packs: es alcanzable, pero SOLO cuando el
 *  motor la elige explícitamente con `style_ref` — ningún rol de conducta la
 *  deriva, porque "de alta posición" es aspecto, no comportamiento. */
export type NpcStyleRole = "commoner" | "noble" | "warrior";

/** Ref de personaje por defecto de cada rol de mundo. `Record<NpcRole, …>`
 *  a propósito: el vocabulario de `role` es CERRADO (`NPC_ROLES`, la fuente
 *  única que comparten `generate_scene`, `spawn_entity` y los presets de
 *  conducta), así que añadir un rol sin decidir cómo se viste no compila, y
 *  una rama para un rol que no existe tampoco se puede escribir. Antes esto
 *  era un `switch` con tres etiquetas INALCANZABLES (`soldier`, `warrior`,
 *  `noble`): verdes en cobertura, imposibles en producción. */
const REF_POR_ROL: Record<NpcRole, NpcStyleRole> = {
  peasant: "commoner",
  villager: "commoner",
  merchant: "commoner",
  guard: "warrior",
  // Un hostil se viste de la ref que YA existe en todos los packs: no se
  // añade ninguna, así que ninguna clave de caché de skin cambia y un
  // enemigo nuevo paga su skin como cualquier NPC nuevo, ni más ni menos.
  hostile: "warrior",
};

/** Rol de estilo de personaje para un rol de mundo de NPC (peasant/guard/…):
 *  decide qué referencia de characters/ del pack guía el skin. FUENTE ÚNICA —
 *  el cliente en partida y el batch de "aplicar estilo" deben derivar el
 *  MISMO rol o la clave de caché del skin diverge (doble pago). Un `role`
 *  fuera del vocabulario (save viejo, fixture a mano) cae a `commoner`, la
 *  misma degradación que aplica `resolveRoleParams` con el preset villager.
 *  Con packs migrados, los valores son ids de refs (characters/commoner.jpg…);
 *  el server degrada un id inexistente a la primera ref de characters/. */
export function styleRoleForNpc(role?: string): NpcStyleRole {
  return esRolDeNpc(role) ? REF_POR_ROL[role] : "commoner";
}

/** ¿Es `role` uno de los cuatro del vocabulario? El narrowing lo necesita la
 *  tabla, y el pre-flight del contrato lo necesita para rechazar un oficio
 *  inventado con el error preciso (ver `EntitySchema.role`). */
export function esRolDeNpc(role: unknown): role is NpcRole {
  return typeof role === "string" && (NPC_ROLES as readonly string[]).includes(role);
}

/** Ref de personaje del skin de un NPC: la ELEGIDA por el motor
 *  (`style_ref`, catálogo world.style_refs.characters) o, sin elección, el
 *  default derivado del rol (styleRoleForNpc — conserva las claves de caché
 *  de skins de saves y batches previos: un guardia sin elección sigue
 *  resolviendo a la ref warrior). FUENTE ÚNICA para partida y batch. */
export function npcSkinStyleRef(npc: { style_ref?: string; role?: string }): string {
  return npc.style_ref || styleRoleForNpc(npc.role);
}
