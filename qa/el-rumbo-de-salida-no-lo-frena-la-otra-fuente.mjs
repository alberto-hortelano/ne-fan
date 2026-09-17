#!/usr/bin/env node
/** EL RUMBO DE SALIDA NO LO FRENA LA OTRA FUENTE — el candado de #643.
 *
 *  ## Qué es #643 y qué NO es
 *
 *  El proveedor de colisión del bridge mide la penetración con DOS cuentas que
 *  no se hablan: la del TILE (`salidaDelSolido` sobre el suelo de los tiles
 *  tocados) y la de las CAJAS de runtime (`salidaDeCaja`, aritmética de
 *  rectángulo). `porDondeSalirDeAqui` pregunta primero al tile y, solo si
 *  calla, a las cajas; `queImpideElPaso` hace lo mismo con la regla de paso.
 *  Para un cuerpo metido en las DOS a la vez eso significa que **el rumbo que
 *  una promete como salida más corta lo puede frenar la otra**.
 *
 *  Lo que el issue IMPLICA y es FALSO —medido por la crítica de la tanda I—:
 *  que de ahí no se salga. Se sale: 357 de 357 arranques de NPC salen del tile
 *  (el peor en 6,27 s, ninguno usando el escape de #583) y 1.070 de 1.070
 *  arranques de jugador tienen rumbo que saca. Por eso este guion **NO afirma
 *  que nadie se quede encerrado**: eso nace VERDE, y un candado que nace verde
 *  no es un candado, es un adorno que alguien leerá como garantía.
 *
 *  Lo que afirma es lo que hoy está roto: **el rumbo que devuelve
 *  `porDondeSalirDeAqui` no lo frena ninguna fuente**. Hoy sale ROJO, y por eso
 *  el número va CONGELADO en `TECHO_643` en vez de exigirse 0: la decisión del
 *  usuario (2026-09-17) es candar #643 sin tocar la geometría, así que el issue
 *  sigue abierto y lo que este guion impide es que el defecto **crezca** o que
 *  alguien lo arregle a medias sin enterarse.
 *
 *  ## Por qué el paso es ese y no otro
 *
 *  No es un paso inventado: es literalmente el de producción. `npc-behavior.ts`
 *  (:678-688 y :755) pide `porDondeSalirDeAqui`, usa su `dir` tal cual, avanza
 *  `walk_speed × delta` y prueba la deflexión 0 la PRIMERA con
 *  `queImpideElPaso(…, NPC_RADIUS_M)`. `walk_speed` del aldeano es 1,2 m/s
 *  (`src/simulation/npc-roles.ts:69`) y el sim corre a 60 Hz, así que el paso
 *  son 0,02 m. Cuando ese `queImpideElPaso` no devuelve `null`, el NPC NO va
 *  por donde le dijeron que saliera: prueba las otras siete deflexiones.
 *
 *  ## Qué monta, y de dónde sale cada pieza
 *
 *  El proveedor de PRODUCCIÓN (`createSimCollisionProvider`, `bridge/
 *  sim-collision.js`) sobre las fixtures commiteadas `robledo_tile` y
 *  `puerto_tile`, con una caja de runtime por `building` puesta a caballo de su
 *  cara +X por la puerta real (`recordEntitySpawned` con
 *  `spawn_reason: "narrative_request"`, igual que `consequence-handler.ts:142`).
 *  Nada compuesto a mano: así es exactamente como nació torcido el candado de
 *  la tanda G, midiendo un mundo un 40 % menos sólido que el que instala el
 *  cliente.
 *
 *  TODO LO QUE SE MIDE SE MIDE CON EL PROVEEDOR COMPUESTO, el de producción
 *  (`provAmbas`): de él sale el rumbo y de él sale el veredicto del paso. Para
 *  CLASIFICAR cada punto en una de las tres poblaciones hacen falta las dos
 *  mitades por separado, y son las mismas dos que compone `ocupado`
 *  (`sim-collision.ts:275-278`), no una reconstrucción:
 *    · dentro del TILE  — `provTile`, la misma sesión SIN spawns.
 *    · dentro de una CAJA — `cajaQueContiene(…, cajasDeRuntime(entities))`, las
 *      funciones de core que usa el propio proveedor.
 *
 *  AQUÍ HUBO UN INTENTO PEOR Y VALE LA PENA QUE QUEDE ESCRITO: la primera
 *  versión clasificaba «dentro de una caja» con un tercer proveedor montado
 *  sobre un tile SINTÉTICO al que se le vaciaban `entities`, `volumes` y
 *  `ground`. Ese tile NO estaba vacío —`vegetation_zones` sigue derivando
 *  volúmenes del plan compuesto—, así que 294 puntos de bosque entraban como
 *  «solo una caja» y el control medía otro mundo. Es el defecto de la tanda G
 *  en pequeño, y lo cazó el aserto de que a todo punto ocupado se le contesta
 *  por dónde salir.
 *
 *  Y se comprueba que las tres poblaciones son EXACTAMENTE los puntos ocupados
 *  del proveedor compuesto: si `ocupado` dijera que sí donde la clasificación
 *  dice que no, habría una población sin mirar — la forma favorita de esta casa
 *  de cubrir menos de lo que promete un nombre.
 *
 *  ## Contrato de salida (es un CANDADO)
 *
 *    0  estando dentro de UNA sola de las dos geometrías ningún rumbo se frena,
 *       hay cuerpos metidos en las dos, y los que se frenan estando en las dos
 *       son exactamente TECHO_643
 *    1  o el defecto CRECIÓ, o alguien lo arregló (enhorabuena: baja el techo
 *       en el mismo diff y cierra #643), o el control dejó de medir — si los
 *       puntos «dentro de las dos» salen 0, mirar eso ANTES que nada
 *    2  no se pudo medir (falta `nefan-core/dist`)
 *
 *  ## Probado en negativo, un sabotaje por vez
 *
 *    QA_643_SIN_CAJAS=1   no pone las cajas de runtime → no hay cuerpo dentro
 *                         de las dos, el bloque 3 baja a 0 y el 2 se cae:
 *                         prueba que el número lo CAUSA la composición.
 *    QA_643_CAJA_MAYOR=1  dos celdas más de caja por edificio → el número SUBE,
 *                         medido **212 → 232**: prueba que se entera de que el
 *                         defecto empeore. Son DOS celdas y no una por un
 *                         motivo que conviene saber: con una sola la caja crece
 *                         0,25 m por lado, y como la malla va por centros de
 *                         celda ningún punto cambia de bando — el número se
 *                         quedaba en 212 y el sabotaje no probaba nada de lo
 *                         que dice probar. La resolución de la malla es parte
 *                         del instrumento, no un detalle.
 *
 *  Sin navegador, sin stack y sin créditos: `nefan-core/dist`, las fixtures del
 *  árbol y aritmética. Corre en el job `candados-headless`.
 *
 *  Uso: `node qa/el-rumbo-de-salida-no-lo-frena-la-otra-fuente.mjs`
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
    cajasDeRuntime: (await import(`${DIST}/src/simulation/cajas-de-runtime.js`)).cajasDeRuntime,
    cajaQueContiene: (await import(`${DIST}/src/simulation/cajas-de-runtime.js`)).cajaQueContiene,
    NPC_RADIUS_M: (await import(`${DIST}/src/scene/terrain-collision.js`)).NPC_RADIUS_M,
    TILE_MPC: (await import(`${DIST}/src/scene/tile.js`)).TILE_MPC,
  };
} catch (err) {
  console.error(`No se pudo leer nefan-core/dist: ${err?.message ?? err}`);
  console.error("Compila primero: cd nefan-core && npm run build");
  process.exit(2);
}
const {
  NarrativeState, MemorySessionStorage, expandScenePrimitives, createSimCollisionProvider,
  cajasDeRuntime, cajaQueContiene, NPC_RADIUS_M, TILE_MPC,
} = mod;

const SIN_CAJAS = process.env.QA_643_SIN_CAJAS === "1";
const CAJA_MAYOR = process.env.QA_643_CAJA_MAYOR === "1";

const FIXTURES = ["robledo_tile", "puerto_tile"];
/** El paso de UN tick del NPC: `walk_speed` 1,2 m/s a 60 Hz (npc-roles.ts:69). */
const PASO_M = 1.2 / 60;
/** La malla del barrido, en metros. Media celda del tile. */
const MALLA_M = TILE_MPC;
/** Grosor de la caja en celdas: 6 celdas = 3 m, la mitad dentro del edificio y
 *  la mitad fuera, que es lo que hace falta para estar en las DOS a la vez. */
