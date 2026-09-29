/** WebSocket bridge — la ENTRADA del proceso. Los clientes conectan al puerto
 *  del gateway (SERVICES["game-gateway"], CONFIG.ports.bridge).
 *
 *  Este archivo es sólo bootstrap, y desde #769 lo es de verdad: lee el
 *  entorno, las rutas y los puertos, y llama a `arrancarBridge`
 *  (`bridge/arranque.ts`). El contexto nace en `contexto-del-bridge.ts`, los
 *  hooks de plugins del State API en `hooks-de-plugins.ts` y cada socket se
 *  atiende en `conexion.ts`; la lógica de cada mensaje vive en
 *  bridge/handlers/* y se enruta en bridge/router.ts. Nada de eso se queda
 *  aquí porque este fichero no lo puede importar ningún test: importarlo es
 *  levantar el bridge. */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG } from "../src/config.js";
import { resolveServiceUrl } from "../src/contracts/common.js";
import { leerEntorno } from "../src/session/gates-de-imagen.js";
import { arrancarBridge } from "./arranque.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve paths relative to project root (works from both src/ and dist/)
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "data").replace("/dist/data", "/data");
const PORT = Number(process.env.NEFAN_BRIDGE_PORT ?? CONFIG.ports.bridge);
// State HTTP API for the narrative engine's tools (map / entities / inventory).
const STATE_HTTP_PORT = Number(process.env.NEFAN_STATE_HTTP_PORT ?? CONFIG.ports.state_api);
// Override para benches (labs/narrative): con el motor FAKE, los snapshots de
// mundo se escriben en data/games/{id}/world/ — un games dir temporal evita
// contaminar los juegos reales con génesis de bench.
const GAMES_DIR = process.env.NEFAN_GAMES_DIR ?? resolve(dataDir, "games");
const STYLES_DIR = resolve(dataDir, "styles");

// Saves live in a shared filesystem location accessible to every client:
// <repo>/saves, igual que start.sh ($PROJECT_DIR/saves). Override with
// NEFAN_SAVES_DIR.
const SAVES_DIR = process.env.NEFAN_SAVES_DIR ?? resolve(dataDir, "..", "..", "saves");
/** Destino del ai_server (S3 narrative-llm). NEFAN_AI_SERVER es el alias
 *  histórico y gana (lo usa el bench de labs/narrative documentado);
 *  @deprecated — usar NEFAN_URL_NARRATIVE_LLM (contrato F1); retirada en F5. */
const AI_SERVER_URL = process.env.NEFAN_AI_SERVER ?? resolveServiceUrl("narrative-llm", process.env);
/** EL ENTORNO de esta corrida: si los caminos automáticos del cliente pueden
 *  pagar arte nuevo (`produccion`) o solo restaurar lo pagado (`desarrollo`,
 *  el defecto). Se lee AQUÍ y en ningún otro proceso (candado
 *  `el-entorno-se-lee-en-un-solo-sitio`), y viaja al cliente en el
 *  `bridge_hello` de cada socket. Un valor que no se entiende PARA el
 *  arranque: arrancar en desarrollo cuando se pidió «prod» dejaría a quien lo
 *  pidió sin generar y sin saber por qué. */
const ENTORNO = (() => {
  const r = leerEntorno(process.env.NEFAN_ENTORNO);
  if (!r.ok) throw new Error(`Bridge: ${r.error}`);
  return r.entorno;
})();

// Última red DE VERDAD, no el canal de errores: los throws de los handlers los
// captura y contesta `routeMessage` (frame con requestId o narrative_status de
// error), así que esto solo puede dispararse desde trabajo que no nació de un
// mensaje (timers, promesas sueltas de un job). No tumba el bridge, pero verlo
// en el log ya no es rutina — es un bug al que le falta canal hacia el cliente.
process.on("unhandledRejection", (reason) => {
  console.error("Bridge: unhandled rejection (fuera del ciclo de mensajes):", reason);
});

const bridge = await arrancarBridge({
  port: PORT,
  statePort: STATE_HTTP_PORT,
  entorno: ENTORNO,
  dataDir,
  gamesDir: GAMES_DIR,
  stylesDir: STYLES_DIR,
  savesDir: SAVES_DIR,
  aiServerUrl: AI_SERVER_URL,
});
console.log(`NEFan Logic Bridge listening on ws://localhost:${bridge.puertoWs}`);
console.log(
  `Bridge: entorno ${ENTORNO} — ` +
    (ENTORNO === "produccion"
      ? "los caminos automáticos PUEDEN pagar arte nuevo (Imagen IA encendida)"
      : "los caminos automáticos solo restauran lo ya pagado (NEFAN_ENTORNO=produccion para generar)"),
);
