/** Loads pre-rendered Mixamo sprite sheets and serves the right frame for a
 * given (animation, facing direction, time) tuple.
 *
 * Sheet layout on disk (produced by tools/render_sprite_sheets.py):
 *   public/sprites/{model}/{anim}/{angle}/dir_{D}_frame_{F:03}.png
 *   public/sprites/{model}/{anim}/{angle}/meta.json
 *
 * Vite serves `public/` at the site root, so URLs are `/sprites/...`.
 *
 * No silent fallbacks: when a sheet/skin can't be loaded the API throws and
 * the ErrorLog records the cause. The caller decides whether to surface it.
 */
import { errors } from "../ui/error-log.js";

/** A frame that hasn't decoded yet. Distinct from `null`, which would mean
 *  "no such frame exists" — load failures throw rather than return null. */
export const SPRITE_PENDING = Symbol("sprite-pending");
export type SpriteImageResult = HTMLImageElement | typeof SPRITE_PENDING;
export interface SpriteSheetMeta {
  model: string;
  anim: string;
  angle: string;
  directions: number;
  frame_count: number;
  fps: number;
  duration: number;
  frame_width: number;
  frame_height: number;
}

export interface SpriteSheet extends SpriteSheetMeta {
  /** frames[dir][frame] — image objects start loading on construction. */
  frames: HTMLImageElement[][];
}

const ANIM_LOOPS: ReadonlySet<string> = new Set([
  "idle",
  "walk",
  "run",
  "talking",
  "drinking",
  "wounded_idle",
  "sitting_idle",
  "waving",
  "praying",
]);

export class SpriteRenderer {
  /** Estilo visual de la sesión activa (world.style_id); "" ⇒ el servidor
   *  skinnea sin referencia de estilo del juego. */
  private styleId = "";

  private cache = new Map<string, SpriteSheet>();
  private inflight = new Map<string, Promise<SpriteSheet>>();
  private skinInflight = new Map<string, Promise<SpriteSheet>>();

  constructor(
    private baseUrl: string = "/sprites",
    private aiServerUrl: string = "http://127.0.0.1:8765",
  ) {}

  /** Fija el estilo del juego activo. Cambiarlo invalida el cache local de
   *  skins: el mismo prompt con otro estilo es otra imagen. */
  setStyle(styleId: string): void {
    if (styleId === this.styleId) return;
    this.styleId = styleId;
    this.cache.clear();
    this.skinInflight.clear();
  }

