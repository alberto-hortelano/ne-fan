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
  combateDeEntity,
  escenaConCombateVivo,
  type EstadoDeCombate,
} from "../src/session/mundo-persistido.js";
import type { SceneRecord, SessionData } from "../src/narrative/types.js";
import type { BridgeContext } from "./context.js";

/** El estado de combate de cada entity del ledger, con la precedencia
 *  SIM → LEDGER escrita una sola vez.
 *
 *  El sim primero porque es el único que sabe lo que está pasando AHORA: el
 *  ledger se refresca en cada `save()`, así que en un re-broadcast de un tile
 *  cacheado a mitad de pelea iría un paso por detrás y la vida del HUD daría
 *  un salto hacia arriba al cruzar la costura. El ledger después porque es el
 *  único que sobrevive al proceso: al reanudar, el sim aún no tiene a nadie
 *  más que al jugador.
 *
 *  Un bloque roto en el ledger se DICE en el log y esa entity se queda fuera
 *  del overlay (sale con la vida del contrato, que es lo que salía antes de
 *  esta tanda): tragárselo dejaría a un enemigo herido volviendo entero sin
 *  que nadie sepa por qué. */
export function estadosDeCombate(ctx: BridgeContext): Map<string, EstadoDeCombate> {
  const estados = new Map<string, EstadoDeCombate>();
  for (const rec of ctx.narrative.entities) {
    const vivo = ctx.sim.getCombatant(rec.id);
    if (vivo) {
      estados.set(rec.id, { health: vivo.health, max_health: vivo.maxHealth });
      continue;
    }
    const guardado = combateDeEntity(rec);
    if (guardado.tipo === "combate") {
      estados.set(rec.id, guardado.combate);
    } else if (guardado.tipo === "roto") {
      console.warn(`Bridge: ${guardado.motivo} — esa entity sale al wire sin su vida guardada`);
    }
  }
  return estados;
}

/** Format D → world scene → combate vivo encima. Es la ÚNICA llamada a
 *  `formatDToWorld` que queda en todo el bridge (aparte de la colisión
 *  server-side, que no sale al cliente). */
function alWire(sceneData: Record<string, unknown>, estados: Map<string, EstadoDeCombate>): WorldScene {
  return escenaConCombateVivo(formatDToWorld(sceneData), estados);
}

/** La forma en la que una escena sale del bridge hacia un cliente. */
export function escenaParaElWire(
  ctx: BridgeContext,
  sceneData: Record<string, unknown>,
): WorldScene {
  return alWire(sceneData, estadosDeCombate(ctx));
}

/** SessionData para el wire: cada scene_data sale por la MISMA puerta que la
 *  escena difundida. Clona los records por escena porque `toSessionData()`
 *  devuelve referencias vivas al estado interno — normalizar in place
 *  corrompería la persistencia, que debe seguir en Format D crudo. */
export function sessionDataForClient(ctx: BridgeContext, data: SessionData): SessionData {
  // Los estados se calculan UNA vez para todas las escenas del save: son del
  // mundo, no del tile, y un save largo trae decenas de tiles.
  const estados = estadosDeCombate(ctx);
  const scenes: Record<string, SceneRecord> = {};
  for (const [id, rec] of Object.entries(data.scenes_loaded)) {
    scenes[id] = { ...rec, scene_data: alWire(rec.scene_data, estados) };
  }
  return { ...data, scenes_loaded: scenes };
}
