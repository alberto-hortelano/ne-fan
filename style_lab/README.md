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

## Hallazgos (run 003_scifi_fidelity, 2026-07-17)

Bench sobre el tile REAL de colonia_aster (blueprint del save + generación por
`SceneImageGenerator.generate_full`, camino Meshy→fal de producción). El bug:
la escena generada CALCABA la composición de la ref de estilo
(`acero_neon/settlement.jpg`, un recinto amurallado completo con puerta) en
vez de repintar el blueprint. Causas y fixes validados (2 muestras/caso):

- **Una ref de estilo con composición fuerte se calca** — sobre todo en las
  bandas VACÍAS del capture (margen norte/oeste del viewBox, fondo
  `CAPTURE_BG`): el modelo rellena el vacío con el template de la ref. Las
  refs medievales (pictóricas, orgánicas) no lo provocan; una ref sci-fi
  geométrica sí.
- Fix 1 (prompt, aplicado a `scene_image_generator.py`): cláusula de ROL de la
  segunda ref ("ONLY an art-style reference … do NOT copy its layout/fence/
  gate/composition") + cláusula de zonas vacías ("flat dark-green areas are
  OUTSIDE the playable map — plain terrain, NO structures").
- Fix 2 (dato): la ref `settlement` de un pack debe ser un asentamiento
  ABIERTO y asimétrico, sin muro perimetral ni puerta — un recinto cerrado es
  una plantilla copiable. Regenerada la de acero_neon con `scene` explícita.
- Con ambos fixes: 100% de edificios casados y 0-6 máscaras inventadas en
  sci-fi Y medieval (sin regresión). Solo prompt (sin regenerar la ref) NO
  basta: la cola mala reaparece (~50% de las muestras).
- El prompt del kind svg mide ~2800 chars: `IMAGE_TO_IMAGE_PROMPT_MAX` subido
  a 3000 (el límite de 2000 truncaba scene_description + style_token + reglas
  en el camino Meshy; el fallback fal siempre envió el prompt completo).
- La métrica `pct_matched` puede dar 100% con IoU ~0.01 (máscaras SAM gigantes
  casan con todo por `inter/min-área`): para juzgar composición, SIEMPRE
  revisar las imágenes/overlays además de los números.

### Addendum: segmentador (siluetas de edificio)

Sobre la misma escena real: **el auto-segment de SAM2 NO produce máscaras de
objetos grandes compuestos** — el cuerpo de un edificio no aparece entre sus
~50 máscaras (solo ventanas/paneles; la mejor máscara cubría el 18% del bbox y
era suelo). No es cuestión de umbrales: el endpoint no expone granularidad y
el modo automático no tiene noción de "objeto". Medido:
- unión de partes agrupadas por visión: 5-17% de cobertura del edificio;
- box prompt (`fal-ai/sam2/image`) con la caja unión(plan ∪ partes):
  **79-83% de cobertura con 95-100% de contención** — silueta completa
  (tejado + fachadas), respetando oclusiones (el mástil que solapa al bloque
  queda excluido de su máscara).
Aplicado como paso de REFINADO en `/analyze_scene_image`: para cada elemento
tall que la visión confirmó (le asignó partes), SAM2 box prompt extrae la
silueta; máscara vacía ⇒ se conserva la unión de partes. La visión decide
identidad; SAM solo completa la silueta.

## Añadir un proveedor nuevo

Añadir en `gen.py` una rama en `run_case()` (payload + parseo de respuesta)
o un módulo aparte con la misma firma, y casos `CASES` que lo usen. Mantener
siempre el contrato del manifest: `{file, endpoint, quality, image_size,
prompt, refs, note, elapsed_s}`.
