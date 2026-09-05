# QA — PR-1 · #302 «lo que se carga pasa por `validateScene` o no se sirve» (PR #448)

Fecha: 2026-09-05 · rama `t11/snapshot-revalida` = `6abee18` · worktree desprendido `/home/al/code/ne-fan-t11-qa1` ·
`NEFAN_PORT_OFFSET=700` · disco aislado en el scratchpad (`qa1/games` = copia de `alta_fantasia`, `qa1/plugins`, `qa1/saves`,
`qa1/logs`) · preset `e2e-sin-creditos` (motor falso, **0 créditos**) · `nefan-core/data/games` real NO tocado (sigue sin `world/`).

Criterio aceptado (requisitos, «Decisión del usuario» 4): **un snapshot que pasa el schema pero no `validateScene` no se sirve
como `ready`; quitar la comprobación pone el test rojo.**

## Tabla de criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| `npm run verify` verde en nefan-core | ✅ | `rc=0 · tests 2071 · pass 2071 · fail 0` (15,8 s de tests) |
| El `describe` nuevo pasa | ✅ | `npx tsx --test --test-name-pattern=302 test/world-snapshot.test.ts` → 4/4 (control positivo + entrada injugable + anillo injugable/anillo sano + `start_session`) |
| **Negativo**: sin el bucle de `validateScene` el test se pone rojo | ✅ | Sustituí el `for` de `world-snapshot.ts:136-146` por un comentario y corrí `world-snapshot.test.ts` + `style-application.test.ts`: **20 tests, 17 pass, 3 fail** — caen exactamente los 3 `it` de jugabilidad («escena de ENTRADA injugable…», «un tile del ANILLO…», «start_session NO lo sirve…»); el control «BIEN FORMADO» sigue verde (así debe ser); `style-application` no se mueve. Restaurado con `git checkout`, árbol limpio |
| (a) Sin snapshot → `missing` | ✅ | `list_games` por WS → `alta_fantasia → generation=missing`; `get_world_snapshot` → `ok=true status=missing snapshot=null`. Log: nada |
| (b) Snapshot sano del bootstrap falso → `ready` y `start_session` lo REPLAYEA sin motor | ✅ | 1.er `start_session`: `generating` → `ready source=engine` (95,9 ms); bridge: «world snapshot escrito … (1 escenas)». `list_games` → `ready`. 2.º `start_session`: **`ready source=snapshot`** (32 ms); bridge: «world snapshot HIT … — bootstrap sin motor». `nefan-fake-ai.log`: **1** solo `POST /generate_scene` en toda la secuencia |
| (c) Mismo snapshot con NPC en celda sólida → `stale`, chip nuevo, degrada al bootstrap vivo, log «injugable» con escena y NPC | ✅ | `barkeep` movido a `[56,51]` (huella de `mostrador [55,51,6,2]`). `list_games` → **`stale`**. Log: `worldSnapshotStatus("alta_fantasia"): world snapshot injugable (…/tile.json): la escena "tile_0_0" no pasa el validador de hoy: el NPC "barkeep" nace en [56, 51], celda no transitable … — regenera el mundo desde el título`. `start_session` → `generating` → `ready source=engine`; bridge: «world snapshot ilegible para "alta_fantasia": Error: world snapshot injugable …» y luego «world snapshot escrito (1 escenas)» → el tile queda reescrito sano (`barkeep [79,63]`, `generated_at` nuevo) y `list_games` vuelve a `ready`. Título (Playwright): tarjeta «Mundo ⟳», panel **«Mundo: ⟳ obsoleto (regenera el mundo)»**, botón «⚙ Generar mundo», «Aplicar estilo» deshabilitado. Captura `scratchpad/qa1/titulo-stale-injugable.png` |
| (d) `world_doc_hash` distinto → sigue diciendo lo de world.md | ✅ | `list_games` → `stale`; `get_world_snapshot` → `ok=true status=stale snapshot=null`; log: «world snapshot stale para "alta_fantasia": world.md cambió desde la generación — se ignora (regenera el mundo desde el título)» (sale **dos veces** por petición de `get_world_snapshot`: doble carga, preexistente) |
| (e) Campo retirado (`style_ref` en la escena) → rechazado por `.strict()`, mensaje distinto | ✅ | `list_games` → `stale`; `get_world_snapshot` → `ok=false error="world snapshot inválido (…): [unrecognized_keys style_ref … `style_ref` de escena está retirado …] — bórralo o regenera el mundo desde el título"`. Distinto de «injugable»: es el gate estructural, no el de jugabilidad |
| Adversarial 3(a): 9 escenas, UNA injugable en el anillo → ¿mundo entero rechazado? | ✅ se rechaza entero (decisión reportada abajo) | `anillo-9` (entrada sana + 8 vecinos sin player, `tile_1_0` con `barkeep` en el mostrador): `list_games` → `stale` ×3; log nombra `"tile_1_0"` y `"barkeep"`. Control: los mismos 9 sanos → `ready`, `get_world_snapshot` → 9 escenas |
| 3(b) `get_world_snapshot` / `list_games` en el State API HTTP | ✅ (n/a) | El State API (:10578) **no expone** ni `list_games` ni `get_world_snapshot`: sus 29 endpoints (`src/contracts/world-state.ts`) son `/health`, `/map…`, `/npc…`, `/entities…`, `/scene/validate`, `/world_doc`, `/vocabulary`… Con el snapshot injugable `/health` y `/world_doc` responden igual (`ok:true`). Los dos verbos viven solo en el WS y están probados arriba: `list_games` → `stale`; `get_world_snapshot` → `ok:false` + error preciso |
| 3(c) Latencia en el flujo del título | ✅ | Wire `list_games` (1 juego, medido desde el `send` hasta `games_listed`): 1 escena `ready` 10,8–14,3 ms · **9 escenas `ready`: 36,0 / 27,1 / 26,4 / 17,8 / 25,8 / 18,6 ms** · 9 con una injugable: 24,0 / 16,9 / 23,9 ms · `missing` 14,3 ms (incluye el coste fijo del wire). Coincide con la medida del ingeniero (19–45 ms por juego); con los 4 juegos base a 9 escenas serían ~100 ms. Sin caché, y no hace falta |
| 3(d) Otra vía que lea `tile.json` sin pasar por `loadWorldSnapshot` | ✅ ninguna | `grep` en `src/games` y `bridge`: `worldSnapshotPath` solo en `world-snapshot.ts`; `readFileSync` de `style-application.ts:63`, `vocabulary.ts:79`, `loader.ts` leen `world/styles/*.json`, `vocabulary.json`, `game.json`/`world.md`; `game-gen.ts:2` lo cita en un comentario. Llamantes de `loadWorldSnapshot`: `session.ts:473` (start) y `style-apply.ts:32` (get_world_snapshot); `gameGenerationStatus` en `session.ts:135` (list_games). Puerta única confirmada |
| Barrido de rastros | ✅ | `grep -rn "20 tiles\|los 20\|20 de 20\|gate-snapshots\|ya fue validado al generarse\|world.md cambió" nefan-core nefan-html/src docs/arquitectura CLAUDE.md` (fuera `node_modules`, `dist`, `docs/agents`): `gate-snapshots` **0** en todo el repo; «ya fue validado al generarse» **0**. Quedan: «los 20 módulos» ×5 (`mutate.ts:223`, `afectado.ts:339`, `afectado.test.ts:124`, `mutacion-huella.test.ts:1065`, `mutation-targets.json:2`) = historia de la mutación, no snapshots; «200 primeros bytes» `ws-server.ts:297` = falso positivo; «world.md cambió» en `world-snapshot.ts:120` y `vocabulary.ts:93` = casos en que ES world.md (correctos) y en `nefan-html/src/ui/style-apply.ts:145` (ver hallazgo menor 4) |
| Desviación 1: chip del título (`title-screen.ts:973`) | ✅ correcta y mínima | 1 línea. La etiqueta vieja atribuía todo `stale` a world.md y el wire no distingue motivos. Sin comentario: el fichero está **exactamente en 1732 líneas** (`wc -l`), el tope congelado de `max-lines` — comprobado |
| Desviación 2: fixture de `style-application.test.ts` con `player` | ✅ correcta y mínima | Una entity. La escena de entrada sin `player` no la produce ningún camino real: `bootstrap-tile.ts:80` valida con `bootstrap: true`, que exige el spawn; y la puerta nueva la marcaba `stale` con razón. El comentario dice eso |
| Comentario de `generation` en `messages.ts:524-528` | ✅ describe lo que hay | «"stale" = world.md cambió … O el snapshot ya no pasa la puerta de carga (`ExpandedSceneSchema .strict()` + `validateScene`, #302)»: son los dos `return`/`throw` de `loadWorldSnapshot` que `worldSnapshotStatus` colapsa a `stale` |
| CI de #448 | ✅ | `gh pr checks 448`: ai-server pass 34 s · narrative-mcp pass 16 s · nefan-core pass 2 m 43 s · nefan-html pass 32 s |
| Afirmación medida, no candada: «un tile del anillo CON player se rechaza» | ✅ reproducida | Script propio (`npx tsx`): `validateScene(anillo con player, {bootstrap:false})` → `ok=false`, error «los tiles no llevan entity kind "player" (el jugador entra andando desde el tile vecino); solo el tile inicial de bootstrap la incluye»; aviso `no-verificado`. Coherente con `tile.ts:146` |

## Hallazgos

Ninguno bloqueante. Ninguno importante que sea de esta PR.

### Decisión de diseño a dejar por escrito — 3(a): un tile malo tumba el mundo entero (importante como decisión, no como defecto)

**Qué pasa.** Con 9 escenas pre-generadas y UNA del anillo injugable, `loadWorldSnapshot` lanza y el mundo entero es `stale`.
Para el jugador: chip «obsoleto», y si pulsa «Continuar →» el bridge degrada al **bootstrap vivo**, que genera SOLO el tile
(0,0) y **sobrescribe el snapshot de 9 escenas por uno de 1** (medido en (c): `generated_at` nuevo, 1 escena). Las 8 escenas
que estaban bien se pierden y se regenerarán perezosamente al jugar, tile a tile, con el motor real (minutos, cero imagen).
La salida honesta es la que el chip dice: «Generar mundo» desde el título, que regenera las 9 (comprobado con el motor falso:
«Mundo de Miravanda generado: 9 escenas», `✓ generado`, 11 `POST /generate_scene`).

**¿Es lo que debe pasar?** Sí para el criterio aceptado («o no se sirve»: una puerta, un código, chip y start coherentes) y para
pre-producción. La alternativa —servir la entrada y marcar solo el tile malo como no realizado— exige que el replay salte una
escena que el `world_map` cree realizada y que `request_tile` la vuelva a pedir: es otra feature (y un issue), no un ajuste.
Lo que sí convendría anotar en el issue de cierre: **el precio de la puerta es regenerar lo que estaba bien**, y crece con lo
pre-generado (un `generate_game` completo son bootstrap + anillo + hasta 8 places).

### Menores

1. **El log llama «ilegible» a un snapshot perfectamente legible.** `session.ts:475`: «Bridge: world snapshot ilegible para
   "alta_fantasia": Error: world snapshot injugable …». La palabra del envoltorio contradice la del error. Reproducción: estado
   (c) + `start_session`. Esperado: «world snapshot rechazado» o simplemente el mensaje del error, que ya se explica solo.
2. **Traza de pila de 7-10 líneas por un dato esperable.** `console.error(…, err)` en `session.ts:475` y `style-apply.ts:48`
   imprime el `Error` con stack (`at loadWorldSnapshot … at Receiver.getData …`) cada vez que un snapshot es stale por
   jugabilidad o por schema. Es la condición NORMAL que la PR introduce, no un bug: `err.message` bastaría. Preexistente para el
   caso `.strict()`; con esta PR se dispara más.
3. **Forma del wire asimétrica según el motivo del `stale`.** `get_world_snapshot`: por hash → `ok:true, status:"stale",
   snapshot:null`; por jugabilidad o por schema → `ok:false, error:"…"`. `list_games` dice `stale` en los tres. Ningún jugador lo
   ve (el botón «Aplicar estilo» va deshabilitado cuando el mundo no es `ready`, `title-screen.ts:990-992`), pero un cliente
   programático recibe dos formas para un estado que el título llama igual. Preexistente (#324).
4. **`nefan-html/src/ui/style-apply.ts:145`** sigue diciendo «el mundo generado quedó obsoleto (world.md cambió)». El ingeniero
   lo justifica (con snapshot injugable `plan()` recibe `ok:false` y ese texto no se alcanza) y es cierto HOY por el hallazgo 3;
   si alguien unifica la forma del wire, esa frase pasa a mentir. Va con el 3.
5. **Coherencia del panel en estado `stale`:** la etiqueta dice «regenera el mundo» y el botón de al lado dice «⚙ Generar
   mundo» (solo pone «↻ Regenerar» cuando es `ready`, `title-screen.ts:986`). Funciona a un click y sin la confirmación de dos
   clicks —razonable porque el mundo es inservible—, pero el verbo no casa con la etiqueta nueva. Preexistente; visible en la
   captura.
6. **El jugador no sabe POR QUÉ está obsoleto.** El chip nuevo es honesto («regenera el mundo») pero no dice si fue world.md o
   una escena injugable; el motivo solo está en el log del bridge. Suficiente para pre-producción; si algún día importa, el wire
   tendría que llevar el motivo (`generation_reason`), no la etiqueta adivinarlo.
7. **Doble carga en `get_world_snapshot` con hash distinto** (`style-apply.ts:32-35`: `loadWorldSnapshot` devuelve `null` y
   `worldSnapshotStatus` lo vuelve a leer y parsear): el aviso «world.md cambió» sale dos veces por petición. Preexistente,
   coste despreciable.

## Workarounds usados durante la prueba

- **Editar `tile.json` a mano** (`romper.mjs`: NPC a celda sólida, hash a ceros, `style_ref`, clonar el anillo). Es la ÚNICA
  forma de fabricar «generado bajo un validador anterior» sin un checkout viejo; no es un obstáculo del jugador, es el
  artefacto sintético que el propio criterio pide (patrón `aDisco`). Veredicto: legítimo.
- **Sonda WS propia** (`qa1/sonda.mjs`) para `list_games` / `get_world_snapshot` / `start_session` y medir el wire. No sustituye
  al título: los estados (c) y el camino de salida («Generar mundo») se vieron también en el navegador. Veredicto: instrumento,
  no apaño.
- **`qa1/plugins` copiado junto a `qa1/games`**: el loader busca `{gamesDir}/../plugins`; sin la copia el bridge no arranca con
  disco aislado. Requisito del banco, documentado en `qa/run.mjs:232-238`. Veredicto: no afecta al jugador.
- **Scratchpad compartido**: `scratchpad/disco/` ya contenía el disco del ingeniero (tile del 13:43) y otros agentes escribían
  en paralelo; trabajé en `scratchpad/qa1/` para no mezclar evidencias. La captura de Playwright cayó en la raíz del repo real
  (`/home/al/code/ne-fan/qa1-titulo-stale-injugable.png`, restricción de rutas del MCP); movida al scratchpad, `git status`
  limpio.
- **Ningún `display:none`, ningún estado forzado en el cliente, ningún cambio de código de producción** salvo el negativo,
  restaurado con `git checkout` (verificado con `git status`).

## No probado

- **Motor real** (créditos): que el snapshot de un `generate_game` real pase la puerta al cargarse (el falso pasa: 9/9). Los
  tiles reales del anillo se validan sin `bootstrap` en `tile.ts:146`, misma regla que la puerta, así que el riesgo de rechazo
  «de más» está en costuras/alcanzabilidad, que la puerta NO juzga (aviso `no-verificado`), no en el cuerpo del NPC.
- **Listado con los 4 juegos base generados**: mi disco tenía un juego; los ~100 ms son extrapolación de 4 × ~25 ms.
- **`node qa/run.mjs`**: no hay guion que cubra el snapshot `stale` (solo el 21 toca `generation`, para sprites); no lo corrí
  porque el flujo real (preset + wire + título con Playwright) lo cubre y `run.mjs` no lo haría sin un guion nuevo — propuesto
  abajo.

## Guion que valdría candar (propuesta, no escrito)

`qa/guiones/NN-el-snapshot-injugable-no-se-sirve.mjs`, sobre el `TMP_GAMES` de `run.mjs` (motor falso, 0 créditos, sin
`sinMotor`), `sinMotor: false`:
1. `start_session alta_fantasia` → espera `ready source=engine`; comprueba que `TMP_GAMES/alta_fantasia/world/tile.json` existe.
2. `start_session` de nuevo → `ready source=snapshot` y el contador de `POST /generate_scene` del fake no sube (control positivo
   del replay).
3. Edita ESE `tile.json`: mueve un NPC a la huella de un volumen (leer `volumes[].rect`, no una celda a ojo) y reescribe.
4. `list_games` → `generation === "stale"`; en la página, el panel de generación contiene «obsoleto (regenera el mundo)» y
   «Aplicar estilo» está `disabled`.
5. `start_session` → `ready source=engine` (nunca `snapshot`); el log del bridge (`TMP_LOGS/nefan-bridge.log`) contiene
   «injugable», el `scene_id` y el id del NPC; el `tile.json` reescrito ya no tiene al NPC en esa celda.
6. Negativo del guion (una vez, a mano): comentar el bucle de `world-snapshot.ts` → el paso 4 debe ponerse rojo por `ready`.
Lo que queda en informe, no en guion: la decisión 3(a) y los textos de los hallazgos menores.

## Veredicto

**APTO.** El criterio aceptado se cumple en el código, en el test y en el flujo real: un snapshot bien formado con un NPC en
celda sólida sale `stale` en `list_games`, no se replayea (`source=engine`, el motor falso recibe la llamada), el bridge lo
dice nombrando fichero, escena y NPC, el título lo pinta con la etiqueta nueva y deja la salida a un click («Generar mundo»,
que con el falso deja el mundo `✓ generado` con 9 escenas). El negativo es real: sin el bucle caen exactamente los 3 `it` de
jugabilidad y solo esos. `verify` 2071/2071, CI de #448 verde en los cuatro jobs, `gate-snapshots` a cero en todo el repo, los
rastros que quedan son de otra historia. La puerta es única (nadie más lee `tile.json`) y la latencia medida en el wire (≤ 36 ms
con 9 escenas) no justifica caché. Las dos desviaciones son correctas y mínimas. Lo que hay que llevarse al cierre de #302 es
la **decisión 3(a)**: un tile malo cuesta regenerar todo lo pre-generado, y «Continuar» sobre un mundo `stale` lo sustituye
por un snapshot de una escena sin avisar de esa pérdida. Siete menores, ninguno introducido por esta PR salvo el volumen de
trazas de pila que ahora se dispara más a menudo.
