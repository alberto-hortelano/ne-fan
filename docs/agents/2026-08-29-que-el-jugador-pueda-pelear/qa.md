# QA — Que el jugador pueda pelear (#323, #322)

**Tanda**: 2026-08-29 · rama `feature/que-el-jugador-pueda-pelear` · implementación `cafa43f`
**Método**: partida real jugada a mano (preset `e2e-sin-creditos`, ratón y teclado de verdad con
pointer lock), tres baterías completas, dos candados probados en negativo y un guion nuevo.
**Gasto**: 0,00 € en pantalla en todas las sesiones; guardarraíl `fake:true` por las dos vías.
**Capturas**: las de la sesión manual en `qa/capturas/manual-2026-08-29-pelear/` (`00-titulo` …
`10-spawn-secuaz-en-dialogo`); las de la batería en
`qa/capturas/2026-08-29T21-29-39-748Z-217376/` (guiones 41 y 42).

---

## Veredicto: **APTO CON RESERVAS**

**Lo que se compró está entregado y lo he verificado jugando, no leyendo.** Maté al bandido de la
escena inicial (60 → 0 PV) y al secuaz que el motor manda por `spawn_entity` (60 → 0), con ratón y
teclado reales. Las dos vías convergen de verdad. El defecto que la tanda venía a matar —el
enemigo borrado del `state_update` al cambiar de tile— está muerto, y lo he comprobado EN VIVO y
con un guion nuevo que se pone rojo si vuelve.

**La reserva no es sobre la implementación: es sobre lo que ahora se puede jugar.** El primer
minuto de una partida nueva es una ejecución, morir deshace lo que mataste, y después de cualquier
conversación el jugador no puede devolver un golpe. Los tres son código PREEXISTENTE que nunca
había sido alcanzable porque nunca hubo enemigos; esta tanda los pone en el camino del jugador el
mismo día. Ninguno es motivo para no mergear, y los tres tienen que estar escritos antes de
cerrar #323.

---

## 1 · Los siete criterios del §4

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | La premisa está verificada EJECUTANDO, y hay un guion que hace que el motor emita un `spawn_entity` hostil y comprueba si llega a `GameStore.enemies`. Cero créditos | ✅ cumple | El acto 2 del `qa/guiones/41-el-jugador-puede-pelear.mjs` lo ejerce: el motor falso emite la consequence en el turno 2 de diálogo (`fake-ai-server.ts`, `grep spawn_entity` pasó de 0 a 1) y el enemigo llega. Lo repetí a mano: `narr_npc_1788037672_0` («Secuaz»), 60/60, a 5 m, sin recargar escena. `grep -l spawn_entity qa/guiones/*.mjs` ya no da 0 |
| 2 | El motor puede crear una entidad hostil y el jugador le quita vida, de punta a punta | ✅ cumple | Jugado a mano con ratón y teclado reales (pointer lock activo): `bandido_1` 60 → 0, `bandido_1 killed!`, jugador 100 → 85. Y por la otra vía: `narr_npc_1788037672_0 hit: -20.1 HP` ×3 → `killed!` |
| 3 | Hay un guion que lo ejerce desde el arranque y **no se fabrica la entidad a mano** | ✅ cumple | Guion 41, verde en las tres baterías. La entidad la pone `bootstrapTile()` del motor falso con `role:"hostile"` y nada más — ni `combat`, ni vida, ni `entity_kind` inventado. El defecto de `state-projection.test.ts` (fabricarse la entrada) no se repite |
| 4 | Un ataque que impacta reduce la vida del objetivo EN UNA PARTIDA REAL | ✅ cumple | Mío, no del guion: sesión manual, `mousedown` reales bajo pointer lock, `MOUSE_SENS_RAD_PER_PX` de producción. Traza `{d:1.12, ve:60 → 43.0 → 1.6 → 0}` · log `bandido_1 hit: -20.7 HP` ×3 |
| 5 | `scene_instructions.md` dice **una sola cosa** sobre `size`/`terrain`, y la checklist no pide verificar ningún campo que el gate rechace | ✅ cumple **para ese fichero** · ⚠ la otra mitad del issue sigue abierta | `grep 'size\|terrain' scene_instructions.md` da 7 líneas y **ninguna enseña el campo**: la prohibición (`:28`, `:32`), cuatro de `terrain_legend` (`:9`, `:42`, `:47` — campo que el gate SÍ acepta) más la prohibición de `terrain_svg` (`:76`), y «Props: size them in CELLS» (`:94`), que es el verbo. La checklist final queda en 3 puntos (`id/kind/name/cell/footprint/glyph`, ids únicos, PLAYABILITY) y los tres siguen vivos en el tile. **Pero** `generate_scene.json` —el tool que va en la llamada real— sigue declarándole al modelo `size{cols,rows,meters_per_cell}` y `terrain` con «Exactly `rows` strings, each EXACTLY `cols` characters wide»: ver hallazgo I-5 |
| 6 | Se dice por escrito por qué el guardia débil de #203 NO caza esta clase | ✅ cumple | `implementacion.md` §5, último bloque. Verificado: `contract-prompts.test.ts:240` solo comprueba que el token EXISTA en el corpus, y `combat`, `size` y `terrain` existen a espuertas. La conclusión («hace falta un guardia que compare lo que el prompt promete con lo que el contrato acepta, y es otra tarea») es correcta |
| 7 | Nada de esto gasta créditos | ✅ cumple | `gasto sesión 0,00 € · total 0,00 €` en las cinco sesiones manuales (visible en todas las capturas); guardarraíl `⛨ cliente y bridge declaran fake:true` en los 41 guiones; `/dev/counters` del motor falso: solo `/generate_scene`, `/generate_surface_atlas` y `/skin_sprite_sheet` |

