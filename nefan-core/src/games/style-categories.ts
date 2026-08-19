/** TRANSITORIO (fase 3 del rediseño de estilos lo elimina): el rol de
 *  personaje derivado del rol de mundo del NPC. El formato de packs de refs
 *  libres vive en style-refs.ts; la selección por bioma/categoría murió con
 *  la elección explícita del motor (`style_ref` por escena).
 */
import { SAFE_ID, WORLD_VIEWS, type WorldView } from "./style-refs.js";

export { SAFE_ID, WORLD_VIEWS, type WorldView };

/** Rol de estilo de personaje para un rol de mundo de NPC (peasant/guard/…):
 *  decide qué referencia de characters/ del pack guía el skin. FUENTE ÚNICA —
 *  el cliente en partida y el batch de "aplicar estilo" deben derivar el
 *  MISMO rol o la clave de caché del skin diverge (doble pago). Con packs
 *  migrados, los valores son ids de refs (characters/commoner.jpg…); el
 *  server degrada un id inexistente a la primera ref de characters/. */
export function styleRoleForNpc(role?: string): "commoner" | "noble" | "warrior" {
  switch ((role ?? "").toLowerCase()) {
    case "guard":
    case "soldier":
    case "warrior":
      return "warrior";
    case "noble":
      return "noble";
    default:
      return "commoner";
  }
}
