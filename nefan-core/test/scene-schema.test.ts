/** Gate estructural de escena Format D (EmittedSceneSchema).
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

import {
  EmittedSceneSchema,
  ExpandedSceneSchema,
  EntitySchema,
  ENTITY_FIELDS,
  EMITTED_SCENE_FIELDS,
  SCENE_FIELDS,
  RADIO_SIMULADO_POR_KIND,
} from "../src/contract/model-io/scene-schema.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { validateContract } from "../src/contract/model-io/validate.js";
import { MIN_VANO_CELDAS } from "../src/scene/blueprint/volumes.js";
import { BODY_RADIUS_M, celdasLibresParaRadio, celdasQueCubreRadio } from "../src/scene/terrain-collision.js";
import { TILE_MPC } from "../src/scene/tile.js";
import { NPC_ROLES } from "../src/simulation/npc-roles.js";

const SCENES = fileURLToPath(new URL("../data/scenes", import.meta.url));
const TOOLS = fileURLToPath(new URL("../data/contract/tools", import.meta.url));

function accepts(scene: unknown): true | string {
  const r = EmittedSceneSchema.safeParse(scene);
  if (r.success) return true;
  return `${r.error.issues[0].path.join(".")}: ${r.error.issues[0].message}`;
}

describe("EmittedSceneSchema — acepta las escenas reales", () => {
  const files = readdirSync(SCENES).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    it(f, () => {
      const scene = JSON.parse(readFileSync(resolve(SCENES, f), "utf-8"));
      assert.equal(accepts(scene), true);
    });
  }
});

describe("EmittedSceneSchema — rechaza lo que el saneador degradaba", () => {
  /** Format D tiene UNA variante: el tile del mundo continuo. */
  const base = {
    scene_id: "tile_0_0",
    scene_description: "una escena de prueba",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1] }],
  };

  it("acepta la escena base válida", () => {
    assert.equal(accepts(base), true);
  });

  it("entity con kind fuera del enum (antes: → prop)", () => {
    const r = EmittedSceneSchema.safeParse({
      ...base,
      entities: [{ id: "x", kind: "monster", name: "X", cell: [0, 0], footprint: [1, 1] }],
    });
    assert.equal(r.success, false);
  });

  it("entity sin footprint (antes: clamp)", () => {
    assert.equal(
      EmittedSceneSchema.safeParse({ ...base, entities: [{ id: "x", kind: "prop", name: "X", cell: [0, 0] }] }).success,
      false,
    );
  });

  it("entities ausente o no-lista", () => {
    const noEnt: Record<string, unknown> = { ...base };
    delete noEnt.entities;
    assert.equal(EmittedSceneSchema.safeParse(noEnt).success, false);
    assert.equal(EmittedSceneSchema.safeParse({ ...base, entities: "nope" }).success, false);
  });

  it("un tile con size/terrain propios, o sin biome, se rechaza", () => {
    // El grid del tile lo SINTETIZA el engine (128×128 @0,5 m) desde el bioma
    // y las primitivas: un grid a mano es un error de contrato, no una escena
    // pequeña. Antes el saneador Python lo rellenaba/truncaba en silencio.
    const conGrid = { ...base, size: { cols: 4, rows: 2, meters_per_cell: 0.5 }, terrain: ["gggg", "gggg"] };
    assert.equal(EmittedSceneSchema.safeParse(conGrid).success, false);
    const sinBiome: Record<string, unknown> = { ...base };
    delete sinBiome.biome;
    assert.equal(EmittedSceneSchema.safeParse(sinBiome).success, false);
  });

  // ── La raíz CERRADA (#400) ───────────────────────────────────────────────
  // Hasta aquí la escena era `.passthrough()` y una clave inventada en la raíz
  // cruzaba muda hasta el save. Ahora vuelve al modelo con su nombre y con la
  // lista de lo que sí existe — la misma forma que el rebote de la entity.
  it("una clave de raíz desconocida se rechaza nombrándola y listando los campos del motor", () => {
    const res = validateContract(EmittedSceneSchema, { ...base, nota_del_motor: "sin uso" });
    assert.equal(res.ok, false, "la clave inventada no puede colarse");
    if (res.ok) return;
    assert.match(res.error, /la escena trae la clave `nota_del_motor`/, res.error);
    for (const campo of EMITTED_SCENE_FIELDS) assert.match(res.error, new RegExp(`\\b${campo}\\b`), res.error);
    // Y NO le enseña el grid, que el motor no escribe nunca, ni `place_anchors`,
    // que el tool no describe (un nombre sin esquema no se enseña).
    assert.doesNotMatch(res.error, /\bsize\b|\bterrain\b|place_anchors/, res.error);
    assert.match(res.error, /`scene_description`/, res.error);
  });

  it("`style_ref` de escena y `__expanded` siguen rechazándose con SU motivo (no con el genérico)", () => {
    // Antes vivían en el `superRefine`; con `.strict()` el primer issue es la
    // clave desconocida, así que el motivo tiene que salir del errorMap o el
    // motor pierde el porqué.
    const conRef = validateContract(EmittedSceneSchema, { ...base, style_ref: "settlement" });
    assert.equal(conRef.ok, false);
    if (conRef.ok) return;
    assert.match(conRef.error, /`style_ref` de escena está retirado/, conRef.error);
    assert.match(conRef.error, /`style_ref` en los NPCs/, conRef.error);
    const marcada = validateContract(EmittedSceneSchema, { ...base, __expanded: false });
    assert.equal(marcada.ok, false, "con `in`, cualquier valor — también `false`");
    if (marcada.ok) return;
    assert.match(marcada.error, /`__expanded` es la marca interna del expander/, marcada.error);
  });

  it("`place_anchors` está declarado: la forma buena pasa y la mala se rechaza", () => {
    assert.equal(accepts({ ...base, place_anchors: [{ place_id: "taberna", rect: [52, 48, 24, 16] }] }), true);
    assert.equal(accepts({ ...base, place_anchors: [{ place_id: "taberna" }] }), true, "rect opcional");
    assert.match(
      String(accepts({ ...base, place_anchors: [{ place_id: "taberna", color: 1 }] })),
      /place_anchors.*color/,
      "clave extra en el ancla: rechazada nombrándola, como en ai_server (QA de PR-A de T7)",
    );
    assert.notEqual(accepts({ ...base, place_anchors: [{ rect: [1, 2, 3, 4] }] }), true, "sin place_id no ancla nada");
    assert.notEqual(accepts({ ...base, place_anchors: [{ place_id: "x", rect: [1, 2, 3] }] }), true, "rect son 4 enteros");
    assert.notEqual(
      accepts({ ...base, place_anchors: Array.from({ length: 9 }, (_, i) => ({ place_id: `p${i}` })) }),
      true,
      "tope de 8, como el saneador de ai_server",
    );
  });

  it("ExpandedSceneSchema (lo que el juego CARGA) también es `.strict()`, y su lista incluye la marca", () => {
    const cargada = expandScenePrimitives(base);
    assert.equal(ExpandedSceneSchema.safeParse(cargada).success, true, "la base expandida pasa");
    const res = validateContract(ExpandedSceneSchema, { ...cargada, nota_del_motor: "sin uso" });
    assert.equal(res.ok, false, "un save con una clave desconocida no carga mudo");
    if (res.ok) return;
    assert.match(res.error, /la escena trae la clave `nota_del_motor`/, res.error);
    for (const campo of [...SCENE_FIELDS, "__expanded"]) assert.match(res.error, new RegExp(`\\b${campo}\\b`), res.error);
    // Y la `style_ref` de escena heredada de un snapshot viejo se rebota al
    // cargar con su motivo: pre-producción, el snapshot se regenera.
    const conRef = validateContract(ExpandedSceneSchema, { ...cargada, style_ref: "settlement" });
    assert.equal(conRef.ok, false);
    if (conRef.ok) return;
    assert.match(conRef.error, /`style_ref` de escena está retirado/, conRef.error);
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
describe("EmittedSceneSchema — un vano más estrecho que el cuerpo mayor no llega al collider", () => {
  const conVolume = (v: Record<string, unknown>): unknown => ({
    scene_id: "tile_0_0",
    scene_description: "una escena de prueba",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1] }],
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
      const r = EmittedSceneSchema.safeParse(escena(2));
      assert.equal(r.success, false, "un vano de 1 m no puede pasar el gate");
      const msg = r.success ? "" : r.error.issues.map((i) => i.message).join(" | ");
      assert.match(msg, /1,5 m/, `el mensaje debe decir el mínimo en metros: ${msg}`);
      assert.match(msg, new RegExp(campo.replace(/[[\].]/g, "\\$&")), `y de qué campo habla: ${msg}`);
    });

    it(`${campo}: ${MIN_VANO_CELDAS} celdas (1,5 m) se acepta`, () => {
      assert.equal(accepts(escena(MIN_VANO_CELDAS)), true);
    });

    it(`${campo}: y el borde es estricto — un pelo por debajo del mínimo se rechaza`, () => {
      assert.equal(EmittedSceneSchema.safeParse(escena(MIN_VANO_CELDAS - 0.01)).success, false);
    });
  }
});

