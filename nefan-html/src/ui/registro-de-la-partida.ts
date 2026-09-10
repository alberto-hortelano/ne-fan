/** EL REGISTRO DE LA PARTIDA: las últimas líneas de lo que le ha pasado al
 *  jugador (`#combat-log`), del más nuevo al más viejo.
 *
 *  Es media docena de líneas y vive fuera de `main.ts` por lo que dice #506:
 *  **cuántas líneas se conservan y qué alto tiene la caja son el mismo
 *  número**, y estaban en dos ficheros distintos sin nada que los obligara a
 *  coincidir. `main.ts` cortaba a 8 y `game-ui.css` daba `max-height: 110px`
 *  con `line-height: 1.5` sobre `font-size: 11px` —16,5 px por línea, o sea
 *  6,67 líneas—, así que la séptima salía partida por la mitad en cualquier
 *  resolución. El issue culpaba al borde inferior del viewport; no era eso.
 *
 *  Aquí el número es UNO, se escribe en la custom property que la hoja de
 *  estilo lee para calcular el `max-height`, y por tanto no puede volver a
 *  discrepar: cambiarlo mueve las dos cosas a la vez. */

/** Cuántas líneas conserva el registro en pantalla. Es también su alto:
 *  `#combat-log` calcula `max-height` con este mismo número. */
export const LINEAS_DEL_REGISTRO = 8;

/** Cablea el registro sobre su nodo y devuelve el `log(msg)` que usa el resto
 *  del cliente. Escribir la custom property AQUÍ y no en la hoja de estilo es
 *  lo que hace que el tope y la altura salgan del mismo sitio. */
export function crearRegistroDeLaPartida(el: HTMLElement): (msg: string) => void {
  el.style.setProperty("--nf-log-lineas", String(LINEAS_DEL_REGISTRO));
  return (msg: string): void => {
    const linea = document.createElement("div");
    linea.textContent = msg;
    el.prepend(linea);
    while (el.children.length > LINEAS_DEL_REGISTRO) el.lastChild?.remove();
  };
}
