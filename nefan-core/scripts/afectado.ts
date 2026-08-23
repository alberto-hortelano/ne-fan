/** `npm run afectado` — dado un diff, qué módulos de mutación hay que correr.
 *
 *  La corrida completa mide 6.962 mutantes y son horas de CPU. Casi ningún
 *  cambio puede haber roto todo eso: mutar `combat-resolver.ts` con una batería
 *  que ni lo carga no puede matar un mutante suyo, y correr un módulo cuyo
 *  código nadie ha tocado tampoco puede dar un veredicto distinto al de ayer.
 *  Este script responde a la única pregunta que importa antes de medir: **qué
 *  puede haber cambiado de suerte**.
 *
 *  CÓMO LO DECIDE. Un módulo entra si el diff toca algo que su corrida
 *  EJECUTA: su batería, lo que muta, o cualquier fichero que cuelgue de ahí por
 *  una arista de RUNTIME (`alcanceDe`, en mutation-plan.ts). Las aristas de
 *  solo-tipo no cuentan porque TypeScript las borra al compilar — no es una
 *  heurística, es lo que queda en el JavaScript que se ejecuta. Sin esa
 *  distinción el selector no serviría: `src/types.ts` está en el cierre ingenuo
 *  de los 17 módulos y en el de runtime de NINGUNO.
 *
 *  CUÁNDO EJECUTA DE MÁS. Ante la duda, todos, y diciéndolo. Un selector que
 *  se calla es peor que no tener selector: un diff que no selecciona nada sale
 *  verde sin que nadie haya medido, y esa es exactamente la forma del fallo que
 *  tuvo esta casa meses (un objetivo apuntando a una ruta que no existía). Así
 *  que fuerzan la corrida completa: un cambio en el propio instrumento, un dato
 *  o fixture del paquete (los tests los leen en runtime y eso no está en ningún
 *  grafo de imports), un fuente que ya no está en el árbol, y —el caso que da
 *  sentido al candado de totalidad— un fichero del perímetro puro del que el
 *  plan no dice nada, ni mutándolo ni eximiéndolo en `sin_mutar`.
 *
 *  Uso:
 *    npm run afectado                          # main...HEAD + árbol de trabajo
 *    npm run afectado -- --desde tooling/x     # desde otra rama o commit
 *    npm run afectado -- --rango a1b2c3~1..a1b2c3   # auditar un commit ya hecho
 *    npm run afectado -- --ficheros a.ts b.ts  # una lista explícita
 *    npm run afectado -- --ids                 # JSON de ids (matriz de CI)
 *    npm run afectado -- --coste               # además, qué % de los mutantes
 *
 *  Correr lo seleccionado: `npm run mutate -- --cambiado` (o `--desde`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  alcanceDe,
  coreRoot,
  dueñoDe,
  leerPlan,
  perimetro,
  resumenDeMutantes,
  rutaInforme,
  type PlanMutacion,
} from "./mutation-plan.js";

const raizRepo = resolve(coreRoot, "..");

/** Lo que el propio instrumento de medida decide. Si cambia cualquiera de
 *  estos, lo que se mide o cómo se mide puede ser otro para TODOS los módulos,
 *  así que la selección de ayer no vale. */
