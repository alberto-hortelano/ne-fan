/** El world map en zod: el `anchor` de un lugar, el lugar, el enlace y el
 *  mapa entero — UNA sola fuente para los tres sitios por donde entra uno.
 *
 *   · `POST /map/place` (`PlaceUpsertSchema`, State API del bridge): el canal
 *     por el que el motor ancla un lugar al plano.
 *   · La tool `map_upsert_place` de narrative-mcp, que reenvía a esa ruta y
 *     hace su pre-flight con `AnchorSchema` (`narrative-mcp/validators.ts`)
 *     para que el motor lea el error ANTES de que el bridge lo rechace.
 *   · El `world_map` de un snapshot de mundo (`games/world-snapshot.ts`), que
 *     hasta #578 entraba como `z.record(unknown)`: un rect absurdo en el
 *     fichero pasaba la puerta sin que nadie lo mirara.
 *
 *  Hasta #465 el rect del anchor tenía DOS copias: la del bridge era
 *  `z.tuple([z.number() ×4])` —cualquier número, fraccionario o negativo— y la
 *  de la tool `z.array(z.number().int()).length(4)`, entera pero sin cotas.
 *  Ninguna miraba que el rect cupiera en el tile, que es lo único que le da
 *  sentido: `activateByPosition` compara celdas del tile (0..127) contra él.
 *
 *  Vive aparte de `request-schemas.ts` porque ese fichero arrastra
 *  `games/vocabulary.ts` (y con él `node:fs`): esto lo importan el snapshot,
 *  la tool y las rutas, y no tiene por qué traer el disco con él. */
import { z } from "zod";

import { TILE_CELLS } from "../scene/tile.js";

/** Reexportado para quien DESCRIBE estas cotas (la tool `map_upsert_place` de
 *  narrative-mcp): el número del texto sale de aquí, no de un 128 a mano. */
export { TILE_CELLS };
import {
  EDGES,
  LINK_KINDS,
  PLACE_KINDS,
  WORLD_MAP_SCHEMA_VERSION,
  type Place,
  type PlaceLink,
  type PlaceTriggerSpec,
  type TriggerWhen,
  type WorldMap,
} from "../world-map/types.js";
import type { Consequence } from "../narrative/types.js";

/** Sobre superficial de una consequence: objeto con `type` string. La forma
 *  completa la valida el consumidor (dispatchConsequences tolera y audita;
 *  el pre-flight del modelo usa ConsequenceSchema del SoT). */
export const ConsequenceEnvelope = z.custom<Consequence>(
  (v) => !!v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string",
  { message: "consequence must be an object with a string `type`" },
);

export const TriggerWhenSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player_entered") }),
  z.object({ type: z.literal("player_left") }),
  z.object({ type: z.literal("player_near"), radius: z.number() }),
  z.object({ type: z.literal("first_visit") }),
]);

export const PlaceTriggerSpecSchema = z.object({
  id: z.string().min(1),
  when: TriggerWhenSchema,
  // Ausente → [] (como el coerce histórico); presente pero no-array → error
  // (antes se MACHACABA a [] en silencio).
  consequences: z.array(ConsequenceEnvelope).default([]),
  fired_at: z.string().optional(),
});

/** Una celda del rect: entera y dentro del tile. */
const celda = (campo: string) =>
  z
    .number()
    .int({ message: `${campo} tiene que ser un número ENTERO de celdas` })
    .min(0, { message: `${campo} no puede ser negativo: las celdas del tile van de 0 a ${TILE_CELLS - 1}` });
/** Un lado del rect: entero y de al menos una celda. */
const lado = (campo: string) =>
  z
    .number()
    .int({ message: `${campo} tiene que ser un número ENTERO de celdas` })
    .min(1, { message: `${campo} tiene que medir al menos 1 celda` });

/** Dónde VIVE un lugar en el plano continuo: su tile y, opcionalmente, el
 *  rect `[col, row, w, h]` que ocupa dentro de él, en CELDAS del tile (0,5 m;
 *  el tile tiene 128×128, `TILE_CELLS`). Sin rect, el lugar es el tile
 *  entero. El rect gobierna dos cosas del jugador: dónde aparece al volver al
 *  lugar por «Salidas» (`resolvePlaceTarget`) y cuándo se activa el lugar al
 *  pisarlo (`activateByPosition`). Por eso tiene que caber: una celda fuera
 *  del tile no la pisa nadie. */
