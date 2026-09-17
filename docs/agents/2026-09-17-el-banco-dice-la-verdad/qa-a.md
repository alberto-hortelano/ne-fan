# QA — PR A de la tanda H (#633 + #639)

**Veredicto: APTO CON HALLAZGOS.** Las dos piezas hacen lo que dicen y las medí en el flujo
real; lo que fallo es la **mitad general de #639**, que se puede revertir entera dejándolo todo
en verde, y la **frontera del gasto del 39**, que después de esta PR está escrita como si fuera
completa y cubre **uno de al menos cinco clicks que gastan**.

- Árbol: `/home/al/code/ne-fan-qa-ha`, HEAD `37f0dcc5` (PR A = `5db8194e` #633 + `37f0dcc5` #639),
  base `abe5147b`. Worktree montado con la receta: **sin `labs/narrative/runs/`**.
- Cero créditos en todo: preset `e2e-sin-creditos` levantado por `qa/run.mjs`, y el censo de gasto
  de cada corrida salió `0 guion(es) tocaron alguna puerta`. No arranqué ni paré ningún stack
  ajeno; no usé `--parar-todo` ni maté por puerto.
- Guion nuevo: `qa/guiones/146-el-verde-de-un-guion-no-lo-decide-el-runner-a-solas.mjs`
  (10 asertos, probado en negativo con **cuatro** sabotajes).

## Criterios

Los criterios salen de la petición («continua resolviendo issues» sobre un banco que no mide lo
que dice medir) y del criterio de cierre de `requisitos.md`, no del plan.

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | **#633** · el 39 deja de prohibir un click que no gasta | ✅ | `node qa/run.mjs exenciones-del-guardarrail` → `1 en verde · 0 en rojo de 1`; en la batería real: `✔ …y el exento que pulsa «Comenzar» (#ts-start) se trae SU propio motor` |
| 2 | **#633** · y sigue cazando al exento que SÍ arranca partida | ✅ | Guion de pega exento con `ctx.page.click("#ts-start")` y sin `NEFAN_AI_SERVER` → `✘ … — zzqa-pega-start`, y **solo a él** (el de `#ts-continue` y el de `#ts-gen-world` presentes en la misma corrida, verdes) |
| 3 | **#633** · el click inocuo deja de ser rojo | ✅ | Pega exento que solo pulsa `#ts-continue` → verde. Verificado además en el código: `selector-de-mundo.ts:167` → `deps.ir({a:"editor"})`; el editor solo hace `fetch("/sprites/index.json")` (`editor-de-personaje.ts:78`) y sus únicas otras salidas son `deps.ir` y `deps.elegir` |
| 4 | **#633** · la frontera del gasto que el docblock enumera es la real | ❌ | Un pega **exento** que pulsa `#ts-gen-world` (= `regenerarMundo`, o sea `narrative.generateGame`) pasa el 39 **en verde**. Ver H-2 |
| 5 | **#639** · el 141 sale `⊘` en un árbol montado con la receta | ✅ | `node qa/run.mjs 141-el-replay` sin `labs/narrative/runs/` → `⊘ … labs/narrative/runs/ no existe`, exit 2 |
| 6 | **#639** · y también con el directorio presente y VACÍO | ✅ | `mkdir -p labs/narrative/runs` → `⊘ … labs/narrative/runs/ está vacío`, exit 2 |
| 7 | **#639** · y MIDE cuando hay grabaciones | ✅ | Copiadas las 8 del checkout principal → `1 en verde de 1` con sus 8 `✔ <grabación>: desenlace explícito` |
| 8 | **#639** · un guion que no afirma nada deja de salir verde | ✅ | Pega mudo → `✘ no afirmó NADA: …` y **exit 1** (rojo, no ⊘); el control con un aserto, verde |
| 9 | **#639** · el candado nace verde: 142 afirman siempre · 1 puede no afirmar · 0 nunca | ✅ | **Remedido con instrumento propio** (acorn, no el AST de TypeScript del ingeniero): `142 / 1 (el 141) / 0`, y los mismos 3 helpers de `qa/lib` que afirman siempre. Probado en negativo sobre un árbol de pega |
| 10 | **#639** · la regla se puede volver a romper sin que nada chille | ❌ | Revertido **solo el cable** en `qa/run.mjs`: `npm test` → **2940/2940 verde**, y el pega mudo → **verde, exit 0**. Ver H-1 |
| 11 | El contador de asertos no lo puede falsificar el sujeto | ❌ | Pega mudo con `ctx.afirmaciones = 7` → **VERDE**. Ver H-3 |
| 12 | Las dos no-coberturas que el ingeniero declara son las que dice | ✅ | Mudez PARCIAL (11 asertos en un bucle vacío + 1 fuera) → verde; `ctx.expect("ok", true)` → verde. Las dos, como está escrito |
| 13 | La prosa del banco no se queda diciendo la regla vieja | ❌ | `qa/README.md:141` sigue diciendo «`ctx.expect(…)` apunta un criterio; **los fallos deciden el veredicto**». Ver H-4 |
| 14 | `npm run verify` verde y sin tocar umbrales | ✅ | `npm run verify` completo (build + tres typechecks + lint + test): **2940/2940, fail 0**. Corrido además dos veces solo `npm test` (baseline y con el cable cortado) |
| 15 | La batería ejercita a los 143 y NINGUNO sale mudo | ✅ | **La corrida entera llegó al final en este árbol** (no murió en el 127): `139 en verde · 2 en rojo · 2 SIN MEDIR de 143`, y **cero** «no afirmó NADA». Es la confirmación DINÁMICA del censo estático |
| 16 | Batería entera en verde (criterio de cierre de la tanda) | ❌ | Dos rojos, **ninguno de esta PR**: el 127 (el conocido, `net::ERR_INSUFFICIENT_RESOURCES`) y el **120**, que nadie había declarado. Ver H-6 |

## Hallazgos

### H-1 · BLOQUEANTE (de instrumento) — la mitad general de #639 se revierte en verde

El cable entre la regla y el juicio real vive en tres líneas de `qa/run.mjs` y **nada lo sujeta**.
Devolviendo el `estado: ctx.fallos.length === 0 ? VERDE : ROJO` de antes y quitando
`veredictoDeGuion` del import —tres líneas, el diff exacto que la PR añade—:

```
$ npm test                       # nefan-core, con el cable cortado
ℹ tests 2940 · pass 2940 · fail 0

$ node qa/run.mjs zzqa           # el mismo guion mudo que arriba sale ✘
✔ zzqa-pega-habladora
✔ zzqa-pega-muda
2 en verde · 0 en rojo de 2 · EXIT=0
```

Y la batería tampoco se entera, por construcción: el 141 —el único de los 143 que podía caer en
la red— **declara su ⊘ antes de llegar a ella**, así que después de esta PR el candado general
**no tiene un solo sujeto vivo** entre los guiones. Medido en la corrida completa de este árbol:
143 guiones ejercidos, **cero** «no afirmó NADA». Su única prueba de que puede ponerse rojo es un
guion sintético — lo cual está bien para nacer, y es exactamente por lo que el cable necesita su
propio candado.

Esto es exactamente lo que la PR hermana hizo mal hace unas horas (un candado que aprueba un paso
del CI que no corre) y es **la misma frase del ingeniero la que lo vende de más**:

> «La decisión vive en `qa/lib/`, y no en `run.mjs`, **a propósito**: […] así que el negativo de
> la forma general es un test unitario que corre en CI y no una batería de navegador.»

Lo que corre en CI es el negativo de la **función**, no el del **candado**. La regla que decide el
color de un guion sigue viviendo donde ningún test la ejerce. Es el candado que afirma más de lo
que sujeta — en la misma PR que arregla un caso de eso.

**El molde para cerrarlo ya existe en la casa y es del mismo fichero**:
`nefan-core/test/sonda-de-qa.test.ts` canda el SITIO DE LLAMADA de `presupuestoConducido` leyendo
el árbol de `qa/run.mjs`, y nació con esta frase: *«la regla vivía en una línea de `run.mjs` que
ningún test podía ejercer sin abrir un navegador»*. Aquí son tres líneas.

**Reproducción desde el arranque**: partir de `37f0dcc5`, revertir en `qa/run.mjs` el bloque del
veredicto (`:1508-1520`) y el `veredictoDeGuion` del import (`:73`); `npm test` en `nefan-core` →
verde; `node qa/run.mjs <cualquier filtro>` → idéntico.

**Lo que dejo hecho**: `qa/guiones/146-el-verde-de-un-guion-no-lo-decide-el-runner-a-solas.mjs`
lee el árbol de `run.mjs` y se pone rojo con ese revert. **Pero vive en `qa/guiones/`, o sea que
solo corre en la batería local** — que es justo por lo que el rojo de #633 vivió dos días sin que
nadie lo viera. Lo correcto es subirlo (o duplicarlo) a `nefan-core/test/` con el molde de
`sonda-de-qa.test.ts`, y entonces corre en cada PR. Lo digo aquí porque **yo no arreglo nada**.

### H-2 · IMPORTANTE (latente) — el 39 vigila 1 de los ≥5 clicks que gastan, y ahora lo escribe como si fueran todos

El docblock nuevo abre una sección **«Y lo que NO entra, porque la frontera es el GASTO y no el
parecido»** y enumera dos cosas: `nuevaPartida()` y `#ts-continue`. Leída así, la frontera parece
completa. No lo es. Medido en el cliente:

| Click del título | Qué dispara | ¿Lo ve el 39? |
|---|---|---|
| `#ts-start` | `elegir({kind:"new_game"})` → tile de bootstrap al motor | **sí** (`CLICK_CARO`) |
| `#ts-gen-world` | `deps.narrative.generateGame(...)` — la pre-generación ENTERA (`panel-de-generacion.ts:165`) | **no** |
| `#ts-create` | `deps.narrative.createGame(draft)` (`develop_world`, «1-3 min») **y encadena `generateGame`** porque `#ts-pregen` nace `checked` (`crear-mundo.ts:105-117`) | **no** |
| `#ts-apply-style` | el batch de estilo; su propio `title` dice «coste estimado antes de gastar» | **no** |
| `#ts-complete` (subir estilo) | `POST /styles/{id}/complete` — genera las refs que falten (`subir-estilo.ts:260`) | **no** |

Y la asimetría es **interna a la propia regla**: `HELPERS_CAROS` son dos, `comenzar` y
`regenerarMundo`; `CLICK_CARO` existe para cazar «el mismo acto sin helper»… y solo cubre el de
`comenzar`. El botón de `regenerarMundo` es literalmente `#ts-gen-world` (`qa/lib/sesion.mjs:478`).
Que nadie lo haya pisado no es casualidad ni candado: el guion **99** lo esquiva **a mano y por
escrito** (`99:108`: «no se toca `#ts-gen-world` ni `#ts-apply-style`»).

**Medido** (misma corrida que el criterio 2): un guion de pega exento cuyo cuerpo es
`await ctx.page.click("#ts-gen-world")` dos veces —el doble click que pide la confirmación— pasa
el 39 **en verde**.

Es **anterior a esta PR** (la regla vieja miraba `#ts-(start|continue)`, tampoco `#ts-gen-world`),
así que no es una regresión; lo que sí es de esta PR es haber escrito la frontera como cerrada.
La red dinámica (el contador del motor falso, `run.mjs:1490-1500`) lo cazaría **en el banco**, pero
el propio docblock recuerda que «vive en el motor falso y contra el backend caro no existe», que es
el escenario para el que existe el guardarraíl.

**Respuesta a la pregunta del coordinador** («el ingeniero declara como residuo abierto *un exento
que algún día gaste desde el editor* — ¿es el único?»): **no**. Ése es el residuo que ABRE el
estrechamiento y está bien declarado; el que ya estaba abierto y sigue sin decirse es el de los
otros cuatro botones, y es más grande — `#ts-create` con `#ts-pregen` marcado es el click más caro
del juego.

### H-3 · IMPORTANTE — el contador que decide el verde lo puede escribir el guion vigilado

`ctx.afirmaciones` es una propiedad normal del objeto que el runner **le entrega al guion**.
Medido:

```
▶ zzqa-b-trampa        # cuerpo: ctx.afirmaciones = 7;  ctx.log("no he afirmado nada")
✔ zzqa-b-trampa
```

No está en la lista de «lo que no mira» del docblock de `veredictoDeGuion`, que declara tres cosas
(pertinencia, mudez parcial, ejecutables de `qa/*.mjs`) y no ésta. La asimetría que la hace
distinta de `ctx.fallos` —también escribible— es que escribir `fallos` solo puede poner ROJO, y
escribir `afirmaciones` **fabrica un VERDE**.

La casa ya tiene la respuesta escrita para esto («la garantía va en el tipo»): que el contador no
sea expresable desde el guion (cierre en `makeCtx`, o `Object.defineProperty` con solo getter).
Hoy no hay ningún guion que lo haga; es un estado malo **posible**, no uno vivo.

### H-4 · MENOR — la prosa del banco sigue diciendo la regla vieja, en la tabla que lee quien escribe guiones

`qa/README.md:141`, en la tabla del `ctx` que es la documentación de la API de un guion:

> `ctx.expect(desc, cond, detalle)` | apunta un criterio; **los fallos deciden el veredicto**

Desde esta PR eso es falso: el veredicto es `fallos === 0 && afirmaciones > 0`. Y la sección
inmediatamente siguiente —«Reglas que hacen que un guion valga algo»— es donde debería estar la
regla nueva, y no está. No vale el reparto de ficheros como excusa: **el ingeniero ya editó
`qa/README.md`** en esta PR (la fila del 141, desviación 2 de su informe), a 350 líneas de la
frase que quedó mintiendo. Es la enfermedad exacta de la tanda: prosa envejecida al lado de un
candado nuevo.

### H-5 · MENOR — «los dos del título» es la misma frase que acaba de morir, una talla más pequeña

El comentario de `CLICK_CARO` dice ahora: *«Solo `#ts-start`: es el único **de los dos del
título** cuyo handler llega al motor»*. El título tiene **46 ids `#ts-*`**, cinco de ellos con
handler que gasta (H-2). «Los dos» es el marco heredado del error que esta PR corrige, y es
justo lo que hará creer al siguiente lector que la frontera está completa.

### H-6 · IMPORTANTE, y NO es de esta PR — el guion 120 mide sobre un log compartido y lo rojo depende del ORDEN

La batería completa de este árbol dejó **dos** rojos, no uno. El segundo no lo había declarado
nadie:

```
✘ 120-el-anillo-bueno-no-se-pierde
    · 2. el bridge dice POR QUÉ criba: la escena y el NPC, no un silencio —
      … la escena "tile_-1_-1" … el NPC "ahogado_tile_-1_-1" …
```

El 120 criba `tile_1_0` (`120:69`) y su aserto lee el log del bridge así (`120:225-231`):

```js
const criba = readFileSync(logBridge, "utf8").split("\n").find((l) => l.includes("se CRIBA"));
```

`nefan-bridge.log` es del **disco efímero de la CORRIDA**, no del guion, y `.find()` devuelve el
PRIMER match: cualquier guion anterior que haya cribado una escena le roba la evidencia. El
`tile_-1_-1` del mensaje es del **127**, que corre justo antes en orden inverso y va de lo mismo.

**Medido, y es causal, no una impresión:**

| Corrida | Resultado del 120 |
|---|---|
| `node qa/run.mjs 120-el-anillo` (solo) | **verde**, 18 asertos |
| `node qa/run.mjs --orden inverso 127-el-anillo 120-el-anillo` | **rojo**, con la línea del `tile_-1_-1` |
| batería entera en orden inverso | **rojo**, mismo aserto y misma línea |

Es el molde exacto de **#644** (el 91: verde solo, rojo en la batería larga) con otro mecanismo:
allí el origen de la consulta, aquí el primer match de un fichero compartido. Y es **invisible en
la corrida normal**: alfabéticamente el `120` va ANTES del `127`, así que lee su propia línea y
sale verde — solo aparece en orden inverso, que es el que hay que usar para que el 141 y el 39
lleguen a ejecutarse antes que el 127. Nadie lo había visto porque la batería
se corre siempre en alfabético y muere antes.

Arreglo evidente (no lo aplico: reporto): filtrar por su propia escena en vez de `.find()` del
primer «se CRIBA» — `findLast`, o mejor `.filter((l) => l.includes(\`"${MALO}"\`))`.

**Consecuencia para la tanda**: el criterio de cierre «la batería entera en verde» está bloqueado
por DOS guiones, no por uno, y el segundo no es del disco. Va a issue.

## Workarounds usados

| Workaround | Por qué no afecta al jugador |
|---|---|
| Guiones de pega en `qa/guiones/` (`zzqa-*`) para forzar mudez, trampa y clicks caros | No tocan producción y **se borraron**; `git status` limpio salvo mi guion 146 y este informe. La corrida que los ejercitó los filtró por nombre, así que ninguno llegó a conducir el juego |
| Revert manual del cable en `qa/run.mjs` y de la regla en `qa/lib/veredictos.mjs` para los negativos | Restaurado byte a byte desde copia (`git diff --stat` vacío tras cada uno). Es medida, no arreglo |
| Copiar las 8 grabaciones de `labs/narrative/runs/` del checkout principal para ver el 141 medir | Están en `.gitignore`, no toqué las originales y **las borré al terminar**: el árbol queda como lo deja la receta. Cambia lo que hace el 141, y por eso se dice |
| La batería se corrió **en orden inverso** | Para que el 39 (puesto 61) y el 141 (puesto 89) queden por delante del 127 (puesto 105), que es donde el ingeniero midió que la corrida se muere. En mi corrida **no se murió** y llegó a los 143, así que el orden no le quitó cobertura a nadie — y de paso es lo que destapó H-6. El fallo de máquina está declarado abajo |

Ninguno de los cuatro es un obstáculo que vaya a encontrarse un jugador: esta PR no toca una sola
línea de producción (`qa/**` + un `test/` de core).

## No probado

- **La batería en orden ALFABÉTICO.** Corrí una sola batería completa y fue **en orden inverso**,
  que es el que pone al 39 (puesto 61) y al 141 (puesto 89) por delante del 127 (puesto 105). En este árbol la
  corrida **no murió** —llegó a los 143—, pero el disco sigue al 99 % y el 127 sigue rojo con
  `net::ERR_INSUFFICIENT_RESOURCES`: no puedo afirmar que la alfabética termine. No borré nada
  para hacer sitio. Log completo en `bateria-qa-ha.log` (scratchpad de la sesión).
- **El gasto real de créditos.** Todo se midió contra el motor falso; no ejercí ningún camino de
  pago, que es precisamente lo que #633 exige.
- **Que un exento que pulse `#ts-gen-world` acabe pagando de verdad** (H-2): medí que el 39 no lo
  ve, no que la factura llegue. Contra el backend caro no se prueba.
- **El comportamiento del 141 con grabaciones CORRUPTAS** sí lo probé (subdirectorio sin
  `events.ndjson`): sale rojo honesto nombrando el directorio (`✘ ERROR: zzz-basura-de-qa murió al
  arrancar`), tal y como el ingeniero declara que no está cubierto. Se dice aquí para que conste
  que no es un cuelgue.

## Dónde estamos equivocados los demás

1. **Ingeniero — «el negativo de la forma general es un test unitario que corre en CI»** (§H2 de
   `implementacion-a.md`). Falso por la mitad: en CI corre el negativo de la FUNCIÓN. El candado
   —la regla aplicada a un guion— no lo ejerce nada. Medido en H-1.
2. **Ingeniero / crítica / requisitos — «el residuo que abre estrechar la regla es el del
   editor»**. Es el único residuo *nuevo*, y está bien visto; pero la pregunta del cierre era si es
   el único, y no lo es: H-2.
3. **Ingeniero — la lista de «lo que NO mira» de `veredictoDeGuion` está incompleta**: falta que el
   contador sea escribible por el propio guion (H-3). Las dos que sí declara las verifiqué y son
   exactas.
4. **Plan §7, criterio de cierre** — el ingeniero ya lo corrigió (las dos cifras según el árbol) y
   **tiene razón**: lo confirmo en este árbol, `1 ⊘` (el 97) en el checkout principal y `2 ⊘` (97 y
   141) en un worktree de la receta. Lo añado: el exit de la batería **siempre** ha sido 2 por el
   97, así que ese código no distingue «todo bien» de «no midió» ni antes ni después.
5. **Lo que NO está equivocado, y lo digo porque lo remedí con otro instrumento**: el censo
   **142 / 1 / 0** es correcto, y con él los tres helpers de `qa/lib` que afirman siempre
   (`acercarse`, `reanudar`, `regenerarMundo`). Mi acorn y su TypeScript coinciden guion a guion, y
   **ningún guion depende de un helper para no ser mudo** (el hueco que yo sospechaba: 0 de 143).
   La advertencia del ingeniero sobre la fragilidad del instrumento (funciones locales + `try` sin
   `catch`, el caso del 87) es cierta y vale la pena conservarla.

## El guion que dejo

`qa/guiones/146-el-verde-de-un-guion-no-lo-decide-el-runner-a-solas.mjs` — 10 asertos, lee el
**árbol** de `qa/run.mjs` (no el texto) con el `typescript` de `nefan-core/node_modules`, como
`qa/el-selector-ve-lo-que-la-bateria-abre.mjs`, y declara `⊘` si no lo encuentra.

Afirma: que `expect` incrementa el contador **antes** de mirar la condición (las dos ramas); que
hay un solo `resultados.push` que no es del canal ⊘ y que su `estado` **es** el que devuelve
`veredictoDeGuion`; que esa llamada es única; que se la alimenta con `ctx.afirmaciones` y
`ctx.fallos` **vivos** y no con literales; y, en una línea, que la función a la que delega no da
verde a quien no afirmó nada.

**Probado en negativo, cuatro sabotajes con restauración entre ellos:**

| Sabotaje | Resultado |
|---|---|
| quitar `ctx.afirmaciones++` de `expect` | 2 rojos (bloque 1) |
| devolver `estado: ctx.fallos.length === 0 ? VERDE : ROJO` (**el revert de H-1**) | 4 rojos (bloque 2) |
| pasar `afirmaciones: 1` literal | 1 rojo (bloque 3) |
| ablandar `veredictoDeGuion` dejando el cable intacto | 1 rojo (bloque 4) |

En el runner de verdad (`node qa/run.mjs 146-el-verde`): **1 en verde · 0 en rojo de 1**, censo de
gasto `0 guion(es) tocaron alguna puerta`. Y pasa el 39 sin tocarlo: declara su `sinMotor`, no
importa helpers caros y no pulsa nada — en la batería el 39 lo contó y siguió verde
(`144 guiones · 36 declaran sinMotor`).

Lo que **no** canda, escrito en su cabecera: si la regla es la correcta (eso es
`veredictos.test.ts`), que el contador sea infalsificable (H-3, que se arregla en el tipo) y la
mudez parcial ni la pertinencia.

## Veredicto

**APTO CON HALLAZGOS.** Las dos piezas están bien hechas y bien medidas, ninguna toca producción y
el riesgo para el jugador es cero: el 39 vuelve a verde en la batería real y el 141 dice por fin lo
que le falta, en los tres estados. Lo que falta para que el banco «pueda seguir diciendo la verdad
mañana» son **H-1** (el cable sin candado, con su molde ya escrito en la casa y un guion listo que
lo caza) y **H-2** (la frontera del gasto, hoy escrita más ancha de lo que sujeta). H-3 y H-4 son
baratos y del mismo día. **H-6 no es de esta PR** pero bloquea el criterio de cierre de la tanda y
hay que decirlo antes de prometer «la batería entera en verde».

Nada de esto justifica retener la PR: el estado de HOY del banco es mejor con ella dentro
—un rojo menos, un `ENOENT` menos y un verde mudo menos— y los cuatro hallazgos se cierran encima.
