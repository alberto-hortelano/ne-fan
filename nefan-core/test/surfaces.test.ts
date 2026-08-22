/** Superficies del modo FPS: clasificación, layout determinista y el spec
 *  fps del tile. El JSON canónico del layout es el CONTRATO con el pintor
 *  Python (surface_atlas_generator.py) — si cambia aquí, cambia allí. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFpsTileSpec } from "../src/scene/blueprint/fps-spec.js";
import { parseVolumes } from "../src/scene/blueprint/volumes.js";
import { wallColors } from "../src/scene/blueprint/palette.js";
import {
  MAT_INFO,
  buildLayout,
  canonicalSurfaceLayoutJson,
  classify,
  type SurfacePrim,
} from "../src/scene/greybox/surfaces.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Plan de tile de una sesión real (era `labs/render/fixtures/medieval/`).
 *  Vive aquí porque `labs/render` se archiva y este plan es la entrada del
 *  golden del atlas (`fps-atlas-golden.test.ts`). */
const medievalPlan = () =>
  JSON.parse(readFileSync(join(HERE, "fixtures", "fps-plans", "medieval.json"), "utf-8")) as {
    volumes: unknown;
    biome?: string;
  };

function medievalPrims(): { primsM: SurfacePrim[]; volumes: ReturnType<typeof parseVolumes> } {
  const plan = medievalPlan();
  const parsed = parseVolumes(plan.volumes);
  assert.ok(parsed.ok, "fixture medieval parsea");
  const { primsM } = buildFpsTileSpec({ volumes: parsed.volumes, biome: plan.biome ?? "grass" }, "test_fps");
  return { primsM, volumes: parsed };
}

describe("surfaces: classify", () => {
  const box = (over: Partial<SurfacePrim>): SurfacePrim => ({
    shape: "box",
    size: [4, 2.5, 4],
    pos: [0, 0, 0],
    color: wallColors("plaster").lit,
    cat: "building",
    ...over,
  });

  it("hastiales del gable son MURO, faldones teja (hallazgo del bench)", () => {
    const gable: SurfacePrim = { shape: "gable", size: [4, 2, 4], pos: [0, 2.5, 0], color: "#a05a38", cat: "building" };
    assert.equal(classify(gable, "caps"), "wall_plaster");
    assert.equal(classify(gable, "side"), "roof_tile");
  });

  it("puerta pintada, muros por color, suelo grande vs detalle", () => {
    assert.equal(classify(box({ color: "#2a2018" }), "side"), "door_wood");
    assert.equal(classify(box({ color: wallColors("timber").lit }), "side"), "wall_timber");
    assert.equal(classify(box({ color: "#b3a68e" }), "side"), "wall_stone");
    const suelo = box({ cat: "terrain", size: [64, 0.05, 64], color: "#8d6f4e" });
    assert.equal(classify(suelo, "top"), "ground_dirt");
    const detalle: SurfacePrim = { shape: "polygon", size: [0.01], pos: [0, 0, 0], points: [[0, 0], [1, 0], [1, 1]], color: "#aaa17e", cat: "terrain" };
    assert.equal(classify(detalle, "caps"), null);
  });


  /** CANDADO: el material que declara el motor tiene que llegar al pintor.
   *  Va por el CONSTRUCTOR real (`buildFpsTileSpec`), no por colores
   *  escritos a mano: la versión anterior de este test fijaba los mismos
   *  literales equivocados que el clasificador, así que ambos coincidían en
   *  el error y `walls:{material:"plaster"}` se pintaba como mampostería
   *  durante meses sin que nada fallara. */
  it("el material declarado de una fachada llega al pintor (vía builder)", () => {
    const esperado: Record<string, string> = {
      plaster: "wall_plaster",
      timber: "wall_timber",
      wood: "wood_planks",
      stone: "wall_stone",
    };
    for (const [material, clase] of Object.entries(esperado)) {
      const parsed = parseVolumes([
        {
          id: "casa", label: "casa", type: "building",
          rect: [40, 40, 16, 12], wall_h: 12,
          roof: { kind: "flat", material: "tile" },
          walls: { material },
        },
      ]);
      assert.ok(parsed.ok, `volumen con material ${material} parsea`);
      const { primsM } = buildFpsTileSpec({ volumes: parsed.volumes, biome: "dirt" }, "test_mat");
      const cuerpo = primsM.find((p) => p.cat === "building" && p.shape === "box" && p.size[1] > 1);
      assert.ok(cuerpo, `hay cuerpo de edificio para ${material}`);
      assert.equal(
        classify(cuerpo, "side"), clase,
        `walls.material "${material}" debe pintarse como ${clase} (color ${cuerpo.color})`,
      );
    }
  });

  it("mat por-prim: string, objeto con fallthrough y false→clay", () => {
    assert.equal(classify(box({ mat: "stone_floor" }), "top"), "stone_floor");
    assert.equal(classify(box({ mat: { top: "stone_floor" } }), "top"), "stone_floor");
    // clave ausente en el objeto → reglas por defecto
    assert.equal(classify(box({ mat: { top: "stone_floor" } }), "side"), "wall_plaster");
    assert.equal(classify(box({ mat: { side: false } }), "side"), null);
  });

  it("toda clase del catálogo tiene descripción no vacía", () => {
    for (const [mat, info] of Object.entries(MAT_INFO)) {
      assert.ok(info.en.length > 10, `descripción corta en ${mat}`);
    }
  });
});

