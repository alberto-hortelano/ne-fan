# Requisitos — T6 «El save sabe dónde estás» (#395 + #382 + #179)

**Fecha**: 2026-09-02 · **Coordinador**: sesión principal · **Base**: `main` = `6d3d7ac` (T5 cerrada).

## Petición del usuario (literal)

> «Adelante con T6»

> **Crítica (`critica.md`, 2026-09-02)**: #395 **VIGENTE** · #179 **VIGENTE** · #382 **REENCUADRADA** (la vara
> cambia y deja de depender de #377). Las correcciones están incorporadas abajo; las citas de línea son
> de la crítica, medidas sobre `6d3d7ac`.

T6 es la primera tanda de la selección del núcleo aprobada hoy
(`~/.claude/plans/federated-spinning-flamingo.md`): **«El save sabe dónde estás» — #395 + #382 + #179.
Cierra 3.** Motivo del agrupamiento: los tres son «lo que el mundo te había dado deja de estar, o no
está donde lo dejaste, y el juego no te explica por qué»: save/mundo vivo, ficheros compartidos
(`bridge/world-claim.ts`, `src/session/mundo-persistido.ts`, `bridge/context.ts`).

**Decisión del usuario que manda sobre esta tanda (2026-09-02, literal)**: «La parte central hay que
dejarla bien pero los plugins los podemos dejar para más adelante, el combate, el movimiento, el
comercio... todo eso deben ser plugins y tienen baja prioridad en cuanto a calidad del código». En
consecuencia **#377 (`engaged` sin correa) está etiquetado `futuro` y NO entra en T6** aunque #382 lo
nombre como bloqueo de su mitigación barata. La tanda tiene que resolver #382 **sin tocar el combate**
o declarar qué parte queda fuera y por qué.

Vigente de la serie: subir el número de issues abriendo un defecto derivado medido es preferible a
bajarlo callándolo. Los cuerpos de los tres issues tienen partes caducadas: **se comenta en cada uno lo
que se midió**, no se cita el cuerpo.

## Los tres issues y su premisa (según el issue; el crítico la verifica contra `6d3d7ac`)

### #395 — el save no recoge el viaje por «Salidas»

