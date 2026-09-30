# QA — Tanda BW: lo que salió jugando (H1, H2, H3)

Se validó el commit `563689c9` en el worktree `/home/al/code/ne-fan-tanda-bw`. Todo corrió en el preset `e2e-sin-creditos` a través de `node qa/run.mjs`, que elige solo el bloque de puertos. El stack `play` de los puertos por defecto no se tocó.

Criterio de combate fijado por el coordinador: **opción B**. «En combate» significa que el jugador ha empezado un ataque desde que pidió la réplica. El hueco «te pegan, no atacas y el panel se abre» es una limitación aceptada y no cuenta como hallazgo.

## Criterios

| # | Criterio (requisitos.md + ajustes tras la crítica) | Veredicto | Evidencia |
|---|---|---|---|
| H1a | Se elige una opción, se pega y la réplica NO abre el panel ni bloquea el ataque; sí aparece en el registro | ✅ | Guion 342, bloque 3, verde (`qa/capturas/2026-09-30T14-53-03-056Z-1376969`). Línea: `💬 Tabernero corpulento: «(bench 5) … "REPLICA TARDIA espera que me defiendo".» (vuelve a hablarle cuando acabe la pelea)`, con `{"panel":false,"dialogo":false}`. |
| H1 lejos | Alejarse a más de 18 m: igual que el anterior | ✅ | Guion 342, bloque 2, verde. La línea termina en «(vuelve a hablarle con E)». Nota: el bloque TELETRANSPORTA al jugador 25 m (`setPlayerPos`). No afecta al usuario, porque el bridge solo mira la posición final. |
| H1b | Cambiar de tile con la réplica pendiente (la réplica llega DESPUÉS de llegar) | ✅ | **Guion 343 (nuevo)**, bloque 2, verde (`…T14-58-01-130Z-1379623`): viaje por «Salidas» a la Taberna → Molino (`tile_0_0 → tile_1_0`), soltar la réplica, y la línea llega al registro con `{"panel":false,"dialogo":false}`. Captura `343-…-02-h1b-replica-tras-viajar-en-el-registro.png`. |
| H1b' | Cambiar de tile con la réplica pendiente (la réplica llega CON EL VIAJE EN MARCHA) | ❌ | **Guion 344 (nuevo)**, rojo. Ver hallazgo 1. |
| H1 normal | Hablar y esperar al lado: el panel se abre como siempre | ✅ | Guion 342, bloque 1 (CONTROL), verde. Los guiones 37 y 83 también verdes. |
| H1 motor | Los diálogos que abre el motor por su cuenta (despertar, `map_trigger`, evento programado) siguen abriendo el panel | ✅ (por código + unitario) / ⚠️ e2e | `entregarReplica` solo se llama desde `reportAndDispatch` (grep: una llamada, `bridge/handlers/dialogue.ts:119`). `despertar.ts` y `fireMapCrossing` difunden por otro camino. Los unitarios `bridge-map` («map_trigger tras cambiar de tile sigue emitiendo show_dialogue») y `bridge-dialogue` pasan (`100/100`). Los eventos programados no tienen canal propio: llegan dentro de la respuesta del motor a un turno. No hay prueba e2e de un despertar con `dialogue`, porque el motor falso despierta con un `story_update`. Sí están verdes los guiones 260, 264 y 268 del despertar. |
| H1 fail-loud | La réplica no se pierde: queda en el registro | ✅ con reserva | El texto viaja entero (unitario «texto IDÉNTICO» y líneas de arriba). Reserva: en plena pelea el registro solo guarda 8 líneas, ver hallazgo 3. |
| H2 despertar | La barra desaparece tras despertar lejos | ✅ | Guion 241, verde en los asertos de H2: `barras al despertar: [{"id":"bandido_1","alive":false,"oculta":true},{"id":"narr_npc_…","d":15.2,"alive":true,"oculta":false}]`. El Secuaz se ve porque está a 15,2 m, por debajo de 18: es la regla. |
| H2 viaje | La barra desaparece tras viajar (enemigo suelto) | ✅ | **Guion 343, bloque 1**, verde. A 12,3 m del bandido se ve la barra (`oculta:false`). En el Molino, a 52 m, está oculta y el panel de enemigos no se pinta. Captura `343-…-01-h2-tras-viajar-sin-morir.png`. |
| H2 viaje enganchado | La barra desaparece tras viajar huyendo de una pelea | ❌ | **Guion 345 (nuevo)**, rojo. Ver hallazgo 2. |
| H2 cerca/en pelea | La barra se ve cerca o en pelea | ✅ | Guion 345 CONTROL (`d 2,0`, `oculta:false`) y guion 42 verde. |
| H3 | El prompt de `start.sh` no enumera kinds, es correcto y está candado | ✅ | Leído (ver abajo). Candado `el-prompt-del-motor-no-enumera-kinds` verde. **En negativo, propio**: con «(player_death incluido)» añadido al heredoc → `✖ start.sh: el heredoc de pause_for_claude_code no nombra ningún kind`. Restaurado con `git checkout -- start.sh`. |
| Adv. 1 | Capturar el ratón con un clic (sin lock) NO cuenta como ataque | ✅ | **Guion 343, bloque 3**, verde, con el proveedor de TECLADO/ratón real (sin `?input=scripted`): lock `false` → clic → lock `true` → soltar → **el panel se abre**. `keyboard-input-provider.ts:121` exige `pointerLockElement !== null`. |
| Adv. 2 | La pista «cuando acabe la pelea» solo aparece si hay pelea | ❌ (menor) | Guion 342, bloque 3: el bandido está muerto y no hay nadie enganchado. Un golpe al aire da `(vuelve a hablarle cuando acabe la pelea)` (captura `342-…-03-replica-tras-atacar-en-el-registro.png`). Ver hallazgo 4. |

