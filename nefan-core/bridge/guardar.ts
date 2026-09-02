/** GUARDAR DESDE EL HOT LOOP, Y DECIRLO SI NO SE PUDO.
 *
 *  Dos hechos del bucle de `input` tienen que llegar al disco en el acto: una
 *  muerte (#326) y un cambio de tile (#395). Los dos se guardan igual y fallan
 *  igual, así que el cuerpo está UNA vez: `save()` y, si revienta, el log del
 *  bridge más un `narrative_status: error` con `kind: "save"` — el canal
 *  fail-loud de esta capa (CLAUDE.md § Errores). Lo que peligra en los dos
 *  casos es lo mismo: que al reanudar el mundo no sea el que el jugador dejó.
 *
 *  Solo si esta partida está ESCUCHANDO al sim (`ctx.world.kind === "session"`):
 *  los muñecos de una fixture del selector «Room» no escriben en la partida de
 *  nadie (`world-claim.ts`). El gate vive aquí, en la puerta, y no en cada
 *  llamante — es la clase de guarda que se olvida en el segundo sitio.
 */

import type { BridgeContext } from "./context.js";

/** Guarda la partida o avisa al jugador de que no se pudo.
 *
 *  `log` es el sujeto del `console.error` del bridge («la muerte de un
 *  enemigo», «el cambio de tile») y `aviso` la frase que lee el jugador, que
 *  empieza por la CONSECUENCIA y no por «no se pudo guardar» (QA 2026-09-01,
 *  H-4: el titular ya lo pone `rotuloDeStatus`). */
export async function guardarOAvisar(ctx: BridgeContext, log: string, aviso: string): Promise<void> {
  if (ctx.world.kind !== "session") return;
  await ctx.narrative.save().catch((err: unknown) => {
    console.error(`Bridge: no se pudo guardar ${log}:`, err);
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "save",
      message: aviso,
    });
  });
}
