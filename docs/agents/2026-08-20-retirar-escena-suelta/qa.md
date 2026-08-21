# QA — retirar la escena suelta (Format D sin `tile` y sin `stage`)

**Rama**: `refactor/retirar-escena-suelta` · **Commit validado**: `49fb5a2` (el que me dieron) ·
**Re-comprobado en**: `ac0ca7c` (ver aviso)
**Fecha**: 2026-08-21 · **Coste**: 0 créditos (todo el juego real corrió sobre el preset 5 con
`fake-ai-server`; el 3D, offline sin bridge).

Validado contra la petición ORIGINAL de `requisitos.md`, no contra el plan. El ciclo no tuvo
fase de QA hasta ahora: esta es la primera pasada con ojos de jugador.

**Aviso sobre el entorno**: durante la pasada había **otra sesión trabajando en el mismo repo y
en esta misma rama**. Mientras yo probaba entraron dos commits (13:04 y 13:08) que no estaban
cuando empecé:

```
ac0ca7c El guardia de enlaces distingue el roto del que cuelga a propósito
d385de9 El visor del mapa encuentra su fixture, y un enlace roto ya no pasa
49fb5a2 Viajar a un lugar que no existe lo ancla a un tile del plano   ← lo que me dieron
```

Los dos arreglan un fallo REAL de esta retirada que yo no había llegado a ver — está como
**Hallazgo 0**, con la comprobación de que hoy está cerrado. No tocan código de runtime (un
fichero de test y dos symlinks de `public/`), así que todo lo que verifiqué sobre `49fb5a2`
sigue valiendo; los tests de candado e higiene los volví a correr sobre `ac0ca7c` y están en
verde (54/54).

Por ese solapamiento, los cuatro candados y el negativo del guion 09 se probaron en un
**worktree aislado** (`git worktree add --detach … 49fb5a2`), no en el árbol compartido: romper
a mano un fichero de producción en un repo que otro agente puede commitear es un riesgo que no
hacía falta correr. Nada de lo que hice quedó en el árbol: `git status` limpio salvo los
entregables.

---

## Criterios de aceptación

