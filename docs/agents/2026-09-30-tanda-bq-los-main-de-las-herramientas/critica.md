**REENCUADRADA** — tres de las cuatro congeladas no, dos sí; y entra una de la lista secundaria que sí tiene decisión dentro. `afectado.ts` NO se toca: medido, tocarlo pide la corrida de mutación COMPLETA (71 módulos) justo detrás de la que está en marcha.

## El problema real, en una frase

Hay decisiones de las herramientas —el orden de las guardias de una purga de material pagado y la regla de fusión de la cobertura de `npm run ejercicio`— que ningún test comprueba; el resto de la lista es presentación o cableado que se ejerce al usarse, y el número alto que lleva no señala ningún riesgo.

## La premisa, afirmación por afirmación

Medido con `npm run crap -- --scripts` sobre el `coverage/lcov.info` de hoy (09:47): las cuatro cifras y las cinco secundarias del requisito salen **idénticas**; 4 congeladas, 9 sobre el objetivo, cobertura 80,99 % contra un suelo de 80,7.

- `manifest-kinds-con-productor.ts:214` `main` (272) — **cierto, y con decisión**. El corazón (`purgar`, `guardiaDeOrden`, `compararExport`) ya está fuera y tiene test (`test/manifest-kinds-con-productor.test.ts`), pero lo que protege el material pagado es el ORDEN que decide `main` (`:227-245`): primero los blobs archivados, después el store parado y después la DB. Ese orden no lo comprueba nadie. `parseArgs` (`:174`, 56) no está exportado. La purga ya se hizo una vez (`archivo/cache/manifest-retirado.json` existe), pero el script sigue vivo: el store se niega a arrancar y remite a él (`services/asset-store/kinds-con-productor.ts:28,73`).
- `deuda.ts:631` `main` (240) — **cierto, pero es presentación**. Pinta los bloques en texto o en md, con la paginación de `--top`. No hay decisión que pueda hacer daño; lo único que se consigue es que la congelada salga. Es barato.
- `afectado.ts:1125` `imprime` (110) — **presentación**, y la decisión (`seleccionar`) ya tiene test. Pero `afectado.ts` es **instrumento de medida**: `instrumentoDeMedida()` lo incluye (15 ficheros), y `seleccionar(ctx, ["scripts/afectado.ts"])` da `todos=true` sobre **71 de 71 módulos**. Lo he medido hoy; los otros cuatro ficheros dan 0 o 1 módulos.
- `salud-sprite-forge.ts:181` `main` (90) — **cableado**. El veredicto ya es puro y lo ejercen diez asertos (`test/salud-sprite-forge.test.ts`); `main` lee argv, lanza si falta `--url` o si `--espera` no vale, y lo ejerce `start.sh:595,649` en cada `play`. La respuesta que el requisito sugería es la buena: no hay decisión que sacar.
- `ejercicio-de-bateria.ts:281` `coberturaDe` (72) — **tiene decisión, y es la más cara de la lista**. Cuando dos volcados traen el mismo fichero, se queda el de más llamadas (`:291-294`). Si alguien lo cambia por «el primero», el gate de `npm run ejercicio` diría «solo cargado» de un fichero que sí se ejerció, o al revés. Es el falso negativo contra el que existe ese gate, y ningún test lo fija. No es instrumento (selecciona 0 módulos).
- `crap-score.ts` `tsBajo` (72) y `mainConFoto` (42) — `tsBajo` recorre directorios y `mainConFoto` es E/S que ya se declara así (`:958-959`), con la decisión fuera (`informeConFoto`, `planDeApretar`). Además `crap-score.ts` **también es instrumento**: `todos=true`, 71 módulos.
- `deuda.ts:110` `walk` (42) — recorre directorios dentro de `ultimoCambio`; lo ejerce el propio `npm run deuda`. No se toca.

## El día después (con el alcance recomendado)

