/** check-scene — valida la jugabilidad de una escena Format D desde la CLI.
 *
 *  Reutiliza el expander y el validador de nefan-core (cero duplicación) y
 *  pinta el mapa expandido en ASCII con las entities superpuestas para
 *  verificación visual rápida. Exit code ≠ 0 si la escena es injugable —
 *  usable en CI y en el bucle de iteración de prompts.
 *
 *  Uso (desde la raíz del repo, tsx vive en nefan-core):
 *    cd nefan-core
 *    npx tsx ../narrative_lab/check-scene.ts --file escena.json
 *    npx tsx ../narrative_lab/check-scene.ts --run ../narrative_lab/runs/<ts>
 *    npx tsx ../narrative_lab/check-scene.ts --save ../saves/<session_id>
 *    ... [--state-api http://127.0.0.1:9878]   # añade la regla de link exterior
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expandScenePrimitives, hasUnexpandedPrimitives } from "../nefan-core/src/scene/scene-expand.js";
import { validateScene, type SceneValidationResult } from "../nefan-core/src/scene/scene-validate.js";
import { resolveTerrainLegend } from "../nefan-core/src/scene/scene-normalize.js";

function usage(): never {
  console.error("uso: check-scene (--file escena.json | --run <run_dir> | --save <save_dir>) [--state-api <url>]");
  process.exit(2);
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Última escena difundida en un run del game-emulator (events.ndjson). */
function sceneFromRun(runDir: string): Record<string, unknown> {
  const path = resolve(runDir, "events.ndjson");
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  let found: Record<string, unknown> | null = null;
  for (const line of lines) {
    const evt = JSON.parse(line) as { msg?: { type?: string; effects?: { type?: string; data?: { scene?: Record<string, unknown> } }[] } };
    const effects = evt.msg?.type === "narrative_event" ? evt.msg.effects ?? [] : [];
    for (const eff of effects) {
      if (eff?.data?.scene) found = eff.data.scene;
    }
  }
  if (!found) throw new Error(`ninguna escena en ${path} (¿el run llegó a recibir narrative_event con data.scene?)`);
  return found;
}

/** Escena activa de un save del bridge (state.json). */
function sceneFromSave(saveDir: string): Record<string, unknown> {
  const path = resolve(saveDir, "state.json");
  const state = JSON.parse(readFileSync(path, "utf8")) as {
    world?: { active_scene_id?: string };
    scenes_loaded?: Record<string, { scene_data?: Record<string, unknown> }>;
  };
  const active = state.world?.active_scene_id;
  const entry = active ? state.scenes_loaded?.[active] : undefined;
  const scene = entry?.scene_data ?? Object.values(state.scenes_loaded ?? {}).at(-1)?.scene_data;
  if (!scene) throw new Error(`ningún scene_data en ${path}`);
  return scene;
}

/** Mapa ASCII: terreno expandido + glyphs de entities. Celdas sólidas tal cual
 *  (W/w); el jugador y NPCs destacan por su glyph. */
function renderAscii(rawScene: Record<string, unknown>): string {
  const scene = hasUnexpandedPrimitives(rawScene) ? expandScenePrimitives(rawScene) : rawScene;
  const size = scene.size as { cols: number; rows: number };
  const terrain = scene.terrain as string[];
  const grid = terrain.map((row) => row.padEnd(size.cols, "g").slice(0, size.cols).split(""));
  const entities = (scene.entities as Record<string, unknown>[] | undefined) ?? [];
  for (const e of entities) {
    const cell = e.cell as [number, number] | undefined;
    if (!Array.isArray(cell)) continue;
    const fp = (e.footprint as [number, number] | undefined) ?? [1, 1];
    const glyph = typeof e.glyph === "string" && e.glyph.length === 1 ? e.glyph : "?";
    for (let r = cell[1]; r < cell[1] + (fp[1] ?? 1); r++) {
      for (let c = cell[0]; c < cell[0] + (fp[0] ?? 1); c++) {
        if (grid[r]?.[c] !== undefined) grid[r][c] = glyph;
      }
    }
  }
  return grid.map((row) => row.join("")).join("\n");
}

async function main(): Promise<void> {
  const file = arg("--file");
  const run = arg("--run");
  const save = arg("--save");
  const stateApi = arg("--state-api");
  const sources = [file, run, save].filter(Boolean);
  if (sources.length !== 1) usage();

  const scene = file
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
    : run
      ? sceneFromRun(run)
      : sceneFromSave(save!);

  let result: SceneValidationResult;
  let via = "local (sin regla de world map)";
  if (stateApi) {
    const res = await fetch(`${stateApi}/scene/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene }),
    });
    if (!res.ok) throw new Error(`state API ${stateApi}: HTTP ${res.status} ${await res.text()}`);
    result = (await res.json()) as SceneValidationResult;
    via = `state API ${stateApi} (con regla de world map)`;
  } else {
    result = validateScene(scene);
  }

  console.log(`escena: ${scene.scene_id ?? scene.room_id} (place_id: ${scene.place_id ?? "—"}) — validación ${via}`);
  console.log(`stats: ${JSON.stringify(result.stats)}`);
  const { legend, solidChars } = resolveTerrainLegend((hasUnexpandedPrimitives(scene) ? expandScenePrimitives(scene) : scene).terrain_legend);
  console.log(`solid_chars: ${solidChars.join(" ")} | legend: ${JSON.stringify(legend)}`);
  console.log("\n" + renderAscii(scene) + "\n");

  for (const w of result.warnings) console.log(`⚠ ${w}`);
  if (result.ok) {
    console.log("✅ escena jugable");
    return;
  }
  for (const e of result.errors) console.error(`✖ ${e}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`check-scene: ${(err as Error).message}`);
  process.exit(2);
});
