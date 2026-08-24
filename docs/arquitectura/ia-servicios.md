# Servicios de IA, modelos y pre-generación

Los tres procesos Python, qué modelo hace qué, las hojas de sprites de personaje y la pre-generación de mundo y estilo. Consúltalo antes de tocar nada que gaste créditos.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Stack Python de IA — Endpoints (2 procesos)

`ai_server/main.py` (narrative-llm :8765) y `ai_server/remote_gen_main.py`
(:8768) comparten paquete y `.venv`. :8765 proxya `/cache|/assets` para los
clientes no migrados; el cliente web resuelve cada servicio con
`serviceUrl()`. Contratos en `nefan-core/src/contracts/`.

El **gpu-worker** (:8766) y sus cuatro endpoints de generación local con GPU
se retiraron enteros en #199: llevaban desde julio sin un solo consumidor
vivo. Lo que hoy pinta el mundo son las superficies de remote-gen y las hojas
de personaje de sprite-forge.

| Endpoint | Proceso | Que hace |
|----------|---------|----------|
| `/health` | los 2 | Estado del proceso |
| `/backend_status` | :8765 | Estado de `ai_vision`. NOTA: hoy no tiene ningún cliente en `nefan-html/src` — candidato a retirada |
| `/generate_scene` | :8765 | **Canónico** — LLM genera escena open-world (terreno, vegetación, edificios, objetos) |
| `/analyze_weapon` | :8765 | Vision IA para orientar armas (vía MCP bridge) |
| `/develop_world` | :8765 | Desarrolla el borrador de mundo de un jugador (kind MCP develop_world) |
| `/notify_session` | :8765 | El bridge informa de inicio/reanudación de sesión narrativa (`AiClient`) |
| `/report_player_choice` | :8765 | El bridge reporta la elección de diálogo → Claude devuelve consequences |
| `/generate_surface_atlas` | :8768 | Atlas de superficies de la vista fps: una celda = un asset reusable |
| `/skin_sprite_sheet` | :8768 | **Adaptador** de sprite-forge (:8770, repo aparte): viste una anim de un personaje y guarda lo generado en `cache/sprite_sheets/` |
| `/sprite_catalog` | :8768 | Proxy del `/catalog` de sprite-forge: modelos, animaciones, ángulos y `calls_per_anim` (el coste que se enseña ANTES de gastar) |
| `/styles/upload` | :8768 | Sube un estilo de usuario (JSON base64) y reporta categorías faltantes + coste |
| `/styles/{id}/complete` | :8768 | Genera las categorías que faltan (requiere confirm=true — gasta créditos) |
| `/dev/api_cache` | :8768 | Toggle del modo dev de APIs de pago (visible para los 3 procesos) |
| `/assets`, `/assets/by_hash/{hash}` | :8767 | Índice de assets del manifest (asset-store; :8765 proxya) |
| `/cache/{type}/{hash}` | :8767 | Servir asset cacheado (`surface`/`sprite_sheet` vivos; `texture`/`model`/`skin`/`sprite` ya sin productor, se sirven los históricos; :8765 proxya) |

## Modelos de IA y que hacen

| Modelo | Uso | Donde |
|--------|-----|-------|
| **Claude Sonnet 4.5** | Genera escenas open-world, reacciona a las elecciones del jugador esculpiendo el mundo (spawn dinámico de edificios/NPCs/objetos), orienta armas vía visión | llm_client.py via MCP bridge o API |

