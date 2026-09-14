# Crítica · Tanda C «Lo que se ve del mundo»

**REENCUADRADA** — las tres decisiones son vigentes y su premisa aguanta contra el código de hoy, pero dos piezas están escritas de forma que se rompen solas: **4.3 «se oculta el más lejano» apaga el rótulo de lo que estás apuntando** (`pickAimTarget` gana por ángulo, no por distancia) y **#451 no dice qué pasa cuando la injugable ES la de entrada**, que es el único caso que (b) no puede servir. Y el chip conectado no escribe «Connected»: escribe «Bridge».

| Pieza | Veredicto |
|---|---|
| #484 · 4.1 hostil en `--nf-danger` | **VIGENTE** |
| #484 · 4.2 se ve a través de la pared | **VIGENTE** · cero código; falta decidir DÓNDE se escribe |
| #484 · 4.3 se oculta el más lejano | **REENCUADRADA** · falta la excepción del enfocado; choca con el guion 79 |
| #478 el bridge que llega tarde | **VIGENTE** · dos literales que corregir y un aserto del guion 78 que declarar |
| #451 el snapshot con un tile malo | **REENCUADRADA** · alcance incompleto: la entrada, y quién destruye las 8 buenas |
| #480 / #481 | **fuera**: no caen gratis (justificado abajo) |

## El problema real, una frase por pieza

- **#484**: de lejos no sabes a quién puedes pegar, y dos alineados se tapan el nombre. La solución ataca eso; la oclusión —que no se ataca— se decidió dejar como está.
- **#478**: el cliente que arrancó sin bridge no tiene NINGÚN botón que le devuelva al juego, y la pantalla afirma lo contrario de lo que pasa. (b) ataca las dos mitades.
- **#451**: `scene-validate` se endureció cinco veces en dos semanas y cada endurecimiento deja injugable TODO snapshot en disco; el coste no es «un tile malo», es regenerar el mundo con el motor real.

## La premisa, afirmación por afirmación

| # | Afirmación | Verificación |
|---|---|---|
| 1 | El rótulo del hostil es la misma caja crema que el del tabernero | **CIERTA.** `game-ui.css:488-501` tiene UNA regla `.world-label` y una sola variante, `[data-focus="true"]` (`:503-507`). Nada mira la hostilidad |
| 2 | …y ese dato no llega al rótulo | **MATIZ: llega y se tira.** `MundoDelCliente` guarda `#npcs` y `#enemigos` aparte; el getter los aplana (`mundo-del-cliente.ts:64-65`) y `etiquetas-del-mundo.ts:86` consume el aplanado. La pieza es barata |
| 3 | `--nf-danger` ya existe | **CIERTA**, y es del PACK (`ui-theme.ts` campo `danger` → `theme.ts:26`). Un literal de color lo rechaza `game-ui-css-sin-literales-de-color` |
| 4 | Los rótulos atraviesan paredes | **CIERTA.** `world-labels.ts:47-75` proyecta, atenúa y ordena en z; cero geometría. `fps-gl.ts:1027-1037` solo devuelve `null` para lo que está detrás del ojo |
| 5 | Dos alineados se pisan | **CIERTA.** `world-labels.ts:71` los ordena, no los separa (medido en `qa-2.md:69`, captura `79-…-01`) |
| 6 | #483 cerrado; queda backlog visual de #484 | **CIERTA**, pero de los CINCO puntos del cuerpo la tanda contesta 1-3. El 4 (rótulo fuera de encuadre que sigue en el DOM: real, `sync` no recorta por viewport) y el 5 (ruido del selector «Room» con partida viva) siguen vivos y **sin destino** |
| 7 | Llega el bridge → el muro se retira y te quedas en el visor | **CIERTA y trazada:** `bridge-client.ts:127-133` (`onopen` → `resuelto("bridge")`) → `muro-de-carga.ts:256-259`. Te quedas en el visor porque `bootstrap()` ya retornó (`main.ts:1170-1175`) y a `runTitleFlow` solo se entra por el camino de éxito o por `volverAlTitulo()`, que cuelga del botón «Volver al título» — **oculto aquí**, porque el aviso pinta con la salida por defecto `"cerrar"` (`muro-de-carga.ts:183, 265`) |
| 8 | El chip dice «Disconnected» con el socket abierto | **CIERTA; el literal del enunciado, no.** La mentira está en `main.ts:1174` (última escritura) y en que las suscripciones que la corregirían (`:1179-1180`) solo existen en la rama de éxito; `ViewerGameClient.on()` es un no-op (`game-client.ts:270`). **Conectado escribe «Bridge»** (`main.ts:543-545`) |
| 9 | `loadWorldSnapshot` rechaza el snapshot entero desde #302 | **CIERTA** (`world-snapshot.ts:130-146`). Pero **quien destruye las 8 buenas es otro**: el bridge degrada al bootstrap vivo (`session.ts:505-521`) y al acabar `writeSessionSnapshot` reescribe el fichero con lo que haya en `scenes_loaded` —una escena— (`bridge/context.ts:145-165`). Un (b) que no pase por ahí sigue perdiéndolas |
| 10 | La entrada se valida distinto del anillo | **CIERTA**: `bootstrap: id === entry_scene_id` (`world-snapshot.ts:133`); la entrada paga además el spawn del jugador |

