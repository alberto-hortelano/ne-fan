/** ¿La batería de un módulo EJERCE lo que ese módulo muta, o solo lo carga?
 *
 *  `test/mutation-config.test.ts` ya exigía que la batería pudiera CARGAR cada
 *  fichero mutado («el reparto es alcanzable»), y cargar no es ejercer. El
 *  agujero con su nombre y su número: `src/world-map/place-target.ts` estaba en
 *  el módulo `world-map`, TRES de sus ocho tests lo importaban y NINGUNO lo
 *  llamaba. Resultado en la huella commiteada: 35 mutantes, 35 vivos, 100 % de
 *  supervivientes, que no es deuda de test sino MEDIDA QUE NO EXISTE (#598).
 *
 *  POR QUÉ NO SE MIDE CON `lcov`, y esto es lo importante. La vía obvia
 *  —`node --test --experimental-test-coverage` y mirar las líneas cubiertas—
 *  da un falso NEGATIVO sobre el único infractor conocido: medido el
 *  2026-09-17 en esta casa, `place-target.ts` con la batería de `world-map` sale
 *  con **25 de 39 líneas «cubiertas»**, y las que da por cubiertas son las
 *  19-39, o sea el CUERPO de una función que esa batería llama **cero veces**
 *  (las 5-18 que da por descubiertas son el docblock, los imports y la firma).
 *  lcov de Node con `tsx` desplaza las líneas, así que un candado construido
 *  sobre él sería verde justo donde tiene que ser rojo.
 *
 *  Lo que no miente es CONTAR LLAMADAS. `NODE_V8_COVERAGE` deja la cobertura
 *  precisa de V8 con el contador de invocaciones de cada función, en offsets del
 *  fichero transpilado —que aquí no hace falta mapear a líneas, porque la
 *  pregunta no es «qué línea» sino «corrió algo»—. Medido el mismo día sobre el
 *  mismo fichero: `resolvePlaceTarget` sale con **0 llamadas** con la batería de
 *  `world-map` y con **7** con la de `npc-director`.
 *
 *  ESTE GUION NO ESTÁ EN `npm test` NI EN `npm run verify`, y es una decisión
 *  con número: correr las 61 baterías cuesta ~60 s de reloj en serie sobre una
 *  suite que entera tarda 44 s, y el bucle interno de `verify` (~13 s) es
 *  exactamente lo que el usuario decidió no encarecer el 2026-08-27. Corre en CI
 *  como paso propio del job `nefan-core`, junto a `crap`, que es la otra medida
 *  que tampoco entra en el bucle interno.
 *
 *  Uso:
 *    npm run ejercicio                # las baterías de los 61 módulos
 *    npm run ejercicio -- world-map   # solo las que se nombren
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  coreRoot,
  ficherosMutados,
  leerPlan,
  moduloPorId,
  type ModuloMutacion,
  type PlanMutacion,
} from "./mutation-plan.js";

// ── la decisión, pura ────────────────────────────────────────────────────────

/** Los ayudantes que el transpilador INYECTA en cada fichero y que no son
 *  código de nadie.
 *
 *  `tsx` transpila con esbuild y `keepNames: true`, así que todo fichero con
 *  una función con nombre estrena un `__name` que se llama AL CARGAR el módulo.
 *  Contarlo como código propio haría que cualquier fichero con una función
 *  saliera «ejercido» por el hecho de importarse — el mismo verde que este
 *  candado existe para desmontar.
 *
 *  La lista es por PREFIJO y no por nombres uno a uno: esbuild los llama todos
 *  `__algo` (`__name`, `__toESM`, `__export`, `__publicField`…) y una lista
 *  cerrada se quedaría corta en la siguiente versión sin que nada fallara. Lo
 *  que la hace segura es el guardia de `fuenteConNombresReservados`: si un
 *  fuente de la casa declarara un `__loQueSea`, el candado no podría
 *  distinguirlo del ayudante y lo DICE en vez de suponerlo. Medido el
 *  2026-09-17: cero ficheros de `src/` declaran uno. */
export const PREFIJO_DEL_TRANSPILADOR = "__";

export function esAyudanteDelTranspilador(nombre: string): boolean {
  return nombre.startsWith(PREFIJO_DEL_TRANSPILADOR);
}

