# QA — «Un error que nadie oye» (#365 · #366 · #367 · #236 · #369-R10)

**Veredicto: APTO CON RESERVAS.** Los cinco criterios escritos se cumplen y los guiones nuevos
nacen rojos de verdad. Lo que NO se cumple es la premisa que el §1 del reencuadre pone por escrito
—*«el servicio se niega **antes** de pagar»*— y que fue **la razón declarada** para que el usuario
eligiera «avisa, no falla» en #367: con `rembg` ausente y clave real, **cada personaje nuevo sigue
pagando un hero-shot que se tira** (`POST /identity`), y el umbral de 3 de #236 multiplica por tres
el número de esos pagos por sesión. Medido en vivo, con cliente falso, en esta máquina.

Validado sobre el árbol tal y como me lo dieron: ne-fan en `fix/los-dos-mudos-sueltos` (`6a59ada`,
apilada sobre `b50b832`) y sprite-forge en `fix/dial-de-repintado-honesto` (`9ad354b`). No cambié de
rama. El PDF sin trackear de `nefan-core/data/styles/anime/characters/` no lo he tocado.

Entorno de la medida, que es justo el que motivó la tanda:
`.venv/bin/python -c "find_spec('rembg')"` → **False**, `grep -c '^MESHY_API_KEY=.' .env` → **1**,
`/home/al/code/sprite-forge` clonado. Es decir: clave presente, repintado muerto.

---

## Criterios