const CAJA_CELDAS_X = 6;

/** CUÁNTOS RUMBOS DE SALIDA FRENA LA OTRA FUENTE, HOY.
 *
 *  Congelado el 2026-09-17 sobre `robledo_tile` + `puerto_tile` con las cajas
 *  de arriba. **No es un objetivo: es el tamaño de un defecto VIVO** (#643, sin
 *  arreglar por decisión del usuario). Se exige EXACTO en los dos sentidos
 *  porque el mundo es determinista: la PR que lo mejore tiene que bajarlo en su
 *  propio diff, y la que lo empeore no pasa. Si algún día no casa entre
 *  máquinas, eso es un hallazgo —la geometría del bridge no sería
 *  reproducible— y se abre issue con el delta, no se relaja a `<=` en silencio. */
const TECHO_643 = 212;

const fixtureCruda = (f) =>
  JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/scenes", `${f}.json`), "utf8"));

const edificiosDe = (fixture) => fixtureCruda(fixture).entities.filter((e) => e.kind === "building");

/** El rectángulo de mundo de una entity, desde su `cell` + `footprint`. El tile
 *  va centrado en el origen, así que mundo = −32 + celda·0,5. */
function rectDe(entity, tile) {
  const x0 = tile.tx * 64 - 32 + entity.cell[0] * TILE_MPC;
  const z0 = tile.ty * 64 - 32 + entity.cell[1] * TILE_MPC;
  return {
    x0, z0,
    x1: x0 + entity.footprint[0] * TILE_MPC,
    z1: z0 + entity.footprint[1] * TILE_MPC,
  };
}

