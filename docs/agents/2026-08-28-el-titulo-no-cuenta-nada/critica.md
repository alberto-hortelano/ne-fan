# REENCUADRADA — el paquete no es un mecanismo con seis víctimas, y dos de los seis no son del cliente

| Issue | Veredicto | En una línea |
|---|---|---|
| #278 | **REENCUADRADO** (roza obsoleto) | Sus tres criterios de cierre ya se cumplen hoy; el tercero lo arregló la PR que el propio issue cita, 2 h 20 min después de escribirlo |
| #285 | **EN CONFLICTO** con #246 | De sus dos salidas, solo una («H no responde») respeta el interruptor que #246 instaló a propósito |
| #282 | **VIGENTE**, pero es de core | Real y sin candado; su premisa falla en la mitad que importa: el mensaje no dice de quién es el tile |
| #250 | **REENCUADRADO** | El criterio 4, tal como está escrito, **nace verde**: a 500×800 el salto ya no ocurre desde 62e96be |
| #251 | **VIGENTE** con corrección de alcance | El scroller no es la lista de partidas, es la columna entera; y el 672 px del issue hoy son 608 |
| #269 | **REENCUADRADO** | Una de sus dos ramas es **código muerto**; el fallo vivo que el issue no ve es que esa rama resuelve y el desplegable miente |

**El problema real, en una frase:** en la ventana en la que el título está delante y algo ya está pasando detrás, el jugador no puede leer lo que ocurre — pero de los seis síntomas, tres ya se leen, uno es de core y dos son CSS.

## La premisa, afirmación por afirmación

**«#278 y #285 son la MISMA línea» — FALSO.** Son dos selectores (`dev-ui.css:102` y `:103`) sobre dos elementos independientes: `#error-log` es hermano de `#app-shell` (`index.html`), no vive dentro de `#game-ui`. Y **ninguna de las dos soluciones que proponen los issues edita esa regla**: #278 construye un canal nuevo dentro del overlay y no la toca. Comparten familia de síntoma, no arreglo. Son dos tareas.

**«El libro vive dentro de `#game-ui`» — CIERTO** (`history-browser.ts:47`), y a propósito: fuera de ese árbol no ve los tokens `--nf-*`, que `theme.ts:36-40` escribe **en `#game-ui` y no en `:root`** para que un pack subido por un jugador no pueda tematizar la UI de dev. `game-ui.css:347-401` estila el libro entero con esos tokens y `game-ui-css-sin-literales-de-color` prohíbe volver a clavarlos.

