# Retirada del gpu-worker + y_bot como base sin generación (#199, roza #216)

## La petición, literal

> «199 Sin generar sprites usa y_bot, de los personajes se encarga sprite-forge.
> Y quita el gpu worker si no lo usa nadie»

Y antes, cuando se le aparcó #199 preguntándole si el gpu-worker seguía en el producto,
el contexto que se le dio fue: «sus cuatro endpoints no tienen consumidor vivo tras
retirar la oblicua, el proscenio y el cliente 2D».

## Cómo lo lee el coordinador (LECTURA, no cita — sepárala de lo anterior)

Son dos frases y hacen dos cosas distintas:

1. **«Sin generar sprites usa y_bot, de los personajes se encarga sprite-forge»** — fija
   la política de personaje: la hoja BASE de `y_bot` es lo que se ve cuando no se ha
   generado aspecto (gratis, determinista), y el aspecto generado es competencia de
   **sprite-forge** (:8770, repo aparte), no de ne-fan. Es el argumento de por qué el
   gpu-worker sobra para personajes.
2. **«Y quita el gpu worker si no lo usa nadie»** — retirada **condicionada**. La
   condición es literal y es tuya de verificar: si aparece un consumidor vivo, la
   instrucción no se aplica tal cual y hay que parar y decirlo.

