/** Thin HTTP client for the bridge's State API (nefan-core/bridge/state-http-server.ts).
 *
 * The narrative engine's state tools (map / entities / inventory) talk to the
 * bridge directly over HTTP — the bridge owns the authoritative NarrativeState.
 * This is the "state cycle", separate from the generation cycle that flows
 * through the AI server over WebSocket.
 */

import { RUNTIME_CONFIG } from "./runtime-config.js";

const BRIDGE_HTTP_URL =
  process.env.NEFAN_STATE_HTTP_URL || `http://127.0.0.1:${RUNTIME_CONFIG.ports.state_api}`;
const TIMEOUT_MS = 8_000;

/** Hook de actividad: server.ts lo instala para convertir CADA llamada de
 *  tool de estado en un latido de progreso (resetea el timeout de ai_server
 *  y alimenta el loader del cliente). */
let activityHook: ((method: string, path: string) => void) | null = null;

export function setActivityHook(fn: (method: string, path: string) => void): void {
  activityHook = fn;
}

/** Envía un mensaje de progreso al State API del bridge (fire-and-forget,
 *  SIN pasar por el hook — evita recursión) para que lo difunda al cliente. */
export function postProgress(message: string): void {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  void fetch(`${BRIDGE_HTTP_URL}/narrative_progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal: ctrl.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

export interface BridgeResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

async function request(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<BridgeResult> {
  activityHook?.(method, path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const errMsg =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, data, error: errMsg };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    return {
      ok: false,
      status: 0,
      data: null,
      error:
        `bridge unreachable at ${BRIDGE_HTTP_URL} (${msg}). ` +
        `Is the nefan-core bridge running?`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function bridgeGet(path: string): Promise<BridgeResult> {
  return request("GET", path);
}

export function bridgePost(path: string, body: unknown): Promise<BridgeResult> {
  return request("POST", path, body);
}
