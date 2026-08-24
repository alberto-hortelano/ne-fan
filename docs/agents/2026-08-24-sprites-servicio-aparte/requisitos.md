# Requisitos — Sacar la generación de sprites de personaje a un proyecto independiente

## La petición, literal

> «Crea una tarea nueva, queremos sacar la generacion del sprite de personajes a un proyecto
> independiente porque lo va a usar otro proyecto y puede que se de como servicio aislado.
> El flujo seria: Un servicio que recibe angulos, fps, medidas, animaciones... y una o varias
> imagenes de referencia y genera uno o varios sprites de la imagen dada con las animaciones
> elegidas. Guardara la cache de los y_bots que genere con la configuacion con la que se
> generaron, no de las imagenes generadas.»

## Qué se pide, desmenuzado

1. **Un proyecto independiente**, no un módulo de ne-fan. El motivo lo da el usuario y no se
   discute: **lo va a usar otro proyecto**, y **puede que se ofrezca como servicio aislado**.
   O sea que ne-fan pasa a ser *un* consumidor, no *el* dueño.
2. **Un servicio** con una entrada declarada: `ángulos`, `fps`, `medidas`, `animaciones`, «…»
   (la lista del usuario está abierta a propósito) **y una o varias imágenes de referencia**.
3. **Salida**: uno o varios sprites *de la imagen dada*, con *las animaciones elegidas*.
4. **La caché es de los `y_bot`** —las hojas base— **guardadas junto con la configuración con
   la que se generaron**. **NO se cachean las imágenes generadas.**

El punto 4 es una decisión de producto explícita y es lo que más forma le da al servicio: lo
que se conserva es el artefacto **determinista y reutilizable** (una hoja base para una
configuración dada es siempre la misma), no el contenido **generado para un cliente concreto**.
El crítico puede señalar consecuencias, pero **no la reencuadra**: el usuario ya eligió.

## Estado de hoy (premisas a verificar, no diseño)

La generación de sprites de personaje vive hoy **partida en dos mitades y en dos lenguajes**:

| Mitad | Dónde | Qué hace | Coste |
|---|---|---|---|
| **Base** | `tools/render-sprite-sheets/` (Node + three.js en Chrome headless) | Monta el FBX de Mixamo, congela Hips en XZ y rinde `{model}/{anim}/{angle}/dir_{D}_frame_{F:03}.png` + `meta.json`. ~350 PNG en ~3 s | **Cero créditos**, determinista |
| **Skin** | `ai_server/sprite_skin_meshy.py` + `POST /skin_sprite_sheet` (`routers/remote_generation.py:217`) | Toma una hoja base + `prompt` + ref de estilo y la repinta con Meshy (hero-shot de identidad + atlas de keyframes por dirección). Cachea en `cache/sprite_sheets/{key}/` | **Gasta créditos** |

Consumidores y satélites conocidos: `nefan-html/src/renderer/sprite-renderer.ts` (reproduce
con el `meta` del sheet **skinneado**, no el del base), `portrait.ts` (usa el hero-shot como
retrato de diálogo), `labs/skinning/` (el lab donde se validó el pipeline, con sus `presets/`
y sus `runs/`), `labs/narrative/fake-ai-server.mjs` (sirve `/skin_sprite_sheet` sin GPU),
`tools/render-sprite-sheets/comparar.py` (paridad medida contra hojas de referencia).

**Lo que el crítico tiene que verificar, no dar por bueno:**

- **Dónde está de verdad la frontera.** El usuario describe UN servicio que recibe config +
  imágenes de referencia y devuelve sprites. Hoy son dos mitades con lenguajes, dependencias
  y modelos de coste distintos. ¿El proyecto independiente son las dos, o solo una? Que la
  caché sea *de los y_bot* sugiere que la base entra; que la entrada sean *imágenes de
  referencia* sugiere que el skin también.
- **Qué de esto es de ne-fan y qué es genérico.** `style_id`/`style_role` resuelven contra los
  style packs de ne-fan (`deps.style_packs.resolve_character`), que un servicio aislado no
  tiene. La petición dice «una o varias imágenes de referencia»: eso es la versión genérica de
  lo mismo, y el crítico debe decir qué se queda fuera al genericalizarlo.
- **Los FBX de Mixamo están gitignorados** porque la licencia de Adobe prohíbe redistribuirlos
  (`assets/characters/mixamo/README.md`). Un servicio que otro proyecto consume tiene que
  decir de dónde salen los modelos base, y eso es una restricción legal, no técnica.
- **Qué se rompe en ne-fan el día después**: `#216` (7 modelos ofrecidos, solo `y_bot` con
  hojas) y `#217` (los estáticos que faltan devuelven 200) están vivos y en esta superficie.
  ¿Esta extracción los cierra, los agrava o los deja igual?
