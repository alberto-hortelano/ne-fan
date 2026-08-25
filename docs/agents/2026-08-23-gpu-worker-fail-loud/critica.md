# REENCUADRADA

La guardia que pide el issue **no puede dispararse en el escenario que el issue nombra**, y los cuatro endpoints que quiere blindar **no los llama nadie**. Verificado sobre `main` @ `e2a83e0`.

## El problema real, en una frase

No es «los endpoints del gpu-worker devuelven 500 opaco»: es que `ai_server/routers/gpu_generation.py` sirve **cuatro endpoints huérfanos** —sin consumidor vivo tras retirar oblicua, proscenio y cliente 2D— y el 500 opaco solo es alcanzable en el hook de test `NEFAN_GPU_MOCK`.

## La premisa, afirmación por afirmación

1. **«El fichero ni importa `HTTPException`»** → CIERTA. `gpu_generation.py:15` importa solo `APIRouter`; cero `if not deps.` en sus 200 líneas. Son cuatro endpoints (`:54,89,125,156`).
2. **«gpu-worker sin GPU → `AttributeError` → 500»** → **FALSA.** `gpu_worker_main.py:110-142` construye los cuatro generadores con `lazy=True` sin condición, y `texture_generator.py:33-36` no toca CUDA en el constructor (`import torch` vive dentro de `_load_pipeline`). Sin GPU los `deps.*` son objetos vivos, **no `None`**: la guardia propuesta no salta, y el 500 sigue llegando desde torch dentro de `.generate()` — **después** del arreglo.
3. **«backend caído»** → **FALSA, y ya resuelta.** El router solo se monta en `gpu_worker_main.py:161`; el acceso desde narrative-llm va por `routers/gpu_proxy.py`, que ya responde `502 {detail: "gpu-worker unreachable"}` (`:7-8,60`).
4. **«dependencia opcional ausente»** → **FALSA.** El lifespan (`gpu_worker_main.py:82-145`) no tiene `try/except`: si un import o constructor revienta, el proceso **no llega a servir**. Por esa vía no existe el estado «app arriba con `deps.X` a `None`».
5. **Un estado real con `deps.X` a `None`** → CIERTA, **uno solo**: `NEFAN_GPU_MOCK` (`gpu_worker_main.py:85-90`) puebla `asset_cache` y `texture_gen` y deja a `None` `model_cache`, `model_gen`, `skin_*` y `sprite_*` (`deps.py:29-46`). Ahí `/generate_model`, `/generate_skin` y `/generate_sprite` sí dan `AttributeError` → 500.
6. **«`/inpaint_scene_plate` era el único que comprobaba»** → CIERTA, y el patrón sigue vivo donde hace falta: `routers/generation.py:62,146,153` usa `raise HTTPException(503, "deps.X unavailable")`.

### La pregunta decisiva: ¿hay un candado con un agujero?

**No.** La única regla Python de `arch-rules.json` es `python-sin-error-con-200`, cuyo `text.pattern` es `return\s*\{\s*["']error["']`: prohíbe **devolver un error con 200 OK**, otro invariante. `gpu_generation.py` **no la incumple** — no se le escapa nada.

Y el candado que pide el issue **no cabe en ese checker**: `src/contract/arch/check.ts:50-56` solo admite `imports.forbid` y `text.pattern`, ambos regex sobre el fichero. «Un endpoint usa `deps.X` sin guardia previa» es una propiedad de flujo, no un regex: sería un mecanismo nuevo.

### El hallazgo que cambia el veredicto: nadie los llama

Barrido del repo (fuera de `dist/`, `.stryker-tmp/`, `node_modules/`, `archivo/`) por los cuatro paths: **solo definiciones, tests y prosa. Cero llamadas.**

- `src/narrative/ai-client.ts:190` (`generateSprite2D`) y `:223` (`generateSkin`): sin ningún caller en `src/`, `bridge/`, `services/` ni `nefan-html/src/`.
- `src/contracts/gpu-worker.ts:87` exporta `GpuWorkerApi`: **nadie lo importa**. `nefan-html/src/`, `qa/` y `labs/`: cero apariciones de los cuatro paths.
- `texture_prompt` —el campo que según `CLAUDE.md` dispara la generación— **ya no existe en el TS vivo**. El pipeline de imagen de la vista fps va por remote-gen (`deps.surface_atlas_gen`, `deps.surface_cache`, `deps.py:41-42`), no por el gpu-worker.
- Único ejercicio real: `tests/test_gpu_worker_app.py:57` y `tests/test_two_gpu_workers.py`, ambos sobre `/generate_texture` **en modo mock**.

Residuo esperable de tres retiradas seguidas (`7f7e417`, `49bf7d0`, `c7aae22`). El issue se escribió mirando el fichero, no sus llamadas.

## El día después

