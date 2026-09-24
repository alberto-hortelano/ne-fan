# Requisitos — tanda BE: Una escena conservada se re-ancla con el motor, y el motor afina anchor.rect (#578 #465)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

## Decisión del usuario (AskUserQuestion, 2026-09-24)

#578 → «Re-anclar con el motor» (opción 4: el motor narrativo re-ancla la escena al mapa nuevo; gasta créditos del motor, así que se implementa y prueba con el motor falso; el camino real queda sujeto a NEFAN_ENTORNO).

## Decisión del usuario sobre el reencuadre (AskUserQuestion, 2026-09-24, tras la crítica)

#578 → **«Anclar la entrada en el mapa viejo (Recomendado)»**. El motor genera la ENTRADA dentro del mapa guardado, con el anillo conservado como vecinos, con el mismo coste que hoy (una llamada). Si falla, error con su motivo y el fichero intacto. Sustituye a la lectura literal de «re-anclar el anillo al mapa nuevo».

#465 → solo la parte que no gasta: el rect con `.int()` y cotas; una sola fuente o un candado de paridad entre el zod y la tool MCP; el prompt; los negativos. El resto se reescribe en el issue apuntando a #239. De paso: corregir el comentario falso de `world-snapshot.ts:35` y `:242`.

## Triaje previo (2026-09-24)

| 465 | DECISIÓN (+ media hacedera) | S | con #239 | El prompt `tile_instructions.md` no pide `anchor.rect`. `AnchorSchema.rect` (`contracts/request-schemas.ts:83`) no tiene `.int()` ni cotas: esa parte del esquema se puede hacer sin gastar. Verificar requiere motor real |
| 578 | DECISIÓN | M | — | Se desbloqueó: #577 se cerró el 09-17. Pregunta: «¿opción 2 (conservar los lugares del mapa viejo) u opción 4 (re-anclar con el motor, gasta)?». La 1 y la 3 ya se descartaron con números en el comentario del 09-17 |

## Los issues, verbatim (con comentarios)

### #578

