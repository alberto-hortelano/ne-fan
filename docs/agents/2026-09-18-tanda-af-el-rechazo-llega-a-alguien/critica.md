**REENCUADRADA** — el canal existe y es unicast, pero la premisa «salen VERDES» es falsa en los dos sitios vivos, el censo es de DOS y no de uno (el issue no vio el 60), y el criterio 2 manda usar un helper que no es el que estos dos sitios necesitan y que la tanda V está reescribiendo.

## El problema real, en una frase

Un rechazo de intake del bridge viaja por unicast al socket que mandó el frame, y un cliente del banco que no escuche ese socket pierde la CAUSA de lo que le pasa después: la tarea propone censar y declarar, y eso ataca el problema; lo que no lo ataca es obligar a esos sitios a esperar un tile que no esperan.

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificado |
|---|---|
| El rechazo es unicast, `ws-server.ts:287-292` | **Cierto, líneas movidas**: hoy `ws-server.ts:308-330` (`ctx.enviarNarrativo(ws, …)` en 320 → `escribir` en 91-95). Y `escribir` calla si `readyState !== OPEN`: al socket cerrado no se le manda nada ni se registra nada más que el `console.error` de 311, que `qa/run.mjs:503` solo enseña con `QA_VERBOSE` |
| Solo el intake es unicast para `request_tile` | **Cierto**: los fallos de handler van por DIFUSIÓN (`router.ts:247-262`, «Fire-and-forget: nadie espera un frame, así que el canal es la difusión de error»). Lo dijo ya la QA de #656 (`qa-656.md:17`) |
| #656 lo arregló en dos guiones con `pedirYEsperarTile` | **Cierto**: `qa/lib/sesion.mjs:645-690`; el socket queda abierto y `onmessage` recoge los `narrative_status/error` (663-667) |
| El 63 conserva su copia de `pedirTile` con `reason: "prefetch"` | **Cierto**, `63:89-105`. **Y falta uno**: el 60 tiene el MISMO patrón inline (`60:524-531`, `reason: "prefetch"`, `setTimeout(…close…, 0)`), sin nombre de función, que es exactamente la copia que el issue avisaba que un grep no ve |
| Esos clientes «salen VERDES» | **FALSO hoy en los dos**. El 63 espera el tile en el SAVE (`63:131-136`) y declara `sinMedir` (⊘, aborta) si no llega; el 60 espera «tile listo» en el HUD con `waitFor` de 60 s (`60:537-546`) → ✘ por expiración. Lo que se pierde es el NOMBRE de la causa, no el color |
| Hay rechazo que perder | **Hoy no**: `reason: "prefetch"` pasa el zod (`src/protocol/message-schema.ts:202-208`). El defecto es latente: muerde solo si el frame del banco deja de casar con el contrato, y entonces sale «el tile no llegó» en vez de «el frame se rechazó» |

## Censo preliminar por el árbol (nodos `new WebSocket(` bajo `qa/`, no por nombre): 20 sitios en 20 ficheros

- **Cierran sin esperar (2)**: `63:89` y `60:524`. Los dos prefetch, los dos observan el desenlace por otro canal (save / HUD), los dos ⊘ o ✘ bajo silencio. Candidatos naturales a «dispara y olvida declarado».
- **Esperan UNA respuesta concreta con `contestado` + `onclose` → reject (15)**: 46, 62, 67, 73, 76, 111, 113, 126 (`resume_session`), 106 (`start_session`), 85 y 87 (`set_render_mode`), 92 (`create_game`), `saves.mjs:83` (`list_sessions`), `sesion.mjs:315` (`delete_session`), `run.mjs:866` (diag, tope 10 s → `null`). NO cierran sin esperar, pero tienen OTRO agujero del mismo canal: un rechazo de intake llega como `narrative_status/error`, el `if (m.type !== …) return` lo tira, el bridge no cierra el socket, `onclose` no dispara y el `evaluate` se cuelga hasta el timeout del guion. Rojo, pero mudo. No es el defecto de #678 (verde) y hay que decidir si entra o se apunta.
- **Recogen todo y miran el error (3)**: `el-npc-cruza…:203` (`recibidos`, corta en `phase === "error"`, l.244), `el-state-api…:176` (`porElCable`, rechaza en 214-215), `sesion.mjs:654` (`pedirYEsperarTile`).
- **Fuera del censo, y hay que decirlo para que el arquitecto no los cuente**: 15 guiones que envuelven `window.WebSocket` del CLIENTE (19, 29, 35, 38, 42, 48, 86, 89, 90, 100, 108, 130, 137, 142, 149) espían el socket del juego, no abren uno; y 4 `routeWebSocket` de Playwright (70, 101, 121, 123) son proxies del socket del cliente, no clientes propios.

El molde para candar por árbol ya existe: `test/la-consulta-de-movimiento-tiene-dueno.test.ts` recorre `qa/` con el parser de `typescript` (l.79) y cuenta nodos. Un censo nuevo no necesita infraestructura nueva.

## El día después

