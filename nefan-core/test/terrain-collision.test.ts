import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BODY_RADIUS_M,
  NPC_RADIUS_M,
  PLAYER_RADIUS_M,
  celdasLibresParaRadio,
  celdasQueCubreRadio,
  createTerrainCollider,
  type TerrainGridData,
} from "../src/scene/terrain-collision.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import { TILE_MPC } from "../src/scene/tile.js";

/** Interior de taberna estilo del ejemplo del prompt: borde W sólido con
 *  puerta "_" al sur, suelo "o". 8×6 celdas, mpc 0.5 ⇒ 4m × 3m, origen en el
 *  centro (halfW=2, halfD=1.5). */
function makeGrid() {
  return {
    grid: [
      "WWWWWWWW",
      "WooooooW",
      "WooooooW",
      "WooooooW",
      "WooooooW",
      "WWW__WWW",
    ],
    cols: 8,
    rows: 6,
    meters_per_cell: 0.5,
    solid_chars: ["W"],
  };
}

/** Normaliza una escena Format D mínima y devuelve su `terrain_grid`, que es
 *  lo que consume el collider. Tipado como TerrainGridData para que los tests
 *  puedan construir el collider sin castear. */
const conLegend = (
  terrain_legend: unknown,
  terrain = ["Pgw"],
): TerrainGridData & { legend: Record<string, string>; solid_chars: string[] } =>
  formatDToWorld({
    scene_id: "s",
    size: { cols: terrain[0].length, rows: terrain.length, meters_per_cell: 1 },
    terrain,
    terrain_legend,
    entities: [],
  }).terrain_grid as TerrainGridData & { legend: Record<string, string>; solid_chars: string[] };

describe("createTerrainCollider", () => {
  it("returns null without grid or without solid chars", () => {
    assert.equal(createTerrainCollider(undefined), null);
    assert.equal(createTerrainCollider(null), null);
    assert.equal(createTerrainCollider({ ...makeGrid(), solid_chars: [] }), null);
    // Grid sin ninguna celda del char sólido → null (nada que bloquear).
    assert.equal(
      createTerrainCollider({ ...makeGrid(), grid: ["oooooooo", "oooooooo", "oooooooo", "oooooooo", "oooooooo", "oooooooo"] }),
      null,
    );
  });

  it("throws fail-loud on an inconsistent grid", () => {
    assert.throws(() => createTerrainCollider({ ...makeGrid(), rows: 9 }), /inconsistente/);
    assert.throws(() => createTerrainCollider({ ...makeGrid(), meters_per_cell: 0 }), /inconsistente/);
  });

  it("marks wall cells solid and floor/door cells walkable", () => {
    const col = createTerrainCollider(makeGrid())!;
    assert.ok(col.isSolidCell(0, 0)); // esquina NW
    assert.ok(col.isSolidCell(7, 5)); // esquina SE
    assert.ok(!col.isSolidCell(3, 3)); // suelo interior
    assert.ok(!col.isSolidCell(3, 5)); // puerta "_"
    assert.ok(!col.isSolidCell(-1, 2)); // fuera del grid → no sólido
    assert.ok(!col.isSolidCell(3, 99));
  });

  it("blocksCircle: a point inside a wall blocks, the room centre does not", () => {
    const col = createTerrainCollider(makeGrid())!;
    // Celda (0,0) va de mundo (-2,-1.5) a (-1.5,-1). Su centro:
    assert.ok(col.blocksCircle(-1.75, -1.25, 0.1));
    // Centro de la sala (0,0 mundo): celdas de suelo alrededor.
    assert.ok(!col.blocksCircle(0, 0, 0.4));
  });

  it("blocksCircle: the player radius reaches into the wall before the point does", () => {
    const col = createTerrainCollider(makeGrid())!;
    // El muro oeste ocupa x ∈ [-2, -1.5]. Un punto en x=-1.3 no lo toca…
    assert.ok(!col.blocksCircle(-1.3, 0, 0.1));
    // …pero con radio 0.4 el AABB llega a x=-1.7, dentro del muro.
    assert.ok(col.blocksCircle(-1.3, 0, 0.4));
  });

  it("blocksCircle: a diameter wider than one cell cannot slip between corners", () => {
    // Franja sólida de 1 celda entre dos pasillos: radio 0.4 (diámetro 0.8 >
    // mpc 0.5) centrado sobre la franja debe chocar aunque sus 4 esquinas
    // cayeran fuera; el bucle por celdas cubiertas lo garantiza.
    const col = createTerrainCollider({
      grid: ["ooo", "oWo", "ooo"],
      cols: 3,
      rows: 3,
      meters_per_cell: 0.5,
      solid_chars: ["W"],
    })!;
    assert.ok(col.blocksCircle(0, 0, 0.4)); // celda central del grid 3×3
  });

  it("blocksMove: allows walking OUT of a wall you already overlap, never deeper in", () => {
    const col = createTerrainCollider(makeGrid())!;
    // Origen penetrando el muro oeste (x=-1.6 solapa la celda col 0, x∈[-2,-1.5]).
    // Salir hacia el este (alejándose del muro) NO bloquea…
    assert.ok(!col.blocksMove(-1.6, 0, -1.3, 0, 0.4));
    // …y desde fuera, entrar al muro bloquea.
    assert.ok(col.blocksMove(-1.0, 0, -1.3, 0, 0.4));
    // blocksCircle (posición absoluta) sigue viendo la penetración.
    assert.ok(col.blocksCircle(-1.6, 0, 0.4));
  });

  it("integrates with formatDToWorld: W and w solid by default, legend can override", () => {
    const tg = conLegend({ W: { name: "muro", solid: true } }, ["Wgwg", "gggg"]);
    assert.deepEqual(tg.solid_chars, ["W", "w"]);
    assert.equal(tg.legend.W, "muro");
    const col = createTerrainCollider(tg)!;
    assert.ok(col.isSolidCell(0, 0)); // W
    assert.ok(col.isSolidCell(2, 0)); // w agua
    assert.ok(!col.isSolidCell(1, 0)); // g
  });

  it("legend heuristic: legacy string value naming a wall becomes solid", () => {
    const tg = conLegend({ M: "muralla derruida" }, ["Mg"]);
    assert.ok(tg.solid_chars.includes("M"));
  });

  it("legend can un-solid a default char (solid: false)", () => {
    const tg = conLegend({ w: { name: "vado poco profundo", solid: false } }, ["wg"]);
    assert.ok(!tg.solid_chars.includes("w"));
    assert.ok(tg.solid_chars.includes("W"));
  });
});

