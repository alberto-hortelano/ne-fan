# Requisitos — la verificación deja de mentir (#210 + #192)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo
> que puedas con el flujo de agentes»

Es la orden de vaciar la cola de issues abiertos del repo (24 tras la retirada del cliente
Godot y de las dos vistas). Esta tanda es la **primera** y se salta el orden numérico a
propósito, por el motivo que va abajo.

## Por qué esta tanda va antes que las otras trece

Quedan trece tandas por delante. Cada una que toque el cliente termina con el ingeniero y con
QA corriendo `node qa/run.mjs`, y **esa batería da rojo una de cada dos corridas** (#210). Un
veredicto que es moneda al aire no sirve para juzgar nada de lo que viene detrás: en cuanto se
normaliza «vuelve a lanzarlo», la batería deja de distinguir un fallo real de un fantasma, que
es exactamente lo que existe para hacer. #192 viaja con él porque es el mismo problema visto
desde otra herramienta: la medida de CRAP/cobertura que **corre el CI** (`ci.yml:41`,
`npm run crap -- --check`) tampoco es reproducible.

## Los dos issues

### #210 — «La batería de qa/run.mjs es intermitente: dos guiones dan rojo una de cada dos corridas»

En la corrida completa de la retirada de Godot fallaron `05-terreno-desde-ground` y
`07-npc-clave-del-skin`; **aislados pasan**, y la segunda corrida completa dio 11/11. No es
regresión de esa tanda: es un problema de la suite en sí.

Hipótesis del issue, por orden de coste: contaminación entre guiones (comparten stack y
bridge) · carrera con el arranque (`ensureStack` espera a los puertos, no a que el bridge
tenga la sesión lista) · orden (correr la batería al revés y ver si caen otros dos).

### #192 — «El check de CRAP es no determinista: la misma función sin tocar mide 196.1 o 200.3»

`npm run crap -- --check` fue una moneda al aire en `main`: el run 32497019842 falló con
`validateScene · CRAP 200.3` (tope 200) sin que ninguna PR tocara esa función. La misma
función sin tocar dio 196.1 / 196.2 / 196.7 / 200.3 según la pasada.

Lo que el issue ya descartó **midiendo**, no suponiendo:

1. **No es la paralelización**: con `--test-concurrency=1` sigue oscilando (196.2 vs 200.3).
2. **No hay reloj ni azar en los tests**: `Math.random`, `Date.now()` y `new Date()` sobre
   `test/*.test.ts` salen a cero.
3. **No es solo `validateScene`**: entre dos pasadas idénticas se mueven también
   `handle · bridge/state-http-server.ts`, `buildVolumePrimitives`, `formatDToWorld` y
   `applyReducer`, **en direcciones opuestas**. Todas son de las funciones más grandes; las
   pequeñas no se mueven.

El dato que señala dónde mirar: diff del lcov de `src/scene/scene-validate.ts` entre dos
pasadas, mismo número de líneas registradas (647) y **19 líneas que cambian de HIT a MISS** —
incluida la línea de declaración de la propia función, con líneas de su cuerpo cubiertas en
ambas. Eso apunta a la instrumentación (`--experimental-test-coverage` + source maps + tsx)
antes que a un test que corra distinto. **Pero son ramas de error concretas y completas las que
se apagan**, así que hay que confirmarlo: si de verdad hay un test que a veces no llega a
ejercerlas, el problema es mucho peor que el umbral.

## Lo que ya se ha verificado sobre el repo (no hay que volver a averiguarlo)

Todo esto está comprobado sobre `main` en el commit `eb1142b`. Son rutas y líneas reales.

### #210 — la batería es ESTATAL, y hay dos focos concretos

- `qa/run.mjs` **no limpia nada entre guiones**. El único borrado es `rmSync(SHOTS)` de
  `qa/capturas/` **una sola vez antes del bucle** (`run.mjs:193`). El bucle (`run.mjs:204-229`)
  hace `browser.newPage()` → `page.goto` → `import(guion)` → `page.close()`. Cero reinicio del
  bridge, cero borrado de saves, cero purga de la cola de tiles, cero limpieza del snapshot.
- Se comparte **el stack entero** (mismo bridge, mismo fake-ai-server, mismo disco). El
  navegador se comparte pero no el contexto: `newPage` da localStorage/cookies limpios.
- Orden: alfabético y secuencial (`run.mjs:183-186`) — 01, 02, 03, 05, 06, 07, 08, 09, 10, 11,
  12, 13. URL fija `?input=scripted&ai=http://127.0.0.1:18765&raf=timer` (`run.mjs:48`).
- `ensureStack` (`run.mjs:82-111`) sondea tres puertos (18765, 9877, 3000); si los tres están
  vivos NO arranca nada y no para nada al final.

**Foco A — el fake-ai-server tiene estado de proceso que nunca se resetea.**
`labs/narrative/fake-ai-server.mjs`: `fakeDialogueTurn` (:41), `tileByKey` (:49),
`surfaceImages` (:378), `fakeDevCacheEnabled` (:39). El guion **07** afirma sobre el **número
de peticiones** a `/skin_sprite_sheet` (líneas 49-57, contador; 180-187, `esperarPeticiones`
con polling de 200 ms y topes de 90 s y 60 s) y el cliente distingue `data.cached`
(`nefan-html/src/ui/style-apply.ts:335,366,373`). Con la caché caliente de un guion anterior
salen **menos peticiones de las esperadas** y el guion agota el tope.

**Foco B — el guion 05 depende de un fichero que él mismo muta.**
`qa/guiones/05-terreno-desde-ground.mjs` usa el world snapshot
`nefan-core/data/games/alta_fantasia/world/tile.json` (escrito por `writeWorldSnapshot`,
`src/games/world-snapshot.ts:109-118`, desde `bridge/context.ts:114`) y en las líneas 193-239
camina al este, acepta la propuesta y **genera un tile nuevo que queda persistido ahí**. La
corrida N deja el disco distinto para la N+1. Además espera 180 s por el tile y 60 s por la
propuesta: si la cola de generación (`bridge/scene-gen-queue.ts`, singleton FIFO con dedupe por
key) viene ocupada de un guion anterior, esos topes son la ventana.

### #192 — cómo se mide hoy

- El script es `nefan-core/scripts/crap-score.ts` (no `crap.ts`). **No** corre la suite: lee el
  lcov ya escrito en `nefan-core/coverage/lcov.info` (`crap-score.ts:28`), parsea solo `SF:` y
  `DA:` (`lineHitsFromLcov`, :122-136) y falla duro si falta (`:161-164`).
- Ese lcov lo produce `npm run coverage` = `node --enable-source-maps --import tsx --test
  --experimental-test-coverage --test-reporter=lcov ... test/*.test.ts`.
- CRAP = `complexity² × (1-coverage)³ + complexity` (`crap-score.ts:138-140`), con complejidad
  de McCabe sobre el AST (`complexityOf`, :45-80). Solo mide `src/`, `bridge/`, `services/`.
- Umbrales en `nefan-core/data/contract/quality-thresholds.json`: `crap.max = 170` y
  `cobertura_lineas.min = 89`, ambos gates de `--check` (`crap-score.ts:237-256`).
- **No hay `--test-concurrency` fijado en ningún sitio** (ni package.json, ni workflows). Con
  `node --test test/*.test.ts` eso significa un proceso por fichero y concurrencia = CPUs
  disponibles, distinta en local y en el runner. Es la variable que explica la brecha declarada
  entre entornos (90.1-90.2 local vs 90.7 en CI).
- Tests con esperas por reloj, candidatos a que una rama se ejecute o no según la carga:
  `test/narrative-state.test.ts:126` (`setTimeout 5`), `test/scene-gen-queue.test.ts:23`
  (`setTimeout 5`), `test/vocabulary.test.ts:185` (`setTimeout 20`), `test/helpers.ts:168-171`
  (`waitFor` con `Date.now()` y polling de 5 ms, que lanza al agotarse).
- Ficheros temporales: **no** hay contaminación, todos usan `mkdtempSync` con prefijo único.
- `test/repo-hygiene.test.ts:66` corre `git ls-files -s` sobre el repo real y
  `scripts/arch-collect.ts` recorre el disco: dependen del árbol de trabajo, no de fixtures.
- En CI la suite entera corre **dos veces** por job (`npm test` y luego `npm run coverage`).

**Corrección importante del enunciado de #192**: el síntoma que cita —`validateScene · 200.3`
contra un tope de 200— **ya no puede reproducirse**. La PR #194 partió `validateScene` en ocho
pasadas y hoy el tope es 170, con el peor valor de la casa en 159.0 (`handle` de
`bridge/state-http-server.ts:151`, complejidad 158). La nota de `quality-thresholds.json`
declara esos diez puntos de margen como «unas tres veces el ruido observado» y dice
explícitamente que **el margen muere cuando `handle` se parta por concepto**. O sea: el CI no se
va a poner rojo mañana por esto, pero la no-determinación sigue viva y hoy es barata de atacar.

## Criterios de aceptación

1. **La causa de #210 está IDENTIFICADA con una medida, no con una hipótesis.** Antes de tocar
   nada hay que reproducir la intermitencia y demostrar de dónde sale. Si al medir resulta que
   los focos A y B de arriba no son la causa, se dice y se persigue la que sea.
2. **`node qa/run.mjs` da 12/12 (son 12 guiones: no existe el 04) en CINCO corridas completas consecutivas**, arrancando el stack
   desde cero, sin `--keep` y sin tocar nada entre medias. Una sola corrida verde no demuestra
   nada: es exactamente lo que ya pasaba.
3. **La batería es independiente del orden**: correr los guiones al revés (o en un orden
   distinto) da el mismo veredicto. Si eso exige un mecanismo de reset, el mecanismo se escribe.
4. **Ningún guion pierde poder de detección.** Un guion que deja de afirmar algo para dejar de
   ser intermitente es una regresión disfrazada de arreglo. Si un aserto es intrínsecamente
   frágil (afirma sobre una ventana de reloj, o sobre un contador que depende de una caché),
   la respuesta es que el juego lo RECUERDE —un recuento en `debugState()`— como ya se hizo con
   `fps().telegraphEpisode` en el guion 10, no bajarle el listón al guion.
5. **#192: se separan las dos causas posibles y se dice cuál es.** Con N pasadas de
   `npm run coverage` y diff de los lcov: (a) un test que a veces no ejercita una rama —grave,
   se arregla el test— o (b) ruido de instrumentación —se hace robusta la medida—. La respuesta
   va escrita con los números que la sostienen.
6. **`npm run crap -- --check` da el mismo veredicto en tres pasadas consecutivas**, y la
   función que se mueva no mueve más de lo que declare la nota del umbral.
7. **No se toca ningún umbral de `quality-thresholds.json`.** La nota del fichero explica que
   están medidos sobre la línea base real; subirlos para tapar el ruido es exactamente la
   trampa que el candado existe para impedir. Si al terminar el ruido baja y el margen sobra,
   eso es una PROPUESTA para el informe, no un cambio de esta tanda.
8. `npm run verify` verde y el CI de la PR entero en verde.

## Fuera de alcance

- Partir `handle` de `bridge/state-http-server.ts` por concepto. Es el siguiente candidato
  obvio y lo pide la nota del umbral, pero es otra tanda: aquí solo se arregla la MEDIDA.
- Meter `qa/` en el CI. Hoy no corre allí y no es objeto de esta tanda.
- Los otros 21 issues abiertos.
- Cambiar los umbrales (ver criterio 7).

## Preguntas abiertas

- Si la causa de #192 resulta ser la instrumentación de `--experimental-test-coverage` y no
  hay forma barata de hacerla determinista, ¿cuál es la salida? Opciones a valorar en el plan,
  con su coste: fijar `--test-concurrency`, tomar el peor de N pasadas en el gate, cambiar de
  fuente de cobertura, o medir cobertura por función en vez de por línea. **Recomendación
  esperada, no un empate.**
