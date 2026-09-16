import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { createSimCollisionProvider } from "../bridge/sim-collision.js";
import { composeTilePlan } from "../src/scene/tile-plan.js";
import { SPAWN_DE_RUNTIME } from "../src/session/mundo-persistido.js";

/** Tile 0,0: rect mundo [-32,32). Celda (c,r) → mundo (-32 + (c+0.5)·0.5). */
function cellCenter(c: number, r: number): { x: number; z: number } {
  return { x: -32 + (c + 0.5) * 0.5, z: -32 + (r + 0.5) * 0.5 };
}

function makeState(extra: Record<string, unknown> = {}): NarrativeState {
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession("plugtest");
  const scene = expandScenePrimitives({
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    scene_description: "campo",
    biome: "grass",
    entities: [],
    ...extra,
  }) as Record<string, unknown>;
  // Agua en la fila 10, columnas 10..20 (terrain_grid del esquema; `w` es el
  // único char sólido que fija el engine — los muros son volúmenes del plan).
  const terrain = scene.terrain as string[];
  terrain[10] = terrain[10].slice(0, 10) + "w".repeat(11) + terrain[10].slice(21);
  s.recordSceneLoaded("tile_0_0", scene);
  return s;
}

describe("createSimCollisionProvider", () => {
  it("bloquea sobre el agua del terrain_grid y no en campo abierto", () => {
    const provider = createSimCollisionProvider(makeState());
    const wall = cellCenter(15, 10);
    assert.ok(provider.blocksCircle(wall.x, wall.z, 0.5), "celda w debe bloquear");
    const open = cellCenter(64, 64);
    assert.ok(!provider.blocksCircle(open.x, open.z, 0.5), "campo abierto no bloquea");
    // blocksMove: entrar al agua desde fuera bloquea; moverse en abierto no.
    const before = cellCenter(15, 6);
    assert.ok(provider.blocksMove(before.x, before.z, wall.x, wall.z, 0.5));
    assert.ok(!provider.blocksMove(open.x, open.z, open.x + 1, open.z, 0.5));
  });

  it("bloquea sobre las huellas de los volumes del plan", () => {
    const provider = createSimCollisionProvider(makeState({
      volumes: [{ id: "arbol_1", label: "roble viejo", type: "tree", at: [100, 100] }],
    }));
    const tree = cellCenter(100, 100);
    assert.ok(provider.blocksCircle(tree.x, tree.z, 0.5), "el árbol debe bloquear");
    const open = cellCenter(64, 64);
    assert.ok(!provider.blocksCircle(open.x, open.z, 0.5));
  });

  it("tile inexistente → sin colisión (degradación, no throw)", () => {
    const provider = createSimCollisionProvider(makeState());
    // Punto en el tile (5,5), que no existe.
    assert.ok(!provider.blocksCircle(320, 320, 0.5));
  });
});

/** #232: el bridge NO veía los volúmenes DERIVADOS del esquema, solo los
 *  `volumes` declarados. En un tile cuyo pueblo viene de las `entities`
 *  estáticas —o cuyo bosque viene de `vegetation_zones`, que es la mayoría—
 *  los NPCs se metían dentro de las casas y atravesaban los troncos que al
 *  jugador sí le frenan.
 *  Hoy el bridge lee el plan COMPUESTO de la world scene: la misma huella con
 *  la que juega el jugador. */
describe("createSimCollisionProvider · el bridge colisiona con el plan COMPUESTO", () => {
  it("los troncos de la vegetación de masa frenan a los NPCs (antes: ninguno)", () => {
    const provider = createSimCollisionProvider(makeState({
      vegetation_zones: [{ type: "pino", area: "rest", density: 0.05 }],
    }));
    // Los mismos árboles que compone el juego: se preguntan al compositor y se
    // comprueban uno a uno. Muestrear a ciegas dependería de que hubiera
    // muchos; así, si el bosque cambia, el test sigue mirando SUS árboles.
    const plan = composeTilePlan(
      expandScenePrimitives({
        tile: { tx: 0, ty: 0 },
        scene_id: "tile_0_0",
        scene_description: "campo",
        biome: "grass",
        entities: [],
        vegetation_zones: [{ type: "pino", area: "rest", density: 0.05 }],
      }) as Record<string, unknown>,
    ).plan;
    const pinos = (plan?.volumes ?? []).filter((v) => v.id.startsWith("derived_veg_"));
    assert.ok(pinos.length > 100, `el pinar tiene que existir: ${pinos.length}`);
    const blandos = pinos.filter((v) => {
      const at = (v as Extract<typeof v, { type: "tree" }>).at;
      const p = cellCenter(at[0] - 0.5, at[1] - 0.5);
      return !provider.blocksCircle(p.x, p.z, 0.3);
    });
    assert.deepEqual(blandos.map((v) => v.id), [], "cada tronco derivado frena también en el bridge");
  });

  it("los edificios que salen de una entity estática dejan de ser transparentes", () => {
    const provider = createSimCollisionProvider(makeState({
      entities: [
        { id: "granero", kind: "building", name: "granero", cell: [40, 40], footprint: [12, 10] },
      ],
    }));
    // El granero NO está en `volumes`: es una entity, y su volumen lo deriva
    // el compositor. En el grid ASCII su rect sigue siendo hierba, así que si
    // el bridge mirara solo el terreno no bloquearía nada aquí. Radio pequeño
    // a propósito: lo que se mide es la huella del volumen derivado, no el
    // margen de un cuerpo grande.
    const dentro = cellCenter(45, 45);
    assert.ok(provider.blocksCircle(dentro.x, dentro.z, 0.1), "la huella del edificio derivado bloquea");
    const fuera = cellCenter(45, 60);
    assert.ok(!provider.blocksCircle(fuera.x, fuera.z, 0.1), "…y la calle de al lado se puede pisar");
  });
});

