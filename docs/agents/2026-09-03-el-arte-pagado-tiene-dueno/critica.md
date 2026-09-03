# Crítica T8 — «El arte pagado tiene dueño»

**#375 VIGENTE · #376 REENCUADRADA · #391 VIGENTE · #369-R7 FUERA · +1 issue nuevo**

Verificado sobre `main`=`233b7b4` leyendo código y midiendo disco. Dos repos: `ne-fan` y `~/code/sprite-forge` (`b2d9ba9`).

## #375 — VIGENTE

**Problema:** el arte vestido depende del perfil de repintado y su clave no, así que cambiarlo sirve el arte viejo sin decirlo.

| Afirma | Verificado |
|---|---|
| El perfil no entra en la clave del vestido | CIERTO — `remote_generation.py:275-299`: `base_key, model, anim, angle, prompt, ai_model, style_key, "skinforge_v3", dev-cache`. Sin perfil |
| Ni en `base_key` | CIERTO — `sprite-forge/src/base-key.mjs`: `version, model_hash, anim_hash, angle, directions, fps, width, height, light, roughness` |
| El perfil decide qué se pinta | CIERTO — `sprite-forge/src/server.mjs:213-217` → `planDeRepintado`; `src/anim-profile.mjs:62-86` |
| El set de ne-fan es la segunda vía | CIERTO Y MÁS FUERTE: `start.sh:516` pasa `--set …/data/sprite-set.json`. No es copia, **es el set vivo** |
| «declara perfil para las 9+ anims y el test lo exige» | **FALSO a medias.** 16 anims; **6 sin perfil** (`talking, drinking, wounded_idle, sitting_idle, waving, praying`). `test/sprite-set.test.ts:62-75` solo cubre las 10 de `HOJAS_BASE_ANIMS`; esas 6 caen en `PERFIL_POR_DEFECTO` de sprite-forge |

**El día después.** Mover la clave deja inalcanzables los 27 sheets en disco (27,3 MB, 1.152 frames, 7 personajes). Los heroes NO repagan (`hero_key` no cuelga de `base_key` ni del perfil). **Ya pasó:** `archivo/cache/sprite_sheets/` son 169 sheets y **553 MB**, mtime **2026-08-24**, el día del cambio `skinforge_v2→v3` (`remote_generation.py:288-289`). Medio giga varado y barrido a mano. No es riesgo teórico: es el precedente exacto.

**Coste/valor.** Barato (una función Python; la tabla de test ya existe en `ai_server/tests/test_sprite_forge_adapter.py:122-124`) y el fallo paga con dinero. No hacerlo nunca = el set es un fichero editable sin efecto, peor que no tenerlo.

**Dónde entra (decisión pedida): en la clave del VESTIDO, en ne-fan. No en `base_key`.** (1) La hoja base no depende del perfil — el repintado elige índices *sobre* la hoja completa (`anim-profile.mjs:74-75`); meterlo allí invalida arte que no cambió. (2) `base_key` entra en la clave pagada: ensuciarlo repaga skins, que es justo lo que denuncia #369-R7 — sería una segunda instancia del mismo acoplamiento. (3) Un solo repo, verificable gratis.

**Dos restricciones para el arquitecto (no diseño):** el perfil hasheado debe ser el **efectivo** (el que sprite-forge aplicará), no una copia local que puede no estar en vigor; y las 6 anims sin perfil obligan a elegir entre espejar `PERFIL_POR_DEFECTO` (mirror que derivará) o declararlas en el set y extender el test — la segunda borra el problema.

## #376 — REENCUADRADA

**Problema real:** el arte más caro no guarda con qué texto se pidió. No que no se pode.

| Afirma | Verificado |
|---|---|
| Sheets y heroes fuera del manifest y del prune | CIERTO — `blob-store.ts:40-70`; `prune.ts:76-89` itera `db.pruneGroups()`. `remote_generation.py` no menciona el asset-store ni una vez |
| «no lo mide ni lo recorta nadie» | CIERTO en «no lo mide». **ENGAÑOSO en «no lo recorta»**: `cache_max_bytes`=2 GiB (`src/config.ts:193`) contra 226 MB en `cache/`. El prune no va a disparar, ni cerca. Cero daño observable hoy |
| Cita `dirsByType`, `blob-store.ts:88-96` | OBSOLETO — T5/#394 lo dejó en `surfaceDir` y `blob-store.ts:59-66`. El hecho aguanta, la cita no |

**El sujeto es el HERO, no el sheet.** Heroes: **60 ficheros, 58,7 MB — el 66 % del montón pagado**, para 7 personajes de sheets. Sheets: 27 dirs, 27,3 MB, y **sí guardan su prompt** (`meta.skin.prompt`, `remote_generation.py:479`). El hero es un PNG desnudo llamado por un hash: **su prompt no se guarda en ningún sitio**, es irrepetible. Choca con #293 (decisión del usuario del 2026-08-27) y con `feedback_descripcion_es_procedencia`.

