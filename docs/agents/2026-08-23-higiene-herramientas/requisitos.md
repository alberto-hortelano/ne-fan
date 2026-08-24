# Higiene de herramientas (#212 + #213)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

## Por qué los dos van al mismo crítico

Los dos salen del mismo backlog (`docs/agents/2026-08-22-retirar-godot/plan.md` §6, items **b** y
**c**), los dos son herramienta pura sin superficie de jugador, y **los dos son candidatos claros a
que los recortes**. Van juntos para no pagar dos contextos por dos cosas pequeñas.

## #212 — añadir `tools/**/*.mjs` a las raíces de escaneo

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/212`.

`tools/render-sprite-sheets/` es código con `package.json` propio, dependencias reales y un
consumidor de producción, y hoy **no está en `scan.roots`** de `arch-rules.json`: no lo cubre ni el
fail-loud ni `campos-retirados-no-vuelven`.

**Dato mío que quiero que verifiques**: ya medí que añadir esa raíz da **cero violaciones**. Si es
cierto, la parte cara del issue («medir qué violaciones aparecen y congelar el número») **no
existe**, y lo único vivo es la segunda mitad: que `tools/render-sprite-sheets/fbx-anim-span.test.mjs`
**no lo corre nadie** — el CI solo tiene jobs de nefan-core, narrative-mcp, nefan-html y ai-server.

Si al final la tarea es «añadir una raíz que no cambia nada» + «meter unos tests en CI», eso no es
lo que dice el título del issue, y hay que reescribirlo.

## #213 — ¿siguen valiendo tres hooks para `dump-config.ts`?

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/213`.

El script emitía dos ficheros y ahora emite uno. Sigue colgando de tres hooks (`prebuild`, `predev`,
`pretest`) más `start.sh`. El propio issue dice «medir primero cuánto cuesta antes de tocarlo —
puede ser irrelevante»: **un issue que se pregunta a sí mismo si merece la pena es candidato a
obsoleta**. Mídelo.

Y considera la alternativa que a mí me parece la del repositorio: la respuesta no es quitar hooks a
ojo, sino **un candado** que compare el `runtime_config.json` commiteado con `JSON.stringify(CONFIG)`
y falle si divergen. Con eso, `pretest` y `prebuild` sobran por construcción y no por criterio. Pero
esa es mi opinión, no un requisito: si crees que sobra el candado también, dilo.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- Lo que quede vivo de cada issue queda **escrito en su título**: hoy los dos títulos prometen más
  de lo que el trabajo real contiene.
- Ningún candado nuevo nace en verde sin haberse visto rojo antes.

## Fuera de alcance

Reorganizar `tools/`. Cambiar `CONFIG`.

## Preguntas abiertas

Ninguna para el usuario, salvo que tú determines que la hay.
