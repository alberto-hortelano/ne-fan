# QA — Un timeout agotado no puede decidir un veredicto en verde (#261)

Rama `fix/el-timeout-que-decide`, commit `4b711da`, árbol limpio (salvo un PDF ajeno en
`nefan-core/data/styles/anime/characters/` que no es de esta tanda y no se ha tocado).

**El sujeto de esta tanda es el propio instrumento de verificación**, así que la pregunta del
jugador se traduce en una sola: *¿puede esta batería seguir declarando verde algo que no midió?*
Todo lo que sigue está medido en este árbol, no heredado de `implementacion.md`: la corrida
completa, la batería de candados en negativo, las cinco mutaciones del test del CI y los doce
casos adversariales son míos, corridos hoy.

**Todas las cifras de guiones son de una corrida LOCAL** (el CI no ejecuta `qa/`), con el preset
`e2e-sin-creditos` y **cero créditos** — el guardarraíl imprimió `fake:true` en los 49 guiones y
el HUD de las capturas lee `gasto sesión 0,00 € · total 0,00 €`. No se mató ningún proceso ajeno:
`qa/run.mjs` eligió su propio bloque de puertos y levantó y bajó su stack.

---

## 1 · Criterios

### 1.a · Los seis de `requisitos.md` (la decisión del usuario: «el reencuadre completo»)

| # | Criterio literal | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **El invariante es la no-medida**: un guion que no ha podido medir un bloque no termina verde — o rojo, o `⊘` con motivo | ⚠️ **casi** | Cierto para toda expiración de `ctx.waitFor` que alguien deja caer *y que aterriza antes del veredicto*. **Tres caminos siguen acabando en verde sin medir**: la espera no esperada (hallazgo 1), la sonda rota bajo `debeOcurrir:false` (hallazgo 3) y la espera que no es `ctx.waitFor` (hallazgo 4). Medido: `qa/esperas-candados-en-negativo.mjs`, tres entradas `⚠️ agujero` |
| 2 | **El candado es de RUNTIME**, no arch-rule, y se prueba en negativo | ✅ | Vive en `qa/run.mjs:996-1015` sobre `qa/lib/esperas.mjs`. Probado en negativo por dos vías independientes: `node qa/bateria-candados-en-negativo.mjs` → **9/9 nacen rojos y nombran la causa** (corrida mía, 100 s, árbol limpio), y mi `node qa/esperas-candados-en-negativo.mjs` → **8/8 candados sujetan**. La parte pura entra en el CI: `nefan-core/test/esperas-de-qa.test.ts`, 18 casos, visto correr dentro de `npm run verify` (líneas `▶ libro de esperas: …`) |
| 3 | **Cinco familias, se arreglan tres**; D y E son legales y el candado no puede ponerlas rojas; el porqué va EN el candado | ✅ | `node qa/run.mjs` completo: **49 en verde · 0 en rojo · 0 ⊘ · exit 0** (255 s). Los nueve guiones de D/E verdes (02, 06, 30, 41, 42, 45, 48, 49, 50) y las cuatro afirmaciones negativas impresas: `✔ el jugador NO atraviesa la huella del edificio` · `✔ … NO cruza por el agua (fila 70)` · `✔ … NO atraviesa el tronco` · `✔ … NO cruza por la muralla`. El porqué está escrito en la cabecera de `qa/lib/esperas.mjs:30-51`, con el censo de hoy, y **no hay lista de exenciones** |
| 4 | **Criterio que nace rojo sobre los 16 sitios** (enumerados 19) | ⚠️ **17 de 19** | Los 19 sitios enumerados están migrados (los verifiqué uno a uno contra `git show main:…`), más `10:523` de la crítica y 2 fuera de censo. **Excepción: `15:114` y `41:129`** se reclasificaron de A a E (desviación 2 del ingeniero) y **su banda de umbrales sigue abierta** — hallazgo 2. Ninguno de los dos se demostró «naciendo rojo»: el representante de A que se puso en rojo fue `25:157` |
| 5 | **`11:73` se arregla pase lo que pase** | ✅ | Verificado por mí de forma independiente. La tecla llega bien (`holdUntil("up", …)` vía `tecla:"up"`; `scripted-input-provider.ts:35-37` escribe `state.up`). **El ✔ nuevo se pone rojo**: devolviendo la tecla a `"el jugador se mueve"`, `node qa/run.mjs 11-un-solo` → `✘ ocurre: el jugador anda al menos 1 m … no ocurrió en 15000 ms · último valor null`, **exit 1**. Sano: `ⓘ 1889 ms` con `--diag` (antes quemaba los 15 s enteros y salía verde) |
| 6 | `waitFor` sigue legal · `qa-guiones-sin-espera-por-reloj` no se toca · el `why` cuenta el censo de HOY | ✅ | `git diff main...HEAD -- nefan-core/data/contract/arch-rules.json` **vacío**. El censo de hoy (89 · 55 matan · 27 no · 7 no son esperas) está en `qa/lib/esperas.mjs:31-34`. Recuento verificado: `.catch(` en `qa/guiones/` **91 → 63**, `.catch(() => null)` **62 → 40** (el informe decía 62→40 y 91→63: exacto) |

