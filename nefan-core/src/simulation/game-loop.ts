/** Main game simulation — tick-based orchestrator.
 *  Called by the frontend every frame with delta + inputs. */

import type { CombatantState, CombatConfig, CombatEvent, EnemyPersonality, Vec3 } from "../types.js";
import { GameStore } from "../store/game-store.js";
import { CombatManager } from "../combat/combat-manager.js";
import { EnemyAI, SeededRng } from "../combat/enemy-ai.js";
import * as Combatant from "../combat/combatant.js";
import { getEffectiveParams } from "../combat/combat-data.js";
import { distanceXZ } from "../vec3.js";

export interface FrameInputs {
  playerPosition: Vec3;
  playerForward: Vec3;
  playerMoving: boolean;
  attackRequested?: boolean;
  attackType?: string;
}

export interface FrameResult {
  events: CombatEvent[];
}

export class GameSimulation {
  readonly store: GameStore;
  private combatManager: CombatManager;
  private combatants = new Map<string, CombatantState>();
  private enemyAIs = new Map<string, EnemyAI>();
  private config: CombatConfig;
  private rng: SeededRng;
  private roomBounds: { halfW: number; halfD: number } | null = null;

  constructor(config: CombatConfig, store?: GameStore, seed?: number) {
    this.config = config;
    this.store = store ?? new GameStore();
    this.combatManager = new CombatManager(config);
    this.rng = new SeededRng(seed);
  }

  /** Set room bounds so AI movement is clamped to the arena. */
  setRoomBounds(width: number, depth: number): void {
    this.roomBounds = { halfW: width / 2 - 0.3, halfD: depth / 2 - 0.3 };
  }

  addCombatant(state: CombatantState, personality?: EnemyPersonality): void {
    this.combatants.set(state.id, state);
    if (personality) {
      this.enemyAIs.set(
        state.id,
        new EnemyAI(state.id, personality, this.config, this.rng),
      );
    }
  }

  removeCombatant(id: string): void {
    this.combatants.delete(id);
    this.enemyAIs.delete(id);
  }

  getCombatant(id: string): CombatantState | undefined {
    return this.combatants.get(id);
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
        const weaponData = this.config.weapons[player.weaponId]
          ?? this.config.weapons["unarmed"];
        const params = getEffectiveParams(
          inputs.attackType,
          this.config.attack_types,
          weaponData,
        );
        const events = Combatant.startAttack(player, inputs.attackType, params.wind_up_time);
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
          this.combatManager.addPendingImpact(
            e.combatantId as string,
            e.attackType as string,
          );
        }
      }
      allEvents.push(...events);
    }

    // 4. Resolve combat batch
    const combatEvents = this.combatManager.tick(delta, this.combatants);
    allEvents.push(...combatEvents);

    // 5. Dispatch significant events to store
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

    return { events: allEvents };
  }

  respawn(spawnPos?: Vec3): CombatEvent[] {
    const player = this.combatants.get("player");
    if (!player) return [];

    // Reset player
    player.health = player.maxHealth;
    player.state = "idle";
    player.currentAttackType = "";
    player.windUpTimer = 0;
    player.position = spawnPos ?? { x: 0, y: 0, z: 4 };

    // Reset all enemies
    for (const [, c] of this.combatants) {
      if (c.id !== "player") {
        c.state = "idle";
        c.currentAttackType = "";
        c.windUpTimer = 0;
        c.health = c.maxHealth;
      }
    }

    // Clear pending combat
    this.combatManager.reset();

    // Notify store
    this.store.dispatch("player_respawned", {
      hp: player.maxHealth,
      pos: [player.position.x, player.position.y, player.position.z],
    });

    return [{ type: "player_respawned", hp: player.maxHealth }];
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
    this.combatManager.reset();
  }
}
