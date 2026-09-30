/** El salto del jugador en el cliente — CABLEADO, no decisión.
 *
 *  Guarda el estado entre frames y se lo devuelve a core cada vez
 *  (`saltoDelFrame`): cuándo se despega, cuándo se aterriza y a qué altura se
 *  va son reglas de `simulation/salto-del-jugador.ts`. Lo que sale de aquí son
 *  dos lecturas: `enElAire()`, que elige el grid del plan en `collidesAt`, y
 *  `elevacion()`, que el renderer suma a los ojos. */

import {
  EN_EL_SUELO,
  elevacionDelSalto,
  enElAire,
  saltoDelFrame,
  type Salto,
} from "@nefan-core/src/simulation/salto-del-jugador.js";

export class SaltoDelJugador {
  private salto: Salto = EN_EL_SUELO;

  /** `duracion` en segundos: `player.salto_duracion_s` del config. */
  constructor(private readonly duracion: number) {}

  frame(delta: number, pide: boolean, puedeMoverse: boolean): void {
    this.salto = saltoDelFrame(this.salto, { delta, duracion: this.duracion, pide, puedeMoverse });
  }

  enElAire(): boolean {
    return enElAire(this.salto);
  }

  /** Metros sobre el suelo: lo que el renderer suma a los ojos. */
  elevacion(): number {
    return elevacionDelSalto(this.salto, this.duracion);
  }

  /** Copia para el hook del banco (`__nefan.state().salto`). */
  estado(): { fase: Salto["fase"]; elevacion: number } {
    return { fase: this.salto.fase, elevacion: this.elevacion() };
  }
}
