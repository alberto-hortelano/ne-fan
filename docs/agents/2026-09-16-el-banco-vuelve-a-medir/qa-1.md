# QA — PR 1 de la tanda F: «los asertos viejos del banco» (#635, `f1/asertos-viejos-del-banco`)

Árbol `/home/al/code/ne-fan-qa-f1`, desprendido en `7c40c739` (sobre `main` = `14c760fa`).
Todo lo de abajo está MEDIDO en ese árbol, con el motor falso del runner (`e2e-sin-creditos`),
**cero créditos** (`puertas: —` en los tres guiones que tocan alguna) y sin parar el stack de nadie.

**VEREDICTO: APTO CON HALLAZGOS.** Los cuatro guiones están verdes de verdad —los cinco asertos
reescritos se ponen ROJOS con mutantes que he buscado yo, distintos de los del ingeniero— y el
hallazgo grande de la PR (el 82 estaba verde sin poder ponerse rojo) lo he **reproducido por mi
cuenta**. Lo que falla es el barrido: la frase falsa que la PR vino a corregir **sigue viva en ocho
sitios de cinco ficheros** (H-1), la fila del README del propio guion 53 sigue describiendo el
aserto que esta PR borró (H-2), y la cobertura que la crítica declara «no perdida» tiene un hueco
medible (H-4).

---

## Criterios → evidencia

