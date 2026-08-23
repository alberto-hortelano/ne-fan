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
import { npcSkinStyleRef, styleRoleForNpc } from "../src/games/style-categories.js";
import { NPC_ROLES, type NpcRole } from "../src/simulation/npc-roles.js";
import { styleRefCatalog } from "../bridge/handlers/session.js";
import { FormatDSceneSchema } from "../src/contract/model-io/scene-schema.js";
import type { StyleManifest } from "../src/games/loader.js";

describe("style-refs — carpetas del pack", () => {
  // Las carpetas son el ROL del contenido, no vistas de mundo: el juego
  // tiene una sola vista y no se elige.
  it("la carpeta del archivo clasifica la ref", () => {
    assert.equal(folderForRefFile("surfaces/surfaces.jpg"), "surfaces");
    assert.equal(folderForRefFile("faces/fachada.jpg"), "faces");
    assert.equal(folderForRefFile("characters/commoner.jpg"), "characters");
  });

  it("rutas fuera de una carpeta del pack → null (el schema las rechaza)", () => {
    assert.equal(folderForRefFile("settlement.jpg"), null);
    assert.equal(folderForRefFile("otra_carpeta/x.jpg"), null);
    assert.equal(folderForRefFile("/surfaces/x.jpg"), null);
    // Las carpetas de las dos vistas retiradas caen aquí, en "cualquier otra":
    // el candado `campos-retirados-no-vuelven` las nombra (y su arnés escribe
    // los literales, que en este fichero serían una violación de la regla).
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
  // El vocabulario de `role` es CERRADO (NPC_ROLES) y la tabla lo cubre
  // entero: se recorre aquí para que añadir un rol sin decidir cómo se viste
  // rompa el test además de no compilar.
  it("cubre los cuatro roles del vocabulario, y solo el guardia va armado", () => {
    const esperado: Record<NpcRole, string> = {
      peasant: "commoner",
      villager: "commoner",
      merchant: "commoner",
      guard: "warrior",
    };
    for (const role of NPC_ROLES) {
      assert.equal(styleRoleForNpc(role), esperado[role], `rol ${role}`);
    }
    assert.deepEqual([...NPC_ROLES].sort(), Object.keys(esperado).sort(), "sin roles sin vestir");
  });

  it("un rol fuera del vocabulario (o ausente) cae a commoner, no a la rama que suene", () => {
    // `noble`, `soldier` y `warrior` eran etiquetas del switch viejo y NO son
    // roles: hoy la ref noble solo la alcanza un `style_ref` explícito del
    // motor (ver npcSkinStyleRef abajo).
    for (const inventado of ["noble", "soldier", "warrior", "smith", "Guard", ""]) {
      assert.equal(styleRoleForNpc(inventado), "commoner", `rol inventado "${inventado}"`);
    }
    assert.equal(styleRoleForNpc(undefined), "commoner");
  });

  it("la ref noble sigue siendo alcanzable, pero solo si el motor la ELIGE", () => {
    assert.equal(npcSkinStyleRef({ role: "villager", style_ref: "noble" }), "noble");
    assert.equal(npcSkinStyleRef({ role: "villager" }), "commoner");
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
        { id: "fps_surfaces", file: "surfaces/surfaces.jpg", description: "lámina" },
        { id: "commoner", file: "characters/commoner.jpg", description: "una persona" },
        ...extraRefs,
      ],
    }) as StyleManifest;

  it("el catálogo son los personajes: la ref de ESCENA se retiró", () => {
    const cat = styleRefCatalog(manifest()) as Record<string, unknown>;
    assert.deepEqual((cat.characters as Array<{ id: string }>).map((r) => r.id), ["commoner"]);
    assert.ok(!("scene" in cat), "no hay catálogo de escena que ofrecer al motor");
  });

  it("fps_faces: las refs de faces/ (nunca la lámina de surfaces/)", () => {
    // Sin refs de cara: fps_faces ausente (el pre-flight lo lee como "sin
    // catálogo"). Un pack ASÍ no carga hoy —la cardinalidad exige ≥1 cara—,
    // pero el catálogo se construye sobre el manifest en memoria y no debe
    // inventarse una entrada vacía.
    assert.equal(styleRefCatalog(manifest()).fps_faces, undefined);
    const conCaras = manifest([
      { id: "fachada", file: "faces/fachada.jpg", description: "fachada de casa" },
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
