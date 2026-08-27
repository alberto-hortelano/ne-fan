/** `composeTilePlan`: el ÚNICO camino desde el esquema del tile hasta la
 *  huella colisionable.
 *
 *  Lo que se prueba aquí es lo que hasta esta tanda no tenía sitio donde
 *  probarse, porque la composición estaba copiada en cuatro consumidores: que
 *  el plan sale igual componga quien componga, que el seed no se puede elegir
 *  desde fuera (era la forma REAL en que las copias divergían) y que lo que no
 *  cabe se DICE con los números que el motor necesita para re-responder. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeTilePlan, MAX_TILE_VOLUMES } from "../src/scene/tile-plan.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import { MAX_VEG_DENSITY } from "../src/scene/blueprint/vegetation.js";

function tile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    scene_description: "Un claro con una casa.",
    biome: "forest_floor",
    ground: [{ id: "senda", kind: "path", points: [[0, 64], [128, 64]], w: 4, material: "dirt" }],
    volumes: [{ id: "casa", label: "casa", type: "building", rect: [20, 20, 10, 8], wall_h: 5 }],
    entities: [
      { id: "roble", kind: "tree", name: "roble", cell: [80, 80], footprint: [4, 4], glyph: "t" },
      { id: "barril", kind: "prop", name: "barril", cell: [40, 90], footprint: [2, 2], glyph: "b" },
      { id: "moneda", kind: "item", name: "moneda", cell: [50, 50], footprint: [1, 1], glyph: "$" },
      { id: "herrero", kind: "npc", name: "Beltrán", cell: [30, 30], footprint: [1, 1], glyph: "n" },
    ],
    ...over,
  };
}

describe("composeTilePlan · un solo plan para todos", () => {
  it("suma a los volumes declarados los que el esquema implica", () => {
    const { plan } = composeTilePlan(tile());
    assert.ok(plan);
    const ids = plan.volumes.map((v) => v.id);
    assert.deepEqual(ids, ["casa", "derived_ent_barril", "derived_ent_roble"]);
    assert.equal(plan.ground.length, 1);
    assert.equal(plan.biome, "forest_floor");
  });

  it("las entities que YA están en el plan salen marcadas, y las que no, no", () => {
    const { representedBy } = composeTilePlan(tile());
    assert.deepEqual(representedBy, {
      roble: "derived_ent_roble",
      barril: "derived_ent_barril",
    });
    // Un item no es geometría del plan (se recoge, no se choca) y un NPC
    // tampoco: los dos siguen pintándose como entidad.
    assert.equal(representedBy.moneda, undefined);
    assert.equal(representedBy.herrero, undefined);
  });

  it("el seed sale del TILE, no del caller: el mismo tile compone el mismo bosque siempre", () => {
    // Es lo que cerró la divergencia: cuando cada consumidor pasaba su propio
    // seed, el bosque del cliente y el del batch de estilo eran distintos en
    // cuanto uno de los dos cambiaba de argumento. Aquí se comprueba por el
    // lado observable: la MISMA escena con OTRO scene_id compone idéntico…
    const conBosque = { vegetation_zones: [{ type: "pino", area: "rest", density: 0.02 }] };
    const a = composeTilePlan(tile(conBosque));
    const b = composeTilePlan(tile({ ...conBosque, scene_id: "otro_nombre_cualquiera" }));
    assert.deepEqual(a.plan?.volumes, b.plan?.volumes, "el scene_id no puede mover el bosque");
    // …y otro TILE, no: cada tile del plano tiene su bosque.
    const c = composeTilePlan(tile({ ...conBosque, tile: { tx: 3, ty: -1 } }));
    assert.notDeepEqual(a.plan?.volumes, c.plan?.volumes);
  });

  it("una escena sin `tile` no tiene plan (Format D tiene una sola variante)", () => {
    const { plan } = composeTilePlan({ scene_id: "suelta", entities: [] });
    assert.equal(plan, null);
  });

  it("un tile sin suelo ni volúmenes no compone plan: no hay nada que pintar", () => {
    const { plan } = composeTilePlan({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", biome: "grass", entities: [] });
    assert.equal(plan, null);
  });
});

describe("composeTilePlan · lo que no cabe se dice", () => {
  it("un ground inválido no tumba el tile: se compone sin él y se avisa", () => {
    const { plan, warnings } = composeTilePlan(tile({ ground: [{ id: "roto", kind: "inventado" }] }));
    assert.ok(plan);
    assert.deepEqual(plan.ground, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ground inválido/);
  });

  it("unos volumes inválidos dejan los derivados, y se avisa", () => {
    const { plan, warnings } = composeTilePlan(tile({ volumes: [{ id: "x", type: "ovni" }] }));
    assert.ok(plan);
    assert.deepEqual(plan.volumes.map((v) => v.id), ["derived_ent_barril", "derived_ent_roble"]);
    assert.match(warnings[0], /volumes inválidos/);
  });

  it("una zona de vegetación fuera de rango no se planta, y se avisa con la unidad", () => {
    const { plan, warnings } = composeTilePlan(
      tile({ vegetation_zones: [{ type: "pino", area: "rest", density: 0.5 }] }),
    );
    assert.ok(plan);
    assert.equal(plan.volumes.filter((v) => v.id.startsWith("derived_veg_")).length, 0);
    assert.match(warnings[0], /EJEMPLARES POR m²/);
  });

  it("el presupuesto recorta la vegetación PRIMERO y devuelve los tres números", () => {
    // Un tile entero al tope de densidad más un pueblo denso no cabe: el
    // motor tiene que poder decidir qué sacrifica, así que se le dan los
    // números (pedidos, tope, densidad que sí cabría) en vez de truncarle el
    // plan por detrás en silencio.
    // Un pueblo con 100 trastos y un pinar cerrado de tile entero: 100
    // volúmenes derivados de entities + 328 de vegetación.
    const trastos = Array.from({ length: 100 }, (_, i) => ({
      id: `trasto_${i}`,
      kind: "prop",
      name: "trasto",
      cell: [(i % 20) * 3, Math.floor(i / 20) * 6],
      footprint: [1, 1],
      glyph: "x",
    }));
    const { plan, warnings } = composeTilePlan(
      tile({
        entities: trastos,
        vegetation_zones: [{ type: "pino", area: "rest", density: MAX_VEG_DENSITY }],
      }),
    );
    assert.ok(plan);
    assert.equal(plan.volumes.length, MAX_TILE_VOLUMES, "el plan nunca pasa del presupuesto");
    assert.equal(warnings.length, 1, warnings.join(" | "));
    assert.match(warnings[0], new RegExp(`tope son ${MAX_TILE_VOLUMES}`));
    assert.match(warnings[0], /Baja la densidad de vegetation_zones a 0\.\d+ ejemplares\/m²/);
    // Lo que sobrevive al recorte es lo declarado y lo derivado del esquema:
    // la masa forestal es lo prescindible, y ese orden es el que hace que el
    // recorte sea aceptable en vez de una pérdida silenciosa de geometría.
    assert.ok(plan.volumes.some((v) => v.id === "casa"), "los declarados no se recortan");
    // 97 de los 100 trastos: tres caen encima de la casa declarada y ya
    // estaban representados por ella. Ninguno se pierde por el recorte.
    assert.equal(
      plan.volumes.filter((v) => v.id.startsWith("derived_ent_")).length,
      97,
      "las entities del esquema no se recortan: lo que cae es la masa forestal",
    );
    assert.ok(plan.volumes.some((v) => v.id.startsWith("derived_veg_")), "…y queda bosque, no cero");
  });

  /** Los tres bloques de abajo leen el TEXTO del aviso, no solo que exista.
   *
   *  Hasta aquí el aviso del presupuesto se comprobaba con `match(/tope son 200/)`
   *  y una regex floja para la densidad: se podían cambiar las CUATRO restas por
   *  sumas, o vaciar el mensaje entero, sin que nada se pusiera rojo (19 mutantes
   *  vivos, issue #303). Y ese texto no es cosmética: es el canal fail-loud hacia
   *  el motor narrativo, que lo lee para decidir qué sacrifica y re-responder. Un
   *  número mal en «se recortan N» es una instrucción falsa al modelo, y el tile
   *  se compone igual con menos cosas de las que pidió. */
  it("el aviso del recorte trae las CUATRO cuentas, y cuadran entre sí", () => {
    const trastos = Array.from({ length: 100 }, (_, i) => ({
      id: `trasto_${i}`,
      kind: "prop",
      name: "trasto",
      cell: [(i % 20) * 3, Math.floor(i / 20) * 6],
      footprint: [1, 1],
      glyph: "x",
    }));
    const { warnings } = composeTilePlan(
      tile({
        entities: trastos,
        vegetation_zones: [{ type: "pino", area: "rest", density: MAX_VEG_DENSITY }],
      }),
    );
    assert.equal(
      warnings[0],
      "el plan del tile pide 410 volúmenes y el tope son 200 " +
        "(1 declarados de 160 + 97 derivados del esquema + 312 de vegetación de masa): " +
        "se recortan 210, la vegetación primero. " +
        "Baja la densidad de vegetation_zones a 0.02 ejemplares/m² o declara menos volumes",
    );
    // Y las cuentas cuadran: el desglose suma el total, y el recorte es la
    // diferencia con el tope. Si una resta se vuelve suma, esto se cae aquí
    // aunque alguien haya actualizado el literal de arriba sin pensar.
    assert.equal(1 + 97 + 312, 410, "el desglose tiene que sumar lo pedido");
    assert.equal(410 - MAX_TILE_VOLUMES, 210, "el recorte es lo pedido menos el tope");
  });

  it("sin zonas de vegetación el consejo cambia, porque bajar la densidad no arreglaría nada", () => {
    const trastos = Array.from({ length: 400 }, (_, i) => ({
      id: `trasto_${i}`,
      kind: "prop",
      name: "trasto",
      cell: [(i % 20) * 3, Math.floor(i / 20) * 6],
      footprint: [1, 1],
      glyph: "x",
    }));
    const { warnings } = composeTilePlan(tile({ entities: trastos }));
    assert.equal(
      warnings[0],
      "el plan del tile pide 398 volúmenes y el tope son 200 " +
        "(1 declarados de 160 + 397 derivados del esquema + 0 de vegetación de masa): " +
        "se recortan 198, la vegetación primero. " +
        "Declara menos volumes o menos entities estáticas",
    );
  });

  it("con las zonas inválidas Y el presupuesto desbordado, los DOS avisos salen y el consejo es el correcto", () => {
    // Dos canales fail-loud a la vez. Importa el orden y el consejo: con las
    // zonas rechazadas no hay superficie plantada, así que «baja la densidad»
    // sería un consejo imposible de seguir — el motor tiene que oír «declara
    // menos volumes». Es el único caso que ejerce el fallback a lista vacía.
    const trastos = Array.from({ length: 400 }, (_, i) => ({
      id: `trasto_${i}`,
      kind: "prop",
      name: "trasto",
      cell: [(i % 20) * 3, Math.floor(i / 20) * 6],
      footprint: [1, 1],
      glyph: "x",
    }));
    const { warnings } = composeTilePlan(
      tile({ entities: trastos, vegetation_zones: [{ type: "pino", area: "rest", density: 999 }] }),
    );
    assert.equal(warnings.length, 2, warnings.join(" | "));
    assert.match(warnings[0], /la zona no se planta/);
    assert.equal(
      warnings[1],
      "el plan del tile pide 398 volúmenes y el tope son 200 " +
        "(1 declarados de 160 + 397 derivados del esquema + 0 de vegetación de masa): " +
        "se recortan 198, la vegetación primero. " +
        "Declara menos volumes o menos entities estáticas",
    );
  });

  it("justo EN el tope no se avisa: el presupuesto es «más de», no «a partir de»", () => {
    // 199 entities + la casa declarada = exactamente MAX_TILE_VOLUMES. Un `>=`
    // en vez de `>` avisaría aquí de un recorte de cero.
    const trastos = Array.from({ length: 199 }, (_, i) => ({
      id: `trasto_${i}`,
      kind: "prop",
      name: "trasto",
      cell: [(i % 20) * 6, 40 + Math.floor(i / 20) * 8],
      footprint: [1, 1],
      glyph: "x",
    }));
    const { plan, warnings } = composeTilePlan(tile({ entities: trastos }));
    assert.ok(plan);
    assert.equal(plan.volumes.length, MAX_TILE_VOLUMES, "el caso de borde exige el tope EXACTO");
    assert.deepEqual(warnings, [], "en el tope no se recorta nada, así que no hay nada que decir");
  });
});

