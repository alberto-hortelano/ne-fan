# Crítica — tanda AV (#742)

**REENCUADRADA** — el problema es real y la dirección (la regla en core) es buena, pero la tarea es **mayor** de lo que dice: hoy el `ready` no trae con qué reconocer al destino, y el cierre en falso tiene dos consecuencias más que el issue no nombra.

## El problema real en una frase

Durante un viaje, el muro «Viajando...» (y también un muro de fallo sin leer) lo cierra el primer `ready` de tile que llegue, sea del destino o no; y a partir de ahí el fallo del propio destino ya no se pinta donde el jugador mira.

## La premisa, afirmación por afirmación (main = 2d411d11)

1. *«El `ready` de tile llama a `muro.ocultar()` sin mirar el destino»* — **cierto**. `nefan-html/src/main.ts:916-920`: `case "ready": muro.ocultar()`, sin ninguna condición. Las líneas del issue (917-919) siguen valiendo.
2. *«Un prefetch que llega a mitad de viaje quita el muro»* — **cierto y alcanzable**. La cola es de un job a la vez y el viaje no expulsa al job que ya está corriendo (`bridge/scene-gen-queue.ts:1-10`, `handlers/scene.ts:53-57`). Así que un prefetch que ya estaba en vuelo acaba primero y emite su `ready` (`bridge/context.ts:494-505`). Hay además un camino instantáneo que no pasa por la cola: `request_tile` de un tile que ya existe re-difunde en el momento (`handlers/tile.ts:283-288`).
3. *«Debería mirar si el tile que llega es el destino»* — **el dato no está en el cable**. El `ready` que emite `broadcastScene` (`context.ts:494-505`) no lleva `placeId`, aunque en los dos caminos del viaje sí se tiene a mano: `opts.placeId` en `runTileGeneration` (`tile.ts:189-199`, donde solo lo recibe `fail()` desde #737) y `placeId` en `difundirPlaceRealizado` (`scene.ts:197`).
   - Hay un sustituto débil, `scene.place_id` en el efecto `scene_loaded` (`main.ts:1037`). Solo existe si el tile se realizó como lugar: un `place.anchor` que ya apuntaba a un tile existente se sirve por la rama de caché (`tile.ts:210-216`) con una escena sin él.
   - `status.spawn` tampoco sirve de identidad: el viaje `sin ancla` llega sin él (`scene.ts:136-140`, `context.ts:430-432`).
4. *«`overlayAbierto: muro.visible()` confunde esperar con un muro de fallo pintado»* — **cierto** (`main.ts:977`), y tiene una consecuencia medible.
   - Tras #737, todo `status` de `kind:"scene"` lleva `placeId` (`scene.ts:35-88,175,287`, `router.ts:268`). Por eso, en `status-rotulo.ts:209-228`, `overlayAbierto` solo decide en dos casos: (a) un fallo **del viaje** con el muro ya quitado, que va a la línea de mensajes; (b) un fallo de tile sin viaje con un muro de **fallo** pintado, que tapa ese muro con «No se pudo llegar» a un sitio que nadie pidió.
   - (a) es la **cadena del bug**: un prefetch quita el muro, luego falla el destino, y su error acaba en `#combat-log` con el ledger cerrado. El jugador se ha quedado sin muro y sin aviso visible.
5. *(No lo dice el issue.)* **Un `ready` también borra un muro de fallo**: `ocultar()` quita `.error` y los botones (`ui/muro-de-carga.ts:196-208`). Si un prefetch llega detrás de «No se pudo llegar», el jugador pierde el motivo antes de leerlo.
6. *«La regla debería vivir en core junto a `esperasQueTermina`»* — **razonable y verificado**. `esperasQueTermina` (`status-reparto.ts:139-149`) y `deQuienEsElFallo` (`:113-119`) ya deciden de quién es un fallo. Solo que hoy únicamente los *fallos* terminan esperas: la *llegada* no la decide core. El ledger se cierra con `spawn` (`travel-ledger.ts:65-68,99-101`) sin mirar el `placeId`, y con `escena` no se cierra nunca. O sea: un viaje `sin ancla` que llega deja `viajeAbierto()` abierto para siempre.

## El día después

- **Quien juega:** el «Viajando...» dura exactamente lo que dura el viaje. El fallo del destino sale siempre a pantalla completa, y un muro de fallo no se lo lleva un tile ajeno. Es observable y vale lo que cuesta.
- **Lo que se cierra:** el `ready` pasa a ser atribuible, como el error desde #737. Todo productor que difunda **por** el viaje tiene que marcarlo, porque uno que se olvide vuelve al muro eterno. Es el mismo contrato que `test/bridge-map.test.ts` ya sujeta para `fail()`, así que hay que extenderlo al `ready` y no dejarlo en prosa.
- **Lo que debe desaparecer:** `muro.visible()` como argumento de una decisión de core. Si `ContextoDeRotulo.overlayAbierto` sigue existiendo, que sea por un hecho que core pueda nombrar, no por el estado del DOM.
- **Lo que parecerá arbitrario en un mes:** que la llegada se decida en un sitio (el ledger por `spawn`) y el fallo en otro (core). Si la tanda solo condiciona el `ocultar()` en `main.ts`, eso es exactamente lo que queda.

## Conflictos

- **#736** (un `player_entered_place` rechazado por protocolo no tiene desenlace): es la misma pregunta, «qué termina un viaje», y cae en el mismo fichero (`status-reparto.ts`). **No fusionar.** #736 lleva una decisión de núcleo abierta (¿un rechazo sin `placeId` termina el viaje?), y aquí no hace falta. Orden: primero AV. #736 debería reutilizar la noción de desenlace que salga de aquí, no inventarse otra.
- **Tanda AS (atlas):** toca `main.ts:193-230` (el `FpsAtlasController`) y `:568-590` (el tick y la tecla G), además de `fps-atlas.ts` y `gates-de-imagen.ts`. AV toca `main.ts:868-985` (`onTravel`, `onStatusDeLaPartida`, `pintarFalloDelMotor`) y quizá `:1030-1040` (`scene_loaded`). **Sin solape de líneas ni de módulos.** Lo único que se comparte es el fichero, así que la segunda en fusionarse hace un rebase trivial.
- **#748** (CSS del muro de fallo): mismo componente, otro eje. Sin conflicto.
- **Mutación:** `status-reparto` y `status-rotulo` están partidos precisamente por `tope_local` 120 (cabeceras de los dos ficheros). Si la regla nueva los empuja por encima, se trocea; el umbral no se sube.

## Coste contra valor

El coste es moderado: un campo en el `ready` (bridge y contrato de `messages.ts`), una función pura en core y dos llamadas en `main.ts`, más un guion. La infraestructura del banco ya existe (guion 173, retardo vivo del motor falso). No hacer nada significa que cualquier viaje con un prefetch en vuelo, que es el caso normal al explorar, suelta al jugador antes de tiempo y lo teletransporta después. Y si el destino falla, el aviso acaba en la línea de mensajes. Vale lo que cuesta.

## Qué le cambiaría a `requisitos.md` (pegar bajo «Criterios de aceptación»)

> Alcance corregido por el crítico: el `ready` de tile hoy NO lleva con qué reconocer al destino (`bridge/context.ts:494-505`); marcarlo es parte de la tarea, simétrico al `fail()` de #737.
>
> 1. **Core decide el desenlace de LLEGADA** junto a `esperasQueTermina`/`deQuienEsElFallo` (`nefan-core/src/protocol/status-reparto.ts`): un `ready` cierra el viaje y su muro solo si es DEL viaje abierto. El cliente no compara `placeId` por su cuenta.
> 2. **El bridge marca con `placeId` todo `ready` emitido POR un viaje** (`runTileGeneration` con `opts.placeId`, `difundirPlaceRealizado`), incluidas las ramas de caché y `exists`, y el viaje `sin ancla` (sin `spawn`). Lo sujeta un test de bridge que se pone rojo si una rama lo omite, como hace `bridge-map.test.ts` con `fail()`.
> 3. **Un `ready` ajeno no quita ni el «Viajando...» ni un muro de FALLO.** El arranque sigue igual: el primer tile con el mundo vacío quita «Iniciando partida...» / «Generando mundo inicial...».
> 4. **El fallo del destino va al overlay por ser del viaje**, no por `muro.visible()`. `overlayAbierto` deja de alimentarse del DOM; si sobrevive en `ContextoDeRotulo`, con un hecho que core nombre. Un fallo de tile sin viaje con un muro de fallo pintado no lo sustituye.
> 5. **Un viaje `sin ancla` que llega queda cerrado**: `viajeAbierto()` vuelve a `null`.
> 6. **Negativos en rojo, anotados en `implementacion.md`:**
>    - quitar la marca en una rama del bridge pone rojo el test de bridge;
>    - un `ready` ajeno que termina el viaje pone rojo el unitario de core;
>    - con la condición quitada en `main.ts`, el guion sale rojo.
> 7. **Guion de QA** (`e2e-sin-creditos`, cero créditos), sobre la maquinaria del 173:
>    - con un viaje en espera, llega (A) un `ready` instantáneo de un tile existente vía `request_tile` y (B) el `ready` de un prefetch en vuelo;
>    - en los dos, el muro sigue en «Viajando...» y el ledger sigue abierto;
>    - después el viaje llega y el muro se va. Variante: el destino falla tras un `ready` ajeno, y el muro dice «No se pudo llegar» (no la línea de mensajes).
> 8. Fuera de alcance: #736 (el desenlace «rechazado»), que se hará después y reutilizará la noción de desenlace que salga de aquí.
