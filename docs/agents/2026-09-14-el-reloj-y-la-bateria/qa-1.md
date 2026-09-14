# QA · PR 1 de la tanda D — la comparación EN SECO y el criterio de adopción (#443)

Árbol `/home/al/code/ne-fan-qa-d1` (desprendido sobre `d37be106`), base de mutación intacta en
`nefan-core/reports/mutation-base/` (56 ficheros, corrida `34816474906`). Sin navegador, sin
servidores, sin mutación, cero créditos. Todo lo de aquí se midió corriendo el **verbo real** sobre
corridas de ensayo fabricadas a mano desde esa base.

**La vara.** Esta PR no la ve el jugador. Su usuario es quien tiene que decidir si se cambia de runner
**sin que le mientan**, y lo único que va a tener delante es la línea `⇒ SE PUEDE ADOPTAR` / `NO SE
ADOPTA` y su código de salida. Así que lo que se valida no es «el verbo corre», es **si esa línea
puede salir equivocada**, en cualquiera de las dos direcciones.

**Reproductor ejecutable**: `qa/comparar-el-criterio-en-negativo.mjs` — 14 propiedades contra el verbo
real, **9 en verde y 5 en rojo hoy**. No va a `qa/guiones/` porque ahí `qa/run.mjs` globa guiones de
navegador con firma `default async (ctx)`; el sitio de la casa para un candado headless es la raíz de
`qa/`, como `mutacion-cableado-en-negativo.mjs`. **No lo he cableado a `ci.yml`**: cablearlo es
arreglar, y eso es del ingeniero.

---

## Criterios de aceptación

