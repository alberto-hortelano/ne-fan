# QA — PR C (#376): el arte de personaje entra en el manifest, con su prompt y pineado

Validado el 2026-09-03 en `.claude/worktrees/t8-qa-c` (detached en `f4657e4`), contra el **criterio
literal del issue** y la petición original (`requisitos.md`), no contra el plan. **Cero créditos**: ni
una llamada a `/identity`, `/skins`, fal ni Meshy; el ledger de gasto del checkout principal quedó con
mtime 2026-09-02, sin tocar.

**Integridad del checkout principal** (comprobada al empezar y al terminar):

| | md5 de `cache/manifest.sqlite3` | heroes | `cache/sprite_sheets` |
|---|---|---|---|
| antes | `6f31ca09d351a4fe17a3e710629a8524` | 60 | 59 MB |
| después | `6f31ca09d351a4fe17a3e710629a8524` | 60 | 59 MB |

Ni un `rm` ni un `mv` sobre `cache/` ni `archivo/`. El barrido sigue sin ejecutarse.

**Veredicto: APTO CON RESERVAS.** Lo central del issue está hecho y probado donde importa: los dos
kinds entran con su prompt, el store los pina al registrarlos en una transacción, un solo `DELETE`
los suelta juntos, el prune borra el blob correcto de cada layout, respeta los pines y es fail-loud
con un `type` que no conoce. Las reservas son tres y ninguna rompe la funcionalidad: **la garantía
del pin solo está en el tipo por el lado del hero** (un `sprite_sheet` acepta el `character_ref` de
otro personaje), **el registro del hero contra el zod real no lo ejerce ningún test de la PR** (el
fake de pytest no valida y el único check del flujo real que lo nombra lo satisface igual un registro
roto), y el `hash` del registro no tiene forma mientras el prune borra recursivamente lo que ese hash
nombre.

Y una conclusión que el informe deja a medias y que cambia la lectura del barrido: **archivar los 53
heroes no le cuesta un repago a ninguna partida** — están huérfanos por clave desde el 2026-08-24,
diez días antes de esta PR. Medida abajo.

---

## Criterios

