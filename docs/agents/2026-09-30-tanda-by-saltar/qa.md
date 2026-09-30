# QA — Tanda BY: saltar

Petición literal: «Tambien que pueda saltar». Commit validado: `efb4089e` (rama `tanda-by-saltar`).
Todo con `node qa/run.mjs` (preset `e2e-sin-creditos`, bloque +200 elegido por el runner, 0 créditos; los puertos por defecto no se tocaron).

## Criterios → resultado

| # | Criterio (desde la petición y el alcance aceptado) | Estado | Evidencia |
|---|---|---|---|
| 1 | Espacio (tecla REAL) hace saltar | ✅ | 353: `{"aire":true,"elevMax":0.798}` y vuelve a `suelo` |
| 2 | El salto SIRVE: pasa por encima de una valla baja | ✅ | 352: valla sin saltar `z -10.65 → -10.65`; saltando `→ -13.26` (cruza). 356: despegando entre 0,6 y 1,8 m de la cara se cruza siempre, andando y esprintando |
| 3 | No pasa muro alto, muralla, agua ni esquina valla+muro | ✅ | 352: muro, río y muralla «no ocurrió en 3 s». 356: esquina `x=-18.47` (muro en -17), la valla con agua detrás no deja entrar en el agua, contra el muro no se cruza ni se mete el cuerpo |
| 4 | Por el portón se sigue pasando saltando y la cámara no corta el dintel en el apogeo | ✅ | 352: vano cruzado; captura `04-saltando-bajo-el-dintel-mirando-arriba`: dintel por encima y jambas a los lados, sin cortes |
| 5 | Con la conversación abierta, Espacio no salta | ✅ | 353: `{"aire":false,"elevMax":0}` con las opciones en pantalla |
| 6 | Saltar en plena pelea no rompe nada | ✅ | 356 §0: con golpes `heavy` y 5 despegues durante el wind-up, el bandido muere (`hp 60 → 0`), la elevación máxima es 0,7996 y el jugador aterriza. 41 sigue en verde |
| 7 | Machacar Espacio no da doble salto ni más altura | ✅ | 356 §8: elevación máxima 0,800 durante 2 s de Espacio en cada fotograma |
| 8 | Lo que PARECE saltable ES saltable (y al revés): vallas y muretes | ✅ | Censo de partidas reales (saves del usuario, `labs/narrative/runs`, `archivo/saves`, fixtures): 26 `wall` saltables (cercas, tapias y pretiles de 1–1,1 m), y todas se pintan de ≤ 1,2 m |
| 9 | Ídem para las ROCAS | ❌ | Censo: **24 de 32 rocas NO se saltan** (s 1,1–1,6 publican 1,21–1,76 m) y se pintan a unos 0,6·s (0,66–0,96 m, a la altura de la rodilla). Captura `356-…-roca-s1_5-vista-desde-3-m`: la roca parece más baja que la valla de al lado, que sí se salta. 356 §4: saltando con W acaba en `z=-10.10`, frenado |
| 10 | Un salto «a ojo» no deja al jugador en un estado sin salida | ❌ (fricción) | 356 §1: despegando a 2,2 m, 2,6 m o 3,0 m de la valla, se aterriza DENTRO, antes de su mitad, y **con W no se avanza** (`DENTRO/ATASCADO`). Hay salida: un segundo Espacio con W te saca por delante (`-11.66 → -20.58`), y S también |
| 11 | Tarima baja y ancha (prism de 1 m) | ❌ (declarado en el plan) | 356 §3: se aterriza dentro (`dentro=true`) y se anda por dentro a ras de suelo (1,8 m al oeste sin salir). Capturas `tarima-*` |
| 12 | Sensación: se nota el salto, con altura y duración creíbles | ✅ con reservas | Secuencia `356-…-secuencia-0..7`: valla delante, luego a 0,79 m pasa por debajo del encuadre, a 0,40 m baja y aterriza. Parábola de 0,8 m en 0,7 s (g ≈ 13 m/s²), como un fps de acción. Sin amortiguación al aterrizar (ver H5) |
| 13 | Costura entre tiles, relieve o desniveles | ⚠️ no probado | Ver «No probado» |
| 14 | Objetos que spawnea el motor (AABB) | ⚠️ macizos en el aire (declarado) | No medido en vivo; el plan y `collision.ts` lo declaran |

Guion nuevo: **`qa/guiones/356-el-salto-como-lo-juega-quien-juega.mjs`**. Última corrida `node qa/run.mjs 356 352 353 350 41 37`: 7 en verde, 1 en rojo (el 356, con dos rojos que son los hallazgos H2 y H3) y 1 ⊘ ajeno (el 141 casa con el filtro «41»; no hay grabaciones en el worktree).

**Probado en negativo.** En `planCollisionGridEnElAire`, dejé temporalmente el filtro en `false &&` (el aire sin ningún volumen) y lo restauré después (`git diff` vacío). Resultado: la esquina sale roja (`x=-14.53`, cruza el muro) y el muro sale rojo (`zAterriza 11.65`, cruza). La primera versión del aserto del muro seguía verde con el sabotaje; la endurecí (`muro.z > cara`) y volví a comprobar que ahora se pone rojo. El agua sigue verde con el sabotaje, y es correcto: el agua es `ground` y no pasa por el filtro.

## Hallazgos

