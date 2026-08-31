# QA — remote-gen atado por los dos lados (#318 + #319 + #256)

Rama validada: `tanda/remote-gen-atado` (5 commits sobre `4bb014e`, sin push). Todo lo de abajo
lo corrí yo — no se da por bueno nada del informe del ingeniero sin repetirlo o falsificarlo.

## Criterios

| # | Criterio | Veredicto | Evidencia |
|---|----------|-----------|-----------|
| 1 | `cached` entra al contrato; el `satisfies … & { cached }` del fake desaparece | ✅ cumple | `SkinSpriteSheetResponse` declara `cached: boolean` con el docstring del LED (`remote-gen.ts:114`); el fake queda `satisfies SkinSpriteSheetResponse` a secas (`fake-ai-server.ts:579`, grep de la intersección → 0). En el wire REAL: `node qa/sprites-sin-servicio.mjs` VERDE en mi corrida — «servicio arriba: 200 **cached**, 64 urls» contra remote-gen de verdad (cero créditos por diseño del guion). En el fake: mi curl y mi guion ven `cached=false` viajar |
| 2 | Los 5 sitios importan el contrato; censo inline → 0; sin campos inventados ni re-casts (afinado A) | ✅ cumple | Censo `\.json\(\)\s*\)?\s*as\s*\{` en `nefan-html/src` → **0** (era 5). Los 5 diffs verificados uno a uno: todos `import type … from "@nefan-core/src/contracts/remote-gen.js"`. `error?: string` → 0 en los dos ficheros; el `meta` re-tipado se resolvió declarando `SpriteSheetMeta` en el contrato (decisión explícita del plan, no re-cast). Campos leídos ⊆ declarados en los 5 (revisados línea a línea, incluidos `estimated_cost_usd`/`uploaded` de title-screen). `npx tsc --noEmit` y `npm run lint` del cliente verdes |
| 3 | Candado anti-reaparición, probado en negativo | ✅ cumple | Creé un fichero NUEVO (`nefan-html/src/qa-tripwire-negativo.ts`) con un `as {` inline → `architecture.test.ts` ROJO nombrándolo con su línea (`qa-tripwire-negativo.ts:4 — patrón prohibido`) — el glob caza sitios que no existían, que es la clase. Borrado → 51 pass / 0 fail (los 8 usos sanos pasan). El test en negativo permanente con `SourceFile[]` fabricados existe y pasa |
| 4 | Los dos campos mudos rompen (negativo sobre el dict de salida) | ✅ cumple | Renombré `sprite_skin_model` (el campo que el ingeniero NO probó) SOLO en el dict de salida de `cache_assets.py:68` → `unittest discover` ROJO nombrándolo (`'modelo_skin_sprites' != 'sprite_skin_model'`, 137 tests, FAILED). Revertido → OK. El censo es `sorted == lista exacta` (caza también claves sobrantes) y los dos modelos van además por valor (cruce de claves) |
| 5 | El fake enruta por pathname | ✅ cumple | Fake standalone en puerto libre: `GET /health?x=1` → **200**, `POST /skin_sprite_sheet?x=1` (body válido) → **200** con el shape del contrato. La divergencia declarada verificada tal como está escrita: `/health/` → 200 (FastAPI daría 307), comentario en `fake-ai-server.ts:281-286`. Además guion nuevo (abajo) probado en negativo contra el fake de main: ROJO 3/3, incluido el ref corrupto real (`ref="mi_ref?x=1"`) |
| 6 | `/backend_status` retirado ENTERO | ✅ cumple | Grep multi-término (`backend_status`, `BackendState`, `BackendStatusResponse`, `backendStatus`, `has_api_fallback`, `get_bridge_status`) fuera de `archivo/` y `docs/agents/` → **0**. App ensamblada real (`TestClient(main.app)` sin lifespan): `backend_status en rutas: False`, `GET → 404` — con control positivo (`GET /analyze_weapon` → 405: la app probada está montada de verdad, el 404 no es de una app vacía). `ia-servicios.md` sin la fila del panel; README/migration de microservices reescritos citando la retirada (#256). Sin imports huérfanos en `llm_client.py` (`uuid`/`time` siguen con 4/22 usos). Cobertura perdida: ninguna — confirmado (0 tests, 0 llamadores) |
| 7 | verify + Python + batería + deuda sin crecer + PR | ✅ cumple (tramo PR pendiente, del coordinador) | `npm run verify` → **1677 tests, 0 fail** (corrido por mí). `unittest discover ai_server/tests` → **137 OK** (dos veces). Batería **repetida por mí**: `node qa/run.mjs` → **45 en verde · 0 en rojo de 45** (capturas `qa/capturas/2026-08-31T14-21-23-000Z-214039`) — mismos verdes que la BASE. `npm run deuda` → **65 items = 65 de la base**. `npm run afectado` → ningún módulo de mutación (ambos contratos en `sin_mutar` con motivo escrito, verificado en la salida). La PR con los `Closes #…` no existe aún (rama sin push): es del coordinador, como declara implementacion.md |

**No repetido, con motivo**: `npm run coverage && npm run crap -- --check`. El diff no añade
lógica ejecutable a módulos de core medidos (contratos = tipos; el resto es cliente, labs,
ai_server y tests, fuera del perímetro CRAP), la deuda quedó idéntica y el CI de la PR lo corre
de todas formas.

## Flujo real (lo que ve el jugador)

- **Batería propia 45/45** desde el arranque (`e2e-sin-creditos`, bloque de puertos con lock del
  runner). Los guiones del camino del skin (`07-npc-clave-del-skin`,
  `21-sin-generar-sprites-los-personajes-son-y-bot`, `13-personajes-animados`) en verde.
- **El LED «reusado vs pintado»**: la contabilidad es el `StyleRunLedger`
  (`style-apply.ts:117`, alimentado por `data.cached` en `:447`) y el resumen visible del título
  («Estilo aplicado: N celdas y M skins **nuevos** ($X)», `title-screen.ts:1020`). El campo
  `cached` que la alimenta ahora está declarado en el contrato y viaja de verdad: verificado en
  el fake (guion nuevo) y en remote-gen real (`sprites-sin-servicio`, «200 cached»). La captura
  `07-…-01-plan-de-estilo.png` muestra el coste anunciado ANTES de aplicar («~$0.30 … los skins
  y páginas ya en caché no se repagan»).
- **¿Y si el endpoint devuelve 5xx?** Ningún silencio, en ninguno de los dos caminos:
  - Batch de estilo: `catch → failures.push` → el título pinta «N fallos (ver registro)» en rojo
    (`title-screen.ts:1017`) y las failures van a las notes del registro. Comportamiento intacto
    tras la migración (el catch ya existía).
  - Camino de juego (sprite-renderer): `errors.push("sprite", "skins IA desactivados para la
    sesión (los personajes usan la base y_bot)…")` — **visto en pantalla** en la captura del
    guion 21, que simula la caída de sprite-forge y verifica el error-log y el fallback a y_bot.
- **Pérdida de comportamiento buscada (pasada adversarial), no encontrada**:
  - Los `?? 0` retirados de `StyleCompleteResponse`: las TRES ramas del productor real emiten
    siempre `generated` + `cost_usd` (`styles.py:276`, `style_pack_builder.py:212,296`); los
    fallos van por HTTPException que el cliente maneja con `!res.ok` antes del cast. El fake
    emite `satisfies StyleCompleteResponse`. Sin hueco.
  - El guard de sprite-renderer pierde el rótulo `missing meta/frame_urls` ante un 200 que viole
    contrato (declarado por el ingeniero): el fail-loud sobrevive (TypeError dentro del try →
    mismo catch → error-log), solo cambia el rótulo. El caso del `error?` con 200 no existe en
    el server real (solo emite `"ok": True`; verificado en `remote_generation.py`).

## Hallazgos

1. **(Confirmado, para issue — no de esta tanda) Protocolo WS `bridge_status` huérfano.**
   Censo propio: `bridge_status_request` se RECIBE en `narrative-mcp/ws-bridge.ts:197` (y
   responde en `:231`), la respuesta se consume en `llm_client.py:174`, los tipos viven en
   `narrative-mcp-ws.ts:59,94` — y tras borrar `get_bridge_status` no queda NINGÚN emisor.
   Valoración: **issue de retirada**, no arreglo en esta tanda — cruza a narrative-mcp (repo con
   su `dist` y build propios) y al contrato del WS :3737, fuera del alcance de los 3 issues.
   `docs/microservices/README.md:138` («bridge_status» en la lista del WS) sigue siendo verdad
   mientras viva el protocolo y se irá con ese issue.
2. **(Menor) `SpriteSheetMeta` se presenta como «contrato observado del wire» pero omite
   `generated_at`**, que viaja SIEMPRE: está en todos los meta.json de sprite-forge (verificado
   en `nefan-html/public/sprites/y_bot/idle/frontal_8/meta.json`) y en la respuesta del fake.
   Nadie lo lee en TS (grep → 0 lectores), así que no rompe nada ni toca los criterios (el
   afinado A habla de LEER campos no declarados); es una omisión del censo que el docstring
   promete. Para la próxima pasada por ese fichero.
3. **(Observación, preexistente, fuera del alcance)** En las capturas de partida: la etiqueta de
   la barra de vida del enemigo (arriba-izquierda) es ilegible y el log inferior-izquierdo se
   trunca en el borde. Presentes también en la corrida BASE — no atribuibles a este diff (la
   tanda no toca render ni HUD).

## Workarounds usados durante la prueba

- **TestClient sin lifespan** para el criterio 6 (igual que el ingeniero): el lifespan arranca
  clientes reales; la pregunta es de enrutado, no de runtime, y el control positivo (405 en una
  ruta viva) descarta el falso 404. No afecta al usuario: el jugador nunca llama ese endpoint
  (esa es justo la premisa de la retirada).
- La caída de sprite-forge del guion 21 la **simula el propio guion del banco** (es su diseño,
  no un apaño mío).
- Mi primera versión del guion nuevo dejó un fake residual en el puerto (matar `npx` no mata a
  `tsx`): lo maté verificando `/proc/<pid>/cwd` = este worktree (proceso propio) y corregí el
  guion (`detached` + kill del grupo). Defecto mío, no del diff.
- Ningún workaround oculta nada que el jugador fuera a tener delante.

## No probado

- **Gasto real de créditos** (LED con `cached=false` de un pintado REAL vía Meshy/fal): fuera de
  alcance por la restricción de cero créditos. El camino equivalente quedó cubierto por el fake
  (pintado simulado) y por el cache-hit real (`sprites-sin-servicio`, reusado real).
- **CI de la PR** (no existe PR aún): el hook `Stop` del coordinador lo exige antes de cerrar.
- `coverage + crap --check`: no repetido, motivo arriba.

## Candado nuevo dejado (sin commitear, decisión del coordinador)

`qa/fake-enruta-por-pathname.mjs` — el comportamiento runtime del criterio 5 no lo cubría nada:
el typecheck de labs no ve enrutado y ningún guion del runner llama al fake con query. Arranca
su propio fake (puerto de `PUERTOS_TODOS.fake_ai`, honra `NEFAN_PORT_OFFSET`, cero créditos),
verifica `/health?x=1` → 200, `POST /skin_sprite_sheet?x=1` → 200 con `ok` y `cached` del
contrato, y que el ref del unpin no se corrompe con query. **Probado en negativo de verdad**:
con el fake de `main` restaurado temporalmente sale ROJO 3/3 (y demuestra la corrupción real
del ref: `"mi_ref?x=1"`); con el de la rama, VERDE. Vive fuera de `qa/guiones/` como
`sprites-sin-servicio.mjs` (arranca y mata su servicio, sin navegador).

## Veredicto

**APTO.** Los 7 criterios se cumplen con evidencia propia; los tres candados se ponen rojos
cuando deben (dos los rompí yo por el flanco que el ingeniero no probó); la batería repetida da
los mismos 45 verdes que la base; la deuda no crece. Queda para el coordinador: push + PR con
los tres `Closes #…`, CI verde, la decisión sobre adoptar el guion nuevo, y el issue del
protocolo WS huérfano (hallazgo 1, al que puede sumarse el backlog de `ai-client.ts:62` que ya
anota implementacion.md).