| # | Criterio (literal del issue / de la tanda) | | Evidencia |
|---|---|---|---|
| 1 | «Los sheets vestidos y los heroes entran en el manifest del asset-store **con su prompt**» | ✅ | `qa/el-arte-de-personaje-no-se-pina-a-medias.mjs`, contra el entry REAL: `/assets?asset_type=sprite_hero` devuelve `{hash, prompt:"Blas, el tabernero"}` y `by_hash` trae el `extra` entero (`character_ref, model, angle, ai_model`). Y desde el productor de verdad: llamé `registrar_arte_de_personaje` (Python) contra el store real → dos filas, las dos con prompt |
| 2 | «…**con pin simultáneo de heroes y frames**» | ✅ | Mismo guion: los dos hashes salen en `pinnedHashes` tras registrar, sin que nadie pine aparte; `db.registrarPineado` mete fila y pin en UNA transacción (`manifest-db.ts:172-178`) |
| 3 | «…un hero sin sus frames (o al revés) es arte pagado que ya no sirve» → **se sueltan juntos** | ✅ el camino real · ❌ el estado sigue siendo expresable por el lado del sheet | `DELETE /assets/pin/character:{hero}` → `{"removed":2}`. Pero un `sprite_sheet` con el `character_ref` de OTRO hero es **200** → hallazgo 1 |
| 4 | «registrado sin pin» deja de ser EXPRESABLE (no vigilado) | ✅ | Intentado por HTTP de las dos formas: sin `extra` → 400 y sin fila; con `extra` presente y sin la clave → 400 y sin fila. Probado en negativo: poniendo `character_ref` opcional, el check del sheet se pone rojo |
| 5 | «hero pineado bajo el ref de otro» deja de ser expresable | ✅ | `POST /assets` con `hash=aaaa…1`, `character_ref=bbbb…2` → 400 `un sprite_hero se pina bajo su propio hero_key`. Sin el `superRefine`: 2 rojos |
| 6 | «arte de personaje sin procedencia» deja de ser expresable | ✅ | `prompt:""` en los dos kinds → 400; `surface` con prompt vacío sigue siendo 200 (la regla es del kind y no un endurecimiento global) |
| 7 | El prune borra el blob correcto de **cada** kind (layouts distintos) | ✅ | Techo de 1 byte, dirs temporales: se borra el DIRECTORIO de la surface, el DIRECTORIO del sheet y el **FICHERO** `heroes/{key}.png`; la carpeta `heroes/` sigue en pie con el hero vecino intacto. Con `rutaDeBlob` tratando al hero como directorio: rojo |
| 8 | El prune respeta los pines | ✅ | Mismo techo con `keep = db.pinnedHashes()` → `pruned: 0`, hero y frames en disco. Y por HTTP el handler une pins ∪ keep-list (`http-server.ts:143`) |
| 9 | Un `type` que no conoce: ¿fail-loud o `continue` callado? | ✅ fail-loud | Lanza `el índice tiene una fila de type "texture" (hash zzz)… purga el índice antes de podar` **y no desindexa la fila**. Cambiándolo a `continue`: rojo |
| 10 | El **cache-hit** registra hero y sheet (hoy `cached=True` volvía sin registrar) | ✅ | `node qa/sprites-sin-servicio.mjs` VERDE 6/6 con el stack real y sprite-forge muerto a media prueba: «el cache-hit dejó el sheet apuntado con su prompt». Negativo mío sobre el endpoint (`if not cached:`): **2 rojos** (`test_TAMBIEN_en_cache_hit_se_indexa`, `test_un_sheet_sin_hero_en_disco…`), los mismos que declara el informe |
| 11 | …y no duplica filas al repetir | ✅ | 4 registros del mismo sheet → **una** fila (`INSERT OR IGNORE` sobre `UNIQUE(hash,type,subtype)`); pins idempotentes por PK |
| 12 | El registro del HERO, contra el zod real, en algún test | ❌ | `StoreFalso` (pytest) acepta cualquier payload; el guion nunca tiene hero en disco, así que su check verde («no se inventó la fila del hero») lo satisface igual un registro roto → hallazgo 2. Lo ejercí yo y **funciona**; lo que falta es el candado |
| 13 | `npm run verify` verde | ✅ con matiz | `1962 pass / 6 fail`; los 6 son `test/contract-fixtures.test.ts` y **fallan idénticos en el checkout principal** (`7b817b9`, sin esta PR): artefacto de entorno, no de la PR. Total **1968**, la cifra del informe |
| 14 | Python + ruff | ✅ | `Ran 200 tests … OK` · `ruff: All checks passed!`. Cifras del informe, recontadas |
| 15 | CRAP no sube; `handle` no se trocea porque BAJA | ✅ | `1233 funciones · cobertura 89.3% · CRAP ≤ 73: 0 por encima · ≤ 30: 7`. `handle · services/asset-store/http-server.ts:97` → **43.9 (43, 92%)**, era 49.2 |
| 16 | `npm run deuda` sin ítems nuevos sin dueño | ✅ | `Deuda PARCIAL — 75 items de 2 de 3 fuentes. Sin medir: mutación` = **15 fronteras + 11 CRAP + 49 mutación**, idéntico a antes. La cabecera no esconde deuda: los tres bloques se listan con su recuento (ver observación 7) |
| 17 | El motivo escrito de `asset-store.ts` en `sin_mutar` era ya FALSO | ✅ | Decía «ningún test lo tiene por sujeto: medirlo solo daría mutantes NoCoverage». Hoy el fichero tiene lógica (`esAssetKind`/`esKindDePersonaje`/`esArteDePersonaje`/`refDeArteDePersonaje`) y `test/asset-store.test.ts` la importa y **la afirma literalmente** (`assert.equal(ref, \`character:${HERO}\`)`, no como oráculo de sí misma), y los predicados los matan los tests del cable HTTP. Sacarlo de `sin_mutar` es correcto |
| 18 | Sin rastros: prosa a cero | ✅ con una cifra mal declarada | `almacén paralelo`, `fuera del prune`, `sin manifest y sin touch`, `solo-surface`, `manifest-solo-surface`: **cero** en el ámbito candado. `CLAUDE.md:269` reescrito. La regla nueva la probé en negativo: metí la frase en `prune.ts` → `✖ [error] el-arte-de-personaje-no-es-un-almacen-paralelo`. Pero `"ÚNICO kind"` NO está a cero como declara el informe → hallazgo 5 |
| 19 | Cero créditos | ✅ | Nada de lo ejecutado toca `/identity` ni `/skins`; el guion arranca sprite-forge con `--sin-skin`; el resto es `node`, `tsx`, SQLite temporales y una llamada a la función de registro |
| 20 | El barrido: 7 nombrables / 53 sin procedencia | ✅ cifras · ⚠️ no ejecutado (es del coordinador) | Recontado por mí con `censar()` sobre el disco real, en solo lectura: **7 nombrables (0,10 MB) · 53 sin procedencia (61,46 MB)**. Idéntico |

