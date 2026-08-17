/** Scatter procedural DECLARATIVO del tile (vista fps) — lógica pura.
 *
 *  Port del patrón validado en labs/authoring (runs 002/003): el motor
 *  narrativo NO coloca elementos uno a uno ni usa un catálogo — declara
 *  (a) `scatter_generators`: una función generadora por tipo como JSON puro
 *  (árbol de primitivas con rangos aleatorios; espejo de gen-json.js), y
 *  (b) `scatter_zones`: zonas con densidad. Este módulo valida FAIL-LOUD con
 *  ruta exacta (patrón PluginManifestSchema), compila cada generador a prims
 *  y puebla las zonas con muestreo estratificado determinista (SeededRng).
 *
 *  Unidades: CELDAS del tile (1 celda = 0.5 m), como ground/volumes; la
 *  densidad de zona se declara en elementos/m² (área celda = 0.25 m²).
 *  Convención de prims: `pos[1]` es la BASE de la pieza (como todo el
 *  greybox — OJO, difiere del bench labs, que usaba centros de three).
 *
 *  Las prims resultantes van SIN celda de atlas (cat "decor" → clay con los
 *  colores del generador + hslJitter): coste de imagen 0. Sin colisión en v1
 *  (decorado); las zonas excluyen automáticamente huellas de volúmenes,
 *  agua, decks y caminos. */

import { seededRng, type SeededRng } from "../../rng.js";
import { shapeContains } from "./ground-collision.js";
import { volumeFootprint } from "./footprint.js";
import type { GroundFeature } from "./ground.js";
import type { Volume } from "./volumes.js";
import type { SurfacePrim } from "../greybox/surfaces.js";

/** Tope duro de instancias por tile (perf: cada instancia son 1-6 meshes).
 *  Lo recortado se reporta en counts (regla no-silent-caps). */
export const MAX_SCATTER_INSTANCES = 240;
const MAX_GENERATORS = 8;
const MAX_PARTS = 10;
const MAX_REPEAT = 14;
const MAX_ZONES = 12;
const MAX_DENSITY = 1.5;

// ── Gramática de valores (espejo 1:1 de labs/authoring/three/gen-json.js) ──
// number | [min,max] | {var} | {int:[a,b]} | {op:"+|-|*|/",a,b} | {lerp:[a,b]}

export type ScatterValue = number | [number, number] | Record<string, unknown>;

const SHAPES: Record<string, string[]> = {
  box: ["size"],
  cylinder: ["rTop", "rBottom", "h"],
  cone: ["r", "h"],
  sphere: ["r"],
};
const PART_KEYS = new Set([
  "shape", "mat", "seg", "repeat", "vars", "pos", "scale",
  "rotX", "rotY", "rotZ", "size", "rTop", "rBottom", "h", "r",
]);
const MAT_KEYS = new Set(["color", "hslJitter", "roughness"]);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

class ScatterError extends Error {}

function fail(path: string, msg: string): never {
  throw new ScatterError(`${path}: ${msg}`);
}

function validateValue(v: unknown, path: string): void {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) fail(path, "número no finito");
    return;
  }
  if (Array.isArray(v)) {
    if (v.length !== 2 || typeof v[0] !== "number" || typeof v[1] !== "number") {
      fail(path, "un rango es [min, max] numérico");
    }
    return;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("var" in o) {
      if (typeof o.var !== "string") fail(path, "var debe ser un nombre");
      return;
    }
    if ("int" in o) return validateValue(o.int, `${path}.int`);
    if ("lerp" in o) {
      if (!Array.isArray(o.lerp) || o.lerp.length !== 2) fail(path, "lerp es [desde, hasta]");
      validateValue(o.lerp[0], `${path}.lerp[0]`);
      validateValue(o.lerp[1], `${path}.lerp[1]`);
      return;
    }
    if ("op" in o) {
      if (!["+", "-", "*", "/"].includes(o.op as string)) fail(path, `op desconocida '${String(o.op)}'`);
      validateValue(o.a, `${path}.a`);
      validateValue(o.b, `${path}.b`);
      return;
    }
  }
  fail(path, `valor no reconocido: ${JSON.stringify(v)}`);
}

