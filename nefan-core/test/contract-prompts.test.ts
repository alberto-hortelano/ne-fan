/** Canario del contrato narrativo compartido (data/contract/prompts/*.md).
 *
 *  Los prompts son DATOS que consumen narrative-mcp (los sirve tal cual al
 *  motor MCP) y ai_server (compone sus system prompts del fallback API). Este
 *  test falla si un archivo desaparece, queda vacío o pierde los
 *  identificadores que el código de nefan-core espera del LLM (claves del
 *  Format D, tipos de consequence, kinds del ground…). No valida prosa:
 *  valida que el prompt siga hablando el idioma del validador. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PROMPTS_DIR = fileURLToPath(new URL("../data/contract/prompts", import.meta.url));

/** Marcadores load-bearing por archivo: identificadores que también existen
 *  en el código (scene-expand, consequence-handler, ground, volumes). */
const CONTRACT_MARKERS: Record<string, string[]> = {
  "world_rules.md": ["style_tag", "HUMANOID", "story_update", "ui_doc_get", "stage_request", "stage_interior"],
  "ui_systems.md": ["overworld", "proscenium", "dialogue", "spawn_entity", "combat_system", "plugin_event", "render_mode", "ui_state"],
  "tile_instructions.md": ["ground", "volumes", "path", "water", "deck", "terrain"],
  "stage_instructions.md": ["stage", "exits", "to_place_id", "zone", "fourth_wall", "place_id", "edge", "style_tag", "stage_interior", "ambience", "volumes", "wall_h", "angle", "surroundings", "PLANO PRIMERO", "ground", "water", "deck"],
  "scene_instructions.md": ["scene_id", "terrain", "entities", "volumes", "meters_per_cell"],
  "weapon_orient.md": ["grip_point_normalized", "blade_direction", "up_direction"],
  "weapon_verify.md": ["suggested_delta_euler"],
  "scene_classify.md": ["solid", "tall"],
  // Las palabras de UNIDAD son contrato: image_review mide `h` en CELDAS
  // (persona ≈ 3.6) y stage_review en METROS — divergen POR DISEÑO (zod:
  // extrasArray(hUnit) en review-schemas.ts). Si una desaparece, alguien
  // unificó las unidades sin tocar los consumidores.
  "image_review.md": ["extras", "keep", "remove", "box_px", "tall", "solid", "celdas"],
  "stage_review.md": ["expected", "missing", "extras", "box_px", "wall_base_px", "metros"],
  "develop_world.md": ["world_brief", "world_md", "game_id", "style_id"],
  "narrative_event.md": ["consequences", "dialogue", "story_update", "spawn_entity", "plugin_event", "choices"],
  "blueprint_review.md": ["ground", "volumes"],
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

  it("generate_scene.json declara style_tag con zonas Y categorías de plató", () => {
    // WORLD_RULES exige style_tag en cada escena; sin la propiedad en el tool
    // schema, el fallback API directa no sabía que podía emitirlo.
    const tool = JSON.parse(
      readFileSync(resolve(TOOLS_DIR, "generate_scene.json"), "utf-8"),
    ) as { input_schema: { properties: Record<string, { enum?: string[] }> } };
    const tags = tool.input_schema.properties.style_tag?.enum ?? [];
    assert.ok(tags.includes("settlement"), "zona overworld presente");
    assert.ok(tags.includes("stage_interior"), "categoría de plató presente");
    assert.ok(!tags.includes("nature"), "'nature' es legacy — fuera del tool");
  });
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
