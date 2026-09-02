# Crítica — T4 «Lo que ya no emite nadie»

**Veredicto: REENCUADRADA** (en un solo punto: la purga del manifest borra procedencia que una decisión viva del usuario manda conservar; el resto de la tanda va tal cual). Verificado contra `b41b6e9`, ejecutando, no leyendo.

## El problema real, en una frase

Cuatro receptores siguen en pie sin emisor (un kind WS, un método HTTP, un campo de manifest, un campo de efecto) y el asset-store indexa 16.986 filas / ~897 MB que ningún proceso vuelve a producir ni a servir con sentido; cada uno cuesta lectura, tests y un `prune` que no puede tocarlos.

## La premisa, afirmación por afirmación

| Afirmación | Resultado |
|---|---|
| `bridge_status`: cero emisores | **Cierto.** Fuera de `archivo/`: `narrative-mcp-ws.ts:58-68,93-115`, `protocol.ts:15,19`, `ws-bridge.ts:3,205,216-217,266-275`, `llm_client.py:174`, `README.md:138`, `arch-rules.json:269`. `get_bridge_status` → 0 en todo el repo. Ningún test lo nombra |
| `AiClient.health()` sin llamadores | **Cierto.** `\.health(` → 0 en nefan-core/nefan-html/qa/labs/narrative-mcp/ai_server. `bridge/context.ts:60-63` (`NarrativeAiClient = Pick<…>`) ni lo incluye; `test/ai-client.test.ts:18` (`health: 100`) es un dato de fixture, no el método |
| Patrón de casts: 1 hit en src+bridge, 1 en services, 14 en test/ | **Exacto.** `src/narrative/ai-client.ts:62`, `services/asset-store/prune.ts:40`; test/ = 14 |
| `slice_size_hint`: dos ocurrencias | **Exacto.** `src/plugins/types.ts:191` (dentro de `.strict()`, :193) y `next.md:302` |
| `sprite_hash`: 4 hits en `nefan-html/src` | **Exacto.** `renderer/types.ts:73`, `main.ts:1901,1955,1978`. Ningún tool JSON ni `narrative_schemas.py` lo declara: el modelo no puede emitirlo |
| Filas por type | **Exacto, fila a fila** (`mode=ro`): texture 406, sprite 59, model 9, skin 6, scene 270, segment 16.231, scene_render 5, surface 179 → 16.986 muertas, 17.165 total. `pins` = 0. Overlap surface↔muerto = 0. `meta` = `imported_at`/`imported_source` |
| `manifest.json` sin `surface` | **Cierto**: 16.907 filas, 0 `surface` |
| `RECOVERY_SUBTYPES` sin `surface` | **Cierto** (`migrate-manifest.ts:31-38`) |
| `AssetKind` sin importadores | **Cierto**: 2 hits, ambos en `contracts/asset-store.ts:26,118` |
| Saves sin blob muerto ni snapshot | **Cierto**: grep → 0; los 8 `saves/*/state.json` llevan `asset_index_snapshot: []` |
| `scene_render` huérfano | **Cierto**: 0 hits en código; solo existe en la DB y en disco (2,7 MB) |
| Otros worktrees «con el mismo material muerto» | **FALSO.** Los tres `.claude/worktrees/*` tienen `cache/` vacío o solo `spend/`; `REPO_ROOT` se resuelve desde el fichero (`services/asset-store/config.ts:12`), así que su asset-store abre una DB nueva y vacía. Ningún otro checkout en `~/code`. El fail-loud inverso solo muerde en ESTE checkout (y en clones con historial). Ver «día después» |
| `ManifestDb` exige proceso único | Matiz: `busy_timeout 5000` (`manifest-db.ts:62`); lo que exige exclusividad es el `VACUUM` del script. La precondición sigue siendo correcta |

## Decisión: la familia `asset_index_snapshot` + `asset-index.ts` ENTRA