/** UNA SESIÓN con la fixture cargada como tile, y opcionalmente las cajas.
 *
 *  La escena se registra bajo `tile_0_0` (la clave de tile) y no bajo el nombre
 *  de la fixture porque el proveedor busca los colliders por CLAVE DE TILE: con
 *  otro nombre no encuentra ninguno y el mundo entero sale libre, o sea el
 *  guion mediría aire y no podría ponerse rojo nunca. */
function sesion(fixture, { conCajas = true } = {}) {
  const crudo = fixtureCruda(fixture);
  const narrative = new NarrativeState(new MemorySessionStorage());
  narrative.startNewSession("qa643");
  narrative.recordSceneLoaded("tile_0_0", expandScenePrimitives(crudo));

  if (conCajas && !SIN_CAJAS) {
    for (const entity of edificiosDe(fixture)) {
      const r = rectDe(entity, crudo.tile);
      const celdasZ = entity.footprint[1] + (CAJA_MAYOR ? 2 : 0);
      const celdasX = CAJA_CELDAS_X + (CAJA_MAYOR ? 2 : 0);
      // A caballo de la cara +X: el centro de la caja ES la cara, así que la
      // mitad cae dentro del edificio (las dos geometrías) y la mitad fuera.
      narrative.recordEntitySpawned(
        `caja_${entity.id}`, "object", "tile_0_0",
        { x: r.x1, y: 0, z: (r.z0 + r.z1) / 2 },
        { name: `carro junto a ${entity.name ?? entity.id}`, footprint: [celdasX, celdasZ] },
        "narrative_request", `ev_${entity.id}`,
      );
    }
  }
  return narrative;
}

