# Todo hueco admite el cuerpo mayor que puede querer cruzarlo

## Petición

La tarea sale del **backlog**, no de una descripción fresca del usuario. Su mensaje literal fue:

> «vale, se esta ejecutando, por donde seguimos mientras tanto?»

—delegando la elección en el coordinador mientras corre la mutación. Lo elegido es **#289**, que
el coordinador venía recomendando como «el único [issue] que puede encerrar a alguien en una
partida». **Esto importa para el crítico**: la premisa no la acaba de decir el usuario, la
escribió QA el 2026-08-26 y lleva un día en el backlog. Es exactamente el material que se pudre.

Cuerpo del issue #289, citado en lo que fija el trabajo:

> El AABB de un NPC mide **1,0 m**. Un hueco de exactamente 1 m —una puerta de `doors[].w: 2` en
> un volumen `cutaway`— deja pasar al jugador (radio 0,4) y **nunca** a un NPC. Desde #232 el
> bridge colisiona con esos muros, así que un NPC que entre por otra vía queda **encerrado para
> siempre**.
>
> [...] Es el mismo agujero que un cuarto de 5×5 [...] y que un pasillo de una celda. Una sola
> regla derivada, al estilo del `MIN_SEP_TREE` que introdujo la tanda del bosque —**todo hueco
> admite el cuerpo MAYOR que puede querer cruzarlo**— cierra los tres a la vez, y por
> construcción en vez de con tres asertos.

Y el dato que el propio issue subraya como el que importa:

> **Hoy NO ocurre.** BFS con cuerpo desde cada NPC de los 4 mundos base y las 3 fixtures: ni un
> NPC encerrado. La puerta más estrecha del corpus mide 1,5 m.

## Contexto que solo tiene el coordinador

- **Es prevención, no un bug vivo.** Nadie ha visto a un NPC encerrado en una partida. Lo que se
  compra es que no pueda pasar, no arreglar algo que pasa. El crítico debe pesar eso: si la
  conclusión es «prematura», es un veredicto legítimo y barato de aceptar.
- **La CPU local está libre.** La corrida de mutación (~9.100 mutantes, 21 módulos) va en el
  runner de GitHub, no aquí. No hay que contenerse con los tests locales.
- **No hay créditos en juego**: nada de esta tarea toca generación de imagen.

### Lo medido hoy por el coordinador, para que nadie lo repita

Tres sitios razonan por separado sobre «cuánto hueco hace falta», los tres desde el JUGADOR, y
el cuerpo mayor es el del NPC:

| Sitio | Qué dice | Problema |
|---|---|---|
| `src/scene/terrain-collision.ts:23` | `PLAYER_RADIUS_M = 0.4` | exportada, es la que todos consultan |
| `src/simulation/npc-behavior.ts:89` | `NPC_RADIUS = 0.5` | **privada**: el cuerpo MAYOR no sale de su módulo, así que nadie puede derivar de él |
| `src/scene/scene-expand.ts:263` | `Math.ceil(1.1 / mpc)` | **literal mágico** con el jugador en el comentario (`~0.8 m + holgura`). Al NPC le vale por 0,5 m de propina que nadie ató a nada |
| `src/scene/blueprint/volumes.ts:127` | `w: z.number().positive().max(16)` | **sin suelo**: la ruta `volumes` no tiene nada que lo impida |
| `src/scene/scene-validate.ts` (flood-fill) | recorre celdas libres de una en una | **no tiene cuerpo**: no puede ver el problema |

El precedente a imitar está en `src/scene/blueprint/vegetation.ts:53,65`: `PASO_LIBRE_CELDAS` y
`MIN_SEP_TREE` se **derivan** de un radio en vez de escribirse a mano, y `test/vegetation-density.test.ts:103-111`
comprueba la derivación *y* su borde. Ojo: `PASO_LIBRE_CELDAS` también se deriva solo del
jugador — puede ser una cuarta instancia del mismo fallo, no solo el modelo a copiar.

Detalle completo con la tabla de BFS medida: `docs/agents/2026-08-25-el-bosque-es-uno/implementacion.md` §10.3
(no commiteado, vive en el árbol de trabajo).

