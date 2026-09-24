#!/usr/bin/env node
/** EL VIAJE NO METE A NADIE DENTRO — la mitad de ARRIBA de #616.
 *
 *  ## De dónde sale
 *
 *  De la crítica de la tanda G, que tumbó las tres vías que el issue nombraba
 *  y midió la que NO nombraba, que es la viva: **viajar por «Salidas»**.
 *  `resolvePlaceTarget` (`src/world-map/place-target.ts`) devuelve el centro
 *  del `anchor.rect` del lugar **sin una sola consulta de solidez**, el bridge
 *  lo difunde como `ready.spawn` y `nefan-html/src/main.ts:946` teletransporta
 *  ahí al jugador. Y los edificios del plan son MACIZOS —`planCollisionGrid`
 *  rasteriza la huella entera del volumen, no sus muros—, así que ese centro
 *  es un punto del que no se sale: el jugador llega a su destino y la partida
 *  se acaba ahí, de pie y sin recurso.
 *
 *  Medido sobre las fixtures del selector «Room», que es mundo de verdad
 *  commiteado: **los 13 `building` de `robledo_tile` y `puerto_tile` están
 *  ocupados en su centro, 13 de 13** (la casa del concejo, la capilla, la
 *  herrería, la posada, el molino, el establo, la atalaya, la lonja, la
 *  taberna del Ancla, la cordelería, el almacén de sal, el astillero y el faro
 *  viejo).
 *
 *  ## Qué afirma, y por qué conduce el BRIDGE y no la cuenta
 *
 *  La cuenta —`sitioParaAparecer`, en `src/simulation/salida-del-solido.ts`—
 *  ya tiene su batería de unidad. Lo que no tenía candado es el CABLE: que el
 *  bridge PREGUNTE antes de difundir el spawn. Es la lección de #583, medida:
 *  cortar el cable de `bridge/context.ts` dejaba la suite entera en verde con
 *  el defecto puesto. Así que aquí se llama a `handlePlayerEnteredPlace`, el
 *  handler REAL, con el proveedor de colisión REAL de la sesión, y se mira lo
 *  que sale por el wire — el mismo `ready.spawn` que lee el cliente.
 *
 *    1. CONTROL: el centro del `anchor.rect` de los 13 está OCUPADO. Sin esto,
 *       lo de abajo saldría igual de verde sobre un mundo de aire.
 *    2. EL VIAJE: el `ready.spawn` que difunde el bridge está LIBRE en los 13,
 *       a ≤ 4 m del centro (la puerta del lugar, no su cocina) y es el punto
 *       al que saca UNA marcha, no una búsqueda a lo largo del tile.
 *    3. Y SI NO HAY SITIO, SE DICE: con un mundo sin salida, el bridge emite
 *       `narrative_status phase:"error"` con el NOMBRE del lugar y no difunde
 *       ni escena ni spawn. Un spawn mudo —escena nueva, `spawn: undefined`—
 *       deja al jugador en el tile viejo mirando el de otro sitio sin que nada
 *       se lo diga, que es el cuelgue del #210 con otro traje.
 *    4. EL OTRO CAMINO DEL SPAWN: el viaje que GENERA el tile (`viaje.sitio`), con
 *       el motor afinando el `anchor.rect` sobre el edificio que acaba de
 *       declarar. Nació de **H2 de la QA de G2**: los bloques 1-3 solo montan
 *       lugares YA REALIZADOS, así que con ese segundo sitio revertido salían
 *       los tres VERDES y la batería entera también — media PR se podía
 *       revertir sin que ningún guion ejecutable dijera nada.
 *
 *  ## Contrato de salida (es un CANDADO)
 *
 *    0  el viaje deja a los 13 fuera de la piedra por sus DOS caminos, y el
 *       que no puede lo dice
 *    1  o el bridge volvió a difundir un punto que nadie ha mirado, o el
 *       control dejó de medir (si los 13 centros salen libres, o el mundo
 *       cambió o la fixture dejó de tener edificios: mirar eso ANTES de tocar
 *       el bridge), o un viaje sin sitio volvió mudo
 *    2  no se pudo medir (falta `nefan-core/dist`)
 *
 *  ## Probado en negativo, y se puede volver a probar
 *
 *    QA_SIN_SITIO=1 node qa/el-viaje-no-mete-a-nadie-dentro.mjs
 *      juzga el centro CRUDO de `resolvePlaceTarget` —la regla de ayer,
 *      escrita aquí y no en el árbol— en vez del spawn que difunde el bridge
 *      → **16 rojos, exit 1**: los 13 edificios, los dos agregados y el del
 *      bloque 4 (el tile recién generado).
 *
 *  Y contra el ÁRBOL, revirtiendo cada sitio del bridge por separado a la
 *  regla de ayer (escrita para que compile, porque la cruda ya no compila:
 *  `SitioDeAparicion` no admite el tercer desenlace) y recompilando `dist`:
 *  `:111` → **22 asertos rojos**; `:181` → **1 rojo, el del bloque 4**; los
 *  dos → **23**. Antes del bloque 4, `:181` salía exit 0.
 *
 *  Sin navegador, sin stack y sin créditos: `nefan-core/dist`, las tres
 *  fixtures del árbol y aritmética. Corre en el job `candados-headless`.
 *
 *  Uso: `node qa/el-viaje-no-mete-a-nadie-dentro.mjs`
 *  (exige `cd nefan-core && npm run build` antes: lee `dist/`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(RAIZ, "nefan-core/dist");

let mod;
try {
  mod = {
    NarrativeState: (await import(`${DIST}/src/narrative/narrative-state.js`)).NarrativeState,
    MemorySessionStorage: (await import(`${DIST}/src/narrative/session-storage.js`)).MemorySessionStorage,
    expandScenePrimitives: (await import(`${DIST}/src/scene/scene-expand.js`)).expandScenePrimitives,
    createSimCollisionProvider: (await import(`${DIST}/bridge/sim-collision.js`)).createSimCollisionProvider,
    handlePlayerEnteredPlace: (await import(`${DIST}/bridge/handlers/scene.js`)).handlePlayerEnteredPlace,
    resolvePlaceTarget: (await import(`${DIST}/src/world-map/place-target.js`)).resolvePlaceTarget,
    sitioParaAparecer: (await import(`${DIST}/src/simulation/salida-del-solido.js`)).sitioParaAparecer,
    PLAYER_RADIUS_M: (await import(`${DIST}/src/scene/terrain-collision.js`)).PLAYER_RADIUS_M,
    GameStore: (await import(`${DIST}/src/store/game-store.js`)).GameStore,
    GameSimulation: (await import(`${DIST}/src/simulation/game-loop.js`)).GameSimulation,
    loadConfig: (await import(`${DIST}/src/combat/combat-data.js`)).loadConfig,
    MapTriggerEvaluator: (await import(`${DIST}/src/world-map/map-triggers.js`)).MapTriggerEvaluator,
    SceneGenQueue: (await import(`${DIST}/bridge/scene-gen-queue.js`)).SceneGenQueue,
    createWorldClaim: (await import(`${DIST}/bridge/world-claim.js`)).createWorldClaim,
  };
} catch (err) {
  console.error(`No se pudo leer nefan-core/dist: ${err?.message ?? err}`);
  console.error("Compila primero: cd nefan-core && npm run build");
  process.exit(2);
}
const {
  NarrativeState, MemorySessionStorage, expandScenePrimitives, createSimCollisionProvider,
  handlePlayerEnteredPlace, resolvePlaceTarget, sitioParaAparecer, PLAYER_RADIUS_M,
  GameStore, GameSimulation, loadConfig, MapTriggerEvaluator, SceneGenQueue, createWorldClaim,
} = mod;

/** Espera a que la cola de generación entregue algo. El viaje a un lugar sin
 *  realizar se ENCOLA, así que el handler vuelve antes de que haya escena. */
