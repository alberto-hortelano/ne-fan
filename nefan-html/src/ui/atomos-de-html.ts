/** Los átomos de HTML del cliente: escapes y la silueta del badge.
 *
 *  Existe por un motivo de FRONTERA y no de gusto. `ui/titulo/atomos.ts` es el
 *  vocabulario de las siete pantallas del título, y sus dos candados lo dejan
 *  encerrado ahí: `las-hojas-del-titulo-no-se-atan-entre-si` no deja que un
 *  módulo de `ui/titulo/` importe a otro que no sea aquél, y
 *  `el-titulo-solo-entra-por-su-enrutador` no deja que nadie de fuera importe
 *  nada de `ui/titulo/` salvo el enrutador. O sea: cualquier módulo que pinte
 *  HTML y NO sea una hoja del título se quedaba sin escapes, y la única salida
 *  era meterlo dentro de `ui/titulo/` —donde no es— o copiar las funciones.
 *  Lo estrena `ui/tarjeta-de-partida.ts` (#663).
 *
 *  Es el nivel de abajo de `atomos.ts`, no su competencia: aquel re-exporta
 *  `escapeHtml`/`escapeAttr` desde aquí para que las siete hojas sigan
 *  importándolos donde los importaban, y usa `BADGE_CSS` para los chips de la
 *  tarjeta de mundo.
 *
 *  PUEDE vivir fuera de `ui/titulo/` por lo mismo que `atomos.ts` puede ser la
 *  excepción de su candado: cero estado, cero `this`, cero colaboradores — son
 *  constantes y funciones que reciben un string y devuelven otro.
 *
 *  LO QUE NO ES: el sitio donde unificar las TRES copias de `escapeHtml` del
 *  cliente (`ui/error-log.ts`, `ui/history-browser.ts`) ni las dos de
 *  `formatDate`. Eso es mecánico ahora que este fichero existe, y tiene issue
 *  propio — fuera del alcance de #663.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** El badge base: la silueta que comparten el badge de modo de un save
 *  (`ui/tarjeta-de-partida.ts`) y los chips de generación de la tarjeta de
 *  mundo (`ui/titulo/atomos.ts`). Son sus DOS dueños, y que vivan a los dos
 *  lados de la frontera del título es justo por lo que la constante baja aquí:
 *  desde `atomos.ts` el primero no podía alcanzarla sin ser una hoja.
 *
 *  Que los dos badges se vean IGUAL es el invariante — si esto se copiara en
 *  vez de moverse, divergirían en pantalla y nada lo diría. */
export const BADGE_CSS = "display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;background:#23222c;border:1px solid #3a3846;color:#a99";
