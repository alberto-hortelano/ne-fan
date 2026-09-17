#!/usr/bin/env node
/** NADIE SE QUEDA ENCERRADO — que de todo punto sólido del mundo se SALGA
 *  ANDANDO, con el paso del jugador y las fuentes de solidez de verdad.
 *
 *  ## De dónde sale
 *
 *  De **#616**, abierto por la QA de la tanda E. La regla de paso del terreno
 *  eximía «las celdas sólidas que ya se solapaban en el origen», lo que
 *  devuelve a quien penetra un muro fino y **no saca a quien está dentro de un
 *  sólido más ancho que su cuerpo**: la celda siguiente es sólida, no estaba
 *  solapada y bloquea. Y los edificios del plan son MACIZOS
 *  (`planCollisionGrid` rasteriza la huella entera del volumen), así que quien
 *  acabara dentro de uno se quedaba ahí para siempre — con la tecla R sin
 *  sacarle tampoco, porque devuelve el punto del cadáver.
 *
 *  Medido entonces sobre estas tres mismas fixtures: **2.562 de 7.020 puntos
 *  sólidos eran estado sin salida**. La tanda G (2026-09-17) llevó la regla al
 *  núcleo (`src/simulation/salida-del-solido.ts`: penetración no creciente
 *  sobre el solape abierto) y esto es el candado de que no vuelve.
 *
 *  ## Qué afirma, y sobre qué
 *
 *  Las TRES fixtures de `nefan-core/data/scenes/` —el mundo real que pinta el
 *  selector «Room»—, una malla de 0,5 m, y de cada punto en el que el CUERPO
 *  del jugador solapa algo sólido: **36 rumbos** (uno cada 10°, los cuatro ejes
 *  entre ellos), a 60 fps y con el horizonte DERIVADO de su penetración
 *  (`pen / velocidad + 0,25 s`), conducidos por `pasoDelJugador` con el
 *  mismo cableado que `nefan-html/src/world/collision.ts` — origen vivo, las
 *  dos fuentes del tile (grid del terreno y grid del PLAN COMPUESTO, que es el
 *  que instala el cliente y no los `volumes` declarados del crudo) unidas en
 *  UNA consulta de punto, y la velocidad de andar leída de
 *  `combat_config.json`, no copiada aquí.
 *
 *   1. **DE TODO PUNTO SE SALE**: cero puntos sin salida en las tres.
 *   2. **Y SE SALE POR LO MÁS CORTO**: el rumbo más rápido de cada punto no
 *      tarda más que su penetración dividida por la velocidad, más el margen
 *      de un par de frames. Es un límite DERIVADO de la geometría, no un
 *      número elegido: si alguien cambiara la salida por «el primer eje libre»
 *      en vez de «el de menor penetración», los puntos tardarían de más y esto
 *      se pondría rojo sin que el punto 1 se enterara.
 *   3. **CONTROL**: hay puntos sólidos que medir en las tres fixtures. Sin él,
 *      1 y 2 saldrían igual de verdes sobre un mundo de aire.
 *
 *  Y una cosa que MIDE y no afirma: la **penetración máxima** real de cada
 *  fixture. El tope de marcha son 40 m y dentro de un macizo más ancho no hay
 *  gradiente que seguir; imprimirla en cada corrida es cómo se ve venir.
 *
 *  ## Contrato de salida (es un CANDADO)
 *
 *    0  de todo punto sólido de las tres fixtures se sale andando
 *    1  hay puntos sin salida, o se sale por un camino más largo que el corto,
 *       o el control dejó de medir
 *
 *  ## Probado en negativo, y se puede volver a probar
 *
 *    QA_SIN_ESCAPE=1 node qa/nadie-se-queda-encerrado.mjs
 *      cablea LA REGLA DE AYER —la exención por celdas, escrita AQUÍ y no en
 *      el árbol— y deja todo lo demás igual → miles de puntos sin salida,
 *      **exit 1**. Es la prueba de que esta batería puede ponerse roja, y de
 *      que lo que la pone verde es el arreglo y no la malla.
 *
 *  Sin navegador, sin stack y sin créditos: son `nefan-core/dist`, las
 *  fixtures del árbol y aritmética. Entra en el job `candados-headless`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatDToWorld } from "../nefan-core/dist/src/scene/scene-normalize.js";
import { planCollisionGrid } from "../nefan-core/dist/src/scene/blueprint/plan-collision.js";
import { createTerrainCollider, PLAYER_RADIUS_M } from "../nefan-core/dist/src/scene/terrain-collision.js";
import { penetracionEnSolido, solidoBloquea } from "../nefan-core/dist/src/simulation/salida-del-solido.js";
import { pasoDelJugador, velocidadDelJugador } from "../nefan-core/dist/src/simulation/paso-del-jugador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = ["robledo_tile", "puerto_tile", "zorder_test"];
const PASO_MALLA_M = 0.5;
const RUMBOS = 36;
const FPS = 60;
/** Margen sobre la cota geométrica, en segundos. El horizonte de cada punto no
 *  es un número fijo: es `penetración / velocidad + esto`, porque esa es la
 *  cota del rumbo MÁS RÁPIDO —por el eje de menor penetración se andan `pen`
 *  metros y los cuatro ejes están en la rosa— y lo que el candado pregunta es
 *  si ALGÚN rumbo saca.
 *
 *  Acortar el horizonte no puede ablandar el candado, que es lo que lo hace
 *  legítimo: un rumbo que necesitara más tiempo contaría como que NO saca, así
 *  que solo puede producir MÁS puntos sin salida, nunca menos. Con horizonte
 *  fijo de 10 s esta batería tardaba 100 s, y el grueso se lo llevaban los
 *  rumbos que RESBALAN pegados a una cara sin salir nunca —legales, porque
 *  moverse paralelo a una cara no aumenta la penetración—, que agotaban el
 *  horizonte entero para decir lo mismo. */
