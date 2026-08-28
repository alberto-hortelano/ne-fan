# QA — El cliente tras el título (#312 #311 #268 #260 #310)

Rama `feature/cliente-tras-el-titulo`, commit `187bc38`. Validado contra la petición literal
—«Vamos a seguir priorizando reducir el numero de issues»— y contra el **criterio de cierre de
cada issue**, leído de `gh api`, no del resumen de nadie.

**La pregunta de hoy era: ¿se puede cerrar cada uno honestamente?**

| Issue | ¿Se puede cerrar? | En una línea |
|---|---|---|
| #312 | **Sí** | Las dos mitades del criterio están candadas y las dos se ponen rojas (probes A y B). Le faltaba la rama `game_gen`, que ahora tiene guion (probe G) |
| #310 | **Sí** | Arreglado en los 7 tamaños medidos; los asertos se ponen rojos con la colocación vieja (probe C) y con la intermedia (probe D) |
| #260 | **Sí** | Regla activa, sin `eslint-disable`, corre en CI (`ci.yml:96`) y se pone roja con un handler `async` (probe H) |
| #268 | **Sí**, y con más de lo que se prometió | La rama `undefined` se declaró inverificable; se ejerce en navegador real y se pone roja (guion 36, probe E) |
| #311 | **Sí, PERO el texto de cierre no puede decir lo que dice el criterio del issue** | Su criterio literal —«`dialogueActive` deja de estar escrito en dos listeners»— **NO se cumple**: los dos listeners siguen con el gate y `DevToolsDeps` sigue ahí. Cerrarlo es legítimo por el reencuadre que el usuario aprobó, pero **solo si el cierre lo dice** |

---

## Criterios de aceptación (`requisitos.md`, sección «los válidos»)

