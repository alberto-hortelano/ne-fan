# QA · PR-1 de la segunda mitad de la tanda D — #599 + el barrido del §4.4

Árbol `/home/al/code/ne-fan-qa599`, detached en `d4ef1f41`. Todo lo que lleva un número aquí lo
medí yo hoy, 2026-09-15, en esta máquina, con la salida pegada. Cero créditos, cero corridas de
mutación, cero servicios arrancados, `reports/mutation/` y `reports/mutation-base/` intactos
(59 + 59 ficheros, contados antes y después).

**Veredicto: APTO CON HALLAZGOS.**

---

## 1 · Criterios

| # | Criterio (de #599 y del plan §4.1/§7) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | El defecto muere: con la base en `off` los 1122 dejan de votar | ✅ | `npm run mutacion -- comparar --timeouts reports/mutation-base` → `sin ejercer : 0 mutante(s) (donde SÍ se pudo mirar)` · `· censo : 1122 … NO vota` · `· sin mirar : 0` |
| 2 | El `NO SE ADOPTA` cita los 5 ficheros de #597, no los 1122 | ✅ | mismo comando: `⇒ NO SE ADOPTA — 5 fichero(s) INCOMPARABLES (src/contracts/http.ts, src/contracts/sprite-forge.ts, src/scene/blueprint/ground.ts y 2 más)`. Exit 1 |
| 3 | Esos 5 son donde viven los 26 `RuntimeError` | ✅ | recuento por informe: `contrato-sprite-forge` 5 · `blueprint-suelo` 6 · `blueprint-derive` 2 · `blueprint-volumenes` 12 · `state-http-dispatch` 1 = **26** |
| 4 | **La dirección ROJA sigue existiendo** con base capaz | ✅ | `qa/mutacion-cableado-en-negativo.mjs`, verbo real, mismo material, dos lecturas: `off[sinEjercer:0 censo:1 7a:false] perTest[sinEjercer:1 censo:0 7a:true]` |
| 5 | **No es una abstención permanente** (casos 1 y 6) | ✅ | rotura B (`nuevos: 0`) → casos **1 y 4** rojos; rotura F (`mirados: 0`) → caso **6** rojo. Reproducido por mí, no leído |
| 6 | El censo se imprime entero, rotulado, con puntero a #598 | ✅ | bloque `CENSO (no es condición): 1122 mutante(s)… (#598)` + lista por fichero. Ver observación O-1 |
| 7 | El `✔ ningún mutante ha dejado de ser ejercido` **no** sale con base incapaz | ✅ | sale `⊘ NO SE PUDO MIRAR: ninguna base podía contestar…` |
| 8 | Caso 4 (base mixta) dice **1**, no 501, y mide algo | ✅ | con la forma «booleano de corrida» el test falla con `AssertionError: 501 !== 1`. **No pasaría con la implementación vieja** |
| 9 | `verify` verde y sin perder tests | ✅ | `tests 2716 · pass 2716 · fail 0 · exit 0`. Batería `mutacion-huella`: **168 → 176 (+8)**, medido en los dos commits |
| 10 | Deuda sin crecer | ✅ | `npm run deuda` = **86 items** (11 fronteras + 11 CRAP + 64 supervivientes) |
| 11 | CRAP y cobertura | ✅ | `0 por encima` del tope 73; cobertura **95,89 %** (suelo 95 %). El diff no toca ni un fichero de `src/`–`bridge/` (`git diff --name-only | grep -cE "^nefan-core/(src\|bridge)/"` = **0**) |
| 12 | Los dos arneses de `qa/` | ✅ | candados **50/50**, cableado **16/16**, `NO se enteran: 0` en ambos |
| 13 | §4.4 · `esperados` dice 90 | ✅ | huella = **91 filas**; el verbo real imprime `85 fichero(s) de los 90 de la huella` |
| 14 | §4.4 · los dos `grep` a cero en todo el repo | ❌ **no se cumple, y está bien** | ver D3 abajo: 0 afirmaciones vivas, 6 hits en registros fechados y en los documentos de esta tanda |
| 15 | **La condición sabe si pudo mirar EN LOS DOS SENTIDOS** | ❌ | **H-1**: sabe si la BASE pudo mirar; no sabe si la corrida NUEVA puede |
| 16 | Lo que el bloque promete imprimir tiene quien lo mire | ❌ | **H-2**: `imprimeSinEjercer` se puede borrar entero y los tres verdes siguen verdes |

---

## 2 · Hallazgos

### H-1 · importante · La séptima condición sabe si pudo mirar la BASE, no si puede mirar la CORRIDA NUEVA