| Afirma el issue (QA de #390, 2026-09-02) | A verificar |
|---|---|
| **Dos ramas (crítico).** Place realizado: `bridge/handlers/scene.ts:105-106` guarda antes del `ready`+`spawn` (active=destino, pos=origen). Place sin realizar (el banco): `bridge/handlers/tile.ts:156-157` guarda con `activate:false` y después NADIE guarda: `setActiveTile` (`narrative-state.ts:213-221`) marca `dirty` sin lector en producción (`isDirty()` solo lo llama un test); `fireMapTriggers` (`context.ts:441`) no escribe sin triggers. **No hay autosave por tiempo** (cero timers en `bridge/**`; los 16 `save()` son por evento) | **Criterio**: el hecho «el jugador ha cambiado de tile» dispara el save, gateado por cambio de TILE (una escritura por 64 m), no por celda |
| El «15 s después» del QA es el `maxMs` de `esperarEnElSave` (`qa/lib/saves.mjs:139`): midió que **no hubo ningún save**, no uno tardío | A1 espera el save por PREDICADO (active=destino ∧ pos ∈ rect), no por tiempo |
| `/scene/asset_refs` guarda porque devuelve `mutated(...)` → `onMutation` → `save()` (`ws-server.ts:178-180`); igual `map/place`, `map/link`, `map/trigger`. El guion 60 usa ese mismo efecto secundario a propósito (`60-…mjs:223-235`) | Al reanudar manda la **posición** (`main.ts:2277-2286`); `active_scene_id` solo ordena tiles. El arreglo fija los dos |
| El guion 60 lo esquiva con `guardarConLaPosicionDelDestino` (State API) y declara `sinMedir` | `qa/guiones/60-…mjs`, `qa/lib/saves.mjs` (`esperarEnElSave`) |

**Lo que nota el jugador**: viaja por «Salidas», cierra, reanuda… y aparece en el tile de ANTES.

### #382 — una posición viva corrupta borra a un NPC y nadie lo dice

| Afirma el issue (QA de #350/#351, 2026-09-01) | A verificar |
|---|---|
| Desde #351 `npcs[].position` en el wire es la posición VIVA del ledger; el candado `POSICION_DECLARADA`/`npcsFueraDelRect` mide solo la **declarada** (conversión celda→metro) | `src/session/mundo-persistido.ts` (`escenaConCombateVivo`, `npcsFueraDelRect`) |
| Save con `position` de `barkeep` = `[168.25,0,168.25]` → el NPC no está en la escena y el panel dice «— sin errores —» | Repro del issue (guion 55 mide la declarada; el aserto de la viva entraría ahí) |
| «La mitigación barata está bloqueada por #377» — **falsa como bloqueo** (crítico): solo lo es la vara «a más de N tiles de SU rect». **Vara elegida**: la posición viva de cada NPC de `scenes_loaded` se contrasta con la **UNIÓN de rects de todos los tiles del save** (`scenes_loaded` nunca se poda), disponible en el bridge (`bridge/wire-scene.ts:99-111`) y en el cliente ENTERA antes del primer `addTile` (`main.ts:2241-2247`), así que el falso positivo por orden de añadido no aplica si la unión sale del save y no de `tileStore`. No depende de #377. Rojos residuales conocidos, raros y **VERDADEROS** (el NPC está donde no hay suelo): hostil `engaged` en esquina cóncava del mundo explorado; ambiental con `goto_place` hacia un `anchor` de viaje fallido (`scene.ts:164`, `place-target.ts:18`). La coordenada del repro `[168.25,0,168.25]` cae en `tile_3_3`: fuera de toda unión en una partida nueva. **Vía (b) descartada**: un save editado con números finitos no lo caza (solo NaN del sim) y roza `src/simulation` | Hoy: `npcsFueraDelRect` mide `POSICION_DECLARADA ?? position` contra el rect de SU tile (`mundo-persistido.ts:321-345`), único llamante `carga-de-tile.ts:339`; `escenaConCombateVivo` pone la viva y aparta la declarada (`:259-263`). El checker nuevo va AL LADO del de conversión, con vara distinta; el guion 55 canda que nadie los «unifique» aflojando el de conversión |
| Nada del juego escribe esa coordenada mal: exige un save corrupto | Sigue siendo fail-loud del núcleo (integridad del save), no mecánica de NPC |

### #179 — un `map_link` creado a mitad de sesión no aparece en «Salidas»

| Afirma (reencuadre del crítico 2026-08-23 + verificación 2026-08-28 sobre `cc3cd54`) | A verificar |
|---|---|
| `addLink` = `worldMap.addLink` + `markDirty` + `mutated` (`bridge/state-http/map-routes.ts:42-52`): **SÍ persiste** (vía `onMutation` → `save`) y **no difunde** (cero `broadcast|exits|onProgress` en el fichero). Lo que falta es recalcular/difundir `exits` | Cierto hoy |
| `enrichSceneWithExits` definida en `bridge/context.ts:244`, **único llamante** `:329` dentro de `broadcastScene`; muta `scene` in place (mismo objeto de `scenes_loaded`) y `bootstrap-tile.ts:117-118` lo persiste a propósito. Al reanudar `sessionDataForClient` (`wire-scene.ts:78-80,107`) **no re-enriquece** → reanudar no cura el panel | **A3 exige que sí re-enriquezca, o que las `exits` dejen de sellarse en `scene_data`** (`wire-scene.ts:16-17` ya llama error a ese sello) |
| «El cliente fija `currentExits` en `main.ts:1099-1100`» — **caducada**: hoy es `nefan-html/src/world/carga-de-tile.ts:140-148` (`entry.scene.exits` → `mundo.activarTile` → `travelPanel.setExits`), fichero de 379 líneas bajo tope 450; `main.ts` (2321, congelado) solo conecta `travelPanel.onTravel` (`:1649`); el despacho del wire vive en `bridge-client.ts:153-156` | **`main.ts` no suma líneas**: el cambio de cliente entra por `carga-de-tile.ts` / `mundo-del-cliente.ts` / `bridge-client.ts` |
| Hermano `map_upsert_place` **confirmado**: el `name` se resuelve al difundir (`context.ts:253`). `map_add_trigger`/`npc_move_to_place` no afectan | — |
| **Cómo NO arreglarlo**: re-difundiendo la escena entera (vuelve a pasar por `fpsAtlasController.onActiveTile` y `addEnemies`: paga atlas y mueve el mundo para pintar un botón) | **No existe** mensaje de solo-salidas (`src/protocol/messages.ts`: 30 tipos; `SceneExit` en `:204`). Nace uno pequeño con `SceneExit[]`. El molde `onProgress` existe: opción en `state-http/context.ts:46`, cableada en `ws-server.ts:181-188`, usada por `narrativeProgress` (`session-routes.ts:57`) |
| El bloqueo por #225 (`handle` de complejidad 158) **caducó**: #225 cerrado, los endpoints viven en `map-routes.ts` | — |

## Alcance

**Dentro**
1. **#395**: el save recoge el viaje por «Salidas» **por construcción**, no por efecto secundario:
   tras el `spawn` en el destino, `active_scene_id` y `player.position` del save son los del destino.
   El guion 60 pierde `guardarConLaPosicionDelDestino` y su `sinMedir` se vuelve aserto.
2. **#382**: una posición viva que no puede estar en la partida se **reporta** (sin bloquear la carga)
   por el canal de errores del cliente, con el NPC nombrado y la coordenada; sin falsos rojos jugando
   bien y **sin tocar `src/combat/`**. Test unitario en `mundo-persistido` (positivo y negativo) y
   aserto en el guion 55 (o guion nuevo) por la vía del save editado, que es la repro del issue.
3. **#179**: un `map_link` (y el renombrado por `map_upsert_place`, si el arquitecto lo admite como
   hermano) creado a mitad de sesión llega al panel «Salidas» **sin re-difundir la escena** (cero
   `scene_init`, cero POST de atlas, cero `addEnemies`), y sobrevive a cerrar y reanudar (las `exits`
   persistidas se re-enriquecen o se recalculan al servir).
4. Cada mensaje o campo nuevo del protocolo con su tipo en `nefan-core/src/protocol/` (`WorldScene`
   sigue sin tipo hasta T7/#378: no se abre aquí).
5. Tests y mutación local de los módulos tocados que quepan en `tope_local` (120); los que no
   (`scene-normalize` 278, `mundo-persistido`?) se piden y se sigue.

**Fuera**: #377 y todo `src/combat/` (decisión del usuario: `futuro`); `src/simulation/npc-behavior.ts`
(movimiento = plugin, baja prioridad); el troceo de `main.ts` (#358);
`WorldScene` tipado (#378, T7); pre-resolver los ocho tiles no activos al reanudar (fuera de alcance
escrito en #390).

## Criterios de aceptación

- **A1** (#395) En el banco (`e2e-sin-creditos`, Maqueta 3D con mapping local ya persistido, que es
  el caso sin mutación colateral): partida nueva → «Salidas» al vecino → esperar al save **por
  predicado** (active=destino ∧ pos ∈ rect del destino; sin forzar ningún guardado por el State API)
  → recargar → Reanudar → `__nefan.fps().activeTile` es el destino y el
  jugador aparece en él. Guion 60 sin `guardarConLaPosicionDelDestino`, rojo sobre `6d3d7ac`.
- **A2** (#382) Save editado con `entities[].position` de `barkeep` = `[168.25,0,168.25]` (cell
  intacta) → Reanudar → el panel de errores nombra a `barkeep` y la coordenada, y la escena carga. Con
  un save sin tocar con la posición de `barkeep` movida a mano DENTRO del rect de otro tile cargado
  (el caso «enemigo que persigue»), el panel sigue en «— sin errores —» (negativo del falso rojo). Test unitario en `mundo-persistido`
  con los dos casos.
- **A3** (#179) Con la partida viva, `POST` de `map_link` por el State API → el panel «Salidas»
  muestra el destino nuevo sin que se haya emitido `scene_init` ni ningún `POST /scene/…` del atlas
  (contar mensajes en el guion); cerrar → Reanudar → el destino sigue en el panel. Guion nuevo rojo
  sobre `6d3d7ac`.
- **A4** Ningún `catch` silencioso nuevo, ningún `return null` sin canal; los `.catch()` del bridge
  sobre promesas que espera el cliente broadcastean `narrative_status: error`.
- **A5** `npm run verify` verde · `crap --check` dentro · `deuda` sin subir (74) · `node qa/run.mjs`
  completo verde (61 + los nuevos) · `main.ts` en 2321 líneas o menos (`client-file-size.json`).
- **A6** Comentario de cierre en cada issue con lo medido; #377 anotado con lo que #382 decidió hacer
  sin él.

## Restricciones (vigentes de la serie)

- **No cerrar servidores ajenos** (hay otros agentes en la máquina): `./start.sh s` antes; solo
  `./start.sh --preset <slug>` / `--parar` para lo propio; nunca `pkill`/`kill` por puerto;
  `pgrep -fa "qa/run.mjs"` antes de una batería completa y esperar si hay otra corriendo.
- **Cero créditos** en toda verificación (`e2e-sin-creditos`; `cliente-web` solo en Maqueta 3D).
- Español (España) con tildes. Rama + PR con `Closes #395`, `Closes #382`, `Closes #179` y la nota de
  honestidad (el CI no corre `qa/`). Commits con los trailers de la sesión. Sin push ni PR por parte
  del ingeniero: lo hace el coordinador.
- La mutación la autoriza el usuario (6 commits pendientes, corrida completa): pedir y seguir.
- `ctx.activePlugins` no se toca; si algo de resume lo roza, `vaciarPluginsActivos(ctx)`.
