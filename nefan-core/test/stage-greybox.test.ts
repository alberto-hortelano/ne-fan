import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildGreyboxSpec,
  canonicalGreyboxJson,
  expectedElementsFromGreybox,
  volumeHeightM,
  volumeFootprintCells,
  GREYBOX_EYE_M,
  STAGE_GREYBOX_VERSION,
  type GreyboxSpec,
  type StageScenePlan,
} from "../src/scene/stage/greybox.js";
import { composeStageScene } from "../src/scene/stage/scene.js";
import { stageToViewAt, stageToView } from "../src/scene/stage/projection.js";
import { STAGE_RENDER_SIZE } from "../src/scene/stage/segments.js";

/** Mismo plan interior que stage-compose.test.ts (12×8 m). */
function interiorPlan(): StageScenePlan {
  return {
    size: { cols: 24, rows: 16, meters_per_cell: 0.5 },
    stage: {
      exits: [
        { id: "puerta_cocina", edge: "north", to_place_id: "posada_cocina",
          zone: [10, 0, 4, 2], kind: "opening", label: "Puerta a la cocina" },
        { id: "salida_calle", edge: "south", to_place_id: "calle_mayor",
          zone: [14, 14, 5, 2], kind: "opening", label: "Salida a la calle" },
        { id: "puerta_este", edge: "east", to_place_id: "patio",
          zone: [22, 6, 2, 4], kind: "opening", label: "Puerta al patio" },
      ],
      backdrop: { description: "Pared con chimenea encendida" },
      fourth_wall: { present: true, doors: [{ col: 14, w: 5 }] },
    },
    volumes: [
      { id: "mesa_grande", label: "mesa grande", type: "prop", rect: [6, 8, 4, 2], shape: "box", h: 2 },
      { id: "barril", label: "barril", type: "prop", at: [18, 5], shape: "cylinder", h: 2 },
    ],
  };
}

function exteriorPlan(): StageScenePlan {
  const p = interiorPlan();
  p.stage.fourth_wall = undefined;
  p.size = { cols: 48, rows: 24, meters_per_cell: 0.5 };
  p.stage.exits = [
    { id: "camino_norte", edge: "north", to_place_id: "bosque",
      zone: [20, 0, 6, 2], kind: "opening", label: "Camino al bosque" },
    { id: "salida_sur", edge: "south", to_place_id: "plaza",
      zone: [20, 22, 6, 2], kind: "opening", label: "Hacia la plaza" },
  ];
  p.volumes.push({
    id: "casa_alta", label: "casa alta", type: "building",
    rect: [4, 4, 10, 8], wall_h: 8,
  });
  p.biome = "grass";
  return p;
}

/** Proyección de referencia: pinhole estándar reimplementado con la cámara
 *  del spec (posición + focal en unidades de vista), sin three.js. Un punto
 *  de mundo (x, y, z) proyecta sobre el plano focal a
 *  (F·x/(camZ−z), horizon − F·(y−eye)/(camZ−z)) en unidades de vista. */
function referenceProject(spec: GreyboxSpec, x: number, y: number, zWorld: number): [number, number] {
  const [camX, camY, camZ] = spec.camera.pos;
  const F = spec.proj.px_per_m * spec.camera.retreat_m;
  const dist = camZ - zWorld;
  return [
    ((x - camX) * F) / dist,
    spec.proj.horizon_y - ((y - camY) * F) / dist,
  ];
}