| Criterio (del encargo y de `requisitos.md`) | | Evidencia |
|---|---|---|
| Los cuatro guiones (129, 130, 53, 82) VERDES en el árbol de la PR | ✅ cumple | `node qa/run.mjs enemigo-malo-cae-solo lote-entero-invalido umbral-de-skins volver-al-titulo` → `4 en verde · 0 en rojo de 4`, EXIT=0. **Dos corridas independientes** (18:04 y 18:15), mismo resultado y mismo censo: no es un verde de una vez. Logs: `bateria-qaf1-base.log`, `bateria-qaf1-base2.log` |
| …y verdes **de verdad**: cada aserto reescrito puede ponerse ROJO | ✅ cumple | Cinco negativos MÍOS, ninguno copiado del informe (tabla «Pruebas en negativo propias» abajo). Los cinco asertos caen, y caen **por separado** donde deben |
| El aserto del 130, re-apuntado a `detalleTecnico`, sigue cayendo con **el mutante exacto de #529** (colapsar los tres motivos en uno) | ✅ cumple | T1: `avisoDeCriba` pasa `criba.descartes[0].motivo` a los tres → `✘ C · …y su diagnóstico nombra a los TRES con sus TRES motivos distintos` con el diagnóstico repitiendo `preferred_attacks` tres veces. EXIT=1 |
| …y **no lo sujeta el aserto vecino** del registro del jugador | ✅ cumple | En esa misma corrida T1: `✔ C · el motivo llega al REGISTRO del jugador`. El vecino sale **VERDE con el mutante puesto** → re-apuntar ahí habría hecho invisible el mutante. El aviso de la crítica era correcto y ahora está medido dos veces (ingeniero y QA, por separado) |
| La inyección del 82 **no mide un artefacto de sí misma** | ✅ cumple | Tres estados medidos: (a) inyección + sin defecto → VERDE, `POST desde «Volver al título»: []`; (b) inyección + defecto → ROJO con 2 POST (`idle`, `walk`, `role:null`); (c) **sin** inyección + defecto → **VERDE**. El rojo lo produce el defecto, no la inyección; y la inyección no genera ni un POST espurio en fase B. Código: un skin fallido **no se reintenta solo** (`character-sprites.ts:245-247`), así que no hay reintento rezagado que contaminar |
| El 82 sigue midiendo lo que su título promete | ⚠️ con reserva | Mide la rama «el skin de A acabó FALLIDO → la entrada de B lo re-paga». La otra rama (A con su skin entero) **no se puede medir y no se mide**: `requestSkin` es idempotente por prompt (`character-sprites.ts:242-271`) y B no re-pide nada haya `desvestir()` o no. Está declarado en la cabecera del guion y en el §7 del informe — **pero no en la fila del README** (H-3). Ver también la reserva de identidad más abajo |
| El censo de gasto sigue siendo honesto (`/skin_sprite_sheet` ×3 → ×1) | ✅ cumple | Medido en las dos corridas: `82 … gasto: /skin_sprite_sheet×1`. El ×3 lo reproduje en la corrida sin inyección (`gasto: /skin_sprite_sheet×3`), o sea el delta está explicado entero por los dos `fulfill` del borde. El guion **sigue apareciendo** en el censo. No hay ningún baseline de censo commiteado que quede desfasado (`banco-medido.json` solo exime `qa/lib/*.mjs`) |
| La cobertura del fusible #236 que se declara «no perdida» | ❌ NO cumple | `qa/guiones/51-…:142-146` afirma `canceladas === fallidos.length` con sujeto no vacuo (el bloque 1 del 51 exige `caido.failed`), **pero con N = 1**: `personajes fallidos: 1 · líneas «cancelada»: 1`. El bloque D viejo del 53 lo afirmaba con **N = 5**. Ver H-4 |
| Las ocho filas nuevas (135-142) existen y son correctas | ✅ cumple | `qa/README.md:486-493`. Cada fila casa con un fichero real: `comm` entre las 97 filas y los 141 guiones → **0 filas huérfanas** |
| «No consta prueba en negativo» en siete de las ocho: ¿es cierto guion por guion? | ✅ cumple | Comprobado en TRES sitios por guion: cabecera del `.mjs` (`grep -i "en negativo\|sabotaj\|rojo"` → solo `140-…:4`), `docs/agents/**` (0 menciones para los siete) y el **commit que los introdujo** (#620, #622, #624, #626, #627, #629, #630 → ninguno declara negativo). La fila no miente por omisión |
| Las dos cabeceras corregidas (53 y 82) | ✅ cumple | `53:29-46` y `82:215-223` ya nombran `animDelBanco` / `HOJAS_BASE_ANIMS` y #627/#498 |
| **`grep` a cero** de la frase falsa en el resto del árbol | ❌ NO cumple | **Diez** sitios vivos en cinco ficheros, y en dos de ellos (`51:180-184`, `15:32-33`) la premisa caducada es la razón escrita por la que ese guion mide de menos. Ver H-1 |
| Cero producción en el diff | ✅ cumple | `git diff --stat main...HEAD` → 5 ficheros, +198 −44, todos bajo `qa/`. Ni un fichero de `nefan-core`, `nefan-html`, `bridge`, `labs`, ni un umbral (`quality-thresholds.json`, `arch-rules.json`, `client-file-size.json` sin tocar) |
| `npm run verify` verde | ✅ cumple | `EXIT=0 · tests 2911 · suites 515 · fail 0` (incluye `esperas-que-conducen.test.ts`, que lee **todo** `qa/**.mjs`: ninguna de las esperas reescritas conduce al jugador, así que no pedía exención) |
| Sin daño colateral en el vecindario que comparte subsistema | ✅ cumple | `node qa/run.mjs npc-clave-del-skin personajes-animados guardia-se-ve un-personaje-caido enemigo-que-no-sirve fusible-rearmado banco-viste-todas` → **7 en verde · 0 en rojo**, EXIT=0 (guiones 07, 13, 15, 51, 90, 110, 139: los que tocan skins, fusible, registro y el aviso de criba) |
| Causa C (27 y 92) no tocada | ✅ cumple | El diff no roza `session-facets.ts`, `error-log.ts` ni `main.ts`. Fuera de mi encargo, no validada |
| Punto 4 del encargo — la tecla `P` en `CLAUDE.md` | ✅ cumple (fuera de esta PR) | `CLAUDE.md:175` tiene la fila, puesta por el commit `14c760fa`, ancestro de esta rama. Verificado contra el código: `ui/panel-de-plugins.ts:45-50` se ata con `alPulsarTecla` (puerta de JUEGO), ignora `repeat`/modificadores/`input,textarea,[contenteditable]` y `Escape` cierra — la fila dice exactamente eso |
| Gasto real de créditos | ⚠️ no probado | Todo contra el motor falso, por diseño. Nunca se llamó a un proveedor |

---

## Pruebas en negativo PROPIAS

Cinco mutantes buscados por mí, **ninguno de los cinco del informe**. Cada uno revertido con
`git checkout` y árbol limpio después (`git status --porcelain` vacío).

| # | Mutante (dónde, qué) | Resultado | Qué demuestra |
|---|---|---|---|
| **T1** | `criba-de-hostiles.ts` · `avisoDeCriba` reparte `criba.descartes[0].motivo` a los tres | `✘` el aserto de los TRES motivos · `✔` el registro del jugador · `✔` el log del bridge · `✔` «3 de 3» | El mutante EXACTO de #529 sigue cazado desde `detalleTecnico`, y el vecino del registro **no lo sujeta** |
| **T2** | `criba-de-hostiles.ts` · `avisoDeHostilDescartado` pierde el MOTIVO (conserva el id) | `✘` DIAGNÓSTICO (129) · `✔` LÍNEA DE JUEGO («1 de 3») | La mitad «diagnóstico» del 129 cae sola. (El registro cae de rebote: `main.ts` vuelca ese mismo campo — colateral honesto) |
| **T3** | `criba-de-hostiles.ts` · el `message` cuenta `criba.altas.length` en vez de los descartes | `✘` LÍNEA DE JUEGO («2 de 3») · `✔` DIAGNÓSTICO · `✔` registro | La mitad «línea de juego» cae sola. **Partir el aserto del 129 en dos no fue cosmético**: T2 y T3 caen en mitades distintas |
| **T4** | `character-sprites.ts` · `AUTO_SKIN_ANIMS = ["idle"]` (el cliente deja de pedir el set completo) | `✔` los CINCO se visten · `✔` registro limpio · **`✘` las tres anims LISTAS** · A/B/C verdes | El tercer aserto nuevo del bloque D tiene poder **propio**: caza justo lo que declara («no falla» ≠ «no pidió nada»), y los otros dos no lo ven |
| **T5** | `aspecto-del-jugador.ts:168` · `desvestir()` con el cuerpo vacío (el VERBO, no la llamada de `main.ts:405`) | `✘✘` los dos asertos de B, con **2 POST** (`idle`, `walk`, `role:null`) del prompt de A | El 82 mide el verbo, no la presencia de una línea en `main.ts`. Mismo par de POST que midió QA el 2026-09-06 |
| **T5′** | T5 **+ la inyección de esta PR retirada** del `page.route` del 82 | **VERDE**, EXIT=0, `POST desde «Volver al título»: []`, `gasto ×3` | **El hallazgo grande de la PR, reproducido por QA con otro mutante**: sin la inyección el guion no puede ponerse rojo. Y el libro de B sale con el jugador de A dentro y **vestido** (`ready:["idle","walk","run"]`) sin que nada proteste |

---

## Hallazgos

### H-1 · IMPORTANTE — la frase falsa NO está a cero: **diez** sitios vivos en cinco ficheros, y dos guiones miden de menos por su culpa

El punto 2 de `requisitos.md` pide corregir la justificación «el motor falso solo tiene `idle` y
contesta **500** a `walk`», que desde #627/#498 es falsa. La PR corrige **dos** (las cabeceras del 53
y del 82) y deja **ocho** más, todas en **presente** y todas en ficheros vivos de `qa/`:

| Sitio | Qué dice | Por qué importa |
|---|---|---|
| `qa/guiones/51-…:180-184` | «en el banco toda hoja que no sea `idle` da 500, así que el personaje recuperado vuelve a quedar `failed` en cuanto pide `walk`… **exigir `failed:false` sería exigir que el motor falso tuviera hojas que no tiene**» | **El peor de los diez.** Es la razón escrita por la que el bloque 4 del 51 mide el DELTA de arte en vez del estado final. Hoy el banco SÍ tiene esas hojas, o sea que el guion **puede** afirmar `failed:false` y no lo hace, por un motivo que caducó |
| `qa/guiones/15-…:32-33` | «GOTCHA del bench, **y por eso la parte 1 se mide al final y con la fixture**: el motor falso solo tiene hoja `idle` y responde 500 a `walk`» | Igual de load-bearing: justifica la estructura entera del guion (pestaña nueva + leer el libro en vez del cable) |
| `qa/guiones/15-…:285-286` | «contra el bench, el motor falso solo tiene hoja `idle` y el cortacircuitos corta la cola» | La otra mitad de esa misma justificación |
| `qa/guiones/110-…:194-196` | «Sin esta máscara, el motor falso (que solo tiene `idle`) **tumbaría a todo el pueblo**» | Falso hoy: sin máscara no tumba a nadie — es exactamente lo que el bloque D reescrito acaba de MEDIR (`vestidos 5/5 · fallidos 0`) |
| `qa/guiones/110-…:29-30` | «Las anims **que el motor falso no tiene** se mascaran con 404» | Hoy las tiene todas (mapeadas a `idle`) |
| `qa/guiones/07-…:134-136` | «el fake solo tiene hoja `idle` y contesta 500 a `walk`, y ese fallo marca al PERSONAJE» | Justifica sustituir una igualdad por dos afirmaciones más débiles |
| `qa/README.md:415` (fila del **51**) | «en el banco toda hoja que no sea `idle` da 500… exigir hojas que el motor falso no tiene» | La fila repite la premisa caducada del guion |
| `qa/README.md:417` (fila del **53**) | «sin ese 404 el motor falso (que solo tiene hoja `idle`) tumba a los cinco y el umbral se alcanza solo» | Ver H-2 |
| `qa/README.md:395` (fila del 15) | «el motor falso solo tiene hoja `idle` y su 500 en `walk` apaga los skins de la sesión entera» | Igual |
| `qa/README.md:467` (fila del 110) | «404 de máscara a lo que el motor falso no tiene» | Versión suave de lo mismo |

