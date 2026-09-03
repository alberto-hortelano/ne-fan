/** LA ÚNICA SALIDA DE ESCENA DEL BRIDGE: lo que un cliente recibe cuando el
 *  bridge le enseña un trozo de mundo.
 *
 *  Había dos llamadas sueltas a `formatDToWorld` —`broadcastScene` (la escena
 *  que se difunde) y `sessionDataForClient` (las que viajan en el
 *  `session_started` del resume)—, sincronizadas por nada. Cada tanda que le
 *  añade trabajo al wire tiene que acordarse de las dos, y la tercera que
 *  apareciera divergiría en silencio: el resume serviría una escena con menos
 *  encima que el broadcast. Aquí son UNA, y lo canda `arch-rules.json` →
 *  `una-sola-salida-de-escena-del-bridge`.
 *
 *  Lo que se le pone encima, sobre el objeto NUEVO que devuelve
 *  `formatDToWorld` y camino del cable:
 *   · el COMBATE VIVO (#326): la vida que le queda a cada enemigo y la
 *     ausencia de los que ya no vuelven;
 *   · las SALIDAS del lugar (#179): los links del world map de AHORA, con el
 *     nombre del destino. Se calculan al servir —broadcast y resume por la
 *     misma puerta— y no se sellan en el `scene_data`: un derivado del mapa
 *     que viviera dentro de la escena persistida solo se actualizaría al
 *     volver a difundirla, y el resume lo serviría congelado. Cuando el mapa
 *     cambia a mitad de sesión, `bridge/salidas.ts` manda solo las salidas.
 *  La escena persistida es Format D crudo y tiene que seguir siéndolo: lo
 *  persistido no se entera de nada de esto.
 */

import { formatDToWorld } from "../src/scene/scene-normalize.js";
import type { EscenaServida, SceneRecordEnElWire, SessionDataEnElWire } from "../src/protocol/messages.js";
import {
  entidadesFueraDelMundo,
  escenaConCombateVivo,
  estadoEnElWire,
  nombreDeEntity,
  rectsDelMundo,
  type EstadoEnElWire,
  type FueraDelMundo,
} from "../src/session/mundo-persistido.js";
import { placeDeLaEscena, salidasDePlace } from "../src/world-map/exits.js";
import type { SessionData } from "../src/narrative/types.js";
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
    // Desde #351 el mapa lleva a TODA entity del ledger, no solo a las que
    // pelean: la posición viva es de cualquiera que se haya movido, y el
    // `null` que se saltaba a los pacíficos era justo lo que dejaba al
    // tabernero volviendo a su celda de spawn.
    const estado = estadoEnElWire(rec, ctx.sim.getCombatant(rec.id));
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

/** Format D → world scene → combate vivo → salidas del lugar. Es la ÚNICA
 *  llamada a `formatDToWorld` que queda en todo el bridge (aparte de la
 *  colisión server-side, que no sale al cliente). `sceneId` hace falta para
 *  saber si ESTA es la escena activa: solo la activa cae al place activo cuando
 *  no declara el suyo (`placeDeLaEscena`). */
function alWire(
  ctx: BridgeContext,
  sceneId: string,
  sceneData: Record<string, unknown>,
  estados: Map<string, EstadoEnElWire>,
): EscenaServida {
  const wm = ctx.narrative.worldMap;
  const placeId = placeDeLaEscena(
    sceneData,
    sceneId,
    ctx.narrative.world.active_scene_id,
    wm.serialize().active_place_id,
  );
  return {
    ...escenaConCombateVivo(formatDToWorld(sceneData), estados),
    exits: placeId === null ? [] : salidasDePlace(wm, placeId),
  };
}

/** La forma en la que una escena sale del bridge hacia un cliente. */
export function escenaParaElWire(
  ctx: BridgeContext,
  sceneId: string,
  sceneData: Record<string, unknown>,
): EscenaServida {
  return alWire(ctx, sceneId, sceneData, estadosDeCombate(ctx).estados);
}

/** SessionData para el wire: cada scene_data sale por la MISMA puerta que la
 *  escena difundida. Clona los records por escena porque `toSessionData()`
 *  devuelve referencias vivas al estado interno — normalizar in place
 *  corrompería la persistencia, que debe seguir en Format D crudo.
 *
 *  Devuelve además lo que el handler tiene que DECIR: los `ilegibles` (un
 *  combate que no se puede leer) y los `fueraDelMundo` (#382: una posición
 *  viva que no cae en ningún tile del save — la unión de rects sale de ESTE
 *  mismo `scenes_loaded`, que es el mundo entero conocido). Aquí no se
 *  difunde nada porque esos avisos van después del `session_started`, no
 *  antes (llegar antes los pintaría como un fallo del arranque, con el mundo
 *  todavía vacío y el overlay a pantalla completa). */
export function sessionDataForClient(
  ctx: BridgeContext,
  data: SessionData,
): { state: SessionDataEnElWire; ilegibles: string[]; fueraDelMundo: FueraDelMundo[] } {
  // Los estados se calculan UNA vez para todas las escenas del save: son del
  // mundo, no del tile, y un save largo trae decenas de tiles.
  const { estados, ilegibles } = estadosDeCombate(ctx);
  const scenes: Record<string, SceneRecordEnElWire> = {};
  for (const [id, rec] of Object.entries(data.scenes_loaded)) {
    scenes[id] = { ...rec, scene_data: alWire(ctx, id, rec.scene_data, estados) };
  }
  const fueraDelMundo = entidadesFueraDelMundo(data.entities, rectsDelMundo(data.scenes_loaded));
  for (const f of fueraDelMundo) {
    console.warn(`Bridge: la posición viva de "${f.id}" (${f.x}, ${f.z}) no cae en ningún tile del save`);
  }
  return { state: { ...data, scenes_loaded: scenes }, ilegibles, fueraDelMundo };
}
