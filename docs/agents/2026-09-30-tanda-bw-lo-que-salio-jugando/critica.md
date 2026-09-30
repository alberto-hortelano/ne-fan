**REENCUADRADA** (en poco): H1 y H2 están vigentes y bien diagnosticados. H3 tiene la premisa rota a medias. H1 tiene una trampa en el criterio que propone.

## El problema real

Quien juega pierde el control, o ve información que no pinta nada, por cosas que el motor o el HUD hacen sin mirar el estado actual del juego. Además, lo primero que copia en la demo le enseña al motor tres kinds, y ninguno es el que se va a usar en la partida.

## La premisa, afirmación por afirmación

- **H1a y H1b tienen la misma causa. Confirmado.** Todo `show_dialogue` entra por `narrativeClient.onNarrativeEvent` (`nefan-html/src/main.ts:1011`) y llama a `conversacion.abrir(...)` (`main.ts:1025`) sin mirar ninguna condición. `abrir` hace `panel.show` y suelta el ratón (`ui/conversacion.ts`), y `dialogoAbierto()` (`main.ts:327`) apaga el ataque (`main.ts:654`). El save lo confirma. `evt_0011` es la elección «Me encargo de tu matón» y lleva en sus consequences el `dialogue` «¡Eso, eso…». `evt_0012` es la elección de Maela, hecha en `tile_0_0`, y `evt_0013` sigue esa conversación con `scene_id: tile_0_-1`, que es la Escalinata. Es un solo camino y un solo arreglo.
- **«La sim no se pausa». Cierto, y está bien así.** Ni el sim ni el bridge saben nada del diálogo (`bridge/handlers/simulation.ts` y `src/simulation/game-loop.ts` no tienen ninguna referencia). El sim es en tiempo real. No he encontrado ninguna decisión escrita que diga que el mundo se para al hablar, y los requisitos no la piden. **No debe añadirse una pausa en esta tanda**: sería otra decisión de juego (sirve el caso de hablar con alguien mientras te pegan) y taparía el síntoma en vez de quitarlo.
- **H2, la barra sin criterio de visibilidad. Confirmado.** `rebuildEnemyBars` (`main.ts:449`) pinta una barra por cada `mundo.enemigos`, sin filtrar por distancia ni por enganche. Como los tiles son aditivos, Brasco sigue en el mundo después de viajar. El resto del HUD sí filtra por alcance (`ui/etiquetas-del-mundo.ts:38-43`, alcance de nombre y cono de puntería), así que el criterio a imitar ya existe.
- **H2, Brasco curado a 60/60. Es por diseño y no se toca.** Está en `game-loop.ts:282-291`: «C1: morir cura a los VIVOS. Lo decidió el usuario el 2026-09-29». Al morir, además, cada enemigo vuelve a su casa. La barra dice la verdad; solo sobra que se vea.
- **H3, «room, weapon_orient y weapon_verify están retirados». Solo es cierto para `room`**, cuyo formato rechaza `narrative-mcp/server.ts:280-287`. `weapon_orient` y `weapon_verify` **siguen vivos** en la cadena del servidor: `narrative-mcp/server.ts:198-222` y `:539-545`, `ai_server/routers/generation.py:75` (`/analyze_weapon`), los prompts `data/contract/prompts/weapon_*.md` y `src/contract/model-io/schemas.ts:271`. Ahora bien, en el juego **nadie llama a `/analyze_weapon`**: `analyzeWeapon` solo está declarado (`src/contracts/narrative-llm.ts:161`) y no tiene consumidor. Los kinds que el motor recibe de verdad en una partida son `scene`, `narrative_event` (con `event_kind`), `player_death` y `develop_world` (`server.ts:230-264`, `:474-507`).

## El día después, y la trampa del criterio de H1

- **Que el panel esté cerrado no distingue nada.** La réplica NORMAL también llega con el panel cerrado, porque el panel se cierra al elegir (`conversacion.ts`, «el panel se cierra a sí mismo antes de invocar sus callbacks»). Si el criterio se apoya en eso, rompe el caso normal que los requisitos piden conservar.
- **Que haya cambiado el tile también falla.** Hay diálogos que el motor abre por su cuenta y que llegan, por naturaleza, después de un cambio de sitio: el del despertar (`bridge/handlers/despertar.ts:233`, `eventId despertar_*`, que te teletransporta), los `map_trigger` (`bridge/context.ts:646`) y los eventos programados. Si esos se degradan a una línea del registro, se rompe «Muerte y despertar decidido por el motor», que está en la lista de NO romper. El criterio tiene que tratar distinto a la **réplica de una elección del jugador** que a **un diálogo que abre el motor**. El `eventId` ya permite distinguirlos.
- Qué cambia para quien juega: deja de morir con el ratón suelto y deja de ver a Brasco en otro tile. Hoy no hay nada más que sostenga este comportamiento.

## Conflictos

- La tanda BV (#788) toca `blueprint/collision.ts` y no se solapa con esta. En la cola (#361-#363, plugins) no hay nada que choque.
- `weapon_orient`/`weapon_verify` son un kind vivo sin productor. Es el mismo patrón que el repo ya prohíbe para los kinds del manifest («ningún kind SIN productor»). **No hay que retirarlos en esta tanda**, porque tocaría ai_server, narrative-mcp, el contrato y los tests Python. Merece un issue aparte.

## Coste contra valor

Los tres cambios son pequeños y los tres los va a ver el usuario en la demo. Si no se hace nada, el usuario muere en su primer combate conversado, y es justo lo que se quiere enseñar. Vale la pena.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **H1, criterio.** La trampa afecta solo a la **réplica de una elección o de un texto libre del jugador** (`dialogue_choice`). Los diálogos que abre el motor por su cuenta (despertar, `map_trigger`, eventos programados) se abren como hoy, aunque haya cambiado el tile. «El panel está cerrado» NO sirve como señal, porque la réplica normal también llega con el panel cerrado. No se pausa el sim.
>
> **H2.** Brasco curado a 60/60 tras el despertar es por diseño (C1, 2026-09-29, `game-loop.ts:282`). No se toca.
>
> **H3, premisa corregida.** Solo `room` está retirado. `weapon_orient`/`weapon_verify` siguen cableados en narrative-mcp y ai_server, pero no tienen productor en el juego: se retiran en otro issue, no aquí. Los instrucciones de cada kind ya llegan embebidas en el retorno de `narrative_listen`, así que lo preferible es que el prompt de `start.sh` **no enumere kinds**. Si enumerarlos es inevitable, el candado debe comprobar que el kind **llega en partida**, no solo que existe, porque «existe» dejaría pasar `weapon_*`.
