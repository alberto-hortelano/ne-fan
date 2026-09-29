import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { createSimCollisionProvider } from "../bridge/sim-collision.js";
import { composeTilePlan } from "../src/scene/tile-plan.js";
import { SPAWN_DE_RUNTIME } from "../src/session/mundo-persistido.js";
import { SeededRng } from "../src/rng.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
    // El paso: entrar al agua desde fuera bloquea; moverse en abierto no.
    const before = cellCenter(15, 6);
    assert.ok(provider.algoImpideElPaso(before.x, before.z, wall.x, wall.z, 0.5));
    assert.ok(!provider.algoImpideElPaso(open.x, open.z, open.x + 1, open.z, 0.5));
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

  /** Guion 119 (rojo en `main` tras #775): el tabernero que huía de una pelea
   *  cruzaba el borde del tile y acababa a 15 m dentro de la «Zona sin
   *  generar», donde el jugador no puede seguirle sin aceptar «¿Explorar…?».
   *  El PASO no entra en lo no generado; quien ya lo toca, sale. */
  it("el paso no ENTRA en un tile sin generar, pero quien ya lo toca sale y se mueve", () => {
    const provider = createSimCollisionProvider(makeState());
    // El tile (0,0) acaba en x = 32; el (1,0) no existe.
    assert.deepEqual(provider.queImpideElPaso(31, 0, 31.7, 0, 0.5), { de: "tile" }, "entrar: el cuerpo tocaría x > 32");
    assert.equal(provider.queImpideElPaso(31, 0, 31.4, 0, 0.5), null, "CONTROL: dentro del tile, el paso es libre");
    assert.equal(provider.queImpideElPaso(31.4, 0, 31.4, 1, 0.5), null, "CONTROL: a lo largo del borde, también");
    assert.equal(provider.queImpideElPaso(32.2, 0, 31.6, 0, 0.5), null, "salir: quien ya toca lo no generado vuelve");
    assert.equal(provider.queImpideElPaso(40, 0, 41, 0, 0.5), null, "y quien vive allí anda libre");
    assert.equal(provider.ocupado(32.3, 0, 0.5), false, "`ocupado` no cambia: lo no generado no es un muro para la salida del sólido");
  });

  it("tile inexistente → sin colisión (degradación, no throw)", () => {
    const provider = createSimCollisionProvider(makeState());
    // Punto en el tile (5,5), que no existe.
    assert.ok(!provider.blocksCircle(320, 320, 0.5));
  });

  /** QA de BL, H1. La caché iba por `sceneId` y guardaba `[]` para un tile
   *  todavía no generado: desde #618 `npc_arrive` pregunta por el suelo del
   *  lugar de destino, que en el viaje narrative-paced casi nunca está
   *  realizado, y el tile quedaba VACÍO para el sim el resto de la partida. */
  it("un tile preguntado ANTES de generarse se ve sólido en cuanto se genera", () => {
    const s = makeState();
    const provider = createSimCollisionProvider(s);
    // La herrería en el tile (1,0), que empieza en x = 32: celda [60,60] 12×12 → centro mundo (65, 1).
    const centro = { x: 64 - 32 + 66 * 0.5, z: -32 + 66 * 0.5 };
    assert.equal(provider.ocupado(centro.x, centro.z, 0.5), false, "sin tile no hay nada");
    s.recordSceneLoaded("tile_1_0", expandScenePrimitives({
      tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", scene_description: "la herrería", biome: "grass",
      entities: [{ id: "herreria", kind: "building", name: "herrería", cell: [60, 60], footprint: [12, 12] }],
    }));
    assert.equal(provider.ocupado(centro.x, centro.z, 0.5), true, "el tile recién generado es sólido para el sim");
  });

  it("al cambiar de sesión, el mismo tile colisiona con la geometría de la sesión NUEVA", () => {
    const s = makeState();
    const provider = createSimCollisionProvider(s);
    const agua = cellCenter(15, 10);
    assert.equal(provider.ocupado(agua.x, agua.z, 0.5), true, "CONTROL: en esta sesión ahí hay agua");
    s.startNewSession("otra");
    s.recordSceneLoaded("tile_0_0", expandScenePrimitives({
      tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", scene_description: "campo seco", biome: "grass", entities: [],
    }));
    assert.equal(provider.ocupado(agua.x, agua.z, 0.5), false, "el agua era de la otra sesión");
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

  it("un `building` spawneado en runtime frena al NPC: el punto y el paso", () => {
    const provider = createSimCollisionProvider(conLaForja());
    assert.ok(provider.blocksCircle(0, 0, 0.5), "el centro de la forja debe bloquear");
    assert.ok(provider.algoImpideElPaso(5, 0, 1.9, 0, 0.5), "entrar en la forja debe bloquear");
    assert.ok(!provider.blocksCircle(10, 10, 0.5), "…y la calle de al lado se puede pisar");
    assert.ok(!provider.algoImpideElPaso(10, 10, 11, 10, 0.5));
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
    assert.ok(!provider.algoImpideElPaso(0, 0, 0.5, 0, 0.5), "alejarse del centro no bloquea");
    assert.ok(provider.algoImpideElPaso(1, 0, 0.5, 0, 0.5), "…y meterse más adentro sí");
  });

  it("dice POR DÓNDE SALIR de la caja que te tiene dentro, con su id", () => {
    const provider = createSimCollisionProvider(conLaForja());
    // La forja es 4×4 en (0,0): con el cuerpo, su cara queda a 2,5 m.
    assert.deepEqual(provider.porDondeSalirDeAqui(-1, 0, 0.5), { de: "caja", id: "forja", dir: { x: -1, z: 0 } });
    assert.equal(provider.porDondeSalirDeAqui(10, 10, 0.5), null, "fuera no hay de dónde salir");
  });

  it("de la geometría del TILE TAMBIÉN saca, y dice que es del tile (#616)", () => {
    // INVERTIDO por la tanda G. Hasta el 2026-09-17 este mismo caso afirmaba
    // que de la geometría del tile no salía nadie y citaba #616 como «eso tiene
    // número propio»: era un candado sobre el DEFECTO, puesto a propósito para
    // que el arreglo tuviera que venir aquí a quitarlo.
    const s = makeState({
      entities: [
        { id: "granero", kind: "building", name: "granero", cell: [40, 40], footprint: [12, 10] },
      ],
    });
    const provider = createSimCollisionProvider(s);
    const dentro = cellCenter(45, 45);
    assert.ok(provider.blocksCircle(dentro.x, dentro.z, 0.1), "está dentro del granero del tile");
    const salida = provider.porDondeSalirDeAqui(dentro.x, dentro.z, 0.1);
    assert.equal(salida?.de, "tile", "el dueño de la salida es la geometría dura, no una caja");
    // El rumbo es unitario y paralelo a un eje, y APUNTA A LA CARA MÁS CERCANA:
    // el granero ocupa las celdas [40..51] × [40..49] y el cuerpo está en la
    // (45,45), así que la salida más corta es hacia el norte (−z, 5,5 celdas)
    // y no hacia el oeste (5,5 celdas también en X, pero X gana los empates).
    assert.equal(Math.abs(salida!.dir.x) + Math.abs(salida!.dir.z), 1);
    // Y andando por ese rumbo se sale: el paso que reduce la penetración no
    // lo frena nadie.
    const paso = { x: dentro.x + salida!.dir.x * 0.25, z: dentro.z + salida!.dir.z * 0.25 };
    assert.equal(
      provider.queImpideElPaso(dentro.x, dentro.z, paso.x, paso.z, 0.1),
      null,
      "el paso que SACA del granero no puede estar frenado",
    );
    assert.equal(provider.porDondeSalirDeAqui(10, 10, 0.1), null, "en la calle no hay de dónde salir");
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
    assert.ok(!provider.algoImpideElPaso(5, 0, 1.9, 0, 0.5));

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
   *  y el proveedor se construye UNA vez por proceso (`crearContextoDelBridge`, que el bridge llama una vez al arrancar): con
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

/** LA RUTA VE LO QUE VE EL PASO (#618). `buscarRuta` arma el suelo con la MISMA
 *  cuenta que `ocupado` —terreno, plan y cajas de runtime— y no con la máscara
 *  de `scene-validate.ts`, que no sabe de cajas de runtime: una ruta sobre ella
 *  rodearía el granero del tile y cruzaría el del motor (#583 del revés). */
const R = 0.5;
/** El suelo de PRODUCCIÓN de una fixture: el proveedor del bridge sobre la
 *  escena registrada como tile (0,0). */
function proveedorDeFixture(nombre: string) {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL(`../data/scenes/${nombre}.json`, import.meta.url)), "utf-8"),
  ) as Record<string, unknown>;
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession(`ruta-${nombre}`);
  s.recordSceneLoaded("tile_0_0", expandScenePrimitives({ ...raw, scene_id: "tile_0_0" }));
  return createSimCollisionProvider(s);
}

/** Puntos del trazado `desde → puntos…` cada `paso` metros. */
function muestrear(desde: { x: number; z: number }, puntos: ReadonlyArray<{ x: number; z: number }>, paso = 0.05) {
  const out: Array<{ x: number; z: number }> = [];
  let a = desde;
  for (const b of puntos) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / paso));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    a = b;
  }
  return out;
}

