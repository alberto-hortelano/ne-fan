# QA — PR-2 · #235 «bridge → ai_server por HTTP → bridge, sin créditos» (PR #447, `964911c`)

Fecha 2026-09-05 · worktree desprendido `/home/al/code/ne-fan-t11-qa2` · `NEFAN_PORT_OFFSET=500` · Python `/home/al/code/ne-fan/.venv/bin/python` (3.10, `anthropic` 0.94.0) · `:3737` libre durante toda la sesión (`ss -ltnp | grep 3737` → nadie), pero todas las corridas fueron con `off` igual · créditos gastados: **0** (clave falsa, `ANTHROPIC_BASE_URL` al stub, y muestreo de `ss` sin ninguna conexión saliente de python).

Nada de lo de abajo lo leí del informe del ingeniero: cada fila tiene el comando que corrí y su salida.

## Criterios contra la petición original

Criterio de cierre de #235: «una corrida automática en la que un NPC con `role` y `description` atraviesa ai_server y llega al cliente con los dos campos, y que se pone ROJA si una de las dos allow-lists deja de copiarlos». Más el encuadre de `requisitos.md`: **sin créditos**, **por HTTP**, headless si va a CI.

| Criterio | Veredicto | Evidencia |
|---|---|---|
| El NPC atraviesa el ai_server **real** por HTTP y llega al wire con `role` y `description` | ✅ cumple | `NEFAN_PORT_OFFSET=500 node qa/el-npc-cruza-ai-server-con-role-y-description.mjs` → 19 ✔ / 0 ✘, `VERDE`, exit 0, 2,4 s. `barkeep role:"merchant"` + description verbatim leída del stub (`/servido`); `bandido_1 role:"hostile"` + `combat` derivado (`scene-normalize.ts:260`, `combatForHostileRole`). El `ready` trae `source:"engine"` (lo emite `bootstrap-tile.ts:115`; el snapshot emitiría `"snapshot"`, `session.ts:519`) |
| Rojo si deja de copiarse `role` | ✅ cumple | `narrative_schemas.py:878` → `pass`; guion → `✘ barkeep llega con role:"merchant" — role=undefined`, `✘ bandido_1 … role=undefined`, `✘ …combat`, `ROJO — 3`, exit 1. Restaurado con `git checkout`, `git diff --quiet` limpio |
| Rojo si deja de copiarse `description` | ✅ cumple | `:892` → `pass`; `✘ barkeep … wire=undefined servido="tabernero corpulento de mandil manchado"`, `✘ bandido_1 … wire=undefined`, `ROJO — 2`, exit 1. Restaurado |
| Sin créditos | ✅ cumple | Muestreo de `ss -tnp` (estab. + syn-sent, destino no loopback) cada 150 ms durante la corrida: cero entradas de `python`/`node`; la única loopback IPv6-mapeada era el propio bridge :10377 aceptando mi WS. El SDK del venv solo cae a `https://api.anthropic.com` si `ANTHROPIC_BASE_URL` falta (`_client.py`), y el guion la fija siempre. El ledger de gasto no se toca: `SpendTracker` vive en remote-gen, no en el camino de escena (`grep spend ai_server/llm_client.py routers/generation.py` → 0); `cache/spend/` no existe tras las corridas |
| El ai_server NO se engancha a un `:3737` ajeno | ✅ cumple | Log del ai_server bajo el guion: `LLM: canal MCP desactivado (NEFAN_LLM_MCP_URL=off); solo API directa` · `LLM: Using Claude API direct mode`; el guion lo afirma por regex y el stub cuenta **exactamente 1** llamada con `x-api-key: banco-sin-creditos` y `tool_choice generate_scene` |
| Sin la variable, ai_server se comporta como antes (intenta MCP) | ✅ cumple | `env -u NEFAN_LLM_MCP_URL ANTHROPIC_API_KEY= python ai_server/main.py --port P` → `LLM: narrative-mcp bridge not available yet (will retry every 5s)`; y `test_con_la_url_de_siempre_si_intenta_el_canal` en `test_llm_backend.py` |
| Valor basura en `NEFAN_LLM_MCP_URL` → fail-loud, no degradación | ✅ cumple | `NEFAN_LLM_MCP_URL=http://basura python ai_server/main.py --port P` → `ValueError: NEFAN_LLM_MCP_URL='http://basura' no es ni \`off\` ni una URL ws:// o wss://` · `Application startup failed. Exiting.` · exit 3, puerto suelto |
| Puerto ocupado → se niega y no mata | ✅ cumple | `python3 -m http.server 10377` mío + guion → `⊘ SIN MEDIR — :10377 (bridge, offset 500) ya está ocupado por pid 45077 (python3 -m http.server 10377 …, cwd …/ne-fan-t11-qa2). No mato a nadie`, exit 2; el ocupante seguía vivo y escuchando después (lo paré yo por PID) |
| No sale verde si la escena no viene del stub | ✅ cumple | Copia instrumentada del guion (en scratchpad, sin tocar el árbol) que NO borra `world/` y copia un juego con snapshot → `✘ el ready dice source:engine … "source":"snapshot"` y después `⊘ SIN MEDIR — /servido → HTTP 404` (el stub nunca fue llamado), exit 2. Ver hallazgo menor 3 sobre la etiqueta |
| `ANTHROPIC_BASE_URL` a un puerto muerto → no sale a internet | ✅ cumple | Misma copia con `ADV_BASE_URL=http://127.0.0.1:<muerto>` y flujo real del bridge: ai_server `POST /generate_scene → 503 {"detail":"generate_scene API call failed: Connection error."}` → bridge `narrative_status error` → guion exit 2; muestreo de `ss`: ninguna saliente de python |
| Sin regresión | ✅ cumple | `npm run verify` → 2067/2067, 0 fail (build + typecheck:scripts + typecheck:labs + lint + test) · `ruff check ai_server` → `All checks passed!` · `NEFAN_SPEND_DIR=$(mktemp -d) python -m unittest discover -s ai_server/tests` → `Ran 236 tests … OK` · `NEFAN_PORT_OFFSET=500 node qa/run.mjs el-mismo-tile` → `✔ 40-el-mismo-tile-no-puede-tener-dos-veredictos · 1 en verde · 0 en rojo`, 4,9 s |
| CI: el job `candados-headless` corre el guion de verdad | ✅ cumple | `gh pr checks 447` → los 5 jobs `pass`; `gh run view 33964258593 --job 101301418213 --log`: `npm ci` ×2 (255 + 177 paquetes, caché), `npm run build`, `pip install …` → `anthropic-1.4.0 fastapi-0.141.1 uvicorn-0.52.4 …`, y el guion imprime los 19 ✔ y `VERDE` en 4,1 s con el `python3` del sistema. No es verde vacío: el SDK 1.4.0 del runner parseó el stub igual que el 0.94 local |
| Tras Ctrl+C no queda nada vivo | ❌ NO cumple | Ver hallazgo importante 1 |
| Arranque real del preset `play` | ⚠️ no probado | Gasta créditos; fuera de alcance por orden |
| Camino MCP (ai_server → narrative-mcp → motor) | ⚠️ no probado | Fuera de alcance por decisión del plan (opción B, programa aparte). Sigue sin testigo automático, y la PR lo dice |