| # | Criterio (petición original) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Un borrado **rechazado por el bridge** no hace desaparecer la partida y el jugador ve por qué | ✅ cumple | Guion 52 verde en la batería completa. Captura `52-…-01-borrado-rechazado.png`: las 3 tarjetas siguen ahí y `#ts-error` dice `No se pudo borrar la partida 1788271231-8e8ee8_clon0: delete_session_failed: EACCES: permission denied, unlink '…/state.json'`. **Negativo**: devuelto el título a `await deleteSession(id); await renderHome()` + `alert`, el guion sale **ROJO** (`timeout esperando: el título reacciona al borrado rechazado`) |
| 1b | «No estaba» y «no se pudo» dejan de ser la misma respuesta | ✅ cumple (texto) · ⚠️ **se ven igual** | `SessionDeletedMessage` es unión discriminada (`deleted`/`not_found`/`failed`+`error`); `failed` sin motivo **no compila**. Guion 52 bloque 2: la tarjeta rancia SÍ desaparece y el aviso dice «ya no estaba en disco: no había nada que borrar». Pero los dos desenlaces se pintan con el **mismo** `mostrarErrorEnHome` → mismo bloque rojo `#a44` en el mismo sitio (hallazgo 4) |
| 2 | `/skin_sprite_sheet` con campo ausente o mal escrito → 422 estructurado | ✅ cumple | Sondas **en vivo** contra remote-gen `:8768`: sin `angle` → `422 [{"type":"missing","loc":["body","angle"]}]`; `angle:"  "` → `string_too_short`; `styel_id` → `extra_forbidden`; `promt` → las dos cosas a la vez; `{}` → los tres obligatorios nombrados. `Ran 142 tests … OK` en ai_server. **Negativo**: repuesto `request: Request` + `await request.json()`, `npm test` de core da `✖ [error] python-sin-request-crudo` |
| 3 | Un preset con sprite-forge y el repintado muerto (o sin repo) **no da verde**: el terminal dice la causa citando `skin.reason`, y el juego arranca | ✅ cumple | `./start.sh --preset cliente-web` **real**: `⚠️  sprite-forge arrancó pero el REPINTADO está apagado: falta 'rembg' … — los personajes salen en maniquí y_bot (el juego arranca igual)` y detrás `✅ remote-gen`, `✅ bridge`, `✅ HTML client`. Con `NEFAN_SPRITE_FORGE_DIR=/…/no-existe`: `⚠️  sprite-forge no está en … Clónalo o define NEFAN_SPRITE_FORGE_DIR` y los cuatro servicios arriba. El **rojo** es real: `script -qec … \| cat -v` → `^[[31m…^[[0m`. `node qa/presets.mjs` → **7/7 presets arrancan exactamente su máscara** |
| 3b | El dial deja de mentir (el fallo que costaba dinero) | ✅ el dial · ❌ **la ruta de pago no está cerrada** | Con la clave presente y sin rembg: **código viejo** (copia de `sprite-forge/main` en scratch) → `{'enabled': True, 'api': 'meshy', …}`; **código nuevo** → `{'enabled': False, 'reason': "falta 'rembg' …"}`. `/catalog` en vivo lo publica igual, y `POST /skins` → **503** con ese motivo. **Pero** `POST /identity` → **200**: no mira rembg y `skinWorker.pedir` solo se niega si el worker no está en pie (`skin.mjs:168`, `if (!base)`). El adaptador lo llama ANTES de `/skins` (`remote_generation.py:452-461` → `:464`). Sonda en vivo: `POST /skin_sprite_sheet` devolvió 503 **después** de escribir el hero `cache/sprite_sheets/heroes/6020fb381b4cb800.png`. Con Meshy real eso son 12 créditos = **$0,24 por personaje nuevo**, tirados. **Hallazgo bloqueante 1** |
| 4 | Con el backend devolviendo 500 para **un** personaje, el resto siguen recibiendo su skin | ✅ cumple | Guion 51 verde: saboteado `failed` con `ready:[]`, el otro con `ready:["idle"]`, `apagones 0`. Guion 53 (nuevo) bloque A: **4 de 5 vecinos vestidos, 0 apagones**. **Negativo**: `UMBRAL_APAGADO_DE_SESION = 1` (el comportamiento de antes) pone **rojos los dos** — el 51 por «el juego nunca lo registró» y el 53 por timeout de «los 4 vecinos que el backend NO tumba consiguen su skin» |
| 4b | El umbral **en su rango**: 1, 2 y 3 (lo pediste explícitamente) | ✅ cumple | Guion 53, cuatro bloques sobre `robledo_tile` (5 vecinos): **1 caído → 4/5 vestidos, 0 apagones**; **2 caídos → 3/5 vestidos, 0 apagones**; **3 caídos → 0 apagones→1, anunciado una sola vez**. El 51 **no** puede medir esto: su tile tiene 2 personajes, así que su aserto `fallidos.length >= 3` viaja sobre una condición que nunca se da |
| 4c | El mensaje explica lo que le pasa a su mundo | ✅ cumple · ⚠️ sin salida | Literal: `skins IA desactivados para la sesión: 3 personajes distintos han fallado con error de backend (umbral 3). Los personajes usan la base y_bot. Último motivo: …HTTP 500…`. Dice cuántos, el umbral y **qué va a ver** (`y_bot`). No dice **qué hacer** para salir — y salir, hoy, casi no se puede (hallazgo 3) |
| 5 | Todo lo anterior **queda candado**, no comprobado a mano | ✅ cumple | #365 → el tipo (unión discriminada, `failed` sin motivo no compila; verificado a mano: `TS2345`) + 3 tests de bridge + guion 52. #366 → `BaseModel` + regla nueva `python-sin-request-crudo` (**probada en negativo por mí**) + 6 tests. #367 → 8 tests de `veredictoDeForge` + `qa/presets.mjs` 7/7. #236 → guiones 51 y **53**. `npm run verify` 1793/1793, ai_server 142/142, sprite-forge 83/83 (node) + 30/30 (python), `nefan-html` tsc + lint limpios, `npm run deuda` = **69 items / fronteras 15** (la línea base, sin crecer) |
| R10 | `--set` y `--cache` dentro del árbol de ne-fan, sin repagar arte | ✅ cumple | Log del servicio en vivo: `set "nefan" en …/assets/characters` · `caché en /home/al/code/ne-fan/nefan-core/cache/sprite_base_sheets`. Comparación campo a campo de `nefan-core/data/sprite-set.json` contra `sprite-forge/sets/mixamo.json`: mismos 16 ids, **NINGUNA** diferencia en `file`/`locomotion`/`keyframes`/`play_fps`, `models` idéntico. La clave de caché no puede moverse |
| — | La batería completa desde el arranque | ✅ | `node qa/run.mjs` (bloque de puertos elegido por él): **51 en verde · 0 en rojo de 51**, exit 0. Re-corrida entera con el guion 53 añadido: **52 en verde · 0 en rojo de 52**, exit 0 |
| — | Gasto REAL contra Meshy | ⚠️ **no probado** | Cero créditos por mandato. Todo con `SPRITE_FORGE_IMAGE_API=fake`, clave de mentira en las sondas directas y el motor falso en el banco. El coste del hallazgo 1 está **trazado por código y reproducido con el cliente falso**, no facturado |

