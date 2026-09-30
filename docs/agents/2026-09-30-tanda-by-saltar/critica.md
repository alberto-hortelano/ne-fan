**REENCUADRADA** — el salto que pasa lo bajo es real y barato, pero NO exige que «la colisión sepa la altura»: basta un segundo grid del plan, solo para el jugador en el aire, y nada fuera del cliente cambia.

## El problema real, en una frase

El jugador en primera persona no puede superar un obstáculo que visualmente se supera (una cerca, un murete, un banco), y moverse se siente más pobre que en cualquier fps.

La solución que propone el criterio del coordinador ataca eso. Lo que sobra es el encuadre de los requisitos, punto 1: «exige que la colisión sepa la ALTURA» suena a meter altura en `TerrainCollider`, en el bridge y en el validador. No hace falta (ver el día después).

## La premisa, afirmación por afirmación

- **«Saltar» = el salto del jugador.** Es plausible: el typewriter ya se salta con cualquier tecla de acción (`nefan-html/src/ui/dialogue-panel.ts:85-92`), así que «que pueda saltar» no puede pedir eso. Ahora bien, no se puede verificar contra el código: si hay duda, cuesta una pregunta al usuario.
- **«No hay salto».** Cierto: `keyboard-input-provider.ts:73/106` solo tiene Shift/sprint, y ningún `Space` en `input/`.
- **«La colisión nunca usa la altura».** Cierto. El plan se rasteriza a un grid binario `S`/`g` (`blueprint/plan-collision.ts:44-54`), y la MISMA función la usan el cliente (`world/collision.ts:193`), el bridge para los NPC (`bridge/sim-collision.ts:181`) y el validador (`scene/scene-validate.ts:424`). `ObstaculoAabb` no tiene altura (`simulation/obstaculos-del-jugador.ts:82-94`).
- **«El cliente es autoritativo».** Cierto (`terrain-collision.ts:21-22`). El paso es de core (`simulation/paso-del-jugador.ts`) y recibe `solido` como callback (`main.ts:582-589`). Esa es la costura exacta donde entra un salto.
- **La altura YA existe por volumen, declarada y con defecto.** `wall.h` vale 5 celdas por defecto = 2,5 m (`greybox/volume-prims.ts:302`); `prop.h` vale 2 = 1 m (`:421`). **«Bajo» ya está definido, pero en el render**: un `wall` con `h ≤ 2,4` celdas (1,2 m) se pinta como valla (`blueprint/fps-detail.ts:336-346`, con un filtro por `label` que excluye piedra/tapia).
- **«Espacio choca con el diálogo».** Falso en la práctica. El panel se come Espacio con `stopImmediatePropagation` (`dialogue-panel.ts:109-112`), y el paso no corre con el diálogo abierto (`main.ts:349`, `:570`). Con LMB no hay choque. Espacio está libre.

## El día después

