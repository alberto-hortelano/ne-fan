/** UN solo barrido del banco (#704): ningún fichero de `test/` recorre `qa/`
 *  de forma RECURSIVA por su cuenta. El barrido es `banco-ficheros.ts`, y es el
 *  único que decide «qué ficheros son el banco».
 *
 *  Llegó a haber CUATRO recorridos recursivos de `qa/` con saltos distintos
 *  —uno seguía enlaces y saltaba solo tres directorios por nombre; los otros
 *  tres no seguían enlaces y saltaban todo directorio con punto—: el día que
 *  entrase un symlink o un `qa/.oculto/` en el banco, un padrón vería un `.mjs`
 *  que otro no ve, y ninguno de los dos se pondría rojo.
 *
 *  ## Qué pregunta el detector, y qué NO
 *
 *  Solo «¿esto recorre de forma RECURSIVA?», que es una pregunta del árbol:
 *  una llamada a un lector de `node:fs` (`readdir`, `opendir`, en sus formas
 *  síncrona y de promesa) con `recursive` en sus opciones, un `glob`, o una
 *  función que llama a un lector Y se nombra a sí misma en su cuerpo. NO
 *  resuelve a qué carpeta apunta el recorrido: perseguir `join(repoRoot, "qa",
 *  …)`, las constantes y los bucles sobre `dirs` es el terreno donde un censo
 *  nace ciego a la escritura (#686). En su lugar hay DOS totalidades:
 *
 *   · todo recorrido recursivo de `test/` fuera de `banco-ficheros.ts` se
 *     declara en `data/contract/recorridos-de-test.json` con QUÉ recorre y por
 *     qué, y el padrón no admite uno que diga `qa`;
 *   · toda lectura PLANA de un directorio (sin bajar) se declara también, por
 *     el texto de su argumento: las de una carpeta de `qa/` con su carpeta, las
 *     de otra carpeta con lo que leen. Es la red de lo que el detector no sabe
 *     ver como recursivo (la recursión mutua, el recorrido con pila): sale como
 *     lectura plana y alguien tiene que escribir qué lee.
 *
 *  Que `recorre`/`lee`/`carpetas` digan la verdad lo lee el revisor: está en
 *  `_lo_que_esto_NO_sujeta`, y cada punto tiene aquí su «LÍMITE MEDIDO». */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { SALTOS_DEL_BANCO, fuentesDelBanco } from "./banco-ficheros.js";

const TEST = dirname(fileURLToPath(import.meta.url));
const core = resolve(TEST, "..");
const CONTRATO = join(core, "data", "contract", "recorridos-de-test.json");
/** El dueño: lo único que puede recorrer `qa/` entero. No va en el padrón. */
const DUENO = "banco-ficheros.ts";

const Argumentos = z.array(z.string().min(1)).min(1);
const PadronSchema = z
  .object({
    _comment: z.string().min(1),
    _lo_que_esto_NO_sujeta: z.string().min(1),
    recorridos: z.array(
      z
        .object({
          fichero: z.string().min(1),
          sitios: z.number().int().positive(),
          /** Llamadas a un lector que viven en esos recorridos: una lectura
           *  plana metida DENTRO de un recorrido declarado también se cuenta. */
          lecturas: z.number().int().positive(),
          recorre: z.string().min(1),
          porque: z.string().min(10),
        })
        .strict(),
    ),
    lectores_de_carpeta_de_qa: z.array(
      z
        .object({
          fichero: z.string().min(1),
          carpetas: z.array(z.string().regex(/^qa(\/|$)/)).min(1),
          argumentos: Argumentos,
          porque: z.string().min(10),
        })
        .strict(),
    ),
    lectores_de_otras_carpetas: z.array(
      z
        .object({
          fichero: z.string().min(1),
          lee: z.string().min(1),
          argumentos: Argumentos,
          porque: z.string().min(10),
        })
        .strict(),
    ),
  })
  .strict();
type Padron = z.infer<typeof PadronSchema>;

const MODULOS_FS = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);
/** Lo que lee UN directorio: recorre si le piden `recursive` o si quien lo
 *  llama se llama a sí mismo. */
