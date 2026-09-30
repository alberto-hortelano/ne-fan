/** La puerta de lo CRUDO hacia `formatDToWorld` (#782): `escenaCargable` y el
 *  gate que estrecha el tipo, `gateEscenaExpandida`.
 *
 *  Lo que aquí se afirma es lo que hasta #782 hacía `formatDToWorld` por dentro
 *  —expandir las fixtures crudas y rechazar lo que no era Format D— pero con el
 *  rasero del zod, que es el de una escena del motor. Las fixtures de
 *  `data/scenes/` son las que usa el selector «Room»: si una no pasara, el
 *  preset `html-fixtures` no pintaría. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { escenaCargable } from "../src/scene/escena-cargable.js";
import {
  ExpandedSceneSchema,
  gateEscenaExpandida,
  MOTIVO_CELL_FINITA,
} from "../src/contract/model-io/scene-schema.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import { MOTIVO_COORDS_DE_TILE } from "../src/scene/tile.js";

const SCENES = fileURLToPath(new URL("../data/scenes", import.meta.url));
const PREFIJO = "escenaCargable: no es Format D (ni emitido ni expandido): ";

/** Un tile crudo mínimo y válido, como lo emite el motor. */
const cruda = (): Record<string, unknown> => ({
  tile: { tx: 0, ty: 0 },
  scene_id: "tile_0_0",
  scene_description: "Una plaza de prueba.",
  biome: "grass",
  entities: [
    { id: "player", kind: "player", name: "Tú", cell: [5, 5], footprint: [1, 1] },
    { id: "pozo", kind: "prop", name: "Pozo", cell: [10, 10], footprint: [2, 2] },
  ],
});

