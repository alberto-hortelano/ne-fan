/** `npm run mutacion -- comparar` — la comparación EN SECO: mira y no toca.
 *
 *  POR QUÉ ES UN VERBO Y NO UNA BANDERA DE `repartir`. Hasta esta tanda, el
 *  único verbo que comparaba era `repartir`, y `repartir` acaba en
 *  `escribeHuella` y CI le mueve el tag detrás. O sea: medir una corrida con un
 *  instrumento nuevo DESTRUÍA la base contra la que había que compararla. La
 *  regla dura de #443 —«si un solo score se mueve fichero a fichero, no se
 *  adopta»— era inaplicable por construcción, que es la peor forma de un
 *  criterio: la que se cumple en verde sin comprobar nada.
 *
 *  Una bandera `--en-seco` en un verbo que escribe habría sido más barata y es
 *  exactamente el fallo a impedir: una bandera se olvida, y el olvido sale caro
 *  una sola vez. El precedente de la casa es `lotes`, que «sin flags solo
 *  imprime». Aquí se va un paso más allá y el fichero no PUEDE escribir: no
 *  importa nada que escriba, y hay una regla de `arch-rules.json`
 *  (`comparar-no-escribe`, severidad `error`) que lo comprueba en cada
 *  `npm test`, más un invariante en `qa/mutacion-cableado-en-negativo.mjs` que
 *  corre el verbo de verdad y exige la huella byte a byte igual, el tag quieto y
 *  `git status` limpio.
 *
 *  SE IMPORTA EL ESPACIO DE NOMBRES DE `node:fs` A PROPÓSITO. Con un
 *  `import { readFileSync }` selectivo, añadir una escritura obligaría a tocar
 *  DOS sitios (la línea de import y la llamada), y el candado de QA estaría
 *  probándose contra una rotura que nadie escribiría por accidente. Con el
 *  espacio de nombres, lo único que separa a este fichero de escribir es la
 *  regla — que es donde se quiere que esté.
 *
 *  Lo que decide algo (el veredicto de adopción, el recuento de los mutantes
 *  clasificados por el reloj) vive en `mutacion-huella.ts`, puro y con batería.
 *  Aquí solo queda leer informes e imprimir.
 */
import * as fs from "node:fs";
import { join, resolve } from "node:path";

import { coreRoot } from "./mutation-plan.js";
import {
  estadoLegible,
  movimientosDeReloj,
  timeoutsDeFichero,
  totalDeReloj,
  veredictoDeAdopcion,
  type DeltaDeFichero,
  type MutanteMedido,
  type RelojDeFichero,
} from "./mutacion-huella.js";

/** Un módulo de la corrida nueva con el delta de sus ficheros — la MISMA
 *  estructura que construye `repartir`, recibida ya calculada. Este fichero no
 *  vuelve a calcular el delta: dos cálculos gemelos del mismo delta es el fallo
 *  que `mutacion-huella.ts` ya documenta de los dos ternarios de
 *  `estadoLegible`. */
export interface ModuloComparado {
  modulo: string;
  ficheros: readonly DeltaDeFichero[];
}

export interface ComparacionEnSeco {
  corrida: {
    run_id: string;
    sha: string;
    desde: string;
    origen: string;
    /** Lo que dictamina `veredictoDeCorrida`: una corrida a la que le faltan
     *  módulos no puede sostener un «no se movió nada». */
    completa: boolean;
    porque: string;
  };
  modulos: readonly ModuloComparado[];
  /** Huellas de los mutantes que el RELOJ clasificó en ESTA corrida, por
   *  fichero. Salen del mismo recorrido de informes que el delta. */
  timeouts: Readonly<Record<string, readonly string[]>>;
  /** Directorio con los informes de la corrida BASE, para poder contar los
   *  movimientos de `Timeout`. Sin él no hay bloque: la huella no los guarda. */
  dirBase?: string;
}

interface InformeCrudo {
  files: Record<string, { mutants: MutanteMedido[] }>;
}

/** Los `Timeout` de un módulo en la corrida base, por fichero. `undefined` =
 *  esa corrida no midió este módulo, que NO es lo mismo que «no tuvo ninguno»:
 *  con cero, todos los de ahora se leerían como `otro → Timeout`. */
function timeoutsDeLaBase(dir: string, modulo: string): Record<string, string[]> | undefined {
  const ruta = join(dir, `${modulo}.json`);
  if (!fs.existsSync(ruta)) return undefined;
  const informe = JSON.parse(fs.readFileSync(ruta, "utf8")) as InformeCrudo;
  const out: Record<string, string[]> = {};
  for (const [fichero, info] of Object.entries(informe.files)) {
    out[fichero] = timeoutsDeFichero(fichero, info.mutants);
  }
  return out;
}

const columnas = (celdas: readonly (string | number)[], anchos: readonly number[]): string =>
  `  ${celdas.map((c, i) => (i === 0 ? String(c).padEnd(anchos[i]) : String(c).padStart(anchos[i]))).join(" ")}`;

const ANCHOS = [30, 6, 6, 12, 8, 8, 8];

function imprimeDeltas(modulos: readonly ModuloComparado[]): void {
  for (const m of modulos) {
    console.log(`  ${m.modulo}`);
    for (const d of m.ficheros) {
      console.log(`    ${d.fichero}  ${d.vivos.length} vivos de ${d.total} — ${estadoLegible(d)}`);
    }
  }
}

/** El bloque de los mutantes que clasifica el reloj. Va al FINAL y aparte: se
 *  pega literal en #443 y NO se resta del veredicto. */
