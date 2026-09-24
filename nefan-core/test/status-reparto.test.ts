/** A quién le habla cada `narrative_status` (#312, #313).
 *
 *  Batería propia porque `status-reparto.ts` es un módulo propio: repartir y
 *  rotular son dos decisiones distintas sobre el mismo mensaje, y
 *  `mutation-targets.json` ata cada fichero mutado a SU batería — con los dos
 *  tests en el mismo fichero, los mutantes de uno pagarían la suite del otro.
 *
 *  Lo que se prueba: un `narrative_status` de una partida MUERTA no puede tocar
 *  a la viva —con `spawn` le escribe la posición al jugador: teletransporte— y
 *  un `error` de esa misma partida muerta tiene que seguir llegando a quien
 *  juega. Las dos mitades a la vez, que es lo que hacía difícil el issue.
 *
 *  Se prueba aquí y no en el cliente porque en el cliente no hay nada que pueda
 *  ponerse rojo (`nefan-html` no tiene harness, #241). Lo que el navegador sí
 *  ejerce —que el reparto llega a tiempo, que el jugador no se mueve y que el
 *  progreso del mundo A no se pinta en la tarjeta del juego B— son
 *  `qa/guiones/35-…` y `qa/guiones/38-…`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { repartirStatus, esperasQueTermina, deQuienEs, elReadyQuitaElMuro } from "../src/protocol/status-reparto.js";
import type { MuroEnPantalla } from "../src/protocol/status-reparto.js";
import type {
  NarrativeStatusDeJuego,
  NarrativeStatusDeSesion,
} from "../src/protocol/messages.js";

describe("repartirStatus: a quién le habla cada narrative_status (#312, #313)", () => {
  /** El status de una PARTIDA. Es el mensaje del wire ENTERO y no un `Pick`
   *  a mano: desde #313 el reparto devuelve el mensaje ya estrechado, así que
   *  lo que entra tiene que ser lo que de verdad viaja. */
  const dePartida = (
    phase: NarrativeStatusDeSesion["phase"],
    sessionId = "la-muerta",
  ): NarrativeStatusDeSesion => ({ type: "narrative_status", kind: "tile", phase, sessionId });

  /** El status de un JUEGO (pre-generación de mundo). Ya no se puede construir
   *  con `kind:"game_gen"` y un sello: son mensajes distintos, y esa
   *  imposibilidad ES el arreglo de #313. */
  const deJuego = (
    phase: NarrativeStatusDeJuego["phase"],
    gameId = "alta_fantasia",
  ): NarrativeStatusDeJuego => ({ type: "narrative_status", kind: "game_gen", phase, gameId });

  /** «La mía es 1787-abc». Anota A QUIÉN se le preguntó, que es la mitad del
   *  caso de la pre-generación. */
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

  it("la pre-generación de mundo va al TÍTULO, y no hay sello que preguntar", () => {
    // La rama que antes era una EXCEPCIÓN POR KIND («si es game_gen, al título,
    // sin mirar el sello») porque el sello de una pre-generación era basura: lo
    // estampaba el transporte con «la sesión viva del bridge al emitir», así que
    // tras jugar y volver al título llegaba SIEMPRE con sello ajeno y filtrarlo
    // dejaba la barra de la tarjeta girando para siempre. Desde #313 el mensaje
    // se direcciona por `gameId` y no trae sello: el aserto de abajo dice algo
    // más fuerte que antes — no es que no se pregunte, es que no hay qué.
    const s = sello();
    for (const phase of ["generating", "progress", "ready", "error"] as const) {
      assert.equal(repartirStatus(deJuego(phase), s.esMio).destino, "titulo");
    }
    assert.deepEqual(s.preguntas, [], "se preguntó el sello de una pre-generación");
  });

  it("lo que lleva MI sello va a la partida, sea de la fase que sea", () => {
    const s = sello();
    for (const phase of ["generating", "progress", "ready", "error"] as const) {
      assert.equal(repartirStatus(dePartida(phase, "1787-abc"), s.esMio).destino, "juego");
    }
  });

  it("un FALLO ajeno no se calla: va al canal de fallos", () => {
    const s = sello();
    assert.equal(repartirStatus(dePartida("error"), s.esMio).destino, "fallo-ajeno");
  });

  it("lo ajeno que NO es fallo se descarta: es el ready que teletransportaba", () => {
    const s = sello();
    for (const phase of ["generating", "progress", "ready"] as const) {
      assert.equal(repartirStatus(dePartida(phase), s.esMio).destino, "descartado");
    }
  });

  it("el sello VACÍO no es un hueco: es la partida de nadie, y depende de quién pregunte", () => {
    // `""` es un sello legítimo —el bridge hablando sin partida cargada— y el
    // reparto no lo trata aparte: se lo pasa a `esMio` como cualquier otro. Sin
    // partida aplicada le corresponde al juego; con una partida en marcha, no.
    //
    // La otra mitad —que `esMio` conteste eso— es de `session-facets.ts` y la
    // afirma su propio test ("sin partida, lo que el bridge difunde sin partida
    // SÍ es mío"). Aquí no se importa aquel módulo A PROPÓSITO: `mutation-targets.json`
    // ata cada fichero mutado a SU batería, y arrastrarlo haría que los mutantes
    // de las facetas pagaran también esta suite.
    const sinPartida = sello("");
    assert.equal(repartirStatus(dePartida("ready", ""), sinPartida.esMio).destino, "juego");
    const enPartida = sello("1787-abc");
    assert.equal(repartirStatus(dePartida("ready", ""), enPartida.esMio).destino, "descartado");
    assert.equal(repartirStatus(dePartida("ready", "1787-abc"), enPartida.esMio).destino, "juego");
  });
});