describe("surfaces: layout", () => {
  it("determinista: dos construcciones dan el mismo JSON canónico", () => {
    const { primsM } = medievalPrims();
    const a = canonicalSurfaceLayoutJson(buildLayout(primsM));
    const b = canonicalSurfaceLayoutJson(buildLayout(primsM));
    assert.equal(a, b);
  });

  it("≤12 celdas por página, tiles primero, rects dentro de página", () => {
    const { primsM } = medievalPrims();
    const layout = buildLayout(primsM);
    assert.ok(layout.pages.length >= 1);
    for (const page of layout.pages) {
      assert.ok(page.cells.length <= 12);
      for (const cell of page.cells) {
        const [x, y, w, h] = cell.rect ?? [0, 0, 0, 0];
        assert.ok(x >= 0 && y >= 0 && x + w <= layout.page_px && y + h <= layout.page_px, cell.key);
      }
    }
    const kinds = layout.pages.flatMap((p) => p.cells.map((c) => c.kind));
    const firstUnique = kinds.indexOf("unique");
    if (firstUnique >= 0) {
      assert.ok(kinds.slice(firstUnique).every((k) => k === "unique"), "tiles antes que uniques");
    }
    // La asignación referencia celdas existentes.
    const keys = new Set(layout.pages.flatMap((p) => p.cells.map((c) => c.key)));
    for (const a of layout.assign) {
      for (const key of Object.values(a.groups)) {
        if (key) assert.ok(keys.has(key), `assign a celda inexistente ${key}`);
      }
    }
  });
});

