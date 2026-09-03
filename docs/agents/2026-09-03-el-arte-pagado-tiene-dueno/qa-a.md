# QA — PR A · #391 · override de la ruta del manifest

Validado el 2026-09-03 en `.claude/worktrees/t8-qa-a` (detached en `376c0c7`), contra `main` = `233b7b4`.
Cero créditos: nada de lo ejecutado llama a fal, Meshy ni sprite-forge.

**Veredicto: APTO CON RESERVAS.** El criterio literal de #391 se cumple entero y los tres candados del
ingeniero se ponen rojos de verdad (los repetí uno por uno). Las reservas son dos: el mensaje de
fail-loud no dice **de qué índice** habla justo ahora que el índice es variable —y por eso el test
negativo puede dar verde por el motivo equivocado—, y la desviación 3 está **mal justificada**: el
`fetch` entre procesos funciona en una terminal normal, así que el positivo sí podía comprobar que el
store *sirve*, no solo que imprime «listening».

## Integridad de la DB real

`cache/manifest.sqlite3` del checkout principal, al empezar y al terminar mi pasada:

| | md5 | tamaño | mtime | filas |
|---|---|---|---|---|
| antes | `6f31ca09d351a4fe17a3e710629a8524` | 143360 | 1788444792 | 179, todas `surface/surface` |
| después | `6f31ca09d351a4fe17a3e710629a8524` | 143360 | 1788444792 | idem |

Byte a byte idéntica. No la abrí en escritura ni la copié fuera.

## Criterios

| Criterio | | Evidencia |
|---|---|---|
| «Existe el override» | ✅ | `services/asset-store/config.ts` → `rutaDelIndice()`. Absoluta pasa intacta, relativa se resuelve contra la raíz del repo. Flujo real, con la forma EXACTA de `start.sh:434` y la variable exportada en el shell: `exec env NEFAN_ASSET_STORE_PORT=0 npx tsx services/asset-store/server.ts` → `exit=1` sobre `/tmp/tmp.ilsv5RWAda/sucia.sqlite3` |
| «…arranca el server contra una DB temporal con una fila ajena…» | ✅ | `test/asset-store-server.test.ts` 5/5 verde; `qa/el-indice-del-store-…` lo repite sobre el entry real y afirma además el kind centinela |
| «…y afirma el `exit 1` y el mensaje» | ✅ | `code=1`; stderr con `kinds SIN productor`, `texture (albedo 1)` y `scripts/manifest-solo-surface.ts`. Reproducido a mano y en el guion |
| «la DB real no se toca en ningún test» | ✅ | **Control positivo**, no lectura de código: sembré un centinela con una fila ajena en `<worktree>/cache/manifest.sqlite3` (md5 `3b5cac65…`), corrí la suite ENTERA → **1955 verde** y el fichero **byte-idéntico**. Si algún test lo abriera, el veredicto lo habría tumbado |
| Ejercer `server.ts:11-22`, hoy sin un solo test *(criterio 3 de la tanda)* | ✅ | Quitando el `process.exit(1)` cae exactamente 1 test y 2 checks del guion. Antes de esta PR no había nada que lo tocara |
| `npm run verify` verde | ✅ | `tests 1955 · suites 361 · pass 1955 · fail 0` — coincide con el informe |
| Deuda no crece | ✅ | `npm run deuda` → **75 items = 15 fronteras + 11 CRAP + 49 mutación**, idéntico a lo declarado. `crap --check`: «Tope CRAP ≤ 73 — 0 por encima · objetivo ≤ 30 — 7 por encima · cobertura 89.1% · ✔ dentro de los umbrales» |
| Mutación | ✅ | `npm run afectado`: `config.ts` → ninguno; el test → ninguno. No hay nada que pedir |
| Cero créditos | ✅ | Solo `npm test`, `tsx` local y el asset-store contra ficheros temporales |
| El positivo comprueba que el store SIRVE | ❌ | Solo afirma que imprimió «listening». Ver hallazgo 2 — y el guion suelto lo cubre |
| El negativo distingue de QUÉ índice salió el `exit 1` | ❌ | Ver hallazgos 1 y 4 |

### Los tres candados, repetidos por mí

