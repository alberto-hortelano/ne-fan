/** Tanda BA (#755) — LA LÍNEA DE BALANCE DE SKINS CUENTA PERSONAJES.
 *
 *  El jugador leía «15 sin arte pagado» con cinco personajes delante: la
 *  cadena sumaba una por ANIM y cada personaje pregunta por tres. Aquí se
 *  sujetan las dos piezas que lo arreglan, las dos puras y las dos del
 *  cliente: el texto (`rotuloDelBalanceDeSkins`, derivación de datos a string)
 *  y la clasificación por personaje de la cadena, que no toca DOM ni red. El
 *  flujo de verdad, contra `__nefan.skins` y el motor falso, es el guion 194.
 *
 *  NO MURIÓ NINGÚN GUION (regla 2): ninguno afirmaba el texto de la línea. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CadenaDeSkins, rotuloDelBalanceDeSkins } from "../src/renderer/cadena-de-skins.js";

describe("rotuloDelBalanceDeSkins", () => {
  it("sin nada que contar no hay línea", () => {
    assert.equal(rotuloDelBalanceDeSkins({ restaurados: 0, aMedias: 0, sinArte: 0 }), null);
  });

  it("singular y plural, y los términos a cero no salen", () => {
    assert.equal(
      rotuloDelBalanceDeSkins({ restaurados: 1, aMedias: 0, sinArte: 0 }),
      "Skins: 1 personaje restaurado de la librería ($0)",
    );
    assert.equal(
      rotuloDelBalanceDeSkins({ restaurados: 0, aMedias: 0, sinArte: 5 }),
      "Skins: 5 personajes sin arte pagado (base y_bot)",
    );
    assert.equal(
      rotuloDelBalanceDeSkins({ restaurados: 2, aMedias: 1, sinArte: 1 }),
      "Skins: 2 personajes restaurados de la librería ($0), 1 personaje restaurado a medias, " +
        "1 personaje sin arte pagado (base y_bot)",
    );
    assert.equal(
      rotuloDelBalanceDeSkins({ restaurados: 0, aMedias: 3, sinArte: 0 }),
      "Skins: 3 personajes restaurados a medias",
    );
  });

  it("nunca dice «anim»: es jerga del gestor", () => {
    for (const c of [
      { restaurados: 1, aMedias: 1, sinArte: 1 },
      { restaurados: 7, aMedias: 0, sinArte: 2 },
    ]) {
      assert.doesNotMatch(rotuloDelBalanceDeSkins(c) ?? "", /anim/i);
    }
  });
});

/** Una tanda de la cadena: cada paso apunta lo que diga, y se espera a que la
 *  cadena se vacíe. */
async function tanda(cadena: CadenaDeSkins, apuntes: Array<["restaurado" | "sinArte", string]>): Promise<void> {
  for (const [que, quien] of apuntes) {
    cadena.encolar(async () => {
      cadena[que](quien);
    });
  }
  for (let i = 0; i < apuntes.length + 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function montar() {
  const cadena = new CadenaDeSkins();
  const lineas: string[] = [];
  cadena.anunciar = (m) => lineas.push(m);
  return { cadena, lineas };
}

describe("la cadena clasifica por PERSONAJE", () => {
  it("cinco personajes con tres anims sin arte cada uno son CINCO, no quince", async () => {
    const { cadena, lineas } = montar();
    const apuntes: Array<["sinArte", string]> = [];
    for (const p of ["a", "b", "c", "d", "e"]) for (let i = 0; i < 3; i++) apuntes.push(["sinArte", p]);
    await tanda(cadena, apuntes);
    assert.deepEqual(lineas, ["Skins: 5 personajes sin arte pagado (base y_bot)"]);
  });

  it("restaurado, a medias y sin arte, por lo que le pasó a cada uno en la tanda", async () => {
    const { cadena, lineas } = montar();
    await tanda(cadena, [
      ["restaurado", "entero"],
      ["restaurado", "entero"],
      ["restaurado", "medio"],
      ["sinArte", "medio"],
      ["sinArte", "nada"],
    ]);
    assert.deepEqual(lineas, [
      "Skins: 1 personaje restaurado de la librería ($0), 1 personaje restaurado a medias, " +
        "1 personaje sin arte pagado (base y_bot)",
    ]);
  });

  it("la lazy de un personaje YA CONTADO no produce otra línea; la de uno nuevo sí, y solo con él", async () => {
    const { cadena, lineas } = montar();
    await tanda(cadena, [["sinArte", "herrera"]]);
    await tanda(cadena, [["sinArte", "herrera"]]); // su ataque, después
    assert.equal(lineas.length, 1, JSON.stringify(lineas));
    await tanda(cadena, [
      ["sinArte", "herrera"],
      ["restaurado", "guardia"],
    ]);
    assert.deepEqual(lineas.slice(1), ["Skins: 1 personaje restaurado de la librería ($0)"]);
  });

  it("`olvidarContados` (entrar o reanudar) vuelve a contarlos", async () => {
    const { cadena, lineas } = montar();
    await tanda(cadena, [["sinArte", "herrera"]]);
    cadena.olvidarContados();
    await tanda(cadena, [["sinArte", "herrera"]]);
    assert.equal(lineas.length, 2, JSON.stringify(lineas));
  });

  it("una tanda sin apuntes (lo que se GENERÓ) no dice nada", async () => {
    const { cadena, lineas } = montar();
    cadena.encolar(async () => {});
    await tanda(cadena, []);
    assert.deepEqual(lineas, []);
  });
});