- Para quien juega no cambia nada; es deuda declarada de las herramientas. Lo que se gana es que un cambio en el orden de las guardias de la purga, o en la regla de fusión de `ejercicio`, pase a romper un test.
- Salen dos de las cuatro congeladas (`deuda.ts main` y `manifest… main`) y quedan `afectado imprime` (110) y `salud main` (90), cada una con su motivo. `--apretar` solo baja cifras o quita entradas; el suelo de cobertura NO lo aprieta él, y su propia nota manda re-medirlo y apretarlo con la cifra de la PR.
- Lo que parecerá arbitrario dentro de un mes son los tests de un renderizador que comparan el texto entero: se rompen al cambiar una palabra y no defienden nada. Los de `deuda` tienen que afirmar la decisión (qué bloque, cuántos, cuántos «…y N más») y no la redacción.

## Conflictos

- **Dependencia oculta con la corrida en marcha (run 36684509746)**: cuando termine, el tag `mutacion-ultima` pasa a 0afb76c3. Una PR que toque `afectado.ts` o `crap-score.ts` hace que el siguiente `pendiente` pida otra vez los 71 módulos, por un cambio de `console.log`. Eso es pagar dos veces la corrida más cara del repo, y es la razón principal para dejar fuera `imprime`, `tsBajo` y `mainConFoto`. Si alguna vez hay que tocar `afectado.ts` por otro motivo, `imprime` puede ir en esa misma PR.
- **Con BR**: solapamiento pequeño y sin contradicción. `http-server.ts` (BR) y `manifest-kinds-con-productor.ts` (BQ) seleccionan los dos solo `asset-store-contrato` (medido). Si las dos PR caen en el mismo rango de mutación, ese módulo tendrá dos dueños candidatos, que es lo que la atribución ya sabe decir. Cada una edita su propio contrato: `scripts-crap.json` BQ y `quality-thresholds.json` BR. No encuentro más ficheros compartidos.
- Issues abiertos: solo #361-#363 (plugins, aparcados). No hay relación.

## Coste contra valor

Las tres funciones del alcance son unas horas de trabajo y no requieren mutación: `scripts/` está fuera del perímetro, y lo que toca solo selecciona `asset-store-contrato`, que no hay que pedir en esta tanda. `imprime` y los de `crap-score` costarían una corrida completa a cambio de nada que proteja. Si no se hiciera nunca, el riesgo real sería que alguien reordene las guardias de la purga o la fusión de cobertura sin que salte nada; el resto seguiría igual que hoy, sin ningún daño.

## Qué NO debería hacerse

- Tocar `scripts/afectado.ts` o `scripts/crap-score.ts` en esta tanda.
- Escribir tests de `manifest-kinds… main` que dependan de lo que haya en el `:8767` de la máquina: con un store arriba, el test cambia de resultado según quién esté trabajando.
- Subir o añadir congeladas. Ni tocar `reports/mutation/` ni el tag.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Alcance, tras la crítica (medido 2026-09-30 sobre 0afb76c3):**
> - SÍ `scripts/manifest-kinds-con-productor.ts` `main` + `parseArgs`: el orden de las guardias (blobs archivados → store parado → DB) es la decisión que protege material pagado y hoy no la comprueba nadie.
> - SÍ `scripts/ejercicio-de-bateria.ts` `coberturaDe`: la regla «entre dos volcados del mismo fichero, el de más llamadas» protege el gate de ejercicio contra su falso negativo y no tiene test.
> - SÍ `scripts/deuda.ts` `main`, por barato: la decisión de qué bloque sale, cuántos y cuántos «…y N más» se afirma en los tests; la redacción no.
> - NO `scripts/afectado.ts` `imprime` ni `scripts/crap-score.ts` (`tsBajo`, `mainConFoto`): los dos ficheros son instrumento de mutación y tocarlos pide la corrida completa (71/71 módulos) detrás de la que ya está en marcha. `imprime` se hará en la próxima PR que tenga que tocar `afectado.ts` por otro motivo.
> - NO `scripts/salud-sprite-forge.ts` `main` ni `deuda.ts` `walk`: el primero es cableado (el veredicto ya es puro y lo ejerce `start.sh`); el segundo es un recorrido de directorios que ejerce el propio `npm run deuda`.
> - Criterio de cierre: `npm run crap -- --scripts --apretar` quita `deuda.ts main` y `manifest-kinds-con-productor.ts main` de `congeladas`, y quedan dos. El suelo de cobertura se re-mide y se aprieta con la cifra de CI de la PR, según su propia nota.
