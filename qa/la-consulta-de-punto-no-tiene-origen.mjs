#!/usr/bin/env node
/** LA CONSULTA DE PUNTO NO TIENE ORIGEN — que preguntar «¿hay algo ahí?» dé la
 *  misma respuesta se pregunte desde donde se pregunte (#644).
 *
 *  ## De dónde sale
 *
 *  `qa/guiones/91-la-forja-que-el-motor-pone-ya-no-se-atraviesa.mjs` salía rojo
 *  en la batería larga y verde corriendo solo. De sus 121 muestras salieron
 *  **46 libres, 38 libres y 0 libres** en tres corridas del MISMO código, y dos
 *  de esas corridas estaban en VERDE. La causa no es que la sonda mueva a
 *  nadie: `collidesAt` (`nefan-html/src/world/collision.ts`) LEE
 *  `getPlayerPos()` y no escribe nada. Es que es una consulta de MOVIMIENTO —
 *  las tres fuentes de solidez son «salir sí, entrar no», así que contestan que
 *  NO por donde uno ya está (#538)—, y el guion la estaba leyendo como si
 *  describiera el mundo. El resultado dependía de dónde hubiera quedado el
 *  jugador, que es un dato vivo.
 *
 *  La respuesta no es aparcar al jugador entre sondas: eso es un protocolo que
 *  hay que recordar en cada sitio, y el único ejemplar que lo hacía (el guion
 *  134) lo cumple a medias — pone el mirador UNA vez y tres de sus sondas
 *  corren desde donde dejó el empujón anterior. La respuesta es una pregunta
 *  que no tiene origen que olvidar: `CollisionSystem.ocupadoEn`, expuesta al
 *  banco como `window.__nefan.probePoint`.
 *
 *  ## Qué afirma, y sobre qué
 *
 *   1. **EL CABLE**: que `probePoint` del seam llegue a `ocupadoEn`, y que
 *      `ocupadoEn` se monte con las dos piezas SIN ORIGEN de core
 *      (`suelo.ocupado` y `aabbOcupa`) y no con `collidesAt`. Es la mitad que
 *      este guion no puede medir montando el mundo por su cuenta, y la lección
 *      de la tanda E: el cable entre dos mitades candadas no tenía candado.
 *   2. **EQUIVALENCIA**: desde un origen LIBRE, `ocupadoEn` y `collidesAt`
 *      contestan lo mismo punto por punto sobre las tres fixtures. Es la
 *      equivalencia conocida (con el origen fuera, `penetracion(desde) = 0`), y
 *      es lo que impide que `ocupadoEn` nazca midiendo OTRO mundo — el fallo de
 *      la tanda G. Se excluyen, y se CUENTAN, los puntos que la frontera del
 *      plano decide: un tile que no existe no está «ocupado».
 *   3. **EL DEFECTO, REPRODUCIDO**: la misma línea de 121 muestras contada
 *      desde cuatro orígenes distintos. Con `collidesAt` el número de muestras
 *      libres CAMBIA con el origen (que es el rojo intermitente del 91); con
 *      `ocupadoEn` es el mismo cuatro veces. El bloque afirma las dos cosas: si
 *      la primera dejara de variar, no estaría midiendo el defecto.
 *
 *  ## Lo que este candado NO cubre
 *
 *   · No abre navegador, así que no ejerce el `probePoint` del cliente VIVO:
 *     monta el mismo mundo que `qa/los-candados-miden-el-mundo-del-cliente.mjs`
 *     con `nefan-core/dist`. Lo que ata las dos mitades es el bloque 1 (texto
 *     del árbol) y los guiones 32 y 91, que sí preguntan por el seam.
 *   · No dice nada de la FRONTERA del plano, que queda fuera de `ocupadoEn` a
 *     propósito y por eso se excluye del bloque 2.
 *   · Mide que las dos consultas coinciden donde deben y difieren donde deben;
 *     no mide que los guiones las usen bien. Eso es del que escribe el guion.
 *
 *  ## Contrato de salida (es un CANDADO)
 *
 *    0  la consulta de punto está cableada, coincide desde fuera y no depende
 *       del origen
 *    1  algún aserto en rojo
 *    2  no se pudo medir (falta `nefan-core/dist`)
 *
 *  ## Probado en negativo, y se puede volver a probar
 *
 *    QA_PUNTO_DELEGA=1 node qa/la-consulta-de-punto-no-tiene-origen.mjs
 *      cablea `ocupadoEn` como un `collidesAt` con el origen vivo —o sea, el
 *      defecto de #644 puesto a mano— → bloque 3 **rojo** con la cuenta de las
 *      muestras que cambian. exit 1.
 *
 *  Sin navegador, sin stack y sin créditos: `nefan-core/dist`, las fixtures del
 *  árbol y aritmética. Entra en el job `candados-headless` el día que nace, que
 *  desde #645 no es una costumbre sino un test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatDToWorld } from "../nefan-core/dist/src/scene/scene-normalize.js";
import { planCollisionGrid } from "../nefan-core/dist/src/scene/blueprint/plan-collision.js";
import { createTerrainCollider, PLAYER_RADIUS_M } from "../nefan-core/dist/src/scene/terrain-collision.js";
import { solidoBloquea } from "../nefan-core/dist/src/simulation/salida-del-solido.js";
import { aabbBloquea, aabbOcupa, fronteraBloquea } from "../nefan-core/dist/src/simulation/obstaculos-del-jugador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = ["robledo_tile", "puerto_tile", "zorder_test"];
const PASO_MALLA_M = 0.5;
/** Las mismas 121 muestras que cuenta el guion 91 sobre la línea entre dos
 *  cajas: el número que salió 46, 38 y 0. */