### Las seis desviaciones del §4 del informe, comprobadas una a una

| # | Lo que dice | Veredicto |
|---|---|---|
| 1 | No borró `RESERVED TERRAIN CHARS` ni `SOLIDITY` porque `checkDeclaredChars` corre sobre el grid sintetizado y son reglas vivas | **Cierto.** `scene-validate.ts:350` recorre `view.grid` (el grid ya sintetizado) y rechaza el tile con `chars-sin-declarar`; `tile_instructions.md:13` sigue ofreciendo `terrain_legend` («optional custom chars») y `scene-expand.ts:246` deja que un `structures` introduzca `wall_char`/`floor_char` propios. Borrarlas habría quitado del prompt algo que el gate exige — el error opuesto al de #322. **No rompe el criterio 5**: hablan de `terrain_legend` y de los chars, no del campo `terrain[]` ni de `size` |
| 2 | Tocó `tile_instructions.md`, que el plan no mencionaba | Correcto y necesario: su cola remitía a un `"size"/"terrain" schema` que ya no existe |
| 3 | Había un segundo consumidor de `objects[].combat` en `style-apply.ts` | Cierto y bien borrado. `grep obj.combat nefan-html/src` → 0 (solo comentarios) |
| 4 | Modificó el guion 07 (igualdad → dos afirmaciones) | Aceptable y bien argumentado. La igualdad `cable == libro` se sustituye por `cable ⊆ libro` **y** `libro == reparto de la escena`; compuestas siguen impidiendo pedir un personaje que no esté en el reparto, que es el bug que ese bloque persigue |
| 5 | Añadió `__nefan.enemies()` (solo lectura) | Cierto; la afirmación del guion sigue yendo contra el HUD |
| 6 | El arma del hostil es `unarmed`, no una espada | Cierto, y el motivo (no prometer en el HUD arte que no existe) se sostiene |

### Los `grep` a cero del informe, reejecutados

```
$ grep -rn 'type: *"enemy"' nefan-core/{src,bridge,test} nefan-html/src
nefan-core/test/bridge-session.test.ts:1025:  // …comentario del borrado
$ grep -rn "projectEnemiesFromEntities" --include=*.ts .        → 0
$ grep -rn "obj.combat" nefan-html/src                          → 0
$ ls nefan-core/src/store/                                      → game-store.ts  reducers.ts
```

---