### 1.b · Los seis de `plan.md` §7

| # | Criterio | Veredicto | Evidencia (corrida mía) |
|---|---|---|---|
| 1 | la no-medida no acaba verde (entrada nueva en la batería) | ✅ | `node qa/bateria-candados-en-negativo.mjs` **corrida entera sobre árbol limpio** (el ingeniero solo pudo ejercer su destrozo a mano): `🔴 rojo #261 · una espera que expira sin que nadie la observe NO puede acabar en verde`, y el rojo nombra `02-colision-desde-huella.mjs:56`. Total: `Candados probados 9 · Nacen rojos y NOMBRAN la causa 9 · No se enteran 0` |
| 2 | el candado es de runtime y el CI lo ve | ✅ | Ver 1.a·2. Y **probé el test en negativo yo**, sin heredar la prueba del ingeniero: cinco mutaciones sobre una copia aislada de `esperas.mjs` (`pendientes()→[]` · `resuelve()` resuelve todas · `esperaExpiradaEn` no sigue el `cause` · el fallo pierde las tres bocas · `sitioDeLlamada` coge el primer marco) → **5 fail, 2 fail, 1 fail, 1 fail, 2 fail**. Ninguna pasa desapercibida |
| 3 | D y E no se ponen rojas | ✅ | Ver 1.a·3 |
| 4 | los 16 nacen rojos | ⚠️ | Ver 1.a·4 (17 de 19) |
| 5 | `11:73` deja de quemar 15 s | ✅ | `ⓘ 1889 ms` (`--diag`, medido hoy) |
| 6 | nada más se rompe | ✅ | `cd nefan-core && npm run verify` → **VERIFY EXIT=0**, `tests 1732 · pass 1732 · fail 0` (build · typecheck:scripts · typecheck:labs · lint · test), corrido por mí **con mi fichero nuevo de QA ya en el árbol**. `npm run afectado`: `NO EJECUTA NADA — ningún módulo carga nada de lo que ha cambiado` |

### 1.c · Los que me puse yo (pasada adversarial)

