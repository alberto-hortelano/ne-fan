/** Resolución de URLs de servicios en el NAVEGADOR (F1).
 *
 * En el browser no hay process.env: los overrides llegan por query param y se
 * traducen al env sintético que espera `resolveServiceUrl` (contrato):
 *  - `?ai=http://127.0.0.1:18765` — bench fake-ai-server (narrative_lab),
 *    que emula S3–S6 a la vez; apunta de golpe los CUATRO servicios que hoy
 *    co-viven en ai_server (narrative-llm, gpu-worker, remote-gen,
 *    asset-store).
 *  - `?bridge=ws://...` — gateway alternativo (stack E2E de narrative_lab).
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
    NEFAN_URL_GPU_WORKER: ai,
    NEFAN_URL_REMOTE_GEN: ai,
    NEFAN_URL_ASSET_STORE: ai,
    NEFAN_URL_GAME_GATEWAY: q.get("bridge") ?? undefined,
  };
}

export function serviceUrl(name: ServiceName): string {
  return resolveServiceUrl(name, envFromQuery());
}

/** URLs por servicio que consumen los pipelines de imagen del cliente
 *  (Scene/StageImageController). Un solo objeto en vez de N parámetros
 *  posicionales: el reparto por servicio creció en F3/F4. */
export interface GenServiceUrls {
  /** narrative-llm (:8765): reviews y análisis con visión. */
  narrative: string;
  /** gpu-worker (:8766): peel_scene_layer, inpaint_scene_plate. */
  gpu: string;
  /** remote-gen (repintado Meshy/fal — :8765 hasta el corte de F4). */
  remote: string;
  /** asset-store (:8767): blobs /cache/*. */
  assets: string;
}
