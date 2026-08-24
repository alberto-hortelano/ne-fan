# Veredicto: **REENCUADRADA**

La frontera que sospecha `requisitos.md` es la correcta: **el servicio son las dos mitades**. Pero la tarea no se puede especificar todavía, por dos cosas que el enunciado no nombra: el sujeto de la caché del punto 4 —el `y_bot`— es un asset con licencia que no se puede redistribuir, y la lista de entradas no dice de dónde sale; y al retirar la caché de lo generado la respuesta **deja de poder ser URLs**, lo que rompe el cliente que `requisitos.md` declara fuera de alcance. Ninguna de las dos me toca decidirla: van abajo como **DECISIÓN TUYA**.

## El problema real, en una frase

Generar el personaje animado de un juego —rig + anims → hoja base → repintado por descripción— es una capacidad completa y autocontenida que hoy vive desparramada en tres proyectos (`tools/` escribe, `nefan-html/public/` almacena, `ai_server/` lee) y pegada con **una ruta de disco** (`ai_server/asset_paths.py:13-14`), no con un contrato. Sacarla a un proyecto propio ataca eso de lleno.

## La premisa, afirmación por afirmación

| Afirmación de `requisitos.md` | Verificación |
|---|---|
| Dos mitades, dos lenguajes, dos costes | **Cierto.** 1.310 líneas / 2 deps npm vs. 542 líneas + endpoint / Meshy + rembg (466 MB de onnxruntime) |
| «~350 PNG en ~3 s» | **Casi.** Medido ahora: `y_bot/idle` = **352 PNG en 8,57 s** (6,9 MB), arranque de Chrome incluido. Gratis y determinista, sí |
| El skin cachea en `cache/sprite_sheets/{key}/` | **Cierto, y es la caché mayor del repo**: **624 MB** — 133 hojas con `meta.json`, **45 directorios sin `meta.json`** (intentos fallidos que nadie barre) y `heroes/` (59 MB, 50 retratos) |
| Consumidores y satélites listados | **Ciertos, y falta uno**: `nefan-html/src/ui/style-apply.ts:399` (batch del título) pide skins por su cuenta; `qa/guiones/07-npc-clave-del-skin.mjs` existe para candar que las **dos** vías deriven la misma clave, o el personaje se cobra dos veces |
| `style_id`/`style_role` contra los packs de ne-fan | **Cierto** (`ai_server/style_packs.py:101-141`) |
| FBX gitignorados por licencia | **Cierto y mayor**: `.gitignore:58-59` deja fuera **1,5 GB** (20 modelos + 71 MB de anims), y `.gitignore:53` deja fuera **las hojas ya renderizadas** — el repo trata el render como derivado no redistribuible |
| «la mitad que cachea es la cara» | **Cierto, y la barata no cachea nada**: se indexa por ruta `{model}/{anim}/{angle}` (`render.mjs:259`), sin `fps`, sin tamaño, sin nº de direcciones. Un `--fps 24` **pisa en silencio** la hoja de 12 fps |
| `#216`/`#217` vivos en esta superficie | **Ciertos**, y los dos ya reencuadrados y sin implementar |

- **El punto 4 no conserva un comportamiento: lo crea.** «Caché de los `y_bot` con su configuración» es capacidad nueva, y arregla de paso ese sobrescrito silencioso. Esa mitad de la petición es barata y es mejora neta.
- **La entrada «ángulos» nace con un default muerto**: el endpoint usa `isometric_30` (`routers/remote_generation.py:234`, `sprite_skin_meshy.py:301,348`), vista retirada en agosto. La base solo soporta `frontal_8` (`render.mjs:77`) y el cliente solo pide ese (`style-apply.ts:51`): una petición sin `angle` hoy da 404.

## La frontera son LAS DOS mitades — cuatro comprobaciones, no una preferencia

1. **Hoy no hay interfaz entre ellas, hay una carpeta**: `SPRITE_SHEETS_DIR = nefan-html/public/sprites`. El Python lee la salida de un CLI de Node desde el directorio estático del cliente web. Llevarse media mitad no elimina ese acoplamiento: lo convierte en red.
2. **Tu lista de entradas es el juego de flags de la mitad base**: `--angle --fps --width/--height --directions --anims` (`render.mjs:104-116`); el «ángulo» son tres números (`page.mjs:29`). Y «una o varias imágenes de referencia» es la entrada de la mitad skin. Una petición, dos mitades.
3. **El punto 4 solo tiene sentido con las dos dentro**: si se fuera solo el skin, el `y_bot` cacheado no sería suyo; si se fuera solo la base, no habría «imágenes generadas» que no cachear.
4. **Nadie automatiza hoy la mitad base**: `render.mjs` no lo llaman ni `start.sh`, ni `qa/run.mjs`, ni el CI. Es un tool manual cuya salida vive gitignorada en la máquina de quien lo corrió.