Los criterios salen del encargo del coordinador para esta PR y de `plan.md` §4.1-§4.2, anclados en la
regla dura del usuario: *«si un solo score se mueve fichero a fichero, no se adopta»*.

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | `comparar` **no escribe** nada: ni huella, ni tag, ni `reports/`, ni comentario en PR, ni temporal en el árbol | ✅ cumple (con reserva de diseño → H6) | `find . -newer <marca>` tras el verbo sobre los 55 módulos: **0 ficheros**. `.git` compartido (`/home/al/code/ne-fan/.git`): **0**. `git status` limpio, `mtime` de `mutacion-huella.json` sin mover, tag en `dedb4157…`. `gh` solo se llama en `traer` (`mutacion.ts:545,593`) y en `repartir --comentar` (`:772`), ninguno alcanzable desde `comparar` |
| 2 | El cierre de imports de `mutacion-comparar.ts` no alcanza ningún escritor | ✅ cumple **hoy** | Cierre = `mutation-plan.ts` (solo `existsSync/globSync/readFileSync/statSync`), `especificador.ts`, `mutacion-huella.ts`. `grep` de los 7 escritores + `child_process` sobre los tres: **0**. `escribeHuella` vive en `mutacion.ts:241` y **no se exporta** |
| 3 | `nuevos > 0` tumba la adopción | ✅ cumple | Ensayo Killed→Survived ×2 en `derive.ts`: `nuevos: 2`, `EXIT=1`, nombra el fichero |
| 4 | `resueltos > 0` tumba la adopción | ✅ cumple | Ensayo Survived→Killed ×3 en `game-store.ts`: `resueltos: 3`, `EXIT=1`, «el score puede no haberse movido y el conjunto sí» |
| 5 | `incomparables = 0` es condición | ✅ cumple | Ensayo quitando 1 mutante de `plan-collision.ts` (38→37): `nuevos 0 · resueltos 0 · incomparables 1`, `EXIT=1` |
| 6 | `sin base = 0` es condición | ✅ cumple | Ensayo renombrando el fichero medido a `src/config.ts` (no está en la huella): `sin base 1`, `EXIT=1` |
| 7 | `comparables > 0` es condición | ⚠️ cumple la letra, **no el propósito** | `comparables 0` → `EXIT=1` y «no se comparó NI UN fichero». **Pero 1 de 87 también adopta** → **H1** |
| 8 | Una corrida INCOMPLETA no adopta | ✅ cumple (redacción confusa → H8) | 4 pedidos / 2 sin informe → `INCOMPLETA`, `EXIT=1` |
| 9 | El bloque de `Timeout` va aparte y no se resta del veredicto | ✅ cumple | 136 en 13 módulos, cuadra con el plan (plugins-dsl 42, blueprint-huella 22, blueprint-derive 20, scene-validate 12). Censo propio de los 55 informes: `Killed 8.406 · Survived 4.137 · Timeout 136 · NoCoverage 0` |
| 10 | Las cuatro transiciones de `Timeout` salen donde deben | ⚠️ tres sí, la cuarta agrupa de más | `T→detectado` ✅, `T→vivo` ✅ (y además `nuevo`), `T→T` ✅. `otro→T` **no distingue `vivo→T` de `killed→T`** → **H3**. Y `T→detectado` se traga el mutante que desaparece → **H4** |
| 11 | `NoCoverage` con `perTest` real tumbaría el criterio (declarado «razonado, no medido») | ❌ **falso a medias** | Killed→NoCoverage ×4 → `4 nuevos`, `EXIT=1` ✅. **Survived→NoCoverage ×20 → `EXIT=0`, «SE PUEDE ADOPTAR»** → **H2** |
| 12 | El refactor no auto‑desarmó el probe del ancla (desviación 1) | ✅ cumple | `commitsDelRango(plan, corrida.desde, corrida.sha)` aparece **exactamente 1 vez** en `main` y en HEAD; el guardia `veces !== 1 → «patrón obsoleto»` está en `qa/mutacion-cableado-en-negativo.mjs:499-505`. Batería completa: **14 invariantes, 14 rojos al romperlos, 0 que no se enteran**, árbol limpio después |
| 13 | Los candados se ven rotos al romperlos | ✅ cumple | `architecture.test.ts` 101 pass / 0 fail · `mutacion-huella.test.ts` 158 pass / 0 fail · `tsc --noEmit` exit 0 · reproductor propio probado en negativo: desarmando `comparables>0` e `incomparables=0` se ponen rojas **exactamente esas dos** líneas |
| 14 | `--timeouts` fail‑loud cuando no hay con qué comparar | ❌ solo si falta el VALOR | Directorio inexistente o vacío → tabla de ceros → **H5** |
| 15 | Se puede comparar contra la base que midió la corrida aunque `main` avance | ❌ no probado como capacidad porque **no existe** | `huellaEnHead()` (`mutacion.ts:257-265`) está cableada a HEAD; ni flag ni parámetro → **H7** |

---

## Hallazgos

### 🔴 H1 · BLOQUEANTE — «SE PUEDE ADOPTAR» sobre **1 fichero de 87**, y el camino es el del navegador del móvil

`veredictoDeAdopcion` pide `comparables > 0` (`mutacion-huella.ts:418`) y nada más. El único suelo
extra lo pone el verbo, `veredicto.adopta && corrida.completa` (`mutacion-comparar.ts:189`) — pero
`veredictoDeCorrida` declara **COMPLETA** a toda corrida con `origen: "explicito"`
(`mutacion-huella.ts:735`), y el input `modulos` de `mutation.yml:20` dice literalmente *«o ids de
módulo separados por espacios»*. O sea: el atajo barato para probar `tap-runner` —medir dos módulos
en vez de 55— produce el veredicto de adopción de la casa entera.

**Medido**, un módulo (`blueprint-plan`, 38 mutantes de 12.841, 0,3 %):

```
  comparables    : 1 fichero(s)
  nuevos         : 0
  resueltos      : 0
  incomparables  : 0 fichero(s)
  sin base       : 0 fichero(s)
  corrida        : COMPLETA

  ⇒ SE PUEDE ADOPTAR — los 1 fichero(s) medidos se compararon uno a uno contra la medida
    anterior y el conjunto de supervivientes es EL MISMO, no solo el score
EXIT=0
```

**Reproducción desde cero**: `node qa/comparar-el-criterio-en-negativo.mjs` → línea H1.

