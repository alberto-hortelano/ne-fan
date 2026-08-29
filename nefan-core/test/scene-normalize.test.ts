import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatDToWorld, KIND_DEFAULT_HEIGHT } from "../src/scene/scene-normalize.js";
import { npcSkinStyleRef } from "../src/games/style-categories.js";
import {
  combatForHostileRole,
  HOSTILE_HEALTH,
  HOSTILE_WEAPON,
} from "../src/combat/hostiles.js";

/** Atajos de lectura: la world scene es un Record suelto por contrato. */
const objectsOf = (w: Record<string, unknown>) => w.objects as Record<string, unknown>[];
const npcsOf = (w: Record<string, unknown>) => w.npcs as Record<string, unknown>[];

/** A minimal but valid Map Format D scene: 10×6 grid (meters_per_cell 2 ⇒
 *  20m × 12m), one building, one npc, one player start. */
function makeFormatD(): Record<string, unknown> {
  return {
    scene_id: "taberna_test",
    scene_description: "Una taberna de prueba.",
    size: { cols: 10, rows: 6, meters_per_cell: 2 },
    terrain: [
      "gggggggggg",
      "gggggggggg",
      "gggggggggg",
      "gggggggggg",
      "gggggggggg",
      "gggggggggg",
    ],
    entities: [
      { id: "tavern", kind: "building", name: "Taberna", cell: [2, 1], footprint: [4, 2], glyph: "H" },
      { id: "barkeep", kind: "npc", name: "Tabernero", cell: [3, 2], footprint: [1, 1], glyph: "n" },
      { id: "player", kind: "player", name: "Tú", cell: [5, 5], footprint: [1, 1], glyph: "@" },
    ],
    ambient_event: "El fuego crepita.",
  };
}

/** Sustituye la entity `i` del fixture (0 = taberna, 1 = npc, 2 = player). */
const conEntity = (ent: unknown, i = 0): Record<string, unknown> => {
  const d = makeFormatD();
  (d.entities as unknown[])[i] = ent;
  return d;
};

/** El npc del fixture (índice 1) con los campos bajo prueba encima. */
const conNpc = (npc: Record<string, unknown>): Record<string, unknown> =>
  conEntity({ kind: "npc", name: "Aldeana", cell: [1, 1], footprint: [1, 1], glyph: "n", ...npc }, 1);

/** La ref de skin que derivarían la partida y el batch de estilo. */
const refDelSkin = (npc: Record<string, unknown>) =>
  npcSkinStyleRef(npc as { style_ref?: string; role?: string });

