/** El candado de #379: al re-emitir un tile hay UNA política, no dos.
 *
 *  Los tests que importan son los que enfrentan las tres clases al MISMO
 *  escenario. Hasta hoy un NPC ya presente se conservaba y un objeto ya
 *  presente se recreaba entero, y las dos ramas vivían a treinta líneas la una
 *  de la otra dentro de `addTile`; aquí, si alguien vuelve a partirlas, el
 *  aserto que compara los dos repartos se pone rojo.
 *
 *  Los dos casos del criterio de verificación del plan tienen nombre propio
 *  abajo: un objeto que CAMBIA SU DESCRIPCIÓN (se conserva la entity y se
 *  re-aplica lo declarado, o el tile miente sobre lo que hay dentro) y un NPC
 *  que SE MOVIÓ (se conserva y NO se le re-aplica la celda de spawn, o vuelve
 *  teletransportado). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  esDeEsteTile,
  npcsDeclarados as leerNpcs,
  objetosDeclarados as leerObjetos,
  repartoDelTile,
  type EnElMundo,
  type NpcDeclarado,
  type ObjetoDeclarado,
} from "../src/session/entidades-del-tile.js";

/** Los lectores CONFÍAN en el tipo del wire (#378, QA H1): un `ObjetoEnElWire`
 *  trae siempre `name`, `category` y `scale`, y un `NpcEnElWire` su `name`.
 *  Cada test escribe solo lo que mide; el resto lo completa esto, para que la
 *  forma que entra sea la que el tipo promete — lo ROTO (sin id, posición que
 *  no son tres números, duplicados) se escribe roto a propósito y sigue roto. */
type Suelto = Record<string, unknown>;
const objetosDeclarados = (raw: readonly Suelto[] | undefined) =>
  leerObjetos(raw?.map((o) => ({ name: String(o.id), category: "prop", scale: [1, 1, 1], ...o })) as never);
const npcsDeclarados = (raw: readonly Suelto[] | undefined) =>
  leerNpcs(raw?.map((o) => ({ name: String(o.id), ...o })) as never);

const TILE = "tile_0_0";
const VECINO = "tile_1_0";

function delTile(id: string, key = TILE): EnElMundo {
  return { id, dueno: { de: "tile", key } };
}

function deRuntime(id: string): EnElMundo {
  return { id, dueno: { de: "runtime" } };
}

/** Un objeto declarado mínimo, con lo que haga falta encima. */
function objeto(id: string, extra: Partial<ObjetoDeclarado> = {}): ObjetoDeclarado {
  return { id, pos: { x: 0, y: 0, z: 0 }, nombre: id, categoria: "prop", ...extra };
}

describe("esDeEsteTile", () => {
  it("solo lo del MISMO tile: ni el del vecino ni lo de runtime", () => {
    assert.equal(esDeEsteTile({ de: "tile", key: TILE }, TILE), true);
    assert.equal(esDeEsteTile({ de: "tile", key: VECINO }, TILE), false);
    assert.equal(esDeEsteTile({ de: "runtime" }, TILE), false);
  });
});