---

## Los 53 heroes: ¿archivarlos le cuesta un repago a una partida viva?

**No. Cero.** Y no por parecido: el `hero_key` de hoy **no puede producir el nombre de ninguno de
ellos**, así que ninguna petición viva los va a encontrar aunque se queden donde están.

La cadena de medidas, todas mías:

1. **Reparto por fecha** de los 60 PNG (`stat`): 50 ficheros y **61,42 MB** son de julio y del
   17-18 de agosto (0,32–2,04 MB cada uno, tamaño de hero-shot real); los otros 10 son todos del
   **2026-08-24** y pesan **12,9–14,6 KB** — el pipeline `fake`. De esos 10, 7 son los nombrables.
2. **La fórmula de la clave cambió el 2026-08-24**, en `a31a6f4` (#253, «La generación de sprites de
   personaje sale a un proyecto independiente»). Antes:
   `prompt, base_model, ai_model, style_key, angle, "hero_v2", devcache`. Hoy:
   `prompt, model, angle, ai_model, style_key, "heroforge_v3", devcache`. Cambió **el token de
   versión y el orden de los campos**: ningún nombre de la era anterior es alcanzable hoy.
3. **Confirmación criptográfica**, no argumento por fechas: recompuse la fórmula RETIRADA con los
   `meta.json` de `archivo/` y `42dd1866efecd7f5.png` (1,07 MB, 18-ago) sale exacto — es
   *«pastor trashumante con manta de lana a cuadros y cayado»*, `angle: isometric_30`. O sea que al
   menos uno de los 53 está demostrado que lo nombró la fórmula muerta.
4. **Y la vista tampoco vuelve**: de los 151 `meta.json` legibles, **124 son `isometric_30`** (la
   oblicua, retirada el 2026-08-21) y 27 `frontal_8` (los 27 sheets que archivó la PR B).

**Lectura para el coordinador.** Los 61,46 MB no son «arte que servía y tiramos»: son arte que
**quedó inalcanzable el 2026-08-24 por el bump de #253**, y lo único que hace esta PR es sacarlo de
la carpeta viva y decirlo. La diferencia importa para la decisión: no hay riesgo 4 del plan («el
barrido se lleva algo que valía»), porque no queda nada que un `/skin_sprite_sheet` pueda pedir. Y
los 3 sin procedencia que sí son de la era actual pesan **41 KB** y salieron del pipeline `fake`
(`cost_usd: 0`).

El informe dice «arte que SÍ se pagó y cuyo prompt es irrecuperable»: lo primero es cierto y honesto,
lo segundo es **falso para al menos uno** (el pastor de arriba) y, sobre todo, se queda corto — lo
que zanja el asunto no es que no se sepa el prompt, es que **la clave ya no existe**. Merece una
línea en la salida del guion y en el informe, porque si no, alguien volverá a preguntarlo dentro de
un mes.