El defecto de #599 era una condición que solo podía salir en una dirección. El arreglo la abre en
las dos **respecto de la base**. Pero el sentido simétrico —que la incapaz sea la corrida NUEVA—
sigue produciendo una afirmación falsa y un verde.

**Reproducción** (desde el árbol, sin arrancar nada):

```
node qa/mutacion-la-septima-en-los-dos-sentidos.mjs
```

Salida real de hoy, bloque A:

```
🔴 ROJO   A1 · con la corrida NUEVA incapaz de emitir `NoCoverage`, no se afirma «no mide menos»
     el titular afirma lo que no puede saber: «✔ ningún mutante ha dejado de ser ejercido en los
     1 fichero(s) que se pudo mirar: el instrumento nuevo no mide menos.»
🔴 ROJO   A2 · y esa adopción NO sale autorizada
     veredicto: SE PUEDE ADOPTAR sobre un instrumento que perdió la cobertura.
```

El escenario es el espejo exacto de #443: base `perTest` con 1122 `NoCoverage`, corrida nueva con
`coverageAnalysis: "off"`, que **no puede emitirlos jamás**. El instrumento nuevo mide
estrictamente menos, y el verbo dice «no mide menos» y **autoriza**.

**Lo que hace que esto sea un hallazgo y no un límite declarado.** `implementacion-3.md` §6 lo
nombra y lo despacha así: *«Lo dice el bloque y lo cruzan las condiciones 1 y 2 (0 nuevos, 0
resueltos)»*. **Esa mitigación es falsa**, y lo dice el propio fichero que la PR modifica:

- `esVivo` (`scripts/mutation-plan.ts:1132`) devuelve `true` para `Survived` **y** para
  `NoCoverage`.
- `sinEjercerDeFichero` (`scripts/mutacion-huella.ts:132-146`) documenta la consecuencia:
  *«en la huella un `NoCoverage` y un `Survived` son la MISMA cosa y el delta no puede verlos
  moverse el uno al otro»*.

O sea que un `NoCoverage → Survived` es **invisible** a `nuevos` y a `resueltos`: los 1122 siguen
«vivos» antes y después, el total no se mueve, y ninguna de las dos condiciones que se citan como
red de seguridad llega a enterarse. Lo verifiqué construyendo el delta con `yaEstaban = los 1122`
y `nuevos/resueltos` vacíos, que es lo que la casa produciría realmente.

**El dato ya está en la mano.** `coberturaAhora` se calcula (`coberturaDeLaCorrida`, fail-loud),
viaja en `ComparacionEnSeco` y se imprime (`ahora: perTest`). Lo único que falta es que sea
condición: si la corrida nueva es `off` y alguna base era capaz, el titular no puede afirmar «no
mide menos».

**Qué esperaba yo como lector del veredicto**: que un verbo cuyo nombre es «la condición sabe si
pudo mirar» no me diga «el instrumento nuevo no mide menos» cuando el instrumento nuevo acaba de
perder la capacidad de nombrar 1122 mutantes.

**Por qué NO bloquea esta PR**: hoy la base es `off` y la corrida nueva `perTest`, o sea el sentido
que la PR sí cubre. La próxima corrida autorizada no se gasta por esto, que es el objetivo
declarado de la PR y se cumple (criterios 1-3). El sentido reverso solo es alcanzable después de
adoptar `perTest` — que es exactamente a donde empuja #598.

### H-2 · importante · La capa que IMPRIME la séptima condición no la mira ningún candado

`imprimeSinEjercer` (`scripts/mutacion-comparar.ts`) se puede vaciar y **nada se pone rojo**.
Medido, dos roturas independientes, restaurando entre medias:

| Rotura | `npm run verify` | `mutacion-candados` | `mutacion-cableado` |
|---|---|---|---|
| `if (total.censo > 0)` → `if (false as boolean)` | 2716 verde | **50/50 verde** | **16/16 verde** |
| borrar `console.log(\`  ${titularDeSinEjercer(total)}\`)` | 2716 verde | **50/50 verde** | **16/16 verde** |

Con la primera rotura, la salida real del verbo sobre la corrida `34878198682` pierde esto en
silencio (el número `censo: 1122` sobrevive en el resumen; **la evidencia no**):

```
  CENSO (no es condición): 1122 mutante(s) `NoCoverage` cuya base midió con
  `coverageAnalysis: "off"`, que NO PUEDE emitir `NoCoverage` JAMÁS. … (#598) …
    187  src/scene/blueprint/scatter.ts
    169  src/scene/greybox/volume-prims.ts
    …
```

