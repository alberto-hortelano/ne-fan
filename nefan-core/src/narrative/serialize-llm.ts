/** Proyección del NarrativeState al contexto del motor narrativo (LlmContext).
 *
 *  Extraída de la clase para que el "qué ve el LLM en cada turno" viva en un
 *  módulo propio: diálogos recientes con la réplica del NPC, entities
 *  compactas, análisis de imagen del tile activo y vistas de plugins. La
 *  clase delega aquí desde su método público serializeForLlm(). */
import type { NarrativeState } from "./narrative-state.js";
import type { Consequence, EntityRecord, LlmContext } from "./types.js";
import type { PluginManifest } from "../plugins/types.js";
import { buildPluginLlmViews } from "../plugins/views.js";

/** Cotas del contexto por turno: un playthrough largo no puede crecer el
 *  prompt sin límite (coste + degradación del modelo). El SAVE no se toca —
 *  las cotas viven solo en esta proyección; el detalle completo se pide con
 *  las tools (story_get la crónica, entity_list/entity_get las entidades). */
export const LLM_ENTITIES_MAX = 60;
export const LLM_STORY_MAX_CHARS = 6000;

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
  const entities = boundedEntities(state);
  return {
    session_id: state.session_id,
    game_id: state.game_id,
    world: state.world,
    player: state.player,
    story_so_far: boundedStory(state.story_so_far),
    current_scene_id: state.world.active_scene_id,
    entities: entities.map(compactEntity),
    ...(entities.length < state.entities.length
      ? { entities_total: state.entities.length }
      : {}),
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

function compactEntity(e: EntityRecord): LlmContext["entities"][number] {
  return {
    id: e.id,
    type: e.type,
    name: typeof e.data.name === "string" ? e.data.name : undefined,
    scene_id: e.scene_id,
    position: e.position,
    spawn_reason: e.spawn_reason,
  };
}

/** Selección acotada de entidades para el contexto: si caben todas, la lista
 *  completa (comportamiento previo intacto); si no, TODAS las de la escena
 *  activa primero y el hueco restante con las de spawn más reciente, emitidas
 *  en su orden cronológico original. `entities_total` avisa del recorte y la
 *  tool entity_list da el índice completo. */
function boundedEntities(state: NarrativeState): EntityRecord[] {
  const all = state.entities;
  if (all.length <= LLM_ENTITIES_MAX) return all;
  const active = state.world.active_scene_id;
  const picked = new Set<number>();
  all.forEach((e, i) => {
    if (e.scene_id === active) picked.add(i);
  });
  for (let i = all.length - 1; i >= 0 && picked.size < LLM_ENTITIES_MAX; i--) {
    picked.add(i);
  }
  // Si la escena activa por sí sola desborda el cap, se conservan sus más
  // recientes (las últimas spawneadas son las del hilo argumental vivo).
  return [...picked]
    .sort((a, b) => a - b)
    .slice(-LLM_ENTITIES_MAX)
    .map((i) => all[i]);
}

/** Crónica acotada: por debajo del cap va entera; por encima, solo la cola
 *  reciente cortada en límite de párrafo, con un marcador que remite a la
 *  tool story_get para el texto completo (el save conserva todo). */
function boundedStory(story: string): string {
  if (story.length <= LLM_STORY_MAX_CHARS) return story;
  let tail = story.slice(-LLM_STORY_MAX_CHARS);
  const brk = tail.indexOf("\n\n");
  if (brk >= 0 && brk + 2 < tail.length) tail = tail.slice(brk + 2);
  return (
    `[…earlier chronicle omitted (${story.length - tail.length} of ${story.length} chars) — ` +
    `call story_get for the full text]\n\n${tail}`
  );
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
