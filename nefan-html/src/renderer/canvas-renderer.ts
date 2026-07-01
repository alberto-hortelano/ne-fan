/** 2D top-down open-world scene renderer on Canvas.
 *  Pinta `terrain` (rectángulo coloreado) + objetos por categoría + NPCs/enemies.
 *  Sin paredes, sin exits — el concepto sala se fue. */

import type { Vec3 } from "../../../nefan-core/src/types.js";
import type { SpriteRenderer } from "./sprite-renderer.js";
import type { AssetCache } from "./asset-cache.js";
import { errors } from "../ui/error-log.js";

export interface SceneData {
  /** Acepta `scene_id` o el legado `room_id` por compatibilidad de saves antiguos. */
  scene_id?: string;
  room_id?: string;
  scene_description?: string;
  room_description?: string;
  dimensions: { width: number; depth: number; height?: number };
  terrain?: { color?: [number, number, number] };
  /** Grid de terreno crudo (Format D) para pintar zonas de suelo (río/camino/
   *  puente/piedra…) en el schematic. Lo emite `formatDToWorld`; ausente en
   *  escenas legacy → fallback al color plano de `terrain`. */
  terrain_grid?: {
    grid: string[];
    legend: Record<string, string>;
    cols: number;
    rows: number;
    meters_per_cell: number;
  };
  objects: {
    id: string;
    position: number[];
    scale: number[];
    category: string;
    description: string;
    /** Pista de forma para el schematic (box|cylinder|sphere|cone). Opcional. */
    shape?: string;
    texture_hash?: string;
    sprite_hash?: string;
  }[];
  npcs: { id: string; name: string; position: number[] }[];
  lighting?: {
    ambient?: { color: number[]; intensity: number };
    lights?: { position: number[]; color: number[]; range: number }[];
  };
  ambient_event?: string;
}

export interface Entity {
  id: string;
  pos: Vec3;
  forward?: Vec3;
  radius: number;
  color: string;
  label: string;
  hp?: number;
  maxHp?: number;
  alive: boolean;
  attacking?: boolean;
  name?: string;
  /** Scene category — drives the conceptual rendering shape (building/prop/item/creature). */
  category?: string;
  /** Footprint in metres on the XZ plane, taken from the scene JSON `scale`.
   *  Falls back to a square based on `radius` when not set. */
  sizeXZ?: { x: number; z: number };
  /** Pista de forma para el schematic: box (rect) | cylinder/sphere (círculo) |
   *  cone (triángulo). Ausente → rectángulo (o rombo si category==="item"). */
  shape?: string;
  /** Optional Mixamo character reference: when set and SpriteRenderer has the
   *  matching sheet cached, the entity is drawn as a sprite instead of a circle. */
  sprite?: { model: string; anim: string; angle: string; animStartedAt?: number };
  /** AI-generated sprite hash (objects/buildings) served from /cache/sprite/{hash}. */
  spriteHash?: string;
}

const DEFAULT_TERRAIN_COLOR = "#1d2a18";
/** Open field painted across the whole viewport so the world feels continuous
 *  beyond the authored scene rectangle (no black void at the edges). */
const OPEN_FIELD_COLOR = "#16210f";
/** Subtle border around the authored scene rectangle — the "plate" of geometry
 *  on which AI-generated images are later layered. */
const SCENE_PLATE_BORDER = "rgba(120,140,90,0.25)";
const GRID_COLOR = "#2a2a25";
const PLAYER_COLOR = "#4a9";
const NPC_COLOR = "#68c";

/** Radio de un personaje en METROS. Coincide con PLAYER_RADIUS (colisión) en
 *  main.ts: dibujamos el cuerpo a su tamaño real de mundo en vez de un valor en
 *  píxeles fijo, para que escale coherente con los objetos (que van en
 *  metros·scale) y con el zoom. Un humano ~0.4m de radio queda legiblemente
 *  mayor que un taburete (~0.5m de lado). */
const CHARACTER_RADIUS_M = 0.4;

/** Límites del zoom (píxeles por metro). El default es 40; el usuario acerca
 *  hasta 160 (~4×) y aleja hasta 12 (~0.3×). setScale clampa a este rango. */
const MIN_SCALE = 12;
const MAX_SCALE = 160;
/** Tamaño base (px) del lado de una sheet de sprite que se ve bien a scale=40.
 *  Permite que el sprite escale con el zoom: factor = this.scale / este valor.
 *  A 40px/m el factor es 1 (tamaño actual); tunear si los sprites quedan
 *  grandes/pequeños respecto a los círculos. */
const SPRITE_BASE_PPM = 40;

const CATEGORY_FILL: Record<string, string> = {
  building: "#5a4a38",
  prop: "#444038",
  item: "#a8902d",
  creature: "#a04848",
  terrain: "#2d4a32",
};

const CATEGORY_STROKE: Record<string, string> = {
  building: "#8c7050",
  prop: "#7a7060",
  item: "#dec268",
  creature: "#d87a7a",
  terrain: "#5a8060",
};

