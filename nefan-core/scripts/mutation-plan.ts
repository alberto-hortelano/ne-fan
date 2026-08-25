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
   *  módulo grande y bien probado tapando a uno pequeño y ciego. */
  break: z.number().min(0).max(100),
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
});

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
  /** Directorios que se miden ENTEROS. El candado exige que cada `.ts` de
   *  estos esté nombrado por algún módulo: si no, un fichero nuevo se cuela
   *  sin que nadie lo mida y nada falla — el agujero por el que un objetivo
   *  se queda huérfano. Los directorios donde solo se muta un fichero suelto
   *  (src/scene, src/combat) NO van aquí. */
  directorios_completos: z.array(z.string()).default([]),
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
});

export type ModuloMutacion = z.infer<typeof ModuloSchema>;
export type ExentoMutacion = z.infer<typeof ExentoSchema>;
export type PlanMutacion = z.infer<typeof PlanSchema>;

export const RUTA_PLAN = join(coreRoot, "data", "contract", "mutation-targets.json");

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
    ...plan.directorios_completos.map((d) => `${d}/*.ts`),
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

const cacheLecturas = new Map<string, boolean>();

/** ¿Este fichero LEE ese dato, nombrándolo? La pregunta que el grafo de imports
 *  no contesta: un `readFileSync(join(root, "data", "contract", "x.json"))` no
 *  es una arista de import y por eso el selector, ante un dato cualquiera,
 *  ejecuta de más.
 *
 *  Se mira el nombre del fichero dentro de los LITERALES DE CADENA, no el texto
 *  crudo, y las dos mitades importan:
 *
 *  · Por el nombre y no la ruta entera, porque el código real la parte
 *    (`join(coreRoot, "data", "contract", "arch-rules.json")`) y buscar la ruta
 *    completa no encontraría a su único lector de verdad.
 *  · Por los literales y no el texto, porque media casa NOMBRA un fichero de
 *    contrato en un comentario para explicar qué regla la sujeta
 *    (`src/plugins/migrate.ts` cita `arch-rules.json` sin abrirlo jamás), y
 *    contar esas menciones devolvería el «ejecuta todo» que se quiere acotar.
 *
 *  Se queda del lado seguro donde no puede saber: un fichero del alcance que ya
 *  no está en el árbol cuenta como lector. */
export function leeElDato(fichero: string, nombre: string): boolean {
  const clave = `${fichero}|${nombre}`;
  const previo = cacheLecturas.get(clave);
  if (previo !== undefined) return previo;
  const lee = calculaLectura(join(coreRoot, fichero), nombre);
  cacheLecturas.set(clave, lee);
  return lee;
}

function calculaLectura(abs: string, nombre: string): boolean {
  if (!existsSync(abs)) return true;
  const texto = readFileSync(abs, "utf8");
  // Prefiltro barato: sin la cadena en el texto no hace falta parsear nada, y
  // esto se pregunta por cada fichero del alcance de los módulos.
  if (!texto.includes(nombre)) return false;
  const sf = ts.createSourceFile(abs, texto, ts.ScriptTarget.ESNext, true);
  let lee = false;
  const visita = (n: ts.Node): void => {
    if (lee) return;
    if (esCadena(n) && n.text.includes(nombre)) {
      lee = true;
      return;
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return lee;
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
  const thresholds = { ...(comun.thresholds as Record<string, number>), break: modulo.break };
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
