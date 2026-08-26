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