| Criterio | Estado | Evidencia |
|---|---|---|
| **1** · Los cinco cerrados con evidencia | ⚠️ pendiente del texto | Los cinco siguen `open` (`gh api …/issues/N --jq .state`, 2026-08-28): no hay PR. Los cinco son cerrables; #311 con la salvedad del hallazgo 1 |
| **2** · #310 · `#ts-close` fuera de la banda superior, verificado a **500 px** con la barra llena | ✅ cumple | `qa/guiones/33-…` bloque 1e: `{"caja":{"top":94,"bottom":120},"barra":{"top":0,"bottom":86},"solapaLaBarra":false,"golpea":"ts-close","loGolpea":true}`. **Probado en rojo**: con `top:12px` (la colocación de `main`) → `"golpea":"dev-status","loGolpea":false` y 3 asertos rojos entre el 33 y el 34 |
| **2b** · La salida 3 (que la barra no se pinte) sigue PROHIBIDA | ✅ cumple | `dev-ui.css` intacto salvo nada; `--dev-status-alto` sigue en `base.css:49` y el guion 33 sigue afirmando la reserva. `git diff main...HEAD -- nefan-html/src/ui/dev-ui.css` → vacío |
| **3** · #260 · `no-misused-promises` activada y en verde, sin silenciar ni exceptuar | ✅ cumple | `eslint.config.js:52`; `grep -rn "eslint-disable" nefan-html/src` → 0; `npm run lint` verde sobre el árbol limpio. **Probado en rojo** (probe H): devolver un handler a `addEventListener("click", borrarLaPartida)` → `562:39 error Promise returned in function argument where a void return was expected` |
| **3b** · Solo `:1050` cambia de comportamiento, sin `finally` | ✅ cumple | `grep -n "finally" nefan-html/src/ui/title-screen.ts` → 0 en los seis handlers; el `await` del `FileReader` quedó DENTRO del `try` (`title-screen.ts`, comentario «EL `try` EMPIEZA AQUÍ»). Los otros cinco solo cambian de forma |
| **4** · #268 · `paso(undefined)` no lanza y deja rastro; lo que no es promesa grita; lo canda `tsc` | ✅ cumple, **y ahora también en ejecución** | `tsc --noEmit` verde con la firma nueva. Y **guion nuevo `qa/guiones/36-…`**, que emula el navegador del issue: 3 clicks al lienzo → `llamadas 0 → 3`, **0 excepciones de página**, **1 sola** entrada en el registro («…no se pudo capturar el ratón (pointer lock): este navegador no devuelve promesa aquí…»). **Probado en rojo** (probe E): con `paso()` sin la guarda → 3 `TypeError` sin recoger, 0 entradas |
| **5** · #311 · olvidarse no puede compilar; `dialogueActive` deja de ser un espejo sin sink | ⚠️ **cumple a medias** | El sink `dialogo` sí lo canda `tsc` (`FacetSinks` es un tipo mapeado; el ingeniero pegó el error). Pero el criterio LITERAL del issue no se cumple — ver hallazgo 1. Lo que sí se arregló y ahora tiene guion: el par `abrirDialogo`/`cerrarDialogo`. **Guion nuevo `qa/guiones/37-…`**, rojo en las dos direcciones (probes F y F2) |
| **6** · #312 · ejercido con `spawn`; `ready` ajeno no toca `playerPos` ni el loader; `error` ajeno sigue llegando | ✅ cumple, **las dos mitades candadas** | `qa/guiones/35-…` verde. **Probe A** (`descartado`→`juego`): el jugador salta de `{0.25,3.25}` a `{17.25,20.25}` → 2 asertos rojos. **Probe B** (quitar la rama `fallo-ajeno`): «un `error` de la sesión muerta SIGUE llegando al registro» → **rojo**, 0 entradas. La segunda mitad **no es prosa**: se pone roja |
| **6b** · El coste de `replay-server.mjs`, respetado | ✅ cumple, **y ejercido con navegador** | `./start.sh --preset replay-web` con `runs/2026-07-12_16-47-04`: la película entrega `status generating` + `status error` y el cliente los pinta con **`descartados: {"n":0,"status":0}`** — no tiró nada. El ingeniero solo lo había medido con una sonda WS |
| **7** · `npm run verify` verde y `qa/run.mjs` sin rojos | ✅ cumple | `nefan-core && npm test` → **1605 tests, 0 fail** (incluye los candados de `arch-rules.json` sobre `qa/**`, que cubren los tres guiones nuevos). `node qa/run.mjs` → **37 en verde · 0 en rojo de 37** (34 + los 3 míos), capturas en `/home/al/code/ne-fan/qa/capturas/2026-08-28T19-56-56-589Z-457105` |
| **7b** · El agujero: el lint de `nefan-html` no va en `npm run verify` | ✅ tapado | `.github/workflows/ci.yml:96` corre `npm run lint` en el job `nefan-html`. El candado de #260 es real en CI, no solo local |
| **8** · La deuda no sube (66 / 15) | ✅ cumple | `nefan-core && npm run deuda` con mis tres guiones en el árbol → `Deuda medida — 66 items` · `Fronteras — deuda congelada · 15`. Clavado |

### Estados del sistema recorridos

| Estado | Resultado |
|---|---|
| Arranque con el título delante, 500×480, barra de dev LLENA | `#ts-close` visible, alcanzable, sin solape de texto (guion 33) |
| Título con 0 / 5 / 12 partidas guardadas | Sin regresión; el aviso de #251 sigue contando bien (guion 33) |
| Ventanas extremas 320×240, 380×300, 500×360, 500×200, 900×200, 1280×800, 1920×1080 | `loGolpea:true` y `solapaLaBarra:false` en **las siete**; el botón nunca sale del viewport. Sonda de QA, salida completa en el hallazgo 5 |
| Partida en curso, `ready` ajeno con `spawn` | El jugador no se mueve; `descartados.status` 0→1 (guion 35) |
| Partida en curso, `error` ajeno | Llega al registro con su motivo; no mueve al jugador (guion 35) |
| Diálogo abierto con un NPC, teclado real | Panel y gate puestos a la vez; `W` no mueve; al elegir, los dos se sueltan en el mismo turno (guion 37) |
| **Dos partidas seguidas** (jugar → título → pre-generar mundo) | La barra de pre-generación **sigue viva**: los `game_gen` llegan con sello AJENO (`["1787947209-c7ab29","1787947210-c1099b"]` contra la sesión `""` del cliente) y aun así pintan (guion 38) |
| Título abierto y cerrado 3 veces seguidas | `data-titulo` 1→0 las tres; 0 entradas nuevas en el registro; un solo `#ts-close` en el DOM (sin fugas) |
| Modo fixtures sin sesión (título cerrado por su botón) | El lienzo recibe el click y pide el pointer lock (guion 36) |
| `replay-web` con una grabación real | El cliente reproduce y no descarta nada (ver 6b) |
| Sesión que muere con un diálogo abierto | **No probado — no hay camino alcanzable.** Ver «No probado» |

