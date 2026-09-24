# QA — tanda AT: un fallo cierra el viaje solo si es SUYO (#737; #736 fuera)

Validado contra los **criterios reescritos** de `requisitos.md` (los cinco que
sustituyen a los originales) y el issue #737, desde el punto de vista de quien
juega. Worktree `/home/al/code/ne-fan-tanda-at`, rama `feature/tanda-at`, sin
commitear. Cero créditos: todo contra `e2e-sin-creditos` (motor falso) que
levanta `qa/run.mjs` en su bloque. Node 26.10.0 (`nvm use node`).

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| 1 · La decisión «este fallo es de este viaje» es una función pura de core con batería en negativo | ✅ cumple | `deQuienEsElFallo` y `esperasQueTermina(status, viajeAbierto)` en `nefan-core/src/protocol/status-reparto.ts`; el rótulo la importa. `npx tsx --test` de los 4 ficheros tocados: 83/83. Negativos corridos por mí (roto → rojo → restaurado, `grep NEG-QA` a cero al final): **N3** (`=== "del-viaje"` → `!== "ajeno-al-viaje"`) → `status-reparto` 1 ✖ de 12; **N5** (quitar la rama ajena del `case "tile"` del rótulo) → `status-rotulo` 2 ✖ de 38. |
| 1 · Todo error que el bridge emite POR el viaje lleva su `placeId` (incluido el `fail()` de `runTileGeneration` y «Lugar desconocido») | ✅ cumple | Diff: `tile.ts` `fail()` añade `placeId: opts.placeId`; `scene.ts` «Lugar desconocido» añade `placeId`. Censo de productores `kind:"tile"/"scene"` en `bridge/` (grep): los del viaje (scene.ts:36/64/87/176/288, router.ts:269, tile.ts:201 con `opts.placeId`) lo llevan; los ajenos (tile.ts:277 coords inválidas, :304 entrega de `request_tile`, router.ts:257) siguen sin él a propósito. Negativos míos: **N1** (quitar `placeId` del `fail()`) → `bridge-map` 2 ✖ de 28; **N2** (quitarlo de «Lugar desconocido») → 1 ✖ de 28. |
| 2 · Negativo: error de tile ajeno con viaje abierto → ledger abierto, muro «Viajando...» intacto, aviso a la línea, el viaje llega | ✅ cumple | Guion `qa/guiones/173-un-tile-ajeno-no-rompe-el-viaje.mjs` (del ingeniero) en verde: A (`request_tile` con `tx:1.5`, error sin `placeId` al instante) y B (prefetch del tile 6,6 reventando en el motor con el viaje en cola detrás): los tres asertos por bloque en verde, control «el viaje LLEGA con spawn» `{x:128,z:7}`. Capturas `qa/capturas/2026-09-24T12-57-59-110Z-241977/173-…-01/02.png`: «Viajando...» con anillo, y el aviso («⚠ request_tile con coords inválidas», «⚠ El motor narrativo no pudo construirlo») en la línea de mensajes. **Negativo del guion, corrido por mí**: con `deQuienEsElFallo` devolviendo `"del-viaje"` siempre que hay viaje → **7 ✘ con nombre** (ledger con `error`, muro «No se pudo llegar» `error=true`, sin aviso en la línea, control `ViajeRoto`). |
| 2 · Positivo que no se puede perder: el fallo DEL destino sigue cerrando el viaje en segundos | ✅ cumple | Guion 168 en verde dos veces: A · `ViajeRoto` en **228 ms** (techo 10 s), «el rojo NOMBRA la causa»; B · control llega en 188 ms. Guion 170 verde (roto dentro de `absorbe` y llega tras el roto), 137 verde con su aserto nuevo. |
| 3 · #736 fuera de la tanda | ✅ cumple | El diff no toca `message-intake.ts` ni `ws-server.ts`; `ESPERA_POR_KIND.protocolo` sigue `null`. La cabecera de `qa/lib/viaje.mjs` lo declara latente con la premisa corregida. El comentario en el issue es del coordinador (no verificado aquí). |
| 4 · El anillo del spinner fuera de TODOS los muros con `.error`, revisión visual en ≥ 2 | ✅ cumple | Una sola regla, `#narrative-loader.error .spinner { display: none; }` (`game-ui.css`). Vistos los **tres** muros y el de espera: **fallo in-game** (168-01 y 174-02, tema claro `acuarela_luminosa`: título rojo, detalle, «Cerrar», sin anillo); **oferta de reintentar** (78-02, tema oscuro: «La partida ya está disponible» en acento, «Reintentar»/«Cerrar», sin anillo); **muro de arranque** (`combat_config.json` sin `player`, sondeo con DOM leído: `clases:"visible error"`, `spinnerDisplay:"none"`, tres botones `hidden`, captura `qa/capturas/2026-09-24T13-06-38-760Z-298927/qa-muro-de-arranque-combat-config-roto.png`); y **«Viajando...»** (174-01) con el anillo `display:block`, `animation: nf-spin`. Mecánico en guion **174** (mío): espera con anillo → fallo sin anillo, `elapsed` vacío; **negativo**: devolviendo la regla vieja (`animation:none; border-top-color`) → ✘ «sin anillo» con `{"display":"block","animacion":"none"}`. |
| 5 · Guion ejecutable para 2, cero créditos | ✅ cumple | 173 (criterio 2) y 174 (criterio 4). Censo de gasto de cada corrida: `puertas: —` (solo `/generate_scene` del motor falso). `cd nefan-core && npm test` con los dos guiones en el árbol: 3420 tests, 0 fail (candados de saltos, relojes de pared, número único y banco `.mjs`). |

