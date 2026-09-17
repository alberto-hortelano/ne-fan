#!/usr/bin/env node
/** LOS CANDADOS MIDEN EL MUNDO DEL CLIENTE — que el SUELO y el CABLEADO sobre
 *  los que se afirma «de aquí se sale» sean los del juego, y no una maqueta más
 *  floja.
 *
 *  ## De dónde sale
 *
 *  De la QA de la PR G1 de la tanda G (**#616**), y de dos cosas medidas ahí:
 *
 *   1. **El suelo.** `qa/nadie-se-queda-encerrado.mjs` nació montando el grid
 *      del plan con `crudo.volumes` —los volúmenes DECLARADOS— mientras el
 *      cliente instala `escena.__plan`, el plan COMPUESTO
 *      (`nefan-html/src/world/carga-de-tile.ts:335` → `applyPlanCollision`).
 *      `robledo_tile` y `puerto_tile` declaran CERO volumes y sacan del esquema
 *      sus 38 y 23, así que el candado corría sobre **960 celdas sólidas de
 *      1.608** y **2.144 de 3.072**: verde sobre un mundo un 40 % menos sólido
 *      que el de verdad. El ingeniero se lo encontró a sí mismo y lo arregló en
 *      los dos guiones que lo hacían. Esto es el censo que impide que vuelva a
 *      entrar por un TERCERO — la lección de la casa es que la lista de
 *      lectores se cuenta, no se recuerda.
 *   2. **El cableado.** Aquel guion conduce `pasoDelJugador` con UNA de las tres
 *      fuentes que el cliente une en `collidesAt` (`solidoBloquea` sobre el
 *      suelo del tile), y deja fuera `fronteraBloquea` y `aabbBloquea`. Con las
 *      TRES montadas, 426 de sus 6.007 puntos salen por donde el cliente NO
 *      deja —fuera del rect del tile, contra la frontera del plano— y 126 dejan
 *      de salir dentro del horizonte que aquel guion se concede. Se sale igual,
 *      pero tardando más: eso es lo que este guion mide y afirma.
 *
 *  ## Qué afirma, y sobre qué
 *
 *   1. **CENSO DEL SUELO**: todo `planCollisionGrid(` de todo `.mjs` bajo `qa/` monta el
 *      plan COMPUESTO. Se leen los ficheros del árbol, no una lista escrita
 *      aquí: un guion nuevo que copie el error entra en el censo el día que
 *      nace. Con su control — si el patrón deja de encontrar llamadas, el
 *      bloque no está midiendo nada y lo dice.
 *   2. **Y ESE SUELO ES OTRO MUNDO**: en `robledo_tile` y `puerto_tile` el
 *      compuesto tiene ESTRICTAMENTE más celdas sólidas que el declarado, y en
 *      `zorder_test` las mismas (ahí sí se declaran los tres volúmenes). Sin
 *      esta diferencia medida, el bloque 1 sería una regla de estilo; con ella,
 *      es la cuenta de lo que se dejaba de mirar.
 *   3. **CON LAS TRES FUENTES TAMPOCO HAY ENCIERRO**: de todo punto sólido de
 *      las tres fixtures se sale andando con el `collidesAt` del cliente entero
 *      —frontera del plano + suelo de los dos grids unido + cajas de los
 *      objetos, en ese orden—, en un tile SOLO, que es el mundo más cerrado que
 *      puede haber (los ocho vecinos ausentes). Se prueba en DOS pasadas: la
 *      primera con el horizonte derivado del otro guion (`pen / v + 0,25 s`) y
 *      parando en el primer rumbo que saca; solo los puntos a los que ese
 *      presupuesto no les llega pagan la segunda, con horizonte largo y los 36
 *      rumbos. Y MIDE, sin afirmarlo, **cuántos pasan a la segunda**: hoy 126
 *      de 6.007 (robledo 2 · puerto 124), y el más lento de ellos sale en
 *      1,42 s. Ese número es lo que cuesta el rodeo de la frontera, y es toda
 *      la diferencia entre los dos cableados.
 *
 *  ## Contrato de salida (es un CANDADO)
 *
 *    0  el suelo de los candados es el del cliente y con las tres fuentes se
 *       sale de todas partes
 *    1  algún guion monta el plan declarado, o el compuesto dejó de ser más
 *       sólido, o hay un punto del que no se sale
 *
 *  ## Probado en negativo, y se puede volver a probar
 *
 *    QA_SUELO_CRUDO=1 node qa/los-candados-miden-el-mundo-del-cliente.mjs
 *      monta el suelo con `crudo.ground`/`crudo.volumes` → bloque 2 **rojo**
 *      (960 en uso contra 1.608 del cliente, 2.144 contra 3.072) y el bloque 3
 *      midiendo otro mundo: 3.941 puntos sólidos en vez de 6.007. exit 1.
 *    QA_REGLA_DE_AYER=1 node qa/los-candados-miden-el-mundo-del-cliente.mjs
 *      cablea la regla de paso de ANTES de #616 —la exención por celdas,
 *      escrita aquí y no en el árbol— → bloque 3 **rojo**, 3.117 de 6.007 sin
 *      salida. exit 1.
 *    El bloque 1 se prueba cambiando `w.__plan?.volumes` por `crudo.volumes` en
 *      cualquier guion de `qa/` y volviendo a correr esto: sale rojo nombrando
 *      el fichero y la línea (probado sobre `la-puerta-de-la-reaparicion.mjs`,
 *      2026-09-17).
 *
 *  Sin navegador, sin stack y sin créditos: son `nefan-core/dist`, las fixtures
 *  del árbol y aritmética. **16 s** medidos en árbol limpio (Ryzen 7 5800X,
 *  Node 24). Entra en el job `candados-headless` el día que nace.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatDToWorld } from "../nefan-core/dist/src/scene/scene-normalize.js";
import { planCollisionGrid } from "../nefan-core/dist/src/scene/blueprint/plan-collision.js";
import { createTerrainCollider, PLAYER_RADIUS_M } from "../nefan-core/dist/src/scene/terrain-collision.js";
import { penetracionEnSolido, solidoBloquea } from "../nefan-core/dist/src/simulation/salida-del-solido.js";
import { aabbBloquea, fronteraBloquea } from "../nefan-core/dist/src/simulation/obstaculos-del-jugador.js";
import { pasoDelJugador, velocidadDelJugador } from "../nefan-core/dist/src/simulation/paso-del-jugador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QA = path.join(RAIZ, "qa");
const FIXTURES = ["robledo_tile", "puerto_tile", "zorder_test"];
const PASO_MALLA_M = 0.5;
const RUMBOS = 36;
const FPS = 60;
/** EL HORIZONTE LARGO, para los puntos a los que el corto no les llega. No se
 *  deriva de la penetración, y ese es el punto: con la frontera del plano
 *  delante, el eje de menor penetración puede estar CERRADO y la salida es un
 *  rodeo que no tiene por qué caber en `pen / v`. 8 s son 33 m de camino, y la
 *  salida más lenta MEDIDA en las tres fixtures es de 1,42 s (×5,6 de margen)
 *  — el guion la imprime en cada corrida, que es cómo se ve si el margen se
 *  come. */