const MARGEN_S = 0.25;
const SIN_ESCAPE = process.env.QA_SIN_ESCAPE === "1";

/** UN frame sin moverse y el rumbo se abandona, y no es un atajo: es EXACTO.
 *  `pasoDelJugador` es una función pura de (posición, rumbo, velocidad, delta,
 *  consulta de solidez), y la consulta cierra sobre la posición. Si un frame
 *  devuelve delta cero, la posición no cambió y el frame siguiente recibe
 *  exactamente las mismas entradas: el resultado es el mismo para siempre. Un
 *  jugador con la tecla pulsada ahí se queda. Esperar 600 frames a comprobarlo
 *  es lo que convertía esta batería en minuto y medio. */
const FRAMES_QUIETO = 1;

const combate = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/combat_config.json"), "utf8"));
const VELOCIDAD = velocidadDelJugador(combate.player, false);

const fallos = [];
const ok = (linea) => console.log(`  ✔ ${linea}`);
const mal = (linea, detalle) => {
  console.log(`  ✖ ${linea}\n      ${detalle}`);
  fallos.push(linea);
};

/** LA REGLA DE AYER, escrita aquí y no en el árbol: bloquea las celdas sólidas
 *  que solapa el DESTINO y no solapaba el ORIGEN. Es byte a byte la que #616
 *  retiró del collider de terreno, incluida su asimetría —el destino se
 *  recorre con `floor()` INCLUSIVE (solape cerrado) y la exención del origen
 *  usa el solape abierto—. Sin ella este guion no podría ponerse rojo. */
function reglaDeAyer(tg) {
  const { cols, rows, meters_per_cell: mpc } = tg;
  const [ox, oz] = tg.origin;
  const solidos = new Set(tg.solid_chars ?? []);
  const esSolida = (c, r) =>
    c >= 0 && r >= 0 && c < cols && r < rows && solidos.has(tg.grid[r][c]);
  const solapaAbierto = (x, z, radio, c, r) => {
    const cx0 = ox + c * mpc;
    const cz0 = oz + r * mpc;
    return x + radio > cx0 && x - radio < cx0 + mpc && z + radio > cz0 && z - radio < cz0 + mpc;
  };
  return (desde, hasta, radio) => {
    const c0 = Math.floor((hasta.x - radio - ox) / mpc);
    const c1 = Math.floor((hasta.x + radio - ox) / mpc);
    const r0 = Math.floor((hasta.z - radio - oz) / mpc);
    const r1 = Math.floor((hasta.z + radio - oz) / mpc);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!esSolida(c, r)) continue;
        if (solapaAbierto(desde.x, desde.z, radio, c, r)) continue;
        return true;
      }
    }
    return false;
  };
}

