// Escena exterior del bench FPS: el tile medieval de labs/render/fixtures,
// construido con el builder REAL del juego (buildTileGreyboxSpec, ver
// dump_spec.ts) y escalado de celdas a metros (×0.5). Corre en navegador
// (fetch) y en node (fs) — dump_layout.mjs la importa igual que el viewer.

export const meta = {
  name: "exterior",
  description:
    "Pueblo medieval amurallado sobre tierra: taberna, horno y casas de entramado y piedra " +
    "alrededor de una fuente, murallas con torre y puerta, árboles dispersos.",
};

export const env = {
  sky: { top: "#8db4d6", bottom: "#d8cfb4" },
  // El color de la niebla DEBE ser el del cielo bajo o el horizonte parte
  // la imagen en dos bandas.
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

// El tile va de 0..64 m. Hitos (metros): pozo (32,26), taberna [20..28]×[20..26],
// horno [28..34]×[37..42], muralla x=51 con puerta en (51,32) y torre (51,17),
// casa_zocodover extramuros [55..62]×[21..27], frutales en el huerto SO.
export const playerStart = { pos: [35, 48], yawIdx: 0 };

export const poses = [
  { id: "p0", pos: [35, 48], yawIdx: 0, note: "calle sur hacia la plaza (horno izq, casa der)" },
  { id: "p1", pos: [32, 31], yawIdx: 0, note: "el pozo de la plazuela de frente" },
  { id: "p2", pos: [24.5, 29.5], yawIdx: 0, note: "fachada de la taberna" },
  { id: "p3", pos: [24.5, 27.3], yawIdx: 0, note: "muro de la taberna a 1.3 m (densidad de texel)" },
  { id: "p4", pos: [46, 30], yawIdx: 2, note: "puerta de la muralla y casa extramuros" },
  { id: "p5", pos: [51, 37], yawIdx: 0, note: "cruzando la puerta desde el sur" },
  { id: "p6", pos: [8, 54], yawIdx: 0, note: "huerto: frutales y tapias" },
  { id: "p7", pos: [33.5, 30.5], yawIdx: 6, note: "NPC junto al pozo" },
];

export const npcs = [
  { id: "aldeano", pos: [30.5, 29], yawDeg: 150, anim: "idle" },
  { id: "ronda", path: [[29, 30], [36, 30], [36, 22], [29, 22]], anim: "walk", speed: 1.2 },
];

export async function load() {
  const data = await readSpec();
  const spec = data.spec;
  // Delantal de terreno bajo el tile: que desde la puerta o el huerto no se
  // vea el vacío (la niebla disimula la costura del escalón).
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
    // Huellas de colisión del builder (celdas → metros) además de las prims.
    elements: spec.elements.map((e) => ({
      ...e,
      footprint_cells: e.footprint_cells.map((v) => v * M),
    })),
  };
}
