# Tanda BK — #613

## Petición del usuario (literal)

> «Sigue cerrando todos los issues que puedas de forma autónoma. El objetivo es reducirlos al mínimo» (2026-09-24). El 2026-09-29, preguntado por los paraguas #613 y #618, eligió «Crítico primero»: el crítico dice qué parte se puede hacer ya y cuánto cuesta, y el usuario decide con eso delante.

## El issue #613

> Sale de la crítica de la tanda E (2026-09-16) y de la decisión del usuario sobre #538: **H10 sale entero a la sesión de diseño de combate**, porque partirlo arregla un tercio y congela los otros dos.
> 
> ## El síntoma
> 
> Mueres, pulsas `R`, y vuelves junto al enemigo que te mató — a 60/60 y a un paso. Muere, R, muere.
> 
> ## Las tres causas, medidas
> 
> 1. **Reapareces donde te mataron.** `puntoDeReaparicion` (`nefan-core/src/simulation/reaparicion.ts`), que desde #538 es **una sola regla** —se le retiró la rama que ningún llamante podía pisar— y es por tanto la costura limpia donde aterrizaría otra. **Sin issue propio hasta este.**
> 2. **El enemigo sigue `engaged` para siempre.** Campo privado, con pestillo y sin setter (`nefan-core/src/combat/enemy-ai.ts:46,87-88`). Es **#377**, abierto y `futuro`.
> 3. **Morir cura a TODOS los enemigos a tope.** `GameLoop.respawn` hace `c.health = c.maxHealth` por combatiente (`nefan-core/src/simulation/game-loop.ts:230-238`). Es **#325**, abierto y `futuro`. De aquí sale el «60/60» de la observación original.
> 
> ## Por qué junto y no por partes
> 
> Cambiar solo la (1) te manda lejos y deja al enemigo **enganchado y entero**: el bucle se afloja, no se rompe. Las tres son decisiones de juego, no correcciones, y las opciones de la (1) que ya están sobre la mesa —el `__player_start` del tile, el último punto seguro, o quedarse donde caíste con el enemigo desenganchado— solo se pueden elegir sabiendo qué se hace con las otras dos.
> 
> Las (2) y (3) están en `futuro` por la instrucción permanente del usuario: el combate es baja prioridad de calidad hasta que sea un plugin. Este issue no la contradice — la respeta poniendo las tres en el mismo sitio para cuando toque.
> 
> Relacionado: #538 (de donde sale, H10), #377, #325, #314.
> 
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
> 
> https://claude.ai/code/session_01XKRRYRsJWigoMEY4CL27ew

## Comentarios del issue

> Se fusiona aquí #325 («El combate no tiene economia: no hay curacion, morir resucita a todos los enemigos, y el primer enemigo cuesta hasta el 70% de tu vida»), por triaje del 2026-09-24. Su cuerpo sigue en #325 como referencia, y la evidencia de hoy está en el triaje: #325 sigue vigente como parte de este paraguas.
> Se fusiona aquí #377 («Un enemigo que te vio una vez te persigue para siempre: `engaged` no se suelta ni tiene correa»), por triaje del 2026-09-24. Su cuerpo sigue en #377 como referencia, y la evidencia de hoy está en el triaje: #377 sigue vigente como parte de este paraguas.

## Restricciones del coordinador

- Es un paraguas (fusiona issues anteriores): el crítico lo parte en piezas y da un veredicto por pieza, con su coste estimado (ficheros y módulos, y si es observable por el jugador).
- Todos los agentes en Opus. Worktree /home/al/code/ne-fan-tanda-bk, rama feature/tanda-bk.
- Rango de guiones reservado: 240–249.

## Alcance decidido por el coordinador tras la crítica (2026-09-29)

Solo la pieza **C2** de critica.md: morir no resucita a los enemigos que ya matamos. La decisión del usuario del 2026-08-31 dice «el muerto lo está para siempre», y la simulación tiene que respetarla igual que el save. La PR cita #613 **sin cerrarlo**. A, B, C1, D y E quedan fuera y se preguntan al usuario aparte.
