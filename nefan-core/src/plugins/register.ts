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
 *  Tres desenlaces (§7.3 "Evolución", issue #164), decididos por el manifest
 *  que llega:
 *   - `created`   — `name` nuevo: el pipeline completo de arriba.
 *   - `migrated`  — mismo `name` con `version` MAYOR que el plugin vigente: se
 *     convierte su slice con la cadena `migrate` (la MISMA de `migrate.ts` que
 *     usa el resume) y se SUSTITUYE el record. Nunca dos records del mismo
 *     `name`; sin projections, porque el slice sale de la migración y
 *     re-proyectar borraría el estado vivo del sistema.
 *   - `unchanged` — el mismo manifest exacto (mismo hash): no-op idempotente.
 *     El id es el sha256 del manifest canónico, así que "mismo hash" es
 *     literalmente "el mismo manifest"; un reintento de la tool tras un
 *     timeout no puede convertirse en un error que solo se esquiva inventando
 *     un bump de versión falso.
 *
 *  Fail-loud: cualquier paso inválido lanza PluginRegisterError con el
 *  detalle; el caller lo convierte en HTTP 4xx y el LLM recibe el motivo.
 */
import type { NarrativeState } from "../narrative/narrative-state.js";
import { replayFixture, runProjections } from "./dsl/evaluate.js";
import { computePluginId } from "./hash.js";
import { migratePluginSlice, PluginMigrationError } from "./migrate.js";
import { PluginManifestSchema, type PluginManifest, type PluginOrigin } from "./types.js";
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

/** Qué le pasó al registry con este manifest. El motor narrativo lo necesita:
 *  si creía crear un sistema y lo que hizo fue evolucionar (o nada), su modelo
 *  del mundo cambia. */
export type PluginRegisterAction = "created" | "migrated" | "unchanged";

export interface RegisteredPlugin {
  id: string;
  manifest: PluginManifest;
  fixturesPassed: number;
  action: PluginRegisterAction;
  /** Solo en `migrated`: versión del plugin que ha sido sustituido. */
  fromVersion?: number;
  /** Solo en `migrated`: autor del record sustituido. `developer` significa
   *  que el motor narrativo acaba de TOMAR un plugin shipped — su JSON de
   *  disco queda inerte para esta sesión. */
  fromOriginAuthor?: PluginOrigin["author"];
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

  const normalized: PluginManifest = { ...manifest, id };

  // Mismo hash = mismo manifest: ya se validó y activó en su momento, así que
  // no se re-ejecutan projections (borrarían el slice vivo) ni fixtures.
  const sameId = state.getPluginRecord(id);
  if (sameId) {
    // El registry en memoria puede haberse quedado corto (un shipped se
    // rebindea del FS); asegurarlo aquí hace el no-op realmente idempotente.
    active.set(id, sameId.manifest ?? normalized);
    return {
      id,
      manifest: sameId.manifest ?? normalized,
      // CERO, y es la verdad: en esta llamada no se ha replayado ninguna. Con
      // el número del manifest, el motor leería «tu sistema acaba de pasar N
      // pruebas» de una llamada en la que no se ejecutó nada.
      fixturesPassed: 0,
      action: "unchanged",
    };
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

  // Evolución (#164): mismo `name` ya vigente ⇒ migrar y SUSTITUIR, no añadir
  // un segundo record al lado. La política del salto de versión (y el texto de
  // su rechazo) es la compartida con el resume.
  const prior = state.plugins.find((p) => p.name === manifest.name);
  if (prior) {
    // `prior` ES el record vivo: migratePluginRecord lo mutará in situ, así que
    // el id y la versión de ANTES hay que copiarlos ahora o se leen ya pisados.
    const priorId = prior.id;
    const priorVersion = prior.version;
    const priorAuthor = prior.origin.author;
    let slice: unknown;
    try {
      slice = migratePluginSlice(
        prior,
        { id, manifest: normalized },
        {
          world: state.world,
          player: state.player,
          entities: state.entities as unknown[],
          records: state.plugins,
        },
      );
    } catch (err) {
      if (err instanceof PluginMigrationError) throw new PluginRegisterError(err.message);
      throw err;
    }
    // El manifest pasa a estar embebido: a partir de aquí las reglas de este
    // plugin las pone el motor narrativo, y el `origin` del record lo dice
    // (mismo sitio del que sale en el camino `created`). Preservarlo diría que
    // el sistema sigue siendo el del disco, que ya no es cierto.
    state.migratePluginRecord(priorId, {
      id,
      version: manifest.version,
      slice,
      manifest: normalized,
      origin: manifest.origin,
    });
    active.delete(priorId);
    active.set(id, normalized);
    return {
      id,
      manifest: normalized,
      fixturesPassed: manifest.fixtures.length,
      action: "migrated",
      fromVersion: priorVersion,
      fromOriginAuthor: priorAuthor,
    };
  }

  const slice = runProjections(manifest, {
    world: state.world,
    player: state.player,
    entities: state.entities as unknown[],
  });

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

  return { id, manifest: normalized, fixturesPassed: manifest.fixtures.length, action: "created" };
}
