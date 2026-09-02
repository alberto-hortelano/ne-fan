#!/usr/bin/env node
/** Runner de guiones de QA — el brazo ejecutable del rol `qa`.
 *
 *  El informe de QA sigue siendo juicio de usuario (crítica visual, fricción,
 *  workarounds): eso no se automatiza. Lo que sí se automatiza es la parte que
 *  hoy se re-verificaba a mano cada vez — "el jugador camina hasta ahí y no
 *  atraviesa el agua" — y que sin script solo existe como prosa que alguien
 *  tiene que creerse.
 *
 *  Conduce el juego REAL por el mismo camino que el jugador: el provider
 *  `scripted` (?input=scripted) y la API de bench `window.__nefan`. Nunca lee
 *  píxeles y nunca espera por tiempo de pared — el movimiento va por delta de
 *  rAF y el typewriter por setInterval, así que ningún `sleep` es
 *  determinista: se espera por ESTADO.
 *
 *  La corrida es HERMÉTICA: el stack arranca contra `qa/.tmp/<runid>/{saves,
 *  games}` (NEFAN_SAVES_DIR / NEFAN_GAMES_DIR), copia real de `data/games` sin
 *  mundos pre-generados, y ese directorio se borra al salir. Así una corrida no
 *  hereda el disco de la anterior. Dentro de una corrida, cada guion declara qué
 *  necesita virgen con `export const aisla = ["saves"|"mundo"|"fake-ai"]` y el
 *  runner ejecuta SOLO eso antes de lanzarlo — la precondición de cada guion,
 *  escrita, que hasta ahora no existía en ningún sitio.
 *
 *  El guardarraíl de cero créditos se ejerce para TODOS los guiones, y el que
 *  no toque el motor lo declara con `export const sinMotor = "<motivo>"`. El
 *  defecto es el caro a propósito: olvidarse de declarar deja el guion GATEADO
 *  —`⊘ SIN MEDIR` y cero peticiones DESDE EL GUION si el backend no declara ser
 *  falso—, no suelto contra un motor que cobra (#295). Cero desde el guion, no
 *  cero a secas: el gate manda sus dos `/health` y la página ya ha cargado
 *  (`/dev/status` entre otras). Ninguna de esas es de pago, que es lo que se
 *  garantiza; el cuerpo del guion, que es quien pediría generación, no llega a
 *  ejecutarse.
 *
 *  Uso:
 *    node qa/run.mjs                  todos los guiones
 *    node qa/run.mjs colision hud     solo los que casen con esos nombres
 *    node qa/run.mjs --headed         con ventana, para mirar qué hace
 *    node qa/run.mjs --keep           deja el stack arriba y el tmp sin borrar
 *    node qa/run.mjs --url URL        usa un stack ya arrancado, en esa URL
 *    node qa/run.mjs --adoptar        usa el stack que ya esté en los puertos
 *                                     del catálogo (sin esto, encontrárselos
 *                                     ocupados es un error: puede ser el de
 *                                     otro agente de la máquina)
 *    node qa/run.mjs --orden inverso  al revés (criterio: mismo veredicto)
 *    node qa/run.mjs --diag           una línea de diagnóstico por guion
 *
 *  Código de salida — son TRES, porque el veredicto de la corrida no es la
 *  suma de los veredictos de los guiones:
 *    0  todo verde
 *    1  hay guiones en rojo, y todos midieron: es el juego
 *    2  algo no llegó a medir (stack caído, precondición perdida, el runner
 *       murió): la corrida NO dice nada del juego, ni bueno ni malo
 */
