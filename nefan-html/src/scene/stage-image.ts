/** Pipeline de imagen del PROSCENIO (entrega 2): repintado del plató entero
 *  (máxima integración — la lección del render_lab) + SEGMENTACIÓN por IA de
 *  lo PINTADO con comprobación por visión:
 *
 *    1. blueprint (capas del compositor SIN cuarta pared) → /generate_scene_image
 *       (blueprint_kind "stage") → plató pintado.
 *    2. /review_stage_image: la VISIÓN inventaría lo pintado — cada elemento
 *       declarado found (con su caja REAL) o missing + extras inventados +
 *       la línea de suelo (floor) — y SAM2 extrae la máscara de la IMAGEN de
 *       cada item.
 *    3. La perspectiva PINTADA manda: calibratedProjection reajusta
 *       ground_y/horizon_y a la línea de suelo pintada; de la línea de
 *       contacto de cada máscara salen su z de plató, su huella de mundo y la
 *       colisión (bandas que siguen la inclinación pintada).
 *    4. Pelado cerca→lejos por z PINTADA con /peel_scene_layer (LaMa local
 *       por defecto — FLUX reinventa el mueble en su propio hueco, bench
 *       stage_lab 003); la imagen final es la PLACA. Recorte de cada item =
 *       imagen ⊙ su máscara SAM (feather 1.5 px).
 *    5. Instalación atómica: placa + recortes con pose + colisión derivada +
 *       proyección calibrada. Chequeo de reconstrucción (placa+recortes ≈
 *       original) como smoke-test de integridad.
 *
 *  PROHIBIDO recortar con siluetas DECLARADAS (SVG del compositor): el modelo
 *  de imagen recoloca y reorienta lo declarado — la silueta declarada recorta
 *  SUELO con forma de objeto. Lo declarado solo viaja como pista
 *  (expected_elements) y como profundidad de huella. Si la visión no está
 *  disponible, se instala SOLO la placa (sin recortes ni colisión derivada:
 *  sigue la declarada).
 *
 *  ESPACIO CUADRADO: el server pre-estira a cuadrado (prestretch, bench 002),
 *  así que blueprint, máscaras, recortes y placa viven en 1024×1024; el
 *  renderer des-estira al pintar cada bitmap sobre el rect del viewBox. */

import {
  STAGE_PEEL_VERSION,
  STAGE_RENDER_SIZE,
  expectedElementsFor,
  calibratedProjection,
  declaredLayerHeightM,
  fitSpriteScale,
  SPRITE_SCALE_IDENTITY,
  type SpriteScaleModel,
  type SpriteScalePoint,
  contactToPose,
  footprintFromContact,
  matchInventory,
  peelStepsFromInventory,
  collisionGridFromCutouts,
  reconstructionDiff,
  pxToView,
  type ComposedStage,
  type StageProjParams,
  type StageReviewItem,
  type PaintedFloor,
  type CollisionCutout,
} from "@nefan-core/src/scene/stage/index.js";
import type { TerrainGridData } from "@nefan-core/src/scene/terrain-collision.js";
import { errors } from "../ui/error-log.js";

const RENDER_SIZE = STAGE_RENDER_SIZE;
/** Celda de la colisión derivada (m) — la misma del resto del mundo. */
const STAGE_CELL_MPC = 0.5;

/** Recorte instalable de UN elemento PINTADO del plató. */
export interface StageCutout {
  id: string;
  /** layerId del compositor si es un elemento declarado casado. */
  layerId?: string;
  label: string;
  /** Full-frame 1024² RGBA: la imagen ⊙ su máscara SAM. */
  canvas: HTMLCanvasElement;
  /** zStage PINTADA (mediana del contacto, proyección calibrada). */
  z: number;
  /** [minX, minY, maxX, maxY] en unidades de VISTA (test de cobertura del fade). */
  bboxView: [number, number, number, number];
  footprintWorld: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  solid: boolean;
  tall: boolean;
}

