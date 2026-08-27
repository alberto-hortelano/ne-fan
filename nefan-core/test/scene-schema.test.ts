/** Gate estructural de escena Format D (FormatDSceneSchema).
 *
 *  Verifica que ACEPTA las escenas reales del repo y que RECHAZA con error
 *  preciso justo lo que ai_server/validate_scene_response degradaba en
 *  silencio (filas de terrain mal dimensionadas, entities malformadas, un tile
 *  con grid…). El pre-flight MCP usa este schema para que el error vuelva al
 *  modelo en vez de mutilar la escena. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { FormatDSceneSchema } from "../src/contract/model-io/scene-schema.js";
import { validateContract } from "../src/contract/model-io/validate.js";
import { MIN_VANO_CELDAS } from "../src/scene/blueprint/volumes.js";
import { BODY_RADIUS_M, celdasLibresParaRadio } from "../src/scene/terrain-collision.js";
import { TILE_MPC } from "../src/scene/tile.js";
import { NPC_ROLES } from "../src/simulation/npc-roles.js";

const SCENES = fileURLToPath(new URL("../data/scenes", import.meta.url));
const TOOLS = fileURLToPath(new URL("../data/contract/tools", import.meta.url));

function accepts(scene: unknown): true | string {
  const r = FormatDSceneSchema.safeParse(scene);
  if (r.success) return true;
  return `${r.error.issues[0].path.join(".")}: ${r.error.issues[0].message}`;
}

describe("FormatDSceneSchema — acepta las escenas reales", () => {
  const files = readdirSync(SCENES).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    it(f, () => {
      const scene = JSON.parse(readFileSync(resolve(SCENES, f), "utf-8"));
      assert.equal(accepts(scene), true);
    });
  }
});

describe("FormatDSceneSchema — rechaza lo que el saneador degradaba", () => {
  /** Format D tiene UNA variante: el tile del mundo continuo. */
  const base = {
    scene_id: "tile_0_0",
    scene_description: "una escena de prueba",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1], glyph: "@" }],
  };

  it("acepta la escena base válida", () => {
    assert.equal(accepts(base), true);
  });

  it("entity con kind fuera del enum (antes: → prop)", () => {
    const r = FormatDSceneSchema.safeParse({
      ...base,
      entities: [{ id: "x", kind: "monster", name: "X", cell: [0, 0], footprint: [1, 1], glyph: "x" }],
    });
    assert.equal(r.success, false);
  });

  it("entity sin glyph / footprint (antes: glifo de reserva / clamp)", () => {
    assert.equal(
      FormatDSceneSchema.safeParse({ ...base, entities: [{ id: "x", kind: "prop", name: "X", cell: [0, 0], footprint: [1, 1] }] }).success,
      false,
    );
    assert.equal(
      FormatDSceneSchema.safeParse({ ...base, entities: [{ id: "x", kind: "prop", name: "X", cell: [0, 0], glyph: "x" }] }).success,
      false,
    );
  });

  it("entities ausente o no-lista", () => {
    const noEnt: Record<string, unknown> = { ...base };
    delete noEnt.entities;
    assert.equal(FormatDSceneSchema.safeParse(noEnt).success, false);
    assert.equal(FormatDSceneSchema.safeParse({ ...base, entities: "nope" }).success, false);
  });

  it("un tile con size/terrain propios, o sin biome, se rechaza", () => {
    // El grid del tile lo SINTETIZA el engine (128×128 @0,5 m) desde el bioma
    // y las primitivas: un grid a mano es un error de contrato, no una escena
    // pequeña. Antes el saneador Python lo rellenaba/truncaba en silencio.
    const conGrid = { ...base, size: { cols: 4, rows: 2, meters_per_cell: 0.5 }, terrain: ["gggg", "gggg"] };
    assert.equal(FormatDSceneSchema.safeParse(conGrid).success, false);
    const sinBiome: Record<string, unknown> = { ...base };
    delete sinBiome.biome;
    assert.equal(FormatDSceneSchema.safeParse(sinBiome).success, false);
  });

  it("tolera campos legacy por passthrough (no rechaza)", () => {
    assert.equal(accepts({ ...base, ambient_event: "viento", exits: [] }), true);
  });
});

