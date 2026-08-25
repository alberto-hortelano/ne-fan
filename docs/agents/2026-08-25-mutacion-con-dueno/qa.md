# QA — La mutación se pide, se autoriza y vuelve con dueño

Validado sobre `feature/mutacion-con-dueno`, PR **#276**, commit final **`8cbb2b4`**
(CI verde en los cuatro jobs: `nefan-core`, `nefan-html`, `narrative-mcp`, `ai-server`).

Quien «juega» aquí es el **usuario que autoriza desde el móvil** y el **ingeniero que recibe
el resultado**. Todo lo de abajo está mirado desde ahí, no desde el código.

**No he medido mutación en ningún momento**: ni `npm run mutate`, ni `npm run mutacion -- local`
de ningún módulo, ni siquiera barato. Los topes y el muro se validan en negativo, que además
es más concluyente. Carga máxima que he metido en la máquina: un fichero de test de 0,7 s
corriendo de uno en uno.

---

## Criterios

| # | Criterio (literal de `requisitos.md`) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Nadie corre mutación cara en la máquina del usuario | ✅ cumple *(con dos vueltas abiertas, H4/H5)* | `npx tsx scripts/mutate.ts --ids` → **exit 1**, «`npm run mutate` no se corre aquí». `mutacion.ts local plugins-dsl` → **exit 1**, «son 1362 mutantes y el tope local es 120». Techo de procesos REAL: el `comando` del plan lleva `--test-concurrency=1` y `concurrenciaDe(16,"2")=2` → ~2 procesos; candado en `test/mutation-config.test.ts:408-445` (`concurrenciaDe(nucleos) * porWorker ≤ nucleos`) |
| 2 | Una petición no bloquea nada | ✅ cumple | `mutation.yml` es `workflow_dispatch` puro — **no aparece en los checks de la PR** (`nefan-core`, `nefan-html`, `narrative-mcp`, `ai-server` y nada más). La tanda se cerró con la medida del rango pendiente. `pendiente` lo dice: «Una petición pendiente NO bloquea nada: sigue y cierra la tanda» |
| 3 | Una sola corrida cubre todas las PR mergeadas desde la anterior, incluidas las que nadie pidió y los commits directos a `main` | ✅ cumple el mecanismo · ⚠️ nunca ejercido hasta el final | `pendiente` en un árbol limpio lista **6 commits**, 5 de ellos `(directo a main)` sin `(#NNN)`, más `#273`. El rango sale de `git log mutacion-ultima..`, no de peticiones. **Pero** ninguna corrida con `origen=rango` ha llegado a `Medir` (la 32878255111 se canceló) — ver «No probado» |
| 4 | Cada superviviente sale con dueño o dice que no lo tiene; con dos candidatos se nombran los dos | ✅ el mecanismo · ❌ **lo que hay publicado en #273** | `atribuir()` correcto y con candado que se pone rojo (uno→suya, dos→«#274 o #276», ninguna→«sin dueño en el rango»). Pero en #273 **conviven dos comentarios de la MISMA corrida que se contradicen** → **H1** |
| 5 | Un superviviente que ya existía no se le carga a quien no lo trajo; sin medida anterior sale como `sin base` | ✅ cumple | Los tres estados existen, están testeados y **los tres se ponen rojos al romperlos** (sweep abajo). El caso caro incluido: `nuevos` y `resueltos` se calculan por separado, no por resta |
| 6 | El usuario lo autoriza desde el móvil sin teclear módulos ni tener sesión viva | ⚠️ **no probado** | Solo lo puede comprobar el usuario (su teléfono, su sesión). Input vacío = rango, `TODOS` = completa, ambos implementados. Respaldo verificado: `gh workflow run` funciona en el `gh` 2.4 de esta máquina |
| 7 | Nada de esto puede dar verde sin haber comprobado nada | ⚠️ **parcial** | **20 de 22** invariantes se ponen rojos al romperlos. Dos son verdes vacíos (**H2**, **H3**) y dos decisiones nuevas no tienen batería que las mire (**H4**, **H5**) |

---

## El sweep en negativo — 22 invariantes rotos a propósito

Guion ejecutable: **`/home/al/code/ne-fan/qa/mutacion-candados-en-negativo.mjs`**
(`node qa/mutacion-candados-en-negativo.mjs`, ~25 s, un núcleo). Salida real:

```
Invariantes probados en negativo : 22
Se ponen rojos al romperlos      : 20
NO se enteran                    : 2
   🟢 atribución · prDelAsunto coge la PRIMERA referencia en vez de la última
   🟢 huella · el hash se trunca a 32 bits
Decisiones sin batería           : 2
   ✖ yaRepartida — el guardia de idempotencia de `repartir`
   ✖ muroDeAutorizacion — el muro de `npm run mutate`
✖ hay candados que no comprueban nada
```

Los 20 que sí muerden incluyen **los tres estados del delta y el caso caro**, que era lo
señalado como crítico:

```
🔴 rojo   delta · sin-base se colapsa a NUEVO
🔴 rojo   delta · sin-base se colapsa a YA ESTABA
🔴 rojo   delta · sin-base se etiqueta como CON BASE
🔴 rojo   delta · EL CASO CARO: un nuevo que cae donde estaba uno viejo, descontado en silencio
     lo caza: un superviviente nuevo que cae donde estaba uno viejo NO se descuenta en silencio
🔴 rojo   delta · los resueltos se callan
🔴 rojo   atribución · con dos candidatas se nombra solo la primera
🔴 rojo   atribución · sin dueño se descarta en silencio
```

El mutante del caso caro es el que importa: sustituí `nuevos` por
`ahora.vivos.length > antes.size ? … : []` — o sea, «si el total no ha crecido, no hay nada
nuevo», que es exactamente el descuento silencioso que el plan mandaba impedir. **La batería
lo caza.** Ese criterio está bien cerrado.

---

## Hallazgos

### H1 · IMPORTANTE — En #273 hay dos comentarios de la misma corrida que se contradicen, y el falso no se distingue del bueno

El bug de idempotencia dejó rastro **en producción y sigue ahí**. `gh api
repos/alberto-hortelano/ne-fan/issues/273/comments` devuelve dos comentarios, a 59 s uno de
otro, con **cabecera idéntica** («Mutación · corrida 32876809618 sobre `7c6848f`»):

| | `5414125857` (17:22:45) | `5414136842` (17:23:44) |
|---|---|---|
| `src/combat/attack-area.ts` | `0 nuevos · 2 ya estaban` | `2 nuevos · 0 ya estaban` |
| detalle de los NUEVOS | **no lo hay** | `attack-area.ts:108:9` ConditionalExpression → `true` · EqualityOperator → `q >= mejor` |
| `src/session/session-facets.ts` | `0 nuevos · 0 ya estaban` | **sin base de comparación** |

Reproducción desde cero: abrir <https://github.com/alberto-hortelano/ne-fan/pull/273>, bajar a
los comentarios.

**Qué esperaba el ingeniero que llega sin contexto**: un sitio donde mirar. Lo que encuentra
son dos verdades sobre la misma corrida sin nada que diga cuál manda — y la primera es
justamente la que borra el hallazgo (dice «ya estaban» de los dos supervivientes NUEVOS y
oculta `sin base` de `session-facets`). Si lee la de arriba, cierra la pestaña.

Que el bueno sea el segundo lo sé porque lo dice `implementacion.md`; en la PR no lo dice nadie.

**La ventana que lo produjo sigue abierta.** `repartir` compara contra `huellaEnHead()` — la
huella **commiteada** (`mutacion.ts:395-398`) — y publica el comentario *después* de escribir
la huella en el árbol (`mutacion.ts:438-450`). Entre `repartir --comentar` y el `git commit` de
la huella, un segundo `repartir --comentar` **no ve la corrida como repartida y vuelve a
comentar**. El guardia solo está armado una vez commiteada.

Lo que pide: borrar o editar el comentario `5414125857`, y cerrar la ventana (o desarmar
`--comentar` cuando la huella del árbol ya lleva esta corrida).

### H2 · IMPORTANTE — El candado de `prDelAsunto` no puede ponerse rojo, y el invariante que dice guardar es real

El test se llama «coge la ÚLTIMA referencia: las issues cerradas van antes que la PR»
(`test/mutacion-huella.test.ts:305`). Su fixture:

```
"Reanudar te devuelve donde lo dejaste (#245 #249 #246) (#273)"
```

