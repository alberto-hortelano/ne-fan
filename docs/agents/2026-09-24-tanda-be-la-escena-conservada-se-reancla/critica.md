# Crítica — tanda BE (#578 #465)

**#578 → REENCUADRADA** (re-anclar sí, pero al revés: la entrada nueva al mapa viejo, no el anillo viejo a un mapa nuevo; mismo gasto que hoy, sin llamadas de más). **#465 → VIGENTE, partida en dos**: el esquema y el prompt se hacen ya; la verificación con motor real va con #239.

## El problema real, en una frase

- **#578**: cuando la entrada de un mundo pre-generado no pasa el validador, el bootstrap vivo **siembra un mapa nuevo y genera una entrada sin vecinos**, y el fichero acaba mezclando dos generaciones: el anillo viejo (con los lugares y las costuras del mapa viejo) alrededor de una entrada y un mapa que no las conocen. El `place_id` colgando es el síntoma que se ve. Las costuras rotas son el que no se ve.
- **#465**: el motor real nunca recibe la instrucción de dar `anchor.rect`, y el bridge acepta cualquier número como rect.

## La premisa, afirmación por afirmación

| Afirmación | Verificación (código de hoy, `96da8151`) |
|---|---|
| El bootstrap vivo siembra el mapa de cero | Cierto: `bridge/handlers/bootstrap-tile.ts:36` pone `bootstrap_world_map = true`, y además la entrada se genera con `neighbors: {}` (`:41`) |
| El write conserva el anillo con el mapa VIVO | Cierto: `bridge/context.ts:219-229` (`conservadas` + `mapaVivo`); el aviso está en `:241-259` |
| Solo hay conservadas si la ENTRADA falló | Cierto: stale o malformado ⇒ `{}` (`src/games/world-snapshot.ts:281-296`); la entrada injugable lanza (`:222-226`), y `session.ts:518-525` degrada al bootstrap |
| Nadie mira si el anillo casa con la entrada nueva | Cierto, y es más grave que el `place_id`: la carga valida con `required_crossings: []` (`world-snapshot.ts:213-216`) y la entrada nueva se generó sin vecinos |
| El `place_id` de un tile lo elige el motor | **Falso**: lo decide el BRIDGE por el anchor que haya en esas coordenadas (`bridge/handlers/tile.ts:126-137`, con `buildGenerateTileCtx` en `:60-75`). Pedirle al motor que «re-etiquete» escenas iría contra esa regla |
| El patrón «el motor genera dentro del mapa viejo» ya existe | **Sí**: la cura de #577 restaura `plan.worldMap` y registra las servibles como vecinas antes de llamar a `generateTileScene` (`bridge/handlers/game-repair.ts:208-216`). Pero **no cura la entrada**: `cargarConDetalle` lanza con ella (`world-snapshot.ts:222`) |
| «Gasta créditos del motor, sujeto a `NEFAN_ENTORNO`» | **Premisa equivocada**: `NEFAN_ENTORNO` es un techo sobre el **arte de Imagen IA** (`src/session/gates-de-imagen.ts:94-116`) y no toca las llamadas al motor. Ninguna llamada al motor tiene hoy puerta ni confirmación: cada tile al que se camina llama sin preguntar (`tile.ts:115`) |
| `AnchorSchema.rect` no tiene `.int()` ni cotas | Cierto: `src/contracts/request-schemas.ts:83`. La tool MCP tiene `.int()` y `length(4)` pero tampoco cotas (`narrative-mcp/server.ts:699-703`). Son **dos copias sin candado de paridad**: la tool no importa `PlaceUpsertSchema` |
| Ningún prompt pide `anchor.rect` | Cierto: `anchor` solo sale en `tile_instructions.md:40` («the bridge anchored…»), `narrative_event.md:89` y `ui_systems.md:116`; ninguno dice cuándo ni cómo dar el rect. El bridge ancla sin rect al viajar (`bridge/handlers/scene.ts:251-254`) |
| (de paso) «`fromSerialized` re-valida el world_map» | **Falso**: `world-map.ts:284-286` solo lo envuelve. Lo dicen `world-snapshot.ts:35` y `:242`, y el zod del snapshot deja pasar `world_map` como `z.record(z.unknown())` (`:43`). Un rect absurdo que venga en el fichero entra sin que nadie lo compruebe |

