/** EL DUEÑO DEL MUNDO: quién puede escribir en el sim, y qué significa eso
 *  para la partida guardada.
 *
 *  El sim del bridge es UNO y su combatiente `player` también. Antes esto eran
 *  dos hechos sueltos —quién conduce (`simDriver`) y a qué escucha el save
 *  (`bindPlayerRuntime`)— que había que mover a mano y en el mismo orden desde
 *  cuatro sitios. Se separaron, y el día que se separaron pasó esto (QA,
 *  2026-08-25, tres de tres):
 *
 *      jugar → andar 2 m → F5 → título → «✕ Cerrar (modo fixtures)» →
 *      elegir una fixture → andar → el motor escribe
 *
 *  …y el `state.json` de la partida acababa con las coordenadas del muñeco de
 *  la fixture dentro. El save seguía escuchando a un sim que ya no era el
 *  suyo. Un save que se corrompe en silencio es peor que uno que no guarda,
 *  porque el jugador se entera al reanudar y no antes.
 *
 *  Aquí son UN hecho. Tomar el mundo y decidir si el save escucha es la misma
 *  llamada, y soltarlo las deshace las dos: no hay forma de que la atadura
 *  sobreviva al dueño porque nadie de fuera puede atarla ni soltarla (lo canda
 *  `arch-rules.json` → `la-atadura-del-save-vive-con-el-dueno-del-mundo`).
 *
 *  Tres formas de tomarlo, y solo tres:
 *   · `claimForSession` — start_session / resume_session. Conduce ese socket y
 *     **el save escucha al sim**: es la partida del jugador.
 *   · `claimForFixture` — load_room, o sea el selector «Room» del cliente.
 *     Conduce ese socket y **el save deja de escuchar**: lo que ande por ahí
 *     es un muñeco de una escena de prueba, no el jugador de nadie.
 *   · nadie — al cerrarse el socket del dueño. No hay partida escuchando, así
 *     que quien llegue puede conducir (el modo fixtures tras un F5 sigue
 *     siendo jugable, que es lo que este modelo no puede romper).
 */

import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { GameSimulation } from "../src/simulation/game-loop.js";
import type { ClientSocket } from "./context.js";

/** A qué título se tiene el mundo. Decide si el save escucha al sim. */
export type ClaimKind = "session" | "fixture";

export interface WorldClaim {
  /** El socket que tiene el mundo, o `null` si no lo tiene nadie. */
  readonly owner: ClientSocket | null;
  /** A qué título lo tiene, o `null` si no lo tiene nadie. */
  readonly kind: ClaimKind | null;
  /** ¿Puede este socket escribir en el sim? El dueño, sí; si no hay dueño,
   *  cualquiera (no hay partida a la que hacerle daño); otro socket, no. */
  canDrive(ws: ClientSocket): boolean;
  /** La partida del jugador toma el mundo: conduce `ws` y el save pasa a
   *  llevar la posición y la vida VIVAS del combatiente. */
  claimForSession(ws: ClientSocket): void;
  /** Una escena de prueba toma el mundo: conduce `ws` y el save deja de
   *  escuchar. Devuelve `false` —y no toca nada— si el mundo lo tiene OTRO
   *  socket: una pestaña ajena no le congela la partida a quien está jugando. */
  claimForFixture(ws: ClientSocket): boolean;
  /** Suelta el mundo si lo tenía `ws` (su socket se cerró). Deja de escuchar:
   *  lo que le pase al sim a partir de aquí no es de esta partida. */
  release(ws: ClientSocket): void;
}

export function createWorldClaim(narrative: NarrativeState, sim: GameSimulation): WorldClaim {
  let owner: ClientSocket | null = null;
  let kind: ClaimKind | null = null;

  /** La ÚNICA fuente de runtime que se ata nunca: el combatiente del sim.
   *  Sin combatiente devuelve `null`, que no es un error — es «todavía no hay
   *  jugador vivo» (bootstrap antes de sembrar) y entonces el save conserva lo
   *  que ya tenía. */
  function escucharAlSim(): void {
    narrative.bindPlayerRuntime(() => {
      const vivo = sim.getCombatant("player");
      return vivo ? { position: vivo.position, health: vivo.health } : null;
    });
  }

  return {
    get owner() {
      return owner;
    },
    get kind() {
      return kind;
    },
    canDrive(ws) {
      return owner === null || owner === ws;
    },
    claimForSession(ws) {
      owner = ws;
      kind = "session";
      escucharAlSim();
    },
    claimForFixture(ws) {
      if (owner !== null && owner !== ws) {
        console.warn(
          "Bridge: load_room de un socket que no tiene el mundo — ignorado " +
            "(otra pestaña no le quita el mundo a quien está jugando)",
        );
        return false;
      }
      owner = ws;
      kind = "fixture";
      narrative.bindPlayerRuntime(null);
      // Se dice en voz alta porque es el momento en el que la partida deja de
      // escuchar al sim: si alguna vez vuelve a aparecer una posición de nadie
      // en un `state.json`, esta línea del log es por dónde se empieza.
      console.log(
        "Bridge: el mundo pasa a una escena de prueba (load_room) — la partida guardada deja de escuchar al sim",
      );
      return true;
    },
    release(ws) {
      if (owner !== ws) return;
      const anterior = kind;
      owner = null;
      kind = null;
      narrative.bindPlayerRuntime(null);
      if (anterior === "session") {
        console.log("Bridge: el mundo se queda sin dueño — la partida guardada deja de escuchar al sim");
      }
    },
  };
}
