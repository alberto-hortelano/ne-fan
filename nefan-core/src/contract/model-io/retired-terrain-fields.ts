/** Los DOS campos con los que el terreno se declaraba por chars, retirados
 *  enteros el 2026-09-02 (#335): una leyenda char→nombre/solidez y parches
 *  ASCII estampados sobre el bioma. Hoy el suelo tiene un solo origen —
 *  `biome` + `ground`/`volumes`— y la solidez la fija el engine
 *  (`DEFAULT_SOLID_CHARS`: agua y muro bloquean).
 *
 *  Se rebotan por NOMBRE en las dos poblaciones de escena, porque los dos
 *  sitios por los que vuelven son un motor que copia un ejemplo viejo
 *  (`EmittedSceneSchema`) y un save o snapshot anterior a la retirada
 *  (`ExpandedSceneSchema`): con `.passthrough()` entrarían mudos, vivirían
 *  para siempre en `scene_data` y volverían al motor por `serializeForLlm`.
 *
 *  Vive en su propio fichero porque para nombrar el campo en el `path` del
 *  issue hay que ESCRIBIRLO, y `campos-retirados-no-vuelven` (arch-rules.json)
 *  los caza en todo `src/`. El checker exime por FICHERO entero, así que la
 *  ceguera que compra la exención se limita a estas líneas y a nada más. */

import { z } from "zod";

export const RETIRED_TERRAIN_FIELDS = ["terrain_legend", "terrain_patches"] as const;

export function refineRetiredTerrainFields(s: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const campo of RETIRED_TERRAIN_FIELDS) {
    if (!(campo in s)) continue;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [campo],
      message:
        `\`${campo}\` está retirado: el terreno se declara con \`biome\` + \`ground\`/\`volumes\` y la ` +
        "solidez la fija el engine (agua y muro bloquean). Si viene de un save o snapshot, bórralo o regenéralo",
    });
  }
}