**Qué esperaba quien decide**: que «ningún score se mueve fichero a fichero» hablara de los ficheros
de la casa. Es lo que fija `plan.md` §4.2 en su bullet **Conjunto**: *«los 87 de 88 ficheros de la
huella cuyo `blob` casa con HEAD»*. La implementación tomó la otra frase del mismo §4.2 («sobre los
ficheros que la corrida nueva mide») y no dijo que estaba eligiendo entre dos. El plan es ambiguo;
resolverlo en la dirección débil sin nombrarlo es lo que convierte la ambigüedad en agujero.

**El dato para cerrarlo ya está ahí y no cuesta un segundo**: `veredictoDeCorrida` devuelve
`mueveTag`, que es exactamente «midió todo lo que había desde el tag» y que es `false` para
`explicito`; y `huellaEnHead()` sabe cuántos ficheros comparables debería haber (88, 87 con blob
vivo). Ninguno de los dos se usa. *(No lo arreglo: lo señalo porque el coste de la reserva importa
para decidir si esta PR vuelve o pasa.)*

**Ningún test lo fija**: el primer test de adopción afirma `comparables: 2 → adopta`. No hay ninguno
que diga qué pasa con 1 de 87.

---

### 🔴 H2 · BLOQUEANTE — el superviviente que pasa a `NoCoverage` es **invisible**, y es el caso probable de `perTest`

`implementacion-1.md` lo declara en «Qué NO queda cubierto»: *«el diseño dice que saldría como
`nuevo` … y eso está razonado pero no medido»*. Medido ahora: **es verdad en una mitad y falso en la
otra, y la falsa es la probable.**

| Ensayo | Resultado medido |
|---|---|
| `Killed → NoCoverage` ×4 en `plan-collision.ts` | `4 nuevos` · `EXIT=1` · NO SE ADOPTA ✅ |
| `Survived → NoCoverage` ×20 en `game-store.ts` | `0 nuevos · 0 resueltos` · **`EXIT=0`** · **«SE PUEDE ADOPTAR — el conjunto de supervivientes es EL MISMO»** ❌ |

La causa es `esVivo` (`mutation-plan.ts:1132`): `Survived` y `NoCoverage` colapsan en «vivo», así que
la huella del mutante no cambia y el delta no ve nada. Y el reparto de la base dice **exactamente
quiénes son los candidatos**: `Survived 4.137 · NoCoverage 0`. Hoy no hay ni uno porque el runner
`command` corre `coverageAnalysis: "off"` y todo ejercita todo; con `perTest` real, un mutante que
hoy es `Survived` («un test pasó por la línea y no se enteró») se convierte en `NoCoverage`
(«ningún test pasó siquiera»). Eso no es el mismo hecho: es **medir menos**.

**Qué esperaba quien decide**: que el verbo le dijera si el instrumento nuevo mide lo mismo. Con este
agujero, una corrida donde miles de supervivientes dejen de ser ejercidos por un solo test se lee
`SE PUEDE ADOPTAR`. Bajo la **letra** de la regla del usuario es correcto —el score no se mueve— y por
eso lo marco bloqueante por **propósito** y no por letra: la decisión se tomaría sobre una medida más
pobre presentada como idéntica.

**Y la pieza para arreglarlo ya está construida**: es el mismo patrón del bloque de `Timeout`
(`timeoutsDeFichero` + `movimientosDeReloj`), aplicado a los mutantes que nadie ejerce. Un bloque
aparte —o una sexta condición— con el mismo argumento.

**Reproducción**: `node qa/comparar-el-criterio-en-negativo.mjs` → línea H2.

---

### 🟠 H3 · IMPORTANTE — el bloque del reloj explica los `nuevos` y **no** los `resueltos`

`vivo → Timeout` y `killed → Timeout` imprimen **la misma fila**, byte a byte:

```
vivo→T  : blueprint-derive  20  23  0  0  3  20
killed→T: blueprint-derive  20  23  0  0  3  20
```

