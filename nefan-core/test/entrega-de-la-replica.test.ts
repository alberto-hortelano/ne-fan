/** Tanda BW, H1: la réplica del motor a un turno del jugador que llega cuando
 *  la conversación ya no es la actual NO abre el panel: va al registro.
 *
 *  Los casos salen de lo que salió jugando (2026-09-30): la réplica de Orio
 *  abrió el panel en mitad de la pelea con Brasco, y la de Maela, cuatro horas
 *  de camino después. Y del caso que no puede cambiar: si esperas al lado de
 *  quien te habla, el panel se abre como siempre. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  entregarReplica,
  lineaDeReplicaDiferida,
  vigenciaDeLaReplica,
  type ContextoDeLaReplica,
  type ReplicaDiferidaEffect,
} from "../src/narrative/entrega-de-la-replica.js";
import type { ConsequenceEffect } from "../src/narrative/types.js";

const TEXTO = "¡Eso, eso, encárgate de Brasco! Y luego hablamos tú y yo.";

const dialogo = (speakerId?: string): ConsequenceEffect => ({
  kind: "show_dialogue",
  speaker: "Orio Candil",
  text: TEXTO,
  choices: ["Ya voy", { text: "Luego" }],
  ...(speakerId ? { speakerId } : {}),
  speakerSkinPrompt: "tabernero orondo",
});

/** El caso normal: mismo tile, sin pelea, jugador en el origen. */
const QUIETO: ContextoDeLaReplica = {
  escenaAlPedir: "tile_0_0",
  escenaAhora: "tile_0_0",
  atacoDesdeQuePidio: false,
  viajeEnCurso: false,
  terminoUnaConversacionDesdeQuePidio: false,
  hayPelea: false,
  jugador: { x: 0, z: 0 },
};

const aTres = () => ({ x: 3, z: 0 });

