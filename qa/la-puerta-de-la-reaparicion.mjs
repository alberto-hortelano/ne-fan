#!/usr/bin/env node
/** LA PUERTA DE LA REAPARICIÓN — que no vuelva a entrar una consulta de
 *  MOVIMIENTO donde hacía falta una de PUNTO, y que retirarla no movió a nadie.
 *
 *  ## De dónde sale
 *
 *  Del QA de la PR 3 de la tanda E (#538, 2026-09-16), que borró de
 *  `puntoDeReaparicion` la rama que preguntaba por sólidos —y la que colgaba
 *  de su `else`— por RAMA MUERTA: el único llamante le pasaba `collidesAt`,
 *  que no es «¿es
 *  sólido este PUNTO?» sino «¿puedo MOVERME de donde estoy hasta ahí?», y
 *  preguntada por la posición del propio cadáver no dice «sólido».
 *
 *  La PR dejó esa puerta candada con un aserto de ARIDAD
 *  (`puntoDeReaparicion.length === 1`, `test/reaparicion.test.ts`). Este
 *  fichero existe porque ese aserto **cubre menos de lo que su nombre
 *  promete**: `Function.length` deja de contar en el primer parámetro con
 *  valor por defecto, así que la forma MÁS probable de que la consulta vuelva
 *  —añadirla como opcional, que es como se añade un parámetro sin tocar al
 *  llamante— pasa por delante del candado con `npm run verify` en verde.
 *  Medido el 2026-09-16: 2847/2847 tests verdes con la consulta recableada.
 *
 *  ## Qué afirma
 *
 *   1. **LA PUERTA**: `puntoDeReaparicion` tiene aridad 1 **y además ignora
 *      cualquier argumento de más** — se le pasa un espía de solidez que grita
 *      «sólido» y un rect, y ni se le llama ni cambia el punto devuelto. Lo
 *      segundo es lo que la aridad sola no ve.
 *   2. **LA RETIRADA NO MUEVE A NADIE**: sobre las TRES fixtures de
 *      `data/scenes/` —el mundo real que pinta el selector «Room»— y con las
 *      tres fuentes de solidez del cliente montadas como las monta
 *      `world/collision.ts`, la pregunta que hacía el escalón retirado
 *      (`collidesAt(pos)` **con el jugador EN `pos`**) vale `false` en todos
 *      los puntos de una malla de 0,5 m. Cada uno de esos puntos es un
 *      veredicto IDÉNTICO entre la función de ayer y la de hoy. Desde #616 lo
 *      es por CONSTRUCCIÓN y no por casualidad de los datos —la regla compara
 *      la penetración del destino con la del origen, y consigo mismo son el
 *      mismo número—, así que el bloque 2 mide hoy MENOS de lo que medía: es
 *      el control (3) el que sigue demostrando que hay mundo debajo.
 *   3. **CONTROL**: los MISMOS puntos, preguntados desde otro sitio, sí
 *      dan sólido en unos cuantos. Sin él, el punto 2 saldría igual de verde
 *      sobre un mundo de aire, que es medir nada.
 *
 *  Y una cosa que MIDE: la TANGENCIA EXACTA (el cuerpo del jugador tocando el
 *  borde de una celda sólida sin solaparla en abierto), que era el ÚNICO caso
 *  en que la respuesta no era `false` con origen = destino. **Ya no lo es**:
 *  #616 (tanda G, 2026-09-17) se llevó la regla de paso al núcleo
 *  (`simulation/salida-del-solido.ts`, penetración no creciente sobre el
 *  solape abierto), y ahí `pen(p) > pen(p)` es falso sin excepción. El bloque
 *  sigue aquí, y ahora AFIRMA las dos mitades: que el caso desapareció y que
 *  las dos convenciones de solape —la abierta y la cerrada de `blocksCircle`,
 *  que sujeta el tope de footprint de #300— siguen distinguiéndose. Si
 *  colapsaran, este bloque saldría verde midiendo una sola.
 *
 *  ## Contrato de salida (es un CANDADO)
 *
 *    0  la puerta sigue cerrada y la retirada sigue sin mover a nadie
 *    1  o volvió a entrar una consulta del mundo, o hay puntos en los que la
 *       pregunta del escalón retirado ya NO vale `false` (que sería la buena
 *       noticia de que el cliente tiene por fin una consulta de PUNTO: lo que
 *       toca entonces es volver a decidir la reaparición —H10 de #538—, no
 *       tocar este fichero), o el control dejó de medir.
 *
 *  ## Probado en negativo, y se puede volver a probar
 *
 *    QA_PUERTA_ABIERTA=1 node qa/la-puerta-de-la-reaparicion.mjs
 *      mete la consulta de vuelta EXACTAMENTE como el aserto de aridad la deja
 *      entrar (segundo parámetro con valor por defecto) → **bloque 1 rojo,
 *      exit 1**, y `length` sigue valiendo 1, que es el hallazgo.
 *    QA_SIN_SOLIDOS=1 node qa/la-puerta-de-la-reaparicion.mjs
 *      deja el mundo sin una sola fuente de solidez —las CUATRO: grid del
 *      terreno, grid del plan, cajas y frontera del plano— → **el CONTROL
 *      rojo, exit 1**. Es la prueba de que el bloque 2 no sale verde por no
 *      medir. Apagar solo las tres primeras NO lo ponía rojo (3.072 puntos del
 *      borde seguían saliendo sólidos por la frontera): lo cazó este mismo
 *      negativo, que es para lo que está.
 *
 *  Sin navegador, sin stack y sin créditos: son `nefan-core/dist`, las
 *  fixtures del árbol y aritmética. Candidato al job `candados-headless`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { puntoDeReaparicion } from "../nefan-core/dist/src/simulation/reaparicion.js";
import { aabbBloquea, fronteraBloquea } from "../nefan-core/dist/src/simulation/obstaculos-del-jugador.js";
import { solidoBloquea } from "../nefan-core/dist/src/simulation/salida-del-solido.js";
import { createTerrainCollider, PLAYER_RADIUS_M } from "../nefan-core/dist/src/scene/terrain-collision.js";
import { formatDToWorld } from "../nefan-core/dist/src/scene/scene-normalize.js";
import { planCollisionGrid } from "../nefan-core/dist/src/scene/blueprint/plan-collision.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = ["robledo_tile", "puerto_tile", "zorder_test"];
const PASO_M = 0.5;
const PUERTA_ABIERTA = process.env.QA_PUERTA_ABIERTA === "1";
const SIN_SOLIDOS = process.env.QA_SIN_SOLIDOS === "1";

const fallos = [];
const ok = (linea) => console.log(`  ✔ ${linea}`);
const mal = (linea, detalle) => {
  console.log(`  ✖ ${linea}\n      ${detalle}`);
  fallos.push(linea);
};

// ── 1 · La puerta ────────────────────────────────────────────────────────────

/** El sabotaje de `QA_PUERTA_ABIERTA`: la consulta de vuelta por la única
 *  rendija que el aserto de aridad no tapa. NO toca el árbol — es la forma
 *  exacta que tendría el fichero saboteado, escrita aquí. */