| Rompo | Esperado | Medido |
|---|---|---|
| `dbPath: abs(ai.manifest_db)` (sin leer el env) | los 5 | **5 rojos** (`pass 0 fail 5`) |
| sin `process.exit(1)` en `server.ts` | solo el negativo | **1 rojo** (`pass 4 fail 1`) |
| sin la guarda del valor en blanco | los dos del blanco | **2 rojos** (`pass 3 fail 2`) |

Coinciden exactamente con lo declarado. El candado se puede poner rojo.

### La desviación 1, medida

Reproducida **literalmente**, quitando la guarda y arrancando el entry real:

- `NEFAN_MANIFEST_DB="  "` → crea un fichero llamado **dos espacios** en la raíz del repo
  (`-rw-r--r-- 32768 '\ \ '`) y el store **arranca**: `índice /…/t8-qa-a/   (0 entradas, 0 bytes)` +
  `listening`. Con la guarda: `exit 1` nombrando la variable y **cero ficheros nuevos**.
- `NEFAN_MANIFEST_DB=""` → `Error: unable to open database file`, `exit=1`, sin nombrar la causa.
- `NEFAN_MANIFEST_DB=$'\t'` → igual que los dos espacios (fichero llamado tabulador, arranque).

**La desviación está bien traída**: la medida que la justifica es cierta, y los ficheros basura
quedaban además *visibles en `git status`* (`?? "  "`), a un `git add -A` de entrar en un commit.

## Hallazgos

### 1 · IMPORTANTE — el fail-loud no dice de QUÉ índice habla, y ahora el índice es variable

`services/asset-store/solo-surface.ts:41-48` redacta el veredicto sin `dbPath`, y aconseja
`mv cache/<dir> archivo/cache/<dir>` — una ruta **literal** que con un override es falsa. Hasta esta PR
solo había un índice posible y no hacía falta decirlo; a partir de esta PR hay dos, y el mensaje sigue
hablando como si hubiera uno.

Repro desde el arranque:
```bash
cd nefan-core
export NEFAN_MANIFEST_DB=$(mktemp -d)/sucia.sqlite3   # con una fila texture/albedo
exec env NEFAN_ASSET_STORE_PORT=0 npx tsx services/asset-store/server.ts
```
```
asset-store: el índice tiene 1 filas de kinds SIN productor — no arranco.
   texture (albedo 1): 1 filas, 7.0 MB
   Archiva sus blobs (mv cache/<dir> archivo/cache/<dir>) y purga las filas con
   …
```
Qué esperaba quien lo lee: saber **qué** fichero rechaza, sobre todo cuando acaba de apuntarlo a otro
sitio a propósito. Arreglo barato: meter `cfg.dbPath` en la primera línea (el camino feliz ya lo hace:
`asset-store: índice <path> (…)`) y derivar el consejo `mv` de `surfaceDir` en vez del literal.

### 2 · IMPORTANTE — la desviación 3 no es del sandbox: la línea de arranque miente con puerto efímero

`services/asset-store/http-server.ts:77` imprime `opts.port`, **no** `server.address().port`. Con
`NEFAN_ASSET_STORE_PORT=0` el log dice `listening on http://127.0.0.1:0` mientras el proceso escucha
de verdad en otro puerto (medido: `ss` lo situó en 33029). Esa URL no es llamable, y es lo que
explica el síntoma que el ingeniero atribuyó al sandbox.

Desmentido, en mi terminal, contra ese servidor:

| | resultado |
|---|---|
| `fetch` desde OTRO proceso a `127.0.0.1:33029/health` | `OK 200 {"ok":true,…}` en **30 ms** |
| `curl -m 5 http://127.0.0.1:33029/health` | `{"ok":true,…}`, exit 0 |
| `fetch` a `127.0.0.1:0/health` (lo que dice el log) | `TypeError fetch failed` en 26 ms |

O sea: el `fetch` entre procesos funciona, y el positivo **sí podía** comprobar `/health`. Lo que
faltaba era un puerto real, no un permiso del sandbox. `qa/el-indice-del-store-…` lo hace: pide un puerto libre
al kernel y afirma que `/health` devuelve `total_count`/`total_bytes` **del índice de la variable**.

Impacto más allá de esta PR: §7 del plan pide para la PR C «el store arranca con los tres kinds y
`/assets?asset_type=sprite_hero` contesta». Con puerto efímero eso no se puede seguir desde el log.

