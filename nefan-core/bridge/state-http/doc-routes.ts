/** Lo que el motor narrativo lee y sella de la sesión bajo demanda: el
 *  documento del mundo, la guía de UI, la crónica, el vocabulario canónico y
 *  la agenda del director. Todas exigen sesión activa. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadWorldDoc } from "../../src/games/loader.js";
import {
  WORLD_VOCABULARY_SCHEMA_VERSION,
  writeWorldVocabulary,
} from "../../src/games/vocabulary.js";
import { VocabularySetRequestSchema } from "../../src/contracts/request-schemas.js";
import type {
  ScheduledEventResolveResponse,
  StoryResponse,
  UiDocResponse,
  VocabularySetResponse,
  WorldDocResponse,
} from "../../src/contracts/world-state.js";
import { bad, mutated, notFound, ok, parseBody } from "./context.js";
import type { RouteGroup } from "./routes.js";

/** Documento canónico de sistemas de UI (compartido con el resto de prompts
 *  del contrato) — lo sirve GET /ui_doc para la tool MCP ui_doc_get. */
const UI_SYSTEMS_DOC = fileURLToPath(
  new URL("../../data/contract/prompts/ui_systems.md", import.meta.url),
);

export const docRoutes = {
  getWorldDoc: (ctx) => {
    const { narrative } = ctx;
    if (!narrative.session_id || !narrative.game_id) {
      return notFound("no active session — world_doc belongs to a game session");
    }
    try {
      return ok({
        game_id: narrative.game_id,
        world_name: narrative.world.name,
        world_doc: loadWorldDoc(ctx.gamesDir, narrative.game_id),
      } satisfies WorldDocResponse);
    } catch (err) {
      return notFound(`world.md unavailable for "${narrative.game_id}": ${(err as Error).message}`);
    }
  },

  /** El doc canónico + el estado ACTIVO de la sesión: qué modo/combate están
   *  congelados y qué plugins corren — el motor adapta su salida a lo activo,
   *  nunca lo cambia. */
  getUiDoc: (ctx) => {
    const { narrative } = ctx;
    if (!narrative.session_id) {
      return notFound("no active session — ui_doc describes a running session's UI");
    }
    try {
      return ok({
        ui_state: {
          render_mode: narrative.world.render_mode || "image",
          combat_system: narrative.world.combat_system || "standard",
          style_id: narrative.world.style_id,
          plugins: ctx.plugins.list(),
        },
        ui_doc: readFileSync(UI_SYSTEMS_DOC, "utf-8"),
      } satisfies UiDocResponse);
    } catch (err) {
      return notFound(`ui_systems.md unavailable: ${(err as Error).message}`);
    }
  },

  /** La crónica COMPLETA (tool MCP story_get) — el contexto por turno solo
   *  inline la cola reciente cuando story_so_far supera su cota. */
  getStory: (ctx) => {
    const { narrative } = ctx;
    if (!narrative.session_id) {
      return notFound("no active session — the story belongs to a game session");
    }
    return ok({
      session_id: narrative.session_id,
      story_so_far: narrative.story_so_far,
      total_chars: narrative.story_so_far.length,
    } satisfies StoryResponse);
  },

  /** Vocabulario canónico (tool MCP vocabulary_set, génesis generate_game). */
  setVocabulary: (ctx, { body }) => {
    const { narrative } = ctx;
    if (!narrative.session_id || !narrative.game_id) {
      return notFound("no active session — vocabulary belongs to a game session");
    }
    const parsed = parseBody(VocabularySetRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    try {
      writeWorldVocabulary(ctx.gamesDir, {
        schema_version: WORLD_VOCABULARY_SCHEMA_VERSION,
        game_id: narrative.game_id,
        world_doc_hash: narrative.world.world_doc_hash,
        generated_at: new Date().toISOString(),
        entries: parsed.data.entries,
      });
      return mutated({
        ok: true,
        game_id: narrative.game_id,
        count: parsed.data.entries.length,
      } satisfies VocabularySetResponse);
    } catch (err) {
      return bad((err as Error).message);
    }
  },

  /** Agenda del director (tool MCP scheduled_event_resolve): retira de la
   *  agenda un schedule_event ya disparado u obsoleto. */
  resolveScheduledEvent: (ctx, { params }) => {
    const { narrative } = ctx;
    const resolved = narrative.resolveScheduledEvent(params.id);
    if (!resolved) {
      return notFound(
        `scheduled event "${params.id}" not found — pending ids: ` +
          `[${narrative.scheduled_events.map((e) => e.id).join(", ")}]`,
      );
    }
    return mutated({
      ok: true,
      id: params.id,
      remaining: narrative.scheduled_events.length,
    } satisfies ScheduledEventResolveResponse);
  },
} satisfies RouteGroup;
