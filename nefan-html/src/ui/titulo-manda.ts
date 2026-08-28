/** ¿Manda el título? UNA fuente, leída por el CSS y por el código.
 *
 *  #246 decidió que el título es un INTERRUPTOR y no una lista de widgets: se
 *  escribe `data-titulo` en `<html>` y la regla de `dev-ui.css` apaga
 *  `#game-ui` y `#error-log` de golpe, así que un panel nuevo dentro de
 *  `#game-ui` nace ya oculto sin que nadie se acuerde de nada.
 *
 *  Lo que ese interruptor no cubría era el INPUT. Con el título delante
 *  seguían respondiendo WASD, las flechas, `1..N`, `E`, `R`, `G`, `B` y `H`:
 *  ocho teclas actuando sobre un juego que no se ve (#285). La tecla `H` era
 *  la más visible porque abría un libro de cero píxeles, pero gatearla sola
 *  habría convertido el interruptor en la lista de widgets que #246 rechazó.
 *
 *  Por qué el atributo y no un booleano de módulo: el CSS ya lo lee, y una
 *  segunda verdad («¿está visible el título?» preguntada de otra forma) puede
 *  divergir de la primera. Aquí la pregunta del input y la del pintado son
 *  literalmente la misma lectura.
 *
 *  Escritor ÚNICO: `marcarTitulo`, que llama `main.ts` desde
 *  `titleScreen.onVisibilityChange` — el único sitio que sabe de verdad si el
 *  overlay está delante, incluido el cierre por `#ts-close` (modo fixtures),
 *  que no resuelve la promesa de `show()`. */

/** Escribe el interruptor. Lo llama SOLO `titleScreen.onVisibilityChange`. */
export function marcarTitulo(visible: boolean): void {
  document.documentElement.dataset.titulo = visible ? "1" : "0";
}

/** ¿Está el título delante? Sin escribir nunca: `"1"` lo pone `marcarTitulo`.
 *
 *  Antes del primer `show()` el atributo no existe y esto devuelve `false`,
 *  que es correcto: hasta que el título se pinta no tapa nada. */
export function elTituloManda(): boolean {
  return document.documentElement.dataset.titulo === "1";
}
