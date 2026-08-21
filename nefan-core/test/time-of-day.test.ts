/** La hora del día que la vista fps saca de la NARRACIÓN.
 *
 *  Nadie declara la luz de un tile: el motor escribe "cae la tarde sobre el
 *  lindero" y `buildFpsAmbience` tiene que atardecer de verdad. Esta
 *  inferencia vivía dentro del builder del plató y su cobertura era de
 *  rebote (`stage-greybox.test.ts` probaba `resolveTimeOfDay`, que además
 *  mira el campo declarado, así que el texto solo se ejercía en un caso).
 *  Aquí se prueba lo que de verdad usa la fps: texto → hora. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRACTICAL_LIGHT_RE,
  timeOfDayFromText,
  type TimeOfDay,
} from "../src/scene/blueprint/time-of-day.js";

describe("hora del día inferida del texto", () => {
  it("la raíz verbal basta: 'atardece' vale tanto como 'atardecer'", () => {
    // Es la razón de que los patrones estén truncados. Un motor narrativo
    // escribe verbos conjugados, no sustantivos de manual de iluminación.
    assert.equal(timeOfDayFromText("atardece sobre el camino"), "atardecer");
    assert.equal(timeOfDayFromText("un atardecer largo"), "atardecer");
    assert.equal(timeOfDayFromText("amanece entre la niebla"), "amanecer");
    assert.equal(timeOfDayFromText("el amanecer sorprende al pueblo"), "amanecer");
    assert.equal(timeOfDayFromText("anochece en el bosque"), "noche");
  });

  it("el texto llega como venga: mayúsculas y frases enteras", () => {
    assert.equal(timeOfDayFromText("LA LUNA ilumina la plaza"), "noche");
    assert.equal(
      timeOfDayFromText("El herrero cierra el taller cuando ya ha anochecido del todo."),
      "noche",
    );
  });

  it("cada hora tiene más de una manera de decirse", () => {
    const familias: Array<[TimeOfDay, string[]]> = [
      ["amanecer", ["amanece", "el alba", "la aurora", "la primera luz"]],
      ["atardecer", ["atardece", "el ocaso", "el sol se pone hacia poniente", "caía la tarde", "crepúsculo", "crepusculo", "con el sol bajo"]],
      ["noche", ["es de noche", "anochece", "un mercado nocturno", "la luna", "las estrellas", "a medianoche"]],
    ];
    for (const [esperada, textos] of familias) {
      for (const t of textos) assert.equal(timeOfDayFromText(t), esperada, `"${t}"`);
    }
  });

  it("la precedencia es amanecer > atardecer > noche, y está declarada en ese orden", () => {
    // Una descripción larga puede nombrar dos horas ("un amanecer tras la
    // noche cerrada"). Gana la primera regla que case, no la última mención:
    // sin este orden fijo, la misma escena podría salir de día o de noche
    // según dónde el motor colocase la frase.
    assert.equal(timeOfDayFromText("un amanecer tras la noche cerrada"), "amanecer");
    assert.equal(timeOfDayFromText("la noche da paso al alba"), "amanecer");
    assert.equal(timeOfDayFromText("el ocaso y la luna sobre el río"), "atardecer");
    assert.equal(timeOfDayFromText("bajo la luna, tras el atardecer"), "atardecer");
  });

  it("lo que no nombra ninguna hora es de DÍA — el default no toca nada", () => {
    // El caso importante de todos: de día `buildFpsAmbience` no devuelve
    // luces, ni cielo, ni niebla, y el tile se ve EXACTAMENTE como el arte
    // histórico. Un default equivocado repinta el juego entero.
    assert.equal(timeOfDayFromText(""), "dia");
    assert.equal(timeOfDayFromText("El sol cae a plomo sobre la plaza."), "dia");
    assert.equal(timeOfDayFromText("Una taberna con las mesas puestas."), "dia");
    assert.equal(timeOfDayFromText("Un mediodía cualquiera en el mercado."), "dia");
  });

  it("una palabra suelta no basta si está dentro de otra: 'albahaca' no amanece", () => {
    // `alba\b` lleva su frontera a propósito. Sin ella, media huerta amanece.
    assert.equal(timeOfDayFromText("un tiesto de albahaca"), "dia");
    assert.equal(timeOfDayFromText("un albaricoque en la mesa"), "dia");
  });
});

describe("labels que encienden una luz práctica", () => {
  it("casan con tilde y sin ella — el motor escribe de las dos maneras", () => {
    for (const par of [["fogón", "fogon"], ["lámpara", "lampara"]]) {
      for (const t of par) assert.ok(PRACTICAL_LIGHT_RE.test(t), `"${t}" debería encender`);
    }
  });

  it("reconocen el vocabulario de fuego y de luz del mundo", () => {
    for (const t of ["chimenea", "hogar", "farol", "farola de hierro", "vela", "antorcha", "candil", "brasero", "lumbre", "hoguera", "fuego", "Antorcha en el muro"]) {
      assert.ok(PRACTICAL_LIGHT_RE.test(t), `"${t}" debería encender`);
    }
  });

  it("no encienden con vecinos inocentes", () => {
    // El caso inválido: cualquier mueble de taberna que se colase aquí
    // pondría un punto de luz cálido de 14 de intensidad encima de un banco.
    for (const t of ["banco de madera", "pozo de piedra", "carreta de heno", "abrevadero", "yunque", "hogaza de pan", "velero varado", "establo"]) {
      assert.ok(!PRACTICAL_LIGHT_RE.test(t), `"${t}" NO debería encender`);
    }
  });

  it("no lleva la bandera `g`: si la llevara, encendería una lámpara sí y otra no", () => {
    // `hasLightLabel` la usa con `.test()` sobre volumen tras volumen. Un
    // regex global guarda `lastIndex` entre llamadas y devuelve resultados
    // ALTERNOS sobre la misma cadena. No es teoría: es el bug clásico de
    // reutilizar un literal /…/g a nivel de módulo, y aquí saldría como
    // "algunos faroles no alumbran", que nadie diagnosticaría jamás.
    assert.equal(PRACTICAL_LIGHT_RE.global, false);
    assert.equal(PRACTICAL_LIGHT_RE.sticky, false);
    assert.equal(PRACTICAL_LIGHT_RE.test("farol"), true);
    assert.equal(PRACTICAL_LIGHT_RE.test("farol"), true, "dos llamadas seguidas, misma respuesta");
  });
});
