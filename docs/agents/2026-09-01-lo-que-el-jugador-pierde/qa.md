# QA — «Lo que el jugador pierde» (#350 · #351 · #352)

Validado el 2026-09-01 sobre las dos ramas apiladas, con el árbol en la punta
(`fix/de-quien-es-la-entidad-y-la-coordenada` = `f8aebc5`, sobre
`fix/un-rotulo-por-hecho` = `07dc11f`, sobre `main` = `1e17c1b`). Criterios del
§5 del «Reencuadre» de `requisitos.md`, que es el que manda.

Todo lo medido aquí sale del **flujo real desde el arranque** (`./start.sh
--preset e2e-sin-creditos` lo levanta `qa/run.mjs`, que elige bloque de puertos
libre él solo) y con **cero créditos**: cliente y bridge apuntados al motor
falso, `fake:true` declarado por el guardarraíl en cada guion, HUD a
`gasto sesión 0,00 € · total 0,00 €`.

**Ningún candado se da por bueno porque su informe lo diga.** Los siete que
sostienen los tres criterios se han vuelto a romper a mano aquí y se han visto
rojos; los negativos están en la tabla con su salida real.

---

## Criterios → veredicto

| # | Criterio (del §5 del reencuadre) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Spawneo objeto y edificio, viajo por «Salidas» y vuelvo: **siguen ahí**, sin reanudar | ✅ cumple | `node qa/run.mjs aguanta-dos-resumes` → `re-emisión del tile (sin reanudar): {"cofre":true,"forja":true,"pacifico":true,"hostil":true}`. El viaje es por el botón real del panel «Salidas» (`pulsarSalida`), no por un atajo |
| 1b | …y **tras resume + viaje**, que es donde la trampa lo reabriría | ✅ cumple | mismo guion, bloque 2 (tras DOS resumes): `{"cofre":true,"forja":true,"pacifico":true,"hostil":true}` + «ninguno se duplicó» |
| 1c | El `⚠ HALLAZGO` del guion 49 es hoy un **aserto que se pone rojo** | ✅ cumple | **negativo mío**: restaurada la purga por geometría (`!ids.has(o.id) && !inRect(o.pos)`) en `nefan-html/src/main.ts`, los DOS bloques se ponen rojos con la asimetría exacta del issue: `{"cofre":false,"forja":false,"pacifico":true,"hostil":true}` |
| 1d | El dueño de una entity no se puede olvidar | ✅ cumple | **negativo mío**: quitado `dueno: {de:"runtime"}` del push de objeto/edificio de `materializeSpawn` → `src/main.ts(2771,23): error TS2345 … Property 'dueno' is missing … but required in type 'Entity'` |
| 2 | Cualquier NPC de escena que **se movió** reanuda **donde lo dejé** | ✅ cumple | `node qa/run.mjs vuelve-donde-lo-dejaste`: bandido `[9.7066,0,1.2799]` = save exacto; tabernero en el cable `position [7.0894,0,-0.7665]` vs `declarada [7.75,0,-0.25]`. **Negativo mío**: sin `position: [...estado.posicion]`, el bandido reanuda en `[12.05,0,0.77]` ≈ su celda del Format D `(12,25 · 0,75)` — el número del issue |
| 2b | …**con su vida** (el enemigo HERIDO y movido a la vez) | ✅ cumple el juego · ❌ **no lo candaba nadie** | guion **57 nuevo**: hp `40.807412417215545` idéntica entre save y resume, y la posición también. Pero el aserto de vida del guion 54 es un verde vacío — ver **H-2** |
| 2c | El fail-loud de rect **sigue pudiendo ponerse rojo** con un NPC *recién declarado* fuera de sitio, **en el flujo real** | ✅ cumple | guion **55 nuevo**: con la `cell` del tabernero rota en el Format D del save, el cable trae `position [7.75,0,-0.25]` (DENTRO) y `position_declared [168.25,0,168.25]` (FUERA), y el panel del jugador dice `entidad "barkeep" de tile_0_0 fuera de su rect: (168.3, 168.3)` |
| 2d | …y el candado **no se debilitó** para conseguirlo | ✅ cumple | **dos negativos míos sobre el guion 55**: (a) midiendo `npc.position` (la viva) → panel mudo, `395 sondeo(s), 0 con la sonda rota`, rojo; (b) con la exención que proponía el plan (`if (npc[POSICION_DECLARADA] !== undefined) continue;`) → mismo rojo. Además **cubre más** que el bucle que sustituye: `data.npcs` entero, no solo `newNpcs + enemies` |
| 3 | **Ningún aviso a pantalla completa sale bajo un titular que nombra a otro culpable** | ✅ cumple | 8 kinds → 8 titulares distintos; solo `consequences` nombra al motor y es el único que lo es. Visto **en pantalla** para dos de los siete emisores: `restore` (guion 50, captura `titular-del-resume`) y `save` (guion **56 nuevo**, captura `titular-del-guardado`) |
| 3b | Añadir un kind sin rótulo propio **no compila** | ✅ cumple | **negativo mío**: añadido `"inventado_por_qa"` a `messages.ts` → `status-labels.ts(83,7): TS2741 Property 'inventado_por_qa' is missing … Record<…>` **y** `status-labels.ts(208,9): TS2322 Type '"inventado_por_qa"' is not assignable to type 'never'`. Saltan las dos mitades (cuerpo y título) |
| 3c | Los **siete emisores** dicen lo que de verdad pasó | ✅ el titular · ⚠️ el cuerpo | los siete kinds son correctos (verificado emisor a emisor en el diff). Dos de los siete siguen con el CUERPO en jerga — ver **H-3** |
| 3d | El único emisor honesto **no ha empeorado** | ✅ cumple | `bridge/handlers/dialogue.ts:54` (`!result.ok`) no lo toca el diff: sigue en `consequences` con el mismo titular, que ahora además es cierto por diseño y no por casualidad del catch-all |
| 4 | Candado de reaparición (arch-rule) | ✅ cumple, con su límite declarado | **negativo mío**: devuelto `kind:"consequences"` a `handlers/session.ts` → `✖ [error] ningun-aviso-culpa-al-motor`, 1 fail. Y devuelto a `handlers/dialogue.ts` (el fichero exceptuado) → **60/60 en verde**: la regla exime el fichero, tal y como su `why` declara. Ese hueco lo tapa hoy el guion 56 |
| — | **Batería completa desde el arranque, cero créditos** | ✅ | 53/53 en verde, 0 rojos, 0 `⊘` antes de tocar nada; **56/56** con mis tres guiones dentro (ver §Batería) |
| — | `status-labels` a break 100 con los mutantes NUEVOS muertos | ✅ | re-medido por mí: `npm run mutacion -- local status-labels` → `146 mutantes · 0 vivos · score 100.0% (break 100) · 19s`. El suelo no se bajó |
| — | `npm run verify` · `tsc` · `eslint` | ✅ | `nefan-core`: 1818 tests, 0 fail. `nefan-html`: `npx tsc --noEmit` y `npx eslint src` sin salida |
| — | Mutación de `mundo-persistido` | ⚠️ no probado | `break: 0`, medida **pedida y no esperada**; declarado en `implementacion.md` y en el commit. Coherente con la doctrina |
| — | El motor narrativo REAL | ⚠️ no probado | fuera de alcance: cero créditos |

