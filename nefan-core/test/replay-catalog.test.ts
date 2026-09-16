import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
  it("los campos inválidos de un catálogo histórico quedan identificados", () => {
    const r = catalogoDeReplay({ type: "games_listed", games: [{ game_id: "antiguo" }], styles: [] }, "historica.ndjson");
    assert.deepEqual(r.games, []);
    assert.deepEqual(r.styles, []);
    assert.match(r.error!, /games\.0\.title/);
    assert.match(r.error!, /historica\.ndjson/);
  });
  it("las respuestas vacías se correlacionan sin inventar partidas guardadas", () => {
    assert.deepEqual(respuestaNoGrabada("sessions_listed", "x"), { type: "sessions_listed", sessions: [] });
    assert.deepEqual(respuestaNoGrabada("session_deleted", "x"), { type: "session_deleted", outcome: "deleted" });
    assert.equal(respuestaNoGrabada("desconocida", "x"), null);
  });
});
