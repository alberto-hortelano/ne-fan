# skinning_lab

Banco de pruebas reutilizable para evaluar APIs y técnicas de **skinning de
sprites 2D** sobre las animaciones Mixamo del proyecto. La tecnología de IA
visual cambia rápido; este lab vive en el repo para no tener que reinventar el
flujo cada vez que aparece un proveedor o estrategia nueva.

Tres herramientas:
- **`build_base_browser.py`** — genera un visor de las animaciones base de un
  personaje (sin IA), con dropdowns para anim × dirección. **Reduce los frames
  Mixamo a densidad de sprite-sheet 2D** (Disney 4-pose para walk, etc.) según
  perfiles tuneados manualmente para que el loop se sienta natural. El viewer
  generado **incluye un panel de generador de personajes** (enfoque hero-shot
  anchor) que llama al `lab_server`.
- **`lab_server.py`** — FastAPI local. Sirve los archivos del lab en `:8911`
  y expone `/api/characters/{name}/hero_shot` y `/api/characters/{name}/skin`
  contra el cliente Meshy. Es lo que arranca `serve.sh`.
- **`run.py`** — corre tests A/B de skinning AI con los presets en `presets/`
  (V1 single, V2 anchor, V3 rolling, V4 atlas) sin pasar por el server.

### Perfiles de keyframes (sprite-sheet density)

`build_base_browser.py:ANIM_PROFILES` mapea cada anim a `(n_keyframes, fps_loop)`.
Default tuneado para Y Bot:

| anim | keyframes | fps loop | duración loop | original Mixamo |
|---|---|---|---|---|
| idle | 8 | 2.2 | 3.64s | 44f/3.67s |
| walk | 4 | 3.6 | 1.11s | 13f/1.10s (Disney 4-pose) |
| run | 4 | 6.0 | 0.67s | 8f/0.70s |
| quick | 3 | 4.0 | 0.75s | 12f/1.00s (acelerado) |
| heavy | 8 | 6.0 | 1.33s | 18f/1.50s |
| medium | 4 | 3.5 | 1.14s | 16f/1.37s |
| defensive | 2 | 3.5 | 0.57s | 7f/0.57s (raise + hold) |
| precise | 6 | 4.5 | 1.33s | 20f/1.67s |
| hit_react | 3 | 4.0 | 0.75s | 9f/0.77s |
| death | 8 | 4.0 | 2.00s | 28f/2.30s |

Para ver la animación Mixamo completa: `--full`. Para overrides uniformes:
`--keyframes N --target-fps F`.

## Qué hace

Dado un sprite sheet ya rendereado en `nefan-html/public/sprites/{model}/{anim}/{angle}/`:

1. Sample frames (por keyframes uniformes, por stride fps, o explícitos).
2. Manda esos frames a uno o varios proveedores de IA con varias estrategias de
   referencia (single, anchor, rolling, atlas).
3. Descarga los resultados, monta GIFs animados.
4. Genera un `index.html` por run con grid comparativo + costs.

Hoy el único provider implementado es **Meshy image-to-image** (`nano-banana`,
`nano-banana-2`, `nano-banana-pro`). Para añadir otro (fal.ai, Replicate, video
models, etc.), implementa una clase con `submit/wait/download` siguiendo el
patrón de `ai_server/meshy_client.py:MeshyImageToImage` y enchúfala en `run.py`.

## Estrategias de referencia

| ID | Cómo manda los frames | Cuándo es buena |
|---|---|---|
| **V1** Single | 1 ref por frame, prompt textual | Baseline. Cada frame independiente — máxima deriva. |
| **V2** Anchor | frame_N + 2 hero-shots estáticos | Cuando los hero-shots inyectan identidad estable. |
| **V3** Rolling (secuencial) | frame_N + frame_{N-1} skinneado + frame_0 skinneado | Propaga identidad entre frames. Caro, lento. |
| **V4** Atlas | TODOS los frames en un grid, **una sola llamada** | El modelo ve la secuencia. Sólo funciona con grids ≤ 3-6×2-3 cells (ver lessons learned). |

## Workflow

```bash
# 1) (Una sola vez por modelo) Renderizar el sprite Mixamo en Godot.
#    Ejemplo: las 10 anims de combate × 8 direcciones para Y Bot
python3 tools/render_sprite_sheets.py --models y_bot \
    --anims idle walk run quick heavy medium defensive precise hit_react death \
    --angle isometric_30

# 2) (Opcional) Build del base browser para validar visualmente los sprites:
python3 skinning_lab/build_base_browser.py --model y_bot --angle isometric_30
# → skinning_lab/bases/y_bot/index.html  (dropdowns: anim × dirección)

# 3) Ver presets de tests AI disponibles:
python3 skinning_lab/run.py --list-presets

# 4) Preview sin gasto API (genera contact_sheet + keyframes_preview):
python3 skinning_lab/run.py --preset y_bot_walk_4kf --preview-only

# 5) Ejecutar el preset (gasta créditos Meshy):
python3 skinning_lab/run.py --preset y_bot_walk_4kf

# 6) Servir y usar el generador de personajes en el navegador:
./skinning_lab/serve.sh
# → http://localhost:8911/                  ← runs anteriores
# → http://localhost:8911/bases/y_bot/      ← base browser + character generator
```

## Generador de personajes (enfoque hero-shot anchor)

Dentro del `bases/<model>/index.html` hay un panel a la derecha:

