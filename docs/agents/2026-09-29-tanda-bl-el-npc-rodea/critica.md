**REENCUADRADA** — el paraguas junta cuatro problemas con tres costes distintos, y la razón por la que se aparcó ya no existe.

Rama medida: `d0cc2231` (worktree `ne-fan-tanda-bl`). `qa/el-mundo-solido-tambien-para-el-npc.mjs`, corrido hoy tras `npm run build`: seis bloques en verde y los tres `⚠ HALLAZGO` siguen vivos, con los mismos números.

## El problema real, en una frase

Un NPC con destino no sabe **encontrar un camino** en un mundo que desde #232/#583/#616 es sólido para él. Al que ya ha llegado o no va a ningún sitio, además, nadie le saca de donde ha caído.

## Las piezas, con su premisa verificada

**A · Steering sin búsqueda (el cuerpo de #618) — VIGENTE, con el síntoma corregido.**
- «Siete rumbos y `TODO(A*)`»: cierto. `npc-behavior.ts:135-136` (`DEFLECTION_ANGLES`, ±135°) y `:689`.
- «Se planta y cae a `idle`»: **falso, como ya decía el comentario del 17-sep**. Hoy: «57 s de 60 con moving=true» delante del carro de 6 m, sin avanzar. El watchdog (`:648-660`) se rinde y `goto` vuelve a derivar la misma meta. Es un NPC pisando en el sitio.
- «Las dos fuentes se comportan igual»: cierto. Hoy tile −3.00 · runtime −3.00.
- Ninguna PR posterior toca el steering. El último cambio de `npc-behavior.ts` es #641 (#616), que añadió la salida del sólido, no el rodeo.
- **La razón del aparcamiento está muerta.** Se aparcó hasta «cuando el movimiento sea plugin (#364)», y #364 se **cerró** el 24-sep con la regla «no se generaliza el registro hasta la tercera familia». Esa condición no llegará sola. Hay dos opciones: decidirlo ahora o dejarlo aparcado para siempre. No es PREMATURA.
- Coste: **grande**, una tanda entera. Un módulo puro nuevo, una consulta nueva en el adapter del mundo (`NpcBehaviorDeps.world`, `bridge/context.ts:625-634`) y la integración en `stepTowards`/`deriveGoto`. Además, tests, entrada en `mutation-targets.json` y un guion. `npc-behavior.ts` está en `sin_mutar` (`mutation-targets.json:166`). **El jugador lo ve**: es lo que más se nota de los cuatro.

**B · Al que está DENTRO y no camina no se le saca — VIGENTE, barata y más frecuente de lo que dice el comentario.**
- Premisa cierta. `porDondeSalirDeAqui` solo se consulta dentro de `stepTowards` (`:678`). El que está en `wander` sin waypoint libre vuelve a `idle` sin llamarlo nunca (`:546-551`), porque `pickWanderWaypoint` descarta sus 8 candidatos por `blocksCircle` (`:810-815`). `hold` no se mueve. El que «ya llegó» corta en `:641-644` antes de llegar a la salida. Medido hoy: «alejamiento máximo 0.00 m en 120 s».
- **Es mayor de lo escrito.** Desde #616 la salida también vale para el TERRENO. Esta pieza ya no la sufre solo quien tiene encima una caja más ancha que su paseo: la sufre todo NPC quieto dentro de un macizo del plan. Y hay un productor que no pasa por ningún umbral: `npc-director.ts:109-116` (`npc_arrive`) **teletransporta** al NPC al centro crudo del `anchor.rect`. Ahí la pieza D alimenta a esta. No lo he medido con un anchor real sobre un edificio. Es lectura del código y de la afirmación de #646.
- No depende de A. Coste: **pequeño**, 1 fichero de lógica + test + guion. El jugador lo ve en el caso del teletransporte.

**C · #298, la huida no actualiza `home` — VIGENTE. No tiene nada que ver con el steering.**
- Premisa cierta. `home` solo se reescribe en `:578` (goto/visit). La rama `flee` (`:586-603`) no lo toca. `updateDanger` devuelve al NPC a `idle` a los `COMBAT_CLEAR_SECONDS = 4` (`:118`, `:361-371`) y el micro-wander orbita el `home` viejo.
- Termina en una pregunta de diseño (quedarse, volver al acabar la pelea, o un refugio nuevo), no de pathfinding. La fusión en #618 fue por fichero, no por problema. La opción «se queda donde paró» es **pequeña** (1 fichero + test) y el jugador la ve: deja de reaparecer cada 10 s y el `NarrativeState` deja de llenarse de pares `npc_fled_combat`/`npc_resumed`. La del refugio nuevo sí necesita A.
- Necesita **una respuesta del usuario**, no un crítico.

**D · #646, meta en el centro del `anchor.rect` — VIGENTE, pero no es una pieza aparte.**
- Premisa cierta. `place-target.ts:21-26` sigue devolviendo el centro. #772 unificó la fuente del rect, no el punto. Sus llamantes son `npc-behavior.ts:482` (vía `bridge/context.ts:629`) y `npc-director.ts:109`. Ya existe `sitioParaAparecer` (`salida-del-solido.ts:295`), que es lo que usa el jugador (`bridge/handlers/scene.ts:136-138`).
- #646 tiene razón en que arreglar solo la meta del `goto` sin A cambia empujar el centro por empujar la fachada. Pero un buscador de caminos **necesita** una meta libre, así que D es una sub-tarea de A, no un issue aparte. La mitad del teletransporte (`npc_arrive`) sí vale sola y va con B.

## Pathfinding: la solución canónica y dónde viviría

Lo canónico del dominio, para un mundo que ya es una rejilla (128×128 @ 0,5 m por tile), es **A\* sobre rejilla de ocupación, en espacio de configuración**. Eso quiere decir: obstáculos inflados por el radio del agente, 8-vecindad con heurística octil y camino suavizado por línea de visión (string-pulling / Theta\*). El steering actual queda como **seguidor local** entre waypoints, y se replanifica cuando el watchdog salta o una caja de runtime corta el tramo. Navmesh (Recast) es la otra respuesta canónica, pero sobre un mundo que ya está rasterizado es sobreingeniería.

Dónde:
- El **algoritmo** va en nefan-core como módulo puro (`src/simulation/`, sin `node:*`) y entra en `mutation-targets.json` con su propio módulo.
- La **rejilla** la aporta quien ya sabe la verdad de la colisión. Esas son las tres fuentes que ya junta `bridge/sim-collision.ts`: terrain grid, plan y cajas de runtime (`:171-200`, `:113-150`). El NPC la pide por `NpcBehaviorDeps.world`, como pide hoy `porDondeSalirDeAqui`.
- Ventana de búsqueda acotada al vecindario 3×3 que ya reconcilia el bridge. `MAX_GOTO_DIST = 128` (`:116`).

**Qué NO hacer:**
- (1) Ampliar el abanico de rumbos. Está medido que no vale: cajones de 1 a 20 m, 0 llegadas.
- (2) Construir la ruta sobre la `WalkableMap` de `scene-validate.ts:452`, que es a lo que apunta el `TODO(A*)`. Esa máscara sale de la escena cruda y **no sabe de cajas de runtime**. Sería #583 del revés: rodearía el granero del tile y cruzaría el del motor. Hay que borrar ese puntero del comentario cuando se haga A.
- (3) Arreglar D sin A para `goto`.

## El día después (con A hecho)

- Para quien juega: los aldeanos rodean carros y casas, y llegan a la puerta.
- Se vuelve más difícil: la conducta deja de ser un tick sin memoria y pasa a tener estado (la ruta). Aparecen la invalidación de la ruta y su coste por petición.
- Hay que borrar: el comentario del `TODO(A*)` y su puntero a `scene-validate`, y probablemente el escape «atravesar la caja» (`rumboDePaso`, `:741-775`), que existe porque no se sabe rodear. Si se conserva, que sea solo para el cercado de verdad, que es lo que dice. Los tres `⚠ HALLAZGO` del guion tienen que **cambiar de número o pasar a aserto**.
- Lo que parecerá arbitrario dentro de un mes: tener dos respuestas a «por dónde voy», la ruta y el abanico, si no queda escrito cuál manda.

## Conflictos

- **Dependencia oculta B→A:** ninguna. B no se tira cuando llegue A: el que está dentro necesita salir antes de planificar, porque ningún A\* arranca desde una celda sólida.
- **Contradicción:** el aparcamiento de 17-sep («se retoman juntos con #364») contra el cierre de #364. Gana el cierre.
- **#613** (paraguas del bucle de muerte) no toca `npc-behavior.ts`. **#465** (verificar que el motor real afina `anchor.rect`) solo condiciona D, y D ya va con A. Nada más en la cola.

## Coste contra valor

- **No hacer nada** deja el mundo sólido a medias: el jugador ve NPCs con `goto_place` pisando en el sitio en cuanto el motor pone un pozo en medio. Hoy solo se nota con directiva persistente (`wander` se cura solo). Es aceptable como estado, pero no como estado indefinido.
- **B** vale mucho más de lo que cuesta.
- **C** es barata cuando alguien decida qué hace el que huye.
- **A** es la única cara y la única que pide una decisión de producto: pagar una tanda por conducta ambiental.

## Recomendación

- **Hacer ya**: B, más la mitad de D que lo alimenta (`npc_arrive` no deja al NPC dentro de un sólido). Una tanda pequeña, que no espera a nadie.
- **Preguntar al usuario y, con respuesta, hacer ya**: C (qué hace el NPC después de huir; la opción barata es «se queda donde paró»).
- **Decidir, no aparcar**: A, con la meta de D dentro. Su condición de desbloqueo (#364) ya no existe. O se autoriza como tanda propia con el diseño de arriba, o se cierra como «no se hará» con el síntoma documentado. `futuro` sin condición es cerrarlo sin decirlo.
- **Cerrar**: nada entero. #618 como paraguas sí, cuando se abran sus piezas: el título describe un síntoma que no existe («se planta»).

## Qué le cambiaría a `requisitos.md`

> #618 se parte en: (B) sacar de un sólido al NPC que no camina —idle, hold, recién llegado, y el teletransporte de `npc_arrive` al centro del rect—, hacer ya; (C) #298, conducta tras la huida, pendiente de que el usuario elija entre quedarse donde paró / volver al acabar la pelea / refugio nuevo; (A+D) pathfinding A\* sobre la rejilla de colisión del sim —terreno + plan + cajas de runtime, no la `WalkableMap` de scene-validate— con la meta en un punto libre del lugar, pendiente de que el usuario decida si se paga. El síntoma de A no es «se planta»: es pisar en el sitio con la animación de andar puesta.
