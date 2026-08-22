// Escena "nueva" del bench FPS: plan autorado por el MOTOR NARRATIVO
// (plan.json: ermita + río con puente + molino, formato declarativo del juego)
// y convertido con el builder real (dump_spec.ts → spec.json). Mismo patrón de
// carga que escenas/exterior/escena.mjs (celdas → metros ×0.5 + delantal).

export const meta = {
  name: "nueva",
  description:
    "Ermita románica junto a un río con puente de tablones: campanario, ábside, tapia del " +
    "camposanto, molino de agua con su rueda, huerto de frutales y camino que cruza el vado.",
};

export const env = {
  sky: { top: "#8db4d6", bottom: "#d8cfb4" },
  fog: { color: "#d8cfb4", near: 25, far: 90 },
};

const M = 0.5; // metros por celda

function scalePrim(p) {
  const q = { ...p, pos: p.pos.map((v) => v * M), size: p.size.map((v) => v * M) };
  if (p.points) q.points = p.points.map(([x, z]) => [x * M, z * M]);
  if (p.shape === "cylinder" || p.shape === "cone" || p.shape === "sphere") {
    // size[2] de cylinder es rTop (escala); el de cone son segmentos (no).
    if (p.shape === "cone" && p.size[2] !== undefined) q.size[2] = p.size[2];
    if (p.shape === "sphere" && p.size[1] !== undefined) q.size[1] = p.size[1];
  }
  return q;
}

async function readSpec() {
  if (typeof window === "undefined") {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "spec.json"), "utf-8"));
  }
  const res = await fetch(new URL("./spec.json", import.meta.url));
  if (!res.ok) throw new Error(`spec.json: HTTP ${res.status}`);
  return res.json();
}

// Hitos (metros): ermita [14..24]×[6..13] con portal al sur, atrio empedrado
// delante, campanario (25,7), ábside al norte, tapia camposanto al oeste,
// puente x 38..48 z 29..34 sobre el río, molino [48..55]×[35..41] con rueda
// en su pared oeste, huerto de frutales al SO.
export const playerStart = { pos: [10, 33], yawIdx: 2 };

export const poses = [
  { id: "p0", pos: [10, 33], yawIdx: 2, note: "camino oeste hacia el puente" },
  { id: "p1", pos: [19.5, 22], yawIdx: 0, note: "atrio: la ermita de frente" },
  { id: "p2", pos: [19.5, 15.5], yawIdx: 0, note: "portal de la ermita a 2.5 m (hero)" },
  { id: "p3", pos: [41, 31.5], yawIdx: 3, note: "sobre el puente, molino al SE" },
  { id: "p4", pos: [44, 38], yawIdx: 2, note: "la rueda del molino de cerca (hero)" },
  { id: "p5", pos: [29, 4], yawIdx: 5, note: "ábside y campanario desde el NE" },
  { id: "p6", pos: [12, 50], yawIdx: 1, note: "huerto: frutales y tapia" },
  { id: "p7", pos: [40, 44], yawIdx: 0, note: "orilla del río aguas arriba" },
];

export const npcs = [
  { id: "ermitanyo", pos: [18, 21], yawDeg: 180, anim: "idle" },
  { id: "molinero", pos: [46, 33.5], yawDeg: 90, anim: "idle" },
];

export async function load() {
  const data = await readSpec();
  const spec = data.spec;
  // Delantal de terreno bajo el tile (la niebla disimula el escalón).
  const apron = {
    shape: "box", size: [300, 0.1, 300], pos: [32, -0.25, 32],
    color: "#547233", cat: "terrain", mat: { top: "ground_grass" }, noShadow: true,
  };
  return {
    prims: [apron, ...spec.primitives.map(scalePrim)],
    lights: spec.lights.map((l) => (l.pos ? { ...l, pos: l.pos.map((v) => v * M) } : l)),
    env,
    meta,
    playerStart,
    poses,
    npcs,
  };
}
