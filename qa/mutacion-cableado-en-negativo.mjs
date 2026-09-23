#!/usr/bin/env node
/** ¿Se puede poner ROJO el CABLEADO del ciclo de mutación?
 *
 *  Vecino de `qa/mutacion-candados-en-negativo.mjs`, y complementario: aquél
 *  rompe `scripts/mutacion-huella.ts` —el fichero puro— y mira si la batería se
 *  entera. Éste rompe lo que la batería NO puede mirar: la familia
 *  `scripts/mutacion-*.ts` (los trozos del verbo, #605), `scripts/mutate.ts` y
 *  `.github/workflows/mutation.yml`.
 *
 *  POR QUÉ EXISTE. PR-A (#381 + #420) declaró su propia carencia: «el invariante
 *  "`repartir` ancla en `corrida.desde` y NO en el tag" no lo defiende ningún
 *  test, porque ningún test importa `scripts/mutacion.ts`». QA midió cuánto más
 *  estaba en esa situación y salieron SIETE reversiones que no ponen rojo nada:
 *  el ancla del reparto, la contradicción del rango vacío, el fail-loud de
 *  `leerCorrida`, el cálculo del sello, el ancla que escribe `manifiesto`, la
 *  admisión de `--pedidos ""` y el paso entero del workflow. Es decir: los dos
 *  issues que la PR cierra se pueden deshacer, en la herramienta que se usa, sin
 *  que `npm run verify` se inmute. La regla de la casa es candado, no prosa.
 *
 *  Cómo funciona: cada invariante se ejerce contra la HERRAMIENTA REAL —el verbo
 *  de verdad, sobre un `reports/mutation/` de ensayo— en las dos direcciones:
 *  primero se comprueba que hace lo que dice, y después se deshace el cambio en
 *  el fuente y se exige que el observable CAMBIE. Un invariante cuyo rojo no se
 *  ve es prosa, y aquí se cuenta como fallo.
 *
 *  NO mide mutación: no lanza Stryker, ni `npm run mutate`, ni
 *  `npm run mutacion -- local`, ni `traer` (que llamaría a `gh`). No abre
 *  puertos, no arranca el juego y no gasta un crédito.
 *
 *    node qa/mutacion-cableado-en-negativo.mjs
 *    node qa/mutacion-cableado-en-negativo.mjs ancla    # solo los que casen
 *
 *  PR-E (la corrida partida en lotes) añade cuatro más, por el mismo motivo: el
 *  plan que sube ANTES de medir, el fail-loud de la fusión sin plan, el
 *  cronómetro de `mutate.ts` y el `fail-fast: false` de la matriz. Todo eso vive
 *  en scripts y en YAML, o sea donde ningún test llega.
 *
 *  La tanda D añade uno AL REVÉS: el verbo `comparar` existe para NO escribir
 *  (si escribiera, medir con un instrumento nuevo destruiría la base contra la
 *  que había que compararlo), así que su invariante no exige que diga algo sino
 *  que no deje rastro — huella byte a byte igual, tag quieto y `git status`
 *  como estaba.
 *
 *  Verde = todos los invariantes del cableado se pueden ver rotos.
 *  Rojo  = hay una pieza del ciclo que se puede deshacer sin que se note.
 *
 *  QUÉ TOCA Y CÓMO LO DEVUELVE. Escribe en el árbol de trabajo: aparta
 *  `nefan-core/reports/mutation/` (que es material descargado, no versionado),
 *  y modifica temporalmente `scripts/mutacion-informes.ts`,
 *  `scripts/mutacion-lotes.ts`, `scripts/mutacion-reparto.ts`,
 *  `scripts/mutate.ts`, `scripts/mutacion-comparar.ts`, el workflow y
 *  `data/contract/mutacion-huella.json` —que `repartir` reescribe por diseño—.
 *  Todo vuelve en el `finally` y se verifica byte a byte al terminar; si algo no
 *  volvió, sale con 2 y lo dice.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { aplicarPares } from "./lib/anclas.mjs";
import { turnoDeCandados } from "./lib/turno-exclusivo.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");
/** Los TROZOS de `scripts/mutacion.ts`, que #605 partió por CIERRE DE LLAMADAS:
 *  en el fichero del nombre solo quedaron la tabla `VERBOS` y `main`, y la línea
 *  de cada invariante de aquí abajo se mudó al cierre que la usa. Los `rompe`
 *  casan por TEXTO EXACTO, así que mover una de esas líneas de trozo sin
 *  repuntar este guion sale como «patrón obsoleto», no como verde. */
const INFORMES_TS = join(CORE, "scripts", "mutacion-informes.ts");
const LOTES_TS = join(CORE, "scripts", "mutacion-lotes.ts");
const REPARTO = join(CORE, "scripts", "mutacion-reparto.ts");
/** `mutate.ts` entra con PR-E: es quien cronometra cada módulo, y ese número es
 *  lo único que hace posible repartir la corrida por el reloj. */
const MUTATE = join(CORE, "scripts", "mutate.ts");
/** El verbo que existe para NO escribir. Su candado es al revés que los de
 *  arriba: no se comprueba que haga algo, sino que no deja rastro. */
const COMPARAR = join(CORE, "scripts", "mutacion-comparar.ts");
/** Donde vive la decisión de si una medida PUDO mirar: `capacidadDeLaBase`. */
const HUELLA_TS = join(CORE, "scripts", "mutacion-huella.ts");
const YML = join(raiz, ".github", "workflows", "mutation.yml");
const HUELLA = join(CORE, "data", "contract", "mutacion-huella.json");
const PLAN = join(CORE, "data", "contract", "mutation-targets.json");
const INFORMES = join(CORE, "reports", "mutation");
const APARTADO = join(CORE, "reports", "mutation.qa-cableado");
/** Lo que deja el probe de la escritura indirecta: una ruta GITIGNORADA dentro
 *  de `reports/`, que es donde vive la base de la comparación. */
const COLADO = join(CORE, "reports", "colado");
const CORRIDA = join(INFORMES, "corrida.json");
/** La corrida BASE de ensayo del invariante de #599: el mismo material medido,
 *  y lo único que cambia entre las lecturas es el INSTRUMENTO que declara
 *  (runner + ajuste), porque la capacidad la decide el par y no el ajuste. */
const BASE_ENSAYO = join(CORE, "reports", "base-ensayo");

const git = (args) => execFileSync("git", args, { cwd: raiz, encoding: "utf8" }).trim();

