# labs/ — benches de experimentación

Cada lab es un bench self-contained para una pregunta concreta (¿qué API
skinnea mejor?, ¿qué formato de plano repinta con más fidelidad?…). Viven en
el repo porque la tecnología de IA avanza rápido y las pruebas se repiten;
los cerrados conservan sus salidas de referencia y su veredicto en el README
propio.

Los tres labs de las vistas retiradas (`stage/` la segmentación del plató,
`render/` las alternativas de repintado del tile cenital y `escenografia/`
los pares descripción↔plató) se fueron con ellas a `archivo/labs/`, junto a
`plantillas/`: sus 460 MB de runs no estaban en git y ningún `git checkout`
los devolvería, así que se movieron enteros en vez de borrarse.

| Lab | Qué mide | Entry point | Estado |
|-----|----------|-------------|--------|
| `skinning/` | APIs de skinning IA sobre sprites Mixamo (V1–V4; gana V4 atlas ≤10 frames) | `python3 labs/skinning/run.py --preset <name>` · generador interactivo `./labs/skinning/serve.sh` (:8911) | permanente |
| `style/` | Referencias de estilo + fidelidad de layout del repintado de blueprints | `python labs/style/gen.py <run>` · `python labs/style/fidelity.py <subcmd>` | cerrado (hallazgos aplicados) |
| `narrative/` | Motor narrativo sin gráficos: emulador del juego, fake ai_server, replay | `node labs/narrative/{game-emulator,fake-ai-server,replay-server}.mjs` · `check-scene.ts` | activo (tooling de E2E) |
| `fps/` | Modo 3D primera persona estilo Doom: atlas de superficies IA + sprites y_bot 8-dir | `viewer.html` en :8912 · `python3 labs/fps/gen.py <run>` | activo |
| `fps/godot/` | Bench Godot 4.6 vs three.js de la vista fps: paridad medida + modo calidad (SDFGI) | `capture_godot.sh` · `compare.py` · veredicto en `fps/COMPARATIVA_GODOT.md` | activo |
| `authoring/` | Autoría LIBRE del modelo: run 001 three vs Godot (misma descripción, medido); run 002 luz de gameplay + scatter procedural declarativo (zonas+densidad+generador de autor) | `three/capture.sh` · `godot/capture.sh` · veredicto en `authoring/INFORME.md` | activo |

## Convenciones comunes

- **Claves** (`FAL_KEY`, `MESHY_API_KEY`): entorno o `.env` de la raíz del
  repo, SIEMPRE vía `labs.common.env` (`load_key` / `load_env_file`). Ningún
  lab parsea `.env` por su cuenta.
- **`labs/common/`** — helpers compartidos; los scripts lo importan con
  `sys.path.insert(0, str(REPO_ROOT))` + `from labs.common import …`:
  - `env` claves y raíz del repo
  - `fal` `fal_call()` con caché sha256 en disco + contador de gasto
    (`spend.json`); replay gratis con el mismo payload
  - `images` data URIs (`png/jpeg/png_rgba/png_file`) y `raster_svg`
  - `sam` SAM2 auto-segment cacheado por sha de imagen (payload EXACTO de
    `FalSamClient` — cambiarlo invalida cachés)
  - `fidelity_score` métrica pura de fidelidad de layout (port de
    `matchExpected` del cliente; la usan style y render)
  - `report` CSS del index de run + `manifest_upsert` idempotente
  - `capture.sh` captura headless de viewers three.js (servidor efímero +
    Chrome `--virtual-time-budget`)
- **Cachés de llamadas de pago**: cada lab conserva la suya donde siempre
  (`render/runs/_cache`, `style/runs/002_*/masks`, `stage/runs/.sam_cache`).
  NO moverlas ni renombrar su esquema de fichero: se re-pagaría todo.
- **Navegación**: `./labs/serve.sh` sirve `labs/` entero en **:8912** sin
  caché (reports, demos, galerías). Excepción: skinning tiene su FastAPI
  interactivo en **:8911** (`./labs/skinning/serve.sh`) porque genera bajo
  demanda.
- **runs/ gitignored** en todos los labs salvo `escenografia/`, que commitea
  sus salidas deliberadamente (son la referencia visual del veredicto).
- Los `.ts` de los labs (`check-scene.ts`, `dump_stage.ts`,
  `fixtures/dump_*.ts`) se ejecutan con `npx tsx` desde `nefan-core/` y
  quedan fuera de tsc/eslint del CI; el Python pasa por `compileall labs` en
  CI como guard de sintaxis. (Los dumps del compositor SVG — dump_blueprint,
  dump_occluders — murieron con él en agosto de 2026; los artefactos de sus
  runs históricos siguen en disco.)
