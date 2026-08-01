/** Pipeline de imagen del PROSCENIO (entrega 2): repintado del plató entero
 *  (máxima integración — la lección del render_lab) e instalación como PLACA.
 *
 *  PROHIBIDO — no reintroducir nunca el recorte por siluetas DECLARADAS
 *  (rasterizar el SVG de una capa del compositor como máscara sobre la imagen
 *  pintada): se probó y NO funciona — el modelo de imagen recoloca y
 *  reorienta lo declarado, así que la silueta declarada recorta SUELO con
 *  forma de objeto y el objeto real queda cocido en la placa. Jamás va a
 *  funcionar. Los recortes deben salir de segmentar lo que el modelo PINTÓ
 *  (visión localiza cada elemento → SAM2 segment_boxes → máscara de IMAGEN);
 *  el plan declarado solo vale como pista (etiquetas + cajas esperadas).
 *  Hasta que ese pipeline exista, se instala SOLO la placa (sin recortes):
 *  sin parallax de volúmenes, pero sin siluetas falsas.
 *
 *  ESPACIO CUADRADO: el server pre-estira a cuadrado (prestretch, bench 002),
 *  así que blueprint, máscaras, recortes y placa viven en 1024×1024; el
 *  renderer des-estira al pintar cada bitmap sobre el rect del viewBox. */

import {
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
  /** Progreso vivo para el HUD (null = pipeline en reposo). */
  status(text: string | null): void;
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
      this.deps.status(`plató ${key}: repintando…`);
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

      // Recortes: PENDIENTE el pipeline por segmentación de lo PINTADO
      // (visión → SAM2 segment_boxes → máscara de imagen). Hasta entonces,
      // placa sola — JAMÁS recortar con las siluetas declaradas del SVG (ver
      // cabecera del fichero).
      const images: StageImages = {
        peelVersion: STAGE_PEEL_VERSION,
        plate: painted,
        cutouts: new Map<string, HTMLCanvasElement>(),
      };
      this.cache.set(key, { svg: stage.svg, images });
      while (this.cache.size > CLIENT_CACHE_MAX) {
        const oldest = this.cache.keys().next().value as string;
        this.cache.delete(oldest);
      }
      this.deps.install(key, images);
      this.deps.log(`🎨 plató ${key} pintado (placa; recortes pendientes de segmentación)`);
      console.log(`[stage-img] ${key}: COMPLETO — placa instalada, 0 recortes (segmentación pendiente) (${ms()})`);
    } catch (err) {
      console.error(`[stage-img] ${key}: FALLO —`, err);
      errors.push("scene", `repintado del plató ${key} falló`, err);
    } finally {
      if (token === this.token) {
        this.busy = false;
        this.deps.status(null);
      }
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
