# Decisiones — división en microservicios

## Tomadas (cambiables con argumento, pero son el default del plan)

1. **Contratos en `nefan-core/src/contracts/`, no en `packages/contracts/`.**
   Compila con el tsconfig existente sin tocar nada, nefan-html ya lo importa
   vía alias Vite, narrative-mcp importa `@nefan/core/contracts/*`
   (dependencia `file:` + exports map sobre `dist/src/contracts/`).
   Migrar a paquete propio es un `git mv` futuro si hiciera falta publicarlo.
2. **Contratos types-only** (sin zod nuevo). Donde ya hay zod (plugins) se
   reexporta el schema junto al tipo. La validación cruzada con Python se
   apoya en los modelos Pydantic + `fake-ai-server.mjs` como spec ejecutable.
3. **El contrato documenta el cable real**: snake_case en los endpoints
   Python, camelCase en el WS del gateway. No se "arregla" el naming en el
   contrato — eso sería un cambio breaking disfrazado.
4. **SQLite para el manifest** (F2). Transaccional, un fichero, cero ops.
   Alternativa descartada: NDJSON append + compactación (menos garantías con
   escritores múltiples).
5. **asset-store en Node.** Es I/O puro y comparte los tipos TS nativamente.
   El código Python actual (`asset_cache.py`) sirve de referencia, no se
   porta línea a línea.
6. **`/generate_scene_image` sigue síncrono** (30–300 s). El modelo de jobs
   (`POST /jobs` + polling/webhook) es más robusto pero toca SceneGenQueue y
   clientes; se reevalúa si aparecen timeouts reales.
7. **Simulación y SceneGenQueue NO son servicios** (in-process en el
   gateway). Hot loop y prioridades dependientes de la posición del jugador.
8. **Puertos objetivo**: 8766 gpu-worker, 8767 asset-store, 8768 remote-gen
   (bloque contiguo al 8765). Registrados en `contracts/common.ts` (SERVICES)
   y, cuando se extraigan, en `config.ts`/`runtime_config.json`.
9. **Orden de extracción: S6 → S4 → S5 → (F5) → S2 opcional.** El asset-store
   primero porque el manifest compartido bloquea el resto.
10. **node:sqlite (`DatabaseSync`) para el índice del asset-store** (F2):
    built-in de Node ≥ 24, cero dependencias nativas. El proceso del store es
    el ÚNICO que abre el .sqlite3 (la cola HTTP es la serialización); plan B
    documentado: better-sqlite3 si la API experimental rompiera.
11. **Prune con keep-list por pull S6→S2 best-effort** (resuelve la abierta
    2): el store consulta `GET /sessions/asset_refs` de world-state con
    timeout 3 s; si no responde, poda SIN keep-list (= status quo pre-F2) con
    warning. No se añade body `{keep}` a `POST /cache/prune` (superficie
    mínima; el contrato lo admitiría si hiciera falta).
12. **El hashing content-addressed se queda en Python** (F2): `hash_key()`
    depende del `str()` de Python sobre el context (bools, listas) y portarlo
    bifurcaría la caché entera (16.907 entradas). El store recibe el hash
    hecho vía `POST /assets`; hash de oro fijado en
    `ai_server/tests/test_asset_cache.py`.

## Abiertas (decidir cuando toque la fase)

1. **F6 sí o no** — separar world-state por red puede no aportar nada en un
   despliegue de una máquina. Decidir tras F5 con latencias medidas.
2. ~~Prune y referencias vivas~~ — RESUELTA en F2 (decisión tomada 11).
3. **Godot y los contratos** — no consume TS. ¿Generar JSON Schema desde los
   .d.ts para validar en GDScript, o dejarlo como cliente best-effort?
   (Deriva actual conocida: 8/19 mensajes, espejo GD en schema v3 vs v4.)
4. **Autenticación entre servicios** — hoy todo es loopback sin auth. Al
   abrir puertos nuevos: ¿token compartido (header) o red de confianza?
   Mientras todo escuche en 127.0.0.1, red de confianza.
5. **Evolución del modelo de jobs** para latencias >300 s (ver decisión 6).
6. **Cómo romper el ciclo narrative↔world-map** (prerequisito de F6):
   ¿interfaz inyectada o bus de eventos interno? Refactor no trivial.
