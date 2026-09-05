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

import { NPC_ROLES } from "../src/simulation/npc-roles.js";
import { ENTITY_FIELDS, SCENE_FIELDS, EMITTED_SCENE_FIELDS, RADIO_SIMULADO_POR_KIND } from "../src/contract/model-io/scene-schema.js";
import { celdasQueCubreRadio } from "../src/scene/terrain-collision.js";
import { TILE_MPC } from "../src/scene/tile.js";

const PROMPTS_DIR = fileURLToPath(new URL("../data/contract/prompts", import.meta.url));

/** Marcadores load-bearing por archivo: identificadores que también existen
 *  en el código (scene-expand, consequence-handler, ground, volumes). */
const CONTRACT_MARKERS: Record<string, string[]> = {
  // world_rules ya no nombra style_ref: la de ESCENA se retiró y las que
  // quedan (NPC, cara de volumen) se explican donde se declaran
  // (narrative_event.md y tile_instructions.md).
  "world_rules.md": [
    "world.style_token", "HUMANOID", "story_update", "ui_doc_get",
  ],
  // ui_systems ya no describe un eje de vistas (hay una sola): sus
  // identificadores son los sistemas que el motor SÍ puede leer del ui_state.
  "ui_systems.md": ["dialogue", "spawn_entity", "combat_system", "plugin_event", "render_mode", "ui_state"],
  // generate_tile.place / nearby_places: los rellena buildGenerateTileCtx al
  // anclar un place del world map a un tile (viaje desde «Salidas»). Si el
  // prompt deja de nombrarlos, el motor recibe el campo sin saber qué es.
  "tile_instructions.md": ["ground", "volumes", "path", "water", "deck", "terrain", "surface_ref", "fps_faces", "generate_tile.place", "nearby_places"],
  // `role` y `description` de NPC: el motor lee el PROMPT, no el tool JSON. Un
  // campo declarado solo en el JSON es un campo que el motor no emite nunca.
  //
  // `terrain` y `meters_per_cell` SALEN el 2026-08-29 (#322): eran los dos
  // campos que el prompt enseñaba y el gate RECHAZA —`EmittedSceneSchema`
  // rebota `size` y un `terrain[]` no vacío—, así que exigirlos aquí era
  // exigir que el prompt siguiera mintiéndole al modelo. Los dos siguen
  // candados donde sí son verdad: `tile_instructions.md`, que es quien
  // describe la única variante viva. Este marcador se puede cambiar (lo dice
  // el propio test), pero se cambia con el motivo escrito, no de paso.
  "scene_instructions.md": ["scene_id", "entities", "volumes", "ground", "role", "description"],
  "weapon_orient.md": ["grip_point_normalized", "blade_direction", "up_direction"],
  "weapon_verify.md": ["suggested_delta_euler"],
  "develop_world.md": ["world_brief", "world_md", "game_id", "style_id", "tags"],
  "narrative_event.md": ["consequences", "dialogue", "story_update", "spawn_entity", "plugin_event", "choices"],
};

const TOOLS_DIR = fileURLToPath(new URL("../data/contract/tools", import.meta.url));

/** Tool definitions (Anthropic tool-use) del fallback API de ai_server:
 *  archivo → `name` interno de la tool (histórico, no coincide siempre). */
