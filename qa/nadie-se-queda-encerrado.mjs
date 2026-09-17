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
 *  entre ellos) conducidos por `pasoDelJugador` con el **cableado ENTERO** de
 *  `nefan-html/src/world/collision.ts` y en su orden — `fronteraBloquea` →
 *  `solidoBloquea` sobre el suelo unido → `aabbBloquea`—, sobre UN tile con los
 *  ocho vecinos ausentes, que es lo que hay en el preset `html-fixtures`. El
 *  suelo es el grid del terreno más el del PLAN COMPUESTO (`__plan`), que es el
 *  que instala el cliente y no los `volumes` declarados del crudo. Origen vivo,
 *  60 fps, y la velocidad de andar leída de `combat_config.json`, no copiada
 *  aquí.
 *
 *  ESTE GUION NACIÓ MONTANDO UNA DE LAS TRES FUENTES y diciendo en esta misma
 *  cabecera que montaba «el mismo cableado»; lo cazó la QA de la PR G1. La
 *  diferencia no es cosmética: con la frontera puesta, **126 de los 6.007**
 *  puntos no salen dentro de la cota geométrica, porque su eje de menor
 *  penetración da a un tile que NO EXISTE y hay que rodear. Salen igual —el
 *  más lento en 1,4 s— y por eso hay DOS PASADAS: la corta, con el horizonte
 *  derivado, y la larga para los que no llegan. Lo que se AFIRMA es que salen;
 *  cuántos rodean se MIDE y se imprime.
 *
 *   1. **DE TODO PUNTO SE SALE**: cero puntos sin salida en las tres.
 *   2. **Y SE SALE POR LO MÁS CORTO**, en dos mitades:
 *      · la penetración que devuelve el módulo coincide con una **medida de
 *        REFERENCIA hecha aparte** —marcha por los cuatro ejes de 6,25 cm en
 *        6,25 cm sobre `suelo.ocupado`, sin preguntarle a la función que se
 *        juzga—, dentro de un paso;
 *      · y el rumbo más rápido de cada punto no tarda más que esa referencia
 *        dividida por la velocidad. Ese límite **no se aplica** a los puntos
 *        cuyo eje más corto sale del mundo conocido: ahí lo bloquea la frontera
 *        del plano y la cota deja de ser alcanzable. Se cuentan y se dicen.
 *
 *      LA SEGUNDA VERSIÓN DE ESTE BLOQUE, y el motivo importa: el límite salía
 *      de `penetracionEnSolido`, o sea de la implementación bajo prueba, así
 *      que al sustituir `salidaMedida` por «el primer eje libre» la penetración
 *      se inflaba (puerto 5,90 → 38,40 m) y el límite se inflaba con ella —el
 *      bloque salía VERDE con el sabotaje que este texto decía cazar. Lo cazó
 *      QA. Un límite derivado de lo que mides no es un límite.
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
 *      el árbol— y deja todo lo demás igual → **3.117 de 6.007 sin salida,
 *      exit 1**. Es la prueba de que esta batería puede ponerse roja, y de que
 *      lo que la pone verde es el arreglo y no la malla.
 *
 *    Y el que el bloque 2 no pasaba antes: sustituir `salidaMedida` por
 *      `return marchaPorEje(x, z, radio, suelo, true, 1)` («el primer eje
 *      libre») en `src/simulation/salida-del-solido.ts` → **los DOS asertos del
 *      bloque 2 en rojo**, 4.076 penetraciones discrepando de la referencia y
 *      542 puntos por encima de su cota, exit 1. Antes de esta versión: VERDE.
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
import { penetracionEnSolido, solidoBloquea, TOPE_MARCHA_M } from "../nefan-core/dist/src/simulation/salida-del-solido.js";
import { aabbBloquea, fronteraBloquea } from "../nefan-core/dist/src/simulation/obstaculos-del-jugador.js";
import { pasoDelJugador, velocidadDelJugador } from "../nefan-core/dist/src/simulation/paso-del-jugador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = ["robledo_tile", "puerto_tile", "zorder_test"];
const PASO_MALLA_M = 0.5;
/** Metros por celda del grid de los tiles. Es el mismo `TILE_MPC` de core; aquí
 *  solo se usa para el PASO de la medida de referencia, que es una subdivisión
 *  suya. */