import { chromium } from "playwright-core";
import { abrirNavegador } from "./lib/navegador.mjs";
// El guardarraíl de gasto lo ejerce el RUNNER, no cada guion (#295): la
// obligación de preguntar no puede vivir en un prólogo que se copia a mano.
import { diagnosticoDeCreditos } from "./lib/sesion.mjs";
import { PUERTOS, PUERTOS_BASE, URLS, offsetActual } from "./lib/stack.mjs";
// El sondeo y la espera por puerto viven en UN sitio: llegó a haber cinco
// copias con relojes ya divergidos (500 ms / 800 ms), y la que elige el
// bloque decide si dos corridas colisionan — el criterio 3 entero.
import { puertoOcupado, esperarPuertoArriba } from "./lib/puertos.mjs";
import { VERDE, ROJO, SIN_MEDIR, ICONO, exitDeCorrida } from "./lib/veredictos.mjs";
import { ctxDeSonda } from "./lib/sonda.mjs";
import {
  esperaExpiradaEn,
  fallosDeEsperasEnVuelo,
  fallosDeEsperasPendientes,
  huboSondeo,
  quejaDelMotivo,
} from "./lib/esperas.mjs";
import { spawn } from "node:child_process";
import {
  readdirSync,
  mkdirSync,
  rmSync,
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Cuánto se le da a una espera que el guion dejó EN VUELO para que se pose
 *  antes de leer el libro (#261, hallazgo 1 de QA).
 *
 *  Hace falta un tope y no un `await` a secas: una espera suelta puede llevar
 *  240 s de cortafuegos, y el runner no puede quedarse ahí. Lo que no se posa
 *  en este margen es un fallo por sí mismo —nadie la esperó, así que no
 *  decidió nada—, así que el tope no perdona: solo acota lo que se espera.
 *  Con el árbol de hoy no se gasta ni un ms: ningún guion deja esperas
 *  sueltas, y el drenaje solo corre cuando hay algo abierto. */
const DRENAJE_DE_ESPERAS_MS = 5_000;


const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
/** Raíz de capturas; las de ESTA corrida cuelgan de `SHOTS` (ver `RUN_ID`). */
const RAIZ_SHOTS = join(here, "capturas");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
/** Opciones que llevan valor: su valor NO es un filtro de nombre de guion. */
const CON_VALOR = new Set(["--url", "--orden"]);
const filters = args.filter((a, i) => !a.startsWith("--") && !CON_VALOR.has(args[i - 1]));

const HEADED = flag("--headed");
const KEEP = flag("--keep");
const DIAG = flag("--diag");
/** Adoptar un stack que ya estaba arriba. Ver `ensureStack`: dejó de ser el
 *  comportamiento por defecto porque con dos agentes en la máquina "ya hay un
 *  stack" no significa "el mío". */
const ADOPTAR = flag("--adoptar");
const ORDEN = opt("--orden", "alfabetico");

/** ¿Sigue vivo ese pid? (señal 0: no manda nada, solo pregunta.) */
function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Reserva EXCLUSIVA de un bloque de puertos, o null si es de otro.
 *
 *  Hace falta además del sondeo de puertos porque el sondeo tiene una carrera
 *  que se ve justo en el caso que esto viene a permitir: dos corridas que
 *  arrancan a la vez sondean el bloque +0, las dos lo ven libre y las dos
 *  intentan levantarlo. El fichero se crea con `wx` (falla si existe), que es
 *  atómico en el sistema de ficheros — la carrera la resuelve el kernel, no la
 *  suerte. Un lock cuyo dueño ya murió se reclama. */
const DIR_BLOQUES = join(here, ".tmp", ".bloques");
function reservarBloque(off) {
  mkdirSync(DIR_BLOQUES, { recursive: true });
  const f = join(DIR_BLOQUES, `${off}.lock`);
  const tomar = () => {
    try {
      writeFileSync(f, `${process.pid}\n`, { flag: "wx" });
      return f;
    } catch {
      return null;
    }
  };
  const tomado = tomar();
  if (tomado) return tomado;
  const dueño = Number(readFileSync(f, "utf8").trim());
  if (pidVivo(dueño)) return null;
  rmSync(f, { force: true }); // lock huérfano: su corrida murió a lo bruto
  return tomar();
}

/** El bloque de puertos de ESTA corrida.
 *
 *  El launcher NO elige solo —una persona quiere URLs predecibles y prefiere
 *  que se le diga «ocupado»—, pero el banco sí: es una máquina que solo quiere
 *  terminar, y con dos agentes trabajando a la vez «los puertos de siempre»
 *  puede ser el stack del otro. Se prueban 0, +100 … +900 y se coge el primero
 *  que esté LIBRE (puertos sin nadie) y RESERVABLE (nadie más lo ha pedido).
 *
 *  Se respeta un `NEFAN_PORT_OFFSET` que ya venga del entorno (quien lo pone
 *  sabe lo que quiere) y no se busca nada al adoptar un stack ajeno. */
let lockDelBloque = null;
async function elegirBloque() {
  if (process.env.NEFAN_PORT_OFFSET) return offsetActual();
  if (ADOPTAR || flag("--url")) return 0;
  const claves = ["fake_ai", "bridge", "html"];
  for (let off = 0; off <= 900; off += 100) {
    const lock = reservarBloque(off);
    if (!lock) continue; // otra corrida ya lo pidió
    // Al PRIMER puerto ocupado se abandona el bloque: los otros dos ya no
    // pueden cambiar la respuesta, y con varios stacks arriba eran hasta 27
    // conexiones en serie para contestar lo mismo.
    let libre = true;
    for (const k of claves) {
      if (await puertoOcupado(PUERTOS_BASE[k] + off)) {
        libre = false;
        break;
      }
    }
    if (libre) {
      lockDelBloque = lock;
      return off;
    }
    rmSync(lock, { force: true }); // reservado pero ocupado por alguien de fuera
  }
  throw new Error(
    "los diez bloques de puertos (+0…+900) están ocupados: hay demasiados stacks arriba en esta máquina",
  );
}

const OFFSET = await elegirBloque();
// Se pone en el entorno de ESTE proceso para que lo hereden los guiones (que
// leen `URLS`/`PUERTOS` al importarse, más abajo) y el `./start.sh` que se
// lanza a continuación. Es el único sitio donde se decide.
process.env.NEFAN_PORT_OFFSET = String(OFFSET);
if (OFFSET) console.log(`· bloque de puertos +${OFFSET} (bridge :${PUERTOS.bridge}, HTML :${PUERTOS.html})`);

const BASE = opt("--url", URLS.html);
/** El motor falso al que se apunta la página. NO es el guardarraíl de gasto —
 *  eso lo decide el guardarraíl del runner preguntándole al backend—: es
 *  simplemente a dónde se manda al cliente, y sale de la fuente única de
 *  puertos, no de un literal escrito aquí. */
const MOTOR_FALSO = URLS.fake_ai;
/** Identidad de la corrida. Lleva el PID además del reloj porque dos corridas
 *  simultáneas pueden nacer en el mismo milisegundo, y todo lo que esta
 *  corrida POSEE —tmp, saves, capturas, logs— cuelga de este nombre. */
const RUN_ID = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const TMP = join(here, ".tmp", RUN_ID);
/** Capturas de ESTA corrida. Antes eran `qa/capturas/` a secas, se borraba
 *  entera al arrancar y los nombres no llevaban corrida: dos baterías a la vez
 *  se pisaban los ficheros y la primera se quedaba sin sus pruebas. */
const SHOTS = join(RAIZ_SHOTS, RUN_ID);
/** Los nueve logs del stack, dentro del disco efímero. `NEFAN_LOG_DIR` existía
 *  desde siempre en `start.sh` y no lo ponía nadie, así que las dos corridas
 *  escribían en los MISMOS `/tmp/nefan-*.log`, truncándolos, y cruzando
 *  worktrees. */
const TMP_LOGS = join(TMP, "logs");
const TMP_SAVES = join(TMP, "saves");
const TMP_GAMES = join(TMP, "games");
/** Los plugins COMUNES a todos los mundos viven al lado de `games/`, y el
 *  loader los busca ahí mismo (`{gamesDir}/../plugins`). Si el disco efímero
 *  solo copia `games/`, TODA corrida de QA juega sin `economy` —el sistema que
 *  mueve `player.gold`— y una partida de bench deja de ser la del jugador. */
const TMP_PLUGINS = join(TMP, "plugins");
const GAMES_ORIGEN = join(repoRoot, "nefan-core", "data", "games");
const PLUGINS_ORIGEN = join(repoRoot, "nefan-core", "data", "plugins");
/** ?raf=timer: en headless la pestaña no está "visible" y el rAF se pausaría;
 *  el pump por Web Worker mantiene el game loop vivo. */
/** `&offset=`: el navegador no tiene entorno, así que el bloque de puertos de
 *  esta corrida viaja en la URL. Sin él, la página resolvería la State API
 *  —que no tiene override propio como `?ai=` o `?bridge=`— al bloque de
 *  siempre, o sea al stack del otro agente. Con offset 0 no se escribe: la URL
 *  del uso de una sola persona no cambia ni un carácter. */
const URL_QS =
  `?input=scripted&ai=${encodeURIComponent(MOTOR_FALSO)}&raf=timer` +
  (OFFSET ? `&offset=${OFFSET}` : "");

// Los TRES veredictos y el exit viven en la escala ÚNICA (`lib/veredictos.mjs`)
// desde #331: `presets-clasifica` tenía una escala paralela con el mismo `⊘` y
// la equivalencia solo existía en prosa.

/** Arranca el preset `e2e-sin-creditos` (fake-ai + bridge + cliente, cero
 *  créditos) por el mismo camino que usaría una persona:
 *  `./start.sh --preset e2e-sin-creditos`. Si el stack ya está arriba, no toca
 *  nada. Por SLUG y no por número: el número se desplaza al morir un preset. */
const PUERTOS_DEL_STACK = [
  [PUERTOS.fake_ai, "fake-ai-server"],
  [PUERTOS.bridge, "bridge"],
  [PUERTOS.html, "cliente HTML"],
];

/** Los servicios del stack que NO contestan. Vacío = stack en pie.
 *
 *  Se sondea DESPUÉS DE CADA GUION porque un stack que se cae a mitad de la
 *  batería convierte en rojo todo lo que venga detrás, y esos rojos no son del
 *  juego: son del cadáver (#272 — «9/23 que en realidad eran 14»). Cuesta tres
 *  conexiones TCP que, con el puerto vivo, resuelven en el acto. */
async function serviciosCaidos() {
  const caidos = [];
  for (const [port, label] of PUERTOS_DEL_STACK) if (!(await puertoOcupado(port))) caidos.push(`${label} (:${port})`);
  return caidos;
}

async function ensureStack() {
  // `vivos` y `ocupados` eran la misma lista con dos nombres, y de `vivos`
  // solo se leía `.length`.
  const ocupados = [];
  for (const [port, label] of PUERTOS_DEL_STACK) {
    if (await puertoOcupado(port)) ocupados.push(`${label} (:${port})`);
  }
  if (ocupados.length === PUERTOS_DEL_STACK.length) {
    // Adoptar un stack que ya estaba dejó de ser el defecto. Cuando en la
    // máquina trabaja un solo agente, "los tres puertos están arriba" y "el
    // stack es mío" son la misma frase; con dos agentes deja de serlo, y el
    // desenlace es el peor de todos: la batería sale VERDE midiendo el código
    // del otro, con su disco y su motor. Se pide explícitamente o es un error
    // que dice quién ocupa cada puerto.
    if (!ADOPTAR && !flag("--url")) {
      throw new Error(
        `los puertos del stack ya están ocupados (${ocupados.join(", ")}) y esta corrida no ` +
          `los arrancó. Puede ser tu stack de desarrollo, el huérfano de una corrida que murió, ` +
          `o el de OTRO agente en esta máquina: desde aquí no se distingue.\n` +
          `  · para medir contra él a propósito:  node qa/run.mjs --adoptar   (o --url <URL>)\n` +
          `  · para tener stack propio: párale el suyo a quien sea suyo, o arranca esta corrida ` +
          `en otro bloque de puertos.`,
      );
    }
    console.log("· stack ya arriba — lo adopto (--adoptar/--url), no lo toco");
    return null;
  }
  if (ocupados.length > 0) {
    // Medio stack en pie no es un stack: arrancar encima daría fallos raros
    // (puerto ocupado, cliente sin backend) en vez de un error claro.
    throw new Error(
      `hay servicios sueltos arriba (${ocupados.join(", ")}) pero el stack está incompleto. ` +
        `Párralo del todo (Ctrl+C en su terminal, o ./start.sh --parar) y vuelve a lanzar.`,
    );
  }
  // Por SLUG, no por número: los números de preset se renumeran cuando muere
  // uno, y entonces esto levantaría otro stack y fallaría por timeout sin decir
  // por qué.
  console.log("· arrancando ./start.sh --preset e2e-sin-creditos…");
  console.log(`· disco efímero: ${TMP}`);
  const child = spawn("./start.sh", ["--preset", "e2e-sin-creditos"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    // Disco propio de la corrida: sin esto la batería lee y ESCRIBE en los
    // saves y los mundos pre-generados del repo, y la corrida N deja el disco
    // distinto para la N+1 (medido: el snapshot de mundo cambiaba de md5 cada
    // vez). El bridge respeta las dos variables (ws-server.ts:46,52) y
    // start.sh las hereda del entorno.
    //
    // NEFAN_LOG_DIR entra por el mismo motivo y llevaba desde siempre sin que
    // nadie la pusiera: los nueve logs del stack son nombres FIJOS y truncan,
    // así que dos corridas —o dos worktrees— se sobreescribían el diagnóstico
    // la una a la otra justo cuando hacía falta leerlo.
    env: {
      ...process.env,
      NEFAN_SAVES_DIR: TMP_SAVES,
      NEFAN_GAMES_DIR: TMP_GAMES,
      NEFAN_LOG_DIR: TMP_LOGS,
      NEFAN_PORT_OFFSET: String(OFFSET),
    },
  });
  child.stdout.on("data", (b) => process.env.QA_VERBOSE && process.stdout.write(`  | ${b}`));
  child.stderr.on("data", (b) => process.env.QA_VERBOSE && process.stderr.write(`  ! ${b}`));
  for (const [port, label] of PUERTOS_DEL_STACK) await esperarPuertoArriba(port, { quien: label });
  console.log("· stack listo");
  return child;
}

/** El stack que arrancó ESTA corrida (null = ya había uno). Lo guarda el
 *  módulo para que el manejador de señales pueda matarlo: sin esto, un Ctrl+C
 *  dejaba el stack vivo y el tmp en el disco, y la corrida siguiente detectaba
 *  «puertos arriba», se saltaba TODOS los `aisla` y daba rojos falsos. */
let stackPropio = null;
let saliendo = false;
/** ¿Había otra batería viva cuando ésta arrancó? Gobierna el aviso de que
 *  `qa/capturas/ultima` puede no ser la de esta corrida. */
let huboOtraCorrida = false;

/** `qa/capturas/ultima` → las capturas de ESTA corrida.
 *
 *  DOS FALLOS distintos vivían aquí, y los dos los introdujo esta tanda:
 *
 *  1. `rmSync(enlace, {force:true})` SIGUE el enlace, y sobre uno que apunta a
 *     un directorio lanza `ERR_FS_EISDIR`. El `symlinkSync` de la línea
 *     siguiente no llegaba a ejecutarse nunca y el `catch` lo degradaba a un
 *     aviso, así que el enlace se congeló en la PRIMERA corrida que lo creó y
 *     ninguna posterior lo movió. Quien mirara ahí para una revisión visual
 *     estaba viendo otra corrida sin que nada se lo dijera — el «verde que mide
 *     otra cosa» mudado al trabajo de QA. `unlinkSync` retira el ENLACE sin
 *     seguirlo, que es la primitiva correcta; y si algún día `ultima` fuera un
 *     directorio de verdad, lanza en vez de borrar las capturas de alguien.
 *
 *  2. Es un puntero GLOBAL: solo puede señalar a una corrida, así que con dos a
 *     la vez una de las dos miente por definición. No hay forma de arreglarlo
 *     —un puntero único no puede tener dos dueños—, así que lo que se hace es
 *     DECIDIR qué significa y decirlo: `ultima` es **la última corrida que
 *     TERMINÓ** en este checkout. Por eso se repunta desde `salir()` y no al
 *     arrancar. Y cuando la corrida sabe que había otra viva, lo AVISA: quien
 *     revise capturas necesita saber que ese enlace puede no ser el suyo.
 *     `qa/dos-corridas.mjs` afirma las dos mitades. */
function apuntarUltima() {
  const enlace = join(RAIZ_SHOTS, "ultima");
  try {
    try {
      unlinkSync(enlace);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    symlinkSync(RUN_ID, enlace);
    if (huboOtraCorrida) {
      console.log(
        `· OJO: había otra corrida viva. qa/capturas/ultima apunta a la ÚLTIMA en terminar,\n` +
          `       que puede no ser ésta. Las tuyas están en ${SHOTS}`,
      );
    }
  } catch (err) {
    // Un enlace que no se puede poner no invalida la corrida: las capturas
    // están en su sitio y se dice dónde. Pero se dice, no se traga.
    //
    // `EEXIST` es su propio caso y NO es un fallo: entre el `unlink` y el
    // `symlink` hay dos syscalls, y con dos corridas terminando a la vez la
    // otra puede colarse justo ahí. Decir «sin enlace» cuando el enlace existe
    // —apuntando a la otra corrida— sería la misma mentira que este arreglo
    // viene a quitar, en el mensaje en vez de en el enlace.
    if (err.code === "EEXIST") {
      console.log(`· otra corrida se llevó qa/capturas/ultima por unos ms — las tuyas están en ${SHOTS}`);
    } else {
      console.log(`· sin enlace qa/capturas/ultima (${err.message}) — están en ${SHOTS}`);
    }
  }
}

/** Única salida del runner: apaga lo que arrancó esta corrida y borra su tmp.
 *  La llaman el final feliz, el error y las señales — un Ctrl+C no puede dejar
 *  el disco ni los puertos en un estado que envenene la corrida siguiente. */
function salir(code, motivo) {
  if (saliendo) return;
  saliendo = true;
  if (motivo) console.log(`\n· ${motivo}`);
  if (stackPropio && !KEEP) {
    try {
      process.kill(-stackPropio.pid, "SIGINT");
    } catch {
      console.log("· el stack ya no estaba");
    }
  } else if (stackPropio) {
    console.log("· stack sigue arriba (--keep)");
  }
  if (!KEEP) rmSync(TMP, { recursive: true, force: true });
  else console.log(`· disco efímero sin borrar: ${TMP}`);
  apuntarUltima();
  // El bloque de puertos vuelve al pozo aunque la corrida muera mal. Si no
  // llegara a soltarse, la siguiente lo reclama al ver que su dueño no existe.
  if (lockDelBloque) rmSync(lockDelBloque, { force: true });
  process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => salir(130, `${sig}: apagando el stack y borrando ${TMP}`));
}

/** Morir por una excepción tampoco puede dejar el stack vivo (#283).
 *
 *  Sin esto, una promesa rechazada sin `.catch()` mataba el proceso por la
 *  puerta de atrás: `salir()` no corría, el stack se quedaba arriba apuntando a
 *  un `qa/.tmp/<runid>` que la corrida SIGUIENTE borraba nada más empezar, y
 *  esa corrida heredaba un stack sin disco — treinta guiones con `Timeout
 *  30000ms` y ni una línea diciendo por qué. Le pasó dos veces a QA validando
 *  #279. El precedente del patrón está en `bridge/ws-server.ts`; aquí NO se
 *  perdona el fallo, se apaga limpio y se sale con 2 («la corrida no es un
 *  veredicto»), que es lo contrario de tragárselo. */
for (const evento of ["unhandledRejection", "uncaughtException"]) {
  process.on(evento, (err) => {
    console.error(`runner: ${evento}:`, err);
    salir(2, `${evento} — apagando el stack y borrando ${TMP} antes de morir`);
  });
}

/** ¿Sigue vivo el proceso que escribió este `vivo.pid`? */
function corridaViva(dir) {
  const marca = join(dir, "vivo.pid");
  if (!existsSync(marca)) return false; // sin marca no hay dueño: es basura
  return pidVivo(Number(readFileSync(marca, "utf8").trim()));
}

/** Restos de corridas que murieron a lo bruto — y SOLO esos.
 *
 *  Antes esto borraba todo `qa/.tmp/*` que no fuera el suyo, con el argumento
 *  de que «dos baterías a la vez no pueden convivir: comparten puertos». Ese
 *  argumento es justo el que esta tanda deroga: con dos agentes en la máquina,
 *  el directorio que se borraba podía ser el disco VIVO del otro, arrancado
 *  bajo los pies de una corrida en marcha. Ahora cada corrida deja su
 *  `vivo.pid` y aquí solo se barre lo que ya no tiene dueño. */
function limpiarTmpViejos() {
  const raiz = join(here, ".tmp");
  if (!existsSync(raiz)) return;
  const candidatos = readdirSync(raiz)
    .filter((d) => !d.startsWith(".")) // .bloques: los locks de puertos, no son corridas
    .filter((d) => join(raiz, d) !== TMP);
  const muertos = candidatos.filter((d) => !corridaViva(join(raiz, d)));
  const vivos = candidatos.length - muertos.length;
  for (const d of muertos) rmSync(join(raiz, d), { recursive: true, force: true });
  if (muertos.length) console.log(`· ${muertos.length} tmp de corridas muertas borrados`);
  if (vivos) {
    huboOtraCorrida = true;
    console.log(`· ${vivos} tmp de corridas VIVAS respetados (otra batería está corriendo)`);
  }
}

/** Disco efímero de la corrida: copia REAL de `data/games` (lo mismo que tiene
 *  el jugador) menos los mundos ya pre-generados — el mundo se genera dentro de
 *  la corrida por el camino del jugador, no se copia de un artefacto rancio.
 *  Copiarlo sería heredar justo lo que esto viene a cortar. */
function prepararDisco() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP_SAVES, { recursive: true });
  mkdirSync(TMP_LOGS, { recursive: true });
  // La marca de propiedad: mientras este proceso viva, este directorio tiene
  // dueño y ninguna otra corrida puede borrarlo (ver `limpiarTmpViejos`).
  writeFileSync(join(TMP, "vivo.pid"), `${process.pid}\n`, "utf8");
  cpSync(GAMES_ORIGEN, TMP_GAMES, { recursive: true });
  if (existsSync(PLUGINS_ORIGEN)) cpSync(PLUGINS_ORIGEN, TMP_PLUGINS, { recursive: true });
  limpiarMundos();
}