- **Para quien juega**: nada. Es deuda del banco, declarada.
- **Lo que se vuelve más difícil**: abrir un socket propio al bridge desde un guion pasa a exigir declaración. Bien, si la declaración vive donde se lee (el sitio) y no solo en un JSON aparte.
- **Lo que parecerá arbitrario en un mes**: un padrón de contrato con DOS entradas, las dos `prefetch`, si el criterio 3 se cumple con un tercer `data/contract/*.json` de forma. Lo que NO debería hacerse: fabricar un padrón para dos líneas cuando la misma garantía cabe en el TIPO (una sola puerta en `qa/lib` para abrir sockets al bridge y el constructor prohibido en `qa/guiones/**`, que es la forma que la casa prefiere, `feedback_garantia_en_el_tipo`). Cuál de las dos, lo decide el arquitecto; que el criterio no prejuzgue «padrón».
- **Lo que no se hará y hay que decir**: el bridge NO debe hacer nada con un socket que se fue. `escribir` ya calla por diseño (91-95) y el hecho ya está en su stderr (311). Un dead-letter para un cliente del banco que no escucha es lógica de producción pagando por un test mal escrito. Criterio 4: contestar «no» con esta medida y cerrarlo.

## Conflictos

- **Tanda V (#677/#687) — CHOCA por fichero y por censo**. V reescribe el interior de `pedirYEsperarTile` (H-3 precedencia del predicado, H-5 `hook.tiles ?? []`) y `MS_DEL_TILE` (`sesion.mjs:621`), y censa «once sitios que esperan un tile». Si AF cumple el criterio 2 tal cual (63 y 60 → `pedirYEsperarTile`), (a) toca la misma función en la misma PR ventana, y (b) los once de V pasan a trece sin que V lo sepa. Resolución: AF NO pasa 63 ni 60 por `pedirYEsperarTile` (no esperan el tile en el ledger del cliente: uno mira el save, otro el HUD); si aun así hubiera que tocar `sesion.mjs`, **V fusiona primero** y AF rebasa.
- **#656 (cerrado)**: coherente; este issue es su forma general. Ningún solapamiento pendiente.
- **`arch-rules.json`**: `qa-guiones-sin-espera-por-reloj` prohíbe `new Promise(… setTimeout(` en guiones; el `setTimeout(…, 0)` del 63 y del 60 está DENTRO de un `evaluate` y no casa con el patrón de texto (`arch-rules.json:680`). No es conflicto, es aviso: si la solución mueve ese código, que no despierte esa regla por accidente.

## Coste contra valor

- **Si no se hace nunca**: el día que el contrato de `request_tile` cambie y el banco no lo siga, el 63 dice ⊘ y el 60 ✘ sin causa, y alguien tarda minutos en leer el stderr del bridge. Es el coste real hoy, y es pequeño.
- **Lo que sí paga**: (1) que el censo quede escrito con su decisión por sitio, porque el issue mismo demostró que un censo por nombre pierde la copia (el 60); (2) un candado barato contra la TERCERA copia. Lo que NO paga: mover dos guiones largos (el 60 es de los caros, atlas retenido) a un helper que no necesitan, tres corridas en par cada uno, para arreglar un verde que no existe.
- **Recomendación de tamaño**: tarea de censo + declaración + un candado; cero cambios de comportamiento en el bridge; los 15 «esperan una respuesta» se apuntan como issue aparte o se resuelven en el mismo candado si la forma elegida los cubre gratis.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Corrección de premisa.** Ningún cliente del banco sale VERDE hoy por un rechazo perdido: el 63 declara ⊘ (espera el tile en el save) y el 60 sale ✘ (espera «tile listo» en el HUD). El defecto es que la CAUSA no se nombra, y es latente: `reason: "prefetch"` pasa el contrato. El censo por árbol da **2** sitios que cierran sin esperar (63:89 y 60:524), no uno.
>
> **Criterio 2 (sustituye al actual)**: los dos sitios que cierran sin esperar quedan con su decisión escrita EN EL SITIO; si se decide que deben oír el rechazo, se demuestra en negativo con `reason: "nope"` → ⊘/✘ que NOMBRA el rechazo. No se les impone `pedirYEsperarTile`: no esperan el tile en el ledger del cliente, y esa función la está reescribiendo la tanda V.
>
> **Criterio 3 (matiz)**: «un sitio candado» no prejuzga un padrón JSON; vale igual —y se prefiere— hacer inexpresable el cliente sin declarar (una puerta en `qa/lib`, constructor vedado en `qa/guiones/**`), probado en negativo con un guion nuevo que abra su socket a mano.
>
> **Criterio 4 (cerrado aquí)**: el bridge no cambia. `escribir` (`ws-server.ts:91-95`) calla ante un socket no abierto por diseño y el hecho ya está en stderr (311). Se apunta la decisión y no se implementa nada.
>
> **Añadir a «Fuera de alcance» o abrir issue**: los 15 sitios que esperan UNA respuesta concreta se cuelgan mudos ante un rechazo de intake (el bridge no cierra el socket). No es «verde», es «rojo sin causa»; se decide si el candado elegido los cubre o se abre issue con la lista.
>
> **Orden con la tanda V**: AF no toca el cuerpo de `pedirYEsperarTile` ni `MS_DEL_TILE`; si toca `qa/lib/sesion.mjs`, V fusiona primero.
