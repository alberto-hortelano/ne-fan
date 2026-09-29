/** Main game simulation — tick-based orchestrator.
 *  Called by the frontend every frame with delta + inputs. */

import type { CombatantState, CombatConfig, CombatEvent, EnemyPersonality, Vec3 } from "../types.js";
import { GameStore } from "../store/game-store.js";
import type { CombatSystem } from "../combat/combat-system.js";
import { StandardCombatSystem } from "../combat/standard-combat-system.js";
import { EnemyAI } from "../combat/enemy-ai.js";
import { SeededRng } from "../rng.js";
import * as Combatant from "../combat/combatant.js";
import { distanceXZ } from "../vec3.js";
import type { NpcBehaviorEvent, NpcBehaviorSystem } from "./npc-behavior.js";
import { puntoDeReaparicion } from "./reaparicion.js";

export interface FrameInputs {
  playerPosition: Vec3;
  playerForward: Vec3;
  playerMoving: boolean;
  attackRequested?: boolean;
  attackType?: string;
}

export interface FrameResult {
  events: CombatEvent[];
  /** Transiciones de la vida ambiental de NPCs (vacío sin behavior system). */
  npcEvents: NpcBehaviorEvent[];
}

export class GameSimulation {
  readonly store: GameStore;
  private combat: CombatSystem;
  private combatants = new Map<string, CombatantState>();
  private enemyAIs = new Map<string, EnemyAI>();
  private rng: SeededRng;
  private roomBounds: { halfW: number; halfD: number } | null = null;
  private npcBehavior: NpcBehaviorSystem | null = null;
  /** Dónde se dio de alta cada enemigo (los que traen personalidad). Es a
   *  donde vuelve cuando el jugador muere (#613): sin esto se quedaba junto al
   *  cadáver y el punto seguro caía dentro de su radio. */
  private casas = new Map<string, Vec3>();
  /** El último punto donde el jugador estaba vivo y FUERA DE COMBATE (ninguna
   *  IA de un vivo enganchada). Es donde reaparece. Lo siembra el alta del
   *  jugador y lo avanza `tick`; no se persiste: al reanudar, la posición
   *  guardada vuelve a sembrarlo. */
  private puntoSeguro: Vec3 | null = null;

  constructor(config: CombatConfig, store?: GameStore, seed?: number, combat?: CombatSystem) {
    this.store = store ?? new GameStore();
    this.combat = combat ?? new StandardCombatSystem(config);
    this.rng = new SeededRng(seed);
  }

  /** Sustituye el sistema de combate activo (selección por game.json en
   *  start/resume de sesión). Llamar tras reset() y ANTES de re-sembrar
   *  combatientes: las EnemyAI capturan el sistema al construirse. */
  setCombatSystem(combat: CombatSystem): void {
    if (this.enemyAIs.size > 0) {
      throw new Error("GameSimulation.setCombatSystem: call reset() first (enemy AIs capture the combat system)");
    }
    this.combat = combat;
    combat.reset();
  }

  /** Sistema de combate vigente (catálogo de ataques para clientes/tests). */
  get combatSystem(): CombatSystem {
    return this.combat;
  }

  /** Instala (o retira, con null) el sistema de vida ambiental de NPCs.
   *  Se selecciona en start/resume de sesión (systems.npc_behavior). */
  setNpcBehavior(system: NpcBehaviorSystem | null): void {
    this.npcBehavior = system;
  }

  /** Sistema de comportamiento vigente (para que el bridge sincronice NPCs). */
  get npcBehaviorSystem(): NpcBehaviorSystem | null {
    return this.npcBehavior;
  }

  /** Set room bounds so AI movement is clamped to the arena. */
  setRoomBounds(width: number, depth: number): void {
    this.roomBounds = { halfW: width / 2 - 0.3, halfD: depth / 2 - 0.3 };
  }

  addCombatant(state: CombatantState, personality?: EnemyPersonality): void {
    this.combatants.set(state.id, state);
    if (state.id === "player") this.puntoSeguro = puntoDeReaparicion(state.position);
    if (personality) {
      this.casas.set(state.id, { ...state.position });
      this.enemyAIs.set(
        state.id,
        new EnemyAI(state.id, personality, this.combat, this.rng),
      );
    }
  }

  removeCombatant(id: string): void {
    this.combatants.delete(id);
    this.enemyAIs.delete(id);
    this.casas.delete(id);
    if (id === "player") this.puntoSeguro = null;
  }

  getCombatant(id: string): CombatantState | undefined {
    return this.combatants.get(id);
  }