/** El verbo de verdad, con su salida y su código. */
function mutacion(args) {
  const r = spawnSync("npm", ["run", "--silent", "mutacion", "--", ...args], {
    cwd: CORE,
    encoding: "utf8",
    timeout: 300000,
  });
  return { ok: r.status === 0, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ── el escenario de ensayo ───────────────────────────────────────────────────

/** El ancla y el commit medido salen del TAG, no de `HEAD`: así el reparto
 *  anclado en `corrida.desde` ve un rango con commits y el anclado en el tag
 *  (el bug de #381, que el propio workflow provoca al adelantarlo) ve cero. Sin
 *  esa asimetría, las dos versiones darían lo mismo y el candado no distinguiría
 *  nada — que es exactamente la forma del verde que no comprueba. */
function escenario() {
  const tag = git(["rev-parse", "mutacion-ultima^{commit}"]);
  const anterior = git(["rev-parse", `${tag}~4`]);
  const plan = JSON.parse(readFileSync(PLAN, "utf8"));
  const modulo = plan.modulos.find((m) => {
    if (m.mutate.length !== 1 || m.mutate[0].startsWith("!")) return false;
    const r = spawnSync("git", ["cat-file", "-e", `${tag}:nefan-core/${m.mutate[0]}`], { cwd: raiz });
    return r.status === 0;
  });
  if (!modulo) throw new Error("ningún módulo del plan tiene un solo fichero vivo en el tag");
  return { tag, anterior, id: modulo.id, fichero: modulo.mutate[0] };
}

const E = escenario();

/** Un informe de Stryker mínimo pero real: un superviviente con su sitio. */
function siembraInforme(marca = "x") {
  rmSync(INFORMES, { recursive: true, force: true });
  mkdirSync(INFORMES, { recursive: true });
  soloInforme(marca);
}

/** Reescribe SOLO el informe del módulo, dejando el `corrida.json` que ya
 *  estuviera: es lo que hace `npm run mutacion -- local <id>` encima de una
 *  descarga, y es el caso exacto de #420.
 *
 *  Lleva `config.coverageAnalysis` **y `config.testRunner`** porque un informe
 *  de Stryker lleva los dos siempre (medido el 2026-09-15: 171 informes en
 *  disco, cero sin ellos) y porque `comparar` se NIEGA a leer uno al que le
 *  falte cualquiera de los dos: la capacidad de emitir `NoCoverage` depende del
 *  PAR —`command`+`off` no podía, `tap`+`off` sí—, así que con medio dato no se
 *  puede decir qué se está mirando (#599, y el par por el H-1 de QA en #597). */
function soloInforme(marca = "x", estado = "Survived", cobertura = "perTest", runner = "tap") {
  writeFileSync(join(INFORMES, `${E.id}.json`), informeDe(marca, estado, cobertura, E.fichero, runner));
}

/** El mismo informe mínimo, como texto, para poder sembrarlo también en un
 *  directorio de base. `fichero` se puede cambiar para sembrar una base que
 *  EXISTE y no contiene el fichero que se compara (probe de H-3). */
function informeDe(marca = "x", estado = "Survived", cobertura = "perTest", fichero = E.fichero, runner = "tap") {
  const mutante = (id, status, columna, replacement) => ({
    id: String(id),
    mutatorName: "BooleanLiteral",
    replacement,
    status,
    location: { start: { line: 1, column: columna }, end: { line: 1, column: columna + 1 } },
  });
  // EL DENOMINADOR TIENE QUE SER EL DE LA HUELLA, y no es cosmética (#596).
  // Desde que `repartir` FALLA FUERTE ante un fichero que, con el mismo blob,
  // trae menos mutantes con veredicto que su última medida, un informe de
  // ensayo con un solo mutante contra una huella de nueve es exactamente ese
  // caso: el guion moría en el primer invariante con el guardia nuevo, que es
  // el guardia haciendo su trabajo sobre un informe sintético. Se rellena con
  // `Killed` en columnas distintas —la huella de un mutante lleva línea y
  // columna, así que dos en la misma serían el mismo— hasta el total medido.
  const total = relleno(fichero);
  return JSON.stringify({
    files: {
      [fichero]: {
        mutants: [
          mutante(1, estado, 1, marca),
          ...Array.from({ length: Math.max(0, total - 1) }, (_, i) => mutante(i + 2, "Killed", i + 3, `k${i}`)),
        ],
      },
    },
    config: { coverageAnalysis: cobertura, testRunner: runner },
  });
}

/** Cuántos mutantes MEDIDOS tiene ese fichero en la huella commiteada, que es
 *  la base contra la que compara `repartir`. Un fichero que la huella no
 *  conoce se queda con uno: ahí el delta sale «sin base» y no hay denominador
 *  con el que chocar. */
function relleno(fichero) {
  const fila = JSON.parse(readFileSync(HUELLA, "utf8")).ficheros[fichero];
  return typeof fila?.total === "number" && fila.total > 0 ? fila.total : 1;
}

/** La foto de lo que un verbo EN SECO no puede tocar: la huella commiteada, el
 *  tag, el árbol de git **y el árbol entero de `nefan-core/reports/`**.
 *
 *  LO ÚLTIMO NO ES ADORNO, y es lo que la primera versión no miraba. `reports/`
 *  está en `.gitignore`, así que una escritura ahí NO la ve `git status`: QA
 *  coló un fichero en `nefan-core/reports/colado/rastro.txt` desde el verbo y
 *  las tres señales de esta foto decían «árbol intacto». Y `reports/` es donde
 *  vive `reports/mutation-base/`, o sea la base cuya destrucción es el motivo
 *  entero de que exista `comparar`.
 *
 *  Se toma ANTES y DESPUÉS dentro del mismo `mira`, y eso no es un detalle: el
 *  propio probe modifica el fuente para romperlo, así que esa modificación sale
 *  en las DOS fotos y se cancela. Comparar contra una foto tomada fuera diría
 *  «el árbol cambió» por culpa del guion y el candado se pondría rojo sin que
 *  el verbo hubiera escrito nada — un rojo por el motivo equivocado es tan
 *  inútil como un verde que no comprueba.
 *
 *  Lo que esta foto NO ve, dicho para que nadie lo suponga: una escritura fuera
 *  del repo (`/tmp`, `$HOME`). */
const inventarioDeReports = (dir) => {
  const salida = [];
  const anda = (d, rel) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const hijo = join(d, e.name);
      const ruta = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) anda(hijo, ruta);
      else {
        const s = statSync(hijo);
        salida.push(`${ruta}:${s.size}:${Math.round(s.mtimeMs)}`);
      }
    }
  };
  anda(dir, "");
  return salida.join("\n");
};

