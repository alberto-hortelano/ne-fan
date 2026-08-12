/** Borde de entrada del bridge: parsea y VALIDA un frame WS crudo del cliente
 *  antes de que llegue al router/handlers. Función pura respecto al transporte
 *  (como router.ts) para que el borde sea testeable sin arrancar el servidor.
 *
 *  Dos fallos posibles, ambos fail-loud (nunca se enruta basura):
 *   - JSON inválido → `reason: "json"`.
 *   - JSON válido pero no conforme al contrato `ClientMessage` → `reason:
 *     "schema"` con el error zod formateado (ruta + motivo).
 *  ws-server.ts mapea ambos a un `narrative_status` phase "error" hacia el
 *  cliente. */

import { ClientMessageSchema } from "../src/protocol/message-schema.js";
import { validateContract } from "../src/contract/model-io/validate.js";
import type { ClientMessage } from "../src/protocol/messages.js";

export type IntakeResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; reason: "json" | "schema"; error: string };

export function intakeClientMessage(raw: string): IntakeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: "json", error: (err as Error).message };
  }
  const check = validateContract(ClientMessageSchema, parsed);
  if (!check.ok) return { ok: false, reason: "schema", error: check.error };
  // El shape ya está garantizado por el zod (espejo del union TS, con guardia
  // de deriva en message-schema.test.ts): el cast es sólido.
  return { ok: true, msg: parsed as ClientMessage };
}
