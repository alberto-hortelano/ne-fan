**Veredicto: APTO CON HALLAZGOS** — PR #456 (#453), HEAD `c97a3e5`, worktree `ne-fan-t13-qa-a`, 2026-09-05.

Los tres códigos del criterio del issue se cumplen en el flujo real (`./start.sh --preset e2e-sin-creditos`,
offset 600) y en el cable entero (bridge real + motor falso): sin partida **409** estructurado con `ok:false`
y «No se ha aplicado nada» en las 12 mutadoras del contrato y en ninguna lectura; con partida **200** y el
ítem en `state.json`; si persistir falla **500** «aplicado en memoria pero NO guardado: <motivo>», y es
verdad (el ítem está en memoria y no en el save). El log del bridge no dice `onMutation failed`. La sesión
provisional (#279) muta con 200 y no escribe. Ningún hallazgo es bloqueante; dos son de texto/herramienta y
uno preexistente fuera del alcance.

## Criterios (del issue #453 y de la crítica)

| Criterio | Veredicto | Evidencia |
|---|---|---|
| Sin sesión, `POST /entity/player/inventory {item:{id:"x"}}` → 409 estructurado, `ok:false`, texto que dice que no se aplicó nada | ✅ | Stack real offset 600, `curl` → `409 {"ok":false,"error":"no_session: POST /entity/player/inventory muta la partida y el bridge no tiene ninguna activa (…). No se ha aplicado nada. Abre o reanuda una partida…"}`; `GET /entity/player/inventory` → `[]` después |
| El log del bridge NO dice `onMutation failed` | ✅ | `grep -c "onMutation failed" /tmp/nefan-ne-fan-t13-qa-a-600/nefan-bridge.log` → `0` tras toda la batería (incluido el 500) |
| TODAS las mutaciones del State API rebotan sin sesión | ✅ | Las 12 con `mutates` (`upsertPlace, addLink, addTrigger, appendSceneAssetRefs, addInventoryItem, removeInventoryItem, setVocabulary, resolveScheduledEvent, registerPlugin, moveNpcToPlace, arriveNpc, setNpcDirective`) → 409 en el stack real y en el guion (bloque 1, leyendo la tabla de `dist/`). Las 12 coinciden una a una con los 12 handlers que llaman a `mutated()` (`grep -rn "mutated(" bridge/state-http/*.ts`: map 3, entity 2, scene 1, doc 2, plugin 1, npc 3). `narrativeProgress` solo difunde (`ctx.onProgress`), `validateScene` calcula: ninguna escribe estado sin declararlo |
| Las lecturas y los POST que no mutan NO son 409 | ✅ | `GET /entity/player` 200 · `GET /entity/player/inventory` 200 · `POST /scene/validate {}` 400 (dominio) · `POST /narrative_progress` 200 · `GET /story` 404 (dominio, se conserva) · `POST /no/existe` 404 (la guardia va tras el match). 16 no-mutadoras verdes en el guion |
| El body no se lee antes del 409 | ✅ | `POST /entity/player/inventory` con body `esto-no-es-json` → 409 (con la guardia anulada → 500 `invalid JSON body`) |
| Con sesión la misma ruta → 200 y el ítem en el save | ✅ | `start_session` por WS (`session_started ok:true`, `ready source:engine`), `session_entered` → `saves/<sid>/state.json` aparece; `POST {id:"y"}` → 200; `state.json → player.inventory = [{"id":"x"},{"id":"y"}]` |
| Sesión provisional (#279): mutación en 200, `save()` → `escrito:false` sin lanzar | ✅ | Entre `start_session` y `session_entered`: `POST {id:"x"}` → 200, `GET` lo devuelve, `saves/` **no existe**, log sin 500 ni `onMutation`. Al entrar, la primera escritura arrastra `x` (estado entero). Unit: `state-http-server.test.ts` «la sesión PROVISIONAL (#279) no es «sin sesión»…» |
| `onMutation` lanza → 500 con el estado exacto, y es cierto | ✅ | `chmod 555 saves/<sid>` → `500 {"ok":false,"error":"aplicado en memoria pero NO guardado: EACCES: permission denied, open '…/state.json.tmp'"}`; `GET` inventario = `[x,y,z]`; `state.json` = `[x,y]`; log: `StateHttpServer: POST /entity/player/inventory aplicado en memoria pero NO guardado: EACCES…`. Tras `chmod 755`, `POST {id:"w"}` → 200 y el save pasa a `[x,y,z,w]` |
| El save se borra → la mutadora vuelve a 409 | ✅ | `delete_session` por WS → `/health session_id:""` → `POST` → 409 `no_session` («…o el save se borró») |
| Cabecera de otra sesión / `undefined` | ✅ (preexistente) | `x-nefan-session: otra-sesion` y `undefined` → 409 `session_mismatch`; con espacio final → 200 (Node recorta el valor de la cabecera; no es un agujero) |
| Al motor le llega el texto | ✅ por lectura | `narrative-mcp/bridge-http-client.ts:100-105`: todo no-2xx → `{ok:false, status, error: data.error}`; `server.ts:602 reportBridge` → `isError:true` con `{error, data}` en el texto de la tool. No se ejerció un narrative-mcp vivo (exige terminal de Claude en :3737); ver «No probado» |
| `npm run verify` | ✅ | `2101/2101`, exit 0 |
| `npm run deuda` 83 = 83 | ✅ | `15 + 11 + 57`. Ojo: sin `npm run coverage` previo el bloque CRAP dice «sin medir · 0» y la suma parece 72; con lcov, 11 |
| Aviso de mutación: `state-http-dispatch` 122 > `tope_local` 120 | ⚠️ ver H1 | `npm run mutacion -- pendiente` → «Medibles aquí (tope 120): … state-http-dispatch 103 …»: la herramienta **aún no lo rechaza** (lee la huella commiteada: 103) |
| CI de la PR | ✅ | `gh pr checks 456`: ai-server, candados-headless, narrative-mcp, nefan-core, nefan-html en `pass` |
| Cero créditos | ✅ | `e2e-sin-creditos` + motor falso; ningún servicio de pago arrancado |

## Hallazgos

**H1 · importante (herramienta, no código de la PR) — el módulo `state-http-dispatch` quedará fuera de `local` sin que nadie lo diga hasta la próxima corrida.**
`npm run mutacion -- local <id>` toma el coste de la huella (`costeDe(plan, leerHuella(), id)`, `scripts/mutacion.ts:838`), que hoy dice 103; el ingeniero midió 122 en local y la herramienta lo dejó pasar. Cuando CI actualice la huella, `local state-http-dispatch` se negará (122 > 120) y el siguiente ingeniero que toque el despacho tendrá que pedir la corrida. Repro: `npm run mutacion -- pendiente` → lista `state-http-dispatch 103` como medible. Esperaba que la decisión (subir el tope, o sacar `src/contracts/http.ts` del módulo y darle batería propia) quedara tomada en la PR o en un issue, no en un párrafo del informe. El aviso del ingeniero es honesto; lo que falta es el dueño de la decisión.

**H2 · menor (texto de la PR) — el «cambio observable» declarado no es observable.**
`implementacion-1.md` y el cuerpo de la PR dicen: «en `cliente-web` con fixture `POST /scene/asset_refs` pasa de 404 a 409». Medido en el stack real (offset 600, Chromium propio): al cerrar el título con «✕ cerrar (modo fixtures, sin sesión)» y cargar `robledo_tile`, el cliente **no pide el atlas** ni con la tecla G — registra «atlas fps de tile_0_0: no hay estilo de sesión (una fixture no lo tiene). Empieza una partida…» y no hay ninguna petición a `/generate_surface_atlas` ni a `/scene/asset_refs` (0 respuestas en 30 s). Por tanto el jugador no ve nada distinto, ni antes ni ahora. La afirmación de la PR describe un camino que no existe; corregir el texto (o borrar la frase) para que no se convierta en documentación falsa. Lo mismo para `setVocabulary`: solo lo llama el motor con sesión (`generate_game`, `vocabulary_set`).

**H3 · menor (preexistente, fuera del alcance de #453) — sin sesión, las lecturas de entidad inventan un jugador.**
`GET /entity/player` sin sesión → `200 {"player":{"level":1,"class":"rogue","health":100,"gold":0,"inventory":[],…}}` mientras `GET /story` → `404 no active session`. Dos semánticas de «sin partida» para leer: una dice que no hay, la otra devuelve un jugador fantasma que el motor puede tomar por real. No lo introduce esta PR (la crítica acotó #453 a las mutaciones), pero es la mitad de lectura del mismo problema. También cosmético: `session_mismatch` sin sesión activa imprime «la sesión activa del bridge es  —» (hueco vacío).

**H4 · menor (experiencia del motor) — el 500 no le dice al motor qué hacer.**
El body dice «aplicado en memoria pero NO guardado: EACCES…». El motivo de no reintentar («duplicaría la mutación») vive en un comentario del código, no en el mensaje; y es cierto: `addInventoryItem` hace `push` sin deduplicar (`narrative-state.ts:781-784`), así que un motor que reintente tras el 500 duplica el ítem. Verificado que la siguiente mutación que sí guarda arrastra la huérfana (`[x,y,z,w]` en disco tras restaurar el disco). Sugerencia: añadir al body «no reintentes: la próxima escritura que sí guarde la incluirá», que es lo que pasa.

## Guion ejecutable

`qa/el-state-api-no-muta-sin-partida.mjs` — **grupo headless** (no abre navegador): bridge real + `fake-ai-server` + disco efímero;
puertos del bridge/State API de `lib/stack.mjs` (honra `NEFAN_PORT_OFFSET`), el del motor falso lo elige el kernel; se niega si
un puerto está ocupado, mata solo a sus hijos por PID (también con Ctrl+C) y restaura el `chmod` antes de borrar. Recorre la
tabla `WorldStateApi` de `dist/` (no la copia). Registrado en `ci.yml` (job `candados-headless`, tras `el-npc-cruza`) y en la tabla
de `qa/README.md`.

- Verde: `NEFAN_PORT_OFFSET=600 node qa/el-state-api-no-muta-sin-partida.mjs` → 49 ✔, `0 rojo(s) · 2.4 s`, exit 0.
- Negativo A (guardia `sinSesionParaMutar` anulada en `dispatch.ts`): **14 rojos** (las 12 mutadoras entran hasta el handler y
  contestan 400/404 por el body; JSON roto → 500; bloque 5 → 500 `no hay sesión que guardar`). Restaurado.
- Negativo B (`catch` de `onMutation` devuelto a `warn` + 200 en `state-http-server.ts`): **3 rojos** (200 en vez de 500; el log
  vuelve a decir `onMutation failed`). Restaurado. `git status` limpio salvo los ficheros de QA.
- `npm test` con el guion en el árbol: 2101/2101 (las reglas sobre `qa/**` —`nadie-inventa-un-puerto`— no se quejan).
- Supuesto: el bloque 4 (500 por `chmod 555`) exige correr sin root; el runner de GitHub es `runner`, no root.

## Workarounds usados y veredicto

1. **`chmod 555` al directorio del save** para provocar el fallo de persistencia. Inyección de fallo del ENTORNO, no del código:
   un disco lleno o de solo lectura le pasa igual al jugador. Legítimo; no es hallazgo.
2. **Partida abierta por WebSocket sin navegador** (`start_session`, `session_entered`, `delete_session`): son los mismos mensajes
   que manda `bridge-client.ts` desde el título. Equivalente al camino del jugador para lo que se mide (estado del bridge).
3. **El navegador del MCP de Playwright estaba compartido con otro agente**: a mitad de mi prueba la página pasó a
   `localhost:3700` (stack del worktree `ne-fan-t13-qa-b`). Abandoné esa herramienta y repetí con un Chromium propio
   (`qa/lib/navegador.mjs`) contra mi stack :3600. Lo apunto para el coordinador: ese MCP no aísla sesiones.
4. La fixture se cargó con `#ts-close` (botón del jugador) + `window.__nefan.loadFixture("robledo_tile")` (el gancho que usan
   todos los guiones del banco). Equivalente al selector «Room».

## No probado

- **narrative-mcp vivo** recibiendo el 409/500: exige un terminal de Claude Code dueño de :3737. Verificado por lectura que el
  texto viaja (`request()` → `{ok:false,status,error:data.error}` → `reportBridge` → `isError:true`); no se observó una llamada
  real del modelo.
- **La sesión efímera de `game-gen.ts` («Crear mi mundo»)** de extremo a extremo. Se ejerció el MISMO estado
  (`existencia: "provisional"`, `save()` → `escrito:false`) por el único camino que lo alcanza desde el cable —`start_session` sin
  `session_entered`— y lo cubre el unit «la sesión PROVISIONAL (#279)…» de `state-http-server.test.ts`. `generate_game` en el motor
  falso existe (`/develop_world`), pero no añade ningún estado distinto al medido.
- **Corrida de mutación**: no autorizada en esta tanda por decisión del 2026-09-04; el 122/100 % es medida local del ingeniero.

## Medidas

- `npm run verify` → 2101/2101, exit 0 · `npm run coverage && npm run deuda` → 15 + 11 + 57 = 83 · `npm run mutacion -- pendiente`
  → 27 commits sin medir, `state-http-dispatch 103` medible (huella desactualizada; ver H1) · `gh pr checks 456` → 5/5 pass.
- Stack propio parado con `NEFAN_PORT_OFFSET=600 ./start.sh --parar` (los stacks ajenos en offset 0 y 700 se enumeraron y no se
  tocaron). El árbol del worktree no se ensució: `saves/` y `data/games/*/world/` están en `.gitignore`.
