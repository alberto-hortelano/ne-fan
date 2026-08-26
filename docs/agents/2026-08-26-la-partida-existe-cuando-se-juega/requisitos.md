# Una partida existe en disco cuando se ha llegado a jugar (#279)

## La petición, literal

El usuario, 2026-08-26, tras leer el issue #279 y sus tres salidas:

> «sprite-forge lo hare publico mas adelante, no hay problema, De el 279 vamos con la opcion 3»

La opción 3 del issue, textual:

> **No crearlo hasta que el arranque termine.** El más correcto y el que más toca.

Preguntado por dónde cae la frontera de «el arranque termina», el usuario eligió, entre dos
opciones escritas:

> **Cuando el mundo está pintado** — el cliente confirma cuando ya se ha vestido Y ha pintado el
> tile inicial. Un fallo del motor (#189) tampoco deja nada: no existen partidas vacías. Un solo
> predicado, sin flags que combinar. Coste: si el motor tarda 5 min y cierras la pestaña antes,
> no hay save — pero el tile generado NO se repaga, porque el snapshot del mundo del juego sí se
> escribe aparte.

La otra opción, DESCARTADA por el usuario, era confirmar en cuanto el jugador se ha vestido, sin
esperar al mundo (dejaba partidas vacías reanudables tras un fallo del motor).

## Qué se pide, en una frase

Que `saves/{session_id}/state.json` no exista hasta que el jugador esté dentro de la partida
viendo el mundo. Ni antes, ni «marcado como incompleto», ni creado-y-borrado.

## El issue #279, entero

> ## El síntoma
>
> Si `start_session` responde `ok` y algo falla **después** —el caso medido: un clon limpio sin
> hojas de sprite—, la sesión ya está escrita en `saves/{session_id}/state.json` y ahí se queda.
> Cada intento deja otra.
>
> ## Estado real hoy
>
> El daño está **muy reducido** desde la PR #277: el mensaje ya no dice «inténtalo de nuevo», que
> era lo que convertía un save huérfano en una colección de saves huérfanos. Ahora nombra el
> remedio, así que quien lo lee deja de reintentar. Pero el primero se queda.
>
> ## Por qué no cayó en aquella tanda
>
> Porque **no es mecánico**. El mecanismo está escrito y es corto —sacar el `sessionId` fuera del
> `try`, llamar a `deleteSession` en el catch, y darle su propia vía de fallo— pero implica
> **borrar datos del jugador en una vía de error**, y eso es una decisión de producto, no un
> arreglo.
>
> Las tres salidas, para decidir:
>
> 1. **Borrar el save** al fallar el arranque. Limpio, y arriesga borrar algo que el jugador
>    querría si el fallo fuera transitorio.
> 2. **Marcarlo incompleto** y que el título no lo ofrezca, con poda diferida.
> 3. **No crearlo hasta que el arranque termine.** El más correcto y el que más toca.
>
> Sale de la validación de la tanda de los estáticos (2026-08-25), hallazgo H3 de QA.

## Criterios de aceptación (del punto de vista de quien juega)

1. Un clon limpio sin hojas de sprite pulsa «Comenzar», el arranque falla y vuelve al título:
   **no hay ningún directorio nuevo en `saves/`** y «Continuar» no ofrece nada.
2. Una partida que arranca bien se guarda como siempre: el jugador la ve en «Continuar» y al
   reanudarla recupera posición, vida, mundo y entidades.
3. Si el motor narrativo no responde y el jugador se queda sin mundo (#189), tampoco queda una
   partida en la lista.
4. Reanudar una partida existente sigue guardando sin depender de nada nuevo.

## Contexto que el crítico debe verificar o tumbar

Está en el plan aprobado (`/home/al/.claude/plans/federated-spinning-flamingo.md`), y sus dos
premisas load-bearing son:

- **Que el ack del cliente sea la única forma honesta de saber que el arranque terminó.** El
  argumento: con snapshot de mundo pre-generado (`data/games/{id}/world/`, presente para los
  cuatro juegos en la máquina del usuario, gitignorado), `replayWorldSnapshot` registra escenas
  y guarda en el mismo tick en que el cliente aún espera a `baseSheetsReady` — así que un
  criterio server-side («no guardar hasta que haya escenas») dependería del reloj.
- **Que el reintento de resume sin escenas se quede sin sujeto** si dejan de nacer saves con
  `scenes_loaded` vacío.

Y un tercer punto que el plan da por hecho: que `writeSessionSnapshot`
(`bridge/handlers/bootstrap-tile.ts`) preserva el trabajo caro del motor aunque el save nunca
llegue a existir.

---

# Corrección del coste y decisión del usuario (2026-08-26, tras la crítica)

## El dato que estaba mal cuando el usuario eligió

La opción que se le enseñó decía: «el tile generado NO se repaga, porque el snapshot del mundo
del juego sí se escribe aparte». Eso es cierto **por la vía del snapshot pre-generado** y
**falso por la vía del motor vivo**:

- `writeSessionSnapshot` solo corre si `generateBootstrapTileScene` **tuvo éxito**
  (`nefan-core/bridge/handlers/bootstrap-tile.ts:105-115`).
- La reutilización de una respuesta tardía del motor está indexada por `session_id`
  (`ai_server/llm_client.py:324-337`, `_scene_retry_key` → `"{session}:tile_0_0"`): partida
  nueva ⇒ clave nueva ⇒ no engancha ni la respuesta tardía (`_late_scenes`) ni la generación
  en vuelo (`_inflight_scenes`).

Hoy, cerrar la pestaña durante un bootstrap lento y reanudar después sirve la escena **gratis**.
Con esta tanda, se repaga entero. Verificado además por el coordinador: lo que se repaga son
**minutos del motor narrativo (MCP), no créditos de imagen** — el bootstrap no genera imágenes;
las pide el cliente después del broadcast.

## La decisión, literal

Preguntado con el coste corregido delante, el usuario elige:

> **Sí, seguir con la opción 3.** Se renuncia al «reanudar ES el reintento» y se borran las DOS
> piezas que quedan sin sujeto: el reintento de resume (`session.ts:588-619`) y la poda de saves
> vacíos (`session.ts:234-246`). Coste: un bootstrap interrumpido se repaga entero — minutos del
> motor, cero créditos de imagen — y solo en juegos sin snapshot pre-generado, o sea la primera
> partida de un mundo recién creado.

Descartadas explícitamente: mudar la ventana de reintento a memoria (reusar la sesión provisional
desde «Comenzar»), y cerrar #279 sin hacer nada.

## Correcciones de alcance que trae la crítica (vinculantes)

1. **Se borran DOS piezas, no una**: el reintento de resume sin escenas Y la poda de saves
   vacíos de `handleListSessions`. La segunda no estaba en el plan.
2. **No hay «un solo `storage.write`»**: hay dos (`narrative-state.ts:369` y `session.ts:697`).
   El segundo solo pisa un save que acaba de leer y aborta si no existe, así que la conclusión
   se sostiene — pero el candado hay que enunciarlo sobre los dos.
3. **El ack cuelga de que el tile se AÑADA**, no de `installTile`: `main.ts:887` solo corre
   `if (isGridTile && planInfo)` y `composeTilePlan` devuelve `null` con `ground` y `volumes`
   vacíos. Un tile legal pero pelado dejaría una partida que no se escribe nunca.
4. **El criterio 1 se verifica dentro del guion 27**, no en un guion 29 nuevo: el 27 ya produce
   el clon limpio en el borde y ya vuelve al título con aviso. Un guion con `aisla:["saves"]`
   añadiría otra corrida con stack propio a un runner con los puertos clavados (#271, #274).
5. **Existía una alternativa sin tocar el wire** y hay que decir por qué se descarta: `input`
   solo sale con el título oculto (`main.ts:1784`), así que `input` + `scenes_loaded ≠ 0` cubría
   los criterios. Se descarta porque `input` significa «el jugador se movió», no «la partida
   existe»: un refactor que lo mandara desde el título rompería el invariante en silencio.
6. **Quitar el `finally` de `game-gen.ts` quita también un efecto lateral**: `deleteSession`
   resetea `session_id` cuando coincide con la activa (`narrative-state.ts:373-379`). Hay que
   mirar quién lo lee después, no suponerlo.

## Criterio de aceptación 5 (nuevo, de la crítica)

Mientras la partida aún no existe en disco, abrir el libro de historia (tecla `H`) no puede
dejar la sesión viva sin plugins: `history-browser.ts:78-81` hace `resumeSession` de la sesión
activa sin gate, y el bridge vacía `ctx.activePlugins` (`session.ts:489`) **antes** del
`loadSession` que fallaría. Es una regresión alcanzable que hoy no existe.

## Dependencia: #270 entra en la tanda

`comenzar()` (`qa/lib/sesion.mjs:135-144`) da la partida por arrancada cuando llega la escena,
no cuando el título deja de interceptar — que es justo el instante del ack. Sin cerrarlo, esta
tanda fabrica intermitentes en los guiones 14, 17 y 25; cerrándolo, los blinda. Se arregla
dentro de esta tanda y se cierra #270 con ella.