/** El mundo de una fixture: el rect, la consulta de PUNTO (que es la misma en
 *  las dos corridas, para que el conjunto de puntos medidos no cambie) y la de
 *  PASO, que es la que se sabotea. */
function mundoDeLaFixture(nombre) {
  const crudo = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/scenes", `${nombre}.json`), "utf8"));
  const w = formatDToWorld(crudo);
  const rect = w.world_rect;
  // EL PLAN COMPUESTO (`__plan`), que es el que instala el cliente
  // (`world/carga-de-tile.ts:335`) y el que rasteriza el bridge — NO los
  // `volumes` declarados del crudo. La diferencia no es cosmética: robledo y
  // puerto declaran CERO volumes y sacan sus 38 y 23 del esquema, así que con
  // el crudo este guion medía 960 celdas sólidas de 1.608 y 2.144 de 3.072. Un
  // candado sobre un mundo un 40 % menos sólido que el de verdad.
  const gridDelPlan = planCollisionGrid(w.__plan?.ground, w.__plan?.volumes, rect);

  const grids = [w.terrain_grid, gridDelPlan].filter(Boolean);
  const colliders = grids.map((g) => createTerrainCollider(g)).filter(Boolean);

  // La unión de las dos fuentes del tile, como la monta el cliente. Un cuerpo
  // tiene UNA penetración aunque toque dos grids.
  const suelo = {
    ocupado: (x, z, r) => colliders.some((c) => c.solapaSolido(x, z, r)),
  };

  const deAyer = grids.map((g) => reglaDeAyer(g));
  const bloquea = SIN_ESCAPE
    ? (desde, hasta) => deAyer.some((f) => f(desde, hasta, PLAYER_RADIUS_M))
    : (desde, hasta) => solidoBloquea(desde, hasta, PLAYER_RADIUS_M, suelo);

  return { rect, suelo, bloquea };
}

/** Un rumbo, conducido como lo conduce el juego: origen VIVO (el `collidesAt`
 *  del cliente parte siempre de dónde está el jugador), W pulsada, 60 fps.
 *  Devuelve los segundos que tardó en dejar de solapar, o `null`. */
function andarHasta(salir, inicio, forward, mundo, horizonteS) {
  const pos = { x: inicio.x, z: inicio.z };
  const solido = (x, z) => mundo.bloquea(pos, { x, z });
  const delta = 1 / FPS;
  let quieto = 0;
  for (let frame = 1; frame <= Math.ceil(horizonteS * FPS); frame++) {
    const { dx, dz } = pasoDelJugador({
      desde: pos,
      forward,
      intencion: { adelante: 1, derecha: 0 },
      velocidad: VELOCIDAD,
      delta,
      solido,
    });
    if (dx === 0 && dz === 0) {
      if (++quieto >= FRAMES_QUIETO) return null;
      continue;
    }
    quieto = 0;
    pos.x += dx;
    pos.z += dz;
    if (!salir(pos)) return frame * delta;
  }
  return null;
}

const rosa = [];
for (let i = 0; i < RUMBOS; i++) {
  const a = (i * 2 * Math.PI) / RUMBOS;
  rosa.push({ x: Math.cos(a), z: Math.sin(a) });
}

console.log(
  `NADIE SE QUEDA ENCERRADO · ${RUMBOS} rumbos · horizonte pen/v + ${MARGEN_S} s a ${FPS} fps · ` +
    `cuerpo ${PLAYER_RADIUS_M} m · ${VELOCIDAD.toFixed(2)} m/s`,
);
console.log(`    (regla de paso: ${SIN_ESCAPE ? "LA DE AYER (sabotaje QA_SIN_ESCAPE)" : "la del árbol"})`);
console.log("");

let totalSolidos = 0;
let totalSinSalida = 0;
let minRumbosQueSacan = Infinity;
let lentosDeMas = 0;
const contraejemplos = [];
const lentos = [];
const arranque = Date.now();

