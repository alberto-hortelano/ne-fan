/** Registro de servicios + resolución de URLs — módulo HOJA sin ninguna
 * dependencia (ni de dominio ni de Node), importable desde el NAVEGADOR.
 *
 * Vive separado de common.ts a propósito: common.ts reexporta tipos de
 * dominio cuyos módulos tocan node:fs/node:crypto (games/loader,
 * session-storage…), y el cliente HTML solo necesita esto para resolver a qué
 * servicio conectar (F1). common.ts lo reexporta, así que para el resto de
 * consumidores es transparente. */

export type ServiceName =
  | "game-gateway"
  | "world-state"
  | "narrative-llm"
  | "remote-gen"
  | "asset-store";

export interface ServiceSpec {
  readonly protocol: "ws" | "http";
  /** Puerto OBJETIVO del servicio una vez extraído. */
  readonly port: number;
  /** Puerto donde escucha HOY (los servicios aún no extraídos co-viven en el
   *  proceso ai_server :8765). `resolveServiceUrl` usa este. */
  readonly currentPort: number;
  /** Fase de docs/microservices/migration.md en la que se extrae; ausente =
   *  ya corre en su proceso/puerto. */
  readonly extractionPhase?: "F2" | "F3" | "F4" | "F6";
  readonly description: string;
}

export const SERVICES = {
  "game-gateway": {
    protocol: "ws",
    port: 9877,
    currentPort: 9877,
    description:
      "Sesiones de juego en vivo: WS con clientes, routing, GameSimulation (hot loop) y SceneGenQueue in-process.",
  },
  "world-state": {
    protocol: "http",
    port: 9878,
    currentPort: 9878,
    extractionPhase: "F6",
    description:
      "Fuente de verdad del mundo: NarrativeState (único escritor de saves), WorldMapManager, NpcDirector, plugins. Hoy co-vive en el proceso del gateway (puerto propio; separar proceso es F6, opcional).",
  },
  "narrative-llm": {
    protocol: "http",
    port: 8765,
    currentPort: 8765,
    description:
      "Narrativa con LLM: generate_scene, choices, develop_world, reviews con visión. narrative-mcp (:3737) es su sidecar.",
  },
  "asset-store": {
    protocol: "http",
    port: 8767,
    // Extraído en F2: proceso propio (services/asset-store/). ai_server
    // mantiene un proxy transparente de /cache|/assets para clientes no
    // migrados.
    currentPort: 8767,
    description:
      "Almacén content-addressed: blobs de cache/, manifest SQLite, styles binarios.",
  },
  "remote-gen": {
    protocol: "http",
    port: 8768,
    // Extraído en F4: proceso propio (ai_server/remote_gen_main.py). Sin
    // proxy en :8765 — sus únicos clientes (HTML) resuelven por serviceUrl.
    currentPort: 8768,
    description:
      "Adaptador de APIs de pago (Meshy/fal): scene images, sprite sheets, style packs, segmentación SAM2.",
  },
} as const satisfies Record<ServiceName, ServiceSpec>;

/** URL base de un servicio. Orden: override por env (`NEFAN_URL_REMOTE_GEN`,
 *  `NEFAN_URL_ASSET_STORE`…) → loopback con el puerto ACTUAL. `env` se inyecta
 *  (process.env en Node, un env sintético desde query params en el navegador)
 *  para que el módulo siga siendo puro. */
export function resolveServiceUrl(
  name: ServiceName,
  env: Record<string, string | undefined> = {},
): string {
  const override = env[`NEFAN_URL_${name.toUpperCase().replace(/-/g, "_")}`];
  if (override) return override.replace(/\/+$/, "");
  const spec = SERVICES[name];
  const scheme = spec.protocol === "ws" ? "ws" : "http";
  return `${scheme}://127.0.0.1:${spec.currentPort}`;
}