---

## Hallazgos

### H-1 · importante — una posición viva corrupta borra a un NPC del mundo y **nadie lo dice**

#351 hace que `npcs[].position` del cable venga del ledger, y el fail-loud pasa
a medir la **declarada** (que es lo correcto: es la conversión celda→metro lo
que hay que vigilar). El precio, medido: **la posición VIVA ya no la vigila
nadie**, y ahora sí llega al cliente.

Reproducción, desde el arranque:

1. `node qa/run.mjs` levanta el preset; partida nueva en `alta_fantasia`.
2. Recargar al título y editar el save: `entities[].position` de `barkeep` →
   `[168.25, 0, 168.25]` (la `cell` del Format D se deja intacta).
3. Reanudar por la tarjeta.

Medido: el cable trae `{"position":[168.25,0,168.25],"declarada":[7.75,0,-0.25]}`,
**el tabernero desaparece de la escena** (ni cuerpo, ni etiqueta, ni el aviso
«hablar con Tabernero corpulento») y el panel de errores no dice **nada** de él.
Captura: `qa/capturas/2026-09-01T16-53-31-595Z-267488/…-conversion-rota-en-el-panel.png`.

Lo que esperaba el jugador: o el NPC, o una línea que le diga por qué no está.
Es literalmente el síntoma que abre esta tanda («lo que el mundo te había dado
deja de estar y el juego no te explica por qué»), solo que por la puerta nueva.

