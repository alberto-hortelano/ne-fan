/** El plan de mutación: qué se muta y con qué tests, en un solo sitio.
 *
 *  Con `testRunner: "command"` Stryker no ve los tests uno a uno, así que
 *  `coverageAnalysis` va en `off` y CADA mutante ejecuta la batería ENTERA que
 *  se le pase. Eso convierte la elección de la batería en el único dial de
 *  coste que existe: mutar `combat-resolver.ts` corriendo los tests de
 *  `scene-normalize` no puede matar un solo mutante, pero se paga íntegro.
 *  Medido el 2026-08-23 sobre la corrida de un solo config: 1684 mutantes,
 *  146,1 min de CPU y 9m39 de reloj, con ocho ficheros de test por mutante de
 *  los que la mayoría ni siquiera importaba el fichero mutado.
 *
 *  De ahí el reparto por módulo: un config de Stryker por módulo, cada uno con
 *  los tests que PUEDEN matarlo. La lista vive en
 *  `data/contract/mutation-targets.json` y este fichero es su única puerta:
 *  la usan el runner (`scripts/mutate.ts`), la cola de deuda
 *  (`scripts/deuda.ts`) y el candado (`test/mutation-config.test.ts`).
 *
 *  La batería NO es una elección libre: `test/mutation-config.test.ts` la
 *  contrasta contra la traza de imports real (`testsQueImportan`), así que un
 *  test que importa un fichero mutado y no está en su batería hace fallar
 *  `npm test`. Es la misma clase de fallo que el objetivo que apuntaba a una
 *  ruta inexistente y pasó meses midiendo el vacío en verde.
 */
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const coreRoot = join(here, "..");

/** El suelo de un módulo que TODAVÍA NO SE HA MEDIDO.
 *
 *  Existe porque la alternativa que se usaba —`break: 0`— es un gate
 *  permanentemente verde disfrazado de suelo: aprueba cualquier score, nadie lo
 *  vuelve a mirar y el módulo se queda así. No es hipotético:
 *  `asset-store-contrato` estrenó con 0 y llevaba TRES tandas (#354, #380,
 *  #389) con su medida ya commiteada en la huella y su suelo sin subir.
 *
 *  Un módulo nuevo no puede traer su suelo puesto: `permisoLocal` rechaza el
 *  coste desconocido, así que la PRIMERA medida de cualquier módulo exige una
 *  corrida autorizada. El estado «lo estrené y aún no se ha medido» es real y
 *  dura días; lo que no puede es ser indistinguible de «medí y salió 0». Con
 *  este valor se dice, y el candado de `test/mutation-config.test.ts` lo
 *  caduca en cuanto la huella trae la medida. */
export const SIN_MEDIR = "sin medir";

const ModuloSchema = z.object({
  /** Identifica el config generado y el informe: `reports/mutation/<id>.json`. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Rutas o globs relativos a nefan-core. Lo que Stryker muta. */
  mutate: z.array(z.string()).nonempty(),
  /** La batería: los ficheros de test que se ejecutan por cada mutante. */
  tests: z.array(z.string()).nonempty(),
  /** Suelo de score de ESTE módulo. Es su línea base MEDIDA redondeada hacia
   *  abajo, no un número a ojo: sube cuando se maten supervivientes. Un suelo
   *  por módulo es más estricto que uno global — el global lo aprobaba un
   *  módulo grande y bien probado tapando a uno pequeño y ciego.
   *
   *  O `SIN_MEDIR` mientras el módulo no tenga corrida: entonces NO se aplica
   *  suelo y se dice en voz alta, en vez de escribir un 0 que aprueba todo y
   *  parece un número. Es un estado con fecha de caducidad, no una opción: el
   *  candado se pone rojo en cuanto la huella trae su medida. */
  break: z.union([z.number().min(0).max(100), z.literal(SIN_MEDIR)]),
  /** Tests que SÍ importan lo que el módulo muta y aun así se quedan fuera de
   *  la batería. Es la única forma de saltarse el candado, y lleva motivo
   *  obligatorio: la excepción sin razón escrita es indistinguible del
   *  descuido que este fichero existe para impedir. */
  excluidos: z
    .array(z.object({ test: z.string(), porque: z.string().min(10) }))
    .optional()
    .default([]),
  /** Por qué esos ficheros y esa batería. Obligatorio: sin motivo escrito, el
   *  reparto se convierte en folclore en dos meses. */
  porque: z.string().min(10),
  // `.strict()` y no por gusto: la proyección de `scripts/afectado.ts` compara
  // clave a clave, y una clave que el schema no conoce se strippearía en
  // silencio y no seleccionaría nunca. Aquí salta al leer el plan.
}).strict();

const ExentoSchema = z.object({
  /** Ruta o glob relativo a nefan-core. */
  fichero: z.string(),
  /** Por qué NO se mide. Obligatorio y con longitud mínima por el mismo motivo
   *  que `porque` en un módulo: una exención sin razón escrita es
   *  indistinguible del descuido, y `sin_mutar` es justo donde se convertiría
   *  en vertedero. */
  porque: z.string().min(10),
});

const PlanSchema = z.object({
  _comment: z.string().optional(),
  /** Prefijo del comando de test. La batería del módulo se le añade detrás.
   *  El tope de heap va aquí y no en argv porque `node --test` abre un proceso
   *  hijo por fichero y los hijos NO heredan las flags del padre. */
  comando: z.string(),
  /** Cuántos mutantes puede llegar a medir un módulo en la máquina de quien
   *  está programando (`npm run mutacion -- local <id>`). No es una política
   *  sino aritmética: el coste está muy mal repartido —41 mutantes el módulo
   *  más barato, 1.362 el más caro— y sin tope la única regla posible era
   *  "no midas nada", que dejaba a CLAUDE.md pidiendo supervivientes muertos
   *  sin dar con qué mirarlos. Obligatorio y sin defecto: un tope que se puede
   *  omitir es un tope que desaparece sin que nadie lo note. */
  tope_local: z.number().int().positive(),
  /** Cuántos SEGUNDOS DE RELOJ puede llegar a durar un lote de la corrida en
   *  CI (`npm run mutacion -- lotes`). Está en segundos y no en mutantes a
   *  propósito: lo que se está presupuestando es el `timeout-minutes` de un
   *  job, y el mutante no es una unidad de tiempo — `blueprint-derive` tiene
   *  484 mutantes y tarda 1.647 s, y `world-map` tiene más peso por cualquier
   *  proxy y tarda 701.
   *
   *  Se calibra con el DÍA MALO y no con la media: el factor medido entre las
   *  dos últimas corridas completas fue 1,31 uniforme sobre los 25 módulos
   *  comunes, así que un presupuesto ajustado a la media se sale la mitad de
   *  las veces. Planificar sobre el día malo es un margen de un tercio ya
   *  pagado. Obligatorio y sin defecto, por lo mismo que `tope_local`. */
  tope_lote: z.number().int().positive(),
  /** Directorios que se miden ENTEROS. El candado exige que cada `.ts` de
   *  estos esté nombrado por algún módulo: si no, un fichero nuevo se cuela
   *  sin que nadie lo mida y nada falla — el agujero por el que un objetivo
   *  se queda huérfano. Los directorios donde solo se muta un fichero suelto
   *  (src/scene, src/combat) NO van aquí.
   *
   *  Esta lista ENSANCHA el perímetro, que por lo demás sale de la regla
   *  `core-puro-sin-node` de `arch-rules.json`. Por eso el motivo es
   *  obligatorio: meter un directorio aquí y no en la regla es una decisión con
   *  razón, no un atajo, y sin escribirla parece arbitraria a los dos meses.
   *  El caso que la obligó: `src/narrative` no puede entrar en la regla porque
   *  `session-storage.ts` importa `node:fs` y el build se pondría rojo. */
  directorios_completos: z
    .array(z.object({ directorio: z.string(), porque: z.string().min(10) }))
    .default([]),
  /** Los ficheros del perímetro que NO se mutan, con su motivo.
   *
   *  Existe para que la pregunta «¿qué hay que ejecutar si cambia este
   *  fichero?» tenga respuesta para TODOS los ficheros del perímetro puro, no
   *  solo para los que alguien se acordó de meter en un módulo. Sin esta
   *  lista, un diff que toca únicamente ficheros sin dueño selecciona cero
   *  módulos y sale verde sin que nadie mida nada — el mismo fallo silencioso
   *  del objetivo que apuntaba a una ruta muerta.
   *
   *  Estar aquí no exime de nada más: si el fichero está en el alcance de la
   *  batería de algún módulo, `scripts/afectado.ts` sigue seleccionando ese
   *  módulo cuando cambia. Lo que declara es que NADIE lo muta, y por qué. */
  sin_mutar: z.array(ExentoSchema).default([]),
  modulos: z.array(ModuloSchema).nonempty(),
  // Ver `ModuloSchema`: una clave global desconocida tampoco puede entrar sin
  // que alguien decida si selecciona o no.
}).strict();

