# QA — corte 3 de #358: las fixtures del selector «Room» salen de `main.ts` a `world/fixtures-del-selector.ts`

**Veredicto: APTO CON HALLAZGOS.** El corte es un movimiento y no un cambio: las 152 líneas de sentencia y
comentario que salieron de `main.ts` en `5510963a` son, sin la sangría, las mismas que hay en el módulo nuevo
(diff normalizado abajo: solo cambian la forma de `addTileRaw` —arrow → `function`—, el renombre
`populateSceneSelector` → `poblar` y dos palabras de un comentario). El selector y la carga de fixtures hacen hoy
lo mismo que ayer en todos los estados que se pudieron alcanzar por el camino del jugador —sin bridge, con
partida viva, por el `<select>` y por el hook, encadenadas, repetidas, solapadas con `resetWorld`, con la opción
vacía—; el candado movido salta en rojo por sus tres caras; la batería de candados en negativo que el ingeniero
reparó era, en efecto, un candado muerto desde #387 y ahora caza 3 de 3; el trinquete lleva la cifra exacta y no
queda ningún símbolo movido fuera del módulo. Los hallazgos no son del corte: el más gordo es que **una fixture
cuyo módulo llega pero no es Format D deja el mundo VACÍO con el desplegable diciendo la fixture anterior**
(`loadSceneData` vacía antes de normalizar; el código es idéntico en la base), y el resto es deuda pre-existente
que el corte hace visible o detalles de forma.

