# Los estáticos que mienten (#217 · #218 · punto 2 de #255)

## Petición del usuario (literal)

> Mergea y sigue con el backlog, elige y prioriza proximas tareas y continua de forma
> autonoma, yo voy a estar fuera unas horas, haz cosas que no necesiten de mi feedback y lo
> que surja lo dejas apuntado para que lo vea al final. Ten en cuenta que unas horas mias
> equivalen a varios dias de trabajo de agentes

Instrucción de gobierno vigente de la cola:

> si se modifica uno lo modificas y si se descarta simplemente pasa al siguiente y al final
> revisamos los descartados pero no pares la ejecución de los demás a no ser que tengan
> dependencias y yo tenga que hacer una elección de dirección del producto

## Por qué esta tanda NO lleva crítico nuevo

**#217 y #218 ya pasaron por el crítico el 2026-08-23** y sus reencuadres están pegados en el
cuerpo de cada issue, además de en `docs/agents/2026-08-23-estaticos-fallan/critica.md` (#218,
100 líneas, entera y muy concreta) y `docs/agents/2026-08-23-modelos-y-hojas/critica.md` (#217).
El propio crítico de #218 escribió que «se hace seguido de #217, que es su vecino»: esta tanda
es esa unión, ejecutada.

Lo que sí exige el material, por tener dos días: **verificarlo antes de diseñar sobre él**.
Desde entonces entraron en `main` la retirada del gpu-worker (#199), el arranque del cliente
(#181 #189 #180), el selector de mutación por regla (#230) y la salida de sprite-forge a repo
aparte. Ninguna toca en apariencia `vite.config.ts` ni el fake — pero «en apariencia» no es una
medida, y el reencuadre de #217 cita rutas (`nefan-html/src/render/sprite-renderer.ts`) que hoy
podrían estar en otra carpeta.

## El sujeto, en una frase

**Tres agujeros que comparten forma: algo que no está se sirve como si estuviera.**

| | Qué miente | Quién lo sufre |
|---|---|---|
| **#217** | Vite devuelve `index.html` con **200** para cualquier estático ausente bajo `/sprites/**` | Cualquier comprobación con `r.ok`: no puede ponerse roja. El guion 13 ya lo esquiva a mano, con comentario |
| **#218** | El `<img>` de la portada **no degrada**: pinta el icono roto del navegador | Lo primero que ve quien abre el bench. Y `qa/run.mjs` lleva desde #207 pintando cuatro portadas rotas cada corrida, sin que ningún guion mire |
| **#255 p2** | Sin hojas de personaje, el cliente degrada a un fallback (`y_bot`) **que tampoco existe** | Un clon limpio. El punto 1 (documentar cómo conseguirlas) se cerró hoy en `006f4f8` |

## Lo que el crítico ya decidió y NO se reabre

- **«Que el preset levante el asset-store» está descartada por escrito.** Con `?ai=` el
  cliente resuelve el asset-store al fake pase lo que pase (`net/service-urls.ts:22`), así que
  arrancar el store en :8767 no cambia nada; y sacarlo del override rompe las tres rutas
  binarias que el fake sí sirve bajo ese nombre.
- **Las otras dos salidas de #218 se hacen las dos**, porque no arreglan lo mismo: el `onerror`
  arregla el problema real (cualquier portada que falle, en cualquier preset, por cualquier
  causa) y es obligatorio; el `GET /styles/{id}/{file}` del fake solo arregla este preset, pero
  convierte en verdad la prosa de `start.sh` y le enseña las portadas reales al bench.
- **El marcador de `coverHtml` lleva el nombre del ESTILO y no se toca**: el título del mundo ya
  va al lado en la tarjeta. Falta solo el `onerror` que lo use.
- **De #217, lo único vivo es el 404.** Los cuatro caminos de carga ya fallan fuerte (el
  content-type en `meta.json`, y `naturalWidth === 0` en los PNG). **No tocar esos checks**:
  protegen el build y el asset-store, donde Vite no está.
- La prosa falsa de `start.sh` está en **dos** sitios y uno es visible al usuario
  (`SERVICE_HINTS`, se pinta en el TUI).

## Lo que le toca decidir al arquitecto

1. **Cómo se hace el 404 de `/sprites/**`.** `appType`, un plugin, o un middleware. Elige uno y
   di por qué, mirando qué le hace al build de producción (donde Vite no sirve nada).
2. **Si el punto 2 de #255 sale gratis con el 404 de #217 o necesita algo más.** Es la pregunta
   central de la tanda: con un 404 real, ¿el cliente ya grita de forma útil cuando no hay hojas,
   o sigue degradando en silencio hacia un `y_bot` inexistente? Mídelo, no lo deduzcas.
3. **Qué guiones de QA nacen o cambian.** Hay tres candidatos y no son equivalentes: que el
   guion 13 deje de esquivar `r.ok`; uno que mire las **cuatro** portadas del selector; y uno
   que arranque sin hojas y compruebe que se entera. Di cuáles entran.
4. **Dónde va el registro del fallo.** Con el `onerror`, una portada que falta deja de gritar en
   pantalla: es el precio correcto, pero el fallo tiene que salir por el canal de su capa
   (`errors.push("title", …)`, CLAUDE.md §Errores y logging).

## Freno explícito

Si el 404 de `/sprites/**` obliga a tocar cómo se sirve el build de producción, **para y
decláralo**: el bench y el juego servido no son el mismo problema y mezclarlos convierte una
tanda barata en una arriesgada.

## Criterio de terminado

Que **ninguna de las tres cosas mienta**, y que cada arreglo tenga un candado que se haya
visto rojo. Un estático que no está devuelve 404; una portada que no carga se dibuja como
marcador y deja rastro en el log; un clon sin hojas se entera al arrancar. Verificado con el
bench sin créditos, que es donde vive el síntoma.
