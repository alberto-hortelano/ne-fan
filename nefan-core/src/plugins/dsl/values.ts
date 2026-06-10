/** Expresiones de valor del DSL (next.md §7.2).
 *
 * Un string es una expresión si tokeniza y parsea con la gramática de abajo Y
 * todos sus paths tienen raíz válida (CONTEXT_ROOTS). Si no, es un literal
 * string tal cual — regla path-vs-literal determinista:
 *   "merchant"      → literal (raíz 'merchant' no es CONTEXT_ROOT)
 *   "event.price"   → path
 *   "'event.price'" → literal forzado con comillas simples
 *   { $lit: ... }   → literal JSON arbitrario
 *
 * Gramática (recursive descent):
 *   expr   := term (('+'|'-') term)*
 *   term   := factor (('*'|'/') factor)*
 *   factor := number | 'quoted' | call | path | '-' factor | '(' expr ')'
 *   call   := fn '(' expr (',' expr)* ')'   con fn ∈ FUNCTIONS
 *
 * random(seed_path, low, high) es determinista: seed = sha256(canonicalJson
 * (valor en seed_path)) → SeededRng. Sin Date.now ni Math.random (§7.5).
 */
import { createHash } from "node:crypto";

import { SeededRng } from "../../combat/enemy-ai.js";
import { canonicalJson } from "../hash.js";
import type { Predicate, ValueExpr } from "../types.js";
import { DslError } from "./errors.js";
import {
  CONTEXT_ROOTS,
  parsePath,
  resolveRead,
  tryParsePathToken,
  type DslScope,
  type PathAst,
} from "./paths.js";
import { evalPredicate } from "./predicates.js";

export const MAX_ITERATIONS = 10_000;
export const MAX_NESTING = 3;

const FUNCTIONS = new Set(["min", "max", "clamp", "len", "concat", "coalesce", "random"]);

export interface EvalState {
  /** Profundidad de anidamiento map/filter/reduce. */
  nesting: number;
}

export function newEvalState(): EvalState {
  return { nesting: 0 };
}

// ── Parser de expresiones string ────────────────────────────────────────────

type ExprNode =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "path"; ast: PathAst }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; l: ExprNode; r: ExprNode }
  | { t: "neg"; e: ExprNode }
  | { t: "call"; fn: string; args: ExprNode[] };

interface ParsedExpr {
  node: ExprNode;
  pathRefs: PathAst[];
}

/** Resultado del análisis de un string: `expr` presente si el string es una
 *  expresión evaluable; null ⇒ el string es un literal. */
const parseCache = new Map<string, ParsedExpr | null>();

export function parseStringExpr(src: string): ParsedExpr | null {
  if (parseCache.has(src)) return parseCache.get(src) ?? null;
  let result: ParsedExpr | null;
  try {
    const p = new ExprParser(src);
    const node = p.parseExpr();
    p.expectEnd();
    result = p.invalidRoot ? null : { node, pathRefs: p.pathRefs };
  } catch {
    result = null;
  }
  parseCache.set(src, result);
  return result;
}

type Token =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "word"; v: string } // path/ident/keyword, con [..] y {..} balanceados
  | { k: "op"; v: string }; // + - * / ( ) ,

class ExprParser {
  private tokens: Token[];
  private i = 0;
  pathRefs: PathAst[] = [];
  /** true si algún token-bare tiene raíz fuera de CONTEXT_ROOTS ⇒ el string
   *  entero se trata como literal. */
  invalidRoot = false;

  constructor(src: string) {
    this.tokens = tokenize(src);
    if (this.tokens.length === 0) throw new DslError("expresión vacía", src);
  }

  parseExpr(): ExprNode {
    let left = this.parseTerm();
    while (this.peekOp("+") || this.peekOp("-")) {
      const op = (this.next() as { k: "op"; v: "+" | "-" }).v;
      left = { t: "bin", op, l: left, r: this.parseTerm() };
    }
    return left;
  }

  private parseTerm(): ExprNode {
    let left = this.parseFactor();
    while (this.peekOp("*") || this.peekOp("/")) {
      const op = (this.next() as { k: "op"; v: "*" | "/" }).v;
      left = { t: "bin", op, l: left, r: this.parseFactor() };
    }
    return left;
  }

