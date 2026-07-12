/** Proyección del NarrativeState al contexto del motor narrativo (LlmContext).
 *
 *  Extraída de la clase para que el "qué ve el LLM en cada turno" viva en un
 *  módulo propio: diálogos recientes con la réplica del NPC, entities
 *  compactas, análisis de imagen del tile activo y vistas de plugins. La
 *  clase delega aquí desde su método público serializeForLlm(). */
import type { NarrativeState } from "./narrative-state.js";
import type { Consequence, LlmContext } from "./types.js";
import type { PluginManifest } from "../plugins/types.js";
import { buildPluginLlmViews } from "../plugins/views.js";

/** @param manifests resolutor de manifests de los plugins activos (el
 *   `activePlugins` del bridge). Sin él, sólo se proyectan los plugins cuyo
 *   manifest está embebido en el record (los generados por IA). */
export function buildLlmContext(
  state: NarrativeState,
  manifests?: Map<string, PluginManifest>,
): LlmContext {
  const recent = state.dialogue_history.slice(-10).map((d) => {
    let chosen = "";
    if (d.chosen_index >= 0 && d.chosen_index < d.choices.length) {
      const c = d.choices[d.chosen_index];
      chosen = typeof c === "string" ? c : c?.text ?? "";
    }
    // Los eventos de dialogue_choice llegan del bridge con el texto elegido
    // en `text` y choices vacías — sin este fallback el motor recibía
    // chosen: "" y no sabía qué había elegido el jugador.
    if (!chosen && d.free_text === "" && d.text) chosen = d.text;
    // La réplica del NPC vive en las consequences del evento; sin exponerla
    // el motor no recuerda lo que el propio NPC dijo hace 2 turnos.
    const reply = d.narrative_consequences.find(
      (c): c is Extract<Consequence, { type: "dialogue" }> => c.type === "dialogue",
    );
    return {
      speaker: d.speaker,
      chosen,
      free_text: d.free_text,
      ...(reply
        ? {
            npc_reply:
              reply.text.length > 300 ? `${reply.text.slice(0, 300)}…` : reply.text,
          }
        : {}),
    };
  });
  return {
    session_id: state.session_id,
    game_id: state.game_id,
    world: state.world,
    player: state.player,
    story_so_far: state.story_so_far,
    current_scene_id: state.world.active_scene_id,
    entities: state.entities.map((e) => ({
      id: e.id,
      type: e.type,
      name: typeof e.data.name === "string" ? e.data.name : undefined,
      scene_id: e.scene_id,
      position: e.position,
      spawn_reason: e.spawn_reason,
    })),
    recent_dialogues: recent,
    rooms_visited: Object.keys(state.scenes_loaded).length,
    ...(state.ambient_log.length ? { ambient_events: state.ambient_log.slice(-10) } : {}),
    ...activeSceneAnalysis(state),
    ...(state.plugins.length
      ? {
          plugins: buildPluginLlmViews(
            {
              plugins: state.plugins,
              world: state.world,
              player: state.player,
              entities: state.entities,
            },
            manifests,
          ),
        }
      : {}),
  };
}

/** Resumen compacto del análisis de imagen del tile ACTIVO para el LLM
 *  (máx 20 elementos como strings legibles) — el mapa REAL pintado, que
 *  puede incluir estructuras que no están en el esquema. */
function activeSceneAnalysis(state: NarrativeState): Pick<LlmContext, "scene_analysis"> {
  const rec = state.scenes_loaded[state.world.active_scene_id];
  const analysis = rec?.analysis;
  if (!analysis || analysis.elements.length === 0) return {};
  const fmt = (n: number): string => String(Math.round(n));
  const elements = analysis.elements.slice(0, 20).map((e) => {
    const traits = [e.solid ? "sólido" : "", e.tall ? "alto" : ""].filter(Boolean).join(", ");
    return `${e.label}${traits ? ` (${traits})` : ""} ` +
      `x[${fmt(e.rect.minX)}..${fmt(e.rect.maxX)}] z[${fmt(e.rect.minZ)}..${fmt(e.rect.maxZ)}]`;
  });
  return {
    scene_analysis: {
      scene_id: state.world.active_scene_id,
      elements,
      total: analysis.elements.length,
    },
  };
}