---

## Hallazgos

### 🔴 Bloqueante 1 — La ruta que costaba dinero sigue abierta: `/identity` paga con el dial apagado

El §1 del reencuadre dice que *«el servicio se niega **antes** de pagar, no después»* y que
*«con el dial arreglado ya no se puede gastar por error»*. Esa frase es **la razón escrita** de la
decisión del usuario de que #367 avise en vez de fallar. Está medida y es falsa.

`PR-A` pone la negativa en `/skins`, que es donde se paga **el atlas**. Pero la cadena de pago tiene
**dos** llamadas y la primera es `/identity` (el hero-shot), que no mira `rembg`
(`sprite_forge_skin/app.py:112-146`: `api.run_one` sin guarda) y a la que el guardia de Node no
llega, porque solo se niega si el worker **no está en pie** (`src/skin.mjs:168`, `if (!base)`), no
si `estado.enabled` es falso. El adaptador de ne-fan las llama en ese orden y sin consultar el
catálogo (`ai_server/routers/remote_generation.py:452-461`, luego `:464`).

Reproducción, desde el arranque, con cero créditos:

```
$ ./start.sh --preset cliente-web                      # este venv NO tiene rembg
⚠️  sprite-forge arrancó pero el REPINTADO está apagado: falta `rembg` …
$ curl :8770/catalog | jq .skin
{ "enabled": false, "reason": "falta `rembg` …" }
$ curl -X POST :8770/identity -d '{"prompt":"herrero…","model":"y_bot","anim":"idle"}'
HTTP 200                                               # ← con Meshy real, esto es una factura
$ curl -X POST :8768/skin_sprite_sheet -d '{"model":"y_bot","anim":"idle","angle":"frontal_8","prompt":"…"}'
HTTP 503 {"detail":"sprite-forge /skins: falta `rembg` …"}
$ ls cache/sprite_sheets/heroes | wc -l                # 60 antes → 61 después
```

El hero se escribió (`6020fb381b4cb800.png`, borrado por mí después) y *luego* llegó el 503.
`sprite_skin_model` es `gpt-image-2` = 12 créditos × $0,02 = **$0,24 por personaje nuevo**, por arte
que nunca se usa. Y el radio ensanchado de #236 lo **multiplica**: antes se pagaba una vez por
sesión (el primer 5xx apagaba todo), ahora se pagan hasta **tres** — exactamente el riesgo que la
crítica dejó escrito en su «día después §2» y que el §3 del reencuadre declaró cerrado por PR-A.

Nada en ne-fan mira `skin.enabled` antes de gastar: el camino en partida
(`sprite-renderer.ts:121`) no consulta el catálogo, y el de pre-generación (`style-apply.ts:187`)
lo consulta pero solo **añade una nota** y sigue.

**Lo que esperaba el jugador**: el terminal le dijo «el repintado está apagado, los personajes salen
en maniquí, el juego arranca igual». Lo razonable es leer eso como «no se va a intentar y no se va a
gastar». Se intenta, y se gasta.

**Dónde vive el arreglo** (no lo hago yo, lo reporto): `/identity` con la misma guarda que `/skins`,
o —mejor, porque cierra la clase entera— que el adaptador de remote-gen consulte `skin.enabled` y
devuelva su 503 **antes** de la primera llamada de pago.

### 🟠 Importante 2 — El aviso rojo de #367 no es accionable desde donde se lee

El motivo que se imprime es `pip install -r python/requirements.txt`. La terminal está en
`/home/al/code/ne-fan`, y ahí **ese fichero no existe**: vive en el repo hermano
(`/home/al/code/sprite-forge/python/requirements.txt`), y el intérprete que hay que arreglar es el
`.venv` de **ne-fan** (`start.sh` exporta `SPRITE_FORGE_PYTHON="$PROJECT_DIR/.venv/bin/python"`).
Un humano que copie la línea obtiene `No such file or directory`.