**Reproducción**, y es re-ejecutable: `node el-banco-dice-lo-que-mide.mjs --raiz <árbol>` (ver
«Lo que dejo ejecutable»), que saca nueve de los diez. El décimo (`51:181`) lo encontré a mano
después, con `grep -n "idle\|500" qa/guiones/51-*.mjs`: está escrito con otras palabras («toda hoja
que no sea `idle` da 500») y ningún patrón razonable sobre prosa las cubre todas. Eso es un límite
del checker, declarado.

**Qué esperaba**: que una retirada incluya el barrido de la prosa que la nombra —la regla de la casa
y la lección escrita de `feedback_rastros_confunden_a_los_agentes`—. Aquí no es solo higiene: en el
51 y en el 15 la premisa muerta es **la razón por la que esos dos guiones miden menos de lo que
podrían**. El precio de dejarlo, además, es el de siempre: el próximo que escriba un guion de skins
copiará la máscara de 404 del 110 con un motivo que ya no es verdad.

### H-2 · IMPORTANTE — la fila del README del guion 53 describe el aserto que esta PR borró

`qa/README.md:417` sigue diciendo, del guion 53:

> «…y que **en el banco sin sabotear ni un fallo se queda mudo**»

Ese es, palabra por palabra, el aserto que la PR **sustituye** por su contrario («los CINCO vecinos
se visten y NINGUNO cae»). La PR edita `qa/README.md` —añade ocho filas al final— y no toca la fila
del guion que está reescribiendo. Quien lea el README para saber qué protege el 53 lee hoy la
conducta de antes de #627.

La misma fila repite además la premisa falsa de H-1. **Dos defectos en una sola línea, en un fichero
que la PR ya tiene abierto.**

**Reproducción**: `sed -n '417p' qa/README.md`.
**Qué esperaba el lector**: que la fila de un guion diga lo que el guion afirma hoy.

### H-3 · IMPORTANTE — la fila del 82 declara una prueba en negativo que estuvo FALSA, y no nombra la condición que la sostiene

`qa/README.md:442` termina con:

> «**PROBADO EN NEGATIVO**: sin `aspecto.desvestir();` en `resetWorld` → dos POST (`idle`, `walk`)
> del prompt de A al entrar B y los dos asertos de B en rojo.»

Entre #627 y esta PR esa frase era **falsa** — lo he medido yo (T5′: el sabotaje sale VERDE). Hoy
vuelve a ser cierta, pero **solo** por la inyección que esta PR añade en el `page.route`, y la fila
no la menciona: describe el mecanismo («el OFF→ON de la entrada de B…») como si bastara. Un lector
del README concluiría que el guion tiene un poder que en realidad depende de una línea añadida ayer,
y que volvería a perder si alguien quitara la inyección «porque el banco ya sirve todo».

Es el mismo modo de fallo que la PR vino a arreglar, una capa más arriba: **el candado está en el
guion y la promesa está en el README, y no se movieron juntos.**

**Qué falta en la fila**: que la condición medida es «el skin de A acabó FALLIDO», que la inyecta el
guion, y que la rama «A con su skin entero» no se mide porque `requestSkin` es idempotente.

### H-4 · IMPORTANTE — la cobertura del fusible #236 SÍ pierde poder, aunque no pierda el aserto