---

## Hallazgos

### 1 · IMPORTANTE — el criterio de cierre de #311 no se cumple, y el texto de cierre no puede fingir que sí

**Qué dice el issue, literal** (`gh api …/issues/311`):

> `dialogueActive` deja de estar escrito en dos listeners, y olvidarse de cablearlo **no puede**
> abrir el movimiento durante una conversación.

**Qué hay en `187bc38`:**

- `nefan-html/src/input/keyboard-input-provider.ts:50` → `if (this.dialogueActive) return;`
- `nefan-html/src/input/dev-tools-input.ts:26` → `if (deps.isDialogueActive()) return;`
- `DevToolsDeps` (`dev-tools-input.ts:12-15`) y su cableado (`main.ts:517`) **siguen existiendo**.

O sea: **la duplicación que el issue nombra sigue entera**. Lo que cambió es otra cosa (buena, y
mejor de lo que pedía el issue en su segunda mitad): un dueño único del par
(`abrirDialogo`/`cerrarDialogo`, `main.ts:1424-1441`) y el sink de facetas que `tsc` no deja
saltarse. Las escrituras de `input.dialogueActive` pasaron de 4 sueltas a **2, las dos dentro de
esas funciones** (`grep -rn "input\.dialogueActive\s*=" nefan-html/src` → `main.ts:1429`, `:1439`).

**No es un defecto de código**: el usuario vio el reencuadre del crítico y eligió «Los cinco,
reencuadrados», y `requisitos.md` criterio 5 dice explícitamente que el criterio *no* es borrar
`DevToolsDeps`. **Es un riesgo del cierre.** Cerrar #311 diciendo «el gate deja de estar duplicado»
sería exactamente el peor resultado que la petición de hoy nombra: un issue declarado cerrado sin
estarlo.

**Lo que el cierre tiene que decir, y basta con eso:** que el criterio se reencuadró tras la
crítica y con visto bueno del usuario; que la duplicación en los dos listeners **permanece** y
por qué (bajarla a la puerta mide peor — está escrito en `puerta-de-teclado.ts:35-45`); que lo que
se arregló es el emparejamiento y el reset al salir; y que el resto vive en **#314**.

**Y un daño colateral que ya está en marcha:** el cuerpo de **#314** ya miente en el dato que cita.
Dice «`input.dialogueActive` — 4 escrituras en `main.ts` + el sink de #311»; hoy son **2**, porque
la pasada de limpieza (`187bc38`) las absorbió después de escribir el issue. Es la lección que
`requisitos.md` recita en su primera página («una referencia `fichero:línea` caduca») repetida
dentro de la misma tanda, y a las horas. Hay que corregir esa tabla antes de que alguien la use
para medir el candado.

- **Reproducción**: `gh api repos/alberto-hortelano/ne-fan/issues/311 --jq .body` y
  `sed -n '26p' nefan-html/src/input/dev-tools-input.ts`, lado a lado.
- **Qué esperaba quien lea el cierre**: que el issue diga la verdad sobre lo que se hizo.

### 2 · MENOR — dos asertos del guion 35 no pueden ponerse rojos

Del guion que ejerce #312, **dos de los nueve son verdes por construcción**:

1. `«…y tampoco le retira el overlay de carga por su cuenta»`. En ese punto el loader ya está
   oculto (`overlay: ""` antes y después, en las tres corridas), así que el `hideLoader()` que el
   aserto teme es un no-op y comparar `"" === ""` no puede fallar. **Medido**: en el probe A —con
   el bug de #312 puesto y el jugador teletransportándose 17 m— este aserto **siguió verde**. Es el
   mismo verde que el informe de implementación ya publicó en su «medida del ANTES» sin señalarlo.
