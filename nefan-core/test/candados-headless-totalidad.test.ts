/** Totalidad del job `candados-headless` (#645): todo ejecutable de `qa/*.mjs`
 *  lo corre el CI, o cae por el GRAFO, o tiene una exención escrita.
 *
 *  «Un ejecutable headless de `qa/` entra en el job el día que nace, o no lo
 *  corre nadie» llevaba desde T11 escrito en un comentario del yml, en una fila
 *  de CLAUDE.md y en dos tablas de `qa/README.md` — y no fallaba nada si alguien
 *  no lo añadía. Se pagó una vez: los tres ejecutables de geometría de la tanda
 *  E nacieron fuera y se supo al cerrar la tanda. Y la prosa no solo estaba
 *  incompleta, **ya era falsa en tres sitios** el día que se escribió este test:
 *  el yml decía «los TRES que levantan asset-store o sprite-forge» y eran cuatro
 *  (`qa/sprites-sin-servicio.mjs:300` arranca `bin/sprite-forge.mjs serve`), la
 *  tabla «Dentro» del README enumeraba 13 filas para 18 pasos y la tabla «Fuera»
 *  20 de 21. El issue se demostraba a sí mismo tres veces.
 *
 *  Es el tercer ejemplar del molde que la casa ya tiene en `banco-medido.json`
 *  (#357) y en `mutation-targets.json` (`sin_mutar`): lista de exentos en
 *  `data/contract/`, motivo obligatorio, y la exención que caduca sola.
 *
 *  LAS DOS CATEGORÍAS QUE NO SON EXENCIÓN SE DERIVAN DEL GRAFO, NO SE LISTAN.
 *  Un ejecutable no está obligado a entrar en el job si (1) ABRE NAVEGADOR —su
 *  grafo de imports alcanza `playwright-core`, directamente o a través de un
 *  `qa/lib/*.mjs`— o (2) SPAWNEA `qa/run.mjs`, que es levantar el preset y un
 *  Chromium. Derivarlo en vez de enumerarlo tiene dos consecuencias que se
 *  buscan: `qa/run.mjs` no necesita entrada especial por ser el runner (importa
 *  `playwright-core` como cualquier otro), y un guion de navegador nuevo no hay
 *  que acordarse de eximirlo. Lo que queda —hoy nueve— está en
 *  `data/contract/candados-headless.json` con su motivo. De los nueve, DOS
 *  vienen movidos literalmente de la tabla «Fuera» del README y siete están
 *  reescritos desde dos filas genéricas de esa misma tabla: la procedencia
 *  exacta la dice el `_comment` del contrato, porque es él quien pasa a ser la
 *  fuente de verdad.
 *
 *  SE LEE EL ÁRBOL DE SINTAXIS, NO EL TEXTO, por la lección de #454: un
 *  detector de regex cuenta como import lo que está dentro de un string. Aquí
 *  el caso real es `bateria-candados-en-negativo.mjs`, que SPAWNEA el runner en
 *  `:85` y además IMPRIME la cadena `qa/run.mjs` en `:139`; para el AST solo lo
 *  primero es un spawn. Hay un test permanente de esa distinción abajo.
 *
 *  LO QUE ESTE CANDADO **NO** CUBRE, y hay que saberlo antes de fiarse:
 *   (a) un ejecutable que abra navegador por un camino que no sea
 *       `playwright-core` —CDP a pelo, un `spawn` de `chromium`— se clasifica
 *       como headless y se le exige entrar en el job;
 *   (b) que el paso del job EJERZA algo: un ejecutable que salga 0 sin medir
 *       nada pasa por aquí igual que el que mide;
 *   (c) los `qa/guiones/*.mjs`, que no son ejecutables sueltos sino carga del
 *       runner. Por eso el 39 —que no abre navegador: solo lee ficheros— sigue
 *       fuera del censo, y es justo el que pasó dos días rojo sin que nadie lo
 *       corriera;
 *   (d) que las dependencias de un ejecutable estén instaladas en el runner.
 *       Este test es ESTÁTICO y no ejecuta nada, así que no puede confundir un
 *       `⊘ sin medir` (salida 2) con un rojo. Si un paso del job sale 2, eso es
 *       «no pude medir»: se instala la dependencia, no se baja nada;
 *   (e) que el `spawn` de `qa/run.mjs` que exime a un fichero esté VIVO: un
 *       spawn en una rama muerta, o detrás de un flag que nadie pasa, exime
 *       igual. Es el precio de leer el árbol y no ejecutarlo, y la mitad que sí
 *       se cubrió es la contraria (un `qa/run.mjs` dentro de un string no
 *       exime). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, posix, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const QA = join(repoRoot, "qa");
const QA_LIB = join(QA, "lib");
const YML = join(repoRoot, ".github", "workflows", "ci.yml");
const CONTRATO = join(core, "data", "contract", "candados-headless.json");

const CandadosHeadlessSchema = z
  .object({
    _comment: z.string().min(1),
    exentos: z
      .array(
        z
          .object({
            /** Ruta relativa a la raíz del repo, como la escribe `git`. */
            fichero: z
              .string()
              .regex(/^qa\/[\w.-]+\.mjs$/, "una exención nombra un `qa/*.mjs` de la raíz de qa/"),
            /** Obligatorio: una exención sin motivo es una regla que ya no sirve. */
            porque: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type CandadosHeadless = z.infer<typeof CandadosHeadlessSchema>;

