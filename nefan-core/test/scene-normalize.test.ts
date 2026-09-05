import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SOLID_CHARS,
  formatDToWorld,
  KIND_DEFAULT_HEIGHT,
  type NpcEnElWire,
  type WorldScene,
} from "../src/scene/scene-normalize.js";
import { createTerrainCollider } from "../src/scene/terrain-collision.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { npcSkinStyleRef } from "../src/games/style-categories.js";
import {
  combatForHostileRole,
  HOSTILE_HEALTH,
  HOSTILE_WEAPON,
} from "../src/combat/hostiles.js";

/** Atajos de lectura sobre el tipo (#378): ya no hay nada que abrir con `as`. */
const objectsOf = (w: WorldScene) => w.objects;
const npcsOf = (w: WorldScene) => w.npcs;

/** Un tile Format D mínimo y válido, EXPANDIDO como lo haría el bridge
 *  (#405): pradera 128×128 @0,5 m en el tile (0,0) —rect mundial [−32, 32)—
 *  con un edificio, un npc y el spawn del jugador. Celda `[c, r]` con huella
 *  `[w, h]` → centro en x = −32 + (c + w/2)·0,5 ; z = −32 + (r + h/2)·0,5.
 *  Hasta #405 era un grid 10×6 @2 m SIN `tile`, centrado en el origen: la
 *  variante que ya no existe. */
function makeFormatD(): Record<string, unknown> {
  return expandScenePrimitives({
    tile: { tx: 0, ty: 0 },
    scene_id: "taberna_test",
    scene_description: "Una taberna de prueba.",
    biome: "grass",
    entities: [
      { id: "tavern", kind: "building", name: "Taberna", cell: [2, 1], footprint: [4, 2] },
      { id: "barkeep", kind: "npc", name: "Tabernero", cell: [3, 2], footprint: [1, 1] },
      { id: "player", kind: "player", name: "Tú", cell: [5, 5], footprint: [1, 1] },
    ],
  });
}

/** Sustituye la entity `i` del fixture (0 = taberna, 1 = npc, 2 = player). */
const conEntity = (ent: unknown, i = 0): Record<string, unknown> => {
  const d = makeFormatD();
  (d.entities as unknown[])[i] = ent;
  return d;
};

/** El npc del fixture (índice 1) con los campos bajo prueba encima. */
const conNpc = (npc: Record<string, unknown>): Record<string, unknown> =>
  conEntity({ kind: "npc", name: "Aldeana", cell: [1, 1], footprint: [1, 1], ...npc }, 1);

/** El OBJETO del fixture (índice 0, la taberna) sustituido por la entity bajo
 *  prueba: un prop con lo que haga falta encima. */
const conObjeto = (obj: Record<string, unknown>): Record<string, unknown> =>
  conEntity({ kind: "prop", name: "pozo de la plaza", cell: [1, 1], footprint: [1, 1], ...obj }, 0);

/** La ref de skin que derivarían la partida y el batch de estilo. */
const refDelSkin = (npc: NpcEnElWire) => npcSkinStyleRef(npc);

