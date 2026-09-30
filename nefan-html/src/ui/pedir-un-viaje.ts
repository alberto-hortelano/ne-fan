/** PEDIR UN VIAJE por «Salidas»: el velo «Viajando…», el libro del viaje y la
 *  petición al bridge, en este orden.
 *
 *  Y ANTES, TERMINAR LA CONVERSACIÓN QUE HAYA EN PANTALLA (QA de la tanda BX,
 *  H1). El panel se quedaba abierto bajo el velo: se veía lavado detrás y su
 *  botón «terminar» no recibía el click, porque el velo lo tapa entero. Irse
 *  de viaje es irse de la conversación, así que se termina por el MISMO
 *  camino que el botón y Esc (`Conversacion.terminar`): el panel fuera, el
 *  ratón devuelto si lo tenía, y el fin en el historial para el motor. Sin
 *  conversación abierta no hace nada. */

import type { ClientSession } from "@nefan-core/src/session/session-facets.js";
import type { NarrativeClient } from "../net/narrative-client.js";
import type { Conversacion } from "./conversacion.js";

export interface DepsDelViaje {
  /** Sin partida no hay motor que prepare el lugar. */
  session: Pick<ClientSession, "active">;
  conversacion: Pick<Conversacion, "terminar">;
  muro: { mostrar(titulo: string, detalle: string): void };
  libro: { pedido(placeId: string): void };
  /** Camino del bridge; función porque el cliente nace después. */
  red(): Pick<NarrativeClient, "enterPlace">;
}

export function pedirUnViaje(deps: DepsDelViaje): (placeId: string) => void {
  return (placeId) => {
    if (!deps.session.active) return;
    deps.conversacion.terminar();
    deps.muro.mostrar("Viajando...", "El motor narrativo está preparando el lugar.");
    deps.libro.pedido(placeId);
    deps.red().enterPlace(placeId);
  };
}
