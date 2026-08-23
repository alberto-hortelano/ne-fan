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
import { errors } from "./error-log.js";

/** Lanza `promesa` sin esperarla y registra el fallo si lo hay.
 *
 *  @param fuente  etiqueta del error-log ("title", "scene", "session"…).
 *  @param que     qué se estaba intentando, en español y para quien juega.
 *  @param alFallar  qué deshacer en la pantalla (devolver un botón a su
 *                   sitio, enseñar el motivo). Se llama DESPUÉS de registrar,
 *                   para que un fallo pintando no se coma la entrada del log. */
export function paso(
  promesa: Promise<unknown>,
  fuente: string,
  que: string,
  alFallar?: (err: unknown) => void,
): void {
  promesa.catch((err: unknown) => {
    errors.push(fuente, que, err);
    alFallar?.(err);
  });
}
