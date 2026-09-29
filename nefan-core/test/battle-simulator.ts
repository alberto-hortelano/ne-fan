/** Headless battle simulator — runs AI vs AI fights without any frontend.
 *  Used for E2E tests and tournament mode.
 *
 *  Approach: las dos IAs se conducen A MANO, con los mismos pasos que
 *  `GameSimulation.tick` (mover, decidir, wind-up, resolver) y el mismo
 *  sistema de combate. Hasta la tanda BN se daban de alta como «enemigos» en
 *  el sim con un jugador de pega lejos, y se pegaban entre ellas porque la IA
 *  elegía al combatiente vivo más cercano. Desde QA H4 el blanco de una IA
 *  del sim es SOLO el jugador (dos hostiles del motor no se pelean), así que
 *  un duelo IA-contra-IA ya no es algo que el sim haga: lo hace este arnés,
 *  que es donde se mide el balance de las dificultades. */

import { EnemyAI } from "../src/combat/enemy-ai.js";
import { StandardCombatSystem } from "../src/combat/standard-combat-system.js";
import * as Combatant from "../src/combat/combatant.js";
import { createCombatant } from "../src/combat/combatant.js";
import { SeededRng } from "../src/rng.js";
import { buildPersonality } from "../src/combat/difficulty-presets.js";
import type { CombatConfig, CombatEvent, CombatantState, EnemyPersonality } from "../src/types.js";

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

  const system = new StandardCombatSystem(config);
  const rng = new SeededRng(seed);

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
  // Mismo orden de alta y el MISMO rng para las dos, como en el sim.
  const ais: Array<[EnemyAI, CombatantState, CombatantState]> = [
    [new EnemyAI(f1.id, p1, system, rng), f1, f2],
    [new EnemyAI(f2.id, p2, system, rng), f2, f1],
  ];
  const combatants = new Map<string, CombatantState>([[f1.id, f1], [f2.id, f2]]);

  /** Un tick de duelo: los pasos 2, 3, 3b y 4 de `GameSimulation.tick`. */
  const tickDeDuelo = (delta: number): CombatEvent[] => {
    const eventos: CombatEvent[] = [];
    for (const [ai, yo, otro] of ais) {
      if (yo.health > 0) ai.updateMovement(delta, yo, otro);
    }
    for (const [ai, yo, otro] of ais) {
      if (yo.health > 0) eventos.push(...ai.tick(delta, yo, otro));
    }
    for (const c of combatants.values()) {
      const evs = Combatant.tick(c, delta);
      for (const e of evs) {
        if (e.type === "attack_impacted") system.addPendingImpact(e.combatantId as string, e.attackType as string);
      }
      eventos.push(...evs);
    }
    eventos.push(...system.resolve(delta, combatants));
    return eventos;
  };

  // Stats
  const stats: Record<string, FighterStats> = {
    [fighter1.id]: { attacksStarted: 0, attacksLanded: 0, damageDealt: 0, damageReceived: 0, finalHp: 0 },
    [fighter2.id]: { attacksStarted: 0, attacksLanded: 0, damageDealt: 0, damageReceived: 0, finalHp: 0 },
  };

  let totalTicks = 0;
  let elapsed = 0;

  while (elapsed < maxDuration) {
    totalTicks++;
    elapsed += tickDelta;

    for (const e of tickDeDuelo(tickDelta)) {
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

  let winner: string | null;
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