describe("formatDToWorld", () => {
  it("no emite ni `exits` ni el crudo entero (#378): las salidas las pone el wire y `place_id` sustituye a `__format_d`", () => {
    const w = formatDToWorld({ ...makeFormatD(), place_id: "taberna" });
    assert.equal("exits" in w, false, "`exits` es de EscenaServida, no de la world scene");
    assert.equal("__format_d" in w, false, "el Format D ya no viaja dentro de la world scene");
    assert.equal(w.place_id, "taberna", "lo que el cliente leía de __format_d.place_id viaja como miembro");
    assert.equal("place_id" in formatDToWorld(makeFormatD()), false, "sin place estampado no hay clave");
  });

  it("un `place_id` que no es una cadena NO viaja: ni un número ni la cadena vacía estampan la clave", () => {
    // La guarda tiene dos mitades y hasta hoy solo se probaba el caso AUSENTE,
    // donde las dos dan lo mismo. Con `place_id` presente se separan: el 7 lo
    // deja pasar quien se quede sin el `typeof`, y el `""` lo deja pasar quien
    // cambie el `&&` por un `||`. Y esta línea es lo ÚNICO que hay entre un
    // `Record<string, unknown>` que escribe otro proceso y una `WorldScene`
    // cerrada que promete `place_id?: string`: aguas abajo nadie vuelve a
    // mirarlo, todos lo tipan como cadena. Media guarda es una promesa falsa.
    assert.equal("place_id" in formatDToWorld({ ...makeFormatD(), place_id: 7 }), false);
    assert.equal("place_id" in formatDToWorld({ ...makeFormatD(), place_id: "" }), false);
  });

  it("las dimensiones son las del tile (64 m de lado) y el rect mundial el del tile (0,0)", () => {
    const w = formatDToWorld(makeFormatD());
    assert.deepEqual(w.dimensions, { width: 64, depth: 64, height: 3 });
    assert.deepEqual(w.world_rect, { minX: -32, minZ: -32, maxX: 32, maxZ: 32 });
    assert.deepEqual(w.tile, { tx: 0, ty: 0 });
  });

  it("places a building object at its footprint centre in metres", () => {
    const w = formatDToWorld(makeFormatD());
    const objects = objectsOf(w);
    assert.equal(objects.length, 1);
    const tavern = objects[0];
    // cell [2,1] footprint [4,2], mpc 0,5, tile (0,0) → minX = minZ = −32
    // x = −32 + (2 + 4/2)·0,5 = −30 ; z = −32 + (1 + 2/2)·0,5 = −31
    assert.deepEqual(tavern.position, [-30, 0, -31]);
    // Altura default por kind: building 2.5 m (KIND_DEFAULT_HEIGHT); la
    // huella de 4×2 celdas son 2 m × 1 m.
    assert.deepEqual(tavern.scale, [2, 2.5, 1]);
    assert.equal(tavern.category, "building");
    assert.equal(tavern.name, "Taberna");
  });

  it("extracts npcs and the player start", () => {
    const w = formatDToWorld(makeFormatD());
    const npcs = npcsOf(w);
    assert.equal(npcs.length, 1);
    assert.equal(npcs[0].id, "barkeep");
    // barkeep cell [3,2] 1×1: x = −32 + 3,5·0,5 = −30,25 ; z = −32 + 2,5·0,5 = −30,75
    assert.deepEqual(npcs[0].position, [-30.25, 0, -30.75]);
    // player cell [5,5]: x = z = −32 + 5,5·0,5 = −29,25
    assert.deepEqual(w.__player_start, { x: -29.25, z: -29.25 });
  });

  it("maps tree kind to prop category", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "oak", kind: "tree", name: "Roble", cell: [0, 0], footprint: [1, 1] });
    const w = formatDToWorld(d);
    const oak = objectsOf(w).find((o) => o.id === "oak");
    assert.equal(oak?.category, "prop");
    // El default de altura sale del KIND (tree → 4 m), no de la category.
    assert.equal((oak?.scale as number[])[1], 4);
  });

  it("respeta la altura explícita `h` (metros) y recorta valores disparatados", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push(
      { id: "torre", kind: "building", name: "Torre", cell: [7, 0], footprint: [2, 2], h: 6.5 },
      { id: "megalito", kind: "prop", name: "Megalito", cell: [0, 3], footprint: [1, 1], h: 999 },
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
      { id: "caja", kind: "prop", name: "Caja", cell: [0, 3], footprint: [1, 1], h: -2 },
      { id: "gema", kind: "item", name: "Gema", cell: [1, 3], footprint: [1, 1], h: "alta" },
      { id: "cartel", kind: "decor", name: "Cartel", cell: [2, 3], footprint: [1, 1] },
    );
    const w = formatDToWorld(d);
    const objs = objectsOf(w);
    assert.equal((objs.find((o) => o.id === "caja")?.scale as number[])[1], 1);
    assert.equal((objs.find((o) => o.id === "gema")?.scale as number[])[1], 0.5);
    assert.equal((objs.find((o) => o.id === "cartel")?.scale as number[])[1], 0.5);
  });

  it("keeps decor kind as its own walkable category", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "torch", kind: "decor", name: "antorcha de pared", cell: [1, 0], footprint: [1, 1] });
    const w = formatDToWorld(d);
    const torch = objectsOf(w).find((o) => o.id === "torch");
    assert.equal(torch?.category, "decor");
  });

  it("terrain_grid carries the engine's solid chars and nothing char→name", () => {
    // Nadie declara solidez ni nombres por char: el grid viaja solo para la
    // colisión, y lo que bloquea lo fija `DEFAULT_SOLID_CHARS`.
    const w = formatDToWorld(makeFormatD());
    const tg = w.terrain_grid;
    assert.deepEqual(tg.solid_chars, ["w"]);
    assert.deepEqual(
      Object.keys(tg).sort(),
      ["cols", "grid", "meters_per_cell", "origin", "rows", "solid_chars"],
      "el wire del grid es exactamente TerrainGridData",
    );
  });

  it("el agua es el ÚNICO sólido del grid: una \"W\" no bloquea, una \"w\" sí (#407)", () => {
    // `W` fue «muro» sin que ningún productor la escribiera nunca: los muros
    // del juego son volúmenes del plan. Se retira del engine, y el candado es
    // el collider REAL sobre un tile real: la misma celda, con cada char.
    assert.deepEqual(DEFAULT_SOLID_CHARS, ["w"]);
    const conCelda = (ch: string): WorldScene => {
      const tile = expandScenePrimitives({
        tile: { tx: 0, ty: 0 },
        scene_id: "tile_0_0",
        scene_description: "campo",
        biome: "grass",
        entities: [],
      }) as Record<string, unknown>;
      const terrain = tile.terrain as string[];
      terrain[10] = terrain[10].slice(0, 10) + ch + terrain[10].slice(11);
      return formatDToWorld(tile);
    };
    // Celda (10,10) del tile (0,0): mundo (-32 + 10,5·0,5) en los dos ejes.
    const centro = -32 + 10.5 * 0.5;
    const conW = createTerrainCollider(conCelda("W").terrain_grid);
    assert.equal(conW, null, "sin ninguna celda sólida el collider no existe: la W no cuenta");
    const conw = createTerrainCollider(conCelda("w").terrain_grid);
    assert.ok(conw, "el agua sí crea collider");
    assert.equal(conw.isSolidCell(10, 10), true, "y bloquea esa celda");
    assert.equal(conw.blocksCircle(centro, centro, 0.2), true);
  });

  it("una world scene ya normalizada NO vuelve a entrar: lanza (la idempotencia murió con __format_d)", () => {
    // Antes la guarda `__format_d` la dejaba pasar intacta; ahora el tipo
    // impide llamar con una WorldScene y, si llega en runtime (un .mjs), lo
    // dice en vez de devolver media conversión.
    const w = formatDToWorld(makeFormatD());
    assert.throws(() => formatDToWorld(w as unknown as Record<string, unknown>), /no es Format D expandido/);
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
      const obj = formatDToWorld(d).objects[0];
      assert.equal(obj.shape, shape, `la forma "${shape}" debería conservarse`);
    }
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[])[0].shape = "dodecaedro";
    const obj = formatDToWorld(d).objects[0];
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
/** #238. El contrato invita a poner `description` en CUALQUIER entity y hasta
 *  esta tanda el wire la tiraba para todo lo que no fuera NPC: el objeto salía
 *  con `description: ent.name` —la etiqueta disfrazada de descripción— y la
 *  declarada moría en la normalización (el save, Format D, sí la conservaba).
 *  La decisión escrita es «`name` es la etiqueta, `description` es la
 *  PROCEDENCIA»: el texto exacto que se dio al modelo, que viaja verbatim para
 *  poder regenerar el arte con un modelo mejor. Nada se genera hoy de un prop,
 *  así que lo que se afirma es que VIAJA y que no pisa la etiqueta; el lector
 *  es `session/entidades-del-tile.ts` (`leerObjeto`), que lee `name`. */
