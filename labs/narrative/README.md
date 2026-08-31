# labs/narrative — banco de pruebas del motor narrativo

Bench reutilizable para testear **el motor narrativo** de Never Ending Fantasy sin gráficos,
movimiento ni combate real. Emula ser el **juego** frente al bridge WebSocket de
`nefan-core`, enviando exactamente los mismos mensajes que enviaría el juego y registrando ambos
lados de la conversación. Otro Claude Code (en otro terminal) actúa como **motor narrativo**,
igual que en el juego real.

```
[game-emulator.mjs] --WS:9877--> bridge --HTTP:8765--> ai_server --WS:3737--> [motor narrativo]
       (= el juego)                  ^                                            (otro Claude Code,
                              State API :9878  <--- tools map_*/npc_*/entity_*    narrative_listen/respond)
```

## Por qué a través del bridge

El bridge (`nefan-core/bridge/ws-server.ts`) construye el `LlmContext`, persiste el
`NarrativeState` canónico, despacha las `consequences`, corre el plugin tick y expone la State API
`:9878` que usan las tools del motor. Emular contra el bridge es lo más fiel al juego real (más que
hacer `curl` directo a `ai_server`).

## Precondiciones (qué hay que arrancar)

> ⚠️ **No dejes que `start.sh` arranque su placeholder de `narrative-mcp`** (por defecto lo hace
> con `NARRATIVE_EAGER_BIND=1` y robaría el puerto `:3737`, que debe poseer el terminal del
> **motor**). Lanza el launcher con `NEFAN_EAGER_BIND=0 ./start.sh` para que se lo salte, o no
> selecciones el servicio. Cada Claude Code hace *lazy bind* de `:3737`: solo lo toma quien llama
> `narrative_listen`.

Orden recomendado (para que el motor tome `:3737` antes de que `ai_server` intente conectar):

1. **Terminal A — motor narrativo.** Abre Claude Code en `~/code/ne-fan` y dale este encargo:

   > Eres el motor narrativo del juego. Entra en bucle: llama `narrative_listen`, genera la
   > respuesta según el `kind` recibido (escena *Map Format D* para `scene`, o `consequences`
   > para `narrative_event`), usa las tools `map_*` / `npc_*` / `entity_*` / `inventory_*` /
   > `plugin_*` cuando proceda, y responde con `narrative_respond`. Repite indefinidamente.

   Al primer `narrative_listen` toma `:3737` y queda bloqueado esperando.

2. **ai_server:**
   ```bash
   cd ~/code/ne-fan && source .venv/bin/activate && python -u ai_server/main.py
   ```
3. **bridge** (escucha `:9877`, expone State API `:9878`):
   ```bash
   cd ~/code/ne-fan/nefan-core && npx tsx bridge/ws-server.ts
   ```

## Arrancar el emulador

```bash
node labs/narrative/game-emulator.mjs            # foreground
# o en background, y se conduce por su API de control HTTP (:9899)
```

Cada ejecución crea `labs/narrative/runs/<timestamp>/` con `events.ndjson` (log crudo de la
sesión, ambos sentidos) y donde se deja el `INFORME.md`. `runs/` está gitignored.

## API de control (HTTP `:9899`, conducir con `curl`)

| Método | Ruta | Qué hace |
|--------|------|----------|
| `POST` | `/send` | body = mensaje de bridge JSON → lo envía por WS. Responde `{ok, sentSeq}` |
| `GET`  | `/events?since=N&dir=in` | eventos con `seq>N` (`dir` opcional: `in`/`out`) |
| `GET`  | `/wait?since=N&type=narrative_event&timeoutMs=240000` | **long-poll**: resuelve al llegar un evento del `type` pedido (acepta lista CSV). Necesario porque el motor responde async y lento |
| `GET`  | `/health` | `{connected, eventCount, run}` |

### Ejemplos

```bash
# salud
curl -s localhost:9899/health

# listar juegos (sanity de la tubería)
curl -s -XPOST localhost:9899/send -d '{"type":"list_games","requestId":"g1"}'
curl -s 'localhost:9899/wait?type=games_listed&timeoutMs=10000'

# arrancar sesión y esperar la escena inicial generada por el motor
curl -s -XPOST localhost:9899/send \
  -d '{"type":"start_session","requestId":"s1","gameId":"alta_fantasia","appearance":{"model_id":"","skin_path":""}}'
curl -s 'localhost:9899/wait?type=narrative_event&timeoutMs=300000'

# hablar con un NPC
curl -s -XPOST localhost:9899/send \
  -d '{"type":"interact_entity","entityId":"tavern_keeper","entityName":"Marta"}'
curl -s 'localhost:9899/wait?type=narrative_event&timeoutMs=200000'

# elegir opción de diálogo (con texto libre opcional)
curl -s -XPOST localhost:9899/send \
  -d '{"type":"dialogue_choice","eventId":"evt_1","speaker":"Marta","chosenText":"¿Qué pasa fuera?","choiceIndex":0,"freeText":""}'

# viajar a un lugar del mapa (lazy-realize de escena nueva)
curl -s -XPOST localhost:9899/send \
  -d '{"type":"player_entered_place","placeId":"millhaven_road"}'
```

