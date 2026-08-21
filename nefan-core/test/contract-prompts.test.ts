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
  // world_rules explica la elección de style_ref desde el catálogo
  // world.style_refs — candar los identificadores evita que el prompt y el
  // wire diverjan (el enum de categorías murió con las refs libres).
  "world_rules.md": [
    "style_ref", "world.style_refs", "HUMANOID", "story_update", "ui_doc_get",
  ],
  "ui_systems.md": ["overworld", "fps", "dialogue", "spawn_entity", "combat_system", "plugin_event", "render_mode", "ui_state"],
  // generate_tile.place / nearby_places: los rellena buildGenerateTileCtx al
  // anclar un place del world map a un tile (viaje desde «Salidas»). Si el
  // prompt deja de nombrarlos, el motor recibe el campo sin saber qué es.
  "tile_instructions.md": ["ground", "volumes", "path", "water", "deck", "terrain", "surface_ref", "fps_faces", "generate_tile.place", "nearby_places"],
  "scene_instructions.md": ["scene_id", "terrain", "entities", "volumes", "meters_per_cell"],
  "weapon_orient.md": ["grip_point_normalized", "blade_direction", "up_direction"],
  "weapon_verify.md": ["suggested_delta_euler"],
  "scene_classify.md": ["solid", "tall"],
  // La palabra de UNIDAD es contrato: image_review mide `h` en CELDAS del
  // tile (persona ≈ 3.6; zod: extrasArray("celdas") en review-schemas.ts). Si
  // desaparece, alguien cambió la unidad sin tocar los consumidores.
  "image_review.md": ["extras", "keep", "remove", "box_px", "tall", "solid", "celdas"],
  "develop_world.md": ["world_brief", "world_md", "game_id", "style_id", "tags"],
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

  it("generate_scene.json ofrece style_ref LIBRE (sin enum) y solo la variante tile", () => {
    // Las refs de estilo son libres (ids del pack, catálogo en
    // world.style_refs): un enum aquí recrearía las categorías fijas. Y el
    // bloque `stage` del plató no puede volver a ofrecerse al modelo.
    const tool = JSON.parse(
      readFileSync(resolve(TOOLS_DIR, "generate_scene.json"), "utf-8"),
    ) as {
      input_schema: {
        properties: Record<string, { enum?: string[]; type?: string; properties?: Record<string, { type?: string }> }>;
      };
    };
    const props = tool.input_schema.properties;
    assert.equal(props.style_tag, undefined, "style_tag murió — el campo es style_ref");
    assert.equal(props.style_ref?.type, "string");
    assert.equal(props.style_ref?.enum, undefined, "style_ref debe ser libre, sin enum");
    assert.equal(props.stage, undefined, "el bloque stage del plató se retiró del contrato");
    assert.equal(props.tile?.type, "object", "la única variante viva es el tile");
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