La crítica (§3) y `requisitos.md` (punto 2) despachan el bloque D viejo con «la cobertura NO se
pierde: `51:143-146` ya afirma `canceladas === fallidos.length`». **El aserto está; el sujeto, no.**

Medido: en el guion 51 ese aserto corre con **N = 1** (`personajes fallidos: 1 · líneas «cancelada»:
1 · líneas «desactivados para la sesión»: 0`, corrida de hoy). El bloque D viejo del 53 lo corría con
**N = 5** (el banco tumbaba a los cinco).

La diferencia no es cosmética. El comentario de producción dice para qué existe la propiedad
(`nefan-html/src/renderer/character-sprites.ts:321-325`):

> «UNA entrada por fallo, SIEMPRE. Antes esto era un if/else cuya **rama muda** —un 5xx con el flag
> de sesión ya puesto— no escribía nada»

Con **N = 1** esa regresión es invisible: el único fallo es siempre el primero. Hace falta N ≥ 2 para
distinguir «una entrada por fallo» de «una entrada por el primer fallo». Y hoy no la mide nadie más:

- `53` bloques A/B/C: **no afirman `canceladas`** en ninguno (solo `vestidos` y `apagones`).
- `53` bloque D nuevo: afirma `canceladas === 0`, que es el caso sin fallos.
- `110`: inyecta tres 500 pero no afirma el recuento de entradas (`grep -rn "cancelada" qa/guiones/` → **solo el 51**).
- `nefan-core/test`: no hay ningún test de `CharacterSpriteManager` ni de `enqueueAnim` (`grep -rln "character-sprites" nefan-core/test` → 0).