**Decisión de producto YA TOMADA por el usuario** (era lo que bloqueaba #199): el
gpu-worker no se queda si no lo usa nadie. No hay que volver a preguntársela. Lo que sí
hay que hacer es **verificar la condición** y **decir en voz alta qué capacidad se va con
él**, porque el usuario no puede consentir lo que no se le enseña.

## Lo que ya midió el coordinador (verifícalo, no lo heredes)

Pasada de `grep` excluyendo `dist/`, `.stryker-tmp/` y `docs/agents/`:

| Endpoint | Método en `ai-client.ts` | Llamadores en producción |
|---|---|---|
| `/generate_texture` | — (ninguno) | **0**. Solo `tests/test_gpu_worker_app.py:57` y `test_two_gpu_workers.py`, en modo mock |
| `/generate_model` | — (ninguno) | **0** |
| `/generate_skin` | `generateSkin` (`:221`) | **0** |
| `/generate_sprite` | `generateSprite2D` (`:188`) | **0**. Solo `test/ai-client.test.ts:120` |

Tres hallazgos de la misma pasada que **cambian el argumento**, y que hay que confirmar:

- **`texture_prompt` y `model_prompt` no existen en el código vivo.** Su único sitio en
  todo el repo es `data/contract/prompts/scene_instructions.md`: **se le piden al motor
  narrativo y nadie los lee**. Se está pagando prompt por una capacidad muerta.
- **`texture_hash` viaja y muere.** Llega hasta `scene-normalize.ts:222`, entra en la
  world scene… y en `nefan-html/src` no lo lee nadie. El cliente no pinta texturas IA.
- ~~`nefan-html/public/` NO EXISTE en disco.~~ **FALSO, tumbado por el crítico y
  reverificado por el coordinador**: `public/sprites/` tiene **1.763 ficheros / 28 MB**,
  con `y_bot` en las 10 `BASE_ANIMS` en `frontal_8` (generado el 2026-08-09) y
  `paladin/idle`. Está gitignorado (`.gitignore:53`), que es otra cosa: **aquí el juego
  arranca con y_bot; en un clon limpio, no**. La restitución de y_bot **no es
  prerrequisito de nada**.

⇒ Si esto se confirma, retirar el gpu-worker **no quita ninguna capacidad que funcione
hoy**: formaliza que ya no existe. Es un dato load-bearing para el veredicto, y si es
falso el veredicto cambia entero.

## Superficie que tocaría la retirada (para dimensionar, no para diseñar)

~1.250 líneas de Python (`gpu_worker_main.py` 190, `texture_generator.py` 170,
`model_generator.py` 354, `sprite_generator.py` 127, `skin_generator.py` 128,
`routers/gpu_generation.py` 200, `routers/gpu_proxy.py` 81), más
`nefan-core/src/contracts/gpu-worker.ts`, la entrada de `service-registry.ts`, los flags
de `config.ts`, `start.sh` (`start_gpu_worker`, el preset `play`, la lista de servicios,
`status`), `docs/arquitectura/ia-servicios.md`, `docs/microservices/README.md`, CLAUDE.md
(«Assets IA (texturas PBR, modelos GLB)») y sus tests.

## Lo que tienes que decidir

1. **¿Se cumple la condición?** Cierra los huecos que la pasada del coordinador deja:
   llamadas por URL cruda sin pasar por `ai-client`, el `fake-ai-server`, `labs/`, `qa/`,
   el proxy de :8765 (`gpu_proxy.py`) y `/backend_status`, que consulta el `/health` del
   gpu-worker para pintar el panel del título.
2. **¿Cuál es el alcance honesto?** Si se va el proceso, ¿se van también sus pesos y
   dependencias (SD 1.5, TripoSG, LaMa, `rembg`, `diffusers`, `torch`)? Mide qué encoge
   el `.venv` y **qué más lo usa** — `rembg` ya dio un susto: el plan de la tanda anterior
   afirmó que solo lo usaba un fichero y eran tres.
3. ~~¿Van #199 y #216 en la misma tanda?~~ **RESUELTO: separadas**, cero ficheros
   comunes. **La primera frase del usuario ya está implementada** —`character-sprites.ts:248`
   y `main.ts:125-142` prueban las 10 anims del modelo elegido y caen a `y_bot` al primer
   fallo—: su único trabajo vivo es #216.
4. **¿Qué pasa con `texture_prompt`/`model_prompt`/`texture_hash`?** Si están muertos,
   la doctrina de pre-producción («un formato que se sustituye se borra el mismo día,
   entero y en todos los procesos») dice que se van con esto. Pero eso toca el contrato
   del motor: dilo, no lo asumas.
5. ~~La restitución de y_bot.~~ **RESUELTO**: regenerar `public/sprites` es una acción
   independiente ya aprobada; ni bloquea ni la bloquea esta tanda. Se ejecuta aparte, con
   su crítica visual.

## Freno

Si la condición **no** se cumple —aparece un consumidor vivo de cualquiera de los
cuatro—, **para y dilo por escrito**. La instrucción del usuario era condicional y no
autoriza retirar algo que se usa.

## Fuera de alcance

Hallazgo lateral de higiene, anotado y sin tocar: `nefan-core/.stryker-tmp/` guarda
**433 MB** en tres sandboxes de mutación sin limpiar. Está gitignorado, así que no
contamina el repo; es basura en disco. No es de esta tanda.


---

# Veredicto del crítico: REENCUADRADA (2026-08-24)

`critica.md` — **la condición se cumple, cero consumidores vivos, sin freno**. Cerró los
seis huecos: URL cruda 0 · `fake-ai-server` no sirve ninguno de los cuatro · `qa/` 0 ·
proxy de :8765 vivo pero su único cliente posible es el `AiClient`, y `bridge/context.ts:53-56`
ni expone sus dos métodos GPU · y **`/backend_status` resultó huérfano él también** (el
«panel del title screen» de `ia-servicios.md:20` no existe en el cliente). Corroboración
por fechas: `cache/textures` y `models` sin escribirse desde el **2026-07-02**, `skins`
desde **marzo**, frente a `surfaces` (22 ago) y `sprite_sheets` (24 ago).

**El problema real no es «quitar un proceso»**: es que ne-fan sigue pidiéndole al motor y
al contrato de escena una capacidad —texturas PBR y modelos GLB— que **ningún cliente
pinta desde julio**. El worker es el extremo muerto de esa cadena.

## Superficie ampliada por el crítico

Además de lo ya listado: los tres flags con **cero lectores** `graphics.ai_sprites` /
`ai_textures` / `ai_models` (`config.ts:33-38`), los cuatro `*_cache_dir` (`:74-77`) y
`texture_resolution`/`texture_steps`/`texture_lazy_load` (`:90-91,109`), la mitad
`meshy_3d` de `/backend_status`, `mutation-targets.json:97`,
`test/service-registry.test.ts:18,21,43` y **`labs/fps/local_textures.py`**.

**El repo se defiende solo en un punto**: `test/mutation-config.test.ts:191` pone rojo un
`sin_mutar` que nombre un fichero inexistente, así que olvidar `mutation-targets.json:97`
no pasa desapercibido.

## Prosa que YA miente hoy y se corrige con esto

`CLAUDE.md:3` (vende «Assets IA (texturas PBR, modelos GLB)» cuando el cliente no lee
`texture_hash`), `CLAUDE.md:91,169`, `narrativa.md:19` («FpsRenderer … respeta
`texture_hash`/`model_hash`» — no lo hace), `ia-servicios.md:19-29`, `mapa.md:51`,
`microservices/README.md:18,143`, `migration.md:80-99`. **LaMa ya no existe en el código**
y sigue citada en `gpu-worker.ts:5`, `service-registry.ts:62` y `config.ts:135`.

## Trampas de ejecución

- **`PRESET_PROFILES` de `start.sh:505-514` es POSICIONAL**: quitar una columna desplaza
  las nueve filas **en silencio**. `node qa/presets.mjs` verde es obligatorio, no opcional.
- **`story-web-sin-imagenes`** se define como «Play sin gpu-worker ni remote-gen»
  (`:489,502`); sin worker su única diferencia con Play pasa a ser `remote-gen`. Hay que
  redefinirlo por lo que apaga de verdad.
- **El trabajo caro no es borrar el proceso**: es decidir qué pasa con
  `texture_hash`/`model_hash` — zod, dos tool JSON, dos espejos Python, el normalizador y
  la ventana `available_assets` (`llm_client.py:243` declara
  `REUSABLE_ASSET_TYPES="texture,model,sprite,surface"`, y **tres de esos cuatro solo los
  produce el worker**). **De una vez**: media retirada deja el residuo que produjo #199.

## Cómo se sabrá que está hecho

`grep` a cero de los cuatro paths y de `texture_prompt`/`model_prompt` en los cinco
procesos, `node qa/presets.mjs` verde, y la batería y el CI en verde.

---

# Decisión del usuario sobre el bench (2026-08-24)

Preguntado explícitamente qué hacer con `labs/fps/local_textures.py` —lo único vivo que
consume el código del worker, y de lo que depende si torch sale del `.venv`— eligió:

> **«Se va todo, torch incluido»**

⇒ **Retirada completa.** El bench se borra con el worker; el `.venv` adelgaza ~5,1 GB
(torch 1,5 G + nvidia 2,7 G + triton 439 M + onnxruntime 466 M + diffusers 40 M) y el CI
deja de instalarlos. Si algún día vuelve a hacer falta, está en el historial de git — que
es lo que manda la doctrina de pre-producción en vez de conservar código muerto.

**No se le pregunta nada más.** `texture_hash`/`model_hash` se van con esto: la doctrina
de pre-producción es explícita («un formato que se sustituye se borra el mismo día, entero
y en todos los procesos, `grep` del campo a cero») y el crítico avisó de que media retirada
deja exactamente el residuo que produjo #199. `surface` se queda en `REUSABLE_ASSET_TYPES`:
lo produce remote-gen y está vivo.
