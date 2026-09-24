# Requisitos — tanda BF: El cliente entra en cobertura y CRAP con cola aparte (#664)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

## Decisión del usuario (AskUserQuestion, 2026-09-24)

#664 → «Entra con cola aparte (Recomendado)»: CRAP del cliente con su propio comando y su propio tope de no-empeorar, separado del núcleo.

## Triaje previo (2026-09-24)

| 664 | DECISIÓN | M | — | La señal que el issue esperaba ya casi llegó: `nefan-html/test/` tiene 5 ficheros y 9 sujetos (renderer, scene, ui) de 78 `.ts`; el 09-18 eran 2. Pregunta: «¿entra ya el cliente en crap, con qué comando fijo (±36 pts según invocador) y con la cola unida o separada?» |

## Los issues, verbatim (con comentarios)

### #664

> El cliente no tiene ni cobertura ni CRAP: decidir cuándo el banco entra en quality-thresholds.json
> 
> Sale del plan de la tanda K (#636), §6 «Backlog».
> 
> `npm run deuda` y `npm run crap` miden complejidad×cobertura **solo con el
> `coverage/lcov.info` de `nefan-core`**. `nefan-html` no aparece: no tiene `coverage`,
> no tiene entrada en `quality-thresholds.json` y su deuda no sale en ninguna cola.
> 
> Hasta hoy eso era coherente, porque el cliente no tenía banco. Desde #636 lo tiene
> (`nefan-html/test/`, `node --import tsx --test`), así que la pregunta pasa a existir:
> **¿cuándo entra, y con qué suelo?**
> 
> **Hoy NO se hace, y el motivo es el de siempre**: con UN test, cualquier umbral sería
> inventado — el anti-patrón que el propio `quality-thresholds.json` prohíbe por
> escrito. Un suelo puesto a la medida de dos asertos no mide el cliente, mide los dos
> asertos.
> 
> **La señal de actuar** (para que esto no se decida por acumulación): cuando el banco
> tenga sujetos de varios módulos distintos, de forma que un suelo se pueda MEDIR sobre
> una base y no sobre un caso. Entonces se decide con número: qué mide `lcov` del
> cliente, qué suelo sale de la medida, y si `deuda` debe unir las dos colas o
> mantenerlas separadas (el cliente es presentación derivada; una cobertura del 95 %
> sobre HTML generado puede ser un número sin significado — eso es parte de lo que hay
> que contestar).
> ## La señal NO ha llegado, y aquí queda el número de hoy — más dos hallazgos que el issue no tenía
> 
> Medido el 2026-09-18 sobre `main` = `900b5b71`, en la crítica de la tanda R y re-medido por el coordinador. **No se implementa nada**: este comentario existe para que la próxima vez se decida contra una base y no contra una impresión.
> 
> ### 1 · Sujetos del banco: 2 de 72 módulos distintos
> 
> `nefan-html/test/` tiene hoy **un** fichero de test, con **2 tests**, y sus sujetos importados de `src/` son **dos**: `ui/titulo/chasis.ts` y `ui/titulo/selector-de-mundo.ts`. El cliente tiene **72** `.ts` no-`.d.ts`.
> 
> Con #663 (la séptima pareja de ids, que suma `ui/titulo/home.ts`) serían **3 de 72**.
> 
> La señal que este issue escribió es «cuando el banco tenga sujetos de varios módulos distintos, de forma que un suelo se pueda MEDIR sobre una base y no sobre un caso». Dos —los dos del mismo asunto, la costura de ids del título— no es una base.
> 
> ### 2 · Hallazgo nuevo: la cobertura del banco del cliente MIDE CORE
> 
> `node --import tsx --test --experimental-test-coverage test/*.test.ts` (el `npm test` canónico, más la bandera) da **88,89 % líneas · 90,91 % ramas · 25,40 % funciones**. Pero **seis de los ficheros de esa tabla son de `nefan-core`**, porque el cliente los importa por ruta relativa:
> 
> ```
> nefan-core/src/config.ts                          92.92
> nefan-core/src/contracts/service-registry.ts      58.20
> nefan-core/src/games/style-refs.ts                56.63
> nefan-core/src/session/eleccion-de-estilo.ts      50.00
> nefan-core/src/session/gates-de-imagen.ts         64.29
> nefan-core/src/session/pertenencia-del-registro.ts 44.57
> ```
> 
> Un suelo sacado de ahí **mediría `nefan-core` dos veces**, y la segunda con una muestra peor que la suya propia. Antes de que el cliente entre en `quality-thresholds.json` hay que decidir qué se recorta de esa tabla — y eso no estaba en el issue.
> 
> ### 3 · Hallazgo nuevo: la cifra depende del INVOCADOR
> 
> El mismo banco, el mismo árbol, el mismo commit, dos formas de arrancar el runner de Node:
> 
> | Invocación | Líneas | Ramas | Funciones |
> |---|---|---|---|
> | `node --import tsx --test …` (el `npm test` del `package.json`) | **88,89 %** | 90,91 % | **25,40 %** |
> | `npx tsx --test …` | **52,95 %** | 85,71 % | **7,84 %** |
> 
> Treinta y seis puntos de diferencia en líneas. **Un suelo puesto sin fijar antes EL comando es una lotería**, y esta casa ya pagó por eso: en la tanda G se retiró una «subida de cobertura» que era ruido entre dos lecturas del mismo árbol.
> 
> ### 4 · Media pregunta del issue ya está contestada, por #241
> 
> El cuerpo pregunta si una cobertura alta sobre presentación derivada significa algo. Para la **lógica** la respuesta ya se dio y se ejecutó: se mueve a core. `ui/hablar-con-un-npc.ts` y `world/frontier.ts` **ya no existen en el cliente**, y el candado `la-logica-de-juego-no-vuelve-al-cliente` lo sujeta con ocho grupos. Lo que queda por decidir es solo **presentación**, que es un problema más pequeño que el que el issue describe.
> 
> **Se queda abierto**: es una decisión viva con señal escrita, y ahora con base. Relacionado: #663 (que la mueve de 2 a 3), #636, #241.
> Decisión del usuario (2026-09-24): **entra ya, con cola aparte.** CRAP del cliente con su propio comando y su propio tope de no-empeorar, separado del núcleo.

## Criterios de aceptación

Los fija el crítico. Mínimos: lógica en core; negativos en rojo; guion si hay algo observable; cero créditos (motor falso, `e2e-sin-creditos`).

### Criterios del crítico (2026-09-24), aceptados por el coordinador

1. **Un comando fijo** en `nefan-html` escribe `nefan-html/coverage/lcov.info` (gitignorado). El CRAP y la cobertura del cliente se calculan con **las mismas** `lineasDeCodigo`/`cuentaLineas`/`functionsOf` de `nefan-core/scripts/crap-score.ts`, sin copiarlas. La tabla física de Node no decide nada. Negativo: el mismo árbol medido con `node --import tsx --test` y con `npx tsx --test` da el mismo peor CRAP y una cobertura a menos de 0,2 pts (hoy: 49,08 frente a 48,99).
2. **Solo se mide `nefan-html/src/`.** Los `../nefan-core/…` del lcov se descartan, y en eso hay un test. Hoy son 14.
3. **La medida es monótona: añadir un test no puede poner el gate rojo.** Los ficheros del cliente que ningún test carga (hoy 60 de 79, 7310 líneas de código) cuentan como medidos a cobertura 0, o se declaran «sin ejercer» con su número. Nunca desaparecen en silencio. Negativo: un test nuevo que solo IMPORTA un fichero hoy invisible no cambia el veredicto de `--check`.
4. **El contrato es un fichero hermano** en `nefan-core/data/contract/` (precedente: `client-file-size.json`), validado por esquema. Trae un tope de CRAP **de no-empeorar** MEDIDO sobre la base del criterio 3, con su margen declarado y medido. **No lleva suelo de cobertura global del cliente** en esta tanda: no hay base que lo justifique (≈11 % sobre el cliente entero, 49 % sobre lo cargado).
5. **`npm run deuda` saca el cliente en un bloque propio.** Ese bloque tiene su fuente, su aviso de frescura y una línea que dice cuántos ficheros o líneas del cliente no ejerce ningún test. No se mezcla con el bloque del core, y la regla «cobertura 0 entra siempre» no se le aplica de forma que la cola pase de ~40 items a ~650.
6. **CI:** el paso corre en el job `nefan-html` con `--check`. Medido: el coste marginal es de 2 s o menos.
7. Negativos en rojo: una función nueva en `src/` por encima del tope pone el gate rojo, y sin lcov del cliente el comando falla en vez de dar cola vacía.
8. Sin guion de `qa/`: nada de esto es observable por el jugador. Cero créditos.

## Restricciones

- **Números de guion RESERVADOS: 218-221.** Otras tandas en paralelo: AX (atlas, `politica-de-atlas`/`fps-atlas`), BB (título), y las otras de esta ola (BE mapa/motor, BF CRAP del cliente, BH detectores del banco).
- Lint del banco en main: `no-unused-vars`, `no-useless-assignment`, `preserve-caught-error` con `requireCatchParameter`.
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node`.