/** Borra los artefactos de mundo pre-generado del disco efímero: es lo que pide
 *  `aisla: ["mundo"]`. Las aplicaciones de estilo (`world/styles/`) NO se tocan
 *  aquí: las invalida `generate_game` al escribir el snapshot nuevo, que es el
 *  camino real y el que corre a continuación. */
function limpiarMundos() {
  let borrados = 0;
  for (const juego of readdirSync(TMP_GAMES)) {
    const world = join(TMP_GAMES, juego, "world");
    if (!existsSync(world)) continue;
    for (const f of readdirSync(world)) {
      if (f.endsWith(".json")) {
        rmSync(join(world, f), { force: true });
        borrados++;
      }
    }
  }
  return borrados;
}

/** Cuántas peticiones a rutas DE PAGO lleva servidas el motor falso.
 *
 *  Es la red PEQUEÑA del guardarraíl (#295), y conviene no venderla por más de
 *  lo que es: caza al que declara `sinMotor` y sí gasta — o sea, al que se
 *  equivoca al declarar. Del que se OLVIDA de declarar no se ocupa esto, sino
 *  el gate de `main()`, que se ejerce por defecto y no depende de nadie; por
 *  eso es el gate quien da la garantía y esto solo la complementa.
 *
 *  La lista de rutas de pago NO vive aquí —sería una segunda copia del contrato
 *  de gasto—: la marca está en la misma línea que la ruta, dentro del motor
 *  falso (`dePago(...)` en labs/narrative/fake-ai-server.ts).
 *
 *  `null` cuando no se puede preguntar (una corrida `--url`/`--adoptar` contra
 *  un backend que no es el fake). Eso NO se colapsa con «no gastó»: se dice una
 *  vez al arrancar que esta red no está puesta. */