/** El suelo de los VANOS declarados. Es el fail-fast barato del cuerpo mayor
 *  (#289): un vano de 2 celdas lo cruza el jugador y NUNCA un NPC, así que ni
 *  siquiera llega al collider. La garantía completa la da el flood con cuerpo
 *  de `validateScene`, que además cubre los huecos que no declara nadie (dos
 *  props que pinzan un paso); esto solo rechaza antes y más barato.
 *
 *  El MENSAJE es contrato: viaja al motor por el pre-flight de
 *  `narrative_respond` y tiene que decir el mínimo EN METROS, que es como el
 *  motor razona el mundo (declara en celdas, piensa en metros). */
describe("FormatDSceneSchema — un vano más estrecho que el cuerpo mayor no llega al collider", () => {
  const conVolume = (v: Record<string, unknown>): unknown => ({
    scene_id: "tile_0_0",
    scene_description: "una escena de prueba",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1], glyph: "@" }],
    volumes: [v],
  });
  const posada = (w: number): unknown =>
    conVolume({ id: "posada", label: "posada", type: "building", rect: [10, 10, 12, 10], cutaway: true, doors: [{ edge: "s", at: 4, w }] });
  const arco = (w: number): unknown =>
    conVolume({ id: "arco", label: "portillo", type: "gate", at: [30, 30], w, orient: "x" });

  it(`el mínimo son ${MIN_VANO_CELDAS} celdas, y sale del cuerpo mayor y del mpc del tile`, () => {
    assert.equal(MIN_VANO_CELDAS, celdasLibresParaRadio(BODY_RADIUS_M, TILE_MPC));
    assert.equal(MIN_VANO_CELDAS, 3, "a mpc 0,5 son 1,5 m");
  });

  for (const [campo, escena] of [["doors[].w", posada], ["gate.w", arco]] as const) {
    it(`${campo}: 2 celdas (1 m) se rechaza diciendo el mínimo EN METROS`, () => {
      const r = FormatDSceneSchema.safeParse(escena(2));
      assert.equal(r.success, false, "un vano de 1 m no puede pasar el gate");
      const msg = r.success ? "" : r.error.issues.map((i) => i.message).join(" | ");
      assert.match(msg, /1,5 m/, `el mensaje debe decir el mínimo en metros: ${msg}`);
      assert.match(msg, new RegExp(campo.replace(/[[\].]/g, "\\$&")), `y de qué campo habla: ${msg}`);
    });

    it(`${campo}: ${MIN_VANO_CELDAS} celdas (1,5 m) se acepta`, () => {
      assert.equal(accepts(escena(MIN_VANO_CELDAS)), true);
    });

    it(`${campo}: y el borde es estricto — un pelo por debajo del mínimo se rechaza`, () => {
      assert.equal(FormatDSceneSchema.safeParse(escena(MIN_VANO_CELDAS - 0.01)).success, false);
    });
  }
});

/** CANDADO de las variantes retiradas. La escena "suelta" —grid propio, sin
 *  sitio en el plano continuo— se retiró con el issue #172 y el PLATÓ
 *  proscenio con la vista que lo pintaba: las dos eran Format D perfectamente
 *  válido. El gate tiene que rechazarlas Y decirle al modelo cuál es la forma
 *  viva, porque el pre-flight de narrative-mcp le devuelve ese texto para que
 *  re-responda. */
