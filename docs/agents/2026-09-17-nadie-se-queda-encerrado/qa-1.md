# QA — PR G1 de la tanda G (#616): «de dentro se sale»

Worktree desprendido `/home/al/code/ne-fan-qa-g1`, HEAD = `be6734cc`, árbol limpio al empezar y al
acabar. Cero créditos: `html-fixtures` y `e2e-sin-creditos` con el motor falso, todo lo demás headless.
Stack propio en `NEFAN_PORT_OFFSET=700`, parado con `--parar` desde este árbol; nunca `--parar-todo`.

**Sujeto: G1 sola** — la mitad de ABAJO de «las dos mitades». La de arriba (el viaje por
`sitioParaAparecer`) es G2 y la valida otra QA; lo que he visto de ella va marcado como *contexto*.

**Resumen en una línea**: el arreglo **funciona y está medido** —de los 6.007 puntos sólidos de las tres
fixtures no queda ninguno sin salida, y en el cliente de verdad los **13 de 13** edificios de robledo y
puerto se salen andando—, pero **dos de los tres bloques del candado nuevo afirman más de lo que
sujetan**, y lo he demostrado con su sabotaje.

---

## Criterios de aceptación, literales

Salen de la petición original (`requisitos.md`: *«Sigue cerrando issues»* → decisión del usuario para
#616: **«Las dos mitades»**) y del cuerpo de #616, no del plan.

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **De dentro de un sólido del tile se SALE ANDANDO** — el observable de #616 (≥ 2 m de grosor → 0/36 rumbos) | ✅ | `node qa/nadie-se-queda-encerrado.mjs` → `6007 puntos sólidos … NINGUNO sin salida`, 41,2 s. Con horizonte FIJO de 10 s (el del plan §7), también 0, y los mínimos suben a **26 · 17 · 15** de 36 |
| 2 | …y en el **flujo real del jugador**, no en una maqueta | ✅ | `./start.sh --preset html-fixtures` (offset 700) + Chromium: puesto el jugador en el centro de cada `building` y pulsada W, **13 de 13 salen andando** — robledo 7/7, puerto 6/6. Ej.: `casa_concejo centro (-8.50,-9.50) OCUPADO=true → SALE andando a (-8.50,-3.46) libre` |
| 3 | **Y la tecla R deja de ser un callejón** (el issue dice «R tampoco saca») | ✅ | `node qa/la-puerta-de-la-reaparicion.mjs` → `99932 puntos y NINGUNO se ve sólido a sí mismo`, control `15030 de 99932 (15,0 %)`, tangencia `paso(origen = destino) = false · la CERRADA la sigue viendo sólida = true`. Reaparecer donde caíste ya no es estado sin salida porque se sale andando (criterio 1) |
| 4 | **No hay una segunda geometría**: el terreno mide lo mismo que la caja | ✅ | `test/salida-del-solido.test.ts` → `78189 puntos · \|Δpen\| máx 5.66e-15 m · 14 empates · 437 en la piel`. Sabotaje propio de `salidaDeCaja` con **1 µm** de diferencia real → **rojo** (`Δ 9.99e-7`) |
| 5 | **«Entrar no» sigue en pie** | ✅ | batería: `02-colision-desde-huella` 6 ✔, `06-el-rio…` 11 ✔, `31-el-pinar…` 10 ✔, `32-nadie-nace…` 10 ✔, `41-el-jugador-puede-pelear` 21 ✔, `45-el-porton…` 11 ✔ — **0 avisos** en los seis. Y `91-la-forja-que-el-motor-pone-ya-no-se-atraviesa` ✔ |
| 6 | **La retirada es entera y el mismo día** (`blocksMove`, `circleOverlapsCell`) | ✅ | `grep` en los 14 roots = **0**; solo quedan en `docs/` (registro histórico de tandas, fuera de los roots) y dentro del propio patrón de `arch-rules.json`. Candado probado: escrito el nombre en `qa/nadie-se-queda-encerrado.mjs` → `✖ [error] campos-retirados-no-vuelven` |
| 7 | **Lo que quedó vivo dice la verdad** (el fallo de la tanda E: cambiar una promesa falsa por otra) | ⚠ | `reaparicion.ts:25-40` corregido y **cierto** (lo verifiqué contra el criterio 1 y contra el bloque 2 del guion). `paso-del-jugador.ts`, `obstaculos-del-jugador.ts`, `terrain-collision.ts`, `npc-behavior.ts` y los guiones 31/41/45: barridos y ciertos. **Pero** `docs/arquitectura/vistas.md` §Colisión — la página que CLAUDE.md manda leer al tocar colisión — no menciona la regla nueva y sigue describiendo la salida como cosa de las cajas (**H4**) |
| 8 | **El censo de lectores del suelo está completo** (no solo los dos que él nombró) | ✅ | Censo propio sobre todos los `.mjs` de `qa/`: **exactamente 2** llamadas a `planCollisionGrid(`, las dos con `w.__plan?.…`. Ningún tercero. Y `applyPlanCollision` del cliente (`world/carga-de-tile.ts:335`) recibe `escena.__plan`: el suelo que montan **es** el del cliente, 1.608 · 3.072 · 372 celdas |
| 9 | **La cifra de cierre: 0 de 6.007 contra 3.069** | ✅ | Reproducidas al punto: árbol → `0`; `QA_SIN_ESCAPE=1` → `3069 de 6007` (833 · 2045 · 191), **exit 1** real. El conjunto de puntos es el mismo en las dos corridas (la consulta de punto no se sabotea) |
| 10 | **El horizonte derivado no ablanda el candado** (su afirmación) | ✅ | **Cierta.** Por construcción: `andarHasta` es un prefijo de frames, el horizonte solo acota el bucle y `FRAMES_QUIETO` no depende de él ⇒ acortarlo solo convierte éxitos en `null`. Y medida: con 10 s, **0 sin salida** igual, con los mínimos en 26 · 17 · 15 en vez de 9 · 7 · 9 |
| 11 | **El épsilon no tapa una diferencia real entre las dos geometrías** | ✅ (con cota medida) | Sabotajes propios: `salidaDeCaja` +1 µm → **rojo**; +1e-10 m → verde (la tolerancia del test es 1 nm). Y al revés: `EPS_EMPATE_M` a 1e-8, 1e-4, 1e-3, **1e-2 → verde**; **3e-2 y 5e-2 → rojo** (`Δ 0,0125 m`). O sea: el épsilon **no puede crecer hasta ser geometría**, pero el acuerdo solo lo canda por debajo de **~1–3 cm**, no por debajo del nanómetro que dice su docblock (**H3c**) |
| 12 | **Nada se rompe** | ✅ | `npm run verify` → `tests 2928 · pass 2928 · fail 0`. `npm run coverage && npm run crap` → `0 por encima` del tope 73, cobertura **95,97 %**. `npm run deuda` → 86 items (11 + 11 + 64), los mismos. Batería completa: **138 verde · 2 rojo · 2 sin medir de 142**, exactamente la línea base, y los dos rojos son los de siempre (#639 guion 141, #633 guion 39) |
| 13 | **Los candados nuevos miden lo que dicen medir** | ❌ | **H1** y **H2**. El bloque 2 de `nadie-se-queda-encerrado.mjs` sale VERDE con el cambio que su docblock dice vigilar, y su bloque 1 no conduce el cableado que dice conducir |
| 14 | **La lista de «qué NO queda cubierto» está completa** | ❌ | **H3**: le faltan tres cosas, y las tres las encontré midiendo |
| 15 | **Experiencia del jugador** (crítica visual y fricción) | ⚠ | **H6**. La escena no cambia —correcto, la PR no toca render— pero el estado «dentro de un edificio» no tiene un solo píxel de feedback |
| 16 | La mitad de ARRIBA (el viaje no mete a nadie dentro) | ⚠ no probado | Es **G2**. *Contexto medido*: los **13 de 13** centros de `building` están OCUPADOS y `sitioParaAparecer` devuelve un punto **libre** a ≤ **3,90 m** en un paso (reproduce §5-bis exactamente) |

---

## Hallazgos

### H1 · IMPORTANTE — el bloque 2 del candado sale verde con el sabotaje que dice vigilar

`qa/nadie-se-queda-encerrado.mjs:35-40` afirma de sí mismo:

> *«si alguien cambiara la salida por «el primer eje libre» en vez de «el de menor penetración», los
> puntos tardarían de más y esto se pondría rojo sin que el punto 1 se enterara»*

**Hice exactamente ese cambio y el guion sigue verde, exit 0.**

Reproducción desde cero:

```bash
# en salida-del-solido.js (o .ts), salidaMedida pasa a ser:
#   return marchaPorEje(x, z, radio, suelo, true, 1);   // «el primer eje libre»
node qa/nadie-se-queda-encerrado.mjs
```

Salida real de mi corrida con ese sabotaje:

```
robledo_tile  ·  2010 puntos sólidos · sin salida: 0 · rumbos mínimos 7/36 · penetración máxima  7.40 m
puerto_tile   ·  3538 puntos sólidos · sin salida: 0 · rumbos mínimos 5/36 · penetración máxima 38.40 m
zorder_test   ·   459 puntos sólidos · sin salida: 0 · rumbos mínimos 9/36 · penetración máxima 10.40 m
  ✔ 6007 puntos sólidos en las tres fixtures y NINGUNO sin salida
  ✔ los 6007 puntos con salida la tienen por el eje de menor penetración
✔ de todo punto sólido de las tres fixtures se sale andando (#616)        ← exit 0
```

**Por qué no puede ponerse rojo**: el límite del bloque 2 es `tope = pen / VELOCIDAD + 2/FPS`, y ese
`pen` sale de `penetracionEnSolido`, que es **la función que el sabotaje cambia**. Al inflarse la
penetración (puerto: 5,90 → **38,40 m**, a un pelo del tope de marcha de 40), el «límite derivado» se
infla con ella y no puede excederse nunca. **No es un límite derivado de la geometría: es un límite
derivado de la implementación bajo prueba.** Lo único que delata el sabotaje es la penetración máxima,
que el guion **imprime sin afirmar**.

*Qué esperaba yo como lector del guion*: que ese bloque fuera el segundo candado del invariante. *Qué
hay*: un bloque que no puede distinguir «se sale por lo más corto» de «se sale por donde sea».

**Mitigación que sí existe, y conviene decirla junto al hallazgo**: `test/salida-del-solido.test.ts` **sí**
mata ese mutante (mismo sabotaje sobre el `.ts` → `pen caja 0.0625 vs sólido 5.7375 (Δ 5.675)`). El
invariante está sujeto; lo que está mal es **lo que el guion dice de sí mismo**, y en esta casa eso se
paga caro el día que alguien se apoye en la frase.

### H2 · IMPORTANTE — el candado no conduce el cableado del cliente, y la diferencia no es cosmética

`qa/nadie-se-queda-encerrado.mjs:26-32` dice conducir *«con el mismo cableado que
`nefan-html/src/world/collision.ts`»*. El cliente une **tres** fuentes en `collidesAt`
(`collision.ts:99-105`): `fronteraBloquea` → `solidoBloquea` → `aabbBloquea`. El guion cablea **una**.

Medido con las tres montadas y por lo demás idéntico (mismo suelo, misma malla, mismos 36 rumbos,
un tile solo con los ocho vecinos ausentes, que es lo que hay en `html-fixtures`):

| cableado | horizonte | sin salida de 6.007 |
|---|---|---|
| solo suelo (el del guion) | derivado `pen/v + 0,25 s` | **0** |
| **las tres fuentes** | derivado `pen/v + 0,25 s` | **126** (robledo 2 · puerto 124) |
| las tres fuentes | largo (8–10 s) | **0** — el más lento sale en **1,42 s** |
| las tres, con la regla de AYER | largo | **3.117** |

Y: **426 de los 6.007 puntos**, tal como el guion los mide hoy, terminan su salida **fuera del rect del
tile** (robledo 86 · puerto 340) — es decir, escapan atravesando la frontera del plano, que el cliente
hace sólida.

Lo importante para no exagerar: **el jugador sí sale**. Con tiempo, los 126 salen rodeando, y lo
confirmé en el cliente real — en robledo (12, −31,5) y (12, 31,5), que son dos de ellos, el jugador sale
por el rumbo 4 y por el 2 respectivamente. Lo que falla es el candado: **si cableara lo que dice
cablear, se pondría rojo en 126 puntos**, porque su horizonte derivado deja de ser una cota válida en
cuanto el eje de menor penetración da a un tile que no existe.

Reproducción: `node qa/los-candados-miden-el-mundo-del-cliente.mjs` (el guion que dejo, ver abajo).

**Corolario honesto para la cifra de cierre**: sobre el cableado del cliente, #616 va de **3.117 de
6.007** a **0** con presupuesto de tiempo suficiente, y a **126 que necesitan rodear** con el
presupuesto que el candado se concede. El titular «0 de 6.007 contra 3.069» es cierto del cableado que
midió, no del que juega el jugador.

### H3 · MENOR — a la lista de «qué NO queda cubierto» (§7) le faltan tres cosas

La lista es buena y las cinco cosas que declara son ciertas (las verifiqué todas: `mutacion -- local
salida-del-solido` se niega con «no hay medida previa»; `pendiente` lista `1 módulo(s) sin base:
salida-del-solido`; `terrain-collision.ts` y `npc-behavior.ts` siguen en `sin_mutar`;
`sitioParaAparecer` no tiene llamante de producción —`grep` = 0, solo una mención en un comentario de
`reaparicion.ts:38`—; la saturación de 40 m no es alcanzable con 5,90 m de penetración máxima). Faltan:

**(a) El cableado del propio candado** — es H2, y es justo lo que §7 declara como cubierto:
`mutation-targets.json` escribe que el cableado *«lo sujetan `test/sim-collision.test.ts` y
`qa/nadie-se-queda-encerrado.mjs`»*. Ese guion no sujeta el cableado del cliente porque no lo monta.

**(b) El caso de las DOS fuentes a la vez, que esta PR estrena y nadie prueba.** `porDondeSalirDeAqui`
pasa a contestar «terreno primero», con su motivo escrito. No hay **ni un test** con un cuerpo dentro de
la geometría del tile **y** de una caja de runtime (`grep porDondeSalirDeAqui` en `test/`: los casos son
solo-caja o solo-tile). Lo monté y esto es lo que sale:

```
dentro del GRANERO y del CARRO  (-9.25,-11.25) ocupado=true
    salida = {"de":"tile","dir":{"x":0,"z":-1}}
    rumbos libres 2/36 · el RUMBO DE SALIDA está FRENADO por {"de":"caja","id":"carro"}
```

El sistema entrega un rumbo que el propio sistema se niega a andar. No es una regresión —con el orden
de antes pasa lo simétrico: `{de:"caja",dir:(0,+1)}` y su rumbo lo frena `{de:"tile"}`— y el plan §6(4)
ya lo nombra como backlog («la penetración sobre la UNIÓN lo cierra»), pero **no está en §7**, que es
donde se declara lo que no queda cubierto.

**(c) La cota real del épsilon**: el acuerdo con `salidaDeCaja` no lo canda al nanómetro, lo canda a
**~1–3 cm** (medido: 1e-2 verde, 3e-2 rojo). El número está bien elegido; lo que no está dicho es que
quien lo suba dos órdenes de magnitud no se entera.

### H4 · MENOR — `docs/arquitectura/vistas.md` se queda con la foto anterior

Es la página que `CLAUDE.md` manda leer *«cuando toques renderer, cámara, colisión»*. Su §Colisión
enumera las fuentes y explica la salida como algo **de las cajas** (`:226-230`: *«al que se queda DENTRO
de una caja recién puesta se le da el rumbo de su cara más cercana»*). Tras esta PR el terreno hace lo
mismo y con la misma cuenta, y ahí no lo pone. No es una frase falsa, es la única página viva que
describe el sistema y ha dejado de describirlo entero. El plan §5 solo listó prosa **de código**.

*(Aparte, y no es de esta PR: `docs/auditoria-2026-08.md:196` cita `TerrainCollider.blocksMove` como
código vivo. Es un registro de agosto, tachado como RESUELTO; lo anoto para que nadie lo lea como
arquitectura de hoy.)*

### H5 · MENOR — `la-puerta-de-la-reaparicion.mjs` parte la regla que dice montar entera

Su cabecera dice montar las fuentes *«como las monta `world/collision.ts`»*, y el cliente **une** los dos
colliders del tile en **una** consulta de punto (`collision.ts:75-84`, con el motivo escrito: *«un cuerpo
a caballo de dos tiles tiene UNA penetración, no dos»*). El guion los pregunta por separado
(`:210-212`: `solidoBloquea(…, sueloTerreno)` y luego `solidoBloquea(…, sueloPlan)`) con el motivo de
conservar el mensaje del contraejemplo. **Hoy da el mismo veredicto** —con origen libre las dos formas
colapsan en `ocupado(hasta)` y con origen = destino las dos dan `false`—, así que no cambia ningún
número de esa corrida. Pero es la misma clase de divergencia que H2 y está a una línea de morderle a
quien la reutilice.

### H6 · MENOR (experiencia) — estar dentro de un edificio no tiene un solo píxel de feedback

Capturas propias en el cliente real (robledo, `casa_concejo`): dentro, el tercio superior del encuadre
es una losa roja plana —el tejado por dentro—, dos losas negras sin luz a media distancia, y el pueblo
visible **a través** de las paredes que el back-face culling no dibuja. Nada en el HUD dice qué pasa ni
qué hacer. Antes de #616 eso era permanente y el jugador estaba muerto; ahora dura **0,65–1,5 s** si
empuja en cualquiera de la mitad de la rosa, así que el coste ha bajado muchísimo — pero el jugador que
suelte el teclado se queda mirando una imagen rota sin ninguna pista. No pide arreglo en esta PR;
pertenece a la conversación de la mitad de arriba (aparecer en la PUERTA y no en la cocina) y merece
issue propio si el estado va a seguir siendo alcanzable.

### H7 · TRIVIAL — una frase del informe no es exacta

*«Ninguna función de los ocho ficheros tocados aparece en la cola de CRAP (`grep` de sus rutas en
`npm run crap` = 0 líneas)»*. En mi corrida sí aparecen dos, las dos de `npc-behavior.ts` y las dos
**preexistentes**: `decide` (CRAP 40, complejidad 31, cobertura 79 %) y `move` (CRAP 29). `npm run
deuda` las lista igual que antes de la tanda y esta PR no toca esas funciones. La conclusión del
informe («ningún umbral se tocó, la deuda no crece») **es correcta**; la frase que la sostiene, no.

---

## Crítica visual (director de arte)

Miradas las tres capturas que dejó (`/home/al/code/ne-fan-g1/qa/capturas/las-tres-*.png`; en mi árbol no
están, `qa/capturas/` no se commitea) y tres propias tomadas desde **dentro** de un edificio, que es el
estado del que va la PR y que sus capturas no muestran.

- **Luz**: una sola, baja y cálida, coherente en las tres. Los tejados rojos, el suelo y las copas leen
  bien; las sombras largas caen todas al mismo lado. Nada de esto lo toca la PR y nada de esto se movió.
- **Lo que chirría, y es de antes**: los volúmenes greybox grandes tienen una cara **completamente
  negra** con esta luz. En `las-tres-robledo_tile.png` el primer plano son tres masas marrones y negras
  que no leen como nada; en mi `g1-ya-fuera.png` la pared del concejo ocupa un tercio del encuadre como
  un agujero negro. Con la casa texturizada al lado, la escena parece «una casa terminada rodeada de
  cajas de mudanza». Es el modo sin imagen, es conocido, y no es de esta tanda — pero es lo que un
  jugador ve al salir de un edificio, que es el momento que esta PR estrena.
- **Dentro del edificio** (`g1-dentro-de-casa-concejo.png`): tejado rojo plano ocupando el tercio
  superior, dos losas negras, y el mundo visible a través de las paredes. Es exactamente lo que se
  espera de una cámara dentro de una caja con las caras traseras culled, y dura poco — pero es H6.
- **Legibilidad**: el registro de errores de `html-fixtures` tapa un cuarto del encuadre y en
  `las-tres-zorder_test.png` se come dos rótulos («casa E», «casa NE»). Es el preset, no la PR. Y el
  texto de estado de abajo a la izquierda (`Atlas fps de tile 0_0…`) es gris oscuro sobre verde oscuro:
  ilegible. Preexistente.
- **Escalas**: el NPC de puerto llega justo al alero de las casas y el de robledo cabe en el vano; nada
  desproporcionado.

---

## El guion que dejo

`qa/los-candados-miden-el-mundo-del-cliente.mjs` — **15,7 s**, headless, sin stack y sin créditos.
Añadido a `.github/workflows/ci.yml` (job `candados-headless`) **el día que nace**, con su tiempo
medido en árbol limpio, y con su ficha en `qa/README.md`.

Afirma tres cosas, que son la parte mecánica de este informe:

1. **CENSO DEL SUELO** — todo `.mjs` de `qa/` que llame a `planCollisionGrid(` lo hace sobre `__plan`.
   Se leen los ficheros del árbol, no una lista: el guion que nazca mañana entra solo. Con control (si
   el patrón deja de casar, lo dice) y **una** exención escrita, la del propio guion, que monta el
   declarado como control del bloque 2.
2. **Y ESE SUELO ES OTRO MUNDO** — el compuesto tiene más celdas sólidas que el declarado en robledo
   (960 → 1.608) y puerto (2.144 → 3.072), y el suelo EN USO es el compuesto. Sin esta diferencia el
   bloque 1 sería una regla de estilo.
3. **CON LAS TRES FUENTES TAMPOCO HAY ENCIERRO** — `collidesAt` entero (frontera + suelo unido +
   cajas), un tile solo con los ocho vecinos ausentes, dos pasadas: la primera con el horizonte corto
   del otro guion, la segunda solo para los que no llegan. **0 de 6.007 sin salida**, y mide sin
   afirmarlo los **126** que necesitan rodear (el más lento sale en 1,42 s, de un horizonte largo de 8).

**Probado en negativo, las tres puertas** (esto es lo que hace que no sea un verde decorativo):

| sabotaje | resultado |
|---|---|
| `QA_SUELO_CRUDO=1` | bloque 2 **rojo** (960 en uso contra 1.608 del cliente) y el mundo baja de 6.007 a **3.941** puntos sólidos · exit 1 |
| `QA_REGLA_DE_AYER=1` | bloque 3 **rojo**, **3.117 de 6.007** sin salida · exit 1 |
| `__plan` → `crudo` a mano en `qa/la-puerta-de-la-reaparicion.mjs` | bloque 1 **rojo** nombrando fichero y línea. Revertido; `git status` limpio |

---

## Workarounds usados durante la prueba

| Workaround | Veredicto |
|---|---|
| `__nefan.setPlayerPos` para meter al jugador dentro de un edificio | **No es hallazgo, y lo declaro**: es byte a byte lo que hace el teletransporte del viaje (`main.ts:946` escribe `playerPos`), y ese viaje es la vía por la que el estado se alcanza jugando — la mitad de arriba, que es G2. Sin G2 en este árbol no hay otra forma de llegar: #601 cerró la entrada andando |
| Medir la ocupación con `probeCollide(p, p)` | **Error MÍO, y vale la pena escribirlo**: con el jugador EN `p` eso vale `false` **por construcción** (es justo lo que mide `la-puerta-de-la-reaparicion`), así que mi primera corrida dio «13 de 13 salen» sin que el jugador se moviera un centímetro. Corregido preguntando desde otro punto libre. Quien mida esto en el navegador va a tropezar aquí |
| Sabotajes en el árbol (épsilon, `salidaDeCaja`, `salidaMedida`, nombres retirados) | Práctica estándar de la casa para probar candados en negativo. Todos revertidos; `git status` limpio y `npm run verify` volvió a 2928/2928 |
| **Ninguno** para mirar las capturas | No oculté el registro de errores ni nada del HUD: miré la escena alrededor de él |

---

## No probado, y por qué

- **El coste del bridge** (la tabla re-medida de `sim-collision.ts`, los 18 µs y el 9 % de núcleo). No
  lo he re-cronometrado; no tengo motivo para dudarlo y no tengo medida propia.
- **La sonda del NPC de §5** (sale en 2,53 s con `porDondeSalirDeAqui` y en 2,60 s sin él, o sea que
  quien saca es la regla de paso). No la repetí. Sí verifiqué la pieza nueva que la hace posible:
  `porDondeSalirDeAqui` contesta hoy `{de:"tile", dir:…}` dentro de la geometría del tile, cosa que
  antes era `null` siempre. Y `qa/el-mundo-solido-tambien-para-el-npc.mjs` sigue verde.
- **La mutación del módulo nuevo**: `break: "sin medir"`, la corrida no está autorizada. Verificado que
  `local` se niega y que `pendiente` lo lista; nada más.
- **Dos guiones de `candados-headless` salen `⊘ SIN MEDIR` en este árbol** —
  `el-npc-cruza-ai-server-con-role-y-description` y `el-ledger-de-gasto-no-lo-escribe-la-suite`— porque
  el worktree no trae el `.venv` con las deps de Python (`anthropic`, `fastapi`). **No es rojo y no es
  de G1**: los otros 13 del job, más el mío, van a exit 0.
- **Gasto real de créditos**: cero, y no lo he probado de otra forma. Todo `html-fixtures` (sin
  backend) y `e2e-sin-creditos` (motor falso); el censo de gasto de la batería sale contra el falso.
- **La mitad de ARRIBA de #616**: es G2 y la valida otra QA.

---

## Veredicto

**APTO CON RESERVAS.**

Lo que se pidió está hecho y está medido: de dentro se sale, en el núcleo y **en el juego de verdad**,
13 de 13 edificios; la retirada es entera y candada; no hay segunda geometría y lo he intentado tumbar
con un sabotaje de un micrómetro; el horizonte derivado es más estricto y lo he demostrado; la batería
queda donde estaba y `verify` en 2928/2928. El ingeniero además se encontró a sí mismo el fallo que
habría hecho de esto un verde vacío, y lo escribió.

Las reservas son **H1 y H2**, y son la misma lección de esta casa por octava vez: *el candado cubre
menos de lo que promete su nombre, y lo caza QA*. Ninguna de las dos tumba el arreglo —el invariante lo
sujeta el test unitario y el jugador sale— pero las dos dejan escrito en el repositorio algo que no es
cierto, y la siguiente persona se apoyará en ello. Lo que pido antes de cerrar:

1. **H1** — o el bloque 2 deja de derivar su límite de la función que mide (por ejemplo, contra la
   penetración de la geometría y no contra `penetracionEnSolido`), o su docblock deja de prometer que
   caza «el primer eje libre». Una de las dos, no media.
2. **H2** — que el bloque 1 monte las tres fuentes, o que su docblock diga que monta una. Si las monta,
   nacen 126 rojos que hay que decidir: son salidas legítimas con rodeo, así que lo natural es el
   horizonte de dos pasadas que dejo en mi guion.
3. **H3** — añadir las tres ausencias a §7 (el cableado, el caso de las dos fuentes, la cota del
   épsilon). Lo que se declara no cubierto se cree; por eso tiene que estar completo.
4. **H4** — una línea en `docs/arquitectura/vistas.md` §Colisión.

H5, H6 y H7 son de coste casi nulo y no bloquean nada. H6 merece issue propio si el estado va a seguir
siendo alcanzable después de G2.