interface GeneratorSpec {
  vars?: Record<string, unknown>;
  materials?: Record<string, { color: string; hslJitter?: [number, number, number]; roughness?: number }>;
  parts: Record<string, unknown>[];
}

function validateGenerator(spec: unknown, name: string): asserts spec is GeneratorSpec {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail(name, "un generador es un objeto {vars?, materials?, parts}");
  const s = spec as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    if (!["vars", "materials", "parts"].includes(key)) fail(name, `campo desconocido '${key}'`);
  }
  if (!Array.isArray(s.parts) || s.parts.length === 0) fail(name, "necesita parts[] no vacío");
  if (s.parts.length > MAX_PARTS) fail(name, `demasiadas parts (${s.parts.length} > ${MAX_PARTS})`);
  for (const [k, v] of Object.entries((s.vars as Record<string, unknown>) ?? {})) {
    validateValue(v, `${name}.vars.${k}`);
  }
  const materials = (s.materials as Record<string, Record<string, unknown>>) ?? {};
  for (const [k, m] of Object.entries(materials)) {
    if (!m || typeof m !== "object") fail(`${name}.materials.${k}`, "un material es {color, hslJitter?, roughness?}");
    for (const mk of Object.keys(m)) {
      if (!MAT_KEYS.has(mk)) fail(`${name}.materials.${k}`, `campo desconocido '${mk}'`);
    }
    if (typeof m.color !== "string" || !HEX_RE.test(m.color)) fail(`${name}.materials.${k}`, "falta color '#hex'");
    if (m.hslJitter !== undefined && (!Array.isArray(m.hslJitter) || m.hslJitter.length !== 3 || m.hslJitter.some((j) => typeof j !== "number"))) {
      fail(`${name}.materials.${k}`, "hslJitter es [h, s, l] numérico");
    }
  }
  (s.parts as Record<string, unknown>[]).forEach((p, i) => {
    const path = `${name}.parts[${i}]`;
    const shape = p.shape as string;
    if (!(shape in SHAPES)) fail(path, `shape '${String(p.shape)}' no es ${Object.keys(SHAPES).join("|")}`);
    if (p.mat !== undefined && !materials[p.mat as string]) fail(path, `mat '${String(p.mat)}' no declarado`);
    for (const key of Object.keys(p)) {
      if (!PART_KEYS.has(key)) fail(path, `campo desconocido '${key}'`);
    }
    for (const req of SHAPES[shape]) {
      if (p[req] === undefined) fail(path, `${shape} requiere '${req}'`);
    }
    if (p.seg !== undefined) {
      if (shape !== "cone" && shape !== "sphere") fail(path, "seg solo en cone|sphere");
      if (typeof p.seg !== "number" || p.seg < 3 || p.seg > 24) fail(path, "seg es un número 3..24");
    }
    for (const key of ["pos", "scale", "size"]) {
      if (p[key] !== undefined) {
        if (!Array.isArray(p[key]) || (p[key] as unknown[]).length !== 3) fail(path, `${key} es [x, y, z]`);
        (p[key] as unknown[]).forEach((c, ci) => validateValue(c, `${path}.${key}[${ci}]`));
      }
    }
    for (const key of ["rTop", "rBottom", "h", "r", "rotX", "rotY", "rotZ"]) {
      if (p[key] !== undefined) validateValue(p[key], `${path}.${key}`);
    }
    if (p.repeat !== undefined) {
      const rep = p.repeat as Record<string, unknown>;
      if (!rep || typeof rep !== "object" || rep.count === undefined) fail(path, "repeat es {count}");
      for (const rk of Object.keys(rep)) if (rk !== "count") fail(path, `repeat solo admite 'count' (no '${rk}')`);
      validateValue(rep.count, `${path}.repeat.count`);
    }
    for (const [k, v] of Object.entries((p.vars as Record<string, unknown>) ?? {})) {
      validateValue(v, `${path}.vars.${k}`);
    }
  });
}