  /** Fetch meta.json and start loading every frame image. Subsequent calls for
   * the same triple resolve to the cached sheet. Throws on any failure — no
   * silent null returns. */
  async loadAnimation(model: string, anim: string, angle: string): Promise<SpriteSheet> {
    const key = `${model}/${anim}/${angle}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.fetchSheet(model, anim, angle, key);
    this.inflight.set(key, promise);
    return promise;
  }

  /** A model name that points to the skinned variant of a sheet, when the
   *  variant has finished loading. Returns the bare model only when no
   *  skin was requested. If a skin was requested but the skinned sheet
   *  isn't cached yet, throws — callers must `await loadSkinnedAnimation`
   *  before relying on this. */
  skinnedKey(model: string, skinPrompt: string): string {
    if (!skinPrompt) return model;
    const skinned = this.skinKey(model, skinPrompt);
    if (!this.cache.has(`${skinned}/idle/isometric_30`)) {
      const msg = `skinned sheet not loaded: ${skinned}/idle/isometric_30 — call loadSkinnedAnimation first`;
      errors.push("sprite", msg);
      throw new Error(msg);
    }
    return skinned;
  }

  /** Ask ai_server to img2img each frame of a Mixamo sheet with the given
   *  character prompt and register the result under a synthetic model name.
   *  Throws on HTTP failure or invalid response shape — no silent nulls. */
  async loadSkinnedAnimation(
    baseModel: string,
    anim: string,
    angle: string,
    skinPrompt: string,
  ): Promise<SpriteSheet> {
    if (!skinPrompt) {
      const msg = "loadSkinnedAnimation called with empty skinPrompt";
      errors.push("sprite", msg);
      throw new Error(msg);
    }
    const skinnedModel = this.skinKey(baseModel, skinPrompt);
    const cacheKey = `${skinnedModel}/${anim}/${angle}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const pending = this.skinInflight.get(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const res = await fetch(`${this.aiServerUrl}/skin_sprite_sheet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: baseModel,
            anim,
            angle,
            prompt: skinPrompt,
            style_id: this.styleId,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          const err = new Error(
            `ai_server /skin_sprite_sheet HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
          ) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        const data = (await res.json()) as { ok?: boolean; meta?: SpriteSheetMeta; frame_urls?: string[][]; error?: string };
        if (!data.ok || !data.meta || !data.frame_urls) {
          throw new Error(`ai_server /skin_sprite_sheet bad response: ${data.error ?? "missing meta/frame_urls"}`);
        }
        const meta = data.meta;
        const frames: HTMLImageElement[][] = data.frame_urls.map((dir) => dir.map((url) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = url.startsWith("http") ? url : `${this.aiServerUrl}${url}`;
          return img;
        }));
        const sheet: SpriteSheet = { ...meta, model: skinnedModel, frames };
        this.cache.set(cacheKey, sheet);
        return sheet;
      } catch (err) {
        // Sin errors.push aquí: character-sprites registra el fallo UNA vez
        // con contexto (y decide desactivar los skins de la sesión) — loguear
        // en ambas capas duplicaba cada fallo en consola.
        throw err;
      } finally {
        this.skinInflight.delete(cacheKey);
      }
    })();
    this.skinInflight.set(cacheKey, promise);
    return promise;
  }

  /** Synthetic model id for the skinned variant of `model` — public so
   *  CharacterSpriteManager can resolve per-frame which model to draw. */
  skinKey(model: string, skinPrompt: string): string {
    // Encode the prompt into the synthetic model id so identical (model,
    // prompt) pairs share the cache. The SpriteRenderer never reads this
    // string — it's only a key — so keeping it human-readable is fine.
    const slug = skinPrompt.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
    // El estilo entra en la clave: el mismo personaje con otro style pack es
    // otra imagen (el cache local no debe cruzar estilos).
    return this.styleId ? `${model}__${this.styleId}__${slug}` : `${model}__${slug}`;
  }

  private async fetchSheet(
    model: string,
    anim: string,
    angle: string,
    key: string,
  ): Promise<SpriteSheet> {
    try {
      const metaUrl = `${this.baseUrl}/${model}/${anim}/${angle}/meta.json`;
      const res = await fetch(metaUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} on ${metaUrl}`);
      }
      // Vite serves `index.html` for unknown routes with HTTP 200, so we
      // can't rely on `res.ok` alone — confirm the body is JSON before parsing.
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error(`non-JSON response for ${metaUrl} (content-type: ${ct})`);
      }
      const meta = (await res.json()) as SpriteSheetMeta;
      const frames: HTMLImageElement[][] = [];
      for (let d = 0; d < meta.directions; d++) {
        const dirFrames: HTMLImageElement[] = [];
        for (let f = 0; f < meta.frame_count; f++) {
          const fStr = String(f).padStart(3, "0");
          const url = `${this.baseUrl}/${model}/${anim}/${angle}/dir_${d}_frame_${fStr}.png`;
          const img = new Image();
          img.src = url;
          dirFrames.push(img);
        }
        frames.push(dirFrames);
      }
      const sheet: SpriteSheet = { ...meta, frames };
      this.cache.set(key, sheet);
      return sheet;
    } catch (err) {
      errors.push("sprite", `sheet load failed for ${key}`, err);
      throw err;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Whether the sheet is fully cached and ready to draw. Unlike `getCached`
   *  this never throws: "not requested" and "mid-load" both return false.
   *  Used to decide per-frame whether a skinned variant can replace the base. */
  hasCached(model: string, anim: string, angle: string): boolean {
    return this.cache.has(`${model}/${anim}/${angle}`);
  }

  /** Returns the sheet synchronously if already cached; null mid-load (the
   *  frame se re-renderiza al tick siguiente cuando decodifique). Si nadie
   *  llamó a `loadAnimation` aún (p. ej. un NPC narrativo dibuja durante la
   *  ventana en que preloadBase todavía no pidió ese sheet), la ARRANCA aquí
   *  y devuelve null — un warning, nunca un throw: una excepción en el
   *  camino de render mataría el rAF y congelaría el juego entero. */
  getCached(model: string, anim: string, angle: string): SpriteSheet | null {
    const key = `${model}/${anim}/${angle}`;
    const sheet = this.cache.get(key);
    if (sheet) return sheet;
    if (this.inflight.has(key)) return null;
    // Carga lazy SILENCIOSA: es una carrera esperable (la entidad dibuja
    // antes de que la precarga pida este sheet) y se autocorrige al frame
    // siguiente — no es un error ni merece ruido en consola.
    this.loadAnimation(model, anim, angle).catch(() => {
      // fetchSheet ya registró el motivo; el catch evita unhandled rejection.
    });
    return null;
  }

  /** Map a forward XZ vector to one of `dirCount` discrete facings. Convention
   * matches sprite_sheet_renderer.gd: dir 0 corresponds to yaw=0, which is the
   * model's default Mixamo facing (+Z in Godot's left-handed Y-up frame). */
  pickDirection(forwardX: number, forwardZ: number, dirCount: number): number {
    if (dirCount <= 0) return 0;
    const yaw = Math.atan2(forwardX, forwardZ);
    const step = (2 * Math.PI) / dirCount;
    let dir = Math.round(yaw / step);
    dir = ((dir % dirCount) + dirCount) % dirCount;
    return dir;
  }

  /** Pick the right frame for a looping or one-shot animation given an elapsed
   * time `t` in seconds. */
  pickFrame(sheet: SpriteSheet, t: number, loop?: boolean): number {
    if (sheet.frame_count <= 0) return 0;
    const looping = loop ?? ANIM_LOOPS.has(sheet.anim);
    if (looping) {
      const totalFrames = sheet.frame_count;
      const idx = Math.floor(t * sheet.fps) % totalFrames;
      return idx < 0 ? idx + totalFrames : idx;
    }
    return Math.min(Math.max(0, Math.floor(t * sheet.fps)), sheet.frame_count - 1);
  }

  /** Returns the image, or SPRITE_PENDING if it's still decoding. Throws on
   *  hard failures (frame index out of range, image element marked complete
   *  but with naturalWidth 0 = 404/MIME error). */
  pickImage(sheet: SpriteSheet, dir: number, frame: number): SpriteImageResult {
    const dirFrames = sheet.frames[dir];
    if (!dirFrames) {
      const msg = `sprite ${sheet.model}/${sheet.anim}: direction ${dir} out of range (have ${sheet.frames.length})`;
      errors.push("sprite", msg);
      throw new Error(msg);
    }
    const img = dirFrames[frame];
    if (!img) {
      const msg = `sprite ${sheet.model}/${sheet.anim} dir=${dir}: frame ${frame} missing (have ${dirFrames.length})`;
      errors.push("sprite", msg);
      throw new Error(msg);
    }
    if (!img.complete) return SPRITE_PENDING;
    if (img.naturalWidth === 0) {
      const msg = `sprite ${sheet.model}/${sheet.anim} dir=${dir} frame=${frame} failed to decode (${img.src})`;
      errors.push("sprite", msg);
      throw new Error(msg);
    }
    return img;
  }

  /** High-level draw: place a model at (cx, cy) facing forward, time t since
   * the animation started. Returns true if a frame was drawn. Returns false
   * ONLY when the frame is still decoding (transient). On any hard failure
   * (404, MIME, missing frame) it throws — there is no placeholder. */
  draw(
    ctx: CanvasRenderingContext2D,
    sheet: SpriteSheet,
    forwardX: number,
    forwardZ: number,
    t: number,
    cx: number,
    cy: number,
    opts: { scale?: number; loop?: boolean } = {},
  ): boolean {
    const dir = this.pickDirection(forwardX, forwardZ, sheet.directions);
    const frame = this.pickFrame(sheet, t, opts.loop);
    const img = this.pickImage(sheet, dir, frame);
    if (img === SPRITE_PENDING) return false;
    const scale = opts.scale ?? 1;
    const w = sheet.frame_width * scale;
    const h = sheet.frame_height * scale;
    ctx.drawImage(img, cx - w / 2, cy - h * 0.85, w, h);
    return true;
  }
}