## 2 · Las dos vías, comprobadas POR SEPARADO

Convergen de verdad, y lo hacen donde el informe dice: `combatForHostileRole` produce el mismo
bloque y `enemigoDesdeCombat` es la única puerta del cliente. Lo que NO comparten es el
transporte, y eso se nota en tres sitios que hay que conocer:

| | Vía (a) — escena inicial | Vía (b) — `spawn_entity` en runtime |
|---|---|---|
| Cómo llega | `role:"hostile"` en el tile → `formatDToWorld` → `npcs[].combat` | consequence → `dispatchConsequences` → effect **y** `EntityRecord.data.combat` |
| Verificada | ✅ `bandido_1` 60 → 0, matado | ✅ `narr_npc_1788037672_0` 60 → 0, matado |
| Bloque `combat` en el save | **No lo lleva** (se deriva del `role` en el wire) | Sí (`state.json` → `entities[].data.combat`) |
| Sobrevive a un `Reanudar` | ✅ vuelve (vivo, a 60/60 — ver hallazgo I-3) | ❌ **desaparece entero** (ver hallazgo I-3) |
| Dónde nace | Celda que elige el motor | Jugador + `(0,0,−1)` × 5, **sin consultar colisión** |

**Convergen, pero la (b) no es la (a) en un punto que el informe afirma que sí**: `implementacion.md`
justifica escribir `combat` en el `EntityRecord` porque «un enemigo cuyo combate solo viviera en el
effect no existiría tras recargar la escena». Con el bloque escrito **tampoco existe** — medido
abajo. La decisión puede seguir siendo correcta (el ledger es lo que lee el motor), pero la razón
que se dio no se cumple.

---

## 3 · El defecto que la tanda venía a matar: ¿ha vuelto?

**No, y esta vez está candado.** Comprobado en vivo y con guion:

- **En vivo**: herí al bandido hasta 4,76 PV, crucé la frontera oeste andando y acepté la propuesta
  («¿Explorar hacia el oeste?» → Y), llegó `tile_-1_0` y el bandido seguía en `enemies()` con
  4,76 PV y su barra en el HUD. Entré 16 m dentro del tile vecino y volví: seguía ahí, con
  posición viva (me persiguió hasta `tile_-1_0` y de vuelta).
- **Con guion**: `qa/guiones/42-al-enemigo-no-se-le-borra-la-herida.mjs` (nuevo, abajo).

**Aviso importante sobre mi propia medida**: mi primera versión de esa comprobación —tanto la
manual como la del guion— era un **verde que no podía ponerse rojo**. Reintroduje a mano el
`dispatch("enemies_projected", {enemies: []})` en `broadcastScene` y **el guion siguió verde**: el
cliente no borra la barra de un enemigo que el bridge deja de nombrar, la **congela** con el último
valor, así que leer `#hp-text-<id>` y ver que no ha cambiado da el mismo número con y sin defecto.
Reescrito para afirmar lo que sí distingue los dos mundos, el negativo sale como debe:

```
✘ el bridge SIGUE nombrando al enemigo en state_update después del tile nuevo — frames: {}
✘ …y en el tile nuevo el enemigo SIGUE siendo alguien a quien pegar — 30 → 30 → 30
   ☠ el jugador murió en la segunda pelea (vida del enemigo 30)
```

Es decir: con la proyección puesta, **un solo cambio de tile convierte al enemigo en invulnerable y
te mata**. El arreglo de la tanda no era cosmético.

---

## 4 · El guardia de `npcSync`, probado por mí

Sí mide. Dos caras, las dos verdes, y las dos rojas al quitar `if (isHostileRole(e.data.role)) continue`:

```
CON guardia   npcs={"barkeep":185}                enemies={"bandido_1":115}
              ledger: barkeep [19.76,0,-5.48] → [20.18,0,-5.43]   bandido_1 [4.25,0,1.25] → [4.25,0,1.25]

SIN guardia   npcs={"barkeep":65,"bandido_1":65}  enemies={"bandido_1":63}
              ledger: bandido_1 [11.41,0,-0.90] → [11.81,0,-1.04]   ← dos dueños de la posición
✘ el hostil NUNCA sale por el canal de la VIDA AMBIENTAL
✘ el registro del hostil no lo mueve nadie mientras el del mercader sí se mueve
```

