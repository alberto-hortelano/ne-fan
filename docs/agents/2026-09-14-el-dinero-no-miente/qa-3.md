# PR 3 · «el importe deja de mentir» (#513) — QA

Árbol `/home/al/code/ne-fan-qa-a3`, bloque de puertos +200, rama del ingeniero (`8d59ac1f`).
**Cero créditos**: motor falso (`e2e-sin-creditos`), `_run_page` stubeado, ninguna llamada a fal ni a
Meshy. El único botón que gasta (`#ts-style-run`) se pulsó contra el motor falso, que no cobra.

**Veredicto: APTO CON HALLAZGOS.**

Lo que el usuario pidió —*el importe del atlas es el que se cobra; el de los skins es una cota
superior declarada como tal*— **se cumple**, y lo he comprobado de punta a punta con el juego
delante, no leyendo el informe. Pero la **cifra agregada de la tabla que justifica la PR está mal**
(H1 — el número bueno es **×2,70** sobre un mundo real, no 2,5×), y en **la misma pantalla, una
fila más arriba, queda un precio presentado como exacto que no lo es** (H2) — la misma enfermedad que esta PR viene a curar, que su candado nuevo no ve (H3).

---

## 1 · Criterios de aceptación

| Criterio (de la petición, no del plan) | | Evidencia |
|---|---|---|
| El importe del **atlas** es el que se cobra | ✅ | `qa/guiones/115` (**nuevo, mío**): con solo el atlas encendido, botón «Aplicar estilo ($0.15)» → comprobante «Estilo aplicado: 23 celdas y 0 skins nuevos ($0.15)». Igualdad al céntimo, en el navegador, cruzando el pago. Probado en negativo (§5) |
| …y la cifra sale de quien empaqueta, no del cliente | ✅ | `qa/guiones/114` verde en mi corrida: pantalla `$0.15` == suma del wire `[{"missing":23,"usd":0.15,"paginas":3}]`. Forzando 3 lotes (sonda `MAX_CELLS_PER_REQUEST=9`): `[0.05,0.05,0.05]` → pantalla `$0.15` y comprobante `$0.15` |
| Cotización ↔ cobro en el servidor, también con **caché caliente parcial** | ✅ | Sonda propia `test_qa_cache_caliente.py` (4 tests, `_run_page` stubeado): con 6 de 15 celdas ya pintadas, cotizado **$0.66 / 4 páginas** == cobrado **$0.66 / 4 páginas** (en frío serían 5 páginas). No lo cubría ningún test de la PR |
| …y en **dos lotes de 64** | ✅ | Misma sonda: 100 celdas partidas 64+36 → cotizado $1.80 / 12 pág == cobrado $1.80 / 12 pág |
| Los **skins** son una cota superior **declarada como tal** | ✅ | `114` bloque 3 (mi corrida): fila «Skins de personaje (2 personajes × 3 anims) — **hasta** $0.00», total «Coste: **hasta** $0.15», botón «Aplicar estilo (**hasta** $0.15)». La cota arrastra a total y botón |
| …y que la factura no pueda superarla | ⚠️ | **No probado.** Nada mide que `calls_per_anim × personajes` sea un techo de lo que cobra `/skin_sprite_sheet`; la frase «pagará eso o menos, nunca más» del informe es una justificación, no una medida. Ver H10 |
| Sin poder saberlo: «coste no disponible», **jamás** una cifra inventada | ✅ | Tres estados medidos en vivo: **sin cotización del servidor** (`114` b2) → fila, total y botón dicen «coste no disponible», sin `$0.00` delante; **sin catálogo de skins** (aborté `/sprite_catalog`) → «coste no disponible» + nota «No se pudo leer el catálogo de sprites (Failed to fetch)»; **catálogo que contesta y no sabe costear** (`97`) → ídem. El suelo de 4 llamadas (`SKIN_CALLS_FALLBACK`) ya no existe: `grep` a cero |
| El «~$0.00 + ?» del botón (último punto vivo de #548) | ✅ | Medido: botón «Aplicar estilo (coste no disponible)», total «Coste: coste no disponible — ningún bloque seleccionado publica su precio (ver notas)». Ni un `$0.00` |
| **La tabla antes/después, medida** | ❌ | Las filas por escena son correctas (las reproduje al céntimo). La fila **TOTAL, 2,5×, es falsa**: suma tres peticiones que el cliente nunca hace. El número bueno es **×2,70** sobre el mundo pre-generado real ($0.30 → $0.81) y **×1,57** sobre las tres fixtures. Ver H1 y §2 |
| Lo pagado **tiene dueño** y nada invita a pagar dos veces (#548) | ✅ | `123` verde; y `115` añade el estado que faltaba: **tras pagar**, el servidor cotiza `$0.00` y la fila pasa a «en caché ($0)» con la casilla deshabilitada |
| **Una sola fuente** del precio, y algo que se pone rojo si se separan | ⚠️ | Cumplido **para el atlas** (una función cotiza y cobra; `test_atlas_cotizacion.py` + regla `el-precio-lo-dice-quien-empaqueta`, ambos verdes y probados en negativo). **No** para el otro precio de la misma pantalla (H2), que la regla no ve (H3) |
| Cero créditos en toda la verificación | ✅ | `⛨ guardarraíl: cliente y bridge declaran fake:true` en cada guion; `gasto sesión 0,00 €` en el HUD de las capturas |
| No se mueve ninguna clave de caché | ✅ | `layoutAtlas` solo cambia en comentarios (`git diff`); `canonicalSurfaceLayoutJson` intacto. Cero arte repagado |

---

## 2 · El número bueno de la tabla (H1, medido por mi camino)

El ingeniero y el crítico **no miden lo mismo**. El agregado del ingeniero (2,5×) está mal **por
método**: suma tres peticiones que el cliente nunca hace. El del crítico (1,6×) es correcto para ese
dato pero el dato es flojo: tres fixtures de test sin una sola `ref` de cara. Con el mundo que un
jugador recibe de verdad sale **×2,70** — o sea que el ingeniero acierta en el fondo (el error es
mayor de lo que dijo el crítico) y falla en la aritmética.

**Mi camino**: reconstruí la lista de celdas EXACTAMENTE como la construye
`StyleApplyController.plan()` (`formatDToWorld` → `buildFpsTileSpec` → `buildLayout`, dedup por
`[en, mat, kind, hints, ref]`) con `tsx` sobre el código de la rama, y la pasé por el **`pack_missing`
de verdad** de `ai_server` (no por un port) más `cotizar_paginas`. Scripts en
`/tmp/claude-1000/-home-al-code-ne-fan/273328d5-3414-4aea-9086-e8ac99d49ac2/scratchpad/qa3/`
(`celdas.ts`, `cotiza.py`).

**Por escena — el ingeniero acierta, el crítico no:**

| escena | celdas | ANTES | AHORA | páginas | error |
|---|---:|---:|---:|---:|---:|
| `puerto_tile` | 11 | $0.15 | $0.47 | 3 | **3,13×** |
| `robledo_tile` | 11 | $0.15 | $0.32 | 2 | **2,13×** |
| `zorder_test` | 10 | $0.15 | $0.32 | 2 | **2,13×** |

Reproduce la tabla del informe al céntimo. El **1,1× de `robledo_tile`** que dio el crítico es un
fallo de **su** port: el `pack_missing` real abre dos páginas ahí (9 tiles + 2 uniques), no una.

**Agregado — el crítico acierta, el ingeniero no:**

```
== FUSIONADO Y DEDUPLICADO (lo que manda plan() de verdad) ==
las 3 juntas    15 celdas  ANTES $0.30  AHORA $0.47 (3 pág)  ×1.57
               ['9×tile/nano-banana-pro/$0.15', '3×tile/nano-banana-pro/$0.15', '3×unique/gpt-image-2/$0.17']
```

**`plan()` no manda tres peticiones: manda una.** El `const seen = new Set()` de
`style-apply.ts:215` vive **fuera** del bucle de escenas, así que las tres fixtures colapsan de 32
celdas a **15**, y esas 15 viajan en un solo lote de 64. La fila «TOTAL 32 celdas · $0.45 → $1.11 ·
2,5×» del informe suma tres peticiones que el cliente nunca hace, y su encabezado dice
«deduplicando por identidad **como hace `plan()`**» — que es justo lo que esa fila no hace. Es la
misma clase de error que el coordinador ya corrigió una vez en esta tanda con el 7,8×: una cifra
construida presentada como medida.

### Y la cifra que de verdad importa: un mundo REAL, no tres fixtures

Las tres fixtures son datos de test. El banco deja en disco algo mejor: el **mundo pre-generado de
`alta_fantasia`** (`qa/.tmp/<run>/games/alta_fantasia/world/tile.json`), que es exactamente lo que
el panel cotiza — sus **23 celdas** son las mismas «23 celdas, 23 por pintar» que sale en la fila del
guion 114. Pasado por el mismo camino y por el `pack_missing` real:

```
MUNDO REAL alta_fantasia (pre-generado) — 23 celdas
  ANTES (cliente) $0.30   AHORA (servidor) $0.81 en 5 páginas   ×2.70
   ['9×tile/$0.15', '4×tile/$0.15', '3×unique/$0.17', '5×unique/$0.17', '2×unique/$0.17']
```

**El número bueno, ordenado de más a menos representativo:**

| | valor | qué es |
|---|---:|---|
| **mundo pre-generado de `alta_fantasia`** | **×2,70** ($0.30 → **$0.81**, 5 páginas) | lo que se le enseñaba y lo que se le cobraría a un jugador de verdad |
| agregado de las 3 fixtures como UNA petición | ×1,57 ($0.30 → $0.47) | el número del crítico, correcto para ese dato |
| peor fichero (`puerto_tile` solo) | ×3,13 ($0.15 → $0.47) | del ingeniero, confirmado |
| techo de una petición (64 uniques, ref propia) | ×12,09 ($0.90 → $10.88) | confirmado |
| aísla el divisor (10 tiles, sin refs) | ×2,00 ($0.15 → $0.30) | confirmado |

O sea: **la conclusión del ingeniero —que el error es mayor de lo que dijo el crítico— es correcta;
su aritmética, no.** El 2,5× sale de sumar tres peticiones inexistentes y da, por casualidad, algo
parecido al 2,70× real. Si se quiere una sola cifra para el `why`, la PR y el issue, que sea
**×2,70 sobre el mundo pre-generado**, con su método al lado; si se prefiere seguir citando las
fixtures, **×1,57**.

**Aviso que ninguno de los tres documentos dice**: las tres fixtures **no tienen ni una `ref` de
cara** (`refs_unique=['']` en las tres). O sea que la tabla de fixtures mide las causas (a) el
divisor y (c) el modelo por página, pero **no** la (b) «una página por ref», que es la que produce
el 12,1×. La única evidencia de (b) es el caso sintético del techo.

**Dónde está bien y dónde está mal, para que no se corrija lo que no toca**: el `why` de
`el-precio-lo-dice-quien-empaqueta` dice «**1,6×** de error agregado y 3,1× en el peor fichero» —
las dos son correctas, y ahí no hay nada que tocar. Lo que hay que corregir es **solo** la fila
TOTAL de `implementacion-3.md` (y el «2,5×» de su veredicto), que contradice a la regla que la
propia PR escribió.

---

## 3 · Hallazgos

### H1 · **importante** — la cifra que justifica la PR está mal (2,5× no sale de ningún sitio)

Arriba, §2. **Qué esperaba quien lee**: que «TOTAL … 2,5×» fuera lo que le pasa a un jugador. Lo
que le pasa, con el mundo pre-generado real, es **×2,70**; con las tres fixtures que dice medir,
**×1,57**. El 2,5× no es ninguna de las dos.
**Reproducción desde cero**: `npx tsx` con `formatDToWorld`+`buildFpsTileSpec`+`buildLayout` sobre
`nefan-core/data/scenes/*.json` deduplicando con UN solo `seen` (como `plan()`) → 15 celdas;
`pack_missing` real → 3 páginas → $0.47 contra $0.30 del `ceil(15/12)×0.15` de antes.
**Qué hay que cambiar**: la fila TOTAL de `implementacion-3.md` y el «2,5×» de su veredicto —
nada más. Las per-escena y el techo se quedan, y el `why` de la regla ya dice el número bueno
(1,6×), así que hoy el informe contradice al candado que la propia PR escribió. Conviene añadir que
las tres fixtures no ejercen la causa (b).

### H2 · **importante** — el bloque «Referencias del estilo» se declara `exacto` y no lo es

La PR reescribe ese bloque como `precio: { clase: "exacto", usd: pack.estimated_cost_usd }`
(`style-apply.ts:309`) con un comentario nuevo: *«Dry-run del propio servidor: las refs que faltan,
una imagen cada una»*. El recuento es correcto; **el precio no**:

- **Cotiza** (`ai_server/routers/styles.py:333-338`): `len(missing) × MeshyImageToImage.cost_usd(sprite_skin_model)` — **un solo precio para todas las refs**, el del modelo de personajes. Con `sprite_skin_model = "gpt-image-2"` → **$0.24/ref**.
- **Cobra** (`ai_server/style_pack_builder.py:255-262`): el modelo depende de la **carpeta** — `surfaces/` → fal `nano-banana-pro` **$0.15**, `faces/` → fal `gpt-image-2` **$0.17**, `characters/` → Meshy **$0.24**.

Medido (sin generar nada, script `pack_precio.py`), un pack de usuario con 1 surface + 2 faces + 1
character sin imagen:

```
BLOQUE «pack» — lo que la pantalla enseña como EXACTO: $0.96
                lo que de verdad cobrará generate_missing: $0.73
                error: ×1.32 (cotiza de MÁS, $0.23)
```

Es **exactamente el mismo defecto** que la PR arregla —el precio no lo dice quien empaqueta— en la
**fila de arriba de la misma lista**. Y la PR lo empeora en presentación: el rótulo pasó de
«Coste **estimado: ~**$X» a «Coste: $X», o sea que la cifra se presenta hoy con más certeza que
ayer, y el nuevo tipo `PrecioDeBloque` la marca `exacto` sin que nadie lo haya medido.
**Alcance real, medido**: los cinco packs de serie están completos (`missing_refs` = 0 en los
cinco), así que con un estilo de serie la fila siempre es «en caché ($0)» y el defecto no se ve. Se
ve con un **estilo subido por el jugador** y no completado — que es un flujo soportado
(`/styles/upload` → confirmación → `/styles/{id}/complete`).

**Y hay una segunda señal de que la etiqueta es nueva y no está medida**: el MISMO
`estimated_cost_usd` se enseña en la pantalla de subir estilo (`titulo/subir-estilo.ts:236,239`)
como «Generarlas costará **~**$X» y «Generar N imágenes (**~**$X)». Tras esta PR, el mismo número
es una **estimación con tilde** en una pantalla y un **precio exacto** en la otra. Una de las dos
miente, y la que acaba de cambiar es la del panel de coste.

**Reproducción desde el arranque**: `./start.sh --preset play`, título → subir un estilo propio sin
completarlo → elegir ese estilo → «Aplicar estilo (ver coste)» → la fila «Referencias del estilo (N
categorías) — $X». Pagar y comparar con el comprobante.
**Qué esperaba el jugador**: o la cifra que se cobra, o un «hasta $X». Hoy es lo segundo disfrazado
de lo primero.
**Lo barato**: `clase: "cota"` mientras el dry-run no pregunte por carpeta; lo correcto, que
`/styles/{id}/missing` calcule con el mismo mapa carpeta→modelo que `generate_missing`.

### H3 · **importante** — el cuarto agujero de `el-precio-lo-dice-quien-empaqueta`, y es el que importa

El `why` declara tres agujeros (un nombre nuevo, un `0.15` suelto, un diccionario). **El cuarto es
de alcance, no de regex: la regla solo conoce el precio del ATLAS.** Su patrón caza cuatro nombres
y los literales `0.15|0.17`; en la misma pantalla conviven otras dos tarifas que le son invisibles:

- la de H2 (`per_image` de `styles.py`, con su literal suelto `else 0.18`),
- la de Meshy (`MODEL_CREDITS` × `USD_PER_CREDIT = 0.02`), que es de donde sale ese `$0.24`.

Probado (regex ejecutado sobre sondas, no leído):

| sonda | desenlace |
|---|---|
| `const CELLS_PER_PAGE = 9;` | CAZA |
| `const costePorPagina = 0.17;` | CAZA |
| `per_image = MeshyImageToImage.cost_usd(m) if deps.config else 0.18` | **ESCAPA** |
| `"estimated_cost_usd": round(len(missing) * per_image, 2)` | **ESCAPA** |
| `const costeUsd = 0.24;` (el precio de Meshy) | **ESCAPA** |
| `const USD_PER_CREDIT = 0.02;` | **ESCAPA** |
| `const CELLS_PER_PAGE = CELDAS_POR_PAGINA;` (sin número) | **ESCAPA** |
| `const costeUsd = .15;` · `= 0.150;` · `= 15/100;` | **ESCAPAN** las tres |

Los tres últimos son variantes cosméticas del hueco ya declarado y no me preocupan. El que importa
es el primero: **la regla se llama «el precio lo dice quien empaqueta» y solo vigila un precio de
los tres**. Un lector la citará como garantía de la pantalla entera, y H2 es la prueba de que no lo
es. Como mínimo, el `why` tiene que decir qué precios NO cubre y por qué.

### H4 · **menor (declarado por el ingeniero, y confirmado)** — la tabla de precios envejece en verde

Sí, es cierto, y es peor de lo que dice el informe: **el ledger de gasto también lee la misma tabla**
(`surface_atlas_generator.py:431`: `SPEND.add(FalImageToImage.COST_USD.get(ai_model, 0.17), …)`).
Cotización, factura y contabilidad salen del mismo diccionario, así que las tres coinciden entre sí
y las tres estarían igual de equivocadas: ni siquiera lo YA gastado se puede reconciliar con una
factura real.

**¿Hay algo que se pondría rojo? Sí, pero en la dirección contraria**:
`test_atlas_cotizacion.py:115` hardcodea `assertAlmostEqual(..., 0.15 + 0.17 * 3)`. Eso no se pone
rojo cuando la tabla envejece — se pone rojo el día que alguien la **corrige**. Útil como aviso,
pero conviene saber que la PR ha añadido una copia más del precio (esa, más las dos del `why` de la
regla y la del docstring de `pack_missing`), y que **ninguna la ve la regla nueva**: la aserción es
justo el «`0.15` suelto en una expresión sin nombre» que el `why` declara que se le escapa, ahora
materializado dentro de su propio ámbito (`ai_server/**/*.py`).

Y un filo más: `COST_USD.get(modelo, 0.17)` aparece en cuatro sitios. Un modelo NUEVO que no esté en
la tabla cotiza y cobra $0.17 sin decir nada — fail-silent en el único sitio donde hay dinero.

### H5 · **menor** — con más de 64 celdas, «exacto» puede cotizar de más

Dos celdas que el **cliente** considera distintas (`[en, mat, kind, hints, ref]`) y el **servidor**
colapsa en la misma clave de caché (`desc` + contexto, donde una `ref` muerta se normaliza a `""`)
se cotizan dos veces y se cobran una, si caen en **lotes distintos**. Medido con el endpoint real
(`_run_page` stubeado):

```
cotizado $0.17+$0.17 = $0.34 · cobrado $0.17+$0.00 = $0.17   (missing del 2º cobro = 0)
```

Se da con >64 celdas, misma `desc`/`mat`/`kind`/`hints` y refs muertas distintas (o «sin ref» contra
«ref muerta»). La dirección es la segura —se cobra menos de lo prometido— pero el bloque se
presenta como **exacto**, y el criterio de esta tanda es precisamente que una cota se presente como
cota. Dentro de un mismo lote no ocurre (lo comprobé): cotización y cobro salen de la misma lista.

### H6 · **menor** — el botón que gasta se sale de la pantalla en el peor estado

A 1280×800 (el viewport de la batería), con **dos** notas (sin catálogo + sin cotización) y el total
largo, medido en el DOM:

```
C · SIN CATÁLOGO NI COTIZACIÓN: { "vh": 800, "botonBottom": 817, "botonVisible": false,
                                  "docScrollable": false, "ancestroConScroll": "DIV" }
```

El documento **no** scrollea; el botón solo aparece scrolleando un contenedor interno que no enseña
barra. Se ve en la captura `114-…-02-importe-del-atlas-sin-cotizacion.png`: el total queda cortado a
media frase en el borde inferior. La PR no lo creó, pero lo empuja: la nota nueva de la cota mide
**36 px** y el margen que quedaba en el estado normal es de **37 px** (`botonBottom: 763`). En el
estado del jugador real (con cota) queda en 761 — a dos píxeles.

### H7 · **menor, crítica visual** — «$0.15» y «hasta $0.15» se leen igual de lejos

Mirando `114-…-03-importe-con-una-cota-encendida.png` como director de arte y como jugador:

- Las tres filas son **tipográficamente idénticas**: 12 px, `#bbb`, misma raya, misma posición. Lo único que separa «lo que vas a pagar» de «como mucho vas a pagar» son **cinco caracteres** al final de una línea larga y gris. Se lee si se lee la línea entera; **no se ve al escanear**, que es como se mira una lista de casillas. En la única pantalla que gasta dinero real, la clase de la cifra debería tener peso visual propio (la cifra exacta en el color del texto vivo, la cota atenuada o con su propia etiqueta), no una palabra más.
- La nota dice «El coste de los skins es una **COTA SUPERIOR**: sin dry-run de skins…». Eso es vocabulario de matemáticas y de implementación en una frase que lee un jugador. La fila ya dice «hasta», que es la palabra correcta; la nota debería decir por qué en el idioma del jugador («como mucho pagarás esto; lo que ya esté pintado no se repaga»), no repetir el concepto con jerga.
- El importe total es lo más importante de la pantalla y es lo **menos** destacado: `Coste: hasta $0.15 (los skins y páginas ya en caché no se repagan)` — la cifra y el paréntesis tienen el mismo tamaño y el mismo color. El botón sí está bien resuelto (ocre contra transparente, verificado en `123`).
- Detalle de idioma: `Referencias del estilo (0 categorías) — en caché ($0)`. Con **cero** items no es «en caché»: es «nada que hacer». «En caché» le dice al jugador «esto ya lo pagaste», que es otra cosa. Pre-existente, pero cae en el mismo sitio.

### H8 · **menor** — dos campos obligatorios que nadie lee, y que darían NaN en silencio

`fps-atlas.ts:176-178` acumula `quoted_pages`/`quoted_cost_usd` en la partida. **Ningún lector**
(`grep` a cero fuera de ahí). Y a diferencia de `style-apply.ts`, ahí no hay `Number.isFinite`: un
servidor que no los mandara dejaría `NaN` propagándose sin que nadie se entere. Es el peaje de haber
declarado el campo obligatorio; o se lee (el HUD ya enseña el coste del atlas de tile: «Atlas fps de
tile_0_0 instalado (3 página(s) nuevas, $0.15)») o no se acumula.

### H9 · **menor** — la mezcla exacto + cota + desconocido no la cubre ningún guion

`resumirElImporte` tiene tres clases y `97`/`114` cubren dos parejas (exacto+desconocido,
exacto+cota). Las tres a la vez —que es el estado del jugador real con un pack incompleto, un
catálogo a medias y celdas que faltan— no la ejerce nada: debería leerse «hasta $X + ?».

### H10 · **menor** — «pagará eso o menos, nunca más» es una afirmación, no una medida

La cota de skins vale `personajes × (1 + Σ calls_per_anim) × costPerImage`. Que la factura real de
`/skin_sprite_sheet` no pueda superarla depende de que sprite-forge no emita más llamadas de las que
publica y de que el hero-shot se cobre una vez por personaje y no una por anim (el cliente manda
**tres** peticiones por personaje). Nada de eso lo comprueba nada en este repo, y el servicio vive en
otro. Es legítimo declararlo cota; no lo es declarar el lado sin medirlo.

### H11 · **menor** — queda un rastro que miente, en un fichero que la PR toca

`labs/narrative/fake-ai-server.ts:757`, en el comentario de `/sprite_catalog`:

> *«Sin esta ruta el cliente caería a **su cota baja de coste** y el bench estaría probando el
> camino de respaldo para siempre en vez del bueno.»*

Esa cota baja es `SKIN_CALLS_FALLBACK`, que **esta misma PR borra**. Hoy, sin la ruta, el cliente no
cae a ninguna cota: dice «coste no disponible» — lo comprobé abortando `/sprite_catalog`. El informe
declara `grep` a cero de la prosa caduca y esta se le escapó (busca «no pasan por el manifest» y
«port de layoutAtlas», no «cota baja»). Dos líneas, y en el fichero que la PR edita.

---

## 4 · Estados del sistema recorridos

| Estado | Resultado |
|---|---|
| Caché **vacía** (frío) | ✅ `$0.15` exacto == wire == comprobante (`115`) |
| Caché **caliente total** (tras pagar) | ✅ wire cotiza `$0.00`, fila «en caché ($0)», casilla deshabilitada (`115`) |
| Caché **caliente PARCIAL** | ✅ cotizado $0.66/4 pág == cobrado $0.66/4 pág (sonda Python; en frío serían 5 pág). **Nadie lo había probado** |
| **Sin catálogo** de skins (`/sprite_catalog` cae) | ✅ «coste no disponible» + nota con la causa. Cero cifras inventadas |
| **Con catálogo** que costea | ✅ «hasta $X» en fila, total y botón (`114` b3) |
| Catálogo que contesta y **no sabe costear** | ✅ «coste no disponible» + causa (`97`) |
| **Bloque de atlas vacío** (0 celdas por pintar) | ✅ «en caché ($0)», casilla deshabilitada |
| **Ningún** bloque con precio | ✅ total y botón «coste no disponible», sin `$0.00` (`114` b2) |
| **Refs muertas** | ✅ se limpian antes de cotizar; cotizado == cobrado (test del ingeniero, verificado). ⚠️ salvo el caso de H5 |
| **Más de 64 celdas** (dos lotes) | ✅ en el servidor (sonda: $1.80 == $1.80) y en el cliente (sonda `MAX_CELLS_PER_REQUEST=9`: 3 cotizaciones sumadas bien). Ver workaround W3 |
| `quoted_cost_usd` **ausente** | ✅ «coste no disponible» en fila, total y botón (`114` b2, medido en vivo) |
| Un lote cotiza y otro no | ⚠️ **no probado en el navegador**; por código, `cotizado = null` y el bloque entero cae a «coste no disponible». Es lo conservador y lo correcto |
| Fallo de navegación tras pagar (#548) | ✅ `123` verde |

---

## 5 · Candados: probados EN NEGATIVO por mí

No me creo un verde que no he visto ponerse rojo. Las tres sondas se revirtieron
(`git status` limpio salvo mi guion nuevo):

| Sonda | Desenlace |
|---|---|
| `resolveMissing` vuelve a `ceil(missing/12) × 0.15` | `qa/guiones/115` **✘** — `prometido $0.30 · comprobante «Estilo aplicado: 23 celdas y 0 skins nuevos ($0.15)»`. Reproduce el bug original de punta a punta |
| la fila del atlas pinta el precio también cuando `missing === 0` | `115` **✘** — `«Librería de superficies (23 celdas, 0 por pintar) — $0.00»` en vez de «en caché ($0)» |
| regla `el-precio-lo-dice-quien-empaqueta` contra 19 sondas | 5 cazadas, 14 escapadas (las que importan, en H3) |

Y comprobé los verdes que el informe declara: `npx tsx --test test/architecture.test.ts` → **100/100**;
`python -m unittest discover -s ai_server/tests` → **251 OK**.

## 6 · Workarounds usados, y su veredicto

- **W1 · `_run_page` stubeado** (sondas Python de caché caliente y lotes). **No afecta al jugador**: sustituye solo la llamada que gasta; packer, precios y endpoint son los de producción. Es además el mismo doble que usa el candado del ingeniero.
- **W2 · Interceptar `/sprite_catalog` y `/generate_surface_atlas`** para construir los estados «sin catálogo» y «sin cotización». **No afecta al jugador**: son fallos que ocurren solos (servicio caído, servidor viejo). Es el método del guion 114.
- **W3 · Bajar `MAX_CELLS_PER_REQUEST` de 64 a 9** para alcanzar el estado de varios lotes. **Esto SÍ es un hallazgo, menor**: ningún mundo del banco llega a 64 celdas (`alta_fantasia` pre-generado da 23), así que **el camino de varios lotes —el que más dinero mueve— no lo ejerce ningún guion ni ningún test**. Yo lo he cubierto en el servidor con una sonda Python, pero en el cliente solo se alcanza tocando una constante. Merece o un mundo de banco más grande, o un test unitario de `resolveMissing`.
- **W4 · Un guion temporal (`999-…`)** para medir geometría y estados; borrado al terminar.

## 7 · No probado, y por qué

- **Que la cotización sea la factura de fal/Meshy.** Cuesta créditos. Toda la paridad demostrada es interna (H4).
- **Que la cota de skins no se pueda superar** (H10): requiere sprite-forge real y gasto.
- **El pack de estilo pagado de verdad** (H2 se midió con la tabla de precios y el dry-run, sin generar ni una imagen).
- **Un lote que cotiza y otro que no**, en el navegador.
- Las **curvas de deuda** (`crap`, `deuda`, mutación): las declara el ingeniero y no las repetí — `npm run crap` exige una corrida de cobertura que compite con la batería por la máquina, y no es donde estaba el riesgo de esta PR.

## 8 · Batería y suites

Todo desde este árbol, con `NEFAN_PORT_OFFSET=200` (`qa/run.mjs` lo respeta y levanta él mismo el
preset `e2e-sin-creditos` con disco virgen). Nunca `pkill`, nunca matar por puerto.

| Qué | Resultado |
|---|---|
| Subconjunto de la zona (`07 97 114 115 123`) | **5 en verde · 0 en rojo** |
| Batería COMPLETA (`node qa/run.mjs`, 114 guiones con el mío) | **110 en verde · 3 en rojo · 1 SIN MEDIR** |
| Los 3 rojos, re-corridos aislados (`75 80 91`) | **3 en verde · 0 en rojo** — no son regresiones |
| `npm test` (nefan-core) | **2595 / 2595**, 466 suites, 0 fallos |
| `npx tsx --test test/architecture.test.ts` | **100 / 100** |
| `python -m unittest discover -s ai_server/tests` | **251 OK** |

Los tres rojos (`75` #410 colisión del tile, `80` una entrada de error de más en el desplegable
Room, `91` la caja de la forja) están fuera de la zona del precio y pasan en aislado.
El `⊘` es `53`, declarado y preexistente (#509: el registro de errores tapa el chip).

### H12 · **menor, y no es de esta PR** — la corrida larga no es reproducible

El informe del ingeniero declara **2 rojos (`97` y `15`) y 1 sin medir (`53`)** sobre 113 guiones.
Mi corrida da **3 rojos (`75`, `80`, `91`) y 1 sin medir (`53`)** sobre 114 — con `15` y `97` en
verde. Fuera del `⊘`, no coincide ni uno. Los tres míos pasan aislados, igual que el `15` del
ingeniero pasaba aislado: o sea que **cuál se cae depende de la corrida, no del código**. La consecuencia práctica para quien lea cualquiera de los dos informes
es que «110 en verde · N en rojo, los N explicados» no es una afirmación sobre el juego — es una
afirmación sobre esa tirada. Hay estado compartido entre guiones que la aserción de aislamiento
(`aisla`) no cubre, y merece su issue.

## 9 · Lo que dejo ejecutable

`qa/guiones/115-el-importe-prometido-es-el-que-dice-el-comprobante.mjs` (**nuevo**). Cierra el tramo
que ningún candado de la PR cubría: entre la cotización del wire (que mide el 114) y la paridad
interna del servidor (que mide `test_atlas_cotizacion.py`) estaba el trozo que es del jugador — **lo
que el botón promete contra lo que el comprobante dice que se pagó** — y el estado de **caché
caliente**, que no aparece en ninguna parte de la PR. Cero créditos: motor falso, como el 123.
Probado en negativo con dos sondas (§5).

Las sondas de servidor que no son de navegador quedan en el scratchpad y valdría la pena que el
ingeniero las suba a `ai_server/tests/`: `test_qa_cache_caliente.py` (caché parcial, dos lotes, y el
caso de H5) y `pack_precio.py` (H2).

---

## Apéndice · las dos sondas de servidor, para que la evidencia no viva en un scratchpad

**A · caché caliente PARCIAL y dos lotes** — se monta sobre el harness del propio ingeniero
(`ai_server/tests/test_atlas_cotizacion.py`: `GeneradorSinRed` con `_run_page` stubeado,
`PacksFalsos`, el `TestClient` de FastAPI). Los tres casos que faltan:

```python
MUNDO = [*(celda(f"tile_{i}") for i in range(12)),
         celda("muro",   kind="unique", w=3.0, h=3.0),
         celda("puerta", kind="unique", ref="fachada", w=1.2, h=2.4),
         celda("altar",  kind="unique", ref="interior", w=2.0, h=1.0)]

# 1) caliente PARCIAL: se pintan 6 de 15 y luego se cotiza/cobra el mundo entero
self.pedir(MUNDO[:6])                                  # 1 página, $0.15
cot = self.pedir(MUNDO, resolve_only=True)             # missing 9 · 4 pág · $0.66
cob = self.pedir(MUNDO)                                # 4 pág · $0.66
assert cob["cost_usd"] == cot["quoted_cost_usd"]       # ✅
assert cot["quoted_pages"] < len(pack_missing([dict(c) for c in MUNDO]))   # 4 < 5 en frío ✅

# 2) DOS LOTES como los parte el cliente: 100 celdas en 64 + 36
#    cotizado $1.80 / 12 pág == cobrado $1.80 / 12 pág                      ✅

# 3) el caso de H5: dos celdas con la MISMA desc y refs MUERTAS distintas, en lotes distintos
#    cotizado $0.17 + $0.17 = $0.34 · cobrado $0.17 + $0.00 = $0.17         ❌ se cotiza de más
```

**B · el precio del bloque «pack» (H2)** — sin generar ni una imagen, comparando el dry-run con la
tabla que cobra:

```python
per_image_dryrun = MeshyImageToImage.cost_usd(config["sprite_skin_model"])   # gpt-image-2 → $0.24
# lo que COBRA generate_missing, por carpeta:
#   surfaces/   → fal SHEET_AI_MODEL (nano-banana-pro)  $0.15
#   faces/      → fal FACE_AI_MODEL  (gpt-image-2)      $0.17
#   characters/ → meshy sprite_skin_model               $0.24
# pack de 1 surface + 2 faces + 1 character:
#   cotizado (y presentado como EXACTO): 4 × $0.24 = $0.96
#   cobrado:            $0.15 + 2×$0.17 + $0.24 = $0.73      →  ×1,32
```
