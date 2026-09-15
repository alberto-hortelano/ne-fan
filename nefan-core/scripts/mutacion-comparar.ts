/** `npm run mutacion -- comparar` — la comparación EN SECO: mira y no toca.
 *
 *  POR QUÉ ES UN VERBO Y NO UNA BANDERA DE `repartir`. Hasta esta tanda, el
 *  único verbo que comparaba era `repartir`, y `repartir` acaba en
 *  `escribeHuella` y CI le mueve el tag detrás. O sea: medir una corrida con un
 *  instrumento nuevo DESTRUÍA la base contra la que había que compararla. La
 *  regla dura de #443 —«si un solo score se mueve fichero a fichero, no se
 *  adopta»— era inaplicable por construcción, que es la peor forma de un
 *  criterio: la que se cumple en verde sin comprobar nada.
 *
 *  Una bandera `--en-seco` en un verbo que escribe habría sido más barata y es
 *  exactamente el fallo a impedir: una bandera se olvida, y el olvido sale caro
 *  una sola vez. El precedente de la casa es `lotes`, que «sin flags solo
 *  imprime». Aquí se va un paso más allá y el fichero no PUEDE escribir.
 *
 *  QUÉ SUJETA CADA CAPA, dicho con precisión porque ninguna cubre a la otra:
 *
 *   1. `arch-rules.json` · `comparar-solo-lee` — de `node:fs` este fichero solo
 *      puede importar `existsSync` y `readFileSync`, y `node:child_process` no
 *      lo puede importar en absoluto. Es una LISTA BLANCA sobre una línea, no
 *      una lista negra de nombres: QA midió que un denylist de siete dejaba
 *      pasar `unlinkSync`, `cpSync`, `copyFileSync`, `truncateSync`,
 *      `openSync`+`writeSync` y un `execFileSync("git", ["tag", "-f", …])`.
 *   2. `arch-rules.json` · `comparar-no-escribe` — el denylist, que sigue como
 *      cinturón por si la lista blanca se relaja algún día.
 *   3. `qa/mutacion-cableado-en-negativo.mjs` — corre el VERBO real y fotografía
 *      lo que no puede cambiar: la huella, el tag, `git status` y el árbol
 *      entero de `nefan-core/reports/`. Esa última parte no es adorno: `reports/`
 *      está en `.gitignore`, así que una escritura ahí no la ve `git status`, y
 *      es donde vive `reports/mutation-base/` —la base cuya destrucción es el
 *      motivo entero de este verbo—. QA lo demostró colando un fichero desde
 *      `mutacion.ts`, que es el sitio que las capas 1 y 2 no pueden cubrir
 *      porque ese fichero escribe la huella por diseño.
 *
 *  Lo que NO está cubierto, dicho entero: una escritura a una ruta de fuera del
 *  repo (`/tmp`, `$HOME`). No la ve ninguna de las tres, y no se vigila.
 *
 *  Lo que decide algo (el veredicto de adopción, los recuentos de `Timeout` y de
 *  `NoCoverage`) vive en `mutacion-huella.ts`, puro y con batería. Aquí solo
 *  queda leer informes e imprimir.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  capacidadDeLaBase,
  estadoLegible,
  instrumentoLegible,
  movimientosDeReloj,
  movimientosSinEjercer,
  sinEjercerDeFichero,
  timeoutsDeFichero,
  titularDeSinEjercer,
  totalDeReloj,
  totalSinEjercer,
  veredictoDeAdopcion,
  type BaseDeSinEjercer,
  type DeltaDeFichero,
  type InstrumentoMedido,
  type MutanteMedido,
  type RelojDeFichero,
  type SinEjercerDeFichero,
} from "./mutacion-huella.js";

/** Un módulo de la corrida nueva con el delta de sus ficheros — la MISMA
 *  estructura que construye `repartir`, recibida ya calculada. Este fichero no
 *  vuelve a calcular el delta: dos cálculos gemelos del mismo delta es el fallo
 *  que `mutacion-huella.ts` ya documenta de los dos ternarios de
 *  `estadoLegible`. */
export interface ModuloComparado {
  modulo: string;
  ficheros: readonly DeltaDeFichero[];
}