El mercader del mismo tile es el **control**: sale por `npcs` y su registro se mueve, así que el
verde del hostil no es «no hay vida ambiental corriendo». La versión reescrita del test del
ingeniero (la que entra por `startAmbientSession()` con `assert.ok(behavior)`) es la correcta;
esto lo confirma por fuera, en el cable.

---

## 5 · Hallazgos

### Bloqueantes

**B-1 · El primer minuto de una partida nueva es una ejecución, y reaparecer no te saca.**
*Reproducción desde el arranque*: `./start.sh --preset e2e-sin-creditos` → Nueva partida →
Miravanda → Continuar → Comenzar → **no tocar nada**.
*Qué pasa*: el bandido está a 4,47 m del `__player_start`, viene solo (`preferred_distance` 1,5) y
pega hasta 27,2 PV por golpe sobre los 100 del jugador. Medido cinco veces: muerto en 15–25 s sin
haber pulsado una tecla. Log real: `Player hit: -27.2 / -27.2 / -6.0 / -17.6 / -27.2 / -10.0` →
`YOU DIED`. Pulsar `R` te devuelve **en el mismo sitio** (`handleRespawnRequest` reaparece en
`playerPos`), o sea pegado al mismo enemigo, que además ha vuelto a 60/60: volví a morir a los 8 s.
*Qué esperaba el jugador*: llegar a un pueblo, mirar alrededor y decidir. No que la primera pantalla
del juego sea un bucle de muerte del que no sabe salir.
*Nota de alcance*: la celda la elige el motor (aquí el falso, [72,66] a 4,5 m). Pero el prompt nuevo
le dice al modelo «Place them at a believable distance; they will come to the player on their own»
y el core deriva `aggression 0.6 / combat_range 4` **sin leash ni gracia inicial**, así que cualquier
hostil que un modelo ponga en el tile de entrada se comporta igual. No es un accidente del bench.

**B-2 · Morir deshace lo que mataste: `respawn()` resucita a TODOS los enemigos a vida llena.**
*Reproducción*: mata al bandido (`bandido_1 killed!`, `hp:0, alive:false`) → habla con el tabernero
para que el motor mande al secuaz → deja que te mate → pulsa `R`.
*Medido*: `antes de R: [{bandido_1, hp:0, alive:false}, {secuaz, hp:60}]` →
`tras R: [{bandido_1, hp:60, alive:true}, {secuaz, hp:60}]`. `game-loop.ts:219-227`
(`// Reset all enemies`) es código de arena que ahora corre en un mundo abierto.
*Por qué es bloqueante y no menor*: **no hay curación en el juego** (`player_healed` existe en
`reducers.ts` y no tiene NI UN productor en todo el repo; `grep` a cero). La única forma de
recuperar vida es morir — y morir resucita a todo lo que habías matado. El jugador no puede
progresar: cada muerte le devuelve el mundo entero al estado inicial.

**B-3 · Después de cualquier conversación el jugador NO PUEDE devolver el golpe.**
*Reproducción desde el arranque*: partida nueva → habla con el tabernero (`E`) → el motor manda un
hostil a mitad de charla (es lo que `ui_systems.md` le enseña ahora) → cierra el diálogo → intenta
atacar con el ratón.
*Medido*: `dialogue-panel.ts:170` hace `document.exitPointerLock()` al mostrarse y **nadie lo
recupera al ocultarse**; `keyboard-input-provider.ts` exige `document.pointerLockElement !== null`
para poner `attackRequested`. Resultado real: 50 s pegando a 1,5 m del secuaz → **0 de daño**
(`secuaz 60/60` de principio a fin) y el jugador muerto con 7 impactos encajados. Volví a hacer
click en el lienzo para recapturar el ratón y **el mismo enemigo cayó en 3 s**. Y por la forma del
código —el `click` del lienzo pide el lock y llega DESPUÉS del `mousedown`, que es quien mira
`pointerLockElement`— el primer click tras la conversación tampoco puede atacar: solo recaptura.
Eso último es lectura del código, no medida mía; lo medido es el bloque de 50 s con `lock: null`.
*Y esto el banco NO PUEDE VERLO*: `ScriptedInputProvider.queueAttack()` escribe
`state.attackRequested = true` **sin pasar por la puerta del pointer lock**, así que el aserto del
guion 41 «con el enemigo encima, el jugador puede salir del diálogo y pelear» es verde por el
driver, no por el juego. Es exactamente el estado que al ingeniero le costó cinco corridas rojas
(hizo bien en no bajar la dificultad); la parte que quedó fuera es que cerrar el panel **no**
devuelve la capacidad de atacar a quien juega con un ratón.