describe("repartoDelTile · la política única", () => {
  it("lo declarado que YA ESTÁ se conserva, con lo que el tile declara AHORA", () => {
    const antes = [delTile("cofre")];
    const ahora = [objeto("cofre", { nombre: "un cofre forzado" })];
    const reparto = repartoDelTile(antes, ahora, TILE);
    assert.deepEqual(reparto.conservar, [{ id: "cofre", declarado: ahora[0] }]);
    assert.deepEqual(reparto.crear, []);
    assert.deepEqual(reparto.retirar, []);
  });

  it("lo declarado que NO está se crea", () => {
    const reparto = repartoDelTile([], [objeto("forja")], TILE);
    assert.deepEqual(reparto.crear.map((o) => o.id), ["forja"]);
    assert.deepEqual(reparto.conservar, []);
  });

  it("lo de ESTE tile que ya no se declara se retira", () => {
    const reparto = repartoDelTile([delTile("barril")], [], TILE);
    assert.deepEqual(reparto.retirar, ["barril"]);
    assert.deepEqual(reparto.crear, []);
    assert.deepEqual(reparto.conservar, []);
  });

  it("lo de OTRO dueño no se retira nunca: la purga es por identidad, no por sitio (#350)", () => {
    // El cofre que puso el motor a mitad de partida y el vecino que paseó
    // hasta aquí: ninguno de los dos es de este tile, así que re-emitirlo no
    // se los puede llevar por delante.
    const reparto = repartoDelTile([deRuntime("cofre_narrativo"), delTile("aldeano", VECINO)], [], TILE);
    assert.deepEqual(reparto.retirar, []);
  });

  it("el tile RECLAMA lo que declara aunque fuera de otro dueño: se conserva, no se duplica", () => {
    // Un id que el motor materializó en runtime y que el tile declara después.
    // Sale por `conservar` (una sola entity, la que ya hay) y NO por `crear`:
    // es el duplicado que el filtro `!ids.has(o.id)` tapaba.
    const declarado = objeto("forja");
    const reparto = repartoDelTile([deRuntime("forja")], [declarado], TILE);
    assert.deepEqual(reparto.conservar, [{ id: "forja", declarado }]);
    assert.deepEqual(reparto.crear, []);
    assert.deepEqual(reparto.retirar, []);
  });

  it("UNA sola política: objetos y personajes reparten igual ante el mismo escenario", () => {
    // El test que impide que #379 vuelva. Mismo mundo, mismas declaraciones,
    // una clase leída como objeto y la otra como npc: el reparto tiene que
    // salir idéntico. Si alguien vuelve a recrear una de las dos, esto es rojo.
    const antes = [delTile("mismo"), delTile("se_va"), deRuntime("de_runtime")];
    const objetos = objetosDeclarados([
      { id: "mismo", position: [1, 0, 2] },
      { id: "nuevo", position: [3, 0, 4] },
    ]).declaradas;
    const npcs = npcsDeclarados([
      { id: "mismo", position: [1, 0, 2] },
      { id: "nuevo", position: [3, 0, 4] },
    ]).declaradas;
    const comoObjetos = repartoDelTile(antes, objetos, TILE);
    const comoNpcs = repartoDelTile(antes, npcs, TILE);
    const forma = (r: { conservar: { id: string }[]; crear: { id: string }[]; retirar: string[] }) => ({
      conservar: r.conservar.map((c) => c.id),
      crear: r.crear.map((c) => c.id),
      retirar: r.retirar,
    });
    assert.deepEqual(forma(comoObjetos), forma(comoNpcs));
    assert.deepEqual(forma(comoObjetos), {
      conservar: ["mismo"],
      crear: ["nuevo"],
      retirar: ["se_va"],
    });
  });

  it("los personajes se buscan en UNA lista: un enemigo declarado en npcs[] no se duplica", () => {
    // `presentes` es la unión de NPCs y enemigos a propósito: un id declarado
    // en `npcs[]` pudo entrar al mundo como enemigo (`combat` presente), y
    // buscarlo solo entre los pacíficos lo crearía por segunda vez.
    const enemigo = delTile("bandido_1");
    const declarado = npcsDeclarados([{ id: "bandido_1", position: [5, 0, 5], combat: { health: 12 } }]).declaradas;
    const reparto = repartoDelTile([enemigo], declarado, TILE);
    assert.deepEqual(reparto.crear, []);
    assert.equal(reparto.conservar.length, 1);
  });

  it("el orden de `crear` es el DECLARADO por el tile", () => {
    // No es cosmético: el cliente numera los colores de los enemigos por orden
    // de creación, así que reordenar aquí repinta el HUD sin que nadie lo pida.
    const reparto = repartoDelTile([], [objeto("a"), objeto("b"), objeto("c")], TILE);
    assert.deepEqual(reparto.crear.map((o) => o.id), ["a", "b", "c"]);
  });
});