/** Las poblaciones de un fichero en la corrida NUEVA que la huella no sabe
 *  expresar. Salen del mismo recorrido de informes que el delta. */
export interface PoblacionesAhora {
  timeouts: readonly string[];
  sinEjercer: readonly string[];
  /** Todo lo que entró en el denominador: sin esto, un `Timeout` que salió de
   *  la medida se rotularía «lo mata ahora un test». */
  medidos: readonly string[];
}

/** Lo que la huella COMMITEADA sabe de un fichero, y si habla del mismo código. */
export interface BaseDeFichero {
  vivos: readonly string[];
  mismoCodigo: boolean;
}

export interface ComparacionEnSeco {
  corrida: {
    run_id: string;
    sha: string;
    desde: string;
    origen: string;
    /** Lo que dictamina `veredictoDeCorrida`. Los dos entran en el criterio: una
     *  corrida a la que le faltan módulos no sostiene un «no se movió nada», y
     *  una que no puede mover el tag no declara medida la casa. */
    completa: boolean;
    mueveTag: boolean;
    porque: string;
  };
  modulos: readonly ModuloComparado[];
  ahora: Readonly<Record<string, PoblacionesAhora>>;
  base: Readonly<Record<string, BaseDeFichero>>;
  /** Ficheros cuyo fuente cambió desde la medida anterior. Parten en dos el
   *  `incomparable`: el del instrumento (que es el hallazgo) y el del código
   *  (que es un falso rojo con otro remedio). */
  codigoCambiado: readonly string[];
  /** Contra qué revisión se leyó la huella. Se imprime SIEMPRE. */
  revBase: string;
  /** Los ficheros que la huella espera ver medidos. El conjunto lo fija la
   *  HUELLA, no la corrida: ver `CorridaQueJuzga`. */
  esperados: readonly string[];
  /** Directorio (ya resuelto y comprobado por `dirDeTimeouts`) con los informes
   *  de la corrida BASE. Sin él no hay forma de saber qué `Timeout` y qué
   *  `NoCoverage` había antes: la huella no los guarda. */
  dirBase?: string;
  /** Con qué `coverageAnalysis` midió la corrida NUEVA, ya legible. Se imprime
   *  SIEMPRE, al lado del de la base: el informe tiene que decir CUÁL de las
   *  dos cosas está mirando, porque hasta #599 afirmaba «el instrumento nuevo
   *  mide MENOS» sin poder saberlo. */
  coberturaAhora: string;
}

interface InformeCrudo {
  files: Record<string, { mutants: MutanteMedido[] }>;
  /** Lo que Stryker deja escrito de su propia configuración. Aquí interesan
   *  los DOS campos del instrumento —`testRunner` y `coverageAnalysis`—, y
   *  ninguno es opcional: ver `instrumentoDelInforme`. */
  config?: { coverageAnalysis?: unknown; testRunner?: unknown };
}

/** Con qué se midió un informe —runner Y ajuste—, o un error que dice qué
 *  fichero no se entiende.
 *
 *  LOS DOS CAMPOS, Y NO SOLO EL AJUSTE. Si esto devolviera únicamente el
 *  `coverageAnalysis`, `capacidadDeLaBase` decidiría con la mitad del dato
 *  teniendo la otra mitad en el mismo objeto: una base medida con `tap` + `off`
 *  —que SÍ emite `NoCoverage`, medido— se contaría como incapaz y la séptima
 *  condición se abstendría sobre un informe que sí midió (QA de #597, H-1).
 *
 *  FAIL-LOUD Y NO UN DEFECTO. Un informe sin `config` no es «off»: es un
 *  informe que no se entiende, y suponerle `off` volvería a meter por la puerta
 *  de atrás el defecto de #599 —dar por medido lo que la base no podía medir—
 *  justo en el sitio donde nadie miraría. Medido el 2026-09-15 sobre los tres
 *  directorios en disco: 58 + 58 + 55 informes de módulo, CERO sin `config` y
 *  CERO sin `testRunner` (`corrida.json` no es un informe y no llega aquí). */