El regex es `/\(#(\d+)\)/g`, y `(#245 #249 #246)` **no casa** (necesita `)` pegado a los
dígitos). Así que el asunto produce **una sola** coincidencia y `todos[0] === todos[todos.length-1]`:

```
matches: [ '273' ]
ultima = 273  primera = 273
¿distingue?  false
```

Cambiar `todos[todos.length - 1]` por `todos[0]` en el fuente deja la batería en **56 pass /
0 fail**. Y el invariante no es teórico: 4 de los últimos 200 commits de este repo llevan dos
grupos separados, donde primera y última difieren de verdad —
`… (#199) (#258)`, `… (#230) (#254)`, `… (#225) (#244)`, `… (#174) (#242)`.
Con esos, `primera` sería la **issue** y no la PR: el comentario del reparto iría a comentar
sobre una issue cerrada en vez de sobre la PR que trajo el superviviente.

**El arreglo es una línea, y lo he verificado** (en mi worktree, no en el árbol del ingeniero):
con el fuente igual de roto y solo cambiando el fixture a un asunto real de dos grupos,

```
### A) fixture ACTUAL   + fuente rota (todos[0]) -> pass 56  fail 0
### B) fixture ARREGLADO + fuente rota (todos[0]) -> pass 55  fail 1
     ✖ coge la ÚLTIMA referencia: las issues cerradas van antes que la PR
```

### H3 · MENOR — Truncar el hash a 32 bits no lo nota nadie, y hay presión real para truncarlo

El test genera 20.000 tuplas distintas y exige 20.000 hashes distintos. Con 32 bits, las
colisiones esperadas son **0,047**, o sea que el test se entera el **4,6 %** de las veces:

```
64 bits -> distintos: 20000 (el test pasa)
32 bits -> distintos: 20000 (EL TEST PASA IGUAL: no detecta el truncado)
```

No es hipotético: `implementacion.md` §8 dice que la huella son 109 KB en vez de los ~30 KB
del plan y que **no** recortó el hash porque «con 32 bits la probabilidad de colisión pasaría
de 10⁻¹³ a ~10⁻³ y el delta empezaría a descontar supervivientes distintos entre sí». Ese es
el fallo caro del sistema entero, la razón se escribió en un comentario, y **el único sitio
donde no está es en un test**. El día que alguien quiera adelgazar el fichero, el verde le
dirá que adelante.

Lo que lo cerraría: afirmar la **longitud** del hash (16 hex) y su determinismo sobre un valor
fijo, en vez de fiarlo a un test de colisiones probabilístico.

### H4 · IMPORTANTE — El muro es el candado más nuevo de la tanda y es el único sin candado

`grep -rn "NEFAN_MUTATE_AUTORIZADO\|muroDeAutorizacion" nefan-core/test/` → **nada**.
Ningún test importa `scripts/mutate.ts` (comprobado: los tests solo importan
`mutation-plan.js`, `arch-collect.js`, `mutacion-huella.js`, `deuda.js`, `crap-score.js`,
`afectado.js`).

Funciona hoy — lo he verificado yo, no me he fiado del informe:

```
### 1) sin autorizar        npx tsx scripts/mutate.ts --ids   -> exit=1  «no se corre aquí»
### 2) autorizado + --ids   -> ["scene-normalize", … 20 ids]  exit=0
### 3) local plugins-dsl    -> «son 1362 mutantes y el tope local es 120»  exit=1
```

Pero la decisión (`process.env.NEFAN_MUTATE_AUTORIZADO === "si"`) es trivialmente pura y no
está extraída, así que un `return` de más la desarma sin que nada se entere. Es la misma
doctrina que la tanda aplica con rigor en `mutacion-huella.ts` («la decisión se extrae a una
función pura para que un test la ejerza con datos sintéticos») y que aquí no se aplicó.

### H5 · IMPORTANTE — `yaRepartida` nació de dos bugs de pérdida de datos y tampoco tiene batería

Ningún test nombra `yaRepartida`. Los dos bugs que el ingeniero encontró **ejerciéndolo** (el
comentario duplicado y la tercera pasada borrando `nuevos`/`duenos`) están arreglados con un
guardia, no candados.