### Importantes

**I-1 · Un enemigo no se distingue de un vecino, y el juego no lo nombra.**
`updateWorldLabels()` (`main.ts:1583`) construye `personajes` **solo** desde `npcEntities`: los
`enemyEntities` no entran ni en las etiquetas de mundo ni en `pickAimTarget`. Medido apuntando al
bandido a 1,84 m: `reticle.dataset.target === "false"` y cero rótulos colocados. En la captura
`41-…-01-escena-inicial-antes-del-golpe` del propio guion se ve el resultado (y en mi
`08-enemigo-vivo-de-frente`): el bandido llena la pantalla, anónimo y sin mirilla,
mientras el único nombre en cuadro —«Tabernero corpulento»— flota sobre alguien al que el bandido
tapa. Como director de arte: la única señal de hostilidad en toda la pantalla es una barra roja de
3 px en la esquina; el enemigo comparte maniquí, color y pose de reposo con el tabernero.

**I-2 · El HUD llama al enemigo por su id interno.** `main.ts:1123` escribe `${ee.id}`. El jugador
lee `bandido_1` y, en el spawn en runtime, **`narr_npc_1788038791_0`** (capturas `41-…-04-spawn-en-runtime-tras-el-golpe` y `42-…-03-enemigo-herido-de-nuevo-tras-el-viaje`).
`Entity.name` ya trae «Bandido de camino» / «Secuaz» — `enemigo.ts` lo rellena y nadie lo usa.

**I-3 · Un hostil que el motor manda en runtime desaparece al reanudar; el de la escena vuelve
resucitado.** *Reproducción*: habla con el tabernero hasta que llegue el secuaz, **no lo mates**,
F5 → «Reanudar».
*Medido*: antes, `narr_npc_1788038032_0` vivo a 60/60. Después: no está en `enemies()`, ni en
`npcs()`, ni en `scene.npcs`, ni tiene barra — y su `EntityRecord` **con su bloque `combat`** sigue
en `state.json`. En la misma reanudación, `bandido_1` —al que había matado dos veces— vuelve
`alive:true, hp:60`. O sea: reanudar borra los enemigos que el motor mandó y resucita los que
mataste. El §5 del informe declara la mitad («el enemigo resucita a plena vida en un resume»); la
otra mitad no estaba vista, y desmiente la razón escrita para poner `combat` en el ledger.

**I-4 · La barra de un enemigo muerto se queda en el HUD para siempre**, a 0. Con dos muertos, dos
barras vacías (captura `41-…-04`: `bandido_1 0` y `narr_npc_… 59`). `rebuildEnemyBars()` solo se
llama al cargar tile o al materializar spawn; `enemy_died` no la retira.

**I-5 · `generate_scene.json` sigue enseñándole al modelo el `size`/`terrain` que el gate rechaza.**
El criterio 1 de #322 se cumple **para `scene_instructions.md`**, y hay que decirlo así al cerrar,
porque el propio issue avisa de que «el arreglo obvio —quitar `size`/`terrain` del tool— es medio
arreglo» y esa mitad sigue sin hacer. Y es la mitad que viaja en la llamada real: `llm_client.py:487`
pasa `tools=[GENERATE_SCENE_TOOL]` con `tool_choice` forzado, y ese JSON declara hoy:
- `description` del tool: «Generates a map in Map Format D: **a terrain grid (ASCII strings)** plus
  a list of named entities…»
