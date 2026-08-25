# QA — Retirada del gpu-worker y de la cadena de reuse (#199)

Rama `fix/retirada-gpu-worker` @ `79cd1f9` · PR [#258](https://github.com/alberto-hortelano/ne-fan/pull/258).
Validado contra la petición LITERAL del usuario, no contra el plan:

> «199 Sin generar sprites usa y_bot, de los personajes se encarga sprite-forge.
> Y quita el gpu worker si no lo usa nadie»
> … y después: **«Se va todo, torch incluido»**

Todo lo de abajo se midió en esta máquina, arrancando el juego desde donde arranca el
jugador. Cero créditos: `html-fixtures` (sin backend) y `e2e-sin-creditos` (motor falso).
**No se ejecutó `--preset play`**: gasta créditos reales y esa es decisión del usuario.

---

## Criterios

| # | Criterio (de la petición, no del plan) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **El juego se sigue jugando** — `html-fixtures`, las DOS fixtures del selector Room, con movimiento | ✅ | `./start.sh --preset html-fixtures` + navegador: `robledo_tile` (npcs=5, 66 billboards, frames 8→28, **1,41 m** manteniendo W) y `zorder_test` (npcs=14, 14 billboards, frames 45→70, **1,52 m**). Capturas `qa/capturas/qa199-robledo_tile.png` y `qa199-zorder_test.png`. Movimiento con TECLADO real (`page.keyboard.down("w")`), no con `?input=scripted` |
| 2 | **El juego se sigue jugando** — partida completa sin créditos | ✅ | `node qa/run.mjs` → **19/19 guiones en verde** (título → sesión → primera persona → colisión → diálogo → viaje → guardado → resume). Exit 0 |
| 3 | **«Sin generar sprites usa y_bot»** — sin NINGÚN backend | ✅ | En `html-fixtures`: **1.410 peticiones de hoja de personaje, modelos = `["y_bot"]`** y nada más. Se ve en la captura: el maniquí bajo la etiqueta «Guardia Roric» |
| 4 | **«Sin generar sprites usa y_bot»** — con el backend de skins CAÍDO en partida real | ✅ | Guion nuevo `qa/guiones/21-…`: con `/skin_sprite_sheet` devolviendo 503, el libro de skins marca `failed`, los NPC siguen montados, **1.348 hojas pedidas, todas de `y_bot`**, cero frames de personaje vestido. Captura `qa/capturas/21-…-01-gente-en-y-bot.png` |
| 5 | **«Sin generar sprites usa y_bot»** — el jugador lo elige en el título («Personajes base») | ✅ | La opción existe y funciona: `#ts-charmode [data-charmode="vector"]` → «🧱 Base y_bot · Maniquí neutro para todos (sin coste)». La ejerce `qa/guiones/13-personajes-animados`, verde en la corrida de arriba |
| 6 | …y el jugador se entera de POR QUÉ ve maniquíes | ✅ | Error-log en pantalla: «skins IA desactivados para la sesión (los personajes usan la base y_bot). Motivo: ai_server /skin_sprite_sheet HTTP 503…». Aserto 4 del guion 21 |
| 7 | **«De los personajes se encarga sprite-forge»** — ne-fan ya no genera personajes | ✅ | `grep` a cero de `/generate_skin` y `/generate_sprite` en los cinco procesos; `skin_generator.py` y `sprite_generator.py` borrados; `sprite-forge` (:8770) es quien acompaña a `remote-gen` en `start.sh` |
| 8 | **«Quita el gpu worker SI NO LO USA NADIE»** — la condición se cumple | ✅ | `grep -rn "gpu_worker\|generate_texture\|generate_model\|generate_skin\|generate_sprite\|:8766"` sobre `*.ts/py/mjs/js/json/sh/md` fuera de `docs/agents` → **0 en código**. `labs/narrative/fake-ai-server.mjs` no sirve ninguno de los cuatro (sus 17 rutas listadas). Y medido **en vivo**: 1.477 peticiones de una partida entera y 1.511 de la sesión de fixtures, **0 a un endpoint retirado** |
| 9 | **«Se va todo, torch incluido»** | ✅ | `.venv` **824 MB / 95 paquetes** (era 6,6 GB / 128). `find_spec`: `torch` False, `diffusers` False, `rembg` False; `fastapi` True, `PIL` True. `pip check` → «No broken requirements found.» `labs/fps/local_textures.py` borrado y con 0 referencias vivas |
| 10 | El recorte de dependencias **no dejó tests verdes y vacíos** | ✅ | `python -m unittest discover -s ai_server/tests` → **Ran 131 tests · OK**, **0 skips** (`-v` no reporta ni uno; el único `skipUnless` del repo es `fastapi`/`PIL`, ambos instalados). Y −4 exactos: `git show main:` → `test_gpu_worker_app.py` 3 tests + `test_two_gpu_workers.py` 1; `test_available_assets.py` 4→4; 13→11 ficheros de test. 135 → 131 confirmado por aritmética independiente |
| 11 | **Los presets arrancan lo que dicen** | ✅ | `node qa/presets.mjs` → **7/7**, exit 0. `play` = `3000 3737 8765 8767 8768 8770 9877 9878`; `story-web-sin-imagenes` = `3000 3737 8765 8767 9877 9878`. **Difieren de verdad en remote-gen (:8768) + sprite-forge (:8770)** |
| 12 | El candado nuevo de `arch-rules.json` puede ponerse ROJO | ✅ | Probado por QA **en negativo, en los tres tipos de root**, no solo en TS: sonda en `src/scene/scene-normalize.ts` (los 4 términos), en `ai_server/narrative_schemas.py` y en `qa/guiones/*.mjs` → `architecture.test.ts` **37 pass → 36 pass / 1 fail** en los seis casos. Árbol limpio después (`git status --porcelain` vacío) |
| 13 | El asset-store **sigue sirviendo las filas históricas** de los kinds retirados | ✅ | Arrancado solo: `/assets?asset_type=…` → texture 203 hashes (406 filas), model 9, skin 6, sprite 59. `/assets/by_hash/{h}` → 200 en los cuatro. Blobs: `/cache/albedo/{h}` 657 KB, `/cache/normal/{h}` 590 KB, `/cache/model/{h}` 11,2 MB, `/cache/skin/{h}` 4,5 MB, `/cache/sprite/{h}` 9,3 KB. **Los `*_cache_dir` redocumentados siguen resolviendo** |
| 14 | Ningún camino llama a un endpoint inexistente y falla en silencio | ✅ | Además del ✔ del criterio 8: `AiClient` ya no compila esos métodos, `gpu_proxy` desmontado de `main.py`, `NEFAN_URL_GPU_WORKER` fuera del env sintético del navegador. Medido por el cable en dos stacks distintos |
| 15 | **La prosa que se corrige con esto deja de mentir** | ❌ | **No del todo.** `CLAUDE.md:64,67` sigue vendiendo el gpu-worker como servicio del preset `play` y definiendo `story-web-sin-imagenes` por él; `README.md:26-27,33` sigue vendiendo SD 1.5 / TripoSG y el reuso por hash. Detalle en Hallazgos 1 y 2 |
| 16 | `--preset play` con motor narrativo y créditos reales | ⚠️ | **No probado a propósito** (gasta dinero del usuario). Ver «No probado» |

---

## Hallazgos

### 1 · IMPORTANTE — `CLAUDE.md` sigue diciendo que `play` arranca el gpu-worker

**Reproducción desde cero:** abrir `CLAUDE.md` (entra ENTERO en cada sesión de agente) y
leer la tabla de presets, líneas 64 y 67. Luego `./start.sh --list`.

```
CLAUDE.md:64  | 1 · Play | `play` | asset-store + gpu-worker + remote-gen + bridge + … |
CLAUDE.md:67  | 4 · Story web sin imágenes | `story-web-sin-imagenes` | como Play sin gpu-worker ni remote-gen |
```

Dos mentiras, y la segunda es **exactamente la trampa que el crítico dejó anotada**
(«`story-web-sin-imagenes` se define como “Play sin gpu-worker ni remote-gen”… hay que
redefinirlo por lo que apaga de verdad»). El ingeniero la corrigió en `start.sh` —donde
hoy pone «sin remote-gen ni sprite-forge», verificado con `--list`— y la dejó intacta en
la copia de `CLAUDE.md`. La primera además omite `sprite-forge`, que `play` **sí** levanta
(:8770, medido por `qa/presets.mjs`).

Qué esperaba quien lo lee: que el manual de arranque no le mande a un proceso borrado.
No rompe el juego, pero es la prosa **más cara del repo**: se carga en cada contexto, y el
siguiente agente que lea esa tabla razonará sobre una diferencia entre dos presets que ya
no existe. `docs/arquitectura/{ia-servicios,mapa,narrativa}.md`, `docs/microservices/*` y el
resto de `CLAUDE.md` sí quedaron corregidos: es un hueco, no un olvido general.

### 2 · IMPORTANTE — `README.md` (la portada del repo) vende dos capacidades muertas

**Reproducción:** `sed -n '24,34p' README.md`.

```
README.md:26  │  SD 1.5 + LCM-LoRA + TAESD (PBR textures) · img2img (skins)        │
README.md:27  │  Meshy/TripoSG (GLB models) · scene image gen (img2img/outpaint)   │
README.md:33  - **Asset library indexed by hash** — … the narrative engine reuses cached
              assets by hash instead of regenerating.
```

La TABLA de «Generative Models» de tres líneas más abajo sí se limpió en este mismo diff
(se fueron `texture_generator.py`, `skin_generator.py`, `model_generator.py`); el **diagrama
ASCII que está encima** siguió declarando esos mismos pipelines dentro de `ai_server`. Y la
línea 33 afirma el reuso **por hash**, que es justo lo que esta tanda mató y que
`CLAUDE.md:168` ya reescribe al revés («se reusan por DESCRIPCIÓN, no por hash»): el repo
se contradice a sí mismo en dos ficheros de primer nivel.

### 3 · MENOR — el docstring de `_inject_available_assets` describe una rama inalcanzable

`ai_server/llm_client.py:258-262` sigue prometiendo «intercalado round-robin por tipo — una
muestra VARIADA, no el tipo más reciente monopolizando la ventana». Con
`REUSABLE_ASSET_TYPES = "surface"`, `by_type` tiene siempre una clave y ese intercalado no
puede ocurrir. El informe de implementación **declara** esa pérdida de cobertura (y la anota
en el test), pero el docstring del código sigue vendiéndola como comportamiento.

### 4 · MENOR — `docs/microservices/decisions.md` se corrige a medias

La decisión 14 (`gpu_lock`) quedó tachada en este diff con su motivo; la decisión 8
(`:27`, «Puertos objetivo: **8766 gpu-worker**, 8767 asset-store, 8768 remote-gen») sigue en
pie sin marca. Es un registro histórico y el impacto es bajo, pero el mismo fichero trata
dos decisiones muertas con dos criterios distintos.

### 5 · OBSERVACIÓN (pre-existente, NO de esta tanda) — el saneador se traga un campo retirado en silencio

`EntitySchema` es `.passthrough()` y `clean_ent` de `ai_server` es allow-list: si el motor
emitiera hoy uno de los cuatro campos retirados, **no habría fail-loud** — se caería sin
ruido en los dos gates. No es una regresión (así se comporta cualquier campo desconocido) y
el candado de `arch-rules.json` impide que el término vuelva al REPO, pero conviene saber
que del lado del MODELO lo único que hay es que ya no se le pide. Choca de refilón con la
doctrina «fail-loud al modelo». Backlog, no de esta tanda.

### 6 · OBSERVACIÓN (pre-existente) — dos derivas menores del mismo tipo que la #1

- La descripción de `cliente-web` en `start.sh`/`CLAUDE.md` dice «bridge + HTML +
  asset-store + remote-gen» y su máscara levanta **también sprite-forge** (:8770, medido).
  Lo introdujo la tanda anterior (`a31a6f4`), no esta.
- El kind `scene_render` (5 filas del manifest) no está en `dirsByType` del asset-store, así
  que sus blobs no se sirven. Anterior a esta tanda y ajeno a los cuatro kinds retirados.

---

## El guion nuevo

`qa/guiones/21-sin-generar-sprites-los-personajes-son-y-bot.mjs` — lo mecánico de la
PRIMERA mitad de la petición, que no tenía candado, más la mitad de #199 que solo se ve en
una sesión viva. Cinco afirmaciones, en el orden en que se romperían:

1. la partida **PIDIÓ** skins de verdad (sin esto, «cae a y_bot» sería un verde vacío);
2. los NPC siguen montados en el mundo 3D con el backend caído;
3. **todas** las hojas de personaje que se cargan son de `y_bot`, y ni un frame vestido;
4. el juego lo dice en cristiano y **nombra a y_bot**;
5. una partida entera no lanza **ni una** petición a los cuatro endpoints retirados ni a `:8766`.

El estado «no hay quien genere» se produce como se produce de verdad —`/skin_sprite_sheet`
devolviendo **503**, que es lo que contesta remote-gen sin sprite-forge detrás
(`qa/sprites-sin-servicio.mjs`)— y la partida se abre en el modo **por defecto** del título
(«Skins IA»), no eligiendo «Personajes base»: ese camino es el fácil y no ejerce el fallback.

**Probado en negativo** (tres sabotajes, cada uno con su corrida y todos revertidos):

| Sabotaje | Resultado |
|---|---|
| `BASE_MODEL = "otro_bot"` + symlink `public/sprites/otro_bot → y_bot` (el juego funciona, pero deja de usar y_bot) | ✘ «y TODAS son de la base y_bot» — `modelos: ["otro_bot","y_bot"]` |
| Quitar «los personajes usan la base y_bot» del mensaje del error-log | ✘ «el juego DICE por qué… y nombra a y_bot» |
| `fetch("/generate_texture")` en el camino del fallo de skins | ✘ «ninguna petición… al gpu-worker retirado» — `["http://localhost:3000/generate_texture"]` |

Tras revertir: **1/1 en verde**, `git status --porcelain` vacío y `architecture.test.ts`
37/37 (el fichero vive en `qa/**/*.mjs`, que es root de `campos-retirados-no-vuelven`; los
cuatro términos prohibidos **no** aparecen en él).

---

## Workarounds usados durante la prueba

| Workaround | ¿Lo tendrá delante el jugador? | Veredicto |
|---|---|---|
| `page.route("**/skin_sprite_sheet")` → 503 | **Sí, y por eso se usa**: es el estado real de un stack sin sprite-forge. No oculta nada, produce el estado que la petición nombra | No es hallazgo |
| `?raf=timer` en headless | No: en una pestaña visible el rAF corre solo. Flag de bench ya establecido en `qa/run.mjs` | No es hallazgo |
| Elegir la fixture disparando `change` sobre `#room-selector` | No: es el `<select>` REAL del jugador (mismo camino que `__nefan.loadFixture`); un desplegable nativo no se puede clicar en headless | No es hallazgo |
| Sondas de test en negativo (`BASE_MODEL`, symlink, `fetch` inyectado, término en `scene-normalize.ts`/`narrative_schemas.py`/`01-…mjs`) | No: revertidas todas; `git status` limpio y `public/sprites/` sin el symlink | No es hallazgo |
| Ninguno para **ver** la feature | — | Nada hubo que ocultar ni forzar para que el juego arrancara o se dejara jugar |

---

## No probado

- **`./start.sh --preset play` con motor narrativo real y créditos.** Gasta dinero del
  usuario y exige un terminal de Claude Code poseyendo `:3737`. Mitigado, no sustituido:
  `qa/presets.mjs` arranca `play` de verdad y comprueba que levanta **exactamente** su
  máscara de puertos, y los 19 guiones cubren el flujo completo contra el motor falso.
- **La capacidad que se va con el worker** (texturas PBR y modelos GLB en pantalla). No hay
  nada que probar: `texture_hash` tenía **0 lectores** en `nefan-html/src` desde julio, y
  las cachés lo corroboran (`cache/textures` y `models` sin escribirse desde el 2026-07-02).
  El cliente pinta igual que antes.
- **El CI del runner.** Leído, no re-ejecutado: `gh pr checks 258` → `ai-server`,
  `narrative-mcp`, `nefan-core`, `nefan-html` los cuatro `pass`.
- **Un clon limpio.** `nefan-html/public/sprites/` está gitignorado (28 MB fuera de git):
  aquí y_bot está completo y el juego arranca; en un clon virgen, no. Es una condición
  conocida y declarada fuera de alcance en `requisitos.md`, no una regresión de esta tanda.
- **Corrida completa de mutación / `npm run verify`.** Se ejecutó solo
  `architecture.test.ts` (37/37) por ser el sujeto del candado nuevo; el resto lo cubre el
  CI verde.

---

## Veredicto

**APTO CON RESERVAS.**

La retirada está **hecha y bien hecha** donde importa: el juego arranca y se juega en los
dos presets sin coste, las dos fixtures pintan y se recorren, una partida entera va del
título al guardado sin una sola petición a un endpoint muerto, «sin generar sprites usa
y_bot» es cierto en los tres estados en que puede darse (sin backend, con el backend caído
y elegido en el título), los siete presets levantan exactamente su máscara, el asset-store
sigue sirviendo las 480 filas históricas, el `.venv` bajó a 824 MB sin volver verde y vacío
ni un solo test, y el candado nuevo se pone rojo en los tres tipos de root — comprobado aquí,
no heredado del informe.

La reserva es **una sola cosa y es prosa**: la tanda se propuso explícitamente corregir «la
prosa que YA miente hoy» y dejó viva la de los dos ficheros más leídos del repo —la tabla
de presets de `CLAUDE.md`, que entra en cada sesión y sigue mandando a arrancar el
gpu-worker, y el diagrama de `README.md`, que sigue vendiendo SD 1.5 y TripoSG dentro de
`ai_server`. Una de esas dos líneas es literalmente la que el crítico marcó como trampa y
que sí se arregló en `start.sh`. Son cuatro líneas de edición y ningún riesgo; sin ellas, el
próximo agente que lea `CLAUDE.md` heredará el mismo residuo que produjo este issue.
