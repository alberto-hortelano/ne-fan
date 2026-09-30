# QA — Tanda CA (#790): retirar weapon_orient/weapon_verify y el canal vision_*

Commit verificado: `0c5670eb` (rama `tanda-ca-retirar-weapon`), árbol limpio antes y después.
Petición: «sigue con lo que falta» → #790 (retirar entero, sin productor, candar reaparición, barrer prosa).
No es observable por el jugador: el objetivo es que nada vivo lo necesitaba y que el juego sigue funcionando.

## Criterios

| # | Criterio | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | Ningún productor ni consumidor vivo en el repo | ✅ | grep propio, `--exclude-dir={node_modules,.git,dist,reports,cache,runs}`, 16 términos (+`VisionRequest`/`VisionResponse`/`verify_weapon`): solo `docs/agents/**`, `docs/auditoria-2026-08.md` (registro fechado), `arch-rules.json` y `test/el-prompt-del-motor-no-enumera-kinds.test.ts` (exceptuado con motivo). Incluye `.claude/`, `labs/`, `qa/`, `start.sh`, prompts `.md` y `data/contract/tools`. `narrative-mcp/dist` y `nefan-core/dist` recompilados: 0 hits |
| 2 | Nada en `~/code/sprite-forge` | ✅ | `grep -rniE '<términos>\|weapon.?orient\|vision'` (sin node_modules/.venv) → 0 ficheros |
| 3 | El motor ya no ofrece esos kinds | ✅ | `tools/list` por stdio a `narrative-mcp/dist/server.js` (puerto aislado `NARRATIVE_WS_PORT=13939`): `narrative_listen` enumera scene / develop_world / player_death / …; `narrative_respond` scene / narrative_event. Ni weapon ni vision |
| 4 | Suites verdes | ✅ | `npm test` (nefan-core) `tests 4067 · pass 4067 · fail 0`; `tsc -b` de narrative-mcp OK; `python -m unittest discover -s ai_server/tests` → `Ran 274 tests … OK` |
| 5 | Partida de punta a punta desde el título: escena, diálogo, combate con armas | ✅ | `node qa/run.mjs 19 89 84 15 83 129 17 03` (bloque elegido por el runner, e2e sin créditos): **8 en verde · 0 en rojo de 8**. 19 = título→Comenzar→partida; 15/129 = generate_scene ×10, guardia, hostil, combate; 83 = conversación; 17 = guardar/reanudar; 84 = cinco aros de `short_sword` contra core; 89 = el bridge dice `war_hammer` y los cinco aros pasan a los del martillo. Capturas en `qa/capturas/2026-09-30T17-14-50-840Z-1484731/` (15-05 guardia, 89-04 aro del martillo + «100 / 150») |
| 6 | Armas de `combat_config` intactas | ✅ | `combat_config.json` weapons = `['unarmed','short_sword','war_hammer']`; no está en el diff |
| 7 | Reaparición candada | ✅ | En negativo, propio: `# msg["type"] == "vision_response"` en `ai_server/llm_client.py` + `// kind: VisionImage` en `nefan-html/src/main.ts` → `architecture.test.ts` `fail 1` citando ambos ficheros:línea. Revertido con `git checkout -- <2 ficheros>`, árbol limpio |
| 8 | El patrón nuevo no da falsos positivos | ✅ | Regex real de la regla (flags `gm`, case-sensitive) contra: `vision`, `visión del motor`, `vision_model`, `provision_request`, `image_vision_request`, `super_vision_request`, `VisionImages`, `visionRequest`, `weapon_orientation`, `weapon`, `orient` → todos `false`. Los 16 términos son compuestos; «vision» a secas no está. Hoy quedan 15 usos legítimos de «vision/visión» en los roots y el gate está verde |
| 9 | Barrido de prosa viva | ⚠️ parcial | ver hallazgo M1 |

**Guion nuevo: no.** Lo mecánico (grep a cero y reaparición) lo sujetan `campos-retirados-no-vuelven` (probado en rojo arriba) y `el-prompt-del-motor-no-enumera-kinds.test.ts` (su `RETIRADOS`, que cubre `start.sh`, fuera de los roots del gate; el ingeniero lo vio rojo). La salud del juego la cubren los 8 guiones existentes.

## Hallazgos

- **Menor M1 — dos rastros que ahora mienten.** Con `analyze_weapon` fuera, ai_server ya no hace NINGUNA llamada de visión, pero:
  - `nefan-core/src/contracts/service-registry.ts:51` — descripción de `narrative-llm`: «…develop_world, **reviews con visión**». Es un string vivo (va al snapshot de config), y
  - `docs/microservices/README.md:17` — la misma frase, en un fichero que esta tanda SÍ editó.
  - `ai_server/main.py:74` — «Este proceso solo conserva lo narrativo **y la visión**».
  Repro: `grep -rn "reviews con visión\|y la visión" nefan-core/src ai_server docs/microservices`. Esperado: prosa sin capacidades que ya no existen (memoria «los rastros confunden a los agentes»).
- **Menor M2 (preexistente, fuera de alcance)** — `data/contract/prompts/tile_instructions.md:96,152,247` y `ui_systems.md:95` le hablan al motor de un «vision classifier» que no existe desde la retirada de `scene_classify`. No lo introduce esta tanda; se anota para BZ (lo que ve el motor).
- **Menor M3 (agujero del candado, conocido del patrón)** — el `\b` final deja pasar variantes: `vision_request_id`, `visionRequest`, `vision-request`, `analyze_weapon_v2` no casan. Coherente con el resto de la regla (términos exactos); no bloquea.

## Workarounds

Ninguno sobre el juego. Para listar las tools de narrative-mcp lo arranqué por stdio en `:13939` para no tocar el `:3737` del stack del usuario; no afecta a nada que vea el jugador. (Nota lateral: `NARRATIVE_EAGER_BIND=0` enlaza igual, porque `ws-bridge` comprueba la verdad del string; preexistente.)

## No probado

- El motor narrativo REAL (Claude vía MCP) recibiendo encargos: el banco usa fake-ai-server, que suplanta a ai_server, así que `narrative-mcp/server.ts` y `llm_client.py` no se recorren en E2E. Cubierto por build + tools/list + unittest + la prueba de wire del ingeniero (`room_request`/`narrative_event` → `no_mcp_listener`).
- Gasto real de créditos: nada del diff gasta.

## Veredicto

**Apto con reservas.** La retirada es completa (grep propio a cero en repo y sprite-forge), el juego sigue de punta a punta (8/8 guiones, espada y martillo), el candado se pone rojo y no tiene falsos positivos con «vision» en otro sentido. Reserva única: M1, tres líneas de prosa que atribuyen visión a ai_server.
