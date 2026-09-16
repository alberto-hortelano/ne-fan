# Crítica — Tanda E «El mundo es sólido»

**#601 REENCUADRADA · #583 REENCUADRADA · #538 PREMATURA.** Ninguno obsoleto. Los tres tienen sujeto
y los tres están mal dimensionados: #601 es **menor** por un lado y **mayor** por otro, #583 es
**mucho menor** de lo que dice, y #538 no se puede empezar hasta que conteste el usuario. Medido hoy
sobre `6ac0f057` (código idéntico a `b0651856`); las sondas están en el scratchpad y no tocan
producción.

## #583 — REENCUADRADA

**El problema real:** lo que el **motor pone a mitad de partida** frena al jugador y no al NPC. Lo
que declara el tile frena a los dos desde #232. El issue lo escribe como «el sim no lee la huella de
**nadie**», y eso es falso.

| Afirmación del issue | Verificación |
|---|---|
| «el sim no lee la huella de ninguna entidad de runtime» | **CIERTO.** `bridge/sim-collision.ts:70` es su única lectura de estado: `scenes_loaded[sceneId]`. `entities` no aparece en el fichero. |
| «un granero de 10×7 m … el NPC cruza» | **SOLO SI ES SPAWN DE RUNTIME.** Mismo granero, misma coordenada: declarado por el tile → `blocksCircle` **true**; puesto por el motor → **false**. |
| «#532 y #490 lo hacen más visible» | **A MEDIAS.** El `footprint` de una entity de tile llega al sim por el volumen derivado (`blueprint/derive.ts:114-140`: building/tree/prop/decor). Solo runtime queda fuera. |
| (implícito) nadie lo canda | **FALSO.** `test/sim-collision.test.ts` tiene desde #232 «los edificios que salen de una entity estática dejan de ser transparentes» (granero `[12,10]`). **5/5 verde hoy.** |