1. **Diseñar referencia** (iterativo): pones nombre y prompt, pulsas "generar
   referencia" → llama `POST /api/characters/{name}/hero_shot` que img2img-ea
   el frame `dir_0_frame_000.png` del modelo base con tu prompt. Te devuelve
   un hero-shot 1024px. Repite hasta que te guste; el panel muestra historial
   de las últimas 6 generaciones.
2. **Skin de animaciones**: cuando estés conforme, marcas las anims y
   direcciones que quieras y pulsas "skin animations" → para cada (anim, dir)
   compone el atlas de keyframes de Y Bot, llama Meshy con
   `reference_image_urls = [atlas, hero_shot]`, descompone el atlas resultante
   en frames y construye el GIF skinneado en
   `characters/<slug>/skinned/<anim>/dir_<N>.gif`.
3. **Comparar**: el dropdown "vista" arriba alterna entre la base Y Bot y
   cualquier personaje generado, con sus GIFs reemplazando los originales.

Coste por (anim × dir): según el modelo (`nano-banana` $0.06 / `-2` $0.12 /
`-pro` $0.18). Una idle entera 8 dirs en banana-pro = $1.44. La UI muestra
total estimado antes de gastar.

**Storage por personaje:**
```
skinning_lab/characters/<slug>/
  config.json
  hero_shot.png             # actual
  history/<ts>.png          # iteraciones previas
  skinned/<anim>/dir_<N>.gif
  skinned/<anim>/dir_<N>_atlas.png   # atlas raw devuelto por Meshy (debug)
```

Cualquier flag del preset puede sobrescribirse en CLI:
```bash
python3 skinning_lab/run.py --preset y_bot_walk_4kf --frame-indices "0,3,6,10" --variants V4
```

## Estructura por run

Cada run vive en `runs/<timestamp>_<preset>/` y es completamente
auto-contenido (nada referencia ficheros fuera del run salvo los sprites
fuente, que viven en `nefan-html/public/sprites`):

```
runs/2026-05-03_165000_y_bot_walk_4kf/
  meta.json                 # config + summary
  costs.json                # task_id, latencia, USD por llamada
  contact_sheet.png         # todos los source frames numerados
  keyframes_preview.png     # los frames elegidos en una fila
  index.html                # viewer comparativo
  V3_rolling/
    nano-banana-pro/
      frame_*.png
      loop.gif
  V4_atlas/
    nano-banana-pro/
      grid_input.png
      grid_output.png
      frame_*.png
      loop.gif
```

`skinning_lab/index.html` (en la raíz del lab) lista todos los runs anteriores
y se regenera automáticamente al final de cada `run.py`.

## Crear un preset nuevo

Los presets viven en `presets/*.json` y son JSON simple:

```json
{
  "name": "y_bot_walk_4kf",
  "description": "Walk Y Bot, 4-keyframe sprite sheet density",
  "base_sprites": "y_bot/walk/isometric_30",
  "keyframes": 4,
  "directions": 1,
  "variants": ["V3", "V4"],
  "models": ["nano-banana-pro"],
  "prompt": "campesino arapiento, andrajos marrones...",
  "anchor_images": null,
  "concurrency": 8,
  "budget_usd": 1.0
}
```

Campos disponibles:
- `base_sprites` (req) — path relativo bajo `nefan-html/public/sprites/`
- `keyframes` (int) — N evenly-spaced frames cubriendo todo el ciclo
- `frame_indices` (str) — override explícito tipo `"0,3,7,10"` (precedencia sobre keyframes)
- `frames` (int) — fallback stride sampling, drop fps de meta a `target_fps`
- `target_fps` (int) — para stride sampling. Default 8.
- `directions` (int) — cuántas direcciones renderear. Default 1 (sólo dir 0).
- `variants` — subset de `["V1","V2","V3","V4"]`
- `models` — subset de `["nano-banana","nano-banana-2","nano-banana-pro"]`
- `prompt` (str) — el prompt que describe al personaje skinneado
- `anchor_images` (list[str]) — paths absolutos para V2 (default: auto-pick frame_0 + mid)
- `concurrency` (int) — `asyncio.Semaphore` width. Default 8.
- `budget_usd` (float) — hard cap. El run aborta si el plan excede.

## Lessons learned (mantener actualizado)

- **V1 single** es deriva total — cada frame es un personaje distinto.
- **V2 anchor** mejora pero sigue parpadeando en detalles (barba aparece/desaparece, ropa muta).
- **V3 rolling** es viable con base limpia (Y Bot mejor que Paladin) — drift mínimo en texturas.
- **V4 atlas pequeño (≤10 frames en 5×2)** mantiene consistencia perfecta dentro del atlas.
- **V4 atlas grande (29 frames en 6×5)** colapsa: el modelo ignora pose del input y repite la misma. Confirma el sweet spot 3-6×2-3 de Robotic Ape.
- **Locomotion (walk/run) requiere Hips XZ lock** o el personaje sale del cell. Ya implementado en
  `godot/scripts/dev/sprite_sheet_renderer.gd:_lock_hips_xz_if_locomotion()`.
- **Meshy nano-banana** devuelve siempre 1024×1024 RGB (sin alpha). Para producción con alpha, tirar
  rembg después o renderear sobre fondo verde y aplicar despill.

## Añadir un proveedor nuevo

Pasos para integrar fal.ai / Replicate / Stability / video model:

1. Crea `ai_server/<provider>_client.py` con clase async que exponga
   `submit(model, prompt, refs, **kwargs)`, `wait(task_id)`, `download(url)`.
2. Añade en `run.py:PROVIDER_REGISTRY` el mapeo `provider_id → cliente, modelos
   válidos, USD/call`.
3. Crea un preset que use el nuevo provider.
4. Run y compara en el viewer.
