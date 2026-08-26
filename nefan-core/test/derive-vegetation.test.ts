/** Lo que el ESQUEMA del tile implica y el motor no escribió: `structures` →
 *  edificios cutaway, entities estáticas → su primitiva y `vegetation_zones` →
 *  masa forestal. Es la mitad "derivada" del único camino esquema→huella; la
 *  composición entera (con presupuesto y avisos) la cubre `tile-plan.test.ts`.
 *
 *  Escrito desde el CONTRATO del módulo: qué promete el tool `generate_scene`
 *  sobre `vegetation_zones` y qué promete `representedBy`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveVolumesFromSchema } from "../src/scene/blueprint/derive.js";
import { parseGround, type GroundFeature } from "../src/scene/blueprint/ground.js";
import { parseVegetationZones, type VegetationZone } from "../src/scene/blueprint/vegetation.js";
import { parseVolumes, type Volume } from "../src/scene/blueprint/volumes.js";

function vols(raw: unknown[]): Volume[] {
  const p = parseVolumes(raw);
  assert.ok(p.ok, !p.ok ? p.error : "");
  return p.ok ? p.volumes : [];
}

function suelo(raw: unknown[]): GroundFeature[] {
  const p = parseGround(raw);
  assert.ok(p.ok, !p.ok ? p.error : "");
  return p.ok ? p.features : [];
}

/** Zonas por el mismo parser que usa la composición (y el gate del motor):
 *  un test que se saltara el zod podría probar densidades que el juego rebota. */
function zonas(raw: unknown[]): VegetationZone[] {
  const p = parseVegetationZones(raw);
  assert.ok(p.ok, !p.ok ? p.error : "");
  return p.ok ? p.zones : [];
}

/** Centro de un volumen tree/bush derivado. */
function at(v: Volume): [number, number] {
  return (v as Extract<Volume, { type: "tree" }>).at as [number, number];
}

