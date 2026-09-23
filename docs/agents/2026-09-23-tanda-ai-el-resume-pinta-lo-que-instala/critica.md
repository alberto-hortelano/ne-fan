**REENCUADRADA** — el síntoma es real, pero no es del resume: es de todo tile instalado que no es el activo, también en partida viva. Y la vía que el issue da por defecto (reinstalar solo el activo) empeora lo que ve quien juega.

## El problema real, en una frase

Un tile instalado en el cliente que no es el activo nunca recupera el arte que **ya está pagado**, porque el único que pide atlas es `onActiveTile`; lo ve el jugador en cuanto hay más de un tile instalado, y el resume lo agranda de uno a ocho.

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificación |
|---|---|
| El resume reinstala todos los tiles del save | **Cierto.** `nefan-html/src/main.ts:1243-1254`: primero el activo, después el `resto` de `scenes_loaded`, todos por `addTile` |
| Solo el tile activo pide atlas | **Cierto.** `world/carga-de-tile.ts:149` (`activarTile`) y `:324` (`installTile` si `key === mundo.tileActivo`); no hay más llamadas a `onActiveTile` |
| Los vecinos se ven | **Cierto.** `renderer/fps-gl.ts:1274` `setActive` solo cambia las sombras, así que se pintan todos los tiles; la niebla acaba en 90 m (`fps-gl.ts:55-56`) y un tile mide 64 m |
| «En la partida VIVA no pasa, porque el cliente solo tiene el tile en el que está» | **Falso en parte.** Toda escena difundida se instala sin activarse (`main.ts:1029-1042`, `scene_loaded` → `addTile`), y eso incluye el vecino que llega por prefetch cuando el jugador contesta Y. En un mundo pre-generado ese vecino sale del snapshot (`bridge/handlers/tile.ts:281`, `source: "cache"`), con su arte ya pagado por el batch de estilo, y se queda en clay al otro lado de la frontera hasta que el jugador la cruza. Lo que la partida viva no tiene es el anillo entero **al arrancar**: `replayWorldSnapshot` (`bridge/handlers/session.ts:558-568`) solo difunde la escena de entrada |
| El menú de desarrollo dice la verdad | **Cierto.** `renderer/fps-renderer.ts:206` `tilesSinAtlas` cuenta los tiles instalados que siguen sin textura. El guion 156 (§5) lo da ya como estado esperado |

## La decisión que plantea el issue: la evidencia apunta a pedir el atlas, no a reinstalar solo el activo

**Reinstalar solo el activo** alinea el resume con el *arranque* de una partida viva, pero no con la partida viva que el jugador llevaba hasta guardar. La frontera decide qué vecinos faltan preguntando al `tileStore` del **cliente** (`world/frontera-del-jugador.ts:24`, `tiene: … deps.tileStore.has`; `src/scene/frontera.ts:18-24`). Un tile que el jugador ya pisó y que no se reinstala le **vuelve a proponer** Y/N, y la colisión lo retiene en ese borde hasta que conteste. Eso es una regresión que ve quien juega: hoy, al reanudar, se vuelve andando a donde ya se estuvo. Además rompería la premisa de los guiones 49 y 60, que reanudan con dos tiles viajados y miran el mundo que vuelve.

**Pedir el atlas de los tiles instalados que no son el activo**, restaurando solo, cuesta 0 $. `fps-atlas.ts:125-143` ya tiene esa escalera: memoria → mapping en `localStorage` → `runFor(…, { resolveOnly: true })`. Con `resolveOnly`, `runFor` nunca pinta (`:171-172`); guion 156 §5: «lo ya pagado vuelve gratis». El criterio 2 se cumple por construcción si el tile no activo **no pinta nunca**. Recomiendo esta vía.

