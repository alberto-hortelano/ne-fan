**VIGENTE** — sin productor desde #209 (Godot fuera). Retirar entero es correcto; el alcance real es algo **mayor** que lo que enumera el issue: se lleva el canal de wire `vision_request`/`vision_response` completo, porque esos dos kinds son sus únicos inquilinos.

Crítica sobre `a6891c3c` (main = worktree `ne-fan-tanda-ca`).

## El problema real, en una frase

Hay dos kinds del motor (y un endpoint, un canal de wire, dos zod, dos prompts, dos tools) que nadie del juego pide, y le cuentan al motor y a los agentes un contrato que no existe.

## La premisa, afirmación por afirmación

| Afirmación | Verificación |
|---|---|
| Cableados en `narrative-mcp/server.ts` | Sí: `server.ts:22-30` (`VISION_KINDS` + guardia de deriva de tipos), `:75-77` (carga de prompts), `:165-166` (descripción de `narrative_listen`), `:198-226` (rama `vision_request`), `:448-449` (descripción de `narrative_respond`), `:539-549` (pre-flight), `:602-608` (`sendVisionResponse`) |
| En ai_server `/analyze_weapon` | Sí: `routers/generation.py:49-89`; `llm_client.py:542-690` (`analyze_weapon`, `_via_mcp` que emite `vision_request` en `:582`, `_via_api` con tool `orient_weapon`); `narrative_schemas.py:1062-1125`; test `ai_server/tests/test_weapon_orient.py` |
| En los prompts y el zod | Sí: `data/contract/prompts/weapon_{orient,verify}.md`, `data/contract/tools/weapon_{orient,verify}.json`, `src/contract/model-io/schemas.ts:271-339` y registro `:369-380`; reexport en `src/index.ts:68-69`; `narrative-mcp/validators.ts:13-45` |
| Nada del juego llama a `/analyze_weapon` | **Cierto.** `analyzeWeapon` solo aparece en su propia declaración (`src/contracts/narrative-llm.ts:161`). Ningún hit en `nefan-html/`, `nefan-core/bridge/`, `qa/`, `labs/` ni en el fake-ai-server. El último llamador fue Godot (`combat_animator` / `weapon_vision_renderer.gd`), borrado en `49bf7d0b` (#209). |
| sprite-forge | `grep -rli "analyze_weapon\|weapon_orient\|weapon_verify\|analyzeWeapon" ~/code/sprite-forge` → 0; ni siquiera hay ficheros con «weapon» en su código. |
| ¿El arte de armas depende de ellos? | No. `grip_point`/`blade_direction`/`weapon_mesh` no aparecen fuera del propio contrato; el asset-store no tiene kind de arma. Las armas del juego son números de `combat_config.json`. **Coste de arte: cero.** |

## Lo que el issue NO enumera y la retirada arrastra (corrección hacia **mayor**)

1. **El canal de visión del wire entero.** `VisionRequestMsg` (`src/contracts/narrative-mcp-ws.ts:33-36`) solo admite `kind: "weapon_orient" | "weapon_verify"`; `VisionResponseMsg` (`:77-78`) igual. Sin ellos no queda ningún inquilino: sale de las uniones (`:62,67,100`), de `narrative-mcp/protocol.ts:12,16`, de `ws-bridge.ts:215,237,286-291,394-399` y del consumidor Python `llm_client.py:194`. Dejar el canal vacío «por si vuelve la visión» sería exactamente la compatibilidad que CLAUDE.md prohíbe.
2. **`src/contracts/narrative-llm.ts:100-111,161`**: `AnalyzeWeaponRequest/Response` y el endpoint `analyzeWeapon`.
3. **`test/el-prompt-del-motor-no-enumera-kinds.test.ts:110`** (de #792, de hoy): afirma que el derivador **ve** `weapon_orient` y `weapon_verify` en `AiToMcpMsg`. Tras la retirada se pone rojo por diseño; el test mismo dice (`:24-25`) que el siguiente kind retirado se añade a su `RETIRADOS`. Y ese fichero cae dentro de `campos-retirados-no-vuelven` (`nefan-core/test/**/*.ts`): si el patrón gana `weapon_orient`, el test que los nombra choca con el candado. Decidirlo es del arquitecto; que existe el choque, no.
4. **`test/contract-model-io.test.ts:103-148`** y **`test/contract-prompts.test.ts:53-54,65`**: tests cuyo sujeto muere → se borran con él (cobertura perdida: solo la de los propios zod de arma).
5. **Docs**: `docs/arquitectura/ia-servicios.md:32`, `docs/microservices/README.md:71,132,139`, `next.md:6,22`. `docs/auditoria-2026-08.md:157-167,313-315` es histórico (tachado/RESUELTO); el barrido debe decidir si queda o se anota, no ignorarlo.
6. **Lo que NO se va**: `api_client` de `llm_client.py:136-145` lo usan otros cuatro caminos (`:329,500,716,835,884,934`); solo sobra el comentario de `:135` que lo justifica por `analyze_weapon`.

## El día después

- Para quien juega: nada. Es deuda declarada (pre-producción, kinds sin productor): legítimo.
- Para el motor: el `narrative_listen`/`narrative_respond` que lee deja de anunciar dos kinds que nunca llegarán — menos contrato falso en su contexto.
- Puerta que cierra: una futura visión (IA mira una imagen) no tiene canal listo. Correcto: se reconstruye con su productor, no se conserva vacío.
- Mutación: `schemas.ts` y `narrative-llm.ts` están en `mutation-targets.json:86,114`; bajan mutantes porque su fuente cambia, así que `repartir` no lo confundirá con instrumento perdiendo medida (#596). Nada que pedir por adelantado.

## Conflictos

- **Tanda BZ («lo que ve el motor»)**: casi seguro toca las descripciones de `narrative_listen`/`narrative_respond` en `narrative-mcp/server.ts` (`:155-170`, `:444-450`) — las mismas líneas que CA tiene que tocar. Solapamiento real: coordinar orden o que una de las dos absorba esas líneas.
- **Tanda BX**: toca `start.sh`; el test de `#792` lee `start.sh` pero CA no lo modifica. Sin conflicto.
- **#792 recién mergeado**: ver punto 3 arriba (dependencia, no contradicción; el test ya prevé el caso).
- `arch-rules.json`: añadir al patrón de `campos-retirados-no-vuelven` (`:585`) es coherente con `stage_request`; ningún candado vivo protege estos kinds.
- Cola de issues: los otros tres abiertos (#361-#363) son plugins; sin relación.

## Coste contra valor

Coste: borrado mecánico en tres procesos + ajuste de un test de hoy + candado. Sin arte, sin créditos, sin saves. Valor: el motor y los agentes dejan de ver un contrato fantasma. No hacerlo nunca cuesta poco día a día, pero es el tipo de rastro que ya confundió a agentes (#792 lo cazó en el encargo). Vale.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

> **Alcance ampliado por la crítica:** la retirada incluye el canal de wire `vision_request`/`vision_response` completo (`narrative-mcp-ws.ts`, `protocol.ts`, `ws-bridge.ts`, `server.ts` `VISION_KINDS`, `llm_client.py:194`), porque esos dos kinds son sus únicos inquilinos; y `AnalyzeWeaponRequest/Response`/`analyzeWeapon` de `src/contracts/narrative-llm.ts`. El test `el-prompt-del-motor-no-enumera-kinds.test.ts` (#792) pasa los dos kinds a su `RETIRADOS`, resolviendo el choque con el candado `campos-retirados-no-vuelven`. El `api_client` de `llm_client.py` NO se retira (lo usan otros caminos). Coordinar con BZ las descripciones de `narrative_listen`/`narrative_respond` en `narrative-mcp/server.ts`.
