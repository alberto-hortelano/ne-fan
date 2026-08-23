# VIGENTE (#181) · REENCUADRADA (#189, #180, #224) — y #224 SE SEPARA de la tanda

Tanda = **#181 + #189 + #180**, los tres en cliente y dos en las mismas 10 líneas de `title-screen.ts`. **#224 sale**: no puede vaciar a #181 ni en teoría (§Conflictos).

## El problema real, en una frase

Los primeros segundos del cliente **no tienen vuelta atrás ni acuse de recibo**: lo que pulsas puede no registrarse, lo que falla te deja sin pantalla y lo que se lee está rotulado por el motor. #224 no pertenece a esa frase: es que `saves/` no tiene techo.

## La premisa, afirmación por afirmación

**#181 · «el handler se cuelga tras el `await`»** — CIERTO: `newBtn` se pinta en `title-screen.ts:293`, se captura en `:298`, `await listSessions()` en `:303`, `addEventListener` en `:342`.

**«renderWorldSelect no depende de la lista de saves»** — CIERTO: `:398` solo toma `preselectGameId` y `await listGames()` (`:401`); no lee `sessions` en ninguna de sus ~290 líneas. Y mover el enganche es seguro: tras el `await`, `renderHome` solo escribe en `statusEl`/`sessionsEl`, ya capturados — si `renderWorldSelect` reemplazó `content.innerHTML`, esas escrituras caen en nodos desconectados. No hace falta máquina de estados.

**«~150 ms»** — la tarea es **MAYOR**: 150 ms es el caso feliz; el techo real de la ventana muerta es el **timeout de request, 30 s** (`bridge-client.ts:190,199`), vigente siempre que el socket esté arriba y la respuesta tarde. Solo el socket ya caído rechaza al instante (`:192`).

**Qué pasa si el `await` FALLA** (pedido en requisitos) — el `catch` de `:307` sigue adelante y el botón acaba enganchado en `:342`: un fallo no lo deja muerto para siempre. Pero descubre un **tercer bug en esas mismas 3 líneas**: `newBtn.addEventListener("click", () => { void this.renderWorldSelect(); })` (`:342-344`) **se traga el fallo entero** — sin bridge `listGames()` rechaza, no hay `catch`, no hay `errors.push`, no hay handler de `unhandledrejection` en el cliente, y pulsar «Nueva partida» es un no-op mudo. Contradice el fail-loud de `CLAUDE.md`.

**#189 · «`hide()` en el `finally`»** — CIERTO, `main.ts:2458-2459`, y `runTitleFlow` se llama **una sola vez** (`:2357`): no hay vuelta al título por ningún camino.

**«Reproducible sin bridge pulsando Nueva partida»** — **FALSO**: sin bridge nunca se sale del título (`show()` no resuelve porque el click muere en el `void` de `:343`), así que el `finally` no llega a ejecutarse. **El bug es real; el repro, no.** El camino que sí lo alcanza es un fallo con el **bridge ARRIBA**: `startSession`/`resumeSession` rechazando (`main.ts:2381`/`:2408`).

**#180 · «suelta el HTTP 500 y el JSON crudo»** — **YA NO**: `cf7b446` (#226), posterior a la última edición del issue, metió `motivoParaElJugador` en los dos caminos de viaje (`tile.ts:250-254`, `scene.ts:186-188`); el volcado se queda en `console.warn`. **«no dice a dónde se viajaba»** — **YA NO**: `No se pudo llegar a ${opts.destino}` / `No se pudo viajar a ${place.name}` (`tile.ts:178` declara `destino` con ese fin exacto).

**«se titula "Error al generar el mundo"»** — **CIERTO Y ES LO ÚNICO QUE QUEDA**: `main.ts:2130` (`kind:"tile"`) y `:2154` («Error al generar la escena», `kind:"scene"`), rótulos de motor sobre un cuerpo ya escrito para el jugador. **¿Trae `tile{tx,ty}` y `elapsedMs`?** (pedido en requisitos) SÍ, ambos (`tile.ts:186-193`), y `placeId` en el camino de escena (`scene.ts:184`). **«y qué puede hacer»**: ya cubierto — el motivo dice «inténtalo de nuevo» y el overlay tiene «Cerrar» (`index.html:133` → `main.ts:2074`). #180 se ha reducido a **un rótulo**.

**#224 · «list() parsea el state.json entero»** — CIERTO, `session-storage.ts:140` dentro del bucle de `:137`. **«para sacar cinco campos»** — son ocho, y dos son la trampa: `scene_count` sale de `Object.keys(data.scenes_loaded)` y `entity_count` de `data.entities.length` (`:148-149`), ambos en el **cuerpo pesado**. Eso **mata por medida la salida 2 del issue** («leer solo el prefijo»).

**«200 ms para quien juega»** — **no para quien juega**: los 202 saves son artefacto de bench; `saves/` está en `.gitignore:56` y **hoy tiene 0 directorios**. Con las medidas del propio issue, ~1 ms/save: 20 partidas ≈ 20 ms.

**Consumidor no citado, y es el que importa** — `GET /sessions/asset_refs` (`state-http-server.ts:292`) hace `list()` y **acto seguido `read()` de cada save**: parsea el corpus **dos veces**. Es la keep-list del prune del asset-store, o sea quién decide qué arte generado se borra.

## El día después

