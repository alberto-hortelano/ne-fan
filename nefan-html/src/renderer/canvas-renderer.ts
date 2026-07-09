/** 2D top-down open-world scene renderer on Canvas.
 *  Pinta `terrain` (rectángulo coloreado) + objetos por categoría + NPCs/enemies.
 *  Sin paredes, sin exits — el concepto sala se fue. */

import type { Vec3 } from "@nefan-core/src/types.js";
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
    /** Chars que bloquean movimiento (muro W, agua w, custom `{name, solid}`).
     *  Los resuelve formatDToWorld; aquí solo se pintan en el overlay B. */
    solid_chars?: string[];
  };
  /** Formas vectoriales de terreno (Format D): polylines con grosor (río con
   *  meandros, camino curvo) o polígonos rellenos (`closed`). Puntos en
   *  coordenadas de celda, width en celdas. El orden del array es el orden de
   *  pintado. Visual-only (la colisión no las lee). */
  terrain_features?: {
    type: string;
    points: [number, number][];
    width?: number;
    closed?: boolean;
    color?: string;
  }[];
  /** Capa SVG opcional de terreno (Format D). viewBox en celdas, mismo espacio
   *  que terrain_features; ai_server la sanea (sin script/foreignObject/href).
   *  Se rasteriza async al cargar la escena y se compone en el schematic. */
  terrain_svg?: string;
  /** Plan del tile: arte plano del suelo (capas g#ground/#water/#deck?) y
   *  volúmenes tipados. Sanitizados río arriba (ai_server / bridge). */
  map_ground?: string;
  volumes?: unknown[];
  /** Blueprint COMPUESTO en la perspectiva de la sesión + metadatos —
   *  inyectado por addTile (main.ts) con el compositor de nefan-core.
   *  Sustituye al pintado grid+features+cajas en el schematic y en la capa
   *  viva; la colisión base se deriva de agua + huellas (world/collision.ts). */
  __composed?: ComposedTilePlan;
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
  /** Salidas del world map (las adjunta el bridge). El renderer solo pinta el
   *  nombre del destino junto a su borde; la navegación vive en main.ts. */
  exits?: { name: string; edge?: "north" | "south" | "east" | "west" }[];
}

type EdgeSide = "north" | "south" | "east" | "west";

/** Rect mundial de una escena/tile (metros, plano continuo). */
interface WorldRectM {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Un tile/escena registrado en el renderer: su rect global, el esquema, y
 *  las capas visuales (horneada y/o imagen IA) que lo pintan. */
interface RendererTile {
  key: string;
  tx?: number;
  ty?: number;
  rect: WorldRectM;
  scene: SceneData;
  /** Huella del esquema con el que se registró el tile: si un re-registro trae
   *  la misma escena, las capas visuales (imagen IA incluida) se preservan. */
  sceneFingerprint: string;
  /** Capa de terreno horneada (lazy, LRU re-horneable desde el esquema). */
  terrainLayer: HTMLCanvasElement | null;
  layerLastUsed: number;
  /** Imagen IA (img2img) del tile, si se generó. */
  sceneImage: HTMLImageElement | null;
  svgImage: HTMLImageElement | null;
  /** Blueprint COMPUESTO rasterizado: cuando existe, ES el dibujo del tile —
   *  el schematic y la capa viva lo pintan en vez de grid+features+cajas.
   *  Cubre el rect del tile MÁS `planOverhangM` metros por el norte. */
  planImage: HTMLImageElement | null;
  planOverhangM: number;
  /** Voladizo de la imagen IA instalada (la imagen enmascarada cubre el
   *  mismo canvas extendido que el blueprint que la generó). */
  imageOverhangM: number;
  /** Análisis derivado de la imagen (mundo derivado): grid de colisión de los
   *  segmentos sólidos (null = analizado sin sólidos) y flag de analizado.
   *  Solo para el overlay B; la colisión real vive en el TileStore. */
  imageGrid: ImageGridData | null;
  imageAnalyzed: boolean;
  /** Colisión base derivada del plan (overlay B): grid de celdas sólidas
   *  (null = plan sin sólidos) y flag de aplicado (desactiva AABBs rojos). */
  svgGrid: ImageGridData | null;
  svgApplied: boolean;
}

/** Blueprint compuesto de un tile (salida del compositor de nefan-core,
 *  serializable — viaja dentro de SceneData). `overhang_m` = metros de
 *  voladizo por ENCIMA del borde norte del rect (las alturas proyectadas
 *  sobresalen hacia arriba; el compositing por profundidad pisa al vecino). */
export interface ComposedTilePlan {
  svg: string;
  view_box: { minX: number; minY: number; width: number; height: number };
  overhang_m: number;
  elements: Array<{
    id: string;
    label: string;
    solid: boolean;
    tall: boolean;
    /** [x, y, w, h] en unidades de usuario del SVG compuesto. */
    bbox: [number, number, number, number];
    baseline_y: number;
    /** Huella en celdas de mundo [minU, minV, maxU, maxV]. */
    footprint_cells: [number, number, number, number];
  }>;
}

/** Shape mínimo del grid derivado que pinta el overlay (espejo de
 *  TerrainGridData en nefan-core, sin importar el módulo de colisión). */
export interface ImageGridData {
  grid: string[];
  cols: number;
  rows: number;
  meters_per_cell: number;
  origin?: [number, number];
  solid_chars?: string[];
}

type SceneObject = NonNullable<SceneData["objects"]>[number];

/** Resolución fija de las capas horneadas: 16 px/m → 1024² por tile de 64 m.
 *  Constante para todos los tiles (el zoom re-escala con smoothing off). */
const TILE_PPM = 16;
/** Máximo de capas horneadas vivas; la más antigua se libera (re-horneable). */
const MAX_BAKED_LAYERS = 24;

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
  /** Tipo de ataque en curso (del sim) — selecciona la anim del sprite. */
  attackType?: string;
  /** Descripción narrativa usada como prompt del skin IA del sprite. */
  skinPrompt?: string;
  /** Anim pedida por el NpcDirector (NpcUpdate.animation). */
  requestedAnim?: string;
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
  decor: "#7a5f33",
};

