/** Riqueza fps (post-procesos fps-only): cutaways enterables (muros con vano
 *  espejo de la colisión, suelo interior, sin cuerpo macizo), relieve del
 *  suelo (determinista, aplanado bajo lo construido) y variación de talla
 *  intra-especie de árboles. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFpsTileSpec } from "../src/scene/blueprint/fps-spec.js";
import { buildReliefGrid, reliefAtM } from "../src/scene/blueprint/fps-relief.js";
import { parseVolumes } from "../src/scene/blueprint/volumes.js";
import { parseGround } from "../src/scene/blueprint/ground.js";

const POSADA = {
  id: "posada",
  label: "posada",
  type: "building",
  rect: [44, 30, 16, 12],
  wall_h: 5,
  cutaway: true,
  doors: [{ edge: "s", at: 6 }],
};

function vols(raw: unknown[]) {
  const p = parseVolumes(raw);
  assert.ok(p.ok, !p.ok ? p.error : "");
  return p.volumes;
}

describe("fps: cutaway enterable", () => {
  it("sustituye el cuerpo macizo por muros con vano + dintel + suelo", () => {
    const { primsM } = buildFpsTileSpec({ volumes: vols([POSADA]), biome: "meadow" }, "tile_0_0");
    const own = primsM.filter((p) => p.volId === "vol_posada");
    // Sin cuerpo macizo: ninguna box de la huella completa a ras de suelo.
    const solid = own.find((p) => p.shape === "box" && p.size[0] === 8 && p.size[2] === 6 && p.size[1] === 2.5);
    assert.equal(solid, undefined, "el box macizo 8×2.5×6 m no debe existir");
    // Muros: al menos 4 tramos a ras de suelo con la altura del muro (2.5 m).
    const walls = own.filter((p) => p.shape === "box" && p.pos[1] === 0 && p.size[1] === 2.5);
    assert.ok(walls.length >= 4, `tramos de muro: ${walls.length}`);
    // Vano sur: en la franja de la puerta (celdas 50..54 → 25..27 m) no hay
    // muro a ras de suelo en el borde sur (z ≈ 21 m), pero SÍ dintel arriba.
    const southWallAt = (x: number) =>
      walls.find((p) => Math.abs(p.pos[2] - 20.6) < 0.2 && Math.abs(p.pos[0] - x) < (p.size[0] / 2));
    assert.equal(southWallAt(26), undefined, "el vano de la puerta debe quedar abierto");
    const lintel = own.find((p) => p.shape === "box" && p.pos[1] === 2 && Math.abs(p.pos[2] - 20.6) < 0.2);
    assert.ok(lintel, "dintel sobre el vano");
    // Suelo interior y tejado conservado.
    assert.ok(own.some((p) => p.noShadow && p.shape === "box" && p.size[0] === 8 && p.size[2] === 6), "suelo interior");
    assert.ok(own.some((p) => p.shape === "gable"), "tejado gable conservado");
    // El panel de puerta pintado desaparece (el vano es real).
    assert.equal(own.find((p) => p.color === "#2a2018"), undefined);
  });

  it("un edificio SIN cutaway no cambia (cuerpo macizo intacto)", () => {
    const { primsM } = buildFpsTileSpec(
      { volumes: vols([{ ...POSADA, id: "granero", cutaway: undefined }]), biome: "meadow" },
      "tile_0_0",
    );
    const own = primsM.filter((p) => p.volId === "vol_granero");
    assert.ok(own.some((p) => p.shape === "box" && p.size[0] === 8 && p.size[2] === 6 && p.size[1] === 2.5));
    assert.ok(own.some((p) => p.color === "#2a2018"), "panel de puerta pintado se conserva");
  });
});

describe("fps: relieve del suelo", () => {
  const groundRaw = [
    { id: "camino", label: "camino", kind: "path", points: [[0, 64], [128, 64]], w: 6, material: "dirt" },
  ];
  function ground() {
    const g = parseGround(groundRaw);
    assert.ok(g.ok, !g.ok ? g.error : "");
    return g.features;
  }

  it("determinista, aplanado bajo camino y huella, ondulado en campo abierto", () => {
    const volumes = vols([POSADA]);
    const a = buildReliefGrid("meadow", volumes, ground(), "tile_0_0");
    const b = buildReliefGrid("meadow", volumes, ground(), "tile_0_0");
    assert.ok(a && b);
    assert.deepEqual(a, b, "mismo tile → misma rejilla");
    // Bajo el camino (z=32 m) y bajo la posada, plano.
    assert.ok(Math.abs(reliefAtM(a, 10, 32)) < 1e-9, "camino plano");
    assert.ok(Math.abs(reliefAtM(a, 26, 18)) < 1e-9, "huella plana");
    // En campo abierto hay ondulación en alguna parte (amplitud meadow 0.35).
    let maxAbs = 0;
    for (const h of a.heights) maxAbs = Math.max(maxAbs, Math.abs(h));
    assert.ok(maxAbs > 0.05, `amplitud viva: ${maxAbs}`);
    assert.ok(maxAbs <= 0.35 + 1e-9, `amplitud acotada: ${maxAbs}`);
  });

  it("tiles vecinos empalman: misma altura en la costura (ruido global)", () => {
    const a = buildReliefGrid("meadow", [], [], "tile_0_0");
    const b = buildReliefGrid("meadow", [], [], "tile_1_0");
    assert.ok(a && b);
    // Borde este de tile_0_0 (x=64 m) == borde oeste de tile_1_0 (x=0).
    for (const z of [8, 24, 40, 56]) {
      assert.ok(Math.abs(reliefAtM(a, 64, z) - reliefAtM(b, 0, z)) < 1e-9, `costura en z=${z}`);
    }
  });

  it("la prim del suelo del tile lleva la rejilla; las demás no", () => {
    const { primsM } = buildFpsTileSpec({ volumes: [], biome: "meadow" }, "tile_0_0");
    const withRelief = primsM.filter((p) => p.relief);
    assert.equal(withRelief.length, 1);
    assert.equal(withRelief[0].cat, "terrain");
    assert.equal(withRelief[0].size[0], 64);
  });
});

describe("fps: variación intra-especie", () => {
  it("dos árboles idénticos declarados difieren en talla (determinista)", () => {
    const trees = vols([
      { id: "manzano_a", label: "manzano", type: "tree", at: [20, 20], species: "manzano" },
      { id: "manzano_b", label: "manzano", type: "tree", at: [40, 40], species: "manzano" },
    ]);
    const run = () => buildFpsTileSpec({ volumes: trees, biome: "meadow" }, "tile_0_0");
    const { primsM } = run();
    const trunk = (id: string) =>
      primsM.find((p) => p.volId === `vol_${id}` && p.shape === "cylinder")!;
    assert.notEqual(trunk("manzano_a").size[1], trunk("manzano_b").size[1], "troncos distintos");
    const again = run().primsM.find((p) => p.volId === "vol_manzano_a" && p.shape === "cylinder")!;
    assert.equal(trunk("manzano_a").size[1], again.size[1], "determinista");
  });
});

describe("fps: vallas de estacas", () => {
  const CERCA = {
    id: "cerca",
    label: "cerca de estacas",
    type: "wall",
    points: [[20, 58], [52, 56]],
    width: 1,
    h: 2,
  };

  it("wall bajo → postes cilíndricos + dos travesaños (sin slab macizo)", () => {
    const { primsM } = buildFpsTileSpec({ volumes: vols([CERCA]), biome: "meadow" }, "tile_0_0");
    const own = primsM.filter((p) => p.volId === "vol_cerca");
    assert.equal(own.find((p) => p.shape === "box" && p.size[1] === 1 && p.size[2] === 0.5), undefined, "sin slab");
    const posts = own.filter((p) => p.shape === "cylinder");
    assert.ok(posts.length >= 6, `postes: ${posts.length}`);
    const rails = own.filter((p) => p.shape === "box" && p.size[1] < 0.2);
    assert.ok(rails.length >= 2, `travesaños: ${rails.length}`);
  });

  it("wall bajo de PIEDRA (label) o muralla alta conservan su slab", () => {
    const piedra = { ...CERCA, id: "tapia", label: "tapia de piedra" };
    const muralla = { ...CERCA, id: "muralla", label: "muralla", h: 10 };
    const { primsM } = buildFpsTileSpec({ volumes: vols([piedra, muralla]), biome: "meadow" }, "tile_0_0");
    assert.ok(primsM.some((p) => p.volId === "vol_tapia" && p.shape === "box" && p.size[1] === 1));
    assert.ok(primsM.some((p) => p.volId === "vol_muralla" && p.shape === "box" && p.size[1] === 5));
  });
});

describe("fps: ambientación inferida del texto", () => {
  it("de día no toca nada (luces y spec históricos)", () => {
    const dia = buildFpsTileSpec(
      { volumes: [], biome: "meadow", scene_description: "Mediodía en la pradera." },
      "tile_0_0",
    );
    const sinTexto = buildFpsTileSpec({ volumes: [], biome: "meadow" }, "tile_0_0");
    assert.equal(dia.timeOfDay, "dia");
    assert.deepEqual(dia.lightsM, sinTexto.lightsM, "luces históricas intactas");
    assert.equal(dia.sky, undefined);
  });

  it("la noche cambia luces/cielo/niebla y enciende las prácticas por label", () => {
    const farol = { id: "farol", label: "farol de la plaza", type: "prop", rect: [60, 60, 2, 2], h: 5, shape: "box" };
    const spec = buildFpsTileSpec(
      { volumes: vols([farol]), biome: "meadow", scene_description: "Cae la noche sobre el lindero; luna alta." },
      "tile_0_0",
    );
    assert.equal(spec.timeOfDay, "noche");
    assert.ok(spec.sky && spec.fog, "cielo y niebla nocturnos");
    assert.ok(spec.lightsM.some((l) => l.kind === "point" && l.color === "#ff9b4a"), "farol encendido");
    assert.ok(spec.lightsM.some((l) => l.kind === "hemi"));
    // Determinista.
    const again = buildFpsTileSpec(
      { volumes: vols([farol]), biome: "meadow", scene_description: "Cae la noche sobre el lindero; luna alta." },
      "tile_0_0",
    );
    assert.deepEqual(spec.lightsM, again.lightsM);
  });
});
