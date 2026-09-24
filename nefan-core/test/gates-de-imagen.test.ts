/** Los gates de imagen (#508): cada rama de los dos predicados es una puerta
 *  de GASTO, así que cada caso de la tabla escribe la respuesta a mano — el
 *  mutante que invierta una comparación, gire la herencia del modo vacío o
 *  cambie la caída al toggle se lleva un caso. `CONFIG.graphics.ai_skin` NO
 *  entra aquí (es del cliente, ver la cabecera del módulo), así que tampoco
 *  hay casos suyos. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ENTORNO_POR_DEFECTO,
  entornoPermiteGenerar,
  esModo,
  gatesDeImagen,
  leerEntorno,
  loQuePagaImagenIA,
  modoEfectivoDePersonajes,
  normalizarModo,
  MODO_AL_EMPEZAR,
  skinPideSoloLoPagado,
  type PermisoDePersonajes,
  type EntradaDeGates,
  type Entorno,
  type GatesDeImagen,
  type Modo,
} from "../src/session/gates-de-imagen.js";

/** `esModo` no es un detalle de `normalizarModo`: es la pregunta que las
 *  PUERTAS necesitan (#522, la del save). Se mide aparte porque a través de
 *  `normalizarModo` su rama del «sin elegir» es invisible —quitarla devuelve
 *  `""` igual— y un mutante así no lo mata ningún test de normalización. */
describe("esModo", () => {
  it("los tres valores que el juego sabe leer, y ninguno más", () => {
    for (const bueno of ["image", "vector", ""]) {
      assert.equal(esModo(bueno), true, `${JSON.stringify(bueno)} SÍ es un modo`);
    }
    for (const raro of [undefined, null, "IMAGE", "imagen", "vectorial", " ", "foo", 1, 0, true, {}, []]) {
      assert.equal(esModo(raro), false, `${JSON.stringify(raro)} NO es un modo`);
    }
  });
});

describe("normalizarModo", () => {
  it("deja pasar los dos modos y colapsa todo lo demás a «sin elegir»", () => {
    assert.equal(normalizarModo("image"), "image");
    assert.equal(normalizarModo("vector"), "vector");
    assert.equal(normalizarModo(""), "");
    // Lo que trae un save viejo o un wire con un valor que nadie conoce.
    for (const raro of [undefined, null, "IMAGE", "imagen", "foo", 1, true, {}]) {
      assert.equal(normalizarModo(raro), "", `${JSON.stringify(raro)} debía colapsar a ""`);
    }
  });
});

/** Con qué modo arranca una partida nueva (decisión del usuario 2026-09-14).
 *  Los dos casos miden cosas distintas y hacen falta los dos: el primero dice
 *  QUÉ CONSIGUE —que ninguna de las dos puertas de gasto se abra sola— y el
 *  segundo que es una ELECCIÓN y no el vacío, que por el wire aborta. Con solo
 *  el primero, `MODO_AL_EMPEZAR = ""` pasaría (los escenarios no gastan y los
 *  personajes caen al toggle) y por el bridge reventaría toda partida nueva. */
describe("MODO_AL_EMPEZAR", () => {
  it("una partida nueva no abre NINGUNA puerta de gasto, ni con el toggle local encendido, ni en producción", () => {
    assert.deepEqual(
      gatesDeImagen({
        renderMode: MODO_AL_EMPEZAR,
        characterMode: "",
        toggleLocalPersonajes: true,
        entorno: "produccion",
      }),
      { escenarios: "restaurar", personajes: "base" },
    );
  });

  it("…y nace DECIDIDA: es uno de los dos modos elegibles, no «sin elegir»", () => {
    assert.equal(esModo(MODO_AL_EMPEZAR), true, `${JSON.stringify(MODO_AL_EMPEZAR)} no es un modo`);
    assert.notEqual(MODO_AL_EMPEZAR, "", "«sin elegir» no es un defecto: el bridge lo rechazaría");
  });
});

describe("modoEfectivoDePersonajes", () => {
  const casos: Array<[Modo, Modo, Modo]> = [
    // renderMode, characterMode, efectivo
    ["image", "", "image"],
    ["vector", "", "vector"],
    ["image", "vector", "vector"],
    ["vector", "image", "image"],
    ["image", "image", "image"],
    ["", "", ""],
    ["", "image", "image"],
    ["", "vector", "vector"],
  ];
  for (const [renderMode, characterMode, esperado] of casos) {
    it(`escenarios=${JSON.stringify(renderMode)} personajes=${JSON.stringify(characterMode)} → ${JSON.stringify(esperado)}`, () => {
      assert.equal(modoEfectivoDePersonajes({ renderMode, characterMode }), esperado);
    });
  }
});

/** EL ENTORNO (2026-09-24): pagar arte en los caminos automáticos es
 *  configuración. Una fuente (`NEFAN_ENTORNO`, la lee el bridge) y un defecto
 *  que NO gasta. */
