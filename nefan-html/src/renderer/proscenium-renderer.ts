/** Renderer de la vista PROSCENIO — el plató de cine clásico.
 *
 *  Delgado a propósito: toda la geometría (proyección perspectiva, cámara de
 *  raíl, zonas de salida) viene compuesta y testeada de
 *  `nefan-core/src/scene/stage/`. El arte del plató son SIEMPRE bitmaps
 *  (`StageImages`): el clay three.js del spec en modo vector, o el repintado
 *  IA segmentado en modo imagen — placa warpeada por bandas + recortes como
 *  drawables a su z. Aquí solo se panea la cámara y se insertan los sprites
 *  entre recortes por profundidad.
 *
 *  Convención de cámara: SUR (ver stage/projection.ts). El raíl panea con
 *  PARALLAX por profundidad: cada capa/entidad se proyecta con el
 *  desplazamiento de SU s(z) (la proyección exacta respecto a la cámara —
 *  ver stage/framing.ts), el suelo continuo se warpea por bandas y los
 *  sprites comparten fórmula con su capa, así que quedan clavados a lo que
 *  tienen al lado mientras lo cercano corre más que lo lejano. */

import type { Vec3 } from "@nefan-core/src/types.js";
import {
  scaleAt,
  spriteScaleAt,
  stageToView,
  worldToStage,
  railCamera,
  exitZoneAt,
  frameStage,
  bandPlanFor,
  parallaxPanX,
  viewToScreen,
  type ComposedStage,
  type StageFraming,
  type BandPlan,
} from "@nefan-core/src/scene/stage/index.js";
import type { StageProjParams } from "@nefan-core/src/scene/stage/index.js";
import { spritePitchCos, type SpriteRenderer } from "./sprite-renderer.js";
import type { Entity } from "./canvas-renderer.js";
import type { StageImages, StageCutout } from "../scene/stage-image.js";
import type { AttackAreaParams, PlayerView, Renderer2D } from "./renderer2d.js";
import { errors } from "../ui/error-log.js";

/** Encuadre ortho 2.4 del renderer Godot (metros de plano de imagen por
 *  frame); el cos(pitch) del SET ACTIVO de cada sprite (spritePitchCos)
 *  recupera metros de mundo — la vista proscenio usa el set frontal_8. */
const SHEET_FRAME_WORLD_M = 2.4;
/** Set por defecto de la vista (para dimensionar sombra/círculo de entidades
 *  aún sin sprite) — el sprite de cada entidad manda cuando existe. */
const STAGE_SPRITE_ANGLE = "frontal_8";
/** Clamp inferior de la escala por profundidad: por debajo, los octantes del
 *  sheet dejan de leerse. */
const MIN_DEPTH_SCALE = 0.55;
const RAIL_DEAD_ZONE_M = 1.5;
const RAIL_RATE = 6;
const PLAYER_COLOR = "#e8a13c";
const NPC_COLOR = "#6688cc";

/** Fade de recortes con el jugador DETRÁS — espejo de las constantes del
 *  occluder-fade de la oblicua (canvas-renderer.ts). */
const CUTOUT_FADE_NEAR_M = 1.5;
const CUTOUT_FADE_FAR_M = 6;
const CUTOUT_FADE_MIN = 0.45;
const CUTOUT_FADE_RATE = 8;
const CUTOUT_FADE_MARGIN_M = 0.5;
/** Margen del test "jugador detrás" (zStage del jugador > z del recorte). */
const BEHIND_EPS_M = 0.05;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function distPointToRect(
  x: number,
  z: number,
  r: { minX: number; minZ: number; maxX: number; maxZ: number },
): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

export interface ProsceniumRendererOptions {
  spriteRenderer?: SpriteRenderer;
}