const MUESTRAS_DE_LA_LINEA = 121;
const DELEGA = process.env.QA_PUNTO_DELEGA === "1";

const fallos = [];
const ok = (linea) => console.log(`  ✔ ${linea}`);
const mal = (linea, detalle) => {
  console.log(`  ✖ ${linea}\n      ${detalle}`);
  fallos.push(linea);
};

// ── 1 · EL CABLE ────────────────────────────────────────────────────────────

console.log("1 · EL CABLE: `probePoint` llega a `ocupadoEn`, y `ocupadoEn` no pregunta por el origen");

/** El cuerpo de un método, desde su firma hasta la línea que cierra a su misma
 *  indentación. Se lee del ÁRBOL y no de una lista: si el método se renombra o
 *  se va, esto no encuentra nada y el bloque lo dice. */
function cuerpoDelMetodo(texto, firma) {
  const i = texto.indexOf(firma);
  if (i === -1) return null;
  const sangria = " ".repeat(texto.slice(0, i).split("\n").pop().length);
  const fin = texto.indexOf(`\n${sangria}}`, i);
  return fin === -1 ? null : texto.slice(i, fin);
}

const COLISION = readFileSync(path.join(RAIZ, "nefan-html/src/world/collision.ts"), "utf8");
const HOOK = readFileSync(path.join(RAIZ, "nefan-html/src/dev/nefan-hook.ts"), "utf8");

const cuerpo = cuerpoDelMetodo(COLISION, "ocupadoEn(x: number, z: number");
if (cuerpo === null) {
  mal(
    "`CollisionSystem.ocupadoEn` existe en el cliente",
    "no encuentro su firma en nefan-html/src/world/collision.ts. Si se renombró, este bloque hay que moverlo con ella",
  );
} else if (cuerpo.includes("collidesAt")) {
  mal(
    "`ocupadoEn` no se apoya en la consulta de MOVIMIENTO",
    "su cuerpo nombra `collidesAt`: entonces vuelve a depender de dónde esté el jugador, que es #644 entero",
  );
} else if (!cuerpo.includes("suelo.ocupado") || !cuerpo.includes("aabbOcupa")) {
  mal(
    "`ocupadoEn` se monta con las dos piezas sin origen de core",
    `esperaba \`suelo.ocupado\` y \`aabbOcupa\` en su cuerpo y leo:\n      ${cuerpo.replace(/\s+/g, " ").slice(0, 160)}`,
  );
} else {
  ok("`ocupadoEn` = `suelo.ocupado` ∪ `aabbOcupa`, y ni nombra `collidesAt`");
}

