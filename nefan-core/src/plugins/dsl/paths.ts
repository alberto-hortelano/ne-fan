/** Paths del DSL (next.md §7.2): dot-notation contra un scope de raíces
 *  conocidas, con interpolación `{...}`, indexación `[i]` y comodín `[*]`.
 *
 *  Lectura laxa: un path que no resuelve devuelve `undefined` (los predicados
 *  deciden). Escritura estricta: interpolaciones deben resolver, `[*]` está
 *  prohibido, y los contenedores intermedios se validan.
 */
import { DslError } from "./errors.js";

/** Raíces válidas del contexto de evaluación. `_`, `entity` y `acc` son
 *  variables de iteración (map/filter/reduce y projections). */
export const CONTEXT_ROOTS: ReadonlySet<string> = new Set([
  "event",
  "slice",
  "world",
  "player",
  "entities",
  "plugins",
  "_",
  "entity",
  "acc",
]);

/** Scope de evaluación: valor por raíz. Las raíces ausentes resuelven a
 *  undefined en lectura. */
export type DslScope = Record<string, unknown>;

export type PathSegment =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" }
  | { kind: "interp"; path: PathAst };

export interface PathAst {
  root: string;
  segments: PathSegment[];
  /** Texto original, para diagnósticos. */
  source: string;
}

const KEY_CHARS = /[A-Za-z0-9_$]/;
const MAX_INTERP_DEPTH = 4;

/** Parsea un template de path. Lanza DslError si está malformado o si la raíz
 *  no es una CONTEXT_ROOT (fail-loud ante typos como "playr.gold"). */
export function parsePath(template: string): PathAst {
  const p = new PathParser(template);
  const ast = p.parse();
  if (!CONTEXT_ROOTS.has(ast.root)) {
    throw new DslError(`raíz de path desconocida '${ast.root}'`, template);
  }
  return ast;
}

/** Variante para la regla path-vs-literal de las expresiones: parsea sin
 *  exigir raíz válida (el caller decide si el token es path o literal). */
export function tryParsePathToken(template: string): PathAst | null {
  try {
    return new PathParser(template).parse();
  } catch {
    return null;
  }
}

class PathParser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): PathAst {
    const root = this.readKey();
    if (!root) throw new DslError("path vacío o sin raíz", this.src);
    const segments: PathSegment[] = [];
    while (this.i < this.src.length) {
      const ch = this.src[this.i];
      if (ch === ".") {
        this.i++;
        if (this.src[this.i] === "{") {
          segments.push({ kind: "interp", path: this.readInterp() });
        } else {
          const key = this.readKey();
          if (!key) throw new DslError(`clave vacía tras '.' en posición ${this.i}`, this.src);
          segments.push({ kind: "key", key });
        }
      } else if (ch === "[") {
        this.i++;
        if (this.src[this.i] === "*") {
          this.i++;
          this.expect("]");
          segments.push({ kind: "wildcard" });
        } else {
          const start = this.i;
          while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) this.i++;
          if (this.i === start) {
            throw new DslError(`índice inválido en posición ${start}`, this.src);
          }
          const index = Number(this.src.slice(start, this.i));
          this.expect("]");
          segments.push({ kind: "index", index });
        }
      } else {
        throw new DslError(`carácter inesperado '${ch}' en posición ${this.i}`, this.src);
      }
    }
    return { root, segments, source: this.src };
  }

  private readKey(): string {
    const start = this.i;
    while (this.i < this.src.length && KEY_CHARS.test(this.src[this.i])) this.i++;
    return this.src.slice(start, this.i);
  }

  private readInterp(): PathAst {
    // this.src[this.i] === "{"
    const start = ++this.i;
    let depth = 1;
    while (this.i < this.src.length && depth > 0) {
      if (this.src[this.i] === "{") depth++;
      else if (this.src[this.i] === "}") depth--;
      if (depth > 0) this.i++;
    }
    if (depth !== 0) throw new DslError("interpolación '{' sin cerrar", this.src);
    const inner = this.src.slice(start, this.i);
    this.i++; // consume '}'
    return parsePath(inner);
  }

  private expect(ch: string): void {
    if (this.src[this.i] !== ch) {
      throw new DslError(`se esperaba '${ch}' en posición ${this.i}`, this.src);
    }
    this.i++;
  }
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/** Resuelve un path en lectura. Paths inexistentes ⇒ undefined. `[*]` mapea
 *  los elementos (array) o valores (objeto) a través del resto del path,
 *  descartando los que resuelven a undefined; wildcards anidados producen
 *  arrays anidados (sin aplanado implícito). */
export function resolveRead(scope: DslScope, ast: PathAst, depth = 0): unknown {
  if (depth > MAX_INTERP_DEPTH) {
    throw new DslError(`interpolación demasiado profunda (>${MAX_INTERP_DEPTH})`, ast.source);
  }
  return walk(scope[ast.root], ast.segments, 0);

  function walk(value: unknown, segs: PathSegment[], si: number): unknown {
    if (si >= segs.length) return value;
    const seg = segs[si];
    if (value === null || value === undefined) return undefined;
    switch (seg.kind) {
      case "key":
        return walk(member(value, seg.key), segs, si + 1);
      case "index":
        return Array.isArray(value) ? walk(value[seg.index], segs, si + 1) : undefined;
      case "wildcard": {
        const items = Array.isArray(value)
          ? value
          : typeof value === "object"
            ? Object.values(value as Record<string, unknown>)
            : null;
        if (items === null) return undefined;
        return items
          .map((item) => walk(item, segs, si + 1))
          .filter((v) => v !== undefined);
      }
      case "interp": {
        const key = resolveRead(scope, seg.path, depth + 1);
        if (typeof key !== "string" && typeof key !== "number") {
          throw new DslError(
            `la interpolación '{${seg.path.source}}' no resolvió a string/number`,
            ast.source,
          );
        }
        const next =
          typeof key === "number" && Array.isArray(value) ? value[key] : member(value, String(key));
        return walk(next, segs, si + 1);
      }
    }
  }
}