Ejecuta el barrido con tranquilidad. La única precaución es la del hallazgo 4: esa misma regla, en un
checkout donde se haya jugado **con pack de estilo**, sí archivaría arte alcanzable.

---

## Hallazgos

### 1 · IMPORTANTE — la garantía del pin solo está en el tipo por el lado del hero: un `sprite_sheet` acepta el `character_ref` de otro personaje

El commit y el informe afirman que «"registrado sin pin", **"hero pineado sin sus frames"** y "arte
de personaje sin procedencia" dejan de ser estados expresables». Lo primero y lo tercero son ciertos
y los he ejercido. Lo segundo está garantizado **solo para el hero** (`hash === extra.character_ref`,
`request-schemas.ts:206-221`): del lado de los frames, `character_ref` es un string libre y nadie
comprueba que nombre a un hero que exista.

Repro, desde el arranque (asset-store real contra un índice de usar y tirar; el puerto lo dice su
línea de arranque):

```bash
cd nefan-core
NEFAN_MANIFEST_DB=$(mktemp -d)/i.sqlite3 NEFAN_ASSET_STORE_PORT=0 \
  node --import tsx services/asset-store/server.ts
# hero A + su sheet · hero B + su sheet, pero el sheet de B declara el ref de A
POST /assets  {hash:"aaaaaaaaaaaaaaa1", sprite_hero,  extra:{character_ref:"aaaaaaaaaaaaaaa1"}}
POST /assets  {hash:"1111111111111111", sprite_sheet, extra:{character_ref:"aaaaaaaaaaaaaaa1"}}
POST /assets  {hash:"bbbbbbbbbbbbbbb2", sprite_hero,  extra:{character_ref:"bbbbbbbbbbbbbbb2"}}
POST /assets  {hash:"2222222222222222", sprite_sheet, extra:{character_ref:"aaaaaaaaaaaaaaa1"}}   ← el de B
DELETE /assets/pin/character:aaaaaaaaaaaaaaa1
DELETE /assets/pin/character:bbbbbbbbbbbbbbb2
```

Medido, literal:

```
sheet de B CON EL REF DE A -> 200
DELETE character:aaaaaaaaaaaaaaa1 -> {"ok":true,"removed":3}   ← se lleva los frames de B
DELETE character:bbbbbbbbbbbbbbb2 -> {"ok":true,"removed":1}   ← solo su hero
```

O sea: soltar el personaje A desprotege arte de B, y soltar B deja sus frames pineados bajo A. Eso
es literalmente «un hero sin sus frames», que es la frase del issue.

*Qué esperaba*: que el mismo tipo que impide un hero bajo el ref ajeno impida un sheet bajo un ref
que no tiene hero. No es teórico para el estado del índice: el único productor (`remote_generation.py`)
sí registra el sheet **sin** hero cuando el blob del hero no está —a propósito y bien—, así que
«frames pineados bajo un ref sin hero» es un estado NORMAL del índice y no hay nada que distinga ese
caso legítimo del error. *Arreglo posible*: exigir en el handler que un `sprite_sheet` cuyo
`character_ref` ya tenga fila de hero case con ella, o dejar escrito —en el contrato, no en el
informe— que la garantía cubre el hero y el «se sueltan juntos», y **no** «un sheet no puede colgar
de otro». Hoy el contrato promete lo segundo (`asset-store.ts:63-67`).

### 2 · IMPORTANTE — el registro del HERO no lo ejerce ningún test contra el zod real; el único check verde que lo menciona lo satisface igual un registro roto

Tres coberturas, y las tres esquivan el mismo trozo de cable:

- **pytest**: `StoreFalso.register()` (`test_sprite_forge_adapter.py:311-330`) guarda el payload y no
  lo valida. Un `extra` sin `character_ref`, un `type` mal escrito o un `size_bytes` negativo pasan
  igual de verdes.
