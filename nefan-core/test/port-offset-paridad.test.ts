/** `NEFAN_PORT_OFFSET` se valida en TRES sitios y tienen que decir lo mismo.
 *
 *  El desplazamiento del bloque de puertos lo aplica cada capa por su cuenta
 *  —el snapshot lleva el bloque BASE a propósito, porque es uno por checkout y
 *  dos corridas simultáneas se lo pisarían—, así que hay tres implementaciones
 *  de la misma regla: `portOffset` (TS, y con él el navegador), `offsetActual`
 *  (`qa/lib/stack.mjs`, el banco) y un `[[ =~ ]]` en `start.sh`.
 *
 *  Tres copias de una regla es exactamente donde esta casa ya sabe qué pasa:
 *  divergen y nadie se entera hasta que un stack arranca encima del vecino
 *  justo cuando alguien creía haberlo separado. El precedente es el espejo del
 *  zod de escena en Python, que va con un test que compara; este es el mismo
 *  trato. La tabla es una sola y la comen las tres.
 *
 *  Lo que se compara es el VEREDICTO (acepta con este valor / rechaza), no el
 *  mensaje: bash no puede devolver un número y no tiene por qué.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { portOffset } from "../src/contracts/service-registry.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** La tabla. Cada fila: el valor crudo y qué debe pasar con él. */
const TABLA: ReadonlyArray<{ raw: string; acepta: boolean; nota: string }> = [
  { raw: "", acepta: true, nota: "vacío = sin desplazar (el uso de una persona)" },
  { raw: "0", acepta: true, nota: "cero explícito = los puertos de siempre" },
  { raw: "100", acepta: true, nota: "el bloque típico de la segunda corrida" },
  { raw: "40000", acepta: true, nota: "el borde superior, incluido" },
  { raw: "-1", acepta: false, nota: "negativo" },
  { raw: "1.5", acepta: false, nota: "no entero" },
  { raw: "0x10", acepta: false, nota: "hexadecimal: Number() lo aceptaría como 16" },
  { raw: " ", acepta: false, nota: "espacio: Number() lo aceptaría como 0" },
  { raw: "cien", acepta: false, nota: "no es un número" },
  { raw: "40001", acepta: false, nota: "fuera de rango" },
];

/** ¿Acepta la implementación de TypeScript? */
function aceptaTs(raw: string): boolean {
  try {
    portOffset({ NEFAN_PORT_OFFSET: raw });
    return true;
  } catch {
    return false;
  }
}

/** ¿Acepta la del banco de pruebas (`qa/lib/stack.mjs`)? */
async function aceptaBanco(raw: string): Promise<boolean> {
  const { offsetActual } = (await import(
    join(repoRoot, "qa", "lib", "stack.mjs")
  )) as { offsetActual: (env: Record<string, string | undefined>) => number };
  try {
    offsetActual({ NEFAN_PORT_OFFSET: raw });
    return true;
  } catch {
    return false;
  }
}

/** ¿Acepta `start.sh`? Se le pregunta al script DE VERDAD, no a una copia de su
 *  condición: `--list` no arranca nada y la validación del offset corre antes
 *  de mirar los argumentos, así que el código de salida es el veredicto. */
function aceptaBash(raw: string): boolean {
  try {
    execFileSync("./start.sh", ["--list"], {
      cwd: repoRoot,
      env: { ...process.env, NEFAN_PORT_OFFSET: raw },
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

describe("NEFAN_PORT_OFFSET: las tres validaciones dicen lo mismo", () => {
  for (const { raw, acepta, nota } of TABLA) {
    it(`${JSON.stringify(raw)} → ${acepta ? "acepta" : "rechaza"} (${nota})`, async () => {
      const ts = aceptaTs(raw);
      const banco = await aceptaBanco(raw);
      const bash = aceptaBash(raw);
      assert.equal(ts, acepta, `portOffset (TS) debería ${acepta ? "aceptar" : "rechazar"}`);
      assert.equal(banco, acepta, `offsetActual (qa/lib/stack.mjs) debería ${acepta ? "aceptar" : "rechazar"}`);
      assert.equal(bash, acepta, `start.sh debería ${acepta ? "aceptar" : "rechazar"}`);
    });
  }
});
