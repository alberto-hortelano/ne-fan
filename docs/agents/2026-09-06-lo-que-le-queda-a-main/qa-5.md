# QA — corte 5 de #358: el aspecto del jugador sale de `main.ts` a `renderer/aspecto-del-jugador.ts`

**Veredicto: APTO CON HALLAZGOS.** El corte es un movimiento y no un cambio: las 54 líneas de sentencia del
bloque movido en la base `95773fb0` (`setPlayerAppearance` + la precarga `baseSheetsReady` con su `catch`) son,
sin espacios ni comentarios y con el renombrado `setPlayerAppearance → vestir`, EXACTAMENTE las 54 que hay dentro
de `crearAspectoDelJugador` (`diff` de los dos conjuntos ordenados: vacío; el único cambio de forma es que la
precarga va ahora delante de `vestir` en vez de detrás, porque `vestir` la espera). En el juego, con el motor falso
y cero créditos, el jugador se viste con su prompt, el NPC pide su skin por descripción y con rol, `reRequestAllSkins`
y el menú dev leen el prompt del jugador por método, el clon sin hojas sigue volviendo al título con el remedio
escrito, y la escritura cruzada de `resetWorld` es ahora `aspecto.desvestir()` — que **ningún guion medía y ahora
mide el 82**, probado en negativo. El trinquete lleva la cifra exacta (1740), quedan 14 `let`, el módulo tiene 172
líneas, `verify`/`tsc`/`lint` verdes y no hay ningún rastro fuera del módulo. Los hallazgos **no son del corte**:
el registro de errores tapa el chip de gráficos en el banco (H6 de `qa-1`), una prosa de `ia-servicios.md` que ya
en la base situaba las reglas de skin de NPC en `main.ts`, y la mitad de la evidencia de «Nueva partida» del
ingeniero que no ejercía `desvestir()` (recargar tira el módulo) — cubierta aquí.

