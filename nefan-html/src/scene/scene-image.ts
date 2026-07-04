/** Scene-image controller: drives AI generation of the top-down scene
 *  background for the 2D client, one TILE at a time (continuous world).
 *
 *  - `generateForTile` captures the schematic the renderer paints for that
 *    tile's rect (terrain + object rectangles, no characters), sends it to
 *    ai_server `/generate_scene_image` and installs the painted result as the
 *    tile's background (1:1, top-down).
 *  - `segmentOccludersForTile` / `discoverObjectsForTile` cut z-sortable
 *    sprites out of the tile's image (known footprints / SAM3 discovery).
 *
 *  All operations are keyed by tile: crossing tiles mid-generation is
 *  harmless — the result lands on the tile it was requested for. A single
 *  `busy` flag serialises calls (Meshy in series), shared by the manual keys
 *  (G/X/N) and the auto pipeline. Collisions and SceneData are untouched —
 *  the image is purely visual. Fail loud: every failure goes to the ErrorLog
 *  and rejects; no silent placeholder.
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
  private busy = false;

  constructor(
    private renderer: CanvasRenderer,
    private baseUrl: string = "http://127.0.0.1:8765",
  ) {}

  isBusy(): boolean {
    return this.busy;
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
      img.crossOrigin = "anonymous"; // needed so we can re-capture it for segmentation
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
   *  can be sent back to the server for segmentation. Requires the image to have
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

  /** Capture the tile's schematic and generate its scene image. */
  async generateForTile(key: string): Promise<void> {
    if (this.busy) {
      console.log("[scene-image] busy, ignoring generate");
      return;
    }
    const rect = this.renderer.getTileRect(key);
    const scene = this.renderer.getTileScene(key);
    if (!rect || !scene) {
      errors.push("scene", `generateForTile: tile ${key} no registrado en el renderer`);
      return;
    }
    this.busy = true;
    try {
      const prompt = this.buildPrompt(scene as unknown as SceneSummary);
      const ppm = this.ppmFor(rect);
      const dataUrl = this.renderer.captureSchematic(rect, ppm);
      const res = await fetch(`${this.baseUrl}/generate_scene_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: dataUrl, prompt }),
      });
      if (!res.ok) {
        throw new Error(`/generate_scene_image HTTP ${res.status}`);
      }
      const data = (await res.json()) as { hash?: string; scene_url?: string; error?: string };
      if (!data.scene_url) {
        throw new Error(`/generate_scene_image returned no scene_url: ${data.error ?? "unknown"}`);
      }
      const img = await this.loadImage(`${this.baseUrl}${data.scene_url}`);
      this.renderer.setTileImage(key, img);
      console.log(`[scene-image] ${key} generated (${img.naturalWidth}x${img.naturalHeight})`);
    } catch (err) {
      errors.push("scene", `generateForTile ${key} failed`, err);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** Captura el blueprint de `rect` y pide a Claude (vía ai_server + MCP) que lo
   *  revise contra la escena Format D. No toca nada: devuelve el veredicto y
   *  el caller decide si aplica los fixes. Requiere terminal de Claude Code
   *  escuchando en el bridge (si no, el servidor responde 503 y aquí se
   *  reporta al ErrorLog). */
  async reviewBlueprint(scene: Record<string, unknown>, rect: SceneBounds): Promise<BlueprintReview> {
    if (this.busy) {
      throw new Error("scene-image controller busy");
    }
    this.busy = true;
    try {
      const dataUrl = this.renderer.captureSchematic(rect, this.ppmFor(rect));
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

  /** Segment the known occluders (buildings/props) out of the tile's scene
   *  image and install them as depth-sortable cutouts so they occlude the
   *  player. Each object's pixel box comes from its world footprint mapped 1:1
   *  onto the image; the server returns one RGBA sprite + tight bbox each. */
  async segmentOccludersForTile(key: string): Promise<Occluder[]> {
    if (this.busy) {
      console.log("[scene-image] busy, ignoring segment");
      return [];
    }
    const img = this.renderer.getTileImage(key);
    const b = this.renderer.getTileRect(key);
    if (!img || !b) {
      errors.push("scene", `segment: tile ${key} sin imagen — G (o Auto-img) primero`);
      return [];
    }
    const objects = this.renderer.getTileScene(key)?.objects ?? [];
    const occ = objects.filter((o) => OCCLUDER_CATEGORIES.has(o.category));
    if (occ.length === 0) {
      console.log(`[scene-image] ${key}: no building/prop occluders to segment`);
      return [];
    }

    this.busy = true;
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
        built.push({ id: seg.id, img: sprite, world, baselineZ: world.maxZ, tileKey: key });
      }
      this.renderer.setOccludersForTile(key, built);
      console.log(`[scene-image] ${key}: segmented ${built.length}/${occ.length} occluders`);
      return built;
    } catch (err) {
      errors.push("scene", `segmentOccluders ${key} failed`, err);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** Phase 3: discover props the image model invented (not in the schematic)
   *  via SAM3 open-vocab, and add them as occluders. Returns the new occluders
   *  so the caller can also give them collision. `known_boxes` (the building/prop
   *  footprints) are sent so the server filters out objects we already handle.
   *  Ids are prefixed with the tile key so discoveries never collide across
   *  tiles (`discovered_0` exists once per SAM3 run). */
  async discoverObjectsForTile(key: string): Promise<Occluder[]> {
    if (this.busy) {
      console.log("[scene-image] busy, ignoring discover");
      return [];
    }
    const img = this.renderer.getTileImage(key);
    const b = this.renderer.getTileRect(key);
    if (!img || !b) {
      errors.push("scene", `discover: tile ${key} sin imagen — G (o Auto-img) primero`);
      return [];
    }
    this.busy = true;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    try {
      // Pixel boxes of objects we already handle, so the server won't re-report them.
      const objects = this.renderer.getTileScene(key)?.objects ?? [];
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
        built.push({ id: `${key}:${seg.id}`, img: sprite, world, baselineZ: world.maxZ, tileKey: key });
      }
      this.renderer.addOccluders(built);
      console.log(`[scene-image] ${key}: discovered ${built.length} new props`);
      return built;
    } catch (err) {
      errors.push("scene", `discoverObjects ${key} failed`, err);
      throw err;
    } finally {
      this.busy = false;
    }
  }
}
