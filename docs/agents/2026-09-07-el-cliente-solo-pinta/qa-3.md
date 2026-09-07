# QA — PR 3 de #241: la política del atlas y el fusible de skins salen del cliente a core

**Veredicto: APTO.** Es un movimiento y no un cambio: las cuatro piezas de estado del controller del atlas
(`pendingTiles`, `queuedTiles`, `token`, `inFlight`) y las tres del fusible (`UMBRAL_APAGADO_DE_SESION`,
`skinsDisabled`, `personajesFallidos`) están hoy en `nefan-core/src/scene/politica-de-atlas.ts` y
`nefan-core/src/session/fusible-de-skins.ts` con las MISMAS transiciones, cero imports (ni `node:*`, ni DOM, ni
`fetch`, ni reloj) y 100 % de cobertura de líneas y ramas. Lo único que no estaba escrito así en la base —`finDeRun(token)`
y los getters `caidos`/`umbral`— es la extracción literal del `finally` y de las dos lecturas que el cliente hacía del
Set y de la constante: ninguno decide nada nuevo. **Los dos guiones que el commit toca no cambian ni un byte
ejecutable**: quitando comentarios, el 51 y el 60 son idénticos a los de `76beb948` (135/135 y 372/372 líneas de
código). La regla `text` nueva se pone roja de verdad —reproducido su nacimiento con 23 violaciones y también hoy,
reinsertando un token en `fps-atlas.ts`— y su `why` cuenta qué era cada nombre, dónde vive ahora y por qué volvería.
Los dos módulos entran en `mutation-targets.json` con `break: "sin medir"` y motivo honesto; quitando uno, `npm test`
cae con «sin dueño». Maté a mano cuatro mutantes (dos por módulo) y los 18 tests los cazan. En el juego real, con
stack propio (`NEFAN_PORT_OFFSET=700`) y cero créditos: una partida con Imagen IA pide el atlas del tile **una vez**
(1 POST, 23 celdas, `textured=["tile_0_0"]`), el fusible salta al **tercer** personaje distinto con 5xx y lo anuncia
**una** vez, y tres personajes con 404 **no** apagan la sesión. Guion nuevo **88** (verde, probado en negativo dos
veces). La batería salió `84 en verde · 1 en rojo de 85` y `85 en verde · 0 en rojo de 85` en la segunda: el único rojo es el
guion **80**, con la firma de intermitencia ya documentada de **#496** (mismo código, rojo y verde; verde suelto y
verde también sobre la base) — §4 y H6.
**El hallazgo que importa no es de esta PR**: con el
aviso del apagón en pantalla, el registro de errores tapa el chip de gráficos Y su panel entero, así que el jugador
no puede volver a encender los skins ni rearmar el fusible por el camino del jugador (#483, pre-existente y medido
aquí con cifras). De la PR solo queda un rastro de prosa menor: la cabecera del guion 53 sigue diciendo que el umbral
lo declara `nefan-html/src/renderer/character-sprites.ts`.

