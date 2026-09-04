# T10 «Las herramientas se miden» — crítica

**#419 VIGENTE** (la única ROJA hoy) · **#420 VIGENTE** · **#381 VIGENTE** · **#339 VIGENTE** · **#340 REENCUADRADA** · **#383 REENCUADRADA** · **#404 PREMATURA en esta tanda**. Más un hallazgo sin issue que bloquea el cierre de cinco de los siete: **la corrida completa lleva dos autorizaciones sin declararse completa porque `contrato-escena` se cae.**

**El problema real, en una frase**: el instrumento que dice si lo demás está medido tiene agujeros en las tres partes del ciclo —qué se mide (#339, #340), qué se puede medir aquí (#383) y de quién es lo medido (#381, #404, #420)— y dos módulos por debajo de su suelo (#419).

## La premisa, verificada hoy sobre `e67ae4d`

| # | Afirmación | Verificación |
|---|---|---|
| 339 | siguen en `sin_mutar`, su batería ya existe | **CIERTA**: `mutation-targets.json:118` y `:134`, ambos AUSENTES de la huella; batería en `scene-validate.test.ts`, `-golden`, `-pasadas`, `fixtures/scene-validate-corpus.ts`, `tile-edges.test.ts`. Pero «local si cabe, pedida si no» es **FALSO**: `permisoLocal` rechaza coste `undefined` (`mutacion-huella.ts:487-493`) — un módulo estrenado nunca se mide en local |
| 340 | `grep -c "src/narrative"` → 0; 10 ficheros; CRAP 49 | 0 **CIERTO**; **9** ficheros; `registerSceneNpcs` es CRAP **59** hoy (`npm run deuda`), ha empeorado |
| 340 | «entra en `directorios_completos` y el candado lo verifica» | **CON TRAMPA**: el perímetro sale de `core-puro-sin-node` de `arch-rules.json` (`mutation-plan.ts:239-258`), que no nombra `src/narrative`. Vía barata: `directorios_completos` (precedente `src/plugins/dsl`). Vía cara: la regla — y `session-storage.ts` importa `node:fs`, o sea rompe el build |
| 383 | «el gate no lo ve: dice 119, son 160» | **MUERTA**: la huella dice **162** (run `33790710680`), luego `costeDe` da 162 > 120 y `local status-labels` YA se rechaza. Confirmo la medida del coordinador |
| 383 | `costeDe` lee `git show HEAD:`; «~10 importadores» | **FALSO para `local`**: usa `leerHuella()`, el árbol (`mutacion.ts:683`); `huellaEnHead()` es de `repartir` (`:436`). Y son **12** importadores. La costura sigue escrita en la cabecera del fichero |
| 381 | el rango cuelga de un tag que la corrida adelanta | **CIERTA**: `mutacion.ts:157` y `:438`, `TAG` en `:81`, `mutation.yml:144-155`. Pero su opción 1 no es un ancla única: el `sha` va POR FICHERO y hoy hay dos (60 en `81a7ce0`, 4 en `7b817b9`) |
| 404 | `client-file-size.json` fuerza los 32; un solo lector | **CIERTA, reproducida**: `afectado -- --rango 937c16d^..937c16d` → «TODOS». Lector único `test/client-file-size.test.ts`, que no está en ninguna batería |
| 419 | dos módulos por debajo de su break, por los opcionales | **CIERTA y lo más grave**: `entidades-del-tile` 12 vivos de 121 = **90,1 % < 96**; `scene-normalize` (231+82) 8 de 313 = **97,4 % < 98**. Código en `entidades-del-tile.ts:266-282` y `scene-normalize.ts:363`; aserciones de ausencia hoy: **una** (`entidades-del-tile.test.ts:188`), ninguna para `shape`, `volumeId`, `styleRef`, `role`, `combat`, `place_id`. Los dos salen `base: "incomparable"`: la herramienta se NIEGA a clasificarlos y la atribución a #412 es a mano |
| 420 | `verificaDescarga` compara nombres | **CIERTA** (`mutacion-huella.ts:433-449`). Y la procedencia YA viaja sin que nadie la lea: `projectRoot` = `/home/runner/work/…` en los informes de CI (comprobado en 3) |

## Lo que nadie ha nombrado

`reports/mutation/corrida.json`: **33 pedidos, 32 con informe; el caído es `contrato-escena`.** Sus cuatro ficheros siguen medidos en la corrida anterior (`33672454166`/`7b817b9`) y `entity-vocabulary.ts` —que metió #406— **nunca se ha medido**. Por eso el tag no se mueve, y #347/#349 ya se cerraron sobre este mismo módulo. Cinco de los siete cierran con «su primera medida entra en la huella», y eso exige una corrida que se declare COMPLETA: las dos últimas no lo hicieron. Del mismo sitio: `asset-store-contrato` sigue con **`break: 0`** y 2 supervivientes medidos, tres tandas después de #354/#380/#389 — el ritual de subir el suelo leak, y esta tanda va a crear módulos nuevos con ese `0`.

## El día después

Para quien juega no cambia nada, y está bien: es deuda declarada. Se encarece la corrida completa (estimando con la huella, 0,87 mutantes/línea: ≈975 por #339 y ≈900 solo por `narrative-state.ts`, de ~131 a ~150-160 min). Lo que parecerá arbitrario en un mes: por qué `src/narrative` está en `directorios_completos` y no en `arch-rules.json` — **eso va escrito en su `porque`**.

## Conflictos, orden y paralelismo

Ficheros: **#419** dos tests · **#383** `src/protocol/**` + 12 importadores + `mutation-targets.json` · **#339/#340** solo `mutation-targets.json` · **#381/#420** `scripts/mutacion.ts` + `mutacion-huella.ts` (+ workflow) · **#404** `scripts/afectado.ts`. Dos focos de choque y solo dos: el JSON del contrato (cuatro escritores) y `scripts/mutacion*.ts` (dos). Corte para dos ingenieros, derivado de los ficheros:

- **A · el instrumento**: #381 + #420 en UNA PR (los dos viven en el camino de `repartir`; separarlos
  paga el merge dos veces), luego #404 si entra. Dueño de `scripts/` y del workflow.
- **B · lo medido**: #419 primero (es lo rojo), luego #383, luego #339+#340 juntos. Dueño de
  `mutation-targets.json` y de `src/`.

No comparten un fichero. Lo que **no** se paraleliza: si #404 mete una clave `datos` en `mutation-targets.json`, deja de ser de A y va al final, solo. **Módulos nuevos: agruparlos, no espaciarlos** — espaciar cuesta 131 min de corrida por tanda y no compra nada, porque `base: "sin base"` ya es un estado propio que la herramienta se niega a colapsar (`mutacion-huella.ts:171-181`): salen honestos, no confusos. Lo que hay que candar es el día siguiente — un `break: 0` cuyo suelo nadie sube es un gate permanentemente verde, y `asset-store-contrato` demuestra que pasa.

## El riesgo de clase: qué puede salir más permisivo sin que se note

1. **#404 es el peligroso.** Una lista `datos: {ruta → módulos}` a mano hace que el defecto de un fichero NUEVO de `data/contract/` sea el silencio; hoy es `todos`, caro y correcto. El propio `afectado.ts` tiene escrita la vía honesta para el caso gemelo (`efectoDeSalida`, `:81-93`): calcula lectores con `ctx.leen` y sentencia «*que NO es instrumento se comprueba, no se declara*». Si acaba habiendo lista, necesita su candado de totalidad, como `sin_mutar`.
2. **#383(b) no se arregla comparando blobs.** Medido: hoy 30 de 33 módulos tienen los blobs idénticos a lo medido — pero sobre un árbol limpio. `local` se usa justo DESPUÉS de editar el módulo: ahí el blob difiere por construcción y ese gate apagaría el flujo que CLAUDE.md le pide al ingeniero. **(b) sale de #383 y se abre como issue propio.**
3. **Subir `tope_local`**: lo prohíbe el propio #383 y es la salida barata también de #419 (`entidades-del-tile` cruza el tope por **uno**).

## Coste contra valor

#419 y #420 cuestan poco y no hacerlos cuesta ya (uno deja el gate rojo; el otro deja que una medida local se cuele en el histórico commiteado). #381 daña la próxima vez que una corrida salga completa —la que esta tanda va a pedir—. #339/#340/#383 son inversión: no hacerlos deja `src/narrative` (2.515 líneas, con carga y escritura del save dentro) fuera de todo candado. #404 mal hecho cuesta un selector que aprueba sin mirar: espera.

## La corrida pendiente: **ANTES, y otra DESPUÉS**

La de antes no es para medir: es para que la de después sirva. Con el tag en `7b817b9` y 12 commits, la corrida posterior al merge tendría ~18 commits y 200+ ficheros y su atribución saldría «todas para todo» otra vez — justo lo que #381 y #404 arreglan, sin poder demostrarlo. Pidiéndola ahora el tag pasa a `e67ae4d` y el rango de la siguiente son las 4-6 PR de la tanda: pequeño, legible y capaz de enseñar que el arreglo funciona. Además es lo único que dirá si `contrato-escena` sigue cayéndose **antes** de que cinco criterios de cierre dependan de ello. Cuesta 131 min de runner, cero créditos, y no bloquea nada. Pedirla solo DESPUÉS pierde la atribución de esa corrida y la prueba de que #381 quedó arreglado.

**Criterio de aceptación**: (1) los dos módulos de #419 vuelven a su suelo en una corrida autorizada, con el número y no con el argumento; (2) cada módulo nuevo sale de ella con su `break` puesto a la medida y commiteado —`break: 0` no es un final—; (3) los candados de #381 y #420 se han visto **rojos** antes de darse por buenos; (4) `contrato-escena` deja informe o hay issue con dueño; (5) ningún umbral subido.

## Qué le cambiaría a `requisitos.md`

- En «Estado medido HOY»: «**La corrida `33790710680` salió INCOMPLETA porque `contrato-escena` no dejó informe** (`corrida.json`: 33 pedidos, 32 con informe). Sus cuatro ficheros siguen medidos en `33672454166`/`7b817b9` y `entity-vocabulary.ts` nunca se ha medido; #347 y #349 se cerraron sobre este mismo módulo. **Es por esto, y no por otra cosa, que el tag no se ha movido.**»
- #340: «**9** ficheros, no 10» y «CRAP **59**, no 49»; más: «el perímetro sale de `core-puro-sin-node` en `arch-rules.json`, que no nombra `src/narrative`; meterlo ahí rompería el build (`session-storage.ts` importa `node:fs`). La vía es `directorios_completos`, precedente `src/plugins/dsl`».
- #339 y #419: «**una primera medida no se puede hacer en local** (`permisoLocal` rechaza el coste desconocido) y `entidades-del-tile` cuesta 121, uno por encima del tope: los dos exigen corrida autorizada — no es una opción del plan».
- #383: «`local` lee `leerHuella()` (`mutacion.ts:683`), no `git show HEAD:`; lo importan **12** ficheros, no ~10». Y marcar su parte (b) como **fuera de alcance: issue nuevo**.
- En «Restricciones»: «**Ningún módulo nuevo se queda en `break: 0`**; hoy `asset-store-contrato` lleva tres tandas así. El cierre de T10 incluye la subida de suelo desde la corrida posterior».
- Sustituir «**No se ha pedido todavía**» por: «**Se pide ANTES de empezar** (sobre `e67ae4d`), para que el rango de la corrida posterior sean solo las PR de esta tanda y la atribución que #381 arregla se pueda ver funcionar. Y **otra al mergear**».
