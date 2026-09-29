/** HAS CAÍDO, VISTO DESDE LA PANTALLA (#613, «que decida el motor»).
 *
 *  Mientras el jugador está caído, el bridge le pregunta al motor dónde
 *  despierta. Esto enseña esa espera —«El mundo decide dónde despiertas…»—, y
 *  si falló, el motivo; la tecla que se ofrece (R · reintentar en partida, R ·
 *  reaparecer en las fixtures) la pinta la barra de acciones de `main.ts` con
 *  el estado que devuelve `frame`. No decide nada: el estado lo deriva core
 *  (`protocol/despertar-en-pantalla.ts`) de la vida del frame y del último
 *  `narrative_status` de kind `despertar`. */

import {
  cambiaElDespertar,
  estadoDelDespertar,
  type EstadoDelDespertar,
  type UltimoStatusDelDespertar,
} from "@nefan-core/src/protocol/despertar-en-pantalla.js";

export interface VeloDelDespertar {
  /** Un `narrative_status` de kind `despertar` de MI partida. Qué cuenta lo
   *  decide core (`cambiaElDespertar`): un rechazo o un latido no cambian el
   *  velo. */
  alStatus(status: { phase: string; message?: string; rechazo?: true }): void;
  /** Pinta el frame y devuelve el estado, para la barra de acciones. De pie,
   *  olvida el último status: el siguiente caído empieza «decidiendo». */
  frame(playerHp: number, conMotor: boolean): EstadoDelDespertar;
  /** Lo que se ve ahora, para el banco (`__nefan.despertar()`). */
  estado(): EstadoDelDespertar;
}

const DECIDIENDO = "El mundo decide dónde despiertas…";

export function crearVeloDelDespertar(): VeloDelDespertar {
  const panel = document.getElementById("velo-del-despertar") as HTMLElement;
  const texto = document.getElementById("velo-del-despertar-texto") as HTMLElement;
  let ultimo: UltimoStatusDelDespertar | null = null;
  let actual: EstadoDelDespertar = { de: "vivo" };
  return {
    alStatus(status) {
      ultimo = cambiaElDespertar(status) ?? ultimo;
    },
    frame(playerHp, conMotor) {
      actual = estadoDelDespertar(playerHp, ultimo, conMotor);
      if (actual.de === "vivo") ultimo = null;
      panel.hidden = actual.de === "vivo" || actual.de === "sin_motor";
      texto.textContent = actual.de === "fallo" ? actual.motivo : DECIDIENDO;
      return actual;
    },
    estado() {
      return actual;
    },
  };
}

/** Lo que hace la partida con un `narrative_status` de kind `despertar`: el
 *  velo decide si cuenta (`cambiaElDespertar`), y un error —el de la decisión o
 *  el rechazo de algo que un caído pidió— cierra la espera del viaje que lo
 *  provocó, quita un «Viajando...» que se hubiera quedado y va a la línea de
 *  mensajes. Fuera de `main.ts` para probarlo y no sumarle ramas. */
export function atenderStatusDelDespertar(
  status: { phase: string; message?: string; rechazo?: true },
  deps: {
    velo: Pick<VeloDelDespertar, "alStatus">;
    cerrarViaje(motivo: string): void;
    quitarMuroDeEspera(): void;
    pintarFallo(): void;
  },
): void {
  deps.velo.alStatus(status);
  if (status.phase !== "error") return;
  deps.cerrarViaje(status.message ?? "sin mensaje");
  deps.quitarMuroDeEspera();
  deps.pintarFallo();
}

/** La tecla que se ofrece al caído: R reintenta si el motor falló, y reaparece
 *  sin motor (fixtures); mientras el mundo decide, ninguna — no hay nada que
 *  el jugador pueda hacer para que decida antes. */
export function accionDelCaido(
  e: EstadoDelDespertar,
  pulsarR: () => void,
): Array<{ id: string; label: string; key: string; invoke: () => void }> {
  if (e.de !== "fallo" && e.de !== "sin_motor") return [];
  return [{ id: "respawn", label: e.de === "fallo" ? "reintentar" : "reaparecer", key: "R", invoke: pulsarR }];
}