El primero además tumba el veredicto con `resueltos: 3` — un superviviente que el runner nuevo
«resolvió» **con el reloj, no con un test**. El bloque existe, según su propio comentario, para
*«decir cuántos de los movimientos vinieron de ahí»*; tiene columna dedicada para el movimiento que
alimenta `nuevos` (`T→vivo`) y ninguna para el que alimenta `resueltos`. `movimientosDeReloj` no
puede calcularlo porque no recibe los vivos de la base — pero `deltaDeFichero` ya trae `resueltos`, o
sea que el dato está en la mano de quien llama (`imprimeReloj` tiene el `DeltaDeFichero` entero).

**Por qué importa**: ese bloque «se pega literal en #443». Si el veredicto cae por 3 resueltos y los 3
los mató el reloj, el issue se cierra atribuyendo a los tests una diferencia que no es suya — el
error exacto que el bloque nació para evitar. Y no hay test de `vivo → Timeout` en los 6 del describe
*reloj*.

---

### 🟠 H4 · IMPORTANTE — `T→detectado` afirma lo que no pasó cuando el mutante **sale del denominador**

`movimientosDeReloj` cierra con un `else` (`mutacion-huella.ts:507`): todo `Timeout` de la base que ya
no es `Timeout` y no está vivo se cuenta como *detectado*. Medido con `Timeout → RuntimeError` ×3:

```
  módulo                           base  ahora  T→detectado   T→vivo   otro→T      T→T
  blueprint-derive                   20     17            3        0        0       17
```

…bajo una leyenda que dice **«el mutante lo mata ahora un test: el score no se mueve, y no es hallazgo
de nadie»**. No lo mató nadie: `RuntimeError`/`CompileError`/`Ignored` no entran en el denominador
(`vivosDeFichero`), así que desapareció de la medida. El **veredicto** sí lo caza (el `total` cambia
280→277 → `incomparable` → `EXIT=1`), pero la tabla que va al issue afirma lo contrario del hecho.

Y no es hipotético: un runner que ejecuta cada fichero de batería **directo**, sin `node --test`, es
justo donde aparecen `RuntimeError`. La propia crítica midió esa superficie («los de servidor, que
eran el riesgo de no cerrar el proceso»).

Secundario del mismo sitio: `imprimeReloj` filtra por `base[d.fichero] !== undefined` pero **no** por
`d.base === "con base"`, así que sigue imprimiendo filas de ficheros que el veredicto ya declaró
incomparables.

---

### 🟠 H5 · IMPORTANTE — `--timeouts` con una ruta equivocada se degrada en **silencio** a «0 movimientos»

`dirDeTimeouts` (`mutacion.ts:970`) es fail‑loud solo cuando falta el **valor** del flag. Con un
directorio que no existe —o el que `traer` acaba de vaciar— la salida es:

```
  módulo                           base  ahora  T→detectado   T→vivo   otro→T      T→T
  TOTAL                               0      0            0        0        0        0
  ⚠ 55 módulo(s) de esta corrida no están en la base de Timeout: ai-client, apuntado, …
```

`EXIT=0`. La ⚠ está **debajo** del TOTAL y detrás de una pared de 55 nombres; el TOTAL es lo que se
lee y lo que se pega. Es exactamente la degradación que el comentario del propio `dirDeTimeouts`
declara inaceptable: *«imprimiría el bloque del reloj vacío y se leería como “no se movió ninguno”,
que es exactamente lo contrario de lo que habría pasado»*. El guardia se escribió para la mitad fácil
del caso. Un `existsSync(dir)` cierra la otra mitad.

---

### 🟠 H6 · IMPORTANTE — «no escribe» es **verdad hoy**, pero la garantía es una lista negra con dos costuras

Lo primero, lo que aguanta: **el verbo no escribió nada**. Cero ficheros con `mtime` nuevo en el árbol
tras correrlo sobre los 55 módulos, cero en el `.git` compartido, tag quieto, huella intacta, `git
status` limpio. Y el cierre de imports no alcanza un solo escritor. Lo único que se escribe fuera son
la caché de `tsx` (`/tmp/tsx-1000/`) y un log de `npm` — del *runtime*, idénticos para cualquier
verbo, y ninguno es parte de la base de medida. **Declarado, no hallazgo.**

