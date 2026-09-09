# QA — PR 3 de #346 «El título troceado» · las dos hojas

Árbol: `/home/al/code/ne-fan-346-3qa`, HEAD desprendido en `18e0530a` (la punta de la PR).
Todo lo de abajo se midió ahí, con rutas absolutas y sin tocar los otros dos worktrees del programa.
Cero créditos: `e2e-sin-creditos` (motor falso) y `html-fixtures`.

## Veredicto

**APTO CON HALLAZGOS.** El movimiento es equivalente y está DEMOSTRADO, no afirmado: las 219 líneas
movidas son idénticas byte a byte a las de `HEAD~1` tras las reescrituras declaradas (comprobado con
mi propio comparador, no con el del ingeniero), la desviación D1 —la importante— es cierta y la
versión entregada SÍ conserva la conducta que defiende (medida en el juego real, con su prueba en
negativo), el candado salta por las siete puertas que el ingeniero no probó, y las dos pantallas
renderizan pixel a pixel lo mismo que antes del corte. Los hallazgos son **cuatro menores** (dos de
esta PR, dos preexistentes), **un aviso** de rojo intermitente ajeno a la PR y **uno importante de
método** (dos guiones 95 y dos agentes pisándose el log de la batería, H7, ya resuelto por mi parte):
ninguno bloquea el código de esta PR.

---

## Tabla de criterios