Corrida de regresión: `node qa/run.mjs 342 241 42 83 37 260 264 268 03-hud 129` → **9 en verde · 0 en rojo · 1 SIN MEDIR** (`…T14-53-03-056Z-1376969`). El ⊘ es el 241: «el Secuaz no siguió al jugador al otro tile ni lo mató». Sus asertos de H2 sí pasaron. El implementador lo daba verde, así que parece intermitente del bloque 2, no una regresión. No lo he investigado más.

Unitarios: `entrega-de-la-replica`, `bridge-dialogue`, `bridge-map`, `aim` y el candado H3 → `tests 100 · pass 100 · fail 0`. Los candados del banco (saltos sin observar, reloj, sondas, banco-*) pasan con los tres guiones nuevos. Lint del banco OK en los tres.

### Los guiones nuevos, en negativo (medido)

| Sabotaje (restaurado después; `git status` limpio salvo lo añadido) | Resultado |
|---|---|
| `barras-de-enemigo.ts`: `vital.hidden = false && …` | 343 ✘ «H2: tras viajar … NO se ve» y ✘ «panel de enemigos no se pinta vacío» |
| `keyboard-input-provider.ts`: mousedown sin mirar el lock | 343 ✘ «ADVERSARIAL: el click que CAPTURA …»: la réplica se fue al registro con «cuando acabe la pelea» |
| `dialogue.ts` de `HEAD~1` (sin entrega) | 343 ✘ los tres asertos de H1b (`{"panel":true,"dialogo":true}`, línea `null`) |
| 344 y 345 | Rojos HOY sin sabotear: son hallazgos, no candados de algo que ya funcione |

## Hallazgos

