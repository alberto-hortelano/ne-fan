/** Trazas de desarrollo de los pipelines de imagen/colisión — GATEADAS.
 *
 * Los pipelines (scene-image, collision) emiten decenas de
 * `console.log` por tile; en una partida normal son ruido puro. Este
 * módulo los apaga por defecto y los enciende opt-in:
 *   - URL: `?debug=1`
 *   - persistente: `localStorage.nefan_debug = "1"`
 *   - en caliente: `window.__nefan.debug(true)` (persiste en localStorage)
 *
 * Solo para trazas informativas: los errores siguen yendo por
 * `errors.push(...)` (ui/error-log.ts) o `console.warn/error`, NUNCA por
 * aquí — gatear un error lo convertiría en silencio (regla fail-loud).
 */

const LS_KEY = "nefan_debug";

let enabled = ((): boolean => {
  try {
    if (new URLSearchParams(window.location.search).get("debug") === "1") return true;
    return window.localStorage.getItem(LS_KEY) === "1";
  } catch {
    // Sin window/localStorage (tests fuera del navegador): apagado.
    return false;
  }
})();

export function debugLogEnabled(): boolean {
  return enabled;
}

/** Activa/desactiva las trazas y lo persiste para las siguientes cargas. */
export function setDebugLog(on: boolean): void {
  enabled = on;
  try {
    if (on) window.localStorage.setItem(LS_KEY, "1");
    else window.localStorage.removeItem(LS_KEY);
  } catch {
    // localStorage puede no estar disponible; el toggle en memoria basta.
  }
  console.log(`[debug-log] trazas de pipelines ${on ? "ACTIVADAS" : "desactivadas"}`);
}

/** console.log gateado. Mismo contrato que console.log (lazy no hace falta:
 *  los argumentos ya construidos son strings cortos). */
export function dlog(...args: unknown[]): void {
  if (enabled) console.log(...args);
}
