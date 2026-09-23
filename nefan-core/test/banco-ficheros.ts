/** EL barrido del banco: una sola respuesta a «qué ficheros hay bajo `qa/`»,
 *  para TODO test que recorra `qa/` entero —el padrón de sondas de movimiento,
 *  la lista blanca de extensiones, los padrones de esperas, del cortafuegos del
 *  tile, de clientes WS y de saltos—. Desde #704 es el ÚNICO recorrido
 *  recursivo de `qa/` bajo `test/`: `un-solo-barrido-del-banco.test.ts` pone
 *  rojo cualquier otro que no esté declarado en
 *  `data/contract/recorridos-de-test.json`, y ese padrón no admite uno que
 *  recorra `qa/`. Quien lea UNA carpeta del banco sin bajar (lo que `qa/run.mjs`
 *  ve en `guiones/`) no pasa por aquí: su sujeto es esa carpeta, no el banco.
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
 *  `.ts` ahí. Lo que esto deja fuera —un `.mjs` en esos tres directorios no lo
 *  ve NINGÚN candado que consuma el barrido— está medido en el punto (6) de
 *  `_lo_que_esto_NO_sujeta` de `data/contract/recorridos-de-test.json`, y cada
 *  padrón consumidor lo dice en el suyo y remite ahí (el de sondas, en su
 *  punto (7)).
 *
 *  ## Symlinks: valen por lo que apuntan
 *
 *  `readdirSync(…, {withFileTypes: true})` da `isDirectory() === false` para
 *  un enlace, sea a lo que sea. Aquí se resuelve con `statSync`:
 *
 *   · Un enlace a DIRECTORIO se recorre, con su nombre de enlace como prefijo,
 *     **solo si su ruta real sigue bajo la raíz del barrido**: un
 *     `qa/fuera -> ../nefan-core/src` convertiría `npm test` en un rastreo de
 *     disco (la re-QA lo midió: 154 foráneos de golpe). El que sale de `qa/`
 *     se SALTA y aquí queda dicho: es el único enlace que el barrido no
 *     recorre, y nada lo señala.
 *   · Un enlace a FICHERO es un fichero con EL NOMBRE DEL ENLACE —que es lo
 *     que escribe un `import`— y ADEMÁS con su ruta real (`real`), porque Node
 *     resuelve el import por `realpath` y aplica la extensión REAL: un
 *     `x.mjs -> y.ts` se ejecuta como TypeScript (medido por la re-QA:
 *     `NODE-EJECUTA-TS`). La lista blanca juzga las dos extensiones. El enlace
 *     a fichero que sale de `qa/` NO se salta: se lista con su `real` y se
 *     juzga igual, que es lo que Node haría con él.
 *   · Un enlace ROTO (`ENOENT`) o CÍCLICO sobre sí mismo (`ELOOP`) se devuelve
 *     como fichero sin `real`, para que quien juzgue lo vea y diga qué hacer:
 *     callárselo sería el `return []` que oculta un fallo, y dejar que `ELOOP`
 *     reviente el proceso era un rojo que no decía nada (re-QA).
 *   · Los ciclos por directorio (`lib/loop -> ..`) se cortan por `realpathSync`
 *     sobre la cadena de ANCESTROS de la recursión, no sobre todo lo visitado:
 *     un guardia de «ya visto» global escondía el directorio real cuando su
 *     enlace ordenaba antes que él. Consecuencia declarada: un enlace a un
 *     HERMANO ya recorrido (`qa/guiones2 -> guiones`) se recorre otra vez y
 *     sale por duplicado —para el padrón, diez `qa/guiones2/…: N contra 0`—.
 *     Dirección ROJO y ruidosa el mismo día; no es un verde que tapa. */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Los directorios que NO son banco, por nombre. Ver la cabecera. */
export const SALTOS_DEL_BANCO: ReadonlySet<string> = new Set(["node_modules", ".tmp", "capturas"]);

export interface FicheroDelBanco {
  /** Relativa a la raíz del barrido, con `/`. Para un enlace, el nombre del enlace. */
  ruta: string;
  /** Solo para un enlace a fichero: su ruta REAL absoluta, con la extensión que Node ejecuta. */
  real: string | null;
}

const posix = (p: string): string => p.split(sep).join("/");

/** TODOS los ficheros bajo `dir`, ordenados, sin filtrar por extensión y
 *  saltando solo `saltar` (y el enlace a directorio que sale de `dir`). */
export function ficherosDelBanco(dir: string, saltar: ReadonlySet<string> = SALTOS_DEL_BANCO): FicheroDelBanco[] {
  const out: FicheroDelBanco[] = [];
  const raizReal = realpathSync(dir);
  const ancestros = new Set<string>([raizReal]);
  const baja = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      const ruta = posix(relative(dir, p));
      if (!e.isSymbolicLink()) {
        if (!e.isDirectory()) out.push({ ruta, real: null });
        else if (!saltar.has(e.name)) baja(p);
        continue;
      }
      let esDirectorio: boolean;
      try {
        esDirectorio = statSync(p).isDirectory();
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ELOOP") throw err;
        out.push({ ruta, real: null }); // roto o cíclico sobre sí mismo: sale con su nombre
        continue;
      }
      const real = realpathSync(p);
      if (!esDirectorio) {
        out.push({ ruta, real });
        continue;
      }
      if (saltar.has(e.name)) continue;
      if (real !== raizReal && !real.startsWith(raizReal + sep)) continue; // sale de la raíz: no se rastrea el disco
      if (ancestros.has(real)) continue; // ciclo por directorio: `lib/loop -> ..`
      ancestros.add(real);
      baja(p);
      ancestros.delete(real);
    }
  };
  baja(dir);
  return out;
}

/** Los `.mjs` del barrido, por su ruta: lo que el banco EJECUTA. Que no haya
 *  otra extensión ejecutable bajo `qa/` —tampoco detrás de un enlace— lo
 *  canda la lista blanca. */
export function fuentesDelBanco(dir: string): string[] {
  return ficherosDelBanco(dir)
    .map((f) => f.ruta)
    .filter((f) => f.endsWith(".mjs"));
}
