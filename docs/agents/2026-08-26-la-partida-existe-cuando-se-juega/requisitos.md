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
