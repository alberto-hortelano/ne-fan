// Escena interior del bench FPS: taberna serrana + pasillo y cripta de piedra.
// Autorada directamente como GreyboxPrimitive en METROS (mismo vocabulario que
// nefan-core/src/scene/greybox/common.ts). +z = sur; y = BASE de cada pieza.
// Campos extra del bench: `mat` (clase de material u objeto por grupo de
// caras), `hero` (celda de atlas única) y `desc` (descripción para el prompt
// de la celda hero).

const WOOD_DARK = "#5c4832";
const PLASTER = "#c9b89a";
const STONE = "#8a8378";
const STONE_DARK = "#6f6a5e";

const prims = [];
const P = (p) => prims.push(p);

// --- Taberna: sala 12×8 m (x -6..6, z -4..4), muros h=3, t=0.3 ---
P({ shape: "box", size: [13.0, 0.1, 9.0], pos: [0, -0.1, 0], color: "#7a5c3e", cat: "building", mat: { top: "wood_floor" }, noShadow: true });
P({ shape: "box", size: [13.0, 3, 0.3], pos: [0, 0, -4.15], color: PLASTER, cat: "building", mat: "wall_plaster" }); // norte
P({ shape: "box", size: [5.5, 3, 0.3], pos: [-3.55, 0, 4.15], color: PLASTER, cat: "building", mat: "wall_plaster" }); // sur izq
P({ shape: "box", size: [5.5, 3, 0.3], pos: [3.55, 0, 4.15], color: PLASTER, cat: "building", mat: "wall_plaster" }); // sur der
P({ shape: "box", size: [1.6, 0.9, 0.3], pos: [0, 2.1, 4.15], color: WOOD_DARK, cat: "building", mat: "wood_beam" }); // dintel puerta sur
P({ shape: "box", size: [0.3, 3, 8.6], pos: [6.15, 0, 0], color: PLASTER, cat: "building", mat: "wall_plaster" }); // este
P({ shape: "box", size: [0.3, 3, 3.3], pos: [-6.15, 0, -2.65], color: PLASTER, cat: "building", mat: "wall_plaster" }); // oeste norte
P({ shape: "box", size: [0.3, 3, 3.3], pos: [-6.15, 0, 2.65], color: PLASTER, cat: "building", mat: "wall_plaster" }); // oeste sur
P({ shape: "box", size: [0.3, 0.9, 2.0], pos: [-6.15, 2.1, 0], color: WOOD_DARK, cat: "building", mat: "wood_beam" }); // dintel pasillo
P({ shape: "box", size: [13.0, 0.15, 9.0], pos: [0, 3.0, 0], color: "#4a3a28", cat: "building", mat: { bottom: "ceiling_planks" }, noShadow: true });
for (const bx of [-3, 0, 3]) {
  P({ shape: "box", size: [0.28, 0.28, 8.6], pos: [bx, 2.45, 0], color: WOOD_DARK, cat: "building", mat: "wood_beam" });
}

// Mobiliario de la taberna
P({ shape: "box", size: [4.6, 1.1, 0.9], pos: [1.5, 0, -3.2], color: "#6b4a2c", cat: "prop", volId: "vol_barra", hero: true,
  desc: "flat front elevation of a rustic tavern bar counter: dark oak vertical panels with a brass foot rail along the bottom edge, one single texture spanning the whole rectangle",
  hints: [[0, 0.82, 1, 0.9, "#a8863c"]] });
P({ shape: "box", size: [3.6, 2.0, 0.35], pos: [1.5, 0.9, -3.9], color: "#54402c", cat: "prop", volId: "vol_estante", hero: true,
  desc: "flat front elevation of a back-bar shelf unit spanning the whole rectangle: two long wooden shelves with rows of clay jugs, bottles and pewter mugs",
  hints: [[0, 0.3, 1, 0.36, "#3a2c1e"], [0, 0.66, 1, 0.72, "#3a2c1e"]] });
P({ shape: "box", size: [0.9, 2.2, 1.8], pos: [5.7, 0, 1.5], color: STONE_DARK, cat: "prop", volId: "vol_chimenea", hero: true,
  desc: "flat front elevation of a stone fireplace filling the whole rectangle: glowing arched hearth opening at the bottom center, soot-blackened stones above it",
  hints: [[0.25, 0.6, 0.75, 1, "#241a12"]] });
for (const [tx, tz] of [[-3, 0.5], [-1, 2.2], [3, 1.8]]) {
  P({ shape: "cylinder", size: [0.55, 0.78], pos: [tx, 0, tz], color: "#7a5c3e", cat: "prop", mat: "wood_planks" });
  P({ shape: "cylinder", size: [0.2, 0.45], pos: [tx + 0.75, 0, tz + 0.2], color: "#6b543a", cat: "prop", mat: "wood_planks" });
}
P({ shape: "cylinder", size: [0.42, 0.85], pos: [-5.2, 0, -3.2], color: "#8a6b4a", cat: "prop" });
P({ shape: "cylinder", size: [0.42, 0.85], pos: [-4.3, 0, -3.4], color: "#8a6b4a", cat: "prop" });
P({ shape: "cylinder", size: [0.42, 0.85], pos: [-4.75, 0.85, -3.3], color: "#8a6b4a", cat: "prop" });

// --- Pasillo (x -12..-6, z -1..1), techo bajo 2.6 ---
P({ shape: "box", size: [6.0, 0.1, 2.6], pos: [-9, -0.1, 0], color: "#84796a", cat: "building", mat: { top: "stone_floor" }, noShadow: true });
P({ shape: "box", size: [6.0, 3, 0.3], pos: [-9, 0, -1.15], color: STONE, cat: "building", mat: "wall_stone" });
P({ shape: "box", size: [6.0, 3, 0.3], pos: [-9, 0, 1.15], color: STONE, cat: "building", mat: "wall_stone" });
P({ shape: "box", size: [6.0, 0.2, 2.6], pos: [-9, 2.6, 0], color: STONE_DARK, cat: "building", mat: { bottom: "wall_stone" }, noShadow: true });

