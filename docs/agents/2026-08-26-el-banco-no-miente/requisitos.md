# El banco de pruebas deja de mentir (#271 #272 #274 #283 #287 #247)

## De dónde sale

No de un documento: de haber tropezado con ello **cuatro veces en dos días**, dos de ellas hoy
mismo durante las tandas de #279 y del bosque.

La petición del usuario, literal, al cerrar la tanda del bosque:

> «Adelante con la mutacion, continua»

Y lo que el coordinador le propuso como siguiente tanda, que es esta:

> «La siguiente que más paga es la familia que hoy me ha costado tiempo dos veces —#271, #272,
> #283, #287—: el banco de pruebas mintiendo, en cuatro caras distintas.»

## El problema real, en una frase

`qa/run.mjs` es la única herramienta que dice si el juego hace lo que decimos que hace, y **hoy
puede dar un veredicto que no significa nada** —rojo cuando lo que se cayó fue el stack, verde
cuando no llegó a mirar, o rojo de un guion sano porque otro le dejó el disco a medias—, sin que
nada en su salida permita distinguirlo.

Eso no es incomodidad: es la vía por la que un rojo de verdad se cuela. Y ya está cobrándose su
precio en atención — esta semana hemos gastado dos investigaciones enteras en rojos que no eran.

## Las seis caras conocidas, con su evidencia

| # | Qué | Cómo se sabe |
|---|---|---|
| #272 | Siete rojos cuando lo que se ha caído es el stack: 9/23 que en realidad eran 14 | Medido al abrirlo |
| #283 | Si el runner muere por una promesa rechazada, `salir()` no corre: el tmp se borra pero **el stack queda vivo**, y la corrida siguiente lo hereda apuntando a un disco que ya no existe → todos los guiones caen con `Timeout 30000ms` sin decir por qué | Le pasó a QA **dos veces** validando #279 |
| #271 | Puertos clavados: dos corridas a la vez se pisan o se enganchan al stack ajeno | — |
| #274 | Los puertos del bench son constantes: **solo cabe un agente a la vez en la máquina** | Es lo que serializa el trabajo de verdad, no la falta de canal entre agentes |
| #287 | El guion 25 es intermitente: verde dos veces aislado, rojo dentro de la batería | Medido por QA el 2026-08-26 |
| #247 | El guion 15 es una moneda al aire **también en `main`**: su umbral no tiene sujeto | Verificado sobre `361e72a` y sobre tres ramas distintas |

## El precedente que dice cómo se arregla

**#270**, cerrado hoy: `comenzar()` daba la partida por arrancada cuando llegaba la escena, no
cuando el título dejaba de interceptar. Ahí la lección quedó escrita y vale para toda esta tanda:

> «El arreglo no es esperar más. Subir un timeout mueve la ventana, no la cierra. Lo que hay que
> conseguir es que se espere por el HECHO observable, no por un proxy.»

Su arreglo blindó tres guiones de golpe. El criterio de terminado de esta tanda es el mismo:
**cada espera cuelga de un hecho del juego, y cada rojo dice de quién es.**

## Criterio de terminado

1. Una corrida cuyo stack se cae dice **que se ha caído el stack**, no siete guiones en rojo.
2. Un runner que muere por una excepción **no deja el stack vivo**, o el siguiente detecta que
   el heredado no sirve antes de dárselo a los guiones.
3. Dos corridas simultáneas en la misma máquina no se pisan (y, con ello, cabe más de un agente).
4. Los guiones 15 y 25 dejan de ser monedas al aire: o su aserto cuelga de un hecho, o se
   declara por escrito qué cobertura se pierde al retirarlo.
5. Nada de esto se cumple subiendo un timeout.

## Para el crítico

Estos seis issues llevan semanas abiertos y **el material viejo es el que se pudre**: hay que
verificar cada premisa contra el código de hoy antes de diseñar nada. Concretamente:

- **#271 y #274 pueden ser el mismo issue** — o no: uno habla de dos corridas pisándose y el
  otro de cuántos agentes caben. Si son el mismo, se funden; si no, hay que decir en qué se
  separan.
- **#272 puede estar medio arreglado ya**: la tanda de los estáticos y la de #279 tocaron el
  arranque y el runner. Comprobar antes de planificar.
- **#247 y #287 son dos guiones distintos con la misma enfermedad**, pero #284 acaba de destapar
  que la causa del 15 no era la que decía su issue (el tabernero arranca dentro de un prop). El
  15 puede que ya no pertenezca a esta tanda.
- Y la pregunta que decide el tamaño: **¿esto es una tanda o son dos?** Los puertos y el
  aislamiento son infraestructura del runner; los dos guiones intermitentes son asertos. Si van
  juntas por comodidad y no por sujeto, sepáralas.

---