// ── Zonas ──

export interface ScatterZone {
  kind: string;
  shape:
    | { type: "rect"; x0: number; z0: number; x1: number; z1: number }
    | { type: "ellipse"; cx: number; cz: number; rx: number; rz: number }
    | { type: "poly"; pts: [number, number][] };
  /** Elementos por m² (área de celda = 0.25 m²). */
  density: number;
  seed?: number;
}

function num(v: unknown, path: string, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) {
    fail(path, `número ${lo}..${hi} requerido (tiene ${JSON.stringify(v)})`);
  }
  return v;
}

function validateZone(raw: unknown, generators: Record<string, GeneratorSpec>, path: string): ScatterZone {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(path, "una zona es {kind, shape, density, seed?}");
  const z = raw as Record<string, unknown>;
  for (const key of Object.keys(z)) {
    if (!["kind", "shape", "density", "seed"].includes(key)) fail(path, `campo desconocido '${key}'`);
  }
  if (typeof z.kind !== "string" || !(z.kind in generators)) {
    fail(path, `kind '${String(z.kind)}' sin generador en scatter_generators`);
  }
  const density = num(z.density, `${path}.density`, 0, MAX_DENSITY);
  if (z.seed !== undefined) num(z.seed, `${path}.seed`, 0, 1e9);
  const s = z.shape as Record<string, unknown>;
  if (!s || typeof s !== "object") fail(`${path}.shape`, "shape es rect|ellipse|poly");
  let shape: ScatterZone["shape"];
  if (s.type === "rect") {
    shape = {
      type: "rect",
      x0: num(s.x0, `${path}.shape.x0`, -16, 144),
      z0: num(s.z0, `${path}.shape.z0`, -16, 144),
      x1: num(s.x1, `${path}.shape.x1`, -16, 144),
      z1: num(s.z1, `${path}.shape.z1`, -16, 144),
    };
    if (shape.x1 <= shape.x0 || shape.z1 <= shape.z0) fail(`${path}.shape`, "rect vacío (x1<=x0 o z1<=z0)");
  } else if (s.type === "ellipse") {
    shape = {
      type: "ellipse",
      cx: num(s.cx, `${path}.shape.cx`, -16, 144),
      cz: num(s.cz, `${path}.shape.cz`, -16, 144),
      rx: num(s.rx, `${path}.shape.rx`, 0.5, 96),
      rz: num(s.rz, `${path}.shape.rz`, 0.5, 96),
    };
  } else if (s.type === "poly") {
    if (!Array.isArray(s.pts) || s.pts.length < 3 || s.pts.length > 24) fail(`${path}.shape.pts`, "poly necesita 3..24 puntos");
    const pts = (s.pts as unknown[]).map((p, i) => {
      if (!Array.isArray(p) || p.length !== 2) fail(`${path}.shape.pts[${i}]`, "un punto es [col, row]");
      return [num(p[0], `${path}.shape.pts[${i}][0]`, -16, 144), num(p[1], `${path}.shape.pts[${i}][1]`, -16, 144)] as [number, number];
    });
    shape = { type: "poly", pts };
  } else {
    fail(`${path}.shape`, `type '${String(s.type)}' no es rect|ellipse|poly`);
  }
  return { kind: z.kind, shape, density, seed: z.seed as number | undefined };
}

export type ParseScatterResult =
  | { ok: true; generators: Record<string, GeneratorSpec>; zones: ScatterZone[] }
  | { ok: false; error: string };

