/** Lazy image cache for AI-generated 2D sprites served by ai_server.
 *
 * The ai_server `/generate_sprite` endpoint stores PNGs at
 * `/cache/sprite/{hash}` keyed by (prompt, angle, style_token). When a scene
 * arrives with `texture_hash`/`sprite_hash` references, we fetch them from
 * here and reuse them across renders.
 */
export class AssetCache {
  private images = new Map<string, HTMLImageElement>();

  constructor(private baseUrl: string = "http://127.0.0.1:8765") {}

  /** Synchronous getter — returns the image only if it has finished decoding.
   * On first call for a hash it kicks off the download in the background, so
   * a few render frames later the same call will return the loaded image. */
  getSpriteByHash(hash: string): HTMLImageElement | null {
    if (!hash) return null;
    const existing = this.images.get(hash);
    if (existing) {
      return existing.complete && existing.naturalWidth > 0 ? existing : null;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `${this.baseUrl}/cache/sprite/${hash}`;
    img.addEventListener("error", () => {
      // Drop the entry so a later call retries.
      this.images.delete(hash);
    });
    this.images.set(hash, img);
    return null;
  }

  /** Draw a hashed sprite at (cx, cy) anchored on its bottom-center. Returns
   * true when something was drawn, false if the image is still loading and
   * the caller should fall back to a placeholder. */
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
    const w = opts.widthPx ?? img.naturalWidth * scale;
    const h = opts.heightPx ?? img.naturalHeight * scale;
    ctx.drawImage(img, cx - w / 2, cy - h * 0.85, w, h);
    return true;
  }
}
