# QA — PR 1 de #241: los gates de imagen salen del cliente y del bridge a `session/gates-de-imagen.ts` (#508)

Worktree `/home/al/code/ne-fan-241-1-qa`, HEAD `15b3cda9` sobre `main` `76beb948`. Todo con
`NEFAN_PORT_OFFSET=600` y cero créditos (motor falso). Nada arreglado: los hallazgos van abajo.

## Veredicto

**APTO CON RESERVAS.** El movimiento es real y está probado: los dos gates de gasto y la regla
«un `character_mode` vacío SIGUE al de escenarios» viven en un solo sitio, medido, y los cuatro
consumidores dan en el juego exactamente lo que daban en la base — **salvo una desviación que el
informe declara «sin efecto observable» y sí lo tiene** (H1: con `graphics.ai_skin=false`, meter
`aiSkin` dentro de `setSkinsAllowed` deja INALCANZABLE el fail-loud de
`renderer/aspecto-del-jugador.ts:150-155` y convierte su documentación en falsa). Es una esquina
de configuración —el defecto es `ai_skin: true`— y el arreglo es de una línea o de un párrafo,
pero es justo el tipo de afirmación que esta casa no deja pasar sin medir. Lo demás está limpio:
regla roja→verde probada en negativo, probe que distingue copia de llamada, `sin medir` con dueño,
grep a 0, 4/4 combinaciones del título correctas, el save legacy sin campo se comporta igual en
cliente y bridge, y cero skins pedidos sin sesión con el toggle apagado.

## Criterios

