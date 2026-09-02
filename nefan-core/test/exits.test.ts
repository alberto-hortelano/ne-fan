/** Las salidas de un lugar se CALCULAN desde el mapa (#179): de qué place son
 *  las de una escena y qué lleva cada una. Es la mitad pura de lo que el
 *  bridge escribía dentro del `scene_data` persistido al difundir. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { placeDeLaEscena, salidasDePlace } from "../src/world-map/exits.js";
import { WorldMapManager } from "../src/world-map/world-map.js";

function mapa(): WorldMapManager {
  const wm = new WorldMapManager(WorldMapManager.createEmpty("Mundo de prueba"));
  wm.upsertPlace({ id: "aldea", kind: "settlement", parent_id: "world", name: "Aldea" });
  wm.upsertPlace({ id: "bosque", kind: "landmark", parent_id: "world", name: "Bosque" });
  wm.upsertPlace({ id: "ermita", kind: "site", parent_id: "world", name: "Ermita" });
  wm.addLink({ from: "aldea", to: "bosque", kind: "path", edge: "south", travel_hours: 1, description: "Senda" });
  return wm;
}

describe("salidasDePlace — las salidas salen del mapa, con nombre y borde", () => {
  it("un link saliente es una salida con el destino resuelto a su nombre", () => {
    assert.deepEqual(salidasDePlace(mapa(), "aldea"), [
      { place_id: "bosque", name: "Bosque", link_kind: "path", travel_hours: 1, description: "Senda", edge: "south" },
    ]);
  });

  it("recorrido al revés, el borde se invierte y el destino es el origen del link", () => {
    const [salida] = salidasDePlace(mapa(), "bosque");
    assert.equal(salida.place_id, "aldea");
    assert.equal(salida.name, "Aldea");
    assert.equal(salida.edge, "north");
  });

  it("un link creado DESPUÉS aparece en la siguiente llamada: no hay nada sellado", () => {
    const wm = mapa();
    assert.deepEqual(salidasDePlace(wm, "aldea").map((e) => e.place_id), ["bosque"]);
    wm.addLink({ from: "aldea", to: "ermita", kind: "road" });
    assert.deepEqual(salidasDePlace(wm, "aldea").map((e) => e.place_id), ["bosque", "ermita"]);
  });

  it("renombrar el destino cambia el nombre de la salida (map_upsert_place)", () => {
    const wm = mapa();
    wm.upsertPlace({ id: "bosque", kind: "landmark", parent_id: "world", name: "Bosque Viejo" });
    assert.equal(salidasDePlace(wm, "aldea")[0].name, "Bosque Viejo");
  });

  it("un destino que no está en el mapa se enseña por su id, no se calla", () => {
    // Un link colgante solo llega de un save corrupto (`removePlace` se lleva
    // los links del lugar): se construye desde el serializado, como al cargar.
    const crudo = mapa().serialize();
    crudo.links.push({ from: "aldea", to: "fantasma", kind: "road", bidirectional: true });
    const wm = WorldMapManager.fromSerialized(crudo);
    const salida = salidasDePlace(wm, "aldea").find((e) => e.place_id === "fantasma");
    assert.equal(salida?.name, "fantasma");
    assert.equal(salida?.edge, undefined, "sin edge ni posiciones no se adivina el borde");
  });

  it("sin links no hay salidas: lista vacía, no undefined", () => {
    assert.deepEqual(salidasDePlace(mapa(), "ermita"), []);
  });
});

describe("placeDeLaEscena — de qué lugar son las salidas de una escena", () => {
  it("el place_id que declara la escena manda, sea activa o no", () => {
    assert.equal(placeDeLaEscena({ place_id: "bosque" }, "tile_1_0", "tile_0_0", "aldea"), "bosque");
    assert.equal(placeDeLaEscena({ place_id: "bosque" }, "tile_0_0", "tile_0_0", "aldea"), "bosque");
  });

  it("la escena ACTIVA sin place cae al place activo", () => {
    assert.equal(placeDeLaEscena({}, "tile_0_0", "tile_0_0", "aldea"), "aldea");
  });

  it("una escena NO activa sin place no hereda las salidas de donde está el jugador", () => {
    assert.equal(placeDeLaEscena({}, "tile_1_0", "tile_0_0", "aldea"), null);
  });

  it("sin place activo, la activa tampoco tiene lugar (campo abierto = sin salidas)", () => {
    assert.equal(placeDeLaEscena({}, "tile_0_0", "tile_0_0", null), null);
    assert.equal(placeDeLaEscena({ place_id: "" }, "tile_0_0", "tile_0_0", undefined), null);
  });
});
