/** Zod de una escena Format D — el GATE estructural fail-loud del pre-flight.
 *
 *  Hasta ahora la única "validación" del top-level de una escena era
 *  ai_server/validate_scene_response, que DEGRADABA en silencio (terrain no
 *  lista → todo hierba, filas mal → padding, entities malformadas → clamp…),
 *  así que un error de forma del modelo nunca volvía al modelo. Este schema lo
 *  valida en el pre-flight MCP y devuelve el error preciso para re-responder.
 *
 *  Alcance: FORMA estructural (entities, tile, biome) + las sub-partes
 *  tipadas (ground/volumes reutilizan su propio zod). La JUGABILIDAD
 *  (flood-fill, alcanzabilidad, costuras de tile) la sigue validando
 *  scene-validate.ts; aquí no se duplica.
 *
 *  Format D tiene UNA variante y este schema es su candado: el `tile` del
 *  mundo continuo. La "suelta" (`size`/`terrain` a elección del motor, sin
 *  sitio en el plano) se retiró con el issue #172, y el `stage` proscenio con
 *  la vista que lo pintaba: una escena sin `tile` es un error de contrato, no
 *  una escena pequeña.
 *
 *  `.strict()` en los DOS niveles, escena y entity. La entity se cerró en #259
 *  (censadas 95 entities en 7 escenas: cero claves fuera del shape); la escena
 *  en #400, cuando los dos campos que su `.passthrough()` sostenía dejaron de
 *  necesitarlo: `place_anchors` se declara (lo escriben el saneador Python y
 *  el motor del banco; lo leen los handlers de tile y place) y la frase de
 *  ambiente de la escena se retiró (cero lectores en core, bridge y cliente —
 *  la copiaba `formatDToWorld` para nadie). Un passthrough que no protege tráfico
 *  legítimo solo se traga las erratas del modelo, y ese es justo el
 *  fail-silent que este gate existe para cerrar. Con el cierre, una clave de
 *  raíz desconocida es SIEMPRE el primer issue, así que los rebotes dirigidos
 *  que antes vivían en el `superRefine` (`style_ref` de escena, la marca
 *  `__expanded` del expander, los campos de terreno retirados) viven ahora en
 *  el `errorMap` de la escena: es el único sitio desde el que su motivo llega
 *  al motor, porque `formatError` solo enseña el primer issue. */

import { z } from "zod";
import { GroundSchema } from "../../scene/blueprint/ground.js";
import { VegetationZonesSchema } from "../../scene/blueprint/vegetation.js";
import { VolumesSchema } from "../../scene/blueprint/volumes.js";
import { parseScatter } from "../../scene/blueprint/scatter.js";
import { NPC_ROLES } from "../../simulation/npc-roles.js";
import { VocabularioDeEntity } from "./entity-vocabulary.js";
import { enMetros, topeDeFootprint } from "./physics.js";
import { mensajeDeCampoRetirado } from "./retired-terrain-fields.js";

export const ENTITY_KINDS = ["building", "prop", "item", "tree", "npc", "player", "decor"] as const;
export const SCENE_BIOMES = ["grass", "forest_floor", "meadow", "sand", "dirt", "stone", "snow", "swamp"] as const;

// El tope del `footprint` de una entity móvil y los cuerpos de los que sale
// viven en `physics.ts`, que es lo que se vuelca al snapshot que lee
// ai_server: si estuvieran aquí, el espejo Python tendría que copiarlos.
export { RADIO_SIMULADO_POR_KIND } from "./physics.js";

/** Mensaje de la clave desconocida. Va por `errorMap` y no por `.strict(msg)`
 *  porque ese solo admite texto fijo: aquí hay que nombrar LA clave que sobra
 *  y la entity que la trae, que es lo accionable cuando el tile llega con
 *  ochenta. Mismo criterio que el `superRefine` de `role` (que no corre en
 *  este caso: si el objeto falla por clave desconocida, zod no llega al
 *  refinamiento). */
const entityErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code !== z.ZodIssueCode.unrecognized_keys) return { message: ctx.defaultError };
  const id = (ctx.data as { id?: unknown } | null)?.id;
  const quien = typeof id === "string" && id ? `la entity "${id}"` : "una entity";
  return {
    message:
      `${quien} trae ${issue.keys.length === 1 ? "la clave" : "las claves"} ` +
      `${issue.keys.map((k) => `\`${k}\``).join(", ")}, que no existe${issue.keys.length === 1 ? "" : "n"} ` +
      `en el contrato. Una entity tiene EXACTAMENTE estos campos: ${ENTITY_FIELDS.join(" | ")}. ` +
      `Lo que quisieras contar de ella va en \`description\`, que es de donde sale su aspecto.`,
  };
};

const EntityBase = z
  .object({
    id: z.string().min(1),
    kind: z.enum(ENTITY_KINDS),
    // `name` y `description` son el vocabulario COMPARTIDO con `spawn_entity`
    // (entity-vocabulary.ts): la etiqueta obligatoria y la procedencia
    // opcional, el mismo objeto zod en las dos puertas (#397).
    name: VocabularioDeEntity.name,
    // Celda [col,row]: admite fracción (colocación fina — media celda importa
    // en el z-order y en props pequeños), como los `at` de volumes.
    cell: z.tuple([z.number(), z.number()]),
    footprint: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    shape: z.enum(["box", "cylinder", "sphere", "cone"]).optional(),
    h: z.number().positive().optional(),
    // ── NPCs: con qué se viste y cómo se comporta ────────────────────────
    // `role` NO es el oficio: es el preset de conducta que el sim implementa
    // (NPC_ROLES, la misma lista que el enum de `spawn_entity` — un NPC no
    // puede declarar su oficio con un vocabulario en un tool y con otro en el
    // vecino). Vocabulario CERRADO a propósito: un `role: "herrero"` no
    // degradaría a villager en silencio, se le devuelve al motor. El oficio
    // viaja en `name` y en `description`, que es de donde sale el prompt del
    // skin IA.
    //
    // `z.string()` + refinamiento en vez de `z.enum(NPC_ROLES)`, y no es un
    // aflojamiento: la lista es la misma y el rechazo también. Lo que cambia
    // es el MENSAJE, que aquí es la pieza que trabaja — este gate es el único
    // cuyo error vuelve al modelo, y `formatError` solo le enseña el PRIMER
    // issue. Un enum solo sabe decir «entities[37].role: Invalid enum value»;
    // el refinamiento tiene la entity entera delante, así que puede nombrar
    // al NPC por su id y decir dónde va el oficio — que es lo accionable
    // cuando el tile trae ochenta entidades. Espejo exacto del mensaje que da
    // `clean_ent` en ai_server.
    role: z.string().min(1).optional(),
    // La PROCEDENCIA (qué es y por qué `.refine()` y no `.trim()`: en
    // entity-vocabulary.ts). Opcional en el zod y exigida en la prosa del
    // prompt para el NPC: este schema canda también las fixtures de
    // `data/scenes/`, y las 14 sondas de z-order de zorder_test.json no
    // tienen aspecto que describir ni deben pagar un skin.
    description: VocabularioDeEntity.description,
    // Ref de personaje del catálogo del pack (world.style_refs.characters)
    // ELEGIDA por el motor; sin ella, el default sale del `role`.
    style_ref: z.string().min(1).optional(),
  }, { errorMap: entityErrorMap });

/** Los campos de una entity, DERIVADOS del shape — no una copia a mano que se
 *  quede atrás. Los lee el mensaje de error y el guardia de campos JSON→zod
 *  de `contract-prompts.test.ts`. */
export const ENTITY_FIELDS = Object.keys(EntityBase.shape) as readonly string[];