const HORIZONTE_S = 8;
/** El horizonte del OTRO guion, para medir —sin afirmarlo— cuánto cuesta la
 *  frontera: cuántos puntos salen, pero no dentro de ese presupuesto. */
const MARGEN_CORTO_S = 0.25;
const SUELO_CRUDO = process.env.QA_SUELO_CRUDO === "1";
const REGLA_DE_AYER = process.env.QA_REGLA_DE_AYER === "1";

/** UN frame sin moverse y el rumbo se abandona: `pasoDelJugador` es puro y la
 *  consulta cierra sobre la posición, así que un frame con delta cero se repite
 *  igual para siempre. Mismo razonamiento que el guion vecino. */
const FRAMES_QUIETO = 1;

const combate = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/combat_config.json"), "utf8"));
const VELOCIDAD = velocidadDelJugador(combate.player, false);

const fallos = [];
const ok = (linea) => console.log(`  ✔ ${linea}`);
const mal = (linea, detalle) => {
  console.log(`  ✖ ${linea}\n      ${detalle}`);
  fallos.push(linea);
};

// ── 1 · CENSO DEL SUELO ─────────────────────────────────────────────────────

/** Todos los `.mjs` bajo `qa/`, sin `node_modules`. */
function guionesDeQa(dir = QA) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre.startsWith(".")) continue;
    const completo = path.join(dir, nombre);
    if (statSync(completo).isDirectory()) salida.push(...guionesDeQa(completo));
    else if (nombre.endsWith(".mjs")) salida.push(completo);
  }
  return salida;
}