- **`qa/sprites-sin-servicio.mjs`**: sí habla con el store real, pero su sujeto plantado **no tiene
  hero en disco**, así que la rama del hero nunca se ejecuta. Su check es
  `y no se inventó la fila del hero que no está en disco` → `heroes.length === 0`, que se cumple
  igual de bien si el registro del hero está roto. Es el hallazgo 4 del QA de la PR A repetido: un
  assert satisfecho por la causa equivocada.
- **`test/asset-store.test.ts`**: ejercita el zod de verdad, pero con payloads escritos a mano en TS,
  no con el que compone Python.

Lo probé end-to-end yo (`registrar_arte_de_personaje` con `manifest=AssetStoreClient(url_real)` y un
hero de verdad en un árbol temporal) y **funciona**: dos filas, `extra` completo, y un solo `DELETE`
devuelve `removed: 2`. O sea que no hay bug hoy — lo que no hay es candado. Si la forma del payload
deriva, el jugador se entera con un 502 y un NPC en maniquí, porque el registro es fail-loud en los
dos caminos.

*Arreglo barato, en el sitio donde ya está el fontanero*: que `sprites-sin-servicio.mjs` plante
también `heroes/{hero_key}.png` y afirme la fila del hero. Son dos líneas y convierte un check que
hoy no puede ponerse rojo en el candado del cable más caro de la PR.

### 3 · MENOR (pero es el que más caro sale si toca) — el `hash` del registro no tiene forma, y el prune borra recursivamente lo que ese hash nombre

`registroBase.hash` es `z.string().min(1)` para los tres kinds, y `prune` hace
`rmSync(rutaDeBlob(...), { recursive: true })`. Con `blobDirs.sprite_hero` **dentro** de
`blobDirs.sprite_sheet` (`config.ts:78-80`), una fila `sprite_sheet` cuyo hash sea `heroes` nombra la
carpeta entera de hero-shots. Medido con el `prune` real y dirs temporales:

```
=== D · un sheet cuyo hash es 'heroes' (aceptado por el zod) ===
heroes antes:  [ 'aaaaaaaaaaaaaaa1.png', 'bbbbbbbbbbbbbbb2.png' ]
prune:         { pruned: 1, freed_bytes: 999, total_bytes: 0 }
heroes DESPUÉS: EL DIRECTORIO heroes/ YA NO EXISTE
```

…con sus filas intactas en el índice: el estado exacto que #257 tardó meses en descubrir, y que este
prune presume de haber hecho imposible. Con `hash = "../../fuera-del-cache"` el borrado sale de
`cache/` entero (medido también).

La clase es **pre-existente** (`hash: z.string().min(1)` es idéntico en `HEAD~1` para `surface`), y
hoy no es alcanzable en la práctica: el único productor emite 16 hex, el store escucha en 127.0.0.1
y el arte de personaje entra **pineado**, así que no llega al prune mientras nadie suelte el ref. Lo
que esta PR añade es el anidamiento que convierte un nombre plausible (`heroes`) en autodestrucción.
*Arreglo*: la misma regex que ya usa el lector (`HERO_KEY_RE = /^[0-9a-f]{16}$/`, `blob-store.ts:84`)
en el `hash` del registro. El lector ya valida la forma de la clave; el escritor no — hoy se puede
indexar un `sprite_hero` con un hash que `GET /cache/sprite_hero/{key}` va a rechazar con
«Invalid filename».

### 4 · MENOR — «sin procedencia» significa «no recomponible con el `--style-key` que me diste», y el nombre promete más que la regla

Es el hallazgo 3 del QA de la PR B en otra forma. `arte_de_personaje.py` clasifica como «sin
procedencia» todo hero cuya clave no salga de un `meta.json` con `--style-key` (por defecto `""`).
Dos huecos, y el guion documenta uno solo:

- **El declarado**: un hero pintado con pack de estilo no se recompone. En un checkout donde se haya
  jugado con estilo, esa misma corrida archivaría arte **vivo y alcanzable** — y el mensaje diría
  «sin procedencia».
