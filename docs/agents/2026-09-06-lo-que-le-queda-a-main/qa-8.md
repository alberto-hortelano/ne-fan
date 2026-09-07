# QA — corte 8 y ÚLTIMO de #358: los modos de gráficos salen de `main.ts` a `ui/modos-de-graficos.ts`

**Veredicto: APTO CON HALLAZGOS.** El corte es un movimiento y no un cambio: las 82 sentencias del bloque en la base
`86bc0559` (`let scenesMode/charactersMode` `:231-232`, los tres gates, `applyRenderModes`, `reRequestAllSkins`,
`requestModeChange` `:237-336`, las dos claves y el arranque sin sesión `:511-522`, el cuerpo del handler
`render_mode_changed` `:949-955` y la construcción del chip `:1025-1033`), normalizadas sin comentarios y con los
renombrados que declara el informe, son las que hay dentro de `crearModosDeGraficos`: el diff de los dos conjuntos
ordenados solo enseña (a) `devPanel.setSession({renderMode}); devMenu?.refresh()` → `deps.alCambiarLosModos(scenesMode)`
(la desviación declarada: la raíz reparte a sus observadores), (b) las dos ternarias «con la faceta sustituida», que
estaban escritas DOS veces (`:332-335` y `:951-954`), ahora una en `aplicarFaceta`, (c) las firmas plegadas en una
línea y el objeto que devuelve la fábrica. Cero lógica nueva; 7 deps, las de la opción A del plan, cada una un `Pick`
de 1-4 miembros, un getter o un callback — ningún objeto de contexto. **El criterio de cierre de #358 se cumple
medido**: `main.ts` **1.417 líneas** (≤ 1.550) y **5 `let`** (≤ 6), la excepción de `client-file-size.json`
reescrita entera como raíz de composición con la cifra EXACTA (trinquete probado en rojo con 1416) e `issue: null`.
En el juego, con cero créditos y stack propio (`NEFAN_PORT_OFFSET=700`, presets `e2e-sin-creditos` y `html-fixtures`),
todo lo que el bloque promete se recorre desde el título: chip oculto con el título y visible en partida; Personajes
OFF→ON desde el chip con sesión = UN `set_render_mode`, rearme y 4 POST de skins al motor falso; ON→OFF, Escenarios
ON→OFF y OFF→ON con sus líneas «Gráficos: …»; reanudar devuelve al chip los modos del save; sin sesión el toggle
local OFF hace que `robledo_tile` (5 NPC descritos) pida **cero** skins, y los toggles se persisten como
`nefan.autoimg`/`nefan.aichar` y sobreviven a la recarga. **El riesgo de `plan-8.md` §9 tiene ahora candado**: el
guion nuevo **85** cuenta los frames del socket del juego y afirma que el eco `render_mode_changed` —propio o de OTRO
cliente de la partida— se aplica en local sin volver a pedir; probado en negativo con la fusión que §9 temía (rojo con
tres `set_render_mode` y dos `ok:false`) y con el handler ignorando el eco (rojo por expiración). `verify` 2.183/0,
tsc/lint/build verdes, cero rastros, red de guiones y batería sin retocar ninguno (§4). **Los hallazgos no son del
corte** salvo una imprecisión de una palabra en el `porque`: el registro de errores desplegado tapa el panel del chip
(medido: el click no llega), el chip dice «Skins IA» con el fusible saltado, y cada cambio desde el chip escribe la
misma línea dos veces en el registro del jugador.

Worktree `/home/al/code/ne-fan-358-8-qa`, HEAD desprendido `1087c6e6` (corte 8 rebasado sobre `main` `86bc0559`).
Stack propio: `ss -ltn` antes → solo 22/53/80/631/3636; `pgrep -af qa/run.mjs` sin batería ajena;
`NEFAN_PORT_OFFSET=700 NEFAN_GAMES_DIR=<scratchpad>/qa8/games NEFAN_SAVES_DIR=… NEFAN_LOG_DIR=… ./start.sh --preset
e2e-sin-creditos` → fake-ai `:19465`, bridge `:10577` (State API `:10578`), cliente `:3700`; después
`NEFAN_PORT_OFFSET=700 ./start.sh --preset html-fixtures` → `:3700`. Cada uno parado con `NEFAN_PORT_OFFSET=700
./start.sh --parar` → `✅ stack cleaned` y `ss -ltn` de vuelta a 22/53/80/631/3636 ANTES del siguiente paso. Sondas
propias en `qa/.tmp/ojos-e2e-qa8.mjs` y `qa/.tmp/ojos-fixtures-qa8.mjs` (gitignored; salidas en
`<scratchpad>/qa8/ojos-*.log`, capturas en `<scratchpad>/qa8/capturas/`).