let rojos = 0;
const ok = (cond, linea, detalle = "") => {
  console.log(`  ${cond ? "✔" : "✖"} ${linea}${detalle ? ` — ${detalle}` : ""}`);
  if (!cond) rojos++;
};

console.log("\nEL RUMBO DE SALIDA NO LO FRENA LA OTRA FUENTE (#643) — candado del defecto VIVO");
console.log(`    (fixtures: ${FIXTURES.join(", ")} · malla ${MALLA_M} m · paso ${PASO_M.toFixed(4)} m · radio NPC ${NPC_RADIUS_M} m)`);
if (SIN_CAJAS) console.log("    SABOTAJE QA_643_SIN_CAJAS: no se ponen las cajas de runtime");
if (CAJA_MAYOR) console.log("    SABOTAJE QA_643_CAJA_MAYOR: dos celdas más de caja por edificio");

const mundos = FIXTURES.map((f) => {
  const provTile = createSimCollisionProvider(sesion(f, { conCajas: false }));
  const conCajas = sesion(f);
  const provAmbas = createSimCollisionProvider(conCajas);
  const cajas = cajasDeRuntime(conCajas.entities);
  return { f, provTile, provAmbas, cajas };
});

// ── Las tres poblaciones, clasificadas una sola vez ─────────────────────────

const POBLACIONES = ["solo el tile", "solo una caja", "las DOS"];

/** Clasifica cada punto de la malla y mide, SIEMPRE con el proveedor compuesto,
 *  cuántos rumbos de salida se frenan en cada población. */
function medir({ provTile, provAmbas, cajas }) {
  const r = {
    "solo el tile": { n: 0, frenados: 0, sinRumbo: 0, atribucion: new Map() },
    "solo una caja": { n: 0, frenados: 0, sinRumbo: 0, atribucion: new Map() },
    "las DOS": { n: 0, frenados: 0, sinRumbo: 0, atribucion: new Map() },
    sinClasificar: 0,
    desacuerdoConOcupado: 0,
  };
  const media = 64 / 2;
  for (let x = -media + MALLA_M / 2; x < media; x += MALLA_M) {
    for (let z = -media + MALLA_M / 2; z < media; z += MALLA_M) {
      const enTile = provTile.ocupado(x, z, NPC_RADIUS_M);
      const enCaja = cajaQueContiene(x, z, NPC_RADIUS_M, cajas) !== null;
      // Totalidad: la clasificación tiene que ser EXACTAMENTE lo que compone
      // `ocupado`. Si no, hay puntos que este barrido no mira.
      if ((enTile || enCaja) !== provAmbas.ocupado(x, z, NPC_RADIUS_M)) r.desacuerdoConOcupado++;
      if (!enTile && !enCaja) {
        if (provAmbas.ocupado(x, z, NPC_RADIUS_M)) r.sinClasificar++;
        continue;
      }
      const pob = enTile && enCaja ? "las DOS" : enTile ? "solo el tile" : "solo una caja";
      const celda = r[pob];
      celda.n++;
      const salida = provAmbas.porDondeSalirDeAqui(x, z, NPC_RADIUS_M);
      if (!salida) { celda.sinRumbo++; continue; }
      const nx = x + salida.dir.x * PASO_M;
      const nz = z + salida.dir.z * PASO_M;
      const imp = provAmbas.queImpideElPaso(x, z, nx, nz, NPC_RADIUS_M);
      if (imp === null) continue;
      celda.frenados++;
      const clave = `salida:${salida.de} → frena:${imp.de}`;
      celda.atribucion.set(clave, (celda.atribucion.get(clave) ?? 0) + 1);
    }
  }
  return r;
}

const medidas = mundos.map((m) => ({ ...m, r: medir(m) }));

// ── 1 · CONTROL: dentro de UNA sola geometría, ningún rumbo se frena ─────────

