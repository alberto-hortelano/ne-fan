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
 *  Toda expiración se ANOTA en este libro. Se da por observada de tres formas,
 *  y no hay una cuarta:
 *
 *    · **propagó**    — la excepción llegó al runner y paró el guion.
 *    · **afirmada**   — `ctx.expectEspera(desc, debeOcurrir, …)` convirtió el
 *                       hecho «expiró / no expiró» en un ✔ o un ✘.
 *    · **absorbida**  — `ctx.absorbe(motivo, fn)` la consumió DICIENDO dónde
 *                       vive la medida de verdad.
 *
 *  Lo que quede sin resolver al terminar el guion es un fallo con nombre: el
 *  runner lo empuja a `ctx.fallos` y el guion sale ROJO. Si el guion DECLARÓ
 *  que no midió (`ctx.sinMedir` / `ctx.sinMedirBloque`), las pendientes se
 *  imprimen como detalle de su ⊘ — que es exit 2, PEOR que el rojo
 *  (`veredictos.mjs`), o sea que declarar tampoco es una vía de escape.
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
 *      accidente: es el dato afirmado.
 *    · **cortafuegos por tramo de un bucle que REMIDE** — caminar hacia un NPC
 *      que también se mueve se hace en tramos de 4 s; que un tramo se agote no
 *      dice nada porque el bucle vuelve a medir y la medida vive al final. Se
 *      escribe con `absorbe(motivo, …)`, y el motivo tiene que decir DÓNDE
 *      vive esa medida.
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
 *  para que quien la observe pueda resolverla, y el último valor sondeado, que
 *  es lo que dice QUÉ estaba pasando. */
export class EsperaExpirada extends Error {
  constructor(mensaje, esperaId, ultimo) {
    super(mensaje);
    this.name = "EsperaExpirada";
    this.esperaId = esperaId;
    this.ultimo = ultimo;
  }
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
 *  llamó desde un guion, vale el primer marco que no sea de `qa/lib`. Puro a
 *  propósito: recibe el texto del stack, no lo fabrica. */
export function sitioDeLlamada(stack) {
  const lineas = String(stack ?? "").split("\n").slice(1);
  const cruda = (lineas.find((l) => l.includes("/qa/guiones/")) ??
    lineas.find((l) => !l.includes("/qa/lib/")) ??
    "").trim();
  const m = cruda.match(/([^/\\() ]+\.(?:mjs|js|ts)):(\d+):\d+/);
  return m ? `${m[1]}:${m[2]}` : cruda || "sitio desconocido";
}

/** El libro de un guion: se anota cada expiración y se resuelve quien la
 *  observe. `resuelve` es idempotente y tolerante con un id desconocido — un
 *  observador que llega dos veces, o tarde, no puede hacer estallar la corrida
 *  que está juzgando. */
export function libroDeEsperas() {
  const anotaciones = new Map();
  let ultimo = 0;
  return {
    anota(desc, ms, sitio) {
      const id = ++ultimo;
      anotaciones.set(id, { id, desc, ms, sitio, resolucion: null });
      return id;
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
    todas() {
      return [...anotaciones.values()];
    },
  };
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