export type ModuloMutacion = z.infer<typeof ModuloSchema>;
export type ExentoMutacion = z.infer<typeof ExentoSchema>;
export type PlanMutacion = z.infer<typeof PlanSchema>;

/** El plan, relativo a nefan-core — que es como habla el selector. */
export const RUTA_OBJETIVOS = "data/contract/mutation-targets.json";

export const RUTA_PLAN = join(coreRoot, RUTA_OBJETIVOS);

/** La huella de la última corrida, relativa a nefan-core. Es lo ÚNICO que se
 *  commitea de una medida: el informe entero son 76 MB (`plugins-dsl` 20 MB él
 *  solo) y además lleva el código fuente de cada `replacement`.
 *
 *  Va versionada a propósito. `reports/` está gitignorado, es por-worktree y
 *  `mutate.ts:91-95` borra el informe ANTES de correr —deliberadamente, para
 *  que una corrida caída no deje enseñando el veredicto de la semana pasada—,
 *  así que no hay sitio ahí para el estado anterior. Commitearla da además algo
 *  que este repositorio no tenía: el delta se ve EN EL DIFF, y «esta corrida
 *  añade 4 supervivientes» deja de ser prosa generada para ser un cambio
 *  revisable. */
export const RUTA_HUELLA = "data/contract/mutacion-huella.json";

/** Lee y VALIDA el plan. Fail-loud a propósito: un plan mal formado que se
 *  degrada a "no hay módulos" es otra forma de medir el vacío en verde. */
