# Tanda H — «El banco dice la verdad sobre sí mismo»

## La petición, literal

> «La mutacion se esta ejecutando, continua resolviendo issues»

(2026-09-17, sesión principal. La frase anterior de la misma serie, que sigue vigente, es
«Sigue cerrando issues». El roadmap vive en `/home/al/.claude/plans/federated-spinning-flamingo.md`:
núcleo primero, plugins/combate/NPC en `futuro`.)

## Estado medido hoy

- `main` = `cf2c13f2` (código en `57520cee`). Batería **141 verde · 1 rojo · 1 sin medir de 143**.
- Backlog **45 = 33 núcleo + 12 `futuro`**.
- **Corrida de mutación `35217880491` EN VUELO** sobre `cf2c13f2`, autorizada por el usuario.
  Mide 34 de 61 módulos y estrena base para **`salida-del-solido`**, que nació `sin medir` en la
  tanda G.

## Por qué esta tanda y no la de geometría

El candidato obvio era **#643** (dentro de dos geometrías a la vez no se sale: 2 de 36 rumbos
libres) con **#646**. Se descartan hoy por dos razones distintas, las dos medidas:

1. **#643 toca `salida-del-solido.ts`, que es justo lo que la corrida en vuelo está midiendo por
   primera vez.** Si se fusiona un cambio en ese fichero antes de repartirla, sus ficheros salen
   «base de otro código» y el módulo **no recibe suelo** — se pierde lo único que esa corrida vino
   a comprar. #643 se abre en cuanto la corrida esté repartida.
2. **#646 depende de #618**, que el usuario aparcó en `futuro` con #298 **ayer mismo**. Su propio
   cuerpo lo dice: mover el destino del NPC al borde «solo sirve si además sabe rodear», y si se
   hace solo lo barato el NPC deja de empujar el centro para empujar la fachada. Reabrirlo hoy
   sería deshacer una decisión del usuario de hace un día.

Lo que queda encima de la mesa es una familia entera que **no toca `nefan-core/src/**` ni un
fichero**: los cuatro issues de que **el banco no mide lo que dice medir**. Cero colisión con la
corrida, y es donde seis tandas seguidas han enseñado que está el fallo caro.

## Los cuatro issues

Todos nacen de correr la batería entera, que es lo que el CI no hace.

### #633 — el guion 39 prohíbe un click que no gasta (corregido por la crítica)

**Lo que yo escribí aquí era falso y la crítica lo midió.** No es que la lista de exentos haya
envejecido: **la regla del 39 nació mal**.

`qa/guiones/39-la-lista-de-exenciones-del-guardarrail-no-envejece` falla con un solo aserto contra
el guion **116**. Pero el 116 pulsa **solo `#ts-continue`** (116:107, 116:118), nunca `#ts-start`, y
`#ts-continue` es «Continuar →» del selector de mundo (`selector-de-mundo.ts:167`), cuyo handler
hace **una** cosa: `deps.ir({a:"editor"})` (`:344-365`). Abre el editor de personaje. El botón que
arranca partida es `#ts-start` (`editor-de-personaje.ts:151`).

El docblock del 39 llama a los dos «los botones **que arrancan la partida**» y eso es falso desde
el día que se escribió: `git show ff696eea:…/title-screen.ts` (2026-08-29) ya tenía
`renderCharacterEditor(...)` detrás. El 116 (2026-09-16) solo fue el primer exento en pisarla. Y
abrir el editor **no gasta**: `editor-de-personaje.ts:76` solo hace `fetch("/sprites/index.json")`,
el censo local del dev server.

**Es el primer caso en esta casa de la lección AL REVÉS: un candado que afirma MÁS de lo que
sujeta.** Prohíbe un acto inocuo.

**Es el único rojo de la batería.** Cerrarlo la deja entera en verde por primera vez desde que se
mide. Rojo reproducido en `0db4f50b`, `ee788590` y **hoy en `cf2c13f2`** (`node qa/run.mjs
exenciones-del-guardarrail` → `0 en verde · 1 en rojo de 1`; censo de gasto: 0 guiones tocaron
ninguna puerta).

**La decisión la toma el código, no el usuario**: el 116 es exento legítimo, **no se toca**, y la
regla del 39 se estrecha a `#ts-start`. Las otras dos salidas que yo ofrecía son un error — que el
116 «traiga su motor» es ceremonia para un click que no gasta, y sacarlo de los exentos lo mete en
el gate de gasto por un recorrido que no toca al motor.

Censo offline del 39 (cero créditos): **143 guiones, 35 exentos**; solo dos exentos pulsan alguno de
los dos botones —el **20**, con su motor, y el **116**—, y **cinco guiones NO exentos** pulsan solo
`#ts-continue` sin motor propio (47, 94, 96, 107, 116).

**Negativo obligatorio**: un guion de pega exento que pulse `#ts-start` sin `NEFAN_AI_SERVER` sale
rojo; otro que pulse solo `#ts-continue`, verde.