describe("buildGreyboxSpec", () => {
  it("es determinista: mismo plan + seedKey ⇒ mismo canónico", () => {
    const a = canonicalGreyboxJson(buildGreyboxSpec(interiorPlan(), "posada_salon"));
    const b = canonicalGreyboxJson(buildGreyboxSpec(interiorPlan(), "posada_salon"));
    assert.equal(a, b);
    assert.ok(a.includes(`"greybox_version":${STAGE_GREYBOX_VERSION}`));
  });

  it("seedKey distinto ⇒ variación sembrada (luces/fondo)", () => {
    const a = canonicalGreyboxJson(buildGreyboxSpec(exteriorPlan(), "plato_a"));
    const b = canonicalGreyboxJson(buildGreyboxSpec(exteriorPlan(), "plato_b"));
    assert.notEqual(a, b);
  });

  it("la cámara del spec equivale EXACTAMENTE a la proyección declarada", () => {
    for (const plan of [interiorPlan(), exteriorPlan()]) {
      const spec = buildGreyboxSpec(plan, "equiv");
      const depth = spec.proj.depth_m;
      const rectMaxZ = spec.camera.pos[2] - spec.camera.retreat_m;
      for (const [xS, zS, h] of [
        [0, 0, 0], [3, 2, 0], [-4, depth, 0], [2.5, depth / 2, 1.7],
        [-3, 1, 3], [5, depth - 0.5, 6],
      ] as [number, number, number][]) {
        const [evx, evy] = stageToViewAt(spec.proj, xS, zS, h);
        // Mundo: xStage == x centrado; zStage = maxZ − zWorld.
        const [rvx, rvy] = referenceProject(spec, xS, h, rectMaxZ - zS);
        assert.ok(Math.abs(evx - rvx) < 1e-6, `vx en (${xS},${zS},${h}): ${evx} vs ${rvx}`);
        assert.ok(Math.abs(evy - rvy) < 1e-6, `vy en (${xS},${zS},${h}): ${evy} vs ${rvy}`);
      }
      // stageToViewAt con h=0 == stageToView (suelo).
      const [gx, gy] = stageToView(spec.proj, 2, 3);
      const [ax, ay] = stageToViewAt(spec.proj, 2, 3, 0);
      assert.equal(gx, ax);
      assert.equal(gy, ay);
    }
  });

  it("altura de ojos coherente con el proj emitido (por modo)", () => {
    for (const [plan, expected] of [
      [interiorPlan(), 1.8],
      [exteriorPlan(), GREYBOX_EYE_M],
    ] as const) {
      const spec = buildGreyboxSpec(plan, "eye");
      const eye = (spec.proj.ground_y - spec.proj.horizon_y) / spec.proj.px_per_m;
      assert.ok(Math.abs(eye - expected) < 1e-9, `eye ${eye} vs ${expected}`);
      assert.equal(spec.camera.eye_m, eye);
      assert.equal(spec.camera.pos[1], eye);
    }
    // La cámara interior SIEMPRE bajo el techo — a la altura del techo lo
    // vería de canto y el frame quedaría negro por encima.
    assert.ok(buildGreyboxSpec(interiorPlan(), "eye").camera.eye_m < 3.2);
  });

  it("v6: wall_h_m declarado manda sobre el default del techo interior", () => {
    const techoDe = (plan: StageScenePlan): number => {
      const spec = buildGreyboxSpec(plan, "techo");
      // El techo es la caja cat "wall" sin sombra más ancha (extendida hasta
      // detrás de la cámara); su pos.y es la altura de la sala.
      const ceil = spec.primitives
        .filter((p) => p.cat === "wall" && p.noShadow && p.shape === "box")
        .sort((a, b) => b.size[2] - a.size[2])[0]!;
      return ceil.pos[1];
    };
    assert.equal(techoDe(interiorPlan()), 3.5, "default de taberna");
    const noble = interiorPlan();
    noble.stage.wall_h_m = 5;
    assert.equal(techoDe(noble), 5);
    const choza = interiorPlan();
    choza.stage.wall_h_m = 2.4;
    assert.equal(techoDe(choza), 2.4);
  });

  it("v6: style_tag stage_interior activa el modo interior aunque falte fourth_wall", () => {
    const plan = interiorPlan();
    plan.stage.fourth_wall = undefined;
    // Sin ninguna señal: exterior (ojo alto, cielo).
    const ext = buildGreyboxSpec(plan, "sig");
    assert.equal(ext.camera.eye_m, GREYBOX_EYE_M);
    assert.ok(ext.sky, "sin señal de interior hay cielo");
    // Con style_tag: interior (ojo 1.8, sin cielo) — fourth_wall es opcional
    // en el prompt y no puede ser la única señal.
    const int = buildGreyboxSpec({ ...plan, style_tag: "stage_interior" }, "sig");
    assert.equal(int.camera.eye_m, 1.8);
    assert.ok(!int.sky, "interior sin cielo");
  });

  it("manifest: mismos ids vol_* que los items de la escena, cajas dentro del cuadrado", () => {
    const plan = interiorPlan();
    const spec = buildGreyboxSpec(plan, "posada_salon");
    const composed = composeStageScene(plan, "posada_salon");
    const itemIds = composed.items.map((i) => i.id).sort();
    const manifestIds = spec.manifest.map((m) => m.id).sort();
    assert.deepEqual(manifestIds, itemIds);
    for (const m of spec.manifest) {
      const [x, y, w, h] = m.box_px;
      assert.ok(x >= 0 && y >= 0 && x + w <= STAGE_RENDER_SIZE && y + h <= STAGE_RENDER_SIZE, m.id);
      assert.ok(w > 0 && h > 0, `caja no vacía en ${m.id}`);
    }
  });

  it("manifest: huellas == volumeFootprintCells en metros de mundo", () => {
    const plan = interiorPlan();
    const spec = buildGreyboxSpec(plan, "fp");
    const mpc = plan.size.meters_per_cell;
    const rect = { minX: -6, minZ: -4 };
    for (const v of plan.volumes) {
      const fp = volumeFootprintCells(v)!;
      const m = spec.manifest.find((x) => x.id === `vol_${v.id}`)!;
      assert.deepEqual(m.footprintWorld, [
        rect.minX + fp[0] * mpc,
        rect.minZ + fp[1] * mpc,
        rect.minX + (fp[0] + fp[2]) * mpc,
        rect.minZ + (fp[1] + fp[3]) * mpc,
      ]);
      assert.ok(Math.abs(m.hM - volumeHeightM(v, mpc)) < 1e-9);
    }
  });

  it("interior: sin cielo, aspect fijo del encuadre, techo hasta cámara, vanos tallados", () => {
    const spec = buildGreyboxSpec(interiorPlan(), "posada_salon");
    assert.equal(spec.sky, null);
    assert.equal(spec.fog, null);
    // v3: aspect FIJO por modo (interior 1.6, más íntimo que el 2.0 exterior).
    assert.ok(Math.abs(spec.view_box.width / spec.view_box.height - 1.6) < 1e-9, "aspect 1.6");
    // El techo cubre desde la pared del fondo hasta la cámara (banda superior
    // del frame sin vacío negro).
    const ceiling = spec.primitives.find((p) => p.pos[1] === 3.5 && p.size[2] > spec.proj.depth_m);
    assert.ok(ceiling, "techo extendido hacia la cámara");
    // El vano este parte la pared lateral: al menos 2 segmentos de pared en x=+6.
    const eastSegs = spec.primitives.filter(
      (p) => p.shape === "box" && Math.abs(p.pos[0] - 6) < 1e-6 && p.size[1] === 3.5,
    );
    assert.ok(eastSegs.length >= 2, `pared este partida por el vano (${eastSegs.length})`);
  });

  it("exterior: cielo + niebla + colinas, y el view_box cubre el edificio alto", () => {
    const plan = exteriorPlan();
    const spec = buildGreyboxSpec(plan, "pueblo");
    assert.ok(spec.sky && spec.fog);
    const casa = spec.manifest.find((m) => m.id === "vol_casa_alta")!;
    // La caja del edificio no toca el borde superior (el view_box se amplió).
    assert.ok(casa.box_px[1] > 0, "top del edificio dentro del encuadre");
  });

  it("v3: ventana anclada al horizonte — fracción sobre el horizonte por modo", () => {
    // Exterior: ~38% de cielo (v2 dejaba 75% en platós anchos); interior ~32%
    // de techo+pared (v6: 0.44 hacía del techo una losa protagonista). La
    // salvaguarda de volúmenes altos puede ABRIR la ventana hacia arriba
    // (fracción mayor), nunca cerrarla.
    for (const [plan, frac] of [
      [exteriorPlan(), 0.38],
      [interiorPlan(), 0.32],
    ] as const) {
      const spec = buildGreyboxSpec(plan, "frac");
      const above = (spec.proj.horizon_y - spec.view_box.minY) / spec.view_box.height;
      assert.ok(above >= frac - 1e-9 && above <= frac + 0.25, `sobre-horizonte ${above.toFixed(3)} vs ${frac}`);
    }
  });

  it("v3: stage.focal_m es la intención de cámara, clampada por cobertura del ancho", () => {
    const base = exteriorPlan(); // 24 m de ancho
    const rDefault = buildGreyboxSpec(base, "f").camera.retreat_m;
    // focal_m corto acerca la cámara (hasta el clamp de hfov 100°).
    const cerca = { ...base, stage: { ...base.stage, focal_m: 6 } };
    const rCerca = buildGreyboxSpec(cerca, "f").camera.retreat_m;
    assert.ok(rCerca < rDefault, `${rCerca} < ${rDefault}`);
    const halfW = 24 / 2 + 0.8;
    assert.ok(Math.abs(rCerca - halfW / Math.tan((100 / 2) * Math.PI / 180)) < 1e-9, "clamp gran angular");
    // focal_m largo aleja, con techo en hfov 70°.
    const lejos = { ...base, stage: { ...base.stage, focal_m: 99 } };
    const rLejos = buildGreyboxSpec(lejos, "f").camera.retreat_m;
    assert.ok(rLejos > rDefault);
    assert.ok(Math.abs(rLejos - halfW / Math.tan((70 / 2) * Math.PI / 180)) < 1e-9, "clamp tele");
    // Dentro del rango, se respeta tal cual.
    const medio = { ...base, stage: { ...base.stage, focal_m: rDefault + 1 } };
    assert.ok(Math.abs(buildGreyboxSpec(medio, "f").camera.retreat_m - (rDefault + 1)) < 1e-9);
  });

  it("v3: render_px nativo — múltiplos de 16 y mismo aspect que el view_box", () => {
    for (const plan of [interiorPlan(), exteriorPlan()]) {
      const spec = buildGreyboxSpec(plan, "px");
      const [w, h] = spec.render_px;
      assert.equal(w % 16, 0);
      assert.equal(h % 16, 0);
      const vbAspect = spec.view_box.width / spec.view_box.height;
      assert.ok(Math.abs(w / h - vbAspect) < 0.05, `aspect render ${w / h} vs vb ${vbAspect}`);
    }
    assert.deepEqual(buildGreyboxSpec(exteriorPlan(), "px").render_px, [1280, 640]);
    assert.deepEqual(buildGreyboxSpec(interiorPlan(), "px").render_px, [1280, 800]);
  });

  it("v6: un volumen muy alto abre la ventana hacia ARRIBA anclando el borde inferior", () => {
    const base = buildGreyboxSpec(exteriorPlan(), "torre-base");
    const plan = exteriorPlan();
    plan.volumes.push({
      id: "torre_vigia", label: "torre vigía", type: "tower", at: [24, 6], r: 3, h: 24,
    });
    const spec = buildGreyboxSpec(plan, "torre");
    const torre = spec.manifest.find((m) => m.id === "vol_torre_vigia")!;
    assert.ok(torre.box_px[1] > 0, "top de la torre dentro del encuadre");
    // El borde INFERIOR no se mueve (v5 trasladaba la ventana y recortaba el
    // delantal); la ventana CRECE por arriba.
    const bottomOf = (s: typeof spec): number => s.view_box.minY + s.view_box.height;
    assert.ok(Math.abs(bottomOf(spec) - bottomOf(base)) < 1e-9, "borde inferior fijo");
    assert.ok(spec.view_box.minY < base.view_box.minY, "la ventana se amplió hacia arriba");
    assert.ok(spec.view_box.height > base.view_box.height);
    // render_px sigue el aspect REAL de la ventana ampliada (nada anamórfico).
    const [w, h] = spec.render_px;
    assert.equal(w % 16, 0);
    assert.equal(h % 16, 0);
    const vbAspect = spec.view_box.width / spec.view_box.height;
    assert.ok(Math.abs(w / h - vbAspect) < 0.05, `aspect render ${w / h} vs vb ${vbAspect}`);
  });

  it("v6: fourth_wall + style_tag exterior es contradicción — el plan lanza", async () => {
    const { stagePlanFromScene } = await import("../src/scene/stage/plan.js");
    const raw = {
      size: { cols: 24, rows: 16, meters_per_cell: 0.5 },
      style_tag: "stage_street",
      stage: {
        exits: [
          { id: "s", edge: "south", to_place_id: "x", zone: [10, 14, 4, 2], kind: "opening", label: "Salida" },
        ],
        fourth_wall: { present: true },
      },
      entities: [],
    };
    assert.throws(() => stagePlanFromScene(raw), /stage_interior/);
    // El mismo plató etiquetado interior pasa y propaga el tag.
    const ok = stagePlanFromScene({ ...raw, style_tag: "stage_interior" })!;
    assert.equal(ok.style_tag, "stage_interior");
  });

  it("v6: alturas semánticas — mobiliario sin h sale a escala creíble y uniforme", async () => {
    const { stagePlanFromScene } = await import("../src/scene/stage/plan.js");
    const raw = {
      size: { cols: 24, rows: 16, meters_per_cell: 0.5 },
      stage: {
        exits: [
          { id: "s", edge: "south", to_place_id: "x", zone: [10, 14, 4, 2], kind: "opening", label: "Salida" },
        ],
      },
      entities: [
        // Dos mesas con kinds DISTINTOS y sin h: antes salían a 0.5 y 1.5 m.
        { id: "m1", kind: "prop", name: "mesa grande", cell: [4, 4], footprint: [2, 2], glyph: "m" },
        { id: "m2", kind: "decor", name: "mesa del rincón", cell: [10, 4], footprint: [2, 2], glyph: "m" },
        { id: "b1", kind: "prop", name: "barril de vino", cell: [16, 4], footprint: [1, 1], glyph: "b", shape: "cylinder" },
        { id: "e1", kind: "prop", name: "estantería de jarras", cell: [20, 4], footprint: [1, 2], glyph: "e" },
        // Label desconocido: default genérico por kind (prop 1.0 m).
        { id: "x1", kind: "prop", name: "trasto raro", cell: [4, 10], footprint: [1, 1], glyph: "x" },
      ],
    };
    const plan = stagePlanFromScene(raw)!;
    const spec = buildGreyboxSpec(plan, "semantic-h");
    const hOf = (id: string): number => spec.manifest.find((m) => m.id === `vol_derived_ent_${id}`)!.hM;
    assert.ok(Math.abs(hOf("m1") - 0.75) < 0.06, `mesa prop ${hOf("m1")} ≈ 0.75`);
    assert.ok(Math.abs(hOf("m2") - 0.75) < 0.06, `mesa decor ${hOf("m2")} ≈ 0.75`);
    assert.equal(hOf("m1"), hOf("m2"), "dos mesas sin h ⇒ MISMA altura");
    assert.ok(Math.abs(hOf("b1") - 0.9) < 0.06, `barril ${hOf("b1")} ≈ 0.9`);
    assert.ok(Math.abs(hOf("e1") - 2.0) < 0.06, `estantería ${hOf("e1")} ≈ 2.0`);
    assert.ok(Math.abs(hOf("x1") - 1.0) < 0.06, `label desconocido ${hOf("x1")} ≈ 1.0`);
  });

  it("v6: volume prop DECLARADO sin h también recibe altura semántica", async () => {
    const { stagePlanFromScene } = await import("../src/scene/stage/plan.js");
    const raw = {
      size: { cols: 24, rows: 16, meters_per_cell: 0.5 },
      stage: {
        exits: [
          { id: "s", edge: "south", to_place_id: "x", zone: [10, 14, 4, 2], kind: "opening", label: "Salida" },
        ],
      },
      entities: [],
      volumes: [
        { id: "mesa_v", label: "mesa del fondo", type: "prop", rect: [6, 6, 2, 1], shape: "box" },
      ],
    };
    const plan = stagePlanFromScene(raw)!;
    const spec = buildGreyboxSpec(plan, "declared-h");
    const mesa = spec.manifest.find((m) => m.id === "vol_mesa_v")!;
    assert.ok(Math.abs(mesa.hM - 0.75) < 0.06, `mesa declarada ${mesa.hM} ≈ 0.75`);
  });

  it("F2: el h declarado por entity manda en el clay del proscenio (vía derive)", async () => {
    const { stagePlanFromScene } = await import("../src/scene/stage/plan.js");
    const raw = {
      size: { cols: 24, rows: 16, meters_per_cell: 0.5 },
      stage: {
        exits: [
          { id: "s", edge: "south", to_place_id: "x", zone: [10, 14, 4, 2], kind: "opening", label: "Salida" },
        ],
      },
      entities: [
        { id: "barril", kind: "prop", name: "barril de cerveza", cell: [4, 4], footprint: [1, 1], glyph: "k", shape: "cylinder", h: 0.9 },
        { id: "casa", kind: "building", name: "casa alta", cell: [10, 2], footprint: [8, 4], glyph: "C", h: 6 },
        { id: "olmo", kind: "tree", name: "olmo viejo", cell: [20, 8], footprint: [2, 2], glyph: "T", h: 7 },
      ],
    };
    const plan = stagePlanFromScene(raw)!;
    const spec = buildGreyboxSpec(plan, "h-test");
    const hOf = (id: string): number => spec.manifest.find((m) => m.id === `vol_derived_ent_${id}`)!.hM;
    // v2 aplastaba TODO a 1.5 m (props) y 3.75 m (buildings).
    assert.ok(Math.abs(hOf("barril") - 0.9) < 0.11, `barril ${hOf("barril")} ≈ 0.9 m`);
    assert.ok(Math.abs(hOf("casa") - 6) < 0.31, `casa ${hOf("casa")} ≈ 6 m`);
    assert.ok(Math.abs(hOf("olmo") - 7) < 0.5, `olmo ${hOf("olmo")} ≈ 7 m`);
  });

  it("F2: heurísticas de silueta — mesa con patas, carro con ruedas, edificio con plantas", () => {
    const plan = exteriorPlan();
    plan.volumes.push(
      { id: "mesa_taberna", label: "mesa de la taberna", type: "prop", rect: [30, 10, 4, 2], shape: "box", h: 2 },
      { id: "carro_heno", label: "carro de heno", type: "prop", rect: [36, 14, 4, 2], shape: "box", h: 3 },
      // Casa de dos plantas (muros de 6 m): dos filas de ventanas.
      { id: "casa_dos_plantas", label: "casa de dos plantas", type: "building", rect: [24, 4, 10, 8], wall_h: 12 },
    );
    const spec = buildGreyboxSpec(plan, "siluetas");
    const of = (volId: string) => spec.primitives.filter((p) => p.volId === `vol_${volId}`);
    assert.ok(of("mesa_taberna").length >= 5, "mesa = tablero + 4 patas");
    assert.ok(of("carro_heno").some((p) => p.rotX !== undefined), "carro con ruedas tumbadas");
    const ventanas = of("casa_dos_plantas").filter((p) => p.size[0] === 0.7);
    assert.ok(ventanas.length >= 3, `ventanas por planta (${ventanas.length})`);
    const alturas = new Set(ventanas.map((p) => p.pos[1]));
    assert.ok(alturas.size >= 2, "dos filas de ventanas a alturas distintas");
  });

  it("F3: hora del día — declarada, inferida del texto y default", async () => {
    const { resolveTimeOfDay } = await import("../src/scene/stage/greybox.js");
    const base = exteriorPlan();
    assert.equal(resolveTimeOfDay(base), "dia");
    // Inferida del backdrop (el save real dice "luz de atardecer").
    base.stage.backdrop = { description: "Fachadas encaladas; luz de atardecer." };
    assert.equal(resolveTimeOfDay(base), "atardecer");
    // La declarada MANDA sobre el texto.
    base.stage.ambience = { time_of_day: "noche" };
    assert.equal(resolveTimeOfDay(base), "noche");
    // El preset cambia sol, cielo y niebla del spec.
    const dia = buildGreyboxSpec(exteriorPlan(), "tod");
    const noche = buildGreyboxSpec(base, "tod");
    assert.notEqual(dia.sky!.top, noche.sky!.top);
    assert.notEqual(dia.fog!.color, noche.fog!.color);
    const sunDia = dia.lights.find((l) => l.kind === "sun")!;
    const sunNoche = noche.lights.find((l) => l.kind === "sun")!;
    assert.notEqual(sunDia.color, sunNoche.color);
  });

  it("v7: tierra y empedrado se distinguen en el clay", async () => {
    const { groundColorFor } = await import("../src/scene/greybox/common.js");
    const tierra = groundColorFor("tierra apisonada");
    const empedrado = groundColorFor("empedrado");
    assert.ok(tierra && empedrado, "ambos materiales tienen color de suelo");
    assert.notEqual(tierra, empedrado, "la pareja tierra/empedrado debe contrastar");
  });

  it("v7: el atardecer lleva relleno hemisférico cálido y el sol sigue frontal", () => {
    const plan = exteriorPlan();
    plan.stage.ambience = { time_of_day: "atardecer" };
    const spec = buildGreyboxSpec(plan, "ocaso");
    const hemi = spec.lights.find((l) => l.kind === "hemi")!;
    assert.ok(hemi.intensity >= 1.3, "hemisférica de relleno intensa");
    // groundColor cálido: canal rojo dominante sobre el azul.
    const g = parseInt(hemi.groundColor!.slice(1), 16);
    assert.ok(((g >> 16) & 255) > (g & 255), "rebote del suelo cálido");
    const sun = spec.lights.find((l) => l.kind === "sun")!;
    const az = Math.abs((Math.atan2(sun.pos![0], sun.pos![2]) * 180) / Math.PI);
    assert.ok(az <= 60.01, `sol dentro del cono frontal (az=${az.toFixed(1)}°)`);
  });

  it("F3: labels de fuego encienden una luz práctica + resplandor en el clay", () => {
    const plan = interiorPlan();
    plan.volumes.push({
      id: "chimenea_salon", label: "chimenea encendida", type: "prop",
      rect: [20, 2, 2, 3], shape: "box", h: 5,
    });
    const spec = buildGreyboxSpec(plan, "fuego");
    const points = spec.lights.filter((l) => l.kind === "point");
    assert.equal(points.length, 1);
    assert.ok(points[0].pos![1] > 0, "punto sobre el volumen");
    const glow = spec.primitives.find(
      (p) => p.volId === "vol_chimenea_salon" && p.color === "#ffa04e",
    );
    assert.ok(glow, "resplandor en el clay");
    // Sin labels de fuego, cero prácticas.
    assert.equal(
      buildGreyboxSpec(interiorPlan(), "fuego").lights.filter((l) => l.kind === "point").length,
      0,
    );
  });

  it("expectedElementsFromGreybox conserva el contrato de pistas", () => {
    const spec = buildGreyboxSpec(interiorPlan(), "hints");
    const els = expectedElementsFromGreybox(spec);
    assert.equal(els.length, spec.manifest.length);
    for (const e of els) {
      assert.ok(e.id.startsWith("vol_"));
      assert.equal(e.tall, true);
      assert.equal(e.solid, true);
    }
  });

  it("canónico estable ante floats: redondeo a 1e-4", () => {
    const spec = buildGreyboxSpec(interiorPlan(), "round");
    const canon = canonicalGreyboxJson(spec);
    // Ningún número con más de 4 decimales sobrevive al canónico.
    assert.ok(!/\d\.\d{5,}/.test(canon), "floats largos en el canónico");
  });
});
