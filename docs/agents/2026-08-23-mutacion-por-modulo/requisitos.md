# Requisitos — mutación: partir la corrida y ampliar los objetivos (#176 + #168)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo
> que puedas con el flujo de agentes»

Tercera tanda de la operación de vaciar la cola. Los dos issues van juntos y **#176 primero
aunque tenga número mayor**: sin partir la corrida, ampliar objetivos multiplica un coste que
ya son ~2 h de CPU.

## Los dos issues

### #176 — «Partir la corrida de mutación por módulo: ~24 min de CPU en vez de ~2 h (5x)»

> `stryker.config.json` usa `testRunner: "command"` con `coverageAnalysis: "off"` — no existe
> runner de Stryker para `node:test`, así que **la suite entera corre una vez por cada mutante**.
>
> Censo: **1695 mutantes** = 292 `scene-normalize` + 1362 `plugins/dsl` + 41 `combat-resolver`.
> El comando de `test:mutate` cuesta **4,23 s de CPU**. Total ≈ **2 h** (~16 min de reloj con
> `concurrency: 10`).
>
> Traza de imports: solo `plugins-dsl.test.ts` alcanza el DSL y solo `combat-resolver.test.ts`
> alcanza el resolver. Para **1403 de 1695 mutantes (83 %)** los demás ficheros de test no
> pueden matar nada.
>
> **El arreglo**: un config + script de npm por objetivo, para que cada módulo corra solo los
> tests que pueden matarlo. Estimado: **~24 min de CPU frente a ~2 h**.
>
> **El obstáculo**: `npm run deuda` (`scripts/deuda.ts`) lee un único
> `reports/mutation/mutation.json`. Partir la corrida exige fusionar los informes (la clave
> `files` es un dict por ruta, así que la fusión es directa) o enseñar a `deuda.ts` a leer varios.
>
> **Lo que NO es la solución**: se probó `incremental: true` y no sirve como palanca general:
> con `testRunner: "command"` Stryker no hashea los ficheros de test, así que la caché no se
> invalida al editar un test. Medido: vaciar dos ficheros de test y re-correr devuelve el score
> viejo en 3 s. Por eso `npm run mutate` pasa `--force` y la caché vive en `npm run mutate:quick`.

### #168 — «Ampliar mutation testing más allá de 3 módulos»

> `stryker.config.json` muta solo 3 objetivos. Todo lo demás **no está medido**, que no es lo
> mismo que estar bien.
>
> Dato que lo justifica: `scene-normalize.ts` tiene **97 % de cobertura y 45 % de score de
> mutación**, con 206 mutantes vivos (84 de ellos condicionales que se pueden fijar a `true` sin
> que ningún test se queje). Si el módulo mejor cubierto del core está así, el resto no va a
> estar mejor.
>
> **Candidatos** (puros, ya blindados por las reglas de frontera): `src/scene/blueprint/**`,
> `src/scene/stage/greybox.ts`, `src/world-map/**`, `src/store/reducers.ts`.

**Corrección al enunciado de #168**: `src/scene/stage/greybox.ts` **ya no existe** —
`src/scene/stage/` se fue entero con la vista de proscenio. Ese candidato hay que sustituirlo
o quitarlo; el equivalente vivo del greybox está en `src/scene/blueprint/greybox.ts` y
`src/scene/greybox/**`.

## Lo que ya se ha verificado sobre el repo (no hay que volver a averiguarlo)

- **`stryker.config.json`**: `testRunner: "command"`, `commandRunner.command = "npm run
  test:mutate"`, `coverageAnalysis: "off"`, `incremental: true` con
  `incrementalFile: "reports/stryker-incremental.json"`, `concurrency: 10`, `timeoutMS: 10000`,
  `jsonReporter.fileName = "reports/mutation/mutation.json"`, `thresholds {high:80, low:72,
  break:72}`, `tempDirName: ".stryker-tmp"`. `mutate` = los tres patrones.
- **La asimetría exacta**: `test:mutate` nombra **8 ficheros de test** (`scene-normalize`,
  `tile`, `terrain-collision`, `scene-expand`, `plugins-dsl`, `tile-greybox`,
  `blueprint-collision`, `combat-resolver`) para **3 patrones** de `mutate`. Con
  `coverageAnalysis: "off"` cada mutante corre los ocho.