Worktree `/home/al/code/ne-fan-358-3-qa`, commit `6f23a613` sobre `5510963a`. Cero créditos en toda la
verificación (`html-fixtures` y `e2e-sin-creditos` con el motor falso). Ningún proceso ajeno tocado: los stacks
de ojos en el bloque 500 (`NEFAN_PORT_OFFSET=500`), parados con `--parar` antes de cada batería; `ss -ltn`
antes y después: solo 22/53/80/631/3636.

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: el código que sale de `main.ts` es el que entra en el módulo | ✅ | `git show 5510963a:nefan-html/src/main.ts` líneas `75-81, 523, 695-749, 798-808, 862-906, 1056-1098` (152 líneas no vacías sin sangría) contra el módulo (189): el `diff` solo trae (a) las 16 líneas de cabecera e imports, (b) las 22 de las dos interfaces y la firma de la fábrica, (c) `addTileRaw` como `function` y `loadSceneData` en una línea de firma, (d) `populateSceneSelector` → `poblar`, (e) «Se queda aquí… de este fichero» → «Vive aquí… de este módulo», (f) las dos cabeceras `// --- Scene loading ---` y `// --- Scene selector handler ---` que no viajan, (g) `return { poblar, addTileRaw, loadSceneData, cargarFixture }`. Ninguna sentencia distinta |
| Las tres fixtures cargan por `<select>` y por el hook | ✅ | Sonda `ojos-qa3.mjs` en `html-fixtures` :3500. Opciones: `-- Room --`, `puerto_tile`, `robledo_tile`, `zorder_test`, con las claves `../nefan-core/data/scenes/<id>.json` (las mismas que antes de mover el glob). Robledo por `<select>`: `scene robledo_tile · tiles ["tile_0_0"] · billboards 6 · suelo 14 calcos · 5 npcs · 24 objetos`. Puerto por `<select>` encima de Robledo: `tiles ["tile_0_0"] · billboards 5 · suelo 57 · 4 npcs · 16 objetos`. Zorder por hook: `tiles ["tile_0_0"] · billboards 14 · 14 npcs · select = zorder_test`. Capturas `capturas-qa3/qa3-01…03` (scratchpad) |
| Cambiar de fixture con una cargada deja UN tile | ✅ | Puerto encima de Robledo: `tiles ["tile_0_0"]`, censo del puerto, jugador en su spawn `(-10.25, -0.75)`. Con bridge y partida viva, igual (fila «partida viva») |
| La misma fixture dos veces | ✅ | Zorder otra vez tras mover al jugador a `(4.25, 6.25)`: la carga resuelve `ok`, `tiles ["tile_0_0"]`, el jugador vuelve al spawn `(1.25, 3.25)`, censo idéntico. Guion 80 bloque 2 (andando 0,4 m con la tecla, no por hook) |
| Una fixture mientras otra carga (`ultimaCargaDeFixture`) | ✅ | `loadFixture(robledo)` y `loadFixture(puerto)` sin esperar la primera: las dos resuelven `ok`, el mundo es el puerto, UN tile, el `<select>` dice puerto, censo del puerto. Guion 80 bloque 1 |
| `resetWorld` a mitad de carga | ✅ | `loadFixture(robledo)` + `loadSceneRaw(zorder crudo)` sin esperar: las dos `ok`, queda UN tile. Nota: gana **robledo** (la fixture) aunque `loadSceneRaw` se pidiera después —su `resetWorld` es síncrono y el de la fixture llega tras el `await` del import—: pre-existente, bench-only, sin destino (§2 H7) |
| Cargar con partida viva en `e2e-sin-creditos` | ✅ | Sonda `ojos-qa3-e2e.mjs` :3500: partida `1788712232-8d6429` en `tile_0_0` (2 npcs) → `<select>` puerto: `scene puerto_tile · tiles ["tile_0_0"] · 4 npcs · select puerto_tile · sesión intacta`; el jugador anda con `w` (z −0,75 → −1,38); robledo encima: `tiles ["tile_0_0"] · 5 npcs`. `pageerrors 0`. El save no se toca: guion 25 en verde en la batería. Ver H3 (una entrada de error pre-existente) |
| `addTileRaw` sigue RECHAZANDO una escena servida | ✅ | Guiones 58 y 68 en verde sin retocarlos (batería). Además `addTileRaw({scene_id:"x", entities:[]})` → «una escena necesita `tile` {tx,ty}: es la única variante de Format D…» y `loadSceneRaw({tile sin biome})` → «tile.biome requerido (catálogo: …)». `loadFixture("no_existe")` → «fixture "no_existe" no está en el selector; hay: -- Room --, puerto_tile, robledo_tile, zorder_test» |
| **Candado movido**: la excepción apunta al módulo nuevo con `funcion: "addTileRaw"` y `desc` nombra el fichero | ✅ | `arch-rules.json:408,419-421`. `npm run verify` verde: `tests 2178 · pass 2178 · fail 0` |
| Negativo 1: `path` al viejo → rojo | ✅ | `sed` del `path` a `main.ts` + `node --import tsx --test test/architecture.test.ts`: `fail 2` — «`nefan-html/src/main.ts:1 — exención sin sujeto: addTileRaw ya no casa…`» y «`fixtures-del-selector.ts:101 — patrón prohibido: "formatDToWorld("`». Restaurado |
| Negativo 2: segunda llamada en otra función del módulo → rojo | ✅ | `void formatDToWorld(rawData);` dentro de `loadSceneData`: `fail 2` — «`fixtures-del-selector.ts:106 — fuera de la puerta addTileRaw: esta llamada vive en loadSceneData`». Restaurado |
| Negativo 3: la puerta se renombra → rojo | ✅ | `function addTileRaw2(`: `fail 1` — «esta llamada vive en `addTileRaw2`». Restaurado. `git status` limpio tras los tres |
| `architecture.test.ts` (39 líneas): ¿adapta o afloja? | ✅ adapta | La fixture `MAIN` (dos líneas, arrow) pasa a `FIXTURES` (siete líneas, la fábrica con `function addTileRaw` a sangría 2, forma del árbol de hoy); G1 y G4 mueven la línea esperada (`:3`→`:8`, `:2`→`:4`) y el `replace` del renombrado (`"addTileRaw ="` → `"function addTileRaw("`); G2 y «dos dentro de la misma función» conservan la forma arrow de una línea. Los seis asertos siguen (tercera puerta, segunda llamada en el fichero, dos dentro, exención sin sujeto, renombrado, `plan()`→`run()`). Nada se relaja: ningún `max`, ninguna severidad, ningún `path` sobrante |
| **`qa/bateria-candados-en-negativo.mjs` estaba roto desde #387** | ✅ cierto | `git show 5510963a:nefan-html/src/main.ts \| grep -c "^      const carga = ultimaCargaDeFixture;$"` = **0** (la línea tiene 2 espacios: `:893`); en `5ad19144^` (antes de #387) la misma línea tenía **6** (`:1434`) y en `5ad19144` ya 2 (`:885`). El script exige `veces === 1` y con 0 marca «⚠️ el patrón aparece 0 veces… Patrón obsoleto: 3» y sale 1 tras correr los tres guiones base: llevaba cinco días sin poder poner rojo nada |
| El retoque solo reapunta al sujeto movido | ✅ | Diff de 20 líneas: `MAIN`→`FIXTURES` (ruta) y la cadena `buscar/poner` de 6 a 4 espacios, en las tres entradas de #308. Huellas, guiones (`22`, `44`, `01`) y `codigoEsperado` intactos; #331, #261 y #320 sin tocar |
| Corrido: los 3 negativos de #308 salen ROJOS nombrando la causa | ✅ | `node qa/bateria-candados-en-negativo.mjs 308` sobre el árbol limpio: base 3 verdes; «🔴 rojo … lo caza (22): se pidió la fixture «puerto_tile» y el mundo se quedó en «null»…», «🔴 rojo … (44): …la carga de «puerto_tile» sigue PENDIENTE… asentada=true con el mundo en «robledo_tile»», «🔴 rojo … (01): se pidió la fixture «robledo_tile» y el mundo se quedó en «null»…». `Candados probados 3 · Nacen rojos y NOMBRAN la causa 3 · Patrón obsoleto 0 · exit=0`. Árbol limpio después. **Duración medida: 68 s de pared** para las seis corridas (18:30:35 → 18:31:43) |
| **API y deps**: fábrica con 3 deps mínimas, no bolsa | ✅ | `DepsDeFixturesDelSelector = { addTile: CargaDeTile["addTile"]; resetWorld(): void; log(msg) }`; `paso`, `formatDToWorld`, `etiquetaDeFixture`, `motivoDeFixtureParaElJugador` importados como módulos. Devuelve `{ poblar, addTileRaw, loadSceneData, cargarFixture }`; los tres últimos van al seam del banco (`main.ts:1350-1352`) sin cambiar `DepsDelHook` |
| `addTileRaw` como `function` multilínea localizable por sangría | ✅ | `fixtures-del-selector.ts:100-102`: `function addTileRaw(` a sangría 2, la llamada a 4. `enclosingFunction` (check.ts:262) sube por sangría y la encuentra (negativos 2 y 3 lo demuestran: una llamada a sangría 4 en otra función se atribuye a ESA función) |
| ¿Lógica que debería estar en core? | ✅ ninguna | Lo que cruza es DOM (`<select>`, `optgroup`, `addEventListener`), el glob de Vite, dos flags de presentación y la orquestación `resetWorld → addTile`. La normalización es `formatDToWorld` por la puerta; etiqueta y motivo salen de `status-motivo.ts` (core). El `sort` por `localeCompare` es presentación |
| **Cero rastros** | ✅ | `grep -rnE 'ultimaCargaDeFixture\|fixtureCargada\|populateSceneSelector\|loadSceneFile\|sceneModules\|sceneSelector'` fuera del módulo, `docs/agents/`, `node_modules`, `dist`, `qa/.tmp`, `qa/capturas`: solo el puntero de la batería (`bateria-candados-en-negativo.mjs:80-122`, que ES el candado) y tres crónicas de #248 que nombran `loadSceneFile` sin situarlo en `main.ts` (`title-screen.ts:89`, `qa/README.md:171`, `qa/guiones/24:3`, `arch-rules.json:383`). Prosa que sitúe fixtures/selector/`addTileRaw` en `main.ts`: **0** (`fixtures-sin-bridge.mjs:74` habla del `catch` del bootstrap, que sigue allí). `mapa.md:58`, `vistas.md:190`, `carga-de-tile.ts:129` y los cuatro comentarios de `nefan-hook.ts` apuntan al módulo |
| Trinquete: `client-file-size.json` = `wc -l` | ✅ | `"lineas": 1935` = `wc -l main.ts` → 1935; `porque` gana UNA frase de crónica y no se reescribe como «raíz de composición» (es del último corte, plan §5) |
| 17 `let` · módulo ≤ 450 | ✅ | `grep -c '^let ' main.ts` = 17 (19 − `ultimaCargaDeFixture` − `fixtureCargada`); `wc -l fixtures-del-selector.ts` = 203 |
| `npm run verify` · tsc/lint/build del cliente | ✅ | `verify exit=0` (2178 tests, 17 s de `npm test`); `TSC_OK · LINT_OK · ✓ built in 1.47s`. `architecture.test.ts` con el guion 80 en el árbol: `pass 84 · fail 0` |
| **Adversarial** · fixture inexistente por hook | ✅ | Lanza síncrono nombrando las opciones (arriba). Igual que la arrow de antes |
| Adversarial · Format D inválida por hook: ¿fail-loud al jugador o solo consola? | ⚠️ ver H1 | Por `addTileRaw` el rechazo va SOLO al llamante (es la API del banco; correcto, y el mundo no se toca). Por `loadSceneRaw` —y por el mismo `loadSceneData` que usa el `<select>`— el mundo se VACÍA antes del rechazo: `escena robledo_tile → null · tiles [] · errores 6 → 6` (por hook nadie avisa: es el llamante quien recibe el rechazo). Por el camino del jugador (fixture servida sin `tile`, compuerta en el borde de la red): entrada en el registro «No se pudo cargar la escena «puerto_tile»» + línea del juego + el desplegable vuelve a la anterior, **pero el mundo queda vacío**. Pre-existente. **H1** |
| Adversarial · `<select>` a la opción vacía | ✅ | `if (!value) return`: mundo igual, `errores 6 → 6`, ninguna línea. El desplegable se queda en «-- Room --» con Robledo puesto (captura `qa3-07`): pre-existente, H5 |
| **Crítica visual** | ✅ | `qa3-01/02/03` son, composición por composición, las `ojos3-01/02/03` del ingeniero (Robledo: casa de tejado rojo, dos árboles, pozo, «Guardia Roric» rotulado, «E · hablar con Alcaldesa Mirla»; Puerto: tres casas, «Muriel», caja amarilla, «E · hablar con Olmo»; Zorder: la casa con sus seis rótulos y el NPC delante). Luz única, escalas coherentes, rótulos legibles. Lo que NO es de este corte: H6 |
| **Batería completa** sin retocar guiones | ver §6 | — |

