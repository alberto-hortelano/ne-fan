# QA — T4 «Lo que ya no emite nadie» (#343 + #344 + #368-F6 + #257 + `sprite_hash` + familia `asset_index_snapshot`)

QA, 2026-09-02. Rama `t4/lo-que-ya-no-emite-nadie` (`b34e189`, `4141594`, `3cad2b7` sobre `main` `b41b6e9`),
árbol limpio salvo `docs/agents/` y el guion nuevo. Validado contra los **9 criterios de `requisitos.md`**,
re-midiendo cada cifra que uso del informe del ingeniero. Cero créditos: el ledger `cache/spend/events.jsonl`
tenía 1568 líneas antes de arrancar el stack real y 1568 al pararlo; remote-gen no imprimió ni un
«celdas nuevas». Nada mío tocó `cache/` ni `archivo/` (la DB real se leyó siempre en `mode=ro`; todas las
pruebas destructivas fueron sobre copias en el scratchpad). Solo arranqué con `./start.sh --preset …` y
paré con `./start.sh --parar`; los puertos del catálogo estaban libres antes y quedaron libres después.

**Veredicto: APTO CON RESERVAS.** Los 8 criterios que puedo medir cumplen con evidencia; el 8 (PR) es del
coordinador. Las reservas son dos hallazgos importantes que la tanda no causó pero que quedan a la vista
justo por lo que la tanda hizo (H1, H2) y un test vivo sobre un formato muerto (H3) que conviene cerrar en
la misma PR.

