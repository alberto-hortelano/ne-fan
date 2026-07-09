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
import type { CanvasRenderer, ComposedTilePlan, SceneBounds, Occluder } from "../renderer/canvas-renderer.js";
import type { ExpectedElement } from "./svg-collision.js";

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
    /** Documento map_ground COMPLETO corregido (arte plano del suelo). */
    map_ground?: string;
    /** Array COMPLETO de volúmenes corregido. */
    volumes?: Record<string, unknown>[];
  };
}

interface SceneSummary {
  scene_description?: string;
  room_description?: string;
  zone_type?: string;
}

export class SceneImageController {
  private busy = false;
  /** Estilo visual de la sesión activa (world.style_id, congelado en el
   *  save). "" = sin sesión aún ⇒ el servidor usa su referencia global. */
  private styleId = "";
  private perspective: "topdown" | "isometric" = "topdown";

  constructor(
    private renderer: CanvasRenderer,
    private baseUrl: string = "http://127.0.0.1:8765",
  ) {}

  setStyle(styleId: string): void {
    this.styleId = styleId;
  }

  /** Perspectiva congelada de la sesión ("topdown" | "isometric"): viaja al
   *  prompt de imagen y a la clave de caché. */
  setPerspective(perspective: string): void {
    this.perspective = perspective === "isometric" ? "isometric" : "topdown";
  }

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