Worktree `/home/al/code/ne-fan-241-3-qa`, HEAD desprendido `1424252c` sobre `main` `76beb948`. Stack propio:
`ss -ltn` antes → solo 22/53/80/631/3636; `NEFAN_PORT_OFFSET=700 ./start.sh --preset e2e-sin-creditos` → fake-ai
`:19465`, bridge `:10577` (State API `:10578`), cliente `:3700`; parado con `NEFAN_PORT_OFFSET=700 ./start.sh
--parar` → `✅ stack cleaned` enumerando y respetando los stacks ajenos de los bloques 0, 300, 500 y 600. Ningún
`pkill`, ningún `kill` por puerto, ningún uso del Playwright MCP compartido: ojos con sondas propias en `qa/.tmp/`
(`playwright-core` de `qa/node_modules`, `qa/lib/navegador.mjs`). Los guiones y la batería con `qa/run.mjs`, que
eligió su propio bloque (+300 libre en ese momento).

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: las 4 piezas del atlas, mismas transiciones | ✅ cumple | Diff base→core, línea a línea: `if (this.pendingTiles.has(key)) { queuedTiles.add(key); return; } pendingTiles.add(key)` → `pedir(key)` (`politica-de-atlas.ts:39-45`, mismo orden y mismo Set); `pendingTiles.delete(key); if (queuedTiles.delete(key))` → `terminar(key)` (`:52-54`, primero pendientes, después encoladas); `const token = ++this.token; this.inFlight = true` → `nuevoRun()` (`:60-62`); `if (token !== this.token) return` → `if (!this.politica.vigente(token)) return` (los dos sitios: `fps-atlas.ts:181,207`); `finally { if (token === this.token) this.inFlight = false }` → `finDeRun(token)` (`:75-76`, llamado en `fps-atlas.ts:234`). `get running` → `politica.enVuelo` (`fps-atlas.ts:74`). Cero ramas nuevas |
| **Es un movimiento**: las 3 piezas del fusible | ✅ cumple | `const backendDown = status === undefined \|\| status >= 500; if (!backendDown) return;` → `fallo()` devuelve `"ignorar"` (`fusible-de-skins.ts:41-42`); `personajesFallidos.add(m)` sigue ANTES del check (`:43`); `if (skinsDisabled \|\| size < UMBRAL) return` → `"cuenta"` (`:44`); `skinsDisabled = true` → `"apagar"` (`:45-46`); `rearmar()` limpia flag Y Set (`:71-73`), y el bucle que borra los `failed` del mapa se queda en el cliente (`character-sprites.ts:182-184`). Los tres gates del cliente pasan a preguntar: `:209` (`requestSkin`), `:253` (`enqueueAnim`), `:276` (el `catch`). El texto del aviso y `errors.push` siguen en el cliente (`:279-280`), como pedía el encargo |
| Cero lógica nueva | ✅ cumple | Lo añadido: `finDeRun(token)` (el cuerpo del `finally`, que la firma del plan no podía expresar), y los getters `caidos`/`umbral`, que sustituyen las dos lecturas directas (`personajesFallidos.size`, la constante) que el cliente hacía para escribir el aviso — y que la regla `text` ya le prohíbe. Ninguno decide nada |
| Módulos puros: sin `node:*`, sin DOM, sin fetch | ✅ cumple | `grep -nE '^import\|require\(\|node:\|document\.\|window\.\|fetch\(\|localStorage\|performance\.'` sobre los dos ficheros → **cero líneas**: no tienen ni un import. Van en `src/scene/` y `src/session/`, dentro del perímetro `core-puro-sin-node`; `npm test` (que corre `cierre` y el perímetro) verde |
| Cobertura de los dos módulos | ✅ cumple | `npm run coverage`: `politica-de-atlas.ts 100.00 \| 100.00 \| 100.00`; `fusible-de-skins.ts 100.00 \| 100.00 \| 100.00` |
| **Regla `la-logica-de-juego-no-vuelve-al-cliente` nace ROJA** | ✅ cumple, reproducido | Revertidos los dos ficheros del cliente a `76beb948` y corrido `test/architecture.test.ts`: `✖ [error] la-logica-de-juego-no-vuelve-al-cliente` con 20 violaciones listadas + `… y 3 más` = **23**, 15 en `character-sprites.ts` (99, 157, 162, 167, 207, 208, 230, 274, 300, 301×3, 302, 305, 306) y 8 en `fps-atlas.ts` (63, 66, 86, 94, 95, 98, 113, 117). Coincide con `implementacion-3.md` §3. Ficheros restaurados; `git status` limpio |
| …y se pone ROJA con un token reintroducido hoy | ✅ cumple | Añadido `private pendingTiles = new Set<string>();` a `fps-atlas.ts:63` → `✖ … nefan-html/src/scene/fps-atlas.ts:63 — patrón prohibido: "pendingTiles"`, precedido del `why` completo (que nombra los dos Set, el incidente de $0.15×2, #390, #236 y dónde vive hoy cada pieza) y del `Repara el import/patrón, o añade una excepción CON MOTIVO`. Restaurado; `git status` limpio |
| Regla verde sobre el árbol de hoy y sin falsos positivos | ✅ cumple | `grep -rnE 'pendingTiles\|queuedTiles\|UMBRAL_APAGADO_DE_SESION\|skinsDisabled\|personajesFallidos' nefan-html/src \| wc -l` → **0**. El caso negativo sintético de `architecture.test.ts:957-1010` afirma además que el cliente PREGUNTANDO a core (`this.politica.pedir(key)`, `this.fusible.apagado`) y el módulo de core que declara la constante NO infringen |
| **Mutación**: dos entradas `break: "sin medir"` con `porque` honesto | ✅ cumple | `mutation-targets.json`: `politica-de-atlas` (`src/scene/politica-de-atlas.ts` · `test/politica-de-atlas.test.ts`) y `fusible-de-skins` (`src/session/fusible-de-skins.ts` · `test/fusible-de-skins.test.ts`), los dos con `break: "sin medir"`. Los `porque` nombran los mutantes que importan por su efecto ($0.15×2, #390, el radio de antes de #236, el 500 exacto, contar fallos en vez de personajes) y dicen por qué no hay número: `permisoLocal` rechaza el coste desconocido |
| `npm run deuda` los lista | ✅ cumple | `⚠️ sin medir 2 de 45 módulos (2 ficheros sin dato): npm run mutacion -- pendiente (sin medida previa) · … (sin medida previa)`; `npm run mutacion -- pendiente` → `Se medirían 16 de 45 módulos · 1992 mutantes medidos antes + 2 módulo(s) sin base: politica-de-atlas, fusible-de-skins`. `npm run mutacion -- local politica-de-atlas` → `NO se mide aquí: no hay medida previa …` (rechazo esperado) |
| Sin una entrada, `npm test` cae «sin dueño» | ✅ cumple | Quitado el módulo `fusible-de-skins` del JSON (45→44) → `✖ cada fichero del perímetro puro tiene dueño… AssertionError: sin dueño en data/contract/mutation-targets.json: src/session/fusible-de-skins.ts` (`ℹ fail 1`). Devuelta; `git status` limpio |
| Mutantes a mano: 2 por módulo, los tests caen | ✅ cumple | `terminar` nunca devuelve `"re-disparar"` → **3 fallos**; `#pendientes.has(key)` → `.size > 0` (la clave DISTINTA se encola = el `if (inFlight)` de #390) → **1 fallo**; `UMBRAL_APAGADO_DE_SESION 3→4` → **4 fallos**; `>= 500` → `> 500` → **5 fallos**. Los cuatro ficheros restaurados; `git status` limpio |
| **Rastros**: los cinco tokens a cero fuera de core y `docs/agents/` | ✅ cumple | Ver arriba (grep = 0). El grep amplio del encargo deja vivos: `inFlight` en `main.ts:854,875` y `ui/dev-menu.ts:17,40,105,131,141` —el nombre del CAMPO del panel dev y del hook de bench, no estado de política: `inFlight: fpsAtlasController.running` es una lectura del getter de core—; `cortacircuitos` en la prosa del cliente y en el método público `rearmarCortacircuitos()`, que sigue siendo del manager; `UMBRAL`/`pendingTiles`/`inFlight` en las cabeceras de `qa/guiones/*` y `qa/README.md`, que es crónica. **Excepción: H2** |
| **Flujo real**: partida con Escenarios ON → el atlas del tile se pide UNA vez | ✅ cumple | Sonda propia sobre el stack 700, partida `alta_fantasia` con Imagen IA + Skins IA: `partida {"sessionId":"1788779753-618e7c","scene":"tile_0_0"} · sesion {…"renderMode":"image","characterMode":"image","styleId":"acuarela_luminosa"}`; `activeTile=tile_0_0 · textured=["tile_0_0"]`; `POST /generate_surface_atlas = 1: [{"layout_key":"d9ef94cd…","celdas":23}]`. El guion 88 lo repite en la batería |
| Cambiar de tile en vuelo: la clave nueva supera al run y el tile del jugador NO se descarta (#390) | ✅ cumple | Guion **60** en verde sin retocar (batería, §4): `✔ A4 · cruzar a un tile mientras otro run está en vuelo no lo deja en clay (textured ∋ tile pisado)` y `✔ Maqueta 3D / Imagen IA · el RENDERER tiene texturado el tile donde está el jugador (textured ∋ activeTile)`. Y el candado sigue VIVO tras el movimiento: con `pedir` saboteado en core, el 60 se pone rojo — `A3 · POST del tile tile_0_0 tras reanudar + re-difusión: 3 · celdas 69 · repetidas 23` → `✘ A3 · la misma clave disparada dos veces en el mismo tick se pide UNA vez` |
| Reanudar pinta el tile del jugador (guion 60) | ✅ cumple | Guion 60 en verde en la batería, sin retocar |
| **Fusible**: salta al tercer personaje distinto | ✅ cumple | Sonda propia (500 para las 3 primeras descripciones de `robledo_tile`): `skins: [alcaldesa failed:true, herrero failed:true, posadera failed:true, guardia failed:false, molinero failed:false]` → `✔ exactamente 3 personajes marcados failed`. Guion 88 bloque C en la batería |
| …el aviso al jugador sale UNA vez | ✅ cumple | `aviso: skins IA desactivados para la sesión: 3 personajes distintos han fallado con error de backend (umbral 3). Los personajes usan la base y_bot. Último motivo: ai_server /skin_sprite_sheet HTTP 500: …` → `✔ el apagón se anuncia UNA sola vez · apagones=1`. Captura `qa/capturas/qa-pr3-ojos/10-apagon-del-fusible.png` y `88-C-la-sesion-se-apaga.png` |
| …y el chip lo rearma (OFF→ON) | ⚠️ **no probado por el camino del jugador** (H1) | Con el aviso en pantalla el click NO llega al chip: `alcance del chip con el apagón en pantalla: {"golpea":"DIV.error-log__msg","chipY":762,"registroAlto":746,"entradas":6}`, y el PANEL que se abre queda también entero bajo el registro (`botones: [{fila:"Escenarios…",golpea:"DIV.error-log__msg"},{fila:"Personajes…",golpea:"PRE.error-log__detail"}]`). Con el registro oculto por CSS —**workaround declarado, §3**— el rearme SÍ funciona: `POST /skin_sprite_sheet: 3 → 6 (3 tras el rearme)`, `apagones tras rearmar: 2` (los tres saboteados vuelven a caer y el fusible, que arrancó de cero, vuelve a apagar: es la conducta correcta) |
| Guiones verdes sin retocar ninguno; batería completa | ✅ cumple (con H6) | §4: dos corridas completas; el único rojo (guion 80) es intermitente y se demuestra con el mismo código en verde y sobre la base. `git status` al cerrar: solo `qa/README.md` (fila del 88), `qa/guiones/88-…mjs` y este informe |
| `npm run verify` / `crap` / cliente | ✅ cumple | `npm test`: `ℹ tests 2203 · suites 401 · pass 2203 · fail 0` (exit 0). `npm run crap -- --check`: `1266 funciones medidas · cobertura de líneas 89.1% · complejidad máxima 46 · Tope (no empeorar): CRAP ≤ 73 — 0 por encima · ✔ dentro de los umbrales`. Cliente: `TSC_OK`, `eslint .` sin salida, `✓ built in 1.59s` |
| Líneas del cliente | ✅ cumple | `find nefan-html/src -name '*.ts' \| xargs wc -l` → **14 427**; sobre `76beb948` → **14 466**. −39, como declara el informe (el plan estimaba −40) |

## 2 · Veredicto sobre los dos guiones tocados

**Limpio.** El commit toca `qa/guiones/51-…` (+9/−6) y `qa/guiones/60-…` (+5/−3), y las 23 líneas están **todas dentro
de bloques `/** … */`**. Comprobado mecánicamente, no a ojo: quitando comentarios de bloque y de línea y espacios,
las dos versiones (`76beb948` y `1424252c`) son **idénticas carácter a carácter** —`codigo identico: true`, 135 y 135
líneas para el 51; 372 y 372 para el 60—. Ni un aserto, ni una espera, ni un selector, ni un valor esperado: el
`const UMBRAL = 3;` del 51 sigue siendo 3 y solo cambia el comentario que dice dónde vive esa constante. Los cambios
son honestos y necesarios: la frase «POR QUÉ ESTE GUION Y NO UN TEST — `nefan-html` no tiene suite» dejó de ser
cierta el día que la regla se movió, y el 51 la reescribe como «POR QUÉ ESTE GUION ADEMÁS DEL TEST», que es lo que
es. No hay retoque para pasar.

## 3 · Hallazgos

### H1 · IMPORTANTE (pre-existente, #483) — el aviso del apagón tapa el único mando para deshacerlo

Cuando el fusible salta, el jugador lee «skins IA desactivados para la sesión… Los personajes usan la base y_bot», y
el mando que los vuelve a encender —y que rearma el fusible— es el chip de gráficos. **Ese aviso lo tapa.**

- **Reproducción desde el arranque**: `NEFAN_PORT_OFFSET=700 ./start.sh --preset e2e-sin-creditos` → abrir
  `http://localhost:3700/?ai=…&offset=700` → cerrar el título → chip de gráficos → Personajes «🎨 Skins IA» (armar +
  confirmar) → selector «Room» → `robledo_tile` → con tres personajes cuyo skin devuelve 5xx, esperar el apagón.
- **Medido**: `#error-log` es `position:fixed; top:34px; right:12px; width:320px; max-height:calc(100vh - 54px);
  z-index:8900` (`ui/dev-ui.css:111-126`). Con 6 entradas llega a su tope (746 px en un viewport de 800; 666 en uno
  de 720), o sea que su borde inferior se queda a 20 px del fondo, y el chip (26 px de alto) empieza a 38 px del
  fondo: se solapan 18 de sus 26 px, el centro incluido. Solo los ~8 px inferiores del chip quedan libres —barrido
  punto a punto: `dy 2,6,10,14 → DIV.error-log__msg`; `dy 18,22 → BUTTON#gfx-chip`—, y **si el jugador acierta en esa
  rendija, el panel que se abre queda entero debajo**: sus dos botones («Escenarios», «Personajes») los intercepta
  `#error-log`. Es estructural, no del tamaño de ventana: el registro siempre crece hasta 54 px del fondo y el chip
  vive a 38 (medido igual con viewport de 720 y de 800).
- **Qué esperaba el jugador**: que el aviso que le dice que algo se apagó no le quite el interruptor. Salidas que le
  quedan hoy: recargar la pestaña o volver al título y reanudar.
- **Destino**: #483 (capas del HUD). No es de esta PR —el comportamiento es idéntico al de `76beb948`—, pero sí es la
  razón por la que el guion 88 no puede medir «el fusible rearmado cuenta desde cero» por el camino del jugador, y
  por la que el bloque 4 del guion 51 solo funciona mientras el registro sea corto. El ingeniero lo declara en
  `implementacion-3.md` §6.1; aquí queda con cifras, con el dato nuevo de que **el panel también está tapado**, y con
  captura (`qa/capturas/qa-pr3-ojos/06-panel-bajo-el-registro.png`, `…/2026-09-07T11-38-07-901Z-146514/88-…-04-88-D-el-chip-tapado-por-el-aviso.png`).

### H2 · MENOR (de esta PR) — rastro de prosa: el guion 53 sigue apuntando al cliente

`qa/guiones/53-el-umbral-de-skins-se-mide-en-el-rango.mjs:57` dice, sobre su `const UMBRAL = 3`:

> `/** El valor que declara `nefan-html/src/renderer/character-sprites.ts`. …`

Ya no lo declara: lo declara `nefan-core/src/session/fusible-de-skins.ts`. El ingeniero barrió esa misma frase en el
51 y la fila del 53 en `qa/README.md` (que es crónica y sigue valiendo), pero no la cabecera del propio 53 — que es
justamente el guion que cita el fichero como fuente de verdad de la constante. En la misma línea, `qa/guiones/59-…:11`
dice todavía «romper sin que `npm test` se entere (`nefan-html` no tiene tests)» sobre la conducta de `fps-atlas.ts`,
de la que hoy una parte SÍ la ve `npm test` (la fila del README del 59 sí se corrigió, la cabecera no). Es una línea
de comentario en cada sitio; el arreglo es del mismo tipo que los dos que la PR ya hizo. **Destino: esta PR.**

### H3 · MENOR (pre-existente) — tras el apagón, los saltados no vuelven al rearmar

Confirmo lo que declara `implementacion-3.md` §6.2. Medido en la sonda con el workaround del registro: tras rearmar,
las tres víctimas vuelven a pedirse y a caer, pero los sanos que quedaron con sus anims encoladas-y-saltadas siguen
en `ready: []` (`skins tras rearmar: guardia ready:[] failed:false · molinero ready:[] failed:false`). La cadena los
saltó por `fusible.apagado`, `rearmarCortacircuitos` solo olvida los `failed` y `requestSkin` sale antes para un
estado existente no fallido. Conducta idéntica a la de antes de la PR (`if (state.failed || this.skinsDisabled)
return;`). Es del manager del cliente, no del fusible. **Destino: issue propio** (junto a H1, es lo que hace que
«rearmar» prometa más de lo que da).

### H4 · MENOR (pre-existente) — el registro del jugador enseña stack traces con rutas del bundler

En las capturas del apagón, cada entrada arrastra su `detail`: `Error: ai_server /skin_sprite_sheet HTTP 500: {…}
at http://localhost:3300/src/renderer/sprite-renderer.ts:91:23 / at async …/character-sprites.ts:160:23`. Cuatro
líneas de jerga por fallo, en el panel que ve quien juega, y son las que hinchan el registro hasta provocar H1. No lo
trae esta PR (el `errors.push(source, msg, err)` es el de siempre). **Destino: #483 o issue propio de UX del registro.**

### H5 · MENOR (pre-existente, no investigado) — 404 de `/cache/surface/{hash}`

`implementacion-3.md` §6.3 los reporta; los vi también en mi pasada. No los he investigado: no tocan este cambio
(URLs y fetch intactos) y el guion 59 pasa. **Destino: triaje.**

### H6 · MENOR (pre-existente y YA documentado, #496) — el guion 80 es intermitente detrás del 79

`80-…:148` (`…ni deja una entrada de error`) mide un delta del contador de errores en una ventana de un frame, y el
guion no declara `aisla`: hereda el registro de la partida del 79 y cualquier entrada tardía que aterrice en esa
ventana lo pone rojo. Demostrado intermitente con el MISMO código (§4): rojo en la batería y en la primera de tres
corridas de `79 80`, verde en las otras dos y en solitario; verde también sobre la base. **Es la misma firma que ya
anotaron las QA anteriores**: «el rojo del 80 en la batería es la intermitencia con causa raíz en **#496** (el bridge
del guion anterior difunde a una página sin sesión), verde suelto» (`2026-09-06-lo-que-le-queda-a-main/qa-7.md:171`,
y `qa-8.md:154`). **Destino: #496**, ya abierto. No es un veredicto sobre esta PR.

## 4 · Batería

`node qa/run.mjs` completa, sin retocar ningún guion (el 88 es nuevo, no un retoque). **Primera corrida:**

```
84 en verde · 1 en rojo de 85 · capturas en /home/al/code/ne-fan-241-3-qa/qa/capturas/2026-09-07T11-45-07-033Z-161241
```

**Segunda corrida:**

```
85 en verde · 0 en rojo de 85 · capturas en /home/al/code/ne-fan-241-3-qa/qa/capturas/2026-09-07T11-55-40-873Z-179177
```

El único rojo de la primera fue `80-el-desplegable-room-dice-lo-que-se-ve`, en un aserto suyo: `✘ …ni deja una
entrada de error — 4 → 5`. **Repetido suelto y anotado (H6): es intermitencia del guion, no de la PR.**

| Corrida | Código | Resultado |
|---|---|---|
| batería completa | PR | `✘ 4 → 5` |
| `node qa/run.mjs 80` (solo) | PR | `✔ …ni deja una entrada de error` (`errores 1 → 1`), `1 en verde · 0 en rojo de 1` |
| `node qa/run.mjs 79 80` #1 | PR | `✘ 4 → 5` — reproducido con su predecesor alfabético |
| `node qa/run.mjs 79 80` #2 y #3 | PR | `✔` las dos (`errores 5 → 5`), `2 en verde · 0 en rojo de 2` |
| `node qa/run.mjs 79 80` | **base `76beb948`** (los dos ficheros del cliente revertidos) | `✔` (`errores 5 → 5`) |

El aserto (`80-…:142-148`) fotografía el contador de errores, hace `selectOption("#room-selector","")`, espera UN
frame y exige que el contador no se haya movido. El guion no declara `aisla`, así que hereda el registro del 79 —una
partida real— y cualquier entrada pendiente que aterrice en esa ventana lo pone rojo: en la corrida roja el registro
llegó con **4** entradas en vez de las 5 con las que llega normalmente, y la quinta entró durante la medida. Con el
MISMO código sale rojo y verde, así que no es un veredicto sobre el cambio — y es **la firma ya documentada de
#496**, que las QA de los cortes 7 y 8 anotaron con estas mismas palabras (H6).

`node qa/run.mjs 88` (el guion nuevo, en solitario): `1 en verde · 0 en rojo de 1`.
`node qa/run.mjs 60` con `pedir` saboteado en core: `0 en verde · 1 en rojo de 1` — el candado de la deduplicación
sigue vivo después del movimiento.
`node qa/fixtures-sin-bridge.mjs`: `✔ html-fixtures pinta sin backend · capturas en qa/capturas/` (exit 0).

## 5 · El guion nuevo — `qa/guiones/88-el-atlas-y-el-fusible-no-pagan-dos-veces.mjs`

Cuatro bloques, `aisla: ["saves", "fake-ai"]`, cero créditos, todo por el camino del jugador (partida desde el
título, modos por el chip con armar + confirmar, escenas por el selector «Room», fallos inyectados en el BORDE con
`page.route`; ni un `waitForTimeout`, ni un estado forzado):

| Bloque | Qué afirma | Salida real |
|---|---|---|
| **A** | En una partida normal con Imagen IA el atlas del tile sale por UNA petición, se APLICA (el renderer lo da por texturado ⇒ el token del run seguía vigente) y ninguna `layout_key` se repite | `POST /generate_surface_atlas: 1 · [{"layout_key":"d9ef94cd…","celdas":23}]` · `✔ el juego SÍ pide el atlas del tile` · `✔ y lo paga UNA vez` |
| **B** | Tres personajes distintos en **404** NO apagan la sesión, y los sanos se visten | `✔ ocurre: con 3 personajes en 404 los SANOS siguen vistiéndose` · `libro: [alcaldesa failed:true ready:0, herrero failed:true ready:0, posadera failed:true ready:0, guardia failed:false ready:3, molinero failed:false ready:3]` · `✔ 3 personajes distintos en 404 NO apagan los skins de la sesión` |
| **C** | Los mismos tres en **5xx** apagan y lo dicen UNA vez | `✔ ocurre: con 3 personajes en 5xx el juego apaga los skins de la sesión y lo dice` · `✔ …y lo dice UNA sola vez` |
| **D** | Con el apagón en pantalla, ¿llega el click al chip? Se mide y se declara con `⚠ HALLAZGO`, sin poner rojo (molde del 81 con #489: es pre-existente) | `alcance del chip: {"golpea":"DIV.error-log__msg","chipY":762,"registroAlto":746,"entradas":6}` → `⚠ HALLAZGO (#483 …)` |

**Probado en negativo**, un sabotaje por vez sobre `nefan-core/src` y restaurado byte a byte (`git status` limpio
después de cada uno):

| Sabotaje | Resultado |
|---|---|
| `politica-de-atlas.ts`: `vigente(token)` → `return false` (el run nunca aplica su atlas) | **Bloque A ROJO**: `✘ ocurre: el atlas del tile de entrada termina y el renderer lo da por texturado — no ocurrió en 120000 ms · 790 sondeo(s), 0 con la sonda rota` — con el POST ya hecho y pagado |
| `fusible-de-skins.ts`: `backendDown = true` siempre (el 4xx cuenta) | **Bloque B ROJO, dos asertos**: `✘ ocurre: con 3 personajes en 404 los SANOS siguen vistiéndose` (los cinco acaban `ready:0`) y `✘ 3 personajes distintos en 404 NO apagan los skins de la sesión — apagones=1 · … Último motivo: … HTTP 404` |
| `politica-de-atlas.ts`: `pedir` sin la guarda (devuelve siempre `"arranca"`) | **Bloque A NO se pone rojo** — y está escrito en la cabecera del guion. En el arranque normal el disparo temprano sale por «sin estilo de la sesión» y termina ANTES del retro-trigger, así que no hay solape que deduplicar. Ese mutante lo mata el **60** (A3): `3 POST · celdas 69 · repetidas 23` |

Fila añadida a `qa/README.md` (tabla «Los guiones sembrados»), con lo que el bloque A **no** es y por qué, para que
nadie lo lea como el candado de la deduplicación.

## 6 · Workarounds usados

| Workaround | Dónde | Veredicto |
|---|---|---|
| `page.addStyleTag("#error-log{display:none!important}")` para poder pulsar el chip y medir el rearme | Solo en mi sonda de ojos (`qa/.tmp/qa-fusible-pr3.mjs`), **nunca** en el guion 88 | **Es H1**, no un paso de la receta. Se usó para separar dos preguntas: «¿funciona el rearme?» (sí: 3 POST nuevos y el fusible vuelve a contar desde cero) y «¿puede el jugador llegar a él?» (no). El guion lo declara con `⚠ HALLAZGO` en vez de forzarlo |
| Reescribir `anim` a `idle` en el borde para las peticiones de skin de los personajes sanos | Guion 88 | No afecta al jugador: es una carencia del BANCO (el motor falso solo tiene la hoja `idle`), y el 53 la tapa con un 404 que este guion no puede usar porque el 404 es justo lo que mide. Declarado en la cabecera |
| `__nefan.closeTitle()` + selector «Room» para llegar a cinco vecinos | Guion 88 (bloques B-D) y sondas | No es workaround: es la puerta del preset `html-fixtures` y el mismo camino de los guiones 51/53/58/61 |
| Revertir los dos ficheros del cliente a `76beb948` para reproducir el nacimiento rojo de la regla | Verificación estática | Experimento de QA, restaurado; `git status` limpio |

## 7 · No probado

- **Mutación real** de los dos módulos: `permisoLocal` rechaza `local` sin medida previa, y es lo esperado. Los
  números los traerá la **autorización 1** del programa; `test/mutation-config.test.ts` obligará a copiarlos.
  Estimación del ingeniero: ~30 y ~20 mutantes.
- **Gasto de créditos real**: todo contra el motor falso (`⛨ guardarraíl: cliente y bridge declaran fake:true`). Que
  una clave de atlas no se pague dos veces está medido en POST, no en factura.
- **La rama `"re-disparar"`** en el flujo real fuera del 60 (A3): el único camino que produce el solape es
  re-añadir el tile activo (resume o `request_tile`), y ahí ya hay candado.
- **El rearme del fusible por el camino del jugador**: bloqueado por H1 (medido con workaround, §6).
- Los 404 de `/cache/surface/` (H5) y el comportamiento contra un **asset-store real**: fuera del banco.

## 8 · Veredicto

**APTO.** El movimiento es fiel, puro y está medido; la regla nace roja y muere verde; los dos guiones tocados no
cambian ni un byte ejecutable; el juego real hace lo que la PR dice (un POST de atlas por tile, apagón al tercer
personaje anunciado una vez, 404 que no gasta evidencia); la batería no deja ningún rojo imputable al cambio y hay un
guion nuevo que canda dos cosas que nadie candaba, probado en negativo. Lo único imputable a esta PR es **H2**, una
línea de comentario en la cabecera del guion 53 (y su gemela en el 59): un barrido de prosa que se quedó a medias.
H1 y H4 → **#483**; H3 → issue propio («rearmar promete más de lo que da»); H5 → triaje; H6 → **#496**, ya abierto.

## Nota del coordinador al incorporar el informe (2026-09-07)

H2 (los dos rastros de prosa en las cabeceras de los guiones 53 y 59) barridos por el coordinador en la rama, solo comentarios.
H1/H4 → comentario en **#483**; H3 → **#520**; H5 (404 de `/cache/surface/{hash}`) queda sin investigar, anotado aquí; H6 = #496.
La rama se rebasó sobre `main` con la PR 2: una sola regla con los dos grupos de tokens y los dos párrafos.
