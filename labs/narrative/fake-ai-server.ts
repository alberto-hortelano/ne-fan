// Fake ai_server para bench E2E del bridge SIN LLM ni GPU.
//
// Imita los endpoints que consume nefan-core AiClient:
//   GET  /health                → { status: "ready", fake: true }
//   POST /notify_session        → { ok: true }
//   POST /generate_scene        → escena según el request (ver abajo)
//   POST /report_player_choice  → { consequences: [] }
//
// /generate_scene LEE el body y responde como lo haría el motor narrativo.
// Format D tiene UNA variante y el fake solo sirve esa:
//   - generate_tile        → tile del plano continuo (bootstrap o normal)
//   - cualquier otra cosa  → 422, igual que el gate del contrato: la escena
//     "suelta" y el plató proscenio se retiraron.
//
// ── POR QUÉ ESTO ES TypeScript (#309) ────────────────────────────────────
// Este fichero sirvió durante SEIS DÍAS un `scene_model` que el contrato había
// renombrado a `surface_model`, y nadie se enteró porque el cliente lo pintaba
// como la palabra `undefined` en la barra de dev: una cadena en pantalla no es
// un error. La extensión por sí sola no arregla nada —`tsx` borra los tipos sin
// mirarlos—: el candado es `npm run typecheck:labs` (dentro de `npm run verify`
// y en CI), que es lo que #309 compra de verdad. Lo que este fichero recibe y
// lo que emite se declara con los contratos de nefan-core, y una divergencia
// deja de compilar.
//
// Se arranca con `npx tsx` y cwd `nefan-core` (`start_fake_ai` en start.sh),
// donde tsx es devDependency declarada (4.21.0). Desde la raíz del repo —que no
// tiene package.json ni node_modules— `npx tsx` resolvería un tsx GLOBAL de la
// máquina, que es regalarle al banco una dependencia que nadie declara.
//
// Env:
//   PORT          puerto HTTP (default: ports.fake_ai del runtime config)
//   STATE_API     State API del bridge (default: ports.state_api)

import http from "node:http";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PUERTOS_TODOS } from "../../qa/lib/stack.mjs";
// La ruta GET /styles/{id}/{file} NO se copia: se IMPORTA del asset-store
// (#280). Antes vivía aquí escrita a mano —con su propio `SAFE_ID`, su tabla de
// MIME y su `extname` reinventado— y se desvió del original en cuatro casos el
// mismo día en que alguien midió la paridad. `blob-store` y `http-wire` no
// arrastran `node:sqlite` ni el manifest: eso cuelga de `http-server.ts`, del
// que este fichero NO importa nada. Es lo que lo mantiene siendo un servidor
// sin créditos.
import { readStyleFile } from "../../nefan-core/services/asset-store/blob-store.js";
import {
  matchStylesRoute,
  parseRequestPath,
  writeBlob,
} from "../../nefan-core/services/asset-store/http-wire.js";
import type { AssetPinRequest, AssetPinResponse } from "../../nefan-core/src/contracts/asset-store.js";
import type {
  DevStatus,
  GenerateSurfaceAtlasRequest,
  GenerateSurfaceAtlasResponse,
  SkinSpriteSheetRequest,
  SkinSpriteSheetResponse,
  StyleCompleteResponse,
  StylesMissingResponse,
  SurfaceCellResult,
} from "../../nefan-core/src/contracts/remote-gen.js";
import type {
  DevelopWorldRequest,
  DevelopWorldResponse,
  NarrativeHealthResponse,
  NotifySessionRequest,
  NotifySessionResponse,
  ReportPlayerChoiceRequest,
  ReportPlayerChoiceResponse,
} from "../../nefan-core/src/contracts/narrative-llm.js";
import type {
  SpriteCatalog,
  SpriteSheetMeta,
} from "../../nefan-core/src/contracts/sprite-forge.js";
import type { LlmContext } from "../../nefan-core/src/narrative/types.js";
// Los BUILDERS de escena viven en fake-scenes.ts (módulo puro, sin listen ni
// puertos): así un test puede validarlos contra `EmittedSceneSchema` —el
// contrato del rol que este server suplanta— sin levantar un servidor
// (test/fake-motor-contract.test.ts, #334-B).
import {
  ANCHORED_PLACE_RECT,
  BOOTSTRAP_PLACE_RECT,
  bootstrapTile,
  makeTile,
  type GenerateTile,
} from "./fake-scenes.js";

/** El cuerpo JSON de una petición, leído CON EL CONTRATO del endpoint delante.
 *
 *  El cast no valida nada en runtime —para eso está el zod del motor real— y no
 *  pretende: lo que compra es que LEER un campo que el contrato no tiene deje
 *  de compilar. Así se cazó que este fichero leía `chosenText`/`freeText`
 *  cuando el wire manda `chosen_text`/`free_text` (`ai-client.ts:123`), o sea
 *  que llevaba quién sabe cuánto ecoando la cadena vacía en el diálogo del
 *  bench. `null` = el body no era JSON. */