## 2 · Hallazgos

### H1 · importante · una fixture que LLEGA pero no es Format D válido deja el mundo vacío y el desplegable mintiendo — pre-existente (`loadSceneData` idéntico en `5510963a`); destino **issue nuevo**, no esta PR

**Repro** (desde el arranque, sin bridge): `NEFAN_PORT_OFFSET=500 ./start.sh --preset html-fixtures` →
`http://localhost:3500/?offset=500` → el muro rojo del arranque sin bridge, botón «Cerrar» → `<select>` Robledo
(se pinta) → que el JSON de `puerto_tile` llegue con contenido que no es Format D (en la sonda: `page.route` que
sirve `export default {"scene_id":"puerto_tile","entities":[]}`; en la vida real, una fixture mal escrita en
`data/scenes/`, que es justo el caso para el que existe `html-fixtures`) → `<select>` Puerto.

**Lo que ve el jugador** (captura `capturas-qa3/qa3-10-fixture-invalida.png` y la del guion 80): cielo y suelo
vacíos, ningún objeto, `#error-log` con «No se pudo cargar la escena «puerto_tile»» (con la causa entera:
«una escena necesita `tile` {tx,ty}…»), la línea del juego «⚠ No se pudo cargar la escena «puerto_tile»», y el
desplegable diciendo **`robledo_tile`** — la fixture que ya no está. `window.__nefan.scene = null`,
`fps().tiles = []`. Y no hay salida limpia: volver a elegir Robledo en el desplegable no dispara `change`
(la opción ya está seleccionada); hay que pasar por otra fixture.

