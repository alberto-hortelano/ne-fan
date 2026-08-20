/** Contrato mínimo de un renderer de vista del cliente 2D — la superficie
 *  POR FRAME que consume el gameLoop. La instalación de escena difiere por
 *  vista (addTile acumulativo en la oblicua, installStage de escena única en
 *  el proscenio) y queda fuera del contrato: main.ts la cablea por vista.
 *  Los métodos exclusivos de la ruta oblicua/imagen (tiles, occluders,
 *  captureSchematic…) viven en el CanvasRenderer concreto — sus subsistemas
 *  (SceneImageController, Auto-img, frontier) son oblicua-only y se apagan
 *  en proscenio desde applySessionView. */

import type { UiTheme } from "@nefan-core/src/games/ui-theme.js";
import type { Vec3 } from "@nefan-core/src/types.js";
import type { Entity } from "./canvas-renderer.js";

export interface PlayerView {
  pos: Vec3;
  forward: Vec3;
  hp: number;
  maxHp: number;
  sprite?: Entity["sprite"];
}

export interface AttackAreaParams {
  optimal_distance: number;
  distance_tolerance: number;
  area_radius: number;
}

export interface Renderer2D {
  /** Tema de la partida para lo que el renderer pinta DENTRO del lienzo
   *  (nombres de NPC, etiquetas de salida): ahí no llega el CSS, y el
   *  nombre de un personaje debe leerse igual sobre su cabeza que en el
   *  panel de diálogo. Obligatorio para que cada vista se pronuncie: la fps
   *  no pinta texto de mundo y lo declara con un no-op. */
  setWorldTheme(theme: UiTheme): void;
  render(player: PlayerView, enemies: Entity[], objects: Entity[], npcs: Entity[]): void;
  drawAttackArea(
    player: { pos: Vec3; forward: Vec3 },
    params: AttackAreaParams,
    mode: "windup" | "impact",
    opacity?: number,
    impactQuality?: number,
  ): void;
}
