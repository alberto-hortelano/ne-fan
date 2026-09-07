/** El fusible de skins (#236), escrito desde su regla: TRES personajes
 *  distintos con fallo de BACKEND apagan la sesión una sola vez; un 4xx no
 *  cuenta; el mismo personaje repetido es una evidencia; rearmar olvida. Los
 *  guiones 51 y 53 lo ven desde el navegador; aquí se mata cada mutante por su
 *  nombre. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FusibleDeSkins, UMBRAL_APAGADO_DE_SESION } from "../src/session/fusible-de-skins.js";

describe("FusibleDeSkins · el umbral se mide en personajes distintos", () => {
  it("el umbral es 3: ni la primera (el de antes de #236) ni una cifra que nadie eligió", () => {
    assert.equal(UMBRAL_APAGADO_DE_SESION, 3);
    assert.equal(new FusibleDeSkins().umbral, 3);
  });

  it("uno y dos personajes caídos cuentan pero NO apagan la sesión", () => {
    const f = new FusibleDeSkins();
    assert.equal(f.fallo("tabernero", 500), "cuenta");
    assert.equal(f.apagado, false, "un 500 de un solo personaje puede ser mala suerte");
    assert.equal(f.fallo("bandido", 502), "cuenta");
    assert.equal(f.apagado, false);
    assert.equal(f.caidos, 2);
  });

  it("el tercero apaga, y lo dice UNA vez: el cuarto ya solo cuenta", () => {
    const f = new FusibleDeSkins();
    f.fallo("tabernero", 500);
    f.fallo("bandido", 500);
    assert.equal(f.fallo("secuaz", 503), "apagar", "con el tercero se alcanza el umbral");
    assert.equal(f.apagado, true);
    assert.equal(f.caidos, 3);
    // Un fallo en vuelo que llega con la sesión ya apagada no vuelve a anunciar.
    assert.equal(f.fallo("posadera", 500), "cuenta");
    assert.equal(f.apagado, true);
  });

  it("el MISMO personaje fallando tres veces es una sola evidencia", () => {
    // `modelFor` encola las anims de combate perezosamente: un personaje puede
    // fallar en idle, walk y run. Un contador en vez de un Set apagaría aquí.
    const f = new FusibleDeSkins();
    assert.equal(f.fallo("tabernero", 500), "cuenta");
    assert.equal(f.fallo("tabernero", 500), "cuenta");
    assert.equal(f.fallo("tabernero", 500), "cuenta");
    assert.equal(f.apagado, false);
    assert.equal(f.caidos, 1);
  });
});

describe("FusibleDeSkins · solo el backend gasta evidencia", () => {
  it("un 4xx se ignora: no cuenta contra el umbral aunque sean tres personajes", () => {
    // El banco devuelve 404 para las hojas que el motor falso no tiene (walk,
    // run): si contara, el umbral se alcanzaría solo (guion 53).
    const f = new FusibleDeSkins();
    assert.equal(f.fallo("a", 404), "ignorar");
    assert.equal(f.fallo("b", 400), "ignorar");
    assert.equal(f.fallo("c", 429), "ignorar");
    assert.equal(f.apagado, false);
    assert.equal(f.caidos, 0, "un 4xx no anota al personaje");
  });

  it("la frontera es 500: 499 se ignora, 500 cuenta", () => {
    const f = new FusibleDeSkins();
    assert.equal(f.fallo("a", 499), "ignorar");
    assert.equal(f.fallo("a", 500), "cuenta");
  });

  it("sin status (red caída, servicio sin arrancar) es backend: cuenta", () => {
    const f = new FusibleDeSkins();
    assert.equal(f.fallo("a"), "cuenta");
    assert.equal(f.fallo("b", undefined), "cuenta");
    assert.equal(f.fallo("c"), "apagar");
  });
});

describe("FusibleDeSkins · rearmar", () => {
  it("rearmar olvida el flag Y la cuenta: hacen falta otros tres para volver a apagar", () => {
    const f = new FusibleDeSkins();
    f.fallo("a", 500);
    f.fallo("b", 500);
    f.fallo("c", 500);
    assert.equal(f.apagado, true);
    f.rearmar();
    assert.equal(f.apagado, false);
    assert.equal(f.caidos, 0, "rearmar sin olvidar la cuenta apagaría con el primer fallo siguiente");
    assert.equal(f.fallo("a", 500), "cuenta", "el personaje que ya falló vuelve a ser una evidencia nueva");
    assert.equal(f.fallo("b", 500), "cuenta");
    assert.equal(f.fallo("c", 500), "apagar");
  });

  it("rearmar un fusible que no saltó no rompe nada", () => {
    const f = new FusibleDeSkins();
    f.fallo("a", 500);
    f.rearmar();
    assert.equal(f.apagado, false);
    assert.equal(f.caidos, 0);
  });
});
