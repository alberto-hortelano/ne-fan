/** Dueño único de `ctx.activePlugins` — el registro de manifests de la
 *  sesión en curso que consumen el dispatcher y `serializeForLlm`.
 *
 *  «Qué plugins están activos» es un hecho DE LA SESIÓN: cambia exactamente
 *  cuando la sesión cambia (start, resume, la sesión efímera de
 *  generate_game), y hasta 2026-09-01 lo escribían seis asignaciones sueltas
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

import type { PluginManifest } from "../src/plugins/types.js";
import {
  activatePluginsForNewSession,
  bindPluginsForResume,
  type LoadedPlugin,
} from "../src/plugins/loader.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";

/** Lo que estas transiciones necesitan del BridgeContext. Un pick estructural
 *  y no el tipo entero para que los tests puedan pasar un contexto mínimo. */
export interface ConPluginsActivos {
  narrative: NarrativeState;
  activePlugins: Map<string, PluginManifest>;
}

/** La sesión que entra NO hereda los plugins de la anterior: se vacía ANTES
 *  de sembrar la nueva, y si la activación posterior falla el bridge queda
 *  sin plugins — nunca con los de otra partida. */
export function vaciarPluginsActivos(ctx: ConPluginsActivos): void {
  ctx.activePlugins = new Map();
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
