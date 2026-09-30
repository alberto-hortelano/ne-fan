# Tanda CA — Retirar `weapon_orient` y `weapon_verify` (#790)

## Petición literal del usuario (2026-09-30)

> «sigue con lo que falta»

Viene tras la demo. #790 es el único issue de núcleo abierto.

## El issue

`gh api repos/:owner/:repo/issues/790` (gh 2.4: `gh issue view` falla por Projects classic).

- `weapon_orient` y `weapon_verify` siguen cableados en `narrative-mcp/server.ts` (~198-222, 539-545), en ai_server (`/analyze_weapon`), en los prompts y en el zod.
- Nada del juego llama a `/analyze_weapon`: son kinds vivos sin productor.
- Pre-producción, cero compatibilidad: se retiran enteros en todos los procesos. La reaparición se canda como se hizo con `stage_request` en `arch-rules.json`.
- Una retirada incluye el barrido de prosa, comentarios y docs (memoria: «los rastros confunden a los agentes»).

## Lo que hay que verificar

- `grep` en todo el repo, y también en `~/code/sprite-forge`: ningún productor vivo.
- Ningún guion de `qa/` ni bench de `labs/` los ejerce como productor.
- Si el arte de armas (Meshy / `model_hash`) depende de ellos, qué se pierde. La cadena por hash ya murió con #199.

## Restricciones de la sesión

- NUNCA `git stash`.
- No matar servidores ajenos. **El usuario tiene un stack `play` corriendo en los puertos por defecto y está jugando**: no se toca. `qa/run.mjs` elige su propio bloque.
- No tocar el tag `mutacion-ultima` ni `reports/mutation/` del árbol principal.
- `bateria-n.log` es de otra sesión.
- Hay otras tandas en paralelo: BX (terminar conversación, `dialogue-panel.ts` y `start.sh`), BY (saltar), BZ (lo que ve el motor) y CA (#790). Si tu cambio pisa sus ficheros, dilo en tu informe.

## Ajustes tras la crítica (aceptados por el coordinador)

Se acepta el alcance ampliado (texto de la crítica, abajo). Orden con BZ: CA va primero; BZ rebasa sobre CA si toca las mismas líneas de narrative-mcp/server.ts.


> **Alcance ampliado por la crítica:** la retirada incluye el canal de wire `vision_request`/`vision_response` completo (`narrative-mcp-ws.ts`, `protocol.ts`, `ws-bridge.ts`, `server.ts` `VISION_KINDS`, `llm_client.py:194`), porque esos dos kinds son sus únicos inquilinos; y `AnalyzeWeaponRequest/Response`/`analyzeWeapon` de `src/contracts/narrative-llm.ts`. El test `el-prompt-del-motor-no-enumera-kinds.test.ts` (#792) pasa los dos kinds a su `RETIRADOS`, resolviendo el choque con el candado `campos-retirados-no-vuelven`. El `api_client` de `llm_client.py` NO se retira (lo usan otros caminos). Coordinar con BZ las descripciones de `narrative_listen`/`narrative_respond` en `narrative-mcp/server.ts`.
