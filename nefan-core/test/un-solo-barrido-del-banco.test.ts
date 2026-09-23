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
 *  una llamada a `readdirSync`/`readdir` con `{recursive: true}` literal, o una
 *  función con nombre que llama a uno de los dos Y a sí misma. NO resuelve a
 *  qué carpeta apunta el recorrido: perseguir `join(repoRoot, "qa", …)`, las
 *  constantes y los bucles sobre `dirs` es el terreno donde un censo nace ciego
 *  a la escritura (#686). En su lugar, TODO recorrido recursivo de `test/`
 *  fuera de `banco-ficheros.ts` se declara en
 *  `data/contract/recorridos-de-test.json` con QUÉ recorre y por qué, y el
 *  padrón no admite uno que diga `qa`. Que el `recorre` diga la verdad lo lee
 *  el revisor: está en `_lo_que_esto_NO_sujeta`.
 *
 *  Los lectores de UNA carpeta del banco sin bajar (`qa/guiones`, lo que
 *  `qa/run.mjs` ve) NO se prohíben: su sujeto es esa carpeta, y un barrido
 *  recursivo que sigue enlaces les cambiaría el significado. Se declaran por
 *  nombre, con su motivo, y la entrada caduca si el fichero deja de leer. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";

const TEST = dirname(fileURLToPath(import.meta.url));
const core = resolve(TEST, "..");
const CONTRATO = join(core, "data", "contract", "recorridos-de-test.json");
/** El dueño: lo único que puede recorrer `qa/` entero. No va en el padrón. */
const DUENO = "banco-ficheros.ts";

const PadronSchema = z
  .object({
    _comment: z.string().min(1),
    _lo_que_esto_NO_sujeta: z.string().min(1),
    recorridos: z.array(
      z
        .object({
          fichero: z.string().min(1),
          sitios: z.number().int().positive(),
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
          porque: z.string().min(10),
        })
        .strict(),
    ),
  })
  .strict();
type Padron = z.infer<typeof PadronSchema>;

const MODULOS_FS = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);
const LECTORES = new Set(["readdirSync", "readdir"]);

/** Los nombres locales de `readdirSync`/`readdir` en este fichero, alias
 *  incluido (`import { readdirSync as leer }`), y los espacios de nombres
 *  (`import * as fs`, `import fs`) por los que se llega a ellos como `fs.x`.
 *  También el destructurado de un `import("node:fs")` dinámico, con o sin
 *  `await`: es como `esperas-de-qa.test.ts` saca el suyo. */
