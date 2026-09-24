# QA — tanda AV (#742): el muro del viaje lo quita su destino

Validado sobre `feature/tanda-av` (diff sin commitear sobre `2d411d11`), Node v26.10.0, preset
`e2e-sin-creditos` levantado por `node qa/run.mjs` (motor falso; gasto 0,00 €). Criterios: los
ocho de `requisitos.md` («Criterios reescritos tras la crítica») más los mínimos (lógica en
core, negativos en rojo, guion ejecutable, cero créditos). Lo que aquí se afirma lo corrí yo;
lo del informe del ingeniero solo se cita cuando lo he repetido.

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **1** Core decide la LLEGADA junto a `esperasQueTermina`/`deQuienEs`; el cliente no compara `placeId` | ✅ cumple | `status-reparto.ts`: `esperasQueTermina` → `"llegada"` solo con `kind:"tile"` + `phase:"ready"` + `deQuienEs === "del-viaje"`; `elReadyQuitaElMuro` reutiliza esa misma respuesta (no hay segunda regla). `main.ts` no toca `placeId`: `grep -n placeId nefan-html/src/main.ts` da solo `status.placeId && status.enqueued` (el acuse) y la llamada a core. Unitarios: `npx tsx --test test/status-reparto.test.ts …` → 198/198 |
| **2** El bridge marca con `placeId` todo `ready` emitido POR un viaje, ramas `already`/`exists`/`engine`, lugar realizado y `sin ancla`; test que se pone rojo por rama | ✅ cumple | `broadcastScene` lleva `meta.viaje?: { placeId; sitio }` (un `spawn` sin `placeId` no se puede escribir); `runTileGeneration` marca las tres ramas con `porElViaje()`; `difundirPlaceRealizado` con `viaje: { placeId, sitio: donde }`. **Negativo hecho por mí**: rama `already` con `viaje: undefined` → `bridge-map.test.ts` **1 en rojo de 34**; restaurado (`cmp` idéntico). `request_tile` y el arranque salen sin `placeId` (tests de bridge-map y bridge-session) |
| **3a** Un `ready` ajeno no quita el «Viajando...» | ✅ cumple | Guion 177 (mi corrida `2026-09-24T14-35-17`): A `request_tile` instantáneo del tile actual y B prefetch `tile_6_6` en vuelo → en los dos `muro=«Viajando...» visible=true error=false`, ledger abierto; captura 02 muestra el contador en **8s**, o sea que el muro ni se quitó ni se volvió a pintar. Control: el viaje llega (`llegado 9972`, spawn `{128,7}`) y el muro se va |
| **3b** …ni un muro de FALLO | ✅ cumple | **Guion 178 (nuevo, mío)** bloque B: viaje roto en el motor → «No se pudo llegar» con `.error`; llega el `ready` del `request_tile` del tile actual → `muro=«No se pudo llegar» visible=true error=true`, mismo detalle, ledger cerrado por `error` y `llegado:null`. Captura 178-02 |
| **3c** El arranque sigue igual: el primer tile quita «Iniciando partida...» | ✅ cumple | Guion 178 bloque A, con un `MutationObserver` instalado ANTES de «Comenzar»: `[{visible:true,titulo:"Iniciando partida...",error:false},{visible:false,…}]` (en la primera corrida, con reloj, 255 ms de muro) — quitado por el primer tile sin viaje abierto; después `viaje === null` y sin muro. Todos los demás guiones de la batería (7 de regresión + 177) arrancan partida por este camino |
| **4** El fallo del destino va al overlay por ser DEL viaje, no por `muro.visible()`; `overlayAbierto` fuera del DOM; un fallo de tile sin viaje no sustituye un muro de fallo | ✅ cumple | `ContextoDeRotulo` ya no tiene `overlayAbierto` (grep a cero fuera de `docs/agents/`); `case "tile"`: `mundoVacio` → overlay, `del-viaje` → overlay «No se pudo llegar», resto → `log`. Guion 177 C: tras un `ready` ajeno el fallo del destino sale en el muro con su motivo. **Prueba más fuerte, en la corrida negativa**: con `muro.ocultar()` incondicional (el muro YA quitado por el prefetch) el aserto «C · el muro dice «No se pudo llegar»» siguió en verde — el overlay no depende de que quede muro puesto. Unitario «un tile sin viaje con mundo pintado va a la línea, haya el muro que haya» en `status-rotulo.test.ts` |
| **5** Un viaje `sin ancla` que llega queda cerrado (`viajeAbierto()` → `null`) | ⚠️ no probado en navegador / ✅ en unitario | `ledger.cerrado()` = `llegado !== null || error !== null` y `esperasQueTermina` da `"llegada"` sin mirar `spawn`; `test/viaje.test.ts` «llegado sin ancla» y `bridge-map` «lugar realizado sin ancla» (34/34). En el mundo continuo `sin ancla` es inalcanzable desde el juego: `resolvePlaceTarget` devuelve punto para cualquier `anchor` o `realized_scene_id` que sea tile, y todas las escenas son tiles. La sonda del banco (`sondaDeViaje`) exige tile nuevo, así que tampoco lo daría por llegado — está dicho en su docblock |
| **6** Negativos en rojo (bridge, core, guion) | ✅ cumple | Los tres repetidos por mí, cada uno restaurado byte a byte (`cmp`): (a) bridge rama `already` sin marca → `bridge-map` 1 ✖; (b) core «todo ready de tile es llegada» → `status-reparto.test` **4 ✖ de 27**; (c) `muro.ocultar()` incondicional en `main.ts:922` → `node qa/run.mjs 177 178` **0 en verde · 2 en rojo**: 177 ✘ A, ✘ B, ✘ C («visible=false»), 178 ✘ B y el `page.click` de «Cerrar» que ya no existe |
| **7** Guion de QA en `e2e-sin-creditos`, sobre la maquinaria del 173: (A) ready instantáneo, (B) prefetch en vuelo, muro y ledger intactos, luego llega; variante: destino falla tras un ready ajeno → «No se pudo llegar» en el muro | ✅ cumple | `qa/guiones/177-un-ready-ajeno-no-quita-el-muro-del-viaje.mjs`, 1 en verde de 1 en ~40 s; censo `gasto: /generate_scene×22 · puertas: —` (motor falso, 0 €). Se pone rojo sin la condición (fila 6) |
| **8** Fuera de alcance #736 | ✅ cumple | Nada de «rechazado» en el diff; `esperasQueTermina` sigue devolviendo `null` para un `protocolo` |
| Mínimo: lógica en core, el cliente solo pinta | ✅ cumple | Las tres decisiones (`deQuienEs`, `esperasQueTermina`, `elReadyQuitaElMuro`) en `src/protocol/status-reparto.ts`; el cliente aporta dos hechos (`viajeAbierto`, `muro.enPantalla()`) y obedece. `enPantalla()` es una variable escrita por las tres puertas del muro (`mostrar`/`pintarMuro`/`ocultar`), no el `classList` |
| Mínimo: cero créditos | ✅ cumple | Todas las corridas con el guardarraíl `cliente y bridge declaran fake:true`; `gasto sesión 0,00 €` en cada captura |
| Regresión de los consumidores del ledger y del muro | ✅ cumple | `node qa/run.mjs 168 173 09- 140- 137 170` → **7 en verde de 7** (09, 109, 137, 140, 168, 170, 173) |
| `npm run verify` (nefan-core), `tsc` del cliente, lint del banco | ✅ cumple | `tsc --noEmit -p nefan-html` limpio; `npm run lint:qa` limpio con el 178 dentro; `npm run verify`: ver «Verificación» abajo |

