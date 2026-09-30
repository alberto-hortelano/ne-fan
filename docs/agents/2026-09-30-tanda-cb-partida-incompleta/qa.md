# QA — Tanda CB: lo que el motor pone junto al borde

Árbol `/home/al/code/ne-fan-tanda-cb`, rama `tanda-cb-partida-incompleta`, commit 266df2af. Todo el banco corrió con `node qa/run.mjs` en bloques propios (+200/+400), nunca en los puertos por defecto.

## Criterios

| Criterio (requisitos + ajustes) | Estado | Evidencia |
|---|---|---|
| R3: ningún spawn de `dispatchConsequences` cae fuera del tile, sea cual sea el hint | ✅ | Guion 355 verde 2/2 (Nogala en z −29,4 y −31,5 con el borde en −32). Unitarios 56/56. Una sonda de core con el turno de la marca TURNO en N/S/E a 2 m da todo dentro. |
| Reanudar tras hablar junto al borde no saca «Tu partida vuelve incompleta» | ✅ | 355: «NO ocurre: tras reanudar NO sale el muro» (15 s, 99 sondeos) y la escena vuelve con «El mundo vuelve con 4 cosa(s)». |
| El muro sigue saliendo con un save de verdad corrupto (#382) | ✅ | 63 y 65 verdes en este árbol. El panel nombra al tabernero en (168,3, 168,3) y a dos personajes fuera; con `position:null` sale `save_invalido`. |
| Lo que el motor pone «cerca del jugador» aparece en suelo alcanzable (lo que la crítica promete al jugador) | ❌ | Guion 357, rojo 3/3. Con el jugador a 2,5 m del borde norte, la Forja cae centrada en su x con z = −29 y el jugador queda en z = −29,5, **dentro de su caja** (holgura −1,90 m, `probePoint` = true). Sigue igual tras reanudar. Andando al sur no se aleja 2 m en 6 s de sim. El control a 9 m del borde sale verde entero. |
| Despertar con spawns en otro tile: la entity se apunta en el tile donde cae | ⚠️ solo unitario | Test «despertar» de `consequence-handler.test.ts` (scene_2, (94,0,−5)). En E2E no se puede: el motor falso no manda `spawn_entity` al despertar y tocarlo está fuera de alcance. |
| El fail-loud «jugador fuera de tile realizado» no se da jugando | ✅ por medida (con reservas) | Guion temporal de costura: andando al este y al sur con el vecino sin generar, el jugador se para en x = 31,53 y z = 31,60, así que `worldToTile` nunca sale del tile. La sonda de core confirma que x = 32 lanza y 31,9 no. |
| Tras reanudar, un spawn nuevo funciona (`tileIndex` reconstruido) | ✅ | 357: «tras reanudar, un spawn nuevo del motor se materializa». |
| No regresión en el banco del reparto y la colisión de spawns | ✅ | 128 y 91 verdes. El 118 salió rojo 2 de 4 en CB y 1 de 3 en la base (af68cf16): es inestable antes y después, y falla al andar hasta el tabernero, antes de cualquier spawn. No es de esta tanda. |

## Hallazgos

1. **IMPORTANTE — el acotado mete el edificio encima del jugador.** Pasa en el caso exacto que esta tanda arregla, hablar junto al borde norte.
   - Por qué: el ancla de `near_player` (o de texto libre) se acota a `−32 + margen`, que es HACIA el jugador. Y el primer cuerpo del turno va a lateral 0, en su misma x.
   - Reproducción:
     1. `node qa/run.mjs 357`: partida nueva y hablar con el tabernero.
     2. Jugador a 2,5 m del borde norte.
     3. Escribir «LO QUE DECLARA EL MOTOR: TURNO».
   - Qué se ve: la Forja aparece en (x_jugador, −29) con caja de 4×4 y el jugador dentro. La cámara queda dentro de la caja: en `02-reanudada` no se ve la forja, solo cielo y la «Zona sin generar».
   - Andar recto al sur no le saca en 6 s de sim. Solo sale después, cuando `acercarse` reorienta hacia el tabernero.
   - Qué esperaba el jugador: la forja delante de él, no a su alrededor.
   - Banda medida en core: con el edificio por defecto, jugador de 1 a 5 m del borde norte. Con un edificio de footprint [20,14], de 2,5 a 9,5 m, y por debajo de 2,5 m queda emparedado entre la caja y el borde.
   - Los unitarios no lo ven: el caso «north» (jugador (0,−30), forja (0,−29)) ya codifica el solape, y lo mismo el de la esquina NE (jugador (30,−30) dentro de la casa en (29,−29)). Solo miden margen al borde.
   - El 355 tampoco lo ve: solo mira a Nogala.
2. **MENOR — si el fail-loud salta, se lleva el turno entero.** `colocacionDelTurno` lanza antes del bucle, así que también se pierden el `dialogue` y las demás consecuencias. El jugador ve el overlay «No se pudo completar esa acción» (kind `action`, vía `router.ts`).
   - En el despertar es peor: `ctx.sim.respawn` ya se ha ejecutado cuando lanza. El jugador queda en pie en el sim, sin `state_update`, y con un velo que pide R.
   - Hoy no se alcanza jugando (ver la medida de la costura, y `validarDespertar` exige tile realizado), así que no se ha probado de extremo a extremo.
3. **MENOR, previo a la tanda — el disparador de llegada de un viaje por «Salidas» usa una posición vieja.** Ese viaje (`scene.ts:207` → `fireMapCrossing`) despacha con `store.player.pos`, que aún es la del tile de ORIGEN.
   - Antes: la posición quedaba en el origen y el `scene_id` en el destino.
   - Ahora: las dos cosas quedan en el origen, coherentes pero en el tile equivocado.
   - No lanza, porque el origen está realizado. No lo he medido en vivo: sale de leer el código.

## Workarounds usados

- **`setPlayerPos` a 2,5 m del borde, con el diálogo abierto** (355 y 357). El diálogo congela al jugador y el paseo del tabernero es aleatorio. El estado se alcanza jugando: el 351 de BX lo alcanzó cuando el tabernero se fue al norte. No afecta al usuario.
- **La marca TURNO del motor falso** en vez de los turnos 2 a 4. Lo que se prueba es el reparto de core, y ese no depende del motor.
- **Guion temporal `359-qa-tmp-costura`** para medir la costura. Lo borré; su resultado está arriba.

## No probado

- El despertar con spawns, en E2E (motor falso sin spawns al despertar).
- El fail-loud de extremo a extremo (no se alcanza).
- El motor real (créditos).

## Guion

`qa/guiones/357-lo-que-el-motor-pone-junto-al-borde-no-cae-encima-del-jugador.mjs`:
- Rojo hoy (3/3) por el hallazgo 1.
- En negativo: con `DEL_BORDE_M = 9` sale verde entero, así que se puede poner verde; restaurado después a 2,5.
- Pasa los candados del banco (`un-numero-un-guion`, `esperas-que-conducen`, `un-salto-del-guion-se-observa`, `sondas`): 95/95.
- El número 357 lo asigna quien fusione.

## Veredicto

**No apto.** El muro «incompleta» desaparece y sigue saliendo cuando debe. Pero el acotado mueve el fallo en vez de quitarlo: en el mismo escenario, hablar junto al borde norte, lo que el motor pone cae ahora encima del jugador. Antes caía al otro lado del borde.
