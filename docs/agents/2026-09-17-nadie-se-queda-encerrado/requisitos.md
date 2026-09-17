# Tanda G — «Nadie se queda encerrado»

## La petición, literal

> **«Sigue cerrando issues»**

(2026-09-17, sesión principal. Es la continuación de la instrucción de fondo que abrió la serie el
2026-09-02: «Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los
plugins los podemos dejar para mas adelante… Haz una seleccion de los issues centrales y marca los demas
para mirar a futuro».)

Esta tanda es la que quedó **preparada y sin abrir** al cerrar la tanda F: los dos issues que destapó la
tanda E al hacer sólido el mundo.

## Estado medido hoy

- `main` = `54c7a70c`, árbol limpio, tag `mutacion-ultima` movido por la corrida `35147355595`.
- Backlog: **42 abiertos = 31 núcleo + 11 `futuro`**.
- Batería de navegador al cerrar la tanda F: 138 verde · 2 rojo · 2 sin medir de 142; los dos rojos con
  dueño (#633, #639) y ajenos a esta tanda.
- Los 60 módulos de mutación están medidos: no queda ningún `break: "sin medir"`.

## Los dos issues

Comparten sujeto técnico —**la geometría sólida del mundo y quién sabe salir de ella**— y comparten
carpeta: `nefan-core/src/simulation/` y `nefan-core/src/scene/terrain-collision.ts`. Los dos nacieron
midiendo, en la QA de la tanda E, y los dos son de lo que el jugador NOTA.

### #616 — quien acaba dentro de un edificio del PLAN no sale

El jugador. `TerrainCollider.blocksMove` exime «las celdas sólidas que ya se solapaban en el origen», lo
que devuelve a quien penetra un muro fino pero **no saca a quien está dentro de un sólido más ancho que su
cuerpo**: la celda siguiente es sólida y no estaba solapada, así que bloquea. Los edificios del plan son
**macizos** (`planCollisionGrid` rasteriza la huella entera del volumen, no sus muros).

Medido en el issue (jugador en el centro, 36 rumbos, 60 fps): grosor 0,5-1 m → 34/36 salen; 1,5 m → 17/36;
**≥ 2 m → 0/36**, 0,15 m andados. Un edificio de `robledo_tile` mide 5×7 m.

Y **la tecla R tampoco saca**: `puntoDeReaparicion` devuelve donde cayó, porque su escalón «al centro del
tile» era inalcanzable (H2 de #538) y la PR 3 de la tanda E lo borró por eso. Estado sin salida y sin
recurso escrito.

**Cómo se llega ahí hoy, medido y no supuesto: por el VIAJE.** `resolvePlaceTarget`
(`src/world-map/place-target.ts:18-28`) devuelve el centro del `anchor.rect` del lugar **sin una sola
consulta de solidez**, y `nefan-html/src/main.ts:946` teletransporta al jugador ahí.
`nefan-core/bridge/handlers/scene.ts:180` lo dice en voz alta: «el jugador aparece dentro del lugar».
Los **13 `building`** de `robledo_tile` y `puerto_tile` son estado sin salida en su centro, 13 de 13.

Las tres vías que nombra el issue **no** producen el estado: un `spawn_entity` cae a ≥ 5 m
(`resolvePositionHint`) y además es una **CAJA**, no terreno —y de una caja se sale siempre desde #601—;
`fronteraBloquea` impide que un tile vecino caiga sobre el jugador, y el bridge no regenera un tile ya
registrado; y el resume solo repite lo que otro puso antes.

**Superficie del estado sin salida** (sonda del crítico, 36 rumbos × 5 s con `pasoDelJugador` y las fuentes
de solidez reales): robledo **634 de 2.466 puntos sólidos (25,7 %)** · puerto **1.768 de 4.002 (44,2 %)** ·
zorder **160 de 552 (29,0 %)**.

**El alcance de #616 son DOS mitades**: que el juego no ponga a nadie dentro, y que de dentro se salga.

**Lo que ya está medido que NO vale**: quitar la exención encierra a todos; «celda a celda» literal sobre
las cajas encierra igual (0 de 8 rumbos salen de una caja de 12×12 m, medido en el plan de la tanda E).
La pieza que el issue dice que falta: **no existe la pregunta «¿es sólido este PUNTO?»**, solo «¿puedo
moverme hasta aquí?»; con ella la salida natural es mirar la **dirección de menor penetración**, que es lo
que `penetracionEnCaja` / `salidaDeCaja` ya hacen desde #601 y #583 para las cajas.

**Rastro de prosa, corregido A MEDIAS**: `obstaculos-del-jugador.ts:14-52` y `paso-del-jugador.ts:74-82`
los arregló la PR 1 de la tanda E y hoy llevan su tabla. **Sigue mintiendo
`nefan-core/src/simulation/reaparicion.ts:25-27`**: «Si el jugador reaparece dentro de algo, sale andando
por la regla "salir sí, entrar no" de `pasoDelJugador` … y el motivo de que no se quede atrapado». Es la
frase exacta que #616 desmiente, en el módulo que #616 tiene que tocar.

### #618 — el NPC no rodea

`stepTowards` (`src/simulation/npc-behavior.ts`) sondea **siete rumbos hacia su meta** (`DEFLECTION_ANGLES`,
línea 134) y, si ninguno pasa, cae a `giveUpMove` → `idle`. No hay búsqueda de camino: un obstáculo que
exija apartarse más que esos siete ángulos **no se rodea nunca**. El `TODO(A*)` está declarado en el código
(línea 680).

No lo introduce #583: lo hace **visible en un sitio más**. Antes el NPC atravesaba el carro del motor (eso
era el defecto de #583) y ahora se planta delante, como lleva haciendo con los edificios del pueblo desde
#232. Para quien juega, un NPC clavado delante de un carro se lee como un NPC roto.

**Lo que ya se descartó con medida** (para que nadie lo vuelva a investigar): NO es una asimetría entre
fuentes. El experimento cruzado {fuente} × {posición} a 300 s dio centro (3,3) → tile 8.30 = runtime 8.30;
la diferencia aparente venía de que `cell` es la **esquina** de la huella. Y **no es** el estado sin salida
del NPC al que le cae una caja encima: eso lo cerró #583 con `porDondeSalirDeAqui` (290 s de 300 dentro →
salir en 2,5 s). Lo de este issue es el NPC que **puede** moverse y no sabe por dónde ir.

`npc-behavior.ts` está hoy en `sin_mutar`: **la mutación no mide nada de esto**.

## Por qué NO van juntos (corregido por la crítica, con medida)

**El punto 2 de esta sección —«comparten la pieza que falta»— era MÍO y es FALSO.** El crítico lo tumbó
midiendo: `salidaDeCaja` / `porDondeSalirDeAqui` contestan «por dónde salgo de **DENTRO**», y el NPC de
#618 **no está dentro de nada** — `npc-behavior.ts:670` llama a `porDondeSalirDeAqui` en cada tick de sus
corridas y devuelve `null` **siempre**. Extender la consulta de PUNTO al terreno no le da a #618 ni un
metro. **No hay dependencia de orden entre los dos issues, en ningún sentido**, y con ella cae también el
riesgo de «dos geometrías» que era mi razón para juntarlos.

Queda en pie que los dos tocan `nefan-core/src/simulation/`, pero compartir carpeta no es compartir
problema. **La tanda es #616 sola.**

## Lo que el crítico tiene que decidir

- **Los issues caducan en horas.** Los dos nacieron el 2026-09-16 y desde entonces han entrado 15 PR. Hay
  que re-verificar las dos premisas contra `54c7a70c` antes de diseñar nada.
- **#616 — ¿sigue siendo alcanzable el estado?** Sus tres vías de entrada (spawn encima, tile que llega,
  resume en mal sitio) son afirmaciones del issue, no medidas suyas. Si alguna ya no existe, el alcance
  cambia. Y si ninguna es alcanzable hoy, el issue es PREMATURO y hay que decirlo.