| Criterio | Veredicto | Evidencia |
|---|---|---|
| No hay una **cuarta boca**: `try/catch` a pelo | ✅ | `try-catch-a-pelo` → ✘, nombra `expiró.*nadie la observó` |
| …un `finally` que devuelve | ✅ | `finally-que-devuelve` → ✘ |
| …dos esperas en un `Promise.all` | ✅ (con matiz) | `promise-all-dos-esperas` → ✘ con **las dos** líneas… pero solo tras meterle 2 s de margen. Sin margen, la segunda no llega a tiempo — hallazgo 1 |
| …un `absorbe` que envuelve más de lo que dice | ✅ | `absorbe-no-absorbe-de-mas` → ✘: absorbe consume **solo** la expiración que sale por su boca, no el bloque. La tragada dentro del bloque sigue pendiente |
| …una espera que **no se espera** (fire-and-forget) | ❌ | `hallazgo-espera-que-aterriza-tarde` → **VERDE**. Hallazgo 1 |
| Un `absorbe` legítimo sigue siendo verde (control: un candado que pone todo rojo no canda nada) | ✅ | `control-absorbe-legitimo` → ✔ |
| Un negativo deliberado sigue siendo verde (control) | ✅ | `control-expect-espera-negativa` → ✔ |
| **Los 55 `.catch()` que MATAN siguen matando** | ✅ | Muestreo de 5 leídos línea a línea (`08:79`→`ctx.expect(acuse?.encolado===…)`, `19:245`, `41:433`, `48:257`, `50:105`): todos degradan a `null`/`false` y el `ctx.expect` de después exige truthy. Y la forma entera, ejercida: `control-catch-que-mata-sigue-matando` → ✘ con **las dos** líneas (el aserto de siempre + la del libro), que es el «fallo doble» que §8 acepta |
| `absorbe(motivo)`: ¿pasa un motivo vacío, de relleno o que nombra un fichero? | ❌ | Rechaza `""`, `"   "`, `undefined`, `null`, `true`, `0`, `{}`, `["x"]`. **Acepta** `"x"`, `"porque sí"`, `"TODO"`, `"n/a"`, `"."` y `"41-el-jugador-puede-pelear.mjs"`. Hallazgo 5 |
| Un `sinMedirBloque` ajeno no puede convertir un rojo en verde | ✅ | `bloque-declarado-degrada-a-circulo` → ⊘ (exit 2). No es verde. Pero el motivo del ⊘ habla de otra cosa — hallazgo 6 |
| Familia D con la **sonda rota** | ❌ | `hallazgo-sonda-rota-en-negativo` → **VERDE**. Hallazgo 3 |
| Esperas que no pasan por el libro | ❌ | `hallazgo-espera-fuera-del-libro` → **VERDE**. Hallazgo 4 |
| La banda de umbrales de `15:114` y `41:129` | ❌ | Hallazgo 2 |
| Los verbos nuevos se usan de verdad | ✅ | 11 `expectEspera` (10 guiones), 11 `absorbe` (6 sitios + el helper), 6 `sinMedirBloque`. La versión-prosa del canal (`ctx.log("⚠ … no se midió")`) está a **0** |

**El guion ejecutable de todo esto**: `/home/al/code/ne-fan/qa/esperas-candados-en-negativo.mjs`.
Escribe guiones temporales en `qa/guiones/`, los corre bajo `run.mjs` y los borra en un `finally`
(se niega a arrancar si encuentra restos). Distingue dos clases de entrada: `candado` (tiene que
salir rojo o ⊘) y `hallazgo` (hoy sale verde y es un agujero conocido; si algún día sale rojo el
script lo dice y pide reclasificarlo). **Probado en negativo**: con `pendientes()` devolviendo
`[]` en `qa/lib/esperas.mjs`, sale `Candados que NO sujetan: 4` y **exit 1**; sano, exit 0 con
`Casos probados 12 · Candados que sujetan 8 · Agujeros conocidos, sin cambio 4`.

---

## 2 · Hallazgos

### 🟠 Importante 1 · La cuarta boca existe: una expiración que aterriza después del veredicto no la cuenta nadie

`qa/lib/esperas.mjs:15-16` afirma, dentro del propio candado: *«Se da por observada de tres
formas, **y no hay una cuarta**»*. Hay una cuarta, y no es resolverla: es **no llegar a tiempo al
recuento**. El candado lee `pendientes()` de forma síncrona justo después de que el guion
devuelva (`qa/run.mjs:1003`), así que una expiración que se anota un tick más tarde no existe.

**Reproducción desde el arranque**: `node qa/esperas-candados-en-negativo.mjs aterriza`. El guion
temporal es una línea:

```js
void ctx.waitFor("expiración que aterriza después del veredicto", () => null, 600).catch(() => null);
ctx.expect("el guion sigue vivo y afirma algo trivial", true);
```

→ `✔ zz…-hallazgo-espera-que-aterriza-tarde`, **exit 0**.

No es teórico: es exactamente por esto que `Promise.all([espera, espera])` sale con **una sola**
línea de fallo en vez de dos (la hermana que pierde la carrera se anota tarde), y por lo que mi
entrada `promise-all-dos-esperas` necesita un `waitForSelector` de 2 s de margen para que el
candado vea las dos. Un `await ctx.absorbe(motivo, () => Promise.all([w1, w2]))` con las dos
expirando sale **VERDE** hoy, y eso es una forma perfectamente escribible.