Corridas completas: `node qa/run.mjs 173- 168- 170- 137-` → `4 en verde · 0 en rojo de 4`
(`qa/capturas/2026-09-24T12-57-59-110Z-241977`); `node qa/run.mjs 168- 78-` → 2/2
(`…T13-00-28-813Z-256221`); `node qa/run.mjs 174-` → 1/1 (`…T13-06-38-760Z-298927`).

## Hallazgos

Ninguno bloqueante ni importante contra los criterios. Lo que sigue es lo que
vi y no es de esta tanda, o es juicio visual:

**Menor · fuera de tanda (backlog del plan §6, para issue)** — el mirror del
bug: un tile ajeno que **LLEGA** durante un viaje abierto ejecuta `muro.ocultar()`
(`main.ts`, `case "ready"` de cualquier tile) y quita el «Viajando...» antes de
tiempo; el jugador se queda mirando el mundo viejo sin muro hasta que el viaje
llega y lo teletransporta. Leído en código, **no probado en flujo**. Pasos para
reproducirlo cuando se haga: `delay_ms` alto, `request_tile` de un tile lejano
que SÍ genera, pulsar una salida (en cola detrás), y observar el muro al `ready`
del prefetch. Pide `placeId` en el `ready` del viaje y la misma consulta a
`deQuienEsElFallo`.

**Menor · fuera de tanda (backlog del plan §6)** — `overlayAbierto` se lee del
DOM: con el muro «No se pudo llegar» ya puesto (ledger cerrado → `sin-viaje`),
un error de frontera posterior lo **reescribe** con su propio detalle, porque
`sin-viaje` cae en la regla vieja «overlay abierto → overlay». No lo probé; lo
dice el `switch` del rótulo.

**Menor · visual, previo a la tanda** — en el muro de fallo del tema claro
(168-01, 174-02) el hueco entre el detalle y «Cerrar» es más del doble que el
que hay entre título y detalle: el `.elapsed` vacío sigue ocupando un hueco del
`gap: 14px` del flex, más los 6 px del botón. Con el anillo fuera el bloque es
título/detalle/botón y la asimetría se nota algo más. Y el botón «Cerrar» en
`acuarela_luminosa` tiene poco contraste contra el velo (gris verdoso sobre
beige): legible, pero no invita. Ninguna de las dos es de este diff.

**Menor · teórico, no probado** — `onFalloAjeno` (fallo de OTRA sesión, #312)
también pasa por `pintarFalloDelMotor` con `viajeAbierto`; si la sesión ajena
falla al viajar al **mismo** `placeId` que yo tengo abierto, sale `del-viaje`
y pinta «No se pudo llegar» sobre mi «Viajando...» sin cerrar mi ledger. Para
que pase hacen falta dos sesiones vivas en el mismo bridge, que hoy el takeover
impide; lo apunto porque es la única entrada de `deQuienEsElFallo` que no viene
de mi sesión.

## Workarounds usados

- **Muro de arranque**: para verlo hay que romper `combat_config.json` (puse
  `player: null`), sobre un stack `--keep` en el bloque +100, con un sondeo de
  playwright fuera del repo (`scratchpad/arranque.mjs`); restaurado con `cp` en
  un `trap` y `git diff` limpio. No es un obstáculo que el jugador tenga
  delante: es el estado que ese muro existe para contar. Veredicto: setup
  legítimo, no hallazgo.
- **Negativos**: seis roturas a mano (N1, N2, N3, N5, el `del-viaje` forzado
  para el 173 y la regla CSS vieja para el 174), todas con copia de seguridad y
  `trap`; `grep NEG-QA` a cero y `git status` sin ficheros de más al terminar.
- **Un tropiezo mío, no de la tanda**: lancé el 174 y el stack `--keep` a la vez
  y el `./start.sh --parar` del segundo se llevó el stack del primero en pleno
  censo de gasto (`1 SIN MEDIR`). Repetido solo → `1 en verde`. Solo se pararon
  procesos de este worktree (los seis puertos listados eran de
  `ne-fan-tanda-at`).

## No probado

- **Mutación de `status-rotulo`**: el ingeniero la declara rechazada por el tope
  local (≈121 > 120) y pedida; no la corrí. `status-reparto` la da él en 100 %.
- **`npm run verify` completo**: corrí `npm test` (3420, 0 fail) dos veces, los
  4 ficheros de test tocados y los guiones; no `crap`, `ejercicio` ni `eslint`
  de `nefan-html` (los declara verdes `implementacion.md`).
- El hallazgo del `ready` ajeno y el de la reescritura del muro (arriba): leídos
  en código, sin flujo.
- El comentario en #736 (coordinador).

## Veredicto

**Apto.** Los cinco criterios reescritos se cumplen en el flujo real desde el
arranque, los guiones 173 y 174 se ponen rojos cuando se rompe lo que miden, el
positivo de #693 (168) no se ha perdido (228 ms), y el anillo está fuera de los
tres muros con `.error` y sigue en el de espera. Los hallazgos son todos ajenos
al diff y van a issues, no a otra vuelta del ingeniero.
