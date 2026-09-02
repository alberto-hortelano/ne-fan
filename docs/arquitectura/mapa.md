# Mapa del repositorio

Qué vive en cada carpeta y qué proceso la usa. Consúltalo cuando no sepas dónde encaja un cambio.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Arquitectura

Plan de división en microservicios: `docs/microservices/README.md` (servicios, fronteras, fases F0–F6). Hay DOS árboles de contrato con nombre parecido y rol distinto: `nefan-core/src/contracts/` — fuente de verdad del wire entre procesos (endpoints WS/HTTP, incluidos los del ai_server Python) — y `nefan-core/src/contract/` — el I/O del modelo (zod de `model-io/`) y el checker de fronteras (`arch/check.ts`).

```
nefan-core/               TypeScript — logica de juego (bridge + cliente web)
  src/
    combat/                Resolver, state machines, manager, enemy AI
    store/                 GameStore (dispatch/subscribe/snapshot)
    simulation/            GameSimulation tick loop + NpcBehaviorSystem
    protocol/              Mensajes frontend ↔ logica
    plugins/               Plugins declarativos: tipos zod, hash, DSL, loader, dispatcher
    contract/              model-io/ (zod del I/O del modelo) + arch/ (checker de fronteras)
    contracts/             Wire tipado entre procesos (asset-store, remote-gen, State API…)
    games/                 Loaders de juegos y estilos (game.json, style.json, snapshots)
    narrative/             NarrativeState (save canónico), serialización para el LLM
    scene/                 Format D → world scene, builders greybox, validador
    session/               Facetas de sesión que consume el cliente
    systems/               Registry genérico de implementaciones de hot loop
    world-map/             Mapa multinivel, lugares, triggers
  bridge/
    ws-server.ts           WebSocket bridge para el cliente web (:9877)
    router.ts + handlers/  Un handler por dominio (session, dialogue, tile, scene…)
    state-http/            State API (:9878): rutas REST del motor narrativo
    context.ts             Estado del proceso bridge (sim, plugins activos, colas)
    wire-scene.ts          ÚNICA salida de escena normalizada del bridge
    world-claim.ts         Único dueño de la atadura sim ↔ NarrativeState
  services/
    asset-store/           Microservicio S6 (:8767): blobs de `surface` (el
                           único kind, #257) + manifest SQLite + styles
                           binarios; ai_server proxya /cache|/assets
  data/
    combat_config.json     Tipos ataque, armas, animaciones, velocidades
    scenes/                Escenas Format D de ejemplo/fixture (robledo_tile, zorder_test) — tiles del selector del cliente
    games/{id}/            Juego = mundo: game.json + world.md + plugins/ (user_* = subidos)
    plugins/               Plugins shipped comunes a TODOS los juegos (economy); un plugins/ local con mismo name lo pisa
    styles/{id}/           Estilo: style.json + refs libres en tres carpetas de rol
                           (surfaces/ faces/ characters/; ver data/styles/README.md)
  test/                    Tests de combat, simulation, escena, narrativa, plugins,
                           contrato del modelo y fronteras arquitectónicas

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

ai_server/                Python FastAPI — 2 procesos: main.py (narrativa :8765),
                          remote_gen_main.py (:8768)
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
