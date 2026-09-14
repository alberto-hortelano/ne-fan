/** EL CHIP DE CONEXIÓN: lo único de la pantalla que dice si hay servidor de
 *  partida al otro lado del cable.
 *
 *  Sale de `main.ts` con #478 por la razón de siempre (#469): el texto que lee
 *  el jugador lo escribe quien lo conoce, y la raíz de composición no decide ni
 *  una palabra. Antes eran dos literales y dos nombres de clase sueltos en
 *  mitad del cableado, y quien quería saber qué dice el chip en cada estado
 *  tenía que encontrarlos entre 1.400 líneas.
 *
 *  Se le fue de paso la tercera rama, «Local», que llevaba muerta desde que
 *  desapareció la simulación local (`CONFIG.session.require_bridge`): los cinco
 *  llamantes pasaban `isBridge: true`, así que el parámetro no decidía nada y
 *  su rama no la podía alcanzar nadie. El literal sigue en `index.html` como
 *  estado de ARRANQUE —lo que se lee antes de que el cliente sepa nada—, y eso
 *  sí es cierto.
 *
 *  Lo que el chip dice, y por qué importa: hasta #478, quien arrancaba sin
 *  bridge se quedaba leyendo «Disconnected» con el socket ya abierto, porque
 *  las suscripciones que lo corrigen colgaban del `GameClient` y el cliente
 *  visor no emite ninguna. La mentira era la mitad barata del issue. */

/** Escribe el estado del cable. `true` cuando hay bridge al otro lado. */
export type ChipDeConexion = (conectado: boolean) => void;

export function crearChipDeConexion(): ChipDeConexion {
  const el = document.getElementById("connection-status");
  return (conectado) => {
    if (!el) return;
    el.textContent = conectado ? "Bridge" : "Disconnected";
    el.className = conectado ? "connected" : "disconnected";
  };
}
