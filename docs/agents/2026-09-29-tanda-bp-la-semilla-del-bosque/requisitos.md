# Tanda BP — El `seed` de `vegetation_zones` que el motor escribe como número

## Petición del usuario (literal)

«Sigue cerrando todos los issues que puedas de forma autónoma. El objetivo es reducirlos al mínimo» (2026-09-24, retomada el 2026-09-29). La regla de la jornada es que lo que sale de un playtest se resuelve en una tanda, sin abrir issues.

## Lo medido

En los dos playtests con el motor real del 2026-09-29 (tanda BM, fases 1 y 4; material en `/home/al/code/ne-fan/labs/narrative/runs/tanda-bm-20260929/`), **4 de 4 motores** escribieron `vegetation_zones[i].seed` como NÚMERO. El zod (`nefan-core/src/scene/blueprint/vegetation.ts:130`, `z.string().min(1).max(64).optional()`) lo rechaza (`rechazo forma_escena`) y el motor tiene que volver a responder: un viaje de ida y vuelta extra por tile. La prosa (`data/contract/prompts/tile_instructions.md:254`, `:308`) escribe `"seed"?` sin decir qué tipo es.

## Qué se pide

Que el `seed` deje de costar un rechazo en cada motor, sin romper el fail-loud al modelo (memoria «Fail-loud al modelo»: nunca sanear en silencio). Las dos salidas evidentes son:
- (a) decir el tipo en la prosa y en el schema del tool;
- (b) que el contrato admita un entero, si un seed numérico tiene sentido en el dominio. Eso NO es sanear: es el tipo declarado. Tendría que pasar por el zod único, el espejo Python, los prompts generados y la clave de determinismo del scatter.

El crítico decide. Todos los agentes en Opus. Guiones reservados: 290–299. NUNCA `git stash`.