## DECISIÓN TUYA nº 1 — de dónde salen el rig y los clips

Restricción legal, no técnica, y es la que más forma le da al producto. `assets/characters/mixamo/README.md`: Adobe no permite redistribuir los FBX/GLB, y el repo extiende esa cautela al render (`.gitignore:53`). Tu lista de entradas **no incluye el modelo con esqueleto ni las animaciones**: «la caché de los `y_bot` que genere» da por hecho que el servicio ya los tiene. Eso es justo lo que la licencia bloquea cuando el consumidor es **otro proyecto**, y más fuerte en el escenario «servicio aislado».

Las tres formas legales que existen —no elijo, las nombro—: **(a)** el rig y los clips los sube quien llama, y el servicio no posee assets de personaje; **(b)** el servicio trae un juego propio con licencia para redistribuir, que no será Mixamo, y entonces **cambia el aspecto de todos los personajes de ne-fan**, porque las hojas base son el cimiento de lo demás; **(c)** Mixamo se queda y el servicio es privado a tus proyectos: cumple «lo va a usar otro proyecto», descarta «servicio aislado».

Sin esta respuesta el arquitecto no puede escribir el contrato: (a) obliga a que subir un rig sea parte de la petición y a que la clave de la caché de `y_bot` sea el **hash del fichero**, no el nombre.

## DECISIÓN TUYA nº 2 — dónde vive lo generado cuando el servicio deje de guardarlo

No reencuadro el punto 4. Lo que `requisitos.md` **no dice** es si lo cachea **quien llama**, y ese silencio tiene precio medido:

- Un personaje completo (idle+walk+run) = **24 atlas + 1 hero = $6,14** (medido sobre los 40 personajes completos que hay en caché, `gpt-image-2` a $0,24/llamada).
- Lo que hay hoy son **1.054 llamadas**: **$207,36** declarados en los propios `meta.json`; **$252,96** regenerarlo al modelo actual.
- Y eso **con la caché encendida**: en `cache/spend/events.jsonl` los sprites son **$19,92 de $36,58** — el **54 % de todo el gasto en IA que este repo ha registrado jamás**.

Ne-fan ya tiene dónde ponerlo: el asset-store (`:8767`, SQLite, pins y keep-list) guarda todo lo demás que se paga y ya sirve estas rutas (`services/asset-store/http-server.ts:149`), así que mover la caché al llamador no inventa nada. Pero si la respuesta es «nadie la cachea», **cada sesión vuelve a pagar $6 por NPC**, y eso se dice antes, no en QA.

**Consecuencia forzada, y aquí choco con «fuera de alcance»**: hoy la respuesta son *URLs dentro de esa caché* (`frame_urls: ["/cache/sprite_sheet/{key}/dir_0_frame_000.png", …]`) que el cliente resuelve contra el asset-store (`sprite-renderer.ts:152-166`). Un servicio que no guarda lo generado **no puede devolver URLs a nada**: devuelve imágenes. Eso cambia el wire y el cargador del cliente. **«No tocar el renderer del cliente» no es alcanzable** junto al punto 4.

## Qué se pierde al genericalizar el estilo: menos de lo que parece

`resolve_character` aporta tres cosas: la **imagen**, el **`style_token`** (texto pegado al prompt del hero, `sprite_skin_meshy.py:383-386`) y el **`content_hash`** (que entra en la clave de caché). Solo el `style_token` es pérdida real: el `content_hash` muere con la caché que ya se retira, y la resolución del pack (fallback a la primera ref, saltar imágenes aún no generadas, nunca cruzar de carpeta) es semántica **de ne-fan** y debe quedarse aquí — el motor ya elige la ref por NPC (`npcSkinStyleRef`) y solo tiene que mandar el resultado. El motor **puede vivir sin ello** si el contrato genérico acepta, junto a las imágenes, una **cláusula de estilo en texto libre**. Transporte: la ref viaja una vez por personaje (el hero la absorbe y las direcciones la heredan, `sprite_skin_meshy.py:506-515`), 158 KB–2,5 MB. Despreciable.

## El día después