## Criterios

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Grep a cero del patrón completo de `campos-retirados-no-vuelven` sobre sus globs | ✅ cumple | Patrón leído del JSON y aplicado con Python sobre los **14** globs de `files` (no 15: `requisitos.md` cuenta mal), 689 ficheros, fuera `scan.ignore` y `exceptions`: **0 hits de términos de T4**. Los 15 hits que salieron eran `structures`/`room_id`/`room_description` (tandas anteriores) en `data/games/*/world/tile.json`, que la regla exime (`nefan-core/data/games/*/world/**/*.json`); mi filtro no resolvió ese glob, la regla sí (test verde) |
| 2 | El candado existe y muerde | ✅ cumple | `node --import tsx --test test/architecture.test.ts` → 64/64. **En negativo, siete términos uno a uno** (añadidos al árbol, restaurados con `git checkout`): `bridge_status_request` en `narrative-mcp/ws-bridge.ts` → `✖ …ws-bridge.ts:433 — patrón prohibido: "bridge_status_request"`; `texture_cache_dir` en `data/runtime_config.json:26`; `sprite_hash` en `qa/lib/sesion.mjs:503`; `slice_size_hint` en `src/plugins/types.ts:252`; `asset_index_snapshot` en `bridge/handlers/session.ts:800`; `cache/textures` en `ai_server/asset_cache.py:118` — los seis `pass 63 fail 1` nombrando fichero y línea. Cast inline en `prune.ts:41` (`as { refs?: unknown }`) → `✖ las-respuestas-de-red-no-se-redefinen-en-linea … prune.ts:41`. Lo vivo calla: `cache/sprite_sheets` en un `.py` → 64/64 |
| 3 | El manifest solo tiene `surface`; `cache/` solo lo vivo; `archivo/cache/*` cuadra | ✅ cumple | `python3` `mode=ro`: `assets: [('surface','surface',179)]`, `pins 0`, `meta []`, `integrity_check ok`. `ls cache/` = `dev_api_cache manifest.sqlite3(+shm,wal) spend sprite_sheets surfaces`. `du --si -s archivo/cache/*`: `manifest.json 5,9M · models 84M · scene_render 2,7M · scenes 445M · segments 126M · skins 28M · sprites 18M · textures 194M` — idéntico (±0 %) a la tabla de requisitos; además `manifest-retirado.json 5,7M` y `sprite_sheets 580M` (#253, previo) |
| 4 | El asset-store dice qué hacer, no calla | ✅ cumple | **Negativo sobre una COPIA** (export limpio del árbol en el scratchpad, `cache/manifest.sqlite3` copiado + 1 fila `texture/albedo` plantada): `./start.sh --preset cliente-web` → `11:45:33.947 ▶ Preset 2` … `11:45:34.973 ❌ asset-store murió antes de responder (exit 1)` + las 12 últimas líneas del log con `npx tsx scripts/manifest-solo-surface.ts` (dry-run y `--ejecutar`): **1,03 s**, timeout era 30 s; el log lo repite (2 ocurrencias). **Las cinco `curl` sobre el :8767 real**: `GET /health` → `{"ok":true,"total_count":179,"total_bytes":36898124}` 200 · `GET /cache/surface/012e3d7fb995cd57` → 200 `image/png` 258295 bytes (`file`: PNG 452×297) · `GET /cache/albedo/<hash>` → `Invalid kind` 400 (ídem `normal model skin sprite scene plate segment check`) · `POST /assets {type:"texture",subtype:"albedo"}` → 400 `type: Invalid literal value, expected "surface"` y `by_hash` del hash → 404 (sin fila) · `GET /assets?asset_type=texture` → `{"assets":[],"total":179}` 200. `/health` tras el POST: 179 |
| 5 | Lo muerto ya no compila | ✅ cumple | `npm run verify` verde (build + typecheck + lint + 1907 tests); `npm --prefix narrative-mcp run build` (`tsc -b`, compila `contract-check.ts`) exit 0; `grep` de `BridgeStatusRequestMsg`/`health(`/`slice_size_hint` en los roots → 0 (criterio 1); `PluginManifestSchema` es `.strict()` (leído en `src/plugins/types.ts`) |
| 6 | Nada más se rompe | ✅ cumple | `npm run verify`: **1907 pass / 0 fail** (1904 en main: +10 nuevos −7 borrados declarados). `python3 -m unittest discover -s ai_server/tests`: **Ran 142 tests … OK**. `ruff check ai_server`: All checks passed. `npm run coverage && npm run crap -- --check`: `cobertura 89.3 %` (suelo 89 %), `CRAP ≤ 73 — 0 por encima`, `✔ dentro de los umbrales`. `npm run deuda`: 15 fronteras + 11 CRAP + 49 supervivientes = **75**, igual que main (el aviso «posiblemente obsoleta en 32 módulos» ya estaba). `node qa/run.mjs` completo (bloque de puertos propio, en paralelo con mi stack real): **57 en verde · 0 en rojo de 57**, exit 0; el guion 21 verde con `RETIRADOS` ampliado (el negativo del 21 lo hizo el ingeniero; yo probé el mío, abajo) |
| 7 | El juego real con el asset-store de verdad carga las celdas desde `/cache/surface/…` | ✅ cumple | `./start.sh --preset cliente-web` (asset-store, sprite-forge sin repintado, remote-gen, bridge, cliente). Título → Nueva partida → Miravanda + Acuarela luminosa; **Maqueta 3D y Base y_bot** (los defectos eran Imagen IA y Skins IA). «Aplicar estilo (ver coste)» solo resuelve: «Librería de superficies (23 celdas, **7 por pintar**) ~$0.15» → **Cancelar**, no se pintó nada. Comenzar → mundo pintado (tejas, tablones, empedrado), HUD: «Atlas fps de tile_0_0: **16 superficies de la librería**; faltan 7 por pintar». **Evidencia de servidor**: 16 filas `surface` con `last_used` estampado a `2026-09-02T09:49:30Z` (el `touch` de `/cache/surface/{hash}` al servir), las 16 del HUD. **Evidencia de navegador** (PerformanceObserver instalado antes de reanudar): 4 URLs `http://127.0.0.1:8767/cache/surface/<hash>` para `tile_-1_-1`, **0** a kinds muertos, 1 `POST /generate_surface_atlas` (resolve). remote-gen: 4 `POST /generate_surface_atlas` 200 y **0 «celdas nuevas»**; ledger 1568 → 1568. Capturas: `qa/capturas/2026-09-02-T4-qa/01-miravanda-maqueta3d-16-celdas-de-la-libreria.jpg` y `02-tras-reanudar-tile-0-0-en-clay.jpg` (ver H2). El lector de red de la extensión de Chrome no ve el :8767 (sí el :8768): por eso la evidencia es `last_used` + observer, no una captura de Network |
| 8 | Cierre: PR con `Closes #343/#344/#257`, comentarios #368/#376, nota de honestidad | ⚠️ no probado | No hay PR abierta todavía (sin push); es del coordinador |
| 9 | La procedencia sobrevive a la purga | ✅ cumple (con matiz) | `jq` sobre `archivo/cache/manifest-retirado.json`: `total 16986 · filas 16986 · prompt≠"" 16581 · prompt==null 0 · motivo "#257 · #293"`; claves `created_at extra hash prompt size_bytes subtype type` (+`last_used` en 9.061 filas, las que lo tenían). `comm` contra `manifest.json` (16.907 filas): **79** hashes solo en el export (26 `scene`, 53 `segment`), **0** con prompt vacío. 0 filas `surface` en el export. Matiz: 405 filas llevan `prompt: ""` — las de `extra.recovered=true` (380 texture, 14 sprite, 6 skin, 5 model), y `manifest.json` ya tenía exactamente 405 vacías: el export conserva lo que había. El criterio literal («16.986 entradas con prompt») era imposible de cumplir; el que importa (#293: que no se pierda ninguna procedencia que existiera) se cumple |

## Pasada adversarial (sobre copias en el scratchpad, jamás la DB real)

| Situación | Resultado |
|---|---|
| Script sobre DB ya purgada (copia de la real) | dry-run: `total ajeno: 0 filas · 0 filas ajenas, nada que hacer` exit 0; `--ejecutar`: ídem, **no crea** `manifest-retirado.json` (idempotente) |
| `--archivo` apunta a un directorio que **no existe** + DB con 1 ajena (`scene/plate`, con pin y `meta imported_at`) | lo crea (`mkdirSync recursive`), `exportadas 1 → …/manifest-retirado.json`, `borradas 1 filas, 1 pins, 1 meta`, `VACUUM ok`, `quedan 0`; el export lleva `hash` y `prompt`; la copia queda `surface 179 · pins 0 · meta []` |
| Segunda pasada sobre esa misma copia (export ya existe, mismo contenido) | `0 filas ajenas, nada que hacer` exit 0, export intacto |
| `--db` inexistente (clon limpio), con y sin `--ejecutar` | `manifest-solo-surface: no existe <ruta>` exit 1, **no crea** la DB |
| `cache/` con un `textures/` sobrante | guardia 1: `todavía tiene material que no es del kind vivo — archívalo primero: mv …/textures …/a5/textures` exit 1 |
| `--cache` inexistente | pasa la guardia (nada que archivar) y sigue: exit 0 |
| Asset-store **arriba** (el mío, :8767) + `--ejecutar` sobre copia con ajena | guardia 2: `hay un asset-store respondiendo en http://127.0.0.1:8767 — párale primero (tecla k de start.sh): VACUUM exige exclusividad.` exit 1; la copia sigue con 180 filas, sin export |
| Flag desconocida | exit 2 (ingeniero; no repetido) |
| **Clon con `cache/` VACÍO** (existe, sin DB): `server.ts` directo | arranca: `/health → {"ok":true,"total_count":0,"total_bytes":0}` (crea la DB) |
| **Clon SIN `cache/`**: `./start.sh --preset cliente-web` | **NO arranca** — ver H1 |

## Hallazgos

### Importante

**H1 — Un clon sin `cache/` no arranca `cliente-web`: el asset-store muere con un stacktrace de SQLite.**
`ManifestDb` hace `new DatabaseSync(path)` sin crear el directorio (`manifest-db.ts:79`), y el asset-store es
el PRIMER servicio del preset. Repro: `git archive HEAD | tar -x -C <dir>` (+ `node_modules`/`.venv`
enlazados), `./start.sh --preset cliente-web` → en 1,6 s: `❌ asset-store murió antes de responder (exit 1)` +
`Error: unable to open database file … at new ManifestDb (…/manifest-db.ts:79:15) … errcode: 14`. Lo que
esperaría quien clona: que el store abra una DB vacía y arranque (es lo que la crítica y el plan dan por hecho:
«su asset-store abre una DB nueva y arranca» — cierto solo si `cache/` **existe**, que es el caso de los tres
worktrees medidos, no el de un clon). **No es regresión de T4** (`git diff main..HEAD -- manifest-db.ts` no
toca el constructor; en `main` pasaba igual), pero T4 convirtió el arranque del store en un veredicto
explícito («dice qué hacer, no calla») y este caso sigue callando con un volcado de pila. Con `cache/` vacío
sí arranca (medido). Sugerencia (no aplicada): crear el directorio de `dbPath` al cargar la config o en el
constructor. Va a issue, no bloquea la PR.

**H2 — Reanudar una partida deja en clay el tile donde está el jugador.**
Repro (stack `cliente-web`): nueva partida Miravanda/Acuarela luminosa en Maqueta 3D → el mundo se pinta con
las 16 celdas de la librería → recargar → «Reanudar» → el HUD dice solo `Atlas fps de tile_-1_-1 instalado
(0 páginas nuevas, todo de la librería)`; `__nefan.fps().activeTile === "tile_0_0"`, `currentTile ===
"tile_0_0"`, pero hubo **un solo** `POST /generate_surface_atlas` (el de `tile_-1_-1`) y la taberna donde
está el jugador queda en clay marrón (captura `02-tras-reanudar-tile-0-0-en-clay.jpg`; esperé 18 s). Lo
que espera el jugador: reanudar y ver el mismo arte que dejó (el propio `fps-atlas.ts` dice «el resume
restaura el arte pagado»). El diff de T4 no toca `fps-atlas.ts` ni el camino de resume, así que
probablemente es previo; **no lo he comparado con `main`** (sin base de comparación). Va a issue.

### Menor

**H3 — Regla del formato muerto: un test vivo alimentado con kinds muertos.** `test/asset-store.test.ts`
«GET /assets: collapse por (hash,type), más reciente primero, filtro y limit» planta con `importEntry`
filas `texture/albedo`, `texture/normal`, `scene/scene` para ejercer el collapse de dos subtypes del mismo
hash y el filtro CSV `"texture,surface"`. El propio comentario lo reconoce («con un solo kind vivo,
`register` no puede producir dos subtypes del mismo hash»): ese collapse es **inalcanzable en producción**
desde T4, y el test lo mantiene vivo con datos de un formato retirado — exactamente lo que CLAUDE.md pide no
dejar. O se declara el collapse código muerto y se retira con su test (declarando la pérdida), o se reescribe
el test con lo único que puede pasar hoy (un hash, `surface/surface`, orden por recencia y `limit`). Los usos
de kinds muertos en `manifest-solo-surface.test.ts` y en el test de los once kinds → 400 son legítimos: su
sujeto SON las filas ajenas.

**H4 — Testabilidad del fail-loud.** `CONFIG.ai_server.manifest_db` no admite override por entorno (solo el
puerto lo admite en `loadAssetStoreConfig`), así que `server.ts` solo se puede arrancar contra la DB real:
para probar el criterio 4 en negativo sobre una copia tuve que exportar el árbol entero (ver Workarounds). Un
`NEFAN_MANIFEST_DB` haría el negativo un test de una línea.

**H5 — Redacción de requisitos.** «15 globs» son 14; «16.986 entradas con prompt» no podía cumplirse (405
nacieron sin prompt en el recovery scan y ya estaban vacías en `manifest.json`). Ninguna afecta al resultado;
que consten para que el criterio 9 no se lea como incumplido.

**H6 — Fuera de la tanda, observado de paso.** (a) `python3 -m unittest discover -s ai_server/tests` escribe
**24 eventos falsos de $0,24** en el `cache/spend/events.jsonl` REAL (`test_sprite_forge_adapter.py` →
`remote_generation.py:462/480` sobre el singleton `SPEND`): el «total 651,07 €» de la barra de desarrollo
crece unos 5,8 $ ficticios por corrida de tests. (b) `./start.sh --parar` listó remote-gen y sprite-forge
—arrancados por mi propio launcher— como «ajenos» (la regla del `cwd`: sprite-forge corre desde el repo
hermano); acabaron parados por el `trap` del launcher y no quedó nada arriba, pero la clasificación es
engañosa. Ninguno es de T4.

## Workarounds usados y veredicto

- **Export limpio del árbol** (`git archive HEAD` al scratchpad, `node_modules`/`.venv` enlazados, `.env`
  copiado) para (a) simular un clon y (b) tener un `cache/` propio con una copia de la DB y una fila
  plantada. Necesario porque la DB no admite override (H4). No afecta al jugador; sí a quien quiera testear
  el fail-loud sin tocar la DB real. Destapó H1.
- **`performance.setResourceTimingBufferSize(6000)` + `PerformanceObserver`** instalados en la página tras
  recargar y antes de reanudar, porque el buffer por defecto (250) se llenó con las hojas de `y_bot` y el
  lector de red de la extensión no ve el :8767. Es instrumentación de observación; no altera el juego. La
  evidencia principal del criterio 7 es de servidor (`last_used`), que no depende de esto.
- **Ninguno sobre el juego**: ni overlays ocultos, ni estado forzado, ni pantallas saltadas. El flujo fue el
  del jugador desde `./start.sh` y el título.

## No probado

- **Criterio 8** (PR, cierres en inglés, comentarios en #368 y #376, nota de honestidad): no hay PR aún.
- **Mutación**: pendiente de autorización (`afectado` pide la corrida completa); `services/`, `src/narrative`
  y `scripts/` no tienen medida.
- **Gasto real**: se verificó que NO hubo (ledger y logs), no que pintar las 7 celdas que faltan o «Aplicar
  estilo» completo funcionen — costarían.
- **H2 contra `main`**: no medido; se reporta como observado en la rama.
- **`start.sh` en los otros tres callers** (fake-ai, remote-gen, ai_server) de `wait_for_http_health` con
  `pid`: solo se ejerció el del asset-store (dos veces, clon y copia); los demás por lectura del diff.

## Guion nuevo

`qa/guiones/59-las-superficies-vienen-de-la-libreria-y-la-maqueta-no-pinta.mjs` — lo mecánico del criterio
7 que ni el 21 ni ningún test cubrían: (1) en Maqueta 3D el cliente pide el atlas **solo** con
`resolve_only: true`, el motor falso no anota `/generate_surface_atlas` como ruta de pago, no baja ninguna
celda de una librería vacía y el jugador lee por qué está en clay; (2) en Imagen IA el atlas se instala y
**cada** celda es `/cache/surface/{16 hex}`, ninguna de un kind muerto. `aisla: ["saves","fake-ai"]`; sin
`sinMotor` (la partida 2 pinta en el fake, como cualquier partida llama a `/generate_scene`).

- Positivo: `node qa/run.mjs 59` → **10 asertos verdes, 1 en verde · 0 en rojo**, 6,5 s.
- Negativo 1 (`fps-atlas.ts`: `resolve_only: undefined`): 4 rojos — «TODAS llevan resolve_only» (`[{"cells":23}]`),
  «no anotó ruta de pago» (`despues: {"/generate_surface_atlas":1}`), «no se descargó NINGUNA celda»
  (`/cache/surface/a0ca…`), «el jugador lee por qué está en clay» (dice «instalado»).
- Negativo 2 (`fps-atlas.ts`: celdas pedidas a `/cache/albedo/`): 3 rojos — «quedó INSTALADO» (`atlas fps
  de tile_0_0 falló — se queda en clay`), «cada celda es /cache/surface/{16 hex}» (`…/cache/albedo/a0ca…`),
  «ni una a un kind sin productor».
- Ambos sabotajes restaurados con `git checkout`; `git status` limpio. `test/architecture.test.ts` 64/64 con
  el guion en el árbol (`qa/**/*.mjs` es root del candado).

## Veredicto

**Apto con reservas.** Lo pedido está hecho y demostrado: el manifest solo tiene `surface`, el material
pagado y su procedencia están en `archivo/cache/`, el asset-store se niega a arrancar diciendo qué hacer y
`start.sh` lo enseña en 1 s, el candado muerde en las siete familias y en el cast, y el juego real carga las
superficies desde `/cache/surface/…` sin gastar. Las reservas: H1 y H2 (a issue; no los causó T4 pero son lo
que el siguiente en clonar o en reanudar se encuentra) y H3 (un test sobre formato muerto que la propia
tanda existe para no dejar: resolver en la PR).
