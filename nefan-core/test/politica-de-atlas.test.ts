/** La política del atlas, escrita desde sus dos incidentes: pedir dos veces la
 *  misma clave era pagar dos veces ($0.15×2, 2026-08-14), y no re-disparar
 *  —o descartar la clave distinta— era el tile del jugador en clay al reanudar
 *  (#390). Cada test nombra el mutante que mata. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PoliticaDeAtlas } from "../src/scene/politica-de-atlas.js";

describe("PoliticaDeAtlas · pedir/terminar: la misma clave no se paga dos veces", () => {
  it("la primera petición de una clave arranca; la segunda, con la primera en curso, se encola", () => {
    const p = new PoliticaDeAtlas();
    assert.equal(p.pedir("tile_0_0"), "arranca");
    assert.equal(p.pedir("tile_0_0"), "encolado", "el segundo trigger antes del primer await no puede arrancar otro ciclo");
  });

  it("al terminar una clave con un trigger solapado se pide UN re-disparo, y solo uno", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("tile_0_0");
    p.pedir("tile_0_0");
    p.pedir("tile_0_0"); // tres solapados, un solo re-disparo (Set, no contador)
    assert.equal(p.terminar("tile_0_0"), "re-disparar");
    // El re-disparo vuelve a pedir la clave: ahora arranca limpio…
    assert.equal(p.pedir("tile_0_0"), "arranca", "tras terminar, la clave vuelve a estar libre");
    // …y como nadie más la pidió mientras, al terminar no hay nada que re-disparar.
    assert.equal(p.terminar("tile_0_0"), "nada");
  });

  it("terminar una clave sin trigger solapado no re-dispara nada", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("tile_0_0");
    assert.equal(p.terminar("tile_0_0"), "nada");
  });

  it("una clave DISTINTA con otra en curso arranca: ni se encola ni se descarta (#390)", () => {
    // El `if (this.inFlight) return;` de antes de #390 descartaba aquí el tile
    // del jugador. Un mutante que devuelva "encolado" para la clave distinta
    // la dejaría esperando a un `terminar` que no es el suyo.
    const p = new PoliticaDeAtlas();
    assert.equal(p.pedir("tile_0_0"), "arranca");
    assert.equal(p.pedir("tile_1_0"), "arranca");
    // Y la deduplicación es POR CLAVE: terminar la primera no libera ni
    // re-dispara la segunda.
    assert.equal(p.terminar("tile_0_0"), "nada");
    assert.equal(p.pedir("tile_1_0"), "encolado", "tile_1_0 sigue en curso: su segundo trigger se encola");
    assert.equal(p.terminar("tile_1_0"), "re-disparar");
  });

  it("el trigger encolado de una clave no se cuela en el terminar de otra", () => {
    const p = new PoliticaDeAtlas();
    p.pedir("a");
    p.pedir("b");
    p.pedir("b"); // b tiene un solapado
    assert.equal(p.terminar("a"), "nada", "a no tenía solapado: el de b no es suyo");
    assert.equal(p.terminar("b"), "re-disparar");
  });
});

describe("PoliticaDeAtlas · run y token: el tile nuevo supera al run en vuelo", () => {
  it("cada run recibe un token nuevo y solo el último es vigente", () => {
    const p = new PoliticaDeAtlas();
    const t1 = p.nuevoRun();
    assert.equal(p.vigente(t1), true);
    const t2 = p.nuevoRun();
    assert.notEqual(t1, t2, "dos runs no pueden compartir token: el viejo aplicaría su atlas encima del nuevo");
    assert.equal(p.vigente(t1), false, "el run superado deja de mandar");
    assert.equal(p.vigente(t2), true);
  });

  it("un token que ningún run recibió no es vigente", () => {
    // Los tokens salen SOLO de `nuevoRun`; el controller nunca pregunta por
    // uno que no le hayan dado, así que aquí no se promete nada sobre el 0
    // inicial — solo que un número inventado no manda.
    const p = new PoliticaDeAtlas();
    p.nuevoRun();
    assert.equal(p.vigente(999), false);
  });

  it("enVuelo se enciende con el run y se apaga cuando el run VIGENTE termina", () => {
    const p = new PoliticaDeAtlas();
    assert.equal(p.enVuelo, false, "sin runs no hay nada en vuelo");
    const t = p.nuevoRun();
    assert.equal(p.enVuelo, true);
    p.finDeRun(t);
    assert.equal(p.enVuelo, false);
  });

  it("el fin de un run SUPERADO no apaga el indicador del que lo superó", () => {
    // El `finally` del run viejo llega mientras el nuevo sigue descargando: si
    // apagara `enVuelo`, el panel dev diría «listo» con un POST en el aire.
    const p = new PoliticaDeAtlas();
    const viejo = p.nuevoRun();
    const nuevo = p.nuevoRun();
    p.finDeRun(viejo);
    assert.equal(p.enVuelo, true, "el run nuevo sigue en vuelo");
    p.finDeRun(nuevo);
    assert.equal(p.enVuelo, false);
  });
});
