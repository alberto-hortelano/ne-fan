# REENCUADRADA

El problema es real y la decisión del 27-08 (censar y mover, sin harness) es la buena, pero **el encuadre «todo lo que sea lógica de juego» no tiene cifra y mezcla dos cosas distintas**. Medido fichero a fichero sobre `d84a9238` (= `12aedd53` + el commit de requisitos): de 14.466 líneas del cliente, **≈ 860 líneas de código son decisión sin DOM**, y solo **≈ 555 son regla de juego estricta** (cambia lo que PASA: gasto, colisión, arma, validez de un enemigo). Las otras ≈ 290 son presentación derivada del sim (qué clip se anima, qué rótulo se ve, qué aviso cabe) y **no deberían moverse**: sería llevar a core cómo pinta este cliente. Y la premisa del issue tiene tres correcciones: la fórmula del daño que cita **ya no está** en `fps-gl.ts` (1.687 líneas, cero lógica: importa `attackAreaQuality/Margin/Reach` de core, `:30-34,:532,:1006`); la pieza más grande y la única que decide GASTO (`world/frontier.ts`, ≈ 165 líneas) **no tiene issue** y su vecino jura que «su decisión ya está en core, en el manager» (`frontera-del-jugador.ts:14`) — falso, el manager es `frontier.ts` en el cliente; y #508 es **mayor** de lo que dice: la regla «`""` sigue a escenarios» vive en `render-mode.ts:38-40` de core Y en tres sitios del cliente (`modos-de-graficos.ts:110`, `title-screen.ts:724`, `:1623`).

## El problema real, en una frase

