# Crítica de la tanda G — **#616 REENCUADRADA · #618 EN CONFLICTO**

**#616 REENCUADRADA**: el estado sin salida es real y re-medido hoy, pero las tres vías que el issue nombra
no lo producen y la que sí lo produce no la nombra. Cambia el alcance, no el sujeto.
**#618 EN CONFLICTO** con #298 (`juego,futuro`): mismo módulo, misma clase de defecto, etiqueta opuesta. Y
su observable medido no es el que escribe. No cabe en esta tanda como está.

## El problema real, en una frase
**#616** · Hay puntos del mundo desde los que el jugador no puede volver a moverse, y nada comprueba que
el juego no le ponga en uno. *(El rumbo de salida que propone el issue es la mitad de abajo; la de arriba
es que el TELETRANSPORTE del viaje no mira si el sitio está ocupado.)*
**#618** · Un NPC con meta fija anda contra un obstáculo sin llegar nunca. *(El issue lo llama «no rodea»
y propone A\*; lo medido es un ciclo límite, no falta de alcance del abanico.)*

## La premisa, afirmación por afirmación (todo contra `54c7a70c`)

### #616
| Afirma | Verificado |
|---|---|
| `blocksMove` exime «las celdas ya solapadas» y no saca del sólido ancho | **CIERTO** · `src/scene/terrain-collision.ts:198-210` |
| Un edificio del plan es macizo y encierra | **CIERTO Y MÁS GRANDE.** Sonda propia sobre las tres fixtures, 36 rumbos × 5 s con `pasoDelJugador` real: **robledo 634 de 2.466 puntos sólidos sin salida (25,7 %), puerto 1.768 de 4.002 (44,2 %), zorder 160 de 552 (29,0 %)**. En superficie de tile: 3,9 % · 10,8 % · 1,0 % |
| La tecla R no saca | **CIERTO** · `src/simulation/reaparicion.ts:37-39` devuelve el punto del cadáver |
| Vía «un `spawn_entity` cae encima» | **FALSO.** `resolvePositionHint` (`consequence-handler.ts:217-238`) pone todo hint a ≥5 m del jugador, y un spawn de runtime es una **CAJA**, no terreno (`world/collision.ts:123` solo rasteriza el plan del tile): de una caja se sale SIEMPRE (#601) |
| Vía «un tile que llega y le pone un edificio encima» | **NO DEMOSTRADA.** `fronteraBloquea` impide que el cuerpo del jugador toque un tile ausente, así que un tile VECINO nuevo no puede caerle encima. Re-emitir el tile ACTIVO sí re-deriva la colisión (`carga-de-tile.ts:332` con `sceneChanged`), pero el bridge no regenera un tile registrado (`generateTileScene` → `"exists"`): no encontré productor vivo |
| Vía «resume en mal sitio» | **DERIVADA.** `main.ts:1337` restaura la posición del save tal cual; el save solo es malo si algo lo puso malo antes |
| **Vía que el issue NO nombra, y es la viva** | **MEDIDA.** Viajar por «Salidas»: `resolvePlaceTarget` (`src/world-map/place-target.ts:18-28`) devuelve el **centro del `anchor.rect` del lugar** —sin una sola consulta de solidez— y `main.ts:946` teletransporta ahí. `bridge/handlers/scene.ts:180` lo dice en voz alta: *«el jugador aparece dentro del lugar»*. Sonda: tomando el `cell`+`footprint` de cada entity como `anchor.rect`, **los 13 `building` de robledo y puerto son estado sin salida en su centro, 13 de 13** (la casa del concejo, la capilla, la herrería, la posada, el molino, el establo, la atalaya, la lonja, la taberna del Ancla…) |
| El rastro de prosa lo arregló la PR 1 | **A MEDIAS.** `obstaculos-del-jugador.ts:14-52` y `paso-del-jugador.ts:74-82` están corregidos y con la tabla. **Sigue mintiendo `src/simulation/reaparicion.ts:25-27`**: «Si el jugador reaparece dentro de algo, sale andando por la regla “salir sí, entrar no” de `pasoDelJugador` … y el motivo de que no se quede atrapado». Es la frase exacta que #616 desmiente, en el módulo que #616 tiene que tocar |

### #618
| Afirma | Verificado |
|---|---|
| Siete rumbos, `TODO(A*)`, caída a `giveUpMove` | **CIERTO** · `npc-behavior.ts:134`, `:680`, `:700` |
| `npc-behavior.ts` en `sin_mutar` | **CIERTO** · y `terrain-collision.ts` **también** lo está (`mutation-targets.json`, motivo «medible tal cual, falta agruparlo») |
| «un obstáculo que exija apartarse **más** que esos siete ángulos» | **FALSO: no hay umbral.** Sonda con el cableado de producción (`createSimCollisionProvider` + `createSessionNpcBehavior`), 120 s: cajón de **1, 2, 3, 4, 6, 10, 14 y 20 m** → **0 llegadas**. Un cajón de 1 m es un `prop` de `footprint [2,2]`: un pozo, un yunque, un roble. Y con el NPC desviado 0 · 0,25 · 0,5 · 1 · 2 · 3 · 4 · 5 m del eje de un cajón de 6 m → **0 llegadas**. El abanico ya cubre ±135°: lo que falta no es ALCANCE |
| «se planta» / cae a `idle` | **FALSO del sistema.** En 60 s anda **68 m de camino** para acabar a **1,5 m**, oscilando ±0,8 m, con el watchdog rindiéndose **14-16 veces**. Lo que ve quien juega no es un NPC plantado: es un NPC **pisando en el sitio con la animación de andar puesta**, 113 s de 120 pegado a la cara del cajón |
| (no lo dice, y acota el valor) | Solo le pasa al que tiene **directiva persistente**: `goto_place` 113 s pegado y 135 m andados; **`wander` se cura solo** (0 s pegado, 51 m de paseo real); `hold` no se mueve |
| «#616 y #618 comparten la pieza que falta» (requisitos §Por qué juntos, punto 2) | **FALSO.** `salidaDeCaja`/`porDondeSalirDeAqui` contestan «por dónde salgo de **DENTRO**». El NPC de #618 **no está dentro de nada**: `stepTowards:670` llama a `porDondeSalirDeAqui` en cada tick de mis corridas y devuelve `null` siempre. Extender la consulta de PUNTO al terreno no le da a #618 ni un metro. **No hay dependencia de orden entre los dos issues, ni en un sentido ni en el otro** |

## El día después

**Si se hace #616** · Dejan de existir las partidas que terminan quietas. Hay que **invertir**
`test/sim-collision.test.ts:193` («de la geometría del TILE no saca a nadie», que cita #616), y
`qa/la-puerta-de-la-reaparicion.mjs` se pondrá **rojo por diseño** — su propio texto dice qué toca
entonces (*«volver a decidir la reaparición, H10 de #538, no tocar este fichero»*), así que R entra en la
conversación quiera o no. Se borra el párrafo falso de `reaparicion.ts:25-27`. Efecto colateral que hay
que querer: `stepTowards:670` consume `porDondeSalirDeAqui`, así que el día que el terreno conteste, **los
NPCs metidos en geometría del tile empiezan a salir solos** — es mejora, pero es conducta nueva que no
pide ningún issue. Si solo se hace la mitad de abajo, queda arbitrario que el juego siga teniendo derecho
a teletransportar al jugador a una coordenada que nadie ha mirado.

**Si se hace #618 como está** · El repo estrena una segunda idea de «por dónde se va» junto a la de
`cajaBloquea` —**exactamente** lo que la tanda E prohibió al dejar `cajas-de-runtime.ts` sin geometría
propia— y una decisión de diseño que nadie ha tomado, que es por lo que #298 sigue aparcado.

## Conflictos

1. **#616 ↔ #465** (`deuda`, abierto) · *«Nada instruye al motor real a afinar `anchor.rect`… “el jugador
   aparece dentro del lugar”»*. **Dependencia oculta con orden**: #465 quiere que el motor real declare el
   rect, y eso convierte el estado sin salida de latente en rutinario. Explica además por qué el banco está
   verde: el motor falso SÍ fija el rect (`labs/narrative/fake-scenes.ts:190-191`) pero lo elige libre, así
   que `qa/guiones/09-viaje-de-vuelta.mjs` recorre el camino sin poder verlo. **#616 antes que #465, y #465
   bloqueado hasta entonces.**
2. **#618 ↔ #298** (`juego,futuro`) · Mismo fichero (`npc-behavior.ts`), misma forma (ciclo límite del
   steering), misma frase en el cuerpo («se lee como que el juego está roto») y **etiquetas opuestas**.
   #298 se aparcó porque termina en una pregunta de diseño; #618 termina en la misma. **Argumento, no
   etiqueta**: la parte de #618 que es diseño —pathfinding— es un programa y pertenece a `futuro` con #298
   y con #364 (*«añadir una familia de hot loop son 5 ficheros core a mano»*). La que **no** lo es y está
   medida: el sistema pone `moving = true` y anda 68 m sin producir movimiento. Eso no es «falta A\*», es
   un sistema afirmando lo que no hace, y es lo único cerrable sin decidir qué pathfinding tiene el juego.
3. Sin conflicto con `arch-rules.json` ni con `CLAUDE.md`. Los dos módulos diana (`terrain-collision.ts`,
   `npc-behavior.ts`) están en `sin_mutar`: se toque lo que se toque, la mutación no lo mide hoy.

## Coste contra valor

**#616** vale lo que cuesta: termina partidas, y la mitad de arriba (mirar el punto de aparición del viaje
antes de usarlo) es barata al lado de la de abajo. **No hacer nada**: cada viaje a un lugar anclado a un
edificio es una ruleta; con los `anchor.rect` de hoy —que solo pone el motor falso, y libres— nadie lo ve,
y el día que #465 se haga se verá todos los días. **#618** no vale una tanda **como está escrito**: A\* es
un programa, ampliar el abanico está **medido como inútil** (ya cubre ±135° y falla contra 1 m), y lo que
queda es una decisión de diseño sin tomar. **No hacer nada** cuesta NPCs con directiva persistente pisando
en el sitio — visible, sí, pero exactamente lo mismo que cuesta #298, que ya se aparcó.

## Qué le cambiaría a `requisitos.md` (redactado para pegarse)

1. En **§#616**, sustituir «Cómo se llega ahí hoy» entero por:
   > Cómo se llega ahí hoy, medido y no supuesto: **por el viaje**. `resolvePlaceTarget`
   > (`src/world-map/place-target.ts:18-28`) devuelve el centro del `anchor.rect` del lugar sin mirar si
   > está ocupado, y `main.ts:946` teletransporta al jugador ahí. Los 13 `building` de `robledo_tile` y
   > `puerto_tile` son estado sin salida en su centro. Las tres vías que nombra el issue **no** producen
   > el estado: un `spawn_entity` cae a ≥5 m y es una CAJA (de una caja se sale siempre); la frontera
   > impide que un tile vecino caiga sobre el jugador; y el resume solo repite lo que otro puso.
   > **El alcance de #616 son DOS mitades**: que el juego no ponga a nadie dentro, y que de dentro se salga.
2. En **§#616**, añadir al rastro de prosa: `src/simulation/reaparicion.ts:25-27` sigue prometiendo que
   quien reaparece dentro «sale andando»; la PR 1 de la tanda E no lo barrió.
3. En **§Por qué juntos**, **retirar el punto 2**: la pieza no es compartida y no hay orden entre los dos.
   El 1 y el 3 siguen en pie, pero ya no justifican una tanda conjunta.
4. En **§Los dos issues**, dejar **solo #616**, con **#465 bloqueado detrás**, y llevar #618 al usuario
   así: *«#618 es el gemelo de #298, que aparcaste en `futuro` el 2026-09-02. O salen los dos a la vez con
   una decisión de pathfinding, o #618 entra en `futuro` con #298. Lo único suyo que no es diseño y está
   medido: el NPC anda 68 m en 60 s para no moverse, con la animación de andar puesta.»*