| # | Criterio (de `requisitos.md`) | Estado | Evidencia |
|---|---|---|---|
| 1 | Ninguna de las dos vías (zod TS y espejo Python) acepta una escena sin `tile` y sin `stage`; el error dice qué falta y permite re-responder | ✅ | `node --test test/scene-schema.test.ts test/scene-fixtures.test.ts test/architecture.test.ts` → 46/46; `python -m unittest ai_server.tests.test_scene_validate` → 20/20. Mensaje idéntico en ambos: «una escena necesita `tile` {tx,ty} (mundo continuo, pídelo con generate_tile) o `stage` (plató proscenio): la escena suelta (solo `size`+`terrain`) ya no existe». Al modelo llega envuelto en `narrative-mcp/server.ts:562`: «Invalid scene shape — **fix it and call narrative_respond again** (do NOT drop the rest of the scene): …» |
| 2 | `narrative-mcp` ya no puede pedir la variante suelta; `scene_instructions.md` podado | ✅ | `server.ts:351-360`: ternaria binaria + `isError` «Malformed scene request: … Format D has exactly those two variants; the free-standing scene was retired». `narrative-mcp/dist/server.js` **contiene** ese texto (el terminal del motor sirve de `dist/`, no de `.ts` — comprobado, no asumido). Prompt: 0 líneas de `GRID SIZES`/`EXTERIOR CONTEXT`/`EXTERIOR LINK RULE`/`FRONTIER`; entra «TWO VARIANTS, AND ONLY TWO». Las dos menciones vivas de `meters_per_cell` son del plató, que sí lo lleva |
| 3 | Un destino del panel «Salidas» sin escena realizada llega como **tile**, con el jugador colocado en él. **Andando, no leyendo JSON** | ✅ | Guion 08 (del ingeniero) y guion **09 nuevo** (mío), sobre el juego real desde el título: destino `tile_2_0` (el rayo saltó el vecino ya generado), jugador dentro del rect, `probeCollide=false`, la descripción nombra el lugar. Verificado además en **vista fps** (sonda propia): llegada a `tile_2_0`, pos `{x:128,z:7}` dentro del rect del lugar |
| 4 | `grep -rn` a cero de `frontier_request`, `player_crossed_frontier`, `robledo_village`, `tavern_clearing` | ✅ (con letra pequeña) | Único hit en todo el repo: `arch-rules.json` (el candado que los prohíbe). Cero también para `crossedFrontier`, `runLegacyFrontier`, `handleFrontierAsTile`, `FRONTIER_MODE`. **Pero el grep mira CONTENIDOS, no nombres de fichero**: en `49fb5a2` quedaba un `nefan-html/public/scenes/robledo_village.json` (symlink colgando) que ningún grep veía — Hallazgo 0. Hoy: `find -name "*robledo_village*"` y `find -type l ! -exec test -e` a cero |
| 5 | El cliente 3D arranca offline sin bridge con una fixture viva y el jugador aparece en su `__player_start` | ✅ | Godot 4.6.1 bajo `xvfb-run`, sin bridge, por el camino del jugador (título → juego → apariencia): `{"bridge_connected":false,"room":"robledo_tile","player_pos":[-1.75,0.0,10.25],"ray_hit":"posada"}` == `__player_start {x:-1.75,z:10.25}`. Captura revisada (ver §Crítica visual). El dump commiteado está **en sincronía** con su fuente: `npm run dump-scene` no produce diff |
| 6 | `verify` verde · `mutate` ≥ break 72 · `crap` re-medido con el techo **bajado** | ✅ (parcial, ver nota) | `verify` 1082/1082 en 8,0 s — lo corrió el coordinador, no lo repetí. `crap.max` 210 → **200** con la nota re-medida (`git diff` del `quality-thresholds.json`). `mutate` **no se corrió** y está justificado mecánicamente: `git diff --name-only main..HEAD` no toca ni un módulo mutado (`scene-normalize`, `plugins/dsl`, `combat-resolver`) ni uno solo de los tests de `test:mutate` ⇒ mismo conjunto de mutantes y mismos tests ⇒ el score no puede haber cambiado |
| 7 | Guiones de QA supervivientes en verde sobre el preset 5, cero créditos | ⚠️ | **8 de 9**. Verdes 01-07 y 09. **El 08 falla 3 de 3 intentos hoy** en esta máquina (ver Hallazgo 1). En la primera pasada de la mañana el 08 pasó: es intermitente, no roto |
| 8 | Los dos candados nuevos probados **en negativo** | ✅ | Los probé yo, los cuatro, en el worktree aislado (§Candados en negativo) |

---

## Candados en negativo (los rompí yo, uno a uno, y restauré)

| Candado | Perturbación | Resultado |
|---|---|---|
| zod (`scene-schema.ts`) | `if (s.stage === undefined)` → `if (false)` | `✖ la rechaza aunque esté perfectamente formada` + `✖ el rechazo llega al modelo por la misma vía que el pre-flight MCP` · pass 15 · fail 2 |
| espejo Python (`narrative_schemas.py`) | `raise` desactivado | `FAIL: test_escena_suelta_impecable_lanza — ValueError not raised` · Ran 20, FAILED (failures=1) |
| fixtures (`test/scene-fixtures.test.ts`) | escena suelta impecable devuelta a `data/scenes/` | `✖ todas las escenas del repo declaran su variante` → `[{file:'qa_suelta_sintetica.json', error:'escena suelta: sin \`tile\` … esa variante se retiró'}]` |
| arquitectura (`campos-retirados-no-vuelven`) | (a) `robledo_village` en `qa/guiones/01-…mjs`; (b) `player_crossed_frontier` en `bridge/router.ts` | (a) `qa/guiones/01-arranque-y-fixture.mjs:1 — patrón prohibido: "robledo_village"`; (b) `nefan-core/bridge/router.ts:1 — patrón prohibido: "player_crossed_frontier"`. El root nuevo `qa/**/*.mjs` **funciona** |

