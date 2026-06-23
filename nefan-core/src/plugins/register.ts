/** Registro de plugins en runtime (next.md §7.3, génesis "narrative_engine" —
 *  fase F5). El motor narrativo envía un manifest vía la tool MCP
 *  `plugin_register` → state HTTP API del bridge → aquí.
 *
 *  Pipeline (§7.3): zod → hash (id calculado; si el manifest lo trae y
 *  diverge, error) → validación estática → replay de TODAS las fixtures
 *  (obligatoria al menos una: para un plugin emergido en runtime las fixtures
 *  son la única red de seguridad) → projections sobre el estado actual →
 *  PluginRecord persistido CON el manifest embebido (§7.6: los runtime
 *  sobreviven save/load sin archivo en disco) → registry activo del
 *  dispatcher.
 *
 *  Fail-loud: cualquier paso inválido lanza PluginRegisterError con el
 *  detalle; el caller lo convierte en HTTP 4xx y el LLM recibe el motivo.
 */
import type { NarrativeState } from "../narrative/narrative-state.js";
import { replayFixture, runProjections } from "./dsl/evaluate.js";
import { computePluginId } from "./hash.js";
import { PluginManifestSchema, type PluginManifest } from "./types.js";
import { validateManifestStatic } from "./validate.js";

export class PluginRegisterError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(issues.length ? `${message}:\n  - ${issues.join("\n  - ")}` : message);
    this.name = "PluginRegisterError";
  }
}

export interface RegisteredPlugin {
  id: string;
  manifest: PluginManifest;
  fixturesPassed: number;
}

export function registerRuntimePlugin(
  state: NarrativeState,
  active: Map<string, PluginManifest>,
  raw: unknown,
): RegisteredPlugin {
  if (!state.session_id) {
    throw new PluginRegisterError("no hay sesión narrativa activa en el bridge");
  }

  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginRegisterError(
      "manifest inválido",
      parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`),
    );
  }
  const manifest = parsed.data;

  const id = computePluginId(manifest);
  if (manifest.id && manifest.id !== id) {
    throw new PluginRegisterError(
      `id declarado ${manifest.id.slice(0, 12)}… ≠ computado ${id.slice(0, 12)}… — ` +
        `omite el campo id: lo calcula el sistema`,
    );
  }

  if (state.getPluginRecord(id)) {
    throw new PluginRegisterError(
      `el plugin '${manifest.name}' (${id.slice(0, 12)}…) ya está activo en esta sesión`,
    );
  }

  const staticErrors = validateManifestStatic(manifest);
  if (staticErrors.length > 0) {
    throw new PluginRegisterError("validación estática", staticErrors);
  }

  if (manifest.fixtures.length === 0) {
    throw new PluginRegisterError(
      "un plugin registrado en runtime requiere al menos una fixture " +
        "(before + event + after) que demuestre sus reglas",
    );
  }
  for (let i = 0; i < manifest.fixtures.length; i++) {
    const result = replayFixture(manifest, manifest.fixtures[i]);
    if (!result.ok) {
      throw new PluginRegisterError(
        `fixture[${i}] falló: ${result.error ?? "slice final ≠ after"}`,
        [
          `esperado: ${JSON.stringify(result.expected)}`,
          `obtenido: ${JSON.stringify(result.actual)}`,
        ],
      );
    }
  }

  const slice = runProjections(manifest, {
    world: state.world,
    player: state.player,
    entities: state.entities as unknown[],
  });

  const normalized: PluginManifest = { ...manifest, id };
  state.addPlugin({
    id,
    name: manifest.name,
    version: manifest.version,
    slice,
    origin: manifest.origin,
    activated_at: new Date().toISOString(),
    // Embebido SIEMPRE para registros runtime: no hay archivo en disco del
    // que releerlo en resume (§7.6).
    manifest: normalized,
  });
  active.set(id, normalized);

  return { id, manifest: normalized, fixturesPassed: manifest.fixtures.length };
}
