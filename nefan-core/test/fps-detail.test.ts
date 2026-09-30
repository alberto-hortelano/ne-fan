/** Detalle fps del tile (fps-detail): variedad de formas post-proceso —
 *  copas esféricas por species, rocas facetadas con material pétreo,
 *  tejados de torre, arcos de gate, ventanas/chimeneas de building. Todo
 *  determinista y SIN tocar el builder compartido. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFpsTileSpec } from "../src/scene/blueprint/fps-spec.js";
import { buildTileGreyboxSpec } from "../src/scene/blueprint/greybox.js";
import { parseVolumes } from "../src/scene/blueprint/volumes.js";
import { canonicalGreyboxJson } from "../src/scene/greybox/common.js";
import { esSaltable, volumeHeightM } from "../src/scene/blueprint/volume-metrics.js";
import { ALTURA_SALTABLE_M } from "../src/scene/terrain-collision.js";

/** El tipo de prim, tomado de la firma: nombrar `surfaces.ts` metería este
 *  test en una batería de mutación a la que no le mata nada. */
type SurfacePrim = ReturnType<typeof buildFpsTileSpec>["primsM"][number];

/** Lo más alto que PINTA una prim, en metros (pos.y es la base; la esfera
 *  mide su diámetro; `scale.y` estira). Las prims giradas en X/Z (ruedas,
 *  troncos caídos de `custom`) no se miden: por eso `custom` está fuera. */
function cimaPintada(p: SurfacePrim): number {
  const sy = p.scale?.[1] ?? 1;
  if (p.shape === "sphere") return p.pos[1] + 2 * p.size[0] * sy;
  if (p.shape === "polygon") return p.pos[1] + p.size[0];
  return p.pos[1] + p.size[1] * sy;
}

/** La altura que se VE de un volumen solo en su tile, sobre varias semillas
 *  (matorral y roca sortean el tamaño de sus esferas). */
function alturaPintada(raw: Record<string, unknown>, semillas = ["a", "b", "c", "d", "e"]): number {
  let max = 0;
  for (const seed of semillas) {
    const { primsM } = buildFpsTileSpec({ volumes: vols([raw]), biome: "grass" }, seed);
    for (const p of primsM) if (p.volId === `vol_${String(raw.id)}`) max = Math.max(max, cimaPintada(p));
  }
  assert.ok(max > 0, `${String(raw.id)} no pinta nada`);
  return max;
}

function vols(raw: unknown[]) {
  const parsed = parseVolumes(raw);
  assert.ok(parsed.ok, !parsed.ok ? parsed.error : "");
  return parsed.volumes;
}

