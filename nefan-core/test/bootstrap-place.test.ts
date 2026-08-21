/** El tile de arranque tiene que quedar ATADO a un lugar del world map.
 *
 *  Si no lo queda, `enrichSceneWithExits` se cae al `active_place_id`, que en
 *  un mapa recién creado es la raíz ("world") — y la raíz no tiene links, así
 *  que el panel «Salidas» del cliente 2D sale VACÍO sin un solo error. Con el
 *  panel apagado no hay viaje a ningún lugar: la única vía viva de viaje del
 *  cliente 2D desaparece en silencio (issue #172, hallazgo 3 de QA).
 *
 *  Aquí se prueba el resolvedor PURO en los dos sentidos. El camino real por
 *  el bridge (start_session → narrative_status: error) está en
 *  bridge-session.test.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { WorldMapManager } from "../src/world-map/world-map.js";
import { resolveBootstrapPlaceId } from "../src/world-map/bootstrap-place.js";

describe("resolveBootstrapPlaceId", () => {
  /** Mapa como el que siembra el motor en el bootstrap: raíz + dos lugares
   *  unidos por un camino. */
  function seededMap(): WorldMapManager {
    const wm = new WorldMapManager(WorldMapManager.createEmpty("Miravanda"));
    wm.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "Robledo" });
    wm.upsertPlace({ id: "molino", kind: "landmark", parent_id: "world", name: "El Molino" });
    wm.addLink({ from: "robledo", to: "molino", kind: "road", edge: "east" });
    return wm;
  }

  it("acepta el place_id que el motor declara si el mapa lo corrobora", () => {
    const res = resolveBootstrapPlaceId(seededMap(), { place_id: "robledo" });
    assert.deepEqual(res, { kind: "place", placeId: "robledo" });
  });

  it("sin place_id, lo deduce del único place_anchors que existe en el mapa", () => {
    const res = resolveBootstrapPlaceId(seededMap(), {
      place_anchors: [{ place_id: "robledo", rect: [52, 48, 24, 16] }],
    });
    assert.deepEqual(res, { kind: "place", placeId: "robledo" });
  });

  it("los anchors de lugares que no existen no cuentan como deducción", () => {
    const res = resolveBootstrapPlaceId(seededMap(), {
      place_anchors: [{ place_id: "aldea_fantasma" }, { place_id: "robledo" }],
    });
    // Solo uno de los dos existe: ese es el lugar, sin ambigüedad.
    assert.deepEqual(res, { kind: "place", placeId: "robledo" });
  });

  // ── Los tres negativos: dónde tiene que gritar ──

  it("ERROR si no declara place_id habiendo lugares en el mapa (el panel saldría vacío)", () => {
    const res = resolveBootstrapPlaceId(seededMap(), {});
    assert.equal(res.kind, "error");
    assert.match(res.kind === "error" ? res.error : "", /no declara place_id/);
    // El motivo nombra los lugares reales y dice qué hacer: el motor tiene
    // que poder corregirlo y re-responder.
    assert.match(res.kind === "error" ? res.error : "", /robledo, molino/);
    assert.match(res.kind === "error" ? res.error : "", /re-responde/);
  });

  it("ERROR si el place_id declarado no existe en el mapa (mentira, no vacío)", () => {
    const res = resolveBootstrapPlaceId(seededMap(), { place_id: "villa_inventada" });
    assert.equal(res.kind, "error");
    assert.match(res.kind === "error" ? res.error : "", /villa_inventada.*no existe/s);
    assert.match(res.kind === "error" ? res.error : "", /map_upsert_place/);
  });

  it("ERROR si ancla varios lugares y no dice en cuál empieza el jugador", () => {
    const res = resolveBootstrapPlaceId(seededMap(), {
      place_anchors: [{ place_id: "robledo" }, { place_id: "molino" }],
    });
    assert.equal(res.kind, "error");
    assert.match(res.kind === "error" ? res.error : "", /no puede adivinar/);
  });

  // ── El estado que NO es un error ──

  it("un mapa sin lugares no es error: no hay a dónde viajar y el panel vacío no miente", () => {
    const wm = new WorldMapManager(WorldMapManager.createEmpty());
    assert.deepEqual(resolveBootstrapPlaceId(wm, {}), { kind: "sin-lugares" });
    // Ni siquiera con un place_id inventado: sin mapa no hay nada que atar.
    assert.deepEqual(resolveBootstrapPlaceId(wm, { place_id: "loquesea" }), { kind: "sin-lugares" });
  });

  it("la raíz del mapa no cuenta como lugar: atar el tile a ella es el fallo, no la cura", () => {
    const wm = new WorldMapManager(WorldMapManager.createEmpty());
    // "world" existe SIEMPRE y no tiene links: si valiera como place, el
    // panel saldría vacío exactamente igual, pero sin que nadie protestara.
    assert.deepEqual(resolveBootstrapPlaceId(wm, { place_id: "world" }), { kind: "sin-lugares" });
  });

  it("place_anchors malformado no rompe la resolución", () => {
    const wm = seededMap();
    assert.equal(resolveBootstrapPlaceId(wm, { place_anchors: "no soy un array" }).kind, "error");
    assert.equal(
      resolveBootstrapPlaceId(wm, { place_anchors: [null, { rect: [1, 2, 3, 4] }, 7] }).kind,
      "error",
    );
    // Duplicados del mismo lugar son UN lugar, no una ambigüedad.
    assert.deepEqual(
      resolveBootstrapPlaceId(wm, { place_anchors: [{ place_id: "robledo" }, { place_id: "robledo" }] }),
      { kind: "place", placeId: "robledo" },
    );
  });
});
