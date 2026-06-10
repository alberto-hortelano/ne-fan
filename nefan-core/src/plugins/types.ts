/** Plugin system declarativo — tipos y schemas zod del manifest (next.md §7.1).
 *
 * Un plugin es un manifest JSON puro que el intérprete del DSL ejecuta
 * (src/plugins/dsl/). No hay código ejecutable: el techo de expresividad
 * está en §7.2 de next.md.
 *
 * Amendments a la spec original (decididos en la implementación):
 * - `writes: string[]` — §7.5 dice "cada plugin sólo escribe en su slice",
 *   pero el ejemplo commerce de §7.7 hace `dec player.gold`. Resolución: los
 *   efectos pueden escribir en `slice.*` siempre, y en paths externos sólo si
 *   están declarados aquí (validación estática en el loader + runtime en el
 *   dispatcher).
 * - Regla path-vs-literal en strings de ValueExpr: un string es path si su
 *   raíz ∈ CONTEXT_ROOTS (event, slice, world, player, entities, plugins, _,
 *   entity, acc); si no, es literal. `'comillas simples'` fuerza literal;
 *   `{ $lit: ... }` fuerza un literal JSON arbitrario (necesario si un
 *   template de objeto necesita una clave reservada: map/filter/reduce/$lit).
 */
import { z } from "zod";

// ── Origin ──────────────────────────────────────────────────────────────────

export interface PluginOrigin {
  author: "developer" | "narrative_engine";
  session_id?: string;
  triggered_by_event?: string;
  rationale: string;
}

export const PluginOriginSchema: z.ZodType<PluginOrigin> = z
  .object({
    author: z.enum(["developer", "narrative_engine"]),
    session_id: z.string().optional(),
    triggered_by_event: z.string().optional(),
    rationale: z.string(),
  })
  .strict();

// ── DSL: predicados, expresiones de valor y efectos (recursivos) ────────────

export type PredicateOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "has" | "matches";

export type Predicate =
  | { op: PredicateOp; path: string; value?: ValueExpr }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

/** Expresión de valor del DSL. Los strings se parsean con la gramática de
 *  dsl/values.ts (aritmética, llamadas min/max/clamp/len/concat/coalesce/
 *  random, paths). Objetos sin claves reservadas son templates evaluados
 *  recursivamente. */
export type ValueExpr =
  | number
  | boolean
  | null
  | string
  // `$lit?` (no `$lit`) porque z.unknown() infiere la clave como opcional;
  // el evaluador detecta el caso con `"$lit" in obj`.
  | { $lit?: unknown }
  | { map: string; to: ValueExpr }
  | { filter: string; where: Predicate }
  | { reduce: string; init: ValueExpr; with: ValueExpr }
  | ValueExpr[]
  | { [key: string]: ValueExpr };

export type Effect =
  | { op: "set" | "inc" | "dec" | "mul" | "push" | "pull"; path: string; value: ValueExpr }
  | { op: "remove"; path: string }
  | { op: "emit_event"; value: { type: string; payload: ValueExpr } };

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z
      .object({
        op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "has", "matches"]),
        path: z.string().min(1),
        value: ValueExprSchema.optional(),
      })
      .strict(),
    z.object({ all: z.array(PredicateSchema) }).strict(),
    z.object({ any: z.array(PredicateSchema) }).strict(),
    z.object({ not: PredicateSchema }).strict(),
  ]),
);

export const ValueExprSchema: z.ZodType<ValueExpr> = z.lazy(() =>
  z.union([
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.string(),
    z.object({ $lit: z.unknown() }).strict(),
    z.object({ map: z.string().min(1), to: ValueExprSchema }).strict(),
    z.object({ filter: z.string().min(1), where: PredicateSchema }).strict(),
    z
      .object({ reduce: z.string().min(1), init: ValueExprSchema, with: ValueExprSchema })
      .strict(),
    z.array(ValueExprSchema),
    z.record(ValueExprSchema),
  ]),
);