export const EntitySchema = EntityBase
  // CERRADO (#259): una clave que no esté entre las 10 vuelve al modelo con su
  // nombre en vez de caerse por el desagüe. Las dos que se fueron después
  // (#399/#400): el decor pegado al muro buscaba un char que ningún productor
  // escribía, y el char ASCII de la entity no lo leía nadie fuera del contrato. La poda muda de `clean_ent` en
  // ai_server hacía lo mismo por el otro lado y es su espejo exacto.
  .strict()
  .superRefine((e, ctx) => {
    // ── El cuerpo declarado no puede pasarse del simulado (#300) ──────────
    const tope = topeDeFootprint(e.kind);
    const lado = Math.max(e.footprint[0], e.footprint[1]);
    if (tope !== undefined && lado > tope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["footprint"],
        message:
          `la entity "${e.id}" (${e.kind}) declara footprint [${e.footprint[0]}, ${e.footprint[1]}] ` +
          `(${enMetros(lado)} m de lado) y el cuerpo que el simulador mueve son ${tope} ` +
          `celda${tope === 1 ? "" : "s"} (${enMetros(tope)} m): lo declarado no puede ser mayor que lo ` +
          `que la colisión honra. Un bicho más grande no se consigue con un footprint mayor — hoy no ` +
          `existe—; lo que sí viaja es su aspecto, y eso va en \`description\`.`,
      });
    }
    if (e.role === undefined || (NPC_ROLES as readonly string[]).includes(e.role)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["role"],
      message:
        `el NPC "${e.id}" declara role "${e.role}", que no es un rol de conducta. ` +
        `Los únicos son ${NPC_ROLES.join(" | ")} (los mismos que en spawn_entity). ` +
        `El oficio —herrero, alcaldesa, molinero— va en \`name\` y en \`description\`, ` +
        `que es de donde sale su aspecto; \`role\` solo elige cómo se comporta.`,
    });
  });

export const SceneSizeSchema = z.object({
  cols: z.number().int().min(1),
  rows: z.number().int().min(1),
  meters_per_cell: z.number().positive(),
});

const TileCoordSchema = z.object({ tx: z.number().int(), ty: z.number().int() });

/** Lo que las DOS poblaciones tienen en común. Está fuera de los dos schemas
 *  a propósito: la frontera entre lo que el modelo EMITE y lo que el juego
 *  CARGA se cruza una sola vez, en `expandScenePrimitives`, y hasta hoy no
 *  tenía tipo por ninguno de los dos lados. */
const sceneBaseShape = {
  scene_id: z.string().min(1),
  scene_description: z.string().min(1),
  place_id: z.string().min(1).optional(),
  tile: TileCoordSchema.optional(),
  biome: z.enum(SCENE_BIOMES).optional(),
  size: SceneSizeSchema.optional(),
  terrain: z.array(z.string()).optional(),
  ground: GroundSchema.optional(),
  volumes: VolumesSchema.optional(),
  // Vegetación de masa: el MISMO zod que compone el plan
  // (blueprint/vegetation.ts), no una copia con las mismas reglas. Su
  // `density` va en ejemplares/m² con un tope derivado de la geometría del
  // paso del jugador: un bosque intransitable no se puede pedir.
  vegetation_zones: VegetationZonesSchema.optional(),
  // Scatter (#203): estaba en `generate_scene.json` y NO en el zod, así que el
  // tool se lo ofrecía al modelo y el gate no sabía ni que existía. Se cierra
  // llevando el zod al JSON, nunca al revés — el campo está vivo y lo consumen
  // scene-expand, blueprint/scatter y fps-spec.
  //
  // La FORMA aquí es deliberadamente abierta porque la comprobación de verdad
  // la hace `refineScatter` más abajo con `parseScatter`, el MISMO validador
  // fail-loud que ya corre en producción (`scene-validate.ts`). La alternativa
  // era escribir un zod paralelo con sus reglas: un SEXTO espejo del contrato,
  // que es justo la enfermedad que esta tanda vino a tratar. Un `z.unknown()`
  // a secas sí sería verde que no comprueba nada; con el refinamiento no lo es.
  scatter_generators: z.unknown().optional(),
  scatter_zones: z.unknown().optional(),
  // Dónde vive cada lugar del mapa dentro del tile: el bridge afina con esto el
  // anclaje del place (bootstrap-place, handlers de tile) y el jugador aparece
  // dentro del lugar, no en el centro geométrico. Espejo exacto del saneador
  // de ai_server. Lo escribe el motor del banco y lo tolera el saneador; el
  // tool real aún no se lo ofrece al motor — issue derivado de #400.
  place_anchors: z
    .array(
      z.object({
        place_id: z.string().min(1),
        rect: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]).optional(),
      }),
    )
    .max(8)
    .optional(),
  entities: z.array(EntitySchema),
} as const;

/** Delega en `parseScatter` (blueprint/scatter.ts) — su mensaje ya trae la
 *  ruta exacta (`scatter_zones[0].shape.pts[2]: …`) y está congelado en el
 *  golden de scene-validate, así que se propaga tal cual. Los dos campos se
 *  validan juntos porque una zona nombra a su generador: por separado no se
 *  puede contestar si la escena es válida. */
