# Auditoría de código — agosto 2026

Auditoría crítica del repo (código escrito por modelos de IA de varias
generaciones). Este documento acompaña a la PR de **bugs claros** (rama
`audit/bugfixes`) y recoge lo que queda para **discutir** y trocear en PRs
posteriores.

- **Bugs claros** → arreglados en la PR de esta rama (sección 1).
- **Discutibles / arquitectura / mejoras** → sección 2, ordenados por severidad.
- **BUG_CLARO no arreglados aún** (necesitan decisión de diseño o verificación
  extra) → sección 3.

Metodología: lectura crítica por módulos + tests dirigidos + verificación E2E
con playwright sobre el stack sin créditos (fake-ai-server + bridge + HTML).
Suites en verde tras cada cambio: 778 tests nefan-core, 73 Python, tsc ×2, build
narrative-mcp, y smoke E2E (carga de plató, movimiento, colisión).

---

## 1. Bugs claros arreglados en esta PR

### Seguridad
1. **Prototype pollution en el DSL de plugins** (`src/plugins/dsl/paths.ts`).
   `__proto__`/`prototype`/`constructor` como segmento de path de escritura
   alcanzaban `Object.prototype`; la contaminación sobrevivía al rollback
   transaccional y ocurría ya al replayear fixtures en la carga. Vías: literal
   en manifest, interpolación `{event.k}`, projection `{entity.id}`. Fix:
   `assertSafeKey` en parse (fail-loud en génesis) + concretize + descenso de
   escritura + `member()` en lectura. Test nuevo.
2. **Path traversal en `delete_session`** (`src/narrative/session-storage.ts`).
   El `sessionId` del wire (WS sin auth) llegaba a `fs.rm(recursive)` sin
   validar; `../..` borraba fuera de `saves/`. Fix: containment check en
   read/write/delete. Test con canario.

### Corrupción de datos / crashes
3. **Save no atómico** (`session-storage.ts`). `writeFile` directo → un corte a
   mitad corrompía el save y el resume lanzaba (partida irrecuperable). Ahora
   tmp+rename.
4. **Ciclo de `parent_id` cuelga el bridge** (`src/world-map/world-map.ts`).
   `upsertPlace(parent=self|descendiente)` hacía `getAncestors` bucle infinito
   (congela el event loop; disparable por el LLM vía `map_upsert_place`). Fix:
   rechazo de ciclo + Set de visitados.
5. **Colisión de ids de spawn en el mismo turno** (`consequence-handler.ts`).
   Varias `spawn_entity` del mismo turno compartían id (`narr_kind_ts`),
   colapsando NPCs en el sim. Fix: ordinal por dispatch + `recordEntitySpawned`
   devuelve id único (sufija duplicados con warn) y el effect usa ese id.
6. **`asset-index` traga manifest corrupto** (`src/narrative/asset-index.ts`).
   `readAll` devolvía `[]` ante JSON corrupto y `addEntry` lo machacaba con una
   sola entrada. Ahora ENOENT→`[]`, corrupto→lanza.
7. **`prune` sin keep-list borra assets en uso** (`services/asset-store/`).
   Si world-state no responde, se podaba sin protección. Ahora se ABORTA (503):
   los saves post-F2 referencian por hash.

### Lógica de juego
8. **Melee golpea por la espalda con calidad perfecta**
   (`src/combat/combat-resolver.ts`). La precisión mide distancia perpendicular
   a la línea del forward tratada como infinita → un objetivo detrás en alcance
   daba offset 0 y daño perfecto. Fix: gate frontal (cono ±60°). El test que lo
   "cubría" ponía el objetivo a 5 m (distancia 0); ahora prueba objetivo detrás
   EN alcance + objetivo al frente.
9. **`validateScene` rechaza ríos continuados** (`src/scene/scene-validate.ts`).
   Los cruces de tipo río continúan en celda de agua (sólida); exigirles
   alcanzabilidad andando rechazaba tiles correctos. Ahora solo cruces
   TRANSITABLES son objetivos del flood, casados por tipo compatible.
10. **`validateScene` se salta la alcanzabilidad en silencio**. Si la entrada
    casaba con un río (agua), `walkableStarts` quedaba vacío y toda la
    validación se saltaba, aprobando tiles injugables. Ahora: tile con enlace
    de vecino y cero terreno transitable = error; entrada en agua con tierra en
    otro sitio = aviso.
