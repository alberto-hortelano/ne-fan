# QA — tanda AW: los rojos del banco se nombran (#751 #746)

Worktree `/home/al/code/ne-fan-tanda-aw`, rama `feature/tanda-aw`, Node v26.10.0. Cero créditos: lo único que arrancó fue `e2e-sin-creditos` desde `qa/run.mjs` (motor falso, `fake:true`). Ningún proceso ajeno tocado. Todo sabotaje se hizo por copia y se restauró: `git status` al final es exactamente el diff del ingeniero (4 ficheros + fixture nueva + esta carpeta).

## Criterios (de critica.md) → evidencia

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | El caso «world-state caído» deja de depender de que un puerto soltado siga libre; forzar la colisión del 404 no puede poner rojo el test, o ya no se puede escribir | ✅ cumple | Colisión forzada (`srv2` con `port: muerto.port`): `not ok 4 - world-state caído…` con `error: 'listen EADDRINUSE: address already in use 127.0.0.1:38961'`, `# fail 1`, EXIT 1. El kernel rechaza la colisión; ya no hay «HTTP 404». Y el test SÍ se pone rojo si el prune deja de decir «inalcanzable» (sed en `prune.ts:59` → «caído»): `npm run ejercicio -- asset-store-contrato` sale con `✖ prune LRU con keep-list › fetchKeepList distingue las causas › world-state caído → …` y `error: '{"ok":false,"error":"world-state caído en http://127.0.0.1:34503 (fetch failed)"}'`, stack `asset-store.test.ts:792:16`. Estabilidad: 12 corridas de la batería a concurrencia 6 → `12 × # fail 0`, 0 rastros de «HTTP 404» |
| 2 | Cuando una batería no pasa, `ejercicio` imprime cada `not ok` con su bloque de error, esté donde esté | ✅ cumple | Los dos negativos del criterio están en `test/ejercicio-de-bateria.test.ts` con fixtures REALES (`falla-al-principio.ts`, `describe-que-lanza.ts`) y un tercer test que canda que la primera deja el `not ok` fuera de `slice(-2000)`. Verde: 128/128 en la batería afectada. De punta a punta, ver fila 1: el informe real nombra el test del décimo nivel superior, que es justo el que #751 no veía. Pasada adversarial con 9 fixtures propias (abajo): hooks, anidado real, rechazo suelto, timeout — todos nombrados |
| 3 | `ejercicio` decide por el EXIT, no por `# fail`; `node_args` intactos | ✅ cumple | `correrBateria` decide por `err === null` (`ejercicio-de-bateria.ts`, `execFile` callback). Dos direcciones medidas: `describe-que-lanza.ts` (`# fail 0`, EXIT 1) → `ok:false`; fixture con `{todo:true}` que falla (`not ok` con `# TODO`, EXIT 0) → `ok:true`. `git diff` no toca `mutation-targets.json`; `ejercicioDeModulo` sigue pasando `plan.node_args` |
| 4 | Guion 89 bloque 4: exige un frame DESPUÉS de quitar la reescritura; sin frame, el ✘ cae en la espera y la nombra | ✅ cumple | Verde real: `node qa/run.mjs 89-el-arma` → `✔ ocurre: llega un state_update DESPUÉS de quitar la reescritura`, `1 en verde · 0 en rojo de 1`, gasto `/generate_scene×1 · /generate_surface_atlas×1` (falso). Negativo (espía saboteado: deja de contar `vistos` al soltar la reescritura): `✘ ocurre: llega un state_update DESPUÉS de quitar la reescritura — no ocurrió en 10000 ms · 66 sondeo(s), 0 con la sonda rota · último valor null`, ÚNICO ✘ del guion, `0 en verde · 1 en rojo de 1`, EXIT 1. Los aros no aparecen en rojo |
| 5 | Se anota en #725 la medida sobre `ejercicio` (decide por el EXIT) sin abrir el resto | ⚠️ no probado (pendiente del coordinador) | `gh issue view 725 --comments` no contiene aún «tanda AW» ni «decide por el EXIT». El texto listo está en `implementacion.md` § «Comentario para #725». Lo publica el coordinador; la medida que cita la he reproducido (fila 3) |
| 6 | Cero créditos; no hace falta guion nuevo; el 89 corregido pasa contra `e2e-sin-creditos` | ✅ cumple | Fila 4. El censo de gasto del runner lo atribuye al motor falso. No hay guion nuevo: lo mecánico de #751 vive en `test/ejercicio-de-bateria.test.ts` (corre en `npm test`, que sí está en CI), y lo de #746 ES el guion 89 |

Gate completo: `npm run verify` en `nefan-core` → EXIT 0, `ℹ tests 3429 · pass 3429 · fail 0`, eslint + `lint:qa` incluidos. `npm run ejercicio` → `100 fichero(s) mutado(s) en 66 batería(s)… Todas las baterías EJERCEN lo que su módulo muta`, EXIT 0.

