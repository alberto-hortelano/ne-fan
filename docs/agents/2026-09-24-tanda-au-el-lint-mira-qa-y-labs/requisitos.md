# Requisitos — tanda AU: eslint mira qa/ y ruff mira labs/ (#733 #718)

## Petición literal del usuario

> «Sube node a latest, mientras estemos en desarrollo no fijamos version. Mutacion lanzada, sigue con la siguiente tanda. […]» (2026-09-24). Y la petición de fondo de la jornada: «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## Los issues, verbatim

### #733

> eslint no mira qa/: un import muerto vivió en bajo-carga.mjs porque lint es src bridge services test scripts
> 
> **«eslint no mira `qa/`»**. El import muerto `razonDeLaMedida` de `qa/bajo-carga.mjs` (retirado en esta tanda) vivió porque `npm run lint` es `eslint src bridge services test scripts`. Propuesta: meter `qa/**/*.mjs` en la corrida de lint, al menos con `no-unused-vars`, y medir cuántos hallazgos hay hoy antes de decidir si se congelan o se arreglan.
> 
> Sale de la tanda AO (#711).

### #718

> ruff no cubre labs/: hoy da 1 F841 y solo pasa compileall
> 
> CI y `ai_server/lint.sh` corren ruff solo sobre `ai_server/`; sobre `labs/` solo hay `compileall`. `ruff check labs` da hoy 1 `F841`. Si se quiere lint en los benches: limpiar ese `F841` y ampliar la ruta en `lint.sh` (una sola línea, porque CI y `verify` comparten el script). No es urgente, porque `labs/` no entra en producción.
> 
> Sale de la tanda AK (#709).

## Criterios de aceptación

Reescritos tras la crítica (veredicto REENCUADRADA, aceptado por el coordinador el 2026-09-24). Sustituyen a los cuatro originales.

1. (#733) `npm run lint` (y por tanto `verify` y CI) mira `qa/**/*.mjs` con **solo `no-unused-vars`** (`^_` exento, como en el paquete). Ni `recommended` ni `no-undef`: medido el 2026-09-24, dan 3314 hallazgos, 3254 de ellos globals del navegador y de Node. Restricciones medidas: ESLint 10 no lintará `qa/` con la config de `nefan-core` (queda fuera del base path), y bajo `qa/` no cabe un `.js` (`EXTENSIONES_DEL_BANCO`). Hoy salen **18** hallazgos en 13 ficheros; hay que volver a medir tras fusionar la tanda AR. **Cada uno se clasifica antes de tocarlo**: código muerto (se borra) o aserto prometido que no se hace (se hace, o se abre issue con el guion y la línea). Ninguno se borra sin esa línea en `implementacion.md`.
2. (#718) `ai_server/lint.sh` pasa ruff también sobre `labs/` y el `F841` de `labs/fps/gen.py:246` se limpia. Se decide y se escribe qué reglas recibe `labs/` (decisión del arquitecto en `plan.md`: las de ruff por defecto, `E4,E7,E9,F`, DECLARADAS en `labs/ruff.toml`, no heredadas en silencio). **El guion 162 se invierte**: su prueba «E741 en `labs/` → rc=0» (`:202-206`, y la prosa de `:20`) pasa a exigir rojo. Se barre la prosa que dice lo contrario en `ai_server/lint.sh:8-10`, `ci.yml:170-171` y en la fila 162 de `qa/README.md`.
3. Ambos probados en negativo: un import muerto sembrado en `qa/` y un `F841` sembrado en `labs/` ponen rojo el lint. Lo que el lint nuevo no mira se enumera, y como mínimo entra ahí `labs/**/*.{js,mjs}` (14 ficheros), que no los mira ningún eslint.
4. Se miden antes y después `npm run lint` y `verify`. Referencia de hoy: `npm run lint` 4,6-5,2 s; eslint sobre `qa/` 1,3 s con la regla sola y 2,8 s con la config TS. El coste de `verify` no crece de forma apreciable (el usuario decidió no encarecer el bucle interno).
5. Orden: detrás de la tanda AR (Node latest, retirada del reporter de #697). El conflicto en `nefan-core/package.json:30-31` se resuelve a mano al rebasar, y **tras rebasar se vuelve a medir** (hallazgos y tiempos) antes de fijar ninguna cifra.

## Restricciones

Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador.
