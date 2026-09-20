/** El cierre de INFORMES: lo que hay en `reports/mutation/` y cómo se lee sin
 *  fiarse de nadie — el sello SHA-256 de cada informe, el manifiesto
 *  `corrida.json` con todos sus campos obligatorios, y la medida (cuántos
 *  mutantes) de un directorio. Sin git. Lo comparten `traer`, `repartir`,
 *  `comparar`, `fusionar` y `manifiesto`, y por eso vive aparte de todos ellos
 *  (#605). El sello se calcula AQUÍ con `node:crypto` y nunca en
 *  `mutacion-huella.ts`, que no importa nada del entorno a propósito.
 *
 *  Quién lo mira: `qa/mutacion-cableado-en-negativo.mjs` (el sello mira el
 *  CONTENIDO y no el nombre, `corrida.json` no es un informe, y el manifiesto se
 *  rechaza diciendo qué le falta). Ningún test lo importa: ver `mutacion.ts`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { coreRoot, resumenDeMutantes, rutaInforme } from "./mutation-plan.js";
import {
  verificaDescarga,
  type Corrida,
  type InformeSellado,
  type MedidaPorModulo,
  type MutanteMedido,
} from "./mutacion-huella.js";

export const DIR_INFORMES = join(coreRoot, "reports", "mutation");
export const RUTA_CORRIDA = join(DIR_INFORMES, "corrida.json");
/** El cronómetro que deja `mutate.ts`, y el plan que escribe `lotes`. Los dos
 *  viven FUERA de `reports/mutation/`: ahí dentro cualquier `.json` que no sea
 *  `corrida.json` se lee como el informe de un módulo, así que un fichero
 *  nuestro inventaría un módulo fantasma. El plan viaja en su propio artefacto
 *  y el cronómetro no viaja: se consume en el mismo job que lo escribió. */
export const RUTA_TIEMPOS = join(coreRoot, "reports", "mutacion-tiempos.json");
export const RUTA_PLAN_CORRIDA = join(coreRoot, "reports", "plan-corrida.json");

// ── informes ─────────────────────────────────────────────────────────────────

export interface InformeCrudo {
  files: Record<string, { mutants: MutanteMedido[] }>;
  /** Lo que Stryker deja escrito de su propia configuración. `comparar` lee de
   *  ahí el PAR `testRunner` + `coverageAnalysis` — el dato que decide si el
   *  «cero NoCoverage» de una medida es una medida o es lo único que podía
   *  decir (#599, y el par y no el ajuste solo por el H-1 de QA en #597). */
  config?: { coverageAnalysis?: unknown; testRunner?: unknown };
}

export function leerInforme(id: string): InformeCrudo {
  return JSON.parse(readFileSync(rutaInforme(id), "utf8")) as InformeCrudo;
}

/** El sello de un informe: SHA-256 de sus bytes. Se calcula AQUÍ, con
 *  `node:crypto`, y nunca en `mutacion-huella.ts`: aquel fichero no importa
 *  nada del entorno a propósito, que es lo que lo deja ejercitable con datos
 *  sintéticos desde cualquier máquina (su cabecera lo explica). */
function selloDeInforme(ruta: string): string {
  return createHash("sha256").update(readFileSync(ruta)).digest("hex");
}

/** Qué ficheros de un directorio de informes SON informes, con su sello.
 *
 *  `corrida.json` vive en el mismo directorio —tiene que viajar en el
 *  artefacto— y NO es uno: contarlo declararía un informe de un módulo
 *  `corrida` que el plan no tiene, y `repartir` moriría buscándolo.
 *
 *  Una sola definición, porque desde la matriz hay DOS sitios que leen un
 *  directorio de informes: la descarga que verifica `traer`/`repartir` y cada
 *  lote que junta `fusionar`. Con dos copias de la regla, un fichero nuevo
 *  nuestro se colaría por el sitio que alguien se olvidara de tocar. */
export function informesDelDirectorio(dir: string): InformeSellado[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "corrida.json")
    .sort()
    .map((f) => ({ modulo: f.slice(0, -".json".length), sha256: selloDeInforme(join(dir, f)) }));
}

/** Cuántos mutantes MIDIÓ cada informe de un directorio: el denominador de
 *  verdad, leído del informe y no del manifiesto.
 *
 *  Va por el hecho y no por la declaración A PROPÓSITO (#596). Podría viajar en
 *  `InformeSellado` —lo escribe `manifiesto`, que ya abre el directorio— y
 *  entonces un artefacto anterior a este cambio se quedaría sin el dato y el
 *  veredicto tendría que suponerle algo. Contándolo aquí, cualquier descarga
 *  contesta: el sello ya garantiza que el fichero en disco ES el que midió la
 *  corrida, así que leerlo no es fiarse de nadie. */