## 1 · Criterios de aceptación (de `requisitos.md` «Aceptación reencuadrada» + «Tras el corte 4» + el encargo)

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: cero lógica nueva | ✅ cumple | Diff normalizado de sentencias (comentarios fuera, renombrados `scenesGenerationOn→escenariosGeneran`, `effectiveCharactersMode→modoEfectivoDePersonajes`, `charactersGenerationOn→personajesGeneran`, `applyRenderModes→aplicar`, `reRequestAllSkins→rePedirTodosLosSkins`, `requestModeChange→cambiarFaceta`, `characterSprites/session/narrativeClient/mundo → deps.*`, `aspecto.skinPrompt()→deps.skinPromptDelJugador()`, `log→deps.log`, `graphicsChip?.refresh()→chip.refresh()`): 82 sentencias en la base, 81 en el módulo; solo difieren el callback `alCambiarLosModos`, la extracción de `aplicarFaceta` (dos copias → una), el `return {…}` y firmas plegadas. `git diff 86bc0559 1087c6e6 -- main.ts`: −157/+36 |
| Mismas 7 deps del plan, `Pick`s y callbacks, nunca objeto de contexto | ✅ cumple | `DepsDeModosDeGraficos` (`modos-de-graficos.ts:34-54`): `characterSprites: Pick<…,4>`, `session: Pick<…,"active"\|"id">`, `narrativeClient: Pick<…,"setRenderMode">`, `mundo: Pick<…,"personajes">`, `skinPromptDelJugador()`, `alCambiarLosModos(renderMode)`, `log`. `CONFIG` y `errors` importados. Cableado en `main.ts:814-825` con `() => aspecto.skinPrompt()` (getter de un `const`) |
| Módulo ≤ 450 | ✅ cumple | `wc -l ui/modos-de-graficos.ts` → **209** |
| **Cierre de #358**: `main.ts` ≤ 1.550 líneas y ≤ 6 `let` | ✅ cumple | `wc -l` → **1417**; `grep -c '^let '` → **5** (`input :350`, `gameClient :391`, `lastRenderError :500`, `lastTime :578`, `tituloEnMarcha :1215`). Holgura: 133 líneas, 1 `let` |
| `client-file-size.json`: cifra exacta, `porque` de §6, `issue: null`; se pone ROJO al cambiarla | ✅ cumple (con H4 menor) | `"lineas": 1417` = `wc -l`; `porque` = texto de §6 con N=1417 dos veces; `issue: null`. Negativo: `1417→1416` → `node --import tsx --test test/client-file-size.test.ts`: `✖ la cifra de cada excepción es EXACTAMENTE el tamaño de hoy · pass 6 fail 1`; restaurado → `pass 7 fail 0`. Verdad del texto: «de 3.079» es la cifra del cuerpo del issue (`requisitos.md`); «el bucle (34), el arranque (19), los eventos del motor (20)» están en `critica.md:30-32` en negrita; «T3 §4.2, 2026-09-01» existe (`2026-09-01-el-cliente-deja-de-crecer/qa.md:252`). El «8 colaboradores» del menú dev NO es de la crítica (que midió «10-11 cada mitad», `critica.md:29`) sino de `plan-8.md` §2-3 → H4 |
| Cero rastros fuera de `docs/agents/` y del módulo | ✅ cumple | `grep -rnE 'applyRenderModes\|requestModeChange\|scenesGenerationOn\|charactersGenerationOn\|effectiveCharactersMode\|reRequestAllSkins\|AUTOIMG_KEY\|AICHAR_KEY\|graphicsChip'` sobre `*.ts *.mjs *.md *.json *.py *.sh *.js *.html *.css *.cjs` sin `node_modules/dist/qa/.tmp/qa/capturas/docs/agents/` y sin el módulo → **0 líneas, rc=1**. En `main.ts` `GraphicsModeChip\|scenesMode\|charactersMode` → 0. Prosa reapuntada leída en el diff: `graphics-mode.ts:116,213`, `hud-de-combate.ts:53`, `narrative-client.ts:277` (el caller es el chip, correcto), `qa/README.md:185,212`, cabeceras de 51/53/82 (solo prosa; ni un aserto), `mapa.md:72-74`. Ninguna referencia a líneas de `main.ts` muertas para este bloque (`qa/guiones/58:54` cita `main.ts:603`, ajena al corte) |
| **Chip**: oculto con el título, visible en partida y en fixtures | ✅ cumple | Sonda e2e: título → `{"hidden":true}`; partida → `{"hidden":false,"text":"🎨/🧱 Mixto"}`; de vuelta al título → `hidden:true`. Sonda fixtures: tras `#ts-close` → `{"hidden":false,"text":"🧱 Maqueta 3D"}`. Capturas `e2e-01/02`, `fix-02` |
| Personajes OFF→ON con sesión: registro, rearme y re-petición de skins (POST al motor falso) | ✅ cumple | Sonda e2e (clicks REALES del ratón, dos clicks con «¿Confirmar? Gastará créditos»): `POST nuevos tras OFF→ON: 4 · idle/walk × tabernero, bandido`; libro `[{tabernero, ready:1},{bandido, ready:1}]`; registro «Gráficos: imagen IA (skins IA)»; chip «🎨 Imagen IA». Guion 85 bloque 1: 4 POST, `set_render_mode=1 · ok=1 ko=0 · ecos=1` |
| ON→OFF (personajes y escenarios) y OFF→ON escenarios: registro | ✅ cumple | «Gráficos: imagen IA (personajes en base y_bot)»; «Gráficos: maqueta 3D (clay local, sin imagen IA nueva; personajes en base y_bot)»; escenarios OFF→ON pide confirmación y no re-pinta el tile ya pintado (0 POST); chip «Maqueta 3D» → «Mixto». Captura `e2e-05` |
| `localStorage` conserva `nefan.autoimg`/`nefan.aichar`; con sesión no se escribe | ✅ cumple | Con sesión: `{"autoimg":null,"aichar":null}` tras cuatro cambios. Sin sesión: personajes ON → `{"aichar":"1","claves":["nefan.aichar"]}`; escenarios ON → `autoimg:"1"`; OFF → `autoimg:"0"`; tras recargar el chip nace «Mixto» con `personajes: Skins IA` y la fixture pide 5 skins nada más cargar |
| Arranque sin sesión con toggle OFF pide 0 skins | ✅ cumple | Sonda fixtures: `robledo_tile` con `npcs: 5 · con skinPrompt: 5` → `skins=0 posts=0`. `node qa/fixtures-sin-bridge.mjs` (bloque 700): `✔ html-fixtures pinta sin backend · frames 8 → 98 · billboards 6 · exit=0` |
| Gate del atlas por modo (59/60) y reanudar | ✅ cumple | `node qa/run.mjs 85` + batería (§4: 59 y 60 en verde). Sonda e2e: reanudar → chip «Mixto», `renderMode:"image" characterMode:"vector"` del save, registro «Gráficos: imagen IA (personajes en base y_bot)» |
| **Riesgo §9**: el eco NO vuelve a pedir; el chip pide una vez | ✅ cumple y CANDADO | Guion **85** nuevo (§4): `set_render_mode=1` tras el chip y tras dos ecos ajenos; `ok:false=0`; sin `graphics-mode` en `#error-log`. Negativos en rojo |
| `npm run verify`; tsc/lint/build | ✅ cumple | `ℹ tests 2183 · pass 2183 · fail 0 · verify exit=0`; `TSC_OK · lint exit=0 · ✓ built in 1.44s · build exit=0` |
| Guiones de la red en verde sin retocarlos; batería completa | ✅ cumple | §4. `git status`: solo `qa/README.md` (fila 85) y el guion 85 |
| Estados: título, partida, diálogo, overlays (history [H], error-log, muro), fixtures vs sesión, sin bridge | ✅ medido (H1, H3 en §2) | Título/partida/fixtures/sin bridge arriba. Con [H] abierto el panel del chip se queda ABIERTO debajo del velo y el chip sigue visible (captura `e2e-06`); el `#error-log` va por encima de todo. Diálogo: no toca el chip (no probado con el panel abierto, §5) |