describe("vigencia de la réplica", () => {
  it("mismo tile, sin atacar, hablante a 3 m → vigente", () => {
    assert.deepEqual(vigenciaDeLaReplica(QUIETO, { x: 3, z: 0 }), { vigente: true });
  });

  it("el jugador atacó mientras el motor pensaba → no vigente por combate, aunque el hablante esté al lado", () => {
    assert.deepEqual(vigenciaDeLaReplica({ ...QUIETO, atacoDesdeQuePidio: true }, { x: 1, z: 0 }), {
      vigente: false,
      motivo: "combate",
    });
  });

  it("un viaje en curso → no vigente por viaje, aunque el tile y la posición sean aún los de salida (QA, 344)", () => {
    assert.deepEqual(vigenciaDeLaReplica({ ...QUIETO, viajeEnCurso: true }, { x: 1, z: 0 }), {
      vigente: false,
      motivo: "viaje",
    });
  });

  it("el jugador terminó una conversación mientras el motor pensaba → no vigente por terminada (tanda BX)", () => {
    assert.deepEqual(
      vigenciaDeLaReplica({ ...QUIETO, terminoUnaConversacionDesdeQuePidio: true }, { x: 1, z: 0 }),
      { vigente: false, motivo: "terminada" },
    );
    // Control: lo mismo sin el fin, vigente.
    assert.deepEqual(vigenciaDeLaReplica(QUIETO, { x: 1, z: 0 }), { vigente: true });
  });

  it("el orden: viaje > terminada > tile > lejos", () => {
    const fin = { ...QUIETO, terminoUnaConversacionDesdeQuePidio: true, escenaAhora: "tile_1_0" };
    assert.deepEqual(vigenciaDeLaReplica({ ...fin, viajeEnCurso: true }), { vigente: false, motivo: "viaje" });
    assert.deepEqual(vigenciaDeLaReplica(fin, { x: 40, z: 0 }), { vigente: false, motivo: "terminada" });
  });

  it("el orden: atacar > viaje > tile", () => {
    const todo = { ...QUIETO, atacoDesdeQuePidio: true, viajeEnCurso: true, escenaAhora: "tile_1_0" };
    assert.deepEqual(vigenciaDeLaReplica(todo), { vigente: false, motivo: "combate" });
    assert.deepEqual(vigenciaDeLaReplica({ ...todo, atacoDesdeQuePidio: false }), { vigente: false, motivo: "viaje" });
  });

  it("hayPelea sola NO degrada la réplica (opción B: te pegan y no atacas → panel)", () => {
    assert.deepEqual(vigenciaDeLaReplica({ ...QUIETO, hayPelea: true }, { x: 1, z: 0 }), { vigente: true });
  });

  it("otro tile → no vigente por otro_tile, aunque el hablante no tenga posición", () => {
    assert.deepEqual(vigenciaDeLaReplica({ ...QUIETO, escenaAhora: "tile_0_-1" }), {
      vigente: false,
      motivo: "otro_tile",
    });
  });

  it("haber atacado manda sobre el tile (orden de la regla)", () => {
    const v = vigenciaDeLaReplica({ ...QUIETO, atacoDesdeQuePidio: true, escenaAhora: "tile_0_-1" });
    assert.deepEqual(v, { vigente: false, motivo: "combate" });
  });

  it("el tile manda sobre la distancia", () => {
    const v = vigenciaDeLaReplica({ ...QUIETO, escenaAhora: "tile_1_0" }, { x: 40, z: 0 });
    assert.deepEqual(v, { vigente: false, motivo: "otro_tile" });
  });

  it("hablante a más de 18 m en el mismo tile → no vigente por lejos; a 18 m justos, vigente", () => {
    assert.deepEqual(vigenciaDeLaReplica(QUIETO, { x: 0, z: 18.5 }), { vigente: false, motivo: "lejos" });
    assert.deepEqual(vigenciaDeLaReplica(QUIETO, { x: 0, z: 18 }), { vigente: true });
  });

  it("la distancia se mide desde el JUGADOR, en XZ", () => {
    const lejosDelOrigen = { ...QUIETO, jugador: { x: 30, z: 30 } };
    assert.deepEqual(vigenciaDeLaReplica(lejosDelOrigen, { x: 32, z: 31 }), { vigente: true });
    assert.deepEqual(vigenciaDeLaReplica(lejosDelOrigen, { x: 3, z: 0 }), { vigente: false, motivo: "lejos" });
  });

  it("sin posición del hablante (narrador) → solo deciden el ataque y el tile", () => {
    assert.deepEqual(vigenciaDeLaReplica({ ...QUIETO, jugador: { x: 500, z: 500 } }), { vigente: true });
  });
});