## Qué significa «re-anclar con el motor» en concreto (#578)

- **Kind MCP**: el que ya existe, `scene` con `generate_tile` (`tx:0, ty:0`, `bootstrap:true` para que traiga el spawn del jugador), **sin** `bootstrap_world_map` y con `neighbors` = el anillo conservado. No hace falta un kind nuevo. Un kind «reanchor» obligaría a crear un contrato, un prompt, una fixture y soporte en el motor falso, y aun así dejaría las costuras sin casar.
- **Cuándo**: en el único disparo que existe, es decir, `start_session` con el snapshot de entrada rechazado, en el sitio donde hoy se encola `runBootstrapTile`. El mapa viejo y el `place_id` de la entrada vieja están en el fichero, porque el snapshot pasó el zod y solo falló el validador de jugabilidad.
- **Mientras llega la respuesta**: exactamente lo mismo que hoy, `narrative_status generating kind:"tile"` con el cargador (`session.ts:537-543`), porque el tiempo de espera es el mismo.
- **Si falla**: igual que hoy, `motivoParaElJugador` y el overlay que ofrece volver al título (`bootstrap-tile.ts:124-136`), **sin escribir el snapshot**. Lo que NO debe hacer es volver en silencio al bootstrap que siembra un mapa nuevo: ese es el bug. Si el mapa viejo no nombra el lugar de la entrada, eso se DICE y se decide en el plan; no se tapa.
- **Coste**: una llamada al motor, la misma que el bootstrap de hoy, y más barata, porque ya no hay que sembrar 3-5 lugares con las map tools. **Cero llamadas añadidas.**

## Cómo se prueba sin gastar

Con el preset `e2e-sin-creditos` y `fake-ai-server` (`labs/narrative/fake-ai-server.ts:327-364` distingue el bootstrap del tile). Los pasos, como en el bloque E5b del guion 127: se fabrica en disco un mundo con la entrada injugable y un anillo cuyos `place_id` están en el mapa del fichero **pero no en los ids fijos que siembra el bootstrap falso**. Así la divergencia existe con el motor falso, y se ve si alguien vuelve a sembrar.

## Control del gasto real

**No hay que tocar `NEFAN_ENTORNO`.** Extenderlo a las llamadas del motor cambiaría el significado de una decisión del usuario del mismo día, que habla de arte ya pagado. Y no hace falta, porque no se añade ninguna llamada. Lo que sí tiene que quedar sujeto por un test es justo eso: **el camino degradado hace exactamente una petición al motor**.

## El día después

- **Para quien juega**: un mundo pre-generado cuya entrada cayó por un validador más estricto conserva sus lugares, su panel «Salidas» y costuras que casan. Hoy pierde las tres cosas y solo se entera el log.
- **Qué hay que borrar**: el aviso de `colgando` de `context.ts:241-259` y el E5b del guion 127 se quedan sin sujeto en la rama `conserva`, así que se borran o se convierten en el negativo del arreglo. Si nadie se ocupa, quedan como candado tautológico, que es lo que la tanda M ya advirtió.
- **Qué cierra**: la entrada deja de poder cambiar de mundo en ese camino. Si el mundo viejo no gusta, regenerarlo sigue siendo el botón del título (`reemplaza`).

## Conflictos

- **#577 (cerrado, cura)**: es un solapamiento para aprovechar, no un choque. La cura ya hace esto mismo para el anillo. El arquitecto debe decidir si la entrada entra por ese mismo cuerpo o por el de sesión, sin pagar dos veces.
- **#465 con #239**: comparten la sesión de playtest con motor real. No hay ningún otro issue abierto que toque esto (`gh issue list`).
- **Decisión del usuario**: este encuadre **conserva** «re-anclar con el motor», pero le da la vuelta a la dirección. No es la opción 2: no se mezclan dos mapas. El mapa es de una sola generación y la única escena nueva es la entrada. **El coordinador debe confirmarlo con el usuario** antes del arquitecto.