export function leerPlan(ruta: string = RUTA_PLAN): PlanMutacion {
  const crudo: unknown = JSON.parse(readFileSync(ruta, "utf8"));
  const parsed = PlanSchema.safeParse(crudo);
  if (!parsed.success) {
    throw new Error(
      `${relative(coreRoot, ruta)} inválido: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

export function moduloPorId(plan: PlanMutacion, id: string): ModuloMutacion {
  const m = plan.modulos.find((x) => x.id === id);
  if (!m)
    throw new Error(
      `módulo de mutación desconocido: "${id}". Hay: ${plan.modulos.map((x) => x.id).join(", ")}`,
    );
  return m;
}

/** Los ficheros concretos que un módulo muta, con los globs ya expandidos y las
 *  exclusiones (`!ruta`, la sintaxis de Stryker) aplicadas. Ordenado para que
 *  dos corridas den la misma lista. */
export function ficherosMutados(modulo: ModuloMutacion): string[] {
  const out = new Set<string>();
  for (const patron of modulo.mutate) {
    const negado = patron.startsWith("!");
    const limpio = negado ? patron.slice(1) : patron;
    for (const f of expande(limpio)) {
      if (negado) out.delete(f);
      else out.add(f);
    }
  }
  return [...out].sort();
}

/** Todo fichero que los patrones de un módulo NOMBRAN, se muten o no. Un
 *  `!src/world-map/index.ts` no se muta pero sí está declarado, y esa
 *  diferencia es la que separa "excluido a propósito" de "se le olvidó a
 *  alguien" cuando el candado busca ficheros huérfanos. */
export function ficherosDeclarados(modulo: ModuloMutacion): string[] {
  const out = new Set<string>();
  for (const patron of modulo.mutate) {
    for (const f of expande(patron.startsWith("!") ? patron.slice(1) : patron)) out.add(f);
  }
  return [...out].sort();
}

/** Los globs se expanden muchas veces (el candado recorre 17 módulos por cada
 *  comprobación) y `globSync` toca disco, así que el resultado se memoiza. Los
 *  scripts son procesos cortos: el árbol no cambia bajo sus pies. */
const cacheGlobs = new Map<string, string[]>();

function expande(patron: string): string[] {
  const previo = cacheGlobs.get(patron);
  if (previo) return previo;
  const out = patron.includes("*")
    ? globSync(patron, { cwd: coreRoot }).map(normaliza)
    : existsSync(join(coreRoot, patron))
      ? [normaliza(patron)]
      : [];
  cacheGlobs.set(patron, out);
  return out;
}

const normaliza = (p: string): string => p.split("\\").join("/");

/** El fichero de fronteras, relativo a nefan-core. El instrumento de medida lo
 *  usa por UNA de sus reglas (`REGLA_PERIMETRO`), no entero: ver
 *  `patronesDelPerimetro`. */
export const RUTA_ARCH_RULES = "data/contract/arch-rules.json";

export type PatronesPerimetro = { ok: true; patrones: string[] } | { ok: false; porque: string };

/** Lo ÚNICO que el perímetro de mutación toma de `arch-rules.json`: los `files`
 *  de la regla que declara el núcleo puro, ya sin el prefijo del paquete.
 *
 *  Está aislado en una función que recibe el CONTENIDO —y no la ruta— porque
 *  `scripts/afectado.ts` la aplica a dos versiones del fichero (antes y después
 *  del diff) para decidir si un cambio de fronteras puede alterar qué se muta.
 *  Que sea la MISMA proyección que usa `perimetro` no es una coincidencia que
 *  haya que recordar: si mañana el perímetro empezara a mirar otro campo, lo
 *  miraría desde aquí, y la comparación del selector lo vería sola. Dos
 *  lecturas paralelas del mismo fichero es justo el fallo mudo que este
 *  perímetro existe para cerrar. */
export function patronesDelPerimetro(contenido: string): PatronesPerimetro {
  let arch: unknown;
  try {
    arch = JSON.parse(contenido);
  } catch (err) {
    return { ok: false, porque: `no es JSON válido: ${(err as Error).message}` };
  }
  const reglas = (arch as { rules?: unknown }).rules;
  if (!Array.isArray(reglas)) return { ok: false, porque: "no tiene una lista `rules`" };
  const regla = reglas.find(
    (r: unknown) => typeof r === "object" && r !== null && (r as { id?: unknown }).id === REGLA_PERIMETRO,
  ) as { files?: string[] } | undefined;
  if (!regla?.files?.length) {
    return { ok: false, porque: `no tiene la regla "${REGLA_PERIMETRO}" con ficheros` };
  }
  return { ok: true, patrones: regla.files.map((f) => f.replace(/^nefan-core\//, "")) };
}

/** Lo que de `mutation-targets.json` puede cambiar el veredicto de un módulo,
 *  separado de lo que no.
 *
 *  · `global` es lo único que vale para TODOS a la vez: el `comando`, que es
 *    con qué se ejecuta cada mutante.
 *  · `modulos` es la definición de cada uno sin su motivo escrito: qué muta,
 *    con qué batería, con qué suelo y con qué exclusiones.
 *
 *  Lo que se deja FUERA a propósito, y es la mitad del asunto:
 *
 *  · `porque` y `_comment` son PROSA. Si contaran, escribir en el plan lo que
 *    una corrida acaba de medir —que es justo lo que se hace al cerrar una
 *    tanda— pagaría la corrida completa siguiente, y el precio de anotar la
 *    medida sería volver a medirlo todo. Es el mismo argumento que sacó a
 *    `arch-rules.json` del cajón del instrumento entero.
 *  · `tope_local` y `tope_lote` gobiernan lo que se deja correr en una máquina
 *    y cómo se empaqueta un lote en CI. No tocan a un mutante.
 *  · `directorios_completos` y `sin_mutar` no los mira `mutate.ts`, que es
 *    quien ejecuta: salen en `perimetro`/`dueñoDe`, o sea en el candado de
 *    totalidad de `npm test`, en la cola de `npm run deuda` y en la pregunta
 *    que este mismo selector hace por un HUÉRFANO. Cambiarlos puede poner rojo
 *    `npm test`; lo que no puede es cambiar el score de un módulo. */
export interface ProyeccionObjetivos {
  global: string;
  modulos: Map<string, string>;
}

export type ProyeccionDeObjetivos =
  | { ok: true; proyeccion: ProyeccionObjetivos }
  | { ok: false; porque: string };

type Registro = Record<string, unknown>;

/** Las claves del plan que SÍ pueden cambiar el veredicto de un módulo, con la
 *  parte de cada una que se compara. Es la mitad que selecciona. */
const SELECCIONAN_GLOBAL: Record<string, (p: Registro) => unknown> = {
  comando: (p) => p.comando,
};

const SELECCIONAN_POR_MODULO: Record<string, (m: Registro) => unknown> = {
  mutate: (m) => m.mutate,
  tests: (m) => m.tests,
  break: (m) => m.break,
  // De una exclusión importa CUÁL es, no su motivo escrito.
  excluidos: (m) => ((m.excluidos ?? []) as { test?: unknown }[]).map((e) => e.test),
};

/** Y la otra mitad, la que NO selecciona, con el motivo escrito de cada clave.
 *
 *  Las dos juntas tienen que cubrir el schema ENTERO, y eso lo canda
 *  `test/afectado.test.ts`: una clave nueva —`aparcado`, por ejemplo, que decide
 *  si un módulo se mide— pone el test rojo en vez de nacer invisible. Sin esa
 *  totalidad, la proyección es una lista blanca cuyo defecto es el silencio, que
 *  es literalmente lo que el crítico rechazó de la opción B en #404. */
export const NO_SELECCIONAN: Record<string, string> = {
  _comment: "prosa: explica el reparto, no lo cambia",
  porque: "prosa, y es la clave del asunto: aquí se ESCRIBE lo que una corrida acaba de medir, así que si contara, anotar la medida costaría la corrida completa siguiente",
  tope_local: "cuántos mutantes se dejan medir en la máquina de quien programa: una puerta de coste, no toca a un mutante",
  tope_lote: "cuántos segundos puede durar un lote en CI: empaqueta la corrida, no cambia su resultado",
  directorios_completos: "ensancha el PERÍMETRO, que `mutate.ts` no mira: sale en `npm test`, en `npm run deuda` y en la pregunta que este selector hace por un huérfano, no en el score de un módulo",
  sin_mutar: "declara quién NO se muta y por qué; como `directorios_completos`, vive en el perímetro y no en la medida",
  modulos: "es el contenedor del reparto: lo que decide va clave a clave dentro de cada módulo",
  id: "es la clave con la que se emparejan las dos revisiones, no un campo que comparar",
};

/** Las claves que el schema conoce, para que el candado de totalidad pregunte al
 *  schema y no a una lista paralela. */
export const CLAVES_DEL_PLAN = Object.keys(PlanSchema.shape);
export const CLAVES_DEL_MODULO = Object.keys(ModuloSchema.shape);

export function proyeccionDeObjetivos(contenido: string): ProyeccionDeObjetivos {
  let plan: unknown;
  try {
    plan = JSON.parse(contenido);
  } catch (err) {
    return { ok: false, porque: `no es JSON válido: ${(err as Error).message}` };
  }
  const p = plan as { comando?: unknown; modulos?: unknown };
  if (!Array.isArray(p.modulos) || p.modulos.length === 0) {
    return { ok: false, porque: "no tiene una lista `modulos` con contenido" };
  }
  if (typeof p.comando !== "string") return { ok: false, porque: "no tiene `comando`" };
  const proyecta = (fuente: Registro, campos: Record<string, (x: Registro) => unknown>): string =>
    JSON.stringify(Object.keys(campos).sort().map((k) => [k, campos[k](fuente)]));
  const modulos = new Map<string, string>();
  for (const m of p.modulos as Registro[]) {
    if (typeof m.id !== "string") return { ok: false, porque: "hay un módulo sin `id`" };
    modulos.set(m.id, proyecta(m, SELECCIONAN_POR_MODULO));
  }
  return { ok: true, proyeccion: { global: proyecta(p as Registro, SELECCIONAN_GLOBAL), modulos } };
}

/** Las claves que la proyección compara, para el candado de totalidad. */
export const clavesQueSeleccionan = (): { plan: string[]; modulo: string[] } => ({
  plan: Object.keys(SELECCIONAN_GLOBAL),
  modulo: Object.keys(SELECCIONAN_POR_MODULO),
});

/** El PERÍMETRO: qué ficheros tienen que tener respuesta a «si cambia esto,
 *  ¿qué hay que ejecutar?».
 *
 *  No es una lista nueva — sale de `arch-rules.json`, de la regla que ya
 *  declara qué es núcleo puro (`core-puro-sin-node`), más los directorios que
 *  el plan mide enteros. Se deriva a propósito: una segunda lista mantenida a
 *  mano se desincroniza de la primera y el fallo es silencioso, que es
 *  exactamente el modo de fallo que este perímetro existe para cerrar.
 *
 *  Fail-loud si la regla desaparece o cambia de nombre: quedarse con un
 *  perímetro vacío sería un candado que aprueba sin mirar nada. */
export function perimetro(plan: PlanMutacion): string[] {
  const proyeccion = patronesDelPerimetro(readFileSync(join(coreRoot, RUTA_ARCH_RULES), "utf8"));
  if (!proyeccion.ok) {
    throw new Error(
      `${RUTA_ARCH_RULES} ${proyeccion.porque}: el perímetro de mutación sale de ahí, ` +
        `y sin esa regla el candado de totalidad aprobaría sin mirar nada`,
    );
  }
  const patrones = [
    ...proyeccion.patrones,
    ...plan.directorios_completos.map((d) => `${d.directorio}/*.ts`),
  ];
  const out = new Set<string>();
  for (const p of patrones) for (const f of expande(p)) out.add(f);
  return [...out].sort();
}

/** La regla de `arch-rules.json` de la que sale el perímetro. Es la que ya dice
 *  qué módulos son puros —y por tanto mutables— para el resto de la casa. */
export const REGLA_PERIMETRO = "core-puro-sin-node";

/** Los ficheros que el plan declara NO mutados, con sus globs expandidos. */
export function ficherosExentos(plan: PlanMutacion): Map<string, ExentoMutacion> {
  const out = new Map<string, ExentoMutacion>();
  for (const e of plan.sin_mutar) for (const f of expande(e.fichero)) out.set(f, e);
  return out;
}

export type Dueño =
  { tipo: "modulo"; id: string } | { tipo: "exento"; porque: string } | { tipo: "huerfano" };

/** Quién responde por un fichero: el módulo que lo muta, la exención escrita, o
 *  nadie. El tercer caso es el que el candado de totalidad hace imposible
 *  dentro del perímetro, y el que `afectado.ts` traduce a «ejecuta de más». */
export function dueñoDe(plan: PlanMutacion, fichero: string): Dueño {
  const f = normaliza(fichero);
  for (const m of plan.modulos) if (ficherosDeclarados(m).includes(f)) return { tipo: "modulo", id: m.id };
  const exento = ficherosExentos(plan).get(f);
  return exento ? { tipo: "exento", porque: exento.porque } : { tipo: "huerfano" };
}

/** Importaciones RELATIVAS de un fichero, ya resueltas a rutas del repo.
 *  Se usa `ts.preProcessFile` (TypeScript ya es dependencia) en vez de una
 *  regex: entiende `export … from`, los `import()` dinámicos y no se traga los
 *  strings que aparecen dentro de un comentario. */
export function importsDirectos(fichero: string): string[] {
  const previo = cacheDirectos.get(fichero);
  if (previo) return previo;
  const src = readFileSync(fichero, "utf8");
  const out: string[] = [];
  for (const ref of ts.preProcessFile(src, true, true).importedFiles) {
    const destino = resolverEspecificador(fichero, ref.fileName);
    if (destino) out.push(destino);
  }
  cacheDirectos.set(fichero, out);
  return out;
}

/** Los cierres de los 17 módulos se solapan mucho (media casa cuelga de
 *  `src/types.ts`): sin memoizar, `afectado.ts` volvía a leer y parsear los
 *  mismos ficheros decenas de veces. */
const cacheDirectos = new Map<string, string[]>();

/** Lo mismo, pero ATRAVESANDO LOS BARRILES por el símbolo importado.
 *
 *  Sin esto el reparto se equivoca, y se midió: `blueprint-collision.test.ts`
 *  importa `volumeCollisionGrid` de `blueprint/index.js`, así que contaba como
 *  test del barril y no de `collision.ts` — y `collision.ts` salía con un 29,6 %
 *  de score. Metiendo en su batería a los tests que llegan por el barril, sube
 *  a 61,6 %: 178 mutantes que sí tenían quien los matara, contados como deuda.
 *
 *  Se resuelve por SÍMBOLO y no por fichero a propósito. El barril del
 *  blueprint reexporta trece ficheros; tratar "importa el barril" como "importa
 *  los trece" metería esos tests en la batería de todos los módulos del
 *  blueprint, y con `coverageAnalysis: "off"` eso se paga una vez por mutante.
 *
 *  El barril también se devuelve: sigue siendo un fichero real y mutable. */
export function importsResueltos(fichero: string): string[] {
  const out = new Set<string>();
  for (const imp of importaciones(fichero)) {
    out.add(imp.file);
    for (const origen of atraviesaBarril(imp.file, imp.nombres, 0)) out.add(origen);
  }
  return [...out];
}

interface Importacion {
  file: string;
  /** Nombres traídos entre llaves. Vacío = namespace, default o efecto: no hay
   *  símbolo que seguir a través del barril. */
  nombres: string[];
}

function importaciones(fichero: string): Importacion[] {
  const sf = ts.createSourceFile(fichero, readFileSync(fichero, "utf8"), ts.ScriptTarget.ESNext, true);
  const out: Importacion[] = [];
  for (const st of sf.statements) {
    const esImport = ts.isImportDeclaration(st);
    const esExport = ts.isExportDeclaration(st);
    if (!esImport && !esExport) continue;
    const spec = st.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) continue;
    const file = resolverEspecificador(fichero, spec.text);
    if (!file) continue;
    const clause = esImport ? st.importClause?.namedBindings : st.exportClause;
    const nombres =
      clause && (ts.isNamedImports(clause) || ts.isNamedExports(clause))
        ? clause.elements.map((e) => (e.propertyName ?? e.name).text)
        : [];
    out.push({ file, nombres });
  }
  return out;
}

/** Si `file` es un barril y reexporta alguno de esos símbolos, los ficheros de
 *  donde salen. Con un tope de saltos: un barril que reexporta otro barril es
 *  normal, un ciclo también sería posible. */
function atraviesaBarril(file: string, nombres: readonly string[], salto: number): string[] {
  if (nombres.length === 0 || salto > 4) return [];
  const mapa = reexportaciones(file);
  const out: string[] = [];
  for (const n of nombres) {
    const destino = mapa.get(n);
    if (!destino) continue;
    out.push(destino.file, ...atraviesaBarril(destino.file, [destino.original], salto + 1));
  }
  return out;
}

const cacheBarriles = new Map<string, Map<string, { file: string; original: string }>>();

/** Símbolo → fichero del que sale, para los `export { … } from "…"` de un
 *  fichero. Un `export * from` no dice qué nombres trae sin resolver tipos, así
 *  que se ignora: el candado se queda corto, que es el lado seguro. */
function reexportaciones(fichero: string): Map<string, { file: string; original: string }> {
  const previo = cacheBarriles.get(fichero);
  if (previo) return previo;
  const mapa = new Map<string, { file: string; original: string }>();
  const abs = join(coreRoot, fichero);
  if (existsSync(abs)) {
    const sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.ESNext, true);
    for (const st of sf.statements) {
      if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier))
        continue;
      const destino = resolverEspecificador(abs, st.moduleSpecifier.text);
      if (!destino || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
      for (const e of st.exportClause.elements) {
        mapa.set(e.name.text, { file: destino, original: (e.propertyName ?? e.name).text });
      }
    }
  }
  cacheBarriles.set(fichero, mapa);
  return mapa;
}

