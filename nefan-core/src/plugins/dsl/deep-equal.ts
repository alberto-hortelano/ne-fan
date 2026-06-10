/** Igualdad estructural para el DSL: replay de fixtures (compara slice
 *  resultante con `after`) y efecto `pull` (elimina elementos iguales).
 *  Claves con valor `undefined` se tratan como ausentes, igual que en
 *  canonicalJson. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    if (a.length !== bArr.length) return false;
    return a.every((v, i) => deepEqual(v, bArr[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).filter((k) => aObj[k] !== undefined).sort();
  const bKeys = Object.keys(bObj).filter((k) => bObj[k] !== undefined).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, i) => k === bKeys[i] && deepEqual(aObj[k], bObj[k]));
}
