/** Tests del formato de refs libres de style packs (src/games/style-refs.ts)
 *  y del rol transitorio de personaje (style-categories.ts, muere en la
 *  fase 3 del rediseño). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  folderForRefFile,
  normalizeTag,
  styleCompatibleWithGame,
  viewForRefFile,
} from "../src/games/style-refs.js";
import { styleRoleForNpc } from "../src/games/style-categories.js";
import { styleRefCatalog } from "../bridge/handlers/session.js";
import type { StyleManifest } from "../src/games/loader.js";

describe("style-refs — carpetas por vista", () => {
  it("la carpeta del archivo ES la vista; characters es pseudo-vista", () => {
    assert.equal(folderForRefFile("overworld/settlement.jpg"), "overworld");
    assert.equal(folderForRefFile("proscenium/calle.jpg"), "proscenium");
    assert.equal(folderForRefFile("fps/surfaces.jpg"), "fps");
    assert.equal(folderForRefFile("characters/commoner.jpg"), "characters");
    assert.equal(viewForRefFile("overworld/settlement.jpg"), "overworld");
    // characters no declara vista (se comparte en runtime).
    assert.equal(viewForRefFile("characters/commoner.jpg"), null);
  });

  it("rutas fuera de una carpeta de vista → null (el schema las rechaza)", () => {
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

describe("styleRefCatalog — catálogo del motor por vista", () => {
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

  it("vista fps: scene = refs de OVERWORLD (los tiles son la rama compartida)", () => {
    const cat = styleRefCatalog(manifest(), "fps");
    assert.deepEqual(cat.scene.map((r) => r.id), ["settlement"]);
    assert.deepEqual(cat.characters.map((r) => r.id), ["commoner"]);
  });

  it("fps_faces: refs temáticas fps/ (sin lámina) en overworld y fps; omitido si no hay", () => {
    // Sin refs temáticas: fps_faces ausente (el pre-flight lo lee como
    // "sin catálogo").
    assert.equal(styleRefCatalog(manifest(), "overworld").fps_faces, undefined);
    const conCaras = manifest([
      { id: "fachada", file: "fps/fachada.jpg", description: "fachada de casa" },
    ]);
    for (const view of ["overworld", "fps"] as const) {
      const cat = styleRefCatalog(conCaras, view);
      assert.deepEqual(cat.fps_faces?.map((r) => r.id), ["fachada"], view);
    }
    // Proscenium no lleva fps_faces (rama stage).
    assert.equal(styleRefCatalog(conCaras, "proscenium").fps_faces, undefined);
  });

  it("proscenium conserva su catálogo de plató", () => {
    const cat = styleRefCatalog(manifest(), "proscenium");
    assert.deepEqual(cat.scene.map((r) => r.id), ["calle"]);
  });
});