/** Resuelve un especificador relativo a un fichero real del repo. Devuelve
 *  `undefined` para los paquetes de node_modules: no se mutan. */
function resolverEspecificador(desde: string, especificador: string): string | undefined {
  if (!especificador.startsWith(".")) return undefined;
  const base = resolve(dirname(desde), especificador);
  // El código fuente importa con extensión `.js` (ESM) pero en disco es `.ts`.
  const candidatos = base.endsWith(".js") ? [`${base.slice(0, -3)}.ts`] : [];
  candidatos.push(`${base}.ts`, base, join(base, "index.ts"));
  for (const c of candidatos) {
    if (existsSync(c) && statSync(c).isFile()) return normaliza(relative(coreRoot, c));
  }
  return undefined;
}

/** Las aristas de RUNTIME: `importsDirectos` menos las que TypeScript borra al
 *  compilar.
 *
 *  Un `import type { Foo } from "./foo.js"` —o un `{ type Foo }` dentro de las
 *  llaves, o un `export type { … } from`— desaparece del JavaScript que se
 *  ejecuta. Así que un cambio ahí NO puede cambiar la suerte de un solo
 *  mutante: no hay código que ejecutar detrás de esa arista. No es una
 *  heurística ni un umbral, es una propiedad del compilador, y por eso el
 *  selector puede apoyarse en ella sin quedarse corto.
 *
 *  Importa mucho: son 226 `import type` y 44 specifiers `{ type X }` de 1.090
 *  imports, y están concentrados justo en los ficheros que más fan-in tienen
 *  (`src/plugins/types.ts`, `src/types.ts`, `src/world-map/types.ts`). Con las
 *  aristas de tipo dentro, tocar uno de esos ficheros selecciona el 100 % de
 *  los módulos y el selector no sirve para nada.
 *
 *  Se resta en vez de calcularse aparte porque `importsDirectos` usa
 *  `ts.preProcessFile`, que también ve los `import()` dinámicos y los
 *  `require`. Una arista que no aparezca entre las declaraciones estáticas de
 *  este fichero se queda: lo desconocido cuenta como runtime, que es el lado
 *  seguro. */