Las costuras son de forma, no de hecho:

**(a) La regla es un denylist de 7 nombres.** Probado el patrón real de `arch-rules.json` contra
líneas candidatas: **caza** `writeFileSync`, `fs.writeFileSync`, `rmSync`, `appendFileSync`,
`fs.promises.writeFile`; **pasa** `unlinkSync`, `rmdirSync`, `cpSync`, `copyFileSync`,
`truncateSync`, `openSync`+`writeSync`, `execFileSync("git",["tag","-f","mutacion-ultima"])` y
`execSync` con redirección. El contrato de este fichero es «no escribe»; un contrato así se sujeta
con una **lista blanca** (de `node:fs`, solo `readFileSync`/`existsSync`; nada de `node:child_process`),
que es lo que esta casa llama *la garantía va en el tipo*. La desviación 4 del informe —importar
`node:fs` como espacio de nombres para que romperlo cueste **una** línea— optimiza la comodidad de
probar el candado a costa de ensanchar justo la superficie que el candado vigila.

**(b) Las dos capas juntas no ven una escritura INDIRECTA a una ruta gitignorada — y `nefan-core/reports/` es exactamente eso.** Demostrado: inyecté en `mutacion.ts::comparar` (fichero que la
regla **no** cubre; su `files` lista solo `mutacion-comparar.ts`) un `mkdirSync`+`writeFileSync` sobre
`nefan-core/reports/colado/rastro.txt`. Resultado: el fichero se creó, el verbo salió `0` y
`SE PUEDE ADOPTAR`, `git status` quedó **limpio**, el tag quieto, la huella intacta — o sea, las tres
señales que fotografía `fotoDelArbol()` dicen *«árbol intacto»* — y `npm test` dio la regla
`comparar-no-escribe` en **verde**. Restaurado byte a byte; árbol limpio verificado.

`reports/` está en `.gitignore:71` (`git check-ignore` lo confirma) y es donde vive
`reports/mutation-base/`, **la base cuya destrucción es el motivo entero de esta PR**. Nada la vigila.

---

### 🟠 H7 · IMPORTANTE — no hay forma de comparar contra la huella del commit que midió la base, y eso es un **falso rojo** esperando

`huellaEnHead()` (`mutacion.ts:257-265`) lee `HEAD:data/contract/mutacion-huella.json` y punto: ni
flag, ni parámetro, ni `--desde-commit`. `plan.md` §8 nombró el riesgo —*«La huella de HEAD cambia
entre que se pide E y llega (otra tanda repartió)»*— y nombró la respuesta —*«comparar contra la
huella del commit que midió la corrida»*—. La implementación no la trae, y el informe **no** la
declara entre lo no cubierto.

Consecuencia concreta para #443: el paso E mide desde `feature/tap-runner`, y el `afectado` de esta
misma PR fuerza los **55 módulos / 87 ficheros**. Cualquier fuente que cambie entre el último
`repartir` y esa corrida sale `incomparable` por `blob`, e `incomparables = 0` es condición dura →
**`NO SE ADOPTA` por un motivo que no tiene nada que ver con el runner**, y #443 se cierra con un
número falso. Es diagnosticable a mano —`deltaDeFichero` distingue en su `porque` «el fichero cambió
desde la medida anterior» de «cambió el instrumento de medida»— pero ni el veredicto, ni el `porque`
del veredicto, ni el código de salida separan las dos cosas. La decisión sale igual de rota en esta
dirección que en la de H1, solo que hacia el «no».

---

### 🟡 H8 · MENOR — el `porque` de una corrida INCOMPLETA pega el texto de ÉXITO detrás de «NO SE ADOPTA»

```
⇒ NO SE ADOPTA — los 3 fichero(s) medidos se compararon uno a uno contra la medida anterior y
  el conjunto de supervivientes es EL MISMO, no solo el score; y la corrida está INCOMPLETA…
```

