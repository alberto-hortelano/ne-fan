// Escena "carreta" del bench FPS: verificación visual del volumen CUSTOM
// (composición 3D libre del motor). El plan declara la carreta entoldada como
// piezas (caja + ruedas rotX + toldo cilíndrico escalado + varales) — el caso
// del playtest 2026-08-16 que antes salía como un cubo con skin de carro.
// Mismo patrón de carga que escenas/nueva/escena.mjs.

export const meta = {
  name: "carreta",
  description: "Explanada de mercado con una carreta entoldada compuesta como volumen custom.",
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
    // size[2] de cone son segmentos (no se escala); size[1] de sphere ídem.
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

// Carreta en (32, 37) m, girada −14°. Poses alrededor (ruedas, toldo, 3/4).
export const playerStart = { pos: [32, 43], yawIdx: 0 };

export const poses = [
  { id: "p0", pos: [32, 43], yawIdx: 0, note: "carreta de frente (lado sur: caja y ruedas)" },
  { id: "p1", pos: [37, 41.5], yawIdx: 7, note: "3/4 desde el SE: varales y ruedas" },
  { id: "p2", pos: [26.5, 37], yawIdx: 6, note: "el toldo cilíndrico de cerca (oeste)" },
  { id: "p3", pos: [32, 31.5], yawIdx: 4, note: "desde el norte: toldo y trasera" },
  { id: "p4", pos: [24, 45], yawIdx: 1, note: "plano general con la casa detrás" },
];

export const npcs = [];

export async function load() {
  const data = await readSpec();
  const spec = data.spec;
  // Delantal de terreno bajo el tile (la niebla disimula el escalón).
  const apron = {
    shape: "box", size: [300, 0.1, 300], pos: [32, -0.25, 32],
    color: "#8d6f4e", cat: "terrain", mat: { top: "ground_dirt" }, noShadow: true,
  };
  return {
    prims: [apron, ...spec.primitives.map(scalePrim)],
    lights: spec.lights.map((l) => (l.pos ? { ...l, pos: l.pos.map((v) => v * M) } : l)),
    env,
    meta,
    playerStart,
    poses,
    npcs,
    elements: spec.elements.map((e) => ({
      ...e,
      footprint_cells: e.footprint_cells.map((v) => v * M),
    })),
  };
}