- `size`: `{cols: 12..80, rows: 8..60, meters_per_cell}` — el gate lo rechaza con «un tile no lleva
  `size`»
- `terrain`: «Exactly `rows` strings, each EXACTLY `cols` characters wide» — el gate lo rechaza con
  «un tile no lleva grid `terrain` completo»

**I-6 · El aviso de reaparecer no sigue a la muerte en una partida REANUDADA.** En partida nueva
funciona (muerto → «R reaparecer» → R → 83 PV). Reanudando, lo medí desincronizado en las **dos**
direcciones: (a) muerto a 0 PV y **sin** aviso en pantalla —el jugador no sabe que puede pulsar R,
porque lo único que se lo dice es la línea gris ilegible del registro—; (b) el aviso pegado con el
jugador vivo a 18 y a 83 PV (captura `09-dialogo`). Y una vez, en una sesión reanudada dos veces, el
jugador se quedó **clavado a 0 PV**: `R` se aceptó (`Respawned!` ×4 en el registro del cliente,
`Bridge: player respawned` en el log del bridge) y la vida nunca volvió — sin salida salvo recargar
la página. Este último no lo he sabido reducir a una receta; lo dejo con su evidencia.

**I-7 · Un jugador MUERTO sigue jugando.** Con la vida a 0 caminé 28 m (de x≈2 a x=30,7), pisé la
frontera, se me ofreció «¿Explorar hacia el este?» y en otra corrida **acepté con Y y se generó un
tile nuevo entero** con el jugador muerto. Morir no detiene el movimiento ni la exploración: la
única consecuencia es una línea en el registro.

### Menores

**M-1 · El acto 2 del guion 41 ocurre a oscuras, y su propia captura lo enseña.** El
`position_hint:"near_player"` cae a 5 m **fijos al norte** sin consultar colisión (ya en el §5 del
informe), y en el tile del bench eso es dentro de la taberna: la captura
`41-el-jugador-puede-pelear-04-spawn-en-runtime-tras-el-golpe.png` es **negra entera**, con solo el
HUD encima. La segunda vía de la tanda se demuestra en una pantalla en la que no se ve nada.

**M-2 · El registro de combate es ilegible y no hay ninguna otra señal de estar recibiendo golpes.**
Texto gris de ~11 px sobre hierba y losa, esquina inferior izquierda, con `YOU DIED`,
`bandido_1 killed!` y `Player hit:` en el mismo tratamiento. Sin destello de daño, sin indicador
direccional, sin sonido. Un jugador puede perder 60 PV sin enterarse de por dónde le pegan (me pasó
en la primera sesión).

**M-3 · Los textos del combate están en inglés** en un juego cuya convención es el español:
`YOU DIED — press R to respawn`, `bandido_1 hit: -20.5 HP`, `bandido_1 killed!`, `Respawned!`.
Ahora los lee el jugador, porque ahora hay combate.

**M-4 · `narrative-mcp/server.ts:610` sigue prometiéndole al modelo la variante retirada**: la
descripción de `scene_validate` dice «Accepts BOTH shapes generate_scene can produce: a **classic
place scene** AND a tile scene». Esa forma la rechaza `EmittedSceneSchema`. Misma familia que #322,
otro canal; no está en el criterio y conviene apuntarlo al abrir la tarea del guardia
prompt↔contrato.

**M-5 · El guion 22 es intermitente, y no estaba declarado.** En la batería con carga (yo tenía un
segundo stack arriba) salió rojo: `✘ el borde de "quick" también está en cuadro — {"x":640,"y":713}`
con `pitch 0.00°`; re-ejecutado solo, verde con `pitch -30.00°`. Es una carrera entre el cambio de
pitch y la medida, del mismo tipo que #320 (guion 34). #320 **no** apareció en ninguna de las tres
baterías.

---

## 6 · El balance, medido

Se pidió juicio de diseño, y aquí está con números míos.

