**REENCUADRADA** — #737 es real y **mayor** de lo que dice (el arreglo en el ledger que sugiere regresaría #693, y el síntoma que ve el jugador está en el muro, no en el ledger); #736 es **menor** (su premisa visible es falsa y el caso es inalcanzable desde el cliente): se reduce o sale de la tanda.

## El problema real, en una frase

El cliente no sabe **de qué viaje habla** un fallo, así que un error ajeno (un tile vecino, un frame de otra cosa) con el «Viajando...» puesto se lee como el fallo del viaje, en el ledger **y en pantalla**; y el propio fallo del viaje llega sin la marca que permitiría distinguirlo.

## La premisa, afirmación por afirmación (main = 57addf93)

| Afirmación | Verificación |
|---|---|
| #736: `ESPERA_POR_KIND.protocolo = null` | Cierto: `nefan-core/src/protocol/status-reparto.ts:99-102`; test en `test/status-reparto.test.ts:112-113`. |
| #736: el rechazo de intake sale como `kind:"protocolo"`, sin `placeId` | Cierto: `bridge/ws-server.ts:309-329`, unicast; `intakeClientMessage` (`bridge/message-intake.ts:20-32`) no dice QUÉ frame rechaza. |
| #736: «el muro "Viajando..." se queda para siempre en el cliente» | **Falso.** `protocolo` va SIEMPRE al overlay (`src/protocol/status-rotulo.ts:262-268`) → `pintarFalloDelMotor` → `muro.fallo("Fallo interno del juego")` (`nefan-html/src/main.ts:975-983`). El jugador ya ve un muro de fallo con «Cerrar». Lo que queda abierto es SOLO el ledger (`main.ts:888`), o sea el banco. |
| #736: «hoy es latente» | Cierto y más: inalcanzable desde el cliente. `enterPlace(placeId: string)` (`net/narrative-client.ts:357`) y el zod es `placeId: z.string()` (`src/protocol/message-schema.ts:196-199`). Solo lo produce un banco que mande basura a propósito. |
| #737: `TravelLedger.fallo` no lleva `placeId` | **Desfasado.** Lo lleva (`nefan-html/src/ui/travel-ledger.ts:73-77`): descarta un `placeId` distinto y atribuye al viaje abierto lo que llega SIN él. |
| #737: un error de tile ajeno rompe el viaje | Cierto. Todos los errores `kind:"tile"` salen sin `placeId`: `bridge/handlers/tile.ts:190-198` (`fail`), `:268-276`, `:296-303`; `bridge/router.ts:253-261`. `esperasQueTermina` los cuenta como del viaje (`status-reparto.ts:100`). |
| (no dicho) el fallo PROPIO del viaje también llega sin `placeId` | **Clave.** El viaje se genera con `runTileGeneration(..., {placeId, ...})` (`bridge/handlers/scene.ts:257-259`), y su `catch` difunde vía `fail()` **sin `placeId`** y devuelve `delivered:true` (`tile.ts:249-262`), así que el `catch` con `placeId` de `scene.ts:280-290` no llega a correr en ese caso. Hoy el ledger distingue «propio» de «ajeno» por NADA; si se ignora lo que llega sin `placeId`, el viaje roto de verdad vuelve a pagar la expiración (el regreso de #693). También `Lugar desconocido en el mapa` sale sin `placeId` (`scene.ts:31-38`). |
| (no dicho) el síntoma que ve el jugador | El muro lo decide `rotuloDeStatus` con `overlayAbierto: muro.visible()` (`main.ts:976-979`), no el ledger. Un error de tile ajeno con el «Viajando...» puesto pinta el muro de fallo encima de un viaje que sigue; al llegar el `ready`, `muro.ocultar()` (`main.ts:918`) lo quita y el jugador aparece: primero un fallo falso, luego el viaje llega. Arreglar solo el ledger lo deja todo igual para el jugador. |
| #737 menor: anillo del spinner parado bajo el error | Cierto y **a propósito**: `nefan-html/src/ui/game-ui.css:396` (`animation:none; border-top-color:currentColor`), del commit de temas 3a0f5172. Vale para TODO `muro.fallo` y para `ofrecer`, no solo para el viaje. |

## El día después

- Quien juega: con #737 bien hecho, un tile vecino que falla durante un viaje no le enseña un «No se pudo...» falso. Con #736 no cambia nada (ya ve «Fallo interno del juego»).
- La atribución vive hoy en el cliente (`travel-ledger.ts`), sin harness (#241): una regla de «este fallo es de este viaje» que se escriba ahí no se puede probar en negativo, y el criterio 4 lo prohíbe. El sitio que ya existe y se prueba es `esperasQueTermina` en core.
- Qué cierra: si un fallo solo cierra el viaje cuando se sabe que es suyo, todo productor de fallos del viaje tiene que marcarlo; uno que se olvide vuelve a la expiración. Eso pide un candado (lo decide el arquitecto), no una convención.
- Con #736 tal como está: habría que ampliar el rechazo de intake para que diga qué frame rechaza, solo para un frame que el cliente no puede mandar mal. Dentro de un mes, eso parece arbitrario.

## Conflictos

- **Tanda AS (política de atlas)**: sin solape de fondo. AS toca `politica-de-atlas.ts`, `fps-atlas.ts` y el cableado del atlas en `main.ts:193-230` y `:568-590`. AT toca el manejador de status (`main.ts:868-930`), `travel-ledger.ts`, `status-reparto.ts`, `bridge/handlers/tile.ts` y `scene.ts`. Son hunks distintos de `main.ts`: riesgo de merge textual bajo, ninguno semántico.
- **#738 / #739** (padrón de clientes WS y la lectura de `"protocolo"` en el banco): se solapan con #736 si #736 añade al rechazo un campo nuevo que el banco tenga que leer. Otra razón para no ampliar ahora el rechazo de protocolo.
- **#693** (cerrado en 57addf93): el arreglo ingenuo de #737 lo deshace (ver la premisa clave arriba). El guion 168 (`qa/lib/viaje.mjs`) es el negativo que tiene que seguir rojo→verde.

## Coste contra valor

- #737: coste pequeño (una marca en los errores del viaje, una regla en core, el muro que la respeta) y valor real: un fallo falso a pantalla completa es de los que el jugador sí ve. **Hacer.**
- #736: el valor es cero para el jugador y casi cero para el banco (hay que fabricar el frame malo). Si no se hace nunca, no pasa nada que alguien vea. **No hacer ahora.** Hay dos salidas: cerrarlo como latente con la corrección de su premisa, o dejarlo abierto con el cuerpo corregido para cuando el cliente pueda producir ese frame.
- Anillo del spinner: una línea de CSS, pero cambia TODOS los muros de fallo y la oferta. Si entra, hay que decirlo así y que QA revise la parte visual de todos, no solo del viaje.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Criterios de aceptación (reencuadrados por la crítica)**
>
> 1. (#737) Un fallo cierra el viaje abierto **solo si es de ese viaje**, y esa decisión la toma una función pura de nefan-core con su batería probada en negativo (no la clase del cliente). Todo error que emita el bridge **por el viaje** lleva su `placeId`, incluido el `fail()` de `runTileGeneration` cuando genera el tile de un place (`bridge/handlers/tile.ts`) y el «Lugar desconocido» de `handlers/scene.ts`.
> 2. (#737) Negativo con viaje abierto: un error de un tile que NO es el destino → el ledger sigue abierto, **el muro «Viajando...» NO se sustituye por un muro de fallo** (el aviso va a la línea de mensajes) y el viaje llega con spawn. Positivo, que no se puede perder: el fallo de generación DEL destino sigue cerrando el viaje con su causa en segundos (el guion 168 sigue verde, con su tiempo).
> 3. (#736) **Fuera de esta tanda.** Premisa corregida: el jugador ya ve «Fallo interno del juego» (`status-rotulo.ts`), y el frame no puede salir mal del cliente (`placeId: string` contra `z.string()`). Se comenta en el issue y se deja abierto como latente. No se amplía el rechazo de intake (se solaparía con #738/#739).
> 4. (menor, opcional) Si se quita el anillo del muro de fallo, se quita en TODOS los muros de fallo y de oferta (`game-ui.css:396`), y QA lo revisa en al menos dos de ellos, no solo en el del viaje.
> 5. Guion de QA ejecutable para 2. Cero créditos (motor falso, `e2e-sin-creditos`).