export interface StageImages {
  /** Versión del pipeline (invalida instalaciones de algoritmos previos). */
  peelVersion: number;
  /** Placa final: el plató sin los elementos pelados, espacio cuadrado. */
  plate: HTMLCanvasElement;
  cutouts: StageCutout[];
  /** Colisión derivada de lo PINTADO; null = review no disponible (placa
   *  sola — la colisión declarada sigue activa). */
  collision: TerrainGridData | null;
  /** layerIds declarados que el modelo NO pintó (sin recorte ni colisión). */
  missing: string[];
  /** Proyección calibrada a la perspectiva pintada; null = sin review. */
  paintedProj: StageProjParams | null;
  /** Modelo de talla de sprites vs el mobiliario PINTADO (los TAMAÑOS de la
   *  pintura llevan su propia perspectiva, distinta de la del suelo). */
  spriteScale: SpriteScaleModel;
}

export interface StageImageMeta {
  /** scene_description — el "Render the scene as:" del repintado. */
  description: string;
  /** stage.backdrop.description — guía del telón en los prompts de pelado. */
  backdrop?: string;
  /** style_tag del motor narrativo ("interior", "settlement"…). */
  styleTag: string;
}

export interface StageImageDeps {
  /** Instalación atómica en el renderer + colisión (ignora si la escena cambió). */
  install(key: string, images: StageImages): void;
  log(msg: string): void;
  /** Progreso vivo para el HUD (null = pipeline en reposo). */
  status(text: string | null): void;
}

/** Cap de la caché cliente de platós pintados (un playthrough ronda pocos
 *  platós vivos; el server cachea igual — esto solo ahorra los round-trips
 *  al VOLVER a una escena ya pintada). */
const CLIENT_CACHE_MAX = 12;

/** Umbral de aviso del log de recolocación (z pintada vs declarada, m). */
const RELOCATION_LOG_M = 2;

interface ReviewResponse {
  items: StageReviewItem[];
  missing: string[];
  floor: PaintedFloor;
}

export class StageImageController {
  private styleId = "";
  private token = 0;
  private busy = false;
  /** Caché cliente por escena: al volver a un plató ya pintado, reinstalar
   *  sin red (colisión y proyección calibrada viajan dentro). La clave valida
   *  contra el SVG compuesto Y la versión del pipeline. */
  private cache = new Map<string, { svg: string; images: StageImages }>();

  constructor(
    private readonly baseUrl: string,
    private readonly deps: StageImageDeps,
  ) {
    HOT_REGISTRY.add(this);
  }

  setStyle(styleId: string): void {
    this.styleId = styleId;
  }

  get running(): boolean {
    return this.busy;
  }

  /** Reinstala las imágenes cacheadas de `key` si el plató no cambió.
   *  true = instaladas (sin red); false = no hay caché válida. */
  reinstallIfCached(stage: ComposedStage, key: string): boolean {
    const hit = this.cache.get(key);
    if (!hit || hit.svg !== stage.svg || hit.images.peelVersion !== STAGE_PEEL_VERSION) return false;
    this.deps.install(key, hit.images);
    console.log(`[stage-img] ${key}: reinstalado de caché cliente (${hit.images.cutouts.length} recortes)`);
    return true;
  }

