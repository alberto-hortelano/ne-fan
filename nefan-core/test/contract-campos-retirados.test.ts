/** Candado del snapshot de campos retirados (`data/contract/campos-retirados.json`).
 *
 *  El fichero va COMMITEADO y lo lee `ai_server/campos_retirados.py` para
 *  rebotar una clave retirada con el MISMO texto que el zod. Como el job
 *  `ai-server` del CI no corre npm —solo `ruff`, `compileall` y `unittest`—, lo
 *  que Python lee es lo que hay en el repo, no algo que el runner regenere.
 *  Luego el snapshot obsoleto ES la divergencia, y este test es lo único que la
 *  ve desde `npm test`.
 *
 *  Por eso `dump-campos-retirados` NO está enganchado a los hooks `pre*`: si se
 *  regenerase solo antes de cada test, este fichero jamás podría ponerse rojo y
 *  el candado sería decorativo.
 *
 *  Lo que se cierra aquí, MEDIDO antes de existir (#466, 2026-09-10): con la
 *  tabla copiada a mano en Python, `qa/los-dos-gates-rebotan-igual.mjs` daba
 *  cinco divergencias —dos claves que el zod rebota con su motivo en la raíz y
 *  Python con el genérico, y el rótulo de la entity escrito de otra forma— con
 *  los 2.476 tests de nefan-core y los de ai_server en verde.
 *
 *  Aquí NO se escribe ningún nombre de campo retirado: todo se deriva de la
 *  fuente, así que este fichero no necesita exención en
 *  `campos-retirados-no-vuelven`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  camposRetiradosSnapshot,
  mensajeDeClaveRetirada,
  mensajeDeClaveRetiradaDeRaiz,
  rotuloDeEntity,
} from "../src/contract/model-io/retired-terrain-fields.js";

const RUTA = fileURLToPath(new URL("../data/contract/campos-retirados.json", import.meta.url));

describe("data/contract/campos-retirados.json — el espejo de motivos no puede quedarse atrás", () => {
  it("lo commiteado es EXACTAMENTE lo que produce la fuente TS de hoy", () => {
    const enDisco = readFileSync(RUTA, "utf-8");
    const deLaFuente = JSON.stringify(camposRetiradosSnapshot(), null, 2) + "\n";
    assert.equal(
      enDisco,
      deLaFuente,
      "campos-retirados.json está obsoleto respecto a src/contract/model-io/retired-terrain-fields.ts. " +
        "NO lo edites a mano: `cd nefan-core && npm run dump-campos-retirados`, y el diff entra en el " +
        "mismo commit. Si no se regenera, ai_server seguirá rebotando con el texto viejo — y su suite no " +
        "puede enterarse, porque no lee TypeScript.",
    );
  });

  it("los motivos viajan YA COMPUESTOS (con su sufijo), no en ingredientes", () => {
    // Si Python volviera a componer «`campo` está retirado: … Si viene de un
    // save…» serían DOS formatos capaces de divergir, que es media enfermedad
    // de vuelta. Misma lección que el tope de footprint en physics.json.
    const snap = JSON.parse(readFileSync(RUTA, "utf-8")) as ReturnType<typeof camposRetiradosSnapshot>;
    assert.ok(Object.keys(snap.motivos).length > 0, "la tabla compartida no puede estar vacía");
    for (const [campo, motivo] of Object.entries(snap.motivos)) {
      assert.equal(motivo, mensajeDeClaveRetirada(campo), campo);
      assert.equal(motivo, mensajeDeClaveRetiradaDeRaiz(campo), `${campo} (raíz)`);
    }
    for (const [campo, motivo] of Object.entries(snap.motivos_solo_de_raiz)) {
      assert.equal(motivo, mensajeDeClaveRetiradaDeRaiz(campo), campo);
      assert.equal(
        mensajeDeClaveRetirada(campo),
        null,
        `${campo} es de SOLO RAÍZ: en una entity nunca existió y le toca el genérico`,
      );
    }
  });

  it("el rótulo de la entity es una plantilla con `{id}`, y el sin-id no lo lleva", () => {
    const snap = JSON.parse(readFileSync(RUTA, "utf-8")) as ReturnType<typeof camposRetiradosSnapshot>;
    assert.ok(snap.rotulo_de_entity.includes("{id}"), snap.rotulo_de_entity);
    assert.equal(rotuloDeEntity("p"), snap.rotulo_de_entity.replace("{id}", "p"));
    assert.equal(rotuloDeEntity(undefined), snap.rotulo_de_entity_sin_id);
    assert.equal(rotuloDeEntity(""), snap.rotulo_de_entity_sin_id);
    assert.equal(rotuloDeEntity(7), snap.rotulo_de_entity_sin_id);
  });
});
