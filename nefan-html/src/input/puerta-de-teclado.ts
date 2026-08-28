/** La puerta por la que entra el input de JUEGO: una sola, y cerrada mientras
 *  el título manda.
 *
 *  #285 se abrió por la tecla `H` —abre el libro de historia con el título
 *  delante, y el libro vive dentro de `#game-ui`, que ahí mide cero píxeles:
 *  una tecla muda—, pero la tecla `H` no era el problema. Medido el
 *  2026-08-28: había CUATRO manejadores de `keydown` en `window`
 *  (`keyboard-input-provider`, `dev-tools-input`, `history-browser`,
 *  `dialogue-panel`) y ninguno miraba el título, así que con el título delante
 *  respondían WASD, las flechas, `1..N`, `E`, `R`, `G`, `B`, `H` y el clic de
 *  ataque.
 *
 *  Gatear solo `H` habría sido eximir un widget, que es exactamente lo que
 *  #246 cerró cuando decidió que el título es un interruptor. Así que el gate
 *  va donde el input entra en el cliente, y el checker
 *  `teclas-de-juego-pasan-por-la-puerta` (arch-rules.json) impide que aparezca
 *  un quinto manejador por fuera — en cualquiera de las seis formas de
 *  escribirlo, que su prueba en negativo enumera.
 *
 *  QUÉ NO GATEA, y por qué:
 *   · `keyup`. Gatear la SOLTADA es peor que no gatear: si el título aparece
 *     con `W` pulsada y se descarta su `keyup`, el jugador anda solo para
 *     siempre al volver. Lo que se descarta es la INTENCIÓN nueva, no el fin
 *     de una vieja.
 *   · Los listeners sobre ELEMENTOS (el `<input>` del texto libre del diálogo,
 *     los botones del título). No son input de juego: son controles con foco,
 *     y el título los necesita vivos.
 *   · El diálogo. Suprimir el movimiento y el ataque mientras hay una
 *     conversación abierta sigue siendo cosa de cada manejador: la puerta
 *     tendría que preguntárselo a alguien, y hoy la respuesta vive en
 *     `input.dialogueActive`, que escribe `main.ts`. Bajarlo aquí exige un
 *     canal de configuración con un defecto silencioso («no hay diálogo») que
 *     nadie vería fallar. Queda escrito, no olvidado.
 *
 *     REVISADO EN #311 y la decisión NO cambia. Se midió la alternativa que
 *     parecía obvia —un `data-dialogo` en la raíz, como `data-titulo`— y mide
 *     PEOR: `titulo-manda.ts` es seguro porque el CSS lee el mismo atributo
 *     (`html[data-titulo="1"] #game-ui{display:none}`) y olvidarlo tiene
 *     síntoma visible; para el diálogo no hay ninguna regla CSS sobre
 *     atributo de raíz (grep a cero), así que sería una TERCERA
 *     representación del mismo estado y su olvido volvería a ser silencioso.
 *     Lo que sí se arregló en #311 es el olvido que sí ocurría: `leave()` no
 *     deshacía el gate, y ahora es una faceta de `session-facets.ts` que el
 *     compilador no deja saltarse.
 *
 *  Se devuelve el desenganche porque `InputProvider` declara `dispose()`. */
import { elTituloManda } from "../ui/titulo-manda.js";

/** Registra un manejador de input de juego en `window`, cerrado mientras el
 *  título manda. Devuelve la función que lo desengancha.
 *
 *  Genérico sobre `WindowEventMap` para que `keydown` traiga un
 *  `KeyboardEvent` y `mousedown` un `MouseEvent` sin escribir el cuerpo dos
 *  veces: era el mismo envoltorio duplicado, y dos copias de una guarda son
 *  dos sitios donde la guarda puede quedarse a medias. */
function alEntrar<K extends keyof WindowEventMap>(
  tipo: K,
  manejador: (e: WindowEventMap[K]) => void,
): () => void {
  const conPuerta = (e: WindowEventMap[K]): void => {
    if (elTituloManda()) return;
    manejador(e);
  };
  window.addEventListener(tipo, conPuerta);
  return () => window.removeEventListener(tipo, conPuerta);
}

/** Una tecla de juego. Los eventos sintéticos sin `key` (autorrelleno, IME) se
 *  descartan aquí y no en cada manejador: estaba copiado en tres de los cinco
 *  y faltaba en dos. */
export function alPulsarTecla(manejador: (e: KeyboardEvent) => void): () => void {
  return alEntrar("keydown", (e) => {
    if (typeof e.key !== "string") return;
    manejador(e);
  });
}

/** El botón del ratón, que es la novena «tecla» de la lista: LMB ataca, y con
 *  el título delante atacaba a un mundo invisible. Va aquí y no en un módulo
 *  aparte porque es la misma decisión, y el checker cubre los dos eventos por
 *  el mismo motivo. */
export function alPulsarRaton(manejador: (e: MouseEvent) => void): () => void {
  return alEntrar("mousedown", manejador);
}