11. **RNG de NPCs sembrado con `Date.now()`** (`bridge/context.ts`). El
    comportamiento "determinista" se sembraba con reloj. Ahora
    `seededRng(session_id+":npc")` — reproducible entre resumes; causa probable
    de la flakiness histórica de `bridge-npc`.
12. **`create("constructor")` burla el fail-loud del registry**
    (`src/systems/registry.ts`). `has()`/`create()` usaban `in`/acceso directo;
    `Object.hasOwn` cierra el borde (disparable por `game.json`).

### Config / higiene
13. **`llm_model` con ID inexistente** (`config.ts`, `ai_server/llm_client.py`).
    `claude-sonnet-4-5-20250514` (nombre de 4.5 + fecha de Sonnet 4) → 404 en la
    ruta de API directa. Corregido a `claude-sonnet-4-5-20250929`.
14. **`window.__nefan` pisado en DEV** (`nefan-html/src/main.ts`). El bloque
    DEV reemplazaba el hook global; los benches perdían `tiles`/`frontier`/…
    Ahora hace merge (`Object.defineProperties`). Verificado en vivo.
15. **SAVES_DIR cableado a `~/code/ne-fan/saves`** (bridge + Godot) — ahora
    derivado del repo, coherente con `start.sh` (`$PROJECT_DIR/saves`).
16. **narrative-mcp/server**: limpia `currentStageExpectedIds` junto a
    `currentClassifyIndices`; comentario huérfano borrado.
17. **Godot**: `.uid` huérfanos borrados (`sprite_cache`, `sprite_loader`);
    `tools/README.md` describía ficheros inexistentes (room_builder,
    chunk_manager, terrain_generator…) — reescrito.

---

## 2. Discutibles / arquitectura / mejoras (para trocear en PRs)

### Alta prioridad

- ~~**Input WS del bridge sin validación runtime**~~ **RESUELTO** (rama
  `audit/ws-input-validation`). `ClientMessageSchema` (zod, espejo EXACTO del
  union TS `ClientMessage`, con guardia de deriva a nivel de tipos en
  `src/protocol/message-schema.ts`) valida cada frame en el borde
  (`bridge/message-intake.ts`); JSON inválido o shape no conforme → rechazo
  fail-loud con `narrative_status` error, sin alcanzar los handlers. Verificado
  en vivo (cliente→bridge por WS) y contra las formas reales de HTML y Godot.
  Pendiente análogo: `state-http-server` y `asset-store` siguen validando a
  mano pese a tener contratos tipados en `src/contracts/`.
- ~~**`validate_scene_response` degrada a mapa de hierba en silencio**~~
  **RESUELTO en #118** (Stage 5b) y verificado de nuevo (2026-08-12). La función
  es fail-loud en la forma (lanza `ValueError` en grid que no cuadra, entity con
  kind/glyph/footprint inválido, tile sin biome; el caso exacto del bug —
  `terrain: {type: "grass"}` que antes se volvía mapa de hierba — ahora lanza,
  cubierto por `test_terrain_not_list_raises` + 12 tests). Toda la cadena aguas
  abajo es fail-loud Y visible: `/generate_scene` → 503/504; `AiClient` →
  `Result {ok:false,error}`; handlers scene.ts/tile.ts → `fail()` que
  broadcastea `narrative_status: error` (sin inyectar escena de hierba); HTML
  muestra overlay de error, Godot lo lleva al HUD. El "reintento" existe vía el
  round-trip del pre-flight MCP (el modelo corrige y re-responde).
