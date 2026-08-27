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

/** Desplazamiento del bloque de puertos, declarado en `NEFAN_PORT_OFFSET`.
 *
 *  Existe porque en una máquina puede haber varios stacks a la vez (varios
 *  agentes, varios worktrees, dos corridas del banco de pruebas) y los nueve
 *  puertos del catálogo son los mismos para todos. Con 0 —el defecto— los
 *  puertos son EXACTAMENTE los de siempre: nadie que trabaje solo tiene que
 *  saber que esto existe.
 *
 *  Es EXPLÍCITO a propósito, nunca derivado del nombre del worktree: dos
 *  worktrees de nombre parecido colisionarían y nadie se enteraría.
 *
 *  Fail-loud: un valor que no sea un entero en rango LANZA. Un `Number("cien")`
 *  que colapsa a NaN y de ahí a 0 sería un stack arrancando encima del vecino
 *  justo cuando el usuario creía haberlo separado. */
export function portOffset(env: Record<string, string | undefined> = {}): number {
  const raw = env.NEFAN_PORT_OFFSET;
  if (raw === undefined || raw === "") return 0;
  // Dígitos decimales y nada más. `Number()` a secas acepta " " como 0 y
  // "0x10" como 16: dos formas de pedir un bloque y llevarse otro.
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 40000) {
    throw new Error(
      `NEFAN_PORT_OFFSET inválido: ${JSON.stringify(raw)}. Debe ser un entero entre 0 y 40000 ` +
        `(el desplazamiento del bloque de puertos; 0 = los puertos de siempre).`,
    );
  }
  return n;
}

/** Puerto donde escucha HOY un servicio, ya desplazado. Es la ÚNICA función
 *  que suma el offset en TypeScript. */
export function portOf(name: ServiceName, env: Record<string, string | undefined> = {}): number {
  return SERVICES[name].currentPort + portOffset(env);
}

/** URL base de un servicio. Orden: override por env (`NEFAN_URL_REMOTE_GEN`,
 *  `NEFAN_URL_ASSET_STORE`…) → loopback con el puerto ACTUAL ya desplazado.
 *  `env` se inyecta (process.env en Node, un env sintético desde query params
 *  en el navegador) para que el módulo siga siendo puro. */
export function resolveServiceUrl(
  name: ServiceName,
  env: Record<string, string | undefined> = {},
): string {
  const override = env[`NEFAN_URL_${name.toUpperCase().replace(/-/g, "_")}`];
  if (override) return override.replace(/\/+$/, "");
  const spec = SERVICES[name];
  const scheme = spec.protocol === "ws" ? "ws" : "http";
  return `${scheme}://127.0.0.1:${portOf(name, env)}`;
}