const LECTORES = new Set(["readdirSync", "readdir", "opendirSync", "opendir"]);
/** Lo que recorre por PATRÓN: cuenta siempre como recorrido, lleve `**` o no.
 *  Es conservador en la dirección roja: uno legítimo se declara. */
const GLOBS = new Set(["globSync", "glob"]);
type Clase = "lector" | "glob";

/** Quita lo que envuelve a una expresión sin cambiar su valor. */
function desnuda(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isAwaitExpression(x) || ts.isNonNullExpression(x)) {
    x = x.expression;
  }
  return x;
}

const nombreDePropiedad = (n: ts.PropertyName | ts.BindingName | undefined): string | null =>
  n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

interface Lectura {
  linea: number;
  /** El primer argumento TAL COMO ESTÁ ESCRITO: la clave con la que se declara. */
  argumento: string;
}

/** Los SITIOS donde este fuente recorre un directorio de forma recursiva, y
 *  las lecturas planas (las de un lector de carpeta). */
function recorridos(texto: string, kind: ts.ScriptKind = ts.ScriptKind.TS): { recursivos: number[]; lecturas: number; planas: Lectura[] } {
  const sf = ts.createSourceFile("x.ts", texto, ts.ScriptTarget.Latest, true, kind);
  const linea = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const todos: ts.Node[] = [];
  const junta = (n: ts.Node): void => {
    todos.push(n);
    ts.forEachChild(n, junta);
  };
  junta(sf);

  // ── Nombres: qué identificador es un lector, un glob o `fs` entero ────────
  const directos = new Map<string, Clase>();
  const espacios = new Set<string>();
  /** Objetos literales ligados a un `const` del fichero: `{...OPCIONES}`. */
  const objetos = new Map<string, ts.ObjectLiteralExpression>();
  const esModuloFs = (e: ts.Expression | undefined): boolean => !!e && ts.isStringLiteral(e) && MODULOS_FS.has(e.text);
  /** `import("node:fs")`, `require("node:fs")` (también el de `createRequire`). */
  const cargaFs = (e: ts.Expression): boolean => {
    const x = desnuda(e);
    if (!ts.isCallExpression(x)) return false;
    const llama = x.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(x.expression) && x.expression.text === "require");
    return llama && esModuloFs(x.arguments[0]);
  };
  const esEspacio = (e: ts.Expression): boolean => {
    const x = desnuda(e);
    if (ts.isIdentifier(x)) return espacios.has(x.text);
    if (ts.isPropertyAccessExpression(x)) return x.name.text === "promises" && esEspacio(x.expression);
    return cargaFs(x);
  };
  const claseDe = (e: ts.Expression): Clase | "espacio" | null => {
    const x = desnuda(e);
    if (ts.isIdentifier(x) && directos.has(x.text)) return directos.get(x.text)!;
    if (esEspacio(x)) return "espacio";
    if (ts.isPropertyAccessExpression(x) && esEspacio(x.expression)) {
      if (LECTORES.has(x.name.text)) return "lector";
      if (GLOBS.has(x.name.text)) return "glob";
    }
    return null;
  };
  const liga = (nombre: string, importado: string): void => {
    if (LECTORES.has(importado)) directos.set(nombre, "lector");
    else if (GLOBS.has(importado)) directos.set(nombre, "glob");
    else if (importado === "promises") espacios.add(nombre);
  };
  // Punto fijo: un alias puede colgar de otro alias.
  for (let antes = -1; antes !== directos.size + espacios.size; ) {
    antes = directos.size + espacios.size;
    for (const n of todos) {
      if (ts.isImportDeclaration(n) && esModuloFs(n.moduleSpecifier) && n.importClause) {
        const c = n.importClause;
        if (c.name) espacios.add(c.name.text);
        const b = c.namedBindings;
        if (b && ts.isNamespaceImport(b)) espacios.add(b.name.text);
        if (b && ts.isNamedImports(b)) for (const el of b.elements) liga(el.name.text, (el.propertyName ?? el.name).text);
      }
      if (ts.isVariableDeclaration(n) && n.initializer) {
        if (ts.isIdentifier(n.name) && ts.isObjectLiteralExpression(desnuda(n.initializer))) {
          objetos.set(n.name.text, desnuda(n.initializer) as ts.ObjectLiteralExpression);
        }
        const clase = claseDe(n.initializer);
        if (clase === null) continue;
        if (ts.isIdentifier(n.name)) {
          if (clase === "espacio") espacios.add(n.name.text);
          else directos.set(n.name.text, clase);
        } else if (ts.isObjectBindingPattern(n.name) && clase === "espacio") {
          for (const el of n.name.elements) {
            const importado = nombreDePropiedad(el.propertyName) ?? nombreDePropiedad(el.name);
            if (importado && ts.isIdentifier(el.name)) liga(el.name.text, importado);
          }
        }
      }
    }
  }

  // ── Opciones: ¿pide `recursive`? ──────────────────────────────────────────
  const pideRecursivo = (e: ts.Expression, vistos = new Set<string>()): boolean => {
    const x = desnuda(e);
    if (ts.isIdentifier(x)) {
      const o = objetos.get(x.text);
      if (!o || vistos.has(x.text)) return false;
      vistos.add(x.text);
      return pideRecursivo(o, vistos);
    }
    if (!ts.isObjectLiteralExpression(x)) return false;
    return x.properties.some((p) => {
      if (ts.isShorthandPropertyAssignment(p)) return p.name.text === "recursive";
      if (ts.isSpreadAssignment(p)) return pideRecursivo(p.expression, vistos);
      if (!ts.isPropertyAssignment(p) || nombreDePropiedad(p.name) !== "recursive") return false;
      // Cualquier valor que no sea `false` literal: conservador hacia el rojo.
      return desnuda(p.initializer).kind !== ts.SyntaxKind.FalseKeyword;
    });
  };

  const llamadas = todos.filter(ts.isCallExpression);
  const claseDeLlamada = (c: ts.CallExpression): Clase | null => {
    const k = claseDe(c.expression);
    return k === "espacio" ? null : k;
  };

  // ── Recursión: una función que lee y se nombra a sí misma ─────────────────
  const recursivos: number[] = [];
  let lecturas = 0;
  const dentroDeRecursiva = new Set<ts.CallExpression>();
  const nombresDe = (f: ts.Node): string[] => {
    const out: string[] = [];
    const propio = (f as ts.FunctionLikeDeclarationBase).name;
    const n = nombreDePropiedad(propio as ts.PropertyName | undefined);
    if (n) out.push(n);
    const p = f.parent;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) out.push(p.name.text);
    if (ts.isPropertyAssignment(p)) {
      const q = nombreDePropiedad(p.name);
      if (q) out.push(q);
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = desnuda(p.left);
      if (ts.isIdentifier(l)) out.push(l.text);
      if (ts.isPropertyAccessExpression(l)) out.push(l.name.text);
    }
    return out;
  };
  for (const f of todos) {
    if (!(ts.isFunctionDeclaration(f) || ts.isFunctionExpression(f) || ts.isArrowFunction(f) || ts.isMethodDeclaration(f))) continue;
    if (!f.body) continue;
    const nombres = new Set(nombresDe(f));
    if (nombres.size === 0) continue;
    const lee: ts.CallExpression[] = [];
    let seNombra = false;
    const v = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && claseDeLlamada(n) === "lector") lee.push(n);
      if (ts.isIdentifier(n) && nombres.has(n.text)) seNombra = true;
      ts.forEachChild(n, v);
    };
    v(f.body);
    if (lee.length > 0 && seNombra) {
      recursivos.push(linea(f));
      lecturas += lee.length;
      for (const c of lee) dentroDeRecursiva.add(c);
    }
  }

  const planas: Lectura[] = [];
  for (const c of llamadas) {
    const clase = claseDeLlamada(c);
    if (clase === null) continue;
    if (clase === "glob" || c.arguments.slice(1).some((a) => pideRecursivo(a))) {
      recursivos.push(linea(c));
      if (!dentroDeRecursiva.has(c)) lecturas++;
    }
    else if (!dentroDeRecursiva.has(c)) planas.push({ linea: linea(c), argumento: c.arguments[0]?.getText(sf) ?? "" });
  }
  return { recursivos: recursivos.sort((a, b) => a - b), lecturas, planas };
}

