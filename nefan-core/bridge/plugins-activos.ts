/** Dueño único de `ctx.activePlugins` — el registro de manifests de la
 *  sesión en curso que consumen el dispatcher y `serializeForLlm`.
 *
 *  «Qué plugins están activos» es un hecho DE LA SESIÓN: cambia exactamente
 *  cuando la sesión cambia (start, resume, la sesión efímera de
 *  generate_game al abrirse Y al cerrarse, y el `load_room` que convierte el
 *  mundo en una escena de prueba — las dos últimas desde #368: sin ellas una
 *  fixture heredaba los sistemas de la pre-generación o de la partida), y
 *  hasta 2026-09-01 lo escribían seis asignaciones sueltas
 *  repartidas entre dos handlers, sincronizadas por costumbre. El séptimo
 *  escritor —un handler que quisiera «asegurarse» de recargar plugins—
 *  compilaría sin quejas y dejaría el registry desalineado del save, que es
 *  la familia exacta del fallo de `world-claim.ts`. Aquí viven las TRES
 *  transiciones que existen, cada una con su semántica escrita, y el candado
 *  `los-plugins-activos-tienen-un-solo-escritor` (arch-rules.json) impide que
 *  la asignación vuelva a los handlers.
 *
 *  Lo que este módulo NO posee: el CONTENIDO del Map durante la sesión.
 *  `registerRuntimePlugin` (plugin_register del motor) añade entradas al Map
 *  vigente vía referencia — eso es «un plugin nuevo entra en ESTA sesión»,
 *  no «la sesión cambió», y su dueño es src/plugins/register.ts. */

import type { PluginInspectResult, PluginManifest } from "../src/plugins/types.js";
import {
  activatePluginsForNewSession,
  bindPluginsForResume,
  type LoadedPlugin,
} from "../src/plugins/loader.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import { inspectPlugin } from "../src/plugins/views.js";
import type { WorldClaim } from "./world-claim.js";

/** Lo que estas transiciones necesitan del BridgeContext. Un pick estructural
 *  y no el tipo entero para que los tests puedan pasar un contexto mínimo. */
export interface ConPluginsActivos {
  narrative: NarrativeState;
  activePlugins: Map<string, PluginManifest>;
}

/** La sesión que entra NO hereda los plugins de la anterior: se vacía ANTES
 *  de sembrar la nueva, y si la activación posterior falla el bridge queda
 *  sin plugins — nunca con los de otra partida. Es también la transición
 *  entera cuando lo que entra NO es una partida: el cierre de la sesión
 *  efímera y la fixture del selector «Room» se quedan sin plugins. */
export function vaciarPluginsActivos(ctx: ConPluginsActivos): void {
  ctx.activePlugins = new Map();
}

/** Sin partida no hay sistemas (#368). La salida a «sin partida» la decide
 *  el ESTADO (`NarrativeState.soltarLaSesion`: descartar la efímera, borrar la
 *  partida activa), y aquí se lee su resultado en vez de repetir la condición
 *  en cada handler: si `session_id` quedó vacío, el registry se vacía.
 *
 *  Leer el estado ES la guarda de takeover: si otra partida sustituyó a la que
 *  se cerraba, o se borró un save que no era el activo, hay sesión vigente y
 *  sus plugins no se tocan. */
export function sinPartidaNoHayPlugins(ctx: ConPluginsActivos): void {
  if (ctx.narrative.session_id === "") vaciarPluginsActivos(ctx);
}

/** Génesis de los plugins shipped de una sesión NUEVA (start_session y la
 *  sesión efímera de generate_game): projections sobre el estado actual →
 *  slice inicial → registro en NarrativeState. Un manifest inválido lanza
 *  (fail-loud) y el caller aborta el arranque. */
export function activarPluginsDeSesionNueva(
  ctx: ConPluginsActivos,
  loaded: LoadedPlugin[],
): void {
  ctx.activePlugins = activatePluginsForNewSession(ctx.narrative, loaded);
}

/** Bind de plugins en resume: el slice vive en el save, el manifest se relee
 *  del FS (o viene embebido, F5) y se casa por id — la integridad fail-loud
 *  vive en `bindPluginsForResume`. */
export function atarPluginsDeResume(
  ctx: ConPluginsActivos,
  loaded: LoadedPlugin[],
): void {
  ctx.activePlugins = bindPluginsForResume(ctx.narrative, loaded);
}

/** `plugin_inspect` del motor (GET /plugins/{id}/inspect).
 *
 *  Con una fixture delante el registry está vacío A PROPÓSITO (`load_room`
 *  vacía; los records de la partida siguen, porque son su save). Sin esta
 *  rama, un sistema de la partida contestaba «no tiene manifest disponible»,
 *  que se lee como un save corrupto; lo que pasa es que el mundo es una
 *  escena de prueba y los sistemas vuelven al reanudar (QA tanda BG, #368). */
export function inspeccionarPlugin(
  ctx: ConPluginsActivos & { world: Pick<WorldClaim, "kind"> },
  id: string,
  view?: string,
): PluginInspectResult {
  const deLaPartida = ctx.narrative.pluginDelSistema(id);
  if (ctx.world.kind === "fixture" && deLaPartida) {
    throw new Error(
      `el mundo es una escena de prueba (selector «Room»): los sistemas de la partida ` +
        `no corren en ella. '${deLaPartida.name}' sigue en el save y vuelve con resume_session`,
    );
  }
  return inspectPlugin(
    {
      plugins: ctx.narrative.plugins,
      world: ctx.narrative.world,
      player: ctx.narrative.player,
      entities: ctx.narrative.entities,
    },
    ctx.activePlugins,
    id,
    view,
  );
}
