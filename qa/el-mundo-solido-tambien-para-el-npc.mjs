/** ¿SE PARA EL NPC DONDE SE PARA EL JUGADOR? (#583)
 *
 *  Escrito por QA al validar la PR 2 de la tanda E. Existe porque, cuando esa
 *  PR se escribió, **ningún guion del banco afirmaba que un NPC no atraviesa
 *  nada** (`grep` de asertos = 0): lo único que sujetaba el arreglo eran los
 *  tests unitarios de core y una sonda que vivía en el scratchpad del
 *  ingeniero. Un arreglo cuyo observable no está en el banco vuelve a romperse
 *  sin que nadie se entere.
 *
 *  NO ABRE NAVEGADOR y no gasta un céntimo: el defecto vive en el SERVIDOR —el
 *  sim mueve a los NPCs en el bridge—, así que lo que se conduce es el camino
 *  real del sim, con el MISMO cableado que `bridge/context.ts`
 *  (`createSimCollisionProvider` + `createSessionNpcBehavior`, el adapter de
 *  PRODUCCIÓN y no uno escrito aquí — ver `simDeLaSesion`). Lee
 *  `nefan-core/dist`, o sea lo compilado, no una reimplementación.
 *
 *  LO QUE AFIRMA (rojo si falla):
 *    1. control — sin caja el aldeano cruza y llega (si no, lo demás no mide);
 *    2. la caja de runtime FRENA — penetración máxima 0,000 m — y el aldeano
 *       la RODEA y llega a su meta (#618: antes pisaba en el sitio delante);
 *    3. la geometría del TILE no se atraviesa NUNCA: con un camino legal lo
 *       RODEA (sin pisar el agua ni atravesar nada), y encajonado de verdad
 *       tampoco la cruza;
 *    4. el cercado SIN camino se PARA y deja su meta al motor
 *       (`suspended_goal` `no_path`), sin anunciar ningún escape;
 *    5. al que le cae una caja encima no se le encierra (a nivel de consulta:
 *       alejarse del centro nunca bloquea);
 *    6. y al que le cae encima DE VERDAD, con el sim moviéndolo, se le SACA:
 *       sale andando por la cara más cercana aunque su meta esté al otro lado;
 *    7. también al que NO va a ningún sitio (campesino sin directiva, granero
 *       de 10 m encima): sale, y luego pasea alrededor de donde salió;
 *    8. y al que tiene `hold`: sale, y fuera se queda quieto;
 *    9. y al que YA LLEGÓ a su meta cuando el motor le pone la caja encima;
 *   10. el MISMO obstáculo, lo ponga el tile o el motor, se rodea igual: los
 *       dos llegan, y en tiempos que no difieren más de un 10 %.
 *
 *  Del 7 al 9 fueron el tercer `⚠ HALLAZGO` de este guion (QA de #583: «al que
 *  no va a ningún sitio la salida no le alcanza», 0,00 m en 120 s) hasta la
 *  tanda BL (#618, pieza B): la salida vivía dentro de `stepTowards` y solo
 *  sacaba al que ya andaba. Ahora vive en la cabeza de `move()`, para todos los
 *  modos.
 *
 *  Probado en negativo contra el ÁRBOL (tanda BL, recompilando `dist`): sin la
 *  llamada a `salirSiEstaDentro` caen el 6 al 9; con la salida devuelta a
 *  `stepTowards` (el árbol de antes) caen el 7 al 9 y el 6 sigue verde; sin
 *  mover el `home` al salir cae el «luego pasea» del 7.
 *
 *  El 6 nació como registro de esta misma revisión (`⚠ HALLAZGO`: 290 s de 300
 *  dentro del carro) y es ahora un aserto: la consulta no frena al que sale,
 *  pero al que no empuja hay que empujarlo, y eso lo hace
 *  `porDondeSalirDeAqui`. Se queda rojo si alguien vuelve a fiarse de que «sale
 *  solo».
 *
 *  El 2 (su segunda mitad), el 3 y el 10 fueron hasta la tanda BO (#618,
 *  pieza A) dos `⚠ HALLAZGO` que se medían sin ponerse rojos: el steering por
 *  deflexión NO rodeaba un obstáculo centrado en su camino —57 s de 60
 *  pisando en el sitio delante del carro, x máx −3,50—, igual con las dos
 *  fuentes (x máx −3,00 las dos en 300 s). Hoy el NPC busca camino con un A*
 *  sobre la colisión del sim (`bridge/sim-collision.ts` → `buscarRuta`), así
 *  que son asertos. El 2 decía antes «y no sale por el otro lado», que
 *  defendía el síntoma.
 *
 *  Probado en negativo contra el ÁRBOL (tanda BO, recompilando `dist`): con
 *  `buscarRuta` cortado en `bridge/context.ts` (devolviendo siempre un plan
 *  fallido) este guion sale con 1 — cinco rojos, en el 2, el 3 y el 10.
 *
 *  LO QUE NO SUJETA: el escape por caja de `rumboDePaso` para el que va a un
 *  sitio. Desde la QA de BO, el que no tiene camino no anda (se para y deja la
 *  meta al motor), así que el 4 ya no lo ejerce; el escape sigue existiendo
 *  para quien anda sin ruta (huir, intervenir, pasear) y lo sujetan los
 *  unitarios de `npc-behavior.test.ts`. Tampoco sujeta que el escape ACABE
 *  fuera: con BL, un paso dentro de la muralla lo devuelve la salida del
 *  sólido (medido en `main` antes de BO).
 *
 *  Uso: `node qa/el-mundo-solido-tambien-para-el-npc.mjs`
 *  (exige `cd nefan-core && npm run build` antes: lee `dist/`).
 */