## 2 · Hallazgos

**H1 · menor (pre-existente, layout de `game-ui.css`; destino: #506 —UI— o issue nuevo) — el registro de errores
desplegado tapa el panel del chip y el ratón no llega a sus botones.** Medido en fixtures sin bridge tras Personajes
ON (5 fetch fallan alto): `alcance del cursor al botón Escenarios→IA: {"loGolpea":false,"golpea":"error-log__detail",
"boton":[608,649],"errorLog":[34,725]}` — el `#error-log` ocupa de y=34 a y=725 y el botón está debajo. Playwright se
niega a clicar «a través» (mismo obstáculo que declaró el ingeniero); un jugador tampoco puede hasta plegar el registro.
Reproducción: `html-fixtures`, cerrar el muro, `#ts-close`, Room → `robledo_tile`, chip → Personajes → Skins IA (dos
clicks) → intentar Escenarios. Con 2 entradas (partida del banco) el panel sí se alcanza (`loGolpea:true`, captura
`e2e-04`). No es del corte: el CSS no cambia. **Workaround de la sonda** por esto: los clicks de Escenarios en fixtures
van por `element.click()`.

**H2 · menor (pre-existente; candidato a issue de UI/semántica del fusible) — el chip dice «Skins IA» cuando el
cortacircuitos de sesión los ha apagado, y el fusible habla de «sesión» sin sesión.** Fixtures: `title: "personajes:
Skins IA"` con `#error-log: "skins IA desactivados para la sesión: 3 personajes distintos han fallado… (umbral 3)"`.
`charsOn` lee `skinsAllowed && ai_skin` y el fusible de #236 no toca `skinsAllowed` (semántica que el guion 51 canda:
el fusible se rearma por el chip). El mensaje «para la sesión» en modo fixtures es prosa de `character-sprites.ts`, no
del corte. Movido verbatim.