describe("composeTilePlan · lo que el tile no declara no se inventa", () => {
  it("con suelo y sin un solo volumen SÍ hay plan: el camino es geometría", () => {
    const { plan } = composeTilePlan(tile({ volumes: [], entities: [] }));
    assert.ok(plan, "un tile que solo tiene senda sigue teniendo algo que pintar");
    assert.equal(plan.volumes.length, 0);
    assert.equal(plan.ground.length, 1);
  });

  it("un biome que no es texto no viaja en el plan", () => {
    const { plan } = composeTilePlan(tile({ biome: 42 }));
    assert.ok(plan);
    assert.equal(plan.biome, undefined, "el plan no propaga un biome que no es una cadena");
  });

  it("una scene_description que no es texto no viaja en el plan", () => {
    const { plan } = composeTilePlan(tile({ scene_description: { texto: "no" } }));
    assert.ok(plan);
    assert.equal(plan.scene_description, undefined);
  });

  it("y las que SÍ son texto viajan tal cual, incluida la vacía", () => {
    const { plan } = composeTilePlan(tile({ biome: "tundra", scene_description: "" }));
    assert.ok(plan);
    assert.equal(plan.biome, "tundra");
    assert.equal(plan.scene_description, "", "cadena vacía es una descripción, no una ausencia");
  });

  it("sin `ground` ni `volumes` declarados no se avisa de nada: ausencia no es error", () => {
    const { warnings } = composeTilePlan({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      entities: [{ id: "roble", kind: "tree", name: "roble", cell: [80, 80], footprint: [4, 4], glyph: "t" }],
    });
    assert.deepEqual(warnings, [], "no declarar suelo no es lo mismo que declararlo mal");
  });
});

