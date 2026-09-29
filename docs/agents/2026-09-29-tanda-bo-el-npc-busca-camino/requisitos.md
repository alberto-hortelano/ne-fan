# Tanda BO — El NPC busca camino: A* sobre la rejilla de colisión del sim (#618, pieza A + meta de D)

## Petición del usuario (literal)

«Sigue cerrando todos los issues que puedas de forma autónoma. El objetivo es reducirlos al mínimo» (2026-09-24). El 2026-09-29, preguntado «¿Lo pagamos?» sobre el A*, respondió: **«Sí, tanda propia (Recomendado)»**. La opción decía: «A* en nefan-core/src/simulation sobre la rejilla de sim-collision (ve las cajas de runtime); el steering actual queda como seguidor local entre waypoints».

## Contexto

`critica-heredada-de-bl.md` es la crítica de #618 entero. Esta tanda hace la pieza A y la parte de D que va dentro de A (una meta libre para el buscador). La tanda BL (rama `feature/tanda-bl`, en curso) hace B, la otra mitad de D y #298, sobre `npc-behavior.ts`. BO entra DESPUÉS de BL: el plan lo asume y el ingeniero rebasa.

Cierra #618 si A queda hecho y BL ya entró.

## Restricciones

- El algoritmo va como módulo PURO en `nefan-core/src/simulation/`, medido por la mutación (entrada en `mutation-targets.json` con el suelo medido).
- La rejilla la da quien conoce la colisión (`bridge/sim-collision.ts`): terreno, plan y cajas de runtime. NO la máscara de `scene-validate.ts`.
- Todos los agentes en Opus. Worktree `/home/al/code/ne-fan-tanda-bo`, rama `feature/tanda-bo`. Guiones reservados: 270–279.
- Observable por el jugador: el guion `qa/el-mundo-solido-tambien-para-el-npc.mjs` y uno nuevo tienen que mostrar que el NPC rodea (hoy pisa en el sitio 57 de cada 60 s).