## Hallazgos

Ninguno bloqueante ni importante.

**Menores**

1. **Prosa vieja en `nefan-core/test/status-rotulo.test.ts:72-73`**: «Es lo que compone
   `runTileGeneration` cuando `opts.destino` existe». Ese campo se retiró en esta tanda
   (`opts.viaje.destino`). El barrido del ingeniero lo declaró a cero y no lo es: es
   exactamente el rastro que confunde al siguiente agente (`feedback_rastros_confunden`).
   Reproducir: `grep -rn "opts.destino" nefan-core/`.
2. **El guion 177 no tiene fila en la tabla de `qa/README.md`.** Lo anoto por completitud,
   no como fallo de la tanda: unos 50 guiones no la tienen y el propio README lo reconoce
   en una nota. He añadido la del 178.

**Observaciones fuera del alcance (para el backlog, no para esta tanda)**

- **Ambigüedad (a) del plan** (un `spawn` de un `ready` que NO es la llegada del viaje abierto
  sigue moviendo al jugador): lo dejó el ingeniero como estaba. Comprobado que **no es un
  camino del jugador**: el «Viajando...» tapa el panel «Salidas» (`SalidaTapada`), así que
  no se puede pedir un segundo viaje mientras el primero espera. Solo lo fabrica el cable.
  Va con #736.
- **Ledger de viaje que sobrevive a un cambio de sesión** (punto dudoso del ingeniero):
  verificado que no hay camino sin recargar la página. «Volver al título» solo sale con
  `mundoVacio` (`status-rotulo.ts:194`), la oferta de `la-partida-llego-tarde.ts` es
  «Reintentar» de un arranque, y con viaje abierto el mundo está pintado. Candidato a issue
  si algún día el título se abre desde la partida; hoy no.
- `status-rotulo` a 119 mutantes de 120: real, y no es de esta QA; la siguiente rama que se
  le añada lo saca del `local`.

