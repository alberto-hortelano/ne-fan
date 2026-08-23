/** El rótulo que lee quien juega cuando el motor falla (#180).
 *
 *  Lo que se comprueba aquí NO es que las cadenas sean bonitas, es la
 *  DECISIÓN: qué fallo tapa la pantalla y cuál se queda en la línea de
 *  mensajes, y cuál de los cuatro títulos corresponde a cada situación. Esa
 *  decisión vivía en dos `if` de `main.ts` con el rótulo escrito a mano al
 *  lado, y no había forma de probarla sin navegador. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { rotuloDeStatus } from "../src/protocol/status-labels.js";
import type { NarrativeStatusMessage } from "../src/protocol/messages.js";

/** Un status de error tal y como lo emite el bridge, con el cuerpo ya escrito
 *  para el jugador por `motivoParaElJugador`. */
const fallo = (extra: Partial<NarrativeStatusMessage> = {}): NarrativeStatusMessage => ({
  type: "narrative_status",
  phase: "error",
  kind: "tile",
  message: "No se pudo llegar a Robledo. El motor narrativo no responde; inténtalo de nuevo en un momento.",
  ...extra,
});

describe("rótulo de un fallo del motor", () => {
  it("tile con el mundo todavía vacío: la partida no llegó a empezar", () => {
    const r = rotuloDeStatus(fallo({ tile: { tx: 0, ty: 0 } }), {
      mundoVacio: true,
      overlayAbierto: true,
    });
    assert.equal(r.destino, "overlay");
    assert.equal(r.titulo, "La partida no pudo empezar");
    assert.match(r.detalle, /Robledo/);
  });

  it("tile con overlay abierto: el jugador está esperando un viaje, el error va al overlay", () => {
    const r = rotuloDeStatus(fallo({ tile: { tx: 2, ty: 0 } }), {
      mundoVacio: false,
      overlayAbierto: true,
    });
    assert.deepEqual(
      { destino: r.destino, titulo: r.titulo },
      { destino: "overlay", titulo: "No se pudo llegar" },
    );
  });

  it("tile de frontera en segundo plano: al log, NO tapa la pantalla", () => {
    // Es el caso que distingue esta función de «pintar el error siempre»: la
    // frontera se genera sola mientras el jugador camina, y su feedback es el
    // velo del borde. Un overlay modal aquí interrumpe una partida en curso
    // por algo que el jugador ni pidió.
    const r = rotuloDeStatus(fallo({ tile: { tx: 1, ty: 0 }, message: "Error: fetch failed" }), {
      mundoVacio: false,
      overlayAbierto: false,
    });
    assert.equal(r.destino, "log");
    assert.equal(r.detalle, "Error: fetch failed");
  });

  it("escena de un VIAJE (trae placeId): no se pudo llegar", () => {
    const r = rotuloDeStatus(
      fallo({ kind: "scene", placeId: "ermita_del_vado", message: "No se pudo viajar a Ermita del vado. El motor narrativo no responde; inténtalo de nuevo en un momento." }),
      { mundoVacio: false, overlayAbierto: true },
    );
    assert.deepEqual(
      { destino: r.destino, titulo: r.titulo },
      { destino: "overlay", titulo: "No se pudo llegar" },
    );
  });

  it("escena SIN place: no se pudo preparar el lugar", () => {
    const r = rotuloDeStatus(fallo({ kind: "scene", placeId: undefined }), {
      mundoVacio: false,
      overlayAbierto: true,
    });
    assert.deepEqual(
      { destino: r.destino, titulo: r.titulo },
      { destino: "overlay", titulo: "No se pudo preparar el lugar" },
    );
  });

  it("una escena sin place no depende del contexto de pintado: siempre al overlay", () => {
    // El contraste con el tile de frontera: una escena que el motor preparaba
    // se pidió desde el juego, así que su fallo se enseña aunque no haya
    // overlay abierto. Sin esto, `overlayAbierto` podría estar decidiendo por
    // todos los kinds y el test de arriba no lo notaría.
    const r = rotuloDeStatus(fallo({ kind: "scene" }), {
      mundoVacio: false,
      overlayAbierto: false,
    });
    assert.equal(r.destino, "overlay");
  });

  it("consequences: la reacción narrativa rechazada conserva su rótulo", () => {
    const r = rotuloDeStatus(fallo({ kind: "consequences", message: undefined }), {
      mundoVacio: false,
      overlayAbierto: false,
    });
    assert.deepEqual(r, {
      destino: "overlay",
      titulo: "El motor narrativo rechazó la respuesta",
      detalle: "El motor narrativo rechazó la reacción.",
    });
  });

  it("sin `message` cada kind trae su propio cuerpo, no un «algo falló» genérico", () => {
    const cuerpo = (kind: NarrativeStatusMessage["kind"]): string =>
      rotuloDeStatus(fallo({ kind, message: undefined }), {
        mundoVacio: true,
        overlayAbierto: true,
      }).detalle;
    assert.equal(cuerpo("tile"), "Algo falló generando el tile.");
    assert.equal(cuerpo("scene"), "Algo falló en el motor narrativo.");
    assert.equal(cuerpo("consequences"), "El motor narrativo rechazó la reacción.");
    assert.equal(cuerpo("game_gen"), "El motor narrativo rechazó la reacción.");
  });

  it("un `message` vacío NO se sustituye por el de por defecto", () => {
    // `??` y `||` se confunden en este sitio exacto y la diferencia es
    // observable: con `||`, un mensaje vacío del bridge se cambiaría por el
    // texto genérico y el jugador leería una causa inventada.
    assert.equal(rotuloDeStatus(fallo({ message: "" }), { mundoVacio: true, overlayAbierto: true }).detalle, "");
  });

  it("rotular algo que NO es un fallo es un error de quien llama (fail-loud)", () => {
    for (const phase of ["generating", "progress", "ready"] as const) {
      assert.throws(
        () => rotuloDeStatus(fallo({ phase }), { mundoVacio: true, overlayAbierto: true }),
        /solo rotula fallos/,
        `phase "${phase}" debería rechazarse`,
      );
    }
  });
});