export const EffectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.union([
    z
      .object({
        op: z.enum(["set", "inc", "dec", "mul", "push", "pull"]),
        path: z.string().min(1),
        value: ValueExprSchema,
      })
      .strict(),
    z.object({ op: z.literal("remove"), path: z.string().min(1) }).strict(),
    z
      .object({
        op: z.literal("emit_event"),
        value: z.object({ type: z.string().min(1), payload: ValueExprSchema }).strict(),
      })
      .strict(),
  ]),
);

// ── Bloques del manifest ────────────────────────────────────────────────────

export const EventConsumedEntrySchema = z
  .object({
    type: z.string().min(1),
    when: PredicateSchema.optional(),
    do: z.array(EffectSchema).min(1),
  })
  .strict();
export type EventConsumedEntry = z.infer<typeof EventConsumedEntrySchema>;

export const ProjectionSchema = z
  .object({
    source: z.string().min(1),
    rule: z
      .object({
        filter: PredicateSchema.optional(),
        for_each: z
          .object({ set: z.string().min(1), value: ValueExprSchema })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type Projection = z.infer<typeof ProjectionSchema>;

export const DerivedViewSchema = z
  .object({ name: z.string().min(1), rule: ValueExprSchema })
  .strict();
export type DerivedView = z.infer<typeof DerivedViewSchema>;

export const PluginFixtureSchema = z
  .object({
    before: z.unknown().refine((v) => v !== undefined, "fixture.before es obligatorio"),
    event: z.object({ type: z.string().min(1) }).catchall(z.unknown()),
    context: z.record(z.unknown()).optional(),
    after: z.unknown().refine((v) => v !== undefined, "fixture.after es obligatorio"),
  })
  .strict();
export type PluginFixture = z.infer<typeof PluginFixtureSchema>;

// ── Manifest ────────────────────────────────────────────────────────────────

export const PluginManifestSchema = z
  .object({
    /** Calculado (computePluginId), no escrito a mano. Si el JSON lo trae, el
     *  loader comprueba que coincida con el computado. */
    id: z.string().regex(/^[0-9a-f]{64}$/, "id debe ser sha256 hex").optional(),
    version: z.number().int().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    origin: PluginOriginSchema,
    slice: z
      .object({
        schema: z.record(z.unknown()),
        initial: z.unknown().refine((v) => v !== undefined, "slice.initial es obligatorio"),
      })
      .strict(),
    reads: z.array(z.string().min(1)).default([]),
    writes: z.array(z.string().min(1)).default([]),
    events_consumed: z.array(EventConsumedEntrySchema).default([]),
    events_produced: z.array(z.string().min(1)).default([]),
    projections: z.array(ProjectionSchema).default([]),
    derived_views: z.array(DerivedViewSchema).default([]),
    migrate: z.record(z.string().regex(/^\d+$/), z.array(EffectSchema)).optional(),
    fixtures: z.array(PluginFixtureSchema).default([]),
    /** §7.9 — el bridge avisa cuando el slice rebasa 10× este hint. */
    slice_size_hint: z.number().int().positive().optional(),
  })
  .strict();

/** Manifest normalizado (tras PluginManifestSchema.parse: defaults aplicados).
 *  El hash de computePluginId se calcula SIEMPRE sobre esta forma normalizada,
 *  de modo que omitir `projections` o escribir `"projections": []` produce el
 *  mismo id. */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ── Registro persistido en el save (§7.6) ───────────────────────────────────

export interface PluginRecord {
  /** sha256 del manifest canónico sin `origin` ni `id`. */
  id: string;
  version: number;
  /** Estado vivo del plugin; conforma con manifest.slice.schema. */
  slice: unknown;
  /** Trazabilidad: quién/cuándo/por qué. No participa del hash. */
  origin: PluginOrigin;
  activated_at: string;
  /** Sólo se persiste para plugins generados por la IA
   *  (origin.author === "narrative_engine"); los shipped se releen del FS. */
  manifest?: PluginManifest;
}