Los cuatro vuelven a verde al restaurar. `git status` del worktree: limpio.

---

## Lo que verifiqué por mi cuenta (pasada adversarial)

**El viaje de VUELTA no lo cubría nadie.** El guion 08 solo hace la ida y su última afirmación
(«el panel ofrece la vuelta») se conforma con `exits.length > 0` — pasaría igual con el bug D8
sin arreglar. La vuelta entra por otra rama (`handlePlayerEnteredPlace` → escena cacheada), que
resuelve las salidas por otra vía. **Funciona** (guion 09, verde), pero ahora tiene candado.

**El error a mitad de viaje (D9) está realmente cerrado.** Con el motor de bench en modo fallo
(`TILE_MODE=error`), pulsar una salida deja esto: overlay «Error al generar el mundo» + detalle +
botón **Cerrar**; el jugador se queda donde estaba (`tile_0_0`, misma posición), el panel sigue
ofreciendo el destino y se puede reintentar. El «Viajando…» **no** se queda girando.

**Los estados del sistema** que toca este cambio: título (01), fixture sin sesión (01-03, 06),
sesión de bridge (05, 07, 08, 09), plató proscenio (04), **vista fps** (sonda propia: el viaje
también coloca al jugador), overlay de loader en curso y en error (sonda `TILE_MODE=error`),
motor caído a mitad de generación (íd.). El 3D, offline y sin bridge (criterio 5).

**Saves y snapshots**: escaneé los **64 saves** del disco (231 escenas) y los 4 snapshots de
mundo: **cero escenas de la variante retirada**. Incluido `saves/1786993948-db4f10`, el que
citaban los requisitos. Nadie se queda con una partida que ya no carga.

---

## Hallazgos

### 0 · Bloqueante EN `49fb5a2`, ya CERRADO en `ac0ca7c` — el visor del mapa se quedó sin fixture

La retirada borró `nefan-core/data/scenes/robledo_village.json`, pero dejó vivo el symlink que
lo servía al navegador:

```
$ git ls-tree 49fb5a2 nefan-html/public/scenes/
120000 blob …  nefan-html/public/scenes/robledo_village.json   → ../../../nefan-core/data/scenes/robledo_village.json   (destino BORRADO)
```

Y en el mismo commit `nefan-html/public/world_map/index.html` pasó a pedir
`realized_scene_id: "robledo_tile"`, que **no tenía symlink**. El visor hace
`fetch("/scenes/robledo_tile.json")`: el jugador (o el dev) que abría el mapa se comía el
placeholder «scene "robledo_tile" no encontrada». Es exactamente el fallo que el criterio 4
quería evitar, y se coló porque **`grep -rn` busca dentro de los ficheros y aquí el término
retirado estaba en el NOMBRE** — un tipo de resto que ni el grep del ingeniero ni la regla
`campos-retirados-no-vuelven` (que escanea contenidos línea a línea) pueden ver.

Cerrado por la sesión paralela mientras yo probaba (`d385de9` + `ac0ca7c`), con candado nuevo en
`test/repo-hygiene.test.ts` para symlinks rotos. **Comprobado por mí en HEAD**, sirviendo el
cliente de verdad (`./start.sh --preset 9`):

```
GET /scenes/robledo_tile.json    → HTTP 200 (8836 bytes)  → {"scene_id":"robledo_tile", …}
GET /world_map/                  → HTTP 200
GET /scenes/robledo_village.json → fallback SPA (HTML), o sea: no existe
find … -type l ! -exec test -e {} \;  → ningún symlink roto en todo el repo
node --test repo-hygiene + architecture + scene-fixtures + scene-schema → 54/54
```

Lo dejo escrito aunque esté arreglado por dos motivos: es la única cosa de esta tanda que habría
sido **bloqueante** de haberse mergeado `49fb5a2` tal cual, y deja una lección con candado —
retirar un nombre exige mirar también los nombres de fichero y los enlaces, no solo `grep`.

### 1 · Importante — el guion 08, evidencia ejecutable del criterio 3, está hoy en ROJO (3/3)

