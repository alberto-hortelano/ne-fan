/** HTTP client for ai_server narrative endpoints.
 *
 * Single source of truth for narrative HTTP calls from the bridge
 * (both clients talk to the bridge, never to ai_server directly).
 */
import type { Consequence, LlmContext } from "./types.js";

export interface AiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SceneGenerationResult {
  ok: boolean;
  scene?: Record<string, unknown>;
  error?: string;
}

export interface SkinGenerationResult {
  ok: boolean;
  hash?: string;
  cached?: boolean;
  skin_url?: string;
  error?: string;
}

export interface SpriteGenerationResult {
  ok: boolean;
  hash?: string;
  cached?: boolean;
  sprite_url?: string;
  error?: string;
}

export type ReportPlayerChoiceResult =
  | { ok: true; consequences: Consequence[] }
  | { ok: false; error: string };

export type SpriteAngle = "top_down" | "isometric_45" | "isometric_30" | "frontal";

export class AiClient {
  private baseUrl: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(opts: AiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "http://127.0.0.1:8765";
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async health(): Promise<{ ok: boolean; status?: string }> {
    try {
      const res = await this.request("GET", "/health", undefined, 3_000);
      if (!res.ok) return { ok: false };
      const data = (await res.json()) as { status?: string };
      return { ok: true, status: data.status };
    } catch {
      return { ok: false };
    }
  }

  async notifySessionStart(sessionId: string, gameId: string, isResume: boolean): Promise<boolean> {
    try {
      const res = await this.request("POST", "/notify_session", {
        session_id: sessionId,
        game_id: gameId,
        is_resume: isResume,
      }, 5_000);
      return res.ok;
    } catch (err) {
      console.warn("AiClient.notifySessionStart failed:", (err as Error).message);
      return false;
    }
  }

  async generateScene(context: LlmContext): Promise<SceneGenerationResult> {
    try {
      // Long timeout: ai_server waits up to ~300s for the LLM (Claude Code Max
      // can take several minutes when reasoning). Add a margin on top.
      const res = await this.request("POST", "/generate_scene", context, 360_000);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 2000)}` : ""}` };
      }
      const data = (await res.json()) as Record<string, unknown>;
      return { ok: true, scene: data };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Report a player dialogue choice to the narrative engine and return the
   *  consequences it emits. Result is a discriminated union so callers can
   *  distinguish "the LLM had nothing to add" (`ok=true, consequences=[]`)
   *  from "the LLM call failed" (`ok=false, error=...`) — the bridge propagates
   *  the latter as `narrative_status: error` instead of pretending nothing
   *  happened. */
  async reportPlayerChoice(payload: {
    eventId: string;
    speaker: string;
    chosenText: string;
    freeText: string;
    context: LlmContext;
  }): Promise<ReportPlayerChoiceResult> {
    try {
      const res = await this.request("POST", "/report_player_choice", {
        event_id: payload.eventId,
        speaker: payload.speaker,
        chosen_text: payload.chosenText,
        free_text: payload.freeText,
        context: payload.context,
      }, 120_000);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          ok: false,
          error: `HTTP ${res.status}${body ? `: ${body.slice(0, 2000)}` : ""}`,
        };
      }
      const data = (await res.json()) as { consequences?: Consequence[] };
      return {
        ok: true,
        consequences: Array.isArray(data.consequences) ? data.consequences : [],
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Pide al motor narrativo que complete/desarrolle el borrador de mundo de
   *  un jugador contra la plantilla de 10 secciones. Tarda como un bootstrap
   *  (~1-3 min): timeout largo. */
  async developWorld(draftText: string): Promise<
    | { ok: true; game: { game_id: string; title: string; description: string; style_id: string; world_brief: string; world_md: string } }
    | { ok: false; error: string }
  > {
    try {
      const res = await this.request("POST", "/develop_world", { draft_text: draftText }, 360_000);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 2000)}` : ""}` };
      }
      const data = (await res.json()) as {
        game?: { game_id: string; title: string; description: string; style_id: string; world_brief: string; world_md: string };
      };
      if (!data.game) return { ok: false, error: "develop_world returned no game" };
      return { ok: true, game: data.game };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async generateSprite2D(opts: {
    prompt: string;
    angle?: SpriteAngle;
    width?: number;
    height?: number;
    styleToken?: string;
  }): Promise<SpriteGenerationResult> {
    try {
      const res = await this.request("POST", "/generate_sprite", {
        prompt: opts.prompt,
        angle: opts.angle ?? "top_down",
        width: opts.width ?? 256,
        height: opts.height ?? 256,
        style_token: opts.styleToken,
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as { hash?: string; cached?: boolean; sprite_url?: string };
      return { ok: true, hash: data.hash, cached: data.cached, sprite_url: data.sprite_url };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Probe whether a cached asset is still present in the server manifest.
   *  Returns true on 200, false on 404. Throws for other HTTP errors or
   *  network failures — caller decides how to treat the uncertainty. */
  async assetExists(hash: string): Promise<boolean> {
    const res = await this.request("GET", `/assets/by_hash/${encodeURIComponent(hash)}`, undefined, 5_000);
    if (res.ok) return true;
    if (res.status === 404) return false;
    throw new Error(`assetExists ${hash}: HTTP ${res.status}`);
  }

  async generateSkin(opts: {
    prompt: string;
    strength?: number;
    gamma?: number;
  }): Promise<SkinGenerationResult> {
    try {
      const res = await this.request("POST", "/generate_skin", opts);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as { hash?: string; cached?: boolean; skin_url?: string };
      return { ok: true, hash: data.hash, cached: data.cached, skin_url: data.skin_url };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<Response> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs ?? this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
