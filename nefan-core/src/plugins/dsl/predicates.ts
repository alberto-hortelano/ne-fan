/** Predicados del DSL (next.md §7.2): {op, path, value} combinables con
 *  all/any/not. Comparaciones numéricas estrictas (no-número ⇒ DslError,
 *  fail-loud); eq/neq/in usan igualdad estructural. */
import type { Predicate } from "../types.js";
import { deepEqual } from "./deep-equal.js";
import { DslError } from "./errors.js";
import { parsePath, resolveRead, type DslScope } from "./paths.js";
import { evalValue, newEvalState, type EvalState } from "./values.js";

export function evalPredicate(
  scope: DslScope,
  p: Predicate,
  state: EvalState = newEvalState(),
): boolean {
  if ("all" in p) return p.all.every((sub) => evalPredicate(scope, sub, state));
  if ("any" in p) return p.any.some((sub) => evalPredicate(scope, sub, state));
  if ("not" in p) return !evalPredicate(scope, p.not, state);

  const actual = resolveRead(scope, parsePath(p.path));

  if (p.op === "has") return actual !== undefined;

  if (p.value === undefined) {
    throw new DslError(`el predicado '${p.op}' requiere 'value'`, p.path);
  }
  const expected = evalValue(scope, p.value, state);

  switch (p.op) {
    case "eq":
      return deepEqual(actual, expected);
    case "neq":
      return !deepEqual(actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (actual === undefined) return false; // path ausente: no compara
      if (typeof actual !== "number" || typeof expected !== "number") {
        throw new DslError(`'${p.op}' compara números (got ${typeof actual}/${typeof expected})`, p.path);
      }
      switch (p.op) {
        case "gt":
          return actual > expected;
        case "gte":
          return actual >= expected;
        case "lt":
          return actual < expected;
        case "lte":
          return actual <= expected;
      }
      break;
    }
    case "in": {
      if (!Array.isArray(expected)) {
        throw new DslError("'in' requiere que value resuelva a un array", p.path);
      }
      return expected.some((item) => deepEqual(actual, item));
    }
    case "matches": {
      if (typeof expected !== "string") {
        throw new DslError("'matches' requiere un patrón string", p.path);
      }
      if (actual === undefined || actual === null) return false;
      return new RegExp(expected).test(String(actual));
    }
  }
  throw new DslError(`operador de predicado desconocido '${(p as { op: string }).op}'`, p.path);
}
