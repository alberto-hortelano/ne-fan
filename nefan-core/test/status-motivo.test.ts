/** El MOTIVO en cristiano: lo que quien juega lee DEBAJO del titular.
 *
 *  Cuatro traductores de excepción → frase, uno por canal, más la etiqueta de
 *  una fixture del selector «Room». Lo que se comprueba no es la redacción: es
 *  que cada causa REAL —las excepciones están copiadas de donde se lanzan—
 *  cae en su rama y no en el genérico, porque el consejo cambia según la causa
 *  y un «inténtalo de nuevo» sobre un fichero que falta no funciona nunca.
 *
 *  La otra mitad del fichero que este era hasta el 2026-09-04 —el TITULAR y el
 *  destino del aviso— está en `status-rotulo.test.ts`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FALLO_HOJAS_BASE,
  etiquetaDeFixture,
  motivoDeFixtureParaElJugador,
  motivoDeReaccionParaElJugador,
  motivoDeSesionParaElJugador,
  motivoParaElJugador,
} from "../src/protocol/status-motivo.js";

describe("motivoParaElJugador: el cuerpo de un fallo de generación", () => {
  /** Excepciones REALES de este camino, copiadas de donde se lanzan. */
  const CRUDOS = [
    "fetch failed",
    "request to http://127.0.0.1:8765/generate_scene failed, reason: connect ECONNREFUSED 127.0.0.1:8765",
    "socket hang up",
    "El tile (2, 0) no es jugable: el camino del borde oeste no continúa",
    "el anclaje de Robledo no da punto de aparición",
    "No se pudo generar el tile (1, 0). Revisa el motor narrativo.",
  ];

  it("ningún motivo devuelve la excepción cruda", () => {
    // El criterio de #180: el jugador nunca lee una excepción. Si alguien
    // devuelve `raw` en cualquier rama, esto se pone rojo.
    for (const raw of CRUDOS) {
      const motivo = motivoParaElJugador(new Error(raw));
      assert.ok(!motivo.includes(raw), `«${raw}» llegó entero al jugador: ${motivo}`);
      assert.ok(!/fetch|ECONNREFUSED|socket|http:\/\//i.test(motivo), motivo);
      assert.match(motivo, /^El motor narrativo|^No hay sitio/, motivo);
    }
  });

  it("el motor caído, el terreno inservible y el sitio ocupado se distinguen", () => {
    // Tres causas, tres frases: colapsarlas en una sola dejaría al jugador sin
    // saber si reintentar sirve de algo.
    const caido = motivoParaElJugador(new Error("fetch failed"));
    const inservible = motivoParaElJugador(new Error("El tile (2, 0) no es jugable: …"));
    const sinSitio = motivoParaElJugador(new Error("el anclaje de Robledo no da punto de aparición"));
    const generico = motivoParaElJugador(new Error("algo raro"));
    assert.equal(new Set([caido, inservible, sinSitio, generico]).size, 4);
    assert.match(caido, /no responde/);
    assert.match(inservible, /terreno inservible/);
    assert.match(sinSitio, /No hay sitio libre/);
  });

  it("aguanta un rechazo que no es Error (el motor puede rechazar con un string)", () => {
    assert.equal(
      motivoParaElJugador("fetch failed"),
      "El motor narrativo no responde; inténtalo de nuevo en un momento.",
    );
  });

  it("un rechazo VACÍO no revienta la vía de error", () => {
    // `generateScene` puede rechazar con `undefined` (un `throw` sin valor, un
    // await sobre una promesa rechazada sin motivo). Si esto lanzara, la
    // excepción saldría DENTRO del catch que existe para contarla y el jugador
    // se quedaría sin mensaje ninguno: el fail-loud reventando en su propio
    // canal es el peor sitio.
    assert.equal(
      motivoParaElJugador(undefined),
      "El motor narrativo no pudo construirlo; inténtalo de nuevo.",
    );
    assert.equal(
      motivoParaElJugador(null),
      "El motor narrativo no pudo construirlo; inténtalo de nuevo.",
    );
  });
});

