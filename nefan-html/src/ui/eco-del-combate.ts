/** LO QUE EL JUGADOR VE Y LEE DE LO QUE RESUELVE EL SIM.
 *
 *  El combate se resuelve en `nefan-core`, detrás del bridge: aquí no se
 *  decide ni un punto de daño. Lo que hay es la otra mitad —qué se pinta y qué
 *  se lee cuando llega cada evento— y estaba repartida por el `gameLoop` en
 *  sesenta líneas de `else if` más un `let attackVisual` de módulo a doscientas
 *  líneas de distancia de donde se dibuja.
 *
 *  Tres cosas, y las tres son del jugador y no del sistema:
 *
 *   · el ARO del ataque (telegraph), que es geometría de mundo y por eso se
 *     FIJA antes de `render()`: en WebGL no queda lienzo sobre el que
 *     garabatear una vez emitido el frame;
 *   · las LÍNEAS del registro de combate, y
 *   · si el jugador sigue de pie, que es lo que decide si se le ofrece
 *     reaparecer.
 */

import type { EffectiveParams, Vec3 } from "@nefan-core/src/types.js";
import { attackFlashQuality } from "@nefan-core/src/combat/attack-area.js";
import type { AttackTelegraph } from "../renderer/types.js";

/** Cuánto dura el destello del impacto, en segundos de simulación. */
const DESTELLO_S = 0.3;

/** Un evento del sim, tal y como llega en el `FrameResult`. */
interface EventoDeCombate {
  type: string;
  combatantId?: unknown;
  targetId?: unknown;
  damage?: unknown;
}

export interface DepsDelEco {
  log(msg: string): void;
  /** Respingo del cuerpo golpeado (la animación la lleva otro). */
  respingo(id: string): void;
  /** Los parámetros efectivos del ataque que el jugador tiene elegido AHORA:
   *  distancia óptima, tolerancia y radio del área. */
  paramsDelAtaque(): EffectiveParams;
  /** El id del ataque elegido — es también el nombre de su animación. */
  ataqueElegido(): string;
  jugador(): { pos: Vec3; forward: Vec3 };
  /** Dónde están los enemigos VIVOS ahora mismo: de ahí sale la calidad del
   *  golpe que tiñe el destello. */
  posicionesDeEnemigosVivos(): Vec3[];
}

export class EcoDelCombate {
  #visual: {
    mode: "windup" | "impact";
    params: EffectiveParams;
    impactQuality: number;
    fadeTimer: number;
  } | null = null;
  #vivo = true;

  constructor(private readonly deps: DepsDelEco) {}

  /** ¿Sigue el jugador de pie? Lo lee la barra de acciones para ofrecer «R ·
   *  reaparecer», que es la única salida cuando no lo está. */
  get jugadorVivo(): boolean {
    return this.#vivo;
  }

  /** Traduce los eventos de ESTE frame y devuelve la animación de una vez que
   *  le toca al jugador (su ataque, o el respingo de haber encajado uno), o
   *  `undefined` si ninguna. */
  procesar(eventos: readonly EventoDeCombate[], delta: number): string | undefined {
    let unaVez: string | undefined;
    for (const e of eventos) {
      if (e.type === "attack_started" && e.combatantId === "player") {
        // La anim del ataque arranca con el EVENTO del sim, no con el click:
        // estado → animación, como todo lo demás.
        unaVez = this.deps.ataqueElegido();
        this.#visual = {
          mode: "windup",
          params: this.deps.paramsDelAtaque(),
          impactQuality: 0,
          fadeTimer: 0,
        };
      } else if (e.type === "attack_impacted" && e.combatantId === "player") {
        // Calidad del destello = la del ÁREA de core, la misma que resuelve el
        // daño. Aquí vivía una tercera copia de la fórmula (distancia ×
        // precisión escritas a mano) que además se saltaba el cono frontal: un
        // enemigo a la espalda teñía el destello de verde mientras el resolver
        // no le hacía ni un punto de daño. El color no adorna, informa.
        const params = this.#visual?.params ?? this.deps.paramsDelAtaque();
        const yo = this.deps.jugador();
        this.#visual = {
          mode: "impact",
          params,
          impactQuality: attackFlashQuality(
            params,
            yo.pos,
            yo.forward,
            this.deps.posicionesDeEnemigosVivos(),
          ),
          fadeTimer: DESTELLO_S,
        };
      } else if (e.type === "attack_landed") {
        const targetId = e.targetId as string;
        const dmg = e.damage as number;
        if (targetId === "player") {
          // El ataque en curso tiene prioridad sobre el respingo: si estabas
          // pegando, se te ve pegar.
          if (unaVez === undefined) unaVez = "hit_react";
          this.deps.log(`Player hit: -${dmg.toFixed(1)} HP`);
        } else {
          this.deps.respingo(targetId);
          this.deps.log(`${targetId} hit: -${dmg.toFixed(1)} HP`);
        }
      } else if (e.type === "died") {
        const quien = e.combatantId as string;
        if (quien === "player") {
          this.#vivo = false;
          this.deps.log("YOU DIED — press R to respawn");
        } else {
          this.deps.log(`${quien} killed!`);
        }
      } else if (e.type === "player_respawned") {
        this.#vivo = true;
        this.deps.log("Respawned!");
      }
    }
    // El destello se apaga con el reloj del SIM (el `delta` del frame, topado a
    // 0,1 s), no con el de pared: si el juego se ralentiza, el destello dura lo
    // mismo en tiempo de juego.
    if (this.#visual?.mode === "impact") {
      this.#visual.fadeTimer -= delta;
      if (this.#visual.fadeTimer <= 0) this.#visual = null;
    }
    return unaVez;
  }

  /** El aro que hay que fijar en el renderer ANTES de pintar el frame, o
   *  `null` si no hay ataque en curso. */
  telegraph(): AttackTelegraph | null {
    if (!this.#visual) return null;
    const yo = this.deps.jugador();
    return {
      player: { pos: yo.pos, forward: yo.forward },
      params: this.#visual.params,
      mode: this.#visual.mode,
      opacity:
        this.#visual.mode === "impact" ? (this.#visual.fadeTimer / DESTELLO_S) * 0.5 : 0.3,
      impactQuality: this.#visual.impactQuality,
    };
  }
}