const TOOLING = [
  "scripts/",
  "data/contract/mutation-targets.json",
  "data/contract/arch-rules.json",
  "stryker.config.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

export type Clase = "fuente" | "test" | "tooling" | "dato" | "ajeno";

/** En qué cajón cae un fichero cambiado, dada su ruta relativa a nefan-core
 *  (los de fuera del paquete llegan con `../`, que es como los normaliza la
 *  traza de imports). */
export function clasifica(ruta: string): Clase {
  if (ruta.startsWith("../")) return "ajeno";
  if (TOOLING.some((t) => (t.endsWith("/") ? ruta.startsWith(t) : ruta === t))) return "tooling";
  if (!ruta.endsWith(".ts")) return "dato";
  if (ruta.startsWith("test/")) return "test";
  if (/^(src|bridge|services)\//.test(ruta)) return "fuente";
  return "dato";
}

export interface Efecto {
  /** Ruta relativa a nefan-core. */
  fichero: string;
  clase: Clase;
  /** Módulos que este fichero, por sí solo, obliga a correr. */
  ids: string[];
  /** Este fichero obliga a la corrida COMPLETA. */
  todos: boolean;
  /** Una línea: por qué eso y no otra cosa. Nunca vacía — un fichero sin
   *  explicación es el silencio que este script existe para no tener. */
  porque: string;
}

export interface Seleccion {
  ids: string[];
  todos: boolean;
  efectos: Efecto[];
}

/** El contexto que la selección necesita del disco. Se pasa por parámetro para
 *  que `seleccionar` sea una función pura y el candado pueda ejercerla con
 *  datos sintéticos: contra el plan real, un test de "ejecuta de más" pasaría
 *  en verde el día que el plan cambie de forma. */
export interface Contexto {
  /** id de módulo → todo lo que su corrida ejecuta. */
  alcances: Map<string, readonly string[]>;
  /** id de módulo → su batería. */
  baterias: Map<string, readonly string[]>;
  /** Los ficheros que tienen que tener dueño (módulo o exención). */
  perimetro: ReadonlySet<string>;
  /** Quién responde por un fichero del perímetro. */
  dueño: (fichero: string) => ReturnType<typeof dueñoDe>;
  /** Si el fichero sigue en el árbol. Uno borrado no se puede analizar. */
  existe: (fichero: string) => boolean;
}

export function contextoDe(plan: PlanMutacion): Contexto {
  return {
    alcances: new Map(plan.modulos.map((m) => [m.id, [...alcanceDe(m)]])),
    baterias: new Map(plan.modulos.map((m) => [m.id, m.tests])),
    perimetro: new Set(perimetro(plan)),
    dueño: (f) => dueñoDe(plan, f),
    existe: (f) => existsSync(join(coreRoot, f)),
  };
}

/** Los módulos cuya corrida CARGA ese fichero. */
function cargadoPor(ctx: Contexto, fichero: string): string[] {
  return [...ctx.alcances].filter(([, alcance]) => alcance.includes(fichero)).map(([id]) => id);
}

function efectoDeFuente(ctx: Contexto, f: string): Efecto {
  if (!ctx.existe(f)) {
    return {
      fichero: f,
      clase: "fuente",
      ids: [],
      todos: true,
      porque:
        "ya no está en el árbol (borrado o renombrado): no hay grafo de imports que decir quién lo cargaba",
    };
  }
  // El perímetro va ANTES que el alcance a propósito. Un huérfano significa que
  // el plan está incompleto, y sobre un plan incompleto la derivación no es de
  // fiar aunque dé una respuesta: se ejecuta de más y se dice por qué.
  if (ctx.perimetro.has(f) && ctx.dueño(f).tipo === "huerfano") {
    return {
      fichero: f,
      clase: "fuente",
      ids: [],
      todos: true,
      porque:
        "está en el perímetro puro y NINGÚN módulo lo muta ni `sin_mutar` lo exime — " +
        "nadie sabe qué habría que ejecutar (arréglalo en data/contract/mutation-targets.json)",
    };
  }
  const ids = cargadoPor(ctx, f);
  if (ids.length > 0)
    return { fichero: f, clase: "fuente", ids, todos: false, porque: "sus baterías lo cargan" };
  const dueño = ctx.dueño(f);
  return {
    fichero: f,
    clase: "fuente",
    ids: [],
    todos: false,
    porque:
      dueño.tipo === "exento"
        ? `nadie lo muta (sin_mutar: ${dueño.porque}) y ninguna batería lo carga en runtime`
        : "ninguna batería de mutación lo carga en runtime",
  };
}

function efectoDe(ctx: Contexto, f: string): Efecto {
  const clase = clasifica(f);
  if (clase === "fuente") return efectoDeFuente(ctx, f);
  if (clase === "tooling") {
    return {
      fichero: f,
      clase,
      ids: [],
      todos: true,
      porque:
        "es el instrumento de medida: lo que se mide, con qué o dónde puede ser otro para todos los módulos",
    };
  }
  if (clase === "dato") {
    return {
      fichero: f,
      clase,
      ids: [],
      todos: true,
      porque:
        "es un dato del paquete: los tests lo leen en runtime y eso no aparece en ningún grafo de imports",
    };
  }
  if (clase === "test") {
    const ids = [...ctx.baterias].filter(([, tests]) => tests.includes(f)).map(([id]) => id);
    return {
      fichero: f,
      clase,
      ids,
      todos: false,
      porque:
        ids.length > 0
          ? "está en esas baterías"
          : "no está en la batería de ningún módulo (y el candado exige que un test que importe lo mutado esté en la suya)",
    };
  }
  const ids = cargadoPor(ctx, f);
  return {
    fichero: f,
    clase,
    ids,
    todos: false,
    porque:
      ids.length > 0
        ? "una batería lo importa desde fuera del paquete"
        : "está fuera de nefan-core y ninguna batería lo carga",
  };
}

export function seleccionar(ctx: Contexto, ficheros: readonly string[]): Seleccion {
  const efectos = [...new Set(ficheros)].sort().map((f) => efectoDe(ctx, f));
  const todos = efectos.some((e) => e.todos);
  const ids = todos ? [...ctx.alcances.keys()] : [...new Set(efectos.flatMap((e) => e.ids))];
  // El orden es el del plan, no el del diff: la lista tiene que ser la misma
  // para el mismo cambio, venga de donde venga.
  const orden = [...ctx.alcances.keys()];
  return { ids: ids.sort((a, b) => orden.indexOf(a) - orden.indexOf(b)), todos, efectos };
}

// ── de git a rutas relativas a nefan-core ────────────────────────────────────

function git(args: string[]): string[] {
  return execFileSync("git", args, { cwd: raizRepo, encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Las rutas que da git son relativas a la raíz del repo; el plan y la traza de
 *  imports hablan en rutas relativas a nefan-core. Lo de fuera del paquete
 *  queda con `../`, que es justo como lo normaliza `resolverEspecificador` —
 *  así un `../narrative-mcp/validators.ts` casa con el cierre de quien lo
 *  importa. */
const aCore = (p: string): string => relative(coreRoot, join(raizRepo, p)).split("\\").join("/");

export interface Origen {
  ficheros: string[];
  descripcion: string;
}

/** De dónde salen los ficheros cambiados. Fail-loud: si git no puede contestar
 *  (no hay merge-base, la ref no existe), NO se devuelve una lista vacía —
 *  una lista vacía se leería como "no hay nada que medir". */
export function ficherosCambiados(argv: readonly string[]): Origen {
  const explicitos = argv.indexOf("--ficheros");
  if (explicitos >= 0) {
    const ficheros = argv.slice(explicitos + 1).filter((a) => !a.startsWith("--"));
    return { ficheros: ficheros.map(aCore), descripcion: `lista explícita de ${ficheros.length} fichero(s)` };
  }
  const rango = valorDe(argv, "--rango");
  if (rango) return { ficheros: git(["diff", "--name-only", rango]).map(aCore), descripcion: rango };

  const ref = valorDe(argv, "--desde") ?? "main";
  const base = mergeBase(ref);
  const comiteados = git(["diff", "--name-only", `${base}..HEAD`]);
  const arbol = [
    ...git(["diff", "--name-only", "HEAD"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ];
  return {
    ficheros: [...comiteados, ...arbol].map(aCore),
    descripcion: `${ref}...HEAD (${base.slice(0, 7)}) + árbol de trabajo`,
  };
}

function mergeBase(ref: string): string {
  try {
    return git(["merge-base", ref, "HEAD"])[0];
  } catch {
    throw new Error(
      `no hay merge-base entre "${ref}" y HEAD: sin punto de partida no se puede saber qué ha cambiado. ` +
        `Usa --desde <ref> con una ref que exista, --rango <a>..<b>, o corre la mutación entera.`,
    );
  }
}

function valorDe(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`${flag} necesita un valor`);
  return v;
}

// ── salida ───────────────────────────────────────────────────────────────────

/** Mutantes medidos por módulo, del último informe. Solo con `--coste`: los
 *  informes suman decenas de MB y parsearlos cuesta segundos, y este comando
 *  tiene que poder correrse sin pensárselo. Un módulo sin informe cuenta 0 y se
 *  dice, en vez de estimarse. */
function mutantesPorModulo(ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of ids) {
    const ruta = rutaInforme(id);
    if (!existsSync(ruta)) continue;
    const rep = JSON.parse(readFileSync(ruta, "utf8")) as {
      files: Record<string, { mutants: { status: string }[] }>;
    };
    out.set(id, resumenDeMutantes(Object.values(rep.files).flatMap((f) => f.mutants)).total);
  }
  return out;
}

function imprimeCoste(sel: Seleccion, todos: readonly string[]): void {
  const medidos = mutantesPorModulo(todos);
  const suma = (ids: readonly string[]): number => ids.reduce((n, id) => n + (medidos.get(id) ?? 0), 0);
  const total = suma(todos);
  if (total === 0) {
    console.log("  coste: sin informes en reports/mutation/ — corre `npm run mutate` para poder compararlo");
    return;
  }
  const sinMedir = todos.filter((id) => !medidos.has(id));
  const pct = ((suma(sel.ids) / total) * 100).toFixed(0);
  console.log(
    `  coste: ${suma(sel.ids)} de ${total} mutantes medidos (${pct} %)` +
      (sinMedir.length > 0
        ? ` · ${sinMedir.length} módulo(s) sin informe, no cuentan: ${sinMedir.join(", ")}`
        : ""),
  );
}

function imprime(sel: Seleccion, origen: Origen, todos: readonly string[], coste: boolean): void {
  console.log(
    `\nMutación afectada · ${origen.ficheros.length} fichero(s) cambiado(s) · ${origen.descripcion}\n`,
  );

  if (sel.todos) {
    const razones = sel.efectos.filter((e) => e.todos);
    console.log(`  EJECUTA LOS ${todos.length} MÓDULOS — corrida completa. Porque:`);
    for (const e of razones) console.log(`    ${e.fichero}\n        ${e.porque}`);
  } else if (sel.ids.length === 0) {
    // Nunca un "ok" en silencio: si no sale nada, se enseña fichero a fichero
    // por qué, que es la única forma de distinguir "no hace falta medir" de
    // "el selector se ha quedado ciego".
    console.log(`  NO EJECUTA NADA — ningún módulo carga nada de lo que ha cambiado.`);
    console.log(`  Esto NO es un visto bueno: es que la mutación no tiene nada que decir de este diff.`);
  } else {
    console.log(
      `  EJECUTA ${sel.ids.length} de ${todos.length} módulos:  npm run mutate -- ${sel.ids.join(" ")}`,
    );
    for (const id of sel.ids) {
      const porQue = sel.efectos.filter((e) => e.ids.includes(id)).map((e) => e.fichero);
      console.log(
        `    ${id.padEnd(24)} ← ${porQue.slice(0, 3).join(", ")}${porQue.length > 3 ? ` (+${porQue.length - 3})` : ""}`,
      );
    }
    console.log(
      `\n  SE SALTA ${todos.length - sel.ids.length}: ${todos.filter((id) => !sel.ids.includes(id)).join(" ")}`,
    );
  }
  if (coste) imprimeCoste(sel, todos);

  console.log(`\n  Fichero a fichero:`);
  for (const e of sel.efectos) {
    const destino = e.todos ? "TODOS" : e.ids.length > 0 ? e.ids.join(", ") : "ninguno";
    console.log(`    ${e.fichero}\n        → ${destino}: ${e.porque}`);
  }
  console.log("");
}

function main(): void {
  const argv = process.argv.slice(2);
  const plan = leerPlan();
  const ctx = contextoDe(plan);
  const origen = ficherosCambiados(argv);
  const sel = seleccionar(ctx, origen.ficheros);
  if (argv.includes("--ids")) {
    console.log(JSON.stringify(sel.ids));
    return;
  }
  imprime(
    sel,
    origen,
    plan.modulos.map((m) => m.id),
    argv.includes("--coste"),
  );
}

// Importado (candado, runner) no imprime nada; solo al invocarlo como comando.
if (process.argv[1]?.endsWith("afectado.ts")) main();
