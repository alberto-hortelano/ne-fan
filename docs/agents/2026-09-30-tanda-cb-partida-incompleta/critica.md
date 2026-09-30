**REENCUADRADA** — el bug es real y es de PRODUCTO, no del banco (el motor real lo produce más, a 10 m y no a 5); el arreglo va en la colocación de core y en ningún otro sitio. Fuera del alcance: la alternativa «al tile vecino», retocar el aviso y tocar el motor falso. Y la parte del guion 351 espera a que BX mergee.

## El problema real, en una frase

Core coloca lo que el motor manda aparecer a una distancia fija AL NORTE del jugador, sin mirar dónde acaba el tile. Cerca del borde norte, el spawn cae donde no hay suelo: no se puede alcanzar en vivo, y al reanudar la partida lo denuncia.

## La premisa, afirmación por afirmación

- **«Los spawns del motor falso caen a veces fuera del tile».** Cierto, pero no es cosa del motor falso ni del azar. El motor solo manda `position_hint`. La posición la decide `resolvePositionHint` (`nefan-core/src/narrative/consequence-handler.ts:230-255`): jugador + `fwd*5` con `near_player`, jugador + `fwd*10` con cualquier otro texto (`:250`), ±50 m con `distant_*` (`:218-223`), más el lateral de `repartirEnElTurno` (`reparto-de-spawns.ts:111`). En ningún punto hay un recorte al rect del tile.
- **El forward vale siempre el norte.** Las tres llamadas le pasan `playerForward: {x:0,y:0,z:-1}` fijo: `bridge/handlers/dialogue.ts:82`, `bridge/context.ts:650` y `bridge/handlers/despertar.ts:236`. Por eso la medida de BX (`docs/agents/2026-09-30-tanda-bx-terminar-conversacion/implementacion.md:113`: z = −32,1 / −34,7 con el tile en −32…32) sale toda por el norte. El «1 de cada 3» no es azar: depende de hasta dónde haya paseado el tabernero hacia el norte (`qa/guiones/351…:155` del árbol BX se planta junto a él allí donde esté).
- **«¿Puede pasarle al jugador con el motor real?»** Sí, y con más frecuencia. El contrato le enseña al motor un texto libre, `'junto a la fuente'` (`src/contract/model-io/schemas.ts:96`, `prompts/narrative_event.md:130`), y eso cae en la rama de 10 m. Lo he medido llamando a `dispatchConsequences` con el jugador en (10, −24), a 8 m del borde: `"junto a la fuente"` → (10, 0, **−34**), fuera. Basta con hablar a menos de ~10 m del borde norte. El riesgo ya estaba apuntado en `docs/auditoria-2026-08.md:219`.
- **«¿Qué dispara el aviso?»** El `kind:"restore"` → «Tu partida vuelve incompleta» (`src/protocol/status-rotulo.ts:248-254`) lo emiten DOS causas: los ilegibles de combate (`bridge/handlers/session.ts:340`) y los que están fuera del mundo (`:353`, `entidadesFueraDelMundo` en `src/session/mundo-persistido.ts:388`, contra la unión de los tiles del save). Aquí es la segunda: las coordenadas de BX caen fuera de esa unión. El guion 351 solo registra el TITULAR y no el cuerpo, así que en su log no se distinguen las dos causas.
- **«¿El save pierde entities?»** No las descarta: la escena carga igual y el aviso nombra a quién falta (`mundo-persistido.ts:405-408`). Lo que se pierde es el acceso a esas entities: están en el ledger, en una coordenada sin suelo.
- **«¿Es proporcionado a pantalla completa?»** Ese aviso nació (#382) para un save corrupto, con el tabernero en `tile_3_3`. Arreglada la causa, vuelve a ser su único productor, y para ese caso la pantalla completa es la decisión de #382. **No hay que tocarlo en esta tanda.** Rebajarlo ahora sería tapar el síntoma, que es justo lo que el requisito 3 prohíbe.

## El día después

- **Para quien juega:** lo que el motor pone al hablar cerca de un borde aparece en suelo alcanzable, y al reanudar deja de salir el muro.
- **Qué se vuelve más difícil:** que el motor ponga algo en el tile de al lado queda cerrado de forma explícita. Es lo correcto hoy: en el ledger, la entity lleva `scene_id = active_scene_id`, y el vecino puede no existir todavía.
- **Qué no se arregla:** que el texto del hint («junto a la fuente») se ignore, y que el forward sea el norte fijo. Son reales, pero son otra tarea (ver conflictos).

## Conflictos

- **Contradicción con #382:** la alternativa del requisito 3, «o va al tile vecino de forma explícita», choca con `entidadesFueraDelMundo`. Un vecino sin generar no está en `scenes_loaded`, así que el aviso saldría igual. Hay que quitarla.
- **Dependencia con BX:** `qa/guiones/351-terminar-la-conversacion.mjs` no existe en este árbol, solo en `tanda-bx-terminar-conversacion`, y el número 351 está repetido en BY (`351-la-valla-se-salta-el-muro-y-el-agua-no.mjs`). Quitar el workaround del 351 exige que BX esté mergeada. Si no lo está, esa parte es PREMATURA.
- **Solapamiento con BZ:** BZ edita `labs/narrative/fake-ai-server.ts`. Esta tanda no tiene por qué tocarlo: arreglar el motor falso dejaría el banco verde con el motor real roto.
- **Forward fijo y hint ignorado:** tienen la misma raíz que este bug, pero arreglarlos cambia DÓNDE aparece todo lo que spawnea el motor, en las tres llamadas. No hay que mezclarlos aquí. Si el arquitecto los ve baratos, que vayan en un issue aparte.

## Coste contra valor

El trabajo es pequeño: una función pura de core y tres llamadas que ya tienen a mano el tile activo. Arregla un fallo que el jugador real se encuentra en cuanto habla junto a un borde. No hacer nada deja un NPC de la historia inalcanzable y un muro a pantalla completa en cada reanudar posterior. Vale la pena.

## Qué cambiaría en `requisitos.md` (para pegar)

> **Premisa corregida (crítica):** no es del banco. La posición la decide core (`resolvePositionHint`, `consequence-handler.ts`): jugador + forward×5 (`near_player`) o ×10 (cualquier hint libre, que es lo que el prompt enseña al motor real). El forward vale el norte fijo en `dialogue.ts:82`, `context.ts:650` y `despertar.ts:236`. No hay recorte al tile. El motor real lo produce hablando a menos de ~10 m del borde norte.
>
> 3. **Arreglo en la causa (core):** ningún spawn de `dispatchConsequences` cae fuera del rect del tile activo, sea cual sea el hint, en las tres llamadas. Queda descartado mandarlo al tile vecino, porque choca con #382. No se toca el motor falso, ni el rótulo, ni `entidadesFueraDelMundo`: el aviso sigue siendo pantalla completa para un save corrupto.
> 4. **Test en negativo** en core, con el jugador junto a cada borde y los tres tipos de hint (`near_player`, texto libre, `distant_*`), que se ponga rojo sin el arreglo. Quitar el workaround del guion 351 **solo si BX ya está en main**. Si no, se deja apuntado para después.
> **Fuera de alcance:** el forward fijo al norte y que se ignore el texto del hint. Si hacen falta, van a un issue aparte.
