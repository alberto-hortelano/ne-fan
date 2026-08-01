/** Renderer de la vista PROSCENIO — el plató de cine clásico.
 *
 *  Delgado a propósito: toda la geometría (proyección perspectiva, capas,
 *  cámara de raíl, zonas de salida, fade de la cuarta pared) viene compuesta
 *  y testeada de `nefan-core/src/scene/stage/`. Aquí solo se rasterizan las
 *  capas SVG (una vez por escena), se panea la cámara y se insertan los
 *  sprites entre capas por profundidad.
 *
 *  Convención de cámara: SUR (ver stage/projection.ts). El paneo del raíl es
 *  UNIFORME (desliza la pintura entera, punto de fuga incluido) — el decorado
 *  es una pintura con la perspectiva horneada, como los sets pintados del
 *  cine clásico; así los sprites nunca se desalinean de su capa. */

import type { Vec3 } from "@nefan-core/src/types.js";
import {
  scaleAt,
  stageToView,
  worldToStage,
  railCamera,
  fourthWallAlpha,
  exitZoneAt,
  type ComposedStage,
  type StageLayer,
} from "@nefan-core/src/scene/stage/index.js";
import type { SpriteRenderer } from "./sprite-renderer.js";
import type { Entity } from "./canvas-renderer.js";
import type { StageImages } from "../scene/stage-image.js";
import type { AttackAreaParams, PlayerView, Renderer2D } from "./renderer2d.js";
import { errors } from "../ui/error-log.js";

/** Espejo de las constantes de sprites del CanvasRenderer (encuadre ortho 2.4
 *  del renderer Godot + pitch −30° de los sheets isometric_30). */
const SHEET_FRAME_WORLD_M = 2.4;
const SPRITE_PITCH_COS = Math.cos(Math.PI / 6);
/** Clamp inferior de la escala por profundidad: por debajo, los 8 octantes
 *  isometric_30 dejan de leerse. */
const MIN_DEPTH_SCALE = 0.55;
const RAIL_DEAD_ZONE_M = 1.5;
const RAIL_RATE = 6;
const PLAYER_COLOR = "#e8a13c";
const NPC_COLOR = "#6688cc";

interface RasterLayer {
  layer: StageLayer;
  img: HTMLImageElement | null;
}

export interface ProsceniumRendererOptions {
  spriteRenderer?: SpriteRenderer;
}

