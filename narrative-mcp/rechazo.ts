// Salida ÚNICA de error del pre-flight de narrative_respond y de
// map_upsert_place. El rechazo vuelve al modelo como `isError` (para que
// corrija y re-responda) y además deja UNA línea en stderr con su clase:
// sin esto el único registro era la transcripción del motor, que en una
// terminal interactiva nadie guarda, y un playtest no podía contar los
// rechazos por el log (QA de la tanda BM, H4). Sin imports a propósito: lo
// carga un test de nefan-core sin arrastrar el servidor MCP.

/** Tope de la línea de stderr: el texto va entero al modelo, pero al log
 *  basta con lo que identifica el rechazo (un grep por su clase o su causa). */
export const RECHAZO_MAX_CHARS = 500;

export function rechazo(
  clase: string,
  texto: string,
  donde: { kind?: string; req?: string | null } = {},
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const unaLinea = texto.replace(/\s*\n\s*/g, ' | ').slice(0, RECHAZO_MAX_CHARS);
  console.error(
    `[narrative-mcp] rechazo ${clase} kind=${donde.kind ?? '-'} req=${donde.req ?? '-'}: ${unaLinea}`,
  );
  return { content: [{ type: 'text', text: texto }], isError: true };
}