/** #583: lo que el motor pone A MITAD DE PARTIDA. Gemelo del de #232 y por el
 *  mismo motivo: aquello cerró la huella que DECLARA un tile (su volumen
 *  derivado), y esto cierra la del spawn de runtime, que no está en el plan de
 *  ningún tile. Mismo granero y misma coordenada: sólido para el jugador desde
 *  #489 y transparente para el NPC hasta hoy. */
describe("createSimCollisionProvider · las cajas de los spawns de RUNTIME (#583)", () => {
  /** La forja que el motor suelta: `building` de 8×8 celdas = 4 m de lado,
   *  centrada en el origen del mundo (campo abierto en la fixture). */
  function conLaForja(): NarrativeState {
    const s = makeState();
    s.recordEntitySpawned(
      "forja", "building", "tile_0_0", { x: 0, y: 0, z: 0 },
      { name: "forja del herrero", footprint: [8, 8] }, SPAWN_DE_RUNTIME,
    );
    return s;
  }

  it("un `building` spawneado en runtime frena al NPC: blocksCircle y blocksMove", () => {
    const provider = createSimCollisionProvider(conLaForja());
    assert.ok(provider.blocksCircle(0, 0, 0.5), "el centro de la forja debe bloquear");
    assert.ok(provider.blocksMove(5, 0, 1.9, 0, 0.5), "entrar en la forja debe bloquear");
    assert.ok(!provider.blocksCircle(10, 10, 0.5), "…y la calle de al lado se puede pisar");
    assert.ok(!provider.blocksMove(10, 10, 11, 10, 0.5));
  });

  it("dice QUÉ impide el paso, y la caja va con su id", () => {
    const provider = createSimCollisionProvider(conLaForja());
    assert.deepEqual(provider.queImpideElPaso(5, 0, 1.9, 0, 0.5), { de: "caja", id: "forja" });
    assert.equal(provider.queImpideElPaso(10, 10, 11, 10, 0.5), null);
    // La geometría del tile sigue siendo "tile" — es la que nadie atraviesa.
    const agua = cellCenter(15, 10);
    const antes = cellCenter(15, 6);
    assert.deepEqual(
      provider.queImpideElPaso(antes.x, antes.z, agua.x, agua.z, 0.5),
      { de: "tile" },
    );
  });

  it("donde se juntan las dos, manda el TILE: un muro no se atraviesa por tener una caja encima", () => {
    // El orden no es cosmético: quien lee esto decide si atraviesa, y solo
    // puede atravesar cajas. Una forja puesta encima del agua tiene que
    // contestar "tile", o el escape del encajonado abriría el río.
    const s = makeState();
    const agua = cellCenter(15, 10);
    s.recordEntitySpawned(
      "forja", "building", "tile_0_0", { x: agua.x, y: 0, z: agua.z },
      { name: "forja del herrero", footprint: [8, 8] }, SPAWN_DE_RUNTIME,
    );
    const provider = createSimCollisionProvider(s);
    const antes = cellCenter(15, 6);
    assert.deepEqual(
      provider.queImpideElPaso(antes.x, antes.z, agua.x, agua.z, 0.5),
      { de: "tile" },
    );
  });

  it("SALIR SÍ, ENTRAR NO también para el NPC: la consulta no frena el paso que SACA", () => {
    // Lo que afirma es de la CONSULTA y solo de ella. Que el NPC salga de
    // verdad es cosa del steering y se afirma en `npc-behavior.test.ts`: la
    // primera versión de este caso se llamaba «al que le cae la caja encima
    // sale andando» y no medía a ningún NPC — se quedó dentro 290 s de 300 con
    // esto en verde (#583, QA H-2). El nombre prometía el sistema y el aserto
    // cubría la consulta.
    const provider = createSimCollisionProvider(conLaForja());
    assert.ok(!provider.blocksMove(0, 0, 0.5, 0, 0.5), "alejarse del centro no bloquea");
    assert.ok(provider.blocksMove(1, 0, 0.5, 0, 0.5), "…y meterse más adentro sí");
  });

  it("dice POR DÓNDE SALIR de la caja que te tiene dentro, con su id", () => {
    const provider = createSimCollisionProvider(conLaForja());
    // La forja es 4×4 en (0,0): con el cuerpo, su cara queda a 2,5 m.
    assert.deepEqual(provider.porDondeSalirDeAqui(-1, 0, 0.5), { caja: "forja", dir: { x: -1, z: 0 } });
    assert.equal(provider.porDondeSalirDeAqui(10, 10, 0.5), null, "fuera no hay de dónde salir");
  });

  it("de la geometría del TILE no saca a nadie: eso tiene número propio (#616)", () => {
    const s = makeState({
      entities: [
        { id: "granero", kind: "building", name: "granero", cell: [40, 40], footprint: [12, 10] },
      ],
    });
    const provider = createSimCollisionProvider(s);
    const dentro = cellCenter(45, 45);
    assert.ok(provider.blocksCircle(dentro.x, dentro.z, 0.1), "está dentro del granero del tile");
    assert.equal(
      provider.porDondeSalirDeAqui(dentro.x, dentro.z, 0.1),
      null,
      "esta puerta es solo para las cajas de runtime",
    );
  });

  it("un `item` de runtime NO frena a nadie: se pisa (#532)", () => {
    const s = makeState();
    s.recordEntitySpawned(
      "bolsa", "item", "tile_0_0", { x: 0, y: 0, z: 0 },
      { name: "bolsa de cuero" }, SPAWN_DE_RUNTIME,
    );
    const provider = createSimCollisionProvider(s);
    assert.ok(!provider.blocksCircle(0, 0, 0.5));
  });

  it("lo que declara el TILE no entra por aquí: su volumen ya responde por él", () => {
    // El granero del tile (#232) bloquea por su volumen derivado, y su caja NO
    // se aplica encima: contarla otra vez taparía los vanos que el plan pinta.
    const s = makeState({
      entities: [
        { id: "granero", kind: "building", name: "granero", cell: [40, 40], footprint: [12, 10] },
      ],
    });
    const provider = createSimCollisionProvider(s);
    const dentro = cellCenter(45, 45);
    assert.deepEqual(
      provider.queImpideElPaso(dentro.x, dentro.z - 5, dentro.x, dentro.z, 0.1),
      { de: "tile" },
      "la huella del granero del tile es geometría dura, no una caja de runtime",
    );
  });

  /** EL CANDADO DE LA CACHÉ, que es la trampa concreta de esta tarea: las
   *  cajas aparecen a mitad de partida y `collidersFor` cachea por `sceneId`
   *  sin invalidar nunca. Se consulta ANTES (que cebe lo que haya que cebar),
   *  se empuja la entity y se vuelve a preguntar SIN recargar la escena. */
  it("una caja que llega a mitad de partida se ve SIN recargar la escena", () => {
    const s = makeState();
    const provider = createSimCollisionProvider(s);
    assert.ok(!provider.blocksCircle(0, 0, 0.5), "antes del spawn ahí no hay nada");
    assert.ok(!provider.blocksMove(5, 0, 1.9, 0, 0.5));

    s.recordEntitySpawned(
      "forja", "building", "tile_0_0", { x: 0, y: 0, z: 0 },
      { name: "forja del herrero", footprint: [8, 8] }, SPAWN_DE_RUNTIME,
    );

    assert.ok(provider.blocksCircle(0, 0, 0.5), "la forja recién puesta bloquea ya");
    assert.deepEqual(provider.queImpideElPaso(5, 0, 1.9, 0, 0.5), { de: "caja", id: "forja" });
  });

  /** La otra mitad del mismo candado, y hace falta porque el ledger solo CRECE
   *  —desde #326 un muerto se queda dentro— así que una caché con clave en
   *  «cuántas entities hay» pasaría el caso de arriba: nunca se le repite un
   *  número. Lo que sí cambia el ledger entero sin cambiar su tamaño es cargar
   *  OTRA partida (`loadSession` reemplaza `entities`, narrative-state.ts:696),
   *  y el proveedor se construye UNA vez por proceso (`ws-server.ts:69`): con
   *  esa caché, la partida nueva colisionaría contra las cajas de la anterior. */
  it("al cambiar de partida, las cajas son las de la partida NUEVA aunque mida lo mismo", () => {
    const s = conLaForja();
    const provider = createSimCollisionProvider(s);
    assert.deepEqual(provider.queImpideElPaso(5, 0, 1.9, 0, 0.5), { de: "caja", id: "forja" });

    // Otro ledger, la MISMA longitud, la caja en otro sitio: lo que hace el
    // resume al cargar otro slot.
    const otra = new NarrativeState(new MemorySessionStorage());
    otra.startNewSession("otra");
    otra.recordEntitySpawned(
      "posada", "building", "tile_0_0", { x: 20, y: 0, z: 0 },
      { name: "posada del cruce", footprint: [8, 8] }, SPAWN_DE_RUNTIME,
    );
    assert.equal(otra.entities.length, s.entities.length, "el caso pierde sentido si no miden igual");
    s.entities = otra.entities;

    assert.equal(provider.queImpideElPaso(5, 0, 1.9, 0, 0.5), null, "la forja de la otra partida ya no está");
    assert.deepEqual(provider.queImpideElPaso(25, 0, 21.9, 0, 0.5), { de: "caja", id: "posada" });
  });
});
