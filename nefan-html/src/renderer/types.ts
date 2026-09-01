/** Datos POR FRAME del mundo que el gameLoop entrega al renderer.
 *
 *  Vivían en canvas-renderer.ts, pasaron por `renderer2d.ts` (el contrato de
 *  las tres vistas) y aquí se quedan solos: con una sola vista, una interfaz
 *  `Renderer2D` con una única implementación mentía sobre qué era
 *  intercambiable — los datos, en cambio, siguen siendo el idioma entre el
 *  bucle del juego y quien pinta. */

import type { Vec3 } from "@nefan-core/src/types.js";

/** DE QUIÉN ES UNA ENTITY, que es lo mismo que decir quién puede borrarla.
 *
 *  Dos procedencias y ninguna colapsable: lo que DECLARA un tile (y por tanto
 *  desaparece cuando ese tile deja de declararlo) y lo que puso el motor
 *  narrativo a mitad de partida (`spawn_entity`), que no pertenece al scene
 *  data de nadie.
 *
 *  Es una unión discriminada y OBLIGATORIA, y ahí está el arreglo de #350.
 *  Antes esto era `tileKey?: string`, y entonces «es de runtime» y «se me
 *  olvidó ponerlo» eran el mismo `undefined`. De esa confusión salió el bug:
 *  `materializeSpawn` no escribía `tileKey` en ninguna de sus tres clases, así
 *  que la purga de NPCs (por identidad) dejaba vivo al spawn de runtime… y la
 *  de objetos, que era por GEOMETRÍA (`!inRect`), se llevaba por delante el
 *  cofre y la forja en cuanto el tile se volvía a difundir. Con `dueno`
 *  obligatorio, el estado malo no se puede escribir: `tsc` exige los cinco
 *  sitios que construyen una `Entity`. */
export type DuenoDeEntity =
  /** Lo declara el scene data de este tile: se va cuando deje de declararlo. */
  | { de: "tile"; key: string }
  /** Lo puso el motor a mitad de partida: no es de ningún tile, y solo
   *  desaparece si el motor lo retira o el jugador lo mata. */
  | { de: "runtime" };

/** Un cuerpo del mundo tal y como lo recibe el renderer: jugador, NPC,
 *  enemigo u objeto de escena. Lo produce main.ts (desde el sim y el scene
 *  data). */
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
  /** De quién es esta entity — gobierna la purga al re-emitir un tile. NO es
   *  «dónde está»: el NPC puede pasear fuera de su tile y el enemigo persigue
   *  al jugador; lo que se pregunta al purgar es de quién era, no dónde
   *  acabó. */
  dueno: DuenoDeEntity;
  /** Tipo del volumen del plan que YA representa a esta entity (`volume_id`
   *  de la world scene → `__plan.volumes[].type`). Presente = el greybox la
   *  pinta como volumen sólido, así que no lleva billboard encima: era la
   *  doble representación por la que un árbol declarado escondía dentro de su
   *  copa un poste que se atravesaba. Ausente = spawn dinámico o item, que se
   *  pintan como billboard. */
  volumeType?: string;
  name?: string;
  /** Scene category — drives the conceptual rendering shape (building/prop/item/creature). */
  category?: string;
  /** Footprint in metres on the XZ plane, taken from the scene JSON `scale`.
   *  Falls back to a square based on `radius` when not set. */
  sizeXZ?: { x: number; z: number };
  /** Altura en metros (scale[1] de la world scene) — alto del volumen que
   *  pinta el renderer y ancla del marcador de la entity mirada. */
  sizeY?: number;
  /** Pista de forma del volumen: cylinder/capsule | sphere | cone. Ausente o
   *  desconocida → caja (el switch vive en fps-gl.ts). */
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

/** Telegraph del ataque, pintado EN EL MUNDO: se FIJA antes de render() en
 *  vez de dibujarse después, porque en WebGL no hay lienzo sobre el que
 *  garabatear una vez emitido el frame. */
export interface AttackTelegraph {
  player: { pos: Vec3; forward: Vec3 };
  params: AttackAreaParams;
  mode: "windup" | "impact";
  opacity: number;
  /** Calidad del golpe (0..1) — solo tiñe el destello de impacto. */
  impactQuality: number;
}