**Está declarado** como riesgo §8 del plan y como «no cubierto» en
`implementacion.md` — pero su mitigación barata (reportar **sin bloquear** las
posiciones vivas a más de un tile de su rect) no está hecha. No bloquea la
tanda: exige un save corrupto y antes de #351 esa coordenada no salía al cable.
Va a **issue**, con esta reproducción.

### H-2 · importante — el aserto de vida del guion 54 es un verde que no comprueba nada

`54-el-enemigo-vuelve-donde-lo-dejaste.mjs` afirma «…con su vida y su
denominador, que es la otra mitad del criterio» con
`hp?.maxHp === 60 && Number.isFinite(hp?.hp)`. En ese guion el bandido **nunca
recibe un golpe**, así que la vida esperada *es* el máximo: el aserto se cumple
igual con la herida borrada.

Medido: quitando `health: estado.combate.health` de `escenaConCombateVivo`
(`nefan-core/src/session/mundo-persistido.ts`), el bandido reanuda a **60/60**
teniendo el save `41.698…`, y **los guiones 42 y 54 siguen los DOS en verde**
(`2 en verde · 0 en rojo de 2`), incluida esa línea. El 42 tampoco lo caza: su
bloque de resume mide la MUERTE, no la herida.

O sea: la mitad «con su vida» del criterio 2, tal y como la escribió el usuario
—*herido* y desplazado a la vez—, no tenía candado ninguno. Con el guion **57**
sí lo tiene (igualdad exacta contra el save, probado en negativo). La línea del
54 debería **endurecerse o retirarse**: dice más de lo que mide.

### H-3 · menor — dos de los siete cuerpos siguen en jerga bajo su titular nuevo

El titular ya no miente en ninguno de los siete. El cuerpo, en dos, no está en
idioma de jugador, y se pinta **verbatim** a pantalla completa (el cliente pasa
`status.message` tal cual a `setLoaderState`):

| Emisor | Titular (nuevo, correcto) | Cuerpo que lee el jugador |
|---|---|---|
| `handlers/dialogue.ts:44` (`takeover`) | «Esta partida ya no está al mando» | «la sesión activa cambió durante la generación (era 1788…-abc, ahora 1788…-def) — resultado descartado sin escribir» |
| `handlers/dialogue.ts:54` (`consequences`) | «El motor narrativo rechazó la respuesta» | `Narrative engine error: <error crudo>` — en **inglés** |

No es regresión: los dos cuerpos ya eran así. Pero la premisa con la que se
encuadró la tanda («el cuerpo es exacto y está en idioma de jugador; lo que
miente es el rótulo») solo es cierta para cinco de los siete, y el emisor que
peor cuerpo tiene es justo el «único honesto». Los otros cinco sí están bien
(`restore`, los dos `save`, `plugin` vía `describePluginTickError`, y `action`
vía `motivoDeSesionParaElJugador`, que esta tanda arregló a propósito).

### H-4 · menor — el cuerpo de `save` repite el titular palabra por palabra

En pantalla (captura `56-…-titular-del-guardado.png`):

```
No se pudo guardar la partida
No se pudo guardar la partida tras esta reacción: si reanudas, podría faltar.
```

El jugador lee la misma frase dos veces y lo único nuevo —«si reanudas, podría
faltar»— queda al final de la segunda. Con el titular ya puesto, el cuerpo
podría empezar por la consecuencia.

### H-5 · menor — el muro de error sigue enseñando el contador «0s» del loader

Debajo del cuerpo y encima de «Cerrar» hay un `0s`: el reloj de espera del
`narrative-loader`, que en un error no significa nada. Es pre-existente, pero
ahora lo heredan cinco avisos nuevos que antes salían igual de mal por otra
razón.

### H-6 · menor — el panel de errores no se atenúa con el overlay

Mientras el muro dice la frase limpia y el mundo queda velado, el panel superior
derecho sigue a plena luz con stacks, URLs `http://localhost:3000/src/...` y
nombres de campo (`combat.max_health inválido (undefined)`). Pre-existente y
fuera de alcance, pero el efecto compuesto es que el trabajo del titular nuevo
se lee **al lado** de la jerga que quería sustituir.

