/** Headless battle simulator — runs AI vs AI fights without any frontend.
 *  Used for E2E tests and tournament mode.
 *
 *  Approach: Both fighters are registered as "enemies" with AI in the simulation.
 *  A dummy "player" is placed far away so it doesn't interfere. The game loop
 *  handles both AIs, movement, and combat resolution automatically. */

import { GameSimulation, type FrameInputs } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { GameStore } from "../src/store/game-store.js";
import { buildPersonality } from "../src/combat/difficulty-presets.js";
import type { CombatConfig, EnemyPersonality } from "../src/types.js";

export interface FighterConfig {
  id: string;
  hp: number;
  weapon: string;
  difficulty: string;
  aggressionStyle: string;
  position: { x: number; y: number; z: number };
}

export interface BattleResult {
  winner: string | null;
  winnerId: string;
  loserId: string;
  winnerHpRemaining: number;
  totalTicks: number;
  durationSeconds: number;
  stats: Record<string, FighterStats>;
}

export interface FighterStats {
  attacksStarted: number;
  attacksLanded: number;
  damageDealt: number;
  damageReceived: number;
  finalHp: number;
}

export interface BattleOptions {
  fighter1: FighterConfig;
  fighter2: FighterConfig;
  config: CombatConfig;
  seed: number;
  maxDuration?: number;
  tickDelta?: number;
}

/** Run a single AI vs AI battle to completion. */
export function runBattle(opts: BattleOptions): BattleResult {
  const { fighter1, fighter2, config, seed } = opts;
  const maxDuration = opts.maxDuration ?? 30;
  const tickDelta = opts.tickDelta ?? 0.016;

  const store = new GameStore();
  const sim = new GameSimulation(config, store, seed);

  // Dummy player far away — both real fighters are "enemies" with AI
  const dummy = createCombatant("player", 1, "unarmed", { x: 999, y: 999, z: 999 });
  sim.addCombatant(dummy);

  // Register both fighters as enemies with AI
  const f1 = createCombatant(
    fighter1.id, fighter1.hp, fighter1.weapon,
    { ...fighter1.position }, { x: 0, y: 0, z: -1 },
  );
  const f2 = createCombatant(
    fighter2.id, fighter2.hp, fighter2.weapon,
    { ...fighter2.position }, { x: 0, y: 0, z: 1 },
  );

  const p1 = buildPersonality(fighter1.difficulty, fighter1.aggressionStyle) as unknown as EnemyPersonality;
  const p2 = buildPersonality(fighter2.difficulty, fighter2.aggressionStyle) as unknown as EnemyPersonality;

  sim.addCombatant(f1, p1);
  sim.addCombatant(f2, p2);

  // Stats
  const stats: Record<string, FighterStats> = {
    [fighter1.id]: { attacksStarted: 0, attacksLanded: 0, damageDealt: 0, damageReceived: 0, finalHp: 0 },
    [fighter2.id]: { attacksStarted: 0, attacksLanded: 0, damageDealt: 0, damageReceived: 0, finalHp: 0 },
  };

  // Dummy inputs (player is far away, irrelevant)
  const dummyInputs: FrameInputs = {
    playerPosition: { x: 999, y: 999, z: 999 },
    playerForward: { x: 0, y: 0, z: -1 },
    playerMoving: false,
  };

  let totalTicks = 0;
  let elapsed = 0;

  while (elapsed < maxDuration) {
    totalTicks++;
    elapsed += tickDelta;

    const result = sim.tick(tickDelta, dummyInputs);

    for (const e of result.events) {
      const id = (e.combatantId ?? e.attackerId) as string;
      if (e.type === "attack_started" && stats[id]) {
        stats[id].attacksStarted++;
      } else if (e.type === "attack_landed") {
        const attackerId = e.attackerId as string;
        const targetId = e.targetId as string;
        const damage = e.damage as number;
        if (stats[attackerId]) {
          stats[attackerId].attacksLanded++;
          stats[attackerId].damageDealt += damage;
        }
        if (stats[targetId]) {
          stats[targetId].damageReceived += damage;
        }
      }
    }

    if (f1.health <= 0 || f2.health <= 0) break;
  }

  stats[fighter1.id].finalHp = Math.max(0, f1.health);
  stats[fighter2.id].finalHp = Math.max(0, f2.health);

  let winner: string | null = null;
  let winnerId = fighter1.id;
  let loserId = fighter2.id;

  if (f1.health <= 0 && f2.health > 0) {
    winner = fighter2.id; winnerId = fighter2.id; loserId = fighter1.id;
  } else if (f2.health <= 0 && f1.health > 0) {
    winner = fighter1.id;
  } else if (f1.health <= 0 && f2.health <= 0) {
    winner = null;
  } else {
    winner = f1.health >= f2.health ? fighter1.id : fighter2.id;
    winnerId = winner;
    loserId = winner === fighter1.id ? fighter2.id : fighter1.id;
  }

  return { winner, winnerId, loserId, winnerHpRemaining: stats[winnerId]?.finalHp ?? 0, totalTicks, durationSeconds: elapsed, stats };
}

export interface TournamentResult {
  matchups: Record<string, Record<string, { wins: number; losses: number }>>;
  labels: string[];
}

/** Round-robin tournament with multiple seeds. */
export function runTournament(
  fighters: FighterConfig[],
  config: CombatConfig,
  seedCount: number = 10,
  baseSeed: number = 1000,
): TournamentResult {
  const labels = fighters.map(f => f.id);
  const matchups: TournamentResult["matchups"] = {};

  for (const f of fighters) {
    matchups[f.id] = {};
    for (const g of fighters) matchups[f.id][g.id] = { wins: 0, losses: 0 };
  }

  for (let i = 0; i < fighters.length; i++) {
    for (let j = i + 1; j < fighters.length; j++) {
      for (let s = 0; s < seedCount; s++) {
        const seed = baseSeed + i * 1000 + j * 100 + s;
        const result = runBattle({
          fighter1: { ...fighters[i], position: { x: 0, y: 0, z: 3 } },
          fighter2: { ...fighters[j], position: { x: 0, y: 0, z: -3 } },
          config,
          seed,
        });

        if (result.winner === fighters[i].id) {
          matchups[fighters[i].id][fighters[j].id].wins++;
          matchups[fighters[j].id][fighters[i].id].losses++;
        } else if (result.winner === fighters[j].id) {
          matchups[fighters[j].id][fighters[i].id].wins++;
          matchups[fighters[i].id][fighters[j].id].losses++;
        }
      }
    }
  }

  return { matchups, labels };
}