/** Valida `scatter_generators` + `scatter_zones` (fail-loud con ruta exacta). */
export function parseScatter(rawGenerators: unknown, rawZones: unknown): ParseScatterResult {
  try {
    if (!rawGenerators || typeof rawGenerators !== "object" || Array.isArray(rawGenerators)) {
      fail("scatter_generators", "debe ser un objeto {nombre: generador}");
    }
    const generators = rawGenerators as Record<string, GeneratorSpec>;
    const names = Object.keys(generators);
    if (names.length === 0) fail("scatter_generators", "vacío");
    if (names.length > MAX_GENERATORS) fail("scatter_generators", `demasiados generadores (${names.length} > ${MAX_GENERATORS})`);
    for (const name of names) validateGenerator(generators[name], `scatter_generators.${name}`);
    if (!Array.isArray(rawZones) || rawZones.length === 0) fail("scatter_zones", "debe ser un array no vacío");
    if (rawZones.length > MAX_ZONES) fail("scatter_zones", `demasiadas zonas (${rawZones.length} > ${MAX_ZONES})`);
    const zones = rawZones.map((z, i) => validateZone(z, generators, `scatter_zones[${i}]`));
    return { ok: true, generators, zones };
  } catch (err) {
    if (err instanceof ScatterError) return { ok: false, error: err.message };
    throw err;
  }
}

// ── Evaluación ──

interface EvalCtx {
  rng: SeededRng;
  name: string;
  vars: Record<string, number>;
}

function evalV(v: unknown, ctx: EvalCtx): number {
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v[0] + ctx.rng.next() * (v[1] - v[0]);
  const o = v as Record<string, unknown>;
  if ("var" in o) {
    const name = o.var as string;
    if (!(name in ctx.vars)) fail(ctx.name, `var '${name}' no definida`);
    return ctx.vars[name];
  }
  if ("int" in o) {
    const r = o.int;
    if (typeof r === "number") return Math.round(r);
    const [a, b] = r as [number, number];
    return a + Math.floor(ctx.rng.next() * (b - a + 0.9999));
  }
  if ("lerp" in o) {
    if (!("t" in ctx.vars)) fail(ctx.name, "lerp solo dentro de repeat");
    const l = o.lerp as [unknown, unknown];
    return evalV(l[0], ctx) * (1 - ctx.vars.t) + evalV(l[1], ctx) * ctx.vars.t;
  }
  const a = evalV(o.a, ctx);
  const b = evalV(o.b, ctx);
  switch (o.op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? fail(ctx.name, "división por cero") : a / b;
    default: return fail(ctx.name, `op '${String(o.op)}'`);
  }
}