2. `«…y ese error tampoco mueve al jugador»`. Un `phase:"error"` no lleva `spawn`, y la escritura
   de `playerPos` exige `phase === "ready" && status.spawn` (`main.ts:2325`). No hay estado del
   sistema en el que pueda fallar.

No invalidan el guion —los tres asertos que cargan el peso sí se ponen rojos, y lo comprobé—, pero
inflan el recuento: «nueve asertos verdes» son siete que miden y dos que acompañan. Si el overlay
importa, hay que medirlo **con el overlay abierto** (un `showLoader` por el camino real antes de
entregar el frame ajeno); si no, sobran.

### 3 · MENOR — el guion 33 copia el número del que dice no depender

Los dos bloques de derivación afirman `despues === antes + (240 - 86)`
(`33-…:216` y `33-…:264`). El `86` es el valor de hoy de `--dev-status-alto`, escrito a mano en el
guion. Si mañana la cota pasa a 100 px, **el guion se pone rojo sin que la derivación se haya roto**
— justo lo que su propio comentario dice haber arreglado («no es un número copiado»). El arreglo es
leer la variable antes de pisarla (`getComputedStyle(root).getPropertyValue("--dev-status-alto")`) y
usar ese valor como base del delta.

### 4 · MENOR (UX) — el fallo de otra partida tapa la pantalla sin decir que es de otra partida

Un `phase:"error"` ajeno de `kind:"scene"` acaba en `pintarFalloDelMotor` → `rotuloDeStatus` →
`destino:"overlay"` → `setLoaderState("error", …)`: **overlay a pantalla completa** en mitad de la
partida viva, con el título «No se pudo preparar el lugar» — de un lugar que este jugador no pidió.
El texto que lee **no dice de dónde viene**. La procedencia solo aparece en la línea del juego
(`narrative-client.ts`: `⚠ fallo de otra partida (scene, sesión «1787…»)`), y en jerga de
desarrollo.

El propio #312 lo pedía distinto: «dejar pasar los de error, **marcados como “de una partida
anterior”**». No es regresión (antes pasaba lo mismo por el handler único) y la mitad importante
—que no se calle— está cumplida, pero el issue se cierra sin la parte de «marcados». O se hace, o
el cierre lo dice.

- **Reproducción**: partida en curso; entregar un `narrative_status` con `sessionId` ajeno,
  `phase:"error"`, `kind:"scene"` (el camino del guion 35, cambiando `kind`).

### 5 · MENOR (visual) — el botón cuelga de una cota, no de la barra

En ventanas anchas la barra de dev mide 25 px reales, pero `#ts-close` se coloca en
`calc(var(--dev-status-alto) + 8px)` = **94 px**: queda flotando 69 px por debajo de una barra que
no está, y 40 px por encima del encabezado. Se lee bien y se pulsa bien; simplemente no pertenece a
nada. Medido en las siete ventanas de la sonda: la caja del botón es `[94,120]` **en todas**, desde
320×240 hasta 1920×1080.

Es consecuencia deliberada de #250 (la reserva es por COTA, no por alto real, para que nada salte
cuando el panel crece) y por eso **no propongo cambiarlo**: derivarlo del rect real devolvería el
salto que #250 quitó. Se anota para que nadie lo lea como un descuido.

### 6 · MENOR — `replay-web` casi no se puede conducir hoy, y no es de esta tanda

Al ejercer el coste declarado de #312 me encontré con esto: de las **8 grabaciones** de
`labs/narrative/runs/`, **7 no llegan ni al selector de mundos**. Ninguna tiene `sessions_listed`
(el camino «Reanudar» que anuncia el propio launcher), y para `list_games` el servidor sintetiza
`{type:"games_listed", games:[…]}` **sin `styles`** (`replay-server.mjs:118-125`), mientras
`title-screen.ts:642` hace `new Map(styles.map(…))` desde el rediseño de mundos+estilos. Resultado
con `runs/2026-08-17_17-34-28`: `[data-game-id]` no aparece nunca.

Solo `runs/2026-07-12_16-47-04` trae `styles` en su `games_listed` grabado, y con ella el preset SÍ
funciona (es la corrida con la que validé 6b). **Es podredumbre anterior a esta tanda** —el diff de
`187bc38` no toca `synthResponse`— pero conviene un issue: el preset promete «reproducir una sesión
grabada» y con 7 de 8 grabaciones no arranca.