/** Una función tal y como la reporta la cobertura precisa de V8. `ranges[0]` es
 *  el rango de la función entera y su `count` es cuántas veces se la invocó. */
export interface FuncionMedida {
  functionName: string;
  ranges: readonly { startOffset: number; count: number }[];
}

/** Lo que `NODE_V8_COVERAGE` deja de UN script. */
export interface CoberturaDeFichero {
  url: string;
  functions: readonly FuncionMedida[];
}

/** Los CUATRO estados de un fichero mutado frente a su batería, y ninguno se
 *  colapsa con otro:
 *
 *  · `ejercido` — alguna función suya se llamó. Es lo único que vale.
 *  · `solo cargado` — el módulo se importó (su envoltorio corrió) y ninguna de
 *    sus funciones llegó a ejecutarse. Es #598 exacto para todo mutante que viva
 *    DENTRO de una función: salen `NoCoverage` sin que nadie pueda matarlos. Lo
 *    que sí se ejecutó es su nivel superior, así que el número de funciones
 *    viaja en el estado: `place-target.ts` tiene una y es todo el fichero;
 *    `world-map/types.ts` tenía una (`isEdge`, que no llamaba NADIE en el repo)
 *    sobre 113 líneas de constantes que sí corren al importar.
 *  · `sin cargar` — ni siquiera se importó. Lo caza además el candado de CARGAR
 *    de `test/mutation-config.test.ts`, y se distingue porque manda a otro
 *    sitio: allí falta un import, aquí falta una llamada.
 *  · `sin funciones propias` — el fichero no tiene más JavaScript que su nivel
 *    superior (una tabla, unas constantes). Cargarlo ES ejercerlo: sus mutantes
 *    se ejecutan al importar, así que si sobreviven es deuda de test de verdad
 *    y no medida ausente. */
export type Ejercicio =
  | { tipo: "ejercido"; llamadas: number }
  | { tipo: "solo cargado"; funciones: number }
  | { tipo: "sin cargar" }
  | { tipo: "sin funciones propias" };

/** El envoltorio del módulo: la «función» que V8 reporta por el cuerpo de nivel
 *  superior. Se reconoce por el offset y no por el nombre vacío, porque una
 *  flecha anónima también se llama `""` y ésa SÍ es código propio. */
const esEnvoltorio = (f: FuncionMedida): boolean => f.ranges[0]?.startOffset === 0;

export function ejercicioDeFichero(cobertura: CoberturaDeFichero | undefined): Ejercicio {
  if (cobertura === undefined) return { tipo: "sin cargar" };
  const propias = cobertura.functions.filter(
    (f) => !esEnvoltorio(f) && !esAyudanteDelTranspilador(f.functionName),
  );
  if (propias.length === 0) return { tipo: "sin funciones propias" };
  const llamadas = propias.reduce((n, f) => n + (f.ranges[0]?.count ?? 0), 0);
  // El envoltorio pudo no correr (fichero cargado por nadie) y aun así tener
  // funciones declaradas: eso es `sin cargar`, no `solo cargado`.
  const envoltorio = cobertura.functions.find(esEnvoltorio);
  if (llamadas === 0) {
    return (envoltorio?.ranges[0]?.count ?? 0) > 0
      ? { tipo: "solo cargado", funciones: propias.length }
      : { tipo: "sin cargar" };
  }
  return { tipo: "ejercido", llamadas };
}

export const ejercido = (e: Ejercicio): boolean =>
  e.tipo === "ejercido" || e.tipo === "sin funciones propias";

/** Cómo se lee un veredicto, en una línea. Vive aquí —y no en quien imprime—
 *  por lo mismo que `estadoLegible` en `mutacion-huella.ts`: dos ternarios
 *  gemelos acaban diciendo cosas distintas del mismo hecho. */
export function ejercicioLegible(e: Ejercicio): string {
  switch (e.tipo) {
    case "ejercido":
      return `${e.llamadas} llamada(s)`;
    case "sin funciones propias":
      return "sin funciones propias: cargarlo es ejercerlo";
    case "solo cargado":
      return `SOLO CARGADO — su batería lo importa y no llama a ninguna de sus ${e.funciones} función(es)`;
    case "sin cargar":
      return "SIN CARGAR — ningún test de su batería llega siquiera a importarlo";
  }
}