**Qué esperaba**: que la promesa de las tres bocas fuera cierta, o que el candado esperase a que
el bucle de eventos se vacíe antes de leer el libro.
**Alcance vivo**: hoy ningún guion tiene una espera flotante (`grep` de `void ctx.waitFor` /
`Promise.all` en `qa/guiones/` = 0), así que no hay mentira en el árbol; lo que hay es una frase
falsa escrita en el sitio donde esta tanda dice que la verdad tiene que vivir.

### 🟠 Importante 2 · La banda de umbrales de `15:114` y `41:129` sigue abierta, y en 41 con los mismos números

La desviación 2 del ingeniero reclasifica los dos sitios de A a E y afirma que *«lo que cerraba la
banda … es que la distancia final se afirme siempre y con un solo umbral»*. Son **dos** umbrales,
no uno:

| Sitio | La espera exige | El aserto admite | Banda de «expiró y verde igual» |
|---|---|---|---|
| `qa/lib/combate.mjs:70` vs `:80` (`acercarse`, ex-`41:129`) | `d ≤ 1,6 m` | `d ≤ 2,6 m` | **1,0 m — idéntica a la que la crítica llamó defecto** (`objetivo` 1,6 · `holgura` 1,0) |
| `qa/guiones/15…:121` vs `:326`/`:394` (`situarse`, ex-`15:114`) | `\|d − 8\| ≤ 1,5` | `\|d − 8\| ≤ 3,0` | ±1,5 m (antes ±… sobre 3-16; se estrecha, no se cierra) |

Y no es un margen académico. En mi corrida completa, guion 15: `guardia a 6.56 m del jugador
antes del ataque` → la espera exigía ≥ 6,5 m y se cumplió **por 6 cm**; el aserto admite hasta
5,0 m. A 6,4 m —un desenlace igual de plausible— los doce cortafuegos habrían expirado, se
habrían absorbido con su motivo, y el guion habría salido verde exactamente igual.

Lo que **sí** compra el cambio, y es real: el aserto de la distancia final ahora existe en los 7
sitios de llamada (el 42 no lo tenía) y el umbral se escribe una vez en lugar de dos. Pero la
decisión del usuario decía «los 16 sitios de las familias A/B/C **arreglados**», y en estos dos la
banda que los puso en la lista sigue ahí.

**Reproducción**: `node qa/run.mjs 15-guardia` y mirar la línea `guardia a … m` contra
`TOLERANCIA_DE_SITIO * 2` en `qa/guiones/15-guardia-se-ve-y-se-comporta.mjs:394`.
**Qué esperaba**: o el aserto con el umbral de la espera, o la holgura justificada por lo que
tarda la medida final (que es lo que la haría legítima) — hoy la holgura no está justificada en
ninguna parte, solo declarada.

### 🟠 Importante 3 · Familia D: un bloque que NO SE PUDO medir sigue acabando verde

`waitFor` convierte cualquier error de la página en `{__err: …}` y sigue sondeando
(`qa/lib/sonda.mjs:88`), así que una sonda **rota** es indistinguible de una condición que no se
cumple. Con `expectEspera(desc, false, …)` —«el timeout ES el éxito»— eso se afirma como ✔, y el
último valor (que contiene el `__err`) solo se imprime en el ✘, o sea nunca.

**Reproducción**: `node qa/esperas-candados-en-negativo.mjs sonda-rota`:

```js
await ctx.expectEspera("el jugador atraviesa el muro (con la sonda rota a propósito)", false,
  () => { throw new Error("la sonda está rota: window.__nefan.noExiste"); },
  { ms: 900, aserto: "el jugador NO atraviesa la huella del edificio" });
```

→ `✔ el jugador NO atraviesa la huella del edificio`, **exit 0**. Un campo renombrado dentro de la
sonda basta: el aserto pasa sin haber mirado nada.

**Alcance**: los 4 sitios de D (`02`, `06`, `30`, `45`). En 06 y 02 hay contrapartida positiva con
la misma sonda, que actúa de control natural; en **30** el negativo va casi solo.
**No es regresión** —la forma anterior (`let atraveso = true; …catch(() => {atraveso=false})`)
tenía el mismo agujero— pero es el invariante literal del punto 1 de `requisitos.md`, y §5 de
`implementacion.md` no lo declara entre lo que no queda cubierto. Con `ms: 0` se consigue lo
mismo sin sonda rota siquiera.

