/** Fachada del intérprete del DSL — API pública de F2 (next.md §7.8).
 *
 * Todo es PURO: las funciones clonan el contexto de entrada, evalúan sobre el
 * clon y devuelven el resultado; jamás tocan NarrativeState ni el contexto
 * original. El caller (dispatcher F4 / loader F3) decide qué commitear.
 */
import type {
  DerivedView,
  EventConsumedEntry,
  PluginFixture,
  PluginManifest,
} from "../types.js";
import { deepEqual } from "./deep-equal.js";
import { DslError } from "./errors.js";
import {
  applyEffect,
  newEffectSink,
  type EmittedEvent,
  type WriteAuth,
} from "./effects.js";
import {
  concretizeWritePath,
  getAt,
  parsePath,
  resolveRead,
  setAt,
  type DslScope,
} from "./paths.js";
import { evalPredicate } from "./predicates.js";
import { evalValue, MAX_ITERATIONS, newEvalState } from "./values.js";

export type { EmittedEvent } from "./effects.js";

/** Contexto de evaluación de un plugin. `slice` es el del propio plugin;
 *  `plugins` mapea id → slice de otros plugins (sólo lectura, §7.3). */
export interface DslContext {
  event?: Record<string, unknown>;
  slice: unknown;
  world?: unknown;
  player?: unknown;
  entities?: unknown[];
  plugins?: Record<string, unknown>;
}

export interface ExternalWrite {
  /** Path canónico concreto fuera del slice, p. ej. "player.gold". */
  path: string;
  /** Valor FINAL en ese path tras aplicar todos los efectos de la entry. */
  value: unknown;
}

export interface EventOutcome {
  /** Resultado del `when`; si es false, el resto está vacío y el slice intacto. */
  matched: boolean;
  slice: unknown;
  /** Clon completo del contexto tras los efectos (para encadenar entries). */
  context: DslContext;
  externalWrites: ExternalWrite[];
  emittedEvents: EmittedEvent[];
}

/** Autorización derivada del manifest, parseada una vez por tick. */
export function manifestAuth(manifest: PluginManifest): WriteAuth {
  return {
    writes: manifest.writes.map((w) => parsePath(w)),
    eventsProduced: new Set(manifest.events_produced),
  };
}

function scopeFromContext(ctx: DslContext): DslScope {
  return {
    event: ctx.event,
    slice: ctx.slice,
    world: ctx.world,
    player: ctx.player,
    entities: ctx.entities,
    plugins: ctx.plugins,
  };
}

/** Ejecuta una entrada de events_consumed (when → do) sobre un clon del
 *  contexto. Lanza DslError si algún efecto es inválido o no autorizado. */
export function runEventEntry(
  entry: EventConsumedEntry,
  ctx: DslContext,
  auth: WriteAuth,
): EventOutcome {
  const work = structuredClone(ctx);
  const scope = scopeFromContext(work);

  if (entry.when && !evalPredicate(scope, entry.when)) {
    return { matched: false, slice: work.slice, context: work, externalWrites: [], emittedEvents: [] };
  }

  const sink = newEffectSink();
  for (const effect of entry.do) {
    applyEffect(scope, effect, auth, sink);
  }

  // Valor final de cada path externo tocado, leído tras TODOS los efectos.
  const externalWrites: ExternalWrite[] = [...sink.externalPaths.values()].map((cp) => ({
    path: cp.canonical,
    value: getAt(scope, cp),
  }));

  return {
    matched: true,
    slice: work.slice,
    context: work,
    externalWrites,
    emittedEvents: sink.emittedEvents,
  };
}

/** Ejecuta las projections del manifest para poblar el slice inicial desde el
 *  estado pre-existente (génesis, §7.3 paso 4). Devuelve el slice poblado. */
export function runProjections(
  manifest: PluginManifest,
  ctx: Omit<DslContext, "slice">,
): unknown {
  const work = structuredClone(ctx) as DslContext;
  work.slice = structuredClone(manifest.slice.initial);
  const scope = scopeFromContext(work);

  for (const projection of manifest.projections) {
    const items = resolveRead(scope, parsePath(projection.source));
    if (!Array.isArray(items)) {
      throw new DslError("la fuente de la projection no resolvió a un array", projection.source);
    }
    if (items.length > MAX_ITERATIONS) {
      throw new DslError(`projection sobre ${items.length} elementos (cap ${MAX_ITERATIONS})`, projection.source);
    }
    const setAst = parsePath(projection.rule.for_each.set);
    if (setAst.root !== "slice") {
      throw new DslError("projections sólo escriben en slice.*", projection.rule.for_each.set);
    }
    for (const item of items) {
      // `entity` por legibilidad en manifests, `_` por consistencia con map/filter.
      const child: DslScope = { ...scope, entity: item, _: item };
      if (projection.rule.filter && !evalPredicate(child, projection.rule.filter)) continue;
      const value = evalValue(child, projection.rule.for_each.value);
      const cp = concretizeWritePath(child, setAst);
      setAt(child, cp, value);
    }
  }
  return work.slice;
}

/** Evalúa una derived_view (read-only). Base de serializeForLlm en F6. */
export function runDerivedView(view: DerivedView, ctx: DslContext): unknown {
  return evalValue(scopeFromContext(structuredClone(ctx)), view.rule);
}

export interface FixtureResult {
  ok: boolean;
  expected: unknown;
  actual: unknown;
  error?: string;
}

/** Replay determinista de una fixture (§7.3 paso 3): aplica en orden todas
 *  las entries cuyo type coincide con el del evento, encadenando el contexto,
 *  y compara el slice final con `after`. Es el mecanismo de validación de
 *  manifests que usan el loader (F3) y plugin_register (F5). */
export function replayFixture(manifest: PluginManifest, fixture: PluginFixture): FixtureResult {
  const auth = manifestAuth(manifest);
  let ctx: DslContext = {
    event: fixture.event,
    slice: structuredClone(fixture.before),
    ...structuredClone(fixture.context ?? {}),
  };
  try {
    for (const entry of manifest.events_consumed) {
      if (entry.type !== fixture.event.type) continue;
      const out = runEventEntry(entry, ctx, auth);
      ctx = out.context;
    }
    const ok = deepEqual(ctx.slice, fixture.after);
    return {
      ok,
      expected: fixture.after,
      actual: ctx.slice,
      ...(ok ? {} : { error: "el slice final no coincide con fixture.after" }),
    };
  } catch (err) {
    return {
      ok: false,
      expected: fixture.after,
      actual: undefined,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
