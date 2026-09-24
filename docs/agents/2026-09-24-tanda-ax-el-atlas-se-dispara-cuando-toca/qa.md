# QA — tanda AX (#730 #729 #754)

Validado sobre el worktree `feature/tanda-ax` (base `f25da654`, sin commitear), contra `e2e-sin-creditos` (motor falso, cero créditos), desde el título. Todo lo mecánico está en guiones: 182 y 183 (del ingeniero) y **184** (nuevo, de QA). Corridas: `node qa/run.mjs 182 183` · `node qa/run.mjs 60 179 181 106` · `node qa/run.mjs 184` · `node qa/run.mjs 106` ×4, más los negativos de abajo. Salidas en `qa/capturas/2026-09-24T19-05-19-254Z-1102113`, `…T19-08-09-895Z-1121569`, `…T19-11-29-570Z-1142742`.

## Criterios → veredicto

| Criterio (de `requisitos.md`) | Veredicto | Evidencia |
|---|---|---|
| **#730 (a)** test en core ROJO si el bridge difunde escena antes de `session_started`, probado en negativo | ✅ | `test/el-estilo-llega-antes-que-la-escena.test.ts`: 3 casos (bootstrap vivo, snapshot, resume) en verde; negativo propio de QA abajo (§Negativos) |
| **#730 (b)** fuera el comentario «no está verificado» y el rótulo «en espera del estilo» | ✅ | `grep -rln "espera del estilo\|applySessionReady\|olvidarRestauraciones\|corridaQuePinta" nefan-core nefan-html qa docs/arquitectura` → 0 ficheros fuera de `docs/agents/`. Rótulo nuevo «sin estilo de sesión (fixture sin partida) — clay» solo alcanzable sin partida |
| **#730** estilo antes del siguiente mensaje (guion 183) | ✅ | 183 en verde en los tres caminos: `estilo #0 · atlas #7` (bootstrap y pre-generado), `estilo #0 · atlas #14` (resume); todo POST con `style_id = acuarela_luminosa` |
| **#729 (1)** manual de X en vuelo + se activa Y → X e Y con su arte | ✅ | 182 bloque 2: `2 · textured=["tile_0_0","tile_1_0","tile_-1_0","tile_0_1"]` con el POST de W retenido hasta después del ciclo de Y (`resolve_only`) |
| **#729 (2)** manual de X durante la fase memoria/mapping del activo Y | ✅ (unitario) | `politica-de-atlas.test.ts` «(2) …fase memoria/mapping…» y costura `la-corrida-de-un-tile-no-tira-la-de-otro.test.ts` (1): 43 + 7 tests en verde. En navegador no se construyó esa ventana (es de milisegundos); el 182 bloque 1 cubre la G del activo con X retenido |
| **#729 (3)** la MISMA clave no se paga dos veces | ✅ con reserva | 184 bloque 1: G con la corrida del activo retenida → «ya hay una corrida en vuelo» y **0 POST nuevos**; test de costura (3): un solo POST. **Reserva H-1**: restauración de vecino + manual de la misma clave = 2 POST de pintar con el mismo `layout_key` (184 bloque 3, medido) — camino preexistente que la vigencia por clave no cierra |
| **#729 (4)** el activo nuevo nunca espera ni se descarta por una corrida de otro tile | ✅ | 182 bloque 1: `1 · la G mandó su propio POST de pintar mientras X seguía retenido` y el activo texturado con X aún en el aire; unitario «(4) …pedir arranca y su corrida tiene token» |
| **#729** guion 182 en `produccion`, motor falso, menú dev + cruce de tile | ✅ | 182 verde (`2 en verde · 0 en rojo de 2`), 2 capturas; teletransporte declarado en cabecera |
| **#729** la decisión vive en `PoliticaDeAtlas`; el menú no cambia | ✅ | diff: `dev-menu.ts` intacto; `fps-atlas.ts` solo cablea (`nuevoRun(key,…)`, `vigente(key,…)`, `finDeRun(key,…)`) y la guarda de layout |
| **#754** 106: borrar `fps_atlas:*` DESPUÉS de `recargarAlTitulo`, con el porqué; 12/12 ×2; aserto positivo intacto | ✅ | diff del 106: borrado tras el reload con comentario y `ctx.log` del número de claves; aserto de la puerta del atlas sin tocar. Mis corridas: 1 (regresión) + 4 (bucle) = **5 de 5 en verde** (el ingeniero reporta 24/24) |
| **Sin regresión** | ✅ | `60 · 106 · 160 · 179 · 181` → `5 en verde · 0 en rojo de 5` |
| **En desarrollo ningún camino automático nuevo paga (#757)** | ✅ | 179 y 181 (`entorno desarrollo`) en verde: todo POST automático con `resolve_only`, «el motor falso no anotó NI un pago de arte NI una petición de pintar»; el único pago del 179 es su G deliberada (bloque 3). El re-disparo nuevo (`finDeRun` → `onActiveTile`) pasa por `runFor(…, resolveOnly: modoDeEscenarios() !== "generar")`, el mismo gate que antes |
| **Lint con la config de `origin/main`** (`no-useless-assignment` + `preserve-caught-error`, tanda AY) | ❌ | `eslint -c <eslint.qa.config.js de origin/main>` sobre los cuatro guiones tocados: **5 errores** `no-useless-assignment` — 180:79, 180:124 (preexistentes en HEAD; `main` ya los arregló, así que el rebase choca), **182:94, 182:108, 183:90 (nuevos de esta tanda)**. `preserve-caught-error`: 0. El 184 pasa con las dos configs |
| **Mutación local de `politica-de-atlas`** | ⚠️ no probado | la herramienta la rechaza (≈123 mutantes > tope 120); el ingeniero lo declara y el `porque` de `mutation-targets.json` lo dice. No se puede afirmar que los mutantes nuevos («vigencia global otra vez», «segunda corrida de la misma clave») mueran |

## Hallazgos

### H-0 · Lint rojo con la config que ya está en `main` — **bloqueante para la PR, trivial**

`origin/main` (#760, tanda AY) enciende `no-useless-assignment` en `qa/`. Los `.mjs` de esta tanda lo incumplen en 5 sitios (`let body = null` / `let b = null` que un `try` pisa antes de leer): 182:94, 182:108, 183:90 (nuevos) y 180:79, 180:124 (heredados; `main` los tiene ya como `let body;`). Al rebasar, `npm run lint` (y CI) sale rojo. Reproducción: `nefan-core/node_modules/.bin/eslint -c <config de main> qa/guiones/18{0,2,3}-*.mjs` → `✖ 5 problems`. Arreglo esperable: `let body;` como hizo AY en el 180.

### H-1 · Restauración de un vecino + «Generar y aplicar» sobre ese vecino = dos POST de pintar con el mismo `layout_key` — **importante (preexistente; el criterio 3 lo deja fuera)**

Producción + Imagen IA. El vecino que llega por el cable se restaura y, con Imagen IA, PINTA lo que falta (guion 180). Mientras ese POST va en el aire, `running` es `false` (la restauración no es una corrida para `PoliticaDeAtlas`), así que el menú dev sigue ofreciendo el vecino con el botón ACTIVO, y «Generar y aplicar» pasa `nuevoRun(V, manual)` sin estorbo → segundo POST sin `resolve_only`, mismo `layout_key`. Medido en 184 bloque 3: `POST de PINTAR desde que llegó tile_0_1: 2 · con el MISMO layout_key: [[a68d1a…, 2]]`, el falso ejerció `pintar-superficies` 2 veces. El falso cobró 0 porque esas celdas ya estaban en su librería; el server real (`ai_server/routers/remote_generation.py`) resuelve por celda contra la caché y pinta lo que falta **sin cerrojo en vuelo**, así que dos POST concurrentes con celdas nuevas son dos pinturas. `nuevoRun` invalida la restauración (`#olvidarRestauracion`) para que no aplique, pero no la ve como ocupación de la clave. Pasos: partida en Imagen IA (`produccion`) → pedir un vecino → abrir «Imágenes…» antes de que termine → «Generar y aplicar» ×2. El usuario espera lo que promete la cabecera de la política: «una clave con una corrida en vuelo no admite otra».

### H-2 · La G (o el menú) durante la corrida del propio tile activo se DESCARTA — **importante (cambio de conducta respecto a `main`)**

Al entrar en un tile en clay, el ciclo del activo pregunta a la librería (`resolve_only`). Si el desarrollador pulsa G en ese momento —el gesto más común del menú dev—, `nuevoRun` devuelve `"ocupada"`, el HUD dice «ya hay una corrida en vuelo — pídelo otra vez al terminar» y la petición se pierde: al soltar la corrida del activo, el tile sigue en clay y no hay POST de pintar (184 bloque 1: `texturado=false · POST de pintar tras la G=0`). En `main` la G superaba a esa corrida y pintaba. Está dicho (no es mudo) y es coherente con «no pagar dos veces», pero la manual del activo podría encolarse como se encola la del activo (`#encoladas`) en vez de descartarse: hoy el usuario tiene que mirar el registro y repetir. Peor caso: un POST del activo que **nunca vuelve** (remote-gen colgado; `resolverYAplicar` no tiene timeout ni `AbortController`) deja la clave ocupada hasta recargar o cambiar de mundo, sin que la G pueda ya forzar nada; en `main` la G lo superaba. Pasos: partida nueva en maqueta → G nada más cerrarse el título (con remote-gen lento se ve sin retener nada).

### H-3 · El aviso del panel dev miente sobre QUÉ tile pinta — **menor (HUD)**

Con una manual del menú dev pintando el vecino `tile_1_0`, el panel enciende «GENERANDO atlas de superficies del tile activo…» (captura `184-…-01-184-2-panel-con-manual-de-un-vecino.png`; 184 bloque 2: `rotulo: "GENERANDO atlas de superficies del tile activo…", activeTile: "tile_0_0"`, lo que pinta es `tile_1_0`). Con la vigencia por clave hay varias corridas posibles y el rótulo sigue siendo el de una sola; `pintando` subió a core pero el texto no sabe la clave. El desarrollador ve «tile activo» en naranja y el tile activo en clay.

### H-4 · El menú deshabilita TODOS los atlas con cualquier corrida en vuelo — **menor (preexistente, ahora contradice la regla nueva)**

`pendientes().inFlight` lee `running` (candado `el-arte-pendiente-lo-cuenta-su-dueno.test.ts`, decisión escrita en `fps-atlas.ts:108-113`). Con la manual de `tile_1_0` en vuelo, los dos items de atlas salen «Generando…» deshabilitados (184 bloque 2: `2 de 4`). La regla de la tanda («una corrida de otra clave nunca estorba») no es alcanzable desde el menú: solo G + menú. Y «Generando…» sobre el activo, que no se está generando, es la misma mentira que H-3 en otro sitio.

### H-5 · `#encoladas` sobrevive al cambio de mundo — **menor**

`cambioDeMundo()` vacía cola, restauraciones y corridas pero no `#encoladas`. Sonda sobre la clase (`scratchpad/sonda.ts`): manual `tile_0_0` en vuelo → `pedir(tile_0_0)` = `encolado` → `cambioDeMundo()` → `pedir(tile_0_0)` = `arranca` → `terminar(tile_0_0)` = **`re-disparar`** (heredado del mundo viejo). Efecto: un `onActiveTile` de más en el mundo nuevo, que cae en memoria ($0) o repite la línea «sin celdas en la librería» del HUD. Sin gasto en ningún entorno (el re-disparo pasa por el mismo gate). No se reprodujo en navegador.

### Observaciones fuera del alcance de la tanda (para el coordinador, sin hallazgo)

- La línea del menú «Generando Atlas fps tile_1_0 (clay — celdas ya en la librería salen gratis)…» en el registro arrastra el sufijo del label (`dev-menu.ts:124`); preexistente.
- Con el motor falso el registro dice «$0.15» y la barra superior «gasto sesión 0,00 €»; preexistente y del falso.

## Crítica visual (capturas 182, 183, 184)

- 182-1/182-2 y 184-3: el damero del `fake-surface-model` cubre muros, tejado y suelo con la misma escala; se distingue bien qué está texturado y qué no (vecino a la derecha en 182-2 en clay oscuro vs. suelo texturado). Legibilidad del registro sobre el damero, justa pero suficiente.
- 184-2: el aviso naranja «GENERANDO … del tile activo…» es lo más visible de la barra, y la escena entera está en clay: contradicción a simple vista (H-3).
- 183: la partida reanudada arranca de noche/interior muy oscuro; el registro se lee. No es de esta tanda.

## Guion nuevo de QA

`qa/guiones/184-lo-que-la-vigencia-por-clave-no-cubre.mjs` (+ fila en `qa/README.md`): bloque 1 afirma el rechazo dicho y el POST único (criterio 3) y deja H-2 en `ctx.log`; bloque 2 afirma el aviso del panel con una corrida que no es del activo y deja H-3/H-4 en `ctx.log`; bloque 3 afirma que el menú ofrece el vecino con el botón activo con su restauración en vuelo y que la manual sale, y deja H-1 en `ctx.log` (regla T10: pasan a `ctx.expect` con la PR que los cierre). Verde: `1 en verde · 0 en rojo de 1`. Lint OK con la config de HEAD y con la de `main`. Candados del banco (`un-salto-del-guion-se-observa`, `la-consulta-de-movimiento-tiene-dueno`, `un-numero-un-guion`, `sonda-de-qa`) en verde con el guion en el árbol.

## Negativos (QA, sobre este árbol, restaurado después)

- **Test de #730** (`bridge/handlers/session.ts:492`, `ctx.subscribe(ws)` quitado): `pass 0 · fail 3`, con `AssertionError: la escena de la sesión no llegó a este socket (¿subscribe detrás de la difusión?)`. Fichero restaurado desde copia; `git diff` de ese fichero vacío. (Los otros tres sabotajes —replay antes del `send`, resume, bootstrap— los reporta el ingeniero con su salida; no se repitieron.)
- **Guion 184** (`politica-de-atlas.ts:131`, la guarda `if (this.#corridaDe.has(key))` de `nuevoRun` → `if (false)`): bloque 1 ROJO en sus dos asertos — «LO DICE en el registro — no ocurrió en 10000 ms» y «NO manda un segundo POST — `[{"layout_key":"d9ef94…","resolve_only":false}]`»; el `ctx.log` de H-2 pasa a `texturado=true · POST de pintar tras la G=1` (la G ya no se descarta: supera y pinta, que es la conducta de `main`). Restaurado byte a byte (`cmp`).
- **Guion 182 y test de costura contra `main`**: los reporta el ingeniero (X y W en clay; 5 de 7 rojos). No se repitieron.

## Workarounds usados

- **Retener el POST con `page.route`** (182, 184): construye la ventana en vez de esperar a que ocurra. No oculta nada al usuario: la ventana existe con remote-gen lento (la corrida real dura segundos o minutos). Declarado en cabecera.
- **Teletransporte `setPlayerPos`** (182 bloque 2): fabricación declarada; el disparador (`activateByPosition` → `onActiveTile`) es el mismo que andando.
- **Borrar `fps_atlas:*` tras el reload** (106): es el arreglo de #754, aislamiento del guion; el jugador real quiere justo lo contrario (restaurar a $0), y el 183/60 lo miden.
- Ningún `display:none`, ningún estado sintético en el juego.

## No probado

- **Mutación de `politica-de-atlas`**: rechazada por tope local; pendiente de corrida autorizada.
- **Doble cobro real** (H-1): solo el doble POST; el falso tenía las celdas y no cobró. El server real no tiene cerrojo en vuelo (leído, no ejecutado).
- **Corrida colgada para siempre** (H-2, peor caso): razonado sobre `resolverYAplicar` (sin timeout) y el bloque 1 del 184 con el POST retenido; no se dejó colgada una sesión real.
- **(2) de #729 en navegador**: la ventana memoria/mapping es de milisegundos; cubierta por unitario y costura.
- **Gasto real de créditos**: nada; todo contra el motor falso.

## Veredicto

**Apto con reservas.** Lo pedido en #729, #730 y #754 se cumple en el flujo real y con candados que se ponen rojos; en desarrollo ningún camino automático nuevo paga. Antes de fusionar hay que cerrar **H-0** (5 `no-useless-assignment` que el lint de `main` ya rechaza: 182, 183 y el 180 heredado) — trivial, pero deja la PR en rojo tal cual. **H-2** es una decisión que el coordinador debe tomar a sabiendas: la manual sobre el activo con su corrida en vuelo pasa de «supera y pinta» a «se descarta y lo dice», y sin timeout en el POST una corrida colgada bloquea su clave. **H-1** (restauración + manual = dos POST de pintar) es preexistente y merece issue, no bloquea esta tanda. H-3/H-4/H-5 menores.