- **Si hay conflicto con la cola**: `#241` (ni una línea de `nefan-html` está medida) y las
  tandas pendientes tocan cliente; esta toca `tools/`, `ai_server/` y `labs/`.
- **La caché, tal como la pide el usuario**: hoy la mitad que cachea es la CARA (skins de
  Meshy, `cache/sprite_sheets/{key}/`) y la barata se re-rinde. La petición invierte eso.
  El crítico debe medir qué cuesta hoy cada mitad y decir qué implica el cambio — **sin
  proponer conservar el cacheo de imágenes generadas**, que es justo lo que se descarta.

## Fuera de alcance salvo que el crítico demuestre lo contrario

Rediseñar el pipeline de skinning, cambiar de proveedor, tocar el renderer del cliente, o
resolver `#216`/`#217`. La tarea es **de dónde vive y qué contrato expone**, no de cómo pinta.

## Cómo se sabrá que está hecho

Lo fija el arquitecto tras el visto bueno del usuario a la crítica. Como mínimo, la petición
exige que un proyecto **ajeno a ne-fan** pueda pedir sprites con su configuración y sus
imágenes de referencia, y que ne-fan siga funcionando consumiéndolo.

---

# Respuestas del usuario a la crítica (2026-08-24)

El crítico devolvió **REENCUADRADA** y confirmó la frontera —**el servicio son las dos
mitades**— con cuatro comprobaciones, la primera decisiva: hoy no las une un contrato sino
la ruta `ai_server/asset_paths.py:13` → `nefan-html/public/sprites`. Levantó dos decisiones
de producto. Estas son las respuestas, literales:

## 1 · De dónde salen el rig y los clips

> «Los archivos estan pero se ignoran en el repo, quien lo quiera usar tendra que bajarselos
> de la pagina de Adobe. Podemos poner como se hace en el readme pero dejando claro que es un
> ejemplo, vale cualquier set de animaciones y modelos. El servicio tendra que describir que
> animaciones ofrece como config ya que depende de los assets que se usen como base. Nosotros
> vamos a usar Mixamo que ya lo tenemos descargado»

Lo que fija, y **no se re-discute**:

- **El servicio no distribuye ningún asset de personaje.** Los pone quien lo despliega. Eso
  cierra el problema de licencia sin renunciar al escenario «servicio aislado»: lo que se
  ofrece es la **capacidad**, no los modelos.
- **Los assets son de despliegue, no de petición.** No se suben con cada request: están ahí
  cuando el servicio arranca.
- **El servicio es agnóstico al set.** Mixamo es **un ejemplo documentado en el README**, no
  el sujeto. Vale cualquier juego de rig y animaciones. Corolario duro: todo nombre de
  Mixamo hoy escrito a mano —`y_bot` en `character-sprites.ts:18`, `frontal_8` en
  `render.mjs:77`, los perfiles de `ANIM_PROFILES`— deja de poder ser una constante.
- **El servicio DESCRIBE lo que ofrece**, porque depende de los assets que tenga: qué modelos,
  qué animaciones, qué ángulos. Es capacidad nueva y es parte del contrato, no un extra.
  El arquitecto decide su forma; el requisito es que **quien llama pueda preguntar** en vez de
  adivinar.
- Ne-fan usará Mixamo, que ya está descargado. No cambia el aspecto de ningún personaje.

**Esto le da sujeto a `#216`** («el título ofrece 7 modelos base y solo `y_bot` tiene hojas»):
con un catálogo declarado por el servicio, la lista del título puede ser cierta por primera
vez en vez de estar escrita a mano. No se arregla en esta tarea, pero deja de ser insoluble.

## 2 · Dónde vive lo generado

> «En el caso de ne-fan en su asset-store pero es responsabilidad del cliente guardar lo
> generado, no de este servicio»

Lo que fija:

- **El servicio no guarda las imágenes generadas. Punto.** Confirma el punto 4 de la petición
  original y lo endurece: no es que no las cachee por defecto, es que **no es asunto suyo**.
- **Guardarlas es responsabilidad de quien llama.** En ne-fan, su asset-store (`:8767`), que
  ya guarda todo lo demás que se paga y ya sirve estas rutas.
- Con eso, el coste en créditos queda **como hoy** ($6,14 por personaje, una vez), no como el
  escenario sin caché que el crítico midió.

