/** DE QUIÉN ES EL SIM (#659): las dos funciones puras que deciden si un
 *  `state_update` es de la página que lo recibe.
 *
 *  Los casos están escritos desde los criterios del plan, no desde el código:
 *  lo que hay que impedir es (a) que la página que llega después de una partida
 *  muerta aplique el jugador y los NPCs de ésa, y (b) que ninguna página
 *  descarte SU PROPIA respuesta, que es la trampa en la que cae el sello
 *  ingenuo por `ctx.narrative.session_id`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  describirDueno,
  identidadDelCliente,
  repartirEstado,
  type DuenoDelSim,
} from "../src/protocol/dueno-del-sim.js";

const PARTIDA = (id: string): DuenoDelSim => ({ de: "partida", sessionId: id });
const PRUEBA: DuenoDelSim = { de: "prueba" };
const NADIE: DuenoDelSim = { de: "nadie" };

describe("qué sim espera ver una página", () => {
  it("con partida y sin fixture, la suya", () => {
    assert.deepEqual(identidadDelCliente("s-1", false), { de: "partida", sessionId: "s-1" });
  });

  it("sin partida y sin fixture, el de nadie — que NO es el de una prueba", () => {
    const sinNada = identidadDelCliente("", false);
    assert.deepEqual(sinNada, { de: "nadie" });
    assert.notDeepEqual(sinNada, PRUEBA);
  });

  it("con una fixture cargada, la prueba MANDA sobre la partida", () => {
    // El bridge llama a `claimForFixture` haya o no sesión cargada
    // (`handleLoadRoom`), así que una página que abre el selector «Room» con
    // una partida a medias tiene que reconocer como suyo lo que describa esa
    // escena. Con las reglas al revés descartaría su propia respuesta de
    // `load_room`, `respawn` y `add_combatants`.
    assert.deepEqual(identidadDelCliente("s-1", true), PRUEBA);
    assert.deepEqual(identidadDelCliente("", true), PRUEBA);
  });
});

describe("a quién pertenece un state_update", () => {
  it("la misma partida se aplica", () => {
    assert.deepEqual(repartirEstado(PARTIDA("s-1"), PARTIDA("s-1")), { destino: "aplicar" });
  });

  it("EL CASO DEL GUION 80: el sim sigue siendo de la partida muerta y se tira", () => {
    // Se cerró el socket del 79 → `release()` deja `owner = null` pero NO toca
    // el contenido del sim. El 80 abre página nueva, manda `input`, y le
    // contestan con el jugador y los NPCs del 79. Sin este descarte, el cliente
    // materializa entradas de un mundo que nunca pidió.
    const r = repartirEstado(PARTIDA("la-del-79"), NADIE);
    assert.deepEqual(r, { destino: "descartado", deQuien: "la partida «la-del-79»" });
  });

  it("dos partidas distintas no se mezclan, en los dos sentidos", () => {
    assert.equal(repartirEstado(PARTIDA("a"), PARTIDA("b")).destino, "descartado");
    assert.equal(repartirEstado(PARTIDA("b"), PARTIDA("a")).destino, "descartado");
  });

  it("una página sin fixture NO hereda la escena de prueba de otra", () => {
    assert.deepEqual(repartirEstado(PRUEBA, NADIE), {
      destino: "descartado",
      deQuien: "una escena de prueba",
    });
    assert.deepEqual(repartirEstado(PRUEBA, PARTIDA("s-1")), {
      destino: "descartado",
      deQuien: "una escena de prueba",
    });
  });

  it("una partida no se cuela en una página que está mirando una fixture", () => {
    assert.equal(repartirEstado(PARTIDA("s-1"), PRUEBA).destino, "descartado");
    assert.equal(repartirEstado(NADIE, PRUEBA).destino, "descartado");
  });

  it("NADIE DESCARTA SU PROPIA RESPUESTA: los dos regímenes se aplican solos", () => {
    // Es la mitad que el sello ingenuo rompía. Las dos, juntas, en el mismo
    // `it`: si una se cae, el cambio no vale — el jugador vería el mundo sin
    // enemigos y el selector «Room» sin nada que se mueva.
    assert.deepEqual(repartirEstado(PRUEBA, PRUEBA), { destino: "aplicar" });
    assert.deepEqual(repartirEstado(NADIE, NADIE), { destino: "aplicar" });
  });

  it("«sin partida» y «escena de prueba» NO son el mismo valor colapsado", () => {
    // El motivo de que esto sea una unión de tres y no un `sessionId: string`.
    // Con `""` para las dos, estos dos repartos darían «aplicar» y volverían
    // los dos fallos que el tipo hace inexpresables.
    assert.equal(repartirEstado(PRUEBA, NADIE).destino, "descartado");
    assert.equal(repartirEstado(NADIE, PRUEBA).destino, "descartado");
  });

  it("una partida con id vacío tampoco es «nadie»", () => {
    // Puede pasar: `claimForSession` recibe el id por argumento y un llamante
    // sin sesión cargada estamparía `""`. Es la señal temprana del riesgo §8
    // del plan, y aquí se afirma que NO se confunde con el sim virgen.
    assert.equal(repartirEstado(PARTIDA(""), NADIE).destino, "descartado");
    assert.equal(repartirEstado(NADIE, PARTIDA("")).destino, "descartado");
    assert.deepEqual(repartirEstado(PARTIDA(""), PARTIDA("")), { destino: "aplicar" });
  });
});

describe("de quién era, para la línea que lee el jugador", () => {
  it("dice la partida, la prueba y nadie, cada una distinta", () => {
    const dichos = [describirDueno(PARTIDA("s-1")), describirDueno(PRUEBA), describirDueno(NADIE)];
    assert.deepEqual(dichos, ["la partida «s-1»", "una escena de prueba", "nadie"]);
    assert.equal(new Set(dichos).size, 3, "tres identidades, tres textos");
  });
});