Lo que **no** debe hacerse, sea cual sea el plan: llamar a `onActiveTile` una vez por vecino. `PoliticaDeAtlas` (core) supone un solo tile activo, y un activo nuevo **supera y desecha** la corrida en vuelo (`fps-atlas.ts:118-123`, incidente #390). Nueve llamadas se pisarían entre sí y podrían tirar justo la del tile del jugador, que es lo que arregló el guion 60. La restauración de los no activos es un camino distinto del de «activar», y la decisión de quién la pide pertenece a core (criterio 5).

## El día después

- **Para quien juega:** al reanudar sobre un mundo pre-generado ve su alrededor pintado. En partida viva, el vecino pre-generado que acaba de aceptar se pinta antes de cruzar la frontera. Cero créditos en los dos casos.
- **Se vuelve más difícil:** la política de atlas deja de ser «uno a la vez». Hay que decir qué pasa con una restauración de vecino en vuelo cuando el activo cambia; eso es del arquitecto.
- **Cosas que alguien podría olvidar borrar:** la redacción del guion 156 §5 («deja 8 vecinos en clay para siempre … el menú acierta al ofrecerlo») y la etiqueta de `:427`. Con el arreglo, esas ocho filas solo aparecen si la librería no tiene el arte, y el 156 deja de contar lo que pasa.
- **El menú sigue diciendo la verdad:** un vecino sin arte en la librería sigue en clay y sigue en `tilesSinAtlas`. Pintarlo sigue siendo decisión del jugador (G/menú) o de entrar en el tile.

## Conflictos

- **Cola de issues:** `gh issue list` no trae otro issue de atlas ni de resume. #578 (escenas conservadas, abierto) toca el snapshot, no el atlas. #492 y #579 están cerrados.
- **Tandas hermanas** (#716, #709, #704, #700, #697): ninguna toca `fps-atlas.ts`, `carga-de-tile.ts` ni el resume de `main.ts`. Hay riesgo con `banco-ficheros.ts` (#704) solo si el guion nuevo necesita un `qa/lib/` nuevo.
- **Candados:** ninguno lo impide. La regla nueva («no activo → solo restaura») es lógica de gasto y va a core, junto a `PoliticaDeAtlas`.

## Coste contra valor

Coste moderado: una rama nueva en la política de atlas de core, su llamada desde `carga-de-tile.ts`, un guion y la corrección de la prosa del 156. Valor: el primer fotograma de cada partida reanudada en un mundo pre-generado, que hoy es el caso normal de Miravanda. No hacer nada deja un mundo que parece roto sin coste que lo justifique, porque el arte ya está pagado. La vía de reinstalar solo el activo sale más barata de escribir, pero cambia un síntoma visual por uno de control (Y/N y un muro sobre terreno ya pisado).

## Qué cambiaría en `requisitos.md` (para pegar tal cual)

> **Reencuadre del crítico (2026-09-23).** El defecto no es del resume: ningún tile instalado que no sea el activo recupera su arte ya pagado, porque solo `onActiveTile` pide atlas. Pasa también en partida viva, con el vecino pre-generado aceptado por prefetch (`scene_loaded` → `addTile` sin activar). **Decisión:** los tiles instalados que no son el activo RESTAURAN su arte ya pagado (memoria → mapping → librería con `resolve_only`) y NO pintan nunca, ni con Imagen IA encendida; pintar sigue siendo solo del tile activo o del menú. **Se descarta** reinstalar solo el activo al reanudar: la frontera usa el `tileStore` del cliente para decidir qué falta, así que el jugador recibiría Y/N y la retención de colisión en tiles que ya pisó (y se romperían los supuestos de los guiones 49 y 60).
>
> Criterios que sustituyen al 1 y al 2:
> 1. Al reanudar sobre el anillo 3×3 pre-generado, con el arte en la librería, los nueve tiles acaban texturados, y el tile del jugador se texturiza igual que hoy (guion 60 verde).
> 2. Ningún tile no activo genera una petición `/generate_surface_atlas` sin `resolve_only`, tampoco con Imagen IA encendida. Se afirma en el guion con la red capturada.
> 3. En partida viva, un vecino pre-generado que llega por prefetch recupera su arte antes de que el jugador cruce la frontera.
> 4. La decisión «no activo → solo restaura» vive en core, junto a `PoliticaDeAtlas`. Restaurar un vecino no puede desechar ni retrasar la corrida del tile activo.
> 5. La prosa del guion 156 §5 y su etiqueta (`:427`) se corrigen: las filas de vecinos solo son arte pendiente cuando la librería no lo tiene.
>
> El guion nuevo (criterio 3 original) se prueba en negativo: con el código de hoy, los vecinos salen en `tilesSinAtlas`.