## Crítica visual (capturas en `qa/capturas/2026-09-24T14-35-17-444Z-566381/` y `…T14-39-04-913Z-569625/`)

- **«Viajando...» (177-01, 177-02)**: velo cálido sobre la escena clay, anillo, título en el
  acento del estilo, detalle «Viajando a Molino del bench...» y contador. En la 02 el contador
  marca **8s** tras el prefetch: la prueba visual de que el muro es el mismo y no uno nuevo. El
  HUD (vida, enemigo, «Salidas») se lee atenuado debajo; nada tapa el texto. Correcto.
- **«No se pudo llegar» (177-04, 178-02)**: título en `--nf-danger`, motivo en dos líneas
  legible, un solo botón «Cerrar», sin anillo ni «0s» huérfano (H-5 de la QA del 01-09 sigue
  en pie). El panel «Salidas» sigue ofreciendo el mismo destino debajo, que es lo que el
  jugador va a pulsar tras «Cerrar» (178-03/04 lo confirman: reintento y llegada).
- **Arranque**: el muro «Iniciando partida...» dura 255 ms con el snapshot, así que no hay
  captura suya de esta corrida; su pintado está afirmado por el observador (fila 3c). Es el
  mismo componente y CSS que el «Viajando...», solo cambia el texto, pero lo declaro como lo
  que es: no visto en imagen.
- **Llegada (177-03, 178-04)**: `tile_2_0` con cielo, HUD a opacidad plena, «Salidas» con el
  destino siguiente. Sin restos del muro.
- Nada que objetar de integración ni escala en lo que la tanda toca.

## Workarounds usados

- **`MutationObserver` en el guion 178 para el muro del arranque.** El retardo del motor
  falso no aplica al tile de arranque (`fake-ai-server.ts:319`, `!gt?.bootstrap`), así que
  el muro no se puede sujetar abierto sin sintetizar estado. El observador solo MIRA la
  secuencia real (no fuerza nada); el jugador ve el mismo muro durante el mismo tiempo. No
  afecta al usuario.
- **Los tres negativos** modifican código de producción (`main.ts`, `status-reparto.ts`,
  `tile.ts`) y se restauran byte a byte desde copia; `cmp` verificado en cada uno y
  `git status` sin restos.
- El bloque B del 178 fuerza el fallo del motor con `POST /dev/tiles mode:"error"`, que es la
  maquinaria del banco (#516), no un estado del cliente.

## No probado

- **`sin ancla` en navegador** (fila 5): inalcanzable en el mundo continuo; cubierto por
  unitarios de core y de bridge.
- **Gasto real de créditos**: nada de esta tanda gasta; no se tocó ningún preset con Imagen IA.
- **El orden `viajeAbierto` antes de cerrar el ledger** solo lo sujeta el guion 177 (negativo
  5 del ingeniero, que no repetí: mi negativo (c) cubre la condición, no el orden). El
  cliente no tiene harness (#241).

## Verificación ejecutada

| Comando | Resultado |
|---|---|
| `npx tsx --test test/status-reparto… status-rotulo… bridge-map… viaje… bridge-session… bridge-tile…` | 198/198 |
| `npx tsx --test test/un-numero-un-guion.test.ts test/banco-ficheros.ts` | 5/5 (el 178 entra) |
| `npx tsx --test test/un-salto-del-guion-se-observa.test.ts test/candados-headless-totalidad.test.ts` | 60/60 |
| `npx tsc --noEmit -p nefan-html` | limpio |
| `npm run lint:qa` | limpio |
| `node qa/run.mjs 177` | 1/1, ~40 s |
| `node qa/run.mjs 178` | 1/1 (dos corridas: con y sin el reloj de pared) |
| `node qa/run.mjs 177 178` con `muro.ocultar()` incondicional | 0/2 (rojo esperado) |
| `node qa/run.mjs 168 173 09- 140- 137 170` | 7/7 |
| `npm run verify` (nefan-core) | **3447/3447, EXIT 0** (segunda corrida). La PRIMERA salió en rojo por MI guion, no por el diff: `el-reloj-de-pared-tiene-padron.test.ts` (#711) cazó un `performance.now()` en el observador del 178 sin declarar en `relojes-de-pared.json`. Como solo servía para ordenar, se quitó (el orden lo da el array) y el 178 volvió a correr en verde (`2026-09-24T14-45-42`) |

## Veredicto

**Apto.** Los ocho criterios se cumplen en el flujo real del jugador; los negativos se ponen
rojos por mi mano; el único hueco (el `sin ancla` en navegador) no lo puede producir el juego.
Un rastro de prosa que el ingeniero debería barrer (hallazgo menor 1).

Guion entregado: `qa/guiones/178-el-muro-de-fallo-sobrevive-a-un-ready-ajeno-y-el-arranque-se-quita-solo.mjs`
(+ su fila en `qa/README.md`).