Worktree `/home/al/code/ne-fan-358-5-qa`, commit `2d75dd02` sobre `95773fb0`. Cero créditos en toda la verificación
(`e2e-sin-creditos` con el motor falso, que sirve `/skin_sprite_sheet` sin GPU; `gasto sesión 0,00 €` en todas las
capturas). Ningún proceso ajeno tocado: `ss -ltn` antes de empezar mostraba los bloques 0 y 100 ocupados (las
baterías del ingeniero del corte 5 y del de `porValor`); los ojos fueron al bloque 500 (`NEFAN_PORT_OFFSET=500
./start.sh --preset e2e-sin-creditos`), parado con `--parar` (`✅ stack cleaned`) ANTES de lanzar nada del runner;
la batería completa se lanzó cuando `pgrep -af qa/run.mjs` no devolvía ninguna corrida ajena y `ss -ltn` solo
mostraba 22/53/80/631/3636.

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: lo que sale de `main.ts` es lo que entra en el módulo | ✅ | `git show 95773fb0:nefan-html/src/main.ts` `:99-155` (`setPlayerAppearance`) + `:191-218` (`baseSheetsReady` y su `catch`) contra `aspecto-del-jugador.ts:76-161`, ambos sin espacios/tabuladores y sin comentarios (`sed -E 's#//.*$##; s#/\*.*\*/##g' \| tr -d ' \t'`): 54 líneas contra 54; `diff` de los dos ORDENADOS tras `s/setPlayerAppearance/vestir/` → **vacío** (`rc=0`). El `diff` sin ordenar solo muestra el bloque de la precarga desplazado delante de la función. En `main.ts`: −118/+29 líneas de código (el stat del commit: 154 líneas tocadas); los lectores cambian de nombre y no de argumentos: bucle `:1042-1046` (`hojasBaseListas()`, `modelo()`, `skinPrompt()`), `reRequestAllSkins` `:342`, `listFakeItems` `:1145`, `resetWorld` `:604` (`desvestir()`), los dos `vestir` de la entrada `:1632` y `:1654`. Imports: fuera `BASE_ANIMS` y `AVISO_PERSONAJES` (0 lectores en `main.ts`), `BASE_MODEL` se queda (retrato y menú dev, verificado: `grep -n BASE_MODEL main.ts` = 3 usos vivos) |
| El jugador con su skin (fake) | ✅ | Sonda `ojos-qa5.mjs` (scratchpad), bloque 500, partida A `alta_fantasia` con `#ts-skin` = «caballero con armadura roja y capa gris (QA5-A)» (captura `qa5-01-titulo-formulario-con-prompt.png`): libro `{"prompt":"caballero…","queued":["idle","walk","run"],"ready":["idle"],"failed":true}` sin `role`; cable: `POST /skin_sprite_sheet` `idle` y `walk` con ese prompt y `style_role` ausente; línea del juego «skin IA encolada: caballero con armadura roja y capa gris» (captura `qa5-02-A-hud-jugador-vestido.png`). `failed:true` es el `walk` → 500 del fake, esperado en el banco (el fake solo tiene `idle`) |
| Un NPC con skin por descripción | ✅ | Mismo run: `npcs()` → `{id:"barkeep", label:"Tabernero corpulento", skinPrompt:"tabernero corpulento de mandil manchado"}` y en el libro `{"prompt":"tabernero corpulento de mandil manchado","role":"commoner","ready":["idle"]}`; el POST lleva `style_role:"commoner"`. El bandido: `role:"warrior"`. Nada de esto pasa por el módulo nuevo (lo pide `carga-de-tile`/`materializar-spawn` con `npcSkinStyleRef`, core): sigue igual |
| `reRequestAllSkins` (el fusible de #236) lee el prompt del jugador | ✅ | Sonda b (`ojos-qa5b.mjs`): partida con prompt «alquimista…», cola asentada (`idle` lista, `walk` fallida); Personajes OFF→ON en el chip (estado del panel registrado en cada paso: `active → maqueta active → armed → active`) → **un POST nuevo del prompt del jugador por cada OFF→ON** (`walk`; la `idle` no se re-pide porque ya está en `readySkins`, «el arte YA PAGADO se conserva»). Dos vueltas → dos POST `walk` más; el libro conserva UNA entrada para el prompt. En la partida C (404, abajo) la `idle` no estaba pagada y el OFF→ON re-pidió `idle`: `POST P3 1 → 2`. Guiones 51 y 53 verdes en la batería |
| `listFakeItems` lee el prompt del jugador | ✅ | Partida C (el fake da 404 a la hoja del jugador): menú dev → fila **«Skin: monje de hábito pardo con capucha (QA5-C-404) (falló)»** con su botón «Generar y aplicar» (captura `qa5-07-C-menu-dev-skin-del-jugador-fallido.png`). Con la `idle` lista no sale fila (`skinStatus` = `ready` → `continue`), que es lo que vio el ingeniero («0 filas») y por eso él lo anotó sin afirmarlo; aquí se afirma con el skin en `failed` |
| «Nueva partida» tras una partida: el jugador queda sin prompt y vuelve el modelo base | ✅ (con guion nuevo) | **Por recarga** (lo que midió el ingeniero): partida B sin prompt → ningún POST sin rol, ningún libro sin rol (sonda, bloque B). Pero recargar tira el módulo: sale verde con y sin `desvestir()`. **En la misma página**, por el único camino del jugador de vuelta al título con partida detrás (el muro del mundo vacío, #189): **guion 82** `qa/guiones/82-volver-al-titulo-desviste-al-jugador.mjs` — A con prompt → `vestir` pide su skin (2 POST, sin rol) → muro → «Volver al título» → B sin prompt → **0 POST con el prompt de A desde la vuelta** y libro de B vacío. La medida es la re-petición del OFF→ON de la ENTRADA de B: `leave()` deja los personajes en el toggle local (OFF), `enter` de B los pone en ON y `applyRenderModes` llama a `reRequestAllSkins()` ANTES del `vestir` de B (el sink `mundo` va primero en el record, `session-facets.ts:181-189`). **Negativo**: sin `aspecto.desvestir();` en `resetWorld` → `2 POST con el prompt de A tras volver: [idle, walk]`, libro de B con el jugador de A, dos asertos rojos (`g82-negativo.log`). `main.ts` restaurado con `git checkout` (diff limpio). El modelo base «vuelve» por construcción: `desvestir()` no toca `playerModel` y el `vestir` de B lo decide de nuevo (`base = BASE_MODEL` salvo set completo) — igual que en la base, donde `resetWorld` tampoco tocaba `playerModel` |
| El clon sin hojas (guion 27): aviso con `motivoDeSesionParaElJugador` | ✅ | `27-el-clon-limpio-quiere-jugar` en verde en la batería (abajo). La prosa que el ingeniero tocó en `status-motivo.ts:140` y `character-sprites.ts:138` es **solo comentario**: el diff de los dos ficheros es una línea cada uno, dentro de `//`, sin tocar el `raw`/`match` ni el código de error; el guion 27 cambió 9 líneas y las 9 son cabecera y comentarios (`git show 2d75dd02 -- qa/guiones/27…`: ningún `+`/`-` fuera de `/** … */` y `//`). La sonda C (404 de la hoja del JUGADOR, no de las hojas base) es el vecino: el juego sigue (`ready:true`, `scene:true`, `Vida 100`), el registro dice UNA vez «skin IA cancelada en "idle" para "monje…" — se mantiene la base y_bot» con el `HTTP 404` en el detalle, `pageerrors 0` (captura `qa5-06`) |
| **API y deps**: fábrica con las 5 deps del plan, `Pick` honestos, sin bolsa | ✅ | `DepsDeAspectoDelJugador` `:24-39`: `characterSprites: Pick<…,"preloadBase"\|"rearmarCortacircuitos"\|"skinsAllowed"\|"requestSkin">` (usos `:77`, `:130`, `:150`, `:158`: los cuatro, ninguno sobra), `spriteRenderer: Pick<…,"loadAnimation">` (`:138`), `animacion: Pick<…,"jugadorEnReposo">` (`:148`), `worldAngle: string` (`:138`), `log` (`:142`, `:159`). Las 5 del plan, exactas. `CONFIG`, `errors`, `AVISO_PERSONAJES`, `motivoDeSesionParaElJugador`, `BASE_ANIMS`, `BASE_MODEL` entran como módulos, no como estado de `main.ts`. Construcción `main.ts:116` con los tres `const` ya construidos (`spriteRenderer:107`, `characterSprites:108`, `animacion:109`) y `log` hoisted: ningún `undefined` capturado |
| La escritura cruzada tiene nombre y el `let` ya no es visible fuera | ✅ | `desvestir()` `:165-167` con doc que dice para qué existe (`:52-55`); `main.ts:604` la llama donde estaba `playerSkinPrompt = ""`, con el comentario original. Los tres `let` `:69-71` son privados de la closure; `grep -n "playerSkinPrompt\|playerModel\|baseSheetsLoaded" main.ts` = 0 |
| Expone lo que el corte 8 necesita (`skinPrompt()`) sin exponer de más | ✅ | API `:41-64`: `vestir`, `desvestir`, `modelo()`, `skinPrompt()`, `hojasBaseListas()` — la del plan §4 fila 5, literal. `plan-8.md` §3 pide `skinPromptDelJugador(): string` = `aspecto.skinPrompt()`: está. NO expone `baseSheetsReady` (la promesa), ni setters, ni `characterSprites`: nada de más |
| ¿Algo de lo movido es lógica de core? | ✅ no | La ref de estilo del NPC (`npcSkinStyleRef`) no está en el módulo (la pide quien spawnea); la clave de caché es `skinKey` en `sprite-renderer.ts`; lo movido es una promesa de precarga, dos flags de presentación, el bucle de «¿tiene este modelo el set completo en disco?» (comprueba ficheros del cliente) y dos fail-loud de `CONFIG.graphics.*`, que es config DEL CLIENTE. La cabecera del módulo `:14-15` lo dice explícitamente. Ninguna regla de juego |
| **Cero rastros** | ✅ | `grep -rnE "playerModel\|playerSkinPrompt\|baseSheetsLoaded\|setPlayerAppearance\|baseSheetsReady"` sobre `*.ts *.mjs *.md *.json *.py *.sh *.js *.html *.css` del repo salvo `docs/agents/`, `node_modules`, `dist`, `qa/.tmp`, `qa/capturas` y el módulo nuevo: **0** (`rc=1`). Prosa que sitúe el aspecto/skin/hojas del jugador en `main.ts` (`docs/arquitectura`, `qa/README.md`, `nefan-html/src`): 0. `mapa.md:56-57` gana la línea del módulo. Lo único que nombra `main.ts` con skins es `ia-servicios.md:122` («skins del roster … las mismas reglas que main.ts»), que **ya estaba igual en la base** (`git show 95773fb0:docs/arquitectura/ia-servicios.md` = 1 coincidencia) y habla de las reglas del NPC, que salieron de `main.ts` antes de este corte — H2, no del corte |
| Trinquete: `client-file-size.json` = `wc -l` | ✅ | `"lineas": 1740` = `wc -l main.ts` → **1740**; `porque` gana UNA frase de crónica («BAJA a 1740 con el corte 5…», cinco deps, tres `let`, `desvestir()` como verbo) y no se reescribe como «raíz de composición» (es del último corte). `npm run verify` incluye `client-file-size.test.ts` y pasa; el ingeniero lo probó en negativo (cifra vieja → rojo) y lo documenta |
| 14 `let` · módulo ≤ 450 | ✅ | `grep -c '^let ' main.ts` = **14**: `devMenu`, `graphicsChip`, `mundoPintadoDe`, `dialogoDeSesion`, `scenesMode`, `charactersMode`, `input`, `attackCatalog`, `sessionCombatSystemId`, `gameClient`, `lastRenderError`, `ratonCapturadoAntesDelDialogo`, `lastTime`, `tituloEnMarcha`. `wc -l aspecto-del-jugador.ts` = **172** |
| `npm run verify` · tsc/lint del cliente | ✅ | `verify exit=0` — `tests 2178 · pass 2178 · fail 0` (18,7 s; incluye `architecture.test.ts`: el módulo nuevo entra en `cierre` y `html-solo-alcanza-core-por-el-alias`). `TSC_OK · lint exit=0` |
| Guion 27: solo prosa en sus 9 líneas | ✅ | Diff del commit: `:9` (cabecera «`aspecto.vestir` espera a las hojas base»), `:40-41` (doc de `REMEDIO`), `:52-53` (comentario «instrumentando el cliente… la precarga de las hojas base»). Ninguna sentencia. Verde en la batería |
| Los guiones de la red en verde SIN retocarlos | ✅ | Batería completa abajo (§5); ningún guion de `qa/guiones/` modificado salvo la prosa del 27 (del ingeniero) y el 82 nuevo (mío) |

## 2 · Pasada adversarial

| Situación | Resultado | Evidencia |
|---|---|---|
| Skin pedida dos veces para el mismo prompt | ✅ igual que la base, sin duplicados | Sonda b: OFF→ON ×2 → cada vuelta rearma (`rearmarCortacircuitos` olvida al fallido) y re-pide SOLO lo no pagado (`walk`; la `idle` sale de `readySkins`). Libro: **1 entrada** para el prompt del jugador tras las dos vueltas; `pageerrors 0`. `requestSkin` es idempotente por `skinKey` (`character-sprites.ts:228-252`, no movido). El mismo comportamiento se ve en el `POST P3 1 → 2` de C |
| Prompt vacío | ✅ | Partida B (sonda) y partida B del guion 82: `vestir(model, "")` no encola nada; ningún POST sin `style_role`; ninguna entrada sin rol en el libro; línea del juego sin «skin IA encolada» (captura `qa5-05-B-sin-prompt.png`) |
| El fake devuelve 404 de la hoja del jugador | ✅ | Partida C: `route("**/skin_sprite_sheet")` → 404 SOLO para el prompt del jugador. Libro `{failed:true, ready:[]}`; el juego sigue (`__nefan.ready()` = true, `Vida 100`); registro: UNA línea «skin IA cancelada en "idle" para "monje…" — se mantiene la base y_bot» + detalle `HTTP 404`; `pageerrors 0`; OFF→ON re-pide y el 404 se vuelve a decir (2 líneas para 2 caídas: ni mudo ni tormenta). El fusible de sesión no saltó por el jugador solo (1 < 3). Capturas `qa5-06`, `qa5-07` |
| Cambiar de partida a mitad de una petición de skin | ✅ por recarga · ⚠ en página no probado | Partida D con prompt: la `route` RETIENE el POST `idle` del jugador (sin contestar); con la petición en vuelo, recargar → título → partida E sin prompt → soltar la petición muerta: libro de E sin el prompt de D ni entradas sin rol, 0 POST del prompt de D tras E, `pageerrors 0` (Playwright avisa «Route is already handled»/petición abortada, absorbido). El caso EN PÁGINA (petición en vuelo + muro «Volver al título») no se probó: exigiría el bridge sin motor del guion 82 con la `route` retenida; el código dice que `vestir` ya ha puesto el prompt antes de encolar (`:147` → `:158`), así que `desvestir()` lo borra igual y la respuesta tardía solo alimenta `readySkins` del manager, que el bucle no consulta sin prompt |
| `desvestir()` dos veces | ✅ | Es el camino normal del guion 82: `leave()` → sink `mundo` → `resetWorld` → `desvestir()` (1ª); `enter` de B → el id cambia → `resetWorld` → `desvestir()` (2ª) → `vestir(B)`. Idempotente por construcción (`playerSkinPrompt = ""`), y el guion mide el resultado observable: 0 POST del prompt de A |
| Volver al título con el prompt puesto y `readySkins` con arte pagado | ✅ | Guion 82: tras la vuelta, la partida B no re-pide la `idle` de A (ya pagada) ni la `walk` (que sin `desvestir()` SÍ se re-pedía: es lo que pone rojo el negativo). El arte pagado se conserva en el manager (diseño de #236), pero sin prompt nadie lo pide ni lo pinta |

## 3 · Crítica visual

- **El cuerpo del jugador no se ve en primera persona**: `playerSprite` va en `fpsRenderer.render({… sprite})` (`main.ts:1078`) y `fps-gl.ts` solo dibuja sprites de `enemigos/npcs/objetos` (`:1436`); no hay `player.sprite` en el renderer. «Jugador vestido / desvestido» se juzga por lo que SÍ se ve: la línea del juego («skin IA encolada: …» en A y C; ausente en B), el libro y el cable. Igual que en la base.
- **`qa5-02-A-hud-jugador-vestido.png`** frente a **`ojos5-01`** del ingeniero: misma composición (spawn de `tile_0_0` del motor falso pegado a un muro ajedrezado con un vano, un barril y el camino de piedra; HUD con Vida 100 y Bandido 60; la línea del juego con «skin IA encolada: caballero…»). El motor falso pinta superficies ajedrezadas: es el clay del banco, no un defecto. **Preexistente y ajeno al corte**: el jugador nace a menos de un metro de un muro, mirando a la pared.
- **`qa5-03-A-bandido-vestido-en-cuadro.png`**: en mi partida el bandido se ve en **maniquí cian**, no con la skin `paladin` de `ojos5-03` del ingeniero. Motivo medido: la `idle` del bandido fue el 5.º POST y para entonces el fusible de sesión (#236, umbral 3: caballero, tabernero y bandido fallan `walk` porque el fake solo tiene `idle`) ya había saltado (panel «skins IA desactivados para la sesión: 3 personajes…»), así que su cola no llegó a marcar `ready`. Orden de llegada, no del corte: el ingeniero lo vio con la `idle` a tiempo. Corolario para el banco: con 3 personajes y un fake sin `walk`, **toda partida acaba en maniquí** en cuanto los tres fallan — H3 (menor, del banco).
- **Rótulo lejos de la cabeza a corta distancia**: en `qa5-03`, con el bandido a 3,5 m, «Bandido de camino» flota sobre el tejado de la casa del fondo, ~270 px por encima de la cabeza del maniquí. No es del corte (etiquetas, corte 2) y a distancia normal (`ojos5-03`) se lee bien; se anota como menor (H4).
- **El `#error-log` ocupa el tercio derecho de la pantalla durante la partida**, con trazas de pila («at http://localhost:3500/src/renderer/sprite-renderer.ts:91:23»): para quien juega es ruido y **tapa el chip de gráficos**. Es H6 de `qa-1` (preexistente) y en este corte se vuelve a pagar: el click REAL sobre los botones del panel de personajes se lo lleva el panel (`locator.click: Timeout 2000ms exceeded` en la sonda) y hay que caer al click por DOM. En la partida C, con el registro más corto, el click real entró. H1.
- **`qa5-06` / `qa5-07`**: el mensaje del 404 al jugador es legible («skin IA cancelada … — se mantiene la base y_bot») y el menú dev ofrece «Generar y aplicar» para el skin fallido: feedback correcto y accionable.
- **`qa5-01`**: el formulario «Crear personaje» con el prompt: claro, con la nota «El skin IA se genera sobre y_bot; este modelo es el que ves mientras el skin no llega o si falla». Igual que en la base.

## 4 · Hallazgos

1. **(importante, preexistente — H6 de `qa-1`, no del corte)** El panel `#error-log` tapa el chip de gráficos cuando se llena, y en el banco se llena solo (fusible de #236 + cancelaciones de `walk`). *Repro*: `e2e-sin-creditos`, partida `alta_fantasia` en modo imagen con prompt, esperar ~10 s, intentar pulsar el segmento «Personajes base» del chip: el click cae en el panel. *Esperaba*: poder conmutar los personajes IA con el registro abierto. *Destino*: issue de UI (z-index/anchura del registro o plegado por defecto), fuera de #358.
2. **(menor, preexistente, prosa)** `docs/arquitectura/ia-servicios.md:122` dice que los skins del roster siguen «las mismas reglas que main.ts»; esas reglas (`npcSkinStyleRef`, descripción como prompt) viven en `carga-de-tile.ts`/`materializar-spawn.ts` (core decide la ref) desde antes de este corte. Igual en `95773fb0`. *Destino*: el barrido de prosa del último corte de #358 (o corte 8).
3. **(menor, del banco)** Con un fake que solo sirve `idle`, tres personajes en escena (jugador + 2 NPC) hacen saltar el fusible de sesión (#236) en unos segundos y toda partida del banco acaba en maniquí; qué personaje llega a tener `idle` lista depende del orden de la cola. Hace que las capturas del banco no sean reproducibles en cuanto a «quién va vestido». *Destino*: `labs/narrative/fake-ai-server.ts` (servir `walk`/`run` de `paladin` si existen en disco, o un flag `/dev/` para el umbral). No bloquea nada.
4. **(menor, preexistente)** A corta distancia (≈ 3,5 m) el rótulo del personaje enfilado flota muy por encima de su cabeza (`qa5-03`). *Destino*: `ui/etiquetas-del-mundo.ts`, fuera de este corte.
5. **(menor, del banco, preexistente)** El guion 80 sale rojo en batería y verde suelto porque el bridge compartido
   sigue difundiendo la vida ambiental (`state_update.npcs` de `barkeep`) de la partida del guion anterior a la
   página nueva, que no tiene sesión, y el cliente lo anota como error cada segundo (§5). Dos guiones lo pagan por
   reloj (75 y 80). *Destino*: el guion 80 (filtrar la fuente `scene`/`barkeep` en su contador o aislar `fake-ai`)
   o el bridge (no difundir a un socket sin sesión), que es lo que el 50 mide a medias.
6. **(menor, preexistente, visual)** El `#error-log` no se vacía al volver al título ni al empezar otra partida: en
   la partida B del guion 82 sigue la entrada del `walk` fallido de A (captura `…-02-partida-b-sin-el-skin-de-a.png`);
   y el muro de error conserva el spinner girando bajo «La partida no pudo empezar». No es del corte.
7. **(evidencia, no defecto)** La pasada de ojos del ingeniero verificó «Nueva partida» **recargando** entre A y B: ese camino no ejerce `desvestir()` (el módulo se reinicia con la página) y saldría verde con la línea quitada. La vuelta en la misma página solo existe por el muro del mundo vacío, y por eso hacía falta un guion con bridge sin motor (el 82). El propio ingeniero lo dejó anotado en «Qué NO queda cubierto»; queda cubierto.

## 5 · Batería completa (`node qa/run.mjs`, sin retocar guiones)

Lanzada con `pgrep -af qa/run.mjs` vacío (las dos baterías ajenas habían terminado) y el bloque 500 ya parado;
el runner eligió su bloque solo. Salida literal del final (`bateria-qa5.log`):

```
✔ 81-el-spawn-vuelve-con-su-rol-y-lo-que-no-vuelve-se-dice
✔ 82-volver-al-titulo-desviste-al-jugador
80 en verde · 1 en rojo de 81 · capturas en /home/al/code/ne-fan-358-5-qa/qa/capturas/2026-09-06T18-54-32-473Z-344242
exit=1
```

Los 81 incluyen el 82 nuevo (verde también dentro de la batería, no solo suelto). **Verdes todos los de la red del
corte**: 07, 13, 15, 21, 27, 29, 41, 47, 51, 53, 69, 70, 71, 77, 78, 81. El único rojo:

- **`80-el-desplegable-room-dice-lo-que-se-ve`** — aserto «…ni deja una entrada de error — 4 → 5» (entre la foto
  de antes y la de después de elegir «-- Room --» el registro gana una entrada). **No es del corte, y no es del
  selector**: la entrada, leída en la captura final del guion (`80-…-01-fixture-rota-y-lo-que-queda.png`, tanto en
  mi batería como en la del ingeniero), es «**el bridge mueve al NPC "barkeep" y el cliente no lo tiene en escena:
  anda invisible (¿un spawn que no se rehidrató al reanudar?)**», fuente `scene`, repetida cada segundo (21:01:44,
  21:01:45 ×4…). Es la vida ambiental del tabernero de la PARTIDA DEL GUION ANTERIOR (el 79, que juega
  `alta_fantasia`) que el bridge compartido sigue difundiendo y que la página nueva del 80 —fixtures, `sinMotor`,
  sin sesión, con `zorder_test`, que no tiene `barkeep`— recibe y anota (el sujeto del guion 50, #326 c.6). Que una
  de esas entradas caiga dentro de la ventana «-- Room --» es cuestión de reloj: en `bateria-completa-qa3.log`
  (18:39, ANTES del commit) esa ventana dio «5 → 5» y el 80 salió rojo por OTRO aserto (el de #487, hoy declarado
  `DEUDA`); en `bateria-corte-4.log` (19:13) verde; en las dos baterías sobre `2d75dd02` (ingeniero y mía) «4 → 5».
  **Suelto sobre este commit** (`node qa/run.mjs 80`, dos veces): «errores 1 → 1», **verde las dos**. El guion no
  pasa por `vestir`, `desvestir` ni por ningún lector del módulo (skins OFF por el toggle local; no hay sesión), y
  el módulo nuevo no escribe en el registro salvo el `catch` de las hojas base, que aquí no dispara. Destino: el
  guion 80 debería filtrar (o el bridge no debería difundir `state_update.npcs` a un cliente sin esa sesión — es el
  hueco que el 50 mide) — H5. La batería del ingeniero tuvo un segundo rojo (75, #410, «la escena servida cambió en:
  npcs (barkeep: position)»), también de reloj (rojo en `corte-4` y `qa2`, verde aquí y en `qa3`) y por el mismo
  tabernero que pasea.

`git status` tras la batería: solo `qa/README.md` (fila del 82), `qa-5.md` y el guion 82 nuevo; `main.ts` intacto
(el negativo del 82 se restauró con `git checkout` antes de la batería).

## 6 · Workarounds usados

- **Click por DOM sobre los botones del chip** (`el.click()`) en las sondas cuando el click real no llegó por el `#error-log` encima: es exactamente H1; el jugador tiene el mismo obstáculo. La sonda registra qué vía usó en cada vuelta y el estado del panel tras cada paso, y en la partida C (registro corto) el click real entró y dio el mismo resultado.
- **Teletransporte con `setPlayerPos`/`setYaw`** para encuadrar al bandido y al tabernero (los NPC del tile del motor falso están a > 18 m del spawn). Solo para las fotos; ningún aserto depende de ello. El jugador llegaría andando.
- **`route()` sobre `/skin_sprite_sheet`** para el 404 (C) y la petición retenida (D): fallo inyectado en el BORDE, no en el cliente; es la técnica de los guiones 51/53.
- **Bridge propio sin motor por `?bridge=`** (guion 82): es la técnica del guion 20 y un override REAL del contrato de URLs; el fallo lo produce el motor de verdad al no estar. No se tocó el motor falso compartido.
- Ningún `display:none`, ningún estado sintético del módulo, ningún cambio en el código de producción salvo el negativo del guion 82 (una línea comentada y restaurada con `git checkout`; `git status` limpio en `main.ts`).

## 7 · No probado

- `CONFIG.graphics.character_sprites = false` y `ai_skin = false` (las dos ramas fail-loud de `vestir`): exigen recompilar la config del cliente; el código es el mismo que en la base (diff normalizado vacío).
- «Cambiar de partida a mitad de una petición» EN LA MISMA PÁGINA (petición retenida + muro «Volver al título»): solo la variante por recarga (§2). Razonado sobre el código, no medido.
- Un modelo alternativo con el set completo en disco (`modelId !== BASE_MODEL` con 10 hojas): el banco solo tiene `y_bot` (el guion 47 cubre que el desplegable no promete otro).
- Gasto real de créditos: cero por diseño de la verificación.

## 8 · Ficheros de esta QA

- `docs/agents/2026-09-06-lo-que-le-queda-a-main/qa-5.md` (este informe).
- `qa/guiones/82-volver-al-titulo-desviste-al-jugador.mjs` (nuevo; verde en positivo, rojo en negativo) + su fila en `qa/README.md` (tabla «Los guiones sembrados»).
- Scratchpad (no se commitea): `ojos-qa5.mjs`, `ojos-qa5b.mjs`, `ojos-qa5.log`, `ojos-qa5b.log`, `g82-positivo.log`, `g82-negativo.log`, `verify-qa5.log`, `tsc-lint-qa5.log`, `bateria-qa5.log`, capturas en `capturas-qa5/`.