| # | Criterio (de la petición y del encargo) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Salen dos hojas: `crear-mundo.ts` (`pintarCrearMundo(deps)`, 3 colaboradores) y `editor-de-personaje.ts` (`pintarEditorDePersonaje(deps, eleccion)`, 3 colaboradores) | ✅ | `wc -l`: 129 y 183. Firmas leídas en el árbol; `DepsDeCrearMundo` = `{content, narrative, ir}`, `DepsDeEditorDePersonaje` = `{content, elegir, ir}`. Ningún objeto de contexto |
| 2 | **Sin cambiar comportamiento** — el código movido es el de HEAD | ✅ | Comparador PROPIO (`scratchpad/qa-verbatim.py`, `qa-ed.py`), independiente del del ingeniero: desindentado 2 espacios el bloque `HEAD~1:1325-1416`, aplicadas las 5 reescrituras declaradas → **diff de 0 líneas** contra `crear-mundo.ts:38-129`. Cuerpo del editor (`1424-1537`) → **0 líneas**. `nombreDeModelo` (`1615-1621`) → **0 líneas**. Residuo de `this.` en lo esperado: `[]` |
| 3 | Los sitios de llamada de la raíz conservan su forma | ✅ | `title-screen.ts:1042-1066` vs `HEAD~1:1032-1058`: mismo `paso(…, "title", "abrir el editor de personaje", () => {continueBtn.disabled=false})`, mismo `continueBtn.disabled = true` antes, y «Crear mundo» sigue siendo síncrono y sin `paso` |
| 4 | **D1 · `ir` devuelve `Promise<void>`: el argumento es cierto** | ✅ | `qa/guiones/96-…`, sabotaje 1 (`await deps.ir({…})` → `paso(deps.ir({…}), …)`, que es lo que la firma `void` obliga a escribir): la pantalla se queda en «Mundo creado: Mundo del Bench.» con `crear=false volver=false`, y el bloque siguiente **ni siquiera puede pulsar «Crear mundo»** (30 s de timeout). Callejón sin salida, medido |
| 5 | **D1 · la versión entregada SÍ conserva esa conducta** | ✅ | Mismo guion sin sabotaje: `motivo` = «No se pudo crear el mundo: games_dir_unreadable: EACCES: permission denied, scandir '…/games'», `crearPulsable=true`, `volverPulsable=true`, y seguimos en «Crear mundo». El fallo se provoca SIN estado sintético (ver §Workarounds) |
| 6 | El `preselect` del encadenado llega | ✅ | Bloque C del 96: el mundo recién creado viene SELECCIONADO. Sabotaje 2 (quitar `preselect`) → rojo: `creado user_mundo_bench_2 · seleccionado alta_fantasia` |
| 7 | `show()` / `elegir(accion)` = `this.resolve?.(…)` con su `?.` intacto | ✅ | `title-screen.ts:1381`: `elegir: (accion) => this.resolve?.(accion)`. Mismo `res` de la misma promesa; llamar dos veces sigue siendo no-op sobre una promesa ya resuelta, y con `resolve` en `null` sigue sin hacer nada. **Única diferencia semántica**, buscada y verificada inocua: con `a?.(expr)` el argumento NO se evalúa si `a` es nulo, y ahora sí — pero el literal solo lee propiedades ya guardadas (`game.game_id`, `modelSel?.value`, `skinInput?.value.trim()`), sin efectos ni posibilidad de lanzar |
| 8 | El límite de 64.000 caracteres del borrador | ✅ | `validarBorrador` se llama verbatim (0 líneas de diff) y el guion **92 bloque F** lo mide en el juego real: verde en las dos corridas completas |
| 9 | El `try/catch` de `crearElMundo()` mantiene el `await` dentro | ✅ | `crear-mundo.ts:119` `await deps.ir({ a: "selector", preselect: created.gameId });` dentro del `try` de :104. Verificado además en ejecución (fila 5) |
| 10 | **El candado por las puertas que el ingeniero NO probó** | ✅ | Sondas EN DISCO (no `SourceFile` fabricados) + `npx tsx --test test/architecture.test.ts`. Saltan las **siete**: import dinámico, `export * from`, `export {X} from`, import solo por efecto, sin extensión (`./crear-mundo`), subdirectorio hijo→padre (`titulo/sub/x.ts` → `../crear-mundo.js`) y alias que da la vuelta (`@nefan-core/../nefan-html/src/ui/titulo/crear-mundo.js`). Detalle abajo |
| 11 | `atomos.ts` sigue siendo importable desde las hojas | ✅ | La sonda legítima (`import { BTN_PRIMARY_CSS } from "./atomos.js"`) **nunca** aparece en la lista de violaciones, y las dos hojas reales lo importan con la regla en verde (97/97) |
| 12 | **Los listeners**: ninguna hoja engancha a `document`, `window`, `root` ni `content` | ✅ | `grep -nE 'addEventListener\|ResizeObserver\|\bdocument\.\|\bwindow\.'` sobre las dos hojas: 5 líneas, las 5 sobre nodos creados por ellas (`fileEl`, `backBtn`, `createBtn`, `back`, `start`). Los cinco de por vida siguen en la raíz (:181, :309, :311, :340, :361) |
| 13 | La señal medible del §2 del plan tras 5 idas y vueltas | ✅ | Bloque D del guion 96: `{"responsive":1,"mas":1,"close":1,"hijos":3}` antes y después de 5 idas y vueltas por **las dos hojas**. Probado en negativo (un nodo colgado del chasis por pintado → `antes 4 · después 9`) |
| 14 | **Crítica visual contra el árbol de antes del corte** | ✅ | Capturas del mismo guion en `18e0530a` y en `5bfa8a84`: `editor-de-personaje.png` **idéntica byte a byte** (md5); `crear-mundo-limpia.png` con diferencia **máxima de 0,72/255** en toda la imagen (ruido de rasterizado de fuente, bbox vacía al 1 %); `selector-de-mundos` y `subir-estilo` idénticas |
| 15 | La batería entera desde un árbol quieto | ✅ | **Dos corridas completas.** La 2ª, con el guion nuevo dentro: **94 en verde · 0 en rojo de 94** (`.../qa/capturas/2026-09-09T14-25-03-385Z-190719`). La 1ª: 92 en verde · 1 en rojo de 93, rojo `93-la-velocidad-y-el-alcance`, que sale **verde** aislado y verde en la 2ª corrida. Ver H5 |
| 16 | Las dirigidas del plan §7 para esta PR (27 y 47) | ✅ | `✔ 27-el-clon-limpio-quiere-jugar`, `✔ 47-el-desplegable-solo-promete-hojas-completas` en la corrida completa |
| 17 | `npm run verify` | ✅ | `tests 2448 · pass 2448 · fail 0 · verify exit=0` (medido por mí, con el guion nuevo ya en el árbol) |
| 18 | Cliente limpio | ✅ | `npx tsc --noEmit` exit=0 · `npx eslint .` exit=0 |
| 19 | Trinquete de tamaño y cifras del encargo | ✅ | `wc -l title-screen.ts` = **1.461** = la cifra de `client-file-size.json`. `let` = **8**. `private.*render[A-Z]` = **5**. Módulos nuevos 129 y 183 ≤ 450 |
| 20 | La deuda no crece | ✅ | `[deuda] html-sin-promesa-muda (max 7)` y `[deuda] html-sin-catch-silencioso (max 4)` verdes dentro de `architecture.test.ts` (97/97) y de `verify` |
| 21 | Ningún rastro de prosa vivo se queda sin sujeto | ❌ | **Dos** que este corte deja sin sujeto y no se barrieron: H1 y H2 |
| 22 | Equivalencia frente al árbol de ANTES del corte, midiendo el juego | ✅ | El guion 96 (10 asertos) sale **verde igual sobre `5bfa8a84`**, con `renderCreateWorld` todavía dentro de la clase. Es la medida que el diff verbatim no puede dar |
| 23 | Gasto real de créditos | ⚠ no probado | Por diseño: `e2e-sin-creditos` + `html-fixtures`. El guardarraíl declaró `fake:true` en las dos puntas en cada guion |