Es decir: **el rótulo, el puntero a #598 y la lista de ficheros de la que sale #598 desaparecen y
todo sigue verde.** Con la segunda rotura desaparece `⊘ NO SE PUDO MIRAR`, que es literalmente la
frase que #599 vino a instalar.

**La mitigación declarada tampoco se sostiene.** `implementacion-3.md` §6 dice: *«lo que las
vigila es el probe del cableado, que las lee del verbo real»*. Leí el probe: sus tres regex son
`/sin ejercer\s+: (\d+) mutante/`, `/· censo\s+: (\d+) mutante/` —las dos del resumen de
`comparaEnSeco`, **otra ruta de código**— y `/mutante\(s\) que ya NO EJERCE NINGÚN TEST/` sobre el
`porque`. **Ninguna toca `imprimeSinEjercer`.** Por eso las dos roturas de arriba lo dejan en 16/16.

El contenido de las frases sí está candado (`titularDeSinEjercer` es puro y lo ejercen los casos
3, 5 y 6). Lo que no lo está es **que lleguen a imprimirse**.

**Remedio listo**: los bloques B y C de `qa/mutacion-la-septima-en-los-dos-sentidos.mjs` son ese
candado, y están probados en negativo (tabla en §4).

### H-3 · menor · «sin informe base» acusa a una base que sí existe, y manda a un flag ya usado

En `leeLaBase` (`mutacion-comparar.ts`), cuando el informe base del módulo **existe** y midió con
`off`, pero ese fichero concreto no está dentro de él, la capacidad cae al defecto
`{sabe:false, porque:"sin informe base"}` en vez de al motivo correcto (`coverageAnalysis "off"`).

**Reproducción** (informe base `m.json` con `coverageAnalysis: "off"` que solo contiene
`src/OTRO.ts`; se compara `src/x.ts`, que trae 1 `NoCoverage`):

```
  qué se mira: base: off (no podía expresar `NoCoverage`) · ahora: perTest
  censo (base incapaz): 0 · sin poder mirar (sin informe base): 1
  ⇒ NO SE ADOPTA — 1 mutante(s) `NoCoverage` en 1 fichero(s) que NO SE PUDO MIRAR (src/x.ts):
    no hay informe base … — pásale los informes de la corrida base:
    npm run mutacion -- comparar --timeouts <dir>
```

Dos líneas más arriba el mismo bloque dice `base: off`, o sea que **sí** hay informe base. El
motivo se contradice con su propia cabecera y prescribe el flag que el usuario acaba de usar: un
remedio sin salida. La clasificación correcta es CENSO (con `off` esa base tampoco podría haber
contestado).

Niega, que es la dirección segura, y **no ocurrió en la corrida real** (`sin base: 0`,
`sin mirar: 0`). Por eso es menor. Pero es alcanzable en cuanto un módulo gane un fichero entre
dos corridas, que es justo lo que pasa cuando #441 parta `scene-validate`.

### O-1 · observación, no hallazgo · «enteros» es del número, no de la lista

El censo imprime el total (1122) entero, pero su lista por fichero es `.slice(0, 10)`: nombra
**10 de los 43**. No es regresión —el código anterior también recortaba a 10— y el conteo, que es
lo que vota y lo que cita #598, va completo. Lo anoto porque el encargo pedía «enteros» y conviene
saber que eso vale para la cuenta, no para la evidencia nominal.

---

## 3 · Las cuatro desviaciones declaradas, juzgadas una a una

