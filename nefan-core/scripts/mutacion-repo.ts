/** El cierre de REPO del ciclo de mutación: git, el tag movible `mutacion-ultima`,
 *  la huella en disco y el coste de un módulo. Es la parte de la familia
 *  `mutacion-*.ts` que sí se deja importar —lo hacen `mutate.ts`, `deuda.ts` y
 *  `test/mutacion-el-reloj-y-el-score.test.ts`—: importado no ejecuta nada, y solo
 *  toca git cuando se le llama. Los otros cinco trozos importan de aquí; éste no
 *  importa de ninguno (#605: el corte va por CIERRE DE LLAMADAS, sin ciclos).
 *
 *  Quién lo mira: `test/afectado.test.ts` (los dos `git diff --name-only` de
 *  aquí llevan `SIN_RENOMBRAR`; la lista de ficheros se DERIVA del instrumento) y
 *  `qa/mutacion-reparto-en-lotes.mjs` (`segundosDe` agrega con MÁXIMO, no con
 *  suma). El resto no lo mira ningún test, como en toda la familia: ver
 *  `mutacion.ts`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { contextoDe, seleccionar, SIN_RENOMBRAR, type Seleccion } from "./afectado.js";
import { lineasDeCodigo } from "./crap-score.js";
import { coreRoot, ficherosMutados, moduloPorId, RUTA_HUELLA, type PlanMutacion } from "./mutation-plan.js";
import {
  costeEstimado,
  HUELLA_VACIA,
  prDelAsunto,
  type CommitDelRango,
  type CrecimientoDeFichero,
  type Huella,
} from "./mutacion-huella.js";

export const raizRepo = resolve(coreRoot, "..");
export const nombrePaquete = relative(raizRepo, coreRoot).split("\\").join("/");
export const TAG = "mutacion-ultima";

export function git(args: string[]): string {
  return execFileSync("git", args, { cwd: raizRepo, encoding: "utf8" }).trim();
}

export function gitLineas(args: string[]): string[] {
  return git(args)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Hash del CONTENIDO del fuente en el commit que se midió — el id de blob que
 *  git ya tiene calculado, sin leer el fichero.
 *
 *  Se pide sobre el commit de la CORRIDA y no sobre el árbol de trabajo: lo que
 *  hay que recordar es de qué código habla esa medida, y el árbol de quien
 *  reparte suele ir por delante. Fail-loud si el commit no está aquí: una
 *  cadena vacía haría el delta incomparable en silencio para toda la corrida. */
export function blobEnCommit(sha: string, ficheroRelativoACore: string): string {
  const ruta = `${sha}:nefan-core/${ficheroRelativoACore}`;
  const r = spawnSync("git", ["rev-parse", ruta], { cwd: raizRepo, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      `no se pudo leer el contenido medido de ${ficheroRelativoACore} en ${sha.slice(0, 7)}: ` +
        `${(r.stderr ?? "").trim() || "git rev-parse falló"}. Sin eso, el delta no sabe si las dos ` +
        `medidas hablan del mismo código (\`git fetch\` si el commit no está en este clon).`,
    );
  }
  return r.stdout.trim();
}

/** El tag, o un error que dice cómo crearlo. Degradarlo a "no hay nada medido"
 *  dejaría a `pendiente` diciendo que no falta nada, que es el verde que no
 *  comprueba nada con otro disfraz. */
export function shaDelTag(): string {
  try {
    return git(["rev-parse", `${TAG}^{commit}`]);
  } catch {
    throw new Error(
      `no existe el tag "${TAG}": sin él no se puede saber qué se midió la última vez. ` +
        `Créalo en el commit de la última corrida conocida (git tag ${TAG} <sha> && git push origin ${TAG}) ` +
        `y vuelve a intentarlo.`,
    );
  }
}

/** Las rutas de git son relativas a la raíz del repo; el plan habla en rutas
 *  relativas a nefan-core. Lo de fuera del paquete queda con `../`, que es como
 *  lo normaliza la traza de imports. */
const aCore = (p: string): string => relative(coreRoot, join(raizRepo, p)).split("\\").join("/");

