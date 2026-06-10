/** Dispatcher de eventos de plugins (next.md §7.4) — núcleo puro, sin WS/FS
 *  y sin awaits (el tick entero es CPU; el bridge hace un único save después).
 *
 *  Alcance F4: los plugins SÓLO ven (a) consequences `plugin_event` (del LLM
 *  o de triggers de mapa, nivel 2) y (b) los `emit_event` derivados (nivel 3,
 *  FIFO al final del tick, límite MAX_EMITS_PER_TICK con abort §7.9). El hot
 *  loop de input (combate/movimiento, nivel 1) no se ofrece a plugins: ese
 *  path no toca NarrativeState ni hace save, y un tap ahí exige un diseño de
 *  batching propio — queda para una fase posterior.
 *
 *  Transaccional: todo el tick evalúa sobre working copies; si CUALQUIER
 *  evento falla (plugin desconocido, ciclo, escritura rechazada, error del
 *  DSL), no se commitea NADA y se devuelve el error tipado. Routing
 *  multi-consumer por `type` en orden alfabético de plugin_id; el plugin_id
 *  de la consequence es validación y trazabilidad, no routing exclusivo.
 */
import type { NarrativeState } from "../narrative/narrative-state.js";
import type { ConsequenceEffect } from "../narrative/types.js";
import { DslError } from "./dsl/errors.js";
import { deepEqual } from "./dsl/deep-equal.js";
import {
  manifestAuth,
  runEventEntry,
  type DslContext,
} from "./dsl/evaluate.js";
import type { PluginManifest } from "./types.js";

export const MAX_EMITS_PER_TICK = 16;

export interface PluginEventInput {
  /** Si viene de una consequence, el plugin al que el LLM dirigía el evento —
   *  se valida que exista y consuma el type. Los emit_event derivados no lo
   *  llevan. */
  pluginId?: string;
  type: string;
  payload: Record<string, unknown>;
}

export type PluginTickError =
  | { code: "unknown_plugin"; pluginId: string }
  | { code: "not_consumed"; pluginId: string; type: string }
  | { code: "emit_limit_exceeded"; limit: number; trace: string[] }
  | { code: "write_rejected"; pluginId: string; path: string }
  | { code: "dsl_error"; pluginId: string; type: string; detail: string };

export type PluginAppliedEffect = Extract<ConsequenceEffect, { kind: "plugin_applied" }>;

export interface PluginTickResult {
  ok: boolean;
  effects: PluginAppliedEffect[];
  error?: PluginTickError;
}

interface ExternalWriteOp {
  path: string;
  value: unknown;
}