**Por qué**: `loadSceneData` hace `resetWorld()` y DESPUÉS `await addTileRaw(rawData)`, y `formatDToWorld`
lanza dentro de `addTileRaw`. El `alFallar` de `paso()` (#269) devuelve el desplegable a `anterior` dando por
hecho que el mundo anterior sigue puesto — lo que es cierto solo en el caso del guion 24 (el módulo no llega y
`await sceneModules[key]()` rechaza ANTES de tocar el mundo). Lo esperado: el mundo que se veía sigue puesto
(normalizar antes de vaciar, o vaciar solo si la normalización cupo). Es un cambio de comportamiento, así que
no cabe en una PR que es un movimiento; el módulo nuevo es el sitio y el guion 80 (bloque 4, hoy rojo) es el
candado.

### H2 · menor · la batería de candados en negativo no corre en CI y envejeció cinco días sin avisar — destino **#486** (el issue que ya tiene el coordinador)

Medido para ese issue: (a) el candado roto desde `5ad19144` (2026-09-01) hasta `6f23a613`: la cadena de 6
espacios apareció 0 veces en `main.ts` durante cinco días; (b) el coste real de correrla: **68 s** para los tres
invariantes de #308 (tres corridas base + tres destrozos), no «minutos por invariante»; (c) la parte que envejece
—«el patrón aparece exactamente una vez en el fichero»— es una comprobación de texto que no necesita navegador,
así que cabe en `candados-headless` tal cual; (d) gotcha: la batería ESCRIBE en el árbol y su destrozo
(`void ultimaCargaDeFixture;`) dispara `html-sin-promesa-muda` — un `npm test` lanzado mientras corre sale rojo
por eso (me pasó); si la comprobación headless entra en CI, que no comparta árbol con la corrida.

### H3 · menor · con partida viva, mirar una fixture deja una entrada de error por cada NPC del sim que se mueve — pre-existente, fuera del corte; destino **issue nuevo** (no hay ninguno abierto sobre el NPC invisible del guion 50)

`e2e-sin-creditos`, partida nueva → `<select>` puerto: `#error-log` gana «el bridge mueve al NPC "barkeep" y el
cliente no lo tiene en escena: anda invisible (¿un spawn que no se rehidrató al reanudar?)», y otra al cambiar a
Robledo. El bridge suelta la atadura del save con `tomaElMundo` (guion 25 verde) pero el sim sigue emitiendo
`state_update.npcs` de la partida, y el cliente los busca en la fixture. El mensaje además sugiere una causa
falsa («¿un spawn que no se rehidrató?»). No lo toca este corte: `loadSceneFile` es el mismo.

### H4 · menor · `log: (msg) => log(msg)` en la construcción de la fábrica es una envoltura sin motivo — destino **esta PR** (opcional)

`main.ts:735-739`: `resetWorld` cruza como declaración hoisted y `log` también lo es (`function log(msg)`, `:782`);
la arrow no compra nada y rompe la simetría con `resetWorld`. Trivial.

### H5 · menor · elegir «-- Room --» deja el desplegable en blanco con el mundo puesto — pre-existente, sin issue si nadie lo quiere

`if (!value) return` es correcto (no hay nada que cargar), pero el desplegable se queda en la opción vacía
mientras Robledo sigue pintado (captura `qa3-07`). Un `sceneSelector.value = fixtureCargada` en esa rama lo
dejaría diciendo la verdad. Fuera del corte.

### H6 · menor · lo que se ve en las capturas y NO es de este corte

- En `qa3-02` (Puerto por `<select>` encima de Robledo, `html-fixtures`) las teclas 2-5 de la barra de ataques salen
  como cajas sin dígito; en `qa3-03`, un instante después, los dígitos vuelven. En `qa3-e2e-01` (tema
  `acuarela_luminosa`) las cinco salen sin dígito y la barra entera atenuada. Visto, no perseguido: la barra no
  la toca este corte (es el corte 7).
- El `#error-log` de `html-fixtures` sigue acumulando «el socket de la partida no abre» cada ~5 s de reintento
  (5 → 6 entradas durante la sonda): H6 de `qa-1`, fuera del programa.

### H7 · nota · mezclar `loadFixture` y `loadSceneRaw` sin esperar no respeta el orden de petición

`loadSceneRaw` vacía el mundo síncronamente; `loadFixture` lo vacía tras el `await` del import, así que la
fixture gana aunque se pidiera antes. Solo alcanzable desde el banco (dos verbos del hook), pre-existente, y
el resultado es coherente (UN tile, desplegable acorde). Sin destino; queda escrito para que nadie lo persiga.

## 3 · Crítica visual

Las tres fixtures se pintan como antes del corte y como en las capturas del ingeniero: una sola luz, sombras
coherentes, rótulos de NPC y edificios legibles sobre el clay, el prompt «E · hablar con…» centrado abajo, la
barra de vida y el desplegable arriba. Nada tapa nada salvo el `#error-log` en la esquina, que es el de siempre.
La captura que sí cuenta algo nuevo es `qa3-10`: el «mundo vacío con desplegable lleno» de H1, que un jugador del
preset leería como «se ha roto el render», no como «esa fixture está mal escrita».

## 4 · Workarounds usados durante la prueba

- **Ninguno en el camino del jugador.** El muro rojo del arranque sin bridge se cierra con su botón «Cerrar»
  (`#narrative-loader-dismiss`), que es lo que haría quien juega; medí antes que el `<select>` está encima del
  muro y es alcanzable con él puesto (`elementFromPoint` devuelve el propio `SELECT`), pero no lo usé así.
- **Compuerta en el borde de la red** (`page.route` sirviendo un módulo válido con contenido inválido, H1 y guion
  80 bloque 4): inyección de fallo en el borde, el mismo mecanismo de los guiones 24 y 44. El jugador tiene ese
  mismo obstáculo delante si una fixture de `data/scenes/` está mal escrita.
- `setPlayerPos` (hook) en la sonda para el bloque «misma fixture dos veces»; en el guion 80 el jugador ANDA con
  la tecla. No afecta al veredicto: lo que se afirma es la vuelta al spawn.
- Un falso rojo **de mi sonda, no del juego**, dicho para que nadie lo persiga: la primera pasada e2e mantenía
  `ArrowUp` (que es pitch, no movimiento) y «el muñeco no anda» expiró; con `w` anda 0,63 m. Igual que los dos
  falsos rojos que declara el ingeniero.

## 5 · No probado

- **Gasto real de créditos**: cero por diseño (`html-fixtures` sin backend, `e2e-sin-creditos` con el motor
  falso). El preset `play` no se arrancó.
- **La base `5510963a` en el navegador**: no se levantó. La equivalencia se apoya en el diff normalizado (§1,
  fila 1) y en que lo observado coincide con lo que afirman los guiones 01/24/25/44 escritos sobre la base.
- **El módulo sin `#room-selector` en el DOM**: `crearFixturesDelSelector` haría `null.addEventListener` al
  evaluar `main.ts`; la base hacía lo mismo en `:1056`. Sin cambio, sin probar.
- La reversión del desplegable cuando el JSON **no llega** (#269) la ejerce el guion 24 (verde en la batería),
  no la sonda.

## 6 · Guion nuevo — `qa/guiones/80-el-desplegable-room-dice-lo-que-se-ve.mjs`

Cuatro caminos del desplegable sin candado hasta hoy, con `sinMotor` declarado (preset `e2e-sin-creditos`):
(1) dos cargas encadenadas sin esperar → gana la última, UN tile, el desplegable la nombra; (2) la misma fixture
dos veces tras andar 0,4 m → resuelve, UN tile, el jugador vuelve al spawn, censo igual; (3) la opción vacía →
nada cambia, ningún error; (4) una fixture servida sin `tile` → entrada en el registro y línea del juego que la
nombran, desplegable de vuelta, **y el mundo que se veía sigue puesto**.

- **Positivo** (`node qa/run.mjs 80-el-desplegable`): 17 verdes y **1 rojo, el último aserto del bloque 4** —
  «…y el mundo que se veía SIGUE PUESTO — mundo «null» · tiles [] · el desplegable dice «zorder_test»». **Nace
  rojo a propósito** por H1, como nació el 25: el rojo describe lo que ve quien conduce el preset y se pone verde
  el día que se arregle. Si el coordinador prefiere que la batería quede en verde hasta entonces, el aserto
  puede pasar a `ctx.log` y volver con la PR del arreglo; yo lo dejo afirmando porque un guion que no puede
  ponerse rojo no vale nada, y el registro de la corrida dice exactamente qué falla.
- **Negativos** (destrozo → `qa/run.mjs 80` → restaurar; `git status` limpio tras los tres):
  `cargarFixture` fire-and-forget (`const carga = Promise.resolve()`) → rojo en el bloque 1 por la lib de
  fixtures («se pidió «robledo_tile» y el mundo se quedó en «null»»); sin `sceneSelector.value = anterior` →
  rojo «el desplegable vuelve a «zorder_test» — «puerto_tile»»; sin `if (!value) return` → rojo «…ni deja una
  entrada de error — 1 → 2». Cada destrozo enciende su bloque y ningún otro.
- Captura: `qa/capturas/<RUN>/80-…-01-fixture-rota-y-lo-que-queda.png`.

## 7 · Batería completa (`node qa/run.mjs`, sin retocar ningún guion)

`node qa/run.mjs` entero sobre `6f23a613` + el guion 80 (untracked), con el bloque 500 parado y después de la
batería de candados en negativo; el runner eligió su bloque y su preset `e2e-sin-creditos`:

```
78 en verde · 1 en rojo de 79 · capturas en qa/capturas/2026-09-06T16-32-21-094Z-192500
exit=1
```

- Los **78 guiones que ya existían están en verde sin retocar ninguno**, incluidos los once de la red del corte
  (01, 24, 25, 44, 58, 68, 69, 70, 71, 77, 78) y el 79 de la vuelta del corte 2. Ningún `⊘`.
- El **único rojo es el guion 80 nuevo**, en su último aserto y solo en él: «…y el mundo que se veía SIGUE
  PUESTO — mundo «null» · tiles [] · el desplegable dice «zorder_test»» — es H1, pre-existente, y el rojo está ahí
  a propósito (§6). Sobre el código de este corte la batería es 78/78.
- `ss -ltn` después: solo 22/53/80/631/3636. Ningún puerto del catálogo quedó arriba.

## 8 · Veredicto

**APTO CON HALLAZGOS.** El corte 3 hace lo que dice —mover, no cambiar— y lo demuestra: código idéntico salvo la
forma, comportamiento idéntico en todos los estados alcanzables, candado movido y probado en rojo por tres caras,
batería de candados resucitada de verdad, trinquete exacto y cero rastros. Lo que queda abierto no lo abrió el
corte: H1 (mundo vacío con desplegable lleno) es deuda pre-existente que ahora tiene módulo propio y guion rojo
con nombre; H2 es #486, con cifras; H3/H5/H6 son pre-existentes y menores; H4 es
una línea de forma. Nada de esto impide mergear el corte; H1 merece su PR encima del módulo nuevo, con el guion
80 como red.