### 1 · IMPORTANTE — H1b se sigue reproduciendo si la réplica llega con el viaje en marcha
- **Pasos** (guion 344): arrancar, matar al bandido, E al tabernero, T + texto libre, y sin esperar la réplica pulsar «Salidas → Molino del bench». Mientras el muro «Viajando…» sigue delante (el tile tarda 15 s), llega la réplica.
- **Qué pasa**: al llegar la réplica, el tile activo y la posición son todavía los de la Taberna, así que la entrega la considera **vigente** y abre el panel detrás del muro. Captura `344-…-01-replica-con-el-viaje-en-marcha.png`: panel del tabernero bajo «Viajando…». Después el viaje llega y el panel **sigue abierto en el Molino**. Captura `344-…-02-el-viaje-no-llega-con-el-panel-abierto.png`: «Scene loaded: tile_1_0» en el registro y el tabernero con sus opciones en pantalla.
- Además, con el panel abierto el cliente se queda a medias: `{"tile":"tile_0_0","pos":{"x":64,"z":7},"ledger":{…"escenaRecibida":"tile_1_0","spawnAplicado":{"x":64,"z":7},"llegado":26356},"panel":true}`. El jugador ya está en coordenadas del Molino, pero `currentTile` sigue siendo `tile_0_0`, la salida ofrecida sigue siendo «Molino del bench» y el viaje nunca se da por llegado.
- **Qué esperaba el usuario**: exactamente lo que pidió en H1b, que al llegar al sitio nuevo no siga en pantalla la conversación con quien se quedó a horas de camino. Con un motor real que atiende en serie, este orden (la réplica tarda 5-11 s y el tile, 1-5 min) es **el más probable**. En el playtest salió el contrario, que es el que arregla la tanda.
- No es una regresión: `HEAD~1` hace lo mismo con este orden. Es la parte de H1b que el criterio «tile al llegar la réplica» no cubre. Arreglos posibles, a decidir por el arquitecto: contar como «no vigente» un viaje pedido tras la elección (hay `travelLedger`/`player_entered_place` en el bridge), o cerrar o diferir la conversación abierta al aplicar el spawn de un viaje.

### 2 · IMPORTANTE (o decisión) — Huir de una pelea por «Salidas» se lleva la barra del hostil al destino
- **Pasos** (guion 345): arrancar, acercarse al bandido hasta que pega (vida 97), y viajar por «Salidas» al Molino.
- **Qué pasa**: en el Molino, a 54,5 m y en otro lugar, la barra «bandido_1 60» **sigue en el HUD**: `{"oculta":false,"d":54.5,"tile":"tile_1_0"}`. El enganche no se suelta hasta que el jugador muere (lo dice el propio `entrega-de-la-replica.ts`), así que la barra se queda hasta la próxima muerte, en cualquier tile.
- **Qué esperaba el usuario**: H2 dice «solo se ve cuando ese enemigo está en combate con el jugador o cerca», y su captura del playtest era justo esta barra en la Escalinata. Un hostil que no puede seguirte a dos horas de camino no está en combate contigo desde el punto de vista de quien juega. Si «enganchado para siempre» es de diseño, el guion 345 se borra. Si no, el enganche o la barra tienen que caducar con el viaje.

### 3 · IMPORTANTE (UX) — En plena pelea, la réplica diferida sale del registro en segundos
- El registro guarda `LINEAS_DEL_REGISTRO = 8` (`ui/registro-de-la-partida.ts`) y cada golpe añade una línea. En `capturas/demo-17.png`, del playtest, las 8 líneas son «Player hit»/«hit». El caso de H1a es justo el de pelea: la línea de Orio queda enterrada tras 4-8 golpes, y además tiene la misma letra, el mismo tamaño y el mismo fondo que «Atlas fps: 1 vecino(s) restaurado(s)…» (captura del 343-02). Una réplica real del motor de 3-4 frases ocupa varias líneas y empuja las demás.
- Solo se puede recuperar en el history browser [H], cortada a 40 caracteres. Cumple la letra de «no se pierde en silencio», pero en combate el jugador no llegará a leerla. Esto es juicio y no se ha medido de punta a punta.