```
$ ls /home/al/code/ne-fan/python/requirements.txt      → No such file or directory
$ ls /home/al/code/sprite-forge/python/requirements.txt → existe
```

La cadena tiene la información (el launcher sabe `$SPRITE_FORGE_DIR` y `$PROJECT_DIR`); lo que falta
es unirla. El aviso acierta en todo lo demás —dice qué falla, cita `skin.reason` literal y dice qué
va a ver el jugador—, así que la corrección es pequeña y el valor es todo: un aviso que no se puede
ejecutar es el que se ignora, y el §8 del plan ya asume que ignorarlo es el riesgo.

### 🟠 Importante 3 — «Rearmar el cortacircuitos» no rearma a los personajes: el maniquí es para toda la pestaña

`rearmarCortacircuitos()` limpia `skinsDisabled` y `personajesFallidos`, pero **no**
`skins[*].failed`. Y `requestSkin` sale antes para un `existing.failed` sin `force`
(`character-sprites.ts:216-219`), mientras que `reRequestAllSkins()` llama **sin** `force`
(`main.ts:436-441`). `characterSprites` es un singleton de módulo (`main.ts:192`), así que el mapa
`skins` sobrevive a volver al título y reanudar.

Consecuencia: los dos rearmes que esta tanda cablea —`setPlayerAppearance` (entrar/reanudar) y el
OFF→ON del menú dev— devuelven a la sesión la **capacidad** de pedir skins, pero **ninguno vuelve a
pedir el de un personaje que ya falló**. El único camino es el botón `force` por item del menú dev,
o recargar la página. El comentario nuevo de `main.ts:132-136` («una partida abandonada con el
backend caído se llevaba el apagón a la siguiente —ya con el backend arriba— sin forma de saberlo
desde el juego») describe un arreglo mayor del que hay: la partida siguiente arranca sin apagón,
pero sus vecinos de siempre siguen en maniquí.

No es una regresión —antes pasaba lo mismo y con la sesión entera apagada—, pero sí es el «estado
sin salida» que #236 dice combatir, y el mensaje que ve el jugador tampoco menciona ninguna salida.
**Trazado por código, con las líneas; no lo convertí en guion a propósito**: afirmar el
comportamiento deseado dejaría la batería en rojo para todo el mundo, y afirmar el actual cementaría
el defecto. El candado va con el arreglo.

### 🟡 Menor 4 — «No estaba» y «no se pudo» se leen distinto pero se VEN igual

Los dos desenlaces acaban en `mostrarErrorEnHome` → `<span style="color:#a44">` en el mismo hueco
`#ts-error`. El criterio literal («dejan de ser la misma respuesta») se cumple en el texto y en el
comportamiento —la tarjeta desaparece en uno y se queda en el otro—, pero para el jugador que ojea,
«tu partida ya no estaba, no había nada que borrar» (que para él es un éxito) se pinta con el mismo
rojo de error que «no se pudo borrar». Un tono informativo distinto lo arregla.

### 🟡 Menor 5 — El aviso de borrado fallido es tres líneas de ruta absoluta, y no señala su tarjeta

`No se pudo borrar la partida 1788271231-8e8ee8_clon0: delete_session_failed: EACCES: permission
denied, unlink '/home/al/code/ne-fan/qa/.tmp/2026-09-01T13-56-22-822Z-186513/saves/…/state.json'`.
La causa técnica **debe** estar (el guion 52 hace bien en exigirla), pero delante no hay una frase
que diga qué hacer —compárese con el aviso de #367, que sí la tiene— y el bloque vive ~350 px por
encima de la tarjeta que falló, que no queda marcada de ninguna forma. El único vínculo es un id
opaco de 20 caracteres. Sugerencia: una primera línea accionable y un realce en la tarjeta.

### 🟡 Menor 6 — Los guiones 07 y 15 documentan un comportamiento que ya no existe