for (const nombre of FIXTURES) {
  const mundo = mundoDeLaFixture(nombre);
  const { rect, suelo } = mundo;
  const ocupado = (p) => suelo.ocupado(p.x, p.z, PLAYER_RADIUS_M);

  let solidos = 0;
  let sinSalida = 0;
  let penMax = 0;
  let minRumbos = Infinity;
  let peorRatio = 0;

  for (let z = rect.minZ; z <= rect.maxZ; z += PASO_MALLA_M) {
    for (let x = rect.minX; x <= rect.maxX; x += PASO_MALLA_M) {
      const p = { x, z };
      if (!ocupado(p)) continue;
      solidos++;
      const pen = penetracionEnSolido(x, z, PLAYER_RADIUS_M, suelo);
      if (pen > penMax) penMax = pen;

      let sacan = 0;
      let masRapido = Infinity;
      for (const forward of rosa) {
        const t = andarHasta((q) => ocupado(q), p, forward, mundo, pen / VELOCIDAD + MARGEN_S);
        if (t === null) continue;
        sacan++;
        if (t < masRapido) masRapido = t;
      }
      if (sacan === 0) {
        sinSalida++;
        if (contraejemplos.length < 5) contraejemplos.push(`${nombre}: (${x}, ${z}) · penetración ${pen.toFixed(2)} m`);
        continue;
      }
      if (sacan < minRumbos) minRumbos = sacan;

      // EL LÍMITE DERIVADO: por el eje de menor penetración se anda `pen`
      // metros, y los cuatro ejes están en la rosa. Dos frames de margen por
      // el redondeo del paso.
      const tope = pen / VELOCIDAD + 2 / FPS;
      if (masRapido > tope) {
        lentosDeMas++;
        peorRatio = Math.max(peorRatio, masRapido / tope);
        if (lentos.length < 5) {
          lentos.push(`${nombre}: (${x}, ${z}) · pen ${pen.toFixed(2)} m ⇒ ${tope.toFixed(3)} s, tardó ${masRapido.toFixed(3)} s`);
        }
      }
    }
  }

  totalSolidos += solidos;
  totalSinSalida += sinSalida;
  if (minRumbos < minRumbosQueSacan) minRumbosQueSacan = minRumbos;
  console.log(
    `    ${nombre.padEnd(13)} · ${String(solidos).padStart(5)} puntos sólidos · sin salida: ${String(sinSalida).padStart(5)} · ` +
      `rumbos que sacan a tiempo (mínimo): ${minRumbos === Infinity ? "—" : `${minRumbos}/${RUMBOS}`} · ` +
      `penetración máxima ${penMax.toFixed(2)} m`,
  );
}
console.log(`    (${((Date.now() - arranque) / 1000).toFixed(1)} s)`);
console.log("");

console.log("1 · DE TODO PUNTO SÓLIDO SE SALE ANDANDO");
if (totalSinSalida === 0) {
  ok(`${totalSolidos} puntos sólidos en las tres fixtures y NINGUNO sin salida`);
} else {
  mal(
    "ningún punto sólido es estado sin salida",
    `${totalSinSalida} de ${totalSolidos} lo son. Los primeros:\n      ` + contraejemplos.join("\n      "),
  );
}

console.log("");
console.log("2 · Y SE SALE POR LO MÁS CORTO: el rumbo más rápido no tarda más que la penetración / velocidad");
if (lentosDeMas === 0) {
  ok(
    `los ${totalSolidos - totalSinSalida} puntos con salida la tienen por el eje de menor penetración ` +
      `(mínimo ${minRumbosQueSacan === Infinity ? "—" : minRumbosQueSacan} de ${RUMBOS} rumbos sacan desde cualquier punto)`,
  );
} else {
  mal(
    "se sale por el camino más corto",
    `${lentosDeMas} punto(s) tardan más que su límite geométrico. Los primeros:\n      ` + lentos.join("\n      "),
  );
}

console.log("");
console.log("3 · CONTROL: hay mundo sólido con el que medir");
if (totalSolidos > 0) {
  ok(`${totalSolidos} puntos sólidos entre las tres fixtures`);
} else {
  mal("hay mundo sólido con el que medir", "ni un punto sólido: los bloques 1 y 2 no están midiendo nada");
}

console.log("");
if (fallos.length) {
  console.log(`✖ ${fallos.length} aserto(s) en rojo:`);
  for (const f of fallos) console.log(`   · ${f}`);
  process.exit(1);
}
console.log("✔ de todo punto sólido de las tres fixtures se sale andando (#616)");
process.exit(0);