describe("fps-detail", () => {
  it("árbol frondoso (default) = tronco + esferas; conífera conserva el cono", () => {
    const volumes = vols([
      { id: "roble", label: "roble", type: "tree", at: [30, 30] },
      { id: "pino", label: "pino", type: "tree", at: [60, 60], species: "pino carrasco" },
    ]);
    const { primsM } = buildFpsTileSpec({ volumes, biome: "grass" }, "k");
    const roble = primsM.filter((p) => p.volId === "vol_roble");
    assert.ok(roble.some((p) => p.shape === "cylinder"), "tronco");
    assert.ok(roble.filter((p) => p.shape === "sphere").length >= 1, "copa esférica");
    assert.equal(roble.some((p) => p.shape === "cone"), false, "sin cono en frondosa");
    const pino = primsM.filter((p) => p.volId === "vol_pino");
    assert.ok(pino.some((p) => p.shape === "cone"), "la conífera conserva el cono");
  });

  it("rocas = esferas facetadas con mat rock_stone (no tablones); matorral = esferas", () => {
    const volumes = vols([
      { id: "pena", label: "peña", type: "rock", at: [40, 40], s: 1.5 },
      { id: "mata", label: "mata", type: "bush", at: [70, 70] },
    ]);
    const { primsM } = buildFpsTileSpec({ volumes, biome: "grass" }, "k");
    const rocas = primsM.filter((p) => p.volId === "vol_pena");
    assert.ok(rocas.length >= 2, "varias esferas por roca");
    for (const r of rocas) {
      assert.equal(r.shape, "sphere");
      assert.equal(r.mat, "rock_stone");
      assert.ok(r.scale && r.scale[1] < 1, "achatada");
    }
    const matas = primsM.filter((p) => p.volId === "vol_mata");
    assert.ok(matas.every((p) => p.shape === "sphere"), "matorral esférico");
  });

  it("torre sin almenas gana tejado cónico; la almenada no", () => {
    const volumes = vols([
      { id: "t1", label: "torre", type: "tower", at: [30, 30] },
      { id: "t2", label: "torreón", type: "tower", at: [80, 80], crenellated: true },
    ]);
    const { primsM } = buildFpsTileSpec({ volumes, biome: "dirt" }, "k");
    assert.ok(
      primsM.some((p) => p.volId === "vol_t1" && p.shape === "cone" && p.mat === "roof_tile"),
      "cono de tejado",
    );
    assert.equal(primsM.some((p) => p.volId === "vol_t2" && p.shape === "cone"), false);
  });

  it("gate gana corbeles (arco escalonado) y building ventanas con mat window_glass", () => {
    const volumes = vols([
      {
        id: "muralla", label: "muralla", type: "wall",
        points: [[10, 64], [118, 64]], crenellated: true,
      },
      { id: "puerta", label: "puerta", type: "gate", at: [64, 64], orient: "x" },
      {
        id: "casa", label: "casa", type: "building",
        rect: [30, 20, 14, 10], doors: [{ edge: "s", at: 5 }],
      },
    ]);
    const { primsM } = buildFpsTileSpec({ volumes, biome: "dirt" }, "k");
    const corbeles = primsM.filter(
      (p) => p.volId === "vol_puerta" && p.shape === "box" && p.size[1] < 0.5 && p.pos[1] > 1,
    );
    assert.ok(corbeles.length >= 4, `≥4 corbeles (hay ${corbeles.length})`);
    // Por la CLASE que declaran, no por "tiene mat de tipo objeto": ese
    // proxy dejó de distinguir cuando el cuerpo del edificio empezó a
    // declarar también su material de fachada.
    const conMat = primsM.filter((p) => p.volId === "vol_casa" && typeof p.mat === "object");
    const ventanas = conMat.filter((p) => (p.mat as Record<string, string>).side === "window_glass");
    assert.ok(ventanas.length >= 1, `la casa tiene ventanas (mats: ${JSON.stringify(conMat.map((p) => p.mat))})`);
    assert.ok(
      conMat.some((p) => (p.mat as Record<string, string>).side === "wall_stone"),
      "el cuerpo declara su material de fachada",
    );
    for (const w of ventanas) {
      assert.equal((w.mat as Record<string, string>).side, "window_glass");
      assert.ok(w.pos[1] > 0.5, "ventana elevada del suelo");
    }
  });

  it("determinista y sin mutar las prims base del builder compartido", () => {
    const raw = [
      { id: "casa", label: "casa", type: "building", rect: [30, 20, 14, 10] },
      { id: "roble", label: "roble", type: "tree", at: [80, 80] },
      { id: "pena", label: "peña", type: "rock", at: [100, 40] },
    ];
    const volumes = vols(raw);
    const a = buildFpsTileSpec({ volumes, biome: "grass" }, "k");
    const b = buildFpsTileSpec({ volumes, biome: "grass" }, "k");
    assert.deepEqual(a.primsM, b.primsM, "mismo seedKey ⇒ mismas prims");
    // El `spec` que devuelve buildFpsTileSpec es el del builder, INTACTO: el
    // enriquecimiento (cutaways cerrados, detalle, scatter, celdas → metros)
    // vive solo en primsM. Si un post-proceso mutase las prims base, el
    // siguiente partiría de otra geometría y las celdas del atlas —lo que se
    // paga con IA— dejarían de ser estables.
    const base = buildTileGreyboxSpec({ volumes, biome: "grass" }, "k");
    assert.equal(canonicalGreyboxJson(a.spec), canonicalGreyboxJson(base));
  });
});

/** Tanda BY: lo que se VE saltable tiene que SER saltable, y al revés. El
 *  caso que importa es `wall` —valla contra muro—, y para él se afirma sobre
 *  la altura PINTADA por las prims, no sobre la publicada: si divergen, hay
 *  una cerca que se ve y no se salta. */