Los dos explican su forma diciendo que *«el motor falso solo tiene hoja `idle` y contesta 500 a
`walk`, lo que dispara el cortacircuitos del cliente (`skinsDisabled`) y deja la sesión SIN pedir un
skin más»* (`07:130-137`, `15:32-36`). Con umbral 3 eso ya no pasa con dos personajes. Medido: en el
tile del banco (2 vecinos) el fusible **no** salta; en `robledo_tile` (5) **sí** (bloque D del guion
53: `vestidos 3/5 · fallidos 3 · apagones 1`). Los asertos siguen siendo correctos; la prosa que los
justifica es hoy falsa, y es justo la prosa que impide que alguien los «arregle» de vuelta.

### 🟡 Menor 7 — `data/sprite-set.json` es una copia sin candado de fidelidad

Hoy es idéntica al original en todo lo que puede repagar arte (verificado campo a campo), y
`sprite-set.test.ts` canda que estén las diez anims base con su perfil. Lo que nadie canda es la
**igualdad** con `sprite-forge/sets/mixamo.json` —vive en otro repo, así que no cabe en `npm test`—.
El riesgo real no es el que apuntan las `_notas`: es el inverso. Desde `--set`, ne-fan ya **no usa**
el set del servicio, así que un arreglo allí (una anim que desliza los pies, un `keyframes` mal
puesto) **no llega**. Merece una línea en el README de sprite-forge o un issue.

### 🟡 Menor 8 — `./start.sh --parar` no puede parar el sprite-forge que él mismo arrancó

La heurística de propiedad mira `/proc/<pid>/cwd` bajo `$PROJECT_DIR`, y sprite-forge corre desde el
repo hermano por diseño. Reproducido:

```
🛑 parando el stack de ESTE worktree (/home/al/code/ne-fan):
 191736    ⏭  :8770  node bin/sprite-forge.mjs serve --assets /ho  — AJENO, no se toca
```

Queda un servicio vivo en `:8770` **con la clave real exportada en su entorno**, y el siguiente
arranque se negará por puerto ocupado. Es **pre-existente** (el `cd "$SPRITE_FORGE_DIR"` no lo trae
esta tanda), pero la tanda reescribe justo esa función y sus documentos empujan a usar `--parar`
como la forma correcta de recoger. El `trap EXIT` del launcher sí lo mata; el problema es solo la
tecla `k` desde otra terminal.

### 🟡 Menor 9 — El PDF sin trackear ensucia el selector de mutación (confirmado, no es de esta tanda)

`npm run afectado` lo nombra el primero:
`data/styles/anime/characters/9ec3c9820ee745888be885d3a2d54ff3_….pdf → TODOS`. No lo he tocado.
Nota adicional: el fichero nuevo `scripts/salud-sprite-forge.ts` **también** fuerza `TODOS` («es el
instrumento de medida»), así que aunque el PDF se vaya, esta tanda seguirá pidiendo la corrida
entera. Está bien que sea conservador; conviene no atribuirlo solo al PDF.

### ⚪ Observación 10 — El panel de errores se llena más rápido que antes

«Una entrada por fallo, SIEMPRE» cierra el hueco mudo, y hace bien. El efecto colateral es que cada
anim caída escribe su entrada **con traza de pila completa** (`sprite-renderer.ts:91:23`,
`character-sprites.ts:147:23`). En la captura `53-…-01-umbral-1-caido.png`, cinco fallos llenan la
columna entera. Contra un 4xx no hay fusible ninguno (`if (!backendDown) return`), así que ahí el
volumen es personajes × anims. No es un defecto de la tanda —era el comportamiento previo para 4xx—
pero conviene saberlo antes de que alguien lo llame tormenta.

---

## Guiones dejados

| Guion | Qué canda |
|---|---|
| `qa/guiones/53-el-umbral-de-skins-se-mide-en-el-rango.mjs` (nuevo) | El rango entero del umbral de #236 (1 / 2 / 3 caídos) sobre `robledo_tile`, más el banco sin máscara. Cubre la rama que el guion 51 deja sin ocupante. Fila añadida a `qa/README.md` |

Probado en negativo, como exige `qa/README.md`: con `UMBRAL_APAGADO_DE_SESION = 1` los bloques A y B
se ponen **rojos** (`timeout esperando: los 4 vecinos que el backend NO tumba consiguen su skin`).
Restaurado y verificado con `git status` limpio.

