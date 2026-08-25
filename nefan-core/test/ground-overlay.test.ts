/** El techo del SUELO y la cota de los calcos que se dibujan encima.
 *
 *  Por qué existe este fichero (issue #185): `GROUND_OVERLAY_Y` se fijó a 0,2 m
 *  midiendo dos fixtures del golden, mientras el suelo crecía 2 mm por prim sin
 *  tope alguno. `MAX_GROUND_FEATURES` acota RASGOS, no PRIMS —un camino de 16
 *  puntos emite 31—, así que un tile de puerto perfectamente legal (río, cuatro
 *  embarcaderos, seis calles y cuatro plazas: quince rasgos de los 64
 *  permitidos) dejaba la cara alta del suelo en 0,219 m y ENTERRABA el
 *  telegraph del ataque, que se dibujaba a 0,2. No era un riesgo futuro; ya
 *  ocurría, y `data/scenes/puerto_tile.json` es esa escena.
 *
 *  La cota ya no se mide: se DERIVA del generador. Y para que siga siendo
 *  cierta, esto la contrasta contra el peor tile que el schema permite
 *  construir, no contra una fixture bonita. Si alguien le da a un rasgo una
 *  cota propia, o vuelve a escalonar las prims en Y, esto se pone rojo.
 *
 *  Segunda vuelta (hallazgo H1 de QA): este candado tenía un agujero con la
 *  forma exacta del bug que vigila. Lo que contaba como "rasgo de suelo" —para
 *  pintarse como calco Y para entrar en esta medida— lo decidía un olfateador
 *  por ALTURA (`cat` + una banda de y), así que una capa por encima del deck se
 *  caía fuera: enterraba el telegraph y salía verde. Ahora la marca la pone
 *  quien emite la prim (`groundLayer`, ground-prims.ts) y su cota sale de la
 *  TABLA de capas del builder, así que la medida alcanza a todo el suelo, esté
 *  a la altura que esté. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GROUND_OVERLAY_CLEARANCE_M,
  GROUND_OVERLAY_Y_M,
  GROUND_STACK_TOP_M,
  buildFpsTileSpec,
} from "../src/scene/blueprint/fps-spec.js";
import {
  GROUND_LAYERS_CELLS,
  GROUND_LAYER_T_CELLS,
  GROUND_STACK_TOP_CELLS,
} from "../src/scene/blueprint/greybox.js";
import { groundFeaturePrims } from "../src/scene/blueprint/ground-prims.js";
import { MAX_GROUND_FEATURES, parseGround } from "../src/scene/blueprint/ground.js";
import { TILE_MPC } from "../src/scene/tile.js";

/** Prim del tile ya en METROS, tal como sale de `buildFpsTileSpec`. El tipo se
 *  deriva de la función que se llama, no se importa de `surfaces.ts`: este
 *  test no tiene por sujeto las superficies y no debe pagar su batería de
 *  mutación. */
type PrimM = ReturnType<typeof buildFpsTileSpec>["primsM"][number];

/** Cara alta de una prim plana, en metros. `pos.y` es la BASE de la pieza
 *  (contrato de `GreyboxPrimitive`, y así la ancla el renderer), así que la
 *  cara alta es la base MÁS el grosor entero. El grosor va en un sitio
 *  distinto según la forma: `polygon` lleva [t], `box` [ancho,t,fondo] y
 *  `cylinder` [radio,t]. */
function caraAltaM(p: PrimM): number {
  const t = p.shape === "polygon" ? p.size[0] : p.size[1];
  return p.pos[1] + t;
}

/** Prims de rasgo de suelo del tile ya en metros. Filtra por la MARCA, no por
 *  una banda de alturas: si el filtro dependiera de la cota, una capa nueva
 *  por encima del deck se escaparía de la medida — que es exactamente cómo
 *  este candado tenía un agujero (H1). */
function rasgosDeSuelo(primsM: PrimM[]): PrimM[] {
  return primsM.filter((p) => p.groundOrder !== undefined);
}

/** Puntos máximos que el schema admite en un `path`, descubiertos preguntándole
 *  al schema: si mañana sube el tope, el peor caso de este test sube con él en
 *  vez de quedarse midiendo un mundo que ya no existe. */