## El día después

- **4.1 y 4.3 comparten un estado sin decidir que se ve en la primera partida: el hostil ENFOCADO.** Hoy `[data-focus="true"]` pisa el color (`game-ui.css:503`), así que el rojo de peligro desaparecería justo al apuntar. Y con 4.3, `pickAimTarget` gana por **menor desviación angular, no por distancia** (`aim.ts:127-131`): el enfocado puede ser el LEJANO de dos alineados, con lo que «ocultar el más lejano» apaga el rótulo de aquello a lo que apuntas y deja la mirilla encendida sobre un bulto anónimo — el defecto exacto que `etiquetas-del-mundo.ts:81-85` vino a cerrar.
- **La 4.2 no se sostiene sola.** Hoy hay prosa COMMITEADA que empuja a lo contrario: `docs/agents/2026-09-06-lo-que-le-queda-a-main/qa-2.md:68` la lista como hallazgo y `:80` la juzga como director de arte («rótulos que no respetan la oclusión… parece pegado al cristal»), además del punto 1 del cuerpo de #484. Quien lea eso dentro de tres meses la «arregla».
- **Dónde debe quedar escrita la 4.2**, por orden de lo que aguanta: **(1) comentario en `ui/world-labels.ts` junto a `FADE_FROM_M`** —es el fichero que abre quien vaya a meter el raycast, y ahí ya vive la explicación del `zIndex`—; **(2) `docs/arquitectura/vistas.md:124-126`**, el documento que CLAUDE.md manda leer al tocar el renderer; **(3) el cierre de #484**, con fecha. Un candado en negativo («el de detrás de la pared SIGUE rotulado») pide guion de navegador y fixture con muro: más caro que la tanda entera. No lo recomiendo salvo que el 79 lo absorba sin caso nuevo.
- **#478**: desaparece el único estado del cliente cuya única salida es `F5`. Si «Reintentar» se hace como tercera salida del overlay, entra en `SalidaDelOverlay` (`status-rotulo.ts:56`), contrato de CORE. Nada que borrar.
- **#451**: `loadWorldSnapshot` deja de ser puerta booleana; sus otros dos llamantes (`worldSnapshotStatus` y `handleGetWorldSnapshot`, `style-apply.ts:32`) tienen que decidir qué significa «parcial», o el chip del título y el plan de estilo dirán cosas distintas del mismo fichero.

## Conflictos

1. **Guion 78 (`:170-183`) con #478.** Afirma que el muro **se retira** al llegar el bridge y que **«se queda retirado»** (relee a 1,5 s). Un muro con «Reintentar» al conectar pone rojo el segundo. #478 anticipa que el 78 *gana* un aserto, no que pierda ese: decidirlo en el plan, no en la batería.
2. **Guion 79 (`:185-208`) con la 4.3.** Su aserto 1a exige los rótulos del tabernero Y del bandido a la vez, y la captura de ese mismo instante (`79-…-01`, primer `ctx.shot`, línea 213) es la que `qa-2.md:69` cita como ejemplo de solapamiento. Si «ocultar» = no emitir el nodo, ese aserto se pone rojo por la corrección. **Medir el solape en píxeles antes de diseñar.**
3. **Tests de #302.** `world-snapshot.test.ts:476` afirma literalmente la conducta que (b) cambia y hay que reescribirlo — no es aflojar #302, es cambiar la GRANULARIDAD del rechazo (lo que se sirve sigue pasando `validateScene`). Los de `:446` y `:499` usan un snapshot de **solo entrada** y sobreviven intactos **si** la respuesta de abajo es «la entrada, como hoy».
4. **Tanda A, en un fichero**: `bridge/handlers/style-apply.ts` es el sujeto de #513 y el llamante de `loadWorldSnapshot` (`:32`). Orden: **A lo toca primero** y #451 se rebasa encima; o #451 no cambia la firma actual. No hay más solape — el modo de imagen de A vive en `ui/graphics-mode.ts`, `ui/mode-labels.ts` y `ui/titulo/*`, y C no entra ahí.
5. **Tanda B**: ningún fichero común, pero #532 cambia QUÉ se rotula (filtro de `etiquetas-del-mundo.ts:93-95`) y #529 QUIÉN entra como enemigo. **La QA de C debe correr sobre el mundo posterior a B**, o mide otra escena.