**H3 · menor (pre-existente por construcción: los tres llamantes de `aplicar` son los mismos tres que tenía
`applyRenderModes` en la base `:169,:332,:951`) — cada cambio desde el chip con sesión escribe la MISMA línea
«Gráficos: …» dos veces en el registro del jugador.** Captura `e2e-04`: «Gráficos: imagen IA (skins IA)» ×2 tras UN
click; la sonda lee `["Gráficos: imagen IA (skins IA)","Gráficos: imagen IA (skins IA)"]`. Mecanismo:
`cambiarFaceta` → `aplicarFaceta` → `aplicar` (línea 1) y el eco `render_mode_changed` del propio pedido —que el
bridge difunde también al requester («re-aplicarlo es idempotente», `handlers/session.ts:777`)— → `aplicarFaceta` →
`aplicar` (línea 2). Idempotente en estado, no en el registro. Observado también al ENTRAR en partida nueva (dos
líneas antes de tocar el chip; una sola al reanudar), sin diagnosticar de dónde sale la segunda. UX: un jugador lee
un registro de 8 líneas y le cuesta dos por cada gesto. Destino: junto a H1/H2 en UI, o `aplicar` deja de loguear
cuando los modos no cambian (sería un cambio de comportamiento, fuera del corte).

**H4 · menor (DEL CORTE, prosa del `porque` en `client-file-size.json`) — «el menú dev, que es un inventario sobre
todo lo demás (8 colaboradores)» va dentro de la frase «lo que la crítica de #358 midió», y la crítica midió otra cosa.**
`critica.md:29` dice del bloque «Modos + menú dev … 10-11 cada mitad»; el **8** lo midió `plan-8.md` (§2-3, con
`grafo.cjs` sobre `95773fb0`). Un lector futuro que vaya a la crítica a buscar el 8 no lo encuentra. Una palabra lo
arregla («…y el menú dev, que el plan del corte 8 midió como inventario…»). No afecta a la cifra ni al candado.