const fotoDelArbol = () =>
  [
    `huella:${createHash("sha256").update(readFileSync(HUELLA)).digest("hex").slice(0, 16)}`,
    `tag:${git(["rev-parse", "mutacion-ultima"]).slice(0, 12)}`,
    `status:${createHash("sha256").update(git(["status", "--porcelain"])).digest("hex").slice(0, 16)}`,
    `reports:${createHash("sha256").update(inventarioDeReports(join(CORE, "reports"))).digest("hex").slice(0, 16)}`,
  ].join(" ");

/** El manifiesto lo escribe la herramienta, no este guion: si lo fabricara a
 *  mano, el sello sería el que yo digo y no el que ella calcula — y lo que se
 *  prueba es justo eso. */
function manifiesta({ desde = E.anterior, sha = E.tag, origen = "rango", run = "999900", pedidos = E.id } = {}) {
  const r = mutacion(["manifiesto", "--origen", origen, "--pedidos", pedidos, "--sha", sha, "--desde", desde, "--run", run]);
  if (!r.ok) throw new Error(`el manifiesto de ensayo no se pudo escribir:\n${r.salida}`);
  return r;
}

// ── los invariantes del cableado ─────────────────────────────────────────────

/** [nombre, preparar → observable esperado, [fichero, buscar, poner]]
 *
 *  `mira()` devuelve una cadena: lo que se compara. El invariante está candado
 *  si con el fuente ENTERO la cadena casa con `bien`, y con el fuente ROTO deja
 *  de casar. */