const CATEGORY_STROKE: Record<string, string> = {
  building: "#8c7050",
  prop: "#7a7060",
  item: "#dec268",
  creature: "#d87a7a",
  terrain: "#5a8060",
  decor: "#c9a25a",
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
  W: "#4a4038", // wall / muro (sólido)
};

/** Color por `type` de terrain_feature (vocabulario en inglés de las
 *  instrucciones). Los nombres en español o libres caen a terrainColorFromName. */
const FEATURE_TYPE_COLOR: Record<string, string> = {
  river: TERRAIN_CHAR_COLOR.w,
  water: TERRAIN_CHAR_COLOR.w,
  path: TERRAIN_CHAR_COLOR._,
  road: TERRAIN_CHAR_COLOR._,
  bridge: TERRAIN_CHAR_COLOR.b,
  stone: TERRAIN_CHAR_COLOR.s,
  paved: TERRAIN_CHAR_COLOR.s,
  dirt: TERRAIN_CHAR_COLOR.d,
  sand: TERRAIN_CHAR_COLOR.a,
  wood: TERRAIN_CHAR_COLOR.o,
  grass: TERRAIN_CHAR_COLOR.g,
};

/** Hash determinista (col,row) → [0,1). Ruido reproducible para variar el color
 *  de la hierba sin Math.random (mismo blueprint en cada captura). */