**No es la funcionalidad: es el guion.** Reproducción desde el arranque:

```
$ node qa/run.mjs                     # batería entera
✘ 08-viaje-a-place-sin-realizar        ERROR: page.waitForSelector: Timeout 30000ms
                                       waiting for locator('[data-game-id]')
8/9 guiones en verde
```

Causa, aislada con dos sondas: `renderHome` (`nefan-html/src/ui/title-screen.ts:290-338`) pinta
el botón `#ts-new` en el `innerHTML` y **le cuelga el handler DESPUÉS** de
`await listSessions()` y de pintar las tarjetas de saves. El guion espera a que el botón
*exista* y lo pulsa dentro de esa ventana: el click se pierde, `renderWorldSelect` nunca corre y
`[data-game-id]` no aparece jamás.

- Sonda A (sin regenerar nada): abrir el selector de mundos **dos veces** → 1ª aparece, 2ª no
  (timeout de 35 s). Determinista, 2/2.
- Sonda B (idéntica pero esperando a que el status diga `Bridge OK` antes de pulsar) → aparece.
  El home tardó **151 ms** en quedar listo. Esa es la ventana.

El 08 pulsa dos veces (regenerar mundo → Volver → Nueva partida), así que se come la ventana en
la segunda. La misma fragilidad está en `qa/lib/sesion.mjs::nuevaPartida`, que comparten **05,
07, 08 y 09**: hoy pasan por suerte de milisegundos. **Arreglarlo en `qa/lib/sesion.mjs`
(esperar a `Bridge OK`, no a que el botón exista) los cura todos.** Mi guion 09 ya lo hace y por
eso es verde donde el 08 es rojo.

Qué esperaba el jugador (y el revisor): que la evidencia del criterio 3 se pueda volver a correr
y diga la verdad. Un guion que falla por su propia receta gasta el crédito de los demás.

### 2 · Importante (pre-existente, este trabajo lo destapa) — un link creado a mitad de sesión no es clicable

Confirmado en vivo, no leyendo código. Con partida en curso, por la MISMA vía que usa el motor
(State API del bridge, que es lo que hay detrás de `map_link`):

```
antes:                       exits ["molino_bench_place"]
POST /map/place qa_forja  → 200
POST /map/link taberna→qa_forja (road, edge north) → 200
2,5 s después:               exits ["molino_bench_place"]        ← la forja NO está
tras viajar al molino y volver (re-difusión del tile):
                             exits ["molino_bench_place","qa_forja"]   ← ahora sí
```

`enrichSceneWithExits` solo corre dentro de `broadcastScene`, y el cliente solo refresca
`currentExits` en `setActiveClientTile`. El motor te dice «te abro el camino a la forja» y el
botón no existe hasta que viajas a otro sitio y vuelves — justo lo que no puedes hacer para ir a
la forja. Es anterior a este cambio (el ingeniero ya lo declaró), pero **ahora el panel es la
única vía viva de viaje a un lugar**, así que la gravedad ha subido. Merece issue propio.

### 3 · Importante (riesgo latente) — el panel «Salidas» depende de un campo que solo pide la prosa del prompt

`enrichSceneWithExits` usa `scene.place_id` y, si falta, cae en `active_place_id`. En el tile de
arranque ese `place_id` lo escribe **el modelo** (`scene_instructions.md:164` lo pide en prosa);
nada lo valida ni hay fail-loud si no viene. Lo probé quitándolo del motor de bench:

```
partida: tile_0_0 · salidas []          ← el panel «Salidas» sale VACÍO
```

Sin panel no hay viaje a ningún lugar: el criterio 3 desaparece en silencio, sin un solo error.
En la ida el bridge se protege solo (marca el tile con `place_id`, la desviación D8), pero el
tile de bootstrap sigue a merced de que el modelo se acuerde. Un gate («si el bootstrap declara
`place_anchors`, exige `place_id`», o activar el place por anchor) lo cerraría.

### 4 · Menor — el error de viaje habla en jerga de fontanería y titula otra cosa

Lo que ve el jugador que pulsó «→ Molino del bench (road)»:

