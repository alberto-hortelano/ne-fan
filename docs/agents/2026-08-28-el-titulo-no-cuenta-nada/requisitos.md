# El título no cuenta nada de lo que pasa

> **Reescrito el 2026-08-28 tras la crítica.** La primera versión agrupaba SEIS issues sobre
> una premisa mía que resultó falsa. Quedan **cinco**, y dos de ellos bajan a core. Lo tachado
> no se borra: está en `critica.md`, con la medida que lo tumbó.

## 1 · La petición, literal

> «Se esta ejecutando muation con scene-normalize, por donde seguimos mientras tanto?»

Y, elegida entre tres candidatas:

> «Paquete del título (recomendado)» — #278 + #285 + #282 + #250 + #251 + #269

Dos decisiones más del usuario, tomadas al leer la crítica:

> **#282** — «La honesta: sellar la sesión (recomendado)»
> **#278** — «Comentar lo que ya funciona y cerrarlo (recomendado)»

## 2 · Lo que quedó de los seis

**#278 está CERRADO** (2026-08-28): sus tres criterios ya se cumplían. El caso que describía
—«el remedio está escrito en el panel que esa pantalla esconde»— lo arregló `376dbaa`, la PR
#277, **la misma que el issue citaba**, 2 h 20 min después de escribirse. Lo que sí sigue
invisible se fue a **#306**, escrito sobre lo que de verdad falta, y **no es de esta tanda**.