describe("objetosDeclarados", () => {
  it("lee la world scene entera: posición, nombre, categoría, huella, alto, forma y volumen", () => {
    const { declaradas, errores } = objetosDeclarados([
      {
        id: "taberna",
        position: [-2, 0, -2],
        scale: [8, 3, 4],
        category: "building",
        shape: "cylinder",
        name: "Taberna del Ciervo",
        volume_id: "vol_3",
      },
    ]);
    assert.deepEqual(errores, []);
    assert.deepEqual(declaradas, [
      {
        id: "taberna",
        pos: { x: -2, y: 0, z: -2 },
        nombre: "Taberna del Ciervo",
        categoria: "building",
        sizeXZ: { x: 8, z: 4 },
        sizeY: 3,
        shape: "cylinder",
        volumeId: "vol_3",
      },
    ]);
  });

  it("la `description` de la world scene NO es la etiqueta: se lee `name` y la procedencia no se propaga (#238)", () => {
    // Antes del cambio el wire traía `description: ent.name` y este lector la
    // tomaba como prosa a pintar. Ahora `description` es el texto que se dio al
    // modelo (procedencia); el cliente, que solo pinta, no tiene nada que hacer
    // con él, así que no se le ofrece un campo que ni lee.
    const { declaradas } = objetosDeclarados([
      { id: "pozo", position: [0, 0, 0], name: "pozo de la plaza", description: "pozo de piedra con brocal musgoso" },
    ]);
    assert.equal(declaradas[0].nombre, "pozo de la plaza");
    assert.ok(!("descripcion" in declaradas[0]) && !("description" in declaradas[0]), JSON.stringify(declaradas[0]));
  });

  it("sin objetos declarados no hay ni entidades ni ruido", () => {
    assert.deepEqual(objetosDeclarados(undefined), { declaradas: [], errores: [] });
    assert.deepEqual(objetosDeclarados([]), { declaradas: [], errores: [] });
  });

  it("lo que el tile NO declara no viaja: sin `shape` ni `volume_id` las claves no existen, ni con `undefined`", () => {
    // Los dos opcionales solo se probaban PRESENTES (el test de arriba los trae
    // los dos), así que el lector podía ponerlos SIEMPRE, valiendo `undefined`,
    // sin que nada se pusiera rojo. Quien lee con `!== undefined` —el cliente,
    // hoy— no nota la diferencia; quien lee con `in` sí, y `NpcDeclarado` dice
    // textualmente que la PRESENCIA de `combat` es lo que separa a un enemigo
    // de un vecino. Con la clave siempre puesta esa frase deja de ser cierta.
    // El aserto va sobre el registro ENTERO porque `deepEqual` (estricto, de
    // `node:assert/strict`) distingue `{a:1}` de `{a:1,b:undefined}` y campo a
    // campo no se distinguen.
    const { declaradas, errores } = objetosDeclarados([{ id: "pozo", position: [1, 0, 2] }]);
    assert.deepEqual(errores, []);
    assert.deepEqual(declaradas, [
      { id: "pozo", pos: { x: 1, y: 0, z: 2 }, nombre: "pozo", categoria: "prop", sizeXZ: { x: 1, z: 1 }, sizeY: 1 },
    ]);
  });
});

describe("npcsDeclarados", () => {
  it("lee nombre, prosa, ref de estilo, rol y el bloque de combate", () => {
    const { declaradas, errores } = npcsDeclarados([
      {
        id: "herrero",
        position: [3, 0, 7],
        name: "Bruno",
        description: "un herrero de manos anchas",
        style_ref: "char_2",
        role: "merchant",
        combat: { health: 40, max_health: 60 },
      },
    ]);
    assert.deepEqual(errores, []);
    assert.deepEqual(declaradas, [
      {
        id: "herrero",
        pos: { x: 3, y: 0, z: 7 },
        nombre: "Bruno",
        descripcion: "un herrero de manos anchas",
        styleRef: "char_2",
        role: "merchant",
        combat: { health: 40, max_health: 60 },
      },
    ]);
  });

  it("la PRESENCIA de `combat` viaja aunque el bloque sea basura: quien juzga es la puerta del cliente", () => {
    // Colapsar aquí «no pelea» con «pelea y su bloque está roto» dejaría al
    // hostil entrando como un vecino más: pintado y sin poder pegarle.
    const { declaradas } = npcsDeclarados([{ id: "x", position: [0, 0, 0], combat: "roto" }]);
    assert.equal("combat" in declaradas[0], true);
    assert.equal(declaradas[0].combat, "roto");
  });

  it("un vecino sin prosa, sin ref, sin rol y sin combate no trae ninguna de las cuatro claves", () => {
    // La otra mitad del test de arriba, y la que faltaba: si `combat` se pusiera
    // SIEMPRE (valiendo `undefined`), `"combat" in decl` diría que sí en todos y
    // el criterio que el tipo declara —la presencia— dejaría de separar nada.
    // Lo mismo con la prosa y la ref: `descripcion: undefined` es una clave que
    // el tile no dijo, y el prompt del skin sale de ahí (`descripcion ?? nombre`).
    const { declaradas, errores } = npcsDeclarados([{ id: "aldeana", position: [3, 0, 4] }]);
    assert.deepEqual(errores, []);
    assert.deepEqual(declaradas, [{ id: "aldeana", pos: { x: 3, y: 0, z: 4 }, nombre: "aldeana" }]);
  });
});