async function esperarA(cond, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}

const SIN_SITIO = process.env.QA_SIN_SITIO === "1";
const FIXTURES = ["robledo_tile", "puerto_tile"];
/** La puerta de al lado, no el otro barrio: el desplazamiento del spawn es la
 *  penetración mínima, y sobre estos 13 la mayor medida es 3,90 m. */
const TOPE_DESPLAZAMIENTO_M = 4;

const combatConfig = loadConfig(
  JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/combat_config.json"), "utf8")),
);

let rojos = 0;
const ok = (cond, linea, detalle = "") => {
  console.log(`  ${cond ? "✔" : "✖"} ${linea}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) rojos++;
};

/** UNA SESIÓN con la fixture cargada como tile y el lugar anclado al edificio.
 *
 *  El `anchor.rect` se toma del `cell` + `footprint` de la entity, que es
 *  EXACTAMENTE lo que #465 quiere que escriba el motor real (`anchor.rect` en
 *  celdas del tile). Hoy nadie se lo pide, y por eso el banco está verde: el
 *  motor falso fija el rect pero lo elige LIBRE.
 *
 *  La escena se registra bajo `tile_0_0` y no bajo el nombre de la fixture
 *  porque el proveedor de colisión busca los colliders por CLAVE DE TILE, que
 *  es como se llaman las escenas de tile en producción. Con otro nombre no
 *  encuentra ninguno y el mundo entero sale libre — o sea, el guion mediría
 *  aire y no podría ponerse rojo nunca. */
function sesionConElLugarEn(fixture, entity) {
  const crudo = JSON.parse(
    readFileSync(path.join(RAIZ, "nefan-core/data/scenes", `${fixture}.json`), "utf8"),
  );
  // El `place_id` NO es decoración, y su ausencia hacía VERDE POR CONSTRUCCIÓN
  // el aserto «el lugar no queda ACTIVO» del bloque 3 (H3 de la QA de G2):
  // `recordSceneLoaded` resuelve `placeId = scene.place_id ?? sceneId`, y sin
  // el campo salía `tile_0_0`, que no es un lugar del mapa — así que jamás
  // llamaba a `setActivePlace` y el aserto no podía ponerse rojo ni con la
  // guarda movida después del registro. Con el campo puesto, activar es
  // exactamente lo que haría un `recordSceneLoaded` prematuro.
  //
  // El orden importa: la escena se registra ANTES de que el lugar exista en el
  // mapa, así que ese primer registro no lo activa (es el arranque, no el
  // viaje). Lo que active el lugar tiene que ser el handler, y solo él.
  crudo.place_id = "destino";
  const narrative = new NarrativeState(new MemorySessionStorage());
  narrative.startNewSession("qa616");
  narrative.recordSceneLoaded("tile_0_0", expandScenePrimitives(crudo));
  narrative.worldMap.upsertPlace({
    id: "destino",
    kind: "site",
    parent_id: null,
    name: entity.name ?? entity.id,
    anchor: {
      tx: crudo.tile.tx,
      ty: crudo.tile.ty,
      rect: [entity.cell[0], entity.cell[1], entity.footprint[0], entity.footprint[1]],
    },
  });
  narrative.worldMap.attachRealizedScene("destino", "tile_0_0");
  return narrative;
}

/** EL BRIDGE DE LA SESIÓN, con el proveedor de colisión de PRODUCCIÓN.
 *
 *  El `ctx` va con pato y no con tipo —esto es `.mjs`—: lo que el handler lee
 *  es `narrative`, `simCollision`, `mapTriggers`, `sceneGen`, `posTracking`,
 *  `world`, `store`/`sim` (el combate que viaja con la escena) y las dos
 *  puertas de difusión. Si algún día lee más, esto revienta con su `TypeError`,
 *  que es la respuesta correcta. */
function bridgeDe(narrative, { sinSalida = false, generateScene = null } = {}) {
  const store = new GameStore();
  const sim = new GameSimulation(combatConfig, store, 12345);
  const difundidos = [];
  const provider = createSimCollisionProvider(narrative);
  const ctx = {
    sim, store, combatConfig, narrative,
    // Solo lo necesita el bloque 4 (el viaje que GENERA). El `gamesDir` real
    // porque `attachWorldVocabulary` lo lee; sin él avisa y sigue, pero el
    // aviso ensuciaría el bloque 3, que cuenta avisos.
    gamesDir: path.join(RAIZ, "nefan-core/data/games"),
    aiClient: { generateScene: generateScene ?? (async () => ({ ok: false, error: "este bloque no genera" })) },
    // El mundo sin salida del bloque 3: la consulta de PUNTO dice «ocupado»
    // siempre, que es lo único que hace `null` a `sitioParaAparecer`.
    // Alcanzarlo con geometría de verdad pide 160 m de sólido continuo (25
    // tiles de agua); lo que se mide aquí es qué hace el BRIDGE con ese
    // `null`, no cuándo se produce.
    simCollision: sinSalida ? { ...provider, ocupado: () => true } : provider,
    mapTriggers: new MapTriggerEvaluator(narrative),
    sceneGen: new SceneGenQueue(),
    posTracking: { cellKey: null, tileKey: null, placeId: null },
    world: createWorldClaim(narrative, sim),
    activePlugins: new Map(),
    broadcastNarrative: (m) => difundidos.push(m),
    difundirDeJuego: (m) => difundidos.push(m),
    send: () => {},
    enviarNarrativo: () => {},
    subscribe: () => {},
  };
  return { ctx, difundidos, provider };
}

const edificiosDe = (fixture) =>
  JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/scenes", `${fixture}.json`), "utf8"))
    .entities.filter((e) => e.kind === "building");

// ── 1 y 2 · El control y el viaje, sobre los edificios de verdad ─────────────

console.log("\n1 y 2 · EL VIAJE A CADA EDIFICIO DE LAS FIXTURES (handler real del bridge)");
console.log(`    (spawn juzgado: ${SIN_SITIO ? "el CENTRO CRUDO de `resolvePlaceTarget` (la regla de ayer)" : "el `ready.spawn` que difunde el bridge"})`);

let centrosOcupados = 0;
let spawnsLibres = 0;
let total = 0;
let desplazamientoMax = 0;
let enUnaMarcha = 0;

for (const fixture of FIXTURES) {
  for (const entity of edificiosDe(fixture)) {
    total++;
    const narrative = sesionConElLugarEn(fixture, entity);
    const { ctx, difundidos, provider } = bridgeDe(narrative);
    const centro = resolvePlaceTarget(narrative, "destino");

    // CONTROL: el punto que se difundía hasta hoy.
    const ocupado = provider.ocupado(centro.x, centro.z, PLAYER_RADIUS_M);
    if (ocupado) centrosOcupados++;

    await handlePlayerEnteredPlace({ type: "player_entered_place", placeId: "destino" }, ctx);
    const ready = difundidos.find((m) => m.type === "narrative_status" && m.phase === "ready");
    // El SABOTAJE: la regla de ayer, escrita aquí y no en el árbol.
    const spawn = SIN_SITIO ? centro : ready?.spawn;

    const libre = !!spawn && !provider.ocupado(spawn.x, spawn.z, PLAYER_RADIUS_M);
    if (libre) spawnsLibres++;
    const d = spawn ? Math.hypot(spawn.x - centro.x, spawn.z - centro.z) : Infinity;
    if (Number.isFinite(d)) desplazamientoMax = Math.max(desplazamientoMax, d);
    // UNA marcha basta: el sitio es la puerta del edificio, no un punto
    // encontrado a base de pasos por medio tile.
    const unaMarcha = sitioParaAparecer(centro, PLAYER_RADIUS_M, provider, 1);
    if (unaMarcha && spawn && unaMarcha.x === spawn.x && unaMarcha.z === spawn.z) enUnaMarcha++;

    ok(
      ocupado && libre && d <= TOPE_DESPLAZAMIENTO_M,
      `${fixture} · ${entity.id}`,
      `centro (${centro.x.toFixed(2)}, ${centro.z.toFixed(2)}) ${ocupado ? "OCUPADO" : "libre (¡el control no mide!)"}` +
        ` → spawn ${spawn ? `(${spawn.x.toFixed(2)}, ${spawn.z.toFixed(2)}) ${libre ? "libre" : "OCUPADO"}, ${d.toFixed(2)} m` : "ninguno"}`,
    );
  }
}

console.log(
  `\n    ${centrosOcupados}/${total} centros ocupados (control) · ${spawnsLibres}/${total} spawns libres · ` +
    `${enUnaMarcha}/${total} en UNA marcha · desplazamiento máximo ${desplazamientoMax.toFixed(2)} m ` +
    `(tope ${TOPE_DESPLAZAMIENTO_M})`,
);
ok(centrosOcupados === total, `el control mide: los ${total} centros están ocupados HOY`,
  `${centrosOcupados} de ${total}`);
ok(spawnsLibres === total, `y el viaje deja a los ${total} en un sitio libre`,
  `${spawnsLibres} de ${total}`);
ok(enUnaMarcha === total, "con UNA marcha: se aparece en la puerta del lugar",
  `${enUnaMarcha} de ${total}`);

// ── 3 · Y si no hay sitio, se dice ───────────────────────────────────────────

console.log("\n3 · UN VIAJE SIN SITIO LO DICE, Y NO DIFUNDE UN SPAWN MUDO");
{
  const entity = edificiosDe("robledo_tile")[0];
  const narrative = sesionConElLugarEn("robledo_tile", entity);
  const { ctx, difundidos } = bridgeDe(narrative, { sinSalida: true });
  const warn = console.warn;
  const avisos = [];
  console.warn = (...a) => { avisos.push(a.map(String).join(" ")); };
  try {
    await handlePlayerEnteredPlace({ type: "player_entered_place", placeId: "destino" }, ctx);
  } finally {
    console.warn = warn;
  }

  const err = difundidos.find((m) => m.type === "narrative_status" && m.phase === "error");
  ok(!!err, "el jugador se entera: hay narrative_status de error");
  ok(
    (err?.message ?? "").includes(entity.name ?? entity.id),
    "y el error NOMBRA el lugar al que quería ir",
    err?.message ?? "sin mensaje",
  );
  ok(err?.kind === "scene" && err?.placeId === "destino",
    "con el canal y el id que el cliente necesita para cerrar su «Viajando…»",
    `kind ${err?.kind}, placeId ${err?.placeId}`);
  ok(
    !difundidos.some((m) => m.type === "narrative_event" && m.eventId === "scene_init"),
    "no se difunde la escena del destino",
  );
  ok(
    !difundidos.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    "ni un `ready` sin spawn: eso es el spawn mudo",
  );
  ok(
    narrative.worldMap.serialize().active_place_id !== "destino",
    "y el lugar no queda ACTIVO en un sitio al que el jugador nunca llegó",
  );
  ok(avisos.length > 0, "el motivo técnico queda en el log del bridge",
    avisos[0]?.slice(0, 110) ?? "sin avisos");
}

// ── 4 · El OTRO camino del spawn: el viaje que GENERA el tile ────────────────

console.log("\n4 · EL VIAJE QUE GENERA EL TILE TAMPOCO DEJA A NADIE DENTRO (`viaje.sitio`)");
{
  // H2 de la QA de G2, y es el hallazgo que obliga a este bloque: con el sitio
  // `:181` (`viaje.sitio`) revertido, los bloques 1-3 seguían VERDES y la batería
  // entera también — la mitad del arreglo se podía revertir sin que ningún
  // guion ejecutable dijera nada. Los bloques de arriba solo montan lugares YA
  // REALIZADOS, así que no pasan por ahí ni una vez.
  //
  // El banco tampoco puede verlo, y está medido: los DOS rects que ancla el
  // motor falso (`BOOTSTRAP_PLACE_RECT` y `ANCHORED_PLACE_RECT`) caen en
  // hueco, así que ningún viaje-que-genera del bench aterriza sobre un macizo.
  const entity = edificiosDe("robledo_tile").find((e) => e.id === "casa_concejo");
  const rect = [entity.cell[0], entity.cell[1], entity.footprint[0], entity.footprint[1]];

  const narrative = new NarrativeState(new MemorySessionStorage());
  narrative.startNewSession("qa616gen");
  // Campo abierto en el tile de partida: lo que se mide es el tile que se
  // GENERA, y un origen con geometría metería ruido en el rayo del anclaje.
  narrative.recordSceneLoaded("tile_0_0", expandScenePrimitives({
    tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", place_id: "origen",
    scene_description: "el claro de partida", biome: "grass", ground: [], entities: [],
  }));
  narrative.worldMap.upsertPlace({ id: "origen", kind: "landmark", parent_id: null, name: "El Claro" });
  narrative.worldMap.upsertPlace({ id: "forja", kind: "site", parent_id: null, name: "La Forja" });
  narrative.worldMap.addLink({ from: "origen", to: "forja", kind: "path", edge: "east" });
  narrative.worldMap.setActivePlace("origen");

  // EL MOTOR, como el de verdad: declara el edificio Y afina el `anchor.rect`
  // del lugar encima de él con `map_upsert_place` MIENTRAS genera (#408). Es
  // exactamente lo que #465 quiere que haga el motor real, y lo que convierte
  // el estado sin salida de latente en rutinario.
  const elMotorGenera = async () => {
    narrative.worldMap.upsertPlace({
      id: "forja", kind: "site", parent_id: null, name: "La Forja",
      anchor: { tx: 1, ty: 0, rect },
    });
    return {
      ok: true,
      scene: {
        biome: "grass", scene_description: "la forja al borde del camino", ground: [],
        entities: [{ ...entity, id: "nave_de_la_forja" }],
      },
    };
  };

  const { ctx, difundidos, provider } = bridgeDe(narrative, { generateScene: elMotorGenera });
  const warn = console.warn;
  console.warn = () => {};
  let llego;
  try {
    await handlePlayerEnteredPlace({ type: "player_entered_place", placeId: "forja" }, ctx);
    llego = await esperarA(() =>
      difundidos.some((m) => m.type === "narrative_status" && (m.phase === "ready" || m.phase === "error")));
  } finally {
    console.warn = warn;
  }

  ok(llego, "el viaje entrega: el tile se generó y se difundió");
  const ready = difundidos.find((m) => m.type === "narrative_status" && m.phase === "ready");
  const centro = resolvePlaceTarget(narrative, "forja");
  const ocupado = centro ? provider.ocupado(centro.x, centro.z, PLAYER_RADIUS_M) : false;
  ok(ocupado, "CONTROL · el centro del rect que afinó el motor está OCUPADO",
    centro ? `(${centro.x.toFixed(2)}, ${centro.z.toFixed(2)})` : "sin punto");
  const spawn = SIN_SITIO ? centro : ready?.spawn;
  const libre = !!spawn && !provider.ocupado(spawn.x, spawn.z, PLAYER_RADIUS_M);
  const d = spawn && centro ? Math.hypot(spawn.x - centro.x, spawn.z - centro.z) : Infinity;
  ok(libre, "y el `ready.spawn` del tile RECIÉN GENERADO está libre",
    spawn ? `(${spawn.x.toFixed(2)}, ${spawn.z.toFixed(2)}) ${libre ? "libre" : "OCUPADO"}` : "sin spawn");
  ok(d <= TOPE_DESPLAZAMIENTO_M, `a ≤ ${TOPE_DESPLAZAMIENTO_M} m del centro: la puerta del lugar`,
    Number.isFinite(d) ? `${d.toFixed(2)} m` : "sin medida");
}

console.log(`\n${rojos === 0 ? "✔ el viaje no mete a nadie dentro" : `✖ ${rojos} aserto(s) en rojo`}`);
process.exit(rojos === 0 ? 0 : 1);
