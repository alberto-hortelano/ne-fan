**#216 · REENCUADRADA** — la sospecha de `requisitos.md` se confirma, la disyuntiva del issue se disuelve, y **no es dirección de producto: no se escala.**
**#217 · REENCUADRADA** — más obsoleto de lo que se creía: los CUATRO caminos del cliente ya fallan fuerte. Lo único vivo es el falso verde de herramienta.

## El problema real, en una frase

**#216** — Ofrecer un modelo no es consecuencia de tener su hoja: la lista está escrita a mano en tres sitios que no coinciden, y **ninguna lista commiteada puede ser cierta**, porque tanto las hojas (`.gitignore:53`) como los FBX de origen (`.gitignore:59`, licencia Mixamo) viven fuera del repo.

**#217** — Bajo `/sprites/**` el dev server hace que `r.ok` no pueda ponerse rojo, así que cualquier comprobación futura nace en falso verde. Ya cobró una.

## La trampa de #216: no, no le quita ninguna capacidad al jugador

1. **La capacidad no existe hoy.** `main.ts:125-136` intenta las 10 anims del modelo elegido y al primer fallo cae a `y_bot` con una línea de log. Elegir `paladin` **ya** te da el maniquí. El desplegable ofrece 1 opción real y 6 que producen una entrada en el error-log. Derivar la lista retira 6 mentiras y 0 capacidades.
2. **Derivar SUBE el techo, no lo baja.** `assets/characters/mixamo/` tiene 20 modelos en esta máquina (akai, brute, dreyar, erika_archer, mutant, nightshade, pete…); la lista a mano corta en 7. Con una lista derivada, correr `render.mjs --models drake` hace aparecer a Drake solo. Lo que cierra la puerta a la «opción 1» del issue es la lista a mano, no la derivada — por eso las dos salidas del issue no son alternativas: son ortogonales.
3. **Ninguna lista fija puede ser cierta en dos máquinas.** Hojas y FBX son per-máquina. Una lista a mano está garantizada a mentir en alguna máquina; una derivada no puede. Eso convierte esto en un bug de corrección, no en una elección de producto.

**El matiz honesto, que no cambia el veredicto:** con `character_mode: "vector"` (sin skins IA — `render-mode.ts:40-47`, conmutable en caliente desde el menú dev) el modelo base ES la única personalización, y ahí un desplegable de un elemento se ve pobre. Pero eso es exactamente lo que el jugador tiene hoy; el cambio lo hace visible en vez de silencioso. Y con `character_mode: "image"` el modelo elegido es además **irrelevante**: los skins se generan SIEMPRE sobre `y_bot` (`character-sprites.ts:249`, `skinKey(BASE_MODEL, prompt)`), así que en cuanto la hoja del skin está lista el `model_id` desaparece del dibujo (`main.ts:1815`).

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| #216 el desplegable lista 7 modelos | **Cierto** — `nefan-html/src/ui/title-screen.ts:73-81`, pintado en `:1022` |
| #216 en disco solo `y_bot` (10 anims) y `paladin/idle` | **Cierto** — `ls nefan-html/public/sprites/` |
| #216 `public/sprites/` está gitignorado | **Cierto** (`.gitignore:53`). **Añado**: `assets/characters/` también (`.gitignore:59`, «license prohibits redistribution»). Ni las hojas ni su fuente están en el repo |
| #216 «lista escrita a mano» (sospecha de requisitos) | **Cierto y peor**: hay TRES y discrepan — `title-screen.ts:73`, `tools/render-sprite-sheets/render.mjs:73` (`DEFAULT_MODELS`, los mismos 7) y `nefan-core/src/narrative/narrative-state.ts:72`, cuyo defecto es **`"pete"`**, que no está en ninguna de las dos y no tiene hojas — con test que lo fija (`narrative-state.test.ts:113`) |
| #216 «elegir otro falla y la partida sigue con el maniquí» | **Cierto, y es deliberado**: `main.ts:131-135` documenta «ya no es un error: el skin IA es la vía canónica de personalización» |
| #217 Vite responde `index.html` con 200 | **Cierto** — `nefan-html/vite.config.ts` no tiene `appType`, ni plugin, ni middleware |
| #217 opción 2, «que el cargador valide el content-type» | **YA HECHO en los dos lectores**: `sprite-renderer.ts:222-224` y `portrait.ts:147-148` |
| #217 «hoy lo hace por accidente, al reventar el `JSON.parse`» | **FALSO.** Es un check explícito que nombra a Vite en su propio comentario (`sprite-renderer.ts:220-224`) |
| #217 (requisitos) «desde el commit `0308c8b`» | **A medias**: `0308c8b` trae el de `sprite-renderer`; el de `portrait` es `3a0f517` |
| #217 (requisitos) «lo vivo es el PNG con `new Image()` sin `onerror`» | **FALSO.** No hay `onerror`, pero sí su equivalente y es fail-loud: `sprite-renderer.ts:319-323` lanza con `img.complete && naturalWidth === 0` («404/MIME error»), y el busto del retrato dibuja por ese mismo `pickImage` (`portrait.ts:176`). Los cuatro caminos —2 `meta.json` + 2 PNG— están cubiertos |
| #217 «cualquier comprobación futura con `r.ok` será falso verde» | **Cierto, y es lo ÚNICO vivo** — `qa/guiones/13-personajes-animados.mjs:41-46` lo lleva escrito como comentario y lo esquiva a mano |

