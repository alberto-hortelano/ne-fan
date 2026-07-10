/** Loader de plugins de developer (next.md §7.3, génesis "developer").
 *
 * Lee los manifests comunes de `data/plugins/*.json` (aplican a TODOS los
 * juegos) y los específicos de `data/games/{gameId}/plugins/*.json`; un
 * manifest local con el mismo `name` que uno común lo REEMPLAZA (permite
 * personalizar un sistema por mundo sin duplicar el JSON). Cada manifest se
 * valida igual (zod → hash → validación estática → replay de fixtures) y:
 *  - en sesión NUEVA, ejecuta las projections sobre el estado actual y
 *    registra cada plugin en NarrativeState (slice inicial poblado);
 *  - en RESUME, casa los registros del save contra los manifests del FS por
 *    id; el slice vive en el save y las projections NO se re-ejecutan.
 *
 * Semántica de integridad en resume (amendment documentado en next.md):
 *  - id del save con manifest en FS de hash idéntico → bind normal;
 *  - mismo `name` pero hash distinto → PluginIntegrityError (aplicar un slice
 *    viejo a reglas nuevas sin `migrate` es indefinido; migrate llega en F7);
 *  - registro del save sin ningún manifest en FS → PluginIntegrityError
 *    (restaurar el archivo es la corrección, no degradar en silencio);
 *  - manifest en FS que no está en el save → warning y NO se activa
 *    (génesis sólo en sesión nueva).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { NarrativeState } from "../narrative/narrative-state.js";
import { runProjections, replayFixture, runMigrationStep } from "./dsl/evaluate.js";
import { computePluginId } from "./hash.js";
import { PluginManifestSchema, type PluginManifest, type PluginRecord } from "./types.js";
import { validateManifestStatic } from "./validate.js";

export class PluginLoadError extends Error {
  constructor(
    public readonly file: string,
    reason: string,
  ) {
    super(`${file}: ${reason}`);
    this.name = "PluginLoadError";
  }
}

export class PluginIntegrityError extends Error {
  constructor(
    message: string,
    public readonly pluginName: string,
    public readonly savedId: string,
    public readonly fsId: string | null,
  ) {
    super(message);
    this.name = "PluginIntegrityError";
  }
}

export interface LoadedPlugin {
  id: string;
  manifest: PluginManifest;
  file: string;
}

/** Carga y valida los manifests que aplican al juego: los comunes de
 *  `{gamesDir}/../plugins` más los locales de `{gamesDir}/{gameId}/plugins`;
 *  un local con el mismo `name` reemplaza al común. Directorios ausentes ⇒ [].
 *  Cualquier manifest inválido aborta la carga entera con PluginLoadError —
 *  fail-loud, sin activaciones parciales. */
export function loadGamePluginManifests(gamesDir: string, gameId: string): LoadedPlugin[] {
  const shared = loadManifestsFromDir(resolve(gamesDir, "..", "plugins"));
  const local = loadManifestsFromDir(join(gamesDir, gameId, "plugins"));

  const localNames = new Set(local.map((lp) => lp.manifest.name));
  const merged = [...shared.filter((lp) => !localNames.has(lp.manifest.name)), ...local];

  // Mismo name ya está resuelto por el override; dos manifests con names
  // distintos no pueden colisionar en id (el name entra en el hash).
  return merged;
}

/** Carga y valida todos los manifests de un directorio (orden alfabético de
 *  archivo). Directorio ausente ⇒ []. */
function loadManifestsFromDir(dir: string): LoadedPlugin[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const loaded: LoadedPlugin[] = [];
  const seenIds = new Map<string, string>();
  const seenNames = new Map<string, string>();

  for (const file of files) {
    const fullPath = join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(fullPath, "utf-8"));
    } catch (err) {
      throw new PluginLoadError(fullPath, `JSON inválido: ${errMsg(err)}`);
    }

    const parsed = PluginManifestSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
        .join("; ");
      throw new PluginLoadError(fullPath, `manifest inválido: ${issues}`);
    }
    const manifest = parsed.data;

    const id = computePluginId(manifest);
    if (manifest.id && manifest.id !== id) {
      throw new PluginLoadError(
        fullPath,
        `id declarado ${manifest.id.slice(0, 12)}… ≠ computado ${id.slice(0, 12)}… — ` +
          `el id lo calcula el sistema; elimina el campo o actualízalo`,
      );
    }

    const staticErrors = validateManifestStatic(manifest);
    if (staticErrors.length > 0) {
      throw new PluginLoadError(fullPath, `validación estática:\n  - ${staticErrors.join("\n  - ")}`);
    }

    for (let i = 0; i < manifest.fixtures.length; i++) {
      const result = replayFixture(manifest, manifest.fixtures[i]);
      if (!result.ok) {
        throw new PluginLoadError(
          fullPath,
          `fixture[${i}] falló: ${result.error ?? "slice final ≠ after"}\n` +
            `  esperado: ${JSON.stringify(result.expected)}\n` +
            `  obtenido: ${JSON.stringify(result.actual)}`,
        );
      }
    }

    const duplicate = seenIds.get(id);
    if (duplicate) {
      throw new PluginLoadError(fullPath, `id duplicado con ${duplicate}`);
    }
    const nameClash = seenNames.get(manifest.name);
    if (nameClash) {
      throw new PluginLoadError(
        fullPath,
        `name '${manifest.name}' duplicado con ${nameClash} en el mismo directorio — ` +
          `el override por name sólo aplica entre data/plugins/ y el juego`,
      );
    }
    seenIds.set(id, file);
    seenNames.set(manifest.name, file);
    loaded.push({ id, manifest: { ...manifest, id }, file: fullPath });
  }

  return loaded;
}

