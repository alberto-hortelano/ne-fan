/** El set de assets de personaje que ne-fan le pasa a sprite-forge (#369-R10).
 *
 *  `start.sh` dejó de usar el set por defecto del repo hermano
 *  (`sprite-forge/sets/mixamo.json`) y le pasa `--set data/sprite-set.json`,
 *  porque el vocabulario de anims es de ne-fan: `quick|heavy|medium|defensive|
 *  precise` son EXACTAMENTE los cinco tipos de ataque del combate, no una
 *  decisión del servicio de renderizado.
 *
 *  El precio de esa copia es que puede DERIVAR del original sin que nadie se
 *  entere, y derivar aquí no es cosmético:
 *
 *  - quitar una anim del set base deja al título ofreciendo un modelo cuyas
 *    hojas nadie puede renderizar (es el fallo de #216, una capa más abajo);
 *  - cambiar el `file` de una anim cambia su `anim_hash`, que entra en
 *    `base_key` (`sprite-forge/src/base-key.mjs`), y REPAGA todo el arte de
 *    personaje ya generado con ella;
 *  - un `keyframes` ausente hace que `calls_per_anim` viaje `null` y el
 *    catálogo no pueda publicar el coste ANTES de gastar.
 *
 *  Las tres son silenciosas en el juego y ruidosas en la factura. Aquí se
 *  candan.
 *
 *  PROBADO EN NEGATIVO (2026-09-01): quitando la entrada `defensive` del set,
 *  «el set trae las diez anims del set base» se pone rojo nombrándola;
 *  quitándole `keyframes` a `heavy`, el de los perfiles se pone rojo.
 *  Revertido.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { HOJAS_BASE_ANIMS } from "../src/contracts/sprite-census.js";

interface AnimDelSet {
  id: string;
  file: string;
  keyframes?: number;
  play_fps?: number;
  locomotion?: boolean;
}

const RAIZ = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SET = JSON.parse(readFileSync(join(RAIZ, "data/sprite-set.json"), "utf8")) as {
  id: string;
  animations: AnimDelSet[];
  models: { scan: string; id_from: string };
};

describe("data/sprite-set.json", () => {
  it("trae las diez anims del set base que el cliente exige", () => {
    const ids = new Set(SET.animations.map((a) => a.id));
    const faltan = HOJAS_BASE_ANIMS.filter((anim) => !ids.has(anim));
    assert.deepEqual(
      faltan,
      [],
      `sin estas anims el título ofrece un modelo cuyas hojas nadie puede renderizar: ${faltan.join(", ")}`,
    );
  });

  it("cada anim del set base declara su fichero y su perfil", () => {
    // `keyframes` y `play_fps` son lo que sprite-forge necesita para publicar
    // `calls_per_anim` en /catalog — el precio que se le enseña al usuario
    // ANTES de gastar. Sin ellos viaja null y ne-fan no puede cotizar.
    for (const anim of HOJAS_BASE_ANIMS) {
      const entrada = SET.animations.find((a) => a.id === anim);
      assert.ok(entrada, `falta la anim "${anim}"`);
      assert.ok(entrada.file?.endsWith(".fbx"), `"${anim}" sin fichero FBX: ${entrada.file}`);
      assert.equal(typeof entrada.keyframes, "number", `"${anim}" sin keyframes`);
      assert.ok(entrada.keyframes! > 0, `"${anim}" con keyframes ${entrada.keyframes}`);
      assert.equal(typeof entrada.play_fps, "number", `"${anim}" sin play_fps`);
      assert.ok(entrada.play_fps! > 0, `"${anim}" con play_fps ${entrada.play_fps}`);
    }
  });

  it("ninguna anim está declarada dos veces", () => {
    // Dos entradas con el mismo id son dos FBX distintos para la misma anim, y
    // cuál gana depende del orden de lectura del servicio: arte que cambia sin
    // que nadie haya tocado nada.
    const vistos = new Set<string>();
    const repes = SET.animations.filter((a) => (vistos.has(a.id) ? true : (vistos.add(a.id), false)));
    assert.deepEqual(repes.map((a) => a.id), []);
  });

  it("la locomoción está marcada donde el root motion la saca de la celda", () => {
    // `locomotion` congela Hips en XZ. Sin la marca, walk y run desplazan al
    // personaje fuera de su celda del sprite y la hoja sale rota — y el fallo
    // se ve en el juego, no aquí, salvo por este aserto.
    const conLocomocion = SET.animations.filter((a) => a.locomotion).map((a) => a.id).sort();
    assert.deepEqual(conLocomocion, ["run", "walk"]);
  });
});