/** Las llamadas a `planCollisionGrid(` con su lista de argumentos, tal cual se
 *  escribieron. No se interpreta el código: se mira si el texto de la llamada
 *  nombra `__plan`, que es de dónde el cliente saca el plan. */
function llamadasDelPlan(texto) {
  const fuera = [];
  const marca = "planCollisionGrid(";
  let i = texto.indexOf(marca);
  while (i !== -1) {
    // La llamada acaba en su paréntesis de cierre; basta con equilibrar.
    let nivel = 0;
    let j = i + marca.length - 1;
    for (; j < texto.length; j++) {
      if (texto[j] === "(") nivel++;
      else if (texto[j] === ")" && --nivel === 0) break;
    }
    const args = texto.slice(i + marca.length, j);
    const linea = texto.slice(0, i).split("\n").length;
    fuera.push({ linea, args: args.replace(/\s+/g, " ").trim() });
    i = texto.indexOf(marca, j);
  }
  return fuera;
}

/** La ÚNICA exención, con su motivo escrito: este guion monta también el plan
 *  DECLARADO, a propósito, porque su bloque 2 mide la diferencia entre los dos.
 *  Que eso no tape nada lo sujeta ese mismo bloque, que afirma que el suelo EN
 *  USO es el compuesto. Una exención por fichero y no por línea porque lo que
 *  se exime es el PAPEL del fichero, no una llamada suelta. */
const EXENTOS = new Map([
  [
    "qa/los-candados-miden-el-mundo-del-cliente.mjs",
    "monta el declarado como CONTROL del bloque 2; su suelo en uso es el compuesto y ese bloque lo afirma",
  ],
]);

console.log("1 · CENSO DEL SUELO: todo guion que rasteriza el plan monta el COMPUESTO (`__plan`)");
const censo = [];
for (const fichero of guionesDeQa()) {
  const relativo = path.relative(RAIZ, fichero);
  if (EXENTOS.has(relativo)) continue;
  const texto = readFileSync(fichero, "utf8");
  for (const llamada of llamadasDelPlan(texto)) {
    censo.push({ fichero: relativo, ...llamada });
  }
}
for (const [fichero, motivo] of EXENTOS) console.log(`    ⊘ ${fichero} — EXENTO: ${motivo}`);
const declarados = censo.filter((c) => !c.args.includes("__plan"));
for (const c of censo) {
  console.log(`    ${c.args.includes("__plan") ? "·" : "!"} ${c.fichero}:${c.linea} — planCollisionGrid(${c.args.slice(0, 64)})`);
}
if (censo.length < 2) {
  mal(
    "hay llamadas a `planCollisionGrid` que censar",
    `encontradas ${censo.length}. O el patrón dejó de casar, o los guiones que montaban el plan se fueron: ` +
      "en los dos casos este bloque no está midiendo nada",
  );
} else if (declarados.length > 0) {
  mal(
    "ningún guion de qa/ monta el plan DECLARADO del crudo",
    `${declarados.length} lo hace(n):\n      ` +
      declarados.map((c) => `${c.fichero}:${c.linea} — planCollisionGrid(${c.args.slice(0, 80)})`).join("\n      ") +
      "\n      El cliente instala `escena.__plan` (carga-de-tile.ts → applyPlanCollision). Con el crudo se mide" +
      "\n      un mundo MENOS sólido y el candado sale verde sin ver los edificios del pueblo.",
  );
} else {
  ok(`las ${censo.length} llamadas de qa/ montan el plan compuesto`);
}

