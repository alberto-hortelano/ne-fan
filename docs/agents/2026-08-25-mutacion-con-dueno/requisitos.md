# La mutación se pide, se autoriza y vuelve con dueño

## La petición del usuario, literal

> «No me convence lo de la mutacion nocturna. Creo que los agentes deberian poder pedirla
> pero se quedan las peticiones esperando y se ejecutan cuando lo autorice. Una ejecucion
> pendiente no bloquea el merge y cuando haya varias mergeadas se ejecuta una vez y se le da
> el resultado a cada agente. Hace falta poder retomar el agente tiempo despues, con una
> compactacion del contexto y un nuevo agente con el contexto compactado deberia funcionar.
> Hace falta algo mas para los agentes? Algun metodo de comunicacion mas dinamico entre
> agentes?»

Y sobre cómo autoriza:

> «Adelante, lo autorizo yo aqui, estare pendiente del movil para ver las sesiones y si estoy
> fuera lo puedo aprobar desde el movil.»

Antes de esto, y es el origen de todo:

> «Pero es necesario lanzar los checks de mutacion tan a menudo? No es un problema de
> concurrencia es que yo llevo muchos años programando y nunca he necesitado estas cargas de
> checks de mutacion. no se puede dejar para un trabajo recurrente en lugar de que cada
> agente este lanzando su tanda de mutaciones?»

## Las dos decisiones que el usuario ya ha tomado

Se le preguntaron y las eligió. **No se reabren.**

1. **Dónde aterriza el resultado**: comentario en la PR de origen, además de `npm run deuda`.
   No un `.md` en `docs/agents/<tanda>/`, no issues nuevos.
2. **El cron**: se retira, y a cambio `npm run deuda` avisa cuando un módulo lleva más de N
   días sin medida. La revisión adversarial recomendaba conservar una completa semanal; el
   usuario decidió con ese argumento delante.

## Criterios de aceptación

1. **Nadie corre mutación cara en la máquina del usuario.** El único camino local es
   `npm run mutacion -- local <id>`, que **rechaza** el módulo cuyo coste supere el tope,
   imprimiendo el coste y qué hacer en su lugar.
2. **Una petición no bloquea nada.** Cerrar una tanda no espera a ninguna medida.
3. **Una sola corrida cubre todas las PR mergeadas desde la anterior**, incluidas las que
   nadie pidió y los commits directos a `main`.
4. **Cada superviviente sale con dueño o dice que no lo tiene.** Nunca un dueño inventado:
   con dos candidatos se nombran los dos.
5. **Un superviviente que ya existía no se le carga a quien no lo trajo**, y un módulo sin
   medida anterior sale como `sin base`, ni «nuevo» ni «ya estaba».
6. **El usuario lo autoriza desde el móvil** sin teclear módulos ni tener una sesión viva.
7. **Nada de esto puede dar verde sin haber comprobado nada** — ver la lista de la sección
   «En negativo» del plan, que es parte del encargo, no una sugerencia.

## Fuera de alcance

- Los puertos fijos del bench (`qa/run.mjs:104-106`, `start.sh:16-23`). Issue aparte.
- La suite corriéndose dos veces (`npm test` + `npm run coverage`). Issue aparte.
- Tocar `mutate.ts:88-92` (el `rmSync` del informe previo): es deliberado y tiene motivo
  escrito. La huella se guarda en otro sitio.

## Preguntas abiertas

- **La app móvil de GitHub puede no disparar `workflow_dispatch`** (el navegador móvil sí).
  Es la piedra angular del criterio 6. **Se comprueba antes de construir encima**; si no
  funciona, el respaldo es `gh workflow run` desde la sesión y hay que decirlo por escrito,
  no descubrirlo el día que haga falta.

## Lo que NO hacía falta, y por qué se dice aquí

El usuario preguntó si hace falta retomar al agente con el contexto compactado y si hace falta
un canal más dinámico entre agentes. **Las dos respuestas son que no**, y el motivo está
medido: hoy se han rearrancado tres ingenieros desde cero leyendo `requisitos.md` + `plan.md` +
`qa.md`, y ha funcionado las tres veces. Lo que costó dinero hoy no fue falta de canal, fue
**recurso compartido sin dueño**: dos commits en la rama del ingeniero equivocado, tres
lecturas contradictorias del mismo guion, y el `lcov.info` dando 0,0 % con dos procesos
midiendo. Un canal más dinámico sobre eso solo haría que se pisaran más deprisa.
