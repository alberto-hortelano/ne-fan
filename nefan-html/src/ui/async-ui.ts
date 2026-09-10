/** Descartar una promesa DICIENDO qué pasa si falla.
 *
 *  `void unaPromesa()` es el idioma con el que un handler de UI lanza trabajo
 *  asíncrono y sigue. Lo que no dice el idioma es qué pasa si ese trabajo
 *  falla: no hay `catch`, no hay entrada en el registro de errores y el
 *  cliente no tiene handler de `unhandledrejection`, así que el rechazo se
 *  pierde entero. Es exactamente lo que hacía que pulsar «Nueva partida» sin
 *  bridge fuera un NO-OP MUDO (#181), y de paso lo que impedía reproducir
 *  #189: el fallo del título no llegaba a ningún sitio.
 *
 *  `paso()` es ese mismo idioma con el canal puesto. El candado
 *  `html-sin-promesa-muda` de `arch-rules.json` impide que vuelva el `void`
 *  pelado. */
import { dlog } from "../dev/debug-log.js";
import { errors } from "./error-log.js";

/** El aviso de «este navegador no devuelve promesa» se da UNA vez por carga.
 *  Su ocupante conocido (`requestPointerLock` en Firefox) ocurre en cada click
 *  sobre el lienzo, y un registro de errores inundado no lo lee nadie. */
let yaSeAvisoDeUnNavegadorSinPromesa = false;

/** Lanza `promesa` sin esperarla y registra el fallo si lo hay.
 *
 *  `undefined` SE TOLERA y no es un descuido del tipo (#268): hay APIs del DOM
 *  que devuelven promesa en unos navegadores y nada en otros —el caso vivo es
 *  `requestPointerLock()`, que `lib.dom` tipa `Promise<void>` y Firefox
 *  resuelve devolviendo `undefined`—, así que el `promesa.catch(…)` de aquí
 *  lanzaba un `TypeError` en cada click sobre el lienzo. Eso es un navegador
 *  distinto, no un fallo de quien juega: se avisa UNA vez por carga y sigue.
 *  Tolerar no es callar — ensanchar esta firma legaliza «no devolvió nada» en
 *  los 29 llamantes, y eso tiene que dejar rastro donde se lee.
 *
 *  CUALQUIER OTRA COSA que no sea promesa sí grita, y los dos casos no son el
 *  mismo: `paso(42, …)` es un error de programación. Hoy ya lanzaba —`(42).catch`
 *  no es función— pero con un mensaje que no dice qué contrato se rompió.
 *  El candado de verdad es el TIPO, que es lo único que puede ponerse rojo sin
 *  harness (#241): la firma admite `Promise<unknown> | undefined` y nada más,
 *  así que `paso(42)` no compila. El `throw` de abajo cubre lo que el tipo no
 *  alcanza: un llamante desde JavaScript sin comprobar (un guion, la consola).
 *
 *  @param promesa  la promesa a descartar, o `undefined` si este navegador no
 *                  la devuelve.
 *  @param fuente  etiqueta del error-log ("title", "scene", "session"…).
 *  @param que     qué se estaba intentando, en español y para quien juega.
 *  @param alFallar  qué deshacer en la pantalla (devolver un botón a su
 *                   sitio, enseñar el motivo). Se llama DESPUÉS de registrar,
 *                   para que un fallo pintando no se coma la entrada del log. */