// ── 2 · Y ESE SUELO ES OTRO MUNDO ───────────────────────────────────────────

/** LA REGLA DE AYER (antes de #616), escrita aquí y no en el árbol: bloquea las
 *  celdas sólidas que solapa el DESTINO y no solapaba el ORIGEN, con la misma
 *  asimetría que tenía (destino cerrado, exención abierta). */
function reglaDeAyer(tg) {
  const { cols, rows, meters_per_cell: mpc } = tg;
  const [ox, oz] = tg.origin;
  const solidos = new Set(tg.solid_chars ?? []);
  const esSolida = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && solidos.has(tg.grid[r][c]);
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

function mundoDeLaFixture(nombre) {
  const crudo = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core/data/scenes", `${nombre}.json`), "utf8"));
  const w = formatDToWorld(crudo);
  const rect = w.world_rect;

  const gridCompuesto = planCollisionGrid(w.__plan?.ground, w.__plan?.volumes, rect);
  const gridDeclarado = planCollisionGrid(crudo.ground, crudo.volumes, rect);
  const celdas = (g) => (g ? (createTerrainCollider(g)?.solidCellCount ?? 0) : 0);

  const gridDelPlan = SUELO_CRUDO ? gridDeclarado : gridCompuesto;
  const grids = [w.terrain_grid, gridDelPlan].filter(Boolean);
  const colliders = grids.map((g) => createTerrainCollider(g)).filter(Boolean);

  // EL SUELO como lo monta `nefan-html/src/world/collision.ts`: los colliders
  // de los tiles tocados unidos en UNA consulta de punto.
  const suelo = { ocupado: (x, z, r) => colliders.some((c) => c.solapaSolido(x, z, r)) };

  // Las CAJAS de los objetos del tile, y el TILE visto por la frontera: un tile
  // SOLO, con los ocho vecinos ausentes, que es lo que hay en `html-fixtures`.
  const objetos = w.objects.map((o) => ({
    pos: { x: o.position[0], z: o.position[2] },
    sizeXZ: { x: o.scale[0], z: o.scale[2] },
    category: o.category,
    dueno: { de: "tile", key: "0,0" },
  }));
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

  const deAyer = grids.map((g) => reglaDeAyer(g));
  // EL ORDEN ES EL DEL CLIENTE (`CollisionSystem.collidesAt`): frontera, suelo,
  // cajas. Aquí no se colapsa en una sola fuente, que es el punto del guion.
  const bloquea = (desde, hasta) => {
    if (fronteraBloquea(desde, hasta, PLAYER_RADIUS_M, tiles)) return true;
    const terreno = REGLA_DE_AYER
      ? deAyer.some((f) => f(desde, hasta, PLAYER_RADIUS_M))
      : solidoBloquea(desde, hasta, PLAYER_RADIUS_M, suelo);
    if (terreno) return true;
    return aabbBloquea(desde, hasta, PLAYER_RADIUS_M, objetos, tiles);
  };

  return { rect, suelo, bloquea, celdasCompuesto: celdas(gridCompuesto), celdasDeclarado: celdas(gridDeclarado), celdasEnUso: celdas(gridDelPlan) };
}

const mundos = new Map(FIXTURES.map((n) => [n, mundoDeLaFixture(n)]));

console.log("");
console.log("2 · Y ESE SUELO ES OTRO MUNDO: el compuesto trae los edificios que el crudo no declara");
const flojos = [];
for (const [nombre, m] of mundos) {
  console.log(
    `    ${nombre.padEnd(13)} · celdas sólidas del plan: compuesto ${String(m.celdasCompuesto).padStart(5)} · ` +
      `declarado ${String(m.celdasDeclarado).padStart(5)} · EN USO ${String(m.celdasEnUso).padStart(5)}`,
  );
  if (m.celdasEnUso !== m.celdasCompuesto) {
    flojos.push(`${nombre}: el suelo en uso son ${m.celdasEnUso} celdas y el del cliente ${m.celdasCompuesto}`);
  }
}
const conDerivados = [...mundos].filter(([, m]) => m.celdasCompuesto > m.celdasDeclarado).length;
if (flojos.length) {
  mal("el suelo que se mide es el que instala el cliente", flojos.join("\n      "));
} else if (conDerivados < 2) {
  mal(
    "el compuesto y el declarado se distinguen",
    `solo ${conDerivados} fixture(s) tienen más celdas en el compuesto. Si las tres coincidieran, el bloque 1 ` +
      "sería una regla de estilo: lo que lo hace un candado es que la diferencia se NOTA",
  );
} else {
  ok(
    `el suelo en uso es el compuesto en las tres, y en ${conDerivados} de ellas trae celdas que el crudo no declara ` +
      `(robledo ${mundos.get("robledo_tile").celdasDeclarado} → ${mundos.get("robledo_tile").celdasCompuesto}, ` +
      `puerto ${mundos.get("puerto_tile").celdasDeclarado} → ${mundos.get("puerto_tile").celdasCompuesto})`,
  );
}

// ── 3 · CON LAS TRES FUENTES TAMPOCO HAY ENCIERRO ───────────────────────────

const rosa = [];
for (let i = 0; i < RUMBOS; i++) {
  const a = (i * 2 * Math.PI) / RUMBOS;
  rosa.push({ x: Math.cos(a), z: Math.sin(a) });
}

/** Un rumbo, conducido como lo conduce el juego: origen VIVO, W mantenida, 60
 *  fps. Devuelve los segundos que tardó en dejar de solapar, o `null`. */
function andarHasta(mundo, inicio, forward, horizonteS) {
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
    if (!mundo.suelo.ocupado(pos.x, pos.z, PLAYER_RADIUS_M)) return frame * delta;
  }
  return null;
}