**H1 — importante. Las rocas que se ven de rodilla no se saltan, y una valla más alta sí.**
- Reproducir: `./start.sh --preset e2e-sin-creditos`, nueva partida en alta_fantasia, ir a `roca_1` del tile inicial (s 1,3, fake-scenes:128). Correr hacia ella y pulsar Espacio.
- Esperado por quien juega: si acaba de saltar una cerca de 1 m, una piedra que le llega por la rodilla también se salta.
- Realidad: `volumeHeightM(rock) = 1,1·s` y la roca se pinta a unos 0,6·s. El umbral `ALTURA_SALTABLE_M` se aplica a la altura PUBLICADA, no a la pintada.
- En partidas reales es el caso mayoritario: 24 de 32 rocas.
- `implementacion.md` lo llama «la dirección segura». Para quien juega no lo es, porque lo que ve es incoherencia.
- El arreglo está en el backlog del plan (§6.1: la altura publicada, sacada de las prims). Pido que se abra como issue con este censo y que no se quede en prosa.

**H2 — importante (fricción). Si se pulsa Espacio demasiado pronto, el jugador se queda atascado dentro de la valla y no ve qué le frena.**
- Reproducir: correr hacia una cerca de 1 m y pulsar Espacio a unos 2–3 m de ella con W apretada.
- Qué pasa: el salto recorre unos 2,9 m y aterriza dentro de la huella, antes de su mitad. «Salir sí, entrar no» impide avanzar. Mirando al frente la valla no se ve, porque está por debajo de la cámara y del near plane: captura `…-atascado-dentro-de-la-valla-mirando-al-frente`, donde solo se ve pradera.
- Cuánto margen hay: la ventana buena es de unos 0,4 a 1,8 m, unos 0,35 s de margen al paso. Un poco antes, y te quedas clavado.
- Hay salida (segundo salto o S), así que no es bloqueante. Pero el jugador tiene que descubrirla sin ninguna pista.
- Esperado: o se cruza, o se choca antes de la valla. Nunca «dentro, invisible y sin avanzar».

**H3 — menor (el plan ya lo declara). Sobre una tarima, estrado o grada baja y ancha, el jugador queda dentro y anda por dentro.**
- En la vista se lee como «encima, pero más bajito»: los ojos quedan a 0,6 m sobre la tapa (capturas `tarima-dentro-mirando-abajo` y `tarima-andando-por-dentro`).
- En saves reales hay 5 prisms saltables (estrado de las audiencias de 0,5 m, grada de piedra, montones de tierra). Además, el estrado de 0,5 m no se puede subir andando: hay que «saltar dentro».
- Encaja en el backlog §6.2 (pisar encima).

**H4 — menor. Espacio deja de activar el botón del HUD que tenga el foco.**
- `onJumpKey` hace `preventDefault` y Chrome ya no hace el clic (medido aparte: 0 clics). Ahora salta.
- Para quien juega probablemente es mejor así (evita activar sin querer «Maqueta 3D» o «Y sí, explorar»), pero es un cambio de conducta que nadie ha declarado. Con el diálogo abierto no ocurre (la guarda sale antes).

**H5 — menor (feel).**
- El aterrizaje es un corte seco de la parábola: no hay amortiguación ni sonido. Ya lo declara la implementación.
- Con un apogeo de 0,8 m se pasan vallas de 1,0–1,2 m, así que los pies no libran la valla. En primera persona no se ve y no molesta, pero conviene saberlo antes de que haya cuerpo visible o sombra propia.

**Nota para el coordinador (números de guion).** BX ha renumerado su guion de bordes a 354 (sin commitear en su worktree), y 355 lo tiene otro árbol. Hoy los 352 y 353 de BY no chocan con nadie. Mi 356 está libre. Hay que revisarlo al fusionar (`un-numero-un-guion`).

## Workarounds usados

- **`loadSceneRaw` con escena sintética** (356, igual que 352 y 350). El motor falso no pone vallas, tarimas ni esquinas en fila.
  - Por qué no afecta a quien juega: la escena entra por la misma puerta que el selector «Room», y las vallas del motor real pasan por el mismo `planCollisionGrid`/`planCollisionGridEnElAire` del tile. El censo de saves reales confirma que esas piezas existen (26 cercas saltables, 32 rocas, 5 prisms bajos).
  - La pelea (§0) sí es en el tile real del motor falso.
- **`setPlayerPos`** solo para el punto de SALIDA de cada carrera. El recorrido se ANDA con el driver.
- **Driver de bench (`queueJump`) en lugar de la tecla real** para la física. La tecla real la cubre el 353.
- **Sabotaje temporal de `plan-collision.ts`** para la prueba en negativo. Está restaurado y no se ha tocado nada más del código.

## No probado

- **Salto a caballo de la costura entre dos tiles.** Exige dos tiles con una valla cruzando la frontera; con `loadSceneRaw` solo hay uno. Queda cubierto por `keysTouching`, según el plan, pero no está verificado en vivo.
- **Relieve o desniveles** (`reliefWorldAt`): el salto suma elevación sobre el relieve. No monté una escena con cuesta.
- **Guardar o reanudar aterrizado dentro de una valla, y viajar a mitad de salto** (desviación 3 de la implementación): no está medido.
- **Huir de un enemigo saltando una cerca** (decisión aceptada): no está medido en vivo, porque el tile del motor falso no tiene una cerca cerca del bandido.
- **AABB de lo que spawnea el motor en el aire**: declarado macizo, no está medido.
- **Vídeo o fluidez real**: solo hay capturas sueltas (8 en unos 0,7 s de salto).

## Veredicto

**Apto con reservas.** El salto existe, se nota y sirve: pasa cercas y tapias bajas y no pasa muros, agua ni murallas. Tampoco rompe el diálogo ni la pelea. Las reservas son dos:
- H1: la mayoría de las rocas reales parecen saltables y no lo son.
- H2: saltar demasiado pronto deja al jugador clavado dentro de una valla que no ve. Tiene salida, pero no hay ninguna pista de cuál es.