/** Colores canónicos por char reservado del grid de terreno (Format D). El
 *  schematic los pinta por celda para que el modelo de imagen vea río/camino/
 *  puente/piedra como zonas, no un fondo plano. */
const TERRAIN_CHAR_COLOR: Record<string, string> = {
  g: "#2d4a32", // grass
  w: "#2f5a86", // water / río
  _: "#8a7a55", // path / camino
  s: "#6b6b66", // stone / paved
  b: "#7a5a38", // bridge (wood)
  d: "#5a4a34", // dirt
  a: "#b9a878", // sand
  o: "#6a4f30", // wood / planks
};

/** Resuelve el color de una celda por el NOMBRE de la leyenda (el modelo inventa
 *  chars con nombre español), con palabras clave. Devuelve null si no reconoce
 *  nada → el caller usa el color de char reservado o el terreno base. */
function terrainColorFromName(name: string): string | null {
  const n = name.toLowerCase();
  const has = (...ws: string[]) => ws.some((w) => n.includes(w));
  if (has("agua", "río", "rio", "water", "pond", "estanque", "lago", "mar")) return TERRAIN_CHAR_COLOR.w;
  if (has("puente", "bridge")) return TERRAIN_CHAR_COLOR.b;
  if (has("camino", "sendero", "path", "road", "senda")) return TERRAIN_CHAR_COLOR._;
  if (has("piedra", "stone", "paved", "pavimento", "adoquín", "adoquin", "losa")) return TERRAIN_CHAR_COLOR.s;
  if (has("arena", "sand", "playa")) return TERRAIN_CHAR_COLOR.a;
  if (has("madera", "wood", "tablón", "tablon", "plank", "dock", "muelle")) return TERRAIN_CHAR_COLOR.o;
  if (has("tierra", "dirt", "barro", "lodo", "soil", "cultivo", "tilled")) return TERRAIN_CHAR_COLOR.d;
  if (has("hierba", "grass", "césped", "cesped", "pasto", "prado")) return TERRAIN_CHAR_COLOR.g;
  return null;
}

/** World-space rectangle (metres) on the XZ plane that a scene image covers.
 *  Maps 1:1 onto the collision plane — top-down, no reprojection. */
export interface SceneBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** An occluder sprite cut out of the AI scene image: its bitmap, the world
 *  rectangle it covers, and the south-edge Z used as its depth-sort baseline so
 *  it can be drawn over (or under) the player depending on who is "in front". */
export interface Occluder {
  id: string;
  img: HTMLImageElement;
  world: SceneBounds;
  baselineZ: number;
}

export interface CanvasRendererOptions {
  spriteRenderer?: SpriteRenderer;
  assetCache?: AssetCache;
  /** Default angle the world is rendered at. Must match the sprite sheets
   * pre-rendered for Mixamo and the ai_server `/generate_sprite` calls. */
  worldAngle?: string;
  /** Pixel size of one world meter (used to scale sprites coherently). */
  pixelsPerMeter?: number;
}