El exit y el dictamen son correctos; la frase leída de corrido dice lo contrario de lo que decide.
Sobre la **desviación 2** en sí (sacar «INCOMPLETA» de `veredictoDeAdopcion`): la separación está bien
argumentada y no esconde un fallo —el verbo aplica las seis y sale `1`—, pero deja la función pura,
que es la que tiene los 15 tests, devolviendo `adopta: true` sobre una corrida incompleta. Quien la
reutilice mañana hereda eso. Con H1 encima, la condición `completa` es **la única** defensa contra una
corrida parcial y no cubre `origen: explicito`: las dos cosas se leen juntas.

### 🟡 H9 · MENOR — la fila de CLAUDE.md enumera **cinco** condiciones y el verbo exige **seis**

*«Sale con ≠ 0 salvo que se cumpla TODO: 0 nuevos, 0 resueltos, 0 incomparables, 0 sin base y
comparables > 0»*. Falta *y la corrida COMPLETA*. Es el documento que entra entero en cada sesión: la
sesión siguiente leerá cinco y el verbo aplicará seis.

### 🟡 H10 · MENOR — `traer` avisa **mientras** borra

El aviso nuevo (`mutacion.ts:558-592`) se imprime justo antes del bucle de `rmSync`, sin confirmación
y sin `--force`. Quien lo lee ya no puede hacer nada con él: dice el ritual que **debería** haber
seguido. Es prosa impresa, no guardia — y la doctrina de la casa sobre la prosa la escribe esta misma
PR en su `why`. El ingeniero nombra la alternativa fuerte en su desviación 5 (que `traer` aparte solo)
y la descarta por una razón razonable (machacaría una base curada); la tercera vía —negarse si hay
informes y no se pasó una bandera— no se considera.

---

## Las seis desviaciones, una por una

| # | Desviación | Veredicto de QA |
|---|---|---|
| 1 | Extraer también `contextoDeLaCorrida()` «porque si no, un probe de QA se habría autodesarmado» | ✅ **cierta y verificada**. El mecanismo existe (`qa/mutacion-cableado-en-negativo.mjs:499-505`: `veces !== 1` → «patrón obsoleto» → fallido), y hoy `commitsDelRango(plan, corrida.desde, corrida.sha)` aparece **exactamente 1 vez**, igual que en `main`. El probe del ancla sigue vivo y **se ve rojo al romperlo** en la corrida de los 14. El efecto de lado que reclama (el guardia del rango vacío aplicado también a `comparar`) lo confirmé: `comparar` pasa por `contextoDeLaCorrida` entero |
| 2 | `comparar` sale ≠ 0 con la corrida INCOMPLETA, **fuera** de `veredictoDeAdopcion` | ⚠️ **bien argumentada, mal acompañada** → H8. No esconde un fallo, pero es la única barrera contra una corrida parcial y no cubre `origen: explicito` (H1) |
| 3 | La regla prohíbe 7 nombres en vez de 5 | ⚠️ más estricta que el encargo, sí; **pero la forma es la equivocada** → H6(a). 7 de 14 evasiones plausibles pasan |
| 4 | `import * as fs` a propósito, para que romperlo cueste una línea | ❌ **discutible, y va contra la doctrina de la casa**. Ensancha la superficie que el candado vigila para que el candado sea cómodo de probar. Con `import { readFileSync, existsSync }` selectivo, la regla podría ser una lista blanca sobre **una** línea y sería total → H6(a) |
| 5 | `traer` imprime un aviso | ⚠️ → H10 |
| 6 | Fila de `comparar` en CLAUDE.md | ✅ correcta y necesaria, con una omisión → H9 |

## Lo que aguanta, dicho entero

No todo es hallazgo, y este informe sería deshonesto sin la otra mitad:

- **Las cinco condiciones existen y cada una se ve roja.** Las fabriqué las cinco por separado, cosa
  que el informe solo hizo con dos. El `porque` nombra **todos** los motivos a la vez, medido con un
  ensayo que dispara cuatro.
- **El caso que el score no ve** (un superviviente nuevo donde murió uno viejo) está cubierto y
  tumbado, que es lo que hace la regla del usuario *más fuerte* de lo que pide.
