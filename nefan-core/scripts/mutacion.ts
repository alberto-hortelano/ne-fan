/** `npm run mutacion` — la mutación se PIDE, la autoriza una persona, y vuelve
 *  con dueño.
 *
 *  POR QUÉ NO HAY COLA DE PETICIONES. La primera versión de esto guardaba las
 *  peticiones como ficheros JSON en el paquete, y era un autogol de los que no
 *  dan error: `clasifica()` manda cualquier fichero que no acabe en `.ts` a
 *  "dato", y `efectoDe` traduce "dato" a `todos: true` — escribir una petición
 *  habría hecho que el selector pidiera la corrida COMPLETA, 9.040 mutantes en
 *  vez de los 300 que tocaban. Además la cola tenía garantizado el olvido:
 *  `.claude/agents/ingeniero.md` dice «no commitees ni hagas push salvo que se
 *  te pida», así que la petición nacía huérfana en el árbol de trabajo de quien
 *  la escribía.
 *
 *  LO QUE HAY EN SU LUGAR ES UN TAG MOVIBLE: `mutacion-ultima`, que el workflow
 *  reposiciona cuando una corrida cubre el rango entero. Sustituye a la cola, al
 *  fichero de estado, al commit de borrado y a la carrera entre autorizar y
 *  repartir:
 *
 *    · qué falta por medir   = `git log mutacion-ultima..main` — nadie puede
 *      olvidarse de declararlo, porque no hay nada que declarar.
 *    · qué se mide           = `seleccionar()` sobre el diff desde el tag. Es
 *      MÁS correcto que la unión de las peticiones: coge también las PR que
 *      nadie pidió y los commits directos a main (11 de los últimos 40).
 *    · el porqué del ingeniero, cuando lo tenga, viaja como trailer del commit
 *      (`Mutación: <motivo>`). Se lee en el móvil y no crea ficheros.
 *
 *  Uso:
 *    npm run mutacion -- pendiente          # qué hay sin medir, y cuánto cuesta
 *    npm run mutacion -- pendiente --ids    # los ids, para el runner
 *    npm run mutacion -- traer [run-id]     # vacía reports/ y baja el artefacto
 *    npm run mutacion -- repartir           # delta + atribución (--comentar publica)
 *    npm run mutacion -- local <id>         # medir UN módulo barato, aquí
 *    npm run mutacion -- lotes              # cómo se partiría la corrida en jobs
 *    npm run mutacion -- fusionar …         # lo corre CI, junta los lotes
 *    npm run mutacion -- cola <run-id>      # cuánto estorba la matriz a una PR
 *    npm run mutacion -- ancla              # el sha del tag, para el YAML
 *    npm run mutacion -- manifiesto …       # lo escribe CI, no una persona
 *
 *  Lo que decide algo —la huella, el delta, la atribución, el tope— vive en
 *  `scripts/mutacion-huella.ts`, sin git ni disco dentro, para que el candado
 *  pueda ejercerlo con datos sintéticos. Un test que llamara a git de verdad
 *  correría en CI sobre un clon superficial y pasaría en verde sin comprobar
 *  nada, que es lo que `deuda.ts:159` ya documenta de `enColaDeCrap`.
 *
 *  LO QUE QUEDA EN ESTE FICHERO NO LO MIRA NINGÚN TEST, y hay que saberlo: nadie
 *  puede importar `scripts/mutacion.ts` (llama a git y a `gh`) ni `mutate.ts`
 *  (lanza una corrida al cargarse), y `scripts/` está fuera del perímetro de
 *  mutación. Medido el 2026-09-04 sobre el diff de #381+#420: OCHO reversiones
 *  del cableado —el ancla del reparto, la contradicción del rango vacío, el
 *  fail-loud de `leerCorrida`, el cálculo del sello, el ancla que escribe
 *  `manifiesto`, la admisión de `--pedidos ""` y el paso del workflow— dejaban
 *  `npm run verify` en verde. Quien las mira es
 *  `qa/mutacion-cableado-en-negativo.mjs`, que ejerce cada una contra el VERBO
 *  de verdad y exige ver el observable cambiar al romperla. Si tocas algo de
 *  aquí, córrelo; y si añades una decisión nueva, añádele su invariante ahí,
 *  porque la batería no va a enterarse.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { contextoDe, seleccionar, type Seleccion } from "./afectado.js";
import {
  coreRoot,
  esVivo,
  ficherosMutados,
  leerPlan,
  moduloPorId,
  rutaInforme,
  RUTA_HUELLA,
  type PlanMutacion,
} from "./mutation-plan.js";
import {
  atribuir,
  deltaDeCorrida,
  costeDeLaMatriz,
  duenosDeLaMedida,
  empaqueta,
  fusionaCorrida,
  lotesSinNoticias,
  estadoLegible,
  estadoDeReparto,
  marcaDeCorrida,
  modulosConInforme,
  yaComentada,
  fusiona,
  HUELLA_VACIA,
  huellaDeMutante,
  permisoLocal,
  prDelAsunto,
  rangoDe,
  veredictoDeCorrida,
  verificaDescarga,
  vivosDeFichero,
  type Atribucion,
  type Corrida,
  type CommitDelRango,
  type DeltaDeFichero,
  type DuenosDeLaMedida,
  type JobDeCI,
  type OrigenCorrida,
  type PlanDeCorrida,
  type Huella,
  type InformeSellado,
  type MedidaDeFichero,
  type MutanteMedido,
} from "./mutacion-huella.js";

const raizRepo = resolve(coreRoot, "..");
const nombrePaquete = relative(raizRepo, coreRoot).split("\\").join("/");
export const TAG = "mutacion-ultima";
const WORKFLOW = "mutation.yml";
const ARTEFACTO = "informe-mutacion";
const DIR_INFORMES = join(coreRoot, "reports", "mutation");
const RUTA_CORRIDA = join(DIR_INFORMES, "corrida.json");
/** El cronómetro que deja `mutate.ts`, y el plan que escribe `lotes`. Los dos
 *  viven FUERA de `reports/mutation/`: ahí dentro cualquier `.json` que no sea
 *  `corrida.json` se lee como el informe de un módulo, así que un fichero
 *  nuestro inventaría un módulo fantasma. El plan viaja en su propio artefacto
 *  y el cronómetro no viaja: se consume en el mismo job que lo escribió. */
const RUTA_TIEMPOS = join(coreRoot, "reports", "mutacion-tiempos.json");
const RUTA_PLAN_CORRIDA = join(coreRoot, "reports", "plan-corrida.json");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: raizRepo, encoding: "utf8" }).trim();
}