describe("buildFpsTileSpec", () => {
  it("cierra cutaways, escala a metros y NO muta el plan", () => {
    const plan = medievalPlan();
    const parsed = parseVolumes(plan.volumes);
    assert.ok(parsed.ok);
    const taberna = parsed.volumes.find((v) => v.id === "taberna_serrana");
    assert.ok(taberna && taberna.type === "building" && taberna.cutaway === true, "la fixture tiene un cutaway");
    const { spec, primsM } = buildFpsTileSpec({ volumes: parsed.volumes, biome: "dirt" }, "k");
    // No mutación: el plan de entrada conserva su cutaway.
    assert.equal((taberna as { cutaway?: boolean }).cutaway, true);
    // Cerrado: el edificio emite tejado (gable) en el spec fps.
    const tabernaPrims = spec.primitives.filter((p) => p.volId === "vol_taberna_serrana");
    assert.ok(tabernaPrims.some((p) => p.shape === "gable"), "taberna cerrada con tejado");
    // Metros: el suelo base mide 64 m y las alturas quedan en rango humano.
    const floor = primsM.find((p) => p.cat === "terrain" && p.shape === "box");
    assert.ok(floor && Math.abs(floor.size[0] - 64) < 1e-6);
    const wallPrim = primsM.find((p) => p.cat === "building" && p.size[1] > 1);
    assert.ok(wallPrim && wallPrim.size[1] <= 12, "alturas en metros, no celdas");
  });

  it("surface_desc string → hero SOLO en el cuerpo; tejado y puerta conservan su material", () => {
    const plan = medievalPlan();
    const parsed = parseVolumes(plan.volumes);
    assert.ok(parsed.ok);
    const volumes = parsed.volumes.map((v) =>
      v.id === "taberna_serrana" ? { ...v, surface_desc: "facade with a faded sun mural" } : v,
    );
    const { primsM } = buildFpsTileSpec({ volumes, biome: "dirt" }, "k");
    const layout = buildLayout(primsM);
    const cells = layout.pages.flatMap((p) => p.cells);
    const heroes = cells.filter((c) => c.heroOf === "vol_taberna_serrana");
    assert.equal(heroes.length, 1, "una sola celda hero (las paredes)");
    assert.equal(heroes[0].key, "hero_vol_taberna_serrana_side");
    assert.equal(heroes[0].en, "facade with a faded sun mural");
    assert.equal(heroes[0].kind, "unique");
    // El bug del playtest 2026-08-16: tejado y puerta caían en la MISMA celda
    // hero. Ahora vuelven a sus clases (roof_tile/door_wood siguen existiendo
    // como celdas del tile — la taberna las usa).
    assert.ok(cells.some((c) => c.key === "roof_tile"), "el tejado sigue en roof_tile");
    assert.ok(cells.some((c) => c.key === "door_wood"), "la puerta sigue en door_wood");
  });

  it("surface_desc objeto → celda propia por cara/rol con desc y tamaño de SU cara", () => {
    const volumes = parseVolumes([
      {
        id: "cartel",
        label: "cartel",
        type: "prop",
        rect: [40, 40, 8, 1],
        shape: "box",
        h: 6,
        surface_desc: { s: "sign reading EL FILTRO", n: "weathered back of a metal sign" },
      },
      {
        id: "casa",
        label: "casa",
        type: "building",
        rect: [60, 60, 12, 10],
        doors: [{ edge: "s", at: 4 }],
        surface_desc: { side: "riveted hull plating facade", roof: "solar panel roof", door: "airlock door" },
      },
    ]);
    assert.ok(volumes.ok, !volumes.ok ? volumes.error : "");
    const { primsM } = buildFpsTileSpec({ volumes: volumes.volumes, biome: "dirt" }, "k");
    const layout = buildLayout(primsM);
    const byKey = new Map(layout.pages.flatMap((p) => p.cells).map((c) => [c.key, c]));
    // Cartel: cara sur y norte con celdas DISTINTAS (desc propia ⇒ imagen
    // propia); los cantos e/w quedan en el material del cuerpo.
    const s = byKey.get("hero_vol_cartel_s");
    const n = byKey.get("hero_vol_cartel_n");
    assert.ok(s && n, "celdas por cara del cartel");
    assert.equal(s.en, "sign reading EL FILTRO");
    assert.equal(n.en, "weathered back of a metal sign");
    // Tamaño de SU cara: s/n = [w, h] = [4 m, 3 m] (8×1 celdas, h 6).
    assert.ok(Math.abs(s.worldW - 4) < 1e-6 && Math.abs(s.worldH - 3) < 1e-6, `cara s ${s.worldW}×${s.worldH}`);
    assert.equal(byKey.has("hero_vol_cartel_side"), false, "sin celda side: solo caras declaradas");
    // Casa: fachadas, tejado y puerta con celdas separadas.
    assert.equal(byKey.get("hero_vol_casa_side")?.en, "riveted hull plating facade");
    assert.equal(byKey.get("hero_vol_casa_roof")?.en, "solar panel roof");
    assert.equal(byKey.get("hero_vol_casa_door")?.en, "airlock door");
    // La asignación por SLOT del cartel apunta a las celdas por cara
    // (BoxGeometry: +z=s → slot 4, −z=n → slot 5).
    const cartelIdx = primsM.findIndex((p) => p.volId === "vol_cartel");
    const faces = layout.assign[cartelIdx]?.faces;
    assert.ok(faces, "assign.faces del cartel");
    assert.equal(faces["4"], "hero_vol_cartel_s");
    assert.equal(faces["5"], "hero_vol_cartel_n");
  });

  it("surface_desc objeto inválido (cara desconocida) se rechaza en el schema", () => {
    const bad = parseVolumes([
      { id: "x", label: "x", type: "prop", at: [10, 10], shape: "box", surface_desc: { techo: "no existe" } },
    ]);
    assert.equal(bad.ok, false);
  });

  it("stagger anti z-fighting: los rasgos ground no comparten y, determinista", () => {
    const plan = medievalPlan();
    const parsed = parseVolumes(plan.volumes);
    assert.ok(parsed.ok);
    // Camino con codo (2 cajas + 3 juntas cilíndricas) + plaza: en el greybox
    // compartido todas las prims de una capa son coplanares exactas.
    const ground = [
      { id: "camino", kind: "path" as const, points: [[20, 20], [80, 20], [80, 80]] as [number, number][], w: 4, material: "dirt" as const },
      { id: "plaza", kind: "area" as const, rect: [30, 30, 20, 20] as [number, number, number, number], material: "cobblestone" as const },
    ];
    const build = () =>
      buildFpsTileSpec({ ground, volumes: parsed.volumes, biome: "dirt" }, "test_fps");
    const { spec, primsM } = build();
    // Rasgos ground = prims terrain|water noShadow en la banda de capas
    // (Y_AREA 0.05 … Y_DECK 0.18 en celdas → índice compartido con el spec).
    const isGroundBand = (p: { cat: string; noShadow?: boolean }, y: number, scale: number): boolean =>
      (p.cat === "terrain" || p.cat === "water") && p.noShadow === true && y >= 0.045 * scale && y <= (0.185 + 60 * 0.004) * scale;
    const specGround = spec.primitives.filter((p) => isGroundBand(p, p.pos[1], 1));
    assert.ok(specGround.length >= 6, `camino+plaza emiten ≥6 prims ground (hay ${specGround.length})`);
    // El enriquecimiento fps (fps-detail/scatter) rompe la paridad de índices
    // pero PRESERVA el orden relativo de los rasgos ground y no añade prims
    // en su banda: se casan por orden de emisión.
    const primsGround = primsM.filter((p) => isGroundBand(p, p.pos[1], 0.5));
    assert.equal(primsGround.length, specGround.length, "mismos rasgos ground en el spec fps");
    const ys = primsGround.map((p) => p.pos[1]);
    assert.equal(new Set(ys).size, ys.length, "ninguna pareja de rasgos ground comparte y exacta");
    // Cada prim sube respecto a su y escalada, poco (stagger mm, no cm por prim).
    specGround.forEach((sp, j) => {
      const lift = primsGround[j].pos[1] - sp.pos[1] * 0.5;
      assert.ok(lift > 0 && lift <= specGround.length * 0.002 + 1e-9, `lift ${lift} en rango`);
    });
    // Determinista: dos builds → mismas y.
    const again = build();
    assert.deepEqual(
      again.primsM.filter((p) => isGroundBand(p, p.pos[1], 0.5)).map((p) => p.pos[1]),
      ys,
    );
  });
});

