/** EL barrido del banco: una sola respuesta a «qué ficheros hay bajo `qa/`»,
 *  compartida por el padrón de sondas de movimiento
 *  (`la-consulta-de-movimiento-tiene-dueno.test.ts`) y por la lista blanca de
 *  extensiones (`qa-lib-tiene-quien-lo-mire.test.ts`).
 *
 *  Nació de la QA de #686 (M-1): cada test tenía su `readdirSync` con SALTOS
 *  DISTINTOS —el padrón saltaba `capturas/` y todo directorio con punto; la
 *  lista blanca, solo `.tmp/`—, así que un `qa/capturas/x.mjs` con
 *  `probeCollide` era invisible para el padrón y legal para la lista blanca, y
 *  un `qa/.oculto/x.mjs` igual. Dos barridos son dos definiciones de «banco».
 *
 *  ## Lo que salta, con su motivo — y SOLO esto
 *
 *   · `node_modules/`: dependencias, no banco.
 *   · `.tmp/`: el disco efímero de una corrida (`qa/.tmp/<run>/`, con su
 *     `.bloques/` de locks dentro).
 *   · `capturas/`: el arte regenerable de las corridas. ~15.000 PNG por
 *     checkout —recorrerlo lo pagaría cada `npm test`— y el symlink
 *     `ultima -> <run>` que `qa/run.mjs` reescribe al terminar cada corrida
 *     (B-1 de la QA de #686: la lista blanca lo señalaba como fichero sin
 *     extensión y estaba ROJA en todo checkout donde se hubiera corrido el
 *     banco). `arch-rules.json` lo declara árbol regenerable que ningún
 *     escaneo debe recorrer, por el mismo motivo.
 *
 *  El salto es por NOMBRE de directorio, a cualquier profundidad, como el
 *  `ignore` de `arch-rules.json`. Cualquier OTRO directorio con punto
 *  (`qa/.oculto/`) se barre: «todo lo que empiece por punto» dejaba pasar un
 *  `.ts` ahí. Lo que esto deja fuera está escrito en el punto (7) de
 *  `_lo_que_esto_NO_sujeta` del padrón: un `.mjs` en esos tres directorios no
 *  lo ve ninguno de los dos candados.
 *
 *  ## Symlinks: valen por lo que apuntan
 *
 *  `readdirSync(…, {withFileTypes: true})` da `isDirectory() === false` para
 *  un enlace, sea a lo que sea. Aquí se resuelve con `statSync`: un enlace a
 *  directorio SE RECORRE (con su nombre de enlace como prefijo), un enlace a
 *  fichero es un fichero con EL NOMBRE DEL ENLACE —que es lo que escribe un
 *  `import`—, y un enlace ROTO se devuelve como fichero para que quien juzgue
 *  lo vea: callárselo sería el `return []` que oculta un fallo. Los ciclos se
 *  cortan por `realpathSync` sobre la cadena de ANCESTROS de la recursión, no
 *  sobre todo lo visitado: un guardia de «ya visto» global escondía el
 *  directorio real cuando su enlace ordenaba antes que él. */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Los directorios que NO son banco, por nombre. Ver la cabecera. */
export const SALTOS_DEL_BANCO: ReadonlySet<string> = new Set(["node_modules", ".tmp", "capturas"]);

/** TODOS los ficheros bajo `dir` (ruta relativa a `dir`, con `/`, ordenados),
 *  sin filtrar por extensión y saltando solo `saltar`. */
export function ficherosDelBanco(dir: string, saltar: ReadonlySet<string> = SALTOS_DEL_BANCO): string[] {
  const out: string[] = [];
  const ancestros = new Set<string>([realpathSync(dir)]);
  const baja = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      let esDirectorio = e.isDirectory();
      if (e.isSymbolicLink()) {
        try {
          esDirectorio = statSync(p).isDirectory();
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          esDirectorio = false; // enlace roto: sale como fichero, con su nombre
        }
      }
      if (!esDirectorio) {
        out.push(relative(dir, p).split(sep).join("/"));
        continue;
      }
      if (saltar.has(e.name)) continue;
      const real = realpathSync(p);
      if (ancestros.has(real)) continue; // ciclo por symlink: `lib/loop -> ..`
      ancestros.add(real);
      baja(p);
      ancestros.delete(real);
    }
  };
  baja(dir);
  return out;
}

/** Los `.mjs` del barrido: lo que el banco EJECUTA. Que no haya otra
 *  extensión ejecutable bajo `qa/` lo canda la lista blanca. */
export function fuentesDelBanco(dir: string): string[] {
  return ficherosDelBanco(dir).filter((f) => f.endsWith(".mjs"));
}
