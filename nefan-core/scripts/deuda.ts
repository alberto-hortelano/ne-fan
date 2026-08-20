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
 *    · mutación — los supervivientes del último `npm run mutate`: los sitios
 *      donde un test pasa por la línea sin enterarse de que cambia.
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

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..");
const LCOV = join(coreRoot, "coverage", "lcov.info");
const MUTACION = join(coreRoot, "reports", "mutation", "mutation.json");
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
 *  anterior, está describiendo un código que ya no existe. */
function ultimoCambio(): { posteriores: (limite: number) => string[] } {
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

function avisoDeFrescura(
  medida: string,
  ruta: string,
  cambio: ReturnType<typeof ultimoCambio>,
): string | undefined {
  const tocados = cambio.posteriores(statSync(ruta).mtimeMs);
  if (tocados.length === 0) return undefined;
  // Se NOMBRAN (no solo se cuentan): un merge o un checkout tocan mtimes sin
  // cambiar contenido, y solo viendo cuáles se sabe si la medida vale.
  const muestra = tocados.slice(0, 3).join(", ");
  const resto = tocados.length > 3 ? ` y ${tocados.length - 3} más` : "";
  return `posiblemente obsoleta — cambiados después: ${muestra}${resto}. Refresca con ${medida}`;
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
        que: `${r.rule.id} — ${unaLinea(v.detail ?? r.rule.message)}`,
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
  files: Record<
    string,
    { mutants: { status: string; location: { start: { line: number } }; mutatorName: string }[] }
  >;
}

export function bloqueMutacion(cambio: ReturnType<typeof ultimoCambio>): Bloque {
  const fuente = "reports/mutation/mutation.json + stryker.config.json";
  const objetivos = (
    JSON.parse(readFileSync(join(coreRoot, "stryker.config.json"), "utf-8")) as { mutate: string[] }
  ).mutate;
  if (!existsSync(MUTACION)) {
    return {
      titulo: "Mutación — supervivientes",
      fuente,
      aviso: `sin medir — corre \`npm run mutate\` (${objetivos.length} objetivo(s) configurado(s))`,
      items: [],
    };
  }
  const rep = JSON.parse(readFileSync(MUTACION, "utf-8")) as MutacionReport;
  const items: Item[] = [];
  for (const [file, info] of Object.entries(rep.files)) {
    const vivos = info.mutants.filter((m) => m.status === "Survived" || m.status === "NoCoverage");
    if (vivos.length === 0) continue;
    const total = info.mutants.length;
    const muertos = total - vivos.length;
    const score = total === 0 ? 0 : (muertos / total) * 100;
    const porTipo = new Map<string, number>();
    for (const m of vivos) porTipo.set(m.mutatorName, (porTipo.get(m.mutatorName) ?? 0) + 1);
    const top = [...porTipo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    items.push({
      donde: file,
      que:
        `${vivos.length} mutantes vivos de ${total} (score ${score.toFixed(0)}%) — ` +
        top.map(([k, n]) => `${k}×${n}`).join(", "),
      peso: vivos.length,
    });
  }
  items.sort((a, b) => b.peso - a.peso);
  const medidos = new Set(Object.keys(rep.files));
  // Un objetivo configurado del que el report no dice nada no es "sin deuda":
  // es que esa corrida no lo cubrió (glob distinto, corrida parcial).
  const sinDatos = objetivos.filter((g) => !g.includes("*") && !medidos.has(g));
  const avisos = [avisoDeFrescura("`npm run mutate`", MUTACION, cambio)];
  if (sinDatos.length) avisos.push(`objetivos sin datos en el último report: ${sinDatos.join(", ")}`);
  return {
    titulo: "Mutación — supervivientes",
    fuente,
    aviso: avisos.filter(Boolean).join(" · ") || undefined,
    items,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const TOP = Number(argv[argv.indexOf("--top") + 1]) || 12;
  const cambio = ultimoCambio();
  const bloques = [bloqueFronteras(), bloqueCrap(cambio), bloqueMutacion(cambio)];

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ bloques }, null, 2));
    return;
  }

  const md = argv.includes("--md");
  const total = bloques.reduce((n, b) => n + b.items.length, 0);
  if (md) console.log(`## Deuda medida (${total} items)\n`);
  else console.log(`\nDeuda medida — ${total} items. Derivada del código, no de un documento.\n`);

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
