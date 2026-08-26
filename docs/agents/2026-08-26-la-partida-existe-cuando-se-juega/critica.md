# REENCUADRADA

El problema es real y la frontera que eligió el usuario («cuando el mundo está pintado») se sostiene. Hay que corregir el
**alcance** y **el coste con el que se tomó la decisión**: la frase que se le enseñó al usuario para elegir es falsa en la
vía del motor vivo, y el borrado que el plan da por trivial se lleva un mecanismo que este repo decidió a propósito, en la
dirección contraria, el 2026-07-10.

## El problema real, en una frase

Un arranque que falla después del `ok` deja en el título una tarjeta de partida que nadie jugó — y lo que la deja viva es
el mismo mecanismo que hoy permite reintentar gratis un bootstrap caro reanudándola.

## La premisa, afirmación por afirmación

**P1 · «Un criterio server-side no cubre el caso medido» — VERIFICADA.** `handleStartSession` contesta `session_started`
(`nefan-core/bridge/handlers/session.ts:405-414`) y acto seguido `replayWorldSnapshot` registra escenas y guarda dos veces
(`session.ts:466`, `:468`), mientras el cliente aún espera `baseSheetsReady` (`nefan-html/src/main.ts:2648` → `:118` →
`:130`). Los cuatro juegos tienen snapshot aquí (`nefan-core/data/games/*/world/tile.json`, gitignorado en `.gitignore:81`).
«No guardar hasta que haya escenas» seguiría escribiendo el save del caso medido.

**P1b · «El ack es la ÚNICA forma honesta» — FALSA.** El cliente ya emite una señal con ese significado: `input` **solo**
sale con el título oculto (`main.ts:1784`), y el título solo se oculta al final de `unIntentoDeArrancar` (`main.ts:2723`),
o sea tras vestir con éxito. `input` + `scenes_loaded ≠ 0` cubre los cuatro criterios sin tocar el wire. **No lo
recomiendo** —`input` significa «el jugador se movió», no «la partida existe», y un refactor que lo mandara desde el título
rompería el invariante en silencio— pero el plan debe decir que existía y por qué se descarta, no que no hay nada. Falsa
también su otra mitad: **no hay «un solo `storage.write`»**, hay dos (`narrative-state.ts:369` y `session.ts:697`,
`handleSetRenderMode` sobre partida INACTIVA). La conclusión sobrevive —el segundo solo pisa un save que acaba de leer y
aborta si no existe (`session.ts:691`)— pero el candado hay que enunciarlo así, o nacerá mal escrito.

**P2 · «El reintento queda sin sujeto» — VERIFICADA en la letra; la tarea es MAYOR.** Sin saves de cero escenas,
`session.ts:588-619` es inalcanzable, sí. Pero también lo es la **poda de saves basura** de `handleListSessions`
(`session.ts:234-246`), trece líneas que el plan no menciona y cuyo comentario dice por qué se perdona el save de la sesión
activa: «reanudarla ES el reintento del bootstrap». No es código muerto por accidente: es `1dc55ff` (2026-07-10), una
decisión tomada en la dirección opuesta a esta tanda.

**P2b · Y el borrado NO es gratis.** `_scene_retry_key` (`ai_server/llm_client.py:324-337`) es `session_id:tile_0_0`.
Reanudar la MISMA sesión sirve gratis la respuesta tardía (`_late_scenes`) o se engancha a la generación en vuelo
(`_inflight_scenes`, `llm_client.py:355-385`). Partida nueva ⇒ `session_id` nuevo ⇒ clave nueva ⇒ **el bootstrap se repaga
entero**. Hoy, si el motor tarda cinco minutos y cierras la pestaña, vuelves y reanudas gratis; después de esto, pagas otra vez.

**P3 · «`writeSessionSnapshot` preserva el trabajo caro» — VERIFICADA con dos condiciones.** `persistWorldSnapshots` es
`true` en el bridge real (`bridge/ws-server.ts:97`), el snapshot se escribe ANTES del broadcast
(`bridge/handlers/bootstrap-tile.ts:115`) y es por JUEGO, no por sesión: no depende del save. Pero (a) solo corre si
`generateBootstrapTileScene` **tuvo éxito** (`bootstrap-tile.ts:105-115`) y (b) no cubre el anillo ni el world map de una
sesión a medias. Sostiene el caso feliz; **no el caso que el usuario preguntó**, que es el del motor lento o caído.

## El día después

- **Regresión alcanzable, hoy imposible**: la tecla `H` abre el libro y hace `resumeSession(sesión activa)` sin gate
  (`nefan-html/src/ui/history-browser.ts:51-58`, `:78-81`). En la ventana provisional eso es `session_not_found`, y el
  bridge ya vació `ctx.activePlugins` (`session.ts:489`) ANTES del `loadSession` fallido: la sesión viva se queda sin
  plugins para el motor el resto de la partida.