  /** Repinta, inventaría por visión, segmenta y pela el plató `key`. Un plató
   *  nuevo mientras corre otro aborta el anterior (token); los errores quedan
   *  en el error-log (fail-loud) y degradan a placa sola. */
  async runFor(stage: ComposedStage, key: string, meta: StageImageMeta): Promise<void> {
    if (this.reinstallIfCached(stage, key)) return;
    const token = ++this.token;
    this.busy = true;
    const t0 = performance.now();
    const ms = () => `${Math.round(performance.now() - t0)}ms`;
    try {
      // ── 1. Repintado ─────────────────────────────────────────────────────
      this.deps.log(`🎨 repintando plató ${key}…`);
      this.deps.status(`plató ${key}: repintando…`);
      console.log(
        `[stage-img] ${key}: repintado → /generate_scene_image ` +
        `(style=${this.styleId || "(global)"}, tag=${meta.styleTag}, "${meta.description.slice(0, 60)}…")`,
      );
      const blueprint = await rasterizeBlueprintSquare(stage);
      const repaintRes = await this.post("/generate_scene_image", {
        image_b64: canvasB64(blueprint),
        prompt: meta.description,
        blueprint_kind: "stage",
        has_water: false,
        style_id: this.styleId,
        style_tag: meta.styleTag,
      });
      if (token !== this.token) return;
      console.log(
        `[stage-img] ${key}: repintado ${repaintRes.cached ? "CACHE HIT" : "generado"} ` +
        `hash=${repaintRes.hash} (${ms()})`,
      );
      const painted = await this.fetchToSquare(String(repaintRes.scene_url));
      if (token !== this.token) return;

      // ── 2. Inventario por visión + SAM ───────────────────────────────────
      const expected = expectedElementsFor(stage);
      this.deps.status(`plató ${key}: inventario por visión (${expected.length} declarados)…`);
      let review: ReviewResponse;
      try {
        review = (await this.post("/review_stage_image", {
          image_b64: canvasB64(painted),
          context: {
            scene_description: meta.description,
            style_tag: meta.styleTag,
            expected_elements: expected,
          },
        })) as unknown as ReviewResponse;
      } catch (err) {
        // Sin visión (503/404) el plató degrada LIMPIO: placa entera, sin
        // recortes ni colisión derivada — la declarada sigue en pie. NUNCA
        // recortar con siluetas SVG como sucedáneo.
        if (token !== this.token) return;
        errors.push("scene", `review del plató ${key} no disponible — placa sola (sin recortes)`, err);
        // SIN caché cliente: si la visión vuelve, la próxima visita reintenta.
        this.deps.install(key, {
          peelVersion: STAGE_PEEL_VERSION,
          plate: painted,
          cutouts: [],
          collision: null,
          missing: [],
          paintedProj: null,
          spriteScale: SPRITE_SCALE_IDENTITY,
        });
        console.log(`[stage-img] ${key}: DEGRADADO a placa sola (${ms()})`);
        return;
      }
      if (token !== this.token) return;
      const inventory = matchInventory(expected.map((e) => e.id), review.items);
      console.log(
        `[stage-img] ${key}: inventario — ${inventory.matched.size} declarados encontrados, ` +
        `${inventory.extras.length} extras, missing=[${review.missing.join(", ") || "ninguno"}], ` +
        `floor.wall_base=${review.floor.wall_base_px}px`,
      );

      // ── 3. La perspectiva PINTADA manda ──────────────────────────────────
      // Con el trapecio lateral del floor, calibra TAMBIÉN ppm/focal/centro:
      // el rect jugable mapea exacto al suelo pintado (cero muros invisibles,
      // personajes a la escala de la pintura). Degradación con aviso.
      const vb = stage.view_box;
      const calWarnings: string[] = [];
      const paintedProj = calibratedProjection(stage.proj, vb, review.floor, RENDER_SIZE, calWarnings);
      for (const w of calWarnings) errors.push("scene", `calibración del plató ${key}: ${w}`);
      const lateral = paintedProj.center_x !== undefined;
      console.log(
        `[stage-img] ${key}: calibración ${lateral ? "COMPLETA" : "solo vertical"} — ` +
        `focal=${paintedProj.focal_m.toFixed(1)}m ppm=${paintedProj.px_per_m.toFixed(2)}` +
        (lateral ? ` cx=${paintedProj.center_x!.toFixed(1)} camX=${paintedProj.cam_x_m!.toFixed(2)}m` : ""),
      );
      const rect = {
        minX: -stage.proj.width_m / 2,
        minZ: -stage.proj.depth_m / 2,
        maxX: stage.proj.width_m / 2,
        maxZ: stage.proj.depth_m / 2,
      };
      const layersById = new Map(stage.layers.map((l) => [l.id, l]));

      interface WorkItem {
        item: StageReviewItem;
        mask: HTMLCanvasElement | null;
        z: number | null;
        contactWorld: [number, number][] | null;
        depthM: number;
      }
      const work: WorkItem[] = [];
      for (const item of review.items) {
        this.deps.status(`plató ${key}: segmentando ${item.label}…`);
        const mask = item.mask_url ? await this.fetchToSquare(item.mask_url) : null;
        if (token !== this.token) return;
        let z: number | null = null;
        let contactWorld: [number, number][] | null = null;
        const layer = item.source === "expected" ? layersById.get(item.id) : undefined;
        const depthM = layer?.footprint
          ? layer.footprint[3] - layer.footprint[1]
          : (item.depth_cells ?? 2) * STAGE_CELL_MPC;
        if (item.action === "keep" && item.contact_px?.length) {
          const pose = contactToPose(paintedProj, vb, rect, item.contact_px);
          if (pose) {
            z = pose.z;
            contactWorld = pose.contactWorld;
            const declaredZ = layer?.z;
            if (declaredZ !== undefined && Math.abs(z - declaredZ) > RELOCATION_LOG_M) {
              console.log(
                `[stage-img] ${key}: "${item.label}" RECOLOCADO — z pintada ${z.toFixed(1)} vs declarada ${declaredZ.toFixed(1)}`,
              );
            }
          } else {
            errors.push("scene", `"${item.label}" (${key}) sin contacto útil — se pela sin recorte`);
          }
        }
        work.push({ item, mask, z, contactWorld, depthM });
      }

      // ── 4. Pelado cerca→lejos por z PINTADA ──────────────────────────────
      const steps = peelStepsFromInventory(
        work.filter((w) => w.mask !== null).map((w) => ({ item: w.item, z: w.z })),
        meta.backdrop,
      );
      const workById = new Map(work.map((w) => [w.item.id, w]));
      const cutouts: StageCutout[] = [];
      let current = painted;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const w = workById.get(step.itemId)!;
        this.deps.log(`🫳 pelando ${step.label} (${i + 1}/${steps.length})`);
        this.deps.status(`plató ${key}: pelando ${step.label} (${i + 1}/${steps.length})`);
        // El recorte se toma de la imagen ANTES de pelar este item —
        // máscara SAM del elemento PINTADO, jamás una silueta declarada.
        if (step.action === "keep" && w.z !== null) {
          const [bx, by, bw, bh] = w.item.image_bbox;
          const [vx0, vy0] = pxToView(vb, bx, by);
          const [vx1, vy1] = pxToView(vb, bx + bw, by + bh);
          cutouts.push({
            id: w.item.id,
            ...(w.item.source === "expected" ? { layerId: w.item.id } : {}),
            label: w.item.label,
            canvas: cutoutByMask(current, w.mask!),
            z: w.z,
            bboxView: [vx0, vy0, vx1, vy1],
            footprintWorld:
              w.item.solid !== false && w.contactWorld
                ? footprintFromContact(w.contactWorld, w.depthM)
                : null,
            solid: w.item.solid !== false,
            tall: w.item.tall !== false,
          });
        }
        const peelRes = await this.post("/peel_scene_layer", {
          image_b64: canvasB64(current),
          mask_b64: canvasB64(maskToWhite(w.mask!)),
          prompt: step.prompt,
          backend: "lama",
        });
        if (token !== this.token) return;
        console.log(
          `[stage-img] ${key}: pelada "${step.label}" (${i + 1}/${steps.length}) ` +
          `backend=${peelRes.backend ?? "?"} ${peelRes.cached ? "CACHE HIT" : "generado"} ` +
          `detrás=[${step.behindLabels.join(", ") || "suelo"}] (${ms()})`,
        );
        current = await this.fetchToSquare(String(peelRes.peeled_url));
        if (token !== this.token) return;
      }

      // ── 5. Colisión de lo PINTADO + chequeo de reconstrucción ────────────
      const collCutouts: CollisionCutout[] = [];
      for (const w of work) {
        if (w.item.action === "keep" && w.item.solid !== false && w.contactWorld) {
          collCutouts.push({
            id: w.item.id,
            label: w.item.label,
            contactWorld: w.contactWorld,
            depthM: w.depthM,
          });
        }
      }
      const { grid, warnings } = collisionGridFromCutouts(collCutouts, rect, stage.exits, STAGE_CELL_MPC);
      for (const warn of warnings) errors.push("scene", `${key}: ${warn}`);

      this.checkReconstruction(key, painted, current, work, cutouts);

      const missing = [...new Set([...review.missing, ...inventory.missing])];
      // Talla de sprites: los personajes se miden contra el MOBILIARIO
      // pintado. El suelo gobierna las POSICIONES; los tamaños pintados
      // llevan su propia perspectiva (una plaza frontal casi ortográfica
      // encoge puertas 2× al fondo) — se ajusta {k, focal_size} a los ratios.
      const layersById2 = new Map(stage.layers.map((l) => [l.id, l]));
      const scalePoints: SpriteScalePoint[] = [];
      for (const cut of cutouts) {
        const layer = cut.layerId ? layersById2.get(cut.layerId) : undefined;
        const w = workById.get(cut.id);
        const hM = layer
          ? declaredLayerHeightM(layer, stage.proj)
          : (typeof w?.item.h === "number" ? w.item.h : null);
        if (!hM) continue;
        scalePoints.push({ z: cut.z, paintedView: cut.bboxView[3] - cut.bboxView[1], hM });
      }
      const spriteScale = fitSpriteScale(scalePoints, paintedProj);
      if (Math.abs(spriteScale.k - 1) > 0.05 || spriteScale.focal_size_m > 0) {
        console.log(
          `[stage-img] ${key}: talla de sprites k=${spriteScale.k.toFixed(2)} ` +
          `focal_size=${spriteScale.focal_size_m.toFixed(1)}m (${scalePoints.length} puntos)`,
        );
      }
      this.installAndCache(stage, key, {
        peelVersion: STAGE_PEEL_VERSION,
        plate: current,
        cutouts,
        collision: grid,
        missing,
        paintedProj,
        spriteScale,
      });
      this.deps.log(`🎨 plató ${key} pintado (${cutouts.length} recortes segmentados)`);
      console.log(
        `[stage-img] ${key}: COMPLETO — placa + ${cutouts.length} recortes + ` +
        `${grid.grid.join("").split("S").length - 1} celdas sólidas pintadas (${ms()})`,
      );
    } catch (err) {
      console.error(`[stage-img] ${key}: FALLO —`, err);
      errors.push("scene", `pipeline de imagen del plató ${key} falló`, err);
    } finally {
      if (token === this.token) {
        this.busy = false;
        this.deps.status(null);
      }
    }
  }

  private installAndCache(stage: ComposedStage, key: string, images: StageImages): void {
    this.cache.set(key, { svg: stage.svg, images });
    while (this.cache.size > CLIENT_CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    this.deps.install(key, images);
  }

  /** Smoke-test de integridad: placa + recortes (lejos→cerca) ≈ original,
   *  fuera de los halos dilatados del inpaint. NO detecta elementos sin
   *  identificar (esa garantía es el inventario de la visión) — caza bugs de
   *  coordenadas/composición. Solo avisa, nunca bloquea la instalación. */
  private checkReconstruction(
    key: string,
    painted: HTMLCanvasElement,
    plate: HTMLCanvasElement,
    work: { item: StageReviewItem; mask: HTMLCanvasElement | null }[],
    cutouts: StageCutout[],
  ): void {
    try {
      const recon = document.createElement("canvas");
      recon.width = RENDER_SIZE;
      recon.height = RENDER_SIZE;
      const rctx = recon.getContext("2d")!;
      rctx.drawImage(plate, 0, 0);
      for (const cut of [...cutouts].sort((a, b) => b.z - a.z)) {
        rctx.drawImage(cut.canvas, 0, 0);
      }
      // Exclusión: máscaras dilatadas ±16 px (halos del inpaint) — dilatación
      // barata con 9 draws desplazados, como la placa de la oblicua.
      const excl = document.createElement("canvas");
      excl.width = RENDER_SIZE;
      excl.height = RENDER_SIZE;
      const ectx = excl.getContext("2d")!;
      for (const w of work) {
        if (!w.mask) continue;
        // Alpha (no L opaca): dibujar varias máscaras opacas se pisarían.
        const alpha = maskLuminanceToAlpha(w.mask);
        for (const dx of [-16, 0, 16]) {
          for (const dy of [-16, 0, 16]) {
            ectx.drawImage(alpha, dx, dy);
          }
        }
      }
      const exclData = ectx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
      const exclMask = new Uint8Array(RENDER_SIZE * RENDER_SIZE);
      for (let i = 0; i < exclMask.length; i++) exclMask[i] = exclData[i * 4 + 3] > 32 ? 1 : 0;
      const a = painted.getContext("2d")!.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
      const b = rctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
      const report = reconstructionDiff(a, b, RENDER_SIZE, RENDER_SIZE, exclMask);
      console.log(
        `[stage-img] ${key}: reconstrucción — diff medio ${report.meanDiff.toFixed(2)}/255, ` +
        `${report.hotBlocks.length} bloques calientes`,
      );
      if (report.meanDiff > 3 || report.hotBlocks.length > 0) {
        errors.push(
          "scene",
          `reconstrucción del plató ${key} difiere (media ${report.meanDiff.toFixed(1)}, ` +
          `${report.hotBlocks.length} bloques>25 — peor en ` +
          `${report.hotBlocks[0] ? `${report.hotBlocks[0].x},${report.hotBlocks[0].y}` : "—"})`,
        );
      }
    } catch (err) {
      errors.push("scene", `chequeo de reconstrucción de ${key} falló`, err);
    }
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  /** Descarga una imagen del cache del ai_server y la deja en el canvas
   *  cuadrado de trabajo (el server puede devolver otras resoluciones). */
  private async fetchToSquare(urlPath: string): Promise<HTMLCanvasElement> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = urlPath.startsWith("http") ? urlPath : `${this.baseUrl}${urlPath}`;
    await img.decode();
    const canvas = makeCanvas();
    canvas.getContext("2d")!.drawImage(img, 0, 0, RENDER_SIZE, RENDER_SIZE);
    return canvas;
  }
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = RENDER_SIZE;
  c.height = RENDER_SIZE;
  return c;
}

