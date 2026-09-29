**REENCUADRADA** — el paraguas es real y no está arreglado (ningún commit toca `reaparicion.ts`, `enemy-ai.ts` ni `GameLoop.respawn` desde #616), pero mezcla UN defecto con respuesta ya decidida por el usuario con cuatro decisiones de diseño, y es **mayor** de lo que dice su cuerpo: al fusionar #325 entero se tragó también la curación y el balance.

## El problema real, en una frase

Morir no cuesta ni enseña nada: vuelves al mismo sitio, contra el mismo enemigo, que sigue enganchado y a tope — y de paso resucita a los que ya habías matado.

## Las piezas, con su premisa verificada

| # | Pieza | Premisa hoy | Veredicto | Coste | Jugador |
|---|---|---|---|---|---|
| A | Punto de reaparición (H10 de #538) | Cierta. `reaparicion.ts:43-45` devuelve la posición del cadáver con `y=0`. | PREMATURA (decisión) | pequeño en código; ver nota | sí |
| B | Correa / desenganche (#377) | Cierta. `enemy-ai.ts:46` `engaged` privado, `:87` solo pasa a `true`. Y `respawn()` no toca `enemyAIs` (`game-loop.ts:220-251`): el enganche sobrevive a la muerte. | PREMATURA (decisión) | 1 módulo (`enemy-ai`) + su batería | sí |
| C1 | Morir cura a los enemigos VIVOS | Cierta. `game-loop.ts:232-238` pone `health = maxHealth` a todo no-jugador. | PREMATURA (decisión, va con A y B) | 1 línea de lógica, 1 fichero | sí |
| C2 | Morir RESUCITA a los MUERTOS | Cierta, y **contradice una decisión viva del usuario** (ver abajo). | **VIGENTE, hacer ya** | `game-loop.ts` + 1-2 tests; cero contrato | sí |
| D | No hay curación (#325 §1) | Cierta. `player_healed` solo aparece en `store/reducers.ts:28`; ningún productor en core, bridge, cliente ni narrative-mcp. | PREMATURA (mecánica nueva, diseño) | medio-grande: contrato del motor o sistema | sí |
| E | Balance / alcance 4 m vs 2,5 m, «nada te lo dice» (#325 §3) | A medias. El telegraph pinta ya los bordes del alcance durante el wind-up (`fps-gl.ts:1135`, `attackAreaReach`, #184 en `bcc8b080`). El balance sigue igual. | APARCAR | — | sí |

### Por qué C2 no es diseño

El usuario decidió el 2026-08-31 que **el muerto lo está para siempre**, y hay candado de ello en el SAVE: `session/mundo-persistido.ts:154,168,543` y el test `narrative-state.test.ts:1030-1046` («LA MUERTE ES ABSORBENTE… Esto es exactamente lo que hace `sim.respawn()` al pulsar R»). Pero el SIM no lo respeta: `removeCombatant` no tiene ningún llamante de producción (`game-loop.ts:85`), el muerto sigue en el mapa a 0 PV, `respawn()` lo sube a `maxHealth` y `getEnemyStates` (`bridge/context.ts:699`) lo manda al cliente con `alive: true`. Resultado observable: matas al bandido, mueres, pulsas R, y el bandido está de pie y pegando — hasta que reanudas, y entonces desaparece porque el save dice que está muerto. **Dos verdades en la misma partida**: el candado del save tapa el síntoma en disco y deja la contradicción en pantalla.

Es la única pieza cuya respuesta ya está escrita, y no cierra ninguna de las opciones de A, B ni C1. **No rompe el bucle** (el que te mata está vivo), así que no vende como arreglo de #613: se hace aparte y se dice así.

### Nota sobre el coste de A

Hoy el punto lo calcula el CLIENTE (`nefan-html/src/main.ts:527-537` llama a `puntoDeReaparicion` y manda `pos`) y el bridge se lo cree (`bridge/handlers/simulation.ts:277`, `ctx.sim.respawn(msg.pos)`). «Donde caíste» cabe ahí porque solo necesita el cadáver; cualquiera de las otras dos opciones que el issue pone sobre la mesa (el `__player_start` del tile, el último punto seguro) necesita estado de sesión que vive en el bridge. Cualquier regla que no sea la actual es, por tanto, **mayor** de lo que el issue sugiere: toca el mensaje `respawn` (`protocol/message-schema.ts:100`) además de la función. Quien decida A debe saberlo al elegir.

## El día después

- Con C2 hecha: el progreso de combate de la sesión deja de deshacerse en pantalla; el comentario de `narrative-state.test.ts:1037` pasa a describir un agujero cerrado (el candado del save se queda como defensa). Nada se vuelve más difícil.
- Con A+B+C1 hechas sin D: el bucle se rompe, pero la única forma de recuperar vida sigue siendo morir — y si C1 deja de curar a los vivos, morir se vuelve **más** caro sin que exista alternativa. Es exactamente el aviso de #325 («respawn sin curación → no tienes forma de recuperar vida»). A/B/C1 **dependen de D**, no solo entre sí.
- Puerta que conviene no cerrar: A, B, C1 y D viven FUERA de la costura de plugin de combate. `CombatSystem` (`combat/combat-system.ts:20-34`) solo cubre catálogo y resolución; `GameLoop.respawn` y `EnemyAI` son comunes a `standard`, `basic` y `shooting` (`combat/registry.ts`). La condición «el combate es baja prioridad hasta que sea un plugin» está cumplida en el registro, y **no desbloquea nada de esto**: lo único que lo desbloquea es que el usuario decida.

## Conflictos

- **#618** (paraguas NPC, contiene #298): solapamiento débil. #377 decía que la correa «va con #298»; hoy no chocan en código, porque el enemigo no usa `npc-behavior.ts` y se mueve en línea recta sin colisión (`enemy-ai.ts:126-131`, solo el clamp de `game-loop.ts:137-146`). Una correa «vuelve a su sitio» heredará el hueco de pathing de #618 el día que el enemigo colisione. Orden: da igual hoy.
- **Decisión del usuario 2026-09-16 (#538)**: «H10 sale entero a la sesión de diseño de combate». C2 no es H10 ni parte el trío A/B/C1; no la contradice.
- Sin conflicto con `arch-rules.json`: C2 es lógica de sim en core.

## Coste contra valor

- **C2**: horas, un fichero de lógica, observable, y alinea el sim con una decisión ya tomada. Vale lo que cuesta. No hacerla deja un enemigo que resucita en pantalla y desaparece al reanudar.
- **A+B+C1+D**: una sesión de diseño con el usuario (cuatro preguntas, ninguna técnica) y después una tanda de tamaño medio (sim, bridge, protocolo, y D posiblemente contrato del motor). No hacerlo nunca: el bucle sigue, pero con #616 ya no es un estado sin salida — el jugador puede irse andando. Molesto, no bloqueante.
- **E**: no se toca sin D; el usuario dijo en #325 que no se baja la dificultad para que algo pase.

## Recomendación

- **Hacer ya**: C2 — que `respawn()` no devuelva la vida a quien está a 0. Tarea propia, fuera del paraguas (o como primera PR de esta tanda citando #613 sin cerrarlo).
- **Aparcar en #613, como preguntas al usuario**: A (dónde reaparece, sabiendo que salir de «donde caíste» mueve la decisión al bridge), B (qué correa), C1 (¿morir cura a los vivos?), D (qué forma de curarse existe). Las cuatro juntas, porque D condiciona a C1.
- **Cerrar**: nada. Ningún trozo está resuelto; E tiene la parte de interfaz a medias resuelta por #184 y se queda como nota.

## Qué le cambiaría a `requisitos.md`

> **Alcance de esta tanda: solo C2.** `GameLoop.respawn` (`nefan-core/src/simulation/game-loop.ts:231-239`) no devuelve la vida a un combatiente que está a 0: el enemigo que mataste sigue muerto después de pulsar R, en el sim y en el cliente, igual que ya lo está en el save (decisión del usuario 2026-08-31, candado en `session/mundo-persistido.ts` y `test/narrative-state.test.ts` «LA MUERTE ES ABSORBENTE»). No se toca dónde reaparece el jugador, ni el enganche, ni si los enemigos vivos se curan: eso sigue en #613 para la sesión de diseño. Criterio: matar un enemigo, morir contra otro, pulsar R → el primero sigue `alive:false` en el `state_update` y no ataca. La PR cita #613 sin cerrarlo y le añade un comentario con las cuatro preguntas pendientes (A, B, C1, D) y la nota de que cualquier reaparición que no sea «donde caíste» mueve la decisión del cliente al bridge.