**Por qué es MAYOR de lo que dice.** No existe keep-list de arte de personaje: `entity.asset_refs` es `[]` por defecto (`narrative-state.ts:724,749`) y **ningún llamante de `src/` ni `bridge/` lo rellena**; solo el cliente registra hashes de superficie (`fps-atlas.ts:344`). Indexar sheets y heroes **evictables** deja al prune borrar por LRU la skin de un NPC vivo. Hoy son invisibles; indexarlos a secas los vuelve *borrables*: eso es empeorar. El «pin de heroes y frames» que nombra el issue es la menor de las dos coherencias que faltan.

**Conflictos.** #293-3 es literalmente este arte: indexar con prompt lo cierra, el prune a secas no — por separado se paga dos veces. #369-R10 ya está hecho (`start.sh:514-517` fija `--set` y `--cache`); esta es su mitad restante, sin contradicción. #257/#394 archivó `skin/skin` como «kind sin productor»: el productor existe (`remote_generation.py`), lo que faltaba era el registro, así que reabrir el kind **completa** #257 — pero `src/contracts/asset-store.ts:20-28` afirma hoy que skins no tiene productor y quedaría mintiendo: se reescribe el mismo día.

**Coste/valor.** El argumento del prune no sostiene la tanda. El de procedencia sí, y es decisión viva del usuario. Si no se hace nunca: el 66 % del gasto en personajes queda sin forma de regenerarse con un modelo mejor.

**La cara de la tanda (decisión pedida): ENTRAN EN EL MANIFEST, con su prompt, y PINEADOS.** (1) Solo el índice arregla lo que falta de verdad —el prompt del hero—; «el prune aprende a verlos» necesita igualmente `last_used` y keep-list para evictar sin romper una partida, o sea que haría crecer un **segundo censo** al lado del que ya se pagó, y dos censos divergen. (2) El peaje del tipo lo tiene puesto precio el propio código (`asset-store.ts:25-27`: «añadir un kind exige tocar esta línea, el `z.literal` y `surfaceDir`») y el invariante que defiende es *ningún kind SIN productor*: estos dos lo tienen, así que ampliar la unión hace el tipo más verdadero, no más laxo. El pin permanente bajo un `ref` fijo conserva el comportamiento de hoy (no evictables) mientras hace visible y trazable el gasto; la keep-list de personaje es issue aparte y desbloquea el unpin.

## #391 — VIGENTE

**Problema:** el único camino de fallo del asset-store —negarse a arrancar— no se puede ejercer sin la DB del checkout.

**Premisa cierta, línea por línea.** `config.ts:31-42` lee UNA env (`NEFAN_ASSET_STORE_PORT`, `:35`); `dbPath` es `abs(ai.manifest_db)` (`:36`) contra `REPO_ROOT` desde `import.meta.url` (`:12`), así que ni el cwd es palanca. `manifest_db` entra en `runtime_config.json:25` pero **no lo lee nadie fuera de TS** (cero en `ai_server/**` y en `start.sh`): el aviso del issue se cumple solo. `nadie-inventa-un-puerto` (`arch-rules.json:650-664`) no cubre `nefan-core/services/**` ni casa con una ruta: no aplica. Precedentes de override de ruta: `NEFAN_GAMES_DIR`/`NEFAN_SAVES_DIR` (`bridge/ws-server.ts:48,54`) y el propio `scripts/manifest-solo-surface.ts:178-186`, que ya acepta `--db`.

**Más barato de lo que cree, y una parte ya está hecha.** `server.ts:17-22` sale antes de crear el servidor: el negativo no necesita puerto ni teardown. Y **ningún test toca hoy la DB real** — los 9 `new ManifestDb` de test son `mkdtempSync` (`test/manifest-solo-surface.test.ts:23`; `test/asset-store.test.ts:45,270,337,359,431`). Falta el override y que alguien ejerza `server.ts:11-22`, hoy sin un solo test.

**Solape:** #392 (los tests Python escriben en el ledger de gasto real) es el mismo defecto de clase en otro proceso. No fusionar, pero si el candado «ningún test escribe en datos reales» se escribe aquí, que cubra los dos.

## #369-R7 — FUERA de la tanda

Su aceptación entera es «el README de sprite-forge lo documenta»: prosa donde la casa pide candado, en otro repo, y no se puede poner rojo. Lo inseparable de #375 es la **decisión**, no el README: `_skin_sheet_key` cuelga de `base_key` (`remote_generation.py:280`) y `base_key` lleva `version`, o sea el código del renderizador de hojas *gratis*. La PR de #375 toca esa línea; que deje escrito si eso se queda y por qué.

## Hallazgo nuevo: los 81,7 MB huérfanos — DEFECTO REAL, pequeño

Ni suciedad histórica ni migración. Los 19 directorios sin fila son **todos** `atlas_<16hex>` con `page0.png…pageN.png`, escritos a propósito por `remote_generation.py:177-183` con `surface_cache.get_path(...)` + `write_bytes`, saltándose `AssetCache.put()` (`asset_cache.py:80-116`), el único sitio que llama a `register()`. El prefijo hace el nombre de 22 caracteres: **nunca** casará con un hash de 16 hex, luego nunca tendrá fila. Fechas de agosto intercaladas al segundo con superficies que sí la tienen; introducido en `59a7957`. Ninguna otra escritura en `surfaceDir` esquiva `put()`. Los 179 dirs con forma de hash tienen todos su fila: el índice no miente al revés.

