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
  destinoDeStatus,
  type FacetSinks,
  type SessionFacets,
  type StatusRepartible,
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
});

/** #312. Un `narrative_status` de una partida MUERTA no puede tocar a la viva
 *  —con `spawn` le escribe la posición al jugador: teletransporte— y un
 *  `error` de esa misma partida muerta tiene que seguir llegando a quien
 *  juega. Las dos mitades a la vez, que es lo que hacía difícil el issue.
 *
 *  Se prueba aquí y no en el cliente porque en el cliente no hay nada que
 *  pueda ponerse rojo (`nefan-html` no tiene harness, #241). Lo que el
 *  navegador sí ejerce —que el reparto llega a tiempo y que el jugador no se
 *  mueve— es `qa/guiones/35-…`. */
describe("destinoDeStatus: a quién le habla cada narrative_status (#312)", () => {
  /** El status mínimo: solo lo que el reparto mira. */
  const status = (
    kind: StatusRepartible["kind"],
    phase: StatusRepartible["phase"],
    sessionId = "la-muerta",
  ): StatusRepartible => ({ kind, phase, sessionId });

  /** «La mía es 1787-abc». Anota A QUIÉN se le preguntó, que es la mitad del
   *  caso `game_gen`. */
  function sello(mia = "1787-abc") {
    const preguntas: string[] = [];
    return {
      preguntas,
      esMio: (id: string) => {
        preguntas.push(id);
        return id === mia;
      },
    };
  }

  it("la pre-generación de mundo va al TÍTULO, y sin preguntar el sello", () => {
    // La rama que no se puede quitar. El sello lo estampa el transporte con
    // «la sesión viva del bridge al emitir», así que tras jugar y volver al
    // título el cliente está en "" y el bridge sigue cargado: la
    // pre-generación llega SIEMPRE con sello ajeno. Filtrarla por sello deja
    // la barra de la tarjeta girando para siempre.
    const s = sello();
    for (const phase of ["generating", "progress", "ready", "error"] as const) {
      assert.equal(destinoDeStatus(status("game_gen", phase), s.esMio), "titulo");
    }
    assert.deepEqual(s.preguntas, [], "se preguntó el sello de un game_gen");
  });

  it("lo que lleva MI sello va a la partida, sea de la fase que sea", () => {
    const s = sello();
    for (const kind of ["scene", "tile", "consequences"] as const) {
      for (const phase of ["generating", "progress", "ready", "error"] as const) {
        assert.equal(destinoDeStatus(status(kind, phase, "1787-abc"), s.esMio), "juego");
      }
    }
  });

  it("un FALLO ajeno no se calla: va al canal de fallos", () => {
    const s = sello();
    for (const kind of ["scene", "tile", "consequences"] as const) {
      assert.equal(destinoDeStatus(status(kind, "error"), s.esMio), "fallo-ajeno");
    }
  });

  it("lo ajeno que NO es fallo se descarta: es el ready que teletransportaba", () => {
    const s = sello();
    for (const kind of ["scene", "tile", "consequences"] as const) {
      for (const phase of ["generating", "progress", "ready"] as const) {
        assert.equal(destinoDeStatus(status(kind, phase), s.esMio), "descartado");
      }
    }
  });

  it("sin partida aplicada, lo que el bridge difunde SIN partida es mío", () => {
    // El caso de `esMio` puesto a trabajar: con `""` aplicado, el `""` del
    // bridge es la partida de nadie y le corresponde al juego. Sin esto, el
    // reparto y `esMio` podrían discrepar sobre el mismo id.
    const { sinks } = espia();
    const s = createClientSession(sinks);
    assert.equal(destinoDeStatus(status("tile", "ready", ""), s.esMio), "juego");
    s.enter(PARTIDA);
    assert.equal(destinoDeStatus(status("tile", "ready", ""), s.esMio), "descartado");
    assert.equal(
      destinoDeStatus(status("tile", "ready", "1787-abc"), s.esMio),
      "juego",
      "la sesión aplicada es la de PARTIDA",
    );
  });
});
