# ¿El NPC que huye llega a su objetivo, o no?

## Petición

Del usuario, sobre el issue **#262**, el 2026-08-27:

> «El 262 se vuelve a medir.»

Y hoy, al elegir el orden tras la crítica de #289, escogió **«#262 primero»** sobre el argumento
de que es el mismo síntoma observable —un NPC que no llega a ninguna parte— pero **ocurriendo de
verdad**, mientras que #289 es prevención.

Cuerpo de #262, en lo que fija el trabajo:

> Un mercader ante una pelea a 9 m: `run_speed: 2.8` m/s, objetivo de fuga `perception_radius + 4`
> = **16 m**, desplazamiento real **~1 m en 30 s**. A 2,8 m/s, 30 segundos dan para 84 m.
>
> **Las dos lecturas**: (1) bug de steering — el watchdog de atasco (`STUCK_WINDOW_S = 3` →
> `giveUpMove`) entrando y saliendo contra geometría; (2) es así a propósito, la huida está
> contenida para que el jugador pueda alcanzar a quien huye.
>
> Mirar el sim antes que el guion.

## Contexto que solo tiene el coordinador

### La premisa original ya no se reproduce — y eso NO cierra la pregunta

Los ~1 m en 30 s se midieron sobre el **tabernero empotrado dentro del prop `mostrador`**, lo que
arregló #290 moviéndolo de `[60,52]` a `[79,63]` y añadiendo el candado `naceEnUnSolido`. Un NPC
empotrado en geometría no dice nada sobre el steering.

Re-medido hoy con el NPC naciendo libre (guion 15 sobre `main`):

```
mercader: distancia al punto de la pelea 8.28 → 9.82 m
✔ el mercader HUYE de la pelea
```

**1,54 m de separación**, y el bucle para en cuanto cruza su umbral de 1,5 m — **no agota** el
cortafuegos de 30 s. La forma del fallo que motivó el issue ya no aparece.

Pero eso no contesta nada: `atacarYVer` (`qa/guiones/15-…:194`) **deja de mirar a los 1,5 m**, así
que es incapaz de decir si el NPC llega a los 16 m, si tarda 6 segundos o 60, o si se para a los
2 m. La pregunta del issue sigue abierta *por construcción del instrumento*.

### Hay un desacuerdo entre dos fuentes, y hay que resolverlo

- El comentario del coordinador en #262 (hoy) dice que **la premisa caducó**.
- El **crítico de #289** (hoy, más tarde) lo describe como *«está pasando de verdad»* y *«medido
  en vivo»*, y sobre eso recomendó invertir la prioridad.

Los dos no pueden tener razón. **Parte del trabajo es decidir cuál lo tiene, con una medida.** Si
resulta que no hay fenómeno, el desenlace legítimo de esta tanda es **cerrar #262 con la prueba**,
no fabricar un arreglo.

### El modo de fallo del repo que hay que evitar aquí