## Hallazgos

### Importante

**1 · Un Ctrl+C a mitad del guion deja vivos el stub y el ai_server, y un disco efímero en `/tmp`.**
Reproducción: `NEFAN_PORT_OFFSET=500 node qa/el-npc-cruza-ai-server-con-role-y-description.mjs & sleep 1.6; kill -INT $!`. Salida: el guion muere con 130 sin pasar por el `finally` (Node no tiene manejador de SIGINT, así que la promesa en curso no se rechaza y ningún `finally` corre). Después: `ps` → `node --import tsx …/fake-anthropic.ts` (pid 43427) y `python -u …/ai_server/main.py --port 41287` (pid 43439) reparentados a 2138 y escuchando; `/tmp/qa-npc-cruza-VpNokX` con la copia de `alta_fantasia` + `plugins`. El bridge sí murió (probablemente EPIPE sobre el pipe cerrado). Los maté por PID.
Por qué importa aquí más que en otro guion: la cabecera promete «sus tres hijos se matan por PID» y el ai_server huérfano es un proceso con `ANTHROPIC_API_KEY` en el entorno escuchando en un puerto anónimo; en la máquina de varios agentes, ese ai_server zombi es exactamente el tipo de proceso que en su día robaba respuestas (`project_narrative_mcp_multiterminal`). En CI no pasa (nadie interrumpe), pero el guion se anuncia como corrida local también.
Qué esperaba: `process.on("SIGINT"/"SIGTERM")` que dispare la misma limpieza (matar hijos, `rmSync(tmp)`) y salga con 130.

