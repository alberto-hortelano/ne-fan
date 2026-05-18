/** Lazy image cache for AI-generated 2D sprites served by ai_server.
 *
 * The ai_server `/generate_sprite` endpoint stores PNGs at
 * `/cache/sprite/{hash}` keyed by (prompt, angle, style_token). When a scene
 * arrives with `texture_hash`/`sprite_hash` references, we fetch them from
 * here and reuse them across renders. When a scene only has prompts (the
 * common case for narrative-generated worlds), call `requestSprite` to ask
 * ai_server to produce one and remember the resulting hash.
 *
 * No silent fallbacks: any failure throws and pushes to the ErrorLog. There
 * is no `failedHashes` blacklist that pretends a hash never existed. The
 * caller must gate use behind CONFIG.graphics.ai_sprites.
 */
import { errors } from "../ui/error-log.js";

export const SPRITE_PENDING = Symbol("hashed-sprite-pending");
export type HashedImageResult = HTMLImageElement | typeof SPRITE_PENDING;

export interface SpriteRequestOptions {
  angle?: string;
  styleToken?: string;
  width?: number;
  height?: number;
}

export class AssetCache {
  private images = new Map<string, HTMLImageElement>();
  private hashByPromptKey = new Map<string, Promise<string>>();

  constructor(private baseUrl: string = "http://127.0.0.1:8765") {}

  /** Ask ai_server to render (or look up) a sprite for `prompt` at `angle`.
   * Returns the hash so the caller can stash it on an entity for `drawByHash`.
   * Identical (prompt, angle, styleToken) requests share an inflight promise.
   * Throws on HTTP failure or missing hash in the response. */
  async requestSprite(prompt: string, opts: SpriteRequestOptions = {}): Promise<string> {
    if (!prompt) {
      const msg = "AssetCache.requestSprite called with empty prompt";
      errors.push("sprite", msg);
      throw new Error(msg);
    }
    const angle = opts.angle ?? "top_down";
    const styleToken = opts.styleToken ?? "";
    const key = `${angle}|${styleToken}|${prompt}`;
    const existing = this.hashByPromptKey.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/generate_sprite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            angle,
            style_token: opts.styleToken,
            width: opts.width ?? 256,
            height: opts.height ?? 256,
          }),
        });
        if (!res.ok) {
          throw new Error(`ai_server /generate_sprite HTTP ${res.status}`);
        }
        const data = (await res.json()) as { hash?: string; error?: string };
        if (!data.hash) {
          throw new Error(`ai_server /generate_sprite returned no hash: ${data.error ?? "unknown"}`);
        }
        return data.hash;
      } catch (err) {
        errors.push("sprite", `requestSprite failed (${prompt.slice(0, 40)})`, err);
        this.hashByPromptKey.delete(key);
        throw err;
      }
    })();
    this.hashByPromptKey.set(key, promise);
    return promise;
  }

  /** Returns the image, SPRITE_PENDING if still decoding. Throws on hard
   * failures (404, MIME). On first call for a hash it kicks off the
   * download in the background. */
  getSpriteByHash(hash: string): HashedImageResult {
    if (!hash) {
      const msg = "AssetCache.getSpriteByHash called with empty hash";
      errors.push("sprite", msg);
      throw new Error(msg);
    }
    const existing = this.images.get(hash);
    if (existing) {
      if (!existing.complete) return SPRITE_PENDING;
      if (existing.naturalWidth === 0) {
        const msg = `hashed sprite ${hash} failed to decode (${existing.src})`;
        errors.push("sprite", msg);
        throw new Error(msg);
      }
      return existing;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `${this.baseUrl}/cache/sprite/${hash}`;
    img.addEventListener("error", () => {
      errors.push("sprite", `hashed sprite ${hash} failed to load (${img.src})`);
    });
    this.images.set(hash, img);
    return SPRITE_PENDING;
  }

  /** Draw a hashed sprite at (cx, cy) anchored on its bottom-center. Returns
   * true on success, false ONLY when the image is still decoding (transient).
   * Throws on hard failures (404, MIME) — no placeholder substitution. */
  drawByHash(
    ctx: CanvasRenderingContext2D,
    hash: string,
    cx: number,
    cy: number,
    opts: { scale?: number; widthPx?: number; heightPx?: number } = {},
  ): boolean {
    const img = this.getSpriteByHash(hash);
    if (img === SPRITE_PENDING) return false;
    const scale = opts.scale ?? 1;
    const naturalRatio = img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1;
    let w: number;
    let h: number;
    if (opts.widthPx !== undefined && opts.heightPx === undefined) {
      w = opts.widthPx;
      h = opts.widthPx * naturalRatio;
    } else if (opts.heightPx !== undefined && opts.widthPx === undefined) {
      h = opts.heightPx;
      w = opts.heightPx / Math.max(naturalRatio, 0.001);
    } else {
      w = opts.widthPx ?? img.naturalWidth * scale;
      h = opts.heightPx ?? img.naturalHeight * scale;
    }
    ctx.drawImage(img, cx - w / 2, cy - h * 0.85, w, h);
    return true;
  }
}
