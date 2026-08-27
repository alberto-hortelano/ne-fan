# Todo hueco admite el cuerpo mayor que puede querer cruzarlo

> **LEE PRIMERO el «Reencuadre» del final.** El crítico devolvió REENCUADRADA y recortó el alcance:
> tres de los criterios de abajo son no-ops numéricos y uno se apoyaba en un contrato inexistente.
> Lo que sigue vigente y lo que muere está escrito ahí, con la medida de cada cosa.

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


---

# Reencuadre tras la crítica (2026-08-27)

Veredicto **REENCUADRADA**, medido sobre `main`. La crítica entera está en `critica.md`; esto es lo
que cambia el trabajo, y **manda sobre todo lo de arriba**.

## Alcance vigente

Se hacen tres cosas, y ninguna es la que abría el issue:

1. **`NPC_RADIUS` deja de ser privado** (`src/simulation/npc-behavior.ts:89`) y pasa a fuente única
   del cuerpo mayor. Precedente vivo del mismo día: `FLEE_EXTRA_DIST` se exportó en `25e876e` por
   exactamente este motivo — un número que nadie puede consultar acaba copiado a mano y deja de
   proteger nada.
3. **Suelo derivado en el zod para `doors[].w` (`blueprint/volumes.ts:127`) y para `gate.w`
   (`:175`)**: ninguno lo tiene hoy.
4. **El flood-fill de `validateScene` pasa a tener cuerpo** — con las dos condiciones de abajo, que
   son las que deciden si esto vale algo.

## Los criterios que MUEREN, y por qué

- **Criterio 2 (derivar el `1.1` de `scene-expand.ts:263`) → RETIRADO.** A mpc 0,5 ese literal ya
  vale **3 celdas**, que es exactamente el mínimo del NPC: está bien por casualidad, no por
  derivación, pero está bien. Derivarlo no cambiaría ningún número.
  **Se sustituye por una decisión del arquitecto**: `structures` **no está** en
  `data/contract/tools/generate_scene.json` ni en el zod de `scene-schema.ts`; sobrevive por
  `.passthrough()` y por **un** artefacto — una `room` en `data/games/alta_fantasia/world/tile.json`
  redundante con el `building` cutaway del mismo rect. Las opciones son **borrar la ruta entera**
  (línea viva de `CLAUDE.md`: pre-producción, cero compatibilidad) o **dejarla intacta**. Derivarle
  el suelo no está entre ellas.
- **Criterio 5 (cerrar «los tres agujeros de la familia») → RETIRADO tal como está escrito.**
  Enumerar productores es el eje equivocado: `prop`, `rock`, `tower`, `fountain`, `prism`, `custom`
  y `wall` estampan sólidos (`blueprint/collision.ts:270-313`) **sin ninguna regla de separación
  entre ellos**, y dos props a 1,2 m pinzan un paso igual que una puerta estrecha.
  **Se sustituye por**: el candado **no enumera productores**, y su prueba en negativo incluye la
  puerta de 1 m **y un pinzamiento que no sea una puerta** (dos `prop`/`rock` a 1,2 m) — la clase
  que tres constantes no cubrirían.
- **Pregunta 4 (`PASO_LIBRE_CELDAS` de vegetación) → RESUELTA Y CERRADA.** Derivado de 0,5 da 3, el
  mismo valor que hoy. `MIN_SEP_TREE` no se mueve, la curva de densidad no se mueve. Se cambia la
  derivación por coherencia si sale gratis; no hay coste que acotar.
- **Pregunta 1 (rechazar vs. ensanchar) → RESUELTA a medias.** No hay contrato con el motor que
  romper. La decisión se toma **solo para la ruta `volumes`**, y el mensaje del rechazo **debe decir
  el mínimo en metros** (los textos del validador son contrato congelado por
  `test/scene-validate-golden.test.ts`).
- **Pregunta 2 (`gate`) → APLAZADA.** `gate.w` recibe el mismo suelo, pero cualquier cosa sobre su
  **vano** se decide con **#187** delante: su huella declarada y su colisión son disjuntas,
  congeladas en `test/volume-metrics.test.ts:92-124`.