function nombresDelLector(sf: ts.SourceFile): { directos: Set<string>; espacios: Set<string> } {
  const directos = new Set<string>();
  const espacios = new Set<string>();
  const esModuloFs = (e: ts.Expression): boolean => ts.isStringLiteral(e) && MODULOS_FS.has(e.text);
  const destructura = (patron: ts.ObjectBindingPattern): void => {
    for (const el of patron.elements) {
      const importado = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "";
      if (LECTORES.has(importado) && ts.isIdentifier(el.name)) directos.add(el.name.text);
    }
  };
  const visita = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && esModuloFs(n.moduleSpecifier) && n.importClause) {
      const c = n.importClause;
      if (c.name) espacios.add(c.name.text);
      const b = c.namedBindings;
      if (b && ts.isNamespaceImport(b)) espacios.add(b.name.text);
      if (b && ts.isNamedImports(b)) {
        for (const el of b.elements) if (LECTORES.has((el.propertyName ?? el.name).text)) directos.add(el.name.text);
      }
    }
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name)) {
      const ini = ts.isAwaitExpression(n.initializer) ? n.initializer.expression : n.initializer;
      if (ts.isCallExpression(ini) && ini.expression.kind === ts.SyntaxKind.ImportKeyword && ini.arguments[0] && esModuloFs(ini.arguments[0])) {
        destructura(n.name);
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return { directos, espacios };
}

const conRecursivo = (llamada: ts.CallExpression): boolean =>
  llamada.arguments.some(
    (a) =>
      ts.isObjectLiteralExpression(a) &&
      a.properties.some(
        (p) => ts.isPropertyAssignment(p) && p.name.getText() === "recursive" && p.initializer.kind === ts.SyntaxKind.TrueKeyword,
      ),
  );

/** Los SITIOS donde este fuente recorre un directorio de forma recursiva, y
 *  las lecturas que no lo son (las de un lector de carpeta). */
function recorridos(texto: string): { recursivos: number[]; planas: number[] } {
  const sf = ts.createSourceFile("x.ts", texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { directos, espacios } = nombresDelLector(sf);
  const linea = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const esLector = (c: ts.CallExpression): boolean => {
    const e = c.expression;
    if (ts.isIdentifier(e)) return directos.has(e.text);
    return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && espacios.has(e.expression.text) && LECTORES.has(e.name.text);
  };
  const llamadas = (raiz: ts.Node, pred: (c: ts.CallExpression) => boolean): ts.CallExpression[] => {
    const out: ts.CallExpression[] = [];
    const v = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && pred(n)) out.push(n);
      ts.forEachChild(n, v);
    };
    v(raiz);
    return out;
  };
  const recursivos: number[] = [];
  const dentroDeRecursiva = new Set<ts.CallExpression>();
  const visita = (n: ts.Node): void => {
    let nombre: string | null = null;
    let cuerpo: ts.Node | undefined;
    if (ts.isFunctionDeclaration(n) && n.name) {
      nombre = n.name.text;
      cuerpo = n.body;
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      nombre = n.name.text;
      cuerpo = n.initializer.body;
    }
    if (nombre && cuerpo) {
      const lee = llamadas(cuerpo, esLector);
      const n0 = nombre;
      const seLlama = llamadas(cuerpo, (c) => ts.isIdentifier(c.expression) && c.expression.text === n0).length > 0;
      if (lee.length > 0 && seLlama) {
        recursivos.push(linea(n));
        for (const c of lee) dentroDeRecursiva.add(c);
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  const planas: number[] = [];
  for (const c of llamadas(sf, esLector)) {
    if (conRecursivo(c)) recursivos.push(linea(c));
    else if (!dentroDeRecursiva.has(c)) planas.push(linea(c));
  }
  return { recursivos: recursivos.sort((a, b) => a - b), planas };
}

/** Todo `.ts` bajo `test/` (las fixtures también), relativo a `test/`. */
const fuentesDeTest = (): string[] =>
  (readdirSync(TEST, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts")).sort();

/** Un `recorre` que nombra `qa` es una copia del banco con otro nombre. */
const nombraElBanco = (recorre: string): boolean => /(^|[^\w-])qa(\/|$|[^\w-])/.test(recorre);

/** EL PARSE VA FUERA DEL `describe` (#611): dentro, un zod que lanza deja la
 *  suite en `fail 0` y `npm test` verde. */
const padron: Padron = PadronSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const censo = new Map(fuentesDeTest().map((f) => [f, recorridos(readFileSync(join(TEST, f), "utf8"))] as const));

describe("un solo barrido del banco (#704): nadie más recorre qa/ de forma recursiva", () => {
  it("el árbol tiene sujeto: hay recorridos en test/ y el dueño da exactamente uno", () => {
    const total = [...censo.values()].reduce((s, r) => s + r.recursivos.length, 0);
    assert.ok(total >= 5, `el detector ve ${total} recorridos recursivos en test/: ¿se ha roto?`);
    assert.equal(censo.get(DUENO)?.recursivos.length, 1, `${DUENO} tiene que dar UN recorrido: es el barrido`);
    assert.ok(censo.size >= 150, `test/ tiene ${censo.size} fuentes .ts: ¿se ha roto el censo?`);
  });

  it("totalidad: cada recorrido recursivo fuera del dueño está en el padrón con su cifra exacta", () => {
    const medidos = new Map(
      [...censo].filter(([f, r]) => f !== DUENO && r.recursivos.length > 0).map(([f, r]) => [f, r.recursivos] as const),
    );
    const declarados = new Map(padron.recorridos.map((r) => [r.fichero, r.sitios]));
    const fallos: string[] = [];
    for (const [f, lineas] of medidos) {
      const d = declarados.get(f);
      if (d === undefined) fallos.push(`${f}: recorre de forma recursiva (líneas ${lineas.join(", ")}) y no está en el padrón`);
      else if (d !== lineas.length) fallos.push(`${f}: ${lineas.length} recorridos medidos (líneas ${lineas.join(", ")}) contra ${d} declarados`);
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

  it("cada lector de carpeta declarado existe y sigue leyendo sin bajar", () => {
    const fallos = padron.lectores_de_carpeta_de_qa
      .filter((l) => !existsSync(join(TEST, l.fichero)) || (censo.get(l.fichero)?.planas.length ?? 0) === 0)
      .map((l) => `${l.fichero} (${l.carpetas.join(", ")}): ya no lee ninguna carpeta: entrada caducada`);
    assert.deepEqual(fallos, []);
  });

  it("ningún fichero sale dos veces en el padrón", () => {
    for (const lista of [padron.recorridos, padron.lectores_de_carpeta_de_qa]) {
      const vistos = lista.map((r) => r.fichero);
      assert.deepEqual(vistos.filter((f, i) => vistos.indexOf(f) !== i), []);
    }
  });

  it("el zod exige `_lo_que_esto_NO_sujeta` y rechaza un lector que no es de qa/", () => {
    const base = { _comment: "c", _lo_que_esto_NO_sujeta: "n", recorridos: [], lectores_de_carpeta_de_qa: [] };
    assert.equal(PadronSchema.safeParse(base).success, true);
    const { _lo_que_esto_NO_sujeta: _, ...sinLimites } = base;
    assert.equal(PadronSchema.safeParse(sinLimites).success, false, "sin `_lo_que_esto_NO_sujeta` no hay padrón");
    const fuera = { ...base, lectores_de_carpeta_de_qa: [{ fichero: "x.ts", carpetas: ["data/scenes"], porque: "no es del banco" }] };
    assert.equal(PadronSchema.safeParse(fuera).success, false);
  });

  // ── EN NEGATIVO: las formas que el detector SÍ ve, sobre código sintético ──

  it("ve la copia con flatMap que había en tres tests (la que #704 retiró)", () => {
    const viejo = `import { readdirSync } from "node:fs";
const ficherosDelBanco = (dir = join(repoRoot, "qa")): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name.startsWith(".") ? [] : ficherosDelBanco(join(dir, e.name));
    return e.name.endsWith(".mjs") ? [join(dir, e.name)] : [];
  });`;
    assert.deepEqual(recorridos(viejo), { recursivos: [2], planas: [] });
  });

  it("ve la función declarada que se llama a sí misma (la que tenía helpers-del-banco.ts)", () => {
    const viejo = `import { readdirSync } from "node:fs";
export function fuentesDelBanco(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) fuentesDelBanco(join(dir, e.name), out);
  return out;
}`;
    assert.deepEqual(recorridos(viejo).recursivos, [2]);
  });

  it("ve `{recursive: true}`, con alias, con espacio de nombres y destructurado de un import dinámico", () => {
    assert.deepEqual(recorridos(`import { readdirSync } from "node:fs";\nreaddirSync(QA, { recursive: true });`).recursivos, [2]);
    assert.deepEqual(recorridos(`import { readdirSync as leer } from "node:fs";\nleer(QA, { recursive: true });`).recursivos, [2]);
    assert.deepEqual(recorridos(`import * as fs from "node:fs";\nfs.readdirSync(QA, { recursive: true });`).recursivos, [2]);
    assert.deepEqual(recorridos(`import { readdir } from "node:fs/promises";\nawait readdir(QA, { recursive: true });`).recursivos, [2]);
    assert.deepEqual(
      recorridos(`const { readdirSync: r } = await import("node:fs");\nr(QA, { recursive: true });`).recursivos,
      [2],
    );
  });

  it("un lector de carpeta NO es un recorrido, y un readdirSync ajeno a node:fs no cuenta", () => {
    assert.deepEqual(recorridos(`import { readdirSync } from "node:fs";\nconst g = readdirSync(GUIONES).filter((f) => f.endsWith(".mjs"));`), {
      recursivos: [],
      planas: [2],
    });
    assert.deepEqual(recorridos(`import { readdirSync } from "./otro.js";\nreaddirSync(QA, { recursive: true });`), {
      recursivos: [],
      planas: [],
    });
  });

  it("un `recorre` que nombra qa lo rechaza el aserto; uno de otra carpeta, no", () => {
    for (const r of ["qa", "qa/", "qa/guiones", "repo/qa/lib", "data/scenes y qa"]) assert.ok(nombraElBanco(r), r);
    for (const r of ["data/scenes", "nefan-html/src", "docs/agents", "test/ (sonda-de-qa)"]) assert.ok(!nombraElBanco(r), r);
  });

  // ── LÍMITES MEDIDOS: cada punto de `_lo_que_esto_NO_sujeta` ────────────────

  it("LÍMITE MEDIDO (1): el lector sacado de un import dinámico SIN destructurar no se ve", () => {
    assert.deepEqual(
      recorridos(`const fs = await import("node:fs");\nfs.readdirSync(QA, { recursive: true });`).recursivos,
      [],
    );
    assert.deepEqual(recorridos(`(await import("node:fs")).readdirSync(QA, { recursive: true });`).recursivos, []);
  });

  it("LÍMITE MEDIDO (2): `recursive` pasado en una variable no se ve", () => {
    assert.deepEqual(
      recorridos(`import { readdirSync } from "node:fs";\nconst o = { recursive: true };\nreaddirSync(QA, o);`).recursivos,
      [],
    );
  });

  it("LÍMITE MEDIDO (3): la recursión mutua y el recorrido con pila no se ven", () => {
    const mutua = `import { readdirSync } from "node:fs";
function a(d) { for (const e of readdirSync(d)) b(e); }
function b(d) { a(d); }`;
    const pila = `import { readdirSync } from "node:fs";
const pila = [QA];
while (pila.length) for (const e of readdirSync(pila.pop(), { withFileTypes: true })) if (e.isDirectory()) pila.push(e.name);`;
    assert.deepEqual(recorridos(mutua).recursivos, []);
    assert.deepEqual(recorridos(pila).recursivos, []);
  });

  it("LÍMITE MEDIDO (4): los lectores de carpeta no tienen totalidad; hoy hay estos fuera del padrón", () => {
    const declarados = new Set([...padron.lectores_de_carpeta_de_qa.map((l) => l.fichero), DUENO]);
    const sinDeclarar = [...censo].filter(([f, r]) => r.planas.length > 0 && !declarados.has(f)).map(([f]) => f);
    // Leen OTRAS carpetas (data/, fixtures, saves temporales); que uno nuevo de
    // qa/ no se declare pasa en verde. Si la cifra cambia, se reescribe el punto.
    assert.deepEqual(sinDeclarar, [
      "afectado.test.ts",
      "contract-fixtures.test.ts",
      "contract-terms.test.ts",
      "scene-schema.test.ts",
    ]);
  });

  it("LÍMITE MEDIDO (5): el destino no se resuelve; un `recorre` mentiroso pasa", () => {
    const miente = { fichero: "x.ts", sitios: 1, recorre: "data/scenes", porque: "dice data/scenes y recorre join(repoRoot, 'qa')" };
    assert.equal(nombraElBanco(miente.recorre), false);
  });

  it("LÍMITE MEDIDO (6): solo se mira test/; scripts/, labs/ y src/ quedan fuera", () => {
    assert.ok(fuentesDeTest().every((f) => !f.startsWith("..")));
    assert.equal(fuentesDeTest().some((f) => f.includes("scripts/")), false);
  });
});
