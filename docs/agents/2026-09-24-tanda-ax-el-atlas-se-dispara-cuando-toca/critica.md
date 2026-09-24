**Veredicto por issue — #730 OBSOLETA (sin sujeto alcanzable) · #729 REENCUADRADA (la puerta que nombra está casi cerrada; la viva es la inversa) · #754 VIGENTE (arreglo de guion; la «pregunta de fondo» tiene respuesta: no hace falta nada en producción).**

Verificado sobre `f25da654` (incluye #757). Rutas relativas a la raíz del worktree.

## #730 — el estilo que llega después de la escena

**Problema real, en una frase:** si una escena se instalara antes que el estilo de su sesión, su tile se quedaría en clay para siempre, porque las dos ramas «sin estilo» son callejones que nadie reabre.

| Afirmación | Verificación |
|---|---|
| Nadie re-dispara el atlas del activo si falta el estilo | **Cierto en el código**: `fps-atlas.ts:168-171` loguea «en espera del estilo» y vuelve; `setStyle` (`:92-94`) solo asigna. Nadie espera |
| Lo mismo en el carril de vecinos | **Cierto**: `fps-atlas.ts:231-234` devuelve `"nada"` y no re-encola |
| «Falta comprobarlo en partida nueva» | **Comprobado: inalcanzable.** El bridge suscribe y manda `session_started` (`bridge/handlers/session.ts:492-506`) ANTES de difundir ninguna escena (snapshot `:531` → `broadcastScene` `:567`; bootstrap vivo, más tarde aún). El cliente resuelve el `pending` síncrono en `dispatch` (`net/bridge-client.ts:197-203`); `startSession` tiene UN `await` (`net/narrative-client.ts:286`) y `main.ts:1207` hace `session.enter` en su continuación, un microtask, antes del siguiente mensaje WS. `session.enter` aplica las facetas síncronas (`session-facets.ts:288-290`) → `applySessionStyle` (`main.ts:222-223`). Resume: `enter` (`main.ts:1221`) precede al bucle de `addTile` (`:1254`) |
| Vecinos sin estilo | Mismo orden: `restaurar` solo sale de `addTile` (`carga-de-tile.ts:375`). La QA de la tanda AI (H4) ya no pudo reproducirlo |

El único sitio donde la rama «sin estilo» se alcanza hoy es la fixture del selector «Room» sin partida, donde **no hay estilo que esperar** y lo correcto es clay (y `runFor` lo dice fail-loud, `:265-271`).

**Día después si se hiciera como está escrito:** maquinaria de re-disparo (suscribirse al estilo, re-encolar tiles) para un estado que el protocolo no produce, y que habría que mantener y mutar. No cambia nada para quien juega.

**Qué NO debe hacerse:** construir el re-disparo. Lo que sí es real y barato: el orden `session_started` → escena es un invariante del bridge que **no tiene candado**; y el comentario `fps-atlas.ts:161-167` («no está verificado», «anotado como issue») y el rótulo «en espera del estilo» prometen una espera que no existe — rastro que confunde al siguiente agente.

## #729 — el menú dev sobre un tile no activo

**Problema real:** la corrida manual (menú / G) y la del activo comparten UN token (`politica-de-atlas.ts:112-122`), así que cuando van a tiles distintos la segunda desecha a la primera.

| Afirmación | Verificación |
|---|---|
| `generar` → `runFor(key)` → `nuevoRun` | **Cierto** (`fps-atlas.ts:122`, `:273`) |
| Supera la corrida del activo EN VUELO | **Casi cerrado ya**: cada item lleva `inFlight: this.running` (`fps-atlas.ts:121`, desde #706, antes del issue) y el menú deshabilita el botón («Generando…», `dev-menu.ts:94-97`). Queda la ventana del repintado cada `POLL_MS = 1000` (`dev-menu.ts:23`) |
| — (no lo dice el issue) La INVERSA | **Viva y mayor**: `enVuelo` solo sube en `nuevoRun`, no durante la fase memoria/mapping del activo (`fps-atlas.ts:153-173`). (a) Generar el vecino X en esa fase, o (b) cruzar a otro tile mientras X pinta, hace que el `runFor` del activo supere al manual: X paga, registra keep-list (`:338`) y **no aplica ni cachea** (`:339`, `:365` antes de `:370-382`). El menú dice «Generar y aplicar» y el tile sigue en clay |

**Por qué vale más hoy que cuando se abrió:** con #757, en `desarrollo` lo automático nunca pinta; **el menú dev y la G son las únicas puertas que pagan** arte nuevo. Que la puerta de pago tire lo pagado es ahora el camino principal de desarrollo, no un rincón.

**Qué NO debe hacerse:** arreglarlo en el menú (deshabilitar más, o esperar); la vigencia es de `PoliticaDeAtlas` y el menú solo pinta. Tampoco confundirlo con #756 (skins del menú dev): otro pipeline.

## #754 — guion 106 intermitente

**Problema real:** el caso 3 del 106 supone un navegador sin mapping, pero hereda el del caso 2 cuando la corrida de éste termina antes del reload.

| Afirmación | Verificación |
|---|---|
| El caso anterior guarda el atlas en `fps_atlas:*` | **Cierto** (`mapping-del-atlas.ts:15`, `:27`) |
| «De forma asíncrona» | **Matiz**: `guardarMapping` es UN `setItem` síncrono; lo asíncrono es el POST y las descargas que lo preceden (`fps-atlas.ts:313-381`). El guion avanza en cuanto se abre la puerta (`106:88-107`), no cuando la corrida acaba |
| El caso 3 restaura sin POST | **Coherente**: con mapping, `onActiveTile` vuelve en `:172` sin llegar a `runFor`. Y es el comportamiento CORRECTO del juego (lo pagado se reutiliza a $0): el fallo es de aislamiento del guion |
| No es #730 | **Cierto**: el estilo está puesto (ver arriba) |
| Arreglo: borrar `fps_atlas:*` DESPUÉS de `recargarAlTitulo` en `partidaCon` | **Correcto**: la lectura solo ocurre tras `comenzar`; antes del reload la página vieja aún puede escribir. Cada guion tiene contexto nuevo (`qa/run.mjs:1516`, `newPage`), así que la fuga es solo intra-guion |
| El 106 sigue midiendo tras #757 | **Sí**: no declara entorno → `produccion` (`qa/lib/entornos.mjs:30`) |
| «¿Un reload a mitad podría dejar un mapping a medias?» | **No.** Solo se guarda el atlas COMPLETO (`fps-atlas.ts:373-382`) en una escritura atómica. Un reload a mitad pierde, como mucho, la aplicación: la keep-list va antes (`:338`) y lo pintado vuelve de la librería a $0 en la visita siguiente. No hay nada que esperar ni cancelar |

## Conflictos

- #729 y #730 viven en `fps-atlas.ts` + `politica-de-atlas.ts`: una sola PR, sin orden entre ellas. #754 es solo guion y no depende de las otras dos.
- Candado vigente: `arch-rules.json` (lógica en core). La vigencia de #729 se decide en `PoliticaDeAtlas`, no en el cliente.
- Nada en `git log` desde #757 toca estas líneas.

## Coste contra valor

- #730: el re-disparo cuesta más que nada y no arregla nada alcanzable. Cerrar con esta evidencia; como mucho, el candado del orden y fuera el comentario falso.
- #729: coste pequeño en core; valor real porque es la puerta de pago de desarrollo. Sin hacerlo: arte pagado que no aparece, y un dev que lo paga dos veces (la segunda a $0 pero sin saberlo).
- #754: tres líneas de guion. Sin hacerlo: un rojo intermitente que enseña a ignorar el 106.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

> **#730 — se cierra, no se construye re-disparo.** El orden `session_started` → escena lo garantiza el bridge (`handlers/session.ts:492-567`) y el cliente aplica el estilo en el microtask de la respuesta, antes de cualquier escena; resume igual. Entregable: (a) un test que se ponga ROJO si el bridge difunde una escena de la sesión antes de su `session_started` (probado en negativo), y (b) fuera el comentario «no está verificado» de `fps-atlas.ts:161-167` y el rótulo «en espera del estilo», que promete una espera que nadie cumple. Texto para el issue: «Inalcanzable: el bridge manda session_started antes de difundir escena y el cliente fija el estilo en esa continuación; candado del orden en la PR X.»
>
> **#729 — reencuadrado:** una corrida de un tile no puede dejar sin aplicar la de OTRO tile. Criterios, con test en core rojo antes del arreglo: (1) una generación manual de X en vuelo cuando se activa Y → al terminar, X tiene su arte aplicado y Y el suyo; (2) una manual de X lanzada durante la fase memoria/mapping del activo Y → ídem; (3) la MISMA clave sigue sin pagarse dos veces (regla de 2026-08-14 intacta); (4) el tile activo nuevo sigue superando al activo viejo (#390 intacta). Guion de QA 182 en `produccion`, motor falso: menú dev sobre un vecino + cruce de tile, y se afirman los dos tiles con textura. La decisión vive en `PoliticaDeAtlas`; el menú no cambia.
>
> **#754 — vigente, solo guion:** en `partidaCon` del 106, borrar `fps_atlas:*` DESPUÉS de `recargarAlTitulo`, con un comentario que diga por qué después. Criterio: 12 de 12 en verde en dos tandas, y el caso 3 sigue abriendo la puerta del atlas (el aserto positivo no se relaja). La pregunta de fondo se contesta en el issue: no hay mapping a medias posible (escritura única del atlas completo) y un reload no pierde arte pagado; no se toca producción.