- **El no declarado**: un hero nombrado por la fórmula anterior a #253 tiene prompt **perfectamente
  recuperable** desde `archivo/`. Probado: `42dd1866efecd7f5` = «pastor trashumante con manta de lana
  a cuadros y cayado». La tabla lo enseña con el prompt en `—`.

En **este** disco no cambia la decisión (los 53 son inalcanzables igual, ver arriba), y archivar
—nunca borrar— lo mantiene reversible. Pero el rótulo de la columna y la frase «cuyo prompt es
irrecuperable» del informe no son ciertos, y son justo lo que alguien leerá dentro de tres meses.

### 5 · MENOR — la cifra del barrido de prosa no cuadra con lo declarado

El informe declara: «`grep -rn "solo-surface|manifest-solo-surface|ÚNICO kind|almacén paralelo|fuera
del prune"` fuera de `docs/agents/` y `archivo/` está **a cero**». Corrido literalmente, no lo está:

```
nefan-core/src/contracts/asset-store.ts:49: /** El ÚNICO kind que sirve el catch-all …
ai_server/routers/remote_generation.py:491: # un almacén paralelo: ni fila, ni prompt, ni dueño …
```

Las dos supervivientes son **frases nuevas y verdaderas** (la primera describe `KIND_BLOB_PLANO`; la
segunda está en pasado y `ai_server/**` está fuera del ámbito de la regla a propósito y con razón
escrita), así que el barrido está bien hecho: lo que falla es la cifra. Queda además una aparición
del nombre viejo, `verificarSoloSurface`, en el comentario histórico de `kinds-con-productor.ts:14`
que explica el renombrado — defendible, pero es el único rastro del nombre anterior y conviene
decidirlo a propósito y no por descuido.

---

## Observaciones

6. **Desviación 1 (meter el asset-store en `qa/sprites-sin-servicio.mjs`): bien traída, y el guion
   sigue midiendo lo suyo.** Corrido por mí: **VERDE 6/6**, con sprite-forge real muerto a media
   prueba, y las cuatro comprobaciones originales intactas y con el mismo sujeto («¿sobrevive el arte
   pagado a que sprite-forge esté caído?»). El store va contra un SQLite temporal
   (`NEFAN_MANIFEST_DB`) y el guion se **niega** si el puerto está ocupado en vez de matar a nadie.
   Lo único que cambia es que ahora hay un servicio más que puede tumbarlo por su cuenta; los
   mensajes distinguen el caso.

7. **La cabecera `PARCIAL` de `npm run deuda` no esconde deuda, pero se dice con la misma frase que
   «no has medido nada».** Verificado: 75 items = 15 + 11 + 49, idénticos a antes, y el bloque de
   mutación se lista entero con su aviso `sin medir 1 de 33 módulos … (sin medida previa)`. La
   pega es de forma: `Deuda PARCIAL … Sin medir: mutación` es literalmente lo que sale también
   cuando faltan las tres fuentes, y se quedará puesta hasta que alguien autorice la corrida. No es
   trabajo de esta PR; es una señal que conviene no dejar encendida mucho tiempo.

8. **Desviación 2 (502 en cache-hit con el store caído): ningún preset queda expuesto.** Los dos
   presets con remote-gen llevan asset-store (`PRESET_PROFILES`, `start.sh:766-768`); solo `Custom`
   puede combinarlos sin él, y ese caso **ya estaba roto en silencio** antes (los frames los sirve el
   asset-store: sin él las URLs del 200 estaban muertas). En el cliente el fallo degrada al modelo
   base con una entrada en el error-log (`character-sprites.ts:283-295`, «se mantiene la base
   y_bot»), no deja al jugador sin salida. El comentario de dependencias de `start.sh:762-764`
   explica por qué sprite-forge acompaña SIEMPRE a remote-gen y ya no dice lo mismo del asset-store,
   que desde hoy es igual de obligatorio: una línea ahí lo cerraría.

