# Tanda BS — La huella de la corrida completa 36684509746 y sus suelos

## Petición del usuario (literal)

«Mutacion lanzada, adelante» (2026-09-30). El plan acordado al retomar era: cuando llegue la corrida completa, traer, repartir --comentar y fijar los suelos de los módulos «sin medir».

## Lo hecho por el coordinador

- `npm run mutacion -- traer 36684509746`: COMPLETA, 71 informes, sobre 0afb76c (rango f25da65..0afb76c).
- `comparar --timeouts reports/mutation-36038869260`: 0 nuevos y 4 resueltos (world-map.ts). Hay 2 «reverso» en `src/store/game-store.ts` (`onAll`, líneas 97-98), que pasan de NoCoverage a Survived. No son del instrumento: un test nuevo del rango ejecuta `onAll` sin afirmar su efecto.
- `repartir --comentar`: escribió `data/contract/mutacion-huella.json`, que está ya copiada a este worktree, movió el tag `mutacion-ultima` a 0afb76c3 y comentó en 17 PR. Los informes de la corrida están en `nefan-core/reports/mutation/` de este worktree.

## Qué se pide

1. Commitear la huella nueva.
2. Poner a lo MEDIDO los suelos `"sin medir"` de `mutation-targets.json` que el candado `un suelo sin medir caduca…` (test/mutation-config.test.ts) pone rojo con esta huella: `despertar`, `world-map-schema`, `busca-camino`, `narrative-state`, `session-storage` y los que haya. Se hace como las entradas previas: «Suelo PUESTO A LA MEDIDA de la corrida 36684509746», con mutantes, vivos y score escritos en su `porque`.
3. El lote 3 de la corrida salió en rojo por tres módulos bajo su break:
   - `serialize-llm`: 173 mutantes, 77 vivos, 55,5 % contra un break de 57.
   - `status-reparto`: 95 mutantes, 1 vivo, 98,9 % contra 100.
   - `status-motivo`: 99 mutantes, 1 vivo, 99,0 % contra 100.

   Los tres ficheros cambiaron en el rango, con dueños en los comentarios de repartir. La respuesta por defecto NO es bajar el break: es matar los supervivientes nuevos con un aserto (entra en el tope local: `npm run mutacion -- local <id>`, pero OJO, `local` sobreescribe `reports/mutation/` de ESTE worktree, lo cual está bien aquí y no en el árbol principal). Si un superviviente es equivalente, se demuestra y se escribe; solo entonces se toca el break, y con motivo.
4. `npm run verify` verde, `npm run mutacion -- local` de los módulos tocados en verde, y `npm run deuda` sin avisos de suelos caducados.

## Restricciones

- Todos los agentes en Opus. Guiones reservados: 320–329, si hacen falta.
- NUNCA `git stash`. No mover el tag, que ya está movido. No tocar `reports/` del árbol principal (`/home/al/code/ne-fan/nefan-core/reports`).
- Hay otras dos tandas en paralelo: BQ (`scripts/`) y BR (`services/asset-store`, `src/contracts/http.ts`). No se solapan con esto salvo en `mutation-targets.json`, que BR toca en la batería de `state-http-dispatch`. Hay que tocar solo las entradas propias para que el merge sea limpio.
