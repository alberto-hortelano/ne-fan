# Fases de migración a microservicios

Orden pensado para que cada fase deje el juego funcionando y verificable con
lo que ya existe (~245 tests de nefan-core incl. `bridge-*.test.ts` con
sockets fake, `narrative_lab/fake-ai-server.mjs`, benches). Cada fase es
independiente: se puede parar después de cualquiera con un sistema mejor que
el anterior.

## F0 — Contratos sin cambio de comportamiento ✅ (2026-08-05)

- ~~Crear `nefan-core/src/contracts/` completo~~ **(hecho, 2026-08-04)**.
- ~~Tipar `bridge/state-http-server.ts` con los contratos~~ — cada respuesta
  anotada con `satisfies ResponseOf<...>`; `plugins.inspect` estrechado a
  `PluginInspectResult`. Compiló a la primera (el contrato documentaba el
  cable real).
- ~~Mover la fuente de `narrative-mcp/protocol.ts` a
  `contracts/narrative-mcp-ws.ts`~~ — narrative-mcp importa
  `@nefan/core/contracts/*` (dependencia `file:` + exports map; físicamente
  `dist/src/contracts/`; build `tsc -b` con project references, incremental)
  y su `protocol.ts` es un reexport de compatibilidad.
- ~~Tests de contrato~~ — `narrative-mcp/contract-check.ts` (compile-time,
  unions idénticos) y `nefan-core/test/state-http-contract.test.ts` (toda
  ruta de la tabla tiene rama real en el router).

## F1 — Configuración de servicios (matar URLs hardcodeadas) ✅ (2026-08-05)

Ejecutada: `serviceUrl()` en el cliente (`nefan-html/src/net/service-urls.ts`,
env sintético desde `?ai=`/`?bridge=`), `resolveServiceUrl` en ws-server y
AiClient (alias `NEFAN_AI_SERVER` @deprecated con prioridad hasta F5),
`NEFAN_URL_WORLD_STATE` en narrative-mcp. El registro vive en
`contracts/service-registry.ts` (módulo hoja sin dependencias — common.ts
arrastra módulos node-only y rompía el typecheck del navegador). Criterio del
grep verificado. Detalle histórico del plan original:

- Sustituir las URLs fijas por `resolveServiceUrl` de `contracts/common.ts`:
  - nefan-html: `main.ts` (base ai_server + override `?ai=`),
    `ui/title-screen.ts` (AI_SERVER_HTTP fijo + covers :9878),
    `scene/scene-image.ts`, `scene/stage-image.ts`, `renderer/asset-cache.ts`,
    `renderer/sprite-renderer.ts`, `scene/auto-pipeline.ts`, `net/bridge-client.ts`.
  - nefan-core: `src/narrative/ai-client.ts` (base del AiClient).
  - narrative-mcp: `bridge-http-client.ts` (State API) y `ws-bridge.ts`.
- Los overrides por env (`NEFAN_URL_*`) permiten apuntar a servicios ya
  extraídos sin tocar código en F2–F4.

**Hecho cuando**: `grep -rn "9877\|9878\|:8765" nefan-html/src nefan-core/src nefan-core/bridge narrative-mcp/*.ts`
solo aparece en `contracts/common.ts` y en config; humo manual con `start.sh`
(preset 2 ó 4).

## F2 — Extraer asset-store (:8767) — LA PRIMERA ✅ (2026-08-05)

Ejecutada: servicio Node en `nefan-core/services/asset-store/` (node:sqlite,
`cache/manifest.sqlite3`; migración one-shot idempotente — 16.907 entradas en
202 ms, collapse idéntico al Python; `manifest.json` congelado como
rollback). ai_server usa `AssetStoreClient` (register fail-loud,
count/bytes/prune best-effort) y proxya `/cache|/assets` para Godot.
`/styles/{id}/{file}` movido desde el State API; keep-list
`GET /sessions/asset_refs` en world-state consumida por el prune. Bench: 100
registros en 3 ms (antes: rewrite de 5,8 MB por registro bajo lock, sin
seguridad inter-proceso). Test de escrituras concurrentes en
`test/asset-store.test.ts`. Detalle histórico del plan original:

- Nuevo servicio (Node, ver decisions.md) con `AssetStoreApi`.
- **Migrar `cache/manifest.json` (~17k entradas) a SQLite** con script
  one-shot idempotente; `AssetManifest` de ai_server pasa a cliente HTTP.
- `POST /assets` para el registro remoto (gpu-worker/remote-gen dejan de
  compartir el manifest en memoria).
- ai_server monta un **proxy transparente** de `/cache/*` y `/assets*` hacia
  :8767 durante la transición (los clientes no se tocan hasta F1+overrides).
- Mover `GET /styles/{style_id}/{file}` desde :9878 (world-state deja de
  servir binarios; el título sin ai_server necesita el asset-store arriba —
  actualizar preset 4 del launcher).
- Prune: consume la keep-list `GET /sessions/asset_refs` de world-state
  (endpoint nuevo) para no podar assets referenciados por saves vivos.

