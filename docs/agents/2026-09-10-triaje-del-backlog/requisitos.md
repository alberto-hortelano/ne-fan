# Triaje del backlog: dejar solo lo que necesita decisión del usuario

## La petición, literal

> «Ya se esta ejecutando. Sigue trabajando hasta dejar solo los issues que necesiten alguna decision mia»

(2026-09-10, tras cerrar #346 y con la corrida de mutación autorizada y en marcha.)

Antes, el 2026-09-02, había fijado el marco que sigue vigente:

> «Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los plugins
> los podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser
> plugins y tienen baja prioridad en cuanto a calidad del codigo. Haz una seleccion de los issues
> centrales y marca los demas para mirar a futuro»

## Qué se pide exactamente

No es «cerrar todos los issues». Es **separar** el backlog en dos montones y vaciar el primero:

1. **Lo que puedo resolver yo** — tiene criterio claro en el repo, o una respuesta canónica del
   dominio, o ya está hecho y el issue miente. Se hace o se cierra.
2. **Lo que necesita una decisión suya** — cuesta dinero, cambia lo que el jugador siente, elige
   entre dos diseños defendibles, o compromete tiempo suyo (un playtest con créditos). Se queda
   abierto, con la decisión **formulada** para que pueda contestarla en una línea.

El entregable no es un número de issues cerrados: es que **lo que quede abierto sea, todo, cosa suya**.

## Estado medido al abrir

`main` = `ba6b534e`. **96 issues abiertos**: 84 de núcleo + 12 con etiqueta `futuro` (aparcados por
decisión del 2026-09-02, no entran en este triaje).

Mutación: corrida autorizada por el usuario y **en marcha** sobre el rango de los nueve commits
posteriores al tag `1c7bf189` (21 de 55 módulos). No bloquea nada.

## Cómo se hace

Cinco críticos en paralelo, uno por familia, **verificando cada cuerpo contra el código de hoy**.
La lección que lo justifica está escrita y fechada: en el censo de los 36 (agosto) hubo **nueve
cuerpos mintiendo** —issues cuyo síntoma ya no existía— y cero issues muertos de más; y #278 lo
arregló la PR que el propio issue citaba. Un issue de hace una semana en este repo puede estar
muerto, medio hecho sin decirlo, o describir un síntoma cuya causa se movió.

Veredictos por issue: **vigente** · **caducado** (cerrar, diciendo qué lo mató) · **reencuadrado**
(el problema real es otro) · **decisión del usuario** (con la pregunta formulada) · **ya cubierto por
otro** (fusionar).
