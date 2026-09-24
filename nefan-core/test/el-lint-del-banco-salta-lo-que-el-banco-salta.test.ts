/** El lint del banco (`eslint.qa.config.js`, #733) salta EXACTAMENTE lo que
 *  salta el barrido del banco (`SALTOS_DEL_BANCO`, `test/banco-ficheros.ts`).
 *
 *  Son dos respuestas a la misma pregunta —«qué es el banco»— y dos respuestas
 *  acaban divergiendo: es la lección de #686, donde cada test tenía sus saltos
 *  y un `qa/capturas/x.mjs` era invisible para uno y legal para otro. Si el
 *  lint saltara MENOS, un día recorrería los 15.000 PNG de `capturas/` o los
 *  `.mjs` de usar y tirar de `.tmp/`; si saltara MÁS, un guion bajo ese nombre
 *  quedaría sin lint mientras el resto del banco lo ve.
 *
 *  Por nombre y a cualquier profundidad, como el barrido: cada salto es
 *  `qa/**\/<salto>/`. `node_modules` es la excepción declarada — ESLint lo
 *  ignora siempre, y escribirlo sería decir dos veces lo mismo.
 *
 *  Unitario puro: importa la config y compara. Que ESLint APLIQUE esos ignores
 *  como se espera lo mide el guion 175, que corre el `lint:qa` de verdad. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SALTOS_DEL_BANCO } from "./banco-ficheros.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOS_IGNORA_ESLINT = new Set(["node_modules"]);

/** Los `ignores` GLOBALES de la config (un objeto que solo tiene `ignores`). */
async function ignoresDeLaConfig(): Promise<string[]> {
  const mod: unknown = await import(pathToFileURL(join(raiz, "eslint.qa.config.js")).href);
  const config = (mod as { default?: unknown }).default;
  assert.ok(Array.isArray(config), "eslint.qa.config.js exporta un array de configs");
  const globales = config.filter(
    (c): c is { ignores: string[] } =>
      typeof c === "object" && c !== null && Object.keys(c).length === 1 && Array.isArray((c as { ignores?: unknown }).ignores),
  );
  return globales.flatMap((c) => c.ignores);
}

const comoIgnore = (salto: string): string => `qa/**/${salto}/`;

test("el lint del banco salta TODO lo que salta el barrido del banco (menos lo que ESLint ya ignora)", async () => {
  const ignores = await ignoresDeLaConfig();
  const faltan = [...SALTOS_DEL_BANCO].filter((s) => !LOS_IGNORA_ESLINT.has(s) && !ignores.includes(comoIgnore(s)));
  assert.deepEqual(faltan, [], `saltos del banco que el lint recorrería: ${faltan.join(", ")} (ignores: ${JSON.stringify(ignores)})`);
});

test("…y NADA más: cada ignore del lint es un salto del banco", async () => {
  const ignores = await ignoresDeLaConfig();
  assert.ok(ignores.length > 0, "la config declara sus ignores globales (si no, el test de arriba no mira nada)");
  const esperados = new Set([...SALTOS_DEL_BANCO].map(comoIgnore));
  const deMas = ignores.filter((i) => !esperados.has(i));
  assert.deepEqual(deMas, [], `ignores del lint que no son saltos del banco: ${deMas.join(", ")}`);
});