## Respuestas a las preguntas del coordinador

1. **¿El test nuevo puede ponerse rojo si el prune dejara de tratar la caída como «inalcanzable»?** Sí, y lo probé en vez de leerlo: con `prune.ts:59` diciendo «caído» en vez de «inalcanzable», el aserto de `fetchKeepList` (`asset-store.test.ts:792`) cae con el `Result` entero en el mensaje. Y el informe de `ejercicio` lo nombra con ruta completa (fila 1).
2. **¿`testsCaidosDelTap` nombra un fallo en TAP anidado, en una suite que lanza y en un fallo dentro de un hook?** Los tres, medidos con TAP de Node 26 real, no sintético:
   - anidado (3 `describe` + hoja): `✖ nivel uno › nivel dos › nivel tres › la hoja cae` con `error: |- mensaje de la hoja / 'a' !== 'b'`; y la hermana del nivel dos con su propia ruta.
   - suite que lanza: `describe-que-lanza.ts` → `✖ un describe cuyo cuerpo lanza` + `Expected property name` (test del ingeniero, verde).
   - hooks: `before` roto → `✖ suite con before roto` con `failureType: 'hookFailed'`, `error: 'el before revienta'`; `beforeEach` roto → cada hija con `hookFailed` y el mensaje; `after` roto → la suite con `hookFailed`; `before` de fichero (sin describe) → `✖ suelta` con `hookFailed`. Además: rechazo sin dueño (`unhandledRejection`, nombrado) y timeout (`testTimeoutFailure`, nombrado).
3. **¿El `return` del guion 89 está observado?** Sí, y el candado lo VE: el test `un-salto-del-guion-se-observa` está verde con el guion tal cual, y al sustituir `expectEspera` por un `page.evaluate` que devuelve `{ocurrio}` sin afirmar, se pone rojo nombrando el sitio: `qa/guiones/89-…mjs:364 [return] !frameNuevo.ocurrio — frameNuevo no se afirma antes ni lo inicializa algo que afirme`. Restaurado.
4. **¿La decisión sigue siendo por EXIT?** Sí (fila 3), en las dos direcciones.

## Hallazgos

Ninguno bloqueante ni importante.

- **Menor · ruido delante de la causa en un `before` roto.** Con un `before` de suite que lanza, el informe lista PRIMERO a la hija con `failureType: 'cancelledByParent'` («test did not finish before its parent and was cancelled») y DESPUÉS a la suite con la causa real (`hookFailed`, «el before revienta»). El lector que lea solo la primera entrada verá el síntoma y no la causa. Reproducir: fixture con `describe(){ before(()=>{throw}); it(...) }` por `correrBateria`. Esperaba que la causa fuera lo primero o que el `cancelledByParent` se omitiera como se omite `subtestsFailed`. No lo pide ningún criterio; es afinado de #751.
- **Menor · `process.exit(1)` dentro de un test deja el informe sin nada que enseñar.** El TAP llega vacío (ni `TAP version 13`), así que sale «no trae NINGÚN `not ok`… Cola del TAP:» seguido de nada, y «stderr vacío». Es la degradación DECLARADA del diseño y se dice en vez de callar, pero la cola vacía no ayuda. No hay caso así hoy en el repo.
- **Menor · cosmético.** Un nombre de test con `#` sale con el escape de Node (`hermana … cae \# con almohadilla`). El nombre se conserva entero (no se confunde con una directiva), solo lleva la barra.
- **Observación, no de esta tanda.** El `location:` del bloque YAML apunta a la posición transpilada por tsx (`asset-store.test.ts:1:24537`); la línea útil es la del `stack` (`:792:16`), que el informe también imprime.

## Workarounds usados

Ninguno sobre el flujo del usuario. Los sabotajes (prune.ts, puerto forzado, espía del 89, `return` sin afirmar) son negativos de método, hechos por copia y restaurados; ninguno era necesario para observar la feature.

## No probado

- La carrera natural del puerto en CI (el crítico tampoco la reprodujo en 836 corridas). Lo verificado es que la colisión es irrealizable por construcción (EADDRINUSE) y que la batería aguanta 12 corridas concurrentes sin rastro del 404.
- El comentario en #725 (criterio 5): aún no publicado; es acto del coordinador.
- El guion 89 en CI: no corre allí (batería de navegador). Verde y negativo, ambos en local.

## Veredicto

**Apto.** Los seis criterios se cumplen (el 5 queda en manos del coordinador, con el texto listo y la medida reproducida). Cada criterio tiene su negativo visto en rojo y en el sitio correcto. Los tres hallazgos son menores y no bloquean.
