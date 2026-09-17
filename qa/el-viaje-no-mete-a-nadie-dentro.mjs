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
 *
 *  ## Contrato de salida (es un CANDADO)
 *
 *    0  el viaje deja a los 13 fuera de la piedra, y el que no puede lo dice
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
 *      → **13 rojos, exit 1**.
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
function bridgeDe(narrative, { sinSalida = false } = {}) {
  const store = new GameStore();
  const sim = new GameSimulation(combatConfig, store, 12345);
  const difundidos = [];
  const provider = createSimCollisionProvider(narrative);
  const ctx = {
    sim, store, combatConfig, narrative,
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

console.log(`\n${rojos === 0 ? "✔ el viaje no mete a nadie dentro" : `✖ ${rojos} aserto(s) en rojo`}`);
process.exit(rojos === 0 ? 0 : 1);