---

## Workarounds usados durante la prueba, y por qué no son hallazgos

| Workaround | Por qué hizo falta | Veredicto |
|---|---|---|
| **404 a `walk`/`run` de los personajes sanos** en los bloques A/B/C del guion 53 | El motor falso solo tiene hoja `idle` y contesta **500** a `walk`, así que sin la máscara los cinco vecinos fallan con error de backend y el umbral se alcanza solo: la variable que el guion mueve dejaría de ser la que decide | **No es hallazgo del producto**: es una limitación del BANCO, no del juego. Un 404 es lo que devuelve el servidor real ante una anim que no tiene, y el cliente lo trata como corresponde. El bloque D corre **sin** máscara y deja medido lo que se ve en el banco de verdad |
| `SPRITE_FORGE_IMAGE_API=fake` en el arranque real, y una clave de mentira en la sonda directa de `health()` | Cero créditos por mandato | **No afecta a la medida**: `build_client()` no valida la clave contra la red (`image_client.py:68-73`), así que la rama que decide `enabled` es idéntica con clave real o falsa, y con `fake` el rembg sigue faltando igual |
| Copia del `app.py`/`repaint.py` de `sprite-forge/main` a un directorio de scratch para medir el comportamiento VIEJO | Demostrar que el bug existía en **esta** máquina, sin cambiar de rama | **No es hallazgo**: no se tocó ningún repo, y es la única forma de comparar los dos diales en el mismo venv |
| `UMBRAL_APAGADO_DE_SESION = 3 → 1` y reversión del bloque de borrado de `title-screen.ts` | Los negativos que pediste: comprobar que los guiones nacen rojos | **Restaurados**; `git status` solo muestra el PDF ajeno y mi guion 53 |
| Un hero PNG creado por la sonda del adaptador | Era la prueba del hallazgo 1 | Borrado; `cache/sprite_sheets/heroes` restaurada idéntica (60 ficheros, `diff` vacío) |
| **Interferencia mía**, declarada: la primera corrida del guion 53 salió ⊘ porque el `timeout` de mi lanzamiento de `cliente-web` se llevó por delante el stack del banco a media prueba | Culpa del orquestador (yo), no del producto | Re-medido con los puertos limpios; el resultado que se cita arriba es el de la corrida limpia |

---

## No probado

- **Gasto real contra Meshy.** Cero créditos. El hallazgo 1 está trazado por código y reproducido con
  el cliente falso (el hero se escribió en disco y el 503 llegó después); lo que no hay es una
  factura. La cifra de $0,24 sale de `MODEL_CREDITS["gpt-image-2"]=12` × `USD_PER_CREDIT=0.02` con
  `sprite_skin_model: "gpt-image-2"` en `runtime_config.json`, no de un cobro observado.
- **La mutación de `contrato-sprite-forge`** sigue pedida y sin medir, como declara el ingeniero. No
  bloquea.
- **El hallazgo 3 en vivo** (rearme cross-sesión). Trazado por código con las líneas exactas; no lo
  medí en el navegador por la razón escrita arriba.
- **`find_spec("rembg")` con rembg instalado pero roto.** Declarado por el ingeniero; el 502 de
  `/skins` sigue de backstop.
- **El orden de merge entre repos.** Si `PR-B` entra sin `PR-A`, el radio ensanchado de #236 paga
  contra un forge que aún cobra el atlas. Está escrito en el commit; no hay nada que lo sujete.

---

## Veredicto

**Apto con reservas.** La tanda hace lo que dice en los cinco criterios escritos, los candados
nuevos se ponen rojos de verdad y la batería entera está verde. La reserva es una y es concreta: el
hallazgo bloqueante 1 invalida la premisa sobre la que se tomó la decisión de UX de #367, y esa
decisión —«avisa y deja jugar»— se sostenía justamente en que ya no se podía gastar por error. O se
cierra `/identity` (o el adaptador, antes de la primera llamada de pago) y entonces la decisión del
usuario queda apoyada en algo cierto, o hay que volver a preguntarle con el dato correcto delante.
Los hallazgos 2 y 3 son baratos y afectan a lo que el jugador puede hacer cuando algo va mal, que es
el tema de la tanda entera.