export function instrumentoDelInforme(quien: string, informe: InformeCrudo): InstrumentoMedido {
  const cobertura = informe.config?.coverageAnalysis;
  const runner = informe.config?.testRunner;
  const falta = [
    typeof cobertura !== "string" || cobertura === "" ? "config.coverageAnalysis" : undefined,
    typeof runner !== "string" || runner === "" ? "config.testRunner" : undefined,
  ].filter((x): x is string => x !== undefined);
  if (falta.length > 0) {
    throw new Error(
      `el informe ${quien} no dice con qué se midió (falta ${falta.join(" y ")}).\n` +
        `  No se le supone nada: de eso va #599 — un runner que no reporta cobertura, con "off", no puede\n` +
        `  emitir NoCoverage JAMÁS, así que tratar un informe ilegible como si fuera capaz (o incapaz) es\n` +
        `  inventarse la medida. La capacidad la decide el PAR (runner, ajuste), no uno de los dos.`,
    );
  }
  return { runner: runner as string, cobertura: cobertura as string };
}

/** Lo que la corrida base tenía de un módulo y la huella no puede contar.
 *  `undefined` = esa corrida no midió este módulo, que NO es lo mismo que «no
 *  tenía ninguno»: con cero, todo lo de ahora se leería como movimiento.
 *
 *  Trae además CON QUÉ SE MIDIÓ. Ese dato ya viajaba dentro de cada informe y
 *  nadie lo leía, y es el que decide si su «cero NoCoverage» es una medida o es
 *  lo único que podía decir (#599). */
interface BaseDeModulo {
  instrumento: InstrumentoMedido;
  ficheros: Record<string, { timeouts: string[]; sinEjercer: string[] }>;
}

function poblacionesDeLaBase(dir: string, modulo: string): BaseDeModulo | undefined {
  const ruta = join(dir, `${modulo}.json`);
  if (!existsSync(ruta)) return undefined;
  const informe = JSON.parse(readFileSync(ruta, "utf8")) as InformeCrudo;
  const ficheros: Record<string, { timeouts: string[]; sinEjercer: string[] }> = {};
  for (const [fichero, info] of Object.entries(informe.files)) {
    ficheros[fichero] = {
      timeouts: timeoutsDeFichero(fichero, info.mutants),
      sinEjercer: sinEjercerDeFichero(fichero, info.mutants),
    };
  }
  return { instrumento: instrumentoDelInforme(`base de ${modulo} (${ruta})`, informe), ficheros };
}

/** Cómo se lee el instrumento de un informe: lo escribe `instrumentoLegible`,
 *  el MISMO que usa el lado «ahora», para que las dos mitades de la línea «qué
 *  se mira» no puedan divergir. «off» a secas no dice nada: lo que hay que
 *  decir es si con ESE PAR (runner, ajuste) el informe podía emitir
 *  `NoCoverage`. `command`+`off` no podía; `tap`+`off` sí —el runner reporta
 *  cobertura aunque el ajuste esté apagado, medido el 2026-09-15. */
const comoSeLee = instrumentoLegible;

const columnas = (celdas: readonly (string | number)[], anchos: readonly number[]): string =>
  `  ${celdas.map((c, i) => (i === 0 ? String(c).padEnd(anchos[i]) : String(c).padStart(anchos[i]))).join(" ")}`;

const ANCHOS = [28, 5, 6, 12, 7, 7, 9, 8, 5];
const CABECERA = ["módulo", "base", "ahora", "T→detectado", "T→vivo", "vivo→T", "killed→T", "T→fuera", "T→T"];

function imprimeDeltas(modulos: readonly ModuloComparado[]): void {
  for (const m of modulos) {
    console.log(`  ${m.modulo}`);
    for (const d of m.ficheros) {
      console.log(`    ${d.fichero}  ${d.vivos.length} vivos de ${d.total} — ${estadoLegible(d)}`);
    }
  }
}

/** Lo que hay que leer de la corrida base para contar lo que la huella no
 *  guarda: los `Timeout` y los `NoCoverage` de antes.
 *
 *  Se calcula ANTES de imprimir nada porque los `NoCoverage` son CONDICIÓN del
 *  veredicto, no decoración. Y se hace en una sola pasada: leer dos veces 141 MB
 *  de informes para dos recuentos es tonto, y dos recorridos del mismo material
 *  acaban discrepando.
 *
 *  SIN BASE SOLO PUEDE NEGAR. Un módulo del que no hay informe base entra con
 *  listas vacías: sus `Timeout` no se cuentan como movimiento (se dice, aparte)
 *  y sus `NoCoverage` salen TODOS como nuevos. Entre negar de más y autorizar de
 *  más, esto existe para lo segundo. */