export interface FalloDeEjercicio {
  modulo: string;
  fichero: string;
  ejercicio: Ejercicio;
}

/** Los ficheros de un módulo que su batería no ejerce. */
export function fallosDelModulo(
  modulo: string,
  ficheros: Readonly<Record<string, Ejercicio>>,
): FalloDeEjercicio[] {
  return Object.keys(ficheros)
    .sort()
    .filter((f) => !ejercido(ficheros[f]))
    .map((f) => ({ modulo, fichero: f, ejercicio: ficheros[f] }));
}

/** La ruta relativa a nefan-core de un `url` de la cobertura, o `undefined` si
 *  ese script no es del paquete (node_modules, `node:` internos, el loader).
 *
 *  Las rutas se comparan tal y como las escribe el plan, que es la única forma
 *  de que el veredicto hable de los mismos ficheros que el contrato. */
export function rutaDelScript(url: string, raiz: string): string | undefined {
  if (!url.startsWith("file://")) return undefined;
  let absoluta: string;
  try {
    absoluta = fileURLToPath(url);
  } catch {
    return undefined;
  }
  const rel = relative(raiz, absoluta).split("\\").join("/");
  if (rel.startsWith("..") || rel.startsWith("node_modules/")) return undefined;
  return rel;
}

/** El fuente declara un identificador con el prefijo que el transpilador usa
 *  para SUS ayudantes, así que el candado no puede distinguirlos.
 *
 *  Fail-loud y no una suposición: si esto apareciera, el filtro de ayudantes
 *  descartaría código de la casa y el fichero saldría «solo cargado» sin serlo,
 *  o al revés. Medido el 2026-09-17: cero ficheros. */
export function fuenteConNombresReservados(fuente: string): boolean {
  return /(?:function|const|let|var|class)\s+__[A-Za-z_$]/.test(fuente);
}

// ── el rojo, con nombre ──────────────────────────────────────────────────────

/** Un test que el TAP da por caído: su ruta de suites hasta él y su bloque YAML
 *  de diagnóstico (mensaje, `location`, `stack`) tal cual lo escribió Node. */
export interface TestCaido {
  ruta: readonly string[];
  diagnostico: string;
}

