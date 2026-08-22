# Servicios de IA, modelos y pre-generación

Los tres procesos Python, qué modelo hace qué, el bench de skinning y la pre-generación de mundo y estilo. Consúltalo antes de tocar nada que gaste créditos.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Stack Python de IA — Endpoints (3 procesos desde F3/F4)

`ai_server/main.py` (narrative-llm :8765), `ai_server/gpu_worker_main.py`
(:8766) y `ai_server/remote_gen_main.py` (:8768) comparten paquete y `.venv`.
:8765 proxya los endpoints GPU y `/cache|/assets` para los clientes no
migrados; el cliente web resuelve cada servicio con `serviceUrl()`. Contratos
en `nefan-core/src/contracts/`.

| Endpoint | Proceso | Que hace |
|----------|---------|----------|
| `/health` | los 3 | Estado del proceso (el del gpu-worker incluye `model_backend`) |
| `/backend_status` | :8765 | Estado de meshy_3d (vía /health del gpu-worker) + ai_vision (panel del title screen) |
| `/generate_scene` | :8765 | **Canónico** — LLM genera escena open-world (terreno, vegetación, edificios, objetos) |
| `/analyze_weapon` | :8765 | Vision IA para orientar armas (vía MCP bridge) |
| `/develop_world` | :8765 | Desarrolla el borrador de mundo de un jugador (kind MCP develop_world) |
| `/notify_session` | :8765 | El bridge informa de inicio/reanudación de sesión narrativa (`AiClient`) |
| `/report_player_choice` | :8765 | El bridge reporta la elección de diálogo → Claude devuelve consequences |
| `/generate_texture` | :8766 | Textura PBR seamless (albedo+normal), ~1s |
| `/generate_model` | :8766 | Modelo GLB desde prompt (Meshy o TripoSG) |
| `/generate_skin` | :8766 | Skin de personaje (PNG, ~10s) |
| `/generate_sprite` | :8766 | Sprite RGBA 2D desde prompt |
| `/generate_surface_atlas` | :8768 | Atlas de superficies de la vista fps: una celda = un asset reusable |
| `/skin_sprite_sheet` | :8768 | Sprite sheet skinneado por IA (Meshy hero-shot + atlas) |
| `/styles/upload` | :8768 | Sube un estilo de usuario (JSON base64) y reporta categorías faltantes + coste |
| `/styles/{id}/complete` | :8768 | Genera las categorías que faltan (requiere confirm=true — gasta créditos) |
| `/dev/api_cache` | :8768 | Toggle del modo dev de APIs de pago (visible para los 3 procesos) |
| `/assets`, `/assets/by_hash/{hash}` | :8767 | Índice de assets del manifest (asset-store; :8765 proxya) |
| `/cache/{type}/{hash}` | :8767 | Servir asset cacheado (albedo/normal/roughness/model/skin/sprite; :8765 proxya) |

## Modelos de IA y que hacen

| Modelo | Uso | Donde |
|--------|-----|-------|
| **Claude Sonnet 4.5** | Genera escenas open-world, reacciona a las elecciones del jugador esculpiendo el mundo (spawn dinámico de edificios/NPCs/objetos), orienta armas vía visión | llm_client.py via MCP bridge o API |
| **SD 1.5** + LCM-LoRA + TAESD | Texturas PBR seamless tiling (4 pasos, fp16) | texture_generator.py |
| **SD 1.5** | Imagenes referencia para modelos 3D | model_generator.py |
| **rembg** (u2net) | Quitar fondo de referencias de modelo | model_generator.py |

VRAM: ~3 GB pico (fp16). Todo secuencial con GPU lock (sin concurrencia CUDA).

## labs/skinning — pruebas de IA sobre sprites

