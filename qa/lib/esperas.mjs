/** EL LIBRO DE ESPERAS — una espera que expiró y nadie observó no puede acabar
 *  en verde (#261).
 *
 *  ── QUÉ CANDA, Y POR QUÉ NO ES UNA REGLA DE TEXTO ────────────────────────
 *  El invariante NO es «no uses `waitFor`» ni «no escribas `.catch()`»: es que
 *  un guion que NO PUDO MEDIR un bloque no termine en verde. `waitFor` lanza
 *  desde el 2026-08-20 y ningún helper de `qa/lib` se traga un timeout, así
 *  que el defecto vive entero en el SITIO DE LLAMADA — y ahí una regex no
 *  distingue el `.catch(() => null)` que tapa una medida del que absorbe una
 *  expiración legítima. Por eso el candado es de RUNTIME: aquí la expiración
 *  es un HECHO (ocurrió, con su descripción, su reloj y su sitio) y lo único
 *  que hay que decidir es si alguien la OBSERVÓ.
 *
 *  ── LA REGLA, ENTERA ─────────────────────────────────────────────────────
 *  Una espera pasa por tres estados y el libro los ve todos: **abierta**
 *  (arrancó), **cumplida** (la condición se dio: no hay nada que observar) o
 *  **expirada** (se agotó, y entonces alguien tiene que mirarla).
 *
 *  Una expiración se da por observada de tres formas:
 *
 *    · **propagó**    — la excepción llegó al runner y paró el guion.
 *    · **afirmada**   — `ctx.expectEspera(desc, debeOcurrir, …)` convirtió el
 *                       hecho «expiró / no expiró» en un ✔ o un ✘.
 *    · **absorbida**  — `ctx.absorbe(motivo, fn)` la consumió DICIENDO dónde
 *                       vive la medida de verdad.
 *
 *  **Y aquí va el borde, en vez de una universal**: esta lista NO es «las
 *  únicas tres formas que puede haber jamás». Ya se escribió esa frase dos
 *  veces —aquí mismo, que es el peor sitio posible— y las dos veces era
 *  falsa. Lo que sí se puede afirmar es lo que está MEDIDO, y es esto: la
 *  puerta por la que se colaba era la del reloj. Una espera que el guion
 *  arranca y no espera (`void ctx.waitFor(…)`, la hermana perdedora de un
 *  `Promise.all`) se posaba DESPUÉS del veredicto, con el libro ya leído, y
 *  no la contaba nadie. Lo cazó QA el 2026-09-01. Ahora, antes de leer el
 *  libro, el runner **espera a que se posen las que siguen abiertas** (tope:
 *  `DRENAJE_DE_ESPERAS_MS` en `qa/run.mjs`), y la que ni así se posa es un
 *  fallo por sí misma — nadie la esperó, así que no decidió nada.
 *
 *  Con eso quedan sujetas **las cuatro formas escribibles hoy**, verificadas
 *  una a una en `qa/esperas-candados-en-negativo.mjs`. Lo que el drenaje NO
 *  alcanza —y está medido, no supuesto— es una espera que **nace después de
 *  él**: un `setTimeout(() => { void ctx.waitFor(…) }, 7000)` sale verde,
 *  porque cuando arranca ya no queda libro que leer. Es la forma exacta que
 *  tenía el guion 27 antes de arreglarlo. El drenaje es un tope de reloj y
 *  por tanto una frontera: la misma espera suelta sale verde si se posa a los
 *  2 s y roja si tarda 8. Ningún guion la escribe hoy; si algún día hace
 *  falta cerrarla, el sitio es este y la respuesta NO es subir el tope.
 *
 *  Lo que quede sin resolver al terminar el guion es un fallo con nombre: el
 *  runner lo empuja a `ctx.fallos` y el guion sale ROJO. Si el guion DECLARÓ
 *  que no midió (`ctx.sinMedir` / `ctx.sinMedirBloque`), las pendientes se
 *  imprimen como detalle de su ⊘ — que es exit 2, PEOR que el rojo
 *  (`veredictos.mjs`), o sea que declarar tampoco es una vía de escape.
 *
 *  ── LO QUE ESTE LIBRO NO VE, DICHO AQUÍ Y NO EN UN INFORME ───────────────
 *  Solo se anotan las esperas de `ctx.waitFor` (y por tanto las de
 *  `ctx.holdUntil`, `ctx.expectEspera` y `qa/lib/sesion.mjs`, que pasan por
 *  ella). **NO** entran `page.waitForSelector` (27 usos en `qa/guiones/` el
 *  2026-09-01), ni los bucles propios de `qa/lib/saves.mjs` y
 *  `qa/lib/puertos.mjs`: un `.catch(() => null)` sobre cualquiera de ellos
 *  sigue saliendo verde. Hoy ninguno se traga —el único `catch` sobre un
 *  `waitForSelector` degrada a `false` y el `expect` de después lo mata—, pero
 *  es superficie abierta y está medida en `qa/esperas-candados-en-negativo.mjs`
 *  («hallazgo-espera-fuera-del-libro»), no solo escrita.
 *
 *  ── POR QUÉ HAY EXPIRACIONES LEGÍTIMAS (y no llevan lista) ───────────────
 *  Censo del 2026-09-01, contado a mano sobre `qa/guiones/`: **89 esperas con
 *  `.catch`** — 55 MATAN (el valor degradado a `null` pone rojo el aserto que
 *  viene detrás), 27 NO MATAN y 7 ni siquiera son esperas. De esas 27, dos
 *  familias son legítimas y un candado que las pusiera rojas nacería mal:
 *
 *    · **el timeout ES el éxito** — se espera por el FALLO (que el jugador
 *      atraviese un muro, que cruce el agua): que la condición NO se cumpla es
 *      justo lo que el guion viene a demostrar. Se escribe con
 *      `expectEspera(desc, false, …)`, y entonces la expiración no es un
 *      accidente: es el dato afirmado. Ojo — para poder afirmar un negativo
 *      hay que haber MIRADO: si la sonda de la página falló en todos los
 *      sondeos, `expectEspera` se pone rojo aunque el negativo «se cumpla»,
 *      porque «no ocurrió» y «no llegué a mirar» no son lo mismo.
 *    · **cortafuegos por tramo de un bucle que REMIDE** — caminar hacia un NPC
 *      que también se mueve se hace en tramos de 4 s; que un tramo se agote no
 *      dice nada porque el bucle vuelve a medir y la medida vive al final. Se
 *      escribe con `absorbe(motivo, …)`, y el motivo tiene que decir DÓNDE
 *      vive esa medida. Un bucle así **termina afirmando el mismo predicado**
 *      que sus tramos absorbieron (`qa/lib/combate.mjs`): si el aserto del
 *      final pidiera menos que la espera, quedaría una banda de «expiró y
 *      verde igual», que es la familia de defecto que abrió este issue.
 *
 *  La legitimidad la declara EL SITIO, no un JSON de exenciones: una lista de
 *  ficheros exentos es el sitio exacto donde un candado se muere callado, y
 *  además envejece sola. Lo que se exige es una FRASE — mismo criterio que
 *  `exentoDeMotor` y `sinMedir`: hay que escribirla, se ve en el diff y dice
 *  de qué clase de espera se trata.
 *
 *  Este módulo es PURO (ni navegador, ni red, ni `node:*`): se prueba en
 *  `nefan-core/test/esperas-de-qa.test.ts`, que sí corre en el CI — la batería
 *  de `qa/` no.
 */

