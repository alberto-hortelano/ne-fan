# QA — T6 «El save sabe dónde estás» (#395 + #382 + #179)

**Fecha**: 2026-09-02 · **Rama**: `fix/el-save-sabe-donde-estas` (`e55f98d`, cuatro commits sobre `6d3d7ac`) en el
worktree `.claude/worktrees/t6-el-save-sabe-donde-estas` · **Preset**: `e2e-sin-creditos` en todo momento (cero
créditos; el guardarraíl del runner lo confirma en cada guion) · **Capturas**: `qa/capturas/2026-09-02-t6-qa/` del
worktree · **Guion nuevo**: `qa/guiones/65-el-save-y-las-salidas-en-los-bordes.mjs` (+ su fila en `qa/README.md`),
sin commitear.

Validado contra la petición literal («Adelante con T6», con la decisión «la parte central hay que dejarla bien pero
los plugins… baja prioridad») y los criterios A1–A6 de `requisitos.md`, desde el punto de vista de quien juega.

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **A1** (#395) viaje por «Salidas» → el save recoge `active_scene_id` Y `player.position` del destino sin guardado forzado → Reanudar aparece en el destino. Maqueta 3D e Imagen IA | ✅ cumple | Guion 60 (`node qa/run.mjs reanudar-pinta`): `✔ #395 · el save recoge el viaje por «Salidas» sin que nadie lo fuerce` en los DOS bloques; Maqueta 3D `tras reanudar: {"activeTile":"tile_1_0","textured":["tile_1_0"]}`. Sin `guardarConLaPosicionDelDestino` (`grep` = 0 en `qa/`). Guion 65 amplía a las **dos ramas** que la crítica separó y al cruce a pie: viaje a lugar sin realizar (`runPlaceTravel`) ✔, vuelta a pie a `tile_0_0` ✔, segundo viaje al molino YA realizado (`difundirPlaceRealizado`, la rama que guardaba antes del spawn) ✔; `tras reanudar: {"tile":"tile_1_0","pos":{"x":64,"z":7}}` dentro del rect. **Negativo**: con `if (cambioDeTile && false)` en `tile.ts` el 60 cae en Maqueta 3D (`ultimo: {"active":"tile_0_0","position":[0.25,0,3.25]}` y `antes tile_1_0 · ahora tile_0_0`); en Imagen IA el aserto sigue VERDE con la guarda anulada (el `/scene/asset_refs` del atlas guarda de paso), como declara la cabecera del guion: el bloque que discrimina es Maqueta 3D |
| **A2** (#382) save con `barkeep.position = [168.25,0,168.25]` → Reanudar → el panel nombra al NPC y la coordenada, la escena carga; posición dentro de OTRO tile → «— sin errores —» | ✅ cumple (literal) | Guion 63: panel `["Errores (1)","narrative … La partida guardada pone a Tabernero corpulento en (168.3, 168.3), donde no hay mundo: no lo vas a encontrar."]`, `✔ la escena carga igual`; negativo con `[66,0,7]` (rect de `tile_1_0`) → `["— sin errores —"]` tras 33 sondeos. Nombre visible (`data.name`), no el id. Captura `63-…-01-viva-fuera-del-mundo-en-el-panel.png`. **Negativo**: con `if (rects.length >= 0) return []` el 63 cae (`✘ el panel DICE…`, 394 sondeos, panel «— sin errores —»). Guion 65: dos NPC fuera → UNA línea que nombra a los dos (`…pone a 2 personajes donde no hay mundo (Tabernero corpulento en (168.3, 168.3), Bandido de camino en (-300.5, 12.0)): no los vas a encontrar.`), escena cargada. El aviso sale una vez por Reanudar (no hay re-`resume_session` automático al reconectar: `bridge-client.ts` solo reabre el socket) |
| **A2** adversarial: `position` que no es array / ausente | ❌ NO cumple | Guion 65 bloque D y guion temporal (borrado): con `barkeep.position = null` o sin `position`, **Reanudar revienta** en el bridge ANTES del aviso —`el handler de 'resume_session' reventó: TypeError: Cannot read properties of null (reading '0') at AmbientNpcBehavior.addNpc (src/simulation/npc-behavior.ts:225) at npcSync (bridge/context.ts:485) at handleResumeSession (session.ts:647)`— y el jugador vuelve al título con «No se pudo reanudar la partida. El servidor del juego no pudo completarlo; inténtalo de nuevo» (captura `65-…-04-d-position-nula.png`). La rama «no-array → NaN» de `entidadesFueraDelMundo` solo la alcanza un array con no-números (`["x",0,0]` → aviso «(NaN, NaN)»). Ver H-2 |
| **A3** (#179) `map_link` a mitad de sesión → panel con el destino sin `scene_init` ni POST de atlas → Reanudar → sigue; renombrado → etiqueta nueva | ✅ cumple (literal) | Guion 64: `salidas tras el link: {"exits":["Molino del bench","Ermita del guion 64"],…}` · `desde el link: 7 frame(s) · scene_init 0 · POST de atlas/escena 0` · tras Reanudar las mismas · renombrado `["Molino renombrado por el guion 64","Ermita del guion 64"]` sin el nombre viejo. **Negativo**: con `onMapChanged: () => {}` en `ws-server.ts` caen «el panel ofrece el destino nuevo» y «renombrar…», y «tras Reanudar» sigue verde (el resume recalcula solo: son dos piezas, cada una con su rojo). Guion 65: **ráfaga** de tres links sin esperar → los tres en el panel (`["Taberna del bench","Ráfaga qa65_r1","Ráfaga qa65_r2","Ráfaga qa65_r3"]`); link **ajeno** (ermita→r1) → panel del activo intacto en 3 s y cero errores; link cuyo origen NO es el activo → el activo no cambia y no hay error falso; bootstrap (link antes de la escena) → el panel arranca con el molino (precondición del 64 y del 65) |
| **A3** adversarial: link a un lugar cuyo tile está CARGADO pero no activo | ❌ NO cumple | Guion 65 bloque B: jugador en el molino, `POST /map/link taberna→ermita` (200), `exits_changed` llega para `tile_1_0`; al volver **a pie** a la taberna (tile ya en memoria del cliente) el panel dice `{"exits":["Molino del bench"]}` — sin la ermita. Tras Reanudar sí (`["Molino del bench","Ermita del guion 65"]`). Capturas `65-…-01-b-taberna-al-volver-a-pie.png` / `-02-a3-taberna-tras-reanudar.png`. Ver H-1 |
| **A4** sin `catch` mudos, sin `return null` sin canal, `.catch()` del bridge con `narrative_status: error`; cero rastros del modelo anterior | ✅ cumple (con un menor) | Diff `6d3d7ac..HEAD` leído entero: el único `.catch` nuevo es `guardarOAvisar` (log + `kind:"save"`); `return null` de `placeDeLaEscena` es un valor tipado y documentado («sin lugar»); `return []` de `entidadesFueraDelMundo` con rects vacíos, documentado. `grep -rn "isDirty\|markDirty\|\.dirty\b\|enrichSceneWithExits" nefan-core nefan-html qa labs docs` = solo el `why` de `arch-rules.json` y **docs históricos** de tandas anteriores (`docs/agents/2026-08-23-salidas-en-vivo/*`, `2026-08-31-…/critica.md`, `2026-09-01-…/requisitos.md`, `2026-08-20-…/qa.md`). La palabra «dirty» queda en `tile.ts:320` (docstring) y en la cabecera del guion 60, ambas contando el pasado. Ver H-5. `exits` en `bridge/` + `src/` solo en `salidas.ts`, `wire-scene.ts`, `world-map/exits.ts`, `protocol/messages.ts`, `state-http/context.ts`. Candado `las-salidas-no-se-sellan-en-la-escena` presente y probado en negativo por el propio test |
| **A5** `verify` · `crap --check` · `deuda` sin subir · batería completa · `main.ts` ≤ 2321 · build del cliente | ✅ cumple | Re-corrido por QA en el worktree: `npm run verify` → exit 0, **1926 tests, 0 fallos** (26,8 s); `npm run coverage && npm run crap -- --check` → `1209 funciones · cobertura 89.3% · complejidad máx 48 · Tope ≤ 73 — 0 por encima · ✔ dentro de los umbrales`; `npm run deuda` → **75 items**, y **medido por QA en la base `6d3d7ac`** con la misma herramienta (`git switch --detach` + coverage + deuda) → **75**: la deuda no crece y el «≤ 74» de los requisitos era una cifra desactualizada; `wc -l nefan-html/src/main.ts` = **2321**; `npm --prefix nefan-html run build` → `✓ built in 1.94s`. Guiones: 60, 63, 64 → 3/3 verde; 48, 49, 55 → 3/3 verde; **batería completa**: ver «Batería» abajo |
| **A6** comentarios de cierre en #395/#382/#179 y nota en #377 | ⚠️ no probado | Es del coordinador con la PR; desde el worktree no hay nada que medir. Los textos propuestos están en `plan.md` §«Comentarios de cierre» |

### Batería completa

`node qa/run.mjs` (sin filtro, stack propio del worktree, `pgrep -fa qa/run.mjs` vacío antes) → **63 en verde · 1 en rojo de 64**
(`qa/capturas/2026-09-02T17-41-37-159Z-357877/`). Los 63 verdes son los 61 previos + 63 + 64 (los mismos que el
ingeniero midió); el rojo es el guion 65 de QA, **solo** en los dos asertos de H-1 y H-2 (los otros 24 verdes). Ningún
`⊘` (nada sin medir). Con el 65 fuera de la batería la cifra del ingeniero (63/63) se reproduce.

## Hallazgos

### H-1 · importante · #179: un enlace a un lugar cuyo tile está cargado pero no activo no llega a su panel hasta Reanudar

**Pasos desde el arranque** (`node qa/run.mjs 65-` los ejecuta): `./start.sh --preset e2e-sin-creditos` → Nueva partida
(alta_fantasia, Maqueta 3D) → «Salidas» → Molino (llega a `tile_1_0`) → el motor crea `POST /map/place` (ermita) +
`POST /map/link taberna→ermita` → volver a la taberna **a pie** (cruzar el borde; en el guion, `setPlayerPos` a la
posición de arranque) → el panel «Salidas» de la taberna ofrece solo «Molino del bench».

**Qué esperaba el jugador**: la ermita que el diálogo le acaba de prometer, porque #179 promete que «un link creado a
mitad de sesión llega al panel». **Qué ve**: el panel viejo, hasta que cierra y reanuda (entonces sí: las salidas se
recalculan al servir).

**Por qué** (leído en el código, no arreglado): `difundirSalidasDelTileActivo` manda `exits_changed` **solo del tile
activo** (`bridge/salidas.ts`), y el cliente conserva `entry.scene.exits` de cada tile cargado tal como llegó
(`carga-de-tile.ts` `activarTile` lee esa copia al pisar el tile). Un link cuyo place no es el activo cambia las
salidas de OTRO tile que el cliente ya tiene y nadie se lo dice. Con el motor real es el caso «te espera en la
ermita; sale por la senda de la taberna» dicho mientras el jugador está en el molino. El viaje por «Salidas» al
tile ya realizado SÍ lo cura (re-difunde la escena); el cruce a pie, no.

### H-2 · importante · #382: una `position` que no es array tumba el resume entero con un error genérico, antes de que el aviso pueda salir

**Pasos**: partida nueva → editar el save: `entities[barkeep].position = null` (o borrar el campo) → Reanudar → título
con «No se pudo reanudar la partida. El servidor del juego no pudo completarlo; inténtalo de nuevo» (captura
`65-…-04-d-position-nula.png`). Log del bridge: `el handler de 'resume_session' reventó: TypeError: Cannot read
properties of null (reading '0') at AmbientNpcBehavior.addNpc (src/simulation/npc-behavior.ts:225) at npcSync
(bridge/context.ts:485) at handleResumeSession (bridge/handlers/session.ts:647)`.

**Qué esperaba el jugador**: lo que #382 promete —«se reporta sin bloquear la carga», con el NPC nombrado— o, si el
save no vale, la salida de #334/#336 («bórrala o empieza una nueva»). **Qué ve**: un consejo («inténtalo de nuevo»)
que no puede funcionar nunca, sin nombre ni motivo.

**Por qué**: en `handleResumeSession` el orden es `npcSync` (647) → `sessionDataForClient` (652, donde vive el
checker) → `session_started` → aviso (662). `npcSync` lee `record.position[0]` en `npc-behavior.ts:225` y revienta
antes. La rama «no-array → NaN» de `entidadesFueraDelMundo` y su test unitario están en verde sobre un caso que el
flujo real no alcanza (solo lo alcanza `["x",0,0]`, que además le enseña al jugador «(NaN, NaN)», ver H-3). La
primera resume de la misma sesión en el mismo proceso NO revienta (el registry de comportamientos ya tenía al NPC),
lo que hace el fallo intermitente. `src/simulation/npc-behavior.ts` está fuera de alcance por decisión del usuario;
lo que sí es del núcleo es que `loadSession` valida `scene_data` con el zod y **no valida `entities[]`**, y que el
aviso va detrás de quien revienta. Decisión para el coordinador: validar `entities[].position` al cargar (con la
salida de save inválido), o mover el checker/aviso delante de `npcSync`, o declararlo fuera de #382 con issue.

### H-3 · menor · #382: «(NaN, NaN)» en la frase del jugador

Con `position = ["x", 0, 0]` el aviso dice «…pone a Tabernero corpulento en (NaN, NaN), donde no hay mundo». `NaN`
es palabra de programador; la frase podría decir «en una posición ilegible». Único caso en que la rama NaN es
alcanzable hoy (ver H-2).

### H-4 · menor · idioma y formato del aviso

- Separador decimal: «168.3» (`toFixed(1)`); en español de España es «168,3».
- «no **lo** vas a encontrar» asume masculino: con «la tabernera» queda mal. En plural «no los vas a encontrar»,
  igual.
- La hora del panel de errores sale como «7:22:14 PM» (locale en-US). Preexistente, no de esta tanda.

### H-5 · menor · rastros de prosa del modelo anterior

El código vivo está limpio (`dirty`/`markDirty`/`isDirty`/`enrichSceneWithExits` = 0 fuera del `why` de la regla).
Quedan menciones que cuentan el pasado: `bridge/handlers/tile.ts:320` («Hasta #395 solo se marcaba un `dirty` que
nadie leía») y la cabecera del guion 60 (misma frase); y cuatro documentos de tandas anteriores en `docs/agents/`
que nombran `enrichSceneWithExits`/`markDirty` como si existieran (son registros históricos commiteados). Si el
«cero rastros» del usuario alcanza a la historia contada, hay que reescribir esas dos frases; los `docs/agents/` de
otras tandas son actas y no deberían tocarse.

### H-6 · menor · experiencia: el aviso de #382 detiene al jugador con un modal

El canal `kind:"restore"` (heredado de T5) pinta el aviso como overlay a pantalla completa «Tu partida vuelve
incompleta» con el spinner del loader encima del mundo, además de la entrada en el panel de errores (capturas
`63-…-01` y `65-…-03`). Para «falta un tabernero» es un freno grande: el jugador tiene que pulsar «Cerrar» antes de
jugar. Es el diseño del canal, no de esta tanda; se anota porque #382 es su segundo usuario y el patrón se consolida.

### Observaciones sin hallazgo

- `posTracking.tileKey` no se reinicia entre sesiones del mismo proceso (backlog (1) del plan, declarado por el
  ingeniero): tras Reanudar en la misma celda, el primer `input` no pasa por `activateByPosition`. No se observó
  ningún síntoma en el banco (la posición ya está en el save); queda anotado.
- `exits_changed` sale una vez por `map/place` y otra por `map/link` (2 frames por «lugar + enlace»); el cliente lo
  aplica de forma idempotente. Sin coste visible.
- `serialize()` de `WorldMapManager` devuelve la referencia (sin copia): llamarlo por escena al servir el resume no
  cuesta nada. Sospecha descartada.

## Workarounds usados durante la prueba

| Apaño | Dónde | Veredicto |
|---|---|---|
| `__nefan.setPlayerPos(x, z)` para el cruce a pie (guion 65) | bloques B y A3 | No afecta al usuario: el cliente activa el tile por `tileStore.getAt` en el game loop y el bridge recibe la posición por `input`, exactamente como andando 60 m; es el mismo verbo que usa el guion 60 (A4). Se declara en la cabecera del guion |
| Editar el save en disco (`entities[].position`) | guiones 63 y 65 | No es un apaño del producto: es la repro literal del issue (#382 exige save corrupto) |
| `request_tile (1,0)` por un segundo socket (guion 63) | negativo del 63 | Es el prefetch normal del cliente por otra vía; el tile entra en el save por el camino de siempre |
| Sabotaje de tres guardas (`cambioDeTile && false`, `onMapChanged: () => {}`, `rects.length >= 0`) | worktree, 3 líneas | Para la prueba en negativo; **revertido** (`git checkout --`, `git status` limpio respecto a HEAD) |
| `git stash -u` + `git switch --detach 6d3d7ac` para medir `deuda` en la base | worktree | Restaurado (`git switch` a la rama + `stash pop`; solo quedan `qa/README.md` modificado y el guion 65 nuevo) |
| Guion temporal `99-qa-tmp-position-nula.mjs` con `--keep` para leer el log del bridge | worktree | **Borrado**; su stack parado con `./start.sh --parar` (el runner del worktree; nada ajeno tocado: el launcher enumeró un :9878 ajeno y lo dejó) |

## No probado

- **A6**: comentarios en issues (del coordinador).
- **Mutación completa** (`mundo-persistido` 245, `world-map` 500+): pedida por el ingeniero; la autoriza el usuario.
- **Rojos verdaderos de #382 con el motor real** (hostil `engaged` en esquina cóncava; `goto_place` hacia un anchor de
  viaje fallido): el banco no los ejerce; quedan para la nota de #377.
- **`position: [NaN,0,0]` literal**: JSON no lo escribe; el equivalente que puede traer un save (`null`, ausente) es H-2.
- **Gasto real de créditos**: todo en `e2e-sin-creditos`; el contador del motor falso no se movió en Maqueta 3D (guion 60, bloque 2).
- **Dos clientes en la misma sesión** recibiendo `exits_changed` y el aviso `restore`: no hay guion multi-cliente en el banco.

## Veredicto (primera pasada, superado por la re-verificación de abajo)

**Apto con reservas.** Los criterios literales A1–A5 se cumplen y cada guion nuevo se pone rojo cuando se anula su
guarda; la deuda no crece (75 = 75 medido hoy en la base). Las reservas son dos y vuelven al ingeniero antes de
cerrar #179 y #382, o se declaran fuera de alcance con issue en el comentario de cierre: **H-1** (el panel de un tile
cargado pero no activo se queda viejo hasta Reanudar: el enunciado de #179 con un paso más) y **H-2** (una `position`
que no es array tumba el resume con un error genérico antes de que el aviso de #382 pueda salir; la rama NaN del
checker es inalcanzable en el flujo real). El guion 65 queda rojo en exactamente esos dos asertos y verde en los
otros 24, y es el que tiene que pasar cuando se corrijan.

## Re-verificación tras la vuelta (2026-09-02, commits `4542067` y `9df19e5`)

Solo lo que QA abrió; todo re-corrido por QA en el worktree, cero créditos, `pgrep -fa qa/run.mjs` vacío antes de
cada corrida, sin tocar servidores ajenos. Diff de la vuelta leído entero (`git diff e55f98d..HEAD`).

| Hallazgo | Veredicto | Evidencia |
|---|---|---|
| **H-1** (#179) link a un lugar cuyo tile está cargado pero no activo → al volver a pie el panel ofrece el destino | ✅ corregido | `difundirSalidasDeLosTilesCargados` (`bridge/salidas.ts`): un `exits_changed` por escena de `scenes_loaded` con lugar. Guion 65 bloque B: `salidas de la taberna al volver a pie (tras el enlace): {"exits":["Molino del bench","Ermita del guion 65"],…}` → `✔ #179 · al volver a pie a la taberna, su panel ofrece la ermita…`. Los demás asertos de #179 del 65 (activo intacto ante link ajeno, cero errores, ráfaga de tres, link entre ajenos) siguen verdes. **Negativo**: con `if (placeId === null \|\| sceneId !== activa) continue;` (solo el activo, el código de antes) → `✘ … — {"tile":"tile_0_0","exits":["Molino del bench"]}`, el rojo exacto de H-1. Revertido |
| **H-2** (#382) `position = null` / ausente / `["x",0,0]` → el título dice que el save no vale nombrando a la entidad, sin «inténtalo de nuevo» | ✅ corregido | `loadSession` valida `entities[].position` (`describirPosicionInvalida`) antes de mutar estado y lanza por la vía de save inválido. Guion 65 bloque D (UI, `null`): título «No se pudo reanudar la partida. Esa partida guardada ya no vale para esta versión del juego: bórrala o empieza una nueva.», panel `session … save_invalido: save "…": entities["barkeep"].position no es una coordenada [x, y, z] (recibido null) — … bórralo o empieza partida nueva`, sin escena montada → 4 asertos ✔. Por el cable (guion temporal, borrado; sesión SUELTA): `ausente` → `…(recibido undefined)`; `["x",0,0]` → `…tiene un componente que no es un número finito (["x",0,0])`; `[1,2]` → `…tiene 2 componentes en vez de 3`; `[7.75,0,-0.25]` → `ok:true`. Todos `ok:false` + `save_invalido` + `entities["barkeep"].position`. **Negativo**: con la validación anulada → tres rojos en D (`inténtalo de nuevo` de vuelta, panel sin la entidad tras 198 sondeos). Revertido. `npm run verify` → exit 0 (1928 tests) |
| **H-3** «(NaN, NaN)» | ✅ desaparece | La rama no-array/NaN de `entidadesFueraDelMundo` se borró (el tipo lo impide en `loadSession`); `["x",0,0]` ya no llega al checker: es save inválido (arriba). Borrado declarado en `implementacion.md` |
| **H-4** coma decimal y frase sin género | ✅ corregido | Guion 63: «…pone a Tabernero corpulento en (168,3, 168,3), donde no hay mundo: ahí no hay nada que encontrar.»; guion 65 (dos): «…(Tabernero corpulento en (168,3, 168,3), Bandido de camino en (-300,5, 12,0)): ahí no hay nada que encontrar.». `grep -rn "no lo vas\|no los vas" nefan-core qa` = solo el `doesNotMatch` del test. La hora «8:08:04 PM» del panel sigue en en-US (preexistente, no de la tanda) |
| **H-5** rastros de prosa | ✅ corregido | `grep -rn "dirty" nefan-core/bridge qa/guiones` = 0; `grep -rn "Hasta #395"` = 0. Docstring de `activateByPosition` y cabecera del 60 en presente. Los `docs/agents/` de otras tandas no se tocan (actas) |
| **H-6** aviso `restore` como modal | — sin cambio | Fuera de la tanda (heredado de T5), como acordado |

**Corridas**: `node qa/run.mjs 63- 64- 65-` → **3 en verde · 0 en rojo de 3** (`qa/capturas/2026-09-02T18-07-57-922Z-383521/`, copiadas
a `2026-09-02-t6-qa/`). El guion 65, ya adoptado y commiteado, pasa entero (28 asertos) y se pone rojo en su bloque al anular cada
una de las dos correcciones.

**Observación sin hallazgo** (salió al medir H-2 por el cable): si se edita el save mientras la sesión sigue VIVA en el primer socket
y se pide `resume_session` desde otro, el primer resume devuelve `ok:true` — no por un atajo del bridge (no lo hay: `loadSession`
siempre lee el disco), sino porque el propio save de #395 (primer `input` → `activateByPosition`) reescribe el fichero encima de la
edición. Con la sesión suelta (recarga de página, como hace el jugador) la validación muerde a la primera. Es la repro la que era
racy, no el producto.

**Workarounds de la vuelta**: sabotaje de dos líneas (`salidas.ts`, `narrative-state.ts`) revertido con `git checkout --`
(`git status` limpio); guion temporal `99-qa-tmp-position-variantes.mjs` borrado; ninguno afecta al jugador.

## Veredicto final

**Apto.** Los criterios literales A1–A5 se cumplen (primera pasada) y los dos hallazgos importantes de QA (H-1, H-2) están
corregidos y verificados en el flujo real, con sus negativos mordiendo; H-3, H-4 y H-5 resueltos. Quedan abiertos, y declarados,
solo lo que no es de esta tanda: A6 (cierres en los issues, del coordinador), la mutación completa (pedida) y H-6 (diseño del
canal `restore`, heredado).