describe("surface_ref: refs de cara del atlas fps", () => {
  const baseVol = {
    id: "casa",
    label: "casa",
    type: "building",
    rect: [60, 60, 12, 10],
    doors: [{ edge: "s", at: 4 }],
  };

  it("string → ref en TODAS las celdas de surface_desc; omitida sin ref (layout estable)", () => {
    const conRef = parseVolumes([
      { ...baseVol, surface_desc: { side: "hull plating", roof: "solar roof" }, surface_ref: "fachada" },
    ]);
    assert.ok(conRef.ok, !conRef.ok ? conRef.error : "");
    const { primsM } = buildFpsTileSpec({ volumes: conRef.volumes, biome: "dirt" }, "k");
    const cells = buildLayout(primsM).pages.flatMap((p) => p.cells);
    const heroes = cells.filter((c) => c.heroOf === "vol_casa");
    assert.ok(heroes.length >= 2, "celdas side y roof");
    for (const h of heroes) assert.equal(h.ref, "fachada", h.key);
    // Con ref, el JSON canónico la incluye; sin ref, NI LA MENCIONA (los
    // layoutKeys del contenido existente quedan byte-idénticos).
    const sinRef = parseVolumes([{ ...baseVol, surface_desc: { side: "hull plating", roof: "solar roof" } }]);
    assert.ok(sinRef.ok);
    const jsonCon = canonicalSurfaceLayoutJson(buildLayout(primsM));
    const jsonSin = canonicalSurfaceLayoutJson(
      buildLayout(buildFpsTileSpec({ volumes: sinRef.volumes, biome: "dirt" }, "k").primsM),
    );
    assert.ok(jsonCon.includes('"ref"'));
    assert.ok(!jsonSin.includes('"ref"'));
    assert.notEqual(jsonCon, jsonSin);
  });

  it("objeto → ref por cara (subconjunto de las descritas); custom parts con ref", () => {
    const parsed = parseVolumes([
      {
        ...baseVol,
        surface_desc: { side: "hull plating", roof: "solar roof", door: "airlock" },
        surface_ref: { roof: "techo_solar" },
      },
      {
        id: "carreta",
        label: "carreta",
        type: "custom",
        at: [20, 20],
        parts: [
          { shape: "box", size: [4, 2, 6], desc: "wooden cart body", ref: "carro" },
          { shape: "cylinder", rBottom: 1, h: 0.4 },
        ],
      },
    ]);
    assert.ok(parsed.ok, !parsed.ok ? parsed.error : "");
    const { primsM } = buildFpsTileSpec({ volumes: parsed.volumes, biome: "dirt" }, "k");
    const cells = buildLayout(primsM).pages.flatMap((p) => p.cells);
    const roof = cells.find((c) => c.key === "hero_vol_casa_roof");
    const side = cells.find((c) => c.key === "hero_vol_casa_side");
    const door = cells.find((c) => c.key === "hero_vol_casa_door");
    assert.equal(roof?.ref, "techo_solar");
    assert.equal(side?.ref, undefined, "cara sin clave de ref queda sin ref");
    assert.equal(door?.ref, undefined);
    const pieza = cells.find((c) => c.key === "hero_vol_carreta_p0");
    assert.equal(pieza?.ref, "carro");
  });

  it("parseVolumes: surface_ref sin surface_desc y clave sin cara descrita se rechazan", () => {
    const sinDesc = parseVolumes([{ ...baseVol, surface_ref: "fachada" }]);
    assert.ok(!sinDesc.ok && /surface_ref/.test(sinDesc.error));
    const caraNoDescrita = parseVolumes([
      { ...baseVol, surface_desc: { side: "hull" }, surface_ref: { roof: "techo" } },
    ]);
    assert.ok(!caraNoDescrita.ok && /roof/.test(caraNoDescrita.error));
    // Con surface_desc string, el conjunto descrito es {side}.
    const stringSide = parseVolumes([
      { ...baseVol, surface_desc: "hull plating", surface_ref: { side: "fachada" } },
    ]);
    assert.ok(stringSide.ok, !stringSide.ok ? stringSide.error : "");
    // Custom part: ref sin desc rechazada por el schema.
    const partSinDesc = parseVolumes([
      {
        id: "x", label: "x", type: "custom", at: [10, 10],
        parts: [{ shape: "sphere", r: 1, ref: "carro" }],
      },
    ]);
    assert.ok(!partSinDesc.ok && /ref/.test(partSinDesc.error));
  });
});
