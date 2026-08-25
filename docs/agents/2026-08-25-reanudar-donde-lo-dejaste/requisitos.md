# Reanudar te devuelve donde lo dejaste (#245 · #249)

## Petición del usuario (literal)

> Mergea y sigue con el backlog, elige y prioriza proximas tareas y continua de forma
> autonoma, yo voy a estar fuera unas horas, haz cosas que no necesiten de mi feedback y lo
> que surja lo dejas apuntado para que lo vea al final. Ten en cuenta que unas horas mias
> equivalen a varios dias de trabajo de agentes

Instrucción de gobierno vigente de la cola:

> si se modifica uno lo modificas y si se descarta simplemente pasa al siguiente y al final
> revisamos los descartados pero no pares la ejecución de los demás a no ser que tengan
> dependencias y yo tenga que hacer una elección de dirección del producto

## De dónde sale esta tanda (lectura del coordinador, marcada como lectura)

**#245 es el peor bug abierto de la cola desde el punto de vista de quien juega**: guardas la
partida, la reanudas, y apareces en (0,0,0) — que en el tile del bench cae **dentro de la
taberna**. Pantalla negra, sin cielo, encerrado en un volumen. La causa medida es que
**`save_session` no lo emite nadie** desde `nefan-html`: el bridge es el único escritor del
save y snapshotea posición y HP al recibir ese mensaje, que nunca llega.

**#249** viaja con él porque es el otro extremo del mismo ciclo de sesión: tras un fallo
TARDÍO (posterior a `applySessionReady`), el bucle de `runTitleFlow` vuelve al título
conservando `sessionModesApplied`, el tema de UI y `historyBrowser.setSession`. QA lo dejó
anotado como **riesgo vivo y sin medir** porque no encontró forma de provocarlo con el motor
falso.

Es lectura mía: si el crítico mide que no comparten nada más que la palabra «sesión», que los
parta.

## Los cuerpos de los issues

`gh api repos/alberto-hortelano/ne-fan/issues/245` y `/249`. El de #245 trae dos preguntas
explícitas de diseño; el de #249 trae dos caminos. **Ese es el material del crítico**: decidir
cuál, con el código delante, no listarlos otra vez.

## Preguntas para el crítico

1. **¿Sigue rota la premisa de #245 en `main` de hoy?** La tanda del arranque del cliente
   (#181 #189 #180) entró después de que se escribiera el issue y toca `runTitleFlow` entero.
   Verifica que `save_session` sigue sin emisor y que el resume sigue cayendo al origen.
2. **De las dos cosas que propone #245 —quién dispara el snapshot, y el fallback a
   `__player_start`— ¿son de verdad independientes?** El issue lo afirma. Si lo son, la
   segunda es barata y arregla el síntoma peor; dilo, porque cambia el orden del plan.
3. **¿Cuál es el punto de sincronización correcto?** Los candidatos del issue son: al salir de
   la partida, cada N segundos, o al cruzar de tile. Hay un cuarto que el issue no nombra y
   conviene descartar o adoptar explícitamente: que lo pida el bridge. Mira quién tiene el dato
   y quién tiene la autoridad de escritura antes de elegir.
4. **#249: ¿hacerlo provocable o candar la función?** El issue dice que un endpoint de fallo a
   petición en `fake-ai-server.mjs` desbloquearía además otro repro pendiente. Eso lo hace más
   valioso de lo que parece — pero también es superficie de test nueva. Decide.
5. **¿Hay dependencia con #246, #250, #251?** Son los otros tres issues abiertos del título.
   Si alguno se arregla gratis aquí, dilo; si alguno colisiona, ordénalos.
6. **¿Toca el schema del save?** Si sí, es un cambio de contrato y el plan lo tiene que
   declarar. Pre-producción: no hay que migrar nada, pero sí hay que decirlo.

## Freno explícito

Si el arreglo correcto exige decidir **cada cuánto se guarda la partida** de una forma que el
jugador note (por ejemplo, un tirón cada N segundos), para y decláralo. Elegir el punto de
sincronización técnico NO es eso: eso se decide aquí.

## Criterio de terminado

Guardar, salir, reanudar, y **estar donde estabas** — no en el origen, no dentro de un
edificio. Verificado en el flujo real desde el arranque, no en un test de unidad. Y un fallo
tardío que devuelva al título **sin nada pegado** del intento anterior.

---

## Addendum del coordinador, tras la crítica (2026-08-25)

La premisa de #245 está **verificada en vivo hoy** y sigue rota (guion 17 con `--diag`: empieza en
`{0.25, 0, 3.25}`, reanuda en `{0,0,0}`; la captura sale encerrada en un volumen y sin cielo).
Pero el issue apuntaba al dial equivocado y el crítico lo corrige. Los dos issues quedan
REENCUADRADOS y están actualizados en GitHub.

**Decisiones que tomo yo, con su medida delante:**

1. **No es «el cliente no llama a `save_session`».** El bridge ya escribe `state.json` en trece
   sitios y ya tiene la posición viva en `ctx.store.state.player.pos`. Lo que no se refresca antes
   de escribir es `NarrativeState.player.position` **y `player.health`**. El trabajo es que el
   guardado lleve fresco lo que ya tiene delante, y **`save_session` se retira entero** — tipo,
   zod, router, handler, cliente, replay-server y tests, grep a cero, con su línea en
   `campos-retirados-no-vuelven`.
2. **No hay que elegir cadencia.** Los tres candidatos del issue ya guardan. El freno explícito
   **no se dispara**.
3. **El fallback a `__player_start` sale del alcance.** El save nunca viene sin posición
   (`DEFAULT_PLAYER.position = [0,1,0]`): no hay estado del que caer, y fabricarlo sería cambiar
   el contrato para tapar un síntoma que la otra mitad elimina.
4. **#246 entra en esta tanda** (mismo seam por el otro lado; el gancho ya existe en
   `titleScreen.onVisibilityChange`, `main.ts:1995`). **#250 y #251 NO**: son layout de
   `title-screen.ts`, independientes de esto y colisionando entre sí. Van juntos en otra tanda.
5. **El endpoint de fallo a petición de `fake-ai-server.mjs` NO entra aquí**: va con la tanda de
   candados (#231/#248/#247).
6. **#249 es un bug de créditos**, no de estado pegado: el tile que el bridge difunde tras el
   fallo entra por `onNarrativeEvent`, que no está gateado por sesión, y **paga un atlas** con el
   estilo de la partida que no arrancó.

**Para el usuario, anotado y sin frenar la cola**: hoy reanudar te **cura siempre a 100 HP**.
Se arregla con lo mismo, asumiendo que el daño debe persistir. Si no debiera, es diseño de juego
y lo dirá él. **Asume que persiste.**

**Orden en la cola**: esta tanda va **después** de `#248` (que activa `no-floating-promises` en
`nefan-html`, para que cualquier promesa suelta que añadas nazca roja) y es **disjunta** del
bosque: ellos tocan `main.ts` en ~700-1050, tú en ~2450-2600. Quien aterrice segundo, rebasa.

**Criterio de terminado, ampliado**: además de reanudar donde lo dejaste con la vida que tenías,
**los dos caminos de vuelta al título dejan el cliente idéntico** — y ninguno paga una imagen.
