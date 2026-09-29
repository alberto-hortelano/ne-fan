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
 *  Y (c), F4 de la QA de la fase 2: lo que NO pasa por `rechazo()` —la
 *  validación de argumentos del SDK, el `isError` literal de las demás
 *  tools— lo escribe `vigilarErroresDeTool` en el transporte, medido con el
 *  SDK DE VERDAD (McpServer + Client por `InMemoryTransport`), sin duplicar
 *  la línea de lo que ya marcó `rechazo()`. (d), F3: `scene_validate` pasa
 *  por el mismo `preflightDeEscena` que `narrative_respond`.
 *
 *  Lo que esto NO sujeta: que la CLASE nombrada sea la correcta para cada
 *  rechazo (un `rechazo('ground', …)` en la rama de volumes saldría verde), ni
 *  que `server.ts` llame de verdad a `vigilarErroresDeTool` sobre SU
 *  transporte (se mira que la llamada exista, no se levanta el servidor). */
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
) => { content: Array<{ type: "text"; text: string }>; isError: true; _meta: Record<string, string> };

let rechazo: Rechazo;
let RECHAZO_MAX_CHARS: number;
let MARCA_DE_RECHAZO: string;
let vigilarErroresDeTool: (transporte: object) => void;

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
  ({ rechazo, RECHAZO_MAX_CHARS, MARCA_DE_RECHAZO, vigilarErroresDeTool } = (await import(
    pathToFileURL(join(raizDelRepo(), "narrative-mcp", "rechazo.ts")).href
  )) as {
    rechazo: Rechazo;
    RECHAZO_MAX_CHARS: number;
    MARCA_DE_RECHAZO: string;
    vigilarErroresDeTool: (transporte: object) => void;
  });
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
    assert.deepEqual(valor, {
      content: [{ type: "text", text: texto }],
      isError: true,
      _meta: { [MARCA_DE_RECHAZO]: "injugable" },
    });
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

  /** La función `function <nombre>(…)` de server.ts. */
  function funcion(fuente: ts.SourceFile, nombre: string): ts.Node {
    let hallada: ts.Node | null = null;
    const buscar = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === nombre) hallada = n;
      ts.forEachChild(n, buscar);
    };
    buscar(fuente);
    assert.ok(hallada, `no encuentro function ${nombre} en narrative-mcp/server.ts`);
    return hallada;
  }

  function llama(nodo: ts.Node, nombre: string): boolean {
    let si = false;
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre) si = true;
      ts.forEachChild(n, visitar);
    };
    visitar(nodo);
    return si;
  }

  it("narrative_respond, su preflightDeEscena y map_upsert_place: cero isError literales y sus salidas de error con rechazo()", () => {
    const fuente = ts.createSourceFile(ruta(), readFileSync(ruta(), "utf8"), ts.ScriptTarget.Latest, true);
    const respond = censo(manejador(fuente, "narrative_respond"));
    const escena = censo(funcion(fuente, "preflightDeEscena"));
    const upsert = censo(manejador(fuente, "map_upsert_place"));
    assert.deepEqual(respond.literales, [], "narrative_respond devuelve un isError sin dejar rastro");
    assert.deepEqual(escena.literales, [], "preflightDeEscena devuelve un isError sin dejar rastro");
    assert.deepEqual(upsert.literales, [], "map_upsert_place devuelve un isError sin dejar rastro");
    // 7 salidas del respond (sin petición, consequences, develop_world, las
    // dos de armas, injugable y el catch), 6 de la forma de una escena y 3 de
    // upsert (anchor, attrs_json y el rechazo del bridge). Si bajan, alguna
    // rama de error dejó de existir o se escapó por otra vía: se mira antes
    // de ajustar el número.
    assert.ok(respond.llamadas >= 7, `narrative_respond: ${respond.llamadas} llamadas a rechazo(), esperaba ≥ 7`);
    assert.ok(escena.llamadas >= 6, `preflightDeEscena: ${escena.llamadas} llamadas a rechazo(), esperaba ≥ 6`);
    assert.ok(upsert.llamadas >= 3, `map_upsert_place: ${upsert.llamadas} llamadas a rechazo(), esperaba ≥ 3`);
  });

  it("scene_validate y narrative_respond pasan por el MISMO preflightDeEscena (F3), y el transporte está vigilado (F4)", () => {
    const fuente = ts.createSourceFile(ruta(), readFileSync(ruta(), "utf8"), ts.ScriptTarget.Latest, true);
    assert.ok(llama(manejador(fuente, "narrative_respond"), "preflightDeEscena"), "narrative_respond ya no pasa por preflightDeEscena");
    assert.ok(llama(manejador(fuente, "scene_validate"), "preflightDeEscena"), "scene_validate no aplica la forma que exige el respond");
    assert.ok(llama(fuente, "vigilarErroresDeTool"), "server.ts ya no vigila el transporte");
  });
});