  /** Espera (≤3 s) a que el blueprint compuesto del tile esté rasterizado
   *  antes de capturar: la decodificación es async y capturar antes daría el
   *  fallback de grid+cajas en vez del plano. Timeout → warn y seguir. */
  private async waitForPlan(key: string): Promise<void> {
    const deadline = performance.now() + 3_000;
    while (!this.renderer.tilePlanReady(key)) {
      if (performance.now() > deadline) {
        errors.push("scene", `blueprint de ${key} no rasterizó a tiempo; captura sin plano`);
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
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

  /** Placa de fondo del tile: construye la máscara UNIÓN de los recortes
   *  `tall` (el alpha de cada sprite en su bbox de imagen, dilatado ~4 px
   *  para cubrir el borde del recorte), pide al servidor el inpainting de los
   *  huecos (continuar solo el suelo, sin añadir nada) e instala el resultado
   *  como imagen base del tile SIN tocar occluders ni análisis. */
  private async installPlateForTile(
    key: string,
    img: HTMLImageElement,
    tallCutouts: { sprite: HTMLImageElement; bbox: [number, number, number, number] }[],
  ): Promise<void> {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    // Acumular el alpha de los recortes (dilatación barata: 9 pasadas con
    // offset ±4 px), y volcarlo a blanco-sobre-negro (máscara L del server).
    const acc = document.createElement("canvas");
    acc.width = w;
    acc.height = h;
    const actx = acc.getContext("2d");
    if (!actx) throw new Error("installPlateForTile: no 2D context");
    for (const t of tallCutouts) {
      const [bx, by, bw, bh] = t.bbox;
      for (const dx of [-4, 0, 4]) {
        for (const dy of [-4, 0, 4]) {
          actx.drawImage(t.sprite, bx + dx, by + dy, bw, bh);
        }
      }
    }
    actx.globalCompositeOperation = "source-in";
    actx.fillStyle = "#fff";
    actx.fillRect(0, 0, w, h);
    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext("2d");
    if (!mctx) throw new Error("installPlateForTile: no 2D context");
    mctx.fillStyle = "#000";
    mctx.fillRect(0, 0, w, h);
    mctx.drawImage(acc, 0, 0);

    const res = await fetch(`${this.baseUrl}/inpaint_scene_plate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64: this.imageToDataUrl(img),
        mask_b64: mask.toDataURL("image/png"),
      }),
    });
    if (!res.ok) {
      throw new Error(`/inpaint_scene_plate HTTP ${res.status}`);
    }
    const data = (await res.json()) as { plate_url?: string };
    if (!data.plate_url) throw new Error("/inpaint_scene_plate sin plate_url");
    let plate = await this.loadImage(`${this.baseUrl}${data.plate_url}`);
    // El servidor aplana a RGB (el alpha del rombo/voladizo vuelve negro):
    // re-enmascarar con el blueprint compuesto, como la imagen original.
    plate = await this.maskByBlueprint(plate, key);
    this.renderer.setTilePlate(key, plate);
    console.log(`[scene-image] ${key}: placa de fondo instalada (${tallCutouts.length} recortes)`);
  }

  /** Enmascara la imagen generada con el alpha del blueprint compuesto: la
   *  imagen instalada solo conserva los píxeles que el plan declaró (rombo/
   *  cuadrado del tile + voladizo de alturas). Meshy devuelve un rect opaco —
   *  sin esto el voladizo pintaría un rectángulo sobre el vecino. */
  private async maskByBlueprint(img: HTMLImageElement, key: string): Promise<HTMLImageElement> {
    const plan = this.renderer.getTilePlanImage(key);
    if (!plan) return img;
    const off = document.createElement("canvas");
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("maskByBlueprint: no 2D context");
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(plan, 0, 0, off.width, off.height);
    ctx.globalCompositeOperation = "source-over";
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
      const composed = (scene as { __composed?: ComposedTilePlan }).__composed;
      // Con plan compuesto el blueprint es el plano vectorial rico: el
      // servidor usa la instrucción de REPINTADO total en vez de la de cajas
      // de colores. Esperar a su raster para no capturar el fallback.
      const blueprintKind = composed ? "svg" : "boxes";
      if (composed) await this.waitForPlan(key);
      // La captura cubre el canvas de VISTA del tile (voladizo de alturas
      // incluido): la imagen resultante cubre el mismo canvas y el
      // compositing por profundidad del renderer la pisa sobre el vecino.
      const tv = this.renderer.getProjection().tileViewRect(rect, composed?.view_box ?? null);
      const tileExt: SceneBounds = { minX: tv.x, minZ: tv.y, maxX: tv.x + tv.w, maxZ: tv.y + tv.h };
      const { expanded, contextSides, imageTileKeys } = this.neighborContext(key, tileExt);
      const ppm = this.ppmFor(expanded);
      const dataUrl = this.renderer.captureSchematic(expanded, ppm, { imageTileKeys });
      const res = await fetch(`${this.baseUrl}/generate_scene_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: dataUrl,
          prompt,
          context_sides: contextSides,
          blueprint_kind: blueprintKind,
          style_id: this.styleId,
          // Perspectiva congelada de la sesión: cambia la leyenda del prompt
          // de imagen (caras sur / iso 2:1) y la clave de caché.
          perspective: this.perspective,
          // Categoría de referencia que etiquetó el motor narrativo para este
          // tile; el servidor tiene fallback si falta.
          style_tag: (scene as { style_tag?: string }).style_tag ?? "",
        }),
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
        img = await this.cropToTile(img, expanded, tileExt);
      }
      // Silueta del blueprint como máscara: lo pintado fuera del tile (y de
      // su voladizo real) se recorta — el vecino pinta lo suyo.
      if (composed) {
        img = await this.maskByBlueprint(img, key);
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
   *  reporta al ErrorLog). `tileKey` (si la escena tiene map_svg) espera a que
   *  el plano SVG esté rasterizado antes de capturar. */
  async reviewBlueprint(
    scene: Record<string, unknown>,
    rect: SceneBounds,
    tileKey?: string,
  ): Promise<BlueprintReview> {
    if (this.busy) {
      throw new Error("scene-image controller busy");
    }
    this.busy = true;
    try {
      const hasPlan = typeof scene.map_ground === "string" || Array.isArray(scene.volumes);
      if (tileKey && hasPlan) await this.waitForPlan(tileKey);
      // La imagen revisada incluye el voladizo del blueprint compuesto.
      const composed = tileKey
        ? (this.renderer.getTileScene(tileKey) as { __composed?: ComposedTilePlan } | null)?.__composed
        : undefined;
      let reviewRect: SceneBounds = rect;
      if (composed) {
        const tv = this.renderer.getProjection().tileViewRect(rect, composed.view_box);
        reviewRect = { minX: tv.x, minZ: tv.y, maxX: tv.x + tv.w, maxZ: tv.y + tv.h };
      }
      const dataUrl = this.renderer.captureSchematic(reviewRect, this.ppmFor(reviewRect));
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
    try {
      const scene = this.renderer.getTileScene(key) as
        | (SceneSummary & { __composed?: ComposedTilePlan })
        | null;
      const composed = scene?.__composed;
      const proj = this.renderer.getProjection();
      // La imagen instalada cubre el canvas de VISTA del tile (voladizo
      // incluido): el mapeo imagen↔vista es lineal; a mundo se desproyecta.
      const tv = proj.tileViewRect(b, composed?.view_box ?? null);
      const bE: SceneBounds = { minX: tv.x, minZ: tv.y, maxX: tv.x + tv.w, maxZ: tv.y + tv.h };
      const spanX = bE.maxX - bE.minX;
      const spanZ = bE.maxZ - bE.minZ;
      const dataUrl = this.imageToDataUrl(img);
      // Análisis guiado por el plan: los volúmenes declarados (label + bbox
      // proyectado en píxeles) orientan al clasificador — etiqueta mejor y no
      // marca suelo lo declarado. Salen del compositor, no de getBBox.
      const expectedInfo = composed
        ? expectedFromComposed(composed, img.naturalWidth, img.naturalHeight)
        : [];
      const expected: ExpectedElement[] | undefined = expectedInfo.length
        ? expectedInfo.map((e) => e.wire)
        : undefined;
      const res = await fetch(`${this.baseUrl}/analyze_scene_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: dataUrl,
          context: {
            scene_description: scene?.scene_description ?? scene?.room_description ?? "",
            zone_type: scene?.zone_type ?? "",
            ...(expected?.length ? { expected_elements: expected } : {}),
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
      /** Recortes `tall` (sprite + bbox de imagen): máscara de la placa. */
      const tallCutouts: { sprite: HTMLImageElement; bbox: [number, number, number, number] }[] = [];
      /** Celdas sólidas de segmentos NO declarados (franja en su baseline). */
      const stripCells = new Set<number>();
      let solids = 0;
      for (const seg of data.segments ?? []) {
        const sprite = await this.loadImage(`${this.baseUrl}${seg.sprite_url}`);
        const [bx, by, bw, bh] = seg.image_bbox;
        // Rect del segmento en VISTA (lineal sobre el canvas del tile).
        const view: SceneBounds = {
          minX: bE.minX + (bx / seg.img_w) * spanX,
          maxX: bE.minX + ((bx + bw) / seg.img_w) * spanX,
          minZ: bE.minZ + (by / seg.img_h) * spanZ,
          maxZ: bE.minZ + ((by + bh) / seg.img_h) * spanZ,
        };
        // Rect de MUNDO (para el bridge y las costuras): bbox de las esquinas
        // desproyectadas — exacto en topdown, envolvente en iso.
        const corners = [
          proj.viewToWorld(view.minX, view.minZ),
          proj.viewToWorld(view.maxX, view.minZ),
          proj.viewToWorld(view.minX, view.maxZ),
          proj.viewToWorld(view.maxX, view.maxZ),
        ];
        const world: SceneBounds = {
          minX: Math.min(...corners.map((c) => c[0])),
          maxX: Math.max(...corners.map((c) => c[0])),
          minZ: Math.min(...corners.map((c) => c[1])),
          maxZ: Math.max(...corners.map((c) => c[1])),
        };
        // Segmento casado con un volumen declarado: su huella (mundo) es la
        // verdad — bajo perspectiva la pintura de una cara cae al norte de la
        // base real y NO debe convertirse en colisión.
        const match = matchExpected(seg.image_bbox, expectedInfo);
        if (seg.tall) {
          let baselineView = view.maxZ; // borde inferior ≈ contacto con suelo
          if (match) {
            const fc = match.element.footprint_cells;
            const midX = b.minX + ((fc[0] + fc[2]) / 2) * TILE_MPC;
            const baseZ = b.minZ + fc[3] * TILE_MPC;
            baselineView = proj.worldToView(midX, baseZ)[1];
          }
          occluders.push({
            id: `${key}:${seg.id}`,
            img: sprite,
            view,
            baselineView,
            tileKey: key,
            kind: "image",
            label: seg.label,
          });
          tallCutouts.push({ sprite, bbox: seg.image_bbox });
        }
        if (seg.solid) {
          solids++;
          if (composed) {
            // Plan: casado → la huella ya bloquea vía applyPlanCollision;
            // no casado → franja sólida de 1 m en su línea de suelo.
            if (!match) markBaselineStrip(stripCells, view, b, proj);
          } else {
            masks.push(this.spriteAlphaMask(sprite, seg));
          }
        }
        elements.push({ label: seg.label, solid: seg.solid, tall: seg.tall, rect: { ...world } });
      }

      const rows = composed
        ? rowsFromCells(stripCells)
        : solidGridFromMasks(masks, TILE_CELLS, TILE_CELLS);
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

      // Placa de fondo: la escena SIN los objetos altos (huecos inpainted en
      // el servidor, local y sin créditos). Instalada como base, el fade por
      // proximidad de un cutout revela el suelo real tras el objeto. Fallo NO
      // fatal: sin placa queda el x-ray del personaje.
      if (tallCutouts.length > 0) {
        try {
          await this.installPlateForTile(key, img, tallCutouts);
        } catch (err) {
          errors.push("scene", `placa de fondo de ${key} falló (queda x-ray del personaje)`, err);
        }
      }
      return { occluders, grid, elements };
    } catch (err) {
      errors.push("scene", `analyzeScene ${key} failed`, err);
      throw err;
    } finally {
      this.busy = false;
    }
  }
}

/** Elemento declarado con su bbox proyectado en píxeles de la imagen. */
interface ExpectedInfo {
  element: ComposedTilePlan["elements"][number];
  pxBbox: [number, number, number, number];
  wire: ExpectedElement;
}

/** Convierte los elementos del blueprint compuesto a la guía del clasificador
 *  (bbox en píxeles de la imagen instalada). Solo solid/tall interesan. */
function expectedFromComposed(composed: ComposedTilePlan, imgW: number, imgH: number): ExpectedInfo[] {
  const vb = composed.view_box;
  const sx = imgW / vb.width;
  const sy = imgH / vb.height;
  const out: ExpectedInfo[] = [];
  for (const e of composed.elements) {
    if (!e.solid && !e.tall) continue;
    const px: [number, number, number, number] = [
      Math.round((e.bbox[0] - vb.minX) * sx),
      Math.round((e.bbox[1] - vb.minY) * sy),
      Math.round(e.bbox[2] * sx),
      Math.round(e.bbox[3] * sy),
    ];
    out.push({
      element: e,
      pxBbox: px,
      wire: { label: e.label, solid: e.solid, tall: e.tall, bbox_px: px },
    });
  }
  out.sort((a, b) => b.pxBbox[2] * b.pxBbox[3] - a.pxBbox[2] * a.pxBbox[3]);
  return out.slice(0, 64);
}

/** Casa un segmento con el volumen declarado que más lo solapa (≥40% del área
 *  del menor de los dos bboxes), o null si es un añadido del modelo de imagen. */
function matchExpected(
  segBbox: [number, number, number, number],
  expected: ExpectedInfo[],
): ExpectedInfo | null {
  const [sx, sy, sw, sh] = segBbox;
  let best: ExpectedInfo | null = null;
  let bestRatio = 0.4;
  for (const e of expected) {
    const [ex, ey, ew, eh] = e.pxBbox;
    const ix = Math.max(0, Math.min(sx + sw, ex + ew) - Math.max(sx, ex));
    const iy = Math.max(0, Math.min(sy + sh, ey + eh) - Math.max(sy, ey));
    const inter = ix * iy;
    if (inter <= 0) continue;
    const ratio = inter / Math.max(1, Math.min(sw * sh, ew * eh));
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = e;
    }
  }
  return best;
}

/** Marca como sólidas las celdas de una franja de ~1 m en la línea de suelo
 *  de un segmento no declarado: muestrea el borde inferior de su rect de
 *  VISTA, lo desproyecta a mundo y marca un bloque 2×2 por muestra. Celdas
 *  fuera del tile (voladizo del vecino) se descartan. */
function markBaselineStrip(
  cells: Set<number>,
  view: SceneBounds,
  tile: SceneBounds,
  proj: { viewToWorld(vx: number, vy: number): [number, number] },
): void {
  const samples = Math.max(4, Math.ceil((view.maxX - view.minX) / TILE_MPC));
  for (let i = 0; i <= samples; i++) {
    const vx = view.minX + ((view.maxX - view.minX) * i) / samples;
    const [wx, wz] = proj.viewToWorld(vx, view.maxZ);
    const c = Math.floor((wx - tile.minX) / TILE_MPC);
    const r = Math.floor((wz - tile.minZ) / TILE_MPC);
    for (let dr = -1; dr <= 0; dr++) {
      for (let dc = -1; dc <= 0; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < TILE_CELLS && rr < TILE_CELLS) cells.add(rr * TILE_CELLS + cc);
      }
    }
  }
}

/** Filas del grid (chars S/g) desde el set de celdas, o null si está vacío. */
function rowsFromCells(cells: Set<number>): string[] | null {
  if (cells.size === 0) return null;
  const rows: string[] = [];
  for (let r = 0; r < TILE_CELLS; r++) {
    let row = "";
    for (let c = 0; c < TILE_CELLS; c++) row += cells.has(r * TILE_CELLS + c) ? "S" : "g";
    rows.push(row);
  }
  return rows;
}