/** #rrggbb + jitter HSL determinista → #rrggbb. */
function jitterColor(hex: string, jitter: [number, number, number] | undefined, rng: SeededRng): string {
  if (!jitter) return hex;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const h2 = (h + (rng.next() - 0.5) * jitter[0] + 1) % 1;
  const s2 = Math.min(1, Math.max(0, s + (rng.next() - 0.5) * jitter[1]));
  const l2 = Math.min(1, Math.max(0, l + (rng.next() - 0.5) * jitter[2]));
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h2 * 6) % 2) - 1));
  const m = l2 - c / 2;
  const seg = Math.floor(h2 * 6);
  const [rr, gg, bb] =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x]
    : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(rr)}${to(gg)}${to(bb)}`;
}

/** Prims de UNA instancia del generador, relativas al origen de la instancia
 *  (y en base 0), escaladas por `s` y rotadas `rot` alrededor del origen. */
function instancePrims(
  name: string,
  spec: GeneratorSpec,
  rng: SeededRng,
  s: number,
  rot: number,
): SurfacePrim[] {
  const ctx: EvalCtx = { rng, name, vars: {} };
  for (const [k, v] of Object.entries(spec.vars ?? {})) ctx.vars[k] = evalV(v, ctx);
  const colors: Record<string, string> = {};
  const rough: Record<string, number | undefined> = {};
  for (const [k, m] of Object.entries(spec.materials ?? {})) {
    colors[k] = jitterColor(m.color, m.hslJitter, rng);
    rough[k] = m.roughness;
  }
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const out: SurfacePrim[] = [];
  for (const p of spec.parts) {
    const rep = p.repeat as { count: unknown } | undefined;
    const count = rep ? Math.min(MAX_REPEAT, Math.max(1, Math.round(evalV(rep.count, ctx)))) : 1;
    for (let i = 0; i < count; i++) {
      if (rep) {
        ctx.vars.i = i;
        ctx.vars.count = count;
        ctx.vars.t = count > 1 ? i / (count - 1) : 0;
      }
      for (const [k, v] of Object.entries((p.vars as Record<string, unknown>) ?? {})) {
        ctx.vars[k] = evalV(v, ctx);
      }
      const pos3 = (p.pos as unknown[]) ?? [0, 0, 0];
      const [ox, oy, oz] = [evalV(pos3[0], ctx) * s, evalV(pos3[1], ctx) * s, evalV(pos3[2], ctx) * s];
      const shape = p.shape as "box" | "cylinder" | "cone" | "sphere";
      let size: number[];
      if (shape === "box") {
        const sz = p.size as unknown[];
        size = [evalV(sz[0], ctx) * s, evalV(sz[1], ctx) * s, evalV(sz[2], ctx) * s];
      } else if (shape === "cylinder") {
        size = [evalV(p.rBottom, ctx) * s, evalV(p.h, ctx) * s, evalV(p.rTop, ctx) * s];
      } else if (shape === "cone") {
        size = [evalV(p.r, ctx) * s, evalV(p.h, ctx) * s, (p.seg as number) ?? 7];
      } else {
        size = [evalV(p.r, ctx) * s, (p.seg as number) ?? 8];
      }
      const prim: SurfacePrim = {
        shape,
        size,
        // Offset rotado alrededor del origen de la instancia (mismo convenio
        // rotOff/rotY que volume-prims).
        pos: [ox * ca + oz * sa, oy, -ox * sa + oz * ca],
        color: p.mat ? colors[p.mat as string] : "#888888",
        cat: "decor",
      };
      const roughness = p.mat ? rough[p.mat as string] : undefined;
      if (roughness !== undefined) prim.roughness = roughness;
      const rotY = (p.rotY !== undefined ? evalV(p.rotY, ctx) : 0) + rot;
      if (rotY) prim.rotY = rotY;
      if (p.rotX !== undefined) prim.rotX = evalV(p.rotX, ctx);
      if (p.rotZ !== undefined) prim.rotZ = evalV(p.rotZ, ctx);
      if (p.scale !== undefined) {
        const sc = p.scale as unknown[];
        prim.scale = [evalV(sc[0], ctx), evalV(sc[1], ctx), evalV(sc[2], ctx)];
      }
      out.push(prim);
      if (rep) {
        delete ctx.vars.i;
        delete ctx.vars.count;
        delete ctx.vars.t;
      }
    }
  }
  return out;
}

// ── Muestreo de zonas ──

type Shape = ScatterZone["shape"];

function bounds(sh: Shape): { x0: number; z0: number; x1: number; z1: number } {
  if (sh.type === "rect") return { x0: sh.x0, z0: sh.z0, x1: sh.x1, z1: sh.z1 };
  if (sh.type === "ellipse") return { x0: sh.cx - sh.rx, z0: sh.cz - sh.rz, x1: sh.cx + sh.rx, z1: sh.cz + sh.rz };
  const xs = sh.pts.map((p) => p[0]);
  const zs = sh.pts.map((p) => p[1]);
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
}

function contains(sh: Shape, x: number, z: number): boolean {
  if (sh.type === "rect") return x >= sh.x0 && x <= sh.x1 && z >= sh.z0 && z <= sh.z1;
  if (sh.type === "ellipse") {
    const dx = (x - sh.cx) / sh.rx;
    const dz = (z - sh.cz) / sh.rz;
    return dx * dx + dz * dz <= 1;
  }
  let inside = false;
  const p = sh.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) {
      inside = !inside;
    }
  }
  return inside;
}

function areaCells(sh: Shape): number {
  if (sh.type === "rect") return (sh.x1 - sh.x0) * (sh.z1 - sh.z0);
  if (sh.type === "ellipse") return Math.PI * sh.rx * sh.rz;
  let a = 0;
  const p = sh.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  }
  return Math.abs(a / 2);
}

/** Distancia punto→segmento al cuadrado (exclusión de caminos). */
function segDist2(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-9;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
  const px = ax + dx * t;
  const pz = az + dz * t;
  return (x - px) * (x - px) + (z - pz) * (z - pz);
}

/** Predicado de exclusión automática: huellas de volúmenes (+margen) y
 *  agua/decks/caminos del ground. El scatter jamás pisa lo construido.
 *  `opts.areas` incluye también los parches de material (kind area) — los usa
 *  el RELIEVE fps para aplanar plazas/huertos; el scatter los permite. */
export function buildScatterExclusions(
  volumes: Volume[],
  ground: GroundFeature[],
  opts?: { areas?: boolean },
): (x: number, z: number) => boolean {
  const rects = volumes.map((v) => {
    const [x0, z0, x1, z1] = volumeFootprint(v).cells;
    return [x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5] as [number, number, number, number];
  });
  // `hill` es relieve, no ocupación: el scatter puede poblar una loma y el
  // relieve fps no debe aplanarse sobre ella.
  const shaped = ground.filter((f) => f.kind !== "path" && f.kind !== "hill");
  const paths = ground.filter((f) => f.kind === "path");
  return (x, z) => {
    for (const [x0, z0, x1, z1] of rects) {
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
    }
    for (const f of shaped) {
      if (f.kind === "area" && !opts?.areas) continue; // parches de material: scatter permitido
      if (shapeContains(f as never, x, z)) return true;
    }
    for (const f of paths) {
      const w = ((f as { w?: number }).w ?? 4) / 2 + 0.5;
      const pts = (f as { points: [number, number][] }).points;
      for (let i = 0; i + 1 < pts.length; i++) {
        if (segDist2(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < w * w) return true;
      }
    }
    return false;
  };
}

export interface ScatterCount {
  kind: string;
  wanted: number;
  placed: number;
}

export interface ScatterRunResult {
  prims: SurfacePrim[];
  counts: ScatterCount[];
}

/** Puebla las zonas: rejilla estratificada con jitter (determinista por
 *  seedKey+zona), hundimiento leve y rotación/escala por instancia. */
export function runScatter(
  generators: Record<string, GeneratorSpec>,
  zones: ScatterZone[],
  opts: { seedKey: string; excluded?: (x: number, z: number) => boolean },
): ScatterRunResult {
  const excluded = opts.excluded ?? (() => false);
  const prims: SurfacePrim[] = [];
  const counts: ScatterCount[] = [];
  let total = 0;
  zones.forEach((zone, zi) => {
    const spec = generators[zone.kind];
    const rng = seededRng(`${opts.seedKey}:scatter:${zi}:${zone.seed ?? 0}`);
    const b = bounds(zone.shape);
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    // densidad en elem/m²; el área de zona está en celdas² (0.25 m² cada una).
    const wanted = Math.round(areaCells(zone.shape) * 0.25 * zone.density);
    const cols = Math.max(1, Math.round(Math.sqrt(wanted * (w / Math.max(d, 1e-6)))));
    const rows = Math.max(1, Math.ceil(wanted / cols));
    let placed = 0;
    for (let r = 0; r < rows && placed < wanted; r++) {
      for (let c = 0; c < cols && placed < wanted; c++) {
        const x = b.x0 + ((c + rng.next()) / cols) * w;
        const z = b.z0 + ((r + rng.next()) / rows) * d;
        if (!contains(zone.shape, x, z)) continue;
        if (excluded(x, z)) continue;
        if (total >= MAX_SCATTER_INSTANCES) break;
        const s = 0.8 + rng.next() * 0.45;
        const rot = rng.next() * Math.PI * 2;
        const sink = 0.16;
        for (const prim of instancePrims(zone.kind, spec, rng, s, rot)) {
          prim.pos = [prim.pos[0] + x, prim.pos[1] - sink, prim.pos[2] + z];
          prims.push(prim);
        }
        placed++;
        total++;
      }
    }
    counts.push({ kind: zone.kind, wanted, placed });
  });
  return { prims, counts };
}