const SUBTEST = /^(\s*)# Subtest: (.*)$/;
const NOT_OK = /^(\s*)not ok \d+ - (.*?)(?: # .*)?$/;
const PROFUNDIDAD = 4;

/** Cada `not ok` del TAP con su bloque de error, ESTÉ DONDE ESTÉ.
 *
 *  Antes el rojo imprimía `stdout.slice(-2000)`, y la batería de
 *  `asset-store-contrato` tiene 15 tests de nivel superior: el que cayó en CI
 *  (#751) estaba en el décimo y el corte empezaba a mitad del decimotercero, así
 *  que el log no nombraba nada. Tampoco sirve leer `# fail N`: un `describe` cuyo
 *  cuerpo lanza sale `not ok` con `# fail 0` en Node 26, y el formato del resumen
 *  no está fijado (CI corre el Node más reciente, #749). Lo que no cambia es la
 *  línea `not ok`.
 *
 *  Se omite el `not ok` de una suite que solo dice que un hijo cayó
 *  (`subtestsFailed`): el hijo ya sale, con la suite en su ruta. */
export function testsCaidosDelTap(tap: string): TestCaido[] {
  const lineas = tap.split("\n");
  const suites: string[] = [];
  const out: TestCaido[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const sub = SUBTEST.exec(lineas[i]);
    if (sub) {
      const nivel = Math.floor(sub[1].length / PROFUNDIDAD);
      suites.length = nivel;
      suites[nivel] = sub[2];
      continue;
    }
    const caido = NOT_OK.exec(lineas[i]);
    if (!caido) continue;
    const sangria = caido[1].length;
    const bloque: string[] = [];
    // El bloque YAML va dos espacios más adentro, entre `---` y `...`.
    if (lineas[i + 1]?.trim() === "---") {
      for (let j = i + 2; j < lineas.length; j++) {
        if (lineas[j].trim() === "..." && lineas[j].length - lineas[j].trimStart().length === sangria + 2) break;
        bloque.push(lineas[j].slice(sangria + 2));
      }
    }
    const diagnostico = bloque.join("\n");
    if (/^failureType: 'subtestsFailed'$/m.test(diagnostico)) continue;
    out.push({ ruta: [...suites.slice(0, Math.floor(sangria / PROFUNDIDAD)), caido[2]], diagnostico });
  }
  return out;
}

/** El mensaje de una batería que no pasa: QUÉ test cayó y con qué error.
 *
 *  Si el TAP no trae ningún `not ok` (el proceso murió antes de escribirlo, un
 *  reporter que cambió de forma…) se DICE, con la cola del TAP detrás, en vez de
 *  dejar al lector buscando un nombre que no está. El stderr va siempre: el log
 *  que delató a #751 («world-state contestó HTTP 404») salió por ahí. */
export function informeDeBateriaRota(id: string, stdout: string, stderr: string): string {
  const caidos = testsCaidosDelTap(stdout);
  const cabecera =
    `la batería de "${id}" no pasa, así que su cobertura está a medias y no se puede ` +
    `juzgar qué ejerce. Arregla primero el test que cae.\n`;
  const cuerpo =
    caidos.length > 0
      ? `${caidos.length} test(s) caído(s):\n` +
        caidos.map((c) => `✖ ${c.ruta.join(" › ")}\n${c.diagnostico.replace(/^/gm, "    ")}`).join("\n")
      : `El proceso salió con error y su TAP no trae NINGÚN \`not ok\`: no hay test que nombrar. ` +
        `Cola del TAP:\n${stdout.slice(-2000)}`;
  return `${cabecera}${cuerpo}\n${stderr.length > 0 ? `stderr (cola):\n${stderr.slice(-2000)}` : "stderr vacío."}`;
}

// ── el corredor ──────────────────────────────────────────────────────────────

/** Une los ficheros de cobertura que deja UNA corrida: `tsx` arranca más de un
 *  hilo, así que `NODE_V8_COVERAGE` deja varios `coverage-*.json` y el fichero
 *  que interesa puede estar en cualquiera de ellos. */
function coberturaDe(dir: string, raiz: string): Map<string, CoberturaDeFichero> {
  const out = new Map<string, CoberturaDeFichero>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const crudo = JSON.parse(readFileSync(join(dir, f), "utf8")) as { result?: CoberturaDeFichero[] };
    for (const script of crudo.result ?? []) {
      const ruta = rutaDelScript(script.url, raiz);
      if (ruta === undefined) continue;
      const previo = out.get(ruta);
      // El MISMO fichero puede salir en dos volcados (dos hilos que lo
      // cargaron). Se queda el que más llamadas trae: quedarse con el primero
      // daría «solo cargado» sobre un fichero que sí se ejerció en el otro.
      if (previo === undefined || cuenta(script) > cuenta(previo)) out.set(ruta, script);
    }
  }
  return out;
}

const cuenta = (s: CoberturaDeFichero): number =>
  s.functions.reduce((n, f) => n + (f.ranges[0]?.count ?? 0), 0);

export type BateriaCorrida = { ok: true } | { ok: false; informe: string; stdout: string };

/** Corre los `tests` de una batería con los `nodeArgs` dados y, si no pasa,
 *  devuelve el informe que nombra lo que cayó.
 *
 *  Decide por el EXIT del proceso y NO por el `# fail N` del resumen, que no
 *  cuenta un `describe` que lanza (medido en Node 26.10: `not ok`, `# fail 0`,
 *  EXIT 1). Sin `NODE_TEST_CONTEXT`: si quien llama es a su vez un
 *  `node --test` (la batería de este guion), el hijo la heredaría y reportaría
 *  al padre por el canal serializado en vez de escribir TAP. */
