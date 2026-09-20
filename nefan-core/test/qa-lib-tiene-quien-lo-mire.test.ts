/** Totalidad del banco de pruebas (#357, T11): todo módulo de `qa/lib` tiene
 *  quien lo mire, o una exención escrita.
 *
 *  `qa/` es el instrumento con el que se aceptan las tandas, y hasta T11 no lo
 *  medía nadie más que su autor. La decisión (2026-09-05) tiene tres partes y
 *  esta es la segunda: (1) la dirección de dependencia es test → banco —lo
 *  candan `el-banco-no-entra-en-produccion` y su hermana `…-ni-por-join` en
 *  arch-rules.json—; (2) cada `qa/lib/*.mjs` está IMPORTADO por algún
 *  `test/*.test.ts` o está en `data/contract/banco-medido.json` con su motivo;
 *  (3) el CI corre los candados headless de `qa/` (job `candados-headless`).
 *
 *  Es el mismo patrón que `sin_mutar` en `mutation-targets.json`: sin
 *  totalidad, un módulo nuevo del banco nace sin dueño y nadie lo echa de
 *  menos. Y como allí, la exención caduca sola: un exento que pase a estar
 *  importado es una entrada que miente, y se borra.
 *
 *  EL DETECTOR LEE EL ÁRBOL DE SINTAXIS, NO EL TEXTO. La primera versión era
 *  un puñado de regex sobre el fuente, y QA (#454, H1) demostró lo que eso
 *  vale: sus propias fixtures —y las de `architecture.test.ts`, que enseñan a
 *  una regla la forma `import(join(…, "qa", "lib", …))` dentro de un string—
 *  contaban como imports reales, así que borrar los tres tests de `esperas`,
 *  `presets-clasifica` y `veredictos` dejaba la totalidad 8/8 en verde. El
 *  verde que no comprueba, en el test escrito para impedirlo. Ahora se parsea
 *  con `typescript` y solo cuentan los NODOS de import: una declaración
 *  `import … from`, un `import(…)` o un `require(…)` cuyo argumento es un
 *  literal o un `join`/`resolve` con `"qa", "lib", "x.mjs"` como segmentos.
 *  Un string que contenga esas mismas letras es un string. El negativo que QA
 *  hizo a mano (sin `veredictos.test.ts`, `veredictos.mjs` queda huérfano) vive
 *  abajo como test permanente.
 *
 *  Y EL BANCO ES `.mjs` Y SOLO `.mjs` (#686). Todo lo que decide «qué es el
 *  banco» filtra por esa extensión: este test (`modulos`), el padrón de sondas
 *  (`la-consulta-de-movimiento-tiene-dueno.test.ts`), otros seis tests de
 *  `test/` que barren `qa/` (`esperas-de-qa`, `candados-headless-totalidad`,
 *  `las-anclas-de-los-candados`, `esperas-que-conducen`,
 *  `espera-de-fotogramas-con-dueno`, `el-banco-declara-el-modo-de-gasto`), las
 *  reglas de `arch-rules.json` con glob `qa/**\/*.mjs` y su `scan.roots`, el
 *  descubridor de guiones de `qa/run.mjs` y el job `candados-headless`. Node
 *  24 ejecuta un `.ts` sin tsx, así que un `qa/lib/x.ts` importado desde un
 *  guion `.mjs` correría de verdad y sería INVISIBLE para todos ellos. En vez
 *  de enseñar la extensión a cada uno —y dejar abiertos `.js`, `.cjs`, `.mts`,
 *  `.cts`—, se hace inexpresable el estado malo: bajo `qa/` solo caben las
 *  extensiones de la lista blanca de abajo, y cualquier otra es rojo aquí. El
 *  barrido es EL del banco (`test/banco-ficheros.ts`, compartido con el padrón
 *  de sondas): salta `node_modules/`, `.tmp/` y `capturas/` con su motivo
 *  escrito allí, sigue los symlinks, y nada más. Es «la garantía va en el
 *  tipo» aplicada al banco: quien filtra por `.mjs` queda correcto por
 *  construcción — mientras este test esté verde y alguien lo mire. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { SALTOS_DEL_BANCO, ficherosDelBanco, type FicheroDelBanco } from "./banco-ficheros.js";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const QA_LIB = join(repoRoot, "qa", "lib");
const TEST_DIR = join(core, "test");
const CONTRATO = join(core, "data", "contract", "banco-medido.json");

const BancoMedidoSchema = z
  .object({
    _comment: z.string().min(1),
    exentos: z
      .array(
        z
          .object({
            /** Ruta relativa a la raíz del repo, como la escribe `git`. */
            fichero: z.string().regex(/^qa\/lib\/[\w.-]+\.mjs$/, "una exención nombra un `qa/lib/*.mjs`"),
            /** Obligatorio: una exención sin motivo es una regla que ya no sirve. */
            porque: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type BancoMedido = z.infer<typeof BancoMedidoSchema>;