/** Los especificadores que un fichero IMPORTA de verdad, leídos del AST:
 *  `import … from`, `import(…)` y `require(…)` con literal. Un tipo JSDoc
 *  (`@param {import("playwright-core").BrowserType}`) no es un import: es un
 *  comentario, y hoy `qa/lib/navegador.mjs` es exactamente ese caso. */
export function especificadoresDeImport(texto: string): string[] {
  const vistos: string[] = [];
  const visita = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      vistos.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n)) {
      const esImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const esRequire = ts.isIdentifier(n.expression) && n.expression.text === "require";
      const arg = n.arguments[0];
      if ((esImport || esRequire) && arg && ts.isStringLiteralLike(arg)) vistos.push(arg.text);
    }
    ts.forEachChild(n, visita);
  };
  visita(ts.createSourceFile("x.mjs", texto, ts.ScriptTarget.Latest, true));
  return vistos;
}

/** LOS QUE ALCANZAN EL NAVEGADOR, por el grafo de imports y a cualquier
 *  profundidad. Las claves son rutas relativas a `qa/` (`run.mjs`,
 *  `lib/navegador.mjs`), y cada especificador se resuelve contra el directorio
 *  de quien lo escribe: así el cierre cruza las dos carpetas.
 *
 *  Recorrer SOLO `qa/lib` era un agujero, y lo cazó la QA de esta PR: un
 *  `qa/x.mjs` que importara a un hermano de navegador quedaba clasificado como
 *  headless, se le exigía entrar en el job, y el aserto «ningún paso abre
 *  navegador» lo aprobaba. Hoy entra por el mismo cierre que los demás.
 *
 *  Que hoy ningún `qa/lib/*.mjs` importe Playwright —`navegador.mjs` recibe
 *  `chromium` como parámetro y solo lo nombra en un tipo JSDoc— no hace inútil
 *  el cierre: lo hace vacío por ese lado. El día que alguien lo importe, sus
 *  clientes entran solos sin tocar este test. */
export function losQueAlcanzanElNavegador(ficheros: ReadonlyMap<string, string>): Set<string> {
  const alcanzan = new Set<string>();
  const importa = new Map([...ficheros].map(([f, texto]) => [f, especificadoresDeImport(texto)]));
  const resuelto = (desde: string, spec: string): string | null => {
    if (!spec.endsWith(".mjs")) return null;
    const dir = desde.includes("/") ? desde.slice(0, desde.lastIndexOf("/")) : "";
    const destino = spec.startsWith(".")
      ? posix.normalize(posix.join(dir, spec))
      : spec.slice(spec.lastIndexOf("/qa/") + 4);
    return ficheros.has(destino) ? destino : null;
  };
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const [f, specs] of importa) {
      if (alcanzan.has(f)) continue;
      const llega = specs.some((s) => {
        if (/^playwright/.test(s)) return true;
        const d = resuelto(f, s);
        return d !== null && alcanzan.has(d);
      });
      if (llega) {
        alcanzan.add(f);
        cambio = true;
      }
    }
  }
  return alcanzan;
}