export class ProsceniumRenderer implements Renderer2D {
  private readonly ctx: CanvasRenderingContext2D;
  private stage: ComposedStage | null = null;
  private stageKey = "";
  /** Bitmaps del plató: placa + recortes en ESPACIO CUADRADO — se des-estiran
   *  al pintarlas sobre el viewBox. Clay three.js (modo vector / placeholder)
   *  o repintado IA segmentado. null = instalación en vuelo. */
  private images: StageImages | null = null;
  private camX = 0;
  private lastNow = 0;
  /** Encuadre + plan de bandas, cacheados por (plató, tamaño de canvas). */
  private framing: StageFraming | null = null;
  private bandPlan: BandPlan | null = null;
  private frameKey = "";
  /** Desplazamiento de cámara del último frame (drawAttackArea lo reutiliza). */
  private lastCamOffsetM = 0;
  /** Alphas vivos del fade de recortes (id → alpha, lerp temporal). */
  private cutFade = new Map<string, number>();
  /** Overlay de debug (tecla B): colisión reproyectada + cajas de recortes
   *  con su z pintada. */
  private debugView: "off" | "overlay" = "off";
  /** Override dev del clamp de escala por profundidad (?minscale=). null =
   *  política por defecto (ver depthScaleFloor). */
  minScaleOverride: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: ProsceniumRendererOptions = {},
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ProsceniumRenderer: canvas sin contexto 2d");
    this.ctx = ctx;
    HOT_REGISTRY.add(this);
  }

  hasStage(): boolean {
    return this.stage !== null;
  }

  getStage(): ComposedStage | null {
    return this.stage;
  }

  clearStage(): void {
    this.stage = null;
    this.stageKey = "";
    this.images = null;
    this.framing = null;
    this.bandPlan = null;
    this.frameKey = "";
  }

  /** Cicla el overlay de debug (tecla B en vista proscenio): off ↔ overlay.
   *  El overlay superpone la colisión ACTIVA reproyectada al suelo pintado
   *  (celdas del grid derivado; huellas declaradas si no hay imágenes) y, por
   *  cada recorte, su caja de vista a su z con etiqueta `#orden id z=…`. */
  cycleDebugView(): "off" | "overlay" {
    this.debugView = this.debugView === "off" ? "overlay" : "off";
    return this.debugView;
  }

  /** Estado de cámara/encuadre para el bench (__nefan.stageCam). */
  debugCamera(): { camX: number; railHalfM: number; zoom: number; fit: number } | null {
    if (!this.framing) return null;
    return {
      camX: this.camX,
      railHalfM: this.framing.railHalfM,
      zoom: this.framing.zoom,
      fit: this.framing.fit,
    };
  }

  /** Instalación ATÓMICA de las imágenes del pipeline de segmentación.
   *  true = aceptadas (el caller instala también la colisión derivada);
   *  false = descartadas (la escena activa ya no es la que se pintó). */
  installImages(key: string, images: StageImages): boolean {
    if (key !== this.stageKey) {
      errors.push("render", `imágenes del plató ${key} descartadas: la escena activa es ${this.stageKey || "(ninguna)"}`);
      return false;
    }
    this.images = images;
    this.cutFade.clear();
    this.frameKey = ""; // el encuadre puede cambiar (proyección calibrada)
    return true;
  }

  /** true = repintado IA instalado (el clay local no cuenta: es el arte base). */
  hasImages(): boolean {
    return this.images !== null && this.images.clay !== true;
  }

  /** Recortes instalados con su fade vivo (__nefan.stageCutouts). */
  debugCutouts(): Array<{
    id: string;
    layerId?: string;
    label: string;
    z: number;
    solid: boolean;
    tall: boolean;
    fade: number;
    bboxView: [number, number, number, number];
    footprintWorld: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  }> | null {
    if (!this.images) return null;
    return this.images.cutouts.map((c) => ({
      id: c.id,
      ...(c.layerId ? { layerId: c.layerId } : {}),
      label: c.label,
      z: c.z,
      solid: c.solid,
      tall: c.tall,
      fade: this.cutFade.get(c.id) ?? 1,
      bboxView: c.bboxView,
      footprintWorld: c.footprintWorld,
    }));
  }

  /** Proyección EFECTIVA: con imágenes instaladas manda la del greybox
   *  pintado; en modo vectorial, la del compositor. */
  private effProj(): StageProjParams {
    return this.images?.paintedProj ?? this.stage!.proj;
  }

  /** view_box EFECTIVO — gemelo de effProj: la placa y las máscaras del
   *  pipeline de imagen viven estiradas desde el view_box del GREYBOX, no
   *  desde el del compositor SVG. Mezclarlos desalinearía placa y sprites. */
  private effVb(): ComposedStage["view_box"] {
    return this.images?.paintedViewBox ?? this.stage!.view_box;
  }

  /** Clamp inferior de la escala de sprites por profundidad. En modo imagen
   *  con proyección calibrada la PINTURA manda: nunca clampa dentro de la
   *  profundidad jugable (un personaje al fondo mide lo que miden los muebles
   *  del fondo); en vectorial, el 0.55 de legibilidad de los 8 octantes. */
  private depthScaleFloor(proj: StageProjParams): number {
    if (this.minScaleOverride !== null) return this.minScaleOverride;
    if (this.images?.paintedProj) return Math.min(MIN_DEPTH_SCALE, scaleAt(proj, proj.depth_m));
    return MIN_DEPTH_SCALE;
  }

  /** Talla de sprites vs el mobiliario PINTADO a la profundidad z: el suelo
   *  gobierna las POSICIONES (px_per_m calibrado del trapecio), pero los
   *  TAMAÑOS de la pintura llevan su propia perspectiva — los personajes se
   *  miden contra los muebles que tienen al lado o parecen juguetes. */
  private spriteScaleFactor(proj: StageProjParams, zs: number): number {
    const m = this.images?.spriteScale;
    return m ? spriteScaleAt(m, proj, zs) : 1;
  }

  /** Alpha vivo del fade de un recorte — portado del occluder-fade de la
   *  oblicua: target = (jugador DETRÁS: zStage > z del recorte) ∧ (su bbox de
   *  vista cubre al jugador en pantalla, margen 0.5 m a su escala) ∧ (rampa
   *  de proximidad a la huella pintada); lerp temporal dt·8. */
  private cutoutFade(
    cut: StageCutout,
    proj: StageProjParams,
    pxs: number,
    pzs: number,
    playerPos: { x: number; z: number },
    dt: number,
  ): number {
    let target = 1;
    if (pzs > cut.z + BEHIND_EPS_M) {
      const [pvx, pvy] = stageToView(proj, pxs, Math.max(0, pzs));
      const m = CUTOUT_FADE_MARGIN_M * proj.px_per_m * scaleAt(proj, Math.max(0, pzs));
      const [minX, minY, maxX, maxY] = cut.bboxView;
      if (pvx >= minX - m && pvx <= maxX + m && pvy >= minY - m && pvy <= maxY + m) {
        const d = cut.footprintWorld
          ? distPointToRect(playerPos.x, playerPos.z, cut.footprintWorld)
          : 0;
        const t = clamp01((CUTOUT_FADE_FAR_M - d) / (CUTOUT_FADE_FAR_M - CUTOUT_FADE_NEAR_M));
        target = 1 - t * (1 - CUTOUT_FADE_MIN);
      }
    }
    const cur = this.cutFade.get(cut.id) ?? 1;
    const next = cur + (target - cur) * Math.min(1, dt * CUTOUT_FADE_RATE);
    this.cutFade.set(cut.id, next);
    return next;
  }

  /** Instala la escena ÚNICA del plató (geometría; los bitmaps llegan después
   *  vía installImages — clay local o repintado). Reemplaza a la anterior. */
  installStage(stage: ComposedStage, key: string): void {
    this.stage = stage;
    this.stageKey = key;
    this.images = null; // plató nuevo: bitmaps del anterior fuera
    this.frameKey = ""; // encuadre/bandas se recalculan en el próximo frame
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
    const images = this.images;
    if (!stage || !images) {
      // Sin geometría o sin bitmaps todavía (el clay local se instala justo
      // tras componer la escena — esto dura un puñado de frames como mucho).
      ctx.fillStyle = "#a99f92";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Preparando el escenario…", canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "left";
      return;
    }

    // ── Encuadre cinematográfico (cacheado por plató + tamaño de canvas) ─────
    // La proyección es SIEMPRE la del greybox (clay y repintado comparten
    // geometría por construcción): entidades, warp, salidas y recortes
    // comparten la misma línea de suelo que la placa.
    const vb = this.effVb();
    const proj = this.effProj();
    const fk = `${this.stageKey}:${canvas.width}x${canvas.height}`;
    if (fk !== this.frameKey || !this.framing || !this.bandPlan) {
      // Encuadre = COVER CENTRADO del viewBox: el spec del greybox ya compone
      // el frame (horizonte, techo/cielo, delantal) — el cliente solo lo
      // ajusta al canvas con el mínimo zoom que cubre ambos ejes y reparte el
      // recorte sobrante simétrico. Sin zoom de raíl (maxZoom 1): ampliar
      // para dar recorrido a la cámara recortaba la escena por arriba y por
      // abajo (cartel de salida cortado, franja sin pintar sobre el clear).
      this.framing = frameStage(proj, vb, canvas.width, canvas.height, {
        centerVertical: true,
        maxZoom: 1,
      });
      this.bandPlan = bandPlanFor(proj, vb, this.framing, canvas.width, canvas.height);
      this.frameKey = fk;
    }
    const framing = this.framing;
    const fit = framing.fit;
    const centerX = (stage.bounds.minX + stage.bounds.maxX) / 2;

    // ── Raíl ─────────────────────────────────────────────────────────────────
    this.camX = framing.railHalfM > 0.01
      ? railCamera(this.camX, player.pos.x, dt, {
          deadZone: RAIL_DEAD_ZONE_M,
          rate: RAIL_RATE,
          minX: centerX - framing.railHalfM,
          maxX: centerX + framing.railHalfM,
        })
      : centerX;
    const camOffsetM = this.camX - centerX;
    this.lastCamOffsetM = camOffsetM;
    /** Vista → canvas con PARALLAX por profundidad: cada punto se proyecta
     *  con el desplazamiento de SU z (identidad: proyectar respecto a la
     *  cámara). Sprite y capa a la misma z quedan clavados entre sí. */
    const toScreen = (vx: number, vy: number, zStage: number): [number, number] =>
      viewToScreen(proj, framing, canvas.width, vx, vy, zStage, camOffsetM);
    /** Rect destino de un bitmap full-viewBox que vive a profundidad z. */
    const layerRect = (z: number): [number, number, number, number] => [
      canvas.width / 2 + (vb.minX - parallaxPanX(proj, z, camOffsetM)) * fit,
      framing.groundScreenY + (vb.minY - proj.ground_y) * fit,
      vb.width * fit,
      vb.height * fit,
    ];

    // ── Entidades ordenadas por profundidad de plató (lejos → cerca) ─────────
    const drawables: Array<{ zs: number; cutout?: boolean; draw: () => void }> = [];
    const pushCharacter = (e: Entity, kind: "npc" | "enemy"): void => {
      if (kind === "npc" && e.alive === false) return; // NPC ausente (director)
      const [xs, zs] = worldToStage(stage.bounds, e.pos.x, e.pos.z);
      drawables.push({ zs, draw: () => this.drawCharacter(e, xs, zs, toScreen, fit, now, kind) });
    };
    for (const e of enemies) pushCharacter(e, "enemy");
    for (const n of npcs) pushCharacter(n, "npc");
    // Los estáticos DECLARADOS en la escena ya son items del manifest (con su
    // recorte); los spawns dinámicos posteriores (spawn_entity del motor) no —
    // caja esquemática a su profundidad (su huella ya colisiona igual). Con
    // REPINTADO instalado, los estáticos de escena sin item (descartados por
    // el derive: candiles sobre mesas…) se ocultan — no colisionan y el
    // repintado ya vistió su zona; con el clay siguen como caja (nada los
    // pinta). La caja siempre sobrevive para spawns e ítems interactuables.
    const itemIds = new Set(stage.items.map((i) => i.id));
    for (const o of objects) {
      if (!o.alive) continue;
      if (itemIds.has(`vol_${o.id}`) || itemIds.has(`vol_derived_ent_${o.id}`)) continue;
      if (!images.clay && o.sceneDeclared && o.category !== "item") continue;
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
    // ── Recortes del plató (clay o segmentados de la pintura): drawables a su
    // z (la oclusión del jugador emerge del mismo orden que las entidades) con
    // fade cuando el jugador queda detrás — el patrón de la oblicua. ────────
    {
      const [pxs, pzs] = worldToStage(stage.bounds, player.pos.x, player.pos.z);
      for (const cut of images.cutouts) {
        const fade = this.cutoutFade(cut, proj, pxs, pzs, player.pos, dt);
        drawables.push({
          zs: cut.z,
          cutout: true,
          draw: () => {
            const [lx, ly, lw, lh] = layerRect(cut.z);
            ctx.globalAlpha = fade;
            ctx.drawImage(cut.canvas, lx, ly, lw, lh);
            ctx.globalAlpha = 1;
          },
        });
      }
    }
    // Empate de z: el recorte se pinta DESPUÉS (delante) que la entidad —
    // espejo de la regla «entidad delante ⟺ zStage < item.z».
    drawables.sort((a, b) => b.zs - a.zs || (a.cutout ? 1 : 0) - (b.cutout ? 1 : 0));

    // ── Placa (telón + suelo sin volúmenes) + sprites/recortes por z ─────────
    // Warp por bandas: cada franja de profundidad panea con su s(z).
    this.drawBanded(images.plate, images.plate.width, images.plate.height, camOffsetM);
    this.drawExitZones(toScreen);
    for (const d of drawables) d.draw();

    if (this.debugView === "overlay") this.drawDebugOverlay(toScreen, player);
  }

  /** Overlay B: la verdad jugable superpuesta a la pintura. Celdas SÓLIDAS de
   *  la colisión activa (grid derivado de lo pintado en modo imagen; huellas
   *  declaradas de las capas en vectorial) reproyectadas al suelo, la caja de
   *  vista de cada recorte a su z pintada con `#orden id z=…` (el orden del
   *  pintor = z-index efectivo), su huella en el suelo, las huellas de los
   *  missing (sin colisión) y el zStage del jugador para comparar. */
  private drawDebugOverlay(
    toScreen: (vx: number, vy: number, zStage: number) => [number, number],
    player: PlayerView,
  ): void {
    const { ctx } = this;
    const stage = this.stage!;
    const proj = this.effProj();
    const images = this.images;

    // Traza el contorno de un rect de MUNDO sobre el suelo (cada esquina
    // proyecta con SU z — el mismo patrón que drawExitZones).
    const traceWorldRect = (minX: number, minZ: number, maxX: number, maxZ: number): void => {
      const corners: Array<[number, number]> = [
        [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ],
      ];
      corners.forEach(([wx, wz], i) => {
        const [xs, zsRaw] = worldToStage(stage.bounds, wx, wz);
        const zs = Math.max(0, Math.min(proj.depth_m, zsRaw));
        const [vx, vy] = stageToView(proj, xs, zs);
        const [sx, sy] = toScreen(vx, vy, zs);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
    };

    // ── Colisión activa ──────────────────────────────────────────────────────
    const grid = images?.collision ?? null;
    if (grid?.origin) {
      const solid = new Set(grid.solid_chars ?? ["W", "w"]);
      const [ox, oz] = grid.origin;
      const mpc = grid.meters_per_cell;
      ctx.beginPath();
      for (let r = 0; r < grid.rows; r++) {
        const row = grid.grid[r] ?? "";
        for (let c = 0; c < grid.cols; c++) {
          if (!solid.has(row[c] ?? ".")) continue;
          traceWorldRect(ox + c * mpc, oz + r * mpc, ox + (c + 1) * mpc, oz + (r + 1) * mpc);
        }
      }
      ctx.fillStyle = "rgba(255, 60, 60, 0.30)";
      ctx.fill();
    } else {
      // Sin grid derivado: la primera línea es la colisión DECLARADA — las
      // huellas de los items del manifest.
      ctx.beginPath();
      for (const item of stage.items) {
        if (!item.solid) continue;
        traceWorldRect(item.footprint[0], item.footprint[1], item.footprint[2], item.footprint[3]);
      }
      ctx.fillStyle = "rgba(255, 60, 60, 0.18)";
      ctx.strokeStyle = "rgba(255, 60, 60, 0.7)";
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }

    // ── Recortes: caja de vista a su z pintada + huella + orden del pintor ──
    if (images) {
      const orderIdx = new Map(
        [...images.cutouts].sort((a, b) => b.z - a.z).map((c, i) => [c.id, i + 1]),
      );
      ctx.font = "11px monospace";
      for (const cut of images.cutouts) {
        const color = cut.solid ? "#ff5a5a" : "#4ad2ff";
        const [minX, minY, maxX, maxY] = cut.bboxView;
        const [x0, y0] = toScreen(minX, minY, cut.z);
        const [x1, y1] = toScreen(maxX, maxY, cut.z);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        if (cut.footprintWorld) {
          const fp = cut.footprintWorld;
          ctx.beginPath();
          traceWorldRect(fp.minX, fp.minZ, fp.maxX, fp.maxZ);
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const fade = this.cutFade.get(cut.id) ?? 1;
        const tag = `#${orderIdx.get(cut.id)} ${cut.id.replace("vol_derived_ent_", "").replace("vol_", "")}`
          + ` z=${cut.z.toFixed(2)}${cut.solid ? "" : " ·nosolid"}${fade < 0.99 ? ` ·fade=${fade.toFixed(2)}` : ""}`;
        ctx.fillStyle = "rgba(10, 8, 16, 0.75)";
        ctx.fillRect(x0, y0 - 14, ctx.measureText(tag).width + 8, 13);
        ctx.fillStyle = color;
        ctx.fillText(tag, x0 + 4, y0 - 4);
      }
      // Missing: la huella declarada quedó SIN recorte ni colisión.
      ctx.strokeStyle = "rgba(200, 200, 200, 0.6)";
      ctx.fillStyle = "rgba(200, 200, 200, 0.7)";
      for (const id of images.missing) {
        const item = stage.items.find((i) => i.id === id);
        if (!item) continue;
        ctx.beginPath();
        traceWorldRect(item.footprint[0], item.footprint[1], item.footprint[2], item.footprint[3]);
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        const [xs, zsRaw] = worldToStage(stage.bounds, (item.footprint[0] + item.footprint[2]) / 2, item.footprint[3]);
        const zs = Math.max(0, Math.min(proj.depth_m, zsRaw));
        const [vx, vy] = stageToView(proj, xs, zs);
        const [sx, sy] = toScreen(vx, vy, zs);
        ctx.textAlign = "center";
        ctx.fillText(`${id.replace("vol_derived_ent_", "").replace("vol_", "")} · missing`, sx, sy + 12);
        ctx.textAlign = "left";
      }
    }

    // ── Cabecera ─────────────────────────────────────────────────────────────
    const [, pzs] = worldToStage(stage.bounds, player.pos.x, player.pos.z);
    const head = images
      ? `B·debug — jugador zStage=${pzs.toFixed(2)} · ${images.clay ? "clay" : "repintado"}`
        + ` · recortes=${images.cutouts.length}`
        + ` · colisión=${grid ? "derivada (pintada)" : "declarada"}`
        + (images.missing.length ? ` · missing: ${images.missing.join(", ")}` : "")
      : `B·debug — jugador zStage=${pzs.toFixed(2)} · sin bitmaps`;
    ctx.font = "12px monospace";
    ctx.fillStyle = "rgba(10, 8, 16, 0.75)";
    ctx.fillRect(8, 8, ctx.measureText(head).width + 12, 18);
    ctx.fillStyle = "#ffd27a";
    ctx.fillText(head, 14, 21);
  }

  /** Warp por bandas de una imagen full-viewBox (placa o raster del suelo):
   *  cada banda panea con la s(z) de SU profundidad — el suelo continuo gana
   *  parallax sin romperse. drawImage con rect de fuente; JAMÁS ctx.clip()
   *  por banda (congeló Chrome en julio). dx fraccionario a propósito: el
   *  suavizado sub-píxel es la segunda defensa anti-moiré. */
  private drawBanded(src: CanvasImageSource, srcW: number, srcH: number, camOffsetM: number): void {
    const { ctx, canvas } = this;
    const vb = this.effVb();
    const f = this.framing!;
    const plan = this.bandPlan!;
    const destW = vb.width * f.fit;
    const bands = [plan.backdrop, ...plan.ground, plan.apron];
    for (const b of bands) {
      if (b.destH <= 0) continue;
      const sy = ((b.srcVy - vb.minY) / vb.height) * srcH;
      const sh = Math.max(1e-3, (b.srcVh / vb.height) * srcH);
      const dx = canvas.width / 2 + (vb.minX - parallaxPanX(this.effProj(), b.z, camOffsetM)) * f.fit;
      ctx.drawImage(src, 0, sy, srcW, sh, dx, b.destY, destW, b.destH);
    }
  }

  /** Marcas de salida: contorno suave + etiqueta sobre la zona (foco teatral
   *  discreto — el jugador debe encontrar las puertas sin adivinar). Cada
   *  esquina proyecta con SU z: el contorno queda pegado al suelo warpeado. */
  private drawExitZones(toScreen: (vx: number, vy: number, zStage: number) => [number, number]): void {
    const stage = this.stage!;
    const proj = this.effProj();
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
        const [vx, vy] = stageToView(proj, xs, zs);
        const [sx, sy] = toScreen(vx, vy, Math.max(0, zs));
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
      const [cvx, cvy] = stageToView(proj, cxs, czs);
      const [sx, sy] = toScreen(cvx, cvy, Math.max(0, czs));
      // Etiqueta en espacio de PANTALLA (tamaño fijo, como los labels de NPC).
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
    toScreen: (vx: number, vy: number, zStage: number) => [number, number],
    fit: number,
  ): void {
    const ctx = this.ctx;
    const proj = this.effProj();
    const s = Math.max(this.depthScaleFloor(proj), scaleAt(proj, zs));
    const [vx, vy] = stageToView(proj, xs, zs);
    const [sx, sy] = toScreen(vx, vy, Math.max(0, zs));
    const ppm = proj.px_per_m * this.spriteScaleFactor(proj, zs);
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
    toScreen: (vx: number, vy: number, zStage: number) => [number, number],
    fit: number,
    now: number,
    kind: "player" | "npc" | "enemy",
  ): void {
    const ctx = this.ctx;
    const proj = this.effProj();
    const [vx, vy] = stageToView(proj, xs, zs);
    const [sx, sy] = toScreen(vx, vy, Math.max(0, zs));
    const depth = Math.max(this.depthScaleFloor(proj), scaleAt(proj, zs));
    const pitchCos = spritePitchCos(e.sprite?.angle ?? STAGE_SPRITE_ANGLE);
    const frameH = (SHEET_FRAME_WORLD_M / pitchCos) * proj.px_per_m * depth * fit * this.spriteScaleFactor(proj, zs);

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
      const r = Math.max(4, 0.4 * proj.px_per_m * depth * fit * this.spriteScaleFactor(proj, zs));
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
    const f = this.framing;
    if (!stage || !f) return;
    const ctx = this.ctx;
    const proj = this.effProj();
    const cx = player.pos.x + player.forward.x * params.optimal_distance;
    const cz = player.pos.z + player.forward.z * params.optimal_distance;
    const [xs, zs] = worldToStage(stage.bounds, cx, cz);
    const [vx, vy] = stageToView(proj, xs, zs);
    const zClamped = Math.max(0, zs);
    const s = scaleAt(proj, zClamped);
    // Mismo encuadre y desplazamiento de cámara que el último render().
    const [sx, sy] = viewToScreen(proj, f, this.canvas.width, vx, vy, zClamped, this.lastCamOffsetM);
    const rx = params.area_radius * proj.px_per_m * s * f.fit;
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

// ── HMR (dev): parchear el prototipo de las instancias vivas — el plató, las
// imágenes y la cámara sobreviven a la iteración del renderer o de la
// geometría de nefan-core (framing/projection): sin recarga de página. ─────
type HotWindow = Window & { __nefanHotProscenium?: Set<ProsceniumRenderer> };
const HOT_REGISTRY: Set<ProsceniumRenderer> =
  ((window as HotWindow).__nefanHotProscenium ??= new Set());
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const Next = (mod as { ProsceniumRenderer?: typeof ProsceniumRenderer } | undefined)?.ProsceniumRenderer;
    if (!Next) return import.meta.hot!.invalidate();
    for (const inst of HOT_REGISTRY) {
      Object.setPrototypeOf(inst, Next.prototype);
      // Encuadre/bandas dependen del código nuevo: recomputar al vuelo.
      (inst as unknown as { frameKey: string }).frameKey = "";
    }
    console.log(`[hmr] ProsceniumRenderer parcheado (${HOT_REGISTRY.size} instancia/s)`);
  });
}