function maxPuntosDeCamino(): number {
  let max = 2;
  for (let n = 2; n <= 256; n++) {
    const pts = Array.from({ length: n }, (_, i) => [2 + (i % 60), 2 + ((i * 7) % 60)]);
    if (parseGround([{ id: "c", kind: "path", points: pts, w: 3 }]).ok) max = n;
    else break;
  }
  return max;
}

/** El peor tile LEGAL: los 64 rasgos que permite el schema, con los caminos al
 *  máximo de puntos (los que más prims emiten) y agua + decks, que son las dos
 *  capas más altas. */
function peorTileLegal(): ReturnType<typeof parseGround> {
  const nPts = maxPuntosDeCamino();
  const rasgos: unknown[] = [];
  // Agua y decks primero: son las capas altas, y queremos que estén.
  rasgos.push({ id: "rio", kind: "water", polygon: [[0, 60], [128, 66], [128, 86], [0, 80]] });
  for (let i = 0; i < 6; i++) {
    rasgos.push({ id: `deck_${i}`, kind: "deck", rect: [8 + i * 20, 58, 8, 28], material: "wood" });
  }
  for (let i = 0; i < 6; i++) {
    rasgos.push({ id: `plaza_${i}`, kind: "area", rect: [6 + i * 20, 96, 16, 16], material: "cobble" });
  }
  // Y el resto, caminos al tope de puntos.
  while (rasgos.length < MAX_GROUND_FEATURES) {
    const i = rasgos.length;
    const pts = Array.from({ length: nPts }, (_, j) => [2 + ((i * 3 + j * 5) % 120), 2 + ((j * 9) % 120)]);
    rasgos.push({ id: `camino_${i}`, kind: "path", points: pts, w: 4, material: "dirt" });
  }
  return parseGround(rasgos);
}

