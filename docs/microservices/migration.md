# Fases de migración a microservicios

Orden pensado para que cada fase deje el juego funcionando y verificable con
lo que ya existe (~245 tests de nefan-core incl. `bridge-*.test.ts` con
sockets fake, `narrative_lab/fake-ai-server.mjs`, benches). Cada fase es
independiente: se puede parar después de cualquiera con un sistema mejor que
el anterior.

## F0 — Contratos sin cambio de comportamiento

- ~~Crear `nefan-core/src/contracts/` completo~~ **(hecho, 2026-08-04)**.
- Tipar `bridge/state-http-server.ts` y los handlers del bridge con los
  contratos (cambio solo de tipos: las respuestas pasan a estar anotadas con
  `WorldStateApi`/`ResponseOf`).
- Mover la fuente de `narrative-mcp/protocol.ts` a
  `contracts/narrative-mcp-ws.ts`: narrative-mcp importa
  `@nefan/core/contracts/*` (dependencia `file:` + exports map; físicamente
  `dist/src/contracts/`) y su `protocol.ts` queda como reexport de
  compatibilidad. (Hasta entonces son espejo: cambiar los dos a la vez.)
- Test de contrato: un test que importe ambos módulos y compruebe que los
  unions coinciden (compile-time con `satisfies`).

**Hecho cuando**: `npx tsc --noEmit` + `npm test` en verde en nefan-core;
nefan-html compila; narrative-mcp compila.

## F1 — Configuración de servicios (matar URLs hardcodeadas)

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

## F2 — Extraer asset-store (:8767) — LA PRIMERA

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

## F3 — Extraer gpu-worker (:8766)

- Mover los pipelines locales (texture/skin/sprite/model/plate + camino LaMa
  de peel) a un proceso propio con `GpuWorkerApi`.
- `deps.gpu_lock` desaparece: la serialización es la cola del proceso
  mono-GPU. Escalar = un proceso por GPU.
- ai_server proxya durante la transición; después, AiClient y clientes van
  directo (overrides de F1).

**Hecho cuando**: narrative_lab E2E con fake-ai-server en verde; Godot sigue
obteniendo texturas/modelos; dos gpu-workers con mocks reparten trabajo (el
mecanismo queda probado aunque haya 1 GPU).

## F4 — Extraer remote-gen (:8768) + `/segment`

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
