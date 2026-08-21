/** Contrato mínimo de un renderer de vista del cliente 2D — la superficie
 *  POR FRAME que consume el gameLoop. La instalación de escena difiere por
 *  vista (addTile acumulativo en la oblicua, installTile en la fps) y queda
 *  fuera del contrato: main.ts la cablea por vista.
 *  Los métodos exclusivos de la ruta oblicua (tiles, occluders,
 *  captureSchematic…) viven en el CanvasRenderer concreto.
 *
 *  Aquí vive TAMBIÉN `Entity`, el dato por frame que el contrato recibe:
 *  estaba en canvas-renderer.ts y hacía que el contrato dependiera de una
 *  implementación concreta —la oblicua— de la que la fps no usa nada. */

import type { UiTheme } from "@nefan-core/src/games/ui-theme.js";
import type { Vec3 } from "@nefan-core/src/types.js";

/** Un cuerpo del mundo tal y como lo recibe un renderer: jugador, NPC,
 *  enemigo u objeto de escena. Lo produce main.ts (desde el sim y el scene
 *  data) y lo consumen las tres vistas — no es de ninguna. */
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
  /** Rol de estilo del skin ("commoner"|"noble"|"warrior", styleRoleForNpc):
   *  decide qué ref character_* del pack guía el hero-shot. */
  styleRole?: string;
  /** Anim pedida por la vida ambiental (state_update.npcs[].anim). */
  requestedAnim?: string;
  /** true mientras el NPC huye (state_update.npcs[].run) → anim run. */
  npcRun?: boolean;
  /** Tile del que procede el NPC (clave del scene data que lo declaró) —
   *  gobierna la purga al re-emitir ese tile; el NPC puede pasear fuera. */
  tileKey?: string;
  /** true = estático declarado en el scene data (no un spawn dinámico). */
  sceneDeclared?: boolean;
  name?: string;
  /** Scene category — drives the conceptual rendering shape (building/prop/item/creature). */
  category?: string;
  /** Footprint in metres on the XZ plane, taken from the scene JSON `scale`.
   *  Falls back to a square based on `radius` when not set. */
  sizeXZ?: { x: number; z: number };
  /** Altura en metros (scale[1] de la world scene) — extrusión del prisma en
   *  el schematic y umbral de entrada al depth-sort (edificios/árboles). */
  sizeY?: number;
  /** Pista de forma para el schematic: box (rect) | cylinder/sphere (círculo) |
   *  cone (triángulo). Ausente → rectángulo (o rombo si category==="item"). */
  shape?: string;
  /** Optional Mixamo character reference: when set and SpriteRenderer has the
   *  matching sheet cached, the entity is drawn as a sprite instead of a circle. */
  sprite?: { model: string; anim: string; angle: string; animStartedAt?: number };
  /** AI-generated sprite hash (objects/buildings) served from /cache/sprite/{hash}. */
  spriteHash?: string;
}

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

/** Telegraph del ataque para las vistas que lo pintan EN EL MUNDO (fps).
 *  Es el mismo dato que consume drawAttackArea, pero se FIJA antes de
 *  render() en vez de dibujarse después: en WebGL no hay lienzo sobre el que
 *  garabatear una vez emitido el frame. */
export interface AttackTelegraph {
  player: { pos: Vec3; forward: Vec3 };
  params: AttackAreaParams;
  mode: "windup" | "impact";
  opacity: number;
  /** Calidad del golpe (0..1) — solo tiñe el destello de impacto. */
  impactQuality: number;
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