9. **`GET /assets` sigue devolviendo `total` global, no del kind filtrado** (`total: 7` con 2 filas
   de hero). Es pre-existente (`db.totalCount()`), pero ahora que hay tres kinds el número engaña
   más que antes a quien consulte «cuántos heroes tengo».

10. **Los 6 rojos de `contract-fixtures.test.ts` son ajenos**: reproducidos idénticos en el checkout
    principal (`7b817b9`), que no lleva esta PR. Total de la suite 1968, la cifra del informe.

---

## El ejecutable que nace

**`qa/el-arte-de-personaje-no-se-pina-a-medias.mjs`** (con su sección en `qa/README.md`, «El octavo
ejecutable»).

Vive **fuera de `qa/guiones/`**, que es la convención que esta tanda ya fijó con el sexto y el
séptimo: no toca la página, y en `guiones/` cada corrida de la batería pagaría un Chromium para un
check que solo arranca y para un servicio.

19 comprobaciones, ~8 s, cero créditos:

```
  ✔ sprite_hero sin extra / con extra pero sin la clave: 400 y sin fila   (×4, los dos kinds)
  ✔ un hero bajo el ref de OTRO personaje: 400
  ✔ prompt vacío en arte de personaje: 400 · y la superficie SÍ lo admite
  ✔ la fila del hero lleva su PROMPT y el extra entero · no promete cache_url
  ✔ el cache-hit se apunta en CADA servida y no duplica: una fila por kind
  ✔ un solo DELETE /assets/pin/character:… retira hero Y frames (removed=2)
  ✔ prune sin pins: DIRECTORIO de la surface, DIRECTORIO del sheet, FICHERO del hero
  ✔ y la carpeta heroes/ sigue en pie con el hero que no se podó
  ✔ prune con el pin del personaje: no toca ni el hero ni sus frames
  ✔ un type SIN productor es fail-loud, y la fila NO se desindexa
  ✔ el índice del CHECKOUT no se ha tocado en toda la corrida
```

Arranca el **entry real** del asset-store contra un `mkdtemp` (`NEFAN_MANIFEST_DB`), el puerto lo
elige el **kernel** (`NEFAN_ASSET_STORE_PORT=0`, y lee el puerto EFECTIVO de la línea de arranque
que arregló la PR A) y mata al hijo por su PID. El prune corre en un hijo `tsx` que importa
`ManifestDb`, `prune` y `rutaDeBlob` **de producción**: nada de reimplementar el layout aquí, que
sería el espejo que deriva.

Cierra con un bloque **PENDIENTE** que no cuenta como comprobación: los hallazgos 1 y 3, afirmados
sobre el comportamiento de HOY. Si alguien los cierra, el guion **lo dice y sigue verde** («CERRADO:
… promuévelo a check»), para no heredar ni un rojo permanente (hallazgo 1 del QA de la PR B) ni un
candado fósil.

**Probado en negativo**, que es lo único que lo hace valer algo — seis mutantes, uno a uno,
revertidos con `git diff` vacío después de cada uno:

| Rompo | Rojos |
|---|---|
| `character_ref` opcional en el zod | **1** (el del sheet; al hero lo salva el `superRefine` — y eso es información, no ruido) |
| sin el `superRefine` `hash === character_ref` | **2** |
| `prompt: z.string()` en los kinds de personaje | **3** |
| el handler llama a `register` y no a `registrarPineado` | **1** |
| `rutaDeBlob` trata al hero como directorio | **1** |
| el `type` desconocido del prune pasa a `continue` | **1** |

La primera pasada del guion **no cazaba** el primer mutante (probaba solo el `extra` ausente, no el
`extra` presente sin la clave): lo añadí y volví a medir. Lo digo porque es exactamente el defecto
que este rol busca en el trabajo ajeno.

---

## Workarounds usados