/** El TOPE del `footprint` de una entity MÓVIL (#300).
 *
 *  El contrato dejaba declarar `footprint: [8, 8]` a un NPC —4 metros— mientras
 *  el simulador lo mueve con un cuerpo de 0,5 m de radio y no lee el campo ni
 *  una vez (`grep footprint src/simulation/` = 0). Lo declarado y lo que el
 *  juego honra no estaban atados por nada, así que el motor podía prometer un
 *  cuerpo que no existe y nadie se enteraba.
 *
 *  El arreglo no es un test más: es hacer el estado malo INEXPRESABLE. El tope
 *  sale de `celdasQueCubreRadio` sobre el radio que el simulador honra para
 *  ese kind, así que no puede divergir de él ni quedarse atrás cuando alguien
 *  mueva un radio. Solo tienen tope los DOS kinds que alguien mueve: un
 *  edificio de 20×14 celdas es geometría legítima y sigue pasando. */
describe("EmittedSceneSchema — una entity móvil no declara más cuerpo del que el simulador mueve", () => {
  const conEntity = (e: Record<string, unknown>): unknown => ({
    scene_id: "tile_0_0",
    scene_description: "una escena de prueba",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    entities: [e],
  });
  const movil = (kind: string, n: number): unknown =>
    conEntity({ id: "bicho", kind, name: "Bicho", cell: [10, 10], footprint: [n, n] });

  it("el tope EFECTIVO del gate es el que sale del cuerpo simulado, no un número escrito a mano", () => {
    // Se mide probando el gate, no leyendo la constante: si alguien sustituye
    // la derivación por un literal que hoy coincide, este test se queda verde
    // pero el de al lado (`los dos kinds, con sus valores`) y los de
    // terrain-collision se ponen rojos en cuanto se mueva un radio.
    for (const [kind, radio] of Object.entries(RADIO_SIMULADO_POR_KIND)) {
      const tope = celdasQueCubreRadio(radio, TILE_MPC);
      for (let n = 1; n <= 16; n++) {
        assert.equal(
          EmittedSceneSchema.safeParse(movil(kind, n)).success,
          n <= tope,
          `${kind} con footprint [${n},${n}]: el tope de su cuerpo son ${tope} celdas`,
        );
      }
    }
  });

  it("los dos kinds móviles, con sus valores de hoy: npc 2 celdas, player 1", () => {
    assert.deepEqual(Object.keys(RADIO_SIMULADO_POR_KIND).sort(), ["npc", "player"]);
    assert.equal(accepts(movil("npc", 1)), true);
    assert.equal(accepts(movil("npc", 2)), true, "1,0 m es exactamente su cuerpo");
    assert.equal(EmittedSceneSchema.safeParse(movil("npc", 3)).success, false, "1,5 m no lo mueve nadie");
    assert.equal(accepts(movil("player", 1)), true);
    assert.equal(EmittedSceneSchema.safeParse(movil("player", 2)).success, false, "1,0 m > los 0,8 m del jugador");
  });

  it("los cinco kinds ESTÁTICOS no tienen tope: un granero de 20×14 es geometría legítima", () => {
    for (const kind of ["building", "prop", "item", "tree", "decor"]) {
      assert.equal(
        accepts(conEntity({ id: "granero", kind, name: "granero", cell: [10, 10], footprint: [20, 14] })),
        true,
        `${kind} [20,14] tiene que seguir pasando: nadie lo mueve`,
      );
    }
  });

  it("el mensaje nombra al bicho, lo que declaró y el cuerpo que se mueve, en celdas y en metros", () => {
    const r = EmittedSceneSchema.safeParse(movil("npc", 8));
    assert.equal(r.success, false);
    const msg = r.success ? "" : r.error.issues.map((i) => i.message).join(" | ");
    assert.match(msg, /"bicho"/, `nombra a la entity: ${msg}`);
    assert.match(msg, /\[8, ?8\]/, `y lo que declaró: ${msg}`);
    assert.match(msg, /4,0 m/, `y cuánto es eso en metros: ${msg}`);
    assert.match(msg, /2 celdas/, `y el tope en celdas: ${msg}`);
    assert.match(msg, /1,0 m/, `y el tope en metros: ${msg}`);
  });

  it("un footprint rectangular se juzga por su lado MAYOR", () => {
    assert.equal(accepts(conEntity({ id: "b", kind: "npc", name: "B", cell: [1, 1], footprint: [1, 2] })), true);
    assert.equal(
      EmittedSceneSchema.safeParse(conEntity({ id: "b", kind: "npc", name: "B", cell: [1, 1], footprint: [1, 5] })).success,
      false,
      "5 celdas de fondo son 2,5 m: el bicho no cabe en su propio cuerpo",
    );
  });
});