**«El remedio correcto está escrito en el panel que esa pantalla esconde» (#278) — CADUCADO.** `status-labels.ts:189-194` devuelve hoy «Faltan las hojas de sprites… genéralas con sprite-forge siguiendo docs/assets-de-personaje.md», y eso se pinta en `#ts-error`, **dentro del overlay** (`title-screen.ts:380-386`, vía `aviso`). Llegó en **376dbaa (2026-08-25 22:49)**, la PR #277 — la misma que #278 cita en su primer párrafo — **2 h 20 min después de abrirse el issue (20:29)**.

**Los otros dos casos de #278 también se leen ya.** Bridge caído → `#ts-status` lo dice en español dentro del overlay (`title-screen.ts:449-453`) y `#ts-error` en el botón (`:432`). Portada rota → la tarjeta enseña «⚠ portada no disponible» (`title-screen.ts:1282-1285`, lo pone `vigilarPortadas` `:281-295`) y ya lo candan los guiones 26 y 28. **Lo que sigue invisible** es otra cosa: los errores que saltan **sin que el jugador actúe** — `baseSheetsReady.catch` (`main.ts:196`) en el arranque, `errors.push("config", …)` (`:116`, `:148`, `:334`) y todo lo de fuente `scene`/`render` durante la ventana provisional. Añado un dato que el issue no tiene: `#ts-error` guarda **un** mensaje (`innerHTML` en `:383`, borrado en cada `renderHome` `:398`) y hay **53** `errors.push` en el cliente, muchos con volcado de pila en `detail`. «Alimentarlo con el mismo `errors.push`» y «que lo lea quien juega» son dos cosas incompatibles, y el issue las trata como una.

**«El tile llega por un camino que no comprueba de quién es» (#282) — CIERTO, y la mitad que falta es la cara.** El tile entra en `main.ts:2441` (`spawn_entity`/`scene_init`) sin guarda; `abandonarLaPartida()` (`:2583`) ya hizo `resetWorld()`+`session.leave()`. Pero `broadcastScene` (`nefan-core/bridge/context.ts:232-280`) emite ese `narrative_event` **sin id de sesión**, a todos los suscriptores. O sea: «de quién es» **no es expresable hoy**. El cliente solo puede preguntar «¿hay alguna sesión aplicada?» (`session.active`, `session-facets.ts:134`), que cierra el síntoma medido (`sesión aplicada = ""`) y **no** cierra el caso de abandonar A y arrancar B deprisa. Confirmada también la segunda mitad: la rama `new_game` de `unIntentoDeArrancar` no llama a `resetWorld()` (solo lo hace la de `resume`, `:2649`).

**«#250 tiene tres llamadas» — MEDIA VERDAD.** Hay **una** fórmula (`title-screen.ts:387-388`) con tres disparadores (`:191` resize, `:312` ResizeObserver, `:354` `show`). Arreglar la fórmula los arregla los tres.

**#250: el criterio 4 nace verde, y lo dice el propio código.** QA lo midió contra `paddingTop = max(96, devBottom+10)` con `devBottom` 55 → 110 (`qa.md §6.2`): 96 → 120 = **+24**. El commit **62e96be (2026-08-24 17:57 — 8 h después de abrirse el issue, 09:31)** cambió el suelo a `min(160, max(96, round(innerHeight*0.2)))`. Con los mismos `devBottom` medidos (`node -e`, 30 s):

```
innerHeight=800 → pad 160 → 160   salto=0px      innerHeight=550 → 110 → 120   salto=10px
innerHeight=600 → pad 120 → 120   salto=0px      innerHeight=480 →  96 → 120   salto=24px
```

**A 500×800 con 0 saves el salto es 0 px hoy, sin tocar nada.** El criterio literal de `requisitos.md` es un aserto que no se puede poner rojo — la forma exacta de `feedback_verde_que_no_comprueba`. El comentario de `title-screen.ts:379-386` ya lo advierte con todas las letras («este suelo TAPA el issue #250 … NO porque esté arreglado»); es honesto y hay que hacerle caso. El mecanismo sigue vivo a `innerHeight ≤ 480`. Y es de jugador, no de dev: `DevStatusPanel` se construye sin gate (`main.ts:211`) y `#dev-status` está en `index.html`.

**#251: el scroller no es la lista.** `#ts-sessions` solo lleva `margin-bottom:24px` (`title-screen.ts:402`); quien recorta es `this.content` (`max-height:100%; overflow-y:auto`, `:219-224`) y se lleva la columna entera. Un degradado sobre la lista de partidas iría al elemento equivocado. Además el 672 px del issue está rancio por el **mismo** commit 62e96be, en la dirección contraria: 800−96−32=672 entonces, 800−160−32=**608** hoy. El corte llega antes.

**#269: la rama `!loader` es inalcanzable.** `loadSceneFile` (`main.ts:723`) tiene **un** llamante (`:1390`) con `sceneSelector.value`; las opciones salen solo de `populateSceneSelector` (`:702-720`, claves de `sceneModules`) más el `-- Room --` vacío, cortado por `if (!value) return`. El hook de bench (`:1216-1225`) elige entre las opciones existentes. Traducirla al español es pulir un cadáver, y un guion que la midiera tendría que inyectar un `<option>` falso — un workaround, que en esta casa es un hallazgo. **El fallo vivo que el issue no ve:** esa rama hace `log(...); return;`, o sea **resuelve**, así que el `alFallar` de `paso()` no corre y el desplegable **no revierte** (`:1391-1397`): el `<select>` seguiría nombrando una fixture que no cargó — justo el «cambiar el fallo mudo por uno que miente» que el comentario de `:1384-1387` dice querer evitar. Lo tercero sí es real y es lo que más vale: `:1390` y `:1391` interpolan `value` (`@nefan-core/data/scenes/zorder_test.json`) cuando la etiqueta que la persona eligió es `match[1]` (`zorder_test`, `:707-709`).

## Dónde vive el arreglo: dos de los seis no son del cliente

**#282 → core.** `session-facets.ts` ya es el dueño del «cuál es la sesión vigente», es módulo de mutación (`session-facets`, break 100, 28 mutantes, por debajo del `tope_local` 120: el ingeniero lo mide en local sin pedir permiso). La versión honesta —sellar la sesión en el broadcast— es cambio de contrato de wire en `bridge/context.ts`, y entonces **la tanda toca core** y el merge espera al `traer`/`repartir` de la corrida en vuelo (`requisitos §5`). Hay que decidirlo antes de que empiece el arquitecto, no después.

**#269 (la mitad del texto) → core.** El precedente está escrito y es literal: `status-labels.ts:22-24` — «Vive en core y no en el cliente ni en el bridge por dos razones… el cliente solo pinta, y aquí la decisión se puede PROBAR sin navegador y la mide la mutación». `status-labels` es módulo de mutación (break 100, ~100 mutantes, también por debajo del tope). Qué lee el jugador cuando una fixture no carga es exactamente la misma decisión que `motivoDeSesionParaElJugador`.

Los otros cuatro (#278, #285, #250, #251) son DOM y CSS sin mitad de core. No los fuerces a bajar.

## El día después: qué los sujeta de verdad

Cuatro se sujetan solo con guiones. Cuáles y qué mide cada uno:

1. **#250** → guion 19, bloque nuevo con `ctx.page.setViewportSize({width:500,height:480})`: `#ts-new` en el viewport antes y después de que el panel de dev se rellene. Hoy **ningún guion redimensiona** (`run.mjs:743` fija 1280×800 para todos), así que es infraestructura nueva pero de una línea. Puede ponerse rojo.
2. **#251** → mismo guion, 12 saves: que la señal de «hay más» **existe y se ve**. No que la columna scrollee — eso ya es cierto y no mide nada.
3. **#282** → guion 29: convertir el `ctx.log` de `:166-168` en `ctx.expect`. Es el candado más barato de los seis; el arnés (`window.__nefan.tiles`, `ctx.nefan("sesion")`) ya está escrito.
4. **#269** → guion 24: extenderlo a que el mensaje nombre **la etiqueta** y no la ruta del glob.

Y los dos que **no se pueden candar barato**, con nombre y apellido:

- **#285.** Si el arreglo es «H no responde con el título delante», lo que hay que medir es un **no-evento**: nada se abrió, nada se registró. Un verde ahí es indistinguible de un guion que no mide nada. El único aserto que puede ponerse rojo es que `_visible` siga en `false` y el libro siga midiendo 0 px — que es lo que hace **hoy**. Su candado real no es un guion: es que el manejador de `H` pregunte a la misma fuente que escribe `data-titulo`, o sea hacer inexpresable el estado malo. Eso es diseño, y no es mío.
- **#278.** Lo que quede de él tras el reencuadre es «una fuente de error añadida mañana se lee en el título». Ningún guion mide una fuente que aún no existe; solo mide las tres que a alguien se le ocurran — y las tres que existen hoy ya pasan. Esa es la forma de **#241**, y es la razón por la que #278 parece más grande de lo que es.

Lo que nada de esto impide: el mecanismo de #250 ya volvió una vez entre la medida y el issue, en la dirección contraria (un suelo que lo tapó) y sin que nadie se enterara durante cuatro días. **Lo único que evita que los seis vuelvan es #241, y no está en la tanda.**

## Conflictos

- **#246 (cerrado)** ↔ **#285**: `dev-ui.css:96-100` declara la decisión viva — «Es un INTERRUPTOR y no una lista de widgets… un panel nuevo dentro de `#game-ui` nace ya oculto ahí sin que nadie se acuerde». Eximir `#history-browser` convierte el interruptor en una lista y reabre lo que #246 cerró; sacar el libro de `#game-ui` le quita el tema. Solo la segunda salida del issue («`H` no responde ahí») es compatible.
- **#241**: no vuelve prematuro a ninguno —los seis son candables— pero **es la razón** de que cuatro se conformen con un guion. Nombrarlo al cerrar la tanda vale más que hacerlo dentro.
- **#268** (`paso()` sin comprobar la promesa): toca `async-ui.ts`, por donde pasa #269. **No colisiona**, y si #269 borra la rama muerta, `loadSceneFile` devuelve siempre una promesa real y #268 no pierde nada. No entra.
- **#224**: vecino de #251 pero ortogonal — uno es qué se PINTA con N saves, el otro qué CUESTA traerlos. Hacer #251 antes no encarece #224. No entra.
- **#280**: sin relación. Correcto dejarlo fuera.
- **Corrida de mutación en vuelo** (`33156065300`): deja de ser inocua en cuanto #282 y #269 bajan a core. Es la única consecuencia de calendario del reencuadre.

## Coste contra valor

- **Lo que más paga: #282 y #250.** #282 es un bug real (mundo de una partida muerta en pantalla, heredado por el intento siguiente) y su candado es cambiar una línea de `log` a `expect`. #250 es real para un jugador **y hoy está escondido detrás de un verde circunstancial**, que es el estado más peligroso de los seis: si nadie lo escribe, dentro de un mes alguien cierra el issue citando la medida a 500×800.
- **Lo que menos: #278.** Sus tres criterios ya pasan. Hacerlo como está escrito es construir un canal para los errores que ya se leen. Si no se hace nunca no pasa nada, siempre que quede escrito qué funciona ya.
- **#285**: la salida barata cuesta tres líneas; la cara reabre #246. Salida barata o nada.
- **#251**: hoy no le pasa a nadie salvo a un bench, y el arreglo son minutos. Adelante por barato, no por urgente.
- **#269**: la etiqueta en vez de la ruta vale más que «los dos canales»; la rama muerta se borra, no se traduce.

## Qué le cambiaría a `requisitos.md` (redactado para pegarse)

- **§2, fila de #278** → «Los tres casos que el issue nombra ya se leen en el overlay (medido, 2026-08-28). Lo que sigue invisible son los errores que saltan **sin que el jugador actúe**: `baseSheetsReady.catch` (`main.ts:196`), los `errors.push("config", …)` y todo lo de fuente `scene`/`render` durante la ventana provisional.»
- **§3, primer punto** → sustituir «#278 y #285 son la MISMA línea» por: «`dev-ui.css:102` y `:103` son **dos** selectores sobre **dos** elementos independientes (`#error-log` es hermano de `#app-shell`). Ninguna de las dos soluciones propuestas edita esa regla. Son dos tareas.»
- **§3, tercer punto** → «Hay **una** fórmula (`title-screen.ts:387-388`) con tres disparadores. Arreglar la fórmula los cubre los tres.»
- **§4, criterio 1** → «Que un error del arranque que **no** provoca el jugador (las hojas que faltan al cargar, un `config` incoherente) se lea en el título sin abrir las herramientas de desarrollo. Los tres casos del issue ya pasan y no valen como criterio.»
- **§4, criterio 2** → «`H` **no responde** mientras el título está delante. La otra salida (el libro por encima) reabre #246 y le quita el tema al libro: descartada.»
- **§4, criterio 3** → «Añadir: el guion 29 (`:166-168`) convierte su `ctx.log` en `ctx.expect`. Y decidir explícitamente entre la guarda barata (`session.active` en el cliente) y la honesta (sellar la sesión en `broadcastScene`); la segunda hace que la tanda toque core.»
- **§4, criterio 4** → «**Δ 0 px a 500×480 con 0 saves** (a 500×800 el salto ya es 0 px desde 62e96be y el aserto nacería verde). Ningún guion redimensiona hoy: `run.mjs:743` fija 1280×800.»
- **§4, criterio 5** → «La señal de corte va en `this.content` (`title-screen.ts:219-224`), que es el scroller real; no en `#ts-sessions`. La caja mide **608 px** a 800 de alto, no 672.»
- **§4, criterio 6** → «La rama `!loader` es inalcanzable: se **borra**, no se traduce. Lo que se arregla es que el mensaje nombre la etiqueta elegida y no la ruta del glob. La decisión de texto baja a `status-labels.ts` (core, mutación).»
- **§5, restricciones** → «#282 y la mitad de texto de #269 **son de core**. La tanda toca core y el merge espera al `traer`/`repartir` de `33156065300`.»
- **§6** → añadir: «Se deja fuera a sabiendas el candado genérico del cliente (#241). Cuatro de los seis se conforman con un guion porque no hay otra cosa, y #285 y #278 no tienen candado barato en absoluto.»