function refineScatter(
  s: { scatter_generators?: unknown; scatter_zones?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (s.scatter_generators === undefined && s.scatter_zones === undefined) return;
  const r = parseScatter(s.scatter_generators, s.scatter_zones);
  if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: r.error });
}

/** Los campos de nivel superior de una escena, DERIVADOS del shape. Los lee el
 *  guardia JSON→zod de `contract-prompts.test.ts`: un campo que
 *  `generate_scene.json` le ofrezca al modelo y que no esté aquí pone rojo. */
export const SCENE_FIELDS = Object.keys(sceneBaseShape) as readonly string[];

/** Los campos que el MOTOR puede emitir en la raíz: los de la base menos el
 *  grid (`size`/`terrain`), que solo existe en la población expandida. Es la
 *  lista que se le enseña al modelo cuando trae una clave de más, y la que el
 *  saneador de ai_server deriva del tool (`SCENE_FIELDS` allí). */
export const EMITTED_SCENE_FIELDS = SCENE_FIELDS.filter((k) => k !== "size" && k !== "terrain");

/** Por qué se rebota una clave de raíz RETIRADA, o `null` si es una clave
 *  desconocida cualquiera. Un campo retirado no se rebota con el mensaje
 *  genérico: el motor lo copió de un ejemplo viejo y hay que decirle con qué
 *  se sustituye. `stage` era el bloque del plató proscenio (sus salidas), que
 *  murió con la vista que lo pintaba. `style_ref` de ESCENA elegía la lámina temática del repintado
 *  del tile, que murió con la vista oblicua — la de ENTIDAD (npc) sigue viva.
 *  `__expanded` es la marca INTERNA del expander (scene-expand.ts): una escena
 *  EMITIDA que la trae miente sobre su estado, y con `terrain` vacío cruzaba
 *  hasta reventar el validador de jugabilidad como 500 (#195). */
function motivoDeClaveRetirada(clave: string): string | null {
  if (clave === "stage") {
    return (
      "`stage` era el plató proscenio y se retiró con la vista que lo pintaba: una escena necesita " +
      "`tile` {tx,ty}, la única variante de Format D (mundo continuo, pídela con generate_tile)"
    );
  }
  if (clave === "style_ref") {
    return (
      "`style_ref` de escena está retirado (no existe catálogo world.style_refs.scene): " +
      "quítalo. Para guiar el arte usa `surface_ref` por cara de volumen y `style_ref` en los NPCs"
    );
  }
  if (clave === "__expanded") {
    return (
      "`__expanded` es la marca interna del expander: una escena emitida no la lleva — " +
      "quítala y declara `biome` + primitivas; el engine expande y marca él"
    );
  }
  return mensajeDeCampoRetirado(clave);
}

/** Mensaje de la clave de raíz desconocida — el espejo de `entityErrorMap` un
 *  nivel más arriba, con la lista de campos de la población que toca
 *  (`campos`). Va por `errorMap` y no en un `superRefine` porque con
 *  `.strict()` la clave desconocida es SIEMPRE el primer issue, y
 *  `formatError` solo enseña ese: un motivo que viva más abajo no llega al
 *  motor. Las retiradas llevan su motivo propio; las demás, la lista. */
function sceneErrorMap(campos: readonly string[]): z.ZodErrorMap {
  return (issue, ctx) => {
    if (issue.code !== z.ZodIssueCode.unrecognized_keys) return { message: ctx.defaultError };
    const partes: string[] = [];
    const desconocidas: string[] = [];
    for (const k of issue.keys) {
      const motivo = motivoDeClaveRetirada(k);
      if (motivo === null) desconocidas.push(k);
      else partes.push(motivo);
    }
    if (desconocidas.length > 0) {
      const una = desconocidas.length === 1;
      partes.push(
        `la escena trae ${una ? "la clave" : "las claves"} ${desconocidas.map((k) => `\`${k}\``).join(", ")}, ` +
          `que no existe${una ? "" : "n"} en el contrato. Una escena tiene EXACTAMENTE estos campos: ` +
          `${campos.join(" | ")}. Lo que quisieras contar del lugar va en \`scene_description\``,
      );
    }
    return { message: partes.join("; ") };
  };
}

