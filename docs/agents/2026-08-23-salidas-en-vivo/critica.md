# REENCUADRADA — el agujero es real, pero no es un retraso: es un valor derivado que se hornea en el save

El issue ataca por el sitio correcto; corrijo el **alcance en las dos direcciones**: el fallo
sobrevive a reanudar la partida (más grande), y dos de los tres «hermanos» no existen (más pequeño).

## El problema real, en una frase

El motor te promete un destino en el diálogo y el juego no te deja ir: **el panel «Salidas» pinta
una copia congelada de los links del lugar, sellada en la última difusión de escena**, y desde la
PR #178 ese panel es la única vía viva de viaje.

La solución que propone el issue («que aparezca sin viajar») ataca el problema. Pero el issue lo
encuadra como *latencia* («hasta que se re-difunde una escena»), y no lo es: es una **caché
derivada con un solo invalidador**, y ese invalidador no se dispara ni al reanudar.

## La premisa, afirmación por afirmación

| Afirmación del issue / requisitos | Verificación |
|---|---|
| `enrichSceneWithExits` solo se invoca desde `broadcastScene` | **CIERTA**. Definición en `nefan-core/bridge/context.ts:201`; única llamada en `context.ts:241`, dentro de `broadcastScene` |
| `POST /map/link` se queda en `markDirty()` sin difundir | **CIERTA**. `nefan-core/bridge/state-http-server.ts:364-374`: `wm.addLink` → `narrative.markDirty()` → `mutated(...)`. Ni un broadcast |
| El cliente actualiza `currentExits` en un único sitio | **CIERTA**. `nefan-html/src/main.ts:1040-1041`, dentro de `setActiveClientTile`. No hay otro `setExits` (el único otro uso del panel es `onTravel`, `main.ts:2010`) |
| Sigue existiendo `onProgress` como hook State API → WS | **CIERTA**. Declarado en `state-http-server.ts:85`, cableado en `bridge/ws-server.ts:138` a un `broadcastNarrative`. El molde existe |
| Hermano: `map_add_trigger` | **FALSA como hermano**. `enrichSceneWithExits` solo lee `getOutgoingLinks` (`context.ts:206`); los triggers no entran en `exits`. Fuera de alcance, y con razón |
| Hermano: `npc_move_to_place` | **FALSA como hermano**. Las posiciones de NPC viajan por el `state_update` del sim, no por `exits` |
| Hermano: `map_upsert_place` | **CIERTA, y es el único**. El `name` de cada salida se resuelve **en la difusión** (`context.ts:209`, `worldMap.get(targetId)?.name`). Renombrar un lugar deja el botón con el nombre viejo. Mismo agujero, mismo arreglo |
| «hasta que se re-difunde una escena» | **INCOMPLETA — y esto es lo que reencuadra la tarea.** Las `exits` se **persisten**: `enrichSceneWithExits` muta la escena por referencia y `bridge/handlers/bootstrap-tile.ts:117` lo dice literalmente («broadcastScene mutated the scene with `exits` — persist them»). En el resume, `sessionDataForClient` (`context.ts:297`) **solo normaliza, no re-enriquece**, `handleResumeSession` **no re-difunde** la escena activa (`bridge/handlers/session.ts:551`, el re-bootstrap solo entra si `scenes_loaded` está vacío) y el cliente lee esa copia tal cual (`main.ts:2427-2444` → `setActiveClientTile`). **Salir del juego y volver a entrar no arregla el panel** |
| «Confirmado en vivo por QA» | **CIERTA**. Traza reproducida en `docs/agents/2026-08-20-retirar-escena-suelta/qa.md:154-166` por la misma vía del motor |
| «pesa más desde la PR #178» | **CIERTA**. El viaje a un lugar no realizado entra por `travelPanel.onTravel` y no hay otra puerta: `runPlaceTravel` (`bridge/handlers/scene.ts:145`) se alcanza desde ahí |

Dos cosas más que **cierran** puertas: el único escritor de links vivo es `POST /map/link`
(`world-map.ts:133` no tiene más llamadores fuera de tests) y `removeLink` (`world-map.ts:170`)
no tiene endpoint ni llamador — hoy las salidas solo crecen, nadie resuelve un botón que
desaparece. Y el hermano que QA dejó pendiente (panel apagado sin `place_id`) **ya está cerrado**:
`resolveBootstrapPlaceId` + fail-loud, `nefan-core/test/bootstrap-place.test.ts:1-11`.

## El día después

- **Para quien juega**: el motor deja de mentir. Sin esto, la promesa del diálogo es una puerta
  pintada en la pared.
