import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const { catalogoDeReplay, respuestaNoGrabada } = await import(new URL("../../labs/narrative/replay-catalog.mjs", import.meta.url).href);

describe("el catálogo del replay no deja esperando al título (#317)", () => {
  it("sin catálogo no inventa un mundo sin estilos: devuelve el motivo con el archivo", () => {
    const r = respuestaNoGrabada("games_listed", "mi-sesion/events.ndjson");
    assert.ok(r && "error" in r);
    assert.match(r.error!, /mi-sesion\/events.ndjson/);
    assert.match(r.error!, /games_listed/);
    assert.deepEqual(r.games, []);
    assert.deepEqual(r.styles, []);
  });
  it("nombra el campo ausente, en vez de enviar styles undefined al cliente", () => {
    const r = catalogoDeReplay({ type: "games_listed", games: [] }, "antigua.ndjson");
    assert.match(r.error!, /styles/);
    assert.match(r.error!, /antigua.ndjson/);
  });
  it("un catálogo válido cruza sin ser reemplazado por uno sintético", () => {
    const tema = { ...Object.fromEntries(["surface", "raised", "border", "ink", "ink_dim", "accent", "accent_ink", "danger", "fade", "font", "font_display"].map(k => [k, "valor"])),
      radius_px: 4, hairline_px: 1, tracking_em: 0, glow: false };
    const valido = { type: "games_listed", games: [{ game_id: "mundo", title: "Mundo", description: "Grabado",
      style_id: "estilo", world_brief: "Un pueblo", tags: [], generation: "ready", styles_applied: [] }],
      styles: [{ style_id: "estilo", name: "Estilo", description: "Papel", tags: [], ui_theme: tema }] };
    assert.deepEqual(catalogoDeReplay(valido, "actual.ndjson"), valido);
  });
  it("las ocho grabaciones ofrecen catálogo compatible o una explicación precisa", () => {
    const raiz = fileURLToPath(new URL("../../labs/narrative/runs/", import.meta.url));
    const dirs = readdirSync(raiz, { withFileTypes: true }).filter(d => d.isDirectory());
    assert.ok(dirs.length >= 8);
    for (const d of dirs) {
      const archivo = `${raiz}/${d.name}/events.ndjson`;
      const frames = readFileSync(archivo, "utf8").trim().split("\n").map(l => JSON.parse(l));
      const grabado = frames.find(f => f.dir === "in" && f.msg?.type === "games_listed")?.msg;
      const r = catalogoDeReplay(grabado, archivo);
      assert.ok(Array.isArray(r.games) && Array.isArray(r.styles));
      if (r.error) {
        assert.ok(r.error.includes(archivo));
        assert.match(r.error, /falta o no es válido .+/);
      }
    }
  });
  it("las respuestas vacías se correlacionan sin inventar partidas guardadas", () => {
    assert.deepEqual(respuestaNoGrabada("sessions_listed", "x"), { type: "sessions_listed", sessions: [] });
    assert.deepEqual(respuestaNoGrabada("session_deleted", "x"), { type: "session_deleted", outcome: "deleted" });
    assert.equal(respuestaNoGrabada("desconocida", "x"), null);
  });
});