- ~~**`race` en `handleSetRenderMode`** (`bridge/handlers/session.ts:507`).
  Read-modify-write en disco de una sesión que puede ser la activa en memoria;
  last-writer-wins sin lock.~~ **RESUELTO** (rama `audit/render-mode-race`). Era
  un **doble escritor** del save dentro del bridge: `ctx.narrative.save()`
  escribe `saves/{id}/state.json` vía el mismo storage que
  `ctx.sessionStorage.write`. El handler leía disco (snapshot en t0), mutaba el
  flag y reescribía en t2 — pisando cualquier `save()` intermedio (posición,
  tiles explorados, entities revertían a t0). Fix: la sesión ACTIVA muta el
  mundo EN MEMORIA (la autoridad) y persiste por su `save()` (escritor único);
  el read-modify-write de disco queda solo para partidas INACTIVAS. Lógica pura
  extraída a `src/narrative/render-mode.ts` (`applyRenderModeUpgrade`, testeada)
  compartida por ambas ramas. Test de regresión del clobber (verificado que
  falla contra el handler anterior). Nota residual: dos `set_render_mode`
  concurrentes sobre la MISMA partida inactiva (scenes+characters) aún podrían
  competir; no realista desde el título (envío serial) y de menor impacto.
- ~~**Enrutado de `image_review`/`stage_review` en narrative-mcp**
  (`server.ts:462`). Se responden como `room_response` en vez de
  `vision_response`; funciona por accidente (resolución por request_id) pero una
  respuesta tardía entra en la rama `_timed_out_scenes` de `llm_client.py`
  pensada solo para escenas.~~ **RESUELTO** (rama `audit/vision-review-routing`).
  El contrato del wire (`narrative-mcp-ws.ts` → `VisionRequestMsg.kind`) ya
  incluye ambos kinds: ahora se enrutan por `sendVisionResponse` desde un
  `VISION_KINDS` const con **guardia de deriva a nivel de tipos** (doble
  asignación contra `VisionRequestMsg['kind']` — `tsc -b` rompe si el contrato
  añade/quita un kind de visión). Verificado en runtime contra el `server.js`
  real (cliente MCP por stdio + WS falso de ai_server): pre-fix devolvía
  `room_response`/`room_data`, post-fix `vision_response`/`result` para
  `image_review` y `stage_review`. El lado Python ya consumía `vision_response`
  correctamente (mismo payload en `_pending`).

### Media

- ~~**Colisión duplicada bridge↔cliente** (`bridge/sim-collision.ts` vs
  `nefan-html/src/world/collision.ts`). Dos implementaciones separadas de las
  mismas reglas → riesgo de desincronización de movimiento. Unificar en core.~~
  **PARCIAL — foco: política del plan** (rama `audit/collision-plan-unify`). La
  matemática (`TerrainCollider`, `groundCollisionGrid`, `volumeCollisionGrid`)
  ya estaba en core; lo duplicado era la POLÍTICA. Divergencia estructural real
  encontrada y eliminada: el cliente unía `ground`+`volumes` en UN grid mientras
  el bridge los dejaba como dos colliders OR'd → en los solapes diferían por la
  semántica salir-sí-entrar-no. Ahora ambos derivan la colisión del plan por la
  MISMA función `planCollisionGrid` (core, `blueprint/plan-collision.ts`) — un
  solo grid. Tests: unidad de `planCollisionGrid`/`unionCollisionGrids` +
  **consistencia bridge↔cliente** (mismas decisiones de bloqueo sobre los mismos
  datos). Divergencias intencionales restantes (documentadas en las cabeceras de
  ambos ficheros, NO unificadas por falta de datos server-side): (a) grid del
  análisis (rects de elementos en el bridge vs contactos pintados, más finos, en
  el cliente); (b) platós modo imagen (el cliente sustituye la huella declarada
  por los recortes pintados; el bridge mantiene la declarada); (c) frontera de
  tiles, viewConstraint (bounds del proscenio) y AABBs del esquema son del
  jugador, no de los NPCs. La opción "completo" (servidor con recortes pintados
  + clamp de bounds para NPCs) queda pendiente si se decide abordar.