// NO es un teorema del diseño, y por eso vale como control: es una propiedad
// de ESTA configuración, y se puede romper. Medido: con las cajas UNA celda más
// grandes, 20 puntos que solo están dentro del tile ven su rumbo frenado por una
// caja vecina. O sea que si este bloque se pone rojo algún día, la lectura no es
// «el guion está roto» sino «#643 tiene una segunda cara: se frena también
// estando en una sola» — y eso se apunta en el issue, no se silencia.
console.log("\n1 · CONTROL — dentro de UNA sola de las dos, el rumbo de salida nunca se frena");
for (const { f, r } of medidas) {
  for (const pob of ["solo el tile", "solo una caja"]) {
    ok(r[pob].frenados === 0, `${f}: ${pob}`, `${r[pob].frenados} de ${r[pob].n} puntos frenados`);
  }
  ok(r.sinClasificar === 0, `${f}: no hay población sin mirar`,
    `${r.sinClasificar} puntos ocupados que no caen en ninguna de las tres`);
  ok(r.desacuerdoConOcupado === 0, `${f}: la clasificación ES lo que compone \`ocupado\``,
    `${r.desacuerdoConOcupado} desacuerdos`);
  const mudos = POBLACIONES.reduce((a, p) => a + r[p].sinRumbo, 0);
  ok(mudos === 0, `${f}: a todo punto ocupado se le contesta por dónde salir`, `${mudos} sin rumbo`);
}

// ── 2 · CONTROL: hay algo que medir ─────────────────────────────────────────

console.log("\n2 · CONTROL — hay cuerpos metidos en las DOS geometrías a la vez");
let enLasDosTotal = 0;
for (const { f, r } of medidas) {
  enLasDosTotal += r["las DOS"].n;
  ok(r["las DOS"].n > 0, `${f}: puntos dentro del tile Y de una caja`, `${r["las DOS"].n}`);
}

// ── 3 · EL DEFECTO, CONGELADO ───────────────────────────────────────────────

console.log("\n3 · EL DEFECTO — estando en las DOS, cuántos rumbos de salida se frenan");
let frenadosTotal = 0;
const atribucionTotal = new Map();
for (const { f, r } of medidas) {
  const c = r["las DOS"];
  frenadosTotal += c.frenados;
  for (const [k, v] of c.atribucion) atribucionTotal.set(k, (atribucionTotal.get(k) ?? 0) + v);
  const pct = c.n ? ((c.frenados / c.n) * 100).toFixed(1) : "—";
  console.log(`    ${f}: ${c.frenados} de ${c.n} puntos (${pct} %)`);
}
console.log("    atribución (de quién es el rumbo → quién lo frena):");
for (const [k, v] of [...atribucionTotal].sort()) {
  // La dirección `salida:caja → frena:tile` es la GRAVE —el escape del
  // encajonado (#583) atraviesa cajas y NUNCA un muro, así que ahí el cuerpo
  // se queda sin salida de emergencia—, y hoy sale 0 por ORDEN, no por suerte:
  // `porDondeSalirDeAqui` pregunta al tile primero, así que a quien está en las
  // dos le contesta siempre el tile. Se imprime igualmente: el día que el orden
  // cambie, este desglose es quien lo dice.
  console.log(`      ${k}: ${v}${k.endsWith("frena:tile") ? "   ← sin escape de #583" : ""}`);
}

ok(
  frenadosTotal === TECHO_643,
  `el defecto mide exactamente lo congelado`,
  `${frenadosTotal} rumbos frenados, TECHO_643 = ${TECHO_643}` +
    (frenadosTotal > TECHO_643 ? " — CRECIÓ: algo empeoró la composición de las dos fuentes"
      : frenadosTotal < TECHO_643 ? " — BAJÓ: si es a propósito, baja TECHO_643 en este mismo diff (y si llegó a 0, cierra #643)"
        : ""),
);

console.log(
  `\n${rojos === 0 ? "✔" : "✖"} ${rojos === 0 ? "el defecto de #643 sigue del tamaño medido" : `${rojos} rojos`} ` +
    `· ${enLasDosTotal} puntos en las dos geometrías · ${frenadosTotal} rumbos frenados`,
);
process.exit(rojos === 0 ? 0 : 1);
