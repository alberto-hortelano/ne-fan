# REENCUADRADA

El problema sigue vivo, pero **el mapa que el issue da para resolverlo está muerto** («los 40 `let` son el mapa de qué módulos faltan») y la aceptación no tiene cifra. Medido sobre `3d8252c`: de los 23 `let`, **12 los escribe y lee un solo grupo** (`lastTime`, `lastRenderError`, `mundoPintadoDe`, `dialogoDeSesion`, `fixtureCargada`, `ultimaCargaDeFixture`, `loaderStartedAt`, `loaderTicker`, `motivoDelUltimoMuro`, `tituloEnMarcha`, `muroPuestoPorAviso`, `ratonCapturadoAntesDelDialogo`) — no señalan ningún módulo que falte, señalan módulos que ya están hechos por dentro y solo falta cortar. El mapa real es el grafo de colaboradores (script en el scratchpad, `grafo.cjs`/`grupos.cjs`), y ese grafo dice que hay **siete cortes con frontera ≤ 5 símbolos** y tres bloques que no se cortan nunca.

## El problema real, en una frase

Cada segunda PR del repo paga el diff mental de `main.ts` — **72 commits en 41 PR en 30 días (19,7 % de 365), +3.125/−3.042; desde T3, 10 PR en 5 días** — y el fichero es el punto de choque natural entre tandas paralelas. **No** es un problema de estado compartido: cero `qa.md`/`critica.md` de septiembre atribuye un bug o un conflicto de merge a los `let` (grep hecho; el único rebase con roce documentado, `implementacion-335.md:190`, fue en core y sin conflictos). El coste es de lectura y de colisión, no de corrección.

## La premisa, afirmación por afirmación

