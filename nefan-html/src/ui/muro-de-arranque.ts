/** EL MURO DEL ARRANQUE: lo único que puede contar por qué el cliente NO llegó
 *  a existir.
 *
 *  El muro normal (`ui/muro-de-carga.ts`) es el pintor único de los avisos de
 *  `errors.onAviso`, y se suscribe a mitad de la evaluación de `main.ts`. Eso
 *  deja un hueco que el jugador ve como una PANTALLA MUERTA: si algo revienta
 *  ANTES —en la evaluación de un módulo importado, o en las primeras líneas de
 *  la raíz—, no hay pintor al que entregarle el aviso, `main.ts` no termina de
 *  evaluarse, el título no se dibuja y la página se queda en negro con el
 *  motivo únicamente en la consola del navegador. Medido con un
 *  `combat_config.json` mutilado (#539-H6): el jugador no leía nada, y el
 *  launcher decía «bridge did not come up» sin la causa.
 *
 *  Esto pinta el MISMO overlay estático del index (`#narrative-loader`, que ya
 *  existe en el DOM antes de que corra un solo módulo) sin depender de nada de
 *  la raíz: sin fábrica, sin deps, sin `errors`. Es deliberadamente tonto —dos
 *  clases y dos textos— porque el estado en el que sirve es justo aquel en el
 *  que no se puede confiar en que el resto exista.
 *
 *  Quien lo llama es quien CONOCE la causa (#469), en el mismo sitio donde la
 *  detecta, y además la deja en el registro con `errors.push`. No hay aquí un
 *  `window.onerror` que lo adivine: un cazador global pintaría también fallos
 *  de los que el juego sí sabe recuperarse, y el muro dejaría de significar
 *  «el cliente no arrancó». */

/** Pinta el muro de arranque y devuelve si encontró dónde pintarlo. `false`
 *  solo puede pasar con un `index.html` sin el overlay: se dice en vez de
 *  fingir que el jugador está informado. */
export function muroDeArranque(titulo: string, detalle: string): boolean {
  const el = document.getElementById("narrative-loader");
  const elTitulo = document.getElementById("narrative-loader-title");
  const elDetalle = document.getElementById("narrative-loader-detail");
  if (!el || !elTitulo || !elDetalle) return false;
  elTitulo.textContent = titulo;
  elDetalle.textContent = detalle;
  // El cronómetro es del muro de espera; aquí no hay nada que esperar.
  const elapsed = document.getElementById("narrative-loader-elapsed");
  if (elapsed) elapsed.textContent = "";
  // «Cerrar» no tiene sentido en un arranque fallido: detrás no hay partida ni
  // título que mirar, y cerrarlo dejaría al jugador delante del negro con el
  // motivo borrado. Mismo criterio que el `volver-al-titulo` de #189, sin el
  // botón: aquí tampoco hay título al que volver.
  const dismiss = document.getElementById("narrative-loader-dismiss");
  if (dismiss) dismiss.setAttribute("hidden", "");
  el.classList.add("visible", "error");
  return true;
}