## Replay / "película" del log (depurar el render sin motor ni jugador)

`replay-server.mjs` reproduce una sesión grabada (`runs/<ts>/events.ndjson`) como película para el
**cliente** (`nefan-html`), **sin motor narrativo, sin ai_server y sin jugador**. Esto funciona
porque `events.ndjson` capturó los mismos mensajes `in` que el bridge real envía al cliente
(`session_started`, `narrative_event` con la escena en `effects[].spawn_entity.data.scene`,
`narrative_status`…) — que es justo lo que el cliente consume para dibujar.

Cómo lo hace:
- Las respuestas correlacionadas por `requestId` (`list_games`/`list_sessions`/`start_session`/…) se
  contestan con el frame grabado, **reescribiendo el `requestId`** al que use el cliente en vivo (así
  resuelve su Promise — ver `bridge-client.ts:dispatch`). `list_sessions` se sintetiza vacío.
- Los broadcasts (`narrative_status`/`narrative_event`/`state_update`) se reemiten en orden grabado
  con ritmo de película. El input por frame / `dialogue_choice` / etc. del cliente se ignoran: avanza sola.

No necesita ai_server: los eventos grabados se reemiten TAL CUAL (la escena viaja ya normalizada en
el log), así que no hay nada que generar y el renderer pinta terreno, volúmenes y diálogo sin backend.

```bash
# 1) Asegúrate de que el bridge REAL no ocupa :9877 (lo suplantamos).
# 2) Replay server (suplanta al bridge):
node labs/narrative/replay-server.mjs
#    opciones: HOLD_MS=2000 FLASH_MS=150 LOOP=1 REAL_TIMING=1 PORT=9877
#    otro run: LOG=labs/narrative/runs/<otro>/events.ndjson node labs/narrative/replay-server.mjs
# 3) Cliente en otra terminal:
cd nefan-html && npm run dev
# 4) Abre el navegador, pulsa "Nueva partida", elige tavern_intro → la sesión se reproduce sola.
```

Variables: `LOG`, `PORT` (9877), `HOLD_MS` (3000, cuánto se ve cada escena/diálogo), `FLASH_MS`
(200, loader "generando"), `REAL_TIMING=1` (respeta los deltas reales, clamp), `LOOP=1`.

> Alcance: la película reproduce lo que se **grabó**. Esta sesión (`session-2026-06-25`) tiene
> escenas + diálogos + spawns (perfecto para depurar layout/escenas/UI), pero **no** movimiento/combate
> frame-a-frame porque no se condujo el loop de input. Una sesión con combate sí grabaría los frames
> `input`→`state_update` y la película sería animada.

## Mensajes de bridge soportados (los que envía el juego)

Formatos verificados en `nefan-core/bridge/ws-server.ts` y `nefan-core/src/protocol/messages.ts`:

- `{type:"list_games", requestId}` → `games_listed`
- `{type:"list_sessions", requestId}` → `sessions_listed`
- `{type:"start_session", requestId, gameId, appearance:{model_id, skin_path}}` → `session_started`
  (`appearance` es opcional, pero si va, `skin_path` es REQUERIDO por el zod del bridge — usar
  `""` si no hay skin; omitirlo rebota con `narrative_status: error`)
  + (async) `narrative_status` y `narrative_event` con la escena
- `{type:"resume_session", requestId, sessionId}` → `session_started` (isResume)
- `{type:"session_entered", sessionId}` → **sin respuesta**. Es el ack del cliente: «el jugador ya
  se ha vestido Y el mundo está pintado». Desde #279 es lo ÚNICO que hace que la partida exista en
  `saves/{sessionId}/state.json`; sin él la sesión vive solo en memoria y NINGÚN `save()` del
  bridge escribe nada. Este emulador **no lo manda solo**: un bench que quiera un save (o poder
  reanudar después) tiene que enviarlo a mano tras el `session_started`. La señal de que falta es
  un `saves/` vacío al terminar la corrida.
- `{type:"interact_entity", entityId, entityName}` → `narrative_event` (consequences)
- `{type:"dialogue_choice", eventId, speaker, chosenText, choiceIndex, freeText?}` → `narrative_event`
- `{type:"player_entered_place", placeId}` → `narrative_event` con la escena del lugar

Los juegos en disco son los de `nefan-core/data/games/` (`alta_fantasia`, `cuentos_oscuros`,
`toledo_1200`, `colonia_aster`, más los `user_*` subidos) — comprobar con `list_games`.
`start_session` deja que el LLM conduzca el mundo abierto; no hay historia predefinida
(`tavern_intro` solo pervive en la grabación que sirve el replay-server, ver arriba).
