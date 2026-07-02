/** Scene-image controller: drives AI generation of the top-down scene
 *  background for the 2D client.
 *
 *  - `generateFull` captures the schematic the renderer paints (terrain +
 *    object rectangles, no characters), sends it to ai_server `/generate_scene_image`
 *    (img2img + ControlNet canny), and installs the painted result as the scene
 *    background covering the same world rectangle (1:1, top-down).
 *  - `outpaintTowardPlayer` extends that image outward on the edge nearest the
 *    player via `/outpaint_scene_image`, growing the world bounds so the world
 *    gets richer terrain as you walk.
 *
 *  Collisions and SceneData are untouched — the image is purely visual. Fail
 *  loud: every failure goes to the ErrorLog and rejects; no silent placeholder.
 */
import { errors } from "../ui/error-log.js";
import type { CanvasRenderer, SceneBounds, Occluder } from "../renderer/canvas-renderer.js";

/** Scene objects that should occlude the player (tall, solid). Mirrors the set
 *  that blocks movement in main.ts `collidesAt` (buildings + props). */
const OCCLUDER_CATEGORIES = new Set(["building", "prop"]);

interface SegmentResponse {
  segments: {
    id: string;
    sprite_url: string;
    image_bbox: [number, number, number, number]; // [x, y, w, h] px
    img_w: number;
    img_h: number;
  }[];
}

/** Target longest side (px) of the captured schematic / generated image. */
const CAPTURE_LONG_SIDE = 640;
/** Pixels-per-metre clamp for the capture so tiny/huge scenes stay sane. */
const MIN_PPM = 6;
const MAX_PPM = 64;
/** Each outpaint grows the crossed axis by this fraction of its current extent. */
const OUTPAINT_FRACTION = 0.5;

type Side = "left" | "right" | "top" | "bottom";

/** Resultado de /review_scene_blueprint: Claude mira el blueprint y devuelve
 *  aprobación + issues + overrides parciales de la escena Format D. */
export interface BlueprintReview {
  approved: boolean;
  issues: string[];
  fixes?: {
    terrain?: string[];
    terrain_features?: Record<string, unknown>[];
    entity_moves?: { id: string; cell: [number, number] }[];
  };
}

interface SceneSummary {
  scene_description?: string;
  room_description?: string;
  zone_type?: string;
}

export class SceneImageController {
  private bounds: SceneBounds | null = null;
  private image: HTMLImageElement | null = null;
  private prompt = "";
  private busy = false;

  constructor(
    private renderer: CanvasRenderer,
    private baseUrl: string = "http://127.0.0.1:8765",
  ) {}

  /** Reset for a freshly loaded scene. `bounds` is the dims rectangle centred
   *  on the origin. Clears any previous background. */
  reset(bounds: SceneBounds, scene: SceneSummary | null): void {
    this.bounds = { ...bounds };
    this.image = null;
    this.prompt = this.buildPrompt(scene);
    this.renderer.clearSceneImage();
  }

  isBusy(): boolean {
    return this.busy;
  }

  hasImage(): boolean {
    return this.image !== null;
  }

  private buildPrompt(scene: SceneSummary | null): string {
    const desc = (scene?.scene_description ?? scene?.room_description ?? "").trim();
    const zone = (scene?.zone_type ?? "").trim();
    const parts = [desc || "an open wilderness clearing"];
    if (zone) parts.push(zone);
    return parts.join(", ");
  }

