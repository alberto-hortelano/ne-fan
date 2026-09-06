# #469, reencuadrado — un solo muro por causa, en el idioma del jugador

Hermano del programa #358 (misma carpeta): el usuario decidió el 2026-09-06 que #469 fuese «PR propia tras el
corte 1», sobre el módulo nuevo `nefan-html/src/ui/muro-de-carga.ts`. La QA del corte 1 (`qa-1.md`, H1)
caducó el cuerpo del issue; con esa medida, el usuario eligió, literal: **«Reencuadrar y hacer la PR ahora»**
(frente a cerrarlo y pasar lo vivo a #427, o hacer antes el corte 2). El crítico se salta porque la QA ya hizo
la medida que el crítico haría; está anotada en el issue (comentario del 2026-09-06).

## Lo que el issue decía y ya no es cierto

«En `html-fixtures` el muro "sin bridge" reaparece cada ~5 s: el reintento del socket vuelve a levantar el aviso
que el jugador ya cerró». **No se reproduce** (60 s / 12 reintentos sin bridge; 4 con partida detrás): la
dedupe por trío `(source, titulo, mensaje)` de `ErrorLog.avisa` existe desde `e67ae4d` (#423, 09-04), un día
ANTES de que se abriera el issue. El candado que pedía ya existe: `qa/guiones/77-el-muro-cerrado-no-vuelve-
mientras-el-bridge-siga-caido.mjs` (PR #477), verde hoy y rojo con la dedupe anulada.

## Lo que sí está vivo (medido en `qa-1.md`, sobre `9216d7c` = hoy `4d972f5`)

Sin bridge, el jugador ve **dos muros consecutivos por la misma causa, con textos distintos**:

| ms | quién lo pone | titular | detalle |
|---|---|---|---|
| ~180 | `bridge-client.ts:147` → `errors.push("bridge", …)` → suscriptor `errors.onAviso` en `muro-de-carga.ts:156` | «Sin conexión con la partida» (`AVISO_PARTIDA`, `error-log.ts:65`) | «el socket de la partida no abre (ws://…)» |
| ~5.100 | `game-client.ts:257` (timeout de `createGameClient`) → `catch` del bootstrap en `main.ts:1995/2011` → `muro.fallo(...)` | «No se pudo arrancar la partida» | «bridge did not connect within 5000ms — is nefan-core bridge running on ws://…?» — **jerga de desarrollo en inglés en la pantalla del jugador** |

Quien cierra el primero ve el segundo cinco segundos después. Eso es lo que las QA de T13 llamaron
«reaparece».

Y una **política sin escribir**: `muroPuestoPorAviso` se queda en `"bridge"` cuando el muro de bootstrap
sobreescribe al del aviso (`fallo()` no lo toca, `muro-de-carga.ts:103`): si el bridge llegara,
`resuelto("bridge")` cerraría el muro de bootstrap. Hoy es coherente porque la causa es la misma, pero es un
accidente que funciona, no una decisión.

## Lo que se pide

1. **Un solo muro por causa.** Cuando el socket no abre y después el bootstrap agota su timeout por lo mismo,
   el jugador ve UN muro, con UN titular, que no cambia de texto por debajo ni se apila. Cómo se consigue lo
   decide el arquitecto (el bootstrap reconoce que la causa ya está en pantalla; o el fallo de bootstrap con
   causa «bridge» pasa por el mismo canal `errors` con la misma fuente y la dedupe hace el resto; u otra), con
   la restricción de que la DECISIÓN viva en `muro-de-carga.ts` o en `error-log.ts`, que son los dueños del
   aviso, no repartida por `main.ts`.
2. **En el idioma del jugador.** Ningún texto en inglés ni con jerga de desarrollo (`bridge`, `ws://`, `ms`)
   llega al muro. El detalle técnico sigue existiendo para el desarrollador: va al `error-log` (panel de dev),
   no al muro. `game-client.ts:257` puede seguir lanzando su mensaje técnico; quien lo PINTA lo traduce o lo
   relega, como ya hacen `status-rotulo.ts`/`status-motivo.ts` en core para los fallos del motor (mirar si ese
   par ya cubre este caso antes de inventar otro).
3. **La política de `muroPuestoPorAviso`, escrita y cumplida**: qué pasa con el muro cuando la causa que lo puso
   se resuelve, según quién lo puso (aviso, bootstrap, fallo del motor). Un test o un guion que la demuestre en
   la dirección que hoy nadie ejerce: el bridge LLEGA después de que el bootstrap fallara por su ausencia. (En
   `e2e-sin-creditos` se puede: arrancar el cliente sin el fake, dejar fallar el bootstrap, levantar el fake.)
4. **El guion 77 sigue verde sin retocarlo.** Y `fixtures-sin-bridge.mjs`, `las-fixtures-solo-chocan-con-el-
   agua.mjs`, `fixtures-las-tres-se-caminan.mjs` (los que esperan el muro por titular): si el titular del muro
   cambia, esos guiones lo notarán — eso es un cambio de contrato observable y hay que decidirlo, no colarlo.
   Regla del programa: si un guion solo pasa retocándolo, es un hallazgo; pero un guion que esperaba el
   titular VIEJO de un muro que ya no existe se actualiza con la PR y se dice.
5. **El issue se reescribe** (título y cuerpo) con lo vivo antes de abrir la PR, y se cierra desde ella.

## Restricciones

- Las del programa #358 (`requisitos.md`): cero créditos, no matar servidores ajenos (offset propio, `--parar`),
  lógica en core y el cliente solo pinta (la traducción de un fallo a texto de jugador es presentación y puede
  vivir en el cliente; una CLASIFICACIÓN de causas es lógica y, si hace falta, va a core como `status-motivo`),
  cero rastros, ningún fichero nuevo > 450, `client-file-size.json` con la cifra exacta de `main.ts` si cambia.
- Cambio de comportamiento observable → ciclo con arquitecto, ingeniero y QA. La QA valida contra ESTE
  documento, no contra el cuerpo viejo de #469.
- Lo que no entra: #427 (los tres huecos del título), #425 (los 30 s mudos), #346. Si el arquitecto ve que la
  solución correcta pasa por #427, lo dice y se para a consultar.

## Aceptación

- Sin bridge (`html-fixtures` y `e2e-sin-creditos` con el fake apagado): el jugador ve **un** muro, con titular
  y detalle en español y sin jerga, y al cerrarlo no vuelve mientras el bridge siga caído (guion 77 verde).
- Bridge caído a mitad de partida: igual, un muro; cuando el bridge vuelve, el muro se retira solo (ya pasa hoy,
  no debe dejar de pasar).
- Bridge que LLEGA tras un bootstrap fallido: comportamiento decidido, escrito en el módulo y demostrado.
- `grep -rn "did not connect"` y cualquier otro inglés de desarrollo: cero en lo que se pinta al jugador.
- `npm run verify`, `tsc`/`lint`/`build` del cliente, y los guiones de la red (69, 70, 71, 77, 20, 35, 50, 56 y
  los tres de fixtures) verdes; los que cambien de titular, cambiados con motivo en la PR.