**Anotado por el ingeniero, verificado y compartido (no nuevo):** los tres gates de gasto y la normalización
`"vector"|"image"|""` son POLÍTICA de cuándo el cliente gasta imagen, hoy en un fichero sin harness ni mutación
(#241), y el bridge conoce la misma regla para persistir (`render-mode.ts`): candidata a función pura en core. Los
toggles de `localStorage` sin sesión son una «partida» que solo conoce el navegador (legacy declarado). El movimiento
los aísla en 30 líneas; no reubica, como pedía el encargo.

## 3 · Adversarial

| Situación | Resultado |
|---|---|
| El eco propio del bridge (`render_mode_changed` al requester) vuelve a pedir | Guion 85 bloque 1: `set_render_mode=1` tras el eco cerrado por dos `input` más. Con la fusión (`aplicarFaceta → void cambiarFaceta`): **3** pedidos, **2** `ok:false` «la partida ya tiene los personajes en modo image», `graphics-mode` en `#error-log` → rojo |
| Eco de OTRO cliente de la misma partida (el caso para el que existe `aplicarFaceta`) | Bloques 2 y 3 del 85: segundo socket desde node pide personajes→maqueta y escenarios→maqueta; la página aplica (chip «Personajes base» / «Maqueta 3D», «Gráficos: maqueta 3D…») sin un solo pedido. Con el handler en `return`: expira «el chip pasa a Personajes base» → rojo |
| TDZ de `graficos` (`const` del Init leído por cierres de `:161` y `:196`) | Ningún camino: los sinks solo corren en `enter`/`leave` (siempre después del Init); `generationOn` solo cuando el atlas trabaja (primer tile: fixtures o sesión, ambos después de evaluar el módulo). `fixtures-sin-bridge` y la sonda de fixtures pasan por el arranque sin sesión con el bootstrap fallido: sin `pageerror` |
| Chip con sesión pero el mundo aún no llegó | El bridge falla «el mundo todavía no ha llegado…» → el chip lo captura y se relee (camino de la base, `graphics-mode.ts:208-216`). No reproducido aquí (el motor falso contesta antes de que se pueda clicar) |
| Personajes ON con `graphics.ai_skin=false` | Aviso fail-loud movido verbatim (`modos-de-graficos.ts:128-133`); sin camino en el banco (`ai_skin: true` en `runtime_config.json`). No probado |
| Overlay [H] con el panel abierto | El panel se queda abierto bajo el velo del historial y el chip visible (captura `e2e-06`); nada se rompe, es layering pre-existente |
| `render_mode_changed` de OTRA sesión | `session.esMio` lo descarta (una línea, sin cambio respecto a la base). No medido |

## 4 · Guion nuevo, negativos y batería

**Guion nuevo** `qa/guiones/85-el-eco-del-bridge-no-vuelve-a-pedir-el-modo.mjs` (+ fila en `qa/README.md`, formato
de las 83/84). Envuelve `WebSocket` con `addInitScript` ANTES de recargar y lleva en la página un libro con los
`set_render_mode` que salen, los `render_mode_set`/`render_mode_changed` que entran y los `input` por frame como
testigo de orden (`request()` envía síncrono: esperar dos `input` más tras el eco cierra por estado el hueco en que
un re-pedido habría salido). Partida real (`charMode: "vector"`), chip Personajes OFF→ON con dos clicks, un segundo
cliente desde node (`WebSocket` global, molde de `borrarSaveComoOtroCliente`) pide personajes→maqueta y
escenarios→maqueta. `aisla: ["saves"]`, cero créditos. `node qa/run.mjs 85`:
```
▶ 85-el-eco-del-bridge-no-vuelve-a-pedir-el-modo
    tras el chip: set_render_mode=1 · render_mode_set ok=1 ko=0 · ecos=1
    ✔ el chip mandó EXACTAMENTE un set_render_mode (characters → image)
    ✔ el bridge lo aceptó una vez y no rechazó nada: el eco NO se re-pidió
    POST /skin_sprite_sheet: 4 · [idle/walk × tabernero, bandido]
    chip tras el eco ajeno: {"text":"🎨/🧱 Mixto","title":"… personajes: Personajes base …"}
    ✔ el eco ajeno NO produjo ningún set_render_mode: el libro sigue con el único del chip
    registro: Gráficos: maqueta 3D (clay local, sin imagen IA nueva; personajes en base y_bot)
    ✔ tampoco este eco pidió nada: un solo set_render_mode en toda la partida
    ✔ el registro de errores no tiene ninguna entrada de graphics-mode (ningún «ya en ese modo»)
✔ 85-el-eco-del-bridge-no-vuelve-a-pedir-el-modo
1 en verde · 0 en rojo de 1 · capturas en …/qa/capturas/2026-09-07T09-33-13-541Z-32909
```
**En negativo** (un sabotaje por vez, `tsc` verde, restaurado con `git checkout --`; `grep -c NEGATIVO` → 0 después):
- `modos-de-graficos.ts`: `aplicarFaceta` → `void cambiarFaceta(facet, mode).catch(…errors.push…)` (la fusión de §9) →
  `tras el chip: set_render_mode=3 · ok=1 ko=2`, seis asertos rojos («la partida ya tiene los personajes en modo image»
  ×2, «…en modo vector», «…los escenarios en modo vector», `graphics-mode` en el registro) → `0 en verde · 1 en rojo`.
- `main.ts:833`: el handler hace `return` → bloque 1 verde (el chip sí aplica por `cambiarFaceta`) y
  `✘ ERROR: timeout esperando: el chip pasa a «Personajes base» por el eco del otro cliente (último valor: null)` →
  `0 en verde · 1 en rojo`.

**Batería completa** (`node qa/run.mjs` entero sobre `1087c6e6` + el guion 85 y su fila; los dos stacks del 700 ya
parados; `puertos antes: 22 53 80 631 3636`; `pgrep -af qa/run.mjs` sin batería ajena; el runner tomó su bloque):

```
✔ 01-… … ✔ 84-el-aro-y-las-teclas-son-los-del-catalogo-de-la-sesion
✔ 85-el-eco-del-bridge-no-vuelve-a-pedir-el-modo
84 en verde · 0 en rojo de 84 · capturas en /home/al/code/ne-fan-358-8-qa/qa/capturas/2026-09-07T09-41-36-267Z-39477
exit=0
```
Los 84 en verde a la primera, **incluidos el 75 y el 80**, que en la batería del ingeniero salieron con la firma de
#496/#467 y aquí no hubo que repetir sueltos (se dice para que nadie los busque: la intermitencia sigue documentada
en `qa-2.md:117`, `qa-5.md:114` y su issue; una corrida verde no la cierra). Los cinco de la red del corte (15, 51, 53,
59, 60), el 82 (rearme al entrar en la partida siguiente) y el 85 nuevo dentro. Puertos del catálogo después: ninguno
(solo 22/53/80/631/3636). No se retocó ningún guion existente.

