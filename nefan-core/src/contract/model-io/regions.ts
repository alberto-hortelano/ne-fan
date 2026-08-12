/** Región autogenerada dentro de un prompt `.md`: el bloque de contrato que
 *  el codegen (`npm run gen:contract`) escribe desde el zod SoT y que el test
 *  de deriva vuelve a comparar. La prosa del `.md` vive FUERA de la región;
 *  dentro solo va el tipo, generado, nunca editado a mano. */

export const REGION_START =
  "<!-- SCHEMA:AUTO — generado por `npm run gen:contract` desde src/contract/model-io/schemas.ts; NO editar a mano -->";
export const REGION_END = "<!-- /SCHEMA:AUTO -->";

/** Envuelve el texto de contrato en un bloque de código con los marcadores. */
export function buildRegion(contract: string): string {
  return `${REGION_START}\n\`\`\`ts\n${contract}\n\`\`\`\n${REGION_END}`;
}

/** Extrae el texto de contrato (sin marcadores ni fences) de un `.md`, o null
 *  si no hay región. */
export function extractRegion(md: string): string | null {
  const start = md.indexOf(REGION_START);
  const end = md.indexOf(REGION_END);
  if (start === -1 || end === -1 || end < start) return null;
  const inner = md.slice(start + REGION_START.length, end);
  const fenceMatch = inner.match(/```ts\n([\s\S]*?)\n```/);
  return fenceMatch ? fenceMatch[1] : null;
}

/** Inserta o reemplaza la región en un `.md`. Si no existe, la añade al final
 *  (con una separación en blanco). Devuelve el `.md` completo actualizado. */
export function injectRegion(md: string, contract: string): string {
  const block = buildRegion(contract);
  const start = md.indexOf(REGION_START);
  const end = md.indexOf(REGION_END);
  if (start !== -1 && end !== -1 && end > start) {
    return md.slice(0, start) + block + md.slice(end + REGION_END.length);
  }
  const trimmed = md.replace(/\s+$/, "");
  return `${trimmed}\n\n${block}\n`;
}