- **#181+#189+#180 hechos**: el título deja de tener estados sin salida y el cliente gana un canal para los fallos del propio título, que hoy no tiene. Nada se endurece; nada que borrar.
- **Riesgo verificable de #181**: con el handler movido, `sessionsEl` se repinta después (`:315`) y **empuja `#ts-new` hacia abajo** con N saves — el click registra, pero el botón se mueve bajo el cursor. Y `renderWorldSelect` **awaitea antes de pintar** (`:401`): tras el click no se ve nada hasta que vuelve `listGames`.
- **#224 con índice**: `saves/index.json` es una **segunda fuente de verdad** de metadatos frente a la decisión viva «el bridge es el ÚNICO escritor del save». Deriva garantizada a cambio de ~20 ms. **A un mes vista, eso es lo que parecerá arbitrario.** No hoy.

## Conflictos

- **#181 ⇄ #224, medido**: arreglar #181 **cierra la ventana muerta entera** (la duración de `listSessions()` deja de tener consecuencia sobre el botón) pero **no vacía #224** (la lista sigue llegando tarde; `asset_refs` sigue a doble parseo). Al revés **no funciona ni en el límite**: con 0 saves `list()` cuesta 2 ms y el botón sigue muerto durante el `await`, y el techo no es el coste de `list()` sino los **30 s del timeout**. #224 no puede arreglar #181. **Por eso se separa.**
- **#180 ⇄ #226 (`cf7b446`)**: dos tercios ya resueltos. Sin actualizar el issue, el ingeniero reescribe código escrito.
- **#189 ⇄ #181**: mismo fichero y misma causa (el `void` de `:343`). Juntos, o el repro sigue roto.
- **#225** toca `state-http-server.ts`, donde vive `asset_refs`: si #224 va por ahí, después. Y `arch-rules.json:95` prohíbe `session-storage` en el bundle del navegador — toda salida de #224 se queda en servidor. La tanda de cliente no roza ningún candado.

## Coste contra valor

#181 y #180 son de líneas (mover un `addEventListener`; elegir el rótulo desde `status`). #189 es pequeño pero exige que **alguien produzca el repro real**: sin él QA no prueba el guion en negativo y el candado nace en falso. Los tres valen su precio. **No hacer #224** cuesta hoy ~20 ms al jugador y una carpeta que crece — aceptable durante meses. Lo que no lo es indefinidamente es `saves/` sin techo y `asset_refs` a doble parseo, pero eso es otra tarea y no la del título.

## Qué le cambiarías a `requisitos.md` (para pegar tal cual)

- **Alcance**: la tanda es **#181 + #189 + #180**. **#224 queda fuera**: no puede cerrar la ventana muerta, acotada por el timeout de 30 s y no por `list()`.
- **#181 crece**: además de mover el enganche antes del `await` de `title-screen.ts:303`, el click de `:342-344` debe dejar de tragarse el fallo de `renderWorldSelect` (hoy `void` sin `catch`, sin `errors.push`, sin handler de `unhandledrejection`). Ese silencio es lo que impide reproducir #189.
- **#189 cambia de repro**: «sin bridge y pulsar Nueva partida» **no llega** a `main.ts:2459`. Debe ser un fallo de sesión con el **bridge arriba**. Escribirlo es requisito de entrada.
- **#180 encoge a un rótulo**: solo quedan los títulos de `main.ts:2130` y `:2154`; `placeId`, `tile{tx,ty}` y `elapsedMs` viajan en el status, hay con qué rotular sin inventar.
- **Criterios**: añadir «tras el fallo, `errors.push` registra el motivo» (#189) y «el botón no se desplaza bajo el cursor al llegar la lista de saves» (#181).
- **Fuera de alcance**: el índice de saves. La poda tampoco entra aquí (ver #224).

### Para pegar en #180 — y retitular «El overlay de un viaje fallido se rotula "Error al generar el mundo"»

> **Actualización 2026-08-23 — dos tercios ya están hechos.** `cf7b446` (#226) metió `motivoParaElJugador` en los dos caminos de viaje (`bridge/handlers/tile.ts:250-254` y `scene.ts:186-188`): el mensaje ya dice «No se pudo llegar a {destino}» y el `HTTP 500` con el JSON crudo se queda en el `console.warn` del bridge. Sigue vivo **el rótulo del overlay**: `main.ts:2130` titula «Error al generar el mundo» y `:2154` «Error al generar la escena», los dos por encima de un cuerpo ya escrito para quien juega. El status ya trae `placeId`, `tile{tx,ty}` y `elapsedMs`, así que el rótulo se corrige sin inventar nada.

### Para pegar en #224

> **Reencuadre 2026-08-23.** (1) Los 202 saves eran artefacto de bench: `saves/` está en `.gitignore` y hoy tiene 0 directorios; a ~1 ms/save un jugador con 20 partidas paga ~20 ms, no 200. (2) «Leer solo el prefijo del JSON» **no es posible**: `scene_count` y `entity_count` se derivan de `scenes_loaded` y `entities` (`session-storage.ts:148-149`), que están en el cuerpo pesado. (3) Esto **no puede arreglar #181**: la ventana del botón muerto la acota el timeout de request de 30 s (`bridge-client.ts:190`), no el coste de `list()`; con 0 saves (`list()` = 2 ms) el botón sigue muerto. Se desacopla de #181. (4) El consumidor que de verdad paga no es el título, es `GET /sessions/asset_refs` (`state-http-server.ts:292`), que hace `list()` y luego `read()` de cada save: **parsea el corpus dos veces**, y es la keep-list del prune del asset-store. (5) El índice aparte crea una segunda fuente de verdad frente a «el bridge es el único escritor del save». El problema real es que `saves/` no tiene techo; la latencia del título es su síntoma más leve.
