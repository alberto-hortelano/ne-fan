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
  };
}

export function serviceUrl(name: ServiceName): string {
  return resolveServiceUrl(name, envFromQuery());
}