const MODULO_DEL_BANCO = /^[\w.-]+\.mjs$/;

/** Nombres de fichero (`x.mjs`) de `qa/lib` que un test importa DE VERDAD,
 *  leídos del AST: declaraciones `import`, `import()` y `require()` con literal
 *  (`…/qa/lib/x.mjs`) o con `join`/`resolve` cuyos segmentos literales llevan
 *  `"qa", "lib", "x.mjs"` seguidos. Lo que va dentro de un string, de un
 *  comentario o de un `join` que no es argumento de import no es un import. */
export function importsDeQaLib(textoDelTest: string): Set<string> {
  const vistos = new Set<string>();
  const porRuta = (ruta: string): void => {
    const m = /(?:^|\/)qa\/lib\/([\w.-]+\.mjs)$/.exec(ruta);
    if (m) vistos.add(m[1]);
  };
  const porSegmentos = (llamada: ts.CallExpression): void => {
    if (!ts.isIdentifier(llamada.expression) || !["join", "resolve"].includes(llamada.expression.text)) return;
    const segs = llamada.arguments.map((a) => (ts.isStringLiteralLike(a) ? a.text : null));
    for (let i = 0; i + 2 < segs.length; i++) {
      const fichero = segs[i + 2];
      if (segs[i] === "qa" && segs[i + 1] === "lib" && fichero !== null && MODULO_DEL_BANCO.test(fichero)) {
        vistos.add(fichero);
      }
    }
  };
  const visita = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      porRuta(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n)) {
      const esImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const esRequire = ts.isIdentifier(n.expression) && n.expression.text === "require";
      const arg = n.arguments[0];
      if ((esImport || esRequire) && arg) {
        if (ts.isStringLiteralLike(arg)) porRuta(arg.text);
        else if (ts.isCallExpression(arg)) porSegmentos(arg);
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(ts.createSourceFile("test.ts", textoDelTest, ts.ScriptTarget.Latest, true));
  return vistos;
}

/** Las extensiones que pueden vivir bajo `qa/`. Un `.mjs` es el banco; lo
 *  demás son datos (`.json`), prosa (`.md`) y las capturas de una corrida
 *  (`.png`, `.jpg`). Si hace falta ampliarla, que sea con algo que Node NO
 *  ejecute: una extensión ejecutable aquí reabre el agujero de #686 para todo
 *  lo que filtra por `.mjs`. */
export const EXTENSIONES_DEL_BANCO: ReadonlySet<string> = new Set(["mjs", "md", "json", "png", "jpg"]);

const extensionForanea = (r: string): boolean => {
  const nombre = r.slice(r.lastIndexOf("/") + 1);
  const punto = nombre.lastIndexOf(".");
  return punto <= 0 || !EXTENSIONES_DEL_BANCO.has(nombre.slice(punto + 1));
};

/** De estas entradas, las que llevan una extensión fuera de la lista blanca
 *  (o ninguna), como texto para el mensaje. Un enlace a fichero se juzga por
 *  las DOS extensiones —la del enlace, que es lo que escribe un `import`, y la
 *  de su ruta real, que es la que Node ejecuta (`x.mjs -> y.ts` corre como
 *  TypeScript; re-QA de #686)— y sale como `ruta -> real` cuando la que falla
 *  es la real. Puro sobre la lista, para poder probarlo con entradas sintéticas. */
export function extensionesForaneas(entradas: readonly (string | FicheroDelBanco)[]): string[] {
  const out: string[] = [];
  for (const e of entradas) {
    const { ruta, real } = typeof e === "string" ? { ruta: e, real: null } : e;
    if (extensionForanea(ruta)) out.push(ruta);
    else if (real !== null && extensionForanea(real)) out.push(`${ruta} -> ${real}`);
  }
  return out;
}

/** módulo → tests (nombres de fichero) que lo importan, sobre los tests dados. */
export function importadoresEn(dirTests: string, tests: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of tests) {
    for (const m of importsDeQaLib(readFileSync(join(dirTests, t), "utf8"))) {
      out.set(m, [...(out.get(m) ?? []), t]);
    }
  }
  return out;
}