const INVARIANTES = [
  {
    nombre: "ancla · el reparto ancla en la corrida, no en el tag que ella misma movió (#381)",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999901" });
      return mutacion(["repartir"]).salida;
    },
    bien: (s) => new RegExp(`${E.anterior.slice(0, 7)}\\.\\.${E.tag.slice(0, 7)}`).test(s) && !/no tiene ni un commit/.test(s),
    porque: "el reparto tiene que mirar el rango del MANIFIESTO; con el tag como ancla no hay rango que mirar",
    // El `poner` anclaba en `shaDelTag()`, que es literalmente el defecto de
    // #381. `mutacion-reparto.ts` no importa `shaDelTag` y NO se le añade el
    // import para que compile un probe —un símbolo que solo existe para esto es
    // una mentira en el tipo, y además lint lo daría por no usado—: `corrida.sha`
    // deja el MISMO observable, porque el tag que `shaDelTag()` leía ya venía
    // adelantado a `corrida.sha` por el propio workflow. Rango vacío las dos veces.
    rompe: [REPARTO, `commitsDelRango(plan, corrida.desde, corrida.sha)`, `commitsDelRango(plan, corrida.sha, corrida.sha)`],
  },
  {
    nombre: "ancla · un rango VACÍO con origen `rango` es una contradicción y lanza",
    mira: () => {
      siembraInforme();
      manifiesta({ desde: E.tag, run: "999902" });
      return mutacion(["repartir"]).salida;
    },
    bien: (s) => /no tiene ni un commit/.test(s),
    porque: "CI no puede haber seleccionado módulos de un diff vacío: callarlo deja pasar una no-medida con cara de resultado",
    rompe: [REPARTO, `  if (corrida.origen === "rango" && rango.tipo === "vacío") {`, `  if (false && corrida.origen === "rango" && rango.tipo === "vacío") {`],
  },
  {
    nombre: "sello · el guardia mira el CONTENIDO del informe, no su nombre (#420)",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999903" });
      // Lo que deja un `npm run mutacion -- local <id>` corrido encima de la
      // descarga: el mismo nombre de fichero, otra medida dentro.
      soloInforme("el-que-dejo-el-local");
      return mutacion(["repartir"]).salida;
    },
    bien: (s) => new RegExp(`NO son los que midió la corrida[\\s\\S]*${E.id}`).test(s),
    porque: "sin sello, una medida local entra en la huella COMMITEADA con el sha, la fecha y el run de CI encima",
    rompe: [INFORMES_TS, `  return createHash("sha256").update(readFileSync(ruta)).digest("hex");`, `  void ruta;\n  return "0".repeat(64);`],
  },
  {
    nombre: "sello · `corrida.json` no es un informe: sellarlo inventaría un módulo fantasma",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999904" }); // escribe corrida.json DENTRO del directorio
      manifiesta({ run: "999908" }); // y el siguiente manifiesto lo ve ahí
      return JSON.parse(readFileSync(CORRIDA, "utf8")).informes.map((i) => i.modulo).join(",");
    },
    bien: (s) => s === E.id,
    porque: "el manifiesto declararía un informe `corrida` que ningún módulo del plan tiene, y `repartir` moriría buscándolo",
    rompe: [INFORMES_TS, `    .filter((f) => f.endsWith(".json") && f !== "corrida.json")`, `    .filter((f) => f.endsWith(".json"))`],
  },
  {
    nombre: "formato · un `corrida.json` sin `desde` ni `informes` se rechaza DICIENDO qué falta",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999905" });
      const c = JSON.parse(readFileSync(CORRIDA, "utf8"));
      delete c.desde;
      c.modulos_con_informe = c.informes.map((i) => i.modulo);
      delete c.informes;
      writeFileSync(CORRIDA, JSON.stringify(c, null, 2));
      return mutacion(["repartir"]).salida;
    },
    bien: (s) => /no está bien: desde \(el ancla del rango\); informes/.test(s),
    porque: "pre-producción, cero compatibilidad: leerlo «como se pueda» son las dos degradaciones que salen verdes y mienten",
    rompe: [
      INFORMES_TS,
      `  if (!cadena(corrida.desde)) mal.push("desde (el ancla del rango)");`,
      `  if (false) mal.push("desde (el ancla del rango)");`,
    ],
  },
  {
    nombre: "manifiesto · guarda el ANCLA que le dan, no el sha medido",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999906" });
      return JSON.parse(readFileSync(CORRIDA, "utf8")).desde ?? "(sin desde)";
    },
    bien: (s) => s === E.anterior,
    porque: "si el manifiesto guardara el sha medido, el rango saldría vacío por construcción: el bug de #381 con otro disfraz",
    rompe: [LOTES_TS, `    desde: valor("--desde"),`, `    desde: valor("--sha"),`],
  },
  {
    nombre: "manifiesto · `--pedidos` vacío significa TODOS, y los demás flags siguen siendo estrictos",
    mira: () => {
      siembraInforme();
      const vacio = mutacion(["manifiesto", "--origen", "todos", "--pedidos", "", "--sha", E.tag, "--desde", E.anterior, "--run", "999907"]);
      const sinAncla = mutacion(["manifiesto", "--origen", "todos", "--pedidos", "", "--sha", E.tag, "--desde", "", "--run", "999907"]);
      return `pedidos-vacio:${vacio.ok} sin-ancla:${sinAncla.ok}`;
    },
    bien: (s) => s === "pedidos-vacio:true sin-ancla:false",
    porque: "el input TODOS del workflow manda `--pedidos \"\"`: rechazarlo mata el manifiesto DESPUÉS de 131 min de runner",
    rompe: [LOTES_TS, `    if (i < 0 || argv[i + 1] === undefined) throw new Error("manifiesto necesita --pedidos");`, `    if (i < 0 || !argv[i + 1]) throw new Error("manifiesto necesita --pedidos");`],
  },
  {
    nombre: "workflow · el paso de selección LEE el ancla y el del manifiesto la PASA",
    // El YAML no lo ejecuta nadie aquí, así que lo único comprobable es que las
    // tres piezas siguen escritas. Es poco, y es más que nada: la reversión del
    // paso entero no la nota hoy ninguna herramienta del repo.
    mira: () => readFileSync(YML, "utf8"),
    bien: (s) =>
      /DESDE="\$\(npm run --silent mutacion -- ancla\)"/.test(s) &&
      /echo "desde=\$DESDE" >> "\$GITHUB_OUTPUT"/.test(s) &&
      /--desde "\$DESDE"/.test(s) &&
      /DESDE: \$\{\{ steps\.seleccion\.outputs\.desde \}\}/.test(s),
    porque: "sin el ancla en el manifiesto, `repartir` no tiene de dónde sacarla y el reparto vuelve a colgar del tag",
    rompe: [YML, `          DESDE="$(npm run --silent mutacion -- ancla)"\n`, ``],
  },

  // ── Tanda D · la comparación EN SECO ───────────────────────────────────────
  //
  // Los dos candados de aquí abajo son al revés de los de arriba: allí se exige
  // que el verbo DIGA algo, aquí que no DEJE nada. Y hacen falta aquí y no en la
  // batería por lo de siempre —ningún test importa `scripts/mutacion.ts`—, pero
  // sobre todo porque las reglas de `arch-rules.json` que sujetan a
  // `mutacion-comparar.ts` (`comparar-solo-lee` y `comparar-no-escribe`) NO
  // pueden cubrir las líneas del verbo que viven en `mutacion-reparto.ts`: ese
  // fichero escribe la huella por diseño. Ésa es exactamente la costura por la que QA
  // coló un fichero, así que hay un probe por costura.
  {
    nombre: "repartir · un DENOMINADOR que encoge sin que el código cambie PARA el reparto (#596)",
    // Lo que esto sujeta, y por qué no lo puede sujetar la batería: la decisión
    // (`medidaPerdida`) sí tiene tests, pero que `repartir` la CONSULTE ANTES
    // DE ESCRIBIR la huella no lo mira nadie — y el orden es el invariante
    // entero. Escribir primero consolidaría el total encogido como base de la
    // comparación siguiente, que es lo que hace la pérdida invisible para
    // siempre: las muertes que se van salen del numerador Y del denominador,
    // así que `(K−k)/(T−k)` no baja y el `break` del módulo no se entera. Sobre
    // la huella commiteada: 55 de 61 módulos toleran perder ≥ 1 muerte y los 22
    // con cero supervivientes las toleran TODAS.
    //
    // El escenario es el del guion, con UN mutante menos de los que la huella
    // midió para ese mismo blob. La otra mitad —que la huella NO se escriba— va
    // en el observable, porque un fail-loud que lanza después de escribir no
    // arregla nada.
    mira: () => {
      siembraInforme();
      const informe = JSON.parse(readFileSync(join(INFORMES, `${E.id}.json`), "utf8"));
      informe.files[E.fichero].mutants.pop();
      writeFileSync(join(INFORMES, `${E.id}.json`), JSON.stringify(informe));
      manifiesta({ run: "999920" });
      const antes = createHash("sha256").update(readFileSync(HUELLA)).digest("hex");
      const r = mutacion(["repartir"]);
      const despues = createHash("sha256").update(readFileSync(HUELLA)).digest("hex");
      return `paro:${!r.ok && /MENOS mutantes con veredicto/.test(r.salida)} huella:${antes === despues ? "intacta" : "ESCRITA"}`;
    },
    bien: (s) => s === "paro:true huella:intacta",
    porque:
      "un fichero con el mismo blob y menos mutantes medidos es el instrumento midiendo MENOS, y ningún `break` " +
      "puede cazarlo porque la muerte perdida sale de los dos lados del cociente (#596, y el caso real fueron " +
      "las 26 de #597 con el módulo en 51/58 = 87,9 % contra un suelo de 87)",
    rompe: [
      REPARTO,
      `  if (perdida.length > 0 && !argv.includes("--instrumento-nuevo")) {`,
      `  if (false && perdida.length > 0 && !argv.includes("--instrumento-nuevo")) {`,
    ],
  },
  {
    nombre: "repartir · y el guardia se puede LEVANTAR a mano, con bandera explícita",
    // La otra dirección, y hace falta: un guardia sin salida bloquearía para
    // siempre un cambio de instrumento legítimo, y entonces la salida sería
    // quitarlo. Con la bandera, aceptar la pérdida es un acto explícito que
    // queda escrito en la línea de órdenes de quien reparte.
    mira: () => {
      siembraInforme();
      const informe = JSON.parse(readFileSync(join(INFORMES, `${E.id}.json`), "utf8"));
      informe.files[E.fichero].mutants.pop();
      writeFileSync(join(INFORMES, `${E.id}.json`), JSON.stringify(informe));
      manifiesta({ run: "999921" });
      const r = mutacion(["repartir", "--instrumento-nuevo"]);
      return `pasa:${r.ok} huella:${/Huella actualizada/.test(r.salida)}`;
    },
    bien: (s) => s === "pasa:true huella:true",
    porque:
      "sin salida declarada, el primer cambio de instrumento legítimo obligaría a borrar el guardia entero — " +
      "y el guardia borrado no se vuelve a poner",
    rompe: [
      REPARTO,
      `  if (perdida.length > 0 && !argv.includes("--instrumento-nuevo")) {`,
      `  if (perdida.length > 0) {`,
    ],
  },
  {
    nombre: "comparar · el verbo EN SECO no escribe: ni la huella, ni el tag, ni el árbol",
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999913" });
      const antes = fotoDelArbol();
      const r = mutacion(["comparar"]);
      const despues = fotoDelArbol();
      return `arbol:${antes === despues ? "intacto" : "TOCADO"} veredicto:${/VEREDICTO DE ADOPCIÓN/.test(r.salida)}`;
    },
    bien: (s) => s === "arbol:intacto veredicto:true",
    porque:
      "sin una comparación que no escriba, medir con el instrumento nuevo DESTRUYE la base contra la que había " +
      "que compararlo (`repartir` acaba en escribeHuella y CI le mueve el tag detrás): la regla dura de #443 " +
      "—«si un solo score se mueve fichero a fichero, no se adopta»— sería inaplicable por construcción",
    // `HUELLA_VACIA` la importa `mutacion-repo.ts`, no `mutacion-reparto.ts`, y no
    // se añade un import para que compile un probe: `ctx.base` es la huella de la
    // revisión base y vaciarle `ficheros` da el mismo fichero escrito y la misma
    // señal (la huella committeada deja de casar y `git status` la ve).
    rompe: [
      REPARTO,
      `  const veredicto = veredictoDeCorrida(ctx.corrida, ctx.medida);`,
      `  escribeHuella({ ...ctx.base, ficheros: {} });\n  const veredicto = veredictoDeCorrida(ctx.corrida, ctx.medida);`,
    ],
  },
  {
    nombre: "comparar · tampoco escribe en reports/, que es donde vive la base y git no lo mira",
    // H6(b) de QA, hecho probe. `reports/` está en `.gitignore`: una escritura
    // ahí no sale en `git status`, no mueve la huella y no mueve el tag, así que
    // las tres señales de la foto anterior decían «árbol intacto» mientras el
    // verbo dejaba un fichero dentro del directorio que contiene
    // `reports/mutation-base/` — la base cuya destrucción es el motivo entero de
    // que exista este verbo. Lo que lo caza es el inventario de `reports/`.
    mira: () => {
      siembraInforme();
      manifiesta({ run: "999914" });
      const antes = fotoDelArbol();
      mutacion(["comparar"]);
      const despues = fotoDelArbol();
      return `arbol:${antes === despues ? "intacto" : "TOCADO"} colado:${existsSync(COLADO)}`;
    },
    bien: (s) => s === "arbol:intacto colado:false",
    porque:
      "una escritura a una ruta gitignorada no la ve `git status`, y `nefan-core/reports/` es justo donde está " +
      "la base de la comparación: sin el inventario, el candado daba VERDE sobre un verbo que escribía",
    // La escritura se cuela con `git config --file`, y no con `writeFileSync`,
    // porque `mutacion-reparto.ts` no importa nada de `node:fs` que escriba y un
    // import puesto para que compile un probe sería un símbolo que no usa nadie.
    // `git` sí lo importa —el contexto de la corrida llama a git— y deja un
    // fichero en `nefan-core/reports/colado`, que es el observable: la ruta
    // gitignorada donde vive la base de la comparación.
    rompe: [
      REPARTO,
      `  const base: Record<string, BaseDeFichero> = {};`,
      `  git(["config", "--file", resolve(coreRoot, "reports", "colado"), "qa.colado", "1"]);\n` +
        `  const base: Record<string, BaseDeFichero> = {};`,
    ],
  },

  {
    // #599 · LO QUE PRUEBA ESTE PROBE, dicho con precisión: que el verbo MIRA
    // EL DATO y no el viento. Se corre DOS VECES sobre EXACTAMENTE el mismo
    // material —el mismo informe de ahora, con su único mutante `NoCoverage`, y
    // la misma base con ese mutante como `Survived`— y lo único que cambia
    // entre las dos es el `coverageAnalysis` que declara el informe base.
    //
    // Con `command` + `off` la base NO PODÍA emitir `NoCoverage` jamás, así que
    // su cero no es una medida: el mutante sale como CENSO y la séptima
    // condición no se pronuncia. Con `perTest` sí podía, así que su cero SÍ es
    // una medida y la condición tumba la adopción, igual que antes de #599.
    //
    // Y LA TERCERA LECTURA ES LA QUE PRUEBA QUE MIRA EL PAR (QA de #597, H-1):
    // el MISMO `off`, cambiando solo el runner a `tap`, tiene que salir CAPAZ —
    // `tap-runner.dryRun()` no lee `options.coverageAnalysis` y devuelve
    // `mutantCoverage` siempre, medido el 2026-09-15. Si la capacidad se
    // decidiera por el ajuste, esa base se contaría como incapaz y la séptima
    // se abstendría sobre un informe que SÍ midió.
    //
    // Si las lecturas salen iguales, el verbo está contestando sin mirar — que
    // es el defecto que #599 cerró (la condición solo podía salir en una
    // dirección) o el defecto opuesto (abstenerse siempre), y los dos se ven
    // aquí como «el observable no cambia».
    nombre: "comparar · la séptima condición sabe SI PUDO MIRAR, y lo decide el PAR (#599, #597 H-1)",
    mira: () => {
      // El mutante va como `NoCoverage` en la corrida de AHORA y como
      // `Survived` en la base: es el movimiento exacto de #443 en miniatura.
      siembraInforme();
      soloInforme("x", "NoCoverage", "perTest");
      manifiesta({ run: "999915" });
      rmSync(BASE_ENSAYO, { recursive: true, force: true });
      mkdirSync(BASE_ENSAYO, { recursive: true });
      const lee = (runner, cobertura) => {
        writeFileSync(join(BASE_ENSAYO, `${E.id}.json`), informeDe("x", "Survived", cobertura, E.fichero, runner));
        const s = mutacion(["comparar", "--timeouts", "reports/base-ensayo"]).salida;
        const n = /sin ejercer\s+: (\d+) mutante/.exec(s)?.[1] ?? "?";
        const c = /· censo\s+: (\d+) mutante/.exec(s)?.[1] ?? "?";
        // El motivo 7a, no el título del bloque (que lleva las mismas palabras
        // y estaría siempre): lo que se busca es la frase del `porque`.
        const siete = /mutante\(s\) que ya NO EJERCE NINGÚN TEST/.test(s);
        return `${runner}+${cobertura}[sinEjercer:${n} censo:${c} 7a:${siete}]`;
      };
      return `${lee("command", "off")} ${lee("tap", "off")} ${lee("tap", "perTest")}`;
    },
    bien: (s) =>
      s ===
      "command+off[sinEjercer:0 censo:1 7a:false] tap+off[sinEjercer:1 censo:0 7a:true] " +
        "tap+perTest[sinEjercer:1 censo:0 7a:true]",
    porque:
      "con la base en `command` + `coverageAnalysis: \"off\"` Stryker NO EMITE `NoCoverage` jamás, así que " +
      "«antes se ejercían: 1122» no era una medida sino lo único que la base podía decir: la séptima " +
      "condición se disparaba POR CONSTRUCCIÓN contra cualquier runner que activara la cobertura — que son " +
      "exactamente los runners por los que uno cambiaría. Y el mismo `off` con `tap` SÍ es una medida: " +
      "decidirlo por el ajuste sería abstenerse sobre un informe que midió",
    rompe: [
      COMPARAR,
      `        if (!cap.sabe) capacidad = cap;\n        else if (base !== undefined) capacidad = { sabe: true, huellas: base.sinEjercer };`,
      `        void cap;\n        if (base !== undefined) capacidad = { sabe: true, huellas: base.sinEjercer };`,
    ],
  },

  {
    // QA de #597, H-1, por su propia puerta: la capacidad decidida con MEDIO
    // dato. Este probe rompe `capacidadDeLaBase` para que mire solo el ajuste
    // —que es como estaba escrito hasta hoy— y exige que el observable cambie.
    // Sin esto, «se mira el par» sería una frase: el probe de arriba también
    // pasaría con una implementación que mirase solo el runner.
    nombre: "comparar · la capacidad NO se puede decidir con medio dato (#597 H-1)",
    mira: () => {
      siembraInforme();
      soloInforme("x", "NoCoverage", "perTest");
      manifiesta({ run: "999917" });
      rmSync(BASE_ENSAYO, { recursive: true, force: true });
      mkdirSync(BASE_ENSAYO, { recursive: true });
      // Una base medida con `tap` + `off`: el runner reporta cobertura aunque
      // el ajuste esté apagado, así que su `Survived` SÍ es una medida.
      writeFileSync(join(BASE_ENSAYO, `${E.id}.json`), informeDe("x", "Survived", "off", E.fichero, "tap"));
      const s = mutacion(["comparar", "--timeouts", "reports/base-ensayo"]).salida;
      const censo = /· censo\s+: (\d+) mutante/.exec(s)?.[1] ?? "?";
      const mira = /qué se mira: base: ([^·]+)·/.exec(s)?.[1]?.trim() ?? "?";
      return `${mira} censo:${censo}`;
    },
    bien: (s) => s === "tap+off censo:0",
    porque:
      "una base de `tap` + `off` SÍ emite `NoCoverage` (medido el 2026-09-15), así que contarla como " +
      "incapaz es un «no se pudo mirar» sobre algo que se miró — el defecto de #599 un escalón más arriba",
    rompe: [
      HUELLA_TS,
      `  return instrumento.cobertura === "off" && instrumento.runner === "command"`,
      `  return instrumento.cobertura === "off"`,
    ],
  },

  {
    // #599 H-3 (QA). Si el informe base del módulo EXISTE y midió con `off`,
    // ese informe no podría haber contestado ni con el fichero dentro: la
    // casilla es CENSO. Cuando caía en «sin informe base», el motivo se
    // contradecía con su propia cabecera —que dos líneas más arriba dice
    // `base: off`— y prescribía `--timeouts`, el flag que quien lee acaba de
    // usar: un remedio sin salida.
    nombre: "comparar · un fichero fuera de un informe base `off` es CENSO, no «sin informe base» (#599 H-3)",
    mira: () => {
      siembraInforme();
      soloInforme("x", "NoCoverage", "perTest");
      manifiesta({ run: "999916" });
      rmSync(BASE_ENSAYO, { recursive: true, force: true });
      mkdirSync(BASE_ENSAYO, { recursive: true });
      // La base EXISTE, midió con `off`, y NO contiene el fichero que se compara.
      writeFileSync(
        join(BASE_ENSAYO, `${E.id}.json`),
        informeDe("x", "Survived", "off", "src/UN-FICHERO-QUE-NO-SE-COMPARA.ts", "command"),
      );
      const s = mutacion(["comparar", "--timeouts", "reports/base-ensayo"]).salida;
      const c = /· censo\s+: (\d+) mutante/.exec(s)?.[1] ?? "?";
      const sm = /· sin mirar\s+: (\d+) mutante/.exec(s)?.[1] ?? "?";
      return `censo:${c} sinMirar:${sm} remedioSinSalida:${/NO SE PUDO MIRAR \(/.test(s)}`;
    },
    bien: (s) => s === "censo:1 sinMirar:0 remedioSinSalida:false",
    porque:
      "con la base en `off` ese informe no podría haber contestado ni con el fichero dentro: mandar a " +
      "`--timeouts` a quien acaba de pasarlo es un remedio sin salida, y el bloque se contradice con su " +
      "propia cabecera `base: off`",
    rompe: [
      COMPARAR,
      `        if (!cap.sabe) capacidad = cap;\n        else if (base !== undefined) capacidad = { sabe: true, huellas: base.sinEjercer };`,
      `        if (base !== undefined) capacidad = cap.sabe ? { sabe: true, huellas: base.sinEjercer } : cap;`,
    ],
  },

  // ── PR-E · la corrida partida en lotes ─────────────────────────────────────
  {
    nombre: "lotes · el PLAN lleva TODO lo pedido, también lo que no se pudo empaquetar por reloj",
    mira: () => {
      // `apuntado` se DESCRONOMETRA aquí a propósito: el probe necesita un
      // módulo sin reloj (va a lote propio, `medido: false`) para que la rotura
      // de abajo lo tire de `modulos_pedidos`. El 04-09 lo estaba de suyo;
      // #440/#445 cronometraron los 41 y este probe pasó a «romperlo no cambia
      // el observable» sin que nadie lo viera (medido el 05-09). La huella la
      // devuelve `restauraFuentes()` después de cada `mira`.
      const huella = JSON.parse(readFileSync(HUELLA, "utf8"));
      const apuntado = JSON.parse(readFileSync(PLAN, "utf8")).modulos.find((m) => m.id === "apuntado");
      if (!apuntado) throw new Error("el plan ya no tiene el módulo `apuntado`: elige otro para el probe");
      for (const f of apuntado.mutate) delete huella.ficheros[f]?.segundos;
      writeFileSync(HUELLA, `${JSON.stringify(huella, null, 2)}\n`);
      rmSync(join(CORE, "reports", "plan-corrida.json"), { force: true });
      const r = mutacion([
        "lotes", "--ids", `${E.id} apuntado`, "--origen", "explicito",
        "--sha", E.tag, "--desde", E.anterior, "--run", "999910",
      ]);
      if (!r.ok) throw new Error(`lotes no escribió el plan:\n${r.salida}`);
      const p = JSON.parse(readFileSync(join(CORE, "reports", "plan-corrida.json"), "utf8"));
      return `${p.modulos_pedidos.join(",")} | lotes=${p.lotes.length}`;
    },
    // `apuntado` va sin reloj (sembrado arriba), así que va a lote propio; lo
    // que NO puede pasar es que se caiga de `modulos_pedidos`, porque de ahí
    // sale el veredicto de la fusión.
    bien: (s) => s.startsWith(["apuntado", E.id].sort().join(",")),
    porque: "de `modulos_pedidos` del plan sale el veredicto: un módulo que se caiga de ahí es una medida que nadie echa de menos",
    rompe: [
      LOTES_TS,
      `    modulos_pedidos: [...ids].sort(),`,
      `    modulos_pedidos: paquetes.filter((l) => l.medido).flatMap((l) => l.modulos).sort(),`,
    ],
  },
  {
    nombre: "fusión · sin el plan NO se fabrica una corrida con lo que llegó",
    mira: () => {
      const dir = join(CORE, "reports", "lotes-ensayo");
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, "informe-mutacion-1"), { recursive: true });
      return mutacion(["fusionar", "--entrada", "reports/lotes-ensayo"]).salida;
    },
    bien: (s) => /no está el plan de la corrida/.test(s) && /COMPLETA y el tag se movería mintiendo/.test(s),
    porque: "reconstruir lo pedido desde los lotes que llegaron hace que un lote muerto salga COMPLETA: el tag mentiría",
    rompe: [
      LOTES_TS,
      `  if (!existsSync(rutaPlan)) {`,
      `  if (false as boolean) {`,
    ],
  },
  {
    // H2 de QA-E. El commit de PR-E dice que «el sello es lo que hace segura la
    // fusión: `reunir` verifica cada informe contra el sha256 de SU parcial
    // antes de mezclarlo». Esa frase no la defendía nadie: el candado del sello
    // ejerce `repartir` y rompe `selloDeInforme`, no la llamada de dentro de
    // `fusionar`. Sin ella, un informe suplantado entra en la fusión, sale en
    // el artefacto único con SU sello dentro del manifiesto que la propia
    // fusión acaba de fabricar, y de ahí a la huella commiteada: #420 reabierto
    // por la puerta nueva.
    nombre: "fusión · el sello de cada lote se comprueba ANTES de mezclar (#420 por la puerta nueva)",
    mira: () => {
      const dir = join(CORE, "reports", "lotes-ensayo");
      rmSync(dir, { recursive: true, force: true });
      // Un lote completo y honesto: el manifiesto lo escribe la herramienta.
      siembraInforme();
      manifiesta({ run: "999912", pedidos: E.id });
      mkdirSync(join(dir, "plan-corrida"), { recursive: true });
      const r = mutacion([
        "lotes", "--ids", E.id, "--origen", "rango",
        "--sha", E.tag, "--desde", E.anterior, "--run", "999912",
      ]);
      if (!r.ok) throw new Error(`lotes no escribió el plan:\n${r.salida}`);
      writeFileSync(
        join(dir, "plan-corrida", "plan-corrida.json"),
        readFileSync(join(CORE, "reports", "plan-corrida.json"), "utf8"),
      );
      mkdirSync(join(dir, "informe-mutacion-1"), { recursive: true });
      writeFileSync(join(dir, "informe-mutacion-1", "corrida.json"), readFileSync(CORRIDA, "utf8"));
      // …y el informe se SUSTITUYE después de sellado, que es lo que deja un
      // `local` corrido encima del artefacto del job.
      soloInforme("suplantado");
      writeFileSync(
        join(dir, "informe-mutacion-1", `${E.id}.json`),
        readFileSync(join(INFORMES, `${E.id}.json`), "utf8"),
      );
      return mutacion(["fusionar", "--entrada", "reports/lotes-ensayo"]).salida;
    },
    bien: (s) => /NO son los que midió la corrida 999912/.test(s) && /no casa con su propio manifiesto/.test(s),
    porque: "sin ese guardia, un informe suplantado entra en el artefacto único y de ahí a la huella commiteada",
    rompe: [LOTES_TS, `    const errores = verificaDescarga(parcial, presentes);`, `    const errores: string[] = [];`],
  },
  {
    nombre: "reloj · `mutate.ts` guarda los segundos de cada módulo, y no al final",
    // El cronómetro existía y moría con el log: sacar los de dos corridas costó
    // leer dos logs de 21.000 líneas a mano. Y se escribe DESPUÉS DE CADA
    // MÓDULO porque la corrida que motivó los lotes murió en el timeout con 25
    // medidos — guardarlo al final habría perdido los 25.
    mira: () => readFileSync(MUTATE, "utf8"),
    bien: (s) => /anotaTiempo\(r\.id, Math\.round\(r\.segundos\)\);/.test(s) && /rmSync\(RUTA_TIEMPOS, \{ force: true \}\);/.test(s),
    porque: "sin el cronómetro en el manifiesto, la corrida siguiente no sabe cuánto tarda nada y TODO vuelve a lote propio",
    rompe: [
      MUTATE,
      `    anotaTiempo(r.id, Math.round(r.segundos));\n`,
      ``,
    ],
  },
  {
    nombre: "workflow · la matriz no cancela a los lotes vivos cuando uno se cae",
    // `fail-fast: false` es el equivalente exacto de que `mutate.ts` no corte en
    // el primer módulo bajo su break: sin él, un lote caído se lleva por delante
    // medidas ya hechas.
    mira: () => readFileSync(YML, "utf8"),
    bien: (s) =>
      /fail-fast: false/.test(s) &&
      /max-parallel: \d+/.test(s) &&
      // El plan sube ANTES de medir y en su propio artefacto: es lo único que
      // sobrevive a un lote que muere sin subir nada.
      /name: plan-corrida/.test(s) &&
      s.indexOf("name: plan-corrida") < s.indexOf("Medir el lote"),
    porque: "sin `fail-fast: false` un lote caído cancela a los demás; y sin el plan subido antes, la fusión no sabe qué se pidió",
    rompe: [YML, `      fail-fast: false\n`, ``],
  },
];

