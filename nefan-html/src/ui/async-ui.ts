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

/** Lanza `promesa` sin esperarla y registra el fallo si lo hay.
 *
 *  `undefined` SE TOLERA y no es un descuido del tipo (#268): hay APIs del DOM
 *  que devuelven promesa en unos navegadores y nada en otros —el caso vivo es
 *  `requestPointerLock()`, que `lib.dom` tipa `Promise<void>` y Firefox
 *  resuelve devolviendo `undefined`—, así que el `promesa.catch(…)` de aquí
 *  lanzaba un `TypeError` en cada click sobre el lienzo. Eso es un navegador
 *  distinto, no un fallo de quien juega: deja rastro por `dlog` y sigue.
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
    // NO va a `errors.push`: el registro de errores es lo que lee quien juega
    // cuando algo le ha salido mal, y aquí no le ha salido nada mal — sería
    // una línea roja por cada click en el lienzo. OJO al alcance de este
    // rastro: `dlog` está APAGADO por defecto (`debug-log.ts`), así que solo
    // se lee con `?debug=1` o `__nefan.debug(true)`.
    dlog(`[paso] «${que}» (${fuente}) no devolvió promesa: este navegador no la da`);
    return;
  }
  if (typeof promesa.catch !== "function") {
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