/** El cuerpo mayor y la regla que lo convierte en celdas. Es la pieza de la
 *  que cuelga todo lo demás (el suelo de los vanos en el zod, la erosión del
 *  flood): si se escribe a mano en cualquiera de esos sitios, el día que
 *  cambie un radio la garantía se rompe en silencio. */
describe("el cuerpo mayor que transita el mundo", () => {
  it("BODY_RADIUS_M es el MAYOR de los dos cuerpos, no uno elegido a mano", () => {
    assert.equal(BODY_RADIUS_M, Math.max(PLAYER_RADIUS_M, NPC_RADIUS_M));
    assert.equal(BODY_RADIUS_M, NPC_RADIUS_M, "hoy el mayor es el del NPC");
    assert.ok(NPC_RADIUS_M > PLAYER_RADIUS_M, "si dejan de diferir, el bug de la puerta de 1 m ya no existe");
  });

  it("y lo es EN EL BORDE: `n·mpc > 2R` estricto, no `>=`", () => {
    // Con `ceil` en vez de `floor` un hueco de exactamente 2R saldría
    // transitable, y no lo es: el AABB de blocksCircle se recorre con floor()
    // INCLUSIVE. mpc 0,5 es justo ese borde para el NPC (2 celdas = 1,00 m =
    // 2R), así que un pelo por debajo pide 3 celdas y un pelo por encima, 2.
    assert.equal(celdasLibresParaRadio(0.5, 0.49), 3, "2 celdas serían 0,98 m < 1,00 m");
    assert.equal(celdasLibresParaRadio(0.5, 0.51), 2, "2 celdas ya son 1,02 m > 1,00 m");
    assert.equal(celdasLibresParaRadio(0.5, 0.5), 3, "exactamente 1,00 m NO basta");
  });

  it("celdas libres = floor(2R/mpc)+1, y el COLLIDER REAL dice lo mismo", () => {
    // La fórmula no se compara con otra fórmula, sino con `blocksCircle`
    // sobre un pasillo de verdad: `n` celdas libres en un muro, y el cuerpo
    // centrado en él. La celda de diferencia entre los dos radios ES el issue
    // #289: por un hueco de 2 celdas (1 m) pasa el jugador y no pasa el NPC.
    const pasillo = (n: number): TerrainGridData => ({
      grid: ["W".repeat(4) + ".".repeat(n) + "W".repeat(4)],
      cols: 8 + n,
      rows: 1,
      meters_per_cell: TILE_MPC,
      origin: [0, 0],
      solid_chars: ["W"],
    });
    for (const [radio, minimo] of [[PLAYER_RADIUS_M, 2], [NPC_RADIUS_M, 3]] as const) {
      assert.equal(celdasLibresParaRadio(radio, TILE_MPC), minimo);
      const centro = (n: number): number => (4 + n / 2) * TILE_MPC;
      const justo = createTerrainCollider(pasillo(minimo))!;
      assert.equal(justo.blocksCircle(centro(minimo), 0.25, radio), false, `radio ${radio} cabe en ${minimo} celdas`);
      const escaso = createTerrainCollider(pasillo(minimo - 1))!;
      assert.equal(escaso.blocksCircle(centro(minimo - 1), 0.25, radio), true, `radio ${radio} NO cabe en ${minimo - 1}`);
    }
  });

  // ── El gemelo: cuánto CUERPO cabe en celdas (#300) ────────────────────────
  //
  // `celdasLibresParaRadio` contesta cuánto hueco pide un cuerpo;
  // `celdasQueCubreRadio` contesta cuánto cuerpo cabe en n celdas. Es de donde
  // sale el TOPE del `footprint` de una entity móvil, y por eso no puede ser
  // un número escrito a mano: si lo fuera, mover un radio dejaría al contrato
  // prometiendo un cuerpo que la colisión no honra, que es exactamente el
  // agujero de #300.
  it("celdasQueCubreRadio es el gemelo exacto: un cuerpo tapa una celda menos de las que necesita para pasar", () => {
    for (const radio of [PLAYER_RADIUS_M, NPC_RADIUS_M, 0.25, 1.75]) {
      for (const mpc of [TILE_MPC, 0.49, 2]) {
        assert.equal(
          celdasQueCubreRadio(radio, mpc),
          celdasLibresParaRadio(radio, mpc) - 1,
          `radio ${radio} a mpc ${mpc}: las dos miden el MISMO cuerpo desde los dos lados`,
        );
      }
    }
  });

  it("y ese ancho es el que el COLLIDER REAL recorre: `tope` celdas no dejan pasar al cuerpo, `tope+1` sí", () => {
    // Misma sonda que arriba, leída al revés: el tope es el mayor ancho en
    // celdas que NO basta para que ese cuerpo cruce — o sea, tanto ancho como
    // cuerpo hay. Un footprint mayor declararía un bicho más ancho que el
    // círculo que el simulador mueve.
    const pasillo = (n: number): TerrainGridData => ({
      grid: ["W".repeat(4) + ".".repeat(n) + "W".repeat(4)],
      cols: 8 + n,
      rows: 1,
      meters_per_cell: TILE_MPC,
      origin: [0, 0],
      solid_chars: ["W"],
    });
    const centro = (n: number): number => (4 + n / 2) * TILE_MPC;
    for (const radio of [PLAYER_RADIUS_M, NPC_RADIUS_M]) {
      const tope = celdasQueCubreRadio(radio, TILE_MPC);
      assert.ok(tope >= 1, `radio ${radio}: el tope tiene que dejar declarar al menos una celda`);
      const justo = createTerrainCollider(pasillo(tope))!;
      assert.equal(justo.blocksCircle(centro(tope), 0.25, radio), true, `radio ${radio}: ${tope} celdas NO le dejan pasar`);
      const holgado = createTerrainCollider(pasillo(tope + 1))!;
      assert.equal(holgado.blocksCircle(centro(tope + 1), 0.25, radio), false, `radio ${radio}: ${tope + 1} sí`);
    }
  });

  it("los dos cuerpos del juego, en el mpc del tile: NPC 2 celdas (1,0 m), jugador 1 celda (0,5 m)", () => {
    // Los VALORES de hoy, escritos para que muevan el gate si alguien mueve un
    // radio: con NPC_RADIUS_M en 0,75 este test se pone rojo y con él los del
    // tope del contrato.
    assert.equal(celdasQueCubreRadio(NPC_RADIUS_M, TILE_MPC), 2);
    assert.equal(celdasQueCubreRadio(PLAYER_RADIUS_M, TILE_MPC), 1);
    assert.equal(celdasQueCubreRadio(NPC_RADIUS_M, TILE_MPC) * TILE_MPC, 2 * NPC_RADIUS_M, "el NPC cae justo en el borde");
    assert.ok(celdasQueCubreRadio(PLAYER_RADIUS_M, TILE_MPC) * TILE_MPC < 2 * PLAYER_RADIUS_M, "el jugador no llena su celda");
  });
});