/** Lo cambiado desde el tag, incluyendo el ÁRBOL DE TRABAJO. Un agente a mitad
 *  de tanda tiene cambios sin commitear, y son justo los que pueden invalidar
 *  una medida: mirar solo lo commiteado daría una frescura optimista. Con
 *  `SIN_RENOMBRAR` (`--no-renames`), como todo `git diff --name-only` del
 *  instrumento: sin él la ruta de ORIGEN de un renombrado ni aparece, y un
 *  `git mv` sin actualizar al importador no forzaría nada (QA de #471). */
export function ficherosDesdeElTag(tag: string): string[] {
  return [
    ...gitLineas(["diff", "--name-only", ...SIN_RENOMBRAR, tag]),
    ...gitLineas(["ls-files", "--others", "--exclude-standard"]),
  ].map(aCore);
}

/** Qué se mediría hoy, con el árbol de trabajo dentro. */
export function seleccionDesdeElTag(plan: PlanMutacion, tag: string): Seleccion {
  return seleccionar(contextoDe(plan, { antes: tag, despues: null }), ficherosDesdeElTag(tag));
}

/** Los commits sin medir, con los módulos que el diff de CADA UNO selecciona.
 *  Eso es la atribución: no «quién escribió esta línea» (`git blame`) sino «qué
 *  cambio pudo mover la suerte de este mutante». */
export function commitsDelRango(plan: PlanMutacion, tag: string, hasta: string): CommitDelRango[] {
  const crudos = gitLineas(["log", "--format=%H\t%s", `${tag}..${hasta}`]);
  return crudos.map((linea) => {
    const [sha, ...resto] = linea.split("\t");
    const asunto = resto.join("\t");
    const ficheros = gitLineas(["diff", "--name-only", ...SIN_RENOMBRAR, `${sha}^`, sha]).map(aCore);
    const sel = seleccionar(contextoDe(plan, { antes: `${sha}^`, despues: sha }), ficheros);
    return {
      sha,
      asunto,
      pr: prDelAsunto(asunto),
      modulos: sel.todos ? plan.modulos.map((m) => m.id) : sel.ids,
    };
  });
}

// ── la huella commiteada ─────────────────────────────────────────────────────

const rutaHuella = (): string => join(coreRoot, RUTA_HUELLA);

export function leerHuella(): Huella {
  const ruta = rutaHuella();
  if (!existsSync(ruta)) return HUELLA_VACIA;
  // Fail-loud: una huella corrupta que se degradara a vacía convertiría a TODOS
  // los módulos en "sin base" y el delta se quedaría mudo sin decir por qué.
  return JSON.parse(readFileSync(ruta, "utf8")) as Huella;
}

export function escribeHuella(h: Huella): void {
  writeFileSync(rutaHuella(), `${JSON.stringify(h, null, 2)}\n`);
}

/** La huella commiteada en UNA revisión cualquiera.
 *
 *  `repartir` siempre usa HEAD (ver abajo), pero `comparar` necesita poder
 *  elegir, y no por comodidad: la huella de HEAD cambia en cuanto otra tanda
 *  reparte, y entonces cualquier fuente tocado entre medias sale `incomparable`
 *  por blob. Como `incomparable` es condición dura, #443 se cerraría con un
 *  `NO SE ADOPTA` que no tiene nada que ver con el runner (QA, H7). El remedio
 *  es comparar contra la huella del commit que midió la base. */
export function huellaEnRevision(rev: string): Huella {
  const ruta = `${nombrePaquete}/${RUTA_HUELLA}`;
  const existe = spawnSync("git", ["cat-file", "-e", `${rev}:${ruta}`], { cwd: raizRepo });
  if (existe.status !== 0) {
    if (rev !== "HEAD") {
      throw new Error(
        `en ${rev} no hay ${RUTA_HUELLA}: o la revisión no existe en este clon (git fetch), o es anterior a ` +
          `que la huella se commiteara. Sin base no hay comparación que valga.`,
      );
    }
    console.log(`(${RUTA_HUELLA} no está en HEAD: primera corrida, todo saldrá SIN BASE)`);
    return HUELLA_VACIA;
  }
  return JSON.parse(git(["show", `${rev}:${ruta}`])) as Huella;
}

