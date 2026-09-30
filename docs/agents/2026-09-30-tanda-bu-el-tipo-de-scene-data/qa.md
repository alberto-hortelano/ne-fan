# QA — Tanda BU (#782): el tipo de `scene_data`

Rama `feature/tanda-bu` en b2c3f4b3 (4 commits sobre f6401993). Base de comparación: worktree temporal `git worktree add --detach … f6401993` en el scratchpad, con los dos `dist` compilados desde cero. Criterios tomados de `requisitos.md` (la petición, el reencuadre y las decisiones del coordinador), no del plan.

Guion nuevo: `qa/guiones/340-una-escena-mala-se-rechaza-en-las-tres-puertas-con-su-motivo.mjs` (headless: `node qa/run.mjs --sin-navegador 340`). Corrido en el árbol de la rama: **1 en verde · 0 en rojo**, con 67 asertos y 4 agujeros medidos. Probado en negativo en un worktree temporal:
- sin `.finite()` en `cell` → rojo «cell_1e400: la rechaza pre / puerta / bridge»;
- Python vuelve a descartar la `shape` → rojo «shape_inventada: la rechaza python»;
- el gate devuelve `parsed.data` → rojo en el agujero A3.

## Criterios

| # | Criterio | | Evidencia |
|---|---|---|---|
| C1 | La entrada de `formatDToWorld` es `ExpandedScene`, y ese tipo lo dan los que PARSEAN, sin un `as` suelto | ✅ | Firma `formatDToWorld(escena: ExpandedScene)`; `SceneRecord.scene_data: ExpandedScene`. `grep "as ExpandedScene"` en `src`, `bridge` y `nefan-html/src` da 1, el de `gateEscenaExpandida` (`scene-schema.ts:401`). `recordSceneLoaded` y `loadSession` pasan por ese gate. El `as` de `style-apply.ts` es del wire y está declarado (backlog). Ver H2: el candado que justifica ese único `as` no cubre todas las reescrituras |
| C2 | Los 8 `throw` por entity y el bloque `isFormatD` se van, y las tolerancias de `h` y `shape` dejan de tolerar | ✅ | Diff de `scene-normalize.ts`: no quedan `VALID_*`, `isFormatD`, `textoOVacio` ni la red de expansión. `h` inválida y `shape` inventada se rechazan en la puerta (guion 340). CRAP re-medido por QA (`npm run coverage` + `crap-score.ts --top 2000` en el worktree temporal): `formatDToWorld` da **14,0 / cx 14 / 99 %** (antes 43) |
| C3 | `cell` y `h` son `.finite()` en el zod, con su espejo Python, y Python deja de descartar en silencio una `shape` | ✅ | Guion 340: `cell` 1e400, `h` 1e400 y `shape:"pyramid"` las rechazan el pre-flight, `escenaCargable`, `recordSceneLoaded` y `validate_scene_response`, todas con su motivo y ninguna con TypeError u OverflowError. `python3 -m unittest ai_server.tests.test_contract_fixtures ai_server.tests.test_scene_validate`: 49 OK. Queda un resquicio en Python: H4 |
| C4 | La población CRUDA (fixtures) no entra por dentro de `formatDToWorld`: sube a una puerta | ✅ | `escenaCargable` en `fixtures-del-selector.ts`, en los 5 `.mjs` de candados-headless, en el 290 y en `check-scene.ts`. `grep formatDToWorld` en `qa`, `labs` y `nefan-html` no da ningún llamante crudo sin la puerta. Guion 340, parte 3: camino del cliente ≡ camino del bridge en 3 fixtures y 5 tiles del falso |
| E1 | **Una escena del motor** pinta y colisiona IGUAL que en la base | ✅ | World scene de `formatDToWorld` comparada byte a byte entre base y rama: **89 de 89 iguales, 0 distintas**. Por el camino del bridge (expandir → gate) van las 3 fixtures y 5 tiles del motor falso (bootstrap, entrada en mundo existente, `makeTile` sin vecinos, con río y con lugar). También 24 escenas REALES del motor (4 snapshots de `alta_fantasia`, `labs/narrative/runs/tanda-bm-20260929`), con `tile_0_0` en cada uno. Script: `scratchpad/comparar.mts` (ver *Workarounds*) |
| E2 | **Un resume de save** pinta igual | ✅ | 4 saves reales (27 escenas) cargados con `NarrativeState.loadSession` en cada árbol: la world scene y el registro entero (`tile`, `edges`, `asset_refs`, `loaded_at`) salen idénticos byte a byte. En el juego, los guiones 17, 49, 60 y 166 dan verde |
| E3 | **El selector «Room»** carga las tres fixtures | ✅ | Preset `html-fixtures` con `NEFAN_PORT_OFFSET=600`: `fixtures-las-tres-se-caminan` ✔ (robledo: 24 objetos y 5 npcs, colisiona en casa_concejo; puerto: 16 y 4, colisiona en lonja; zorder: 14 npcs, anda). `las-fixtures-solo-chocan-con-el-agua` ✔, `fixtures-sin-bridge` ✔. Capturas `qa/capturas/las-tres-*.png` y `solo-agua-*.png` revisadas: pintan |
| E4 | **Un spawn de runtime** sigue igual | ✅ | El spawn no toca `scene_data`. `KIND_DEFAULT_HEIGHT` cambia de tipo, no de valores. Guiones 66 y 81 (spawn en vivo y tras reanudar, con nombre y rol) en verde |
| E5 | Una partida sin créditos arranca y pinta | ✅ | `node qa/run.mjs` con 01, 02, 17, 24, 25, 49, 58, 60, 66, 68, 80, 81, 166 y 290 (preset `e2e-sin-creditos`, bloque elegido por el runner): **14/14 verdes**. Capturas en `qa/capturas/2026-09-30T10-54-39-673Z-768747/`. `tsc` de nefan-html limpio |
| E6 | Escena mala → fail-loud con motivo en las tres puertas, y el motor recibiría el motivo | ✅ | Guion 340. El pre-flight es `validateContract(EmittedSceneSchema)`, lo mismo que `validateFormatDScene`, y `server.ts:435` lo devuelve al motor como `rechazo('forma_escena', "Invalid scene shape — fix it…: <motivo>")`. Probado también contra `narrative-mcp/dist/validators.js` con una fixture real: mismo texto. Matices en H5 |
| M | La mutación no deja vivo un mutante que hoy muere | ⚠️ | No probado: `scene-normalize` y `contrato-escena` no caben en local, y `escena-cargable` no tiene base. Lo mide la próxima corrida autorizada, con `comparar` antes de `repartir` |