async function gastoDelFake() {
  try {
    const r = await fetch(`${MOTOR_FALSO}/dev/counters`);
    if (!r.ok) return null;
    const c = await r.json();
    return typeof c?.gasto?.total === "number" ? c.gasto : null;
  } catch {
    return null;
  }
}

/** Reset del estado de PROCESO del motor falso (tiles servidos, atlas
 *  "pintados", turnos de diálogo). Es lo que pide `aisla: ["fake-ai"]`. */
async function resetFakeAi() {
  const res = await fetch(`${MOTOR_FALSO}/dev/reset`, { method: "POST" });
  if (!res.ok) throw new Error(`/dev/reset HTTP ${res.status}`);
  return res.json();
}

/** Ejecuta SOLO lo que el guion declare en `export const aisla = [...]`.
 *  Un guion que no declara nada corre sobre lo que dejó el anterior, a
 *  propósito: la declaración es la precondición, y una precondición que no
 *  existe no debe inventarse por simetría. */
async function aislar(nombre, aisla, propio) {
  if (!Array.isArray(aisla) || aisla.length === 0) return [];
  // Sin stack propio no hay disco efímero que vaciar: no sabemos dónde guarda
  // sus saves ni sus mundos el stack que ya estaba. Antes esto se saltaba en
  // SILENCIO y el guion daba una roja que no era del juego sino de su
  // precondición perdida. Ahora se dice y se para: un veredicto que no
  // significa lo que dice es exactamente el problema de #210.
  const deDisco = aisla.filter((q) => q === "saves" || q === "mundo");
  if (!propio && deDisco.length) {
    throw new Error(
      `necesita [${deDisco.join(", ")}] virgen y el stack no lo arrancó esta corrida ` +
        `(no sé dónde tiene el disco). Párala del todo —./start.sh --parar— y vuelve a lanzar.`,
    );
  }
  const hechos = [];
  for (const qué of aisla) {
    switch (qué) {
      case "saves":
        rmSync(TMP_SAVES, { recursive: true, force: true });
        mkdirSync(TMP_SAVES, { recursive: true });
        hechos.push("saves vaciados");
        break;
      case "mundo":
        hechos.push(`mundos borrados (${limpiarMundos()} artefactos)`);
        break;
      case "fake-ai": {
        const r = await resetFakeAi();
        hechos.push(`fake-ai reseteado (${JSON.stringify(r.limpiado)})`);
        break;
      }
      default:
        throw new Error(`${nombre}: aisla desconocido "${qué}" (vale saves|mundo|fake-ai)`);
    }
  }
  return hechos;
}

/** ¿Está este guion EXENTO del guardarraíl de gasto?
 *
 *  Solo si declara `export const sinMotor = "<motivo>"`, y el motivo es parte
 *  de la declaración, no un adorno: un booleano se pone a `true` sin pensar y
 *  se lee dos veces («¿esto significa que sí o que no?»), mientras que una
 *  frase hay que escribirla, se ve en la revisión del diff y dice de qué CLASE
 *  de guion se trata — uno que no le pide nada al motor. Cualquier otra cosa
 *  (un `true` pelado, una cadena vacía) es un error con nombre y no un
 *  silencioso «pues no lo eximo»: el desenlace de una declaración mal escrita
 *  no puede ser el caro.
 *
 *  Ausente = NO exento, que es el defecto y es deliberado: el descuido tiene
 *  que caer del lado que no cuesta dinero. */