export const AnchorSchema = z.object({
  tx: z.number().int(),
  ty: z.number().int(),
  rect: z
    .tuple([celda("rect[0] (col)"), celda("rect[1] (row)"), lado("rect[2] (w)"), lado("rect[3] (h)")])
    .superRefine(([col, row, w, h], ctx) => {
      if (col + w > TILE_CELLS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rect se sale del tile por el este: col + w = ${col + w} > ${TILE_CELLS}`,
        });
      }
      if (row + h > TILE_CELLS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rect se sale del tile por el sur: row + h = ${row + h} > ${TILE_CELLS}`,
        });
      }
    })
    .optional(),
});

const PlaceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PLACE_KINDS),
  parent_id: z.string().nullable(),
  name: z.string().min(1),
  description: z.string(),
  approx_position: z.tuple([z.number(), z.number()]).optional(),
  approx_radius: z.number().optional(),
  attrs: z.record(z.unknown()),
  realized_scene_id: z.string().optional(),
  triggers: z.array(PlaceTriggerSpecSchema),
  introduced_event_id: z.string().optional(),
  visited: z.boolean(),
  anchor: AnchorSchema.optional(),
});

const PlaceLinkSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(LINK_KINDS),
  travel_hours: z.number().optional(),
  description: z.string().optional(),
  bidirectional: z.boolean(),
  edge: z.enum(EDGES).optional(),
});

/** El mapa ENTERO, con su integridad referencial: la clave de cada lugar es
 *  su id, la raíz y el lugar activo existen, cada `parent_id` apunta a un
 *  lugar del mapa y cada enlace une dos. Es lo que `WorldMapManager` garantiza
 *  al construirlo por sus mutaciones; un fichero en disco no pasó por ellas. */
export const WorldMapSchema = z
  .object({
    schema_version: z.literal(WORLD_MAP_SCHEMA_VERSION),
    places: z.record(z.string(), PlaceSchema),
    links: z.array(PlaceLinkSchema),
    root_id: z.string().min(1),
    active_place_id: z.string().min(1),
  })
  .superRefine((mapa, ctx) => {
    const existe = (id: string) => Object.prototype.hasOwnProperty.call(mapa.places, id);
    const falta = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (!existe(mapa.root_id)) falta(["root_id"], `root_id "${mapa.root_id}" no está en places`);
    if (!existe(mapa.active_place_id)) {
      falta(["active_place_id"], `active_place_id "${mapa.active_place_id}" no está en places`);
    }
    for (const [clave, lugar] of Object.entries(mapa.places)) {
      if (lugar.id !== clave) falta(["places", clave, "id"], `el lugar "${clave}" declara id "${lugar.id}"`);
      if (lugar.parent_id !== null && !existe(lugar.parent_id)) {
        falta(["places", clave, "parent_id"], `parent_id "${lugar.parent_id}" no está en places`);
      }
    }
    mapa.links.forEach((enlace, i) => {
      for (const punta of ["from", "to"] as const) {
        if (!existe(enlace[punta])) {
          falta(["links", i, punta], `el enlace ${i} apunta a "${enlace[punta]}", que no está en places`);
        }
      }
    });
  });

// Guardia de deriva, la misma que `request-schemas.ts`: si el zod y el tipo
// del mapa divergen, esto deja de compilar.
type Mirror<A, B> = [A, B];
function assertMirror<A, B extends A>(_pair?: Mirror<A, B>): void {
  void _pair;
}
assertMirror<WorldMap, z.infer<typeof WorldMapSchema>>();
// Solo en esta dirección: el tipo declara `schema_version: number` y la puerta
// exige el literal de HOY (un mapa de otra versión no se interpreta).
assertMirror<Place, z.infer<typeof PlaceSchema>>();
assertMirror<z.infer<typeof PlaceSchema>, Place>();
assertMirror<PlaceLink, z.infer<typeof PlaceLinkSchema>>();
assertMirror<z.infer<typeof PlaceLinkSchema>, PlaceLink>();
assertMirror<PlaceTriggerSpec, z.infer<typeof PlaceTriggerSpecSchema>>();
assertMirror<z.infer<typeof PlaceTriggerSpecSchema>, PlaceTriggerSpec>();
assertMirror<TriggerWhen, z.infer<typeof TriggerWhenSchema>>();
assertMirror<z.infer<typeof TriggerWhenSchema>, TriggerWhen>();
