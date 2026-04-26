/** Loads pre-rendered Mixamo sprite sheets and serves the right frame for a
 * given (animation, facing direction, time) tuple.
 *
 * Sheet layout on disk (produced by tools/render_sprite_sheets.py):
 *   public/sprites/{model}/{anim}/{angle}/dir_{D}_frame_{F:03}.png
 *   public/sprites/{model}/{anim}/{angle}/meta.json
 *
 * Vite serves `public/` at the site root, so URLs are `/sprites/...`.
 */
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
  private cache = new Map<string, SpriteSheet>();
  private inflight = new Map<string, Promise<SpriteSheet | null>>();

  constructor(private baseUrl: string = "/sprites") {}

  /** Fetch meta.json and start loading every frame image. Subsequent calls for
   * the same triple resolve to the cached sheet. */
  async loadAnimation(model: string, anim: string, angle: string): Promise<SpriteSheet | null> {
    const key = `${model}/${anim}/${angle}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.fetchSheet(model, anim, angle, key);
    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchSheet(
    model: string,
    anim: string,
    angle: string,
    key: string,
  ): Promise<SpriteSheet | null> {
    try {
      const metaUrl = `${this.baseUrl}/${model}/${anim}/${angle}/meta.json`;
      const res = await fetch(metaUrl);
      if (!res.ok) {
        this.inflight.delete(key);
        return null;
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
      this.inflight.delete(key);
      return sheet;
    } catch (err) {
      console.warn(`SpriteRenderer: load failed for ${key}:`, err);
      this.inflight.delete(key);
      return null;
    }
  }

  /** Returns the sheet synchronously if already cached. Triggers a background
   * load on first miss so subsequent frames find it ready. */
  getCached(model: string, anim: string, angle: string): SpriteSheet | null {
    const key = `${model}/${anim}/${angle}`;
    const sheet = this.cache.get(key);
    if (sheet) return sheet;
    if (!this.inflight.has(key)) {
      void this.loadAnimation(model, anim, angle);
    }
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

  /** Returns the image for the right (direction, frame). null if not ready. */
  pickImage(sheet: SpriteSheet, dir: number, frame: number): HTMLImageElement | null {
    const dirFrames = sheet.frames[dir];
    if (!dirFrames) return null;
    const img = dirFrames[frame];
    if (!img) return null;
    if (!img.complete || img.naturalWidth === 0) return null;
    return img;
  }

  /** High-level draw: place a model at (cx, cy) facing forward, time t since
   * the animation started. Returns true if a frame was drawn (false → caller
   * should fall back to a placeholder). The image is drawn centered horizontally
   * and anchored at the bottom (feet on cy) so characters stand on the cell. */
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
    if (!img) return false;
    const scale = opts.scale ?? 1;
    const w = sheet.frame_width * scale;
    const h = sheet.frame_height * scale;
    ctx.drawImage(img, cx - w / 2, cy - h * 0.85, w, h);
    return true;
  }
}
