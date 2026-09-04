# QA-A · PR-A «la corrida trae su propio ancla y su propio sello» (#381 + #420)

Validado sobre `89c9dee` (rama `t10/ancla-y-sello`), worktree `/home/al/code/ne-fan/.claude/worktrees/qa-t10-a`.
Diff: 5 ficheros, +412/−63 — `.github/workflows/mutation.yml`, `nefan-core/scripts/mutacion-huella.ts`,
`nefan-core/scripts/mutacion.ts`, `nefan-core/test/mutacion-huella.test.ts`,
`qa/mutacion-candados-en-negativo.mjs`.

El sujeto no es el juego, así que «quien juega» aquí es **quien opera el ciclo de mutación**: el
ingeniero que pide una corrida y el coordinador que la reparte. No se ha arrancado ningún preset, no
se ha abierto un puerto, no se ha gastado un crédito y no se ha lanzado mutación de ninguna clase
(ni `mutate`, ni `local`, ni `traer`). Ninguna llamada de red.

**Entregables:** este documento, `qa/mutacion-cableado-en-negativo.mjs` (guion nuevo, 8 invariantes,
8/8 rojos) y su entrada en `qa/README.md`.

---

## 1. Criterios, uno a uno

### Del criterio de aceptación del usuario (`requisitos.md`)

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Los dos módulos de #419 vuelven a su suelo con el número | ⚠️ fuera de PR-A | PR-A no toca `src/**` ni `data/contract/mutation-targets.json` (`git show --stat 89c9dee`). Es de PR-B1 + la corrida posterior |
| 2 | Cada módulo nuevo sale con su `break` a la medida y commiteado | ✅ no aplica, verificado | PR-A no estrena ningún módulo: el contrato no está en el diff |
| 3 | Los candados de #381 y #420 se han visto **ROJOS** antes de darse por buenos | ✅ | Rehechas por QA, no leídas del informe: 11 reversiones sobre `mutacion-huella.ts`, 9 rojas (§2). Incluye las cuatro del ingeniero **y cinco que él no probó** |
| 4 | `contrato-escena` deja informe, o hay issue con dueño | ⚠️ no probado | Depende de una corrida autorizada, prohibida para mí. Sigue sin informe en el artefacto en disco (`corrida.json` de `33790710680`: 33 pedidos, 32 con informe) |
| 5 | **Ningún umbral subido** | ✅ | El diff no toca `mutation-targets.json` (`tope_local` sigue 120, 33 módulos) ni `quality-thresholds.json`. `npm run coverage && npm run crap -- --check` → `CRAP ≤ 73 — 0 por encima · cobertura 89.3% ≥ 89% · ✔ dentro de los umbrales` |

### De los criterios de verificación del plan (§7, columna «sin corrida»)

| Criterio | Veredicto | Evidencia |
|---|---|---|
| #381 · `atribuir` sobre rango vacío → veredicto `"rango vacío"`, no `"sin dueño"` | ✅ | Reversión A (colapsar la rama del rango vacío) → 2 tests rojos: `RANGO VACÍO no se colapsa con SIN DUEÑO…` y `con rango vacío ningún módulo tiene dueño…` |
| #381 · el tipo de `rangoDe` no admite lista vacía | ✅ | Reversión B (`{tipo:"commits", commits: []}`) → `typecheck:scripts` **exit 2** |
| #381 · la ETIQUETA tampoco se colapsa | ✅ (**el ingeniero no probó ésta**) | Reversión N4: dejar el veredicto y poner `etiqueta: "sin dueño en el rango"` → rojo (`doesNotMatch /sin dueño/`) |
| #420 · manifiesto con hash X + informe con hash Y → error que **nombra el módulo** | ✅ | Reversión C (`const suplantados: string[] = []`) → 3 tests rojos. Reversión D (el mensaje deja de listar los módulos) → los mismos 3 rojos |
| #420 · mismo hash → cero errores | ✅ | `it("mismo nombre y mismo sello pasa…")` verde en la base; y contra la herramienta real, `repartir` pasa el guardia con el manifiesto escrito por `manifiesto` (§3) |
| «Visto rojo antes de darlo por bueno» | ✅ | 87/87 en `test/mutacion-huella.test.ts` en la base; cada reversión medida por separado y restaurada byte a byte |

