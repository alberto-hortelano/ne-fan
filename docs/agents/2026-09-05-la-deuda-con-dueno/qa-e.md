**VEREDICTO: APTO CON HALLAZGOS** — el criterio de cierre literal de #408 se cumple y está candado; el hallazgo 1 (el fake solo ancla el lugar del tile la PRIMERA vez que lo genera, así que en la segunda sesión del mismo stack el jugador vuelve a aparecer en el centro del tile) es un defecto del banco introducido por esta PR y conviene cerrarlo antes de mergear: es una línea, y sin ella la frase «el banco recorre el mismo camino que el juego» solo es verdad en la primera partida de cada corrida.

# QA-E · PR #459 (issue #408) — `place_anchors` se retira

Worktree `/home/al/code/ne-fan-t13-qa-e`, HEAD `295017d`, `NEFAN_PORT_OFFSET=900`, preset `e2e-sin-creditos` (cero créditos; `--parar` al terminar, bloque 900 libre al salir: `ss -ltn` sin 3900/10777/10778/19665). Python del `.venv` del checkout principal, `unittest` como CI. No se tocó nada fuera de este worktree; el único cambio en el árbol son los dos guiones nuevos y sus filas en `qa/README.md`.

## Criterio de cierre literal

> «`place_anchors` o lo pide el tool o no existe; en ningún caso queda como campo que solo escribe el banco. `EMITTED_SCENE_FIELDS` y la brecha zod→tool quedan en cero.»

