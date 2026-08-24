# Mapa del repositorio

Qué vive en cada carpeta y qué proceso la usa. Consúltalo cuando no sepas dónde encaja un cambio.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Arquitectura

Plan de división en microservicios: `docs/microservices/README.md` (servicios, fronteras, fases F0–F6). Los contratos tipados de TODOS los servicios (endpoints WS/HTTP, incluidos los del ai_server Python) viven en `nefan-core/src/contracts/` — fuente de verdad del wire entre procesos.

```
nefan-core/               TypeScript — logica de juego (bridge + cliente web)
  src/
    combat/                Resolver, state machines, manager, enemy AI
    store/                 GameStore (dispatch/subscribe/snapshot)
    animation/             AnimationController, transitions, state config
    simulation/            GameSimulation tick loop
    protocol/              Mensajes frontend ↔ logica
    plugins/               Plugins declarativos: tipos zod, hash, DSL, loader, dispatcher
    dev/                   Initial scene cache (bootstrap replay)
  bridge/
    ws-server.ts           WebSocket bridge para el cliente web (:9877)
  services/
    asset-store/           Microservicio S6 (:8767): blobs content-addressed +
                           manifest SQLite (F2) + styles binarios; ai_server
                           proxya /cache|/assets para clientes no migrados
  data/
    combat_config.json     Tipos ataque, armas, animaciones, velocidades
    scenes/                Escenas Format D de ejemplo/fixture (robledo_tile, zorder_test) — tiles del selector del cliente
    games/{id}/            Juego = mundo: game.json + world.md + plugins/ (user_* = subidos)
    plugins/               Plugins shipped comunes a TODOS los juegos (economy); un plugins/ local con mismo name lo pisa
    styles/{id}/           Estilo: style.json + imágenes de referencia por categoría
  test/                    85 ficheros de test (combat, simulation, escena, narrativa,
                           plugins, contrato del modelo, fronteras arquitectónicas)

nefan-html/               Cliente web en PRIMERA PERSONA (three.js/WebGL)
  src/
    main.ts                Game loop, importa nefan-core directamente
    renderer/              fps-gl (three: el único contexto WebGL de la pestaña),
                           fps-renderer (fachada + import dinámico), sprite-renderer,
                           character-sprites, types
    scene/                 fps-atlas: pipeline de imagen del atlas de superficies
    world/                 Modelo de mundo del cliente: tile-store, frontier
    ui/                    Capa DOM in-game + pantalla de título (ver ui.md)
    net/                   bridge-client / narrative-client (WS al bridge)
    input/                 Providers: keyboard (default) y scripted (bench)

ai_server/                Python FastAPI — 3 procesos: main.py (narrativa :8765),
                          gpu_worker_main.py (:8766), remote_gen_main.py (:8768)
narrative-mcp/            Node.js MCP bridge

labs/                     Benches de experimentación (ver labs/README.md)
  common/                  Helpers compartidos: env (claves), fal (fal_call con
                           caché+gasto), images (data URIs, raster), sam (SAM2
                           cacheado), fidelity_score, report, capture.sh
  serve.sh                 Servidor estático de labs/ entero en :8912 (sin caché)
  style/                   Referencias de estilo y fidelidad de layout (gen.py,
                           fidelity.py)
  fps/                     Bench de la vista de juego: dump_spec, escenas, capturas
  authoring/               Generadores declarativos de scatter (run 003 → scatter.ts)
  narrative/               Motor narrativo sin gráficos: game-emulator, fake-ai-server,
                           replay-server, check-scene.ts (tooling de E2E)
```
