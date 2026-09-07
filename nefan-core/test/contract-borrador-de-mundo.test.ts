/** Candado del snapshot del umbral del borrador (`data/contract/borrador-de-mundo.json`).
 *
 *  El fichero va COMMITEADO y lo lee `ai_server/narrative_schemas.py` para topar
 *  el `draft_text` de `POST /develop_world` con el mismo mínimo y el mismo
 *  máximo que aplican el título y el bridge. Como el job `ai-server` del CI no
 *  corre npm —solo `ruff`, `compileall` y `unittest`—, lo que Python lee es lo
 *  que hay en el repo, no algo que el runner regenere: el snapshot obsoleto ES
 *  la divergencia, y este test es lo único que la ve.
 *
 *  Por eso `dump-borrador-de-mundo` NO está enganchado a los hooks `pre*`, igual
 *  que `dump-physics` y `dump-style-upload`: si se regenerase solo antes de cada
 *  test, este fichero jamás podría ponerse rojo y el candado sería decorativo.
 *
 *  Lo que se cierra aquí, medido antes de existir (hallazgo H1 de la QA de la PR
 *  7 de #241): con `Field(min_length=20, max_length=64_000)` escrito a mano en
 *  `ai_server/routers/narrative.py`, subir `BORRADOR_MAX` a 100.000 en TS dejaba
 *  al jugador con un título y un bridge que aceptaban un borrador de 70.000
 *  caracteres y un tercer proceso que lo mataba con un 422 de Pydantic —que el
 *  título le enseña como `develop_world: HTTP 422 …`— con las tres suites en
 *  verde. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BORRADOR_MAX,
  BORRADOR_MIN,
  borradorSnapshot,
} from "../src/protocol/borrador-de-mundo.js";

const RUTA = fileURLToPath(new URL("../data/contract/borrador-de-mundo.json", import.meta.url));

describe("data/contract/borrador-de-mundo.json — el tercer proceso no puede quedarse atrás", () => {
  it("lo commiteado es EXACTAMENTE lo que produce la fuente TS de hoy", () => {
    const enDisco = readFileSync(RUTA, "utf-8");
    const deLaFuente = JSON.stringify(borradorSnapshot(), null, 2) + "\n";
    assert.equal(
      enDisco,
      deLaFuente,
      "borrador-de-mundo.json está obsoleto respecto a src/protocol/borrador-de-mundo.ts. NO lo " +
        "edites a mano: `cd nefan-core && npm run dump-borrador-de-mundo`, y el diff entra en el " +
        "mismo commit. Si no se regenera, ai_server seguirá topando el borrador con el número " +
        "viejo — y su suite no puede enterarse, porque no lee TypeScript.",
    );
  });

  it("lleva las dos claves que `_load_contract_borrador` exige, y solo los números", () => {
    const snap = JSON.parse(readFileSync(RUTA, "utf-8")) as ReturnType<typeof borradorSnapshot>;
    assert.deepEqual(Object.keys(snap).sort(), ["$comment", "max", "min"]);
    assert.equal(snap.min, BORRADOR_MIN);
    assert.equal(snap.max, BORRADOR_MAX);
    // Los MOTIVOS no viajan: ai_server no los emite (su rechazo es el 422
    // estructurado de Pydantic, la red de debajo del bridge). Mandarle una
    // redacción que nadie lee sería contrato muerto, y el día que alguien la
    // cambiara nadie se enteraría de que no hacía nada.
    assert.equal("motivos" in snap, false);
  });

  it("el mínimo cabe en el máximo y los dos son enteros positivos", () => {
    // No es celo: son los dos números que Pydantic mete en `min_length` /
    // `max_length`, y un flotante o un mínimo por encima del máximo rechazaría
    // TODO borrador con un 422 que el jugador no puede arreglar escribiendo.
    for (const [nombre, n] of [["min", BORRADOR_MIN], ["max", BORRADOR_MAX]] as const) {
      assert.equal(Number.isInteger(n), true, nombre);
      assert.ok(n > 0, nombre);
    }
    assert.ok(BORRADOR_MIN < BORRADOR_MAX);
  });
});
