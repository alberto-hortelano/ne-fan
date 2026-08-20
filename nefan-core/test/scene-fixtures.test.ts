/** Candado de las fixtures de escena: en `data/scenes/**` solo hay Format D
 *  VIVO — un tile (mundo continuo) o un plató (`stage`).
 *
 *  El zod (`FormatDSceneSchema`) candar la salida del MOTOR, pero las fixtures
 *  del repo no pasan por él: las carga el selector del cliente 2D, el dump a
 *  `data/rooms/` para el arranque offline del 3D y los guiones de QA. Sin este
 *  test, una escena de la variante retirada (`size`+`terrain` sin `tile` ni
 *  `stage`) podría quedarse en el árbol para siempre, viva y renderizándose,
 *  mientras el contrato dice que no existe.
 *
 *  El escaneo va en una función con el directorio por parámetro para poder
 *  probarlo EN NEGATIVO sobre un árbol sintético: un candado que no se ha
 *  visto fallar no es un candado. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";

import { FormatDSceneSchema } from "../src/contract/model-io/scene-schema.js";

const SCENES = fileURLToPath(new URL("../data/scenes", import.meta.url));

interface Hallazgo {
  file: string;
  error: string;
}

/** Todos los .json del árbol, en orden estable. */
function escenasDe(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...escenasDe(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Audita las fixtures de `dir`: cada una debe declarar `tile` o `stage` y
 *  pasar el gate estructural de Format D. Devuelve los hallazgos (vacío = ok).
 *  Las fixtures son PRE-expansión (Format D crudo), que es justo lo que el
 *  schema valida. */
export function auditarEscenas(dir: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const path of escenasDe(dir)) {
    const file = relative(dir, path);
    let scene: Record<string, unknown>;
    try {
      scene = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      hallazgos.push({ file, error: `no es JSON válido: ${(err as Error).message}` });
      continue;
    }
    if (scene.tile === undefined && scene.stage === undefined) {
      hallazgos.push({
        file,
        error: "escena suelta: sin `tile` (mundo continuo) ni `stage` (proscenio) — esa variante se retiró",
      });
      continue;
    }
    const parsed = FormatDSceneSchema.safeParse(scene);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      hallazgos.push({ file, error: `${first.path.join(".") || "(raíz)"}: ${first.message}` });
    }
  }
  return hallazgos;
}

describe("fixtures de data/scenes — solo tile o plató", () => {
  it("todas las escenas del repo declaran su variante y pasan el gate", () => {
    const escenas = escenasDe(SCENES);
    assert.ok(escenas.length >= 3, `esperaba ≥3 fixtures, encontré ${escenas.length} (¿directorio equivocado?)`);
    assert.deepEqual(auditarEscenas(SCENES), []);
  });

  // ── El candado, en negativo ──────────────────────────────────────────────
  const arbolTemporal = (escenas: Record<string, unknown>): string => {
    const dir = mkdtempSync(join(tmpdir(), "nefan-scenes-"));
    for (const [name, scene] of Object.entries(escenas)) {
      const path = resolve(dir, name);
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, JSON.stringify(scene), "utf-8");
    }
    return dir;
  };

  const tileValido = {
    scene_id: "tile_0_0",
    scene_description: "Un campo de prueba.",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    entities: [],
  };

  it("caza una escena suelta perfectamente formada (el caso del issue #172)", () => {
    const dir = arbolTemporal({
      "vivo.json": tileValido,
      "suelta.json": {
        scene_id: "aldea_suelta",
        scene_description: "Una aldea sin sitio en el mundo.",
        size: { cols: 4, rows: 2, meters_per_cell: 2 },
        terrain: ["gggg", "gggg"],
        terrain_legend: {},
        entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1], glyph: "@" }],
      },
    });
    const hallazgos = auditarEscenas(dir);
    assert.equal(hallazgos.length, 1, JSON.stringify(hallazgos));
    assert.equal(hallazgos[0].file, "suelta.json");
    assert.match(hallazgos[0].error, /tile.*stage|stage.*tile/);
  });

  it("caza también un tile que no pasa el gate estructural (subdirectorios incluidos)", () => {
    const dir = arbolTemporal({
      "vivo.json": tileValido,
      "proscenio/roto.json": { ...tileValido, scene_id: "tile_1_0", tile: { tx: 1, ty: 0 }, size: { cols: 4, rows: 2, meters_per_cell: 2 } },
    });
    const hallazgos = auditarEscenas(dir);
    assert.equal(hallazgos.length, 1, JSON.stringify(hallazgos));
    assert.equal(hallazgos[0].file, join("proscenio", "roto.json"));
    assert.match(hallazgos[0].error, /size/);
  });
});
