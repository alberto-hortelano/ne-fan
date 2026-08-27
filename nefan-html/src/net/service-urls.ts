/** Resolución de URLs de servicios en el NAVEGADOR (F1).
 *
 * En el browser no hay process.env: los overrides llegan por query param y se
 * traducen al env sintético que espera `resolveServiceUrl` (contrato):
 *  - `?ai=http://127.0.0.1:18765` — bench fake-ai-server (labs/narrative),
 *    que emula S3–S6 a la vez; apunta de golpe los TRES servicios que hoy
 *    co-viven en ai_server (narrative-llm, remote-gen, asset-store).
 *  - `?bridge=ws://...` — gateway alternativo (stack E2E de labs/narrative).
 * Sin query params → loopback con el puerto ACTUAL de cada servicio
 * (SERVICES.currentPort del contrato). */
import {
  resolveServiceUrl,
  type ServiceName,
} from "@nefan-core/src/contracts/service-registry.js";

function envFromQuery(search: string = location.search): Record<string, string | undefined> {
  const q = new URLSearchParams(search);
  const ai = q.get("ai") ?? undefined;
  return {
    NEFAN_URL_NARRATIVE_LLM: ai,
    NEFAN_URL_REMOTE_GEN: ai,
    NEFAN_URL_ASSET_STORE: ai,
    NEFAN_URL_GAME_GATEWAY: q.get("bridge") ?? undefined,
    // `?offset=N` — el bloque de puertos del stack al que pertenece esta
    // pestaña. En la máquina puede haber varios a la vez (varios agentes, dos
    // corridas del banco) y el navegador no tiene entorno donde leerlo, así
    // que viaja en la URL. Sin él, 0: los puertos de siempre.
    //
    // Hace falta aunque ya existan `?ai=` y `?bridge=`, porque hay un servicio
    // que ninguno de los dos cubre: la State API (`world-state`), que es
    // justamente a quien el banco le pregunta con qué motor habla el bridge.
    NEFAN_PORT_OFFSET: q.get("offset") ?? undefined,
  };
}

export function serviceUrl(name: ServiceName): string {
  return resolveServiceUrl(name, envFromQuery());
}