/** Lo que lanza `waitFor` al agotarse. Lleva el id de su anotación en el libro
 *  para que quien la observe pueda resolverla, el último valor sondeado —que
 *  es lo que dice QUÉ estaba pasando— y el recuento del SONDEO, que es lo que
 *  permite distinguir «no ocurrió» de «no llegué a mirar». */
export class EsperaExpirada extends Error {
  constructor(mensaje, esperaId, ultimo, sondeo = { muestras: 0, rotos: 0 }) {
    super(mensaje);
    this.name = "EsperaExpirada";
    this.esperaId = esperaId;
    this.ultimo = ultimo;
    this.sondeo = sondeo;
  }
}

/** ¿La sonda llegó a evaluarse alguna vez SIN error?
 *
 *  `waitFor` enmascara los errores de la página en `{__err}` y sigue sondeando
 *  —que es lo correcto: durante un reload la sonda falla un rato y luego va—,
 *  pero eso hace que una sonda ROTA sea indistinguible de una condición que no
 *  se cumple. Para afirmar un negativo hace falta lo segundo, no lo primero. */
export function huboSondeo(sondeo) {
  if (!sondeo || typeof sondeo.muestras !== "number") return false;
  return sondeo.muestras > (sondeo.rotos ?? 0);
}

/** ¿Hay una `EsperaExpirada` en este error o en su cadena de causas?
 *
 *  La cadena importa: `esperarRegistro` (qa/lib/sesion.mjs) envuelve la
 *  expiración en un error propio que además cuenta el libro del juego. Sin
 *  seguir el `cause` se perdería el id y una expiración observada saldría como
 *  pendiente. */
