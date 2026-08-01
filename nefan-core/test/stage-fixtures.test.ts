/** Las fixtures de la posada (data/scenes/proscenio/) son el banco de pruebas
 *  del cliente 2D y del fake-ai-server: deben VALIDAR como escenas proscenio
 *  jugables y COMPONER de forma determinista, con sus salidas espejadas entre
 *  escenas (salón⇄cocina, salón⇄calle). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { validateScene, type PlaceContext } from "../src/scene/scene-validate.js";
import { stagePlanFromScene } from "../src/scene/stage/plan.js";
import { composeStage } from "../src/scene/stage/compose.js";
import { spawnPointForEntry, exitZoneAt } from "../src/scene/stage/entry.js";

const DIR = fileURLToPath(new URL("../data/scenes/proscenio", import.meta.url));

const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(DIR, name), "utf-8")) as Record<string, unknown>;

/** World map de la posada: los links espejo de las salidas de las fixtures. */
const POSADA_LINKS: Record<string, Array<{ to: string; edge?: "north" | "south" | "east" | "west" }>> = {
  posada_salon: [
    { to: "posada_cocina", edge: "north" },
    { to: "calle_mayor", edge: "south" },
  ],
  posada_cocina: [{ to: "posada_salon", edge: "south" }],
  calle_mayor: [{ to: "posada_salon", edge: "north" }],
};

const placeContext = (placeId: string): PlaceContext | null => {
  const links = POSADA_LINKS[placeId];
  if (!links) return { exists: false, outgoing_links: 0 };
  return { exists: true, kind: "interior", outgoing_links: links.length, links };
};

describe("fixtures proscenio de la posada", () => {
  it("todas las fixtures del directorio validan como escenas jugables", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 3, `esperaba ≥3 fixtures, hay ${files.length}`);
    for (const f of files) {
      const r = validateScene(load(f), placeContext);
      assert.deepEqual(r.errors, [], `${f}: ${r.errors.join(" | ")}`);
      assert.equal(r.ok, true, f);
    }
  });

  it("cada fixture compone determinista con capas y salidas", () => {
    for (const f of ["posada_salon.json", "posada_cocina.json", "posada_calle.json"]) {
      const raw = load(f);
      const plan = stagePlanFromScene(raw);
      assert.ok(plan, `${f} es proscenio`);
      const a = composeStage(plan!, String(raw.scene_id));
      const b = composeStage(plan!, String(raw.scene_id));
      assert.equal(JSON.stringify(a), JSON.stringify(b), `${f} determinista`);
      assert.ok(a.layers.length >= 3, `${f}: capas suficientes (${a.layers.length})`);
      assert.ok(a.exits.length >= 1, `${f}: salidas compuestas`);
      // Los props derivados de entities se pintan como capas con huella.
      const conHuella = a.layers.filter((l) => l.footprint);
      assert.ok(conHuella.length >= 1, `${f}: al menos un volumen derivado pintado`);
    }
  });

  it("las salidas están espejadas: salir y volver deja al jugador junto a la puerta", () => {
    const salon = composeStage(stagePlanFromScene(load("posada_salon.json"))!, "posada_salon");
    const cocina = composeStage(stagePlanFromScene(load("posada_cocina.json"))!, "posada_cocina");
    const calle = composeStage(stagePlanFromScene(load("posada_calle.json"))!, "posada_calle");

    // salón → cocina: la cocina tiene spawn de vuelta desde el salón.
    const enCocina = spawnPointForEntry(cocina, "posada_salon");
    assert.ok(enCocina, "cocina tiene salida de vuelta al salón");
    assert.equal(exitZoneAt(cocina, enCocina!.x, enCocina!.z), null, "spawn fuera de la zona");

    // salón → calle y calle → salón.
    const enCalle = spawnPointForEntry(calle, "posada_salon");
    assert.ok(enCalle, "la calle tiene la puerta de la posada");
    const enSalonDesdeCalle = spawnPointForEntry(salon, "calle_mayor");
    assert.ok(enSalonDesdeCalle, "el salón tiene la salida a la calle");
    const enSalonDesdeCocina = spawnPointForEntry(salon, "posada_cocina");
    assert.ok(enSalonDesdeCocina, "el salón tiene la puerta de la cocina");
  });
});