### 3 · MENOR — `NEFAN_MANIFEST_DB` no está documentada en ningún sitio que alguien vaya a mirar

`grep` en `*.md`, `*.sh` y `*.json`: la única aparición fuera del código es el `qa.md` de T4 que la
pidió. Sus dos precedentes citados sí están escritos donde se buscan:

| | `CLAUDE.md` | `start.sh` | `docs/arquitectura/ia-servicios.md` |
|---|---|---|---|
| `NEFAN_GAMES_DIR` / `NEFAN_SAVES_DIR` | sí | sí | sí |
| `NEFAN_MANIFEST_DB` | no | no | no |

La variable existe para dar palanca **al próximo QA**. Una palanca que solo se descubre leyendo
`services/asset-store/config.ts` es media palanca; el QA de T4 tuvo el workaround precisamente por no
encontrar una.

### 4 · MENOR — el test negativo no discrimina de qué DB salió el `exit 1` (corolario del hallazgo 1)

Sus asserts (`kinds SIN productor`, `texture (albedo 1)`, el script de purga) los satisface igual de
bien el índice del **checkout**. Medido: con el override revertido **y** un `cache/manifest.sqlite3`
sucio en el checkout, ese test concreto pasa a **VERDE** por el motivo equivocado:

```
✖ sin la variable, el índice del checkout; con ella, el que diga
✖ puesta pero en blanco …
✔ con una fila de un kind sin productor: exit 1, el motivo y el script de purga   ← falso verde
✖ con el índice limpio arranca …
✖ con la variable en blanco no arranca …
   pass 1  fail 4
```

La suite entera sigue roja (los otros 4 lo cazan), así que **no es bloqueante**; pero ese test, solo,
no prueba lo que dice probar. Cierre barato, el que usa el guion suelto: sembrar un kind centinela
(`qa_centinela/solo-de-este-guion`) que ningún checkout puede tener, y afirmarlo.

### 5 · OBSERVACIÓN — el rastro de `cache/manifest.sqlite3` en `t8-a`: no entra en la PR

Confirmado: `.claude/worktrees/t8-a/cache/manifest.sqlite3`, 32.768 bytes, 0 filas, y `git status`
limpio ahí (está gitignorado). **No puede colarse en la PR.** Lo reproduje solo: basta correr la
suite con el override roto para que `ManifestDb` (`mkdirSync` + `DatabaseSync`) cree el índice del
checkout desde cero.

Sobre «¿puede colarse en un checkout de otro?»: la conducta es de `ManifestDb` y es **anterior** a
esta PR — cualquier arranque del store sin índice lo crea vacío. Lo que esta PR hace es **reducir**
la ocasión (con la variable puesta ya no se toca el del checkout). El desenlace feo que queda es
ajeno a la PR: un store arrancando sobre un índice vacío recién creado sirve 0 entradas sin quejarse.
Si se quiere cerrar, es issue aparte y va con el hallazgo 1.

### 6 · OBSERVACIÓN — «callado» es impreciso en el comentario de `config.ts`

Con `"  "` el store no es silencioso: imprime `asset-store: índice /…/t8-qa-a/   (0 entradas, 0 bytes)`.
Es **ilegible**, no mudo — el nombre del fichero son dos espacios. La sustancia de la desviación la
confirmo entera; sobra solo el adjetivo.

### 7 · OBSERVACIÓN — interacción nueva con el script de purga

`scripts/manifest-solo-surface.ts:221` llama `loadAssetStoreConfig(process.env)`, así que **hereda el
override**, y la precedencia es la correcta (`parsed.db ?? cfg.dbPath`: la flag `--db` gana). Pero
`--cache` y `--archivo` no se overridean: con `NEFAN_MANIFEST_DB` exportada, la guardia 1 inspecciona
el `cache/` **real** mientras el script purga filas de **otra** DB. No es destructivo (no mueve blobs;
la guardia exige archivarlos a mano antes), pero las dos mitades pueden apuntar a mundos distintos y
nadie lo dice. Digno de una línea en el `--help`, no de un arreglo.

## El guion que nace

`qa/el-indice-del-store-se-prueba-sin-el-del-checkout.mjs` — **18 comprobaciones, verde**,
tanto con harness como dentro de la batería real (`node qa/run.mjs 70`, preset `e2e-sin-creditos`).

