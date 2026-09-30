import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SOLID_CHARS,
  FOOTPRINT_POR_DEFECTO,
  formatDToWorld,
  huellaEnMetros,
  KIND_DEFAULT_HEIGHT,
  type NpcEnElWire,
  type WorldScene,
} from "../src/scene/scene-normalize.js";
import { createTerrainCollider } from "../src/scene/terrain-collision.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { escenaCargable } from "../src/scene/escena-cargable.js";
import { npcSkinStyleRef } from "../src/games/style-categories.js";
import {
  combatForHostileRole,
  HOSTILE_HEALTH,
  HOSTILE_WEAPON,
} from "../src/combat/hostiles.js";

/** La world scene de un payload a mano, por la MISMA puerta que una fixture
 *  (#782): `formatDToWorld` solo acepta `ExpandedScene`, y lo que lo es lo
 *  dice el zod, no el test. Un payload que el contrato rechaza lanza aquí, en
 *  la puerta, y no llega a la conversión — lo que la conversión validaba a
 *  mano hasta #782 lo defienden hoy `escena-cargable.test.ts`,
 *  `scene-schema.test.ts` y las fixtures de contrato. */
const aMundo = (d: unknown): WorldScene => formatDToWorld(escenaCargable(d));

/** Atajos de lectura sobre el tipo (#378): ya no hay nada que abrir con `as`. */
const objectsOf = (w: WorldScene) => w.objects;
const npcsOf = (w: WorldScene) => w.npcs;

