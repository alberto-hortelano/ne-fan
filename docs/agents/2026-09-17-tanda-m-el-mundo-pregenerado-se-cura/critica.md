# Crítica — Tanda M «El mundo pre-generado se cura»

**#577 REENCUADRADA · #578 REENCUADRADA · #463 VIGENTE con el alcance recortado**

Verificado sobre `tanda-m/mundo` (= `main` `81735f13`) leyendo el código y midiendo en frío: cero créditos, cero servicios arrancados, ningún navegador.

## El problema real, uno por issue

- **#577** — Un mundo pre-generado deja de amortizar justo en los tiles que la carga criba, y el único remedio de hoy («↻ Regenerar mundo») cuesta nueve llamadas **y repaga el arte aplicado** (`game-gen.ts:212` + `invalidateStyleApplications`, `game-gen.ts:107-135`).
- **#578** — No es que un `place_id` cuelgue: es que **conservar solo ocurre cuando el CENTRO se sustituye**, y nadie comprueba que el anillo encaje con el centro nuevo, ni por lugares ni por costuras.
- **#463** — En el MISMO handler, `/entity/foo` sin partida contesta 404 y `/entity/player` inventa un jugador (`bridge/state-http/entity-routes.ts:31-34` → `DEFAULT_PLAYER`, `narrative-state.ts:103-118`: nivel 1, pícaro, 100 de vida). Es la única lectura del State API que **fabrica** contenido en vez de devolver un vacío honesto.

## La premisa, afirmación por afirmación

**#577**

1. «Los dos únicos llamantes de `writeSessionSnapshot`» — **CIERTO**: `bootstrap-tile.ts:121` y `game-gen.ts:212`; el grep no da un tercero.
2. «Hoy es la foto de la génesis y **no está escrito en ningún sitio**» — **FALSO**: lo dice la primera línea del módulo dueño (`src/games/world-snapshot.ts:1-2`) y lo repite `PoliticaDeSnapshot` (`bridge/context.ts:151-160`). La decisión 1 del issue ya está tomada y escrita.
3. «Curar solo lo cribado exige recordar qué tiles se cribaron, **estado nuevo en la sesión**» — **MEDIA VERDAD, y corrige a MENOS**: la lista ya se calcula y se tira. `cargarConDetalle` devuelve `cribadas` (`world-snapshot.ts:245-247`); su único llamante desestructura `{snapshot, servibles, total}` (`:369`) y `start_session` entra por `loadWorldSnapshot`, que la descarta (`:148`). Lo nuevo es llevarla a la sesión: un campo, no un mecanismo.
4. «Nada en pantalla lo delata» — **FALSO desde su propia PR**: el chip dice «(8 de 9 escenas; el resto se generará al llegar)», `panel-de-generacion.ts:118-123`.
5. **Las dos salidas «evidentes» del enunciado no resuelven #577.** En el momento de la carga no existe ningún tile válido con el que curar: el único que hay es el roto. Escribir al servir o al cribar solo puede BORRAR la escena cribada — ahorra **cero** llamadas y encima apaga el aviso, porque `gameGenerationStatus` pasaría de 8/9 a 8/8 «✓ generado». El único instante en que existe un tile bueno es después de `generateTileScene` (`tile.ts:98-160`): dentro de una partida, o de un job de génesis.

**#578**

