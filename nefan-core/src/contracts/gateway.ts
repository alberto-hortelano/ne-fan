/** S1 · game-gateway — WebSocket :9877 (protocolo con los clientes Godot/HTML).
 *
 * El contrato YA existe y es la fuente: `src/protocol/messages.ts`
 * (`ClientMessage`, 19 variantes cliente→gateway; `ServerMessage`, 10
 * variantes gateway→cliente). Este módulo lo reexporta íntegro — no se
 * redefine nada.
 *
 * Convenciones de transporte (implementadas en bridge/ws-server.ts +
 * bridge/router.ts):
 *  - Un mensaje JSON por frame de texto WS; frame inválido → narrative_status
 *    phase "error" (fail-loud, nunca silencio).
 *  - Correlación petición/respuesta por `requestId` cuando el mensaje lo
 *    lleva; el resto de `ServerMessage` son push.
 *  - Broadcast (`narrative_event`, `narrative_status`): solo a los sockets
 *    suscritos, y la suscripción se hace EXCLUSIVAMENTE al procesar
 *    start_session/resume_session.
 *  - La escena viaja SIEMPRE normalizada a world scene (`formatDToWorld`);
 *    lo que se persiste es Format D crudo. Godot hace push_error ante un
 *    Format D sin normalizar.
 *
 * El hot loop (mensaje `input` → tick de GameSimulation → `state_update`) es
 * la razón por la que la simulación NO es un microservicio: vive in-process
 * en el gateway.
 */

export * from "../protocol/messages.js";