describe("FormatDSceneSchema — solo queda el tile", () => {
  /** Una suelta impecable: nada malformado, solo la variante retirada. */
  const suelta = {
    scene_id: "aldea_suelta",
    scene_description: "Una aldea sin sitio en el mundo.",
    size: { cols: 4, rows: 2, meters_per_cell: 2 },
    terrain: ["gggg", "gggg"],
    terrain_legend: {},
    entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1], glyph: "@" }],
  };

  /** El plató: la suelta más su bloque `stage`. Pasaba el gate hasta hoy. */
  const plato = {
    ...suelta,
    place_id: "sala",
    stage: {
      exits: [
        { id: "puerta", edge: "north", to_place_id: "cocina", zone: [1, 0, 2, 1], kind: "door", label: "Puerta a la cocina" },
      ],
    },
  };

  for (const [nombre, escena] of [["suelta", suelta], ["plató", plato]] as const) {
    it(`rechaza la escena ${nombre} aunque esté perfectamente formada, y nombra la viva`, () => {
      const r = FormatDSceneSchema.safeParse(escena);
      assert.equal(r.success, false, `una escena sin tile debe fallar (${nombre})`);
      if (r.success) return;
      const msg = r.error.issues[0].message;
      assert.deepEqual(r.error.issues[0].path, [], "el problema es de la escena entera, no de un campo");
      assert.match(msg, /`tile`/, msg);
      assert.match(msg, /generate_tile/, msg);
    });
  }

  it("el rechazo llega al modelo por la misma vía que el pre-flight MCP", () => {
    // narrative-mcp/validators.ts:validateFormatDScene es exactamente esto.
    const res = validateContract(FormatDSceneSchema, suelta);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /`tile`/, res.error);
  });

  it("con `tile` pasa: la retirada no toca a la variante viva", () => {
    const tile = { scene_id: "tile_0_0", scene_description: "campo", tile: { tx: 0, ty: 0 }, biome: "grass", entities: [] };
    assert.equal(accepts(tile), true);
  });
});

/** El rechazo de un rol inventado es el ÚNICO modo de fallo nuevo que esta
 *  tanda le añade al motor, así que su mensaje es parte del contrato: el
 *  pre-flight MCP se lo pega al `isError` de narrative_respond y el motor
 *  re-responde con él delante, en bucle, ANTES de que la escena llegue a
 *  nadie. `formatError` solo le enseña el PRIMER issue, de modo que ese
 *  primero tiene que bastar para arreglarlo sin adivinar. */
describe("FormatDSceneSchema — un rol inventado vuelve al modelo accionable", () => {
  const tileCon = (npc: Record<string, unknown>) => ({
    scene_id: "tile_0_0",
    scene_description: "El pueblo, a media mañana.",
    tile: { tx: 0, ty: 0 },
    biome: "dirt",
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1], glyph: "@" },
      { kind: "npc", cell: [60, 60], footprint: [1, 1], glyph: "n", ...npc },
    ],
  });

  it("nombra AL NPC por su id, el rol ofensor y los cuatro valores", () => {
    const res = validateContract(
      FormatDSceneSchema,
      tileCon({ id: "boris_herrero", name: "Boris el Herrero", role: "herrero" }),
    );
    assert.equal(res.ok, false, "un oficio en `role` no puede colarse");
    if (res.ok) return;
    // El id: con ochenta entidades en un tile, "entities[37]" obliga a contar.
    assert.match(res.error, /boris_herrero/, res.error);
    assert.match(res.error, /"herrero"/, res.error);
    for (const rol of NPC_ROLES) assert.match(res.error, new RegExp(rol), res.error);
    // Y dónde SÍ va el oficio: sin esto el motor solo sabe que se equivocó.
    assert.match(res.error, /`name`/, res.error);
    assert.match(res.error, /`description`/, res.error);
  });

  it("el mensaje es el MISMO que da el saneador de ai_server", () => {
    // Los dos procesos rechazan por la misma lista; si divergieran, ai_server
    // lanzaría DESPUÉS del pre-flight y ahí ya no hay re-respuesta: el tile se
    // pierde (llm_client.py lo trata como divergencia de reglas, y lo es).
    const espejo = JSON.parse(
      readFileSync(resolve(TOOLS, "generate_scene.json"), "utf-8"),
    ) as { input_schema: { properties: { entities: { items: { properties: { role: { enum: string[] } } } } } } };
    assert.deepEqual(
      espejo.input_schema.properties.entities.items.properties.role.enum,
      [...NPC_ROLES],
      "el enum que lee ai_server tiene que ser el que rechaza este gate",
    );
  });

  it("cada rol del vocabulario pasa (el gate no rechaza de más)", () => {
    for (const rol of NPC_ROLES) {
      assert.equal(accepts(tileCon({ id: `npc_${rol}`, name: "X", role: rol })), true, rol);
    }
    // Y sin `role`, que sigue siendo opcional.
    assert.equal(accepts(tileCon({ id: "anon", name: "Aldeano" })), true);
  });
});
