/** La hora del día leída de la NARRACIÓN, y los labels que encienden una luz
 *  práctica.
 *
 *  El motor narrativo no declara campos de luz en un tile: escribe "cae la
 *  tarde sobre el lindero" y espera que atardezca. Estas dos piezas son las
 *  que traducen ese texto a ambientación, y las consume la vista fps
 *  (`blueprint/fps-ambience.ts`). Módulo propio y no un rincón de ese
 *  post-proceso: la inferencia es una decisión de contenido con su propio
 *  test, y esconderla dentro de quien la usa la deja sin sujeto.
 *
 *  Puro: entra texto, sale una hora. */

/** Hora del día de una escena. Quien la declare (el plató la trae en
 *  `stage.ambience`) resuelve por su cuenta; aquí solo vive la inferencia. */
export type TimeOfDay = "amanecer" | "dia" | "atardecer" | "noche";

/** Hora inferida de un TEXTO (descripciones del motor) — compartida con la
 *  vista fps, que no tiene campo declarado y escucha la narración. */
export function timeOfDayFromText(text: string): TimeOfDay {
  const t = text.toLowerCase();
  // Raíces verbales incluidas: "atardece sobre el camino" atardece de verdad.
  if (/amanec|alba\b|aurora|primera luz/.test(t)) return "amanecer";
  if (/atardec|ocaso|poniente|ca(e|ía) la tarde|crep[uú]sculo|sol bajo/.test(t)) return "atardecer";
  if (/\bnoche\b|anochec|nocturn|luna|estrellas|medianoche/.test(t)) return "noche";
  return "dia";
}

/** Labels que encienden una luz práctica cálida sobre el volumen. */
export const PRACTICAL_LIGHT_RE =
  /chimenea|hogar|fog[oó]n|farol|vela|antorcha|candil|brasero|l[aá]mpara|lumbre|hoguera|fuego/i;
