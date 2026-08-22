/** Tests del modelo de datos juegos/estilos (src/games/loader.ts): carga
 *  fail-loud por juego, listado que degrada por entrada, y validación de ids
 *  seguros para filesystem/cache. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  styleFaceRefs,
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
        tags: ["bosque", "fantasia"],
        refs: [
          { id: "bosque", file: "faces/bosque.jpg", description: "un muro de zarzas" },
          { id: "catedral", file: "faces/catedral.jpg", description: "una fachada gótica" },
          { id: "lamina", file: "surfaces/surfaces.jpg", description: "muestras de material" },
          { id: "aldeano", file: "characters/aldeano.jpg", description: "un aldeano" },
        ],
      }),
    );
    const manifest = loadStyleManifest(stylesDir, "mi_estilo");
    assert.equal(manifest.refs[0].id, "bosque");
    assert.deepEqual(manifest.tags, ["bosque", "fantasia"]);

    let listed = listStyles(stylesDir);
    assert.equal(listed[0].cover_url, undefined);
    assert.deepEqual(listed[0].tags, ["bosque", "fantasia"]);

    writeFileSync(join(d, "cover.jpg"), "fake-jpg");
    listed = listStyles(stylesDir);
    assert.equal(listed[0].cover_url, "/styles/mi_estilo/cover.jpg");
  });

  it("refs por carpeta: la ruta clasifica la ref; carpeta desconocida se rechaza", () => {
    const base = {
      style_id: "x",
      name: "x",
      description: "x",
      style_token: "x",
      cover: "cover.jpg",
      tags: ["x"],
    };
    /** Las tres carpetas obligatorias con una ref cada una: el mínimo que
     *  carga. Cada caso de abajo rompe UNA cosa sobre esta base. */
    const minimo = [
      { id: "lamina", file: "surfaces/surfaces.jpg", description: "muestras" },
      { id: "fachada", file: "faces/fachada.jpg", description: "una fachada" },
      { id: "aldeano", file: "characters/aldeano.jpg", description: "un aldeano" },
    ];
    const m = StyleManifestSchema.parse({ ...base, refs: minimo });
    assert.deepEqual(m.refs.map((r) => r.id), ["lamina", "fachada", "aldeano"]);
    // Archivo fuera de una carpeta del pack → fail-loud.
    assert.throws(() =>
      StyleManifestSchema.parse({
        ...base,
        refs: [...minimo, { id: "a", file: "a.jpg", description: "suelta en la raíz" }],
      }),
    );
    assert.throws(() =>
      StyleManifestSchema.parse({
        ...base,
        refs: [...minimo, { id: "a", file: "otra_carpeta/a.jpg", description: "carpeta inventada" }],
      }),
    );
    // Ids duplicados → fail-loud.
    assert.throws(() =>
      StyleManifestSchema.parse({
        ...base,
        refs: [...minimo, { id: "fachada", file: "faces/otra.jpg", description: "otra" }],
      }),
    );
    // `role` fue el modo viejo de marcar la lámina; ahora lo dice la carpeta
    // y el schema es estricto: declararlo es un error, no un campo ignorado.
    assert.throws(() =>
      StyleManifestSchema.parse({
        ...base,
        refs: [
          { ...minimo[0], role: "fps_surfaces" },
          ...minimo.slice(1),
        ],
      }),
    );
  });

  it("cardinalidad por rol: sin lámina, sin caras o sin personajes el pack NO carga", () => {
    const base = {
      style_id: "x",
      name: "x",
      description: "x",
      style_token: "x",
      cover: "cover.jpg",
      tags: ["x"],
    };
    const lamina = { id: "lamina", file: "surfaces/surfaces.jpg", description: "muestras" };
    const cara = { id: "fachada", file: "faces/fachada.jpg", description: "una fachada" };
    const persona = { id: "aldeano", file: "characters/aldeano.jpg", description: "un aldeano" };

    // Sin lámina el atlas degradaba a solo style_token y las superficies
    // salían grises SIN avisar: por eso es fallo de carga y no un warning.
    const sinLamina = StyleManifestSchema.safeParse({ ...base, refs: [cara, persona] });
    assert.equal(sinLamina.success, false);
    assert.match(
      sinLamina.error!.issues.map((i) => i.message).join(" | "),
      /surfaces\/ y debe declarar EXACTAMENTE 1/,
    );

    // Dos láminas tampoco: la 2ª nunca se usaría y nadie sabría cuál manda.
    assert.equal(
      StyleManifestSchema.safeParse({
        ...base,
        refs: [lamina, { ...lamina, id: "otra", file: "surfaces/otra.jpg" }, cara, persona],
      }).success,
      false,
    );

    const sinCaras = StyleManifestSchema.safeParse({ ...base, refs: [lamina, persona] });
    assert.equal(sinCaras.success, false);
    assert.match(sinCaras.error!.issues[0].message, /faces\//);

    const sinPersonajes = StyleManifestSchema.safeParse({ ...base, refs: [lamina, cara] });
    assert.equal(sinPersonajes.success, false);
    assert.match(sinPersonajes.error!.issues[0].message, /characters\//);

    // Un pack en construcción (refs declaradas, imágenes aún sin generar)
    // sigue cargando: la cardinalidad mira lo DECLARADO, no el disco.
    assert.equal(
      StyleManifestSchema.safeParse({ ...base, refs: [lamina, cara, persona] }).success,
      true,
    );
  });

  it("styleFaceRefs: solo faces/ — ni personajes, ni lámina", () => {
    const base = {
      style_id: "x",
      name: "x",
      description: "x",
      style_token: "x",
      cover: "cover.jpg",
      tags: ["x"],
    };
    const pack = StyleManifestSchema.parse({
      ...base,
      refs: [
        { id: "fachada", file: "faces/fachada.jpg", description: "x" },
        // La lámina de materiales no es temática: fuera del catálogo.
        { id: "fps_surfaces", file: "surfaces/surfaces.jpg", description: "x" },
        { id: "noble", file: "characters/noble.jpg", description: "x" },
      ],
    });
    assert.deepEqual(styleFaceRefs(pack).map((r) => r.id), ["fachada"]);
    // Un pack SIN caras ya no existe: no carga (ver la cardinalidad por rol),
    // así que styleFaceRefs no tiene caso vacío que cubrir.
  });

  it("schema estricto: pack sin tags o con campos legacy es rechazado", () => {
    // Sin tags (obligatorios en el pack).
    assert.throws(() =>
      StyleManifestSchema.parse({
        style_id: "x",
        name: "x",
        description: "x",
        style_token: "x",
        cover: "cover.jpg",
        refs: [],
      }),
    );
    // Campo legacy `category` (formato viejo) — strict lo rechaza.
    assert.throws(() =>
      StyleManifestSchema.parse({
        style_id: "x",
        name: "x",
        description: "x",
        style_token: "x",
        cover: "cover.jpg",
        tags: ["x"],
        refs: [{ category: "settlement", file: "a.jpg" }],
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
    // El eje de vistas murió: `view` ya no es un campo del juego y el
    // schema estricto rechaza cualquier intento de declararlo.
    assert.throws(() => GameMetaSchema.parse({ ...base, view: "fps" }));
  });

  it("los juegos y estilos shipped del repo validan", () => {
    const games = listGames(REAL_GAMES);
    const ids = games.map((g) => g.game_id);
    assert.deepEqual(ids, ["alta_fantasia", "colonia_aster", "cuentos_oscuros", "toledo_1200"]);
    for (const g of games) {
      assert.ok(g.world_brief.length >= 100, `${g.game_id} brief too short`);
      // Su estilo por defecto debe existir y validar.
      const st = loadStyleManifest(REAL_STYLES, g.style_id);
      assert.equal(st.style_id, g.style_id);
    }
    const styles = listStyles(REAL_STYLES);
    assert.deepEqual(
      styles.map((s) => s.style_id),
      ["acero_neon", "acuarela_luminosa", "anime", "medievo_crudo", "sombra_de_cuento"],
    );
    // Cada pack shipped carga (la cardinalidad por rol ya exige lámina,
    // caras y personajes) y sus imágenes existen en disco: un manifest que
    // apunta a un archivo que no está pinta gris sin avisar.
    for (const s of styles) {
      const manifest = loadStyleManifest(REAL_STYLES, s.style_id);
      assert.ok(styleFaceRefs(manifest).length > 0, s.style_id);
      for (const ref of manifest.refs) {
        assert.ok(
          existsSync(join(REAL_STYLES, s.style_id, ref.file)),
          `${s.style_id}: ref "${ref.id}" apunta a ${ref.file}, que no existe`,
        );
      }
      assert.ok(
        existsSync(join(REAL_STYLES, s.style_id, manifest.cover)),
        `${s.style_id}: cover ${manifest.cover} ausente`,
      );
    }
  });

  /** CANDADO: la portada tiene que ser una IMAGEN PROPIA.
   *
   *  `style_pack_builder.generate_missing` copia la primera ref de `faces/`
   *  sobre `cover.jpg` cuando no existe (ai_server/style_pack_builder.py).
   *  Es un relleno para que el pack cargue, no una decisión de arte — y sin
   *  candado se quedó: los cinco packs llegaron a agosto con la portada
   *  byte a byte idéntica a su `faces/fachada.jpg`, o sea cuatro tarjetas
   *  con el mismo alzado y distinta paleta. El fichero existe en los cinco
   *  y el test de arriba pasaba tan contento.
   *
   *  Las portadas de los mundos jugables son capturas del juego en primera
   *  persona (`qa/capturar-portadas.mjs`). Este test no exige que lo sean —
   *  exige que no sean una copia de una ref. */
  it("estilos shipped: la portada no es una copia de una ref del pack", () => {
    const digest = (f: string): string =>
      createHash("sha256").update(readFileSync(f)).digest("hex");
    const copiados: string[] = [];
    for (const s of listStyles(REAL_STYLES)) {
      const manifest = loadStyleManifest(REAL_STYLES, s.style_id);
      const cover = digest(join(REAL_STYLES, s.style_id, manifest.cover));
      const copiaDe = manifest.refs.find((ref) => {
        const file = join(REAL_STYLES, s.style_id, ref.file);
        return existsSync(file) && digest(file) === cover; // ausencia: test anterior
      });
      if (copiaDe) copiados.push(`${s.style_id} (= ${copiaDe.file})`);
    }
    // `anime` no es el estilo por defecto de ningún mundo, así que no se le
    // capturó portada en la tanda de agosto de 2026 (el alcance fueron los
    // cuatro mundos jugables). Desde que la tarjeta del título se repinta al
    // cambiar de estilo, esta portada SÍ se ve: es deuda, no diseño.
    //
    // La lista es exacta a propósito: si alguien captura la de `anime`, el
    // test falla y obliga a borrar la excepción en vez de dejarla pudrirse.
    assert.deepEqual(
      copiados,
      ["anime (= faces/fachada.jpg)"],
      "portadas que siguen siendo el relleno de generate_missing. " +
        "Captúralas con qa/capturar-portadas.mjs; si acabas de arreglar una, " +
        "quítala de la lista esperada de este test.",
    );
  });
});
