/** F6 (next.md §7.6) — proyección de plugins al contexto del motor narrativo.
 *
 * Puro y sin dependencias del bridge: opera sobre las piezas de estado que
 * necesita (plugins + world/player/entities) y un resolutor de manifests. Los
 * plugins shipped guardan su manifest en el `activePlugins` del bridge; los
 * generados por IA lo traen embebido en su PluginRecord — por eso el resolutor
 * cae al manifest embebido cuando no lo encuentra. Lo usan `serializeForLlm()`
 * (resumen vía derived_views) y la tool `plugin_inspect` (detalle bajo demanda).
 */
import { runDerivedView, type DslContext } from "./dsl/evaluate.js";
import type {
  PluginInspectResult,
  PluginLlmView,
  PluginManifest,
  PluginRecord,
} from "./types.js";

/** Piezas de estado que necesita el evaluador de vistas. NarrativeState provee
 *  estas referencias; no se mutan. */
export interface PluginViewSources {
  plugins: PluginRecord[];
  world: unknown;
  player: unknown;
  entities: unknown[];
}

/** Resolutor de manifests por id: el Map del bridge o una función. */
export type ManifestResolver =
  | Map<string, PluginManifest>
  | ((id: string) => PluginManifest | undefined);

function resolveManifest(
  record: PluginRecord,
  manifests: ManifestResolver | undefined,
): PluginManifest | undefined {
  const fromResolver =
    manifests instanceof Map ? manifests.get(record.id) : manifests?.(record.id);
  // El manifest embebido (plugins de IA) es el fallback de los shipped.
  return fromResolver ?? record.manifest;
}

function contextFor(src: PluginViewSources, record: PluginRecord): DslContext {
  const plugins: Record<string, unknown> = {};
  for (const p of src.plugins) plugins[p.id] = p.slice;
  return {
    slice: record.slice,
    world: src.world,
    player: src.player,
    entities: src.entities,
    plugins,
  };
}

/** Resumen de cada plugin activo para `serializeForLlm()`: sólo las
 *  derived_views, nunca el slice completo. Una vista que lance en runtime NO
 *  tumba el contexto narrativo — se registra el fallo y se marca esa vista con
 *  `_error` (la validación estática + fixtures ya cribó los manifests rotos en
 *  el registro; un throw aquí señala drift de la forma del slice). */
export function buildPluginLlmViews(
  src: PluginViewSources,
  manifests?: ManifestResolver,
): PluginLlmView[] {
  const out: PluginLlmView[] = [];
  for (const record of src.plugins) {
    const manifest = resolveManifest(record, manifests);
    const views: Record<string, unknown> = {};
    if (manifest) {
      const ctx = contextFor(src, record);
      for (const view of manifest.derived_views) {
        try {
          views[view.name] = runDerivedView(view, ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `plugin '${manifest.name}' derived_view '${view.name}' falló: ${msg}`,
          );
          views[view.name] = { _error: msg };
        }
      }
    }
    out.push({
      id: record.id,
      name: record.name,
      version: record.version,
      views,
    });
  }
  return out;
}

/** Detalle de un plugin bajo demanda (tool MCP `plugin_inspect`). Con
 *  `viewName` evalúa esa derived_view; sin él, devuelve el slice completo más
 *  el catálogo de vistas. Fail-loud: plugin o vista inexistentes lanzan. */
export function inspectPlugin(
  src: PluginViewSources,
  manifests: ManifestResolver | undefined,
  id: string,
  viewName?: string,
): PluginInspectResult {
  const record = src.plugins.find((p) => p.id === id);
  if (!record) throw new Error(`plugin desconocido '${id}'`);
  const manifest = resolveManifest(record, manifests);
  if (!manifest) {
    throw new Error(
      `plugin '${record.name}' (${id}) no tiene manifest disponible para inspeccionar`,
    );
  }
  const available = manifest.derived_views.map((v) => v.name);
  if (viewName) {
    const view = manifest.derived_views.find((v) => v.name === viewName);
    if (!view) {
      throw new Error(
        `plugin '${manifest.name}' no tiene derived_view '${viewName}'; ` +
          `disponibles: ${available.join(", ") || "(ninguna)"}`,
      );
    }
    return {
      id,
      name: manifest.name,
      version: manifest.version,
      available_views: available,
      view: viewName,
      result: runDerivedView(view, contextFor(src, record)),
    };
  }
  return {
    id,
    name: manifest.name,
    version: manifest.version,
    available_views: available,
    slice: record.slice,
  };
}
