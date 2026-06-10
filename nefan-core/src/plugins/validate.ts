/** Validación estática de manifests (base para el loader F3 y plugin_register
 *  F5). Comprueba lo decidible sin estado:
 *  - todos los paths y expresiones parsean;
 *  - lecturas fuera de slice/event/vars de iteración cubiertas por `reads`
 *    (a nivel de raíz: reads es una declaración de intención, no el boundary
 *    de seguridad);
 *  - escrituras fuera de slice cubiertas por `writes` (a nivel de segmento,
 *    con interpolaciones como comodín — la autorización concreta se repite en
 *    runtime, effects.ts);
 *  - emit_event.type ⊆ events_produced.
 *  La volatilidad del seed de random() no se chequea aquí (queda para F5);
 *  el eval-time ya exige que el seed sea un path. */
import type { Effect, PluginManifest, Predicate, ValueExpr } from "./types.js";
import { parsePath, type PathAst, type PathSegment } from "./dsl/paths.js";
import { parseStringExpr } from "./dsl/values.js";

/** Raíces que no requieren declaración en `reads`: el slice propio, el evento
 *  en curso y las variables de iteración. */
const FREE_READ_ROOTS = new Set(["slice", "event", "_", "entity", "acc"]);

export function validateManifestStatic(manifest: PluginManifest): string[] {
  const errors: string[] = [];

  const declaredReadRoots = new Set<string>();
  for (const r of manifest.reads) {
    const ast = tryParse(r, `reads '${r}'`, errors);
    if (ast) declaredReadRoots.add(ast.root);
  }
  const declaredWrites: PathAst[] = [];
  for (const w of manifest.writes) {
    const ast = tryParse(w, `writes '${w}'`, errors);
    if (ast) declaredWrites.push(ast);
  }
  const produced = new Set(manifest.events_produced);

  function checkReadPath(ast: PathAst, where: string): void {
    if (!FREE_READ_ROOTS.has(ast.root) && !declaredReadRoots.has(ast.root)) {
      errors.push(`${where}: lee '${ast.source}' pero '${ast.root}' no está cubierto por reads`);
    }
    for (const seg of ast.segments) {
      if (seg.kind === "interp") checkReadPath(seg.path, where);
    }
  }

  function walkValue(expr: ValueExpr, where: string): void {
    if (expr === null || typeof expr === "number" || typeof expr === "boolean") return;
    if (typeof expr === "string") {
      const parsed = parseStringExpr(expr);
      if (parsed) {
        for (const ref of parsed.pathRefs) checkReadPath(ref, where);
      }
      return; // literal o expresión; ambos válidos
    }
    if (Array.isArray(expr)) {
      for (const e of expr) walkValue(e, where);
      return;
    }
    const obj = expr as Record<string, ValueExpr>;
    const keys = Object.keys(obj);
    if ("$lit" in obj) return;
    if (keys.length === 2 && "map" in obj && "to" in obj && typeof obj.map === "string") {
      const src = tryParse(obj.map, `${where} map`, errors);
      if (src) checkReadPath(src, where);
      walkValue(obj.to, where);
      return;
    }
    if (keys.length === 2 && "filter" in obj && "where" in obj && typeof obj.filter === "string") {
      const src = tryParse(obj.filter, `${where} filter`, errors);
      if (src) checkReadPath(src, where);
      walkPredicate(obj.where as unknown as Predicate, where);
      return;
    }
    if (keys.length === 3 && "reduce" in obj && "init" in obj && "with" in obj && typeof obj.reduce === "string") {
      const src = tryParse(obj.reduce, `${where} reduce`, errors);
      if (src) checkReadPath(src, where);
      walkValue(obj.init, where);
      walkValue(obj.with, where);
      return;
    }
    for (const k of keys) walkValue(obj[k], where);
  }

  function walkPredicate(p: Predicate, where: string): void {
    if ("all" in p) return p.all.forEach((sub) => walkPredicate(sub, where));
    if ("any" in p) return p.any.forEach((sub) => walkPredicate(sub, where));
    if ("not" in p) return walkPredicate(p.not, where);
    const ast = tryParse(p.path, `${where} predicado '${p.op}'`, errors);
    if (ast) checkReadPath(ast, where);
    if (p.value !== undefined) walkValue(p.value, where);
  }

  function walkEffect(e: Effect, where: string): void {
    if (e.op === "emit_event") {
      if (!produced.has(e.value.type)) {
        errors.push(`${where}: emit_event '${e.value.type}' no está en events_produced`);
      }
      walkValue(e.value.payload, where);
      return;
    }
    const ast = tryParse(e.path, `${where} efecto '${e.op}'`, errors);
    if (!ast) return;
    for (const seg of ast.segments) {
      if (seg.kind === "interp") checkReadPath(seg.path, where);
    }
    if (ast.root !== "slice" && !declaredWrites.some((d) => staticCovers(d, ast))) {
      errors.push(`${where}: escribe '${e.path}' fuera de slice sin cobertura en writes`);
    }
    if (e.op !== "remove") walkValue(e.value, where);
  }

  manifest.events_consumed.forEach((entry, i) => {
    const where = `events_consumed[${i}] (${entry.type})`;
    if (entry.when) walkPredicate(entry.when, where);
    entry.do.forEach((e) => walkEffect(e, where));
  });

  manifest.projections.forEach((projection, i) => {
    const where = `projections[${i}]`;
    const src = tryParse(projection.source, `${where} source`, errors);
    if (src) checkReadPath(src, where);
    if (projection.rule.filter) walkPredicate(projection.rule.filter, where);
    const setAst = tryParse(projection.rule.for_each.set, `${where} for_each.set`, errors);
    if (setAst) {
      if (setAst.root !== "slice") {
        errors.push(`${where}: for_each.set debe escribir en slice.* (got '${setAst.root}')`);
      }
      for (const seg of setAst.segments) {
        if (seg.kind === "interp") checkReadPath(seg.path, where);
      }
    }
    walkValue(projection.rule.for_each.value, where);
  });

  manifest.derived_views.forEach((view, i) => {
    walkValue(view.rule, `derived_views[${i}] (${view.name})`);
  });

  if (manifest.migrate) {
    for (const [from, effects] of Object.entries(manifest.migrate)) {
      effects.forEach((e) => walkEffect(e, `migrate[${from}]`));
    }
  }

  return errors;
}

function tryParse(template: string, where: string, errors: string[]): PathAst | null {
  try {
    return parsePath(template);
  } catch (err) {
    errors.push(`${where}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** ¿Cubre el write declarado al path (posiblemente con interpolaciones) de un
 *  efecto, decidido estáticamente? Interp/wildcard en cualquiera de los dos
 *  lados casa con cualquier segmento; la comprobación concreta se repite en
 *  runtime. */
function staticCovers(declared: PathAst, effect: PathAst): boolean {
  if (declared.root !== effect.root) return false;
  if (declared.segments.length > effect.segments.length) return false;
  return declared.segments.every((d, i) => segMatches(d, effect.segments[i]));
}

function segMatches(declared: PathSegment, effect: PathSegment): boolean {
  if (declared.kind === "wildcard" || declared.kind === "interp") return true;
  if (effect.kind === "wildcard" || effect.kind === "interp") return true;
  if (declared.kind === "key" && effect.kind === "key") return declared.key === effect.key;
  if (declared.kind === "index" && effect.kind === "index") return declared.index === effect.index;
  return false;
}