export function esperaExpiradaEn(err) {
  for (let e = err, salto = 0; e && salto < 10; e = e.cause, salto++) {
    if (e instanceof EsperaExpirada) return e;
    if (e && e.name === "EsperaExpirada" && typeof e.esperaId === "number") return e;
  }
  return null;
}

/** De qué línea de qué guion salió la espera.
 *
 *  Se busca primero un marco de `qa/guiones/`, que es lo que quiere leer quien
 *  investiga; si la espera nace en un script suelto o en un helper que nadie
 *  llamó desde un guion, vale el primer marco que no sea de `qa/lib`. Los
 *  marcos SIN fichero:línea se descartan antes de elegir — `at async
 *  Promise.all (index 1)` es uno de ellos, y quedarse con él dejaba sin sitio
 *  justo el caso que más cuesta encontrar. Puro a propósito: recibe el texto
 *  del stack, no lo fabrica. */
const MARCO = /([^/\\() ]+\.(?:mjs|js|ts)):(\d+):\d+/;

export function sitioDeLlamada(stack) {
  const lineas = String(stack ?? "")
    .split("\n")
    .slice(1)
    .filter((l) => MARCO.test(l));
  const cruda =
    lineas.find((l) => l.includes("/qa/guiones/")) ?? lineas.find((l) => !l.includes("/qa/lib/")) ?? "";
  const m = cruda.match(MARCO);
  return m ? `${m[1]}:${m[2]}` : "sitio desconocido";
}

/** La criba de los MOTIVOS (`ctx.absorbe`, `ctx.sinMedirBloque`): devuelve la
 *  queja, o `null` si el motivo pasa.
 *
 *  Que sea imperfecta es el punto, y conviene decirlo aquí para que nadie la
 *  venda por más: **ninguna criba distingue una frase honesta de una
 *  elaborada**, y la red de verdad es la revisión del diff. Lo que sí impide
 *  —medido por QA el 2026-09-01, que los pasó todos por la versión anterior—
 *  es el GESTO REFLEJO: `"x"`, `"TODO"`, `"n/a"`, `"."`, `"porque sí"` y un
 *  nombre de fichero. Escribir una frase que diga dónde vive la medida cuesta
 *  más que teclear `x`, y esa asimetría es justo la que este issue vino a
 *  invertir. */
export function quejaDelMotivo(motivo) {
  if (typeof motivo !== "string") return `no es una frase (llegó ${JSON.stringify(motivo)})`;
  const t = motivo.trim();
  if (t === "") return "está vacío";
  if (/^[\w.-]+\.(mjs|js|ts|json|md)$/i.test(t)) {
    return `nombra un fichero (${t}) en vez de decir DÓNDE vive la medida`;
  }
  const palabras = t.split(/\s+/).length;
  if (t.length < 25 || palabras < 5) {
    return `es demasiado corto para decir dónde vive la medida (${t.length} caracteres, ` +
      `${palabras} palabra(s); hacen falta 25 y 5): llegó ${JSON.stringify(t)}`;
  }
  return null;
}

/** El libro de un guion: qué esperas siguen ABIERTAS, cuáles EXPIRARON y quién
 *  las observó. `resuelve` es idempotente y tolerante con un id desconocido —
 *  un observador que llega dos veces, o tarde, no puede hacer estallar la
 *  corrida que está juzgando. */
