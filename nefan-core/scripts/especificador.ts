/** Cómo un especificador de import se convierte en un fichero del repo. ÚNICO.
 *
 *  Tres piezas de `scripts/` leen imports con `ts.preProcessFile` y tienen que
 *  contestar «¿a qué fichero apunta `./foo.js`?» con la misma lista de
 *  candidatos: el plan de mutación (`mutation-plan.ts`), el selector de lo
 *  afectado (`afectado.ts`, que además compara SIN disco porque el fichero ya
 *  no está) y el colector del checker de fronteras (`arch-collect.ts`). Hasta
 *  #359 había dos copias que ya divergían en un candidato (`.mts`); la tercera
 *  habría sido la que se olvidara de actualizar. Aquí vive la lista y quien la
 *  necesite la importa.
 *
 *  La lista, en orden: el fuente importa con extensión `.js` (ESM) pero en
 *  disco es `.ts` (o `.mts`); `.ts` añadido para el que importa sin
 *  extensión; la ruta tal cual (un `.json`, un `.css`, un `.ts` explícito); y
 *  el `index.ts` del directorio. */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

/** A qué ficheros PODRÍA apuntar la ruta base de un especificador, sin mirar
 *  el disco. Decide quien compare. */
export function candidatosDe(baseAbs: string): string[] {
  const sinJs = baseAbs.replace(/\.js$/, "");
  return [`${sinJs}.ts`, `${sinJs}.mts`, `${baseAbs}.ts`, baseAbs, join(baseAbs, "index.ts")];
}

/** El primer candidato que existe en disco y es un FICHERO (un directorio con
 *  el mismo nombre no cuenta: su `index.ts` va después en la lista). */
export function primeroEnDisco(baseAbs: string): string | undefined {
  for (const c of candidatosDe(baseAbs)) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return undefined;
}

/** La ruta base de un especificador RELATIVO, absoluta; `undefined` para un
 *  paquete o un builtin (`three`, `node:fs`), que no viven en el repo. */
export function baseRelativa(desdeAbs: string, especificador: string): string | undefined {
  if (!especificador.startsWith(".")) return undefined;
  return resolve(dirname(desdeAbs), especificador);
}

/** Un alias de `compilerOptions.paths`: `prefijo` es la clave sin el `*`
 *  (`@nefan-core/`) y `destinoAbs` el directorio al que apunta, ya resuelto
 *  contra `baseUrl`. `dirAbs` es el directorio del tsconfig: el alias solo vale
 *  para los ficheros que viven bajo él. */
export interface AliasDePaths {
  prefijo: string;
  destinoAbs: string;
  dirAbs: string;
}

/** Los alias que declara un `tsconfig.json`, leídos del fichero y no copiados.
 *
 *  Solo se entiende la forma `x/*` → `["dir/*"]` con un único destino, que es
 *  la que usa el cliente. Cualquier otra forma LANZA: un alias que este lector
 *  no entendiera resolvería a «paquete», y el cierre de imports lo podaría en
 *  silencio — que es exactamente el hueco que el checker existe para cerrar. */
export function aliasDeTsconfig(tsconfigAbs: string): AliasDePaths[] {
  const leido = ts.readConfigFile(tsconfigAbs, ts.sys.readFile);
  if (leido.error) {
    throw new Error(`${tsconfigAbs}: ${ts.flattenDiagnosticMessageText(leido.error.messageText, "\n")}`);
  }
  const opciones = (
    leido.config as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
  ).compilerOptions;
  const dirAbs = dirname(tsconfigAbs);
  const base = resolve(dirAbs, opciones?.baseUrl ?? ".");
  const out: AliasDePaths[] = [];
  for (const [clave, destinos] of Object.entries(opciones?.paths ?? {})) {
    if (!clave.endsWith("/*") || destinos.length !== 1 || !destinos[0].endsWith("/*")) {
      throw new Error(
        `${tsconfigAbs}: el alias "${clave}" → ${JSON.stringify(destinos)} no tiene la forma "x/*" → ["dir/*"], ` +
          "la única que sabe resolver scripts/especificador.ts — amplía el lector antes de usarlo",
      );
    }
    out.push({ prefijo: clave.slice(0, -1), destinoAbs: resolve(base, destinos[0].slice(0, -2)), dirAbs });
  }
  return out;
}

/** La ruta base de un especificador que empieza por un alias APLICABLE al
 *  fichero que importa (vive bajo el directorio del tsconfig que lo declara);
 *  `undefined` si ningún alias casa. */
export function baseDeAlias(
  desdeAbs: string,
  especificador: string,
  alias: readonly AliasDePaths[],
): string | undefined {
  for (const a of alias) {
    if (!especificador.startsWith(a.prefijo)) continue;
    if (!desdeAbs.startsWith(a.dirAbs + "/") && desdeAbs !== a.dirAbs) continue;
    return join(a.destinoAbs, especificador.slice(a.prefijo.length));
  }
  return undefined;
}
