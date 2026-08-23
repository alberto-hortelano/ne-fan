/** Ruta A de `vegetation_zones` (re-expuesto en el contrato 2026-08-17): el
 *  blueprint deriva volúmenes tree/bush REALES de las zonas declaradas —
 *  determinista, respetando blockers, bandas y árboles declarados como
 *  semillas de separación. (La ruta B — entities del grid — la cubren
 *  tile.test.ts y scene-expand.test.ts.) */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveVolumesFromSchema } from "../src/scene/blueprint/derive.js";
import { parseGround, type GroundFeature } from "../src/scene/blueprint/ground.js";
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

/** Centro de un volumen tree/bush derivado. */
function at(v: Volume): [number, number] {
  return (v as Extract<Volume, { type: "tree" }>).at as [number, number];
}

describe("deriveVolumesFromSchema: vegetation_zones", () => {
  it("puebla una zona 'rest' con árboles, determinista", () => {
    const input = {
      scene_id: "tile_0_0",
      vegetation_zones: [{ type: "pino", area: "rest" as const, density: 0.4 }],
    };
    const a = deriveVolumesFromSchema(input, []);
    const b = deriveVolumesFromSchema(input, []);
    assert.deepEqual(a, b, "misma entrada → mismos volúmenes");
    assert.ok(a.length >= 30, `derivados: ${a.length}`);
    assert.ok(a.every((v) => v.type === "tree"), "todo trees");
  });

  it("density 0 apaga la zona (control local)", () => {
    const out = deriveVolumesFromSchema(
      { scene_id: "t", vegetation_zones: [{ type: "pino", area: "rest", density: 0 }] },
      [],
    );
    assert.equal(out.length, 0);
  });

  it("respeta blockers declarados y usa los trees del motor como semillas de separación", () => {
    const declared = vols([
      { id: "nave", label: "nave", type: "building", rect: [0, 0, 128, 60] },
      { id: "roble_viejo", label: "roble", type: "tree", at: [96, 96], s: 1.5 },
    ]);
    const out = deriveVolumesFromSchema(
      { scene_id: "tile_0_0", vegetation_zones: [{ type: "pino", area: "rest", density: 0.6 }] },
      declared,
    );
    assert.ok(out.length > 0);
    for (const v of out) {
      const at = (v as Extract<Volume, { type: "tree" }>).at;
      assert.ok(at[1] > 60, `no planta dentro/margen del blocker: ${JSON.stringify(at)}`);
      const d2 = (at[0] - 96) ** 2 + (at[1] - 96) ** 2;
      assert.ok(d2 >= 8 * 8, `separación del árbol declarado: ${JSON.stringify(at)}`);
    }
  });

  // ── El suelo declarado excluye ────────────────────────────────────────────
  // El contrato le promete al motor que la vegetación de zona «automatically
  // avoids paths, water, buildings» (generate_scene.json). Hasta que
  // `DeriveInput` tuvo `ground`, esta ruta NO podía cumplirlo: la función no
  // veía el suelo, así que este test no se podía ni escribir.
  it("no planta en el camino ni en el agua declarados en `ground`", () => {
    const ground = suelo([
      // El camino real de robledo_tile: cruza el tile de lado a lado.
      { id: "camino_real", kind: "path", label: "camino real", points: [[0, 63.5], [128, 63.5]], w: 4, material: "dirt" },
      { id: "rio", kind: "water", label: "río Negro", rect: [84, 68, 8, 60] },
    ]);
    const input = {
      scene_id: "robledo_tile",
      vegetation_zones: [{ type: "pino", area: "rest" as const, density: 0.5 }],
    };
    // Banda del camino = w/2 + 0,5 celdas (la misma que usa el scatter fps).
    const enCamino = (v: Volume) => Math.abs(at(v)[1] - 63.5) <= 2.5;
    const enAgua = (v: Volume) => {
      const [u, w] = at(v);
      return u >= 84 && u <= 92 && w >= 68 && w <= 128;
    };

    // Aserción PAREADA: sin `ground` la misma entrada sí pisa camino y agua.
    // Sin este par, una zona que saliera vacía por cualquier otro motivo
    // pondría el test verde sin comprobar nada.
    const sinSuelo = deriveVolumesFromSchema(input, []);
    assert.ok(sinSuelo.some(enCamino), `sin ground debería pisar el camino (${sinSuelo.length} derivados)`);
    assert.ok(sinSuelo.some(enAgua), `sin ground debería pisar el agua (${sinSuelo.length} derivados)`);

    const conSuelo = deriveVolumesFromSchema({ ...input, ground }, []);
    assert.ok(conSuelo.length > 0, "la zona sigue poblando el resto del tile");
    assert.deepEqual(conSuelo.filter(enCamino).map(at), [], "ni un árbol sobre la calzada");
    assert.deepEqual(conSuelo.filter(enAgua).map(at), [], "ni un árbol sobre el río");
  });

  it("un parche de material (area) SÍ se puebla; la misma forma como agua, no", () => {
    // Un `area` es material (plaza, huerto): una zona declarada encima debe
    // poder plantarse. Misma forma como `water` = suelo ocupado, cero.
    const forma = { rect: [51, 73, 22, 14] };
    const input = {
      scene_id: "t",
      vegetation_zones: [{ type: "pino", area: [51, 73, 22, 14] as [number, number, number, number], density: 1 }],
    };
    const sobreArea = deriveVolumesFromSchema(
      { ...input, ground: suelo([{ id: "plaza", kind: "area", material: "cobble", ...forma }]) },
      [],
    );
    const sobreAgua = deriveVolumesFromSchema(
      { ...input, ground: suelo([{ id: "charca", kind: "water", ...forma }]) },
      [],
    );
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
    // MISMA composición que composeTilePlan (main.ts): ground parseado +
    // derive. Y el MISMO `scene_id`: main.ts pasa la CLAVE DE TILE, no el
    // scene_id del JSON, y de ahí sale la semilla del scatter — con
    // "robledo_tile" este test candaba un pinar distinto del que se ve en
    // pantalla (mismo recuento, otras posiciones).
    const pinar = (ground?: GroundFeature[]) =>
      deriveVolumesFromSchema(
        {
          scene_id: "tile_0_0",
          entities: raw.entities as never,
          vegetation_zones: raw.vegetation_zones as never,
          ...(ground ? { ground } : {}),
        },
        [],
      ).filter((v) => v.id.startsWith("derived_veg_"));

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
    assert.ok(derived.length >= 3, `el pinar debe verse: ${derived.length} volúmenes`);
    assert.deepEqual(derived.filter(enCalzada).map(at), [], "calzada libre");
    // NO se comprueba aquí el río: la zona declarada ([2,50,46,26] → u∈[4,46])
    // no llega a las columnas 84-92 del río Negro, así que una aserción de
    // "río libre" sobre esta fixture no podría ponerse roja jamás. El agua la
    // cubre el test de arriba, con un `ground` sintético que sí la solapa.
  });

  it("un type de matorral produce bush", () => {
    const out = deriveVolumesFromSchema(
      { scene_id: "t", vegetation_zones: [{ type: "matorral", area: [0, 0, 60, 60], density: 0.8 }] },
      [],
    );
    assert.ok(out.length > 0);
    assert.ok(out.every((v) => v.type === "bush"), "todo bushes");
  });
});