/** Lo que el motor EMITE (pre-expansión) — el gate del pre-flight MCP, cuyo
 *  error vuelve al modelo. Sus reglas describen al MODELO: un tile no lleva
 *  `size` ni grid `terrain`, y `style_ref` de escena está retirada. NO
 *  describen lo que hay en disco: los snapshots de los juegos (world/tile.json) son
 *  POST-expansión y llevan las tres cosas legítimamente — eso lo vigila
 *  `ExpandedSceneSchema`, y confundirlas rompe el arranque (#237). */
export const EmittedSceneSchema = z
  .object(sceneBaseShape, { errorMap: sceneErrorMap(EMITTED_SCENE_FIELDS) })
  .strict()
  .superRefine((s, ctx) => {
    refineScatter(s, ctx);
    // CANDADO de las variantes retiradas: Format D tiene UNA forma y ninguna
    // más. Sin `tile` la escena era la "suelta" (size/terrain a elección del
    // motor, sin sitio en el mundo) o el `stage` proscenio. El error va en la
    // RAÍZ: el pre-flight de narrative-mcp se lo devuelve al modelo para que
    // re-responda con la que toca.
    if (s.tile === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message:
          "una escena necesita `tile` {tx,ty}: es la única variante de Format D " +
          "(mundo continuo, pídela con generate_tile)",
      });
      return;
    }
    // Un tile NO lleva size/terrain (la base es biome + primitivas; el engine
    // sintetiza el grid). Es exactamente lo que prepareTileBase exige.
    if (s.size !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["size"], message: "un tile no lleva `size` (la base es `biome` + primitivas)" });
    }
    if (Array.isArray(s.terrain) && s.terrain.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["terrain"], message: "un tile no lleva grid `terrain` completo (usa `biome` + `ground`/`volumes`)" });
    }
    if (s.biome === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["biome"], message: "un tile necesita `biome`" });
    }
    // `style_ref` de escena y `__expanded` NO se rebotan aquí: con `.strict()`
    // ya son claves desconocidas, y su motivo lo pone `sceneErrorMap`.
  });

export type EmittedScene = z.infer<typeof EmittedSceneSchema>;

/** Lo que el juego CARGA (post-expansión) — la otra población, la que vive en
 *  el `world/tile.json` de cada juego y entra por `loadWorldSnapshot`.
 *
 *  Hasta #237 no tenía tipo ninguno (`z.record(z.string(), z.unknown())` en
 *  `WorldSnapshotSchema.scenes`), y como el único schema de escena que existía
 *  describía la población CONTRARIA, apuntarlo a los snapshots rechazaba 20 de
 *  20 y dejaba al juego sin mundo pre-generado. Por eso aquí:
 *
 *  - Se EXIGE lo que escribe `expandScenePrimitives` y sin lo cual el cliente
 *    no puede colisionar: `size`, `terrain` no vacío y la marca `__expanded`,
 *    que es la frontera y ya existía en el dato desde siempre.
 *  - NO se re-litiga la FORMA del modelo (un tile cargado lleva `size` y
 *    `terrain` legítimamente). Lo que sí se rebota es lo RETIRADO, por
 *    `.strict()` como en la emitida: un save o snapshot anterior a una
 *    retirada trae el campo dentro, y con `.passthrough()` viviría para
 *    siempre en `scene_data` y volvería al motor por `serializeForLlm`.
 *    Pre-producción: el save se borra o se regenera, y el mensaje lo dice.
 *
 *  Dos tipos con nombre y no una variante con flag: con un flag, un consumidor
 *  puede preguntar por la población equivocada y seguir compilando. */
export const ExpandedSceneSchema = z
  .object({
    ...sceneBaseShape,
    size: SceneSizeSchema,
    terrain: z.array(z.string()).min(1),
    /** La frontera, y la escribe `expandScenePrimitives` (scene-expand.ts).
     *  `z.literal(true)` y no `z.boolean()`: una escena a medio expandir no es
     *  una escena cargable. */
    __expanded: z.literal(true),
  }, { errorMap: sceneErrorMap([...SCENE_FIELDS, "__expanded"]) })
  .strict();

export type ExpandedScene = z.infer<typeof ExpandedSceneSchema>;
