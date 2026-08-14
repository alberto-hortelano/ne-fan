/** Cambio in-place del modo de render de un mundo, por faceta (escenarios o
 *  personajes) y en AMBOS sentidos (image⇄vector). Lógica pura y compartida
 *  por las dos ramas de handleSetRenderMode: la sesión ACTIVA la aplica sobre
 *  el mundo en memoria (que persiste el escritor único, NarrativeState.save),
 *  y una partida inactiva sobre el `world` leído de disco. Bajar a vector NO
 *  borra lo ya pintado: el cliente conserva las imágenes existentes y solo
 *  deja de generar nuevas. */
import type { NarrativeWorldState } from "./types.js";

export type RenderFacet = "scenes" | "characters";
export type RenderModeValue = "image" | "vector";

/** Fija el modo de la faceta a `mode`, mutando `world`. Devuelve un Result:
 *  `ok:false` con el motivo exacto si no hay nada que cambiar (la faceta ya
 *  está en ese modo) — el caller lo reenvía al cliente. */
export function applyRenderModeChange(
  world: NarrativeWorldState,
  facet: RenderFacet,
  mode: RenderModeValue,
): { ok: true } | { ok: false; error: string } {
  if (facet === "scenes") {
    if (world.render_mode === mode) {
      return {
        ok: false,
        error: `la partida ya tiene los escenarios en modo ${mode}`,
      };
    }
    // Fijar el modo de personajes ANTES de tocar render_mode: "" legacy
    // significa "sigue a render_mode", y sin materializarlo el cambio de
    // escenarios arrastraría también a los skins en silencio (en un sentido
    // gasto no pedido; en el otro apagado no pedido).
    if (!world.character_mode) {
      world.character_mode = world.render_mode === "vector" ? "vector" : "image";
    }
    world.render_mode = mode;
    return { ok: true };
  }
  // Personajes: "" legacy = sigue a render_mode — comparar contra el modo
  // EFECTIVO; asignar materializa el valor propio de la faceta.
  const effective = world.character_mode || world.render_mode;
  if (effective === mode) {
    return {
      ok: false,
      error: `la partida ya tiene los personajes en modo ${mode}`,
    };
  }
  world.character_mode = mode;
  return { ok: true };
}