function member(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

// ── Escritura ───────────────────────────────────────────────────────────────

export interface ConcretePath {
  root: string;
  segs: Array<string | number>;
  /** Forma canónica para logs y ExternalWrite: "player.gold",
   *  "slice.markets.blacksmith_01.stock.iron_sword", "entities[2].data.hp". */
  canonical: string;
}

/** Concretiza un path de escritura: interpolaciones resueltas a claves,
 *  `[*]` prohibido (DslError). */
export function concretizeWritePath(scope: DslScope, ast: PathAst): ConcretePath {
  const segs: Array<string | number> = [];
  for (const seg of ast.segments) {
    switch (seg.kind) {
      case "key":
        segs.push(seg.key);
        break;
      case "index":
        segs.push(seg.index);
        break;
      case "wildcard":
        throw new DslError("'[*]' no está permitido en paths de escritura", ast.source);
      case "interp": {
        const key = resolveRead(scope, seg.path);
        if (typeof key !== "string" && typeof key !== "number") {
          throw new DslError(
            `la interpolación '{${seg.path.source}}' no resolvió a string/number`,
            ast.source,
          );
        }
        segs.push(key);
        break;
      }
    }
  }
  return { root: ast.root, segs, canonical: canonicalPath(ast.root, segs) };
}

export function canonicalPath(root: string, segs: Array<string | number>): string {
  return root + segs.map((s) => (typeof s === "number" ? `[${s}]` : `.${s}`)).join("");
}

/** ¿Cubre el path declarado (reads/writes del manifest) al path concreto?
 *  El declarado debe ser prefijo; sus segmentos wildcard/interp casan con
 *  cualquier segmento concreto. */
export function declaredCovers(declared: PathAst, concrete: ConcretePath): boolean {
  if (declared.root !== concrete.root) return false;
  if (declared.segments.length > concrete.segs.length) return false;
  return declared.segments.every((seg, i) => {
    const c = concrete.segs[i];
    switch (seg.kind) {
      case "key":
        return c === seg.key;
      case "index":
        return c === seg.index;
      case "wildcard":
      case "interp":
        return true;
    }
  });
}

export function getAt(scope: DslScope, path: ConcretePath): unknown {
  let cur: unknown = scope[path.root];
  for (const seg of path.segs) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === "number") {
      cur = Array.isArray(cur) ? cur[seg] : undefined;
    } else {
      cur = member(cur, seg);
    }
  }
  return cur;
}

/** Escribe creando objetos intermedios para claves ausentes. Un índice
 *  numérico exige array existente y posición ≤ length (DslError si no). */
export function setAt(scope: DslScope, path: ConcretePath, value: unknown): void {
  if (path.segs.length === 0) {
    throw new DslError("no se puede sobrescribir una raíz entera", path.canonical);
  }
  let cur: unknown = scope[path.root];
  if (cur === null || typeof cur !== "object") {
    throw new DslError(`la raíz '${path.root}' no es un contenedor`, path.canonical);
  }
  for (let i = 0; i < path.segs.length - 1; i++) {
    cur = descendForWrite(cur, path.segs[i], path);
  }
  const last = path.segs[path.segs.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(cur)) {
      throw new DslError("índice numérico sobre un no-array", path.canonical);
    }
    if (last > cur.length) {
      throw new DslError(`índice ${last} fuera de rango (length ${cur.length})`, path.canonical);
    }
    cur[last] = value;
  } else {
    (cur as Record<string, unknown>)[last] = value;
  }
}

function descendForWrite(cur: unknown, seg: string | number, path: ConcretePath): unknown {
  if (typeof seg === "number") {
    if (!Array.isArray(cur)) {
      throw new DslError("índice numérico sobre un no-array", path.canonical);
    }
    const next = cur[seg];
    if (next === null || typeof next !== "object") {
      throw new DslError(`elemento [${seg}] inexistente o no-contenedor`, path.canonical);
    }
    return next;
  }
  const obj = cur as Record<string, unknown>;
  let next = obj[seg];
  if (next === undefined) {
    next = {};
    obj[seg] = next;
  }
  if (next === null || typeof next !== "object") {
    throw new DslError(`segmento '${seg}' no es un contenedor`, path.canonical);
  }
  return next;
}

/** Borra la clave (objetos) o hace splice del índice (arrays). Path
 *  inexistente ⇒ no-op (borrar lo que no está no es un error). */
export function deleteAt(scope: DslScope, path: ConcretePath): void {
  if (path.segs.length === 0) {
    throw new DslError("no se puede borrar una raíz entera", path.canonical);
  }
  let cur: unknown = scope[path.root];
  for (let i = 0; i < path.segs.length - 1; i++) {
    const seg = path.segs[i];
    if (cur === null || cur === undefined) return;
    cur = typeof seg === "number" ? (Array.isArray(cur) ? cur[seg] : undefined) : member(cur, seg);
  }
  if (cur === null || cur === undefined) return;
  const last = path.segs[path.segs.length - 1];
  if (typeof last === "number") {
    if (Array.isArray(cur) && last < cur.length) cur.splice(last, 1);
  } else if (typeof cur === "object" && !Array.isArray(cur)) {
    delete (cur as Record<string, unknown>)[last];
  }
}
