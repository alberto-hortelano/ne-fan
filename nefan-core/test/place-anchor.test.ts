/** resolveTravelAnchor — dónde aterriza un place al que se viaja y que aún
 *  no existe. Módulo puro: aquí solo entran coordenadas y un conjunto de
 *  claves ocupadas. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_TRAVEL_TILES, resolveTravelAnchor } from "../src/world-map/place-anchor.js";
import { tileKey } from "../src/scene/tile.js";
import type { Edge } from "../src/world-map/types.js";

const occupiedSet = (...coords: Array<[number, number]>): Set<string> =>
  new Set(coords.map(([tx, ty]) => tileKey(tx, ty)));

describe("resolveTravelAnchor — el rayo hacia la salida", () => {
  it("con el vecino libre, el destino es el vecino en esa dirección", () => {
    const cases: Array<[Edge, [number, number]]> = [
      ["north", [0, -1]],
      ["south", [0, 1]],
      ["east", [1, 0]],
      ["west", [-1, 0]],
    ];
    for (const [edge, expected] of cases) {
      const t = resolveTravelAnchor({ origin: { tx: 0, ty: 0 }, edge, occupied: new Set() });
      assert.deepEqual([t.tx, t.ty], expected, `salida al ${edge}`);
    }
  });

  it("salta los tiles YA GENERADOS y sigue alejándose en la misma dirección", () => {
    // El caso normal: el anillo 3×3 de la pre-generación ocupa los 8 vecinos,
    // así que un pueblo nunca se construye pegado al jugador.
    const occupied = occupiedSet([1, 0], [2, 0], [3, 0]);
    const t = resolveTravelAnchor({ origin: { tx: 0, ty: 0 }, edge: "east", occupied });
    assert.deepEqual([t.tx, t.ty], [4, 0]);
  });

  it("un tile reclamado por OTRO place cuenta como ocupado", () => {
    // El caller mete en `occupied` tanto los tiles generados como los anchors
    // ya asignados: dos pueblos no pueden compartir tile.
    const occupied = occupiedSet([0, -1]);
    const t = resolveTravelAnchor({ origin: { tx: 0, ty: 0 }, edge: "north", occupied });
    assert.deepEqual([t.tx, t.ty], [0, -2]);
  });

  it("el rayo parte del tile del JUGADOR, no del origen del mundo", () => {
    const t = resolveTravelAnchor({ origin: { tx: -3, ty: 5 }, edge: "west", occupied: new Set() });
    assert.deepEqual([t.tx, t.ty], [-4, 5]);
  });

  it("sin edge barre las cuatro direcciones a distancia 1 antes de alejarse", () => {
    // Orden determinista de EDGES (north, south, east, west): con los tres
    // primeros vecinos ocupados sale el cuarto, no un tile a distancia 2.
    const occupied = occupiedSet([0, -1], [0, 1], [1, 0]);
    const t = resolveTravelAnchor({ origin: { tx: 0, ty: 0 }, edge: null, occupied });
    assert.deepEqual([t.tx, t.ty], [-1, 0]);
  });

  it("es determinista: la misma entrada da siempre el mismo tile", () => {
    const occupied = occupiedSet([0, -1], [0, -2]);
    const a = resolveTravelAnchor({ origin: { tx: 2, ty: 2 }, edge: null, occupied });
    const b = resolveTravelAnchor({ origin: { tx: 2, ty: 2 }, edge: null, occupied });
    assert.deepEqual(a, b);
  });

  it("agotado el alcance LANZA — nunca devuelve un tile ocupado", () => {
    const occupied = new Set<string>();
    for (let d = 1; d <= MAX_TRAVEL_TILES; d++) occupied.add(tileKey(0, -d));
    assert.throws(
      () => resolveTravelAnchor({ origin: { tx: 0, ty: 0 }, edge: "north", occupied }),
      /No hay ningún tile libre/,
    );
  });

  it("el alcance es configurable y su agotamiento nombra la dirección", () => {
    const occupied = occupiedSet([1, 0], [2, 0]);
    assert.throws(
      () => resolveTravelAnchor({ origin: { tx: 0, ty: 0 }, edge: "east", occupied, maxDistance: 2 }),
      /hacia el east/,
    );
    // Con un tile más de alcance, encuentra sitio.
    const t = resolveTravelAnchor({ origin: { tx: 0, ty: 0 }, edge: "east", occupied, maxDistance: 3 });
    assert.deepEqual([t.tx, t.ty], [3, 0]);
  });

  it("un origen que no es un tile es fail-loud", () => {
    assert.throws(
      () => resolveTravelAnchor({ origin: { tx: 0.5, ty: 0 }, edge: null, occupied: new Set() }),
      /no es un tile/,
    );
    assert.throws(
      () => resolveTravelAnchor({ origin: { tx: 0, ty: 0 }, edge: null, occupied: new Set(), maxDistance: 0 }),
      /alcance inválido/,
    );
  });
});