/** #352 / QA H-3 — el cuarto canal, y el último que quedaba en inglés.
 *
 *  El bridge pintaba `Narrative engine error: <crudo>` a pantalla completa
 *  bajo un titular que sí era cierto. Se afirman las frases LITERALES y no un
 *  «son distintas»: el módulo está en mutación a `break: 100`, así que cada
 *  literal nuevo necesita quien lo mate. */
describe("motivoDeReaccionParaElJugador: el cuerpo de una reacción que falló", () => {
  it("el motor que no contesta se distingue del que contesta algo que no vale", () => {
    // La distinción existe porque el CONSEJO cambia: con el motor caído,
    // reintentar puede funcionar; con una reacción rechazada, repetir lo mismo
    // vuelve a fallar y lo que hay que hacer es decir otra cosa. Colapsarlas
    // sería mandar al jugador a un bucle.
    assert.equal(
      motivoDeReaccionParaElJugador(new Error("fetch failed")),
      "El motor narrativo no responde; inténtalo de nuevo en un momento.",
    );
    assert.equal(
      motivoDeReaccionParaElJugador(new Error("HTTP 422: consequence inválida")),
      "El motor narrativo no pudo reaccionar a eso; prueba a decir otra cosa.",
    );
  });

  it("las cuatro formas REALES de que el motor no conteste caen en la misma frase", () => {
    // Copiadas de donde se lanzan (`ai-client.ts` y el fetch de node): sin la
    // alternancia entera, un `socket hang up` caería en «no pudo reaccionar» y
    // el jugador leería que dijo algo malo cuando lo que pasa es que el motor
    // está caído.
    for (const raw of [
      "fetch failed",
      "request to http://127.0.0.1:8765/report_player_choice failed, reason: connect ECONNREFUSED 127.0.0.1:8765",
      "socket hang up",
      "Narrative engine timeout after 60000ms",
      "the request timed out",
    ]) {
      assert.equal(
        motivoDeReaccionParaElJugador(new Error(raw)),
        "El motor narrativo no responde; inténtalo de nuevo en un momento.",
        raw,
      );
    }
  });

  it("ninguna frase enseña el volcado, ni el código, ni inglés", () => {
    // El defecto entero de H-3: `Narrative engine error: <crudo>` a pantalla
    // completa. Si alguien devuelve `raw` en cualquier rama, esto se pone rojo.
    for (const raw of ["fetch failed", "HTTP 422 Unprocessable Entity", "Narrative engine error"]) {
      const motivo = motivoDeReaccionParaElJugador(new Error(raw));
      assert.ok(!motivo.includes(raw), `«${raw}» llegó entero al jugador: ${motivo}`);
      assert.doesNotMatch(motivo, /Narrative|engine|error:|HTTP|fetch/i, motivo);
      assert.match(motivo, /^El motor narrativo/, motivo);
    }
  });

  it("un rechazo que no es Error se lee igual (la promesa puede rechazar con un string)", () => {
    // `?? String(err)` y `&& String(err)` se confunden aquí, y la diferencia es
    // observable: con `&&`, un rechazo-string dejaría de reconocerse y el motor
    // caído se leería como una reacción rechazada.
    assert.equal(
      motivoDeReaccionParaElJugador("fetch failed"),
      "El motor narrativo no responde; inténtalo de nuevo en un momento.",
    );
  });

  it("un rechazo VACÍO no revienta la vía de error", () => {
    // El fail-loud reventando dentro de su propio canal es el peor sitio: el
    // jugador se quedaría sin mensaje ninguno.
    for (const vacio of [undefined, null]) {
      assert.equal(
        motivoDeReaccionParaElJugador(vacio),
        "El motor narrativo no pudo reaccionar a eso; prueba a decir otra cosa.",
      );
    }
  });
});