- **El ack colgado de `installTile` tiene agujero**: solo corre `if (isGridTile && planInfo)` (`main.ts:887`) y
  `composeTilePlan` devuelve `null` con `ground` y `volumes` vacíos (`main.ts:811`). Un tile legal pero pelado = partida que
  no se escribe nunca. Colgarlo de `addTile` lo cierra; el atlas de imagen no bloquea (`main.ts:892` es fire-and-forget),
  así que «pintado» sigue siendo honesto aunque falle remote-gen.
- **Quitar el `finally` de game-gen** (`game-gen.ts:215-223`) quita también su efecto lateral: `deleteSession` resetea `this.session_id` cuando coincide con la activa (`narrative-state.ts:373-379`). Mirar quién lo lee después, no suponerlo.
- **`save()` queda mudo en 12 sitios** durante la ventana provisional. El State API (`onMutation` → `save()`,
  `ws-server.ts:140`) escribe ahí el world map del bootstrap: no se pierde —queda en memoria hasta `establecer()`— pero **el
  orden ack → primera escritura tiene que ser un hecho, no una carrera**, y el guion 17 es el único que se enteraría. Para
  quien juega no cambia nada salvo dejar de ver una tarjeta muerta: deuda declarada bien pagada, no funcionalidad.

## Conflictos

- **#270 · dependencia, no choque.** `comenzar()` espera a `status().scene` (`qa/lib/sesion.mjs:135-144`), justo el instante
  del ack; los guiones 14/17/25 pasan a depender de que el bridge ya lo haya procesado. Cerrar #270 antes blinda los tres;
  después, fabrica tres intermitentes.
- **#271 · #272 · #274.** Un guion 29 con `aisla:["saves"]` añade otra corrida con stack propio a un runner con los puertos
  clavados. **No hace falta aislar**: el delta de `readdirSync(saves)` alrededor del intento cabe dentro del **guion 27**,
  que ya produce el clon limpio en el borde y ya vuelve al título con aviso. Y `arch-rules.json ·
  qa-guiones-sin-espera-por-reloj` obliga a que «no apareció ningún save» cuelgue de un estado (el título con su aviso) y no
  de un tope: el 27 ya lo tiene.
- **#278** toca el mismo `unIntentoDeArrancar`: secuenciar, no fusionar. **#224** se alivia de rebote, no se resuelve. `docs/agents/2026-08-25-el-bosque-es-uno/`: sujeto distinto, sin choque.

## Coste contra valor

«No hacer nada» está mejor de lo que el issue sugiere: la basura está **acotada a un directorio** (los demás los poda
`handleListSessions` en cuanto arrancas otra partida) y es invisible salvo la tarjeta de la sesión activa. Contra eso, la
tarea toca contrato de wire, cliente, core, dos borrados y un guion. **Vale la pena solo si la renuncia al reintento del
bootstrap por resume se toma a propósito.** Si el usuario, sabiendo el coste real, dice «el reintento me importa», la tarea
es otra y más pequeña, y necesita un handle del bootstrap fallido que no sea un save — eso ya no es trabajo mío.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

> **Corrección del coste, 2026-08-26 (crítico).** «El tile generado NO se repaga, porque el snapshot del mundo del juego sí
> se escribe aparte» es cierto en la vía del snapshot pre-generado y **falso en la vía del motor vivo**:
> `writeSessionSnapshot` solo corre si el bootstrap tuvo éxito, y la reutilización de la respuesta tardía está indexada por
> `session_id` (`ai_server/llm_client.py:324-337`). Hoy, cerrar la pestaña durante un bootstrap lento y reanudar después
> sirve la escena **gratis**; con esta tanda, el bootstrap se repaga entero.
>
> **Decisión previa al plan**: esta tanda renuncia al «reanudar ES el reintento» que el repo eligió a propósito en
> `1dc55ff` (2026-07-10). Si la renuncia es aceptable, se borran las DOS piezas —el reintento (`session.ts:588-619`) **y la
> poda de saves vacíos** (`session.ts:234-246`), que también se queda sin sujeto— y la tanda sigue como está. Si no lo es,
> hay que darle al bootstrap fallido un handle que no sea un save: otra tarea.
>
> **Criterio de aceptación 5 (nuevo)**: mientras la partida aún no existe en disco, abrir el libro de historia (tecla `H`)
> no puede dejar la sesión viva sin plugins (`history-browser.ts:78-81` → `session.ts:489`).
>
> **Alcance**: el ack cuelga de que el tile se **añada**, no de `installTile` (`main.ts:887` no corre con un plan vacío); y
> el criterio 1 se verifica dentro del guion 27, sin `aisla` ni stack propio, con el delta de `readdirSync(saves)`.
