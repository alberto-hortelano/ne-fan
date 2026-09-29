// Salida ÚNICA de error del pre-flight de narrative_respond, scene_validate y
// map_upsert_place. El rechazo vuelve al modelo como `isError` (para que
// corrija y re-responda) y además deja UNA línea en stderr con su clase:
// sin esto el único registro era la transcripción del motor, que en una
// terminal interactiva nadie guarda, y un playtest no podía contar los
// rechazos por el log (QA de la tanda BM, H4). Sin imports a propósito: lo
// carga un test de nefan-core sin arrastrar el servidor MCP.
//
// Lo que NO pasa por aquí —la validación de argumentos del SDK, una tool que
// no existe, el `isError` literal de las demás tools— lo recoge
// `vigilarErroresDeTool` en el transporte (F4 de la misma QA). Para no
// escribir dos líneas por un rechazo, `rechazo()` MARCA su resultado en
// `_meta`, que el SDK conserva (el esquema del resultado es `looseObject`) y
// el vigilante respeta. Si un SDK futuro tirase el `_meta`, el fallo sería
// una línea DE MÁS, no una de menos.

/** Tope de la línea de stderr: el texto va entero al modelo, pero al log
 *  basta con lo que identifica el rechazo (un grep por su clase o su causa). */
export const RECHAZO_MAX_CHARS = 500;

/** Clave de `_meta` con la que `rechazo()` dice «esta línea ya está escrita». */
export const MARCA_DE_RECHAZO = 'nefan/rechazo';

export function lineaDeRechazo(
  clase: string,
  texto: string,
  donde: { kind?: string; req?: string | null } = {},
): string {
  const unaLinea = texto.replace(/\s*\n\s*/g, ' | ').slice(0, RECHAZO_MAX_CHARS);
  return `[narrative-mcp] rechazo ${clase} kind=${donde.kind ?? '-'} req=${donde.req ?? '-'}: ${unaLinea}`;
}

export function rechazo(
  clase: string,
  texto: string,
  donde: { kind?: string; req?: string | null } = {},
): { content: Array<{ type: 'text'; text: string }>; isError: true; _meta: Record<string, string> } {
  console.error(lineaDeRechazo(clase, texto, donde));
  return { content: [{ type: 'text', text: texto }], isError: true, _meta: { [MARCA_DE_RECHAZO]: clase } };
}

/** Cómo empieza el texto con el que el SDK de MCP (1.x,
 *  `McpServer.validateToolInput`) devuelve unos argumentos que no pasan el
 *  esquema de la tool (medido: `MCP error -32602: Input validation error: …`).
 *  Solo CLASIFICA la línea (`argumentos` frente a `herramienta`): si el SDK lo
 *  cambiara, la línea se seguiría escribiendo, con la otra clase. */
const ARGUMENTOS_DEL_SDK = /^(MCP error -?\d+: )?Input validation error/;

type Mensaje = {
  id?: string | number;
  method?: string;
  params?: { name?: unknown };
  result?: { isError?: unknown; content?: Array<{ text?: unknown }>; _meta?: Record<string, unknown> };
  error?: { message?: unknown };
};

/** Envuelve el transporte YA conectado (`server.connect`) para escribir la
 *  línea de todo error de tool que no la haya escrito `rechazo()`: apunta el
 *  nombre de la tool de cada `tools/call` que entra y, al salir su respuesta,
 *  mira si es un `isError` sin marca o un error de JSON-RPC. Solo usa la cara
 *  pública del transporte (`onmessage` y `send`). */
export function vigilarErroresDeTool(transporte: object): void {
  const t = transporte as {
    onmessage?: (mensaje: unknown, extra?: unknown) => void;
    send: (mensaje: unknown, opciones?: unknown) => Promise<void>;
  };
  const herramientaDe = new Map<string | number, string>();
  const recibir = t.onmessage;
  t.onmessage = (mensaje, extra) => {
    const m = mensaje as Mensaje;
    if (m.method === 'tools/call' && m.id !== undefined) {
      herramientaDe.set(m.id, typeof m.params?.name === 'string' ? m.params.name : '?');
    }
    recibir?.(mensaje, extra);
  };
  const enviar = t.send.bind(t);
  t.send = (mensaje, opciones) => {
    const m = mensaje as Mensaje;
    if (m.id !== undefined && herramientaDe.has(m.id)) {
      const kind = herramientaDe.get(m.id);
      herramientaDe.delete(m.id);
      const linea = lineaSinRechazo(m, kind);
      if (linea) console.error(linea);
    }
    return enviar(mensaje, opciones);
  };
}

function lineaSinRechazo(m: Mensaje, kind: string | undefined): string | null {
  if (m.error) return lineaDeRechazo('jsonrpc', String(m.error.message ?? ''), { kind });
  const r = m.result;
  if (!r || r.isError !== true || r._meta?.[MARCA_DE_RECHAZO] !== undefined) return null;
  const texto = (r.content ?? []).map((c) => String(c.text ?? '')).join(' ');
  const clase = ARGUMENTOS_DEL_SDK.test(texto) ? 'argumentos' : 'herramienta';
  return lineaDeRechazo(clase, texto, { kind });
}