6. «El aviso ya está» y «el panel sale vacío» — **CIERTOS**: `context.ts:210-228` con `escenasSinLugarEnElMapa` (`world-snapshot.ts:296-320`); `getOutgoingLinks` de un lugar inexistente devuelve `[]` (`world-map.ts:243-247`) y `narrative-state.ts:793-800` se salta `attachRealizedScene`, `markVisited` y `setActivePlace` bajo un `if` mudo.
7. «Los dos tocarían al tercer escritor» — **FALSO como dependencia, y es la respuesta a la pregunta 2**. #578 vive en la rama `conserva` del escritor que YA existe; #577 necesita un disparo que no existe. Disparos distintos (entrada mala vs anillo malo), ramas distintas, cualquiera se entrega solo. Y en el camino de #577 el mapa vivo **es** el del snapshot (`session.ts:552-560`, `replayWorldSnapshot`), así que allí `escenasSinLugarEnElMapa` devuelve `[]`: un tercer escritor **no crea ni un caso nuevo** de #578. No los juntéis «porque comparten la pieza»: no la comparten.
8. Lo que el issue no dice y cambia su tamaño: **`conserva-el-mundo-en-disco` tiene un solo caso vivo**. Su único llamante es `runBootstrapTile`, y sin fichero o con el fichero stale `escenasQueSobreviven` devuelve `{}` (`world-snapshot.ts:268-286`). Hay escenas conservadas ⟺ la ENTRADA no pasó el validador. La opción 3 del issue deja esa política **sin ningún caso**.
9. Al cargar, lo conservado se valida con `required_crossings: []` (`world-snapshot.ts:192,208`): nadie comprueba que las costuras del anillo casen con el centro nuevo. El `place_id` colgando es el síntoma visible de un encaje que no mide nadie.

**#463** (el triaje del 2026-09-10 ya lo dio VIGENTE; sigue vivo, y añado quién lee el 200)

10. Código de hoy confirmado: `getEntity` contesta `ok(...)` para `"player"` sin mirar la sesión.
11. **Quién lee el 200 sin partida**: (a) las tools MCP (`narrative-mcp/server.ts:922-930`), que reciben el error por `reportBridge` — justo lo que se quiere; (b) el cliente, que **no habla** con el State API; (c) el banco: `qa/el-state-api-no-muta-sin-partida.mjs:310` afirma solo `status !== 409` (un 404 pasa), pero **`:314-315` afirma `200` + `inventory.length === 0`** sobre `GET /entity/player/inventory` sin partida, y es un candado del job `candados-headless`.
12. Así que el riesgo está en UNA frase del issue, «aplicarla a todas las lecturas que dependen de la sesión»: tumba ese aserto y le quita **la forma de probar** que las 12 mutadoras rebotadas no aplicaron nada.

## El día después

- Con #577 acotado, el chip pasa de «8 de 9» a «✓ generado» solo y la segunda partida ya no paga ese tile. **Lo que se cierra**: el snapshot deja de ser byte a byte lo que salió de la génesis, y el peaje real no es el del enunciado — `generateTileScene` viaja con `story_so_far` (`serialize-llm.ts:59`) mientras la génesis corre en sesión efímera y sin historia, así que el tile curado entra improvisado **dentro de la partida de alguien**. A cambio sobrescribe un hueco que ninguna partida puede servir: el «modifica el mundo de las demás» vale **cero sobre lo observable**, y el fichero está gitignorado (`.gitignore:81`) — es de una máquina y un jugador, no se comparte con nadie.
- La forma NO acotada (escribir cada tile visitado) es otra funcionalidad —caché de mundo entre partidas, sin tope de tamaño— que nadie ha pedido. Que no entre de rebote.
- Con #578 por la vía 1, **el panel sigue vacío**: de las cuatro opciones solo la 2 y la 4 devuelven salidas, y el título del issue promete más de lo que su primera opción da. Si se elige la 3, se puede borrar entera `PoliticaDeSnapshot` y su rama.

## Conflictos

