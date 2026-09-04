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
 *    npm run mutacion -- manifiesto …       # lo escribe CI, no una persona
 *
 *  Lo que decide algo —la huella, el delta, la atribución, el tope— vive en
 *  `scripts/mutacion-huella.ts`, sin git ni disco dentro, para que el candado
 *  pueda ejercerlo con datos sintéticos. Un test que llamara a git de verdad
 *  correría en CI sobre un clon superficial y pasaría en verde sin comprobar
 *  nada, que es lo que `deuda.ts:159` ya documenta de `enColaDeCrap`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
  estadoLegible,
  estadoDeReparto,
  marcaDeCorrida,
  yaComentada,
  fusiona,
  HUELLA_VACIA,
  huellaDeMutante,
  permisoLocal,
  prDelAsunto,
  veredictoDeCorrida,
  verificaDescarga,
  vivosDeFichero,
  type Corrida,
  type CommitDelRango,
  type DeltaDeFichero,
  type Huella,
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

// ── informes ─────────────────────────────────────────────────────────────────

interface InformeCrudo {
  files: Record<string, { mutants: MutanteMedido[] }>;
}

function leerInforme(id: string): InformeCrudo {
  return JSON.parse(readFileSync(rutaInforme(id), "utf8")) as InformeCrudo;
}

/** Los ids de módulo cuyo informe está en `reports/mutation/`. `corrida.json`
 *  vive en el mismo directorio (tiene que viajar en el artefacto) y NO es un
 *  informe: contarlo lo convertiría en un módulo fantasma. */
function informesPresentes(): string[] {
  if (!existsSync(DIR_INFORMES)) return [];
  return readdirSync(DIR_INFORMES)
    .filter((f) => f.endsWith(".json") && f !== "corrida.json")
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

function leerCorrida(): Corrida {
  if (!existsSync(RUTA_CORRIDA)) {
    throw new Error(
      `no hay ${relative(coreRoot, RUTA_CORRIDA)}: el manifiesto lo escribe CI DENTRO del artefacto. ` +
        `O no has bajado ninguna corrida todavía, o la que has bajado es anterior a que CI lo escribiera ` +
        `— y sin manifiesto no hay forma de saber qué módulos se pidieron ni si la medida quedó completa. ` +
        `Baja una posterior: npm run mutacion -- traer`,
    );
  }
  return JSON.parse(readFileSync(RUTA_CORRIDA, "utf8")) as Corrida;
}

/** El mismo guardia para `traer` (después de bajar) y para `repartir` (antes de
 *  atribuir nada). En `repartir` no es redundante: entre una cosa y otra puede
 *  haber corrido un `npm run mutacion -- local`, y mezclar esa medida con la de
 *  CI daría una foto que nunca existió. */
function exigeDescargaLimpia(corrida: Corrida): void {
  const errores = verificaDescarga(corrida, informesPresentes());
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
  console.log(
    `\nCorrida ${corrida.run_id} sobre ${corrida.sha.slice(0, 7)} (${corrida.origen}), ${corrida.fecha}\n` +
      `  ${corrida.modulos_con_informe.length} informe(s): ${corrida.modulos_con_informe.join(", ")}\n` +
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
  duenos: string[];
  etiqueta: string;
  veredicto: "uno" | "varios" | "sin dueño";
  nuevos: HallazgoNuevo[];
  bateria: readonly string[];
}

function repartir(argv: readonly string[]): void {
  const plan = leerPlan();
  const corrida = leerCorrida();
  exigeDescargaLimpia(corrida);
  const tag = shaDelTag();
  const base = huellaEnHead();
  const commits = commitsDelRango(plan, tag, corrida.sha);

  if (yaRepartida(corrida, base)) return;

  const repartos: Reparto[] = [];
  const medidos: Record<string, MedidaDeFichero> = {};

  for (const id of corrida.modulos_con_informe) {
    const modulo = moduloPorId(plan, id);
    const informe = leerInforme(id);
    const ahora: Record<string, { vivos: string[]; total: number; blob: string }> = {};
    for (const [fichero, info] of Object.entries(informe.files)) {
      ahora[fichero] = { ...vivosDeFichero(fichero, info.mutants), blob: blobEnCommit(corrida.sha, fichero) };
    }
    const deltas = deltaDeCorrida(ahora, base);
    const atribucion = atribuir(id, commits);
    const duenos = atribucion.candidatos.map((c) => (c.pr === undefined ? c.sha.slice(0, 7) : `#${c.pr}`));

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
}

/** ¿Está esta corrida ya repartida y commiteada? La REGLA vive en
 *  `mutacion-huella.ts` (`estadoDeReparto`, pura y con candado); aquí solo se
 *  leen los ficheros del informe y se actúa sobre el veredicto. */
function yaRepartida(corrida: Corrida, base: Huella): boolean {
  const ficheros = corrida.modulos_con_informe.flatMap((id) => Object.keys(leerInforme(id).files));
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
    for (const d of r.duenos) {
      if (!d.startsWith("#")) continue;
      const pr = Number(d.slice(1));
      out.set(pr, [...(out.get(pr) ?? []), r]);
    }
  }
  return out;
}

function imprimeReparto(repartos: readonly Reparto[], corrida: Corrida): void {
  console.log(`Reparto de la corrida ${corrida.run_id} (${corrida.sha.slice(0, 7)}, ${corrida.origen})\n`);
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
  const sinMedir = corrida.modulos_pedidos.filter((id) => !corrida.modulos_con_informe.includes(id));
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

// ── verbo: manifiesto (lo escribe CI) ────────────────────────────────────────

function manifiesto(argv: readonly string[]): void {
  const valor = (flag: string): string => {
    const i = argv.indexOf(flag);
    if (i < 0 || !argv[i + 1]) throw new Error(`manifiesto necesita ${flag}`);
    return argv[i + 1];
  };
  const origen = valor("--origen");
  if (origen !== "rango" && origen !== "todos" && origen !== "explicito") {
    throw new Error(`--origen inválido: "${origen}" (rango | todos | explicito)`);
  }
  const pedidos = valor("--pedidos")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  const corrida: Corrida = {
    sha: valor("--sha"),
    run_id: valor("--run"),
    origen,
    modulos_pedidos: pedidos.length > 0 ? pedidos : leerPlan().modulos.map((m) => m.id),
    modulos_con_informe: informesPresentes(),
    fecha: new Date().toISOString(),
  };
  mkdirSync(DIR_INFORMES, { recursive: true });
  writeFileSync(RUTA_CORRIDA, `${JSON.stringify(corrida, null, 2)}\n`);
  const veredicto = veredictoDeCorrida(corrida);
  console.log(`${veredicto.completa ? "COMPLETA" : "INCOMPLETA"} — ${veredicto.porque}`);
  console.log(`  pedidos:  ${corrida.modulos_pedidos.join(" ")}`);
  console.log(`  informes: ${corrida.modulos_con_informe.join(" ")}`);
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
        `  manifiesto …        lo escribe CI dentro del artefacto\n`,
    );
    process.exitCode = 2;
    return;
  }
  fn(resto);
}

// Importado (candado) no ejecuta nada; solo al invocarlo como comando.
if (process.argv[1]?.endsWith("mutacion.ts")) main();