/** Los módulos que ni se importan ni están eximidos. */
export function huerfanosDe(
  modulos: readonly string[],
  importadores: ReadonlyMap<string, string[]>,
  exentos: ReadonlySet<string>,
): string[] {
  return modulos.filter((m) => !importadores.has(m) && !exentos.has(m));
}

const contrato: BancoMedido = BancoMedidoSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const modulos = readdirSync(QA_LIB)
  .filter((f) => f.endsWith(".mjs"))
  .sort();
const tests = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

const importadores = importadoresEn(TEST_DIR, tests);
const exentos = new Map(contrato.exentos.map((e) => [e.fichero.slice("qa/lib/".length), e]));
const nombresExentos = new Set(exentos.keys());

describe("qa/lib tiene quien lo mire (#357)", () => {
  it("el árbol tiene sujeto: hay módulos en qa/lib y tests que importan alguno", () => {
    // Sin esto, un `qa/lib` vacío o un detector roto aprobarían sin mirar
    // nada: el peor de los verdes.
    assert.ok(modulos.length > 0, `no hay ningún .mjs en ${QA_LIB}`);
    assert.ok(
      importadores.size >= 2,
      `el detector solo ve ${importadores.size} módulo(s) importado(s) desde test/ — hoy son cinco; ` +
        `si los tests se movieron, muévelo con ellos`,
    );
  });

  it("cada módulo de qa/lib está importado por algún test, o eximido con motivo", () => {
    const huerfanos = huerfanosDe(modulos, importadores, nombresExentos);
    assert.deepEqual(
      huerfanos,
      [],
      `qa/lib sin quien lo mire: ${huerfanos.join(", ")}. O un test de nefan-core/test/ lo importa ` +
        `(patrón: test/veredictos.test.ts), o entra en data/contract/banco-medido.json con su motivo.`,
    );
  });

  it("el verde depende del test REAL: sin veredictos.test.ts, veredictos.mjs queda huérfano", () => {
    // Lo que QA (#454) hizo a mano moviendo el fichero fuera de test/, sin
    // mover nada: el mismo barrido sobre la lista de tests menos uno. Con el
    // detector textual esto salía verde, porque otros tests NOMBRAN el módulo.
    const sinVeredictos = tests.filter((t) => t !== "veredictos.test.ts");
    assert.equal(sinVeredictos.length, tests.length - 1, "veredictos.test.ts ya no existe: elige otro test real");
    assert.deepEqual(
      huerfanosDe(modulos, importadoresEn(TEST_DIR, sinVeredictos), nombresExentos),
      ["veredictos.mjs"],
      "quitar el test real de veredictos.mjs tiene que dejarlo huérfano, y solo a él",
    );
  });

  it("ninguna exención está caducada: un exento que ya se importa se borra del JSON", () => {
    const caducadas = [...exentos.keys()].filter((m) => importadores.has(m));
    assert.deepEqual(
      caducadas,
      [],
      caducadas
        .map((m) => `${m} está exento y lo importa ${(importadores.get(m) ?? []).join(", ")}: quita la exención`)
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
    // Mismo umbral que `sin_mutar` (mutation-config.test.ts): ocho palabras
    // no garantizan un motivo, pero sí impiden el «TODO» y el «difícil».
    for (const e of contrato.exentos) {
      assert.ok(
        e.porque.split(/\s+/).length >= 8,
        `banco-medido.json["${e.fichero}"]: "${e.porque}" no explica nada — di por qué NO se mide`,
      );
    }
  });

  it("qa/lib no entra en el perímetro de mutación: la dirección es test → banco", () => {
    // La decisión (1) de #357, la mitad que no cubre arch-rules: que nadie
    // meta el banco en `mutation-targets.json` «para medirlo». Se mide desde
    // los tests; el reloj de mutación ya rebosa el lote y son `.mjs` con
    // `node:*`, fuera de `core-puro-sin-node`.
    const plan = JSON.parse(readFileSync(join(core, "data", "contract", "mutation-targets.json"), "utf8")) as {
      modulos: { id: string; mutate: string[]; tests: string[] }[];
      sin_mutar: { fichero: string }[];
    };
    const enMutacion = plan.modulos.flatMap((m) => [...m.mutate, ...m.tests]).filter((f) => /(^|\/)qa\//.test(f));
    assert.deepEqual(enMutacion, [], "mutation-targets.json nombra qa/: el banco no se muta, se mide desde test/");
    assert.deepEqual(
      plan.sin_mutar.map((e) => e.fichero).filter((f) => /(^|\/)qa\//.test(f)),
      [],
      "qa/ no necesita exención en sin_mutar: nunca estuvo en el perímetro",
    );
  });
});

describe("el banco es .mjs y solo .mjs (#686)", () => {
  const QA = join(repoRoot, "qa");
  const todos = ficherosDelBanco(QA).map((f) => ({ ...f, ruta: `qa/${f.ruta}` }));

  it("el árbol tiene sujeto: el barrido ve los guiones, la raíz y lib", () => {
    // Sin esto, un barrido sobre el directorio equivocado aprobaría la lista
    // blanca sobre cero ficheros. Hoy son 213 (209 .mjs + 3 .json + 1 .md);
    // `capturas/` no entra (ver `banco-ficheros.ts`).
    assert.ok(todos.length > 100, `solo ${todos.length} ficheros bajo ${QA} — ¿se movió el banco?`);
    const rutas = todos.map((f) => f.ruta);
    assert.ok(rutas.some((f) => f.startsWith("qa/guiones/") && f.endsWith(".mjs")), "no ve los guiones");
    assert.ok(rutas.some((f) => f.startsWith("qa/lib/") && f.endsWith(".mjs")), "no ve qa/lib");
    assert.ok(rutas.some((f) => f.split("/").length === 2), "no ve la raíz de qa/");
    assert.deepEqual(rutas.filter((f) => f.split("/").some((d) => SALTOS_DEL_BANCO.has(d))), []);
  });

  it("SABE PONERSE ROJO (el barrido): dot-dir y symlinks se ven; .tmp, node_modules, capturas y lo que sale de la raíz no", () => {
    // Sobre un árbol sintético en disco, porque lo que se prueba es el
    // `readdirSync`+`statSync`, no la lista. Lo que tiene que salir:
    // `.oculto/x.ts` (dot-dir que no es .tmp), un symlink a DIRECTORIO
    // recorrido por su nombre de enlace (B-1 de la QA: `qa/capturas/ultima ->
    // <run>` salía como fichero sin extensión), un symlink a FICHERO juzgado
    // por las DOS extensiones (`x.ts -> a.mjs` por el nombre del enlace, que
    // es lo que un import escribe; `y.mjs -> z.ts` por la REAL, que es la que
    // Node ejecuta), un enlace ROTO y uno CÍCLICO sobre sí mismo (`ELOOP`)
    // como ficheros, no callados ni reventando el proceso. Lo que no:
    // `.tmp/`, `node_modules/`, `capturas/` (incluido un `.mjs` ahí: punto (7)
    // del padrón) y el enlace a directorio que SALE de la raíz. Y un symlink
    // cíclico por directorio (`lib/loop -> ..`) se corta.
    const raiz = mkdtempSync(join(tmpdir(), "nefan-banco-"));
    const fuera = mkdtempSync(join(tmpdir(), "nefan-fuera-"));
    try {
      for (const d of [".oculto", ".tmp/run-1", "node_modules/x", "lib", "capturas/run-1"]) mkdirSync(join(raiz, d), { recursive: true });
      for (const f of [".oculto/x.ts", ".tmp/run-1/y.ts", "node_modules/x/z.js", "lib/a.mjs", "b.mjs", ".dotfile.ts", "capturas/run-1/01.png", "capturas/x.mjs", "lib/z.ts"]) {
        writeFileSync(join(raiz, f), "");
      }
      writeFileSync(join(fuera, "ajeno.ts"), "");
      symlinkSync("lib", join(raiz, "enlace-dir"));
      symlinkSync("run-1", join(raiz, "capturas", "ultima"));
      symlinkSync("a.mjs", join(raiz, "lib", "x.ts"));
      symlinkSync("z.ts", join(raiz, "lib", "y.mjs"));
      symlinkSync("no-existe", join(raiz, "roto"));
      symlinkSync("self", join(raiz, "self"));
      symlinkSync("..", join(raiz, "lib", "loop"));
      symlinkSync(fuera, join(raiz, "fuera"));
      const vistos = ficherosDelBanco(raiz);
      assert.deepEqual(
        vistos.map((f) => f.ruta),
        [".dotfile.ts", ".oculto/x.ts", "b.mjs", "enlace-dir/a.mjs", "enlace-dir/x.ts", "enlace-dir/y.mjs", "enlace-dir/z.ts", "lib/a.mjs", "lib/x.ts", "lib/y.mjs", "lib/z.ts", "roto", "self"],
      );
      const real = new Map(vistos.map((f) => [f.ruta, f.real]));
      assert.equal(real.get("lib/x.ts"), realpathSync(join(raiz, "lib", "a.mjs")), "el enlace a fichero trae su ruta real");
      assert.equal(real.get("lib/y.mjs"), realpathSync(join(raiz, "lib", "z.ts")));
      assert.equal(real.get("lib/a.mjs"), null, "un fichero normal no trae ruta real");
      assert.equal(real.get("roto"), null);
      assert.equal(real.get("self"), null, "ELOOP se trata como roto, no revienta");
      assert.deepEqual(extensionesForaneas(vistos), [
        ".dotfile.ts",
        ".oculto/x.ts",
        "enlace-dir/x.ts",
        `enlace-dir/y.mjs -> ${realpathSync(join(raiz, "lib", "z.ts"))}`,
        "enlace-dir/z.ts",
        "lib/x.ts",
        `lib/y.mjs -> ${realpathSync(join(raiz, "lib", "z.ts"))}`,
        "lib/z.ts",
        "roto",
        "self",
      ]);
      // Y sin saltar `capturas/`, el symlink a directorio se RECORRE y no sale
      // como fichero: es exactamente el `ultima` real.
      const sinSaltarCapturas = ficherosDelBanco(raiz, new Set(["node_modules", ".tmp"])).map((f) => f.ruta);
      assert.ok(sinSaltarCapturas.includes("capturas/ultima/01.png"), "el symlink a directorio se recorre por su nombre de enlace");
      assert.ok(!sinSaltarCapturas.includes("capturas/ultima"), "el symlink a directorio NO sale como fichero");
    } finally {
      rmSync(raiz, { recursive: true, force: true });
      rmSync(fuera, { recursive: true, force: true });
    }
  });

  it("bajo qa/ no hay ninguna extensión fuera de la lista blanca", () => {
    const foraneas = extensionesForaneas(todos);
    assert.deepEqual(
      foraneas,
      [],
      `${foraneas.length} fichero(s) bajo qa/ con extensión fuera de {${[...EXTENSIONES_DEL_BANCO].join(", ")}}: ` +
        `${foraneas.slice(0, 5).join(", ")}${foraneas.length > 5 ? ", …" : ""}. El banco es .mjs y solo .mjs: ` +
        `todo lo que decide «qué es el banco» filtra por esa extensión y un .ts/.js/.cjs correría de verdad ` +
        `sin que nadie lo viera (#686). Si el fichero NO es ejecutable, amplía EXTENSIONES_DEL_BANCO en este ` +
        `test; si lo es, escríbelo en .mjs; si es un enlace simbólico ROTO o cíclico (apunta a algo borrado o a sí ` +
        `mismo), bórralo; si es un enlace \`x.mjs -> y.ts\`, Node lo ejecuta como TypeScript: escribe el destino en .mjs.`,
    );
  });

  it("SABE PONERSE ROJO (la lista): un .ts en lib, un .js suelto, un .cjs y un enlace .mjs -> .ts salen señalados; el .mjs y los datos no", () => {
    // El negativo sintético del criterio 4 de #686: exactamente lo que
    // `touch qa/lib/x.ts` haría en el árbol real (probado a mano al nacer), y
    // el enlace `x.mjs -> y.ts` juzgado por su ruta real (re-QA).
    assert.deepEqual(
      extensionesForaneas([
        "qa/lib/x.ts",
        "qa/a.js",
        "qa/lib/b.cjs",
        "qa/guiones/1.mjs",
        "qa/portadas.json",
        "qa/README.md",
        "qa/capturas/2026-09-18T00-00-00-000Z-1/01.png",
        "qa/lib/c.mts",
        "qa/SIN-EXTENSION",
        "qa/lib/.oculto.ts",
        { ruta: "qa/lib/enlace.mjs", real: "/otro/sitio/y.ts" },
        { ruta: "qa/lib/enlace-bueno.mjs", real: "/otro/sitio/z.mjs" },
        { ruta: "qa/lib/enlace-doble.ts", real: "/otro/sitio/w.ts" },
      ]),
      [
        "qa/lib/x.ts",
        "qa/a.js",
        "qa/lib/b.cjs",
        "qa/lib/c.mts",
        "qa/SIN-EXTENSION",
        "qa/lib/.oculto.ts",
        "qa/lib/enlace.mjs -> /otro/sitio/y.ts",
        "qa/lib/enlace-doble.ts",
      ],
    );
  });
});

describe("el detector de imports de qa/lib", () => {
  it("cuenta las cuatro formas de importar, también partidas en varias líneas", () => {
    const texto = [
      'const mod = (await import(join(repoRoot, "qa", "lib", "esperas.mjs"))) as X;',
      "const { offsetActual } = (await import(",
      '  join(repoRoot, "qa", "lib", "stack.mjs")',
      ")) as Y;",
      'import { VERDE } from "../../qa/lib/veredictos.mjs";',
      'const c = await import("../../qa/lib/presets-clasifica.mjs");',
      'const r = require(resolve(raiz, "..", "qa", "lib", "python.mjs"));',
    ].join("\n");
    assert.deepEqual(
      [...importsDeQaLib(texto)].sort(),
      ["esperas.mjs", "presets-clasifica.mjs", "python.mjs", "stack.mjs", "veredictos.mjs"],
    );
  });

  it("NO cuenta un import escrito DENTRO de un string: la fixture de un test no es un import", () => {
    // Exactamente lo que H1 de QA (#454) encontró: las fixtures de este mismo
    // test y las de `architecture.test.ts` tienen la forma de un import, y
    // estaban contando. Para el AST son literales.
    const texto = [
      'const fixture = \'const m = await import(join(process.cwd(), "..", "qa", "lib", "stack.mjs"));\';',
      "const otra = `import { VERDE } from \"../../qa/lib/veredictos.mjs\";`;",
      '{ path: "nefan-html/src/x.ts", text: \'await import("../../qa/lib/sonda.mjs");\', imports: [] },',
    ].join("\n");
    assert.deepEqual([...importsDeQaLib(texto)], []);
  });

  it("NO cuenta una mención en un string de traza, un comentario ni un join sin import", () => {
    // La traza de fixture de `esperas-de-qa.test.ts`, tal cual, y las otras
    // formas de NOMBRAR el banco sin importarlo. Si esto contara, la totalidad
    // se cumpliría escribiendo el nombre en un comentario.
    const texto = [
      '  "    at Object.waitFor (/home/al/code/ne-fan/qa/lib/sonda.mjs:64:13)",',
      '  "    at acercarse (/home/al/code/ne-fan/qa/lib/combate.mjs:40:5)",',
      "// el sujeto es `qa/lib/saves.mjs`, que se prueba en otro sitio",
      'const dirs = [join(repoRoot, "qa", "guiones"), join(repoRoot, "qa", "lib")];',
      'const ruta = join(repoRoot, "qa", "lib", "navegador.mjs"); // sin import(...)',
      'const s = "qa/lib/fixtures.mjs";',
      'const otro = await import(join(repoRoot, "qa", "guiones", "01.mjs"));',
    ].join("\n");
    assert.deepEqual([...importsDeQaLib(texto)], []);
  });
});