import { NarrativeState } from "../nefan-core/dist/src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../nefan-core/dist/src/narrative/session-storage.js";
import { expandScenePrimitives } from "../nefan-core/dist/src/scene/scene-expand.js";
import { createSimCollisionProvider } from "../nefan-core/dist/bridge/sim-collision.js";
import { createSessionNpcBehavior } from "../nefan-core/dist/bridge/context.js";

const TICK = 1 / 60;          // el sim avanza UN tick por frame del cliente
const RADIO_NPC = 0.5;
const SPAWN_DE_RUNTIME = "narrative_request";

let rojos = 0;
const ok = (cond, msg, detalle = "") => {
  console.log(`  ${cond ? "✔" : "✖"} ${msg}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) rojos++;
};

/** Un tile de campo abierto. Con `agua` se pone una columna sólida del
 *  `terrain_grid` en x ≈ +8 (filas 40..88), que es geometría DEL TILE. */
function tile({ agua = false } = {}) {
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession("qa583");
  const escena = expandScenePrimitives({
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    scene_description: "campo abierto",
    biome: "grass",
    entities: [],
  });
  if (agua) {
    const t = escena.terrain;
    for (let r = 40; r < 88; r++) t[r] = `${t[r].slice(0, 80)}w${t[r].slice(81)}`;
  }
  s.recordSceneLoaded("tile_0_0", escena);
  return s;
}

/** Lo que el MOTOR pone a mitad de partida: la puerta real, `spawn_reason`
 *  incluido. Nada de estado sintético — es `recordEntitySpawned` con los
 *  mismos argumentos que `consequence-handler.ts:142`. */
function elMotorPone(s, id, x, z, celdas, kind = "object") {
  const footprint = Array.isArray(celdas) ? celdas : [celdas, celdas];
  s.recordEntitySpawned(
    id, kind, "tile_0_0", { x, y: 0, z },
    { name: id, footprint }, SPAWN_DE_RUNTIME, `ev_${id}`,
  );
}

/** LA META, como un PLACE de verdad del mapa del mundo, porque el adapter real
 *  la resuelve con `resolvePlaceTarget` y no con un `if` del guion. `anchor.rect`
 *  es `[col, row, w, h]` en celdas del tile (0,0): mundo = −32 + (col + w/2)·0,5. */
function laPlaza(s, meta) {
  s.worldMap.upsertPlace({
    id: "plaza", kind: "landmark", parent_id: null, name: "la plaza",
    anchor: { tx: 0, ty: 0, rect: [(meta.x + 32) / 0.5, (meta.z + 32) / 0.5, 0, 0] },
  });
}

/** ¿El CUERPO del NPC pisa la columna de agua de `tile({ agua: true })`? Celdas
 *  80 (x 8,0..8,5) × filas 40..88 (z −12..12), con el radio. */
const enAgua = (p) => p.x + RADIO_NPC > 8 && p.x - RADIO_NPC < 8.5 && Math.abs(p.z) < 12 + RADIO_NPC;

/** EL SIM DE LA SESIÓN, montado por PRODUCCIÓN y no por este guion.
 *
 *  Aquí se construía el adapter a mano, y eso dejaba fuera justo la costura que
 *  más barata es de romper: las cinco líneas de `createSessionNpcBehavior` que
 *  atan el proveedor de colisión al sistema de NPCs. Medido por QA en la 2ª
 *  pasada de #583 — cambiar `queImpideElPaso: (…) => ctx.simCollision…` por
 *  `() => null` en `bridge/context.ts` deja **2891 de 2891 tests en verde** con
 *  el defecto entero puesto, y lo mismo con `porDondeSalirDeAqui`. O sea: las
 *  dos mitades tienen candado y el cable entre ellas no tenía ninguno.
 *
 *  El `ctx` va con pato y no con tipo —esto es `.mjs`— y es a propósito: lo
 *  único que `createSessionNpcBehavior` lee es `narrative` y `simCollision`. Si
 *  algún día lee más, esto rompe en ejecución con su `TypeError`, que es la
 *  respuesta correcta. */
function simDeLaSesion(s, meta) {
  laPlaza(s, meta);
  const provider = createSimCollisionProvider(s);
  return { provider, sys: createSessionNpcBehavior({ narrative: s, simCollision: provider }, undefined) };
}

/** Un aldeano con una meta fija, movido por el sim REAL. Devuelve la traza que
 *  hace falta para juzgar: hasta dónde llegó, cuánto se metió en la caja que
 *  se le señale, y los avisos del escape que soltó por el camino. */
function aldeanoVaA(s, { desde, meta, segundos, caja = null }) {
  const { sys } = simDeLaSesion(s, meta);
  const registro = {
    id: "aldeano", type: "npc", scene_id: "tile_0_0",
    spawned_at: "2026-01-01T00:00:00.000Z",
    spawn_reason: "scene_init", spawn_event_id: "",
    position: [desde.x, 0, desde.z],
    data: { role: "villager", directive: { type: "goto_place", target_place_id: "plaza" } },
    asset_refs: [],
  };
  sys.addNpc(registro);
  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => { avisos.push(a.map(String).join(" ")); };
  let xMax = -Infinity, penMax = 0, ticksMoviendose = 0, llegadaEn = null, ticksEnAgua = 0;
  const ctx = { playerPos: { x: 1000, y: 0, z: 1000 }, combatEvents: [], combatantPositions: new Map() };
  try {
    for (let i = 0; i < segundos / TICK; i++) {
      const ev = sys.tick(TICK, ctx);
      if (llegadaEn === null && ev.some((e) => e.type === "npc_reached_place")) llegadaEn = (i + 1) * TICK;
      const st = sys.states()[0];
      if (enAgua(st.pos)) ticksEnAgua++;
      xMax = Math.max(xMax, st.pos.x);
      if (st.moving) ticksMoviendose++;
      if (caja) {
        const mx = caja.semi - Math.abs(st.pos.x - caja.x);
        const mz = caja.semi - Math.abs(st.pos.z - caja.z);
        if (mx > 0 && mz > 0) penMax = Math.max(penMax, Math.min(mx, mz));
      }
    }
  } finally { console.warn = warn; }
  const st = sys.states()[0];
  return {
    xMax, penMax, avisos, ticksMoviendose, llegadaEn, ticksEnAgua, data: registro.data,
    fin: { x: st.pos.x, z: st.pos.z }, mode: st.mode, moving: st.moving,
  };
}

// ────────────────────────────────────────────────────────────────────
console.log("\n1 · CONTROL: sin caja el aldeano cruza el sitio y llega a su meta");
const control = aldeanoVaA(tile(), { desde: { x: -12, z: 0 }, meta: { x: 12, z: 0 }, segundos: 30 });
ok(control.xMax > 9, "el aldeano llega a la plaza cuando no hay nada en medio",
  `x máx ${control.xMax.toFixed(2)} m`);

console.log("\n2 · LA CAJA DEL MOTOR FRENA AL NPC (#583) Y EL NPC LA RODEA (#618)");
const sCarro = tile();
elMotorPone(sCarro, "carro_del_mercader", 0, 0, 12);          // 6 × 6 m
const carro = aldeanoVaA(sCarro, {
  desde: { x: -12, z: 0 }, meta: { x: 12, z: 0 }, segundos: 60,
  caja: { x: 0, z: 0, semi: 3 + RADIO_NPC },
});
ok(carro.penMax === 0, "penetración MÁXIMA en el carro = 0,000 m en 60 s",
  `medido ${carro.penMax.toFixed(3)} m`);
ok(carro.xMax > 9 && carro.llegadaEn !== null, "y la RODEA: llega a la plaza, al otro lado del carro",
  `x máx ${carro.xMax.toFixed(2)} m, llegada ${carro.llegadaEn === null ? "nunca" : `${carro.llegadaEn.toFixed(1)} s`} ` +
  `(antes de #618: x máx −3,50, 57 s de 60 pisando en el sitio)`);
ok(carro.avisos.filter((a) => a.includes("ATRAVIESA")).length === 0,
  "sin escape: le quedaban rumbos legales, así que no se atraviesa nada");

console.log("\n3 · LA GEOMETRÍA DEL TILE NO SE ATRAVIESA NUNCA: con camino la rodea, encajonado tampoco la cruza");
// Un pasillo entre dos murallas de runtime (x −4..16), cortado al este por el
// agua del tile (x 8..8,5, z −12..12); la meta, al otro lado del agua.
//  · ABIERTO, de 4 m: el camino LEGAL existe —salir por el oeste del pasillo y
//    bajar por debajo del agua—. Antes de #618 se resolvía atravesando una
//    muralla, porque el abanico no sabe rodear.
//  · CERRADO de verdad: 1 m de ancho —el cuerpo justo, sin sitio para girar
//    ninguno de los siete rumbos— y una tercera muralla al oeste. No hay
//    camino, y es el caso para el que existe el escape.
function pasillo({ cerrado }) {
  const s = tile({ agua: true });
  const semi = cerrado ? 0.5 : 2;
  elMotorPone(s, "muralla_norte", 6, semi + 1, [40, 4], "building");
  elMotorPone(s, "muralla_sur", 6, -semi - 1, [40, 4], "building");
  if (cerrado) elMotorPone(s, "muralla_oeste", -5, 0, [2, 10], "building"); // x −5..−4
  return aldeanoVaA(s, { desde: { x: 6, z: 0 }, meta: { x: 30, z: 0 }, segundos: 120 });
}
const rodeo = pasillo({ cerrado: false });
ok(rodeo.ticksEnAgua === 0, "con camino legal, el cuerpo NO pisa el agua del terrain_grid",
  `${rodeo.ticksEnAgua} ticks sobre el agua`);
ok(rodeo.llegadaEn !== null, "…y llega a la meta RODEANDO el pasillo y el agua",
  rodeo.llegadaEn === null ? `acabó en (${rodeo.fin.x.toFixed(2)}, ${rodeo.fin.z.toFixed(2)})` : `llegó en ${rodeo.llegadaEn.toFixed(1)} s`);
ok(rodeo.avisos.filter((a) => a.includes("ATRAVIESA")).length === 0,
  "…sin atravesar ninguna muralla: pudiendo rodear, rodear no es el escape");
const cercado = pasillo({ cerrado: true });
ok(cercado.ticksEnAgua === 0, "cercado de verdad (tres murallas + agua): el cuerpo NO pisa el agua",
  `${cercado.ticksEnAgua} ticks sobre el agua; acabó en (${cercado.fin.x.toFixed(2)}, ${cercado.fin.z.toFixed(2)})`);

console.log("\n4 · EL CERCADO SIN CAMINO: SE PARA Y DEJA LA META AL MOTOR (QA de BO, H3)");
// Hasta la QA de BO aquí se afirmaba que el escape por caja «existe y se
// declara», y se declaraba sin ocurrir: el NPC metía un paso en la muralla,
// la salida de BL lo devolvía y así para siempre, andando en el sitio con la
// mirada temblando. Decisión del usuario: «que el estado le llegue al motor de
// narrativa y él decide». El que no tiene camino se para y suspende su meta
// (`suspended_goal`, `reason: "no_path"`), como el que huye.
const sinRuta = cercado.avisos.find((a) => a.includes("no encuentra ruta"));
ok(sinRuta !== undefined, "el cercado no tiene ruta y se dice", sinRuta?.slice(0, 140) ?? "sin aviso");
const g = cercado.data.suspended_goal;
ok(g?.reason === "no_path" && g?.field === "directive" && g?.value?.type === "goto_place",
  "y deja su meta al motor: `suspended_goal` con `reason: \"no_path\"` y la directiva tal cual",
  JSON.stringify(g));
ok(cercado.data.directive === null, "…la directiva sale del record: no la re-deriva solo", JSON.stringify(cercado.data.directive));
ok(cercado.moving === false, "…y se queda QUIETO, sin la animación de andar", `moving=${cercado.moving}`);
ok(cercado.avisos.filter((a) => a.includes("ATRAVIESA")).length === 0,
  "…sin anunciar un escape que no va a ocurrir", cercado.avisos.map((a) => a.slice(0, 80)).join(" | "));

// ────────────────────────────────────────────────────────────────────
console.log("\n5 · AL QUE LE CAE UNA CAJA ENCIMA NO SE LE ENCIERRA (consulta)");
const sEncima = tile();
elMotorPone(sEncima, "granero", 0, 0, 20, "building");        // 10 m, con el NPC dentro
const prov = createSimCollisionProvider(sEncima);
ok(prov.blocksCircle(0, 0, RADIO_NPC) === true, "el centro del granero está ocupado");
ok(prov.queImpideElPaso(0, 0, 1, 0, RADIO_NPC) === null,
  "desde el centro, alejarse no lo impide nadie (la penetración no crece)");
ok(prov.queImpideElPaso(1, 0, 0.5, 0, RADIO_NPC)?.de === "caja",
  "…y meterse más adentro sí, y dice que fue una caja");

// ────────────────────────────────────────────────────────────────────
console.log("\n6 · AL QUE LE CAE UNA CAJA ENCIMA SE LE SACA (sistema, no consulta)");
// El bloque 5 mide la CONSULTA; este mide al NPC. Aquí vivía el hallazgo de
// #583 H-2 —290 s de 300 dentro del carro— y hoy es aserto: la consulta nunca
// le frenó, es que nadie le empujaba hacia fuera.
const sDentro = tile();
const { sys: sysD } = simDeLaSesion(sDentro, { x: 14, z: 0 });
sysD.addNpc({
  id: "aldeano", type: "npc", scene_id: "tile_0_0", spawned_at: "2026-01-01T00:00:00.000Z",
  spawn_reason: "scene_init", spawn_event_id: "", position: [-12, 0, 0],
  data: { role: "villager", directive: { type: "goto_place", target_place_id: "plaza" } },
  asset_refs: [],
});
{
  const ctx = { playerPos: { x: 1000, y: 0, z: 1000 }, combatEvents: [], combatantPositions: new Map() };
  let puesta = false, ticksDentro = 0, saleEn = null;
  const warn = console.warn; const av = [];
  console.warn = (...a) => { av.push(a.map(String).join(" ")); };
  try {
    for (let i = 0; i < 300 / TICK; i++) {
      const st0 = sysD.states()[0];
      if (!puesta && st0.pos.x > -0.5) { elMotorPone(sDentro, "carro", 0, 0, 12); puesta = true; }
      sysD.tick(TICK, ctx);
      const st = sysD.states()[0];
      const dentro = Math.abs(st.pos.x) < 3.5 && Math.abs(st.pos.z) < 3.5;
      if (puesta && dentro) ticksDentro++;
      if (puesta && !dentro && saleEn === null) saleEn = ticksDentro * TICK;
    }
  } finally { console.warn = warn; }
  const st = sysD.states()[0];
  const fuera = Math.abs(st.pos.x) >= 3.5 || Math.abs(st.pos.z) >= 3.5;
  ok(saleEn !== null && saleEn < 30,
    "al NPC al que le cae el carro encima MIENTRAS lo cruza, el sim le SACA andando",
    saleEn === null
      ? `siguió dentro ${(ticksDentro * TICK).toFixed(0)} s de 300 — el steering solo sondea rumbos hacia su meta`
      : `salió en ${saleEn.toFixed(1)} s (por la cara más cercana)`);
  ok(fuera, "…y se queda fuera, no entrando y saliendo",
    `acabó en (${st.pos.x.toFixed(2)}, ${st.pos.z.toFixed(2)})`);
  ok(av.filter((a) => a.includes("ATRAVIESA")).length === 0,
    "sin atravesar nada: salir por la cara más cercana no es el escape",
    `${av.filter((a) => a.includes("DENTRO")).length} aviso(s) de salida declarados`);
}

// ────────────────────────────────────────────────────────────────────
/** Un NPC con `data` dada, dentro de un granero de 10 m que el motor puso en
 *  el origen, movido por el sim de la sesión. Devuelve cuándo salió y la
 *  traza de después. `antes` corre ANTES de poner el granero (el que ya llegó). */
function dentroDelGranero({ desde, data, meta = { x: 14, z: 0 }, antes = 0, segundos = 120 }) {
  const s = tile();
  const { sys } = simDeLaSesion(s, meta);
  sys.addNpc({
    id: "aldeano", type: "npc", scene_id: "tile_0_0", spawned_at: "2026-01-01T00:00:00.000Z",
    spawn_reason: "scene_init", spawn_event_id: "", position: [desde.x, 0, desde.z],
    data, asset_refs: [],
  });
  const ctx = { playerPos: { x: 1000, y: 0, z: 1000 }, combatEvents: [], combatantPositions: new Map() };
  const FUERA = 5 + RADIO_NPC;
  const fuera = (p) => Math.abs(p.x) >= FUERA || Math.abs(p.z) >= FUERA;
  const warn = console.warn; const av = [];
  console.warn = (...a) => { av.push(a.map(String).join(" ")); };
  let saleEn = null, salida = null, alejamiento = 0, reentra = false, llegadas = 0, dentroAlPonerla;
  try {
    for (let i = 0; i < antes / TICK; i++) {
      llegadas += sys.tick(TICK, ctx).filter((e) => e.type === "npc_reached_place").length;
    }
    elMotorPone(s, "granero", 0, 0, 20, "building");          // 10 m de lado
    dentroAlPonerla = !fuera(sys.states()[0].pos);
    for (let i = 1; i <= segundos / TICK; i++) {
      sys.tick(TICK, ctx);
      const p = sys.states()[0].pos;
      if (saleEn === null) {
        if (fuera(p)) { saleEn = i * TICK; salida = { x: p.x, z: p.z }; }
        continue;
      }
      alejamiento = Math.max(alejamiento, Math.hypot(p.x - salida.x, p.z - salida.z));
      if (!fuera(p)) reentra = true;
    }
  } finally { console.warn = warn; }
  const st = sys.states()[0];
  return { saleEn, alejamiento, reentra, llegadas, dentroAlPonerla, moving: st.moving, avisos: av };
}

console.log("\n7 · AL QUE NO VA A NINGÚN SITIO TAMBIÉN SE LE SACA (#618: era el tercer ⚠ HALLAZGO)");
{
  // Campesino: wander_radius 5 m, y media huella + radio = 5,5 m. Es el umbral
  // que medía el hallazgo: sus ocho waypoints caen dentro y nunca andaba.
  const r = dentroDelGranero({ desde: { x: 0, z: 0 }, data: { role: "peasant" } });
  ok(r.dentroAlPonerla, "CONTROL: el granero le cae encima");
  ok(r.saleEn !== null && r.saleEn < 10, "el campesino SIN directiva sale del granero",
    r.saleEn === null ? "no salió en 120 s" : `salió en ${r.saleEn.toFixed(1)} s`);
  ok(r.alejamiento > 1, "…y luego PASEA alrededor de donde salió, no se queda pegado a la cara",
    `se alejó ${r.alejamiento.toFixed(2)} m de su salida`);
  ok(!r.reentra, "…sin volver a meterse en el granero");
  ok(r.avisos.filter((a) => a.includes("ATRAVIESA")).length === 0, "sin atravesar nada");
}

console.log("\n8 · Y AL QUE TIENE `hold`");
{
  const r = dentroDelGranero({ desde: { x: 1, z: 0 }, data: { role: "villager", directive: { type: "hold" } }, segundos: 30 });
  ok(r.dentroAlPonerla, "CONTROL: el granero le cae encima");
  ok(r.saleEn !== null && r.saleEn < 10, "`hold` sale: es «no pasees», no «quédate emparedado»",
    r.saleEn === null ? "no salió en 30 s" : `salió en ${r.saleEn.toFixed(1)} s`);
  ok(!r.reentra && r.moving === false, "…y fuera obedece su `hold`: quieto",
    `moving=${r.moving}, alejamiento ${r.alejamiento.toFixed(2)} m`);
}

console.log("\n9 · Y AL QUE YA LLEGÓ A SU META CUANDO EL MOTOR LE PONE LA CAJA ENCIMA");
{
  const r = dentroDelGranero({
    desde: { x: -8, z: 0 }, meta: { x: 0, z: 0 }, antes: 15,
    data: { role: "villager", directive: { type: "goto_place", target_place_id: "plaza" } },
    segundos: 30,
  });
  ok(r.llegadas === 1, "CONTROL: llegó a la plaza antes de que cayera el granero", `${r.llegadas} llegada(s)`);
  ok(r.dentroAlPonerla, "CONTROL: y la plaza queda bajo el granero");
  ok(r.saleEn !== null && r.saleEn < 10, "llegado y con el granero encima, sale",
    r.saleEn === null ? "no salió en 30 s" : `salió en ${r.saleEn.toFixed(1)} s`);
}

console.log("\n10 · EL MISMO OBSTÁCULO SE RODEA IGUAL LO PONGA QUIEN LO PONGA (#618: eran dos ⚠ HALLAZGO)");

// El mismo obstáculo, mismo tamaño y MISMO CENTRO, puesto por las dos vías.
// Ojo al anclaje: `cell` es la ESQUINA de la huella, así que un `[12,12]` en
// cell [59,59] tiene su centro en (0.5, 0.5) — la primera versión de este
// bloque usaba cell [64,64], que lo centra en (3, 3), o sea medio cajón más
// allá, y el NPC lo esquivaba rozando su esquina sur. Con eso parecía que el
// tile se rodeaba y la caja no. No es la fuente: es dónde está el cajón.
const CENTRO = 0.5;
const sTile = new NarrativeState(new MemorySessionStorage());
sTile.startNewSession("qa583tile");
sTile.recordSceneLoaded("tile_0_0", expandScenePrimitives({
  tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", scene_description: "campo", biome: "grass",
  entities: [{ id: "granero", kind: "building", name: "granero", cell: [59, 59], footprint: [12, 12] }],
}));
const delTile = aldeanoVaA(sTile, { desde: { x: -12, z: CENTRO }, meta: { x: 14, z: CENTRO }, segundos: 300 });
const sRt = tile();
elMotorPone(sRt, "carro", CENTRO, CENTRO, 12);
const deRuntime = aldeanoVaA(sRt, { desde: { x: -12, z: CENTRO }, meta: { x: 14, z: CENTRO }, segundos: 300 });
ok(delTile.xMax >= 12.5 && delTile.llegadaEn !== null, "el cajón del TILE se rodea y se llega",
  `x máx ${delTile.xMax.toFixed(2)}, llegada ${delTile.llegadaEn?.toFixed(1) ?? "nunca"} s (antes: x máx −3,00)`);
ok(deRuntime.xMax >= 12.5 && deRuntime.llegadaEn !== null, "el carro de RUNTIME, igual",
  `x máx ${deRuntime.xMax.toFixed(2)}, llegada ${deRuntime.llegadaEn?.toFixed(1) ?? "nunca"} s (antes: x máx −3,00)`);
{
  const [a, b] = [delTile.llegadaEn ?? Infinity, deRuntime.llegadaEn ?? Infinity];
  ok(Math.abs(a - b) <= 0.1 * Math.min(a, b), "…en tiempos que no difieren más de un 10 %: una sola idea de sólido",
    `tile ${a.toFixed(2)} s · runtime ${b.toFixed(2)} s`);
}

console.log(`\n${rojos === 0 ? "✔ los diez bloques en verde" : `✖ ${rojos} aserto(s) en rojo`}`);
process.exit(rojos === 0 ? 0 : 1);