| # | Desviación | Juicio |
|---|---|---|
| **D1** | El invariante del cableado no compara `SE PUEDE ADOPTAR` vs `NO SE ADOPTA` como pedía el plan; corre el verbo dos veces sobre el mismo material cambiando solo el `coverageAnalysis` de la base | **Aceptada. Igual de concluyente PARA #599, y las dos razones son ciertas.** Verifiqué que `comparar` lee la huella de git (`git show HEAD:…`), así que el ensayo no puede reducir los 90 esperados y `sinMedir = 89` tumba siempre por la condición 6. Lo que el probe observa —`sinEjercer`, `censo` y si el motivo 7a aparece— **es el sujeto de #599**, no un proxy; y el flip del veredicto final sí queda demostrado, pero por otra vía (criterio 2: el `NO SE ADOPTA` real pasó de citar 1122 mutantes a citar 5 ficheros). Lo que se pierde: el probe no vería una regresión en la que `sinEjercer` se calcula bien y no llega a `peros` — eso lo cubren los casos unitarios 1 y 4, que verifiqué rojos. **No es más débil; es más estrecho, y el ingeniero lo dice.** |
| **D2** | Fail-loud también en la corrida nueva, no solo en la base | **Aceptada, y es mejor que el plan.** Sin leer el `coverageAnalysis` de la corrida nueva el bloque no puede imprimir `ahora: perTest`, que es media respuesta a «qué estás mirando». Está acotado al verbo `comparar` (`coberturaDeLaCorrida`), así que `repartir` y `fusionar` no pueden morirse por él. Riesgo de falso rojo comprobado: 59 + 59 informes en disco, **todos con `config`**. |
| **D3** | Los dos `grep` no están a cero | **Aceptada, y habría sido un error cumplirla al pie de la letra.** Comprobado hoy: `timeout-minutes: 180` no queda ni una vez en código, contratos, `qa/` ni workflow, y **`CLAUDE.md:72` ya está arreglado** por el coordinador en `d4ef1f41` («se comió el techo de 180 minutos del job único»). Los 6 hits que quedan son 1 tabla de una QA cerrada del 04-09 que **verifica** que ese día eran 18, 1 registro fechado del triaje del 10-09, y 4 citas en `requisitos.md`/`critica.md`/`critica-2.md` de **esta** tanda, que citan la frase para mandarla borrar. **Cero afirmaciones vivas.** La distinción «prosa viva sí, archivo fechado no» se sostiene: reescribir un informe de QA cerrado para que un grep dé cero es falsificar un registro, que es la otra forma de mentir y la que esta casa ya se ha cobrado. El CA literal del plan §5 está mal escrito, no mal cumplido. |
| **D4** | `CorridaQueJuzga.esperados` decía «Hoy son 87»; ahora dice 90 | **Correcta, verificada.** `mutacion-huella.json` tiene **91 filas**; el verbo real imprime `85 fichero(s) de los 90 de la huella`. La fila que sobra sigue siendo `src/protocol/status-labels.ts`. Corregir un número caducado en el comentario de la interfaz que se está cambiando es exactamente lo que trata esta PR; que lo dijera en voz alta es lo correcto. |

---

## 4 · Guion ejecutable que dejo

**`/home/al/code/ne-fan-qa599/qa/mutacion-la-septima-en-los-dos-sentidos.mjs`** — 6 comprobaciones.
Llama a las funciones reales (`veredictoDeAdopcion`, `titularDeSinEjercer`, `comparaEnSeco`) con
material sintético; **no toca `reports/`** (su base de ensayo vive en el temporal del sistema), no
lanza Stryker y no gasta un céntimo. Va en `qa/` y no en `qa/guiones/` por el mismo motivo escrito
en la cabecera de sus dos hermanos: `run.mjs` conduce todo lo de `guiones/` contra un navegador, y
aquí no hay nada que un jugador mire.

Estado hoy: **exit 1** — A1 y A2 rojos (reproducen H-1); B y C verdes (son el candado que falta
para H-2). Cuando H-1 se arregle, queda verde y protege las tres cosas.

**Probado en negativo, una rotura cada vez y restaurando entre medias:**

| Rotura | Se pone rojo |
|---|---|
| `if (total.censo > 0)` → `if (false as boolean)` | **B1, B2** |
| borrar el `console.log` del titular | **C1** |
| `nombrar (#598)` → `nombrar` | **B2** |
| `if (t.mirados === 0)` → `if (false as boolean)` (rotura E del ingeniero) | **C1, C2** |

Y probé en negativo **mi propio guion**: la primera versión de B2 buscaba `/#598/` en toda la
salida y **se quedaba verde** al borrar el puntero del censo, porque el `porque` de un veredicto
que adopta también cita #598 (`mutacion-huella.ts:680`). Lo acoté al párrafo del censo y entonces
sí se pone rojo. Queda escrito en el fichero: es el mismo defecto que este informe reporta,
cometido por mí en el primer intento.

`test/architecture.test.ts` + `test/qa-lib-tiene-quien-lo-mire.test.ts`: **114/114 verde** con el
fichero nuevo en el árbol (no es `qa/lib/`, así que no necesita entrada en `banco-medido.json`).

---

## 5 · Lo que él declara NO cubierto, y si debería bloquear

