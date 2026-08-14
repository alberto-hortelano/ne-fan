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

import { buildFpsTileSpec, type FpsTileSpec } from "@nefan-core/src/scene/blueprint/fps-spec.js";
import type { GroundFeature } from "@nefan-core/src/scene/blueprint/ground.js";
import type { Volume } from "@nefan-core/src/scene/blueprint/volumes.js";
import { buildLayout, type SurfaceLayout } from "@nefan-core/src/scene/greybox/surfaces.js";
import { errors } from "../ui/error-log.js";
import type { Entity } from "./canvas-renderer.js";
import type { AtlasImage, FpsGl } from "./fps-gl.js";
import type { AttackAreaParams, PlayerView, Renderer2D } from "./renderer2d.js";
import type { SpriteRenderer } from "./sprite-renderer.js";

export interface FpsTilePlan {
  ground: GroundFeature[];
  volumes: Volume[];
  biome?: string;
}

export interface FpsTileSurfaces {
  fps: FpsTileSpec;
  layout: SurfaceLayout;
}

export class FpsRenderer implements Renderer2D {
  private el: HTMLCanvasElement;
  private gl: FpsGl | null = null;
  private pending: Array<(gl: FpsGl) => void> = [];
  private surfaces = new Map<string, FpsTileSurfaces>();
  private visible = false;
  private onResize = () => this.syncSize();

  constructor(
    private host: HTMLCanvasElement,
    opts: { spriteRenderer?: SpriteRenderer } = {},
  ) {
    this.el = document.createElement("canvas");
    this.el.id = "fps-canvas";
    this.el.style.display = "none";
    // Hermano del canvas 2D: hereda el CSS de `canvas { flex: 1 }`.
    host.parentElement?.insertBefore(this.el, host.nextSibling);
    window.addEventListener("resize", this.onResize);
    void import("./fps-gl.js")
      .then(({ FpsGl }) => {
        this.gl = new FpsGl(this.el, opts.spriteRenderer);
        this.syncSize();
        for (const fn of this.pending) fn(this.gl);
        this.pending = [];
      })
      .catch((err: unknown) => {
        errors.push("render", "la vista fps no pudo cargar three.js", err);
      });
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
    if (on) this.syncSize();
  }

  /** Instala (o reinstala) el tile: spec fps (cutaways cerrados, metros) +
   *  layout de superficies. Determinista — el mismo plan produce el mismo
   *  layout, que es la clave del atlas. */
  installTile(key: string, plan: FpsTilePlan, rect: { minX: number; minZ: number }): void {
    try {
      const fps = buildFpsTileSpec(
        { ground: plan.ground, volumes: plan.volumes, biome: plan.biome },
        key,
      );
      const layout = buildLayout(fps.primsM);
      this.surfaces.set(key, { fps, layout });
      this.withGl((gl) => gl.installTile(key, fps.primsM, fps.lightsM, layout, rect));
    } catch (err) {
      errors.push("render", `el tile ${key} no compone en la vista fps`, err);
    }
  }

  removeTile(key: string): void {
    this.surfaces.delete(key);
    this.withGl((gl) => gl.removeTile(key));
  }

  /** Superficies del tile (para el controller del atlas). */
  getTileSurfaces(key: string): FpsTileSurfaces | null {
    return this.surfaces.get(key) ?? null;
  }

  setActiveTile(key: string | null): void {
    this.withGl((gl) => gl.setActive(key));
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

  drawAttackArea(
    _player: Parameters<Renderer2D["drawAttackArea"]>[0],
    _params: AttackAreaParams,
    _mode: "windup" | "impact",
  ): void {
    // v1: sin telegraph en mundo (TODO: RingGeometry en el suelo delante de
    // la cámara). El feedback de combate vive en el HUD y los sprites.
  }

  debugState(): Record<string, unknown> {
    return {
      ready: this.gl !== null,
      visible: this.visible,
      surfaces: [...this.surfaces.keys()],
      ...(this.gl?.debugState() ?? {}),
    };
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.gl?.dispose();
    this.el.remove();
  }
}
