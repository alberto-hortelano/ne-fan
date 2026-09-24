/** La RED del atlas fps: lo que el controller (`fps-atlas.ts`) hace contra
 *  los servicios y no decide nada —la clave del layout, el tope de una
 *  corrida y el registro de la keep-list del prune—. Sale de allí en la
 *  tanda AX, al darle el tope a las corridas, para que el controller quepa en
 *  el tope de tamaño del cliente sin excepción. */

import { errors } from "../ui/error-log.js";

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Una corrida es dueña de su clave hasta que acaba: sin tope, un POST
 *  colgado bloqueaba el tile hasta recargar (QA de la tanda AX, H-2). Al
 *  vencer `ms`, aborta el fetch y LANZA: el llamante lo dice y suelta la
 *  clave, y lo que llegue tarde ya no manda. El valor es de core
 *  (`TOPE_DE_CORRIDA_MS`). */
export async function conTope<T>(
  key: string,
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctl = new AbortController();
  let t: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rej) => {
    t = setTimeout(() => {
      ctl.abort();
      rej(new Error(`el atlas de ${key} no terminó en ${ms / 1000} s: se suelta el tile`));
    }, ms);
  });
  try {
    return await Promise.race([fn(ctl.signal), tope]);
  } finally {
    clearTimeout(t);
  }
}

/** Keep-list del prune: los hashes usados por la escena viva. Best-effort
 *  (un fallo no rompe la instalación) pero con traza. `state` vacío = sin
 *  registro. */
export async function registrarRefs(state: string, sceneId: string, refs: string[]): Promise<void> {
  if (!state || refs.length === 0) return;
  try {
    const res = await fetch(`${state}/scene/asset_refs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene_id: sceneId, refs: [...new Set(refs)] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    errors.push("scene", `asset_refs de ${sceneId} no registrados (prune podría podarlos)`, err);
  }
}