export function importsRuntime(fichero: string): string[] {
  const previo = cacheRuntime.get(fichero);
  if (previo) return previo;
  const soloTipos = new Set<string>();
  const conValor = new Set<string>();
  for (const decl of declaracionesDeImport(fichero)) {
    (decl.soloTipos ? soloTipos : conValor).add(decl.file);
  }
  const out = importsDirectos(fichero).filter((f) => !soloTipos.has(f) || conValor.has(f));
  cacheRuntime.set(fichero, out);
  return out;
}

const cacheRuntime = new Map<string, string[]>();

interface DeclaracionImport {
  file: string;
  soloTipos: boolean;
}

/** Las declaraciones estáticas de import/export de un fichero, diciendo de cada
 *  una si TypeScript la borra al compilar. Tres formas la borran: `import
 *  type`, `export type { … } from`, y una lista de nombres en la que TODOS
 *  llevan `type` delante (si queda uno sin `type`, el import sobrevive). */
function declaracionesDeImport(fichero: string): DeclaracionImport[] {
  const sf = ts.createSourceFile(fichero, readFileSync(fichero, "utf8"), ts.ScriptTarget.ESNext, true);
  const out: DeclaracionImport[] = [];
  for (const st of sf.statements) {
    const esImport = ts.isImportDeclaration(st);
    if (!esImport && !ts.isExportDeclaration(st)) continue;
    const spec = st.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) continue;
    const file = resolverEspecificador(fichero, spec.text);
    if (!file) continue;
    const clause = esImport ? st.importClause : undefined;
    const bindings = esImport ? clause?.namedBindings : st.exportClause;
    const marcado = esImport ? clause?.isTypeOnly === true : st.isTypeOnly;
    const todosTipo =
      bindings !== undefined &&
      (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((e) => e.isTypeOnly) &&
      // `import Def, { type A } from …` sigue trayendo el default en runtime.
      (!esImport || clause?.name === undefined);
    out.push({ file, soloTipos: marcado || todosTipo });
  }
  return out;
}

/** Cierre transitivo de imports desde unas entradas. Es lo que un test PUEDE
 *  ejecutar: si un fichero no está aquí, ningún mutante suyo puede morir. */
export function cierreDeImports(entradas: readonly string[]): Set<string> {
  return cierre(entradas, importsDirectos);
}

/** El mismo cierre, siguiendo solo las aristas que sobreviven al compilador.
 *  Es lo que el selector usa para responder «¿puede este cambio alterar la
 *  suerte de un mutante de este módulo?»: la respuesta es sí exactamente
 *  cuando el fichero cambiado está aquí dentro.
 *
 *  Siempre es un SUBCONJUNTO de `cierreDeImports` —se siguen menos aristas—, y
 *  eso lo canda `test/mutation-config.test.ts`. La batería mínima sigue
 *  calculándose con el cierre ingenuo: ahí el lado seguro es el contrario
 *  (incluir un test de más se paga, dejarlo fuera miente). */
export function cierreDeRuntime(entradas: readonly string[]): Set<string> {
  return cierre(entradas, importsRuntime);
}

function cierre(entradas: readonly string[], aristas: (abs: string) => string[]): Set<string> {
  const vistos = new Set<string>();
  const cola = [...entradas.map(normaliza)];
  while (cola.length > 0) {
    const f = cola.pop() as string;
    if (vistos.has(f)) continue;
    vistos.add(f);
    for (const dep of aristas(join(coreRoot, f))) if (!vistos.has(dep)) cola.push(dep);
  }
  return vistos;
}

/** Todos los ficheros de test del paquete, ordenados. */
export function todosLosTests(): string[] {
  return globSync("test/*.test.ts", { cwd: coreRoot }).map(normaliza).sort();
}

/** Los tests que importan alguno de esos ficheros —de frente o a través de un
 *  barril—: los tests cuyo sujeto es el módulo. Es la batería MÍNIMA que el
 *  candado exige; uno de ellos fuera de la lista son mutantes que nadie va a
 *  poder matar aunque su test exista.
 *
 *  Mínima, no completa: sigue siendo posible que un test ejercite el módulo
 *  desde más lejos (a través de OTRO módulo, no de un barril) y no aparezca
 *  aquí. Por eso la batería del plan puede ser un superconjunto de esta lista.
 *  Lo que el candado prohíbe es lo contrario —quitar de la batería a quien sí
 *  importa—, salvo con una exclusión razonada. */