### H-7 · menor — un frame WS inválido sigue saliendo como `kind: "scene"`

`bridge/ws-server.ts:294` contesta a un frame que no pasa el intake con
`kind:"scene"`, phase `error` y el mensaje «Bridge rechazó un mensaje inválido:
…». Titular resultante: **«No se pudo preparar el lugar»**, que nombra a otro
culpable (la generación del sitio) para decir que el cliente mandó basura, con
el cuerpo en jerga de bridge. No estaba en la lista de los siete y no nombra al
motor, así que **no incumple el criterio literal**; se anota porque es la misma
familia y el mecanismo nuevo (`switch` exhaustivo) ya deja sitio para su kind.

### H-8 · observación — `npm run deuda` da **71**, no los 69 del informe

Medido aquí: `Deuda medida — 71 items · Fronteras 15 · Complejidad × cobertura
11 · Mutación 45`. El informe dice 69 (43 de mutación).

**No es atribuible a la tanda**, y esto sí se puede afirmar: fronteras (15) y
CRAP (11) son idénticos; `data/contract/mutacion-huella.json` **no aparece en el
diff** de ninguna de las dos ramas; `status-labels` no tiene ni un superviviente
(re-medido a 100 %); `mundo-persistido` sigue sin medir; y el único `NUEVOS` que
la cola nombra es 1 mutante en `src/scene/blueprint/collision.ts`, atribuido a
PRs anteriores (#349, #348, …). La cifra de mutación de `deuda` se compone con
`reports/mutation/*.json`, que es artefacto **local y no versionado**: por eso
«69» no es reproducible desde otra sesión. La conclusión práctica es que *el
número absoluto de `deuda` no vale como evidencia entre sesiones*; lo que vale
es el delta por fuente, y ese no crece.

---

## Workarounds usados durante la prueba

| Workaround | Por qué no afecta al jugador |
|---|---|
| **Sabotear el save en disco** (la `cell` del Format D en `scenes_loaded[].scene_data`, guion 55; la `position` del ledger, probe de H-1) | Es la única forma honesta de fabricar una conversión celda→metro rota sin enviar el bug. Técnica ya establecida en la casa (guiones 46 y 50). El jugador no la ejecuta: lo que reproduce es el ESTADO que un bug de conversión produciría |
| **`chmod 0500` del directorio del save** (guion 56) | Es la única forma honesta de que `fs.writeFile` dé EACCES; el jugador llega ahí con el disco lleno o sin permisos. Técnica establecida (guion 52). El permiso se devuelve en un `finally` |
| **Cinco modificaciones temporales del código de producción** para los negativos (purga por rect, `dueno` fuera, `position` fuera, `health` fuera, checker debilitado de dos formas, kind sin rótulo, kind `consequences` devuelto a dos emisores) | Todas revertidas desde copia; `git diff --stat` **vacío** tras cada tanda de probes y al terminar. Ninguna es un paso de la receta: son la prueba en negativo de que los candados pueden ponerse rojos |

Ninguno de los tres tapa un obstáculo que el jugador vaya a encontrarse: no hubo
que ocultar un overlay, ni forzar estado sintético en el cliente, ni saltarse
una pantalla. Los tres criterios se ejercieron **desde el título**, con partida
nueva y reanudando por la tarjeta.

---

## No probado (y por qué)

- **`takeover`, `plugin` y `action` en pantalla.** Provocarlos pide,
  respectivamente, un segundo cliente que robe la sesión con una generación en
  vuelo, un plugin que reviente su tick (los `plugin_register` del bench pasan
  fixtures antes de entrar) y un handler que lance de verdad. Lo que **sí** está
  candado es la cadena entera menos el píxel: `test/status-labels.test.ts`
  afirma el titular LITERAL de cada uno de los ocho kinds y que solo uno nombra
  al motor; `test/bridge-routing.test.ts` afirma `kind:"action"` y su cuerpo
  nuevo; y el camino de pintado que falta por medir es el MISMO que sí se ha
  visto en pantalla con `restore` y `save`.
- **Mutación de `mundo-persistido`.** `break: 0` y medida pedida sin esperar
  (doctrina). Sus supervivientes, cuando lleguen, serán en parte de #353 y en
  parte de esta tanda; va dicho en el commit.
- **Gasto real de créditos.** Cero por construcción: el motor falso no cobra, y
  el guardarraíl lo declaró en cada guion (`cliente y bridge declaran fake:true`,
  40 veces en la batería final).
- **Calidad artística de la escena.** El bench pinta con `fake-surface-model`
  (damero de test), así que las capturas no permiten una crítica de dirección de
  arte del mundo. Lo que sí se ha juzgado como jugador es la **interfaz de los
  avisos** (H-3 a H-6), que es lo que esta tanda toca.
- **El motor narrativo real.** Fuera de alcance por la restricción de créditos.

---

## Guiones dejados en `qa/guiones/`

| Guion | Qué candá | Probado en negativo |
|---|---|---|
| `55-una-conversion-rota-sigue-encendiendo-el-panel.mjs` | el criterio **2b/2c**: con un NPC *declarado* fuera de su rect el panel del jugador se enciende, y lo que se mide es la coordenada **declarada** (dentro/fuera contrastadas en el mismo aserto) | sí, con **las dos** formas de debilitar el candado (medir la viva; exentar al marcado) |
| `56-el-aviso-de-no-poder-guardar-dice-que-no-se-guardo.mjs` | el criterio **3** en pantalla para el emisor más lejano del motor (`save`), que es además el que el arch-rule **no** puede vigilar por vivir en el fichero exceptuado | sí: devuelto `kind:"consequences"` → titular «El motor narrativo rechazó la respuesta», dos asertos rojos y el del cuerpo verde |
| `57-el-enemigo-herido-que-huyo-vuelve-con-las-dos-cosas.mjs` | el criterio **2** literal: herido **y** desplazado a la vez, con igualdad EXACTA de vida contra el save | sí, las dos mitades por separado: sin `position` cae el aserto de posición; sin `health` cae el de vida, con el otro en verde |

---

## Batería

```
$ node qa/run.mjs        # antes de tocar nada
53 en verde · 0 en rojo de 53 · capturas en qa/capturas/2026-09-01T16-37-27-172Z-253342

$ node qa/run.mjs        # con los tres guiones nuevos dentro
✔ 49-el-mundo-de-runtime-aguanta-dos-resumes
✔ 50-el-npc-que-el-cliente-no-tiene-se-dice
✔ 54-el-enemigo-vuelve-donde-lo-dejaste
✔ 55-una-conversion-rota-sigue-encendiendo-el-panel
✔ 56-el-aviso-de-no-poder-guardar-dice-que-no-se-guardo
✔ 57-el-enemigo-herido-que-huyo-vuelve-con-las-dos-cosas
56 en verde · 0 en rojo de 56 · capturas en qa/capturas/2026-09-01T17-01-48-460Z-277737
EXIT=0
```

Cero `⊘` (nada declarado «sin medir») y el guardarraíl de gasto declarado
**40 veces** (`cliente y bridge declaran fake:true`, los dos apuntando al motor
falso en `:18765`). El HUD del juego marca `gasto sesión 0,00 € · total 0,00 €`
en todas las capturas.

Fuera de la batería, y también verde:

```
$ node qa/fixtures-sin-bridge.mjs     # el camino SIN bridge, que #350 toca en addTile
✔ html-fixtures pinta sin backend
```

---

## Veredicto

**Apto con reservas.**

Los tres criterios del §5 se cumplen y los siete candados que los sostienen se
han visto rojos aquí, no solo en el informe. La desviación del ingeniero
respecto al plan (guardar la posición **declarada** en vez de marcar la viva) es
correcta y **necesaria**: con la exención que proponía el plan, el candado de
rect se queda mudo en el juego real, y eso está medido arriba.

Las dos reservas, ninguna bloqueante:

1. **H-2**: la mitad «con su vida» del criterio 2 no tenía candado — el aserto
   que decía cubrirla no puede ponerse rojo. Queda cubierta por el guion 57; la
   línea del guion 54 hay que endurecerla o retirarla.
2. **H-1**: la tanda abre una vía nueva por la que un NPC desaparece del mundo
   sin una línea en el panel (posición viva corrupta). Declarada como riesgo,
   sin mitigar; va a issue con reproducción.
