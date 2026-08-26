/** El candado de #279: una partida existe en disco cuando el jugador ha
 *  llegado a jugarla, y eso son DOS cosas a la vez.
 *
 *  El caso que obliga a la conjunción está medido en vivo, y NO necesita que
 *  falle nada: `qa/guiones/29-la-partida-existe-cuando-el-jugador-entra.mjs`,
 *  bloque 3 — mientras el jugador se viste, el mundo ya está pintado y el
 *  título sigue delante. Anunciar la entrada con solo una de las dos mitades
 *  escribiría el save ahí, y con él el de cualquier arranque que un instante
 *  después vuelve al título: la tarjeta de partida fantasma del issue.
 *
 *  El guion 27 ejerce esa misma ventana con un fallo dentro, pero CONSTRUYE el
 *  orden (retiene el 404 de las hojas hasta que el mundo está pintado, y lo
 *  afirma como precondición). En el clon limpio real el orden es el contrario
 *  —el vestido falla antes de que llegue el tile— y entonces quien impide el
 *  save es el reset de la faceta, no esto. Los tests de abajo cubren los DOS
 *  órdenes porque los dos ocurren. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createEntrada } from "../src/session/entrada.js";

/** Espía: anota cada anuncio con el id que le llegó. */
function espia(): { entradas: string[]; alEntrar: (id: string) => void } {
  const entradas: string[] = [];
  return { entradas, alEntrar: (id) => entradas.push(id) };
}

describe("entrada en la partida: vestido ∧ mundo pintado", () => {
  it("con el mundo pintado pero sin vestir NO se ha entrado (el caso medido del guion 27)", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("1787-abc");
    e.mundoPintado();
    assert.deepEqual(entradas, [], "el tile llega antes de que falle el vestido: aún no hay partida");
  });

  it("vestido sin mundo tampoco (la partida sin mundo de #189)", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("1787-abc");
    e.vestido();
    assert.deepEqual(entradas, []);
  });

  it("mundo y luego vestido: se entra, con el id de la sesión", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("1787-abc");
    e.mundoPintado();
    e.vestido();
    assert.deepEqual(entradas, ["1787-abc"]);
  });

  it("vestido y luego mundo: el mismo desenlace (el orden lo decide el día)", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("1787-abc");
    e.vestido();
    e.mundoPintado();
    assert.deepEqual(entradas, ["1787-abc"]);
  });

  it("sin sesión no se entra en nada, por muchas mitades que lleguen", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.vestido();
    e.mundoPintado();
    assert.deepEqual(entradas, [], "anunciar la entrada en una partida sin identidad no significa nada");
  });

  it("se anuncia UNA sola vez: los tiles siguientes no vuelven a establecer", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("1787-abc");
    e.vestido();
    e.mundoPintado();
    // El jugador cruza fronteras: llegan más tiles, y el vestido se rehace al
    // cambiar de skin. Nada de eso es entrar otra vez.
    e.mundoPintado();
    e.mundoPintado();
    e.vestido();
    assert.deepEqual(entradas, ["1787-abc"]);
  });

  it("cambiar de sesión OLVIDA lo que había llegado de la anterior", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("primera");
    e.vestido();
    // Vuelta al título y otra partida: el vestido era de la que no arrancó.
    e.sesion("segunda");
    e.mundoPintado();
    assert.deepEqual(entradas, [], "media entrada de la partida anterior no puede establecer esta");
    e.vestido();
    assert.deepEqual(entradas, ["segunda"]);
  });

  it("volver al título (sesión \"\") desarma la entrada a medias", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("1787-abc");
    e.mundoPintado();
    e.sesion(""); // `leave()`: el neutro de la faceta
    e.vestido();
    assert.deepEqual(entradas, [], "sin partida no hay nada que establecer");
  });

  it("una partida ya establecida se puede volver a entrar tras salir y volver", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("1787-abc");
    e.vestido();
    e.mundoPintado();
    e.sesion("");
    e.sesion("1787-abc"); // reanudar la MISMA partida
    e.vestido();
    e.mundoPintado();
    assert.deepEqual(entradas, ["1787-abc", "1787-abc"]);
  });

  it("re-declarar la MISMA sesión no olvida la mitad que ya llegó", () => {
    const { entradas, alEntrar } = espia();
    const e = createEntrada(alEntrar);
    e.sesion("1787-abc");
    e.mundoPintado();
    e.sesion("1787-abc"); // el mismo valor otra vez: no es un cambio
    e.vestido();
    assert.deepEqual(entradas, ["1787-abc"]);
  });
});
