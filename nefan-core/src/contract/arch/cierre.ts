/** El cierre transitivo de imports, para las reglas `cierre` del checker.
 *
 *  Una regla `imports` juzga lo que un fichero ESCRIBE: `^node:` sobre
 *  `nefan-html/src/**` para que el cliente no importe `node:fs`. Pero el cliente
 *  no importa `node:fs`: importa `@nefan-core/src/a.js`, que importa `./b.js`,
 *  que importa `node:fs` — y ese `node:fs` entra en el bundle de Vite igual.
 *  Hasta #359 eso lo sostenía una lista negra de ocho módulos del core escrita
 *  a mano, que perseguía: un módulo nuevo con `node:*` pasaba hasta que alguien
 *  lo añadía. Aquí la pureza se DERIVA del grafo: las entradas son los ficheros
 *  que casan `files`, se recorre por `ImportRef.resolved` y la prohibición se
 *  aplica a todo lo alcanzado. Un módulo que aún no existe queda cubierto el
 *  día que nace.
 *
 *  PURO, como `check.ts`: recibe los ficheros con sus imports ya resueltos
 *  (eso lo hace el colector, `scripts/arch-collect.ts`) y devuelve violaciones.
 *  Así se prueba con `SourceFile[]` sintéticos y tiene batería propia
 *  (`test/arch-cierre.test.ts`) y módulo de mutación propio (`arch-cierre`). */

import type { ArchRule, SourceFile, Violation } from "./check.js";

/** Cómo se llegó a un fichero del cierre: quién lo importa y en qué línea.
 *  `null` para una entrada. */
export interface Arista {
  desde: string;
  line: number;
  /** El colector no encontró el destino en disco (`ImportRef.roto`). */
  roto?: true;
}

/** El cierre desde unas entradas, como mapa `ruta → arista por la que se
 *  alcanzó`. Es una búsqueda en anchura, así que la arista guardada es la del
 *  CAMINO MÁS CORTO desde alguna entrada: el mensaje enseña la ruta más
 *  directa por la que entra lo prohibido, no la primera que se encontró.
 *
 *  Un destino que no está en `files` entra en el mapa (para que se pueda
 *  nombrar y se pueda reconstruir su camino) pero no se expande: no hay nada
 *  que leer. Quien lo denuncia es `violacionesDeCierre`. */
export function cierreDesde(
  entradas: readonly string[],
  files: ReadonlyMap<string, SourceFile>,
): Map<string, Arista | null> {
  const padres = new Map<string, Arista | null>();
  const cola: string[] = [];
  for (const e of entradas) {
    if (padres.has(e)) continue;
    padres.set(e, null);
    cola.push(e);
  }
  for (let i = 0; i < cola.length; i++) {
    const actual = cola[i];
    const file = files.get(actual);
    if (!file) continue;
    for (const imp of file.imports ?? []) {
      if (imp.resolved === undefined || padres.has(imp.resolved)) continue;
      padres.set(imp.resolved, imp.roto ? { desde: actual, line: imp.line, roto: true } : { desde: actual, line: imp.line });
      cola.push(imp.resolved);
    }
  }
  return padres;
}

/** El camino desde la entrada hasta `ruta`, ambas incluidas. */
export function caminoHasta(padres: ReadonlyMap<string, Arista | null>, ruta: string): string[] {
  const camino = [ruta];
  let arista = padres.get(ruta);
  while (arista) {
    camino.push(arista.desde);
    arista = padres.get(arista.desde);
  }
  return camino.reverse();
}

/** Las violaciones de una regla `cierre`: un import prohibido en CUALQUIER
 *  fichero alcanzado desde las entradas, denunciado en el fichero que lo
 *  escribe y con el camino entero en el detalle.
 *
 *  Y el fail-loud del propio grafo: un destino resuelto que no está entre los
 *  ficheros escaneados es violación, no poda. Sin esto, un import a un fichero
 *  fuera de `scan.roots` cortaría la búsqueda en silencio y la regla saldría
 *  verde sin haber mirado lo que hay detrás. Son DOS mensajes, porque son dos
 *  arreglos: si el colector no encontró el fichero (`roto`), el import está
 *  mal y se repara el import; si existe, el checker no lo escanea y se amplía
 *  el escaneo (QA de #359, hallazgo 6: con una sola frase el lector probaba
 *  antes a ampliar `scan.roots` cuando lo que tenía era un typo). */
export function violacionesDeCierre(
  rule: ArchRule,
  entradas: readonly string[],
  files: ReadonlyMap<string, SourceFile>,
): Violation[] {
  const cierre = rule.cierre!;
  const forbid = cierre.forbid.map((p) => new RegExp(p));
  const padres = cierreDesde(entradas, files);
  const out: Violation[] = [];
  for (const [ruta, arista] of padres) {
    const file = files.get(ruta);
    if (!file) {
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        path: arista ? arista.desde : ruta,
        line: arista ? arista.line : 1,
        detail:
          (arista?.roto
            ? `el import está roto: "${ruta}" no existe en disco (buscado como .ts, .mts, tal cual e index.ts). `
            : `"${ruta}" existe pero el checker no lo escanea: amplía scan.roots o scan.files en arch-rules.json. `) +
          `Sin esto el grafo se podaría en silencio. Camino: ${caminoHasta(padres, ruta).join(" → ")}`,
      });
      continue;
    }
    for (const imp of file.imports ?? []) {
      if (!forbid.some((re) => re.test(imp.spec))) continue;
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        path: file.path,
        line: imp.line,
        detail: `"${imp.spec}" entra en ${cierre.quien} por: ${[...caminoHasta(padres, ruta), imp.spec].join(" → ")}`,
      });
    }
  }
  return out;
}