### Menor

**2 · `qa/README.md:483` dice «21 comprobaciones» y el guion tiene 19** (`grep -c 'expect(' …mjs` → 19; 19 ✔ en cada corrida verde). `implementacion-2.md` repite el 21. Es la clase de número que se copia sin medir (`feedback_la_medida_de_hoy_hay_que_medirla`).

**3 · Cuando la escena NO viene del stub, el veredicto sale como `SIN MEDIR` (exit 2) con un stack, no como `ROJO`.** Reproducción arriba (snapshot en disco): imprime un ✘ y luego `saludable(`${stubUrl}/servido`)` lanza un `Error` genérico por el 404 antes de llegar a «el stub recibió EXACTAMENTE 1 llamada». Sigue siendo no-cero (CI rojo), pero la etiqueta miente: sí se midió, y lo medido estaba mal. Esperaba que el 404 de `/servido` fuera un `expect` con nombre («el stub no sirvió nada: la escena no vino por aquí»).

**4 · Ruta personal commiteada.** `qa/el-npc-cruza…mjs:102-103` lleva `/home/al/code/ne-fan/.venv/bin/python` como segundo candidato de intérprete. Tiene precedente literal (`el-ledger-de-gasto…mjs:83-84`), y en CI cae al `python3` del sistema, así que funciona; pero son ya dos copias del mismo bloque de 5 líneas con una ruta de una máquina concreta. Esperaba una función compartida en `qa/lib/` (o una variable `NEFAN_PYTHON`) en vez de la tercera copia el día que llegue el siguiente guion Python.

**5 · (Preexistente en `main`, lo destapa el guion) El apagado del ai_server falla SIEMPRE con `AttributeError: 'Deps' object has no attribute 'remote_gen'`** (`main.py:103`; `grep remote_gen ai_server/deps.py` → 0: el atributo se fue con la separación de remote-gen y esta rama del `lifespan` quedó muerta). Visto en el log de cada SIGTERM del guion (`Application shutdown failed. Exiting.`, exit 3). El guion no mira el código de salida de sus hijos, así que ese error lo ve nadie, ni en local ni en CI. No es de esta PR (está en `main:ai_server/main.py:98`), pero ahora hay una corrida automática que lo dispara en cada ejecución y lo silencia. Merece issue.

**6 · Prosa que quedará falsa al mergear, asignada a PR-3 por el plan.** `nefan-core/test/esperas-de-qa.test.ts:4-5` («el CI no corre la batería de `qa/`») sigue siendo literalmente cierto (batería = guiones de navegador), pero `veredictos.test.ts:11` y `presets-clasifica.test.ts:14` dicen lo mismo en términos más amplios, y `CLAUDE.md` no nombra el job nuevo. El plan lo carga a PR-3 con razón (es quien decide el perímetro); lo anoto para que no se pierda en la ventana entre las dos PR.

### Lo que NO es hallazgo (lo miré y está bien)

- El `expect` de «arrancó con el asset-store caído» afirma un WARNING (`asset-store .*unavailable`); si mañana el cliente del store deja de avisar, el guion se pondría rojo por una razón ajena a #235. Es aceptable: el aviso es fail-loud deliberado y perderlo también sería noticia.
- `puertosLibres(3)` tiene ventana entre soltar y tomar; el propio ingeniero lo declara y `esperarPuertoArriba` lo convierte en `SIN MEDIR` con el log del hijo (lo comprobé forzando la muerte del ai_server con `--host 999.999.999.999`: exit 2 en 1,9 s, cola del log de python impresa, sin huérfanos ni tmp).
- El stub rechaza con 400 lo que no sea `tool_choice generate_scene` y `GET /servido` da 404 hasta la primera escena: los dos son fail-loud, no complacencia.
- `test_llm_backend.py` corre en el job `ai-server` SIN `anthropic` instalado y no se salta: afirma `api_client is None` en ese caso (verde en CI con conteo 236, no vacío).
- `qa/run.mjs el-mismo-tile` honra `NEFAN_PORT_OFFSET=500` y deja sus capturas gitignoradas; `git status` limpio al final salvo `docs/agents/`.

