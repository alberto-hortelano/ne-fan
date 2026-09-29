**REENCUADRADA.** H1 es real y abarca más de lo que dice. En H2 basta la prosa: no se toca el contrato. H3 va en la dirección correcta, pero arrastra un defecto del código que el enunciado no ve. H4 entra, y H5 no tiene sujeto en el repo.

## El problema real, en una frase

El mapa y el tile no se ponen de acuerdo sobre DÓNDE está un lugar. El motor no recibe los rects que ya existen (H1), entrega el suyo tarde (H2) o lo usa para otra cosa (H3). Por eso el jugador aparece o activa el lugar donde no está lo que nombra.

## La premisa, afirmación por afirmación

- **H1: la entrada regenerada no recibe los sitios anclados en ella. CIERTO, y es MAYOR.** Pasa en `bridge/handlers/tile.ts:77-93`, `buildGenerateTileCtx`:
  - Todo lugar anclado en el propio tile se salta con `continue`, así que no llega ni como `place` ni en `nearby_places`.
  - Sin `placeId`, `place ??=` se queda con el PRIMERO que encuentra y descarta los demás sin avisar.
  - Además, `place` no lleva NUNCA su propio rect: el tipo en `src/narrative/types.ts:342-348` no tiene el campo.

  No es solo la entrada: afecta a cualquier tile que se genere con algún lugar ya anclado. Hoy el camino que lo dispara de verdad es la entrada de #578. Lo de Marela frente a Oria viene de lo mismo: el motor no ve la `description` de esos sitios.
- **H2: el rect llega después de `narrative_respond` y la llegada no lo ve. CIERTO.**
  - En el código: `generateTileScene` espera a `aiClient.generateScene`, que vuelve con el respond. Justo después, `runTileGeneration` difunde con `porElViaje()` (`tile.ts:274-292`), y el `sitio` se evalúa en ese momento (`scene.ts:266-281`).
  - En la transcripción `motor-A.ndjson`: `narrative_respond` y luego `map_upsert_place {"id":"ondahonda",…"anchor"…}`. Con `torre_del_hilo` pasa lo mismo.
  - Hoy la prosa (`tile_instructions.md:50-59`) no dice nada del ORDEN. Los 2 fallos de 4 son de un texto que nunca lo pidió.
- **H3: el rect se usa como punto de llegada. CIERTO, y el código solo casa con que sea la huella.** El rect tiene dos consumidores:
  - `activateByPosition` (`tile.ts:400-415`) lo usa como ÁREA.
  - `resolvePlaceTarget` (`place-target.ts:20-27`) toma su CENTRO, y `sitioParaAparecer` corrige a un sitio libre (`scene.ts:103-125`).

  El punto de llegada ya se deriva del rect. Un rect que sea «el sitio donde aterrizar» deja el área de activación rota, y un rect que sea la huella deja las dos cosas bien. La prosa (`tile_instructions.md:54-57`) y la descripción de la tool (`narrative-mcp/server.ts:705-710`) presentan las dos funciones a la vez, y el modelo optimizó la que se ve.
- **H3, lo que no ve: los rects anidados.** El comentario de `tile.ts:400-401` dice «el más específico (con rect) gana». Es FALSO entre dos rects: el bucle de `tile.ts:406-415` asigna `placeId` a cada rect que contiene la posición y gana el ÚLTIMO en orden de inserción, sin comparar áreas. Hoy no pasa porque el settlement del bootstrap no lleva rect. Con H3 el motor pondrá huellas a los pueblos, y sus sitios quedarán dentro, así que esa línea pasa a cargar peso.
- **H4: los rechazos no dejan rastro. CIERTO.** Hay unos 20 `return {…isError: true}` en `narrative-mcp/server.ts` (el pre-flight está en 339-545) y el único `console.error` del camino de respond es el de la línea 565. Aclaración: #239 ya está CERRADO (`gh issue view 239`), así que H4 no sirve a ningún issue abierto. Sirve al próximo playtest.
- **H5: `--allowedTools` no restringe. CIERTO, pero SIN SUJETO EN EL REPO.** La receta vive solo en `labs/narrative/runs/tanda-bm-20260929/motor.sh`, que está gitignored. `grep -rn "claude -p\|allowedTools"` sobre `labs/`, `qa/` y `docs/` no encuentra ninguna receta commiteada; solo el propio `qa.md`. No hay nada que arreglar. Como mucho se añadiría una receta nueva, y eso ya no es H5.

