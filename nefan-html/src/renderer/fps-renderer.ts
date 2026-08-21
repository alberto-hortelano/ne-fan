/** Vista FPS (primera persona, estilo retro-FPS) — fachada SIN three.js.
 *
 *  Implementa el contrato por-frame Renderer2D; los internals WebGL (fps-gl)
 *  se cargan con import DINÁMICO al construirla (three fuera del bundle
 *  principal, patrón de los greybox). Hasta que el módulo GL llega, las
 *  instalaciones se encolan y render() no pinta (1-2 frames negros).
 *
 *  El canvas es PROPIO (#fps-canvas, hermano de #game): el CanvasRenderer 2D
 *  sigue siendo el dueño de tiles/colisión/pipeline oblicuo — esta vista solo
 *  PINTA distinto. setVisible() conmuta qué canvas se ve. */

import type { UiTheme } from "@nefan-core/src/games/ui-theme.js";
import { buildFpsTileSpec, type FpsTileSpec } from "@nefan-core/src/scene/blueprint/fps-spec.js";
import type { GroundFeature } from "@nefan-core/src/scene/blueprint/ground.js";
import type { Volume } from "@nefan-core/src/scene/blueprint/volumes.js";
import { buildLayout, type SurfaceLayout } from "@nefan-core/src/scene/greybox/surfaces.js";
import type { Edge } from "@nefan-core/src/world-map/types.js";
import { errors } from "../ui/error-log.js";
import type { Entity } from "./canvas-renderer.js";
import type { AtlasImage, FpsDebugCollision, FpsDebugView, FpsGl } from "./fps-gl.js";
import type { AttackAreaParams, AttackTelegraph, PlayerView, Renderer2D } from "./renderer2d.js";
import type { SpriteRenderer } from "./sprite-renderer.js";

export interface FpsTilePlan {
  ground: GroundFeature[];
  volumes: Volume[];
  biome?: string;
  /** Bloque de scatter declarativo del tile (crudo — lo valida fps-spec). */
  scatter_generators?: unknown;
  scatter_zones?: unknown;
  /** Descripción de la escena — la ambientación infiere la hora de ella. */
  scene_description?: string;
}

export interface FpsTileSurfaces {
  fps: FpsTileSpec;
  layout: SurfaceLayout;
}

export const FPS_DEBUG_VIEW_LABELS: Record<FpsDebugView, string> = {
  off: "off",
  collision: "colisión",
  surfaces: "celdas de atlas",
};
const FPS_DEBUG_VIEW_ORDER: FpsDebugView[] = ["off", "collision", "surfaces"];

export class FpsRenderer implements Renderer2D {
  /** La vista en primera persona no pinta texto de mundo: los nombres los
   *  da el prompt contextual de la UI (y no hay ctx 2D sobre el que
   *  escribir). No-op declarado para que el contrato obligue a
   *  pronunciarse. */
  setWorldTheme(_theme: UiTheme): void {}

  private el: HTMLCanvasElement;
  private gl: FpsGl | null = null;
  private pending: Array<(gl: FpsGl) => void> = [];
  private surfaces = new Map<string, FpsTileSurfaces>();
  private visible = false;
  private onResize = () => this.syncSize();
  private resizeObserver: ResizeObserver | null = null;
  private debugView: FpsDebugView = "off";
  private debugLabel: HTMLDivElement;
  private activeKey: string | null = null;
  private collisionCells: ((tileKey: string) => FpsDebugCollision | null) | null = null;
  /** Último telegraph/velo pedidos: el módulo GL llega por import dinámico y
   *  la cola `pending` ejecuta closures — si capturasen el valor del momento,
   *  al cargar three se pintaría un ataque ya terminado. */
  private telegraph: AttackTelegraph | null = null;
  private veilEdge: Edge | null = null;