- 2.371 líneas · 23 `let` · 41 funciones top-level: ✓. **1.368 son código; 857 (36 %) comentario**: la bajada posible es menor de lo que el `wc -l` sugiere.
- «Concentra game loop, carga de tiles, colisión, diálogo, viaje, HUD, arranque, título y bootstrap»: **4 de 9 caducadas**. Carga de tiles salió (`world/carga-de-tile.ts`, 391; en `main.ts` queda `cargaDeTile`, 14 líneas, `:788`); colisión es un `const` de 5 líneas sobre `CollisionSystem` importado (`:850`); el título vive en `ui/title-screen.ts` (1.732) y aquí solo quedan `runTitleFlow`/`unIntentoDeArrancar` (164); viaje es `frontera` (17 líneas, `:572`) sobre `frontera-del-jugador.ts`.
- «No se creó `game-loop.ts` por ~35 colaboradores»: **sigue cierto, re-medido: 34 símbolos de fuera, 5 de ellos `let` ajenos** (`gameClient`, `input`, `baseSheetsLoaded`, `playerModel`, `playerSkinPrompt`). El «objeto de treinta campos» del §4.2 era 30; hoy sería 34.
- `#306` puso el suscriptor de avisos aquí (`:1594-1620`): ✓, y **es exactamente el estado que #469 necesita tocar** (`muroPuestoPorAviso` + `errors.onAviso` → `setLoaderState` en cada `errors.push("bridge")` del reintento, `bridge-client.ts:147`).
- Cliente sin CRAP ni mutación (`mutation-targets.json:488` solo en prosa; #241 abierto): ✓. La red de cada corte son los guiones de navegador, y **solo 2 de 75 citan `main.ts:NNN`** (58 y 53, por línea); los otros 17 lo nombran en prosa. Mover código no rompe guiones.
- `GameStore`/`dispatch()`: vive en **core** (`src/store/game-store.ts`, 113 líneas; `player/enemies/world/meta`), lo consumen bridge y sim; el cliente lo instancia dentro de `net/game-client.ts:232,247` y **`main.ts` no lo toca ni una vez**. Ninguno de los 23 `let` es estado de juego: son DOM, cronómetros, modos de render y flags de flujo. Meterlos ahí es la bolsa de treinta campos con otro nombre. **Respuesta a la pregunta 2: no.**

## El grafo, por grupo (líneas de sentencia · `let` propios · símbolos que necesita de fuera · qué expone)

| Grupo | L | `let` | Necesita | Expone | Red (guiones) |
|---|---|---|---|---|---|
| **Loader/muro** `:1721-1818` + aviso `:1594-1620` | 80+31 | 3+1 | **1** (`volverAlTitulo`, callback) +3 (`titleScreen`, `graphicsChip`, → propias) | `showLoader`, `hideLoader`, `setLoaderState`, `updateLoaderProgress`, `motivoDelUltimoMuro` | 16 de loader/muro, 69, 70, 71, `fixtures-sin-bridge.mjs` |
| **Etiquetas del mundo** `:1154-1281` | 102 | 0 | 4 (`fpsRenderer`, `dialoguePanel`, `mundo`, `playerPos`) | `updateWorldLabels` ← bucle | 61, 10, 37 |
| **Fixtures/selector** `:720-757, 888-912, 1071-1104` | 105 | 2 | 3 (`log`, `resetWorld`, `addTileRaw`) | 2 al seam | 01, 24, 25, 44, `fixtures-sin-bridge` |
| **Spawn** `materializeSpawn :1944` | 101 | 0 | 5 (`gameClient` vía getter ya existente `:798`) | 1 | 48, 49, 66, 67 |
| **Personaje/skins** `:101-230` | 85 | 3 | 5 | 3 `let` leídos por el bucle → lectores | 07, 13, 21, 47, 53 |
| **Diálogo** `:995-1062, 1686-1711` | 67 | 1 | 4 | 5 (`dialoguePanel` lo leen 5) | 37, 43, 41 |
| **HUD combate** `:635-664, 953-974` | 44 | 2 | 4 (incluye `input`) | 6 | 03, 41, 22, 23 |
| Modos + menú dev `:374-478, 1513-1590` | 148 | 4 | 10-11 cada mitad, enredadas entre sí | 3 | 53, 12 |
| Eventos del motor `:1820-1943, 2046-2121` | 179 | 0 | **20** | 0 | — es pegamento |
| Arranque `:2128-2370` | 256 | 2 | **19** | 1 | — es pegamento |
| Bucle `:1283-1486` | 204 | 2 | **34** | 0 | — es pegamento |
| Seam del banco `:1657` | 28 | 0 | 26 | 0 | raíz de composición por diseño |

Los tres bloques grandes no tienen `let` cruzados que arreglar ni API que exponer: **son la raíz de composición** y reclamarles un módulo propio es fabricar la bolsa. Con los siete cortes de arriba y sus comentarios salen ~850-950 líneas y `main.ts` queda en **≈ 1.450-1.550 con ≤ 6 `let`**: el tope 450 **no se alcanza sin el objeto de 34 campos**. La opción (a) de la pregunta 5 no es honesta.

## El día después

Para quien juega no cambia nada, y la tarea es deuda declarada: correcto. Se cierra una puerta a propósito: los tres bloques grandes se quedan, y hay que escribirlo en la excepción para que nadie abra «#358 bis». Lo que se borra y nadie borrará: `muroPuestoPorAviso` y el hueco que #469 describe se arreglan **dentro** del módulo del loader — si el corte va después de #469, se paga dos veces. Lo arbitrario dentro de un mes: siete ficheros nuevos de 44-111 líneas con nombres en español junto a `carga-de-tile.ts` — ese es el patrón de la casa (`DepsDeCargaDeTile` + fábrica, `carga-de-tile.ts:69-139`; getter `() => gameClient`, `main.ts:798`) y no hace falta inventar otro. No aparece concentración (ninguno se acerca a 430) ni toca el CSS: **pregunta 6, basta la revisión y el `porque` del JSON.**

## Conflictos

- **#469** (bug, sin tanda): su estado y su suscriptor viven en el corte 1. **Dependencia oculta**: corte 1 antes que #469, en PR separada (mecánico primero, arreglo después sobre el módulo con su guion).
- **#346** (`title-screen.ts`): la frontera `main`↔título son `titleScreen.onVisibilityChange/avisar/retirarAvisos` (corte 1) y `show/hide` en `unIntentoDeArrancar` (se queda). Ningún corte mueve cosa que #346 deshaga; **orden libre**. **#427** (tres huecos del título sin dueño) se beneficia: el módulo del loader es el dueño con nombre del muro.
- **Regla `solo-el-bridge-normaliza-la-escena`** (`arch-rules.json:406-419`): la excepción nombra `nefan-html/src/main.ts` + `addTileRaw`. El corte 3 (fixtures) **obliga a reescribir el `path` de la excepción en el mismo commit** — se toca un candado, no un umbral; hay que decirlo en la PR.
- **Regla `el-mundo-del-cliente-tiene-un-solo-dueño`** (`:785-797`): ningún corte resucita esos `let`. ✓
- **#241**: no se monta harness (decisión 08-27). Lógica que aparezca al cortar → core, anotada, como manda `requisitos.md`.
- #224, #388, #356, #293 (resto de programas): no tocan `main.ts`.

## Coste contra valor

«No hacer nada» es defendible: el trinquete ya funciona (+45 líneas en 5 días, todas con motivo en el JSON) y no hay bug que esto evite. Lo que compra cada corte es que **una tanda que toque el loader, las etiquetas o las fixtures no toque `main.ts`**: con 10 PR/5 días sobre el fichero, eso es menos superficie de choque para los ingenieros en paralelo. Por eso el programa vale **solo los cortes con frontera ≤ 5**, cada uno una PR mecánica de 100-200 líneas movidas, y **para al llegar a la raíz de composición**. Perseguir el 450 costaría el objeto de contexto y no compraría nada más.

## Respuestas y encuadre nuevo (para pegar en `requisitos.md`)

1. **Vigente a medias**: el problema es churn y colisión (cifras arriba), no estado compartido ni tamaño por sí mismo. La mitad «troceado por responsabilidad» se reencuadra como «los siete cortes con frontera medida ≤ 5».
2. **Objeto de contexto: no hace falta.** 12/23 `let` ya son privados de un grupo; cada corte limpio necesita 1-5 dependencias por fábrica (`Deps…`), el patrón de T3. `GameStore` es estado de juego en core y `main.ts` no lo toca: no es sitio para DOM ni cronómetros.
3. **Orden de cortes** (por frontera, no por longitud): **1 · Loader+aviso** (111 L, 4 `let` propios, 1 dependencia; deja a #469 su módulo) → **2 · Etiquetas** (102, 0 `let`, 4) → **3 · Fixtures/selector** (105, 2, 3; reescribe la excepción de `arch-rules`) → **4 · Spawn** (101, 0, 5) → **5 · Personaje** (85, 3, 5; los 3 `let` pasan a lectores del bucle) → **6 · Diálogo** (67, 1, 4) → **7 · HUD de combate** (44, 2, 4). Modos+menú dev (148, 10-11 deps) solo si tras los siete se ve frontera; bucle, arranque, eventos del motor y seam **no se cortan**. **Primera PR: el loader**, con `client-file-size.json` ≈ 2.260 en el mismo commit y `qa/run.mjs 69 70 71` + `fixtures-sin-bridge.mjs` como red.
4. **#346**: sin conflicto, orden libre; #427 gana un dueño con el corte 1.
5. **Criterio de cierre de #358, en cifras (propuesta nueva, ni (a) ni (b) tal cual)**: `grep -c '^let ' main.ts` **≤ 6** (los de la raíz: `lastTime`, `lastRenderError`, `gameClient`, `tituloEnMarcha`, `input`, +1 de holgura) **y** `wc -l` **≤ 1.550**, con la excepción del JSON reescrita: «raíz de composición: cableado, bucle, arranque y suscripciones al motor; no se trocea más sin un objeto de contexto que se ha rechazado dos veces (T3 §4.2, esta crítica)». La (a) es inalcanzable sin la bolsa; la (b) «una responsabilidad» es falsa: quedan tres, y hay que nombrarlas.
6. Sin candado nuevo: ningún resultante pasa de 111 líneas; el CSS sigue fuera del régimen y no lo toca este programa.

## Decisiones para el usuario

- **A. Alcance**: (1) los siete cortes y cerrar #358 con el criterio del punto 5 — *recomendada*; (2) solo los cortes 1-4 (los de ≤ 5 deps y 0-2 `let`) y cerrar igual; (3) no cortar, cerrar #358 como «candado hecho, resto sin problema medido». La 3 es honesta pero deja a #469 arreglándose dentro de un fichero de 2.371.
- **B. #469**: PR propia justo después del corte 1 sobre el módulo nuevo — *recomendada* —, o dentro del corte 1 (mezcla mecánico con arreglo; rompe el «uno por vez»).