// ── el bucle ─────────────────────────────────────────────────────────────────

const filtro = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const casa = (n) => filtro.length === 0 || filtro.some((f) => n.toLowerCase().includes(f.toLowerCase()));

if (existsSync(APARTADO)) {
  console.error(`✖ ya existe ${APARTADO}: una corrida anterior de este guion no terminó de restaurar.`);
  console.error(`  Míralo y devuélvelo a mano a reports/mutation/ antes de volver a correrlo.`);
  process.exit(2);
}

// EL TURNO, antes de la foto (#572). Estos candados rompen fuentes de
// producción a mano y las restauran con una copia hecha al arrancar; dos
// instancias a la vez se fotografían la mutación de la otra y la «restauran»
// como si fuera el original. Pasó el 2026-09-10.
turnoDeCandados();
const fuentes = new Map(
  [INFORMES_TS, LOTES_TS, REPARTO, MUTATE, COMPARAR, HUELLA_TS, YML, HUELLA].map((f) => [f, readFileSync(f, "utf8")]),
);
const restauraFuentes = () => { for (const [f, t] of fuentes) writeFileSync(f, t); };
const habiaInformes = existsSync(INFORMES);
if (habiaInformes) renameSync(INFORMES, APARTADO);

/** La limpieza, UNA para el `finally` y para SIGINT/SIGTERM, idempotente. Sin
 *  manejador, un Ctrl+C dejaba un trozo de `scripts/mutacion-*.ts` MUTADO y `reports/` a
 *  medias sin pasar por ningún `finally` (QA de #454). Se lleva también el
 *  ensayo de los probes (`reports/lotes-ensayo`, `reports/plan-corrida.json`),
 *  que antes quedaba como residuo tras una corrida limpia. */