| Pelea | Cómo empezó | Coste al jugador | Duración |
|---|---|---|---|
| A | Entro yo, atacando desde 1,84 m | **15 PV** (100 → 85) | ~3 s |
| B | Le dejo llegar y peleo de frente | **82 PV** (100 → 18) | ~12 s |
| C | Secuaz del spawn, a 1,5 m | **42 PV** (100 → 58) | ~6 s |
| D–H | No hago nada | **100 PV** (muerto) ×5 | 15–25 s |

**Lecturas:**

- **El número del informe (~70 de 100) es real, pero la varianza es lo que importa**: el mismo
  enemigo cuesta 15 PV o 82 según quién abra el intercambio. Eso no es dificultad, es una moneda al
  aire para quien todavía no sabe que hay que abrir tú.
- **El enemigo tiene más alcance que el jugador**: `combat_range` 4 m contra los ~2,5 m del golpe
  rápido con espada corta. Te pega desde fuera de tu alcance mientras cierras.
- **Hay un abrazo del que no se sale**: por debajo de ~0,8 m el factor de distancia del jugador es 0
  (óptimo 1,5 + tolerancia 1,0) y el enemigo solo retrocede por debajo de 1,0 m. Me quedé a 0,70 m
  haciendo **cero** daño mientras me pegaban, y nada en pantalla dice «estás demasiado cerca».
- **Huir funciona pero no sirve**: el sprint mide ~6,9 m/s contra los 2 m/s del enemigo, así que se
  escapa fácil — pero no hay leash: me siguió 28 m, cruzó conmigo a `tile_-1_0` y volvió.
- **Y no hay curación de ningún tipo** (B-2). Dos peleas seguidas en una vida es el caso normal, no
  el filo.

**Mi recomendación al usuario, que es suya y no mía**: los 60 PV y la personalidad `medium`+
`aggressive` están bien elegidos para un enemigo que te encuentras; lo que no está pensado es el
**encuadre**: sin curación, sin distancia de gracia y con el respawn encima del enemigo, el primer
hostil del juego no es un encuentro, es una pared. Tres cosas baratas lo arreglarían sin tocar la
fórmula: que el motor no pueda declarar un hostil a menos de N metros del `__player_start` del tile
de bootstrap, que reaparecer no resucite a los muertos, y que exista alguna forma de curarse.

---

## 7 · Guion nuevo

**`qa/guiones/42-al-enemigo-no-se-le-borra-la-herida.mjs`** — lo mecánico que nadie cubría:

1. **La herida sobrevive al cambio de tile.** Hiere sin matar, cruza la frontera pisándola y
   confirmando, y afirma que el bridge SIGUE nombrando al enemigo en `state_update` después del
   tile nuevo y que se le puede VOLVER A HERIR.
2. **Un hostil no entra en la vida ambiental.** Envuelve `WebSocket` antes de cargar la app y
   afirma que el hostil sale por `enemies[]` y **nunca** por `npcs[]`, con el mercader del mismo
   tile como control; y que su registro del ledger (State API `/entities`) no lo mueve nadie
   mientras el del mercader sí se mueve.
3. Deja I-1 e I-2 como `⚠ HALLAZGO` en el registro de cada corrida (convención del guion 24), sin
   poner el banco en rojo por un defecto cuyo dueño todavía no lo ha arreglado.

**Probado en negativo, y el primer negativo cazó un verde vacío mío** — está contado en la cabecera
del guion porque es la lección: leer `#hp-text-<id>` tras el viaje pasaba igual con el defecto
puesto, porque el cliente **congela** la barra en vez de borrarla. Los dos negativos actuales
(reintroducir `enemies_projected`; quitar el guardia de `npcSync`) ponen rojos los asertos que
deben.

---

## 8 · Workarounds usados, y por qué no afectan al jugador