| Issue | Qué se hace | Dónde vive |
|---|---|---|
| [#282](https://github.com/alberto-hortelano/ne-fan/issues/282) | El tile de una sesión muerta se instala igual | **core** (bridge + `session-facets`) |
| [#269](https://github.com/alberto-hortelano/ne-fan/issues/269) | El selector nombra la ruta del glob, y una rama es código muerto | cliente + **core** (`status-labels`) |
| [#250](https://github.com/alberto-hortelano/ne-fan/issues/250) | El panel de dev mueve «Nueva partida» al rellenarse | cliente |
| [#251](https://github.com/alberto-hortelano/ne-fan/issues/251) | La columna se corta sin señal de que haya más | cliente |
| [#285](https://github.com/alberto-hortelano/ne-fan/issues/285) | `H` abre un libro de cero píxeles: tecla muda | cliente |

## 3 · Premisas, corregidas y medidas (2026-08-28, `695edeb`)

Lo que sigue está verificado contra el código. **Donde contradiga a un issue, manda la medida.**

- **«#278 y #285 son la misma línea» era FALSO** (mío, y lo di por verificado). `dev-ui.css:102`
  y `:103` son **dos selectores sobre dos elementos independientes**: `#error-log` está en
  `index.html:142`, **hermano** de `#app-shell` (`:86`), fuera de `#game-ui` (`:89`). Y ninguna
  de las dos soluciones propuestas editaba esa regla.
- **El libro SÍ vive dentro de `#game-ui`** (`history-browser.ts:47`) y a propósito: fuera de
  ese árbol no ve los tokens `--nf-*`, que `theme.ts:36-40` escribe en `#game-ui` y **no** en
  `:root`, para que un pack subido por un jugador no pueda tematizar la UI de dev. Sacar el
  libro de ahí le quita el tema.
- **#250 — el criterio original NACÍA VERDE.** `62e96be` (2026-08-24 17:57, **ocho horas**
  después de abrirse el issue) cambió el suelo a `min(160, max(96, round(innerHeight*0.2)))`.
  Con los `devBottom` que midió QA: a `innerHeight=800` el salto es **0 px**; reaparece a
  **≤480**. Hay **una** fórmula (`title-screen.ts:387-388`) con tres disparadores (`:191`,
  `:312`, `:354`): arreglar la fórmula los cubre los tres. Y el comentario de `:379-386` ya
  avisa de que ese suelo **tapa** el issue sin arreglarlo — hay que hacerle caso.
- **#251 — el scroller no es la lista.** `#ts-sessions` solo lleva `margin-bottom` (`:402`);
  quien recorta es `this.content` (`max-height:100%; overflow-y:auto`, `:219-224`) y se lleva la
  **columna entera**. Los 672 px del issue son del mismo `62e96be` en dirección contraria: hoy
  son **608**, o sea que corta antes.
- **#269 — la rama `!loader` es INALCANZABLE.** Un solo llamante (`main.ts:1390`) con
  `sceneSelector.value`, y las opciones salen de `populateSceneSelector` (claves de
  `sceneModules`) más el `-- Room --` vacío, cortado por `if (!value) return`. Traducirla es
  pulir un cadáver: **se borra**. El fallo vivo que el issue no ve: esa rama hace `log(); return`
  —o sea **resuelve**—, así que el `alFallar` de `paso()` no corre y el `<select>` se queda
  nombrando una fixture que no cargó, que es exactamente el «fallo mudo cambiado por uno que
  miente» que el comentario de `:1384-1387` dice querer evitar.
- **#282 — cierto, y su premisa falla en la mitad que importa.** El tile entra en `main.ts:2441`
  sin guarda, después de que `abandonarLaPartida()` (`:2583`) haya hecho `resetWorld()`. Pero
  `broadcastScene` (`nefan-core/bridge/context.ts:232-280`) emite ese `narrative_event`
  **sin id de sesión**, a todos los suscriptores: «de quién es» **no es expresable hoy**.
  Confirmado también que la rama `new_game` de `unIntentoDeArrancar` no llama a `resetWorld()`
  (solo la de `resume`, `:2649`), así que el intento siguiente hereda el mundo del anterior.

## 4 · Criterios de aceptación

1. **#282** — `broadcastScene` **sella la sesión** en el evento y el cliente descarta el tile que
   no es de la suya. Decisión del usuario: la versión honesta, no la guarda barata
   (`session.active`), porque esa deja vivo el caso de abandonar A y arrancar B deprisa. Cierra
   además la segunda mitad: un segundo intento no hereda el mundo del primero. Candado: el guion
   29 convierte su `ctx.log` de `:166-168` en `ctx.expect`.
2. **#269** — la rama muerta **se borra**; el mensaje nombra **la etiqueta que la persona
   eligió** (`zorder_test`), no la ruta del glob
   (`@nefan-core/data/scenes/zorder_test.json`), y el desplegable no se queda mintiendo. La
   decisión de texto baja a `status-labels.ts`, por el precedente literal de sus líneas 22-24.
3. **#250** — **Δ 0 px a 500×480 con 0 saves**, que es donde el mecanismo sigue vivo. A 500×800
   el aserto nacería verde y no podría ponerse rojo. Ningún guion redimensiona hoy
   (`qa/run.mjs:743` fija 1280×800 para todos): es infraestructura nueva de una línea.
4. **#251** — quien tenga más partidas de las que caben **se entera**. La señal va en
   `this.content`, el scroller real. El candado mide que la señal **existe y se ve**, no que la
   columna scrollee (eso ya es cierto y no mide nada).
5. **#285** — **`H` no responde mientras el título está delante.** La otra salida (el libro por
   encima) reabre #246 y le quita el tema al libro: descartada. Decisión del coordinador. Ojo:
   su candado real no es un guion —medir un no-evento da un verde indistinguible de un guion que
   no mide nada— sino que el manejador pregunte a **la misma fuente** que escribe `data-titulo`,
   o sea hacer inexpresable el estado malo.
6. **Del repositorio** — `npm run verify` verde, la deuda sin crecer, y `node qa/run.mjs` entero
   en verde al terminar. El CI **no** corre la batería: la corre quien entrega. Lo que aterrice
   en core necesita objetivo de mutación o exención escrita; `session-facets` (28 mutantes) y
   `status-labels` (~100) están por debajo del `tope_local` de 120, así que se miden en local
   sin pedir permiso.

## 5 · Restricciones

- **El cliente se mantiene ligero**: #282 y la mitad de texto de #269 **son de core**. Los otros
  tres son DOM y CSS sin mitad de core — **no los fuerces a bajar**.
- **#246 no se revierte.** `dev-ui.css:96-100` declara la decisión viva: es un INTERRUPTOR, no
  una lista de widgets. Eximir `#history-browser` lo convierte en una lista y reabre lo cerrado.
- **Español** en todo lo que lee quien juega.
- **Cero compatibilidad hacia atrás**: lo que se sustituye se borra el mismo día. La rama
  `!loader` es el primer caso.
- **La corrida de mutación ya no bloquea.** `33156065300` terminó, y el `traer`/`repartir` está
  hecho y commiteado (`0712349`). El merge no espera a nada.

## 6 · Lo que NO es de esta tanda, a sabiendas

- **#306** (los errores que saltan solos durante el título), heredero honesto de #278. Sin
  candado barato: ningún guion mide una fuente de error que aún no existe.
- **#241** (nada de `nefan-html` está medido). No vuelve prematuro a ninguno de los cinco, pero
  **es la razón** de que tres se conformen con un guion. El mecanismo de #250 ya volvió una vez
  entre la medida y el issue —en la dirección contraria, tapado por un suelo— y nadie se enteró
  en cuatro días. Nombrarlo al cerrar vale más que hacerlo dentro.
- **#268** (`paso()` sin comprobar la promesa), **#224** (el coste de listar saves), **#280**.
  Verificado por el crítico que ninguno colisiona; si #269 borra la rama muerta, `loadSceneFile`
  devuelve siempre una promesa real y #268 no pierde nada.
- Rediseñar la pantalla de título. Son cinco defectos concretos.