### #644 — el guion 91 mide por azar (mecanismo corregido por la crítica)

`91-la-forja-que-el-motor-pone-ya-no-se-atraviesa.mjs` sale rojo en la batería larga y verde
corriendo solo. De 121 muestras salieron **46 libres**, **38 libres** y **0 libres** en tres
corridas del mismo código: **dos corridas VERDES difieren en 8 muestras.**

**El mecanismo que yo copié del issue es falso.** `probeCollide` **no arrastra a nadie**:
`collidesAt` (`nefan-html/src/world/collision.ts:99-105`) **lee** `deps.getPlayerPos()` como origen
y no escribe nada; `nefan-hook.ts:125` es un passthrough. Hay **dependencia** de un dato vivo, no
mutación — así que «restaurar la posición entre muestras» sería un **no-op**. Lo que el 91 no
controla es el **ORIGEN** de su consulta: `collidesAt` es una consulta de MOVIMIENTO y contesta
siempre «no» por donde uno ya está (#538), así que el resultado depende de dónde quedó el jugador.

**El censo del issue falla en las dos direcciones.** Medido: **27 ficheros consultan
`probeCollide`, 13 no aparcan al jugador, y de esos 6 BARREN: 91, 118, 128, 14, 32, 73.** De los
que el issue nombraba, **el 134 y el 144 sí aparcan** y **el 81 no barre**. La tanda F tuvo tres
guiones compartiendo un punto ciego; aquí son **seis**, y cinco no tienen issue.

El **mirador del 134** (aparcar al jugador donde la consulta conteste como una de punto) es la
respuesta **general**, no un parche local: su cabecera (134:43-52) ya lo razona. La alternativa es
una consulta de PUNTO de verdad, que **hoy no existe en el hook** (`:125` y `:257` son el mismo
`collidesAt`) pero **no obliga a tocar `nefan-core/src/**`**: sus dos mitades ya están exportadas
—`penetracionEnSolido` (`salida-del-solido.ts:183`) y `penetracionEnCaja`
(`obstaculos-del-jugador.ts:135`)—, y las dos son consultas de punto sin origen. **Cuál de las dos
lo elige el arquitecto y lo escribe.**

### #645 — la totalidad de `candados-headless` es prosa

«Un ejecutable headless de `qa/` entra en el job el día que nace, o no lo corre nadie» está
**escrito en un comentario del yml y en CLAUDE.md**, y no hay nada que falle si alguien no lo añade.
Ya se pagó una vez: los tres ejecutables de geometría de la tanda E nacieron fuera y se descubrió al
cerrar la tanda.

Medido hoy sobre `cf2c13f2` y verificado por la crítica: **39 ejecutables en `qa/*.mjs`, 18 en el
job, 21 fuera.** Los 21, clasificados:

- **7 abren navegador**: `captura-de-fixture`, `capturar-portadas`, `fixtures-las-tres-se-caminan`,
  `fixtures-sin-bridge`, `guardarrail-sin-creditos`, `las-fixtures-solo-chocan-con-el-agua`,
  `presupuesto-de-volumenes`.
- **4 spawnean `qa/run.mjs`** (preset + Chromium): `bajo-carga`, `bateria-…`, `dos-corridas`,
  `esperas-…`. · **1 es el runner mismo**, que no es un candado: `run.mjs`.
- **9 headless con exención REAL**: `no-mata-lo-ajeno`, `parar-clasifica-los-nueve-puertos`,
  `presets` (arrancan `start.sh` entero), `sprites-sin-servicio` y `perfil-de-repintado-en-la-clave`
  (sprite-forge, otro repo), `el-arte-…` y `el-indice-…` (asset-store), `fake-enruta-por-pathname`
  (arte generado, gitignored) y `comparar-el-criterio-en-negativo` (necesita `reports/mutation-base/`).

**De «los que nadie añadió» quedan cero**: los 9 tienen motivo real, pero **solo 4 lo tienen
escrito**. Ahí está el valor del issue, y por eso el candado nace pudiendo cumplir lo que promete.

**Y la prosa del yml no está solo incompleta: ya es FALSA.** Dice «los **tres** que levantan
asset-store o sprite-forge» y son **cuatro** — `qa/sprites-sin-servicio.mjs:300` arranca
`bin/sprite-forge.mjs serve` y no figura en ninguna excepción. Nadie lo vio: el issue se demuestra a
sí mismo.

El molde existe dos veces en la casa: `banco-medido.json` y `mutation-targets.json`. Lo que falta es
la totalidad, con exención escrita y con motivo. **Peaje conocido**: dos guiones salen `⊘ SIN MEDIR`
en un árbol sin el `.venv` de Python, y el candado no debe confundir eso con un rojo.

### #639 — el guion 141 no puede correr en un clon limpio

Hace `readdirSync("labs/narrative/runs")` sin comprobar que exista. Ese directorio es material de
sesión: no está en git y la receta de worktree no lo copia. En el checkout principal hay cinco
grabaciones, así que ahí sale verde y en cualquier árbol nuevo muere con `ENOENT: scandir`.

Lo que duele es el segundo fallo: **el guion que nació (#629) para que el reproductor explique qué
le falta a una grabación, no explica lo que le falta a él**. Debe salir `⊘` con su motivo, no `✘`
— es lo que pide #476, y la casa ya tiene el precedente: `⊘` **ya existe** (`ctx.sinMedir`,
`run.mjs:933`, y `ctx.sinMedirBloque`, `:955`), así que no hay nada que decidir sobre el runner.

**Y hay un tercer fallo que el issue no ve, encontrado por la crítica**: si `labs/narrative/runs/`
existe pero está **VACÍO**, el `for` de `141:14` no entra y el guion sale **VERDE con cero
asertos** — `run.mjs` no comprueba en ningún sitio que un guion haya afirmado algo. El arreglo tiene
que cubrir *ausente* **y** *vacío*, o cambia un `ENOENT` honesto por un verde mudo. (Hoy hay **8**
grabaciones en el checkout principal, no cinco.)

## Lo que NO entra, y por qué (decidido con la crítica)

- **#634** (la intermitencia del guion 75) — **PREMATURA**. Su salida (a) edita
  `src/protocol/escena-servida.ts` (`tile-store.ts:20,99` → `huellaDeEscena`), módulo con suelo 100:
  **bloqueada por la corrida en vuelo**. Y su (b) **no se abarata con #639**, que era mi razón para
  proponerla: `ctx.sinMedir` ya existe, y `run.mjs:1266`/`:1320` mantienen ROJO a propósito al guion
  que declara ⊘ arrastrando fallos («un ⊘ es una declaración, no una amnistía»), que es justo el caso
  del 75. Su (c) es el statu quo, y el issue abierto ya ES el sitio donde anotar. **Se decide con el
  usuario después de repartir la corrida.**
- **#606** (`esperarFrames` copiado en seis guiones) — **EN CONFLICTO con el criterio de cierre**.
  El hecho es cierto (6 copias, 22 llamadas) y su justificación es hoy más fuerte de lo que dice
  —`reloj()` ya está en el hook (`nefan-hook.ts:262`) y lo usan 6 guiones y 2 módulos de `qa/lib/`—,
  pero comparte **molde** con #645, no artefacto: toca seis guiones de navegador, o sea re-correr la
  batería para demostrarlo.
- **#643** y **#646** — las dos razones de exclusión del §anterior las verificó la crítica y son
  **ciertas**: #643 nombra `salida-del-solido.ts` en su cuerpo y no tiene versión que no edite el
  módulo que la corrida estrena; #646 declara él mismo depender de #618, aparcado ayer.

## Lo que la tanda NO cubre, y hay que decirlo

El guion **39 no abre navegador** (solo lee ficheros de `qa/guiones/`) pero vive en `qa/guiones/`,
así que queda **fuera del censo de #645 por construcción** — y es precisamente el rojo que nadie
corrió durante dos días. **El candado de #645 no lo habría cazado.** Si el arquitecto ve cómo
cerrarlo sin inflar la tanda, que lo diga; si no, sale como issue con su medida.

## Restricciones de la casa que aplican aquí

- **Cero créditos.** Todo con `html-fixtures`, `e2e-sin-creditos` o el motor falso. El #633 es
  literalmente el candado del gasto: no se arregla gastando.
- **No se toca `nefan-core/src/**`** mientras la corrida esté en vuelo, salvo que la crítica
  demuestre que hace falta y diga qué módulo se sacrifica.
- **No se baja ningún umbral**, ni se sube uno para acomodar lo que acaba de crecer.
- **No se matan servidores ajenos**: hay otros agentes en la máquina. Arrancar solo con
  `NEFAN_PORT_OFFSET=<n> ./start.sh --preset <slug>` desde el worktree propio, parar solo con
  `--parar` desde ese mismo árbol. **Nunca `--parar-todo`.**
- Un guion que se arregla tiene que **poder ponerse rojo**: prueba en negativo con el caso exacto
  que lo desmentía. La tanda F y la G enseñaron que un verde que no puede ponerse rojo es lo más
  caro que hay aquí.

## Criterio de cierre

- El 39 verde con la lista diciendo la verdad, y la batería entera **en verde** (141 → 142 verde,
  0 rojos), salvo el 97 que es `sin medir` por diseño.
- El 91 mide lo mismo dos veces: dos corridas seguidas dan **el mismo número de muestras libres**,
  y el guion sale rojo si la forja deja de ser sólida (negativo probado).
- El censo de headless deja de poder envejecer: candado ejecutable con exenciones con motivo, visto
  **rojo** quitando un ejecutable de la lista y **verde** con el `⊘` de Python.
- El 141 sale `⊘` con su motivo en un worktree montado con la receta, y mide cuando hay grabaciones.
