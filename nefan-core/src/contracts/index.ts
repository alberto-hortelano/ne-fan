/** Contratos de los microservicios de ne-fan — punto de entrada único.
 *
 * Mapa (docs/microservices/README.md tiene el detalle y el diagrama):
 *  - S1 game-gateway   WS   :9877  → gateway.ts (reexporta protocol/messages)
 *  - S2 world-state    HTTP :9878  → world-state.ts
 *  - S3 narrative-llm  HTTP :8765  → narrative-llm.ts (+ narrative-mcp-ws.ts, WS :3737)
 *  - S4 gpu-worker     HTTP :8766* → gpu-worker.ts
 *  - S5 remote-gen     HTTP :8768* → remote-gen.ts
 *  - S6 asset-store    HTTP :8767* → asset-store.ts
 *  (* = puerto objetivo; hoy co-viven en ai_server :8765 — ver
 *  SERVICES[...].currentPort y resolveServiceUrl en common.ts.)
 *
 * common.ts es el documento de interfaces común: registro de servicios,
 * sobres de error y los tipos de dominio compartidos (reexportados desde su
 * módulo original de nefan-core, nunca duplicados).
 */

export * from "./http.js";
export * from "./common.js";
export * from "./gateway.js";
export * from "./world-state.js";
export * from "./narrative-llm.js";
export * from "./narrative-mcp-ws.js";
export * from "./gpu-worker.js";
export * from "./remote-gen.js";
export * from "./asset-store.js";