export class ProsceniumRenderer implements Renderer2D {
  private readonly ctx: CanvasRenderingContext2D;
  private stage: ComposedStage | null = null;
  private stageKey = "";
  private rasters: RasterLayer[] = [];
  /** Imágenes del pipeline de pelado (entrega 2): placa + recortes por capa,
   *  en ESPACIO CUADRADO — se des-estiran al pintarlas sobre el viewBox.
   *  null = plató vectorial (v1 o pipeline aún en vuelo). */
  private images: StageImages | null = null;
  private camX = 0;
  private lastNow = 0;
  /** Token de instalación: una escena que llega mientras otra rasteriza
   *  invalida a la anterior (nunca capas mezcladas). */
  private installToken = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: ProsceniumRendererOptions = {},
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ProsceniumRenderer: canvas sin contexto 2d");
    this.ctx = ctx;
  }

  hasStage(): boolean {
    return this.stage !== null;
  }

  getStage(): ComposedStage | null {
    return this.stage;
  }

  clearStage(): void {
    this.installToken++;
    this.stage = null;
    this.stageKey = "";
    this.rasters = [];
    this.images = null;
  }

  /** Instalación ATÓMICA de las imágenes del pelado. Ignora (con aviso) si la
   *  escena activa ya no es la que se pintó — nunca bitmaps de otro plató. */
  installImages(key: string, images: StageImages): void {
    if (key !== this.stageKey) {
      errors.push("render", `imágenes del plató ${key} descartadas: la escena activa es ${this.stageKey || "(ninguna)"}`);
      return;
    }
    this.images = images;
  }

  hasImages(): boolean {
    return this.images !== null;
  }

  /** Instala la escena ÚNICA del plató: rasteriza cada capa SVG a un
   *  HTMLImageElement (decodificado antes de instalarse — sin parpadeo de
   *  capas a medias). Reemplaza cualquier escena anterior. */
  async installStage(stage: ComposedStage, key: string): Promise<void> {
    const token = ++this.installToken;
    const rasters: RasterLayer[] = [];
    for (const layer of stage.layers) {
      try {
        const img = await rasterizeSvg(layer.svg);
        rasters.push({ layer, img });
      } catch (err) {
        errors.push("render", `capa ${layer.id} de ${key} no rasteriza — se omite`, err);
        rasters.push({ layer, img: null });
      }
    }
    if (token !== this.installToken) return; // llegó otra escena mientras tanto
    this.stage = stage;
    this.stageKey = key;
    this.rasters = rasters;
    this.images = null; // plató nuevo: bitmaps del anterior fuera
    // Cámara al centro del raíl (el spawn la reencuadra en el primer frame).
    this.camX = (stage.bounds.minX + stage.bounds.maxX) / 2;
  }

  render(player: PlayerView, enemies: Entity[], objects: Entity[], npcs: Entity[]): void {
    const { ctx, canvas } = this;
    const now = performance.now();
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;

    ctx.fillStyle = "#0a0810";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const stage = this.stage;
    if (!stage) {
      ctx.fillStyle = "#a99f92";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Preparando el escenario…", canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "left";
      return;
    }

    // ── Encaje y raíl ────────────────────────────────────────────────────────
    const vb = stage.view_box;
    const fit = canvas.height / vb.height;
    const ppm = stage.proj.px_per_m;
    const centerX = (stage.bounds.minX + stage.bounds.maxX) / 2;
    // Recorrido del raíl: lo que el viewport no abarca del ancho del plató.
    const halfViewportM = canvas.width / fit / 2 / ppm;
    const halfStageM = (vb.width / 2) / ppm;
    const railHalf = Math.max(0, halfStageM - halfViewportM);
    this.camX = railHalf > 0
      ? railCamera(this.camX, player.pos.x, dt, {
          deadZone: RAIL_DEAD_ZONE_M,
          rate: RAIL_RATE,
          minX: centerX - railHalf,
          maxX: centerX + railHalf,
        })
      : centerX;
    /** Paneo en unidades de vista (uniforme para capas y sprites). */
    const panX = (this.camX - centerX) * ppm;
    const toScreen = (vx: number, vy: number): [number, number] => [
      canvas.width / 2 + (vx - panX) * fit,
      (vy - vb.minY) * fit,
    ];

    // ── Entidades ordenadas por profundidad de plató (lejos → cerca) ─────────
    const drawables: Array<{ zs: number; draw: () => void }> = [];
    const pushCharacter = (e: Entity, kind: "npc" | "enemy"): void => {
      if (kind === "npc" && e.alive === false) return; // NPC ausente (director)
      const [xs, zs] = worldToStage(stage.bounds, e.pos.x, e.pos.z);
      drawables.push({ zs, draw: () => this.drawCharacter(e, xs, zs, toScreen, fit, now, kind) });
    };
    for (const e of enemies) pushCharacter(e, "enemy");
    for (const n of npcs) pushCharacter(n, "npc");
    // Los estáticos DECLARADOS en la escena ya son capas del compositor; los
    // spawns dinámicos posteriores (spawn_entity del motor) no tienen capa —
    // caja esquemática a su profundidad (su huella ya colisiona igual).
    const layerIds = new Set(this.rasters.map((r) => r.layer.id));
    for (const o of objects) {
      if (!o.alive) continue;
      if (layerIds.has(`vol_${o.id}`) || layerIds.has(`vol_derived_ent_${o.id}`)) continue;
      const [xs, zs] = worldToStage(stage.bounds, o.pos.x, o.pos.z);
      drawables.push({ zs, draw: () => this.drawSpawnedObject(o, xs, zs, toScreen, fit) });
    }
    {
      const [xs, zs] = worldToStage(stage.bounds, player.pos.x, player.pos.z);
      drawables.push({
        zs,
        draw: () =>
          this.drawCharacter(
            {
              id: "player",
              pos: player.pos,
              forward: player.forward,
              radius: 8,
              color: PLAYER_COLOR,
              label: "",
              alive: true,
              hp: player.hp,
              maxHp: player.maxHp,
              sprite: player.sprite,
            },
            xs,
            zs,
            toScreen,
            fit,
            now,
            "player",
          ),
      });
    }
    drawables.sort((a, b) => b.zs - a.zs);

    // ── Capas + sprites intercalados por z ───────────────────────────────────
    const wallAlpha = fourthWallAlpha(player.pos.z, stage.bounds);
    const images = this.images;
    let di = 0;
    for (const raster of this.rasters) {
      // Entidad delante de la capa ⟺ su zStage < layer.z ⇒ las que tengan
      // zs >= layer.z van ANTES (más al fondo) que esta capa.
      while (di < drawables.length && drawables[di].zs >= raster.layer.z) {
        drawables[di].draw();
        di++;
      }
      const [lx, ly] = toScreen(vb.minX, vb.minY);
      const lw = vb.width * fit;
      const lh = vb.height * fit;
      if (images && raster.layer.kind === "backdrop") {
        // Con pelado instalado, la PLACA (imagen final: telón + suelo sin
        // volúmenes) sustituye a backdrop + floor de una sola pasada.
        ctx.drawImage(images.plate, lx, ly, lw, lh);
        this.drawExitZones(toScreen, fit);
      } else if (images && raster.layer.kind === "floor") {
        // Cubierto por la placa.
      } else if (
        images &&
        (raster.layer.kind === "prop" || raster.layer.kind === "wall") &&
        images.cutouts.has(raster.layer.id)
      ) {
        ctx.drawImage(images.cutouts.get(raster.layer.id)!, lx, ly, lw, lh);
      } else if (raster.img) {
        if (raster.layer.kind === "fourth_wall") ctx.globalAlpha = wallAlpha;
        ctx.drawImage(raster.img, lx, ly, lw, lh);
        ctx.globalAlpha = 1;
      }
      // Las zonas de salida se marcan sobre el suelo, justo tras pintarlo.
      if (!images && raster.layer.kind === "floor") this.drawExitZones(toScreen, fit);
    }
    while (di < drawables.length) drawables[di++].draw();
  }

  /** Marcas de salida: contorno suave + etiqueta sobre la zona (foco teatral
   *  discreto — el jugador debe encontrar las puertas sin adivinar). */
  private drawExitZones(toScreen: (vx: number, vy: number) => [number, number], fit: number): void {
    const stage = this.stage!;
    const ctx = this.ctx;
    for (const exit of stage.exits) {
      const r = exit.rect;
      const corners: Array<[number, number]> = [
        [r.minX, r.minZ],
        [r.maxX, r.minZ],
        [r.maxX, r.maxZ],
        [r.minX, r.maxZ],
      ];
      ctx.beginPath();
      corners.forEach(([wx, wz], i) => {
        const [xs, zs] = worldToStage(stage.bounds, wx, wz);
        const [vx, vy] = stageToView(stage.proj, xs, zs);
        const [sx, sy] = toScreen(vx, vy);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(230, 166, 63, 0.10)";
      ctx.strokeStyle = "rgba(230, 166, 63, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      const [cxs, czs] = worldToStage(stage.bounds, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
      const [cvx, cvy] = stageToView(stage.proj, cxs, czs);
      const [sx, sy] = toScreen(cvx, cvy);
      // Etiqueta en espacio de PANTALLA (tamaño fijo, como los labels de NPC).
      void fit;
      ctx.fillStyle = "rgba(232, 216, 180, 0.8)";
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(exit.label, sx, sy + 14);
      ctx.textAlign = "left";
    }
  }

  /** Caja esquemática de un objeto spawneado en runtime (sin capa del
   *  compositor): a su escala de profundidad, con sombra y etiqueta. */
  private drawSpawnedObject(
    e: Entity,
    xs: number,
    zs: number,
    toScreen: (vx: number, vy: number) => [number, number],
    fit: number,
  ): void {
    const stage = this.stage!;
    const ctx = this.ctx;
    const s = Math.max(MIN_DEPTH_SCALE, scaleAt(stage.proj, zs));
    const [vx, vy] = stageToView(stage.proj, xs, zs);
    const [sx, sy] = toScreen(vx, vy);
    const ppm = stage.proj.px_per_m;
    const w = Math.max(0.6, e.sizeXZ?.x ?? 1) * ppm * s * fit;
    const h = Math.max(0.5, e.sizeY ?? 1) * ppm * s * fit;
    const FILL: Record<string, string> = {
      building: "#5a4a38",
      prop: "#57505a",
      item: "#a8902d",
      decor: "#7a5f33",
      terrain: "#2d4a32",
    };
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(sx, sy, w * 0.55, Math.max(2, w * 0.12), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = FILL[e.category ?? "prop"] ?? FILL.prop;
    ctx.strokeStyle = "rgba(236,228,212,0.35)";
    ctx.lineWidth = 1;
    ctx.fillRect(sx - w / 2, sy - h, w, h);
    ctx.strokeRect(sx - w / 2, sy - h, w, h);
    if (e.label) {
      ctx.fillStyle = "#d8c79a";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(e.label.slice(0, 30), sx, sy - h - 4);
      ctx.textAlign = "left";
    }
  }

  /** Sprite (o círculo) de un personaje a su escala de profundidad, con
   *  sombra de contacto, barra de HP y etiqueta. */
  private drawCharacter(
    e: Entity,
    xs: number,
    zs: number,
    toScreen: (vx: number, vy: number) => [number, number],
    fit: number,
    now: number,
    kind: "player" | "npc" | "enemy",
  ): void {
    const stage = this.stage!;
    const ctx = this.ctx;
    const [vx, vy] = stageToView(stage.proj, xs, zs);
    const [sx, sy] = toScreen(vx, vy);
    const depth = Math.max(MIN_DEPTH_SCALE, scaleAt(stage.proj, zs));
    const frameH = (SHEET_FRAME_WORLD_M / SPRITE_PITCH_COS) * stage.proj.px_per_m * depth * fit;

    // Sombra de contacto (sin ella los recortes flotan).
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(sx, sy, frameH * 0.14, Math.max(2, frameH * 0.035), 0, 0, Math.PI * 2);
    ctx.fill();

    let drewSprite = false;
    if (e.sprite !== undefined && this.opts.spriteRenderer) {
      const sheet = this.opts.spriteRenderer.getCached(e.sprite.model, e.sprite.anim, e.sprite.angle);
      if (sheet) {
        const fwd = e.forward ?? { x: 0, y: 0, z: 1 };
        const t = e.sprite.animStartedAt !== undefined
          ? (now - e.sprite.animStartedAt) / 1000
          : now / 1000;
        drewSprite = this.opts.spriteRenderer.draw(ctx, sheet, fwd.x, fwd.z, t, sx, sy, {
          scale: frameH / sheet.frame_height,
        });
      }
    }
    if (!drewSprite && e.sprite === undefined) {
      // Círculo explícito (sin sprites): radio a escala de profundidad.
      const r = Math.max(4, 0.4 * stage.proj.px_per_m * depth * fit);
      ctx.fillStyle = e.alive ? (kind === "npc" ? NPC_COLOR : e.color) : "#555";
      ctx.globalAlpha = e.alive ? 1 : 0.4;
      ctx.beginPath();
      ctx.arc(sx, sy - r, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const topY = sy - frameH * (drewSprite ? 0.82 : 0.5);
    if (e.hp !== undefined && e.maxHp !== undefined && e.alive) {
      const bw = 24 * depth;
      ctx.fillStyle = "#333";
      ctx.fillRect(sx - bw / 2, topY - 6, bw, 3);
      ctx.fillStyle = kind === "player" ? "#4a9" : e.color;
      ctx.fillRect(sx - bw / 2, topY - 6, bw * Math.max(0, e.hp / e.maxHp), 3);
    }
    const label = e.name ?? (e.label || null);
    if (label && kind !== "player") {
      ctx.fillStyle = kind === "npc" ? "#9be" : "#d8c79a";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(label).slice(0, 30), sx, topY - 10);
      ctx.textAlign = "left";
    }
  }

  /** Área de ataque proyectada al suelo del plató (elipse en perspectiva). */
  drawAttackArea(
    player: { pos: Vec3; forward: Vec3 },
    params: AttackAreaParams,
    mode: "windup" | "impact",
    opacity = 0.3,
    impactQuality = 0,
  ): void {
    const stage = this.stage;
    if (!stage) return;
    const ctx = this.ctx;
    const vb = stage.view_box;
    const fit = this.canvas.height / vb.height;
    const ppm = stage.proj.px_per_m;
    const centerX = (stage.bounds.minX + stage.bounds.maxX) / 2;
    const panX = (this.camX - centerX) * ppm;
    const cx = player.pos.x + player.forward.x * params.optimal_distance;
    const cz = player.pos.z + player.forward.z * params.optimal_distance;
    const [xs, zs] = worldToStage(stage.bounds, cx, cz);
    const [vx, vy] = stageToView(stage.proj, xs, zs);
    const s = scaleAt(stage.proj, Math.max(0, zs));
    const sx = this.canvas.width / 2 + (vx - panX) * fit;
    const sy = (vy - vb.minY) * fit;
    const rx = params.area_radius * ppm * s * fit;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = mode === "impact" ? (impactQuality > 0.5 ? "#7fb07a" : "#b05c5c") : "#e6a63f";
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, rx * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Zona de salida bajo el jugador (delegado puro, para las transiciones). */
  exitAt(x: number, z: number): ReturnType<typeof exitZoneAt> {
    return this.stage ? exitZoneAt(this.stage, x, z) : null;
  }
}

/** SVG → HTMLImageElement decodificado (blob URL, liberado tras decode). */
async function rasterizeSvg(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