/** Un tile Format D mínimo y válido, EXPANDIDO (#405; lo que la puerta
 *  deja pasar): pradera 128×128 @0,5 m en el tile (0,0) —rect mundial [−32, 32)—
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
    const w = aMundo({ ...makeFormatD(), place_id: "taberna" });
    assert.equal("exits" in w, false, "`exits` es de EscenaServida, no de la world scene");
    assert.equal("__format_d" in w, false, "el Format D ya no viaja dentro de la world scene");
    assert.equal(w.place_id, "taberna", "lo que el cliente leía de __format_d.place_id viaja como miembro");
    assert.equal("place_id" in aMundo(makeFormatD()), false, "sin place estampado no hay clave");
  });

  it("las dimensiones son las del tile (64 m de lado) y el rect mundial el del tile (0,0)", () => {
    const w = aMundo(makeFormatD());
    assert.deepEqual(w.dimensions, { width: 64, depth: 64, height: 3 });
    assert.deepEqual(w.world_rect, { minX: -32, minZ: -32, maxX: 32, maxZ: 32 });
    assert.deepEqual(w.tile, { tx: 0, ty: 0 });
  });

  it("places a building object at its footprint centre in metres", () => {
    const w = aMundo(makeFormatD());
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
    const w = aMundo(makeFormatD());
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
    const w = aMundo(d);
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
    const w = aMundo(d);
    const objs = objectsOf(w);
    assert.equal((objs.find((o) => o.id === "torre")?.scale as number[])[1], 6.5);
    // Techo duro de 20 m (MAX_ENTITY_HEIGHT_M).
    assert.equal((objs.find((o) => o.id === "megalito")?.scale as number[])[1], 20);
  });

  it("keeps decor kind as its own walkable category", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "torch", kind: "decor", name: "antorcha de pared", cell: [1, 0], footprint: [1, 1] });
    const w = aMundo(d);
    const torch = objectsOf(w).find((o) => o.id === "torch");
    assert.equal(torch?.category, "decor");
  });

  it("terrain_grid carries the engine's solid chars and nothing char→name", () => {
    // Nadie declara solidez ni nombres por char: el grid viaja solo para la
    // colisión, y lo que bloquea lo fija `DEFAULT_SOLID_CHARS`.
    const w = aMundo(makeFormatD());
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
    // El char se pone en el grid que SALE de la conversión y no en la escena:
    // desde #782 una `W` en `terrain` no pasa la puerta (el alfabeto del grid,
    // #464), así que lo que aquí se mide es el collider, que es lo que decide.
    const conCelda = (ch: string): WorldScene => {
      const w = aMundo({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", scene_description: "campo", biome: "grass", entities: [] });
      const grid = [...w.terrain_grid.grid];
      grid[10] = grid[10].slice(0, 10) + ch + grid[10].slice(11);
      return { ...w, terrain_grid: { ...w.terrain_grid, grid } };
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

  // --- Huecos que destapó el mutation testing (npm run mutate) ---
  // Los tres de abajo son mutantes que SOBREVIVÍAN: el código pasaba por esas
  // líneas (97% de cobertura) pero ningún assert se habría enterado de que
  // cambiaban.

  it("acepta cada forma del catálogo", () => {
    // La inventada ya no llega aquí: la rechaza la puerta (#782). Hasta
    // entonces se descartaba en silencio y caía a caja.
    for (const shape of ["box", "cylinder", "sphere", "cone"]) {
      const d = makeFormatD();
      (d.entities as Record<string, unknown>[])[0].shape = shape;
      const obj = aMundo(d).objects[0];
      assert.equal(obj.shape, shape, `la forma "${shape}" debería conservarse`);
    }
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
      aMundo(
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
    const npc = npcsOf(aMundo(conNpc({ id: "guardia_2", role: "guard" })))[0];
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
    // Los valores que no son cadena y las cadenas vacías ya no llegan aquí
    // (#782): el zod los rechaza en la puerta (`role`/`style_ref` son
    // `min(1)` y `description` no admite vacío ni blanco).
  ];
  for (const [nombre, declarado] of NO_VIAJAN) {
    it(`${nombre}: no viaja ninguno de los tres, y el skin cae al default`, () => {
      const npc = npcsOf(aMundo(conNpc(declarado)))[0];
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
    const obj = objectsOf(aMundo(conObjeto({ id: "pozo", description: PROCEDENCIA })))[0];
    assert.equal(obj.id, "pozo");
    assert.equal(obj.name, "pozo de la plaza", "la etiqueta es `name`: la procedencia no la pisa");
    assert.equal(obj.description, PROCEDENCIA, "la procedencia viaja verbatim en su propio campo");
  });

  it("sin `description`: `name` presente y NADA inventado (ni la etiqueta copiada como descripción)", () => {
    const obj = objectsOf(aMundo(conObjeto({ id: "pozo" })))[0];
    assert.equal(obj.name, "pozo de la plaza");
    // `in`, no el valor: `description: undefined` también sería inventarse la
    // clave, y el JSON del wire no sería el mismo.
    assert.ok(!("description" in obj), `"description" no debería existir: ${JSON.stringify(obj)}`);
  });

  it("la etiqueta que se pinta no cambia con la tanda: robledo_tile, objeto a objeto, `name` = `name` de su entity", () => {
    // Determinista y desde el jugador: es la fixture del selector «Room» que
    // el guion 61 mira en pantalla. Hoy ninguna de sus entities lleva
    // `description` (0 de 24), así que ningún objeto debe estrenarla.
    const formatD = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/scenes/robledo_tile.json"), "utf-8"),
    ) as { entities: { id: string; kind: string; name: string; description?: string }[] };
    const porId = new Map(formatD.entities.map((e) => [e.id, e]));
    const objetos = objectsOf(aMundo(formatD));
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
      aMundo(
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
      const npc = npcsOf(aMundo(conNpc({ id: `pacifico_${role}`, ...(role ? { role } : {}) })))[0];
      assert.ok(
        !("combat" in npc),
        `un ${role ?? "npc sin rol"} salió con combat: el cliente lo daría de alta como combatiente`,
      );
    }
  });

  it("el hostil va a npcs[], no a objects[] (la rama de objects era el fósil)", () => {
    const world = aMundo(conNpc({ id: "lobo_1", role: "hostile", name: "Lobo flaco" }));
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
    const w = aMundo(makeFormatD());
    assert.equal(w.scene_id, "taberna_test");
    assert.equal(Object.values(w).filter((v) => v === "taberna_test").length, 1,
      "un solo campo lleva el id: dos nombres para el mismo valor es lo que se retiró");
  });

  it("la descripción viaja tal cual", () => {
    // Sin ella ya no hay escena (#782): `scene_description` es obligatoria en
    // el zod, y la puerta la rechaza antes de pintar.
    assert.equal(aMundo(makeFormatD()).scene_description, "Una taberna de prueba.");
  });

  it("emite un color de terreno usable como fallback sin textura", () => {
    // Fallback de suelo por defecto (el del cliente se fue con el renderer
    // oblicuo; su vista 3D pinta el suelo desde el `ground` declarado). Lo que
    // importa es que exista y sea un RGB 0..1 verdoso (suelo de campo), no el
    // valor.
    const color = (aMundo(makeFormatD()).terrain as { color?: number[] } | undefined)?.color;
    assert.ok(Array.isArray(color), "terrain.color debe existir");
    assert.equal(color!.length, 3, "RGB de tres componentes");
    assert.ok(color!.every((c) => typeof c === "number" && c >= 0 && c <= 1), `fuera de 0..1: ${color}`);
    assert.ok(color![1] > color![0] && color![1] > color![2], `el suelo por defecto es verdoso: ${color}`);
  });

  it("scatter_generators viaja tal cual lo declaró el motor", () => {
    // La basura (una cadena, un save tocado) ya no llega aquí: la rechaza el
    // gate de escena con `parseScatter` (#782).
    const conScatter = makeFormatD();
    conScatter.scatter_generators = { hierba: { density: 0.4 } };
    assert.deepEqual(aMundo(conScatter).scatter_generators, { hierba: { density: 0.4 } });
  });

  it("el biome viaja tal cual", () => {
    const tile = aMundo({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      scene_description: "campo",
      biome: "forest_floor",
      entities: [],
    });
    assert.equal(tile.biome, "forest_floor");
    // Un biome corrupto en una escena ya expandida (un save tocado a mano) lo
    // rechaza el gate desde #782; antes lo filtraba aquí un `typeof`.
  });

  it("una escena que no declara ningún opcional no emite ninguno", () => {
    // La línea base de los cuatro tests de arriba: sin declaración, nada
    // viaja. Se mira el JSON —lo que recibe el cliente— y no el objeto en
    // memoria: `formatDToWorld` deja la clave con `undefined`, que el wire no
    // lleva; un default inventado (`[]`, `""`) sí llegaría a los clientes.
    const wire: Record<string, unknown> = JSON.parse(JSON.stringify(aMundo(makeFormatD())));
    for (const campo of ["scatter_generators", "style_ref"]) {
      assert.ok(!(campo in wire), `"${campo}" no declarado no debería viajar`);
    }
    // `biome` sí viaja: un tile lo declara siempre (es su base), así que ya no
    // es un «no declarado» — y viaja tal cual, sin normalizar.
    assert.equal(wire.biome, "grass");
    const w = aMundo(makeFormatD());
    // Y sin avisos, `__plan_warnings` es `undefined` y NO una lista vacía. La
    // diferencia no la nota el lector del cliente (`?? []`), pero sí el wire:
    // un `[]` viajaría en CADA tile, y el tipo declara el miembro opcional
    // justamente porque «no tengo nada que decir» se dice no diciéndolo.
    assert.equal(w.__plan_warnings, undefined);
  });
});

/** #405: `tile` es obligatorio y el rect mundial sale de él — y SOLO de él.
 *  Hasta esta tanda una escena sin `tile` se «centraba en el origen» (rect
 *  ±cols·mpc/2), y esa rama vivía en cuatro sitios más (colisión, plan,
 *  bridge, cliente). Dos tiles distintos y no uno: con un solo caso no se
 *  distingue «el rect sale del tile» de «el rect es siempre el de (0,0)». */
