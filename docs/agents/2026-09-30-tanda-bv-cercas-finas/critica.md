**VIGENTE** — con dos precisiones de alcance (abajo, en «qué le cambiaría a requisitos.md»).

## El problema real

Un muro que el contrato admite (`width` > 0) puede pintarse y no bloquear: el jugador y el NPC lo atraviesan.

La solución que se pide (engordar la colisión de la banda, medido con el cuerpo andando) ataca justo eso. El reencuadre que ya hizo el coordinador, de «diagonal 4-conexa» a «cualquier orientación con `width` < 1», es correcto, y la tarea lo recoge.

## La premisa, afirmación por afirmación

- **«`markBand` marca por centro de celda».** Cierto: `collision.ts:75-82` usa `pu = u+0.5` y `dist² <= half²`. Con `half` < 0,5 y el eje sobre una frontera de celdas, ningún centro cae dentro, así que no se marca nada. Cuadra con la tabla del coordinador.
- **«El contrato admite cualquier grosor».** Cierto: `volumes.ts:174` dice `width: z.number().positive().max(12).optional()`.
- **«Es la colisión, no el validador».** Cierto, y es mejor de lo que parece. Hay una sola fuente: `planCollisionGrid` (`plan-collision.ts:52`) es la que consumen `scene-validate`, `scene-expand`, `scene-normalize`, `bridge/sim-collision.ts`, `obstaculos-del-jugador.ts` y `salida-del-solido.ts`. Si se arregla `markBand`, el arreglo llega a la vez al validador, al A*/flood, al sim del bridge y al despertar. No hay un segundo rasterizador que se quede atrás.
- **«Las puertas siguen abriendo».** Se sostiene. `clearGatePassage` (`collision.ts:216-234`) limpia con una profundidad mínima de 3,5 celdas, y `gateHostWallWidth` casa el muro con una holgura de `width/2 + 2`. Un muro fino engordado hasta ~1-2 celdas queda dentro de ese vano.
- **«Nadie usa hoy `width` < 1».** No lo he vuelto a medir; tomo el censo del coordinador. Lo único que he mirado es que ningún `rect` de prop en `data/` y `labs/` tiene lado < 1 (16 de 16).

## El día después

- **Para quien juega:** una cerca o empalizada fina que declare el motor encierra de verdad. Hoy no ha pasado, pero el contrato lo invita.
- **Cambia la relación entre render y colisión en los muros finos:** la colisión pasa a ser más gruesa que lo pintado. Es lo que admite la memoria «render ≠ colisión», pero hay que escribirlo en el test (requisito 2), o dentro de un mes parecerá un bug.
- **Qué puede cambiar en lo que hoy bloquea:** un criterio conservador (marcar toda celda que la banda toca) también mueve muros de `width` 1 **en diagonal**, y los alineados con el eje en coordenada fraccionaria, porque hoy se marcan por centro. El requisito 3 dice «no deberían cambiar». Puede que no se pueda cumplir literalmente sin una regla de dos regímenes (fino frente a grueso), y esa regla sería justo lo que parecería arbitrario dentro de un mes. Mejor medir el delta y aceptarlo que diseñar para que salga cero.
- **Qué se cierra:** el validador empezará a ver como cerrados unos recintos que hoy da por abiertos. Es correcto, pero una escena hoy válida con cerca fina y sin `gate` pasaría a rechazarse. Como nadie usa `width` < 1, el coste real es cero.

## Conflictos

- **Colas y decisiones:** no hay solapamiento con la cola. Los únicos abiertos, aparte de #788, son #361/#362/#363 (plugins, aparcados).
- **#787:** no hay conflicto, siempre que el engorde no lleve tapas en las puntas libres (`collision.ts:78`, requisito 4). Cuidado: engordar «por celda tocada» en la punta también cuenta como tapa si sobresale de `[0, len]`.
- **Vegetación:** no se ve afectada. `vegetation.ts:27-32` razona sobre el marcado por centro, pero solo para troncos (`markDisc`, radio ≥ 0,9 celdas, `treeTrunkRadiusCells`), y ahí la regla del centro no deja huecos.
- **Mismo defecto en otros sitios.** `markRotRect` (`:130-138`) y `markPolygon` (`:99-110`) marcan por centro exactamente igual. `markDisc` también, con radios que el contrato deja bajar de 0,5: `tower.r`, `fountain.r` y `rect` de prop solo exigen `positive()`. Un `prism` en tira fina, o un prop rotado de fondo < 1, se atraviesa igual que la cerca. Es menos grave, porque son obstáculos sueltos y no recintos, y hoy no hay datos que los usen. Pero es el mismo agujero.
- **Test que puede cambiar:** `test/fps-riqueza.test.ts:173` usa un muro de `width` 1. `blueprint-collision.test.ts` y `lo-que-se-pinta-es-por-donde-se-pasa.test.ts` son los que vigilan las puntas.

## Coste contra valor

El coste es bajo: una función pura, un solo consumidor que lo propaga a todos, y un test de paso que ya existe como patrón (#787). El valor es moderado y preventivo: hoy nadie lo dispara, pero el contrato lo permite y el motor declararía una cerca fina. Si no se hace nunca, el primer recinto con empalizada fina se escapa sin aviso, y el validador dice que está bien. Merece la pena.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **3 (reescrito).** Los muros de `width` ≥ 1 alineados a un eje y con coordenadas enteras o medias no cambian. Cualquier otro cambio en escenas o fixtures reales (muros de `width` ≥ 1 en diagonal o fraccionarios) se mide celda a celda y se reporta. No se introduce una regla distinta para muros finos y gruesos con el único fin de que ese delta salga cero.
>
> **7 (nuevo).** `markRotRect`, `markPolygon` y `markDisc` tienen el mismo muestreo por centro, y el contrato les deja lados o radios < 0,5 celdas. Se arreglan con el mismo criterio o quedan fuera **por escrito**, con issue abierto y el hueco medido. No se dejan en silencio.