const TILE_MPC_REF = 0.5;
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

/** Horizonte LARGO de la segunda pasada, en segundos. Quien no sale por el eje
 *  de menor penetración porque ese eje da a un tile que NO EXISTE tiene que
 *  rodear, y rodear cuesta más que la cota geométrica. Ocho segundos son cinco
 *  veces el peor rodeo medido (1,42 s). */
const LARGO_S = 8;

/** Paso de la MEDIDA DE REFERENCIA de la penetración, en metros (6,25 cm).
 *  Sobreestima la penetración real en menos de un paso, que es la tolerancia
 *  con la que se compara. */
const PASO_REF_M = TILE_MPC_REF / 8;
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

/** LA PENETRACIÓN MEDIDA APARTE, sin preguntarle a la función que se está
 *  juzgando: se anda cada eje de `PASO_REF_M` en `PASO_REF_M` hasta que el
 *  cuerpo deja de solapar, y se toma el mínimo. Solo usa `suelo.ocupado`.
 *
 *  ES LA CORRECCIÓN DE UN FALLO REAL DE ESTE GUION, cazado por QA: el límite
 *  del bloque 2 salía de `penetracionEnSolido`, o sea de la implementación bajo
 *  prueba, así que al sustituir `salidaMedida` por «el primer eje libre» la
 *  penetración se inflaba (puerto 5,90 → 38,40 m) y el límite se inflaba con
 *  ella. El bloque salía VERDE con el sabotaje que su propio docblock decía
 *  cazar. Un límite derivado de lo que mides no es un límite.
 *
 *  Sobreestima menos de un paso —se para en el primer múltiplo que sale libre,
 *  no en el punto exacto—, y por eso la comparación se hace con esa tolerancia
 *  y el horizonte que sale de aquí es un pelo generoso, que es el lado seguro. */
function penetracionDeReferencia(suelo, x, z, radio) {
  if (!suelo.ocupado(x, z, radio)) return { pen: 0, dir: null };
  let mejor = TOPE_MARCHA_M;
  let dir = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let d = PASO_REF_M; d <= mejor; d += PASO_REF_M) {
      if (!suelo.ocupado(x + dx * d, z + dz * d, radio)) {
        if (d < mejor) {
          mejor = d;
          dir = { x: dx, z: dz };
        }
        break;
      }
    }
  }
  return { pen: mejor, dir };
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

  // ── LAS OTRAS DOS FUENTES DEL CLIENTE ────────────────────────────────────
  //
  // `CollisionSystem.collidesAt` une TRES, en este orden: la FRONTERA del
  // plano, el SUELO y las CAJAS de los objetos. Este guion montaba una sola, y
  // decía en su cabecera que montaba «el mismo cableado». Lo cazó QA, y la
  // diferencia no es cosmética: con la frontera puesta, 126 de los 6.007
  // puntos no salen dentro de la cota geométrica —su eje de menor penetración
  // da a un tile que NO EXISTE— y tienen que rodear. Salen igual, pero por otro
  // camino y en otro tiempo, y ese es justo el mundo en el que juega quien
  // carga una fixture.
  //
  // UN TILE SOLO con los ocho vecinos ausentes, que es lo que hay en el preset
  // `html-fixtures`: es el mundo MÁS sólido posible, con la frontera rodeando
  // al jugador por los cuatro lados.
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
    // El plan del tile INSTALADO, que es lo que pasa en cuanto la fixture
    // carga. Con él, la caja ciega de un objeto DEL TILE no se aplica —responde
    // su volumen, con sus vanos—, así que de las tres fuentes la que cambia los
    // números aquí es la frontera. Se montan las tres igualmente: lo que este
    // bloque afirma es que conduce el `collidesAt` del cliente, no una de sus
    // ramas.
    planAplicadoEn: () => true,
  };
  const objetos = w.objects.map((o) => ({
    pos: { x: o.position[0], z: o.position[2] },
    sizeXZ: { x: o.scale[0], z: o.scale[2] },
    category: o.category,
    dueno: { de: "tile", key: "0,0" },
  }));

  const deAyer = grids.map((g) => reglaDeAyer(g));
  const pasoDelSuelo = SIN_ESCAPE
    ? (desde, hasta) => deAyer.some((f) => f(desde, hasta, PLAYER_RADIUS_M))
    : (desde, hasta) => solidoBloquea(desde, hasta, PLAYER_RADIUS_M, suelo);

  // El MISMO orden que `world/collision.ts:99-105`.
  const bloquea = (desde, hasta) =>
    fronteraBloquea(desde, hasta, PLAYER_RADIUS_M, tiles) ||
    pasoDelSuelo(desde, hasta) ||
    aabbBloquea(desde, hasta, PLAYER_RADIUS_M, objetos, tiles);

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
  `NADIE SE QUEDA ENCERRADO · ${RUMBOS} rumbos · cableado ENTERO del cliente (frontera + suelo + cajas) · ` +
    `dos pasadas (penRef/v + ${MARGEN_S} s, luego ${LARGO_S} s) a ${FPS} fps · ` +
    `cuerpo ${PLAYER_RADIUS_M} m · ${VELOCIDAD.toFixed(2)} m/s`,
);
console.log(`    (regla de paso: ${SIN_ESCAPE ? "LA DE AYER (sabotaje QA_SIN_ESCAPE)" : "la del árbol"})`);
console.log("");