## H2: ¿contrato o prosa? Prosa, y NO un campo en Format D

- Format D es lo que se PERSISTE (CLAUDE.md, «Formatos de escena»). Si el rect viajara dentro del tile, habría DOS verdades para el mismo rect: `scene_data.*` y `world_map.anchor.rect`. Y dos puertas para escribirlo: la tool y la escena. Eso deshace lo que cerró BE (#772), que es `AnchorSchema` como fuente única. Además arrastra el zod estricto (`scene-schema.ts:306`), el espejo en Python, `generate_scene.json` y `contract-model-io`: cuatro procesos para un fallo acotado.
- El daño de H2 está acotado:
  - Solo afecta a la PRIMERA llegada. El rect queda guardado y los viajes siguientes lo leen.
  - El jugador no queda atrapado, porque `sitioParaAparecer` se aplica igual.
  - Con H3 bien hecho, un pueblo que ocupa el tile aterriza dentro de su huella aunque no tenga rect: es el caso de Ondahonda.
- Si se quiere la garantía en el tipo, el vehículo NO puede ser Format D. Esa decisión es del usuario (ver abajo).
- **Se puede falsar así:** con la frase del orden puesta, un playtest que vuelva a dar un rect después del respond reabre la opción estructural.

## H3: sí, el rect es la huella. Qué implica

- **Triggers.** Saltan al entrar en el área construida, no en unos m² de plaza. Hay algo que no cambia y conviene saber: al salir del rect, `posTracking.placeId` pasa a `null` (`tile.ts:422-423`) y `on_enter` vuelve a saltar en CADA reentrada. `leave` no salta al salir al campo abierto (`context.ts:588`). Una huella grande reduce ese parpadeo; no lo crea.
- **Punto de llegada.** Es el centro de la huella, que en un pueblo suele caer dentro de un edificio. `sitioParaAparecer` lo lleva a la puerta: medido, ≤ 3,90 m (`scene.ts:117-118`). No hay campo nuevo. Si alguien quiere un punto de llegada distinto del área, eso es OTRO campo y no se hace aquí.
- **Lugar que ES el tile.** Para un settlement o landmark que ocupa el tile entero, «sin rect» sigue siendo lo correcto (`world-map-schema.ts:79-84`). La prosa no debe empujar a poner rect siempre.
- **Rects anidados.** Ver la premisa: hay que arreglarlo o candarlo en esta tanda, porque H3 es lo que lo vuelve alcanzable.

## El día después

- **Para quien juega:**
  - Al regenerarse la entrada, «La Posta del Farol» vuelve a estar donde está la posada, y con su posadera.
  - Los triggers de un pueblo saltan en el pueblo.
  - El primer viaje a un lugar deja en el lugar casi siempre. Es prosa, no garantía.
- **Qué se vuelve más difícil:** el contexto de `generate_tile` crece un poco con cada lugar anclado en el tile.
- **Qué NO debe hacerse:**
  - Dejar que el motor RE-ancle los sitios de la entrada. Contradice la «cero siembra» que midió #465.3b y convierte un dato del mapa en una opinión del modelo.
  - Un test que compruebe que la frase existe en el prompt. Sería un verde que no puede ponerse rojo por lo que importa.
- **Qué se puede candar con el motor falso:** que el contexto lleve los lugares anclados con su rect y su descripción (determinista, sobre `buildGenerateTileCtx`) y la resolución de rects anidados. Lo que el motor haga con ellos, NO.

## Conflictos

- **BL** (`feature/tanda-bl`, #618/#298) cambia `npc-director.ts`: `arriveNpc` salta a `sitioParaAparecer(centro del rect)`. Con H3 el centro pasa a ser el de la huella, y BL ya resuelve el caso del centro macizo. No hay conflicto de código: BM no debe tocar `place-target.ts`, `npc-director.ts` ni `npc-behavior.ts`. Nota para BL, no para BM: un NPC que llegó a pie y está a más de 3 m del centro de un pueblo grande se teletransporta con `npc_arrive` (el `dist > 3` compara con el centro).
- **BO** (A* sobre `npc-behavior.ts`) no se cruza con BM.
- **BJ** reescribe `bridge/ws-server.ts` (−300 líneas), `state-http-server.ts` y `test/helpers.ts`, y también toca `helpers.ts` BL. BM no necesita ninguno de los tres: su superficie es `handlers/tile.ts`, `src/narrative/types.ts`, `tile_instructions.md` y `narrative-mcp/server.ts`. Regla: no editar `helpers.ts` ni `ws-server.ts`. Si un test lo exige, entrar después de BJ.
- **#578/guion 214/guion 144:** el motor falso repite la misma entrada, así que no ven H1 (confirmado por qa.md). No se rompen.

## Coste contra valor

- **H1:** un campo en el contexto (tipo, `buildGenerateTileCtx`, un párrafo de prompt) y un unitario. Barato, y cierra un defecto visible.
- **H2:** una frase.
- **H3:** una frase y el arreglo de los anidados en `tile.ts`, que es pequeño y determinista.
- **H4:** unas diez líneas de `console.error`.
- **H5:** cero.
- **Si no se hace nada:** H1 solo muerde en la entrada regenerada, que es un camino raro. H2 cuesta unos metros en la primera llegada. H3 es el que más se nota en partida: triggers muertos en toda la escena menos en la plaza.

## Qué le cambiaría a `requisitos.md` (para pegar en «Fase 2»)

> **Alcance (tras la crítica):**
> 1. **H1:** el contexto de `generate_tile` lleva, junto al `place`, su `rect` y TODOS los lugares anclados en ese tile (id, name, kind, description y rect). La prosa manda construir cada uno dentro de su rect y respetar su descripción. El motor NO re-ancla ni siembra. Afecta a todo tile con lugares anclados, no solo a la entrada. Candado: unitario sobre `buildGenerateTileCtx`, que hoy los descarta con `continue` en `tile.ts:88-91`.
> 2. **H2:** SOLO prosa, en `tile_instructions.md` y en la descripción de `map_upsert_place`: con `generate_tile.place`, el rect se declara ANTES de `narrative_respond`. No va en Format D (sería una segunda verdad del rect, persistida en la escena).
> 3. **H3:** el rect es la HUELLA del lugar (el área construida de un pueblo; el monumento y su entorno). El punto de llegada se deriva de ella y no se declara. Si el lugar es el tile entero, sin rect. Y como H3 hace alcanzables los rects anidados, `activateByPosition` resuelve el anidamiento por área (el más pequeño gana), con unitario. Hoy gana el último del bucle.
> 4. **H4:** cada rechazo del pre-flight de `narrative_respond` escribe una línea en stderr con su clase.
> 5. **H5: fuera.** No hay receta commiteada que corregir.
> No tocar `ws-server.ts`, `test/helpers.ts`, `place-target.ts`, `npc-director.ts` ni `npc-behavior.ts` (BJ, BL y BO).

## Decisiones del usuario

1. **H2:** ¿basta la prosa, o se quiere la garantía en el tipo? Si se quiere, que sea por una vía que NO meta el rect en Format D, y se paga como cambio de contrato de MCP.
2. **#465:** ¿se cierra al mergear, o se re-mide la prosa de H2 y H3 con otro playtest corto? Cuesta motor Max, no créditos. Sin re-medida, el cierre de H2 y H3 es una promesa, no una medida.
