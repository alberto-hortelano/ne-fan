/** Cola de deuda derivada de las herramientas — el backlog que no se mantiene.
 *
 *  Un backlog escrito a mano envejece: `next.md` pedía trocear `ws-server.ts`
 *  (~850 líneas) meses después de que se hubiera troceado a 216 con 9 handlers,
 *  y 4 de los 5 puntos del backlog de mapas ya estaban hechos cuando se
 *  revisaron. Nadie miente: es que el documento no puede saberlo. Este comando
 *  no guarda estado — cada corrida vuelve a mirar el código, así que un item
 *  desaparece de la cola exactamente cuando se arregla.
 *
 *  Tres fuentes, ninguna inventada aquí:
 *    · fronteras — las reglas `warn` de `arch-rules.json`, deuda congelada en
 *      `max`; cada violación es un `fichero:línea` concreto.
 *    · complejidad × cobertura — las funciones por encima del `objetivo` de
 *      `quality-thresholds.json`, peor primero.
 *    · mutación — los supervivientes de la última corrida: los sitios donde un
 *      test pasa por la línea sin enterarse de que cambia. Ya no salen solo del
 *      informe local (`reports/`, gitignorado): la huella COMMITEADA
 *      (`data/contract/mutacion-huella.json`) los conserva, así que un clon
 *      recién hecho ve la deuda de mutación en vez de una fuente vacía. Y cada
 *      superviviente sale con su estado —NUEVO, ya estaba, o sin base de
 *      comparación— y con quién pudo traerlo.
 *
 *  Lo que NINGUNA herramienta mide (trocear un fichero, pluginizar los
 *  controles) no sale aquí: eso va a issues de GitHub, que se cierran solas
 *  desde la PR en vez de depender de que alguien se acuerde de tacharlas.
 *
 *  Uso:
 *    npm run deuda              # cola completa
 *    npm run deuda -- --md      # markdown para pegar en una issue
 *    npm run deuda -- --json    # para otra herramienta
 *    npm run deuda -- --top 15  # recortar las listas largas
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkArchitecture, reportByRule } from "../src/contract/arch/check.js";
import { archConfig, loadArchFiles } from "./arch-collect.js";
import { crapRows, readThresholds, type CrapRow } from "./crap-score.js";
import { costeDe, leerHuella, seleccionDesdeElTag, TAG } from "./mutacion.js";
import {
  anotacionDeFichero,
  avisoDeAntiguedad,
  avisoDeFrescura as avisoDeFrescuraDeMutacion,
  huellaDeMutante,
  queHacerCon,
  type Huella,
  type MedidaDeFichero,
  type MutanteMedido,
} from "./mutacion-huella.js";
import {
  dueñoDe,
  esVivo,
  ficherosMutados,
  leerPlan,
  perimetro,
  resumenDeMutantes,
  rutaInforme,
  type PlanMutacion,
} from "./mutation-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..");
const LCOV = join(coreRoot, "coverage", "lcov.info");
const MEDIDOS = ["src", "bridge", "services"];

export interface Item {
  /** Dónde está el trabajo: `fichero:línea` o `fichero`. */
  donde: string;
  /** Qué hay que hacer, en una línea. */
  que: string;
  /** Para ordenar dentro de su bloque. Cada fuente tiene su escala — NO se
   *  comparan entre bloques: un CRAP de 205 y 206 mutantes vivos no son
   *  magnitudes del mismo tipo, y fabricar un número único que los mezcle sería
   *  inventarse una prioridad que los datos no dan. */
  peso: number;
}

export interface Bloque {
  titulo: string;
  fuente: string;
  /** Advertencia sobre la medida (ausente, obsoleta, parcial). Se imprime
   *  SIEMPRE que exista: un bloque vacío por falta de datos se lee igual que
   *  uno vacío por no haber deuda, y esa confusión es justo lo que se evita. */
  aviso?: string;
  items: Item[];
}