/** Las otras dos rutas del derive —`structures` → edificio cutaway y
 *  `entities` estáticas → su volumen equivalente— las ejercía SOLO el plan
 *  del plató (`stage/plan.ts`, vía las suites `stage-*`), que se retiró con la
 *  vista proscenio. Pero la función sigue VIVA y es del camino que sobrevive:
 *  la compone `main.ts` en cada tile y `style-apply.ts` en el batch de estilo,
 *  y de sus volúmenes salen las prims del atlas fps. Se re-anclan aquí, sobre
 *  el tile, escritas desde el contrato del módulo (no desde su código). */
describe("deriveVolumesFromSchema: structures y entities del tile", () => {
  it("una room del esquema deriva un edificio cutaway con sus puertas por edge", () => {
    const out = deriveVolumesFromSchema(
      {
        scene_id: "tile_0_0",
        structures: [
          {
            type: "room",
            rect: [10, 20, 12, 8],
            doors: [{ side: "south", at: 4, width: 3 }, { side: "west", at: 2 }],
          },
        ],
      },
      [],
    );
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
      { scene_id: "t", structures: [{ type: "room", rect: [14, 22, 6, 4], doors: [] }] },
      declared,
    );
    assert.deepEqual(solapa, [], "el LLM ya cubrió ese rect");

    // Y una room APARTADA sí se deriva: la regla es el solape, no "hay volumes".
    const aparte = deriveVolumesFromSchema(
      { scene_id: "t", structures: [{ type: "room", rect: [60, 60, 6, 6], doors: [] }] },
      declared,
    );
    assert.equal(aparte.length, 1);
  });

  it("una structure que no es room, o con rect imposible, se ignora sin lanzar", () => {
    const out = deriveVolumesFromSchema(
      {
        scene_id: "t",
        structures: [
          { type: "plaza", rect: [10, 10, 4, 4] },
          { type: "room", rect: [10, 10, 0, 4] },
          { type: "room", rect: "no es un rect" },
          { type: "room" },
        ],
      },
      [],
    );
    // Es un fallback VISUAL, no un validador: la escena ya pasó por
    // validateScene, así que una primitiva rota se salta en silencio.
    assert.deepEqual(out, []);
  });

  it("cada kind estático deriva su primitiva, y el árbol escala con su huella", () => {
    const out = deriveVolumesFromSchema(
      {
        scene_id: "t",
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
    const byId = new Map(out.map((v) => [v.id, v]));
    assert.equal(out.length, 5, "el player no es un volumen (solo building/tree/prop/decor)");

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
        scene_id: "t",
        entities: [{ id: "lejos", kind: "prop", name: "hito", cell: [900, -5], footprint: [999, 2] }],
      },
      [],
    );
    const p = out[0] as Extract<Volume, { type: "prop" }>;
    assert.deepEqual(p.rect, [127, 0, 128, 2]);
  });

  it("las entities del scatter NO derivan volumen (por flag o por patrón de id)", () => {
    const out = deriveVolumesFromSchema(
      {
        scene_id: "t",
        entities: [
          { id: "pino_z0_3", kind: "tree", name: "pino", cell: [10, 10], footprint: [2, 2] },
          { id: "matorral", kind: "tree", name: "mata", cell: [30, 30], footprint: [2, 2], scattered: true },
          { id: "roble_solo", kind: "tree", name: "roble", cell: [50, 50], footprint: [2, 2] },
        ],
      },
      [],
    );
    // Su vegetación visual sale de vegetation_zones; derivar una por entity
    // producía miles de volúmenes en un save expandido y colgaba el cliente.
    assert.deepEqual(out.map((v) => v.id), ["derived_ent_roble_solo"]);
  });

  it("el cap de entities prioriza edificios sobre props, decor y árboles", () => {
    const entities = [
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `arbol_${i}`, kind: "tree", name: "árbol",
        cell: [(i % 10) * 12, Math.floor(i / 10) * 12], footprint: [2, 2],
      })),
      { id: "torre", kind: "building", name: "torre", cell: [118, 118], footprint: [4, 4] },
    ];
    const out = deriveVolumesFromSchema({ scene_id: "t", entities }, []);
    assert.equal(out.length, 80, "cap duro de volúmenes derivados de entities");
    assert.ok(
      out.some((v) => v.id === "derived_ent_torre"),
      "el edificio entra aunque llegue el último: el cap ordena por prioridad de kind",
    );
  });

  it("una entity que cae sobre algo ya derivado no se apila encima", () => {
    const out = deriveVolumesFromSchema(
      {
        scene_id: "t",
        structures: [{ type: "room", rect: [10, 10, 10, 10], doors: [] }],
        entities: [
          { id: "dentro", kind: "prop", name: "barril", cell: [12, 12], footprint: [2, 2] },
          { id: "fuera", kind: "prop", name: "barril", cell: [60, 60], footprint: [2, 2] },
        ],
      },
      [],
    );
    assert.deepEqual(
      out.map((v) => v.id).sort(),
      ["derived_ent_fuera", "derived_room_0"],
      "la structure ya ocupa ese rect: el barril de dentro no se deriva",
    );
  });
});