### 7 · OBSERVACIÓN — el gate del diálogo está triplicado, y para el movimiento sobra

Midiendo #311 encontré el dato que le falta a **#314**: el movimiento está suprimido **dos veces**
—`input.dialogueActive` en el provider y `if (dialoguePanel.isVisible)` en el propio bucle
(`main.ts:1707-1712`, «Movement (suppressed during dialogue)»)—, y el ataque igual
(`main.ts:1846`). **Medido** (probe F2): quitando `input.dialogueActive = true` de `abrirDialogo`,
el jugador **sigue sin moverse** con el diálogo delante. Lo único que `dialogueActive` protege en
exclusiva es lo que el provider escribe en su `keydown`/`mousedown` (selección de ataque, `E`, `R`,
`Y`/`N`) y las teclas dev. Refuerza la tesis de #314 y merece ir en su cuerpo.

### 8 · OBSERVACIÓN — `E` hay que mantenerla, no pulsarla

`page.keyboard.press("e")` **no abre ningún diálogo**: el provider pone `state.interact` en el
`keydown` y lo quita en el `keyup`, y el bucle no llega a consumirlo entre los dos. Una pulsación
humana dura decenas de fotogramas, así que no afecta a quien juega — pero cualquier guion futuro que
use `press()` para una tecla de un golpe medirá el vacío. El guion 37 lo mantiene 4 fotogramas y lo
deja escrito.

---

## Guiones ejecutables entregados

Tres nuevos en `qa/guiones/`, los tres **probados en negativo** (rompiendo a mano lo que dicen
verificar y comprobando el rojo; todo revertido, `git status` limpio):

| Guion | Qué protege | Probado en rojo |
|---|---|---|
| `/home/al/code/ne-fan/qa/guiones/36-un-navegador-que-no-devuelve-promesa.mjs` | **#268 en ejecución**, que el plan declaró inverificable: se emula el navegador del issue sustituyendo `Element.prototype.requestPointerLock` en `addInitScript` y se pulsa el lienzo 3 veces. Afirma que no revienta, que deja rastro y que lo deja **una sola vez** | Probe E (quitar la guarda de `undefined`): 3 `TypeError` sin recoger, 0 entradas de registro → 3 asertos rojos |
| `/home/al/code/ne-fan/qa/guiones/37-el-dialogo-abre-y-cierra-el-gate-a-la-vez.mjs` | **#311 en ejecución.** Ningún guion de la batería abría un diálogo (grep a cero), así que desemparejar el panel del gate compilaba, pasaba lint y pasaba los 34. Corre sin `?input=scripted` porque el gate solo lo lee el provider de teclado | Probe F (quitar el gate al CERRAR) → 1 rojo; probe F2 (quitarlo al ABRIR) → 3 rojos |
| `/home/al/code/ne-fan/qa/guiones/38-tras-jugar-la-pre-generacion-sigue-hablando.mjs` | **El riesgo nº 1 del plan de #312**, que solo tenía test de core: que la barra de pre-generación siga viva tras haber jugado. Se juega, se vuelve al título y se pre-genera; los `game_gen` llegan con sello ajeno de verdad | Probe G (quitar el bypass de `game_gen`): la barra **nunca** llega a un estado terminal — timeout de 240 s, `data-gen-phase` sin poner. Es el «girando para siempre» del comentario, medido |

Batería completa con los tres dentro: **37 en verde · 0 en rojo de 37**.

---

## Workarounds usados durante la prueba, y su veredicto