# Reencuadre tras la crítica (2026-08-26)

**Veredicto: REENCUADRADA — son tres tandas, no una.** El agrupamiento por síntoma («el banco
miente») era falso: hay tres sujetos distintos.

| Grupo | Issues | Sujeto | Dónde |
|---|---|---|---|
| **A** | #272 #283 | qué SIGNIFICA el veredicto del runner | ~40 líneas en `qa/run.mjs` |
| **B** | #271 + #274 (se funden) | quién puede correrlo a la vez | `start.sh` + 5 copias de tabla + disco compartido |
| **C** | #287 #247 | dos guiones concretos mal escritos | una línea y un dato del bench |

**Esta tanda es A + C.** B va en tanda propia, y su primer paso no son los puertos: es dejar de
matar lo ajeno al arrancar. El orden lo fija el crítico y es load-bearing: *el runner honesto es
el instrumento con el que se mide B; hacerlo al revés es reconstruir el instrumento con el
instrumento roto.*

**Sin arquitecto**: la crítica ya sitúa cada pieza, el precedente está en el repo y el alcance
son ~40 líneas dentro de `qa/`. Va directo al ingeniero.

## Premisas corregidas — cuatro de las seis eran falsas o incompletas

1. **#272 no lo arregló nadie de rebote**: `git log -- qa/run.mjs` termina en `1f4e99d`, anterior
   a las tres tandas de hoy. Y el campo que hace falta **ya existe y se tira**: `run.mjs:460`
   guarda `fatal` y `:465-468` imprime `✔/✘` desde `r.ok`.
2. **#283 tiene el mecanismo al revés, y esto cambia el arreglo.** El tmp no lo borra «el
   sistema»: vive en `qa/.tmp/<runid>` y lo borra `limpiarTmpViejos()` (`run.mjs:181-187`) **de
   la corrida siguiente**, que corre en `prepararDisco()` *antes* de `ensureStack()`
   (`:393-394`). La corrida nueva le arranca el disco al stack que un segundo después decide
   heredar: **se lo hace a sí misma**. Lo que sí es cierto del issue: `:175-177` solo registra
   `SIGINT`/`SIGTERM`. Precedente de `unhandledRejection` en el repo: `bridge/ws-server.ts:123`.
3. **#287 NO es intermitencia: es determinista y de una línea.** El aserto que cae es «el título
   sigue ofreciendo la partida» (`25:269-272`): el guion hace `esperarTituloListo` y luego un
   `page.$` **instantáneo**, pero las tarjetas solo se pintan tras `await listSessions()`
   (`title-screen.ts:441`). Los guiones 12, 17, 18, 19, 27 y 29 llaman a `esperarListaDeSaves`;
   **el 25 es el único que no**. En batería hay más saves, `list()` tarda más (#224) y pierde la
   carrera.
4. **#247 perdió su premisa.** No es «un umbral sin sujeto»: el tabernero nace en la celda
   (60,52) y el prop `mostrador` ocupa `rect [55,51,6,2]` — `labs/narrative/fake-ai-server.mjs:119`
   y `:266`. **El bench coloca al NPC dentro de un sólido** y solo se despega 0,73 m.

## Lo que NO entra, y por qué importa saberlo antes

De la crítica, para quien haga B mañana:

- **`start.sh` mata lo ajeno al ARRANCAR**: `port_busy X && kill_port X` (`fuser -k`) en nueve
  sitios (`:162,184,196,205,214,243,277,297,311`). Arrancar el cliente mata el `:3000` de quien
  tenga el navegador abierto. Eso es el «el otro worktree soltó los puertos a mitad» de #271.
- **El guardarraíl de cero créditos reconoce al motor falso POR SU NÚMERO DE PUERTO**
  (`qa/lib/sesion.mjs:20`, `/:18765(\/|$)/`). Un puerto por instancia lo deja **ciego**. Esto
  toca dinero: va primero en B, no después.
- **`qa/presets.mjs:59,66` parsea `start.sh` con regex**, así que cambiar la sintaxis de esas
  nueve asignaciones tumba la validación de presets.
- No hay ninguna regla en `arch-rules.json` que prohíba copiar un puerto a mano — esa ausencia
  es el hueco por el que entraron las cinco copias de la tabla.

## Criterio de terminado de A + C

1. Una corrida cuyo stack se cae dice **que se ha caído el stack**, no N guiones en rojo.
2. Un runner que muere por una excepción no deja el destrozo a la corrida siguiente — y no se
   arranca a sí mismo el disco que va a heredar.
3. El guion 25 espera por el hecho (la lista pintada), como los otros seis.
4. El guion 15 deja de medir a un NPC empotrado en un prop: el `barkeep` sale del `mostrador`.
5. Nada de esto se cumple subiendo un timeout.