describe("formatDToWorld — la `description` de un objeto es su procedencia, no su etiqueta (#238)", () => {
  const PROCEDENCIA = "pozo de piedra con brocal musgoso";

  it("con `description` declarada: la etiqueta sigue siendo `name` y la declarada viaja aparte, tal cual", () => {
    const obj = objectsOf(formatDToWorld(conObjeto({ id: "pozo", description: PROCEDENCIA })))[0];
    assert.equal(obj.id, "pozo");
    assert.equal(obj.name, "pozo de la plaza", "la etiqueta es `name`: la procedencia no la pisa");
    assert.equal(obj.description, PROCEDENCIA, "la procedencia viaja verbatim en su propio campo");
  });

  it("sin `description`: `name` presente y NADA inventado (ni la etiqueta copiada como descripción)", () => {
    const obj = objectsOf(formatDToWorld(conObjeto({ id: "pozo" })))[0];
    assert.equal(obj.name, "pozo de la plaza");
    // `in`, no el valor: `description: undefined` también sería inventarse la
    // clave, y el JSON del wire no sería el mismo.
    assert.ok(!("description" in obj), `"description" no debería existir: ${JSON.stringify(obj)}`);
  });

  // Espejo de NO_VIAJAN (NPC): la regla de «texto no vacío o nada» es la misma
  // para los dos, porque ahora la escribe el mismo helper.
  for (const [nombre, basura] of [
    ["cadena vacía", ""],
    ["un número", 42],
    ["un objeto", { es: "raro" }],
  ] as [string, unknown][]) {
    it(`una \`description\` que es ${nombre} no viaja, y la etiqueta no se resiente`, () => {
      const obj = objectsOf(formatDToWorld(conObjeto({ id: "pozo", description: basura })))[0];
      assert.ok(!("description" in obj), `"description" no debería existir: ${JSON.stringify(obj)}`);
      assert.equal(obj.name, "pozo de la plaza");
    });
  }

  it("la etiqueta que se pinta no cambia con la tanda: robledo_tile, objeto a objeto, `name` = `name` de su entity", () => {
    // Determinista y desde el jugador: es la fixture del selector «Room» que
    // el guion 61 mira en pantalla. Hoy ninguna de sus entities lleva
    // `description` (0 de 24), así que ningún objeto debe estrenarla.
    const formatD = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/scenes/robledo_tile.json"), "utf-8"),
    ) as { entities: { id: string; kind: string; name: string; description?: string }[] };
    const porId = new Map(formatD.entities.map((e) => [e.id, e]));
    const objetos = objectsOf(formatDToWorld(formatD));
    assert.ok(objetos.length >= 20, `robledo_tile trae ${objetos.length} objetos — ¿fixture equivocada?`);
    for (const obj of objetos) {
      const ent = porId.get(obj.id as string);
      assert.ok(ent, `objeto ${String(obj.id)} sin entity de origen`);
      assert.equal(obj.name, ent.name, `${ent.id}: la etiqueta es el name de su entity`);
      assert.equal("description" in obj, "description" in ent, `${ent.id}: description solo si la entity la declara`);
    }
    // Y que hoy sea CERO se dice, no se supone: el día que una fixture la
    // estrene, este aserto pide que se mire el guion 61.
    assert.equal(objetos.filter((o) => "description" in o).length, 0, "hoy ninguna entity de robledo_tile lleva description");
  });
});

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
    const objetos = world.objects;
    assert.ok(!objetos.some((o) => o.id === "lobo_1"), "el hostil no puede salir por objects[]");
    assert.ok(objetos.every((o) => !("combat" in o)), "ningún object lleva combat");
  });
});

