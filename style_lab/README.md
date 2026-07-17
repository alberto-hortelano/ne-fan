# style_lab — bench de generación de referencias de estilo

Bench permanente (hermano de `skinning_lab/`) para evaluar modelos de imagen
como generadores de las **imágenes de referencia de los style packs**
(`nefan-core/data/styles/{id}/`, ver su README). Cada run es un subdir
auto-contenido en `runs/` (gitignored) con los PNG, un `manifest.json` que
asocia el prompt EXACTO y los parámetros a cada imagen, y un `index.html`
para revisarlas lado a lado.

```bash
source .venv/bin/activate
python style_lab/gen.py <run_name>                 # todo el batch CASES
python style_lab/gen.py <run_name> --only caso1,caso2
```

Requiere `FAL_KEY` en `.env`. Los casos se definen como lista declarativa
`CASES` al final de `gen.py`; re-ejecutar un caso sobrescribe su imagen y su
entrada del manifest (el resto del run se conserva).

## Proveedor probado: gpt-image-2 vía fal.ai

Dos endpoints REST síncronos (`Authorization: Key $FAL_KEY`):

- `POST https://fal.run/openai/gpt-image-2` — text-to-image.
  `prompt`, `image_size` (`square_hd` = 1024², o `{width,height}` múltiplos
  de 16 hasta 3840), `quality` (`low|medium|high`), `num_images`,
  `output_format` (`png|jpeg|webp`).
- `POST https://fal.run/openai/gpt-image-2/edit` — image-to-image; añade
  `image_urls` (lista, admite **data URIs** base64 — sin endpoint de upload)
  y `mask_url` opcional.

Precio aproximado por imagen 1024²: low ~$0.01-0.02 · medium ~$0.06 ·
high ~$0.17. Latencia medida: ~25 s (low), ~60-75 s (medium), ~200 s (high).

## Hallazgos (run 001_farmland_medievo, 2026-07-14)

> **Nota (posterior al run):** el juego unificó las dos perspectivas en una
> única proyección oblicua (cenital con caras + cara este) — los casos `iso_*`
> de este run y sus recetas de prompting quedan como referencia histórica;
> las candidatas cenitales siguen siendo directamente aplicables.

- **gpt-image-2 entiende "cenital con caras" a la primera**: con el frame
  `ENV_FRAME_TOPDOWN` del builder ya pinta tejado + cara sur en edificios.
  Añadir las reglas explícitas de la plantilla (`FACES_RULES`: cara sur ~25%
  más oscura, árbol = copa + tronco al sur) lo hace aún más consistente.
- **La iso necesita refuerzo**: `ENV_FRAME_ISO` a secas produce una aérea 3/4
  genérica. Lo que funciona: pedir "classic isometric strategy game map,
  strict 2:1 dimetric camera, the SAME projection for every building and
  tree". Ojo con la palabra "pixel-art" en el prompt: contamina la textura.
- **`/edit` con refs del pack clava la paleta** (el look tinta/vela de
  medievo_crudo) pero **arrastra la proyección de las refs**: refs cenitales
  empujan la iso hacia cenital. Mitigable ordenando "do NOT copy their
  projection", mejor aún cuando existan refs iso reales en el pack.
- Respeta bien "no text, no UI, no characters" y los materiales por zona
  (caminos de tierra sin empedrado en farmland) — el fallo histórico del
  empedrado universal venía de la ref urbana, no del modelo.
- `quality: medium` basta para iterar composición; `high` para la imagen
  final (más microdetalle, misma composición general).
- La respuesta no incluye el coste: comprobarlo en el dashboard de fal.

## Añadir un proveedor nuevo

Añadir en `gen.py` una rama en `run_case()` (payload + parseo de respuesta)
o un módulo aparte con la misma firma, y casos `CASES` que lo usen. Mantener
siempre el contrato del manifest: `{file, endpoint, quality, image_size,
prompt, refs, note, elapsed_s}`.