function leeLaBase(c: ComparacionEnSeco): {
  reloj: RelojDeFichero[];
  sinEjercer: SinEjercerDeFichero[];
  modulosSinBase: string[];
  ficherosSinBase: string[];
  /** Los instrumentos (runner + ajuste) distintos que traían los informes base
   *  que se llegaron a abrir. Puede haber varios: una descarga mixta es
   *  posible, y es justo el caso en el que un booleano de corrida mentiría. */
  instrumentosBase: InstrumentoMedido[];
} {
  const reloj: RelojDeFichero[] = [];
  const sinEjercer: SinEjercerDeFichero[] = [];
  const modulosSinBase: string[] = [];
  const ficherosSinBase: string[] = [];
  const instrumentosBase = new Map<string, InstrumentoMedido>();

  for (const m of c.modulos) {
    const delModulo = c.dirBase === undefined ? undefined : poblacionesDeLaBase(c.dirBase, m.modulo);
    if (c.dirBase !== undefined && delModulo === undefined) modulosSinBase.push(m.modulo);
    if (delModulo !== undefined) {
      instrumentosBase.set(`${delModulo.instrumento.runner}+${delModulo.instrumento.cobertura}`, delModulo.instrumento);
    }
    for (const d of m.ficheros) {
      const ahora = c.ahora[d.fichero] ?? { timeouts: [], sinEjercer: [], medidos: [] };
      // Si el fuente cambió, las huellas llevan línea y columna de otro código y
      // no hablan de estos mutantes: ese fichero ya sale `incomparable` en el
      // veredicto y aquí se queda fuera en vez de inventar transiciones.
      if (c.base[d.fichero]?.mismoCodigo !== true) continue;
      const base = delModulo?.ficheros[d.fichero];
      if (base === undefined && c.dirBase !== undefined && delModulo !== undefined) {
        ficherosSinBase.push(d.fichero);
      }
      reloj.push(
        movimientosDeReloj(d.fichero, {
          timeoutsBase: base?.timeouts ?? [],
          vivosBase: c.base[d.fichero]?.vivos ?? [],
          timeoutsAhora: ahora.timeouts,
          vivosAhora: d.vivos,
          medidosAhora: ahora.medidos,
        }),
      );
      // AQUÍ VIVE LA DISTINCIÓN DE #599, y por fichero. Tres casos y ninguno se
      // colapsa con otro: no hay informe base (no se pudo mirar), lo hay pero
      // midió con `coverageAnalysis: "off"` (no PODÍA expresar `NoCoverage`, así
      // que su cero no es una medida), o lo hay y sí podía (entonces vota).
      //
      // EL ORDEN IMPORTA, y lo destapó QA (#599, H-3). Si el informe base del
      // módulo EXISTE y midió con `off`, ese informe no podría haber contestado
      // ni aunque el fichero estuviera dentro: la casilla es CENSO. Ponerlo en
      // «sin informe base» producía un motivo que se contradecía con su propia
      // cabecera («base: off» dos líneas más arriba) y prescribía `--timeouts`,
      // el flag que quien lee acaba de usar: un remedio sin salida.
      let capacidad: BaseDeSinEjercer = { sabe: false, porque: "sin informe base" };
      if (delModulo !== undefined) {
        const cap = capacidadDeLaBase(delModulo.instrumento);
        if (!cap.sabe) capacidad = cap;
        else if (base !== undefined) capacidad = { sabe: true, huellas: base.sinEjercer };
        // Base capaz y el fichero fuera del informe: ahí sí falta la medida, y
        // «sin informe base» es exactamente lo que pasa.
      }
      sinEjercer.push(movimientosSinEjercer(d.fichero, capacidad, ahora.sinEjercer));
    }
  }
  const instrumentos = [...instrumentosBase.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, i]) => i);
  return { reloj, sinEjercer, modulosSinBase, ficherosSinBase, instrumentosBase: instrumentos };
}

/** El bloque de los mutantes que clasifica el reloj. Va al FINAL y aparte: se
 *  pega literal en #443 y NO se resta del veredicto. */