export function testsQueImportan(ficheros: readonly string[]): string[] {
  const objetivo = new Set(ficheros.map(normaliza));
  return todosLosTests().filter((t) => importsResueltos(join(coreRoot, t)).some((dep) => objetivo.has(dep)));
}

/** Todo lo que la corrida de un módulo EJECUTA: su batería, lo que muta, y
 *  todo lo que cuelga de ahí por aristas de runtime.
 *
 *  Es la definición operativa de «este cambio puede haber roto este módulo»:
 *  un fichero que no está en este conjunto no lo carga ningún proceso de esa
 *  corrida, así que no puede cambiar el veredicto de ninguno de sus mutantes.
 *  Los ficheros mutados van como entrada además de los tests porque un módulo
 *  puede mutar un barril al que se llega por reexportación. */
export function alcanceDe(modulo: ModuloMutacion): Set<string> {
  return cierreDeRuntime([...modulo.tests, ...ficherosMutados(modulo)]);
}

/** Las dos formas de leer un fichero SIN escribir su nombre. Quien llama a una
 *  de éstas no nombra lo que va a leer: lo descubre, y por eso `leeElDato` no
 *  puede contestar solo con el nombre del fichero.
 *
 *  `API_ENUMERA` descubre listando el directorio; `API_ABRE` descubre
 *  componiendo la ruta (`readFileSync(join(DIR, \`${x}.json\`))`), que es la
 *  forma más normal de leer un directorio de fixtures y la que se coló en la
 *  primera versión de esto (#404 / QA H-1). */
const API_ENUMERA = new Set(["readdirSync", "readdir", "opendirSync", "opendir", "globSync", "glob"]);
const API_ABRE = new Set(["readFileSync", "readFile", "createReadStream", "openSync", "open"]);

interface Lectura {
  /** Los literales de cadena del fichero, más los que `join`/`resolve` componen
   *  a partir de argumentos literales seguidos. Es lo que contesta por NOMBRE. */
  literales: string[];
  /** Los directorios DEL PAQUETE cuyo contenido descubre este fichero, resueltos
   *  LLAMADA A LLAMADA contra el disco. */
  directoriosLeidos: string[];
  /** Descubrimientos cuyo directorio NO se pudo resolver: el directorio le llega
   *  por parámetro desde otro fichero, o se compone de algo que no es un
   *  literal. Ahí el selector está CIEGO y hay que decirlo, no suponerlo. */
  descubrimientosCiegos: number;
}

const cacheLecturas = new Map<string, Lectura>();

/** Los ancestros de una ruta, del más hondo al más alto y sin llegar a la raíz
 *  del paquete: `data/scenes/puerto_tile.json` → `data/scenes`, `data`. */
export function ancestrosDe(ruta: string): string[] {
  const seg = ruta.split("/");
  const out: string[] = [];
  for (let i = seg.length - 1; i >= 1; i--) out.push(seg.slice(0, i).join("/"));
  return out;
}

/** ¿La corrida de este fichero LEE ese dato? La pregunta que el grafo de
 *  imports no contesta: un `readFileSync(join(root, "data", "contract",
 *  "x.json"))` no es una arista de import y por eso el selector, ante un dato
 *  cualquiera, ejecutaba de más.
 *
 *  `dato` es la ruta del fichero relativa a nefan-core, y hay DOS respuestas
 *  posibles porque hay dos formas de abrir un fichero:
 *
 *  1. NOMBRÁNDOLO. Se busca el nombre del fichero dentro de los LITERALES DE
 *     CADENA, no del texto crudo, y las dos mitades importan:
 *     · Por el nombre y no la ruta entera, porque el código real la parte
 *       (`join(coreRoot, "data", "contract", "arch-rules.json")`) y buscar la
 *       ruta completa no encontraría a su único lector de verdad.
 *     · Por los literales y no el texto, porque media casa NOMBRA un fichero de
 *       contrato en un comentario para explicar qué regla la sujeta
 *       (`src/plugins/migrate.ts` cita `arch-rules.json` sin abrirlo jamás), y
 *       contar esas menciones devolvería el «ejecuta todo» que se quiere acotar.
 *
 *  2. SIN NOMBRARLO, descubriéndolo dentro de un DIRECTORIO. Aquí la forma 1
 *     contesta «no lo lee nadie», que es la respuesta más peligrosa que este
 *     fichero puede dar, y hay dos maneras de llegar:
 *     · `readdirSync(DIR)` — medido antes de arreglarlo:
 *       `data/scenes/puerto_tile.json` → ningún módulo, con
 *       `test/scene-fixtures.test.ts` leyéndolo y estando en la batería de
 *       `contrato-escena` y de `scene-validate`.
 *     · `readFileSync(join(DIR, \`${x}.json\`))` — medido igual:
 *       `data/contract/fixtures/sprite-forge/*.json` → NADA, con
 *       `test/contract-sprite-forge.test.ts` —la batería de
 *       `contrato-sprite-forge`— abriéndolos así uno a uno.
 *     Las dos se contestan igual: el directorio se resuelve LLAMADA A LLAMADA
 *     (`directoriosLeidos`) y el dato lo lee quien lea un ancestro suyo.
 *
 *  Se queda del lado seguro donde no puede saber: un fichero del alcance que ya
 *  no está en el árbol cuenta como lector, y un descubrimiento cuyo directorio
 *  no se resuelve NO se inventa — se cuenta como ciego y lo caza el candado de
 *  totalidad (`descubrimientosCiegos`). */
export function leeElDato(fichero: string, dato: string): boolean {
  const l = lecturaDe(fichero);
  // Borrado o renombrado: no hay nada que analizar, y el lado seguro es contar
  // como lector.
  if (l === undefined) return true;
  const nombre = dato.split("/").pop() as string;
  if (l.literales.some((s) => s.includes(nombre))) return true;
  const ancestros = ancestrosDe(dato);
  return l.directoriosLeidos.some((d) => ancestros.includes(d));
}

/** Los directorios del paquete cuyo contenido descubre este fichero. Lo consulta
 *  el candado de totalidad. */
export function directoriosLeidos(fichero: string): string[] {
  return lecturaDe(fichero)?.directoriosLeidos ?? [];
}

/** Cuántas veces este fichero descubre ficheros en un directorio que el selector
 *  NO ha podido resolver. Es el agujero declarable: mientras sea 0, todo lo que
 *  el fichero abre sin nombrar está atribuido. */
export function descubrimientosCiegos(fichero: string): number {
  return lecturaDe(fichero)?.descubrimientosCiegos ?? 0;
}

/** Lo que hay que mirar de un fichero para contestar a lo de arriba, una sola
 *  vez por fichero: se pregunta por cada dato del diff × cada fichero del
 *  alcance de los 41 módulos. `undefined` = ya no está en el árbol. */
function lecturaDe(fichero: string): Lectura | undefined {
  const previo = cacheLecturas.get(fichero);
  if (previo) return previo;
  const abs = join(coreRoot, fichero);
  if (!existsSync(abs)) return undefined;
  const l = analizaLectura(readFileSync(abs, "utf8"), dirname(abs));
  cacheLecturas.set(fichero, l);
  return l;
}

