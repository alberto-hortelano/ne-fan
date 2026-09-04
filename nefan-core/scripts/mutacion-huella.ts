/** La huella de una corrida de mutación: qué supervivientes había, cuáles son
 *  nuevos y de quién son. Todo lo que decide algo, sin tocar git ni el disco.
 *
 *  POR QUÉ ESTE FICHERO EXISTE APARTE de `scripts/mutacion.ts`. El delta y la
 *  atribución son las dos cosas que pueden equivocarse EN VERDE: si el delta
 *  colapsa "no había medida" con "no ha cambiado nada", la cola se queda muda; y
 *  si la atribución inventa un dueño, el hallazgo va a parar a quien no lo trajo
 *  y nadie lo arregla. Un test que las ejercitara a través de git correría en CI
 *  sobre un clon superficial y pasaría en verde sin comprobar nada — es
 *  exactamente lo que `deuda.ts:159` ya documenta de `enColaDeCrap`. Así que
 *  aquí no entra `node:child_process`, ni git, ni una lectura de fichero: se
 *  ejerce con datos sintéticos en cualquier máquina.
 *
 *  LA HUELLA ES UNA TUPLA DE SIETE COMPONENTES, y no es una elección estética.
 *  Medido sobre los 19 informes que había en disco el 2026-08-25 (9.040
 *  mutantes, 3.524 supervivientes): con `(fichero, línea, mutador)` hay **1.155
 *  supervivientes indistinguibles entre sí** (el 33 %), porque Stryker genera
 *  varios mutantes en la misma línea y el mismo mutador cambiando solo el
 *  `replacement` o las columnas. Con fichero + línea/columna de inicio y de fin
 *  + mutador + `replacement`, las colisiones son **0**. Sin las siete, un
 *  superviviente nuevo se descontaría contra uno viejo distinto y el delta
 *  diría "no ha cambiado nada" justo cuando algo cambió.
 *
 *  La base se indexa POR FICHERO, no por id de módulo: afinar el plan mueve
 *  ficheros de un módulo a otro, y un módulo renombrado perdería su base sin que
 *  nada lo dijera — otra vez el verde que no comprueba nada.
 */
import { esVivo } from "./mutation-plan.js";

// ── la tupla y su hash ───────────────────────────────────────────────────────

/** Lo que este módulo necesita de un mutante del informe de Stryker. */
export interface MutanteMedido {
  mutatorName: string;
  replacement?: string;
  status: string;
  location: { start: { line: number; column: number }; end: { line: number; column: number } };
}

/** El separador de la clave. Escapado y no literal: un NUL crudo dentro del
 *  fuente hace que `grep` trate el fichero como binario y deje de encontrar sus
 *  propias funciones.
 *
 *  Que sea NUL y no un espacio importa: el `replacement` es CODIGO FUENTE y
 *  puede llevar espacios y saltos de linea, asi que con un separador que pueda
 *  aparecer dentro de un campo dos tuplas distintas podrian dar la misma clave
 *  — justo lo que esta clave existe para impedir. */
const SEPARADOR = "\u0000";

/** Las SIETE componentes, en texto y separadas por algo que no puede aparecer
 *  dentro de ninguna de ellas. Separada del hash para que el candado pueda comprobar qué
 *  entra en la identidad sin depender de la función de hash. */