export function dispatchPluginEvents(
  state: NarrativeState,
  manifests: Map<string, PluginManifest>,
  events: PluginEventInput[],
  opts?: { maxEmits?: number },
): PluginTickResult {
  if (events.length === 0) return { ok: true, effects: [] };
  const maxEmits = opts?.maxEmits ?? MAX_EMITS_PER_TICK;

  // Working copies: nada toca NarrativeState hasta el commit.
  const workSlices = new Map<string, unknown>();
  const workExternal = {
    player: structuredClone(state.player) as unknown,
    entities: structuredClone(state.entities) as unknown[],
  };
  const appliedWrites: ExternalWriteOp[] = [];
  const effects: PluginAppliedEffect[] = [];
  const trace: string[] = [];

  // Suscriptores por type, en orden alfabético de plugin_id (§7.4).
  const sortedPlugins = [...manifests.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const subscribersOf = (type: string) =>
    sortedPlugins.filter(([, m]) => m.events_consumed.some((e) => e.type === type));

  const sliceOf = (id: string): unknown => {
    if (workSlices.has(id)) return workSlices.get(id);
    const record = state.getPluginRecord(id);
    return record ? structuredClone(record.slice) : undefined;
  };
  const pluginSlicesView = (): Record<string, unknown> => {
    const view: Record<string, unknown> = {};
    for (const [id] of sortedPlugins) view[id] = sliceOf(id);
    return view;
  };

  const queue: PluginEventInput[] = [...events];
  let emitted = 0;

  while (queue.length > 0) {
    const event = queue.shift() as PluginEventInput;

    if (event.pluginId !== undefined) {
      const target = manifests.get(event.pluginId);
      if (!target || !state.getPluginRecord(event.pluginId)) {
        return fail({ code: "unknown_plugin", pluginId: event.pluginId });
      }
      if (!target.events_consumed.some((e) => e.type === event.type)) {
        return fail({ code: "not_consumed", pluginId: event.pluginId, type: event.type });
      }
    }

    for (const [id, manifest] of subscribersOf(event.type)) {
      if (!state.getPluginRecord(id)) {
        return fail({ code: "unknown_plugin", pluginId: id });
      }
      const auth = manifestAuth(manifest);
      const prevSlice = sliceOf(id);
      let ctx: DslContext = {
        event: { type: event.type, ...event.payload },
        slice: prevSlice,
        world: state.world,
        player: workExternal.player,
        entities: workExternal.entities,
        plugins: pluginSlicesView(),
      };

      const externalWrites: ExternalWriteOp[] = [];
      const emittedHere: Array<{ type: string; payload: unknown }> = [];
      let matchedAny = false;
      try {
        for (const entry of manifest.events_consumed) {
          if (entry.type !== event.type) continue;
          const out = runEventEntry(entry, ctx, auth);
          ctx = out.context;
          if (!out.matched) continue;
          matchedAny = true;
          externalWrites.push(...out.externalWrites);
          emittedHere.push(...out.emittedEvents);
        }
      } catch (err) {
        if (err instanceof DslError) {
          return fail({ code: "dsl_error", pluginId: id, type: event.type, detail: err.message });
        }
        throw err;
      }
      if (!matchedAny) continue;

      // Segunda línea de defensa tras `writes` del manifest: whitelist dura
      // de lo que un plugin puede tocar fuera de su slice.
      for (const write of externalWrites) {
        if (!externalWriteAllowed(write.path)) {
          return fail({ code: "write_rejected", pluginId: id, path: write.path });
        }
      }

      // Adopta las working copies mutadas por los efectos autorizados.
      workSlices.set(id, ctx.slice);
      workExternal.player = ctx.player;
      workExternal.entities = ctx.entities ?? workExternal.entities;
      appliedWrites.push(...externalWrites);

      for (const e of emittedHere) {
        emitted++;
        trace.push(`${id}: ${event.type} → ${e.type}`);
        if (emitted > maxEmits) {
          return fail({ code: "emit_limit_exceeded", limit: maxEmits, trace });
        }
        queue.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> });
      }

      const changedPaths = [...new Set(externalWrites.map((w) => w.path))];
      if (!deepEqual(prevSlice, ctx.slice)) changedPaths.push(`plugins.${id}.slice`);
      effects.push({
        kind: "plugin_applied",
        pluginId: id,
        eventType: event.type,
        changedPaths,
        emitted: emittedHere,
      });
    }
  }

  // Commit — sólo si el tick entero fue válido.
  for (const [id, slice] of workSlices) {
    state.setPluginSlice(id, slice);
  }
  // Se re-aplican los writes (en orden, con su valor final por entry) sobre el
  // estado real en vez de sustituir player/entities enteros, para no romper
  // referencias compartidas (worldMap, escenas).
  for (const write of appliedWrites) {
    applyToState(state, write);
  }
  if (appliedWrites.length > 0) state.markDirty();

  return { ok: true, effects };

  function fail(error: PluginTickError): PluginTickResult {
    return { ok: false, effects: [], error };
  }
}

// ── External writes: whitelist dura + re-aplicación sobre NarrativeState ────

interface ParsedCanonical {
  root: string;
  segs: Array<string | number>;
}

/** Parsea la forma canónica que emite el evaluador: root + (.key | [num])*. */
function parseCanonical(path: string): ParsedCanonical {
  const m = path.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (!m) throw new Error(`path canónico inválido: ${path}`);
  const root = m[1];
  const segs: Array<string | number> = [];
  const re = /\.([A-Za-z0-9_$]+)|\[(\d+)\]/g;
  re.lastIndex = root.length;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    segs.push(match[1] !== undefined ? match[1] : Number(match[2]));
  }
  return { root, segs };
}

const PLAYER_WRITABLE = new Set(["gold", "health", "level", "inventory"]);

function externalWriteAllowed(path: string): boolean {
  const { root, segs } = parseCanonical(path);
  if (root === "player") {
    return typeof segs[0] === "string" && PLAYER_WRITABLE.has(segs[0]);
  }
  if (root === "entities") {
    return typeof segs[0] === "number" && segs[1] === "data";
  }
  return false;
}

function applyToState(state: NarrativeState, write: ExternalWriteOp): void {
  const { root, segs } = parseCanonical(write.path);
  const base: unknown = root === "player" ? state.player : state.entities;
  let cur: unknown = base;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) throw new Error(`write ${write.path}: contenedor no-array`);
      cur = cur[seg];
    } else {
      if (cur === null || typeof cur !== "object") {
        throw new Error(`write ${write.path}: contenedor inválido`);
      }
      const obj = cur as Record<string, unknown>;
      if (obj[seg] === undefined) obj[seg] = {};
      cur = obj[seg];
    }
  }
  const last = segs[segs.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(cur)) throw new Error(`write ${write.path}: contenedor no-array`);
    cur[last] = write.value;
  } else {
    (cur as Record<string, unknown>)[last] = write.value;
  }
}