describe("leerEntorno", () => {
  it("sin la variable, o vacía, vale el defecto — y el defecto es desarrollo, el que no gasta", () => {
    assert.equal(ENTORNO_POR_DEFECTO, "desarrollo");
    assert.deepEqual(leerEntorno(undefined), { ok: true, entorno: "desarrollo" });
    assert.deepEqual(leerEntorno(""), { ok: true, entorno: "desarrollo" });
  });

  it("los dos nombres, tal cual", () => {
    assert.deepEqual(leerEntorno("produccion"), { ok: true, entorno: "produccion" });
    assert.deepEqual(leerEntorno("desarrollo"), { ok: true, entorno: "desarrollo" });
  });

  it("cualquier otra cosa es un ERROR que nombra lo que llegó, no un «desarrollo» callado", () => {
    for (const raro of ["prod", "producción", "PRODUCCION", "dev", " produccion", "true", "1"]) {
      const r = leerEntorno(raro);
      assert.equal(r.ok, false, `${JSON.stringify(raro)} no es un entorno`);
      if (!r.ok) assert.ok(r.error.includes(JSON.stringify(raro)), r.error);
    }
  });
});

describe("entornoPermiteGenerar", () => {
  it("solo producción deja pagar a lo automático", () => {
    assert.equal(entornoPermiteGenerar("produccion"), true);
    assert.equal(entornoPermiteGenerar("desarrollo"), false);
  });
});

describe("gatesDeImagen", () => {
  const conSesion = (
    renderMode: Modo,
    characterMode: Modo,
    resto: Partial<EntradaDeGates> = {},
  ): EntradaDeGates => ({
    renderMode,
    characterMode,
    toggleLocalPersonajes: false,
    entorno: "produccion",
    ...resto,
  });
  const sinSesion = (resto: Partial<EntradaDeGates> = {}): EntradaDeGates => conSesion("", "", resto);
  const TOGGLES_ON = { toggleLocalPersonajes: true };
  const DEV = { entorno: "desarrollo" as const };
  const DEV_Y_TOGGLES = { ...DEV, ...TOGGLES_ON };

  const casos: Array<[string, EntradaDeGates, GatesDeImagen]> = [
    // === PRODUCCIÓN: manda el modo de la partida, como antes del techo ===
    // --- con sesión: manda la partida, no los toggles ---
    ["prod · image/image genera en las dos aunque los toggles estén OFF", conSesion("image", "image"), { escenarios: "generar", personajes: "generar" }],
    ["prod · vector/vector no genera en ninguna aunque el toggle esté ON", conSesion("vector", "vector", TOGGLES_ON), { escenarios: "restaurar", personajes: "base" }],
    ["prod · image/vector: atlas sí, skins no", conSesion("image", "vector"), { escenarios: "generar", personajes: "base" }],
    ["prod · vector/image: atlas no, skins sí", conSesion("vector", "image"), { escenarios: "restaurar", personajes: "generar" }],
    // --- «""» de personajes SIGUE a escenarios, y no al toggle local ---
    ["prod · image/«» → skins siguen a escenarios (sí) con el toggle OFF", conSesion("image", ""), { escenarios: "generar", personajes: "generar" }],
    ["prod · vector/«» → skins siguen a escenarios (no) aunque el toggle esté ON", conSesion("vector", "", TOGGLES_ON), { escenarios: "restaurar", personajes: "base" }],
    // --- sin sesión (fixtures): los escenarios NO se generan pase lo que pase
    //     (#519); los personajes caen a su toggle local ---
    ["prod · sin sesión y toggle OFF: nada gasta (una fixture con NPCs no paga sola)", sinSesion(), { escenarios: "restaurar", personajes: "base" }],
    ["prod · sin sesión, el toggle de personajes ON no enciende los escenarios", sinSesion(TOGGLES_ON), { escenarios: "restaurar", personajes: "generar" }],
    // === DESARROLLO: el techo baja todo «generar» a «restaurar», y nada más ===
    // El gemelo de cada caso de arriba. Lo que en producción era `generar`
    // aquí es `restaurar`; lo que era `restaurar` o `base` NO se mueve: el
    // techo nunca convierte «no pedir» en «pedir lo pagado».
    ["dev · image/image solo restaura en las dos", conSesion("image", "image", DEV), { escenarios: "restaurar", personajes: "restaurar" }],
    ["dev · vector/vector sigue sin pedir skins", conSesion("vector", "vector", DEV_Y_TOGGLES), { escenarios: "restaurar", personajes: "base" }],
    ["dev · image/vector: atlas restaura, skins en base", conSesion("image", "vector", DEV), { escenarios: "restaurar", personajes: "base" }],
    ["dev · vector/image: skins restauran", conSesion("vector", "image", DEV), { escenarios: "restaurar", personajes: "restaurar" }],
    ["dev · image/«» → skins siguen a escenarios, y restauran", conSesion("image", "", DEV), { escenarios: "restaurar", personajes: "restaurar" }],
    ["dev · vector/«» → base aunque el toggle esté ON", conSesion("vector", "", DEV_Y_TOGGLES), { escenarios: "restaurar", personajes: "base" }],
    ["dev · sin sesión y toggle OFF: base", sinSesion(DEV), { escenarios: "restaurar", personajes: "base" }],
    ["dev · sin sesión, el toggle ON de una fixture solo restaura", sinSesion(DEV_Y_TOGGLES), { escenarios: "restaurar", personajes: "restaurar" }],
  ];
  for (const [nombre, entrada, esperado] of casos) {
    it(nombre, () => {
      assert.deepEqual(gatesDeImagen(entrada), esperado);
    });
  }

  /** El criterio 2 de la tanda, entero: en desarrollo NINGUNA combinación
   *  genera. Barre el producto completo en vez de fiarse de la tabla de
   *  arriba, y tiene gemelo: la misma barrida en producción SÍ encuentra
   *  `generar` (si no, este test no podría ponerse rojo nunca). */
  const MODOS: Modo[] = ["image", "vector", ""];
  const todas = (entorno: Entorno): EntradaDeGates[] =>
    MODOS.flatMap((renderMode) =>
      MODOS.flatMap((characterMode) =>
        [false, true].map((toggleLocalPersonajes) => ({ renderMode, characterMode, toggleLocalPersonajes, entorno })),
      ),
    );

  it("en DESARROLLO ninguna de las 18 combinaciones deja generar nada", () => {
    const generan = todas("desarrollo").filter((e) => {
      const g = gatesDeImagen(e);
      return g.escenarios === "generar" || g.personajes === "generar";
    });
    assert.deepEqual(generan, []);
  });

  it("…y su gemelo: en PRODUCCIÓN sí hay combinaciones que generan, en las dos facetas", () => {
    const g = todas("produccion").map(gatesDeImagen);
    assert.ok(g.some((x) => x.escenarios === "generar"), "ningún caso genera escenarios en producción");
    assert.ok(g.some((x) => x.personajes === "generar"), "ningún caso genera personajes en producción");
  });

  it("el techo solo BAJA: desarrollo = producción con cada «generar» cambiado por «restaurar»", () => {
    const bajar = (p: string) => (p === "generar" ? "restaurar" : p);
    for (const prod of todas("produccion")) {
      const dev = gatesDeImagen({ ...prod, entorno: "desarrollo" });
      const p = gatesDeImagen(prod);
      assert.deepEqual(dev, { escenarios: bajar(p.escenarios), personajes: bajar(p.personajes) }, JSON.stringify(prod));
    }
  });

  it("no toca la entrada (función pura)", () => {
    const entrada = conSesion("image", "");
    const copia = { ...entrada };
    gatesDeImagen(entrada);
    assert.deepEqual(entrada, copia);
  });
});