const probePoints = [...HOOK.matchAll(/probePoint[:(][^\n]*/g)].map((m) => m[0]);
const probeCollides = [...HOOK.matchAll(/probeCollide[:(][^\n]*/g)].map((m) => m[0]);
if (probePoints.length !== probeCollides.length || probePoints.length === 0) {
  mal(
    "`probePoint` está en los MISMOS sitios que `probeCollide`",
    `${probePoints.length} probePoint contra ${probeCollides.length} probeCollide en nefan-hook.ts. El hook publica ` +
      "la clave dos veces (el objeto base y el bloque de DEV): una sola deja a la mitad de los guiones sin ella",
  );
} else if (probePoints.some((l) => !l.includes("ocupadoEn"))) {
  mal(
    "cada `probePoint` del seam llama a `ocupadoEn`",
    `hay uno que no:\n      ${probePoints.filter((l) => !l.includes("ocupadoEn")).join("\n      ")}`,
  );
} else {
  ok(`las ${probePoints.length} publicaciones de \`probePoint\` llaman a \`ocupadoEn\` (y otras tantas de \`probeCollide\`)`);
}

// ── El mundo, montado como lo monta el cliente ───────────────────────────────

/** EL MUNDO DE UNA FIXTURE, con el mismo cableado que
 *  `qa/los-candados-miden-el-mundo-del-cliente.mjs`: el plan COMPUESTO
 *  (`__plan`, que es lo que instala `carga-de-tile.ts`), los dos colliders
 *  unidos en una consulta de punto, las cajas de los objetos del tile y un tile
 *  SOLO con los ocho vecinos ausentes, que es lo que hay en `html-fixtures`. */
function mundoDeLaFixture(nombre) {
  const crudo = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/scenes", `${nombre}.json`), "utf8"));
  const w = formatDToWorld(crudo);
  const rect = w.world_rect;

  const grids = [w.terrain_grid, planCollisionGrid(w.__plan?.ground, w.__plan?.volumes, rect)].filter(Boolean);
  const colliders = grids.map((g) => createTerrainCollider(g)).filter(Boolean);
  const suelo = { ocupado: (x, z, r) => colliders.some((c) => c.solapaSolido(x, z, r)) };

  const objetos = w.objects.map((o) => ({
    pos: { x: o.position[0], z: o.position[2] },
    sizeXZ: { x: o.scale[0], z: o.scale[2] },
    category: o.category,
    dueno: { de: "tile", key: "0,0" },
  }));
  // LA FORJA DEL MOTOR, que las fixtures NO tienen y sin la cual este guion no
  // mediría la mitad de las cajas. Medido al escribirlo: todos los objetos de
  // las tres fixtures son `dueno: tile` y su plan está instalado, así que
  // `aabbBloquea` los salta TODOS —responde por ellos el grid— y con
  // `aabbOcupa` devolviendo `false` a palo seco el bloque 2 seguía en verde.
  // Un spawn del motor es justo el caso del guion 91 (#489: su caja es lo
  // único que hay), y se planta en el primer hueco donde cabe entera.
  const forja = { sizeXZ: { x: 4, z: 4 }, category: "building", dueno: { de: "runtime" } };
  for (let x = rect.minX + 8; x < rect.maxX - 8 && !forja.pos; x += 1) {
    for (let z = rect.minZ + 8; z < rect.maxZ - 8; z += 1) {
      if (!suelo.ocupado(x, z, 2 + PLAYER_RADIUS_M)) {
        forja.pos = { x, z };
        break;
      }
    }
  }
  if (!forja.pos) throw new Error(`no hay hueco para la caja del motor en ${nombre}`);
  objetos.push(forja);

  const tiles = {
    hayGrid: true,
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
    planAplicadoEn: () => true,
  };

  // EL ORDEN ES EL DEL CLIENTE (`CollisionSystem.collidesAt`): frontera, suelo,
  // cajas.
  const collidesAt = (desde, hasta) => {
    if (fronteraBloquea(desde, hasta, PLAYER_RADIUS_M, tiles)) return true;
    if (solidoBloquea(desde, hasta, PLAYER_RADIUS_M, suelo)) return true;
    return aabbBloquea(desde, hasta, PLAYER_RADIUS_M, objetos, tiles);
  };
  // Y ESTA es la de PUNTO: las dos fuentes que tienen penetración, sin origen.
  // Con `QA_PUNTO_DELEGA=1` se cablea el defecto a mano —la de movimiento con
  // el origen vivo— para ver rojo el bloque 3.
  const ocupadoEn = DELEGA
    ? (x, z, origen) => collidesAt(origen, { x, z })
    : (x, z) => suelo.ocupado(x, z, PLAYER_RADIUS_M) || aabbOcupa({ x, z }, PLAYER_RADIUS_M, objetos, tiles);

  /** ¿Decide la FRONTERA en este punto? El cuerpo toca un tile que no existe,
   *  así que `collidesAt` bloquea y `ocupadoEn` no opina: queda fuera de la
   *  comparación, y se cuenta. */
  const enLaFrontera = (x, z) => tiles.tocados(x, z, PLAYER_RADIUS_M).some((t) => !tiles.tiene(t.tx, t.ty));

  return { rect, collidesAt, ocupadoEn, enLaFrontera, objetos, forja, suelo };
}

let dist = null;
try {
  dist = new Map(FIXTURES.map((n) => [n, mundoDeLaFixture(n)]));
} catch (err) {
  console.log(`⊘ SIN MEDIR — no puedo montar el mundo: ${err.message}`);
  console.log("  (cd nefan-core && npm run build)");
  process.exit(2);
}
const mundos = dist;

// ── 2 · EQUIVALENCIA DESDE UN ORIGEN LIBRE ──────────────────────────────────

console.log("");
console.log("2 · EQUIVALENCIA: desde un origen LIBRE las dos consultas dicen lo mismo, punto por punto");

let totalComparados = 0;
let totalOcupados = 0;
let totalFrontera = 0;
let soloFrontera = 0;
let soloPorCaja = 0;
const divergencias = [];
for (const [nombre, m] of mundos) {
  // El origen libre: el primer punto de la malla que ni está ocupado ni toca la
  // frontera. Se BUSCA en vez de fijarlo, para que no dependa de la fixture.
  let libre = null;
  const malla = [];
  // La malla llega al BORDE del rect a propósito: ahí es donde el cuerpo toca
  // el tile que no existe y la frontera decide. Sin esos puntos, la exclusión
  // de abajo sería una cláusula que no selecciona a nadie.
  for (let x = m.rect.minX; x <= m.rect.maxX; x += PASO_MALLA_M) {
    for (let z = m.rect.minZ; z <= m.rect.maxZ; z += PASO_MALLA_M) {
      malla.push({ x, z });
    }
  }
  for (const p of malla) {
    if (!m.enLaFrontera(p.x, p.z) && !m.ocupadoEn(p.x, p.z, p)) {
      libre = p;
      break;
    }
  }
  if (libre === null) {
    mal(`${nombre} tiene algún punto libre desde el que preguntar`, "toda la malla sale ocupada o en la frontera");
    continue;
  }

  let comparados = 0;
  let ocupados = 0;
  let enFrontera = 0;
  const distintos = [];
  for (const p of malla) {
    if (m.enLaFrontera(p.x, p.z)) {
      enFrontera++;
      // MEDIDO y no afirmado: la diferencia que la exclusión tapa, para que se
      // vea de qué tamaño es. Son puntos donde el cuerpo asoma fuera del mundo
      // conocido: `collidesAt` no deja ir y `ocupadoEn` dice que no hay nada,
      // y las dos cosas son ciertas.
      if (m.collidesAt(libre, p) && !m.ocupadoEn(p.x, p.z, libre)) soloFrontera++;
      continue;
    }
    const ocupa = m.ocupadoEn(p.x, p.z, libre);
    const bloquea = m.collidesAt(libre, p);
    comparados++;
    if (ocupa) ocupados++;
    // El control de la mitad de las CAJAS: puntos ocupados que el terreno no
    // explica. Sin él, `aabbOcupa` podría devolver `false` a palo seco y este
    // bloque seguiría en verde — medido, pasó al escribirlo.
    if (ocupa && !m.suelo.ocupado(p.x, p.z, 0.4)) soloPorCaja++;
    if (ocupa !== bloquea && distintos.length < 5) {
      distintos.push(`(${p.x.toFixed(2)}, ${p.z.toFixed(2)}): ocupadoEn=${ocupa} collidesAt=${bloquea}`);
    }
    if (ocupa !== bloquea) divergencias.push(nombre);
  }
  totalComparados += comparados;
  totalOcupados += ocupados;
  totalFrontera += enFrontera;
  console.log(
    `    ${nombre.padEnd(13)} · origen libre (${libre.x.toFixed(1)}, ${libre.z.toFixed(1)}) · ` +
      `forja del motor en (${m.forja.pos.x}, ${m.forja.pos.z}) · ` +
      `comparados ${String(comparados).padStart(5)} · ocupados ${String(ocupados).padStart(5)} · ` +
      `fuera por frontera ${String(enFrontera).padStart(4)}` +
      (distintos.length ? `\n      ${distintos.join("\n      ")}` : ""),
  );
}
if (totalComparados === 0) {
  mal("hay puntos que comparar", "cero comparaciones: el bloque no ha medido nada");
} else if (totalOcupados === 0 || totalOcupados === totalComparados) {
  // Sin esto, «coinciden» se cumpliría con las dos diciendo siempre lo mismo.
  mal(
    "el mundo montado tiene sólidos Y huecos",
    `${totalOcupados} ocupados de ${totalComparados}: con todo libre o todo macizo, la igualdad no dice nada`,
  );
} else if (soloPorCaja === 0) {
  mal(
    "la mitad de las CAJAS se está midiendo",
    "ningún punto está ocupado por una caja y no por el terreno: `aabbOcupa` podría no hacer nada y este bloque " +
      "seguiría en verde. Las cajas del TILE las salta la política (su plan responde por ellas), así que quien " +
      "tiene que aparecer aquí es la caja del MOTOR que este guion planta",
  );
} else if (totalFrontera === 0) {
  mal(
    "la malla llega al borde, que es donde decide la frontera",
    "cero puntos excluidos: si la malla dejó de tocar el borde del rect, la exclusión de la frontera no está " +
      "probando nada y este bloque afirma menos de lo que su texto promete",
  );
} else if (divergencias.length > 0) {
  mal(
    "desde un origen libre las dos consultas coinciden",
    `${divergencias.length} punto(s) discrepan. Si la consulta de punto midiera OTRO mundo —el fallo de la ` +
      "tanda G—, esto es lo primero que se nota",
  );
} else {
  ok(
    `${totalComparados} puntos comparados en las tres fixtures, ${totalOcupados} ocupados, 0 divergencias ` +
      `(${soloPorCaja} de ellos por la CAJA del motor y no por el terreno; y ${totalFrontera} fuera de la ` +
      `comparación porque los decide la frontera del plano: en ${soloFrontera} ` +
      "de ellos `collidesAt` bloquea y `ocupadoEn` dice que no hay nada, que es la diferencia declarada)",
  );
}

// ── 3 · EL DEFECTO, REPRODUCIDO ─────────────────────────────────────────────

console.log("");
console.log("3 · EL DEFECTO: la MISMA línea de 121 muestras, contada desde cuatro orígenes distintos");

/** La línea entre los centros de las dos primeras cajas de la fixture, que es
 *  el barrido del guion 91 (`huecoEntre`): 121 muestras. */
function lineaDeLaFixture(m) {
  const cajas = m.objetos.filter((o) => o.category === "building" || o.category === "prop");
  if (cajas.length < 2) return null;
  const [a, b] = cajas;
  return Array.from({ length: MUESTRAS_DE_LA_LINEA }, (_, i) => {
    const t = i / (MUESTRAS_DE_LA_LINEA - 1);
    return { x: a.pos.x + (b.pos.x - a.pos.x) * t, z: a.pos.z + (b.pos.z - a.pos.z) * t };
  });
}

let variabaLaDeMovimiento = 0;
let variaLaDePunto = 0;
for (const [nombre, m] of mundos) {
  const linea = lineaDeLaFixture(m);
  if (linea === null) {
    console.log(`    ${nombre}: sin dos cajas que unir, no hay línea que barrer`);
    continue;
  }
  // Los cuatro orígenes: donde arranca el jugador, los dos extremos de la línea
  // (que están DENTRO de sendas cajas: es justo el caso del 91, con el jugador
  // pegado a la forja) y el punto medio.
  const origenes = [
    { etiqueta: "lejos", p: { x: m.rect.minX + 1, z: m.rect.minZ + 1 } },
    { etiqueta: "en la caja A", p: linea[0] },
    { etiqueta: "en la caja B", p: linea[linea.length - 1] },
    { etiqueta: "a medio camino", p: linea[Math.floor(linea.length / 2)] },
  ];
  const porMovimiento = origenes.map((o) => linea.filter((p) => !m.collidesAt(o.p, p)).length);
  const porPunto = origenes.map((o) => linea.filter((p) => !m.ocupadoEn(p.x, p.z, o.p)).length);
  console.log(
    `    ${nombre.padEnd(13)} · muestras LIBRES por origen [${origenes.map((o) => o.etiqueta).join(" · ")}]\n` +
      `      probeCollide (movimiento): ${JSON.stringify(porMovimiento)}\n` +
      `      probePoint   (punto)     : ${JSON.stringify(porPunto)}`,
  );
  if (new Set(porMovimiento).size > 1) variabaLaDeMovimiento++;
  if (new Set(porPunto).size > 1) {
    variaLaDePunto++;
    mal(
      `en ${nombre}, la consulta de PUNTO da el mismo número desde los cuatro orígenes`,
      `da ${JSON.stringify(porPunto)}. Eso es #644 otra vez: el veredicto del guion depende de dónde quedó el jugador`,
    );
  }
}
if (variabaLaDeMovimiento === 0) {
  // El control del bloque: si la de movimiento tampoco variase, la igualdad de
  // la de punto no estaría demostrando nada.
  mal(
    "el defecto que se mide EXISTE: la consulta de movimiento sí depende del origen",
    "ninguna fixture cambia de cuenta al mover el origen. O las cajas dejaron de solaparse con la línea, o " +
      "`collidesAt` dejó de eximir el origen — en los dos casos este bloque ya no mide #644",
  );
} else if (variaLaDePunto === 0) {
  ok(
    `la consulta de punto da el mismo número desde los cuatro orígenes, y la de movimiento cambia en ` +
      `${variabaLaDeMovimiento} de ${mundos.size} fixtures (que es el rojo intermitente del guion 91)`,
  );
} else {
  // El control se cumple y el veredicto no: los rojos ya están dichos arriba,
  // fixture a fixture. Aquí solo se evita rematar con un verde que contradiga
  // lo que se acaba de imprimir.
  console.log(`    (el defecto existe y se mide: la de movimiento cambia en ${variabaLaDeMovimiento} de ${mundos.size} fixtures)`);
}

console.log("");
if (fallos.length) {
  console.log(`✖ ${fallos.length} aserto(s) en rojo:`);
  for (const f of fallos) console.log(`   · ${f}`);
  process.exit(1);
}
console.log("✔ la consulta de punto está cableada, coincide desde fuera y no depende del origen (#644)");
process.exit(0);