## Criterio 4, ampliado — es el que decide si la tanda vale

Dos trampas medidas, y las dos hunden el criterio si se pasan por alto:

1. **La erosión tiene que ser `floor(2R/mpc)+1` = 3 celdas, NO el AABB (2).** Con 2 celdas, la
   puerta de `w=2` que el collider real bloquea **parece transitable**: el corredor de puerta
   contiene un bloque 2×2 libre. Erosionar por el AABB hace nacer el candado **verde sobre su propio
   caso** — sería el quinto de la semana. La aritmética que hay que reproducir está en
   `terrain-collision.ts:102-113`: el AABB se recorre con `floor()` **inclusive**, así que un hueco
   de *n* celdas admite radio *R* solo si `n·mpc > 2R`.
2. **Hay que DECIDIR LA SEVERIDAD.** Hoy un NPC inalcanzable es **warning**
   (`scene-validate.ts:661`), y los warnings no rechazan: narrative-mcp los rotula «playable, but
   review». Con el flood-fill con cuerpo pero la severidad intacta, **el motor sigue entregando la
   escena que encierra al NPC**. Éste es el cambio de contrato de verdad de la tanda.

**Prueba en negativo obligatoria de los dos**: se demuestra que el candado se pone ROJO con la
puerta de 1 m y con el pinzamiento de props, y que con la erosión de 2 celdas **pasaría** — que es
justo lo que hay que evitar.

## Criterio NUEVO — el residuo que llegó de #262, y que ya ha ocurrido

`validateScene` da veredicto **idéntico** para un tile que empotra un NPC dentro de un prop y para
uno que no:

```
ok: true · 0 errores · npcs 1/1 alcanzables
```

...aunque la celda del NPC sale **sólida** en la máscara (`plan.solid = true`). El motivo es que
`checkNpcsReachable` (`src/scene/scene-validate.ts:652-661`) se conforma con que una celda
**vecina** sea transitable — y aunque fallara, sería warning.

**Esto cambia el carácter de la tanda entera.** #289 se abrió como prevención («hoy no ocurre»);
esto **ya ocurrió**: el tabernero de `alta_fantasia` nació dentro del prop `mostrador`, no se movió
(0,72 m en 60 s, reproducido), y su parálisis se leyó durante semanas como «la huida está rota»,
contaminando #247, #262 y #284. **#290 arregló el dato del bench, no la clase de fallo**: el motor
puede volver a declarar mañana un NPC dentro de un `prop` y el validador lo dará por bueno.

Cae en la **misma función** y en la **misma decisión de severidad** que el criterio 4, así que se
hace aquí. Un NPC que no puede salir de su celda de nacimiento y uno encerrado tras una puerta de
1 m son la misma pregunta.

## Correcciones a datos citados arriba

- «el mínimo interior entrable es 6×6 jugador / **8×8** NPC»: el 6×6 es cierto, el **8×8 es falso**.
  Medido en `cutaway` con puerta `w=4`: a **7×7 entran los dos**.
- **«el cuerpo mayor» es hoy una ficción parcial**: `footprint` no se lee ni una vez en
  `src/simulation/` ni en `bridge/` (0 apariciones), así que una criatura `footprint:[8,8]` —el
  contrato pone `minimum: 1` y **ningún máximo**— se mueve como un círculo de 0,5 m. La fuente única
  del criterio 1 congelaría un número que el contrato ya contradice: **decir esto en el plan**, no
  arreglarlo aquí.

## Vecinos que condicionan

- **#187** delante de cualquier decisión sobre el vano de un `gate`.
- **#203**: poner suelo a `doors[].w` en el zod **sin tocar** `data/contract/prompts/tile_instructions.md:122`
  (`w?=4`) crea exactamente la deriva zod↔prompt que ese issue describe. Van juntos.
- **#298** (nuevo, no de esta tanda): el que huye vuelve a la pelea cada ~10 s porque la huida no
  actualiza `home`.
