/** Upgrade in-place de vector→image de un mundo, por faceta (escenarios o
 *  personajes). Lógica pura y compartida por las dos ramas de
 *  handleSetRenderMode: la sesión ACTIVA la aplica sobre el mundo en memoria
 *  (que persiste el escritor único, NarrativeState.save), y una partida
 *  inactiva sobre el `world` leído de disco. Solo vector→image: quitar
 *  imágenes dejaría el mundo mezclado clay/pintado. */
import type { NarrativeWorldState } from "./types.js";

export type RenderFacet = "scenes" | "characters";

/** Valida que la faceta esté en vector y la sube a image, mutando `world`.
 *  Devuelve un Result: `ok:false` con el motivo exacto si no se puede activar
 *  (ya en image, o no está en vector) — el caller lo reenvía al cliente. */
export function applyRenderModeUpgrade(
  world: NarrativeWorldState,
  facet: RenderFacet,
): { ok: true } | { ok: false; error: string } {
  if (facet === "scenes") {
    const current = world.render_mode;
    if (current !== "vector") {
      return {
        ok: false,
        error:
          current === "image"
            ? "la partida ya tiene los escenarios con imágenes"
            : `la partida no está en modo vector (render_mode=${JSON.stringify(current)})`,
      };
    }
    // Fijar el modo de personajes ANTES de subir render_mode: "" legacy
    // significa "sigue a render_mode", y sin fijarlo el upgrade de escenarios
    // activaría también los skins IA en silencio (gasto no pedido).
    if (!world.character_mode) world.character_mode = "vector";
    world.render_mode = "image";
    return { ok: true };
  }
  // Personajes: "" legacy = sigue a render_mode — el modo EFECTIVO es el que
  // debe estar en vector para poder activar.
  const effective = world.character_mode || world.render_mode;
  if (effective !== "vector") {
    return {
      ok: false,
      error:
        effective === "image"
          ? "la partida ya tiene los personajes con skins IA"
          : `la partida no está en modo vector (character_mode=${JSON.stringify(effective)})`,
    };
  }
  world.character_mode = "image";
  return { ok: true };
}