**Consecuencia que entra en alcance** (el crítico la demostró y tiene razón): hoy la respuesta
son *URLs dentro de la caché del servicio* (`frame_urls: ["/cache/sprite_sheet/{key}/…"]`).
Un servicio sin estado **no puede devolver URLs a nada**: devuelve imágenes. Eso cambia el
wire, y con él **el cargador del cliente** (`sprite-renderer.ts:152-166`) y
`labs/narrative/fake-ai-server.mjs`, que sostiene el bench sin créditos. Los tres **salen de
«fuera de alcance»**: sin ellos la petición no se puede cumplir.

Lo demás de «fuera de alcance» sigue en pie: no se rediseña el pipeline de skinning, no se
cambia de proveedor, no se tocan `ANIM_PROFILES`/`ATLAS_MAX_CELLS`/el umbral de eco, y no se
«aprovecha» para arreglar `#216`, `#217` ni `#236`.

## Lo demás de la crítica que el arquitecto hereda como hecho

- **La caché de `y_bot` es capacidad NUEVA, no conservación**: la mitad base no cachea nada
  (se indexa por `{model}/{anim}/{angle}`, sin `fps` ni tamaño), así que hoy un `--fps 24`
  **pisa en silencio** la hoja de 12 fps. El punto 4 arregla ese bug de paso.
- **El render son 8,57 s medidos**, no ~3 s.
- **Falta un consumidor** en la lista original: `nefan-html/src/ui/style-apply.ts:399` (el
  batch del título), candado por `qa/guiones/07`, que existe para que las dos vías deriven la
  MISMA clave o el personaje se cobra dos veces.
- **Genericalizar el estilo pierde solo el `style_token`**: el `content_hash` muere con la
  caché que se retira, y la resolución del pack es semántica de ne-fan y se queda aquí. Basta
  con que el contrato genérico acepte, junto a las imágenes, una cláusula de estilo en texto
  libre.
- **El `angle` por defecto está muerto**: el endpoint usa `isometric_30`, vista retirada en
  agosto; la base solo soporta `frontal_8`. Hoy una petición sin `angle` da 404.
- **El retrato de diálogo se rompe** si nadie recoge el hero-shot: `portrait.ts` lo lee de la
  caché privada del skin, y el hero **es una imagen generada**.
- **`comparar.py` no es un satélite: es la red del traslado.** Es lo único que demuestra que
  las hojas del servicio nuevo son las de hoy. Se usa **durante**, no después.
- **`labs/skinning/` (39 MB) se va con el servicio.** Sus `runs/` son material de sesión:
  confirmación del usuario antes de borrar nada.
- **`#212` queda anulada**: su trabajo vivo es meter `tools/render-sprite-sheets/fbx-anim-span.test.mjs`
  en el CI de ne-fan, y ese directorio se va. Congelada.

---

# Decisiones sobre el plan (2026-08-24)

**Adaptador, decidido por el coordinador.** El arquitecto se desvió del encargo y tiene razón:
la consecuencia «el servicio devuelve imágenes ⇒ el cliente deja de recibir URLs» vale para el
wire DEL SERVICIO, no para el interno de ne-fan, y solo se vuelve forzosa si quien llama es el
navegador. **No lo será.** `/skin_sprite_sheet` se queda en remote-gen reimplementado como
adaptador (resuelve el pack → HTTP al servicio → escribe en `cache/sprite_sheets` → devuelve
URLs). El acoplamiento que motiva la tarea muere igual (`SPRITE_SHEETS_DIR` deja de existir en
Python) y `sprite-renderer.ts`, `portrait.ts`, `style-apply.ts`, el fake-ai-server y los guiones
07/13 no cambian de forma. Opción B1 del plan.

Corolario: **`sprite-renderer.ts` y `fake-ai-server.mjs` vuelven a estar FUERA de alcance**, al
contrario de lo que decía la sección anterior. Lo que sí entra es `SKIN_IMAGE_CALLS`
(`style-apply.ts:40-45`), que espeja `ANIM_PROFILES` a mano y quedaría mintiendo el mismo día:
pasa a leerse de `/catalog`.

## Respuestas del usuario

**Ubicación**: repo propio en **`~/code/sprite-forge`**, con su git y en GitHub desde el día
uno, **sin publicar en npm**. Ne-fan lo consume por HTTP (skins) y por CLI local (hojas base).
Precio aceptado: el CI de ne-fan no compila el servicio, así que ne-fan verifica **contra el
fake** y la paridad de píxel vive en el CI del repo nuevo.

**Los 606 MB inalcanzables de `cache/sprite_sheets`** (124 hojas `isometric_30` + 45 directorios
sin `meta.json` + heroes huérfanos): **a `archivo/`, no `rm`**. Las 9 hojas alcanzables se
quedan donde están.

---

# Decisión pendiente de ejecutar — regenerar `public/sprites` (2026-08-24)

El usuario eligió **«Regenerar, y verlo antes de decidir en firme»**.

