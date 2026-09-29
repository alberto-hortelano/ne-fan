# QA — Tanda BO: el NPC busca camino (#618 A + meta de D)

Rama `feature/tanda-bo`, commit `d0d1903b`, worktree `ne-fan-tanda-bo`. Node v26.10.0, `npm run build` antes de todo lo que lee `dist/`. Cero créditos: preset `e2e-sin-creditos` levantado por `qa/run.mjs` en su propio bloque de puertos, y sim de `dist` con el cableado de producción (`createSessionNpcBehavior` + `createSimCollisionProvider`).

**Petición** (requisitos.md): que el NPC **RODEE** los obstáculos en vez de pisar en el sitio. El usuario eligió «Sí, tanda propia»: A* sobre la rejilla de `sim-collision`, que ve también las cajas de runtime, con el steering como seguidor local. En la crítica, «el día después» dice: «los aldeanos rodean carros y casas, y llegan a la puerta».

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| Con un obstáculo en medio, el NPC lo rodea y llega. No pisa en el sitio | ✅ cumple | `node qa/el-mundo-solido-tambien-para-el-npc.mjs`: los diez bloques en verde. En el carro de 6 m, penetración 0,000 m, llegada a los 20,5 s y 0 ATRAVIESA. Mi sonda sobre la misma escena mide 24,6 m andados (22,5 m sin carro), 0 s en el sitio, 0 giros de más de 45° y 0,1 m de holgura en la esquina |
| Lo mismo en el juego real, desde el arranque | ✅ cumple | `node qa/run.mjs 270`: 9/9 en verde. Etapa 1 en 10,7 s; etapa 2 en 18,7 s y 18,6 m, con 0 muestras dentro |
| Lo hace con naturalidad, sin zigzag ni roces (crítica visual) | ✅ cumple | Traza del cliente por frame (rAF, 980 frames): 0 saltos de más de 20 cm por frame. Solo hay tres giros de más de 30°, uno en cada esquina (44°, 50° y 60°), y pasa a 0,1–0,2 m de la fachada. Sin apurar la colisión, el modelo no se mete en la pared. Secuencia de 13 capturas del tabernero a lo largo de la fachada de la casa del leñador (abajo, «Crítica visual») |
| Tile y runtime se rodean igual | ✅ cumple | `el-mundo-solido` bloque 10: tile 22,28 s y runtime 22,22 s |
| Muchas rutas en un pueblo real | ✅ cumple | robledo, 20 NPC con pares al azar durante 120 s: 20/20 llegan, 0 ticks dentro de un sólido y 0 s pisando en el sitio. Solo dos trazas giran bruscamente, y las dos están en el borde del tile (ver H2) |
| Caja que aparece a mitad de ruta | ✅ cumple | Sonda con cajas de 3, 6 y 10 m puestas delante del NPC en marcha: llega siempre (25,1 / 26,8 / 30,0 s), con 3 o 4 planes, 0 dentro y 0 s en el sitio |
| Cambio de tile a mitad de camino | ✅ cumple | Sonda: meta en el tile (1,0), cargado con un granero de 12×20 m cuando el NPC va por x = 25. Hace 3 planes, llega en 49,3 s (43,5 s si el tile ya estaba cargado) y no entra en el granero |
| Resume a mitad de ruta | ✅ cumple (sim) / ⚠️ no probado en navegador | Sonda: sistema nuevo a los 8 s, sobre el mismo `NarrativeState`. Hace 1 plan y llega 12,6 s después, sin tocar sólido. En el navegador no se probó: la ruta no se persiste y la sonda cubre justo ese camino |
| Huir durante una ruta | ✅ cumple / ❌ menor (H4) | Huye, suspende la directiva (`suspended_goal`, conforme a #298) y no vuelve sola. En el juego real lo provoqué sin querer: puse al jugador cerca del bandido y el tabernero huyó a mitad de ruta. Si el motor le devuelve la MISMA directiva, reusa la ruta vieja (H4) |
| Varios NPC hacia la misma puerta | ❌ NO cumple (H1) | `node qa/run.mjs --sin-navegador 271`: rojo en los asertos 2 y 3 |
| La meta dentro de un sólido acaba en la puerta | ✅ llega / ❌ por el lado equivocado (H1) | Llega a una cara libre. La cara la elige `sitioParaAparecer(centro)`, igual para todos, y el que viene por el otro lado da la vuelta al edificio |
| El NPC no se sale del mundo generado | ❌ NO cumple (H2) | `node qa/run.mjs 272`: rojo. El tabernero sale 0,73 m fuera del tile, con 41 de 94 muestras fuera. Captura abajo |
| Sin camino, deja de pisar en el sitio | ❌ NO cumple (H3) | `node qa/run.mjs --sin-navegador 273`: rojo en B y en C |
| Coste con muchos NPC | ✅ normal / ⚠️ patológico (H3, H7) | puerto, 40 NPC con metas libres: 0,09 ms por tick de media, máximo de 8,3 ms y 0,6 % de CPU. Con 40 NPC hacia una meta cerrada: 13 planes/s, 7 ticks/s por encima de 16,7 ms, máximo de 47 ms y 25 % de un núcleo |
| No rompe lo de BL ni el resto | ✅ | `npm run verify`: 3702/3702 y EXIT 0, con mis guiones dentro. `npm run lint`: limpio. `run.mjs --sin-navegador 250`: verde |

## Hallazgos

### H1 · IMPORTANTE: los vecinos que van al mismo edificio acaban unos dentro de otros, y el que llega por detrás lo rodea entero

**Qué ve el jugador.** El motor manda a cuatro aldeanos al concejo. Llegan en corro a la cara norte, con dos cuerpos en el mismo punto (a 0,01 m), y el que venía por el sur da media vuelta a la casa para llegar.

**Causa.** La meta de un lugar anclado a un edificio (13 de 13 en robledo y puerto) es `sitioParaAparecer(centro)`. Es UN punto, en la cara que elija esa cuenta, y es el mismo para todos. Antes de BO cada uno se quedaba a 1,5 m del centro, cada uno por su lado; ahora comparten el tramo final junto a la fachada.

**Medido.**
- Guion 271 (concejo de robledo, cuatro vecinos, uno por lado): finales en (−9,03, −6,27), (−9,04, −6,26), (−8,45, −6,27) y (−8,73, −5,96). El del sur anda 15,4 m hasta una casa que tenía a 3,5 m.
- Sonda con una casa de 10 m y seis vecinos: los seis quedan en ≤ 0,6 m, tres de ellos en la misma coordenada exacta (5,74, −0,54). El del oeste anda 27 m hasta una cara que tenía a 8,5 m.

**Reproducir.** `cd nefan-core && npm run build && cd .. && node qa/run.mjs --sin-navegador 271`.

**Qué esperaba el jugador.** Cada vecino llega a la casa por su lado y ninguno se mete dentro de otro.

**Probado en positivo** (el guion PUEDE ponerse verde): buscando la meta libre desde el punto medio entre el NPC y el centro, los seis asertos salen verdes. Fue un sabotaje de una línea en `dist`, restaurado con `md5sum -c`. No es la propuesta de arreglo: solo demuestra que el aserto mide la meta. El control 4 (lugar en campo abierto) sale verde hoy: en campo abierto se reparten solos.

### H2 · IMPORTANTE: el A* rodea las murallas y los ríos por la «Zona sin generar»

**Qué ve el jugador.** El tabernero va al otro lado de la muralla que cruza el tile servido. En vez de ir al portillo, rodea la punta de la muralla por FUERA del mundo y se queda de pie sobre la llanura de arena de «Zona sin generar», a la que el jugador no puede entrar sin aceptar «¿Explorar hacia el oeste?».

**Causa.** Un tile sin realizar cuenta libre (`implementacion.md`, «Qué NO queda cubierto»), y el buscador lo **aprovecha** como atajo. El steering de antes nunca apuntaba ahí.

**Medido.**
- Guion 272 (juego real): 41 de 94 muestras fuera del `world_rect`, hasta 0,73 m más allá del borde oeste. La captura lo enseña.
- Sonda sobre 300 pares libres al azar: salen del tile 21 rutas de robledo (7 %, rodeando el río por la punta norte) y 136 de puerto (45 %).
- En un mundo continuo, el río y la muralla seguirán en el tile vecino cuando se genere, así que esas rutas además están mal.

**Reproducir.** `node qa/run.mjs 272`.

**Captura.** `qa/capturas/2026-09-29T14-35-16-315Z-1056530/272-el-aldeano-no-sale-a-la-zona-sin-generar-01-qa272_despues-donde-rodea.png`.

**Qué esperaba el jugador.** Que cruce por el portillo, o que no llegue, pero nunca que se pasee por el vacío.

**Probado en positivo:** con `buscarRuta` viendo sólido lo que cae fuera del tile (0,0), el tabernero cruza por el portillo en menos de 90 s y el guion sale verde. Fue un sabotaje en `bridge/sim-collision.ts`, restaurado con `md5sum -c`.

### H3 · IMPORTANTE: sin camino, el síntoma de partida sigue entero, y ahora con un plan de hasta 46 ms cada 3 s

**Qué ve el jugador.** Si la meta no tiene acceso (patio cerrado, cercado), el NPC camina hasta la pared y se queda **andando en el sitio para siempre**, con la mirada temblando cada frame. Es literalmente lo que la petición quería quitar.

**Medido** (guion 273, 120 s de juego):
- **B · patio cerrado:** 70 s de 119 con `moving=true` sin avanzar, 46 saltos de mirada de más de 3° por segundo y 109 cambios de sentido.
- **Coste de B:** cada 3 s hay un plan que llega al tope de 16.384 expansiones y cuesta 20–46 ms. Lo mide mi sonda (`tickMax` de 45,9 ms); `implementacion.md` hablaba de un pico de «~30 ms» (H7).

**Caracterización del pasillo cerrado** (el que pidió el coordinador, **C** en el guion 273). Esto es lo que ve el jugador, medido tick a tick en 300 s:
- El aldeano anda de (6, 0) a (7,50, 0,00) en 1,5 s. Ahí toca el agua del tile.
- Desde ese momento, `moving=true` el **100 %** del tiempo, así que la animación de andar no para nunca.
- La posición alterna **cada tick** entre (7,50, 0,00) y (7,50, 0,02). Es un temblor de 2 cm a 30 Hz, imperceptible como desplazamiento.
- La **mirada** salta 84°↔90° **en cada tick** (59,4 saltos/s). Esto sí se ve: el modelo vibra mientras «anda» contra el agua.
- Los avisos salen **una sola vez** cada uno (`warnOnce`): «no encuentra ruta… inicio-encerrado», «no tiene por dónde rodear "muralla_norte"… y la ATRAVIESA» y «quedó DENTRO de "muralla_norte"… y sale andando». El log promete un escape que no ocurre jamás: en 300 s, x no pasa de 7,50.
- **Mecanismo:** el escape mete un paso de 2 cm en la muralla norte y `salirSiEstaDentro` (BL) lo devuelve en el tick siguiente.
- Es igual que en `main`: C no tiene ruta (`inicio-encerrado`), así que corre el steering de siempre. **No es regresión de BO, pero tampoco lo arregla.**

**Coste con muchos:** 40 NPC con meta cerrada dan 13 planes/s, 7 ticks/s por encima de 16,7 ms, un máximo de 47 ms y el 25 % de un núcleo. El tick del sim va en el hot loop del bridge (un `state_update` por frame del cliente), así que eso son tirones. Nada acota los reintentos: cada NPC falla cada 3 s indefinidamente.

**Reproducir.** `node qa/run.mjs --sin-navegador 273`.

**Qué esperaba el jugador.** Que el NPC sin camino se pare, sin animación de andar ni temblor, y que el motor se entere.

**Probado en positivo:** con el NPC parado (`moving=false`) tras un plan fallido, los diez asertos salen verdes, el control A incluido. Fue un sabotaje en `dist`, restaurado.

**Qué hacer es decisión de producto** (pararse, rendirse y avisar al motor, o suspender la meta como en la huida). Por eso lo marco IMPORTANTE y no bloqueante.

### H4 · MENOR: tras huir, si el motor le devuelve la misma directiva, sigue la ruta VIEJA

**Causa.** `rt.ruta` y `rt.rutaClave` no se limpian cuando cambia la meta (`decide` → `goalKey !== directiveKey` solo suelta `waypoint`). Si la directiva vuelve idéntica, la clave `goto|<misma directiva>` coincide y `tocaPlanificar` no replanifica.

**Medido** (sonda: casa de 10 m, huida a mitad de rodeo por el sur, el motor le devuelve la misma `goto_place`):
- Desde (−23,1, 3,7), la ruta fresca iría por la cara NORTE (primer punto (−7,75, 3,75)).
- El NPC vuelve hacia los puntos de la ruta vieja por el SUR: baja por la cara oeste hasta z = −5,5 y sigue.
- Llega en 33,9 s con 40,6 m andados. Aquí sale casi igual de largo por simetría; si el paso directo al punto viejo topa, se autocorrige por «tramo cortado».

**Qué esperaba el jugador.** Que retome el camino desde donde está, no desde donde estaba. No hay guion; está anotado aquí.

### H5 · MENOR: un hueco de 1,0–1,5 m que no cae en la rejilla no existe para el A*

**Qué pasa.** Con un muro de runtime y un hueco centrado en x = 0 (bordes a mitad de celda), el A* no pasa por huecos de 1,1, 1,25 ni 1,4 m. Da la vuelta por el extremo del muro y llega en 56,6 s, frente a 15,6 s por el hueco cuando está alineado.

**Contexto.** El jugador (radio 0,4) y el steering del NPC sí caben por esos huecos. Las cajas de runtime caen en coordenadas arbitrarias (`near_player`), así que el caso es real. Es el precio conocido de «celda libre = cuerpo entero con radio exacto».

### H6 · MENOR (no visible): gancho de ~0,2 m en algunas esquinas del sim

**Medido.** En la sonda, al doblar la esquina de una casa hay giros de 143–150° en 0,1 s: el punto de la ruta queda 0,25 m más allá de la esquina y `WAYPOINT_REACHED` = 0,3.

**Por qué no se ve.** En la traza del cliente (rAF, juego real) no aparece. El giro de la mirada está limitado a 2π rad/s y el tramo mide centímetros.

### H7 · MENOR (documentación): el pico por plan es mayor de lo escrito

`implementacion.md` da «pico por frame ≤ ~30 ms en el caso patológico». Medido: un plan que llega al tope cuesta 39,5–45,8 ms en los primeros intentos (arranque en frío) y unos 25 ms de mediana después.

## Crítica visual

Juego real y Maqueta 3D, secuencia de 13 capturas en `qa/capturas/2026-09-29T14-31-02-628Z-1030975/`. El guion exploratorio que las tomó ya está borrado.

**Lo que se ve bien.**
- El tabernero dobla la esquina de la casa del leñador y recorre la fachada con paso regular.
- Pasa a un palmo de la pared, sin meterse en ella y sin quiebros; la mirada va siempre hacia donde anda.
- Llega detrás de la casa y para.
- Lo que el usuario pedía se ve: rodea, no empuja.

**Pegas.**
- Va pegado a la fachada: 0,1–0,2 m de holgura sobre el radio de colisión. Un aldeano real se separaría algo más de la pared, pero no llega a leerse como roce.
- En la captura del guion 270, el NPC queda en un callejón estrecho entre dos casas: se ve bien, pero la cámara de bench de ese guion es la que es.

**Captura de H2.** Es la que más chirría: el tabernero de pie sobre la arena de «Zona sin generar», más allá del extremo de la muralla y fuera de la hierba del tile. Para un jugador, un NPC paseándose por el vacío rompe la ilusión mucho más que uno parado.

## Guiones (en `qa/guiones/`, rango 271–279)

| Guion | Tipo | Estado hoy | Prueba |
|---|---|---|---|
| `271-los-aldeanos-van-a-la-casa-sin-apilarse-ni-rodearla.mjs` | sin navegador (`--sin-navegador`) | ✘ en 2 y 3 (H1). El control 4 verde | Positivo: la meta por lado lo pone todo en verde |
| `272-el-aldeano-no-sale-a-la-zona-sin-generar.mjs` | juego real (e2e-sin-creditos) | ✘ en 3 (H2). Los controles verdes | Positivo: la ruta que ve sólido fuera del tile lo pone verde |
| `273-sin-camino-el-aldeano-no-pisa-en-el-sitio.mjs` | sin navegador | ✘ en B-2, B-3, C-2, C-3 y C-4 (H3). El control A verde | Positivo: un NPC parado tras un plan fallido lo pone todo en verde |

Los tres nacen ROJOS a propósito: son los hallazgos, ejecutables. Cada uno trae un control que demuestra que la medida puede salir verde, y su cabecera cuenta el sabotaje positivo. No entran en `qa/README.md`: esa tabla se escribe al fusionar. `npm run verify` (3702/3702) y `npm run lint` pasan con los tres dentro, incluidos los candados de «un salto del guion se observa» y «sin espera por reloj».

## Workarounds usados

- **Cámara de bench** (`setPlayerPos` + `setYaw`) para las capturas del 272 y de la secuencia. No afirma nada, solo encuadra: el jugador podría mirar desde ahí andando. **Veredicto:** no afecta al usuario.
- **Huida provocada por la cámara:** la primera secuencia puso al jugador a 9,6 m del bandido y el tabernero huyó a mitad de ruta. No es un workaround sino un estado real, y es la evidencia de «huir durante una ruta» en el juego. Lo descarté para la secuencia visual y moví la cámara.
- **Sabotajes positivos** (tres, de una línea, en `dist/…/ruta-por-el-suelo.js`, `bridge/sim-collision.ts` y `dist/…/npc-behavior.js`) para demostrar que cada guion rojo PUEDE ponerse verde. Los tres restaurados y comprobados con `md5sum -c` (OK). `git status` solo lista los tres guiones nuevos. **Veredicto:** no afectan al usuario ni al árbol.
- **Sonda en el scratchpad** con el cableado de producción de `dist` para los casos adversariales (varios NPC, caja a mitad, tile, resume, huida, coste, pasillo, huecos). Mide lo que viaja en `state_update.npcs` (pos, forward, moving), que es lo que pinta el cliente. **Veredicto:** es el mismo camino del bridge; lo único que no pasa por el navegador es el pintado.

## No probado

- **Resume en el navegador** (salir y reanudar a mitad de ruta). Solo en sim, con un sistema nuevo sobre el mismo estado. La ruta no se persiste por diseño.
- **Caja de runtime puesta por el motor a mitad de ruta en el juego real** (marca `CARRO` del motor falso). Solo en sim: pedirla exige hablar con el tabernero, que es quien anda, y lo dejé en la sonda.
- **Varios NPC a la vez en el juego real.** El tile servido tiene un solo ambiental; en sim sí se probó (guion 271).
- **Mutación de `busca-camino`**: sin medir, pendiente de la corrida autorizada, como ya declara el ingeniero.
- **Coste en el bridge real con muchos NPC**: medido en sim y no con un stack cargado. Cuántos frames se pierden en el cliente queda sin medir.

## Veredicto

**NO APTO.**

Lo pedido se cumple cuando hay camino. El NPC rodea carros y casas con naturalidad y sin roces, en el sim y en el juego real, con tile y runtime iguales, y sin romper nada de BL.

Pero el mecanismo nuevo mete dos defectos visibles que antes no existían:
- **H1:** los vecinos que van a una misma casa acaban unos dentro de otros en UN punto, y rodean el edificio para llegar a la cara que les tocó.
- **H2:** el NPC atraviesa la «Zona sin generar» para acortar: 45 % de las rutas en puerto.

**H3** deja intacto el síntoma de partida siempre que no haya camino, ahora con un coste por reintento que nada acota. Los tres tienen guion rojo con prueba positiva y vuelven al ingeniero. H3 necesita antes una decisión de producto sobre qué hace el NPC sin camino.

---

## Segunda vuelta

Sobre `91344538` (rebasado en `main` `bd0ab82d`), `npm run build` antes de todo lo que lee `dist/`. Los bloques de puertos los eligió `qa/run.mjs`. No he tocado procesos ajenos.

### Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| Tras el rebase, los guiones de la tanda | ✅ | `el-mundo-solido`: los diez bloques en verde. `--sin-navegador 250 271 273`: 3/3 en verde. `run.mjs 270 272`: 2/2 en verde (270: etapa 2 en 18,7 s y 18,6 m; 272: el tabernero cruza por el portillo y ninguna muestra sale del tile). `el-viaje-no-mete-a-nadie-dentro`: verde. Los umbrales de 271–273 son los que yo escribí: comprobado con `grep`, nadie los aflojó |
| H1 · varios a la misma casa, en el juego real | ✅ | Guion **275** (nuevo): cuatro NPC a la huella de la casa del leñador. Llegan, el par más cercano queda a ≥ 1,9 m, ninguno dentro de un sólido y los cuatro quietos en el cable. Probado en negativo: con `vecinosEn` vacío, rojo en el 4 (qa275_a–qa275_c a 0,51 m) |
| H2 · no sale a la «Zona sin generar» | ✅ | 272 verde en el juego real |
| H3 · el NPC sin camino se ve quieto de verdad | ✅ | Guion **274**: en el cable, 135 `state_update` en 5 s con `moving=false` en todos, 0 cm de deriva y 0° de giro. Lo que pinta el cliente (rAF): < 1 cm. Las dos capturas separadas 1,5 s solo difieren en la silueta del NPC (6.282 px dentro de su caja): es la animación idle de respirar. No vibra ni hace el paso de andar. Probado en negativo: con `pauseTimer = 0` al rendirse (pasea en vez de quedarse), rojo en 4, 5 y 6 (42 de 138 frames andando, 1,5 m) |
| H3 · llega al motor | ✅ con matiz | 274-2: `GET /entity/barkeep`, que es lo que lee `entity_get` del motor, trae `suspended_goal {reason:"no_path", why:"zona-sin-generar", stuck_at:[−31,1, −0,2], value:{goto_place…}}`. `serializeForLlm` la manda en las entidades y la línea en `ambient_events`: lo sujeta `bridge-npc.test.ts`, pero no lo he visto viajar en una petición real (el motor falso no guarda lo que recibe). **Matiz:** `GET /session/{id}/llm_context` está en `WorldStateApi`, pero es ruta PLANEADA y contesta 404, así que no sirve para verificarlo |
| Reapertura por cambio del mundo, en el juego real | ✅ | 274-7: el jugador genera el tile (−1, 0) (`request_tile`, motor falso, 0 €). El tabernero recupera su `goto_place` sin que el motor diga nada, se borra el `suspended_goal` y entra andando en el tile nuevo (x = −33,1) |
| Reapertura porque DESAPARECE una caja | ✅ en el sim / ⚠️ no existe en el juego | Sonda: patio cerrado por cuatro muros de runtime, y a los 20 s se quita el oeste. El NPC estaba quieto (0 s andando de 0 a 20 s), hace el tercer plan, recupera la meta y llega a los 31,5 s. **En producción no hay consecuencia que quite una caja**, así que esa reapertura solo la provocan una caja que aparece o un tile que se genera |
| Resume con un NPC en `no_path` | ✅ coherente / ⚠️ H10 | 274-6: al reanudar, el tabernero **reaparece donde empezó la partida (7,75, −0,25) con la directiva vieja y sin `suspended_goal`**. El sim no guarda por sus eventos («el save llega con el siguiente save normal») y en todo ese tramo no hubo ningún guardado. Vuelve a andar hasta el borde, se rinde otra vez (el motor lo vuelve a ver) y se queda quieto (verde en el cable). La huella perdida que declaró el ingeniero se mide en la sonda: con el patio cerrado y el resume, el NPC no reintenta cuando se abre el muro |
| Coste con 40 NPC sin camino | ✅ | Sonda en puerto y en robledo, meta en un patio cerrado. **80 planes en los primeros 30 s y 0 en los 30 siguientes** (antes: 13 planes/s sin fin). Tick medio de 0,35–0,62 ms, máximo de 12–16,7 ms y 0 ticks por encima de 16,7 ms en puerto. Una caja nueva en cualquier punto de los 3×3 tiles («un barril») cambia la huella de los 40: otra ráfaga de 80 planes, con máximo de 14,3 ms, y vuelta a 0 |
| No rompe nada | ✅ | `npm run lint` limpio con 274 y 275. `un-salto-del-guion-se-observa`, `el-reloj-de-pared-tiene-padron`, `architecture`, `la-consulta-de-movimiento-tiene-dueno`, `candados-headless-totalidad` y `banco-ficheros`: todos verdes |

### Hallazgos de la segunda vuelta

**H8 · MENOR: el NPC «parado sin camino» se pone a pasear si el jugador lo saluda.**
- `rendirseSinCamino` lo deja en `idle` con `pauseTimer = ∞` (un `hold` implícito). Pero si el jugador se acerca, `decide` lo pasa a `react`, y al irse el jugador `react` → `idle` con una pausa corta y luego `wander`.
- Sonda: parado en (−14, 0); el jugador a 1,5 m durante 5 s y luego se va. En los 60 s siguientes anda el 37 % del tiempo y se aleja 4,1 m de donde se rindió.
- El `stuck_at` que ve el motor deja de ser verdad, y «se queda parado» se cumple solo mientras nadie le habla.
- **Reproducir:** meta sin camino, esperar al `no_path`, acercarse al NPC con el jugador y apartarse.

**H9 · MENOR (antes de BO): un NPC en `react` no relee su directiva.** Con el jugador a su lado, el motor le da `goto_place` y no se mueve hasta que el jugador se va (`decide` sale por la rama `react` antes de leer la directiva). Lo encontré en 275: el vecino sembrado junto al jugador no se movía. Quien juega lo ve como «el motor le mandó ir y se queda mirándome». No es de esta tanda.

**H10 · MENOR / INFORMATIVO: el `no_path` no sobrevive a un resume si no hubo guardado desde entonces.**
- Es la misma política que la huida (los eventos del sim no guardan), no un defecto de BO.
- En la práctica el NPC repite el camino y la rendición, y el motor recibe el aviso dos veces.
- Si se guardó después del `no_path`, el NPC vuelve quieto pero sin huella: no reintenta aunque se abra el camino, hasta que el motor actúe. Es lo que declaró el ingeniero.

**H5 (huecos de 1,0–1,5 m) y H6 (gancho en las esquinas):** anotados por el ingeniero; no los he vuelto a medir.

### Guiones nuevos de la segunda vuelta

| Guion | Tipo | Hoy | Negativo |
|---|---|---|---|
| `274-el-aldeano-sin-camino-se-queda-quieto-y-el-motor-lo-sabe.mjs` | juego real, espía el cable (`state_update`) y el cliente por rAF | ✔ 16/16 | con `pauseTimer = 0` al rendirse: rojo en 4, 5 y 6 |
| `275-cuatro-vecinos-a-la-casa-del-lenador.mjs` | juego real, siembra en un clon del save | ✔ | con `vecinosEn` vacío: rojo en el 4 |

Los dos sabotajes fueron en `nefan-core/src/simulation/npc-behavior.ts` (el bridge corre con `tsx` sobre el fuente) y se restauraron comprobándolos con `md5sum -c` (OK). `git status` solo lista los dos guiones nuevos y este `qa.md`.

### Workarounds de la segunda vuelta

- **275 siembra tres vecinos editando un CLON del save** (copias del tabernero con `spawn_reason: "narrative_request"`) y lo reanuda. El State API no tiene puerta para crear entidades. El motor llega a ese estado con `spawn_reason` y el jugador por conversación; el guion se ahorra la conversación. **Veredicto:** no afecta al usuario.
- **275 aparta al jugador** (`setPlayerPos`) antes de dar las órdenes, por H9. **Veredicto:** es un hallazgo, no afecta a lo que se mide de BO.
- **Cámaras de bench** (`setPlayerPos` + `setYaw`) para las capturas. **Veredicto:** no afectan al usuario. En la de 275 un cajón del tile tapa medio encuadre: se ven las cabezas y los rótulos de los cuatro repartidos por la fachada sur, pero no los cuerpos.
- **La «sin camino» del juego real** es un lugar en un tile sin generar: es el único caso sin camino que se provoca en el tile servido sin sembrar murallas. El patio cerrado sigue medido en el sim (273, verde).

### No probado

- Que `suspended_goal` y `ambient_events` viajen en una petición narrativa real al motor. Lo cubre el unitario de bridge; el motor falso no guarda lo que recibe, y `/llm_context` da 404.
- Una caja que desaparece en el juego real: no existe esa consecuencia.
- La mutación de `busca-camino`: sigue pendiente de la corrida autorizada.

### Veredicto de la segunda vuelta

**APTO CON RESERVAS.** H1, H2 y H3 están resueltos y verificados en el juego real:
- los vecinos se reparten por la fachada;
- nadie sale al vacío;
- el NPC sin camino se queda quieto de verdad (sin vibrar, ni en el cable ni en pantalla);
- el motor lo ve y retoma la meta solo cuando el mundo cambia.

Las reservas son menores y no bloquean:
- **H8:** el parado se pone a pasear si el jugador lo saluda.
- **H10:** el `no_path` se pierde si no hubo guardado.
- **H9:** es de antes de BO.
- **H5** y **H6:** anotados.
