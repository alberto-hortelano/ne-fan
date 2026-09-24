# Requisitos — tanda AT: Un viaje rechazado o fallido se cierra con SU causa y solo con la suya (#736 #737)

## Petición literal del usuario

> «Sube node a latest, mientras estemos en desarrollo no fijamos version. Mutacion lanzada, sigue con la siguiente tanda. […]» (2026-09-24). Y la petición de fondo de la jornada: «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## Los issues, verbatim

### #736

> Un player_entered_place rechazado por el intake deja el viaje abierto: el ledger no tiene desenlace «rechazado»
> 
> `ESPERA_POR_KIND.protocolo = null` (`nefan-core/src/protocol/status-reparto.ts`): el `narrative_status {kind:"protocolo"}` con el que el bridge rechaza un frame por contrato (`bridge/ws-server.ts`) no termina ninguna espera, tampoco la del viaje. Si el frame del viaje no pasa el zod, el muro «Viajando...» se queda para siempre en el cliente, y en el banco `viajarPorSalidas` (`qa/lib/viaje.mjs`, #693) paga `MS_DEL_TILE` entero. Es el tercer desenlace que el issue #693 nombraba («rechazado») y que hoy no existe en el camino del viaje. Decisión del núcleo: ¿un rechazo de protocolo sin `placeId`, con un viaje abierto, termina ese viaje? Hoy es latente (el frame pasa el zod). Negativo: mandar un `player_entered_place` inválido → el ledger con `error` en segundos. Relacionado: #693, #694, #678.
> 
> Sale de la tanda AP (#693).

### #737

> Un error de tile AJENO durante un viaje abierto se atribuye al viaje (TravelLedger.fallo sin placeId)
> 
> Hallazgo de la QA de la tanda AP (#693), leído en el código del cliente y NO probado en flujo: `TravelLedger.fallo` no lleva `placeId`, así que un error de generación de un tile que no es el destino, llegado mientras hay un viaje abierto, marca ese viaje como roto.
> 
> Menor anotado por la misma QA: el muro de fallo del viaje conserva el anillo del spinner parado bajo el título de error.
> 
> Relacionado: #693.

## Criterios de aceptación

1. (#736) Si el intake rechaza un `player_entered_place` por contrato, el viaje abierto se cierra con desenlace «rechazado» y SU motivo. El cliente quita el muro «Viajando...» y dice por qué. Negativo medido con tiempos: frame inválido → el ledger con error en segundos, no la expiración. Hay que decidir en el núcleo cómo casa un rechazo de protocolo con el viaje, **sin** atribuir al viaje un rechazo que no es suyo.
2. (#737) Un error de generación de un tile que NO es el destino del viaje abierto no rompe ese viaje: `TravelLedger.fallo` (o su sucesor) sabe de qué lugar habla. Negativo: error de tile ajeno con un viaje abierto → el viaje sigue abierto y llega.
3. (#737, menor) El muro de fallo del viaje no conserva el anillo del spinner parado bajo el título de error.
4. La lógica vive en nefan-core y el cliente solo pinta. Guion de QA ejecutable, y los tests del núcleo probados en negativo.

## Restricciones

Cero créditos: motor falso y `e2e-sin-creditos`. Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador.

## Criterios reescritos tras la crítica

El coordinador acepta el reencuadre de `critica.md` (2026-09-24). **Estos criterios sustituyen a los cuatro de arriba**, que quedan como registro de lo que se pidió:

1. (#737) Un fallo cierra el viaje abierto **solo si es de ese viaje**, y esa decisión la toma una función pura de nefan-core con su batería probada en negativo (no la clase del cliente). Todo error que emita el bridge **por el viaje** lleva su `placeId`, incluido el `fail()` de `runTileGeneration` cuando genera el tile de un place (`bridge/handlers/tile.ts`) y el «Lugar desconocido» de `handlers/scene.ts`.
2. (#737) Negativo con viaje abierto: un error de un tile que NO es el destino → el ledger sigue abierto, **el muro «Viajando...» NO se sustituye por un muro de fallo** (el aviso va a la línea de mensajes) y el viaje llega con spawn. Positivo, que no se puede perder: el fallo de generación DEL destino sigue cerrando el viaje con su causa en segundos (el guion 168 sigue verde, con su tiempo).
3. (#736) **Fuera de esta tanda.** Premisa corregida: el jugador ya ve «Fallo interno del juego» (`status-rotulo.ts`), y el frame no puede salir mal del cliente (`placeId: string` contra `z.string()`). Se comenta en el issue y se deja abierto como latente. No se amplía el rechazo de intake (se solaparía con #738/#739).
4. (menor) El anillo del spinner se quita en **todos** los muros que usan el estado `.error` de `#narrative-loader` a la vez (fallo in-game, oferta de reintentar y muro de arranque: los tres son el mismo elemento), y QA lo revisa visualmente en al menos dos de ellos, no solo en el del viaje. Si no puede hacerse así, sale de la tanda.
5. Guion de QA ejecutable para 2. Cero créditos (motor falso, `e2e-sin-creditos`).
