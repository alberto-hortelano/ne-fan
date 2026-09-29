/** QUÉ VE EL JUGADOR MIENTRAS ESTÁ CAÍDO, y cuándo manda input (#613, «que
 *  decida el motor»).
 *
 *  Al morir, el bridge le pregunta al motor dónde despierta (`kind
 *  "despertar"` en `narrative_status`). El cliente solo pinta; lo que pinta se
 *  DERIVA aquí de dos hechos que ya viajan —la vida del último frame y el
 *  último status `despertar`— y de si hay motor (partida) o no (fixtures del
 *  selector «Room», donde R reaparece al momento en el punto seguro del sim).
 *
 *  PURO: sin DOM ni `node:*`. */

export type EstadoDelDespertar =
  /** De pie: no hay velo. */
  | { de: "vivo" }
  /** Caído, y el mundo está decidiendo dónde despierta. Sin tecla. */
  | { de: "decidiendo" }
  /** Caído, y la decisión falló: el motivo y «R · reintentar». */
  | { de: "fallo"; motivo: string }
  /** Caído sin motor (fixtures): «R · reaparecer». */
  | { de: "sin_motor" };

/** El último `narrative_status` de kind `despertar` que el cliente vio, en lo
 *  que aquí importa. `null` si no ha llegado ninguno desde que estaba vivo. */
export interface UltimoStatusDelDespertar {
  phase: "generating" | "error";
  message?: string;
}

/** Qué hace un `narrative_status` de kind `despertar` con el último que cuenta:
 *  lo sustituye (`generating` o un `error` de la decisión) o no lo toca
 *  (`null`). Un RECHAZO —el bridge diciendo que un caído no puede viajar o
 *  hablar— no toca nada: el motor puede seguir decidiendo, y el velo que
 *  pasaba a «fallo» con «R · reintentar» mentía (QA de BN, segunda vuelta).
 *  Tampoco `progress`, que es un latido. */
export function cambiaElDespertar(status: {
  phase: string;
  message?: string;
  rechazo?: true;
}): UltimoStatusDelDespertar | null {
  if (status.rechazo) return null;
  if (status.phase === "error") return { phase: "error", message: status.message };
  if (status.phase === "generating") return { phase: "generating" };
  return null;
}

export function estadoDelDespertar(
  playerHp: number,
  ultimo: UltimoStatusDelDespertar | null,
  conMotor: boolean,
): EstadoDelDespertar {
  if (playerHp > 0) return { de: "vivo" };
  if (!conMotor) return { de: "sin_motor" };
  if (ultimo?.phase === "error") {
    return { de: "fallo", motivo: ultimo.message ?? "El mundo no pudo decidir dónde despiertas." };
  }
  return { de: "decidiendo" };
}

/** ¿El cliente se CALLA el input? Mientras el último frame que el game loop
 *  recibió diga que el jugador está caído. El frame que trae el punto de
 *  despertar (`reaparicion`) llega ya con vida: el loop copia el punto y el
 *  input siguiente sale desde él. Se mira el frame ENTREGADO, no el recibido:
 *  entre los dos, el loop aún tiene la posición del cadáver. */
export function elJugadorEsperaDespertar(frame: { playerHp: number }): boolean {
  return frame.playerHp <= 0;
}