const CONTRACT_TOOLS: Record<string, string> = {
  generate_scene: "generate_scene",
  weapon_orient: "orient_weapon",
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

  it("generate_scene.json no ofrece style_ref de escena y solo la variante tile", () => {
    // La `style_ref` de ESCENA elegía la lámina del repintado del tile y se
    // retiró con él: no puede volver a ofrecerse al modelo (si vuelve, el
    // motor la emite y nadie la consume — eje fail-silent). La de NPC sigue
    // viva dentro de `entities`. El bloque `stage` del plató, tampoco.
    const tool = JSON.parse(
      readFileSync(resolve(TOOLS_DIR, "generate_scene.json"), "utf-8"),
    ) as {
      input_schema: {
        properties: Record<string, { enum?: string[]; type?: string; properties?: Record<string, { type?: string }> }>;
      };
    };
    const props = tool.input_schema.properties;
    assert.equal(props.style_ref, undefined, "la style_ref de ESCENA se retiró del contrato");
    assert.equal(props.stage, undefined, "el bloque stage del plató se retiró del contrato");
    assert.equal(props.tile?.type, "object", "la única variante viva es el tile");
    // La de NPC sí sigue declarada (elige el aspecto del skin).
    assert.ok(
      JSON.stringify(props.entities).includes('"style_ref"'),
      "la style_ref de entidad (npc) sigue viva",
    );
  });

  // `generate_scene.json` NO está en CONTRACTS: es el único tool escrito a
  // mano, así que el codegen no lo mantiene en sync con el zod y su enum de
  // `role` puede separarse de NPC_ROLES sin que nada se queje. Este caso es su
  // guardia de deriva hasta que #203 generalice el problema — y es el mismo
  // fallo que esta tanda vino a arreglar, repetido un nivel más abajo.
  it("el vocabulario de `role` del tool ES NPC_ROLES, y los tres procesos leen el mismo", () => {
    const tool = JSON.parse(readFileSync(resolve(TOOLS_DIR, "generate_scene.json"), "utf-8")) as {
      input_schema: {
        properties: {
          entities: { items: { properties: Record<string, { enum?: string[]; type?: string }> } };
        };
      };
    };
    const deEscena = tool.input_schema.properties.entities.items.properties.role;

    assert.ok(deEscena, "generate_scene declara `role` en su entity");
    assert.equal(deEscena.type, "string");
    assert.deepEqual(
      deEscena.enum,
      [...NPC_ROLES],
      "el enum del tool a mano se ha separado de NPC_ROLES: cópialo (mismo orden) o arregla la fuente",
    );

    // Y el enum del tool VECINO, que sí sale del codegen. Que los dos coincidan
    // es la mitad de #173: un NPC no puede declarar su conducta con un
    // vocabulario en generate_scene y con otro en spawn_entity.
    const react = JSON.parse(readFileSync(resolve(TOOLS_DIR, "narrative_react.json"), "utf-8")) as unknown;
    const spawnRoles = JSON.stringify(react).match(/"enum":\s*\[\s*"peasant"[^\]]*\]/);
    assert.ok(spawnRoles, "narrative_react ya no declara el enum de role de spawn_entity");
    assert.deepEqual(
      JSON.parse(`{${spawnRoles[0]}}`).enum,
      [...NPC_ROLES],
      "spawn_entity y generate_scene tienen que pedir el mismo vocabulario",
    );
  });

  it("el TOPE del footprint móvil que dice el tool es el que aplica el gate (#300)", () => {
    // El motor lee estos dos textos: si el tope se mueve (alguien toca un radio
    // o el mpc) y ellos no, el gate rebota escenas por una regla que nadie le
    // dijo. Los números salen de la MISMA derivación que el zod, así que el
    // texto a mano no puede quedarse atrás en silencio.
    const npc = celdasQueCubreRadio(RADIO_SIMULADO_POR_KIND.npc, TILE_MPC);
    const player = celdasQueCubreRadio(RADIO_SIMULADO_POR_KIND.player, TILE_MPC);
    const tool = JSON.parse(readFileSync(resolve(TOOLS_DIR, "generate_scene.json"), "utf-8")) as {
      input_schema: { properties: { entities: { items: { properties: Record<string, { description?: string }> } } } };
    };
    const desc = tool.input_schema.properties.entities.items.properties.footprint.description ?? "";
    assert.match(desc, new RegExp(`npc declares at most ${npc} cells per side`), desc);
    assert.match(desc, new RegExp(`player at most ${player}\\b`), desc);

    const md = readFileSync(resolve(PROMPTS_DIR, "scene_instructions.md"), "utf-8");
    assert.match(md, new RegExp(`npc declares at most ${npc} cells per side`), "el prompt lo dice igual");
    assert.match(md, new RegExp(`player at most ${player} \\(0,5 m\\)`), "y en metros");
  });

  it("el prompt de escena EXIGE la descripción del NPC y dice que el rol no es el oficio", () => {
    // El motor lee el .md, no el JSON: un campo que solo esté en el tool no lo
    // emite nunca. Y `description` es opcional en el zod A PROPÓSITO (canda
    // también las fixtures, y las 14 sondas de z-order no tienen aspecto), así
    // que lo único que la exige es esta prosa.
    const md = readFileSync(resolve(PROMPTS_DIR, "scene_instructions.md"), "utf-8");
    assert.match(md, /REQUIRED for every named NPC|REQUIRED for every NPC you name/,
      "sin exigirla en la prosa, `description` opcional en el zod es `description` ausente");
    assert.match(md, /`role` is NOT the job/,
      "el motor tiene que saber dónde va el oficio, o inventará roles y se le rechazará el tile");
    for (const role of NPC_ROLES) {
      assert.ok(md.includes(role), `el prompt no nombra el rol "${role}"`);
    }
  });
});