function conLaPuertaAbierta(pos, solido = () => false) {
  if (solido(pos.x, pos.z)) return { x: 0, y: 0, z: 2 };
  return { x: pos.x, y: 0, z: pos.z };
}
const bajoPrueba = PUERTA_ABIERTA ? conLaPuertaAbierta : puntoDeReaparicion;

console.log("1 · LA PUERTA: la reaparición no recibe ninguna consulta del mundo");
console.log(`    (función bajo prueba: ${PUERTA_ABIERTA ? "el SABOTAJE (parámetro con valor por defecto)" : "la del árbol"})`);

if (bajoPrueba.length === 1) ok(`aridad 1 (\`length\` = ${bajoPrueba.length})`);
else mal("aridad 1", `\`length\` = ${bajoPrueba.length}: alguien le volvió a dar parámetros obligatorios`);

let espiada = 0;
const espia = (x, z) => {
  espiada++;
  return true; // grita «sólido» para que usarla se NOTE en el punto devuelto
};
const cadaver = { x: 12.5, z: -7.25 };
const RECT_DE_OTRO_SITIO = { minX: 32, minZ: 32, maxX: 96, maxZ: 96 };
const devuelto = bajoPrueba(cadaver, espia, RECT_DE_OTRO_SITIO);

if (espiada === 0) ok("un argumento de más NO se llama: la consulta de solidez no tiene por dónde entrar");
else
  mal(
    "un argumento de más NO se llama",
    `la consulta entró y se llamó ${espiada} vez/veces. La aridad sigue diciendo ${bajoPrueba.length}, ` +
      "porque `Function.length` no cuenta los parámetros con valor por defecto: por eso el aserto de " +
      "aridad no basta como puerta.",
  );

