# El arranque del cliente: lo que se ve y lo que cuesta (#181 + #189 + #180)

> **Alcance recortado por el crítico (2026-08-23): #224 SALE de esta tanda.** No puede cerrar la
> ventana del botón muerto ni en el límite — la acota el timeout de request de 30 s
> (`nefan-html/src/net/bridge-client.ts:190`), no el coste de `list()`: con 0 saves `list()` cuesta
> 2 ms y el botón sigue muerto durante el `await`. Va como tanda propia, en su turno numérico.

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

## Por qué los cuatro van al mismo crítico

Son los primeros segundos de partida vistos desde cuatro sitios: el botón que no responde
(#181), lo que ese botón está esperando (#224), la pantalla a la que no se puede volver cuando
algo falla (#189) y lo que se lee cuando falla (#180). Dos comparten fichero
(`nefan-html/src/ui/title-screen.ts`, `nefan-html/src/main.ts`) y por eso no pueden ir en PRs
paralelas.

**Decisión que te toca**: si los cuatro son una tanda o si #224 se separa. Comparten síntoma —
la espera del título — pero no capa: #224 es almacenamiento en `nefan-core`, los otros tres son
cliente. Y si #181 se arregla, la ventana muerta desaparece **aunque #224 siga costando 200 ms**;
si #224 se arregla, la ventana se acorta pero sigue existiendo. Di qué relación real hay entre
ellos y si arreglar uno vacía al otro.

## Los issues

Cuerpos íntegros con `gh api repos/alberto-hortelano/ne-fan/issues/N`, N ∈ {180, 181, 189, 224}.

- **#181** — `renderHome` pinta `#ts-new` y **cuelga su handler después de `await
  listSessions()`**: ~150 ms medidos con el botón pintado y muerto. El issue afirma que
  `renderWorldSelect` no depende de la lista de saves, así que nada impide mover el enganche.
  Verifícalo. Verifica también qué pasa cuando ese `await` **falla** en vez de tardar.
- **#224** — `FsSessionStorage.list()` parsea el `state.json` entero (~300 KB) de cada save para
  sacar cinco campos: 197 ms con 202 saves, lineal, sin poda. El issue trae medidas (9 ms con 8
  saves, 2 ms con 0) y descarta explícitamente que bloquee el event loop. Propone tres salidas
  (índice aparte, leer solo el prefijo, podar saves viejos) sin elegir.
- **#189** — `finally { titleScreen.hide() }` en `nefan-html/src/main.ts`: cualquier fallo de
  sesión deja al jugador en una pantalla sin nada que pulsar, y la única salida es recargar. Lee
  la **actualización del 2026-08-22**: el caso que lo detectó (un save con vista de proscenio) ya
  no puede darse, pero el bug no era de las vistas. Reproducible hoy arrancando el cliente sin
  bridge y pulsando «Nueva partida».
- **#180** — el overlay se titula «Error al generar el mundo» cuando lo que pasaba era un viaje,
  y suelta el `HTTP 500` con el JSON crudo. El fail-loud es correcto y no se toca; lo que falta
  es que el mensaje esté escrito para quien juega. Comprueba si el error **ya trae**
  `tile{tx,ty}` y `elapsedMs` estructurados: si es así, se puede decir «no se pudo llegar a X»
  sin inventar nada.

## Criterios de aceptación — REENCUADRADOS por el crítico (2026-08-23)

Veredicto: **VIGENTE (#181) · REENCUADRADA (#189, #180)**. Ver `critica.md`.

### #181 — crece: hay un tercer bug en las mismas tres líneas

- Los ~150 ms son **el caso feliz**. El techo real de la ventana muerta es el **timeout de request:
  30 s** (`nefan-html/src/net/bridge-client.ts:190,199`), vigente siempre que el socket esté arriba
  y la respuesta tarde.
- Mover el enganche antes del `await` de `title-screen.ts:303` es **seguro**: `renderWorldSelect`
  (`:398`) no lee `sessions` en ninguna de sus ~290 líneas, y tras el `await` `renderHome` solo
  escribe en nodos ya capturados. No hace falta máquina de estados.
- **Además**: el click de `:342-344` (`void this.renderWorldSelect()`) **se traga el fallo entero** —
  sin `catch`, sin `errors.push`, y el cliente no tiene handler de `unhandledrejection`. Sin bridge,
  pulsar «Nueva partida» es un **no-op mudo**, contra el fail-loud de `CLAUDE.md`. Ese silencio es
  además lo que impide reproducir #189.
- **El botón no debe desplazarse bajo el cursor** al llegar la lista de saves: `sessionsEl` se
  repinta en `:315` y empuja `#ts-new` hacia abajo con N saves.

### #189 — el bug es real, el repro del issue es FALSO

- `main.ts:2458-2459` oculta el título en el `finally`, y `runTitleFlow` se llama **una sola vez**
  (`:2357`): no hay vuelta al título por ningún camino. Eso sigue en pie.
- **«Arrancar sin bridge y pulsar Nueva partida» nunca llega a ese `finally`**: sin bridge no se sale
  del título, porque el click muere en el `void` de `:343`. El repro válido es un fallo de sesión con
  el **bridge ARRIBA** (`startSession`/`resumeSession` rechazando, `main.ts:2381`/`:2408`).
- **Producir ese repro es requisito de entrada**: sin él, QA no puede probar el guion en negativo y
  el candado nace en falso.
- Tras el fallo, `errors.push` registra el motivo.

### #180 — encoge a un rótulo

- **Dos tercios ya están hechos** por `cf7b446` (#226), posterior a la última edición del issue:
  `motivoParaElJugador` en los dos caminos de viaje (`bridge/handlers/tile.ts:250-254`,
  `scene.ts:186-188`). El mensaje ya dice «No se pudo llegar a {destino}» y el JSON crudo se queda
  en el `console.warn` del bridge.
- **Lo único vivo**: los rótulos de `main.ts:2130` («Error al generar el mundo») y `:2154` («Error al
  generar la escena»), títulos de motor sobre un cuerpo ya escrito para quien juega.
- El status **ya trae** `placeId`, `tile{tx,ty}` y `elapsedMs`: se rotula sin inventar nada.

## Fuera de alcance

Rediseñar la pantalla de título. Cambiar el modelo de saves multi-slot. **El índice de saves y la
poda no entran**: son #224, que el crítico separó de esta tanda.

## Veredicto del crítico

**VIGENTE (#181) · REENCUADRADA (#189, #180); #224 separado.** Ver `critica.md`.
Sin decisiones de producto pendientes.

---

## Correcciones al plan, medidas por el coordinador (2026-08-23)

Verificadas contra el código después de que el arquitecto entregara `plan.md`. Las tres son
load-bearing: sin la primera, la tanda no se puede cerrar.

### 1. Hay un CUARTO agujero en la misma ventana muerta

`show()` (`nefan-html/src/ui/title-screen.ts:263-270`) arma `this.resolve` **después** de
`await this.renderHome()`, o sea después del `await listSessions()`. Mover el
`addEventListener` antes del await hace que el click **registre**, pero el «Comenzar» del
final del selector llama a `this.resolve?.(...)` (`:1057`) y con `resolve` todavía en `null`
el optional chaining lo convierte en un **no-op mudo**.

**Por qué bloquea la tanda**: `qa/lib/sesion.mjs:39` (`esperarTituloListo`) espera hoy a que
el status diga «Bridge OK» antes de tocar nada. Si se retira ese workaround —que hay que
retirarlo, es la prueba viva de #181— sin armar `resolve` primero, los 15 guiones que pasan
por `comenzar()` pueden colgarse en un botón que no resuelve a nadie. Es además el riesgo
«título vivo-muerto» que el propio plan enumera para el bucle de #189: con el bucle, `show()`
se llama en cada vuelta.

**Arreglo**: crear la promesa y armar `this.resolve` **antes** de `renderHome`, devolverla
después. `show()` debe seguir rechazando si `renderHome` rechaza (lo espera el catch de
`main.ts:2381`).

### 2. No son cuatro `void` mudos, son once

El plan cita `:146`, `:343`, `:660`, `:671`. Medido: **11 en `title-screen.ts`** (146, 338,
343, 660, 668, 671, 674, 676, 830, 975, 1055) y **29 en todo `nefan-html/src`** (main.ts 7,
dev-status-panel 3, portrait 2, fps-atlas 2, y uno en history-browser, graphics-mode,
dev-menu, fps-renderer). `fps-gl.ts` no aporta ninguno si se excluye `void main(` del GLSL.

⇒ `paso()` sustituye los **11** del fichero, y el `max` de `html-sin-promesa-muda` se congela
en **18** (el residuo real), no en el número que saldría de arreglar cuatro. Si el ingeniero
arregla alguno de los otros 18, baja el `max` en el mismo commit — misma disciplina que
declara `html-sin-catch-silencioso` en su propio `why`.

### 3. El guion es el 18, no el 16

`qa/guiones/` ya llega a `17-la-partida-se-guarda-y-se-reanuda.mjs`. El nombre es
`18-el-titulo-responde-y-vuelve.mjs`.

### Detalle sin corrección, para que no sorprenda

El catch de `runTitleFlow` (`main.ts:2464-2468`) **relanza**, y el caller (`:2367-2375`)
vuelve a pintar el loader con el rótulo genérico «No se pudo arrancar la partida», tapando el
específico. Con el bucle eso desaparece solo para los fallos de sesión; el try/catch externo
se queda para el fallo de `show()`.

### Nota operativa para el repro de #189

El botón «Borrar» del título abre un `confirm()` (`title-screen.ts:326`), que **bloquea el
navegador y deja el harness sin respuesta**. Por eso `borrarSaveComoOtroCliente(id)` va por WS
(`delete_session`, `bridge/router.ts:76`) y no por la UI.