// --- Cripta: sala 8×8 m (x -20.3..-12.3, z -4..4), muros h=3.4 ---
P({ shape: "box", size: [8.6, 0.1, 9.0], pos: [-16.15, -0.1, 0], color: "#84796a", cat: "building", mat: { top: "stone_floor" }, noShadow: true });
P({ shape: "box", size: [0.3, 3.4, 8.6], pos: [-20.15, 0, 0], color: STONE, cat: "building", mat: "wall_stone" }); // oeste
P({ shape: "box", size: [8.6, 3.4, 0.3], pos: [-16.15, 0, -4.15], color: STONE, cat: "building", mat: "wall_stone" }); // norte
P({ shape: "box", size: [8.6, 3.4, 0.3], pos: [-16.15, 0, 4.15], color: STONE, cat: "building", mat: "wall_stone" }); // sur
P({ shape: "box", size: [0.3, 3.4, 3.3], pos: [-12.15, 0, -2.65], color: STONE, cat: "building", mat: "wall_stone" }); // este norte
P({ shape: "box", size: [0.3, 3.4, 3.3], pos: [-12.15, 0, 2.65], color: STONE, cat: "building", mat: "wall_stone" }); // este sur
P({ shape: "box", size: [0.3, 1.0, 2.0], pos: [-12.15, 2.4, 0], color: STONE_DARK, cat: "building", mat: "wall_stone" }); // dintel cripta
P({ shape: "box", size: [8.6, 0.2, 9.0], pos: [-16.15, 3.4, 0], color: STONE_DARK, cat: "building", mat: { bottom: "wall_stone" }, noShadow: true });
for (const [px, pz] of [[-18.2, -2], [-18.2, 2], [-14.2, -2], [-14.2, 2]]) {
  P({ shape: "cylinder", size: [0.4, 3.4], pos: [px, 0, pz], color: STONE, cat: "prop", mat: "wall_stone" });
}
P({ shape: "box", size: [2.2, 1.0, 1.1], pos: [-16.15, 0, 0], color: "#96917f", cat: "prop", volId: "vol_sarcofago", hero: true, mat: { top: "stone_floor" },
  desc: "flat orthographic side elevation of a carved stone sarcophagus panel filling the whole rectangle: weathered relief carvings, moulded top edge — a texture, with no background, no shadow, no 3d perspective",
  hints: [[0, 0, 1, 0.18, "#a29d8a"]] });

export const lights = [
  { kind: "ambient", color: "#6f6257", intensity: 0.55 },
  { kind: "hemi", color: "#8a7a68", groundColor: "#3a332c", intensity: 0.4 },
  { kind: "point", color: "#ff9a4a", intensity: 26, distance: 10, pos: [5.0, 1.4, 1.5] }, // chimenea
  { kind: "point", color: "#ffc37a", intensity: 9, distance: 6, pos: [-3, 1.1, 0.5] },
  { kind: "point", color: "#ffc37a", intensity: 9, distance: 6, pos: [3, 1.1, 1.8] },
  { kind: "point", color: "#ffd9a0", intensity: 12, distance: 7, pos: [1.5, 2.2, -2.6] }, // sobre la barra
  { kind: "point", color: "#ff8c3a", intensity: 12, distance: 6, pos: [-9, 2.1, 0] }, // antorcha pasillo
  { kind: "point", color: "#ff8c3a", intensity: 16, distance: 9, pos: [-18.2, 2.4, -3.4] },
  { kind: "point", color: "#ff8c3a", intensity: 16, distance: 9, pos: [-14.2, 2.4, 3.4] },
];

export const meta = {
  name: "interior",
  description:
    "Interior de una taberna medieval serrana (suelo y vigas de madera, muros encalados, " +
    "barra y chimenea encendida) conectada por un pasillo bajo a una cripta de piedra con pilares y sarcófago.",
};

export const env = { sky: null, fog: null };

export const playerStart = { pos: [0, 3.2], yawIdx: 0 };

export const poses = [
  { id: "p0", pos: [0, 3.4], yawIdx: 0, note: "entrada: vista general de la sala" },
  { id: "p1", pos: [1.6, -0.9], yawIdx: 0, note: "barra de cerca (hero cells)" },
  { id: "p2", pos: [-5.0, 3.0], yawIdx: 1, note: "esquina SO: costuras muro-muro-techo" },
  { id: "p3", pos: [3.0, 1.5], yawIdx: 2, note: "chimenea y muro este" },
  { id: "p4", pos: [-6.6, 0], yawIdx: 6, note: "pasillo hacia la cripta" },
  { id: "p5", pos: [-12.6, 0], yawIdx: 6, note: "cripta desde la entrada" },
  { id: "p6", pos: [-19.5, 0], yawIdx: 2, note: "cripta: pilares, sarcófago y salida" },
  { id: "p7", pos: [-2.2, 1.2], yawIdx: 2, note: "mesa con parroquiano (sprite)" },
];

export const npcs = [
  { id: "tabernero", pos: [3.4, -3.5], yawDeg: 0, anim: "idle" },
  { id: "parroquiano", path: [[-3.5, 2.6], [2.2, 2.6], [3.4, 0.6], [-2.4, -0.6]], anim: "walk", speed: 1.1 },
  { id: "guardian", pos: [-18.4, -2.6], yawDeg: 45, anim: "idle" },
];

export async function load() {
  return { prims, lights, env, meta, playerStart, poses, npcs };
}