## Hallazgos

**H1 — importante: `break: 0` sigue siendo expresable para un módulo sin medir, y ningún test lo caza.** Confirmado.
- El zod (`scripts/mutation-plan.ts:68`) es `z.union([z.number().min(0).max(100), z.literal(SIN_MEDIR)])`.
- El candado (`test/mutation-config.test.ts:390`) solo mira los módulos que YA dicen `sin medir`.
- La prosa de `SIN_MEDIR` (`mutation-plan.ts:36-49`) y el comentario del test («EL CANDADO QUE HACE INEXPRESABLE EL GATE PERMANENTEMENTE VERDE») afirman lo contrario.

Reproducción: en un worktree de b2c3f4b3, poner `escena-cargable` a `"break": 0` y lanzar `npm test` da **3909/3909 verdes**. Los 10 tests que leen el plan también dan 529/529. Esperado: rojo, porque un 0 sin medida en la huella es el gate permanentemente verde que `SIN_MEDIR` vino a prohibir. No lo causa esta rama (el ingeniero lo pisó y lo corrigió a mano), pero la rama se apoya en ello. Queda medido como agujero A1 del guion 340.

**H2 — importante (sin síntoma hoy): el candado de tipo del gate no ve las reescrituras que no cambian el tipo.** `gateEscenaExpandida` devuelve `raw as ExpandedScene`, y lo justifica «el schema NO transforma», sujeto por `Iguales<z.input, z.output>`. Lo he roto a mano en un worktree temporal:
- **muerden**: `.transform`, `.default`, `.catch` y `z.preprocess`;
- **NO muerden** (tsc verde): `z.coerce.number()`, `.trim()` y `.toLowerCase()`. Las tres reescriben el valor sin cambiar el tipo.

Consecuencia medida con `cell: z.tuple([z.coerce.number()…])`: una `cell` en texto `["40","40"]` pasa el gate, llega sin coaccionar a `formatDToWorld` (que ya no revalida nada) y `casa_concejo` sale en `[171.5, 0, 170.5]` en vez de `[-8.5, 0, -9.5]`. Es decir, fuera del tile y sin error. Hoy ningún schema de la escena usa esas reescrituras: `entity-vocabulary.ts:23` las prohíbe en prosa. El comentario del candado promete más de lo que comprueba.

