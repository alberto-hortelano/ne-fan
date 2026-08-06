# labs/ — benches de experimentación

Cada lab es un bench self-contained para una pregunta concreta (¿qué API
skinnea mejor?, ¿qué formato de plano repinta con más fidelidad?…). Viven en
el repo porque la tecnología de IA avanza rápido y las pruebas se repiten;
los cerrados conservan sus salidas de referencia y su veredicto en el README
propio.

| Lab | Qué mide | Entry point | Estado |
|-----|----------|-------------|--------|
| `skinning/` | APIs de skinning IA sobre sprites Mixamo (V1–V4; gana V4 atlas ≤10 frames) | `python3 labs/skinning/run.py --preset <name>` · generador interactivo `./labs/skinning/serve.sh` (:8911) | permanente |
| `style/` | Referencias de estilo + fidelidad de layout del repintado de blueprints | `python labs/style/gen.py <run>` · `python labs/style/fidelity.py <subcmd>` | cerrado (hallazgos aplicados) |
| `stage/` | Segmentación del plató pintado (proscenio): SAM2 por cajas, contactos, pelado | `python labs/stage/run.py --image … --stage … --boxes … --name …` | activo |
| `render/` | Alternativas de generación del tile 2D (repaint, three.js, sprites, vector, híbrido) | CLIs por experimento (`exp1_repaint/repaint.py`…) + `score_all.py` | cerrado (run 001) |
| `escenografia/` | Pares descripción↔plató de cine + bench greybox (clay 3D → imagen gana al SVG) | `python labs/escenografia/gen_estilos.py` · `greybox/gen.py` | cerrado (base del compositor de proscenio) |
| `narrative/` | Motor narrativo sin gráficos: emulador del juego, fake ai_server, replay | `node labs/narrative/{game-emulator,fake-ai-server,replay-server}.mjs` · `check-scene.ts` | activo (tooling de E2E) |

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
