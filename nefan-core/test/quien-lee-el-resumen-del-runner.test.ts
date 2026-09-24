/**
 * Quien lee el RESUMEN de `node --test` decide también por el CÓDIGO DE SALIDA (#697).
 *
 * Desde v24.15.0, Node sale con 1 cuando el cuerpo de un `describe` lanza, pero
 * el resumen sigue diciendo `ℹ fail 0` (y `ℹ tests` no cuenta la suite: medido en
 * v26.10.0, tanda AR). Así que un arnés que decida por `ℹ fail N`, por
 * `ℹ tests N` o por los `✖` que recoge su regex lee «verde» una batería rota. La
 * tanda AR encontró cinco así: el arnés de mutación (que tomaba por sana una base
 * rota) y los guiones 151, 152 y 163 (lo mismo), y el 148 por redundancia.
 *
 * Esto es su padrón. Todo fichero del banco (`qa/**`) o de `nefan-core/scripts/`
 * con una línea de CÓDIGO que lea el resumen (`ℹ fail|tests|pass`, `# fail|tests`
 * de TAP) tiene fila, y la fila nombra el TROZO literal por el que el código de
 * salida entra en la decisión, que tiene que estar en el fichero. Totalidad en
 * las dos direcciones: un lector nuevo sin fila es rojo, y una fila sin lector
 * es rojo (se movió o se borró: actualízala).
 *
 * LO QUE ESTO NO SUJETA: es un censo por GRAFÍA. No ve un lector que construya
 * la regex con otra escritura (`new RegExp("ℹ " + …)`, un `\u2139`), ni
 * comprueba que el trozo declarado esté en el MISMO camino de decisión que el
 * lector: solo que el fichero lo contiene. Lo que sí garantiza es que nadie
 * añade un lector del resumen sin que alguien tenga que escribir, en esta
 * tabla, por dónde entra el código de salida.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fuentesDelBanco } from "./banco-ficheros.js";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = join(CORE, "..");

/** Una línea que LEE el resumen: la cadena dentro de una regex o un literal. */
const LEE_EL_RESUMEN = /(ℹ (fail|tests|pass)|# (fail|tests)) \(/;
/** Prosa que no cuenta: comentarios de bloque y de línea. */
const ES_PROSA = /^(\*|\/\/|\/\*)/;

/** fichero relativo a la raíz → trozo literal por el que decide el EXIT, y por qué. */
const PADRON: Record<string, { exit: string; porque: string }> = {
  "qa/contrato-candados-en-negativo.mjs": {
    exit: 'bateria.startsWith("ts:") && r.status !== 0',
    porque: "rojo = fallos > 0 o EXIT ≠ 0; la base exige los dos a cero",
  },
  "qa/mutacion-candados-en-negativo.mjs": {
    exit: "const rojo = r.fallos > 0 || r.status !== 0;",
    porque: "igual que el de contrato desde la tanda AR; antes una base rota pasaba por sana",
  },
  "qa/guiones/148-el-banco-del-cliente-puede-ponerse-rojo.mjs": {
    exit: "if (r.status !== 0 && rojos.length === 0) rojos.push(",
    porque: "decide por los ✖ de columna cero (que ya recogen el describe roto); el EXIT sin ✖ es un rojo más",
  },
  "qa/guiones/151-el-candado-del-prefijo-puede-ponerse-rojo.mjs": {
    exit: "if (r.status !== 0 && rojos.length === 0) rojos.push(",
    porque: "decide por los ✖ indentados; un describe de primer nivel que lanza no deja ninguno",
  },
  "qa/guiones/152-el-padron-de-clientes-ws-puede-ponerse-rojo.mjs": {
    exit: "if (r.status !== 0 && rojos.length === 0) rojos.push(",
    porque: "decide por los ✖ indentados; un describe de primer nivel que lanza no deja ninguno",
  },
  "qa/guiones/163-el-candado-del-barrido-unico-puede-ponerse-rojo.mjs": {
    exit: "if (r.status !== 0 && rojos.length === 0) rojos.push(",
    porque: "decide por los ✖ indentados; un describe de primer nivel que lanza no deja ninguno",
  },
  "qa/guiones/165-una-suite-que-lanza-pone-rojo-cada-entrada-al-runner.mjs": {
    exit: "r.status !== 0 && r.salida.includes(",
    porque: "el guion ES la medida del EXIT; `ℹ fail` solo se imprime",
  },
  "nefan-core/scripts/paso-b-tap.ts": {
    exit: "const bien = exit === 0 &&",
    porque: "bench del tap-runner: exige EXIT 0 además de `# fail 0`",
  },
};

function lectores(): Map<string, number[]> {
  const ficheros = [
    ...fuentesDelBanco(join(RAIZ, "qa")).map((f) => `qa/${f}`),
    ...readdirSync(join(CORE, "scripts"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `nefan-core/scripts/${f}`),
  ];
  const out = new Map<string, number[]>();
  for (const rel of ficheros) {
    const lineas = readFileSync(join(RAIZ, rel), "utf8").split("\n");
    const hits = lineas.flatMap((l, i) => (!ES_PROSA.test(l.trim()) && LEE_EL_RESUMEN.test(l) ? [i + 1] : []));
    if (hits.length > 0) out.set(rel, hits);
  }
  return out;
}

describe("quien lee el resumen de node --test decide también por el código de salida (#697)", () => {
  const censo = lectores();

  it("el censo encuentra lectores: la totalidad tiene sujeto", () => {
    assert.ok(censo.size >= 5, `solo ${censo.size} lector(es): ¿se rompió el censo?`);
  });

  it("todo lector del resumen está en el padrón", () => {
    const sinFila = [...censo].filter(([rel]) => !(rel in PADRON)).map(([rel, l]) => `${rel}:${l.join(",")}`);
    assert.deepEqual(
      sinFila,
      [],
      `lee el resumen (ℹ fail / ℹ tests) y nadie ha dicho por dónde decide el EXIT: un describe que lanza ` +
        `sale con 1 y \`ℹ fail 0\`. Haz que decida también por \`status\` y añádelo al padrón:\n  ${sinFila.join("\n  ")}`,
    );
  });

  it("toda fila del padrón apunta a un lector vivo", () => {
    const muertas = Object.keys(PADRON).filter((rel) => !censo.has(rel));
    assert.deepEqual(muertas, [], `ya no leen el resumen (se movieron o se borraron): quita su fila`);
  });

  it("cada lector contiene el trozo por el que el EXIT entra en su decisión", () => {
    const sinTrozo = Object.entries(PADRON)
      .filter(([rel]) => censo.has(rel))
      .filter(([rel, { exit }]) => !readFileSync(join(RAIZ, rel), "utf8").includes(exit))
      .map(([rel, { exit }]) => `${rel}: falta «${exit}»`);
    assert.deepEqual(sinTrozo, [], sinTrozo.join("\n"));
  });
});
