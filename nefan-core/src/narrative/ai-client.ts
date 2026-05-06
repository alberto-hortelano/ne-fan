/** HTTP client for ai_server narrative endpoints.
 *
 * Replaces godot/scripts/autoloads/ai_client.gd and the inline fetch in
 * scenario-runner.ts. Single source of truth for both clients.
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
      const res = await this.request("POST", "/generate_scene", context);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as Record<string, unknown>;
      return { ok: true, scene: data };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Legacy room generation — kept for the closed-room scenarios still used in tests. */
  async generateRoom(context: LlmContext): Promise<SceneGenerationResult> {
    try {
      const res = await this.request("POST", "/generate_room", context);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as Record<string, unknown>;
      return { ok: true, scene: data };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async reportPlayerChoice(payload: {
    eventId: string;
    speaker: string;
    chosenText: string;
    freeText: string;
    context: LlmContext;
  }): Promise<Consequence[]> {
    try {
      const res = await this.request("POST", "/report_player_choice", {
        event_id: payload.eventId,
        speaker: payload.speaker,
        chosen_text: payload.chosenText,
        free_text: payload.freeText,
        context: payload.context,
      }, 120_000);
      if (!res.ok) return [];
      const data = (await res.json()) as { consequences?: Consequence[] };
      return Array.isArray(data.consequences) ? data.consequences : [];
    } catch (err) {
      console.warn("AiClient.reportPlayerChoice failed:", (err as Error).message);
      return [];
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
