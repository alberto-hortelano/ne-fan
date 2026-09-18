#!/usr/bin/env node
/** UNA COORDENADA ABSURDA NO CUELGA EL BRIDGE — el cable de #658.
 *
 *  ## De dónde sale
 *
 *  `marchaPorEje` (`src/simulation/salida-del-solido.ts`) avanza sumando 0,5 m
 *  a una coordenada de mundo dentro de un `for(;;)` que solo sale por punto
 *  libre o por tope. A partir de |coordenada| ≥ **2^52 − 40 m** (tx ≈ 7,0369e13)
 *  el ulp del flotante se come el sumando y el bucle NO VUELVE NUNCA. Eso corre
 *  en el tick del bridge, así que el tick se cuelga: no hay error, no hay
 *  timeout, no hay nada. El jugador ve su «Viajando…» para siempre.
 *
 *  La cuenta ya tiene su batería de unidad (`test/salida-del-solido.test.ts`,
 *  bloque «la marcha siempre termina»). Lo que no tenía candado es el CABLE:
 *  que el `RangeError` del guardia SALGA por el wire como algo que el jugador
 *  pueda leer, en vez de morir como unhandled rejection. Es la lección de #583
 *  y de #616 —cortar el cable dejaba la suite entera en verde—, y aquí se
 *  conduce el ROUTER real (`routeMessage`), que es la puerta por la que entra
 *  el mensaje del cliente.
 *
 *  ## Por qué una CAJA de runtime y no el grid del tile
 *
 *  Medido, y es la trampa que este guion existe para no repetir: un grid
 *  128×128 TODO sólido con su `origin` en el rect del tile 7,1e13 contesta
 *  `solapaSolido = false`. El mismo ulp que congela el `+ 0,5` deja el cuerpo
 *  de ancho CERO, y el solape ABIERTO de un cuerpo sin ancho es vacío: la
 *  marcha ni siquiera empieza. Escrito sobre grid, este guion NACERÍA VERDE
 *  CON EL DEFECTO PUESTO.
 *
 *  Lo que sí llega es la CAJA de runtime (`penetracionEnCaja` es analítica y no
 *  pierde magnitud), que es la que pone `SimCollisionProvider.ocupado` — el
 *  suelo del único llamante alcanzable, `sitioParaAparecer` desde
 *  `dondeAparecer` (`bridge/handlers/scene.ts`). Los dos controles del bloque 1
 *  lo miden AQUÍ, en cada corrida, en vez de fiarse de este párrafo.
 *
 *  ## La puerta que sigue abierta a propósito
 *
 *  `COTA_TILE` cierra `tile.{tx,ty}` en el contrato, pero `anchor.{tx,ty}` de
 *  un place (`src/world-map/types.ts`) NO tiene validación ninguna: lo escribe
 *  `map_upsert_place` sin schema de runtime. Esa es la puerta por la que entra
 *  el 7,1e13 de aquí abajo, y es lo que mantiene VIVO el sujeto de este candado
 *  (va a issue, no a esta PR: cerrarla sin más dejaría este guion sin poder
 *  construirse).
 *
 *  ## Qué afirma
 *
 *    1. CONTROLES, en proceso y sin riesgo de cuelgue: la caja de runtime
 *       contesta a esa magnitud y el grid NO; y sin la caja el mundo sale
 *       LIBRE, o sea que el guion no se reproduce solo.
 *    2. EL PROCESO TERMINA: el viaje se conduce en un proceso HIJO con muerte
 *       dura. Con el defecto puesto el bucle es SÍNCRONO —ningún timeout de
 *       runner lo interrumpe—, así que la única forma de que un cuelgue salga
 *       ROJO en vez de comerse el job es matarlo desde fuera y contarlo.
 *    3. Y SALE POR EL WIRE: `narrative_status phase:"error" kind:"scene"` con
 *       el `placeId` que el cliente necesita para cerrar su «Viajando…», y el
 *       motivo TÉCNICO —con la coordenada— en el log del bridge, que es lo
 *       único que permite encontrar el 7e13 después.
 *
 *  ## Contrato de salida (es un CANDADO)
 *
 *    0  una coordenada fuera de rango vuelve como error y el proceso termina
 *    1  o el bridge se colgó (el hijo hubo que matarlo), o el fallo no salió
 *       por el wire, o los controles dejaron de medir (si la caja sale libre a
 *       esa magnitud: mirar ESO antes de tocar el bridge)
 *    2  no se pudo medir (falta `nefan-core/dist`)
 *
 *  ## Probado en negativo, y se puede volver a probar
 *
 *    QA_SIN_GUARDIA=1 node qa/una-coordenada-absurda-no-cuelga-el-bridge.mjs
 *      el hijo ejerce una TRANSCRIPCIÓN de `marchaPorEje` sin el guardia —la
 *      regla de ayer, escrita aquí y no en el árbol— sobre el mismo suelo de
 *      caja: no vuelve nunca, el padre lo mata al vencer el plazo y salen
 *      **2 rojos** (el proceso no terminó, y sin su informe no hay nada que
 *      afirmar del wire), exit 1 — medido: SIGKILL a los 20.003 ms.
 *
 *  Y contra el ÁRBOL, quitando el guardia de `marchaPorEje` y recompilando
 *  `dist`: los MISMOS 2 rojos por el camino real del bridge, con los cinco
 *  controles del bloque 1 en verde. Eso es lo que separa este guion de su
 *  propia transcripción: el sabotaje de arriba prueba que el instrumento
 *  puede ponerse rojo; este prueba que se pone rojo POR EL DEFECTO.
 *
 *  Sin navegador, sin stack, sin créditos y sin red: `nefan-core/dist` y
 *  aritmética. Corre en el job `candados-headless`.
 *
 *  Uso: `node qa/una-coordenada-absurda-no-cuelga-el-bridge.mjs`
 *  (exige `cd nefan-core && npm run build` antes: lee `dist/`).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESTE = fileURLToPath(import.meta.url);
const RAIZ = path.resolve(path.dirname(ESTE), "..");
const DIST = path.join(RAIZ, "nefan-core/dist");

/** El tile del que sale todo. Ocho órdenes por encima de `COTA_TILE` (1e6) y
 *  por encima del acantilado medido (tx ≈ 7,0369e13). Entra por `anchor`, que
 *  no tiene cota (ver cabecera). */
