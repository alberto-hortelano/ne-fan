/** El `seed?` de una zona del tile — UNA definición para los dos campos que
 *  lo llevan, `vegetation_zones[].seed` y `scatter_zones[].seed`.
 *
 *  Se llaman igual y viajan en el mismo mensaje del motor, así que tienen que
 *  ser el mismo tipo: cuando uno era cadena y el otro número, 4 de 4 motores
 *  escribieron el de vegetación como el de al lado y se comieron un rechazo
 *  por tile (tanda BP). Entero y no cualquier número porque es lo que dice la
 *  prosa del tile, y un validador más laxo que su prosa deja de enseñar. */
import { z } from "zod";

export const ZONE_SEED_MAX = 1e9;

/** El motivo del rechazo, con el valor que llegó: el motor tiene que ver QUÉ
 *  escribió para corregirlo sin adivinar. Sale de aquí para que el error de
 *  las dos zonas sea el mismo texto. */
export function motivoSeedDeZona(recibido: unknown): string {
  return `seed es un entero de 0 a ${ZONE_SEED_MAX}, el mismo tipo en vegetation_zones y scatter_zones (tiene ${JSON.stringify(recibido)})`;
}

// El errorMap del esquema cubre también los checks (.int/.min/.max), y
// `ctx.data` es el valor recibido: un solo mensaje para todos los rechazos.
export const ZoneSeedSchema = z
  .number({ errorMap: (_issue, ctx) => ({ message: motivoSeedDeZona(ctx.data) }) })
  .int()
  .min(0)
  .max(ZONE_SEED_MAX);
