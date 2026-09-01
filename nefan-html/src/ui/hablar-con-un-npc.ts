/** HABLAR CON ALGUIEN: a quién se le puede, y qué pasa al pulsar E.
 *
 *  Eran tres trozos separados por doscientas líneas de `main.ts` —la acción
 *  contextual del HUD, la pulsación, y dos `let` de módulo con tres escritores
 *  repartidos— y forman una sola cosa: el saludo del jugador y la espera que
 *  abre.
 *
 *  LA ESPERA ES EL MOTIVO DE QUE ESTO TENGA ESTADO. `interact_entity` viaja al
 *  motor narrativo, que tarda; una segunda `E` antes de que llegue la respuesta
 *  duplicaba el saludo en los `recent_dialogues` del LLM. El guard se abre al
 *  pulsar y lo cierra quien recibe la respuesta —el evento narrativo o el error
 *  del motor—, con un tope de 30 s por si no llega nada. Tres escritores para
 *  un mismo dato es justo la forma de la que salen los espejos que esta tanda
 *  persigue, así que aquí hay UN dueño y dos verbos.
 *
 *  El otro dato, `ultimoHablado`, existe porque una línea de diálogo puede
 *  llegar sin nombre reconocible: entonces el retrato es el del último con
 *  quien se habló, que es lo que el jugador tiene delante.
 */

import type { Entity } from "../renderer/types.js";

/** Tope de la espera: si el motor no contesta, la `E` vuelve a funcionar. */
const ESPERA_MAX_MS = 30_000;

export interface DepsDeHablar {
  hayConversacionAbierta(): boolean;
  /** Manda el saludo al motor narrativo. */
  saludar(id: string, nombre: string): void;
  log(msg: string): void;
}

export class HablarConUnNpc {
  #esperaHasta = 0;
  #ultimoHablado: string | null = null;

  constructor(private readonly deps: DepsDeHablar) {}

  /** Con quién habló el jugador la última vez. Identifica al hablante cuando la
   *  línea llega del motor sin nombre reconocible. */
  get ultimoHablado(): string | null {
    return this.#ultimoHablado;
  }

  /** Llegó respuesta (o llegó un fallo): la `E` vuelve a estar disponible. */
  yaContestaron(): void {
    this.#esperaHasta = 0;
  }

  /** Un frame: `quien` es el NPC vivo más cercano dentro del alcance de la
   *  tecla (lo elige `pickNearestTarget`, en core) y `pulsado` si se ha pedido
   *  hablar en ESTE frame — por la tecla o por el botón, que aguas abajo son
   *  indistinguibles.
   *
   *  Devuelve la acción contextual que hay que ofrecer, o `null`: con una
   *  conversación ya en pantalla no se ofrece hablar otra vez. Y el saludo NO
   *  sale si el motor todavía no ha contestado al anterior. */
  frame(now: number, quien: Entity | null, pulsado: boolean): { id: string; label: string; key: string } | null {
    if (!quien || this.deps.hayConversacionAbierta()) return null;
    const nombre = quien.name ?? quien.id;
    if (pulsado && now >= this.#esperaHasta) {
      this.#esperaHasta = now + ESPERA_MAX_MS;
      this.#ultimoHablado = quien.id;
      this.deps.saludar(quien.id, nombre);
      this.deps.log(`Hablando con ${nombre}...`);
    }
    return { id: "interact", label: `hablar con ${nombre}`, key: "E" };
  }
}