const ARRANCA_PROCESO = /^(spawn|spawnSync|execFile|execFileSync|exec|execSync)$/;

/** ¿Este ejecutable lanza `qa/run.mjs` como proceso? O sea: preset levantado y
 *  Chromium, aunque el fichero no importe Playwright. Se mira el NODO de la
 *  llamada y sus literales —también los que van dentro de un `join(…)` o de un
 *  array de argumentos—, nunca el texto suelto: `bateria-candados-en-negativo`
 *  spawnea el runner en `:85` y lo IMPRIME en `:139`. */
export function spawneaElRunner(texto: string): boolean {
  let visto = false;
  const literalesDe = (n: ts.Node, out: string[]): void => {
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    ts.forEachChild(n, (h) => literalesDe(h, out));
  };
  const visita = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const nombre = ts.isIdentifier(n.expression)
        ? n.expression.text
        : ts.isPropertyAccessExpression(n.expression)
          ? n.expression.name.text
          : "";
      if (ARRANCA_PROCESO.test(nombre)) {
        const literales: string[] = [];
        for (const a of n.arguments) literalesDe(a, literales);
        if (literales.some((l) => /(?:^|\/)qa\/run\.mjs$/.test(l))) visto = true;
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(ts.createSourceFile("x.mjs", texto, ts.ScriptTarget.Latest, true));
  return visto;
}

/** El cuerpo del job, tal cual está escrito. Si el job no está, esto LANZA: un
 *  `""` silencioso convertiría «el workflow cambió de forma» en «ningún
 *  ejecutable está cubierto», que es un rojo con el nombre equivocado. */
export function bloqueDelJob(yml: string, job = "candados-headless"): string {
  const bloque = new RegExp(`^ {2}${job}:\\n([\\s\\S]*?)(?=^ {2}\\S|$(?![\\s\\S]))`, "m").exec(yml);
  assert.ok(bloque, `no encuentro el job \`${job}\` en ci.yml: ¿se renombró? este test vive de esa lista`);
  return bloque[1];
}

/** Los `qa/*.mjs` que el job `candados-headless` corre, leídos del yml de
 *  verdad. */
export function pasosDelJob(yml: string, job = "candados-headless"): string[] {
  return [...bloqueDelJob(yml, job).matchAll(/^\s*- run: node (qa\/[\w.-]+\.mjs)/gm)].map((m) => m[1]);
}

/** LO QUE HACE QUE UN PASO NO CORRA, aunque esté escrito. Es la mitad que la
 *  primera versión de este test no cubría y que cazó su QA (H-1): sujetaba que
 *  el ejecutable estuviera NOMBRADO, no que se EJERZA, y salía verde con
 *  `- run: node qa/x.mjs || true`, con el paso en `if: false` y con el job
 *  entero en `if: false`. La frase del issue es «o no lo corre nadie», así que
 *  un paso decorativo cumple la letra y rompe la promesa.
 *
 *  Tres formas, y se miran las tres sobre el TEXTO del bloque: un `if:` (a
 *  nivel de job o de paso) que pueda apagarlo, un `continue-on-error` que se
 *  trague el rojo, y un comando que se trague su propia salida (`|| true`,
 *  `|| :`, `; true`). No hay mecanismo de excepción a propósito: si algún día
 *  hace falta condicionar un paso, se cambia esta regla y se dice por qué. */
export function pasosQueNoCorren(bloque: string): string[] {
  const pegas: string[] = [];
  for (const [i, linea] of bloque.split("\n").entries()) {
    const sinComentario = linea.replace(/^(\s*)#.*$/, "$1");
    if (/^\s*(- )?if:/.test(sinComentario)) {
      pegas.push(
        `línea ${i + 1}: \`${sinComentario.trim()}\` — un paso (o el job) que se puede apagar no lo corre nadie`,
      );
    }
    if (/^\s*(- )?continue-on-error:\s*true/.test(sinComentario)) {
      pegas.push(
        `línea ${i + 1}: \`continue-on-error: true\` — el rojo del candado deja de ser el rojo del job`,
      );
    }
    if (/^\s*- run:.*(\|\|\s*(true|:)|;\s*true\b)/.test(sinComentario)) {
      pegas.push(`línea ${i + 1}: \`${sinComentario.trim()}\` — el comando se traga su propia salida`);
    }
  }
  return pegas;
}

/** Los ejecutables que ni los corre el job, ni caen por el grafo, ni están
 *  eximidos. */
export function huerfanosDe(
  ejecutables: readonly string[],
  enJob: ReadonlySet<string>,
  derivados: ReadonlySet<string>,
  exentos: ReadonlySet<string>,
): string[] {
  return ejecutables.filter((f) => !enJob.has(f) && !derivados.has(f) && !exentos.has(f));
}

const contrato: CandadosHeadless = CandadosHeadlessSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const yml = readFileSync(YML, "utf8");

const ejecutables = readdirSync(QA)
  .filter((f) => f.endsWith(".mjs"))
  .sort();
const textos = new Map(ejecutables.map((f) => [f, readFileSync(join(QA, f), "utf8")]));
// El grafo entero: los ejecutables de la raíz y los módulos de `qa/lib`, con
// las claves que usa el cierre (`x.mjs` y `lib/x.mjs`).
const grafo = new Map([
  ...textos,
  ...readdirSync(QA_LIB)
    .filter((f) => f.endsWith(".mjs"))
    .map((f): [string, string] => [`lib/${f}`, readFileSync(join(QA_LIB, f), "utf8")]),
]);

const alcanzanNavegador = losQueAlcanzanElNavegador(grafo);
const navegador = new Set(ejecutables.filter((f) => alcanzanNavegador.has(f)));
const spawnean = new Set(ejecutables.filter((f) => spawneaElRunner(textos.get(f) ?? "")));
const derivados = new Set([...navegador, ...spawnean]);
const enJob = new Set(pasosDelJob(yml).map((f) => f.slice("qa/".length)));
const exentos = new Set(contrato.exentos.map((e) => e.fichero.slice("qa/".length)));

describe("candados-headless: la totalidad del job (#645)", () => {
  it("el árbol tiene sujeto: hay ejecutables, pasos en el job, exentos y alguno de navegador", () => {
    // Sin esto, un `qa/` vacío, un yml que dejó de parsearse o un detector roto
    // aprobarían sin mirar nada: el peor de los verdes, y el que la tanda G vio
    // dos veces.
    assert.ok(ejecutables.length > 10, `solo veo ${ejecutables.length} ejecutables en ${QA}`);
    assert.ok(
      enJob.size > 5,
      `solo leo ${enJob.size} paso(s) del job en ci.yml — ¿cambió la forma del workflow?`,
    );
    assert.ok(
      navegador.size > 0,
      "el detector no ve NI UN ejecutable de navegador: está roto o Playwright se fue",
    );
    assert.ok(spawnean.size > 0, "el detector no ve NI UN spawn de qa/run.mjs: está roto");
    assert.ok(
      exentos.size > 0,
      "el contrato no tiene exentos: si de verdad no quedan, borra el fichero y este test",
    );
  });

  it("cada ejecutable de qa/ lo corre el job, o abre navegador, o spawnea el runner, o está eximido", () => {
    const huerfanos = huerfanosDe(ejecutables, enJob, derivados, exentos);
    assert.deepEqual(
      huerfanos,
      [],
      `ejecutables de qa/ que no corre nadie: ${huerfanos.join(", ")}. O entran en el job ` +
        `\`candados-headless\` de .github/workflows/ci.yml con un paso \`- run: node qa/<f>\` (y su tiempo ` +
        `medido en el comentario), o entran en data/contract/candados-headless.json con su motivo.`,
    );
  });

  it("el verde depende del yml REAL: quitar un paso deja huérfano a ese ejecutable y solo a ese", () => {
    // El negativo permanente, que es lo que distingue este test de una lista
    // que se copia a sí misma. Si el criterio dejara de leer el job, esto
    // seguiría diciendo «ninguno huérfano» y el test de arriba sería un adorno.
    const testigo = "el-viaje-no-mete-a-nadie-dentro.mjs";
    assert.ok(enJob.has(testigo), `${testigo} ya no está en el job: elige otro paso real como testigo`);
    const sinTestigo = new Set([...enJob].filter((f) => f !== testigo));
    assert.deepEqual(huerfanosDe(ejecutables, sinTestigo, derivados, exentos), [testigo]);
  });

  it("todo paso del job nombra un fichero que existe", () => {
    const fantasmas = pasosDelJob(yml).filter((f) => !existsSync(join(repoRoot, f)));
    assert.deepEqual(
      fantasmas,
      [],
      "el job corre ficheros que no están: el paso se quedó tras renombrar o borrar",
    );
  });

  it("y los CORRE de verdad: ni `if:`, ni `continue-on-error`, ni un comando que se trague su salida", () => {
    // Su QA (H-1) midió que sin esto el test salía `pass 15 · fail 0` con
    // `- run: node qa/x.mjs || true`, con el paso en `if: false` y con el JOB
    // entero en `if: false`. Estar nombrado no es correr.
    const pegas = pasosQueNoCorren(bloqueDelJob(yml));
    assert.deepEqual(
      pegas,
      [],
      `el job \`candados-headless\` tiene pasos que pueden no correr:\n      ${pegas.join("\n      ")}`,
    );
  });

  it("ningún paso del job abre navegador: el job se llama headless porque lo es", () => {
    const conNavegador = [...enJob].filter((f) => navegador.has(f));
    assert.deepEqual(
      conNavegador,
      [],
      `${conNavegador.join(", ")} alcanza playwright-core y está en el job: en el runner no hay Chromium del bench`,
    );
  });

  it("ninguna exención está caducada: un exento que ya corre el job se borra del JSON", () => {
    const caducadas = [...exentos].filter((f) => enJob.has(f));
    assert.deepEqual(
      caducadas,
      [],
      caducadas.map((f) => `${f} está exento Y en el job: quita la exención`).join("\n"),
    );
  });

  it("ninguna exención es inútil: la que ya cae por el grafo sobra", () => {
    // Una exención que no decide nada envejece sin que nadie la mire, y el día
    // que el fichero deje de abrir navegador aprueba sola.
    const sobran = [...exentos].filter((f) => derivados.has(f));
    assert.deepEqual(
      sobran,
      [],
      sobran
        .map((f) => `${f} ya está cubierto por el grafo (navegador o spawn del runner): la exención sobra`)
        .join("\n"),
    );
  });

  it("ninguna exención apunta a un fichero que ya no existe", () => {
    const muertas = contrato.exentos.filter((e) => !existsSync(join(repoRoot, e.fichero)));
    assert.deepEqual(
      muertas.map((e) => e.fichero),
      [],
      "una exención a un fichero borrado revive sola el día que alguien vuelva a crear esa ruta",
    );
  });

  it("una exención no puede ser un encogimiento de hombros", () => {
    // Mismo umbral que `banco-medido.json` y que `sin_mutar`: ocho palabras no
    // garantizan un motivo, pero sí impiden el «TODO» y el «difícil».
    for (const e of contrato.exentos) {
      assert.ok(
        e.porque.split(/\s+/).length >= 8,
        `candados-headless.json["${e.fichero}"]: "${e.porque}" no explica nada — di por qué NO lo corre el CI`,
      );
    }
  });
});

describe("los detectores del censo headless", () => {
  it("cuenta el spawn del runner con literal suelto y dentro de un join", () => {
    assert.equal(spawneaElRunner('spawn("node", ["qa/run.mjs", ...GUIONES], { cwd });'), true);
    assert.equal(
      spawneaElRunner('const r = spawnSync("node", [join(raiz, "qa/run.mjs"), guion], { cwd });'),
      true,
    );
    assert.equal(spawneaElRunner('execFileSync("node", [resolve(raiz, "qa/run.mjs")]);'), true);
  });

  it("NO cuenta el `qa/run.mjs` de un string: imprimirlo no es lanzarlo", () => {
    // El caso REAL de `bateria-candados-en-negativo.mjs`, que hace las dos
    // cosas: spawnea en :85 e imprime en :139. Con un detector textual, un
    // guion que solo NOMBRE al runner en una traza quedaría eximido gratis.
    const texto = [
      "console.log(`  ${r.codigo === 0 ? 'verde' : 'rojo'}  qa/run.mjs ${g}`);",
      'const ayuda = "node qa/run.mjs --keep";',
      "// se lanza con qa/run.mjs, pero no aquí",
      'spawnSync("node", ["qa/otra-cosa.mjs"], { cwd });',
    ].join("\n");
    assert.equal(spawneaElRunner(texto), false);
  });

  it("ve el navegador por import directo, y NO por un tipo JSDoc", () => {
    // `qa/lib/navegador.mjs` solo nombra `playwright-core` en un
    // `@param {import("playwright-core").BrowserType}`: recibe el `chromium` de
    // quien lo llama. Si eso contara, el módulo arrastraría a sus nueve
    // importadores y el censo de exentos saldría corto sin que nadie lo viera.
    const uno = (texto: string) => losQueAlcanzanElNavegador(new Map([["x.mjs", texto]])).has("x.mjs");
    assert.equal(uno('import { chromium } from "playwright-core";'), true);
    assert.equal(uno('/** @param {import("playwright-core").BrowserType} c */'), false);
    assert.equal(uno('const s = "playwright-core";'), false);
  });

  it("el cierre arrastra por las DOS carpetas: por qa/lib y entre ejecutables de la raíz", () => {
    // Dos mitades. La de `qa/lib` hoy no selecciona a nadie y aquí se demuestra
    // que PUEDE, que es la diferencia entre una cláusula vacía y una muerta. La
    // de la raíz la pidió la QA de esta PR: un ejecutable que importa a un
    // hermano de navegador no es headless, y antes se le exigía entrar en el
    // job.
    const arbol = new Map([
      ["lib/navegador.mjs", 'import { chromium } from "playwright-core";'],
      ["lib/carga.mjs", 'import { abrirNavegador } from "./navegador.mjs";'],
      ["lib/puertos.mjs", 'import { createConnection } from "node:net";'],
      ["cliente.mjs", 'import { conCarga } from "./lib/carga.mjs";'],
      ["headless.mjs", 'import { puertoOcupado } from "./lib/puertos.mjs";'],
      ["capturas.mjs", 'import { chromium } from "playwright-core";'],
      ["vecino.mjs", 'import { saca } from "./capturas.mjs";'],
      ["lejano.mjs", 'import { algo } from "./vecino.mjs";'],
    ]);
    assert.deepEqual([...losQueAlcanzanElNavegador(arbol)].sort(), [
      "capturas.mjs",
      "cliente.mjs",
      "lejano.mjs",
      "lib/carga.mjs",
      "lib/navegador.mjs",
      "vecino.mjs",
    ]);
  });

  it("los pasos se leen del job nombrado y se paran en el siguiente", () => {
    const ymlFalso = [
      "jobs:",
      "  otro:",
      "    steps:",
      "      - run: node qa/no-es-de-este-job.mjs",
      "  candados-headless:",
      "    steps:",
      "      # - run: node qa/comentado.mjs",
      "      - run: node qa/uno.mjs",
      "      - run: node qa/dos.mjs --solo-vigentes",
      "  y-otro-mas:",
      "    steps:",
      "      - run: node qa/tampoco.mjs",
    ].join("\n");
    assert.deepEqual(pasosDelJob(ymlFalso), ["qa/uno.mjs", "qa/dos.mjs"]);
  });

  it("ve las tres formas de que un paso escrito no corra, y no se inventa una cuarta", () => {
    // Los tres casos EXACTOS que QA sabotéo a mano sobre el yml real, y el
    // control: un job sano no tiene ni una pega. El `if:` de un comentario no
    // cuenta, que es la misma distinción texto/código de siempre.
    const sano = "    steps:\n      - run: node qa/uno.mjs\n      # sin if: aquí, esto es prosa\n";
    assert.deepEqual(pasosQueNoCorren(sano), []);
    assert.equal(pasosQueNoCorren(sano + "      - run: node qa/dos.mjs || true\n").length, 1);
    assert.equal(pasosQueNoCorren("    if: false\n" + sano).length, 1, "el job entero apagado");
    assert.equal(
      pasosQueNoCorren(sano + "      - run: node qa/dos.mjs\n        if: false\n").length,
      1,
      "el paso apagado",
    );
    assert.equal(
      pasosQueNoCorren(sano + "      - run: node qa/dos.mjs\n        continue-on-error: true\n").length,
      1,
    );
  });

  it("si el job desaparece del yml, esto LANZA en vez de decir que no falta nadie", () => {
    assert.throws(
      () => pasosDelJob("jobs:\n  otro:\n    steps:\n      - run: echo\n"),
      /no encuentro el job/,
    );
  });
});