/** La cola del literal de retorno es el resto del contrato de render: lo leen
 *  el renderer (`terrain.color` como fallback sin textura) y el pipeline de
 *  estilo (`style_ref`, `biome`). Las salidas del panel «Salidas» NO están
 *  aquí: son del mapa y las pone el bridge al servir (`wire-scene.ts`, #179).
 *  Nadie asserteaba nada de ahí. */
describe("formatDToWorld — la cola de la world scene", () => {
  it("el id de la world scene es el scene_id de la escena, sin alias que lo dupliquen", () => {
    const w = formatDToWorld(makeFormatD());
    assert.equal(w.scene_id, "taberna_test");
    assert.equal(Object.values(w).filter((v) => v === "taberna_test").length, 1,
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
    const w = formatDToWorld(conRef);
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

    // Una escena ya EXPANDIDA con un biome corrupto (un save tocado a mano) no
    // vuelve a pasar por resolveBiome, así que la única red es este filtro de tipo.
    const roto = makeFormatD();
    roto.biome = 42;
    assert.equal(formatDToWorld(roto).biome, undefined);
  });

  it("una escena que no declara ningún opcional no emite ninguno", () => {
    // La línea base de los cuatro tests de arriba: sin declaración, nada
    // viaja. Se mira el JSON —lo que recibe el cliente— y no el objeto en
    // memoria: `formatDToWorld` deja la clave con `undefined`, que el wire no
    // lleva; un default inventado (`[]`, `""`) sí llegaría a los clientes.
    const wire: Record<string, unknown> = JSON.parse(JSON.stringify(formatDToWorld(makeFormatD())));
    for (const campo of ["scatter_generators", "style_ref"]) {
      assert.ok(!(campo in wire), `"${campo}" no declarado no debería viajar`);
    }
    // `biome` sí viaja: un tile lo declara siempre (es su base), así que ya no
    // es un «no declarado» — y viaja tal cual, sin normalizar.
    assert.equal(wire.biome, "grass");
    const w = formatDToWorld(makeFormatD());
    // Y sin avisos, `__plan_warnings` es `undefined` y NO una lista vacía. La
    // diferencia no la nota el lector del cliente (`?? []`), pero sí el wire:
    // un `[]` viajaría en CADA tile, y el tipo declara el miembro opcional
    // justamente porque «no tengo nada que decir» se dice no diciéndolo.
    assert.equal(w.__plan_warnings, undefined);
  });
});

/** Contrato de la cabecera del módulo (#378): lo que NO es Format D expandido
 *  LANZA nombrando lo que falta. Hasta esta tanda volvía verbatim, «media
 *  conversión sobre un payload ajeno es peor que ninguna» — pero una
 *  `WorldScene` con miembros no puede ser «lo que entró», y todo lo que llega
 *  aquí en producción pasó por `ExpandedSceneSchema`: un payload sin grid es
 *  un error de quien llama, no una escena que pintar a medias. */
describe("formatDToWorld — lo que no es Format D expandido lanza", () => {
  // Marcadas `__expanded` a propósito: sin la marca la conversión intentaría
  // expandirlas y el error sería el del expander, no el de esta guarda.
  const casos: [string, Record<string, unknown>][] = [
    ["sin size", { __expanded: true, terrain: ["gg", "gg"], entities: [] }],
    ["size sin cols", { __expanded: true, size: { rows: 2, meters_per_cell: 2 }, terrain: ["gg", "gg"], entities: [] }],
    ["size sin rows", { __expanded: true, size: { cols: 2, meters_per_cell: 2 }, terrain: ["gg", "gg"], entities: [] }],
    ["terrain con una fila no-string", { __expanded: true, size: { cols: 2, rows: 2, meters_per_cell: 2 }, terrain: ["gg", 42], entities: [] }],
    ["sin entities", { __expanded: true, size: { cols: 2, rows: 2, meters_per_cell: 2 }, terrain: ["gg", "gg"] }],
  ];
  for (const [nombre, payload] of casos) {
    it(`${nombre} → lanza y nombra las claves que trae`, () => {
      assert.throws(() => formatDToWorld(payload), (err: Error) => {
        assert.match(err.message, /no es Format D expandido/);
        for (const k of Object.keys(payload)) assert.ok(err.message.includes(k), `nombra "${k}": ${err.message}`);
        return true;
      });
    });
  }
});

/** #405: `tile` es obligatorio y el rect mundial sale de él — y SOLO de él.
 *  Hasta esta tanda una escena sin `tile` se «centraba en el origen» (rect
 *  ±cols·mpc/2), y esa rama vivía en cuatro sitios más (colisión, plan,
 *  bridge, cliente). Dos tiles distintos y no uno: con un solo caso no se
 *  distingue «el rect sale del tile» de «el rect es siempre el de (0,0)». */
describe("formatDToWorld — el rect mundial sale del tile, y sin tile no hay escena", () => {
  const tileEn = (tx: number, ty: number) =>
    expandScenePrimitives({ tile: { tx, ty }, scene_id: `tile_${tx}_${ty}`, scene_description: "campo", biome: "grass", entities: [] });

  it("tile (0,0) → rect [−32, 32) y origin (−32, −32)", () => {
    const w = formatDToWorld(tileEn(0, 0));
    assert.deepEqual(w.world_rect, { minX: -32, minZ: -32, maxX: 32, maxZ: 32 });
    assert.deepEqual(w.terrain_grid.origin, [-32, -32]);
  });

  it("tile (1,0) → rect [32, 96) × [−32, 32): la regla, no su contraria", () => {
    const w = formatDToWorld(tileEn(1, 0));
    assert.deepEqual(w.world_rect, { minX: 32, minZ: -32, maxX: 96, maxZ: 32 });
    assert.deepEqual(w.terrain_grid.origin, [32, -32]);
    assert.deepEqual(w.tile, { tx: 1, ty: 0 });
  });

  it("tile (−2, 3) → rect [−160, −96) × [160, 224): los dos ejes y los dos signos", () => {
    const w = formatDToWorld(tileEn(-2, 3));
    assert.deepEqual(w.world_rect, { minX: -160, minZ: 160, maxX: -96, maxZ: 224 });
    assert.deepEqual(w.terrain_grid.origin, [-160, 160]);
  });

  it("expandida sin `tile` → lanza nombrando `tile` (ya no hay escena centrada en el origen)", () => {
    const { tile: _t, ...sinTile } = makeFormatD();
    assert.throws(() => formatDToWorld(sinTile), /`tile`/);
  });

  it("cruda sin `tile` → lanza nombrando `tile` (no hay «escena suelta» que expandir)", () => {
    assert.throws(
      () => formatDToWorld({ scene_id: "suelta", scene_description: "campo", biome: "grass", entities: [] }),
      /`tile`/,
    );
  });

  it("`tile` con coords no enteras → lanza diciendo qué llegó", () => {
    assert.throws(() => formatDToWorld({ ...makeFormatD(), tile: { tx: 0.5, ty: 0 } }), /enteros.*0\.5/);
  });
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
    (d.entities as Record<string, unknown>[]).push({ id: "barril", kind: "prop", name: "Barril", cell: [0, 3], footprint: [1, 1], h });
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
    (d.entities as Record<string, unknown>[]).push({ id: "oak", kind: "tree", name: "Roble", cell: [0, 0], footprint: [1, 1] });
    const oak = objectsOf(formatDToWorld(d)).find((o) => o.id === "oak");
    assert.equal(oak?.shape, "cylinder");
    // Un prop sin shape NO recibe forma: el cliente cae a su caja por defecto.
    const barril = objectsOf(formatDToWorld(conProp(1))).find((o) => o.id === "barril");
    assert.ok(!("shape" in barril!), `un prop sin shape no debería llevar la clave: ${JSON.stringify(barril)}`);
  });
});