### Del encargo de QA (flujo real del operador)

| Criterio | Veredicto | Evidencia |
|---|---|---|
| `npm run mutacion -- pendiente` sigue funcionando | ✅ | `Pendiente de medir desde mutacion-ultima (7b817b9, 2026-09-02) · 14 commit(s) sin medir` |
| El verbo nuevo `ancla` imprime una línea usable en un `$( )` | ✅ | `npm run --silent mutacion -- ancla \| cat -A` → `7b817b98e258b8b9ae82be1a79747d35ef0a5fa1$` — una línea, sin adornos |
| `repartir` sobre el artefacto REAL de `33790710680` (formato viejo) lo rechaza | ✅ | `Error: el manifiesto de reports/mutation/corrida.json no trae: desde (el ancla del rango), informes (el módulo y el sello de cada informe). …` |
| …y el mensaje **dice qué hacer** | ✅ con reserva | Dice «Lanza una corrida nueva y bájala», que es una acción — pero no cita el comando (`npm run mutacion -- traer`) como sí hace el error hermano, y la acción cuesta ~131 min de runner y una autorización humana. Ver Menor 5 |
| `npm run verify` verde | ✅ | `tests 1987 · pass 1987 · fail 0` (la afirmación del ingeniero, reproducida) |
| `qa/mutacion-candados-en-negativo.mjs` 28/28 | ✅ | Reproducido: `Invariantes probados en negativo : 28 · Se ponen rojos al romperlos : 28 · NO se enteran : 0` |
| Cero mutación, cero créditos, sin matar procesos ajenos | ✅ | Ningún `mutate`/`local`/`traer`/`gh`; ningún puerto abierto |

### Pasada adversarial (los casos que pidió el encargo, y algunos más)

| Caso | Veredicto | Evidencia |
|---|---|---|
| `corrida.json` con `desde` pero **sin** `informes` | ✅ | `…no trae: informes (el módulo y el sello de cada informe)` — nombra solo el que falta |
| `desde: ""` (presente pero vacío) | ✅ | `…no trae: desde (el ancla del rango)` |
| `informes` que no es un array (objeto) | ✅ | mismo rechazo, por `Array.isArray` |
| `sha256` en **MAYÚSCULAS**, mismo contenido | ⚠️ falso positivo | Se acusa de suplantación un informe que **es** el de la corrida. Ver Menor 2 |
| Un informe que **falta** + otro que **sobra** + un tercero **suplantado**, a la vez | ✅ | Tres errores separados, cada uno nombrando el suyo: `declara 1 informe(s) que no vienen… status-reparto` · `hay 1 informe(s) que esta corrida no generó: sprite-census` · `1 informe(s) NO son los que midió la corrida 999001: apuntado` |
| `origen: "explicito"` con rango vacío (legítimo) | ✅ | No lanza; reparte y dice `hostiles → sin rango que mirar (la corrida no tenía commits sin medir)` + `1 módulo(s) sin RANGO que mirar… No son «sin dueño»: nadie los ha buscado` |
| `origen: "rango"` con rango vacío (contradicción) | ✅ | `Error: la corrida 999002 dice haber medido el RANGO desde 81a7ce0 hasta 81a7ce0, y ese rango no tiene ni un commit…` |
| Verbo `ancla` **sin tag** | ✅ | `Error: no existe el tag "…": sin él no se puede saber qué se midió la última vez. Créalo en el commit de la última corrida conocida (git tag … && git push origin …)` |
| `manifiesto --pedidos ""` (el input `TODOS` del workflow) | ✅ | Escribe el manifiesto con los 33 del plan. Era un bug vivo de antes de la tanda y está arreglado |
| `manifiesto` sin `--desde` | ✅ | `Error: manifiesto necesita --desde` (y los demás flags siguen estrictos) |
| `--desde` con una revisión **inexistente** | ⚠️ | Se escribe sin queja; revienta el día del reparto con un error crudo de git. Ver Menor 4 |
| `origen` inválido en el manifiesto (`"banana"`) | ⚠️ | `leerCorrida` no lo valida: reparte normal e imprime `(937c16d..7b817b9, banana)`. Ver Menor 3 |
| `modulos_pedidos` ausente | ⚠️ | `TypeError: Cannot read properties of undefined (reading 'filter')` en vez del mensaje accionable. Ver Menor 3 |
| El sello, **end to end** con la herramienta: manifiesto escrito por `manifiesto`, luego el informe reescrito (lo que deja un `local`) | ✅ | `repartir` se niega: `1 informe(s) NO son los que midió la corrida 999020: hostiles — el nombre casa y el contenido no` |
| El mismo caso pero con un cambio **semántico** (`"Survived"` → `"Killed"`) | ✅ | Rechazado igual |