**Por qué NO se hace en el momento de decidirlo**: el ingeniero está en los pasos 3 y 4, y
verifica el guion 13 contra esas mismas hojas. Regenerarlas a mitad de su medida la corrompe.
Se ejecuta **cuando los pasos 3 y 4 hayan aterrizado**, como acción propia.

## Qué es exactamente

Las hojas de `nefan-html/public/sprites` las generó el renderer viejo de Godot. La referencia
está **sesgada ~5 % por encima** de lo que produce el renderer de three.js de hoy, y ese sesgo
es la causa de las dos cosas que el ingeniero midió en su §3:

- los 2 frames de `y_bot/heavy` fuera de tolerancia, **pre-existentes en `main`**;
- que un negativo del **+11,8 %** de luz no muerda: el sesgo se come media banda del candado.

## Qué incluye la acción, entera

1. Regenerar las 11 hojas con el renderer de three.js (30 s de CPU, cero créditos).
2. **Capturas del antes y el después en el juego**, no solo de las hojas: el usuario pidió
   verlo antes de decidir en firme, y esto es arte, que es lo único que este proyecto no
   verifica con un test. Crítica visual de director de arte, no checklist.
3. **Re-congelar la red de `sprite-forge`**: `reference/` y `fingerprints.txt` pasan a ser las
   hojas nuevas. Si no, el candado sigue comparando contra el sesgo que se acaba de quitar.
4. **Re-medir la desviación congelada de `y_bot/heavy`**: es probable que desaparezca. El
   ingeniero construyó el congelado para que una desviación que deja de ocurrir se ponga
   **roja pidiendo que la borren** — o sea que el propio candado dirá si se fue.
5. Si al verlo el tono no convence, se revierte: son 30 s y las hojas están gitignoradas.

---

# Ronda de corrección (2026-08-24) — QA: NO APTO

Los cuatro criterios literales del usuario **se cumplen**, verificados por QA como un tercero
(imagen de referencia propia, `style_note` en texto libre, cero identificadores de ne-fan, 32
PNG en base64 y **0 ficheros nuevos** en todo el árbol del servicio). Lo que lo tumba es el
arranque.

### E1 · `--preset play` y `--preset cliente-web` NO arrancan — OBLIGATORIO

```
❌ sprite-forge /health did not respond within 90s
$ wc -c /tmp/nefan-sprite-forge.log
0
```

Dos defectos encadenados, los dos con arreglo pequeño:

1. **En sprite-forge**: `parar()` (`src/skin.mjs`) espera un `exit` que **ya ocurrió**, y el
   `setTimeout` de rescate está **`unref`'d**, así que el bucle de eventos se vacía y Node sale
   con 0 **antes de imprimir** el `! repintado NO disponible` que ya estaba escrito. El README
   promete lo contrario de lo que hace.
2. **En ne-fan**: `start_sprite_forge` **no activa el `.venv`** —los otros tres subshells sí lo
   hacen— ni pasa `SPRITE_FORGE_IMAGE_KEY`, que ne-fan tiene en `.env` con otro nombre. Con solo
   arreglar lo primero, `skin.enabled=false` y **vuelve el maniquí** que §9.7 daba por cerrado.

**El candado ya existía y no se corrió**: `qa/presets.mjs` reconoce el servicio nuevo sin tocarlo
y da `✘ NO levantó`. Los 16/16 de `qa/run.mjs` no lo desmienten — esa batería levanta el único
preset con servicios que **no** incluye sprite-forge. Correrlo pasa a ser parte de la
verificación de cualquier cambio en `start.sh`.

**La lección, escrita para que no se repita**: el `✅ sprite-forge :8770` del informe salió de un
shell con el venv ya activado. Es un «funciona en mi máquina» con la evidencia dentro — el
entorno del que verifica no es el del usuario.

### E2 · El adaptador es el único puente y tiene cero tests

~270 líneas, y el anterior tenía 228 que se borraron con él. Es por donde pasa todo lo que ne-fan
pide al servicio. Tests suyos, con su rojo demostrado.

### E3 · El ciclo de vida del worker, sin test en el repo nuevo

Es justo lo que falló en E1. Un test que lo habría cazado vale más que el arreglo.

### E4 · Adoptar el candado de QA

`qa/sprites-sin-servicio.mjs` (cuatro comprobaciones sobre el arreglo del arte pagado, cero
créditos por construcción, probado en negativo). **No se toca**: se pone verde por el código.

### Corrección al informe

§9.7 dice que lo único sin probar es la llamada al proveedor. Es falso: falta **el preset `play`
entero**. Esa comprobación cuesta créditos y sigue siendo del usuario, pero decirlo de menos es
lo que dejó pasar E1.
