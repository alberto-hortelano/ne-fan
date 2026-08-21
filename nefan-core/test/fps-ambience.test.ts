/** Ambientación del tile en primera persona: el post-proceso que convierte
 *  una descripción narrativa en luces, cielo y niebla.
 *
 *  144 líneas FPS-ONLY que hasta hoy no tenían un solo test propio: se
 *  probaban de rebote a través del builder del plató, que se retira. Y lo que
 *  aquí se protege no es un detalle de iluminación — es que **de día no se
 *  toque nada**. Si `buildFpsAmbience` empezara a devolver luces con el sol
 *  alto, todos los tiles ya generados cambiarían de aspecto y el arte pagado
 *  dejaría de casar con lo que se ve. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFpsAmbience } from "../src/scene/blueprint/fps-ambience.js";
import { volumeHeightM } from "../src/scene/blueprint/volume-metrics.js";
import { TILE_MPC } from "../src/scene/tile.js";
import type { Volume } from "../src/scene/blueprint/volumes.js";

const DIA = "Un mediodía cualquiera en la plaza del mercado.";
const NOCHE = "Es de noche y el pueblo duerme.";

/** Antorcha suelta en mitad de la calle (no cae dentro de ningún cutaway). */
const antorcha: Volume = { id: "antorcha", label: "antorcha en el poste", type: "prop", at: [20, 30], h: 2 };
/** Banco: nombra nada que arda. */
const banco: Volume = { id: "banco", label: "banco de madera", type: "prop", at: [40, 40], h: 1 };

/** Casa abierta en corte + un candil DENTRO de su huella. */
const casaAbierta: Volume = { id: "casa", label: "casa", type: "building", rect: [10, 10, 8, 6], wall_h: 5, cutaway: true };
const candilInterior: Volume = { id: "candil", label: "candil sobre la mesa", type: "prop", at: [14, 13], h: 1 };

describe("de día no se toca nada", () => {
  it("sin luces, sin cielo y sin niebla: el tile se ve EXACTAMENTE como el arte histórico", () => {
    const amb = buildFpsAmbience(DIA, [antorcha, banco], "t");
    assert.equal(amb.timeOfDay, "dia");
    assert.equal(amb.lightsM, undefined, "de día manda el sol histórico del renderer");
    assert.equal(amb.sky, undefined);
    assert.equal(amb.fog, undefined);
  });

  it("una descripción vacía o ausente también es de día", () => {
    for (const d of [undefined, ""]) {
      const amb = buildFpsAmbience(d, [antorcha], "t");
      assert.equal(amb.timeOfDay, "dia");
      assert.equal(amb.lightsM, undefined);
    }
  });

  it("una antorcha en la calle NO se enciende de día", () => {
    assert.equal(buildFpsAmbience(DIA, [antorcha], "t").extraM, undefined);
  });

  it("pero el candil de un interior SÍ: dentro no llega el sol", () => {
    // La excepción tiene motivo físico. Un `cutaway` abre la casa para que se
    // vea por dentro; sin su lámpara, el interior queda como un quirófano.
    const amb = buildFpsAmbience(DIA, [casaAbierta, candilInterior], "t");
    assert.equal(amb.timeOfDay, "dia");
    assert.equal(amb.extraM?.length, 1);
    assert.equal(amb.extraM![0].kind, "point");
    // Y sigue sin tocar el resto: esto añade UN punto, no cambia la escena.
    assert.equal(amb.lightsM, undefined);
    assert.equal(amb.sky, undefined);
    assert.equal(amb.fog, undefined);
  });

  it("sin cutaway, ese mismo candil es exterior y no se enciende de día", () => {
    const cerrada = { ...casaAbierta, cutaway: undefined } as Volume;
    assert.equal(buildFpsAmbience(DIA, [cerrada, candilInterior], "t").extraM, undefined);
  });
});

