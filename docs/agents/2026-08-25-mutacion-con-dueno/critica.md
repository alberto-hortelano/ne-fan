# Crítica — La mutación se pide, se autoriza y vuelve con dueño

**Veredicto: reencuadrada.** La tarea debe hacerse, pero no como estaba escrita: la
formulación inicial («una cola de peticiones que se ejecutan cuando el usuario lo autorice»)
resolvía el síntoma equivocado y su implementación obvia era un autogol silencioso.

Este documento se escribe *a posteriori*, al cerrar la tanda: la crítica se hizo y sus
conclusiones están citadas en `requisitos.md` («Lo que NO hacía falta, y por qué se dice
aquí») y en `plan.md` («Lo que la revisión adversarial tumbó, y que he verificado»), pero no
quedó fichero, y CLAUDE.md manda commitearlo junto a `requisitos.md` y `qa.md`. Se recoge aquí
lo que de verdad se decidió y por qué, incluido lo que se tumbó.

## La premisa, verificada contra el código

La petición del usuario nace de una queja concreta y correcta: «¿es necesario lanzar los checks
de mutación tan a menudo? Llevo muchos años programando y nunca he necesitado estas cargas».
Verificado: cierto y peor de lo que parecía. La mutación completa son 9.040 mutantes y horas de
CPU, y la política de esa mañana (PR #266) la había sacado a una nocturna a las 3:00 — o sea,
había cambiado *cuándo* se paga sin tocar *quién* paga ni *para qué*.

**El problema real no era la frecuencia: era la atribución.** Una nocturna que mide cuatro PR
juntas escupe una lista de supervivientes sin decir de cuál salió cada uno. Averiguarlo se hace
después, a mano, y por eso no se hace nunca. La solución que el usuario propuso —peticiones que
esperan autorización— arregla la carga de CPU y deja intacto el problema de fondo.

## Lo que se reencuadró

| Como venía escrito | Como quedó | Por qué |
|---|---|---|
| «Los agentes piden y las peticiones se quedan esperando» | **No hay cola de peticiones.** Lo que falta por medir se deriva de `git log mutacion-ultima..main` | Es *más correcto*: coge también las PR que nadie pidió y los commits directos a `main` (11 de los últimos 40 no llevan `(#NNN)`). Y nadie puede olvidarse de declarar su petición, porque no hay nada que declarar |
| «Se le da el resultado a cada agente» | El resultado va a **la PR de origen** y a `npm run deuda` | No se crea un canal nuevo: `deuda` YA es el mecanismo de este repo para convertir supervivientes en cola de trabajo. Lo que le faltaba no era destinatario, era **la columna que dice de quién es cada superviviente** |
| «Hace falta retomar el agente con el contexto compactado» | **No hace falta** | Medido el mismo día: se rearrancaron tres ingenieros desde cero leyendo `requisitos.md` + `plan.md` + `qa.md`, y funcionó las tres veces. Un hallazgo que diga fichero, línea, mutante y de qué tanda salió lo coge cualquiera; si no dice eso, no lo arregla ni quien escribió el código |
| «¿Hace falta un canal más dinámico entre agentes?» | **No** | Lo que costó dinero ese día no fue falta de canal: fue **recurso compartido sin dueño** (dos commits en la rama del ingeniero equivocado, tres lecturas contradictorias del mismo guion, el `lcov.info` a 0,0 % con dos procesos midiendo). Un canal más dinámico sobre eso solo haría que se pisaran más deprisa |

## Lo que se tumbó del diseño inicial

**1. La cola como ficheros JSON en `nefan-core/data/mutation-queue/`.** Era la implementación
obvia y era un autogol de los que no dan error. `clasifica()` (`scripts/afectado.ts:93-99`)
devuelve `"dato"` para cualquier fichero que no acabe en `.ts` dentro del paquete, y `efectoDe`
(`:266-274`) traduce `"dato"` a **`todos: true`** —«los tests lo leen en runtime y eso no
aparece en ningún grafo de imports»—. Escribir una petición habría hecho que el selector pidiera
la **corrida completa**: 9.040 mutantes en vez de los 300 que tocaban, con una explicación
perfectamente razonable que nadie habría leído como un bug. Y `ficherosCambiados`
(`afectado.ts:444`) incluye los ficheros sin trackear, así que el autogol se dispara antes
incluso de commitear.

Corolario que sobrevivió a la tanda entera: **cualquier fichero nuevo en `nefan-core/data/` cae
en la misma trampa.** La huella (`data/contract/mutacion-huella.json`) caía de lleno, y peor —
cambia en cada corrida—, así que hubo que darle su propia clase (`"salida"`) con la regla
derivada, no declarada: no dice «esto es inocuo», dice «no lo lee ninguna batería», y eso se
comprueba con `ctx.leen()`.

**2. Identificar un mutante por `(fichero, línea, mutador)`.** Medido sobre los 19 informes que
había en disco: **1.155 de los 3.524 supervivientes son indistinguibles entre sí** (33 %, en 657
grupos que involucran a 1.812 supervivientes). Con esa tupla, un superviviente nuevo se
descontaría contra uno viejo distinto y el delta diría «no ha cambiado nada» justo cuando algo
cambió. Con las siete componentes —fichero, línea y columna de inicio y de fin, mutador y
`replacement`— las colisiones son **0**.

**3. `git blame` como veredicto de atribución.** Contesta «quién escribió esta línea», y la
pregunta es «qué cambio movió la suerte de este mutante». Donde más se separan es justo en el
hallazgo valioso: el mutante que pasa de `Killed` a `Survived` en código que nadie tocó, porque
la PR debilitó un test o cambió un fixture. Dos casos más, verificados: 148 supervivientes son
`BlockStatement`, cuyo `location.start.line` es la línea de la **firma** y no del cuerpo; y con
squash, si dos PR tocan el fichero, blame da la que se mergeó **después**, no la culpable
—basta un `npm run format`—. Quedó como **pista etiquetada**, nunca como veredicto. (La primera
corrida real lo confirmó: la pista de blame de los dos supervivientes nuevos de `attack-area.ts`
apuntaba a un commit **anterior al tag**, o sea fuera del rango.)

**4. Dos estados de delta.** Colapsar «no había medida» con «no ha cambiado nada» deja la cola
muda. El tercer estado, `sin base`, no es un caso teórico: estaba vivo ese mismo día
(`session-facets` entró con #273 y no tenía informe). Meterlo en «nuevo» inundaría al agente con
los 587 supervivientes de `scatter.ts` y garantizaría que deje de leerlos; en «ya estaba»,
silencio.

**5. La frescura por `mtime`.** El propio código lo admitía por escrito: «un merge o un checkout
tocan mtimes sin cambiar el contenido» (`deuda.ts:102-106`). Con corridas diferidas que bajan de
un artefacto, el `mtime` pasa a ser **la fecha de la descarga** y deja de significar nada.

## El repositorio el día después

Se comprobó qué queda vivo cuando la tanda termina, y salió un hallazgo que la tarea no
mencionaba: `npm run deuda` imprimía **«Para la cola completa: `npm run coverage && npm run
mutate`»** — la herramienta mandando hacer exactamente lo que la política de esa mañana
prohibía, en cinco sitios (`deuda.ts:15, 260, 264, 323, 349`). Entró en el alcance: una doctrina
que la propia herramienta contradice no dura una semana.

## Lo que la crítica NO vio, y conviene que conste

Dos cosas se le escaparon y las destapó la ejecución, no el análisis:

- **El tope de coste local puesto en un verbo no es un tope.** Se diseñó `npm run mutacion --
  local <id>` con su tope y se dejó `npm run mutate` abierto. El 2026-08-25, un backtick sin
  escapar dentro de un `echo` —sustitución de comandos en bash— lanzó la corrida completa en la
  máquina del usuario, a concurrencia 8. No esquivó el tope por encima: pasó por debajo, por la
  puerta que no tenía cerradura. El muro vive ahora en `mutate.ts`.
- **`repartir` no era idempotente**, y costó dos bugs de pérdida de datos en el mismo verbo,
  uno de ellos publicado en la PR #273. Un verbo que escribe un fichero *y* publica un efecto
  externo necesita el guardia en los dos sitios, no en uno.

## Decisiones del usuario que no se reabren

Se le presentaron con sus alternativas y eligió con el argumento en contra delante:

1. **El resultado aterriza en la PR de origen**, además de `npm run deuda`. No un `.md` en
   `docs/agents/<tanda>/`, no issues nuevas.
2. **El cron se retira.** La revisión adversarial recomendaba conservar una completa semanal
   como red para el punto ciego del selector (no ve lo que un test lee en runtime). El usuario
   decidió retirarlo, y a cambio `deuda` avisa cuando un módulo lleva más de N días sin medida.
   El punto ciego se estrecha mucho con el rango desde el tag —coge todo lo mergeado, no solo lo
   pedido— pero **no se cierra del todo**, y el aviso es lo que impide que la ceguera sea
   silenciosa.
3. **La autorización es manual y sin tope automático**: «lo autorizo yo aquí, estaré pendiente
   del móvil».