## Criterios de aceptación

1. **Existe una sola fuente de verdad del cuerpo mayor** que transita el mundo, derivada de los
   radios reales y no escrita a mano. `NPC_RADIUS` deja de ser privado, o la regla vive donde él
   viva; lo que no puede quedar es que el cuerpo mayor sea inconsultable desde el resto del core.
2. **El literal `1.1` de `scene-expand.ts:263` desaparece**: el auto-ensanchado de `structures`
   se deriva de (1). Si el mínimo sube de 3 celdas a 4, el corpus existente lo absorbe o se dice
   explícitamente qué se rompe.
3. **La ruta `volumes` deja de estar desprotegida**: una puerta declarada más estrecha que el
   cuerpo mayor no llega al collider. Ver pregunta abierta 1 sobre rechazar vs. ensanchar.
4. **El flood-fill de `validateScene` tiene cuerpo**: detecta una región inalcanzable para el
   cuerpo mayor, no solo para un punto sin dimensión.
5. **Los tres agujeros de la familia quedan cerrados y medidos**, cada uno con su caso: la puerta
   de 1 m, el cuarto de 5×5 y el pasillo de una celda. Cerrados **por construcción** (una regla
   derivada) y no con tres asertos sueltos, que es lo que pide el issue.
6. **Cada candado nuevo se prueba en negativo**: se demuestra que se pone ROJO con el caso que
   dice impedir. Un candado que no puede ponerse rojo no cuenta como candado — esta semana
   nacieron cuatro que se creían verdes sobre parte de su criterio.
7. **El corpus vivo sigue validando**: los 4 mundos base y las 3 fixtures del selector «Room»
   pasan, y se dice si alguna puerta declarada ha tenido que ensancharse.
8. **`npm run verify` verde** y la deuda sin crecer (`npm run deuda`). Si el módulo cabe en el
   tope local, sus supervivientes muertos; si no cabe, se pide y no se espera.

## Fuera de alcance

- **Cambiar el tamaño de los cuerpos.** 0,4 y 0,5 se quedan como están; esto es sobre quién los
  consulta, no sobre cuánto miden.
- **El pathfinding del NPC.** Que `stepTowards` no se alinee a un hueco estrecho —a diferencia
  del jugador, que apunta a mano— es un problema distinto y no se toca aquí.
- **El despegue de NPCs que nacen dentro de un sólido**: ya resuelto en #290 con `naceEnUnSolido`.
- **Regenerar arte o tiles.** Ninguna clave de caché de imagen debería moverse; si el plan dice
  que sí, es una desviación que hay que declarar.

## Preguntas abiertas

1. **¿Una puerta demasiado estrecha se RECHAZA o se ENSANCHA?** Hoy el repo hace las dos cosas
   según la ruta: `structures` ensancha en silencio (y muta el `width` declarado), `volumes` no
   hace nada. **Suposición por defecto**: fail-loud, coherente con «Fail-loud al modelo» —
   la salida inválida del LLM no se sanea en silencio, se rechaza con un error que diga el mínimo
   y por qué. Eso implicaría **retirar el auto-ensanchado de `structures`**, que es un cambio de
   contrato con el motor narrativo. Que el crítico y el arquitecto decidan si el coste vale, o si
   la coherencia correcta es la contraria (ensanchar en las dos).
2. **¿Entra `gate` en la regla?** Los tres del corpus miden 4-4,5 m, así que no la rozan.
   **Por defecto: sí**, misma regla, porque el argumento es idéntico y dejarlo fuera reabre el
   agujero por otra puerta.
3. **¿El flood-fill con cuerpo es asumible?** Erosionar una máscara de 128×128 antes del BFS es
   trivial en coste. **Por defecto: sí.** Si el arquitecto ve un problema de rendimiento en el
   camino caliente, que lo diga con una medida.
4. **¿`PASO_LIBRE_CELDAS` (vegetación) es la cuarta instancia del mismo fallo?** Se deriva solo
   del jugador. **Por defecto: sí, entra**, porque dos árboles que le cierran el paso a un NPC
   son el mismo agujero con otra forma. Si ampliarlo dispara el coste, que se diga y se acote.