const EXTENSIONES = new Map<string, ts.ScriptKind>([
  [".ts", ts.ScriptKind.TS],
  [".mts", ts.ScriptKind.TS],
  [".cts", ts.ScriptKind.TS],
  [".js", ts.ScriptKind.JS],
  [".mjs", ts.ScriptKind.JS],
  [".cjs", ts.ScriptKind.JS],
]);

/** Todo fuente TS o JS bajo `test/` (las fixtures también), relativo a `test/`:
 *  un helper `.mjs` importado por un test también es código de test. */
const fuentesDeTest = (): string[] =>
  (readdirSync(TEST, { recursive: true }) as string[]).filter((f) => EXTENSIONES.has(extname(f))).sort();

/** Un `recorre`/`lee` que nombra `qa` es una copia del banco con otro nombre. */
const nombraElBanco = (recorre: string): boolean => /(^|[^\w-])qa(\/|$|[^\w-])/i.test(recorre);

/** EL PARSE VA FUERA DEL `describe` (#611): dentro, un zod que lanza deja la
 *  suite en `fail 0` y `npm test` verde. */
const padron: Padron = PadronSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const censo = new Map(
  fuentesDeTest().map((f) => [f, recorridos(readFileSync(join(TEST, f), "utf8"), EXTENSIONES.get(extname(f)))] as const),
);