**Issue propuesto** — *«Las páginas de debug del atlas viven dentro de la raíz indexada: 81,7 MB que ningún prune puede tocar»*: `remote_generation.py:177-183` escribe `atlas_*` en `surfaceDir`; el prune solo borra `join(surfaceDir, g.hash)` de filas del manifest (`prune.ts:87-89`) y `db.totalBytes()` las ignora, así que son irreclamables automáticamente y el techo de 2 GiB se compara contra un censo que ve el 16 % del disco. Medido 2026-09-03: 19 dirs, 81,72 MB, el 71 % de `cache/surfaces/`. Cierre: las páginas de debug salen de la raíz indexada y queda candado de que nada escriba en `surfaceDir` fuera de `AssetCache.put()`. *(Ventana secundaria real pero no causante: `put()` registra DESPUÉS de escribir —`asset_cache.py:88-115`— y `register()` es fail-loud.)*

## Orden y troceo (decisión pedida)

**#375 antes que #376, siempre**: #375 mueve la clave del vestido, e indexar primero sería registrar filas de arte que #375 vara acto seguido. El barrido de esos 27,3 MB va **en su PR**, no en la siguiente — el precedente del 2026-08-24 dice que si no se hace ese día, no se hace.

| PR | Issue | Toca | Depende de |
|---|---|---|---|
| **A** | #391 | `services/asset-store/config.ts` + `test/` | nada |
| **B** | #375 (+ decisión R7 escrita) | `ai_server/routers/remote_generation.py`, sus tests, `data/sprite-set.json` | nada |
| **C** | #376 | contratos, store, Python, pin | A (probarlo sin la DB real) y B (no indexar claves muertas) |

A y B no comparten un solo fichero: dos ingenieros, dos worktrees, desde el minuto cero. C la toma quien acabe antes. El issue del `atlas_*` se abre ya y se arregla dentro de C solo si es la misma línea.

## Qué NO hay que hacer

1. **No meter el perfil en `base_key`** — repaga arte que no cambió y duplica el acoplamiento de R7.
2. **No espejar `PERFIL_POR_DEFECTO` en ne-fan** — declarar las 6 anims que faltan y extender el test.
3. **No indexar sheets/heroes evictables** — sin keep-list de personaje el prune borra la skin de un NPC vivo.
4. **No cerrar #369-R7 con una línea de README.**
5. **No vender #376 por el prune** — 2 GiB contra 226 MB; el argumento es la procedencia.
6. **No dejar varados los 27,3 MB** cuando #375 mueva la clave.
7. **No ampliar `AssetKind` sin reescribir `src/contracts/asset-store.ts:20-28`**, que afirma que skins no tiene productor.
8. **No tocar `archivo/cache/` (1,4 GB)** — archivo deliberado, no es sujeto de nada aquí.

## Qué cambiarle a `requisitos.md` (para pegar)

- #375: sustituir «*el set declara `keyframes` y `play_fps` para las 9+ anims, y el test ya lo exige*» por «el set tiene **16** anims y **6 no declaran perfil** (`talking, drinking, wounded_idle, sitting_idle, waving, praying`); `test/sprite-set.test.ts:62-75` solo cubre las 10 de `HOJAS_BASE_ANIMS`, así que caen en el `PERFIL_POR_DEFECTO` de sprite-forge. Y `start.sh:516` pasa `--set`: el fichero de ne-fan no es una copia, es el set vivo».
- #375, criterio nuevo: «los 27 sheets (27,3 MB) que la clave nueva deja inalcanzables se re-clavan o se borran **en la misma PR**; el 2026-08-24 el mismo cambio varó 169 sheets y 553 MB que siguen en `archivo/`».
- #376, encuadre de coste: «el techo es 2 GiB (`src/config.ts:193`) contra 226 MB en `cache/`: el prune no dispara y no hay daño observable hoy. Lo que falta es **procedencia**: el hero son 58,7 MB de los 89 (60 ficheros para 7 personajes) y **su prompt no se guarda en ningún sitio** — el sheet sí, en `meta.skin.prompt`. Esto es #293 punto 3».
- #376, añadir: «no existe keep-list de arte de personaje (`entity.asset_refs` es `[]` y no lo rellena nadie): entran **pineados**, y el unpin es otro issue».
- Criterio 3 de la tanda: quitar «Ningún test toca `cache/manifest.sqlite3` real» de la lista de trabajo — **ya es cierto hoy** (los 9 `new ManifestDb` de test usan `mkdtempSync`). Lo que falta es el override y ejercer `server.ts:11-22`, hoy sin un solo test.
- Sacar #369-R7 de la tanda; dejar en #375 la obligación de escribir la decisión sobre `base_key`.
