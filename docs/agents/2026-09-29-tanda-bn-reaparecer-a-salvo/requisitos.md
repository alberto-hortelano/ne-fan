# Tanda BN — Reaparecer a salvo, el enemigo te suelta y la curación por consecuencias (#613)

## Petición del usuario (literal)

«Sigue cerrando todos los issues que puedas de forma autónoma. El objetivo es reducirlos al mínimo» (2026-09-24). El 2026-09-29, preguntado por las piezas de #613 tras la crítica (`critica-heredada-de-bk.md`, que es la crítica de #613 entero), eligió:

- Curación → **«Se cura por consecuencias»**: solo cura el motor narrativo (pociones, curandero), con una consequence `player_healed`. Al morir, los enemigos vivos SIGUEN curándose (pieza C1: se queda como está).
- Reaparición → **«Punto seguro + suelta (Recomendado)»**: reapareces en el último punto seguro (fuera de combate), y lo decide el BRIDGE, no el cliente. Al morir, todos los enemigos te sueltan.

## Alcance

Piezas A (dónde reapareces), B (el enganche se suelta, #377) y D (curación por consequence `player_healed`, que el motor pueda emitir y el sim aplique) de la crítica heredada. E (balance) queda fuera.

**Dependencia:** la tanda BK (rama `feature/tanda-bk`, en curso) arregla C2 con una guarda en `GameSimulation.respawn` (`game-loop.ts`) para que los muertos no resuciten. BN toca el mismo `respawn`: el plan tiene que asumir que BK entra antes, y el ingeniero rebasa sobre ella.

Cierra #613 si A, B y D quedan hechos; E se documenta como aparcado en el cierre.

## Restricciones

- Todos los agentes en Opus. Worktree `/home/al/code/ne-fan-tanda-bn`, rama `feature/tanda-bn`. Guiones reservados: 260–269.
- Contrato del motor: si `player_healed` entra como consequence, va por el zod único (`contract-model-io`) y los prompts; nada de validar a mano.
