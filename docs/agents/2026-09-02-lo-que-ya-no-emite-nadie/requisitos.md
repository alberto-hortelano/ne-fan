# Requisitos — T4 «Lo que ya no emite nadie» (#343 + #344 + #368-F6 + #257)

Coordinador: sesión principal. Fecha: 2026-09-02. Base: `main` en `b41b6e9`.

Cuatro issues con el mismo defecto: algo que **ningún proceso emite ya** sigue en pie por el
lado que lo recibe. Tres son retiradas de código con `grep` a cero; la cuarta deja el
asset-store con un solo kind y archiva ~900 MB de blobs sin productor.

## La petición del usuario, literal

Instrucción de apertura (2026-09-02, tras cerrar la mutación de la corrida 33560823591):

> continue with T4

T4 es la tanda nombrada en el plan aprobado el 2026-09-01
(`~/.claude/plans/federated-spinning-flamingo.md`): «**Lo que ya no emite nadie** — retiradas
enteras, criterio `grep` a cero», issues #343 + #257 + #368-F6 (+#344).

Decisión de alcance, respondida por el usuario a la pregunta «¿Qué alcance tiene T4 respecto a
#257 (los kinds muertos del asset-store)?» entre tres opciones (sin #257 / solo los 4 kinds del
titular / todos los kinds muertos):

> T4 con #257, TODOS los kinds muertos

con la descripción que acompañaba a esa opción: «Purga 16.986 filas y archiva 894 MB. Deja el
manifest solo con `surface` (179 filas). La tanda más grande y con más superficie de riesgo,
pero no hay que volver.»

**Intención de fondo de toda la serie, vigente desde sesiones anteriores:**

> Vamos a seguir priorizando reducir el numero de issues

**Restricciones que el usuario ha fijado antes y siguen en vigor:**

- «no le cerreis sus servers»: hay otras instancias de Claude trabajando en paralelo en esta
  máquina. NUNCA matar procesos que no arrancó esta sesión; `pkill vite`/`node` prohibidos; parar
  por puerto lo que no se lanzó, prohibido. El asset-store :8767 es el caso concreto de esta
  tanda: si lo tiene otro agente, se espera o se pregunta.
- Cero créditos en toda verificación (fake-ai-server, preset `e2e-sin-creditos`).
- El material pagado va a `archivo/`, nunca `rm`, y con confirmación del usuario (regla fijada
  en `docs/agents/2026-08-24-sprites-servicio-aparte/requisitos.md:190-192` y `plan.md:75`). La
  confirmación de alcance de arriba cubre el archivado; el ingeniero la repite al ejecutar el
  `mv`, citando tamaños medidos.
- Pre-producción: cero compatibilidad hacia atrás. Lo retirado se borra entero el mismo día y
  en todos los procesos. Si al retirar algo aparece «¿y los saves viejos?», la respuesta hoy es
  que no importan (CLAUDE.md).

## Decisión del usuario TRAS leer la crítica (2026-09-02)

A la pregunta «¿Visto bueno a T4 con el reencuadre del crítico para pasar al arquitecto?»,
entre tres opciones (con el reencuadre / sin la familia `asset_index_snapshot` / parar a leer
la crítica), el usuario eligió:

> Adelante con el reencuadre (Recomendada)

