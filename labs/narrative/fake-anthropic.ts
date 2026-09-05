// El MODELO falso detrás de `ANTHROPIC_BASE_URL` (#235).
//
// No es un ai_server falso: eso ya existe (`fake-ai-server.ts`) y sustituye el
// proceso Python ENTERO, así que ninguna corrida del banco atravesaba
// `ai_server` de verdad —ni su router, ni el SDK, ni `validate_scene_response`,
// que es la allow-list donde vivió #173 (los NPC llegaban sin `role` ni
// `description`). Este fichero sustituye solo la última pieza: el modelo. El
// SDK `anthropic` real del ai_server real lee `ANTHROPIC_BASE_URL` y manda aquí
// su `POST /v1/messages`; se le contesta con un `tool_use` de `generate_scene`
// cuyo `input` es el tile de bootstrap del motor falso (`fake-scenes.ts`, ya
// candado contra `EmittedSceneSchema` por `test/fake-motor-contract.test.ts`).
//
// EL BANCO NO PUEDE MENTIR: se cuenta cada llamada (`GET /health` →
// `llamadas`) y se guarda la última petición tal como llegó (`GET /servido`:
// clave de API, modelo, tool pedida e `input` devuelto). Quien mide afirma
// que hubo EXACTAMENTE una y que la clave es la falsa: si el camino no pasó por
// aquí —un snapshot que sirvió la escena, un ai_server que habló con otro— el
// contador lo dice. Y una petición que no pida `generate_scene` por
// `tool_choice` se rechaza con el 400 del contrato de Anthropic, no se
// complace: si ai_server cambiara de tool, esto se pone rojo en vez de servir
// una escena para una pregunta distinta.
//
// Cero créditos por construcción: aquí no hay ninguna clave real ni ningún
// proveedor al que llamar. El SDK del ai_server solo conoce esta URL.
//
// TypeScript por lo mismo que `fake-ai-server.ts` (#309): `npm run
// typecheck:labs` compila lo que este fichero HACE con `bootstrapTile()`.
//
// Env:
//   PORT   puerto HTTP. OBLIGATORIO: este stub no está en el catálogo de
//          `CONFIG.ports` (no es un servicio del juego, es el doble de uno
//          externo) y un número escrito aquí sería un puerto inventado.
//
// Arranque (un solo PID, para que quien lo lance pueda matarlo por su pid):
//   cd nefan-core && PORT=<p> node --import tsx ../labs/narrative/fake-anthropic.ts

import http from "node:http";

import { bootstrapTile } from "./fake-scenes.js";

/** Lo que el SDK manda en `messages.create` y este stub necesita mirar. */
interface PeticionMessages {
  model?: string;
  tool_choice?: { type?: string; name?: string };
  tools?: Array<{ name?: string }>;
}

/** La forma de respuesta del endpoint `/v1/messages` que el SDK 0.94 parsea
 *  en `response.content[].type === "tool_use"` → `block.input`. */
interface RespuestaMessages {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<{ type: "tool_use"; id: string; name: string; input: Record<string, unknown> }>;
  stop_reason: "tool_use";
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

/** Error con la forma del contrato de Anthropic: el SDK lo convierte en su
 *  excepción tipada y ai_server lo reporta como 503 con el motivo. */
interface ErrorAnthropic {
  type: "error";
  error: { type: "invalid_request_error" | "not_found_error"; message: string };
}

const rawPort = process.env.PORT;
if (!rawPort || !/^\d+$/.test(rawPort)) {
  console.error("fake-anthropic: falta PORT (el puerto lo elige quien me arranca; no hay default)");
  process.exit(2);
}
const PORT = Number(rawPort);

let llamadas = 0;
let servido: {
  api_key: string | null;
  model: string | null;
  tool_choice: PeticionMessages["tool_choice"] | null;
  input: Record<string, unknown>;
} | null = null;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

function leerBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const trozos: Buffer[] = [];
    req.on("data", (c: Buffer) => trozos.push(c));
    req.on("end", () => resolve(Buffer.concat(trozos).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { fake: true, llamadas });
    return;
  }
  if (req.method === "GET" && url.pathname === "/servido") {
    if (!servido) {
      json(res, 404, { fake: true, error: "todavía no se ha servido ninguna escena" });
      return;
    }
    json(res, 200, servido);
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/messages") {
    llamadas += 1;
    let peticion: PeticionMessages;
    try {
      peticion = JSON.parse(await leerBody(req)) as PeticionMessages;
    } catch {
      const err: ErrorAnthropic = {
        type: "error",
        error: { type: "invalid_request_error", message: "el body no es JSON" },
      };
      json(res, 400, err);
      return;
    }
    const tool = peticion.tool_choice?.name;
    if (tool !== "generate_scene") {
      const err: ErrorAnthropic = {
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            `fake-anthropic solo sabe contestar tool_choice generate_scene; llegó ${JSON.stringify(peticion.tool_choice ?? null)}`,
        },
      };
      json(res, 400, err);
      return;
    }
    const input = bootstrapTile() as unknown as Record<string, unknown>;
    const apiKey = req.headers["x-api-key"];
    servido = {
      api_key: typeof apiKey === "string" ? apiKey : null,
      model: peticion.model ?? null,
      tool_choice: peticion.tool_choice ?? null,
      input,
    };
    const respuesta: RespuestaMessages = {
      id: `msg_banco_${llamadas}`,
      type: "message",
      role: "assistant",
      model: peticion.model ?? "banco",
      content: [{ type: "tool_use", id: `toolu_banco_${llamadas}`, name: "generate_scene", input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    json(res, 200, respuesta);
    return;
  }
  const err: ErrorAnthropic = {
    type: "error",
    error: { type: "not_found_error", message: `fake-anthropic no sirve ${req.method} ${url.pathname}` },
  };
  json(res, 404, err);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake-anthropic escuchando en http://127.0.0.1:${PORT} (POST /v1/messages → tool_use generate_scene)`);
});