El motivo declarado en `implementacion.md` —«un test que lo ejerciera de verdad volvería a ser
el test que en CI no comprueba nada»— **no se sostiene**: la firma es
`yaRepartida(corrida: Corrida, base: Huella)`, dos estructuras de datos planas. Lo único que
la ata al disco es que se saca los ficheros con `leerInforme(id)` dentro; pasándolos como
argumento, la regla («todos → repartida · ninguno → no · algunos → a medio repartir, error»)
es tan sintética como el resto de `mutacion-huella.ts`, que es donde debería vivir.

Un bug que ha aparecido dos veces en el mismo verbo merece un candado.

### H6 · MENOR — Quedan 19 configs de Stryker en el árbol que llegan a medir sin muro y sin tope

```
nefan-core/reports/stryker/*.config.json  ->  19 ficheros
  PRESENTE plugins-dsl      -> concurrency=8 mutate=["src/plugins/dsl/*.ts"]
  PRESENTE blueprint-scatter -> concurrency=8 mutate=["src/scene/blueprint/scatter.ts"]
  PRESENTE scene-normalize   -> concurrency=8 mutate=["src/scene/scene-normalize.ts"]
```

`npx stryker run reports/stryker/plugins-dsl.config.json` corre 1.362 mutantes a **concurrencia
8** sin pasar por `muroDeAutorizacion()` ni por el tope. Son el residuo de la corrida accidental
que motivó el muro, y llevan su concurrencia congelada dentro.

Lo bueno: **`npx stryker run` a secas es inofensivo** — `stryker.config.json` lleva `mutate: []`
como fusible deliberado, y tiene candado (`test/mutation-config.test.ts:356`).

Es la vuelta menos probable de las que he buscado (hay que nombrar la ruta a mano, ningún
accidente de `echo` la produce), pero es literalmente lo que el comentario del muro dice de sí
mismo: «un tope que solo protege el camino que alguien recuerda usar no es un tope». Cerrarlo
es barato: que `mutate.ts` borre el config al terminar, o que el fusible exija la variable.

### H7 · MENOR — El tope pasó de 150 a 120 y eso no cambió absolutamente nada

Coste por módulo según la huella, contra el tope:

```
    28  PASA  session-facets        172  no  blueprint-fps-ambiente
    41  PASA  blueprint-plan        271  no  scene-normalize
    77  PASA  combat-resolver       330  no  blueprint-fps-spec
   100  PASA  status-labels         ...
   103  PASA  state-http-dispatch
   118  PASA  npc-director
```

El escalón real está entre **118** (`npc-director`) y **172** (`blueprint-fps-ambiente`):
**cualquier valor entre 118 y 171 admite exactamente el mismo conjunto**. Con 150 pasaban los
mismos seis módulos que con 120, y `scene-normalize` (271) ya estaba fuera con 150. O sea: la
justificación implícita («el módulo que se coló tenía 271») no es lo que arregla el 120 — eso
lo arregló el muro, que es otra cosa.

Dicho esto, **el número está medido y no puesto a ojo**, y eso hay que reconocerlo: el
`_comment` de `mutation-targets.json` documenta 0,58 s/mutante a concurrencia 2 (blueprint-plan,
41 mutantes en 24 s, medido dos veces), luego 120 ≈ 70 s ocupando 2 de 16 núcleos. La
aritmética es correcta y defendible.

Lo que sí conviene saber: **`npc-director` está a 2 mutantes del tope**. El primer test que se
le añada lo saca del conjunto medible en local, en silencio y sin que nadie lo relacione.

### H8 · MENOR — Documentación que ya no describe lo que hace el código

- La cabecera de `mutate.ts:20-26` sigue enseñando `npm run mutate -- --cambiado`,
  `npm run mutate`, `npm run mutate -- world-map` y `npm run mutate -- --ids` como «Uso». Las
  cuatro salen ahora con exit 1. Quien lea la cabecera aprende cuatro comandos que no funcionan.
- El muro dispara **antes** de la rama `--ids`, que es metadatos puros (0 CPU, lista los 20
  ids). Bloquearlo no protege nada y el mensaje que sale —«NO BUSQUES CÓMO SALTÁRTELO»— es
  desproporcionado para un `console.log` de ids. Nadie depende de él (CI usa
  `npm run mutacion -- pendiente --ids`), así que el coste es solo de confusión.