function imprimeReloj(c: ComparacionEnSeco, leido: ReturnType<typeof leeLaBase>): void {
  console.log(`\n${"─".repeat(78)}`);
  console.log("MUTANTES CLASIFICADOS POR EL RELOJ (`Timeout`) — bloque aparte, NO se resta del veredicto");
  if (c.dirBase === undefined) {
    const total = totalDeReloj(leido.reloj);
    console.log(
      `\n  esta corrida trae ${total.ahora} mutante(s) clasificados por el reloj, y NO hay con qué compararlos:\n` +
        `  la huella guarda \`vivos\` y \`total\`, y ahí un Timeout es indistinguible de un Killed.\n` +
        `  Pásale los informes de la corrida base:  npm run mutacion -- comparar --timeouts reports/mutation-base\n` +
        `  (si se perdieron: gh run download <run-id> -n informe-mutacion -D nefan-core/reports/mutation-base)`,
    );
    return;
  }
  console.log(`  base: ${c.dirBase}`);
  // Los avisos van ARRIBA, antes de la tabla. Debajo del TOTAL nadie los lee: el
  // TOTAL es lo que se pega en el issue (QA, H5).
  for (const [lista, que] of [
    [leido.modulosSinBase, "módulo(s) de esta corrida no están en la corrida base"],
    [leido.ficherosSinBase, "fichero(s) no los midió la corrida base"],
  ] as const) {
    if (lista.length === 0) continue;
    console.log(
      `\n  ⚠ ${lista.length} ${que}: ${lista.slice(0, 6).join(", ")}${lista.length > 6 ? ` y ${lista.length - 6} más` : ""}\n` +
        `    sus Timeout salen como 0 movimientos porque no hay con qué compararlos, NO porque no se movieran.`,
    );
  }
  console.log("");
  console.log(columnas(CABECERA, ANCHOS));
  const porModulo = new Map(c.modulos.map((m) => [m.modulo, new Set(m.ficheros.map((f) => f.fichero))]));
  for (const m of c.modulos) {
    const suyas = leido.reloj.filter((r) => porModulo.get(m.modulo)?.has(r.fichero) === true);
    const t = totalDeReloj(suyas);
    if (t.base === 0 && t.ahora === 0) continue;
    console.log(
      columnas(
        [m.modulo, t.base, t.ahora, t.aDetectado, t.aVivo, t.vivoATimeout, t.killedATimeout, t.aFuera, t.siguen],
        ANCHOS,
      ),
    );
  }
  const total = totalDeReloj(leido.reloj);
  console.log(
    columnas(
      ["TOTAL", total.base, total.ahora, total.aDetectado, total.aVivo, total.vivoATimeout, total.killedATimeout, total.aFuera, total.siguen],
      ANCHOS,
    ),
  );
  console.log(
    `\n  T→detectado  lo mata ahora un test: el score no se mueve, y no es hallazgo de nadie.\n` +
      `  T→vivo       sale ADEMÁS como superviviente NUEVO en el veredicto de arriba.\n` +
      `  vivo→T       un superviviente que «resolvió» EL RELOJ y no un test: alimenta los RESUELTOS.\n` +
      `  killed→T     lo mataba un test y ahora lo mata el reloj.\n` +
      `  T→fuera      ya no tiene veredicto (RuntimeError, CompileError, Ignored): no lo mató nadie,\n` +
      `               SALIÓ DEL DENOMINADOR — y eso mueve el total, o sea que deja el fichero incomparable.`,
  );
}

/** El bloque de los mutantes que ya no ejerce ningún test. Éste SÍ es condición
 *  del veredicto, y por eso se imprime aunque salga a cero: es el que dice si el
 *  instrumento nuevo mide lo mismo o mide menos. */