/** Fichero fuente más reciente de los árboles medidos: si una medida es
 *  anterior, está describiendo un código que ya no existe.
 *
 *  El `mtime` SIGUE valiendo para la cobertura y solo para ella: el `lcov.info`
 *  se genera en esta máquina y su fecha de fichero es su fecha de medida. Para
 *  la mutación ya no vale — la medida baja de un artefacto de CI y el `mtime`
 *  pasa a ser la fecha de la DESCARGA—, así que allí la frescura la decide
 *  `seleccionar()` sobre el diff desde `mutacion-ultima`. */
export function ultimoCambio(): { posteriores: (limite: number) => string[] } {
  const ficheros: { path: string; mtime: number }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith(".ts")) ficheros.push({ path: full, mtime: st.mtimeMs });
    }
  };
  for (const d of MEDIDOS) walk(join(coreRoot, d));
  return {
    posteriores: (limite) =>
      ficheros
        .filter((f) => f.mtime > limite)
        .sort((a, b) => b.mtime - a.mtime)
        .map((f) => f.path.slice(coreRoot.length + 1)),
  };
}

/** El mensaje, separado de la lectura del disco. PURO y exportado por el mismo
 *  motivo que `enColaDeCrap`: a través del `mtime` real, en CI la lista llega
 *  vacía y el test pasaría en verde sin comprobar nada. */
export function mensajeDeObsolescencia(medida: string, tocados: readonly string[]): string | undefined {
  if (tocados.length === 0) return undefined;
  // Se NOMBRAN (no solo se cuentan): un merge o un checkout tocan mtimes sin
  // cambiar contenido, y solo viendo cuáles se sabe si la medida vale.
  const muestra = tocados.slice(0, 3).join(", ");
  const resto = tocados.length > 3 ? ` y ${tocados.length - 3} más` : "";
  return `posiblemente obsoleta — cambiados después: ${muestra}${resto}. Refresca con ${medida}`;
}

function avisoDeFrescura(
  medida: string,
  ruta: string,
  cambio: ReturnType<typeof ultimoCambio>,
): string | undefined {
  return mensajeDeObsolescencia(medida, cambio.posteriores(statSync(ruta).mtimeMs));
}

/** El detalle de una violación puede ser un bloque de varias líneas (un
 *  `catch { … }` entero). En una lista, eso destroza la legibilidad: se colapsa
 *  a una línea y se recorta — la ubicación exacta ya va al lado. */
