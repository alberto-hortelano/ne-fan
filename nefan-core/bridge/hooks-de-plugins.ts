/** Los hooks de plugins del State API (`POST /plugins/register`,
 *  `GET /plugins`, `GET /plugins/{id}/inspect`) tal como los cablea el bridge
 *  (#769). Vivían dentro de `ws-server.ts`, que ningún test puede importar, así
 *  que el registro en runtime —con su aviso al jugador cuando el motor EVOLUCIONA
 *  un sistema— no lo ejercía nadie: `register` medía CRAP 110 invisible, y el
 *  doble de `test/helpers.ts` se saltaba los avisos y la guarda de fixture de
 *  `inspeccionarPlugin`. */

import { registerRuntimePlugin } from "../src/plugins/register.js";
import { pluginListSummary } from "../src/plugins/views.js";
import type { BridgeContext } from "./context.js";
import { pluginRegisterBody, type PluginHooks } from "./state-http/context.js";
import { inspeccionarPlugin } from "./plugins-activos.js";

type Registro = ReturnType<typeof registerRuntimePlugin>;

/** Que el motor haya EVOLUCIONADO un plugin —y sobre todo que haya tomado uno
 *  shipped— no puede ser algo que se deduzca del warning del siguiente resume:
 *  se dice en el log, cuando pasa. */
function registrarEnElLog(result: Registro): void {
  const name = result.manifest.name;
  const version = result.manifest.version;
  const short = result.id.slice(0, 12);
  if (result.action === "migrated" && result.fromOriginAuthor === "developer") {
    console.warn(
      `Bridge: el motor narrativo TOMA el plugin de disco '${name}' ` +
        `v${result.fromVersion}→v${version} (${short}…) — el JSON de data/…/plugins/ ` +
        `queda inerte para esta sesión: el manifest vigente vive ya en el save`,
    );
    return;
  }
  console.log(
    result.action === "migrated"
      ? `Bridge: plugin '${name}' migrado v${result.fromVersion}→v${version} en runtime (${short}…)`
      : result.action === "unchanged"
        ? `Bridge: plugin '${name}' v${version} ya activo (${short}…) — registro idempotente`
        : `Bridge: plugin '${name}' v${version} activado en runtime ` +
          `(${short}…, ${result.fixturesPassed} fixtures)`,
  );
}

/** El texto del `narrative_status ready` que acompaña a cada registro. */
function mensajeDeEstado(result: Registro): string {
  const name = result.manifest.name;
  const version = result.manifest.version;
  if (result.action === "migrated") {
    return (
      `Plugin evolucionado: ${name} v${result.fromVersion}→v${version}` +
      (result.fromOriginAuthor === "developer" ? " (sustituye al de disco)" : "")
    );
  }
  if (result.action === "unchanged") return `Plugin ya activo: ${name} v${version}`;
  return `Plugin activado: ${name} (${result.id.slice(0, 12)}…)`;
}

export function hooksDePluginsDelBridge(ctx: BridgeContext): PluginHooks {
  return {
    register: (raw) => {
      const result = registerRuntimePlugin(ctx.narrative, ctx.activePlugins, raw);
      registrarEnElLog(result);
      // plugin_activated (§7.3 paso 5): se notifica con el status existente
      // para no tocar los parsers de cliente. `kind: "plugin"` desde #352 —
      // era `consequences`, o sea «el motor narrativo rechazó la reacción»
      // para decir que un plugin se ha ACTIVADO. Este no rotula nunca (es
      // `ready`, y `rotuloDeStatus` solo rotula fallos), así que el jugador no
      // leía la mentira; pero el kind es el hecho, y dejarlo aquí era el
      // décimo sitio donde `consequences` significaba «lo demás».
      ctx.broadcastNarrative({
        type: "narrative_status",
        phase: "ready",
        kind: "plugin",
        message: mensajeDeEstado(result),
      });
      // …y para que llegue A LA PANTALLA, por el feed de eventos, que es el
      // único canal de estos que el cliente pinta hoy (un narrative_status
      // `ready` que no es de tile ni de escena lo descarta en silencio). Solo
      // la migración: es la que cambia un sistema con el que el jugador ya
      // estaba tratando, y si el que cambia es un plugin del juego, el cambio
      // es IRREVERSIBLE para ese save — el JSON del disco deja de mandar.
      if (result.action === "migrated") {
        ctx.broadcastNarrative({
          type: "narrative_event",
          eventId: "plugin_register",
          consequences: [],
          effects: [
            {
              kind: "ambient_message",
              message:
                `⚙️ el sistema «${result.manifest.name}» ha cambiado de versión ` +
                `(v${result.fromVersion} → v${result.manifest.version})` +
                (result.fromOriginAuthor === "developer"
                  ? " — a partir de ahora manda la del motor narrativo, no la del juego"
                  : ""),
            },
          ],
        });
      }
      return pluginRegisterBody(result);
    },
    list: () =>
      [...ctx.activePlugins.entries()].map(([id, m]) =>
        pluginListSummary(id, m, ctx.narrative.pluginDelManifest(id)?.origin.author),
      ),
    inspect: (id, view) => inspeccionarPlugin(ctx, id, view),
  };
}
