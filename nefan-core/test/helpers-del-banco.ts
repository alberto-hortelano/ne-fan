/** Lo que comparten los padrones que recorren el ÁRBOL del banco (`qa/**`).
 *
 *  Nace con el segundo padrón por árbol (`clientes-ws-del-banco.json`, #678):
 *  el primero, `la-consulta-de-movimiento-tiene-dueno.test.ts`, lleva su copia
 *  de `fuentesDelBanco` y de la guardia de JSDoc, y un tercero (el padrón que
 *  cuenta llamadas, tanda X) se escribe a la vez que éste sobre ese mismo
 *  fichero. Importar un `.test.ts` desde otro re-registra sus `describe` en
 *  `node:test`, así que lo compartido vive aquí, sin `describe`, y cada padrón
 *  lo importa. Unificar las copias que quedan es trabajo del coordinador tras
 *  la fusión, no de esta tanda.
 *
 *  No es un `.test.ts` a propósito: `npm test` corre `test/*.test.ts` y esto
 *  no afirma nada por sí mismo. */
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/** Todos los `.mjs` del banco, en ruta relativa a `raiz` con `/`. Se salta
 *  `node_modules`, las capturas y los directorios efímeros de una corrida
 *  (`qa/.tmp/<run>/`), que no son fuente del banco. */
export function fuentesDelBanco(dir: string, raiz: string = dir, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === "node_modules" || e.name === "capturas" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) fuentesDelBanco(p, raiz, out);
    else if (e.name.endsWith(".mjs")) out.push(relative(raiz, p).split(sep).join("/"));
  }
  return out;
}

/** El árbol de un fuente del banco, parseado como JavaScript. */
export function arbolDelBanco(fuente: string): ts.SourceFile {
  return ts.createSourceFile("x.mjs", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

/** JSDoc SÍ entra en el árbol de un fichero `.js`: que la prosa no cuente es
 *  parte del contrato de cada detector, no un efecto colateral de
 *  `forEachChild`, y por eso la guardia tiene nombre. */
export function esProsa(nodo: ts.Node): boolean {
  return nodo.kind >= ts.SyntaxKind.FirstJSDocNode && nodo.kind <= ts.SyntaxKind.LastJSDocNode;
}

/** Recorre el árbol saltándose la prosa. `visita` devuelve `false` para no
 *  bajar por los hijos de ese nodo. */
export function recorre(raiz: ts.Node, visita: (nodo: ts.Node) => boolean | void): void {
  const baja = (nodo: ts.Node): void => {
    if (esProsa(nodo)) return;
    if (visita(nodo) === false) return;
    ts.forEachChild(nodo, baja);
  };
  baja(raiz);
}
