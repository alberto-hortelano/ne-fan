**REENCUADRADA** — la decisión del usuario (entra ya, cola aparte) se sostiene; dos de los tres obstáculos del issue ya no existen, y hay uno nuevo más grande que ninguno de ellos: hoy los tests **no cargan** el 77 % del cliente.

Medido el 2026-09-24 sobre `96da8151` (el `main` que tiene debajo `feature/tanda-bf`), Node v26.10.0, en el checkout principal (el worktree no tiene `node_modules`). Todo lo medido se hizo desde `/tmp/…/scratchpad`, sin escribir en el árbol.

## El problema real, en una frase

La deuda de complejidad × cobertura del cliente no sale en ninguna cola, así que un cambio en `nefan-html/src` puede empeorarla sin que nada se ponga rojo ni nadie lo vea.

La solución propuesta («comando propio + tope de no-empeorar propio») ataca ese problema. Lo que está mal es la base sobre la que el issue planteaba el tope.

## La premisa, afirmación por afirmación

| Afirmación | Hoy |
|---|---|
| «5 ficheros de test, 9 sujetos de 78 `.ts`» (triaje) | **6** ficheros y **58** tests (`nefan-html/test/*.test.ts`). Importan directamente **10** sujetos de `src/`. De **79** `.ts`, el lcov registra **19** como cargados. |
| «la cobertura del cliente MIDE CORE» (6 ficheros) | Sí, y ahora son más: el lcov trae **14** ficheros `../nefan-core/src/…`. Se resuelve con el mismo filtro que ya usa el core: `MEDIDOS = ["src/", …]` en `nefan-core/scripts/crap-score.ts:42` y el `continue` de `:259`. Con ese filtro el lcov del cliente se queda en sus 19 ficheros de `src/`. **Deja de ser un obstáculo.** |
| «la cifra depende del INVOCADOR (±36 pts)» | **Solo vale para la tabla física del propio Node.** Esa tabla da hoy 88,47 % con `node --import tsx --test` y 63,51 % con `npx tsx --test`. Con el denominador de #525 (`lineasDeCodigo` + `cuentaLineas`, `crap-score.ts:143,223`) sobre el lcov de cada invocador, sale **49,08 % y 48,99 %**: las mismas 7 funciones con CRAP > 30 y el mismo peor valor. Tres pasadas iguales dan 1045 / 1043 / 1044 líneas cubiertas de 2129 (ruido de 0,09 pts). **El obstáculo está resuelto si se mide con el denominador del core, y sigue vivo si se lee la tabla de Node.** |
| «el cliente es presentación; una cobertura del 95 % sobre HTML generado puede no significar nada» | La lógica ya se fue a core (#241, candado `la-logica-de-juego-no-vuelve-al-cliente`). Lo que queda en la cola son funciones de pintado del título (`home.ts`, `selector-de-mundo.ts`) y la resolución del atlas (`fps-atlas.ts:287`, cx 23). Es deuda de verdad, no ruido. |

**Hallazgo nuevo, el que manda: el lcov solo ve lo que un test carga.**
- 60 de los 79 ficheros del cliente, que suman **7310 de 9439 líneas de código (77 %)** y 830 funciones, no aparecen en el lcov.
- Entre ellos están `fps-gl.ts` (la anónima de cx 54, CRAP 2970 si se contara a 0 %), `style-apply.ts` (`plan` cx 40) y `main.ts` (`gameLoop` cx 39).
- El core casi no lo nota porque su banco lo carga casi todo. En el cliente es la mayor parte.

Dos consecuencias comprobables:
1. **La medida no es monótona.** Un test nuevo que importe un fichero hasta hoy invisible **mete** sus funciones sin cubrir en la medida. Eso puede subir el CRAP máximo y bajar la cobertura global. Un tope o un suelo calculados solo sobre lo cargado se pondrían **rojos por añadir un test**. Ejemplo: `onModeBadge` (`home.ts:295`, CRAP 132) es hoy el peor valor solo porque `home.ts` se importa desde el test del título.
2. **La regla de cola del core no se puede copiar tal cual.** `enColaDeCrap` (`nefan-core/scripts/deuda.ts:196`) mete siempre cualquier función con nombre a cobertura 0. Sobre lo cargado, eso da 7 funciones con CRAP > 30 más 29 a cobertura 0. Sobre el cliente entero serían **~650 items**, cuando hoy la cola del core tiene 12 (medido con `npm run deuda -- --json`). O se inunda la cola, o el 77 % se queda fuera sin decirlo.

## El día después

- **Para quien juega no cambia nada.** Es deuda declarada: la decisión del usuario lo convierte en un objetivo legítimo.
- **Puertas que cierra:**
  - Un PR que toca el cliente puede ponerse rojo por CRAP. Es lo que se busca.
  - Si la medida no es monótona, también se puede poner rojo quien **añade** un test, y eso enseña a no escribir tests del cliente. Es el anti-patrón más caro posible para un banco que acaba de nacer.
- **Lo que parecerá arbitrario dentro de un mes:** un suelo de cobertura del cliente puesto sobre el 49 % de un 23 % del código.

## Conflictos

- **Sin solapamiento en la cola.** Los 18 issues abiertos se revisaron (`gh issue list`) y ninguno toca cobertura o CRAP del cliente.
- **Hay precedente de dónde vive el contrato:** `nefan-core/data/contract/client-file-size.json` es un contrato sobre el cliente que vive en core. Es la forma natural de tener un hermano sin tocar la prosa de `quality-thresholds.json`, que dice en su `$comment` que es «de nefan-core».
- **`readThresholds()` no valida el esquema:** es un `JSON.parse` con cast (`crap-score.ts:213`). Un bloque añadido ahí nadie lo comprobaría. Es un argumento más para el fichero hermano, o para validar el esquema.
- **`deuda.ts` tiene `LCOV` y `MEDIDOS` fijados al core (`:64-65`).** La cola aparte exige parametrizar esa fuente, no copiarla. Un segundo `crap-score` duplicado se desincronizaría del denominador de #525, que es justo lo que resuelve el invocador.
- **No choca** con BB (título) ni con AX (atlas), aunque sus ficheros sean los peores de la cola: cualquier test que añadan solo puede bajar el CRAP, siempre que la medida sea monótona (criterio 3).

## Coste contra valor

**CI:** en la corrida `36046645861` de `main`, el job `nefan-html` tarda 35 s, y su `npm test` 1 s. En local:

| Qué se mide | Tiempo |
|---|---|
| `npm test` del cliente, sin cobertura | ~0,5 s |
| el mismo banco con cobertura y lcov | 523–538 ms (tres pasadas) |
| cálculo del CRAP del cliente con los helpers del core | 0,79 s |

Coste marginal: **2 s o menos** en un job que ya instala las deps de core (`ci.yml:135`). Despreciable: no hace falta sacarlo del bucle como se hizo con `ejercicio`.

**Si no se hace nunca:** el cliente sigue sin cola y todo el trabajo de tests de las tandas del título y del atlas queda sin medir. El valor supera al coste, **siempre que la medida sea monótona**. Si no lo es, es peor que no hacer nada.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

> ### Criterios de aceptación (crítico, 2026-09-24)
>
> 1. **Un comando fijo** en `nefan-html` escribe `nefan-html/coverage/lcov.info` (gitignorado). El CRAP y la cobertura del cliente se calculan con **las mismas** `lineasDeCodigo`/`cuentaLineas`/`functionsOf` de `nefan-core/scripts/crap-score.ts`, sin copiarlas. La tabla física de Node no decide nada. Negativo: el mismo árbol medido con `node --import tsx --test` y con `npx tsx --test` da el mismo peor CRAP y una cobertura a menos de 0,2 pts (hoy: 49,08 frente a 48,99).
> 2. **Solo se mide `nefan-html/src/`.** Los `../nefan-core/…` del lcov se descartan, y en eso hay un test. Hoy son 14.
> 3. **La medida es monótona: añadir un test no puede poner el gate rojo.** Los ficheros del cliente que ningún test carga (hoy 60 de 79, 7310 líneas de código) cuentan como medidos a cobertura 0, o se declaran «sin ejercer» con su número. Nunca desaparecen en silencio. Negativo: un test nuevo que solo IMPORTA un fichero hoy invisible no cambia el veredicto de `--check`.
> 4. **El contrato es un fichero hermano** en `nefan-core/data/contract/` (precedente: `client-file-size.json`), validado por esquema. Trae un tope de CRAP **de no-empeorar** MEDIDO sobre la base del criterio 3, con su margen declarado y medido. **No lleva suelo de cobertura global del cliente** en esta tanda: no hay base que lo justifique (≈11 % sobre el cliente entero, 49 % sobre lo cargado).
> 5. **`npm run deuda` saca el cliente en un bloque propio.** Ese bloque tiene su fuente, su aviso de frescura y una línea que dice cuántos ficheros o líneas del cliente no ejerce ningún test. No se mezcla con el bloque del core, y la regla «cobertura 0 entra siempre» no se le aplica de forma que la cola pase de ~40 items a ~650.
> 6. **CI:** el paso corre en el job `nefan-html` con `--check`. Medido: el coste marginal es de 2 s o menos.
> 7. Negativos en rojo: una función nueva en `src/` por encima del tope pone el gate rojo, y sin lcov del cliente el comando falla en vez de dar cola vacía.
> 8. Sin guion de `qa/`: nada de esto es observable por el jugador. Cero créditos.