describe("lo que se ve saltable es lo que se salta", () => {
  const tramo = (extra: Record<string, unknown>) => ({
    id: "t", label: "cerca", type: "wall", points: [[20, 40], [60, 40]], ...extra,
  });

  it("WALL: pintado ≤ 1,2 m ⇔ esSaltable, en todo el barrido de alturas, con y sin almena", () => {
    let saltables = 0;
    let altos = 0;
    // Cada 0,5 celdas más las fronteras (liso 2,4/2,41; almenado 1,4/1,5).
    // Una semilla: el muro no sortea nada.
    const alturas = [0.5, 1, 1.4, 1.5, 1.6, 2, 2.3, 2.4, 2.41, 2.5, 3, 3.5, 4, 5, 6];
    for (const h of alturas) {
      for (const crenellated of [false, true]) {
        for (const label of ["cerca", "tapia de piedra"]) {
          const raw = tramo({ h, crenellated, label });
          const pintada = alturaPintada(raw, ["a"]);
          const v = vols([raw])[0];
          assert.ok(Math.abs(pintada - volumeHeightM(v, 0.5)) < 1e-9,
            `${JSON.stringify(raw)}: pinta ${pintada} m y publica ${volumeHeightM(v, 0.5)} m`);
          assert.equal(esSaltable(v), pintada <= ALTURA_SALTABLE_M + 1e-9, JSON.stringify(raw));
          if (esSaltable(v)) saltables++;
          else altos++;
        }
      }
    }
    assert.ok(saltables > 10 && altos > 10, `el barrido cubre los dos lados (${saltables}/${altos})`);
  });

  it("WALL: se pinta como VALLA de estacas ⇔ se salta (salvo las de piedra, que son murete)", () => {
    const esValla = (raw: Record<string, unknown>) => {
      const { primsM } = buildFpsTileSpec({ volumes: vols([raw]), biome: "grass" }, "k");
      return primsM.some((p) => p.volId === "vol_t" && p.mat === "wood_beam");
    };
    for (const h of [1, 2, 2.4, 2.41, 3, 5]) {
      for (const crenellated of [false, true]) {
        const raw = tramo({ h, crenellated });
        assert.equal(esValla(raw), esSaltable(vols([raw])[0]), JSON.stringify(raw));
      }
    }
    // Un muro bajo de piedra se salta, pero se pinta macizo: es un murete.
    const murete = tramo({ h: 2, label: "tapia de piedra" });
    assert.equal(esValla(murete), false);
    assert.equal(esSaltable(vols([murete])[0]), true);
  });

  /** LA DIVERGENCIA DECLARADA de los demás tipos, MEDIDA. `volumeHeightM` es
   *  una aproximación de lo que pinta el greybox, y aquí se fija cuánto se
   *  equivoca donde el salto lo nota. Si alguien la arregla (la altura
   *  publicada saliendo de las prims), este test se pone rojo y hay que
   *  borrar la línea de la divergencia que ya no existe. */
  it("resto de tipos: la divergencia pintado↔publicado es la declarada y ninguna más", () => {
    const caso = (raw: Record<string, unknown>) => {
      const v = vols([raw])[0];
      return { pintada: alturaPintada(raw), publicada: volumeHeightM(v, 0.5), salta: esSaltable(v) };
    };
    // ROCA: se pinta a ~0,6·s y se publica a 1,1·s. Una roca de s 1,5 se ve
    // de rodilla (≈ 0,9 m) y NO se salta. Dirección segura (nunca se salta
    // algo que se vea alto), pero es una roca que parece saltable y no lo es.
    const roca = caso({ id: "r", label: "peña", type: "rock", at: [40, 40], s: 1.5 });
    assert.ok(roca.pintada < ALTURA_SALTABLE_M && !roca.salta, JSON.stringify(roca));
    assert.ok(roca.pintada < 0.65 * roca.publicada, `la roca pinta ${roca.pintada} de ${roca.publicada}`);
    // PROP CILINDRO: la tapa sobresale 0,06 celdas (3 cm) sobre `h`. En la
    // frontera, un barril de 1,23 m pintados se salta. Es el único caso en la
    // dirección mala, y son tres centímetros.
    const barril = caso({ id: "b", label: "barril", type: "prop", shape: "cylinder", at: [40, 40], h: 2.4 });
    assert.ok(barril.salta && Math.abs(barril.pintada - barril.publicada - 0.03) < 1e-9, JSON.stringify(barril));
    // FUENTE: pinta 1,3 m y publica 1,4: las dos por encima, no se salta y no
    // se ve saltable. Sin divergencia que el jugador note.
    const fuente = caso({ id: "f", label: "fuente", type: "fountain", at: [40, 40] });
    assert.ok(!fuente.salta && fuente.pintada > ALTURA_SALTABLE_M, JSON.stringify(fuente));
    // MATORRAL: pinta ~0,7·s y publica 1,3·s, pero NO bloquea ni a pie
    // (`volumeCollisionGrid` lo trata como decorado): la divergencia no llega
    // al salto. Casa, torre, gate y árbol: publicada y pintada muy por encima
    // de 1,2 m. `custom` no se mide (piezas giradas).
    for (const raw of [
      { id: "c", label: "casa", type: "building", rect: [30, 30, 8, 6] },
      { id: "t", label: "torre", type: "tower", at: [40, 40] },
      { id: "g", label: "puerta", type: "gate", at: [40, 40], orient: "x" },
      { id: "a", label: "roble", type: "tree", at: [40, 40] },
    ]) {
      const c = caso(raw);
      assert.ok(!c.salta && c.pintada > 2 * ALTURA_SALTABLE_M, `${raw.type}: ${JSON.stringify(c)}`);
    }
  });
});