/** CANDADO de las variantes retiradas. La escena "suelta" —grid propio, sin
 *  sitio en el plano continuo— se retiró con el issue #172 y el PLATÓ
 *  proscenio con la vista que lo pintaba: las dos eran Format D perfectamente
 *  válido. El gate tiene que rechazarlas Y decirle al modelo cuál es la forma
 *  viva, porque el pre-flight de narrative-mcp le devuelve ese texto para que
 *  re-responda. */
describe("EmittedSceneSchema — solo queda el tile", () => {
  /** Una suelta impecable: nada malformado, solo la variante retirada. */
  const suelta = {
    scene_id: "aldea_suelta",
    scene_description: "Una aldea sin sitio en el mundo.",
    size: { cols: 4, rows: 2, meters_per_cell: 2 },
    terrain: ["gggg", "gggg"],
    entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1] }],
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
      const r = EmittedSceneSchema.safeParse(escena);
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
    const res = validateContract(EmittedSceneSchema, suelta);
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
describe("EmittedSceneSchema — un rol inventado vuelve al modelo accionable", () => {
  const tileCon = (npc: Record<string, unknown>) => ({
    scene_id: "tile_0_0",
    scene_description: "El pueblo, a media mañana.",
    tile: { tx: 0, ty: 0 },
    biome: "dirt",
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1] },
      { kind: "npc", cell: [60, 60], footprint: [1, 1], ...npc },
    ],
  });

  it("nombra AL NPC por su id, el rol ofensor y los cuatro valores", () => {
    const res = validateContract(
      EmittedSceneSchema,
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

/** #259 — la entity está CERRADA a sus 12 campos, y lo que importa no es el
 *  rechazo sino el mensaje: este gate es el único cuyo error vuelve al modelo,
 *  y `formatError` solo le enseña el PRIMER issue. Antes el campo desconocido
 *  entraba por `.passthrough()` en el zod y se caía por el desagüe en el
 *  saneador Python: el modelo describía algo, nadie lo leía y nadie se lo
 *  decía. */
describe("EmittedSceneSchema — una clave desconocida en una entity vuelve nombrada", () => {
  const tileCon = (npc: Record<string, unknown>) => ({
    scene_id: "tile_0_0",
    scene_description: "El pueblo, a media mañana.",
    tile: { tx: 0, ty: 0 },
    biome: "dirt",
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1] },
      { kind: "npc", cell: [60, 60], footprint: [1, 1], ...npc },
    ],
  });

  it("nombra la entity, la clave que sobra y las 10 que valen", () => {
    const res = validateContract(
      EmittedSceneSchema,
      tileCon({ id: "boris_herrero", name: "Boris el Herrero", health: 60 }),
    );
    assert.equal(res.ok, false, "una clave fuera de las 10 no puede colarse");
    if (res.ok) return;
    assert.match(res.error, /boris_herrero/, res.error);
    assert.match(res.error, /`health`/, res.error);
    for (const campo of ENTITY_FIELDS) assert.match(res.error, new RegExp(campo), res.error);
    // Y dónde SÍ cabe lo que quería contar.
    assert.match(res.error, /`description`/, res.error);
  });

  it("con varias claves las enumera todas; sin `id` no se inventa uno", () => {
    const res = validateContract(
      EmittedSceneSchema,
      tileCon({ id: "beltran", name: "Beltrán", hp: 3, faction: "azules" }),
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /`hp`/, res.error);
    assert.match(res.error, /`faction`/, res.error);

    // Sin `id` el mensaje no puede señalar a nadie, y no se lo inventa: dice
    // "una entity". Se ejerce sobre EntitySchema porque a nivel escena el
    // PRIMER issue pasa a ser el `id: Required`, y `formatError` solo enseña
    // ese — que es igual de accionable.
    const anonima = EntitySchema.safeParse(
      { kind: "npc", name: "?", cell: [1, 1], footprint: [1, 1], hp: 3 },
    );
    assert.equal(anonima.success, false);
    if (anonima.success) return;
    const desconocida = anonima.error.issues.find((i) => i.code === "unrecognized_keys");
    assert.ok(desconocida, JSON.stringify(anonima.error.issues));
    assert.match(desconocida.message, /una entity trae la clave `hp`/, desconocida.message);
  });

  it("las 10 declaradas siguen pasando (el cierre no rechaza de más)", () => {
    assert.equal(
      accepts(tileCon({
        id: "roric", name: "Guardia Roric", role: "guard",
        description: "guardia con lanza y capa parda", style_ref: "warrior",
        shape: "box", h: 1.8,
      })),
      true,
    );
  });

  it("`description` en blanco se rechaza igual que vacía (espejo del `.strip()` de ai_server)", () => {
    assert.notEqual(accepts(tileCon({ id: "a", name: "A", description: "" })), true);
    assert.notEqual(accepts(tileCon({ id: "b", name: "B", description: "   " })), true);
    assert.equal(accepts(tileCon({ id: "c", name: "C", description: "herrero fornido" })), true);
  });
});