describe("declaraciones rotas · se dicen, no se tragan", () => {
  it("sin id no entra, y se dice con su posición en la lista", () => {
    // El id VACÍO cuenta como «sin id», y hay que probarlo aparte: colapsar `""`
    // con la ausencia es una DECISIÓN del lector (`texto()`), no una casualidad
    // del tipo. Si dejara entrar el `""`, habría en el mundo una entity a la que
    // no se puede nombrar en un log ni purgar por identidad — y un id vacío no
    // se ve en la línea de errores, así que el fallo llegaría mudo.
    const { declaradas, errores } = objetosDeclarados([
      { position: [0, 0, 0] },
      { id: 7, position: [0, 0, 0] },
      { id: "", position: [0, 0, 0] },
    ]);
    assert.deepEqual(declaradas, []);
    assert.equal(errores.length, 3);
    assert.match(errores[0], /objeto \[0\]: sin id/);
    assert.match(errores[1], /objeto \[1\]: sin id/);
    assert.match(errores[2], /objeto \[2\]: sin id/);
  });

  it("sin position no entra: no hay dónde pintarlo", () => {
    const { declaradas, errores } = npcsDeclarados([
      { id: "sin_sitio" },
      { id: "corta", position: [1, 2] },
      { id: "nan", position: [1, 0, Number.NaN] },
    ]);
    assert.deepEqual(declaradas, []);
    assert.equal(errores.length, 3);
    for (const e of errores) assert.match(e, /position no son tres números/);
    // El mensaje ENTERO y no un trozo: de qué CLASE es lo que se cayó (`npc`, y
    // no `objeto`, que es la otra mitad de la misma función), quién, qué llegó
    // en `position` y por qué no se pinta. Con solo el trozo del medio, la cola
    // se podía vaciar y la clase podía dejar de decirse sin que nada cayera.
    assert.equal(errores[0], 'npc "sin_sitio": position no son tres números (undefined), así que no hay dónde ponerlo');
    assert.equal(errores[1], 'npc "corta": position no son tres números ([1,2]), así que no hay dónde ponerlo');
  });

  it("un id REPETIDO en el mismo tile entra una vez y se dice", () => {
    // El duplicado que el filtro `!ids.has(o.id)` del cliente tapaba sin
    // nombrarlo: ahora entra el primero y el segundo tiene una línea con su id.
    const { declaradas, errores } = objetosDeclarados([
      { id: "cofre", position: [1, 0, 1], name: "el primero" },
      { id: "cofre", position: [9, 0, 9], name: "el segundo" },
    ]);
    assert.equal(declaradas.length, 1);
    assert.equal(declaradas[0].nombre, "el primero");
    assert.equal(errores.length, 1);
    assert.match(errores[0], /"cofre": declarado dos veces/);
  });

  it("lo roto no arrastra a lo sano: el resto del tile entra igual", () => {
    const { declaradas, errores } = objetosDeclarados([
      { id: "roto" },
      { id: "sano", position: [2, 0, 2] },
    ]);
    assert.deepEqual(declaradas.map((o) => o.id), ["sano"]);
    assert.equal(errores.length, 1);
  });
});

describe("los dos casos del criterio de verificación", () => {
  it("un objeto que CAMBIA SU NOMBRE se conserva y trae el nombre nuevo", () => {
    // Sin esto, conservar sería una regresión: el tile diría una cosa y el
    // mundo enseñaría la anterior para siempre.
    const antes = [delTile("puerta")];
    const { declaradas } = objetosDeclarados([
      { id: "puerta", position: [4, 0, 4], name: "la puerta, ahora astillada", scale: [2, 3, 1] },
    ]);
    const reparto = repartoDelTile(antes, declaradas, TILE);
    assert.equal(reparto.crear.length, 0, "no se recrea: la entity que ya está se conserva");
    assert.equal(reparto.conservar[0].declarado.nombre, "la puerta, ahora astillada");
    assert.deepEqual(reparto.conservar[0].declarado.pos, { x: 4, y: 0, z: 4 });
  });

  it("un NPC que SE MOVIÓ se conserva, y lo declarado que llega es su celda de spawn", () => {
    // El reparto conserva la entity —con su posición viva dentro— y entrega
    // aparte lo que el tile declara. Que la celda de spawn NO se le re-aplique
    // es lo que impide el teletransporte, y por eso `pos` viaja separada de la
    // entity en vez de dentro.
    const antes = [delTile("tabernero")];
    const { declaradas } = npcsDeclarados([
      { id: "tabernero", position: [0, 0, 0], name: "Nogala" },
    ]);
    const reparto = repartoDelTile(antes, declaradas, TILE);
    assert.deepEqual(reparto.crear, []);
    assert.deepEqual(reparto.retirar, []);
    const declarado: NpcDeclarado = reparto.conservar[0].declarado;
    assert.deepEqual(declarado.pos, { x: 0, y: 0, z: 0 });
    assert.equal(declarado.nombre, "Nogala");
  });
});
