/** QUÉ ANIMACIÓN LLEVA CADA CUERPO ESTE FRAME.
 *
 *  La máquina de estados vive FUERA de `Entity` porque no es del mundo, es de
 *  cómo se dibuja: el track guarda la anim en curso, la última posición (para
 *  detectar movimiento — el bridge mueve a NPCs y enemigos, y el cliente solo
 *  ve deltas de posición) y el one-shot pendiente que dispara un evento de
 *  combate (`hit_react`).
 *
 *  Se lleva también el track del JUGADOR, que estaba suelto en `main.ts` como
 *  un `CharacterAnimState` de módulo: es el mismo problema con un solo cuerpo,
 *  y tenerlo aparte era lo que hacía falta recordar para vaciarlo con el mundo.
 *
 *  Sigue en el cliente y no en `nefan-core` a propósito: escribe `e.sprite`,
 *  que es del contrato del renderer, y le pregunta al `CharacterSpriteManager`
 *  qué hoja está lista — dos cosas que en core no existen.
 */

import type { Vec3 } from "@nefan-core/src/types.js";
import { newAnimState, type CharacterAnimState, type CharacterSpriteManager } from "./character-sprites.js";
import type { Entity } from "./types.js";

interface CharTrack {
  state: CharacterAnimState;
  lastX: number;
  lastZ: number;
  lastMovedAt: number;
  oneShot?: string;
}

/** Umbral de movimiento por frame (m) y ventana de gracia (ms): las posiciones
 *  de NPCs y enemigos llegan a ráfagas del bridge, no cada rAF — sin la ventana
 *  la anim oscilaría walk↔idle entre `state_update`s. */
const MOVE_EPS = 0.02;
const MOVE_GRACE_MS = 150;

export class AnimacionDeEntidades {
  #tracks = new Map<string, CharTrack>();
  #jugador: CharacterAnimState = newAnimState();

  constructor(
    private readonly sprites: CharacterSpriteManager,
    /** El ángulo de cámara único del juego: la clave con la que se piden las
     *  hojas. */
    private readonly angulo: string,
  ) {}

  /** Se va con el mundo: los tracks son de los cuerpos que había en él. */
  olvidar(): void {
    this.#tracks.clear();
  }

  /** Un golpe encajado: respingo en el siguiente frame de ese cuerpo. Se pide
   *  por id y no por entity porque quien lo sabe es el evento del sim, que solo
   *  trae el id — y si el cuerpo no está, no pasa nada: no hay a quién animar. */
  respingo(id: string): void {
    const track = this.#tracks.get(id);
    if (track) track.oneShot = "hit_react";
  }

  /** Puebla `e.sprite` para este frame según el estado de la entidad. */
  actualizar(e: Entity, now: number, opts: { npc: boolean }): void {
    const track = this.#track(e, now);
    const moving = this.#seMueve(track, e.pos, now);
    this.sprites.updateAnim(
      track.state,
      {
        // Los NPCs no mueren: `alive:false` significa «se fue» (el renderer lo
        // omite), no un cadáver.
        alive: opts.npc ? true : e.alive,
        moving,
        // NPCs huyendo (flee) corren; el resto de su locomoción es walk.
        sprinting: opts.npc ? e.npcRun : undefined,
        attacking: e.attacking,
        attackType: e.attackType,
        oneShot: track.oneShot,
        requestedAnim: opts.npc ? e.requestedAnim : undefined,
      },
      now,
    );
    track.oneShot = undefined;
    e.sprite = {
      model: this.sprites.modelFor(e.skinPrompt, track.state.anim),
      anim: track.state.anim,
      angle: this.angulo,
      animStartedAt: track.state.animStartedAt,
    };
  }

  /** El sprite del JUGADOR de este frame. `modelo` es su base ya resuelta
   *  (`y_bot` salvo que el elegido tenga el set completo en disco); `null`
   *  significa que no hay sprite y el renderer pinta lo que pinte sin él. */
  spriteDelJugador(
    now: number,
    modelo: string,
    skinPrompt: string,
    estado: { vivo: boolean; andando: boolean; esprintando: boolean; unaVez?: string },
  ): NonNullable<Entity["sprite"]> {
    this.sprites.updateAnim(
      this.#jugador,
      {
        alive: estado.vivo,
        moving: estado.andando,
        sprinting: estado.esprintando,
        oneShot: estado.unaVez,
      },
      now,
    );
    return {
      model: this.sprites.modelFor(skinPrompt, this.#jugador.anim, modelo),
      anim: this.#jugador.anim,
      angle: this.angulo,
      animStartedAt: this.#jugador.animStartedAt,
    };
  }

  /** Arranca la animación del jugador al vestirlo (entrar o reanudar). */
  jugadorEnReposo(now: number): void {
    this.#jugador.anim = "idle";
    this.#jugador.animStartedAt = now;
  }

  #track(e: Entity, now: number): CharTrack {
    let track = this.#tracks.get(e.id);
    if (!track) {
      track = { state: newAnimState(now), lastX: e.pos.x, lastZ: e.pos.z, lastMovedAt: 0 };
      this.#tracks.set(e.id, track);
    }
    return track;
  }

  #seMueve(track: CharTrack, pos: Vec3, now: number): boolean {
    const dx = pos.x - track.lastX;
    const dz = pos.z - track.lastZ;
    if (dx * dx + dz * dz > MOVE_EPS * MOVE_EPS) track.lastMovedAt = now;
    track.lastX = pos.x;
    track.lastZ = pos.z;
    return now - track.lastMovedAt < MOVE_GRACE_MS;
  }
}
