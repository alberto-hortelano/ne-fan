/** LA ÚNICA SALIDA DE ESCENA DEL BRIDGE: lo que un cliente recibe cuando el
 *  bridge le enseña un trozo de mundo.
 *
 *  Había dos llamadas sueltas a `formatDToWorld` —`broadcastScene` (la escena
 *  que se difunde) y `sessionDataForClient` (las que viajan en el
 *  `session_started` del resume)—, sincronizadas por nada. Cada tanda que le
 *  añade trabajo al wire tiene que acordarse de las dos, y la tercera que
 *  apareciera divergiría en silencio: el resume serviría una escena con menos
 *  encima que el broadcast, que es la familia exacta de #179. Aquí son UNA, y
 *  lo canda `arch-rules.json` → `una-sola-salida-de-escena-del-bridge`.
 *
 *  Lo que se le añade hoy es el COMBATE VIVO (#326): la escena persistida es
 *  Format D crudo —y tiene que seguir siéndolo— así que la vida que le queda a
 *  cada enemigo y la muerte de los que ya no vuelven se ponen AQUÍ, sobre el
 *  objeto nuevo que devuelve `formatDToWorld`, camino del cable. Lo persistido
 *  no se entera; sellar el estado de sesión dentro del `scene_data` es lo que
 *  se hizo con `exits` y causó #179.
 */

import { formatDToWorld, type WorldScene } from "../src/scene/scene-normalize.js";
import {
  escenaConCombateVivo,
  estadoEnElWire,
  nombreDeEntity,
  type EstadoEnElWire,
} from "../src/session/mundo-persistido.js";
import type { SceneRecord, SessionData } from "../src/narrative/types.js";
import type { BridgeContext } from "./context.js";

/** Lo que el mundo sabe de cada combatiente del ledger, más los nombres de
 *  aquellos cuyo estado NO SE PUEDE LEER.
 *
 *  La precedencia (sim → ledger) y la clasificación viven en el módulo puro
 *  (`estadoEnElWire`), donde se pueden medir; aquí solo se recorre el ledger y
 *  se recogen los ilegibles para poder DECIRLOS. Un bloque ilegible no se
 *  traga: quien no se puede leer se queda fuera del mundo, porque servir la
 *  escena sin overlay la sirve con el bloque DERIVADO —siempre a tope de
 *  vida— y eso resucita al muerto sin una línea en pantalla. */
export function estadosDeCombate(ctx: BridgeContext): {
  estados: Map<string, EstadoEnElWire>;
  ilegibles: string[];
} {
  const estados = new Map<string, EstadoEnElWire>();
  const ilegibles: string[] = [];
  for (const rec of ctx.narrative.entities) {
    const estado = estadoEnElWire(rec, ctx.sim.getCombatant(rec.id));
    if (!estado) continue;
    estados.set(rec.id, estado);
    if (estado.tipo === "no_vuelve" && estado.motivo.clase === "ilegible") {
      ilegibles.push(nombreDeEntity(rec));
      console.warn(`Bridge: ${estado.motivo.detalle} — se queda fuera del mundo`);
    }
  }
  return { estados, ilegibles };
}

/** La frase que lee el JUGADOR cuando su partida trae combatientes cuyo estado
 *  no se puede leer. En su idioma y sin el nombre de ningún campo: el detalle
 *  técnico ya está en el log del bridge, y aquí lo que hace falta es que sepa
 *  QUÉ falta de su mundo y POR QUÉ no se ha rellenado el hueco solo. */
export function avisoDeIlegibles(nombres: readonly string[]): string {
  const lista = nombres.slice(0, 3).join(", ");
  const resto = nombres.length > 3 ? ` y ${nombres.length - 3} más` : "";
  return nombres.length === 1
    ? `La partida guardada no dice en qué estado quedó ${lista}: se queda fuera del mundo, ` +
        `para no devolver con vida a alguien al que ya habías matado.`
    : `La partida guardada no dice en qué estado quedaron ${nombres.length} personajes ` +
        `(${lista}${resto}): se quedan fuera del mundo, para no devolver con vida a alguien ` +
        `al que ya habías matado.`;
}

/** Format D → world scene → combate vivo encima. Es la ÚNICA llamada a
 *  `formatDToWorld` que queda en todo el bridge (aparte de la colisión
 *  server-side, que no sale al cliente). */
function alWire(sceneData: Record<string, unknown>, estados: Map<string, EstadoEnElWire>): WorldScene {
  return escenaConCombateVivo(formatDToWorld(sceneData), estados);
}

/** La forma en la que una escena sale del bridge hacia un cliente. */
export function escenaParaElWire(
  ctx: BridgeContext,
  sceneData: Record<string, unknown>,
): WorldScene {
  return alWire(sceneData, estadosDeCombate(ctx).estados);
}

/** SessionData para el wire: cada scene_data sale por la MISMA puerta que la
 *  escena difundida. Clona los records por escena porque `toSessionData()`
 *  devuelve referencias vivas al estado interno — normalizar in place
 *  corrompería la persistencia, que debe seguir en Format D crudo.
 *
 *  Devuelve además los `ilegibles` para que el handler los DIGA: aquí no se
 *  difunde nada porque este mensaje va después del `session_started`, no
 *  antes (llegar antes lo pintaría como un fallo del arranque, con el mundo
 *  todavía vacío y el overlay a pantalla completa). */
export function sessionDataForClient(
  ctx: BridgeContext,
  data: SessionData,
): { state: SessionData; ilegibles: string[] } {
  // Los estados se calculan UNA vez para todas las escenas del save: son del
  // mundo, no del tile, y un save largo trae decenas de tiles.
  const { estados, ilegibles } = estadosDeCombate(ctx);
  const scenes: Record<string, SceneRecord> = {};
  for (const [id, rec] of Object.entries(data.scenes_loaded)) {
    scenes[id] = { ...rec, scene_data: alWire(rec.scene_data, estados) };
  }
  return { state: { ...data, scenes_loaded: scenes }, ilegibles };
}
