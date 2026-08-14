/** Atlas de superficies de la vista fps — patrón StageImageController.
 *
 *  Al activarse un tile en la vista fps: layout determinista de superficies →
 *  caché cliente por (layoutKey = hash del layout canónico + estilo + versión)
 *  → si render_mode escenas = imagen, POST /generate_surface_atlas (el server
 *  resuelve por CELDA contra la librería y pinta solo lo que falta) → fetch de
 *  cada celda del asset-store → texturas al FpsRenderer. Las celdas usadas se
 *  registran en el world-state (/scene/asset_refs) para la keep-list del
 *  prune. Cualquier fallo degrada a clay con error visible. */

import type {
  GenerateSurfaceAtlasResponse,
  SurfaceCellSpec,
} from "@nefan-core/src/contracts/remote-gen.js";
import { styleCategoryForTile } from "@nefan-core/src/games/style-categories.js";
import {
  canonicalSurfaceLayoutJson,
  type SurfaceLayout,
} from "@nefan-core/src/scene/greybox/surfaces.js";
import { errors } from "../ui/error-log.js";
import type { AtlasImage } from "../renderer/fps-gl.js";

/** Versión CLIENTE del pipeline: bump ⇒ invalida instalaciones previas. */
const FPS_ATLAS_CLIENT_VERSION = 1;
const CLIENT_CACHE_MAX = 12;

export interface FpsAtlasUrls {
  remote: string;
  assets: string;
  /** State API del bridge (keep-list del prune); "" = sin registro. */
  state: string;
}

export interface FpsAtlasDeps {
  /** Superficies del tile (FpsRenderer.getTileSurfaces) + metadatos. */
  getTile(key: string): {
    layout: SurfaceLayout;
    sceneDescription: string;
    styleTag: string;
    biome?: string;
  } | null;
  apply(key: string, images: Map<string, AtlasImage>): void;
  clear(key: string): void;
  /** render_mode de escenas = imagen (gasto auto permitido). */
  generationOn(): boolean;
  log(msg: string): void;
  onGeneration?(e: { kind: "fps_atlas"; cached: boolean }): void;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class FpsAtlasController {
  private styleId = "";
  private cache = new Map<string, { layoutKey: string; images: Map<string, AtlasImage> }>();
  private token = 0;
  private inFlight = false;

  constructor(
    private urls: FpsAtlasUrls,
    private deps: FpsAtlasDeps,
  ) {}

  setStyle(styleId: string): void {
    this.styleId = styleId;
  }

  get running(): boolean {
    return this.inFlight;
  }

  /** Tile activo nuevo: reinstala de caché o, con generación auto, pinta.
   *  Con un run en vuelo no relanza (los disparadores retro/addTile/
   *  setActiveClientTile pueden solaparse en el arranque). */
  async onActiveTile(key: string): Promise<void> {
    if (await this.reinstallIfCached(key)) return;
    if (this.inFlight) return;
    if (this.deps.generationOn()) await this.runFor(key);
  }

  async reinstallIfCached(key: string): Promise<boolean> {
    const tile = this.deps.getTile(key);
    if (!tile) return false;
    const layoutKey = await this.layoutKeyFor(tile.layout);
    const hit = this.cache.get(key);
    if (!hit || hit.layoutKey !== layoutKey) return false;
    this.deps.apply(key, hit.images);
    return true;
  }

  /** Generación manual (tecla G / menú dev) o auto (onActiveTile). */
  async runFor(key: string): Promise<void> {
    const tile = this.deps.getTile(key);
    if (!tile) return;
    const token = ++this.token;
    this.inFlight = true;
    try {
      const layoutKey = await this.layoutKeyFor(tile.layout);
      const cells = this.flattenCells(tile.layout);
      if (cells.length === 0) return;
      this.deps.log(`Atlas fps del tile ${key}: ${cells.length} superficies…`);
      const res = await fetch(`${this.urls.remote}/generate_surface_atlas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells,
          scene_description: tile.sceneDescription || "a medieval settlement",
          style_id: this.styleId || undefined,
          style_tag: styleCategoryForTile(tile.styleTag, tile.biome) || undefined,
          layout_key: layoutKey.slice(0, 64),
        }),
      });
      if (!res.ok) throw new Error(`generate_surface_atlas: HTTP ${res.status} ${await res.text()}`);
      const data = (await res.json()) as GenerateSurfaceAtlasResponse;
      this.deps.onGeneration?.({ kind: "fps_atlas", cached: data.cached });
      if (token !== this.token) return; // el tile activo cambió en vuelo

      const kindByKey = new Map(cells.map((c) => [c.key, c.kind]));
      const images = new Map<string, AtlasImage>();
      const failures: string[] = [];
      await Promise.all(
        Object.entries(data.cells).map(async ([cellKey, cell]) => {
          try {
            const img = await this.fetchImage(`${this.urls.assets}${cell.url}`);
            images.set(cellKey, { image: img, kind: kindByKey.get(cellKey) ?? "tile" });
          } catch (err) {
            failures.push(cellKey);
            console.warn(`celda ${cellKey} no descargó — clay:`, err);
          }
        }),
      );
      if (token !== this.token) return;
      if (images.size === 0) throw new Error("atlas sin celdas descargables");
      if (failures.length) {
        errors.push("scene", `atlas fps de ${key}: ${failures.length} celdas sin textura (clay)`);
      }
      this.deps.apply(key, images);
      this.cache.set(key, { layoutKey, images });
      while (this.cache.size > CLIENT_CACHE_MAX) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      void this.registerRefs(key, Object.values(data.cells).map((c) => c.hash));
      this.deps.log(
        `Atlas fps de ${key} instalado (${data.pages_painted} página(s) nuevas` +
          `${data.cached ? ", todo de la librería" : `, $${data.cost_usd}`})`,
      );
    } catch (err) {
      errors.push("scene", `el atlas fps de ${key} falló — se queda en clay`, err);
    } finally {
      if (token === this.token) this.inFlight = false;
    }
  }

  private async layoutKeyFor(layout: SurfaceLayout): Promise<string> {
    return sha256Hex(
      canonicalSurfaceLayoutJson(layout) + `|style:${this.styleId}|v${FPS_ATLAS_CLIENT_VERSION}`,
    );
  }

  private flattenCells(layout: SurfaceLayout): SurfaceCellSpec[] {
    return layout.pages.flatMap((p) =>
      p.cells.map((c) => ({
        key: c.key,
        mat: c.mat,
        kind: c.kind,
        desc: c.en,
        base_color: c.baseColor,
        world_w: c.worldW,
        world_h: c.worldH,
        hints: c.hints,
      })),
    );
  }

  private fetchImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`no se pudo cargar ${url}`));
      img.src = url;
    });
  }

  /** Keep-list del prune: los hashes usados por la escena viva. Best-effort
   *  (un fallo no rompe la instalación) pero con traza. */
  private async registerRefs(sceneId: string, refs: string[]): Promise<void> {
    if (!this.urls.state || refs.length === 0) return;
    try {
      const res = await fetch(`${this.urls.state}/scene/asset_refs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: sceneId, refs: [...new Set(refs)] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      errors.push("scene", `asset_refs de ${sceneId} no registrados (prune podría podarlos)`, err);
    }
  }
}