/** POR QUÉ `repartir` NO ELIGE REVISIÓN Y SIEMPRE USA HEAD. Es la huella
 *  COMMITEADA, no la del árbol de trabajo, y la diferencia se pagó en la primera
 *  pasada real: `repartir` escribe la huella nueva, así que una SEGUNDA pasada
 *  antes de commitear comparaba contra lo que ella misma acababa de escribir y
 *  el delta se colapsaba a cero — el comentario de la PR salía sin los
 *  supervivientes NUEVOS y sin decir que los había perdido. Con la base en HEAD,
 *  `repartir` es idempotente: correrlo dos veces da el mismo reparto, y «el
 *  delta se ve en el diff» pasa a ser literal (base = HEAD, resultado = árbol de
 *  trabajo). `comparar`, que no escribe, sí puede elegir: ver `huellaEnRevision`.
 *
 *  Que el fichero no esté en HEAD es la primera vez y se dice; que git no pueda
 *  contestar es otra cosa y se lanza. */

/** El coste de un módulo en mutantes, según la última medida que haya de sus
 *  ficheros. Sale de la huella (≈75 KB) y no de los informes (76 MB): es lo que
 *  deja a `pendiente` y al tope de `local` decir un número sin abrir nada. */
export function costeDe(plan: PlanMutacion, huella: Huella, id: string): number | undefined {
  const ficheros = ficherosMutados(moduloPorId(plan, id));
  const medidos = ficheros.map((f) => huella.ficheros[f]).filter(Boolean);
  if (medidos.length === 0) return undefined;
  return medidos.reduce((n, m) => n + m.total, 0);
}

/** Lo que costaría medir HOY ese módulo, para que el tope local no decida con
 *  la foto de la corrida anterior (#429).
 *
 *  Aquí vive solo lo que toca el mundo: sacar del objeto de git el fichero tal
 *  y como estaba cuando se midió —su blob lo guarda la propia huella— y contar
 *  las líneas de código de las dos versiones. La aritmética y la regla de «solo
 *  puede negar» están en `costeEstimado`, que es puro y tiene batería.
 *
 *  `undefined` = no hay ni una fila medida de este módulo, que es el caso que
 *  ya rechaza `permisoLocal` por otro motivo («no se sabe cuánto cuesta»). Un
 *  blob que git no pueda sacar NO se lanza: es un clon superficial o una rama
 *  reescrita, y el gate tiene que seguir funcionando con lo que sí sabe. */
export function estimaCoste(plan: PlanMutacion, huella: Huella, id: string): number | undefined {
  const filas: CrecimientoDeFichero[] = [];
  for (const fichero of ficherosMutados(moduloPorId(plan, id))) {
    const medida = huella.ficheros[fichero];
    if (!medida) continue;
    filas.push({
      fichero,
      total: medida.total,
      lineasMedidas: lineasDeBlob(medida.blob, fichero),
      lineasAhora: lineasEnDisco(fichero),
    });
  }
  return costeEstimado(filas);
}

function lineasDeBlob(blob: string, fichero: string): number | undefined {
  const r = spawnSync("git", ["cat-file", "blob", blob], {
    cwd: raizRepo,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return r.status === 0 ? lineasDeCodigo(r.stdout, fichero).size : undefined;
}

function lineasEnDisco(fichero: string): number | undefined {
  const abs = join(coreRoot, fichero);
  return existsSync(abs) ? lineasDeCodigo(readFileSync(abs, "utf8"), fichero).size : undefined;
}

/** Los segundos de reloj de un módulo según su última medida, con MÁXIMO y no
 *  con suma. El número es del módulo y está repetido en cada una de sus filas
 *  —una corrida de Stryker mide el módulo entero de una vez—, así que sumar
 *  cuadruplicaría un módulo de cuatro ficheros; y cuando las filas vienen de
 *  corridas distintas, el máximo es la cota segura para un presupuesto de
 *  reloj. `undefined` = nadie lo ha cronometrado, y eso viaja hasta el lote
 *  propio en vez de convertirse en un cero. */
export function segundosDe(plan: PlanMutacion, huella: Huella, id: string): number | undefined {
  const medidos = ficherosMutados(moduloPorId(plan, id))
    .map((f) => huella.ficheros[f]?.segundos)
    .filter((s): s is number => typeof s === "number");
  return medidos.length === 0 ? undefined : Math.max(...medidos);
}