export function correrBateria(
  id: string,
  nodeArgs: readonly string[],
  tests: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<BateriaCorrida> {
  const entorno: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete entorno.NODE_TEST_CONTEXT;
  return new Promise((cumple) => {
    execFile(
      process.execPath,
      [...nodeArgs, ...tests],
      { cwd: coreRoot, encoding: "utf8", env: entorno, timeout: 600000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) =>
        cumple(err === null ? { ok: true } : { ok: false, informe: informeDeBateriaRota(id, stdout, stderr), stdout }),
    );
  });
}

/** Corre UNA batería con la cobertura precisa encendida y devuelve qué ejerció.
 *
 *  Con los `node_args` DEL PLAN, que son los mismos con los que `tap-runner`
 *  ejecuta cada fichero en la corrida de verdad: ponerlos a mano aquí sería una
 *  segunda verdad sobre cómo se ejecuta la batería, y la que corre no tendría
 *  por qué ser la que alguien lee. */
async function ejercicioDeModulo(
  plan: PlanMutacion,
  modulo: ModuloMutacion,
): Promise<Record<string, Ejercicio>> {
  const dir = mkdtempSync(join(tmpdir(), "nefan-ejercicio-"));
  try {
    const corrida = await correrBateria(modulo.id, plan.node_args, modulo.tests, { NODE_V8_COVERAGE: dir });
    if (!corrida.ok) throw new Error(corrida.informe);
    const cobertura = coberturaDe(dir, coreRoot);
    const out: Record<string, Ejercicio> = {};
    for (const f of ficherosMutados(modulo)) {
      const fuente = readFileSync(resolve(coreRoot, f), "utf8");
      if (fuenteConNombresReservados(fuente)) {
        throw new Error(
          `${f} declara un identificador que empieza por "${PREFIJO_DEL_TRANSPILADOR}", que es el prefijo ` +
            `con el que el transpilador inyecta SUS ayudantes: este candado no puede distinguir los tuyos ` +
            `de los suyos, así que no se pronuncia. Renómbralo.`,
        );
      }
      out[f] = ejercicioDeFichero(cobertura.get(f));
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Cuántas baterías a la vez. El mismo invariante que la corrida de mutación
 *  —procesos simultáneos ≈ núcleos, NUNCA un múltiplo—: cada batería corre en UN
 *  proceso porque los `node_args` del plan llevan `--test-isolation=none`, así
 *  que no hay un segundo paralelismo dentro. Se deja un núcleo libre para la
 *  persona que esté usando la máquina, que es de donde viene el muro de
 *  `mutate.ts`. */
export function baterisAlaVez(nucleos: number): number {
  return Math.max(1, Math.min(nucleos - 1, 8));
}

async function main(): Promise<void> {
  const plan = leerPlan();
  const pedidos = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const modulos = pedidos.length > 0 ? pedidos.map((id) => moduloPorId(plan, id)) : plan.modulos;
  const ala_vez = baterisAlaVez(availableParallelism());
  console.log(
    `Ejercicio de ${modulos.length} batería(s) con los node_args del plan ` +
      `(${plan.node_args.join(" ")}), ${ala_vez} a la vez.\n`,
  );

  const fallos: FalloDeEjercicio[] = [];
  let ficheros = 0;
  const t0 = Date.now();
  let siguiente = 0;
  const obrero = async (): Promise<void> => {
    for (let i = siguiente++; i < modulos.length; i = siguiente++) {
      const m = modulos[i];
      const suyos = await ejercicioDeModulo(plan, m);
      ficheros += Object.keys(suyos).length;
      const malos = fallosDelModulo(m.id, suyos);
      fallos.push(...malos);
      for (const f of malos) console.log(`✗ ${m.id.padEnd(24)} ${f.fichero} — ${ejercicioLegible(f.ejercicio)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ala_vez, modulos.length) }, obrero));
  fallos.sort((a, b) => a.fichero.localeCompare(b.fichero));

  console.log(
    `\n${ficheros} fichero(s) mutado(s) en ${modulos.length} batería(s), ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s de reloj.`,
  );
  if (fallos.length === 0) {
    console.log("Todas las baterías EJERCEN lo que su módulo muta.");
    return;
  }
  console.error(
    `\n${fallos.length} fichero(s) que su batería NO EJERCE:\n` +
      fallos.map((f) => `  · ${f.fichero} (módulo "${f.modulo}") — ${ejercicioLegible(f.ejercicio)}`).join("\n") +
      `\n\nSus mutantes salen vivos por construcción y ensucian la cola con deuda que no existe. ` +
      `O el fichero está en el módulo equivocado —y se mueve al de su consumidor, con motivo escrito—, ` +
      `o le falta el test que lo tenga por sujeto.`,
  );
  process.exitCode = 1;
}

// Importado (candado) no ejecuta nada; solo al invocarlo como comando.
if (process.argv[1]?.endsWith("ejercicio-de-bateria.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
