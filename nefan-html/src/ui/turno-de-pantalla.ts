/** ¿SIGUE SIENDO ESTA PANTALLA LA QUE ESTÁ DELANTE? (#731, #673, tanda BB)
 *
 *  La regla del título, en un solo sitio y sin DOM, para que se pueda probar
 *  fuera del navegador. La usa el enrutador (`ui/title-screen.ts`), y sus
 *  pantallas solo reciben la pregunta ya atada a su turno.
 *
 *  Hace falta porque las pantallas del título pintan o navegan DESPUÉS de un
 *  `await` (el catálogo, el censo de hojas, el bridge al borrar o al cambiar el
 *  modo de un save, la creación de un mundo, la subida de un estilo, la
 *  aplicación de un estilo). Si en esa ventana el jugador se ha ido, pintar o
 *  navegar le aplasta la pantalla nueva: «Volver» se deshacía solo y el clic
 *  que venía detrás caía en un nodo arrancado.
 *
 *  Dos preguntas distintas, y por eso dos métodos:
 *   · `pedir(a)` — el jugador NAVEGA a `a`. Abre un turno nuevo, deja
 *     caducado cualquier trabajo en vuelo de la pantalla anterior y devuelve la
 *     pregunta de la nueva.
 *   · `laQueHayDelante(a)` — un REPINTADO que no es navegación (el refresco del
 *     selector tras una pre-generación). No abre turno: se ata al de la pantalla
 *     pedida si es `a`, y si el jugador ya ha pedido otra —aunque todavía no se
 *     haya pintado— devuelve `null`. */

/** La pregunta atada a un turno: `true` mientras nadie haya navegado después. */
export type SigueDelante = () => boolean;

export interface TurnoDePantalla<A extends string> {
  pedir(a: A): SigueDelante;
  laQueHayDelante(a: A): SigueDelante | null;
}

export function crearTurnoDePantalla<A extends string>(inicial: A): TurnoDePantalla<A> {
  let pedida: { a: A; turno: number } = { a: inicial, turno: 0 };
  const atada = (turno: number): SigueDelante => () => pedida.turno === turno;
  return {
    pedir(a) {
      pedida = { a, turno: pedida.turno + 1 };
      return atada(pedida.turno);
    },
    laQueHayDelante(a) {
      return pedida.a === a ? atada(pedida.turno) : null;
    },
  };
}