function exentoDeMotor(nombre, sinMotor) {
  if (sinMotor === undefined) return false;
  if (typeof sinMotor !== "string" || sinMotor.trim() === "") {
    throw new Error(
      `${nombre}: \`export const sinMotor\` tiene que ser el MOTIVO por el que este guion no le ` +
        `pide nada al motor (una frase), y llegó ${JSON.stringify(sinMotor)}.`,
    );
  }
  return true;
}

/** Cuánto tarda el título en tener su lista de partidas — el `list_sessions`
 *  del bridge, por su propio cable. Es lo que espera el jugador mirando el home
 *  y crece con cada save que se acumula. */
function medirListSessions() {
  return new Promise((resolve) => {
    const ws = new WebSocket(URLS.bridge_ws);
    const fin = (v) => { try { ws.close(); } catch { /* ya cerrado */ } resolve(v); };
    const t = setTimeout(() => fin(null), 10_000);
    ws.onerror = () => { clearTimeout(t); fin(null); };
    ws.onopen = () => {
      const t0 = Date.now();
      ws.onmessage = (ev) => {
        const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
        if (m.type !== "sessions_listed") return;
        clearTimeout(t);
        fin({ ms: Date.now() - t0, n: m.sessions?.length ?? 0 });
      };
      ws.send(JSON.stringify({ type: "list_sessions", requestId: "diag" }));
    };
  });
}

/** Foto barata del disco, del motor falso y del bridge, para el `--diag`. */
async function diagnostico() {
  const saves = existsSync(TMP_SAVES) ? readdirSync(TMP_SAVES).length : 0;
  const mundos = {};
  for (const juego of readdirSync(TMP_GAMES)) {
    const f = join(TMP_GAMES, juego, "world", "tile.json");
    if (existsSync(f)) mundos[juego] = createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8);
  }
  const fake = await fetch(`${MOTOR_FALSO}/dev/counters`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const list = await medirListSessions();
  return { saves, mundos, fake, list };
}

/** La sentinela de `ctx.sinMedir` (#331): lanzarla es lo que ABORTA el guion
 *  a cualquier profundidad de pila — «marcar y confiar en que el guion haga
 *  return» era el apaño que tenía el 34, y no compone con quien quiera
 *  declararla desde dentro de un helper (#261, desde `waitFor`). El catch del
 *  runner la reconoce y clasifica; no es un error del guion, es su forma de
 *  decir «no pude medir». */
class SinMedirDeclarado extends Error {
  constructor(motivo) {
    super(motivo);
    this.name = "SinMedirDeclarado";
    this.motivo = motivo;
  }
}

/** Contexto que recibe cada guion. Todo lo que ofrece espera por estado; no
 *  hay sleep en la API, a propósito.
 *
 *  `nefan`, `waitFor` y `log` viven en `qa/lib/sonda.mjs` y aquí se DELEGA:
 *  los scripts que no corren bajo el runner (`fixtures-sin-bridge`,
 *  `captura-de-fixture`) usan la MISMA implementación vía `ctxDeSonda(page)`,
 *  en vez de la tercera copia de la espera que cada uno llevaba (#332). */
function makeCtx(page, name) {
  let step = 0;
  const ctx = {
    ...ctxDeSonda(page),
    name,
    fallos: [],
    /** La MARCA de que este guion declaró `sinMedir`, puesta ANTES de lanzar
     *  la sentinela. Existe porque la sentinela es una excepción y un
     *  `try { ctx.sinMedir(…) } catch {}` del propio guion se la traga —
     *  QA lo hizo y el guion salió VERDE (2026-08-31). El runner honra la
     *  marca aunque la sentinela nunca le llegue: una declaración no se
     *  deshace tragándosela. Pesa para #261: 44 de los 72 catches del censo
     *  son `.catch(() => null)`, y un helper con catch genérico haría esto
     *  sin querer. */
    declaracionSinMedir: null,

    /** Los bloques que este guion declaró NO PODER MEDIR sin abortar
     *  (`sinMedirBloque`, #261). Es la versión honesta de los cinco
     *  `ctx.log("⚠ … no se midió")` que había: mismo canal ⊘ que `sinMedir`,
     *  pero el guion sigue midiendo lo demás. */
    bloquesSinMedir: [],

    /** Mantiene una tecla hasta que se cumple `untilFn`, y la suelta SIEMPRE.
     *  `maxMs` es un cortafuegos, no la condición de parada: esperar por
     *  tiempo de pared no es determinista (el movimiento va por delta de rAF). */
    async holdUntil(key, desc, untilFn, maxMs = 15_000, arg = undefined) {
      await ctx.nefan("inputDriver.press", key);
      try {
        return await ctx.waitFor(desc, untilFn, maxMs, arg);
      } finally {
        await ctx.nefan("inputDriver.releaseAll");
      }
    },

    /** Declara que este guion NO PUEDE MEDIR y ABORTA aquí mismo (#331): no se
     *  sigue ejecutando ni acumulando fallos después. Es lo que le faltaba al
     *  veredicto de un guion con la precondición rota — un rojo dice «lo que
     *  defiendo está roto» cuando lo que pasó es «no pude medir», y esa
     *  mentira cuesta una investigación entera cada vez.
     *
     *  El canal no es una vía de escape: el ⊘ degrada la corrida a exit 2,
     *  MÁS que el rojo (exit 1) — reconvertir un rojo en ⊘ empeora el
     *  veredicto por construcción, y un guion que ya empujó fallos ni siquiera
     *  puede (lo veta el catch del runner).
     *
     *  El motivo es parte de la declaración, no un adorno — mismo criterio que
     *  `exentoDeMotor`: una frase hay que escribirla y dice QUÉ faltó. Sin
     *  ella, esto es un error normal y el guion sale rojo. */
    sinMedir(motivo) {
      if (typeof motivo !== "string" || motivo.trim() === "") {
        throw new Error(
          `${name}: ctx.sinMedir exige el MOTIVO por el que este guion no pudo medir ` +
            `(una frase), y llegó ${JSON.stringify(motivo)}.`,
        );
      }
      // La marca va ANTES del throw: si el guion (o un helper con catch
      // genérico) se traga la sentinela, la declaración sobrevive igual.
      ctx.declaracionSinMedir = { motivo };
      throw new SinMedirDeclarado(motivo);
    },

    /** Declara que UN BLOQUE de este guion no se pudo medir, sin abortar: el
     *  guion sigue midiendo los demás (#261).
     *
     *  Es el hermano de `sinMedir` para el caso que se escribía en PROSA —
     *  `if (…) { ctx.log("⚠ … no se midió"); return; }`—, que es un ⊘ sin
     *  declarar: sale verde y nadie se entera. Mismo canal, misma exigencia de
     *  motivo, y el mismo desenlace del `sinMedir` declarado: si el guion
     *  termina limpio, ⊘ con los motivos (exit 2, PEOR que el rojo); si arrastra
     *  fallos, se queda ROJO — un ⊘ es una declaración, no una amnistía. */
    sinMedirBloque(motivo) {
      const queja = quejaDelMotivo(motivo);
      if (queja) {
        throw new Error(
          `${name}: ctx.sinMedirBloque exige el MOTIVO por el que este bloque no se pudo medir ` +
            `—una frase que diga QUÉ faltó—, y el que llegó ${queja}.`,
        );
      }
      ctx.bloquesSinMedir.push(motivo);
      console.log(`    ⊘ bloque no medido: ${motivo}`);
    },

    /** Espera, y AFIRMA el hecho de si ocurrió o no (#261).
     *
     *  Aquí muere la familia de defectos más cara del banco: el hueco entre el
     *  umbral de la espera y el del aserto. Espera y aserto son el MISMO
     *  predicado, escrito UNA vez, así que deja de existir la banda de
     *  «expiró y aun así verde».
     *
     *  `debeOcurrir` es un parámetro y no dos verbos porque hay guiones donde
     *  el signo es DATO (el mismo paseo tiene que cruzar el puente y NO cruzar
     *  el río: lo decide qué chars son sólidos). `tecla` mantiene una tecla
     *  mientras se espera, como `holdUntil`. `aserto` permite escribir la
     *  frase del ✔/✘ cuando la del evento no se lee bien en negativo.
     *
     *  Devuelve `{ ocurrio, ultimo }`: `ultimo` es el último valor sondeado, o
     *  el valor de la espera si se cumplió. */
    async expectEspera(desc, debeOcurrir, probeFn, opciones = {}) {
      const { ms = 30_000, arg = undefined, tecla = undefined, aserto = undefined } = opciones;
      let ocurrio = false;
      let ultimo;
      let sondeo = { muestras: 0, rotos: 0 };
      try {
        ultimo = tecla
          ? await ctx.holdUntil(tecla, desc, probeFn, ms, arg)
          : await ctx.waitFor(desc, probeFn, ms, arg);
        ocurrio = true;
      } catch (err) {
        const exp = esperaExpiradaEn(err);
        if (!exp) throw err;
        ctx.esperas.resuelve(exp.esperaId, `afirmada por expectEspera: ${desc}`);
        ultimo = exp.ultimo;
        sondeo = exp.sondeo ?? sondeo;
      }
      // «No ocurrió» y «no llegué a mirar» NO son lo mismo, y sin esto eran
      // indistinguibles: `waitFor` enmascara los errores de la página en
      // `{__err}` y sigue sondeando, así que una sonda ROTA —un campo
      // renombrado dentro del hook— hacía que un negativo deliberado saliera
      // ✔ sin haber mirado nada (hallazgo 3 de QA). Para AFIRMAR una
      // expiración hay que haberla sondeado bien al menos una vez.
      const frase = aserto ?? `${debeOcurrir ? "ocurre" : "NO ocurre"}: ${desc}`;
      const detalle =
        `${ocurrio ? "ocurrió" : `no ocurrió en ${ms} ms`} · ` +
        `${sondeo.muestras} sondeo(s), ${sondeo.rotos} con la sonda rota · ` +
        `último valor ${JSON.stringify(ultimo)}`;
      if (!ocurrio && !huboSondeo(sondeo)) {
        ctx.expect(
          frase,
          false,
          `NO SE MIDIÓ: la sonda no llegó a evaluarse bien ni una vez, así que esta expiración ` +
            `no dice si la condición se cumple — ${detalle}`,
        );
        return { ocurrio, ultimo, midio: false };
      }
      ctx.expect(frase, ocurrio === debeOcurrir, detalle);
      // Un negativo que sale ✔ tiene que poder auditarse: si no se imprime lo
      // que sondeó, «el timeout es el éxito» es una afirmación sin cuentas.
      if (!debeOcurrir && !ocurrio) ctx.log(`↳ ${detalle}`);
      return { ocurrio, ultimo, midio: true };
    },

    expect(desc, cond, detalle = "") {
      if (cond) console.log(`    ✔ ${desc}`);
      else {
        console.log(`    ✘ ${desc}${detalle ? ` — ${detalle}` : ""}`);
        ctx.fallos.push(`${desc}${detalle ? ` — ${detalle}` : ""}`);
      }
    },

    async shot(label) {
      const file = join(SHOTS, `${name}-${String(++step).padStart(2, "0")}-${label}.png`);
      await page.screenshot({ path: file });
      return file;
    },
  };
  return ctx;
}