- **Qué se vuelve más difícil**: el cliente pasa a tener **dos fuentes de salidas** — las selladas
  en `entry.scene.exits` y el empujón nuevo. Es la misma clase de divergencia que persiguen
  `cliente-no-convierte-celdas-a-metros` y `solo-el-bridge-normaliza-la-escena`. Si la copia del
  save sigue viva sin invalidarse, el arreglo tapa el caso del diálogo y deja el del resume.
- **Qué hay que borrar y nadie borrará**: código no, pero sí la **idea** de que `scene.exits` es
  parte de la escena. Es un derivado del world map disfrazado de dato de escena; por eso se pudre.
- **Qué habría que no hacer**: **no** arreglarlo re-difundiendo la escena entera. Un `scene_init`
  del tile activo vuelve a pasar por `setActiveClientTile` → `fpsAtlasController.onActiveTile`
  (`main.ts:1035`) y por `addEnemies`: se paga el atlas y se mueve el mundo para pintar un botón.
- **Qué parecerá arbitrario en un mes**: que `exits` esté en el save; sin un comentario, quien lea `bootstrap-tile.ts:117` lo dará por intencional.

## Conflictos

- **#225 (partir `handle` del State API por concepto) — dependencia de orden, no contradicción.**
  Los tres endpoints de mapa viven dentro de `handle` (`state-http-server.ts:340-388`), la función
  de complejidad 158 por la que existen los 10 puntos de holgura del gate de CRAP
  (`data/contract/quality-thresholds.json:6`). Meter la lógica de difusión **dentro** de `handle`
  la engorda justo antes de partirla. El molde `onProgress` (una opción inyectada, `handle` solo
  la invoca) evita el choque: es un argumento más, no una rama más.
- **#180 (el error de viaje enseña un HTTP 500)**: mismo panel, hallazgo hermano de la misma QA,
  **sin solapamiento** — uno es el listado, el otro el overlay de fallo. No hay que fusionarlos.
- **CLAUDE.md / arch-rules / `git log`**: sin choque. La lógica va al bridge, el cliente repinta,
  y nada tocó `context.ts` ni `state-http-server.ts` en este sentido desde #178.

## Coste contra valor

Barato y vale la pena. El molde ya existe (`onProgress`), el panel ya sabe repintarse
(`travel-panel.ts:22`) y el world map ya sabe quién sale de dónde. **No hacerlo nunca** no es
defendible: desde #178 el panel es la única puerta de viaje, así que un link que no llega al panel
es contenido narrativo inalcanzable — créditos gastados en prometer lo que el juego no cumple. Lo
único que encarece la tarea es la copia del save; si se ignora, vuelve como «el bug al reanudar».

## Qué le cambiaría a `requisitos.md`

Sustituir el bloque de criterios de aceptación y el de verificación por esto:

> ## Criterios de aceptación de la tanda
>
> - Crear un `map_link` a mitad de diálogo hace aparecer el destino en el panel **sin viajar**.
> - **Cerrar la partida y reanudarla mantiene el destino en el panel.** Hoy no: las `exits` se
>   sellan en la escena y se persisten (`bridge/handlers/bootstrap-tile.ts:117`), y el resume
>   sirve esa copia sin re-enriquecer (`context.ts:297`, `handlers/session.ts:551`).
> - **Renombrar un lugar con `map_upsert_place` actualiza la etiqueta del botón.** Es el mismo
>   agujero: el `name` se resuelve en la difusión (`context.ts:209`). `map_add_trigger` y
>   `npc_move_to_place` **no** están afectados — verificado, no hay más hermanos.
> - El panel no se refresca re-difundiendo la escena entera (pagaría atlas y re-spawn de enemigos).
> - La lógica vive en el bridge y el cliente solo repinta. **Los candados que aplican son
>   `cliente-no-convierte-celdas-a-metros` y `solo-el-bridge-normaliza-la-escena`; el candado
>   `cliente-solo-pinta` que citaban los requisitos NO existe** (`arch-rules.json` no tiene ese id).
> - Guion ejecutable en `qa/guiones/`, probado en negativo, que cubra **los dos** casos: link nuevo
>   sin viajar, y link nuevo que sobrevive a un resume.

Y añadir al issue #179, tal cual:

> **Reencuadre (crítico, 2026-08-23):** no es un retraso hasta la siguiente difusión. Las `exits`
> son un derivado del world map que se **sella en la escena y se persiste** en el save
> (`bootstrap-tile.ts:117`), y el resume las sirve sin re-enriquecer (`context.ts:297`,
> `session.ts:551`): cerrar y reanudar la partida **no** arregla el panel. Único hermano real:
> renombrar un lugar con `map_upsert_place` deja la etiqueta vieja, porque el `name` se resuelve
> en la difusión (`context.ts:209`). `map_add_trigger` y `npc_move_to_place` no están afectados.
