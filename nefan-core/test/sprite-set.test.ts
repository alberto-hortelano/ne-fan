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
 *    catálogo no pueda publicar el coste ANTES de gastar; y desde #375 hace
 *    además que esa anim herede el `PERFIL_POR_DEFECTO` de sprite-forge, que
 *    ENTRA en la clave del sheet vestido — o sea que un cambio en el otro repo
 *    repagaría su arte sin una línea en el `git log` de este.
 *
 *  Las tres son silenciosas en el juego y ruidosas en la factura. Aquí se
 *  candan.
 *
 *  PROBADO EN NEGATIVO (2026-09-01): quitando la entrada `defensive` del set,
 *  «el set trae las diez anims del set base» se pone rojo nombrándola;
 *  quitándole `keyframes` a `heavy`, el de los perfiles se pone rojo.
 *  Revertido.
 *
 *  PROBADO EN NEGATIVO (2026-09-03, #375): quitándole el `play_fps` a
 *  `praying` —una de las seis que hasta hoy no lo declaraban— el de los
 *  perfiles se pone rojo nombrándola. Antes de esta tanda ese mismo borrado
 *  salía VERDE: el candado solo miraba las diez de HOJAS_BASE_ANIMS.
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

  it("TODAS las anims del set declaran su fichero y su perfil, no solo las diez base", () => {
    // Dos razones, y la segunda llegó con #375:
    //
    // 1. `keyframes` y `play_fps` son lo que sprite-forge necesita para
    //    publicar `calls_per_anim` en /catalog — el precio que se le enseña al
    //    usuario ANTES de gastar. Sin ellos viaja null y ne-fan no puede cotizar.
    // 2. El perfil entra en la clave del sheet VESTIDO (`_skin_sheet_key`, #375).
    //    Una anim que NO lo declara hereda el `PERFIL_POR_DEFECTO` de
    //    sprite-forge, que vive en otro repositorio: el día que cambie allí, el
    //    arte de esa anim repaga sin que nadie haya tocado ne-fan, y el `git
    //    log` de este repo no tendrá ni una línea que lo explique.
    //
    // Por eso el barrido es sobre `SET.animations` y no sobre HOJAS_BASE_ANIMS
    // (las diez del set base): hasta #375 las seis ambientales
    // —talking, drinking, wounded_idle, sitting_idle, waving, praying— caían
    // fuera del candado por ser justo las que el cliente no exige. Una anim
    // nueva sin perfil vuelve a poner esto rojo sin que haya que acordarse.
    assert.ok(SET.animations.length >= HOJAS_BASE_ANIMS.length, "el set encogió");
    for (const entrada of SET.animations) {
      const anim = entrada.id;
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
