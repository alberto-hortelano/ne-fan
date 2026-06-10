/** Efectos del DSL (next.md §7.2): set/inc/dec/mul/push/pull/remove sobre el
 *  scope (que el caller ya clonó) + emit_event al sink.
 *
 *  Semántica SECUENCIAL: el efecto N+1 ve las escrituras del efecto N — el
 *  ejemplo commerce depende de ello (el emit_event lee el slice ya mutado).
 *
 *  Autorización de escritura: `slice.*` siempre; cualquier otra raíz sólo si
 *  el path concreto está cubierto por una entrada de `writes` del manifest
 *  (amendment a §7.5 — el dispatcher de F4 aplica una whitelist adicional).
 */
import type { Effect } from "../types.js";
import { deepEqual } from "./deep-equal.js";
import { DslError } from "./errors.js";
import {
  concretizeWritePath,
  declaredCovers,
  deleteAt,
  getAt,
  parsePath,
  setAt,
  type ConcretePath,
  type DslScope,
  type PathAst,
} from "./paths.js";
import { evalValue, newEvalState, type EvalState } from "./values.js";

export interface EmittedEvent {
  type: string;
  payload: unknown;
}

export interface EffectSink {
  emittedEvents: EmittedEvent[];
  /** Paths externos (raíz ≠ slice) tocados, por forma canónica. El caller lee
   *  el valor final al terminar todos los efectos. */
  externalPaths: Map<string, ConcretePath>;
}

export function newEffectSink(): EffectSink {
  return { emittedEvents: [], externalPaths: new Map() };
}

export interface WriteAuth {
  /** Entradas de manifest.writes ya parseadas. */
  writes: PathAst[];
  eventsProduced: ReadonlySet<string>;
}

export function applyEffect(
  scope: DslScope,
  effect: Effect,
  auth: WriteAuth,
  sink: EffectSink,
  state: EvalState = newEvalState(),
): void {
  if (effect.op === "emit_event") {
    if (!auth.eventsProduced.has(effect.value.type)) {
      throw new DslError(
        `emit_event '${effect.value.type}' no está declarado en events_produced`,
      );
    }
    sink.emittedEvents.push({
      type: effect.value.type,
      payload: evalValue(scope, effect.value.payload, state),
    });
    return;
  }

  const cp = concretizeWritePath(scope, parsePath(effect.path));
  if (cp.root !== "slice" && !auth.writes.some((d) => declaredCovers(d, cp))) {
    throw new DslError(`escritura no autorizada (falta en 'writes')`, cp.canonical);
  }

  switch (effect.op) {
    case "set":
      setAt(scope, cp, evalValue(scope, effect.value, state));
      break;
    case "inc":
    case "dec":
    case "mul": {
      const current = getAt(scope, cp);
      if (typeof current !== "number") {
        throw new DslError(`'${effect.op}' sobre un valor no numérico (${typeof current})`, cp.canonical);
      }
      const operand = evalValue(scope, effect.value, state);
      if (typeof operand !== "number" || !Number.isFinite(operand)) {
        throw new DslError(`'${effect.op}' con operando no numérico`, cp.canonical);
      }
      const next =
        effect.op === "inc" ? current + operand : effect.op === "dec" ? current - operand : current * operand;
      setAt(scope, cp, next);
      break;
    }
    case "push": {
      const target = getAt(scope, cp);
      if (!Array.isArray(target)) {
        throw new DslError("'push' sobre un no-array", cp.canonical);
      }
      target.push(evalValue(scope, effect.value, state));
      break;
    }
    case "pull": {
      const target = getAt(scope, cp);
      if (!Array.isArray(target)) {
        throw new DslError("'pull' sobre un no-array", cp.canonical);
      }
      const needle = evalValue(scope, effect.value, state);
      for (let i = target.length - 1; i >= 0; i--) {
        if (deepEqual(target[i], needle)) target.splice(i, 1);
      }
      break;
    }
    case "remove":
      deleteAt(scope, cp);
      break;
  }

  if (cp.root !== "slice") {
    sink.externalPaths.set(cp.canonical, cp);
  }
}