## 5 · Workarounds y no probado

- **Workarounds (declarados)**: `closeTitle` del hook para cerrar el título en fixtures (= click en `#ts-close`, el
  camino del jugador); `raf=timer` en la URL (pump del banco en headless); en la sonda de fixtures los clicks de
  Escenarios van por `element.click()` porque el `#error-log` tapa el panel — **eso es H1**, no un paso de la receta;
  en el guion 85 `WebSocket` se envuelve para OBSERVAR (no altera ningún frame) y el segundo cliente es el escenario
  real de «otro cliente de la partida», no un estado sintético. Sin `display:none`, sin estado forzado.
- **No probado**: el aviso `graphics.ai_skin=false` (sin camino en el banco); el rechazo del bridge «el mundo todavía
  no ha llegado» desde el chip (el motor falso es más rápido que el click); el chip con el DIÁLOGO abierto;
  `render_mode_changed` de otra sesión; el gasto REAL de créditos (todo contra el motor falso: 0,00 €). La segunda
  línea «Gráficos» al entrar en partida nueva (H3) se observó y no se diagnosticó.
- Sin bridge la captura headless del lienzo sale negra (`fix-02/03`) aunque `fixtures-sin-bridge` mide 8 → 98 frames y
  6 billboards: no es del corte y el candado mide frames, no píxeles (lo dijo también el ingeniero).

## 6 · Nota del coordinador al incorporar el informe (2026-09-07)

H4 (la palabra de la excepción) corregido en la rama por el coordinador: «que el plan del corte 8 midió como inventario…».
H1 → **#509**, H2/H3 → **#510**, la política de gasto → **#508**; el guion 85 cierra **#493**. La batería del coordinador
sobre la rama con el 85 y el arreglo de H4 va en la PR.