describe("entregarReplica", () => {
  it("caso normal: el show_dialogue pasa INTACTO (mismo objeto, con sus opciones)", () => {
    const d = dialogo("orio");
    const out = entregarReplica([d], QUIETO, aTres);
    assert.equal(out.length, 1);
    assert.equal(out[0], d);
  });

  for (const [nombre, ctx, pos, motivo] of [
    ["atacó", { ...QUIETO, atacoDesdeQuePidio: true }, aTres, "combate"],
    ["viaje", { ...QUIETO, viajeEnCurso: true }, aTres, "viaje"],
    ["terminada", { ...QUIETO, terminoUnaConversacionDesdeQuePidio: true }, aTres, "terminada"],
    ["otro tile", { ...QUIETO, escenaAhora: "tile_0_-1" }, aTres, "otro_tile"],
    ["lejos", QUIETO, () => ({ x: 0, z: 40 }), "lejos"],
  ] as const) {
    it(`${nombre} → replica_diferida con el texto IDÉNTICO y sin opciones`, () => {
      const out = entregarReplica([dialogo("orio")], ctx, pos);
      const esperado: ReplicaDiferidaEffect = {
        kind: "replica_diferida",
        speaker: "Orio Candil",
        text: TEXTO,
        speakerId: "orio",
        motivo,
        hayPelea: false,
      };
      assert.deepEqual(out, [esperado]);
    });
  }

  it("la distancia se pregunta por el speakerId del effect", () => {
    const preguntados: string[] = [];
    entregarReplica([dialogo("orio")], QUIETO, (id) => {
      preguntados.push(id);
      return aTres();
    });
    assert.deepEqual(preguntados, ["orio"]);
  });

  it("sin speakerId no se pregunta la posición y la diferida no inventa uno", () => {
    let preguntas = 0;
    const out = entregarReplica([dialogo()], { ...QUIETO, atacoDesdeQuePidio: true }, () => {
      preguntas++;
      return { x: 0, z: 99 };
    });
    assert.equal(preguntas, 0);
    assert.deepEqual(out, [{ kind: "replica_diferida", speaker: "Orio Candil", text: TEXTO, motivo: "combate", hayPelea: false }]);
    assert.equal("speakerId" in out[0]!, false);
  });

  it("id sin entidad (posDe → undefined) decide como narrador: vigente sin combate ni tile", () => {
    const d = dialogo("fantasma");
    assert.equal(entregarReplica([d], QUIETO, () => undefined)[0], d);
  });

  it("un spawn del MISMO turno y el resto de effects pasan intactos y en su orden", () => {
    const spawn: ConsequenceEffect = {
      kind: "spawn_entity",
      entityId: "brasco",
      name: "Brasco el del Remo",
      position: [4, 0, 4],
      data: { role: "hostile" },
      eventId: "evt_0011",
      entityKind: "npc",
    };
    const story: ConsequenceEffect = { kind: "story_delta", delta: "Orio se ríe." };
    const out = entregarReplica([story, dialogo("orio"), spawn], { ...QUIETO, atacoDesdeQuePidio: true }, aTres);
    assert.equal(out[0], story);
    assert.equal(out[1]!.kind, "replica_diferida");
    assert.equal(out[2], spawn);
  });
});

describe("la línea del registro", () => {
  const base: ReplicaDiferidaEffect = {
    kind: "replica_diferida",
    speaker: "Maela",
    text: "Vuelve cuando quieras.",
    speakerId: "maela",
    motivo: "otro_tile",
    hayPelea: false,
  };

  it("lleva el texto entero del hablante y la pista de volver a hablarle con E", () => {
    assert.equal(lineaDeReplicaDiferida(base), "💬 Maela: «Vuelve cuando quieras.» (vuelve a hablarle con E)");
    assert.equal(
      lineaDeReplicaDiferida({ ...base, motivo: "lejos" }),
      "💬 Maela: «Vuelve cuando quieras.» (vuelve a hablarle con E)",
    );
  });

  it("se puso a pelear CON ALGUIEN enganchado: la pista es cuando acabe la pelea", () => {
    assert.equal(
      lineaDeReplicaDiferida({ ...base, motivo: "combate", hayPelea: true }),
      "💬 Maela: «Vuelve cuando quieras.» (vuelve a hablarle cuando acabe la pelea)",
    );
  });

  it("un golpe al aire sin nadie enganchado: la pista NEUTRA, no habla de una pelea que no existe (QA)", () => {
    assert.equal(
      lineaDeReplicaDiferida({ ...base, motivo: "combate", hayPelea: false }),
      "💬 Maela: «Vuelve cuando quieras.» (vuelve a hablarle con E)",
    );
  });

  it("con un viaje en curso, la pista neutra (aunque haya pelea: no es lo que la difirió)", () => {
    assert.equal(
      lineaDeReplicaDiferida({ ...base, motivo: "viaje", hayPelea: true }),
      "💬 Maela: «Vuelve cuando quieras.» (vuelve a hablarle con E)",
    );
  });

  it("sin entidad detrás no hay a quién volver a hablarle: solo lo dicho", () => {
    const { speakerId: _sinId, ...narrador } = base;
    assert.equal(lineaDeReplicaDiferida(narrador), "💬 Maela: «Vuelve cuando quieras.»");
  });
});