function imprimeSinEjercer(c: ComparacionEnSeco, leido: ReturnType<typeof leeLaBase>): void {
  const total = totalSinEjercer(leido.sinEjercer);
  console.log(`\n${"─".repeat(78)}`);
  console.log("MUTANTES QUE NO EJERCE NINGÚN TEST (`NoCoverage`) — esto SÍ es condición");
  // QUÉ SE MIRA, SIEMPRE Y ARRIBA. Es lo que #599 echó de menos: el bloque
  // afirmaba «el instrumento nuevo mide MENOS» sin decir —ni poder saber— si la
  // base era capaz de decir lo contrario.
  const base =
    leido.instrumentosBase.length === 0
      ? "(ningún informe base abierto: no se pudo mirar)"
      : leido.instrumentosBase.map(comoSeLee).join(" + ");
  console.log(`  qué se mira: base: ${base} · ahora: ${c.coberturaAhora}`);
  console.log(
    `  antes: ${total.base} · ahora: ${total.ahora} · que antes sí se ejercían: ${total.nuevos} ` +
      `· que la base daba por no ejercidos y ahora no: ${total.recuperados} ` +
      `(sobre ${total.mirados} fichero(s) con base capaz)`,
  );
  console.log(`  censo (base incapaz): ${total.censo} · sin poder mirar (sin informe base): ${total.sinMirar}`);
  console.log(`  ${titularDeSinEjercer(total)}`);

  const lista = (filas: readonly SinEjercerDeFichero[], cuantos: (f: SinEjercerDeFichero) => number): void => {
    for (const f of [...filas].sort((a, b) => cuantos(b) - cuantos(a)).slice(0, 10)) {
      console.log(`  ${String(cuantos(f)).padStart(5)}  ${f.fichero}`);
    }
  };

  if (total.nuevos > 0) {
    console.log("");
    lista(
      leido.sinEjercer.filter((f) => f.base.sabe && f.base.nuevos > 0),
      (f) => (f.base.sabe ? f.base.nuevos : 0),
    );
    console.log(
      `\n  \`Survived\` es «un test pasó por la línea y no se enteró»; \`NoCoverage\` es «nadie pasó siquiera».\n` +
        `  \`esVivo\` los colapsa, así que el delta no los distingue — y el segundo es MEDIDA QUE SE PIERDE.`,
    );
  }

  // EL SENTIDO REVERSO, con su propia lista: la base sabía decirlo y esta
  // corrida ya no. Si la cabecera de arriba dice `ahora: off`, ésta es la
  // explicación entera — `off` no puede emitir `NoCoverage` JAMÁS.
  if (total.recuperados > 0) {
    console.log(
      `\n  EL SENTIDO REVERSO: ${total.recuperados} mutante(s) que la base daba por NO EJERCIDOS y esta\n` +
        `  corrida ya no reporta así. Es el MISMO código, así que no ha aparecido ningún test: o el\n` +
        `  instrumento nuevo dejó de saber expresar \`NoCoverage\`, o cambió lo que reporta. Las dos son la\n` +
        `  medida moviéndose, y \`esVivo\` impide que nuevos y resueltos se enteren.`,
    );
    lista(
      leido.sinEjercer.filter((f) => f.base.sabe && f.base.recuperados > 0),
      (f) => (f.base.sabe ? f.base.recuperados : 0),
    );
  }

  // EL CENSO SE IMPRIME ENTERO Y NO VOTA. La información vale, y mucho: son los
  // mutantes que el instrumento nuevo sabe separar y el viejo no podía nombrar.
  // Lo que no puede hacer es contarse como «antes se ejercían», porque con la
  // base en `command` + `off` eso no se puede saber por construcción.
  if (total.censo > 0) {
    console.log(
      `\n  CENSO (no es condición): ${total.censo} mutante(s) \`NoCoverage\` cuya base midió con\n` +
        `  \`testRunner: "command"\` y \`coverageAnalysis: "off"\`, par que NO PUEDE emitir \`NoCoverage\` JAMÁS. Su cero no es una medida, así\n` +
        `  que esto no dice que se mida menos: dice cuánto separa el instrumento nuevo que el viejo no sabía\n` +
        `  nombrar (#598). Quien cruza si es medida GANADA o PERDIDA son los nuevos y los resueltos de\n` +
        `  arriba: si ningún mutante cambió de bando, nadie perdió nada.`,
    );
    lista(
      leido.sinEjercer.filter(
        (f) => !f.base.sabe && f.base.porque === 'testRunner "command" + coverageAnalysis "off"' && f.ahora > 0,
      ),
      (f) => f.ahora,
    );
  }

  if (total.sinMirar > 0) {
    console.log(
      `\n  SIN PODER MIRAR: ${total.sinMirar} mutante(s) \`NoCoverage\` sin informe base con el que saber si\n` +
        `  antes se ejercían. Eso NIEGA —no es un verde—, y se arregla con los informes de la corrida base:\n` +
        `    npm run mutacion -- comparar --timeouts reports/mutation-base`,
    );
    lista(
      leido.sinEjercer.filter((f) => !f.base.sabe && f.base.porque === "sin informe base" && f.ahora > 0),
      (f) => f.ahora,
    );
  }
}