function imprimeReloj(c: ComparacionEnSeco): void {
  console.log(`\n${"─".repeat(78)}`);
  console.log("MUTANTES CLASIFICADOS POR EL RELOJ (`Timeout`) — bloque aparte, NO se resta del veredicto");
  const totalAhora = Object.values(c.timeouts).reduce((n, t) => n + t.length, 0);
  if (c.dirBase === undefined) {
    console.log(
      `\n  esta corrida trae ${totalAhora} mutante(s) clasificados por el reloj, y NO hay con qué compararlos:\n` +
        `  la huella guarda \`vivos\` y \`total\`, y ahí un Timeout es indistinguible de un Killed.\n` +
        `  Pásale los informes de la corrida base:  npm run mutacion -- comparar --timeouts reports/mutation-base\n` +
        `  (si se perdieron: gh run download <run-id> -n informe-mutacion -D reports/mutation-base)`,
    );
    return;
  }
  const dir = resolve(coreRoot, c.dirBase);
  console.log(`  base: ${dir}\n`);
  console.log(columnas(["módulo", "base", "ahora", "T→detectado", "T→vivo", "otro→T", "T→T"], ANCHOS));
  const filasGlobales: RelojDeFichero[] = [];
  const sinBase: string[] = [];
  for (const m of c.modulos) {
    const base = timeoutsDeLaBase(dir, m.modulo);
    if (base === undefined) {
      sinBase.push(m.modulo);
      continue;
    }
    const filas = m.ficheros
      // Solo los ficheros que las DOS medidas tienen: con uno que la base no
      // midió, sus Timeout de hoy saldrían como `otro → Timeout` sin que nadie
      // haya cambiado nada.
      .filter((d) => base[d.fichero] !== undefined)
      .map((d) => movimientosDeReloj(d.fichero, base[d.fichero], c.timeouts[d.fichero] ?? [], d.vivos));
    filasGlobales.push(...filas);
    const t = totalDeReloj(filas);
    if (t.base === 0 && t.ahora === 0) continue;
    console.log(columnas([m.modulo, t.base, t.ahora, t.aDetectado, t.aVivo, t.aTimeout, t.siguen], ANCHOS));
  }
  const total = totalDeReloj(filasGlobales);
  console.log(columnas(["TOTAL", total.base, total.ahora, total.aDetectado, total.aVivo, total.aTimeout, total.siguen], ANCHOS));
  if (sinBase.length > 0) {
    console.log(
      `\n  ⚠ ${sinBase.length} módulo(s) de esta corrida no están en la base de Timeout: ${sinBase.join(", ")}\n` +
        `    no se cuentan como «0 movimientos»: es que no hay con qué compararlos.`,
    );
  }
  console.log(
    `\n  T→detectado  el mutante lo mata ahora un test: el score no se mueve, y no es hallazgo de nadie.\n` +
      `  T→vivo       sale ADEMÁS como superviviente NUEVO en el veredicto de arriba.\n` +
      `  otro→T       medida que pasa a depender del reloj de la máquina que la mide.`,
  );
}

/** Imprime la comparación y devuelve el código de salida.
 *
 *  EXIT ≠ 0 SALVO QUE SE CUMPLA TODO. El criterio son las cinco condiciones de
 *  `veredictoDeAdopcion`; aquí se le suma la única que no es del delta: que la
 *  corrida esté COMPLETA. No es un sexto umbral inventado —`traer` y `repartir`
 *  ya salen con 1 sobre una corrida incompleta—, es que «no se movió nada» sobre
 *  20 de 55 módulos no es una comparación, es un trozo de una. */
export function comparaEnSeco(c: ComparacionEnSeco): number {
  const deltas = c.modulos.flatMap((m) => m.ficheros);
  const veredicto = veredictoDeAdopcion(deltas);
  const { corrida } = c;

  console.log(
    `\nComparación EN SECO de la corrida ${corrida.run_id} sobre ${corrida.sha.slice(0, 7)} ` +
      `(${corrida.desde.slice(0, 7)}..${corrida.sha.slice(0, 7)}, ${corrida.origen})\n` +
      `  contra la huella COMMITEADA de HEAD. No se escribe nada: ni la huella, ni el tag, ni un comentario.\n` +
      `  ${corrida.completa ? "COMPLETA" : "INCOMPLETA"} — ${corrida.porque}\n`,
  );
  imprimeDeltas(c.modulos);

  console.log(`\n${"─".repeat(78)}`);
  console.log("VEREDICTO DE ADOPCIÓN");
  console.log(`  comparables    : ${veredicto.comparables} fichero(s)`);
  console.log(`  nuevos         : ${veredicto.nuevos}`);
  console.log(`  resueltos      : ${veredicto.resueltos}`);
  console.log(`  incomparables  : ${veredicto.incomparables.length} fichero(s)`);
  console.log(`  sin base       : ${veredicto.sinBase.length} fichero(s)`);
  console.log(`  corrida        : ${corrida.completa ? "COMPLETA" : "INCOMPLETA"}`);
  const ok = veredicto.adopta && corrida.completa;
  console.log(
    `\n  ⇒ ${ok ? "SE PUEDE ADOPTAR" : "NO SE ADOPTA"} — ${veredicto.porque}` +
      (corrida.completa ? "" : "; y la corrida está INCOMPLETA: falta medida, no falta hallazgo"),
  );
  if (!ok) {
    console.log(
      `\n  La regla es del usuario y no se negocia: si un solo score se mueve fichero a fichero, no se adopta\n` +
        `  y el issue se cierra con el número.`,
    );
  }

  imprimeReloj(c);
  console.log("");
  return ok ? 0 : 1;
}
