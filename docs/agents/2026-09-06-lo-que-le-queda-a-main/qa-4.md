# QA — corte 4 de #358: el spawn dinámico sale de `main.ts` a `world/materializar-spawn.ts`

**Veredicto: APTO CON HALLAZGOS.** El corte es un movimiento y no un cambio: las 95 líneas de sentencia y
comentario del cuerpo de `materializeSpawn` en la base `03349f2e` son, sin la sangría, las mismas que hay en
`materializar` dentro del módulo nuevo (diff normalizado abajo: solo cambian la cabecera de la función y las dos
llamadas que pasan por `deps.`). En el juego, con el motor falso y cero créditos, el spawn del motor hace hoy lo
mismo que ayer en todos los estados alcanzables por el camino del jugador —hostil con barra y que pega, pacífico
con su nombre y su procedencia como skin, objeto y edificio con su rótulo, `style_ref` que llega al rol de la
skin, resume que rehidrata las cuatro cosas por la misma puerta con «↩ … sigue ahí» y «El mundo vuelve con N
cosa(s)»—, el trinquete lleva la cifra exacta, quedan 17 `let`, y no hay ningún rastro fuera del módulo. Los
hallazgos **no son del corte**: el gordo es que **el edificio y el objeto que el motor pone a mitad de partida
NO SON SÓLIDOS** —el jugador ve una forja de 4×4 m y la atraviesa andando—, y es idéntico en la base; el
hallazgo 1 del ingeniero (el cliente decide la huella con literales) es cierto, se mide, y resulta que la huella
que decide no colisiona nunca en un tile del motor. Las proyecciones del ingeniero para los cortes 5-7 (11 `let`,
≈ 1.578-1.590 líneas) se re-cuentan y salen ≈ 1.580 ± 5 y 11 `let`: **con los siete cortes no se llega ni a
≤ 6 ni a ≤ 1.550**.

