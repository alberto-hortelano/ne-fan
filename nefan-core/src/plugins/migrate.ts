/** Cadena de migración de plugins (next.md §7.3 "Evolución") — módulo PURO.
 *
 *  Un plugin evoluciona por DOS caminos y la política de versiones tiene que
 *  ser la misma en los dos, o el sistema tendría dos jueces del mismo salto:
 *   - **resume por FS** (`bindPluginsForResume`): el manifest del disco sube
 *     de `version` respecto al record del save;
 *   - **registro en runtime** (`registerRuntimePlugin`): el motor narrativo
 *     manda un manifest con el mismo `name` y una `version` mayor.
 *
 *  Aquí vive la decisión y el TEXTO del rechazo; cada caller envuelve el fallo
 *  en la clase de su operación (`PluginIntegrityError` en resume,
 *  `PluginRegisterError` en registro) conservando el mensaje literal — de eso
 *  hay un test de paridad carácter a carácter en `test/plugin-migrate.test.ts`.
 *  Por eso los mensajes NO hablan de "disco": el mismo texto tiene que ser
 *  cierto cuando quien trae el manifest es el motor narrativo.
 *
 *  Sin `node:*` a propósito (`arch-rules.json` → `cadena-de-migracion-unica`
 *  deja que solo este fichero llame a `runMigrationStep`).
 */
import { runMigrationStep } from "./dsl/evaluate.js";
import type { PluginManifest, PluginRecord } from "./types.js";

/** Por qué se rechazó el salto. El caller no lo usa para redactar (el texto ya
 *  viene hecho): es para distinguir un rechazo de política de un fallo del
 *  DSL sin parsear cadenas. */
export type PluginMigrationErrorKind = "no_bump" | "downgrade" | "missing_step" | "step_failed";

export class PluginMigrationError extends Error {
  constructor(
    message: string,
    public readonly kind: PluginMigrationErrorKind,
  ) {
    super(message);
    this.name = "PluginMigrationError";
  }
}

/** El manifest al que se quiere evolucionar, con su id ya calculado. */
export interface PluginMigrationTarget {
  id: string;
  manifest: PluginManifest;
}

/** Lo que el DSL puede LEER durante la migración además del propio slice. Los
 *  slices de los demás plugins salen de `records` (solo lectura, §7.3). */
export interface PluginMigrationEnv {
  world?: unknown;
  player?: unknown;
  entities?: unknown[];
  records: readonly PluginRecord[];
}

/** Convierte el slice de `record` al shape de `target.manifest` aplicando
 *  `migrate[from] … migrate[to-1]`. Exige un bump de versión real y una
 *  entrada por cada versión intermedia; cualquier hueco, degradación o cambio
 *  sin bump aborta con PluginMigrationError accionable. Los efectos son
 *  slice-only (lo garantiza `runMigrationStep`: WriteAuth vacía). PURO: no
 *  toca ni el record ni el estado. */
export function migratePluginSlice(
  record: PluginRecord,
  target: PluginMigrationTarget,
  env: PluginMigrationEnv,
): unknown {
  const from = record.version;
  const to = target.manifest.version;
  // Primero retroceder, luego no avanzar: con el orden inverso, `to === from`
  // ya lo habría atajado el primer if y el `<` de aquí daría igual escrito
  // `<=` — una condición que ningún test puede distinguir es una condición que
  // nadie vigila.
  if (to < from) {
    throw new PluginMigrationError(
      `el manifest de '${record.name}' es v${to}, ANTERIOR al del save v${from} — ` +
        `no se degrada un slice; usa una versión ≥ ${from} o inicia sesión nueva.`,
      "downgrade",
    );
  }
  if (to === from) {
    throw new PluginMigrationError(
      `el manifest de '${record.name}' cambió pero mantiene version ${from} ` +
        `(activo ${record.id.slice(0, 12)}… ≠ nuevo ${target.id.slice(0, 12)}…). ` +
        `Un cambio de comportamiento exige subir 'version' y añadir 'migrate[${from}]', ` +
        `o vuelve al manifest original.`,
      "no_bump",
    );
  }
  const migrate = target.manifest.migrate ?? {};
  const ctxExtras = {
    world: env.world,
    player: env.player,
    entities: env.entities,
    plugins: pluginSlicesById(env.records),
  };
  let slice = record.slice;
  for (let v = from; v < to; v++) {
    const effects = migrate[String(v)];
    if (!effects || effects.length === 0) {
      throw new PluginMigrationError(
        `falta 'migrate[${v}]' en '${record.name}' para evolucionar v${from}→v${to} ` +
          `(se requiere una entrada por cada versión intermedia). ` +
          `Añádela al manifest de la versión nueva.`,
        "missing_step",
      );
    }
    try {
      slice = runMigrationStep(effects, { slice, ...ctxExtras });
    } catch (err) {
      throw new PluginMigrationError(
        `migrate[${v}] de '${record.name}' falló: ${err instanceof Error ? err.message : String(err)}`,
        "step_failed",
      );
    }
  }
  return slice;
}

/** id → slice de cada plugin de la sesión, que es la forma que espera
 *  `plugins.*` en el DSL. */
function pluginSlicesById(records: readonly PluginRecord[]): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  for (const r of records) m[r.id] = r.slice;
  return m;
}