describe("formatDToWorld — el rect mundial sale del tile", () => {
  const tileEn = (tx: number, ty: number) =>
    expandScenePrimitives({ tile: { tx, ty }, scene_id: `tile_${tx}_${ty}`, scene_description: "campo", biome: "grass", entities: [] });

  it("tile (0,0) → rect [−32, 32) y origin (−32, −32)", () => {
    const w = aMundo(tileEn(0, 0));
    assert.deepEqual(w.world_rect, { minX: -32, minZ: -32, maxX: 32, maxZ: 32 });
    assert.deepEqual(w.terrain_grid.origin, [-32, -32]);
  });

  it("tile (1,0) → rect [32, 96) × [−32, 32): la regla, no su contraria", () => {
    const w = aMundo(tileEn(1, 0));
    assert.deepEqual(w.world_rect, { minX: 32, minZ: -32, maxX: 96, maxZ: 32 });
    assert.deepEqual(w.terrain_grid.origin, [32, -32]);
    assert.deepEqual(w.tile, { tx: 1, ty: 0 });
  });

  it("tile (−2, 3) → rect [−160, −96) × [160, 224): los dos ejes y los dos signos", () => {
    const w = aMundo(tileEn(-2, 3));
    assert.deepEqual(w.world_rect, { minX: -160, minZ: 160, maxX: -96, maxZ: 224 });
    assert.deepEqual(w.terrain_grid.origin, [-160, 160]);
  });
});

