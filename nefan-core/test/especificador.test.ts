/** La resolución de especificadores compartida (`scripts/especificador.ts`).
 *
 *  Tres piezas la usan —el plan de mutación, el selector de lo afectado y el
 *  colector del checker de fronteras—, y la parte que nadie más ejercitaba era
 *  el lector de alias del tsconfig: QA de #359 (hallazgo 2) cambió su `throw`
 *  por un `continue` y todo siguió en verde. Un alias que el lector ignorase
 *  resolvería a «paquete» y el cierre de imports lo podaría en silencio, que es
 *  el hueco que el checker existe para cerrar. Aquí se prueba con tsconfigs
 *  SINTÉTICOS en un directorio efímero: los tres casos que lanzan, la forma
 *  buena, el `baseUrl` y el ámbito del alias. */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aliasDeTsconfig,
  baseDeAlias,
  baseRelativa,
  candidatosDe,
  primeroEnDisco,
} from "../scripts/especificador.js";

const dir = mkdtempSync(join(tmpdir(), "especificador-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** Un tsconfig sintético en su propio subdirectorio; devuelve su ruta. */
function tsconfig(compilerOptions: Record<string, unknown>): string {
  const sub = join(dir, `t${n++}`);
  mkdirSync(sub, { recursive: true });
  const ruta = join(sub, "tsconfig.json");
  writeFileSync(ruta, JSON.stringify({ compilerOptions }));
  return ruta;
}

describe("especificador · alias del tsconfig", () => {
  it("la forma buena (`x/*` → [`dir/*`]) resuelve prefijo, destino y ámbito", () => {
    const ruta = tsconfig({ paths: { "@x/*": ["../core/*"] } });
    const alias = aliasDeTsconfig(ruta);
    assert.deepEqual(alias, [{ prefijo: "@x/", destinoAbs: join(dir, "core"), dirAbs: join(dir, `t${n - 1}`) }]);
  });

  it("`baseUrl` desplaza el destino", () => {
    const ruta = tsconfig({ baseUrl: "./src", paths: { "@x/*": ["lib/*"] } });
    assert.equal(aliasDeTsconfig(ruta)[0].destinoAbs, join(dir, `t${n - 1}`, "src", "lib"));
  });

  it("dos destinos para el mismo alias LANZAN: el lector no elige por él", () => {
    const ruta = tsconfig({ paths: { "@x/*": ["a/*", "b/*"] } });
    assert.throws(() => aliasDeTsconfig(ruta), /"@x\/\*" → \["a\/\*","b\/\*"\] no tiene la forma "x\/\*"/);
  });

  it("una clave sin comodín LANZA", () => {
    const ruta = tsconfig({ paths: { "@x": ["a"] } });
    assert.throws(() => aliasDeTsconfig(ruta), /"@x" → \["a"\] no tiene la forma/);
  });

  it("un destino sin comodín LANZA", () => {
    const ruta = tsconfig({ paths: { "@x/*": ["a"] } });
    assert.throws(() => aliasDeTsconfig(ruta), /no tiene la forma/);
  });

  it("sin `paths` no hay alias, y no es un error", () => {
    assert.deepEqual(aliasDeTsconfig(tsconfig({ strict: true })), []);
  });

  it("un tsconfig que no existe LANZA en vez de devolver cero alias", () => {
    assert.throws(() => aliasDeTsconfig(join(dir, "no-existe", "tsconfig.json")));
  });

  it("el alias solo vale para los ficheros bajo el directorio de su tsconfig", () => {
    const alias = aliasDeTsconfig(tsconfig({ paths: { "@x/*": ["../core/*"] } }));
    const dentro = join(alias[0].dirAbs, "src", "main.ts");
    const fuera = join(dir, "otro", "main.ts");
    assert.equal(baseDeAlias(dentro, "@x/src/a.js", alias), join(dir, "core", "src", "a.js"));
    assert.equal(baseDeAlias(fuera, "@x/src/a.js", alias), undefined, "otro paquete no hereda el alias");
    assert.equal(baseDeAlias(dentro, "@y/src/a.js", alias), undefined, "otro prefijo no casa");
  });
});

describe("especificador · candidatos", () => {
  it("la lista, en orden: `.js`→`.ts`, `.mts`, `.ts` añadido, tal cual, `index.ts`", () => {
    assert.deepEqual(candidatosDe("/r/a.js"), ["/r/a.ts", "/r/a.mts", "/r/a.js.ts", "/r/a.js", "/r/a.js/index.ts"]);
    assert.deepEqual(candidatosDe("/r/a"), ["/r/a.ts", "/r/a.mts", "/r/a.ts", "/r/a", "/r/a/index.ts"]);
  });

  it("solo los relativos tienen base; un paquete o un builtin no", () => {
    assert.equal(baseRelativa("/r/src/x.ts", "./y.js"), "/r/src/y.js");
    assert.equal(baseRelativa("/r/src/x.ts", "../y.js"), "/r/y.js");
    assert.equal(baseRelativa("/r/src/x.ts", "node:fs"), undefined);
    assert.equal(baseRelativa("/r/src/x.ts", "three"), undefined);
  });

  it("en disco: un directorio con el mismo nombre no cuenta, su `index.ts` sí; nada → undefined", () => {
    const sub = join(dir, "disco");
    mkdirSync(join(sub, "d"), { recursive: true });
    writeFileSync(join(sub, "d", "index.ts"), "");
    writeFileSync(join(sub, "f.ts"), "");
    assert.equal(primeroEnDisco(join(sub, "d")), join(sub, "d", "index.ts"));
    assert.equal(primeroEnDisco(join(sub, "f.js")), join(sub, "f.ts"));
    assert.equal(primeroEnDisco(join(sub, "no")), undefined);
  });
});
