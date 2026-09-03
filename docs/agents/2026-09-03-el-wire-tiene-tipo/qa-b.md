# QA — T7 PR-B (#378 «El wire tiene tipo»)

**Fecha**: 2026-09-03 · **Rama**: `fix/el-wire-tiene-tipo-b`, HEAD `9474788` (un commit sobre `6dec076` =
PR-A, sobre `main` = `7970dcf` con PR-C) · **Worktree**: `.claude/worktrees/t7-el-wire-tiene-tipo` ·
**Validado contra**: la petición literal de `requisitos.md` (Alcance 1 con el bloque «Crítica:», criterios
A1, A2, A6, preguntas abiertas 1-2) y el cuerpo del issue #378, no contra `implementacion-b.md`.

## Veredicto: **APTO**

Ningún hallazgo bloqueante ni importante. Seis menores, cuatro de ellos derivables a issue (dos ya
estaban en el plan §6 como backlog). Todo lo que se pidió medir está medido en el flujo real
(`e2e-sin-creditos`, 0 créditos), con los candados probados en negativo.

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **A1** `grep -rn "as Record<string, unknown>"` en `nefan-html/src/world`, `main.ts`, `ui/style-apply.ts`, `bridge/wire-scene.ts`, `bridge/sim-collision.ts` → 0 sobre la escena | ✅ | Única línea: `main.ts:83` (`combatConfigJson`, no la escena) |
| **A1** `grep -rn "WorldSceneDelBatch\|POSICION_DECLARADA\|__format_d"` en core, bridge, cliente, `qa/`, `labs/`, docs, `ai_server`, `narrative-mcp` → 0 | ✅ | Solo aparecen en tests que afirman la AUSENCIA (`"__format_d" in w === false`), en un comentario de test (`mundo-persistido.test.ts:319`, ver H2) y en la prosa histórica de `client-file-size.json` |
| **A1** `WorldScene` sin `[k: string]` ni `Record` | ✅ | `grep -n "Record<string, unknown>\|\[k: string\]" scene-normalize.ts` → solo `raw:` de `formatDToWorld` (la población persistida, a propósito), prosa y el texto del candado |
| **A1** candado de tipo: `position_declred` NO compila | ✅ | Sin la directiva: `scene-normalize.ts(379,41): error TS2339: Property 'position_declred' does not exist on type 'NpcEnElWire'` |
| **A1** candado de tipo: un índice `[k: string]: unknown` en `WorldScene` pone rojo | ✅ | `scene-normalize.ts(382,1): error TS2578: Unused '@ts-expect-error' directive`. Con el índice en `NpcEnElWire`: `(380,1) TS2578`. Con `WorldScene = Record<string, unknown>` (el estado de antes): 4 errores (`sim-collision.ts:73,74`, `mundo-persistido.ts:243`, el candado). El índice en `WorldScene` NO lo caza el candado del npc: hacen falta los dos (desviación 5, confirmada) |
| **A2** el tipo no cambia el wire salvo lo retirado a propósito | ✅ | `robledo_tile` servido por `escenaParaElWire` en `6dec076` vs `9474788` (script `wire-dump.mts`, contexto `makeCtx`): solo antes `['__format_d']`, solo después `['place_id', 'vegetation_zones']`, **comunes que difieren: `[]`**; `vegetation_zones` y `place_id` valen lo mismo que dentro de `__format_d`. Bytes: **48.818 → 27.583 (−43,5 %)** (la crítica: 49.104 → 27.364 sobre otra base) |
| **A2** el cliente pinta una fixture del selector «Room» | ✅ | `node qa/fixtures-sin-bridge.mjs` → `✔ html-fixtures pinta sin backend` (captura `sin-bridge-02-fixture-pintada.png`) |
| **A2** guiones 16, 30, 31, 58, 60, 65, 66, 67 | ✅ | `node qa/run.mjs 16 30 31 58 60 65 66 67` → **8 en verde · 0 en rojo** (capturas `qa/capturas/2026-09-03T12-40-44-692Z-167041`) |
| **A2** los guiones reapuntados miden lo mismo | ✅ | 16 y 31: `__format_d?.vegetation_zones ?? s.vegetation_zones` → `s.vegetation_zones` (valor idéntico, medido arriba). 65: `place_id` del miembro (idéntico). 30: `entitiesArbol` pasa de contar `kind:"tree"` del crudo a contar objetos cuyo `volume_id` es un volumen `tree` del plan — mide lo que el paso 3 dice («cada uno deriva su volumen y queda marcado») y es MÁS fuerte: perder `volume_id` o el objeto lo pone rojo, antes no |
| **`exits` lo dice el tipo** | ✅ | `formatDToWorld` no emite `exits` (test `scene-normalize.test.ts:63` + guion 68 en el wire); `EscenaServida = WorldScene & { exits: SceneExit[] }` solo la devuelve `alWire`; el cliente lo escribe en `carga-de-tile.ts:164` sobre `entry.scene: EscenaServida`, no sobre `WorldScene` |
| **`formatDToWorld` lanza** ante lo que no es Format D expandido | ✅ | Sonda: `formatDToWorld(worldScene)` → `formatDToWorld: la escena no es Format D expandido (falta size.cols/rows, terrain[] de strings o entities[]); claves: scene_id, scene_description, dimensions, …` (nombra las claves). En el juego: guion 68 paso 6 (`__nefan.addTileRaw(__nefan.scene)` rechaza con ese mensaje y la escena sigue puesta). Llamantes vivos fuera de TS: **0** (`grep formatDToWorld( labs qa` → solo `labs/narrative/check-scene.ts`, sobre Format D); `change_scene` → 0 |
| **`solo-el-bridge-normaliza-la-escena`** (max 2) | ✅ | Llamadas en el cliente: `main.ts:793` (`addTileRaw`) + `style-apply.ts:205` = 2 (antes: `carga-de-tile.ts` + `style-apply.ts` = 2). No es escapatoria: antes el cliente re-normalizaba TODO lo que llegaba del bridge (amparado por la guarda `__format_d`); ahora solo la fixture y el hook del banco. Ver H6 sobre la regla |
| **Trinquete** `client-file-size.json` en el mismo commit | ✅ | `wc -l`: `main.ts` 2316 (= C), `style-apply.ts` 533; el JSON pasa de 543 → 533 en `9474788` |
| **A6** `npm run verify` | ✅ | `pass 1952 · fail 0` (`build` + `typecheck:scripts` + `typecheck:labs` + `lint` + `test`) |
| **A6** deuda no crece; `formatDToWorld` ≤ 48 | ✅ | `crap`: `47.0 47 99% formatDToWorld · scene-normalize.ts:181`; `Tope ≤ 73 — 0 por encima`; cobertura 89,1 %; `deuda`: **75 items** |
| **A6** `cd nefan-html && npx tsc --noEmit && npm run lint` | ✅ | `tsc exit=0` · `eslint .` exit 0 |
| **A6** `npm test` de nefan-html | ⚠️ no existe | `package.json` de `nefan-html` no tiene script `test` (#241/#357): el criterio no es medible tal como está escrito |
| **A6** batería `qa/run.mjs` entera | ver «Batería entera» abajo | |
| **A6** CI verde en la PR | ⚠️ no probado | Sin push (instrucción); lo mide el hook `ci-verde.sh` al abrir la PR |
| **Mutación** | ⚠️ no medida | Ningún módulo cabe en `tope_local` (scene-normalize 229, mundo-persistido 308, entidades-del-tile 139); pedida con `pendiente`; `deuda` avisa «posiblemente obsoleta en 32 módulos». Se cierra con la corrida completa (#404) |
| **Guion nuevo** `qa/guiones/68-la-escena-servida-es-lo-que-dice-el-tipo.mjs` | ✅ verde, y rojo en negativo | Verde: `1 en verde · 0 en rojo` (arranque 31.248 bytes, grid ×1; resume igual). **Negativo**: con `__format_d: raw` de vuelta en `formatDToWorld` → `0 en verde · 1 en rojo` (rojos: «el crudo no viaja dentro — ["__format_d"]», «la raíz solo lleva miembros del tipo», «el grid viaja UNA vez — ×2»; 54.368 bytes) en las DOS puertas; y `tsc` también: `TS2353 '__format_d' does not exist in type 'WorldScene'`. Restaurado (`git status` limpio) |

## Calidad de los tests nuevos (¿verde sin dientes?)

- «no emite ni `exits` ni el crudo entero» (`scene-normalize.test.ts:63`): afirma tres ausencias y una presencia con valor (`place_id === "taberna"`) y la ausencia de clave sin place estampado. Tiene dientes: el negativo de arriba (`__format_d: raw`) lo pondría rojo por `"__format_d" in w`.
- «una world scene ya normalizada NO vuelve a entrar: lanza» y los 5 casos «lanza nombrando las claves»: comprueban el mensaje Y que cada clave del payload aparece en él. Bien.
- Candados de tipo: probados en negativo arriba (4 variantes, todas rojas).
- `bridge-tile`/`bridge-session`: `"__format_d" in wire === false`, `exits` lista, `"size" in wire === false` — son las mismas afirmaciones que el guion 68 hace en el juego real.
- Lo que se perdió (declarado por el ingeniero): los tests de formas que el tipo hace inexpresables (`objetosDeclarados(null)`, listas que no son listas, `npcsFueraDelRect("npcs")`). Es coherente con el tipo, pero ver H1: una de esas «formas imposibles» (objeto sin `name`) sigue siendo posible en runtime y ya no la mide nadie.

## Desviaciones del ingeniero, una a una

1. **`formatDToWorld` lanza en vez de devolver verbatim** — correcto y medido (arriba). El único llamante que dependía del verbatim (`sim-collision.ts`) ya envolvía en `try/catch` con `console.warn`; ese aviso es del bridge, no llega al jugador — pero una escena persistida que no sea Format D expandido no pasa el gate `.strict()` del loader (PR-A), así que hoy no hay productor.
2. **`declaraciones` sigue mirando id/posición/duplicado sobre la lista tipada** — legítimo (#379 produce errores que el jugador ve). Lo incoherente es que el mismo argumento («JSON de otro proceso») no se aplica a `name`/`category` en `leerObjeto` → H1.
3. **`Effect.data` sigue siendo `Record`** — irrelevante tras apilar sobre C: el `case "spawn_entity"` con `data.scene` desapareció y `main.ts` queda con **0 casts sobre la escena** (`grep " as EscenaServida\| as WorldScene" nefan-html/src` → 0).
4. **`addTileRaw` en `main.ts`** — no es escapatoria del candado (mismo recuento, mejor semántica: la única normalización local es la fixture/el banco). Sí deja la regla con prosa vieja → H6.
5. **Dos candados de tipo** — necesario, comprobado: el índice en `WorldScene` no lo caza el del npc.
6. `mundo-persistido.test.ts` deriva los tipos con `ReturnType` en vez de importarlos (reparto de mutación) — bien, pero luego los abre con `as Array<Record<string, unknown>>` → H2.

**Apilado sobre C**: `SceneLoadedEffect.scene: EscenaServida` ✓; `case "scene_loaded"` sin cast (`scene.place_id`, `scene.tile`) ✓; la rama sin `tile` hace `resetWorld(); addTile(scene)` — sujeto: solo un save con una escena sin `tile` (el loader la admite hasta #405); ninguna fixture del selector carece de `tile` (las tres lo llevan), así que en el banco esa rama no se ejercita. Consistente con #405; no es de esta PR.

## Hallazgos

**H1 · menor** — *Los lectores tipados del core confían en `name`/`category` y no en `id`/`position`.*
`entidades-del-tile.ts:leerObjeto` lee `rec.name` y `rec.category` tal cual; con un JSON que no cumpla la promesa
del tipo, `ObjetoDeclarado.nombre` es `undefined` bajo un tipo `string` y no sale ningún error, mientras que en la
misma función un `position` roto o un id duplicado SÍ se dicen (#379).
Repro (sonda `sondas.mts`): `objetosDeclarados([{ id: "x", position: [0,0,0], scale: [1,1,1], category: "prop" }])`
→ `nombre: undefined · errores: []`; `npcsDeclarados([{ id: "y", position: [0,0,0] }])` → `{"id":"y","pos":…}` sin
nombre y sin error. Productor vivo: **ninguno** (`formatDToWorld` lanza sin `name`, y `addTileRaw` pasa por él), por
eso es menor. Lo que esperaría: o el mismo trato que id/posición (se dice), o que la cabecera de `declaraciones`
diga por qué `name` se cree y `position` no.

**H2 · menor** — *Los tests abren la salida tipada con `as`.* `mundo-persistido.test.ts:129,131,145,171,173,181,194,205`
(`salida.npcs as Array<Record<string, unknown>>`, `bandido.combat as Record<…>`) y `scene-normalize.test.ts:16`
(`objectsOf(w: Record<string, unknown>)`): siete lecturas de `escenaConCombateVivo(): WorldScene` que tiran el tipo
que la PR acaba de poner, de modo que un miembro mal escrito en el test no lo ve `tsc`. Además
`mundo-persistido.test.ts:319` cita `POSICION_DECLARADA` en un comentario (rastro de lo retirado;
`feedback_rastros_confunden_a_los_agentes`). No afecta al jugador.

**H3 · menor · derivado a issue** — *La huella del `TileStore` incluye `exits` y `actualizarSalidas` la muta sin
refrescarla.* `tile-store.ts:83` (`JSON.stringify(tile.scene)`, y `scene: EscenaServida` lleva `exits`);
`carga-de-tile.ts:164` (`entry.scene.exits = salidas`) no toca `fingerprints`. Al re-difundirse el mismo tile con
salidas nuevas (viaje a un lugar YA realizado tras un enlace, guion 65 tramo A/B), `sceneChanged` sale `true` y
`applyPlanCollision` re-deriva la colisión del plan aunque la escena no cambió. Efecto: CPU; determinista, no
visible. **No medido en el flujo** (no hay hook que exponga `sceneChanged`). Ya en el plan §6.7 como backlog:
abrir el issue con estas líneas.

**H4 · menor · observación** — *`formatDToWorld` deja caer en silencio las claves de raíz que el tipo no declara.*
Sonda: `formatDToWorld({...robledo, foo: 1, ambient_evnt: "x"})` → ni `foo` ni `ambient_evnt` en la salida, sin
aviso. Por construcción (emite un literal cerrado) y el gate real es `ExpandedSceneSchema.strict()` (PR-A) para
todo lo persistido; la vía local (`addTileRaw`: fixtures del selector y banco) no pasa por ningún gate, pero
`test/scene-fixtures.test.ts` canda las fixtures. También: en proceso, `tile`, `volumes`, `scatter_*` y
`__plan_warnings` viajan como claves con valor `undefined` (`"volumes" in w === true`); el JSON las quita y en el
wire no se ven (guion 68 lo confirma). Nada que arreglar hoy; que quede escrito.

**H5 · menor** — *Código muerto que el tipo dejó al descubierto*: `style-apply.ts:264`
`npc.description ?? npc.name ?? npc.id` — con `NpcEnElWire.name: string`, el `?? npc.id` no puede ejecutarse.
Cosmético.

**H6 · menor · derivado a issue** — *La regla `solo-el-bridge-normaliza-la-escena` no cuenta lo que ahora
significa.* `arch-rules.json`: `desc: "El cliente 2D no llama a formatDToWorld por su cuenta"`, `max: 2`. El
recuento no cambia (2 → 2), pero el sentido sí: antes el cliente re-normalizaba TODO lo del bridge (doble
normalización, amparada por la guarda `__format_d`); ahora solo la fixture/el banco (`main.ts:793`) y el batch de
estilo (`style-apply.ts:205`, que normaliza Format D del snapshot para leer el plan). La regla debería decir cuáles
son las dos y por qué, o bajar a 1 cuando el batch pida el plan al bridge. Prosa preexistente («2D»), no de esta PR.

**Observado en capturas, no atribuible a PR-B**: en `58-…-02-tile-re-emitido.png` el panel de errores muestra
ruido del banco (skins `fake-ai: paladin no tiene sheet walk/frontal_8 (esperado en bench…)` y «el bridge mueve al
NPC barkeep y el cliente no lo tiene en escena» — el guion 58 carga una fixture sobre una partida viva). Las
capturas de 60-02 (Maqueta 3D reanudada), 65, 66 y 68 muestran el tile, el HUD, el panel de salidas y el log
legibles y sin cambio visual: PR-B es un cambio de tipo y el wire lleva los mismos valores (A2).

## Workarounds usados durante la prueba

- Para medir el «antes» (A2) monté un worktree temporal desacoplado de `6dec076` en el scratchpad con
  `node_modules` enlazado, y serví `robledo_tile` por `escenaParaElWire` con el contexto de prueba (`makeCtx`) en
  los dos árboles. No es un obstáculo del jugador; el «después» además está medido en el bridge real por el guion
  68. Worktree retirado (`git worktree remove` + `prune`).
- Para los negativos (candados de tipo y guion 68) modifiqué `scene-normalize.ts` y lo restauré con
  `git checkout --` tras cada medida; `git status` limpio al terminar (solo `qa/guiones/68-…` y este fichero nuevos).
- El paso 6 del guion 68 (`__nefan.addTileRaw(__nefan.scene)`) usa el hook DEV del banco, que es exactamente la
  puerta por la que un `.mjs` sin tipo podría normalizar dos veces: es el sujeto, no un atajo.

## No probado, y por qué

- **Mutación** de `scene-normalize`, `mundo-persistido`, `entidades-del-tile`: fuera de `tope_local`; pedida.
- **CI** de la PR: sin push.
- **`npm test` de nefan-html**: no existe el script.
- **H3 en el flujo**: no hay hook que exponga `sceneChanged`; evidencia solo por lectura de código.
- **Rama sin `tile` de `case "scene_loaded"`**: sin productor en el banco (todas las fixtures llevan `tile`;
  solo un save con escena sin tile la ejercitaría, #405).
- **History browser [H]** con `SessionDataEnElWire`: solo lee `loaded_at`/`entities`; cambio de tipo sin cambio
  de lectura, no abierto en el flujo.

## Batería entera (`node qa/run.mjs`)

Corrida completa sobre `9474788` + el guion 68, lanzada tras el negativo (fichero restaurado):
`67 en verde · 0 en rojo de 67 · capturas en qa/capturas/2026-09-03T12-45-28-831Z-170588` · `exit=0` · 0 `⊘`.
Con esto A6 «batería entera verde» queda ✅ (la fila de la tabla remite aquí).

## Derivados a issue (para el coordinador)

1. H3: huella del `TileStore` y `exits` (plan §6.7).
2. H6: la regla `solo-el-bridge-normaliza-la-escena` con su prosa «2D» y su `max` sin motivo escrito.
3. Los que ya lista el ingeniero y confirmo: `SceneRecord.scene_data: Record<string, unknown>` (5 firmas de Format D
   sin tipo: `formatDToWorld:raw`, `wire-scene.ts:94,114`, `context.ts`, `exits.ts`); `terrain.color` y
   `dimensions.height` sin lector.

## Guion entregado

`qa/guiones/68-la-escena-servida-es-lo-que-dice-el-tipo.mjs` — mide en el bridge REAL (arranque y resume) que la
escena servida no lleva rastro del crudo, que `exits` va encima, que cada clave de raíz/objeto/npc es un miembro del
tipo, que el grid viaja una vez, que todo `name` es texto, y que normalizar dos veces desde JS se dice. Cero
créditos, sin esperas por reloj, probado en negativo (arriba).

## Re-validación (vuelta de QA: `181b51c` sobre `7631998`, rama rebasada sobre `main` = `0b56cb2` con PR-A)

Alcance: solo lo que cambió en la vuelta (H1, H2, H5) y que el resto siga en pie. Medido el 2026-09-03.

| Qué | Veredicto | Evidencia |
|---|---|---|
| H1 · `leerObjeto`/`leerNpc` confían en el tipo | ✅ | `grep -n "numeros(\|texto(" entidades-del-tile.ts` → solo `texto(rec.id)` (`:231`), `numeros(v, 3)` dentro de `punto` (`:206`) y la prosa de `:257`: lo que se sigue mirando es id, posición y duplicado, y se dice. `leerObjeto` lee `name`/`category`/`scale` tal cual; `sizeXZ`/`sizeY` salen siempre de `scale`. Coherente con la cabecera nueva («mirar a medias era lo peor de los dos mundos») |
| H2 · `POSICION_DECLARADA` a cero | ✅ | `grep -rn POSICION_DECLARADA nefan-core nefan-html/src qa labs docs/arquitectura CLAUDE.md` → 0 (también fuera del comentario de `mundo-persistido.test.ts`) |
| H2 · casts de tests sobre la salida tipada | ✅ con residuo | `mundo-persistido.test.ts`: 0 (`:417` abre `EntityRecord.data.combat`, que sí es `Record`: legítimo). `scene-normalize.test.ts`: `objectsOf` tipado; los `d.entities as Record<…>[]` son sobre la ENTRADA Format D (legítimos). Quedan **tres** sobre la salida: `:148` `w.terrain_grid as Record`, `:351` `npc.combat as Record | undefined`, `:437` `formatDToWorld(conRef) as Record` (para un `"style_ref" in w`). Residuo menor, no bloquea |
| H5 · `?? npc.id` fuera | ✅ | `style-apply.ts:265`: `const prompt = npc.description ?? npc.name;` |
| H3 / H6 | a issue | #410 y #411 (los abre el coordinador) |
| `npm run verify` sobre `181b51c` | ✅ | `ℹ pass 1950 · ℹ fail 0` · `verify exit=0` |
| Guion 68 sobre `181b51c` | ✅ | `1 en verde · 0 en rojo de 1` (arranque y resume: sin crudo, `exits` lista, solo miembros del tipo, grid ×1, todo `name`; segunda normalización lanza). Capturas `qa/capturas/2026-09-03T12-58-42-303Z-187153` |
| Árbol | limpio | `git status --short` vacío; `qa-b.md` y el guion 68 ya commiteados por el ingeniero |

**Veredicto final: APTO.** Los tres hallazgos corregibles están corregidos; el residuo (tres `as` en
`scene-normalize.test.ts` sobre la salida tipada) es menor y puede ir con la próxima pasada por ese fichero. No
se re-corrió la batería entera ni `coverage/crap/deuda` sobre `181b51c` (cambio confinado a dos lectores, tres
tests y una línea del cliente; el ingeniero reporta 47 / 0 por encima / 75, sin motivo para dudarlo).