describe("cada fallo termina solo su espera (#593)", () => {
  it("los avisos ajenos conservan viaje y saludo pendientes", () => {
    for (const kind of ["combatientes", "plugin", "save", "restore", "action", "protocolo"] as const) {
      // Ni con el placeId del viaje: su kind no habla de llegar a ningún sitio.
      assert.deepEqual(esperasQueTermina({ kind, phase: "error", placeId: "forja" }, "forja"), { viaje: null, saludo: false });
    }
  });
  it("un viaje fallido no responde al saludo y una reacción fallida no cierra el viaje", () => {
    for (const kind of ["tile", "scene"] as const) {
      assert.deepEqual(esperasQueTermina({ kind, phase: "error", placeId: "forja" }, "forja"), { viaje: "fallo", saludo: false });
    }
    assert.deepEqual(esperasQueTermina({ kind: "consequences", phase: "error", placeId: "forja" }, "forja"), { viaje: null, saludo: true });
  });
  it("el takeover cierra el viaje abierto aunque no lleve placeId: no habla de un lugar", () => {
    assert.deepEqual(esperasQueTermina({ kind: "takeover", phase: "error" }, "forja"), { viaje: "fallo", saludo: true });
  });
  it("el progreso y la preparación no terminan ninguna espera", () => {
    for (const phase of ["progress", "generating"] as const) {
      for (const kind of ["tile", "scene", "consequences", "takeover"] as const) {
        assert.deepEqual(esperasQueTermina({ kind, phase, placeId: "forja" }, "forja"), { viaje: null, saludo: false });
      }
    }
  });
});

describe("un fallo cierra el viaje solo si es SUYO (#737)", () => {
  it("deQuienEs: sin viaje, del viaje, o ajeno — y lo que llega sin placeId es ajeno", () => {
    assert.equal(deQuienEs({ placeId: "forja" }, null), "sin-viaje");
    assert.equal(deQuienEs({}, null), "sin-viaje");
    assert.equal(deQuienEs({ placeId: "forja" }, "forja"), "del-viaje");
    assert.equal(deQuienEs({ placeId: "molino" }, "forja"), "ajeno-al-viaje");
    // El caso que #737 describe: el error de un tile vecino no trae placeId.
    assert.equal(deQuienEs({}, "forja"), "ajeno-al-viaje");
  });
  it("con viaje abierto, un tile o una escena de OTRO lugar, o sin lugar, no lo cierran", () => {
    for (const kind of ["tile", "scene"] as const) {
      assert.deepEqual(esperasQueTermina({ kind, phase: "error" }, "forja"), { viaje: null, saludo: false }, `${kind} sin placeId`);
      assert.deepEqual(esperasQueTermina({ kind, phase: "error", placeId: "molino" }, "forja"), { viaje: null, saludo: false }, `${kind} ajeno`);
    }
  });
  it("sin viaje abierto no hay viaje que cerrar, lleve el placeId que lleve", () => {
    for (const kind of ["tile", "scene"] as const) {
      assert.deepEqual(esperasQueTermina({ kind, phase: "error", placeId: "forja" }, null), { viaje: null, saludo: false });
      assert.deepEqual(esperasQueTermina({ kind, phase: "error" }, null), { viaje: null, saludo: false });
    }
  });
});