### 4 · MENOR — «vuelve a hablarle cuando acabe la pelea» sin pelea
- Cualquier ataque empezado cuenta como `combate`, también un golpe al aire sin nadie alrededor (guion 342, bloque 3: bandido muerto y ningún enganchado). La pista le habla al jugador de una pelea que no existe. Tampoco se abre el panel. Es la consecuencia aceptada de la opción B, pero el texto debería decir otra cosa, o elegirse con `jugadorEnCombate` en ese momento.

### 5 · MENOR (preexistente, fuera de alcance) — El registro nombra al hostil por id
- «narr_npc_1790773948_0 hit: -19.4 HP» en `demo-17.png`. #323 lo arregló en las barras, pero no en las líneas del registro. Lo apunto para el informe al usuario.

## Workarounds usados y veredicto
- **Teletransporte a 25 m** (342, bloque 2) y a 1,2 m del tabernero (343, bloque 3): son atajos de posición. La decisión del bridge mira la posición final y el camino no importa, así que no afectan al usuario.
- **El motor falso retiene la réplica** (`/dev/soltar-replica`) y **tarda con los tiles** (`/dev/tiles` en 344): reproducen el tiempo del motor real sin carreras de reloj. No afectan al usuario.
- **Guion 83 del ingeniero: ya no hace clic con el ratón capturado.** Lo miré con la regla del workaround. Con el lock puesto, un clic ES un ataque (LMB) por diseño. Quien juega y ya tiene el ratón capturado no hace clic «para capturar», porque no hay cursor. No es un obstáculo del usuario. El caso de riesgo (clic SIN lock) queda cubierto por el bloque 3 del 343: no ataca.
- El bloque 3 del 343 recarga sin `?input=scripted` para usar el proveedor real de teclado y ratón. Es más fiel al usuario, no un atajo.

## No probado
- **Motor real (Claude Code) y créditos**: todo se hizo con el motor falso. No he probado H3 pegando el prompt en un Claude Code nuevo.
- **H3, lectura como usuario nuevo**: el encargo («Eres el motor narrativo del juego. Llama a narrative_listen en bucle: cada petición trae su tipo, sus instrucciones y su schema. Respóndela con narrative_respond y vuelve a escuchar.») es correcto: la descripción de la tool y cada retorno de `narrative_listen` traen el kind, las instrucciones y el schema (`narrative-mcp/server.ts:151-190`, `:225-275`). También es cierto lo de «ANTHROPIC_API_KEY → API directa» y «sin clave → 503» (`ai_server/llm_client.py:138-148`). Dos matices, **no bloqueantes**:
  - no dice qué hacer si una llamada falla o expira. Un `narrative_listen` en vacío bloquea hasta el timeout del MCP (~30 min, memoria del playtest), y un Claude recién abierto puede parar el bucle ante el error. «Si falla o expira, vuelve a llamar» lo cerraría;
  - pegarlo antes de pulsar Enter en `start.sh` deja un listen en vacío hasta que empieza la partida. Es inocuo si se empieza enseguida.
  El `.mcp.json` del servidor `narrative` no está versionado (existe en el árbol principal, no en el worktree). Para el usuario da igual, pero un clon limpio no tendría el MCP.
- **Despertar con `dialogue`, e2e**: solo por código y unitarios (el motor falso despierta con `story_update`).
- **Réplica que llega estando caído**: no probado.

## Veredicto

**Apto con reservas.** H1a, el caso de combate y la muerte del playtest, está arreglado y verificado desde el jugador. También lo está H1b en el orden observado, H2 tras morir o tras viajar con el enemigo suelto, y H3 con candado probado en negativo. Las reservas son dos huecos del mismo síntoma que pidió el usuario: la réplica que llega con el viaje en marcha sigue abriendo la conversación en el destino (guion 344, rojo) y la barra del hostil del que huyes por «Salidas» sigue en el destino (guion 345, rojo). A eso se suma la legibilidad de la réplica en pelea. Para la demo: si el usuario elige una opción y viaja enseguida, lo más probable es que vuelva a ver H1b.