- **El refactor no rompió nada**: 14/14 invariantes del cableado rojos al romperlos, árbol limpio
  después; `tsc --noEmit` exit 0; 158 tests en `mutacion-huella.test.ts`; 101 en `architecture.test.ts`.
  Los 15 tests nuevos están escritos contra comportamiento, no contra la implementación.
- **El verbo no escribe** — comprobado con el reloj del sistema de ficheros, no leyendo el código.
- **El bloque de `Timeout` cuadra**: 136 en 13 módulos, con el reparto exacto que predijo el plan.

---

## Workarounds usados

| Workaround | ¿Afecta al usuario? |
|---|---|
| `cp -r reports/mutation-base reports/mutation` antes de cada ensayo | **No es hallazgo**: es el ritual que la PR documenta. `comparar` lee de `reports/mutation/`, la base se aparta |
| Fabricar el manifiesto con `manifiesto --origen explicito --run 9999xx` | **No es hallazgo por sí mismo** (la herramienta es la que sella, que es el punto de #420) — **pero es el mismo camino que produce H1**, y el ingeniero lo usó para sus dos rojos sin notar que el `COMPLETA` que salía arriba era el agujero |
| Inyección temporal en `mutacion.ts` (H6b) y en `mutacion-huella.ts` (negativo del reproductor) | Restauradas **byte a byte** (`diff -q`), `git status` limpio verificado en las dos. No contaminan la evidencia: los números de arriba se midieron con el árbol intacto |

## No probado

- **La corrida real con `tap-runner`** (paso E de #443): no existe, y nada de aquí dice qué dirá. Lo
  que sí digo es que, tal como está, esa corrida puede salir con un «sí» que no sostiene la evidencia
  (H1, H2) o con un «no» que no es del runner (H7).
- **`traer` no se ejerció**: baja un artefacto por red y vacía `reports/mutation/`, o sea que habría
  puesto en riesgo la base. Su aviso nuevo está **leído**, no corrido.
- **`npm run verify` completo, `crap` y `deuda`**: no los repetí. Verifiqué `tsc --noEmit` y los dos
  ficheros de test que esta PR toca. La cifra de 84 items de deuda del informe la doy por buena sin
  medirla; CI la cerrará.
- **Gasto de créditos**: cero, y esta PR no tiene ningún camino a ninguno.
- **`NoCoverage` producido por `tap-runner` de verdad**: lo mío son informes fabricados. Lo que H2
  demuestra es cómo reacciona el criterio, no con cuántos `NoCoverage` reaccionará.

---

## Veredicto

# NO APTO

No por la calidad del trabajo —el refactor es limpio, los candados se ven rotos al romperlos, el verbo
no escribe y las cinco condiciones existen de verdad—, sino porque **la única línea que esta PR
produce puede salir equivocada en las dos direcciones, y las dos están medidas**:

1. **`SE PUEDE ADOPTAR` con 1 fichero de 87** (H1), por el camino que el propio workflow ofrece.
2. **`SE PUEDE ADOPTAR` con miles de supervivientes que ya no ejerce ningún test** (H2), que es el
   caso probable de `perTest` y la mitad que el informe razonó al revés.
3. **`NO SE ADOPTA` por un fuente que cambió**, no por el runner (H7), sin nada en la salida que lo
   separe.

Esta PR existe para que la regla dura del usuario sea **aplicable**. Con H1 y H2 vivas, sigue siendo
cumplible en verde sin haber comprobado lo que importa — la forma exacta de criterio que la crítica
mandó evitar. Y el momento es el barato: la corrida del paso E **no se ha pedido todavía**, así que
arreglar ahora no cuesta un runner.

**Las tres reservas son locales y la casa ya tiene las piezas**: `mueveTag` para H1, el molde del
bloque de `Timeout` para H2, y el `porque` de `deltaDeFichero` —que ya distingue los dos motivos— para
H7. H3, H4 y H5 caen en el mismo fichero y son media hora. H6 es una decisión de forma que el
coordinador puede aceptar tal cual **si la anota**: hoy no hay escritor y la afirmación «no escribe»
es cierta; lo que no es cierto es que esté garantizada.