**El conflicto de premisa, dictaminado: no hay decisión que revocar.** La cabecera de
`sim-collision.ts:18-25` se reescribió **en el mismo commit** que creó la asimetría (`1f4ab084`,
PR 5 de #241/#489). Su razón —«ni necesita la caja ciega de lo que el plan ya le pone delante»— es
cierta para las cajas **del tile** y **calla** sobre las de runtime, que no están en el plan de
nadie: lo dice su vecino, `obstaculos-del-jugador.ts:100-101`. Es una justificación escrita sobre un
caso y dejada cubriendo dos. Se corrige la prosa; no se revoca nada.

**Alcance real:** solo spawns de runtime de kind `building` y `object` (categories `building`/`prop`,
`materializar-spawn.ts:71-72` + `aabbBloquea:114`). `item` y `npc` no frenan a nadie: fuera.
**El día después.** (1) El nombre y la cabecera de `obstaculos-del-jugador.ts:1-13` pasan a mentir, y
con ellos `sim-collision.ts:18-25` y el `porque` de `mutation-targets.json:767`. (2) **La caché**:
`collidersFor` cachea por `sceneId` y no invalida nunca (`:98-105`); una huella que entre por
`buildColliders` será invisible hasta recargar la escena — es la trampa concreta de esta tarea.
(3) **`narrative.entities` no es la fuente cruda**: lleva también las `scene_init` (ya en el plan →
doble conteo), NPCs y **cadáveres**, y crece sin tope. La pieza correcta ya existe:
`spawnsDeRuntime` (`session/mundo-persistido.ts:513`), la que usa el resume. (4) **Coste,
contestado**: 7 deflexiones (`npc-behavior.ts:117`) × NPCs por tick, contra un cliente que ya corre
`aabbBloquea` sobre los 20-30 objetos de un tile real dos veces por frame a 60 fps. Despreciable.
(5) **Riesgo que el issue no ve, y ahora con número**: el steering es por deflexión con `TODO(A*)` y
admite cul-de-sacs (`npc-behavior.ts:647-649`); al bloquear, `giveUpMove` manda a `idle`. Y el hueco
entre dos spawns del mismo turno es `HOLGURA_ENTRE_SPAWNS_M = 2×PLAYER_RADIUS_M + 0,2` = **1,0 m**
(`reparto-de-spawns.ts:43`), dimensionado para el cuerpo del **jugador**; la regla de la casa (#289)
exige `celdasLibresParaRadio(0,5 · 0,5)` = 3 celdas = **1,5 m** para el cuerpo del NPC, y su propio
docblock dice que el hueco admite el radio solo si es **estrictamente mayor** que el diámetro. O sea:
en cuanto las cajas de runtime sean sólidas para el NPC, **dos spawns del mismo turno le cierran el
paso**. Eso no es una hipótesis: es aritmética de dos constantes que ya están en el árbol.
(6) **Precedente a mirar**: #300 ya contestó una vez «el sim no deriva del `footprint`» — pero era
sobre el **cuerpo que se mueve**, no sobre los **obstáculos que consulta**, que es lo que pide #583.
No contradice; conviene no citarlo como si lo hiciera.

**Qué NO hacer:** reusar `aabbBloquea` tal cual — heredaría el defecto de #601 en el lado del NPC.

## #601 — REENCUADRADA

**Reproducido hoy:** `node qa/la-esquina-de-la-caja-se-corta.mjs` → **exit 0**, con la tabla del
issue clavada (0,95° · 1,45° · 3,15° · 5,25°). Sus dos puertas en negativo dan **exit 1**
(`QA_FIX_SIMULADO=1`, `QA_SIN_CAJA=1`). El reproductor es de fiar.

**Pero el issue suma dos defectos de alcance muy distinto.** Mismo edificio de 12×12 m, las dos vías:

| vía de solidez | ventana 60 fps | penetración máx. | a 45° acaba |
|---|---|---|---|
| **plan derivado** (celdas: el mundo) | 0,25° | **0,08 m** de 6 m de semiancho | a 8,38 m del centro |
| **caja** `aabbBloquea` (spawn runtime) | 0,25° | **5,99 m** de 6 m | a 0,02 m — **lo cruza** |

**El problema real:** `aabbBloquea` aplica «salir sí, entrar no» a la **caja entera**
(`obstaculos-del-jugador.ts:119-120`) donde su hermano de terreno la aplica **celda a celda**
(`terrain-collision.ts:207`), y por eso ocho centímetros de roce se vuelven cruzar un edificio. La
separación por ejes (`paso-del-jugador.ts:98-99`) es real y universal, pero **sola** solo raspa la
esquina: el síntoma que cuenta el jugador lo produce la exención por caja entera, que solo existe
para lo que spawnea el motor.

**Lo que el arreglo no cuesta, medido** (la duda razonable era el deslizamiento): con la puerta del
destino combinado, empujar en diagonal contra una pared recorre **30,21 m** acabando en
`(-0,42, 24,56)` — **idéntico a hoy**; rozándola a 85°, **41,64 m**, idéntico. En la esquina hoy
acaba en `(24,56, 24,56)` **dentro** y con la puerta en `(-0,42, -0,42)`, fuera. No se paga. Lo que
no se toca: «salir sí, entrar no» no se quita — `reparto-de-spawns.ts:19-23` razona sobre ella.
**El día después.** `qa/la-esquina-de-la-caja-se-corta.mjs` **se BORRA** con sus líneas de
`qa/README.md` (532 y 546): lo manda su propio contrato (`:36-38`), y si no se borra queda rojo para
siempre. No está en `candados-headless`, así que borrarlo no toca CI. Los tres rojos históricos del
guion 91 deben dejar de salir. Mutación a re-medir (corrida 35012863832): `obstaculos-del-jugador`
**11 vivos de 70**, `paso-del-jugador` 1 de 48. Prosa que queda mintiendo: `paso-del-jugador.ts:60-66`
y `obstaculos-del-jugador.ts:79-104`. Ojo al renombrar: `arch-rules.json`
(`la-logica-de-juego-no-vuelve-al-cliente`) tiene tokens con los nombres muertos
`frontierBlocksMove|alreadyInside`.

**Qué NO hacer:** arreglar solo la entrada diagonal. Deja intactas las otras puertas a estar dentro
de una caja (un spawn encima —#524—, un resume dentro, un empujón), y por todas se sigue cruzando.

## #538 — PREMATURA

**H2 sigue siendo cierto.** Reproducida la llamada del cliente (`main.ts:538`) con las dos fuentes de
solidez, preguntando por la posición del propio jugador: dentro de un edificio del plan → sólido
desde fuera `true`, **desde encima `false`**; dentro de la caja de un spawn → `true` / **`false`**;
campo abierto → `false` / `false`. **Los tres devuelven escalón 1.** Nadie alcanza el escalón 2
jugando. `test/reaparicion.test.ts`: 8/8 verde, incluida «lo que NO promete».

**Corrección al encargo: el dato no está caducado.** `requisitos.md:86-88` pide re-localizar el
guion; no hace falta. El 93 de hoy (`93-la-velocidad-y-el-alcance-los-dice-el-config.mjs`) **es** el
que mide la reaparición (bloque 4, «vuelve EXACTAMENTE donde cayó»), documenta H2 palabra por
palabra en su cabecera (`:45-56`) y lo REGISTRA en ejecución sin afirmarlo (`:432`). Es el único
guion del banco que afirma algo sobre reaparición. La cita del issue es correcta.

**Por qué PREMATURA.** (a) cablea una consulta de punto para alimentar una escalera de tres peldaños
que (b) puede sustituir entera: si el usuario elige `__player_start` o «último punto seguro», el
escalón 1 desaparece y el 2 con él, y (a) es trabajo tirado. **(b) se contesta primero; entonces (a)
es trivial o innecesario.** Hay una **cuarta opción que el issue no lista**: *borrar* el escalón 2 —
es una rama que ningún llamante puede ejecutar, y la casa borra el mismo día lo que ya no tiene
camino.

**Y H10 tiene TRES causas, no una — el issue solo nombra la primera.** (1) reapareces donde te
mataron; (2) el enemigo sigue `engaged` para siempre — campo privado, con pestillo y sin setter
(`combat/enemy-ai.ts:46,87-88`), que es **#377, abierto y `futuro`**; (3) **morir cura a TODOS los
enemigos a tope**: `GameLoop.respawn` hace `c.health = c.maxHealth` para cada combatiente
(`game-loop.ts:230-238`), que es **#325, abierto y `futuro`**. De ahí sale el «60/60 a un paso» del
issue. Cambiar solo (1) deja el bucle en pie: vuelves lejos, pero el enemigo sigue enganchado y
entero. Y las dos que faltan están etiquetadas `futuro` justo por la instrucción permanente del
usuario («el combate… baja prioridad»). Esto es lo que hace a #538 prematura y no solo indecisa.

## Orden de trabajo y conflictos

1. **#601 primero y solo.** Único con rojo a demanda, el más barato de demostrar, y fija la forma de
   `aabbBloquea`.
2. **#583 detrás, nunca a la vez:** hereda esa forma. **Fichero que choca:
   `src/simulation/obstaculos-del-jugador.ts`.** `bridge/sim-collision.ts` es solo de #583.
3. **#538 fuera de la tanda mientras no se conteste la pregunta 1.** Si aun así entra: (a) NO puede
   ir con #601 —necesita una consulta de PUNTO para cajas, que aterriza en el mismo fichero—; (b) es
   `reaparicion.ts` + `main.ts:538` y no choca con nada del código, pero sí con **#377 y #325**, los
   dos abiertos y `futuro`.

**Conflictos.** El único de código es #601→#583 (arriba). Los de tarea: #538(b) solapa #325 y depende
de #377. Ninguno de los 51 issues abiertos pide lo contrario —cero piden pathfinding, cero piden que
un NPC atraviese nada, cero piden coste del tick—, así que #583 no deshace nada de nadie.

Los tres comparten **una pieza que falta**: el repositorio no tiene una pregunta «¿es sólido este
PUNTO?» para las cajas, solo «¿puedo moverme hasta aquí?». De ahí salen H2 de #538 y media confusión
de #601. **Falta un hermano sin número**: si #583 entra, ningún guion del banco afirma que un NPC no
atraviesa nada (`grep` de asertos = 0); hoy solo lo sujeta `test/sim-collision.test.ts`. Y ojo al
medir: `terrain-collision.ts` y `npc-behavior.ts` están en `sin_mutar`, así que lo que se toque ahí
no lo mide la mutación.

## Preguntas para el usuario

1. **Regla de reaparición (#538b), sabiendo que el bucle tiene tres causas.** (a) donde cayó, como
   hoy — coste 0, el bucle entero se queda; (b) `__player_start` del tile — coste bajo, el campo ya
   viaja en la world scene, pero te manda lejos, pierdes el contexto y el cliente **no puede** calcular
   el centro a mano (lo prohíbe un token de `arch-rules.json`): lo pone core; (c) último punto seguro
   — coste alto, **estado nuevo** que hoy no existe ni en el save ni en el cliente; (d) donde cayó **+
   soltar el pestillo de `engaged`** — coste bajo, API nueva en `enemy-ai.ts`, pero **entra en #377,
   que usted marcó `futuro`**. **Recomiendo (a) por ahora**: dejar #538 fuera de esta tanda y llevar
   H10 entero —(1)+(2)+(3)— a la sesión de diseño de combate con #377 y #325, que es donde el propio
   #377 dice que le toca. Partirlo aquí arregla un tercio y congela los otros dos.
2. **¿Se borra el escalón 2 de `puntoDeReaparicion`?** Con (a) o (d) sigue siendo inalcanzable.
   **Recomiendo borrarlo** con su prosa (`reaparicion.ts:20-25`), la suite «lo que NO promete» y las
   líneas 45-56 del guion 93, en vez de gastar (a) en hacer observable un peldaño que nadie pisa.
3. **Cuando un NPC no pueda rodear una caja nueva (#583), ¿se queda plantado o la atraviesa?** No es
   hipotético: dos spawns del mismo turno dejan **1,0 m** y el NPC necesita **1,5 m** (arriba, con las
   dos constantes). **Recomiendo plantado:** un NPC parado se lee como ocupado; uno que cruza un
   granero se lee como que el mundo es mentira. Pero decidirlo **antes**, no descubrirlo en QA — y si
   la respuesta es «plantado», el reparto de #524 se queda corto para el cuerpo del NPC y eso es un
   issue hermano que hoy no existe.
4. **¿Entra #583 en esta tanda?** **Recomiendo que sí, detrás de #601**, y con el alcance corregido
   escrito en el issue: **solo spawns de runtime**, no «la huella de nadie».
5. **¿Y si la tanda fuera solo #601?** Es la opción barata y honesta: un defecto reproducible, un
   arreglo con coste medido a cero en deslizamiento, y un reproductor que se borra al cerrarlo. #583
   pide antes la decisión 3; #538 pide antes la 1. **No hacer nada** con #538 esta tanda es legítimo:
   el jugador lleva meses con ese bucle y el usuario ya puso el combate en baja prioridad.