if (devuelto.x === cadaver.x && devuelto.z === cadaver.z && devuelto.y === 0) {
  ok(`y el punto devuelto sigue siendo el del cadáver (${devuelto.x}, ${devuelto.y}, ${devuelto.z})`);
} else {
  mal(
    "el punto devuelto sigue siendo el del cadáver",
    `cayó en (${cadaver.x}, ${cadaver.z}) y devolvió (${devuelto.x}, ${devuelto.y}, ${devuelto.z}): ` +
      "algo de fuera del punto está decidiendo dónde reaparece el jugador",
  );
}

// ── 2 y 3 · La pregunta del escalón retirado, sobre el mundo de verdad ───────

/** Las TRES fuentes de `CollisionSystem.collidesAt` (`nefan-html/src/world/
 *  collision.ts:74-84`), montadas igual: frontera del plano, los dos colliders
 *  del tile (grid del terreno y grid derivado del plan) y las cajas. */
function mundoDeLaFixture(nombre, planAplicado) {
  const crudo = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/scenes", `${nombre}.json`), "utf8"));
  const w = formatDToWorld(crudo);
  const rect = w.world_rect;

  // El plan COMPUESTO (`__plan`), que es el que el cliente instala
  // (`world/carga-de-tile.ts:335`). Con los `volumes` DECLARADOS del crudo este
  // control medía un mundo un 40 % menos sólido: robledo y puerto declaran cero
  // y derivan del esquema sus 38 y 23 volúmenes (960 celdas de 1.608 y 2.144 de
  // 3.072). Corregido con #616, al ir a verificar una cifra que se citaba.
  const gridDelPlan = planCollisionGrid(w.__plan?.ground, w.__plan?.volumes, rect);
  const colliderTerreno = SIN_SOLIDOS ? null : createTerrainCollider(w.terrain_grid);
  const colliderPlan = SIN_SOLIDOS || !gridDelPlan ? null : createTerrainCollider(gridDelPlan);

  // Las cajas de los objetos de la escena, como las monta el cliente
  // (`world/carga-de-tile.ts`): son del TILE, así que `planAplicadoEn` decide
  // si se aplican o si manda el plan. Se mide con las dos políticas.
  const objetos = SIN_SOLIDOS
    ? []
    : w.objects.map((o) => ({
        pos: { x: o.position[0], z: o.position[2] },
        sizeXZ: { x: o.scale[0], z: o.scale[2] },
        category: o.category,
        dueno: { de: "tile", key: "0,0" },
      }));

  // Un tile SOLO, con los ocho vecinos ausentes: es el mundo más sólido que
  // puede haber (la frontera del plano rodea al jugador por los cuatro lados).
  const tiles = {
    // `QA_SIN_SOLIDOS` la apaga también: la frontera es la TERCERA fuente, y
    // sin apagarla el control seguía contando los puntos del borde y no podía
    // ponerse rojo — un control que no puede fallar no es un control.
    hayGrid: !SIN_SOLIDOS,
    tocados: (x, z, r) => {
      const claves = new Set();
      for (const dx of [-r, r]) {
        for (const dz of [-r, r]) {
          claves.add(`${Math.floor((x + dx - rect.minX) / 64)},${Math.floor((z + dz - rect.minZ) / 64)}`);
        }
      }
      return [...claves].map((k) => {
        const [tx, ty] = k.split(",").map(Number);
        return { tx, ty };
      });
    },
    tiene: (tx, ty) => tx === 0 && ty === 0,
    planAplicadoEn: () => planAplicado,
  };

  // El SUELO tal y como lo monta `world/collision.ts`: los dos colliders del
  // tile unidos en UNA consulta de punto, que es lo que consume la regla de
  // core. Se conserva la distinción terreno/plan para el mensaje del
  // contraejemplo — preguntando a cada uno por separado, no partiendo la regla.
  const ocupadoEn = (collider) => (x, z, r) => Boolean(collider?.solapaSolido(x, z, r));
  const sueloTerreno = { ocupado: ocupadoEn(colliderTerreno) };
  const sueloPlan = { ocupado: ocupadoEn(colliderPlan) };

  const collidesAt = (desde, hasta) => {
    if (fronteraBloquea(desde, hasta, PLAYER_RADIUS_M, tiles)) return "frontera";
    if (solidoBloquea(desde, hasta, PLAYER_RADIUS_M, sueloTerreno)) return "terreno";
    if (solidoBloquea(desde, hasta, PLAYER_RADIUS_M, sueloPlan)) return "plan";
    if (aabbBloquea(desde, hasta, PLAYER_RADIUS_M, objetos, tiles)) return "caja";
    return null;
  };

  return { rect, collidesAt, objetos, start: w.__player_start };
}