const TX_ABSURDO = 7.1e13;
/** Cuánto se le da al hijo antes de declararlo colgado. NO es un presupuesto
 *  de rendimiento: el camino bueno tarda milisegundos y el malo no termina
 *  NUNCA, así que cualquier valor generoso separa los dos casos sin volver el
 *  veredicto ambiguo en un runner cargado. */
const PLAZO_MS = 20_000;
/** Separador del informe del hijo. Texto y no un carácter de control: su
 *  stdout lleva además lo que escriba cualquier dependencia. */
const MARCA = "@@QA658@@";

let mod;
try {
  mod = {
    NarrativeState: (await import(`${DIST}/src/narrative/narrative-state.js`)).NarrativeState,
    MemorySessionStorage: (await import(`${DIST}/src/narrative/session-storage.js`)).MemorySessionStorage,
    expandScenePrimitives: (await import(`${DIST}/src/scene/scene-expand.js`)).expandScenePrimitives,
    createSimCollisionProvider: (await import(`${DIST}/bridge/sim-collision.js`)).createSimCollisionProvider,
    routeMessage: (await import(`${DIST}/bridge/router.js`)).routeMessage,
    resolvePlaceTarget: (await import(`${DIST}/src/world-map/place-target.js`)).resolvePlaceTarget,
    sitioParaAparecer: (await import(`${DIST}/src/simulation/salida-del-solido.js`)).sitioParaAparecer,
    PLAYER_RADIUS_M: (await import(`${DIST}/src/scene/terrain-collision.js`)).PLAYER_RADIUS_M,
    createTerrainCollider: (await import(`${DIST}/src/scene/terrain-collision.js`)).createTerrainCollider,
    tileWorldRect: (await import(`${DIST}/src/scene/tile.js`)).tileWorldRect,
    TILE_MPC: (await import(`${DIST}/src/scene/tile.js`)).TILE_MPC,
    TILE_CELLS: (await import(`${DIST}/src/scene/tile.js`)).TILE_CELLS,
    COTA_TILE: (await import(`${DIST}/src/scene/tile.js`)).COTA_TILE,
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
  routeMessage, resolvePlaceTarget, sitioParaAparecer, PLAYER_RADIUS_M, createTerrainCollider,
  tileWorldRect, TILE_MPC, TILE_CELLS, COTA_TILE, GameStore, GameSimulation, loadConfig,
  MapTriggerEvaluator, SceneGenQueue, createWorldClaim,
} = mod;

const combatConfig = loadConfig(
  JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/combat_config.json"), "utf8")),
);

/** El punto al que apunta el anchor absurdo, en coordenadas de mundo. */
function puntoDelAnchor() {
  const rect = tileWorldRect(TX_ABSURDO, 0);
  return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
}

/** UNA SESIÓN con el place «destino» REALIZADO y anclado al tile absurdo.
 *
 *  La escena vive en `tile_0_0` —normal y dentro del plano— y lo que está
 *  fuera de rango es el `anchor`, que es la puerta sin cota. Con
 *  `conCaja: true` el motor ha spawneado ahí un `building` de runtime: es lo
 *  único que hace que el mundo conteste «ocupado» a esa magnitud, y sin ello
 *  el guion no se reproduce (bloque 1). */
function sesion({ conCaja }) {
  const narrative = new NarrativeState(new MemorySessionStorage());
  narrative.startNewSession("qa658");
  narrative.recordSceneLoaded("tile_0_0", expandScenePrimitives({
    tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", place_id: "origen",
    scene_description: "el claro de partida", biome: "grass", ground: [], entities: [],
  }));
  narrative.worldMap.upsertPlace({ id: "origen", kind: "landmark", parent_id: null, name: "El Claro" });
  narrative.worldMap.upsertPlace({
    id: "destino", kind: "site", parent_id: null, name: "La Atalaya del Fin del Mundo",
    // El `rect` lo escribe el motor con `map_upsert_place` y nadie lo valida.
    anchor: { tx: TX_ABSURDO, ty: 0, rect: [56, 56, 16, 16] },
  });
  narrative.worldMap.attachRealizedScene("destino", "tile_0_0");
  narrative.worldMap.setActivePlace("origen");
  if (conCaja) {
    const p = resolvePlaceTarget(narrative, "destino");
    // Un `building` spawneado por el motor a mitad de partida: 16×16 celdas =
    // 8 × 8 m. Su caja es lo ÚNICO que hay ahí — no está en el plan de ningún
    // tile, que es justo por lo que existe `cajasDeRuntime`.
    narrative.recordEntitySpawned(
      "atalaya", "building", "tile_0_0", [p.x, 0, p.z],
      { name: "La Atalaya", footprint: [16, 16] }, "narrative_request",
    );
  }
  return narrative;
}

/** EL BRIDGE DE LA SESIÓN, con el proveedor de colisión de PRODUCCIÓN. Mismo
 *  molde que `qa/el-viaje-no-mete-a-nadie-dentro.mjs`: el `ctx` va con pato y
 *  no con tipo, porque esto es `.mjs`. */
function bridgeDe(narrative) {
  const store = new GameStore();
  const sim = new GameSimulation(combatConfig, store, 12345);
  const difundidos = [];
  const provider = createSimCollisionProvider(narrative);
  const ctx = {
    sim, store, combatConfig, narrative,
    gamesDir: path.join(RAIZ, "nefan-core/data/games"),
    aiClient: { generateScene: async () => ({ ok: false, error: "este guion no genera" }) },
    simCollision: provider,
    mapTriggers: new MapTriggerEvaluator(narrative),
    sceneGen: new SceneGenQueue(),
    posTracking: { cellKey: null, tileKey: null, placeId: null },
    world: createWorldClaim(narrative, sim),
    activePlugins: new Map(),
    broadcastNarrative: (m) => difundidos.push(m),
    difundirDeJuego: (m) => difundidos.push(m),
    send: (_ws, m) => difundidos.push(m),
    enviarNarrativo: () => {},
    subscribe: () => {},
  };
  return { ctx, difundidos, provider };
}

// ══════════════════════════════════════════════════════════════════════════
// EL HIJO: conduce el viaje y cuenta lo que salió. Si se cuelga, no cuenta
// nada y el padre lo mata — que es exactamente el veredicto que hace falta.
// ══════════════════════════════════════════════════════════════════════════

if (process.env.QA_HIJO === "1") {
  const narrative = sesion({ conCaja: true });
  const { ctx, difundidos } = bridgeDe(narrative);
  const warn = console.warn;
  const error = console.error;
  const log = [];
  console.warn = (...a) => log.push(a.map(String).join(" "));
  console.error = (...a) => log.push(a.map(String).join(" "));
  try {
    if (process.env.QA_SIN_GUARDIA === "1") {
      // EL SABOTAJE: la regla de AYER, escrita aquí y no en el árbol. Es
      // `marchaPorEje` sin su guardia de progreso, sobre el mismo suelo que
      // el bridge le pasaría. No vuelve nunca, a propósito.
      const p = resolvePlaceTarget(narrative, "destino");
      const v = p.x;
      const trasero = v - PLAYER_RADIUS_M;
      let f = Math.floor(trasero / TILE_MPC) * TILE_MPC;
      if (!(f > trasero)) f += TILE_MPC;
      for (;;) {
        const nuevo = f + PLAYER_RADIUS_M;
        if (nuevo - v > 40) break;
        if (!ctx.simCollision.ocupado(nuevo, p.z, PLAYER_RADIUS_M)) break;
        f += TILE_MPC;
      }
    } else {
      await routeMessage({ type: "player_entered_place", placeId: "destino" }, {}, ctx);
    }
  } finally {
    console.warn = warn;
    console.error = error;
  }
  const err = difundidos.find((m) => m.type === "narrative_status" && m.phase === "error");
  process.stdout.write(MARCA + JSON.stringify({
    difundidos: difundidos.map((m) => ({ type: m.type, phase: m.phase, kind: m.kind, placeId: m.placeId })),
    error: err ?? null,
    log,
  }) + "\n");
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════
// EL PADRE
// ══════════════════════════════════════════════════════════════════════════

const SIN_GUARDIA = process.env.QA_SIN_GUARDIA === "1";
let rojos = 0;
const ok = (cond, linea, detalle = "") => {
  console.log(`  ${cond ? "✔" : "✖"} ${linea}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) rojos++;
};

console.log(`\nUNA COORDENADA ABSURDA NO CUELGA EL BRIDGE (tile ${TX_ABSURDO}, cota del plano ${COTA_TILE})`);
if (SIN_GUARDIA) {
  console.log("    (SABOTAJE: el hijo ejerce la marcha SIN guardia — la regla de ayer, escrita en este guion)");
}

// ── 1 · Los controles: qué contesta el mundo a esa magnitud ─────────────────

console.log("\n1 · LOS CONTROLES (sin riesgo de cuelgue: aquí no se marcha)");
{
  const p = puntoDelAnchor();
  ok(TX_ABSURDO > COTA_TILE, "el tile de este guion está FUERA del plano que admite el contrato",
    `${TX_ABSURDO} > ${COTA_TILE}`);

  // El GRID se rinde un ulp antes: si alguien reescribe este guion sobre él,
  // mide un `null` y nace verde con el defecto puesto.
  const rect = tileWorldRect(TX_ABSURDO, 0);
  const col = createTerrainCollider({
    grid: Array.from({ length: TILE_CELLS }, () => "w".repeat(TILE_CELLS)),
    cols: TILE_CELLS, rows: TILE_CELLS, meters_per_cell: TILE_MPC,
    origin: [rect.minX, rect.minZ], solid_chars: ["w"],
  });
  ok(col.solapaSolido(p.x, p.z, PLAYER_RADIUS_M) === false,
    "un grid 128×128 TODO sólido contesta LIBRE ahí: por eso el candado va sobre CAJAS",
    `solapaSolido = ${col.solapaSolido(p.x, p.z, PLAYER_RADIUS_M)}`);

  // Sin la caja de runtime, el mundo sale libre y no hay marcha: el guion no
  // se reproduce solo, y conviene que eso se vea medido.
  const { provider: sinCaja } = bridgeDe(sesion({ conCaja: false }));
  ok(sinCaja.ocupado(p.x, p.z, PLAYER_RADIUS_M) === false,
    "sin la caja de runtime el mundo sale LIBRE: la caja es lo que reproduce el defecto");
  const sitioSinCaja = sitioParaAparecer(p, PLAYER_RADIUS_M, sinCaja);
  ok(sitioSinCaja !== null && sitioSinCaja.x === p.x,
    "y entonces `sitioParaAparecer` devuelve el candidato sin marchar",
    JSON.stringify(sitioSinCaja));

  // Y CON la caja, el mundo sí contesta a esa magnitud: es lo que mete a
  // `marchaPorEje` en el bucle.
  const { provider: conCaja } = bridgeDe(sesion({ conCaja: true }));
  ok(conCaja.ocupado(p.x, p.z, PLAYER_RADIUS_M) === true,
    "con ella, el punto del anchor está OCUPADO y hay marcha que medir",
    `(${p.x}, ${p.z})`);
}

// ── 2 y 3 · El viaje, en un hijo con muerte dura ────────────────────────────

console.log("\n2 y 3 · EL VIAJE: el proceso TERMINA y el fallo SALE POR EL WIRE");
const hijo = spawn(process.execPath, [ESTE], {
  env: { ...process.env, QA_HIJO: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let salida = "";
let stderr = "";
hijo.stdout.on("data", (b) => { salida += b.toString(); });
hijo.stderr.on("data", (b) => { stderr += b.toString(); });

const t0 = Date.now();
const veredicto = await new Promise((resolve) => {
  const reloj = setTimeout(() => {
    // MUERTE DURA, y es el único instrumento que sirve: con el defecto puesto
    // el bucle es síncrono y el hijo no atiende señales blandas.
    hijo.kill("SIGKILL");
    resolve({ termino: false });
  }, PLAZO_MS);
  hijo.on("exit", (code, signal) => {
    clearTimeout(reloj);
    resolve({ termino: signal !== "SIGKILL", code, signal });
  });
});
const ms = Date.now() - t0;

ok(veredicto.termino,
  `el bridge TERMINA en vez de colgarse (plazo ${PLAZO_MS} ms)`,
  veredicto.termino ? `${ms} ms, exit ${veredicto.code}` : `hubo que matarlo a los ${ms} ms`);

const linea = salida.split(MARCA)[1];
const res = linea ? JSON.parse(linea.trim()) : null;
if (!res) {
  ok(false, "el hijo trae su informe: sin él no hay nada que afirmar del wire",
    (stderr.split("\n")[0] ?? "").slice(0, 120));
} else {
  const err = res.error;
  ok(!!err, "el jugador se entera: hay `narrative_status` de error");
  ok(err?.kind === "scene" && err?.placeId === "destino",
    "con el canal y el id que el cliente necesita para cerrar su «Viajando…»",
    `kind ${err?.kind}, placeId ${err?.placeId}`);
  ok(typeof err?.message === "string" && err.message.length > 0,
    "y con un mensaje que se puede pintar", (err?.message ?? "sin mensaje").slice(0, 90));
  ok(!res.difundidos.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    "y NO se difunde un `ready`: eso sería un spawn mudo sobre un punto imposible");
  // El motivo técnico es lo único que permite encontrar el 7e13 después.
  const tecnico = res.log.join("\n");
  ok(tecnico.includes("marchaPorEje"),
    "el motivo TÉCNICO queda en el log del bridge y nombra la marcha",
    (res.log[0] ?? "sin log").slice(0, 100));
  ok(tecnico.includes(String(puntoDelAnchor().x)),
    "y lleva la COORDENADA: sin ella nadie encuentra el tile absurdo en un log");
}

console.log(
  `\n${rojos === 0 ? "✔ una coordenada absurda vuelve como error y el bridge sigue vivo" : `✖ ${rojos} aserto(s) en rojo`}`,
);
process.exit(rojos === 0 ? 0 : 1);