/** Blueprint del repintado: las capas del compositor SIN la cuarta pared
 *  (taparía la banda inferior y el modelo la reinterpreta como suelo — bench
 *  stage_lab). Cada capa es un SVG standalone con el viewBox común; se
 *  estiran a cuadrado (espejo del prestretch del server). */
async function rasterizeBlueprintSquare(stage: ComposedStage): Promise<HTMLCanvasElement> {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d")!;
  for (const layer of stage.layers) {
    if (layer.kind === "fourth_wall") continue;
    const blob = new Blob([layer.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.drawImage(img, 0, 0, RENDER_SIZE, RENDER_SIZE);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return canvas;
}

/** La máscara del server es L OPACA (blanco = elemento): para componer con
 *  source-in hace falta que la silueta viva en el canal ALPHA. */
function maskLuminanceToAlpha(mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas();
  const ctx = out.getContext("2d")!;
  ctx.drawImage(mask, 0, 0);
  const img = ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE);
  const d = img.data;
  for (let i = 0; i < RENDER_SIZE * RENDER_SIZE; i++) {
    d[i * 4 + 3] = d[i * 4];
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Recorte full-frame: imagen ⊙ máscara SAM del elemento PINTADO. El borde se
 *  EMPLUMA (blur ligero) para fundirlo con el halo inpainted de la placa (la
 *  máscara del pelado va dilatada ±16 px en el server). */
function cutoutByMask(image: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas();
  const ctx = out.getContext("2d")!;
  ctx.filter = "blur(1.5px)";
  ctx.drawImage(maskLuminanceToAlpha(mask), 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-in";
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return out;
}

/** Máscara L del server sobre fondo negro (blanco = hueco a pelar). */
function maskToWhite(mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas();
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);
  ctx.drawImage(mask, 0, 0);
  return out;
}

/** PNG base64 (sin prefijo data:) de un canvas. */
function canvasB64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png").split(",")[1];
}

// ── HMR (dev): parchear el prototipo de las instancias vivas — la partida
// (plató pintado, caché cliente) sobrevive a la iteración de código. Un
// cambio aquí o en sus imports de nefan-core NO recarga la página. ─────────
type HotWindow = Window & { __nefanHotStageImage?: Set<StageImageController> };
const HOT_REGISTRY: Set<StageImageController> =
  ((window as HotWindow).__nefanHotStageImage ??= new Set());
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const Next = (mod as { StageImageController?: typeof StageImageController } | undefined)?.StageImageController;
    if (!Next) return import.meta.hot!.invalidate();
    for (const inst of HOT_REGISTRY) Object.setPrototypeOf(inst, Next.prototype);
    console.log(`[hmr] StageImageController parcheado (${HOT_REGISTRY.size} instancia/s)`);
  });
}
