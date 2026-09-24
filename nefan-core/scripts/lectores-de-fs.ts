/** Qué función de `node:fs` es el callee de una llamada, POR NOMBRE (#727).
 *
 *  Un solo reconocedor para los dos detectores que leen `readdirSync` y
 *  compañía por el árbol: el selector de la mutación (`analizaLectura`, en
 *  `scripts/mutation-plan.ts`: qué directorio DESCUBRE un fichero) y el barrido
 *  del banco (`recorridos`, en `test/un-solo-barrido-del-banco.test.ts`: quién
 *  RECORRE una carpeta). Hasta #727 cada uno tenía el suyo y veían formas
 *  distintas: el selector no veía `const { readdirSync: r } = await
 *  import("node:fs")` ni `const leer = readdirSync`, y no lo decía —cero
 *  directorios y cero ciegos—; y contaba como lector un `readdirSync` importado
 *  de `./mio`. Vive en `scripts/` porque los scripts no importan de `test/`.
 *
 *  Lo que se comparte es SOLO el nombre: qué es un lector, un glob o una
 *  apertura, qué hace `recursive` y a qué carpeta apunta el argumento son de
 *  cada detector. Las formas que ve y las que no están en UNA tabla,
 *  `test/formas-de-nombrar-fs.ts`, que leen las dos baterías.
 *
 *  ## Qué ve
 *
 *  El nombre exportado de fs al que llega un callee por: import con nombre
 *  (con `as`), de espacio (`* as fs`), por defecto e `import fs = require()`;
 *  `node:fs/promises` y `fs.promises`; `import()` (con `await`, destructurado,
 *  o con `.then((fs) => …)`), `require()` —el global o el que devuelve
 *  `createRequire`, siempre que se llame `require`— y
 *  `process.getBuiltinModule()`, con el especificador entre comillas o en una
 *  plantilla sin huecos; destructurado de un espacio; asignación a otro nombre,
 *  encadenada (punto fijo); corchetes con literal (`fs["readdirSync"]`) y la
 *  llamada opcional (`readdirSync?.()`).
 *
 *  ## Qué NO ve (LÍMITE MEDIDO en las dos baterías, por la misma tabla)
 *
 *  Es POR NOMBRE y SIN ÁMBITOS: dentro del fichero, un identificador que se
 *  llama como un lector ligado en cualquier parte cuenta como ese lector, y uno
 *  que no está ligado a fs en el fichero no cuenta. Así que no ve: el lector
 *  pasado como VALOR a otra función que lo llama con otro nombre
 *  (`aplica(readdirSync)`); el re-export desde otro fichero (`import {
 *  readdirSync } from "./helper-que-reexporta.js"`, que es la misma forma que
 *  un `readdirSync` ajeno y no se puede distinguir sin seguir el import); un
 *  `require` con otro nombre (`const pide = createRequire(…)`); un receptor que
 *  llega de fuera (`function lee(fs) { fs.readdirSync(…) }`), un objeto de
 *  dependencias (`const io = { readdirSync }; io.readdirSync(…)`) o un campo
 *  (`this.fs.readdirSync`); lo que no es node:fs (`fs-extra`, `graceful-fs`,
 *  los paquetes `glob`/`tinyglobby`, `import.meta.glob`); corchetes con una
 *  expresión; y el shell (`execSync("find …")`). El selector NO las calla:
 *  una llamada que se llama como un lector y que esto no ata a fs la cuenta
 *  CIEGA (QA de BH, H1). El barrido no tiene ciegos: para él son invisibles.
 *
 *  ## Quién lo mide
 *
 *  Nadie más que sus dos baterías: ni esto ni `mutation-plan.ts` están en el
 *  perímetro de CRAP ni en el de mutación (viven en `scripts/`, fuera del
 *  núcleo puro), así que el selector que decide qué NO se mide no se mide él.
 *  La red son la tabla compartida y el oráculo independiente
 *  `qa/el-selector-ve-lo-que-la-bateria-abre.mjs`, que NO usa este reconocedor
 *  a propósito. */
import ts from "typescript";

export const MODULOS_FS = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);