| Criterio | Veredicto | Evidencia |
|---|---|---|
| `place_anchors` no existe en el contrato ni lo escribe el banco | ✅ | `grep -rn place_anchors` (ts/py/json/md/mjs, fuera de `node_modules|dist|archivo|docs/agents`) → **6 ficheros**: `retired-terrain-fields.ts`, `retired-terrain-fields.test.ts`, `campos_retirados.py`, `arch-rules.json`, `architecture.test.ts` (los 5 exentos) + `fixtures/scene/invalid/escena_con_anclas_de_lugar.json` (negativa, exenta por fichero). `fake-scenes.ts` ya no lo emite. Saves/snapshots locales: `grep -rl` en `data/games/*/world` y `saves` → ninguno |
| `EMITTED_SCENE_FIELDS` = raíz del tool, brecha zod→tool = `[]` | ✅ | `contract-prompts.test.ts` «lo que el zod acepta y el tool NO ofrece es EXACTAMENTE nada» en verde dentro de `npm run verify`; su negativo (el zod gana `nota_del_motor`) nace rojo en el candado headless (abajo) |
| El zod rebota `place_anchors` nombrando el sustituto | ✅ | Con la fixture, `EmittedSceneSchema` → `` `place_anchors` está retirado: la escena no ancla lugares: el motor los ancla con `map_upsert_place.anchor {tx, ty, rect}`, que ya existe. Si viene de un save o snapshot, bórralo o regenéralo ``; `ExpandedSceneSchema` → el mismo issue (más `size`/`terrain`/`__expanded` requeridos, que es lo esperable de una escena cruda). Sin el campo, `Emitted` la acepta (el rebote no es ruido) |
| El espejo Python dice LO MISMO | ✅ | `validate_scene_response(payload)` → **la misma cadena, carácter a carácter**. Sin el campo, acepta. **Confirmado que ningún test mide esa paridad**: `test_contract_fixtures.py` compara veredicto (acepta/rechaza), no mensaje, y `test_toda_clave_retirada_vuelve_con_su_motivo_en_la_raiz` recorre el propio registro Python. Lo mide desde hoy `qa/los-dos-gates-rebotan-igual.mjs` (headless; probado en negativo cambiando «existe»→«existía» en `campos_retirados.py` → rojo nombrando los dos textos). Ese guion además destapa divergencias ANTERIORES a #408 (hallazgo 3) |
| Los dos rebotes tienen candado con negativo | ✅ | `retired-terrain-fields.test.ts` «`place_anchors` en la raíz (#408) vuelve con el canal que lo sustituye, en las dos poblaciones»; `architecture.test.ts` «las anclas de lugar de la escena (#408) saltan donde reaparezcan, y el anchor vivo no»; fixture negativa cazada en el candado headless por «la raíz vuelve a ser muda». Los negativos que declara el informe no los repetí: el candado headless entero sí (14/14) |
| El jugador aparece dentro del lugar (flujo real, `./start.sh` vía `qa/run.mjs`) | ⚠️ **a medias** | Primera sesión del stack: destino `tile_2_0`, anchor `{tx:2,ty:0,rect:[48,68,32,20]}` en `GET /map`, spawn **(128, 7)** dentro del rect del lugar; vuelta a `tile_0_0` en **(0, −4)**, dentro del rect de la taberna `[52,48,24,16]`. **Sesión posterior en el mismo stack (73 detrás de 08/09, o `--adoptar`)**: anchor `{tx:2,ty:0}` SIN rect, spawn **(128, 0)** = centro del tile → hallazgo 1. El 09 lo corrobora sin saberlo: su ledger de la ida dice `spawnAplicado {x:128,z:0}` |
| Guiones 01, 08, 09, 40 verdes | ✅ | `NEFAN_PORT_OFFSET=900 node qa/run.mjs 01-arranque 08-viaje 09-viaje 40-el-mismo 73-el-jugador` → `✔ 01 · ✔ 08 · ✔ 09 · ✔ 40 · ✘ 73` (el 73 rojo por el hallazgo 1). 08 y 09 salen verdes CON el anchor perdido porque solo afirman «dentro del tile» |
| El banco usa el canal real como lo usaría el motor | ✅ con matices | El fake hace `POST /map/place` (`STATE_API` del bloque desplazado) con `{id, kind, parent_id, name, description, anchor:{tx,ty,rect}}` — las mismas claves que `bridgePost('/map/place', …)` de `narrative-mcp/server.ts:718` (el MCP añade `approx_*`/`attrs` en `undefined`). El motor real DISPONE de `tx`, `ty` y `place` en `generate_tile` (`types.ts:317-342`), así que puede hacer exactamente lo mismo, también en el bootstrap (`tx:0,ty:0`). Matices: el fake no manda `x-nefan-session` (el MCP la manda con sesión activa; el guardia de `dispatch.ts` deja pasar la ausencia), y el fake traga con `.catch(console.error)` un rechazo del State API — el banco seguiría en verde (hallazgo 1) |
| Lo que muere no deja hueco en el juego vivo | ✅ | El fallback «deducir el lugar por el único anchor» solo lo alimentaba el banco (el motor real nunca emitió `place_anchors`). Sin `place_id` habiendo lugares: `runBootstrapTile` lanza, la cola difunde `narrative_status: error` y el jugador lee **«El motor narrativo no pudo construirlo; inténtalo de nuevo.»** con el diagnóstico (`place_id`, «salidas») en el log del bridge — `bridge-map.test.ts:762` lo sujeta y se conserva; `bootstrap-place.test.ts` conserva 5 casos (declara / no declara con lugares / declara inexistente / sin lugares / la raíz no cuenta). Fail-loud, no silencio. La forma del rect (4 enteros, ≤8 anclas) que validaba el campo muerto vive ahora en el zod de la tool (`.int()`, `.length(4)`); el `AnchorSchema` del bridge acepta 4 números sin `.int()` ni cotas — igual que antes de esta PR para ese canal, no es regresión (hallazgo 5) |
| Candado headless | ✅ | `node qa/contrato-candados-en-negativo.mjs` → **14 probados · 14 nacen rojos · 0 no se enteran · 0 obsoletos**; árbol limpio después. El sabotaje nuevo («el tile sin `biome` vuelve a recibir hierba por defecto») lo caza `invalid/tile_sin_biome.json`; la fixture nueva sale cazada en «la raíz vuelve a ser muda» |
| `npm run verify` | ✅ | `tests 2085 · pass 2085 · fail 0`, exit 0 |
| `npm run deuda` | ✅ | 15 fronteras + 11 CRAP + 57 supervivientes = **83** |
| `crap --check` | ✅ | «✔ dentro de los umbrales» (tope ≤ 73: 0 por encima) |
| Python | ✅ | `python -m unittest discover -s ai_server/tests` → `Ran 231 tests · OK` |

## Hallazgos

### 1 · IMPORTANTE — el fake solo ancla el lugar de un tile la PRIMERA vez que lo genera; en la sesión siguiente el jugador aparece en el centro del tile

`labs/narrative/fake-ai-server.ts:210-227`: el `POST /map/place` con `anchor {tx, ty, rect}` del lugar está DENTRO de `if (!tileByKey.has(key))`. `tileByKey` es caché del proceso del fake, no de la sesión: la segunda partida que genera `tile_2_0` (otro «Regenerar mundo», o el guion siguiente de la misma corrida) recibe el tile cacheado y el upsert no ocurre. El bridge se queda con el anchor sin rect que fijó `runPlaceTravel` y resuelve el spawn al centro del tile. Antes de la PR el rect viajaba en la escena cacheada, así que se aplicaba en TODAS las sesiones: es una regresión de fidelidad del banco introducida aquí. Además el `.catch((err) => console.error(...))` de ese mismo `POST` hace que un rechazo del State API tampoco pare nada: 08 y 09 siguen verdes.

- **Repro** (desde el arranque): `NEFAN_PORT_OFFSET=900 node qa/run.mjs 08-viaje 73-el-jugador` → el 73 rojo en «el motor acotó molino_bench_place con un rect…» (`{"tx":2,"ty":0}`), spawn `(128, 0)`. Alternativa: `node qa/run.mjs --keep 73-el-jugador` (verde) y a continuación `node qa/run.mjs --adoptar 73-el-jugador` (rojo). Log del fake sin ninguna línea `[fake-ai] anchor del lugar:` — no falló el POST, no se hizo.
- **Esperaba**: que el motor del banco ancle el lugar en CADA generación, como haría el real (que responde a cada `generate_tile` sin caché), y que un fallo del upsert ponga el banco en rojo, no en `console.error`.
- **Guion que lo caza**: `qa/guiones/73-el-jugador-aparece-dentro-del-lugar.mjs` (navegador). A propósito NO declara `aisla: ["fake-ai"]` (que sí vacía `tileByKey`): taparía justo esto.

### 2 · IMPORTANTE (fuera del criterio literal; para issue) — nada le dice al motor REAL que afine el anchor con un rect

Tras la retirada, el ÚNICO camino para que el jugador aparezca dentro del lugar (y no en el centro del tile) es que el motor llame a `map_upsert_place` con `anchor.rect` mientras construye el tile. La descripción de la tool lo ofrece como opcional («optionally bounded to a cell rect») pero **`data/contract/prompts/tile_instructions.md:38-48`** («THE PLACE THAT LIVES HERE») no lo menciona: dice que «el bridge ancló el lugar a estas coordenadas» y nada más. `grep -rn anchor data/contract/prompts` → 0 menciones del rect. Es el mismo patrón que motivó #408, un nivel arriba: el comportamiento «aparece dentro del lugar» lo ejerce hoy el banco y ningún texto lleva al motor real a ejercerlo. No probado con motor real (créditos). Esperaba una línea en `tile_instructions.md`: «si el lugar ocupa una parte del tile, acótalo con `map_upsert_place(anchor:{tx,ty,rect})` antes de responder: el jugador aparecerá dentro».

### 3 · MENOR (preexistente, lo destapa el guion nuevo) — los dos gates NO dicen lo mismo para `glyph`/`attach`

`qa/los-dos-gates-rebotan-igual.mjs` → 5 divergencias, ninguna de `place_anchors`: (a) el zod rebota `glyph`/`attach` en la **raíz** con su motivo de retirada (`mensajeDeClaveRetirada` es una sola tabla «raíz y entity juntas») y Python con el genérico; (b) en la **entity** el rótulo difiere: zod `la entity "p" trae …`, Python `entity 'p' trae …`. La docstring de `campos_retirados.py` («los MISMOS que los del zod, palabra por palabra») es falsa para entity. Vienen de #399/#400, no de esta PR. El guion queda rojo hasta que se cierren; por eso no entra aún en `candados-headless` (fila en `qa/README.md`, tabla «Fuera»).

### 4 · MENOR — prosa que engaña al siguiente agente

- `labs/narrative/fake-ai-server.ts:184-186` («así el jugador aparece dentro de la taberna»): falso para el bootstrap. El spawn de arranque es la celda del `player` (`[64,70]` → `(0.25, 3.25)`), FUERA del rect de la taberna (x −6..6, z −8..0); el anchor con rect solo se nota en la VUELTA (`(0, −4)`) y en la activación por posición. El informe del ingeniero repite la frase.
- `src/world-map/bootstrap-place.ts:33-34` («`error` va redactado para el MOTOR: llega hasta él por el mismo canal que el resto de rechazos»): no llega al motor. Llega al log del bridge; el jugador ve la frase genérica y nadie pide re-respuesta (`bridge-map.test.ts:762` lo documenta así). La PR reescribió el fichero y dejó la frase.
- Cuatro menciones históricas de «las anclas de lugar» que no nombran el identificador: `scene-schema.ts:23,:235`, `narrative_schemas.py:117`, `contract-prompts.test.ts:214`. Cuentan que se retiró (honestas), pero son cuatro veces el mismo párrafo; «los rastros confunden a los agentes».

### 5 · MENOR (observaciones fuera del alcance de la PR)

- El `AnchorSchema` del bridge (`request-schemas.ts:80-84`) acepta `rect` de 4 números sin `.int()` ni cota al tile; el zod de la tool sí exige enteros. Un rect fuera de 0..128 daría un spawn fuera del tile. No lo introdujo esta PR (el campo muerto tampoco acotaba), pero al ser ahora el ÚNICO canal, merece la comprobación que tenía el otro.
- Captura `73-…-02-dentro-del-lugar.png`: el spawn dentro del rect del molino cae pegado a la fachada sur del edificio del lugar (`rect [50,50,28,18]`), mirando a un muro a un metro: el jugador aparece «dentro del lugar» viendo solo tablero. Es la geometría del fake, no del juego, pero la captura no vende nada. Y la barra de vida «Bandido de camino 60» del tile de partida sigue pintada en el tile del molino (HUD de hostiles sin limpiar al viajar; preexistente).

## Workarounds usados

Ninguno en la receta: todo entra por el título (`regenerarMundo` → `nuevaPartida` → `comenzar` → click en «Salidas»). `--keep`/`--adoptar` y `QA_VERBOSE=1` se usaron solo para DIAGNOSTICAR el hallazgo 1 (leer el log del fake y reproducir con caché caliente), no para que nada pasara. Las hojas de sprites copiadas en `nefan-html/public/sprites/` las trajo el worktree ya preparado (estado de clon limpio, no del cambio). Los dos sabotajes (una palabra en `campos_retirados.py`; el `anchor` del lugar de partida en el fake) se revirtieron con `git checkout --` y el árbol quedó limpio.

## No probado

- Motor REAL anclando por `map_upsert_place.anchor` con rect (preset `play`: créditos). Lo que hay es prosa de la tool; hallazgo 2.
- El job `candados-headless` en el runner de CI (aquí solo en local; la PR está abierta, el hook `ci-verde` lo verá).
- Mutación de `contrato-escena` (290) y `world-map` (516): no caben en local; pedidas por trailer, como dice el informe.
- El hallazgo 3 en `main`: es anterior a la PR por lectura del código (`mensajeDeClaveRetirada` cubre raíz y entity desde #399/#400), no lo remedí sobre `main` porque ese árbol no es mío.

## Guiones dejados

- `qa/guiones/73-el-jugador-aparece-dentro-del-lugar.mjs` — **grupo NAVEGADOR** (`qa/run.mjs`). Escena servida sin `place_anchors`; lugar de partida y destino anclados CON rect en `GET /map`; spawn dentro del rect del lugar (no solo del tile); activación por posición; vuelta dentro del rect de partida. Negativos: sin anchor de partida → criterio 2 rojo; caché caliente del fake → criterio 3 rojo (hallazgo 1). Fila en `qa/README.md`.
- `qa/los-dos-gates-rebotan-igual.mjs` — **grupo HEADLESS** (tsx + python3, ~5 s). Paridad palabra por palabra zod↔Python del rebote de cada clave retirada, raíz y entity, más «la base la aceptan los dos». Negativo: una palabra distinta en Python → rojo. Hoy sale rojo por el hallazgo 3; **no** está dado de alta en `ci.yml` (hay que cerrar el 3 y cronometrarlo). Fila en la tabla «Fuera» de `qa/README.md`.

## Comandos y salidas (resumen)

```
npm run verify                          → tests 2085 · pass 2085 · fail 0 · exit 0
npm run coverage && npm run crap -- --check → ✔ dentro de los umbrales
npm run deuda                           → 15 + 11 + 57 = 83
python -m unittest discover -s ai_server/tests → Ran 231 tests · OK
node qa/contrato-candados-en-negativo.mjs → 14 probados · 14 nacen rojos · 0 no se enteran · 0 obsoletos
NEFAN_PORT_OFFSET=900 node qa/run.mjs 01 08 09 40 73 → 4 en verde · 1 en rojo (73: hallazgo 1)
NEFAN_PORT_OFFSET=900 node qa/run.mjs --keep 73  → ✔ (primera sesión del stack: rect presente, spawn (128, 7))
NEFAN_PORT_OFFSET=900 node qa/run.mjs --adoptar 73 → ✘ (caché caliente: anchor sin rect, spawn (128, 0))
PYTHON=…/.venv/bin/python3 node qa/los-dos-gates-rebotan-igual.mjs → place_anchors: mismo texto · 5 divergencias previas
NEFAN_PORT_OFFSET=900 ./start.sh --parar → ✅ stack cleaned (lo ajeno enumerado y no tocado)
```
