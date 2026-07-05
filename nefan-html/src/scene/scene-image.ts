/** Scene-image controller: drives AI generation of the top-down scene
 *  background for the 2D client, one TILE at a time (continuous world).
 *
 *  - `generateForTile` captures the schematic the renderer paints for that
 *    tile's rect (terrain + object rectangles, no characters), sends it to
 *    ai_server `/generate_scene_image` and installs the painted result as the
 *    tile's background (1:1, top-down).
 *  - `analyzeSceneForTile` derives the PLAYABLE world from the image (the
 *    image is the truth): full auto-segmentation + vision classification of
 *    every region → occluders (`tall`) and a derived collision grid (`solid`).
 *
 *  All operations are keyed by tile: crossing tiles mid-generation is
 *  harmless — the result lands on the tile it was requested for. A single
 *  `busy` flag serialises calls (Meshy in series), shared by the manual keys
 *  (G/X/N) and the auto pipeline. Collisions and SceneData are untouched —
 *  the image is purely visual. Fail loud: every failure goes to the ErrorLog
 *  and rejects; no silent placeholder.
 */
import { parseTileKey, tileKey, TILE_CELLS, TILE_MPC } from "@nefan-core/src/scene/tile.js";
import {
  solidGridFromMasks,
  IMAGE_SOLID_CHAR,
  type AlphaMask,
} from "@nefan-core/src/scene/image-collision.js";
import type { TerrainGridData } from "@nefan-core/src/scene/terrain-collision.js";
import { errors } from "../ui/error-log.js";
import type { CanvasRenderer, SceneBounds, Occluder } from "../renderer/canvas-renderer.js";

/** Un segmento jugable devuelto por /analyze_scene_image. */
interface AnalyzedSegment {
  id: string;
  label: string;
  solid: boolean;
  tall: boolean;
  sprite_url: string;
  image_bbox: [number, number, number, number]; // [x, y, w, h] px
  img_w: number;
  img_h: number;
}

/** Un elemento jugable del análisis con su rect en MUNDO (para el bridge:
 *  el motor narrativo recibe el mapa real resumido). */
export interface AnalyzedElement {
  label: string;
  solid: boolean;
  tall: boolean;
  rect: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Resultado del análisis de un tile, listo para aplicar (main.ts). */
export interface TileAnalysis {
  occluders: Occluder[];
  grid: TerrainGridData | null;
  elements: AnalyzedElement[];
}

/** Target longest side (px) of the captured schematic / generated image. */
const CAPTURE_LONG_SIDE = 640;
/** Pixels-per-metre clamp for the capture so tiny/huge scenes stay sane. */
const MIN_PPM = 6;
const MAX_PPM = 64;
/** Metros de imagen REAL de cada vecino incluidos en la captura como banda de
 *  contexto: el modelo la reproduce y continúa, y aquí se recorta del
 *  resultado antes de instalar la imagen del tile. */
const CONTEXT_M = 8;

type ContextSide = "left" | "right" | "top" | "bottom";

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

  /** Bandas de contexto: lados del tile cuyo vecino ya tiene imagen IA. El
   *  rect de captura se expande CONTEXT_M hacia cada uno y la captura pinta
   *  ahí la imagen real del vecino (coherencia de paleta/contenido). */
  private neighborContext(key: string, rect: SceneBounds): {
    expanded: SceneBounds;
    contextSides: ContextSide[];
    imageTileKeys: Set<string>;
  } {
    const expanded: SceneBounds = { ...rect };
    const contextSides: ContextSide[] = [];
    const tc = parseTileKey(key);
    if (tc) {
      const withImage = (tx: number, ty: number): boolean =>
        this.renderer.tileHasImage(tileKey(tx, ty));
      if (withImage(tc.tx - 1, tc.ty)) { expanded.minX -= CONTEXT_M; contextSides.push("left"); }
      if (withImage(tc.tx + 1, tc.ty)) { expanded.maxX += CONTEXT_M; contextSides.push("right"); }
      if (withImage(tc.tx, tc.ty - 1)) { expanded.minZ -= CONTEXT_M; contextSides.push("top"); }
      if (withImage(tc.tx, tc.ty + 1)) { expanded.maxZ += CONTEXT_M; contextSides.push("bottom"); }
    }
    // Cualquier tile con imagen ≠ el objetivo se pinta como imagen en la
    // captura (cubre también las esquinas diagonales del rect expandido).
    const imageTileKeys = new Set(
      this.renderer.tileKeys.filter((k) => k !== key && this.renderer.tileHasImage(k)),
    );
    return { expanded, contextSides, imageTileKeys };
  }

  /** Recorta del resultado (mapeado linealmente sobre `E`) la parte que cubre
   *  el rect del tile `T`. Bordes con x1−x0 (no round(ancho)): sin drift. */
  private async cropToTile(
    img: HTMLImageElement,
    E: SceneBounds,
    T: SceneBounds,
  ): Promise<HTMLImageElement> {
    const sx = img.naturalWidth / (E.maxX - E.minX);
    const sy = img.naturalHeight / (E.maxZ - E.minZ);
    const x0 = Math.round((T.minX - E.minX) * sx);
    const y0 = Math.round((T.minZ - E.minZ) * sy);
    const x1 = Math.round((T.maxX - E.minX) * sx);
    const y1 = Math.round((T.maxZ - E.minZ) * sy);
    const off = document.createElement("canvas");
    off.width = x1 - x0;
    off.height = y1 - y0;
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("cropToTile: no 2D context");
    ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
    // Volver a HTMLImageElement (no canvas): imageToDataUrl/naturalWidth de
    // X/N siguen funcionando igual sobre la imagen instalada.
    return this.loadImage(off.toDataURL("image/png"));
  }

