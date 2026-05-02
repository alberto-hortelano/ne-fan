/** Lazy image cache for AI-generated 2D sprites served by ai_server.
 *
 * The ai_server `/generate_sprite` endpoint stores PNGs at
 * `/cache/sprite/{hash}` keyed by (prompt, angle, style_token). When a scene
 * arrives with `texture_hash`/`sprite_hash` references, we fetch them from
 * here and reuse them across renders. When a scene only has prompts (the
 * common case for narrative-generated worlds), call `requestSprite` to ask
 * ai_server to produce one and remember the resulting hash.
 */
export interface SpriteRequestOptions {
  angle?: string;
  styleToken?: string;
  width?: number;
  height?: number;
}

export class AssetCache {
  private images = new Map<string, HTMLImageElement>();
  private failedHashes = new Set<string>();
  private hashByPromptKey = new Map<string, Promise<string | null>>();

  constructor(private baseUrl: string = "http://127.0.0.1:8765") {}

  /** Ask ai_server to render (or look up) a sprite for `prompt` at `angle`.
   * Returns the hash so the caller can stash it on an entity for `drawByHash`.
   * Identical (prompt, angle, styleToken) requests share an inflight promise. */
  async requestSprite(prompt: string, opts: SpriteRequestOptions = {}): Promise<string | null> {
    if (!prompt) return null;
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
          this.hashByPromptKey.delete(key);
          return null;
        }
        const data = (await res.json()) as { hash?: string; error?: string };
        if (!data.hash) {
          this.hashByPromptKey.delete(key);
          return null;
        }
        return data.hash;
      } catch (err) {
        console.warn("AssetCache.requestSprite failed:", (err as Error).message);
        this.hashByPromptKey.delete(key);
        return null;
      }
    })();
    this.hashByPromptKey.set(key, promise);
    return promise;
  }

  /** Synchronous getter — returns the image only if it has finished decoding.
   * On first call for a hash it kicks off the download in the background, so
   * a few render frames later the same call will return the loaded image. */
  getSpriteByHash(hash: string): HTMLImageElement | null {
    if (!hash) return null;
    if (this.failedHashes.has(hash)) return null;
    const existing = this.images.get(hash);
    if (existing) {
      return existing.complete && existing.naturalWidth > 0 ? existing : null;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `${this.baseUrl}/cache/sprite/${hash}`;
    img.addEventListener("error", () => {
      // Cache the failure so we don't spam ai_server at 60 FPS.
      this.failedHashes.add(hash);
      this.images.delete(hash);
    });
    this.images.set(hash, img);
    return null;
  }

  /** Draw a hashed sprite at (cx, cy) anchored on its bottom-center. Returns
   * true when something was drawn, false if the image is still loading and
   * the caller should fall back to a placeholder. When only `widthPx` is
   * supplied the image height is derived from its aspect ratio so AI sprites
   * (any resolution / shape) draw at a coherent size. */
  drawByHash(
    ctx: CanvasRenderingContext2D,
    hash: string,
    cx: number,
    cy: number,
    opts: { scale?: number; widthPx?: number; heightPx?: number } = {},
  ): boolean {
    const img = this.getSpriteByHash(hash);
    if (!img) return false;
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