export function paso(
  promesa: Promise<unknown> | undefined,
  fuente: string,
  que: string,
  alFallar?: (err: unknown) => void,
): void {
  if (promesa === undefined) {
    // UNA VEZ POR SESIÓN, no por llamada, y las dos mitades importan.
    //
    // «Una vez» porque el ocupante conocido es `requestPointerLock()` en el
    // click del lienzo: registrarlo por click inundaría el panel de errores de
    // quien juegue en Firefox, y un registro que se inunda deja de leerse.
    //
    // «Al registro» y no solo a `dlog` porque ensanchar esta firma LEGALIZA
    // «no devolvió nada» en los 29 llamantes, y `dlog` está apagado por
    // defecto (`debug-log.ts`): dejarlo ahí solo sería tolerar en silencio,
    // que es lo que esta función existe para no hacer. Con esto, la primera
    // vez que ocurre queda dicho dónde y qué se intentaba; las siguientes ya
    // no aportan nada nuevo.
    if (!yaSeAvisoDeUnNavegadorSinPromesa) {
      yaSeAvisoDeUnNavegadorSinPromesa = true;
      errors.push(
        fuente,
        `${que}: este navegador no devuelve promesa aquí, así que no se puede ` +
          `informar de si falló. Se avisa una vez por sesión.`,
      );
    }
    dlog(`[paso] «${que}» (${fuente}) no devolvió promesa: este navegador no la da`);
    return;
  }
  // `promesa?.catch` y no `promesa.catch`: `null` es el valor MÁS probable que
  // llega aquí desde JavaScript sin comprobar (varias APIs del DOM lo
  // devuelven), y con el punto pelado esta guarda reventaba con el mismo
  // `TypeError` genérico que vino a sustituir — justo en el caso para el que
  // se escribió. `undefined` ya salió arriba, así que aquí `?.` solo puede
  // cortocircuitar por `null`.
  if (typeof promesa?.catch !== "function") {
    throw new TypeError(
      `paso() esperaba una promesa para «${que}» (${fuente}) y recibió ${typeof promesa}. ` +
        `El contrato es Promise<unknown> | undefined: undefined se tolera (hay navegadores ` +
        `que no devuelven promesa), cualquier otra cosa es un error de programación.`,
    );
  }
  promesa.catch((err: unknown) => {
    errors.push(fuente, que, err);
    alFallar?.(err);
  });
}

/** A partir de cuándo una espera deja de ser «tarda un poco» y se convierte en
 *  silencio, y cada cuánto se refresca la cuenta. */
const ESPERA_MUDA_MS = 3000;
const LATIDO_MS = 1000;

/** UNA ESPERA QUE NO SE CALLA (#425). El hermano de `paso()`: aquél es una
 *  promesa cuyo FALLO no se pierde, y ésta una promesa cuya ESPERA no se
 *  pierde. Las dos existen por lo mismo — que el jugador no se quede delante de
 *  una pantalla que no dice nada.
 *
 *  El caso que la motiva: `listSessions()` es una `request` del bridge con 30 s
 *  de timeout, así que con el socket ABIERTO y el bridge mudo —el servidor
 *  vivo pero atascado, `saves/` en un volumen que no responde— el título se
 *  quedaba medio minuto con el mismo texto puesto. Medio minuto de texto fijo
 *  es indistinguible de un cuelgue.
 *
 *  Lo que se hace es HABLAR, no acortar el plazo: cortar el timeout convertiría
 *  en fallo una espera larga que iba a acabar bien (muchas partidas, un disco
 *  lento), y eso cambia un silencio por una mentira.
 *
 *  Aquí vive el MECANISMO (cuándo se empieza a hablar, cada cuánto, y cómo se
 *  para); las PALABRAS son de quien espera, que es el único que sabe qué se
 *  está esperando y dónde se lee. Devuelve el apagador, que hay que llamar
 *  ANTES de escribir el desenlace: si no, el último latido pisaría el resultado.
 *
 *  `cada` recibe los segundos enteros transcurridos, y no se llama hasta que la
 *  espera cruza `ESPERA_MUDA_MS`: lo normal es que la promesa vuelva antes y no
 *  se diga nada, que es lo correcto. */
export function contarLaEspera(cada: (segundos: number) => void): () => void {
  const desde = performance.now();
  const timer = setInterval(() => {
    const transcurrido = performance.now() - desde;
    if (transcurrido < ESPERA_MUDA_MS) return;
    cada(Math.round(transcurrido / 1000));
  }, LATIDO_MS);
  return () => clearInterval(timer);
}