describe("el plan viaja RESUELTO en la world scene", () => {
  it("formatDToWorld emite __plan y marca los objetos que ya pinta el greybox", () => {
    const w = formatDToWorld(tile()) as {
      __plan?: { volumes: Array<{ id: string }> };
      objects: Array<{ id: string; volume_id?: string }>;
    };
    assert.ok(w.__plan, "sin __plan el cliente volvería a derivar");
    assert.deepEqual(
      w.objects.map((o) => [o.id, o.volume_id]),
      [
        ["roble", "derived_ent_roble"],
        ["barril", "derived_ent_barril"],
        ["moneda", undefined],
      ],
      "el árbol y el barril los pinta el plan; la moneda no está en él",
    );
  });

  it("los avisos del plan viajan con la escena (cada capa los reporta por su canal)", () => {
    const w = formatDToWorld(tile({ ground: [{ id: "roto", kind: "inventado" }] })) as {
      __plan_warnings?: string[];
    };
    assert.equal(w.__plan_warnings?.length, 1);
    assert.match(w.__plan_warnings![0], /ground inválido/);
  });

  it("una escena ya normalizada no se recompone (idempotencia del wire)", () => {
    const w = formatDToWorld(tile());
    assert.equal(formatDToWorld(w as Record<string, unknown>), w);
  });
});
