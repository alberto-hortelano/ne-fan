# QA · PR-0 (#231b) — `test/` tipa en CI · PR #449 (`t11/tests-tipan`, `51c88a1`)

2026-09-05 · worktree desprendido `/home/al/code/ne-fan-t11-qa0` (HEAD = `51c88a1`), bloque de puertos
`NEFAN_PORT_OFFSET=800`, cero créditos. Todo lo de abajo lo ejecuté yo en este árbol; las cifras que
copio del informe del ingeniero van marcadas como suyas.

**Criterio aceptado**: «`test/` tipa en CI con 0 errores, sin `as any` ni baseline; la cabecera de
`tsconfig.scripts.json` deja de citar un bloqueo caducado; los tests que mentían se arreglan o se borran
declarando la cobertura perdida».

## Tabla de criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| `npm run typecheck:tests` → 0 | ✅ | `tsc --noEmit -p tsconfig.tests.json` exit 0 (tras `npm run build`). |
| El paso está cableado en `verify` y en CI, y un error lo tumba | ✅ | `verify` = build → typecheck:scripts → typecheck:labs → **typecheck:tests** → lint → test; exit 0, 2068/2068 tests, 28,6 s. `ci.yml` job `nefan-core`: paso `npm run typecheck:tests` tras `npm run build`, sin `continue-on-error` en el workflow (grep = 0). **Negativo**: `echo 'const x: number = "s";' >> test/aim.test.ts` → `test/aim.test.ts(229,7): error TS2322` exit **2**; restaurado → exit 0. |
| Sin `as any`, `@ts-expect-error`, `@ts-ignore` en `test/` | ✅ | `grep -rn "as any\|@ts-expect-error\|@ts-ignore" nefan-core/test` → 0 líneas. |
| Sin baseline de errores tolerados | ✅ | `tsconfig.tests.json`: `extends`, `lib: ["ES2023"]`, `include`. Nada más. |
| Cabecera de `tsconfig.scripts.json` sin el bloqueo caducado | ✅ | `grep -rn "tanda del bosque" nefan-core --include=*.json --include=*.ts` → solo `mutation-targets.json` (×2) y `arch-rules.json` (×1), que son motivos vivos de baterías y reglas, no el bloqueo de #231. |
| Los tests que mentían se arreglan honestamente (15) | ✅ con matiz | Uno a uno en §3. El matiz es `casa_puerta` (H2): arreglado, pero «ahora mide la puerta» no lo sujeta ningún aserto. |
| Las aserciones reescritas siguen pudiendo fallar | ✅ (7 de 8) / ❌ (1) | §2: siete rojos al romper sujeto o invertir aserto; **la tabla `EJEMPLARES` sale verde con la puerta quitada, movida fuera del muro o sin `cutaway`** (H2). |
| `npm run crap -- --check` | ✅ | 1233 funciones · cobertura 89,1 % (suelo 89 %; el ingeniero midió 89,2 %) · CRAP ≤ 73: 0 por encima · ≤ 30: 7 por encima · «✔ dentro de los umbrales». |
| Cambio de contrato `InventoryItem { id }` coherente en las cinco puertas | ✅ | `types.ts`, `world-state.ts`, `common.ts`, `request-schemas.ts` (con `assertMirror`/`assertSameKeys`, antes exento), `narrative-mcp/server.ts` (descripción de `item_json`). `narrative-mcp`: `npm run build` exit 0. |
| State API responde 400 estructurado a `{item:{name:"x"}}` | ✅ | En vivo, §4. |
| El motor recibe un error legible por MCP | ✅ | narrative-mcp por stdio contra mi bridge: `isError: true`, texto `item.id: Required` (§4). |
| CI de la PR #449 | ✅ | `gh pr checks 449`: `nefan-core` pass 3m1s, `ai-server` pass, `narrative-mcp` pass, `nefan-html` pass. |
| Solape con PR-1/PR-2 | ⚠️ merge limpio, **typecheck rojo** | §6 / H1: `git merge` sin conflictos, pero `typecheck:tests` = 2 errores en el `describe` nuevo de PR-1. |
| Rastros («tanda del bosque», «#231(b)», «231b») | ✅ | Solo lo vivo: comentarios del propio cambio (`tsconfig.*.json`, `ci.yml`, 3 tests) y los motivos de `mutation-targets.json`/`arch-rules.json`. Pero ver H3: las cifras de esos comentarios no coinciden entre sí. |

## 1 · Candado y cableado

```
$ npm run verify           → exit 0 · ℹ tests 2068 · pass 2068 · fail 0 · real 0m28,6s
$ npm run coverage && npm run crap -- --check
  1233 funciones medidas · cobertura de líneas 89.1% · complejidad máxima 48
  Tope (no empeorar): CRAP ≤ 73 — 0 por encima. · Cobertura mínima: 89% — ahora 89.1%. ✔
$ echo 'const x: number = "s";' >> test/aim.test.ts && npm run typecheck:tests
  test/aim.test.ts(229,7): error TS2322: Type 'string' is not assignable to type 'number'.   exit=2
$ git checkout -- test/aim.test.ts && npm run typecheck:tests   → exit=0
```

`ci.yml` job `nefan-core` (líneas 45-55): `typecheck:labs` → `lint` → `build` → **`typecheck:tests`** →
`coverage` → `crap -- --check`. Un paso `run` que sale ≠ 0 tumba el job por defecto de Actions; no hay
`continue-on-error` ni `fail-fast` en el fichero. El comentario del paso dice por qué va detrás de `build`.

Nota: el ingeniero informa 2067 tests; yo cuento 2068 con la suite intacta. No afecta a nada, pero la
cifra de su informe no es la de este árbol.

## 2 · «Verde que no comprueba nada»: negativos de las aserciones reescritas

Método: romper el sujeto o invertir el aserto, correr SOLO ese fichero, restaurar con `git checkout --`
(`git status` a 0 tras cada uno).

| # | Clase | Qué rompí | Resultado |
|---|---|---|---|
| a | cast al wire → `in` | `bridge-session.test.ts`: `!("perspective" in started.state.world)` → sin `!` | **ROJO** `start_session ignora el campo legacy perspective` (pass 52 / fail 1) |
| b | unión estrechada por predicado | `bridge-map.test.ts:78` `readyDeSesion`: `m.kind !== "game_gen"` → `===` | **ROJO** 5 tests (spawn/tile del ready leídos sobre `undefined`) |
| c | `assert.equal(r.destino, …)` como estrechador | `status-rotulo.test.ts:85`: `"overlay"` → `"log"` | **ROJO** `escena de un VIAJE (trae placeId)` (pass 22 / fail 1) |
| e | sujeto de `removeInventoryItem` | `narrative-state.ts`: el `findIndex` casa también `item === itemId` | **ROJO** `removeInventoryItem removes by item id…` — el caso movido al blob de la entidad sigue mordiendo |
| f | gate nuevo | `request-schemas.ts`: `id: z.string().min(1)` → `.optional()` | **ROJO** `inventario: un ítem SIN id es 400…` (pass 29 / fail 1) |
| g | aserción por JSON del wire | `scene-normalize.ts`: `scatter_generators`/`scatter_zones` → `[]` en vez de `undefined` | **ROJO** 2 tests, incluido `una escena que no declara ningún opcional no emite ninguno` |
| j | fixture `PlanMask.blockerAt` | `scene-validate-pasadas.test.ts`: `blockerAt: () => null` | verde (77/77). **No es hallazgo**: `blockerAt` solo alimenta el mensaje de causa (`scene-validate.ts:519`), el test mide `isWalkable`. Fixture exigida por el tipo, no aserción. |
| d | **`casa_puerta` con `cutaway` + `doors`** | (1) sin `cutaway`; (2) puerta en `at: 40`, fuera del muro; (3) `doors: []` | **VERDE las tres** (42/42). Ver H2. |
| — | dobles `SceneGenOutcome` | `bridge-tile`/`game-gen`: `{delivered:false, motivo}` → `{delivered:true}` | verde (17/17). Esperable: nadie espera esa entrega en esos tests; es fixture, no aserto. |

Fixtures completadas con `""` (`grep '^+.*""'` en el diff de `test/`): solo `mundoDePrueba()` en
`helpers.ts`, y sus diez `""` son **exactamente los de `DEFAULT_WORLD`** (`narrative-state.ts:84-98`,
incluido `style_refs: { characters: [] }`): es el mundo de una sesión recién nacida, no un relleno.
`as unknown as` en el diff: 2, ambos en entradas adversariales deliberadas y comentadas
(`bridge-session:686` save legacy con `perspective`, `mundo-persistido:358` posiciones rotas). `if (x.kind !== …) assert.fail`: ninguno; los estrechamientos van por predicado en el `find` o por `assert.equal` sobre el discriminante, que fallan solos (b, c).

## 3 · Los 15 que mentían, uno a uno

| # | Test | ¿Honesto? | Por qué |
|---|---|---|---|
| 1-8 | `bridge-session` `ctx.sessionStorage.write` → `storage.write` | **Sí** | `makeCtx` (`helpers.ts:183-227`) crea UNA `MemorySessionStorage` y la pasa tanto a `new NarrativeState(storage)` como a `ctx.sessionStorage`; `storage` es esa misma instancia. El test sigue sembrando el disco que el resume lee; solo cambia el asa: la ancha (`SessionWriter`), que es la que `ws-server.ts` da al escritor único. Es el patrón que ya usaban 593/686. |
| 9-10 | `game-gen` `worldSnapshotPath(gamesDir, GAME, "tile")` → 2 args | Sí | La rama murió en v2; el test leía la ruta correcta por casualidad de firma. Verde en `verify`. |
| 11-12 | dobles de cola → `{ delivered: false, motivo }` | **Sí** | `scene-gen-queue.ts:30-34`: `delivered:false` = «terminé sin decirle nada al cliente». Un bloqueo de test que jamás difunde es exactamente eso; `delivered:true` habría afirmado una difusión que no ocurrió. El outcome no lo consume nadie en esos tests (probado: `true` también pasa), así que la elección es de honestidad del doble, no de cobertura. |
| 13 | `volume-metrics` `doors:[{side}]` → `{edge:"s", at:4, w:2}` + `cutaway:true` | **Arreglo sí; la frase «ahora mide» no** | `collision.ts:141-151`: sin `cutaway` el building es bloque macizo y las `doors` no se leen — cierto. Pero la tabla `EJEMPLARES` (`volume-metrics.test.ts:103-113`) afirma «huella ⊇ celdas sólidas», y tallar una puerta solo QUITA sólidos: no puede violar ese invariante. Los 48/40/36 del informe se midieron a mano y no están en ningún aserto. El test cambió de ejemplar (bien) pero sigue sin poder distinguir puerta de no-puerta (H2). El `gate` sí tiene su control (`:127-135`: 36 jambas + vano abierto). |
| 14-15 | `session_id = null` → `""` | **Sí** | `NarrativeState.session_id = ""` es el estado real sin sesión (`narrative-state.ts:179`); `doc-routes.ts:73` mira falsy. Los dos casos siguen en su rama (404 «no active session» / 500 «invalid JSON body»), verificados en `verify`. Con `null` el test afirmaba un estado que el tipo no admite y que ningún camino produce. |
| — | `narrative-state:209` `never[]` | Corrección al plan, cierta | Lo reproduce el tipo: `assert.deepEqual(x, [])` es `asserts actual is never[]`. No era agujero de `src`. El cambio de tipo en `src` se hizo igual con gate + test del 400: bien, porque un tipo sin gate mentiría. |
| — | `narrative-state:475` nota sin `id` → blob de entidad | Sí, cobertura conservada | Negativo (e) demuestra que el caso movido sigue detectando un `remove` que casa strings. |

## 4 · El cambio de contrato, en vivo

Stack propio: `NEFAN_PORT_OFFSET=800 NEFAN_GAMES_DIR=<scratch>/games NEFAN_SAVES_DIR=<scratch>/saves
./start.sh --preset e2e-sin-creditos` → fake-ai `:19565`, bridge `:10677`, State API `:10678`, HTML `:3800`.
Parado con `NEFAN_PORT_OFFSET=800 ./start.sh --parar` (lo ajeno en `:18965` enumerado y no tocado).

```
POST /entity/player/inventory {"item":{"name":"x"}}   → 400 {"ok":false,"error":"item.id: Required"}
POST … {"item":{"id":""}}                              → 400 "item.id: String must contain at least 1 character(s)"
POST … {"item":"una nota"}                             → 400 "item: Expected object, received string"
POST … {}                                              → 400 "item: Required"
POST /entity/boris/inventory {"item":{"id":"llave"}}   → 404 "entity \"boris\" not found"   (el gate va ANTES del lookup)
```

**MCP** (`node narrative-mcp/dist/server.js` por stdio con `NEFAN_URL_WORLD_STATE=http://127.0.0.1:10678`,
`NEFAN_EAGER_BIND=0`): `tools/call inventory_add {entity_id:"player", item_json:'{"name":"Llave sin id"}'}`
→ `isError: true`, texto `{"error": "item.id: Required", …}`. `item_json: "{roto"` → `item_json is not
valid JSON`. `tools/list` devuelve la descripción nueva: «"id" is REQUIRED (inventory_remove takes it by
id)». El pre-flight no vive en el MCP (solo comprueba JSON) sino en el bridge, y el 400 se relaya entero
al motor: legible y accionable.

**Caminos que escriben `player.inventory`** (`grep -rln inventory src`): (1) `addInventoryItem` ← State
API con gate ✅; (2) **`src/plugins/dispatcher.ts:278`** `PLAYER_WRITABLE = {gold, health, level,
inventory}` y `applyToState` (`:291-317`) asigna `write.value` tal cual en cualquier ruta
`player.inventory[…]`, sin mirar forma — **sin gate**, confirmado (H4); (3) `loadSession`
(`narrative-state.ts:566`) hace `{...DEFAULT_PLAYER, ...data.player}` sin validar los ítems, y
`FileSessionStorage.read` es `JSON.parse` sin zod (`session-storage.ts:87`).

**Saves con ítems sin `id`** (script propio sobre `MemorySessionStorage`, `SCHEMA_VERSION` actual,
`inventory: ["una nota suelta", {name:"Llave sin id"}]`):
```
loadSession → true
inventario cargado → ["una nota suelta",{"name":"Llave sin id"}]
removeInventoryItem('player','una nota suelta') → false
removeInventoryItem('player','Llave sin id') → false
```
Cargan en silencio y quedan inamovibles. Pre-producción: no importan; pero el tipo `InventoryItem[]` es
ahí una promesa, no una garantía (H4).

## 5 · Orden del paso de CI y clon sin `dist/`

`contract-fixtures.test.ts:18` importa `../../narrative-mcp/validators.js`, y `validators.ts:15` importa
`@nefan/core`, que resuelve por `package.json.types` → `dist/`. Es la **única** razón (con `dist/`
borrado sale exactamente ese error y ninguno más):
```
$ rm -rf dist && npm run typecheck:tests
  ../narrative-mcp/validators.ts(15,8): error TS2307: Cannot find module '@nefan/core' or its corresponding type declarations.   exit=2
$ npm run build && npm run typecheck:tests   → exit=0
```
`verify` local tiene el mismo orden (`build` primero). Quien corra `typecheck:tests` suelto en un clon sin
`dist/` ve UN error que no habla de tests ni dice «haz `npm run build`»: menor, ver H3-bis.

## 6 · Solape con PR-1 (#448) y PR-2 (#447)

Rama temporal `qa0-merge-prueba` sobre `51c88a1`, `git merge --no-ff --no-commit`:

- `origin/t11/snapshot-revalida` (PR-1): auto-merge de `style-application.test.ts` y
  `world-snapshot.test.ts`, **0 conflictos**.
- `origin/t11/ai-server-por-http` (PR-2) encima: auto-merge de `ci.yml` y `ia-servicios.md`, **0 conflictos**;
  el job `nefan-core` conserva los pasos en orden (`build` → `typecheck:tests` → `coverage` → `crap`).
- `npm run build` ✅ · `npm run typecheck:labs` ✅ (el `fake-anthropic.ts` de PR-2 tipa).
- **`npm run typecheck:tests` → exit 2**:
  ```
  test/world-snapshot.test.ts(514,19): error TS2304: Cannot find name 'NarrativeStatusMessage'.
  test/world-snapshot.test.ts(515,69): error TS2339: Property 'source' does not exist on type 'NarrativeStatusDeSesion | NarrativeStatusDeJuego'.
  ```
  `git blame`: ambas líneas son de `1028754` («Lo que se carga pasa por validateScene o no se sirve (#302)»,
  PR-1). PR-0 quitó `NarrativeStatusMessage` del import de ese fichero y PR-1 lo usa en su `describe`
  nuevo, leyendo `.source` sobre la unión sin estrechar — justo la clase de error que el gate existe para
  cazar. Los 4 tests de PR-1 pasan en runtime (37/37) porque `tsx` borra los tipos.
- Limpieza: `git reset --hard`, `git checkout --detach 51c88a1`, rama borrada, `dist/` recompilado desde
  HEAD, `typecheck:tests` en HEAD → 0.

## Hallazgos

### H1 · IMPORTANTE — Con PR-1 mergeada, el paso nuevo de CI se pone rojo (2 errores en código de PR-1)
- **Reproducción**: `git merge origin/t11/snapshot-revalida` sobre `51c88a1` → `cd nefan-core && npm run
  build && npm run typecheck:tests` → los dos errores de §6.
- **Qué esperaba el usuario**: que las tres PR de la tanda nazcan con el gate (plan §PR-0: «si no, cada una
  corre `npx tsc --noEmit -p tsconfig.tests.json` de la rama de PR-0 antes de mergear»). PR-1 no lo hizo.
- **No es un defecto de PR-0** —es el candado funcionando— pero la segunda PR que entre en `main` tendrá
  el CI rojo. Arreglo (2 líneas, en PR-1, no aquí): en `world-snapshot.test.ts:513-515` usar el predicado
  `(m): m is NarrativeStatusDeSesion => m.type === "narrative_status" && m.kind !== "game_gen" && m.phase
  === "ready" && m.source === "snapshot"` (el mismo que PR-0 dejó en `:290-291` del mismo fichero).
  Coordinar el orden: PR-0 primero y rebase de PR-1, o PR-1 incorpora el predicado.

### H2 · IMPORTANTE — «El ejemplar “building con puerta” ahora mide la puerta (40 → 36)» no lo sujeta ningún aserto
- **Reproducción** (`volume-metrics.test.ts:73`): quitar `cutaway: true` → 42/42 verde. Mover la puerta
  fuera del muro (`at: 40`) → verde. `doors: []` → verde. El único `it` que recorre `EJEMPLARES` afirma
  «huella ⊇ sólidos» y una puerta tallada solo resta sólidos.
- **Qué esperaba el usuario**: la regla de la serie —un test que no puede ponerse rojo es peor que uno
  intermitente— y el informe dice «Arreglado y ahora mide». Mide en el sentido de cobertura de línea
  (`collision.ts:151-158` se ejecuta), no en el de detectar un cambio: si mañana `collision.ts` deja de
  tallar `doors`, este fichero no se entera. Los 48/40/36 son medidas a mano que no viven en el código.
- **Qué falta** (para el ingeniero): un control como el del `gate` (`:127-135`): con `cutaway` y puerta,
  el centro del vano (`c ∈ [54,55], r = 55`) no está en `celdasSolidas`; sin puerta, sí; y opcionalmente
  `celdasSolidas(casa_puerta).length === 36`. O retirar la frase del informe y del comentario del test.

### H3 · MENOR — Tres cifras distintas para el mismo hecho en tres ficheros commiteados, una de ellas desmentida por el propio informe
- `tsconfig.tests.json:16-18`: «el 05-09 había **102** errores y **16** de ellos eran tests que mentían
  (una asa que la interfaz no tiene, una rama retirada, **un `never[]` en `src`**)».
- `.github/workflows/ci.yml:48-49`: «**96** errores … y **16** de ellos eran tests que MENTÍAN».
- `implementacion-0.md` y el título del commit: **96** y **15**, y demuestra que el `never[]` **no** era
  un agujero de `src` sino un `assert.deepEqual(x, [])`.
- Es exactamente la prosa que «se congela como documentación falsa»: quien lea `tsconfig.tests.json`
  dentro de un mes creerá que hubo un agujero de tipo en `src`. Unificar a 96/15 y quitar «en `src`».
- **H3-bis**: en un clon sin `dist/`, `typecheck:tests` da un solo error de `validators.ts` que no dice
  «corre `npm run build`». Añadir esa frase al comentario de `tsconfig.tests.json` (hoy solo está en
  `ci.yml`) costaría una línea.

### H4 · MENOR (fuera del alcance de PR-0 → issue) — `InventoryItem[]` promete más de lo que garantizan dos caminos
- Plugins: `dispatcher.ts:278` (`PLAYER_WRITABLE` incluye `inventory`) + `applyToState` (`:291-317`)
  escribe `write.value` sin forma en `player.inventory[…]`. Verificado por lectura; el ingeniero lo
  declara en «Qué NO queda cubierto». Es **hallazgo confirmado y candidato a issue**, no bloqueante:
  el requisito nombraba `inventory_add`, y los plugins son baja prioridad por decisión del usuario
  (2026-09-02). El arreglo natural es validar la forma en `applyToState` cuando el path toca
  `player.inventory`, o quitar `inventory` de `PLAYER_WRITABLE`.
- Carga: `loadSession` no valida ítems (§4). Pre-producción: no importa, pero el tipo ahí es promesa.

### H5 · OBSERVACIÓN (preexistente, fuera del alcance → issue) — El State API acepta escribir el inventario del jugador sin sesión activa
- `POST /entity/player/inventory {"item":{"id":"llave","name":"Llave"}}` con el bridge recién arrancado
  (sin `start_session`) → **200** y el ítem queda en memoria; el log del bridge: `StateHttpServer:
  onMutation failed: Error: NarrativeState.save: no hay sesión que guardar`. La mutación se acepta y el
  fallo de persistencia se traga en el log. No lo introduce esta PR (el 200 ya existía; el gate solo añade
  el 400), pero lo vi al probarla y no lo callo.

## Workarounds usados
- `NEFAN_URL_WORLD_STATE` y `NEFAN_EAGER_BIND=0` para hablar con narrative-mcp por stdio contra mi bridge:
  son palancas de configuración existentes (`bridge-http-client.ts:16`, `CLAUDE.md`), no ocultan nada al
  usuario, cuyo MCP apunta al bridge de su checkout por `runtime_config.json`.
- `NEFAN_GAMES_DIR`/`NEFAN_SAVES_DIR` aislados: exigencia del plan (los 4 tiles basura nacieron de no
  hacerlo). El bridge reescribió `runtime_config.json` al arrancar; `git checkout --` lo dejó como estaba.
- Ningún workaround afecta al jugador: PR-0 no tiene superficie visible en el cliente.

## No probado
- El CI **sobre el árbol fusionado** (§6 es local; el rojo de H1 lo verá la PR que entre segunda).
- narrative-mcp conectado a un Claude Code real (solo stdio guionizado). El texto que llega al modelo es el
  que capturé; su reacción no.
- Gasto de créditos: no aplica (nada de esta PR toca imagen ni motor).
- Mutación de `request-schemas.ts`: en `sin_mutar` con motivo (lo declara el ingeniero); su candado es el
  test del 400, que vi rojo con el gate relajado (§2-f).

## Guion en `qa/guiones/`
No dejo guion nuevo: todo lo mecánico de esta PR ya tiene candado permanente en el árbol (`tsc` vía
`typecheck:tests` en `verify`+CI; el 400 en `state-http-server.test.ts`, probado en negativo). Lo que falta
de candado (H2) es un aserto que debe escribir el ingeniero en el test que ya existe, no un guion de banco.

## Veredicto — APTO CON RESERVAS

PR-0 cumple el criterio literal: `test/` tipa con 0 errores en `verify` y en el job `nefan-core` del CI
(negativo visto rojo y restaurado), sin `as any` ni `@ts-*` ni baseline, con la cabecera de
`tsconfig.scripts.json` limpia y los 15 tests que mentían arreglados sin borrar ninguno. Siete de ocho
aserciones reescritas se ponen rojas al romperlas; el gate del inventario responde 400 estructurado en vivo
y el motor lo recibe legible por MCP; CI verde; `crap` dentro de umbrales; merge sin conflictos con PR-1 y
PR-2.

Las reservas, en orden: **H1** — la segunda PR de la tanda que entre en `main` tendrá el CI rojo por dos
líneas de PR-1 (`world-snapshot.test.ts:514-515`); hay que coordinar el orden o arreglarlas en PR-1 antes.
**H2** — el informe afirma que `casa_puerta` «ahora mide la puerta» y ningún aserto lo sujeta: verde con
la puerta quitada, movida o sin `cutaway`; añadir el control del vano o retirar la frase. **H3** — tres
cifras distintas (102/96, 16/15, «`never[]` en `src`») en `tsconfig.tests.json`, `ci.yml` y el informe;
unificar. H4/H5 son issues fuera del alcance (plugins sin gate; State API sin sesión), no bloquean.