describe("un solo barrido del banco (#704): nadie más recorre qa/ de forma recursiva", () => {
  it("el árbol tiene sujeto: hay recorridos en test/ y el dueño da exactamente uno", () => {
    const total = [...censo.values()].reduce((s, r) => s + r.recursivos.length, 0);
    assert.ok(total >= 5, `el detector ve ${total} recorridos recursivos en test/: ¿se ha roto?`);
    assert.equal(censo.get(DUENO)?.recursivos.length, 1, `${DUENO} tiene que dar UN recorrido: es el barrido`);
    assert.ok(censo.size >= 150, `test/ tiene ${censo.size} fuentes: ¿se ha roto el censo?`);
  });

  it("totalidad: cada recorrido recursivo fuera del dueño está en el padrón con su cifra exacta", () => {
    const medidos = new Map([...censo].filter(([f, r]) => f !== DUENO && r.recursivos.length > 0));
    const declarados = new Map(padron.recorridos.map((r) => [r.fichero, r]));
    const fallos: string[] = [];
    for (const [f, { recursivos: lineas, lecturas }] of medidos) {
      const d = declarados.get(f);
      if (d === undefined) fallos.push(`${f}: recorre de forma recursiva (líneas ${lineas.join(", ")}) y no está en el padrón`);
      else if (d.sitios !== lineas.length) fallos.push(`${f}: ${lineas.length} recorridos medidos (líneas ${lineas.join(", ")}) contra ${d.sitios} declarados`);
      else if (d.lecturas !== lecturas) {
        fallos.push(`${f}: ${lecturas} llamadas a un lector dentro de sus recorridos (líneas ${lineas.join(", ")}) contra ${d.lecturas} declaradas`);
      }
    }
    for (const [f] of declarados) if (!medidos.has(f)) fallos.push(`${f}: declarado y ya no recorre nada (o no existe): entrada caducada`);
    assert.deepEqual(
      fallos,
      [],
      `Un recorrido de qa/ pasa por \`fuentesDelBanco\`/\`ficherosDelBanco\` de ${DUENO}; ` +
        `uno de OTRA carpeta se declara en recorridos-de-test.json con qué recorre y por qué.\n${fallos.join("\n")}`,
    );
  });

  it("el padrón no puede legalizar una copia del banco: ningún `recorre` nombra qa", () => {
    const copias = padron.recorridos.filter((r) => nombraElBanco(r.recorre)).map((r) => `${r.fichero}: «${r.recorre}»`);
    assert.deepEqual(copias, [], `recorrer qa/ es trabajo de ${DUENO}, no de un padrón`);
    assert.ok(!padron.recorridos.some((r) => r.fichero === DUENO), `${DUENO} es el dueño: no se declara`);
  });

  it("totalidad de lectores: cada lectura plana de un directorio está declarada, por su argumento", () => {
    // Una lectura de UNA carpeta de qa/ va a `lectores_de_carpeta_de_qa`; la de
    // otra carpeta, a `lectores_de_otras_carpetas`. Cada entrada nombra el
    // ARGUMENTO tal como está escrito: si el fichero deja de leer ESE argumento,
    // la entrada caduca aunque siga leyendo otra carpeta.
    // Con CUENTA: un argumento declarado una vez es UNA lectura. Una lectura
    // nueva con el mismo texto (`readdirSync(dir)` otra vez) no se cuela.
    const declaradas = new Map<string, { lista: string; veces: number }>();
    const declara = (fichero: string, a: string, lista: string): void => {
      const k = `${fichero} :: ${a}`;
      declaradas.set(k, { lista, veces: (declaradas.get(k)?.veces ?? 0) + 1 });
    };
    for (const l of padron.lectores_de_carpeta_de_qa) for (const a of l.argumentos) declara(l.fichero, a, "lectores_de_carpeta_de_qa");
    for (const l of padron.lectores_de_otras_carpetas) for (const a of l.argumentos) declara(l.fichero, a, "lectores_de_otras_carpetas");
    const medidas = new Map<string, number[]>();
    for (const [f, r] of censo) {
      if (f === DUENO) continue;
      for (const p of r.planas) medidas.set(`${f} :: ${p.argumento}`, [...(medidas.get(`${f} :: ${p.argumento}`) ?? []), p.linea]);
    }
    const fallos: string[] = [];
    for (const [clave, lineas] of medidas) {
      const d = declaradas.get(clave);
      if (!d) fallos.push(`${clave} (líneas ${lineas.join(", ")}): lee un directorio y no está declarada`);
      else if (d.veces !== lineas.length) {
        fallos.push(`${clave}: ${lineas.length} lecturas (líneas ${lineas.join(", ")}) contra ${d.veces} declaradas en ${d.lista}: repite el argumento una vez por lectura`);
      }
    }
    for (const [clave, { lista }] of declaradas) if (!medidas.has(clave)) fallos.push(`${clave}: declarada en ${lista} y ya no se lee así: entrada caducada`);
    assert.deepEqual(
      fallos,
      [],
      `Una lectura plana se declara en recorridos-de-test.json: \`lectores_de_carpeta_de_qa\` si lee UNA carpeta de qa/, ` +
        `\`lectores_de_otras_carpetas\` si no. Si en realidad RECORRE (recursión mutua, pila), no es una lectura: ` +
        `pásala por ${DUENO} o declárala en \`recorridos\`.\n${fallos.join("\n")}`,
    );
  });

  it("un lector de otra carpeta no puede nombrar qa, y ninguna entrada apunta a un fichero que no existe", () => {
    const copias = padron.lectores_de_otras_carpetas.filter((l) => nombraElBanco(l.lee)).map((l) => `${l.fichero}: «${l.lee}»`);
    assert.deepEqual(copias, [], "una lectura de qa/ va a `lectores_de_carpeta_de_qa`");
    const todas = [...padron.recorridos, ...padron.lectores_de_carpeta_de_qa, ...padron.lectores_de_otras_carpetas];
    assert.deepEqual(todas.filter((e) => !existsSync(join(TEST, e.fichero))).map((e) => e.fichero), []);
  });

  it("ningún fichero sale dos veces en la misma lista del padrón", () => {
    for (const lista of [padron.recorridos, padron.lectores_de_carpeta_de_qa, padron.lectores_de_otras_carpetas]) {
      const vistos = lista.map((r) => r.fichero);
      assert.deepEqual(vistos.filter((f, i) => vistos.indexOf(f) !== i), []);
    }
  });

  it("el zod exige `_lo_que_esto_NO_sujeta`, argumentos, y rechaza un lector de qa/ que no es de qa/", () => {
    const base = { _comment: "c", _lo_que_esto_NO_sujeta: "n", recorridos: [], lectores_de_carpeta_de_qa: [], lectores_de_otras_carpetas: [] };
    assert.equal(PadronSchema.safeParse(base).success, true);
    const { _lo_que_esto_NO_sujeta: _, ...sinLimites } = base;
    assert.equal(PadronSchema.safeParse(sinLimites).success, false, "sin `_lo_que_esto_NO_sujeta` no hay padrón");
    const fuera = { ...base, lectores_de_carpeta_de_qa: [{ fichero: "x.ts", carpetas: ["data/scenes"], argumentos: ["D"], porque: "no es del banco" }] };
    assert.equal(PadronSchema.safeParse(fuera).success, false);
    const sinArg = { ...base, lectores_de_otras_carpetas: [{ fichero: "x.ts", lee: "data", argumentos: [], porque: "sin argumento no hay clave" }] };
    assert.equal(PadronSchema.safeParse(sinArg).success, false);
  });

  // ── EN NEGATIVO: las formas que el detector SÍ ve, sobre código sintético ──

  const FS = `import { readdirSync } from "node:fs";\n`;
  const ve = (codigo: string, kind?: ts.ScriptKind): number => recorridos(codigo, kind).recursivos.length;

  it("ve la copia con flatMap que había en tres tests (la que #704 retiró)", () => {
    const viejo = `${FS}const ficherosDelBanco = (dir = join(repoRoot, "qa")): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name.startsWith(".") ? [] : ficherosDelBanco(join(dir, e.name));
    return e.name.endsWith(".mjs") ? [join(dir, e.name)] : [];
  });`;
    assert.deepEqual(recorridos(viejo), { recursivos: [2], lecturas: 1, planas: [] });
  });

  it("una lectura plana DENTRO de un recorrido suma a sus `lecturas` (V2-1 b)", () => {
    const dos = `${FS}function escenasDe(d: string): string[] {
  readdirSync(join(repoRoot, "qa"));
  return readdirSync(d).flatMap((e) => escenasDe(e));
}`;
    assert.deepEqual(recorridos(dos), { recursivos: [2], lecturas: 2, planas: [] });
  });

  it("ve la función declarada que se llama a sí misma (la que tenía helpers-del-banco.ts)", () => {
    const viejo = `${FS}export function fuentesDelBanco(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) fuentesDelBanco(join(dir, e.name), out);
  return out;
}`;
    assert.deepEqual(recorridos(viejo).recursivos, [2]);
  });

  it("ve `recursive` por cualquier camino de NOMBRE: alias de import, espacio, promesas, require, import() y asignación", () => {
    const casos = [
      `${FS}readdirSync(QA, { recursive: true });`,
      `import { readdirSync as leer } from "node:fs";\nleer(QA, { recursive: true });`,
      `import * as fs from "node:fs";\nfs.readdirSync(QA, { recursive: true });`,
      `import fs from "node:fs";\nfs.readdirSync(QA, { recursive: true });`,
      `import { readdir } from "node:fs/promises";\nawait readdir(QA, { recursive: true });`,
      `import { promises } from "node:fs";\npromises.readdir(QA, { recursive: true });`,
      `import fs from "node:fs";\nfs.promises.readdir(QA, { recursive: true });`,
      `const { readdirSync: r } = await import("node:fs");\nr(QA, { recursive: true });`,
      `const fs = await import("node:fs");\nfs.readdirSync(QA, { recursive: true });`,
      `(await import("node:fs")).readdirSync(QA, { recursive: true });`,
      `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nconst { readdirSync } = require("node:fs");\nreaddirSync(QA, { recursive: true });`,
      `import * as fs from "node:fs";\nconst { readdirSync } = fs;\nreaddirSync(QA, { recursive: true });`,
      `${FS}const leer = readdirSync;\nconst otra = leer;\notra(QA, { recursive: true });`,
      `${FS}readdirSync?.(QA, { recursive: true });`,
    ];
    assert.deepEqual(casos.filter((c) => ve(c) !== 1), []);
  });

  it("ve `recursive` por cualquier ESCRITURA de las opciones: comillas, `as const`, abreviada, spread y const", () => {
    const casos = [
      `${FS}readdirSync(QA, { "recursive": true });`,
      `${FS}readdirSync(QA, { recursive: true as const });`,
      `${FS}const recursive = true;\nreaddirSync(QA, { recursive });`,
      `${FS}const OPCIONES = { recursive: true };\nreaddirSync(QA, { ...OPCIONES, withFileTypes: true });`,
      `${FS}const OPCIONES = { recursive: true };\nreaddirSync(QA, OPCIONES);`,
      `${FS}readdirSync(QA, { withFileTypes: true, recursive: true });`,
    ];
    assert.deepEqual(casos.filter((c) => ve(c) !== 1), []);
    assert.equal(ve(`${FS}readdirSync(QA, { recursive: false });`), 0, "`recursive: false` no recorre");
  });

  it("ve un `glob` de node:fs como recorrido, y `opendir` como lector", () => {
    assert.equal(ve(`import { globSync } from "node:fs";\nglobSync("qa/**/*.mjs");`), 1);
    assert.equal(ve(`import { glob } from "node:fs/promises";\nfor await (const f of glob("qa/*.mjs")) void f;`), 1);
    assert.equal(
      ve(`import { opendirSync } from "node:fs";
export function baja(d: string): void { const dir = opendirSync(d); let e; while ((e = dir.readSync())) if (e.isDirectory()) baja(e.name); }`),
      1,
    );
  });

  it("ve la recursión por cualquier forma de NOMBRARSE: this, objeto, let, expresión con nombre y referencia", () => {
    const casos = [
      `${FS}export class W { baja(d: string): string[] { return readdirSync(d).flatMap((e) => this.baja(e)); } }`,
      `${FS}export const w = { baja(d: string): string[] { return readdirSync(d).flatMap((e) => w.baja(e)); } };`,
      `${FS}export const w = { baja: (d: string): string[] => readdirSync(d).flatMap((e) => w.baja(e)) };`,
      `${FS}let baja: (d: string) => string[];\nbaja = (d) => readdirSync(d).flatMap((e) => baja(e));`,
      `${FS}export const w = function baja(d: string): string[] { return readdirSync(d).flatMap((e) => baja(e)); };`,
      `${FS}export const baja = (d: string): string[] => readdirSync(d).flatMap(baja);`,
    ];
    assert.deepEqual(casos.filter((c) => ve(c) !== 1), []);
  });

  it("ve un helper `.mjs` bajo test/: el censo mira JS además de TS", () => {
    assert.equal(ve(`import { readdirSync } from "node:fs";\nexport const b = (d) => readdirSync(d).flatMap((e) => b(e));`, ts.ScriptKind.JS), 1);
    assert.ok(fuentesDeTest().some((f) => f === DUENO), "el censo ve los .ts");
    assert.ok([".mjs", ".js", ".cjs", ".mts"].every((x) => EXTENSIONES.has(x)));
  });

  it("un lector de carpeta NO es un recorrido, lleva su argumento, y un readdirSync ajeno a node:fs no cuenta", () => {
    assert.deepEqual(recorridos(`${FS}const g = readdirSync(GUIONES).filter((f) => f.endsWith(".mjs"));`), {
      recursivos: [],
      lecturas: 0,
      planas: [{ linea: 2, argumento: "GUIONES" }],
    });
    assert.deepEqual(recorridos(`import { readdirSync } from "./otro.js";\nreaddirSync(QA, { recursive: true });`), {
      recursivos: [],
      lecturas: 0,
      planas: [],
    });
  });

  it("un `recorre` que nombra qa lo rechaza el aserto, con mayúsculas o sin ellas; uno de otra carpeta, no", () => {
    for (const r of ["qa", "qa/", "QA/guiones", "qa/guiones", "repo/qa/lib", "data/scenes y qa", "Qa"]) assert.ok(nombraElBanco(r), r);
    for (const r of ["data/scenes", "nefan-html/src", "docs/agents", "test/ (sonda-de-qa)"]) assert.ok(!nombraElBanco(r), r);
  });

  // ── LÍMITES MEDIDOS: cada punto de `_lo_que_esto_NO_sujeta` ────────────────

  it("LÍMITE MEDIDO (1): lo que no es una llamada RECONOCIBLE a un lector de fs no se ve (shell, corchetes, valor, y cinco formas de llegar a node:fs)", () => {
    const invisibles = [
      `import { execSync } from "node:child_process";\nexecSync("find qa -name '*.mjs'");`,
      `import * as fs from "node:fs";\nfs["readdirSync"](QA, { recursive: true });`,
      `${FS}const aplica = (f: typeof readdirSync) => f(QA, { recursive: true });\naplica(readdirSync);`,
      // QA vuelta 2 (V2-2): formas de LLEGAR a node:fs que no se persiguen.
      `import { readdirSync } from "./helper-que-reexporta.js";\nreaddirSync(QA, { recursive: true });`,
      `import("node:fs").then((fs) => fs.readdirSync(QA, { recursive: true }));`,
      "const fs = await import(`node:fs`);\nfs.readdirSync(QA, { recursive: true });",
      `process.getBuiltinModule("node:fs").readdirSync(QA, { recursive: true });`,
      `import fs = require("node:fs");\nfs.readdirSync(QA, { recursive: true });`,
    ];
    assert.deepEqual(
      invisibles.map((c) => recorridos(c)),
      invisibles.map(() => ({ recursivos: [], lecturas: 0, planas: [] })),
    );
  });

  it("LÍMITE MEDIDO (2): las opciones que no se resuelven en el fichero salen como lectura PLANA, no como recorrido", () => {
    const planas = [
      `${FS}export const f = (o: { recursive: boolean }) => readdirSync(QA, o);`,
      `${FS}import { OPCIONES } from "./otro.js";\nreaddirSync(QA, OPCIONES);`,
      `${FS}let o = {};\no = { recursive: true };\nreaddirSync(QA, o);`,
    ];
    assert.deepEqual(
      planas.map((c) => recorridos(c).recursivos.length + recorridos(c).planas.length * 10),
      [10, 10, 10],
      "cero recorridos y UNA lectura plana: la para la totalidad de lectores, y su `lee` es prosa",
    );
  });

  it("LÍMITE MEDIDO (3): la recursión mutua y el recorrido con pila salen como lectura PLANA, no como recorrido", () => {
    const mutua = `${FS}function a(d) { for (const e of readdirSync(d)) b(e); }
function b(d) { a(d); }`;
    const pila = `${FS}const pila = [QA];
while (pila.length) for (const e of readdirSync(pila.pop(), { withFileTypes: true })) if (e.isDirectory()) pila.push(e.name);`;
    assert.deepEqual(recorridos(mutua), { recursivos: [], lecturas: 0, planas: [{ linea: 2, argumento: "d" }] });
    assert.deepEqual(recorridos(pila), { recursivos: [], lecturas: 0, planas: [{ linea: 3, argumento: "pila.pop()" }] });
  });

  it("LÍMITE MEDIDO (4): el destino no se resuelve; un `recorre` mentiroso pasa, y un argumento se casa por su TEXTO", () => {
    assert.equal(nombraElBanco("data/scenes"), false, "«data/scenes» apuntando a join(repoRoot, 'qa') pasa");
    // `GUIONES` redefinido para apuntar a otra carpeta sigue casando con la entrada.
    const a = recorridos(`${FS}const GUIONES = "qa/guiones";\nreaddirSync(GUIONES);`).planas[0]?.argumento;
    const b = recorridos(`${FS}const GUIONES = "data/scenes";\nreaddirSync(GUIONES);`).planas[0]?.argumento;
    assert.equal(a, b);
  });

  it("LÍMITE MEDIDO (5): solo se mira test/; scripts/, labs/, src/ y qa/ quedan fuera", () => {
    assert.ok(fuentesDeTest().every((f) => !f.startsWith("..")));
    assert.equal(fuentesDeTest().some((f) => f.includes("scripts/")), false);
  });

  it("LÍMITE MEDIDO (6): lo que el barrido SALTA no lo ve ningún padrón que lo consuma", () => {
    // Medido en un árbol temporal, no en qa/: un `.mjs` en cada salto y otro en
    // un directorio con punto que NO es salto.
    const raiz = mkdtempSync(join(tmpdir(), "nefan-704-saltos-"));
    try {
      for (const d of [...SALTOS_DEL_BANCO, ".oculto", "guiones"]) {
        mkdirSync(join(raiz, d), { recursive: true });
        writeFileSync(join(raiz, d, "x.mjs"), "export {};\n");
      }
      assert.deepEqual(fuentesDelBanco(raiz), [".oculto/x.mjs", "guiones/x.mjs"]);
      // Las tres copias `flatMap` que #704 retiró saltaban `node_modules` y
      // todo directorio con punto, NO `capturas/`: un `.mjs` ahí BAJA el censo
      // de esos tres padrones en uno (QA de la tanda AL, 221 → 220).
      assert.deepEqual([...SALTOS_DEL_BANCO].sort(), [".tmp", "capturas", "node_modules"]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
