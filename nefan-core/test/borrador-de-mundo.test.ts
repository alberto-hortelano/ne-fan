/** El borrador de mundo (PR 7 de #241): el umbral que decide si se llama al
 *  motor narrativo para desarrollar un mundo entero (1-3 min de génesis) y el
 *  texto que lee el jugador cuando no. Los casos van al FILO del umbral en las
 *  dos direcciones —19/20 y 64.000/64.001— porque un mutante que cambie `<` por
 *  `<=` solo se ve ahí, y con espacios porque el recorte es parte de la regla:
 *  antes lo hacía cada llamante por su cuenta. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BORRADOR_MAX,
  BORRADOR_MIN,
  MOTIVOS_DE_BORRADOR,
  validarBorrador,
} from "../src/protocol/borrador-de-mundo.js";

const deLargo = (n: number): string => "a".repeat(n);

describe("validarBorrador", () => {
  const casos: Array<[string, string, boolean]> = [
    ["19 caracteres", deLargo(19), false],
    ["20 caracteres (el mínimo justo)", deLargo(20), true],
    ["21 caracteres", deLargo(21), true],
    ["64.000 caracteres (el máximo justo)", deLargo(64_000), true],
    ["64.001 caracteres", deLargo(64_001), false],
    ["vacío", "", false],
    ["solo espacios", "                              ", false],
  ];
  for (const [nombre, texto, valido] of casos) {
    it(`${nombre} ⇒ ${valido ? "vale" : "no vale"}`, () => {
      assert.equal(validarBorrador(texto).ok, valido);
    });
  }

  it("los espacios de los bordes NO cuentan para el mínimo", () => {
    // 19 caracteres con adornos alrededor siguen siendo 19: es el caso que
    // separa «recortar y medir» de «medir y recortar», y es el que hacía que el
    // mismo texto valiera en el título y no en el bridge.
    assert.equal(validarBorrador(`   ${deLargo(19)}   `).ok, false);
    assert.equal(validarBorrador(`\n\t ${deLargo(20)} \n`).ok, true);
  });

  it("ni para el máximo", () => {
    assert.equal(validarBorrador(`   ${deLargo(BORRADOR_MAX)}   `).ok, true);
    assert.equal(validarBorrador(`   ${deLargo(BORRADOR_MAX + 1)}   `).ok, false);
  });

  it("devuelve el borrador YA recortado, que es lo que se manda al motor", () => {
    const res = validarBorrador("  Un archipiélago de islas voladoras.  ");
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.borrador, "Un archipiélago de islas voladoras.");
  });

  it("cada rechazo trae SU motivo, y el motivo dice el número", () => {
    const corto = validarBorrador(deLargo(BORRADOR_MIN - 1));
    const largo = validarBorrador(deLargo(BORRADOR_MAX + 1));
    assert.equal(corto.ok, false);
    assert.equal(largo.ok, false);
    assert.equal(corto.ok === false && corto.error, MOTIVOS_DE_BORRADOR.corto);
    assert.equal(largo.ok === false && largo.error, MOTIVOS_DE_BORRADOR.largo);
    assert.notEqual(MOTIVOS_DE_BORRADOR.corto, MOTIVOS_DE_BORRADOR.largo);
    // El número va DENTRO del texto porque «unas frases» no dice cuánto falta,
    // y con miles a la española (sin ICU: ver el módulo).
    assert.match(MOTIVOS_DE_BORRADOR.corto, /mínimo 20 caracteres/);
    assert.match(MOTIVOS_DE_BORRADOR.largo, /máximo 64\.000 caracteres/);
  });
});