- ~~**Reglas de juego solo en el cliente 2D** (`world/collision.ts` semántica
  "salir sí, entrar no"; `world/frontier.ts` umbrales). Ni en core ni en 3D.~~
  **RESUELTO — la parte con drift real** (rama `audit/player-radius-unify`). Al
  auditar, la semántica "salir sí, entrar no" YA vive en core
  (`terrain-collision.ts` → `TerrainCollider.blocksMove`) y la usan cliente y
  bridge; la derivación de colisión se unificó en #122. Lo que quedaba disperso
  con **drift real** era el radio del jugador `0.4`, copiado A MANO en TRES
  sitios (dos con comentario "espejo de PLAYER_RADIUS"):
  `nefan-html/world/collision.ts`, `nefan-core/scene/stage/segments.ts`
  (inflado de zonas de salida) y `nefan-html/renderer/canvas-renderer.ts`
  (tamaño de dibujo). Unificado en `PLAYER_RADIUS_M` (fuente única en core,
  `terrain-collision.ts`) importado por los tres → cambiarlo los mueve a todos.
  Verificado que el servidor NO colisiona al jugador (el cliente es autoritativo
  de su movimiento; los NPCs usan su propio `NPC_RADIUS=0.5`), así que no había
  desync server-side. **INTENCIONALMENTE client-2D-specific** (no son reglas
  compartidas, no se tocan): los umbrales de `frontier.ts` (prefetch/veil/
  blocking) son UX de generación de tiles del cliente, y las fuentes de colisión
  frontera/AABB del esquema son del jugador (el bridge no las tiene).
- **Migración v3→v4 corrompe spawns dinámicos** (`narrative-state`/`migrations`).
  Trata metros de mundo como celdas → teletransporte al resumir saves v3 con
  entidades `narrative_request`. Sin cobertura de test v3→v4. (Ver sección 3.)
- ~~**`stage/greybox` hardcodea `solid/tall=true`** para todo volumen
  (`greybox.ts:930`): alfombras (`prop passable`) y arbustos pintados se
  vuelven colisión sólida al llegar la visión.~~ **RESUELTO** (rama
  `audit/stage-greybox-solid-tall`). El manifest del stage ahora deriva
  `solid`/`tall` con `classifyVolume(v)` — la MISMA semántica que ya usaban el
  clasificador de visión del tile y `volumeCollisionGrid` (bush → false/false;
  rock/fountain → true/false; `prop passable` → solid:false; prop → tall si
  h>4). Vía `expectedElementsFromGreybox` → `items` → `collisionGridFromCutouts`,
  un recorte pintado de alfombra o arbusto ya NO entra como colisión sólida ni
  occluder alto. Test de regresión por tipo + el test del contrato de pistas
  actualizado (espejaba el `true/true` viejo).
- ~~**`wall` no axis-aligned se renderiza como caja AABB gigante**
  (`stage/greybox.ts:1161`): un muro diagonal/en L tapa medio plató mientras la
  colisión deja pasar. El tile lo hace bien (tramos por segmento).~~ **RESUELTO**
  (rama `audit/stage-wall-segments`). `buildVolumePrimitives` renderizaba el
  wall como UNA caja del AABB de todos los puntos (`[w,hM,d]`); ahora emite una
  caja por TRAMO de la polilínea, orientada con su `rotY` (`-atan2`), igual que
  el tile (`volumePartsForTile`). La colisión ya era correcta (`markBand` por
  segmento). Test de regresión con muro en L (2 tramos delgados, no una caja
  16×16) verificado que falla contra el código anterior. El manifest sigue
  usando el AABB como caja-pista de visión (aceptable: el recorte pintado casa
  dentro; cambiarlo partiría un wall en N entradas de items/expected_elements).
- ~~**Defaults de radio divergentes render↔colisión** en tower/fountain/rock/prop
  (stage): el manifest y la colisión declarada usan defaults distintos cuando el
  motor omite `r` (frecuente).~~ **RESUELTO** (rama `audit/stage-radius-source`).
  Matiz (decisión del usuario): render ≠ colisión es LEGÍTIMO (un árbol dibuja
  copa grande y colisiona solo en el tronco) — el bug real es que el MANIFEST
  (`volumeFootprintCells`, la huella COLISIONABLE) usaba radios distintos que la
  colisión (`volumeCollisionGrid`): tower r??3 vs r??6, fountain r??4 vs r??5,
  rock 1.2s vs 2.1s, prop-punto 1 vs 1.3. Fix: fuente única
  `volumeSolidDiscRadiusCells(v)` (en blueprint/collision.ts) para los sólidos
  UNIFORMES (tower/fountain/rock/prop-punto), usada por la colisión (refactor
  byte-idéntico) Y por la huella del manifest → coinciden por construcción. El
  RENDER (`buildVolumePrimitives`) NO se toca (independiente). El ÁRBOL queda
  fuera del helper a propósito (su excepción copa/tronco). Test anti-drift:
  media huella del manifest == radio de colisión; verificado que falla contra
  los defaults viejos.