export function unaLinea(s: string, max = 80): string {
  // El detalle llega ya serializado (el motor lo pasa por JSON.stringify), así
  // que los saltos son la SECUENCIA "\n" de dos caracteres, no un salto real:
  // hay que colapsar las dos formas o el texto sale con barras a la vista.
  const plano = s
    .replace(/\\[nrt]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plano.length > max ? `${plano.slice(0, max - 1)}…` : plano;
}

export function bloqueFronteras(): Bloque {
  const reports = reportByRule(archConfig, checkArchitecture(archConfig, loadArchFiles()));
  const items: Item[] = [];
  for (const r of reports) {
    if (r.rule.severity !== "warn") continue;
    for (const v of r.violations) {
      items.push({
        donde: `${v.path}:${v.line}`,
        // `detail` no es opcional en el checker: el `?? r.rule.message` que
        // había aquí era una rama muerta que además nombraba un campo que la
        // regla no tiene. No se veía porque `scripts/` no entra en el
        // `tsc --noEmit` del CI (ver el informe).
        que: `${r.rule.id} — ${unaLinea(v.detail)}`,
        peso: 1,
      });
    }
  }
  const congeladas = reports.filter((r) => r.rule.severity === "warn");
  const bajables = congeladas.filter((r) => r.violations.length < (r.rule.max ?? 0));
  return {
    titulo: "Fronteras — deuda congelada",
    fuente: "data/contract/arch-rules.json (reglas warn)",
    aviso: bajables.length
      ? `${bajables.length} regla(s) por debajo de su max: baja el max en el JSON o volverá a crecer gratis`
      : undefined,
    items,
  };
}

/** Qué entra en el bloque de complejidad × cobertura.
 *
 *  Pura y exportada A PROPÓSITO: si el test tuviera que llamarla a través del
 *  lcov real, en CI no comprobaría nada — `npm test` corre ANTES que
 *  `npm run coverage` y `coverage/` no se versiona, así que la lista llega
 *  vacía y un `deepEqual([], [])` pasa en verde. Con datos sintéticos la regla
 *  se prueba igual en cualquier máquina. */
export function enColaDeCrap(filas: readonly CrapRow[], objetivo: number): CrapRow[] {
  // Cobertura cero entra SIEMPRE, caiga donde caiga su CRAP. Lo destapó el
  // primer uso real: `handleTileAnalysis` tenía 0% de cobertura y un CRAP de
  // exactamente 30,0 — un pelo por debajo del `>` — así que la cola lo dejaba
  // fuera justo en el caso más grave que puede haber, una función por la que
  // ningún test pasa. El CRAP mide "complejo Y mal cubierto"; una función
  // simple sin cubrir en absoluto es otra cosa, y se escapaba por el hueco.
  //
  // …pero solo las CON NOMBRE. Una arrow anónima a 0% es una rama no tomada de
  // su función padre, y como item de cola no es accionable ("arregla la flecha
  // de la línea 173"): esa señal ya la lleva la cobertura del padre.
  const sinCubrir = (f: CrapRow): boolean => f.coverage === 0 && !f.name.startsWith("(");
  return filas.filter((f) => f.crap > objetivo || sinCubrir(f));
}

export function bloqueCrap(cambio: ReturnType<typeof ultimoCambio>): Bloque {
  if (!existsSync(LCOV)) {
    return {
      titulo: "Complejidad × cobertura",
      fuente: "coverage/lcov.info + quality-thresholds.json",
      aviso: "sin medir — corre `npm run coverage` (sin esto NO significa que no haya deuda)",
      items: [],
    };
  }
  const { objetivo } = readThresholds().crap;
  const { filas } = crapRows();
  const sobre = enColaDeCrap(filas, objetivo);
  return {
    titulo: `Complejidad × cobertura (CRAP > ${objetivo}, o cobertura 0)`,
    fuente: "coverage/lcov.info + quality-thresholds.json",
    aviso: avisoDeFrescura("`npm run coverage`", LCOV, cambio),
    items: sobre.map((f) => ({
      donde: `${f.file}:${f.startLine}`,
      que: `${f.name} — CRAP ${f.crap.toFixed(0)} (complejidad ${f.complexity}, cobertura ${(f.coverage * 100).toFixed(0)}%)`,
      peso: f.crap,
    })),
  };
}

interface MutacionReport {
  files: Record<string, { mutants: MutanteMedido[] }>;
}

/** Un módulo del plan de mutación y lo que se sabe de su última corrida.
 *
 *  Hay DOS fuentes y no son intercambiables. El `report` es el informe local
 *  (`reports/mutation/<id>.json`, gitignorado): trae el detalle —qué mutadores,
 *  en qué línea— pero solo existe en la máquina donde se bajó. La `base` es la
 *  huella COMMITEADA: no trae detalle, pero sobrevive a un clon, y es la que
 *  dice qué es NUEVO y de quién. Sin ninguna de las dos, ese módulo NO se midió,
 *  que no es lo mismo que "no tiene deuda" — y de distinguir esas dos cosas va
 *  la mitad de este bloque. */
export interface InformeModulo {
  id: string;
  /** Ficheros que el módulo declara mutar, para poder decir qué se quedó sin
   *  medir sin tener que abrir el informe que falta. */
  ficheros: readonly string[];
  report?: MutacionReport;
  /** Ruta del fuente → su medida en la huella commiteada. */
  base?: Readonly<Record<string, MedidaDeFichero>>;
}

/** Fusión de los informes por módulo. Determinista: los módulos van en el
 *  orden del plan y los items se ordenan por supervivientes y, a igualdad, por
 *  ruta — nunca por el orden de las claves de un JSON. */
export function itemsDeMutacion(informes: readonly InformeModulo[]): Item[] {
  const items: Item[] = [];
  for (const { report, base = {} } of informes) {
    const conInforme = new Set<string>();
    for (const [file, info] of Object.entries(report?.files ?? {})) {
      conInforme.add(file);
      const { total, vivos, score } = resumenDeMutantes(info.mutants);
      if (vivos === 0) continue;
      const porTipo = new Map<string, number>();
      const huellas: string[] = [];
      for (const m of info.mutants) {
        if (!esVivo(m.status)) continue;
        porTipo.set(m.mutatorName, (porTipo.get(m.mutatorName) ?? 0) + 1);
        huellas.push(huellaDeMutante(file, m));
      }
      const top = [...porTipo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      items.push({
        donde: file,
        que:
          `${vivos} mutantes vivos de ${total} (score ${score.toFixed(0)}%) — ` +
          `${top.map(([k, n]) => `${k}×${n}`).join(", ")} · ${anotacionDeFichero(huellas, base[file])}`,
        peso: vivos,
      });
    }
    // Lo que la huella recuerda y este árbol no tiene bajado. Sin esto, un clon
    // limpio —o un `traer` de una corrida parcial— enseñaría la mutación como
    // fuente vacía, que se lee igual que "no hay deuda".
    for (const [file, medida] of Object.entries(base)) {
      if (conInforme.has(file) || medida.vivos.length === 0) continue;
      const score = medida.total === 0 ? 0 : ((medida.total - medida.vivos.length) / medida.total) * 100;
      items.push({
        donde: file,
        que:
          `${medida.vivos.length} mutantes vivos de ${medida.total} (score ${score.toFixed(0)}%) — ` +
          // El sha se recorta solo si LO ES: la huella de arranque lleva un
          // marcador legible en su lugar, y cortarlo a siete daría un trozo de
          // palabra que se lee como un sha de verdad.
          `de la huella, medido el ${medida.fecha.slice(0, 10)} (${medida.sha.length > 12 ? medida.sha.slice(0, 7) : medida.sha}) · ` +
          `${anotacionDeFichero(medida.vivos, medida)}`,
        peso: medida.vivos.length,
      });
    }
  }
  return items.sort((a, b) => b.peso - a.peso || a.donde.localeCompare(b.donde));
}

/** El aviso que nació de un fallo real: un objetivo apuntaba a una ruta que no
 *  existía y pasó meses MIDIENDO EL VACÍO EN VERDE. Partir la corrida por
 *  módulos multiplica las maneras de que eso vuelva a pasar —basta con que un
 *  módulo no se corra— así que el aviso ahora es por módulo y dice el comando
 *  exacto que arregla justo lo que falta.
 *
 *  Empieza por "sin medir" a propósito: es la marca que `cabeceraDe` busca para
 *  declarar la cola PARCIAL en el titular. Una medida a medias tiene el mismo
 *  modo de fallo que la ausente — un total pequeño que se lee como la deuda
 *  entera. */
export function avisoSinDatos(
  informes: readonly InformeModulo[],
  queHacer: (id: string) => string = (id) => `npm run mutacion -- local ${id}`,
): string | undefined {
  // Sin medida es sin NINGUNA de las dos fuentes. Un módulo que solo tiene
  // huella está medido —lo que falta es el detalle local—, y contarlo aquí
  // marcaría la cola PARCIAL para siempre en cualquier clon.
  const faltan = informes.filter((i) => !i.report && Object.keys(i.base ?? {}).length === 0);
  if (faltan.length === 0) return undefined;
  const ids = faltan.map((i) => i.id);
  const ficheros = faltan.reduce((n, i) => n + i.ficheros.length, 0);
  // Ya NO se manda `npm run mutate`: es justo lo que no se puede correr en la
  // máquina de quien programa. Cada módulo lleva su comando — medirlo aquí si
  // es barato, pedirlo si no.
  const comandos = ids.slice(0, 3).map(queHacer).join(" · ");
  if (faltan.length === informes.length) {
    return `sin medir — ${informes.length} módulos, ${ficheros} ficheros configurados: ${comandos}`;
  }
  return (
    `sin medir ${faltan.length} de ${informes.length} módulos (${ficheros} ficheros sin dato): ` +
    `${comandos}${ids.length > 3 ? ` · y ${ids.length - 3} más` : ""}`
  );
}

/** Lo que NADIE muta, aunque esté dentro del perímetro puro.
 *
 *  Con la corrida partida hay dos maneras de no tener medida, y solo una se ve
 *  desde los informes: que un módulo no se haya corrido. La otra es que el
 *  fichero no sea objetivo de ningún módulo, y esa no deja rastro — es la que
 *  tuvo a esta casa meses en verde sobre un objetivo que apuntaba a una ruta
 *  muerta. Que ahora esté DECLARADA en `sin_mutar` con su motivo la hace
 *  imposible de olvidar, pero no la convierte en medida: se cuenta y se
 *  enseña, agrupada por directorio, para que la lista tenga que menguar. */
export function avisoDeExentos(exentos: readonly string[]): string | undefined {
  if (exentos.length === 0) return undefined;
  const porDir = new Map<string, number>();
  for (const f of exentos) {
    const dir = f.split("/").slice(0, -1).join("/");
    porDir.set(dir, (porDir.get(dir) ?? 0) + 1);
  }
  const top = [...porDir.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([d, n]) => `${d} (${n})`);
  return (
    `${exentos.length} ficheros del perímetro puro NO los muta nadie — están en \`sin_mutar\` con motivo: ` +
    `${top.join(", ")}${porDir.size > 4 ? `, +${porDir.size - 4} dir.` : ""}`
  );
}

function exentosDel(plan: PlanMutacion): string[] {
  return perimetro(plan).filter((f) => dueñoDe(plan, f).tipo === "exento");
}

/** Lee el informe de cada módulo del plan. Un JSON ilegible NO se degrada a
 *  "sin datos": eso escondería un informe corrupto detrás del mismo aviso que
 *  un informe que nadie ha generado. */
function leerInformes(plan: PlanMutacion, huella: Huella): InformeModulo[] {
  return plan.modulos.map((m) => {
    const ruta = rutaInforme(m.id);
    const ficheros = ficherosMutados(m);
    const base: Record<string, MedidaDeFichero> = {};
    for (const f of ficheros) if (huella.ficheros[f]) base[f] = huella.ficheros[f];
    if (!existsSync(ruta)) return { id: m.id, ficheros, base };
    return {
      id: m.id,
      ficheros,
      base,
      report: JSON.parse(readFileSync(ruta, "utf-8")) as MutacionReport,
    };
  });
}

/** Cuántos días sin medida antes de avisar. Es lo que sustituye al cron
 *  nocturno: sin él, la única forma de que un módulo se quede años sin medir es
 *  que nadie lo mire, y el punto ciego del selector —no ve lo que un test lee en
 *  runtime— se estrecha con el rango desde el tag pero no se cierra del todo. */
const DIAS_SIN_MEDIDA = 14;

/** Los módulos cuya medida puede estar describiendo código que ya no existe.
 *
 *  Ya NO por `mtime` —la medida baja de un artefacto y el mtime pasa a ser la
 *  fecha de la descarga—, sino con la misma función que decide qué correr: si el
 *  diff desde `mutacion-ultima` selecciona ese módulo, su medida es anterior al
 *  cambio que puede haberla invalidado. Ve el ÁRBOL DE TRABAJO, que es el estado
 *  normal de un agente a mitad de tanda. */
function desactualizados(plan: PlanMutacion, informes: readonly InformeModulo[]): string[] {
  const conMedida = new Set(
    informes.filter((i) => i.report !== undefined || Object.keys(i.base ?? {}).length > 0).map((i) => i.id),
  );
  const sel = seleccionDesdeElTag(plan, TAG);
  const ids = sel.todos ? plan.modulos.map((m) => m.id) : sel.ids;
  return ids.filter((id) => conMedida.has(id));
}

export function bloqueMutacion(): Bloque {
  const fuente = "data/contract/mutacion-huella.json + reports/mutation/<módulo>.json";
  const plan = leerPlan();
  const huella = leerHuella();
  const informes = leerInformes(plan, huella);
  // La fecha de un módulo es la de su fichero medido MÁS ANTIGUO: con la
  // corrida partida, un módulo medido hace un mes junto a otro de hace un
  // minuto es exactamente el caso en el que la cola describe código que ya no
  // existe.
  //
  // Solo de los módulos que SÍ tienen huella: de los que no la tienen ya avisa
  // `avisoSinDatos`, y decirlo dos veces con palabras distintas hace que se
  // deje de leer.
  const fechas = informes
    .filter((i) => Object.keys(i.base ?? {}).length > 0)
    .map((i) => ({
      id: i.id,
      fecha: Object.values(i.base ?? {})
        .map((m) => m.fecha)
        .sort()[0],
    }));
  const avisos = [
    avisoSinDatos(informes, (id) => queHacerCon(id, costeDe(plan, huella, id), plan.tope_local)),
    avisoDeAntiguedad(fechas, Date.now(), DIAS_SIN_MEDIDA),
    avisoDeFrescuraDeMutacion(desactualizados(plan, informes)),
    avisoDeExentos(exentosDel(plan)),
  ];
  return {
    titulo: "Mutación — supervivientes",
    fuente,
    aviso: avisos.filter(Boolean).join(" · ") || undefined,
    items: itemsDeMutacion(informes),
  };
}

/** Titular de la cola. Las fuentes sin medir se anuncian AQUÍ, no solo dentro
 *  de su bloque: `coverage/` y `reports/` no se versionan, así que en un clon
 *  limpio dos de las tres fuentes están vacías y el total sale engañosamente
 *  pequeño. Quien lo lea de pasada se llevaría "27 items" como si fuera la
 *  deuda entera — un número solo significa algo si se dice sobre cuánto. */
export function cabeceraDe(bloques: readonly Bloque[]): string {
  const total = bloques.reduce((n, b) => n + b.items.length, 0);
  const sinMedir = bloques.filter((b) => b.aviso?.startsWith("sin medir"));
  if (sinMedir.length === 0) {
    return `Deuda medida — ${total} items. Derivada del código, no de un documento.`;
  }
  const nombres = sinMedir.map((b) => b.titulo.split(" ")[0].toLowerCase()).join(", ");
  return (
    `Deuda PARCIAL — ${total} items de ${bloques.length - sinMedir.length} de ${bloques.length} fuentes. ` +
    `Sin medir: ${nombres}. ` +
    // La mutación ya NO se manda correr aquí: se pide y la autoriza una persona.
    `Para la cola completa: npm run coverage && npm run mutacion -- pendiente`
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  const TOP = Number(argv[argv.indexOf("--top") + 1]) || 12;
  const cambio = ultimoCambio();
  const bloques = [bloqueFronteras(), bloqueCrap(cambio), bloqueMutacion()];

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ bloques }, null, 2));
    return;
  }

  const md = argv.includes("--md");
  const cabecera = cabeceraDe(bloques);
  if (md) console.log(`## ${cabecera}\n`);
  else console.log(`\n${cabecera}\n`);

  for (const b of bloques) {
    const cabecera = `${b.titulo} · ${b.items.length}`;
    console.log(md ? `### ${cabecera}\n` : `\n${cabecera}\n${"─".repeat(78)}`);
    console.log(md ? `<sub>${b.fuente}</sub>\n` : `  fuente: ${b.fuente}`);
    if (b.aviso) console.log(md ? `> ⚠️ ${b.aviso}\n` : `  ⚠️  ${b.aviso}`);
    for (const it of b.items.slice(0, TOP)) {
      console.log(md ? `- [ ] \`${it.donde}\` — ${it.que}` : `  ${it.donde}\n      ${it.que}`);
    }
    if (b.items.length > TOP) {
      const resto = b.items.length - TOP;
      console.log(
        md ? `\n<sub>…y ${resto} más (\`--top\`)</sub>\n` : `  …y ${resto} más (--top ${b.items.length})`,
      );
    } else if (md) console.log("");
  }
  if (!md) console.log("");
}

// Solo se ejecuta al invocarlo como comando; importado (tests) no imprime nada.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