function rgb01ToCss(c: [number, number, number] | number[] | undefined): string | null {
  if (!c || c.length < 3) return null;
  const r = Math.max(0, Math.min(255, Math.round(c[0] * 255)));
  const g = Math.max(0, Math.min(255, Math.round(c[1] * 255)));
  const b = Math.max(0, Math.min(255, Math.round(c[2] * 255)));
  return `rgb(${r},${g},${b})`;
}

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 40; // pixels per meter
  private offsetX = 0;
  private offsetY = 0;
  private sceneData: SceneData | null = null;
  private spriteRenderer: SpriteRenderer | undefined;
  private assetCache: AssetCache | undefined;
  private worldAngle = "isometric_30";

  /** AI-generated top-down scene background. When set, it is drawn over its
   *  `sceneBounds` rectangle instead of the flat terrain plate, and the static
   *  object rectangles are hidden (they are now baked into the image) unless
   *  `debugObjects` is on. Bounds are in world metres {minX,minZ,maxX,maxZ}. */
  private sceneImage: HTMLImageElement | null = null;
  private sceneBounds: SceneBounds | null = null;
  /** Occluder sprites cut out of the scene image (X). When present, render()
   *  switches from the fixed entity order to a depth-sorted pass so tall objects
   *  (walls/buildings) can draw over the player when he is behind them. Cleared
   *  whenever the scene image changes (the cutouts no longer match). */
  private occluders: Occluder[] = [];
  /** When true, overlay the schematic object rectangles on top of the AI image
   *  to eyeball alignment between the painted scene and the collision boxes. */
  private debugObjects = false;
  /** When true, outline the collision boxes (red, = authored `position±scale/2`,
   *  what `collidesAt` blocks) and the segmented occluder footprints (cyan dashed,
   *  = what SAM actually found painted) over the scene, to judge how precise the
   *  collision is vs the image. Toggled with B. */
  private debugCollision = false;
  /** True only while rendering the offscreen schematic for capture — suppresses
   *  text labels, which would pollute the canny edge map. */
  private _capturing = false;

  constructor(canvas: HTMLCanvasElement, opts: CanvasRendererOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.spriteRenderer = opts.spriteRenderer;
    this.assetCache = opts.assetCache;
    if (opts.worldAngle) this.worldAngle = opts.worldAngle;
    if (opts.pixelsPerMeter) this.scale = opts.pixelsPerMeter;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setWorldAngle(angle: string): void {
    this.worldAngle = angle;
  }

  getWorldAngle(): string {
    return this.worldAngle;
  }

  /** Nivel de zoom = píxeles por metro. El game loop lo ajusta cada frame
   *  (suavizado) desde el input de rueda/teclas. Clampa a [MIN_SCALE, MAX_SCALE].
   *  Todo el render (toScreen, offset de cámara, screenToWorld) deriva de scale,
   *  así que el zoom queda centrado en el jugador sin matemática extra. */
  setScale(pixelsPerMeter: number): void {
    this.scale = this.clampScale(pixelsPerMeter);
  }

  getScale(): number {
    return this.scale;
  }

  /** Clampa un valor de escala al rango válido. El game loop lo usa para
   *  mantener el objetivo de zoom dentro de límites (evita que la rueda lo
   *  dispare fuera de rango). */
  clampScale(pixelsPerMeter: number): number {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, pixelsPerMeter));
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight - 30; // HUD height
  }

  setScene(data: SceneData): void {
    this.sceneData = data;
    // La cámara sigue al jugador (offset recomputado por frame en render()).
    // No se fija aquí: una escena abierta no se centra estáticamente.
  }

  getSceneData(): SceneData | null {
    return this.sceneData;
  }

  /** Install the AI-painted scene background covering `bounds` (world metres).
   *  Drawn under the entities every frame, scaling/scrolling with the camera. */
  setSceneImage(img: HTMLImageElement, bounds: SceneBounds): void {
    this.sceneImage = img;
    this.sceneBounds = { ...bounds };
    // A new image invalidates any previous cutouts — they were cut from the old
    // pixels and would now be misaligned. Press X again to re-segment.
    this.occluders = [];
  }

  clearSceneImage(): void {
    this.sceneImage = null;
    this.sceneBounds = null;
    this.occluders = [];
  }

  hasSceneImage(): boolean {
    return this.sceneImage !== null;
  }

  /** Install the occluder sprites cut out of the current scene image. */
  setOccluders(occluders: Occluder[]): void {
    this.occluders = occluders.slice();
  }

  /** Add occluders (discovered props, Phase 3) to the existing set, replacing
   *  any with the same id so repeated discovery doesn't duplicate. */
  addOccluders(occluders: Occluder[]): void {
    const ids = new Set(occluders.map((o) => o.id));
    this.occluders = this.occluders.filter((o) => !ids.has(o.id)).concat(occluders);
  }

  hasOccluders(): boolean {
    return this.occluders.length > 0;
  }

  setDebugObjects(on: boolean): void {
    this.debugObjects = on;
  }

  /** Toggle the collision-vs-image debug overlay (B). Returns the new state. */
  toggleDebugCollision(): boolean {
    this.debugCollision = !this.debugCollision;
    return this.debugCollision;
  }

  /** Render the static schematic (terrain plate + object/building rectangles,
   *  NO characters, NO labels) for a world rectangle into an offscreen canvas
   *  and return it as a PNG data URL. This is the img2img conditioning image:
   *  scene-local framing (not the camera-following viewport) so the result
   *  maps 1:1 back onto `rect`. `ppm` = pixels per metre of the capture. */
  captureSchematic(rect: SceneBounds, ppm: number): string {
    const w = Math.max(8, Math.round((rect.maxX - rect.minX) * ppm));
    const h = Math.max(8, Math.round((rect.maxZ - rect.minZ) * ppm));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const offCtx = off.getContext("2d");
    if (!offCtx) throw new Error("captureSchematic: failed to get 2D context");

    // Swap the renderer's draw target + transform so the existing drawSceneBox
    // / toScreen code paints into the offscreen canvas at scene-local coords:
    // world (minX,minZ) maps to the top-left pixel (0,0).
    const savedCtx = this.ctx;
    const savedOx = this.offsetX;
    const savedOy = this.offsetY;
    const savedScale = this.scale;
    const savedCapturing = this._capturing;
    this.ctx = offCtx;
    this.scale = ppm;
    this.offsetX = -rect.minX * ppm;
    this.offsetY = -rect.minZ * ppm;
    this._capturing = true;
    try {
      const terrainColor =
        rgb01ToCss(this.sceneData?.terrain?.color) ?? DEFAULT_TERRAIN_COLOR;
      offCtx.fillStyle = terrainColor;
      offCtx.fillRect(0, 0, w, h);

      // Zonas de suelo (río/camino/puente/piedra…) del grid Format D. Pintadas
      // encima del color plano para que el blueprint tenga formas de terreno.
      this.paintTerrainGrid();

      const staticObjects = (this.sceneData?.objects ?? [])
        .filter((o) => o.category !== "creature")
        .slice()
        .sort((a, b) => (a.position?.[2] ?? 0) - (b.position?.[2] ?? 0));
      for (const obj of staticObjects) {
        this.drawSceneBox(obj);
      }
    } finally {
      this.ctx = savedCtx;
      this.offsetX = savedOx;
      this.offsetY = savedOy;
      this.scale = savedScale;
      this._capturing = savedCapturing;
    }
    return off.toDataURL("image/png");
  }

  /** Pinta el grid de terreno (Format D) por celdas en el ctx/transform ACTUAL
   *  (llamado desde captureSchematic con el transform scene-local ya montado).
   *  Cada celda es un cuadrado de `meters_per_cell` metros; el color sale del
   *  char reservado o del nombre de la leyenda. 'g' (grass) se omite: es el
   *  color de fondo ya pintado. Degrada al fondo plano si el grid es inconsistente. */
  private paintTerrainGrid(): void {
    const tg = this.sceneData?.terrain_grid;
    const dims = this.sceneData?.dimensions;
    if (!tg || !dims) return;
    const { grid, legend, cols, rows, meters_per_cell: mpc } = tg;
    if (!Array.isArray(grid) || grid.length !== rows || cols <= 0 || rows <= 0 || mpc <= 0) {
      errors.push("scene", `terrain_grid inconsistente (filas=${grid?.length} rows=${rows} cols=${cols} mpc=${mpc}); uso color plano`);
      return;
    }
    const ctx = this.ctx;
    const halfW = dims.width / 2;
    const halfD = dims.depth / 2;
    for (let r = 0; r < rows; r++) {
      const row = grid[r];
      if (typeof row !== "string") continue;
      const cmax = Math.min(cols, row.length);
      for (let c = 0; c < cmax; c++) {
        const ch = row[c];
        if (ch === "g") continue; // grass = terreno base
        const color = TERRAIN_CHAR_COLOR[ch] ?? terrainColorFromName(legend[ch] ?? "");
        if (!color) continue;
        const x0 = -halfW + c * mpc;
        const z0 = -halfD + r * mpc;
        const [px0, py0] = this.toScreen(x0, z0);
        const [px1, py1] = this.toScreen(x0 + mpc, z0 + mpc);
        ctx.fillStyle = color;
        // +1px para evitar costuras entre celdas por el redondeo.
        ctx.fillRect(Math.floor(px0), Math.floor(py0), Math.ceil(px1 - px0) + 1, Math.ceil(py1 - py0) + 1);
      }
    }
  }

  /** Convert world XZ to screen XY (top-down, Z goes up on screen) */
  private toScreen(x: number, z: number): [number, number] {
    return [
      this.offsetX + x * this.scale,
      this.offsetY + z * this.scale,
    ];
  }

  render(
    player: {
      pos: Vec3;
      forward: Vec3;
      hp: number;
      maxHp: number;
      sprite?: Entity["sprite"];
    },
    enemies: Entity[],
    objects: Entity[],
    npcs: Entity[] = [],
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Cámara que sigue al jugador: lo deja centrado y el mundo hace scroll.
    // Sustituye al offset fijo; es lo que hace el espacio "abierto y continuo"
    // (paridad con godot/scripts/player/camera_controller.gd).
    //
    // Offset en coma flotante (NO redondeado): el jugador se mueve en fracciones
    // de píxel por frame, así que redondear la cámara a píxeles enteros la obliga
    // a saltar de entero en entero a intervalos irregulares — el "salto" visible
    // pese a un movimiento físicamente suave. Con offset float el mundo scrollea
    // de forma continua; el grid sutil se antialias a subpíxel (imperceptible).
    // Ref: jitter de cámara pixel-art = cuantización del offset, no del input.
    this.offsetX = w / 2 - player.pos.x * this.scale;
    this.offsetY = h / 2 - player.pos.z * this.scale;

    // Suelo abierto en todo el viewport: fuera de la escena no hay vacío negro,
    // sino campo que se extiende (sensación de mundo continuo, sin chunks).
    ctx.fillStyle = OPEN_FIELD_COLOR;
    ctx.fillRect(0, 0, w, h);

    if (!this.sceneData) return;
    const dims = this.sceneData.dimensions;
    const halfW = dims.width / 2;
    const halfD = dims.depth / 2;

    if (this.sceneImage && this.sceneBounds) {
      // AI-painted scene: draw it over its world-space rectangle. Derived from
      // `scale`, so it scrolls and zooms with the camera exactly like the
      // geometry it replaces. No grid/plate on top — they'd hide the detail.
      const b = this.sceneBounds;
      const [ix, iy] = this.toScreen(b.minX, b.minZ);
      const iw = (b.maxX - b.minX) * this.scale;
      const ih = (b.maxZ - b.minZ) * this.scale;
      ctx.drawImage(this.sceneImage, ix, iy, iw, ih);
    } else {
      // Placa de escena: el rectángulo autorizado por el motor donde irán las
      // imágenes IA. Sigue visible (con su color de terreno + borde sutil),
      // pero ya no es el límite del mundo.
      const [fx, fy] = this.toScreen(-halfW, -halfD);
      const fw = dims.width * this.scale;
      const fh = dims.depth * this.scale;
      const terrainColor = rgb01ToCss(this.sceneData.terrain?.color) ?? DEFAULT_TERRAIN_COLOR;
      ctx.fillStyle = terrainColor;
      ctx.fillRect(fx, fy, fw, fh);
      ctx.strokeStyle = SCENE_PLATE_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(fx, fy, fw, fh);

      // Grid continuo en world-space visible (no acotado a dimensions): da
      // orientación uniforme sobre campo + placa y refuerza la continuidad.
      ctx.strokeStyle = GRID_COLOR;
      // 1px sólido (no 0.5): con cámara float las líneas caen en posiciones
      // subpíxel; una línea <1px titilaría en opacidad al cruzar bordes de
      // píxel, una de 1px solo se antialias y desliza limpia.
      ctx.lineWidth = 1;
      const step = Math.max(1, Math.ceil(18 / this.scale)); // ≥~18px entre líneas
      const wl = Math.floor((-this.offsetX) / this.scale / step) * step;
      const wr = (w - this.offsetX) / this.scale;
      for (let gx = wl; gx <= wr; gx += step) {
        const [sx] = this.toScreen(gx, 0);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
      }
      const wt = Math.floor((-this.offsetY) / this.scale / step) * step;
      const wb = (h - this.offsetY) / this.scale;
      for (let gz = wt; gz <= wb; gz += step) {
        const [, sy] = this.toScreen(0, gz);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
      }
    }

    // Luces ambientales pintadas como halos suaves.
    const lights = this.sceneData.lighting?.lights ?? [];
    for (const light of lights) {
      const [lx, ly] = this.toScreen(light.position[0], light.position[2]);
      const lr = (light.range ?? 5) * this.scale;
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
      const c = light.color;
      grad.addColorStop(0, `rgba(${c[0]*255|0},${c[1]*255|0},${c[2]*255|0},0.15)`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
    }

    // Static scene elements (buildings/props/items/terrain patches) por categoría,
    // ordenados por Z para que el fondo no tape el frente. Cuando hay imagen IA
    // ya están pintados en ella; sólo se dibujan como overlay de debug.
    if (!this.sceneImage || this.debugObjects) {
      const staticObjects = (this.sceneData.objects ?? [])
        .filter((o) => o.category !== "creature")
        .slice()
        .sort((a, b) => (a.position?.[2] ?? 0) - (b.position?.[2] ?? 0));
      for (const obj of staticObjects) {
        this.drawSceneBox(obj);
      }
    }

    if (this.occluders.length > 0) {
      this.drawDepthSorted(player, enemies, objects, npcs);
    } else {
      for (const npc of npcs) this.drawNpc(npc);
      for (const e of enemies) this.drawEntity(e);
      for (const obj of objects) this.drawEntity(obj);
      this.drawPlayer(player);
    }

    if (this.debugCollision) this.drawCollisionDebug(objects);
  }

  /** Overlay (B): outline every solid object's collision box (red, what blocks
   *  movement = `pos ± sizeXZ/2`) and every segmented occluder's actual painted
   *  footprint (cyan dashed). The gap between a red and a cyan box is exactly how
   *  imprecise the collision is vs the image — what Phase 2 would snap together. */
  private drawCollisionDebug(objects: Entity[]): void {
    const ctx = this.ctx;
    ctx.save();

    // Authored collision footprints (same set + rule as main.ts collidesAt):
    // filled translucent red + bright outline so they read over the painting.
    for (const o of objects) {
      if (o.category !== "building" && o.category !== "prop") continue;
      if (!o.sizeXZ) continue;
      const [cx, cy] = this.toScreen(o.pos.x, o.pos.z);
      const w = o.sizeXZ.x * this.scale;
      const h = o.sizeXZ.z * this.scale;
      ctx.fillStyle = "rgba(255,40,40,0.18)";
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeStyle = "rgba(255,40,40,1)";
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    }

    // Segmented actual footprints (only present after X): bright cyan dashed.
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    for (const occ of this.occluders) {
      const w = occ.world;
      const [ix, iy] = this.toScreen(w.minX, w.minZ);
      const iw = (w.maxX - w.minX) * this.scale;
      const ih = (w.maxZ - w.minZ) * this.scale;
      ctx.strokeStyle = "rgba(60,255,255,1)";
      ctx.strokeRect(ix, iy, iw, ih);
    }
    ctx.setLineDash([]);

    // Legend with solid swatches (below the top HUD bar).
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,40,40,1)";
    ctx.fillRect(12, 52, 14, 10);
    ctx.fillText("colision autorizada (pos±scale/2)", 32, 61);
    ctx.fillStyle = "rgba(60,255,255,1)";
    ctx.fillRect(12, 70, 14, 10);
    ctx.fillText("footprint segmentado por SAM", 32, 79);
    ctx.restore();
  }

  /** Depth-sorted pass used when occluder cutouts exist. Interleaves the
   *  occluder sprites with the player/NPCs/enemies/objects by the screen-Y of
   *  their south edge (baseline): whatever is further south draws later (on top),
   *  so a wall whose base is in front of the player covers him, and one behind
   *  him does not. The scene image is still the background; the cutouts here are
   *  the SAME pixels redrawn at the same place, so the overlap is seamless. */
  private drawDepthSorted(
    player: {
      pos: Vec3;
      forward: Vec3;
      hp: number;
      maxHp: number;
      sprite?: Entity["sprite"];
    },
    enemies: Entity[],
    objects: Entity[],
    npcs: Entity[],
  ): void {
    const items: { baseline: number; draw: () => void }[] = [];
    for (const occ of this.occluders) {
      const w = occ.world;
      const [ix, iy] = this.toScreen(w.minX, w.minZ);
      const iw = (w.maxX - w.minX) * this.scale;
      const ih = (w.maxZ - w.minZ) * this.scale;
      items.push({
        baseline: this.toScreen(0, occ.baselineZ)[1],
        draw: () => this.ctx.drawImage(occ.img, ix, iy, iw, ih),
      });
    }
    for (const npc of npcs) {
      items.push({ baseline: this.toScreen(0, npc.pos.z)[1], draw: () => this.drawNpc(npc) });
    }
    for (const e of enemies) {
      items.push({ baseline: this.toScreen(0, e.pos.z)[1], draw: () => this.drawEntity(e) });
    }
    for (const obj of objects) {
      items.push({ baseline: this.toScreen(0, obj.pos.z)[1], draw: () => this.drawEntity(obj) });
    }
    items.push({ baseline: this.toScreen(0, player.pos.z)[1], draw: () => this.drawPlayer(player) });

    items.sort((a, b) => a.baseline - b.baseline);
    for (const it of items) it.draw();
  }

  /** Draw a static scene element (building/prop/item) using its authored
   *  footprint. Buildings/terrain get a filled rectangle the size of the XZ
   *  scale; props get a smaller box; items are diamond markers. */
  private drawSceneBox(obj: { id: string; position: number[]; scale: number[]; category: string; description: string; shape?: string }): void {
    const ctx = this.ctx;
    const px = obj.position?.[0] ?? 0;
    const pz = obj.position?.[2] ?? 0;
    const sx = Math.max(0.2, obj.scale?.[0] ?? 1);
    const sz = Math.max(0.2, obj.scale?.[2] ?? 1);
    const [cx, cy] = this.toScreen(px, pz);
    const w = sx * this.scale;
    const h = sz * this.scale;
    const cat = obj.category ?? "prop";
    const fill = CATEGORY_FILL[cat] ?? CATEGORY_FILL.prop;
    const stroke = CATEGORY_STROKE[cat] ?? CATEGORY_STROKE.prop;

    // Forma explícita del modelo (barril/pozo/torre redonda → círculo; tienda/
    // aguja → triángulo). Prevalece sobre la categoría para el primitivo, pero
    // conserva el color de categoría. box/ausente → cae a la lógica de siempre.
    const shape = obj.shape;
    if (shape === "cylinder" || shape === "sphere") {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(3, w / 2), Math.max(3, h / 2), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this.drawObjectLabel(cx, cy - h / 2 - 4, obj.description || obj.id, stroke);
      return;
    }
    if (shape === "cone") {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h / 2);
      ctx.lineTo(cx - w / 2, cy + h / 2);
      ctx.lineTo(cx + w / 2, cy + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      this.drawObjectLabel(cx, cy - h / 2 - 4, obj.description || obj.id, stroke);
      return;
    }

    if (cat === "building" || cat === "terrain") {
      ctx.fillStyle = fill;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      if (!this._capturing && w >= 60 && h >= 16) {
        ctx.fillStyle = "rgba(230, 220, 200, 0.85)";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = (obj.description || obj.id).slice(0, 36);
        ctx.fillText(label, cx, cy);
        ctx.textBaseline = "alphabetic";
      }
      return;
    }

    if (cat === "item") {
      const r = Math.max(6, Math.min(w, h) / 2);
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      this.drawObjectLabel(cx, cy - r - 4, obj.description || obj.id, "#dec268");
      return;
    }

    ctx.fillStyle = fill;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    this.drawObjectLabel(cx, cy - h / 2 - 4, obj.description || obj.id, "#bbb");
  }

  private drawObjectLabel(cx: number, cy: number, text: string, color: string): void {
    if (this._capturing || !text) return;
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text.slice(0, 32), cx, cy);
  }

  private drawPlayer(player: {
    pos: Vec3;
    forward: Vec3;
    hp: number;
    maxHp: number;
    sprite?: Entity["sprite"];
  }): void {
    const ctx = this.ctx;
    const [px, py] = this.toScreen(player.pos.x, player.pos.z);
    // Cuerpo a tamaño de mundo (= su hitbox). Floor de 6px para que siga
    // visible con zoom-out fuerte sin desaparecer.
    const r = Math.max(6, CHARACTER_RADIUS_M * this.scale);

    // Two explicit modes — never a fallback chain. The caller decides which:
    //   sprite === undefined → primary path is the circle.
    //   sprite !== undefined → primary path is the sheet; hard failures
    //                          throw and bubble to the gameLoop's error
    //                          handler. SPRITE_PENDING (=false) skips this
    //                          frame; the next one redraws.
    let hpBarY: number;
    if (player.sprite === undefined) {
      ctx.fillStyle = PLAYER_COLOR;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      const fLen = r + 8;
      const fx = px + player.forward.x * fLen;
      const fy = py + player.forward.z * fLen;
      ctx.strokeStyle = PLAYER_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(fx, fy); ctx.stroke();
      hpBarY = py - (r + 6);
    } else {
      const drew = this.drawSprite(player.sprite, player.forward, px, py);
      hpBarY = py - (drew ? 70 : 16);
    }

    this.drawHpBar(px, hpBarY, player.hp, player.maxHp, "#4a9");
  }

  private drawEntity(e: Entity): void {
    const ctx = this.ctx;
    const [ex, ey] = this.toScreen(e.pos.x, e.pos.z);

    if (!e.alive) {
      ctx.fillStyle = "#555";
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(ex, ey, e.radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1.0;
      return;
    }

    const category = e.category ?? "creature";
    if (category === "building" || category === "terrain" || category === "prop" || category === "item") {
      // Static-shape entities (buildings/props/items) are baked into the AI
      // scene image; skip their schematic box when one is present (same gate as
      // the sceneData.objects loop). Creatures still draw on top below.
      if (this.sceneImage && !this.debugObjects) return;
      const sx = e.sizeXZ?.x ?? Math.max(0.5, e.radius / this.scale * 2);
      const sz = e.sizeXZ?.z ?? Math.max(0.5, e.radius / this.scale * 2);
      this.drawSceneBox({
        id: e.id,
        position: [e.pos.x, e.pos.y, e.pos.z],
        scale: [sx, 1, sz],
        category,
        description: e.label ?? e.id,
        shape: e.shape,
      });
    } else {
      this.drawCreatureMarker(ex, ey, e);
    }

    if (e.hp !== undefined && e.maxHp !== undefined) {
      this.drawHpBar(ex, ey - (e.radius + 6), e.hp, e.maxHp, e.color);
    }
  }

  private drawCreatureMarker(cx: number, cy: number, e: Entity): void {
    const ctx = this.ctx;
    const r = Math.max(CHARACTER_RADIUS_M * this.scale, e.radius);
    ctx.fillStyle = e.attacking ? "#ff4" : (e.color || CATEGORY_FILL.creature);
    ctx.strokeStyle = CATEGORY_STROKE.creature;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (e.forward && (e.forward.x !== 0 || e.forward.z !== 0)) {
      const fLen = r + 8;
      const fx = cx + e.forward.x * fLen;
      const fy = cy + e.forward.z * fLen;
      ctx.strokeStyle = e.attacking ? "#ff4" : CATEGORY_STROKE.creature;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(fx, fy); ctx.stroke();
    }
    if (e.label) {
      ctx.fillStyle = "#d8c79a";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(e.label.slice(0, 30), cx, cy - r - 4);
    }
  }

  private drawNpc(npc: Entity): void {
    const [nx, ny] = this.toScreen(npc.pos.x, npc.pos.z);
    const ctx = this.ctx;
    const r = Math.max(CHARACTER_RADIUS_M * this.scale, npc.radius);
    ctx.fillStyle = NPC_COLOR;
    ctx.strokeStyle = "#a5cef0";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(nx, ny, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (npc.forward && (npc.forward.x !== 0 || npc.forward.z !== 0)) {
      const fLen = r + 8;
      const fx = nx + npc.forward.x * fLen;
      const fy = ny + npc.forward.z * fLen;
      ctx.strokeStyle = "#a5cef0";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(fx, fy); ctx.stroke();
    }
    if (npc.name) {
      ctx.fillStyle = "#9be";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(npc.name, nx, ny - r - 4);
    }
  }

  /** Draw a sprite. Caller has already decided that a sprite IS the intended
   *  rendering for this entity. Returns true on success, false when the
   *  frame's image is still decoding (transient — next tick will succeed).
   *  Throws on hard failures (no sprite renderer, sheet never loaded,
   *  404/MIME error on a frame) — those propagate so the gameLoop can log
   *  them to the ErrorLog instead of silently swapping in a placeholder. */
  private drawSprite(
    sprite: NonNullable<Entity["sprite"]>,
    forward: Vec3 | undefined,
    cx: number,
    cy: number,
  ): boolean {
    if (!this.spriteRenderer) {
      throw new Error("CanvasRenderer.drawSprite called without a spriteRenderer");
    }
    const sheet = this.spriteRenderer.getCached(sprite.model, sprite.anim, sprite.angle);
    if (!sheet) return false; // sheet still loading
    const fwd = forward ?? { x: 0, y: 0, z: 1 };
    const t = sprite.animStartedAt !== undefined
      ? (performance.now() - sprite.animStartedAt) / 1000
      : performance.now() / 1000;
    // Escala el sprite con el zoom: a scale=SPRITE_BASE_PPM el factor es 1
    // (tamaño actual) y crece/encoge con el zoom para no desacoplarse de los
    // círculos/objetos, que ya van en metros·scale.
    return this.spriteRenderer.draw(this.ctx, sheet, fwd.x, fwd.z, t, cx, cy, {
      scale: this.scale / SPRITE_BASE_PPM,
    });
  }

  private drawHpBar(cx: number, cy: number, hp: number, maxHp: number, color: string): void {
    const ctx = this.ctx;
    const bw = 24;
    const bh = 3;
    const x = cx - bw / 2;
    ctx.fillStyle = "#333";
    ctx.fillRect(x, cy, bw, bh);
    const fill = Math.max(0, hp / maxHp);
    ctx.fillStyle = color;
    ctx.fillRect(x, cy, bw * fill, bh);
  }

  /** Draw attack area visualization during wind-up or impact flash. */
  drawAttackArea(
    player: { pos: Vec3; forward: Vec3 },
    params: { optimal_distance: number; distance_tolerance: number; area_radius: number },
    mode: "windup" | "impact",
    opacity: number = 0.3,
    impactQuality: number = 0,
  ): void {
    const ctx = this.ctx;
    const [px, py] = this.toScreen(player.pos.x, player.pos.z);
    const s = this.scale;

    const minDist = Math.max(0, params.optimal_distance - params.distance_tolerance);
    const maxDist = params.optimal_distance + params.distance_tolerance;
    const areaRadius = params.area_radius;

    const fwdAngle = Math.atan2(player.forward.x, player.forward.z) + Math.PI;
    const halfAngle = Math.atan2(areaRadius, params.optimal_distance);

    if (mode === "windup") {
      const ringSteps = 16;
      const angleSteps = 20;
      const distRange = maxDist - minDist;

      for (let ri = 0; ri < ringSteps; ri++) {
        const r0 = minDist + (ri / ringSteps) * distRange;
        const r1 = minDist + ((ri + 1) / ringSteps) * distRange;
        const rMid = (r0 + r1) / 2;
        const distFactor = 1.0 - Math.abs(rMid - params.optimal_distance) / params.distance_tolerance;
        if (distFactor <= 0) continue;

        for (let ai = 0; ai < angleSteps; ai++) {
          const a0 = -halfAngle + (ai / angleSteps) * halfAngle * 2;
          const a1 = -halfAngle + ((ai + 1) / angleSteps) * halfAngle * 2;
          const aMid = (a0 + a1) / 2;

          const offset = Math.abs(Math.sin(aMid) * rMid);
          const precFactor = 1.0 - Math.min(offset / areaRadius, 1.0);
          const quality = distFactor * precFactor;
          if (quality <= 0.01) continue;

          const r = Math.round((1 - quality) * 255);
          const g = Math.round(quality * 255);
          ctx.fillStyle = `rgba(${r},${g},40,${quality * opacity})`;

          const startAngle = -fwdAngle + a0 - Math.PI / 2;
          const endAngle = -fwdAngle + a1 - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(px, py, r0 * s, startAngle, endAngle);
          ctx.arc(px, py, r1 * s, endAngle, startAngle, true);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else {
      let cr: number, cg: number, cb: number;
      if (impactQuality > 0.7) { cr = 80; cg = 255; cb = 80; }
      else if (impactQuality > 0.3) { cr = 255; cg = 255; cb = 60; }
      else if (impactQuality > 0) { cr = 255; cg = 80; cb = 60; }
      else { cr = 120; cg = 120; cb = 120; }

      ctx.fillStyle = `rgba(${cr},${cg},${cb},${opacity})`;
      const startAngle = -fwdAngle - halfAngle - Math.PI / 2;
      const endAngle = -fwdAngle + halfAngle - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(px, py, minDist * s, startAngle, endAngle);
      ctx.arc(px, py, maxDist * s, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  /** Convert screen click to world XZ */
  screenToWorld(screenX: number, screenY: number): Vec3 {
    return {
      x: (screenX - this.offsetX) / this.scale,
      y: 0,
      z: (screenY - this.offsetY) / this.scale,
    };
  }
}