function cellHash01(c: number, r: number): number {
  const s = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

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
  /** Tile del que se recortó el sprite; undefined = legacy mono-escena. */
  tileKey?: string;
  /** Origen del recorte: "image" = segmento clasificado `tall` por visión
   *  (mundo derivado de imagen). Solo lo usa el overlay de debug (B). */
  kind?: "image";
  /** Etiqueta de la clasificación por visión ("roble", "muro"...) — overlay B. */
  label?: string;
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
  /** Tiles/escenas ACUMULADOS del plano continuo (nunca se borran salvo
   *  clearTiles). El mundo visible = tiles con rect dentro del viewport. */
  private tiles = new Map<string, RendererTile>();
  /** Escena "activa" (el tile bajo el jugador): la consumen los caminos
   *  legacy (scene-image, captureSchematic de objetos, luces). */
  private sceneData: SceneData | null = null;
  private activeKey: string | null = null;
  /** Presupuesto de horneado: máx. 1 capa por frame para no hipar. */
  private bakedThisFrame = false;
  private spriteRenderer: SpriteRenderer | undefined;
  private assetCache: AssetCache | undefined;
  private worldAngle = "isometric_30";

  // (las capas visuales por tile viven en RendererTile: terrainLayer horneada
  // con LRU, sceneImage IA y svgImage)
  /** Occluder sprites cut out of the scene image (X). When present, render()
   *  switches from the fixed entity order to a depth-sorted pass so tall objects
   *  (walls/buildings) can draw over the player when he is behind them. Cleared
   *  whenever the scene image changes (the cutouts no longer match). */
  private occluders: Occluder[] = [];
  /** When true, overlay the schematic object rectangles on top of the AI image
   *  to eyeball alignment between the painted scene and the collision boxes. */
  /** When true, outline the collision boxes (red, = authored `position±scale/2`,
   *  what `collidesAt` blocks) and the segmented occluder footprints (cyan dashed,
   *  = what SAM actually found painted) over the scene, to judge how precise the
   *  collision is vs the image. Toggled with B. */
  private debugCollision = true; // en desarrollo, ON por defecto; B lo apaga
  /** True only while rendering the offscreen schematic for capture — suppresses
   *  text labels, which would pollute the canny edge map. */
  private _capturing = false;
  /** Velo de carga direccional: banda oscura en el lado del viewport por el
   *  que el jugador cruzó, mientras el mundo se genera en esa dirección. */
  private edgeLoading: { edge: EdgeSide; text: string } | null = null;

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

  /** Añade (o reemplaza) un tile/escena del plano. ADITIVO: los tiles previos
   *  siguen pintándose — el mundo es continuo. La capa se hornea lazy en
   *  render() (con LRU); el terrain_svg se rasteriza async por tile.
   *  Re-registrar la misma clave con la MISMA escena (resume, re-broadcast)
   *  preserva las capas visuales — incluida la imagen IA, que costó créditos;
   *  con escena distinta se invalidan imagen, capas y occluders del tile. */
  addTile(key: string, scene: SceneData): { sceneChanged: boolean } {
    const wr = scene as unknown as { world_rect?: WorldRectM };
    const t = scene as unknown as { tile?: { tx?: number; ty?: number } };
    const rect: WorldRectM = wr.world_rect ?? {
      minX: -scene.dimensions.width / 2,
      minZ: -scene.dimensions.depth / 2,
      maxX: scene.dimensions.width / 2,
      maxZ: scene.dimensions.depth / 2,
    };
    const fingerprint = JSON.stringify(scene);
    const prev = this.tiles.get(key);
    const same = prev !== undefined && prev.sceneFingerprint === fingerprint;
    const tile: RendererTile = {
      key,
      tx: t.tile?.tx,
      ty: t.tile?.ty,
      rect,
      scene,
      sceneFingerprint: fingerprint,
      terrainLayer: same ? prev.terrainLayer : null,
      layerLastUsed: same ? prev.layerLastUsed : 0,
      sceneImage: same ? prev.sceneImage : null,
      svgImage: same ? prev.svgImage : null,
      planImage: same ? prev.planImage : null,
      planOverhangM: scene.__composed?.overhang_m ?? 0,
      imageOverhangM: same ? prev.imageOverhangM : 0,
      imageGrid: same ? prev.imageGrid : null,
      imageAnalyzed: same ? prev.imageAnalyzed : false,
      svgGrid: same ? prev.svgGrid : null,
      svgApplied: same ? prev.svgApplied : false,
    };
    this.tiles.set(key, tile);
    if (prev && !same) {
      this.occluders = this.occluders.filter((o) => o.tileKey !== key);
    }
    if (this.activeKey === null || this.activeKey === key) this.setActiveTile(key);
    if (scene.terrain_svg && !same) this.loadSvgLayer(tile, scene.terrain_svg, "svgImage");
    if (scene.__composed && !same) this.loadSvgLayer(tile, scene.__composed.svg, "planImage");
    return { sceneChanged: prev !== undefined && !same };
  }

  /** Marca el tile bajo el jugador como escena "activa" (caminos legacy). */
  setActiveTile(key: string): void {
    const tile = this.tiles.get(key);
    if (!tile) return;
    this.activeKey = key;
    this.sceneData = tile.scene;
  }

  clearTiles(): void {
    this.tiles.clear();
    this.sceneData = null;
    this.activeKey = null;
    this.occluders = [];
  }

  /** ¿El tile que contiene (x,z) tiene fondo IA instalado? */
  private tileImageAt(x: number, z: number): boolean {
    for (const t of this.tiles.values()) {
      if (t.sceneImage && x >= t.rect.minX && x < t.rect.maxX && z >= t.rect.minZ && z < t.rect.maxZ) {
        return true;
      }
    }
    return false;
  }

  /** Claves de los tiles registrados (hook __nefan / bench). */
  get tileKeys(): string[] {
    return [...this.tiles.keys()];
  }

  /** API legacy (fixtures/change_scene): mundo de UNA escena. */
  setScene(data: SceneData): void {
    this.clearTiles();
    this.addTile(String(data.scene_id ?? data.room_id ?? "scene"), data);
  }

  /** Rasteriza una capa SVG de UN tile a una Image (async): `svgImage`
   *  (terrain_svg, refino visual) o `planImage` (el blueprint compuesto).
   *  Cuando decodifica se invalida su capa horneada (se re-hornea con la
   *  SVG). Decode fallido → errors.push. */
  private loadSvgLayer(tile: RendererTile, svg: string, target: "svgImage" | "planImage"): void {
    // Un SVG con solo viewBox no tiene tamaño intrínseco y algunos navegadores
    // no lo rasterizan: inyectar width/height desde el viewBox si faltan.
    let src = svg;
    if (!/\bwidth\s*=/.test(src)) {
      const vb = /viewBox\s*=\s*"([\d.\s-]+)"/.exec(src);
      const parts = vb?.[1].trim().split(/\s+/).map(Number);
      if (parts && parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        // 16 px por celda: resolución de sobra para el blueprint de 1024².
        src = src.replace("<svg", `<svg width="${Math.round(parts[2] * 16)}" height="${Math.round(parts[3] * 16)}"`);
      }
    }
    const blob = new Blob([src], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      tile[target] = img;
      // La capa horneada aún no incluía el SVG (decodifica async) — rehacer.
      tile.terrainLayer = null;
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      errors.push("scene", `${target === "svgImage" ? "terrain_svg" : "blueprint compuesto"} no decodifica como imagen; se omite la capa SVG`);
    };
    img.src = url;
  }

  getSceneData(): SceneData | null {
    return this.sceneData;
  }

  /** Rect mundial de un tile registrado, o null si no existe. */
  getTileRect(key: string): SceneBounds | null {
    const tile = this.tiles.get(key);
    return tile ? { ...tile.rect } : null;
  }

  getTileScene(key: string): SceneData | null {
    return this.tiles.get(key)?.scene ?? null;
  }

  getTileImage(key: string): HTMLImageElement | null {
    return this.tiles.get(key)?.sceneImage ?? null;
  }

  tileHasImage(key: string): boolean {
    return Boolean(this.tiles.get(key)?.sceneImage);
  }

  /** ¿El blueprint compuesto del tile ya está rasterizado (decodifica
   *  async)? Los callers que capturan el blueprint esperan a esto para no
   *  capturar el fallback. */
  tilePlanReady(key: string): boolean {
    return Boolean(this.tiles.get(key)?.planImage);
  }

  /** Blueprint compuesto rasterizado de un tile (enmascarado de la imagen
   *  IA), o null si no hay o aún decodifica. */
  getTilePlanImage(key: string): HTMLImageElement | null {
    return this.tiles.get(key)?.planImage ?? null;
  }

  /** Instala la imagen IA de UN tile (cubre exactamente su rect). Libera su
   *  capa horneada (slot del LRU; re-horneable si la imagen se invalida) y
   *  purga los occluders recortados de la imagen anterior de ese tile. */
  setTileImage(key: string, img: HTMLImageElement, overhangM = 0): void {
    const tile = this.tiles.get(key);
    if (!tile) return;
    tile.sceneImage = img;
    tile.imageOverhangM = overhangM;
    tile.terrainLayer = null;
    // Imagen nueva → el análisis derivado de la anterior deja de valer.
    tile.imageGrid = null;
    tile.imageAnalyzed = false;
    this.occluders = this.occluders.filter((o) => o.tileKey !== key);
  }

  /** Registra el análisis derivado de la imagen de un tile (overlay B):
   *  grid de segmentos sólidos (null = analizado sin sólidos). */
  setTileAnalysis(key: string, grid: ImageGridData | null): void {
    const tile = this.tiles.get(key);
    if (!tile) return;
    tile.imageGrid = grid;
    tile.imageAnalyzed = true;
  }

  /** Registra la colisión base derivada del plan (overlay B): grid de
   *  celdas sólidas (null = svg sin sólidos). Su aplicación también apaga los
   *  AABBs rojos del esquema en ese tile. */
  setTileSvgGrid(key: string, grid: ImageGridData | null): void {
    const tile = this.tiles.get(key);
    if (!tile) return;
    tile.svgGrid = grid;
    tile.svgApplied = true;
  }

  /** Sustituye los occluders de UN tile (X re-segmenta ese tile; los cutouts
   *  de otros tiles siguen vivos — el mundo es un plano continuo). */
  setOccludersForTile(key: string, occluders: Occluder[]): void {
    this.occluders = this.occluders.filter((o) => o.tileKey !== key).concat(occluders);
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

  /** Resumen de occluders para el hook de bench (__nefan). Solo lectura. */
  debugOccluders(): { id: string; kind?: string; tileKey?: string; world: SceneBounds; baselineZ: number }[] {
    return this.occluders.map((o) => ({
      id: o.id, kind: o.kind, tileKey: o.tileKey, world: o.world, baselineZ: o.baselineZ,
    }));
  }

  /** Toggle the collision-vs-image debug overlay (B). Returns the new state. */
  toggleDebugCollision(): boolean {
    this.debugCollision = !this.debugCollision;
    return this.debugCollision;
  }

  /** (Des)activa el velo de carga direccional. `text` se pinta en la banda
   *  ("Explorando lo desconocido", "Hacia la aldea"...). */
  setEdgeLoading(edge: EdgeSide | null, text = ""): void {
    this.edgeLoading = edge ? { edge, text } : null;
  }

  /** Flash breve (1.2 s) desde un borde: "el mundo continúa hacia ahí". */
  setEdgeFlash(edge: EdgeSide): void {
    this.edgeFlash = { edge, until: performance.now() + 1200 };
  }

  /** Render the static schematic (terrain plate + object/building rectangles,
   *  NO characters, NO labels) for a world rectangle into an offscreen canvas
   *  and return it as a PNG data URL. This is the img2img conditioning image:
   *  scene-local framing (not the camera-following viewport) so the result
   *  maps 1:1 back onto `rect`. `ppm` = pixels per metre of the capture.
   *
   *  `opts.imageTileKeys`: tiles que se pintan con su imagen IA REAL en vez
   *  del esquema (bandas de contexto para coherencia entre vecinos). Sus
   *  objects se omiten del pase de rectángulos — ya están pintados en la
   *  imagen. */
  captureSchematic(
    rect: SceneBounds,
    ppm: number,
    opts?: { imageTileKeys?: Set<string> },
  ): string {
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
      // Fondo neutro + todos los tiles que intersecan el rect capturado (el
      // transform es mundial, así que cada tile cae en su sitio).
      offCtx.fillStyle = DEFAULT_TERRAIN_COLOR;
      offCtx.fillRect(0, 0, w, h);
      const touched = [...this.tiles.values()]
        .filter(
          (t) => t.rect.maxX > rect.minX && t.rect.minX < rect.maxX &&
                 t.rect.maxZ + Math.max(t.planOverhangM, t.imageOverhangM) > rect.minZ &&
                 t.rect.minZ < rect.maxZ,
        )
        // Orden del pintor: el voladizo norte de un tile pisa a su vecino de
        // detrás — pintar de norte a sur.
        .sort((a, b) => (a.ty ?? -1e9) - (b.ty ?? -1e9) || (a.tx ?? 0) - (b.tx ?? 0));
      const asImage = (t: RendererTile): boolean =>
        Boolean(opts?.imageTileKeys?.has(t.key) && t.sceneImage);
      for (const tile of touched) {
        if (asImage(tile)) {
          const [bx0, by0] = this.toScreen(tile.rect.minX, tile.rect.minZ - tile.imageOverhangM);
          const [bx1, by1] = this.toScreen(tile.rect.maxX, tile.rect.maxZ);
          offCtx.drawImage(tile.sceneImage!, bx0, by0, bx1 - bx0, by1 - by0);
        } else {
          this.paintTerrainInto(tile);
        }
      }

      // Tiles con blueprint compuesto no pintan cajas: el plan ya dibuja sus
      // edificios y props (una caja encima duplicaría el elemento).
      const staticObjects = touched
        .filter((t) => !asImage(t) && !t.planImage)
        .flatMap((t): SceneObject[] => t.scene.objects ?? [])
        .filter((o) => o.category !== "creature")
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

  /** Pinta el terreno completo (color base + grid por celdas + features
   *  vectoriales + capa SVG) en el ctx/transform ACTUAL. Compartido por
   *  captureSchematic (blueprint de img2img) y buildTerrainLayer (capa
   *  visible en vivo) — un solo origen de verdad de cómo se ve el suelo. */
  private paintTerrainInto(tile: RendererTile): void {
    const ctx = this.ctx;
    // Color base del rect del tile (en coords mundo bajo el transform actual).
    const terrainColor =
      rgb01ToCss(tile.scene.terrain?.color) ?? DEFAULT_TERRAIN_COLOR;
    const [bx0, by0] = this.toScreen(tile.rect.minX, tile.rect.minZ);
    const [bx1, by1] = this.toScreen(tile.rect.maxX, tile.rect.maxZ);
    ctx.fillStyle = terrainColor;
    ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);

    // Blueprint compuesto: ES el dibujo del tile — cubre todo el rect (más el
    // voladizo norte de las alturas) con su propio suelo, agua, muros y
    // copas. Grid, features y terrain_svg quedan detrás sin aportar (se
    // saltan). Hasta que decodifica (async) se pinta el fallback.
    if (tile.planImage) {
      const [, py0] = this.toScreen(tile.rect.minX, tile.rect.minZ - tile.planOverhangM);
      ctx.drawImage(tile.planImage, bx0, py0, bx1 - bx0, by1 - py0);
      return;
    }

    // Zonas de suelo (muro/río/camino/puente/piedra…) del grid Format D.
    this.paintTerrainGrid(tile);

    // Formas vectoriales (río con meandros, camino curvo, plaza poligonal)
    // encima del grid: las features refinan lo que el grid solo aproxima.
    this.paintTerrainFeatures(tile);

    // Capa SVG de terreno (opcional) estirada sobre el rect, entre el
    // terreno y los objetos. Si aún no decodificó, se pinta sin ella (el
    // onload invalida la capa horneada para re-hornear con la SVG).
    if (tile.svgImage) {
      ctx.drawImage(tile.svgImage, bx0, by0, bx1 - bx0, by1 - by0);
    }
  }

  /** Hornea la capa de terreno de UN tile a resolución fija TILE_PPM, con
   *  LRU: si hay demasiadas capas vivas se libera la más antigua (siempre
   *  re-horneable desde el esquema). Máx. 1 horneado por frame. */
  private bakeTerrainLayer(tile: RendererTile): void {
    // La capa incluye el voladizo norte del blueprint compuesto (alturas).
    const w = Math.max(8, Math.round((tile.rect.maxX - tile.rect.minX) * TILE_PPM));
    const h = Math.max(8, Math.round((tile.rect.maxZ - tile.rect.minZ + tile.planOverhangM) * TILE_PPM));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const offCtx = off.getContext("2d");
    if (!offCtx) {
      errors.push("render", "bakeTerrainLayer: no se pudo crear el contexto 2D offscreen");
      return;
    }
    // Swap de transform: la esquina NW del rect cae en el píxel (0,0).
    const savedCtx = this.ctx;
    const savedOx = this.offsetX;
    const savedOy = this.offsetY;
    const savedScale = this.scale;
    const savedCapturing = this._capturing;
    this.ctx = offCtx;
    this.scale = TILE_PPM;
    this.offsetX = -tile.rect.minX * TILE_PPM;
    this.offsetY = -(tile.rect.minZ - tile.planOverhangM) * TILE_PPM;
    this._capturing = true; // sin labels
    try {
      this.paintTerrainInto(tile);
    } finally {
      this.ctx = savedCtx;
      this.offsetX = savedOx;
      this.offsetY = savedOy;
      this.scale = savedScale;
      this._capturing = savedCapturing;
    }
    tile.terrainLayer = off;
    tile.layerLastUsed = performance.now();
    // LRU: liberar la capa más antigua si nos pasamos del presupuesto.
    const baked = [...this.tiles.values()].filter((t) => t.terrainLayer);
    if (baked.length > MAX_BAKED_LAYERS) {
      baked.sort((a, b) => a.layerLastUsed - b.layerLastUsed);
      baked[0].terrainLayer = null;
    }
  }

  /** Pinta el grid de terreno (Format D) por celdas en el ctx/transform ACTUAL
   *  (llamado desde captureSchematic con el transform scene-local ya montado).
   *  Cada celda es un cuadrado de `meters_per_cell` metros; el color sale del
   *  char reservado o del nombre de la leyenda. 'g' (grass) se omite: es el
   *  color de fondo ya pintado. Degrada al fondo plano si el grid es inconsistente. */
  private paintTerrainGrid(tile: RendererTile): void {
    const tg = tile.scene.terrain_grid;
    if (!tg) return;
    const { grid, legend, cols, rows, meters_per_cell: mpc } = tg;
    if (!Array.isArray(grid) || grid.length !== rows || cols <= 0 || rows <= 0 || mpc <= 0) {
      errors.push("scene", `terrain_grid inconsistente (filas=${grid?.length} rows=${rows} cols=${cols} mpc=${mpc}); uso color plano`);
      return;
    }
    const ctx = this.ctx;
    // Anclaje GLOBAL: la esquina NW del grid es la del rect del tile (la misma
    // convención que terrain_grid.origin en la colisión de nefan-core).
    const originX = tile.rect.minX;
    const originZ = tile.rect.minZ;
    // Base de la hierba en 0-255 para el ruido anti-flat: el modelo de imagen
    // copia las manchas de color plano tal cual, así que una variación sutil
    // determinista por celda le da "textura" que interpretar como suelo natural.
    const base = tile.scene.terrain?.color;
    const grassRgb: [number, number, number] =
      base && base.length >= 3
        ? [base[0] * 255, base[1] * 255, base[2] * 255]
        : [29, 42, 24];
    for (let r = 0; r < rows; r++) {
      const row = grid[r];
      if (typeof row !== "string") continue;
      const cmax = Math.min(cols, row.length);
      for (let c = 0; c < cmax; c++) {
        const ch = row[c];
        const x0 = originX + c * mpc;
        const z0 = originZ + r * mpc;
        const [px0, py0] = this.toScreen(x0, z0);
        const [px1, py1] = this.toScreen(x0 + mpc, z0 + mpc);
        if (ch === "g") {
          // grass = terreno base con ruido ±4% (hash determinista por celda).
          const f = 0.96 + 0.08 * cellHash01(c, r);
          const rr = Math.min(255, Math.round(grassRgb[0] * f));
          const gg = Math.min(255, Math.round(grassRgb[1] * f));
          const bb = Math.min(255, Math.round(grassRgb[2] * f));
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        } else {
          const color = TERRAIN_CHAR_COLOR[ch] ?? terrainColorFromName(legend[ch] ?? "");
          if (!color) continue;
          ctx.fillStyle = color;
        }
        // +1px para evitar costuras entre celdas por el redondeo.
        ctx.fillRect(Math.floor(px0), Math.floor(py0), Math.ceil(px1 - px0) + 1, Math.ceil(py1 - py0) + 1);
      }
    }
  }

  /** Pinta las terrain_features vectoriales en el ctx/transform ACTUAL (llamado
   *  desde captureSchematic tras paintTerrainGrid). Polylines con grosor y
   *  extremos redondeados, suavizadas por punto medio (quadraticCurveTo, sin
   *  dependencias); `closed` → polígono relleno. Feature malformada o sin color
   *  resoluble → errors.push y se omite (nunca tumba la captura). */
  private paintTerrainFeatures(tile: RendererTile): void {
    const feats = tile.scene.terrain_features;
    if (!Array.isArray(feats) || feats.length === 0) return;
    const mpc = tile.scene.terrain_grid?.meters_per_cell ?? 2;
    const ctx = this.ctx;
    const originX = tile.rect.minX;
    const originZ = tile.rect.minZ;
    for (const f of feats) {
      if (!f || !Array.isArray(f.points) || f.points.length < 2) {
        errors.push("scene", `terrain_feature "${f?.type}" con points malformados; omitida`);
        continue;
      }
      const color =
        (typeof f.color === "string" && f.color) ||
        FEATURE_TYPE_COLOR[f.type] ||
        terrainColorFromName(f.type);
      if (!color) {
        errors.push("scene", `terrain_feature tipo "${f.type}" sin color resoluble; omitida`);
        continue;
      }
      // Celda → mundo → pantalla.
      const pts: [number, number][] = [];
      let bad = false;
      for (const p of f.points) {
        const [c, r] = p;
        if (typeof c !== "number" || typeof r !== "number" || !Number.isFinite(c) || !Number.isFinite(r)) {
          bad = true;
          break;
        }
        pts.push(this.toScreen(originX + c * mpc, originZ + r * mpc));
      }
      if (bad) {
        errors.push("scene", `terrain_feature "${f.type}" con puntos no numéricos; omitida`);
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 2) {
        ctx.lineTo(pts[1][0], pts[1][1]);
      } else {
        // Suavizado: cada vértice interior es punto de control de una curva
        // cuadrática hacia el punto medio del siguiente segmento.
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      }
      if (f.closed) {
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, (f.width ?? 1) * mpc * this.scale);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
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

    if (this.tiles.size === 0) return;
    this.bakedThisFrame = false;

    // Rect mundial visible (para culling de tiles).
    const viewMinX = -this.offsetX / this.scale;
    const viewMinZ = -this.offsetY / this.scale;
    const viewMaxX = (w - this.offsetX) / this.scale;
    const viewMaxZ = (h - this.offsetY) / this.scale;
    const visible = [...this.tiles.values()]
      .filter(
        (t) => t.rect.maxX > viewMinX && t.rect.minX < viewMaxX &&
               t.rect.maxZ + Math.max(t.planOverhangM, t.imageOverhangM) > viewMinZ &&
               t.rect.minZ < viewMaxZ,
      )
      // Orden del pintor: el voladizo norte pisa al vecino de detrás.
      .sort((a, b) => (a.ty ?? -1e9) - (b.ty ?? -1e9) || (a.tx ?? 0) - (b.tx ?? 0));
    const gridKeys = new Set<string>();
    for (const t of this.tiles.values()) {
      if (t.tx !== undefined && t.ty !== undefined) gridKeys.add(`${t.tx},${t.ty}`);
    }

    // ── Paso de tiles: capa horneada (o imagen IA) sobre su rect mundial ────
    for (const tile of visible) {
      const [fx, fy] = this.toScreen(tile.rect.minX, tile.rect.minZ);
      const fw = (tile.rect.maxX - tile.rect.minX) * this.scale;
      const fh = (tile.rect.maxZ - tile.rect.minZ) * this.scale;
      if (tile.sceneImage) {
        // Tile con fondo IA: la imagen sustituye a la capa horneada (cubre
        // el rect más su voladizo norte).
        const [, iy] = this.toScreen(tile.rect.minX, tile.rect.minZ - tile.imageOverhangM);
        ctx.drawImage(tile.sceneImage, fx, iy, fw, fy + fh - iy);
      } else {
        if (!tile.terrainLayer && !this.bakedThisFrame) {
          this.bakeTerrainLayer(tile);
          this.bakedThisFrame = true;
        }
        if (tile.terrainLayer) {
          tile.layerLastUsed = performance.now();
          const prevSmooth = ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled = false; // celdas nítidas estilo blueprint
          const [, ly] = this.toScreen(tile.rect.minX, tile.rect.minZ - tile.planOverhangM);
          ctx.drawImage(tile.terrainLayer, fx, ly, fw, fy + fh - ly);
          ctx.imageSmoothingEnabled = prevSmooth;
        } else {
          const terrainColor = rgb01ToCss(tile.scene.terrain?.color) ?? DEFAULT_TERRAIN_COLOR;
          ctx.fillStyle = terrainColor;
          ctx.fillRect(fx, fy, fw, fh);
        }
      }
      // Borde de "fin del mundo conocido": SOLO en los lados sin vecino (las
      // costuras entre tiles existentes no se marcan — el mundo es continuo).
      ctx.strokeStyle = SCENE_PLATE_BORDER;
      ctx.lineWidth = 1;
      if (tile.tx === undefined || tile.ty === undefined) {
        ctx.strokeRect(fx, fy, fw, fh);
      } else {
        ctx.beginPath();
        if (!gridKeys.has(`${tile.tx},${tile.ty - 1}`)) { ctx.moveTo(fx, fy); ctx.lineTo(fx + fw, fy); }
        if (!gridKeys.has(`${tile.tx},${tile.ty + 1}`)) { ctx.moveTo(fx, fy + fh); ctx.lineTo(fx + fw, fy + fh); }
        if (!gridKeys.has(`${tile.tx - 1},${tile.ty}`)) { ctx.moveTo(fx, fy); ctx.lineTo(fx, fy + fh); }
        if (!gridKeys.has(`${tile.tx + 1},${tile.ty}`)) { ctx.moveTo(fx + fw, fy); ctx.lineTo(fx + fw, fy + fh); }
        ctx.stroke();
      }
    }

    // Grid continuo en world-space visible: orientación uniforme sobre campo
    // y tiles, refuerza la continuidad del plano.
    ctx.strokeStyle = GRID_COLOR;
    // 1px sólido (no 0.5): con cámara float las líneas caen en posiciones
    // subpíxel; una línea <1px titilaría en opacidad al cruzar bordes de
    // píxel, una de 1px solo se antialias y desliza limpia.
    ctx.lineWidth = 1;
    const step = Math.max(1, Math.ceil(18 / this.scale)); // ≥~18px entre líneas
    const wl = Math.floor(viewMinX / step) * step;
    for (let gx = wl; gx <= viewMaxX; gx += step) {
      const [sx] = this.toScreen(gx, 0);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    }
    const wt = Math.floor(viewMinZ / step) * step;
    for (let gz = wt; gz <= viewMaxZ; gz += step) {
      const [, sy] = this.toScreen(0, gz);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }

    // Luces ambientales de los tiles visibles, como halos suaves.
    for (const tile of visible) {
      const lights = tile.scene.lighting?.lights ?? [];
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
    }

    // Static scene elements de los tiles visibles, ordenados por Z global.
    // Un tile con imagen IA o con blueprint compuesto ya los lleva pintados
    // (solo overlay de debug).
    const staticObjects = visible
      .filter((t) => !t.sceneImage && !t.planImage)
      .flatMap((t): SceneObject[] => t.scene.objects ?? [])
      .filter((o) => o.category !== "creature")
      .sort((a, b) => (a.position?.[2] ?? 0) - (b.position?.[2] ?? 0));
    for (const obj of staticObjects) {
      this.drawSceneBox(obj);
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

    // Velo de carga direccional — lo último, por encima de todo.
    if (this.edgeLoading) this.drawEdgeLoading();
    if (this.edgeFlash) this.drawEdgeFlash();
  }


  /** Banda con gradiente oscuro en el lado del viewport por el que se cruzó,
   *  con el texto de estado y puntos animados. Espacio de PANTALLA (cubre el
   *  lado del viewport, no de la escena). */
  /** Flash direccional activo (borde + timestamp de fin), o null. */
  private edgeFlash: { edge: EdgeSide; until: number } | null = null;

  private drawEdgeFlash(): void {
    const now = performance.now();
    if (!this.edgeFlash || now >= this.edgeFlash.until) {
      this.edgeFlash = null;
      return;
    }
    const { edge, until } = this.edgeFlash;
    const alpha = 0.55 * ((until - now) / 1200);
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const band = Math.round((edge === "east" || edge === "west" ? w : h) * 0.18);
    let grad: CanvasGradient;
    switch (edge) {
      case "north": grad = ctx.createLinearGradient(0, 0, 0, band); break;
      case "south": grad = ctx.createLinearGradient(0, h, 0, h - band); break;
      case "west": grad = ctx.createLinearGradient(0, 0, band, 0); break;
      case "east": grad = ctx.createLinearGradient(w, 0, w - band, 0); break;
    }
    grad.addColorStop(0, `rgba(214, 205, 160, ${alpha.toFixed(3)})`);
    grad.addColorStop(1, "rgba(214, 205, 160, 0)");
    ctx.fillStyle = grad;
    switch (edge) {
      case "north": ctx.fillRect(0, 0, w, band); break;
      case "south": ctx.fillRect(0, h - band, w, band); break;
      case "west": ctx.fillRect(0, 0, band, h); break;
      case "east": ctx.fillRect(w - band, 0, band, h); break;
    }
  }

  private drawEdgeLoading(): void {
    const { edge, text } = this.edgeLoading!;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const band = Math.round((edge === "east" || edge === "west" ? w : h) * 0.28);
    let grad: CanvasGradient;
    let tx = w / 2;
    let ty = h / 2;
    switch (edge) {
      case "north":
        grad = ctx.createLinearGradient(0, 0, 0, band);
        ty = band * 0.45;
        break;
      case "south":
        grad = ctx.createLinearGradient(0, h, 0, h - band);
        ty = h - band * 0.45;
        break;
      case "west":
        grad = ctx.createLinearGradient(0, 0, band, 0);
        tx = band * 0.45;
        break;
      case "east":
        grad = ctx.createLinearGradient(w, 0, w - band, 0);
        tx = w - band * 0.45;
        break;
    }
    grad.addColorStop(0, "rgba(8, 6, 14, 0.85)");
    grad.addColorStop(1, "rgba(8, 6, 14, 0)");
    ctx.fillStyle = grad;
    switch (edge) {
      case "north": ctx.fillRect(0, 0, w, band); break;
      case "south": ctx.fillRect(0, h - band, w, band); break;
      case "west": ctx.fillRect(0, 0, band, h); break;
      case "east": ctx.fillRect(w - band, 0, band, h); break;
    }
    const dots = ".".repeat(1 + (Math.floor(performance.now() / 400) % 3));
    ctx.fillStyle = "rgba(230, 224, 200, 0.9)";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text + dots, tx, ty);
  }

  /** Overlay (B): outline every solid object's collision box (red, what blocks
   *  movement = `pos ± sizeXZ/2`) and every segmented occluder's actual painted
   *  footprint (cyan dashed). The gap between a red and a cyan box is exactly how
   *  imprecise the collision is vs the image — what Phase 2 would snap together. */
  private drawCollisionDebug(objects: Entity[]): void {
    const ctx = this.ctx;
    ctx.save();

    // Solid terrain cells (walls/water — what terrainCollider blocks): filled
    // translucent orange, distinct from the red object AABBs. Todos los tiles.
    ctx.fillStyle = "rgba(255,140,0,0.30)";
    for (const tile of this.tiles.values()) {
      const tg = tile.scene.terrain_grid;
      if (!tg?.solid_chars?.length) continue;
      const solidSet = new Set(tg.solid_chars);
      const mpc = tg.meters_per_cell;
      const ox = tile.rect.minX;
      const oz = tile.rect.minZ;
      for (let r = 0; r < tg.rows; r++) {
        const row = tg.grid[r];
        if (typeof row !== "string") continue;
        const cmax = Math.min(tg.cols, row.length);
        for (let c = 0; c < cmax; c++) {
          if (!solidSet.has(row[c])) continue;
          const [x0, y0] = this.toScreen(ox + c * mpc, oz + r * mpc);
          const [x1, y1] = this.toScreen(ox + (c + 1) * mpc, oz + (r + 1) * mpc);
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      }
    }

    // Colisión BASE del plan (agua del map_ground + huellas de volumes): celdas azules.
    // Activa desde que llega el tile, antes de imagen y análisis.
    ctx.fillStyle = "rgba(80,140,255,0.35)";
    for (const tile of this.tiles.values()) {
      this.fillGridCells(tile, tile.svgGrid);
    }

    // Colisión DERIVADA de la imagen (segmentos sólidos clasificados por
    // visión): celdas violetas. Es la colisión que manda en tiles analizados.
    ctx.fillStyle = "rgba(160,80,255,0.35)";
    for (const tile of this.tiles.values()) {
      this.fillGridCells(tile, tile.imageGrid);
    }

    // Authored collision footprints (same set + rule as main.ts collidesAt):
    // filled translucent red + bright outline so they read over the painting.
    // En tiles con SVG aplicado o ANALIZADOS, la colisión derivada manda y
    // estos AABBs ya no bloquean — se omiten para mostrar la colisión real.
    for (const o of objects) {
      if (o.category !== "building" && o.category !== "prop") continue;
      if (!o.sizeXZ) continue;
      if (this.schemaAabbsDisabledAt(o.pos.x, o.pos.z)) continue;
      const [cx, cy] = this.toScreen(o.pos.x, o.pos.z);
      const w = o.sizeXZ.x * this.scale;
      const h = o.sizeXZ.z * this.scale;
      ctx.fillStyle = "rgba(255,40,40,0.18)";
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeStyle = "rgba(255,40,40,1)";
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    }

    // Recortes `tall` clasificados por visión: caja discontinua cian +
    // baseline sólida (el borde sur = z-index del depth-sort) + etiqueta.
    ctx.lineWidth = 3;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    for (const occ of this.occluders) {
      const w = occ.world;
      const [ix, iy] = this.toScreen(w.minX, w.minZ);
      const iw = (w.maxX - w.minX) * this.scale;
      const ih = (w.maxZ - w.minZ) * this.scale;
      const color = "rgba(60,255,255,1)";
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = color;
      ctx.strokeRect(ix, iy, iw, ih);
      // Baseline del depth-sort: por debajo de esta línea el jugador tapa al
      // recorte; por encima, el recorte tapa al jugador.
      const by = this.toScreen(0, occ.baselineZ)[1];
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ix, by);
      ctx.lineTo(ix + iw, by);
      ctx.stroke();
      // Etiqueta solo si la caja es legible en pantalla: con decenas de
      // recortes pequeños (p. ej. troncos de árbol) las etiquetas se solapan
      // en una nube ilegible; la caja + baseline ya los marcan.
      if (iw >= 48) {
        const name = occ.label ??
          (occ.tileKey !== undefined ? occ.id.replace(`${occ.tileKey}:`, "") : occ.id);
        const label = `${name} z=${occ.baselineZ.toFixed(1)}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(10,10,14,0.75)";
        ctx.fillRect(ix, iy - 15, tw + 8, 14);
        ctx.fillStyle = color;
        ctx.fillText(label, ix + 4, iy - 4);
      }
    }
    ctx.setLineDash([]);

    // Legend with solid swatches (below the top HUD bar).
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,40,40,1)";
    ctx.fillRect(12, 52, 14, 10);
    ctx.fillText("colision del esquema (solo tiles sin svg/analisis)", 32, 61);
    ctx.fillStyle = "rgba(80,140,255,1)";
    ctx.fillRect(12, 70, 14, 10);
    ctx.fillText("colision base del plan (agua+huellas)", 32, 79);
    ctx.fillStyle = "rgba(160,80,255,1)";
    ctx.fillRect(12, 88, 14, 10);
    ctx.fillText("colision derivada de la imagen (solid)", 32, 97);
    ctx.fillStyle = "rgba(60,255,255,1)";
    ctx.fillRect(12, 106, 14, 10);
    ctx.fillText("recorte tall — linea solida = z-index", 32, 115);
    ctx.fillStyle = "rgba(255,140,0,1)";
    ctx.fillRect(12, 124, 14, 10);
    ctx.fillText("terreno solido del esquema (muro/agua)", 32, 133);
    ctx.restore();
  }

  /** Pinta las celdas sólidas de un grid derivado (svg o imagen) con el
   *  fillStyle ACTUAL del contexto. */
  private fillGridCells(tile: RendererTile, ig: ImageGridData | null): void {
    if (!ig?.solid_chars?.length) return;
    const ctx = this.ctx;
    const solidSet = new Set(ig.solid_chars);
    const mpc = ig.meters_per_cell;
    const ox = ig.origin?.[0] ?? tile.rect.minX;
    const oz = ig.origin?.[1] ?? tile.rect.minZ;
    for (let r = 0; r < ig.rows; r++) {
      const row = ig.grid[r];
      if (typeof row !== "string") continue;
      const cmax = Math.min(ig.cols, row.length);
      for (let c = 0; c < cmax; c++) {
        if (!solidSet.has(row[c])) continue;
        const [x0, y0] = this.toScreen(ox + c * mpc, oz + r * mpc);
        const [x1, y1] = this.toScreen(ox + (c + 1) * mpc, oz + (r + 1) * mpc);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  /** ¿El tile que contiene (x,z) tiene los AABBs del esquema desactivados
   *  (análisis de imagen aplicado o colisión base del plan instalada)? */
  private schemaAabbsDisabledAt(x: number, z: number): boolean {
    for (const t of this.tiles.values()) {
      if (
        (t.imageAnalyzed || t.svgApplied) &&
        x >= t.rect.minX && x < t.rect.maxX && z >= t.rect.minZ && z < t.rect.maxZ
      ) {
        return true;
      }
    }
    return false;
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
      // Con sprite, el cadáver es la anim `death` clampeada en su último
      // frame (la deja así la máquina de estados de character-sprites).
      if (e.sprite !== undefined) {
        this.drawSprite(e.sprite, e.forward, ex, ey);
        return;
      }
      ctx.fillStyle = "#555";
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(ex, ey, e.radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1.0;
      return;
    }

    const category = e.category ?? "creature";
    if (category === "building" || category === "terrain" || category === "prop" || category === "item" || category === "decor") {
      // Static-shape entities (buildings/props/items) are baked into the AI
      // scene image of THEIR tile; skip their schematic box when that tile has
      // one (same gate as the static objects loop). Creatures draw on top.
      if (this.tileImageAt(e.pos.x, e.pos.z)) return;
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
      const barY = e.sprite !== undefined ? ey - 70 : ey - (e.radius + 6);
      this.drawHpBar(ex, barY, e.hp, e.maxHp, e.color);
    }
  }

  private drawCreatureMarker(cx: number, cy: number, e: Entity): void {
    const ctx = this.ctx;
    // Dos modos explícitos, como drawPlayer: sprite definido → sheet (la anim
    // de ataque sustituye al highlight amarillo); undefined → círculo.
    if (e.sprite !== undefined) {
      this.drawSprite(e.sprite, e.forward, cx, cy);
      if (e.label) {
        ctx.fillStyle = "#d8c79a";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(e.label.slice(0, 30), cx, cy - 74);
      }
      return;
    }
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
    // visible=false del NpcDirector (el NPC se fue a otro sitio) → no dibujar.
    if (npc.alive === false) return;
    const [nx, ny] = this.toScreen(npc.pos.x, npc.pos.z);
    const ctx = this.ctx;
    if (npc.sprite !== undefined) {
      this.drawSprite(npc.sprite, npc.forward, nx, ny);
      if (npc.name) {
        ctx.fillStyle = "#9be";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(npc.name, nx, ny - 74);
      }
      return;
    }
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