- Nadie emite: `setAssetIndexSnapshot` solo en `test/narrative-state.test.ts:303,329,350`; `loadSession` tiene UN llamador y va sin `opts` (`bridge/handlers/session.ts:539`), así que `assetValidator`/`validateAssetSnapshot` (`narrative-state.ts:36,92,540-550,1001`) es código muerto. `AssetIndex` («wrapper over cache/manifest.json», `asset-index.ts:1`) no tiene test ni consumidor fuera de `src/index.ts:42-43`, y su sujeto —`manifest.json`— se archiva en esta misma PR: dejarlo es exactamente el «módulo vivo sobre formato muerto» que CLAUDE.md prohíbe.
- Coste de mutación cero: `src/narrative` no está en `directorios_completos` ni en `modulos` (`mutation-targets.json:5-11`, #340 sigue abierto) → no se toca `mutation-targets.json`. Y le deja a #340 un fichero menos que censar.
- Sin bump de `SCHEMA_VERSION`: el save no tiene gate zod de forma (solo `schema_version` en `narrative-state.ts:490` y `ExpandedSceneSchema` por escena); una clave sobrante no rompe la carga. `AssetEntry` **se queda**: lo usa `LlmContext.available_assets` (`narrative/types.ts:267`) y `ManifestEntry extends AssetEntry` (`contracts/asset-store.ts:41`).
- Sitios que el plan no listó: `bridge/state-http/session-routes.ts:49` (lee `data.asset_index_snapshot` para la keep-list), `arch-rules.json:107` (`narrative/asset-index` en el `forbid` de imports del cliente), comentarios `contracts/world-state.ts:251` y `contracts/asset-store.ts:40`.

## El día después

- **Lo que se pierde sin querer — y es lo que reencuadra**: `DELETE WHERE type<>'surface'` borra la columna `prompt` de **79 filas que NO están en `manifest.json`** (registradas tras el import del 08-05: 26 `scene`/`plate` —repintados pagados— y 53 `segment`), las 79 con prompt no vacío. #293 es decisión del usuario («todos los elementos generados deberían tener la descripción con la que se generaron») y su cuerpo cita #257 literalmente: «conviene que el archivo lo conserve». El archivado de blobs no basta: la procedencia vive en la fila, no en el PNG. **La purga tiene que exportar las filas ajenas (con `prompt`, `created_at`, `extra`) a `archivo/cache/` antes del `DELETE`** — y el `manifest.json` archivado no lo cubre porque le faltan esas 79.
- Para quien juega: nada visible; `/cache/surface/` sigue igual. Deuda declarada: sí, y grande (16.986 filas inmunes al prune por `prune.ts:80-81`).
- Se vuelve más difícil: **añadir un kind al manifest**, a propósito. Choca con #376 (abajo).
- Lo que nadie borrará si no se dice: el docstring `ai_server/routers/asset_proxy.py:5` («Invalid map type»); el `by_type` de `llm_client.py:264-289` cuyo comentario ya pide su propia muerte; `types.ts:267` NO (vivo).
- Lo que parecerá arbitrario en un mes: un asset-store que se niega a arrancar por filas de una DB local. Aceptable solo si el mensaje llega a quien arranca — y hoy no llegaría: `start.sh:405-411` lanza el servicio a `nefan-asset-store.log` y espera 30 s a `/health` (`wait_for_http_health`, :287-299); el `exit 1` inmediato del `server.ts` se traduce en «❌ asset-store /health did not respond within 30s» sin la causa. El fail-loud inverso es correcto; lo que debe pedir el requisito es que **el nombre del script aparezca en la terminal de `start.sh`, no solo en el log** (detectar que el hijo murió antes de agotar el timeout es cosa del arquitecto; el criterio es observable).

## Conflictos

- **#293 (decisión del usuario)** — contradicción directa con la purga tal como está escrita. Se resuelve con el export previo. Bloquea el `--ejecutar`, no la tanda.
- **#376 (sheets vestidos y heroes fuera del manifest)** — su criterio de cierre es «entran en el manifest con su prompt, o el prune aprende a verlos». Si entra al manifest, necesita dos kinds nuevos: justo lo que `AssetKind = "surface"` + `surfaceDir: string` + `z.literal("surface")` está diseñado para encarecer. No es bloqueante, pero `requisitos.md` no debe vender «tres firmas» como virtud: el invariante que importa es «ningún kind sin productor», no «un solo kind». Dejar constancia en #376 de que T4 le pone ese peaje.
- **#340** — a favor: `src/narrative` sigue fuera de la totalidad, borrar `asset-index.ts` no fuerza corrida completa.
- **T7 (#368-F7/F9)** — sin solape real, confirmado (dos líneas de `types.ts`).
- **Candado** (patrón completo sobre los 15 globs, fuera de `arch-rules.json`/`architecture.test.ts`): todos los términos casan SOLO ficheros que la tanda borra o reescribe, con dos avisos: `Invalid map type` casa `ai_server/routers/asset_proxy.py:5` (docstring: reescribir en la misma PR, o el candado nace rojo); `scene\.png` casa `labs/style/runs/002_repaint_fidelity/masks/*.json`, pero ya está exceptuado (`exceptions[2]` de la regla). `scene_render` y `bbox\.png` dan **0 hoy**: entran como guardias de reaparición puras, hay que decirlo en el `why`. `spriteHash` casa `renderer/types.ts:73` además de `main.ts` (4 hits, no 3).

## Coste contra valor

Vale. Tres retiradas son mecánicas y sin cobertura perdida. La del asset-store paga por sí sola con el prune (hoy no puede tocar el 99 % de las filas) y con dejar de servir 400/200 por kinds sin productor. No hacer nada: la deuda no crece, pero #257, #343, #344 siguen en cola y `asset-index.ts` sigue leyendo un fichero que en un mes nadie sabrá qué es. El único coste real es el reloj de la corrida completa si alguien toca `mutation-targets.json`: no hace falta, dicho arriba.

## Criterios de aceptación — ¿pueden ponerse rojos hoy?

1 sí (decenas de hits hoy, medidos). 2 sí (términos ausentes del `pattern`; `files` de la regla de casts es solo `nefan-html/src/**`). 3 sí (8 types, 17.165 filas exactas). 4 sí (`readBlob` sirve `albedo` vía `TEXTURE_MAPS`, `blob-store.ts:37,55-58`; `AssetRegisterRequestSchema.type` es `z.string()`, `request-schemas.ts:165`). 5 sí. 6 es un «nada más se rompe», no un criterio de la tanda: vale como puerta, no como prueba; el «1904» no lo he re-medido. 7 sí. 8 sí. **Falta uno**: «la purga exporta las filas ajenas con su `prompt` a `archivo/cache/` y el fichero tiene 16.986 entradas antes del `DELETE`» — hoy es imposible porque el script no existe.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

- En **B.2 Purgar filas**, antes de «`--ejecutar` borra»: «`--ejecutar` **exporta primero** las filas ajenas completas (`hash,type,subtype,prompt,created_at,size_bytes,extra,last_used`) a `archivo/cache/manifest-retirado.json` y aborta si el fichero ya existe con otro contenido; solo después `DELETE`. Motivo: #293 (decisión del usuario) — 79 filas muertas, todas con prompt, no están en `manifest.json`.»
- En **B.5 Candado**: añadir `asset_index_snapshot|setAssetIndexSnapshot|AssetValidator|validateAssetSnapshot|AssetIndexFilter` (la familia entra); reescribir `ai_server/routers/asset_proxy.py:5`; anotar en el `why` que `scene_render` y `bbox\.png` nacen con 0 hits.
- En **Alcance A**, nuevo punto 5: «Familia `asset_index_snapshot` + `src/narrative/asset-index.ts`: borrar clase, export (`src/index.ts:42-43`), campo del save, `LoadSessionOptions.assetValidator`/`onWarning` si queda sin uso, `validateAssetSnapshot`, la lectura de `session-routes.ts:49`, la entrada de `arch-rules.json:107`, y los tests `narrative-state.test.ts:298-360` declarando la pérdida. `AssetEntry` se queda (`available_assets`). Sin bump de `SCHEMA_VERSION`.»
- En **Criterios**, sustituir la frase del 4 «`exit 1` y mensaje que cita `manifest-solo-surface.ts`» por: «`exit 1`, y `./start.sh --preset cliente-web` sobre una DB con una fila ajena imprime en la **terminal** el nombre del script sin esperar al timeout de 30 s; el log lo repite».
- En **Conflictos conocidos**, reescribir el primer bullet: «Los tres worktrees de `.claude/worktrees/` tienen `cache/` vacío: su asset-store abre una DB nueva y arranca. El fail-loud inverso solo muerde en este checkout y en clones con `cache/` histórico. No se toca el `cache/` ni el :8767 de nadie.» Y añadir: «**#376** propone meter sheets/heroes en el manifest: el candado de tipo de esta tanda le añade dos firmas que cambiar. Se anota en #376 al cerrar.»