console.log("");
console.log(
  `3 · CON LAS TRES FUENTES DEL CLIENTE (frontera + suelo + cajas) · ${RUMBOS} rumbos · horizonte ${HORIZONTE_S} s a ${FPS} fps · ` +
    `cuerpo ${PLAYER_RADIUS_M} m · ${VELOCIDAD.toFixed(2)} m/s`,
);
console.log(`    (regla de paso: ${REGLA_DE_AYER ? "LA DE AYER (sabotaje QA_REGLA_DE_AYER)" : "la del árbol"})`);

let totalSolidos = 0;
let totalSinSalida = 0;
let totalLentos = 0;
/** De los puntos que NO salen dentro del horizonte corto, el que tarda más en
 *  salir contando su rumbo más rápido. Se imprime para ver el margen que le
 *  queda al horizonte largo, no para afirmar nada. Los demás salen, por
 *  construcción, dentro de su horizonte corto (≤ 1,66 s con la penetración
 *  máxima de las fixtures). */
let salidaMasLenta = 0;
const contraejemplos = [];
const arranque = Date.now();

for (const [nombre, mundo] of mundos) {
  const { rect, suelo } = mundo;
  let solidos = 0;
  let sinSalida = 0;
  let lentos = 0;

  for (let z = rect.minZ; z <= rect.maxZ; z += PASO_MALLA_M) {
    for (let x = rect.minX; x <= rect.maxX; x += PASO_MALLA_M) {
      if (!suelo.ocupado(x, z, PLAYER_RADIUS_M)) continue;
      solidos++;
      const pen = penetracionEnSolido(x, z, PLAYER_RADIUS_M, suelo);
      const corto = pen / VELOCIDAD + MARGEN_CORTO_S;

      // DOS PASADAS, y no es una optimización gratis: la primera pregunta lo
      // mismo que `nadie-se-queda-encerrado.mjs` (¿sale dentro del horizonte
      // DERIVADO de su penetración?) y para en el primer rumbo que saca; solo
      // los puntos a los que ese presupuesto NO les llega pagan la segunda, con
      // el horizonte largo. El número de puntos que pasan a la segunda ES la
      // medida: es lo que cuesta tener la frontera del plano delante.
      let masRapido = null;
      for (const forward of rosa) {
        const t = andarHasta(mundo, { x, z }, forward, corto);
        if (t !== null) { masRapido = t; break; }
      }
      if (masRapido === null) {
        lentos++;
        // Aquí SÍ se miran los 36 y se toma el mínimo: son pocos puntos y lo
        // que se quiere saber es cuánto tarda de verdad el más rápido, que es
        // el margen que le queda al horizonte largo.
        for (const forward of rosa) {
          const t = andarHasta(mundo, { x, z }, forward, HORIZONTE_S);
          if (t !== null && (masRapido === null || t < masRapido)) masRapido = t;
        }
        if (masRapido !== null && masRapido > salidaMasLenta) salidaMasLenta = masRapido;
      }
      if (masRapido === null) {
        sinSalida++;
        if (contraejemplos.length < 5) contraejemplos.push(`${nombre}: (${x}, ${z}) · penetración ${pen.toFixed(2)} m`);
      }
    }
  }

  totalSolidos += solidos;
  totalSinSalida += sinSalida;
  totalLentos += lentos;
  console.log(
    `    ${nombre.padEnd(13)} · ${String(solidos).padStart(5)} puntos sólidos · sin salida: ${String(sinSalida).padStart(5)} · ` +
      `no salen en el horizonte corto de nadie-se-queda-encerrado: ${String(lentos).padStart(4)}`,
  );
}
console.log(
  `    (${((Date.now() - arranque) / 1000).toFixed(1)} s · de los que necesitan el rodeo, el más lento sale en ${salidaMasLenta.toFixed(2)} s, ` +
    `de un horizonte largo de ${HORIZONTE_S} s)`,
);
console.log("");

