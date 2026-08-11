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

- **Input WS del bridge sin validación runtime** (`bridge/ws-server.ts:198`).
  `JSON.parse(raw) as ClientMessage` sin comprobar; todo el input del cliente
  llega a los handlers sin validar. `state-http-server` y `asset-store`
  validan a mano pese a tener contratos tipados en `src/contracts/`. Propuesta:
  validadores zod en el borde a partir de los contratos.
- **`validate_scene_response` degrada a mapa de hierba en silencio**
  (`ai_server/narrative_schemas.py:237`). Contradice la doctrina fail-loud y la
  memoria del proyecto: un fallo del motor se vuelve un mapa vacío
  indistinguible de uno legítimo. Decidir si se quiere ese fallback o
  fail-loud + reintento.
- **`race` en `handleSetRenderMode`** (`bridge/handlers/session.ts:507`).
  Read-modify-write en disco de una sesión que puede ser la activa en memoria;
  last-writer-wins sin lock.
- **Enrutado de `image_review`/`stage_review` en narrative-mcp**
  (`server.ts:462`). Se responden como `room_response` en vez de
  `vision_response`; funciona por accidente (resolución por request_id) pero una
  respuesta tardía entra en la rama `_timed_out_scenes` de `llm_client.py`
  pensada solo para escenas. Necesita rediseño con el lado ai_server delante.

### Media

- **Colisión duplicada bridge↔cliente** (`bridge/sim-collision.ts` vs
  `nefan-html/src/world/collision.ts`). Dos implementaciones separadas de las
  mismas reglas → riesgo de desincronización de movimiento. Unificar en core.
- **Reglas de juego solo en el cliente 2D** (`world/collision.ts` semántica
  "salir sí, entrar no"; `world/frontier.ts` umbrales). Ni en core ni en 3D.
- **Migración v3→v4 corrompe spawns dinámicos** (`narrative-state`/`migrations`).
  Trata metros de mundo como celdas → teletransporte al resumir saves v3 con
  entidades `narrative_request`. Sin cobertura de test v3→v4. (Ver sección 3.)
- **`stage/greybox` hardcodea `solid/tall=true`** para todo volumen
  (`greybox.ts:930`): alfombras (`prop passable`) y arbustos pintados se
  vuelven colisión sólida al llegar la visión.
- **`wall` no axis-aligned se renderiza como caja AABB gigante**
  (`stage/greybox.ts:1161`): un muro diagonal/en L tapa medio plató mientras la
  colisión deja pasar. El tile lo hace bien (tramos por segmento).
- **Defaults de radio divergentes render↔colisión** en tower/fountain/rock/prop
  (stage): el manifest y la colisión declarada usan defaults distintos cuando el
  motor omite `r` (frecuente).
- **`clearGatePassage` holgura fija 3.5** (`blueprint/collision.ts:149`) no
  atraviesa muros gruesos (`wall.width` hasta 12): puerta visualmente abierta,
  colisión bloqueada.
- **Contexto LLM sin cotas** (`serialize-llm`, `narrative-state`): `entities` y
  `story_so_far` crecen sin límite por playthrough (coste + degradación).
- **`player` sin defaults al cargar** (`narrative-state.ts:247`): un save sin
  `gold`/`inventory` deja NaN en la aritmética del plugin economy.
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

- **`dodge_chance`/`damage_mult` de dificultad inertes** (`enemy-ai.ts` +
  `difficulty-presets.ts`): nadie los lee → easy y hard pegan igual. Cablearlos
  requiere RNG en la resolución y decidir si el jugador también tiene mult;
  toca balance y determinismo. → decisión de diseño.
- **Migración v3→v4 metros-como-celdas** (`migrations.ts:85`): fix con riesgo de
  romper resumes existentes; requiere fixtures v3→v4 antes de tocar.
- **`animation-matcher.ts` huérfano** (186 líneas, cero importadores): candidato
  a borrado, pero `data/animation_intrinsics.json` SÍ lo usa Godot
  (`combat_animation_sync.gd`) — conservar el JSON, borrar solo el .ts. Confirmar
  antes de borrar por si es API futura.
- **Waypoint de `goto` obsoleto reutilizado por `wander`**
  (`npc-behavior.ts`): un NPC camina hasta 128 m a un destino cancelado cuando
  se retira `in_transit`. Fix acotado pero conviene test de comportamiento
  antes.
- **A2/A3 animation-controller** (turn dura 1 frame; death resucita a idle):
  módulo sin consumidor de runtime (ni Godot ni HTML lo usan) — arreglar o
  documentar como muerto junto con animation-matcher.
- **Enrutado image_review/stage_review** (ver sección 2, alta) — bug latente.