| # | Criterio (de los requisitos, el plan §4 fila 1 y el mandato) | | Evidencia |
|---|---|---|---|
| C1 | **Es un MOVIMIENTO**: los tres predicados + `normalizarModo` + `effectiveCharMode` + la copia del bridge + `render-mode.ts` dan HOY lo que daban en `76beb948` para la tabla completa `renderMode × characterMode × toggles × aiSkin` | ⚠️ | Script sobre `nefan-core/dist` con la base transcrita verbatim de `git show 76beb948:…` (200 casos × 7 sitios). **P1 gate del atlas: 0 diferencias. P3 chip `charsOn`: 0 diferencias.** P2 `setSkinsAllowed`: **50 diferencias, TODAS con `aiSkin=false`** → H1. P4 `charLabel`: 18, todas con `scenesMode=""`, o sea **inalcanzables** (la línea solo se imprime con escenarios puestos) → la desviación 5 del informe es cierta. P5 badge del título: 2, solo con `character_mode:"foo"` → H2. P6 `start_session`: 4, solo con `0`/`false` (no-strings que el zod `z.string().optional()` rechaza en `message-intake.ts` antes del handler) → inalcanzables. P7 `applyRenderModeChange`: 16, solo con `character_mode:"foo"` → H2 |
| C2 | Módulo puro sin `node:*`, dentro del perímetro | ✅ | `npm run verify` → `tests 2208 · pass 2208 · fail 0` (incluye `core-puro-sin-node` y `cierre`); `grep node:` en el módulo = 0 |
| C3 | La regla `la-logica-de-juego-no-vuelve-al-cliente` se pone **ROJA** si vuelve la copia | ✅ | Reintroducida en `nefan-html/src/ui/graphics-mode.ts`: `✖ … 1 !== 0` con `graphics-mode.ts:222 — patrón prohibido: "characterMode \|\|"` y el `why` entero. Restaurado: `git status` limpio |
| C4 | El `why` cuenta qué era y dónde vive | ✅ | Nombra los cuatro sitios con línea (`modos-de-graficos.ts:106`, `title-screen.ts:1624`, `session.ts:370`, `render-mode.ts:40`), el destino, y qué NO caza (la llamada sin `\|\|`) |
| C5 | La regla cubre `nefan-core/bridge/**` | ❌ | Copia reintroducida en `bridge/handlers/session.ts` → **86/86 verdes**. `files` es solo `nefan-html/src/**/*.ts` → H3 (decisión del plan, declarada por el ingeniero) |
| C6 | El probe de `architecture.test.ts` **distingue copia de llamada** | ✅ | Ensanchado el patrón a `(?:\b(?:characterMode\|charactersMode\|character_mode))` (que casaría también la llamada) → el propio probe se pone **rojo**: `✖ … las copias … saltan; la llamada a core no`. Restaurado |
| C7 | Mutación: `break: "sin medir"`, `deuda` lo lista, sin la entrada `npm test` cae «sin dueño» | ✅ | `mutacion -- pendiente`: «1 módulo(s) sin base: **gates-de-imagen**». `npm run deuda`: «sin medir 1 de 44 módulos (1 ficheros sin dato) … (sin medida previa)» — lo **cuenta**, no lo nombra (quien lo nombra es `pendiente`). Quitada la entrada → `mutation-config.test.ts` `fail 1`: «**sin dueño** en mutation-targets.json: src/session/gates-de-imagen.ts…». Devuelta → `pass 27 · fail 0`. `mutacion -- local gates-de-imagen` → «NO se mide aquí: no hay medida previa…», como debe |
| C8 | Los 23 casos matan los mutantes que importan | ✅ | Girada la regla (`f.renderMode \|\| f.characterMode`) → **4 fallos**; `aiSkin` invertido (`!f.aiSkin &&`) → **7 fallos**. Y la nota honesta del informe se confirma: con la regla girada, `render-mode.test.ts` SOLO da `tests 8 · pass 8 · fail 0` — el segundo fichero de la batería no ve ese mutante |
| C9 | Rastros a cero | ✅ | `grep -rnE 'effectiveCharMode\|characterMode \|\|\|charactersMode \|\|' nefan-html/src nefan-core/bridge nefan-core/src qa docs/arquitectura` → **1 línea, y es el módulo** (`gates-de-imagen.ts:37`). Ampliado a `character_mode \|\|` y `personajesGeneran` + `CLAUDE.md` y `labs/`: lo mismo |
| C10 | Flujo real desde el arranque: partida nueva con **cada** combinación del título; el chip refleja el gate; «Gráficos: …» en el registro | ✅ | `NEFAN_PORT_OFFSET=600 ./start.sh --preset e2e-sin-creditos` + navegador propio. image/image → chip «🎨 Imagen IA» · «personajes: Skins IA» · registro «Gráficos: imagen IA (skins IA)» · **4 POST** `/skin_sprite_sheet`. image/vector → «🎨/🧱 Mixto» · «personajes: Personajes base» · «imagen IA (personajes en base y_bot)» · **0 POST**. vector/image → «Mixto» · «Skins IA» · «maqueta 3D (…; skins IA)» · **4 POST**. vector/vector → «🧱 Maqueta 3D» · «…base» · «maqueta 3D (…; personajes en base y_bot)» · **0 POST**. Cero avisos en el registro de errores. Capturas en `/tmp/claude-1000/-home-al-code-ne-fan/273328d5-3414-4aea-9086-e8ac99d49ac2/scratchpad/ojos/chip-*.png` |
| C11 | Con `character_mode: ""` en el save, personajes SIGUE a escenarios en **cliente Y bridge** | ✅ | Guion 87 (abajo), verde: el cliente recibe `characterMode: ""` y aun así pinta «Skins IA»/«Personajes base» según escenarios; el bridge, sobre ese mismo vacío, **rechaza** `set_render_mode(characters,image)` con «la partida ya tiene los personajes en modo image» y **acepta** `vector`, cuyo eco casa con lo que el chip pinta. Qué persiste: reanudar **no** materializa (`character_mode` sigue `""`); el cambio aceptado **sí** (`"vector"` en `state.json`) |
| C12 | `html-fixtures` sin sesión: toggles de `localStorage` → 0 skins con personajes OFF | ✅ | Preset `html-fixtures` (+600), fixture `robledo_tile` con **5 NPCs descritos**: toggle ausente → `skins: []`, **0 POST**; `nefan.aichar="0"` → `skins: []`, **0 POST**; `nefan.aichar="1"` → 5 skins pedidos, **3 POST**. El chip está oculto en los tres (H7) |
| C13 | La cifra del cliente SUBE +7 y `title-screen.ts` 1.732 → 1.734 **con motivo verdadero** | ✅ | Medido: `nefan-html/src/**/*.ts` **14.466 → 14.473**; `title-screen.ts` **1.732 → 1.734**; `modos-de-graficos.ts` 209 → 214. El motivo de `client-file-size.json` («4 líneas de copia → 5 de llamada + 1 import») **cuadra con el diff línea a línea**. Es honesto: lo que se fue son las líneas de DECISIÓN (grep a 0) y lo que queda es import + cabecera. Reserva de programa en H4 |
| C14 | Los 85 guiones verdes **sin retocar** ninguno | ✅ con nota | `NEFAN_PORT_OFFSET=600 node qa/run.mjs`: corrida 1 `83 en verde · 2 en rojo de 85` — el 80 es la intermitencia ya documentada (#496) y **el otro rojo era MI guion nuevo**, no el producto (ver §Batería). Ningún guion existente tocado: el diff de QA son dos ficheros míos (`qa/guiones/87-…` y una fila en `qa/README.md`) |
| C15 | `verify`, tsc/lint/build del cliente | ✅ | core: `tests 2208 · pass 2208 · fail 0`. cliente: `tsc --noEmit` exit 0 · `eslint .` sin avisos · `✓ built in 1.56s` |
| C16 | `deuda` sin empeorar | ✅ | `npm run deuda`: 13 fronteras congeladas (todas del cliente, previas) + 58 supervivientes de la huella, **ninguno nuevo** y nada de lo tocado aparece; `mutacion-huella.json` sin cambios en la rama |

## Las cuatro comprobaciones pedidas

**(a) ¿Es honesto que una PR que saca lógica del cliente lo engorde, y el motivo escrito es verdad?**
Sí las dos cosas, y está declarado en tres sitios (informe §Desviaciones 2 y 3, mensaje de commit,
`client-file-size.json`). Medido por mí: 14.466 → 14.473 (+7) y 1.732 → 1.734 (+2), exactamente lo
que dice. El motivo del JSON («la regla del badge deja de ser una copia y pasa a ser una llamada a
core: 4 líneas fuera, 5 + import dentro») cuadra con el diff. Lo que se fue es lo que importa —las
líneas de decisión, `grep` a 0—; lo que entró es import y cabecera. **La reserva no es de honestidad
sino de aritmética del programa**: el plan §7 presupuestaba −23 para esta PR y el resultado es +7,
30 líneas de desvío en la primera de ocho (H4).

**(b) «`aiSkin` entra ahora en el gate de personajes: sin efecto observable».** **Falso en una
esquina real.** `runtime_config.json` trae `graphics.ai_skin: true` (y `src/config.ts:167` igual),
así que el defecto no cambia; pero con `ai_skin:false` los dos caminos divergen:

- `setSkinsAllowed(g.personajes)` con `aiSkin` dentro ⇒ `skinsAllowed` es **siempre false**. Probado
  mecánicamente sobre el dist: en los 72 casos, `gates.personajes ⇒ aiSkin` no se viola ni una vez.
- Por tanto la rama `if (skinPrompt && characterSprites.skinsAllowed) { if (!CONFIG.graphics.ai_skin) { errors.push; throw } }`
  de `renderer/aspecto-del-jugador.ts:150-155` es **inalcanzable**. Antes, un save con personajes en
  imagen y `appearance.skin_path` con `ai_skin:false` hacía que `vestir()` LANZARA y el arranque
  volviera al título con «No se pudo reanudar la partida…» (`main.ts:1384-1405`); hoy la partida
  entra en silencio con y_bot. Sigue existiendo el aviso de `modos-de-graficos` («la partida tiene
  skins IA activados pero graphics.ai_skin=false»), así que el jugador no se queda sin explicación
  —por eso es H1 y no un bloqueante—, pero **la conducta cambió y el informe dice que no**, y la
  documentación de `aspecto-del-jugador.ts:49-50` («Con `graphics.ai_skin === false` y prompt no
  vacío LANZA») pasó a ser falsa. No reproducido en vivo a propósito: exigiría editar `src/config.ts`
  (contaminar el árbol); queda probado por construcción y por la tabla de equivalencia.

**(c) La regla no cubre `nefan-core/bridge/**`: ¿decisión del plan o hueco?** Las dos cosas. El plan
acota la regla a `nefan-html/src` (§3 y §4) y el ingeniero lo declaró; pero el `why` de la regla
NOMBRA la copia del bridge como una de las cuatro, así que quien la lea creerá que está cubierta.
Medido: reintroducida en `bridge/handlers/session.ts`, los 86 tests de arquitectura pasan. Hoy esa
copia solo la vigila un `grep` que vive en el informe de una PR — es decir, prosa. H3.

**(d) ¿El probe distingue copia de llamada?** Sí, y lo he probado en negativo (C6): con el patrón
ensanchado para que cace también `modoEfectivoDePersonajes({ renderMode, characterMode })`, el probe
se pone rojo. Es un probe que puede fallar, no un verde decorativo. Su límite —honesto pero conviene
escribirlo— es sintáctico: la MISMA regla escrita `f.characterMode ? f.characterMode : f.renderMode`
o `s.character_mode ?? s.render_mode` en el cliente pasa verde (medido). El `why` no promete cazar
eso, pero tampoco lo dice.

## Hallazgos

1. **H1 · importante · DE ESTA PR.** El fail-loud de `renderer/aspecto-del-jugador.ts:150-155` quedó
   inalcanzable y su documentación (`:49-50`) es ahora falsa; con `graphics.ai_skin=false` el
   arranque pasa de abortar a entrar en silencio. El informe lo declara «sin efecto observable».
   *Reproducción*: poner `graphics.ai_skin:false` en `nefan-core/src/config.ts`, reanudar un save con
   personajes en imagen y `appearance.skin_path` no vacío. *Esperado por el usuario*: o el fail-loud
   sigue vivo, o el cambio se declara y la doc se reescribe. *Destino*: el mismo ingeniero, en esta
   PR — decidir cuál de las dos y escribirlo (si se prefiere conservar el fail-loud, `aiSkin` vuelve
   a entrar solo en el chip y en `charLabel`, que es donde ya estaba).
2. **H2 · menor · DE ESTA PR, no declarado.** `normalizarModo` en `narrative/render-mode.ts` cambia
   la conducta ante un `character_mode` **desconocido** en el save (`"foo"`): la base lo trataba como
   modo propio (aceptaba el cambio y lo materializaba) y el título no pintaba badge; hoy se colapsa a
   «sin elegir», el bridge **rechaza** con «ya tiene los personajes en modo image» y el título pinta
   el badge heredado. Solo alcanzable con un save editado a mano o corrupto, y la conducta nueva es
   más coherente (el cliente ya normalizaba así) — pero es un cambio y no está escrito. *Destino*:
   una línea en el informe/PR.
3. **H3 · menor · decisión del plan, declarada.** La regla `text` no cubre `nefan-core/bridge/**`
   (medido: la copia reintroducida ahí sale verde) mientras su `why` nombra esa copia. *Destino*:
   coordinador — ampliar `files` a `nefan-core/bridge/**` (el patrón no daña a core: la regla vive en
   `src/session/`, fuera de ese glob), o decir en el `why` que el bridge queda fuera y por qué.
4. **H4 · menor · del PROGRAMA, no de la PR.** El plan §7 presupuestaba −23 líneas de cliente para
   esta PR y salieron +7. El peaje (import + cabecera que dice dónde vive la decisión) lo pagarán
   también las otras siete: si el desvío se repite, el cierre de #241 (`≤ 13.950`) se queda sin
   margen. *Destino*: coordinador — re-derivar la cifra de cierre tras la PR 3, con dos PR medidas.
5. **H5 · menor · PREEXISTENTE (idéntico en la base).** De los dos toggles que ahora entran en el
   gate de core, `toggleLocalEscenarios` **no tiene consumidor alcanzable**: su único lector es
   `escenariosGeneran()`, y `main.ts:199` lo tapa con `session.active && …`; el chip que lo mostraría
   está oculto sin sesión (medido: `chipOculto: true` en las tres cargas de fixture). El test de core
   lo mide como si decidiera algo. *Destino*: #241 PR 3 (atlas) o issue propio.
6. **H6 · menor · PREEXISTENTE.** Con el cortacircuitos de sesión disparado (3 personajes caídos con
   5xx, que es lo que hace el motor falso en `walk`), el chip sigue diciendo «Skins IA» y el panel
   sigue anunciando «gasta créditos»: `skinsAllowed` no es el fusible. El jugador lee que se está
   pagando arte que no se está pidiendo. Captura `…/scratchpad/ojos/chip-image-image.png` (registro con
   los 500 y chip en «🎨 Imagen IA»). *Destino*: #241 PR 3, que se lleva el fusible a core.
7. **H7 · menor · PREEXISTENTE (lo declaró el ingeniero).** En `html-fixtures` el chip **nunca** se
   ve (`graphics-mode.ts:72` nace oculto y solo lo enseña `onVisibilityChange(false)`, que sin título
   no ocurre), así que el toggle que decide el gasto sin sesión no tiene mando visible: solo
   `localStorage` o el menú dev. Medido en los tres arranques de fixtures. *Destino*: issue de DOM,
   fuera de #241.
8. **H8 · menor · PREEXISTENTE, visual.** La línea «Gráficos: …» del registro —justo la que esta PR
   toca— se pinta en gris azulado sobre el suelo y, con el camino claro delante, queda al borde de la
   ilegibilidad, además de solaparse con la barra de ataques. Capturas `…/scratchpad/ojos/panel-abierto.png` y
   `qa/capturas/<corrida>/87-…-02-escenarios-maqueta-personajes-heredan.png`. *Destino*: issue de UI.

**Crítica visual (chip y panel).** El chip cumple: tres estados distinguibles de un vistazo
(«🎨 Imagen IA», «🧱 Maqueta 3D», «🎨/🧱 Mixto»), icono + palabra, esquina inferior derecha estable
entre estados, y el `title` dice las dos facetas por su nombre. El panel anuncia el coste con las
mismas palabras que el título («gasta créditos» / «sin coste») y advierte del efecto real del OFF→ON
(«re-pide los skins de todo lo ya en escena»): el gasto está anunciado antes de tocarlo, que es lo
que había que comprobar. Lo que chirría es de fuera de esta PR: el registro del juego (H8) y que el
chip no distinga «encendido» de «encendido pero el fusible saltó» (H6).

## Workarounds usados

| | Qué | Veredicto |
|---|---|---|
| W1 | Editar `world.character_mode` a `""` en el `state.json` del disco efímero para fabricar el save legacy | **No es hallazgo**: ese estado ya no lo produce el juego (el bridge materializa el campo al crear la partida), pero sí lo tiene el jugador con un save anterior al campo — que es exactamente el caso que la regla defiende. El guion restaura el fichero al salir y con Ctrl+C |
| W2 | Navegador propio con `playwright-core` de `qa/node_modules` y URL `?input=scripted&ai=…&raf=timer&offset=600` | **No es hallazgo**: es el camino estándar del banco (el MCP de Playwright es compartido entre agentes y no se usó) |
| W3 | Escribir `nefan.aichar` en `localStorage` a mano para medir el gate sin sesión | **Sí es hallazgo**, y es H7: sin sesión no hay mando visible para ese toggle |
| W4 | NO se editó `src/config.ts` para reproducir `ai_skin:false` en vivo | Declarado en «No probado»; H1 queda probado por construcción y por la tabla de equivalencia |

## No probado

- **Gasto real de créditos**: todo con el motor falso, por mandato. Ninguna de las rutas de pago
  reales se ejerció (el guardarraíl del runner lo verifica en cada guion).
- **`graphics.ai_skin=false` en vivo** (H1): probado por construcción (`gates.personajes ⇒ aiSkin` en
  los 72 casos) y leyendo el camino, no ejecutado.
- **La medida de mutación del módulo**: nace `sin medir` y `local` la rechaza por coste desconocido
  (reproducido). El suelo lo pondrá la autorización 1 de #241.
- **La doble línea «Gráficos: …» al tocar el chip** que el ingeniero declara preexistente y cosmética:
  en mis cuatro arranques la línea sale UNA vez (no toqué el chip por el camino que la duplica).
- **`character_mode` con un valor desconocido en vivo** (H2): comparado sobre el dist, no jugado.

## Guion nuevo

**Lo que la batería le encontró a mi propio guion, y cómo se arregló.** En la corrida 1 el 87 salió
ROJO («timeout esperando: el registro del juego dice “Gráficos: imagen IA (skins IA)”») después de
haber salido VERDE en cuatro corridas sueltas. No era el producto: el registro conserva **ocho
líneas** (`main.ts:495`) y, dentro de la batería, las del tile y el atlas que llegan detrás echaban
fuera la línea antes de que yo la leyera. Un guion que solo pasa cuando corre solo no vale, así que
se corrigió por donde manda el `qa/README.md` (que el estado se RECUERDE en vez de bajarle el listón
al aserto): un `MutationObserver` sobre `#combat-log` instalado ANTES del resume por el hueco
`alRecargar` de `reanudar` — el molde del guion 60. Con eso, `node qa/run.mjs 87 80` → `2 en verde ·
0 en rojo de 2`, y la corrida 2 entera abajo.


`qa/guiones/87-el-modo-vacio-de-personajes-sigue-a-los-escenarios.mjs` (+ su fila en `qa/README.md`),
sin commit, en el árbol. Mide la frontera movida por el camino del jugador: el save sin
`character_mode` visto desde el título, desde el chip, desde el registro, desde el cable de skins y
desde el bridge. Verde en la corrida final (y en las cuatro sueltas del desarrollo; el arreglo del
párrafo anterior está dentro):

```
▶ 87-el-modo-vacio-de-personajes-sigue-a-los-escenarios
    ✔ el título pinta el badge de PERSONAJES del save sin campo, y dice «Skins IA»: sigue a escenarios
    ✔ el cliente recibe el modo de personajes VACÍO tal cual (la regla la resuelve él, no el wire)
    ✔ el chip dice «escenarios: Imagen IA · personajes: Skins IA» con el campo vacío en el save
    ✔ el registro del juego dijo «Gráficos: imagen IA (skins IA)»
    ✔ …y salen por el cable: al menos un POST a /skin_sprite_sheet
    ✔ reanudar NO materializa el campo: el save sigue vacío
    ✔ el bridge RECHAZA poner personajes en image: para él ya lo están (heredan de escenarios)
    ✔ el bridge MATERIALIZA el campo al cambiarlo: el save deja de heredar
    ✔ el título dice ahora «Personajes base» en el mismo save vacío: la herencia cambió de signo
    ✔ el registro dijo «Gráficos: maqueta 3D (…; personajes en base y_bot)»
    ✔ NO ocurre: con los personajes heredando maqueta, la partida NO pide un solo skin
1 en verde · 0 en rojo de 1
```

**Probado en negativo**, un sabotaje por vez en `gates-de-imagen.ts:37` y restaurado byte a byte:

| Sabotaje | Qué pasa |
|---|---|
| `return f.characterMode` (la regla BORRADA) | **rojo ×4 en el bloque 1**: el título no pinta badge (`null`), el chip dice «Personajes base», el registro «personajes en base y_bot» y `__nefan.skins` se queda vacío |
| `return f.characterMode \|\| "image"` (el vacío SIEMPRE gasta) | **rojo en el bloque 3**: con todo en maqueta el título ofrece «🎨 Skins IA» y el chip nunca llega a «Personajes base» — el fallo que cuesta dinero |
| `return f.renderMode \|\| f.characterMode` (la regla GIRADA) | **rojo en el bloque 2** (el chip no sigue al eco del bridge). Los bloques 1 y 3 NO lo ven, y es correcto: con una faceta vacía `a \|\| b` y `b \|\| a` dan lo mismo. Por eso el guion tiene bloque 2 — sin él, este mutante pasaría por encima |

## Batería completa

`NEFAN_PORT_OFFSET=600 node qa/run.mjs`, sin retocar **ningún guion existente** (el único que cambié
entre las dos corridas fue el mío, y arriba está por qué). Puertos antes: 22/53/80/631/3636 del sistema
más los bloques **+0, +500 y +700** de otros worktrees (`ne-fan-241-2-qa`, `ne-fan-241-3-qa`), que no
se tocaron — `NEFAN_PORT_OFFSET=600 ./start.sh --parar` los enumeró como AJENOS y solo se llevó
:10477/:10478/:3600/:19365, los míos. Puertos del catálogo después: ninguno del bloque +600.

**Corrida 1** (85 guiones, con el 87 tal como lo escribí):

```
83 en verde · 2 en rojo de 85 · capturas en /home/al/code/ne-fan-241-1-qa/qa/capturas/2026-09-07T11-32-18-143Z-132193
```

Los dos rojos, repetidos sueltos (`node qa/run.mjs 87 80` → `2 en verde · 0 en rojo de 2`):

- `80-el-desplegable-room-dice-lo-que-se-ve` — «…ni deja una entrada de error — 4 → 5»: es la
  intermitencia ya documentada con causa raíz en **#496** (el bridge del guion anterior difunde a una
  página sin sesión; `qa-7.md:171` y `qa-8.md:154` de la tanda anterior). **Verde suelto.** No toca
  modos de gráficos: no es de esta PR.