Esta semana se han encontrado **tres instrumentos que no medían lo que decían**: el guardarraíl de
créditos que leía de vuelta su propia constante, `atacarYVer` con `.catch(() => null)` sobre el
`waitFor` (#261, **sigue abierto y sin arreglar**), y cuatro candados verdes sobre parte de su
criterio. Un bench nuevo sobre un NPC que huye es exactamente el sitio donde eso vuelve a pasar.

### Operativa

- **La CPU local está libre**: la corrida de mutación (~9.100 mutantes) va en el runner de GitHub.
- **Cero créditos**: esto se mide con `e2e-sin-creditos` / `fake-ai-server`. Nada de esta tarea
  toca generación de imagen, y si el plan dice que sí, es una desviación que hay que declarar.
- **`NEFAN_PORT_OFFSET` ya funciona** desde la tanda de la máquina (`1aa0de1`): un bench puede
  elegir bloque libre sin pisar a nadie.
- Material vivo: `src/simulation/npc-behavior.ts` (`NPC_RADIUS = 0.5` en `:89`, `STUCK_WINDOW_S`,
  `giveUpMove`, `stepTowards`, `blocksMove`/`blocksCircle` en `:656,708`), `qa/guiones/15-*.mjs`.

## Criterios de aceptación

1. **Existe una medida que contesta la pregunta del issue**: un NPC en modo `flee`, ¿alcanza su
   objetivo de `perception_radius + 4` = 16 m? ¿En cuánto tiempo? ¿Y si no llega, dónde se para y
   por qué? La medida se toma **hasta que el NPC alcanza el objetivo o el FSM abandona**, nunca
   hasta un umbral de conveniencia.
2. **El instrumento no puede mentir en verde.** Se demuestra explícitamente que la medida se pone
   ROJA si el NPC no se mueve — y que un error, un timeout o una promesa rechazada **no** se
   colapsan en «pasó». Ver el modo de fallo del repo, arriba: éste es el criterio que más pesa.
3. **La disyuntiva del cuerpo queda resuelta con evidencia**: bug de steering (1) o huida contenida
   a propósito (2). Si es (1), se dice qué lo causa —watchdog, colisión, waypoint— con la traza que
   lo demuestra. Si es (2), se dice dónde está escrita esa decisión en el código.
4. **El desacuerdo queda zanjado**: ¿sigue habiendo fenómeno tras #290, sí o no? Con el número.
5. **Si hay bug, se arregla y se demuestra el antes/después.** Si no lo hay, **#262 se cierra con
   la prueba** y se dice qué se congela para que no vuelva a leerse como intermitencia del guion.
6. **Lo que sea mecánico queda como guion ejecutable** en `qa/guiones/`, de forma que la respuesta
   se pueda volver a obtener sin repetir el razonamiento.
7. **`npm run verify` verde** y la deuda sin crecer. Si el módulo tocado cabe en el tope local, sus
   supervivientes muertos; si no cabe, se pide y no se espera.

## Fuera de alcance

- **#289 entero** (huecos que no admiten un cuerpo). Va detrás de ésta, ya reencuadrado y con su
  alcance recortado escrito en el issue.
- **Rediseñar la conducta de huida.** Si resulta ser (2) —contenida a propósito—, se documenta; no
  se cambia el diseño del juego en esta tanda sin pasar por el usuario.
- **Arreglar #261** (el `.catch(() => null)` de `atacarYVer`). Está abierto y es vecino, pero es su
  propia tarea. Lo que sí entra: no construir el bench nuevo con ese mismo defecto.
- **Regenerar arte o tiles.** Ninguna clave de caché de imagen se mueve.

## Preguntas abiertas

1. **¿Bench propio o ampliar el guion 15?** El comentario de #262 dice «es un bench propio».
   **Por defecto: bench propio**, porque el guion 15 tiene un cometido distinto (que el mercader
   huya, no cuánto) y ensancharlo hasta seguir 30 s a un NPC lo haría lento y frágil para todos.
   Si el arquitecto ve que sale más barato y más honesto ampliarlo, que lo diga con el coste.
2. **¿La medida se toma contra el sim o contra el juego entero?** **Por defecto: el juego real
   desde el arranque** (preset `e2e-sin-creditos`), coherente con «la comprobación final va contra
   el flujo real». Un test unitario sobre `NpcBehaviorSystem` es un complemento útil —y mucho más
   rápido de iterar— pero no sustituye a ver al NPC moverse de verdad.
3. **¿Cuál es el criterio de éxito, si resulta ser (2)?** Si la huida está contenida a propósito,
   ¿cuánto debería alejarse un NPC para que el jugador lo lea como «huye»? **Por defecto: no se
   decide aquí**; se documenta lo que hace y se lleva al usuario.
4. **¿Entra el `footprint` en esto?** El crítico de #289 midió que `footprint` **no se lee ni una
   vez** en `src/simulation/` ni en `bridge/`: todo NPC se mueve como un círculo de 0,5 m.
   **Por defecto: fuera de alcance**, pero si la traza del atasco apunta ahí, es un hallazgo que
   hay que reportar aunque no se arregle.