/** Quita lo que envuelve a una expresión sin cambiar su valor. */
export function desnuda(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isAwaitExpression(x) || ts.isNonNullExpression(x)) {
    x = x.expression;
  }
  return x;
}

const nombreDePropiedad = (n: ts.PropertyName | ts.BindingName | undefined): string | null =>
  n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

const esModuloFs = (e: ts.Expression | undefined): boolean =>
  !!e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && MODULOS_FS.has(e.text);

/** `import("node:fs")`, `require("node:fs")` (también el de `createRequire`) y
 *  `process.getBuiltinModule("node:fs")`. */
function cargaFs(e: ts.Expression): boolean {
  const x = desnuda(e);
  if (!ts.isCallExpression(x)) return false;
  const f = x.expression;
  const llama =
    f.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(f) && f.text === "require") ||
    (ts.isPropertyAccessExpression(f) && f.name.text === "getBuiltinModule" && ts.isIdentifier(f.expression) && f.expression.text === "process");
  return llama && esModuloFs(x.arguments[0]);
}

/** El nombre de la propiedad a la que accede `x.nombre` o `x["nombre"]`. */
function accesoA(e: ts.Expression): { objeto: ts.Expression; nombre: string } | null {
  if (ts.isPropertyAccessExpression(e)) return { objeto: e.expression, nombre: e.name.text };
  if (ts.isElementAccessExpression(e) && (ts.isStringLiteral(e.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(e.argumentExpression))) {
    return { objeto: e.expression, nombre: e.argumentExpression.text };
  }
  return null;
}

/** Devuelve, para ESTE fichero, la función que contesta a qué export de fs
 *  apunta una expresión (`"readdirSync"`, `"readFile"`, `"globSync"`…) o
 *  `null` si no apunta a ninguno. El módulo entero (`fs`, `fs.promises`) no es
 *  una función: da `null`. */
export function lectorDeFs(sf: ts.SourceFile): (callee: ts.Expression) => string | null {
  const todos: ts.Node[] = [];
  const junta = (n: ts.Node): void => {
    todos.push(n);
    ts.forEachChild(n, junta);
  };
  junta(sf);

  /** Nombre local → export de fs al que apunta. */
  const directos = new Map<string, string>();
  /** Nombres locales que son el módulo entero (o `promises`). */
  const espacios = new Set<string>();

  const esEspacio = (e: ts.Expression): boolean => {
    const x = desnuda(e);
    if (ts.isIdentifier(x)) return espacios.has(x.text);
    const a = accesoA(x);
    if (a) return a.nombre === "promises" && esEspacio(a.objeto);
    return cargaFs(x);
  };
  const exportDe = (e: ts.Expression): string | null => {
    const x = desnuda(e);
    if (ts.isIdentifier(x)) return directos.get(x.text) ?? null;
    const a = accesoA(x);
    if (a && a.nombre !== "promises" && esEspacio(a.objeto)) return a.nombre;
    return null;
  };
  const liga = (nombre: string, importado: string): void => {
    if (importado === "promises") espacios.add(nombre);
    else directos.set(nombre, importado);
  };
  const ligaPatron = (patron: ts.BindingName): void => {
    if (ts.isIdentifier(patron)) espacios.add(patron.text);
    else if (ts.isObjectBindingPattern(patron)) {
      for (const el of patron.elements) {
        const importado = nombreDePropiedad(el.propertyName) ?? nombreDePropiedad(el.name);
        if (importado && ts.isIdentifier(el.name)) liga(el.name.text, importado);
      }
    }
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
      if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && esModuloFs(n.moduleReference.expression)) {
        espacios.add(n.name.text);
      }
      if (ts.isVariableDeclaration(n) && n.initializer) {
        if (esEspacio(n.initializer)) ligaPatron(n.name);
        else {
          const e = exportDe(n.initializer);
          if (e !== null && ts.isIdentifier(n.name)) directos.set(n.name.text, e);
        }
      }
      // `import("node:fs").then((fs) => …)`: el primer parámetro es el módulo.
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "then" && cargaFs(n.expression.expression)) {
        const cb = n.arguments[0];
        const p = cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) ? cb.parameters[0] : undefined;
        if (p) ligaPatron(p.name);
      }
    }
  }
  return exportDe;
}