## Coste contra valor

- **4.1 + 4.3**: un módulo de cliente, el dato ya viene separado, y el 79 ya pone en pantalla un NPC y un enemigo rotulados. Barato y visible al segundo de jugar. **Vale.**
- **4.2**: coste cero; el coste real es elegir dónde se escribe. **Vale** — sin un sitio que se lea al tocar el renderer, la decisión no existe.
- **#478**: la maquinaria ya está (`createGameClient` resuelve al instante con el socket abierto, `game-client.ts:298-300`; el botón alternativo del muro existe y solo está oculto). El valor es sobre todo para quien desarrolla y prueba, pero el precio de no hacerlo es una pantalla que miente. **Vale, con el alcance de (b) y ni un paso más.**
- **#451**: el valor no es el tile malo, es que cada endurecimiento del validador invalida todos los mundos en disco. Si hubiera que partirlo, la mitad que paga sola es `bridge/context.ts:158`: dejar de sobreescribir un snapshot bueno con uno de una escena. **Vale.**
- **No hacer nada** solo es defendible en la 4.2, y ni ahí: una decisión sin escribir se revierte sola.

## #480 y #481: fuera, y por qué

- **#480 no cae gratis**: comparte función con #478 (`bootstrap`, `gameClient`) pero su arreglo es otro mecanismo —montar el visor antes del timeout— y arrastra reescribir `las-fixtures-solo-chocan-con-el-agua.mjs`. Lo que sí pido: que el plan de #478 **no hornee** «`gameClient` es null hasta el timeout» en la máquina de estados nueva, o #480 se encarece después.
- **#481 no cae gratis**: vive en core (`status-rotulo.ts`/`status-motivo.ts`) y su causa es la clasificación de un `narrative_status`, que #478 ni toca. Roza solo si «Reintentar» se añade como salida en ese fichero, y eso es un campo de un tipo, no la clasificación.

## Qué le cambiaría a `requisitos.md` (redactado para pegarse)

1. **4.3**, criterio 2: «Dos personajes alineados no producen dos rótulos pisados: se ve el del cercano — **salvo que el lejano sea el que la mirilla enfila**, en cuyo caso se oculta el otro. `pickAimTarget` gana por desviación angular, no por distancia (`aim.ts:127-131`).»
2. **4.1**, añadir: «Un hostil ENFOCADO se pinta ⟨decidir: peligro / acento como hoy⟩; hoy `[data-focus="true"]` pisa el color (`game-ui.css:503-507`) y sin esta línea el rojo desaparece justo al apuntar.»
3. **4.2**, añadir: «La decisión se escribe en `ui/world-labels.ts` (junto a `FADE_FROM_M`) y en `docs/arquitectura/vistas.md:124-126`, con fecha, y el cierre de #484 la cita. No se abre candado.»
4. **#484**, añadir: «Los puntos 4 y 5 del cuerpo del issue (rótulo fuera de encuadre que sigue en el DOM; ruido del selector «Room» con partida viva) NO entran: ⟨#484 sigue abierto con esos dos / se abren aparte⟩. El 4 puede caer gratis dentro del cálculo de solape de 4.3: si cae, que se diga.»
5. **#478**, criterio 4: «…y el chip dice la verdad en todo momento — **conectado escribe «Bridge»** (`main.ts:543-545`), no «Connected»; cambiar el literal es otra petición.» Y añadir: «El guion 78 pierde su aserto “…y se queda retirado” si la conexión pinta un muro nuevo: el plan dice qué afirma el 78 después.»
6. **#451**, la respuesta que falta: «Si la injugable **es la de entrada**, ⟨decidir⟩ — (i) se degrada al bootstrap vivo como hoy y lo único que cambia es que **las buenas del anillo no se pierden** (impedir que `writeSessionSnapshot`, `bridge/context.ts:158`, reescriba con una sola escena), o (ii) se regenera solo la entrada. (i) conserva verdes `world-snapshot.test.ts:446` y `:499`; las dos obligan a reescribir el de `:476`.»
7. **#451**, decidir explícitamente sobre los dos menores que el issue arrastra: que el título no dice el MOTIVO del `stale`, y que `get_world_snapshot` contesta `ok:true/stale` por hash y `ok:false` por jugabilidad. El segundo queda casi resuelto de paso (`style-apply.ts:32`): que entre o que se quede fuera, pero no al criterio del ingeniero.
