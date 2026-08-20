import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTerrainCollider, type TerrainGridData } from "../src/scene/terrain-collision.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";

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