  /** TODOS los combatientes del sim, el jugador incluido.
   *
   *  Existe desde #326 porque el save necesita enumerarlos para persistir su
   *  vida (`bindCombatantRuntime`), y hasta hoy no se podía: quien quería la
   *  lista iteraba `store.state.enemies` —una PROYECCIÓN, no la fuente— y solo
   *  veía a quien alguien hubiera proyectado. Se devuelven las referencias
   *  vivas, como `getCombatant`: quien lee un estado del sim lo lee del sim. */
  getCombatants(): CombatantState[] {
    return [...this.combatants.values()];
  }

  tick(delta: number, inputs: FrameInputs): FrameResult {
    const allEvents: CombatEvent[] = [];
    const player = this.combatants.get("player");

    // 1. Update player state from frontend
    if (player) {
      player.position = inputs.playerPosition;
      player.forward = inputs.playerForward;
      Combatant.setMoving(player, inputs.playerMoving);

      // Handle attack request
      if (inputs.attackRequested && inputs.attackType) {
        const norm = this.combat.normalizeAttack(inputs.attackType);
        if (norm === null) {
          throw new Error(
            `GameSimulation: unknown attack type '${inputs.attackType}' for combat system '${this.combat.id}'`,
          );
        }
        const events = Combatant.startAttack(player, norm, this.combat.windUpTime(norm, player.weaponId));
        allEvents.push(...events);
      }
    }

    // 2. Enemy movement (before attack decisions so distance is current)
    for (const [id, ai] of this.enemyAIs) {
      const enemy = this.combatants.get(id);
      if (!enemy || enemy.health <= 0) continue;
      const target = this.findNearestTarget(enemy);
      if (!target) continue;
      ai.updateMovement(delta, enemy, target);
    }

    // 2b. Clamp enemy positions to room bounds
    if (this.roomBounds) {
      const { halfW, halfD } = this.roomBounds;
      for (const [id, ] of this.enemyAIs) {
        const enemy = this.combatants.get(id);
        if (!enemy) continue;
        enemy.position.x = Math.max(-halfW, Math.min(halfW, enemy.position.x));
        enemy.position.z = Math.max(-halfD, Math.min(halfD, enemy.position.z));
      }
    }

    // 3. Enemy AI attack decisions
    for (const [id, ai] of this.enemyAIs) {
      const enemy = this.combatants.get(id);
      if (!enemy || enemy.health <= 0) continue;
      const target = this.findNearestTarget(enemy);
      if (!target) continue;
      const events = ai.tick(delta, enemy, target);
      allEvents.push(...events);
    }

    // 3. Tick all combatants (wind-up timers)
    for (const [, c] of this.combatants) {
      const events = Combatant.tick(c, delta);
      for (const e of events) {
        if (e.type === "attack_impacted") {
          this.combat.addPendingImpact(
            e.combatantId as string,
            e.attackType as string,
          );
        }
      }
      allEvents.push(...events);
    }

    // 4. Resolve combat batch
    const combatEvents = this.combat.resolve(delta, this.combatants);
    allEvents.push(...combatEvents);

    // 5. Vida ambiental de NPCs: reflejos locales (huir/intervenir/pasear)
    // alimentados con los eventos de combate del tick.
    let npcEvents: NpcBehaviorEvent[] = [];
    if (this.npcBehavior) {
      const combatantPositions = new Map<string, Vec3>();
      for (const [id, c] of this.combatants) combatantPositions.set(id, c.position);
      npcEvents = this.npcBehavior.tick(delta, {
        playerPos: inputs.playerPosition,
        combatEvents: allEvents,
        combatantPositions,
      });
    }

    // 6. Dispatch significant events to store
    for (const e of combatEvents) {
      if (e.type === "attack_landed") {
        const targetId = e.targetId as string;
        const isPlayer = targetId === "player";
        if (isPlayer) {
          this.store.dispatch("player_damaged", {
            amount: e.damage,
            from: e.attackerId,
            new_hp: e.newHp,
          });
        } else {
          this.store.dispatch("enemy_damaged", {
            enemy_id: targetId,
            amount: e.damage,
            new_hp: e.newHp,
          });
        }
      } else if (e.type === "died") {
        const combatantId = e.combatantId as string;
        if (combatantId === "player") {
          this.store.dispatch("player_died", {});
        } else {
          this.store.dispatch("enemy_died", { enemy_id: combatantId });
        }
      }
    }

    // 7. ¿Sigue fuera de combate? Se mira AL FINAL, con los enganches de este
    // tick ya decididos (pasos 2 y 3): la posición con la que un enemigo te
    // engancha está DENTRO de su radio, y apuntarla como segura te devolvería
    // a su alcance al reaparecer. Así el punto es el del último tick en que
    // nadie te hizo caso — fuera de todos los radios, porque un enemigo sin
    // enganchar no se mueve de su sitio.
    if (player && player.health > 0 && !this.algunoEnganchado()) {
      this.puntoSeguro = puntoDeReaparicion(player.position);
    }

    return { events: allEvents, npcEvents };
  }