| Declarado | ¿Bloquea? |
|---|---|
| `comparaEnSeco` sin test unitario | **No bloquea la fusión, pero no es «solo cadenas de `console.log`»**: es H-2, y la razón que se da para dejarlo pasar (lo vigila el probe del cableado) no es cierta. Mi guion lo cierra. |
| `coverageAnalysis: "all"` decidido y nunca medido | **No.** Tiene test unitario (`capacidadDeLaBase("all") → {sabe:true}`), y la decisión yerra hacia negar, que es la dirección segura. Es una decisión razonada honestamente etiquetada como tal. |
| Base mixta real no existe hoy | **No.** El caso 4 es sintético pero **mide**: con la forma «booleano de corrida» falla con `501 !== 1`. |
| «Un runner que rompiera la cobertura sin mover ningún mutante de bando se colaría» | **Esto es H-1, y la razón que lo acompaña es falsa.** No bloquea la fusión —el sentido reverso no es alcanzable hasta que se adopte `perTest`— pero no puede quedarse como límite aceptado con una justificación que el propio código contradice. Va como hallazgo. |
| Nada de #597 ni #545 | **Correcto**, es lo que manda el plan. |

---

## 6 · Workarounds usados

| Workaround | Veredicto |
|---|---|
| Romper a mano `mutacion-huella.ts` y `mutacion-comparar.ts` (9 roturas) y restaurar con `git checkout --` | **No afecta al usuario**: es el método del propio banco (`mutacion-candados-en-negativo.mjs` hace lo mismo). Verifiqué `git status` limpio tras cada una; el único fichero que queda en el árbol es mi guion nuevo. |
| Llamar a `comparaEnSeco` con `console.log` interceptado y material sintético en `$TMPDIR` | **No afecta al usuario**: no se puede provocar una descarga mixta ni una base `perTest` real sin gastar dos corridas autorizadas, y eso está prohibido en este encargo. La distinción está en el TIPO, así que el material sintético ejerce la misma rama. |
| Reproducir el sentido reverso con las funciones puras en vez de con dos directorios reales | **Declarado**: no existe hoy una descarga con la corrida nueva en `off` y la base en `perTest`. Lo que verifiqué es el mecanismo, no una corrida. |

**Ningún workaround fue necesario para observar lo que la PR entrega**: el criterio central
(`comparar --timeouts reports/mutation-base`) se reproduce con el comando del plan, tal cual, sin
tocar nada.

---

## 7 · No probado, y por qué

- **Una corrida de mutación real con la corrección puesta.** Prohibido en este encargo (escribiría
  en `reports/mutation/` y destruiría el material de la demostración). Lo que sí está probado es el
  verbo sobre las dos corridas ya bajadas, que es la prueba que el plan pedía.
- **`coverageAnalysis: "all"` sobre material real.** No existe en disco; lo verifiqué contando los
  59 + 59 informes (`perTest` y `off`, cero sin `config`).
- **El ahorro de `tap-runner` y los 26 `RuntimeError` de #597.** Fuera del alcance de esta PR.
- **Cualquier cosa del cliente, del renderer o del juego.** Esta PR no toca producción: 0 ficheros
  en `src/` o `bridge/`. No arranqué `./start.sh` ni abrí navegador porque no hay nada que un
  jugador pueda ver.

---

## 8 · Veredicto

**APTO CON HALLAZGOS.**

Lo que la PR prometió, lo cumple y lo demuestra sobre datos reales: el defecto de #599 está muerto,
los 1122 dejan de votar y salen como censo con su sitio al que ir, el `NO SE ADOPTA` pasa a citar
los 5 ficheros de #597, y —lo que más importaba— **no se ha convertido en una abstención
permanente**: la condición se pone roja con base capaz (verbo real, probe del cableado) y verde
cuando toca, y las roturas B y F ponen rojos los casos 1 y 6. La trampa simétrica que había que
buscar, no está: por ese lado el arreglo es sólido. Las cifras se sostienen todas (2716 / 86 / 0
sobre tope / 90).

Se fusiona sin miedo: **desbloquea la siguiente corrida autorizada, que es su razón de ser**, y los
dos hallazgos son de la misma familia que esta casa lleva ocho apariciones persiguiendo —*el
candado cubre menos de lo que su nombre promete*— pero ninguno afecta al camino que la tanda va a
recorrer ahora.

Lo que vuelve al ingeniero, por orden:

1. **H-1** — hacer condición lo que ya se calcula e imprime (`coberturaAhora`), o bajar la promesa
   del nombre. Lo que no puede quedarse es el límite declarado con una razón que el propio
   `esVivo` desmiente.
2. **H-2** — adoptar los bloques B y C de mi guion en el arnés que corresponda (`candados` corre en
   CI; `cableado` no), y corregir en `implementacion-3.md` §6 la afirmación de que el probe del
   cableado vigila esas líneas.
3. **H-3** — clasificar como CENSO el fichero ausente de un informe base `off`, para que el motivo
   deje de contradecir su propia cabecera.