let limpiado = false;
function limpiar() {
  if (limpiado) return;
  limpiado = true;
  restauraFuentes();
  rmSync(INFORMES, { recursive: true, force: true });
  rmSync(join(CORE, "reports", "lotes-ensayo"), { recursive: true, force: true });
  rmSync(BASE_ENSAYO, { recursive: true, force: true });
  rmSync(join(CORE, "reports", "plan-corrida.json"), { force: true });
  rmSync(COLADO, { recursive: true, force: true });
  if (habiaInformes) renameSync(APARTADO, INFORMES);
}
for (const [señal, codigo] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(señal, () => {
    console.error(`\n⊘ INTERRUMPIDO (${señal}) — restaurando fuentes, huella y reports/ antes de salir`);
    limpiar();
    process.exit(codigo);
  });
}
/** Todo lo de arriba es `spawnSync`: un manejador de señal solo corre cuando el
 *  código síncrono suelta, así que se cede el turno entre invariantes y el
 *  Ctrl+C corta en la SIGUIENTE frontera. */
const cede = () => new Promise((r) => setImmediate(r));

const fallidos = [];
try {
  for (const inv of INVARIANTES) {
    if (!casa(inv.nombre)) continue;

    restauraFuentes();
    const entero = inv.mira();
    restauraFuentes();
    if (!inv.bien(entero)) {
      console.log(`✖ VERDE-FALSO  ${inv.nombre}`);
      console.log(`     con el fuente ENTERO ya no se cumple. El invariante se rompió o el guion apunta a otro sitio.`);
      console.log(`     observado: ${JSON.stringify(entero).slice(0, 240)}`);
      fallidos.push(`${inv.nombre} (no se cumple ni sin romper nada)`);
      continue;
    }

    const [fichero, buscar, poner] = inv.rompe;
    const parche = aplicarPares(fuentes.get(fichero), [[buscar, poner]]);
    if (!parche.ok) {
      console.log(`⚠️  ${inv.nombre}`);
      console.log(`     el patrón aparece ${parche.veces} veces: el código se movió y este candado ya no lo apunta\n`);
      fallidos.push(`${inv.nombre} (patrón obsoleto)`);
      continue;
    }
    writeFileSync(fichero, parche.texto);
    const roto = inv.mira();
    restauraFuentes();

    const seEntera = !inv.bien(roto);
    if (!seEntera) fallidos.push(inv.nombre);
    console.log(`${seEntera ? "🔴 rojo " : "🟢 VERDE"}  ${inv.nombre}`);
    console.log(`     ${seEntera ? inv.porque : "⚠️  ROMPERLO NO CAMBIA EL OBSERVABLE: esto no es un candado"}`);
    await cede();
  }
} finally {
  limpiar();
}

for (const [f, t] of fuentes) {
  if (readFileSync(f, "utf8") !== t) {
    console.error(`\n✖ NO SE RESTAURÓ ${f} — revísalo con git diff antes de seguir`);
    process.exit(2);
  }
}
if (existsSync(APARTADO) || (habiaInformes && !existsSync(INFORMES))) {
  console.error(`\n✖ los informes de ${INFORMES} no volvieron a su sitio (están en ${APARTADO})`);
  process.exit(2);
}

const probados = INVARIANTES.filter((i) => casa(i.nombre)).length;
console.log(`\n${"─".repeat(70)}`);
console.log(`Invariantes del CABLEADO probados en negativo : ${probados}`);
console.log(`Se ven rotos al romperlos                     : ${probados - fallidos.length}`);
console.log(`NO se enteran                                 : ${fallidos.length}`);
for (const f of fallidos) console.log(`   🟢 ${f}`);
console.log(
  fallidos.length === 0
    ? "\n✔ el cableado del ciclo se puede ver roto: no es prosa"
    : "\n✖ hay piezas del ciclo que se pueden deshacer sin que se note",
);
process.exit(fallidos.length === 0 ? 0 : 1);
