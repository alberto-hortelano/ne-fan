# REENCUADRADA

**La condición se cumple: cero consumidores vivos de los cuatro endpoints.** La retirada está
autorizada, sin freno. Reencuadro el ALCANCE —equivocado en las dos direcciones— y **uno de los tres
hallazgos load-bearing, que es FALSO**. Verificado sobre `main` @ `0b10d9f`.

## El problema real, en una frase

No es «quitar un proceso»: es que ne-fan sigue **pidiéndole al motor narrativo y al contrato de escena**
una capacidad —texturas PBR y modelos GLB locales— que **ningún cliente pinta desde julio**; el
gpu-worker es solo el extremo muerto de esa cadena.

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| Los 4 endpoints, **0 llamadores** | **CIERTO.** Definidos en `routers/gpu_generation.py:54,89,125,156`, proxyados en `gpu_proxy.py:31-34` (montado en `main.py:123`). Fuera de eso solo `tests/test_gpu_worker_app.py:57` y `test_two_gpu_workers.py:47`, **en mock** |
| `generateSkin`/`generateSprite2D` sin caller | **CIERTO, con candado de tipo**: `bridge/context.ts:53-56` (`Pick<AiClient, "notifySessionStart"\|"generateScene"\|"reportPlayerChoice"\|"developWorld">`) — los dos métodos (`ai-client.ts:188,221`) ni siquiera están en la superficie que el bridge puede usar. Único ejercicio: `test/ai-client.test.ts:120` |
| `texture_prompt`/`model_prompt` muertos | **CIERTO.** Solo `prompts/scene_instructions.md:144-146` y la prosa de `CLAUDE.md:169`: se le piden al motor y nadie los lee |
| `texture_hash` viaja y muere | **CIERTO y MAYOR**: cero en `nefan-html/src`, pero vivo en siete sitios del contrato (`generate_scene.json:181`, `narrative_react.json:99`, `scene-schema.ts:45`, `schemas.ts:55`, `narrative_schemas.py:723,973`, `scene-normalize.ts:222`), y `llm_client.py:243` declara `REUSABLE_ASSET_TYPES="texture,model,sprite,surface"` — **tres de los cuatro tipos reusables que ve el motor solo los produce el worker**. Corroboración por fechas de caché: `cache/textures` y `models` últimos escritos **2026-07-02**, `skins` **2026-03-20**, `sprites` **2026-07-29**; lo vivo, `surfaces` **2026-08-22** y `sprite_sheets` **2026-08-24** |
| **`nefan-html/public/` NO EXISTE** | **FALSO.** `public/sprites/` tiene **1.763 ficheros / 28 MB**: `y_bot` con las **10** anims en `frontal_8` (exactamente las `BASE_ANIMS` de `character-sprites.ts:21-32`) y `paladin/idle`; `meta.json` → `generated_at 2026-08-09`. Gitignorado (`.gitignore:53`), que es otra cosa: **aquí el juego arranca con y_bot; en un clon limpio, no** |

## Los huecos que mandaba cerrar, cerrados

- **URL cruda**: cero — nadie llama `serviceUrl("gpu-worker")`; el único sitio que nombra
  `NEFAN_URL_GPU_WORKER` en el cliente es el mapeo genérico de `net/service-urls.ts:22`.
- **`fake-ai-server`** sirve `/skin_sprite_sheet`, `/sprite_catalog`, `/generate_surface_atlas`,
  `/generate_scene`… y **ninguno de los cuatro**. **`qa/`**: cero (solo `--disable-gpu` de Chrome).
- **`labs/`**: cero por HTTP, pero **un consumidor vivo del MÓDULO**: `labs/fps/local_textures.py:66`
  importa `TextureGenerator` **en proceso** (bench de texturas locales gratis) y CI lo compila. **Es la
  única capacidad real que se pierde**: enseñársela al usuario antes de borrar.
- **Proxy de :8765**: vivo y fail-loud (502), pero su único cliente posible es el `AiClient`.
- **`/backend_status`: huérfano él también.** Agrega el `model_backend` del worker
  (`routers/generation.py:75-131`), pero en `nefan-html/src` no hay ni una llamada a `/backend_status`,
  `meshy_3d`, `ai_vision` ni ningún `/health`: el «panel del title screen» de `ia-servicios.md:20` **no
  existe en el cliente**.

## El día después — **para quien juega, nada**; lo que cambia es la honestidad del repo

- **Huérfanos que se van el mismo día**: los tres flags muertos `graphics.ai_sprites`/`ai_textures`/`ai_models`
  (`config.ts:33-38`, **cero lectores en todo el repo**), los cuatro `*_cache_dir` (`:74-77`) y
  `texture_resolution`/`texture_steps`/`texture_lazy_load` (`:90-91,109`), la mitad `meshy_3d` de
  `/backend_status`, `contracts/gpu-worker.ts` + su export (`contracts/index.ts:24`),
  `service-registry.ts:54-63` y `test/service-registry.test.ts:18,21,43`.
