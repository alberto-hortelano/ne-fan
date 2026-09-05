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
| `/cache/{type}/{hash}` | :8767 | Servir asset cacheado: solo `surface` (cualquier otro kind es 400 desde #257); `sprite_sheet`/`sprite_hero` van por sus rutas propias; :8765 proxya |

**`NEFAN_MANIFEST_DB` — la palanca de prueba del asset-store** (#391). Qué índice SQLite abre
`services/asset-store/server.ts`: por defecto el del snapshot (`cache/manifest.sqlite3`), y con la
variable el que se le diga (absoluta tal cual, relativa contra la raíz del repo; **puesta pero en
blanco es fail-loud**, no «sin override»). Existe porque el único camino de fallo del arranque
—negarse a servir un índice con kinds SIN productor— no se podía ejercer sin tocar el índice del
checkout: el QA de T4 tuvo que exportar el árbol entero a un temporal para plantar la fila ajena.

```bash
NEFAN_MANIFEST_DB=/tmp/prueba/manifest.sqlite3 npx tsx services/asset-store/server.ts
```

Es **TS-only** y de PRUEBA, como `NEFAN_GAMES_DIR`/`NEFAN_SAVES_DIR` del bridge: no está en
`data/runtime_config.json` (el snapshot es para los servicios que no son TS, y `manifest_db` no lo
lee ninguno) y `start.sh` no la conoce — se exporta en el entorno de quien arranca el servicio.
`scripts/manifest-kinds-con-productor.ts` la hereda (`loadAssetStoreConfig(process.env)`) y su flag `--db`
gana; **`--cache`/`--archivo` NO se mueven con ella**, así que al purgar un índice desplazado hay que
decir las dos mitades o el script mirará el `cache/` del checkout. El veredicto del arranque nombra
las dos: qué índice rechaza y qué almacén archivar.

**`NEFAN_SPEND_DIR` — la misma palanca para el ledger de gasto** (#392). Dónde escribe
`ai_server/spend_tracker.py`: por defecto `cache/spend/` del checkout, y con la variable el
directorio que se le diga (absoluta tal cual, relativa contra la raíz del repo; **puesta pero en
blanco es fail-loud**). Existe porque los tests del adaptador de sprite-forge hacen POST a
`/skin_sprite_sheet` contra un forge de mentira, y ese camino llama a `SPEND.add` con el `cost_usd`
de la fixture: **43 eventos y $10,32 de gasto INVENTADO por corrida**, en el mismo fichero que se
mira para decidir si se sigue gastando.

Cuando se descubrió, el ledger llevaba **desde el 2026-08-24 siendo 95 % ruido**: de sus 1616
eventos y $768,58, **1429 eventos y $731,04 eran de la suite** — 240 ($57,60) de la fixture viva y
1189 ($673,44) de la fixture anterior (commit `a31a6f4`, que pedía `prompt="un herrero"` a
`/skin_sprite_sheet` desde el propio test). El gasto REAL era **$37,54** — con una salvedad que se
escribe aquí para que el número no se congele sin ella: dentro de esos 187 eventos quedan **4 con el
prompt literal `x` ($0,96)** que huelen a sondeo manual y NO se retiraron, porque no estaban
autorizados y porque la herramienta se niega a usar un criterio de menos de 8 caracteres. O sea que
$37,54 es el techo del gasto real, no su valor exacto.

Los dos lotes se retiraron a `archivo/cache/spend/`, cada uno a su fichero, con
`ai_server/tools/archivar_gasto_de_test.py` (dry-run por defecto, nunca borra, se niega a duplicar en
el archivo). **Los dos criterios seleccionan por IGUALDAD** contra las formas que compone
`remote_generation.py` (`hero: <prompt>`, `skin <anim>: <prompt>`), nunca por `contains`: con
`contains` se barría arte real, como `hero: un herrero de pelo cano y delantal de cuero quemado`. Lo
que cambia entre los dos es de dónde sale el prompt — derivado de la fixture viva, o declarado con
procedencia y ventana de fechas comprobada para las retiradas.

```bash
NEFAN_SPEND_DIR=$(mktemp -d) python -m unittest discover -s ai_server/tests
```

Es la línea que corre el CI (`.github/workflows/ci.yml`), y **olvidarla no es verde**: a diferencia
de `NEFAN_MANIFEST_DB`, aquí la variable sola no bastaba —una suite sin ella pasaba en verde
ensuciando el ledger—, así que `SpendTracker.__init__` se **niega** a construirse sobre la ruta real
cuando `unittest` está en `sys.modules`, y dice el remedio. Olfateo medido: con el stack de
producción (fastapi + starlette + httpx + pydantic + numpy + PIL, y `routers.remote_generation`
importado) `unittest` **no** está cargado, y pytest no está instalado.

## Modelos de IA y que hacen

| Modelo | Uso | Donde |
|--------|-----|-------|
| **Claude Sonnet 4.5** | Genera escenas open-world, reacciona a las elecciones del jugador esculpiendo el mundo (spawn dinámico de edificios/NPCs/objetos), orienta armas vía visión | llm_client.py via MCP bridge o API — lo elige `NEFAN_LLM_MCP_URL` (`off` = solo API; el banco pone además `ANTHROPIC_BASE_URL` al stub `labs/narrative/fake-anthropic.ts`, #235) |

Ya no queda generación local con GPU: se fue entera con el gpu-worker (#199),
y con ella torch/diffusers y sus ~5 GB de `.venv`. Todo lo generativo de
imagen es remoto (remote-gen) o del servicio de sprites (sprite-forge).

## sprite-forge — hojas de sprites de personaje (servicio aparte)

Las hojas de personaje ya no se producen aquí: la capacidad vive en **sprite-forge** (repo propio, `github.com/alberto-hortelano/sprite-forge`), con UNA puerta HTTP en **:8770** y cuatro rutas — `GET /catalog`, `POST /sheets` (hojas base: gratis, deterministas, cacheadas), `POST /identity` (hero-shot de identidad, una llamada de pago) y `POST /skins` (una anim vestida por petición). Son dos lenguajes tras la misma puerta: Node monta la escena three.js en Chrome headless y planifica, un worker Python repinta. Dónde vive lo dice `ai_server.sprite_forge_url` (por defecto `http://127.0.0.1:8770`).

**ne-fan es UN consumidor suyo, no su dueño:**
- `POST /skin_sprite_sheet` (:8768) es el **adaptador**, y el wire no cambia: resuelve la ref de personaje del style pack (`style_id`/`style_role`), llama al servicio, guarda lo que vuelve en `cache/sprite_sheets/{key}` y apunta el gasto — sprite-forge devuelve IMÁGENES y no guarda nada de lo que genera. `angle` es **obligatorio**: su viejo defecto (`isometric_30`) era una vista retirada en agosto, así que una petición sin ángulo acababa en 404.
- `GET /sprite_catalog` (:8768) proxya el `/catalog`: qué modelos, animaciones y ángulos ofrece el despliegue y **cuántas llamadas de imagen cuesta vestir cada anim** (`calls_per_anim`). Existe para que el cliente pregunte el coste antes de gastar en vez de espejar el número a mano.
- **Qué entra en la clave del sheet vestido** (`_skin_sheet_key`): la `base_key` que da `/sheets` (identidad de la hoja base, con la versión del servicio dentro), el triple `{model}/{anim}/{angle}`, el prompt, el modelo de imagen, el estilo y —desde #375— el **perfil de repintado** (`keyframes`, `play_fps`) que publica `/catalog`. El perfil decide qué fotogramas se pintan: sin él, cambiarlo en `nefan-core/data/sprite-set.json` daba otro arte con la MISMA clave y se servía el viejo en silencio. Va aquí y no en `base_key`, que es de la hoja base y no depende del perfil. Se pregunta al catálogo (gratis) en vez de leer el JSON del set porque el catálogo publica el perfil ya mergeado con el defecto del servicio y relee el set en cada petición: es lo único que dice lo que `/skins` aplicará. Con el servicio caído, lo último conocido de cada triple —base y perfil— vive en `cache/sprite_sheets/_base_keys.json` y es lo que permite seguir sirviendo arte pagado.
- **La credencial de imagen viaja traducida.** ne-fan la tiene en `.env` como `MESHY_API_KEY`; sprite-forge la espera como `SPRITE_FORGE_IMAGE_KEY`, porque es agnóstico al proveedor y no puede llamarla por el nombre de uno. La traducción vive en `start.sh` (`start_sprite_forge`), que además le activa el `.venv` como a los otros tres servicios Python. Sin clave el servicio **no se muere**: sirve hojas base y anuncia `skin.enabled: false`, y quien pida repintado recibe un motivo en vez de un maniquí mudo.
- Las hojas BASE se siguen sirviendo estáticas desde `nefan-html/public/sprites` (las sirve Vite); lo que cambia es quién las produce: el CLI del servicio (`sprite-forge render --assets … --out nefan-html/public/sprites`).
- Los FBX de Mixamo siguen en `assets/characters/` (gitignorados). sprite-forge no distribuye assets — los pone quien despliega, y eso es la licencia, no higiene.

Las lecciones del pipeline (atlas de pocas celdas, direcciones empaquetadas por lote, pose-lock del hero, rechazo fail-loud del output que no repinta el clay, lock de Hips en XZ en los clips de locomoción) están **hormigonadas allí**, con sus tests y su bench de paridad de píxel. Aquí ya no queda copia que se desincronice: ver su README.

## Pre-generación: mundo por juego y estilo por (juego, estilo)

El contenido de la génesis es independiente del estilo y se pre-genera en dos capas (regenerables desde el título):

- **Snapshot de mundo** — `data/games/{id}/world/tile.json` (gitignored; ruta única desde que murió el eje de vistas — el snapshot ya no declara rama; schema en `src/games/world-snapshot.ts`, invalidado por `world_doc_hash`). Lo escribe pasivamente cualquier bootstrap vivo, y el job **`generate_game`** (WS desde el título, `bridge/handlers/game-gen.ts`) lo genera completo: bootstrap + anillo 3×3 + hasta 8 places clave en una sesión efímera (borrada al terminar; progreso por `narrative_status kind "game_gen"`). `start_session` lo replayea por la ruta normal (~50 ms, cero llamadas al motor); stale (world.md editado) degrada al bootstrap vivo con warning, nunca en silencio. En la génesis el motor puede declarar el **vocabulario canónico** del mundo (tool `vocabulary_set` → `world/vocabulary.json`: descs de superficies/arquetipos); los turnos de tile lo reciben como `world_vocabulary` — reusar una desc verbatim es cache-hit del asset estilizado (opcional, como `available_assets`).
- **Aplicación de estilo** — batch del título (`nefan-html/src/ui/style-apply.ts`) sobre el snapshot: pack del estilo si incompleto, librería de superficies fps (celdas computadas con las MISMAS funciones puras que la vista — reuso exacto por hash) y skins del roster (prompts/refs con las mismas reglas que main.ts; `npcSkinStyleRef` es la fuente única). Coste estimado ANTES de gastar (dry-run `GET /styles/{id}/missing` + `resolve_only` del atlas) y confirmación con checkboxes por bloque. Registro en `world/styles/{style_id}.json` + hashes pineados en el asset-store (`POST /assets/pin`, el prune protege keep-list ∪ pins). Regenerar mundo invalida los registros y despina.
- **UI**: tarjeta de mundo con su estado y los estilos aplicados (✓/⟳/—); botones Generar/Regenerar mundo (regenerar = 2 clicks) y Aplicar estilo (exige el mundo ya generado); crear mundo encadena `generate_game` (checkbox, default ON). E2E sin créditos: fake-ai-server sirve `/styles/*` y el atlas con `resolve_only`; el bridge acepta `NEFAN_GAMES_DIR` para no contaminar los juegos reales con génesis de bench.
