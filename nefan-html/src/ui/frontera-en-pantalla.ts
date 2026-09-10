/** LA FRONTERA, VISTA DESDE LA PANTALLA: el muro de niebla y la pregunta.
 *
 *  Todo lo que el jugador ve del borde del mundo, en un sitio. La `Frontera`
 *  de core (`scene/frontera.ts`) decide QUÉ hay que enseñar; esto lo enseña, y
 *  no toma ninguna decisión propia:
 *
 *  1 · **El muro de niebla**, que son DOS mitades del mismo `Velo` de core y
 *      por eso se pintan de una sola lectura: el banco 3D del renderer (sobre
 *      qué borde) y el rótulo del HUD (qué es esa niebla — «Zona sin generar»
 *      si nadie ha pedido el vecino, el progreso que manda el motor mientras
 *      lo construye, «Explorando lo desconocido» si está pedido y aún no ha
 *      dicho nada). Hasta #515 el cliente se quedaba con el borde y TIRABA el
 *      texto: core calculaba los tres estados, con sus tres tests, para nadie,
 *      y quien llegaba al muro no recibía ningún motivo de por qué no puede
 *      cruzar — justo lo que el fail-loud uniforme prohíbe. El rótulo no es un
 *      `.nf-panel`: lo que nombra ocupa media pantalla y está pintado en el
 *      mundo, así que es una leyenda del paisaje (su regla, en `game-ui.css`).
 *  2 · **La pregunta de sí/no** («¿Explorar hacia el este?»), que es la única
 *      tecla del juego que GASTA CRÉDITOS. Panel propio con las teclas Y/N,
 *      también clicables.
 *  3 · **Su silencio durante el diálogo**: mientras hay una conversación
 *      abierta el bucle no llama a la frontera, así que la pregunta se queda
 *      congelada en pantalla con unas teclas que ya no responden — hay que
 *      retirarla. Se retira POR EL MISMO CANAL con el que se pone (`hidden`),
 *      y ese es el arreglo que se lleva de paso: en `main.ts` el silencio se
 *      escribía con un `style.display = "none"` en línea que NADIE volvía a
 *      quitar, y un estilo en línea gana a `hidden`. O sea que tras la primera
 *      conversación de la partida, la propuesta de explorar no se veía nunca
 *      más — el jugador llegaba al muro y solo le quedaba el velo, con la `Y`
 *      viva pero sin nada que la ofreciera. Dos representaciones de «esto está
 *      oculto» que nadie obliga a coincidir; ahora hay una. */

import type { Velo } from "@nefan-core/src/scene/frontera.js";
import type { Edge } from "@nefan-core/src/world-map/types.js";
import type { PreguntaDeFrontera } from "../world/frontera-del-jugador.js";
import { ActionBar } from "./action-bar.js";

export interface FronteraEnPantalla {
  /** Pinta el velo del frame, o lo disipa con `null`. */
  velo(velo: Velo | null): void;
  /** Pone la pregunta de sí/no, o la retira con `null`. */
  preguntar(q: PreguntaDeFrontera | null): void;
  /** El diálogo manda: retira la pregunta mientras dure. */
  callarDuranteElDialogo(): void;
  /** Los botones Y/N, para el hook del banco (`__nefan.ui`). */
  readonly barraDeConfirmacion: ActionBar;
}

/** `pintarNiebla` es el banco 3D del renderer; lo demás es DOM de esta capa. */
export function crearFronteraEnPantalla(
  pintarNiebla: (edge: Edge | null) => void,
): FronteraEnPantalla {
  const rotulo = document.getElementById("frontier-veil") as HTMLElement;
  const panel = document.getElementById("tile-confirm-prompt") as HTMLElement;
  const texto = document.getElementById("tile-confirm-text") as HTMLElement;
  const barra = new ActionBar(document.getElementById("tile-confirm-actions") as HTMLElement);
  return {
    barraDeConfirmacion: barra,
    velo(velo) {
      pintarNiebla(velo?.edge ?? null);
      rotulo.textContent = velo?.text ?? "";
      rotulo.hidden = velo === null;
    },
    preguntar(q) {
      panel.hidden = q === null;
      if (!q) {
        barra.set([]);
        return;
      }
      texto.textContent = q.text;
      barra.set([
        { id: "confirm-yes", label: q.yes, key: "Y", invoke: q.onYes },
        { id: "confirm-no", label: q.no, key: "N", invoke: q.onNo },
      ]);
    },
    callarDuranteElDialogo() {
      panel.hidden = true;
    },
  };
}