/** Lo mismo, sobre un CONTENIDO escrito a mano y una ruta que se finge. Separado
 *  de dónde sale el texto por lo mismo que `comparaPerimetro`: los casos que
 *  importan —el alias de un import, el nombre compuesto, la cabeza que no
 *  resuelve— se prueban con seis líneas de código sintético, y un candado que
 *  cuesta fabricar ficheros en el árbol acaba no probándose. */
export function descubrimientosDe(
  texto: string,
  ficheroRelativo: string,
): { directorios: string[]; ciegos: number } {
  const l = analizaLectura(texto, dirname(join(coreRoot, ficheroRelativo)));
  return { directorios: l.directoriosLeidos, ciegos: l.descubrimientosCiegos };
}

/** El directorio DEL PAQUETE al que resuelve esa ruta, o `undefined`. Se
 *  resuelve contra el DISCO en vez de casar cadenas: `"data"` a secas o `".."`
 *  casarían con cualquier cosa. */
function dirDelPaquete(desde: string, ruta: string): string | undefined {
  if (ruta === "") return undefined;
  const abs = resolve(desde, ruta);
  const rel = normaliza(relative(coreRoot, abs));
  if (rel === "" || rel.startsWith("..")) return undefined;
  return existsSync(abs) && statSync(abs).isDirectory() ? rel : undefined;
}

/** `import.meta.url` — el ancla desde la que esta casa escribe cualquier ruta de
 *  fichero, y la ÚNICA que autoriza a resolver relativo al propio fichero. */
function esImportMetaUrl(n: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(n) && n.name.text === "url" && ts.isMetaProperty(n.expression)
  );
}

/** Los literales SEGUIDOS desde `i`, que es como `join` recibe la cola de una
 *  ruta: `join(HERE, "fixtures", "fps-plans")` → `fixtures/fps-plans`. */
function colaLiteral(args: readonly ts.Node[], i: number): string {
  const out: string[] = [];
  for (let k = i; k < args.length; k++) {
    const a = args[k];
    if (!esCadena(a)) break;
    out.push(a.text);
  }
  return out.join("/");
}

const nombreLlamado = (n: ts.CallExpression): string | undefined =>
  ts.isIdentifier(n.expression)
    ? n.expression.text
    : ts.isPropertyAccessExpression(n.expression)
      ? n.expression.name.text
      : undefined;

/** La CABEZA de un nombre compuesto: en `join(DIR, \`${x}.json\`)` es `DIR`.
 *  `undefined` si el último tramo es un literal —entonces el nombre SÍ está
 *  escrito y lo contesta la vía 1— o si no es un `join`/`resolve`. */
function cabezaCompuesta(n: ts.Node): ts.Node | undefined {
  if (!ts.isCallExpression(n)) return undefined;
  const nombre = nombreLlamado(n);
  if (nombre !== "join" && nombre !== "resolve") return undefined;
  if (n.arguments.length < 2) return undefined;
  if (esCadena(n.arguments[n.arguments.length - 1])) return undefined;
  return n.arguments[0];
}

function analizaLectura(texto: string, base: string): Lectura {
  const sf = ts.createSourceFile(join(base, "x.ts"), texto, ts.ScriptTarget.ESNext, true);
  const literales: string[] = [];
  // `import { readdirSync as leerDir }` apagaba la detección entera cuando ésta
  // iba por el NOMBRE de la llamada (QA H-2): el alias se resuelve aquí.
  const alias = new Map<string, string>();
  /** Nombre local → directorio del paquete, de `const X = …` y de los
   *  parámetros que una llamada del MISMO fichero ata a un directorio. */
  const nombresDeDirectorio = new Map<string, Set<string>>();
  const parametrosDe = new Map<string, string[]>();

  const apunta = (nombre: string, dirs: readonly string[]): void => {
    if (dirs.length === 0) return;
    const previo = nombresDeDirectorio.get(nombre) ?? new Set<string>();
    for (const d of dirs) previo.add(d);
    nombresDeDirectorio.set(nombre, previo);
  };

  /** A qué directorio del paquete apunta esta EXPRESIÓN, por su forma y no por
   *  los literales que lleve sueltos.
   *
   *  La diferencia se paga: `resolve(gamesDir, "..", "plugins")`
   *  (`src/plugins/loader.ts`) tiene literales que, resueltos contra la carpeta
   *  del propio fichero, dan `src/plugins` — un directorio que existe y que ese
   *  código no mira jamás. Con la cabeza sin resolver, la respuesta correcta es
   *  «no lo sé», y de ahí sale el descubrimiento CIEGO que el candado exige
   *  declarar. */
  const resuelve = (n: ts.Node): string[] => {
    if (ts.isIdentifier(n)) return [...(nombresDeDirectorio.get(n.text) ?? [])];
    if (esImportMetaUrl(n)) return [normaliza(relative(coreRoot, base))];
    if (esCadena(n)) {
      const d = dirDelPaquete(coreRoot, n.text);
      return d === undefined ? [] : [d];
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "URL") {
      const [ruta, ancla] = n.arguments ?? [];
      if (ruta === undefined || ancla === undefined || !esCadena(ruta)) return [];
      return junta(resuelve(ancla), ruta.text);
    }
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const nom = nombreLlamado(n);
      if (nom === "join" || nom === "resolve") {
        return junta(resuelve(n.arguments[0]), colaLiteral(n.arguments, 1));
      }
      // Envoltorios que no mueven la ruta: `fileURLToPath(x)`, `dirname(x)`
      // sobre `import.meta.url` (que ya devuelve el DIRECTORIO), `normalize`…
      return resuelve(n.arguments[0]);
    }
    return [];
  };
  const junta = (cabezas: readonly string[], cola: string): string[] =>
    cabezas
      .map((c) => dirDelPaquete(coreRoot, cola === "" ? c : `${c}/${cola}`))
      .filter((d): d is string => d !== undefined);

  // Pasada 1 · literales, alias de import, constantes que son un directorio y
  // la firma de cada función del fichero.
  const pasada1 = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      const enlaces = n.importClause?.namedBindings;
      if (enlaces !== undefined && ts.isNamedImports(enlaces)) {
        for (const e of enlaces.elements) alias.set(e.name.text, (e.propertyName ?? e.name).text);
      }
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      apunta(n.name.text, resuelve(n.initializer));
    }
    if (ts.isFunctionDeclaration(n) && n.name) {
      parametrosDe.set(
        n.name.text,
        n.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : "")),
      );
    }
    if (ts.isCallExpression(n)) {
      const nombre = nombreLlamado(n);
      // `join(coreRoot, "data", "scenes")` nombra un directorio tan bien como
      // `"../data/scenes"`, solo que partido en argumentos.
      if (nombre === "join" || nombre === "resolve") {
        let tramo: string[] = [];
        for (const arg of n.arguments) {
          if (esCadena(arg)) tramo.push(arg.text);
          else {
            if (tramo.length > 1) literales.push(tramo.join("/"));
            tramo = [];
          }
        }
        if (tramo.length > 1) literales.push(tramo.join("/"));
      }
    }
    if (esCadena(n)) literales.push(n.text);
    ts.forEachChild(n, pasada1);
  };
  pasada1(sf);

  // Pasada 2 · lo que las llamadas del fichero atan a un parámetro. Un salto,
  // que es lo que hace falta: `escenasDe(SCENES)` con `readdirSync(dir)` dentro.
  const pasada2 = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const params = parametrosDe.get(n.expression.text);
      if (params !== undefined) {
        n.arguments.forEach((arg, i) => {
          const nombre = params[i];
          if (nombre) apunta(nombre, resuelve(arg));
        });
      }
    }
    ts.forEachChild(n, pasada2);
  };
  pasada2(sf);

  // Pasada 3 · los DESCUBRIMIENTOS, resueltos llamada a llamada.
  const directorios = new Set<string>();
  let descubrimientosCiegos = 0;
  const pasada3 = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const llamado = nombreLlamado(n);
      const nombre = llamado === undefined ? undefined : (alias.get(llamado) ?? llamado);
      const donde =
        nombre !== undefined && API_ENUMERA.has(nombre)
          ? n.arguments[0]
          : nombre !== undefined && API_ABRE.has(nombre)
            ? cabezaCompuesta(n.arguments[0])
            : undefined;
      if (donde !== undefined) {
        const dirs = resuelve(donde);
        if (dirs.length === 0) descubrimientosCiegos++;
        for (const d of dirs) directorios.add(d);
      }
    }
    ts.forEachChild(n, pasada3);
  };
  pasada3(sf);

  return { literales, directoriosLeidos: [...directorios].sort(), descubrimientosCiegos };
}