Hay ≈ 555 líneas de regla de juego que solo existen en el proceso que no se mide, y dos de ellas ya han mordido (#390, atlas; #489, spawns no sólidos) y una ya diverge en silencio (la preselección de estilo: `title-screen.ts:905-908` exige compatibilidad al estilo del mundo, `bridge/handlers/session.ts:193-195` no).

## Censo (líneas de CÓDIGO de decisión, no comentarios; «core» = si ya existe la función)

| Grupo · fichero | L | Regla | Core ya | Pura | Clase |
|---|---|---|---|---|---|
| **world/frontier.ts** | 165 | proponer vecino a 16 m, velo 8, blocking 2, timeout 5 min, cooldown 15 s (`:14-27,:60-223`) | no (solo `neighborTile`) | sí, inyectando `now` (`:221`) | **estricta, gasto** |
| world/collision.ts | 45 | frontera direccional «salir sí, entrar no» + AABB del esquema saltados por `svgApplied` (`:55-67,:72-97`) | parcial: `blocksMove` sí; `sim-collision.ts:18` declara estas dos «divergencia intencional, del cliente» | sí | estricta (#489 mitad 2) |
| scene/enemigo.ts | 55 | qué bloque `combat` es válido y con qué motivo se rechaza (`:58-105`) | tipado sí (`combat/hostiles.ts:22`), parser no; `personality` se valida en 3 sitios | sí (→ `Result`) | estricta |
| main.ts | 40 | `ARCADE_SPEED_SCALE=2.2` (`:71`), `playerMaxHp` (`:246`), `playerWeaponId` (`:281`), punto de respawn (`:534-551`), `INTERACT_RANGE_M` (`:580`) | `walk_speed` en `combat_config`; `respawn(pos)` recibe la pos que el cliente eligió | sí | estricta |
| scene/fps-atlas.ts | 30 | misma clave se deduplica/re-encola, clave nueva supera al run (`:52-60,:80-107,:131-133,:185,:211`) | no | sí (`pedir`/`terminar`) | estricta, gasto |
| ui/modos-de-graficos.ts (+título ×2) | 25+7 | tres gates de gasto + normalización (`:99-122`); `title-screen.ts:724,:845-861,:1623` | **sí**, `render-mode.ts:32-40` (la regla, no el predicado) | sí (toggles como argumento) | estricta, gasto (#508) |
| renderer/character-sprites.ts (fusible) | 25 | 3 personajes con 5xx apagan skins de la sesión (`:206-212,:297-308`) | no | sí | estricta, gasto |
| ui/hablar-con-un-npc.ts | 20 | guard de 30 s hasta que el motor contesta (`:23,:58-68`) | no: el bridge no dedupe `interact_entity` en vuelo | sí | estricta |
| ui/hud-de-combate.ts | 18 | arma del aro (`:88`) y `displayRange/2` sintético (`:98-107`) | `getEffectiveParams` sí; `weapon_changed` (`reducers.ts:92`) sin productor; el wire no trae el arma | sí | estricta (#504) |
| world/materializar-spawn.ts | 12 | `radius 8/5`, `sizeXZ {4,4}/{1.4,1.4}` (`:134-143`), `radius:7` (`:117`) | la huella del tile la da `formatDToWorld`; el spawn no pasa por ahí | sí | estricta (#489 mitad 1) |
| ui/title-screen.ts (resto) | 30 | `draft.length < 20` (`:1381` = `session.ts:159`), preselección de estilo (`:905`), validación del pack (`:1228-1268`, hoy solo en Python `styles.py:49-159`), `STYLE_REF_FOLDERS` repetido (`:74-78`), total del plan (`:1106`) | bridge/Python/core a trozos | sí | estricta, **duplicados** |
| ui/style-apply.ts | 83 (de 531) | dedupe de celdas, roster de skins, estimación (`:138-322`); `CELLS_PER_PAGE=12` = `surface_atlas_generator.py:37`, `0.15` solo aquí | piezas sí, composición no | sí | **proceso**, no función (ver D) |
| net/game-client.ts `:175` | — | `weaponId:"short_sword"` | — | — | **muerta** (QA #504): se borra |
| **Subtotal estricta** | **≈ 555** | | | | |
| ui/error-log.ts | 80 | gravedad/uno por titular/tope 3 (`:72-138`, 25 puras) + dedupe por trío, `resuelto`, cola, microtarea (`:172-296`) | no; precedente de texto de producto en core: `status-rotulo`/`status-motivo` | sí | blanda |
| ui/etiquetas-del-mundo.ts | 45 | candidatos apuntables, 12 m/9°/elipsoide, rótulo a 18 m | `pickAimTarget` sí, constantes no | sí | blanda |
| renderer/character-sprites (anim) · sprite-renderer · animacion-de-entidades | 45+15+12 | prioridad muerte>one-shot>ataque>locomoción; loops; «se mueve» 0,02 m/150 ms | lista de anims sí, sin loop-flag | sí | blanda |
| world/carga-de-tile · tile-store | 35+20 | qué se re-aplica por clase; restaurar/derivar colisión; «primer tile activo» implícito (`:280,:364`) | `repartoDelTile` sí | parcial | blanda |
| ui/eco-del-combate · muro-de-carga | 25+15 | evento→línea, «jugador vivo» derivado; propiedad del muro | `attackFlashQuality` sí; `alive` del jugador no está en `GameStore` | sí | blanda |
| **Subtotal blanda** | **≈ 290** | | | | |
| Los otros 33 ficheros (`fps-gl`, `fps-renderer`, `bridge-client`, `narrative-client`, `input/*`, `dev/*`, `portrait`, `history`, ledgers…) | 0 | transporte, DOM, WebGL, entrada, banco | — | — | (b) |

## Qué queda del título («sin harness, sin umbrales»)

**Un candado de «aquí no hay lógica» no existe y no hay que fingirlo.** Lo medible es lo que ya hace la casa con cada retirada: una regla `text` en `arch-rules.json` sobre `nefan-html/src/**` cuyo patrón crece un token por PR (`short_sword`, `PREFETCH_M|VEIL_M|BLOCKING_M`, `sizeXZ:\s*\{`, `draft\.length\s*<`, `CELLS_PER_PAGE`, `ESPERA_MAX_MS`…), molde `cliente-no-convierte-celdas-a-metros` (`:256-267`) y `campos-retirados-no-vuelven`. Eso impide que VUELVA lo movido; no impide lógica nueva, y decirlo es más honesto que un `arch-rule` de imports que no mide nada. `client-file-size.json` sigue como está. **El issue se cierra con el censo hecho lista**: la tabla de arriba pegada en el comentario de cierre —lo estricto movido con su módulo, test, entrada en `mutation-targets.json` y token; lo blando y lo (b) enumerado con su motivo—, y la medida final de líneas. El título muere; no se sustituye por otro issue paraguas.

## El día después

Para quien juega cambia UNA cosa observable: los spawns del motor pasan a ser sólidos (#489) y el aro deja de mentir si algún día cambia el arma. Lo demás es deuda declarada. Se cierra una puerta: `sim-collision.ts:18` («divergencia intencional, del cliente») deja de ser cierto en cuanto la frontera y los AABB sean funciones de core que el cliente llama — hay que reescribir ese comentario en la misma PR o queda documentación falsa. Lo arbitrario dentro de un mes: ocho módulos de 20-165 líneas en core con «batería de un fichero porque su consumidor es el cliente», que es exactamente el molde de `paso-del-jugador`/`mirada`/`apuntado` (`mutation-targets.json:638-670`); no hace falta inventar otro. Lo que nadie borrará si no se dice: `game-client.ts:175` (muerta) y la nota falsa de `frontera-del-jugador.ts:14`.

## Conflictos

- **#346**: las mismas LÍNEAS, operaciones ortogonales. Trocear mueve métodos enteros; extraer saca 3-8 líneas de dentro de cada uno. Cualquier orden vale, **simultáneas no**. Recomendación: la extracción del título (≈ 30 líneas, una PR) ANTES, y #346 sobre métodos ya adelgazados.
- **#508, #504, #489 (huella + `svgApplied`)**: los absorbe el programa, uno por PR, y se cierran desde ella. **#490** es un gate de `loadSession` en core, no lógica de cliente: fuera, se hace por su cuenta. #483/#497/#506/#509/#510 son bugs de DOM: fuera.
- **Mutación**: no hacen falta N corridas. Cada módulo nace con `break: "sin medir"` (contrato en `test/mutation-config.test.ts:230-285`, precedente `tile-edges`); `local` lo rechaza (`permisoLocal`, coste desconocido) y **la siguiente corrida autorizada con input vacío mide todo lo pendiente desde el tag** y el test obliga a copiar el número. Dos autorizaciones bastan: una a mitad (tras las tres PR de gasto) y otra antes de cerrar. `frontier.ts` ≈ 110 mutantes a 0,66/línea: roza `tope_local` 120, va en lote propio como manda `lotes`.
- **Preselección de estilo**: hoy divergen cliente y bridge. Unificar es un cambio de conducta del título (seguirá al bridge), no un movimiento: hay que decirlo en la PR y en el guion.
- `error-log.ts` como «primer sujeto» (T9): la nota nace de «medir el cliente», que es lo que el 27-08 descartó. Es la pieza más barata y la MENOS de juego. No primera.

## Coste contra valor

118 de 372 commits en 30 días tocan `nefan-html/src` (32 %; 30 de 77 desde el 01-09, 39 %). «No hacer nada» deja la única regla de gasto del jugador (`frontier.ts`) y los tres gates de imagen sin una sola medida, con un bug real ya cobrado (#489) y una divergencia viva. Ocho PR de 20-170 líneas movidas, con el aparato de core ya montado (5 corridas de mutación en 7 días), es barato. Lo que NO vale: mover las 290 blandas (cómo se anima, qué rótulo, qué aviso) — otro cliente pintaría distinto y no las querría — ni convertir `style-apply` en «83 líneas puras» dejando 450 de proceso de pago en el navegador.

## Corte propuesto (una PR cada uno; orden por gasto y duplicado vivo)

1. **Gates de imagen** (#508): predicado puro junto a `render-mode.ts`; los 4 sitios (`modos-de-graficos`, `title-screen` ×2, `effectiveCharMode`) lo llaman. 2. **Frontera** (`frontier.ts` → core, `now` inyectado; corrige la nota de `frontera-del-jugador.ts:14`; abre y cierra su issue). 3. **Atlas**: `politica-de-atlas.ts` (`pedir`/`terminar`) + fusible de skins en el mismo corte (los dos son «no pagar dos veces»). 4. **Arma en el wire** (#504) + `paramsDeTelegraph(spec)`; borra `game-client.ts:175` y `main.ts:281`. 5. **Huella del spawn y colisión** (#489): `huellaDeSpawn` por la misma función que el tile, frontera+AABB como funciones de core, reescribe `sim-collision.ts:18`, promueve el guion 81 a `expect`. 6. **Enemigo**: parser `unknown → Result<HostileCombat>` en core, tres validaciones de `personality` a una. 7. **Título**: `< 20`, preselección (autoridad: bridge), validación del pack (Python → zod de core compartido), carpetas de `STYLE_REF_FOLDERS`; antes de #346. 8. **Sueltas de `main.ts`**: `puntoDeReaparicion`, `ARCADE_SPEED_SCALE`/`INTERACT_RANGE_M` a `combat_config`/core; `hablar-con-un-npc` guard. Cada PR: token en la regla `text`, entrada `sin medir` en `mutation-targets.json`, `client-file-size.json` si toca un eximido.

## Criterio de cierre medible (para `requisitos.md`, en sustitución de la aceptación actual)

- Las 8 piezas de la tabla «estricta» viven en `nefan-core/src` con test propio y entrada en `mutation-targets.json` **medida** (ninguna en `sin medir` al cerrar ⇒ una corrida autorizada antes del cierre), o en `sin_mutar` con motivo.
- `grep -cE '<tokens de la regla>' nefan-html/src` = 0 y la regla `text` nueva en `arch-rules.json` los cubre todos; `sim-collision.ts:18` y `frontera-del-jugador.ts:14` reescritos.
- `nefan-html/src` baja de 14.466 a **≤ 13.950** líneas (−555 de regla, ±100 por las llamadas que quedan), cifra anotada en el cierre junto a la tabla del censo (estricta movida / blanda con motivo / (b)).
- 85 guiones verdes sin retocar salvo el 81 (que se promueve) y el de la preselección (cambio de conducta declarado); `verify`, `crap`, `deuda` sin empeorar.

## Decisiones del usuario

- **A. Alcance**: (1) solo la estricta, ≈ 555 líneas en 8 PR — *recomendada*; (2) estricta + blanda (≈ 860): mueve a core cómo pinta este cliente; no.
- **B. `style-apply.ts`** (531 líneas de batch de pago en el navegador): issue propio para el arquitecto —¿detrás del bridge?— fuera de este programa — *recomendada*; o mover solo sus 83 líneas puras (deja el proceso donde está).
- **C. Preselección de estilo**: que mande el bridge y el título llame a la misma función de core — *recomendada*; o al revés (el cliente exige compatibilidad, el bridge no).
- **D. Orden con #346**: extracción del título (PR 7) antes de trocear — *recomendada*; o #346 primero y extraer después. Nunca en paralelo.