**Esto es exactamente el hueco que el punto 2 pedía «declarar por escrito», y la declaración que la
PR escribió dice lo contrario** (`53:388-398`: «El rango del fusible de #236 NO se pierde»).

Salida barata, si se quiere recuperar en vez de declarar: el bloque **C** del 53 ya tiene 3-5
personajes caídos y `foto()` ya calcula `canceladas` y `fallidos` — una línea
(`f.canceladas === f.fallidos`) devuelve N ≥ 3 a la propiedad sin guion nuevo. Yo no la he escrito:
no arreglo nada.

### H-5 · MENOR — el informe declara «cierta» una nota del README que es falsa por un factor de nueve

`implementacion-1.md:77-79`: «La nota del final del README (guiones sin fila: 19, 20, 131, 132, 133)
**vuelve a ser cierta** con estas ocho puestas».

Medido: **44 de los 141 guiones no tienen fila** (ni la tienen ni se les menciona en el fichero).
Entre ellos, el 18 y el 21, que la propia nota da por resueltos («la nota anterior decía «18–21» y
llevaba caducada desde que esos dos SÍ la tuvieron»).

```
$ for f in qa/guiones/*.mjs; do b=$(basename $f .mjs); grep -qF "$b" qa/README.md || echo "$b"; done | wc -l
44
```

La nota ya era falsa **antes** de esta PR (52 sin fila), así que el repo no empeora: la PR mejora el
número. Lo que es un hallazgo es la afirmación **sin medir** en el documento de handoff, sobre la
misma línea que el fichero avisa de que hay que volver a mirar cada vez. Es la lección
`feedback_la_medida_de_hoy_hay_que_medirla` otra vez, y la crítica ya había acotado el alcance
(«no arrastres revisar el README entero»): bastaba con **no** declararla cierta.

### H-6 · MENOR — el segundo aserto nuevo del bloque D no puede ponerse rojo por su cuenta

`53` bloque D afirma tres cosas. La segunda —«el registro queda LIMPIO: `canceladas === 0 &&
apagones === 0`»— está **implicada** por la primera (`fallidos === 0`): la entrada de cancelación y
el conteo del fusible se escriben en el MISMO `catch` que pone `state.failed = true`
(`character-sprites.ts:319-340`), así que `canceladas > 0 ⇒ fallidos > 0`.

Medido en las dos direcciones: con mi T4 los asertos 1 y 2 salen verdes juntos; con el N3 del
informe salen rojos los tres juntos. No he encontrado ningún mutante que ponga rojo el 2 dejando
verde el 1.

No es un defecto —es el mismo hecho dicho en el canal del jugador, que es legítimo— pero **no son
tres propiedades, son dos y un eco**. Importa porque el comentario del guion presenta las tres como
«hacen falta tres».

### H-7 · MENOR (riesgo) — las dos esperas nuevas se acoplan a `queued`, que puede crecer solo

Tanto `53` bloque D como `82` esperan ahora a que **todo lo encolado** esté listo
(`s.queued.every(a => s.ready.includes(a))`). `queued` no es solo el set automático: `modelFor`
encola perezosamente cualquier anim fuera de `AUTO_SKIN_ANIMS` la primera vez que una entidad entra
en ella (`character-sprites.ts:358-366`). Si un vecino de `robledo_tile` entrara alguna vez en una
anim así, la espera del bloque D expiraría a los 90 s por una razón que no tiene nada que ver con lo
que mide.

No ocurrió en ninguna de mis tres corridas del 53 (la espera resolvió siempre), y la condición
anterior (`ready.length > 0`) era peor por el otro lado —leía el libro a media cola—, así que el
cambio es una mejora neta. Queda escrito como lo que es: un acoplamiento nuevo, no una regresión
medida.

### H-8 · MENOR (arte) — la captura del bloque D no enseña lo que el bloque ahora afirma

`53-…-04-banco-sin-mascara.png`: la cámara está pegada a un prisma marrón sin textura que se come un
tercio del encuadre y **no se ve ni uno** de los cinco vecinos cuyo vestido es ahora la afirmación
central del bloque (solo el rótulo «Guardia Roric» a lo lejos, sobre una figura de pocos píxeles).
La captura es idéntica a la de antes de la PR —el punto de disparo no cambió— así que no es una
regresión; pero el bloque pasó de retratar un fracaso («todos en maniquí») a retratar un éxito
(«todos vestidos») y su única prueba visual no lo muestra. Un retrato que hay que creerse por el
JSON no es un retrato.

---

## Reservas que no son hallazgos, pero conviene que estén escritas

- **Lo que el 82 dejó de cubrir, y el informe declara**: la rama «A con su skin entero». No es un
  agujero de dinero (por idempotencia, B no re-pide nada), **sí** es un agujero de identidad: en mi
  corrida T5′ el libro de B quedó con el jugador de A dentro y **vestido**
  (`ready:["idle","walk","run"]`) y ningún aserto protestó. O sea que «el jugador de B aparece con la
  armadura de A» es hoy un estado alcanzable y no medido. El informe lo propone como aserto sobre
  `aspecto.skinPrompt()` y no lo hace; me parece la decisión correcta para esta PR, pero merece issue.
- **La máscara del 53 sí se gana el sitio, y por la razón nueva.** Verificado en la traza real de la
  corrida: en el bloque A los cuatro vecinos «sanos» reciben `404 walk` y quedan `failed`, así que
  `apagones === 0` solo puede salir verde si los 4xx no gastan evidencia (5 caídos ≥ umbral 3). La
  re-justificación de la cabecera no es prosa escrita después.
- **El candado de #497 (`82:257-259`) se ejecuta y pasa** en las cuatro corridas del 82 que hice hoy
  (dos limpias, dos con mutante). Confirma que la contradicción con el guion 27 que describe la
  crítica es real y viva, no un guion roto. No lo he tocado.

---

## Lo que dejo ejecutable

De lo que he comprobado, dos cosas son mecánicas y se pueden volver a correr; el resto es juicio y
se queda en este informe. Están en un solo ejecutable **headless** (no abre navegador, no arranca
stack, no gasta un céntimo):

```
/tmp/claude-1000/-home-al-code-ne-fan/273328d5-3414-4aea-9086-e8ac99d49ac2/scratchpad/el-banco-dice-lo-que-mide.mjs
```

| Pregunta | Salida de hoy sobre el árbol de la PR |
|---|---|
| 1 · ¿queda alguna frase EN PRESENTE que diga que el banco solo sirve `idle`? (la mención en pasado no cuenta) | **9 sitios** — H-1 |
| 2 · ¿tiene cada guion su fila en `qa/README.md`? | **44 de 141 sin fila** — H-5 |

**Probado en negativo**, que es lo que distingue un checker que funciona de uno que no mira nada:
`node el-banco-dice-lo-que-mide.mjs --autoprueba` fabrica en un temporal un árbol SANO (una frase
corregida en pasado, un guion con su fila) y exige VERDE; luego le planta **una** frase muerta y
**un** guion sin fila y exige exactamente **2** violaciones, una por pregunta. Salida real:

```
autoprueba · árbol sano → 0 violación(es) ✔
autoprueba · el mismo árbol con UNA frase muerta y UN guion sin fila → 2 violación(es) ✔ (una por pregunta)
EXIT=0
```

**Lo dejo fuera del repo a propósito, y no es pereza**: (a) nace en ROJO con 53 ocupantes, y meterlo
como candado exigiría un techo congelado de no-empeorar para la pregunta 2 —decisión del arquitecto,
no de QA—; (b) añadir un fichero a `qa/` cambiaría el diff de la PR que estoy validando, y un
ejecutable nuevo de `qa/` pide su sección de README y su fila en `candados-headless`, que es la
misma deuda que estoy reportando. Si el coordinador lo quiere adoptado, es trabajo del ingeniero y
cabe en su propia PR.

## Workarounds usados

| Workaround | Veredicto |
|---|---|
| `npm ci` en `narrative-mcp/`, que faltaba en mi árbol: sin él `npm run verify` moría en `../narrative-mcp/validators.ts(15,8): Cannot find module '@nefan/core'` | **No afecta al jugador ni a la PR**: es un hueco del montaje de MI worktree frente a la receta de `docs/agents/README.md` (cuatro paquetes, no tres). Con los cuatro instalados, `verify` sale EXIT=0. Queda anotado para el coordinador: el árbol se entregó con tres |
| Mutar ficheros de producción para las pruebas en negativo | No es workaround, es el método. Los cinco revertidos con `git checkout`; `git status --porcelain` vacío al terminar y antes de cada corrida limpia |

**Ninguno de la clase prohibida**: no he ocultado un overlay, ni forzado estado sintético, ni
saltado una pantalla, ni bajado un umbral, ni parado el stack de nadie.

---

## No probado

- **La batería completa (141 guiones, ~2 h).** Corrí los 4 de la PR ×2, los 7 del vecindario que
  comparte subsistema (skins, fusible, registro, aviso de criba) y 6 corridas de negativos. El diff
  es `qa/README.md` + cuatro guiones, sin estado compartido entre ficheros de guion, así que el
  riesgo de colateral está acotado por construcción y medido donde podía haberlo. Si el coordinador
  quiere el número de la batería antes de fusionar, es una corrida entera que no he hecho.
- **La causa C (guiones 27 y 92).** Fuera de mi encargo por escrito. Siguen rojos.
- **Los guiones 39 y 75**, fuera de la tanda y sin issue abierto, según `critica.md`.
- **Gasto real de créditos.** Todo contra el motor falso.
- **Las siete filas del README sin prueba en negativo declarada**: he verificado que la declaración
  («no consta») es CIERTA, no que los guiones no la resistan. Comprobarlo es una pasada aparte, guion
  a guion.

---

## Veredicto

**APTO CON HALLAZGOS.**

Lo que la PR prometía, lo cumple y lo cumple bien: los cuatro rojos están verdes por la conducta
nueva y no por un aserto ablandado, los cinco asertos reescritos se ponen rojos con mutantes que no
son los suyos, el aserto con historia del 130 sigue cazando su mutante y se ha demostrado —dos veces
y por separado— que el vecino no lo sujetaba, y el hallazgo que salió de medir (el 82 verde sin poder
ponerse rojo) es real, está bien diagnosticado y su arreglo funciona sin medir un artefacto de sí
mismo.

Lo que impide un APTO limpio son tres cosas del mismo tipo, y las tres son barridos que la PR tenía
al alcance de la mano en ficheros que ya estaba editando: **H-1** (la frase falsa sigue en ocho
sitios más, y en dos de ellos —`51:180-184` y `15:32-33`— es la razón escrita por la que ese guion
mide de menos de lo que ya podría medir), **H-2** (la fila del README del 53 describe el aserto que
esta PR borró) y **H-4** (la cobertura del fusible no se pierde de forma, pero sí de poder: N = 1
donde antes había N = 5, y la PR lo declara por escrito al revés).

H-1, H-2 y H-3 son ediciones de prosa de media hora. H-4 es una línea en el bloque C del 53, o una
frase honesta que diga qué se perdió. Nada de esto toca producción ni pide decisión del usuario.