describe("un ready cierra el viaje solo si es SUYO (#742)", () => {
  // Hasta #742 core solo decidía el FALLO: la llegada la decidía el ledger del
  // cliente con cualquier `spawn`, y el muro lo quitaba cualquier `ready`. Un
  // prefetch que aterrizaba a mitad de viaje soltaba al jugador.
  it("el ready de tile con el placeId del viaje abierto es su LLEGADA, con spawn o sin él (sin ancla)", () => {
    assert.deepEqual(esperasQueTermina({ kind: "tile", phase: "ready", placeId: "forja" }, "forja"), { viaje: "llegada", saludo: false });
  });
  it("un ready ajeno —otro lugar, o sin placeId: el prefetch, el request_tile— no termina nada", () => {
    assert.deepEqual(esperasQueTermina({ kind: "tile", phase: "ready", placeId: "molino" }, "forja"), { viaje: null, saludo: false });
    assert.deepEqual(esperasQueTermina({ kind: "tile", phase: "ready" }, "forja"), { viaje: null, saludo: false });
  });
  it("sin viaje abierto no hay llegada que dar, lleve el placeId que lleve", () => {
    assert.deepEqual(esperasQueTermina({ kind: "tile", phase: "ready", placeId: "forja" }, null), { viaje: null, saludo: false });
    assert.deepEqual(esperasQueTermina({ kind: "tile", phase: "ready" }, null), { viaje: null, saludo: false });
  });
  it("el ready de un plugin no es la llegada de ningún viaje, aunque traiga el placeId", () => {
    assert.deepEqual(esperasQueTermina({ kind: "plugin", phase: "ready", placeId: "forja" }, "forja"), { viaje: null, saludo: false });
  });
  it("un ready no contesta al saludo: el saludo solo lo cierra el narrative_event o su fallo", () => {
    for (const kind of ["tile", "plugin"] as const) {
      assert.equal(esperasQueTermina({ kind, phase: "ready", placeId: "forja" }, "forja").saludo, false, kind);
    }
  });
});

describe("elReadyQuitaElMuro: las 3×3 de viaje × muro (#742)", () => {
  const delViaje = { kind: "tile", phase: "ready", placeId: "forja" } as const;
  const ajeno = { kind: "tile", phase: "ready" } as const;
  /** Fila: qué viaje hay y de quién es el `ready`. Columna: qué muro hay. */
  const TABLA: Array<[string, typeof delViaje | typeof ajeno, string | null, Record<MuroEnPantalla, boolean>]> = [
    // El del viaje quita SU espera, nunca un aviso.
    ["del viaje", delViaje, "forja", { espera: true, aviso: false, nada: false }],
    // El ajeno no quita el «Viajando...» ni un aviso: es el bug de #742.
    ["ajeno", ajeno, "forja", { espera: false, aviso: false, nada: false }],
    // Sin viaje, la espera es el arranque y el primer tile la quita; el aviso, no.
    ["sin viaje", ajeno, null, { espera: true, aviso: false, nada: false }],
  ];
  for (const [fila, status, viajeAbierto, esperado] of TABLA) {
    for (const muro of ["espera", "aviso", "nada"] as const) {
      it(`${fila} · muro «${muro}» → ${esperado[muro] ? "lo quita" : "no lo toca"}`, () => {
        assert.equal(elReadyQuitaElMuro(status, { viajeAbierto, muro }), esperado[muro]);
      });
    }
  }
  it("un ready de OTRO lugar con placeId tampoco quita el «Viajando...»", () => {
    assert.equal(elReadyQuitaElMuro({ kind: "tile", phase: "ready", placeId: "molino" }, { viajeAbierto: "forja", muro: "espera" }), false);
  });
});