describe("createSimCollisionProvider · buscarRuta", () => {
  /** Agua de la fila 10 (makeState), un árbol del PLAN y una forja de RUNTIME. */
  function mundo(): NarrativeState {
    const s = makeState({ volumes: [{ id: "arbol_1", label: "roble viejo", type: "tree", at: [100, 100] }] });
    s.recordEntitySpawned(
      "forja", "building", "tile_0_0", { x: 0, y: 0, z: 0 },
      { name: "forja del herrero", footprint: [8, 8] }, SPAWN_DE_RUNTIME, "ev_forja",
    );
    return s;
  }

  it("en 1.000 puntos, la meta de la ruta es el propio punto si y solo si `ocupado` dice que está libre", () => {
    const provider = createSimCollisionProvider(mundo());
    let ocupados = 0;
    for (let k = 0; k < 1000; k++) {
      // Rejilla determinista de 0,25 × 0,33 m que barre la forja de runtime y
      // su orla (la franja donde el cuerpo roza la caja sin estar dentro).
      const p = { x: -5 + (k % 40) * 0.25, z: -4.1 + Math.floor(k / 40) * 0.33 };
      const r = provider.buscarRuta({ x: 25, z: -15 }, p, 0.5);
      const libre = !provider.ocupado(p.x, p.z, 0.5);
      if (!libre) ocupados++;
      assert.ok(r.ok, `(${p.x}, ${p.z}): ${JSON.stringify(r)}`);
      assert.ok(!provider.ocupado(r.meta.x, r.meta.z, 0.5), "la meta siempre libre");
      assert.equal(r.meta.x === p.x && r.meta.z === p.z, libre, `(${p.x}, ${p.z}) libre=${libre} meta=${JSON.stringify(r.meta)}`);
    }
    assert.ok(ocupados > 50 && ocupados < 950, `la muestra cruza sólido de verdad: ${ocupados} ocupados`);
  });

  it("PARA PLANIFICAR, lo no generado es SÓLIDO: no rodea un río por fuera del tile (QA de BO, H2)", () => {
    // Un río de lado a lado (fila 60, columnas 0..127) parte el tile en dos.
    const partido = (vado: boolean) => {
      const s = makeState();
      const escena = s.scenes_loaded.tile_0_0.scene_data as Record<string, unknown>;
      const t = escena.terrain as string[];
      t[60] = vado ? "w".repeat(100) + "g".repeat(8) + "w".repeat(20) : "w".repeat(128);
      s.recordSceneLoaded("tile_0_0", escena);
      return createSimCollisionProvider(s);
    };
    const norte = { x: -28, z: -10 };
    const sur = { x: -28, z: 10 };
    const sinVado = partido(false);
    assert.ok(!sinVado.ocupado(-32.3, 0, R), "CONTROL: para el PASO, el tile vecino sin generar sigue libre");
    const r = sinVado.buscarRuta(norte, sur, R);
    assert.equal(r.ok ? "ok" : r.motivo, "sin-camino", "sin vado no hay camino DENTRO del mundo generado");
    const conVado = partido(true);
    const v = conVado.buscarRuta(norte, sur, R);
    assert.ok(v.ok, JSON.stringify(v));
    assert.equal(v.alBorde, false);
    const fuera = muestrear(norte, v.puntos).filter((p) => Math.abs(p.x) > 32 || Math.abs(p.z) > 32);
    assert.deepEqual(fuera, [], "cruza por el vado, no por fuera del tile");
  });

  it("un destino en un tile SIN GENERAR: la meta se queda en el borde y lo dice (`alBorde`)", () => {
    const provider = createSimCollisionProvider(mundo());
    const r = provider.buscarRuta({ x: 20, z: -15 }, { x: 45, z: -15 }, R);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.alBorde, true);
    assert.ok(r.meta.x <= 32 - R + 1e-9 && r.meta.x > 31, `meta en el borde este: ${JSON.stringify(r.meta)}`);
  });

  it("rodea la forja de RUNTIME: el trazado no toca nada que `ocupado` vea, y la recta sí", () => {
    const provider = createSimCollisionProvider(mundo());
    const desde = { x: -8, z: 0.3 };
    const hasta = { x: 8, z: 0.3 };
    const muestras = (pts: Array<{ x: number; z: number }>) => {
      const out: Array<{ x: number; z: number }> = [];
      for (let k = 1; k < pts.length; k++) {
        const [a, b] = [pts[k - 1], pts[k]];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
        for (let i = 0; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
      }
      return out;
    };
    assert.ok(muestras([desde, hasta]).some((p) => provider.ocupado(p.x, p.z, 0.5)), "CONTROL: la recta cruza la forja");
    const r = provider.buscarRuta(desde, hasta, 0.5);
    assert.ok(r.ok);
    assert.deepEqual(muestras([desde, ...r.puntos]).filter((p) => provider.ocupado(p.x, p.z, 0.5)), []);
  });

  it("SOLIDEZ: en las tres fixtures, el trazado alisado entre celdas no toca sólido (muestreo cada 5 cm)", () => {
    for (const nombre of ["robledo_tile", "puerto_tile", "zorder_test"]) {
      const suelo = proveedorDeFixture(nombre);
      const rng = new SeededRng(646);
      const libreAlAzar = (): { x: number; z: number } => {
        for (;;) {
          // Centros de celda, para que el tramo de anclaje sea de longitud 0
          // y lo medido sea SOLO lo que la cuenta promete.
          const p = { x: -32 + (rng.nextInt(128) + 0.5) * 0.5, z: -32 + (rng.nextInt(128) + 0.5) * 0.5 };
          if (!suelo.ocupado(p.x, p.z, R)) return p;
        }
      };
      let rutas = 0;
      let muestras = 0;
      const tocados: string[] = [];
      // Hasta 20 rutas: en puerto la mitad de los pares al azar NO tienen
      // camino dentro del mundo generado (el agua parte el tile y solo se
      // unía por fuera, QA de BO H2), así que se sortea hasta tener 20.
      const fuera: string[] = [];
      for (let k = 0; k < 120 && rutas < 20; k++) {
        const desde = libreAlAzar();
        const hasta = libreAlAzar();
        const r = suelo.buscarRuta(desde, hasta, R);
        if (!r.ok) continue;
        rutas++;
        const traza = muestrear(desde, r.puntos);
        muestras += traza.length;
        for (const p of traza) {
          if (suelo.ocupado(p.x, p.z, R)) tocados.push(`${nombre} ${k} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
          if (Math.abs(p.x) > 32 || Math.abs(p.z) > 32) fuera.push(`${nombre} ${k} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
        }
      }
      assert.equal(rutas, 20, `${nombre}: ${rutas} rutas`);
      assert.deepEqual(fuera, [], `${nombre}: el trazado sale del tile, al mundo sin generar`);
      assert.ok(muestras > 2000, `${nombre}: ${muestras} muestras`);
      assert.deepEqual(tocados, [], `${nombre}: trazado dentro del sólido`);
    }
  });
});