con la descripción que acompañaba a esa opción: «Export de procedencia antes del DELETE (#293),
familia asset_index_snapshot + asset-index.ts dentro, y el fail-loud del asset-store visible en
la terminal de start.sh. Una sola PR: cierra #343, #344, #257; comenta #368 y #376.»

Los cambios que el crítico pidió están **ya aplicados** en este documento, marcados
«CORREGIDO por el crítico» o «decisión del crítico».

## Cómo se ha verificado lo que sigue

Los cuatro issues se re-verificaron contra `b41b6e9` con tres exploradores de solo lectura
(uno por issue) más un diseñador para el tramo del asset-store. Lo que yo ejecuté con mis
propias manos está marcado **[medido por mí]**; lo demás es **[medido por exploración]** y el
crítico debe re-verificar lo que use, porque aquí los issues caducan en horas
(`feedback_issues_caducan_en_horas`). Nada de abajo es cita del cuerpo de un issue sin
comprobar.

## El problema, por issue

### #343 — el protocolo WS `bridge_status` (:3737) quedó sin emisores

**[medido por exploración]** Cero emisores: `grep -rn '"bridge_status_request"'` fuera de
`archivo/` da dos hits y ambos son el lado que recibe (`narrative-mcp/ws-bridge.ts:216`,
comparación del receptor) o la declaración del tipo (`nefan-core/src/contracts/narrative-mcp-ws.ts:59`).
`get_bridge_status` (el único emisor) murió con #256 y `grep` en `ai_server/` da 0.

Lo que queda en pie, por proceso:

| Dónde | Qué |
|---|---|
| `nefan-core/src/contracts/narrative-mcp-ws.ts:58-61, 93-101` | tipos `BridgeStatusRequestMsg` / `BridgeStatusResponseMsg`, miembros de las uniones `AiToMcpMsg` (:68) y `McpToAiMsg` (:115); comentario de :62 («excluye hello y status») |
| `narrative-mcp/protocol.ts:15, 19` | reexports |
| `narrative-mcp/ws-bridge.ts:3, 216-219, 266-277` | import de tipo, receptor, `sendBridgeStatus` (emisor de la respuesta). El comentario de :205 cita `sendBridgeStatus` como ejemplo del catch acotado |
| `ai_server/llm_client.py:174-183` | el `elif` que consume la respuesta |
| `docs/microservices/README.md:138` | lista de kinds del WS |
| `nefan-core/data/contract/arch-rules.json:269` | prosa del `why` de `narrative-mcp-sin-catch-silencioso` que cita `sendBridgeStatus` |

Ningún test lo menciona (ni `ai_server/tests/`, ni `nefan-core/test/`): cobertura perdida cero.
**Aviso de orden**: `narrative-mcp/contract-check.ts` compara las uniones de `protocol.ts` y
`narrative-mcp-ws.ts` por igualdad estructural; borrar en un fichero y no en el otro tumba
`tsc -b`. Es el candado funcionando: se borra en los dos a la vez.

### #344 — `ai-client.ts:62` castea `/health` a un tipo inline

El issue pide «importar `NarrativeHealthResponse`». **[medido por exploración]** La cita `:62`
es exacta a HEAD, pero **`AiClient.health()` no tiene ningún llamador**: `grep -rn "\.health("`
sobre `nefan-core/src`, `bridge`, `test`, `labs`, `narrative-mcp` → 0 fuera de la definición.
Quien consulta `/health` es `qa/lib/sesion.mjs:55-63`, con `fetch` directo y leyendo
`body?.fake === true`. Los dos servidores SÍ están tipados contra el contrato
(`ai_server/main.py:123-140` cita `NarrativeHealthResponse` por nombre;
`labs/narrative/fake-ai-server.ts:296-299` usa `satisfies`); solo el cliente se lo inventaba, y
además su tipo de retorno inline (:58) descartaba `fake`, el campo que sostiene el guardarraíl de
cero créditos.

**Reencuadre propuesto**: arreglar el cast sería mantener código muerto. Se borra `health()`
entero. Y se hace lo que el propio `why` de la regla
`las-respuestas-de-red-no-se-redefinen-en-linea` (`arch-rules.json:601-612`) deja escrito:
«`ai-client.ts:62` … queda para su issue; al arreglarlo, ampliar `files`». **[medido por
exploración]** aplicando el patrón literal de la regla (`\.json\(\)\s*\)?\s*as\s*\{`) sobre
`nefan-core/src/**` y `nefan-core/bridge/**` sin `test/`: **1 hit, el que se borra, 0 falsos
positivos**. Sobre `nefan-core/services/**`: **1 hit más con el mismo defecto**,
`services/asset-store/prune.ts:40` castea `{ refs?: unknown }` cuando `AssetRefsResponse { refs: string[] }`
existe en `src/contracts/world-state.ts:253-255` sin que nadie lo importe ahí. `test/` tiene 14
hits legítimos, 3 de ellos el fixture negativo con que la regla se prueba a sí misma: `test/`
queda FUERA del ámbito.

### #368-F6 — `slice_size_hint` es un campo muerto

**[medido por exploración]** Dos ocurrencias en todo el repo: `nefan-core/src/plugins/types.ts:190-191`
(comentario «§7.9 — el bridge avisa cuando el slice rebasa 10× este hint» + campo zod
`.optional()` dentro de un schema `.strict()`) y `next.md:302`, que ya se autodenuncia («ningún
código lo aplica»). El issue dice «el schema se lo enseña al LLM como si funcionara»: **es
falso** — la tool `plugin_register` (`narrative-mcp/server.ts:816-865`) recibe el manifest como
`manifest_json: z.string()` opaco y su descripción enumera los campos sin nombrar este. No está
en ningún tool JSON de `data/contract/tools/`, ningún prompt, ningún manifest de
`data/plugins/` ni `data/games/*/plugins/`, ningún test, ningún espejo Python.
`contract-model-io.test.ts` no cubre plugins (sus `CONTRACTS` son tres: narrative_event,
weapon_orient, weapon_verify). El aviso «10×» no existe en `bridge/` ni en `src/plugins/`.
Borrado limpio; nada que regenerar. F7 y F9 del mismo issue siguen en T7.

### Bonus de la misma familia — `sprite_hash`

**[medido por exploración]** El cliente **lee** `effect.data.sprite_hash` y nadie lo emite: 4
hits, todos en `nefan-html/src` (`renderer/types.ts:72-73`, `main.ts:1901, 1955, 1978`), ningún
renderer lo consume, y su doc dice «served from `/cache/sprite/{hash}`» — kind muerto de #257.
Entra porque es literalmente el título de la tanda.

### #257 — el asset-store guarda kinds que ya no produce nadie

El issue dice 480 filas (texture 406, sprite 59, model 9, skin 6). Es cierto y es la parte
pequeña. **[medido por exploración]** sobre `cache/manifest.sqlite3` leído en `mode=ro`
(tabla `assets(hash,type,subtype,prompt,created_at,size_bytes,extra,last_used)` + `meta` + `pins`),
y **[medido por mí]** `du --si -s cache/*`:

| type (subtypes) | filas | disco | estado |
|---|---|---|---|
| texture (albedo 203 / normal 203) | 406 | 194 MB | muerto desde #199 |
| sprite (billboard / sprite_2d / sprite / backdrop) | 59 | 18 MB | muerto |
| model (GLB) | 9 | 84 MB | muerto — **Meshy pagado** |
| skin | 6 | 28 MB | muerto |
| scene (scene 114 / plate 156) | 270 | 445 MB | muerto (repintado oblicuo) |
| segment (segment 8561 / bbox 7611 / analysis 55 / discovery 4) | 16.231 | 126 MB | muerto (SAM2) |
| scene_render (render) | 5 | 2,7 MB | muerto **y huérfano**: no está en `dirsByType`, ni se sirve ni se poda |
| **surface** | **179** | 120 MB | **VIVO** — único productor `ai_server/remote_gen_main.py:62-66` |

Total muerto: **16.986 filas, ~897 MB**. `sprite_sheet`/`sprite_hero` (`cache/sprite_sheets`,
93 MB) viven en un almacén paralelo fuera del manifest y **no se tocan**.

Hechos que cambian el diseño respecto a lo que dice el issue:

- `cache/manifest.json` (5,9 MB **[medido por mí]**) tiene 16.907 filas y **cero `surface`**
  (las superficies nacen el 2026-08-14; el import a SQLite fue el 08-05) **[exploración]**.
  CLAUDE.md:270 lo llama «congelado como rollback»; no es rollback de nada vivo.
- El recovery scan de `services/asset-store/migrate-manifest.ts:31-38` (`RECOVERY_SUBTYPES`)
  **no incluye `surface`** **[medido por mí, leído]**: solo sabe repoblar kinds muertos desde
  disco. Si sobrevive, un `cache/` mal apuntado a `archivo/` resucita lo retirado.
- `AssetKind` (`src/contracts/asset-store.ts:26-37`) **no lo importa nadie** (2 hits, ambos en
  su fichero) y mezcla subtypes (`albedo`/`normal`/`roughness`) con types **[exploración]**.
- `prune.ts:80-82` **[medido por mí, leído]**: `if (root === undefined) continue; // type sin
  dir conocido — no tocar`. Quitar un kind de `dirsByType` lo hace **inmune al prune para
  siempre**; no basta con quitar el mapeo, hay que purgar filas.
- `http-server.ts:196-203` **[medido por mí, leído]**: cascada de `cache_url` por
  `m.type === "texture" | "model" | "skin" | "sprite" | "surface"`.
- Ningún hash muerto coincide con uno de `surface` (overlap 0); `pins` tiene 0 filas
  **[exploración]**. **[medido por mí]** `grep -rl '/cache/(texture|model|skin|sprite|scene|segment)/' saves/` → **0**:
  ningún save referencia un blob muerto.
- **[medido por mí]** `archivo/cache/sprite_sheets/` existe: el destino espejado tiene
  precedente (#253) y `archivo/` está en `.gitignore`.
- No hay `sqlite3` CLI en la máquina; Node 24 trae `node:sqlite` **[exploración]**: la purga
  es un script TS.
- Ninguna prueba del preset `e2e-sin-creditos` toca esto: `qa/lib/stack.mjs:87` no levanta el
  asset-store y el fake solo sirve `/cache/surface/`, `/cache/sprite_sheet/fake/`,
  `/cache/sprite_hero/` **[exploración]**. La batería solo ve la tanda por el guion 21.

**Candidata de la misma familia, decisión del crítico**: `asset_index_snapshot` es un campo
del save que **nadie emite** — `setAssetIndexSnapshot` solo lo llaman los tests
(`test/narrative-state.test.ts:303, 329, 350`); el bridge llama `loadSession(id)` sin opciones
(`bridge/handlers/session.ts:539`), así que `assetValidator`/`validateAssetSnapshot`
(`src/session/narrative-state.ts:36-37, 87-97, 540-550, 1001-1040`) son código muerto y los 8
saves tienen `[]`. Y `src/narrative/asset-index.ts` («wrapper over cache/manifest.json»,
exportado en `src/index.ts:42-43`) no tiene consumidor **[exploración]**. Encajan en el título
y morirían con `manifest.json`, pero no son lo que pide #257: **el crítico decide si entran**.
Si entran, sin bump de `SCHEMA_VERSION`: el lector nunca lee la clave.

## Alcance

### A. Tres retiradas de código (sin decisión abierta)

1. **#343**: borrar las cuatro piezas a la vez (tipos + uniones, reexports, receptor +
   `sendBridgeStatus`, `elif` de Python); reescribir el comentario `ws-bridge.ts:205`
   (cambiar el ejemplo, no borrar la justificación del catch); quitar `bridge_status` de
   `docs/microservices/README.md:138`; revisar la prosa de `arch-rules.json:269`.
2. **#344**: borrar `AiClient.health()`; ampliar `files` de
   `las-respuestas-de-red-no-se-redefinen-en-linea` a `nefan-core/src/**/*.ts`,
   `nefan-core/bridge/**/*.ts`, `nefan-core/services/**/*.ts` (no `test/`); `prune.ts:40`
   importa `AssetRefsResponse`; recortar del `why` el párrafo que aparcaba `:62`.
3. **#368-F6**: borrar campo y comentario de `types.ts:190-191`; reescribir `next.md:302`.
4. **`sprite_hash`**: borrar los 4 sitios de `nefan-html/src`.
5. **Familia `asset_index_snapshot` + `src/narrative/asset-index.ts` — ENTRA (decisión del
   crítico, verificada)**: borrar la clase `AssetIndex` y su export (`src/index.ts:42-43`), el
   campo del save, `LoadSessionOptions.assetValidator`/`onWarning` si quedan sin uso,
   `validateAssetSnapshot`, la lectura de `bridge/state-http/session-routes.ts:49`, la entrada
   `narrative/asset-index` del `forbid` de `arch-rules.json:107`, los comentarios de
   `contracts/world-state.ts:251` y `contracts/asset-store.ts:40`, y los tests
   `narrative-state.test.ts:298-360` declarando la pérdida (un comportamiento que ningún save
   podía ejercer: los 8 llevan `[]`). `AssetEntry` **se queda** (`LlmContext.available_assets`,
   `ManifestEntry extends AssetEntry`). Sin bump de `SCHEMA_VERSION`: el save no tiene gate zod
   de forma. Coste de mutación cero: `src/narrative` está fuera de la totalidad (#340), así que
   **no se toca `mutation-targets.json`**.

### B. El asset-store se queda con `surface` (#257, alcance completo)

Orden **archivar → purgar → recortar → candar**: el material pagado queda a salvo aunque la
PR se abandone a medias, y un asset-store viejo sobre el DB purgado sigue funcionando.

0. **Precondición**: :8767 parado **y de este worktree** (`./start.sh s`). `ManifestDb` exige
   ser el único proceso sobre el `.sqlite3`.
1. **Archivar** con `mv` (confirmación del usuario repetida en el momento, con tamaños):
   `cache/{textures,models,skins,sprites,scenes,segments,scene_render}` y `cache/manifest.json`
   → `archivo/cache/` (espejo de rutas: un `mv` de vuelta restaura; precedente
   `docs/agents/2026-08-22-retirar-godot/qa.md:22`, que comparó hash a hash).
2. **Purgar filas** con un script one-shot nuevo `nefan-core/scripts/manifest-solo-surface.ts`:
   dry-run por defecto que imprime `(type, subtype, filas, bytes)` de lo ajeno; **guardia de
   orden** (aborta si `cache/` tiene un directorio fuera de lo vivo o existe `manifest.json`:
   «archívalo primero»); `--ejecutar` **exporta primero** las filas ajenas completas
   (`hash,type,subtype,prompt,created_at,size_bytes,extra,last_used`) a
   `archivo/cache/manifest-retirado.json` y aborta si el fichero ya existe con otro contenido;
   **solo después** borra `WHERE type<>'surface' OR subtype<>'surface'`, limpia `pins`
   huérfanos y las `meta` `imported_*`, `VACUUM`. Segunda pasada = «0 filas ajenas».
   `ManifestDb` gana `kindsAjenos()`/`borrarKindsAjenos()`, con test.
   **Motivo del export (CORREGIDO por el crítico, que lo midió)**: #293 es decisión del usuario
   («todos los elementos generados deberían tener la descripción con la que se generaron») y su
   cuerpo cita #257 pidiendo que el archivo conserve el `prompt`. El archivado de blobs no
   basta: la procedencia vive en la fila, no en el PNG. Y `manifest.json` archivado no la cubre:
   **79 filas muertas (26 `scene`/`plate` pagadas + 53 `segment`), todas con prompt, se
   registraron después del import del 08-05 y no están en él**. Sin el export, el `DELETE` las
   pierde para siempre.
3. **Recortar código** (símbolos en el plan; el arquitecto los fija): `config.ts` del
   asset-store (`manifestJsonPath`, `dirsByType` → `surfaceDir: string`); `blob-store.ts`
   (`KIND_TABLE`, `TEXTURE_MAPS`; kind ≠ surface → 400); `http-server.ts` (cascada de
   `cache_url`); `prune.ts` (firma, fuera :80-81); **`migrate-manifest.ts` entero**;
   `server.ts` → **fail-loud inverso**: si `kindsAjenos()` no está vacío, `exit(1)` citando el
   script. `src/contracts/asset-store.ts`: `AssetKind = "surface"` y **usado** en
   `AssetRegisterRequest.type/subtype` + `z.literal("surface")` en `request-schemas.ts:164-171`;
   fuera `CacheCheckResponse`/`checkHash` (ruta `/cache/check` que siempre dio 400).
   `src/config.ts:68-86, 199-204`: los seis `*_cache_dir` muertos; regenerar
   `data/runtime_config.json`. `ai_server/asset_cache.py`: defaults de texture, rama `.glb`,
   `has_all`/`get`/`subtype_override`/`list_cached`; `llm_client.py:244-289`: fuera el
   round-robin `by_type` que su propio comentario pide borrar. Docs: CLAUDE.md:270,
   `docs/arquitectura/mapa.md:37-39`, `ia-servicios.md:35-36`.
4. **Tests**: los de comportamiento vivo con fixture muerta se **reescriben a `surface`**
   (`test/asset-store.test.ts`, `style-application.test.ts:98,110`,
   `ai_server/tests/test_asset_cache.py`); los cuyo sujeto muere se **borran declarando la
   pérdida** (`asset-store.test.ts:124-129, 138-149, 300-346`; `test_asset_cache.py:106-111`).
   Nuevo: `kindsAjenos`/`borrarKindsAjenos` idempotentes; el arranque lanza con una fila ajena
   y no lanza sin ella.
5. **Candado**: el de tipo (`surfaceDir: string` en dos firmas + `AssetKind` usado + zod
   literal: volver a un mapa por kind exige cambiar tres firmas, no añadir una línea) y el de
   texto en `campos-retirados-no-vuelven` con términos **compuestos e inequívocos** — `texture|model|skin|sprite|scene|segment|plate`
   a secas NO pueden entrar (colisionan con `sprite_sheet`, `llm_model`, `entity.sprite`,
   medio repo; `billboard` y `roughness` son vocabulario vivo de three.js). Lista propuesta en
   el plan, más `asset_index_snapshot|setAssetIndexSnapshot|AssetValidator|validateAssetSnapshot|AssetIndexFilter`
   (la familia entra); **antes de tocar el JSON, grep a cero con el patrón completo** sobre los
   15 globs de la regla, y cada término lleva su caso negativo en `test/architecture.test.ts`.
   Avisos medidos por el crítico: `Invalid map type` casa el docstring de
   `ai_server/routers/asset_proxy.py:5` (reescribir en la misma PR o el candado nace rojo);
   `scene\.png` casa `labs/style/runs/**` pero ya está en `exceptions`; `scene_render` y
   `bbox\.png` dan **0 hoy** — entran como guardias de reaparición puras y el `why` lo dice.
   **El invariante que importa es «ningún kind sin productor», no «un solo kind»**: el candado
   de tipo no se vende como virtud en sí, y #376 (meter sheets/heroes en el manifest) recibe
   una nota de que esta tanda le pone el peaje de dos firmas más.

## Criterios de aceptación

Cada uno se puede poner rojo hoy sobre `main`; el que no, no es criterio
(`feedback_verde_que_no_comprueba`).

1. **Grep a cero.** Sobre los 15 globs de `campos-retirados-no-vuelven` (fuera de `archivo/`,
   `arch-rules.json`, `test/architecture.test.ts` y `docs/agents/`), el patrón completo de los
   términos retirados por esta tanda da **0**. Hoy da decenas.
2. **El candado existe y muerde.** Cada término está en el `pattern` de
   `campos-retirados-no-vuelven`, y `test/architecture.test.ts` tiene un caso negativo por
   familia (al menos: `bridge_status_request` en un `.ts` de narrative-mcp, `slice_size_hint` en
   `types.ts`, `sprite_hash` en un `.mjs` de `qa/`, `texture_cache_dir` en
   `runtime_config.json`, `cache/textures` en un `.py`) que hoy no existe.
   `las-respuestas-de-red-no-se-redefinen-en-linea` cubre `nefan-core/src`, `bridge` y
   `services` y está verde; **probado en negativo** reintroduciendo el cast de `prune.ts:40`.
3. **El manifest solo tiene `surface`.** `SELECT type, subtype, COUNT(*)` sobre
   `cache/manifest.sqlite3` → una fila, `surface surface 179`. `ls cache/` = solo lo vivo.
   `du --si -s archivo/cache/*` contiene los 7 directorios + `manifest.json` con tamaños que
   cuadran con la tabla de arriba (±1 %). Hoy hay 8 types y 17.165 filas.
4. **El asset-store dice qué hacer, no calla.** Arrancado sobre un DB con una fila ajena:
   `exit 1`, y `./start.sh --preset cliente-web` imprime en la **terminal** el nombre del
   script **sin esperar al timeout de 30 s** (hoy `start.sh:405-411` manda el servicio al log y
   `wait_for_http_health` solo diría «did not respond within 30s» sin la causa — CORREGIDO por
   el crítico; cómo detectar que el hijo murió antes del timeout lo decide el arquitecto); el
   log lo repite. Sobre el DB purgado:
   `GET /health` → `total_count: 179`; `GET /cache/surface/<hash vivo>` → 200 `image/png`;
   `GET /cache/albedo/<hash>` → **400**; `POST /assets` con `type: "texture"` → **400** (zod);
   `GET /assets?asset_type=texture` → `assets: []`. Hoy `/cache/albedo/<hash de textura>`
   devuelve 200 y el `POST` registra.
5. **Lo muerto ya no compila.** `AiClient.health()` no existe; `BridgeStatusRequestMsg` no
   existe en ninguno de los dos ficheros y `npm --prefix narrative-mcp run build` (que compila
   `contract-check.ts`) está verde; `PluginManifestSchema` rechaza `slice_size_hint` (es
   `.strict()`); `AssetRegisterRequest.type` es `"surface"` y un `type: "texture"` no
   compila.
6. **Nada más se rompe.** `npm run verify` verde (1904 tests hoy: el número baja por los
   borrados declarados y sube por los nuevos; el informe dice cuánto y por qué);
   `python3 -m unittest discover -s ai_server/tests` verde; `ruff check ai_server` verde;
   `npm run coverage && npm run crap -- --check` dentro de umbrales (borrar solo baja CRAP;
   si el suelo de cobertura del 89 % se acerca, se dice); `npm run deuda` no crece salvo por
   lo que la tanda declare; `node qa/run.mjs` completo en verde con el guion **21** ampliado
   (`RETIRADOS` incorpora `\/cache\/(albedo|normal|roughness|model|skin|sprite|scene|plate|segment)\/`;
   `HOJA_VESTIDA` pierde `\/cache\/skin`) y **probado en negativo**.
7. **El juego real con el asset-store de verdad.** Preset `cliente-web` (no gasta si no se
   activa Imagen IA): aplicar un estilo con superficies ya pintadas carga las celdas desde
   `/cache/surface/…` (Network); las `curl` del criterio 4 sobre :8767. Va en `qa.md` con la
   salida pegada, porque la batería no levanta este servicio.
8. **Cierre**: una PR con `Closes #343`, `Closes #344`, `Closes #257` (en inglés),
   comentario en #368 por F6 y **nota en #376** (el peaje del candado de tipo); nota de
   honestidad (el CI no corre `qa/` ni levanta el asset-store). El PDF ajeno u otro material
   fuera de git NO entra en la PR: el diff solo lleva código, tests, contrato, docs y
   `runtime_config.json`.
9. **La procedencia sobrevive a la purga** (añadido por el crítico): `archivo/cache/manifest-retirado.json`
   existe, tiene **16.986** entradas con `prompt`, y las 79 que no están en `manifest.json`
   están en él. Hoy es imposible: el script no existe.

## Conflictos conocidos — verificados hoy

- **Otros worktrees y agentes de la máquina** (CORREGIDO por el crítico: yo escribí que
  tenían «el mismo material muerto» y es **falso**): los tres `.claude/worktrees/*` tienen
  `cache/` vacío o solo `spend/`, y `REPO_ROOT` se resuelve desde el fichero
  (`services/asset-store/config.ts:12`), así que su asset-store abre una DB nueva y arranca. El
  fail-loud inverso solo muerde en **este** checkout y en clones con `cache/` histórico. Lo que
  NO se hace es tocar el `cache/` ni el :8767 de nadie más.
- **#293 (decisión del usuario)**: contradicción directa con la purga tal como estaba escrita.
  Resuelta con el export previo (B.2). Bloquea el `--ejecutar`, no la tanda.
- **#376** (sheets vestidos y heroes fuera del manifest): su cierre pide «entran en el manifest
  con su prompt, o el prune aprende a verlos». Si entran, necesitan dos kinds nuevos, justo lo
  que el candado de tipo encarece. No bloquea; se anota en #376 al cerrar.
- **T7 (#368-F7/F9)** toca `src/plugins/` y `bridge/handlers/simulation.ts`; esta tanda solo
  quita dos líneas de `plugins/types.ts`. Sin solape real.
- **sprite-forge**: `cache/sprite_sheets` y el almacén paralelo no se tocan; `sprite_hash`
  (cliente) no es `sprite_sheet`/`sprite_hero` (vivos). El candado debe distinguirlos:
  `cache/sprites` con `\b` no casa `cache/sprite_sheets`.
- **Mutación**: `src/contracts/asset-store.ts` sigue exento en `mutation-targets.json:82`
  («solo declara tipos», sigue siendo cierto). `narrative-mcp-ws.ts` ídem (:78). Tocar
  `mutation-targets.json` fuerza corrida COMPLETA: esta tanda **no debería tocarlo**.

## Fuera de alcance

- `sprite_sheet`/`sprite_hero` y `cache/sprite_sheets` (vivos, sprite-forge).
- #368-F7 (dos resolvers homónimos) y F9 (`activePlugins` sin purga): T7.
- Implementar el aviso «10× el hint» de plugins: pre-producción retira, no implementa lo que
  nadie pidió.
- Un fetch tipado por endpoint (la «garantía total» que el `why` de la regla nombra): otra
  tanda.
- Cualquier `rm` de blobs. Solo `mv` a `archivo/`.
- `dev_api_cache` y `spend` (`cache/`): no son del asset-store.
