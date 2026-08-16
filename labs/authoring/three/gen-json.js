// Compilador de generadores DECLARATIVOS (JSON puro → función de scatter).
// El motor narrativo no puede emitir código: emite un árbol de primitivas con
// rangos aleatorios por campo. Este módulo lo valida (fail-loud con ruta) y
// lo compila a `(rng, params) => THREE.Group`, compatible con populate() de
// scatter.js. En el juego, la validación sería un schema zod equivalente y el
// rng el SeededRng de nefan-core.
import * as THREE from "three";

const SHAPES = {
  box: ["size"],
  cylinder: ["rTop", "rBottom", "h"],
  cone: ["r", "h"],
  sphere: ["r"],
  icosahedron: ["r"],
};
const PART_KEYS = new Set([
  "shape", "mat", "seg", "repeat", "vars", "pos", "scale",
  "rotX", "rotY", "rotZ", "castShadow", "displace",
  "size", "rTop", "rBottom", "h", "r",
]);

function fail(path, msg) {
  throw new Error(`generador ${path}: ${msg}`);
}

// ---------- validación estructural (espejo del zod propuesto) ----------
function validateValue(v, path) {
  if (typeof v === "number") return;
  if (Array.isArray(v)) {
    if (v.length !== 2 || typeof v[0] !== "number" || typeof v[1] !== "number") {
      fail(path, "un rango es [min, max] numérico");
    }
    return;
  }
  if (v && typeof v === "object") {
    if ("var" in v) return;
    if ("int" in v) return validateValue(v.int, `${path}.int`);
    if ("lerp" in v) {
      if (!Array.isArray(v.lerp) || v.lerp.length !== 2) fail(path, "lerp es [desde, hasta]");
      validateValue(v.lerp[0], `${path}.lerp[0]`);
      validateValue(v.lerp[1], `${path}.lerp[1]`);
      return;
    }
    if ("op" in v) {
      if (!["+", "-", "*", "/"].includes(v.op)) fail(path, `op desconocida '${v.op}'`);
      validateValue(v.a, `${path}.a`);
      validateValue(v.b, `${path}.b`);
      return;
    }
  }
  fail(path, `valor no reconocido: ${JSON.stringify(v)}`);
}

function validateSpec(spec, name) {
  if (!spec.parts || !Array.isArray(spec.parts) || spec.parts.length === 0) {
    fail(name, "necesita parts[] no vacío");
  }
  for (const [k, v] of Object.entries(spec.vars ?? {})) validateValue(v, `${name}.vars.${k}`);
  for (const [k, m] of Object.entries(spec.materials ?? {})) {
    if (typeof m.color !== "string") fail(`${name}.materials.${k}`, "falta color '#hex'");
  }
  spec.parts.forEach((p, i) => {
    const path = `${name}.parts[${i}]`;
    if (!(p.shape in SHAPES)) fail(path, `shape '${p.shape}' no es ${Object.keys(SHAPES).join("|")}`);
    if (p.mat !== undefined && !(spec.materials ?? {})[p.mat]) fail(path, `mat '${p.mat}' no declarado`);
    for (const key of Object.keys(p)) {
      if (!PART_KEYS.has(key)) fail(path, `campo desconocido '${key}'`);
    }
    for (const req of SHAPES[p.shape]) {
      if (p[req] === undefined) fail(path, `${p.shape} requiere '${req}'`);
    }
    for (const key of ["pos", "scale", "size"]) {
      if (p[key] !== undefined) {
        if (!Array.isArray(p[key]) || p[key].length !== 3) fail(path, `${key} es [x,y,z]`);
        p[key].forEach((c, ci) => validateValue(c, `${path}.${key}[${ci}]`));
      }
    }
    for (const key of ["rTop", "rBottom", "h", "r", "rotX", "rotY", "rotZ", "displace"]) {
      if (p[key] !== undefined) validateValue(p[key], `${path}.${key}`);
    }
    if (p.repeat !== undefined) validateValue(p.repeat.count, `${path}.repeat.count`);
    for (const [k, v] of Object.entries(p.vars ?? {})) validateValue(v, `${path}.vars.${k}`);
  });
}

