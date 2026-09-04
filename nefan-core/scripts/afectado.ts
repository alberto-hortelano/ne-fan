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
 *  que fuerzan la corrida completa: un cambio en el propio instrumento, un
 *  fuente que ya no está en el árbol, y —el caso que da sentido al candado de
 *  totalidad— un fichero del perímetro puro del que el plan no dice nada, ni
 *  mutándolo ni eximiéndolo en `sin_mutar`.
 *
 *  LO QUE **NO** ES INSTRUMENTO SE COMPRUEBA, NO SE DECLARA. Esa frase estaba
 *  escrita aquí desde `efectoDeSalida` y no se aplicaba a los tres sitios donde
 *  más costaba (#404). Hoy sí, y los tres se derivan:
 *
 *  · Un DATO del paquete lo fuerza a correr quien lo LEE (`ctx.leen`), no el
 *    cajón donde vive. Leer es nombrar el fichero o ENUMERAR su directorio —
 *    ver `leeElDato`, que sin la segunda mitad declaraba «no lo lee nadie» a
 *    una fixture de `data/scenes/` que alimenta dos baterías vivas.
 *  · `data/contract/arch-rules.json` es instrumento por UNA de sus reglas, y se
 *    evalúa por regla (`efectoDeArchRules`).
 *  · `data/contract/mutation-targets.json` se evalúa por su ESTRUCTURA, no
 *    entero (`efectoDeObjetivos`): anotar en el plan lo que acaba de medirse no
 *    puede costar la corrida completa siguiente.
 *  · El INSTRUMENTO de `scripts/` es el cierre de runtime de `mutate.ts` y
 *    `mutacion.ts` (`instrumentoDeMedida`), no el directorio entero: un guion
 *    que vive ahí y que además es sujeto de una batería —el caso real es
 *    `scripts/manifest-kinds-con-productor.ts`, en la de `asset-store-contrato`—
 *    selecciona su módulo y no los 41.
 *
 *  Ninguna de las cuatro relaja el criterio de arriba: si no hay contra qué
 *  comparar, si el fichero no se parsea o si lo que cambió es la parte que
 *  decide qué se mide, se ejecuta todo y se dice cuál de ellas fue.
 *
 *  Uso:
 *    npm run afectado                          # main...HEAD + árbol de trabajo
 *    npm run afectado -- --desde tooling/x     # desde otra rama o commit
 *    npm run afectado -- --rango a1b2c3~1..a1b2c3   # auditar un commit ya hecho
 *    npm run afectado -- --ficheros a.ts b.ts  # una lista explícita
 *    npm run afectado -- --ids                 # JSON de ids (matriz de CI)
 *    npm run afectado -- --coste               # además, qué % de los mutantes
 *
 *  Este comando NO mide: dice qué HABRÍA que medir. Medirlo es otra cosa y no
 *  se hace aquí — `npm run mutacion -- local <id>` si el módulo cabe en el tope
 *  local, y si no, `npm run mutacion -- pendiente` y lo autoriza una persona.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  alcanceDe,
  cierreDeRuntime,
  coreRoot,
  dueñoDe,
  leeElDato,
  leerPlan,
  patronesDelPerimetro,
  perimetro,
  proyeccionDeObjetivos,
  REGLA_PERIMETRO,
  resumenDeMutantes,
  rutaInforme,
  RUTA_ARCH_RULES,
  RUTA_HUELLA,
  RUTA_OBJETIVOS,
  type PlanMutacion,
} from "./mutation-plan.js";

const raizRepo = resolve(coreRoot, "..");
/** Cómo se llama el paquete desde la raíz del repo, que es como habla git. */
const nombrePaquete = relative(raizRepo, coreRoot).split("\\").join("/");

/** Lo que el propio instrumento de medida decide y no se puede alcanzar por el
 *  grafo de imports: la configuración con la que corre todo. Si cambia
 *  cualquiera de estos, lo que se mide o cómo se mide puede ser otro para TODOS
 *  los módulos, así que la selección de ayer no vale.
 *
 *  Los dos ficheros de `data/contract/` que aparecen aquí NO se evalúan
 *  enteros: `arch-rules.json` por regla (`efectoDeArchRules`) y
 *  `mutation-targets.json` por su estructura (`efectoDeObjetivos`). Están en la
 *  lista para que caigan del lado del instrumento y no del cajón de los datos;
 *  cuál de sus partes cambió lo deciden esas dos funciones. */