> **Error al generar el mundo**
> Error: No se pudo generar el tile (1, 0). HTTP 500: {"detail":"fake-ai: TILE_MODE=error — el motor rechazó el tile"}

Tres cosas: el título habla de «generar el mundo» cuando el jugador pidió **viajar**; el detalle
lleva coordenadas de tile, un `HTTP 500` y un JSON crudo; y el cronómetro se queda congelado en
`0s`. El aviso es recuperable (botón Cerrar, la partida sigue) — es copy, no comportamiento.

### 5 · Menor (pre-existente, ajeno a la rama) — el 3D no pinta el `terrain_grid` de la fixture nueva

La fixture viva del arranque offline se describe a sí misma como «El camino real cruza el puente
de tablones… la plaza empedrada del pozo», y en Godot el suelo es un plano verde liso: ni río, ni
puente, ni caminos, ni plaza. En el 2D sí se ven (guiones 05 y 06 los cruzan). Es el issue #167,
anterior a esta tanda, pero la fixture nueva se apoya MÁS en el grid que la que sustituye, así
que el desajuste descripción↔render se nota más.

---

## Crítica visual (capturas revisadas, no un checklist de «renderiza»)

**3D offline (`robledo_tile`, criterio 5)** — el pueblo se lee como greybox honesto: cajas grises
de edificios con dos alturas distintas, prismas naranjas de props, cilindros de árboles, sol
único con sombras coherentes y el jugador en la plaza. Como *escena* funciona; como *pueblo*
todavía no: el suelo es un plano verde uniforme (Hallazgo 5) y no hay nada que sugiera el río que
la descripción promete. Aparte, hay una **rueda de madera enorme pegada al personaje** que le
tapa medio cuerpo (es el escudo del rig, escalado mal): sale igual en cualquier sala, así que es
un artefacto del personaje anterior a esta rama — pero es lo PRIMERO que ve quien arranca el 3D
offline, que es exactamente el flujo del criterio 5.

**2D, viaje del panel** — antes de viajar, el panel «Salidas» abajo a la izquierda con
«→ Molino del bench (road)»; después, el jugador de pie en la plaza de tierra del molino, el
estanque al norte, un NPC a unos metros y el panel ya ofreciendo la vuelta. La composición se
lee. Es greybox de bench y no admite juicio de arte más allá de eso.

---

## Guion nuevo entregado

`qa/guiones/09-viaje-de-vuelta.mjs` — **la ida y la VUELTA** del panel «Salidas», que es lo que
hace un jugador a continuación y no cubría nadie. Afirma, andando:

1. desde el destino, el panel **no** ofrece el lugar donde el jugador ya está (si lo ofrece, está
   pintando las salidas de otro lugar: es el bug D8);
2. clicar la vuelta devuelve al jugador al tile de partida, en suelo libre;
3. de vuelta, el panel vuelve a ofrecer el destino y sigue sin ofrecer el sitio donde está.

**Probado en negativo** (worktree aislado, revirtiendo a mano la D8 — `res.scene.place_id` fuera
de `generateTileScene` — y reiniciando el bridge):

```
en el destino: tile_2_0 · salidas ["molino_bench_place"]      ← el sitio donde ESTÁ
✘ el panel NO ofrece viajar al lugar donde el jugador ya está
✘ clicar «Molino del bench» devuelve al jugador al punto de partida — timeout
```

Es decir: sin la D8 el viaje es un billete de ida y el jugador se queda encerrado en el destino
con un único botón que no hace nada. Restaurado el código, verde otra vez.

No añado guion para el error de viaje (Hallazgo 4) ni para el link a mitad de sesión (Hallazgo 2)
porque **no son herméticos**: el primero necesita el stack arrancado con `TILE_MODE=error` y el
segundo un `POST` externo a la State API; meterlos en la batería la volvería dependiente del
entorno. Quedan como reproducciones escritas aquí.

---

## Workarounds usados durante la prueba (y su veredicto)

