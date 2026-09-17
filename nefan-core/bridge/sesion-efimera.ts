/** La sesión EFÍMERA de un trabajo DE JUEGO: lo que el título encarga sobre
 *  `data/games/{id}` sin que haya ninguna partida abierta (#577).
 *
 *  Existe porque el motor narrativo escribe en `ctx.narrative`, que es un
 *  SINGLETON: las map tools, `recordSceneLoaded` y `save()` no saben de otro
 *  sitio. Así que para pedirle tiles al motor desde el título hay que abrirle
 *  una sesión, y hay que volver a cerrarla.
 *
 *  SE EXTRAE DE `handlers/game-gen.ts` PORQUE YA SON DOS (la pre-generación y
 *  la cura), y lo que se copia mal de aquí es exactamente el `finally`:
 *  `descartarProvisional` es lo que suelta la IDENTIDAD de la sesión, y
 *  `ctx.narrative.session_id` es lo que leen «¿hay partida?» (`handleLoadRoom`),
 *  el 409 del State API y las rutas de documento. Olvidarlo deja el bridge con
 *  una sesión FANTASMA que sobrevive al trabajo: el State API dejaría de dar
 *  409 a las mutadoras del motor y las escribiría en un mundo de nadie.
 *  Con el cuerpo dentro de esta función, olvidarlo no es expresable.
 *
 *  La sesión NO llega a existir en disco (#279: nace provisional y solo el ack
 *  del jugador la establece), así que no hay save que borrar — el artefacto de
 *  estos trabajos es el snapshot del mundo. */
import { createHash } from "node:crypto";

import { combatRegistry } from "../src/combat/registry.js";
import {
  loadGameMeta,
  loadStyleManifest,
  loadWorldDoc,
  type GameMeta,
  type StyleManifest,
} from "../src/games/loader.js";
import { loadGamePluginManifests, pluginsHermanosDe } from "../src/plugins/loader.js";
import { activarPluginsDeSesionNueva, vaciarPluginsActivos } from "./plugins-activos.js";
import type { BridgeContext } from "./context.js";

/** Lo que el cuerpo del trabajo necesita saber del juego que se le abrió, ya
 *  cargado y validado: cargarlo dos veces sería el segundo lector de los
 *  mismos ficheros y podrían divergir. */
export interface MundoEfimero {
  /** La sesión provisional que se descarta al salir. */
  sessionId: string;
  meta: GameMeta;
  style: StyleManifest;
  /** sha256 del world.md de HOY — la clave de invalidación del snapshot. */
  worldDocHash: string;
}

/** Abre una sesión efímera sobre `gameId`, corre `cuerpo` y la descarta pase
 *  lo que pase. Fail-loud: un `game.json` o un style pack ilegibles LANZAN
 *  antes de tocar nada (no hay sesión que soltar todavía).
 *
 *  Los plugins se activan como en un `start_session` real: el motor genera con
 *  el mismo contexto que verá en partida, y sus slices mueren con el save. */
export async function conSesionEfimeraDeJuego<T>(
  ctx: BridgeContext,
  gameId: string,
  cuerpo: (mundo: MundoEfimero) => Promise<T>,
): Promise<T> {
  const meta = loadGameMeta(ctx.gamesDir, gameId);
  const style = loadStyleManifest(ctx.stylesDir, meta.style_id);
  const worldDoc = loadWorldDoc(ctx.gamesDir, gameId);
  const worldDocHash = createHash("sha256").update(worldDoc, "utf-8").digest("hex");
  vaciarPluginsActivos(ctx);
  const sessionId = ctx.narrative.startNewSession(gameId);
  try {
    ctx.narrative.setWorldInfo({
      name: meta.title,
      description: meta.world_brief,
      style_id: style.style_id,
      style_token: style.style_token,
      world_doc_hash: worldDocHash,
      render_mode: "vector",
      character_mode: "vector",
      combat_system: meta.systems?.combat ?? combatRegistry.defaultId,
    });
    const manifests = loadGamePluginManifests(ctx.gamesDir, gameId, pluginsHermanosDe(ctx.gamesDir));
    activarPluginsDeSesionNueva(ctx, manifests);
    await ctx.aiClient.notifySessionStart(sessionId, gameId, false);
    return await cuerpo({ sessionId, meta, style, worldDocHash });
  } finally {
    // Un takeover ya sustituyó la sesión y entonces la de aquí no es la
    // vigente: se descarta solo si sigue siéndolo.
    if (ctx.narrative.session_id === sessionId) ctx.narrative.descartarProvisional();
  }
}
