/** Los rechazos del pre-flight de narrative-mcp dejan UNA línea en stderr con
 *  su clase (QA de la tanda BM, H4). Antes solo volvían al modelo como
 *  `isError`, y el log de narrative-mcp no tenía ni rastro: un playtest no
 *  podía contar cuántas veces rebotaba un `role` sin guardar la transcripción
 *  entera del motor.
 *
 *  Dos piezas: (a) `rechazo()` escribe la línea y devuelve el `isError`; (b)
 *  por el ÁRBOL de `narrative-mcp/server.ts`, los manejadores de
 *  `narrative_respond` y `map_upsert_place` no devuelven NINGÚN objeto literal
 *  con `isError`: todo rechazo sale por `rechazo()`.
 *
 *  Lo que esto NO sujeta: que la CLASE nombrada sea la correcta para cada
 *  rechazo (un `rechazo('ground', …)` en la rama de volumes saldría verde), ni
 *  los manejadores de las demás tools, que siguen devolviendo su `isError`
 *  literal sin rastro. */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Rechazo = (
  clase: string,
  texto: string,
  donde?: { kind?: string; req?: string | null },
) => { content: Array<{ type: "text"; text: string }>; isError: true };

let rechazo: Rechazo;
let RECHAZO_MAX_CHARS: number;

/** La raíz del repo buscada hacia arriba (el sandbox de Stryker vive a otra
 *  profundidad; mismo patrón que `world-map-schema.test.ts`). */
function raizDelRepo(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "narrative-mcp")) && existsSync(join(dir, "nefan-core"))) return dir;
    const arriba = dirname(dir);
    if (arriba === dir) break;
    dir = arriba;
  }
  throw new Error(`no encuentro la raíz del repo subiendo desde ${dirname(fileURLToPath(import.meta.url))}`);
}

before(async () => {
  ({ rechazo, RECHAZO_MAX_CHARS } = (await import(
    pathToFileURL(join(raizDelRepo(), "narrative-mcp", "rechazo.ts")).href
  )) as { rechazo: Rechazo; RECHAZO_MAX_CHARS: number });
});

function capturarStderr<T>(fn: () => T): { valor: T; lineas: string[] } {
  const lineas: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lineas.push(args.map(String).join(" "));
  try {
    return { valor: fn(), lineas };
  } finally {
    console.error = original;
  }
}

describe("rechazo() — una línea en stderr por rechazo", () => {
  it("escribe clase, kind y req en UNA línea y devuelve el texto entero como isError", () => {
    const texto = "Unplayable scene — fix these:\n- spawn bloqueado\n- sin salida";
    const { valor, lineas } = capturarStderr(() =>
      rechazo("injugable", texto, { kind: "scene", req: "req-7" }),
    );
    assert.equal(lineas.length, 1);
    assert.equal(
      lineas[0],
      "[narrative-mcp] rechazo injugable kind=scene req=req-7: Unplayable scene — fix these: | - spawn bloqueado | - sin salida",
    );
    assert.deepEqual(valor, { content: [{ type: "text", text: texto }], isError: true });
  });

  it("sin kind ni req pone «-», y recorta la línea (no el texto al modelo)", () => {
    const largo = "x".repeat(RECHAZO_MAX_CHARS + 50);
    const { valor, lineas } = capturarStderr(() => rechazo("anchor", largo));
    assert.equal(lineas[0], `[narrative-mcp] rechazo anchor kind=- req=-: ${"x".repeat(RECHAZO_MAX_CHARS)}`);
    assert.equal(valor.content[0]!.text, largo);
  });
});

describe("narrative-mcp: todo rechazo del pre-flight pasa por rechazo()", () => {
  const ruta = () => join(raizDelRepo(), "narrative-mcp", "server.ts");

  function manejador(fuente: ts.SourceFile, tool: string): ts.Node {
    let hallado: ts.Node | null = null;
    const buscar = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "tool" &&
        n.arguments[0] &&
        ts.isStringLiteralLike(n.arguments[0]) &&
        n.arguments[0].text === tool
      ) {
        hallado = n.arguments[n.arguments.length - 1]!;
      }
      ts.forEachChild(n, buscar);
    };
    buscar(fuente);
    assert.ok(hallado, `no encuentro server.tool('${tool}', …) en narrative-mcp/server.ts`);
    return hallado;
  }

  function censo(nodo: ts.Node): { literales: string[]; llamadas: number } {
    const literales: string[] = [];
    let llamadas = 0;
    const visitar = (n: ts.Node): void => {
      if (
        ts.isObjectLiteralExpression(n) &&
        n.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "isError")
      ) {
        literales.push(n.getText().slice(0, 80));
      }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "rechazo") llamadas++;
      ts.forEachChild(n, visitar);
    };
    visitar(nodo);
    return { literales, llamadas };
  }

  it("narrative_respond y map_upsert_place: cero isError literales y todas sus salidas de error con rechazo()", () => {
    const fuente = ts.createSourceFile(ruta(), readFileSync(ruta(), "utf8"), ts.ScriptTarget.Latest, true);
    const respond = censo(manejador(fuente, "narrative_respond"));
    const upsert = censo(manejador(fuente, "map_upsert_place"));
    assert.deepEqual(respond.literales, [], "narrative_respond devuelve un isError sin dejar rastro");
    assert.deepEqual(upsert.literales, [], "map_upsert_place devuelve un isError sin dejar rastro");
    // 13 salidas del pre-flight de respond (una por clase, más el catch) y 2
    // de upsert. Si bajan, alguna rama de error dejó de existir o se escapó
    // por otra vía: se mira antes de ajustar el número.
    assert.ok(respond.llamadas >= 13, `narrative_respond: ${respond.llamadas} llamadas a rechazo(), esperaba ≥ 13`);
    assert.ok(upsert.llamadas >= 2, `map_upsert_place: ${upsert.llamadas} llamadas a rechazo(), esperaba ≥ 2`);
  });
});
