/** Canario del contrato narrativo compartido (data/contract/prompts/*.md).
 *
 *  Los prompts son DATOS que consumen narrative-mcp (los sirve tal cual al
 *  motor MCP) y ai_server (compone sus system prompts del fallback API). Este
 *  test falla si un archivo desaparece, queda vacío o pierde los
 *  identificadores que el código de nefan-core espera del LLM (claves del
 *  Format D, tipos de consequence, capas del map_ground…). No valida prosa:
 *  valida que el prompt siga hablando el idioma del validador. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PROMPTS_DIR = fileURLToPath(new URL("../data/contract/prompts", import.meta.url));

/** Marcadores load-bearing por archivo: identificadores que también existen
 *  en el código (scene-expand, consequence-handler, map-svg, volumes). */
const CONTRACT_MARKERS: Record<string, string[]> = {
  "world_rules.md": ["style_tag", "HUMANOID", "story_update"],
  "tile_instructions.md": ["map_ground", "volumes", "viewBox", "g id=", "terrain"],
  "scene_instructions.md": ["scene_id", "terrain", "entities", "structures", "meters_per_cell"],
  "room_instructions.md": ["room_id"],
  "weapon_orient.md": ["grip_point_normalized", "blade_direction", "up_direction"],
  "weapon_verify.md": ["suggested_delta_euler"],
  "scene_classify.md": ["solid", "tall"],
  "develop_world.md": ["world_brief", "world_md", "game_id"],
  "narrative_event.md": ["consequences", "dialogue", "story_update", "spawn_entity", "plugin_event", "choices"],
  "blueprint_review.md": ["map_ground", "volumes"],
};

const TOOLS_DIR = fileURLToPath(new URL("../data/contract/tools", import.meta.url));

/** Tool definitions (Anthropic tool-use) del fallback API de ai_server:
 *  archivo → `name` interno de la tool (histórico, no coincide siempre). */
const CONTRACT_TOOLS: Record<string, string> = {
  generate_scene: "generate_scene",
  weapon_orient: "orient_weapon",
  classify_scene: "classify_scene",
  narrative_react: "react_to_player",
};

describe("contrato narrativo — tool schemas compartidos", () => {
  for (const [file, toolName] of Object.entries(CONTRACT_TOOLS)) {
    it(`${file}.json parsea y declara name + input_schema`, () => {
      const raw = readFileSync(resolve(TOOLS_DIR, `${file}.json`), "utf-8");
      const tool = JSON.parse(raw) as { name?: string; input_schema?: { type?: string } };
      assert.equal(tool.name, toolName);
      assert.equal(tool.input_schema?.type, "object");
    });
  }
});

describe("contrato narrativo — prompts compartidos", () => {
  for (const [file, markers] of Object.entries(CONTRACT_MARKERS)) {
    it(`${file} existe y conserva sus identificadores de contrato`, () => {
      const text = readFileSync(resolve(PROMPTS_DIR, file), "utf-8");
      assert.ok(text.length > 100, `${file} sospechosamente corto (${text.length} bytes)`);
      for (const marker of markers) {
        assert.ok(
          text.includes(marker),
          `${file} ya no menciona "${marker}" — si es intencional, actualiza el validador y este test`,
        );
      }
    });
  }
});