## El día después

**#216.** El jugador ve un desplegable que solo ofrece lo que su máquina puede pintar; en una máquina recién clonada es un elemento, y en la de quien corra `render.mjs --all`, siete o veinte. Nada se vuelve más difícil salvo *anunciar* un modelo antes de tener su hoja, que es lo que se quiere impedir. **Hay que borrar `MIXAMO_MODELS` entero**: si sobrevive «por si acaso» quedan dos fuentes y la mentira vuelve. **Lo que NO se puede tirar es el fallback de `main.ts:125-136`**: el resume confía en el `appearance` del save verbatim (`main.ts:2417-2419`) y los saves son portables mientras las hojas no lo son, así que un save de otra máquina seguirá pudiendo nombrar un modelo sin hojas. Lo que dentro de un mes parecerá arbitrario es que el defecto del estado siga siendo `"pete"` (`narrative-state.ts:72`), un modelo que ya no aparecerá en ningún sitio.

**#217.** Un estático inexistente bajo `/sprites/**` responde 404, `r.ok` recupera la capacidad de ponerse rojo, y el guion 13 puede tirar su comentario-workaround. **Lo que no se toca son los checks de content-type**: siguen protegiendo el build de producción y el asset-store, donde Vite no está.

## Conflictos

- **#212** («los tests de `tools/render-sprite-sheets` no los corre nadie») toca el mismo fichero que #216: `render.mjs:73`. Solapamiento leve, sin orden obligado — pero quien mueva `DEFAULT_MODELS` debe citarlo, o deja el tooling sin red.
- **#173 / rama viva `feat/contrato-entity-npc`**: no colisiona. Va de cómo se VISTE un NPC (`style_ref`/`role`), y los NPCs usan siempre `BASE_MODEL` (`character-sprites.ts:209`). Sí corrobora la dirección: la personalización canónica es el skin, no el modelo Mixamo.
- **`CLAUDE.md`, pre-producción**: apoya borrar las 6 opciones muertas el mismo día, no documentarlas como conocidas.
- Sin conflicto con `arch-rules.json` ni con `git log` reciente.

## Coste contra valor

**#216** — barato (una lista en un fichero del cliente, más una forma de saber qué hay en disco). No hacer nada **no es neutral**: la mentira está en el editor de personaje, la primera pantalla que ve el jugador, y cada playtest la vuelve a descubrir — ya la descubrió H7. Vale.

**#217** — el trabajo del cliente ya está pagado; lo que queda es el dev server y limpiar un guion. Es el más barato de los dos y el que más protege hacia adelante. No hacerlo es aceptar que ninguna comprobación bajo `/sprites` puede ponerse roja, que es el fallo que este repositorio persigue con candados (`feedback_verde_que_no_comprueba`). Vale.

**Fuera de alcance, confirmado:** generar y versionar las ~70 hojas NO es la única salida, ni es salida en absoluto — `assets/characters/` está gitignorado por licencia, así que ni el generador se puede correr en CI. No se escala al usuario.

## Qué le cambiaría a `requisitos.md`

Sustituir la sección **#216** por:

> El desplegable de modelo base está escrito a mano en `title-screen.ts:73-81` y no lo alimenta nada. Las dos salidas del issue no son alternativas: las hojas son per-máquina (`.gitignore:53`) y sus FBX no se redistribuyen (`.gitignore:59`), así que **ninguna lista commiteada puede ser cierta**. Ofrecer un modelo debe ser consecuencia de tener su hoja; generar hojas sigue siendo posible después y las hará aparecer solas. No se escala al usuario: hoy 6 de las 7 opciones caen a `y_bot` en silencio (`main.ts:125-136`), así que derivar la lista no le quita ninguna capacidad al jugador. **Borrar `MIXAMO_MODELS`; conservar el fallback de `main.ts:125-136`**, que sigue teniendo sujeto por los saves portables. Reconciliar el defecto `"pete"` de `narrative-state.ts:72` (y su test en `narrative-state.test.ts:113`). Citar #212 si se toca `render.mjs:73`.

Sustituir la sección **#217** por:

> El cliente **ya no es el problema**: los cuatro caminos fallan fuerte — `meta.json` valida content-type en `sprite-renderer.ts:222-224` y `portrait.ts:147-148`, y los PNG lanzan en `sprite-renderer.ts:319-323` con `naturalWidth === 0`, por donde también pasa el busto del retrato. Lo vivo es solo la última frase del issue: bajo `/sprites/**` `r.ok` no puede ponerse rojo, y `qa/guiones/13-personajes-animados.mjs:41-46` lo esquiva a mano con un comentario. El trabajo es que ese estático inexistente devuelva 404, y que el guion pueda dejar de esquivarlo. **No tocar los checks de content-type**: protegen el build y el asset-store, donde Vite no está.

En **criterios de aceptación**, cambiar el primero por: «El desplegable ofrece exactamente los modelos con set completo de hojas en esa máquina, y el que se elige es el que se pinta». En **fuera de alcance**, añadir: «Generar y versionar hojas queda descartado por el crítico, no aplazado: `assets/characters/` está gitignorado por licencia». En **preguntas abiertas**: ninguna.
