# Tanda BW — Lo que salió jugando (playtest del coordinador, 2026-09-30)

## Petición literal del usuario (2026-09-30)

> «sigue con #788 y prepara una demo para que la pruebe yo. Como si presentaras el estado del producto, con que funciona y que no. Pruebalo tu primero y luego me dices exactamente que hacer y que probar»

Antes de dar la demo al usuario, el coordinador la jugó entera en el preset `play`. El motor narrativo era un agente de Claude Code, el mundo `alta_fantasia` y el modo Maqueta 3D con y_bot, sin gasto. Esta tanda arregla lo que el usuario se va a encontrar jugando. Regla de la sesión: lo que sale de un playtest se arregla en la tanda.

Capturas en `capturas/`. Save de la partida: `saves/1790773005-1d9eea/state.json`, en el árbol principal `/home/al/code/ne-fan`; se lee, no se toca.

## Hallazgos

### H1 (grave) — La respuesta tardía del motor reabre el diálogo modal sin mirar el contexto

Dos síntomas con, a mi juicio, la misma causa. **El crítico debe verificar que es la misma.**

**a) En combate.**
- Hablé con Orio Candil y le provoqué con texto libre (T). El motor contestó con un hostil nuevo, Brasco (60 HP), y un diálogo de Orio con opciones.
- Elegí «Me encargo de tu matón y luego de ti»: el panel se cerró y empezó la pelea.
- ~7 s después llegó la réplica de Orio a esa elección («¡Eso, eso, encárgate de Brasco!…»), y el panel de diálogo se volvió a abrir en mitad del combate.
- Con el diálogo abierto, `puedeAtacar()` da `{dialogo: true, ok: false}` (`nefan-html/src/dev/nefan-hook.ts:294`, `dialogoAbierto` en `main.ts:327`), y el panel suelta el pointer lock.
- La simulación del bridge NO se pausa, así que Brasco siguió pegando: cuatro «Player hit» de −12 a −21 HP mientras yo no podía atacar. Caí con Brasco a 21/60. Captura: `capturas/demo-17.png`.

**b) Tras un viaje.**
- En la posada elegí una opción con Maela y, sin esperar la réplica, pulsé la salida «La Escalinata de Sien» (4 h de camino).
- El motor generó el tile nuevo en 107 s y aparecí allí. La réplica de Maela llegó entonces y abrió el diálogo con ella en la Escalinata, a 4 h de la posada, y la conversación continuó. Capturas: `capturas/demo-20.png`, `capturas/demo-21-0.png`.

**Lo que pido:**
- Una réplica que llega cuando la conversación ya no es la actual no abre el panel modal ni bloquea el ataque. «Ya no es la actual» quiere decir que el panel se cerró y el jugador está en combate, se ha alejado del hablante o ha cambiado de tile; el arquitecto concreta el criterio.
- La réplica no se pierde en silencio: va al registro visible, como línea del hablante, o como aviso para volver a hablar con E. Es lo que el motor dijo, y tirarlo es romper el fail-loud.
- El caso normal no cambia: si hablo con alguien y espero su réplica a su lado, el panel se abre como hoy.
- «El motor decide»: no se reescribe lo que dijo el motor, solo cómo y cuándo se muestra.

### H2 — La barra del enemigo sigue en pantalla cuando el enemigo ya no está

- Tras caer me desperté en la posada (el despertar funciona bien) y la barra «Brasco el del Remo 60» seguía en el HUD, arriba a la izquierda.
- Tras viajar a la Escalinata, otro tile a 64 m, seguía ahí. Capturas: `capturas/demo-18.png`, `capturas/demo-20.png`.
- Nota: tras el despertar Brasco aparece con 60/60, curado. Puede ser una decisión legítima del motor o del sim. El crítico debe mirarlo y NO cambiarlo si es así por diseño.

**Lo que pido:** la barra de un enemigo solo se ve cuando ese enemigo está en combate con el jugador o cerca. El arquitecto decide el criterio, pero tiene que ser el que usa el resto del HUD.

### H3 — `start.sh` pide al usuario pegar un prompt obsoleto al motor

- `pause_for_claude_code` (`start.sh:~713`) dice que se pegue: «Llama a narrative_listen en bucle y responde con el schema adecuado a cada tipo de request (room, weapon_orient, weapon_verify, narrative_event).»
- `room`, `weapon_orient` y `weapon_verify` son kinds retirados, o eso creo: hay que verificarlo contra `narrative-mcp`. Es lo primero que el usuario va a copiar en la demo.
- Memoria del usuario: «los rastros confunden a los agentes»; una retirada incluye barrer la prosa y se canda.

**Lo que pido:** el prompt nombra los kinds VIVOS, derivados de su fuente (el contrato o `narrative-mcp`) si se puede, y con un candado que se ponga rojo si vuelve a nombrar un kind que no existe.

## Lo que funcionó (NO romperlo)

- Título, elección de mundo y personaje.
- El motor genera el primer tile en 4 min 41 s y el viaje en 1 min 47 s.
- Diálogo con memoria, en 5-11 s por réplica.
- Texto libre (T).
- Spawn dinámico de NPC y hostil.
- Combate.
- Muerte y despertar decidido por el motor.
- Viaje por salida.
- Panel P.
- Reanudar tras recargar la página.
- Consola sin errores.

## Fuera de alcance, apuntado para el informe al usuario

- Los faroles son cilindros de 3 m sin radio declarado y parecen barriles gigantes. Es calidad del motor y el default de radio del `prop`.
- La fila del save en el título muestra la PRIMERA línea de la historia, no la última.
- El NPC y_bot se ve pixelado de cerca.
- El plugin `economy` sigue vacío en una historia de deudas. El motor decide.
- Otra tanda (BV, #788) toca `nefan-core/src/scene/blueprint/collision.ts`. No hay solapamiento con esta.

## Restricciones de la sesión

- NUNCA `git stash`.
- No matar servidores ajenos. Hay un stack `play` corriendo en los puertos por defecto: no se toca; para levantar otro, `NEFAN_PORT_OFFSET` o `qa/run.mjs`, que elige bloque.
- No tocar el tag `mutacion-ultima` ni `reports/mutation/` del árbol principal.
- `bateria-n.log` en la raíz del árbol principal es de otra sesión.
- Worktree: `/home/al/code/ne-fan-tanda-bw` (rama `tanda-bw-lo-que-salio-jugando`).

## Ajustes tras la crítica (decisión del coordinador)

Se aceptan los tres puntos de `critica.md`:

- **H1, criterio.** Lo que se trata es solo la **réplica a una elección o a un texto libre del jugador** (`dialogue_choice`, distinguible por `eventId`). Los diálogos que abre el motor por su cuenta (despertar, `map_trigger`, eventos programados) se abren como hoy, aunque haya cambiado el tile. «Panel cerrado» NO sirve como señal. No se pausa la simulación.
- **H2.** Que Brasco vuelva a 60/60 tras el despertar es por diseño (C1, 2026-09-29): no se toca. Para la barra se imita el criterio de alcance de `ui/etiquetas-del-mundo.ts`.
- **H3, premisa corregida.** Solo `room` está retirado. `weapon_orient` y `weapon_verify` se retiran en otro issue, que abre el coordinador. El prompt de `start.sh` **no enumera kinds**, porque sus instrucciones ya llegan con `narrative_listen`. El candado impide que vuelva a nombrar kinds.