describe("formatDToWorld", () => {
  it("es idempotente: una world scene ya normalizada pasa intacta", () => {
    const w = formatDToWorld(makeFormatD());
    assert.equal(formatDToWorld(w), w, "misma referencia, sin re-normalizar");
  });

  it("es idempotente también para tiles (conservan `tile` pero no `biome`)", () => {
    const w = formatDToWorld({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      biome: "grass",
      scene_description: "campo",
      entities: [],
      ambient_event: "",
    });
    assert.ok(Array.isArray(w.objects), "primera pasada normaliza");
    // Sin la guarda __format_d, esta segunda pasada re-entraría en la
    // expansión de tile (tile presente, biome ya consumido) y lanzaría.
    assert.equal(formatDToWorld(w), w);
  });

  it("converts size to centred world dimensions", () => {
    const w = formatDToWorld(makeFormatD());
    assert.deepEqual(w.dimensions, { width: 20, depth: 12, height: 3 });
  });

  it("places a building object at its footprint centre in metres", () => {
    const w = formatDToWorld(makeFormatD());
    const objects = objectsOf(w);
    assert.equal(objects.length, 1);
    const tavern = objects[0];
    // cell [2,1] footprint [4,2], mpc 2, halfW 10, halfD 6
    // x = (2 + 4/2)*2 - 10 = -2 ; z = (1 + 2/2)*2 - 6 = -2
    assert.deepEqual(tavern.position, [-2, 0, -2]);
    // Altura default por kind: building 2.5 m (KIND_DEFAULT_HEIGHT).
    assert.deepEqual(tavern.scale, [8, 2.5, 4]);
    assert.equal(tavern.category, "building");
    assert.equal(tavern.description, "Taberna");
  });

  it("extracts npcs and the player start", () => {
    const w = formatDToWorld(makeFormatD());
    const npcs = npcsOf(w);
    assert.equal(npcs.length, 1);
    assert.equal(npcs[0].id, "barkeep");
    // player cell [5,5]: x = (5+0.5)*2 - 10 = 1 ; z = (5+0.5)*2 - 6 = 5
    assert.deepEqual(w.__player_start, { x: 1, z: 5 });
  });

  it("maps tree kind to prop category", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "oak", kind: "tree", name: "Roble", cell: [0, 0], footprint: [1, 1], glyph: "T" });
    const w = formatDToWorld(d);
    const oak = objectsOf(w).find((o) => o.id === "oak");
    assert.equal(oak?.category, "prop");
    // El default de altura sale del KIND (tree → 4 m), no de la category.
    assert.equal((oak?.scale as number[])[1], 4);
  });

  it("respeta la altura explícita `h` (metros) y recorta valores disparatados", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push(
      { id: "torre", kind: "building", name: "Torre", cell: [7, 0], footprint: [2, 2], glyph: "t", h: 6.5 },
      { id: "megalito", kind: "prop", name: "Megalito", cell: [0, 3], footprint: [1, 1], glyph: "M", h: 999 },
    );
    const w = formatDToWorld(d);
    const objs = objectsOf(w);
    assert.equal((objs.find((o) => o.id === "torre")?.scale as number[])[1], 6.5);
    // Techo duro de 20 m (MAX_ENTITY_HEIGHT_M).
    assert.equal((objs.find((o) => o.id === "megalito")?.scale as number[])[1], 20);
  });

  it("un `h` inválido cae al default por kind (tolerante, como shape)", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push(
      { id: "caja", kind: "prop", name: "Caja", cell: [0, 3], footprint: [1, 1], glyph: "c", h: -2 },
      { id: "gema", kind: "item", name: "Gema", cell: [1, 3], footprint: [1, 1], glyph: "g", h: "alta" },
      { id: "cartel", kind: "decor", name: "Cartel", cell: [2, 3], footprint: [1, 1], glyph: "i" },
    );
    const w = formatDToWorld(d);
    const objs = objectsOf(w);
    assert.equal((objs.find((o) => o.id === "caja")?.scale as number[])[1], 1);
    assert.equal((objs.find((o) => o.id === "gema")?.scale as number[])[1], 0.5);
    assert.equal((objs.find((o) => o.id === "cartel")?.scale as number[])[1], 0.5);
  });

  it("keeps decor kind as its own walkable category", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "torch", kind: "decor", name: "antorcha de pared", cell: [1, 0], footprint: [1, 1], glyph: "i" });
    const w = formatDToWorld(d);
    const torch = objectsOf(w).find((o) => o.id === "torch");
    assert.equal(torch?.category, "decor");
  });

  it("normalizes an object-form legend to plain names and emits solid_chars", () => {
    const d = makeFormatD();
    d.terrain_legend = { W: { name: "muro de piedra", solid: true }, o: "tablones" };
    const w = formatDToWorld(d);
    const tg = w.terrain_grid as { legend: Record<string, string>; solid_chars: string[] };
    assert.equal(tg.legend.W, "muro de piedra");
    assert.equal(tg.legend.o, "tablones");
    assert.deepEqual(tg.solid_chars, ["W", "w"]);
  });

  it("returns a non-Format-D payload unchanged", () => {
    const legacy = { scene_id: "crypt", dimensions: { width: 10, height: 4, depth: 8 }, surfaces: {}, objects: [] };
    assert.equal(formatDToWorld(legacy), legacy);
  });

  it("throws fail-loud on a malformed entity (missing cell)", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[])[0] = { id: "broken", kind: "building", name: "X", footprint: [1, 1] };
    assert.throws(() => formatDToWorld(d), /missing cell/);
  });

  // --- Huecos que destapó el mutation testing (npm run mutate) ---
  // Los tres de abajo son mutantes que SOBREVIVÍAN: el código pasaba por esas
  // líneas (97% de cobertura) pero ningún assert se habría enterado de que
  // cambiaban.

  it("acepta cada forma del catálogo y descarta la inventada", () => {
    for (const shape of ["box", "cylinder", "sphere", "cone"]) {
      const d = makeFormatD();
      (d.entities as Record<string, unknown>[])[0].shape = shape;
      const obj = (formatDToWorld(d) as { objects: Record<string, unknown>[] }).objects[0];
      assert.equal(obj.shape, shape, `la forma "${shape}" debería conservarse`);
    }
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[])[0].shape = "dodecaedro";
    const obj = (formatDToWorld(d) as { objects: Record<string, unknown>[] }).objects[0];
    assert.equal(obj.shape, undefined, "una forma fuera del catálogo NO se propaga al renderer");
  });

  it("el bioma del tile solo viaja si es una cadena", () => {
    // Un tile NO lleva size/terrain: su base es `biome` + primitivas.
    const tile = (biome: unknown): Record<string, unknown> => ({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      biome,
      scene_description: "campo",
      entities: [],
      ambient_event: "",
    });
    const bueno = formatDToWorld(tile("grass")) as { terrain?: { color?: number[] } };
    assert.ok(bueno.terrain, "un biome válido produce terreno");

    // Un biome no-cadena se descarta: la expansión se queda sin base y falla
    // fuerte en vez de pintar un tile mudo.
    assert.throws(() => formatDToWorld(tile(42)), /biome/i);
  });

  it("throws on an invalid kind", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[])[0] = { id: "x", kind: "dragon", name: "X", cell: [0, 0], footprint: [1, 1] };
    assert.throws(() => formatDToWorld(d), /invalid kind/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Los bloques siguientes cierran los huecos que destapó `npm run mutate`: código
// por el que los tests pasaban (97% de líneas) sin enterarse de que cambiaba.
// Cada uno nombra al consumidor cuyo comportamiento defiende.
// ─────────────────────────────────────────────────────────────────────────────

/** Un NPC del motor lleva tres campos que el cliente NO puede reconstruir:
 *  `role` (rol de mundo), `style_ref` (ref de personaje elegida por el motor)
 *  y `description` (prompt del skin). De ellos salen los DOS componentes de la
 *  clave de caché del skin, y la derivan por igual la partida
 *  (nefan-html/src/main.ts:1414) y el batch de "aplicar estilo"
 *  (nefan-html/src/ui/style-apply.ts:236) vía `npcSkinStyleRef`
 *  (src/games/style-categories.ts). Si un campo no viaja, o viaja donde no
 *  debía, las dos claves divergen y el skin se GENERA (y se paga) dos veces. */
describe("formatDToWorld — el NPC llega entero a la clave de caché del skin", () => {
  it("propaga role, style_ref y description tal cual los declaró el motor", () => {
    const npc = npcsOf(
      formatDToWorld(
        conNpc({ id: "guardia_1", role: "guard", style_ref: "characters_capitana", description: "guardia con yelmo abollado" }),
      ),
    )[0];
    assert.equal(npc.role, "guard");
    assert.equal(npc.style_ref, "characters_capitana");
    assert.equal(npc.description, "guardia con yelmo abollado");
    // La ref del skin es la que ELIGIÓ el motor, no el default por rol.
    assert.equal(refDelSkin(npc), "characters_capitana");
  });

  it("sin style_ref la ref del skin cae al default por rol, y el rol sí viaja", () => {
    const npc = npcsOf(formatDToWorld(conNpc({ id: "guardia_2", role: "guard" })))[0];
    assert.equal(npc.role, "guard");
    assert.ok(!("style_ref" in npc), "sin elección del motor no se inventa style_ref");
    assert.equal(refDelSkin(npc), "warrior");
  });

  // Clave presente con undefined ≠ clave ausente: `npc.description ?? name` en
  // main.ts:1411 devuelve el nombre solo si la clave NO está, y el JSON del
  // wire tampoco es el mismo. De ahí que se compruebe `in`, no el valor.
  const NO_VIAJAN: [string, Record<string, unknown>][] = [
    // Un npc que el motor declaró pelado.
    ["ninguna clave declarada", { id: "aldeana_1" }],
    // `styleRoleForNpc` hace `(role ?? "").toLowerCase()`: un role numérico
    // propagado revienta al pintar. Y un style_ref numérico sería truthy
    // dentro de npcSkinStyleRef, así que viajaría al servidor de skins.
    ["valores que no son cadena", { id: "raro", role: 42, style_ref: 7, description: { es: "raro" } }],
    // Si "" viajara como style_ref, npcSkinStyleRef seguiría cayendo al rol,
    // pero el prompt del skin (description ?? name) pasaría a ser "" y el
    // batch pediría una imagen sin descripción.
    ["cadenas vacías", { id: "aldeana_2", role: "", style_ref: "", description: "" }],
  ];
  for (const [nombre, declarado] of NO_VIAJAN) {
    it(`${nombre}: no viaja ninguno de los tres, y el skin cae al default`, () => {
      const npc = npcsOf(formatDToWorld(conNpc(declarado)))[0];
      for (const campo of ["role", "style_ref", "description"]) {
        assert.ok(!(campo in npc), `"${campo}" no debería existir: ${JSON.stringify(npc)}`);
      }
      assert.equal(refDelSkin(npc), "commoner");
      assert.equal(npc.name, "Aldeana", "el name sí viaja: es el prompt del skin sin description");
    });
  }
});

/** VÍA (a) al combate: la escena inicial. El motor declara `role:"hostile"` y
 *  el core deriva el bloque `combat` aquí — es lo único que hace que el
 *  cliente registre un combatiente (`add_combatants` → `sim.addCombatant`) y,
 *  con él, que `getEnemyStates` emita algo. Sin este bloque el NPC hostil
 *  llegaba como cualquier aldeano y el jugador no tenía contra quién pelear,
 *  que es el estado en el que llevaba el juego desde que existe. */
describe("formatDToWorld — un NPC hostil llega con su combate derivado", () => {
  it("`role:\"hostile\"` sale con el bloque combat que el cliente exige", () => {
    const npc = npcsOf(
      formatDToWorld(
        conNpc({ id: "bandido_1", role: "hostile", description: "bandido de camino con cota remendada" }),
      ),
    )[0];
    const combat = npc.combat as Record<string, unknown> | undefined;
    assert.ok(combat, "un hostil sin `combat` es un aldeano: no hay a quién pegar");
    assert.equal(combat.health, HOSTILE_HEALTH);
    assert.equal(combat.weapon_id, HOSTILE_WEAPON);
    // El bloque es EXACTAMENTE el del core: una copia con otros números aquí
    // haría que la escena inicial y el spawn en runtime dieran peleas
    // distintas con el mismo enemigo.
    assert.deepEqual(combat, combatForHostileRole("hostile"));
    // Y el hostil sigue siendo un NPC a todos los demás efectos: viaja su rol
    // y su descripción, de donde salen conducta y skin.
    assert.equal(npc.role, "hostile");
    assert.equal(npc.description, "bandido de camino con cota remendada");
    assert.equal(refDelSkin(npc), "warrior");
  });

  it("un NPC que NO es hostil no lleva combat ni con la clave presente", () => {
    for (const role of [undefined, "villager", "guard", "merchant", "peasant"]) {
      const npc = npcsOf(formatDToWorld(conNpc({ id: `pacifico_${role}`, ...(role ? { role } : {}) })))[0];
      assert.ok(
        !("combat" in npc),
        `un ${role ?? "npc sin rol"} salió con combat: el cliente lo daría de alta como combatiente`,
      );
    }
  });

  it("el hostil va a npcs[], no a objects[] (la rama de objects era el fósil)", () => {
    const world = formatDToWorld(conNpc({ id: "lobo_1", role: "hostile", name: "Lobo flaco" }));
    const objetos = (world.objects ?? []) as Record<string, unknown>[];
    assert.ok(!objetos.some((o) => o.id === "lobo_1"), "el hostil no puede salir por objects[]");
    assert.ok(objetos.every((o) => !("combat" in o)), "ningún object lleva combat");
  });
});

/** La cola del literal de retorno es el resto del contrato de render: lo leen
 *  el bridge al difundir (bridge/context.ts:239), el TravelPanel (`exits`), el
 *  renderer 2D (`terrain.color` como fallback sin textura) y el pipeline de
 *  estilo (`style_ref`, `biome`). Nadie asserteaba nada de ahí. */
describe("formatDToWorld — la cola de la world scene", () => {
  it("el id de la world scene es el scene_id de la escena, sin alias que lo dupliquen", () => {
    const w = formatDToWorld(makeFormatD());
    assert.equal(w.scene_id, "taberna_test");
    assert.equal(Object.keys(w).filter((k) => w[k] === "taberna_test").length, 1,
      "un solo campo lleva el id: dos nombres para el mismo valor es lo que se retiró");
  });

  it("la descripción viaja tal cual y, sin ella, es cadena VACÍA", () => {
    assert.equal(formatDToWorld(makeFormatD()).scene_description, "Una taberna de prueba.");

    // Sin descripción, cadena VACÍA: el HUD la pinta tal cual, y un texto de
    // relleno sería peor que nada.
    const muda = makeFormatD();
    delete muda.scene_description;
    assert.equal(formatDToWorld(muda).scene_description, "");
  });

  it("emite un color de terreno usable como fallback sin textura", () => {
    // Fallback de suelo por defecto (el del cliente se fue con el renderer
    // oblicuo; su vista 3D pinta el suelo desde el `ground` declarado). Lo que
    // importa es que exista y sea un RGB 0..1 verdoso (suelo de campo), no el
    // valor.
    const color = (formatDToWorld(makeFormatD()).terrain as { color?: number[] } | undefined)?.color;
    assert.ok(Array.isArray(color), "terrain.color debe existir");
    assert.equal(color!.length, 3, "RGB de tres componentes");
    assert.ok(color!.every((c) => typeof c === "number" && c >= 0 && c <= 1), `fuera de 0..1: ${color}`);
    assert.ok(color![1] > color![0] && color![1] > color![2], `el suelo por defecto es verdoso: ${color}`);
  });

  it("scatter_generators solo viaja si es un objeto; basura declarada se descarta", () => {
    const conScatter = makeFormatD();
    conScatter.scatter_generators = { hierba: { density: 0.4 } };
    assert.deepEqual(formatDToWorld(conScatter).scatter_generators, { hierba: { density: 0.4 } });

    // Un valor truthy que NO es objeto (save viejo, error del motor) se
    // descarta: parseScatter aguas abajo espera un mapa, no una cadena.
    const basura = makeFormatD();
    basura.scatter_generators = "hierba";
    assert.equal(formatDToWorld(basura).scatter_generators, undefined);
  });

  // La `style_ref` de ESCENA se retiró (guiaba el repintado del tile, que
  // murió con la vista oblicua): normalizar no la propaga. La de ENTIDAD
  // (npc) sigue viva y tiene sus propios casos más abajo.
  it("la style_ref de escena no llega a la world scene (campo retirado)", () => {
    const conRef = makeFormatD();
    conRef.style_ref = "settlement";
    const w = formatDToWorld(conRef) as Record<string, unknown>;
    assert.ok(!("style_ref" in w), "no se propaga la elección de escena");
  });

  it("el biome viaja solo si es una cadena", () => {
    const tile = formatDToWorld({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      scene_description: "campo",
      biome: "forest_floor",
      entities: [],
    });
    assert.equal(tile.biome, "forest_floor");

    // Escena legacy (no tile) con un biome corrupto: no llega a resolveBiome,
    // así que la única red es este filtro de tipo.
    const roto = makeFormatD();
    roto.biome = 42;
    assert.equal(formatDToWorld(roto).biome, undefined);
  });

  it("una escena que no declara ningún opcional no emite ninguno", () => {
    // La línea base de los cuatro tests de arriba: sin declaración, la clave
    // no existe. Un default inventado aquí viajaría a los dos clientes.
    const w = formatDToWorld(makeFormatD());
    for (const campo of ["scatter_generators", "style_ref", "biome"]) {
      assert.equal(w[campo], undefined, `"${campo}" no declarado no debería emitirse`);
    }
  });
});

/** Contrato de la cabecera del módulo: "A payload that is NOT Format D is
 *  returned verbatim". Importa porque `formatDToWorld` se aplica a TODO lo que
 *  sale por el wire (bridge/context.ts:239 y el resume de :291), incluidas
 *  world scenes ya resueltas y payloads de `change_scene`: media conversión
 *  sobre un payload ajeno es peor que ninguna. */
describe("formatDToWorld — lo que no es Format D pasa verbatim", () => {
  const casos: [string, Record<string, unknown>][] = [
    ["sin size", { terrain: ["gg", "gg"], entities: [] }],
    ["size sin cols", { size: { rows: 2, meters_per_cell: 2 }, terrain: ["gg", "gg"], entities: [] }],
    ["size sin rows", { size: { cols: 2, meters_per_cell: 2 }, terrain: ["gg", "gg"], entities: [] }],
    ["terrain con una fila no-string", { size: { cols: 2, rows: 2, meters_per_cell: 2 }, terrain: ["gg", 42], entities: [] }],
    ["sin entities", { size: { cols: 2, rows: 2, meters_per_cell: 2 }, terrain: ["gg", "gg"] }],
  ];
  for (const [nombre, payload] of casos) {
    it(`${nombre} → misma referencia, sin tocar`, () => {
      assert.equal(formatDToWorld(payload), payload);
    });
  }
});

/** Fail-loud: una entity malformada tumba la escena con un mensaje que dice
 *  QUÉ entity y QUÉ campo. El motor narrativo re-responde leyendo ese texto
 *  (pre-flight de narrative-mcp) y el bridge lo difunde como
 *  `narrative_status: error`: un mensaje vacío o genérico deja al modelo sin
 *  saber qué corregir, y a un TypeError posterior sin contexto. */
describe("formatDToWorld — fail-loud con índice, id y campo", () => {
  /** La entity 0 del fixture, sustituida por una mesa con lo que se le pase. */
  const mesa = (extra: Record<string, unknown>) => conEntity({ id: "mesa", kind: "prop", ...extra });

  it("una entity nula se nombra por su índice", () => {
    assert.throws(() => formatDToWorld(conEntity(null, 1)), /scene entities\[1\] is null\/undefined/);
  });

  it("sin id, el mensaje lo dice antes de mirar nada más", () => {
    assert.throws(
      () => formatDToWorld(conEntity({ kind: "building", name: "X", cell: [0, 0], footprint: [1, 1] })),
      /scene entities\[0\] missing id/,
    );
  });

  it("un kind inválido enumera los válidos (el motor los copia de ahí)", () => {
    assert.throws(
      () => formatDToWorld(conEntity({ id: "wyrm", kind: "dragon", name: "X", cell: [0, 0], footprint: [1, 1] })),
      (err: Error) => {
        assert.match(err.message, /wyrm.*invalid kind="dragon"/);
        for (const kind of ["player", "npc", "building", "prop", "tree", "item", "decor"]) {
          assert.ok(err.message.includes(kind), `el mensaje debería listar "${kind}": ${err.message}`);
        }
        return true;
      },
    );
  });

  it("cell ausente o de un solo número → missing cell, no un TypeError después", () => {
    const re = /scene entities\[0\] \(mesa\) missing cell \[col,row\]/;
    assert.throws(() => formatDToWorld(mesa({ name: "Mesa", footprint: [1, 1] })), re);
    assert.throws(() => formatDToWorld(mesa({ name: "Mesa", cell: [3], footprint: [1, 1] })), re);
  });

  it("footprint ausente o de un solo número → missing footprint", () => {
    const re = /scene entities\[0\] \(mesa\) missing footprint \[w,h\]/;
    assert.throws(() => formatDToWorld(mesa({ name: "Mesa", cell: [1, 1] })), re);
    assert.throws(() => formatDToWorld(mesa({ name: "Mesa", cell: [1, 1], footprint: [2] })), re);
  });

  it("una sola coordenada no finita basta, y el mensaje enseña las cuatro", () => {
    assert.throws(
      () => formatDToWorld(mesa({ name: "Mesa", cell: [1, NaN], footprint: [1, 1] })),
      /\(mesa\) cell\/footprint must be finite numbers, got cell=\[1,NaN\] fp=\[1,1\]/,
    );
    assert.throws(
      () => formatDToWorld(mesa({ name: "Mesa", cell: [1, 1], footprint: ["a", 1] })),
      /must be finite numbers, got cell=\[1,1\] fp=\[a,1\]/,
    );
  });

  it("un npc sin name se distingue de un objeto sin name", () => {
    assert.throws(
      () => formatDToWorld(conEntity({ id: "tabernero", kind: "npc", cell: [1, 1], footprint: [1, 1] })),
      /scene entities\[0\] \(npc tabernero\) missing name/,
    );
    assert.throws(
      () => formatDToWorld(mesa({ cell: [1, 1], footprint: [1, 1] })),
      /scene entities\[0\] \(mesa\) missing name/,
    );
  });
});

/** Altura y forma: el `scale.y` que el cliente 3D (fps-gl en el navegador)
 *  construye tal cual. Un `h` degenerado (0, ∞) produciría una caja invisible
 *  o de 20 m en vez de caer al default por kind. (Hasta la retirada de la
 *  vista oblicua lo extruía además el 2D como prisma, con `prismQuads`; ese
 *  camino ya no existe.) */
describe("formatDToWorld — altura y forma degeneradas", () => {
  const conProp = (h: unknown): Record<string, unknown> => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "barril", kind: "prop", name: "Barril", cell: [0, 3], footprint: [1, 1], glyph: "b", h });
    return d;
  };
  const alturaDelBarril = (h: unknown): number =>
    (objectsOf(formatDToWorld(conProp(h))).find((o) => o.id === "barril")!.scale as number[])[1];

  it("h = 0 no produce una caja de altura cero: cae al default por kind", () => {
    assert.equal(alturaDelBarril(0), KIND_DEFAULT_HEIGHT.prop);
  });

  it("h infinito (JSON.parse de 1e999 en un save) cae al default, no al techo", () => {
    assert.equal(alturaDelBarril(Infinity), KIND_DEFAULT_HEIGHT.prop);
    assert.equal(alturaDelBarril(NaN), KIND_DEFAULT_HEIGHT.prop);
  });

  it("un árbol sin shape declarada sale redondo (cylinder), no caja", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "oak", kind: "tree", name: "Roble", cell: [0, 0], footprint: [1, 1], glyph: "T" });
    const oak = objectsOf(formatDToWorld(d)).find((o) => o.id === "oak");
    assert.equal(oak?.shape, "cylinder");
    // Un prop sin shape NO recibe forma: el cliente cae a su caja por defecto.
    const barril = objectsOf(formatDToWorld(conProp(1))).find((o) => o.id === "barril");
    assert.ok(!("shape" in barril!), `un prop sin shape no debería llevar la clave: ${JSON.stringify(barril)}`);
  });
});
