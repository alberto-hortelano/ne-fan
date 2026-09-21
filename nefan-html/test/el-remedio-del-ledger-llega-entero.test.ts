/** H6 de la re-QA de la tanda AB (#426) — EL DETALLE DE UN RECHAZO NO SE RECORTA.
 *
 *  `GET /dev/status` contesta 500 cuando el ledger de gasto es anterior a #426,
 *  y su `detail` trae el comando que lo arregla: un `mkdir -p … && mv …` con el
 *  nombre del fichero destino AL FINAL. Todo el camino de H1 —pintar la causa
 *  en el panel en vez de decir «ai_server offline»— existe para entregar ese
 *  texto.
 *
 *  Nació recortándolo a 300 caracteres «porque el destino es el HUD», y el
 *  `detail` del checkout principal mide **337**: lo que llegaba a la pantalla
 *  terminaba en `…/archivo/cache/spend/ev`, y quien lo copiara archivaba el
 *  ledger con el nombre `ev`. O sea que el recorte se comía exactamente la
 *  parte por la que se hizo el arreglo, y la batería no podía verlo: el `detail`
 *  de atrezo del guion 153 medía 400+ y sus asertos pedían subcadenas que caben
 *  en los primeros 300.
 *
 *  Vive aquí y no en el guion porque `detalleDelRechazo` es una función PURA y
 *  medirla no necesita navegador: el guion 153 afirma que lo pintado termina en
 *  el destino completo (la otra mitad, la del cable hasta el DOM), y esto afirma
 *  la función, que es donde estaba el recorte. Las dos hacen falta.
 *
 *  LO QUE NO MIRA: dónde lo pinta el panel (guion 153), ni que remote-gen emita
 *  ese `detail` (`test_dev_status_sobre_un_ledger_anterior_a_426_es_500_con_el_remedio`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { detalleDelRechazo } from "../src/ui/dev-status-panel.js";

/** El `detail` REAL del checkout principal, con su ruta: 337 caracteres. Se
 *  escribe entero y no por trozos porque su LARGO es justo lo que se mide. */
const DESTINO = "/home/al/code/ne-fan/archivo/cache/spend/events-sin-procedencia-2026-09-20.jsonl";
const DETALLE_REAL =
  "/home/al/code/ne-fan/cache/spend/events.jsonl:1 es un evento sin `procedencia`: " +
  "un ledger anterior a #426 no se migra ni se marca, se ARCHIVA como en T9 → " +
  "mkdir -p /home/al/code/ne-fan/archivo/cache/spend && " +
  `mv /home/al/code/ne-fan/cache/spend/events.jsonl ${DESTINO}`;

test("el `detail` de FastAPI llega ENTERO, con el nombre del fichero destino al final", () => {
  // La premisa del hallazgo, medida aquí para que no se cite de memoria: si
  // este número bajara de 300, el test pasaría sin comprobar nada.
  assert.ok(
    DETALLE_REAL.length > 300,
    `el detalle de referencia mide ${DETALLE_REAL.length} y tiene que pasar de 300 para medir el recorte`,
  );

  const { texto, forma } = detalleDelRechazo(JSON.stringify({ detail: DETALLE_REAL }));

  assert.equal(forma, "detail");
  assert.equal(texto, DETALLE_REAL);
  // Y el aserto que nombra el daño: el comando termina donde tiene que terminar.
  assert.ok(texto.endsWith(DESTINO), `el remedio acaba en «${texto.slice(-40)}»`);
  assert.ok(!texto.endsWith("/ev"), "el corte de los 300 caracteres ha vuelto");
});

test("un cuerpo sin `detail` se devuelve entero y se dice que es crudo", () => {
  const crudo = `x${"y".repeat(500)}z`;
  const { texto, forma } = detalleDelRechazo(JSON.stringify({ otra_cosa: crudo }));
  assert.equal(forma, "crudo");
  // El cuerpo entero, no el `detail` que no vino: quien lo lea tiene que poder
  // ver QUÉ mandó el server, y el aviso de al lado dice que no mandó `detail`.
  assert.ok(texto.includes(crudo));
});

test("un cuerpo que no es JSON no se traga: su motivo viaja pegado al texto", () => {
  const { texto, forma } = detalleDelRechazo("<html>502 Bad Gateway</html>");
  assert.equal(forma, "crudo");
  assert.ok(texto.startsWith("<html>502 Bad Gateway</html>"));
  assert.match(texto, /cuerpo ilegible: /);
});