| Workaround | Veredicto |
|---|---|
| Sustituir `Element.prototype.requestPointerLock` para que devuelva `undefined` (guion 36) | **No es un workaround sobre el juego**: cambia el NAVEGADOR, que es la variable del issue. El cliente no se toca y el flujo es el real (cerrar el título por su botón, clicar el lienzo). Justificado |
| Entregar frames por `sock.onmessage` envolviendo `window.WebSocket` (guiones 35 y 38) | Entra por la misma puerta que el bridge (`bridge-client.ts` asigna `onmessage`) y no añade seam en producción. Justificado — **pero no reproduce la carrera real** de #312; ver «No probado» |
| `setPlayerPos` para plantarse junto al NPC (guion 37) | Teletransporte de bench que ya usan 6 guiones para tener un punto de partida determinista; la interacción en sí es la tecla `E` real sobre la acción que el juego anuncia. Justificado |
| Romper el código a mano para las 8 pruebas en negativo (probes A–H) | Cada una revertida desde una copia y verificada con `git status --porcelain` → vacío antes de seguir. Ninguna quedó en el árbol |
| **Ninguno** hizo falta para OBSERVAR la feature | No oculté ningún overlay, no forcé ningún estado y no me salté ninguna pantalla para poder medir. El único obstáculo que hubo delante era el bug de #310, y ahora no está |

---

## No probado

- **La carrera real de #312** — los frames YA EN VUELO cuando `sessionChangedError` releva el job.
  No se puede provocar de forma determinista desde el banco; lo que se mide es la DECISIÓN (core,
  con test) y su EFECTO (guion 35). El plan lo declaró y lo confirmo.
- **#268 en un Firefox de verdad.** Se ejerce el comportamiento (`requestPointerLock` devolviendo
  `undefined`), no el navegador. Es lo más cerca que se puede llegar sin meter Firefox en la batería.
- **El síntoma de `:1050` con un fichero ilegible de verdad.** El arreglo es estructural (el `await`
  dentro del `try`) y lo canda el lint; forzar un `FileReader` que falle mediría el canal, no el
  navegador. Su cierre dice «verificado por lint, tipos y revisión», y es exacto.
- **#311 con la sesión muriendo con un diálogo abierto.** Confirmo lo que dijo el crítico: no hay
  camino alcanzable. `session.leave()` solo sale de `volverAlTitulo` (`main.ts:2670`) y de un
  arranque fallido (`:2780`); `volverAlTitulo` solo se alcanza desde `#narrative-loader-back`, que
  `setLoaderState` deja `hidden` salvo con el mundo vacío (`status-labels.ts`, `salida:
  "volver-al-titulo"`), y con el mundo vacío no hay NPC con quien hablar. **No hay síntoma que
  reproducir**, y decir lo contrario sería inventarse la verificación.
- **Gasto en créditos: cero, y no medido de otra forma.** Todo con el preset `e2e-sin-creditos`
  (fake-ai-server). Ninguna prueba tocó Imagen IA, Meshy ni fal.
- **La mutación de los módulos tocados.** La corrió el ingeniero (`session-facets` 50/0/100 %,
  `status-labels` 116/0/100 %); no la repetí — es su medida y no cambié su código.
- **`replay-web` hasta el final de una película con mundo pintado.** La única grabación conducible
  hoy (ver hallazgo 6) termina en un error grabado el 2026-07-12, así que lo que verifiqué es que
  los dos `narrative_status` llegan y **no se descartan** (`descartados: {"n":0,"status":0}`), que es
  el sujeto del cambio. El resto lo tapa el hallazgo 6.

---

## Veredicto

**Apto con reservas.**

El código está bien y los cinco issues son cerrables. La reserva es **una y es de texto, no de
código**: **#311 no puede cerrarse con la frase de su criterio**. Si el cierre dice que el gate deja
de estar duplicado, será falso —los dos listeners siguen ahí y `DevToolsDeps` también— y esta tanda
habrá producido justo lo que la petición de hoy declara como peor resultado posible. Con el
reencuadre escrito en el cierre, y la tabla de #314 corregida a las 2 escrituras que hay hoy, el
veredicto es apto sin reservas.

Lo demás que devuelvo al ingeniero es barato y no bloquea: los dos asertos que no pueden ponerse
rojos del guion 35 (hallazgo 2), el `86` copiado del guion 33 (hallazgo 3) y decidir si el fallo
ajeno se marca como «de una partida anterior» o si el cierre de #312 declara que no (hallazgo 4).

Y una cosa que sí quiero que se lea dos veces, porque va a favor: **#312 no solo estaba bien
ejercido, sino que su mitad frágil —la que protege el fail-loud— se pone roja de verdad**. Lo
comprobé quitándola: el `error` de la sesión muerta desaparece del registro y el guion lo caza. Esa
mitad era la que más fácil habría sido dar por buena leyendo el código.