describe("techo del suelo y cota de los calcos", () => {
  it("ningún rasgo de suelo pasa de GROUND_STACK_TOP_M, ni en el peor tile del schema", () => {
    const g = peorTileLegal();
    assert.ok(g.ok, `el peor tile tiene que ser LEGAL: ${g.ok ? "" : g.error}`);
    const { primsM } = buildFpsTileSpec({ ground: g.features, volumes: [], biome: "grass" }, "peor_tile");
    const suelo = rasgosDeSuelo(primsM);
    // Que de verdad sea un caso duro: si el generador dejara de emitir prims,
    // el techo se cumpliría por vacío y esto no comprobaría nada.
    assert.ok(suelo.length > 500, `el peor tile legal emite muchas prims planas (hay ${suelo.length})`);
    const alta = Math.max(...suelo.map(caraAltaM));
    assert.ok(
      alta <= GROUND_STACK_TOP_M + 1e-9,
      `cara alta ${alta} m supera el techo declarado ${GROUND_STACK_TOP_M} m`,
    );
    // Y el techo no está inflado: alguien lo alcanza (si no, el margen del
    // calco sería mayor de lo que dice y la constante mentiría por el otro
    // lado).
    assert.ok(
      alta >= GROUND_STACK_TOP_M - 1e-9,
      `el techo ${GROUND_STACK_TOP_M} m está por encima de la cara alta real ${alta} m`,
    );
    // Y el peor tile ejercita TODAS las capas de la tabla. Sin esto, añadir
    // una capa nueva subiría el techo sin que nadie la construyera nunca aquí:
    // la medida seguiría en verde midiendo un mundo que ya no es el peor.
    const capas = new Set(suelo.map((p) => p.groundLayer));
    assert.deepEqual(
      [...capas].sort(),
      Object.keys(GROUND_LAYERS_CELLS).sort(),
      "si añades una capa a GROUND_LAYERS_CELLS, dale un rasgo en el peor tile",
    );
  });

  it("ningún rasgo se apoya en una cota propia: todas salen de la tabla de capas", () => {
    // El agujero de H1 en su forma más directa: una capa con la y escrita a
    // mano en el emisor —una pasarela «un poco por encima del deck»— rompía el
    // techo y, cuando además se salía de la banda, ni se medía. Con la cota
    // atada a la tabla, una y inventada es ROJA aunque quepa bajo el techo.
    const g = peorTileLegal();
    assert.ok(g.ok, `el peor tile tiene que ser LEGAL: ${g.ok ? "" : g.error}`);
    const { primsM } = buildFpsTileSpec({ ground: g.features, volumes: [], biome: "grass" }, "peor_tile");
    for (const p of rasgosDeSuelo(primsM)) {
      const capa = p.groundLayer;
      assert.ok(capa, `un rasgo de suelo sin capa declarada (y = ${p.pos[1]} m)`);
      assert.equal(
        p.pos[1],
        GROUND_LAYERS_CELLS[capa] * TILE_MPC,
        `la prim de la capa "${capa}" no está en la cota de su capa`,
      );
    }
  });

  it("una capa POR ENCIMA del deck sigue siendo suelo — la marca no mira la altura", () => {
    // La reproducción de H1, hecha candado: se emite el mismo rasgo con una
    // tabla cuya capa alta está muy por encima de donde vivía la banda vieja
    // (0,185 celdas). Si el emisor dejara de marcar —o marcara solo "por
    // debajo de tanto"—, esa capa volvería a ser invisible para el candado y a
    // enterrar el telegraph.
    const g = parseGround([{ id: "pasarela", kind: "deck", rect: [10, 10, 8, 8], material: "wood" }]);
    assert.ok(g.ok, `la pasarela es legal: ${g.ok ? "" : g.error}`);
    const yAlta = GROUND_STACK_TOP_CELLS + 0.5;
    const prims = groundFeaturePrims(g.features, {
      toXZ: (u, v) => [u, v],
      scale: 1,
      layers: { ...GROUND_LAYERS_CELLS, deck: yAlta },
      layerT: GROUND_LAYER_T_CELLS,
    });
    assert.ok(prims.length > 0, "la pasarela emite prims");
    for (const p of prims) {
      assert.equal(p.pos[1], yAlta, "la prim está donde dice la tabla");
      assert.equal(p.groundLayer, "deck", `prim a ${p.pos[1]} celdas SIN marcar como suelo`);
    }
  });

  it("un tile de puerto ordinario deja sitio al calco con la holgura entera", () => {
    // El caso REAL que enterraba el telegraph: quince rasgos, ninguna rareza.
    const rasgos: unknown[] = [
      { id: "rio", kind: "water", polygon: [[0, 60], [128, 66], [128, 86], [0, 80]] },
    ];
    for (let i = 0; i < 4; i++) {
      rasgos.push({ id: `deck_${i}`, kind: "deck", rect: [12 + i * 26, 58, 8, 26], material: "wood" });
    }
    for (let i = 0; i < 6; i++) {
      rasgos.push({
        id: `camino_${i}`,
        kind: "path",
        points: [[8 + i * 18, 8], [8 + i * 18, 28], [20 + i * 18, 40], [16 + i * 18, 52], [16 + i * 18, 56]],
        w: 4,
        material: "dirt",
      });
    }
    for (let i = 0; i < 4; i++) {
      rasgos.push({ id: `plaza_${i}`, kind: "area", rect: [10 + i * 28, 92, 16, 16], material: "cobble" });
    }
    const g = parseGround(rasgos);
    assert.ok(g.ok, `el tile de puerto es legal: ${g.ok ? "" : g.error}`);
    assert.equal(g.features.length, 15);
    const { primsM } = buildFpsTileSpec({ ground: g.features, volumes: [], biome: "grass" }, "puerto");
    const alta = Math.max(...rasgosDeSuelo(primsM).map(caraAltaM));
    assert.ok(
      GROUND_OVERLAY_Y_M - alta >= GROUND_OVERLAY_CLEARANCE_M - 1e-9,
      `el calco solo tiene ${GROUND_OVERLAY_Y_M - alta} m de holgura sobre el suelo (mínimo ${GROUND_OVERLAY_CLEARANCE_M})`,
    );
  });

  it("la cota del calco es el techo del suelo más la holgura, no un número a ojo", () => {
    assert.equal(GROUND_OVERLAY_Y_M, GROUND_STACK_TOP_M + GROUND_OVERLAY_CLEARANCE_M);
    // La holgura tiene que ser POSITIVA y notable: a ras del deck el calco
    // z-fightea con él, que es el mismo fallo con otra cara.
    assert.ok(GROUND_OVERLAY_CLEARANCE_M > 0.005, "holgura por debajo de la precisión del z-buffer");
  });
});