describe("deriveVolumesFromSchema: vegetation_zones", () => {
  it("puebla una zona 'rest' con árboles, determinista", () => {
    const input = {
      seed: "tile_0_0",
      vegetation_zones: zonas([{ type: "pino", area: "rest", density: 0.02 }]),
    };
    const a = deriveVolumesFromSchema(input, []);
    const b = deriveVolumesFromSchema(input, []);
    assert.deepEqual(a.vegetation, b.vegetation, "misma entrada → mismos volúmenes");
    assert.ok(a.vegetation.length >= 30, `derivados: ${a.vegetation.length}`);
    assert.ok(a.vegetation.every((v) => v.type === "tree"), "todo trees");
    assert.deepEqual(a.volumes, [], "la vegetación va aparte de las adiciones fijas");
  });

  it("el seed manda: dos tiles distintos plantan bosques distintos con la misma zona", () => {
    // Es lo que hace que el bosque del cliente sea el del bridge: el seed no
    // se pasa desde fuera, sale del tile. Si dos tiles compartieran bosque,
    // el mundo continuo sería un patrón repetido.
    const zona = zonas([{ type: "pino", area: "rest", density: 0.02 }]);
    const a = deriveVolumesFromSchema({ seed: "tile_0_0", vegetation_zones: zona }, []).vegetation;
    const b = deriveVolumesFromSchema({ seed: "tile_1_0", vegetation_zones: zona }, []).vegetation;
    assert.equal(a.length, b.length, "misma densidad, mismo recuento");
    assert.notDeepEqual(a.map(at), b.map(at), "otro tile, otras posiciones");
  });

  it("respeta blockers declarados y usa los trees del motor como semillas de separación", () => {
    const declared = vols([
      { id: "nave", label: "nave", type: "building", rect: [0, 0, 128, 60] },
      { id: "roble_viejo", label: "roble", type: "tree", at: [96, 96], s: 1.5 },
    ]);
    const out = deriveVolumesFromSchema(
      { seed: "tile_0_0", vegetation_zones: zonas([{ type: "pino", area: "rest", density: 0.06 }]) },
      declared,
    ).vegetation;
    assert.ok(out.length > 0);
    for (const v of out) {
      const p = at(v);
      assert.ok(p[1] > 60, `no planta dentro/margen del blocker: ${JSON.stringify(p)}`);
      const d = Math.hypot(p[0] - 96, p[1] - 96);
      // El roble declarado mide s=1.5 → tronco 1,35 celdas; el pino, ≤1,08.
      // Separación exigida = 1,35 + 1,08 + 3 celdas de paso libre.
      assert.ok(d >= 1.35 + 1.08 + 3, `separación del árbol declarado: ${JSON.stringify(p)} (${d.toFixed(2)})`);
    }
  });

  // ── El suelo declarado excluye ────────────────────────────────────────────
  // El contrato le promete al motor que la vegetación de zona «avoids paths,
  // water, decks and building footprints automatically».
  it("no planta en el camino ni en el agua declarados en `ground`", () => {
    const ground = suelo([
      // El camino real de robledo_tile: cruza el tile de lado a lado.
      { id: "camino_real", kind: "path", label: "camino real", points: [[0, 63.5], [128, 63.5]], w: 4, material: "dirt" },
      { id: "rio", kind: "water", label: "río Negro", rect: [84, 68, 8, 60] },
    ]);
    const input = {
      seed: "tile_0_0",
      vegetation_zones: zonas([{ type: "pino", area: "rest", density: 0.05 }]),
    };
    // Banda del camino = w/2 + 0,5 celdas (la misma que usa el scatter fps),
    // ABIERTA: el borde exacto es legal, y ahí cae algún ejemplar (su tronco
    // roza el arcén, no la calzada — que el camino se pueda RECORRER lo mide
    // el guion 16 andándolo).
    const enCamino = (v: Volume) => Math.abs(at(v)[1] - 63.5) < 2.5;
    // El rect del agua, también abierto en el borde lejano: un ejemplar EN la
    // orilla exacta es legal (nada se planta DENTRO del agua).
    const enAgua = (v: Volume) => {
      const [u, w] = at(v);
      return u > 84 && u < 92 && w > 68 && w < 128;
    };

    // Aserción PAREADA: sin `ground` la misma entrada sí pisa camino y agua.
    // Sin este par, una zona que saliera vacía por cualquier otro motivo
    // pondría el test verde sin comprobar nada.
    const sinSuelo = deriveVolumesFromSchema(input, []).vegetation;
    assert.ok(sinSuelo.some(enCamino), `sin ground debería pisar el camino (${sinSuelo.length} derivados)`);
    assert.ok(sinSuelo.some(enAgua), `sin ground debería pisar el agua (${sinSuelo.length} derivados)`);

    const conSuelo = deriveVolumesFromSchema({ ...input, ground }, []).vegetation;
    assert.ok(conSuelo.length > 0, "la zona sigue poblando el resto del tile");
    assert.deepEqual(conSuelo.filter(enCamino).map(at), [], "ni un árbol sobre la calzada");
    assert.deepEqual(conSuelo.filter(enAgua).map(at), [], "ni un árbol sobre el río");
  });

  it("un parche de material (area) SÍ se puebla; la misma forma como agua, no", () => {
    // Un `area` es material (plaza, huerto): una zona declarada encima debe
    // poder plantarse. Misma forma como `water` = suelo ocupado, cero.
    const forma = { rect: [51, 73, 22, 14] };
    const input = {
      seed: "tile_0_0",
      vegetation_zones: zonas([{ type: "pino", area: [51, 73, 22, 14], density: 0.08 }]),
    };
    const sobreArea = deriveVolumesFromSchema(
      { ...input, ground: suelo([{ id: "plaza", kind: "area", material: "cobble", ...forma }]) },
      [],
    ).vegetation;
    const sobreAgua = deriveVolumesFromSchema(
      { ...input, ground: suelo([{ id: "charca", kind: "water", ...forma }]) },
      [],
    ).vegetation;
    assert.ok(sobreArea.length > 0, "el parche de material no debe vaciar la zona");
    assert.deepEqual(sobreAgua, [], "la charca ocupa toda la zona");
  });

  it("la fixture robledo_tile: el pinar flanquea el camino real y no lo pisa", () => {
    // Esta fixture es la que sostiene la EVIDENCIA VISUAL del arreglo (preset
    // html-fixtures, selector Room). Sin este candado, alguien le quita la
    // zona de vegetación o el `ground` del camino y la captura de qa/ deja de
    // ser reproducible sin que nada se ponga rojo.
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL("../data/scenes/robledo_tile.json", import.meta.url)), "utf-8"),
    ) as Record<string, unknown>;
    // El seed es la CLAVE DEL TILE (tile_0_0), que es lo que compone la
    // partida — con el `scene_id` del JSON ("robledo_tile") este test candaba
    // un pinar distinto del que se ve en pantalla.
    const pinar = (ground?: GroundFeature[]) =>
      deriveVolumesFromSchema(
        {
          seed: "tile_0_0",
          entities: raw.entities as never,
          vegetation_zones: zonas(raw.vegetation_zones as unknown[]),
          ...(ground ? { ground } : {}),
        },
        [],
      ).vegetation;

    // camino_real: y=63,5 · w=4 → banda 2,5 celdas.
    const enCalzada = (v: Volume) => Math.abs(at(v)[1] - 63.5) <= 2.5;
    // Aserción PAREADA, y aquí no es un lujo: sin ella basta con mover la zona
    // lejos del camino para que "calzada libre" salga verde sin comprobar
    // nada. Este par afirma que la zona de la fixture SIGUE cruzando el
    // camino, que es lo único que la convierte en evidencia.
    const sinSuelo = pinar();
    assert.ok(
      sinSuelo.filter(enCalzada).length > 0,
      `la zona debe seguir cruzando la calzada para ser evidencia: ${JSON.stringify(sinSuelo.map(at))}`,
    );

    const derived = pinar(suelo(raw.ground as unknown[]));
    assert.ok(derived.length >= 10, `el pinar debe verse: ${derived.length} volúmenes`);
    assert.deepEqual(derived.filter(enCalzada).map(at), [], "calzada libre");
    // NO se comprueba aquí el río: la zona declarada ([2,50,46,26] → u∈[4,46])
    // no llega a las columnas 84-92 del río Negro, así que una aserción de
    // "río libre" sobre esta fixture no podría ponerse roja jamás. El agua la
    // cubre el test de arriba, con un `ground` sintético que sí la solapa.
  });

  it("un type de matorral produce bush, y los arbustos NO se separan como troncos", () => {
    // Un arbusto no colisiona (collision.ts lo salta): exigirle la separación
    // del tronco sería regalarle hueco a algo que se atraviesa.
    const out = deriveVolumesFromSchema(
      { seed: "tile_0_0", vegetation_zones: zonas([{ type: "matorral", area: [0, 0, 60, 60], density: 0.08 }]) },
      [],
    ).vegetation;
    assert.ok(out.length > 0);
    assert.ok(out.every((v) => v.type === "bush"), "todo bushes");
  });
});

