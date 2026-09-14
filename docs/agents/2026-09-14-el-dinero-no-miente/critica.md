# Tanda A «el dinero no miente» · crítica

**REENCUADRADA** — tres piezas vivas y una muerta. **#548 ya está hecho** (2026-09-10, commit `4338c5a5`, guion 123), y lo que queda de él es la pieza 1. La aritmética del atlas sigue mintiendo pero por **tres** causas, no dos, y la cifra 7,8× es una cota construida, no una medida: hoy, sobre los únicos datos Format D commiteados, mide **1,6× agregado y 3,1× en el peor fichero**.

| Pieza | Veredicto |
|---|---|
| 1 · El importe (#513 opción a) | **REENCUADRADA** — tres causas, no dos; y «exacto» solo es alcanzable en el atlas |
| 2 · #548 | **OBSOLETA** — (b) y (c) hechos el 2026-09-10; lo que queda ES la pieza 1 |
| 3 · Modo por defecto | **VIGENTE** — con una corrección: el defecto vive en **dos** sitios, no en uno |
| 4 · #552 | **VIGENTE**, y **EN CONFLICTO de orden** con la pieza 3 |

## El problema real, en una frase

La única pantalla del juego que gasta dinero real **no sabe contar páginas** (enseña un número que el servidor no puede producir), y la única puerta que abre una partida **nace gastando por omisión**, mientras la otra puerta de la misma decisión exige confirmación.

## La premisa, afirmación por afirmación

| Afirmación de `requisitos.md` | Verificación de hoy |
|---|---|
| El atlas cotiza `ceil(missing/12)×$0,15` | ✅ literal, `ui/style-apply.ts:296` con `:40` y `:42` |
| «cada ref de cara abre página propia» | ✅ `surface_atlas_generator.py:167-179`; su propio comentario lo dice |
| «hasta 7,8× de error» | ⚠️ **es una cota construida a mano, no una medida.** Medido hoy (port exacto de `pack_missing` sobre `data/scenes/*.json`): `puerto_tile` 11 celdas → cotizado $0,15 / real $0,47 = **3,1×**; `zorder_test` **2,1×**; `robledo_tile` **1,1×**; las tres juntas **1,6×**. El techo estructural REAL de una petición (64 celdas, cada una con ref propia) es $0,90 cotizado / **$10,88** cobrado = **12,1×** |
| «el bloque de skins cotiza el roster entero» | ✅ `ui/style-apply.ts:304` (`missing: skins.length`) y no puede hacer otra cosa: **no existe dry-run de skins** (`/skin_sprite_sheet` es la única ruta, `remote_generation.py:589-613`, y con `extra="forbid"`) |
| «~$2,9 por personaje» | ✅ aritmética viva: `skins.length × callsPerSkin × costPerImage`, con `callsPerSkin ≈ 17` del catálogo y $0,17/imagen |
| **TERCERA causa, que nadie ha nombrado** | ❌ falta en los issues: **`CELLS_PER_PAGE = 12` no es la capacidad real**. `N_ROWS=3` y `rowH=309` dan **3 celdas cuadradas por fila × 3 filas = 9** por página (`surface_atlas_generator.py:148,157-161`). Medido: 10 tiles → **2** páginas, no 1. El divisor está mal incluso sin refs y sin uniques |
| **CUARTA, y es la causa raíz** | ❌ **los dos empaquetadores han divergido.** `pack_missing` dice ser «port de `layoutAtlas`, mismas constantes», pero `nefan-core/src/scene/greybox/surfaces.ts:384-413` **no separa tiles de uniques en grupos ni agrupa por `ref`**: mete todo en un flujo continuo. Python abre grupo por ref y cobra `$0,17` (`gpt-image-2`) a la página sin tiles y `$0,15` (`nano-banana-pro`) a la que los tiene (`:433,454`, tabla en `meshy_client.py:364`). Por eso el cliente no puede acertar: su propio layout ya no es el del servidor |
| #548 «un fallo de navegación borra el Estilo aplicado» | ❌ **FALSO desde el 2026-09-10.** `plan-de-estilo.ts:118-168`: el gasto y la navegación ya no comparten `try`, el comprobante se queda, el botón no rearma y se explica. Candado en negativo: `qa/guiones/123-lo-que-ya-se-pago-no-se-vuelve-a-ofrecer.mjs`. El propio issue lo dice en un comentario («Reencuadrado y hecho a medias»): de #548 queda **un solo punto**, el «~$0.00 + ?» (`plan-de-estilo.ts:95`), y su sitio es la pieza 1 |
| Selector: Escenarios y Personajes en Imagen IA, un click sin confirmar | ✅ `titulo/selector-de-mundo.ts:210` (`= "image"`), `:217`, y los handlers `:227` y `:247` cambian sin armar nada |
| Home: dos clicks con «¿Confirmar? Gastará créditos» | ✅ `titulo/home.ts:333`, patrón *armed* con TTL |
| #552 «Volver» pierde mundo, estilo y los dos modos | ✅ vivo: `titulo/editor-de-personaje.ts:160` es `ir({ a: "selector" })` pelado; `selector-de-mundo.ts:131` cae a `games[0]` y `:210/:217` reinicia los modos a **image** |

**Dónde vive de verdad el defecto del modo (la pregunta 3).** En **dos** sitios, y cambiar uno solo no cumple el criterio:
1. **Un literal del cliente**: `selector-de-mundo.ts:210`.
2. **Un fallback en core/bridge**: `bridge/handlers/session.ts:376` → `const renderMode = msg.renderMode || "image"`. Cualquier `new_game` que no traiga modo (o lo traiga vacío) **nace gastando** aunque el cliente diga otra cosa. Éste es el que está bajo `la-logica-de-juego-no-vuelve-al-cliente`, y es el que decide de verdad.

El de personajes ya está bien: `msg.characterMode ?? ""` y `modoEfectivoDePersonajes` (`session.ts:385-388`). Y no hay un tercer sitio: el save guarda lo decidido, no un defecto.

## El día después

- **Para quien juega**: «Nueva partida» deja de gastar por omisión, y el importe deja de ser 2-3× bajo (atlas) y roster-entero alto (skins). Es el cambio más barato por dólar de esta cola.
- **Lo que se vuelve más difícil**: el criterio 1 («el importe es el que se cobra») empuja a **portar el empaquetador de páginas por tercera vez** al cliente. Es justo lo que ya salió mal: hay dos ports y han divergido en silencio. **Eso no debería hacerse.** Con los datos de hoy el atlas puede ser exacto restando `data.cells` de la petición (`remote-gen.ts:58-66` ya trae las resueltas), pero solo si el reparto en páginas lo dice **quien pinta**.
- **Los skins no pueden ser exactos hoy** y el criterio debe decirlo: sin dry-run, lo honesto es una **cota superior declarada**, no una cifra.
- **Lo que habría que borrar**: la prosa caduca de `ui/style-apply.ts:446` («los sprite sheets no pasan por el manifest — no se pinean»): desde #376 los pina el servidor bajo `character:{hero_key}` (`remote_generation.py:507+`). Y `CELLS_PER_PAGE`/`ATLAS_PAGE_EST_USD` si el reparto deja de calcularse aquí.
- **Lo que mantiene viva la tanda**: nada que se pueda tirar hoy.
- **Lo que parecerá arbitrario en un mes**: que `layoutAtlas` (TS) y `pack_missing` (Python) sigan diciendo ser el mismo algoritmo sin que nada lo compruebe.

## Conflictos

- **#552 ↔ pieza 3: chocan, y hay un orden.** Las dos aterrizan en `selector-de-mundo.ts:210-217` y en `DestinoDelTitulo` (`titulo/atomos.ts:105-119`), que hoy solo lleva `preselect?: string`. #552 exige que el selector **acepte** modos entrantes; la pieza 3 decide **qué valen cuando no entra ninguno**. Hacer #552 primero obliga a inventar ese valor y la pieza 3 lo reescribe. **Orden: pieza 3, luego #552.**
- **Pieza 1 ↔ #548: no chocan, son la misma.** Ambas viven en `style-apply.ts:296,304` y `plan-de-estilo.ts:95`. El punto vivo de #548 es la presentación de un coste desconocido, y solo se puede decidir sabiendo qué se va a cotizar.
- **Pieza 3 ↔ el banco: 79 guiones.** `qa/lib/sesion.mjs:351` (`nuevaPartida`) fija `charMode` explícitamente pero **nunca toca `rendermode`**: hoy los 79 corren en **image** por omisión. Con la pieza 3 pasan a **vector** en silencio. Los que afirman conducta de escenario en imagen sin fijar el modo se quedan verdes **sin medir nada** — la enfermedad que este repo ya tiene fichada. Solo `88-el-atlas-y-el-fusible-no-pagan-dos-veces.mjs` pulsa `image` explícitamente. El resto de guiones que pulsan `vector` no se rompe (el click pasa a ser idempotente).
- **Pieza 1 ↔ guion 97.** `97-el-coste-que-promete-el-boton-es-el-de-las-casillas.mjs` afirma el formato de HOY («+ ?», «Registrar (sin coste)»). Cambiar la cotización lo cambia; está anticipado en el comentario de #548.
- **#543 (abierto): las dos piezas de UI no se pueden probar fuera del navegador.** `titulo/atomos.ts` llama a `serviceUrl` al cargar y eso lee `location.search`, así que ninguna hoja del título se importa en Node. Piezas 3 y 4 solo se verifican con batería. No es bloqueo, es coste.
- **#514: su censo sigue siendo de cuatro ficheros.** Elegir la opción (a) de #513 deja `style-apply.ts` en el grafo del cliente, así que `style-application-schema.ts` no sale. Sin conflicto, pero que nadie lo dé por bajado a tres.
- Sin choque con `CLAUDE.md`, con `arch-rules.json` ni con ninguna otra tarea abierta.

## Coste contra valor

**No hacer nada** cuesta: un jugador que acepta $0,15 y paga $0,47 (medido) o, en el peor reparto de una petición, $10,88; un botón que le pide $2,9 por personaje por algo que ya está en caché y costaría $0; y una partida nueva que gasta sin que nadie se lo haya preguntado. Las tres piezas vivas son **baratas**: dos literales y un argumento. Lo que NO es barato —y no hace falta— es volver a portar el empaquetador. La pieza 3 es la de mayor valor por línea de todo el backlog: es lo único que hay entre «Nueva partida» y la factura.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

> **§2 «#548» se borra entero.** Hecho el 2026-09-10 (`4338c5a5`, guion 123, comentario en el issue). Lo único vivo de #548 es el «~$0.00 + ?» del botón cuando un bloque no tiene precio, y es parte de §1.
>
> **§1 se corrige**: el error del atlas tiene **tres** causas, no una — (a) `CELLS_PER_PAGE = 12` cuando la capacidad geométrica real es **9** celdas cuadradas por página; (b) cada ref de cara abre grupo propio; (c) las páginas sin tiles se cobran a **$0,17** (`gpt-image-2`), no a $0,15. La raíz de las tres es que `layoutAtlas` (TS) y `pack_missing` (Python) **han divergido** pese a declararse el mismo port. **Medido hoy sobre `data/scenes/*.json`: 1,6× agregado, 3,1× el peor fichero; techo estructural de una petición de 64 celdas: 12,1× ($0,90 → $10,88).** La cifra 7,8× del 2026-09-10 era una cota construida y no debe citarse como medida.
>
> **Criterio de aceptación 1, reescrito**: «el importe del **atlas** es el que se cobra; el de los **skins** es una **cota superior declarada como tal**, porque remote-gen no tiene dry-run de skins (`extra="forbid"` en `SkinSpriteSheetRequest`) y ninguna cifra exacta es alcanzable sin cambiar su contrato». **Fuera de alcance explícito: un tercer port del empaquetador de páginas en el cliente.**
>
> **§3 se corrige**: el defecto vive en **dos** sitios — `titulo/selector-de-mundo.ts:210` y `bridge/handlers/session.ts:376` (`msg.renderMode || "image"`). Cambiar solo el cliente deja abierta la puerta del wire. **Y añade al alcance**: `qa/lib/sesion.mjs` (`nuevaPartida` no fija `rendermode`; 79 guiones cambian de modo implícito y los que miden conducta de imagen hay que fijarlos, o salen verdes sin medir).
>
> **§4 gana un orden**: #552 va **después** de §3, porque su arreglo necesita saber a qué modos vuelve el selector, y ambas tocan `selector-de-mundo.ts:210-217` y `DestinoDelTitulo` (`atomos.ts:105-119`, que hoy solo lleva `preselect`).
>
> **Aviso de verificación**: por #543 ninguna hoja del título se importa en Node; §3 y §4 solo se afirman con batería de navegador.