// ---------- evaluación ----------
function evalV(v, ctx) {
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v[0] + ctx.rng() * (v[1] - v[0]);
  if ("var" in v) {
    if (!(v.var in ctx.vars)) fail(ctx.name, `var '${v.var}' no definida`);
    return ctx.vars[v.var];
  }
  if ("int" in v) {
    const [a, b] = v.int;
    return a + Math.floor(ctx.rng() * (b - a + 0.9999));
  }
  if ("lerp" in v) {
    if (!("t" in ctx.vars)) fail(ctx.name, "lerp solo dentro de repeat");
    return evalV(v.lerp[0], ctx) * (1 - ctx.vars.t) + evalV(v.lerp[1], ctx) * ctx.vars.t;
  }
  const a = evalV(v.a, ctx), b = evalV(v.b, ctx);
  switch (v.op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? fail(ctx.name, "división por cero") : a / b;
  }
}

function buildGeometry(p, ctx) {
  switch (p.shape) {
    case "box":
      return new THREE.BoxGeometry(evalV(p.size[0], ctx), evalV(p.size[1], ctx), evalV(p.size[2], ctx));
    case "cylinder":
      return new THREE.CylinderGeometry(evalV(p.rTop, ctx), evalV(p.rBottom, ctx), evalV(p.h, ctx), p.seg ?? 8);
    case "cone":
      return new THREE.ConeGeometry(evalV(p.r, ctx), evalV(p.h, ctx), p.seg ?? 7);
    case "sphere":
      return new THREE.SphereGeometry(evalV(p.r, ctx), p.seg ?? 7, Math.max(4, (p.seg ?? 7) - 2));
    case "icosahedron": {
      const geo = new THREE.IcosahedronGeometry(evalV(p.r, ctx), 0);
      if (p.displace) {
        const pos = geo.attributes.position;
        for (let v = 0; v < pos.count; v++) {
          pos.setXYZ(v,
            pos.getX(v) * evalV(p.displace, ctx),
            pos.getY(v) * evalV(p.displace, ctx),
            pos.getZ(v) * evalV(p.displace, ctx));
        }
        geo.computeVertexNormals();
      }
      return geo;
    }
  }
}

/** Compila {kind: spec} → {kind: (rng, params) => Group} validando primero. */
export function compileGenerators(specs) {
  const out = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (name.startsWith("_")) continue;
    validateSpec(spec, name);
    out[name] = (rng) => {
      const ctx = { rng, name, vars: {} };
      for (const [k, v] of Object.entries(spec.vars ?? {})) ctx.vars[k] = evalV(v, ctx);
      const mats = {};
      for (const [k, m] of Object.entries(spec.materials ?? {})) {
        const col = new THREE.Color(m.color);
        if (m.hslJitter) {
          col.offsetHSL(
            (rng() - 0.5) * m.hslJitter[0],
            (rng() - 0.5) * m.hslJitter[1],
            (rng() - 0.5) * m.hslJitter[2]);
        }
        mats[k] = new THREE.MeshStandardMaterial({
          color: col, roughness: m.roughness ?? 1, flatShading: m.flat ?? false,
        });
      }
      const defaultMat = new THREE.MeshStandardMaterial({ color: "#888888", roughness: 1 });
      const g = new THREE.Group();
      for (const p of spec.parts) {
        const count = p.repeat ? Math.max(1, Math.round(evalV(p.repeat.count, ctx))) : 1;
        for (let i = 0; i < count; i++) {
          if (p.repeat) {
            ctx.vars.i = i;
            ctx.vars.count = count;
            ctx.vars.t = count > 1 ? i / (count - 1) : 0;
          }
          for (const [k, v] of Object.entries(p.vars ?? {})) ctx.vars[k] = evalV(v, ctx);
          const mesh = new THREE.Mesh(buildGeometry(p, ctx), p.mat ? mats[p.mat] : defaultMat);
          if (p.pos) mesh.position.set(evalV(p.pos[0], ctx), evalV(p.pos[1], ctx), evalV(p.pos[2], ctx));
          if (p.scale) mesh.scale.set(evalV(p.scale[0], ctx), evalV(p.scale[1], ctx), evalV(p.scale[2], ctx));
          if (p.rotX) mesh.rotation.x = evalV(p.rotX, ctx);
          if (p.rotY) mesh.rotation.y = evalV(p.rotY, ctx);
          if (p.rotZ) mesh.rotation.z = evalV(p.rotZ, ctx);
          mesh.castShadow = p.castShadow ?? true;
          g.add(mesh);
        }
        if (p.repeat) { delete ctx.vars.i; delete ctx.vars.count; delete ctx.vars.t; }
      }
      return g;
    };
  }
  return out;
}