function esCadena(
  n: ts.Node,
): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail {
  return (
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isTemplateHead(n) ||
    ts.isTemplateMiddle(n) ||
    ts.isTemplateTail(n)
  );
}

export function rutaInforme(id: string): string {
  return join(coreRoot, "reports", "mutation", `${id}.json`);
}

/** VIVO, en un solo sitio. Lo consultan el score de aquí abajo y la huella de
 *  la corrida (`scripts/mutacion-huella.ts`): con dos definiciones, la cola de
 *  deuda y el delta acabarían discrepando sobre el mismo informe. */
export function esVivo(status: string): boolean {
  return status === "Survived" || status === "NoCoverage";
}

/** El score tal y como lo calcula Stryker, en un solo sitio: el runner lo
 *  imprime y `npm run deuda` lo pone en la cola, y si cada uno usara su propia
 *  cuenta acabarían discrepando sobre el mismo informe.
 *
 *  VIVO = `Survived` (el test pasó por la línea sin enterarse) o `NoCoverage`
 *  (ningún test pasó siquiera). DETECTADO = `Killed` o `Timeout` — un mutante
 *  que cuelga el proceso está detectado igual, solo que por el reloj. Lo demás
 *  (`Ignored`, y los errores de compilación o de runtime) NO entra en el
 *  denominador: no son veredictos sobre los tests. */
export function resumenDeMutantes(mutantes: readonly { status: string }[]): {
  total: number;
  vivos: number;
  score: number;
} {
  const vivos = mutantes.filter((m) => esVivo(m.status)).length;
  const detectados = mutantes.filter((m) => m.status === "Killed" || m.status === "Timeout").length;
  const total = vivos + detectados;
  return { total, vivos, score: total === 0 ? 0 : (detectados / total) * 100 };
}

/** El comando que Stryker ejecuta por cada mutante de este módulo. */
export function comandoDe(plan: PlanMutacion, modulo: ModuloMutacion): string {
  return `${plan.comando} ${modulo.tests.join(" ")}`;
}

/** Cuántos procesos de test arranca `node --test` por cada worker de Stryker,
 *  leído del comando del plan. Sin `--test-concurrency`, Node usa
 *  `availableParallelism() - 1` — uno por fichero de test hasta llenar la
 *  máquina, DENTRO de cada worker de Stryker, que ya son varios. */
export function testConcurrencyDe(comando: string): number | "sin tope" {
  const m = /--test-concurrency[= ](\d+)/.exec(comando);
  return m ? Number(m[1]) : "sin tope";
}

/** Cuántos mutantes a la vez.
 *
 *  Vive AQUÍ y no en `stryker.config.json` porque no es una propiedad del
 *  repositorio sino de la máquina que mide: el mismo número que deja un runner
 *  de CI a medio gas deja inusable el portátil de alguien. Por defecto, la
 *  mitad de los núcleos — con `--test-concurrency=1` en el comando eso son
 *  tantos procesos de test como mutantes en vuelo, y queda máquina para
 *  trabajar mientras mide.
 *
 *  PASÓ DE VERDAD (2026-08-23): `concurrency: 10` fijo en el config, por hasta
 *  15 procesos que `node --test` arrancaba por su cuenta dentro de cada worker,
 *  dieron un load average de 129→140 sobre 16 núcleos. Ocho veces la máquina.
 *  Además de inutilizarla, infla la propia medida: todo ese context-switching
 *  se cobra en el CPU que luego se compara.
 *
 *  Lo pedido a mano se respeta pero se recorta a los núcleos disponibles: el
 *  invariante es "procesos simultáneos ≈ núcleos, nunca un múltiplo". */
export function concurrenciaDe(nucleos: number, pedida?: string): number {
  const n = Number(pedida);
  if (Number.isInteger(n) && n > 0) return Math.max(1, Math.min(n, nucleos));
  return Math.max(1, Math.floor(nucleos / 2));
}

/** El config de Stryker de un módulo: la base común más lo suyo. Se genera —
 *  no se commitea— para que no pueda divergir del plan. */
export function configDe(
  base: Record<string, unknown>,
  plan: PlanMutacion,
  modulo: ModuloMutacion,
  concurrencia: number,
): Record<string, unknown> {
  const {
    $schema: _s,
    _comment: _c,
    ...comun
  } = base as Record<string, unknown> & { $schema?: unknown; _comment?: unknown };
  // Un módulo `SIN_MEDIR` se corre SIN `break`: Stryker sin ese campo no falla
  // por score, que es exactamente lo que hay que hacer con un módulo del que
  // todavía no se sabe nada. Escribir `break: 0` aquí sería lo mismo en efecto
  // y una mentira en la lectura — un 0 se lee como «medido y malísimo».
  const suelos = { ...(comun.thresholds as Record<string, number>) };
  const thresholds = modulo.break === SIN_MEDIR ? suelos : { ...suelos, break: modulo.break };
  return {
    ...comun,
    _comment: `GENERADO por scripts/mutate.ts desde data/contract/mutation-targets.json — módulo "${modulo.id}". No lo edites: se reescribe en cada corrida.`,
    concurrency: concurrencia,
    mutate: modulo.mutate,
    commandRunner: { command: comandoDe(plan, modulo) },
    jsonReporter: { fileName: normaliza(relative(coreRoot, rutaInforme(modulo.id))) },
    thresholds,
  };
}
