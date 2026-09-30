# Tanda BQ — Las cuatro funciones congeladas del CRAP de `scripts/`

## Petición del usuario (literal)

«Mutacion lanzada, adelante» (2026-09-30), en respuesta a la propuesta del coordinador: mientras mide la corrida completa, atacar la cola de `npm run deuda`, empezando por los scripts sin cobertura. El marco de la jornada anterior sigue vigente: «Sigue cerrando todos los issues que puedas de forma autónoma. El objetivo es reducirlos al mínimo». Hoy los issues abiertos son solo los tres de plugins, que están aparcados, así que la cola sale de `npm run deuda` y no de GitHub.

## Lo medido (2026-09-30, `main` 0afb76c3, `npm ci` + `npm run build` + `npm run coverage` frescos)

Bloque «Scripts» de `npm run deuda`: 42 items. Las cuatro congeladas de `data/contract/scripts-crap.json` siguen igual que al entrar en #777. Las cuatro son un `main` o un impresor de CLI con cobertura 0:
- `scripts/manifest-kinds-con-productor.ts` `main`: CRAP 272, complejidad 16.
- `scripts/deuda.ts` `main`: CRAP 240, complejidad 15.
- `scripts/afectado.ts` `imprime`: CRAP 110, complejidad 10.
- `scripts/salud-sprite-forge.ts` `main`: CRAP 90, complejidad 9.

Por encima del objetivo (30) y con cobertura 0 hay además `crap-score.ts` `tsBajo` (72), `ejercicio-de-bateria.ts` `coberturaDe` (72), `manifest-kinds-con-productor.ts` `parseArgs` (56), `crap-score.ts` `mainConFoto` (42) y `deuda.ts` `walk` (42).

## Qué se pide

Que esas funciones dejen de ser lógica sin ejercer. Según «Las métricas son síntomas», el problema no es el número: es decisión metida en un `main` de CLI donde ningún test llega. El remedio conocido del repo es sacar la decisión a funciones puras con test y dejar el `main` como cableado. Al terminar se corre `npm run crap -- --scripts --apretar` para bajar o quitar las congeladas; nunca se sube una.

El crítico decide si las cuatro, o cuáles, merecen el trabajo. Por ejemplo, `salud-sprite-forge.ts` es un sondeo de servicio: ¿tiene decisión dentro, o es cableado puro que se ejerce por subproceso? También decide si el resto de la lista entra en la tanda. Y avisa si hay solapamiento con la tanda BR, que va en paralelo sobre `services/asset-store/http-server.ts` y `src/scene/scene-normalize.ts`.

## Restricciones

- Hay una corrida de mutación completa en marcha (run 36684509746) sobre `main` 0afb76c3. No se toca el tag `mutacion-ultima` ni `reports/mutation/`.
- Todos los agentes en Opus. Guiones reservados: 300–309.
- NUNCA `git stash`. Para medir la base, `git worktree add` temporal en el scratchpad.
- Gotcha local: en el árbol principal, `nadie-inventa-un-puerto` sale rojo por los ficheros ignorados de `labs/narrative/runs/tanda-bm-20260929/`. En un worktree limpio no pasa.

## Qué se pide (reencuadrado por el crítico; el coordinador lo acepta el 2026-09-30)

**Alcance, tras la crítica (medido 2026-09-30 sobre 0afb76c3):**
- SÍ `scripts/manifest-kinds-con-productor.ts` `main` + `parseArgs`: el orden de las guardias (blobs archivados → store parado → DB) es la decisión que protege material pagado y hoy no la comprueba nadie.
- SÍ `scripts/ejercicio-de-bateria.ts` `coberturaDe`: la regla «entre dos volcados del mismo fichero, el de más llamadas» protege el gate de ejercicio contra su falso negativo y no tiene test.
- SÍ `scripts/deuda.ts` `main`, por barato: la decisión de qué bloque sale, cuántos y cuántos «…y N más» se afirma en los tests; la redacción no.
- NO `scripts/afectado.ts` `imprime` ni `scripts/crap-score.ts` (`tsBajo`, `mainConFoto`): los dos ficheros son instrumento de mutación y tocarlos pide la corrida completa (71/71 módulos) detrás de la que ya está en marcha. `imprime` se hará en la próxima PR que tenga que tocar `afectado.ts` por otro motivo.
- NO `scripts/salud-sprite-forge.ts` `main` ni `deuda.ts` `walk`: el primero es cableado (el veredicto ya es puro y lo ejerce `start.sh`); el segundo es un recorrido de directorios que ejerce el propio `npm run deuda`.
- Criterio de cierre: `npm run crap -- --scripts --apretar` quita `deuda.ts main` y `manifest-kinds-con-productor.ts main` de `congeladas`, y quedan dos. El suelo de cobertura se re-mide y se aprieta con la cifra de CI de la PR, según su propia nota.
