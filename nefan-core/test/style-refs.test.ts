/** Tests del formato de refs libres de style packs (src/games/style-refs.ts)
 *  y del rol transitorio de personaje (style-categories.ts, muere en la
 *  fase 3 del rediseño). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  folderForRefFile,
  normalizeTag,
  styleCompatibleWithGame,
} from "../src/games/style-refs.js";
import { styleRoleForNpc } from "../src/games/style-categories.js";
import { styleRefCatalog } from "../bridge/handlers/session.js";
import { FormatDSceneSchema } from "../src/contract/model-io/scene-schema.js";
import type { StyleManifest } from "../src/games/loader.js";

describe("style-refs — carpetas del pack", () => {
  // Las carpetas son el ROL del contenido, no vistas de mundo: el juego
  // tiene una sola vista y no se elige.
  it("la carpeta del archivo clasifica la ref", () => {
    assert.equal(folderForRefFile("overworld/settlement.jpg"), "overworld");
    assert.equal(folderForRefFile("proscenium/calle.jpg"), "proscenium");
    assert.equal(folderForRefFile("fps/surfaces.jpg"), "fps");
    assert.equal(folderForRefFile("characters/commoner.jpg"), "characters");
  });

  it("rutas fuera de una carpeta del pack → null (el schema las rechaza)", () => {
    assert.equal(folderForRefFile("settlement.jpg"), null);
    assert.equal(folderForRefFile("otra_carpeta/x.jpg"), null);
    assert.equal(folderForRefFile("/overworld/x.jpg"), null);
  });
});

describe("style-refs — compatibilidad temática estilo↔juego", () => {
  it("normalizeTag: sin diacríticos, minúsculas, sin espacios", () => {
    assert.equal(normalizeTag(" Histórico "), "historico");
    assert.equal(normalizeTag("FANTASÍA"), "fantasia");
  });

  it("compatible ⇔ intersección normalizada no vacía", () => {
    assert.ok(styleCompatibleWithGame(["medieval", "rural"], ["Medieval", "oscuro"]));
    assert.ok(!styleCompatibleWithGame(["medieval"], ["futurista", "espacial"]));
    assert.ok(styleCompatibleWithGame(["histórico"], ["historico"]));
  });

  it("juego sin tags es compatible con todo (mundos user_* previos)", () => {
    assert.ok(styleCompatibleWithGame(["medieval"], []));
    assert.ok(styleCompatibleWithGame(["medieval"], undefined));
    // Estilo sin tags (pack a medio editar): permisivo, no brickear.
    assert.ok(styleCompatibleWithGame([], ["medieval"]));
  });
});

describe("styleRoleForNpc (transitorio, fase 3 lo elimina)", () => {
  it("guard/soldier/warrior → warrior; noble → noble; default commoner", () => {
    assert.equal(styleRoleForNpc("guard"), "warrior");
    assert.equal(styleRoleForNpc("noble"), "noble");
    assert.equal(styleRoleForNpc("peasant"), "commoner");
    assert.equal(styleRoleForNpc(undefined), "commoner");
  });
});

describe("styleRefCatalog — catálogo del motor", () => {
  const manifest = (extraRefs: object[] = []): StyleManifest =>
    ({
      style_id: "x",
      name: "x",
      description: "x",
      style_token: "x",
      cover: "cover.jpg",
      tags: ["x"],
      refs: [
        { id: "settlement", file: "overworld/settlement.jpg", description: "una aldea" },
        { id: "calle", file: "proscenium/calle.jpg", description: "una calle" },
        { id: "fps_surfaces", file: "fps/surfaces.jpg", description: "lámina", role: "fps_surfaces" },
        { id: "commoner", file: "characters/commoner.jpg", description: "una persona" },
        ...extraRefs,
      ],
    }) as StyleManifest;

  it("el catálogo son los personajes: la ref de ESCENA se retiró", () => {
    const cat = styleRefCatalog(manifest()) as Record<string, unknown>;
    assert.deepEqual((cat.characters as Array<{ id: string }>).map((r) => r.id), ["commoner"]);
    assert.ok(!("scene" in cat), "no hay catálogo de escena que ofrecer al motor");
  });

  it("fps_faces: refs temáticas fps/ (sin lámina); omitido si no hay", () => {
    // Sin refs temáticas: fps_faces ausente (el pre-flight lo lee como
    // "sin catálogo").
    assert.equal(styleRefCatalog(manifest()).fps_faces, undefined);
    const conCaras = manifest([
      { id: "fachada", file: "fps/fachada.jpg", description: "fachada de casa" },
    ]);
    assert.deepEqual(styleRefCatalog(conCaras).fps_faces?.map((r) => r.id), ["fachada"]);
  });
});

/** R5 de la retirada: el motor lleva `style_ref: "settlement"` y parecidos en
 *  su historial y va a seguir emitiéndolos contra un catálogo que ya no
 *  existe. Con `.passthrough()` en el gate eso habría sido FAIL-SILENT (el
 *  campo entra, scene-normalize lo tira, nadie se entera). El pre-flight de
 *  narrative-mcp delega en este zod, así que el rebote llega al motor con el
 *  motivo y puede re-responder. */
describe("style_ref de escena — retirada fail-loud, no ignorada", () => {
  const tile = (extra: Record<string, unknown> = {}) => ({
    scene_id: "tile_0_0",
    scene_description: "Un claro",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    entities: [],
    ...extra,
  });

  it("una escena con style_ref se RECHAZA nombrando el campo", () => {
    const r = FormatDSceneSchema.safeParse(tile({ style_ref: "settlement" }));
    assert.equal(r.success, false, "un campo retirado no puede colarse por passthrough");
    const issue = r.error!.issues.find((i) => i.path.join(".") === "style_ref");
    assert.ok(issue, "el error apunta al campo, para que el motor sepa qué quitar");
    assert.match(issue!.message, /retirado/);
  });

  it("sin ella la misma escena pasa, y la style_ref de NPC sigue viva", () => {
    assert.equal(FormatDSceneSchema.safeParse(tile()).success, true);
    const conNpc = tile({
      entities: [
        {
          id: "aldeana",
          kind: "npc",
          name: "Aldeana",
          cell: [4, 4],
          footprint: [1, 1],
          glyph: "n",
          style_ref: "commoner",
        },
      ],
    });
    assert.equal(FormatDSceneSchema.safeParse(conNpc).success, true);
  });
});