- `implementacion.md` abre con «No hay PR abierta»: la PR #276 existe.
- La carpeta de la tanda no tiene `critica.md`, que CLAUDE.md manda commitear junto a
  `requisitos.md` y `qa.md`. `requisitos.md` y `plan.md` citan «la revisión adversarial», así
  que la crítica se hizo; lo que falta es el fichero.

---

## Lo que sí funciona y conviene no perder de vista

- **El clon limpio ve la deuda de mutación.** Es la promesa central del plan y **se cumple**.
  En un worktree recién creado, sin `reports/` en absoluto:
  ```
  $ ls nefan-core/reports  ->  No such file or directory
  $ npx tsx scripts/deuda.ts
  Mutación — supervivientes · 40
    fuente: data/contract/mutacion-huella.json + reports/mutation/<módulo>.json
    src/scene/blueprint/scatter.ts
        587 mutantes vivos de 1040 (score 44%) — de la huella, medido el 2026-08-24 · sin base…
  ```
  Antes era una fuente vacía, que se lee igual que «no hay deuda».
- **La cabecera ya no manda lo que la política prohíbe**: «Para la cola completa:
  `npm run coverage && npm run mutacion -- pendiente`». El `npm run mutate` desapareció, y
  romperlo pone la batería roja.
- **`pendiente` funciona en un árbol limpio** y coge los commits directos a `main`
  (5 de los 6 del rango).
- **El tag `mutacion-ultima` está empujado a origin** (`db35ac5`), que es lo que hace que un
  clon nuevo y el runner con `fetch-depth: 0` lo encuentren. Si solo hubiera existido en local,
  la rama de input vacío del workflow habría fallado el primer día.
- **El techo de procesos de `local` es real y tiene candado**, no es una promesa: el
  `--test-concurrency=1` del comando del plan y `concurrenciaDe` están atados en
  `test/mutation-config.test.ts:408-445` con la propiedad correcta
  (`concurrenciaDe(nucleos) * porWorker ≤ nucleos`).
- **`combat-resolver` por debajo de su break (90,9 vs 92) no atasca nada.** Está declarado, la
  cola lo enseña con sus dos supervivientes NUEVOS localizados a nivel de columna, y no bloquea
  el merge (la mutación no es un check de PR). El sistema se comporta bien en ese estado.

---

## Workarounds usados durante la prueba

| Workaround | Por qué | Veredicto |
|---|---|---|
| Validé sobre un **worktree** en el scratchpad en vez del árbol del ingeniero | El árbol se movía debajo: durante la validación aparecieron y se commitearon `e41040c` y `8cbb2b4` (el muro). Sin un punto fijo, cualquier medida mía habría descrito un estado que ya no existía | Necesario y sin impacto: el worktree es el commit empujado |
| **Symlink** de `node_modules` al worktree en vez de `npm ci` | Un `npm ci` completo por una validación | Artefacto mío, **no es un hallazgo**: `pendiente` sacó «fuerza la completa: node_modules» porque `.gitignore` trae `node_modules/` con barra y eso no casa con un symlink. Un clon real tiene un directorio y se ignora bien |
| El worktree está en **detached HEAD** | Es como se crea | Cosmético y solo ahí: `pendiente` imprime `gh workflow run mutation.yml -r HEAD`, que no es una ref usable. En una rama normal imprime el nombre de la rama. **No lo cuento como hallazgo** |
| Mi guion **escribe y restaura** `mutacion-huella.ts` en el árbol vivo | Romper en negativo es el método | Con `finally` + verificación byte a byte al terminar. `git status --porcelain` después: solo mi fichero nuevo sin trackear. Sin contaminación |

---

## No probado, y por qué

- **`workflow_dispatch` desde la app móvil de GitHub** (criterio 6). Es el teléfono y la sesión
  del usuario; no lo puede comprobar nadie más. Sigue siendo la piedra angular del criterio y
  la única pregunta abierta que `requisitos.md` marcaba como «se comprueba antes de construir
  encima». El respaldo (`gh workflow run`) sí está verificado.
- **Una corrida con `origen=rango` de punta a punta.** La selección se vio verde en el runner
  (32878255111) y se canceló al entrar en `Medir` — habrían sido ~2 h porque esta tanda toca el
  instrumento. Lo ejercido de verdad fue una corrida de módulos pinchados (`origen=explicito`),
  que por diseño **no** mueve el tag. O sea: el camino que el usuario usará por defecto (input
  vacío) no ha llegado nunca al final.
