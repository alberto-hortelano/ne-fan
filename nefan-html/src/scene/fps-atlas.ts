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
import {
  canonicalSurfaceLayoutJson,
  type SurfaceLayout,
} from "@nefan-core/src/scene/greybox/surfaces.js";
import { errors } from "../ui/error-log.js";
import type { AtlasImage } from "../renderer/fps-gl.js";

/** Versión CLIENTE del pipeline: bump ⇒ invalida instalaciones previas.
 *  v2: celdas hero por cara/rol (SURFACE_LAYOUT_VERSION 2). */
const FPS_ATLAS_CLIENT_VERSION = 2;
const CLIENT_CACHE_MAX = 12;
/** Tope de celdas por petición del server (SurfaceAtlasRequest max_length). */
const MAX_CELLS_PER_REQUEST = 64;

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
  /** Tiles con un onActiveTile en curso — guarda SÍNCRONA contra el doble
   *  disparo del arranque (dos triggers antes del primer await pagaban dos
   *  veces la misma página; visto en vivo 2026-08-14, $0.15×2). */
  private pendingTiles = new Set<string>();
  /** Triggers llegados con otro en vuelo: se re-ejecutan al terminar. */
  private queuedTiles = new Set<string>();

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

  /** Tile activo nuevo. El arte YA PAGADO se restaura SIEMPRE (también en
   *  modo vector — mismo criterio que el proscenio con su caché): memoria →
   *  mapping persistido (solo asset-store) → resolve_only contra la librería
   *  ($0). Pintar celdas nuevas solo con la generación activa. Con un run en
   *  vuelo no relanza (los disparadores del arranque se solapan). */
  async onActiveTile(key: string): Promise<void> {
    // Un trigger solapado no se DESCARTA: se re-encola para cuando acabe el
    // actual — el disparo temprano del arranque corre sin estilo/modos de la
    // sesión y el retro-trigger correcto debe poder reintentar (sin esto, el
    // resume con remote-gen caído se quedaba en clay pese al mapping local).
    if (this.pendingTiles.has(key)) {
      this.queuedTiles.add(key);
      return;
    }
    this.pendingTiles.add(key);
    try {
      if (await this.reinstallIfCached(key)) return;
      if (this.inFlight) return;
      if (await this.reinstallFromStorage(key)) return;
      await this.runFor(key, { resolveOnly: !this.deps.generationOn() });
    } finally {
      this.pendingTiles.delete(key);
      if (this.queuedTiles.delete(key)) void this.onActiveTile(key).catch(() => {});
    }
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

  /** Generación manual (tecla G / menú dev) o auto (onActiveTile). Con
   *  `resolveOnly` NUNCA pinta: restaura lo que ya exista en la librería. */
  async runFor(key: string, { resolveOnly = false } = {}): Promise<void> {
    const tile = this.deps.getTile(key);
    if (!tile) return;
    const token = ++this.token;
    this.inFlight = true;
    try {
      const layoutKey = await this.layoutKeyFor(tile.layout);
      const cells = this.flattenCells(tile.layout);
      if (cells.length === 0) return;
      if (!resolveOnly) this.deps.log(`Atlas fps del tile ${key}: ${cells.length} superficies…`);
      // El server capa cells a 64 por petición: trocear y fusionar (cada
      // celda se resuelve independiente contra la librería — mismo resultado).
      const data: GenerateSurfaceAtlasResponse = {
        cells: {},
        pages_painted: 0,
        cached: true,
        cost_usd: 0,
        missing: 0,
        generation_time_ms: 0,
      };
      for (let i = 0; i < cells.length; i += MAX_CELLS_PER_REQUEST) {
        const res = await fetch(`${this.urls.remote}/generate_surface_atlas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cells: cells.slice(i, i + MAX_CELLS_PER_REQUEST),
            scene_description: tile.sceneDescription || "a medieval settlement",
            style_id: this.styleId || undefined,
            layout_key: layoutKey.slice(0, 64),
            resolve_only: resolveOnly || undefined,
          }),
        });
        if (!res.ok) throw new Error(`generate_surface_atlas: HTTP ${res.status} ${await res.text()}`);
        const part = (await res.json()) as GenerateSurfaceAtlasResponse;
        Object.assign(data.cells, part.cells);
        data.pages_painted += part.pages_painted;
        data.cached = data.cached && part.cached;
        data.cost_usd = Math.round((data.cost_usd + part.cost_usd) * 100) / 100;
        data.missing += part.missing;
      }
      if (!resolveOnly) this.deps.onGeneration?.({ kind: "fps_atlas", cached: data.cached });
      if (token !== this.token) return; // el tile activo cambió en vuelo

      const resolvedKeys = Object.keys(data.cells);
      if (resolvedKeys.length === 0) {
        // Nada en la librería para este layout+estilo (tile aún sin pagar).
        if (resolveOnly) {
          this.deps.log(`Atlas fps de ${key}: sin celdas en la librería (clay — G o Imágenes… para pintar)`);
          return;
        }
        throw new Error("atlas sin celdas descargables");
      }

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
      // Caché (memoria + persistida) solo con el atlas COMPLETO: un parcial
      // debe reintentarse en la próxima visita.
      const complete = data.missing === 0 && failures.length === 0;
      if (complete) {
        this.cache.set(key, { layoutKey, images });
        while (this.cache.size > CLIENT_CACHE_MAX) {
          const oldest = this.cache.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          this.cache.delete(oldest);
        }
        this.persistMapping(layoutKey, data.cells, kindByKey);
      }
      void this.registerRefs(key, Object.values(data.cells).map((c) => c.hash));
      this.deps.log(
        data.missing > 0
          ? `Atlas fps de ${key}: ${images.size} superficies de la librería; faltan ${data.missing} por pintar (G o Imágenes…)`
          : `Atlas fps de ${key} instalado (${data.pages_painted} página(s) nuevas` +
            `${data.cached ? ", todo de la librería" : `, $${data.cost_usd}`})`,
      );
    } catch (err) {
      errors.push("scene", `el atlas fps de ${key} falló — se queda en clay`, err);
    } finally {
      if (token === this.token) this.inFlight = false;
    }
  }

  /** Mapping celda→{hash,url,kind} persistido por layoutKey: el resume
   *  restaura el arte pagado con SOLO el asset-store arriba (sin remote-gen).
   *  Best-effort: localStorage lleno/bloqueado no es un error. */
  private persistMapping(
    layoutKey: string,
    cells: Record<string, { hash: string; url: string }>,
    kindByKey: Map<string, "tile" | "unique">,
  ): void {
    try {
      const entry = Object.fromEntries(
        Object.entries(cells).map(([k, c]) => [k, { url: c.url, kind: kindByKey.get(k) ?? "tile" }]),
      );
      localStorage.setItem(`fps_atlas:${layoutKey}`, JSON.stringify(entry));
    } catch (err) {
      // best-effort, pero visible: sin el mapping, el resume offline degrada.
      console.warn("fps-atlas: mapping local no persistido:", err);
    }
  }

  private async reinstallFromStorage(key: string): Promise<boolean> {
    const tile = this.deps.getTile(key);
    if (!tile) return false;
    const layoutKey = await this.layoutKeyFor(tile.layout);
    type StoredMap = Record<string, { url: string; kind: "tile" | "unique" }>;
    let stored: StoredMap | null;
    try {
      const raw = localStorage.getItem(`fps_atlas:${layoutKey}`);
      stored = raw ? (JSON.parse(raw) as StoredMap) : null;
    } catch {
      stored = null;
    }
    if (!stored) return false;
    const images = new Map<string, AtlasImage>();
    try {
      await Promise.all(
        Object.entries(stored).map(async ([cellKey, c]) => {
          const img = await this.fetchImage(`${this.urls.assets}${c.url}`);
          images.set(cellKey, { image: img, kind: c.kind });
        }),
      );
    } catch {
      // Blob podado o asset-store caído: invalidar y seguir por resolve.
      try {
        localStorage.removeItem(`fps_atlas:${layoutKey}`);
      } catch {
        /* best-effort */
      }
      return false;
    }
    if (images.size === 0) return false;
    this.deps.apply(key, images);
    this.cache.set(key, { layoutKey, images });
    this.deps.log(`Atlas fps de ${key} restaurado (mapping local, $0)`);
    return true;
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