function gitLineas(args: string[]): string[] {
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
function blobEnCommit(sha: string, ficheroRelativoACore: string): string {
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
function shaDelTag(): string {
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
 *  una medida: mirar solo lo commiteado daría una frescura optimista. Es la
 *  misma pareja de comandos que `ficherosCambiados` (`afectado.ts:440-446`). */
export function ficherosDesdeElTag(tag: string): string[] {
  return [
    ...gitLineas(["diff", "--name-only", tag]),
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
function commitsDelRango(plan: PlanMutacion, tag: string, hasta: string): CommitDelRango[] {
  const crudos = gitLineas(["log", "--format=%H\t%s", `${tag}..${hasta}`]);
  return crudos.map((linea) => {
    const [sha, ...resto] = linea.split("\t");
    const asunto = resto.join("\t");
    const ficheros = gitLineas(["diff", "--name-only", `${sha}^`, sha]).map(aCore);
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

function escribeHuella(h: Huella): void {
  writeFileSync(rutaHuella(), `${JSON.stringify(h, null, 2)}\n`);
}

/** La huella COMMITEADA (la de HEAD), que es contra la que se calcula el delta.
 *
 *  No la del árbol de trabajo, y la diferencia se pagó en la primera pasada
 *  real: `repartir` escribe la huella nueva, así que una SEGUNDA pasada antes de
 *  commitear comparaba contra lo que ella misma acababa de escribir y el delta
 *  se colapsaba a cero — el comentario de la PR salía sin los supervivientes
 *  NUEVOS y sin decir que los había perdido. Con la base en HEAD, `repartir` es
 *  idempotente: correrlo dos veces da el mismo reparto, y «el delta se ve en el
 *  diff» pasa a ser literal (base = HEAD, resultado = árbol de trabajo).
 *
 *  Que el fichero no esté en HEAD es la primera vez y se dice; que git no pueda
 *  contestar es otra cosa y se lanza. */
function huellaEnHead(): Huella {
  const ruta = `${nombrePaquete}/${RUTA_HUELLA}`;
  const existe = spawnSync("git", ["cat-file", "-e", `HEAD:${ruta}`], { cwd: raizRepo });
  if (existe.status !== 0) {
    console.log(`(${RUTA_HUELLA} no está en HEAD: primera corrida, todo saldrá SIN BASE)`);
    return HUELLA_VACIA;
  }
  return JSON.parse(git(["show", `HEAD:${ruta}`])) as Huella;
}

/** El coste de un módulo en mutantes, según la última medida que haya de sus
 *  ficheros. Sale de la huella (≈75 KB) y no de los informes (76 MB): es lo que
 *  deja a `pendiente` y al tope de `local` decir un número sin abrir nada. */
export function costeDe(plan: PlanMutacion, huella: Huella, id: string): number | undefined {
  const ficheros = ficherosMutados(moduloPorId(plan, id));
  const medidos = ficheros.map((f) => huella.ficheros[f]).filter(Boolean);
  if (medidos.length === 0) return undefined;
  return medidos.reduce((n, m) => n + m.total, 0);
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

// ── informes ─────────────────────────────────────────────────────────────────

interface InformeCrudo {
  files: Record<string, { mutants: MutanteMedido[] }>;
}

function leerInforme(id: string): InformeCrudo {
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
function informesDelDirectorio(dir: string): InformeSellado[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "corrida.json")
    .sort()
    .map((f) => ({ modulo: f.slice(0, -".json".length), sha256: selloDeInforme(join(dir, f)) }));
}

/** Los informes que hay en `reports/mutation/`, que es donde los deja `mutate`
 *  y donde los baja `traer`. */
function informesEnDisco(): InformeSellado[] {
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
function leerCorrida(): Corrida {
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
function exigeDescargaLimpia(corrida: Corrida): void {
  const errores = verificaDescarga(corrida, informesEnDisco());
  if (errores.length > 0) {
    throw new Error(
      `el contenido de reports/mutation/ no casa con el manifiesto de la corrida ${corrida.run_id}:\n` +
        errores.map((e) => `  · ${e}`).join("\n") +
        `\nVuelve a bajarla entera: npm run mutacion -- traer ${corrida.run_id}`,
    );
  }
}

// ── verbo: pendiente ─────────────────────────────────────────────────────────

function pendiente(argv: readonly string[]): void {
  const plan = leerPlan();
  const tag = shaDelTag();
  const sel = seleccionDesdeElTag(plan, tag);
  const ids = sel.todos ? plan.modulos.map((m) => m.id) : sel.ids;

  if (argv.includes("--ids")) {
    // Un rango vacío NO se degrada a la corrida completa ni a un verde en
    // silencio: si el runner llega aquí es que alguien pulsó "Run workflow", y
    // medir cero módulos gastando un runner de 180 minutos es peor que decirlo.
    if (ids.length === 0) {
      throw new Error(
        `no hay nada que medir desde ${TAG}: el diff no selecciona ningún módulo. ` +
          `Si querías la corrida completa, lánzala con el input TODOS.`,
      );
    }
    console.log(ids.join(" "));
    return;
  }

  const huella = leerHuella();
  const commits = commitsDelRango(plan, tag, "HEAD");
  const fechaTag = git(["log", "-1", "--format=%ad", "--date=short", tag]);
  console.log(`\nPendiente de medir desde ${TAG} (${tag.slice(0, 7)}, ${fechaTag})\n`);

  if (commits.length === 0) console.log("  Sin commits nuevos desde la última corrida.");
  else {
    console.log(`  ${commits.length} commit(s) sin medir:`);
    for (const c of commits) {
      const quien = c.pr === undefined ? `${c.sha.slice(0, 7)} (directo a main)` : `#${c.pr}`;
      console.log(`    ${quien.padEnd(22)} ${c.asunto.slice(0, 72)}`);
    }
  }

  const sucios = ficherosDesdeElTag(tag).length;
  console.log(`\n  ${sucios} fichero(s) cambiados desde el tag (árbol de trabajo incluido).`);
  if (ids.length === 0) {
    console.log("  NO se mediría nada: el diff no selecciona ningún módulo.");
  } else {
    const costes = ids.map((id) => costeDe(plan, huella, id));
    const conocido = costes.filter((c): c is number => c !== undefined).reduce((a, b) => a + b, 0);
    const sinBase = ids.filter((id, i) => costes[i] === undefined);
    console.log(
      `  Se medirían ${ids.length} de ${plan.modulos.length} módulos` +
        `${sel.todos ? " (COMPLETA: el selector no puede descartar nada)" : ""} · ` +
        `${conocido} mutantes medidos antes` +
        (sinBase.length > 0 ? ` + ${sinBase.length} módulo(s) sin base: ${sinBase.join(", ")}` : ""),
    );
    for (const e of sel.efectos.filter((x) => x.todos)) {
      console.log(`    fuerza la completa: ${e.fichero} — ${e.porque}`);
    }
  }

  // QUIÉN CABE EN EL TOPE, con su margen. El conjunto medible en local cambia
  // sin que nadie lo relacione: basta con que alguien añada un test a un módulo
  // que estaba a dos mutantes de la línea para que salga del conjunto en
  // silencio. Enseñarlo convierte ese silencio en un número.
  const medibles = plan.modulos
    .map((m) => ({ id: m.id, coste: costeDe(plan, huella, m.id) }))
    .filter((m): m is { id: string; coste: number } => m.coste !== undefined && m.coste <= plan.tope_local)
    .sort((a, b) => a.coste - b.coste);
  if (medibles.length > 0) {
    const alBorde = medibles[medibles.length - 1];
    console.log(
      `\n  Medibles aquí (tope ${plan.tope_local}): ` +
        medibles.map((m) => `${m.id} ${m.coste}`).join(" · ") +
        `\n  ${alBorde.id} está a ${plan.tope_local - alBorde.coste} mutante(s) del tope: ` +
        `el próximo test que se le añada lo saca del conjunto.`,
    );
  }

  console.log(
    `\n  Autorízalo:  Actions → "Mutation testing" → Run workflow (input vacío = este rango)` +
      `\n  Respaldo:    gh workflow run ${WORKFLOW} -r ${git(["rev-parse", "--abbrev-ref", "HEAD"])}` +
      `\n  Una petición pendiente NO bloquea nada: sigue y cierra la tanda.\n`,
  );
}

// ── verbo: traer ─────────────────────────────────────────────────────────────

interface RunDeCI {
  databaseId: number;
  headSha: string;
  status: string;
  conclusion: string;
  createdAt: string;
}

function gh(args: string[], stdin?: string): string {
  const r = spawnSync("gh", args, {
    cwd: raizRepo,
    encoding: "utf8",
    input: stdin,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(" ")} falló (${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
  }
  return r.stdout;
}

/** La última corrida terminada del workflow. NO se filtra por `conclusion ==
 *  success` a propósito: `mutate.ts` sale con 1 cuando un módulo baja de su
 *  `break`, así que una medida completa que destape una regresión deja el run en
 *  ROJO. Filtrar por verde rechazaría justo las corridas que traen el hallazgo;
 *  quien decide si la medida sirve es `corrida.json`. */
function ultimaCorrida(): RunDeCI {
  const runs = JSON.parse(
    gh(["run", "list", "--workflow", WORKFLOW, "-L", "20", "--json", "databaseId,headSha,status,conclusion,createdAt"]),
  ) as RunDeCI[];
  const terminadas = runs.filter((r) => r.status === "completed");
  if (terminadas.length === 0) {
    throw new Error(`no hay ninguna corrida terminada de ${WORKFLOW}: lánzala y espera a que acabe.`);
  }
  return terminadas[0];
}

function traer(argv: readonly string[]): void {
  const pedido = argv.find((a) => /^\d+$/.test(a));
  const run = pedido ? { databaseId: Number(pedido) } : ultimaCorrida();
  const id = String(run.databaseId);

  // Vaciar ANTES de bajar, y no fusionar: un informe de la semana pasada que se
  // quedara aquí se leería como parte de esta foto.
  mkdirSync(DIR_INFORMES, { recursive: true });
  for (const f of readdirSync(DIR_INFORMES)) rmSync(join(DIR_INFORMES, f), { force: true });
  console.log(`Bajando el artefacto "${ARTEFACTO}" de la corrida ${id}…`);
  gh(["run", "download", id, "-n", ARTEFACTO, "-D", relative(raizRepo, DIR_INFORMES)]);

  const corrida = leerCorrida();
  exigeDescargaLimpia(corrida);
  const veredicto = veredictoDeCorrida(corrida);
  const conInforme = modulosConInforme(corrida);
  console.log(
    `\nCorrida ${corrida.run_id} sobre ${corrida.sha.slice(0, 7)} (${corrida.origen}), ${corrida.fecha}\n` +
      `  rango medido desde ${corrida.desde.slice(0, 7)}\n` +
      `  ${conInforme.length} informe(s): ${conInforme.join(", ")}\n` +
      `  ${veredicto.completa ? "COMPLETA" : "INCOMPLETA"} — ${veredicto.porque}\n` +
      `\nSigue con:  npm run mutacion -- repartir\n`,
  );
  if (!veredicto.completa) process.exitCode = 1;
}

// ── verbo: repartir ──────────────────────────────────────────────────────────

interface HallazgoNuevo {
  fichero: string;
  linea: number;
  columna: number;
  mutador: string;
  replacement: string;
}

interface Reparto {
  modulo: string;
  ficheros: DeltaDeFichero[];
  // La MISMA estructura que va a la huella, derivada de la atribución una sola
  // vez: aquí se rehacían los nombres a mano (una copia de `nombreDeCommit`) y
  // el veredicto viajaba aparte, así que la consola y el fichero podían acabar
  // diciendo cosas distintas del mismo módulo.
  duenos: DuenosDeLaMedida;
  etiqueta: string;
  // Derivado de `Atribucion` y no copiado: una segunda lista de veredictos
  // podría quedarse sin el cuarto y el compilador no diría nada.
  veredicto: Atribucion["veredicto"];
  nuevos: HallazgoNuevo[];
  bateria: readonly string[];
}

function repartir(argv: readonly string[]): void {
  const plan = leerPlan();
  const corrida = leerCorrida();
  exigeDescargaLimpia(corrida);
  const base = huellaEnHead();
  // EL ANCLA LA TRAE LA CORRIDA, no el tag (#381). `shaDelTag()` aquí leería un
  // tag que esta misma corrida ya adelantó a `corrida.sha` al terminar
  // (`mutation.yml`), así que el rango salía vacío por construcción y los 33
  // módulos «sin dueño» — justo en la corrida que más tenía que repartir.
  const rango = rangoDe(commitsDelRango(plan, corrida.desde, corrida.sha));
  if (corrida.origen === "rango" && rango.tipo === "vacío") {
    // Contradicción demostrable, no una rareza que tolerar: si el origen es
    // `rango`, CI eligió los módulos a partir del diff desde este mismo ancla,
    // y un diff que seleccionó algo no puede venir de cero commits. O el ancla
    // no es la que usó la selección, o el clon no tiene la historia.
    throw new Error(
      `la corrida ${corrida.run_id} dice haber medido el RANGO desde ${corrida.desde.slice(0, 7)} hasta ` +
        `${corrida.sha.slice(0, 7)}, y ese rango no tiene ni un commit. CI no pudo seleccionar módulos ` +
        `de un diff vacío: o el ancla del manifiesto no es la que usó la selección, o a este clon le ` +
        `falta la historia (git fetch --unshallow).`,
    );
  }

  if (yaRepartida(corrida, base)) return;

  const repartos: Reparto[] = [];
  const medidos: Record<string, MedidaDeFichero> = {};

  for (const id of modulosConInforme(corrida)) {
    const modulo = moduloPorId(plan, id);
    const informe = leerInforme(id);
    const ahora: Record<string, { vivos: string[]; total: number; blob: string }> = {};
    for (const [fichero, info] of Object.entries(informe.files)) {
      ahora[fichero] = { ...vivosDeFichero(fichero, info.mutants), blob: blobEnCommit(corrida.sha, fichero) };
    }
    const deltas = deltaDeCorrida(ahora, base);
    const atribucion = atribuir(id, rango);
    const duenos = duenosDeLaMedida(atribucion);
    // El reloj del módulo entra en la huella, que es de donde `lotes`
    // presupuesta. Va repetido en cada fila del módulo porque la huella se
    // indexa por fichero; `segundosDe` lo lee con MÁXIMO, no con suma.
    const segundos = corrida.informes.find((i) => i.modulo === id)?.segundos;

    for (const d of deltas) {
      medidos[d.fichero] = {
        sha: corrida.sha,
        run: corrida.run_id,
        fecha: corrida.fecha,
        blob: ahora[d.fichero].blob,
        total: d.total,
        vivos: [...d.vivos].sort(),
        nuevos: [...d.nuevos].sort(),
        resueltos: d.resueltos.length,
        base: d.base,
        duenos,
        ...(segundos === undefined ? {} : { segundos }),
      };
    }
    repartos.push({
      modulo: id,
      ficheros: deltas,
      duenos,
      etiqueta: atribucion.etiqueta,
      veredicto: atribucion.veredicto,
      nuevos: hallazgosNuevos(deltas, informe),
      bateria: modulo.tests,
    });
  }

  escribeHuella(fusiona(base, medidos));
  console.log(`\nHuella actualizada: ${RUTA_HUELLA} — commítala con la tanda, el delta se ve en el diff.\n`);

  imprimeReparto(repartos, corrida);
  if (!veredictoDeCorrida(corrida).completa) process.exitCode = 1;

  const comentar = argv.includes("--comentar");
  const porPr = agrupaPorPr(repartos);
  for (const [pr, suyos] of porPr) {
    const cuerpo = comentarioDe(pr, suyos, corrida);
    if (!comentar) {
      console.log(`\n─── comentario que iría a #${pr} (usa --comentar para publicarlo) ───\n${cuerpo}`);
      continue;
    }
    // IDEMPOTENCIA DONDE OCURRE EL EFECTO. El guardia de la huella solo está
    // armado cuando la huella está COMMITEADA, y entre `repartir --comentar` y
    // el `git commit` cabe otro `repartir --comentar`. Por esa ventana salieron
    // los dos comentarios contradictorios de #273: mismo run, veredictos
    // opuestos, y nada en la PR que dijera cuál mandaba. Preguntar a la PR
    // cierra la ventana entera, esté la huella donde esté.
    if (yaComentada(cuerposDeComentarios(pr), corrida.run_id)) {
      console.log(
        `#${pr} ya tiene el comentario de la corrida ${corrida.run_id}: no se publica otro.\n` +
          `  Dos comentarios de la misma corrida no se distinguen entre sí, y el segundo no ` +
          `corrige al primero: los deja contradiciéndose.`,
      );
      continue;
    }
    gh(["api", `repos/{owner}/{repo}/issues/${pr}/comments`, "--input", "-"], JSON.stringify({ body: cuerpo }));
    console.log(`Comentado en #${pr}.`);
  }
  const huerfanos = repartos.filter((r) => r.veredicto === "sin dueño");
  if (huerfanos.length > 0) {
    console.log(
      `\n${huerfanos.length} módulo(s) SIN DUEÑO en el rango: ${huerfanos.map((r) => r.modulo).join(", ")}. ` +
        `Se cuentan y se enseñan; no se descartan.`,
    );
  }
  // «Sin rango» no es «sin dueño», y decirlo así importa: lo primero manda a
  // mirar el superviviente, lo segundo a mirar por qué la corrida no tenía nada
  // que medir. Legítimo con origen `todos` o `explicito` — una corrida completa
  // pedida cuando no había commits nuevos.
  const sinRango = repartos.filter((r) => r.veredicto === "rango vacío");
  if (sinRango.length > 0) {
    console.log(
      `\n${sinRango.length} módulo(s) sin RANGO que mirar: entre ${corrida.desde.slice(0, 7)} y ` +
        `${corrida.sha.slice(0, 7)} no hay ningún commit, así que la atribución no tiene dónde buscar. ` +
        `No son «sin dueño»: nadie los ha buscado.`,
    );
  }
}

/** ¿Está esta corrida ya repartida y commiteada? La REGLA vive en
 *  `mutacion-huella.ts` (`estadoDeReparto`, pura y con candado); aquí solo se
 *  leen los ficheros del informe y se actúa sobre el veredicto. */
function yaRepartida(corrida: Corrida, base: Huella): boolean {
  const ficheros = modulosConInforme(corrida).flatMap((id) => Object.keys(leerInforme(id).files));
  const estado = estadoDeReparto(corrida.run_id, ficheros, base);
  if (estado.tipo === "a medio repartir") {
    throw new Error(
      `la corrida ${corrida.run_id} está a medio repartir en la huella de HEAD: ` +
        `${estado.repartidos} de ${estado.total} ficheros ya la llevan. Arregla la huella ` +
        `(git checkout ${RUTA_HUELLA} y vuelve a repartir) antes de seguir.`,
    );
  }
  if (estado.tipo === "pendiente") return false;
  console.log(
    `\nLa corrida ${corrida.run_id} ya está repartida y commiteada: no se toca la huella.\n` +
      `  Volver a repartirla borraría los NUEVOS y sus dueños, que es justo lo que hay que leer.\n` +
      `  La cola viva sigue en: npm run deuda\n`,
  );
  return true;
}

/** Los supervivientes NUEVOS, con su sitio exacto. La huella sola no vale para
 *  un comentario: «cuatro hashes nuevos» no lo arregla nadie. Fichero, línea,
 *  columna, mutador y con qué se sustituyó, que es lo que un ingeniero que
 *  llegue de cero necesita para escribir el test que faltaba. */
function hallazgosNuevos(deltas: readonly DeltaDeFichero[], informe: InformeCrudo): HallazgoNuevo[] {
  const nuevos = new Set(deltas.flatMap((d) => d.nuevos));
  if (nuevos.size === 0) return [];
  const out: HallazgoNuevo[] = [];
  for (const [fichero, info] of Object.entries(informe.files)) {
    for (const m of info.mutants) {
      if (!esVivo(m.status) || !nuevos.has(huellaDeMutante(fichero, m))) continue;
      out.push({
        fichero,
        linea: m.location.start.line,
        columna: m.location.start.column,
        mutador: m.mutatorName,
        replacement: (m.replacement ?? "").replace(/\s+/g, " ").slice(0, 60),
      });
    }
  }
  return out.sort((a, b) => a.fichero.localeCompare(b.fichero) || a.linea - b.linea);
}

/** `git blame` de una línea, como PISTA y nunca como veredicto. Contesta «quién
 *  escribió esta línea», que no es «qué cambio movió la suerte de este mutante»:
 *  con squash da la PR que se mergeó DESPUÉS (basta un `npm run format`), y en
 *  los 148 supervivientes `BlockStatement` la línea es la de la FIRMA. */
function pistaDeBlame(sha: string, fichero: string, linea: number): string {
  try {
    const salida = git(["blame", "-L", `${linea},${linea}`, "--porcelain", sha, "--", `${nombrePaquete}/${fichero}`]);
    const autor = /^author (.*)$/m.exec(salida)?.[1] ?? "?";
    const resumen = /^summary (.*)$/m.exec(salida)?.[1] ?? "?";
    return `${autor}: ${resumen.slice(0, 60)}`;
  } catch (err) {
    return `sin pista (${String((err as Error).message).split("\n")[0]})`;
  }
}

function agrupaPorPr(repartos: readonly Reparto[]): Map<number, Reparto[]> {
  const out = new Map<number, Reparto[]>();
  for (const r of repartos) {
    // Solo la rama con dueños tiene a quién comentar; las otras dos ni siquiera
    // ofrecen una lista que recorrer, que es la gracia de la unión.
    if (r.duenos.veredicto !== "con dueño") continue;
    for (const d of r.duenos.quienes) {
      if (!d.startsWith("#")) continue;
      const pr = Number(d.slice(1));
      out.set(pr, [...(out.get(pr) ?? []), r]);
    }
  }
  return out;
}

function imprimeReparto(repartos: readonly Reparto[], corrida: Corrida): void {
  console.log(
    `Reparto de la corrida ${corrida.run_id} (${corrida.desde.slice(0, 7)}..${corrida.sha.slice(0, 7)}, ` +
      `${corrida.origen})\n`,
  );
  for (const r of repartos) {
    console.log(`  ${r.modulo}  →  ${r.etiqueta}`);
    for (const d of r.ficheros) {
      const vivos = d.vivos.length;
      const estado = estadoLegible(d);
      console.log(`    ${d.fichero}  ${vivos} vivos de ${d.total} — ${estado}`);
    }
    for (const n of r.nuevos.slice(0, 8)) {
      console.log(
        `      NUEVO ${n.fichero}:${n.linea}:${n.columna} ${n.mutador} → ${n.replacement}` +
          `\n            pista (git blame, NO es el veredicto): ${pistaDeBlame(corrida.sha, n.fichero, n.linea)}`,
      );
    }
    if (r.nuevos.length > 8) console.log(`      …y ${r.nuevos.length - 8} nuevos más`);
  }
  const conInforme = modulosConInforme(corrida);
  const sinMedir = corrida.modulos_pedidos.filter((id) => !conInforme.includes(id));
  if (sinMedir.length > 0) {
    // Se dice AQUÍ, al final y no al principio, porque esta salida es la que se
    // copia al informe de la tanda: un reparto parcial que termina en silencio
    // se lee como completo, y el módulo caído conserva su huella vieja — que en
    // el diff parece «no cambió» y en realidad es «no se miró».
    console.log(
      `  ⚠ ${sinMedir.length} módulo(s) se PIDIERON y no dejaron informe: ${sinMedir.join(", ")}\n` +
        `    conservan la huella de su última medida; no son «0 supervivientes», son «sin mirar».\n` +
        `    El tag NO se ha movido, así que la próxima corrida vuelve a pedirlos.`,
    );
  }
  console.log("");
}

/** Los cuerpos de los comentarios que ya tiene una PR. Fail-loud: si `gh` no
 *  puede contestar NO se degrada a "no hay ninguno", porque eso llevaría a
 *  publicar el duplicado que esto existe para impedir. */
function cuerposDeComentarios(pr: number): string[] {
  const crudo = gh(["api", `repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`]);
  return (JSON.parse(crudo) as { body?: string }[]).map((c) => c.body ?? "");
}

function comentarioDe(pr: number, repartos: readonly Reparto[], corrida: Corrida): string {
  const lineas = [
    // Marca invisible para reconocer los comentarios de esta corrida sin
    // depender de cómo esté redactada la cabecera.
    marcaDeCorrida(corrida.run_id),
    `## Mutación · corrida [${corrida.run_id}](https://github.com/alberto-hortelano/ne-fan/actions/runs/${corrida.run_id}) sobre \`${corrida.sha.slice(0, 7)}\``,
    "",
    `Esta PR es **candidata** de ${repartos.length} módulo(s) medidos: el diff de su commit selecciona ese módulo, ` +
      `así que pudo mover la suerte de sus mutantes. No es \`git blame\`: con dos candidatos se nombran los dos.`,
    "",
  ];
  for (const r of repartos) {
    lineas.push(`### \`${r.modulo}\` — ${r.veredicto === "varios" ? `candidatas: ${r.etiqueta}` : r.etiqueta}`);
    lineas.push("");
    lineas.push("| fichero | vivos / total | estado |");
    lineas.push("|---|---|---|");
    for (const d of r.ficheros) {
      const vivos = d.vivos.length;
      const estado = estadoLegible(d, { markdown: true });
      lineas.push(`| \`${d.fichero}\` | ${vivos} / ${d.total} | ${estado} |`);
    }
    lineas.push("");
    if (r.nuevos.length > 0) {
      lineas.push(`<details><summary>${r.nuevos.length} superviviente(s) NUEVOS</summary>`);
      lineas.push("");
      for (const n of r.nuevos.slice(0, 40)) {
        lineas.push(`- \`${n.fichero}:${n.linea}:${n.columna}\` · ${n.mutador} → \`${n.replacement}\``);
      }
      if (r.nuevos.length > 40) lineas.push(`- …y ${r.nuevos.length - 40} más`);
      lineas.push("");
      lineas.push("</details>");
      lineas.push("");
    }
    lineas.push(`Los mataría un test de: ${r.bateria.map((t) => `\`${t}\``).join(", ")}.`);
    lineas.push("");
  }
  lineas.push(
    `Para reproducirlo aquí: \`npm run mutacion -- local <módulo>\` si es barato; si no, ` +
      `\`npm run mutacion -- pendiente\`. La cola viva está en \`npm run deuda\`.`,
  );
  return lineas.join("\n");
}

// ── verbo: local ─────────────────────────────────────────────────────────────

function local(argv: readonly string[]): void {
  const id = argv.find((a) => !a.startsWith("-"));
  if (!id) throw new Error("falta el id del módulo: npm run mutacion -- local <id>");
  const plan = leerPlan();
  moduloPorId(plan, id); // fail-loud si el id no existe, con la lista de los que sí
  const coste = costeDe(plan, leerHuella(), id);
  const permiso = permisoLocal(id, coste, plan.tope_local);
  if (!permiso.ok) {
    console.error(`\nNO se mide aquí: ${permiso.porque}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n${id}: ${permiso.coste} mutantes (tope local ${plan.tope_local}). Concurrencia 2 — ` +
      `dos núcleos, la máquina sigue siendo de quien la usa.\n`,
  );
  const r = spawnSync("npx", ["tsx", "scripts/mutate.ts", id], {
    cwd: coreRoot,
    stdio: "inherit",
    env: { ...process.env, NEFAN_MUTATE_CONCURRENCY: "2", NEFAN_MUTATE_AUTORIZADO: "si" },
  });
  process.exitCode = r.status ?? 1;
}

// ── verbo: lotes (parte la corrida por el reloj) ─────────────────────────────

/** Un origen válido, o un error que dice cuáles hay. Compartido por `manifiesto`
 *  y `lotes`: dos validaciones del mismo enum acabarían discrepando. */
function origenValido(v: string): OrigenCorrida {
  if (v !== "rango" && v !== "todos" && v !== "explicito") {
    throw new Error(`--origen inválido: "${v}" (rango | todos | explicito)`);
  }
  return v;
}

/** Cómo se reparte la corrida en jobs, y —si CI lo pide— el plan que la fusión
 *  necesitará después.
 *
 *  Sin los flags de CI solo IMPRIME: es lo que deja mirar el reparto sin medir
 *  nada ni gastar un runner, y es la comprobación que se hace a ojo en la PR.
 *
 *    npm run mutacion -- lotes                        # lo que se mediría hoy
 *    npm run mutacion -- lotes --ids "a b c"          # esos módulos
 *    npm run mutacion -- lotes --ids … --origen … --sha … --desde … --run …
 *                                                     # además escribe el plan
 */
function lotes(argv: readonly string[]): void {
  const plan = leerPlan();
  const huella = leerHuella();
  const opcional = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };

  const idsCrudos = opcional("--ids");
  const ids = argv.includes("--todos")
    ? // El input TODOS del workflow. Explícito y no una lista vacía que alguien
      // tenga que interpretar: `--pedidos ""` ya costó una corrida entera.
      plan.modulos.map((m) => m.id)
    : idsCrudos === undefined
      ? (() => {
          const sel = seleccionDesdeElTag(plan, shaDelTag());
          return sel.todos ? plan.modulos.map((m) => m.id) : sel.ids;
        })()
      : idsCrudos.split(/\s+/).filter(Boolean);
  // Fail-loud: un id inventado en el input del workflow tiene que morir AQUÍ,
  // no en el job que intente medirlo media hora después.
  for (const id of ids) moduloPorId(plan, id);
  if (ids.length === 0) {
    throw new Error(
      `no hay nada que repartir: el diff desde ${TAG} no selecciona ningún módulo. ` +
        `Si querías la corrida completa, lánzala con el input TODOS.`,
    );
  }

  const paquetes = empaqueta(
    ids.map((id) => {
      const s = segundosDe(plan, huella, id);
      return s === undefined ? { id } : { id, segundos: s };
    }),
    plan.tope_lote,
  );

  const tope = plan.tope_lote;
  console.log(`\n${paquetes.length} lote(s) para ${ids.length} módulo(s) · tope ${tope}s (${(tope / 60).toFixed(0)} min)\n`);
  for (const l of paquetes) {
    if (!l.medido) {
      console.log(`  lote ${String(l.lote).padStart(2)}  SIN MEDIDA DE RELOJ  ${l.modulos.join(" ")}`);
      continue;
    }
    // EL MARGEN SE IMPRIME, y no es adorno: `blueprint-derive` está a dos
    // minutos y medio del tope, igual que `npc-director` está a dos mutantes de
    // `tope_local`. El primer test que se le añada lo saca del empaquetado, y
    // eso hay que verlo venir en vez de descubrirlo con una corrida cortada.
    const margen = l.margen ?? 0;
    const aviso = margen < 0 ? "  ⚠ SE PASA DEL TOPE: irá solo y hay que partir su batería" : "";
    console.log(
      `  lote ${String(l.lote).padStart(2)}  ${String(l.segundos).padStart(5)}s ` +
        `(margen ${margen >= 0 ? "+" : ""}${margen}s = ${(margen / 60).toFixed(1)} min)  ` +
        `${l.modulos.join(" ")}${aviso}`,
    );
  }
  // EL MÓDULO QUE MARCA EL SUELO DEL RELOJ, con su margen propio. Es la otra
  // lectura del margen y la que avisa antes: mientras el más caro quepa en un
  // lote, el reparto tiene arreglo; el día que él solo pase del tope, ninguna
  // partición baja de ahí y hay que partir su batería. Es el mismo aviso que
  // `pendiente` da con `npc-director`, a dos mutantes de `tope_local`.
  const conReloj = ids
    .map((id) => ({ id, s: segundosDe(plan, huella, id) }))
    .filter((m): m is { id: string; s: number } => m.s !== undefined)
    .sort((a, b) => b.s - a.s);
  const peor = conReloj[0];
  if (peor) {
    const margen = tope - peor.s;
    console.log(
      `\n  El más caro es ${peor.id} con ${peor.s}s: está a ${margen}s (${(margen / 60).toFixed(1)} min) de ` +
        `no caber él solo. El primer test que se le añada lo saca del empaquetado, y entonces la ` +
        `respuesta es partir su batería, nunca subir tope_lote.`,
    );
  }

  const sinMedida = paquetes.filter((l) => !l.medido).length;
  if (sinMedida > 0) {
    console.log(
      `\n  ${sinMedida} módulo(s) sin medida de reloj van SOLOS, por la misma razón por la que ` +
        `permisoLocal rechaza el coste desconocido: un coste que nadie sabe no se supone barato. ` +
        `Se cura solo en cuanto los mida una corrida.`,
    );
  }

  const sha = opcional("--sha");
  if (sha === undefined) {
    console.log(`\n  (solo lectura: sin --sha/--desde/--run/--origen no se escribe el plan de la corrida)\n`);
    return;
  }
  const exige = (flag: string): string => {
    const v = opcional(flag);
    if (v === undefined || v === "") throw new Error(`lotes necesita ${flag} para escribir el plan`);
    return v;
  };
  const planCorrida: PlanDeCorrida = {
    sha,
    desde: exige("--desde"),
    run_id: exige("--run"),
    origen: origenValido(exige("--origen")),
    // LA LISTA COMPLETA, y aquí es donde se decide todo lo demás: la fusión la
    // leerá de aquí y no de los lotes que sobrevivan, así que un lote que muera
    // entero deja sus módulos pedidos y sin informe → INCOMPLETA y el tag
    // quieto. Ver `fusionaCorrida`.
    modulos_pedidos: [...ids].sort(),
    lotes: paquetes,
  };
  mkdirSync(dirname(RUTA_PLAN_CORRIDA), { recursive: true });
  writeFileSync(RUTA_PLAN_CORRIDA, `${JSON.stringify(planCorrida, null, 2)}\n`);
  console.log(`\n  Plan de la corrida en ${relative(coreRoot, RUTA_PLAN_CORRIDA)}\n`);

  const salida = process.env.GITHUB_OUTPUT;
  if (salida) {
    // La matriz que consume `fromJSON`. Un objeto por lote con sus ids ya
    // formateados: el job de medir no necesita leer el plan para saber qué le
    // toca, y así un fallo al bajar el artefacto no puede convertirse en un
    // lote que mide otra cosa.
    const matriz = paquetes.map((l) => ({ lote: l.lote, ids: l.modulos.join(" ") }));
    writeFileSync(salida, `matriz=${JSON.stringify(matriz)}\nlotes=${paquetes.length}\n`, { flag: "a" });
  }
}

// ── verbo: fusionar (lo corre el job `reunir`) ───────────────────────────────

/** Junta el plan con los manifiestos parciales de cada lote y deja EXACTAMENTE
 *  lo que `traer` y `repartir` esperan: un `reports/mutation/` con un informe
 *  por módulo y un solo `corrida.json`. Los dos verbos de quien reparte no se
 *  enteran de que la corrida vino partida, que es el objetivo.
 *
 *    npm run mutacion -- fusionar --entrada <dir con los artefactos bajados>
 */
function fusionar(argv: readonly string[]): void {
  const i = argv.indexOf("--entrada");
  const entrada = i < 0 ? undefined : argv[i + 1];
  if (!entrada) throw new Error("fusionar necesita --entrada <dir con los artefactos bajados>");

  const rutaPlan = join(entrada, "plan-corrida", "plan-corrida.json");
  if (!existsSync(rutaPlan)) {
    // Sin plan NO se fabrica una corrida con lo que haya llegado: eso es
    // justamente lo que haría que un lote muerto saliera COMPLETA.
    throw new Error(
      `no está el plan de la corrida en ${rutaPlan}. Sin él no se sabe qué se PIDIÓ medir, y ` +
        `reconstruirlo desde los lotes que llegaron haría que un lote caído se llevara consigo ` +
        `tanto lo pedido como lo medido: el veredicto diría COMPLETA y el tag se movería mintiendo.`,
    );
  }
  const plan = JSON.parse(readFileSync(rutaPlan, "utf8")) as PlanDeCorrida;

  // Cada lote subió su artefacto `informe-mutacion-<n>`; `download-artifact`
  // los deja como subdirectorios con ese nombre.
  const dirsDeLote = readdirSync(entrada)
    .filter((d) => d.startsWith("informe-mutacion-"))
    .sort();
  const parciales: Corrida[] = [];
  const ficheros: { modulo: string; origen: string }[] = [];
  for (const d of dirsDeLote) {
    const dir = join(entrada, d);
    const rutaParcial = join(dir, "corrida.json");
    if (!existsSync(rutaParcial)) {
      // Un artefacto sin manifiesto no es un lote medido: es un lote que subió
      // basura. Se dice y no se mezcla.
      console.log(`  ⚠ ${d} no trae corrida.json: se ignora y sus módulos cuentan como sin informe`);
      continue;
    }
    const parcial = JSON.parse(readFileSync(rutaParcial, "utf8")) as Corrida;
    // EL SELLO DE #420, ANTES DE MEZCLAR. Es lo que hace segura la fusión de N
    // artefactos: sin esto, juntar informes de varios sitios reabriría el
    // agujero que la PR anterior cerró.
    const presentes = informesDelDirectorio(dir);
    const errores = verificaDescarga(parcial, presentes);
    if (errores.length > 0) {
      throw new Error(
        `el lote ${d} no casa con su propio manifiesto:\n` + errores.map((e) => `  · ${e}`).join("\n"),
      );
    }
    parciales.push(parcial);
    for (const p of presentes) ficheros.push({ modulo: p.modulo, origen: join(dir, `${p.modulo}.json`) });
  }

  const corrida = fusionaCorrida(plan, parciales, new Date().toISOString());

  mkdirSync(DIR_INFORMES, { recursive: true });
  for (const f of readdirSync(DIR_INFORMES)) rmSync(join(DIR_INFORMES, f), { force: true });
  for (const f of ficheros) copyFileSync(f.origen, join(DIR_INFORMES, `${f.modulo}.json`));
  writeFileSync(RUTA_CORRIDA, `${JSON.stringify(corrida, null, 2)}\n`);

  const veredicto = veredictoDeCorrida(corrida);
  const caidos = lotesSinNoticias(plan, parciales);
  console.log(
    `\nCorrida ${corrida.run_id} sobre ${corrida.sha.slice(0, 7)} (${corrida.origen}), ` +
      `${plan.lotes.length} lote(s)\n` +
      `  ${corrida.informes.length} informe(s) de ${corrida.modulos_pedidos.length} pedido(s)\n` +
      `  ${veredicto.completa ? "COMPLETA" : "INCOMPLETA"} — ${veredicto.porque}`,
  );
  if (caidos.length > 0) {
    console.log(
      `  ⚠ ${caidos.length} lote(s) SIN NOTICIAS: ${caidos.map((l) => `${l.lote} (${l.modulos.join(", ")})`).join(" · ")}\n` +
        `    No subieron nada. Sus módulos siguen PEDIDOS y sin informe, así que la corrida es ` +
        `INCOMPLETA y el tag no se mueve — que es exactamente lo que tiene que pasar.`,
    );
  }
  const salida = process.env.GITHUB_OUTPUT;
  if (salida) {
    writeFileSync(salida, `completa=${veredicto.completa}\nmueve_tag=${veredicto.mueveTag}\n`, { flag: "a" });
  }
  if (!veredicto.completa) process.exitCode = 1;
}

// ── verbo: cola (¿cuánto estorba la matriz?) ─────────────────────────────────

/** Cuánto espera una PR normal mientras la matriz ocupa el pool de runners.
 *
 *  NO SE ESTIMA, SE MIDE, y por eso existe este verbo en vez de un número
 *  puesto a ojo en el YAML: `max-parallel` empieza en 6 porque hay que empezar
 *  en algo, y se ajusta con esto. La pregunta es del arquitecto y el umbral es
 *  del usuario, que puede moverlo:
 *
 *    · sobre la corrida de MUTACIÓN → el sobrecoste de partir (N × checkout +
 *      `npm ci` + dry-run), que son minutos de runner y no de reloj;
 *    · sobre la corrida de una PR NORMAL lanzada mientras la matriz corre → lo
 *      que esa PR esperó. Si pasa de dos minutos, se baja `max-parallel`: el
 *      reloj de la mutación es diferido y el de una PR no, y el hook
 *      `ci-verde.sh` no deja cerrar una tarea con el CI pendiente.
 *
 *    npm run mutacion -- cola <run-id>
 */
const TOPE_ESPERA_S = 120;

function cola(argv: readonly string[]): void {
  const id = argv.find((a) => /^\d+$/.test(a));
  if (!id) throw new Error("falta el id de la corrida: npm run mutacion -- cola <run-id>");
  const jobs = JSON.parse(gh(["api", `repos/{owner}/{repo}/actions/runs/${id}/jobs?per_page=100`, "--paginate"]))
    .jobs as JobDeCI[];
  const c = costeDeLaMatriz(jobs, TOPE_ESPERA_S);
  const min = (s: number): string => `${(s / 60).toFixed(1)} min`;
  console.log(
    `\nCorrida ${id} · ${c.jobs} job(s)\n` +
      `  espera de cola   peor ${min(c.esperaPeor)} (${c.esperaPeorJob}) · mediana ${min(c.esperaMediana)}\n` +
      `  reloj de pared   ${min(c.pared)}\n` +
      `  runner gastado   ${min(c.runner)}\n` +
      `  sobrecoste       ${min(c.sobrecoste)} — lo que se paga por venir partida (N × checkout + npm ci + dry-run)\n`,
  );
  if (c.cabe) {
    console.log(`  ✔ el peor job esperó ${min(c.esperaPeor)}, dentro del presupuesto de ${min(TOPE_ESPERA_S)}.\n`);
    return;
  }
  console.log(
    `  ✗ el peor job esperó ${min(c.esperaPeor)}, por encima del presupuesto de ${min(TOPE_ESPERA_S)}.\n` +
      `    BAJA max-parallel en .github/workflows/mutation.yml. El reloj de la mutación es diferido y\n` +
      `    el de una PR no: el hook ci-verde.sh no deja cerrar una tarea con el CI pendiente.\n`,
  );
  process.exitCode = 1;
}

// ── verbo: ancla (lo lee CI antes de medir) ──────────────────────────────────

/** El sha del tag, a pelo y sin adornos: lo consume un `$(…)` del YAML.
 *
 *  Existe para que la corrida pueda GUARDAR su ancla en el manifiesto. El paso
 *  de selección de CI ya sabía desde dónde estaba midiendo —es el mismo tag que
 *  usa `pendiente --ids`— y lo tiraba; luego el paso final movía el tag, y
 *  `repartir` llegaba a leer un ancla que ya no era la de esta corrida. Este
 *  verbo no es un dato nuevo: es el que ya existía, escrito en vez de olvidado. */
function ancla(): void {
  console.log(shaDelTag());
}

// ── verbo: manifiesto (lo escribe CI) ────────────────────────────────────────

function manifiesto(argv: readonly string[]): void {
  const valor = (flag: string): string => {
    const i = argv.indexOf(flag);
    if (i < 0 || !argv[i + 1]) throw new Error(`manifiesto necesita ${flag}`);
    return argv[i + 1];
  };
  /** `--pedidos` es el ÚNICO flag que admite el vacío, y significa «todos los
   *  módulos del plan».
   *
   *  Lo manda así el propio workflow con el input TODOS (`echo "ids="`), y el
   *  `valor()` de arriba lo rechazaba —`!""` es `true`—, así que el paso del
   *  manifiesto moría con «manifiesto necesita --pedidos» DESPUÉS de haber
   *  medido: la corrida completa gastaba sus ~131 minutos de runner y subía sus
   *  33 informes sin `corrida.json`, o sea imposibles de repartir y sin mover el
   *  tag. La rama `pedidos.length > 0 ? … : leerPlan()` de abajo estaba escrita
   *  para este caso y no se podía alcanzar. No lo vio nadie porque el camino de
   *  diario es el del rango, que sí manda ids. */
  const listaPedida = (): string[] => {
    const i = argv.indexOf("--pedidos");
    if (i < 0 || argv[i + 1] === undefined) throw new Error("manifiesto necesita --pedidos");
    return argv[i + 1].split(/\s+/).filter(Boolean).sort();
  };
  const origen = origenValido(valor("--origen"));
  const pedidos = listaPedida();
  // El cronómetro que dejó `mutate.ts` en este mismo job. Si no está —una
  // corrida que ni llegó a medir— los informes viajan sin `segundos`, y esa
  // ausencia acaba mandando el módulo a un lote propio, que es la dirección
  // segura.
  const tiempos = existsSync(RUTA_TIEMPOS)
    ? (JSON.parse(readFileSync(RUTA_TIEMPOS, "utf8")) as Record<string, number>)
    : {};
  const corrida: Corrida = {
    sha: valor("--sha"),
    // Obligatorio: sin ancla el manifiesto no sirve para repartir, y un
    // manifiesto que se escribe igual sin ella deja el fallo para el día del
    // reparto, cuando el runner ya no está.
    desde: valor("--desde"),
    run_id: valor("--run"),
    origen,
    modulos_pedidos: pedidos.length > 0 ? pedidos : leerPlan().modulos.map((m) => m.id),
    informes: informesEnDisco().map((i) => ({
      ...i,
      ...(typeof tiempos[i.modulo] === "number" ? { segundos: tiempos[i.modulo] } : {}),
    })),
    fecha: new Date().toISOString(),
  };
  mkdirSync(DIR_INFORMES, { recursive: true });
  writeFileSync(RUTA_CORRIDA, `${JSON.stringify(corrida, null, 2)}\n`);
  const veredicto = veredictoDeCorrida(corrida);
  console.log(`${veredicto.completa ? "COMPLETA" : "INCOMPLETA"} — ${veredicto.porque}`);
  console.log(`  ancla:    ${corrida.desde}`);
  console.log(`  pedidos:  ${corrida.modulos_pedidos.join(" ")}`);
  console.log(
    `  informes: ${corrida.informes
      .map((i) => `${i.modulo}:${i.sha256.slice(0, 8)}${i.segundos === undefined ? "" : `:${i.segundos}s`}`)
      .join(" ")}`,
  );
  const salida = process.env.GITHUB_OUTPUT;
  if (salida) {
    writeFileSync(salida, `completa=${veredicto.completa}\nmueve_tag=${veredicto.mueveTag}\n`, { flag: "a" });
  }
}

// ── entrada ──────────────────────────────────────────────────────────────────

const VERBOS: Record<string, (argv: string[]) => void> = {
  pendiente,
  traer,
  repartir,
  local,
  lotes,
  fusionar,
  cola,
  ancla,
  manifiesto,
};

function main(): void {
  const [verbo, ...resto] = process.argv.slice(2);
  const fn = verbo ? VERBOS[verbo] : undefined;
  if (!fn) {
    console.error(
      `uso: npm run mutacion -- <${Object.keys(VERBOS).join(" | ")}>\n` +
        `  pendiente [--ids]   qué hay sin medir desde ${TAG}, y cuánto cuesta\n` +
        `  traer [run-id]      vacía reports/mutation/ y baja el artefacto de CI\n` +
        `  repartir [--comentar]  delta contra la corrida anterior y atribución\n` +
        `  local <id>          mide UN módulo barato en esta máquina\n` +
        `  lotes [--ids …]     parte la corrida en jobs por los SEGUNDOS medidos\n` +
        `  fusionar --entrada  junta los lotes en un solo corrida.json (lo corre CI)\n` +
        `  cola <run-id>       cuánto espera una PR mientras la matriz ocupa el pool\n` +
        `  ancla               el sha de ${TAG}, para que CI lo guarde en el manifiesto\n` +
        `  manifiesto …        lo escribe CI dentro del artefacto\n`,
    );
    process.exitCode = 2;
    return;
  }
  fn(resto);
}

// Importado (candado) no ejecuta nada; solo al invocarlo como comando.
if (process.argv[1]?.endsWith("mutacion.ts")) main();