  private async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // needed so we can re-capture it for outpaint
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load scene image ${url}`));
      img.src = url;
    });
  }

  /** Compute pixels-per-metre so the longest side ≈ CAPTURE_LONG_SIDE. */
  private ppmFor(bounds: SceneBounds): number {
    const longMeters = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    if (longMeters <= 0) return MAX_PPM;
    return Math.max(MIN_PPM, Math.min(MAX_PPM, CAPTURE_LONG_SIDE / longMeters));
  }

  /** Re-export the current background image to a same-pixels PNG data URL so it
   *  can be sent back to the server for outpainting. Requires the image to have
   *  loaded cross-origin clean (it did — server sends ACAO:*). */
  private imageToDataUrl(img: HTMLImageElement): string {
    const off = document.createElement("canvas");
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("imageToDataUrl: no 2D context");
    ctx.drawImage(img, 0, 0);
    return off.toDataURL("image/png");
  }

  /** Capture the schematic of the current bounds and generate the scene image. */
  async generateFull(): Promise<void> {
    if (this.busy) {
      console.log("[scene-image] busy, ignoring G");
      return;
    }
    if (!this.bounds) {
      errors.push("scene", "generateFull called before reset() — no bounds");
      return;
    }
    this.busy = true;
    const bounds = { ...this.bounds };
    try {
      const ppm = this.ppmFor(bounds);
      const dataUrl = this.renderer.captureSchematic(bounds, ppm);
      const res = await fetch(`${this.baseUrl}/generate_scene_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: dataUrl, prompt: this.prompt }),
      });
      if (!res.ok) {
        throw new Error(`/generate_scene_image HTTP ${res.status}`);
      }
      const data = (await res.json()) as { hash?: string; scene_url?: string; error?: string };
      if (!data.scene_url) {
        throw new Error(`/generate_scene_image returned no scene_url: ${data.error ?? "unknown"}`);
      }
      const img = await this.loadImage(`${this.baseUrl}${data.scene_url}`);
      this.image = img;
      this.bounds = bounds;
      this.renderer.setSceneImage(img, bounds);
      console.log(`[scene-image] full generated (${img.naturalWidth}x${img.naturalHeight})`);
    } catch (err) {
      errors.push("scene", "generateFull failed", err);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** Captura el blueprint actual y pide a Claude (vía ai_server + MCP) que lo
   *  revise contra la escena Format D. No toca nada: devuelve el veredicto y
   *  el caller decide si aplica los fixes. Requiere terminal de Claude Code
   *  escuchando en el bridge (si no, el servidor responde 503 y aquí se
   *  reporta al ErrorLog). */
  async reviewBlueprint(scene: Record<string, unknown>): Promise<BlueprintReview> {
    if (this.busy) {
      throw new Error("scene-image controller busy");
    }
    if (!this.bounds) {
      errors.push("scene", "reviewBlueprint called before reset() — no bounds");
      throw new Error("no bounds");
    }
    this.busy = true;
    try {
      const bounds = { ...this.bounds };
      const dataUrl = this.renderer.captureSchematic(bounds, this.ppmFor(bounds));
      const sceneId = (scene.scene_id as string) || "unknown";
      const res = await fetch(`${this.baseUrl}/review_scene_blueprint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scene_id: sceneId,
          // El endpoint espera base64 puro; captureSchematic devuelve data URL.
          image_b64: dataUrl.replace(/^data:image\/png;base64,/, ""),
          scene,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`/review_scene_blueprint HTTP ${res.status}: ${detail.slice(0, 200)}`);
      }
      return (await res.json()) as BlueprintReview;
    } catch (err) {
      errors.push("scene", "reviewBlueprint failed", err);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** Outpaint toward the scene edge nearest the player (world XZ metres). */
  async outpaintTowardPlayer(player: { x: number; z: number }): Promise<void> {
    if (this.busy) {
      console.log("[scene-image] busy, ignoring O");
      return;
    }
    if (!this.image || !this.bounds) {
      errors.push("scene", "outpaint called with no scene image — press G first");
      return;
    }
    const side = this.nearestSide(player, this.bounds);
    this.busy = true;
    const img = this.image;
    const bounds = { ...this.bounds };
    try {
      const horizontal = side === "left" || side === "right";
      const extent = horizontal ? bounds.maxX - bounds.minX : bounds.maxZ - bounds.minZ;
      const addMeters = Math.max(8, extent * OUTPAINT_FRACTION);
      const imgDim = horizontal ? img.naturalWidth : img.naturalHeight;
      const expandPx = Math.max(64, Math.round((addMeters / extent) * imgDim));

      const dataUrl = this.imageToDataUrl(img);
      const res = await fetch(`${this.baseUrl}/outpaint_scene_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: dataUrl,
          side,
          expand_px: expandPx,
          prompt: this.prompt,
        }),
      });
      if (!res.ok) {
        throw new Error(`/outpaint_scene_image HTTP ${res.status}`);
      }
      const data = (await res.json()) as { hash?: string; scene_url?: string; error?: string };
      if (!data.scene_url) {
        throw new Error(`/outpaint_scene_image returned no scene_url: ${data.error ?? "unknown"}`);
      }

      // Grow bounds on the crossed side by the metres we asked the server to add.
      const grown: SceneBounds = { ...bounds };
      if (side === "left") grown.minX -= addMeters;
      else if (side === "right") grown.maxX += addMeters;
      else if (side === "top") grown.minZ -= addMeters;
      else grown.maxZ += addMeters;

      const newImg = await this.loadImage(`${this.baseUrl}${data.scene_url}`);
      this.image = newImg;
      this.bounds = grown;
      this.renderer.setSceneImage(newImg, grown);
      console.log(
        `[scene-image] outpaint ${side} +${addMeters.toFixed(1)}m ` +
        `(${newImg.naturalWidth}x${newImg.naturalHeight})`,
      );
    } catch (err) {
      errors.push("scene", `outpaint ${side} failed`, err);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** Segment the known occluders (buildings/props) out of the current scene
   *  image and install them as depth-sortable cutouts so they occlude the
   *  player. Each object's pixel box comes from its world footprint mapped 1:1
   *  onto the image; the server returns one RGBA sprite + tight bbox each. */
  async segmentOccluders(): Promise<Occluder[]> {
    if (this.busy) {
      console.log("[scene-image] busy, ignoring X");
      return [];
    }
    if (!this.image || !this.bounds) {
      errors.push("scene", "segment called with no scene image — press G first");
      return [];
    }
    const objects = this.renderer.getSceneData()?.objects ?? [];
    const occ = objects.filter((o) => OCCLUDER_CATEGORIES.has(o.category));
    if (occ.length === 0) {
      console.log("[scene-image] no building/prop occluders to segment");
      return [];
    }

    this.busy = true;
    const img = this.image;
    const b = { ...this.bounds };
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    try {
      // World footprint (position ± scale/2 on XZ) → pixel box in the image.
      const occluders = occ.map((o) => {
        const px = o.position?.[0] ?? 0;
        const pz = o.position?.[2] ?? 0;
        const sx = Math.max(0.2, o.scale?.[0] ?? 1);
        const sz = Math.max(0.2, o.scale?.[2] ?? 1);
        const x_min = Math.round(((px - sx / 2 - b.minX) / spanX) * W);
        const x_max = Math.round(((px + sx / 2 - b.minX) / spanX) * W);
        const y_min = Math.round(((pz - sz / 2 - b.minZ) / spanZ) * H);
        const y_max = Math.round(((pz + sz / 2 - b.minZ) / spanZ) * H);
        return { id: o.id, box_px: [x_min, y_min, x_max, y_max] };
      });

      const dataUrl = this.imageToDataUrl(img);
      const res = await fetch(`${this.baseUrl}/segment_scene_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: dataUrl, occluders }),
      });
      if (!res.ok) {
        throw new Error(`/segment_scene_image HTTP ${res.status}`);
      }
      const data = (await res.json()) as SegmentResponse;

      const built: Occluder[] = [];
      for (const seg of data.segments ?? []) {
        const sprite = await this.loadImage(`${this.baseUrl}${seg.sprite_url}`);
        const [bx, by, bw, bh] = seg.image_bbox;
        // Tight pixel bbox → world rectangle the cutout covers (1:1 mapping).
        const world: SceneBounds = {
          minX: b.minX + (bx / seg.img_w) * spanX,
          maxX: b.minX + ((bx + bw) / seg.img_w) * spanX,
          minZ: b.minZ + (by / seg.img_h) * spanZ,
          maxZ: b.minZ + ((by + bh) / seg.img_h) * spanZ,
        };
        built.push({ id: seg.id, img: sprite, world, baselineZ: world.maxZ });
      }
      this.renderer.setOccluders(built);
      console.log(`[scene-image] segmented ${built.length}/${occ.length} occluders`);
      return built;
    } catch (err) {
      errors.push("scene", "segmentOccluders failed", err);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** Phase 3: discover props the image model invented (not in the schematic)
   *  via SAM3 open-vocab, and add them as occluders. Returns the new occluders
   *  so the caller can also give them collision. `known_boxes` (the building/prop
   *  footprints) are sent so the server filters out objects we already handle. */
  async discoverObjects(): Promise<Occluder[]> {
    if (this.busy) {
      console.log("[scene-image] busy, ignoring N");
      return [];
    }
    if (!this.image || !this.bounds) {
      errors.push("scene", "discover called with no scene image — press G first");
      return [];
    }
    this.busy = true;
    const img = this.image;
    const b = { ...this.bounds };
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    try {
      // Pixel boxes of objects we already handle, so the server won't re-report them.
      const objects = this.renderer.getSceneData()?.objects ?? [];
      const knownBoxes = objects
        .filter((o) => OCCLUDER_CATEGORIES.has(o.category))
        .map((o) => {
          const px = o.position?.[0] ?? 0;
          const pz = o.position?.[2] ?? 0;
          const sx = Math.max(0.2, o.scale?.[0] ?? 1);
          const sz = Math.max(0.2, o.scale?.[2] ?? 1);
          return [
            Math.round(((px - sx / 2 - b.minX) / spanX) * W),
            Math.round(((pz - sz / 2 - b.minZ) / spanZ) * H),
            Math.round(((px + sx / 2 - b.minX) / spanX) * W),
            Math.round(((pz + sz / 2 - b.minZ) / spanZ) * H),
          ];
        });

      const dataUrl = this.imageToDataUrl(img);
      const res = await fetch(`${this.baseUrl}/discover_scene_objects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: dataUrl, known_boxes: knownBoxes }),
      });
      if (!res.ok) {
        throw new Error(`/discover_scene_objects HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        discovered: (SegmentResponse["segments"][number] & { score?: number; concept?: string })[];
      };

      const built: Occluder[] = [];
      for (const seg of data.discovered ?? []) {
        const sprite = await this.loadImage(`${this.baseUrl}${seg.sprite_url}`);
        const [bx, by, bw, bh] = seg.image_bbox;
        const world: SceneBounds = {
          minX: b.minX + (bx / seg.img_w) * spanX,
          maxX: b.minX + ((bx + bw) / seg.img_w) * spanX,
          minZ: b.minZ + (by / seg.img_h) * spanZ,
          maxZ: b.minZ + ((by + bh) / seg.img_h) * spanZ,
        };
        built.push({ id: seg.id, img: sprite, world, baselineZ: world.maxZ });
      }
      this.renderer.addOccluders(built);
      console.log(`[scene-image] discovered ${built.length} new props`);
      return built;
    } catch (err) {
      errors.push("scene", "discoverObjects failed", err);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** Pick the bounds edge the player is closest to (image-space side names). */
  private nearestSide(player: { x: number; z: number }, b: SceneBounds): Side {
    const dLeft = player.x - b.minX;
    const dRight = b.maxX - player.x;
    const dTop = player.z - b.minZ;
    const dBottom = b.maxZ - player.z;
    const min = Math.min(dLeft, dRight, dTop, dBottom);
    if (min === dLeft) return "left";
    if (min === dRight) return "right";
    if (min === dTop) return "top";
    return "bottom";
  }
}