- **#616 — ¿el rastro de prosa está ya corregido?** El issue dice que la PR 1 de la tanda E arregló el
  texto de `obstaculos-del-jugador.ts:14-19` y `paso-del-jugador.ts:70-77`, y que el defecto se queda.
  Verificarlo: si el texto sigue prometiendo lo que no cumple, es parte de esta tanda (regla de la casa: un
  rastro que miente confunde a los agentes).
- **#618 — ¿cuál es el alcance honesto?** «A\*» es un programa, no una tanda. El issue nombra el problema
  pero no propone solución. Hay que decidir si lo que entra es (a) una búsqueda de camino de verdad,
  (b) algo más barato que cubra el caso real (rodear un obstáculo convexo suelto), o (c) nada y el issue se
  reencuadra o se aparca con motivo escrito. **Recuérdese que el movimiento del NPC es un sistema de juego
  que la decisión del 2026-09-02 aparca en plugins** — pero el issue está etiquetado `juego`, no `futuro`,
  y el defecto lo NOTA el jugador. Ese conflicto es del crítico.
- **¿Se pueden hacer en paralelo, o el segundo depende de la pieza del primero?** Si #618 va a consumir la
  consulta de PUNTO que crea #616, el orden importa y hay que decirlo.

## Restricciones de la casa que aplican aquí

