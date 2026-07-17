/** Tests del compositor de blueprints: determinismo byte a byte (el hash del
 *  blueprint gobierna la caché de imagen), estructura del SVG en la oblicua
 *  única, elementos con bbox/baseline coherentes y validación de volúmenes.
 *  El fixture replica el pueblo de las demos (taberna cutaway, plaza con
 *  fuente, casa con tejado, muralla con torres y puerta). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPOSER_VERSION,
  composeBlueprint,
  deriveVolumesFromSchema,
  OBLIQUE_KX,
  OBLIQUE_KY,
  parseVolumes,
  PROJECTION,
  TREE_MAX_S,
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

  it("clampa la escala de árbol a TREE_MAX_S sin rechazar el plan", () => {
    const res = parseVolumes([
      { id: "roble_xxl", label: "roble", type: "tree", at: [40, 40], s: 2.5 },
      { id: "roble_ok", label: "roble", type: "tree", at: [80, 80], s: 1.2 },
    ]);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal((res.volumes[0] as { s?: number }).s, TREE_MAX_S);
      assert.equal((res.volumes[1] as { s?: number }).s, 1.2);
    }
  });
});

describe("blueprint/projection", () => {
  it("oblicua: suelo identidad, la altura ciza (-x) y eleva (-y)", () => {
    assert.deepEqual(PROJECTION.pt(10, 20), [10, 20]);
    assert.deepEqual(PROJECTION.pt(10, 20, 5), [10 + 5 * OBLIQUE_KX, 20 - 5 * OBLIQUE_KY]);
    assert.deepEqual(PROJECTION.ground(10, 20), [10, 20]);
    assert.ok(OBLIQUE_KX < 0, "KX negativo: tapas al oeste, cara este visible");
  });

  it("depth: v manda; u solo desempata (nunca pisa una diferencia real de v)", () => {
    // Misma v: el volumen más al este (u mayor) está más cerca de cámara.
    assert.ok(PROJECTION.depth(80, 40) > PROJECTION.depth(10, 40));
    // El desempate está acotado: u=128 no alcanza a v+1.
    assert.ok(PROJECTION.depth(128, 40) < PROJECTION.depth(0, 41));
  });
});

describe("blueprint/compose", () => {
  it("determinista byte a byte", () => {
    const a = composeBlueprint(PLAN, "tile_0_0");
    const b = composeBlueprint(PLAN, "tile_0_0");
    assert.equal(a.svg, b.svg);
    assert.deepEqual(a.elements, b.elements);
    assert.equal(a.composer_version, COMPOSER_VERSION);
    assert.equal(COMPOSER_VERSION, 8);
  });

  it("viewBox con margen superior (voladizo norte) e izquierdo (cizalla)", () => {
    const { viewBox } = composeBlueprint(PLAN, "tile_0_0");
    assert.deepEqual(viewBox, { minX: -12, minY: -32, width: 140, height: 160 });
  });

  it("incrusta el arte del suelo con clip y sin transform (suelo identidad)", () => {
    const { svg } = composeBlueprint(PLAN, "tile_0_0");
    assert.ok(svg.includes('clip-path="url(#tileclip)"'));
    assert.ok(!svg.includes("matrix("));
  });

  it("la cizalla materializa la cara este: el bbox rebasa la huella al oeste", () => {
    const { elements } = composeBlueprint(PLAN, "tile_0_0");
    const byId = new Map(elements.map((e) => [e.id, e]));
    // torre_o: at [46,68] r=8 h=11 → la tapa se desplaza 11·KX ≈ −3.85.
    const tower = byId.get("torre_o")!;
    const towerMinU = 46 - 8;
    assert.ok(
      tower.bbox[0] < towerMinU - 1,
      `tapa sin cizalla: bbox minX ${tower.bbox[0]} vs huella ${towerMinU}`,
    );
    // casa_grande (wall_h 5.5 + tejado): también rebasa su rect [78,...].
    const house = byId.get("casa_grande")!;
    assert.ok(house.bbox[0] < 78, `casa sin voladizo oeste (${house.bbox[0]})`);
  });

  it("elements: flags, bbox dentro del canvas y baseline coherente", () => {
    const { elements, viewBox } = composeBlueprint(PLAN, "tile_0_0");
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
      assert.ok(w > 0 && h > 0, `${e.id}: bbox vacío`);
      assert.ok(x >= viewBox.minX - 6 && y >= viewBox.minY - 6, `${e.id}: bbox fuera (min)`);
      assert.ok(x + w <= viewBox.minX + viewBox.width + 6, `${e.id}: bbox fuera (x)`);
      // la baseline (contacto con el suelo) cae dentro del bbox vertical
      assert.ok(e.baseline_y >= y - 0.5 && e.baseline_y <= y + h + 2, `${e.id}: baseline fuera del bbox`);
    }
    // el árbol es más ancho que su tronco: la copa está en el bbox
    const tree = byId.get("roble_1")!;
    assert.ok(tree.bbox[2] > 8, "copa no reflejada en bbox");
  });

  it("orden del pintor: la muralla (v=68) se pinta después que la fuente (v=36)", () => {
    const { svg } = composeBlueprint(PLAN, "tile_0_0");
    const fountain = svg.indexOf('data-vid="fuente"');
    const wall = svg.indexOf('data-vid="muralla_sur"');
    assert.ok(fountain >= 0 && wall >= 0);
    assert.ok(fountain < wall);
  });

  it("orden del pintor: a misma v, el volumen más al este se pinta después", () => {
    // La cizalla solapa vecinos en u: el desempate depth = v + u/512 debe
    // pintar el del este (más cerca de cámara) encima del del oeste.
    const pair: Volume[] = [
      { id: "oeste", label: "casa oeste", type: "building", rect: [10, 40, 12, 10] },
      { id: "este", label: "casa este", type: "building", rect: [60, 40, 12, 10] },
    ];
    const { svg } = composeBlueprint({ volumes: pair, biome: "grass" }, "t");
    assert.ok(svg.indexOf('data-vid="oeste"') < svg.indexOf('data-vid="este"'));
  });

  it("orden del pintor: las torres se pintan después que los tramos de muralla que pisan", () => {
    // La muralla se trocea en segmentos ordenados localmente; una torre
    // asentada sobre ella debe quedar ENCIMA de su tramo anfitrión (sesgo
    // de profundidad de torre/puerta).
    const { svg } = composeBlueprint(PLAN, "tile_0_0");
    const firstWallChunk = svg.indexOf('data-vid="muralla_sur"');
    const tower = svg.indexOf('data-vid="torre_o"');
    const gate = svg.indexOf('data-vid="puerta_sur"');
    assert.ok(firstWallChunk >= 0 && tower >= 0 && gate >= 0);
    assert.ok(tower > firstWallChunk, "torre antes que la muralla");
    assert.ok(gate > firstWallChunk, "puerta antes que la muralla");
  });

  it("seedKey distinto cambia solo el detalle procedural, no la estructura", () => {
    const a = composeBlueprint(PLAN, "tile_0_0");
    const b = composeBlueprint(PLAN, "tile_1_0");
    assert.notEqual(a.svg, b.svg); // juntas/scatter distintos
    assert.deepEqual(a.elements, b.elements); // misma geometría declarada
  });

  it("sin map_ground usa el relleno del bioma", () => {
    const { svg } = composeBlueprint({ volumes: [], biome: "sand" }, "t");
    assert.ok(svg.includes('fill="#cbb87e"'));
  });

  it("occluders: un tramo por entry tall, SVG standalone, deterministas", () => {
    const a = composeBlueprint(PLAN, "tile_0_0");
    const b = composeBlueprint(PLAN, "tile_0_0");
    assert.deepEqual(a.occluders, b.occluders);
    const vids = new Set(a.occluders.map((o) => o.vid));
    // Todos los volúmenes tall tienen occluder; los no-tall no.
    for (const e of a.elements) {
      assert.equal(vids.has(e.id), e.tall, e.id);
    }
    // La muralla (128 celdas) se trocea: varios occluders con baselines locales.
    const wallOccs = a.occluders.filter((o) => o.vid === "muralla_sur");
    assert.ok(wallOccs.length > 2, `muralla sin trocear (${wallOccs.length})`);
    // El cutaway emite cada muro trasero y el frontal por separado (el
    // suelo NO ocluye — taparía los muebles interiores).
    const tabernaOccs = a.occluders.filter((o) => o.vid === "taberna");
    assert.deepEqual(
      tabernaOccs.map((o) => o.id).sort(),
      ["taberna:back_n", "taberna:back_w", "taberna:front"],
    );
    // Huellas FINAS de los tramos del cutaway (rect [8,12,38,34]) — son de
    // MUNDO: la cizalla no las toca.
    const backN = tabernaOccs.find((o) => o.id === "taberna:back_n")!;
    const backW = tabernaOccs.find((o) => o.id === "taberna:back_w")!;
    const front = tabernaOccs.find((o) => o.id === "taberna:front")!;
    assert.deepEqual(backN.footprint_cells, [8, 12, 46, 13.2], "huella back_n");
    assert.deepEqual(backW.footprint_cells, [8, 12, 9.2, 46], "huella back_w");
    assert.deepEqual(front.footprint_cells, [8, 44.8, 46, 46], "huella front");
    // Árbol: dos tramos — tronco (occluder normal, huella fina) y copa
    // AÉREA (overhead: se pinta sobre las entidades siempre).
    const treeOccs = a.occluders.filter((o) => o.vid === "roble_1");
    assert.deepEqual(treeOccs.map((o) => o.id).sort(), ["roble_1:canopy", "roble_1:trunk"]);
    const trunk = treeOccs.find((o) => o.id === "roble_1:trunk")!;
    const canopy = treeOccs.find((o) => o.id === "roble_1:canopy")!;
    assert.equal(trunk.overhead, undefined, "el tronco no es aéreo");
    assert.equal(canopy.overhead, true, "la copa es aérea");
    const [tu0, tv0, tu1, tv1] = trunk.footprint_cells;
    assert.ok(tu1 - tu0 < 3 && tv1 - tv0 < 3, "huella del árbol no es el tronco");
    for (const o of a.occluders) {
      const [, y, w, h] = o.bbox;
      assert.ok(w > 0 && h > 0, `${o.id}: bbox vacío`);
      assert.ok(o.svg.startsWith("<svg viewBox=") && o.svg.endsWith("</svg>"), `${o.id}: svg malformado`);
      assert.ok(o.svg.includes(`data-vid="${o.vid}"`));
      const [fu0, fv0, fu1, fv1] = o.footprint_cells;
      assert.ok(fu1 > fu0 && fv1 > fv0, `${o.id}: huella vacía`);
      // baseline dentro del rango vertical del bbox (con margen del pad)
      assert.ok(o.baseline_y >= y - 0.5 && o.baseline_y <= y + h + 2, `${o.id}: baseline fuera`);
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
    // el derivado valida y compone
    const parsed = parseVolumes(derived);
    assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
    const c = composeBlueprint({ volumes: derived, biome: "grass" }, "tile_0_0");
    assert.ok(c.svg.includes('data-vid="derived_ent_casa_1"'));
  });

  it("las entities del scatter de la expansión NO derivan y el resto se capa", () => {
    // Un save real llega EXPANDIDO: cientos de trees estampados por
    // scene-expand (flag `scattered` en escenas nuevas; en saves antiguos
    // solo el patrón de id `{slug}_z{zi}_{i}`). Derivarlos colgaba el
    // cliente (miles de elementos SVG + occluders).
    const scatterOld = Array.from({ length: 400 }, (_, i) => ({
      id: `pino_z0_${i}`, kind: "tree", name: "pino", cell: [i % 120, Math.floor(i / 4)], footprint: [1, 1],
    }));
    const scatterNew = Array.from({ length: 300 }, (_, i) => ({
      id: `abeto_x_${i}`, kind: "tree", name: "abeto", cell: [i % 120, 40 + Math.floor(i / 8)], footprint: [1, 1], scattered: true,
    }));
    const derived = deriveVolumesFromSchema(
      {
        scene_id: "tile_0_0",
        entities: [
          ...scatterOld,
          ...scatterNew,
          { id: "casa_1", kind: "building", name: "casa", cell: [20, 100], footprint: [16, 12] },
          { id: "roble_autor", kind: "tree", name: "roble del autor", cell: [100, 100], footprint: [4, 4] },
        ],
      },
      [],
    );
    const ids = derived.map((v) => v.id);
    assert.ok(ids.includes("derived_ent_casa_1"), "la casa debe derivar");
    assert.ok(ids.includes("derived_ent_roble_autor"), "el árbol del autor debe derivar");
    assert.ok(!ids.some((id) => /_z\d+_\d+$/.test(id)), "trees del scatter derivados");
    assert.ok(derived.length <= 82, `derivados sin capar: ${derived.length}`);
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
    const composed = composeBlueprint({ volumes: derived, biome: "forest_floor" }, "tile_1_1");
    assert.ok(composed.svg.length > 500);
  });
});