### 🟡 Menor 4 · El libro solo ve `ctx.waitFor`

`page.waitForSelector` (27 usos en `qa/guiones/` + 2 en `qa/lib/sesion.mjs`) y los bucles propios
de `qa/lib/saves.mjs:101` (`esperarPartidaEnDisco`) y `qa/lib/puertos.mjs` no se anotan. Un
`.catch(() => null)` sobre cualquiera de ellos sale verde.
**Reproducción**: `node qa/esperas-candados-en-negativo.mjs fuera-del-libro` → ✔, exit 0.
**Estado vivo**: hoy ninguno se traga (el único `catch` sobre un `waitForSelector`,
`18:132-135`, degrada a `respondio=false` y el `expect` lo mata). §5 declara solo los *scripts
sueltos*; esta superficie, dentro de los guiones, no está declarada.

### 🟡 Menor 5 · `absorbe(motivo)` / `sinMedirBloque(motivo)`: la criba solo rechaza el vacío

El riesgo §8 del plan («un `absorbe("porque sí")`, o un motivo que nombra un fichero») no tiene
ninguna mitigación mecánica: cualquier cadena no vacía pasa. Medido con
`node -e` sobre `ctxDeSonda({})`: aceptados `"x"`, `"porque sí"`, `"TODO"`, `"n/a"`, `"."`,
`"41-el-jugador-puede-pelear.mjs"`.
**Hoy no está pasando**: los 11 motivos escritos son frases que dicen dónde vive la medida, y los
leí uno a uno. Lo reporto porque la única red es la revisión del diff, y eso conviene que esté
escrito en el informe y no solo en la cabeza de quien revisó.

### 🟡 Menor 6 · Un `sinMedirBloque` ajeno degrada a ⊘ un rojo que era del libro

`qa/run.mjs:978` hace `declaro = … || ctx.bloquesSinMedir.length > 0`, así que **cualquier**
bloque declarado convierte **todas** las pendientes en detalle de su ⊘, aunque no tengan nada que
ver. No es una vía de escape (⊘ = exit 2, peor que rojo en la escala de `veredictos.mjs:26-40`,
y lo verifiqué: exit 2), pero el motivo impreso describe otro bloque, y quien lea el ⊘ diagnostica
mal.
**Reproducción**: `node qa/esperas-candados-en-negativo.mjs bloque-declarado`.

### 🟡 Menor 7 · `sitioDeLlamada` se queda sin sitio en el caso que más cuesta encontrar

Cuando la espera nace dentro de un `Promise.all`, el fallo dice
`expiró a los 600 ms en at async Promise.all (index 1)`: ni fichero ni línea. Es justo el caso
donde el diagnóstico hace más falta.

### ⚪ Nota 8 · 17 y 25 pierden el aserto sobre la posición medida *después* de soltar la tecla

Antes se afirmaba la separación releída tras el paseo; ahora se afirma la condición de la espera
durante el paseo. En la práctica es lo mismo (la posición no cambia al soltar), pero si el jugador
rebotara contra algo entre ambos instantes ya no se vería. `posAntes` se sigue calculando y
logueando. No pido cambio; lo dejo escrito.

### ⚪ Nota 9 · El PDF ajeno ensucia `npm run afectado`

`npm run afectado` responde `→ TODOS: es un dato del paquete` por
`data/styles/anime/characters/…pdf`, que no es de esta tanda. La conclusión del ingeniero
(«ningún módulo carga nada de lo que ha cambiado» para `qa/**`) es correcta igual; solo aviso de
que esa línea del informe se lee raro hoy.

---

## 3 · Workarounds usados durante la prueba

| Workaround | Veredicto |
|---|---|
| **Escribir guiones temporales en `qa/guiones/` y borrarlos** para las doce sondas adversariales | **No es un hallazgo.** Es el mecanismo que ya usa `qa/bateria-candados-en-negativo.mjs` (escribe en el árbol y restaura). Lo formalicé en `qa/esperas-candados-en-negativo.mjs`, que se niega a arrancar si encuentra restos y limpia en un `finally`; verifiqué `git status` limpio después de cada corrida |
| **Destrozar `qa/lib/esperas.mjs` (`pendientes() → []`)** para probar mi propio script en negativo | **No es un hallazgo.** Restaurado desde copia y verificado idéntico (`diff -q`) |
| **Destrozar la tecla del guion 11** para probar que el ✔ nuevo se pone rojo | **No es un hallazgo.** Restaurado desde copia; `git status` limpio |
| **Copiar `esperas.mjs` + el test a un directorio aislado** para las cinco mutaciones del test del CI | **No es un hallazgo.** Se hizo así precisamente para no ensuciar el árbol mientras corría la batería completa |
| Ninguno de estos toca el JUEGO: no hubo `display:none`, ni estado sintético, ni pantalla saltada | — |

