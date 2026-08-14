/** Validación de una respuesta del modelo contra su schema zod SoT, con el
 *  error formateado de forma legible para DEVOLVERLO AL MODELO (el pre-flight
 *  MCP lo pega en el mensaje isError para que corrija y re-responda). Es el
 *  único gate cuyo error vuelve al modelo, así que el mensaje debe ser preciso:
 *  ruta + motivo del PRIMER problema. */

import type { ZodTypeAny, ZodError } from "zod";

export type ContractCheck = { ok: true } | { ok: false; error: string };

/** Formatea la ruta de un issue zod como `a.b[0].c` (índices en corchetes). */
function formatPath(path: (string | number)[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${seg}` : seg;
  }
  return out;
}

function formatError(err: ZodError): string {
  const issues = err.issues;
  if (issues.length === 0) return "invalid payload";
  // El primer issue suele ser el más accionable; si hay varios, resumimos.
  const first = issues[0];
  const path = formatPath(first.path);
  const head = path ? `${path}: ${first.message}` : first.message;
  if (issues.length === 1) return head;
  return `${head} (y ${issues.length - 1} problema(s) más)`;
}

export function validateContract(schema: ZodTypeAny, data: unknown): ContractCheck {
  const res = schema.safeParse(data);
  if (res.success) return { ok: true };
  return { ok: false, error: formatError(res.error) };
}

/** Mismo formato ruta+motivo, exportado para los bordes HTTP internos
 *  (contracts/request-schemas.ts → state-http-server / asset-store). */
export const formatZodError = formatError;