/** El mensaje con el que lanza, o `null` si no lanza. */
function motivo(raw: unknown): string | null {
  try {
    escenaCargable(raw);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

describe("escenaCargable — las fixtures del selector «Room» pasan por la puerta", () => {
  const files = readdirSync(SCENES).filter((f) => f.endsWith(".json"));

  it("hay tres fixtures, y las tres están CRUDAS en disco", () => {
    // Si alguien las commitea expandidas, el camino de la emitida deja de
    // ejercerse con datos reales: se dice aquí y no se descubre después.
    assert.equal(files.length, 3, files.join(", "));
    for (const f of files) {
      const raw = JSON.parse(readFileSync(resolve(SCENES, f), "utf-8"));
      assert.equal("__expanded" in raw, false, `${f} está expandida en disco`);
    }
  });

  for (const f of files) {
    it(`${f}: sale como escena CARGABLE (el zod de la cargada la acepta), sin perder nada, y se convierte`, () => {
      const raw = JSON.parse(readFileSync(resolve(SCENES, f), "utf-8"));
      const escena = escenaCargable(raw);
      // La puerta devuelve la SALIDA del zod, que poda las claves de más de
      // los sub-objetos no estrictos: en una escena real no hay ninguna, así
      // que la salida es la expansión entera.
      assert.deepEqual(escena, expandScenePrimitives(raw));
      assert.equal(escena.__expanded, true);
      assert.equal(ExpandedSceneSchema.safeParse(escena).success, true);
      // La cruda no se toca: la expansión es una copia.
      assert.equal("__expanded" in raw, false, "la puerta no muta lo que recibe");
      const w = formatDToWorld(escena);
      assert.equal(w.scene_id, raw.scene_id);
      assert.equal(w.objects.length + w.npcs.length + (w.__player_start ? 1 : 0), raw.entities.length);
    });
  }
});

describe("escenaCargable — las dos poblaciones", () => {
  it("una cruda válida se expande y vale lo mismo que expandirla a mano", () => {
    const raw = cruda();
    assert.deepEqual(escenaCargable(raw), expandScenePrimitives(cruda()));
  });

  it("una ya expandida no se re-expande: sale igual, y es la salida del gate y no el objeto del llamante", () => {
    const expandida = expandScenePrimitives(cruda());
    const cargable = escenaCargable(expandida);
    assert.deepEqual(cargable, expandida);
    assert.notEqual(cargable, expandida, "lo que el llamante mute después no puede tocar lo que se pinta");
  });

  it("una expandida pasa por SU gate: lo que la emitida no admite (size, terrain, __expanded) aquí vale", () => {
    // Sin esta rama, una expandida caería al gate de la emitida y la
    // rechazaría por `size`: el snapshot y los saves no se podrían pintar.
    const expandida = expandScenePrimitives(cruda());
    assert.ok("size" in expandida && "terrain" in expandida);
    assert.doesNotThrow(() => escenaCargable(expandida));
  });

  it("una expandida inválida lanza con el motivo del gate de la cargada", () => {
    const expandida = expandScenePrimitives(cruda()) as { entities: Record<string, unknown>[] };
    expandida.entities[1].shape = "pyramid";
    const m = motivo(expandida);
    assert.ok(m?.startsWith(`${PREFIJO}entities[1].shape: `), String(m));
  });

  it("una marca `__expanded` que no es `true` no la cuela: va por la emitida, que la rechaza", () => {
    const m = motivo({ ...cruda(), __expanded: false });
    assert.ok(m?.startsWith(PREFIJO), String(m));
    assert.match(m!, /__expanded/);
  });
});

describe("escenaCargable — lo que no es Format D lanza nombrando qué", () => {
  it("una world scene ya servida no vuelve a entrar (la idempotencia murió con __format_d)", () => {
    // Es el paso 6 del guion 68: `addTileRaw(__nefan.scene)`.
    const servida = { ...formatDToWorld(escenaCargable(cruda())), exits: [] };
    const m = motivo(servida);
    assert.ok(m?.startsWith(PREFIJO), String(m));
    assert.match(m!, /terrain/, "nombra el campo que no es de una escena");
  });

  it("lo que ni siquiera es un objeto lanza, no revienta con un TypeError", () => {
    for (const basura of [null, undefined, 42, "tile_0_0", []]) {
      const m = motivo(basura);
      assert.ok(m?.startsWith(PREFIJO), `${JSON.stringify(basura)}: ${m}`);
    }
  });

  it("cruda sin `tile` → lanza nombrando `tile` (no hay «escena suelta» que expandir)", () => {
    const { tile: _t, ...sinTile } = cruda();
    assert.match(motivo(sinTile) ?? "", /`tile`/);
  });

  it("expandida sin `tile` → lanza nombrando `tile`", () => {
    const { tile: _t, ...sinTile } = expandScenePrimitives(cruda());
    assert.match(motivo(sinTile) ?? "", /`tile`/);
  });

  it("`tile` con coords no enteras → lanza con el motivo del tile", () => {
    const m = motivo({ ...cruda(), tile: { tx: 0.5, ty: 0 } });
    assert.equal(m, `${PREFIJO}tile.tx: ${MOTIVO_COORDS_DE_TILE}`);
  });

  it("una `cell` infinita lanza en las DOS ramas, con su ruta (#782)", () => {
    const conCell = <T extends Record<string, unknown>>(d: T): T => {
      (d.entities as Record<string, unknown>[])[1].cell = [JSON.parse("1e400"), 3];
      return d;
    };
    assert.equal(motivo(conCell(cruda())), `${PREFIJO}entities[1].cell[0]: ${MOTIVO_CELL_FINITA}`);
    assert.equal(
      motivo(conCell(expandScenePrimitives(cruda()))),
      `${PREFIJO}entities[1].cell[0]: ${MOTIVO_CELL_FINITA}`,
    );
  });

  it("lo que `formatDToWorld` toleraba hasta #782 ahora lo rechaza la puerta: `h` ≤ 0 o infinita y `shape` inventada", () => {
    for (const [campo, valor] of [
      ["h", 0],
      ["h", -2],
      ["h", "alta"],
      ["h", JSON.parse("1e400")],
      ["shape", "dodecaedro"],
    ] as [string, unknown][]) {
      const d = cruda();
      (d.entities as Record<string, unknown>[])[1][campo] = valor;
      const m = motivo(d);
      assert.ok(m?.startsWith(`${PREFIJO}entities[1].${campo}: `), `${campo}=${JSON.stringify(valor)}: ${m}`);
    }
  });
});

describe("gateEscenaExpandida — el único estrechador de la casa", () => {
  it("con éxito devuelve la SALIDA del parseo: mutar después lo que se le pasó no la toca (QA de #782, A3)", () => {
    const expandida = expandScenePrimitives(cruda()) as { entities: Record<string, unknown>[] };
    const g = gateEscenaExpandida(expandida);
    assert.equal(g.ok, true);
    if (!g.ok) return;
    expandida.entities[1].shape = "pyramid";
    assert.equal(g.escena.entities[1].shape, undefined, "la escena del gate no comparte objetos con la del llamante");
  });

  it("y la salida es lo que dijo el zod: la clave de más de un sub-objeto no estricto se poda (medido, no supuesto)", () => {
    const expandida = expandScenePrimitives(cruda());
    (expandida.tile as Record<string, unknown>).nota = "de disco";
    const g = gateEscenaExpandida(expandida);
    assert.equal(g.ok, true);
    if (!g.ok) return;
    assert.deepEqual(g.escena.tile, { tx: 0, ty: 0 });
  });

  it("sin éxito devuelve el error del zod, no lanza", () => {
    const g = gateEscenaExpandida(cruda());
    assert.equal(g.ok, false);
    if (g.ok) return;
    assert.ok(g.error.issues.length > 0);
  });
});