  private parseFactor(): ExprNode {
    const tok = this.peek();
    if (!tok) throw new DslError("expresión truncada");
    if (tok.k === "num") {
      this.next();
      return { t: "num", v: tok.v };
    }
    if (tok.k === "str") {
      this.next();
      return { t: "str", v: tok.v };
    }
    if (tok.k === "op" && tok.v === "-") {
      this.next();
      return { t: "neg", e: this.parseFactor() };
    }
    if (tok.k === "op" && tok.v === "(") {
      this.next();
      const inner = this.parseExpr();
      this.expectOp(")");
      return inner;
    }
    if (tok.k === "word") {
      this.next();
      if (tok.v === "true") return { t: "bool", v: true };
      if (tok.v === "false") return { t: "bool", v: false };
      if (tok.v === "null") return { t: "null" };
      if (FUNCTIONS.has(tok.v) && this.peekOp("(")) {
        this.next();
        const args: ExprNode[] = [this.parseExpr()];
        while (this.peekOp(",")) {
          this.next();
          args.push(this.parseExpr());
        }
        this.expectOp(")");
        return { t: "call", fn: tok.v, args };
      }
      const ast = tryParsePathToken(tok.v);
      if (!ast) throw new DslError(`token inválido '${tok.v}'`);
      if (!CONTEXT_ROOTS.has(ast.root)) {
        this.invalidRoot = true;
        // Nodo placeholder; el caller descarta el parse al ver invalidRoot.
        return { t: "str", v: tok.v };
      }
      this.pathRefs.push(ast);
      return { t: "path", ast };
    }
    throw new DslError(`token inesperado '${tok.v}'`);
  }

  expectEnd(): void {
    if (this.i < this.tokens.length) {
      throw new DslError("tokens sobrantes al final de la expresión");
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }
  private peekOp(v: string): boolean {
    const t = this.tokens[this.i];
    return t !== undefined && t.k === "op" && t.v === v;
  }
  private next(): Token {
    return this.tokens[this.i++];
  }
  private expectOp(v: string): void {
    if (!this.peekOp(v)) throw new DslError(`se esperaba '${v}'`);
    this.i++;
  }
}

const WORD_START = /[A-Za-z_$]/;
const WORD_CHAR = /[A-Za-z0-9_$.]/;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      if (src[i] === "." && /[0-9]/.test(src[i + 1] ?? "")) {
        i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      out.push({ k: "num", v: Number(src.slice(start, i)) });
      continue;
    }
    if (ch === "'") {
      const start = ++i;
      while (i < src.length && src[i] !== "'") i++;
      if (i >= src.length) throw new DslError("string sin cerrar", src);
      out.push({ k: "str", v: src.slice(start, i) });
      i++;
      continue;
    }
    if ("+-*/(),".includes(ch)) {
      out.push({ k: "op", v: ch });
      i++;
      continue;
    }
    if (WORD_START.test(ch)) {
      // Word: claves + '.' + grupos balanceados [..] y {..} (donde '*' es
      // parte del token, no multiplicación).
      const start = i;
      while (i < src.length) {
        const c = src[i];
        if (WORD_CHAR.test(c)) {
          i++;
        } else if (c === "[" || c === "{") {
          const close = c === "[" ? "]" : "}";
          let depth = 1;
          i++;
          while (i < src.length && depth > 0) {
            if (src[i] === c) depth++;
            else if (src[i] === close) depth--;
            i++;
          }
          if (depth !== 0) throw new DslError(`grupo '${c}' sin cerrar`, src);
        } else {
          break;
        }
      }
      out.push({ k: "word", v: src.slice(start, i) });
      continue;
    }
    throw new DslError(`carácter inesperado '${ch}'`, src);
  }
  return out;
}

// ── Evaluación ──────────────────────────────────────────────────────────────

export function evalValue(scope: DslScope, expr: ValueExpr, state: EvalState = newEvalState()): unknown {
  if (expr === null || typeof expr === "number" || typeof expr === "boolean") return expr;
  if (typeof expr === "string") {
    const parsed = parseStringExpr(expr);
    if (!parsed) return expr; // literal
    return evalNode(scope, parsed.node, state);
  }
  if (Array.isArray(expr)) {
    return expr.map((e) => evalValue(scope, e, state));
  }
  const obj = expr as Record<string, ValueExpr>;
  const keys = Object.keys(obj);
  if ("$lit" in obj) {
    return structuredClone((obj as { $lit?: unknown }).$lit);
  }
  if (keys.length === 2 && "map" in obj && "to" in obj && typeof obj.map === "string") {
    return evalIteration(scope, obj.map, state, (items, inner) =>
      items.map((item) => evalValue(childScope(scope, item), obj.to, inner)),
    );
  }
  if (keys.length === 2 && "filter" in obj && "where" in obj && typeof obj.filter === "string") {
    const where = obj.where as unknown as Predicate;
    return evalIteration(scope, obj.filter, state, (items, inner) =>
      items.filter((item) => evalPredicate(childScope(scope, item), where, inner)),
    );
  }
  if (
    keys.length === 3 &&
    "reduce" in obj &&
    "init" in obj &&
    "with" in obj &&
    typeof obj.reduce === "string"
  ) {
    return evalIteration(scope, obj.reduce, state, (items, inner) => {
      let acc = evalValue(scope, obj.init, inner);
      for (const item of items) {
        acc = evalValue({ ...childScope(scope, item), acc }, obj.with, inner);
      }
      return acc;
    });
  }
  // Template de objeto
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    result[k] = evalValue(scope, obj[k], state);
  }
  return result;
}

