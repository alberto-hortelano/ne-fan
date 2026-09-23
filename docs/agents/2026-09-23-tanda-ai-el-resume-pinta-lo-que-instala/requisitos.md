# Requisitos — tanda AI: al reanudar no quedan vecinos en clay para siempre (#714)

## Petición literal del usuario

> «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

El coordinador eligió este issue para la tanda. Sesión AUTÓNOMA: el usuario no está para dar visto bueno a mitad del ciclo; lo que haya que preguntarle se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## El issue, verbatim (cuerpo + comentarios, descargado hoy de GitHub)

### #714

> Al reanudar sobre un mundo pre-generado, el jugador ve ocho tiles vecinos en clay alrededor de uno pintado: el resume reinstala los nueve tiles y el atlas solo lo pide el activo
> 
> Sale del arreglo del guion 156 (#712, 2026-09-21), leyendo el código y viéndolo en corrida.
> 
> ## El hecho
> 
> Al REANUDAR una partida cuyo save trae el anillo 3×3 (mundo pre-generado), `main.ts` reinstala TODOS los tiles del save («TODOS los tiles del save se re-añaden»), pero el atlas de superficies solo lo pide el tile ACTIVO (`FpsAtlasController.onActiveTile`). Resultado: el tile que pisa el jugador se texturiza y los ocho vecinos se quedan en clay indefinidamente. En la partida VIVA no pasa, porque el cliente solo tiene el tile en el que está y los vecinos llegan y se texturizan al entrar.
> 
> El menú de desarrollo lo ofrece bien (ocho filas de atlas pendiente, arte pendiente de verdad); lo que se ve a medio pintar es la ESCENA, y ningún guion lo mira (el 156 lo declara ahora como estado esperado del menú, no como corrección visual).
> 
> ## Lo que hay que decidir
> 
> - ¿Debe el resume pedir el atlas de los tiles vecinos VISIBLES (los que el jugador ve desde su tile), o solo del activo, como en partida viva (donde los vecinos ni siquiera están instalados)?
> - Si es lo segundo, ¿por qué el resume instala nueve tiles cuando la partida viva tiene uno? Reinstalar solo el activo (y dejar que los vecinos entren como en vivo) alinearía los dos caminos.
> 
> Un guion que reanude sobre mundo pre-generado y mire el estado texturado de los vecinos visibles (`fps()`/`__nefan.tiles`) es el candado, sea cual sea la decisión.
> 
> Relacionado: #712, #492, #579 (partida nueva en maqueta), #578 (escenas conservadas).

## Criterios de aceptación

1. Al REANUDAR una partida cuyo save trae el anillo 3×3 de un mundo pre-generado, el jugador no ve tiles vecinos visibles en clay indefinidamente mientras el activo está pintado: o se texturizan, o no están instalados (como en partida viva). La decisión entre las dos vías la argumenta el crítico/arquitecto; por defecto se prefiere ALINEAR el resume con la partida viva (un solo camino), salvo que la medida diga que eso rompe algo que el jugador ve.
2. Si se elige pedir atlas de vecinos: NO se gasta arte que la partida viva no gastaría (ojo: pedir atlas puede costar créditos con Imagen IA encendida). Si esa vía gasta más, decirlo con número.
3. Un guion ejecutable en `qa/guiones/` que reanude sobre mundo pre-generado y mire el estado texturado/instalado de los vecinos (`fps()` / `__nefan.tiles`), probado en negativo (con el código de hoy sale rojo).
4. El guion 156 y los de resume siguen verdes; el menú de desarrollo sigue diciendo la verdad del arte pendiente.
5. Lógica en core / bridge, el cliente solo pinta (candados de `arch-rules.json`).

## Contexto del coordinador

- Worktree: `/home/al/code/ne-fan-tanda-ai`, rama `feature/tanda-ai`, nacida de `main` = `83ea6046`. Todo el trabajo va en ese árbol, nunca en `/home/al/code/ne-fan`.
- Hay OTRAS cinco tandas en paralelo en worktrees hermanos (`ne-fan-tanda-{ah,ai,ak,al,am,an}`): #716 detector de saltos, #714 resume con tiles en clay, #709 ruff local, #704 un solo barrido del banco, #700 buscar con veces===1, #697 describe que lanza. Si esta tanda toca un fichero que otra también tocará con probabilidad (p. ej. `nefan-core/test/banco-ficheros.ts`, `package.json`, `ci.yml`), dilo en tu documento.
- Si hay que levantar un stack (qa/run.mjs), NUNCA matar procesos ajenos; `qa/run.mjs` elige bloque libre solo.
- Nada de gasto de créditos de imagen: preset `e2e-sin-creditos` / motor falso.
- Mutación: `npm run mutacion -- local <id>` si cabe en el tope; si no, se pide y no se espera.
- Commits intermedios en la rama (hubo límites de sesión que mataron agentes con trabajo sin commitear).

## Fuera de alcance

- Lo que el propio issue declara fuera.
- Issues vecinos que aparezcan: se ANOTAN (propuesta de issue nuevo en el documento), no se arreglan.

## Reencuadre del crítico, aceptado por el coordinador (2026-09-23, sesión autónoma)

El coordinador acepta la vía «un tile no activo solo RESTAURA atlas (resolve_only, 0 $)» frente a la suposición por defecto de arriba (alinear reinstalando solo el activo): la crítica demuestra que la premisa «en partida viva no pasa» es falsa y que reinstalar solo el activo rompería la frontera. Queda apuntado como decisión a confirmar por el usuario al cierre. Lo que sigue PREVALECE sobre los criterios de arriba.


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