console.log("");
console.log("2 · LA RETIRADA NO MUEVE A NADIE: `collidesAt(pos)` con el jugador EN `pos`, sobre las tres fixtures");

let puntosTotales = 0;
let solidosConsigoMismo = 0;
let solidosDesdeElCentro = 0;
const contraejemplos = [];

for (const nombre of FIXTURES) {
  for (const planAplicado of [true, false]) {
    const { rect, collidesAt, objetos, start } = mundoDeLaFixture(nombre, planAplicado);
    const centro = { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };

    // La malla, más los puntos que el juego produce de verdad: el arranque del
    // jugador y el centro de cada objeto con huella (donde más probable es que
    // un cadáver quede dentro de algo).
    const puntos = [];
    for (let z = rect.minZ; z <= rect.maxZ; z += PASO_M) {
      for (let x = rect.minX; x <= rect.maxX; x += PASO_M) puntos.push({ x, z });
    }
    if (start) puntos.push({ x: start.x, z: start.z });
    for (const o of objetos) puntos.push({ x: o.pos.x, z: o.pos.z });

    let solidosAqui = 0;
    let desdeElCentroAqui = 0;
    for (const p of puntos) {
      puntosTotales++;
      const consigoMismo = collidesAt(p, p);
      if (consigoMismo !== null) {
        solidosConsigoMismo++;
        solidosAqui++;
        if (contraejemplos.length < 5) contraejemplos.push(`${nombre} (plan ${planAplicado}): (${p.x}, ${p.z}) → ${consigoMismo}`);
      }
      if (collidesAt(centro, p) !== null) {
        solidosDesdeElCentro++;
        desdeElCentroAqui++;
      }
    }
    console.log(
      `    ${nombre.padEnd(13)} plan ${String(planAplicado).padEnd(5)} · ${String(puntos.length).padStart(5)} puntos · ` +
        `consigo mismo sólidos: ${solidosAqui} · desde otro sitio: ${desdeElCentroAqui}`,
    );
  }
}

