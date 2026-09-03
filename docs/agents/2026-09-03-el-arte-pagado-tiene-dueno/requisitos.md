# T8 — «El arte pagado tiene dueño»

**Tanda 8 de la serie «el núcleo primero, los plugins después»** (plan del 2026-09-02).
Abierta el 2026-09-03 sobre `main` = `233b7b4` (T7 recién cerrada). Backlog: 42 issues abiertos.

## Cita literal de la petición

Del usuario, al abrir la serie (2026-09-02):

> «Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los plugins
> los podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser
> plugins y tienen baja prioridad en cuanto a calidad del codigo. Haz una seleccion de los issues
> centrales y marca los demas para mirar a futuro».

Del usuario, al abrir ESTA tanda (2026-09-03), tras el informe de cierre de T7 que terminaba
proponiendo T8 «El arte pagado tiene dueño» (#375 + #376 + #391; #369-R7 en sprite-forge):

> «Adelante con T8»

Restricciones permanentes que el usuario ha dado en esta serie y siguen vigentes:

> «no le cerreis sus servers» — hay otros agentes de Claude trabajando en paralelo en esta máquina.
> Nunca matar procesos que no haya arrancado esta sesión; `pkill vite`/`node` prohibido; matar por
> puerto prohibido. Arrancar solo con `./start.sh --preset <slug>`, parar solo lo propio con
> `./start.sh --parar`.

> «Asegurate de que no quede ningun rastro de la version anterior. Esos rastros confunden a los
> agentes» — una retirada incluye prosa, comentarios y docs, y se canda.

Y la regla de la casa para esta serie: **cero créditos** en toda verificación. Esta tanda toca
justamente el pipeline que gasta, así que se verifica con el motor falso (`e2e-sin-creditos`),
con `html-fixtures`, o con `cliente-web` sin activar Imagen IA. Ninguna verificación puede llamar
a sprite-forge para generar, ni a fal/Meshy.

## Los tres issues

### #375 — Cambiar el perfil de repintado de una anim sirve el arte viejo en silencio

`_skin_sheet_key` (`ai_server/routers/remote_generation.py:275-299`) compone la clave del sheet
vestido con `base_key + model + anim + angle + prompt + ai_model + style_key + "skinforge_v3" +
namespace de dev-cache`. **Lo que no entra por ninguna vía es el perfil de repintado**: `keyframes`
y `play_fps`. En sprite-forge, `CAMPOS_CLAVE` (`src/base-key.mjs`) es `version, model_hash,
anim_hash, angle, directions, fps, width, height, light, roughness` — ese `fps` es el del render de
la hoja BASE, no el `play_fps` del perfil.

Consecuencia: cambiar el perfil de una anim produce un repintado distinto y la clave no se mueve.
Se sirve el arte viejo en silencio: sin error, sin aviso, y el jugador ve frames que ya no
corresponden al perfil declarado.

Por qué ahora: la PR #373 (#369-R10) trajo el set a ne-fan (`nefan-core/data/sprite-set.json`), así
que hay una segunda vía, más cómoda, para cambiar el perfil — y por tanto para disparar esto sin
darse cuenta.

> **Crítica (VIGENTE, con dos correcciones a lo que yo había medido):** el set tiene **16** anims y
> **6 no declaran perfil** (`talking, drinking, wounded_idle, sitting_idle, waving, praying`);
> `test/sprite-set.test.ts:62-75` solo cubre las 10 de `HOJAS_BASE_ANIMS`, así que esas seis caen en
> el `PERFIL_POR_DEFECTO` de sprite-forge. Y la premisa es MÁS fuerte de lo que yo escribí:
> `start.sh:516` pasa `--set …/nefan-core/data/sprite-set.json`, o sea que ese fichero no es una
> copia, **es el set vivo** que sprite-forge aplica.
>
> **Criterio nuevo que impone la crítica:** los 27 sheets (27,3 MB) que la clave nueva deja
> inalcanzables se re-clavan o se borran **en la misma PR**. Precedente exacto: el 2026-08-24 el
> cambio `skinforge_v2→v3` varó 169 sheets y **553 MB**, que siguen en `archivo/cache/sprite_sheets/`
> barridos a mano. Si no se hace ese día, no se hace.
>
> **Dónde entra el perfil (decisión del crítico): en la clave del VESTIDO, en ne-fan, no en
> `base_key`.** La hoja base no depende del perfil (el repintado elige índices *sobre* la hoja
> completa), y ensuciar `base_key` repagaría skins — que es justo lo que denuncia #369-R7.

**Criterio de cierre (literal del issue)**: «Cambiar `keyframes` o `play_fps` de una anim en el set
produce una clave distinta y, por tanto, arte nuevo. Verificable sin gastar: dos llamadas a la
función de clave con perfiles distintos tienen que dar hashes distintos, y el candado es un test que
se ponga rojo si el perfil deja de entrar. Decidir de paso **dónde** entra: si en `base_key`
(sprite-forge, y entonces afecta también a la hoja base) o solo en la clave del vestido (ne-fan). No
son equivalentes: la hoja base no depende del perfil de repintado.»

### #376 — Los sheets vestidos y los hero-shots están fuera del manifest y del prune

Viven en un almacén paralelo (`cache/sprite_sheets/`), sin manifest y sin `touch`, y por tanto fuera
del prune, que solo recorre `surfaceDir`. Está escrito en el código con su aviso
(`nefan-core/services/asset-store/blob-store.ts:59-66`):

> «Mismo almacén paralelo que los frames: sin manifest y sin touch, y por tanto FUERA del prune (que
> solo recorre `surfaceDir`) — si algún día los sprite sheets entran en el manifest, heroes y frames
> necesitarán pin a la vez.»

Es el arte más caro del juego: cada skin de personaje son ~16 llamadas de imagen, y el hero-shot es
la llamada de identidad que las precede. Crece con cada NPC de cada partida y no lo mide ni lo
recorta nadie.

> **Crítica (REENCUADRADA):** el hecho es cierto pero el argumento no. El techo del prune son
> **2 GiB** (`src/config.ts:193`) contra 226 MB en `cache/`: no va a disparar, y hoy no hay daño
> observable. Lo que falta de verdad es **procedencia**, y el sujeto es el **hero**, no el sheet: son
> 60 ficheros y **58,7 MB de los 89 (66 %)** para 7 personajes, y **su prompt no se guarda en ningún
> sitio** — el sheet sí lo guarda, en `meta.skin.prompt` (`remote_generation.py:479`). Esto es el
> punto 3 de #293 y la regla «la descripción es la procedencia».
>
> Y es **mayor** de lo que dice el issue: no existe keep-list de arte de personaje
> (`entity.asset_refs` es `[]` por defecto y **no lo rellena ningún llamante** de `src/` ni
> `bridge/`). Indexarlos a secas los volvería *evictables* y el prune podría borrar la skin de un NPC
> vivo: hoy son invisibles, mañana borrables — eso es empeorar. Entran **pineados**; el unpin es otro
> issue.
>
> La cita del issue a `dirsByType` y `blob-store.ts:88-96` está OBSOLETA (T5/#394 lo dejó en
> `surfaceDir`, `blob-store.ts:59-66`): el hecho aguanta, la cita no.

**Criterio de cierre (literal)**: «Los sheets vestidos y los heroes entran en el manifest del
asset-store con su prompt, o el prune aprende a verlos — y en cualquiera de los dos casos, **con pin
simultáneo de heroes y frames**, porque un hero sin sus frames (o al revés) es arte pagado que ya no
sirve para nada. Decidir dueño, como se hizo con la caché de hojas base.»

**El peaje del tipo** (comentario de la PR #394 en el issue, verificado hoy): el asset-store se ha
quedado con un solo kind y el candado es tipo, no prosa — `AssetKind = "surface"`
(`src/contracts/asset-store.ts:28`), `z.literal(ASSET_KIND)` en `type` y `subtype`
(`src/contracts/request-schemas.ts:168-169`), `surfaceDir: string` en vez de un mapa kind→dir
(`services/asset-store/config.ts:23`, `blob-store.ts:31`, el prune), y `verificarSoloSurface`
(`services/asset-store/solo-surface.ts`) que **impide arrancar** si el índice tiene otro kind. Si la
opción elegida es «entran en el manifest», hacen falta dos kinds nuevos y eso exige ampliar la unión,
`z.literal` → `z.enum`, volver `surfaceDir` a un mapa (tres firmas) y enseñar a `verificarSoloSurface`
los kinds legítimos. No es bloqueo: es el coste de que «ningún kind sin productor» esté en el tipo.
La otra opción del cierre («el prune aprende a verlos») no paga ese peaje.

> **Cara de la tanda (decisión del crítico): ENTRAN EN EL MANIFEST, con su prompt, y PINEADOS.** Solo
> el índice arregla lo que falta de verdad (el prompt del hero, hoy irrepetible); «el prune aprende a
> verlos» necesitaría igualmente `last_used` y keep-list, o sea un **segundo censo** al lado del que
> ya se pagó, y dos censos divergen. El peaje del tipo no es objeción: el invariante que defiende
> `AssetKind` es «ningún kind **sin productor**», y estos dos lo tienen
> (`remote_generation.py`), así que ampliar la unión hace el tipo más verdadero, no más laxo. Coste
> obligatorio: `src/contracts/asset-store.ts:20-28` afirma hoy que skins no tiene productor y
> quedaría mintiendo — se reescribe el mismo día.

### #391 — El fail-loud del asset-store solo se puede probar contra la DB real

`CONFIG.ai_server.manifest_db` no admite override por entorno (`loadAssetStoreConfig` solo lo admite
para el puerto, `services/asset-store/config.ts:32-41`), así que `server.ts` siempre abre la DB del
checkout. Para verificar en negativo el veredicto de `solo-surface.ts`, el QA de T4 tuvo que exportar
el árbol entero al scratchpad, plantar la fila en la copia y arrancar desde allí. Fue el único
workaround de peso de la tanda, y cada workaround de prueba es un hallazgo.

**Criterio de cierre (literal)**: «Existe el override, `test/manifest-solo-surface.test.ts` (o
`asset-store.test.ts`) arranca el server contra una DB temporal con una fila ajena y afirma el
`exit 1` y el mensaje; la DB real no se toca en ningún test.»

> **Crítica (VIGENTE):** premisa cierta línea por línea, y más barato de lo que parece —
> `server.ts:17-22` sale ANTES de crear el servidor, así que el negativo no necesita puerto ni
> teardown. `nadie-inventa-un-puerto` **no aplica** (no cubre `nefan-core/services/**` ni casa con
> rutas), y hay precedente de override de ruta: `NEFAN_GAMES_DIR`/`NEFAN_SAVES_DIR`, y el propio
> `scripts/manifest-solo-surface.ts` ya acepta `--db`. Ojo: «ningún test toca la DB real» **ya es
> cierto hoy** (los 9 `new ManifestDb` de test usan `mkdtempSync`); lo que falta es el override y que
> alguien ejerza `server.ts:11-22`, hoy sin un solo test.

Aviso del propio issue: cuidado con `nadie-inventa-un-puerto` (`arch-rules.json`) — la ruta no es un
puerto, pero el snapshot `runtime_config.json` es la fuente única de `start.sh`; si el override se lee
solo en TS, `start.sh` no tiene que saber nada.

### #369-R7 — fuera de este repo

La mitad R7 de #369 es del repo **sprite-forge**: `version` entra en `base_key`
(`sprite-forge/src/base-key.mjs`) y `base_key` entra en la clave del sheet vestido, así que un bump
de versión repaga los `/skins` de cada personaje (~16 llamadas por NPC). Su README justifica meter la
versión diciendo que rehacer una hoja «cuesta ~9 s sin gastar nada» — cierto para él, falso para
ne-fan. Aceptación: el README de sprite-forge lo documenta y el bump pasa a ser decisión consciente.
> **Crítica: FUERA de la tanda.** Su aceptación entera es «el README lo documenta»: prosa donde la
> casa pide candado, en otro repo, y no se puede poner rojo. Lo inseparable de #375 es la **decisión**
> sobre `base_key`, no el README — la PR de #375 toca esa línea y debe dejar escrito si `version` se
> queda ahí y por qué.

## Medidas de hoy (2026-09-03, `main` = `233b7b4`)

Tomadas por el coordinador con el checkout principal, sin arrancar nada:

| Medida | Valor |
|---|---|
| `cache/sprite_sheets/` en disco | **89 MB** — 29 directorios de sheets + 60 heroes, **cero filas de manifest** |
| `cache/surfaces/` en disco | **118,6 MB** en 198 directorios |
| Manifest (`cache/manifest.sqlite3`) | **179 filas**, todas `surface/surface`, **36,9 MB** declarados |
| Directorios de superficie SIN fila | **19**, con **81,7 MB** — el 69 % de los bytes del único kind indexado también es invisible para el prune |
| Filas cuyo `size_bytes` no casa con el disco | 21 de 179 (diferencias pequeñas, ±15 KB) |
| Techo del prune | `SUM(size_bytes)` del manifest (`manifest-db.ts:236`) contra `cache_max_bytes` |

**Lectura**: el prune decide sobre 36,9 MB cuando en `cache/` hay 207,6 MB de arte. La parte de #376
(89 MB de lo más caro, sin índice) es la mitad conocida; los 81,7 MB de superficies huérfanas son un
hallazgo NUEVO de hoy que el crítico debe encuadrar — puede ser suciedad local de esta máquina, puede
ser una vía de escritura que no registra, y la diferencia importa: lo primero no es issue, lo segundo
sí.

> **Crítica: defecto real, pequeño, y issue aparte.** Los 19 huérfanos son **todos** `atlas_<16hex>`
> con `page0.png…pageN.png`, escritos a propósito por `remote_generation.py:177-183` con
> `surface_cache.get_path(...)` + `write_bytes`, saltándose `AssetCache.put()` — el único sitio que
> llama a `register()`. El prefijo hace el nombre de 22 caracteres, así que **nunca** casará con un
> hash de 16 hex y nunca podrá tener fila. El índice no miente al revés: los 179 dirs con forma de
> hash tienen todos la suya. Se abre como issue propio y solo se arregla dentro de esta tanda si cae
> en la misma línea.

## Criterios de aceptación de la tanda

1. Cambiar `keyframes` o `play_fps` de una anim en `nefan-core/data/sprite-set.json` cambia la clave
   del arte que depende del perfil, y hay un test que se pone rojo si el perfil deja de entrar. La
   decisión de DÓNDE entra (base o vestido) está escrita con su razón.
2. Los sheets vestidos y los heroes tienen dueño: o índice con su prompt, o un prune que los ve. En
   cualquiera de los dos casos, heroes y frames se pinan y se recortan JUNTOS — no puede quedar un
   hero sin sus frames ni al revés, y hay candado de eso.
3. Existe un override por entorno para la ruta del manifest, y el negativo de `verificarSoloSurface`
   se prueba contra una DB temporal, ejerciendo `server.ts:11-22` (hoy sin un solo test). *(Corregido
   por la crítica: «ningún test toca la DB real» ya es cierto hoy, no es trabajo de esta tanda.)*
4. Nada de esto gasta créditos al verificarse, ni en local ni en CI.
5. La deuda no crece: `npm run verify` verde, `npm run deuda` sin ítems nuevos sin dueño, y el CRAP
   de lo que se toque no sube.
6. Si algo se retira (un almacén, un campo, una vía de escritura), no queda rastro: `grep` a cero en
   código, prosa y docs, y candado de reaparición si tiene sentido.

## Avisos para el crítico

- **Verificar la premisa de cada uno de los tres**: los issues de este repo caducan en horas. #375 y
  #376 nacieron el 2026-09-01 del plan de #373/#374 y no se han vuelto a mirar; #391 es del QA de T4
  (2026-09-02). Entre medias han pasado T5, T6 y T7, que tocaron el asset-store (#257/#394 dejó el
  kind único) y el contrato del wire.
- **La decisión cara de la tanda es la de #376** («entran en el manifest» vs «el prune aprende a
  verlos»), porque una paga el peaje del tipo y la otra no. La casa tiene dos reglas que tiran en
  direcciones distintas: «la garantía va en el tipo» (hacer inexpresable el estado malo) y «ningún
  kind sin productor». Decidir con razón escrita, no por comodidad.
- Ojo al orden: #391 da la palanca para probar el store sin tocar la DB real, así que probablemente
  va PRIMERO aunque sea el issue menor — sin él, verificar #376 exige el workaround que #391 existe
  para matar.
- El troceo en PR es tuyo: T7 salió mejor en tres PR con dos ingenieros en paralelo que en una
  apilada. Si #375 y #376 son independientes de verdad, dilo y se hacen a la vez.
- Los 81,7 MB de superficies huérfanas: encuadrar, no absorber en silencio. Si es un defecto real,
  issue con su medida.