- **Se rompe el retrato de diálogo.** `portrait.ts` pinta el hero leyéndolo de la caché privada del skin, y `hero_key()` es función de módulo justo para consultarlo sin `MESHY_API_KEY` (`sprite_skin_meshy.py:296-317`). El hero **es una imagen generada**: con el punto 4, o el servicio lo devuelve como salida y ne-fan lo guarda, o se pierden los retratos.
- **`remote-gen` (S5) adelgaza y sobrevive**: se lleva `sprite_skin_meshy.py` y `remote_generation.py:186-323`, conserva `/generate_surface_atlas`. `docs/microservices/` declara hoy que los sprite sheets son de S5: queda mintiendo el mismo día y se corrige con el cambio.
- **`#216` mejora**: la lista de modelos del título **puede** ser cierta por primera vez si el catálogo lo posee un servicio en vez de una carpeta gitignorada. **`#217` puede quedarse sin sujeto**, pero solo si las hojas base dejan de servirse desde `nefan-html/public/sprites`; si ne-fan las sigue sirviendo ahí, sigue vivo igual.
- **`labs/skinning/` (39 MB) se va CON el servicio**: es el banco donde se validó el pipeline y sus lecciones están hormigonadas en `ATLAS_MAX_CELLS`, `ANIM_PROFILES` y `ATLAS_ECHO_THRESHOLD`. Sus `runs/` son material de sesión: confirmación tuya antes de borrar.
- **`comparar.py` no es un satélite, es la red del traslado**: es lo único que demuestra que las hojas del servicio nuevo son las de hoy (tolerancias en su `README.md:54-56`). Se usa **durante**, no después.
- **`fake-ai-server.mjs` sigue igual** (sirve frames de `paladin` desde disco, `:612-638`), pero si el wire pasa de URLs a imágenes hay que actualizarlo o se cae el bench sin créditos, que es lo único que sostiene los guiones 07 y 13.
- **Lo que parecerá arbitrario en un mes**: que `BASE_MODEL = "y_bot"` siga escrito a mano en el cliente (`character-sprites.ts:18`) cuando el modelo base sea propiedad de otro proyecto.

## Conflictos

- **`#212` queda ANULADA si esto se hace.** Su trabajo vivo es meter `tools/render-sprite-sheets/fbx-anim-span.test.mjs` en el CI de ne-fan; si ese directorio se va, el test se va con él. **Hacer `#212` antes es tirar el trabajo**: ciérrala o congélala al decidir esto.
- **`#216`**: su solución reencuadrada es «derivar la lista de lo que hay en disco», y esta tarea mueve ese disco. No contradice, pero hacerlo antes es escribir la derivación dos veces.
- **`#236`** (cortacircuitos de skins por sesión) vive entero en el cliente y no colisiona: antes, durante o después. **`#241`** toca otra superficie. **Operativo**: la rama `fix/arranque-del-cliente` está viva y toca `nefan-html/src/`; ningún fichero de esta tarea está en su diff, pero conviene que aterrice antes de escribir.

## Coste contra valor

**No hacer nada** es defendible un tiempo: ne-fan funciona, los 624 MB están pagados y la extracción no le da al jugador ni un frame. Lo que se paga por esperar es que la superficie se siga enredando: ya van tres tareas en cola tocándola. Lo que lo justifica hoy no es la limpieza, es el motivo que diste: **hay un segundo consumidor**. Y la mitad base es el mejor candidato a extracción de este repo —1.310 líneas, dos dependencias, cero imports de ne-fan más allá de rutas, determinista y gratis—; la mitad skin es la cara de mover y la que arrastra las decisiones difíciles.

**Lo que NO hay que hacer**, escrito para que no vuelva por la puerta de atrás: rediseñar el pipeline de skinning, cambiar de proveedor, tocar `ANIM_PROFILES`/`ATLAS_MAX_CELLS`/el umbral de eco, o «aprovechar» para arreglar `#216`, `#217` o `#236`. Y **no empezar por la mitad skin**: es la que menos se puede especificar hasta que respondas la decisión nº 1.

## Qué le cambiaría a `requisitos.md`

> **Alcance de la frontera (verificado):** el proyecto independiente son **las dos mitades**. Hoy no las une un contrato sino la ruta `nefan-html/public/sprites`, que el Python lee del directorio estático del cliente; separar solo una convierte ese acoplamiento en una llamada de red.

> **Origen del rig y de los clips (pendiente de decisión del usuario):** el `y_bot` y las animaciones son assets Mixamo que Adobe no deja redistribuir, y por eso están fuera del repo (1,5 GB, `.gitignore:58-59`). La lista de entradas está incompleta hasta decidir si el rig y los clips **los sube quien llama**, si el servicio trae un juego propio con licencia para redistribuir, o si queda privado y se renuncia al escenario «servicio aislado».

> **Alcance de la caché (aclaración del punto 4):** el servicio no guarda las imágenes generadas. Queda por decidir si **ne-fan** las guarda en su asset-store: con caché de llamador el coste es el de hoy; sin ella, cada sesión vuelve a pagar **$6,14 por personaje** (medido). Como consecuencia directa, la respuesta deja de poder ser una lista de URLs a su propia caché: devuelve imágenes. **Eso obliga a tocar el cargador del cliente** (`sprite-renderer.ts:152-166`) y `labs/narrative/fake-ai-server.mjs`, que salen de «fuera de alcance».

Y un ajuste en «Estado de hoy»: la mitad base **no cachea nada** —se indexa por `{model}/{anim}/{angle}`, sin `fps` ni tamaño—, así que el punto 4 no conserva comportamiento: lo crea, y arregla que hoy dos configuraciones distintas se pisen en silencio.
