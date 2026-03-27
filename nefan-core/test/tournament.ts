#!/usr/bin/env npx tsx
/** Round-robin AI tournament — run with: npx tsx test/tournament.ts */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/combat/combat-data.js";
import type { CombatConfig } from "../src/types.js";
import { runTournament, type FighterConfig } from "./battle-simulator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(resolve(__dirname, "../data/combat_config.json"), "utf-8")),
);

// Build all 9 combatant presets
const difficulties = ["easy", "medium", "hard"] as const;
const styles = ["defensive", "neutral", "aggressive"] as const;

const fighters: FighterConfig[] = [];
for (const d of difficulties) {
  for (const s of styles) {
    fighters.push({
      id: `${d}/${s.slice(0, 3)}`,
      hp: 100,
      weapon: "short_sword",
      difficulty: d,
      aggressionStyle: s,
      position: { x: 0, y: 0, z: 0 },
    });
  }
}

const SEEDS = 10;
console.log(`\n=== AI Tournament (${fighters.length} combatants, ${SEEDS} seeds each) ===\n`);

const result = runTournament(fighters, config, SEEDS, 1000);

// Build table
const labels = fighters.map(f => f.id);
const colWidth = 10;

// Header
const header = "".padEnd(12) + labels.map(l => l.padStart(colWidth)).join("");
console.log(header);
console.log("-".repeat(header.length));

// Rows
const totalWins: Record<string, number> = {};
for (const f of labels) totalWins[f] = 0;

for (const row of labels) {
  let line = row.padEnd(12);
  for (const col of labels) {
    if (row === col) {
      line += "-".padStart(colWidth);
    } else {
      const m = result.matchups[row][col];
      const cell = `${m.wins}-${m.losses}`;
      line += cell.padStart(colWidth);
      totalWins[row] += m.wins;
    }
  }
  console.log(line);
}

console.log("-".repeat(header.length));

// Win totals
console.log("\nTotal wins:");
const sorted = Object.entries(totalWins).sort((a, b) => b[1] - a[1]);
for (const [name, wins] of sorted) {
  const bar = "█".repeat(Math.ceil(wins / 2));
  console.log(`  ${name.padEnd(12)} ${String(wins).padStart(3)} ${bar}`);
}

// Verify expected hierarchy
console.log("\n=== Balance Check ===");
const diffWins: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
for (const [name, wins] of Object.entries(totalWins)) {
  const diff = name.split("/")[0];
  diffWins[diff] += wins;
}
console.log(`Easy total: ${diffWins.easy}, Medium total: ${diffWins.medium}, Hard total: ${diffWins.hard}`);
console.log(`Hard > Medium > Easy? ${diffWins.hard > diffWins.medium && diffWins.medium > diffWins.easy ? "✓" : "✗"}`);

const styleWins: Record<string, number> = { defensive: 0, neutral: 0, aggressive: 0 };
for (const [name, wins] of Object.entries(totalWins)) {
  const parts = name.split("/");
  const style = parts[1] === "def" ? "defensive" : parts[1] === "neu" ? "neutral" : "aggressive";
  styleWins[style] += wins;
}
console.log(`Defensive: ${styleWins.defensive}, Neutral: ${styleWins.neutral}, Aggressive: ${styleWins.aggressive}`);