/** Los rótulos de antes de elegir (QA H1/H2): salen de los gates, así que con
 *  el techo quitado estos asertos se ponen rojos junto con los de gasto. */
describe("loQuePagaImagenIA", () => {
  it("en desarrollo encender Imagen IA no paga en ninguna faceta", () => {
    assert.deepEqual(loQuePagaImagenIA("desarrollo"), { escenarios: false, personajes: false });
  });
  it("en producción paga en las dos", () => {
    assert.deepEqual(loQuePagaImagenIA("produccion"), { escenarios: true, personajes: true });
  });
});

/** La excepción del forzado (#756, salida b): cada fila escrita a mano. El
 *  forzado paga su set automático y NADA MÁS; sus lazy restauran. */
describe("skinPideSoloLoPagado", () => {
  const tabla: Array<[PermisoDePersonajes, boolean, boolean, boolean]> = [
    // permiso, elegida a mano, del set automático → ¿solo lo pagado?
    ["generar", false, false, false],
    ["generar", false, true, false],
    ["generar", true, false, false],
    ["generar", true, true, false],
    ["restaurar", false, false, true],
    ["restaurar", false, true, true],
    ["restaurar", true, false, true], // la lazy del forzado: el caso de #756
    ["restaurar", true, true, false], // lo que el botón enseña: se paga
    ["base", false, false, true],
    ["base", false, true, true],
    ["base", true, false, true],
    ["base", true, true, false],
  ];
  for (const [permiso, elegidaAMano, delSetAutomatico, esperado] of tabla) {
    it(`${permiso} · a mano=${elegidaAMano} · set automático=${delSetAutomatico} → ${esperado}`, () => {
      assert.equal(skinPideSoloLoPagado(permiso, { elegidaAMano, delSetAutomatico }), esperado);
    });
  }
});
