# Tanda BX — Terminar una conversación, y el encargo al motor en `--preset play`

## Petición literal del usuario (2026-09-30, jugando la demo)

> «La conversacion deberia tener un boton para finalizarla»

Y, al arrancar la demo con `./start.sh --preset play` (su salida, pegada por el usuario, termina en «Press Ctrl+C to stop everything…»):

> «No pone nada para pegar»

## 1. Terminar una conversación

**Hoy:**
- Con opciones en pantalla, el panel de diálogo (`nefan-html/src/ui/dialogue-panel.ts`) solo se cierra eligiendo una opción, y eligiéndola se manda una petición al motor.
- E, Espacio y Enter solo cierran una línea sin opciones.
- Esc solo cierra el texto libre (T).
- El jugador no tiene forma de irse sin contestar. El panel suelta el ratón, así que tampoco puede alejarse andando.

**Lo que se pide:**
- Un **botón visible** en el panel para terminar la conversación, en cualquier estado del panel: con opciones, sin opciones, escribiendo texto libre y durante el typewriter.
- También con teclado. Esc es lo esperable, pero ojo: hoy Esc también suelta o captura el ratón (`keyboard-input-provider.ts:90`) y cierra el texto libre. El arquitecto decide el orden y lo escribe.
- Al terminar, el panel se cierra y el ratón vuelve al juego igual que tras elegir una opción. Hay que poder moverse y atacar.
- **Pregunta para el arquitecto:** ¿se entera el motor de que el jugador cortó la conversación? «El motor decide» es memoria del usuario.
  - Opción A: nada va al motor.
  - Opción B: queda en el historial, sin petición al LLM, y el motor lo ve en su contexto la próxima vez.
  - Opción C: es un `narrative_event` más, que cuesta una ida y vuelta.
  - Proponer una con su motivo. El coordinador prefiere que no dispare una petición al LLM solo por despedirse: el propio motor lo marcó como coste en el playtest, porque «ofrecer como única opción una despedida cuesta un viaje de ida y vuelta extra».
- Hay que tener en cuenta la tanda BW, recién fusionada (#792): la réplica tardía va al registro si el jugador atacó, se alejó más de 18 m o cambió de tile. Si terminas la conversación y la réplica a tu última elección llega después, ¿qué pasa? El caso normal (elijo y espero) no debe romperse.

## 2. `./start.sh --preset play` no dice qué pegar en la terminal del motor

- `--preset` arranca «no interactivo» y se salta `pause_for_claude_code`, que es la única que imprime el encargo para el motor. `TUI_NEEDS_PAUSE` solo se calcula en el camino del TUI (`start.sh` ~1234).
- Resultado: un usuario que arranca por slug, como recomienda CLAUDE.md, no sabe qué pegar.

**Lo que se pide:**
- Con `--preset` y un motor en juego (narrative-mcp o ai_server seleccionados), se imprime el encargo, sin pausa interactiva porque no hay TTY, y se explica que el motor se engancha solo al primer `narrative_listen`.
- El encargo sale de UNA fuente: el candado de BW (`test/el-prompt-del-motor-no-enumera-kinds.test.ts`) ya lo mira; no se duplica el texto.
- Un candado se pone rojo si `--preset play` deja de imprimirlo.

## Restricciones de la sesión

- NUNCA `git stash`.
- No matar servidores ajenos. **El usuario tiene un stack `play` corriendo AHORA en los puertos por defecto y está jugando**: no se toca. `qa/run.mjs` elige su propio bloque; para `start.sh`, `NEFAN_PORT_OFFSET` o pruebas sin arrancar servicios.
- No tocar el tag `mutacion-ultima` ni `reports/mutation/` del árbol principal.
- `bateria-n.log` es de otra sesión.
- Worktree: `/home/al/code/ne-fan-tanda-bx` (rama `tanda-bx-terminar-conversacion`).
