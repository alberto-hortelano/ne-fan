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

import { repartirStatus } from "../src/protocol/status-reparto.js";
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