/** Génesis (sólo sesión nueva): projections sobre el estado actual → slice
 *  inicial → registro en NarrativeState. El manifest NO se persiste en el
 *  save (los shipped se releen del FS, §7.6). */
export function activatePluginsForNewSession(
  state: NarrativeState,
  loaded: LoadedPlugin[],
): Map<string, PluginManifest> {
  const active = new Map<string, PluginManifest>();
  for (const lp of loaded) {
    const slice = runProjections(lp.manifest, {
      world: state.world,
      player: state.player,
      entities: state.entities as unknown[],
    });
    state.addPlugin({
      id: lp.id,
      name: lp.manifest.name,
      version: lp.manifest.version,
      slice,
      origin: lp.manifest.origin,
      activated_at: new Date().toISOString(),
    });
    active.set(lp.id, lp.manifest);
  }
  return active;
}

/** Resume: casa save ⇄ FS por id con la semántica de integridad del header.
 *  Devuelve el registry de manifests activos para el dispatcher. */
export function bindPluginsForResume(
  state: NarrativeState,
  loaded: LoadedPlugin[],
): Map<string, PluginManifest> {
  const byId = new Map(loaded.map((lp) => [lp.id, lp]));
  const byName = new Map(loaded.map((lp) => [lp.manifest.name, lp]));
  const active = new Map<string, PluginManifest>();

  for (const record of state.plugins) {
    // Plugins generados por la IA llevan el manifest embebido en el save (F5).
    if (record.manifest) {
      active.set(record.id, record.manifest);
      continue;
    }
    const fsMatch = byId.get(record.id);
    if (fsMatch) {
      active.set(record.id, fsMatch.manifest);
      continue;
    }
    const nameMatch = byName.get(record.name);
    if (nameMatch) {
      // Evolución (F7, §7.3): mismo name, hash distinto. Si el manifest del FS
      // es de una versión MAYOR y trae la cadena migrate completa desde la
      // versión del save, migramos el slice in situ en vez de abortar.
      const fromVersion = record.version;
      const migratedSlice = migrateSliceForResume(record, nameMatch, state);
      state.migratePluginRecord(record.id, {
        id: nameMatch.id,
        version: nameMatch.manifest.version,
        slice: migratedSlice,
      });
      console.log(
        `PluginLoader: '${record.name}' migrado v${fromVersion}→v${nameMatch.manifest.version} ` +
          `(${record.id.slice(0, 12)}… → ${nameMatch.id.slice(0, 12)}…)`,
      );
      active.set(nameMatch.id, nameMatch.manifest);
      continue;
    }
    throw new PluginIntegrityError(
      `el plugin '${record.name}' (${record.id.slice(0, 12)}…) del save no tiene manifest en disco — ` +
        `restaura el JSON en data/plugins/ (común) o data/games/{gameId}/plugins/.`,
      record.name,
      record.id,
      null,
    );
  }

  for (const lp of loaded) {
    if (!active.has(lp.id)) {
      console.warn(
        `PluginLoader: '${lp.manifest.name}' (${lp.id.slice(0, 12)}…) está en disco pero no en el ` +
          `save — los plugins nuevos sólo se activan en sesión nueva (génesis); ignorado en resume`,
      );
    }
  }

  return active;
}

/** Migra el slice del save al shape del manifest evolucionado (F7). Exige que
 *  el FS sea una versión MAYOR y que `migrate` cubra cada versión intermedia
 *  (migrate[from], …, migrate[to-1]); cualquier hueco o degradación aborta el
 *  resume con PluginIntegrityError accionable. Los efectos de migrate son
 *  slice-only (lo garantiza runMigrationStep). */
function migrateSliceForResume(
  record: PluginRecord,
  target: LoadedPlugin,
  state: NarrativeState,
): unknown {
  const from = record.version;
  const to = target.manifest.version;
  if (to === from) {
    throw new PluginIntegrityError(
      `el manifest de '${record.name}' cambió pero mantiene version ${from} ` +
        `(save ${record.id.slice(0, 12)}… ≠ FS ${target.id.slice(0, 12)}…). ` +
        `Un cambio de comportamiento exige subir 'version' y añadir 'migrate[${from}]', ` +
        `o restaura el archivo original.`,
      record.name,
      record.id,
      target.id,
    );
  }
  if (to < from) {
    throw new PluginIntegrityError(
      `el manifest de '${record.name}' en disco es v${to}, ANTERIOR al del save v${from} — ` +
        `no se degrada un slice; instala una versión ≥ ${from} o inicia sesión nueva.`,
      record.name,
      record.id,
      target.id,
    );
  }
  const migrate = target.manifest.migrate ?? {};
  const ctxExtras = {
    world: state.world,
    player: state.player,
    entities: state.entities as unknown[],
    plugins: pluginSlices(state.plugins),
  };
  let slice = record.slice;
  for (let v = from; v < to; v++) {
    const effects = migrate[String(v)];
    if (!effects || effects.length === 0) {
      throw new PluginIntegrityError(
        `falta 'migrate[${v}]' en '${record.name}' para evolucionar v${from}→v${to} ` +
          `(se requiere una entrada por cada versión intermedia). ` +
          `Añádela al manifest o restaura el archivo.`,
        record.name,
        record.id,
        target.id,
      );
    }
    try {
      slice = runMigrationStep(effects, { slice, ...ctxExtras });
    } catch (err) {
      throw new PluginIntegrityError(
        `migrate[${v}] de '${record.name}' falló: ${errMsg(err)}`,
        record.name,
        record.id,
        target.id,
      );
    }
  }
  return slice;
}

function pluginSlices(records: PluginRecord[]): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  for (const r of records) m[r.id] = r.slice;
  return m;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