if (totalSinSalida === 0) {
  ok(`${totalSolidos} puntos sólidos y NINGUNO sin salida con las tres fuentes montadas`);
} else {
  mal(
    "con el cableado entero del cliente tampoco hay puntos sin salida",
    `${totalSinSalida} de ${totalSolidos} lo son. Los primeros:\n      ` + contraejemplos.join("\n      "),
  );
}
console.log(
  `    · medido y no afirmado: ${totalLentos} de ${totalSolidos} puntos NO salen dentro de ` +
    `\`pen / v + ${MARGEN_CORTO_S} s\`, la cota geométrica.\n` +
    "      Su eje de menor penetración da a un tile que NO EXISTE, así que la frontera del plano lo bloquea y hay\n" +
    "      que rodear: salen igual, por otro camino. Ese número es lo que cuesta el rodeo.\n" +
    "      (Este guion nació midiéndolo porque `qa/nadie-se-queda-encerrado.mjs` montaba UNA de las tres fuentes;\n" +
    "       hoy monta las tres y lo cuenta él también, así que los dos números tienen que coincidir. Que se midan\n" +
    "       por caminos distintos es a propósito: es lo que convierte esto en un control y no en un eco.)",
);

console.log("");
if (fallos.length) {
  console.log(`✖ ${fallos.length} aserto(s) en rojo:`);
  for (const f of fallos) console.log(`   · ${f}`);
  process.exit(1);
}
console.log("✔ el suelo y el cableado de los candados son los del cliente (#616)");
process.exit(0);
