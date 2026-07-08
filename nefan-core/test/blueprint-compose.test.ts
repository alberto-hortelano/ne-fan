/** Tests del compositor de blueprints: determinismo byte a byte (el hash del
 *  blueprint gobierna la caché de imagen), estructura del SVG por
 *  perspectiva, elementos con bbox/baseline coherentes y validación de
 *  volúmenes. El fixture replica el pueblo de las demos (taberna cutaway,
 *  plaza con fuente, casa con tejado, muralla con torres y puerta). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPOSER_VERSION,
  composeBlueprint,
  deriveVolumesFromSchema,
  isPerspective,
  parseVolumes,
  projectionFor,
} from "../src/scene/blueprint/index.js";
import type { BlueprintPlan, Volume } from "../src/scene/blueprint/index.js";

const GROUND_SVG =
  '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">' +
  '<g id="ground"><rect width="128" height="128" fill="#547233"/>' +
  '<path d="M64,0 L64,128" stroke="#a29b8b" stroke-width="9" fill="none"/></g>' +
  '<g id="water"/><g id="deck"/></svg>';

const VILLAGE: Volume[] = [
  {
    id: "taberna",
    label: "taberna",
    type: "building",
    rect: [8, 12, 38, 34],
    cutaway: true,
    doors: [{ edge: "s", at: 16, w: 5 }],
  },
  {
    id: "casa_grande",
    label: "casa de entramado",
    type: "building",
    rect: [78, 4, 34, 20],
    wall_h: 5.5,
    roof: { kind: "gable", material: "slate" },
    walls: { material: "timber" },
    doors: [{ edge: "s", at: 14, w: 4 }],
  },
  { id: "muralla_sur", label: "muralla", type: "wall", points: [[0, 68], [128, 68]], width: 6, h: 7, crenellated: true },
  { id: "torre_o", label: "torre", type: "tower", at: [46, 68], r: 8, h: 11 },
  { id: "torre_e", label: "torre", type: "tower", at: [82, 68], r: 8, h: 11 },
  { id: "puerta_sur", label: "puerta de la ciudad", type: "gate", at: [64, 68], w: 9, h: 10, orient: "x" },
  { id: "fuente", label: "fuente", type: "fountain", at: [64, 36], r: 6 },
  { id: "roble_1", label: "roble", type: "tree", at: [18, 58], s: 1.1 },
  { id: "roble_2", label: "roble", type: "tree", at: [108, 56] },
  { id: "mata_1", label: "arbusto", type: "bush", at: [30, 52] },
  { id: "roca_1", label: "roca", type: "rock", at: [12, 90], s: 1.4 },
  { id: "barril_1", label: "barril", type: "prop", at: [12, 50], shape: "cylinder", h: 2.4 },
  { id: "puesto", label: "puesto de mercado", type: "prop", rect: [90, 40, 8, 5], shape: "box", h: 3, color: "#8a6a40" },
];

const PLAN: BlueprintPlan = { map_ground: GROUND_SVG, volumes: VILLAGE, biome: "grass" };

describe("blueprint/volumes", () => {
  it("valida el fixture del pueblo", () => {
    const res = parseVolumes(VILLAGE);
    assert.equal(res.ok, true);
  });

  it("rechaza ids duplicados", () => {
    const res = parseVolumes([VILLAGE[0], { ...VILLAGE[1], id: "taberna" }]);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /duplicado/);
  });

  it("rechaza prop con at y rect a la vez", () => {
    const res = parseVolumes([{ id: "x", label: "x", type: "prop", at: [4, 4], rect: [4, 4, 2, 2], shape: "box" }]);
    assert.equal(res.ok, false);
  });

  it("rechaza tipos desconocidos", () => {
    const res = parseVolumes([{ id: "x", label: "x", type: "dragon", at: [4, 4] }]);
    assert.equal(res.ok, false);
  });
});

describe("blueprint/projection", () => {
  it("topdown: suelo identidad, altura desplaza -y", () => {
    const p = projectionFor("topdown");
    assert.deepEqual(p.pt(10, 20), [10, 20]);
    assert.deepEqual(p.pt(10, 20, 5), [10, 15]);
    assert.deepEqual(p.ground(10, 20), [10, 20]);
  });

  it("isometric: 2:1 exacta e invertible en el suelo", () => {
    const p = projectionFor("isometric");
    const [x, y] = p.pt(30, 50);
    const [u, v] = p.ground(x, y);
    assert.ok(Math.abs(u - 30) < 1e-9 && Math.abs(v - 50) < 1e-9);
    // 2:1: una celda a lo largo de u se mueve el doble en x que en y
    const [x0, y0] = p.pt(0, 0);
    const [x1, y1] = p.pt(1, 0);
    assert.ok(Math.abs((x1 - x0) / (y1 - y0) - 2) < 1e-9);
  });

  it("isPerspective solo acepta los dos valores", () => {
    assert.equal(isPerspective("topdown"), true);
    assert.equal(isPerspective("isometric"), true);
    assert.equal(isPerspective("flat"), false);
    assert.equal(isPerspective(undefined), false);
  });
});

describe("blueprint/compose", () => {
  it("determinista byte a byte", () => {
    for (const perspective of ["topdown", "isometric"] as const) {
      const a = composeBlueprint(PLAN, perspective, "tile_0_0");
      const b = composeBlueprint(PLAN, perspective, "tile_0_0");
      assert.equal(a.svg, b.svg, perspective);
      assert.deepEqual(a.elements, b.elements);
    }
  });

  it("las dos perspectivas producen SVG distinto con los mismos elementos", () => {
    const td = composeBlueprint(PLAN, "topdown", "tile_0_0");
    const iso = composeBlueprint(PLAN, "isometric", "tile_0_0");
    assert.notEqual(td.svg, iso.svg);
    assert.deepEqual(
      td.elements.map((e) => e.id).sort(),
      iso.elements.map((e) => e.id).sort(),
    );
    assert.equal(td.composer_version, COMPOSER_VERSION);
  });

  it("viewBox con margen superior (voladizo de alturas)", () => {
    const td = composeBlueprint(PLAN, "topdown", "tile_0_0");
    assert.ok(td.viewBox.minY < 0);
    assert.equal(td.viewBox.width, 128);
    const iso = composeBlueprint(PLAN, "isometric", "tile_0_0");
    assert.ok(iso.viewBox.minY < 0);
    assert.equal(iso.viewBox.width, 128);
    assert.ok(iso.viewBox.height < td.viewBox.height); // rombo 2:1 achatado
  });

  it("incrusta el arte del suelo con clip y transform en iso", () => {
    const td = composeBlueprint(PLAN, "topdown", "tile_0_0");
    assert.ok(td.svg.includes('clip-path="url(#tileclip)"'));
    assert.ok(!td.svg.includes("matrix("));
    const iso = composeBlueprint(PLAN, "isometric", "tile_0_0");
    assert.ok(iso.svg.includes("matrix(0.5 0.25 -0.5 0.25 64 0)"));
  });

  it("elements: flags, bbox dentro del canvas y baseline coherente", () => {
    for (const perspective of ["topdown", "isometric"] as const) {
      const { elements, viewBox } = composeBlueprint(PLAN, perspective, "tile_0_0");
      assert.equal(elements.length, VILLAGE.length);
      const byId = new Map(elements.map((e) => [e.id, e]));
      assert.deepEqual(
        { solid: byId.get("taberna")!.solid, tall: byId.get("taberna")!.tall },
        { solid: true, tall: true },
      );
      assert.deepEqual(
        { solid: byId.get("mata_1")!.solid, tall: byId.get("mata_1")!.tall },
        { solid: false, tall: false },
      );
      assert.deepEqual(
        { solid: byId.get("fuente")!.solid, tall: byId.get("fuente")!.tall },
        { solid: true, tall: false },
      );
      for (const e of elements) {
        const [x, y, w, h] = e.bbox;
        assert.ok(w > 0 && h > 0, `${perspective}/${e.id}: bbox vacío`);
        assert.ok(x >= viewBox.minX - 6 && y >= viewBox.minY - 6, `${perspective}/${e.id}: bbox fuera (min)`);
        assert.ok(x + w <= viewBox.minX + viewBox.width + 6, `${perspective}/${e.id}: bbox fuera (x)`);
        // la baseline (contacto con el suelo) cae dentro del bbox vertical
        assert.ok(e.baseline_y >= y - 0.5 && e.baseline_y <= y + h + 2, `${perspective}/${e.id}: baseline fuera del bbox`);
      }
      // el árbol es más ancho que su tronco: la copa está en el bbox
      const tree = byId.get("roble_1")!;
      assert.ok(tree.bbox[2] > 8, `${perspective}: copa no reflejada en bbox`);
    }
  });

  it("orden del pintor: en topdown la muralla (v=68) se pinta después que la fuente (v=36)", () => {
    const { svg } = composeBlueprint(PLAN, "topdown", "tile_0_0");
    const fountain = svg.indexOf('data-vid="fuente"');
    const wall = svg.indexOf('data-vid="muralla_sur"');
    assert.ok(fountain >= 0 && wall >= 0);
    assert.ok(fountain < wall);
  });

  it("orden del pintor: las torres se pintan después que los tramos de muralla que pisan", () => {
    // La muralla se trocea en segmentos ordenados localmente; una torre
    // asentada sobre ella debe quedar ENCIMA de su tramo anfitrión en ambas
    // perspectivas (sesgo de profundidad de torre/puerta).
    for (const perspective of ["topdown", "isometric"] as const) {
      const { svg } = composeBlueprint(PLAN, perspective, "tile_0_0");
      const firstWallChunk = svg.indexOf('data-vid="muralla_sur"');
      const tower = svg.indexOf('data-vid="torre_o"');
      const gate = svg.indexOf('data-vid="puerta_sur"');
      assert.ok(firstWallChunk >= 0 && tower >= 0 && gate >= 0);
      assert.ok(tower > firstWallChunk, `${perspective}: torre antes que la muralla`);
      assert.ok(gate > firstWallChunk, `${perspective}: puerta antes que la muralla`);
    }
  });

  it("seedKey distinto cambia solo el detalle procedural, no la estructura", () => {
    const a = composeBlueprint(PLAN, "topdown", "tile_0_0");
    const b = composeBlueprint(PLAN, "topdown", "tile_1_0");
    assert.notEqual(a.svg, b.svg); // juntas/scatter distintos
    assert.deepEqual(a.elements, b.elements); // misma geometría declarada
  });

  it("sin map_ground usa el relleno del bioma", () => {
    const { svg } = composeBlueprint({ volumes: [], biome: "sand" }, "topdown", "t");
    assert.ok(svg.includes('fill="#cbb87e"'));
  });

  it("occluders: un tramo por entry tall, SVG standalone, deterministas", () => {
    for (const perspective of ["topdown", "isometric"] as const) {
      const a = composeBlueprint(PLAN, perspective, "tile_0_0");
      const b = composeBlueprint(PLAN, perspective, "tile_0_0");
      assert.deepEqual(a.occluders, b.occluders, perspective);
      const vids = new Set(a.occluders.map((o) => o.vid));
      // Todos los volúmenes tall tienen occluder; los no-tall no.
      for (const e of a.elements) {
        assert.equal(vids.has(e.id), e.tall, `${perspective}/${e.id}`);
      }
      // La muralla (128 celdas) se trocea: varios occluders con baselines locales.
      const wallOccs = a.occluders.filter((o) => o.vid === "muralla_sur");
      assert.ok(wallOccs.length > 2, `${perspective}: muralla sin trocear (${wallOccs.length})`);
      // El cutaway emite base y front por separado.
      const tabernaOccs = a.occluders.filter((o) => o.vid === "taberna");
      assert.deepEqual(tabernaOccs.map((o) => o.id).sort(), ["taberna:base", "taberna:front"], perspective);
      for (const o of a.occluders) {
        const [, y, w, h] = o.bbox;
        assert.ok(w > 0 && h > 0, `${perspective}/${o.id}: bbox vacío`);
        assert.ok(o.svg.startsWith("<svg viewBox=") && o.svg.endsWith("</svg>"), `${perspective}/${o.id}: svg malformado`);
        assert.ok(o.svg.includes(`data-vid="${o.vid}"`));
        // baseline dentro del rango vertical del bbox (con margen del pad)
        assert.ok(o.baseline_y >= y - 0.5 && o.baseline_y <= y + h + 2, `${perspective}/${o.id}: baseline fuera`);
      }
    }
  });
});

describe("blueprint/derive", () => {
  it("structures → building cutaway con puertas", () => {
    const derived = deriveVolumesFromSchema(
      {
        scene_id: "tile_0_0",
        structures: [{ type: "room", rect: [10, 10, 20, 14], doors: [{ side: "south", at: 8, width: 4 }] }],
      },
      [],
    );
    assert.equal(derived.length, 1);
    const b = derived[0];
    assert.equal(b.type, "building");
    if (b.type === "building") {
      assert.equal(b.cutaway, true);
      assert.deepEqual(b.doors, [{ edge: "s", at: 8, w: 4 }]);
    }
  });

  it("no duplica estructuras ya declaradas por el LLM", () => {
    const declared: Volume[] = [{ id: "b", label: "casa", type: "building", rect: [8, 8, 24, 18] }];
    const derived = deriveVolumesFromSchema(
      { scene_id: "t", structures: [{ type: "room", rect: [10, 10, 20, 14] }] },
      declared,
    );
    assert.equal(derived.length, 0);
  });

  it("vegetación: scatter determinista fuera de estructuras", () => {
    const input = {
      scene_id: "tile_2_3",
      structures: [{ type: "room", rect: [40, 40, 30, 30] }],
      vegetation_zones: [{ type: "pino", area: "rest" as const, density: 0.15 }],
    };
    const a = deriveVolumesFromSchema(input, []);
    const b = deriveVolumesFromSchema(input, []);
    assert.deepEqual(a, b);
    const trees = a.filter((v) => v.type === "tree");
    assert.ok(trees.length > 5, `solo ${trees.length} árboles`);
    for (const t of trees) {
      if (t.type !== "tree") continue;
      const [u, v] = t.at;
      const inside = u > 37 && u < 73 && v > 37 && v < 73;
      assert.ok(!inside, `árbol dentro de la estructura en ${u},${v}`);
    }
  });

  it("entities estáticas → su volumen (building con techo, tree, prop, decor passable)", () => {
    const derived = deriveVolumesFromSchema(
      {
        scene_id: "tile_0_0",
        entities: [
          { id: "casa_1", kind: "building", cell: [20, 20], footprint: [16, 12], name: "casa del herrero" },
          { id: "roble_x", kind: "tree", cell: [80, 80], footprint: [4, 4], name: "roble viejo" },
          { id: "barril_x", kind: "prop", cell: [50, 90], footprint: [2, 2], name: "barril", shape: "cylinder" },
          { id: "alfombra", kind: "decor", cell: [60, 100], footprint: [4, 3], name: "alfombra" },
          { id: "espada", kind: "item", cell: [70, 70], footprint: [1, 1], name: "espada" },
          { id: "aldeano", kind: "npc", cell: [90, 90], footprint: [1, 1], name: "aldeano" },
        ],
      },
      [],
    );
    const byId = new Map(derived.map((v) => [v.id, v]));
    const casa = byId.get("derived_ent_casa_1");
    assert.ok(casa && casa.type === "building");
    if (casa && casa.type === "building") {
      assert.deepEqual(casa.rect, [20, 20, 16, 12]);
      assert.equal(casa.cutaway, undefined); // no enterable → con techo
      assert.equal(casa.roof?.kind, "gable");
      assert.equal(casa.label, "casa del herrero");
    }
    const roble = byId.get("derived_ent_roble_x");
    assert.ok(roble && roble.type === "tree");
    const barril = byId.get("derived_ent_barril_x");
    assert.ok(barril && barril.type === "prop");
    if (barril && barril.type === "prop") assert.equal(barril.shape, "cylinder");
    const alfombra = byId.get("derived_ent_alfombra");
    assert.ok(alfombra && alfombra.type === "prop");
    if (alfombra && alfombra.type === "prop") assert.equal(alfombra.passable, true);
    // items y npcs NO derivan volumen
    assert.equal(byId.has("derived_ent_espada"), false);
    assert.equal(byId.has("derived_ent_aldeano"), false);
    // el derivado valida y compone en ambas perspectivas
    const parsed = parseVolumes(derived);
    assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
    for (const perspective of ["topdown", "isometric"] as const) {
      const c = composeBlueprint({ volumes: derived, biome: "grass" }, perspective, "tile_0_0");
      assert.ok(c.svg.includes('data-vid="derived_ent_casa_1"'), perspective);
    }
  });

  it("una entity que solapa un volumen declarado no se deriva", () => {
    const declared: Volume[] = [{ id: "b", label: "casa", type: "building", rect: [18, 18, 20, 16] }];
    const derived = deriveVolumesFromSchema(
      { scene_id: "t", entities: [{ id: "casa_1", kind: "building", cell: [20, 20], footprint: [16, 12], name: "casa" }] },
      declared,
    );
    assert.equal(derived.length, 0);
  });

  it("el resultado derivado compone y valida", () => {
    const derived = deriveVolumesFromSchema(
      {
        scene_id: "tile_1_1",
        structures: [{ type: "room", rect: [50, 20, 22, 16], doors: [{ side: "south", at: 8 }] }],
        vegetation_zones: [{ type: "roble", area: [0, 60, 128, 60] as [number, number, number, number], density: 0.2 }],
      },
      [],
    );
    const parsed = parseVolumes(derived);
    assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
    const composed = composeBlueprint({ volumes: derived, biome: "forest_floor" }, "isometric", "tile_1_1");
    assert.ok(composed.svg.length > 500);
  });
});