function childScope(scope: DslScope, item: unknown): DslScope {
  return { ...scope, _: item };
}

function evalIteration(
  scope: DslScope,
  sourcePath: string,
  state: EvalState,
  run: (items: unknown[], inner: EvalState) => unknown,
): unknown {
  if (state.nesting + 1 > MAX_NESTING) {
    throw new DslError(`anidamiento de iteración > ${MAX_NESTING}`, sourcePath);
  }
  const items = resolveRead(scope, parsePath(sourcePath));
  if (!Array.isArray(items)) {
    throw new DslError("la fuente de iteración no resolvió a un array", sourcePath);
  }
  if (items.length > MAX_ITERATIONS) {
    throw new DslError(`iteración sobre ${items.length} elementos (cap ${MAX_ITERATIONS})`, sourcePath);
  }
  return run(items, { nesting: state.nesting + 1 });
}

function evalNode(scope: DslScope, node: ExprNode, state: EvalState): unknown {
  switch (node.t) {
    case "num":
    case "str":
    case "bool":
      return node.v;
    case "null":
      return null;
    case "path":
      return resolveRead(scope, node.ast);
    case "neg": {
      const v = evalNode(scope, node.e, state);
      if (typeof v !== "number") throw new DslError("negación de un no-número");
      return -v;
    }
    case "bin": {
      const l = evalNode(scope, node.l, state);
      const r = evalNode(scope, node.r, state);
      if (typeof l !== "number" || typeof r !== "number") {
        throw new DslError(`operandos no numéricos para '${node.op}'`);
      }
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) throw new DslError("división por cero");
          return l / r;
      }
      break;
    }
    case "call":
      return evalCall(scope, node, state);
  }
  throw new DslError("nodo de expresión desconocido");
}

function evalCall(scope: DslScope, node: { fn: string; args: ExprNode[] }, state: EvalState): unknown {
  const { fn, args } = node;
  if (fn === "random") {
    if (args.length !== 3) throw new DslError("random(seed_path, low, high) requiere 3 args");
    if (args[0].t !== "path") {
      throw new DslError("el primer argumento de random debe ser un path (seed estable, §7.5)");
    }
    const seedValue = resolveRead(scope, args[0].ast);
    const low = numArg(scope, args[1], state, "random.low");
    const high = numArg(scope, args[2], state, "random.high");
    if (low > high) throw new DslError("random: low > high");
    const digest = createHash("sha256").update(canonicalJson(seedValue ?? null)).digest();
    const rng = new SeededRng(digest.readUInt32BE(0));
    const r = rng.next();
    if (Number.isInteger(low) && Number.isInteger(high)) {
      return low + Math.floor(r * (high - low + 1));
    }
    return low + r * (high - low);
  }

  const values = args.map((a) => evalNode(scope, a, state));
  switch (fn) {
    case "min":
    case "max": {
      const nums = values.map((v, i) => requireNum(v, `${fn} arg ${i}`));
      return fn === "min" ? Math.min(...nums) : Math.max(...nums);
    }
    case "clamp": {
      if (values.length !== 3) throw new DslError("clamp(x, lo, hi) requiere 3 args");
      const [x, lo, hi] = values.map((v, i) => requireNum(v, `clamp arg ${i}`));
      return Math.min(Math.max(x, lo), hi);
    }
    case "len": {
      if (values.length !== 1) throw new DslError("len(x) requiere 1 arg");
      const v = values[0];
      if (typeof v === "string" || Array.isArray(v)) return v.length;
      if (v !== null && typeof v === "object") return Object.keys(v).length;
      throw new DslError("len: el argumento no es string/array/objeto");
    }
    case "concat": {
      if (values.every((v) => typeof v === "string")) return (values as string[]).join("");
      if (values.every((v) => Array.isArray(v))) return ([] as unknown[]).concat(...(values as unknown[][]));
      throw new DslError("concat: argumentos mixtos (todos strings o todos arrays)");
    }
    case "coalesce": {
      for (const v of values) {
        if (v !== undefined && v !== null) return v;
      }
      return null;
    }
  }
  throw new DslError(`función desconocida '${fn}'`);
}

function numArg(scope: DslScope, node: ExprNode, state: EvalState, label: string): number {
  return requireNum(evalNode(scope, node, state), label);
}

function requireNum(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new DslError(`${label}: se esperaba un número finito`);
  }
  return v;
}
