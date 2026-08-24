# Un `map_link` nuevo aparece en «Salidas» (#179)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

## El issue

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/179`.

Resumen: el motor narrativo puede crear un `map_link` durante un diálogo. Ese destino **no
aparece en el panel «Salidas»** hasta que se re-difunde una escena. Confirmado en vivo por QA
por la misma vía que usa el motor: `["molino"]` → `["molino","qa_forja"]` solo tras viajar y
volver.

Efecto para quien juega, que es lo que importa: **el motor te promete en el diálogo que puedes
ir a la forja, y la forja no está en el panel**.

El issue señala que es anterior a la PR #178 pero pesa más desde ella, porque el panel de
salidas pasó a ser la vía viva de viaje.

## Lo que hay que verificar, no dar por bueno

- La cadena: ¿`enrichSceneWithExits` (`bridge/context.ts`) se invoca solo desde
  `broadcastScene`? ¿`POST /map/link` (`bridge/state-http-server.ts`) se queda de verdad en
  `markDirty()` sin difundir nada?
- En el cliente, ¿`currentExits` se actualiza en un único sitio (`nefan-html/src/main.ts`,
  dentro de `setActiveClientTile`)?
- ¿Sigue existiendo `onProgress` (`bridge/ws-server.ts`) como hook del State API hacia el WS?
  Es el molde que haría este arreglo pequeño en vez de grande.
- ¿Hay **otros** cambios de mapa con el mismo agujero (`map_upsert_place`, `map_add_trigger`,
  `npc_move_to_place`)? Si los hay, el issue es más pequeño de lo que debería: arreglar solo
  `map_link` deja hermanos rotos, y eso es material tuyo.

## Criterios de aceptación de la tanda — REENCUADRADOS por el crítico (2026-08-23)

Ver `critica.md`. Veredicto: **REENCUADRADA**. El fallo no es un retraso hasta la siguiente
difusión: las `exits` son un derivado del world map que se **sella en la escena y se persiste**
en el save.

- Crear un `map_link` a mitad de diálogo hace aparecer el destino en el panel **sin viajar**.
- **Cerrar la partida y reanudarla mantiene el destino en el panel.** Hoy no: las `exits` se
  sellan en la escena y se persisten (`bridge/handlers/bootstrap-tile.ts:117`), y el resume
  sirve esa copia sin re-enriquecer (`bridge/context.ts:297`, `bridge/handlers/session.ts:551`).
- **Renombrar un lugar con `map_upsert_place` actualiza la etiqueta del botón.** Es el mismo
  agujero: el `name` se resuelve en la difusión (`bridge/context.ts:209`). `map_add_trigger` y
  `npc_move_to_place` **no** están afectados — verificado, no hay más hermanos.
- El panel no se refresca re-difundiendo la escena entera: un `scene_init` del tile activo
  pagaría el atlas y el re-spawn de enemigos para pintar un botón.
- La lógica vive en el bridge y el cliente solo repinta. Los candados que aplican son
  `cliente-no-convierte-celdas-a-metros` y `solo-el-bridge-normaliza-la-escena`. (El candado
  `cliente-solo-pinta` que citaba la versión anterior de este documento **no existe**: me lo
  inventé, y el crítico lo cazó.)
- Guion ejecutable en `qa/guiones/`, probado en negativo, que cubra **los dos** casos: link nuevo
  sin viajar, y link nuevo que sobrevive a un resume.

## Orden respecto a #225

Los tres endpoints de mapa viven dentro de `handle` (`bridge/state-http-server.ts`), la función
de complejidad 158 que #225 va a partir. Meter la difusión **dentro** de `handle` la engorda
justo antes de partirla: el molde `onProgress` (una opción inyectada) evita el choque.

## Fuera de alcance

Rediseñar el panel de salidas o el modelo de viaje. Los triggers de mapa que no cambien las
salidas visibles.

## Preguntas abiertas

Ninguna para el usuario, salvo que tú determines que la hay.