## Coste contra valor

- **#578 en literal** (el motor re-etiqueta o re-ancla el anillo contra el mapa nuevo): M-L, con un kind nuevo, y deja las costuras rotas. **No debería hacerse.**
- **#578 reencuadrada**: S-M, porque reutiliza el kind, el prompt de tile y el patrón de la cura. **No hacer nada** también es aceptable, porque el caso solo aparece cuando se endurece el validador; pero hoy ese caso rompe tres cosas y el arreglo cuesta cero llamadas.
- **#465, mitad hacedera**: S y cero créditos.
  - Poner `.int()` y cotas en el rect (`0≤col,row`, `w,h≥1`, `col+w≤128`, `row+h≤128`, con `TILE_CELLS` de `src/scene/tile.ts:17`), en **una sola fuente o con un candado de paridad** entre el bridge y la tool.
  - Añadir a `tile_instructions.md` el cuándo y el cómo de `anchor.rect` (sobre todo con `generate_tile.place`).
  - Tests de contrato con negativos en rojo (rect fraccionario, negativo, fuera del tile, `w=0`) y el pre-flight de la tool diciendo cuál es el error.
- **#465, lo que queda para #239**: saber si un modelo real da el rect, y si los rects pegados al borde producen los 0,40 m fuera del tile (H4 de la tanda G). El guion 144 ya es el candado del camino. El issue **no se cierra**: se reescribe apuntando a #239.

## Criterios de aceptación (que el coordinador pegue en `requisitos.md`)

1. **#578**. Cuando `start_session` encuentra un snapshot con la entrada injugable, el motor recibe UNA petición `generate_tile{tx:0,ty:0,bootstrap:true}` **sin `bootstrap_world_map`** y con `neighbors` no vacío. El `world_map` escrito tiene exactamente el mismo conjunto de ids de lugar que el del fichero anterior, y `escenasSinLugarEnElMapa` da 0. Se comprueba en un test de core con un `aiClient` falso que cuenta las peticiones. **Negativo**: con el bootstrap que siembra, en rojo.
2. **#578**. La lógica que elige el camino, qué mapa y qué `place_id` de entrada, es pura y vive en core. El handler solo encola.
3. **#578**. Si falla el motor, o el mapa viejo no nombra el lugar de la entrada, sale un `narrative_status error` con el motivo, el fichero queda intacto y **no** se vuelve en silencio a sembrar un mapa.
4. **#578**. Guion entre 214 y 217 con `e2e-sin-creditos`: una divergencia fabricada en disco, el jugador camina de la entrada a un tile del anillo, **el panel «Salidas» NO está vacío**, y el log del motor falso tiene 1 petición. El E5b del 127 se retira o se invierte, sin que quede un aserto tautológico.
5. **#578**. Se corrigen los comentarios falsos de `world-snapshot.ts:35,242` sobre `fromSerialized`, o bien se hace verdad lo que dicen. Lo decide el arquitecto.
6. **#465**. El rect del anchor se rechaza si no es entero, es negativo, tiene `w` o `h` ≤ 0 o se sale de 128. Lo rechazan igual la tool MCP y `POST /map/place`, desde una sola fuente o con un test de paridad que se haya visto en rojo. **Negativos en rojo.**
7. **#465**. `tile_instructions.md` le pide al motor el `anchor.rect` del lugar en `generate_tile.place` y le dice en qué unidades va. `test/contract-model-io.test.ts` sigue en verde. El issue queda abierto y reescrito como «verificación en el playtest de #239».
8. **Cero créditos, en todo**: el motor falso y `e2e-sin-creditos`, sin ninguna llamada al motor real.
