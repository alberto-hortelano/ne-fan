# QA — PR B de la tanda H (#645 + #644)

Árbol `/home/al/code/ne-fan-qa-hb`, HEAD `579e8c59` (`1715d2ec` = H3/#645, `579e8c59` = H4/#644)
sobre `abe5147b`. Todo con `e2e-sin-creditos` y el motor falso: **cero créditos** (el censo de gasto
de las corridas sale con `fake:true` en cliente y bridge).

La petición original es «continua resolviendo issues» sobre un banco que **no mide lo que dice
medir**, así que la pregunta que contesto no es «¿hace lo que pedía el plan?» sino **«¿el banco dice
ahora la verdad sobre sí mismo, y puede seguir diciéndola mañana?»**.

## Criterios

| # | Criterio (de la petición y del cierre de `requisitos.md`) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **#645**: «un ejecutable headless de `qa/` entra en el job el día que nace» deja de ser prosa | ✅ cumple | `qa/zz-prueba-qa-hb.mjs` (ejecutable de pega que abre Chrome por CDP, sin Playwright) → `npx tsx --test test/candados-headless-totalidad.test.ts` = **pass 13 · fail 2**, nombrándolo: «ejecutables de qa/ que no corre nadie: zz-prueba-qa-hb.mjs». Borrado después |
| 2 | #645 visto **ROJO** quitando un ejecutable de la lista | ✅ cumple | Quitando `- run: node qa/el-selector-ve-lo-que-la-bateria-abre.mjs` del yml → **fail 2**; el negativo permanente del propio test (testigo `el-viaje-…`) además lo sujeta sin tocar el fichero |
| 3 | #645 con **exenciones con motivo** y que caduquen solas | ✅ cumple | Los 6 sabotajes que declara el ingeniero reproducen rojo: exención borrada (fail 2), motivo de 3 palabras (fail 1), exención a fichero inexistente (fail 1), exención inútil `dos-corridas` (fail 1), paso del job que abre navegador `fixtures-sin-bridge` (fail 1) |
| 4 | #645: **los 9 motivos son ciertos**, no ceremonia | ✅ cumple (con matiz, H-7) | Verificados uno a uno contra el código: `sprites-sin-servicio.mjs:300` arranca `bin/sprite-forge.mjs serve`; `perfil-…:80` usa `NEFAN_SPRITE_FORGE_DIR`/`~/code/sprite-forge`; `no-mata-lo-ajeno:160` sale con 2; `presets.mjs:19` documenta «~2-3 min»; `comparar-…:28` exige `reports/mutation-base/`. Y **recronometré los dos que el ingeniero midió**: `el-arte-…` **0,42 s** y `el-indice-…` **0,81 s**, los dos con **salida 0** (él declaró 0,39 y 0,79) |
| 5 | #645: la prosa falsa se retira **entera**, no se corrige | ✅ cumple | `ci.yml` pierde el bloque de excepciones; `qa/README.md` pierde las dos tablas. Recontado: la tabla «Dentro» tenía **13 filas** para 18 pasos y la «Fuera» **20** entradas de 21 (le faltaba `fixtures-las-tres-se-caminan`) — las dos cifras del issue son exactas |
| 6 | #645: el censo se DERIVA del grafo y cuadra | ✅ cumple | Reproducido con los detectores del test: **40 ejecutables = 19 en el job + 8 navegador + 4 spawn del runner + 9 exentos**, `libsQueAlcanzanElNavegador` = ∅ (cláusula vacía, no muerta) |
| 7 | #645: el candado **dice lo que no cubre** | ⚠️ incompleto | Declara (a) navegador no-Playwright, (b) un paso que no ejerce nada, (c) `qa/guiones/`, (d) deps del runner. **No declara** que aprueba un paso que NO CORRE (H-1), ni el cierre limitado a `qa/lib` (H-5), ni el spawn en rama muerta (H-6) |
| 8 | **#644**: existe una consulta de PUNTO sin origen, cableada de core al seam | ✅ cumple | `node qa/la-consulta-de-punto-no-tiene-origen.mjs` → exit 0: cable OK, **48.387 puntos** comparados en las tres fixtures, 6.186 ocupados, **0 divergencias**, 243 ocupados por la CAJA del motor, 1.536 fuera por frontera (1.472 con diferencia declarada) |
| 9 | #644 probado **en negativo** | ✅ cumple | Reproducidos 7 de los 10 que declara: `aabbOcupa`→`false` (✖ «la mitad de las CAJAS se está midiendo»), sin política (✖ divergencias), radio 0 (✖ divergencias), `ocupadoEn`→`collidesAt` (✖ cable), un `probePoint` del seam devuelto a `collidesAt` (✖), el hook publicando `probePoint` una sola vez (✖), `QA_PUNTO_DELEGA=1` (✖ bloque 3, exit 1) |
| 10 | #644: **el 91 deja de medir por azar dentro de una corrida** | ✅ cumple | 3 corridas verdes del 91 en solitario; su aserto nuevo compara la misma línea desde 3 orígenes, uno **dentro** de la forja. Y el negativo del ingeniero se reproduce: devolviendo `huecoEntre` a `probeCollide` → ✘ **`38 · 38 · 96`**, exit 1 |
| 11 | #644: **«dos corridas seguidas dan el mismo número de muestras libres»** | ❌ NO cumple (declarado por el ingeniero) | Medido por mí en tres corridas del 91: **46 · 45 · 9** muestras libres de 121, las tres VERDES. La causa está fuera de #644, pero **no donde dice el informe** — ver H-11 |
| 12 | La deuda de mutación no crece: 8 mutantes nuevos muertos, 4 supervivientes = los mismos | ✅ cumple (verificado a mano) | `npm run mutacion -- local obstaculos-del-jugador` → **95 mutantes · 4 vivos · 95,79 % · 13 s**. Recalculé las huellas con `vivosDeFichero` del propio repo: `54060ef03334d092, 9b6510b71b41aa06, b048912ab0aa6ddf, dbc3709069fdf0bc` — **idénticas** a `mutacion-huella.json` (run 35217880491), con `total` 87 → 95. **0 nuevos, 0 resueltos** |
| 13 | `npm run verify`, umbrales y deuda | ✅ cumple | `verify` → **2953/2953 · 0 fallos** (build + 3 typechecks + lint + test). `nefan-html`: `tsc --noEmit` y `eslint .` limpios. `npm run coverage` + `crap --check` → **✔ dentro de los umbrales**, 0 por encima del tope 73, cobertura **95,86 %** de 18.457 líneas. `npm run deuda` → **87 items**, ninguno de los ficheros de esta PR |
| 14 | La batería entera desde el arranque | ⚠️ ver abajo | `node qa/run.mjs` → **137 en verde · 4 en rojo · 2 SIN MEDIR de 143**. Ningún rojo es de esta PR (dos son de la PR A, uno es #634 y otro es previo — detalle abajo) |
| 15 | El defecto de #644 sigue vivo en el JUEGO | ❌ NO cumple | H-2: la vista B de colisión se construye con `collidesAt`. Medido: 2.466 → 1.620 celdas sólidas (dist) y 435 → 382 (cliente vivo) |

### La batería, con nombre y apellidos

`137 verde · 4 rojo · 2 ⊘ de 143` (log completo en el scratchpad, `bateria-qa-hb.log`). Los cuatro
rojos, **ninguno de PR B**:

| Guion | Qué pasó | De quién es |
|---|---|---|
| `39-la-lista-de-exenciones-…` | el único aserto del 116 | **#633, PR A** — esperado |
| `141-el-replay-explica-…` | `ENOENT: scandir labs/narrative/runs` | **#639, PR A** — esperado en un worktree montado con la receta; el issue se demuestra solo |
| `75-la-huella-del-tile-no-lleva-las-salidas` | rojo en la batería, **VERDE corriéndolo solo** | **#634**, la intermitencia que `requisitos.md` declaró PREMATURA |
| `127-el-anillo-cribado-en-todos-sus-estados` | rojo **3 de 3 veces**, con **tres síntomas distintos**: `no se pudo abrir ws://127.0.0.1:9877`, `timeout: el tile tile_-1_-1 llega al mundo`, `timeout: el cliente arranca` | **no es de PR B**: lo corrí con `nefan-html/src` y `nefan-core/src` devueltos a `abe5147b` y **también sale rojo**. Es previo o de entorno, y no tiene issue |

Y los dos ⊘: el **97** (por diseño) y el **128**, que declara un bloque sin medir «el punto medio ya
era sólido antes del turno» — o sea que **depende de dónde caiga el spawn**, y corriéndolo solo sale
verde sin ⊘. El criterio de cierre «142 verde · 0 rojos · 1 ⊘» **no es alcanzable tal y como está
escrito** ni siquiera con las dos PR: quedan el 75, el 127 y un ⊘ que va a suertes.

Además, la primera corrida de la batería **murió a medias**: el navegador se cayó
(`page.screenshot: Protocol error … Unable to capture screenshot` en el guion 10, y después
`Target page, context or browser has been closed`). Relanzada, llegó al final. Lo digo porque una
batería que se cae sin veredicto se parece demasiado a una que pasa.

## Hallazgos

### 🔴 H-1 · IMPORTANTE — el candado de #645 aprueba un paso que NO CORRE

La frase que el issue viene a candar es «entra en el job el día que nace, **o no lo corre nadie**».
Lo que el test sujeta es que el ejecutable esté **NOMBRADO** en un `- run: node qa/…`, no que ese
paso llegue a ejercerse. Tres formas de dejar el job sin dientes, las tres con `npm test` **verde
(pass 15 · fail 0)**:

```bash
# 1 · el paso no puede fallar
- run: node qa/el-viaje-no-mete-a-nadie-dentro.mjs || true     → pass 15 · fail 0
# 2 · el paso no se ejecuta
- run: node qa/el-viaje-no-mete-a-nadie-dentro.mjs
  if: false                                                     → pass 15 · fail 0
# 3 · el job entero no se ejecuta
candados-headless:
  runs-on: ubuntu-latest
  if: false                                                     → pass 15 · fail 0
```

Hoy no hay ni un `if:` ni un `continue-on-error` en `ci.yml`, así que no es un defecto vivo: es el
agujero por el que este candado se convertirá en prosa otra vez, y **no está en su lista de «lo que
NO cubre»** (la (b) declarada habla del ejecutable que sale 0 sin medir, que es otra cosa).
Reproducción desde el arranque: editar el yml como arriba y `cd nefan-core && npx tsx --test
test/candados-headless-totalidad.test.ts`. Coste del arreglo: un aserto que rechace `if:`,
`continue-on-error:` y un `run` con `||`/`;` detrás del comando, sobre el bloque del job que la
función `pasosDelJob` ya está leyendo.

### 🔴 H-2 · IMPORTANTE — #644 sigue vivo EN EL JUEGO, y el informe no lo ve

`nefan-html/src/main.ts`, `fpsRenderer.setCollisionCellsProvider(…)`: la **vista B de depuración de
colisión** muestrea el `CollisionSystem` celda a celda **con `collidesAt`**, o sea con el origen vivo
del jugador. Es exactamente #644, pero dentro del cliente y no dentro del banco: el dibujo que existe
para depurar la colisión borra el sólido que rodea al jugador.

Medida, con las piezas de `dist` y el mismo cableado que usa el candado nuevo (robledo_tile, celdas
de 0,5 m como el proveedor real):

| Origen del jugador | Celdas que pinta el overlay | La verdad (`ocupadoEn`) |
|---|---|---|
| su spawn (libre) | **2.466** | 2.466 |
| dentro de un sólido | **1.620** | 2.466 |

**846 celdas sólidas (34 %) desaparecen del dibujo.** Y en el cliente VIVO, con mi guion nuevo sobre
una malla de 1 m: `probeCollide` 435 → 382 (**53 celdas, 12 %**) mientras `probePoint` da 435 en los
dos sitios.

El informe del ingeniero declara `state().blocked` (`nefan-hook.ts`) como «lo que queda con la misma
trampa» y propone issue; **este no lo nombra nadie** —ni el plan, ni la crítica, ni los requisitos—,
y es el único de los tres que no es del banco sino del juego. El arreglo es un token
(`collidesAt` → `collision.ocupadoEn`) y la herramienta la trae esta misma PR, en el mismo fichero.
Reproducción: `./start.sh --preset html-fixtures`, cargar `robledo_tile`, meterse en un edificio y
pulsar **B** hasta la vista de colisión.

### 🔴 H-3 · IMPORTANTE — media PR se revierte en verde: la migración del 32 no la sujeta nada

`git checkout abe5147b -- qa/guiones/32-nadie-nace-donde-no-cabe-su-cuerpo.mjs` no pone rojo a nadie:

- **0 anclas**: `grep probePoint|probeCollide` en `nefan-core/test/las-anclas-de-los-candados.test.ts`
  y en `qa/bateria-candados-en-negativo.mjs` → **cero**; y ninguno de los dos nombra al 91 ni al 32.
- Ni corriéndolo se nota: el 32 carga fixtures con el jugador en un punto **libre**, y desde un
  origen libre las dos consultas coinciden siempre (es la equivalencia que el propio candado afirma
  sobre 48.387 puntos).

Es el mismo molde que costó la tanda del 16-09 («con UN solo sitio revertido el guion salía exit 0»).
El 91 sí se pone rojo al revertirlo (`38 · 38 · 96`), pero **solo en la batería larga, que el CI no
corre**. Lo cierro con el guion de abajo.

### 🟡 H-4 · MENOR — circularidad: el candado de #644 no puede ver la POLÍTICA que comparten las dos consultas

`aabbOcupa` comparte `algunaCajaAplicable` con `aabbBloquea` **a propósito** (es la lección de #489, y
me parece la decisión correcta). La consecuencia es que el bloque 2 del candado compara la consulta de
punto **contra su hermana**, así que un cambio en la política mueve las dos a la vez y sale verde:

| Sabotaje en la política compartida (sobre `dist`) | Candado de #644 | Tests unitarios |
|---|---|---|
| que `decor` también frene/ocupe | **✔ verde, 0 divergencias, mismos 243/6.186** | **fail 2** |
| retirar el salto por `dueno.de === "tile" && planAplicadoEn` | **✔ verde, idéntico** | **fail 4** |

O sea: el sistema **sí** está cubierto —lo cazan los 5 casos nuevos de
`obstaculos-del-jugador.test.ts`, que corren en CI—, pero el candado promete más de lo que sujeta y su
cabecera no lo dice. Agravante medido: en las tres fixtures **la única caja aplicable es la del motor
que el propio guion planta** (todo lo demás es `dueno: tile` con el plan instalado, y el harness fija
`planAplicadoEn: () => true`), así que la política se ejerce sobre **una** caja, de **una** categoría,
de **un** dueño.

### 🟡 H-5 · MENOR — el cierre por el grafo solo recorre `qa/lib/`

Un `qa/*.mjs` que importe a **otro `qa/*.mjs`** que sí abre navegador no se clasifica como de
navegador. En la dirección segura falla ruidoso (le exige entrar en el job: medido, **fail 2**), pero
el aserto «**ningún paso del job abre navegador: el job se llama headless porque lo es**» tiene el
mismo punto ciego: metí ese ejecutable en el job y `npm test` salió **pass 15 · fail 0**. El aserto
afirma más de lo que sujeta.

### 🟡 H-6 · MENOR — un `spawn` del runner en rama MUERTA exime al ejecutable entero, en silencio

```js
if (process.env.NUNCA === "jamas") spawnSync("node", ["qa/run.mjs"], { stdio: "inherit" });
```

Con esa línea, un ejecutable que no mide nada queda fuera del censo y del job: `npm test` **pass 15 ·
fail 0**. Es la dirección peligrosa (escapar en silencio), al revés que H-5. El detector pregunta
«¿hay un nodo de spawn con este literal?», no «¿lo lanza?».

### 🟡 H-7 · MENOR — la procedencia de los nueve motivos está sobredicha en el propio contrato

`candados-headless.json` → `_comment`: «Los nueve motivos de abajo **no se inventaron: se MOVIERON**
de la tabla «Fuera» de qa/README.md». Medido contra `git show abe5147b:qa/README.md`: **solo dos**
tenían fila propia (`comparar-el-criterio-…` y `fake-enruta-…`). Los otros **siete** vivían agrupados
en dos filas genéricas («levantan asset-store, remote-gen o sprite-forge; nadie los ha cronometrado»
y «conducen el runner, un Chromium o `start.sh`») y están **reescritos**, no movidos. El ingeniero
declara **dos** de esas siete reescrituras (los dos que cronometró).

No es grave porque **los nueve son ciertos** (los verifiqué uno a uno, criterio 4), pero es la sin de
la casa —«una justificación que se escribe después no se mide»— escrita en el fichero de contrato que
nace para ser la fuente de verdad. También corrige a `requisitos.md` («los nueve motivos ya están
escritos… se mueven, no se inventan») y a la crítica («cinco sin escribir»): eran **dos** escritos y
**siete** por escribir.

### 🟡 H-8 · MENOR — la tabla retirada se llevó un dato medido

`qa/README.md` nuevo: «el tiempo medido de cada paso vive en su comentario del yml». Medido: **18 de
19** pasos lo tienen; `el-npc-cruza-ai-server-con-role-y-description.mjs` **no**, y su «2 s» solo
existía en la tabla «Dentro» que se ha borrado. La frase es falsa por un paso.

### 🟡 H-9 · MENOR — un bucle de test que no varía nada

`obstaculos-del-jugador.test.ts`, «y no depende de dónde se pregunte»: el `for` recorre cuatro
orígenes y **no usa `origen`** — son cuatro llamadas idénticas a `aabbOcupa(p, R, [forja], conPlan)`.
Es correcto (el TIPO ya hace inexpresable el defecto, que es justo el argumento del plan), pero como
aserto no puede ponerse rojo por nada que el caso 1 no cace ya. Es documentación con forma de test.

### 🟡 H-10 · MENOR — la frontera fuera de `ocupadoEn` debilita los dos guiones migrados, y no está dicho

El informe declara que la FRONTERA del plano queda fuera de `ocupadoEn` a propósito (de acuerdo), pero
no conecta esa decisión con los guiones que migra: el 32 («el jugador no nace dentro de un sólido», «todo
NPC tiene sitio») y el 91 («donde está un NPC no hay caja») **ya no cazarían** una entidad plantada a
menos de un radio del borde del mundo conocido, que antes `collidesAt` sí bloqueaba. **Hoy no cuesta
nada y lo medí**: en las tres fixtures la entidad más cercana al borde está a **8,25 m** (radio 0,4).
Es residuo declarable, no un rojo.

### 🟡 H-11 · MENOR — la varianza entre corridas está atribuida al sitio equivocado

El informe (y el comentario que deja escrito en el guion 91) dice: «el motor falso planta la forja en
un sitio distinto cada vez… lo que hay que arreglar es **el reparto de spawns del motor falso**». El
motor falso **no elige sitio**: emite `position_hint: "near_player"`
(`labs/narrative/fake-ai-server.ts:700-705`), y quien lo resuelve es
`nefan-core/src/narrative/consequence-handler.ts:229` → **`jugador + forward × 5` (+ el lateral del
reparto)**. O sea que la posición absoluta del spawn es función de **dónde está y hacia dónde mira el
jugador** en el turno 3, y eso lo decide el propio guion (cuánto anduvo, cuándo paró). Medido por mí:

| Corrida | Parada del jugador contra la forja | Muestras libres |
|---|---|---|
| 1 | (7,49, −12,58) | **46** |
| 2 | (7,49, −12,58) | **45** |
| 3 | (8,94, −1,32) | **9** |

Arreglar el motor falso no lo cambiaría. Las salidas reales son: que el guion fije al jugador antes
del turno, o un hint absoluto. El issue nº 4 que el ingeniero quiere abrir manda a alguien a la
carpeta equivocada, y ese es el trabajo que luego no se hace.

### 🟢 Un acierto que el informe no reclama (y es el mejor argumento a favor de migrar el 32)

`collidesAt(p)` preguntado con el jugador **en `p`** es **siempre `false`** (`solidoBloquea`: misma
penetración de origen y destino ⇒ no frena). Así que el aserto del 32 «**el jugador no nace dentro de
un sólido**» era, literalmente, **un verde que no podía ponerse rojo**. Con `probePoint` mide de
verdad (y sale verde: `(0.25, 3.25)`, libre). Ni el plan ni el informe lo dicen — justifican la
migración del 32 por «probar la herramienta sobre fixtures», que es mucho menos de lo que vale.

## El guion

`qa/guiones/145-la-consulta-de-punto-no-depende-de-donde-este-el-jugador.mjs` (**nuevo**, verde,
`sinMotor`, cero créditos). Cierra H-3 y deja medido H-2:

1. **Ancla estática** (lee el árbol, no la corrida): los guiones **91** y **32** llaman a
   `__nefan.probePoint` y **ninguno** a `__nefan.probeCollide` — las menciones en prosa van con
   acento grave y sin el `__nefan.` delante, así que no cuentan.
2. **El seam VIVO**: sobre `robledo_tile`, la misma malla de 4.096 celdas contada desde dos orígenes
   —el spawn y **el centro de un sólido**— con `probePoint` y con `probeCollide`. El teletransporte y
   las cuatro cuentas van en **un solo `evaluate` síncrono** para que no corra ningún frame y el
   sistema de salida del sólido (#616) no saque al jugador; después se le devuelve donde estaba.
3. **El control**: la consulta de movimiento **sí** cambia de cuenta. Sin él, «da lo mismo» lo
   cumpliría una consulta constante.
4. **Se DICE y no se afirma**: cuántas celdas sólidas pierde la de movimiento, con el puntero a
   `main.ts` (H-2). No se afirma porque es un defecto PREEXISTENTE y fuera del alcance de esta PR:
   ponerlo rojo culparía a quien no fue.

**Probado en negativo, las dos mitades:**

| Sabotaje | Resultado |
|---|---|
| una sonda del 91 devuelta a `probeCollide` | ✘ «91 no ha vuelto a la consulta de MOVIMIENTO…» — 1 llamada a `__nefan.probeCollide`, exit 1 |
| el hook: los dos `probePoint` → `collidesAt` | ✘ «la consulta de PUNTO cuenta lo mismo…» — **435 vs 382**, exit 1 |

Salida real en verde: `probePoint fuera 435 · dentro 435    probeCollide fuera 435 · dentro 382`.

## Workarounds usados

Todos para **probar en negativo**, todos restaurados; `git status` queda con **solo el guion nuevo**
sin trackear.

| Workaround | Veredicto |
|---|---|
| Editar `ci.yml` y `candados-headless.json` (6 sabotajes + 3 míos) | No afecta al usuario: el árbol se restauró desde copia y se verificó con `git status` tras cada tanda |
| Editar `nefan-core/dist/**` para sabotear `aabbOcupa` y la política | Correcto: el candado nuevo importa de `dist` a propósito. Restaurado por copia y además `npm run verify` reconstruyó `dist` desde el fuente limpio |
| Editar `collision.ts`, `nefan-hook.ts`, guion 91 y `obstaculos-del-jugador.ts` | Restaurados por copia; `git status` limpio tras cada uno |
| `git checkout abe5147b -- nefan-html/src nefan-core/src` para atribuir el rojo del 127 | Es la comprobación que faltaba, no un apaño: sin ella el 127 se le cuelga a esta PR. Restaurado con `git checkout HEAD -- …` |
| Ficheros de pega en `qa/` (`zz-prueba-qa-hb.mjs`) | Borrados |
| `nefan-core/reports/mutation/obstaculos-del-jugador.json` queda escrito (gitignored) | Es de **este worktree**, no del checkout principal, así que no bloquea un `mutacion traer`. Se va con el árbol |

## No probado

- **El job real en CI.** No hice push ni abrí PR: todo lo de #645 está medido en local. Lo que el
  runner haga con `pip install` y con los dos ejecutables que salen `⊘` sin `.venv` no lo he visto.
- **Gasto real de créditos**: cero, por diseño. Todo con el motor falso; ningún camino de esta PR
  toca una puerta de pago.
- **`npm run mutacion -- comparar/traer/repartir`**: solo corrí `local`, que es lo que la PR declara
  (y no escribe la huella). La identidad de los cuatro hashes la recalculé yo con `vivosDeFichero`.
- **Los tres guiones de la familia que NO migran** (118, 128, 119): no los he medido; el informe los
  deja con su tabla y su issue, y me parece bien.
- **El 127** más allá de «rojo también sin PR B»: no he diagnosticado su causa.

## Veredicto

**APTO CON HALLAZGOS.**

Los dos issues cierran lo que dicen cerrar y lo demuestran: el censo de headless deja de ser prosa y
se pone rojo por los siete caminos que declara, la consulta de punto existe, está cableada, coincide
con la de movimiento en 48.387 puntos y **no depende del origen**, el 91 deja de medir por azar
dentro de una corrida, y la afirmación más fuerte del informe —los cuatro supervivientes son los
mismos hashes que la huella— es **cierta y la he recalculado**.

Lo que vuelve al ingeniero, por orden: **H-1** (el candado aprueba un paso que no corre: un aserto
más sobre el bloque del job que ya lee) y **H-2** (#644 vivo en `main.ts`, un token, con la
herramienta ya en el mismo fichero). **H-3** lo dejo cerrado con el guion 145. Lo demás son
declaraciones que faltan en cabeceras y una atribución equivocada (**H-11**) que hay que corregir
**antes** de abrir el issue, no después.