- `87-…` — el **mío**, y el fallo era del guion, no del producto (ver arriba: el registro de 8
  líneas). Corregido con el observador y verde suelto.

**Corrida 2** (la misma batería entera, con el 87 ya corregido y nada más cambiado):

```
85 en verde · 0 en rojo de 85 · capturas en /home/al/code/ne-fan-241-1-qa/qa/capturas/2026-09-07T11-43-18-888Z-157281
```

Los cinco guiones de la red del chip (15, 51, 53, 59, 60), el 85 (el eco del bridge) y el 87 nuevo,
dentro y en verde.


## Vuelta (2026-09-07)

La escribe el **ingeniero** de la PR 1 (mismo contexto), en `/home/al/code/ne-fan-241-1`. La rama se
rebasó sobre `main` y los arreglos van en un segundo commit encima. Cero créditos,
`NEFAN_PORT_OFFSET=100` para lo que no elige bloque solo, ningún proceso ajeno tocado (`ss -ltn` antes
y después: del catálogo, nada arriba; el banco eligió su propio bloque).

**Rebase.** Al empezar, `main` era `6ce204ec` (PR 2 de #241). A mitad de la vuelta entró **`8c7f6567`
(PR 3)**, así que la rama se rebasó sobre esa: es la única forma de que la PR 1 sea mergeable y de que
la regla acabe con los tres grupos. Conflictos y resolución:

| Fichero | Resolución |
|---|---|
| `data/contract/arch-rules.json` | UNA regla `la-logica-de-juego-no-vuelve-al-cliente` con los **tres** grupos y un párrafo por PR en el `why` (PR 1, PR 2, PR 3). Patrón: `(?:\b(?:characterMode\|charactersMode\|character_mode)\s*\|\|)\|(?:\b(?:FrontierManager\|PREFETCH_M\|VEIL_M\|BLOCKING_M\|TILE_TIMEOUT_MS\|ERROR_COOLDOWN_MS\|pendingTiles\|queuedTiles\|UMBRAL_APAGADO_DE_SESION\|skinsDisabled\|personajesFallidos)\b)` — el grupo de la PR 1 va aparte porque su token es la caída `\|\|`, no un identificador |
| `data/contract/mutation-targets.json` | Los cuatro módulos nuevos del programa conviven: `gates-de-imagen`, `frontera`, `politica-de-atlas`, `fusible-de-skins` (47 módulos) |
| `docs/arquitectura/mapa.md` | `scene/` y `session/` describen las cuatro piezas movidas, sin perder ninguna |
| `qa/README.md` | La fila del 87 delante de la del 88 (guion de la PR 3) |
| `test/architecture.test.ts` | Fusionó solo: los **tres** probes vivos (líneas 358, 1041, 2027) |

Tras resolver, `npm test` → **2256 · pass 2256 · fail 0** (88 en `architecture.test.ts`), y la regla
probada **en rojo con un token de CADA grupo** más la copia del bridge (abajo).

| | Qué se hizo | Prueba ejecutada |
|---|---|---|
| **H1** ✅ arreglado | `aiSkin` **sale** de `gatesDeImagen` (la firma ya no lo tiene) y vuelve exactamente donde estaba: el rótulo del registro (`effChar !== "vector" && CONFIG.graphics.ai_skin`) y el chip (`charsOn: skinsAllowed && CONFIG.graphics.ai_skin`), los dos **verbatim de la base**. `setSkinsAllowed` recibe otra vez el gate sin `ai_skin`, así que el fail-loud de `renderer/aspecto-del-jugador.ts:150-155` vuelve a ser alcanzable y su doc `:49-50` vuelve a ser cierta. Tres casos del test de core que medían ese parámetro **borrados** (23 → 20): no se deja un test vivo sobre una rama que ya no existe | Tabla de equivalencia base↔hoy re-corrida sobre el `dist`: **P2 `setSkinsAllowed` pasa de 50 diferencias a 0**, y P1/P3/P4/P6 siguen en 0. Alcanzabilidad medida: con `ai_skin=false`, el gate de `15b3cda9` daba `skinsAllowed=true` en **0 de 36** combinaciones (throw muerto) y el de hoy en **18 de 36** |
| **H2** ✅ arreglado | `applyRenderModeChange` conserva la conducta de la base ante un `character_mode` desconocido: un valor que no es `image`/`vector` **y no está vacío** cuenta como modo propio (no hereda; el cambio se acepta y lo materializa). El campo AUSENTE (`undefined`) sigue siendo «sin elegir» y hereda — la primera versión de la guarda (`!== ""`) se lo dejaba fuera y la tabla lo cazó | `test/render-mode.test.ts` gana el caso (`"foo"` en los dos sentidos + campo ausente): 8 → 9 tests. **Probado en negativo**: con la guarda a `false` (colapsando otra vez) el caso se pone ROJO (`fail 1`: `{ok:false}` «ya tiene los personajes en modo image» donde debía haber `{ok:true}`). **P7 `applyRenderModeChange` pasa de 2 diferencias a 0** |
| **H3** ✅ arreglado | El checker SÍ admite varios globs en `files` (`matchesAny(file.path, rule.files)`, `src/contract/arch/check.ts:342`; molde `core-sin-catch-silencioso`). La regla suma `nefan-core/bridge/**/*.ts`; el `why` lo dice y dice por qué `nefan-core/src` queda fuera. El probe gana la copia del bridge en los positivos y la llamada a core desde el bridge en los negativos | Con los tres grupos y el bridge dentro, `npm test` **verde** (los tres dan 0 en `nefan-core/bridge` hoy). **En rojo, cuatro a la vez**: `nefan-core/bridge/handlers/session.ts:374 — "characterMode \|\|"`, `graphics-mode.ts:18 — "characterMode \|\|"` (PR 1), `:19 — "FrontierManager"` (PR 2), `:20 — "pendingTiles"` (PR 3) → `4 !== 0`. Restaurado byte a byte |

**Lo que sigue siendo un cambio de conducta y queda DECLARADO** (no se arregla aquí, por alcance): el
badge del título con un `character_mode` desconocido. La base no pintaba badge (`effectiveCharMode`
devolvía `"foo"` y `modeBadgeHtml` sale sin nada); hoy se normaliza a «sin elegir» y el badge hereda
del de escenarios. Es la única diferencia que queda de las siete que midió C1 (**P5: 2 casos, los dos
con `character_mode:"foo"`**). Se conserva a propósito: el chip en juego ya resolvía así en la base
—el título era el que discrepaba consigo mismo— y con badge el jugador puede sacar el save del estado
corrupto con un click (sin badge no podía). Apunta al mismo issue: **un modo desconocido en el save
debería rechazarse en `loadSession`, no materializarse ni heredarse**.

**Guion 87 incorporado.** `qa/guiones/87-el-modo-vacio-de-personajes-sigue-a-los-escenarios.mjs` entra
tal cual (323 líneas, con su observador del registro) y su fila va en `qa/README.md` entre la del 86 y
la del 88. Corrido tras los arreglos y tras el rebase sobre la PR 3: **`node qa/run.mjs 87` → 1 en
verde · 0 en rojo de 1**.

**Cifras finales** (contra `main` `8c7f6567`): cliente **14.190 → 14.202 (+12)**; `title-screen.ts`
1.732 → **1.734** (la cifra congelada de `client-file-size.json`, que no cambia en la vuelta);
`modos-de-graficos.ts` 209 → **219** (+10: la mitad son las notas que dicen por qué `ai_skin` NO está
en el gate — el comentario que habría evitado H1). Core: `gates-de-imagen.ts` 71 líneas.
`npm run verify` **2256 · pass 2256 · fail 0**; `crap --check` ✔ dentro de los umbrales (cobertura
89,2 %, 0 por encima del tope); `npm run deuda` **82 items** (13 fronteras + 11 CRAP + 58
supervivientes) y ninguno de lo tocado; cliente `tsc` exit 0 · `eslint` sin avisos · `✓ built in
1.48s`. Banco tras el rebase: **87 verde**, **15 51 53 59 60 85 → 6 en verde · 0 en rojo de 6**,
`qa/fixtures-sin-bridge.mjs` ✔.

**Lo que sigue sin cubrir, igual que antes**: `graphics.ai_skin=false` **en vivo** (H1) — `CONFIG` se
compila en el bundle (`src/config.ts:167`) y no hay override por entorno, así que reproducirlo exige
editar el fichero; queda probado por construcción (las 36 combinaciones) y por la tabla de
equivalencia, no jugado. La mutación de `gates-de-imagen` sigue `sin medir`: `local` la rechaza por
coste desconocido (reproducido) y `pendiente` la lista con los otros módulos nuevos del programa.
H4-H8 no se tocan: son del programa o preexistentes, con destino ya escrito arriba.