- **El tag reposicionándose.** Solo se mueve desde `main` y con la corrida cubriendo el rango;
  ninguna de las dos condiciones se da desde esta rama. La decisión (`veredictoDeCorrida`) sí
  tiene candado y **se pone roja** en los dos sentidos (lista explícita y corrida truncada).
  Lo que hay que mirar tras el merge es que el paso «Reposicionar mutacion-ultima» imprima
  `mutacion-ultima → <sha>`.
- **Cualquier medida de mutación.** Por instrucción explícita: hay una persona usando la
  máquina. Ni un módulo barato.
- **`qa/run.mjs`**: nada de esta tanda se ve jugando. No la he corrido.

---

## El guion ejecutable, y por qué no está en `qa/guiones/`

**`qa/mutacion-candados-en-negativo.mjs`** — `node qa/mutacion-candados-en-negativo.mjs`
(acepta un filtro: `… delta`). Rompe los 22 invariantes de uno en uno, exige que la batería se
ponga roja, restaura siempre y **verifica byte a byte** que el árbol quedó como estaba. Además
comprueba que las decisiones nuevas (`yaRepartida`, el muro) tengan quien las ejerza. Sale con
1 mientras haya un candado que no comprueba nada — hoy sale con 1, por H2, H3, H4 y H5.

**No va en `qa/guiones/` a propósito.** `qa/run.mjs:375` carga *todo* `.mjs` de esa carpeta y
lo conduce contra un navegador con el preset `e2e-sin-creditos` levantado; un fichero mío ahí
arrancaría el stack entero para no pulsar una tecla. Esta tanda no tiene UI: no hay nada que un
jugador pueda mirar. El precedente del repo para esto es `qa/fixtures-sin-bridge.mjs`
(y `qa/sprites-sin-servicio.mjs`): candado ejecutable, arranque propio, fuera del runner.

**Dónde vive el candado equivalente a largo plazo**: en `nefan-core/test/`, que es donde esta
casa pone lo mecánico. Mi guion demuestra *que los tests muerden*; los invariantes de H2 y H3
se cierran arreglando el fixture y la aserción, y los de H4 y H5 extrayendo las dos decisiones
a `mutacion-huella.ts` (puras, sintéticas, sin git ni disco) como ya está hecho con las otras
veinte. Cuando eso esté, mi guion sale verde y se queda como candado de regresión de que
siguen mordiendo.

**Probado en negativo** (regla 4 de `qa/README.md`): el guion no es un sello de goma — en la
misma corrida distingue 20 rojos de 2 verdes sobre el mismo fichero, y el caso de H2 lo verifiqué
en las dos direcciones (fixture actual → verde con el fuente roto; fixture arreglado → rojo con
el mismo fuente roto).

---

## Veredicto

**Apto con reservas.**

El núcleo del encargo está bien hecho y bien candado: los tres estados del delta, el caso caro,
la atribución honesta, el veredicto del tag y la descarga por los dos lados **se ponen rojos
cuando los rompes** — 20 de 22, comprobado uno por uno y no leído del informe. La promesa del
clon limpio se cumple. El techo de procesos de `local` es real y está atado. Y el mecanismo ha
producido su primer hallazgo con nombre, fichero, línea y columna, que es exactamente lo que se
le pedía.

Las reservas, por orden de lo que cuesta arreglarlas:

1. **H1** — borrar el comentario `5414125857` de #273 y cerrar la ventana entre `repartir` y el
   commit de la huella. Es lo único de la tanda que un tercero ve hoy, y hoy está mal.
2. **H2** — un fixture de una línea, ya verificado.
3. **H4/H5** — el muro y `yaRepartida` son las dos decisiones que esta tanda estrenó y las dos
   únicas sin batería, justo en un trabajo cuya tesis es que un candado sin candado no vale.
   `yaRepartida` ya ha costado dos bugs.
4. **H3, H6, H7, H8** — menores, anotables como issue.

Nada de esto bloquea el merge: la mutación no es un check de PR (criterio 2 cumplido), el CI
está verde en `8cbb2b4` y `combat-resolver` por debajo de su break se comporta bien. Pero H1 y
H2 son de minutos y H1 está publicado.