/** Altura y forma: el `scale.y` que el cliente 3D (fps-gl en el navegador)
 *  construye tal cual. Un `h` degenerado (0, NaN, negativo) lo rechaza la
 *  puerta desde #782 (antes caía aquí al default por kind, en silencio);
 *  lo que queda es la forma por defecto del árbol. */
describe("formatDToWorld — la forma por defecto", () => {
  const conProp = (h: unknown): Record<string, unknown> => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "barril", kind: "prop", name: "Barril", cell: [0, 3], footprint: [1, 1], h });
    return d;
  };
  it("un árbol sin shape declarada sale redondo (cylinder), no caja", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "oak", kind: "tree", name: "Roble", cell: [0, 0], footprint: [1, 1] });
    const oak = objectsOf(aMundo(d)).find((o) => o.id === "oak");
    assert.equal(oak?.shape, "cylinder");
    // Un prop sin shape NO recibe forma: el cliente cae a su caja por defecto.
    const barril = objectsOf(aMundo(conProp(1))).find((o) => o.id === "barril");
    assert.ok(!("shape" in barril!), `un prop sin shape no debería llevar la clave: ${JSON.stringify(barril)}`);
  });
});

/** LA HUELLA COLISIONABLE, UNA SOLA (#489, PR 5 de #241).
 *
 *  Lo que pide el issue en una frase: un `object` que pone el motor a mitad de
 *  partida y un `prop` de 3×3 celdas declarado por la escena tienen que medir lo
 *  MISMO, porque los dos pasan por aquí. Hasta el 2026-09-07 el spawn ni pasaba:
 *  el cliente le escribía 1,4 m a mano. */
describe("huellaEnMetros — la misma aritmética para el tile y para el spawn", () => {
  it("con footprint declarado son celdas × meters_per_cell, y NADA más", () => {
    assert.deepEqual(huellaEnMetros("prop", [4, 2]), { x: 2, z: 1 });
    // Rectangular y asimétrica: x sale de w y z de h, no al revés.
    assert.deepEqual(huellaEnMetros("building", [8, 2]), { x: 4, z: 1 });
    // El mpc entra por parámetro: una escena con otro grid escala igual.
    assert.deepEqual(huellaEnMetros("prop", [4, 2], 2), { x: 8, z: 4 });
  });

  it("sin footprint aplica el defecto POR KIND del spawn de runtime", () => {
    // 8×8 celdas a 0,5 m = los 4×4 m de siempre; 3×3 = 1,5 m (antes 1,4 escritos
    // a mano en el cliente, que no eran múltiplo de ninguna celda).
    assert.deepEqual(huellaEnMetros("building"), { x: 4, z: 4 });
    assert.deepEqual(huellaEnMetros("object"), { x: 1.5, z: 1.5 });
    assert.deepEqual(FOOTPRINT_POR_DEFECTO.building, [8, 8]);
    assert.deepEqual(FOOTPRINT_POR_DEFECTO.object, [3, 3]);
    // `item` entra con #532: una celda, los mismos 0,5 m que su altura por
    // defecto. Es el tamaño de lo que se suelta en el suelo, y tenerlo es lo
    // que impide que un spawn de item tumbe el turno por fail-loud.
    assert.deepEqual(huellaEnMetros("item"), { x: 0.5, z: 0.5 });
    assert.deepEqual(FOOTPRINT_POR_DEFECTO.item, [1, 1]);
    assert.equal(KIND_DEFAULT_HEIGHT.item, 0.5);
  });

  it("un footprint declarado GANA al defecto del kind", () => {
    assert.deepEqual(huellaEnMetros("building", [2, 2]), { x: 1, z: 1 });
  });

  it("un kind sin defecto y sin footprint es fail-loud: nadie inventa un tamaño", () => {
    // `npc` no tiene huella a propósito: colisiona por radio, no por caja.
    assert.throws(() => huellaEnMetros("npc"), /npc.*no declara footprint/s);
    assert.throws(() => huellaEnMetros("dragon"), /building \| object/);
  });

  it("un `object` spawneado mide lo mismo que un prop de 3×3 celdas de la escena", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({
      id: "cofre_escena", kind: "prop", name: "Cofre", cell: [10, 10], footprint: [3, 3],
    });
    const cofre = objectsOf(aMundo(d)).find((o) => o.id === "cofre_escena")!;
    const spawneado = huellaEnMetros("object");
    assert.equal(cofre.scale[0], spawneado.x);
    assert.equal(cofre.scale[2], spawneado.z);
  });
});
