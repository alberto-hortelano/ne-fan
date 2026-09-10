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
  NOMBRES_DE_SINK,
  NO_SESSION,
  createClientSession,
  porValor,
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
 *  aquí, y un sink que `apply` no llame sale en el aserto de enumeración.
 *
 *  Cada sink recibe un `Pick` de las facetas y desestructura SU campo (#316):
 *  el aplicador ya no elige qué escalar pasar, así que no puede pasar el
 *  equivocado. Lo que este doble anota sigue siendo el VALOR, para que los
 *  asertos de abajo digan lo mismo que decían. */
function espia(): { sinks: FacetSinks; llamadas: Array<[string, unknown]> } {
  const llamadas: Array<[string, unknown]> = [];
  const sinks: FacetSinks = {
    mundo: ({ sessionId }) => llamadas.push(["mundo", sessionId]),
    frontera: ({ sessionId }) => llamadas.push(["frontera", sessionId]),
    style: ({ styleId }) => llamadas.push(["style", styleId]),
    theme: ({ uiTheme }) => llamadas.push(["theme", uiTheme]),
    renderModes: ({ renderMode, characterMode }) =>
      llamadas.push(["renderModes", `${renderMode}/${characterMode}`]),
    combat: ({ combatSystem }) => llamadas.push(["combat", combatSystem]),
    history: ({ sessionId }) => llamadas.push(["history", sessionId]),
    entrada: ({ sessionId }) => llamadas.push(["entrada", sessionId]),
    dialogo: ({ sessionId }) => llamadas.push(["dialogo", sessionId]),
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
      ["mundo", "1787-abc"],
      ["frontera", "1787-abc"],
      ["style", "acuarela"],
      ["theme", TEMA],
      ["renderModes", "image/vector"],
      ["combat", "basic"],
      ["history", "1787-abc"],
      ["entrada", "1787-abc"],
      ["dialogo", "1787-abc"],
    ]);
  });

  /** Que `apply` no pueda saltarse un sink lo garantiza el TIPO
   *  (`APLICADORES` es un mapeado sobre `FacetSinks` y `apply` lo recorre), no
   *  este test: antes se enumeraba `Object.keys(sinks)` —el doble de aquí— y
   *  como `tsc` no mira `test/**`, un sink sin llamar dejaba todo verde (QA
   *  M1). Lo que se enumera ahora es la lista que exporta el MÓDULO, así que
   *  el test no puede quedarse corto sin que el módulo se quede corto también. */
  it("leave invoca TODOS los sinks, con el neutro de cada faceta", () => {
    const { sinks, llamadas } = espia();
    const s = createClientSession(sinks);
    s.enter(PARTIDA);
    llamadas.length = 0;

    s.leave();

    const invocados = new Set(llamadas.map(([nombre]) => nombre));
    for (const nombre of NOMBRES_DE_SINK) {
      assert.ok(invocados.has(nombre), `leave() no deshace el sink "${nombre}"`);
    }
    assert.equal(NOMBRES_DE_SINK.length, Object.keys(sinks).length, "el doble cubre el record");
    assert.deepEqual(llamadas, [
      ["mundo", ""],
      ["frontera", ""],
      ["style", ""],
      ["theme", BASE_UI_THEME],
      ["renderModes", "/"],
      ["combat", ""],
      ["history", ""],
      ["entrada", ""],
      ["dialogo", ""],
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
      ["mundo", "segunda"],
      ["frontera", "segunda"],
      ["style", ""],
      ["theme", BASE_UI_THEME],
      ["renderModes", "/"],
      ["combat", ""],
      ["history", "segunda"],
      ["entrada", "segunda"],
      ["dialogo", "segunda"],
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

  /** #282, segunda mitad. El mundo pintado es una faceta como las otras seis,
   *  y no una llamada que hay que acordarse de hacer: hasta esta tanda la rama
   *  `new_game` del cliente NO vaciaba el mundo (solo la de `resume`), así que
   *  un segundo intento heredaba los tiles del primero.
   *
   *  Se afirma en las DOS direcciones porque el bug era la asimetría: entrar
   *  en una partida vacía el mundo igual que salir de ella, y va PRIMERO —el
   *  atlas de superficies que arman las facetas siguientes pide el layout del
   *  tile activo, y con el mundo anterior puesto pediría la imagen de una
   *  partida que ya no está. */
  it("el mundo se vacía al ENTRAR y al SALIR, y antes que ninguna otra faceta", () => {
    const { sinks, llamadas } = espia();
    const s = createClientSession(sinks);

    s.enter(PARTIDA);
    assert.equal(llamadas[0][0], "mundo", `al entrar mandó primero ${llamadas[0][0]}`);
    llamadas.length = 0;

    s.leave();
    assert.equal(llamadas[0][0], "mundo", `al salir mandó primero ${llamadas[0][0]}`);
    llamadas.length = 0;

    // Y el caso del issue: de una partida a otra SIN pasar por el título.
    s.enter({ ...PARTIDA, sessionId: "la-segunda" });
    assert.deepEqual(llamadas[0], ["mundo", "la-segunda"]);
    assert.equal(NOMBRES_DE_SINK[0], "mundo", "el orden lo fija el record, no este test");
  });

  /** «De quién es este mensaje» se decide donde vive «cuál es la mía» (#282).
   *  El bridge difunde a TODOS los suscriptores, así que sin esta pregunta el
   *  cliente instalaba el tile de la partida que acababa de abandonar. */
  describe("esMio: el sello del bridge contra la partida aplicada aquí", () => {
    it("con partida, solo es mío lo que lleva SU id", () => {
      const { sinks } = espia();
      const s = createClientSession(sinks);
      s.enter(PARTIDA);
      assert.equal(s.esMio("1787-abc"), true);
      assert.equal(s.esMio("otra-partida"), false);
      // El caso exacto del issue: se abandonó A, el bridge sigue en A y su
      // tile llega tarde. Sin partida aplicada NADA de una partida es mío.
      s.leave();
      assert.equal(s.esMio("1787-abc"), false);
    });

    it("sin partida, lo que el bridge difunde sin partida SÍ es mío", () => {
      // `""` no es un hueco: es el bridge hablando desde el título (una
      // pre-generación de mundo, un frame rechazado). Descartarlo sería
      // silenciar al servidor en la pantalla donde el jugador está mirando.
      const { sinks } = espia();
      const s = createClientSession(sinks);
      assert.equal(s.esMio(""), true);
      s.enter(PARTIDA);
      assert.equal(s.esMio(""), false, "dentro de una partida, lo de nadie no es mío");
    });
  });

  /** `porValor`: la promesa «aplicar las mismas facetas dos veces no cambia
   *  nada» hecha código una vez, para los sinks destructivos (`mundo`,
   *  `dialogo`). Antes vivía en el cliente como dos `let` de módulo con la
   *  misma guarda escrita dos veces; aquí se prueba sin navegador. */
  describe("porValor: el sink aplica solo cuando el id de sesión CAMBIA", () => {
    function contador(): { aplicar: () => void; veces: () => number } {
      let n = 0;
      return { aplicar: () => void n++, veces: () => n };
    }

    it("el mismo id dos veces aplica UNA vez", () => {
      const c = contador();
      const sink = porValor(c.aplicar);
      sink({ sessionId: "A" });
      sink({ sessionId: "A" });
      assert.equal(c.veces(), 1);
    });

    it("de A a B aplica las dos veces", () => {
      const c = contador();
      const sink = porValor(c.aplicar);
      sink({ sessionId: "A" });
      sink({ sessionId: "B" });
      assert.equal(c.veces(), 2);
    });

    /** El arranque que falla llama a `leave()` con los neutros ya puestos: el
     *  sink arranca en el neutro y esa primera llamada NO puede disparar. */
    it("el neutro primero NO aplica (arranca en NO_SESSION)", () => {
      const c = contador();
      const sink = porValor(c.aplicar);
      sink({ sessionId: NO_SESSION.sessionId });
      assert.equal(c.veces(), 0);
      sink({ sessionId: "A" });
      assert.equal(c.veces(), 1);
    });

    /** Lo que se recuerda es el ÚLTIMO id, no el conjunto de los vistos: A, al
     *  título, y de vuelta a A son tres cambios. Un sink que no recordara el id
     *  (o que lo recordara como «ya visto») fallaría aquí. */
    it("A → título → A aplica tres veces", () => {
      const c = contador();
      const sink = porValor(c.aplicar);
      sink({ sessionId: "A" });
      sink({ sessionId: "" });
      sink({ sessionId: "A" });
      assert.equal(c.veces(), 3);
    });

    /** Cableado como en el cliente: `mundo` y `dialogo` van por `porValor` y
     *  los demás sinks siguen aplicándose SIEMPRE. `enter(P); leave(); leave()`
     *  son tres transiciones para el módulo y dos cambios de id para el sink
     *  por valor; el orden lo fija el record. */
    it("vía createClientSession: enter + leave + leave = dos aplicaciones, en el orden del record", () => {
      const { sinks, llamadas } = espia();
      const vaciados: string[] = [];
      const s = createClientSession({
        ...sinks,
        mundo: porValor(() => vaciados.push("mundo")),
        dialogo: porValor(() => vaciados.push("dialogo")),
      });
      s.enter(PARTIDA);
      s.leave();
      s.leave();
      assert.deepEqual(vaciados, ["mundo", "dialogo", "mundo", "dialogo"]);
      // Los otros seis sinks se aplicaron en las TRES transiciones: `porValor`
      // filtra el sink que envuelve, no la transición.
      assert.equal(llamadas.filter(([nombre]) => nombre === "style").length, 3);
      assert.equal(NOMBRES_DE_SINK[0], "mundo");
      assert.equal(NOMBRES_DE_SINK[NOMBRES_DE_SINK.length - 1], "dialogo");
    });
  });
});