- ~~**`clearGatePassage` holgura fija 3.5** (`blueprint/collision.ts:149`) no
  atraviesa muros gruesos (`wall.width` hasta 12): puerta visualmente abierta,
  colisión bloqueada.~~ **RESUELTO** (rama `audit/gate-passage-thickness`). La
  profundidad del vano sale ahora del GROSOR del muro anfitrión (`gateHostWallWidth`
  proyecta el `at` de la puerta sobre los muros, mismo criterio que el greybox
  para tallar el vano) — `dh = max(3.5, width/2 + 0.5)`: suelo en 3.5 (cubre el
  cuerpo de la puerta y muros finos, comportamiento previo intacto) y crece para
  cruzar los gruesos. El greybox ya quitaba el tramo entero del muro en el vano,
  así que el visual ya cruzaba; esto alinea la colisión. Test de regresión con
  muro width 12 (verificado que falla contra la holgura fija).
- ~~**Contexto LLM sin cotas** (`serialize-llm`, `narrative-state`): `entities` y
  `story_so_far` crecen sin límite por playthrough (coste + degradación).~~
  **RESUELTO** (rama `audit/llm-context-caps`). Cotas SOLO en la proyección
  (`buildLlmContext`) — el save conserva todo, patrón world_doc (brief por
  turno + tool para el detalle): `story_so_far` > `LLM_STORY_MAX_CHARS` (6k)
  → solo la cola reciente cortada en párrafo con marcador que remite a la
  tool nueva `story_get` (→ `GET /story` del State API); `entities` >
  `LLM_ENTITIES_MAX` (60) → escena activa completa + spawns más recientes en
  orden cronológico, con `entities_total` marcando el recorte y tool nueva
  `entity_list` (→ `GET /entities`, que ya existía sin tool; ahora incluye
  `name`). `world_rules.md` documenta el contexto acotado (BOUNDED CONTEXT).
  Tests de regresión de ambas cotas (verificados discriminantes) + `/story`;
  cadena MCP→bridge ejercitada en vivo (stdio client).
- ~~**`player` sin defaults al cargar** (`narrative-state.ts:247`): un save sin
  `gold`/`inventory` deja NaN en la aritmética del plugin economy.~~
  **RESUELTO** (rama `audit/player-load-defaults`). `loadSession` hace ahora
  spread sobre `DEFAULT_PLAYER` clonado (mismo criterio aditivo que `world`):
  lo presente en el save se conserva, lo ausente cae al default (gold 0,
  inventory [], appearance pete) — la aritmética de plugins (inc/dec sobre
  `player.gold`, push a inventory) no vuelve a ver undefined. Test de
  regresión con save v3 pre-economy (verificado que falla contra la copia
  directa) que además cubre que el array default no se comparte entre
  instancias.
- **Huecos de validación Python↔TS**: Python no valida rangos/límites de
  ground/volumes (TS sí); `stage` sin validación estructural Python;
  `image_review` sin fixtures de contrato (sin candado CI).
- **`validate_weapon_orient_response` devuelve None en 6 puntos sin traza**
  (`narrative_schemas.py`) — falla mudo contra la doctrina fail-loud.

### Prompts (contradicciones vistas de pasada; confirmar contra el consumidor)

- **"top-down 2D map" vs "single oblique projection"**: `scene_instructions.md`,
  `server.ts` y `generate_scene.json` dicen cenital; `world_rules.md`/
  `ui_systems.md` dicen oblicua. El motor pinta oblicua.
- **Campo `h`: celdas vs metros**. `image_review.md` ("celdas, persona ≈3.6")
  vs `stage_review.md` ("metros"); defaults de código divergentes
  (`narrative_schemas.py:1007` h=6 vs `routers/generation.py:547` h=2.0).
- **`style_tag` exigido pero ausente de `tools/generate_scene.json`**: el
  fallback API directa no puede emitirlo aunque el validador Python lo exige.
- **Composición stage**: STAGE+SCENE instructions se contradicen
  (meters_per_cell, presupuestos); `scene_instructions` referencia una sección
  de tile ausente; `tile_instructions` necesita "IGNORE su schema".