/** Las otras dos rutas del derive —`structures` → edificio cutaway y
 *  `entities` estáticas → su volumen equivalente— son las que reconcilian las
 *  DOS representaciones del mismo objeto: la entity del esquema y su volumen.
 *  De ahí sale `representedBy`, que es lo que impide pintar las dos. */
describe("deriveVolumesFromSchema: structures y entities del tile", () => {
  it("una room del esquema deriva un edificio cutaway con sus puertas por edge", () => {
    const out = deriveVolumesFromSchema(
      {
        seed: "tile_0_0",
        structures: [
          {
            type: "room",
            rect: [10, 20, 12, 8],
            doors: [{ side: "south", at: 4, width: 3 }, { side: "west", at: 2 }],
          },
        ],
      },
      [],
    ).volumes;
    assert.equal(out.length, 1);
    const b = out[0] as Extract<Volume, { type: "building" }>;
    assert.equal(b.type, "building");
    assert.equal(b.cutaway, true, "la room es ENTERABLE: sin cutaway no habría interior ni vano");
    assert.deepEqual(b.rect, [10, 20, 12, 8]);
    // side (Format D) → edge (blueprint); sin `width` el vano cae al default.
    assert.deepEqual(b.doors, [{ edge: "s", at: 4, w: 3 }, { edge: "w", at: 2, w: 4 }]);
  });

  it("lo que el motor YA declaró manda: una room que solapa un volume no se duplica", () => {
    const declared = vols([
      { id: "posada", label: "posada", type: "building", rect: [10, 20, 12, 8], cutaway: true },
    ]);
    const solapa = deriveVolumesFromSchema(
      { seed: "tile_0_0", structures: [{ type: "room", rect: [14, 22, 6, 4], doors: [] }] },
      declared,
    );
    assert.deepEqual(solapa.volumes, [], "el LLM ya cubrió ese rect");

    // Y una room APARTADA sí se deriva: la regla es el solape, no "hay volumes".
    const aparte = deriveVolumesFromSchema(
      { seed: "tile_0_0", structures: [{ type: "room", rect: [60, 60, 6, 6], doors: [] }] },
      declared,
    );
    assert.equal(aparte.volumes.length, 1);
  });

  it("una structure que no es room, o con rect imposible, se ignora sin lanzar", () => {
    const out = deriveVolumesFromSchema(
      {
        seed: "tile_0_0",
        structures: [
          { type: "plaza", rect: [10, 10, 4, 4] },
          { type: "room", rect: [10, 10, 0, 4] },
          { type: "room", rect: "no es un rect" },
          { type: "room" },
        ],
      },
      [],
    );
    // Es composición, no validación: la escena ya pasó por el zod y por
    // validateScene, así que una primitiva rota se salta en silencio.
    assert.deepEqual(out.volumes, []);
  });

  it("cada kind estático deriva su primitiva y queda MARCADA como representada", () => {
    const out = deriveVolumesFromSchema(
      {
        seed: "tile_0_0",
        entities: [
          { id: "casa", kind: "building", name: "casa del leñador", cell: [4, 4], footprint: [6, 5] },
          { id: "roble", kind: "tree", name: "roble", cell: [40, 40], footprint: [4, 6] },
          { id: "secuoya", kind: "tree", name: "secuoya", cell: [100, 20], footprint: [16, 16] },
          { id: "carro", kind: "prop", name: "carro", cell: [60, 60], footprint: [3, 2], shape: "cylinder" },
          { id: "farol", kind: "decor", name: "farol", cell: [80, 80], footprint: [1, 1] },
          { id: "yo", kind: "player", name: "Tú", cell: [90, 90], footprint: [1, 1] },
        ],
      },
      [],
    );
    const byId = new Map(out.volumes.map((v) => [v.id, v]));
    assert.equal(out.volumes.length, 5, "el player no es un volumen (solo building/tree/prop/decor)");

    // Cada entity estática sabe qué volumen la representa: es lo que impide
    // que el cliente le pinte un billboard encima al árbol que ya está ahí.
    assert.deepEqual(out.representedBy, {
      casa: "derived_ent_casa",
      roble: "derived_ent_roble",
      secuoya: "derived_ent_secuoya",
      carro: "derived_ent_carro",
      farol: "derived_ent_farol",
    });

    const casa = byId.get("derived_ent_casa") as Extract<Volume, { type: "building" }>;
    assert.equal(casa.type, "building");
    assert.equal(casa.label, "casa del leñador", "el label del motor viaja al blueprint");
    assert.equal(casa.roof?.kind, "gable");

    // El árbol se centra en su huella y su escala sale del lado mayor / 4…
    const roble = byId.get("derived_ent_roble") as Extract<Volume, { type: "tree" }>;
    assert.deepEqual(roble.at, [42, 43]);
    assert.equal(roble.s, 1.5);
    // …con el tope de TREE_MAX_S, que es lo que impide que una huella grande
    // (una arboleda declarada como una sola entity) plante un árbol gigante.
    const secuoya = byId.get("derived_ent_secuoya") as Extract<Volume, { type: "tree" }>;
    assert.equal(secuoya.s, 1.8);

    const carro = byId.get("derived_ent_carro") as Extract<Volume, { type: "prop" }>;
    assert.equal(carro.shape, "cylinder", "shape esfera/cilindro → cilindro; el resto, caja");
    assert.equal(carro.h, 3);

    // El decor es ATREZO: se pinta pero no bloquea el paso.
    const farol = byId.get("derived_ent_farol") as Extract<Volume, { type: "prop" }>;
    assert.equal(farol.h, 1);
    assert.equal(farol.passable, true);
  });

  it("una entity fuera del grid se recorta al tile en vez de irse al infinito", () => {
    const out = deriveVolumesFromSchema(
      {
        seed: "tile_0_0",
        entities: [{ id: "lejos", kind: "prop", name: "hito", cell: [900, -5], footprint: [999, 2] }],
      },
      [],
    ).volumes;
    const p = out[0] as Extract<Volume, { type: "prop" }>;
    assert.deepEqual(p.rect, [127, 0, 128, 2]);
  });

  it("una entity que cae sobre algo ya derivado no se apila encima, y el mobiliario sigue visible", () => {
    const out = deriveVolumesFromSchema(
      {
        seed: "tile_0_0",
        structures: [{ type: "room", rect: [10, 10, 10, 10], doors: [] }],
        entities: [
          { id: "dentro", kind: "prop", name: "barril", cell: [12, 12], footprint: [2, 2] },
          { id: "fuera", kind: "prop", name: "barril", cell: [60, 60], footprint: [2, 2] },
        ],
      },
      [],
    );
    assert.deepEqual(
      out.volumes.map((v) => v.id).sort(),
      ["derived_ent_fuera", "derived_room_0"],
      "la structure ya ocupa ese rect: el barril de dentro no se deriva",
    );
    // Y NO queda marcado como representado: el barril de dentro de la posada
    // es una entity de pleno derecho y hay que verla (el greybox pinta la
    // casa, no su mobiliario). Solo un EDIFICIO tapado por otro volumen es el
    // mismo objeto que él.
    assert.deepEqual(out.representedBy, { fuera: "derived_ent_fuera" });
  });

  it("un edificio-entity que ya cubre un volume declarado queda representado POR ÉL", () => {
    // Es el caso de siempre: el motor declara la posada en `volumes` y además
    // la lista como entity. Sin esta marca, el cliente pintaba la caja del
    // greybox y encima un billboard del mismo edificio.
    const declared = vols([
      { id: "posada", label: "posada", type: "building", rect: [10, 20, 12, 8], cutaway: true },
    ]);
    const out = deriveVolumesFromSchema(
      {
        seed: "tile_0_0",
        entities: [{ id: "posada_ent", kind: "building", name: "posada", cell: [10, 20], footprint: [12, 8] }],
      },
      declared,
    );
    assert.deepEqual(out.volumes, []);
    assert.deepEqual(out.representedBy, { posada_ent: "posada" });
  });
});