Bench permanente para evaluar APIs de skinning (Meshy, fal.ai, video models, etc.) sobre los sprite sheets que pre-renderiza `tools/render-sprite-sheets/`. Vive en el repo porque la tecnologia avanza rapido y hace falta repetir pruebas. Ver `labs/skinning/README.md` para detalles. Hallazgos consolidados:
- **V1 single** y **V2 anchor** dan deriva inaceptable.
- **V3 rolling** funciona con base limpia (Y Bot), caro pero viable.
- **V4 atlas (≤10 frames en 5×2)** es lo mejor: 1 llamada, consistencia perfecta dentro del atlas. **NO escala** a >10 frames — el modelo colapsa a la misma pose.
- **V5 packed (2026-08-18)**: varias DIRECCIONES comparten atlas (fila = dirección + hero de ancla) dentro del techo de 10 celdas — validado en gpt-image-2 y nano-banana-pro, EN PRODUCCIÓN (`plan_dir_batches`): un personaje auto (idle/walk/run) baja de 25 a 17 llamadas. Grids de aspecto extremo (4×1) rompen la integridad; el letterbox de gpt-image-2 se recorta con `fit_atlas_output`.
- **Pose-lock (T-posegate 2026-08-18)**: el prompt del atlas DEBE fijar la pose de cada celda y degradar el hero a "appearance only" (`build_atlas_prompt`), y el hero se genera en pose neutral, nunca T-pose — si no, los atlas de poses sutiles (idle) salen como turnaround en T-pose. Un output que no repinta el clay se rechaza fail-loud (`atlas_echo_score`), nunca se cachea.
- **Locomotion (walk/run)** requiere Hips XZ lock o el personaje sale del cell. Implementado en `tools/render-sprite-sheets/page.mjs:lockHipsXZ()`.

## Pre-generación: mundo por juego y estilo por (juego, estilo)

El contenido de la génesis es independiente del estilo y se pre-genera en dos capas (regenerables desde el título):

- **Snapshot de mundo** — `data/games/{id}/world/tile.json` (gitignored; ruta única desde que murió el eje de vistas — el snapshot ya no declara rama; schema en `src/games/world-snapshot.ts`, invalidado por `world_doc_hash`). Lo escribe pasivamente cualquier bootstrap vivo, y el job **`generate_game`** (WS desde el título, `bridge/handlers/game-gen.ts`) lo genera completo: bootstrap + anillo 3×3 + hasta 8 places clave en una sesión efímera (borrada al terminar; progreso por `narrative_status kind "game_gen"`). `start_session` lo replayea por la ruta normal (~50 ms, cero llamadas al motor); stale (world.md editado) degrada al bootstrap vivo con warning, nunca en silencio. En la génesis el motor puede declarar el **vocabulario canónico** del mundo (tool `vocabulary_set` → `world/vocabulary.json`: descs de superficies/arquetipos); los turnos de tile lo reciben como `world_vocabulary` — reusar una desc verbatim es cache-hit del asset estilizado (opcional, como `available_assets`).
- **Aplicación de estilo** — batch del título (`nefan-html/src/ui/style-apply.ts`) sobre el snapshot: pack del estilo si incompleto, librería de superficies fps (celdas computadas con las MISMAS funciones puras que la vista — reuso exacto por hash) y skins del roster (prompts/refs con las mismas reglas que main.ts; `npcSkinStyleRef` es la fuente única). Coste estimado ANTES de gastar (dry-run `GET /styles/{id}/missing` + `resolve_only` del atlas) y confirmación con checkboxes por bloque. Registro en `world/styles/{style_id}.json` + hashes pineados en el asset-store (`POST /assets/pin`, el prune protege keep-list ∪ pins). Regenerar mundo invalida los registros y despina.
- **UI**: tarjeta de mundo con su estado y los estilos aplicados (✓/⟳/—); botones Generar/Regenerar mundo (regenerar = 2 clicks) y Aplicar estilo (exige el mundo ya generado); crear mundo encadena `generate_game` (checkbox, default ON). E2E sin créditos: fake-ai-server sirve `/styles/*` y el atlas con `resolve_only`; el bridge acepta `NEFAN_GAMES_DIR` para no contaminar los juegos reales con génesis de bench.