export function medidaDelDirectorio(dir: string): MedidaPorModulo {
  const out: Record<string, number> = {};
  for (const i of informesDelDirectorio(dir)) {
    const crudo = JSON.parse(readFileSync(join(dir, `${i.modulo}.json`), "utf8")) as Partial<InformeCrudo>;
    // Un `.json` de ese directorio que no traiga `files` no es un informe de
    // Stryker, y midió cero mutantes — que es LITERALMENTE cierto y además el
    // veredicto que hace falta: `veredictoDeCorrida` lo nombra como «dejó
    // informe SIN UN SOLO MUTANTE MEDIDO» en vez de reventar con un TypeError
    // crudo a medio manifiesto. Es lo que pasa si alguien afloja el filtro de
    // `informesDelDirectorio` y `corrida.json` entra como si fuera un módulo.
    out[i.modulo] = resumenDeMutantes(Object.values(crudo.files ?? {}).flatMap((f) => f.mutants)).total;
  }
  return out;
}

/** Los informes que hay en `reports/mutation/`, que es donde los deja `mutate`
 *  y donde los baja `traer`. */
export function informesEnDisco(): InformeSellado[] {
  return informesDelDirectorio(DIR_INFORMES);
}

/** El manifiesto de la corrida bajada, o un error que dice qué le pasa.
 *
 *  Pre-producción, cero compatibilidad: un `corrida.json` no se lee «como se
 *  pueda», y eso vale para TODOS sus campos, no solo para los dos que estrenó
 *  esta tanda. Cada uno decide algo que después no se puede deshacer: sin
 *  `desde`, `repartir` volvería a colgar el rango del tag que la propia corrida
 *  movió (#381); sin `informes`, el guardia compara nombres y una medida local
 *  se cuela en el histórico commiteado (#420); un `origen` desconocido no es
 *  `"explicito"`, así que `veredictoDeCorrida` lo tomaría por una corrida capaz
 *  de MOVER EL TAG, declarando medido lo que nadie midió; y un
 *  `modulos_pedidos` ausente reventaba con un `TypeError` crudo en vez de
 *  decir qué hacer. Todas esas degradaciones salen verdes y mienten. */
export function leerCorrida(): Corrida {
  if (!existsSync(RUTA_CORRIDA)) {
    throw new Error(
      `no hay ${relative(coreRoot, RUTA_CORRIDA)}: el manifiesto lo escribe CI DENTRO del artefacto. ` +
        `O no has bajado ninguna corrida todavía, o la que has bajado es anterior a que CI lo escribiera ` +
        `— y sin manifiesto no hay forma de saber qué módulos se pidieron ni si la medida quedó completa. ` +
        `Baja una posterior: npm run mutacion -- traer`,
    );
  }
  const corrida = JSON.parse(readFileSync(RUTA_CORRIDA, "utf8")) as Partial<Corrida>;
  const cadena = (v: unknown): boolean => typeof v === "string" && v.length > 0;
  const mal: string[] = [];
  if (!cadena(corrida.sha)) mal.push("sha (el commit que se midió)");
  if (!cadena(corrida.desde)) mal.push("desde (el ancla del rango)");
  if (!cadena(corrida.run_id)) mal.push("run_id (la corrida de CI de la que salió)");
  if (!cadena(corrida.fecha)) mal.push("fecha");
  if (corrida.origen !== "rango" && corrida.origen !== "todos" && corrida.origen !== "explicito") {
    mal.push(`origen (dice ${JSON.stringify(corrida.origen)}, y solo vale rango | todos | explicito)`);
  }
  if (!Array.isArray(corrida.modulos_pedidos)) mal.push("modulos_pedidos (qué se mandó medir)");
  if (!Array.isArray(corrida.informes)) mal.push("informes (el módulo y el sello de cada informe)");
  if (mal.length > 0) {
    throw new Error(
      `el manifiesto de ${relative(coreRoot, RUTA_CORRIDA)} no está bien: ${mal.join("; ")}.\n` +
        `Lo escribe CI dentro del artefacto, así que esto significa una de dos: o es de una corrida ` +
        `anterior a que CI escribiera el ancla y el sello —y entonces no hay recuperación, porque el dato ` +
        `no existe en ningún sitio— o alguien lo editó a mano. En los dos casos, la salida es una corrida ` +
        `nueva: autorízala (Actions → "Mutation testing" → Run workflow) y bájala con ` +
        `npm run mutacion -- traer`,
    );
  }
  return corrida as Corrida;
}

/** El mismo guardia para `traer` (después de bajar) y para `repartir` (antes de
 *  atribuir nada). En `repartir` no es redundante: entre una cosa y otra puede
 *  haber corrido un `npm run mutacion -- local`, y mezclar esa medida con la de
 *  CI daría una foto que nunca existió. */
export function exigeDescargaLimpia(corrida: Corrida): void {
  const errores = verificaDescarga(corrida, informesEnDisco());
  if (errores.length > 0) {
    throw new Error(
      `el contenido de reports/mutation/ no casa con el manifiesto de la corrida ${corrida.run_id}:\n` +
        errores.map((e) => `  · ${e}`).join("\n") +
        `\nVuelve a bajarla entera: npm run mutacion -- traer ${corrida.run_id}`,
    );
  }
}