describe("motivoDeSesionParaElJugador: el cuerpo de un fallo de sesión", () => {
  /** Los códigos REALES que el bridge y el cliente ponen en `#ts-error`,
   *  copiados de `bridge/handlers/session.ts`, `bridge-client.ts` y
   *  `title-screen.ts`. El de `game_load_failed` es el que llevaba dentro la
   *  ruta absoluta del disco de quien juega (QA §3.4). */
  const CRUDOS = [
    "session_not_found",
    // El resume de un save que existe pero no vale (#334/#336): versión vieja
    // o escena que viola el contrato. Copiado verbatim de handleResumeSession.
    'save_invalido: save "1756640000-abc123" incompatible: schema_version 3 ≠ 5 — pre-producción, sin migraciones (#336): bórralo o empieza partida nueva',
    "game_load_failed: game.json malformed (/home/al/code/ne-fan/nefan-core/data/games/alta_fantasia/game.json): Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    "plugin_integrity: el plugin comercio no está en data/games/alta_fantasia/plugins",
    'combat_system_unknown: "duelo" (esperaba basic|standard)',
    'npc_behavior_unknown: "ronda" (esperaba basic)',
    "Bridge not connected",
    "Bridge request timeout: list_games",
    "no games available in bridge — check nefan-core/data/games/",
    "games_dir_unreadable: games directory not found: /home/al/code/ne-fan/nefan-core/data/games",
    // El ÚNICO que no viene del bridge: lo lanza el cliente al no poder vestir
    // al jugador. Copiado verbatim de lo que compone `preloadBase`
    // (nefan-html/src/renderer/character-sprites.ts) en un clon limpio.
    `${FALLO_HOJAS_BASE}: faltan 10 de 10 hojas (idle, walk, run, quick, heavy, medium, defensive, precise, hit_react, death) — Error: HTTP 404 on /sprites/y_bot/idle/frontal_8/meta.json`,
    // El save con un record del ledger sin `data.name` (#397): el motivo trae
    // a QUIÉN le falta, entre guiones, en palabras del jugador. Copiado verbatim
    // de `loadSession`. Va el último para no mover los índices de arriba.
    'save_invalido: save "1756640000-abc123": entities["narr_npc_1788436407_0_2"].data.name falta — «posadera de manos grandes y delantal remendado» no tiene nombre — pre-producción, sin migraciones (#336): bórralo o empieza partida nueva',
  ];

  it("ninguno enseña el código, la ruta del disco ni el volcado", () => {
    for (const raw of CRUDOS) {
      const motivo = motivoDeSesionParaElJugador(new Error(raw));
      assert.ok(!motivo.includes(raw), `«${raw}» llegó entero al jugador: ${motivo}`);
      assert.ok(!/_|\/home\/|Bridge |JSON|\.json/.test(motivo), `jerga en «${motivo}» (de ${raw})`);
      assert.match(motivo, /\.$/, `«${motivo}» no es una frase`);
    }
  });

  /** Cada código con la frase EXACTA que le toca. La tabla y no un «son
   *  distintos entre sí»: con solo contar frases distintas, borrar una rama
   *  entera y dejar que caiga al motivo genérico sigue dando el mismo número
   *  —lo dijo la mutación, con seis supervivientes— y el jugador leería «no se
   *  pudo completarlo» donde el juego sabe exactamente qué ha pasado. */
  const ESPERADO: Array<[string, string]> = [
    ["session_not_found", "Esa partida guardada ya no está en el disco."],
    // La mitad visible de la decisión «fallo ruidoso» (#334/#336): el save no
    // vale y reintentar no puede salir bien NUNCA — la frase da la única
    // salida real (borrar o empezar de nuevo), como pide la doctrina del
    // guion 27 (un fallo permanente no se disfraza de hipo del servidor).
    ["save_invalido", "Esa partida guardada ya no vale para esta versión del juego: bórrala o empieza una nueva."],
    ["game_load_failed", "Los datos de ese mundo están dañados y no se pueden leer."],
    ["plugin_integrity", "Los añadidos de ese mundo no casan con la partida guardada."],
    ["combat_system_unknown", "Ese mundo usa un sistema que esta versión del juego no conoce."],
    ["npc_behavior_unknown", "Ese mundo usa un sistema que esta versión del juego no conoce."],
    ["Bridge not connected", "Se ha perdido la conexión con el servidor del juego."],
    ["Bridge request timeout", "El servidor del juego no contesta; inténtalo de nuevo."],
    ["no games available", "No hay ningún mundo instalado."],
    // Instalación ROTA, no vacía: son causas distintas y la frase también.
    ["games_dir_unreadable", "Falta la carpeta de mundos del juego: la instalación está incompleta."],
    // Ni el servidor ni la partida: la INSTALACIÓN de quien juega. Es el único
    // motivo que nombra un remedio, porque es el único que quien lo lee puede
    // ejecutar (#255 p2). Antes caía en el genérico: «el servidor no pudo
    // completarlo; inténtalo de nuevo», que además de falso mandaba a repetir
    // lo que no puede salir bien mientras falten los ficheros.
    [
      FALLO_HOJAS_BASE,
      "Faltan las hojas de sprites del personaje, que no viajan en el repositorio: " +
        "genéralas con sprite-forge siguiendo docs/assets-de-personaje.md.",
    ],
    // …y cuando el motivo del save inválido dice a quién le falta el nombre,
    // se le dice a quien juega por su descripción, nunca por el id de máquina
    // (#397, QA H3). El molde («bórrala o empieza una nueva») no cambia.
    [
      "save_invalido (record sin nombre)",
      "Esa partida guardada ya no vale para esta versión del juego («posadera de manos grandes y delantal remendado» no tiene nombre): bórrala o empieza una nueva.",
    ],
  ];

  it("cada código del bridge tiene SU frase, no una genérica que valga para todo", () => {
    for (const [i, [, frase]] of ESPERADO.entries()) {
      assert.equal(motivoDeSesionParaElJugador(new Error(CRUDOS[i])), frase, CRUDOS[i]);
    }
  });

  it("un rechazo que no es Error se lee igual (el bridge puede rechazar con un string)", () => {
    // `request()` de `bridge-client.ts` rechaza con Error, pero `paso()` recibe
    // `unknown` y una promesa puede rechazar con cualquier cosa. Sin esto, leer
    // el código de un rechazo-string dejaría de funcionar sin que nadie lo
    // notara (la mutación lo dijo: `?? String(err)` por `&& String(err)` pasaba).
    assert.equal(
      motivoDeSesionParaElJugador("session_not_found"),
      "Esa partida guardada ya no está en el disco.",
    );
  });

  it("un rechazo VACÍO no revienta la vía de error", () => {
    assert.equal(
      motivoDeSesionParaElJugador(undefined),
      "El servidor del juego no pudo completarlo; inténtalo de nuevo.",
    );
    assert.equal(
      motivoDeSesionParaElJugador(null),
      "El servidor del juego no pudo completarlo; inténtalo de nuevo.",
    );
  });

  it("los motivos que el jugador puede ACCIONAR se distinguen entre sí", () => {
    // Un save que ya no está, uno que existe pero no vale, un mundo roto,
    // unos añadidos que no casan, un servidor caído, uno que no contesta y
    // una instalación sin mundos piden cosas distintas de quien juega:
    // colapsarlos en «no se pudo» sería no decir nada. Los DOS que sí
    // comparten frase son a propósito (`combat_system_unknown` y
    // `npc_behavior_unknown`): para el jugador son el mismo hecho —el mundo
    // pide algo que su juego no trae— y distinguirlos solo nombraría un
    // subsistema que no conoce. 12 códigos → 11 frases (el save inválido con
    // un record sin nombre es OTRA frase: nombra a quién le falta, #397).
    const distintos = CRUDOS.map((raw) => motivoDeSesionParaElJugador(new Error(raw)));
    assert.equal(new Set(distintos).size, 11, JSON.stringify(distintos));
    assert.equal(distintos[4], distintos[5], "combate y NPCs comparten frase a propósito");
    assert.match(distintos[0], /ya no está/);
    assert.match(distintos[1], /bórrala o empieza una nueva/, "el save inválido nombra su única salida");
    assert.match(distintos[2], /dañados/);
    assert.match(distintos[6], /conexión/);
    assert.match(distintos[7], /no contesta/);
  });

  it("el clon sin hojas NO se confunde con un servidor con hipo, y el consejo se puede seguir", () => {
    // Los dos lados de H1: lo que la frase tiene que decir y lo que NO puede
    // decir. El «no» importa tanto como el «sí» — el motivo genérico manda
    // reintentar, y reintentar sin generar las hojas falla siempre igual, así
    // que el jugador se queda en un bucle con una partida basura por vuelta.
    const motivo = motivoDeSesionParaElJugador(
      new Error(`${FALLO_HOJAS_BASE}: faltan 10 de 10 hojas (idle, walk) — Error: HTTP 404 on /sprites/y_bot/idle/frontal_8/meta.json`),
    );
    assert.match(motivo, /hojas de sprites del personaje/);
    assert.match(motivo, /docs\/assets-de-personaje\.md/);
    assert.doesNotMatch(motivo, /inténtalo de nuevo/);
    assert.doesNotMatch(motivo, /servidor/);
    // Y el crudo no se cuela: ni el código, ni la ruta del fichero que faltó.
    assert.doesNotMatch(motivo, /character_sheets_missing|HTTP 404|\/sprites\//);
  });

  it("el código viaja en un solo sitio: el que lo lanza importa la misma constante", () => {
    // El cliente compone el mensaje con `FALLO_HOJAS_BASE` importado de aquí
    // (character-sprites.ts). Este test no puede importar el cliente, pero sí
    // fijar que la constante es la que ambos usan: si alguien la cambia por un
    // literal distinto en un lado, la traducción deja de reconocerlo y el
    // jugador vuelve al motivo genérico sin que nada se ponga rojo.
    assert.equal(FALLO_HOJAS_BASE, "character_sheets_missing");
    assert.notEqual(
      motivoDeSesionParaElJugador(new Error("faltan 10 de 10 hojas — HTTP 404")),
      motivoDeSesionParaElJugador(new Error(`${FALLO_HOJAS_BASE}: faltan 10 de 10 hojas — HTTP 404`)),
      "sin el código, el mismo texto tiene que caer en el genérico: la identidad la da el código, no la prosa",
    );
  });

  it("un fallo que nadie previó sigue siendo una frase, no un volcado", () => {
    const motivo = motivoDeSesionParaElJugador(new Error("EPIPE write"));
    assert.equal(motivo, "El servidor del juego no pudo completarlo; inténtalo de nuevo.");
  });
});


/** #269: el desplegable de fixtures y el mensaje de «no cargó» salen de LA
 *  MISMA derivación. Antes eran dos —un `match()` al pintar la opción y una
 *  interpolación del `value` al fallar— y decían cosas distintas: la persona
 *  eligió «zorder_test» y leía «no se pudo cargar la fixture
 *  @nefan-core/data/scenes/zorder_test.json». */
describe("la etiqueta de una fixture del selector «Room»", () => {
  it("es lo que la persona eligió, no la clave del glob", () => {
    assert.equal(
      etiquetaDeFixture("@nefan-core/data/scenes/zorder_test.json"),
      "zorder_test",
    );
  });

  it("una clave que ya es la etiqueta se devuelve tal cual", () => {
    // El desplegable no tiene hoy opciones así, pero el mensaje de fallo se
    // compone con lo que haya: sin esta rama, cambiar la forma del glob
    // dejaría al jugador leyendo un trozo de ruta.
    assert.equal(etiquetaDeFixture("zorder_test"), "zorder_test");
  });

  it("una clave sin nada tampoco inventa un nombre", () => {
    assert.equal(etiquetaDeFixture(""), "");
  });

  it("una ruta sin barras pierde la extensión igual", () => {
    assert.equal(etiquetaDeFixture("robledo_tile.json"), "robledo_tile");
  });

  it("la clave REAL del glob de Vite también", () => {
    // Medido en el navegador el 2026-08-28: el `import.meta.glob` del cliente
    // entrega la clave relativa, no el alias. Los issues la citan como
    // `@nefan-core/…` y no es lo que se ve; la función no depende de cuál sea,
    // pero el test tiene que ejercer la de verdad.
    assert.equal(
      etiquetaDeFixture("../nefan-core/data/scenes/zorder_test.json"),
      "zorder_test",
    );
  });

  it("el motivo NOMBRA la etiqueta y no lleva ni ruta ni extensión", () => {
    const motivo = motivoDeFixtureParaElJugador(
      etiquetaDeFixture("@nefan-core/data/scenes/zorder_test.json"),
    );
    assert.equal(motivo, "No se pudo cargar la escena «zorder_test»");
    // Lo que el guion 24 mide en pantalla, aquí sin navegador: la ruta del
    // glob no puede colarse en lo que lee quien juega.
    assert.doesNotMatch(motivo, /\.json|@nefan-core|scenes\//);
  });
});