  constructor(
    private host: HTMLCanvasElement,
    opts: { spriteRenderer?: SpriteRenderer } = {},
  ) {
    this.el = document.createElement("canvas");
    this.el.id = "fps-canvas";
    this.el.style.display = "none";
    // Hermano del canvas 2D: hereda el CSS de `canvas { flex: 1 }`.
    host.parentElement?.insertBefore(this.el, host.nextSibling);
    // Píldora de la tecla B: el canvas es WebGL (sin ctx 2D para pintarla
    // como en las otras vistas) → div fijo, mismo look que las píldoras.
    this.debugLabel = document.createElement("div");
    this.debugLabel.id = "fps-debug-label";
    this.debugLabel.style.cssText =
      "position:fixed;top:8px;left:8px;z-index:30;display:none;pointer-events:none;" +
      "background:rgba(10,10,16,0.78);color:#fff;font:12px monospace;padding:4px 10px;border-radius:4px;";
    document.body.appendChild(this.debugLabel);
    // Igual que el lienzo 2D: la caja manda, no la ventana (la barra de dev
    // cambia de alto al conectar y empuja el lienzo).
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.el);
    void import("./fps-gl.js")
      .then(({ FpsGl }) => {
        this.gl = new FpsGl(this.el, opts.spriteRenderer);
        this.syncSize();
        for (const fn of this.pending) fn(this.gl);
        this.pending = [];
        // Estado por-frame que no pasa por la cola: se aplica el ÚLTIMO valor.
        this.gl.setAttackTelegraph(this.telegraph);
        this.gl.setVeil(this.veilEdge);
      })
      .catch((err: unknown) => {
        errors.push("render", "la vista fps no pudo cargar three.js", err);
      });
  }

  /** Canvas WebGL propio de la vista fps (el #game 2D queda oculto): es el
   *  elemento visible al que main.ts engancha el click → pointer lock. */
  get element(): HTMLCanvasElement {
    return this.el;
  }

  private withGl(fn: (gl: FpsGl) => void): void {
    if (this.gl) fn(this.gl);
    else this.pending.push(fn);
  }

  private syncSize(): void {
    if (!this.visible) return;
    const w = this.el.clientWidth || window.innerWidth;
    const h = this.el.clientHeight || window.innerHeight;
    this.gl?.resize(w, h);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.el.style.display = on ? "" : "none";
    this.host.style.display = on ? "none" : "";
    this.debugLabel.style.display = on && this.debugView !== "off" ? "" : "none";
    if (on) this.syncSize();
  }

  /** Celdas sólidas por tile para el overlay B (main inyecta el muestreo del
   *  CollisionSystem — la colisión NO vive en este renderer). */
  setCollisionCellsProvider(fn: (tileKey: string) => FpsDebugCollision | null): void {
    this.collisionCells = fn;
  }

  /** Tecla B: off → colisión → celdas de atlas. Devuelve el modo nuevo. */
  cycleDebugView(): FpsDebugView {
    const i = FPS_DEBUG_VIEW_ORDER.indexOf(this.debugView);
    this.debugView = FPS_DEBUG_VIEW_ORDER[(i + 1) % FPS_DEBUG_VIEW_ORDER.length];
    this.syncDebugView();
    return this.debugView;
  }

  private syncDebugView(): void {
    const mode = this.debugView;
    this.debugLabel.textContent = `B · fps: ${FPS_DEBUG_VIEW_LABELS[mode]}`;
    this.debugLabel.style.display = this.visible && mode !== "off" ? "" : "none";
    this.withGl((gl) => {
      const cells =
        mode === "collision" && this.activeKey && this.collisionCells
          ? this.collisionCells(this.activeKey)
          : null;
      gl.setDebugView(mode, cells);
    });
  }

  /** Instala (o reinstala) el tile: spec fps (cutaways cerrados, metros) +
   *  layout de superficies. Determinista — el mismo plan produce el mismo
   *  layout, que es la clave del atlas. */
  installTile(key: string, plan: FpsTilePlan, rect: { minX: number; minZ: number }): void {
    try {
      const fps = buildFpsTileSpec(
        {
          ground: plan.ground,
          volumes: plan.volumes,
          biome: plan.biome,
          scatter_generators: plan.scatter_generators,
          scatter_zones: plan.scatter_zones,
          scene_description: plan.scene_description,
        },
        key,
      );
      if (fps.timeOfDay && fps.timeOfDay !== "dia") {
        console.info(`fps ambience ${key}: ${fps.timeOfDay}`);
      }
      if (fps.scatterError) {
        errors.push("scene", `scatter de ${key} inválido (se ignora): ${fps.scatterError}`);
      }
      if (fps.scatterCounts) {
        const summary = fps.scatterCounts.map((c) => `${c.kind} ${c.placed}/${c.wanted}`).join(", ");
        console.info(`fps scatter ${key}: ${summary}`);
      }
      const layout = buildLayout(fps.primsM);
      this.surfaces.set(key, { fps, layout });
      this.withGl((gl) => gl.installTile(key, fps.primsM, fps.lightsM, layout, rect, { sky: fps.sky, fog: fps.fog }));
    } catch (err) {
      errors.push("render", `el tile ${key} no compone en la vista fps`, err);
    }
  }

  removeTile(key: string): void {
    this.surfaces.delete(key);
    this.withGl((gl) => gl.removeTile(key));
  }

  /** Vacía el mundo 3D. La llama resetWorld() del cliente (arranque de
   *  sesión, resume, fixture): sin esto los tiles de la partida anterior se
   *  quedaban instalados en la escena three y reaparecían de fantasmas. */
  clearTiles(): void {
    this.surfaces.clear();
    this.activeKey = null;
    this.withGl((gl) => gl.clearTiles());
  }

  /** Superficies del tile (para el controller del atlas). */
  getTileSurfaces(key: string): FpsTileSurfaces | null {
    return this.surfaces.get(key) ?? null;
  }

  setActiveTile(key: string | null): void {
    this.activeKey = key;
    this.withGl((gl) => gl.setActive(key));
    // El overlay de colisión es del tile activo: reconstruirlo al cambiar.
    if (this.debugView !== "off") this.syncDebugView();
  }

  applyAtlas(key: string, images: Map<string, AtlasImage>): void {
    this.withGl((gl) => gl.applyAtlas(key, images));
  }

  clearAtlas(key: string): void {
    this.withGl((gl) => gl.clearAtlas(key));
  }

  render(player: PlayerView, enemies: Entity[], objects: Entity[], npcs: Entity[]): void {
    this.gl?.render(player, enemies, objects, npcs);
  }

  /** Telegraph del ataque, EN EL MUNDO y antes de render(): la distancia y la
   *  precisión deciden el daño, así que pintarlo en DOM mentiría con la
   *  perspectiva. Sustituye a drawAttackArea para esta vista. */
  setAttackTelegraph(t: AttackTelegraph | null): void {
    this.telegraph = t;
    // Directo, NO por la cola `pending`: esto se llama en cada frame y una
    // cola sin drenar (three aún cargando) crecería sin tope. El estado
    // vigente se re-aplica de una vez cuando el módulo GL llega.
    this.gl?.setAttackTelegraph(t);
  }

  /** Muro de niebla sobre la frontera del tile activo, o null para que se
   *  disipe. El velo lo sigue DECIDIENDO el FrontierManager. */
  setFrontierVeil(edge: Edge | null): void {
    this.veilEdge = edge;
    this.gl?.setVeil(edge); // por frame: mismo motivo que el telegraph
  }

  /** Punto de mundo → píxeles CSS del canvas (null si cae detrás del ojo).
   *  Lo consumen las etiquetas de nombre, que viven en DOM. */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number; depthM: number } | null {
    return this.gl?.projectToScreen(x, y, z) ?? null;
  }

  /** Altura visual del suelo (relieve) en un punto de mundo — 0 hasta que
   *  three carga. La usan las etiquetas para colgar sobre la cabeza. */
  groundYAt(x: number, z: number): number {
    return this.gl?.groundYAt(x, z) ?? 0;
  }

  drawAttackArea(
    _player: Parameters<Renderer2D["drawAttackArea"]>[0],
    _params: AttackAreaParams,
    _mode: "windup" | "impact",
  ): void {
    // No-op declarado: el telegraph de esta vista es geometría de mundo y se
    // fija con setAttackTelegraph ANTES de render(). Un overlay dibujado
    // después del frame no existe en WebGL.
  }

  debugState(): Record<string, unknown> {
    return {
      ready: this.gl !== null,
      visible: this.visible,
      surfaces: [...this.surfaces.keys()],
      telegraph: null,
      veil: null,
      ...(this.gl?.debugState() ?? {}),
    };
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.gl?.dispose();
    this.debugLabel.remove();
    this.el.remove();
  }
}
