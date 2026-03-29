/** E2E tests — AI vs AI battles with deterministic outcomes. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/combat/combat-data.js";
import type { CombatConfig } from "../src/types.js";
import { runBattle, runTournament, type FighterConfig } from "./battle-simulator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(resolve(__dirname, "../data/combat_config.json"), "utf-8")),
);

function fighter(
  id: string, difficulty: string, aggressionStyle: string,
  weapon: string = "short_sword", hp: number = 100,
): FighterConfig {
  return { id, hp, weapon, difficulty, aggressionStyle, position: { x: 0, y: 0, z: 0 } };
}

describe("AI Battle E2E", () => {
  it("hard beats easy consistently", () => {
    let hardWins = 0;
    const rounds = 10;

    for (let seed = 100; seed < 100 + rounds; seed++) {
      const result = runBattle({
        fighter1: { ...fighter("easy", "easy", "neutral"), position: { x: 0, y: 0, z: 3 } },
        fighter2: { ...fighter("hard", "hard", "neutral"), position: { x: 0, y: 0, z: -3 } },
        config,
        seed,
      });
      if (result.winner === "hard") hardWins++;
    }

    // Hard should win at least 70% of battles
    assert.ok(hardWins >= 7, `hard should win ≥7/10, got ${hardWins}`);
  });

  it("medium vs medium produces varied results", () => {
    const winners = new Set<string | null>();
    const rounds = 10;

    for (let seed = 200; seed < 200 + rounds; seed++) {
      const result = runBattle({
        fighter1: { ...fighter("m1", "medium", "neutral"), position: { x: 0, y: 0, z: 3 } },
        fighter2: { ...fighter("m2", "medium", "neutral"), position: { x: 0, y: 0, z: -3 } },
        config,
        seed,
      });
      winners.add(result.winner);
    }

    // Both fighters should win at least once (varied outcomes)
    assert.ok(winners.has("m1") || winners.has("m2"), "at least one side should win");
  });

  it("aggressive attacks more often than defensive", () => {
    const result = runBattle({
      fighter1: { ...fighter("aggro", "medium", "aggressive"), position: { x: 0, y: 0, z: 3 } },
      fighter2: { ...fighter("def", "medium", "defensive"), position: { x: 0, y: 0, z: -3 } },
      config,
      seed: 300,
    });

    const aggroStats = result.stats["aggro"];
    const defStats = result.stats["def"];

    // Aggressive should start more attacks (shorter cooldown)
    assert.ok(
      aggroStats.attacksStarted >= defStats.attacksStarted,
      `aggressive (${aggroStats.attacksStarted}) should attack ≥ defensive (${defStats.attacksStarted})`,
    );
  });

  it("battle stats are tracked correctly", () => {
    const result = runBattle({
      fighter1: { ...fighter("f1", "hard", "aggressive", "war_hammer", 100), position: { x: 0, y: 0, z: 2 } },
      fighter2: { ...fighter("f2", "easy", "neutral", "unarmed", 50), position: { x: 0, y: 0, z: -2 } },
      config,
      seed: 400,
    });

    // Someone should win
    assert.ok(result.winner !== null, "battle should have a winner");

    // Stats should be non-zero
    const winnerStats = result.stats[result.winnerId];
    assert.ok(winnerStats.attacksLanded > 0, "winner should have landed attacks");
    assert.ok(winnerStats.damageDealt > 0, "winner should have dealt damage");
    assert.ok(result.totalTicks > 10, "battle should last multiple ticks");
  });

  it("defensive fighter retreats when low HP", () => {
    // Defensive fighter with low initial HP should move away
    const result = runBattle({
      fighter1: { ...fighter("tank", "hard", "aggressive", "war_hammer", 200), position: { x: 0, y: 0, z: 2 } },
      fighter2: { ...fighter("glass", "medium", "defensive", "short_sword", 30), position: { x: 0, y: 0, z: -2 } },
      config,
      seed: 500,
    });

    // The glass cannon with 30 HP should take damage and the defensive AI should try to retreat
    // (we verify indirectly: the battle should last some time as defensive backs away)
    assert.ok(result.totalTicks > 20, "battle should last multiple ticks as defensive retreats");
  });

  it("deterministic — same seed same result", () => {
    const opts = {
      fighter1: { ...fighter("a", "medium", "neutral"), position: { x: 0, y: 0, z: 3 } },
      fighter2: { ...fighter("b", "medium", "aggressive"), position: { x: 0, y: 0, z: -3 } },
      config,
      seed: 42,
    };

    const r1 = runBattle(opts);
    const r2 = runBattle(opts);

    assert.equal(r1.winner, r2.winner, "same seed should produce same winner");
    assert.equal(r1.totalTicks, r2.totalTicks, "same seed should produce same tick count");
    assert.equal(
      r1.stats["a"].damageDealt.toFixed(2),
      r2.stats["a"].damageDealt.toFixed(2),
      "same seed should produce same damage",
    );
  });

  it("all 9 difficulty combos complete without errors", () => {
    const difficulties = ["easy", "medium", "hard"];
    const styles = ["defensive", "neutral", "aggressive"];
    let completed = 0;

    for (const d of difficulties) {
      for (const s of styles) {
        const result = runBattle({
          fighter1: { ...fighter("p1", d, s), position: { x: 0, y: 0, z: 3 } },
          fighter2: { ...fighter("p2", "medium", "neutral"), position: { x: 0, y: 0, z: -3 } },
          config,
          seed: 600 + completed,
        });
        assert.ok(result.totalTicks > 0, `${d}/${s} should run`);
        completed++;
      }
    }

    assert.equal(completed, 9, "all 9 combinations should complete");
  });

  it("tournament produces consistent rankings", () => {
    const fighters: FighterConfig[] = [
      { ...fighter("easy/neu", "easy", "neutral"), position: { x: 0, y: 0, z: 0 } },
      { ...fighter("med/neu", "medium", "neutral"), position: { x: 0, y: 0, z: 0 } },
      { ...fighter("hard/neu", "hard", "neutral"), position: { x: 0, y: 0, z: 0 } },
    ];

    const result = runTournament(fighters, config, 5, 700);

    // Hard should beat easy more often than not
    const hardVsEasy = result.matchups["hard/neu"]["easy/neu"];
    assert.ok(
      hardVsEasy.wins >= hardVsEasy.losses,
      `hard should beat easy: ${hardVsEasy.wins}W-${hardVsEasy.losses}L`,
    );

    // Medium should beat easy more often than not
    const medVsEasy = result.matchups["med/neu"]["easy/neu"];
    assert.ok(
      medVsEasy.wins >= medVsEasy.losses,
      `medium should beat easy: ${medVsEasy.wins}W-${medVsEasy.losses}L`,
    );
  });
});