if (solidosConsigoMismo === 0) {
  ok(
    `${puntosTotales} puntos y NINGUNO se ve sólido a sí mismo: el escalón retirado no se alcanzaba, ` +
      "y la función de ayer y la de hoy dan el mismo punto en los " + puntosTotales,
  );
} else {
  mal(
    "ningún punto se ve sólido a sí mismo",
    `${solidosConsigoMismo} de ${puntosTotales} sí. Los primeros:\n      ` + contraejemplos.join("\n      "),
  );
}

console.log("");
console.log("3 · CONTROL: los mismos puntos, preguntados desde otro sitio del tile");
if (solidosDesdeElCentro > 0) {
  ok(
    `${solidosDesdeElCentro} de ${puntosTotales} SÍ dan sólido vistos desde otro sitio ` +
      `(${((solidosDesdeElCentro / puntosTotales) * 100).toFixed(1)} %): hay mundo con el que medir`,
  );
} else {
  mal("hay mundo con el que medir", "ni un solo punto da sólido desde fuera: el bloque 2 no está midiendo nada");
}

// ── El caso que el absoluto no cubre, MEDIDO ────────────────────────────────

console.log("");
console.log("· medido, no afirmado: la TANGENCIA EXACTA, que era el único origen=destino que bloqueaba");
const rejilla = {
  grid: Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => (r >= 4 && c >= 4 ? "w" : ".")).join("")),
  cols: 8,
  rows: 8,
  meters_per_cell: 0.5,
  origin: [0, 0],
  solid_chars: ["w"],
};
const col = createTerrainCollider(rejilla);
const tangente = { x: 4 * 0.5 - PLAYER_RADIUS_M, z: 4 * 0.5 + 0.25 }; // x + radio == borde exacto
const sueloTangente = { ocupado: (x, z, r) => col.solapaSolido(x, z, r) };
const bloqueaTangente = solidoBloquea(tangente, tangente, PLAYER_RADIUS_M, sueloTangente);
const laVeCerrada = col.blocksCircle(tangente.x, tangente.z, PLAYER_RADIUS_M);
console.log(
  `    tangencia exacta (x + ${PLAYER_RADIUS_M} justo en el borde de una celda sólida): ` +
    `paso(origen = destino) = ${bloqueaTangente} · la consulta CERRADA la sigue viendo sólida = ${laVeCerrada}`,
);
console.log(
  "    ESE CASO YA NO EXISTE, y es la noticia de esta corrida: hasta #616 la regla del terreno vivía dentro\n" +
    "    del collider y su exención («celda que ya solapabas») usaba un solape ABIERTO mientras la prueba del\n" +
    "    destino usaba el CERRADO, así que la celda que el cuerpo solo TOCA bloqueaba sin quedar eximida. Hoy\n" +
    "    la regla es la penetración no creciente sobre el solape abierto y `pen(p) > pen(p)` es falso siempre:\n" +
    "    el absoluto «vale `false` siempre» pasa a ser cierto SIN excepción medida. La convención cerrada sigue\n" +
    "    viva (`blocksCircle`, el tope de footprint de #300) y por eso se imprimen las dos.",
);
if (bloqueaTangente !== false) {
  mal(
    "la tangencia exacta ya no bloquea consigo misma",
    `la consulta de paso con origen = destino devolvió ${bloqueaTangente} en el punto tangente: ` +
      "ha vuelto a entrar una convención cerrada en la regla de paso",
  );
}
if (!laVeCerrada) {
  mal(
    "la convención CERRADA sigue distinguiéndose de la abierta",
    "`blocksCircle` ya no ve sólido el punto tangente: si las dos convenciones colapsan, este bloque " +
      "deja de medir la diferencia que existe para medir",
  );
}

console.log("");
if (fallos.length) {
  console.log(`✖ ${fallos.length} aserto(s) en rojo:`);
  for (const f of fallos) console.log(`   · ${f}`);
  process.exit(1);
}
console.log("✔ la puerta sigue cerrada y la retirada de #538 no mueve a nadie en ninguno de los puntos medidos");
process.exit(0);