export function claveDeMutante(fichero: string, m: MutanteMedido): string {
  const { start, end } = m.location;
  return [
    fichero,
    start.line,
    start.column,
    end.line,
    end.column,
    m.mutatorName,
    m.replacement ?? "",
  ].join(SEPARADOR);
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a de 64 bits, en hexadecimal de 16 caracteres.
 *
 *  Escrito a mano en vez de tirar de `node:crypto` para que este fichero no
 *  importe nada del entorno: es lo que lo deja ejercitable con datos sintéticos
 *  desde cualquier test. 64 bits sobran para el tamaño del problema — con 3.524
 *  supervivientes la probabilidad de colisión ronda 3·10⁻¹³—, y el candado
 *  además la comprueba contra los informes reales en vez de fiarse del cálculo.
 *
 *  Se guarda el hash y no la tupla porque la tupla lleva el `replacement`, que
 *  es CÓDIGO FUENTE: meterlo en un fichero de `data/` haría que el guardia de
 *  campos retirados (`campos-retirados-no-vuelven`) tuviera que perseguir texto
 *  que nadie escribió a mano. Y son ~200 KB contra ~75 KB. */
export function hash64(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

export function huellaDeMutante(fichero: string, m: MutanteMedido): string {
  return hash64(claveDeMutante(fichero, m));
}

/** Los supervivientes de un fichero, con su huella, y cuántos mutantes se
 *  midieron en total. VIVO es lo mismo que para `npm run deuda` y para el
 *  `break` del runner (`esVivo`, en mutation-plan.ts): una segunda definición de
 *  "vivo" acabaría discrepando con la primera sobre el mismo informe. */
export function vivosDeFichero(
  fichero: string,
  mutantes: readonly MutanteMedido[],
): { vivos: string[]; total: number } {
  const vivos: string[] = [];
  let detectados = 0;
  for (const m of mutantes) {
    if (esVivo(m.status)) vivos.push(huellaDeMutante(fichero, m));
    else if (m.status === "Killed" || m.status === "Timeout") detectados += 1;
  }
  return { vivos: [...vivos].sort(), total: vivos.length + detectados };
}

// ── el fichero de huella ─────────────────────────────────────────────────────

/** La medida de UN fichero fuente en la última corrida que lo tocó. */
export interface MedidaDeFichero {
  /** El commit medido, la corrida de CI de la que salió y cuándo. Sustituye al
   *  `mtime`, que con corridas diferidas pasa a ser la fecha de la DESCARGA:
   *  `deuda.ts:102-106` ya avisaba de que un merge o un checkout tocan mtimes
   *  sin cambiar el contenido. */
  sha: string;
  run: string;
  fecha: string;
  /** Mutantes con veredicto (vivos + detectados). Es el coste real del módulo,
   *  y lo que deja a `pendiente` y al tope de `local` decir un número sin abrir
   *  los 76 MB de informes. */
  total: number;
  /** Hash del CONTENIDO del fuente medido, en el commit de la corrida.
   *
   *  Lo que hace comparable a una medida con la siguiente. Sin él, el delta
   *  contesta la pregunta equivocada: la huella de un mutante lleva línea y
   *  columna dentro, así que cualquier desplazamiento del fichero convierte a
   *  TODOS sus supervivientes en «nuevos» y a los de antes en «resueltos» —
   *  ruido que se reparte como deuda de alguien.
   *
   *  Ocurrió: la corrida 32970154557 marcó 239 supervivientes NUEVOS en cuatro
   *  ficheros que nadie había tocado en el rango, porque la base se midió en
   *  local a las 10:00 y el tag se plantó a las 15:08 con `bcc8b08` (#263) ya
   *  dentro. La base no era la foto de un commit: era un collage de esa mañana. */
  blob: string;
  /** Huellas de los supervivientes, ordenadas para que el diff sea legible. */
  vivos: string[];
  /** Los que NO estaban en la medida anterior de este fichero. Vacío con
   *  `sin base`: sin medida previa no hay "nuevo" que valga. */
  nuevos: string[];
  /** Cuántos supervivientes de la medida anterior ya no están. Se cuenta y se
   *  enseña: un superviviente nuevo que cae donde estaba uno viejo dejaría el
   *  total igual, y ese silencio es el fallo caro. */
  resueltos: number;
  /** Cómo se comparó esta medida con la anterior. Viaja en la huella —y no se
   *  recalcula al leerla— porque quien lee la cola (`deuda`) no tiene el
   *  contenido del commit medido a mano: sin esto decía "ya estaban" de unos
   *  supervivientes que nadie había podido comparar. */
  base: "con base" | "sin base" | "incomparable";
  /** Quién pudo traerlos, con los tres estados que NO se colapsan. Ver
   *  `DuenosDeLaMedida`: era `string[]`, y la lista vacía decía a la vez «se
   *  miró el rango y nadie tocó este módulo» y «no había rango que mirar». */
  duenos: DuenosDeLaMedida;
}

/** De quién es lo que una medida encontró — el veredicto de `atribuir`, tal y
 *  como se GUARDA.
 *
 *  Era `string[]` y la lista vacía significaba dos cosas incompatibles. El
 *  cuarto veredicto («rango vacío») nacía en `atribuir`, se leía bien en la
 *  consola de quien reparte… y se perdía al escribir la huella, así que
 *  `npm run deuda` escribía «N NUEVOS · sin dueño en el rango» sobre un módulo
 *  al que NADIE había buscado dueño. Es el bug de #381 un piso más abajo: una
 *  no-medida con cara de resultado, que es la forma exacta del fallo que esta
 *  casa ya declaró inexpresable para los tres estados del delta («SIN BASE no es
 *  ni nuevo ni ya estaba»).
 *
 *  La rama con dueños lleva una TUPLA NO VACÍA, igual que `RangoDeCommits`: así
 *  «con dueño y ninguno» no compila, y los dos estados sin dueño son
 *  constructores distintos que ningún `if` puede confundir. Y no hace falta
 *  distinguir «uno» de «varios», porque eso lo dice la propia lista. */
export type DuenosDeLaMedida =
  | { veredicto: "con dueño"; quienes: readonly [string, ...string[]] }
  | { veredicto: "sin dueño" }
  | { veredicto: "rango vacío" };

/** Lo que se guarda, DERIVADO de la atribución y no recalculado aparte.
 *
 *  `repartir` construía los nombres a mano (`c.pr === undefined ? sha : "#pr"`,
 *  una copia de `nombreDeCommit`) y tiraba el veredicto. Derivarlo aquí hace que
 *  la huella no pueda discrepar de lo que la consola acaba de imprimir. */
export function duenosDeLaMedida(a: Atribucion): DuenosDeLaMedida {
  if (a.veredicto === "rango vacío") return { veredicto: "rango vacío" };
  const [primero, ...resto] = a.candidatos.map(nombreDeCommit);
  if (primero === undefined) return { veredicto: "sin dueño" };
  return { veredicto: "con dueño", quienes: [primero, ...resto] };
}

/** Cómo se lee un dueño en la cola de trabajo. Vive junto al tipo para que no
 *  haya dos redacciones del mismo veredicto en dos ficheros. */
export function duenosLegibles(d: DuenosDeLaMedida): string {
  if (d.veredicto === "con dueño") return d.quienes.join(" o ");
  if (d.veredicto === "sin dueño") return "sin dueño en el rango";
  return "sin rango que mirar: nadie buscó dueño";
}

export interface Huella {
  _comment?: string;
  /** Ruta del fuente (relativa a nefan-core) → su última medida. */
  ficheros: Record<string, MedidaDeFichero>;
}

export const HUELLA_VACIA: Huella = { ficheros: {} };

// ── el delta, con TRES estados ───────────────────────────────────────────────

export interface DeltaDeFichero {
  fichero: string;
  /** `sin base` no es "todo nuevo" ni "todo viejo": es que no hay contra qué
   *  comparar. Meter un módulo estrenado en "nuevo" inundaría al agente con
   *  cientos de hallazgos y garantizaría que deje de leerlos; meterlo en "ya
   *  estaba", silencio.
   *
   *  `incomparable` es la tercera forma de no saber, y es DISTINTA de las otras
   *  dos: aquí SÍ hay medida anterior, pero es de otro código (o de otro
   *  instrumento), así que sus huellas no hablan de estos mutantes. Colapsarla
   *  con "con base" es lo que produjo 239 atribuciones falsas en la primera
   *  corrida real del sistema. */
  base: "con base" | "sin base" | "incomparable";
  /** Por qué no se puede comparar. Solo con `incomparable`. */
  porque?: string;
  /** TODOS los supervivientes de esta corrida — el hecho crudo, que existe se
   *  pueda clasificar o no. `nuevos`/`yaEstaban` son la CLASIFICACIÓN, y se
   *  quedan vacías cuando no hay contra qué comparar: sin este campo, «no sé de
   *  quién son» se leería como «no hay», y la huella guardaría cero. */
  vivos: string[];
  nuevos: string[];
  yaEstaban: string[];
  resueltos: string[];
  total: number;
}

/** El delta de un fichero contra su medida anterior.
 *
 *  Antes de restar conjuntos hay que contestar si las dos medidas hablan del
 *  MISMO código. Si no, la resta sale perfecta y significa lo contrario de lo
 *  que parece. */
export function deltaDeFichero(
  fichero: string,
  ahora: { vivos: readonly string[]; total: number; blob: string },
  base: MedidaDeFichero | undefined,
): DeltaDeFichero {
  const sinComparar = (base: "sin base" | "incomparable", porque?: string): DeltaDeFichero => ({
    fichero,
    base,
    ...(porque === undefined ? {} : { porque }),
    vivos: [...ahora.vivos],
    nuevos: [],
    yaEstaban: [],
    resueltos: [],
    total: ahora.total,
  });
  if (!base) return sinComparar("sin base");
  // Medida anterior sin blob: es de antes de que se guardara, así que no se
  // puede saber sobre qué código se hizo. Se dice, no se adivina (pre-producción:
  // la primera corrida con blob repuebla la huella entera).
  if (!base.blob) {
    return sinComparar("incomparable", "la medida anterior no guardó de qué código era");
  }
  if (base.blob !== ahora.blob) {
    return sinComparar(
      "incomparable",
      "el fichero cambió desde la medida anterior: sus huellas llevan línea y columna, " +
        "así que no hablan de estos mutantes",
    );
  }
  // Mismo contenido y distinto número de mutantes solo puede significar que
  // cambió el INSTRUMENTO (mutadores, config, versión). Comparar entonces
  // atribuiría a una PR lo que hizo un cambio de herramienta.
  if (base.total !== ahora.total) {
    return sinComparar(
      "incomparable",
      `mismo código y distinto número de mutantes (${base.total} → ${ahora.total}): ` +
        "lo que cambió es el instrumento de medida, no el código",
    );
  }
  const antes = new Set(base.vivos);
  const despues = new Set(ahora.vivos);
  return {
    fichero,
    base: "con base",
    vivos: [...ahora.vivos],
    nuevos: ahora.vivos.filter((h) => !antes.has(h)),
    yaEstaban: ahora.vivos.filter((h) => antes.has(h)),
    // Los resueltos se cuentan aparte de los nuevos A PROPÓSITO. Un
    // superviviente nuevo que cae justo donde murió uno viejo deja el TOTAL
    // idéntico; si el delta fuera una resta, esa corrida diría "sin cambios"
    // teniendo un hallazgo dentro.
    resueltos: base.vivos.filter((h) => !despues.has(h)),
    total: ahora.total,
  };
}

/** Cómo se lee un delta, en una línea. Vive aquí —y no en la plantilla de
 *  `mutacion.ts`— porque las DOS salidas (la consola de quien reparte y el
 *  comentario que va a la PR) tienen que decir lo mismo: la primera versión
 *  tenía dos ternarios gemelos, y un tercer estado añadido a uno solo se lee
 *  como «0 nuevos» en el otro. Que es exactamente la mentira que se arregla. */
export function estadoLegible(d: DeltaDeFichero, opts: { markdown?: boolean } = {}): string {
  const fuerte = (t: string): string => (opts.markdown === true ? `**${t}**` : t.toUpperCase());
  if (d.base === "sin base") {
    return `${fuerte("sin base")} de comparación (nadie lo había medido)`;
  }
  if (d.base === "incomparable") {
    return `${fuerte("base de otro código")} — ${d.porque ?? "no hay comparación posible"}`;
  }
  return `${d.nuevos.length} nuevos · ${d.yaEstaban.length} ya estaban · ${d.resueltos.length} resueltos`;
}

/** El delta de una corrida entera. Solo de los ficheros MEDIDOS: los que esta
 *  corrida no tocó no tienen delta ninguno, ni cero ni nada. */
export function deltaDeCorrida(
  medidos: Readonly<Record<string, { vivos: readonly string[]; total: number; blob: string }>>,
  base: Huella,
): DeltaDeFichero[] {
  return Object.keys(medidos)
    .sort()
    .map((f) => deltaDeFichero(f, medidos[f], base.ficheros[f]));
}

/** La huella nueva: lo medido se sustituye, lo NO medido se conserva.
 *
 *  Conservar es lo correcto y no una comodidad: un módulo que esta corrida no
 *  midió sigue teniendo la medida que tenía, con su fecha, y por eso `deuda`
 *  puede avisar de que lleva N días sin tocarse. Si se cayera del fichero, el
 *  módulo pasaría a "sin base" y su deuda desaparecería de la cola en silencio,
 *  que es la forma exacta de este fallo. */
export function fusiona(base: Huella, medidos: Readonly<Record<string, MedidaDeFichero>>): Huella {
  const ficheros: Record<string, MedidaDeFichero> = { ...base.ficheros };
  for (const [f, m] of Object.entries(medidos)) ficheros[f] = m;
  const ordenado: Record<string, MedidaDeFichero> = {};
  for (const f of Object.keys(ficheros).sort()) ordenado[f] = ficheros[f];
  return { ...base, ficheros: ordenado };
}

// ── atribución: por módulo × alcance, nunca por línea ────────────────────────

/** Un commit del rango sin medir, con los módulos que su diff SELECCIONA.
 *  Quién calcula esos módulos (git + `seleccionar`) es asunto de `mutacion.ts`;
 *  aquí llegan ya calculados para que la regla de reparto se pueda ejercer sin
 *  fabricar commits. */
export interface CommitDelRango {
  sha: string;
  asunto: string;
  /** El `(#NNN)` del asunto, si lo lleva. 11 de los últimos 40 commits de este
   *  repo NO lo llevan (van directos a main), y esos también tienen que poder
   *  ser dueños. */
  pr?: number;
  modulos: readonly string[];
}

/** El rango sin medir, con la lista vacía hecha INEXPRESABLE en la rama que
 *  tiene commits.
 *
 *  Un rango vacío y un rango en el que nadie tocó este módulo son dos hechos
 *  distintos, y la diferencia decide trabajo: «sin dueño» dice que hubo cambios
 *  y ninguno explica a este superviviente —hay que mirarlo—, mientras que «rango
 *  vacío» dice que no había dónde buscar. Colapsarlos es lo que producía la
 *  salida de #381: los 33 módulos «SIN DUEÑO en el rango» justo después de la
 *  corrida que más tenía que repartir, porque el ancla del rango era un tag que
 *  la propia corrida adelantaba.
 *
 *  La rama de commits es una TUPLA NO VACÍA a propósito. Con `readonly
 *  CommitDelRango[]` el estado malo —`tipo: "commits"` con cero commits— se
 *  podría volver a escribir y el compilador no diría nada; así no compila. */
export type RangoDeCommits =
  | { tipo: "vacío" }
  | { tipo: "commits"; commits: readonly [CommitDelRango, ...CommitDelRango[]] };

export function rangoDe(commits: readonly CommitDelRango[]): RangoDeCommits {
  const [primero, ...resto] = commits;
  if (primero === undefined) return { tipo: "vacío" };
  return { tipo: "commits", commits: [primero, ...resto] };
}

export interface Atribucion {
  modulo: string;
  candidatos: CommitDelRango[];
  veredicto: "uno" | "varios" | "sin dueño" | "rango vacío";
  /** Cómo se lee en un comentario: «#273», «#274 o #276», «sin dueño en el
   *  rango», «sin rango que mirar». */
  etiqueta: string;
}

/** De quién es un módulo: las PR del rango cuyo diff lo selecciona.
 *
 *  NO se usa `git blame`. `blame` contesta «quién escribió esta línea» y la
 *  pregunta es «qué cambio movió la suerte de este mutante», que no es la misma
 *  — y donde más se separan es justo en el hallazgo valioso: el mutante que pasa
 *  de `Killed` a `Survived` en código que nadie tocó, porque la PR debilitó un
 *  test o cambió un fixture; ahí blame apunta a un commit de hace meses. Hay dos
 *  casos más, medidos: 148 supervivientes son `BlockStatement`, cuyo
 *  `location.start.line` es la línea de la FIRMA y no del cuerpo (reescribir el
 *  cuerpo entero no te adjudica el hallazgo, y renombrar un parámetro sí); y con
 *  squash, si dos PR tocan el fichero, blame da la que se mergeó DESPUÉS, no la
 *  culpable — basta un `npm run format`.
 *
 *  Con dos candidatos se nombran LOS DOS. Un dueño equivocado es peor que dos
 *  candidatos: el equivocado se descarta en diez segundos y el hallazgo se queda
 *  sin nadie.
 *
 *  Y con CERO commits no se contesta «sin dueño»: se contesta que no había
 *  rango. Los dos veredictos mandan a sitios distintos —uno a mirar el
 *  superviviente, el otro a mirar por qué la corrida no tenía nada que medir— y
 *  el segundo no es un hallazgo de nadie. */
export function atribuir(modulo: string, rango: RangoDeCommits): Atribucion {
  if (rango.tipo === "vacío") {
    return {
      modulo,
      candidatos: [],
      veredicto: "rango vacío",
      etiqueta: "sin rango que mirar (la corrida no tenía commits sin medir)",
    };
  }
  const candidatos = rango.commits.filter((c) => c.modulos.includes(modulo));
  const nombres = candidatos.map(nombreDeCommit);
  if (candidatos.length === 0) {
    return { modulo, candidatos, veredicto: "sin dueño", etiqueta: "sin dueño en el rango" };
  }
  if (candidatos.length === 1) return { modulo, candidatos, veredicto: "uno", etiqueta: nombres[0] };
  return { modulo, candidatos, veredicto: "varios", etiqueta: nombres.join(" o ") };
}

export function nombreDeCommit(c: CommitDelRango): string {
  return c.pr === undefined ? c.sha.slice(0, 7) : `#${c.pr}`;
}

/** El `(#NNN)` de un asunto de commit, que es como los deja el squash-merge de
 *  GitHub. Se coge el ÚLTIMO: los asuntos de esta casa citan las issues que
 *  cierran antes de la PR — «… (#245 #249 #246) (#273)» es la PR 273. */
export function prDelAsunto(asunto: string): number | undefined {
  const todos = [...asunto.matchAll(/\(#(\d+)\)/g)];
  const ultimo = todos[todos.length - 1];
  return ultimo ? Number(ultimo[1]) : undefined;
}

// ── el manifiesto de la corrida ──────────────────────────────────────────────

/** De dónde salió la lista de módulos que se midió. Decide si el tag puede
 *  moverse: solo una corrida que cubra el RANGO entero puede declarar medido
 *  todo lo que hay desde el tag. */
export type OrigenCorrida = "rango" | "todos" | "explicito";

/** Lo que CI escribe en el artefacto. Lo escribe CI y no `traer` porque `traer`
 *  solo puede escribir lo que CREÍA que iba a pasar.
 *
 *  Hace falta porque el código de salida no sirve de criterio: `mutate.ts` sale
 *  con 1 si un módulo baja de su `break`, así que una medida COMPLETA que
 *  destape una regresión deja el run en rojo — y una TRUNCADA también. Filtrar
 *  por `conclusion == success` rechazaría justo las corridas que traen el
 *  hallazgo. */
/** Un informe del artefacto, SELLADO con el hash de su contenido. */
export interface InformeSellado {
  modulo: string;
  /** SHA-256 en hexadecimal del fichero tal y como lo escribió la corrida.
   *
   *  Lo calcula `mutacion.ts` con `node:crypto`, y no este fichero: aquí no
   *  entra nada del entorno (la cabecera explica por qué). El `hash64` de
   *  arriba tampoco vale para esto — existe para la identidad de un mutante, no
   *  para sellar 76 MB de informes contra una sustitución deliberada. */
  sha256: string;
}

export interface Corrida {
  sha: string;
  /** Hasta dónde estaba medido cuando ESTA corrida eligió qué medir: el ancla
   *  de su rango.
   *
   *  Viaja en el manifiesto porque el tag `mutacion-ultima` no puede servir de
   *  ancla: la propia corrida lo adelanta al terminar (`mutation.yml`), así que
   *  `repartir` lo leía YA MOVIDO y el rango `tag..corrida.sha` salía siempre
   *  vacío — los 33 módulos «sin dueño» justo después de la corrida que más
   *  tenía que repartir (#381). El dato ya existía en el paso de selección de
   *  CI; lo único que se hacía con él era tirarlo. */
  desde: string;
  run_id: string;
  origen: OrigenCorrida;
  modulos_pedidos: string[];
  /** Qué informes trae y con qué contenido exacto.
   *
   *  Sustituye a la lista de nombres, que no distinguía la medida de CI de una
   *  medida local hecha después (#420): `npm run mutacion -- local <id>` deja un
   *  fichero con el nombre EXACTO que el manifiesto espera, así que no faltaba
   *  ni sobraba nada y el guardia lo dejaba pasar. Dos núcleos, otro commit y
   *  otro momento, presentados como parte de la misma foto y luego commiteados
   *  en la huella. Con el sello, el nombre ya no basta. */
  informes: InformeSellado[];
  fecha: string;
}

/** Los ids de los módulos que dejaron informe. */
export function modulosConInforme(c: Corrida): string[] {
  return c.informes.map((i) => i.modulo);
}

export interface VeredictoCorrida {
  completa: boolean;
  mueveTag: boolean;
  porque: string;
}

export function veredictoDeCorrida(c: Corrida): VeredictoCorrida {
  const conInforme = modulosConInforme(c);
  const faltan = c.modulos_pedidos.filter((id) => !conInforme.includes(id));
  if (faltan.length > 0) {
    return {
      completa: false,
      mueveTag: false,
      porque: `la corrida pidió ${c.modulos_pedidos.length} módulos y ${faltan.length} no dejaron informe (${faltan.join(", ")})`,
    };
  }
  if (c.origen === "explicito") {
    return {
      completa: true,
      mueveTag: false,
      porque:
        "midió una lista explícita de módulos, no el rango: mover el tag declararía medido todo lo " +
        "que hay desde la corrida anterior, y no lo está",
    };
  }
  return {
    completa: true,
    mueveTag: true,
    porque: `midió ${c.origen === "todos" ? "todos los módulos del plan" : "todo lo que el rango seleccionaba"} y todos dejaron informe`,
  };
}

/** Lo que hay en `reports/mutation/` después de bajar el artefacto, contra lo
 *  que el manifiesto dice que TRAE — `informes`, no `modulos_pedidos`.
 *
 *  La diferencia entre esas dos listas no es un fallo de descarga: es una
 *  corrida a la que se le cayó un módulo, y de eso ya dictamina
 *  `veredictoDeCorrida` (INCOMPLETA, no mueve el tag). Compararlas aquí
 *  confundía los dos hechos y cerraba el ritual entero: el 2026-09-03,
 *  `contrato-escena` murió en su dry-run y las medidas de los otros 32 módulos
 *  —10.128 mutantes, 131 minutos de runner— quedaron IMPOSIBLES de repartir,
 *  con un consejo que nadie podía cumplir («vuelve a bajarla entera»: el
 *  informe no estaba truncado en el camino, no existía en origen).
 *
 *  TRES lados, y el tercero es el que el nombre no podía ver. Que FALTE un
 *  informe declarado es una descarga truncada, y ahí sí repagar bajarla otra
 *  vez. Que SOBRE uno es peor y más silencioso: un informe de la semana pasada
 *  que se quedó en el directorio se mezcla con los recién bajados y
 *  `npm run deuda` presenta las dos medidas como si fueran la misma foto. Y que
 *  un informe traiga el nombre correcto y OTRO CONTENIDO no lo veía nadie
 *  (#420): `npm run mutacion -- local <id>` escribe justo en
 *  `reports/mutation/<id>.json`, así que ni faltaba ni sobraba — pasaba el
 *  guardia, entraba en el reparto y de ahí a la huella COMMITEADA, con la fecha,
 *  el sha y el run de CI encima de una medida que no era la de CI. El sello lo
 *  hace comprobable, y de paso caza el informe truncado al bajarlo o editado a
 *  mano. */
export function verificaDescarga(c: Corrida, presentes: readonly InformeSellado[]): string[] {
  const errores: string[] = [];
  const selloPresente = new Map(presentes.map((i) => [i.modulo, i.sha256]));
  const declarados = new Set(modulosConInforme(c));
  const faltan = c.informes.filter((i) => !selloPresente.has(i.modulo)).map((i) => i.modulo);
  if (faltan.length > 0) {
    errores.push(
      `el manifiesto declara ${faltan.length} informe(s) que no vienen en el artefacto: ${faltan.join(", ")}`,
    );
  }
  const sobran = presentes.filter((i) => !declarados.has(i.modulo)).map((i) => i.modulo);
  if (sobran.length > 0) {
    errores.push(
      `hay ${sobran.length} informe(s) que esta corrida no generó: ${sobran.join(", ")} — ` +
        `son de una medida anterior y mezclarlos daría una foto que nunca existió`,
    );
  }
  const suplantados = c.informes
    .filter((i) => {
      const sello = selloPresente.get(i.modulo);
      return sello !== undefined && sello !== i.sha256;
    })
    .map((i) => i.modulo);
  if (suplantados.length > 0) {
    errores.push(
      `${suplantados.length} informe(s) NO son los que midió la corrida ${c.run_id}: ` +
        `${suplantados.join(", ")} — el nombre casa y el contenido no. Es lo que deja un ` +
        `\`npm run mutacion -- local\` corrido encima de la descarga: dos núcleos, otro código y otro ` +
        `momento, a punto de commitearse en la huella con el sha y el run de CI encima`,
    );
  }
  return errores;
}

// ── el tope de la medida local ───────────────────────────────────────────────

export type PermisoLocal = { ok: true; coste: number } | { ok: false; porque: string };

/** Si esto se puede medir en la máquina de quien está programando. `que` es lo
 *  que se va a medir: un id de módulo, o la corrida entera.
 *
 *  LO GUARDA `mutate.ts`, NO SOLO EL VERBO `local`, y esa diferencia se pagó el
 *  2026-08-25 en la máquina del usuario: un backtick sin escapar dentro de un
 *  `echo` —`echo "(sin `npm run mutate` en …)"`, que en bash es SUSTITUCIÓN DE
 *  COMANDOS— lanzó `npm run mutate` sin argumentos. Los 20 módulos, concurrencia
 *  8, load average 14. El tope existía y no sirvió de nada, porque vivía en un
 *  verbo que aquel accidente no pasó por encima: lo esquivó por debajo. Un tope
 *  que solo protege el camino que alguien recuerda usar no es un tope.
 *
 *  El coste está MUY mal repartido y por eso el número no es política sino
 *  aritmética: `blueprint-plan` son 41 mutantes y `plugins-dsl` 1.362.
 *  Prohibirlo todo curaba con una regla un bug que ya está arreglado —la
 *  saturación del 2026-08-23 fue `concurrency: 10` × 15 procesos de
 *  `node --test`— y dejaba a CLAUDE.md pidiéndole al ingeniero «los
 *  supervivientes del módulo que tocó, muertos» sin darle con qué mirarlo.
 *
 *  Sin coste conocido NO se autoriza. Un módulo estrenado podría ser
 *  `plugins-dsl`, y "no lo sé, adelante" es justo el error hacia arriba que este
 *  tope existe para hacer imposible: se mide una vez en CI y a partir de ahí su
 *  coste está en la huella.
 */
export function permisoLocal(
  que: string,
  coste: number | undefined,
  tope: number,
  enCI = false,
): PermisoLocal {
  // En el runner no hay nadie delante y la corrida completa es justo lo que se
  // le pide: el tope es una propiedad de la MÁQUINA, no del repositorio.
  if (enCI) return { ok: true, coste: coste ?? 0 };
  if (coste === undefined) {
    return {
      ok: false,
      porque:
        `no hay medida previa de ${que}, así que no se sabe cuánto cuesta y podría ser de los caros. ` +
        `Pídelo: npm run mutacion -- pendiente`,
    };
  }
  if (coste > tope) {
    return {
      ok: false,
      porque:
        `${que} son ${coste} mutantes y el tope local es ${tope}: aquí hay alguien trabajando. ` +
        `Pídelo (npm run mutacion -- pendiente) y sigue sin esperarlo — una medida pendiente no bloquea nada`,
    };
  }
  return { ok: true, coste };
}

// ── lo que `npm run deuda` dice de cada fichero ──────────────────────────────

/** La coletilla de un item de la cola: de dónde salió esta medida y qué hay de
 *  nuevo en ella. Los TRES estados, otra vez, porque es donde se leen. */
export function anotacionDeFichero(
  vivosAhora: readonly string[],
  base: MedidaDeFichero | undefined,
  blobAhora?: string,
): string {
  if (!base) return "sin base de comparación — nadie lo había medido antes";
  // El mismo candado que en el delta, en la cola de trabajo: sin él, `deuda`
  // enseña como NUEVOS de una PR los supervivientes de un fichero que esa PR
  // no tocó. Sin blob a mano (el llamador no lo tiene) no se afirma nada.
  if (blobAhora !== undefined && base.blob !== blobAhora) {
    return "base de otro código — el fichero cambió desde la última medida, no hay comparación";
  }
  const nuevos = new Set(base.nuevos);
  const conocidos = new Set(base.vivos);
  const sigueNuevo = vivosAhora.filter((h) => nuevos.has(h)).length;
  const desconocidos = vivosAhora.filter((h) => !conocidos.has(h)).length;
  const partes: string[] = [];
  if (base.base === "sin base") partes.push("sin base de comparación — primera medida");
  else if (base.base === "incomparable") {
    partes.push("base de otro código — no hubo comparación posible en la última corrida");
  } else if (sigueNuevo > 0) {
    // El veredicto se LEE, no se deduce de si la lista está vacía: «nadie del
    // rango tocó esto» y «no había rango» mandan a sitios distintos, y el
    // segundo no es un hallazgo de nadie.
    partes.push(`${sigueNuevo} NUEVOS · ${duenosLegibles(base.duenos)}`);
  } else partes.push("ya estaban");
  if (base.resueltos > 0) partes.push(`${base.resueltos} resueltos`);
  // Un superviviente que no está NI en los vivos NI en los nuevos de la última
  // medida solo puede venir de una corrida local posterior. Decirlo evita leer
  // la atribución de la huella como si cubriera también a estos.
  if (desconocidos > 0) partes.push(`${desconocidos} sin atribuir (medidos después en local)`);
  return partes.join(" · ");
}

/** Qué hacer con un módulo que la cola señala. Sustituye a los cinco sitios que
 *  mandaban `npm run mutate`, que es justo lo que la política de esta casa
 *  prohíbe correr en la máquina de quien programa. */
export function queHacerCon(id: string, coste: number | undefined, tope: number): string {
  const permiso = permisoLocal(id, coste, tope);
  return permiso.ok
    ? `npm run mutacion -- local ${id}  (${permiso.coste} mutantes)`
    : `npm run mutacion -- pendiente  (${coste === undefined ? "sin medida previa" : `${coste} mutantes, tope local ${tope}`})`;
}

// ── frescura y antigüedad, sin `mtime` ───────────────────────────────────────

/** Los módulos cuya medida puede estar describiendo código que ya no existe.
 *
 *  La lista la calcula `seleccionar()` en `deuda.ts` —«el diff desde el tag
 *  selecciona este módulo»—, que es la misma función que decide qué correr y ya
 *  sabe si un cambio puede alterar la suerte de un mutante. Es estrictamente
 *  mejor que el `mtime`, que el propio código admitía que miente («un merge o un
 *  checkout tocan mtimes sin cambiar el contenido») y que con corridas diferidas
 *  pasa a ser la fecha de la descarga. */
export function avisoDeFrescura(desactualizados: readonly string[]): string | undefined {
  if (desactualizados.length === 0) return undefined;
  const muestra = desactualizados.slice(0, 3).join(", ");
  const resto = desactualizados.length > 3 ? ` y ${desactualizados.length - 3} más` : "";
  return (
    `posiblemente obsoleta en ${desactualizados.length} módulo(s) — el diff desde mutacion-ultima los ` +
    `selecciona: ${muestra}${resto}`
  );
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** El aviso que sustituye al cron. Sin nocturna, la única forma de que un módulo
 *  se quede años sin medir es que nadie lo mire; esto lo mira.
 *
 *  El punto ciego que el YAML documentaba —el selector no ve lo que un test lee
 *  en runtime— se estrecha mucho con el rango desde el tag (coge TODO lo
 *  mergeado, no solo lo que alguien pidió), pero no se cierra del todo, y este
 *  aviso es lo que impide que esa ceguera sea silenciosa. */
export function avisoDeAntiguedad(
  medidas: readonly { id: string; fecha?: string }[],
  ahoraMs: number,
  dias: number,
): string | undefined {
  const viejos: { id: string; dias: number }[] = [];
  const nunca: string[] = [];
  for (const m of medidas) {
    if (m.fecha === undefined) {
      nunca.push(m.id);
      continue;
    }
    const t = Date.parse(m.fecha);
    if (Number.isNaN(t)) {
      nunca.push(m.id);
      continue;
    }
    const d = Math.floor((ahoraMs - t) / DIA_MS);
    if (d > dias) viejos.push({ id: m.id, dias: d });
  }
  if (viejos.length === 0 && nunca.length === 0) return undefined;
  const partes: string[] = [];
  if (nunca.length > 0) partes.push(`${nunca.join(", ")} sin medir NUNCA`);
  viejos.sort((a, b) => b.dias - a.dias);
  const [peor, ...resto] = viejos;
  if (peor) {
    partes.push(
      `${peor.id} lleva ${peor.dias} días sin medida` +
        (resto.length > 0 ? ` · ${resto.length} módulo(s) más de ${dias} días` : ""),
    );
  }
  return `${partes.join(" · ")} — pídelo: npm run mutacion -- pendiente`;
}

// ── el muro de `npm run mutate` ──────────────────────────────────────────────

export type Muro = { ok: true } | { ok: false; mensaje: string };

/** Si esta máquina puede correr `npm run mutate` en absoluto.
 *
 *  Es la decisión más nueva de esta tanda y era la única sin candado, en un
 *  trabajo cuya tesis es justamente que un candado sin candado no vale. Vive
 *  aquí —pura, sobre el VALOR de la variable y no sobre `process.env`— para que
 *  un test la ejerza sin arrancar nada: `scripts/mutate.ts` llama a `main()` al
 *  cargarse, así que un test que lo importara lanzaría una corrida.
 *
 *  La comparación es contra `"si"` EXACTO y no contra "hay algo": un
 *  `NEFAN_MUTATE_AUTORIZADO=0` heredado del entorno abriría el muro de par en
 *  par, y ese es precisamente el modo de fallo silencioso que se quiere evitar. */
export function muroDeMutacion(autorizado: string | undefined): Muro {
  if (autorizado === "si") return { ok: true };
  return {
    ok: false,
    mensaje: [
      "",
      "  `npm run mutate` no se corre aquí. NO BUSQUES CÓMO SALTÁRTELO.",
      "",
      "  La mutación se PIDE. Es de minutos, satura la máquina de quien está",
      "  delante, y una corrida que nadie ha autorizado no tiene dueño cuando",
      "  aparece un superviviente: eso es el trabajo que luego no hace nadie.",
      "",
      "  Lo que SÍ es tuyo:",
      "",
      "    npm run mutacion -- pendiente     qué falta por medir, y cuánto cuesta",
      "    npm run mutacion -- local <id>    UN módulo, si cabe en el tope",
      "",
      "  Si tu módulo no cabe en el tope, PÍDELA: dilo en tu informe y SIGUE",
      "  TRABAJANDO. No la esperes — una petición pendiente no bloquea ningún",
      "  merge, y el resultado vuelve solo al sitio donde se causó.",
      "",
      "  Más barato y más concluyente que medir: prueba en negativo el candado",
      "  que añadas. Rómpelo a propósito, míralo rojo, revierte y cuéntalo.",
      "",
    ].join("\n"),
  };
}

// ── idempotencia de `repartir` ───────────────────────────────────────────────

export type EstadoDeReparto =
  | { tipo: "pendiente" }
  | { tipo: "ya repartida" }
  | { tipo: "a medio repartir"; repartidos: number; total: number };

/** ¿Está esta corrida ya repartida en esa huella?
 *
 *  Vive aquí, y no dentro de `mutacion.ts`, porque este verbo YA HA PERDIDO
 *  DATOS DOS VECES y las dos se arreglaron con un guardia que nadie ejercía:
 *
 *    1. Correr `repartir` dos veces antes de commitear calculaba el delta
 *       contra la huella que la primera pasada acababa de escribir, y publicaba
 *       un comentario que decía «ya estaban» de dos supervivientes NUEVOS.
 *    2. Ya commiteada la huella, una tercera pasada la reescribía dejando
 *       `nuevos` y `duenos` vacíos, y `npm run deuda` dejaba de decir de quién
 *       era cada superviviente sin avisar de que lo había perdido.
 *
 *  Un bug que aparece dos veces en el mismo verbo merece un candado, no un
 *  parche. La regla es de dos structs planos: no hace falta git para ejercerla,
 *  y el motivo que se escribió para no probarla («sería un test que en CI no
 *  comprueba nada») no se sostenía.
 *
 *  El estado intermedio NO se colapsa con ninguno de los otros dos: media
 *  huella con esta corrida y media sin ella es una huella incoherente, y seguir
 *  adelante la consolidaría. */
export function estadoDeReparto(
  runId: string,
  ficheros: readonly string[],
  huella: Huella,
): EstadoDeReparto {
  const repartidos = ficheros.filter((f) => huella.ficheros[f]?.run === runId).length;
  if (repartidos === 0) return { tipo: "pendiente" };
  if (repartidos === ficheros.length) return { tipo: "ya repartida" };
  return { tipo: "a medio repartir", repartidos, total: ficheros.length };
}

/** La marca invisible que `repartir` mete en cada comentario para reconocer los
 *  suyos. Un `<!-- … -->` no se ve al leer la PR y no depende de la prosa. */
export function marcaDeCorrida(runId: string): string {
  return `<!-- nefan-mutacion:run=${runId} -->`;
}

/** ¿Ya hay un comentario de esta corrida en esa PR?
 *
 *  Cierra la ventana que produjo los dos comentarios contradictorios de #273: el
 *  guardia de la huella solo está armado cuando la huella está COMMITEADA, y
 *  entre `repartir --comentar` y el `git commit` cabe otro `repartir --comentar`.
 *  Aquí la idempotencia se comprueba donde ocurre el efecto —en la PR— y no en
 *  un estado local que aún no se ha guardado.
 *
 *  Se acepta también la cabecera en prosa (`corrida [<id>]`) para reconocer los
 *  comentarios publicados antes de que existiera la marca. */
export function yaComentada(cuerpos: readonly string[], runId: string): boolean {
  const marca = marcaDeCorrida(runId);
  return cuerpos.some((c) => c.includes(marca) || c.includes(`corrida [${runId}]`));
}