| Workaround | Por qué | Veredicto |
|---|---|---|
| `__nefan.setYaw()` para apuntar en las medidas largas | Mi lazo de ratón sintético (mousemove + corrección proporcional) no siempre convergía y, cuando no lo hacía, medía mi controlador y no el juego: me costó dos falsos «cero daño» | **No afecta.** La pelea que decide el criterio 4 la hice con `mousemove`/`mousedown` REALES bajo pointer lock y la sensibilidad de producción: 60 → 0 |
| `__nefan.setPlayerPos()` en el guion 42 para saltarse 30 m de paseo hasta la frontera | Mismo atajo que el guion 05; el sujeto es qué le pasa al enemigo cuando llega el tile nuevo, no andar | **No afecta.** La frontera se PISA y la propuesta se CONFIRMA, que es el camino del jugador |
| Borrar `data/games/*/world/` de mi disco efímero | Con un `tile.json` pre-generado en disco, la partida nueva sirve el tile del snapshot y no el `bootstrapTile` del motor, así que no traía al hostil | **No afecta.** El snapshot que me estorbaba era del 27-ago, anterior a la tanda; `world/` está gitignorado y en la batería el guion 41 pasa sin él |
| Click en el lienzo para recapturar el ratón tras una conversación | Necesario para poder atacar | **SÍ afecta, y es el hallazgo B-3.** No es un paso de mi receta: es el obstáculo que tiene el jugador delante |

---

## 9 · No probado

- **El motor narrativo REAL (Claude vía MCP) no se ha ejercido ni una vez.** Todo va contra el motor
  falso, que declara `role:"hostile"` porque se le escribió a mano en `bootstrapTile`. Que un modelo
  de verdad, leyendo `scene_instructions.md` y `ui_systems.md`, elija `role:"hostile"` **y no
  invente un bloque `combat`** (que ahora el `.strict()` rechazaría con un error que vuelve al
  modelo) está **sin probar**: cuesta créditos. Es la única pieza del circuito que nadie ha visto
  funcionar.
- **Gasto real de créditos**: no probado por construcción (guardarraíl de cero créditos).
- **Cómo se VE un hostil vestido**: el motor falso solo sirve la hoja `idle` y contesta 500 a `walk`,
  lo que apaga los skins de la sesión entera. Todo lo que he visto es el maniquí y_bot cian. Que un
  bandido con skin `warrior` se distinga de un aldeano con skin `commoner` está sin probar — pero
  I-1 (ni rótulo ni mirilla) es independiente del skin.
- **Mutación**: no la he corrido; la pide el ingeniero/coordinador y su estado está en el §3 del
  informe.
- El «jugador clavado a 0 PV tras dos reanudaciones» (I-6, tercer caso) lo vi una vez y **no he
  sabido reducirlo** a una receta.

---

## 10 · Estado de la batería

| Corrida | Condiciones | Resultado |
|---|---|---|
| 1 (línea base con la tanda) | sola | **40 en verde · 0 en rojo de 40** |
| 2 (con el guion 42) | con mi stack manual arriba a la vez | 40 en verde · **1 en rojo** de 41 — guion **22**, intermitente (M-5); verde al re-ejecutarlo solo |
| 3 (definitiva) | sola, sin nada más en la máquina | **41 en verde · 0 en rojo de 41** (`exit 0`) |

`#320` (guion 34) **no apareció** en ninguna de las tres.

---

## 11 · Qué hay que hacer antes de cerrar

1. **B-1, B-2 y B-3** vuelven al ingeniero. Son tres defectos preexistentes que esta tanda hace
   alcanzables el mismo día; el más barato de los tres (B-3: devolver el pointer lock al ocultar el
   panel de diálogo) es también el que rompe el criterio de la tanda para quien juega con un ratón.
2. **I-1 e I-2** son media hora y cambian por completo cómo se lee una pelea.
3. Al cerrar **#322**: decir que su criterio 1 se cumple **para `scene_instructions.md`** y que la
   otra mitad que el propio issue nombra (`generate_scene.json`) sigue abierta (I-5), y que su
   criterio 3 es inalcanzable con el guardia de #203 — hay que abrir la tarea del guardia
   prompt↔contrato, con M-4 dentro.
4. Al cerrar **#323**: dejar escrito I-3 (lo que el motor manda en runtime no sobrevive a un
   `Reanudar`) y que la razón escrita para poner `combat` en el `EntityRecord` no se cumple tal
   como está redactada.
