# QA — T7 PR-A (#399 + #400 restos 2 y 3) · medido sobre `532096d` el 2026-09-03

Worktree `.claude/worktrees/t7a-qa` (detached en `532096d`, base `main` = `4ca0c50`). Validado contra la
petición literal de `requisitos.md` (Alcance 3 y 4 con sus bloques «Crítica:», criterios **A4, A5, A6**) y
contra los criterios de cierre de los issues (`gh api …/issues/399`, `…/400`), no contra `implementacion-a.md`.
Cero créditos: todo con `e2e-sin-creditos` / `html-fixtures`, o subprocesos sin juego.

## Veredicto: **APTO con reservas**

Lo pedido está hecho y demostrado en los dos gates y en el juego real: `attach:"wall"`, `glyph` y
`ambient_event` han salido enteros de los cinco procesos con grep a cero y candado que nace rojo; la raíz de
la escena es `.strict()` en las dos poblaciones y una clave desconocida vuelve nombrada con la lista de lo que
sí existe, en TS y en Python; ningún motivo que el motor recibía en `main` se ha perdido (dos han mejorado); el
motor falso, las fixtures del selector «Room», los saves y el resume siguen en verde (13 guiones + 1 script).
Las reservas son dos textos que hoy mienten (hallazgos 1 y 2: un «espejo exacto» que no lo es y un motivo de
retirada que el patrón de la casa da a cinco claves y no a las dos que esta PR retira) y tres derivados que
tienen que salir a issue antes de cerrar (§ Derivados). Nada de eso cambia lo que ve el jugador.

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **A4** `grep -rn "attach\|WALL_CHAR" nefan-core/src nefan-core/data/contract ai_server narrative-mcp` → 0 fuera de `archivo/` y del candado | ✅ cumple (leído como el CAMPO) | El grep literal da 12 hits y **ninguno es el campo**: `attachRealizedScene` (`world-map.ts:191,194`, `narrative-state.ts:637,655`), «attached/attaches» en prosa (`map-triggers.ts:1`, `ui_systems.md:103`, `world_rules.md:63`, `ws-bridge.ts:337`), `attach_start` (`llm_client.py:342,347`), `this.attach(wss)` (`ws-bridge.ts:102,105`, método vivo), más el candado y la fixture negativa exceptuada. `grep -rnw attach` → solo `ws-bridge.ts:102,105` + fixture. `WALL_CHAR` → 0 fuera de `arch-rules.json`. Tool: `generate_scene.json` sin `attach` ni `glyph` (diff). Prompts: fuera el párrafo DECOR ATTACH y «DECOR ATTACH, GLYPH» de `tile_instructions.md:321` |
| A4 · fixture inválida con `attach` rechazada | ✅ | `fixtures/scene/invalid/entity_pegada_al_muro.json` (`expect: reject`) corre en los dos runners (`contract-fixtures.test.ts`, `test_contract_fixtures.py`: 143 OK). Y cae **solo** por su clave: `tal cual → RECHAZA (…trae la clave \`attach\`…) · sin la clave → ACEPTA` (sondeo `fixtures-solo-su-clave.mts`) |
| A4 · candado `campos-retirados-no-vuelven` con `attach(?!\()` distingue | ✅ probado en negativo con fichero real | `nefan-core/src/qa-tmp-candado.ts` con `this.attach(w)` → `architecture.test.ts` **69 pass**; con `attach: "wall"` → **68 pass · 1 fail** (`campos-retirados-no-vuelven`); con `glyph: "n", ambient_event: "x"` → rojo nombrando `qa-tmp-candado.ts:1 — patrón prohibido: "glyph"` y `"ambient_event"`. Fichero borrado, árbol limpio. Sobre contenido: `this.attach(wss);` libre · `attach: "wall"`, `"attach": "wall"`, `e.attach === "wall"` cazados · `ambient_events: []`, `ambient_log` libres (`\b`) |
| A4 · parser de `repo-hygiene.test.ts` sigue probando la alternancia entera | ✅ | Réplica del parser (`parser.mts`): **105 términos**, ninguno conserva paréntesis, `attach` literal en la lista. El parser VIEJO (`/\(([^)]+)\)/`) daba 104 términos con el último `attach(?!\(` — perdía `ambient_event` entero. Rutas: `data/attach.json`, `data/glyph.json`, `data/ambient_event.json` cazadas; `data/attachs.json`, `data/pre_attach_x/o.json` libres. `repo-hygiene.test.ts` 8/8 |
| **A5** `grep -rn glyph nefan-core nefan-html/src ai_server narrative-mcp` → 0 fuera de `archivo/` y del candado | ✅ | Solo `arch-rules.json:515` (patrón) y `fixtures/scene/invalid/entity_con_glifo.json:38` (negativa, exceptuada). También 0 en `labs/` y `qa/`. `ambient_event` (`grep -rnw`, todo el repo) → solo el candado y `docs/proto-motor-grafico.md:324`, documento **marcado como histórico** en su cabecera (prototipo UE5) |
| A5 · `EmittedSceneSchema` y `ExpandedSceneSchema` son `.strict()` y rechazan `ambient_evnt` | ✅ en TS **y** Python, nombrando la clave | TS: `RECHAZA → la escena trae la clave \`ambient_evnt\`, que no existe en el contrato. Una escena tiene EXACTAMENTE estos campos: scene_id \| scene_description \| place_id \| tile \| biome \| ground \| volumes \| vegetation_zones \| scatter_generators \| scatter_zones \| place_anchors \| entities…`. Python: mismo texto (orden del tool). Loader (`ExpandedSceneSchema`) con `ambient_event`: RECHAZA con la lista que incluye `size \| terrain \| … \| __expanded`. `grep -c "passthrough()" scene-schema.ts` → solo prosa (líneas 22, 26, 372). En `main` los cinco casos de raíz ACEPTABAN mudos |
| A5 · una escena de ai_server sigue pasando | ✅ | Las tres escenas del motor falso (`bootstrapTile()`, `makeTile(normal)`, `makeTile(con place)`, volcadas con `dump-fake.mts`) por `validate_scene_response`: **ACEPTA · claves salida == entrada: True** las tres (el saneador ya no inyecta nada). Y por el zod: `fake-motor-contract.test.ts` (en `npm test`). Guion 40: `tile limpio: zod=ACEPTA · ai_server=ACEPTA` |
| A5 · save/snapshot con `place_id` estampado y `place_anchors` pasa el loader | ✅ | `expandScenePrimitives(base + place_id + place_anchors)` → `ExpandedSceneSchema` **ACEPTA**. Flujo real: guiones **60** (reanudar pinta el tile), **65** (save y salidas), **48** (el mundo vuelve), **46**, **58** en verde |
| Fail-loud sin degradado: `glyph`/`attach` del motor con mensaje útil | ✅ | `entities[1]: la entity "roric" trae la clave \`attach\`, que no existe en el contrato. Una entity tiene EXACTAMENTE estos campos: id \| kind \| name \| cell \| footprint \| shape \| h \| role \| description \| style_ref…` (ídem `glyph`). Python: `entity 'roric': la clave 'attach' no existe en el contrato…` misma lista de 10 |
| `size`/`terrain` no se le enseñan al motor | ✅ | La lista del mensaje de raíz emitida NO trae `size` ni `terrain` (TS y Python); `size en tile → RECHAZA → size: un tile no lleva \`size\`…` y `terrain: [] → ACEPTA` en los dos, igual que en `main` |
| Con `.strict()` siguen llegando los motivos de `style_ref`, `__expanded`, terreno retirado y `stage` | ✅ ninguno perdido; dos mejoran | Comparado con `4ca0c50` extraído al scratchpad (`sondeo.mts`/`sondeo.py`): `style_ref` → mismo texto («…quítalo. Para guiar el arte usa \`surface_ref\`…»); `__expanded:false` → mismo texto; `terrain_legend` → mismo texto («…Si viene de un save o snapshot, bórralo o regenéralo»), en las DOS poblaciones; `terrain_legend + terrain_patches` → los **dos** nombrados en el primer issue (en `main` el segundo iba en «y 1 problema(s) más»). **Mejoras**: `stage` con `tile` → en `main` el zod lo ACEPTABA mudo (passthrough) y Python lo podaba con traza; ahora los dos RECHAZAN con «\`stage\` era el plató proscenio…pídela con generate_tile». `style_ref` en Python: de «descartado con traza» a rechazo con su motivo |
| Adversarial: `place_anchors` con 9 / `rect` de 3 | ✅ zod · ⚠️ Python poda (hallazgo 1) | zod: `9 elementos → Array must contain at most 8`, `rect de 3 → at least 4`, `rect 1.5 → Expected integer`, `sin place_id → Required`. Python: **ACEPTA** las cuatro: trunca a 8, descarta el `rect`, descarta el elemento (`place_anchors[0] malformado, descartado`) |
| Adversarial: `attach` + otro error en la misma escena | ✅ útil | `attach + kind inválido` → zod enseña `kind: Invalid enum value… (y 1 problema(s) más)`; Python enseña `attach` primero. `attach en entity + clave raíz desconocida` → zod: la entity primero «(y 1 problema(s) más)»; Python: la raíz primero. Los dos mensajes son accionables; el orden difiere y no importa: cada re-respuesta quita uno |
| Fixture de `data/scenes/` sin `ambient_event` en el selector «Room» | ✅ | `node qa/fixtures-sin-bridge.mjs` → `✔ html-fixtures pinta sin backend` (tiles `["tile_0_0"]`, 6 billboards). Captura `qa/capturas/sin-bridge-02-fixture-pintada.png`: `robledo_tile` con casas, camino, río, «Guardia Roric» y el prompt «E hablar con Alcaldesa Mirla» — nada cambió a la vista |
| **A6** `npm run verify` | ✅ | `ℹ tests 1936 · pass 1936 · fail 0` (build + typecheck src/scripts/labs + lint + test) |
| A6 · `npm run deuda` no crece | ✅ | `Deuda medida — 75 items` (criterio ≤ 76). Aviso esperado: «posiblemente obsoleta en 32 módulos» (mutación pendiente) |
| A6 · `formatDToWorld` CRAP 48 no sube | ✅ | `48.0  48  99%  formatDToWorld · scene-normalize.ts:94`; `Tope CRAP ≤ 73 — 0 por encima`; cobertura de líneas 89.1 % ≥ 89 % |
| A6 · cliente | ✅ | `nefan-html`: `npx tsc --noEmit` EXIT 0 · `npm run lint` EXIT 0 (no existe `npm test`, cierto: `package.json`). `narrative-mcp`: `tsc --noEmit` EXIT 0 |
| A6 · Python | ✅ | `python -m unittest discover -s ai_server/tests -t .` → `Ran 143 tests · OK` |
| A6 · candados en negativo | ✅ | `node qa/contrato-candados-en-negativo.mjs` → `Candados probados en negativo: 12 · Nacen rojos al romperlos: 12 · NO se enteran: 0 · Patrón obsoleto: 0`. Árbol limpio después |
| A6 · batería | ✅ | `node qa/run.mjs 40 62 65 16 30 31` → **6 en verde · 0 en rojo** (capturas `…T11-57-28-269Z-97981`). `node qa/run.mjs 05 44 46 48 58 60` → **6 en verde · 0 en rojo** (`…T11-59-56-912Z-100188`). Guion 40 reeditado (ver § Guion) → verde y probado rojo dos veces |
| A6 · CI verde en la PR | ⚠️ no probado | Sin push ni PR desde este worktree; el hook `ci-verde` lo exige al coordinador |
| #399 «ningún fichero del repo describe el snap a un char» | ✅ | Fuera de `docs/agents/*` (informes de tandas anteriores, históricos por definición) y `docs/auditoria-2026-08.md:132`, cero prosa viva. `scene-expand.ts` cabecera: «la del decor pegado al muro se retiró (#399)» — dice que murió, no cómo funcionaba |
| Impacto en el jugador | ✅ ninguno visible | Mismo render, mismos rótulos, mismos saves del banco. Lo único observable es en un checkout con saves/snapshots ANTERIORES (ver hallazgo 2) |

## Hallazgos

### 1 · IMPORTANTE — el zod de `place_anchors` no es «espejo exacto del saneador Python», y el código y el informe dicen que sí
**Dónde**: `scene-schema.ts` (comentario sobre `place_anchors`: «Espejo exacto del saneador de ai_server»), `implementacion-a.md` («espejo exacto del saneador Python: `place_id` + `rect` de 4 enteros opcional, máx. 8»), `narrative_schemas.py:580-594`.
**Qué pasa**: el zod RECHAZA la forma mala; el saneador la PODA y acepta. Repro (`sondeo.mts` / `sondeo.py`, misma escena):

```
place_anchors 9 elementos   zod: RECHAZA → Array must contain at most 8 element(s)   py: ACEPTA · salida = 8 anchors
place_anchors rect de 3     zod: RECHAZA → at least 4 element(s)                    py: ACEPTA · salida = [{'place_id':'x'}] (rect fuera)
place_anchors rect 1.5      zod: RECHAZA → Expected integer, received float          py: ACEPTA · ídem
place_anchors sin place_id  zod: RECHAZA → place_anchors[0].place_id: Required       py: ACEPTA · salida = [] («malformado, descartado»)
```

**Por qué importa**: la conducta en sí es la tolerada para los bloques declarativos (`ground`/`volumes`/`scatter`: zod duro, ai_server laxo y salva el tile — lo mide guion 40, que ahora lo cuenta como quinto bloque y sale igual que sus hermanos). Lo que no vale es el texto: «espejo exacto» es una justificación escrita después que no se midió (`feedback_justificacion_no_verificada`), y quedará congelada en el comentario del schema. O se alinea Python (rechazar con nombre, como hace ya con la entity) o el comentario dice la verdad («la forma la endurece el zod; el saneador poda como con los demás bloques»).
**Qué esperaba**: que un comentario que dice «espejo exacto» lo sea, o que no lo diga.

### 2 · MENOR — `glyph` y `ambient_event`, retirados en esta PR, no reciben el motivo de «campo retirado» que sí tienen las otras cinco claves retiradas
**Dónde**: `sceneErrorMap`/`motivoDeClaveRetirada` (raíz) y `entityErrorMap` (entity) en `scene-schema.ts`; `_MOTIVO_DE_CLAVE_RETIRADA` en Python.
**Qué pasa**: `stage`, `style_ref`, `__expanded`, `terrain_legend`, `terrain_patches` vuelven con «con qué se sustituye… si viene de un save o snapshot, bórralo o regenéralo». `glyph` y `ambient_event` vuelven con el genérico escrito **para el motor**: «Lo que quisieras contar de ella va en `description`, que es de donde sale su aspecto» / «…va en `scene_description`». El único sitio por donde estas dos claves van a entrar en meses es un save o snapshot anterior a hoy — y ahí ese consejo no aplica.
**Medida del impacto (solo lectura sobre el principal, copia en scratchpad)**: `nefan-core/data/games/*/world/*.json` → **4 snapshots, 4 con `ambient_event`, 4 con `glyph`**. `alta_fantasia/world/tile.json` contra `ExpandedSceneSchema`: **9 escenas · aceptadas 0 · rechazadas 9**, todas por `entities[0]: la entity "barkeep"/"hito_*" trae la clave \`glyph\`…`. Camino real: `session.ts:473-475` captura, loguea `Bridge: world snapshot ilegible para "alta_fantasia"` y **cae al bootstrap vivo** (el motor genera el tile en cada partida nueva hasta que se regenere el snapshot). Saves: 0 en el principal hoy; cualquiera anterior diría en el título «Esa partida guardada ya no vale para esta versión del juego: bórrala o empieza una nueva» (guion 62 lo canda para el patrón), que es lo correcto para el jugador.
**Qué esperaba**: pre-producción, los saves viejos no importan — pero el patrón de la casa (`retired-terrain-fields.ts` existe para esto) es dar a la clave retirada su motivo, y esta PR lo extiende a tres claves más mientras deja fuera justo las dos que retira. Derivado operativo: regenerar los 4 snapshots del principal tras el merge (§ Derivados).

### 3 · MENOR — en Python, `terrain_legend`/`terrain_patches` llegan con el genérico; en el zod, con su motivo
**Repro**: `python sondeo.py` → `terrain_legend: RECHAZA → la escena trae la clave \`terrain_legend\`, que no existe en el contrato…`; zod → «`terrain_legend` está retirado: el terreno se declara con `biome` + …». `_MOTIVO_DE_CLAVE_RETIRADA` espeja `stage`, `style_ref`, `__expanded` y no los dos de terreno. Mejora neta respecto a `main` (Python los ACEPTABA mudos), pero el «espejo de motivos» está a medias.

### 4 · MENOR — el mensaje al motor lista `place_anchors` entre los campos «EXACTAMENTE» válidos, y el tool no se lo describe
`EMITTED_SCENE_FIELDS` incluye `place_anchors`; `generate_scene.json` no lo ofrece (lo canda `contract-prompts.test.ts`: la brecha es exactamente esa). El motor lee un nombre sin esquema. Se resuelve con el issue derivado de `place_anchors` (o va al tool, o sale de la lista que se enseña).

### 5 · MENOR, HEREDADO (no de esta PR) — `h` y `name` de entity: el mismo tile tiene dos veredictos según la vía
Confirmada la divergencia que el ingeniero esquivó en el probe del guion 40 (desviación 5), con repro en los dos lados y en `main` (idéntico):

```
h negativa    zod: RECHAZA → entities[1].h: Number must be greater than 0     py: ACEPTA · h de salida=None (descartada en silencio)
h 25          zod: ACEPTA (sin tope)                                          py: ACEPTA · h de salida=None (0 < h <= 20, narrative_schemas.py:826)
name ausente  zod: RECHAZA → entities[1].name: Required                       py: ACEPTA · name de salida='roric' (rellena con el id)
```

`h 25` es la peor: **los dos aceptan** y la salida difiere (la altura se pierde por la vía API y no por la MCP) — guion 40 no la ve porque compara veredictos, no salidas. Va a issue con estas cifras; el guion 40 asevera desde hoy que `h negativa` y `name ausente` DIVERGEN (eje `campo-pendiente`), para que el día que alguien los alinee salte y el caso pase al eje `campo`.

### Notas (sin severidad)
- El grep literal de A4 en `requisitos.md` (`attach\|WALL_CHAR`) casa 12 identificadores ajenos; el criterio solo tiene sentido leído como el CAMPO, que es lo que canda `\battach(?!\()\b`. Que conste para quien lo vuelva a correr.
- El candado caza `attach (x)` (espacio antes del paréntesis) además de `attach:`; con el lint del repo es un caso que no ocurre.
- `docs/proto-motor-grafico.md:324` conserva `ambient_event` en un JSON-schema de un prototipo UE5 marcado como histórico. No es rastro vivo.

## Desviaciones del ingeniero, una a una

| # | Desviación | Medido | Veredicto |
|---|---|---|---|
| 1 | `refineRetiredTerrainFields` fuera (plan: conservar) | Motivos conservados en las DOS poblaciones (sondeo vs `main`), los dos campos nombrados en el primer issue, guion 62 verde, `retired-terrain-fields.test.ts` exige el texto | Correcta: con `.strict()` el `superRefine` era un segundo issue con el mismo texto que nadie vería |
| 2 | Parser de `repo-hygiene` quita el lookahead | 105 términos completos; el parser viejo perdía `ambient_event`. 8/8 | Correcta; renombrar cuatro métodos `attach(` vivos por un candado habría sido peor |
| 3 | `ambient_event` al candado | Python lo inyectaba en cada escena (`:540` en `main`), exactamente el caso `terrain_features`. `\b` deja `ambient_events`/`ambient_log` | Correcta |
| 4 | `stage` con motivo propio | En `main` el zod ACEPTABA `stage` con `tile` (passthrough); ahora los dos gates lo rechazan nombrando `tile`/`generate_tile` | Correcta y además cierra un mudo que nadie había medido |
| 5 | Probe del guion 40: «h negativa» → «cell no numérica» | Divergencia confirmada (hallazgo 5). Guion 40 afirmaba «ningún campo diverge» sin cubrir esos dos | Correcta no bloquear PR-A con deuda ajena; pero el guion necesitaba decirlo — ahora lo asevera como pendiente |
| 6 | Allow-list Python = tool + `place_anchors` | Los dos sentidos tienen test (zod⊃tool acotado a `place_anchors`; tool⊃zod ya existía); Python lee el tool en import. Si el tool gana un campo, Python lo acepta y el zod tiene que declararlo o `contract-prompts` rompe | Coherente. Riesgo residual: la FORMA de `place_anchors` no está espejada (hallazgo 1) |
| 7 | `npm test` no existe en `nefan-html` | Cierto (`package.json`): lint + `tsc --noEmit` | Correcta |
| 8 | `cc8c89c` candado obsoleto | El invariante «guardia débil» corría `contract-prompts.test.ts`, pero el guardia vive en `contract-terms.test.ts` desde #347: romper `ui_systems.md` daba VERDE. Reapuntado; hoy nace rojo (12/12). 5 líneas en `qa/`, nada roto | Correcta, y era el trabajo que nadie hace |

## Calidad de los tests y fixtures nuevos
- Las tres fixtures negativas caen **solo** por su clave (probado quitándola: ACEPTA), así que si `attach`/`glyph`/el `.strict()` volvieran al schema se pondrían rojas. Con dientes.
- `scene-schema.test.ts`: «clave de raíz desconocida» exige la clave, cada campo de `EMITTED_SCENE_FIELDS` y la AUSENCIA de `size`/`terrain`; `place_anchors` con tres formas malas y el tope; `ExpandedSceneSchema` estricto con la marca en la lista. `retired-terrain-fields.test.ts` pasa de contar issues a exigir los dos nombres en el PRIMERO (que es lo que ve el motor): mide lo que importa.
- `scene-expand.test.ts` reescrito sobre un tile real (grid 128×128, agua rasterizada y colisionando por `formatDToWorld`); pierde `makeScene` con `W` y el test del snap. Cobertura perdida declarada: ninguna viva (el snap no ocurría).
- `test_el_saneador_no_inyecta_campos_que_el_motor_no_emitio` (claves salida == entrada) es el candado del patrón `terrain_features`, y lo comprobé también con las tres escenas del motor falso.
- `contract-prompts.test.ts` «la brecha es EXACTAMENTE `place_anchors`»: probado rojo por el guion de candados (añadir `nota_del_motor` al shape).
- Ninguno es «verde sin dientes»: los 12 invariantes del guion de candados nacen rojos; los tres probes de arquitectura con fichero temporal, rojos.

## Guion
`qa/guiones/40-el-mismo-tile-no-puede-tener-dos-veredictos.mjs` (+33 −4, sin espera por reloj): `place_anchors` como **quinto bloque declarativo** (tres casos: 9 elementos, `rect` de 3, sin `place_id`) y eje nuevo **`campo-pendiente`** (`h negativa`, `sin name`) con la aserción «los N campos PENDIENTES siguen divergiendo (si ya coinciden, pásalos al eje `campo` y cierra su issue)».
- Positivo: `node qa/run.mjs 40` → `✔ los 5 bloques declarativos se comportan IGUAL entre sí` · `✔ los 2 campos PENDIENTES siguen divergiendo` · 1 en verde.
- Negativo 1 (9 anchors → 8, válido en los dos): `✘ los 5 bloques… fuera de línea: place_anchors: zod=ACEPTA/py=ACEPTA,zod=RECHAZA/py=ACEPTA` · 1 en rojo.
- Negativo 2 (`h: -1` → `h: 1`): `✘ los 2 campos PENDIENTES… entity h negativa: zod=ACEPTA · ai_server=ACEPTA` · 1 en rojo.
- Restaurado (`diff` contra la copia = solo mis líneas); `architecture.test.ts` 69/69 con el guion editado.

## Workarounds usados
1. `npm ci` en `qa/` (faltaba `qa/node_modules` en este worktree; `nefan-html/public/sprites/` ya estaba copiado). Dependencias del banco, no del juego: un checkout normal las tiene. No afecta al usuario.
2. `git archive 4ca0c50` de `nefan-core/src`, `data` y `ai_server/narrative_schemas.py` al scratchpad con `node_modules` enlazado, para comparar mensajes con `main` sin tocar otro checkout. Solo lectura.
3. Fichero temporal `nefan-core/src/qa-tmp-candado.ts` para probar el candado en negativo; borrado (`git status` limpio).
4. Dos ediciones temporales del guion 40 para probarlo en negativo; restauradas de una copia.
5. Copia de `data/games/alta_fantasia/world/` del principal al scratchpad para medir el hallazgo 2. El principal no se ha tocado.
Ninguno es un obstáculo que el usuario tenga delante.

## No probado y por qué
- **CI verde en la PR**: no hay push desde este worktree (detached). Lo exige el hook al coordinador.
- **Mutación** de `scene-schema`/`scene-normalize`/`contrato-escena`: ningún módulo cabe en `tope_local`; `npm run mutacion -- pendiente` la pide (corrida completa por tocar `data/contract/`). No bloquea.
- **Motor real por MCP** (`play`): el mensaje que recibe el motor se verificó con `validateContract(EmittedSceneSchema)`, que es exactamente lo que llama `narrative-mcp/validators.ts:23`, no con una sesión MCP viva (créditos y un motor humano detrás).
- **ai_server como proceso** (FastAPI): se ejerció `validate_scene_response` en subproceso, la misma función que usa el endpoint; el servidor no se levantó.
- **`h 25` como veredicto**: guion 40 compara veredictos, no salidas; esa divergencia solo está en este informe y en el issue.

## Derivados que deben ir a issue (antes de cerrar la PR)
1. **`W` en `DEFAULT_SOLID_CHARS` sin productor** — ya previsto (plan §9b): 52 literales en 5 tests. Lo abre el coordinador.
2. **`place_anchors`**: sin productor real (0 en prompts y tool), forma dura en el zod y poda muda en Python (hallazgo 1), y el motor recibe su nombre en la lista de campos sin tener esquema (hallazgo 4). Un issue con las tres cifras; guion 40 lo mide como quinto bloque.
3. **Divergencias zod↔ai_server en campos de entity**: `h ≤ 0` (zod rechaza / Python descarta), `h > 20` (los dos aceptan, Python pierde la altura), `name` ausente (zod rechaza / Python rellena con el id). Repro arriba; guion 40 asevera dos de las tres como pendientes y el issue debe citar ese eje.
4. **Regenerar los 4 snapshots pre-generados del principal** (`data/games/*/world/`): hoy 9/9 escenas de `alta_fantasia` ilegibles por `glyph` → bootstrap vivo en cada partida nueva. Operativo, tras el merge; si no se hace, el «snapshot ilegible» se loguea para siempre.
5. Opcional en esta PR o issue menor: motivo de campo retirado para `glyph` y `ambient_event` (hallazgo 2) y los dos de terreno en Python (hallazgo 3).

## Cifras del entorno
`npm run verify` 1936/0 · `npm run coverage` líneas 89.1 % · `npm run crap` máx 48 (`formatDToWorld` 48, 0 sobre el tope) · `npm run deuda` 75 · html `tsc`/`lint` OK · mcp `tsc` OK · Python 143 OK · candados 12/12 · batería 12/12 + `fixtures-sin-bridge` + guion 40 reeditado · `./start.sh --parar` al final: «nada que parar aquí».