---

## El candado, medido en disco (criterio 10)

El ingeniero vio la regla roja por **tres** puertas (import directo, `import type` del enrutador,
vuelta larga). Probé las que faltaban, con ficheros REALES en `nefan-html/src/ui/titulo/` (el motor
de verdad: `loadArchFiles` → `walk` → `ts.preProcessFile` → resolutor), un lote y luego los dos que
quedaban:

```
nefan-html/src/ui/titulo/qa-sonda-alias.ts:1     — import prohibido: "@nefan-core/../nefan-html/src/ui/titulo/crear-mundo.js" → …/crear-mundo.ts
nefan-html/src/ui/titulo/qa-sonda-dinamico.ts:1  — import prohibido: "./editor-de-personaje.js"  → …/editor-de-personaje.ts
nefan-html/src/ui/titulo/qa-sonda-efecto.ts:1    — import prohibido: "./crear-mundo.js"          → …/crear-mundo.ts
nefan-html/src/ui/titulo/qa-sonda-named.ts:1     — import prohibido: "./crear-mundo.js"          → …/crear-mundo.ts
nefan-html/src/ui/titulo/qa-sonda-reexport.ts:1  — import prohibido: "./crear-mundo.js"          → …/crear-mundo.ts
nefan-html/src/ui/titulo/qa-sonda-sinext.ts:1    — import prohibido: "./crear-mundo"             → …/crear-mundo.ts
nefan-html/src/ui/titulo/sub/qa-sonda-hijo.ts:1  — import prohibido: "../crear-mundo.js"         → …/crear-mundo.ts
```

**Aviso de método para quien pruebe candados aquí**: el mensaje del `AssertionError` **imprime como
mucho 5 violaciones**. Con las ocho sondas puestas a la vez, las dos últimas por orden alfabético
(`sinext` y `sub/hijo`) NO aparecían y parecían huecos de la regla; con el lote reducido a esas dos,
las dos salen. Un candado se prueba en negativo **de una en una o en lotes cortos**, o se lee un
número que no es. Retiradas las ocho sondas: `tests 97 · pass 97 · fail 0`.

## Equivalencia visual (criterio 14)

Mismas dos pantallas capturadas por el mismo guion sobre `18e0530a` y sobre `5bfa8a84`:

| Captura | Resultado |
|---|---|
| `94-…-04-editor-de-personaje.png` | **md5 idéntico** |
| `94-…-02-selector-de-mundos.png`, `…-03-subir-estilo.png` | md5 idéntico (pantallas que esta PR no toca) |
| `95-…-01-crear-mundo-limpia.png` | 1.931 px de 1.024.000 distintos, **máximo 0,72/255**; con umbral del 1 % la bbox de la diferencia es **vacía**. Ruido de rasterizado, no cambio de diseño |
| `95-…-03-selector-con-el-mundo-recien-creado.png` | diferencia por debajo del umbral del 5 % en toda la imagen (decodificado de las portadas JPEG) |
| `94-…-01-home-con-el-save.png` | distinta, con motivo: lleva la fecha y el id de la partida sembrada |

Mirándolas como jugador: las dos pantallas mantienen el vocabulario del título (titular ámbar `#da6`,
primario ámbar / secundario oscuro, columna de 720 px, mismo interlineado). No hay nada movido, ni un
color, ni un espaciado.

---

## Hallazgos

### H1 · MENOR · **de esta PR** — rastro de prosa que este corte deja sin sujeto (el que la D6 dice haber barrido)

`nefan-core/src/protocol/borrador-de-mundo.ts:11` sigue diciendo, en presente:

> «Hasta la PR 7 de #241 (2026-09-07) el umbral estaba escrito en las dos (**`title-screen.ts:1382`** y
> `bridge/handlers/session.ts:160`)…»

Esa comprobación del borrador vive desde esta PR en `nefan-html/src/ui/titulo/crear-mundo.ts:95`. Hoy
la línea 1382 de `title-screen.ts` es `elegir: (accion) => this.resolve?.(accion),`, que no tiene nada
que ver. La desviación **D6** del informe declara que «el `:1382`» se reescribió — pero se reescribió
solo la copia de `qa/README.md:222`; ésta, que está en un módulo de core y es la fuente que un agente
lee al tocar el borrador, se quedó. Es exactamente el patrón «los rastros confunden a los agentes».

**Reproducción**: `grep -rn "title-screen.ts:1382" --include=*.ts nefan-core/src`
**Qué esperaba**: la cita nombra el módulo (`ui/titulo/crear-mundo.ts`), no una línea que ya es otra cosa.
**Arreglo**: una frase, en el mismo commit. (El otro `title-screen.ts:905-909` de
`eleccion-de-estilo.ts:12` y de `qa/guiones/92-…:7` es del selector y **es de la PR 5**, no de ésta —
la D6 acierta ahí.)

### H2 · MENOR · **de esta PR** — dos símbolos muertos citados en presente en `arch-rules.json`

El `why` de `html-sin-promesa-muda` (`nefan-core/data/contract/arch-rules.json:412`) dice:

> «En title-screen.ts había once: ocho pasaron a `paso()` y tres ni siquiera eran promesas —
> **`renderCharacterEditor`, `renderCreateWorld`** y `renderUploadStyle` **son** síncronos…»

Dos de esos tres nombres ya no existen en el repo (los renombró esta PR a `pintarCrearMundo` /
`pintarEditorDePersonaje`, en otro fichero). El tercero sigue vivo hasta la PR 2. El tiempo verbal
(«son») es lo que lo convierte en rastro y no en registro histórico: quien haga `grep renderCreateWorld`
lo encuentra ahí y en ningún otro sitio.

**Reproducción**: `grep -rn "renderCreateWorld" --include=*.json --include=*.ts . | grep -v docs/agents`
**Qué esperaba**: el párrafo dice de qué pantalla hablaba, o nombra los módulos de hoy.
**Nota**: es discutible que sea un rastro (el párrafo narra una PR pasada). Lo reporto porque es la
única mención viva de esos dos nombres y porque el mismo `why` va a tener que tocarse en la PR 2 por
`renderUploadStyle`: entonces sale gratis.

