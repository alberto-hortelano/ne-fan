/** QUÉ ES «EL BRIDGE RECHAZÓ» — escrito UNA vez (#739, absorbe #738).
 *
 *  El bridge dice que no por `narrative_status` con `phase:"error"`: por
 *  UNICAST al socket que mandó un frame que no pasa el contrato
 *  (`kind:"protocolo"`, `bridge/ws-server.ts`), y por difusión a quien esté
 *  suscrito para cualquier otro `kind` (`tile`, `scene`…). Y un frame que no se
 *  puede leer no se tira: es un rechazo `ilegible`, porque es exactamente el
 *  dato que falta cuando la consecuencia no llega.
 *
 *  Hasta #739 esa regla estaba escrita cinco veces con tres lecturas distintas:
 *  `cable.mjs` y `sesion.mjs` (copia literal, en la página), los dos clientes
 *  Node de los candados headless (cualquier error corta) y el `--diag` de
 *  `run.mjs` (solo `protocolo` cortaba, y su `JSON.parse` LANZABA dentro del
 *  manejador). Ahora las cinco leen con `leerFrame`; lo que cada una HACE con
 *  el rechazo —apuntarlo, parar la espera, rechazar la promesa— es su política,
 *  y vive en su sitio (`RECHAZOS_QUE_PARAN` de `cable.mjs`, «cualquiera corta»
 *  de `bridge-desde-node.mjs`).
 *
 *  ── POR QUÉ LA FUENTE VIAJA COMO TEXTO ─────────────────────────────────────
 *
 *  Los oyentes de `cable.mjs` y `pedirYEsperarTile` viven DENTRO de
 *  `page.evaluate`: Playwright serializa esa función y la página no ve un
 *  `import`. Así que la página no recibe una copia: recibe ESTA función como
 *  dato (`FUENTE_DE_LEER_FRAME`) y la reconstruye. Eso exige que `leerFrame` sea
 *  AUTOCONTENIDA —ni imports, ni cierres, ni helpers de este módulo—, y lo
 *  canda `nefan-core/test/rechazo-del-bridge.test.ts`, que corre la misma tabla
 *  de casos contra la función y contra su forma reconstruida desde el texto: un
 *  helper externo pone la segunda en rojo con `ReferenceError`, que es lo que
 *  haría la página al primer frame. */

/** Lee un frame del bridge. Devuelve `{ frame, rechazo }` y NUNCA lanza:
 *   · ilegible → `{ frame: null, rechazo: { kind: "ilegible", message } }`, con
 *     el error del parseo y los primeros 200 bytes;
 *   · `narrative_status` + `phase:"error"` → `{ frame, rechazo: { kind, message } }`
 *     (`kind` null si no lo trae; `message` «sin mensaje» si no lo trae);
 *   · cualquier otro → `{ frame, rechazo: null }`.
 *  `data` que no sea string se lee como `String(data)` (Node entrega string; un
 *  `Blob` o un buffer salen ilegibles con su texto, no se inventan).
 *
 *  AUTOCONTENIDA: ver la cabecera. No uses nada de fuera de este cuerpo. */
export function leerFrame(data) {
  const texto = typeof data === "string" ? data : String(data);
  let frame;
  try {
    frame = JSON.parse(texto);
  } catch (e) {
    return { frame: null, rechazo: { kind: "ilegible", message: `${String(e)} — ${texto.slice(0, 200)}` } };
  }
  if (frame !== null && typeof frame === "object" && frame.type === "narrative_status" && frame.phase === "error") {
    return { frame, rechazo: { kind: frame.kind ?? null, message: frame.message ?? "sin mensaje" } };
  }
  return { frame, rechazo: null };
}

/** Lo que viaja a la página en el argumento de `evaluate`. Allí se reconstruye
 *  con `new Function(\`return (${fuente})\`)()`. */
export const FUENTE_DE_LEER_FRAME = leerFrame.toString();