| Workaround | Por qué | Veredicto |
|---|---|---|
| Symlinks de `node_modules` (×4), `.venv` y `assets` en el worktree de QA | Un worktree nace sin dependencias | **No es hallazgo**: setup, no producto. Explica los 6 rojos de `contract-fixtures`, que fallan igual en el checkout principal |
| El prune se ejerce **en proceso** (importando el módulo real), no por `POST /cache/prune` | `cacheMaxBytes` sale de `CONFIG` (2 GiB) y **no tiene override por entorno**, así que contra el proceso real no se puede pedir un techo minúsculo; y el endpoint aborta sin keep-list de world-state | **No afecta al jugador**, pero sí a quien quiera probar el prune real: es el hermano exacto de #391 (que nació de un workaround de QA idéntico). Merece una línea de issue si alguien vuelve a tocar el prune |
| Llamar a `registrar_arte_de_personaje` directamente (con `manifest=AssetStoreClient(url)`) para ejercer el registro del hero | Ningún test ni guion de la PR lo ejerce contra el zod real | **ES un hallazgo, no un paso de la receta** → hallazgo 2 |
| Mutaciones temporales de contratos, servicio y `remote_generation.py` (7 en total) | Probar los candados en negativo, que es obligación del rol | **No afecta al usuario**: revertidas desde copia; `git diff` limpio tras cada una |
| Censo del barrido llamando a `censar()` en vez del CLI | El CLI en dry-run es igual de inocuo, pero la mitad de solo lectura se ve mejor así (y una orden con `--cache /…/cache/sprite_sheets` la bloquea el clasificador de esta sesión, con razón) | **No afecta al usuario**: mismo código, misma tabla, cero escrituras |

---

## No probado

- **La generación REAL de un hero o un sheet.** Cuesta créditos. Lo ejercido de punta a punta es el
  **registro**, que es el sujeto de #376, y con el productor de verdad.
- **`./start.sh` de punta a punta con los tres kinds.** Ningún preset arranca el asset-store solo. En
  su lugar: el entry real como hijo (dos guiones y `test/asset-store-server.test.ts`) con la misma
  línea que usa `start.sh:434`.
- **El prune por HTTP con techo pequeño** (ver workarounds) y, por tanto, el camino
  `keep-list de world-state ∪ pins` en vivo. La unión está leída (`http-server.ts:143`) y probada por
  `npm test`, no por mí en un proceso real.
- **Mutación.** `asset-store-contrato` nace sin medida previa y `npm run mutacion -- local` se niega;
  la corrida completa está pedida y no medida. **El `break: 0` no es una medida**: hasta esa corrida,
  el módulo nuevo no dice nada sobre la calidad de sus tests.
- **CI.** Otro sistema de ficheros y sin caché; lo dice el hook cuando exista la PR.
- **La batería del cliente (`node qa/run.mjs`).** El diff no toca `nefan-html` (verificado en el
  `--stat`: 26 ficheros, ninguno del cliente).
- **El barrido con `--ejecutar`.** Es del coordinador. Verifiqué sus cifras contando por mi cuenta y
  añadí la medida que faltaba (arriba).

---

## Veredicto

**APTO CON RESERVAS.**

El criterio literal de #376 se cumple: los dos kinds entran en el manifest con su prompt, pineados,
hero y frames bajo el mismo ref y sueltos a la vez; el prune sabe borrar cada layout, respeta los
pines y es fail-loud con lo que no conoce; el cache-hit —que era la mitad del issue— registra y no
duplica; la deuda no crece, el CRAP del `handle` baja y la prosa muerta se fue con candado que se
pone rojo de verdad.

Las reservas, por orden: **(1)** «hero sin sus frames» sigue siendo expresable por el lado del sheet,
y el contrato promete lo contrario; **(2)** el registro del hero contra el zod real no lo canda nada,
y el único check verde que lo menciona lo satisface igual un registro roto; **(3)** el `hash` del
registro no tiene forma mientras el prune borra recursivamente. Ninguna rompe la funcionalidad y las
tres son baratas — una regex, dos líneas en un guion y una decisión de contrato.

Y el barrido de los 53: **adelante sin reservas**. No es arte que servía; es arte que dejó de ser
alcanzable el 2026-08-24, y esta PR solo lo está poniendo por escrito.