### H3 · MENOR · **preexistente / del encargo, no del código** — la receta del criterio 6 no llega a las dos pantallas

El encargo pide mirarlas con `NEFAN_PORT_OFFSET=600 ./start.sh --preset html-fixtures`. **Ese preset no
puede enseñarlas**: sin bridge, el título se queda en `display:none` y el cliente cae directo al visor
de fixtures. Medido en `http://localhost:3600/?offset=600`:

```json
{ "titulo": true, "display": "none", "hayMundos": 0,
  "ids": ["ts-mas","ts-close"], "texto": "✕ cerrar (modo fixtures, sin sesión)" }
```

No es un fallo de la PR (es el diseño de `html-fixtures`, candado por `qa/fixtures-sin-bridge.mjs`),
pero sí invalida esa receta para el siguiente que la siga. El preset de cero créditos que **sí** llega
es `e2e-sin-creditos`, y es el que usé para la comparación píxel a píxel. Stack parado con
`NEFAN_PORT_OFFSET=600 ./start.sh --parar`, que dejó explícitamente en pie lo ajeno (`:3000` de
`ne-fan-346-2qa`, `:9877/:9878`, `:18765`).

### H4 · MENOR · **preexistente** — dos controles del sistema rompen la estética de «Crear mundo»

Mirando la captura como director de arte: el `<input type="file">` se pinta con el widget nativo del
navegador («Choose File · No file chosen», en inglés, con fuente y borde del sistema) y el checkbox de
pre-generación con el azul por defecto, dentro de una pantalla que por lo demás es entera monoespaciada,
en español y con la paleta ámbar/carbón del título. Es el único punto de la pantalla que no parece del
juego. Viene **verbatim de HEAD** (líneas idénticas byte a byte, criterio 2): **no lo causa esta PR** y
no debe bloquearla; lo anoto porque ahora que «Crear mundo» es un módulo de 129 líneas es barato
arreglarlo, y porque #427 (los huecos de mensaje del título) aterriza cerca.

### H5 · AVISO · **preexistente, sin camino causal desde esta PR** — `93-la-velocidad-y-el-alcance` es intermitente

Corrida completa 1: `92 en verde · 1 en rojo de 93`, con
`✘ con speed_scale × 1.5 …, esprintando son 12.54 m/s — medido 12.1429 m/s (13.58 m / 1.12 s, 30 m libres)`.

No lo llamo flake por decreto, lo aíslo: **`node qa/run.mjs 93-la-velocidad` sobre el mismo commit →
`1 en verde · 0 en rojo`**, y la **corrida completa 2 sobre el mismo commit → `94 en verde · 0 en rojo
de 94`**, con el 93 dentro y verde. Tres medidas, un solo rojo. Además: (a) el aserto es una velocidad
media con reloj de pared dentro de una corrida de 94 guiones, y falla por un **3,2 %** por debajo;
(b) el diff de esta PR es `nefan-html/src/ui/{title-screen.ts, titulo/*}` + `client-file-size.json` +
`qa/README.md` (`git show --stat`) — **ni una línea de `nefan-core/src`, del sim ni del cliente fuera
del título**, así que no hay camino por el que pueda mover la velocidad del jugador; (c) es la misma
clase de varianza que #545 midió hoy sobre `main`. **No es de esta PR**, y es el
candidato a sumarse a la lista de intermitentes que la QA de la PR 1 abrió (01, 80, 91).

### H6 · INFORMATIVO · para las PR 2, 4 y 5 — los dos `case` síncronos de `ir` lanzan en síncrono

`ir` no es `async`: `case "crear-mundo"` y `case "subir-estilo"` llaman al método y devuelven
`Promise.resolve()`. Si esos métodos lanzaran, `ir` lanzaría **antes** de devolver promesa, así que un
`paso(this.ir({a:"subir-estilo"}), …)` no encauzaría ese fallo por `paso` (dentro de un `await` sí es
equivalente). Hoy **no tiene ocupante** —esos dos `case` no los llama nadie (D4) y los sitios de llamada
directos son igual de síncronos que antes—, pero quien estrene esos `case` en la PR 2 o la 5 debería
mirarlo. No es un fallo de esta PR.