  /** Capture the tile's schematic (with neighbor-image context strips when
   *  available) and generate its scene image. */
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
      const { expanded, contextSides, imageTileKeys } = this.neighborContext(key, rect);
      const ppm = this.ppmFor(expanded);
      const dataUrl = this.renderer.captureSchematic(expanded, ppm, { imageTileKeys });
      const res = await fetch(`${this.baseUrl}/generate_scene_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: dataUrl, prompt, context_sides: contextSides }),
      });
      if (!res.ok) {
        throw new Error(`/generate_scene_image HTTP ${res.status}`);
      }
      const data = (await res.json()) as { hash?: string; scene_url?: string; error?: string };
      if (!data.scene_url) {
        throw new Error(`/generate_scene_image returned no scene_url: ${data.error ?? "unknown"}`);
      }
      let img = await this.loadImage(`${this.baseUrl}${data.scene_url}`);
      if (contextSides.length > 0) {
        img = await this.cropToTile(img, expanded, rect);
      }
      this.renderer.setTileImage(key, img);
      console.log(
        `[scene-image] ${key} generated (${img.naturalWidth}x${img.naturalHeight}` +
        `${contextSides.length ? `, contexto: ${contextSides.join("+")}` : ""})`,
      );
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
  /** Extrae el canal alpha de un sprite como AlphaMask (la máscara del
   *  segmento viaja en el alpha del recorte RGBA). */
  private spriteAlphaMask(sprite: HTMLImageElement, seg: AnalyzedSegment): AlphaMask {
    const off = document.createElement("canvas");
    off.width = sprite.naturalWidth;
    off.height = sprite.naturalHeight;
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("spriteAlphaMask: no 2D context");
    ctx.drawImage(sprite, 0, 0);
    const rgba = ctx.getImageData(0, 0, off.width, off.height).data;
    const alpha = new Uint8Array(off.width * off.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    return {
      alpha,
      width: off.width,
      height: off.height,
      imageBbox: seg.image_bbox,
      imgW: seg.img_w,
      imgH: seg.img_h,
    };
  }

  /** Mundo derivado de la imagen: pide al ai_server el análisis completo del
   *  tile (auto-segmentación + clasificación por visión) y lo convierte en
   *  material jugable: occluders (`tall`) instalados en el renderer y grid de
   *  colisión derivado (`solid`). El caller (applyTileAnalysis en main.ts)
   *  materializa el grid en el collider del tile. */
  async analyzeSceneForTile(key: string): Promise<TileAnalysis> {
    if (this.busy) {
      console.log("[scene-image] busy, ignoring analyze");
      return { occluders: [], grid: null, elements: [] };
    }
    const img = this.renderer.getTileImage(key);
    const b = this.renderer.getTileRect(key);
    if (!img || !b) {
      errors.push("scene", `analyze: tile ${key} sin imagen — G (o Auto-img) primero`);
      return { occluders: [], grid: null, elements: [] };
    }
    this.busy = true;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    try {
      const scene = this.renderer.getTileScene(key) as SceneSummary | null;
      const dataUrl = this.imageToDataUrl(img);
      const res = await fetch(`${this.baseUrl}/analyze_scene_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: dataUrl,
          context: {
            scene_description: scene?.scene_description ?? scene?.room_description ?? "",
            zone_type: scene?.zone_type ?? "",
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`/analyze_scene_image HTTP ${res.status}`);
      }
      const data = (await res.json()) as { segments: AnalyzedSegment[]; discarded: number };

      const occluders: Occluder[] = [];
      const masks: AlphaMask[] = [];
      const elements: AnalyzedElement[] = [];
      let solids = 0;
      for (const seg of data.segments ?? []) {
        const sprite = await this.loadImage(`${this.baseUrl}${seg.sprite_url}`);
        const [bx, by, bw, bh] = seg.image_bbox;
        const world: SceneBounds = {
          minX: b.minX + (bx / seg.img_w) * spanX,
          maxX: b.minX + ((bx + bw) / seg.img_w) * spanX,
          minZ: b.minZ + (by / seg.img_h) * spanZ,
          maxZ: b.minZ + ((by + bh) / seg.img_h) * spanZ,
        };
        if (seg.tall) {
          occluders.push({
            id: `${key}:${seg.id}`,
            img: sprite,
            world,
            baselineZ: world.maxZ,
            tileKey: key,
            kind: "image",
            label: seg.label,
          });
        }
        if (seg.solid) {
          solids++;
          masks.push(this.spriteAlphaMask(sprite, seg));
        }
        elements.push({ label: seg.label, solid: seg.solid, tall: seg.tall, rect: { ...world } });
      }

      const rows = solidGridFromMasks(masks, TILE_CELLS, TILE_CELLS);
      const grid: TerrainGridData | null = rows
        ? {
            grid: rows,
            cols: TILE_CELLS,
            rows: TILE_CELLS,
            meters_per_cell: TILE_MPC,
            origin: [b.minX, b.minZ],
            solid_chars: [IMAGE_SOLID_CHAR],
          }
        : null;

      this.renderer.setOccludersForTile(key, occluders);
      console.log(
        `[scene-image] ${key}: analyzed — ${occluders.length} occluders, ` +
        `${solids} sólidos, ${data.discarded ?? 0} suelo`,
      );
      return { occluders, grid, elements };
    } catch (err) {
      errors.push("scene", `analyzeScene ${key} failed`, err);
      throw err;
    } finally {
      this.busy = false;
    }
  }
}