**H3 — menor: el registro guarda la MISMA referencia del llamante (agujero A3).** Pasos:
1. `recordSceneLoaded(id, x)`;
2. mutar `x.entities[i].shape = "pyramid"`;
3. `formatDToWorld(scenes_loaded[id].scene_data)` pinta `shape: "pyramid"` en una escena tipada `ExpandedScene` que ya no pasa su gate.

Antes, la tolerancia la habría tapado. Hoy ningún llamante de producción muta después del registro: los dos `place_id =` de `tile.ts:193` y `bootstrap-tile.ts:87` van antes. Pero ni el tipo ni un `freeze` lo impiden. Es el precio de «devolver `raw`, no `parsed.data`».

**H4 — menor: Python revienta con `OverflowError` ante un entero de 401 cifras en `cell` o en `h` (agujero A2).** Es texto JSON válido. JS lo lee como `Infinity` y el zod lo rechaza con su motivo. `json.loads` lo lee como `int` exacto, y `math.isfinite`/`float()` lanzan «int too large to convert to float» sin nombrar la entity. Es el mismo síntoma que el `isfinite` vino a quitar, por otra grafía. En el camino MCP no llega (el pre-flight zod rechaza antes). En la vía de API directa acaba como `NarrativeUnavailable("generate_scene API call failed: int too large…")`, sin vuelta al modelo. El comentario «un int de Python siempre es finito» (`narrative_schemas.py`, en `h`) es cierto en Python pero no en el otro proceso.

**H5 — menor: el motivo que recibe el motor.** Para `cell` y `h` el texto es el mismo en zod y Python. Para `shape`, el pre-flight manda el genérico de zod en inglés («Invalid enum value. Expected 'box' | …, received 'pyramid'»), y Python manda «`shape` 'pyramid' no es una forma; las únicas son…» (agujero A4). Además, el pre-flight nombra la entity por índice (`entities[1].cell[0]`) y no por id. `recordSceneLoaded` y Python sí dicen `caja`. El plan pedía «un mensaje propio que nombre la entity»; se entiende, pero no es el id.

Informativo, ajeno a esta tanda: los 4 snapshots y los 4 saves reales de `tanda-bm-20260929` NO cargan ni en la base ni en la rama (`vegetation_zones.0.seed` en texto, anterior a BP). Mismo rechazo y mismo texto en los dos árboles.

## Workarounds usados

- **Seeds en texto convertidos a entero** en las COPIAS de los snapshots y saves reales, solo para poder comparar la conversión. Sin eso, base y rama los rechazan igual en el gate. Lo medí antes de convertir: `ExpandedSceneSchema` da el mismo veredicto y el mismo primer motivo en las 24 escenas de snapshot (21 rechazadas en los dos árboles y 3 aceptadas), y `loadSession` falla igual en los 4 saves. No afecta al jugador de esta tanda: es deuda de datos de BP, pre-producción y sin compatibilidad.
- La comparación byte a byte llama a `formatDToWorld`/`loadSession` directamente, no por el wire. El wire añade salidas y estados encima, igual en los dos árboles (`alWire` no cambia salvo el tipo). El flujo real lo cubren los guiones de navegador de E5.
- Cero workarounds en el navegador: ni overlays ocultados ni estado forzado. En `html-fixtures`, el panel de errores del bridge ausente tapa la esquina superior derecha: es el comportamiento documentado del visor, anterior a esta tanda.

## No probado

- **Delta de mutación** (`scene-normalize`, `contrato-escena`, `escena-cargable`): hace falta una corrida autorizada.
- **Motor real (Claude vía MCP)** recibiendo el rechazo: verificado el texto que devuelve el pre-flight, no una sesión `play`.
- **`tile_0_0` de `cuentos_oscuros`, `toledo_1200` y `colonia_aster`**: no hay snapshot de mundo en el repo ni en la máquina. Solo existen los de `alta_fantasia` (labs, tanda BM).
- `presupuesto-de-volumenes.mjs` (bench con navegador).

## Veredicto

**Apto con reservas.** Lo pedido está hecho y no cambia nada para quien juega:
- 89 de 89 world scenes idénticas byte a byte contra la base (fixtures, motor falso, motor real y resume de saves);
- el selector «Room» y la partida sin créditos pintan y colisionan;
- las tres puertas rechazan la escena mala con su motivo;
- `formatDToWorld` baja de CRAP 43 a 14.

Las reservas:
- H1: el `break: 0` que la prosa da por imposible sigue siendo expresable, y ningún test lo caza.
- H2: el candado de tipo que justifica el único `as` no ve `coerce`/`trim`, y `formatDToWorld` ya no tiene red detrás.
- La mutación está pendiente de la corrida autorizada.