/** Imprime la comparación y devuelve el código de salida.
 *
 *  EXIT ≠ 0 SALVO QUE SE CUMPLA TODO. Las siete condiciones viven en
 *  `veredictoDeAdopcion`, puro y con batería: aquí no se decide nada, se enseña. */
export function comparaEnSeco(c: ComparacionEnSeco): number {
  const deltas = c.modulos.flatMap((m) => m.ficheros);
  const leido = leeLaBase(c);
  const veredicto = veredictoDeAdopcion(deltas, {
    esperados: c.esperados,
    mueveTag: c.corrida.mueveTag,
    completa: c.corrida.completa,
    sinEjercer: leido.sinEjercer,
    codigoCambiado: c.codigoCambiado,
  });
  const { corrida } = c;

  console.log(
    `\nComparación EN SECO de la corrida ${corrida.run_id} sobre ${corrida.sha.slice(0, 7)} ` +
      `(${corrida.desde.slice(0, 7)}..${corrida.sha.slice(0, 7)}, ${corrida.origen})\n` +
      `  contra la huella COMMITEADA en ${c.revBase}. No se escribe nada: ni la huella, ni el tag, ni un\n` +
      `  comentario, ni reports/.\n` +
      `  ${corrida.completa ? "COMPLETA" : "INCOMPLETA"} — ${corrida.porque}\n`,
  );
  imprimeDeltas(c.modulos);

  console.log(`\n${"─".repeat(78)}`);
  console.log("VEREDICTO DE ADOPCIÓN");
  console.log(`  comparables    : ${veredicto.comparables} fichero(s) de los ${c.esperados.length} de la huella`);
  console.log(`  nuevos         : ${veredicto.nuevos}`);
  console.log(`  resueltos      : ${veredicto.resueltos}`);
  console.log(`  incomparables  : ${veredicto.incomparables.length} fichero(s) (cambió el instrumento)`);
  console.log(`  base de otro código : ${veredicto.incomparablesPorCodigo.length} fichero(s) (cambió el fuente, NO el runner)`);
  console.log(`  sin base       : ${veredicto.sinBase.length} fichero(s)`);
  console.log(`  sin medir      : ${veredicto.sinMedir.length} fichero(s)`);
  // TRES cuentas donde había una, porque eran tres hechos distintos con el
  // mismo nombre: lo que se midió y se perdió, lo que la base no podía nombrar
  // y lo que no se pudo mirar. Solo el primero y el tercero votan (#599).
  console.log(`  sin ejercer    : ${veredicto.sinEjercer} mutante(s) (donde SÍ se pudo mirar)`);
  console.log(`  · censo        : ${veredicto.sinEjercerCenso} mutante(s) con la base incapaz — NO vota`);
  console.log(`  · sin mirar    : ${veredicto.sinEjercerSinMirar} mutante(s) sin informe base`);
  console.log(`  · reverso      : ${veredicto.sinEjercerRecuperados} mutante(s) que la base sí sabía nombrar`);
  console.log(`  corrida        : ${corrida.completa ? "COMPLETA" : "INCOMPLETA"}${corrida.mueveTag ? " y mueve el tag" : ", NO mueve el tag"}`);
  console.log(`\n  ⇒ ${veredicto.adopta ? "SE PUEDE ADOPTAR" : "NO SE ADOPTA"} — ${veredicto.porque}`);
  if (!veredicto.adopta) {
    console.log(
      `\n  La regla es del usuario y no se negocia: si un solo score se mueve fichero a fichero, no se adopta\n` +
        `  y el issue se cierra con el número.`,
    );
  }

  imprimeSinEjercer(c, leido);
  imprimeReloj(c, leido);
  console.log("");
  return veredicto.adopta ? 0 : 1;
}