async function main() {
  const guiones = readdirSync(join(here, "guiones"))
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => filters.length === 0 || filters.some((q) => f.includes(q)))
    .sort();
  if (ORDEN === "inverso") guiones.reverse();
  else if (ORDEN !== "alfabetico") {
    console.error(`--orden "${ORDEN}" no existe (vale alfabetico|inverso)`);
    process.exit(2);
  }

  if (guiones.length === 0) {
    console.error("No hay guiones que casen con:", filters.join(", ") || "(todos)");
    process.exit(2);
  }

  // Capturas de ESTA corrida, y solo se borran las de ESTA corrida. La versión
  // anterior vaciaba `qa/capturas/` entera al arrancar: con dos baterías a la
  // vez, la segunda le borraba a la primera las pruebas de lo que acababa de
  // medir. El enlace `ultima` conserva la costumbre de mirar siempre al mismo
  // sitio.
  //
  // OJO — esto NO poda nada, y decir que sí lo hacía era la clase de comentario
  // que se convierte en una creencia: `qa/capturas/<corrida>` se acumula sin
  // límite (una corrida deja ~75 ficheros / 14 MB) mientras que `main` borraba
  // el directorio entero y lo mantenía acotado. Es deuda ASUMIDA con la tanda,
  // no un descuido: el precio de que dos corridas no se pisen las pruebas. La
  // poda por antigüedad —nunca por «no es mío»— está en el backlog del plan
  // (§6e) y no se hace aquí. Lo que sí se hizo el mismo día es que el escaneo
  // de arquitectura deje de recorrerlo (`scan.ignore` en arch-rules.json), que
  // era quien pagaba el crecimiento en cada `npm test`.
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  prepararDisco();
  const stack = await ensureStack();
  stackPropio = stack;
  // Los tmp de corridas muertas se borran AQUÍ y no en `prepararDisco()`, y el
  // orden es el arreglo entero de #283: mientras no se sepa si el stack lo
  // arrancó esta corrida, uno de esos directorios puede ser el disco que el
  // stack heredado está usando ahora mismo. Borrarlo antes de decidirlo era
  // arrancarle el suelo a un stack que un segundo después se adoptaba —la
  // corrida se lo hacía a sí misma— y de ahí salían los `Timeout 30000ms` sin
  // causa. Con stack propio, en cambio, no hay nadie leyéndolos: son basura.
  if (stack) limpiarTmpViejos();
  // `QA_RUN_TMP` es cómo `qa/lib/saves.mjs` sabe CUÁL de los `qa/.tmp/*` es el
  // disco observable. Se pone SOLO con stack propio, que es el único caso en
  // que este directorio es de verdad el que el juego está usando. Antes no
  // existía y `directoriosDeSaves()` recorría todos los tmp del repo
  // quedándose con el primero alfabético —el RUN_ID más ANTIGUO, o sea el
  // disco de la corrida de al lado—: un verde midiendo los saves de otro.
  if (stack) process.env.QA_RUN_TMP = TMP;
  if (!stack) {
    // El stack que ya estaba no sabe de nuestro disco efímero, así que la
    // corrida NO es hermética. Puede ser de otra persona o el huérfano de una
    // corrida anterior que murió a lo bruto: desde aquí no se distingue, así
    // que no se le llama "ajeno" — se dice lo único que se sabe seguro.
    console.log(
      "· OJO: el stack ya estaba arriba y NO lo arrancó esta corrida — usa SU disco, no qa/.tmp.\n" +
        "       Los guiones que necesiten saves o mundo vírgenes fallarán diciéndolo.\n" +
        "       Los tmp de otras corridas quedan intactos: uno de ellos puede ser SU disco.",
    );
  }
  console.log(`· orden: ${ORDEN}`);
  // ¿Está puesta la red que caza al que declara `sinMotor` y gasta? Se pregunta
  // una vez y se dice, en vez de que su ausencia pase por «ninguno gastó». Que
  // esta red pueda no existir es justo la razón por la que NO puede ser la
  // protección principal: la principal es el gate, que no depende de nadie.
  const hayContadorDeGasto = (await gastoDelFake()) !== null;
  if (!hayContadorDeGasto) {
    console.log(
      "· OJO: el motor de esta corrida no publica /dev/counters — la red que caza a un\n" +
        "       `sinMotor` que sí gasta no está puesta. El guardarraíl de los demás sigue entero.",
    );
  }
  const browser = await abrirNavegador(chromium, { headed: HEADED });

  const resultados = [];
  /** El guion durante el cual se cayó el stack, si se cayó. A partir de ahí no
   *  se ejecuta nada más: lo que midiera sería del cadáver, no del juego. */
  let stackCaido = null;
  for (const file of guiones) {
    const nombre = file.replace(/\.mjs$/, "");
    if (stackCaido) {
      resultados.push({ nombre, estado: SIN_MEDIR, fallos: [], motivo: `no ejecutado: ${stackCaido.motivo}` });
      continue;
    }
    console.log(`\n▶ ${nombre}`);
    const mod = await import(pathToFileURL(join(here, "guiones", file)).href);
    // Precondición DECLARADA del guion, ejecutada antes de abrir su página.
    let exento = false;
    try {
      exento = exentoDeMotor(nombre, mod.sinMotor);
      if (exento) console.log(`    ⛨ sin motor: ${mod.sinMotor}`);
      const hechos = await aislar(nombre, mod.aisla, Boolean(stack));
      if (hechos.length) console.log(`    ⟲ aisla: ${hechos.join(" · ")}`);
    } catch (err) {
      // Precondición perdida = el guion NO llegó a medir. No es un rojo del
      // juego y no puede contarse como tal (#272).
      console.log(`    ⊘ PRECONDICIÓN NO GARANTIZADA: ${err.message}`);
      resultados.push({
        nombre,
        estado: SIN_MEDIR,
        fallos: [],
        motivo: `precondición no garantizada: ${err.message}`,
      });
      continue;
    }
    const gastoAntes = await gastoDelFake();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    const ctx = makeCtx(page, nombre);
    let fatal = null;
    /** Por qué este guion NO llegó a medir (⊘), o null si midió. */
    let sinMedir = null;
    const t0 = Date.now();
    try {
      await page.goto(`${BASE}/${URL_QS}`, { waitUntil: "domcontentloaded" });
      await ctx.waitFor("window.__nefan disponible", () => Boolean(window.__nefan));
      // ── Guardarraíl de gasto (#295) ──────────────────────────────────────
      // Aquí y no en el guion: la obligación de preguntar vivía en un prólogo
      // copiado a mano en cuatro ficheros, así que el guion que se olvidaba de
      // copiarlo mandaba peticiones reales y salía VERDE. Va DESPUÉS del goto
      // porque `diagnosticoDeCreditos` hace sus dos `/health` desde la página
      // —con su CORS, que es parte de lo que se comprueba— y ANTES de
      // `mod.default`, que es lo que lo vuelve una precondición y no un aviso.
      //
      // Y se ejerce POR DEFECTO, que es la mitad que faltaba. Con la marca al
      // revés —que el guion declarase que gasta, y el runner solo gateara a
      // ese— olvidarse la dejaba correr SUELTA contra un motor que cobra, y la
      // única red era un contador que
      // vive en el motor falso — o sea, que contra el backend caro no existe.
      // Invertido, olvidarse deja el guion GATEADO: el desenlace del descuido
      // es un ⊘ y cero peticiones DESDE EL GUION, no una factura. Cero desde el
      // guion y no cero a secas, que es lo que de verdad ocurre: por la red han
      // salido ya la carga de la página y los dos `/health` de aquí abajo,
      // ninguna de pago. Lo que no llega a ejecutarse es `mod.default`, que es
      // quien pediría generación. El estado malo deja de ser expresable en vez
      // de quedar prohibido y vigilado.
      if (!exento) {
        const d = await diagnosticoDeCreditos(ctx);
        if (!d.ok) sinMedir = `el guardarraíl de gasto se niega: ${d.motivo}`;
        else ctx.log(`⛨ guardarraíl: ${d.motivo}`);
      }
      if (!sinMedir) await mod.default(ctx);
    } catch (err) {
      if (err instanceof SinMedirDeclarado) {
        // La sentinela llegó: la marca se CONSUME aquí (el bloque de abajo es
        // solo para la que un catch del guion se tragó).
        ctx.declaracionSinMedir = null;
        // El ⊘ DECLARADO exige el guion limpio, y esto es MÁS estricto que el
        // propio runner: los ⊘ de abajo (:stack caído, sinMotor falso)
        // conservan `ctx.fallos` no vacíos porque esos fallos pueden ser del
        // cadáver del stack — un accidente. El declarado es una DECLARACIÓN
        // del guion, y una declaración con fallos ya empujados sería una
        // amnistía: el rojo se queda.
        if (ctx.fallos.length === 0) {
          sinMedir = `declarado por el guion: ${err.motivo}`;
        } else {
          ctx.fallos.push(
            `declaró sinMedir(«${err.motivo}») con ${ctx.fallos.length} fallo(s) ya ` +
              `empujados: un ⊘ es una declaración, no una amnistía — el guion no puede ` +
              `reconvertirse y se queda en rojo`,
          );
          console.log(`    ✘ ${ctx.fallos[ctx.fallos.length - 1]}`);
        }
      } else {
        // Una expiración que PROPAGA hasta aquí está observada: paró el guion
        // y su mensaje es el rojo. Se resuelve para que el candado del libro
        // de esperas no la cuente además como pendiente (#261). La cadena de
        // causas importa: `esperarRegistro` la envuelve en un error propio.
        const exp = esperaExpiradaEn(err);
        if (exp) ctx.esperas.resuelve(exp.esperaId, "propagó al runner y paró el guion");
        fatal = err;
        console.log(`    ✘ ERROR: ${err.message}`);
        await ctx.shot("error").catch(() => {});
      }
    }
    // La marca sigue puesta = el guion declaró sinMedir y la sentinela NUNCA
    // llegó: se la tragó un try/catch (suyo o de un helper) y siguió
    // ejecutándose. La declaración se honra igual — si no, un catch genérico
    // fabricaría un verde de un guion que dijo «no pude medir» (hallazgo de
    // QA, #331). Misma regla que arriba: limpio → ⊘; con fallos → rojo.
    let declaro = Boolean(sinMedir) || ctx.bloquesSinMedir.length > 0;
    if (ctx.declaracionSinMedir) {
      declaro = true;
      const { motivo } = ctx.declaracionSinMedir;
      if (ctx.fallos.length === 0 && !fatal) {
        sinMedir =
          `declarado por el guion: ${motivo} — y la sentinela se tragó (el guion siguió ` +
          `ejecutándose tras declarar); la declaración se honra igual`;
      } else {
        ctx.fallos.push(
          `declaró sinMedir(«${motivo}»), se tragó la sentinela y siguió con fallos: ` +
            `un ⊘ es una declaración, no una amnistía — el guion no puede reconvertirse ` +
            `y se queda en rojo`,
        );
        console.log(`    ✘ ${ctx.fallos[ctx.fallos.length - 1]}`);
      }
    }

    // ── EL LIBRO DE ESPERAS (#261) ────────────────────────────────────────
    // Toda espera que expiró está anotada; aquí se cobra la que nadie observó.
    // Las tres bocas que la resuelven —propagar, `expectEspera`, `absorbe`—
    // están en `qa/lib/esperas.mjs` con el porqué de las legítimas.
    //
    // ANTES DE LEER EL LIBRO hay que dejar que se posen las esperas que el
    // guion arrancó y no esperó. Era la cuarta boca (hallazgo 1 de QA): la
    // lectura era síncrona al volver el guion, así que un `void ctx.waitFor(…)`
    // —o la hermana perdedora de un `Promise.all`— expiraba un tick más tarde,
    // cuando ya no la contaba nadie, y el guion salía VERDE. Con el árbol de
    // hoy esto no cuesta nada: no hay ni una espera suelta, así que `enVuelo`
    // viene vacío y el drenaje no llega a correr.
    const enVuelo = ctx.esperas.enVuelo();
    if (enVuelo.length) {
      console.log(
        `    ⧗ ${enVuelo.length} espera(s) seguían en vuelo al terminar el guion: ` +
          `hasta ${DRENAJE_DE_ESPERAS_MS} ms para que se posen`,
      );
      let alarma;
      await Promise.race([
        Promise.all(enVuelo.map((e) => e.posada ?? Promise.resolve())),
        new Promise((r) => {
          alarma = setTimeout(r, DRENAJE_DE_ESPERAS_MS);
        }),
      ]);
      clearTimeout(alarma);
    }

    // Si el guion DECLARÓ que no midió, las pendientes se imprimen como
    // detalle de su ⊘ en vez de como fallos: el ⊘ es exit 2, PEOR que el rojo,
    // así que declarar no es una vía de escape. Si no declaró, son fallos y el
    // guion sale ROJO — porque un ⊘ exige un motivo escrito y el runner no
    // puede inventárselo por el guion.
    //
    // OJO al leer un ⊘ así: el runner NO sabe de qué bloque salió cada espera,
    // así que un `sinMedirBloque` cualquiera se lleva a su ⊘ TODAS las
    // pendientes, tengan que ver con él o no (hallazgo 6 de QA). El veredicto
    // es correcto —exit 2, ni verde ni amnistía—, pero el motivo impreso puede
    // hablar de otro bloque: por eso las pendientes se imprimen enteras, con su
    // sitio, y no resumidas en el motivo.
    const esperasPendientes = [
      ...fallosDeEsperasPendientes(ctx.esperas),
      ...fallosDeEsperasEnVuelo(ctx.esperas),
    ];
    for (const f of esperasPendientes) {
      if (declaro) {
        console.log(`    ⊘ ${f}`);
      } else {
        console.log(`    ✘ ${f}`);
        ctx.fallos.push(f);
      }
    }

    // Los bloques que el guion declaró no poder medir SIN abortar. Misma regla
    // que el `sinMedir` que aborta: limpio → ⊘ con los motivos; con fallos →
    // rojo, que una declaración no es una amnistía.
    if (ctx.bloquesSinMedir.length && !sinMedir) {
      const motivos = ctx.bloquesSinMedir.map((m) => `«${m}»`).join(" · ");
      if (ctx.fallos.length === 0 && !fatal) {
        sinMedir = `${ctx.bloquesSinMedir.length} bloque(s) declarados sin medir: ${motivos}`;
      } else {
        console.log(
          `    ⊘ ${ctx.bloquesSinMedir.length} bloque(s) sin medir (${motivos}) — pero el guion ` +
            `arrastra fallos: se queda en rojo`,
        );
      }
    }
    if (DIAG) {
      const libros = await page
        .evaluate(() => ({
          viaje: window.__nefan.viaje ?? null,
          tiles: window.__nefan.tileEpisodios ?? null,
          estilo: window.__nefan.estilo ? window.__nefan.estilo() : null,
        }))
        .catch((e) => ({ __err: String(e) }));
      console.log(`    ⓘ ${Date.now() - t0} ms · ${JSON.stringify(await diagnostico())}`);
      console.log(`    ⓘ libros: ${JSON.stringify(libros)}`);
    }
    if (errores.length) {
      console.log(`    ✘ ${errores.length} excepción(es) en la página`);
      errores.slice(0, 3).forEach((e) => console.log(`      ${e.split("\n")[0]}`));
      // La primera va EN el fallo, no solo en el log en línea: el resumen es
      // lo que se lee, y un recuento sin texto no se puede diagnosticar.
      ctx.fallos.push(
        `${errores.length} excepción(es) no capturadas en la página: ${errores[0].split("\n")[0]}`,
      );
    }
    await page.close();
    if (fatal) ctx.fallos.push(`ERROR: ${fatal.message}`);

    // ¿Sigue en pie el stack que acaba de conducir este guion? Se pregunta
    // DESPUÉS de cada uno porque la respuesta cambia lo que significa lo que
    // se acaba de medir: con el stack muerto, ni este veredicto ni ninguno de
    // los siguientes es del juego.
    const caidos = await serviciosCaidos();
    if (caidos.length) {
      const motivo = `el stack se cayó durante «${nombre}» (${caidos.join(", ")} dejó de contestar)`;
      stackCaido = { nombre, motivo, caidos };
      console.log(`    ⊘ ${motivo}`);
      resultados.push({ nombre, estado: SIN_MEDIR, fallos: ctx.fallos, motivo });
      continue;
    }

    // La red pequeña, y conviene no venderla por más de lo que es: caza al que
    // DECLARA `sinMotor` y sí gasta — o sea, al que se equivoca al declarar, no
    // al que se olvida. Del que se olvida ya se ocupa el gate de arriba, que es
    // la protección de verdad porque no depende de nadie; esto vive en el motor
    // falso y contra el backend caro no existe. Sirve igual: no puede impedir
    // el gasto a posteriori, pero sí impedir que acabe en verde.
    const gastoDespues = await gastoDelFake();
    if (exento && gastoAntes && gastoDespues && gastoDespues.total > gastoAntes.total) {
      const delta = {};
      for (const [ruta, n] of Object.entries(gastoDespues.rutas)) {
        const d = n - (gastoAntes.rutas[ruta] ?? 0);
        if (d > 0) delta[ruta] = d;
      }
      sinMedir =
        `declara \`sinMotor\` («${mod.sinMotor}») y disparó generación: ${JSON.stringify(delta)}. ` +
        `La declaración es falsa: quítala y el runner lo gateará como a los demás.`;
    }
    if (sinMedir) {
      console.log(`    ⊘ ${sinMedir}`);
      resultados.push({ nombre, estado: SIN_MEDIR, fallos: ctx.fallos, motivo: sinMedir });
      continue;
    }

    resultados.push({
      nombre,
      estado: ctx.fallos.length === 0 ? VERDE : ROJO,
      fallos: ctx.fallos,
      motivo: null,
    });
  }

  await browser.close();

  const cuenta = (e) => resultados.filter((r) => r.estado === e).length;
  const verdes = cuenta(VERDE);
  const rojos = cuenta(ROJO);
  const sinMedir = cuenta(SIN_MEDIR);

  console.log(`\n${"─".repeat(60)}`);
  for (const r of resultados) {
    console.log(`${ICONO[r.estado]} ${r.nombre}${r.motivo ? ` — ${r.motivo}` : ""}`);
    // Un rojo dice de quién es en el propio resumen: en una batería de treinta
    // guiones, el detalle quedó a cientos de líneas de scroll. Y un ⊘ enseña
    // los fallos que arrastraba (una excepción de página antes de declarar,
    // los del cadáver del stack): el exit 2 protege la corrida, pero el
    // diagnóstico se perdía del resumen (hallazgo de QA, #331). Imprimirlos
    // no cambia el veredicto.
    if (r.estado === ROJO || r.estado === SIN_MEDIR) for (const f of r.fallos) console.log(`    · ${f}`);
  }
  const partes = [`${verdes} en verde`, `${rojos} en rojo`];
  if (sinMedir) partes.push(`${sinMedir} SIN MEDIR`);
  console.log(`${partes.join(" · ")} de ${resultados.length} · capturas en ${SHOTS}`);

  // El veredicto de la CORRIDA, que no es la suma de los veredictos de los
  // guiones: si algo no llegó a medirse, esto no dice si el juego está bien.
  if (stackCaido) {
    console.log(
      `\n✖ SE CAYÓ EL STACK durante «${stackCaido.nombre}»: ${stackCaido.caidos.join(", ")} ` +
        `dejó de contestar.\n  No son ${sinMedir} guiones rotos: son ${sinMedir} guiones que no ` +
        `midieron nada. Arranca de nuevo con el stack en pie.`,
    );
  } else if (sinMedir) {
    console.log(
      `\n✖ ${sinMedir} guion(es) no llegaron a medir: esta corrida NO es un veredicto del juego.`,
    );
  }
  salir(exitDeCorrida(rojos, sinMedir));
}

main().catch((err) => {
  console.error("runner:", err);
  salir(2);
});
