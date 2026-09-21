/** QUÉ ANIMACIÓN LE TOCA A UN PERSONAJE, y nada más.
 *
 *  La máquina de estados por entidad: recibe lo que el personaje está HACIENDO
 *  (vivo, andando, atacando, con un one-shot por evento) y decide qué anim del
 *  set base debe estar sonando. No sabe de hojas, ni de skins, ni de la cola de
 *  generación — para saber cuánto dura una anim pregunta por `duracionDe`, que
 *  es lo único que necesita del mundo de fuera.
 *
 *  POR QUÉ ESTÁ AQUÍ Y NO EN `character-sprites.ts`, que es de donde sale
 *  (H-1 de la QA de #492): aquel fichero estaba en 448 de 450 líneas ANTES de
 *  esta tanda, y su propio contrato dice por escrito que «al siguiente que
 *  necesite una línea ahí le toca el corte, NO subir el tope». El siguiente fue
 *  el inventario del menú dev, y la primera versión entró comprimiendo formato
 *  —449 con `eslint` verde y 467 en cuanto alguien corriera `npm run format`—,
 *  que es comprar líneas, no cortarlas. Éste es el corte que tocaba: la máquina
 *  de animación no comparte NADA con la generación de skins salvo el fichero en
 *  el que vivían, y sale entera con su único llamador
 *  (`animacion-de-entidades.ts`) apuntando aquí.
 *
 *  Es lógica de PRESENTACIÓN, no de juego: quién ataca y quién muere lo decide
 *  el sim en `nefan-core`; esto solo elige el clip con el que se pinta.
 *
 *  Puro y sin DOM: es del banco de `nefan-html/test/`. */
import { HOJAS_BASE_ANIMS } from "@nefan-core/src/contracts/sprite-census.js";

/** Las anims del set base, como conjunto: lo que se puede pedir. Una anim que
 *  no esté aquí no tiene hoja que dibujar y cae a `idle`. */
export const BASE_ANIM_SET: ReadonlySet<string> = new Set(HOJAS_BASE_ANIMS);

/** One-shots: se reproducen hasta el final y no se interrumpen por locomoción
 *  (sí por muerte o por otro one-shot nuevo). */
const ONE_SHOT: ReadonlySet<string> = new Set([
  "quick",
  "heavy",
  "medium",
  "defensive",
  "precise",
  "hit_react",
  "death",
]);

export interface CharacterAnimState {
  anim: string;
  animStartedAt: number;
}

export function newAnimState(now: number = performance.now()): CharacterAnimState {
  return { anim: "idle", animStartedAt: now };
}

export interface AnimInputs {
  alive: boolean;
  moving: boolean;
  sprinting?: boolean;
  /** Trigger por nivel (enemigos): state winding_up|attacking del sim. */
  attacking?: boolean;
  attackType?: string;
  /** Trigger por evento (player): anim one-shot que arranca ESTE frame
   *  (ataque de attack_started, hit_react de attack_landed). Reinicia aunque
   *  ya fuera la anim actual — dos quick seguidos se ven como dos golpes. */
  oneShot?: string;
  /** Anim pedida por el NpcDirector (NpcUpdate.animation). Sin sheet en el
   *  set base cae a idle — las ambient están mapeadas pero sin renderear. */
  requestedAnim?: string;
}

/** Avanza la máquina de estados de animación de una entidad. Muta `state` y
 *  resetea `animStartedAt` solo cuando la anim cambia (o un one-shot por evento
 *  se re-dispara). Prioridad: muerte > one-shot por evento > ataque por nivel >
 *  one-shot en curso > locomoción > anim pedida > idle.
 *
 *  `duracionDe` llega inyectada porque la duración vive en la HOJA, que es del
 *  gestor de sprites: con ella dentro, esta máquina necesitaría la caché entera
 *  para contestar una pregunta que no es suya. */
export function avanzarAnimacion(
  state: CharacterAnimState,
  inputs: AnimInputs,
  now: number,
  duracionDe: (anim: string) => number,
): void {
  const set = (anim: string): void => {
    if (state.anim !== anim) {
      state.anim = anim;
      state.animStartedAt = now;
    }
  };

  if (!inputs.alive) {
    // death arranca en la transición viva→muerta y clampa en el último
    // frame (pickFrame de one-shot): el cadáver se queda en pantalla.
    set("death");
    return;
  }
  if (state.anim === "death") set("idle"); // respawn/revive

  if (inputs.oneShot && BASE_ANIM_SET.has(inputs.oneShot)) {
    state.anim = inputs.oneShot;
    state.animStartedAt = now;
    return;
  }

  if (inputs.attacking) {
    const attackAnim =
      inputs.attackType && BASE_ANIM_SET.has(inputs.attackType) ? inputs.attackType : "medium";
    // Nivel, no evento: arranca al entrar en winding_up|attacking y clampa
    // en el último frame si el estado del sim dura más que la anim.
    set(attackAnim);
    return;
  }

  const oneShotActive = ONE_SHOT.has(state.anim) && now - state.animStartedAt < duracionDe(state.anim);
  if (oneShotActive) return;

  if (inputs.moving) {
    set(inputs.sprinting ? "run" : "walk");
    return;
  }
  if (inputs.requestedAnim) {
    set(BASE_ANIM_SET.has(inputs.requestedAnim) ? inputs.requestedAnim : "idle");
    return;
  }
  set("idle");
}