describe("de noche", () => {
  it("la práctica sale en el CENTRO de la huella y a la altura del volumen", () => {
    const amb = buildFpsAmbience(NOCHE, [antorcha], "t");
    const punto = amb.lightsM!.find((l) => l.kind === "point");
    assert.ok(punto, "la antorcha tiene que dar luz de noche");
    // La huella de un prop por punto es un cuadrado centrado en `at`, así que
    // el centro es `at` — en METROS, no en celdas.
    assert.equal(punto.pos![0], 20 * TILE_MPC);
    assert.equal(punto.pos![2], 30 * TILE_MPC);
    // Altura: 70 % del volumen, acotada entre 0,6 y 2,4 m (la llama no puede
    // quedar en el suelo ni sobre el tejado).
    assert.equal(punto.pos![1], volumeHeightM(antorcha, TILE_MPC) * 0.7);
    assert.ok(punto.pos![1] >= 0.6 && punto.pos![1] <= 2.4);
  });

  it("la altura de la llama se acota por arriba y por abajo", () => {
    const farolAlto: Volume = { id: "f", label: "farol de la torre", type: "prop", at: [20, 20], h: 40 };
    const brasaBaja: Volume = { id: "b", label: "brasero", type: "prop", at: [20, 20], h: 0.4 };
    const alto = buildFpsAmbience(NOCHE, [farolAlto], "t").lightsM!.find((l) => l.kind === "point")!;
    const bajo = buildFpsAmbience(NOCHE, [brasaBaja], "t").lightsM!.find((l) => l.kind === "point")!;
    assert.equal(alto.pos![1], 2.4);
    assert.equal(bajo.pos![1], 0.6);
  });

  it("llegan cielo y niebla, y la niebla nocturna cierra más cerca", () => {
    const noche = buildFpsAmbience(NOCHE, [], "t");
    const tarde = buildFpsAmbience("Cae la tarde sobre el lindero.", [], "t");
    assert.ok(noche.sky!.top && noche.sky!.bottom);
    assert.equal(noche.fog!.near, 20);
    assert.equal(noche.fog!.far, 70);
    assert.equal(tarde.fog!.far, 90, "solo la noche cierra a 70");
    assert.notEqual(noche.sky!.top, tarde.sky!.top, "cada hora tiene su cielo");
    assert.notEqual(noche.fog!.color, tarde.fog!.color);
  });

  it("hay siempre un hemisférico y un sol, y solo la noche añade ambiente", () => {
    for (const [texto, hora] of [[NOCHE, "noche"], ["Amanece entre la niebla.", "amanecer"], ["Cae la tarde.", "atardecer"]] as const) {
      const amb = buildFpsAmbience(texto, [], "t");
      assert.equal(amb.timeOfDay, hora);
      const kinds = amb.lightsM!.map((l) => l.kind);
      assert.ok(kinds.includes("hemi"), `${hora} sin hemisférico`);
      assert.ok(kinds.includes("sun"), `${hora} sin sol`);
      assert.equal(kinds.includes("ambient"), hora === "noche", `${hora}: ambiente solo de noche`);
    }
  });

  it("el sol proyecta sombra: es la luz que da forma al relieve", () => {
    const sol = buildFpsAmbience(NOCHE, [], "t").lightsM!.find((l) => l.kind === "sun")!;
    assert.equal(sol.castShadow, true);
    assert.ok(sol.pos![1] > 0, "por debajo del horizonte no ilumina nada");
  });

  it("el candil de interior NO se duplica: va en extraM, no en las luces de la escena", () => {
    const amb = buildFpsAmbience(NOCHE, [casaAbierta, candilInterior], "t");
    assert.equal(amb.extraM?.length, 1);
    assert.equal(amb.lightsM!.filter((l) => l.kind === "point").length, 0);
  });
});

describe("qué enciende y qué no", () => {
  it("un edificio nunca enciende una práctica, se llame como se llame", () => {
    // Un punto de luz en el centro de una casa de 8×6 la ilumina desde
    // dentro del muro. El fuego lo declara un volumen pequeño, no el edificio.
    const forja: Volume = { id: "forja", label: "la forja con el hogar encendido", type: "building", rect: [10, 10, 8, 6], wall_h: 5 };
    const amb = buildFpsAmbience(NOCHE, [forja], "t");
    assert.equal(amb.lightsM!.filter((l) => l.kind === "point").length, 0);
    assert.equal(amb.extraM, undefined);
  });

  it("una pieza de un volumen custom puede encender aunque el label del conjunto no diga nada", () => {
    // `hasLightLabel` mira también los `desc` de las piezas: es la única vía
    // que tiene una composición libre para declarar dónde está el fuego.
    const puesto: Volume = {
      id: "puesto", label: "puesto del mercado", type: "custom", at: [20, 20],
      parts: [{ shape: "box", size: [4, 2, 2] }, { shape: "box", size: [1, 1, 1], desc: "brasero de carbón", pos: [2, 0, 0] }],
    };
    assert.equal(buildFpsAmbience(NOCHE, [puesto], "t").lightsM!.filter((l) => l.kind === "point").length, 1);
  });

  it("los muebles que no arden se quedan a oscuras", () => {
    const amb = buildFpsAmbience(NOCHE, [banco], "t");
    assert.equal(amb.lightsM!.filter((l) => l.kind === "point").length, 0);
  });

  it("las prácticas tienen tope: 8 fuera y 4 dentro, no una por objeto", () => {
    // Sin tope, una plaza con veinte faroles mete veinte point lights en la
    // escena y el frame se desploma.
    const faroles: Volume[] = Array.from({ length: 20 }, (_, i) => ({
      id: `farol_${i}`, label: "farol", type: "prop", at: [20 + i * 2, 30], h: 2,
    }));
    assert.equal(buildFpsAmbience(NOCHE, faroles, "t").lightsM!.filter((l) => l.kind === "point").length, 8);

    const dentro: Volume[] = Array.from({ length: 10 }, (_, i) => ({
      id: `candil_${i}`, label: "candil", type: "prop", at: [11 + i * 0.5, 12], h: 1,
    }));
    assert.equal(buildFpsAmbience(DIA, [casaAbierta, ...dentro], "t").extraM!.length, 4);
  });
});

describe("determinismo", () => {
  it("misma semilla, misma ambientación: el tile no parpadea al re-emitirse", () => {
    const a = buildFpsAmbience(NOCHE, [antorcha, casaAbierta, candilInterior], "tile_0_0");
    const b = buildFpsAmbience(NOCHE, [antorcha, casaAbierta, candilInterior], "tile_0_0");
    assert.deepEqual(a, b);
  });

  it("semillas distintas mueven el sol: dos tiles vecinos no tienen la misma sombra clavada", () => {
    const a = buildFpsAmbience(NOCHE, [], "tile_0_0").lightsM!.find((l) => l.kind === "sun")!;
    const b = buildFpsAmbience(NOCHE, [], "tile_1_0").lightsM!.find((l) => l.kind === "sun")!;
    assert.notDeepEqual(a.pos, b.pos);
  });

  it("la hora NO depende de la semilla: la manda el texto y solo el texto", () => {
    for (const seed of ["a", "b", "tile_9_9"]) {
      assert.equal(buildFpsAmbience(NOCHE, [antorcha], seed).timeOfDay, "noche");
    }
  });
});
