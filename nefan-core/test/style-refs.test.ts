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
