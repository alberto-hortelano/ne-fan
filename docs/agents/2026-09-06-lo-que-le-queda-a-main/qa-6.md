# QA — corte 6 de #358: la conversación sale de `main.ts` a `ui/conversacion.ts`

**Veredicto: APTO CON HALLAZGOS.** El corte es un movimiento y no un cambio: las 53 líneas de sentencia del bloque
movido en la base `4169c08f` (`const dialoguePanel`, el bloque «Dialogue callbacks» `:727-812` y los dos handlers
`onChoice`/`onFreeText` `:1229-1254`) son, sin espacios ni comentarios y con los renombrados que declara el informe
(`abrirDialogo → abrir`, `cerrarDialogo → cerrar`, `dialoguePanel → panel`, `narrativeClient.sendDialogueChoice →
deps.enviarEleccion`, `session.active → deps.session.active`, `fpsRenderer.element → deps.lienzo()`), EXACTAMENTE las
que hay dentro de `crearConversacion`; el `diff` de los dos conjuntos ordenados solo enseña el objeto que la fábrica
devuelve (`panel, abrir, cerrar, abierta`) y la firma de `abrir` en una línea con `who?: DialogueSpeaker` (misma forma
que el `{ id?: string }` anónimo de la base). En el juego, con el motor falso y cero créditos, todo lo que la
conversación promete se recorre con el teclado real: E abre con hablante, línea, tres opciones y retrato; hablando no
se anda; `1` y el texto libre de `T` llegan al motor y vuelven en la línea siguiente; el ratón se suelta al abrir y se
DEVUELVE al elegir (#323) solo si se tenía; una segunda E no pide otra conversación; Esc no toca nada; cerrar sin nada
abierto no hace nada; la negativa del navegador queda escrita con su remedio; y con el motor muerto a mitad, elegir
cierra el panel, devuelve el ratón y el fallo sale al muro con «Cerrar». El trinquete lleva la cifra exacta (1606),
quedan 11 `let`, el módulo tiene 155 líneas, `verify`/`tsc`/`lint` verdes, cero rastros. Los guiones 37/41/43 cambian
solo en prosa. **Los hallazgos no son del corte**: los dos que tocan el ratón (el flag «lo tenía» se pierde si llega
una segunda línea con el panel ya abierto; el muro de un fallo sale con el ratón CAPTURADO y sin cursor para pulsar
«Cerrar») están línea por línea en la base, y el tercero es del banco (dos árboles pueden elegir el bloque 0 a la vez).

Worktree `/home/al/code/ne-fan-358-6-qa`, commit `0096377d` sobre `4169c08f`. Cero créditos en toda la verificación
(`e2e-sin-creditos` con el motor falso; `gasto sesión 0,00 € · total 0,00 €` en todas las capturas). Ningún proceso ajeno
tocado: `ss -ltn` antes de empezar solo mostraba 22/53/80/631/3636; los ojos fueron al bloque 500
(`NEFAN_PORT_OFFSET=500 ./start.sh --preset e2e-sin-creditos`), parado con `--parar` (`✅ stack cleaned`; enumeró como
AJENO y no tocó el stack del árbol `ne-fan-358-7` que apareció en el bloque 200 a mitad). El único proceso que maté fue
MI fake-ai-server del bloque 500, por PID y tras leer `/proc/<pid>/cwd` = `/home/al/code/ne-fan-358-6-qa/nefan-core`
(bloque H de la sonda: «motor cortado a mitad»). El guion 83 y la batería se corrieron con `NEFAN_PORT_OFFSET=500`
porque el runner del árbol `358-7` ocupaba el bloque 0 (H3).

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: lo que sale de `main.ts` es lo que entra en el módulo | ✅ | `git show 4169c08f:nefan-html/src/main.ts` `:387` + `:727-812` + `:1229-1254` contra `conversacion.ts:57-155`, ambos sin comentarios ni espacios (`sed -E 's#//.*$##; s#/\*.*\*/##g' \| tr -d ' \t'`, bloques `/** */` fuera) y con los seis renombrados de arriba aplicados a la base: **53 líneas contra 55**; el `diff` ordenado solo contiene `return{ panel, abrir, cerrar, abierta:()=>panel.isVisible }` (6 líneas nuevas: la API) y la firma de `abrir` (6 líneas de la base → 1). Ninguna sentencia del cuerpo cambia. En `main.ts` el diff es −131/+25: el import de `DialoguePanel` fuera, `crearConversacion({lienzo, session, enviarEleccion})` `:390-394`, `dialogoAbierto = () => conversacion.abierta()` `:463`, los seis `dialoguePanel.isVisible` → `dialogoAbierto()` (`:686`, `:835`, `:841`, `:892`, `:895`, `:942`), el seam `dialoguePanel: conversacion.panel` `:1134`, `conversacion.abrir(...)` `:1299` y `conversacion.panel.setPortrait` `:1310`, el sink `dialogo: porValor(() => conversacion.cerrar())` `:187` |
| E abre: hablante, texto, opciones, retrato (teclado real, sin `?input=scripted`) | ✅ | Sonda `ojos-qa6.mjs` (scratchpad `qa6/`), bloque A: E mantenida 4 fotogramas → `interact_entity` → panel `{"speaker":"Tabernero corpulento","texto":"(bench 1) Te escucho, forastero…","botones":["1Seguir preguntando","2Despedirse","Tresponder otra cosa…"],"retrato":{"hijos":1,"tag":"CANVAS"},"oculto":false,"lock":false}`. Captura `qa6-A1-cursor-panel-abierto.png`: el busto y_bot del tabernero, el nombre en versalitas, la línea, las tres teclas rotuladas |
| Hablando, el jugador no anda (37) | ✅ | Sonda A: `W` 20 fotogramas con el panel abierto → **0,00 m**. Guion 37 en verde en la batería (§6) |
| Elegir con `1..N` y ver la respuesta del motor | ✅ | Sonda A: `1` → la línea siguiente «(bench 2) … Dijiste: "Seguir preguntando"» (el `chosenText` que salió de `panel.current()` vuelve). Guion 83 bloque 1 |
| Texto libre (`T` → escribir → `Enter`) — lo que el ingeniero NO pulsó | ✅ | Sonda E: `T` abre la caja (`display:block`), 40 caracteres + Esc la cierra y el panel sigue; `T` + «hola desde qa seis» + Enter → «(bench 3) … Dijiste: "hola desde qa seis"» (captura `qa6-E1-eco-del-texto-libre.png`). Guion 83 bloque 2, **probado en negativo** (§4) |
| Cronología del pointer lock (#323): captura → abrir suelta → cerrar devuelve | ✅ | Sonda B y guion 83 bloque 3, con `pointerlockchange` instalado ANTES de hablar: click en el lienzo → `true`; E → `false` (abrir suelta); `1` → **`true`** (cerrar devuelve) → `false` (la línea siguiente lo suelta otra vez). Cronología `[false,true,false]`. La última línea, cerrada con `advanceDialogue`, vuelve a capturar (`[true]`): el jugador acaba como empezó, con el ratón. `#error-log` sin ninguna devolución fallida |
| En modo cursor nadie captura | ✅ | Sonda A y guion 83 bloque 1: abrir + elegir sin lock previo → cronología **vacía** (`[]`) |
| Esc durante el diálogo | ✅ igual que la base | Sonda A (cursor) y B (lock ya soltado): Esc → panel visible, lock sin cambios. El proveedor devuelve antes de mirar Escape cuando `dialogoAbierto()` (`keyboard-input-provider.ts:22`), y el panel solo trata Escape dentro de la caja de texto libre (`dialogue-panel.ts:57-61`, la cierra y deja el panel: medido en E). Ninguna de las dos líneas es de este corte |
| E dos veces | ✅ | Sonda A y guion 83: segunda E con el typewriter corriendo (6 caracteres pintados) → texto completo de golpe, `dialogueTurn` del fake **1 → 1** (no sale otro `interact_entity`); tercera E con las opciones puestas → nada (E no es opción con `choices > 0`), turno igual, panel sigue |
| Abrir con el muro de carga puesto | ⚠️ no probado en flujo | No hay forma de tener el muro con partida (`Viajando…`/`Generando…`) y una respuesta del fake a la vez (contesta en milisegundos). Por código: el muro (`--z-loader: 70`) tapa al panel (`--z-dialogue: 50`, `game-ui.css:53-54`), ninguno de los dos módulos sabe del otro y ninguna de esas líneas cambia en el corte. El estado INVERSO —diálogo abierto y luego muro— sí se recorrió (bloque H) |
| Diálogo con cero opciones | ⚠️ no probado en flujo · ✅ el cable | El fake siempre manda dos opciones. La rama «continuar (E)» del panel es `advance()` → `onAdvanced` → `cerrar()`: es el mismo cable que `__nefan.advanceDialogue()` pulsa en cada cierre de la sonda y del guion 41 (`advanceDialogue` antes de pelear), así que `onAdvanced → cerrar` está ejercido; solo falta la tecla E del jugador sobre el botón «continuar», que es del panel (no movido) |
| Texto largo | ⚠️ no probado | El fake recorta el eco a 60 caracteres (`fake-ai-server.ts:579`): la línea más larga posible son ~110. `#dialogue-text` no tiene `max-height` ni `overflow` (`game-ui.css:221-227`): un párrafo largo crecerá hacia arriba dentro del panel (que es `bottom`-anclado). Igual en la base |
| Retrato de un NPC sin skin | ⚠️ no alcanzable con spawn · ✅ con el que falta | TODO NPC del cliente lleva `skinPrompt` (`materializar-spawn.ts:109`: `description ?? name`; los del tile, su descripción): `Mochuelo` sale con `skinPrompt:"Mochuelo"`. El único camino a `skinPrompt === undefined` en el handler `show_dialogue` es que el hablante NO esté en `mundo.npcs` y el efecto no traiga `speakerSkinPrompt`: es el guion 50 (verde en la batería). Sonda F: hablar con Nogala (runtime, sin hero pagado) → retrato `CANVAS` (el busto del sprite base), `speakerId` resuelto (captura `qa6-B1-lock-soltado-panel-abierto.png` con NOGALA) |
| **«Cambiar de partida cierra el diálogo»** | ✅ con la lectura honesta | **No hay camino en página**, medido y no solo leído: (a) `session.enter` solo se llama en `unIntentoDeArrancar` (`main.ts:1488`, `:1501`), tras `titleScreen.show()`; `session.leave()` solo en `volverAlTitulo` (`:1452`) y en el `catch` del arranque (`:1584`), con el título delante. (b) `volverAlTitulo` solo lo dispara el botón «Volver al título» del muro, que existe cuando `salida === "volver-al-titulo"`, y eso lo decide core por `mundoVacio` (`status-rotulo.ts:120`); el aviso de bridge caído pinta con la salida por defecto `"cerrar"` (`muro-de-carga.ts:119`, `:191`). Con una conversación abierta hay un NPC y por tanto tiles: `mundoVacio = false`. **Medido en el bloque H**: fallo del motor con el diálogo detrás → muro con `back.hidden = true`, `dismiss.hidden = false` (solo «Cerrar»). (c) El hook expone `sesion()` (facetas, solo lectura) y ningún `leave/enter`; el bridge no empuja `session.enter` en un resume ajeno. Lo que sujeta el cable: `FacetSinks.dialogo` obligatorio en el tipo y los 5 tests de `porValor` (41/41 mutantes, `qa-porvalor.md`) |
| **API y deps**: 3 deps mínimas, `Pick` honesto, `abierta()` bien usado, `panel` con dos lectores | ✅ (con una nota, H4) | `DepsDeConversacion` `:16-23`: `lienzo()` (uso `:112`, único), `session: Pick<ClientSession,"active">` (`:124`, `:137`; `active` es getter `readonly` en core `:141/:217`), `enviarEleccion: NarrativeClient["sendDialogueChoice"]` (`:126`, `:139`). Las tres del plan, ninguna sobra; `paso` y `DialoguePanel` entran como módulos. `main.ts` **no lee `panel.isVisible` ni una vez** (`grep isVisible main.ts` → solo `titleScreen.isVisible :901`); los seis lectores del bucle y el click pasan por `dialogoAbierto()`, que ya viajaba a input, teclas dev, etiquetas y hook. `panel` tiene exactamente dos lectores: el seam `:1134` y el retrato `:1310`. El del retrato podría ser cero con un `retrato(nodo)` que solo reenvía — el ingeniero no lo hizo y estoy de acuerdo; el del seam necesita cinco métodos y no merece cinco reenvíos. `enviarEleccion` lee `narrativeClient` (declarado en el Init) dentro de una flecha: la única forma de que fuese TDZ es una elección antes del Init, y el panel solo se abre desde eventos de `narrativeClient` |
| ¿Lógica de core en el módulo? | ✅ no | Quién habla lo resuelve el bridge (`speakerId`/`speakerSkinPrompt` en el efecto); la identidad para el retrato sigue en el handler `show_dialogue` (`main.ts:1291-1298`, raíz); lo movido es DOM (`show/hide`), un flag de presentación (el lock) y el envío verbatim de la elección con `eventId: client_<ts>` (que ya generaba el cliente en la base) |
| Cortes 7 y 8 no quedan más difíciles | ✅ | El corte 7 (`plan.md` fila 7) toma `input()`, `config`, `playerWeaponId`, `log`: nada del diálogo. El corte 8 (`plan-8.md` §4) toma `characterSprites`, `session`, `narrativeClient`, `mundo`, `skinPromptDelJugador`, `alCambiarLosModos`, `log`: nada del diálogo. Ninguno lee `conversacion` ni `dialogoAbierto`. Los 11 `let` que quedan son los que `plan-8` proyectaba para después del 6 (`≈ 1.615 · 11`): 1.606 · 11 |
| **Cero rastros** | ✅ | `grep -rnE "abrirDialogo\|cerrarDialogo\|ratonCapturadoAntesDelDialogo\|devolverElRatonTrasElDialogo\|Dialogue callbacks"` sobre `*.ts *.mjs *.md *.json *.py *.sh *.js *.html *.css` del repo salvo `node_modules`, `dist`, `qa/.tmp`, `qa/capturas`, `docs/agents/` y el módulo nuevo: **0** (`rc=1`). `dialoguePanel` fuera del módulo: `main.ts:1134` (el nombre de la dep del seam) y `dev/nefan-hook.ts` (`deps.dialoguePanel`, su propia dep): no es el `const` movido. `DialoguePanel` en `main.ts`: 0. Prosa que sitúe el diálogo en `main.ts` (`docs/arquitectura`, `qa/README.md`, `nefan-html/src`): 0 (`qa/README.md:183` habla del spawn, no del diálogo). `mapa.md:68-70` y `narrativa.md:29` nombran el módulo nuevo |
| Trinquete: `client-file-size.json` = `wc -l` | ✅ | `"lineas": 1606` = `wc -l nefan-html/src/main.ts` → **1606**; el `porque` gana UNA frase de crónica al final y NO se reescribe como «raíz de composición» (es del corte 8, correcto) |
| 11 `let` · módulo ≤ 450 | ✅ | `grep -c '^let ' main.ts` = **11** (`devMenu:135`, `graphicsChip:139`, `scenesMode:235`, `charactersMode:236`, `input:480`, `attackCatalog:497`, `sessionCombatSystemId:499`, `gameClient:562`, `lastRenderError:671`, `lastTime:774`, `tituloEnMarcha:1404`). `wc -l ui/conversacion.ts` = **155** |
| `npm run verify` · tsc/lint del cliente | ✅ | `verify exit=0` — `tests 2183 · suites 396 · pass 2183 · fail 0` (17,3 s). `TSC_OK · lint exit=0` |
| Guiones 37/41/43 tocados solo en cabeceras | ✅ | `git diff 4169c08f HEAD -- qa/guiones/{37,41,43}*` filtrado a líneas `+/-` que NO empiezan por `*`, `//` o `/**`: **vacío** en los tres. Los tres en verde en la batería |
| Los guiones de la red en verde SIN retocarlos | ✅ | Batería completa en §6; ningún guion existente modificado por QA (solo el 83 nuevo y su fila en `qa/README.md`) |

## 2 · Pasada adversarial

| Situación | Resultado | Evidencia |
|---|---|---|
| `abrir()` dos veces seguidas sin cerrar | ⚠️ preexistente (H1) | No alcanzable con el fake (cada línea nueva llega tras una elección, que cierra). Por código: el segundo `abrir` reescribe `ratonCapturadoAntesDelDialogo = document.pointerLockElement !== null`, y como el primer `show()` ya soltó el lock, queda **`false`**: al cerrar, el ratón que el jugador tenía antes de la PRIMERA línea no vuelve. Medido lo que decide: `pointerLockElement` se vacía **síncrono** tras `exitPointerLock()` (sonda B: `sigue no nulo: false`), así que ocurre incluso con dos `show_dialogue` en el mismo `narrative_event`. Idéntico en la base (`:751`) |
| `cerrar()` sin abrir | ✅ | Sonda C: `advanceDialogue` con nada abierto → `hide()` idempotente, `devolver…` sale por el flag en `false`, nada visible, lock sin cambios, 0 errores nuevos, 0 `pageerror`. Es además lo que hace el sink `dialogo` en cada `enter` (medido en `qa-porvalor.md`: `cerrarDialogo = 1` por entrada) |
| `enviarEleccion` con el motor cortado a mitad | ✅ y H2 | Sonda H: diálogo abierto (lock previo) → mato MI fake por PID → `1` → **el panel se cierra y el ratón vuelve** (`visible:false, lock:true`: `cerrar()` va antes del envío) → el bridge no alcanza el motor → `narrative_status: error, kind: consequences` → muro «El motor narrativo rechazó la respuesta / El motor narrativo no responde; inténtalo de nuevo en un momento.» con «Cerrar» (captura `qa6-H1-muro-del-fallo-con-lock.png`). El módulo no tiene rama para el fallo y no debe tenerla: la respuesta llega por el canal de status, no por la promesa (`sendDialogueChoice` devuelve `void`) |
| Pointer lock denegado por el navegador | ✅ (sintético, §3) | Sonda G: `HTMLElement.prototype.requestPointerLock` parcheado a `Promise.reject(DOMException)` con el lock previo puesto → `1` → `#error-log`: «**input** · no se pudo devolver el ratón al cerrar la conversación: haz click en el mundo para volver a atacar · QA: denegado» (captura `qa6-G1-lock-denegado-registro.png`); el jugador queda en cursor con la línea siguiente abierta, 0 `pageerror`. El `paso()` con `"input"` y el remedio viajan tal cual desde la base |
| Retrato de un NPC sin skin | ✅ (fila de §1) | Nogala (runtime, sin hero) → `CANVAS`; el hablante ausente lo cubre el 50 |
| El bridge se corta (no el motor) | ⚠️ no reproducido | `context.setOffline(true)` de Playwright NO cierra el WebSocket ya abierto (el muro de bridge caído no apareció; solo fallaron las imágenes de sprites en vuelo). Cortar el bridge exigiría matar mi propio bridge, y lo que probaría es `bridge-client.send` sin socket (`errors.push("bridge", "se perdió el mensaje 'dialogue_choice'…")`, `bridge-client.ts:222-235`), que no es del corte: el módulo llama a `enviarEleccion` DESPUÉS de `cerrar()`, así que el panel y el ratón quedan igual que en H |

## 3 · Workarounds usados y veredicto

- **`setPlayerPos` para plantarse al lado del NPC** (teletransporte de bench, el mismo de 37/41/43): no afecta al jugador,
  que llega andando. Hablar, elegir y escribir van por el teclado real.
- **`__nefan.advanceDialogue()` para cerrar la última línea de cada bloque**: es la tecla E sobre «continuar» (mismo
  `advance()` del panel); el jugador con dos opciones tendría que elegir una, y eso también se midió con `1`.
- **`R` para revivir**: el bandido del turno 2 del fake mata al jugador plantado junto al tabernero durante los ~9 turnos
  de la sonda; el guion 83 lo prevé igual. Es el juego, no un obstáculo de la feature.
- **Prototipo de `requestPointerLock` parcheado (bloque G)**: estado FORZADO para ver la rama que el navegador de un
  jugador puede tomar (lock pedido demasiado pronto tras soltarlo, o sin gesto). Se declara como sintético; no afirma
  nada del flujo normal, solo que el canal fail-loud existe y dice el remedio.
- **Matar mi propio fake por PID (bloque H)**: el «motor cortado a mitad» del encargo. Verificado `/proc/<pid>/cwd`
  antes; el stack quedó degradado y se paró entero con `--parar` antes de la batería.
- **`NEFAN_PORT_OFFSET=500` al runner** para el 83 y la batería: no es un workaround de la feature sino del banco (H3).

## 4 · Guion nuevo: `qa/guiones/83-la-conversacion-suelta-y-devuelve-el-raton.mjs` (+ fila en `qa/README.md`)

Mide lo mecánico que ningún guion medía y que es exactamente la frontera del módulo: cronología del lock por
`pointerlockchange` (#323), modo cursor sin capturas, texto libre con eco, E dos veces = un turno del fake. Sin
`?input=scripted`, como 37 y 43. `aisla: saves, fake-ai`.

- **Positivo** (`NEFAN_PORT_OFFSET=500 node qa/run.mjs 83`): `1 en verde · 0 en rojo de 1`; cronología `[false,true,false]`,
  eco «guion ochenta y tres», turno `1 → 1`, registro «— sin errores —».
- **Negativo** (dos sabotajes en `conversacion.ts`: `if (!ratonCapturadoAntesDelDialogo) return;` → `return;` y en
  `onFreeText` `chosenText: ""` sin `freeText`): **3 asertos rojos** — «lo escrito llega al motor» (eco `Dijiste: ""`),
  la cronología `[false]` y el cierre final `[]`. Restaurado con `git checkout nefan-html/src/ui/conversacion.ts`;
  `git status` limpio salvo el guion y el README.
- Un falso rojo de la primera versión del guion, dicho para que nadie lo persiga: el `pointerlockchange` del click llega
  DESPUÉS de que `pointerLockElement` ya lo enseñe, así que vaciar la cronología justo tras el `waitFor` del click dejaba
  colarse su `true`. El guion espera ahora a que ese evento esté anotado antes de vaciar (mismo tropiezo que documentó el
  ingeniero en su sonda).
- Primera corrida sin `NEFAN_PORT_OFFSET`: roja por H3 (mi página hablaba con el bridge del árbol `358-7`, que había
  ganado el bloque 0 en la misma ventana; el registro del cliente lo decía: «evento de otra partida descartado»).

## 5 · Hallazgos (ninguno del corte; todos con destino)

**H1 · menor · preexistente (base `:751`) — el flag «tenía el ratón» es por `abrir`, no por conversación.** Si con una
línea abierta llega otro `show_dialogue` (dos consequences `dialogue` en un mismo evento, o una línea programada por el
motor mientras el jugador lee), el segundo `abrir` lee `pointerLockElement === null` (el primer `show()` ya lo soltó,
y se vacía síncrono: medido) y pisa el flag con `false`: al cerrar, el ratón no vuelve y el jugador está otra vez en el
caso de #323 (pega sin hacer daño). No reproducible con el fake (siempre responde a una elección, que cierra antes). Y
la cara opuesta del mismo diseño: `cerrar()` pide el lock y la línea siguiente llega en ~5 ms; si el motor contestara
antes de que el navegador CONCEDA el lock, el segundo `show()` no tendría nada que soltar y la concesión llegaría con
el panel abierto (sin cursor para clicar; las teclas siguen). Observado siempre en el orden bueno (`[false,true,false]`
en todas las pasadas); con el motor real, a segundos, no puede pasar. Repro (real, con el motor): hablar con el lock
puesto, y que el motor emita dos `dialogue` en la misma respuesta → tras cerrar, sin ratón. Destino: issue sobre
`ui/conversacion.ts` (apuntar el lock al pasar de «sin conversación» a «con conversación», no en cada `abrir`), no este
corte.

**H2 · menor · preexistente (el muro, corte 1) — un muro con botón puede salir con el ratón CAPTURADO.** Bloque H:
elegir con el motor muerto → `cerrar()` devuelve el lock (bien) → acto seguido el fallo pinta el muro con «Cerrar» y
el jugador no tiene cursor para pulsarlo (`lock:true`, captura `qa6-H1-…`). Esc lo suelta (el proveedor no está gateado
sin diálogo) y «Cerrar» funciona, pero nada lo dice. Aplica a cualquier `muro.fallo`/`mostrar` con el lock puesto (un
tile que falla al generarse mientras se camina, la salida por «Salidas» no, que se pulsa con cursor). Ni `mostrar` ni
`fallo` de `muro-de-carga.ts` tocan el pointer lock (`grep exitPointerLock` → solo el proveedor y el panel). Repro:
partida, click en el mundo, hablar, matar el motor, pulsar `1`. Destino: issue sobre `ui/muro-de-carga.ts` (soltar el
lock al pintar un muro con botones, como hace el panel). De paso, el muro dice «rechazó la respuesta» en el título y
«no responde» en el detalle (`status-rotulo.ts:163` + `status-motivo.ts:47`): dos diagnósticos distintos en el mismo
cartel; cosmético, core.

**H3 · menor · banco — la reserva de bloque de `qa/run.mjs` es por árbol, no por máquina.** `reservarBloque` escribe
el lock en `qa/.tmp/.bloques/` del PROPIO worktree (`run.mjs:144-145`), así que dos runners de dos árboles ven libre el
bloque 0 en la misma ventana, los dos lo cogen y `start.sh` no mata a nadie: el segundo bridge no arranca pero el
runner sigue, y la página del segundo habla con el bridge del primero. Medido hoy: mi primera corrida del 83 (árbol
`358-6-qa`) contra el runner del árbol `358-7` → «la partida … no llegó a existir en 180 s», con el registro del cliente
lleno de «status/evento de otra partida descartado» de sesiones que no eran mías. `dos-corridas.mjs` lo prueba dentro
de UN árbol, que es donde el lock funciona. Destino: issue del banco (lock en un directorio por máquina, p. ej.
`/tmp/nefan-bloques/`, o incluir el bloque en el `port_owner` del launcher).

**H4 · menor · diseño, opcional — `panel` expone `show/hide` a quien tenga `conversacion.panel`.** `Conversacion.panel`
es el `DialoguePanel` entero: un `hide()` desde el seam del banco cerraría el panel SIN devolver el ratón, que es el
desemparejamiento exacto que #311 vino a impedir. Hoy los dos lectores son honestos (seam: `current/finishTypewriter/
chooseByIndex/advance/isVisible`; retrato: `setPortrait`) y en la base el `const` estaba igual de expuesto, así que no
es una regresión. Un `Pick<DialoguePanel, …>` de esos seis en `Conversacion.panel` (y en `deps.dialoguePanel` del hook)
haría el estado malo inexpresable a coste cero. Destino: el corte 7 u 8 si se quiere, o nada.

## 6 · Batería completa

`NEFAN_PORT_OFFSET=500 node qa/run.mjs` sobre el árbol del commit + el guion 83 (sin ningún otro proceso mío arriba;
`pgrep -af qa/run.mjs` solo devolvía el runner AJENO del árbol `358-7` en el bloque 0, que no se tocó):

```
81 en verde · 1 en rojo de 82 · capturas en qa/capturas/2026-09-06T20-09-32-718Z-427754
exit=1
```

El rojo es `80-el-desplegable-room-dice-lo-que-se-ve` (el selector de fixtures, corte 3), en su bloque 3 —«la opción vacía
no deja una entrada de error — 4 → 5»—, que el ingeniero ya declara intermitente en las baterías largas de los cortes 1, 4
y 5. No toca el diálogo. Repetido SOLO en el mismo bloque (`NEFAN_PORT_OFFSET=500 node qa/run.mjs 80`): **`1 en verde · 0
en rojo de 1`**. Los que ejercen lo movido, todos en verde dentro de la batería: 37, 41, 43, 50 (los cuatro de la red del
diálogo), 49/57/81 (el diálogo a mitad del resume), 10/61/79 (etiquetas y mirilla con `dialogoAbierto`), 42, y el **83**
nuevo. Puertos del bloque 500 después: ninguno (`ss -ltn`: solo 22/53/80/631/3636 y el bloque 0 del árbol `358-7`, ajeno).
`git status` al terminar: solo `qa/README.md` (fila del 83), el guion 83 y este informe; `conversacion.ts` restaurado tras
el negativo (§4).

## 7 · Crítica visual (director de arte y jugador)

- **El panel** (`qa6-A1`, `qa6-B1`, comparado con `c6/ojos6-01` del ingeniero): idéntico píxel a píxel en composición —
  retrato 96×96 con el busto y_bot encuadrado al pecho, nombre en versalitas ámbar, la línea sobre un filete, tres
  botones a ancho completo con la tecla en su caja. Una luz (el sol bajo del tile), escala coherente con la barra de
  acciones y el panel de salidas. Nada tapa nada: el panel se asienta sobre la barra de ataques sin pisarla.
- **El retrato de un NPC de runtime** (Nogala, `qa6-B1`): mismo busto azul que el tabernero — sin hero pagado todos los
  personajes son el mismo y_bot, y el retrato lo hace evidente. No es del corte, y en el banco es lo esperado (skins en
  «vector»).
- **El estado del ratón** no se ve en la captura (headless no pinta cursor); se juzga por la cronología, que es la
  medida honesta. En la pantalla del jugador: con lock, la mirilla; con el panel, el cursor sobre los botones. Nada nuevo.
- **El muro del fallo con el diálogo cerrado detrás** (`qa6-H1`): el mundo velado, el anillo estático rojo (es el diseño
  del `.error`, `game-ui.css:330`), título y detalle legibles, un solo botón. Lo que el jugador no ve es que no tiene
  cursor (H2).
- **Fricción**: tras hablar, el ratón vuelve solo (#323 cumple); la caja de texto libre dice qué hacer («Escribe tu
  respuesta y pulsa Enter…»); Esc dentro de la caja la cierra sin perder el panel. Un jugador que pulsa E dos veces
  por impaciencia no rompe nada: la segunda le completa el texto. Coste en créditos: 0,00 € en todo el recorrido, y
  nada de lo movido llama a nada que cobre.

## 8 · No probado y por qué

- Abrir con el muro puesto, cero opciones y texto largo: sin camino con el motor falso (arriba, por fila). Cubiertos por
  lectura de código no tocado por el corte y, el de cero opciones, por el cable `advance → cerrar` que sí se pulsa.
- «Cambiar de partida cierra el diálogo» en flujo: sin camino en página, con la evidencia medida del bloque H (solo
  «Cerrar») y la lectura de los tres llamantes. Lo sujetan el tipo y `porValor`.
- El bridge caído (no el motor) con el diálogo abierto: `setOffline` no lo corta; no maté mi bridge porque lo que
  quedaría por ver no es del módulo.
- Un navegador que niega el lock de verdad: solo sintético (G). El canal existe y dice el remedio.