const TOOLING = [
  RUTA_OBJETIVOS,
  RUTA_ARCH_RULES,
  "stryker.config.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

/** Los guiones por los que PASA una medida. Todo lo demás de `scripts/` es un
 *  programa más que vive ahí.
 *
 *  Va derivado y no declarado: el instrumento es el cierre de RUNTIME de estas
 *  dos entradas (`instrumentoDeMedida`), así que trocear `mutate.ts` en dos
 *  ficheros no deja al segundo fuera del instrumento sin que nadie lo note —el
 *  modo de fallo de cualquier lista escrita a mano. Hoy salen cinco:
 *  `mutate.ts`, `mutacion.ts`, `mutacion-huella.ts`, `mutation-plan.ts` y el
 *  propio `afectado.ts`. `mutacion.ts` es hoy REDUNDANTE como entrada —
 *  `mutate.ts` la importa—, y está porque las dos son entradas del ciclo: el
 *  día que `mutate.ts` deje de importarla, sigue siendo instrumento.
 *
 *  Lo que ESTO deja fuera de `scripts/`, y por qué importa: los guiones que son
 *  sujeto de una batería. `scripts/manifest-kinds-con-productor.ts` está en el
 *  alcance de `asset-store-contrato`, y hasta hoy tocarlo pedía los 41 módulos
 *  (medido en #416). No es el instrumento: es código del asset-store que vive
 *  en `scripts/`. */
const ENTRADAS_INSTRUMENTO = ["scripts/mutate.ts", "scripts/mutacion.ts"];

/** El cierre de runtime de las entradas de arriba, más ellas mismas: si una se
 *  borra, `cierreDeRuntime` no la puede seguir y aun así hay que tratarla como
 *  instrumento. */
export function instrumentoDeMedida(): ReadonlySet<string> {
  return new Set([...ENTRADAS_INSTRUMENTO, ...cierreDeRuntime(ENTRADAS_INSTRUMENTO)]);
}

export type Clase = "fuente" | "test" | "tooling" | "dato" | "salida" | "ajeno";

/** En qué cajón cae un fichero cambiado, dada su ruta relativa a nefan-core
 *  (los de fuera del paquete llegan con `../`, que es como los normaliza la
 *  traza de imports).
 *
 *  Lo que el CAJÓN ya no decide: si un `scripts/*.ts` es el instrumento. Eso lo
 *  contesta `ctx.instrumento` antes de llegar aquí, porque es una pregunta
 *  derivada del grafo y no de la carpeta; los que no lo son entran por la misma
 *  puerta que un fuente, y los selecciona quien los cargue. */
export function clasifica(ruta: string): Clase {
  if (ruta.startsWith("../")) return "ajeno";
  if (TOOLING.some((t) => (t.endsWith("/") ? ruta.startsWith(t) : ruta === t))) return "tooling";
  // ANTES de la regla del `.ts`, que manda a "dato" cualquier JSON del paquete
  // y de ahí a sus lectores. Ver `efectoDeSalida`.
  if (ruta === RUTA_HUELLA) return "salida";
  if (!ruta.endsWith(".ts")) return "dato";
  if (ruta.startsWith("test/")) return "test";
  // Todo `.ts` del paquete que no sea test ni instrumento es CÓDIGO, viva donde
  // viva, y al código se le pregunta QUIÉN LO CARGA. Antes los que no estaban
  // en `src|bridge|services` caían en "dato" y de ahí a la corrida completa;
  // ahora "dato" se deriva por LECTORES, y preguntar por el nombre de un `.ts`
  // dentro de un literal sería la pregunta equivocada —y la permisiva.
  return "fuente";
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
  /** Los módulos cuya corrida ejecuta código que LEE ese dato: nombrándolo, o
   *  enumerando su directorio. El grafo de imports no ve una lectura de disco;
   *  esto sí. Recibe la RUTA relativa a nefan-core, no el nombre suelto: sin el
   *  directorio no se puede preguntar quién lo enumera. */
  leen: (rutaDelDato: string) => string[];
  /** Si este fichero es el instrumento de medida. Derivado del grafo, no de la
   *  carpeta: ver `instrumentoDeMedida`. */
  instrumento: (fichero: string) => boolean;
  /** Qué hace un cambio en `arch-rules.json` con lo que se mide. Se consulta
   *  solo si el diff lo toca, porque comparar dos versiones cuesta un `git
   *  show`. */
  archRules: () => EfectoArchRules;
  /** Lo mismo para `mutation-targets.json`, que además puede señalar a módulos
   *  concretos: es el fichero donde cada uno declara qué muta y con qué. */
  objetivos: () => EfectoObjetivos;
}

/** El veredicto sobre un cambio en `arch-rules.json`: si puede cambiar QUÉ se
 *  muta, y por qué. `porque` nunca va vacío en ninguna de las dos ramas — la
 *  que fuerza la corrida completa tiene que decir qué la fuerza, y la que la
 *  descarta tiene que decir sobre qué se apoya para descartarla. */
export interface EfectoArchRules {
  fuerzaTodo: boolean;
  porque: string;
}

/** El veredicto sobre un cambio en `mutation-targets.json`. A diferencia de
 *  `arch-rules.json`, aquí hay un tercer estado además de «todo» y «nada»: los
 *  módulos cuya definición cambió. `porque` nunca va vacío en ninguna rama. */
export interface EfectoObjetivos {
  fuerzaTodo: boolean;
  ids: string[];
  porque: string;
}

export function contextoDe(plan: PlanMutacion, revisiones?: Revisiones): Contexto {
  const alcances = new Map<string, readonly string[]>(plan.modulos.map((m) => [m.id, [...alcanceDe(m)]]));
  const instrumento = instrumentoDeMedida();
  return {
    alcances,
    baterias: new Map(plan.modulos.map((m) => [m.id, m.tests])),
    perimetro: new Set(perimetro(plan)),
    dueño: (f) => dueñoDe(plan, f),
    existe: (f) => existsSync(join(coreRoot, f)),
    leen: (dato) =>
      [...alcances].filter(([, alcance]) => alcance.some((f) => leeElDato(f, dato))).map(([id]) => id),
    instrumento: (f) => instrumento.has(f),
    archRules: () => efectoArchRules(revisiones),
    objetivos: () => efectoObjetivos(revisiones),
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

/** `arch-rules.json`, evaluado por REGLA y no entero.
 *
 *  El fichero es instrumento de medida, y bien clasificado: de él sale el
 *  perímetro de mutación (`perimetro`, en mutation-plan.ts). Pero sale de UNA
 *  de sus reglas. Añadir una regla de fronteras nueva —o tocar una que habla de
 *  `qa/guiones/**` o del cliente— no puede cambiar qué se muta ni en teoría, y
 *  hasta hoy pagaba la corrida completa entera. Eso empuja a no añadir reglas,
 *  que es lo contrario de lo que esta casa quiere.
 *
 *  Lo que se compara es la PROYECCIÓN que el perímetro usa, sacada del fichero
 *  antes y después del diff. Sin las dos versiones no hay comparación posible,
 *  y entonces se ejecuta de más y se dice — acotar la corrida no es motivo para
 *  negociar ese criterio.
 *
 *  Descartada la regla del perímetro, queda un dato como cualquier otro: lo
 *  fuerza a correr quien lo LEA en runtime, y eso se deriva (`ctx.leen`) en vez
 *  de darlo por sabido. Hoy sus dos lectores —`test/architecture.test.ts` y
 *  `test/mutation-config.test.ts`— no están en la batería de ningún módulo; el
 *  día que uno lo esté, saldrá seleccionado solo. */
function efectoDeArchRules(ctx: Contexto): Efecto {
  const v = ctx.archRules();
  if (v.fuerzaTodo) {
    return { fichero: RUTA_ARCH_RULES, clase: "tooling", ids: [], todos: true, porque: v.porque };
  }
  const ids = ctx.leen(RUTA_ARCH_RULES);
  return {
    fichero: RUTA_ARCH_RULES,
    clase: "tooling",
    ids,
    todos: false,
    porque:
      `${v.porque}, así que no puede cambiar qué se muta; ` +
      (ids.length > 0
        ? "y esas baterías lo leen en runtime"
        : "y ninguna batería de mutación ejecuta código que lo lea"),
  };
}

/** La huella de la última corrida (`data/contract/mutacion-huella.json`) es la
 *  SALIDA de la medida, no su instrumento — y esa diferencia vale la corrida
 *  completa.
 *
 *  Sin esta rama el fichero cae en `clasifica` → "dato" (es un `.json` dentro
 *  del paquete) y de ahí a `todos: true`, con una explicación perfectamente
 *  razonable —«los tests lo leen en runtime y eso no aparece en ningún grafo de
 *  imports»— que nadie leería como un bug. El autogol sería permanente y no
 *  ocasional: la huella cambia en CADA corrida, y `deuda` juzga la frescura con
 *  el diff desde el tag, así que a partir de la primera medida los 20 módulos
 *  saldrían "posiblemente obsoletos" para siempre y la corrida seleccionada
 *  pasaría de 300 mutantes a 9.040. Y `ficherosCambiados` incluye lo no
 *  trackeado (`afectado.ts:444`), así que saltaría antes incluso de commitear.
 *
 *  Que NO es instrumento se comprueba, no se declara: quien la lea en runtime la
 *  fuerza a correr igual que a cualquier otro dato (`ctx.leen`). Hoy no la lee
 *  ninguna batería —solo `scripts/`, que ya es tooling por su cuenta—; el día
 *  que una lo haga, saldrá seleccionada sola. */
function efectoDeSalida(ctx: Contexto, f: string): Efecto {
  const ids = ctx.leen(f);
  return {
    fichero: f,
    clase: "salida",
    ids,
    todos: false,
    porque:
      "es la SALIDA de la medida (la huella de la última corrida), no su instrumento: " +
      (ids.length > 0
        ? "pero esas baterías la leen en runtime"
        : "no la lee ninguna batería, así que no puede cambiar la suerte de un solo mutante"),
  };
}

/** Un dato del paquete: lo fuerza a correr QUIEN LO LEE, no el cajón donde
 *  vive.
 *
 *  Hasta #404 esta rama devolvía `todos: true` con una explicación
 *  perfectamente razonable —«los tests lo leen en runtime y eso no aparece en
 *  ningún grafo de imports»— que anulaba el selector entero: `data/contract/
 *  client-file-size.json`, que solo lee un test que no es sujeto de ninguna
 *  batería, convertía en corrida completa cualquier PR de cliente (medido en
 *  #412, #415 y #416).
 *
 *  La vía es la misma que ya usaban `efectoDeSalida` y `efectoDeArchRules`, y
 *  no una lista `datos: {ruta → módulos}`: una lista tiene por defecto el
 *  SILENCIO para el fichero que nadie clasificó, y aquí el defecto tiene que
 *  ser calculado. `leeElDato` cuenta las dos formas de leer —nombrar el fichero
 *  y enumerar su directorio—, porque con solo la primera una fixture de
 *  `data/scenes/` salía «no la lee nadie» alimentando dos baterías vivas. */
function efectoDeDato(ctx: Contexto, f: string): Efecto {
  const ids = ctx.leen(f);
  return {
    fichero: f,
    clase: "dato",
    ids,
    todos: false,
    porque:
      ids.length > 0
        ? "es un dato del paquete, y esas baterías ejecutan código que lo lee (lo nombra o enumera su directorio)"
        : "es un dato del paquete y ninguna batería ejecuta código que lo lea: ni lo nombra ni enumera su directorio",
  };
}

/** `mutation-targets.json`, evaluado por su ESTRUCTURA y no entero.
 *
 *  Es el instrumento —de aquí sale qué se muta y con qué batería—, pero también
 *  es donde se ESCRIBE lo que una corrida acaba de medir: el suelo nuevo y el
 *  `porque` con los números. Tratándolo entero, anotar la medida costaba la
 *  corrida completa siguiente (medido en #416: los 41 módulos por subir un
 *  suelo), y el precio de dejar dicho lo que se midió era volver a medirlo
 *  todo. Es el mismo argumento por el que `arch-rules.json` se evalúa por
 *  regla, y lleva a la misma conclusión: la PROSA no selecciona, la ESTRUCTURA
 *  sí.
 *
 *  Tres respuestas y no dos. Si cambia lo global —el comando, los directorios
 *  que se miden enteros, las exenciones— puede ser otro lo que se mide para
 *  todos, y va la completa. Si cambia la definición de un módulo, va ESE
 *  módulo. Si solo cambia prosa, no va nadie. Y sin dos versiones que comparar,
 *  la completa, como en `efectoArchRules`. */
function efectoDeObjetivos(ctx: Contexto): Efecto {
  const v = ctx.objetivos();
  const leen = ctx.leen(RUTA_OBJETIVOS);
  if (v.fuerzaTodo) {
    return { fichero: RUTA_OBJETIVOS, clase: "tooling", ids: [], todos: true, porque: v.porque };
  }
  const ids = [...new Set([...v.ids, ...leen])];
  return {
    fichero: RUTA_OBJETIVOS,
    clase: "tooling",
    ids,
    todos: false,
    porque:
      v.porque +
      (leen.length > 0 ? "; y además esas baterías lo leen en runtime" : ""),
  };
}

function efectoDe(ctx: Contexto, f: string): Efecto {
  // El instrumento se pregunta ANTES que el cajón: `scripts/` no es una
  // carpeta de instrumento, es una carpeta donde además vive el instrumento.
  if (ctx.instrumento(f)) {
    return {
      fichero: f,
      clase: "tooling",
      ids: [],
      todos: true,
      porque:
        "es el instrumento de medida: lo que se mide, con qué o dónde puede ser otro para todos los módulos",
    };
  }
  const clase = clasifica(f);
  if (clase === "fuente") return efectoDeFuente(ctx, f);
  if (clase === "salida") return efectoDeSalida(ctx, f);
  if (f === RUTA_ARCH_RULES) return efectoDeArchRules(ctx);
  if (f === RUTA_OBJETIVOS) return efectoDeObjetivos(ctx);
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
  if (clase === "dato") return efectoDeDato(ctx, f);
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

/** Las dos puntas del diff, para los ficheros que hay que comparar CONTENIDO a
 *  contenido y no solo "ha cambiado". `despues: null` es el árbol de trabajo —
 *  que es de donde saldría lo que se va a medir. */
export interface Revisiones {
  antes: string;
  despues: string | null;
}

export interface Origen {
  ficheros: string[];
  descripcion: string;
  /** De qué a qué. `undefined` con `--ficheros`: una lista suelta no dice de
   *  qué revisión viene, y eso hay que poder decirlo en vez de suponerlo. */
  revisiones?: Revisiones;
}

type Lectura = { ok: true; texto: string } | { ok: false; porque: string };

/** El contenido de un fichero del paquete en una revisión, o en el árbol de
 *  trabajo (`rev: null`). Devuelve el motivo en vez de vacío: "no está" y "no
 *  se pudo leer" llevan a la misma decisión —ejecutar de más— pero no a la
 *  misma frase, y la frase es lo que deja auditar la decisión. */
function contenidoDe(rev: string | null, ruta: string): Lectura {
  if (rev === null) {
    const abs = join(coreRoot, ruta);
    if (!existsSync(abs)) return { ok: false, porque: `${ruta} no está en el árbol de trabajo` };
    return { ok: true, texto: readFileSync(abs, "utf8") };
  }
  try {
    return {
      ok: true,
      texto: execFileSync("git", ["show", `${rev}:${nombrePaquete}/${ruta}`], {
        cwd: raizRepo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (err) {
    return { ok: false, porque: `no se pudo leer ${ruta} en ${rev}: ${primeraLinea(err)}` };
  }
}

const primeraLinea = (err: unknown): string => String((err as Error).message).split("\n")[0];

/** ¿Puede este cambio de `arch-rules.json` alterar QUÉ se muta? Solo si cambia
 *  la regla de la que sale el perímetro. Cualquier duda —no hay contra qué
 *  comparar, no se lee una de las dos versiones, no se parsea, la regla ya no
 *  está— se resuelve corriéndolo todo y diciendo cuál de ellas fue. */
export function efectoArchRules(revisiones?: Revisiones): EfectoArchRules {
  const deQue = `de ${RUTA_ARCH_RULES} sale el perímetro de mutación (regla "${REGLA_PERIMETRO}")`;
  if (!revisiones) {
    return {
      fuerzaTodo: true,
      porque: `${deQue}, y una lista explícita de ficheros no dice contra qué versión compararlo`,
    };
  }
  const antes = contenidoDe(revisiones.antes, RUTA_ARCH_RULES);
  if (!antes.ok) return { fuerzaTodo: true, porque: `${deQue}, y ${antes.porque}` };
  const despues = contenidoDe(revisiones.despues, RUTA_ARCH_RULES);
  if (!despues.ok) return { fuerzaTodo: true, porque: `${deQue}, y ${despues.porque}` };

  return comparaPerimetro(
    { texto: antes.texto, nombre: revisiones.antes },
    { texto: despues.texto, nombre: revisiones.despues ?? "el árbol de trabajo" },
  );
}

/** La comparación en sí, sobre los dos CONTENIDOS. Separada de dónde salieron
 *  para que el candado pueda ejercerla con dos ficheros escritos a mano: contra
 *  git, el caso «la regla cambió» solo se puede probar fabricando commits, y un
 *  candado que cuesta eso acaba no probándose en la dirección que importa. */
export function comparaPerimetro(
  antes: { texto: string; nombre: string },
  despues: { texto: string; nombre: string },
): EfectoArchRules {
  const deQue = `de ${RUTA_ARCH_RULES} sale el perímetro de mutación (regla "${REGLA_PERIMETRO}")`;
  const pAntes = patronesDelPerimetro(antes.texto);
  if (!pAntes.ok) return { fuerzaTodo: true, porque: `${deQue}, y en ${antes.nombre} ${pAntes.porque}` };
  const pDespues = patronesDelPerimetro(despues.texto);
  if (!pDespues.ok) return { fuerzaTodo: true, porque: `${deQue}, y en ${despues.nombre} ${pDespues.porque}` };

  const iguales = JSON.stringify(pAntes.patrones) === JSON.stringify(pDespues.patrones);
  return iguales
    ? {
        fuerzaTodo: false,
        porque: `la regla "${REGLA_PERIMETRO}" —la única de la que sale el perímetro de mutación— es idéntica antes y después`,
      }
    : {
        fuerzaTodo: true,
        porque: `cambia la regla "${REGLA_PERIMETRO}", de la que sale el perímetro de mutación: lo que se mide puede ser otro`,
      };
}

/** ¿Qué puede cambiar este diff de `mutation-targets.json`? Misma forma que
 *  `efectoArchRules`: sin las dos versiones no hay comparación posible, y
 *  entonces se ejecuta de más y se dice cuál faltó. */
export function efectoObjetivos(revisiones?: Revisiones): EfectoObjetivos {
  const deQue = `de ${RUTA_OBJETIVOS} sale qué se muta y con qué batería`;
  if (!revisiones) {
    return {
      fuerzaTodo: true,
      ids: [],
      porque: `${deQue}, y una lista explícita de ficheros no dice contra qué versión compararlo`,
    };
  }
  const antes = contenidoDe(revisiones.antes, RUTA_OBJETIVOS);
  if (!antes.ok) return { fuerzaTodo: true, ids: [], porque: `${deQue}, y ${antes.porque}` };
  const despues = contenidoDe(revisiones.despues, RUTA_OBJETIVOS);
  if (!despues.ok) return { fuerzaTodo: true, ids: [], porque: `${deQue}, y ${despues.porque}` };

  return comparaObjetivos(
    { texto: antes.texto, nombre: revisiones.antes },
    { texto: despues.texto, nombre: revisiones.despues ?? "el árbol de trabajo" },
  );
}

/** La comparación en sí, sobre los dos CONTENIDOS y separada de dónde salieron,
 *  por lo mismo que `comparaPerimetro`: los casos que importan —solo cambió la
 *  prosa, cambió un suelo, cambió el comando— se prueban con dos ficheros
 *  escritos a mano, y no fabricando commits. */
export function comparaObjetivos(
  antes: { texto: string; nombre: string },
  despues: { texto: string; nombre: string },
): EfectoObjetivos {
  const deQue = `de ${RUTA_OBJETIVOS} sale qué se muta y con qué batería`;
  const pAntes = proyeccionDeObjetivos(antes.texto);
  if (!pAntes.ok) return { fuerzaTodo: true, ids: [], porque: `${deQue}, y en ${antes.nombre} ${pAntes.porque}` };
  const pDespues = proyeccionDeObjetivos(despues.texto);
  if (!pDespues.ok) {
    return { fuerzaTodo: true, ids: [], porque: `${deQue}, y en ${despues.nombre} ${pDespues.porque}` };
  }

  if (pAntes.proyeccion.global !== pDespues.proyeccion.global) {
    return {
      fuerzaTodo: true,
      ids: [],
      porque: `cambia el \`comando\` de ${RUTA_OBJETIVOS}: con qué se ejecuta cada mutante es otro para todos`,
    };
  }
  // Un módulo que DESAPARECE deja de medirse, y lo que mutaba puede haberse
  // quedado sin dueño sin que ninguno de sus ficheros salga en el diff. No se
  // le puede "seleccionar" —ya no existe—, así que es de los pocos sitios donde
  // el lado seguro sigue siendo la completa. Sale barato porque es rarísimo.
  const idos = [...pAntes.proyeccion.modulos.keys()].filter((id) => !pDespues.proyeccion.modulos.has(id));
  if (idos.length > 0) {
    return {
      fuerzaTodo: true,
      ids: [],
      porque: `desaparece(n) del plan ${idos.join(", ")}: lo que mutaban puede haberse quedado sin dueño`,
    };
  }
  const ids = [...pDespues.proyeccion.modulos]
    .filter(([id, def]) => pAntes.proyeccion.modulos.get(id) !== def)
    .map(([id]) => id);
  return {
    fuerzaTodo: false,
    ids,
    porque:
      ids.length > 0
        ? `cambia la definición de ${ids.join(", ")} (qué muta, con qué batería, con qué suelo o con qué exclusiones)`
        : `solo cambia prosa, los topes de coste o el perímetro de ${RUTA_OBJETIVOS}, y nada de eso cambia la suerte de un mutante`,
  };
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
  if (rango) {
    return {
      ficheros: git(["diff", "--name-only", rango]).map(aCore),
      descripcion: rango,
      revisiones: revisionesDelRango(rango),
    };
  }

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
    // Lo que se va a medir es el ÁRBOL, no HEAD: el diff incluye lo que aún no
    // está comiteado.
    revisiones: { antes: base, despues: null },
  };
}

/** Las dos puntas de un rango de git, en las tres formas que `git diff` acepta:
 *  `a..b` (b vacío = HEAD), `a...b` (desde donde se separaron) y `a` a secas,
 *  que compara contra el árbol de trabajo. */
export function revisionesDelRango(rango: string): Revisiones {
  if (rango.includes("...")) {
    const [izq, der] = rango.split("...");
    const despues = der || "HEAD";
    return { antes: git(["merge-base", izq || "HEAD", despues])[0], despues };
  }
  if (rango.includes("..")) {
    const [izq, der] = rango.split("..");
    return { antes: izq || "HEAD", despues: der || "HEAD" };
  }
  return { antes: rango, despues: null };
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
    console.log(
      "  coste: sin informes en reports/mutation/ — bájalos con `npm run mutacion -- traer` para poder compararlo",
    );
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
      `  HABRÍA QUE MEDIR ${sel.ids.length} de ${todos.length} módulos: ${sel.ids.join(" ")}\n` +
        `  (uno barato, aquí: npm run mutacion -- local <id> · el resto se pide: npm run mutacion -- pendiente)`,
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
  const origen = ficherosCambiados(argv);
  const sel = seleccionar(contextoDe(plan, origen.revisiones), origen.ficheros);
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