- **Para quien juega:** nada — ningún camino del juego pasa por estos endpoints. **Para quien depura:** casi nada; el único 500 que se vuelve 503 hay que provocarlo a mano con `NEFAN_GPU_MOCK`.
- **Qué se vuelve más difícil:** retirar el router. Cuatro guardias, sus mensajes y un test que los recorre son cuatro razones más para que nadie se atreva a borrarlo.
- **Qué nadie borrará:** el candado nuevo. Un test que recorre un router muerto no puede ponerse rojo por nada que importe — el «verde que no comprueba nada» que este repo ya tiene aprendido.
- **Qué parecerá arbitrario en un mes:** que `/generate_texture` compruebe `deps.texture_gen` cuando en producción ese atributo nunca es `None`, y que el worker sin GPU siga dando 500 en la línea siguiente.

## Conflictos

- **Solapamiento con #195** (`POST /scene/validate` responde 500 en vez de error accionable): misma clase de bug, pero sobre un endpoint que el motor narrativo **sí llama** (`bridge/state-http-server.ts:260`). Todo el valor de «fail-loud accionable» está ahí; en #199 no queda nada.
- **Contradicción con «pre-producción: cero compatibilidad»** (`CLAUDE.md`): lo que se queda sin sujeto se borra el mismo día, no se mantiene con guardias.
- **Dependencia oculta:** si se retiran los endpoints huérfanos, el trabajo de #199 se tira entero. Hacerlo antes es pagar dos veces. Sin conflicto con `arch-rules.json` ni con `git log` reciente.

## Coste contra valor

**No hacer nada:** coste real cero — nadie recibe un 500 porque nadie llama. **Hacerlo como está escrito:** cuatro guardias más un mecanismo de candado nuevo, para un estado alcanzable solo en modo mock, **sin arreglar el escenario que el issue anuncia**; valor negativo, consolida código huérfano. Lo que sí vale la pena es la pregunta que el issue destapa sin querer: *¿sigue vivo el gpu-worker?* Eso es **dirección de producto** y es del usuario.

## Qué le cambiarías a `requisitos.md`

Los tres «Criterios de aceptación de la tanda» dejan de valer: no hay error que nadie vaya a ver, el candado no cabe en el checker, y el patrón consistente ya existe donde hace falta. Sustituir la sección entera por:

> **Esta tarea no se implementa.** La acción es comentar #199 con el hallazgo, reetiquetarlo como pregunta de producto y pasar al siguiente issue. Queda para la revisión final de descartados, junto a la decisión sobre el gpu-worker.

Texto para pegar tal cual en #199:

> Verificado contra el código (`main` @ `e2a83e0`) antes de planificar; la premisa no se sostiene:
>
> 1. **«gpu-worker sin GPU» no produce el fallo descrito.** `gpu_worker_main.py:110-142` construye los generadores con `lazy=True` y `texture_generator.py:33-36` no toca CUDA en el constructor. Sin GPU los `deps.*` son objetos vivos, no `None`: la guardia no saltaría y el 500 seguiría llegando desde torch, dentro de `.generate()`.
> 2. **«backend caído» ya falla bien:** `routers/gpu_proxy.py` responde `502 gpu-worker unreachable`.
> 3. **«dependencia opcional ausente» no deja el server arriba:** el lifespan no tiene `try/except`.
>
> Queda un único estado real, `NEFAN_GPU_MOCK`, que es un hook de test.
>
> Y el motivo de fondo: **ninguno de los cuatro endpoints tiene consumidor vivo.** `AiClient.generateSprite2D`/`generateSkin` no los llama nadie, `GpuWorkerApi` (`src/contracts/gpu-worker.ts`) no lo importa nadie, `nefan-html/src`, `qa/` y `labs/` no los mencionan, y `texture_prompt` ya no existe en el TS vivo — el pipeline de imagen de la vista fps va por remote-gen. Solo los tocan `test_gpu_worker_app.py` y `test_two_gpu_workers.py`, en mock.
>
> Sobre el candado: `arch-rules.json` **no tiene un agujero** aquí. `python-sin-error-con-200` cubre otro invariante (error con 200 OK) y este fichero no lo incumple; además el motor solo admite regex sobre imports o texto (`src/contract/arch/check.ts:50-56`), así que «usa `deps.X` sin guardia» necesitaría un mecanismo nuevo — que sobre un router huérfano no podría ponerse rojo.
>
> **Propuesta: no implementar.** La pregunta viva no es cómo reportar estos errores, sino si el gpu-worker y sus cuatro endpoints siguen en el producto tras la retirada de la oblicua, el proscenio y el cliente 2D. Si se retiran, este issue se cierra solo; si se quedan, se reabre con la premisa corregida (el escenario a cubrir es el fallo de torch dentro de `.generate()`, no `deps.X is None`). Para invertir en fail-loud de FastAPI con retorno real, el sitio es **#195**.