- **Cero créditos** en toda la verificación (`html-fixtures`, `e2e-sin-creditos`, motor falso).
- **No se para ningún servidor ajeno**: solo `NEFAN_PORT_OFFSET=<n> ./start.sh --preset <slug>` desde el
  árbol propio, y solo `--parar` desde ese mismo árbol. **Nunca `--parar-todo`.**
- Ningún umbral baja. Si algo crece, se anota con motivo; no se sube el techo para acomodarlo.
- Los ingenieros commitean, no empujan ni abren PR: eso lo hace el coordinador.
- Receta de worktree en `docs/agents/README.md` — **cuatro** paquetes (`nefan-core` + build,
  `narrative-mcp`, `nefan-html`, `qa`), más copiar `nefan-html/public/sprites`.


---

## Veredicto de la crítica y decisión del usuario (2026-09-17)

`critica.md`, sobre `54c7a70c`: **#616 REENCUADRADA · #618 EN CONFLICTO.**

**Decisión del usuario, literal**: para #616, **«Las dos mitades»** — que el juego deje de meter al
jugador dentro (el viaje consulta solidez antes de teletransportar) **y** que de dentro se salga (la
consulta de PUNTO en el terreno). Para #618, **«A `futuro` con #298»**.

**#465 queda BLOQUEADO detrás de #616**, y es una dependencia con orden que ningún issue nombraba: #465
quiere que el motor real afine los `anchor.rect`, y eso convierte el estado sin salida de latente en
rutinario. Explica además por qué el banco está verde hoy — el motor falso SÍ fija el rect
(`labs/narrative/fake-scenes.ts:190-191`) pero lo elige libre, así que `qa/guiones/09-viaje-de-vuelta.mjs`
recorre el camino entero sin poder verlo.

**#618 se aparca con su medida**, que es lo que lo hace retomable: no es «falta alcance en el abanico»
—eso está **medido como inútil**: ya cubre ±135° y falla contra un cajón de **1 m**, y no hay umbral de
tamaño entre 1 y 20 m—, y el observable del issue también era falso: el NPC **no se planta**, anda **68 m
de camino en 60 s** para acabar a 1,5 m, oscilando, con el watchdog rindiéndose 14-16 veces y la animación
de andar puesta. Solo le pasa con **directiva persistente**: `wander` se cura solo.

### Lo que el arquitecto tiene que saber antes de empezar

- Hay que **invertir** `nefan-core/test/sim-collision.test.ts:193` («de la geometría del TILE no saca a
  nadie»), que cita #616 por número.
- `qa/la-puerta-de-la-reaparicion.mjs` se pondrá **rojo por diseño**; su propio texto dice qué toca
  entonces («volver a decidir la reaparición, H10 de #538, no tocar este fichero»). La tecla **R** entra en
  la conversación quiera o no.
- **Efecto colateral que hay que querer y declarar**: `npc-behavior.ts:670` consume `porDondeSalirDeAqui`,
  así que el día que el terreno conteste, **los NPCs metidos en geometría del tile empiezan a salir solos**.
  Es mejora, pero es conducta nueva que no pide ningún issue — y no la confundas con #618, que es otra cosa.
- `terrain-collision.ts` y `npc-behavior.ts` están **los dos en `sin_mutar`**: se toque lo que se toque, la
  mutación no lo mide hoy.