- **`develop_world` con 3 niveles de exigencia** distintos (md ≠ server.ts ≠
  narrative.py).
- **Duplicación**: tipos de consequence en ~7 sitios; schemas de review;
  vocabulario de directivas NPC; enum `style_tag` en 4 sitios. Legacy vivo:
  alias `nature→forest`, `perspective:isometric` aún leído, campos `room_*`,
  menciones residuales a SVG.

### Cobertura de tests (mejoras)

- Sin tests: `ws-server` (transporte), `tile_analysis` handler, blob-store
  (path traversal), `llm_client.py`, `validate_scene_response` (360 líneas),
  routers narrativa/generación Python; **nefan-html 0 tests**, **godot 0
  unitarios**. `contract-prompts.test.ts` no cubre `image_review.md` ni
  `stage_review.md`.

### Menores / higiene

- Puertos en dos registros (`config.ts` vs `contracts/service-registry.ts`).
- `StyleTag` (`contracts/remote-gen.ts`) copia manual desincronizada de
  `style-categories.ts` (omite `stage_*`, arrastra `nature`).
- `contracts/{narrative-llm,gpu-worker,gateway}.ts` — cero importadores.
- `DEV_AMBIENT_BOOST=3.0` congelado en `light_placer.gd` (la memoria dice que
  subir ambient en dev es deseado — decidir mecanismo, no borrar).
- ~28 `console.log` sin gatear en los pipelines de imagen del cliente.
- `attack_mapping.py` autodeclarado desalineado → `animation_intrinsics.json`
  derivado de él es sospechoso.

---

## 3. BUG_CLARO no arreglados (necesitan decisión/verificación)

Casi toda la tanda cerrada en la rama `audit/section3-cleanup` (decisiones del
usuario 2026-08-13):

- ~~**`dodge_chance`/`damage_mult` de dificultad inertes**~~ **RESUELTO** (campos
  inertes retirados). Matiz del audit corregido: la dificultad NO era del todo
  inerte — `reaction_time`, `aggression`, `move_speed`, `block_chance` y
  `attack_cooldown_mult` SÍ se leen y difieren entre easy/hard. Solo
  `dodge_chance` y `damage_mult` estaban muertos (guardados en `EnemyAI` pero
  jamás leídos). Eliminados de `DifficultyParams`, `EnemyAI`, `EnemyPersonality`
  (types.ts) y su espejo zod (`message-schema.ts`) — la guardia de deriva de
  #119 aguanta. Se reintroducen si se implementan de verdad (necesitarían RNG en
  la resolución + decisión de balance).
- **Migración v3→v4 metros-como-celdas** (`migrations.ts`): **APLAZADO** (bajo
  urgencia — saves v3 son de dev antiguos). Reconvierte posiciones celda→mundo y
  puede doble-convertir un spawn ya en metros; riesgo de romper resumes. Se
  aborda en PR propia con fixtures v3→v4 dedicadas, no en esta tanda.
- ~~**`animation-matcher.ts` huérfano**~~ **RESUELTO**. Al investigar resultó que
  TODO `src/animation/` (controller + state + transitions + matcher) no tenía
  ningún consumidor de runtime (solo el barrel `index.ts` y su propio test).
  Módulo entero borrado + su test + los exports de `index.ts`. El JSON
  `data/animation_intrinsics.json` se conserva (lo lee Godot directo vía
  `combat_animation_sync.gd`, symlink).
- ~~**Waypoint de `goto` obsoleto reutilizado por `wander`**~~ **RESUELTO**. El
  goal key que resetea la meta solo serializaba `data.directive`; ahora cubre
  también `data.in_transit` (`goalKeyOf`) → retirar in_transit resetea el
  waypoint del goto en vez de seguir hasta 128 m al destino cancelado. Test de
  regresión verificado que falla contra el código anterior (homeDist=36.8).
- ~~**A2/A3 animation-controller**~~ **RESUELTO** (borrado junto con el resto de
  `src/animation/` — sin consumidor, no vale la pena arreglar bugs de código
  muerto).
- ~~**Enrutado image_review/stage_review** (ver sección 2, alta) — bug latente.~~
  **RESUELTO** (rama `audit/vision-review-routing`; detalle en sección 2, alta).