describe("vigilarErroresDeTool — lo que no pasa por rechazo() también deja línea (F4)", () => {
  /** McpServer y Client del SDK de narrative-mcp, unidos en memoria. */
  async function montar() {
    const sdk = join(raizDelRepo(), "narrative-mcp", "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
    const { McpServer } = (await import(pathToFileURL(join(sdk, "server", "mcp.js")).href)) as {
      McpServer: new (info: { name: string; version: string }) => {
        tool: (...args: unknown[]) => void;
        connect: (t: object) => Promise<void>;
      };
    };
    const { Client } = (await import(pathToFileURL(join(sdk, "client", "index.js")).href)) as {
      Client: new (info: { name: string; version: string }) => {
        connect: (t: object) => Promise<void>;
        callTool: (p: { name: string; arguments: Record<string, unknown> }) => Promise<{ isError?: boolean }>;
        close: () => Promise<void>;
      };
    };
    const { InMemoryTransport } = (await import(pathToFileURL(join(sdk, "inMemory.js")).href)) as {
      InMemoryTransport: { createLinkedPair: () => [object, object] };
    };
    const { z } = (await import(
      pathToFileURL(join(raizDelRepo(), "narrative-mcp", "node_modules", "zod", "index.js")).href
    )) as { z: { string: () => unknown } };

    const server = new McpServer({ name: "prueba", version: "0" });
    server.tool("con_args", "exige id", { id: z.string() }, async () => ({ content: [{ type: "text", text: "ok" }] }));
    server.tool("literal", "error sin rechazo()", {}, async () => ({
      content: [{ type: "text", text: "consequences_json is not valid JSON" }],
      isError: true,
    }));
    server.tool("marcado", "error por rechazo()", {}, async () => rechazo("anchor", "anchor inválido"));
    const [delCliente, delServidor] = InMemoryTransport.createLinkedPair();
    await server.connect(delServidor);
    vigilarErroresDeTool(delServidor);
    const client = new Client({ name: "motor", version: "0" });
    await client.connect(delCliente);
    return client;
  }

  async function lineasDe(fn: () => Promise<unknown>): Promise<string[]> {
    const lineas: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void lineas.push(args.map(String).join(" "));
    try {
      await fn();
    } finally {
      console.error = original;
    }
    return lineas.filter((l) => l.startsWith("[narrative-mcp] rechazo"));
  }

  it("argumentos que el SDK rechaza, un isError literal y uno de rechazo(): UNA línea cada uno", async () => {
    const client = await montar();
    try {
      const args = await lineasDe(() => client.callTool({ name: "con_args", arguments: {} }));
      assert.equal(args.length, 1, JSON.stringify(args));
      assert.match(args[0]!, /^\[narrative-mcp\] rechazo argumentos kind=con_args req=-: MCP error -32602: Input validation error: Invalid arguments for tool con_args/);

      const literal = await lineasDe(() => client.callTool({ name: "literal", arguments: {} }));
      assert.deepEqual(literal, [
        "[narrative-mcp] rechazo herramienta kind=literal req=-: consequences_json is not valid JSON",
      ]);

      // El de rechazo() ya escribió la suya: el vigilante no la repite.
      const marcado = await lineasDe(() => client.callTool({ name: "marcado", arguments: {} }));
      assert.deepEqual(marcado, ["[narrative-mcp] rechazo anchor kind=- req=-: anchor inválido"]);

      // Y lo que sale bien no escribe nada.
      assert.deepEqual(await lineasDe(() => client.callTool({ name: "con_args", arguments: { id: "x" } })), []);
    } finally {
      await client.close();
    }
  });
});