function leerBody<T>(raw: string): T | null {
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Los puertos salen de la fuente única del repo (`nefan-core/src/config.ts` →
 *  `data/runtime_config.json`) a través del ÚNICO lector que hay en JS, que
 *  además aplica `NEFAN_PORT_OFFSET` y falla con un mensaje que dice cómo
 *  regenerar el snapshot (aquí había un `readFileSync` a mano que en un clon
 *  limpio reventaba con un ENOENT crudo). `PORT`/`STATE_API` del entorno
 *  siguen mandando: es por ahí por donde `start.sh` pasa el bloque. */
const PORT = Number(process.env.PORT ?? PUERTOS_TODOS.fake_ai);
const STATE_API = process.env.STATE_API ?? `http://127.0.0.1:${PUERTOS_TODOS.state_api}`;
// Retardo artificial de TODO /generate_scene (ms), ANTES de responder nada
// (ni cabeceras): reproduce las esperas de minutos del motor real. Regresión
// del headersTimeout de undici (300 s) en el fetch del bridge.
const SCENE_DELAY_MS = Number(process.env.SCENE_DELAY_MS ?? 0);

// ── Skin de sprite sheets (bench del cliente, sin GPU) ────────────────
// POST /skin_sprite_sheet: en vez del img2img real, el "skin" son los frames
// de OTRO modelo (SKIN_SPRITE_MODEL, default paladin — solo tiene idle) para
// que la sustitución base→skin sea VISIBLE en el cliente. Las anims sin
// sheet del modelo responden 500, ejercitando la cancelación de la cola de
// skins del cliente (character-sprites.ts).
const SKIN_SPRITE_MODEL = process.env.SKIN_SPRITE_MODEL ?? "paladin";

// ── Contador de rutas DE PAGO ────────────────────────────────────────────
// Cuáles de estas rutas cuestan dinero en el motor REAL lo sabe este fichero y
// nadie más, así que la marca vive en la MISMA LÍNEA que la ruta: `dePago(...)`
// junto al `if` que la atiende. La alternativa —una lista blanca en
// `qa/run.mjs`— es una segunda copia del contrato de gasto, que es justo la
// clase de fallo que esta tanda persigue.
//
// Lo lee `qa/run.mjs` antes y después de cada guion: si el contador SUBE en uno
// que se declaró EXENTO del guardarraíl (`export const sinMotor`), ese guion
// sale ⊘ y la corrida no es concluyente (#295). Al que se olvida de declarar no
// lo caza esto: lo gatea el runner por defecto, que es donde está la garantía.
// Se cuenta AQUÍ y no con `page.on("request")` porque el gasto del bridge no
// pasa por la página — la misma razón por la que el guardarraíl tiene dos vías.
//
// Lo que se cuenta es lo que HABRÍA COSTADO, no lo que tocó la ruta: un
// `/generate_surface_atlas` con `resolve_only` o con todas las celdas en caché
// vale $0 por diseño en el server real (`cost_usd: 0`) y es justo el camino que
// el cliente usa para NO gastar. Contarlo señalaría como gastadores a guiones
// que no gastan nada, y un guardarraíl que se dispara de más se acaba
// desactivando. Por eso el `dePago(...)` de esa ruta va DETRÁS de saber si
// pintó, y no en el `if` que la atiende.
const gastoPorRuta = new Map<string, number>();
function dePago(ruta: string): void {
  gastoPorRuta.set(ruta, (gastoPorRuta.get(ruta) ?? 0) + 1);
}
/** Lo servido hasta ahora, en la forma que lee el runner. */
const gastoServido = () => ({
  total: [...gastoPorRuta.values()].reduce((a, b) => a + b, 0),
  rutas: Object.fromEntries(gastoPorRuta),
});

let fakeDevCacheEnabled = false;
/** Turnos de diálogo servidos (el texto los numera: se ve el ida y vuelta). */
let fakeDialogueTurn = 0;
const SPRITES_DIR = fileURLToPath(new URL("../../nefan-html/public/sprites/", import.meta.url));
// Imágenes de los packs de estilo (portadas y refs). Son ficheros COMMITEADOS
// del repo, no generación: aquí no se paga ni se inventa nada — se sirve lo
// mismo que serviría el asset-store con GET /styles/{id}/{file}.
const STYLES_DIR = fileURLToPath(new URL("../../nefan-core/data/styles/", import.meta.url));
// ── Tiles del plano continuo ─────────────────────────────────────────────
// TILE_DELAY_MS: retardo por tile (simula el motor real). TILE_MODE=error →
// HTTP 500 en tiles no-bootstrap (test de reintento del cliente).
const TILE_DELAY_MS = Number(process.env.TILE_DELAY_MS ?? 0);
const TILE_MODE = process.env.TILE_MODE ?? "";
const tileByKey = new Map<string, ReturnType<typeof makeTile>>();

async function handleGenerateTile(gt: GenerateTile) {
  if (TILE_DELAY_MS > 0 && !gt?.bootstrap) await new Promise((r) => setTimeout(r, TILE_DELAY_MS));
  if (TILE_MODE === "error" && !gt?.bootstrap) {
    throw new Error("fake-ai: TILE_MODE=error — el motor rechazó el tile");
  }
  if (gt?.bootstrap) {
    // Como el motor real: sembrar el world map con las map tools. Dos places
    // y un link — el segundo NO se realiza aquí: es el destino del panel
    // «Salidas», que se ancla a un tile libre al viajar. El lugar de partida
    // lleva su `anchor` con rect (#408: el ÚNICO canal por el que un lugar se
    // ancla al plano; la escena ya no declara anclas). El spawn de ARRANQUE no
    // lo mueve: es la celda del `player` de la escena, fuera de la taberna. El
    // rect gobierna la VUELTA (el viaje de regreso deja al jugador dentro de
    // él) y la activación del lugar por posición al pisarlo.
    await statePost("/map/place", {
      id: "taberna_bench_place",
      kind: "settlement",
      parent_id: "world",
      name: "Taberna del bench",
      anchor: { tx: 0, ty: 0, rect: BOOTSTRAP_PLACE_RECT },
    }).catch((err) => console.error("[fake-ai] bootstrap place:", err.message));
    await statePost("/map/place", {
      id: "molino_bench_place",
      kind: "settlement",
      parent_id: "world",
      name: "Molino del bench",
      description: "Un molino de agua río abajo, con su presa y cuatro casas alrededor.",
    }).catch((err) => console.error("[fake-ai] bootstrap place:", err.message));
    await statePost("/map/link", {
      from: "taberna_bench_place",
      to: "molino_bench_place",
      kind: "road",
      edge: "east",
      travel_hours: 2,
      description: "El camino del este, siguiendo el río.",
    }).catch((err) => console.error("[fake-ai] bootstrap link:", err.message));
    return bootstrapTile();
  }
  // El tile de un LUGAR: el motor acota dónde vive dentro del tile por el
  // canal real (`map_upsert_place.anchor`, con el tile que el bridge ya le
  // asignó) ANTES de responder la escena, y el bridge resuelve el spawn al
  // difundir — el jugador aparece dentro del lugar, no en el centro del tile.
  // Se hace en CADA generación, como el motor real (que responde a cada
  // `generate_tile` sin caché): el anchor vive en el world map de la SESIÓN, y
  // `tileByKey` es caché del proceso del fake — la segunda partida del mismo
  // stack recibía el tile cacheado sin volver a anclar y el jugador aparecía en
  // el centro del tile (QA-E de T13). Sin `.catch`: un rechazo del State API
  // tumba la respuesta (500 al bridge) y el guion se pone rojo — el banco no
  // puede mentir.
  if (gt.place) {
    await statePost("/map/place", {
      id: gt.place.id,
      kind: gt.place.kind,
      parent_id: "world",
      name: gt.place.name,
      description: gt.place.description,
      anchor: { tx: gt.tx, ty: gt.ty, rect: ANCHORED_PLACE_RECT },
    });
  }
  const key = `tile_${gt.tx}_${gt.ty}`;
  if (!tileByKey.has(key)) tileByKey.set(key, makeTile(gt));
  return tileByKey.get(key);
}

async function statePost(path: string, body: unknown) {
  const res = await fetch(`${STATE_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`fake-ai: ${path} → HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ── Atlas de superficies fps: celdas como PNG de damero del color base ──
// (plumbing E2E sin créditos: identidad por desc+estilo, cached en la 2ª
// petición, servidas por /cache/surface/{hash} como el asset-store real).
const surfaceImages = new Map<string, Buffer>();

/** PNG RGB válido generado a pelo (zlib): damero 2 tonos del color base. */
function checkerPng(hexColor: string, size = 64, cells = 8): Buffer {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const lite = [Math.min(255, r + 25), Math.min(255, g + 25), Math.min(255, b + 25)];
  const dark = [Math.max(0, r - 25), Math.max(0, g - 25), Math.max(0, b - 25)];
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const c = ((x * cells / size) | 0) + ((y * cells / size) | 0);
      const [cr, cg, cb] = c % 2 === 0 ? lite : dark;
      const o = row + 1 + x * 3;
      raw[o] = cr; raw[o + 1] = cg; raw[o + 2] = cb;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const server = http.createServer((req, res) => {
  // CORS: el navegador (cliente) llama cross-origin; el bridge server-side
  // lo ignora. ACAO en TODAS las respuestas + preflight OPTIONS.
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  // Se enruta por PATHNAME, como FastAPI: `POST /skin_sprite_sheet?x=1` es la
  // misma ruta con o sin query (#319; antes se comparaba `req.url ===` y una
  // query cualquiera daba 404 aquí y 200 en el server real). Divergencia
  // declarada que queda: parseRequestPath NORMALIZA la barra final
  // (`/health/` ≡ `/health`), mientras FastAPI la redirige con 307 — el fake
  // contesta directo donde el real daría un salto más.
  const pedido = parseRequestPath(req.url);
  const ruta = pedido.path;
  // `fake: true` es una DECLARACIÓN, no una pista. De ella cuelga el
  // guardarraíl de cero créditos del banco de pruebas (qa/lib/sesion.mjs):
  // ningún guion que pueda disparar generación corre si el backend no dice
  // esto de sí mismo. Contrato: NarrativeHealthResponse
  // (nefan-core/src/contracts/narrative-llm.ts). NO se toca sin leerlo.
  if (req.method === "GET" && ruta === "/health") {
    return send(200, { status: "ready", fake: true } satisfies NarrativeHealthResponse);
  }
  // Unpin fake (batch "aplicar estilo" — el re-pin va por POST /assets/pin).
  // El ref se recorta de `ruta`, no de `req.url`: con query, el ref saldría
  // corrupto (`mi_ref?x=1`).
  if (req.method === "DELETE" && ruta.startsWith("/assets/pin/")) {
    return send(200, { ok: true, ref: decodeURIComponent(ruta.slice("/assets/pin/".length)), removed: 0 });
  }
  // Dry-run del pack de estilo (batch "aplicar estilo" sin créditos).
  if (req.method === "GET" && /^\/styles\/[A-Za-z0-9_.-]+\/missing$/.test(ruta)) {
    return send(200, {
      style_id: ruta.split("/")[2],
      missing: [],
      cost_per_image_usd: 0.18,
      estimated_cost_usd: 0,
    } satisfies StylesMissingResponse);
  }
  // GET /styles/{style_id}/{file} — la portada del estilo y las refs del pack.
  //
  // Bajo `?ai=`, el cliente resuelve el asset-store a ESTE server (los tres
  // servicios a la vez, service-urls.ts), así que sin esta ruta las cuatro
  // portadas del selector daban 404 en el bench y el título del preset
  // e2e-sin-creditos se abría con cuatro marcos rotos (#218). Va DESPUÉS de
  // /styles/{id}/missing, que es otra ruta y no lleva extensión (y que
  // `matchStylesRoute` capturaría por tener tres segmentos).
  //
  // Aquí NO hay contrato escrito: la lectura, la normalización de la ruta y la
  // emisión con `Content-Length` son las MISMAS funciones que corren en el
  // asset-store (#280). El CORS es lo único que pone el fake, porque es lo
  // único que de verdad es suyo.
  const estilo = matchStylesRoute(req.method ?? "GET", pedido.parts);
  if (estilo) {
    writeBlob(res, readStyleFile(STYLES_DIR, estilo.styleId, estilo.file), cors);
    return;
  }
  // Contadores del estado de proceso del fake (qa/run.mjs --diag): mirar sin
  // tocar. Va aparte de /dev/status a propósito — ese espeja un contrato real
  // del ai_server y no puede llevar campos que solo existen en el bench.
  if (req.method === "GET" && ruta === "/dev/counters") {
    return send(200, {
      tiles: tileByKey.size,
      surfaces: surfaceImages.size,
      dialogueTurn: fakeDialogueTurn,
      apiCache: fakeDevCacheEnabled,
      // Peticiones servidas a rutas que en el motor real COBRAN. Es la red que
      // caza al guion que dispara generación sin declararlo (#295).
      gasto: gastoServido(),
    });
  }
  // Toggle del dev API cache (espejo trivial del ai_server real, en memoria):
  // el fake no llama APIs de pago, pero el checkbox del cliente debe operar.
  if (req.method === "GET" && ruta === "/dev/api_cache") {
    return send(200, { enabled: fakeDevCacheEnabled, channels: {} });
  }
  // Estado agregado del panel de dev (contrato DevStatus): el fake no gasta
  // créditos, así el E2E ejercita el panel con spend 0 y claves "presentes".
  if (req.method === "GET" && ruta === "/dev/status") {
    return send(200, {
      api_cache: { enabled: fakeDevCacheEnabled, channels: {} },
      spend: { total_usd: 0, call_count: 0, calls: [] },
      config: {
        // `surface_model`, no `scene_model`. El contrato lo renombró el
        // 2026-08-22 (192037b, que tocó los tres ficheros a la vez) y este
        // quedó atrás seis días: el cliente lo lee en `dev-status-panel.ts` y
        // pintaba la palabra `undefined` en la barra de dev. El `satisfies` es
        // lo que impide que vuelva a pasar — y lo que hace que el typecheck de
        // `labs/` valga algo (#309).
        surface_model: "fake-surface-model",
        sprite_skin_model: "fake-skin-model",
        usd_eur_rate: 0.86,
      },
      keys: { meshy: true, fal: true },
    } satisfies DevStatus);
  }
  if (req.method === "GET" && ruta.startsWith("/cache/surface/")) {
    const hash = ruta.slice("/cache/surface/".length);
    const png = surfaceImages.get(hash);
    if (!png) return send(404, { detail: `fake-ai: superficie ${hash} no encontrada` });
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(png);
  }
  if (req.method === "GET" && ruta.startsWith("/cache/sprite_sheet/fake/")) {
    const rel = ruta.slice("/cache/sprite_sheet/fake/".length);
    if (!/^[a-z0-9_]+\/[a-z0-9_]+\/dir_\d+_frame_\d{3}\.png$/.test(rel)) {
      return send(400, { detail: `fake-ai: ruta de frame inválida ${rel}` });
    }
    const file = `${SPRITES_DIR}${SKIN_SPRITE_MODEL}/${rel}`;
    if (!existsSync(file)) return send(404, { detail: `fake-ai: frame ${rel} no existe` });
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(readFileSync(file));
  }
  // Hero-shot de identidad (retrato del diálogo): en el bench no hay Meshy,
  // así que se sirve el frame frontal del personaje de prueba. El cliente lo
  // recorta a busto igual que haría con el hero real.
  if (req.method === "GET" && ruta.startsWith("/cache/sprite_hero/")) {
    const key = ruta.slice("/cache/sprite_hero/".length);
    if (!/^[0-9a-f]{16}$/.test(key)) return send(400, { detail: "fake-ai: hero key inválida" });
    const file = `${SPRITES_DIR}${SKIN_SPRITE_MODEL}/idle/frontal_8/dir_0_frame_000.png`;
    if (!existsSync(file)) return send(404, { detail: `fake-ai: sin frame para el hero ${key}` });
    console.error(`[fake-ai] sprite_hero ${key} (frame frontal de ${SKIN_SPRITE_MODEL})`);
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(readFileSync(file));
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    void (async () => {
      console.error(`[fake-ai] ${req.method} ${req.url}`);
      if (req.method === "POST" && ruta === "/notify_session") {
        // El contrato manda ECO de la sesión, no un `{ok:true}` pelado: hoy el
        // cliente solo mira el status, pero un fake que contesta menos de lo
        // que el contrato promete es un fake que no sirve para probar al
        // siguiente que sí lo lea. Lo dijo el `satisfies` al entrar (#309).
        const body = leerBody<NotifySessionRequest>(raw);
        if (!body) return send(400, { detail: "fake-ai: body no es JSON" });
        return send(200, {
          ok: true,
          session_id: body.session_id ?? "",
          game_id: body.game_id ?? "",
          is_resume: body.is_resume === true,
        } satisfies NotifySessionResponse);
      }
      // Mundo de usuario fake (E2E de crear mundo + encadenado generate_game).
      if (req.method === "POST" && ruta === "/develop_world") {
        const body = leerBody<DevelopWorldRequest>(raw);
        if (!body) return send(400, { detail: "fake-ai: body no es JSON" });
        console.error(`[fake-ai] develop_world (${String(body.draft_text ?? "").length} chars)`);
        return send(200, {
          game: {
            game_id: "mundo_bench",
            title: "Mundo del Bench",
            description: "Mundo de prueba desarrollado por el fake.",
            style_id: "acuarela_luminosa",
            world_brief: "b".repeat(150),
            world_md: "# Mundo del Bench\n\n" + "lore del bench. ".repeat(200),
            // Obligatorias desde que los estilos se filtran por tema
            // (`styleCompatibleWithGame`): un mundo sin `tags` no ofrece
            // ningún pack en el título. El fake las omitía, y el typecheck de
            // `labs/` lo dijo el primer día (#309).
            tags: ["fantasia", "medieval", "bench"],
          },
        } satisfies DevelopWorldResponse);
      }
      if (req.method === "POST" && ruta === "/report_player_choice") {
        // Responder con una línea de diálogo (no con silencio): es lo que
        // ejercita el panel, el retrato y las opciones en el E2E sin créditos.
        const body = leerBody<ReportPlayerChoiceRequest>(raw);
        if (!body) return send(400, { detail: "fake-ai: body no es JSON" });
        const speaker = String(body.speaker || "Aldeano");
        fakeDialogueTurn += 1;
        // SEGUNDO turno: además de contestar, el motor MANDA algo hostil. Es
        // la otra vía por la que aparece un enemigo (spawn en runtime, sin
        // recargar la escena) y hasta el 2026-08-29 este fichero no emitía un
        // solo `spawn_entity`: la decisión de diseño central de CLAUDE.md
        // («las entidades se materializan en runtime») no la ejercía nadie.
        //
        // Va en el turno 2 y no en el 1 para que el guion pueda afirmar los
        // dos actos por separado —el enemigo de la escena inicial primero, el
        // del spawn después— sin un canal de control nuevo: `fakeDialogueTurn`
        // ya hace determinista en qué turno pasa, y `/dev/reset` lo devuelve a
        // cero entre guiones.
        const spawnHostil =
          fakeDialogueTurn === 2
            ? [{
                type: "spawn_entity" as const,
                entity_kind: "npc" as const,
                role: "hostile" as const,
                name: "Secuaz",
                description: "secuaz enjuto de capucha parda y daga corta",
                position_hint: "near_player",
              }]
            : [];
        // TERCER turno: el resto del mundo que un motor pone a mitad de
        // conversación — un NPC pacífico, un objeto y un edificio. La clase
        // ENTERA, porque desaparecer al reanudar no era cosa solo del enemigo
        // (#326): el objeto y el edificio se iban enteros y el pacífico se
        // quedaba a medias (vivo en el bridge, invisible en el cliente).
        // Mismo mecanismo que el hostil del turno 2: `fakeDialogueTurn` lo
        // hace determinista y `/dev/reset` lo devuelve a cero entre guiones.
        const spawnMundo =
          fakeDialogueTurn === 3
            ? [
                {
                  type: "spawn_entity" as const,
                  entity_kind: "npc" as const,
                  role: "villager" as const,
                  name: "Nogala",
                  description: "posadera de manos grandes y delantal remendado",
                  position_hint: "near_player",
                },
                {
                  type: "spawn_entity" as const,
                  entity_kind: "object" as const,
                  name: "Cofre de la posada",
                  description: "cofre de roble con herrajes de hierro",
                  position_hint: "near_player",
                },
                {
                  type: "spawn_entity" as const,
                  entity_kind: "building" as const,
                  name: "Forja de Robledo",
                  description: "forja de piedra ennegrecida por el humo",
                  position_hint: "near_player",
                },
              ]
            : [];
        // CUARTO turno: lo que llega SIN procedencia. `name` es obligatorio y
        // es el rótulo; `description` es opcional y es el texto del que sale
        // el arte (#397). Un motor que no la declara no obliga al cliente a
        // inventarla: hasta esta tanda un spawn sin `description` se pintaba
        // con «an entity» en vivo y con su id tras reanudar, y el guion 66 es
        // quien lo afirma. Ningún guion llegaba al turno 4 (medido:
        // `chooseDialogue` ≤ 2 veces por guion), así que no cambia lo que
        // cuentan 48, 49 y 50 del turno 3.
        const spawnSinProcedencia =
          fakeDialogueTurn === 4
            ? [
                {
                  type: "spawn_entity" as const,
                  entity_kind: "npc" as const,
                  role: "villager" as const,
                  name: "Mochuelo",
                  position_hint: "near_player",
                },
                {
                  type: "spawn_entity" as const,
                  entity_kind: "object" as const,
                  name: "Farol del zaguán",
                  position_hint: "near_player",
                },
              ]
            : [];
        return send(200, {
          consequences: [
            ...spawnHostil,
            ...spawnMundo,
            ...spawnSinProcedencia,
            {
              type: "dialogue",
              speaker,
              // `chosen_text`/`free_text`, no `chosenText`/`freeText`. El wire
              // es snake_case (`ai-client.ts:123` traduce el camelCase del
              // protocolo del cliente), así que este eco llevaba quién sabe
              // cuánto imprimiendo la cadena vacía y el bench del diálogo
              // parecía funcionar igual. Lo cazó el contrato al entrar (#309).
              text:
                `(bench ${fakeDialogueTurn}) Te escucho, forastero. ` +
                `Dijiste: "${String(body.chosen_text || body.free_text || "").slice(0, 60)}".`,
              choices: ["Seguir preguntando", "Despedirse"],
            },
          ],
        } satisfies ReportPlayerChoiceResponse);
      }
      // Reset del ESTADO DE PROCESO del fake (qa/run.mjs entre guiones). El
      // fake acumula estado que ningún reinicio de página borra —tiles ya
      // servidos, atlas ya "pintados", turnos de diálogo— y con él un guion
      // hereda la caché caliente del anterior: el batch de estilo pide menos
      // páginas de las que su plan anunció y el guion cuenta peticiones que
      // nunca llegan. Reiniciar el proceso entero costaba el arranque del
      // stack; esto cuesta un POST.
      if (req.method === "POST" && ruta === "/dev/reset") {
        const antes = {
          tiles: tileByKey.size,
          surfaces: surfaceImages.size,
          dialogueTurn: fakeDialogueTurn,
          apiCache: fakeDevCacheEnabled,
          gasto: gastoServido(),
        };
        tileByKey.clear();
        surfaceImages.clear();
        gastoPorRuta.clear();
        fakeDialogueTurn = 0;
        fakeDevCacheEnabled = false;
        console.error(`[fake-ai] /dev/reset: ${JSON.stringify(antes)} → todo a cero`);
        return send(200, { ok: true, limpiado: antes });
      }
      if (req.method === "POST" && ruta === "/dev/api_cache") {
        const body = leerBody<{ enabled?: boolean }>(raw);
        if (!body) return send(400, { detail: "fake-ai: body no es JSON" });
        fakeDevCacheEnabled = !!body.enabled;
        return send(200, { enabled: fakeDevCacheEnabled, channels: {} });
      }
      if (req.method === "GET" && ruta === "/sprite_catalog") {
        // El catálogo del servicio de sprites, tal como lo reexpone remote-gen.
        // Sin esta ruta el cliente caería a su cota baja de coste y el bench
        // estaría probando el camino de respaldo para siempre en vez del bueno.
        // Los perfiles son los del set que usa el juego: idle 8 keyframes (8
        // llamadas), walk/run 4 (4 lotes de 2 direcciones).
        const perfiles = { idle: [8, 2.2, 8], walk: [4, 3.6, 4], run: [4, 6.0, 4] };
        const animaciones: SpriteCatalog["animations"] = [];
        for (const [id, [kf, fps, calls]] of Object.entries(perfiles)) {
          const metaPath = `${SPRITES_DIR}${SKIN_SPRITE_MODEL}/${id}/frontal_8/meta.json`;
          if (!existsSync(metaPath)) continue; // el catálogo sale del DISCO, como el de verdad
          animaciones.push({ id, keyframes: kf, play_fps: fps, calls_per_anim: calls });
        }
        return send(200, {
          service: "sprite-forge", version: "fake", set: "fake",
          models: [{ id: SKIN_SPRITE_MODEL }],
          animations: animaciones,
          angles: [{ id: "frontal_8", directions: 8 }],
          skin: { enabled: true, api: "fake", ai_model: "gpt-image-2", cost_usd_per_call: 0 },
          warnings: [],
          // Tipado con el contrato zod del wire (#R15): si el catálogo real
          // cambia de forma, el fake deja de compilar en vez de mentirle al
          // bench en silencio.
        } satisfies SpriteCatalog);
      }
      if (req.method === "POST" && ruta === "/skin_sprite_sheet") {
        dePago("/skin_sprite_sheet"); // genera una hoja de sprites: cuesta
        const body = leerBody<SkinSpriteSheetRequest>(raw);
        if (!body) return send(400, { detail: "fake-ai: body no es JSON" });
        const anim = String(body.anim ?? "");
        const angle = String(body.angle ?? "");
        if (!anim || !angle || !body.prompt) {
          return send(422, { detail: "fake-ai: anim/angle/prompt requeridos" });
        }
        const metaPath = `${SPRITES_DIR}${SKIN_SPRITE_MODEL}/${anim}/${angle}/meta.json`;
        if (!existsSync(metaPath)) {
          return send(500, {
            detail: `fake-ai: ${SKIN_SPRITE_MODEL} no tiene sheet ${anim}/${angle} ` +
              `(esperado en bench: el cliente cancela la cola de ese skin)`,
          });
        }
        // Tipado con el contrato, no `any`: si un meta.json del disco dejara
        // de tener la forma de SpriteSheetMeta, que lo diga el que lo lee.
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as SpriteSheetMeta;
        const frame_urls = Array.from({ length: meta.directions }, (_, d) =>
          Array.from({ length: meta.frame_count }, (_, f) =>
            `/cache/sprite_sheet/fake/${anim}/${angle}/dir_${d}_frame_${String(f).padStart(3, "0")}.png`));
        console.error(
          `[fake-ai] skin_sprite_sheet ${anim}/${angle} ← "${String(body.prompt).slice(0, 40)}" ` +
          `(sirviendo frames de ${SKIN_SPRITE_MODEL})`,
        );
        const heroKey = createHash("sha256")
          .update(`${body.prompt}|${angle}|${body.style_id ?? ""}`)
          .digest("hex")
          .slice(0, 16);
        return send(200, {
          ok: true,
          cached: false,
          // `hash` y `generation_time_ms` son del contrato y aquí no estaban:
          // el fake contestaba menos de lo que promete `SkinSpriteSheetResponse`
          // y nadie podía enterarse hasta que alguien los leyera en el cliente.
          // El `satisfies` los pide (#309). El hash del bench es el del hero:
          // identifica el sheet igual de bien y no inventa una segunda clave.
          hash: heroKey,
          meta,
          frame_urls,
          hero_key: heroKey,
          hero_url: `/cache/sprite_hero/${heroKey}`,
          generation_time_ms: 5,
        } satisfies SkinSpriteSheetResponse);
      }
      if (req.method === "POST" && ruta === "/generate_surface_atlas") {
        const body = leerBody<GenerateSurfaceAtlasRequest>(raw);
        if (!body) return send(400, { detail: "fake-ai: body no es JSON" });
        const cells = Array.isArray(body.cells) ? body.cells : [];
        if (cells.length === 0) return send(422, { detail: "fake-ai: cells requerido" });
        // resolve_only ($0, camino del resume y del plan de "aplicar estilo"):
        // solo lo ya pintado, con el recuento de missing — como el server real.
        const resolveOnly = body.resolve_only === true;
        const out: Record<string, SurfaceCellResult> = {};
        let painted = 0;
        let missing = 0;
        for (const cell of cells) {
          const hash = createHash("sha256")
            .update(`${cell.desc}\n${body.style_id ?? ""}\n${cell.mat}\n${cell.ref ?? ""}`)
            .digest("hex")
            .slice(0, 16);
          const cached = surfaceImages.has(hash);
          if (!cached && resolveOnly) {
            missing += 1;
            continue;
          }
          if (!cached) {
            surfaceImages.set(hash, checkerPng(cell.base_color ?? "#808080"));
            painted += 1;
          }
          out[cell.key] = { hash, url: `/cache/surface/${hash}`, cached };
        }
        // Cuesta solo si PINTÓ: resolve_only y el acierto de caché son $0.
        if (painted > 0) dePago("/generate_surface_atlas");
        console.error(
          `[fake-ai] surface_atlas: ${painted} nuevas de ${cells.length} celdas` +
          (resolveOnly ? ` (resolve_only, ${missing} missing)` : ""),
        );
        return send(200, {
          cells: out,
          pages_painted: painted > 0 ? 1 : 0,
          cached: painted === 0,
          cost_usd: 0,
          generation_time_ms: 5,
          missing,
        } satisfies GenerateSurfaceAtlasResponse);
      }
      // Pins del asset-store (batch "aplicar estilo"): en memoria, para que
      // el run del bench termine sin el store real.
      if (req.method === "POST" && ruta === "/assets/pin") {
        const body = leerBody<AssetPinRequest>(raw);
        if (!body) return send(400, { ok: false, error: "fake-ai: body no es JSON" });
        const hashes = Array.isArray(body.hashes) ? body.hashes : [];
        console.error(`[fake-ai] assets/pin ${body.ref}: ${hashes.length} hashes`);
        return send(200, {
          ok: true,
          ref: String(body.ref ?? ""),
          pinned: hashes.length,
        } satisfies AssetPinResponse);
      }
      // Completado fake del pack (batch "aplicar estilo" sin créditos).
      if (req.method === "POST" && /^\/styles\/[A-Za-z0-9_.-]+\/complete$/.test(ruta)) {
        // El fake nunca completa nada (`generated: []`, `cost_usd: 0`), así
        // que esta marca no llega a dispararse HOY. Se escribe igual, y con la
        // misma condición que tendría el server real —pintar refs es lo que
        // cuesta—, porque el día que este fake genere algo la marca tiene que
        // estar donde está la ruta, no en una lista que alguien recuerde.
        const generated: string[] = [];
        if (generated.length > 0) dePago("/styles/*/complete");
        return send(200, {
          generated,
          cost_usd: 0,
          message: "fake: pack ya completo",
        } satisfies StyleCompleteResponse);
      }
      if (req.method === "POST" && ruta === "/generate_scene") {
        dePago("/generate_scene"); // una llamada al LLM narrativo: cuesta
        if (SCENE_DELAY_MS > 0) {
          console.error(`[fake-ai] /generate_scene retenido ${SCENE_DELAY_MS} ms (SCENE_DELAY_MS)`);
          await new Promise((r) => setTimeout(r, SCENE_DELAY_MS));
        }
        const body = leerBody<LlmContext>(raw);
        if (!body) return send(400, { detail: "fake-ai: body no es JSON" });
        if (body.generate_tile) {
          try {
            return send(200, await handleGenerateTile(body.generate_tile));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[fake-ai] tile falló:`, msg);
            return send(500, { detail: msg });
          }
        }
        // Sin generate_tile no hay escena que servir: la variante "suelta" y
        // el plató proscenio se retiraron del contrato, así que el fake
        // responde lo mismo que el gate del motor real.
        const pedido = body.realize_place?.id ? ` (realize_place "${body.realize_place.id}")` : "";
        console.error(`[fake-ai] /generate_scene sin generate_tile${pedido} → 422`);
        return send(422, {
          detail:
            "fake-ai: una escena es un tile (generate_tile); la variante suelta y el " +
            `plató proscenio se retiraron del contrato${pedido}`,
        });
      }
      send(404, { detail: `fake-ai-server: ruta desconocida ${req.method} ${req.url}` });
    })();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[fake-ai] escuchando en http://127.0.0.1:${PORT} (state API: ${STATE_API})`);
});