| Workaround | Por qué | ¿Afecta al jugador? |
|---|---|---|
| Worktree aislado para los negativos | otra sesión editaba el repo en paralelo | No: es higiene de la prueba, no del producto |
| `TILE_MODE=error` en el motor de bench | provocar el fallo del motor a mitad de viaje | No: es el motor FALSO puesto a fallar, el camino que recorre el jugador es el mismo |
| Quitar `place_id` del tile de bench | comprobar de qué depende el panel | **Sí, y por eso es el Hallazgo 3**: el modelo real puede omitirlo igual |
| `POST` a la State API (`/map/place`, `/map/link`) | reproducir lo que hace `map_link` en un diálogo | No: es la MISMA vía que usa el motor; el bench no sabe llamarla desde un diálogo |
| Recargar la página entre regenerar mundo y jugar (en mis sondas) | esquivar la carrera del título | **Sí, y por eso es el Hallazgo 1**: al jugador el botón le queda muerto ~150 ms sin avisar |

Ningún workaround tocó código de producción del árbol compartido. Todas las perturbaciones se
revirtieron y se comprobó con `git status`/`git diff`.

---

## No probado (declarado, no aprobado por parecido)

- **El motor narrativo REAL con el prompt podado**: que siga produciendo buenos tiles y que
  escriba `place_id` es playtest con créditos. Aquí solo está candado que no PUEDA pedir la
  variante retirada.
- **`npm run mutate`**: no corrido (16 min al 100 % de CPU). Justificado mecánicamente arriba —
  el conjunto de mutación no cambia en el diff.
- **`npm run verify` / `npm run crap`**: no re-medidos por mí; verify lo corrió el coordinador
  (1082/1082 en 8,0 s) y el techo de CRAP se comprobó leyendo el fichero de umbrales.
- **Godot con bridge y con viaje**: el panel «Salidas» es del cliente 2D; en Godot el `spawn`
  llega y se ignora (declarado por el ingeniero). No es regresión — allí nunca hubo panel — pero
  significa que el criterio 3 no existe en el cliente 3D.
- **Gasto real de créditos**: cero en toda la pasada, así que no puedo decir nada sobre el coste
  de un viaje con el motor real (una llamada de tile + su imagen si el auto-pipeline está
  activo). El viaje no anuncia coste antes de pulsar; es el mismo trato que ya tenía explorar.

---

## Veredicto

**Apto con reservas** — sobre `ac0ca7c`. (Sobre `49fb5a2`, el commit que se me dio a validar,
habría sido **no apto** por el Hallazgo 0: el visor del mapa quedaba sin fixture. Está cerrado en
la propia rama y verificado por mí; el merge de la rama tal y como está HOY no lo arrastra.)

Lo que pidió el usuario está hecho y comprobado: la variante suelta no existe en ningún proceso,
los cuatro candados fallan cuando deben (los rompí yo), el viaje a un lugar que no existe llega
como tile con el jugador dentro —andando, en el juego, ida y vuelta— y el 3D arranca offline en
su `__player_start`. **Nada de lo que queda abierto bloquea el merge.**

Las reservas, por orden:

1. **Hallazgo 1** — el guion 08, que es la evidencia ejecutable del criterio 3, está en rojo hoy
   por una carrera de su propia receta. Se arregla en `qa/lib/sesion.mjs` en tres líneas y cura
   de paso a 05 y 07. Debería ir en esta PR: es el artefacto que la propia PR entrega.
2. **Hallazgo 3** — el panel «Salidas», que ahora es la única vía viva de viaje, se apaga en
   silencio si el modelo no escribe `place_id` en el tile de arranque. Fail-loud o issue.
3. **Hallazgos 2, 4 y 5** — issues propios: el link que no aparece hasta re-difundir, el copy del
   error de viaje y el `terrain_grid` que el 3D no pinta (#167).

Y una nota de proceso, no del código: **dos sesiones tocaron esta rama a la vez**. El Hallazgo 0
lo encontró y arregló la otra mientras yo medía, y yo estuve a punto de romper ficheros a mano en
un árbol que ella podía commitear. Si se repite, que cada una trabaje en su worktree.