### H7 · IMPORTANTE (de método, no de código) · **el 95 ya estaba cogido, y dos agentes se pisaron el log de la batería**

Dos colisiones reales entre los worktrees del programa, las dos medidas hoy:

1. **Dos guiones 95.** `/home/al/code/ne-fan-346-2qa/qa/guiones/` ya tiene
   `95-las-pantallas-del-titulo-vuelven-sin-dejar-rastro.mjs`. Es exactamente el riesgo que los
   requisitos declaran («la numeración en paralelo es un riesgo conocido: en #358 nacieron dos 83»).
   **Lo resolví yo renumerando el mío al 96** (`96-el-fallo-del-repintado-vuelve-a-crear-mundo.mjs`,
   verde bajo el nombre nuevo) en vez de dejarle el choque al que rebase. **El siguiente libre es el
   97.**
2. **El log de la batería se sobreescribió entre agentes.** Los dos QA del programa comparten el
   directorio de scratchpad de la sesión, y los dos escribimos una corrida en `…/scratchpad/bateria2.log`:
   el fichero acabó con la cabecera de una corrida y el veredicto de la otra («capturas en
   `…/ne-fan-346-2qa/…`», y un `▶ 95-las-pantallas-del-titulo-…` que no existe en mi árbol). Las
   capturas de cada corrida sí fueron a su árbol —ninguna medida se cruzó— pero **el número que se lee
   al final sí**. Relancé la batería con nombre de fichero único y comprobé que el id de la corrida del
   pie coincide con el de su propia cabecera; el `94 en verde · 0 en rojo` de la fila 15 es esa corrida
   limpia. **Aviso para el coordinador**: cualquier veredicto de batería de esta tanda que se leyera de
   un log de nombre genérico hay que volver a mirarlo.

---

## Workarounds usados, y su veredicto

| Workaround | Para qué | ¿Le pasa al jugador? |
|---|---|---|
| `chmod 300` sobre el `data/games` **de la corrida** (`QA_RUN_TMP`) | Provocar el fallo del repintado del criterio 5 de forma determinista | **No es estado sintético**: es un directorio escribible y atravesable pero no listable, con lo que `create_game` escribe y `list_games` revienta con el `games_dir_unreadable: …` que el bridge YA sabe contestar (`bridge/handlers/session.ts:110-122`). Le pasa a cualquiera cuyo `data/games` pierda permisos o viva en un disco desmontado. Se restaura en un `finally` y el directorio es efímero. **No es hallazgo** |
| Sabotajes en `crear-mundo.ts` (3, uno por vez) | Probar el guion 95 en negativo | Restaurados desde copia (`git status` limpio salvo el guion nuevo). **No es hallazgo** |
| Ocho ficheros sonda en `ui/titulo/` (+ `sub/`) | Probar el candado en disco | Retirados; `architecture.test.ts` verde después. **No es hallazgo** |
| `git checkout HEAD~1` en MI árbol y vuelta a `18e0530a` | Capturar las mismas pantallas antes del corte | Mi worktree, reversible, verificado con `git log --oneline -1` y `wc -l`. **No es hallazgo** |
| Ninguno para ver las pantallas | — | **Se llega por el camino del jugador**: home → «Nueva partida» → selector → «Crear mundo» / «Continuar». Sin ocultar overlays ni forzar estado |

## Guion dejado

`qa/guiones/96-el-fallo-del-repintado-vuelve-a-crear-mundo.mjs` (+ su fila en `qa/README.md`).
**Nació como 95 y lo renumeré al 96**: la QA de la PR 2 ya tenía un
`95-las-pantallas-del-titulo-vuelven-sin-dejar-rastro.mjs` en su árbol (H7). **El siguiente libre es el
97.** Cuatro bloques, diez asertos:

- **A** la pantalla abre con los dos botones pulsables y sin motivo escrito.
- **B** el fallo del repintado aterriza en el `catch`: el mundo SÍ se crea, la pantalla escribe el
  motivo del bridge, los dos botones vuelven y el selector no se pinta.
- **C** el camino bueno acaba en el selector con el mundo recién creado SELECCIONADO (el `preselect`).
- **D** tras 5 idas y vueltas por las DOS hojas, el chasis sigue siendo uno (`#title-screen-responsive`,
  `#ts-mas`, `#ts-close` × 1 y `#title-screen` con 3 hijos).

**Probado en negativo**, un sabotaje por vez y restaurado:

| Sabotaje | Resultado |
|---|---|
| `await deps.ir({…})` → `paso(deps.ir({…}), …)` (lo que obliga la firma `void` del plan) | «Mundo creado: Mundo del Bench.», `crear=false volver=false`, y C **no puede ni pulsar el botón** (timeout 30 s) |
| `preselect: created.gameId` fuera | rojo SOLO en C: `creado user_mundo_bench_2 · seleccionado alta_fantasia` |
| Un nodo colgado del chasis por pintado | rojo SOLO en D: `antes 4 · después 9` |
| — restaurado | **10/10 verde** |

Y, lo que importa para una PR de movimiento: **el mismo guion sale verde sobre `5bfa8a84`** (el árbol
de antes del corte, con `renderCreateWorld` dentro de la clase). Mide conducta, no la implementación
nueva.

## No probado

- **Gasto real de créditos**: por diseño, cero créditos en toda la validación (`e2e-sin-creditos` con
  motor falso, `html-fixtures`). El guardarraíl declaró `fake:true` en cliente y bridge en cada guion.
- **La subida de un `.md`/`.txt`** en «Crear mundo» (la rama del `FileReader`): no la conduje en vivo.
  Cubierta por la equivalencia verbatim (0 líneas de diff, y ese handler no toca ninguna de las
  reescrituras) y por el banco A/B del ingeniero.
- **La rama con pre-generación marcada**: mi guion la desmarca a propósito para no encolar trabajo del
  bridge que sobreviva a la corrida. Cubierta por lo mismo.
- **Los cuatro `case` de `ir` sin llamante** (`home`, `crear-mundo`, `subir-estilo`, `editor` como
  destinos enrutados): no se pueden ejercer hoy (D4). Solo `{a:"selector"}` está en uso, y es el que
  miden los bloques B, C y D del guion 96.
- **El suelo de cobertura** (88,7 % vs 89 %): no lo remedí. Que no es de esta PR se comprueba con
  `git show --stat 18e0530a`: ni un fichero de `nefan-core/src`.
- **La corrida de mutación**: `npm run afectado` no selecciona nada (el diff es cliente + un JSON de
  contrato + `qa/README.md`), y el cliente está fuera del perímetro (`afectado.test.ts:252-259`).

## Para el coordinador

1. **La desviación D1 está justificada y demostrada**, con su prueba en negativo. Si la PR 2 llegó a
   otra firma, la que vale es `ir(destino): Promise<void>`, y el guion 96 es lo que lo defiende a partir
   de ahora.
2. **H1 y H2 son de esta PR** y se arreglan con dos frases; H3 y H4 son preexistentes; H5 no es de esta
   PR y H6 es un aviso para las PR siguientes.
3. **El 95 lo tenía ya la QA de la PR 2**; renumeré el mío al **96**. El siguiente libre es el **97**.
   Y ojo con los logs compartidos del scratchpad entre agentes hermanos (H7): un veredicto de batería
   leído de `bateria2.log` puede ser el del árbol de al lado.
4. Al probar candados en negativo, cuidado con el tope de 5 violaciones impresas del `AssertionError`
   (§ del candado): a mí me escondió dos puertas que sí saltaban.
