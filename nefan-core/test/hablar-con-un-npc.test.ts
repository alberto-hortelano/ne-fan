/** EL SALUDO Y LA ESPERA QUE ABRE (#241, PR 8).
 *
 *  El fichero era del cliente y ya estaba limpio —ni DOM ni WebGL, el corte 6
 *  de #358 lo había sacado de `main.ts`— y aun así no lo medía nada, que es el
 *  título de #241. Lo que se afirma aquí es lo que cuesta dinero: que una
 *  segunda `E` antes de que el motor conteste NO manda otro `interact_entity`,
 *  y que la `E` no se queda muerta el resto de la partida si el motor nunca
 *  contesta.
 *
 *  El reloj entra por parámetro, así que los 30 s del tope se cruzan sin
 *  esperar ninguno. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { HablarConUnNpc } from "../src/simulation/hablar-con-un-npc.js";

/** Un banco que apunta lo que sale hacia el motor y hacia el registro. */
function banco(hayConversacionAbierta = () => false) {
  const saludos: [string, string][] = [];
  const logs: string[] = [];
  const hablar = new HablarConUnNpc({
    hayConversacionAbierta,
    saludar: (id, nombre) => saludos.push([id, nombre]),
    log: (msg) => logs.push(msg),
  });
  return { hablar, saludos, logs };
}

const TABERNERO = { id: "barkeep", name: "Tabernero corpulento" };

describe("HablarConUnNpc · a quién se le puede hablar", () => {
  it("con alguien delante ofrece la acción, con su nombre y con la tecla E", () => {
    const { hablar } = banco();
    assert.deepEqual(hablar.frame(0, TABERNERO, false), {
      id: "interact",
      label: "hablar con Tabernero corpulento",
      key: "E",
    });
  });

  it("sin nadie delante no hay acción que ofrecer", () => {
    const { hablar, saludos } = banco();
    assert.equal(hablar.frame(0, null, false), null);
    // Y la tecla pulsada al aire tampoco manda nada al motor.
    assert.equal(hablar.frame(0, null, true), null);
    assert.deepEqual(saludos, []);
  });

  it("con una conversación ya en pantalla no se ofrece hablar otra vez", () => {
    const { hablar, saludos } = banco(() => true);
    assert.equal(hablar.frame(0, TABERNERO, false), null);
    assert.equal(hablar.frame(0, TABERNERO, true), null, "ni pulsando");
    assert.deepEqual(saludos, [], "y no se manda un segundo saludo por debajo");
  });

  it("un NPC sin nombre se saluda por su id, en el botón y en el motor", () => {
    const { hablar, saludos, logs } = banco();
    const accion = hablar.frame(0, { id: "npc_7" }, true);
    assert.equal(accion?.label, "hablar con npc_7");
    assert.deepEqual(saludos, [["npc_7", "npc_7"]]);
    assert.deepEqual(logs, ["Hablando con npc_7..."]);
  });
});

describe("HablarConUnNpc · la espera: una E, un saludo", () => {
  it("la primera E manda el saludo con id y nombre, y lo dice en el registro", () => {
    const { hablar, saludos, logs } = banco();
    hablar.frame(1000, TABERNERO, true);
    assert.deepEqual(saludos, [["barkeep", "Tabernero corpulento"]]);
    assert.deepEqual(logs, ["Hablando con Tabernero corpulento..."]);
  });

  it("una segunda E mientras el motor no contesta NO manda otro saludo", () => {
    const { hablar, saludos } = banco();
    hablar.frame(1000, TABERNERO, true);
    hablar.frame(1001, TABERNERO, true);
    hablar.frame(20_000, TABERNERO, true);
    hablar.frame(30_999, TABERNERO, true);
    assert.equal(saludos.length, 1, "cuatro pulsaciones dentro de la espera son un solo interact_entity");
  });

  it("la acción se sigue OFRECIENDO durante la espera: no desaparece el botón", () => {
    const { hablar } = banco();
    hablar.frame(1000, TABERNERO, true);
    assert.deepEqual(hablar.frame(1001, TABERNERO, true), {
      id: "interact",
      label: "hablar con Tabernero corpulento",
      key: "E",
    });
  });

  it("en cuanto contestan, la E vuelve a saludar en el MISMO frame", () => {
    const { hablar, saludos } = banco();
    hablar.frame(1000, TABERNERO, true);
    hablar.yaContestaron();
    hablar.frame(1001, TABERNERO, true);
    assert.equal(saludos.length, 2);
  });

  it("a los 30 s exactos la E vuelve a funcionar aunque nadie haya contestado", () => {
    // El tope: si el motor no contesta, la tecla no se queda muerta el resto de
    // la partida. Los 30.000 ms se afirman EN LOS DOS LADOS del borde.
    const { hablar, saludos } = banco();
    hablar.frame(1000, TABERNERO, true);
    hablar.frame(30_999, TABERNERO, true);
    assert.equal(saludos.length, 1, "un milisegundo antes del tope sigue callado");
    hablar.frame(31_000, TABERNERO, true);
    assert.equal(saludos.length, 2, "en el tope exacto vuelve a saludar");
  });

  it("un frame sin pulsar no consume ni abre la espera", () => {
    const { hablar, saludos } = banco();
    hablar.frame(1000, TABERNERO, false);
    assert.deepEqual(saludos, [], "mirar a alguien no le saluda");
    hablar.frame(1001, TABERNERO, true);
    assert.equal(saludos.length, 1);
  });

  it("`yaContestaron` sin nada en vuelo no rompe nada", () => {
    const { hablar, saludos } = banco();
    hablar.yaContestaron();
    hablar.frame(1000, TABERNERO, true);
    assert.equal(saludos.length, 1);
  });
});

describe("HablarConUnNpc · el último hablado", () => {
  it("empieza a nulo: nadie ha hablado todavía", () => {
    assert.equal(banco().hablar.ultimoHablado, null);
  });

  it("recuerda al último SALUDADO, no al último que se tuvo delante", () => {
    // La distinción importa: el retrato de una línea sin nombre reconocible es
    // el del que habló, no el del que pasaba por ahí.
    const { hablar } = banco();
    hablar.frame(1000, TABERNERO, true);
    hablar.yaContestaron();
    hablar.frame(2000, { id: "herrero", name: "Herrera" }, false);
    assert.equal(hablar.ultimoHablado, "barkeep");
    hablar.frame(3000, { id: "herrero", name: "Herrera" }, true);
    assert.equal(hablar.ultimoHablado, "herrero");
  });

  it("la E callada por la espera no cambia al último hablado", () => {
    const { hablar } = banco();
    hablar.frame(1000, TABERNERO, true);
    hablar.frame(1001, { id: "herrero" }, true);
    assert.equal(hablar.ultimoHablado, "barkeep", "el saludo que no salió no cuenta");
  });
});