/** #203 — el guardia de campos, en UNA dirección: JSON → zod.
 *
 *  `generate_scene.json` es el único tool escrito a mano y fuera del codegen,
 *  y de él cuelgan cuatro consumidores que nadie comparaba. Un campo que el
 *  tool le OFRECE al modelo y que el zod no conoce es un fail-silent con dos
 *  finales posibles: el modelo lo emite y el gate lo rebota (tile perdido), o
 *  el gate lo deja pasar por `.passthrough()` y nadie lo lee nunca.
 *
 *  La dirección inversa (zod → JSON) se queda FUERA, y ahora con razón
 *  escrita: (a) las 87 rutas que el zod tiene y el JSON no caen todas dentro
 *  de `ground`/`volumes`/`vegetation_zones`, que el JSON declara como PROSA a
 *  propósito —esa prosa es lo que le enseña la gramática al modelo y cerrarla
 *  cuesta las 10 descripciones y el enum de `role`—, y (b) desde #237 el zod
 *  tiene campos de la población EXPANDIDA (`size`, `terrain`) que no deben
 *  ofrecerse al modelo. Un guardia bidireccional nacería rojo por motivos que
 *  el §5 de los requisitos prohíbe cerrar.
 *
 *  Acotado a los DOS niveles donde ambos artefactos declaran estructura: la
 *  raíz y `entities[]`. */
describe("contrato narrativo — el tool a mano no ofrece campos que el zod no conoce (#203)", () => {
  const tool = JSON.parse(readFileSync(resolve(TOOLS_DIR, "generate_scene.json"), "utf-8")) as {
    input_schema: {
      properties: Record<string, unknown>;
      required?: string[];
    };
  };

  it("la RAÍZ de generate_scene.json no ofrece nada fuera del zod", () => {
    const delJson = Object.keys(tool.input_schema.properties);
    // Sanidad: si el JSON se queda sin properties el conjunto vacío pasaría
    // solo. Un guardia que no puede ponerse rojo no es un guardia.
    assert.ok(delJson.length >= 10, `generate_scene.json declara ${delJson.length} campos raíz — ¿fichero equivocado?`);
    const huerfanos = delJson.filter((k) => !SCENE_FIELDS.includes(k));
    assert.deepEqual(
      huerfanos,
      [],
      "campos ofrecidos al modelo que el zod no conoce: o se declaran en `sceneBaseShape` " +
        "(delegando en el validador de producción que ya exista) o se sacan del tool",
    );
  });

  it("la vuelta en la raíz: lo que el zod acepta y el tool NO ofrece es EXACTAMENTE nada", () => {
    // El saneador de ai_server deriva su allow-list de raíz del tool (#400):
    // si el zod gana un campo emitible que el tool no ofrece, los dos gates
    // divergen sin que nadie se entere. Hasta #408 había UNA brecha conocida
    // (las anclas de lugar, que solo escribía el motor del banco); se retiró,
    // y este test es lo que impide que la lista vuelva a crecer en silencio.
    const delJson = Object.keys(tool.input_schema.properties);
    const emitibles = SCENE_FIELDS.filter((k) => k !== "size" && k !== "terrain");
    assert.deepEqual(
      emitibles.filter((k) => !delJson.includes(k)),
      [],
      "campos de raíz que el zod acepta y el tool no ofrece: o van al tool, o se retiran (con su motivo en retired-terrain-fields.ts)",
    );
    // Y la lista que se le ENSEÑA al motor es la del tool, ni uno más ni uno
    // menos: un nombre sin esquema no se le enseña (QA de #400, hallazgo 4).
    assert.deepEqual([...EMITTED_SCENE_FIELDS].sort(), [...delJson].sort());
  });

  it("`entities[]` casa campo a campo con EntitySchema", () => {
    const items = tool.input_schema.properties.entities as { items?: { properties?: Record<string, unknown> } };
    const delJson = Object.keys(items.items?.properties ?? {});
    assert.ok(delJson.length >= 6, `generate_scene.json declara ${delJson.length} campos de entity — ¿fichero equivocado?`);
    assert.deepEqual(
      delJson.filter((k) => !ENTITY_FIELDS.includes(k)),
      [],
      "campos de entity ofrecidos al modelo que EntitySchema no conoce",
    );
    // Y aquí SÍ vale la vuelta, porque `entities[]` es el único nivel donde el
    // JSON declara `properties` completas: los dos conjuntos son el mismo.
    assert.deepEqual(
      [...ENTITY_FIELDS].filter((k) => !delJson.includes(k)),
      [],
      "campos que el zod acepta y el tool NO ofrece: el modelo lee el tool, así que nunca los emitirá",
    );
  });
});

// El guardia débil de términos prometidos (#203) vive en contract-terms.test.ts:
// es TRANS-PROCESO (escanea la raíz del repo) y no puede entrar en una batería
// de mutación — dentro del sandbox de Stryker reventaba este fichero entero (#347).

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