**Hecho cuando**: test de escrituras concurrentes (N registros paralelos sin
corrupción — imposible hoy); clientes funcionando vía proxy; bench del coste
de registro vs el rewrite de 5,8 MB actual; `start.sh` con el servicio nuevo.

## F3 — Extraer gpu-worker (:8766) ✅ (2026-08-05)

Ejecutada: proceso propio `ai_server/gpu_worker_main.py` (mismo paquete
Python, entrypoint nuevo; los 6 endpoints viven en
`routers/gpu_generation.py`). Matiz sobre el plan original: **`gpu_lock` NO
desaparece dentro del worker** — además de CUDA protege la coherencia del
pipe SD compartido (Skin/Sprite/ModelGenerator lo mutan y restauran, y
FastAPI async intercala); lo que muere es compartirlo con los endpoints
narrativos. Escalar sigue siendo un proceso por GPU
(`NEFAN_URL_GPU_WORKER`; probado con dos workers mock en
`tests/test_two_gpu_workers.py`). narrative-llm proxya los endpoints en
:8765 para Godot (`routers/gpu_proxy.py`, indefinido) y agrega el
`model_backend` del `/health` del worker en `/backend_status` (best-effort,
shape intacto). El peel "flux" llama a fal DIRECTO desde el worker
(decisión 13); `DevApiCache.enabled` se relee por (mtime, inode) para que el
toggle sea visible entre procesos. Cliente HTML directo vía
`serviceUrl("gpu-worker")`. Detalle histórico del plan original:

- Mover los pipelines locales (texture/skin/sprite/model/plate + camino LaMa
  de peel) a un proceso propio con `GpuWorkerApi`.
- ai_server proxya durante la transición; después, AiClient y clientes van
  directo (overrides de F1).

**Hecho cuando**: narrative_lab E2E con fake-ai-server en verde; Godot sigue
obteniendo texturas/modelos; dos gpu-workers con mocks reparten trabajo (el
mecanismo queda probado aunque haya 1 GPU).

## F4 — Extraer remote-gen (:8768) + `/segment` ✅ (2026-08-05)

Ejecutada: proceso propio `ai_server/remote_gen_main.py` (endpoints en
`routers/remote_generation.py` + `routers/styles.py` + `routers/segment.py`
+ el toggle `/dev/api_cache`). `POST /segment` es la ÚNICA llamada fal SAM2
del stack (mode auto/boxes, PNG crudos de fal — la conversión a bool queda en
el consumidor y los blobs de los canales dev siguen valiendo byte a byte);
narrative-llm lo consume vía `remote_gen_client.py` y **ya no lee FAL_KEY**
(`sam_model` de las claves de caché sale de config — mismo string, cachés
intactas; golden en `tests/test_segment_router.py`). Sin proxy en :8765: los
únicos clientes (HTML) resuelven por `serviceUrl("remote-gen")`.
`/review_scene_image`, `LLMClient.review_scene_image` y `pipe_server.py`
eliminados. `style_packs` queda TAMBIÉN en narrative-llm (/develop_world
lista estilos — lector FS sin claves). Detalle histórico del plan original:

- Mover Meshy/fal (scene image, sprite sheets, style packs) y el
  `DEV_API_CACHE` con `RemoteGenApi`.
- Implementar `POST /segment` (SAM2 auto/boxes) y que
  `/analyze_scene_image` + `/review_stage_image` de narrative-llm lo llamen —
  narrative-llm deja de depender de FAL_KEY.
- **Eliminar `/review_scene_image`** (muerto) y `ai_server/pipe_server.py`.

**Hecho cuando**: escenografia_lab/style_lab/stage_lab funcionan; el toggle
dev de la top bar opera contra el proceso nuevo; pipeline del plató (G) E2E.

## F5 — Consolidar narrative-llm y matar el estado sticky

- `LLMClient.session_info` se sustituye por `GET /session/{id}/llm_context`
  de world-state (endpoint nuevo — world-state ya es dueño del save).
- `_inflight_scenes`/`_late_scenes` quedan como tracking efímero de requests;
  el progreso sigue por `POST /narrative_progress`.
- `/notify_session` pasa a ser opcional (compat) — la sesión se resuelve por
  el contexto de cada petición.

**Hecho cuando**: matar y reiniciar ai_server a MITAD de sesión y que
`resume_session` + el siguiente `generate_scene` funcionen sin notify manual;
`bridge-tile`/`bridge-stage` tests en verde.

## F6 — Separar world-state del proceso gateway (OPCIONAL)

- Prerequisito: romper el ciclo `narrative` ↔ `world-map` dentro de
  nefan-core (interfaz o módulo de eventos).
- El gateway pasa de tocar `BridgeContext.narrative/worldMap/npcDirector`
  in-process a un cliente HTTP de `WorldStateApi`.
- Decidir CON MEDIDAS: latencia añadida a `load_room`/`dialogue_choice`/tick
  de plugins. Si no compensa, se quedan co-desplegados para siempre con la
  frontera solo en tipos — resultado igualmente válido.

**Hecho cuando**: `bridge-*.test.ts` pasan con un world-state real en proceso
aparte (añadir arnés HTTP a los sockets fake existentes); latencias medidas y
aceptadas.