- **Para quien juega**: salta las cercas y los muretes y no salta casas, torres, árboles ni agua. Eso es lo que espera.
- **Lo que se abre, en el cliente y sin contrato nuevo**: un segundo collider del plan por tile, derivado con la MISMA `planCollisionGrid` sobre `ground` + los volúmenes que NO son bajos. El agua (`ground`) sigue siempre dentro, así que no se cruza saltando sin que nadie tenga que decidirlo. En el aire, `solido` consulta ese grid y no el completo. «Salir sí, entrar no» (`salida-del-solido.ts`) cubre el aterrizaje encima de una valla.
- **Lo que NO cambia**: el bridge, los NPC, el A* (#779), el validador, el save (el salto es transitorio y la posición sigue siendo XZ) y el contrato del motor.
- **Lo que se vuelve más difícil o cambia de verdad**:
  - **El validador pasa a ser una cota inferior.** Garantiza «se recorre andando», y saltar solo añade alcance. No se rompe, pero deja de describir lo que el jugador puede hacer.
  - **Jugador y NPC divergen a propósito.** El comentario de `plan-collision.ts:1-10` («colisionan EXACTAMENTE igual») deja de ser cierto en el aire, y hay que decirlo allí. Consecuencia jugable: una cerca te salva de un enemigo cuerpo a cuerpo. El A* no encuentra camino, el NPC se para y decide el motor (#779). Es lo normal en el género, pero es una decisión del usuario.
  - **La cámara bajo el gate.** `PASO_LIBRE_M` supone los ojos fijos a 1,6 m (`terrain-collision.ts:44-55`), y el dintel se dimensiona con eso (`volume-prims.ts:371-379`). Un salto bajo el arco mete la cámara en el dintel. O se acepta, o `PASO_LIBRE_M` incluye el apogeo del salto.
  - **CLAUDE.md, sección Altura**: «La colisión NUNCA usa la altura» pasa a ser falso para el jugador en el aire. Se corrige el mismo día.
- **Lo que parecerá arbitrario dentro de un mes**: un umbral de «bajo» distinto del de la valla pintada. Hoy es un literal `2.4` en `fps-detail.ts:339`. Si el salto usa otro número, habrá vallas que se pintan como saltables y no se saltan, o al revés. **Tiene que ser UNA constante de core** que lean las dos cosas. Y la altura efectiva de cada tipo tiene que salir de los MISMOS defectos que `volume-prims.ts`, no de una tabla copiada.

## Conflictos

- **BX** toca `dialogue-panel.ts`. Esta tarea NO debe tocarlo: Espacio ya está resuelto por la guarda del paso. Si BX cambia qué teclas consume el panel, que no suelte Espacio al mundo con el diálogo abierto.
- **#788 / BV**: no hay contradicción. #788 arregló que una cerca fina se atravesara ANDANDO, y eso sigue igual. Saltarla es otra cosa, y es la que pide ahora el usuario.
- **Cajas de objetos que el motor spawnea** (`aabbBloquea`, sin altura): quedan fuera del tramo mínimo y siguen macizas en el aire. Hay que decirlo; no se tapa.
- No hay issue abierto que se solape (`gh issue list`: #790, #361-#363).

## Coste contra valor

- **Salto visual** (solo la cámara): un bote en core + el offset en `fps-gl.ts:1551` + la tecla. Unas 50 líneas y 3 ficheros. **No se debe hacer solo**: es el «bote de cámara» que el propio coordinador rechaza. Además miente: la valla se ve saltable y no se salta.
- **Salto que pasa lo bajo del PLAN**: lo anterior más la altura efectiva por volumen en core, el umbral compartido con `fps-detail`, el segundo collider por tile en `tile-store`/`collision.ts` y el `solido` dependiente del aire. Unas 200-250 líneas y 6-7 ficheros. Sin contrato, sin bridge, sin save, sin créditos. Es proporcionado.
- **No hacerlo nunca**: el usuario lo ha pedido jugando. No es deuda. Es lo único de la tanda que cambia cómo se siente moverse.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Alcance (tras la crítica).** El salto es del JUGADOR y pasa por encima de los volúmenes BAJOS del plan. «Bajo» es UNA constante de core, la misma que hoy decide qué `wall` se pinta como valla (`fps-detail.ts`, `h ≤ 2,4` celdas), y la altura de cada volumen sale de los defectos de `volume-prims.ts`, no de una tabla aparte. El agua (`ground`) bloquea siempre. Las cajas de objetos spawneados por el motor NO se saltan en este tramo (se dice). El bridge, los NPC, el A*, `scene-validate` y el save no cambian: el validador sigue garantizando «se recorre andando», que es una cota inferior. El comentario de `plan-collision.ts` y la sección «Altura» de CLAUDE.md se corrigen para decir que el jugador en el aire usa un segundo grid. La física del salto (altura, duración) vive en `combat_config.json`/core, y la tecla es Espacio (ya no la ve el mundo con el diálogo abierto). Decisión para el usuario: saltar una cerca te salva de un enemigo cuerpo a cuerpo. Riesgo que hay que verificar: con el apogeo del salto, la cámara no puede entrar en el dintel de un gate (`PASO_LIBRE_M`). NO se entrega un salto solo visual.