/** La leyenda resuelta es la ÚNICA fuente de qué bloquea el paso: la consumen
 *  el collider del cliente (`createTerrainCollider`) y la colisión server-side
 *  de NPCs del bridge (bridge/sim-collision.ts:137, que normaliza con
 *  formatDToWorld y construye el mismo collider). Una leyenda que el motor o
 *  un save viejo declaran mal no puede acabar en un muro que se atraviesa ni
 *  en un suelo que bloquea. */
describe("resolveTerrainLegend — leyendas raras que acaban en colisión", () => {
  it("una leyenda que no es un objeto se ignora entera (no se lee char a char)", () => {
    // Un save corrupto con `terrain_legend: "muro"` NO puede producir la
    // leyenda {0:"m",1:"u",2:"r",3:"o"} — serían cuatro chars inventados que
    // el renderer pintaría como zonas.
    const tg = conLegend("muro");
    assert.deepEqual(tg.legend, {});
    assert.deepEqual(tg.solid_chars, ["W", "w"], "solo los sólidos por defecto");
    assert.deepEqual(conLegend(undefined).legend, {});
    assert.deepEqual(conLegend(null).legend, {});
  });

  it("un valor de leyenda que no es ni cadena ni objeto se descarta sin inventar nombre", () => {
    const tg = conLegend({ P: 42, Q: null, R: { name: "empalizada", solid: true } });
    assert.ok(!("P" in tg.legend), `P=42 no debería entrar: ${JSON.stringify(tg.legend)}`);
    assert.ok(!("Q" in tg.legend), `Q=null no debería entrar: ${JSON.stringify(tg.legend)}`);
    assert.equal(tg.legend.R, "empalizada");
  });

  it("solid:true añade un char propio y el jugador choca de verdad con él", () => {
    const tg = conLegend({ P: { name: "empalizada", solid: true } });
    assert.ok(tg.solid_chars.includes("P"));
    const col = createTerrainCollider(tg)!;
    // Grid "Pgw" 3×1 mpc 1 ⇒ celdas [-1.5..-0.5], [-0.5..0.5], [0.5..1.5].
    assert.ok(col.isSolidCell(0, 0), "la empalizada bloquea");
    assert.ok(!col.isSolidCell(1, 0), "la hierba no");
    assert.ok(col.isSolidCell(2, 0), "el agua sigue bloqueando por defecto");
  });

  it("un char sólido por defecto sin `solid` declarado NO pierde su solidez", () => {
    // Declarar `{ name }` es ponerle nombre, no volverlo transitable: si esto
    // se rompe, el agua y los muros de cualquier escena con leyenda dejan de
    // bloquear en silencio.
    const tg = conLegend({ W: { name: "muro de adobe" }, w: { name: "arroyo" } }, ["Wgw"]);
    assert.deepEqual(tg.solid_chars, ["W", "w"]);
    assert.equal(tg.legend.W, "muro de adobe");
    const col = createTerrainCollider(tg)!;
    assert.ok(col.isSolidCell(0, 0));
    assert.ok(col.isSolidCell(2, 0));
  });

  it("un objeto sin `name` usable cae al propio char como nombre", () => {
    assert.equal(conLegend({ P: { solid: true } }).legend.P, "P");
    assert.equal(conLegend({ P: { name: 42, solid: true } }).legend.P, "P");
  });

  it("solid_chars no depende del orden de declaración de la leyenda", () => {
    // El wire debe ser idéntico para dos leyendas equivalentes: el cliente
    // compara escenas (resume, re-broadcast del mismo tile) y una lista con
    // el mismo contenido en otro orden se leería como un cambio de escena.
    const a = conLegend({ P: { name: "empalizada", solid: true }, A: { name: "arena", solid: true } });
    const b = conLegend({ A: { name: "arena", solid: true }, P: { name: "empalizada", solid: true } });
    assert.deepEqual(a.solid_chars, b.solid_chars);
    assert.deepEqual(a.solid_chars, ["A", "P", "W", "w"]);
  });
});