## Workarounds usados durante la prueba

| Workaround | Por qué no afecta al usuario |
|---|---|
| Copia instrumentada del guion en el scratchpad (`guion-adv.mjs`: imports absolutos, `ADV_NO_RM_WORLD`, `ADV_GAMES_ORIGEN`, `ADV_BASE_URL`, `ADV_AI_ARGS`, `ADV_KEEP_TMP`) | Solo para probar en negativo el candado (¿detecta un snapshot? ¿una BASE_URL muerta? ¿un hijo que muere?). El guion del repo no se tocó; los tres cambios de comportamiento son knobs que el original no tiene ni necesita |
| Un `python3 -m http.server 10377` mío como «ocupante ajeno» | Simula al otro agente; lo paré yo por PID |
| Maté por PID a mis dos huérfanos del Ctrl+C y borré mi `/tmp/qa-npc-cruza-VpNokX` | Es el hallazgo 1, no un paso de la receta |

## No probado

- Preset `play` real (créditos). El camino MCP completo (decisión del plan).
- `request_tile` / `report_player_choice` por ai_server: el guion es un juego y un tile (el ingeniero lo declara).
- Versión futura del SDK `anthropic` en CI: `pip install` sin pinear; hoy 1.4.0 parsea el stub, y el propio job `ai-server` ya trabaja sin pinear, así que no es una desviación de esta PR.

## Propuesta de candado (sin escribirlo)

Ampliar el guion existente, no uno nuevo: (1) manejadores de `SIGINT`/`SIGTERM` que corran la misma limpieza del `finally` y salgan con 130 — **negativo**: `kill -INT` a los 1,6 s y `ps`/`ls /tmp/qa-npc-cruza-*` vacíos; (2) convertir el 404 de `/servido` en un `expect` con nombre para que «la escena no vino del stub» sea `ROJO` y no `SIN MEDIR`; (3) tras `matar(ai)`, afirmar `code === 0` del ai_server (hoy sale 3 por el hallazgo 5) — eso convierte el bug preexistente del `lifespan` en rojo con nombre en cada corrida, local y CI.

## Veredicto

**Apto con reservas.** El criterio de cierre de #235 se cumple de punta a punta y lo comprobé yo: el ai_server real (uvicorn, SDK real, `validate_scene_response` real) recibe la petición del bridge real por HTTP, el modelo sustituido contesta exactamente una vez con clave falsa, `barkeep` y `bandido_1` llegan al wire con `role` y `description` verbatim, y quitar cualquiera de las dos copias pone el guion rojo con nombre (3 y 2 rojos). Cero créditos por construcción y por medida (`ss` sin salientes). `NEFAN_LLM_MCP_URL` hace explícito el backend: `off` no abre ningún WebSocket, basura lanza y sin ella el ai_server hace lo de siempre. El CI de la PR está verde y el job nuevo corrió el guion de verdad (19 ✔ con deps recién instaladas). Sin regresión: 2067 tests, ruff, 236 Python, guion 40.

Las reservas: el guion no limpia tras Ctrl+C (dos procesos huérfanos, uno de ellos un ai_server con clave en el entorno, y un tmp) — importante para una corrida que se anuncia local y en una máquina compartida—, y tres menores (19 ≠ 21, `SIN MEDIR` donde debería decir `ROJO`, ruta personal duplicada). El AttributeError del apagado es de `main` y va a issue, no a esta PR. Ninguna reserva compromete el criterio de cierre ni el dinero; la primera sí compromete la promesa escrita en la cabecera del guion, y debería corregirse antes de mergear o, si el coordinador prefiere no reabrir, quedar como issue abierto el mismo día.