- **Aquí el repo se defiende solo**: `mutation-targets.json:97` exime `contracts/gpu-worker.ts`, y `test/mutation-config.test.ts:191` pone rojo un `sin_mutar` que nombre un fichero inexistente.
- **Prosa que queda mintiendo — y que ya miente hoy**: `CLAUDE.md:3` vende «Assets IA (texturas PBR, modelos
  GLB)» como capacidad del producto cuando el cliente no lee `texture_hash`; también `CLAUDE.md:91,169`,
  `narrativa.md:19` («FpsRenderer … respeta `texture_hash`/`model_hash`» — no lo hace), `ia-servicios.md:19-29`,
  `mapa.md:51`, `microservices/README.md:18,143`, `migration.md:80-99`. **LaMa ya no existe en el código** y
  sigue citada en `gpu-worker.ts:5`, `service-registry.ts:62` y `config.ts:135`.
- **`start.sh`**: `story-web-sin-imagenes` se define como «Play sin gpu-worker ni remote-gen» (`:489,502`);
  sin worker su única diferencia con Play pasa a ser `remote-gen` — hay que redefinirlo por lo que apaga de
  verdad. Y `PRESET_PROFILES` es **posicional** (`:505-514`): quitar una columna desplaza las nueve filas **en silencio**.
- **Qué encoge, para anotar y NO ejecutar a ciegas**: `requirements.txt` no declara torch/diffusers/rembg y
  **fuera de los cuatro generadores nadie los importa** (SAM2 es remoto, `labs/common/sam.py:22`; `numpy` se
  queda por `surface_atlas_generator.py`). Del `.venv` de 6,6 GB quedan sin dueño torch 1,5 G + nvidia 2,7 G +
  triton 439 M + onnxruntime 466 M + diffusers 40 M ≈ **5,1 GB**; `ci.yml:94` dejaría de instalar
  fastapi/uvicorn/numpy. Quien decide si torch se va del `.venv` es `labs/fps/local_textures.py`.

## Conflictos

- **#216 · sin conflicto y encogido. Van SEPARADAS** (cero ficheros comunes: un proceso Python contra el
  desplegable del título). Con `a31a6f4`, de las tres listas a mano que citaba su crítica quedan **dos**
  —`title-screen.ts:76-84` y el defecto `"pete"` de `narrative-state.ts:72`—: `tools/render-sprite-sheets/render.mjs`
  ya no existe. Y ahora hay mecanismo, `/sprite_catalog` (`remote_generation.py:466`), que `style-apply.ts:193` consume.
- **La primera frase del usuario ya está implementada**: «sin generar sprites usa y_bot» es lo que hacen
  `character-sprites.ts:248` y `main.ts:125-142` (prueba las 10 anims del modelo elegido y cae a `y_bot` al
  primer fallo). Lo único que falla es que el título ofrece 6 modelos que siempre acaban ahí con una línea
  de error-log — **eso es #216, y es su único trabajo vivo**.
- **Regenerar `public/sprites` (`2026-08-24-sprites-servicio-aparte`): ni prerrequisito ni parte de esta
  tanda.** Su premisa («no se cumple si `public/sprites` está vacío») es falsa. Esa acción **sustituye**
  hojas por calidad de arte (sesgo ~5 % del renderer viejo), toca solo ficheros gitignorados y se juzga con
  crítica visual: independiente en las dos direcciones; si acaso primero, por barata y porque re-congela la
  red de paridad de sprite-forge.
- **#199 se cierra con esta tanda**; para fail-loud de FastAPI con retorno real el sitio sigue siendo **#195**. Sin conflicto con `arch-rules.json` (ninguna regla nombra al worker) ni con `git log` reciente.

## Coste contra valor

**No hacer nada no es gratis**: `CLAUDE.md:3` seguiría vendiendo una capacidad que no se pinta, `play`
seguiría esperando a un proceso que nadie llama y el motor seguiría recibiendo instrucciones para reusar
assets que mueren en la world scene. **Hacerlo** son ~1.585 líneas enteras más la cadena de contrato y la
prosa. El trabajo caro no es borrar el proceso: es decidir qué pasa con `texture_hash`/`model_hash` (zod,
dos tool JSON, dos espejos Python, el normalizador y la ventana `available_assets`). Vale la pena, y **de
una vez**: media retirada deja exactamente el residuo que produjo este issue.

## Qué le cambiarías a `requisitos.md`

1. **Sustituir el tercer hallazgo**: *«`nefan-html/public/sprites` existe y está completo (y_bot con las 10
   `BASE_ANIMS` en `frontal_8`, 28 MB, generado 2026-08-09), gitignorado — presente aquí, ausente en un clon
   limpio. La restitución de y_bot NO es prerrequisito de nada.»*
2. **Pregunta 5**: *«Regenerar `public/sprites` es acción independiente ya aprobada; ni bloquea ni la bloquea
   esta tanda. Se ejecuta aparte, con su crítica visual.»*
3. **Pregunta 3, respondida**: *«#199 y #216 en tandas separadas, cero ficheros comunes. La primera frase del
   usuario ya está implementada; su único trabajo vivo es #216.»*
4. **Ampliar la superficie**: los tres flags muertos de `config.ts:33-38`, los siete campos de config de
   caché/textura, la mitad `meshy_3d` de `/backend_status`, `mutation-targets.json:97`,
   `test/service-registry.test.ts:18,21,43` y **`labs/fps/local_textures.py`**.
5. **«Cómo se sabrá que está hecho»**: `grep` a cero de los cuatro paths y de `texture_prompt`/`model_prompt`
   en los cinco procesos, y **`node qa/presets.mjs` verde** — las máscaras de `start.sh` son posicionales y
   no hay otra forma de saber que no se desplazaron.
