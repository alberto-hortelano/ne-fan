/** El candado de #249: los DOS caminos de vuelta al título dejan el cliente
 *  idéntico. No porque alguien se acuerde de resetear lo mismo en los dos,
 *  sino porque entrar y salir son la MISMA función con distinto argumento.
 *
 *  El test que importa es el que enumera: `leave()` tiene que invocar TODOS
 *  los sinks. Añadir una faceta obliga a añadir su sink (lo exige el tipo
 *  `FacetSinks` al construir el doble de abajo) y entonces este test se pone
 *  rojo hasta que `apply` lo llama — que es justo el olvido que produjo el
 *  bug: el catch del bucle del título deshacía UNA de las cinco cosas que
 *  ponía el éxito, y el gate del gasto de imagen se quedaba armado. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NO_SESSION,
  createClientSession,
  type FacetSinks,
  type SessionFacets,
} from "../src/session/session-facets.js";
import { BASE_UI_THEME, type UiTheme } from "../src/games/ui-theme.js";

const TEMA: UiTheme = { ...BASE_UI_THEME, accent: "#ff0000" };

const PARTIDA: SessionFacets = {
  sessionId: "1787-abc",
  styleId: "acuarela",
  renderMode: "image",
  characterMode: "vector",
  combatSystem: "basic",
  uiTheme: TEMA,
};

/** Doble que anota QUÉ sink se llamó y con qué. Se construye como
 *  `FacetSinks` completo a propósito: una faceta nueva sin sink no compila
 *  aquí, y un sink que `apply` no llame sale en el aserto de enumeración. */
function espia(): { sinks: FacetSinks; llamadas: Array<[string, unknown]> } {
  const llamadas: Array<[string, unknown]> = [];
  const sinks: FacetSinks = {
    style: (styleId) => llamadas.push(["style", styleId]),
    theme: (uiTheme) => llamadas.push(["theme", uiTheme]),
    renderModes: (renderMode, characterMode) =>
      llamadas.push(["renderModes", `${renderMode}/${characterMode}`]),
    combat: (combatSystem) => llamadas.push(["combat", combatSystem]),
    history: (sessionId) => llamadas.push(["history", sessionId]),
  };
  return { sinks, llamadas };
}

describe("sesión del cliente: entrar y salir por el mismo camino", () => {
  it("sin partida es un VALOR, no la ausencia de uno", () => {
    const { sinks } = espia();
    const s = createClientSession(sinks);
    assert.equal(s.active, false);
    assert.equal(s.id, "");
    assert.deepEqual(s.facets, NO_SESSION);
  });

  it("enter aplica las facetas de la partida a todos los sinks", () => {
    const { sinks, llamadas } = espia();
    const s = createClientSession(sinks);
    s.enter(PARTIDA);
    assert.equal(s.active, true);
    assert.equal(s.id, "1787-abc");
    assert.deepEqual(s.facets, PARTIDA);
    assert.deepEqual(llamadas, [
      ["style", "acuarela"],
      ["theme", TEMA],
      ["renderModes", "image/vector"],
      ["combat", "basic"],
      ["history", "1787-abc"],
    ]);
  });

  /** EL candado. Se enumeran las claves del record de sinks, así que no hay
   *  lista que mantener a mano: el día que aparezca una faceta nueva, su sink
   *  entra en `FacetSinks` (o no compila) y aquí se exige que `leave()` lo
   *  llame igual que `enter()`. */
  it("leave invoca TODOS los sinks, con el neutro de cada faceta", () => {
    const { sinks, llamadas } = espia();
    const s = createClientSession(sinks);
    s.enter(PARTIDA);
    llamadas.length = 0;

    s.leave();

    const invocados = new Set(llamadas.map(([nombre]) => nombre));
    for (const nombre of Object.keys(sinks)) {
      assert.ok(invocados.has(nombre), `leave() no deshace el sink "${nombre}"`);
    }
    assert.deepEqual(llamadas, [
      ["style", ""],
      ["theme", BASE_UI_THEME],
      ["renderModes", "/"],
      ["combat", ""],
      ["history", ""],
    ]);
    assert.equal(s.active, false, "el gate del gasto de imagen queda desarmado");
    assert.deepEqual(s.facets, NO_SESSION);
  });

  /** Los dos caminos de vuelta al título del cliente (`volverAlTitulo` y el
   *  catch del bucle) llaman los dos a `leave()`; el bug era que uno de ellos
   *  deshacía menos. Aquí se ejerce el caso peor: un fallo TARDÍO, con la
   *  sesión ya aplicada entera. */
  it("volver al título deja el mismo cliente venga de donde venga", () => {
    const a = espia();
    const primera = createClientSession(a.sinks);
    primera.enter(PARTIDA);
    primera.leave();

    const b = espia();
    const segunda = createClientSession(b.sinks);
    // Otra partida, otro estilo, otro tema: da igual de dónde se vuelva.
    segunda.enter({ ...PARTIDA, sessionId: "otra", styleId: "acero_neon", uiTheme: BASE_UI_THEME });
    segunda.leave();

    assert.deepEqual(primera.facets, segunda.facets);
    assert.deepEqual(primera.facets, NO_SESSION);
  });

  it("entrar en otra partida no arrastra facetas de la anterior", () => {
    const { sinks, llamadas } = espia();
    const s = createClientSession(sinks);
    s.enter(PARTIDA);
    llamadas.length = 0;
    s.enter({ ...NO_SESSION, sessionId: "segunda" });
    assert.deepEqual(s.facets, { ...NO_SESSION, sessionId: "segunda" });
    assert.deepEqual(llamadas, [
      ["style", ""],
      ["theme", BASE_UI_THEME],
      ["renderModes", "/"],
      ["combat", ""],
      ["history", "segunda"],
    ]);
  });

  it("las facetas que se leen de vuelta son una COPIA (nadie las muta por detrás)", () => {
    const { sinks } = espia();
    const s = createClientSession(sinks);
    s.enter(PARTIDA);
    const leidas = s.facets;
    leidas.styleId = "otro";
    assert.equal(s.facets.styleId, "acuarela");
  });
});