  /** Reaparecer tras morir (R). DÓNDE lo decide el sim, no el cliente (#613,
   *  decisión del usuario 2026-09-29): en el último punto seguro, fuera de
   *  combate. Y al morir TODOS te sueltan: cada enemigo vivo olvida el
   *  enganche y vuelve a su sitio de alta —teletransporte; el jugador está
   *  muerto y no lo ve—, así que no te espera junto al punto seguro.
   *
   *  Devuelve el punto porque el cliente lo aplica: la posición del jugador la
   *  conduce su input (`tick`), y sin el punto el siguiente input lo devolvería
   *  al cadáver. Sin jugador no hay nada que reaparecer, y se dice. */
  respawn(): { events: CombatEvent[]; punto: Vec3 } {
    const player = this.combatants.get("player");
    if (!player || !this.puntoSeguro) {
      throw new Error("GameSimulation.respawn: no hay jugador en el sim (o no tiene punto seguro)");
    }

    // Reset player
    player.health = player.maxHealth;
    player.state = "idle";
    player.currentAttackType = "";
    player.windUpTimer = 0;
    player.position = { ...this.puntoSeguro };

    // Reset all enemies
    for (const [, c] of this.combatants) {
      if (c.id === "player") continue;
      // La muerte es absorbente (decisión del usuario 2026-08-31): reaparecer TÚ
      // no levanta a quien ya mataste. El save lo cumplía (`mundo-persistido.ts`);
      // el sim no, y el muerto volvía de pie hasta el siguiente resume.
      if (c.health <= 0) continue;
      c.state = "idle";
      c.currentAttackType = "";
      c.windUpTimer = 0;
      // C1: morir cura a los VIVOS. Lo decidió el usuario el 2026-09-29: la
      // única curación del jugador es la del motor (`curarAlJugador`).
      c.health = c.maxHealth;
      const casa = this.casas.get(c.id);
      if (casa) c.position = { ...casa };
    }
    for (const [, ai] of this.enemyAIs) ai.soltar();

    // Clear pending combat
    this.combat.reset();

    // Notify store
    this.store.dispatch("player_respawned", {
      hp: player.maxHealth,
      pos: [player.position.x, player.position.y, player.position.z],
    });

    return {
      events: [{ type: "player_respawned", hp: player.maxHealth }],
      punto: { ...player.position },
    };
  }

  /** Cura al jugador `cantidad` PV, topado en su máximo. Es la ÚNICA curación
   *  del juego (#613: «se cura por consecuencias», la consequence
   *  `player_healed` del motor). A un muerto no le hace nada —solo R deshace
   *  la muerte—. Devuelve los PV que recuperó de verdad: 0 si estaba muerto o
   *  lleno. Una cantidad que no es un número positivo es un error de quien
   *  llama (el zod del motor ya la exige entera ≥ 1). */
  curarAlJugador(cantidad: number): number {
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new RangeError(`GameSimulation.curarAlJugador: cantidad inválida (${cantidad})`);
    }
    const player = this.combatants.get("player");
    if (!player) throw new Error("GameSimulation.curarAlJugador: no hay jugador en el sim");
    if (player.health <= 0) return 0;
    const antes = player.health;
    player.health = Math.min(player.maxHealth, antes + cantidad);
    const recuperado = player.health - antes;
    if (recuperado > 0) {
      this.store.dispatch("player_healed", { new_hp: player.health, amount: recuperado });
    }
    return recuperado;
  }

  /** ¿Hay algún enemigo VIVO enganchado? Es la definición de «en combate» del
   *  punto seguro. */
  private algunoEnganchado(): boolean {
    for (const [id, ai] of this.enemyAIs) {
      const c = this.combatants.get(id);
      if (c && c.health > 0 && ai.enganchado) return true;
    }
    return false;
  }

  /** Find nearest alive combatant that isn't self. */
  private findNearestTarget(self: CombatantState): CombatantState | undefined {
    let best: CombatantState | undefined;
    let bestDist = Infinity;
    for (const [, c] of this.combatants) {
      if (c.id === self.id || c.health <= 0) continue;
      const d = distanceXZ(self.position, c.position);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
  }

  reset(): void {
    this.combatants.clear();
    this.enemyAIs.clear();
    this.casas.clear();
    this.puntoSeguro = null;
    this.combat.reset();
    this.npcBehavior?.clear();
  }
}