---

## 2. La carencia declarada: es cierta, y no es una línea — son SIETE

El ingeniero declaró una: «el invariante *`repartir` ancla en `corrida.desde` y no en el tag* no lo
defiende ningún test». **Confirmado**: ningún fichero de `test/` importa `scripts/mutacion.ts`
(`grep -rn 'from "../scripts/' test/` lista `afectado`, `arch-collect`, `crap-score`, `deuda`, `manifest-kinds-con-productor`, `mutacion-huella` y `mutation-plan`; `mutacion.js` no aparece), ningún test ni checker lee
`.github/workflows/mutation.yml`, y `npm run afectado -- --rango 89c9dee^..89c9dee` deja escrito que
`test/mutacion-huella.test.ts` «no está en la batería de ningún módulo».

Medí **cuánto más** está en esa situación revirtiendo, uno a uno, los cambios semánticos del diff y
corriendo la comprobación más barata que podría enterarse (`typecheck:scripts` + la batería entera).
Restauración byte a byte verificada al final.

| Reversión | ¿Se entera algo? |
|---|---|
| A · `atribuir` colapsa rango vacío en «sin dueño» | 🔴 rojo |
| B · `rangoDe` devuelve `commits: []` | 🔴 rojo (typecheck) |
| C · el sello deja de mirar (#420) | 🔴 rojo |
| D · el error del sello deja de nombrar el módulo | 🔴 rojo |
| N1 · `modulosConInforme` sale de `modulos_pedidos` | 🔴 rojo |
| **N2 · `sobran` se compara contra `modulos_pedidos`** (la regresión que arregló #418) | 🟢 **VERDE** |
| N3 · `rangoDe` devuelve siempre vacío | 🔴 rojo |
| N4 · el veredicto se conserva y la etiqueta se colapsa | 🔴 rojo |
| **N5 · el sello se compara ignorando mayúsculas** | 🟢 **VERDE** |
| N6 · `Corrida.desde` pasa a opcional | 🔴 rojo (typecheck) |
| N7 · los tres fallos del guardia se funden en uno | 🔴 rojo |
| **R1 · `repartir` vuelve a `shaDelTag()`** (el bug LITERAL de #381) | 🟢 **VERDE** |
| **R2 · se retira el «rango vacío con origen `rango` LANZA»** | 🟢 **VERDE** |
| **R3 · `leerCorrida` deja de validar `desde`/`informes`** | 🟢 **VERDE** |
| **R4 · `selloDeInforme` devuelve una constante** (el sello deja de sellar) | 🟢 **VERDE** |
| **R5 · `informesEnDisco` cuenta `corrida.json` como informe** | 🟢 **VERDE** |
| **R6 · `manifiesto` guarda el sha medido como ancla** | 🟢 **VERDE** |
| **W1 · el workflow deja de leer y pasar el ancla** | 🟢 **VERDE** |

Ocho verdes en total: **siete son el cableado** que ejecuta los dos arreglos (R1–R6 y W1) y dos
—N2 y N5— viven en el fichero puro, donde sí hay batería y lo que falta es un test. Dicho de otro
modo: **los dos issues que esta PR cierra se pueden deshacer, en la herramienta que se usa de verdad,
sin que `npm run verify` se inmute.** R4 es el más grave de los
ocho: todo el valor de #420 en la herramienta descansa en que `selloDeInforme` hashee el contenido
del fichero; si mañana alguien lo «optimiza» a hashear el nombre o el `mtime`, los nueve tests del
sello siguen verdes —comen sellos sintéticos— y el guion de negativos sigue diciendo 28/28.

**Matiz medido que mejora la declaración del ingeniero.** Él escribió «si alguien devuelve esa línea
a `shaDelTag()`, hoy nada se pone rojo solo». Es cierto para la batería, pero **en el camino de
diario la propia PR se protege a medias**: con `origen: "rango"` la reversión R1 hace que `repartir`
**lance** (el rango tag..sha sale vacío y salta la contradicción de R2). Lo comprobé contra la
herramienta con un manifiesto de ensayo (`desde=937c16d`, `sha=7b817b9`, el commit al que apunta el
tag):

```
── con corrida.desde (el arreglo) ──
Reparto de la corrida 999010 (937c16d..7b817b9, rango)
  hostiles  →  #402 o #401 o #398

── revertido a shaDelTag() (el bug de #381), origen «rango» ──
Error: la corrida 999011 dice haber medido el RANGO desde 937c16d hasta 7b817b9, y ese rango no
tiene ni un commit…

── revertido a shaDelTag(), origen «explicito» ──
  hostiles  →  sin rango que mirar (la corrida no tenía commits sin medir)
```

O sea: R1 y R2 se cubren mutuamente en el camino de diario, y **si se revierten los dos, o si la
corrida es `todos`/`explicito`, la atribución vuelve a desaparecer sin ruido** — con la cara de un
veredicto legítimo, que es la forma exacta de #381.

**Lo que he hecho con eso**: `qa/mutacion-cableado-en-negativo.mjs`, ocho invariantes del cableado
ejercidos contra el verbo de verdad sobre un `reports/mutation/` de ensayo, en las dos direcciones.
Probado en negativo (que es la única forma de saber que un candado no es prosa):

```
🔴 rojo   ancla · el reparto ancla en la corrida, no en el tag que ella misma movió (#381)
🔴 rojo   ancla · un rango VACÍO con origen `rango` es una contradicción y lanza
🔴 rojo   sello · el guardia mira el CONTENIDO del informe, no su nombre (#420)
🔴 rojo   sello · `corrida.json` no es un informe: sellarlo inventaría un módulo fantasma
🔴 rojo   formato · un `corrida.json` sin `desde` ni `informes` se rechaza DICIENDO qué falta
🔴 rojo   manifiesto · guarda el ANCLA que le dan, no el sha medido
🔴 rojo   manifiesto · `--pedidos` vacío significa TODOS, y los demás flags siguen siendo estrictos
🔴 rojo   workflow · el paso de selección LEE el ancla y el del manifiesto la PASA
Invariantes del CABLEADO probados en negativo : 8 · Se ven rotos al romperlos : 8 · NO se enteran : 0
```

No mide mutación, no abre puertos, no llama a `gh`, aparta y devuelve `reports/mutation/`, y verifica
byte a byte que los fuentes y la huella —que `repartir` reescribe por diseño— volvieron a su sitio.
Corrido dos veces, una con el directorio de informes vacío y otra con los 33 informes reales dentro:
`diff -rq` contra la copia de seguridad → idénticos.

Los dos verdes que quedan fuera del guion (N2 y N5) son hallazgos, no deuda del guion: viven en el
fichero puro, que es territorio de la batería, y ahí lo que falta es un test — ver Importante 3 y
Menor 2.

---

## 3. Hallazgos

### 🔴 Importante 1 · La carencia declarada existe, es siete veces mayor de lo declarado, y la declaración se borra al mergear

Los ocho verdes de §2. Además, la única constancia escrita de esa carencia está en
`docs/agents/…/implementacion-1.md`, y `.gitignore` deja fuera el informe de implementación por
regla de la casa: dentro de una semana no habrá rastro de que el arreglo de #381 en la herramienta no
tiene quien lo mire. Ni el código lo dice: `repartir` tiene un comentario que explica *por qué* el
ancla viene de la corrida, pero nada que diga que esa línea no la defiende nadie.

**Qué esperaba quien opera**: que una tanda cuyo lema es «las herramientas se miden» no dejara sin
medir la parte de la herramienta que ejecuta los dos arreglos.
**Reproducción**: `node qa/mutacion-cableado-en-negativo.mjs` sobre `89c9dee` **sin** el guion → los
ocho puntos de §2 se revierten y `npm run verify` sigue en 1987/0.
**Recomendación**: adoptar el guion (o un equivalente) en la PR, y citarlo en el `porque` o en la
cabecera de `mutacion.ts` para que la próxima persona sepa que existe.

### 🔴 Importante 2 · El bug de #381 sigue vivo aguas abajo: `npm run deuda` dice «sin dueño» de un rango que estaba vacío

`anotacionDeFichero` (`scripts/mutacion-huella.ts:628`) escribe
`` `${sigueNuevo} NUEVOS · ${base.duenos.length > 0 ? base.duenos.join(" o ") : "sin dueño en el rango"}` ``,
y la huella guarda `duenos: []` **igual** para «se miró el rango y nadie lo tocó» que para «no había
rango». El cuarto veredicto vive en `atribuir` y en la salida de `repartir`, y se pierde al escribir.

**Evidencia**: repartí una corrida con `origen: "explicito"` y rango vacío; `repartir` dijo
correctamente `sin rango que mirar`, y la fila que dejó en la huella es:

```json
{ "run": "999003", "total": 9, "vivos": ["25aff0457b1afe7e"], "nuevos": [],
  "base": "con base", "duenos": [] }
```

Con un superviviente NUEVO en esa fila, `deuda` diría «1 NUEVOS · sin dueño en el rango» sobre un
módulo al que nadie buscó dueño. Es exactamente la confusión que #381 arregla, un piso más abajo: una
no-medida con cara de resultado.

**Alcance real**: alcanzable con `origen: "todos"`/`"explicito"` + rango vacío + base comparable.
**El ingeniero lo declaró** en §7 de su informe — que no se commitea. Lo subo a hallazgo por eso y
porque la casa ya tiene precedente escrito («SIN BASE no es ni nuevo ni ya estaba»): si los tres
estados del delta merecieron ser inexpresables, los dos del dueño también.
**Recomendación**: issue con dueño, o un campo en `MedidaDeFichero`. No es de esta PR arreglarlo,
pero sí que quede escrito donde no se borre.

### 🟠 Importante 3 · El invariante que estableció #418 —el guardia compara contra `informes`, no contra `modulos_pedidos`— no lo defiende ningún test

Reversión N2: `const declarados = new Set(c.modulos_pedidos)` en vez de `modulosConInforme(c)` →
**los 87 tests siguen verdes**. Las tres fixtures de `descarga` que podrían cazarlo usan corridas con
`pedidos === informes`, y las dos que sí distinguen (`una corrida a la que se le CAYÓ un módulo…`,
`de una corrida caída sigue faltando…`) solo ejercen el lado de `faltan`.

**Por qué importa hoy y no en abstracto**: el caso que la reversión deja pasar es exactamente el que
esta tanda tiene vivo. `contrato-escena` se cayó en `33790710680` y no dejó informe; si alguien
corriera `local contrato-escena` encima de la descarga, el fichero aparecería en disco **sin sello
con el que compararlo** — no falta (no está declarado) y no puede estar suplantado. Hoy lo caza
`sobran`, y solo porque `declarados` sale de `informes`. Nada sujeta esa elección.
**Recomendación**: un test con `presentes` incluyendo un módulo *pedido y caído*.

### 🟡 Menor 1 · Prosa caducada que la PR deja mintiendo en `CLAUDE.md`

La tabla de verbos dice: «`traer` … rechaza una descarga en la que falte **o sobre** un informe».
Desde esta PR también rechaza la que traiga un informe **suplantado**, y `repartir` hace el mismo
guardia. Tampoco dice —ni en `traer` ni en `local`— que **un `local <id>` corrido encima de una
descarga bloquea el reparto hasta volver a bajar el artefacto entero**, que es un cambio real en el
día a día del ingeniero. El ingeniero lo vio y lo dejó fuera por carril; `CLAUDE.md` entra entero en
cada sesión, así que una tabla incompleta ahí cuesta más que en cualquier otro sitio.

### 🟡 Menor 2 · El sello se compara con distinción de mayúsculas, y el mensaje acusa de una causa que no ha comprobado

Un manifiesto con el `sha256` en mayúsculas del **mismo** contenido se rechaza como suplantado
(probado). Ningún productor de esta casa emite hexadecimal en mayúsculas, así que solo llega por
edición a mano — pero la reversión N5 (comparar `toLowerCase()`) tampoco la nota nadie, o sea que la
elección no está sujeta en ninguna de las dos direcciones.

Y el mensaje afirma la causa: «Es lo que deja un `npm run mutacion -- local` corrido encima de la
descarga». La cabecera del código sí enumera las tres (local, editado, truncado); el texto que lee el
operador, no. Un informe truncado en la descarga sale acusado de ser una medida local.

### 🟡 Menor 3 · El fail-loud de `leerCorrida()` cubre los dos campos nuevos y confía en el resto

- `origen: "banana"` pasa: `repartir` imprime `(937c16d..7b817b9, banana)` y reparte; y
  `veredictoDeCorrida` lo trataría como movedor del tag, porque solo excluye `"explicito"`.
- `modulos_pedidos` ausente → `TypeError: Cannot read properties of undefined (reading 'filter')`,
  no el mensaje accionable.

Es un fichero que escribe CI —donde `manifiesto` sí valida `--origen`—, así que el riesgo real es
bajo; lo anoto porque la cabecera de la función dice que un manifiesto no se lee «como se pueda», y
hoy se lee así para todo lo que no sean `desde` e `informes`.

### 🟡 Menor 4 · `--desde` es obligatorio en presencia, no en validez

`manifiesto … --desde 937c16d0` (revisión inexistente) escribe el manifiesto sin una queja, y la
verdad sale el día del reparto:

```
fatal: ambiguous argument '937c16d0..7b817b9…': unknown revision or path not in the working tree
Error: Command failed: git log --format=%H%s 937c16d0..7b817b9…
```

Es literalmente el modo de fallo que el comentario del propio código invoca para justificar que el
flag sea obligatorio: «deja el fallo para el día del reparto, cuando el runner ya no está». En CI el
valor viene de `ancla`, así que hoy no puede ocurrir; un `git rev-parse --verify` en `manifiesto`
cerraría el argumento entero.

### 🟡 Menor 5 · El rechazo del formato viejo no cita el comando, y su hermano sí

`leerCorrida()` tiene dos errores. El de «no hay `corrida.json`» termina en
`Baja una posterior: npm run mutacion -- traer`. El de «no trae `desde`/`informes`» termina en
«Lanza una corrida nueva y bájala», sin comando. Quien llegue de cero al segundo tiene que ir a
buscarlo.

### ⚪ Observación · Los errores salen como traza de Node

Todos los fail-loud de `mutacion.ts` llegan al operador con tres líneas de internals de Node delante
y una pila detrás. No lo introduce esta PR (es el estilo del fichero) y no lo cuento como hallazgo;
lo digo porque los mensajes están escritos con cuidado y la traza se los come.

### ⚠️ Riesgo operativo · el orden de merge es obligatorio y hoy solo consta en ficheros gitignorados

La corrida en vuelo `33866958770` corre con el workflow de `af336af`: su `corrida.json` **no** traerá
`desde` ni `informes`. Con PR-A mergeada, `leerCorrida()` lo rechaza —lo he reproducido con el
artefacto real de `33790710680`, que tiene la misma forma— y **no hay vía de recuperación** salvo
relanzar: ~131 min de runner y otra autorización. El orden correcto (bajarla, repartirla y commitear
la huella **antes** de mergear PR-A, con el tag devuelto a mano) está escrito en `plan.md` §8 y en
`implementacion-1.md` §7, y `.gitignore` excluye los dos. Lo repito aquí, que sí se commitea.

---

## 4. Workarounds usados, y su veredicto

| Workaround | Por qué | Veredicto |
|---|---|---|
| `npm install` en `nefan-core/` y en `narrative-mcp/` | El worktree venía sin `node_modules`, y `test/contract-fixtures.test.ts` falla con `ERR_MODULE_NOT_FOUND: '@nefan/core'` sin el segundo | De entorno, no de producto. Los dos `package-lock.json` restaurados con `git checkout`; el árbol quedó limpio |
| Copié los 33 informes de `33790710680` desde la copia del scratchpad | **El worktree NO los tenía**: `nefan-core/reports/mutation/` no existía, contra lo que decía el encargo | No afecta a quien opera (es material descargado, gitignorado). Restaurados al final y verificados con `diff -rq` contra la copia: idénticos |
| Edición temporal de `const TAG` en `mutacion.ts` para probar `ancla` sin tag | Los tags son compartidos entre worktrees del mismo repo y hay una corrida del usuario en vuelo: borrar `mutacion-ultima`, aunque fuera un segundo, es tocar material ajeno | Justificado. Es la única forma de ver esa rama sin arriesgar la corrida de otro. Restaurada y verificada |
| 18 reversiones a mano sobre `mutacion-huella.ts`, `mutacion.ts` y el workflow | Es el método: un candado que no se ha visto rojo es prosa | Todas restauradas; comprobación byte a byte al terminar y `git status` limpio |
| `git checkout -- data/contract/mutacion-huella.json` tras cada `repartir` de ensayo | `repartir` reescribe la huella **por diseño** | No es un obstáculo del operador: es lo que el verbo hace. Anotado en la cabecera del guion nuevo, que lo automatiza |

Ninguno de los cinco esconde un obstáculo que quien opera vaya a encontrarse. El único que casi lo
es —el informe viejo que hay que sustituir por una corrida nueva— **sí lo va a encontrar**, y está
reportado como riesgo operativo, no escondido como paso de receta.

---

## 5. Lo que NO he podido probar, y por qué

- **El viaje real del artefacto**: que los bytes de cada informe sobrevivan idénticos a
  `upload-artifact@v7` → `gh run download`, que es de lo que depende que el sello no dé un falso
  «suplantado» en los 33 módulos a la vez. Si alguna vez no casaran, `traer` **y** `repartir` se
  niegan y no hay bandera de escape; el consejo («vuelve a bajarla entera») no ayudaría. Exige una
  corrida real, prohibida para mí. **Es lo primero que hay que mirar en el próximo `traer`.**
- **El workflow ejecutándose**: que `npm run --silent mutacion -- ancla` dé una línea limpia en el
  runner, que `$GITHUB_OUTPUT` la transporte y que el input `TODOS` llegue hasta el manifiesto. Solo
  he podido comprobar que las cuatro piezas están escritas (invariante `workflow` del guion) y que el
  verbo hace su parte en local.
- **`traer` contra GitHub**: prohibido (red + corrida del usuario en marcha).
- **Criterios 1, 2 y 4 del usuario**: son de PR-B y de la corrida posterior.
- **El efecto declarado (d) del ingeniero** —que ahora una corrida `TODOS` también exige que exista
  el tag— es cierto por lectura del YAML (el `ancla` se lee antes del `if`) y por el fallo local de
  `ancla` sin tag, pero no lo he visto en un runner.
- **El estado del CI de la PR**: no he hecho ninguna llamada de red. Lo cubre el hook `ci-verde.sh`
  del coordinador.

---

## 6. Veredicto

**APTO CON RESERVAS.**

Los dos issues están arreglados de verdad y bien: #381 con un ancla que viaja en el manifiesto y un
cuarto veredicto que no se colapsa (con la rama vacía hecha inexpresable en el tipo), y #420 con un
sello de contenido que caza la sustitución local, el informe editado y el truncado, y que además
distingue los tres fallos del guardia sin taparse entre ellos. Todo eso está candado, se pone rojo al
romperlo y lo he comprobado yo, no leído. El bug del `--pedidos ""` que apareció de propina es real y
su arreglo está verificado en las dos direcciones. Ningún umbral tocado, `verify` 1987/0, CRAP dentro
de tope, y ninguna prosa muerta de `modulos_con_informe` en el código.

Las reservas, en orden:

1. **Adoptar `qa/mutacion-cableado-en-negativo.mjs`** (o algo equivalente) antes de mergear: sin él,
   ocho piezas de esta PR —los dos arreglos incluidos— se pueden deshacer sin que nada se ponga rojo,
   y la única constancia de esa carencia desaparece con el `.gitignore`.
2. **Abrir issue** para el «sin dueño» que la huella escribe sobre un rango vacío (Importante 2) y
   para el test que falta del guardia (Importante 3).
3. **Barrer la prosa de `CLAUDE.md`** (Menor 1) con este cambio, que es la regla de la casa.
4. **Respetar el orden de merge**: bajar, repartir y commitear la corrida `33866958770` **antes** de
   mergear PR-A, o se pierde.

Ninguna reserva es un defecto de comportamiento del arreglo: son la diferencia entre un arreglo que
funciona y un arreglo que se puede mirar mañana.