Arranca el **entry real** (`services/asset-store/server.ts`, el mismo que lanza `start.sh:434`) como
proceso hijo contra índices de usar y tirar, y mira con qué sale: el negativo (`exit 1` + mensaje +
kind centinela), el positivo (arranca, nombra la DB de la variable **y `/health` contesta por HTTP
desde otro proceso** con su recuento), el blanco (`exit 1` + sin basura en la raíz) y que el índice
del checkout no se toca (mismo tamaño y mtime, o sigue sin existir).

Seguridad: `sinMotor` declarado, cada caso con su `mkdtemp`, **el puerto lo elige el kernel** (ningún
número del catálogo escrito a mano, `nadie-inventa-un-puerto` respetada) y el hijo se mata **por su
PID**, nunca por puerto ni por nombre.

**Probado en negativo** (obligatorio, y hecho):

| Rompo | Checks en rojo |
|---|---|
| `dbPath: abs(ai.manifest_db)` | **14 de 18** — incluido «aparecieron: `["cache"]`» y el índice del checkout tocado |
| sin `process.exit(1)` en `server.ts` | **2** (bloque 1: `exit 1` y «muere antes de escuchar») |
| sin la guarda del blanco | **4** (bloque 3, incluido «aparecieron: `["  "]`») |

**Nota de ubicación para el coordinador**: lo puse en `qa/guiones/` con el número 70 como se me pidió,
y ahí funciona. Pero `qa/README.md` documenta la convención contraria para exactamente esta forma —
`sprites-sin-servicio.mjs` vive fuera de `guiones/` «porque el runner arranca UN stack con navegador y
se lo pasa a todos, y esto necesita arrancar y MATAR un servicio, sin navegador ninguno». Mi guion es
justo eso: no toca la página. En `guiones/` cada corrida de la batería paga un arranque de Chromium
para un check que no lo necesita. Mover a `qa/` es un `git mv` y quitar el `export const sinMotor`;
lo dejo a tu criterio.

> **Resuelto (coordinador, 2026-09-03): se muda.** Vive en
> `qa/el-indice-del-store-se-prueba-sin-el-del-checkout.mjs`, sin número y sin `sinMotor`, con su
> sección en `qa/README.md` («El sexto ejecutable»); las rutas de este informe se actualizaron con
> él. Al mudarlo se volvió a medir: **17 comprobaciones** (no 18) en verde con salida 0, y con el
> override revertido **12 en rojo** con salida 1. Los hallazgos 1, 2 y 3 los arregló el ingeniero en
> la misma rama; el 4 lo cierra este guion con su kind centinela.

## Workarounds usados

| Workaround | ¿Afecta al usuario? |
|---|---|
| Enlazar `node_modules` (nefan-core, narrative-mcp, qa, nefan-html) en el worktree de QA | **No es hallazgo.** Un worktree nace sin dependencias; es setup, no producto. Ojo: la primera pasada dio 1 rojo (`contract-fixtures.test.ts`) y 1879 tests **por esto**, no por la PR — necesita `npm run build` y `@nefan/core` resoluble. Con el entorno completo, `npm run verify` da 1955/0 |
| Sembrar las DB temporales con `node --import tsx -e` importando el `ManifestDb` real | No es workaround del producto: es fabricar el dato de entrada con el esquema de verdad |
| **Ninguno para observar la feature** | La feature se observó por su camino real: variable de entorno + entry real, con la forma exacta de `start.sh:434`. El workaround de T4 (exportar el árbol entero) queda muerto |

## No probado

- **`./start.sh` de punta a punta con el override.** Ningún preset arranca el asset-store solo (`play`
  pide Claude Code y servicios de imagen; `e2e-sin-creditos` no lo incluye), y no iba a levantar eso
  por una variable. En su lugar verifiqué la **forma exacta** de la línea 434 con la variable
  exportada (→ `exit=1` sobre la DB temporal) y la semántica de `env VAR=x cmd`, que **hereda** el
  resto del entorno (`FOO=heredado BAR=puesto`). Es sólido, pero no es la corrida del launcher.
- **CI.** Otro sistema de ficheros y sin caché; el hook `ci-verde.sh` es quien tiene que decirlo.
- **Mutación.** No procede: `npm run afectado` dice que ninguna batería carga `config.ts` en runtime.