let totalSolidos = 0;
let totalSinSalida = 0;
let totalRodean = 0;
let minRumbosQueSacan = Infinity;
let lentosDeMas = 0;
let penDiscrepa = 0;
let maxDpen = 0;
let juntoALaFrontera = 0;
const contraejemplos = [];
const lentos = [];
const discrepan = [];
const arranque = Date.now();

for (const nombre of FIXTURES) {
  const mundo = mundoDeLaFixture(nombre);
  const { rect, suelo } = mundo;
  const ocupado = (p) => suelo.ocupado(p.x, p.z, PLAYER_RADIUS_M);

  let solidos = 0;
  let sinSalida = 0;
  let rodean = 0;
  let penMax = 0;
  let minRumbos = Infinity;
  let masLento = 0;

  for (let z = rect.minZ; z <= rect.maxZ; z += PASO_MALLA_M) {
    for (let x = rect.minX; x <= rect.maxX; x += PASO_MALLA_M) {
      const p = { x, z };
      if (!ocupado(p)) continue;
      solidos++;

      // LA REFERENCIA manda, y no la función bajo prueba: de aquí sale el
      // horizonte Y el límite del bloque 2.
      const ref = penetracionDeReferencia(suelo, x, z, PLAYER_RADIUS_M);
      const penRef = ref.pen;
      if (penRef > penMax) penMax = penRef;
      // ¿La salida más corta cae DENTRO del mundo conocido? Si no, la frontera
      // del plano la bloquea y la cota geométrica deja de ser alcanzable: hay
      // que rodear, y el límite de tiempo no aplica. Se cuenta y se dice.
      const dentroDelMundo =
        ref.dir !== null &&
        x + ref.dir.x * penRef >= rect.minX + PLAYER_RADIUS_M &&
        x + ref.dir.x * penRef <= rect.maxX - PLAYER_RADIUS_M &&
        z + ref.dir.z * penRef >= rect.minZ + PLAYER_RADIUS_M &&
        z + ref.dir.z * penRef <= rect.maxZ - PLAYER_RADIUS_M;
      if (!dentroDelMundo) juntoALaFrontera++;

      // Bloque 2, primera mitad: la penetración que devuelve el módulo tiene
      // que ser la MÍNIMA de verdad. Es lo que distingue «se sale por lo más
      // corto» de «se sale por donde sea», y con la referencia medida aparte
      // no puede inflarse con el defecto.
      const penModulo = penetracionEnSolido(x, z, PLAYER_RADIUS_M, suelo);
      const dpen = Math.abs(penModulo - penRef);
      if (dpen > maxDpen) maxDpen = dpen;
      if (dpen > PASO_REF_M) {
        penDiscrepa++;
        if (discrepan.length < 5) {
          discrepan.push(`${nombre}: (${x}, ${z}) · módulo ${penModulo.toFixed(2)} m · referencia ${penRef.toFixed(2)} m`);
        }
      }

      const corto = penRef / VELOCIDAD + MARGEN_S;
      let sacan = 0;
      let masRapido = Infinity;
      for (const forward of rosa) {
        const t = andarHasta((q) => ocupado(q), p, forward, mundo, corto);
        if (t === null) continue;
        sacan++;
        if (t < masRapido) masRapido = t;
      }

      if (sacan > 0) {
        if (sacan < minRumbos) minRumbos = sacan;
        // Bloque 2, segunda mitad: quien sale dentro de la cota geométrica sale
        // por el eje de menor penetración, que está en la rosa. Dos frames de
        // margen por el redondeo del paso, más el paso de la referencia.
        const tope = (penRef + PASO_REF_M) / VELOCIDAD + 2 / FPS;
        if (dentroDelMundo && masRapido > tope) {
          lentosDeMas++;
          if (lentos.length < 5) {
            lentos.push(`${nombre}: (${x}, ${z}) · penRef ${penRef.toFixed(2)} m ⇒ ${tope.toFixed(3)} s, tardó ${masRapido.toFixed(3)} s`);
          }
        }
        continue;
      }

      // SEGUNDA PASADA: el eje de menor penetración puede dar a un tile que NO
      // EXISTE, y entonces hay que RODEAR — legítimo, y más lento que la cota.
      // Se mide cuántos y cuánto tardan; lo que se AFIRMA sigue siendo que
      // salen.
      let rodeo = null;
      for (const forward of rosa) {
        const t = andarHasta((q) => ocupado(q), p, forward, mundo, LARGO_S);
        if (t !== null && (rodeo === null || t < rodeo)) rodeo = t;
      }
      if (rodeo === null) {
        sinSalida++;
        if (contraejemplos.length < 5) contraejemplos.push(`${nombre}: (${x}, ${z}) · penetración ${penRef.toFixed(2)} m`);
      } else {
        rodean++;
        if (rodeo > masLento) masLento = rodeo;
      }
    }
  }
  totalRodean += rodean;

  totalSolidos += solidos;
  totalSinSalida += sinSalida;
  if (minRumbos < minRumbosQueSacan) minRumbosQueSacan = minRumbos;
  console.log(
    `    ${nombre.padEnd(13)} · ${String(solidos).padStart(5)} puntos sólidos · sin salida: ${String(sinSalida).padStart(5)} · ` +
      `rodean: ${String(rodean).padStart(4)}${rodean ? ` (el más lento en ${masLento.toFixed(2)} s)` : ""} · ` +
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

if (totalRodean > 0) {
  console.log(
    `    · medido y no afirmado: ${totalRodean} de ${totalSolidos} puntos NO salen dentro de la cota geométrica y RODEAN.\n` +
      "      Su eje de menor penetración da a un tile que no existe, y la frontera del plano —que es sólida\n" +
      "      para el cliente— no se cruza. Salen igual, por otro camino: es el precio del rodeo, no un encierro.",
  );
}

console.log("");
console.log("2 · Y SE SALE POR LO MÁS CORTO: la penetración es la MÍNIMA, medida aparte, y el rumbo más rápido la respeta");
if (penDiscrepa === 0) {
  ok(
    `la penetración del módulo coincide con la medida de referencia en los ${totalSolidos} puntos ` +
      `(|Δ| máx ${maxDpen.toFixed(4)} m, tolerancia ${PASO_REF_M} m)`,
  );
} else {
  mal(
    "la penetración del módulo es la mínima de verdad",
    `${penDiscrepa} de ${totalSolidos} discrepan de la referencia en más de ${PASO_REF_M} m. Los primeros:\n      ` +
      discrepan.join("\n      "),
  );
}
if (lentosDeMas === 0) {
  ok(
    `y los que salen dentro de la cota lo hacen por el eje de menor penetración ` +
      `(mínimo ${minRumbosQueSacan === Infinity ? "—" : minRumbosQueSacan} de ${RUMBOS} rumbos sacan a tiempo). ` +
      `Quedan fuera de esa cuenta los ${juntoALaFrontera} puntos cuyo eje más corto sale del mundo conocido: ` +
      "ahí la frontera del plano lo bloquea y la cota deja de ser alcanzable",
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
