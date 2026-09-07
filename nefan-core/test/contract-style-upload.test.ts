/** Candado del snapshot de la subida de estilos (`data/contract/style-upload.json`).
 *
 *  El fichero va COMMITEADO y lo leen `ai_server/style_packs.py` (las carpetas
 *  del pack) y `ai_server/routers/styles.py` (los límites y los motivos de cada
 *  rechazo). Como el job `ai-server` del CI no corre npm —solo `ruff`,
 *  `compileall` y `unittest`—, lo que Python lee es lo que hay en el repo, no
 *  algo que el runner regenere: el snapshot obsoleto ES la divergencia, y este
 *  test es lo único que la ve.
 *
 *  Por eso `dump-style-upload` NO está enganchado a los hooks `pre*`, igual que
 *  `dump-physics`: si se regenerase solo antes de cada test, este fichero jamás
 *  podría ponerse rojo y el candado sería decorativo.
 *
 *  Lo que se cierra aquí, medido antes de existir: con los números copiados a
 *  mano en `styles.py` (60, 500, 300, 8, 12, 300, 60) y las carpetas escritas
 *  por tercera vez en `style_packs.py`, subir el máximo de imágenes de 12 a 16
 *  en el zod dejaba al jugador con un cliente que aceptaba 16 y un servidor que
 *  devolvía 422 en la número 13, y las dos suites en verde. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CARPETA_LAMINA,
  MOTIVOS_DE_SUBIDA,
  REGLAS_DE_SUBIDA,
  styleUploadSnapshot,
} from "../src/contracts/style-upload.js";
import { SAFE_ID, STYLE_REF_FOLDERS } from "../src/games/style-refs.js";

const RUTA = fileURLToPath(new URL("../data/contract/style-upload.json", import.meta.url));

describe("data/contract/style-upload.json — el espejo de la subida no puede quedarse atrás", () => {
  it("lo commiteado es EXACTAMENTE lo que produce la fuente TS de hoy", () => {
    const enDisco = readFileSync(RUTA, "utf-8");
    const deLaFuente = JSON.stringify(styleUploadSnapshot(), null, 2) + "\n";
    assert.equal(
      enDisco,
      deLaFuente,
      "style-upload.json está obsoleto respecto a src/contracts/style-upload.ts. NO lo edites a " +
        "mano: `cd nefan-core && npm run dump-style-upload`, y el diff entra en el mismo commit. " +
        "Si no se regenera, ai_server seguirá validando la subida con los números y los motivos " +
        "viejos — y su suite no puede enterarse, porque no lee TypeScript.",
    );
  });

  it("el snapshot lleva TODO lo que Python necesita, y nada derivado dos veces", () => {
    const snap = JSON.parse(readFileSync(RUTA, "utf-8")) as ReturnType<typeof styleUploadSnapshot>;
    // Las cinco claves que `_load_style_upload` exige fail-loud.
    assert.deepEqual(
      Object.keys(snap).sort(),
      ["$comment", "carpetas", "lamina", "limites", "motivos", "ref_id_pattern"].sort(),
    );
    assert.deepEqual(snap.carpetas, [...STYLE_REF_FOLDERS]);
    assert.equal(snap.lamina, CARPETA_LAMINA);
    assert.ok(snap.carpetas.includes(snap.lamina), "la lámina es una de las carpetas del pack");
    assert.equal(snap.ref_id_pattern, SAFE_ID.source);
    assert.deepEqual(snap.limites, REGLAS_DE_SUBIDA);
    assert.deepEqual(snap.motivos, MOTIVOS_DE_SUBIDA);
  });

  it("los motivos viajan YA REDACTADOS, con sus números dentro", () => {
    // Si Python compusiera el texto a partir de los límites serían DOS
    // redacciones capaces de divergir, que es media enfermedad de vuelta (la
    // lección de `physics.json`: se vuelca el tope derivado, no los
    // ingredientes). Los límites viajan igual porque Python los aplica.
    const snap = JSON.parse(readFileSync(RUTA, "utf-8")) as ReturnType<typeof styleUploadSnapshot>;
    assert.match(snap.motivos.nombre, new RegExp(`${REGLAS_DE_SUBIDA.nombre.max}`));
    assert.match(snap.motivos.tags, new RegExp(`${REGLAS_DE_SUBIDA.tags.max}`));
    assert.match(snap.motivos.imagenes, new RegExp(`${REGLAS_DE_SUBIDA.imagenes.max}`));
    assert.match(snap.motivos.mas_de_una_lamina, new RegExp(CARPETA_LAMINA));
    // Y los que hablan de UNA imagen traen el hueco que rellena quien emite.
    for (const clave of [
      "carpeta",
      "imagen_vacia",
      "descripcion_de_imagen",
      "sin_descripcion",
      "id_invalido",
      "id_duplicado",
    ] as const) {
      assert.ok(snap.motivos[clave].includes("{ref}"), `${clave} sin {ref}`);
    }
  });
});