- **Guion 127, E4** (`:341-372`): afirma la conducta de HOY. Si #577 se cura dentro de la partida se invierte a `[1,0,0]` y **necesita control nuevo**, o no distingue una regla de su contraria: un tile cribado que NADIE visita debe seguir cribado en el fichero (si no, «cura lo visitado» y «cura todo» dan el mismo verde) y las otras ocho escenas deben salir idénticas. Si la cura se pide desde el título, E4 no se toca y el bloque nuevo es otro.
- **Guion 127, E5** (`:390-435`): #577 no lo mueve. Con la vía 1 de #578, `colgando` pasa a `[]` y el aserto `colgando.length === 0 || dicho.length > 0` **se vuelve verde tautológico** — candado sin sujeto vivo. Hay que reescribirlo para afirmar que el `place_id` se retiró y que el escritor lo dijo.
- **#656 bloquea usar E4 como prueba**: mide con 90 s de reloj de pared (`:134-141`) y sale 2 de 3 en rojo con el disco lleno, así que el ingeniero no podrá distinguir «mi cura no funciona» de «la espera expiró». O #656 entra en la tanda, o #577 se demuestra por otro sitio. No lo reclama ninguna otra tanda de hoy.
- Tandas paralelas: J toca los guiones 120/118/119/128; N, el 82, el 75 y `esperarFrames` (que el 127 no usa). **Ningún solape de fichero.**

## Coste contra valor

- **#577** vale, pero no es un incendio: hoy **no hay ni un mundo pre-generado en esta máquina** (`data/games/*/world/` solo tiene `styles/`, y el fichero está gitignorado). La factura corre para quien pulsó «Generar mundo» y después endureció el validador. No hacer nada es sobrevivible: el chip lo dice y regenerar existe, aunque cueste nueve llamadas y el arte.
- **#578**: valor bajo, riesgo de decidir mal alto. Ocurre solo en el único caso vivo de `conserva`, ya se avisa por log, y tres de las cuatro opciones no devuelven las salidas. Lo barato y honesto es la 1; la 2 exige antes medir las costuras, que hoy no mide nadie.
- **#463**: barato, observable y sin decisión pendiente. El daño es que el motor narre «tienes 100 de vida y 0 de oro» de un personaje que no existe.

## Qué cambiarle a `requisitos.md`, frase a frase

- Sustituir «Escribir el snapshot al servirlo tiene el riesgo evidente… una partida modifica el mundo pre-generado de todas las demás» por: «**Ninguna de las dos salidas evidentes resuelve #577**: al cargar no existe todavía ningún tile válido con el que curar, así que lo único escribible es borrar el cribado — cero llamadas ahorradas y el chip pasa de «8 de 9» a «✓ generado», perdiendo el único aviso. La decisión real es si una partida puede rellenar los huecos que la propia carga declaró (`cribadas`), sabiendo que el tile curado se genera **dentro de una historia** y la génesis corre sin ninguna.»
- Sustituir «¿#578 es el mismo arreglo o es otro?» y su párrafo por: «**No comparten pieza y se entregan por separado** (el mapa vivo del camino de #577 es el del propio snapshot, así que un tercer escritor no crea ni un caso de #578). Lo de #578 es más grande que un `place_id`: `conserva-el-mundo-en-disco` **solo tiene un caso vivo** —la entrada rechazada— y la pregunta es qué significa conservar un anillo alrededor de un centro sustituido cuyas costuras nadie vuelve a validar.»
- Sustituir «Cuidado: “devolver 404 en las dos” parece obvio y puede romper a quien hoy lee el 200» por: «El 404 en `/entity/player` **no rompe a nadie**: las tools MCP lo reportan al motor y el cliente no habla con el State API. Lo que sí rompe es «aplicarla a todas las lecturas»: `qa/el-state-api-no-muta-sin-partida.mjs:314-315` afirma `200` + inventario vacío sin partida y es un candado de CI. **Alcance: las lecturas que INVENTAN contenido, que hoy es una.**»
- Añadir a las restricciones: «**E4 del guion 127 no puede ser la prueba de #577 mientras viva #656.** O #656 entra en la tanda, o la prueba va por otro sitio y E4 se reescribe sin que su verde sea la evidencia. Y si #578 se arregla por la vía 1, el aserto E5b queda verde tautológico: se reescribe, no se deja verde.»