Worktree `/home/al/code/ne-fan-358-4-qa`, commit `b8089395` sobre `03349f2e`. Cero créditos en toda la
verificación (`e2e-sin-creditos` con el motor falso; `gasto sesión 0,00 €` en todas las capturas). Ningún
proceso ajeno tocado: stack de ojos en el bloque 500 (`NEFAN_PORT_OFFSET=500`), parado con `--parar` antes de
cualquier corrida del runner; `ss -ltn` antes y después de cada tramo: solo 22/53/80/631/3636.

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: lo que sale de `main.ts` es lo que entra en el módulo | ✅ | `git show 03349f2e:nefan-html/src/main.ts` líneas `1506-1613` (108) contra `materializar-spawn.ts:61-155` (95), ambos sin sangría (`sed 's/^[[:space:]]*//'`): el `diff` trae SOLO (a) la cabecera —la doc de 7 líneas y la firma multilínea con sus dos docs de parámetro pasan a 4 líneas de doc + `function materializar(effect, opts = {})`; las docs de los parámetros viven ahora en la interfaz `MaterializadorDeSpawn:44-55`— y (b) `gameClient?.addEnemies` → `deps.gameClient()?.addEnemies` y `rebuildEnemyBars()` → `deps.rebuildEnemyBars()`. Ninguna otra sentencia distinta. El diff de `main.ts` sin comentarios: −4 imports, −101 del bloque, +1 import, +7 de la construcción, y los dos llamantes renombrados sin cambiar argumentos (`spawnDelMotor.materializar(effect)` `:1578`, `spawnDelMotor.materializar(spawn, { rehidratado: true })` `:1788`) |
| Spawn de NPC hostil: barra con su nombre, `combat`, ataca | ✅ | Sonda `ojos-qa4.mjs` (scratchpad), bloque 500, partida nueva `alta_fantasia`, hablar con el tabernero, turno 2 del motor falso: `enemies()` = `[bandido_1, {id:"narr_npc_1788715660_0", label:"Secuaz", hp:60, maxHp:60}]`, barras `["Vida","Bandido de camino","Secuaz"]`, línea del juego `⚔ Secuaz ataca`. Que pega: en el registro de `qa4-03` «narr_npc_1788715662_0 hit: -23.9 HP» ×2 y el jugador cae a `Vida 0` con el aviso «R reaparecer» (me quedé quieto 20 s con el panel abierto). Captura `capturas-qa4/qa4-01-secuaz.png`: barra verde «Secuaz 60» bajo la del bandido, igual que `ojos4-01` del ingeniero |
| Spawn de NPC pacífico: nombre, rótulo, skin pedida | ✅ | Turno 3: `npcs()` trae `["Nogala", skinPrompt:"posadera de manos grandes y delantal remendado"]`; rótulos mirando hacia ella `["Nogala","Secuaz"]`; línea `✨ Nogala aparece`. La skin, medida en modo `image` (`ojos-qa4b.mjs`): **en vivo no se pide**, porque el cortacircuitos de la sesión ya está saltado (`UMBRAL_APAGADO_DE_SESION` = 3: tabernero, bandido y Secuaz han fallado su hoja `walk` en el banco; panel «skins IA desactivados para la sesión: 3 personajes distintos han fallado», captura `qa4b-01`). Al reanudar (manager nuevo) sí: `skins` = `{prompt:"posadera de manos grandes y delantal remendado", role:"commoner"}` (rol de `npcSkinStyleRef` para villager). Es el fusible de #236 haciendo lo suyo, no el módulo; guion 81 bloque 2 |
| Spawn de objeto y de edificio: tamaño, colisión («el jugador choca donde antes») | ✅ movimiento fiel · ❌ el juego | Turno 3: `objects()` = `prop:Cofre de la posada` y `building:Forja de Robledo`, líneas `✨ objeto: …` y `✨ edificio: …`. **Tamaño**: se pintan como caja de `sizeXZ` 1,4×1,4 y 4×4 (renderer `fps-gl.ts:1490`), la forja ocupa media pantalla a 5,3 m (`qa4-03-mirando-forja.png`). **Colisión**: `probeCollide` en el centro de la forja y a ±(2+0,4−0,1) m en X y Z = **`false` los cinco**; semianchura colisionable medida = **0 m**. Como jugador (`ojos-qa4b.mjs`): andando con ↑ hacia el centro de la forja el jugador **llega a 0,62 m de su centro** (captura `qa4b-01-dentro-de-la-forja.png`: la cámara dentro de la caja, viendo el mundo a través de ella). «Donde antes» = en la base tampoco chocaba: `collision.ts`, `carga-de-tile.ts` y el bloque movido son idénticos en `03349f2e` (`git diff --stat` del commit: 13 ficheros, ninguno de esos dos). **H1** |
| Spawn con `style_ref` | ✅ | El motor falso no emite `style_ref`; se inyecta por el camino real del resume (`data.style_ref = "ref_qa_posadera"` en el record de Nogala del save, `saves/<id>/state.json`, con el bridge quieto en el título) → reanudar → `skins` trae `{prompt:"posadera…", role:"ref_qa_posadera"}`. Es `npcSkinStyleRef` dentro del módulo eligiendo la ref del motor sobre el rol. Guion 81 bloque 3 |
| Spawn duplicado (mismo id dos veces) | ✅ por el motor · ⚠ por un save corrupto | Por el motor no se puede: el core deduplica ids al registrar (`recordEntitySpawned` → `finalId`); medido en la sonda b, el Secuaz del turno 2 y Nogala del turno 3 cayeron en el mismo segundo y Nogala salió como `narr_npc_1788716038_0_2`. Por el save (record de Nogala copiado dos veces en `entities[]`): el resume trae **dos Nogalas** con el mismo id, «El mundo vuelve con 5 cosa(s)» y dos «↩ Nogala sigue ahí» (`qa4-08-duplicado.png`). `anadirNpc` es un `push` (idéntico en la base) y `spawnsDeRuntime` no deduplica. **H3** (menor, save corrupto) |
| Spawn con id de una entidad ya existente en el tile | ⚠ | Record de runtime de Nogala con `id: "barkeep"` → el cliente tiene **dos npcs con id `barkeep`** («Tabernero corpulento» y «Nogala»), sin entrada de error (`qa4-09-id-del-tile.png`). Solo alcanzable con un save corrupto (el bridge genera `narr_*`). **H3** |
| Resume rehidrata («El mundo vuelve con N cosa(s)», «↩ … sigue ahí») | ✅ | Tras reanudar: `enemies` `[Secuaz 12,2 HP]` (la herida sobrevive), `npcs` `[barkeep, Nogala]`, `objects` `[casa_lenador, Cofre, Forja]`, barras `["Vida","Secuaz"]` (el bandido murió antes), registro `El mundo vuelve con 4 cosa(s) que puso el motor` + las cuatro `↩ … sigue ahí`, **ninguna** `⚔ ataca`/`✨ aparece` (H-8 del 31-08), sin ids duplicados, mismos ids que en vivo, misma huella colisionable (los diez sondeos iguales antes y después), Nogala con la misma procedencia. `pageerrors 0`. Captura `qa4-05-reanudado.png`; guiones 48/49/54/57 en verde en la batería |
| **API y deps**: 5 deps mínimas, `Pick` honestos, sin bolsa | ✅ | `DepsDeMaterializarSpawn` `:28-41`: `mundo: Pick<MundoDelCliente,"anadirNpc"\|"anadirEnemigo"\|"anadirObjeto"\|"siguienteColorDeEnemigo">`, `characterSprites: Pick<…,"requestSkin">`, `gameClient(): GameClient\|null`, `rebuildEnemyBars()`, `log(msg)`. Grep de uso dentro del módulo: `anadirNpc` 1 llamada, `anadirEnemigo` 1, `anadirObjeto` 1, `siguienteColorDeEnemigo` 1, `requestSkin` 2, `gameClient()` 1, `rebuildEnemyBars` 1, `log(` 3 — cada miembro del `Pick` se usa y no sobra ninguno. `enemigoDesdeCombat`, `npcSkinStyleRef`, `KIND_DEFAULT_HEIGHT`, `Vec3`, `SpawnDeRuntime` importados como módulos. `gameClient` como getter (`() => gameClient`, `main.ts:1511`), `rebuildEnemyBars`/`log` como declaraciones hoisted (`:739`, `:780`), `mundo`/`characterSprites` `const` ya construidos (`:545`, `:178`) cuando se construye `spawnDelMotor` (`:1508`): ningún `undefined` capturado. API devuelta `{ materializar }`, un método; la forma de los tres hermanos y no la función suelta de la fila del plan — desviación declarada por el ingeniero, correcta |
| **Hallazgo 1 del ingeniero**: el cliente inventa `sizeXZ`/`radius` mientras un tile los recibe de `formatDToWorld` | ✅ cierto y medido | Tile: `formatDToWorld` emite `scale: [w*mpc, h, d*mpc]` desde el `footprint` en celdas (`scene-normalize.ts:293`), `leerObjeto` lo pasa a `sizeXZ {x: scale[0], z: scale[2]}` (`entidades-del-tile.ts:266`), `declaradoDeObjeto` lo copia (`carga-de-tile.ts:107`). Spawn: el effect `spawn_entity` no lleva huella (`schemas.ts:38-60`: `entity_kind`, `name`, `description`, `position_hint`, `role`, `style_ref`; el record del save tampoco: `keys` = `type, entity_kind, name, description, position_hint`), y el módulo elige `{4,4}`/`{1.4,1.4}` y `radius 8/5`. **Discrepancia observable**: la «Forja de Robledo» spawneada mide 4×4 m; la `herreria` de la fixture Robledo, 9×7 celdas = 4,5×3,5 m; un `pozo` de tile 1×1 celda = 0,5×0,5 m frente a 1,4×1,4 del cofre. Y la medida que lo agrava: esa huella **no colisiona** (fila de arriba, H1), así que hoy solo decide el tamaño del cajón pintado y el radio de puntería de las etiquetas (`etiquetas-del-mundo.ts:124`). Además `resolvePositionHint` reparte los spawns de un turno a `SEPARACION_M` = 1,8 m sin saber la huella que el cliente les pondrá: Nogala (x 6,57) queda **dentro** del footprint 4×4 de la forja (x 6,37-10,37) — por eso su rótulo flota sobre la pared sin cuerpo en `ojos4-03` y `qa4-05`. Lógica de juego en el cliente: issue del coordinador, medida aportada (**H1** + **H2**) |
| **Cero rastros** | ✅ | `grep -rn materializeSpawn` en todo el repo salvo `docs/agents/`, `node_modules`, `dist`, `qa/.tmp`, `qa/capturas`: **0**. En `main.ts`: `KIND_DEFAULT_HEIGHT\|npcSkinStyleRef\|enemigoDesdeCombat\|SpawnDeRuntime\|materializeSpawn` = 0. Prosa que sitúe el spawn en `main.ts`: solo `qa/guiones/48:33` y `qa/README.md:183`, que nombran el `for … spawnDelMotor.materializar(spawn, …)` del resume, que SIGUE en `main.ts:1788` (verdad, no rastro). `CLAUDE.md:226`, `narrativa.md:29`, `mapa.md:58-60`, `mundo-persistido.ts:18,426`, `entidades-del-tile.ts:65`, `style-apply.ts:9,257` apuntan al módulo o a «la partida» |
| Trinquete: `client-file-size.json` = `wc -l` | ✅ | `"lineas": 1836` = `wc -l main.ts` → 1836; `porque` gana UNA frase de crónica («BAJA a 1836 con el corte 4…») y no se reescribe como «raíz de composición» (plan §5: es del último corte). `style-apply.ts` sigue en 531 (los dos comentarios reescritos en una línea, como cuenta el ingeniero) |
| 17 `let` · módulo ≤ 450 | ✅ | `grep -c '^let ' main.ts` = **17** (el bloque no tenía ninguno; lista con líneas en §4); `wc -l materializar-spawn.ts` = **158** |
| `npm run verify` · tsc/lint/build del cliente | ✅ | `verify exit=0` — `tests 2178 · pass 2178 · fail 0` (17,3 s); `TSC_OK · lint exit=0 · ✓ built in 1.47s · build exit=0` |
| Los guiones 41/48/49 y el README: solo prosa | ✅ | `git diff 03349f2e b8089395 -- qa/`: 41 (1 línea de comentario de cabecera), 48 (1 línea de comentario), 49 (4 líneas: tres del comentario de cabecera y una del comentario del bloque 2, `:321`), README (1 celda). Ningún `expect`, `waitFor`, umbral ni selector tocado; los tres en verde en la batería |
| **Adversarial** · `kind` desconocido | ✅ se dice | Por el motor lo rechaza el zod (`entity_kind: z.enum(["npc","building","object"])`). Por el save (`type: "dragon"` en el record de la forja): el resume entra, el panel de errores dice **una vez** ««Forja de Robledo» no vuelve al mundo: el juego no sabe pintar nada de tipo "dragon" (esperaba npc\|object\|building)», la forja no está, Nogala/cofre/Secuaz sí, y la línea del juego cuenta «3 cosa(s)» (`qa4-07-tipo-desconocido.png`). Lo filtra el core (`spawnsDeRuntime`); el cliente lo pinta por `errors.push("session")`. Guion 81 bloque 4 (probado en negativo) |
| Adversarial · spawn sin posición | ✅ no entra | `position: null` en el record del cofre → `loadSession` lo rechaza (`describirPosicionInvalida`), el título dice «No se pudo reanudar la partida. Esa partida guardada ya no vale para esta versión del juego: bórrala o empieza una nueva.» y no monta nada |
| Adversarial · `rehidratado: true` sin partida | ⚠ no probado | No hay camino del jugador: la opción la pone solo el resume (`main.ts:1788`) y lo único que cambia es el texto de la línea del juego (`↩ … sigue ahí` en vez de `⚔ ataca`/`✨ aparece`; `materializar-spawn.ts:102,129,154`). Leído, no ejercido |
| Adversarial · spawn con la escena aún no `ready` | ⚠ no probado | El motor falso solo spawnea en el turno 2-3 de un diálogo, y para hablar ya hay tile; en el resume los spawns van DESPUÉS de `await addTile(scene)` (`:1763-1788`, comentario que explica el orden por el alta en el sim). Leído: un spawn antes del tile entraría en `mundo` con `dueno: runtime` y la purga de `addTile` lo respeta (#350); no se pudo alcanzar sin trucar el motor |
| **Crítica visual** | ✅ con notas | Mis `qa4-01/02/05` son, composición por composición, las `ojos4-01/02/03` del ingeniero. Lo que él anota se **confirma**: la forja es un cajón marrón liso de 4×4×2,5 sin puerta ni ventana, plantado a 5,3 m (cara a 3,3 m) que tapa media pantalla, al lado de la casa del tile que sí tiene tejado, ventanas y puerta (`qa4-03`); Nogala queda DENTRO de su footprint y su rótulo flota sobre la pared sin cuerpo (`qa4-05`, `ojos4-03`); en `ojos4-03` y `qa4-05` un cuerpo azul asoma cortado por la esquina inferior izquierda tapando el registro. Todo pre-existente (posición del bridge, caja del renderer). **H2** |
| **Batería completa** sin retocar guiones | ver §6 | — |

## 2 · Hallazgos

### H1 · importante · lo que el motor pone a mitad de partida (objeto, edificio) NO ES SÓLIDO — pre-existente (idéntico en `03349f2e`); destino **issue nuevo** (el que el coordinador iba a abrir por el hallazgo 1 del ingeniero, ampliado), no esta PR

**Repro** (desde el arranque, cero créditos): `NEFAN_PORT_OFFSET=500 ./start.sh --preset e2e-sin-creditos` →
`http://localhost:3500/?ai=http://127.0.0.1:19265&offset=500` → Nueva partida `alta_fantasia` → hablar con el
tabernero (E) → elegir dos veces → el turno 3 pone «Forja de Robledo» a 5 m delante → andar hacia ella con W.

**Lo que ve el jugador**: una forja de 4×4 m (cajón marrón, `qa4-03-mirando-forja.png`) que **atraviesa**
andando: llega a 0,62 m de su centro y ve el mundo desde dentro de la caja (`qa4b-01-dentro-de-la-forja.png`).
`probeCollide` en el centro y a ±2,3 m = `false`; semianchura colisionable = 0 m. El cofre, igual.

**Por qué**: `materializar` pone `sizeXZ` «para que sean sólidos (collidesAt)» (`materializar-spawn.ts:62,143`),
pero `collidesAt` (`collision.ts:81-87`) salta TODOS los AABB de objetos cuyo tile tenga `svgApplied`, y
`applyPlanCollision` lo pone a `true` en todo tile con `planInfo` (`carga-de-tile.ts:332-335`) — es decir, en
todo tile del motor. Para los objetos del tile es correcto (su colisión sale del plan, con puertas y huecos);
para un spawn de runtime no hay plan que lo dibuje, así que se queda sin colisión ninguna. El comentario del
módulo dice hoy algo falso, y viajó tal cual desde `main.ts`.

**Lo esperado**: un edificio que se ve, se choca. La solución está más arriba que el cliente (regla «el cliente
solo pinta»): que el core derive la huella del spawn como deriva la del tile (`footprint` → `scale` en
`formatDToWorld`), que el effect/record la traiga como trae la posición, y que la colisión del plan la incorpore
(o que el salto de AABB exima a las entities con `dueno: runtime`). Con eso muere también el literal `{4,4}`.
Medida para el issue: `qa/guiones/81` bloque 1 lo mide con la marca `⚠ HALLAZGO` sin ponerse rojo; con el
arreglo esas dos medidas pasan a `expect`.

### H2 · menor · el bridge coloca tres spawns a 1,8 m sin conocer la huella que el cliente les pondrá — pre-existente; **mismo issue que H1**

`resolvePositionHint` (`consequence-handler.ts:191-216`) reparte los spawns de un turno a `SEPARACION_M` = 1,8 m
a izquierda y derecha, 5 m delante. El cliente da 4 m al edificio, así que Nogala (x 6,57) nace **dentro** del
footprint de la forja (x 6,37-10,37) y el cofre a 1,8 m de ella. Se ve: rótulo «Nogala» flotando sobre la pared
sin cuerpo (`qa4-05`, `ojos4-03`), la forja tapando media pantalla, el prompt «E · hablar con Nogala» desde
dentro de la forja (`qa4b-01`). Es la otra cara de H1: nadie tiene la huella antes de pintar. Y el edificio
spawneado es un cajón liso frente a los del tile con tejado, puerta y ventanas (`qa4-03`): backlog visual del
coordinador (qa-2 H4), como dice el ingeniero.

### H3 · menor · un save con ids repetidos (o con el id de una entidad del tile) en el ledger de runtime pinta dos entidades con el mismo id sin decirlo — pre-existente; destino **issue de core** (gate de `loadSession`), no esta PR

Solo alcanzable editando el save (el bridge genera `narr_<kind>_<epoch>_<n>` y deduplica con `finalId`). Con el
record de Nogala dos veces: dos Nogalas, «El mundo vuelve con 5 cosa(s)», dos «↩ Nogala sigue ahí»
(`qa4-08`). Con `id: "barkeep"`: dos npcs `barkeep` (tabernero y Nogala) y ningún error (`qa4-09`). `loadSession`
ya rechaza `position` inválida y `data.name` ausente; un id repetido o que choque con la escena es del mismo
molde. El cliente hace lo que la base: `anadirNpc` es un `push`.

### H4 · menor · en el banco, el pacífico de runtime no pide skin en vivo porque el fusible ya saltó — no es del corte; dato para quien escriba guiones

Con tres personajes fallando su hoja `walk` (tabernero, bandido, Secuaz: todo lo que no es `idle` da 500 en el
motor falso), `UMBRAL_APAGADO_DE_SESION` = 3 apaga la sesión antes del turno 3, y `requestSkin` de Nogala sale
sin hacer nada (`character-sprites.ts:230`). Lo anuncia el panel una vez (`qa4b-01`, texto correcto). Por eso el
guion 81 mide la petición en el resume. En una partida real con backend de skins no pasa.

### Observaciones laterales (fuera del corte, sin investigar a fondo)

- En `qa4-05-reanudado.png` la partida se reanuda con **«Vida 0»**: el jugador había muerto antes de reanudar
  (bandido + Secuaz mientras yo esperaba 20 s con el panel abierto) y el save llevaba el HP vivo. El resume
  devuelve un jugador muerto y en la captura no se ve el aviso «R reaparecer». No lo perseguí: es del save/resume
  del HP, no del spawn. Queda dicho para quien lo quiera medir.
- En modo `image` con las hojas fallando, el Secuaz se pinta como un rectángulo blanco liso (billboard sin
  textura ni y_bot, captura del guion 81 `03-reanudado-sin-la-forja-y-dicho.png`, 0,8 s tras reanudar). Artefacto
  del banco (el fusible apaga las skins) o base tardía; no del corte.

## 3 · Workarounds usados y veredicto

- **Editar el save en disco con el bridge quieto en el título** (sabotajes A-E y guion 81 bloques 3-4): es la
  técnica de los guiones 46/62/67 y el único camino a `style_ref`, tipo desconocido, duplicado y posición nula sin
  trucar el motor. El jugador no edita saves: los casos que dependen de ello (H3) se clasifican como «save
  corrupto», menores. `style_ref` sí es un estado real (el motor lo declara en `spawn_entity`), y por el save
  llega a la misma función (`materializar`) que en vivo: el resultado vale para las dos puertas.
- **`charMode: "vector"` en la primera sonda**: dejó `skins` vacío (`allowed=false`) y me hizo creer que la skin
  no se pedía. Repetido en modo `image` (`ojos-qa4b.mjs`): el Secuaz pide `{secuaz enjuto…, role:"warrior"}`
  en vivo; Nogala no, por H4. Fallo de la sonda, corregido; el juego hizo lo mismo las dos veces.
- **`raf=timer` e `input=scripted`**: los del runner; no cambian lo que el módulo hace.
- Ningún `display:none`, ningún estado forzado en el cliente, ningún código tocado salvo los dos negativos del
  guion 81, restaurados con `git checkout` (árbol limpio verificado: solo el guion y el README nuevos).

## 4 · La proyección tras los cortes 5-7 (re-cuenta propia)

Los 17 `let` de `b8089395`, con sus lectores (`grep -nw`):

| `let` | Línea | Lectores fuera de su bloque | Grupo | Destino según `plan.md` |
|---|---|---|---|---|
| `playerModel` | 86 | bucle `:1142-1143` | personaje/skins | corte 5 → `modelo()` |
| `playerSkinPrompt` | 87 | `reRequestAllSkins` `:438`, `resetWorld` `:702` (escribe `""`), bucle `:1143`, `listFakeItems` `:1242` | personaje/skins | corte 5 → `skinPrompt()`/`desvestir()` |
| `baseSheetsLoaded` | 187 | bucle `:1140` | personaje/skins | corte 5 → `hojasBaseListas()` |
| `ratonCapturadoAntesDelDialogo` | 903 | solo `:882,926,927` (abrir/cerrar diálogo) | diálogo | corte 6 |
| `attackCatalog` | 615 | `getSelectedParams` `:839`, seam `:1347` | HUD combate | corte 7 |
| `sessionCombatSystemId` | 617 | seam `:1346` | HUD combate | corte 7 |
| `devMenu` | 231 | `:431`, `:1277` | modos + menú dev | corte 8 (no decidido) |
| `graphicsChip` | 235 | `:432`, `:1287`, `:1311` (onVisibilityChange) | modos + menú dev | corte 8 |
| `scenesMode` | 359 | 10 usos: `:331-460`, bucle `:1215` | modos + menú dev | corte 8 |
| `charactersMode` | 360 | `:372-461`, bucle `:1216` | modos + menú dev | corte 8 |
| `mundoPintadoDe` | 260 | solo `:281-282` (sink por valor) | facetas | helper `porValor` (plan §6) |
| `dialogoDeSesion` | 264 | solo `:308-309` | facetas | helper `porValor` |
| `input` | 598 | 41 usos en todo el fichero | raíz | se queda |
| `gameClient` | 680 | 11 usos, getter a los módulos | raíz | se queda |
| `lastRenderError` | 789 | bucle `:1183-1184` | raíz | se queda |
| `lastTime` | 979 | bucle `:1002-1003` | raíz | se queda |
| `tituloEnMarcha` | 1634 | `:1650-1660` | raíz | se queda |

Cortes 5-7 se llevan **6** → quedan **11** (4 modos+menú dev, 2 facetas, 5 raíz). Coincide con el ingeniero y
con el plan §1. Para ≤ 6 hacen falta el corte 8 (−4) y `porValor` (−2), exactamente.

**Líneas.** Los rangos del ingeniero re-medidos en `b8089395`: corte 5 `:82-155` (74) + `:185-222` (38) = 112;
corte 6 `:513` (1) + `:855-938` (84) + `:1353-1379` (27) = 112; corte 7 `:486-487` (2) + `:613-641` (29) +
`:830-851` (22) = 53. Suma **277** de bloques. Sus imports los cuenta de más: `:29` (`BASE_ANIMS, BASE_MODEL,
CharacterSpriteManager`) y `:46` (`AVISO_PERSONAJES, errors`) **se quedan** porque `CharacterSpriteManager` y
`errors` siguen en `main.ts` (pierden un símbolo, no la línea); `:8` (`getEffectiveParams, loadConfig`) también
se queda por `loadConfig`. Se van `:39` (`DialoguePanel`, si `main` solo usa `conversacion.panel`), `:9`
(`combatRegistry`) y `:10` (`AttackSpec`): **−3**, no −5. Cada corte añade **+1** import del módulo nuevo y su
construcción: medida en los cortes 1-4, el cableado que queda en `main.ts` fue de 7-11 líneas por corte (el
corte 4: 7 de `const spawnDelMotor = …` + 1 import). Con 5 métodos expuestos (corte 5) la construcción no
baja de 8. Proyección: `1836 − 277 − 3 + 3 + (8…11)×3` = **1.583-1.592**. La del ingeniero (1.578-1.590) y la
mía se solapan; redondeo honesto: **≈ 1.585 ± 7**. La aceptación pide ≤ 1.550: **faltan 35-40 líneas**, más de
lo que da `porValor` (~4) y menos de lo que quita el corte 8 (~150, frontera 10-11 medida por la crítica).

Conclusión para la pregunta al usuario: con los siete cortes `main.ts` queda en **≈ 1.585 líneas y 11 `let`**;
las dos cifras de cierre (≤ 1.550, ≤ 6) se alcanzan solo con **corte 8 + `porValor`**, o se re-cifra el cierre a
«≤ 11 `let` / ≤ 1.600». No hay tercera vía sin el objeto de contexto rechazado.

## 5 · Guion nuevo — `qa/guiones/81-el-spawn-vuelve-con-su-rol-y-lo-que-no-vuelve-se-dice.mjs`

Qué afirma (y ningún otro guion afirmaba): la petición de skin del pacífico de runtime al reanudar (prompt =
`description`, `role` no vacío); que un `style_ref` en el record es el `role` con el que se pide (la elección del
motor cruza el módulo); que las cuatro vuelven con los mismos ids que en vivo, sin duplicados, y «vuelve con 4»;
y que un record de tipo desconocido se dice UNA vez en el panel, no está, el resto sí y «vuelve con 3». Mide sin
rojo (`⚠ HALLAZGO`) la huella colisionable de la forja y el cofre spawneados (hoy 0) y la de un edificio del tile
(hoy sólido).

- Positivo, solo: `node qa/run.mjs 81` → `1 en verde · 0 en rojo de 1` (capturas
  `qa/capturas/2026-09-06T17-37-20-762Z-249519/`). La línea del hallazgo, literal: «⚠ HALLAZGO · huella
  colisionable del spawn: forja(4×4) {"centro":false,"dentroX":false,"dentroZ":false} · cofre(1,4×1,4)
  {"centro":false,"dentroX":true,"dentroZ":false} · edificio del tile {"id":"casa_lenador","centro":true}».
- **Negativo 1**: `characterSprites.requestSkin(npcPrompt, { role: spawnStyleRole })` → `requestSkin(npcPrompt, {})`
  en el módulo: rojos «…y con un rol de personaje» y «el `style_ref`… es el rol» (la skin sale sin `role`), el
  resto verde. `0 en verde · 1 en rojo`. Restaurado.
- **Negativo 2**: `for (const err of errores) errors.push("session", err);` → `void errores;` en `main.ts`: rojo
  «el panel de errores dice, UNA vez…» con `[]`, el resto verde. `0 en verde · 1 en rojo`. Restaurado;
  `git status`: solo el guion y el README.
- Fila añadida en `qa/README.md` («Los guiones sembrados»), tras la del 80.

## 6 · Batería completa

`node qa/run.mjs` entero sobre `b8089395` + el guion 81, con el stack de ojos parado antes (`--parar`, `✅ stack
cleaned`) y ningún otro stack mío arriba:
```
79 en verde · 1 en rojo de 80 · capturas en /home/al/code/ne-fan-358-4-qa/qa/capturas/2026-09-06T17-39-26-141Z-251713
✘ 80-el-desplegable-room-dice-lo-que-se-ve
    «-- Room --»: mundo «zorder_test» → «zorder_test» · errores 4 → 5 · desplegable «-- Room --»
    ✘ …ni deja una entrada de error — 4 → 5
exit=1
```
Los otros 79 en verde, incluidos los trece de la red del ingeniero (41, 48, 49, 50, 54, 57, 66, 67, 69, 70, 71,
77, 78), el 75 que a él le salió rojo, y el 81 nuevo. El 80 **no es de este corte** (es el selector de fixtures,
`sinMotor`; el corte 4 no toca `fixtures-del-selector.ts` ni el panel de errores) y lo medí en vez de suponerlo:
solo, sobre el mismo árbol, `1 en verde · 0 en rojo de 1` (capturas `…T17-47-10…`). Es un intermitente de la
batería larga: el bloque «-- Room --» afirma que el contador del panel no sube, y una entrada asíncrona
(skin/atlas del guion anterior, o del propio stack) cayó en su ventana. Misma clase que el 75 de
`implementacion-4.md` § batería, que esta vez pasó. Para el backlog de intermitentes del coordinador, no para
esta PR. `ss -ltn` después: solo 22/53/80/631/3636.

## 7 · No probado y por qué

- Gasto real de créditos, skins IA de verdad: el banco es el motor falso; lo que se afirma de skins es la
  PETICIÓN (prompt y rol), no la imagen.
- `rehidratado: true` fuera del resume y un spawn antes del primer tile: sin camino del jugador ni del motor
  falso (fila de la tabla); leídos en código.
- Que en la base `03349f2e` la forja tampoco choque se demuestra por identidad del código (los tres ficheros
  implicados no están en el diff del commit), no corriendo un segundo stack sobre la base.
- Test unitario del módulo: el cliente no entra en `npm test` ni en mutación (#241); lo sujetan los guiones
  41/48/49/50/54/57/66/67/81 y los candados de `arch-rules.json`.