- **`scripts/deuda.ts`**: ruta **única y hardcodeada** en la línea 39
  (`join(coreRoot, "reports", "mutation", "mutation.json")`), un `existsSync` (:198) y un
  `readFileSync` (:206). Del informe solo usa **tres cosas**: las claves de `files`, y por cada
  mutante `status` y `mutatorName` (`location.start.line` está declarado en el tipo pero **no
  se usa**). Vivos = `Survived` o `NoCoverage`; score = `(total-vivos)/total*100`.
  Cruza con `stryker.config.json` (:195-197, :226-231) para avisar de objetivos sin datos, y
  compara el mtime del informe con el de todo `.ts` bajo `src`/`bridge`/`services` (:87-99)
  para marcar la medida como obsoleta.
- En `nefan-core/reports/mutation/` **ya conviven cuatro JSON** (`mutation.json` 25 MB,
  `validate-despues.json`, `validate-final.json`, `validate-net.json`) y `deuda.ts` solo mira el
  primero. `nefan-core/reports/` está gitignorado.
- **El candado existente**: `test/mutation-config.test.ts` (4 tests, corre en cada `npm test` y
  por tanto en CI): (1) todo objetivo de `mutate` casa con un fichero real —con `globSync` si
  lleva `*`—, (2) todo fichero de `test:mutate` existe, (3) `timeoutMS <= 15000` y el comando
  lleva `--max-old-space-size`, (4) `mutate` pasa `--force`. Nació porque un objetivo apuntaba a
  `src/combat/resolver.ts`, una ruta que **nunca existió**, y pasó meses midiendo el vacío en
  verde.
- **CI**: `npm run mutate` **no** corre en `ci.yml`. Vive en `.github/workflows/mutation.yml`
  con `workflow_dispatch` + `schedule: cron "0 3 * * *"`, y sube `nefan-core/reports/mutation/`
  como artefacto. Eso también hay que ajustarlo si la corrida se parte.

## Criterios de aceptación

1. **Cada objetivo de mutación corre solo los tests que pueden matarlo.** La traza de imports
   que justifica el reparto se demuestra, no se supone.
2. **El coste medido baja de forma sustancial** y el informe dice el número real (antes y
   después, en CPU y en reloj), no el estimado del issue.
3. **`npm run deuda` sigue funcionando y no pierde información**: ve todos los objetivos, su
   score y sus mutantes vivos por mutador, con la corrida partida. Si se fusionan informes, la
   fusión es determinista.
4. **`npm run deuda` sigue avisando de un objetivo sin datos.** Es la función que nació del
   fallo de «medir el vacío en verde» y no puede debilitarse al partir la corrida: hay que
   probarlo en negativo (quitar un informe y comprobar que avisa).
5. **`test/mutation-config.test.ts` cubre la lista partida**: que todo objetivo de cada config
   existe, y —lo nuevo— que **todo objetivo está asignado a exactamente un config** y que **los
   tests que ese config corre son los que pueden alcanzarlo**. Un objetivo huérfano de config es
   el mismo fallo de antes con otra cara.
6. **Objetivos ampliados** (#168) sobre los candidatos vivos, con `src/scene/stage/greybox.ts`
   sustituido por el equivalente vivo. Ampliar significa **medir**, no dejarlo configurado: el
   informe trae el score de cada objetivo nuevo.
7. Los mutantes vivos que aparezcan al ampliar **NO hay que matarlos todos en esta tanda** —
   eso es trabajo de otras—, pero sí quedar en la cola de `npm run deuda` para que se vean.
8. `.github/workflows/mutation.yml` sigue produciendo un artefacto útil con la corrida partida.
9. `npm run verify` verde y CI de la PR entero en verde.

## Fuera de alcance

- Cambiar de test runner (el `_comment` del config dice que ahí está la raíz del coste, pero es
  otra operación entera).
- Matar los mutantes que destape la ampliación.
- Meter `npm run mutate` en `ci.yml`.
- Los otros issues abiertos.

## Preguntas abiertas

- ¿Fusionar los informes en uno o enseñar a `deuda.ts` a leer varios? El issue apunta a que la
  fusión es directa; decide con el criterio de qué deja `npm run deuda` más difícil de romper.
- Con `incremental: true` en el config y `--force` en el script, ¿sigue teniendo sentido
  `mutate:quick` cuando la corrida esté partida por módulo? Puede que partir la haga innecesaria.