> Una escena conservada de un mundo pre-generado puede apuntar a un lugar que el mapa nuevo ya no nombra: el panel «Salidas» se apaga
> 
> Residuo del hallazgo H-1 de la QA de la PR 4 de la tanda C (#575, issue #451). **El aviso ya está**
> (`writeSessionSnapshot` lo dice nombrando lugares y escenas, y lo canda el guion 127 E5b + un test
> en `world-snapshot.test.ts`); lo que queda es qué HACER con el estado, que es una decisión que
> nadie ha tomado.
> 
> ## Qué pasa
> 
> Cuando la escena de ENTRADA de un snapshot no pasa el validador de hoy, la sesión degrada al
> bootstrap vivo y —desde #451— el write CONSERVA las escenas buenas que ya había en disco. Pero el
> `world_map` que se escribe con ellas es el de la sesión VIVA, que el bootstrap acaba de sembrar de
> cero (`llmCtx.bootstrap_world_map = true`). Las escenas conservadas traen el `place_id` que les puso
> la generación ANTERIOR.
> 
> Con el motor FALSO los ids coinciden y no se ve. Con un motor real el bootstrap es otra llamada al
> LLM y siembra los lugares que le parece: la coincidencia es la excepción.
> 
> ## Qué le pasa al jugador
> 
> `placeDeLaEscena` devuelve ese `place_id` porque la escena lo declara (`src/world-map/exits.ts`) →
> `salidasDePlace` pide `getOutgoingLinks` de un lugar que no existe → `[]` → **el panel «Salidas» de
> esos tiles sale vacío**. Es el defecto que `src/world-map/bootstrap-place.ts` describe como #172:
> «sin place_id el panel Salidas se apaga SIN UN SOLO AVISO y con él la única vía de viaje del
> cliente». Y `recordSceneLoaded` se salta `attachRealizedScene` con un `if (this.worldMap.get(placeId))`
> mudo, así que esos tiles tampoco quedan atados a ningún lugar.
> 
> ## Medido
> 
> `qa/guiones/127-el-anillo-cribado-en-todos-sus-estados.mjs`, bloque E5(b) (la divergencia se fabrica
> poniendo `place_id: "lugar_que_ya_no_existe"` en los ocho del anillo, porque el motor falso no la
> produce sola):
> 
> ```
> E5 · escenas conservadas cuyo place_id no está en el mapa escrito:
>      ["tile_-1_-1","tile_0_-1","tile_1_-1","tile_-1_0","tile_1_0","tile_-1_1","tile_0_1","tile_1_1"]
> ```
> 
> Desde el arreglo de H-1 eso se DICE por el log del bridge. Lo que sigue pasando es que esos ocho
> tiles, cuando el jugador llegue a ellos, no tendrán salidas.
> 
> ## Lo que hay que decidir (y por eso no se arregló en la PR)
> 
> 1. **Quitarles el `place_id`** a las conservadas cuyo lugar no existe: el panel sigue vacío, pero el
>    dato deja de mentir y `recordSceneLoaded` deja de saltarse nada en silencio.
> 2. **Conservar también los lugares del mapa viejo**: resucita lugares de un mundo que el bootstrap
>    nuevo ya no describe, y el mapa deja de ser de una sola generación.
> 3. **No conservar las escenas cuyo lugar se fue**: es volver al bug que #451 arregla, aunque
>    acotado.
> 4. **Re-anclarlas** pidiéndoselo al motor: funcionalidad nueva, con gasto.
> 
> Ninguna es obviamente la buena y las cuatro cambian conducta observable, así que van a decisión del
> usuario y no al criterio de quien implementa.
> 
> ## Nota
> 
> Convive con #577 (el tile cribado que se paga en cada partida nueva): los dos salen de la misma
> mitad «conservar» y los dos tocarían al tercer escritor del snapshot si se decide crearlo.
> **Evaluado y FUERA de la tanda M, con tres medidas** (2026-09-17, crítica + plan de `docs/agents/2026-09-17-tanda-m-el-mundo-pregenerado-se-cura/`).
> 
> Se estudió junto a #577 porque los dos salen de la conservación parcial. **No comparten pieza**: #578 vive en la rama `conserva` del escritor que ya existe, y #577 necesitaba un disparo que no existía. Disparos distintos (entrada mala contra anillo malo), ramas distintas, cualquiera se entrega solo. **La «Nota» de este issue es falsa como dependencia.**
> 
> Las tres medidas por las que no entra:
> 
> 1. **`conserva-el-mundo-en-disco` tiene UN SOLO caso vivo.** Su único llamante es `runBootstrapTile`, y sin fichero o con el fichero stale `escenasQueSobreviven` devuelve `{}` (`src/games/world-snapshot.ts:268-286`). O sea: hay conservadas ⟺ **la ENTRADA no pasó el validador**. La **opción 3** del issue dejaría esa política **sin ningún caso**.
> 2. **De las cuatro opciones, solo la 2 y la 4 devuelven salidas al jugador** — el título promete más de lo que da su primera opción. Y las dos exigen **medir el encaje de costuras**, que hoy no mide nadie: al cargar se valida con `required_crossings: []` (`world-snapshot.ts:192,208`), así que nadie comprueba que el anillo case con el centro nuevo. **El `place_id` colgando es el síntoma visible de un encaje que no vigila ninguna herramienta** — y eso es más grande que este issue.
> 3. **La opción 1 solo compra un aserto tautológico**: deja el panel «Salidas» igual de vacío y vuelve verde por construcción el aserto del bloque E5 del guion 127 (`colgando.length === 0 || dicho.length > 0`). Sería un candado sin sujeto vivo, que es la enfermedad que esta casa lleva cuatro tandas persiguiendo.
> 
> **Y hay una razón de ORDEN, que es la que decide**: la tanda M le pone a `conserva` **un segundo llamante vivo** (el job de cura de #577, que escribe con `conserva` precisamente para que una cribada no curada no desaparezca del fichero). Decidir #578 hoy sobre un solo caso y re-decidirlo mañana con dos es el orden caro.
> 
> Queda abierto, con su alcance real medido y con el aviso de que **la opción 3 se cae** y **la 1 no vale**. Se retoma cuando la cura de #577 esté dentro.
> Decisión del usuario (2026-09-24): **opción 4, re-anclar con el motor narrativo.** Gasta créditos del motor, así que se implementará y se probará con el motor falso, y el camino real queda sujeto a `NEFAN_ENTORNO` y a su confirmación.

### #465

> Nada instruye al motor real a afinar `anchor.rect` en `map_upsert_place`: «el jugador aparece dentro del lugar» lo ejerce solo el banco
> 
> Sale de la QA de PR #459 (#408, T13, 2026-09-05), hallazgo 2. Es el patrón de #408 un nivel arriba.
> 
> #408 retiró `place_anchors` porque el motor ya ancla lugares con `map_upsert_place.anchor {tx, ty, rect}` (`narrative-mcp/server.ts`). Pero `rect` es opcional y **ningún prompt lo pide**: `data/contract/prompts/tile_instructions.md` no lo menciona; solo lo describe la tool. El fake-ai-server sí lo fija (con rect del lugar), así que el spawn dentro del lugar se ve en el banco y nadie sabe si el motor real lo hace. El banco no puede mentir (`project_banco_no_miente`): hoy prueba un camino que el juego real puede no recorrer.
> 
> ## Qué haría falta
> 
> Que el prompt de tile diga cuándo y cómo dar `anchor.rect` (el rect del lugar dentro del tile, en celdas), con el pre-flight fail-loud que ya existe para la tool, y un playtest con motor real (créditos: necesita sesión con el usuario, como #239) que lo confirme. También: `AnchorSchema` del bridge sin `.int()` ni cotas ahora que es el único canal (hallazgo 5 de la misma QA).
> **Este issue está BLOQUEADO detrás de #616, y es una dependencia con orden que ninguno de los dos nombraba.**
> Salió al abrir la tanda G (2026-09-17); medido sobre `54c7a70c`.
> 
> Lo que este issue pide —que el motor real afine el `anchor.rect`— es exactamente lo que convierte un
> estado sin salida **latente** en **rutinario**. Hoy `resolvePlaceTarget`
> (`nefan-core/src/world-map/place-target.ts:18-28`) devuelve el **centro del `anchor.rect`** del lugar **sin
> una sola consulta de solidez**, y `nefan-html/src/main.ts:946` teletransporta al jugador ahí.
> `nefan-core/bridge/handlers/scene.ts:180` ya lo dice en voz alta: «el jugador aparece dentro del lugar».
> 
> Medido: tomando el `cell` + `footprint` de cada entity como `anchor.rect`, **los 13 `building` de
> `robledo_tile` y `puerto_tile` son estado sin salida en su centro, 13 de 13** (casa del concejo, capilla,
> herrería, posada, molino, establo, atalaya, lonja, taberna del Ancla, cordelería, almacén de sal,
> astillero, faro). Estado sin salida quiere decir literalmente eso: con el `blocksMove` de hoy, **0 de 36
> rumbos** sacan de un sólido más ancho que el cuerpo (#616).
> 
> **Y esto explica por qué el banco está verde**: el motor falso SÍ fija el rect
> (`labs/narrative/fake-scenes.ts:190-191`) pero lo elige **libre**, así que `qa/guiones/09-viaje-de-vuelta.mjs`
> recorre el camino entero sin poder ver el defecto. El día que el motor real empiece a declarar rects
> ajustados a los edificios —que es lo que pide este issue—, cada viaje a un lugar anclado pasa a ser una
> ruleta, y se vería todos los días.
> 
> **Orden: #616 antes que #465.** La tanda G está en marcha y trae las dos mitades: que el juego deje de
> meter a nadie dentro (el viaje comprueba el sitio antes de teletransportar) y que de dentro se salga. Al
> cerrarla, este issue queda **desbloqueado** y se puede hacer sin abrir una ruleta.
> 
> Detalle en `docs/agents/2026-09-17-nadie-se-queda-encerrado/critica.md`.
> 
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
> 
> https://claude.ai/code/session_01XKRRYRsJWigoMEY4CL27ew
> 
> **DESBLOQUEADO hoy** (2026-09-17): la tanda G cerró #616 en dos PR, #641 y #642. `main` = `57520cee`.
> 
> Lo que bloqueaba era que este issue **abría** la ruleta en vez de cerrarla. Ya no:
> 
> - **El viaje pregunta antes de soltar al jugador** (#642): los dos sitios del spawn del bridge pasan el punto de `resolvePlaceTarget` por `sitioParaAparecer`, que consulta las tres fuentes de solidez. Los 13 `building` de las fixtures pasan de **13/13 ocupados a 13/13 libres**, a ≤ 3,90 m y en un paso. Y si no hay sitio, falla en voz alta con el nombre del lugar; nunca un spawn mudo.
> - **Y de dentro se sale** (#641), que es la red de debajo: los **3.117 de 6.007** puntos sólidos de las tres fixtures que eran estado sin salida pasan a **0**.
> 
> Así que el motor real ya puede afinar `anchor.rect` sobre un edificio sin encerrar a nadie.
> 
> ## Dos cosas medidas que este issue debería llevarse puestas
> 
> **1 · El banco no podía ver este camino, y ahora sí.** Los **dos** `anchor.rect` del motor falso caen en hueco (el de la taberna es un volumen *cutaway*, centro (0, −4); el del lugar anclado cae en campo abierto, centro (64, 7)), así que los guiones 08 y 09 recorrían el viaje entero sin poder ver nada. Y había una **segunda** ceguera: el aserto del 09 «el punto de aparición no es sólido» es `collidesAt(p → p)`, que vale `false` también en el centro macizo de un edificio — no podía ponerse rojo ni con la geometría arreglada.
> 
> QA escribió `qa/guiones/144-el-viaje-de-vuelta-no-empareda-al-jugador.mjs`, que ancla el rect sobre un edificio MACIZO **por el canal real** (`POST /map/place` = `map_upsert_place`, que es exactamente lo que este issue quiere que el motor escriba) y juzga con el observable del jugador: `blocked` en los cuatro rumbos y metros ANDADOS. **Ese guion es el candado de este issue**: cuando el motor real empiece a declarar rects ajustados, ya hay quien lo mire.
> 
> **2 · Un matiz que hay que tener en cuenta al hacerlo** (H4 de la QA de G2): `sitioParaAparecer` solo consulta **tiles cargados**, así que la marcha puede dejar al jugador hasta **0,40 m fuera del rect del tile** — 24 puntos en robledo y 248 en puerto, de 6.468 ocupados. No es cárcel (`fronteraBloquea` deja volver, medido), pero es aparecer sobre lo no pintado. **Ninguno de los 13 anchors de hoy lo produce; este issue lo hace posible**, porque un rect pegado al borde de un tile es justo el caso.
> 
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
> 
> https://claude.ai/code/session_01XKRRYRsJWigoMEY4CL27ew
> 
> **BLOQUEADO por coste, apuntado en el triaje del backlog del 2026-09-17.**
> 
> Lo que pide este issue —instruir al motor REAL a afinar `anchor.rect` en `map_upsert_place`— **solo se puede verificar con el motor real**, y eso **gasta créditos**. Toda la verificación de esta casa va con motor falso y cero créditos por decisión permanente, así que esto no lo puede cerrar un agente por su cuenta: **es una decisión del usuario**, igual que #239.
> 
> Lo que SÍ está hecho y no hay que rehacer: la tanda G lo desbloqueó técnicamente (#616) y dejó escrito su matiz medido — `sitioParaAparecer` solo consulta tiles **cargados**, así que puede dejar al jugador hasta **0,40 m fuera** del rect del tile (24 puntos en robledo, 248 en puerto). No es cárcel, pero es aparecer sobre lo no pintado.
> 
> Cuando el usuario decida gastar en un playtest con motor real, este issue y **#239** van juntos: los dos piden lo mismo (comprobar qué escribe de verdad el motor) y comparten sesión.

## Criterios de aceptación

Los de `critica.md` (§ Criterios), adoptados tal cual:

1. **#578**. Con un snapshot cuya entrada es injugable, `start_session` hace UNA petición `generate_tile{tx:0,ty:0,bootstrap:true}` **sin `bootstrap_world_map`** y con `neighbors` no vacío. El `world_map` escrito tiene exactamente los mismos ids de lugar que el del fichero anterior, y `escenasSinLugarEnElMapa` da 0. Test de core con `aiClient` falso que cuenta peticiones. **Negativo**: con el bootstrap que siembra, en rojo.
2. **#578**. La lógica que elige el camino, el mapa y el `place_id` de entrada es pura y vive en core. El handler solo encola.
3. **#578**. Si falla el motor, o el mapa viejo no nombra el lugar de la entrada: `narrative_status error` con el motivo, fichero intacto, y **nunca** se vuelve en silencio a sembrar un mapa.
4. **#578**. Guion 214-217 con `e2e-sin-creditos`: divergencia fabricada en disco, el jugador camina de la entrada a un tile del anillo, **el panel «Salidas» NO está vacío**, y el motor falso registra 1 petición. El E5b del 127 se retira o se invierte, sin aserto tautológico.
5. **#578**. Se corrigen los comentarios falsos de `world-snapshot.ts:35,242` sobre `fromSerialized` (o se hace verdad lo que dicen).
6. **#465**. El rect del anchor se rechaza si no es entero, es negativo, tiene `w`/`h` ≤ 0 o se sale de 128; igual en la tool MCP y en `POST /map/place`, desde una sola fuente o con test de paridad visto en rojo. **Negativos en rojo.**
7. **#465**. `tile_instructions.md` documenta el `anchor.rect` del lugar en `generate_tile.place` y sus unidades. `test/contract-model-io.test.ts` en verde. El issue queda abierto y reescrito como «verificación en el playtest de #239».
8. **Cero créditos**: motor falso y `e2e-sin-creditos`, sin ninguna llamada al motor real.

## Restricciones

- **Números de guion RESERVADOS: 214-217.** Otras tandas en paralelo: AX (atlas, `politica-de-atlas`/`fps-atlas`), BB (título), y las otras de esta ola (BE mapa/motor, BF CRAP del cliente, BH detectores del banco).
- Lint del banco en main: `no-unused-vars`, `no-useless-assignment`, `preserve-caught-error` con `requireCatchParameter`.
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node`.