Ya no queda generación local con GPU: se fue entera con el gpu-worker (#199),
y con ella torch/diffusers y sus ~5 GB de `.venv`. Todo lo generativo de
imagen es remoto (remote-gen) o del servicio de sprites (sprite-forge).

## sprite-forge — hojas de sprites de personaje (servicio aparte)

Las hojas de personaje ya no se producen aquí: la capacidad vive en **sprite-forge** (repo propio, `github.com/alberto-hortelano/sprite-forge`), con UNA puerta HTTP en **:8770** y cuatro rutas — `GET /catalog`, `POST /sheets` (hojas base: gratis, deterministas, cacheadas), `POST /identity` (hero-shot de identidad, una llamada de pago) y `POST /skins` (una anim vestida por petición). Son dos lenguajes tras la misma puerta: Node monta la escena three.js en Chrome headless y planifica, un worker Python repinta. Dónde vive lo dice `ai_server.sprite_forge_url` (por defecto `http://127.0.0.1:8770`).

**ne-fan es UN consumidor suyo, no su dueño:**
- `POST /skin_sprite_sheet` (:8768) es el **adaptador**, y el wire no cambia: resuelve la ref de personaje del style pack (`style_id`/`style_role`), llama al servicio, guarda lo que vuelve en `cache/sprite_sheets/{key}` y apunta el gasto — sprite-forge devuelve IMÁGENES y no guarda nada de lo que genera. `angle` es **obligatorio**: su viejo defecto (`isometric_30`) era una vista retirada en agosto, así que una petición sin ángulo acababa en 404.
- `GET /sprite_catalog` (:8768) proxya el `/catalog`: qué modelos, animaciones y ángulos ofrece el despliegue y **cuántas llamadas de imagen cuesta vestir cada anim** (`calls_per_anim`). Existe para que el cliente pregunte el coste antes de gastar en vez de espejar el número a mano.
- **La credencial de imagen viaja traducida.** ne-fan la tiene en `.env` como `MESHY_API_KEY`; sprite-forge la espera como `SPRITE_FORGE_IMAGE_KEY`, porque es agnóstico al proveedor y no puede llamarla por el nombre de uno. La traducción vive en `start.sh` (`start_sprite_forge`), que además le activa el `.venv` como a los otros tres servicios Python. Sin clave el servicio **no se muere**: sirve hojas base y anuncia `skin.enabled: false`, y quien pida repintado recibe un motivo en vez de un maniquí mudo.
- Las hojas BASE se siguen sirviendo estáticas desde `nefan-html/public/sprites` (las sirve Vite); lo que cambia es quién las produce: el CLI del servicio (`sprite-forge render --assets … --out nefan-html/public/sprites`).
- Los FBX de Mixamo siguen en `assets/characters/` (gitignorados). sprite-forge no distribuye assets — los pone quien despliega, y eso es la licencia, no higiene.

Las lecciones del pipeline (atlas de pocas celdas, direcciones empaquetadas por lote, pose-lock del hero, rechazo fail-loud del output que no repinta el clay, lock de Hips en XZ en los clips de locomoción) están **hormigonadas allí**, con sus tests y su bench de paridad de píxel. Aquí ya no queda copia que se desincronice: ver su README.

## Pre-generación: mundo por juego y estilo por (juego, estilo)

El contenido de la génesis es independiente del estilo y se pre-genera en dos capas (regenerables desde el título):

- **Snapshot de mundo** — `data/games/{id}/world/tile.json` (gitignored; ruta única desde que murió el eje de vistas — el snapshot ya no declara rama; schema en `src/games/world-snapshot.ts`, invalidado por `world_doc_hash`). Lo escribe pasivamente cualquier bootstrap vivo, y el job **`generate_game`** (WS desde el título, `bridge/handlers/game-gen.ts`) lo genera completo: bootstrap + anillo 3×3 + hasta 8 places clave en una sesión efímera (borrada al terminar; progreso por `narrative_status kind "game_gen"`). `start_session` lo replayea por la ruta normal (~50 ms, cero llamadas al motor); stale (world.md editado) degrada al bootstrap vivo con warning, nunca en silencio. En la génesis el motor puede declarar el **vocabulario canónico** del mundo (tool `vocabulary_set` → `world/vocabulary.json`: descs de superficies/arquetipos); los turnos de tile lo reciben como `world_vocabulary` — reusar una desc verbatim es cache-hit del asset estilizado (opcional, como `available_assets`).
- **Aplicación de estilo** — batch del título (`nefan-html/src/ui/style-apply.ts`) sobre el snapshot: pack del estilo si incompleto, librería de superficies fps (celdas computadas con las MISMAS funciones puras que la vista — reuso exacto por hash) y skins del roster (prompts/refs con las mismas reglas que main.ts; `npcSkinStyleRef` es la fuente única). Coste estimado ANTES de gastar (dry-run `GET /styles/{id}/missing` + `resolve_only` del atlas) y confirmación con checkboxes por bloque. Registro en `world/styles/{style_id}.json` + hashes pineados en el asset-store (`POST /assets/pin`, el prune protege keep-list ∪ pins). Regenerar mundo invalida los registros y despina.
- **UI**: tarjeta de mundo con su estado y los estilos aplicados (✓/⟳/—); botones Generar/Regenerar mundo (regenerar = 2 clicks) y Aplicar estilo (exige el mundo ya generado); crear mundo encadena `generate_game` (checkbox, default ON). E2E sin créditos: fake-ai-server sirve `/styles/*` y el atlas con `resolve_only`; el bridge acepta `NEFAN_GAMES_DIR` para no contaminar los juegos reales con génesis de bench.