export function libroDeEsperas() {
  /** Expiradas: id → { id, desc, ms, sitio, resolucion }. */
  const anotaciones = new Map();
  /** Abiertas (arrancaron y no se han posado): id → { id, desc, ms, sitio, posada }. */
  const abiertas = new Map();
  let ultimo = 0;

  const libro = {
    /** Una espera ARRANCA. Se apunta como abierta para que el runner sepa, al
     *  cerrar el guion, que todavía hay algo en vuelo. */
    abre(desc, ms, sitio) {
      const id = ++ultimo;
      abiertas.set(id, { id, desc, ms, sitio, posada: null });
      return id;
    },

    /** Con qué SABER que esta espera se ha posado, sin sondear un reloj: la
     *  promesa de la propia espera, derivada para que no pueda rechazar (una
     *  espera que nadie espera no debe tumbar el runner con un
     *  `unhandledRejection` antes de que el libro la cuente). */
    enlaza(id, posada) {
      const e = abiertas.get(id);
      if (e) e.posada = posada.then(() => {}, () => {});
    },

    /** La condición se dio: no hay nada que observar y la espera se cierra. */
    cumple(id) {
      abiertas.delete(id);
    },

    /** Se agotó: pasa de abierta a PENDIENTE de que alguien la mire. */
    expira(id) {
      const e = abiertas.get(id);
      if (!e) return null;
      abiertas.delete(id);
      anotaciones.set(id, { id, desc: e.desc, ms: e.ms, sitio: e.sitio, resolucion: null });
      return id;
    },

    /** Abrir y expirar de un golpe, para quien ya tiene el hecho consumado. */
    anota(desc, ms, sitio) {
      return libro.expira(libro.abre(desc, ms, sitio));
    },

    /** `comoYPorQue` es la frase que se guarda: «afirmada por expectEspera»,
     *  «absorbida: …». Devuelve si esta llamada fue la que la resolvió. */
    resuelve(id, comoYPorQue) {
      const a = anotaciones.get(id);
      if (!a || a.resolucion) return false;
      a.resolucion = comoYPorQue;
      return true;
    },

    pendientes() {
      return [...anotaciones.values()].filter((a) => !a.resolucion);
    },

    /** Las que siguen en vuelo: el runner las deja posarse antes de juzgar, y
     *  la que ni así se posa es un fallo por sí misma. */
    enVuelo() {
      return [...abiertas.values()];
    },

    todas() {
      return [...anotaciones.values()];
    },
  };
  return libro;
}

/** Los fallos que el runner tiene que empujar: uno por expiración que nadie
 *  observó. El texto nombra el sitio y las TRES bocas, porque quien lo lee
 *  está viendo este candado por primera vez y tiene que poder arreglarlo sin
 *  buscar documentación. */
export function fallosDeEsperasPendientes(libro) {
  return libro.pendientes().map(
    (a) =>
      `la espera «${a.desc}» expiró a los ${a.ms} ms en ${a.sitio} y nadie la observó: ` +
      `un bloque que no se midió no puede acabar en verde. Obsérvala — ` +
      `\`ctx.expectEspera(desc, debeOcurrir, …)\` si expirar es un dato que afirmar, ` +
      `\`ctx.absorbe(motivo, …)\` si la medida vive en otro sitio (dilo en el motivo), ` +
      `o déjala propagar; y si el bloque de verdad no se pudo medir, \`ctx.sinMedirBloque(motivo)\`.`,
  );
}

/** Y uno por espera que seguía EN VUELO cuando el guion terminó, incluso
 *  después de dejarla posarse: nadie la esperó, así que no ha decidido nada —
 *  ni siquiera se sabe si iba a cumplirse. Es la cuarta boca que QA encontró el
 *  2026-09-01, y se cierra aquí y no con una regla de texto porque «falta un
 *  `await`» no tiene forma sintáctica: un `void`, un `Promise.race`, la
 *  hermana perdedora de un `Promise.all` y un `.catch()` sin `await` se
 *  escriben todos distinto y son el mismo defecto. */
export function fallosDeEsperasEnVuelo(libro) {
  return libro.enVuelo().map(
    (e) =>
      `la espera «${e.desc}» (${e.ms} ms, ${e.sitio}) SEGUÍA EN VUELO cuando el guion terminó y ` +
      `no se posó en el margen que le dio el runner: nadie la esperó, así que no ha decidido ` +
      `nada — un bloque que no se midió no puede acabar en verde. Ponle el \`await\` que le ` +
      `falta (y luego obsérvala como cualquier otra), o no la arranques.`,
  );
}
