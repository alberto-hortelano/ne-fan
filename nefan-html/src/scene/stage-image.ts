/** Pipeline de imagen del PROSCENIO (entrega 2): repintado del plató entero
 *  (máxima integración — la lección del render_lab) y PELADO capa a capa de
 *  cerca a lejos con las máscaras DECLARADAS del compositor (sin SAM ni
 *  visión para el mundo declarado):
 *
 *    1. blueprint = raster del SVG compuesto → /generate_scene_image
 *       (blueprint_kind "stage") → plató pintado.
 *    2. por cada volumen (cerca→lejos): recorte = imagen ⊙ alpha de su capa;
 *       /peel_scene_layer (FLUX Fill/LaMa, prompt = behind_labels) rellena su
 *       hueco → imagen sin él.
 *    3. la imagen final (todo pelado) es la PLACA (telón + suelo); se instala
 *       todo junto en el ProsceniumRenderer (atómico: nunca capas a medias).
 *
 *  ESPACIO CUADRADO: el server pre-estira a cuadrado (prestretch, bench 002),
 *  así que blueprint, máscaras, recortes y placa viven en 1024×1024; el
 *  renderer des-estira al pintar cada bitmap sobre el rect del viewBox. */

import {
  peelPlanFor,
  STAGE_PEEL_VERSION,
  type ComposedStage,
} from "@nefan-core/src/scene/stage/index.js";
import { errors } from "../ui/error-log.js";

const RENDER_SIZE = 1024;

export interface StageImages {
  /** Versión del pipeline (invalida instalaciones de algoritmos previos). */
  peelVersion: number;
  /** Placa final: el plató sin volúmenes (telón + suelo), espacio cuadrado. */
  plate: HTMLCanvasElement;
  /** Recorte con alpha por capa de volumen (layerId → bitmap cuadrado). */
  cutouts: Map<string, HTMLCanvasElement>;
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
  /** Instalación atómica en el renderer (ignora si la escena ya cambió). */
  install(key: string, images: StageImages): void;
  log(msg: string): void;
}

/** Cap de la caché cliente de platós pintados (un playthrough ronda pocos
 *  platós vivos; el server cachea igual — esto solo ahorra los round-trips
 *  al VOLVER a una escena ya pintada). */
const CLIENT_CACHE_MAX = 12;

export class StageImageController {
  private styleId = "";
  private token = 0;
  private busy = false;
  /** Caché cliente por escena: al volver a un plató ya pintado, reinstalar
   *  sin red. La clave valida contra el SVG compuesto (determinista): si el
   *  plató cambió (retoque del motor), la entrada se descarta. */
  private cache = new Map<string, { svg: string; images: StageImages }>();

  constructor(
    private readonly baseUrl: string,
    private readonly deps: StageImageDeps,
  ) {}

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
    if (!hit || hit.svg !== stage.svg) return false;
    this.deps.install(key, hit.images);
    console.log(`[stage-img] ${key}: reinstalado de caché cliente (${hit.images.cutouts.size} recortes)`);
    return true;
  }

  /** Repinta y pela el plató `key`. Un plató nuevo mientras corre otro aborta
   *  el anterior (token); los errores quedan en el error-log (fail-loud). */
  async runFor(stage: ComposedStage, key: string, meta: StageImageMeta): Promise<void> {
    if (this.reinstallIfCached(stage, key)) return;
    const token = ++this.token;
    this.busy = true;
    const t0 = performance.now();
    const ms = () => `${Math.round(performance.now() - t0)}ms`;
    try {
      this.deps.log(`🎨 repintando plató ${key}…`);
      console.log(
        `[stage-img] ${key}: repintado → /generate_scene_image ` +
        `(style=${this.styleId || "(global)"}, tag=${meta.styleTag}, "${meta.description.slice(0, 60)}…")`,
      );
      const blueprint = await rasterizeSvgSquare(stage.svg);
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

      const plan = peelPlanFor(stage, { backdrop: meta.backdrop });
      console.log(`[stage-img] ${key}: plan de pelado v${plan.version} — ${plan.steps.length} capas (cerca→lejos)`);
      const cutouts = new Map<string, HTMLCanvasElement>();
      let current = painted;
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        this.deps.log(`🫳 pelando ${step.label} (${i + 1}/${plan.steps.length})`);
        const maskAlpha = await rasterizeSvgSquare(step.maskSvg);
        cutouts.set(step.layerId, cutoutByAlpha(current, maskAlpha));
        const peelRes = await this.post("/peel_scene_layer", {
          image_b64: canvasB64(current),
          mask_b64: canvasB64(alphaToWhiteMask(maskAlpha)),
          prompt: step.prompt,
        });
        if (token !== this.token) return;
        console.log(
          `[stage-img] ${key}: pelada "${step.label}" (${i + 1}/${plan.steps.length}) ` +
          `backend=${peelRes.backend ?? "?"} ${peelRes.cached ? "CACHE HIT" : "generado"} ` +
          `detrás=[${step.behindLabels.join(", ") || "suelo"}] (${ms()})`,
        );
        current = await this.fetchToSquare(String(peelRes.peeled_url));
        if (token !== this.token) return;
      }

      const images: StageImages = {
        peelVersion: STAGE_PEEL_VERSION,
        plate: current,
        cutouts,
      };
      this.cache.set(key, { svg: stage.svg, images });
      while (this.cache.size > CLIENT_CACHE_MAX) {
        const oldest = this.cache.keys().next().value as string;
        this.cache.delete(oldest);
      }
      this.deps.install(key, images);
      this.deps.log(`🎨 plató ${key} pintado (${plan.steps.length} capas peladas)`);
      console.log(`[stage-img] ${key}: COMPLETO — placa + ${cutouts.size} recortes instalados (${ms()})`);
    } catch (err) {
      console.error(`[stage-img] ${key}: FALLO —`, err);
      errors.push("scene", `repintado del plató ${key} falló`, err);
    } finally {
      if (token === this.token) this.busy = false;
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

/** SVG standalone → canvas cuadrado (ESTIRADO — espejo del prestretch). */
async function rasterizeSvgSquare(svg: string): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = makeCanvas();
    canvas.getContext("2d")!.drawImage(img, 0, 0, RENDER_SIZE, RENDER_SIZE);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Recorte: imagen ⊙ alpha de la capa (misma operación de máscara declarada
 *  que el modo "masks" de la oblicua). El borde se EMPLUMA (blur ligero):
 *  cuando el modelo pinta el objeto algo más grande que su huella declarada,
 *  el corte duro canta — el degradado lo funde con el halo inpainted de la
 *  placa (la máscara del pelado va dilatada ±8 px). */
function cutoutByAlpha(image: HTMLCanvasElement, maskAlpha: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas();
  const ctx = out.getContext("2d")!;
  ctx.filter = "blur(1.5px)";
  ctx.drawImage(maskAlpha, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-in";
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return out;
}

/** Alpha de la capa → máscara L del server (blanco = hueco, negro = intacto). */
function alphaToWhiteMask(maskAlpha: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas();
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);
  const white = makeCanvas();
  const wctx = white.getContext("2d")!;
  wctx.drawImage(maskAlpha, 0, 0);
  wctx.globalCompositeOperation = "source-in";
  wctx.fillStyle = "#ffffff";
  wctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);
  ctx.drawImage(white, 0, 0);
  return out;
}

/** PNG base64 (sin prefijo data:) de un canvas. */
function canvasB64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png").split(",")[1];
}