---

## 4 · No probado

- **El CI nunca ha visto esta rama.** No hay rama en `origin` (`git ls-remote` vacío) ni PR
  (`gh pr list --head fix/el-timeout-que-decide` vacío). Todo lo verde de este informe es local, y
  CLAUDE.md es explícito: *verde en local NO es verde*. Es la condición que falta para cerrar.
- **Los caminos ⊘ reales de la batería no se ejercieron**: en mi corrida completa hubo **0 ⊘**, o
  sea que el `else` de `42:417` y los tres `sinMedirBloque`/`sinMedir` de 49 nunca corrieron con
  datos de verdad. Los ejercí sintéticamente (mi entrada `bloque-declarado-…`, y el ingeniero en
  §3.5); su comportamiento *dentro de esos guiones* sigue sin medirse. El riesgo «⊘ crónico» de §8
  no se puede evaluar con una sola corrida.
- **`npm run crap` / `coverage` no los volví a correr.** El diff no añade una línea a
  `nefan-core/src`, así que no pueden moverse; me quedo con la medida del ingeniero y lo declaro.
- **Mutación**: `npm run afectado` dice que no hay nada que medir (`qa/` está fuera del perímetro).
  Verificado por mí, no heredado.
- **Estabilidad / intermitencia**: una sola corrida completa (255 s). El riesgo §8 «la migración
  cambia el timing» no se puede descartar con una muestra de uno; no vi ningún guion lento ni
  ningún rojo en guiones no tocados.

---

## 5 · Veredicto

**Apto con reservas.**

Lo que se pidió está hecho y **está demostrado, no afirmado**: el candado existe, es de runtime,
nace rojo sobre el caso del issue, D y E siguen siendo legales sin lista de exenciones, los 19
sitios enumerados están migrados, `11:73` deja de quemar 15 s y su ✔ nuevo se pone rojo cuando se
le devuelve el bug, la batería entera sigue en 49/49 y `npm run verify` en 1732/1732. La prueba en
negativo —que es el entregable de verdad de esta tanda— la corrí entera sobre árbol limpio y
además la rehíce por mi cuenta: cinco mutaciones del test del CI, doce casos adversariales, y mi
propio script probado en negativo contra el candado desactivado.

Las reservas, por orden:

1. **La frase «y no hay una cuarta», escrita dentro del candado, es falsa** (hallazgo 1). En una
   tanda cuyo objeto es que el instrumento no mienta, una afirmación falsa en el instrumento
   pesa más que su alcance práctico, que hoy es nulo. O se cierra el hueco (esperar a que el bucle
   de eventos se vacíe antes de leer el libro) o se corrige la frase para que diga lo que hace.
2. **`15:114` y `41:129` no están arreglados como pedía la decisión del usuario** (hallazgo 2), y
   el motivo escrito en la absorción promete un umbral único que no existe. Es defendible
   reclasificarlos a E; lo que no es defendible es darlos por cerrados sin decir que la banda
   sigue ahí — en 41, con los mismos 1,6 y 2,6 que la crítica llamó defecto.
3. **La familia D puede acabar verde sin medir** (hallazgo 3) y eso no está en la lista de «qué NO
   queda cubierto». No es regresión, pero es el invariante literal del punto 1.

Ninguna de las tres impide mergear el mecanismo: las tres son *precisión de la promesa*, no
roturas del candado. Las tres cabrían en una vuelta corta al mismo ingeniero (corregir la
cabecera de `esperas.mjs`, ampliar §5 con los hallazgos 1, 3 y 4, y decidir si la holgura de
`acercarse`/`situarse` se justifica o se estrecha). Y falta la condición dura de cierre: **el CI
verde sobre la rama**, que hoy no existe.
