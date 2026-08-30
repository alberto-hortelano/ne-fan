/** Candado del snapshot de física compartido (`data/contract/physics.json`).
 *
 *  El fichero va COMMITEADO y lo lee ai_server para topar el `footprint` de una
 *  entity móvil con el mismo número que el zod. Como el job `ai-server` del CI
 *  no corre npm —solo `ruff`, `compileall` y `unittest`—, lo que Python lee es
 *  lo que hay en el repo, no algo que el runner regenere. Luego el snapshot
 *  obsoleto ES la divergencia, y este test es lo único que la ve.
 *
 *  Por eso `dump-physics` NO está enganchado a los hooks `pre*`: si se
 *  regenerase solo antes de cada test, este fichero jamás podría ponerse rojo y
 *  el candado sería decorativo.
 *
 *  Lo que se cierra aquí, medido antes de existir: con las tres constantes
 *  copiadas a mano en `narrative_schemas.py`, mover `NPC_RADIUS_M` solo en TS
 *  dejaba el tope TS en `{npc:3}`, el Python en `{npc:2}` y los 136 tests de
 *  ai_server en OK. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { physicsSnapshot, RADIO_SIMULADO_POR_KIND, topeDeFootprint } from "../src/contract/model-io/physics.js";
import { NPC_RADIUS_M, PLAYER_RADIUS_M, celdasQueCubreRadio } from "../src/scene/terrain-collision.js";
import { TILE_MPC } from "../src/scene/tile.js";

const RUTA = fileURLToPath(new URL("../data/contract/physics.json", import.meta.url));

describe("data/contract/physics.json — el espejo de física no puede quedarse atrás", () => {
  it("lo commiteado es EXACTAMENTE lo que produce la fuente TS de hoy", () => {
    const enDisco = readFileSync(RUTA, "utf-8");
    const deLaFuente = JSON.stringify(physicsSnapshot(), null, 2) + "\n";
    assert.equal(
      enDisco,
      deLaFuente,
      "physics.json está obsoleto respecto a src/scene/terrain-collision.ts o src/scene/tile.ts. " +
        "NO lo edites a mano: `cd nefan-core && npm run dump-physics`, y el diff entra en el mismo commit. " +
        "Si no se regenera, ai_server seguirá topando el footprint con el número viejo — y su suite " +
        "no puede enterarse, porque no lee TypeScript.",
    );
  });

  it("el snapshot lleva el tope YA DERIVADO, no solo los ingredientes", () => {
    // Si Python repitiera la cuenta serían DOS fórmulas capaces de divergir,
    // que es media enfermedad de vuelta. Los ingredientes viajan igual porque
    // el mensaje de error habla en metros.
    const snap = JSON.parse(readFileSync(RUTA, "utf-8")) as {
      tile_mpc: number;
      radio_simulado_m: Record<string, number>;
      footprint_max_cells: Record<string, number>;
    };
    assert.equal(snap.tile_mpc, TILE_MPC);
    assert.deepEqual(snap.radio_simulado_m, { npc: NPC_RADIUS_M, player: PLAYER_RADIUS_M });
    for (const [kind, radio] of Object.entries(RADIO_SIMULADO_POR_KIND)) {
      assert.equal(snap.footprint_max_cells[kind], celdasQueCubreRadio(radio, TILE_MPC), kind);
      assert.equal(snap.footprint_max_cells[kind], topeDeFootprint(kind), kind);
    }
    assert.deepEqual(
      Object.keys(snap.footprint_max_cells).sort(),
      Object.keys(RADIO_SIMULADO_POR_KIND).sort(),
      "los kinds móviles del snapshot son los del contrato, ni uno más ni uno menos",
    );
  });
});
