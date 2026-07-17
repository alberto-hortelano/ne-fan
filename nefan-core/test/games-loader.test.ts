/** Tests del modelo de datos juegos/estilos (src/games/loader.ts): carga
 *  fail-loud por juego, listado que degrada por entrada, y validación de ids
 *  seguros para filesystem/cache. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GameMetaSchema,
  StyleManifestSchema,
  listGames,
  listStyles,
  loadGameMeta,
  loadStyleManifest,
  loadWorldDoc,
} from "../src/games/loader.js";

const REAL_GAMES = fileURLToPath(new URL("../data/games", import.meta.url));
const REAL_STYLES = fileURLToPath(new URL("../data/styles", import.meta.url));

const BRIEF = "b".repeat(150);

function writeGame(dir: string, id: string, overrides: Record<string, unknown> = {}): void {
  const gameDir = join(dir, id);
  mkdirSync(gameDir, { recursive: true });
  writeFileSync(
    join(gameDir, "game.json"),
    JSON.stringify({
      game_id: id,
      title: `Juego ${id}`,
      description: "desc",
      style_id: "estilo_x",
      world_brief: BRIEF,
      ...overrides,
    }),
  );
  writeFileSync(join(gameDir, "world.md"), `# Mundo de ${id}\n`);
}

describe("games loader", () => {
  let tmp: string;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "nefan-games-"));
  });
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("carga un juego válido y su world.md", () => {
    writeGame(tmp, "bueno");
    const meta = loadGameMeta(tmp, "bueno");
    assert.equal(meta.title, "Juego bueno");
    assert.equal(meta.style_id, "estilo_x");
    assert.match(loadWorldDoc(tmp, "bueno"), /Mundo de bueno/);
  });

  it("fail-loud: game.json ausente, malformado o con id que no casa", () => {
    mkdirSync(join(tmp, "vacio"), { recursive: true });
    assert.throws(() => loadGameMeta(tmp, "vacio"), /game\.json not found/);

    mkdirSync(join(tmp, "roto"), { recursive: true });
    writeFileSync(join(tmp, "roto", "game.json"), "{nope");
    assert.throws(() => loadGameMeta(tmp, "roto"), /malformed/);

    writeGame(tmp, "cambiado", { game_id: "otro" });
    assert.throws(() => loadGameMeta(tmp, "cambiado"), /does not match/);

    assert.throws(() => loadGameMeta(tmp, "../fuera"), /unsafe gameId/);
  });

  it("fail-loud: world.md ausente", () => {
    writeGame(tmp, "sindoc");
    rmSync(join(tmp, "sindoc", "world.md"));
    assert.throws(() => loadGameMeta(tmp, "sindoc"), /world\.md not found/);
  });

  it("listGames degrada por juego: el roto se omite, los demás salen", () => {
    // tmp ya contiene "bueno" (válido) y varios rotos de los tests anteriores.
    const games = listGames(tmp);
    assert.ok(games.some((g) => g.game_id === "bueno"));
    assert.ok(!games.some((g) => g.game_id === "roto"));
    assert.ok(!games.some((g) => g.game_id === "vacio"));
  });

  it("listGames con directorio inexistente es error (config rota)", () => {
    assert.throws(() => listGames(join(tmp, "no-existe")), /not found/);
  });

  it("estilos: manifest válido carga; cover_url solo si el archivo existe", () => {
    const stylesDir = join(tmp, "styles");
    const d = join(stylesDir, "mi_estilo");
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, "style.json"),
      JSON.stringify({
        style_id: "mi_estilo",
        name: "Mi estilo",
        description: "desc",
        style_token: "token",
        cover: "cover.jpg",
        refs: [
          { category: "forest", file: "forest.jpg", tags: ["bosque"] },
          // Alias legacy: un pack anterior al set de zonas sigue cargando.
          { category: "nature", file: "nature.jpg", tags: [] },
        ],
      }),
    );
    const manifest = loadStyleManifest(stylesDir, "mi_estilo");
    assert.equal(manifest.refs[0].category, "forest");
    assert.equal(manifest.refs[1].category, "nature");

    let listed = listStyles(stylesDir);
    assert.equal(listed[0].cover_url, undefined);

    writeFileSync(join(d, "cover.jpg"), "fake-jpg");
    listed = listStyles(stylesDir);
    assert.equal(listed[0].cover_url, "/styles/mi_estilo/cover.jpg");
  });

  it("schema estricto: categoría de ref desconocida es rechazada", () => {
    assert.throws(() =>
      StyleManifestSchema.parse({
        style_id: "x",
        name: "x",
        description: "x",
        style_token: "x",
        cover: "cover.jpg",
        refs: [{ category: "paisaje_inventado", file: "a.jpg" }],
      }),
    );
    assert.throws(() =>
      GameMetaSchema.parse({
        game_id: "id con espacios",
        title: "t",
        description: "d",
        style_id: "s",
        world_brief: BRIEF,
      }),
    );
  });

  it("systems.combat parsea; claves extra en systems se rechazan (strict)", () => {
    const base = {
      game_id: "x",
      title: "t",
      description: "d",
      style_id: "s",
      world_brief: BRIEF,
    };
    assert.equal(GameMetaSchema.parse(base).systems, undefined);
    assert.equal(
      GameMetaSchema.parse({ ...base, systems: { combat: "basic" } }).systems?.combat,
      "basic",
    );
    assert.throws(() => GameMetaSchema.parse({ ...base, systems: { combate: "basic" } }));
    assert.throws(() => GameMetaSchema.parse({ ...base, systems: { combat: "id con espacios" } }));
  });

  it("los juegos y estilos shipped del repo validan", () => {
    const games = listGames(REAL_GAMES);
    const ids = games.map((g) => g.game_id);
    assert.deepEqual(ids, ["alta_fantasia", "cuentos_oscuros", "dev_combate_basico", "toledo_1200"]);
    for (const g of games) {
      assert.ok(g.world_brief.length >= 100, `${g.game_id} brief too short`);
      // Su estilo por defecto debe existir y validar.
      const st = loadStyleManifest(REAL_STYLES, g.style_id);
      assert.equal(st.style_id, g.style_id);
    }
    const styles = listStyles(REAL_STYLES);
    assert.deepEqual(
      styles.map((s) => s.style_id),
      ["acuarela_luminosa", "medievo_crudo", "sombra_de_cuento"],
    );
  });
});
