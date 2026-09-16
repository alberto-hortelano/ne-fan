# QA · tercera vuelta de PR-4b (#545) — V-1, V-2, H-2b y H-6

Árbol `/home/al/code/ne-fan-qa545b`, HEAD desprendido en **`7ce9e86f`** («El cortafuegos vuelve a
ser proporcional, y el candado sujeta la mitad que faltaba»), rama sobre `main` = `e55c5067`.
Verificación **focalizada** del último arreglo: no se repite `qa-6.md`, se comprueba que lo que
allí fallaba ya no falla. `qa-6.md` no se ha tocado (`git diff HEAD --` vacío sobre él).

Todo lo que sigue lo he medido yo en ESTE árbol. Cero créditos (`e2e-sin-creditos` vía
`qa/run.mjs`, motor falso), ningún `pkill`, ningún servidor ajeno tocado, ni una sola corrección
aplicada al código. El árbol quedó **limpio** (`git status --porcelain` vacío) y con los md5 de
los cuatro ficheros que mutó esta validación **idénticos** a los de antes.

---

## 0 · Veredicto

**APTO CON RESERVAS — esta PR se fusiona hoy.**

Los tres puntos del encargo (**V-1**, **V-2**, **H-2b**) están cerrados y los he verificado con
mis propias mutaciones, incluidas nueve que no estaban en mi tabla. **V-1 está arreglado y medido
con el runner de verdad**, no solo con la función: `{sim: 120}` vuelve a esperar **1.200.000 ms**
de pared en una corrida real del guion 58. Los dos mutantes que yo había medido en verde (B2 y
B4) ahora son **rojos**, y el conjunto entero de nueve mutaciones nuevas muere salvo una.

Esa una es la reserva, y **no bloquea**: el aserto del sitio de llamada —el que más interesaba—
**sujeta menos de lo que su propio texto promete**. Dice que el defecto «se hace INEXPRESABLE»,
y he vuelto a expresarlo con **una línea** que deja el candado, la casa entera (2850/2850) y el
guion real en verde, con el cortafuegos otra vez en 30.000 ms. Lo que separa esto de V-1 es que
V-1 era un umbral **bajado y embarcado**, y esto es una puerta trasera **hipotética** sobre un
umbral que hoy es correcto y está medido. Va a issue con su medida y con el aserto que la cierra,
ya probado en negativo.

Y una corrección del expediente: el límite que el ingeniero declara en **H-6** («solo pasa la
mentira elaborada») **está subestimado**. La vía barata que no vio no es prosa plausible: es la
palabra `bridge` copiada veinte veces. La medí sobre un defecto REAL reintroducido y silencia el
sitio con **7 pass · 0 fail**.

---

## 1 · Criterios

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **La regla dura**: el último arreglo no toca un solo guion | ✅ cumple | `git diff 28c99f8e..HEAD --stat -- qa/guiones/` → **vacío**. Los seis ficheros del arreglo son `data/contract/esperas-que-conducen.json`, `test/esperas-que-conducen.test.ts`, `test/sonda-de-qa.test.ts`, `qa/README.md`, `qa/lib/sonda.mjs` y `qa/run.mjs`. Y `git diff -- qa/guiones/` sobre el árbol de trabajo: vacío también (`git status --porcelain` limpio) |
| 2 | **El diff no toca producción** | ✅ cumple | `git diff main...HEAD --name-only \| grep -E '^(nefan-core/src\|nefan-html/src\|nefan-core/bridge\|bridge\|ai_server)/'` → **0 ficheros**, sobre la rama ENTERA, no solo sobre el último arreglo |
| 3 | **V-1 · el cortafuegos vuelve a ser proporcional** | ✅ cumple | Medido por mí con la función: `{sim:4}` **40.000** · `{sim:6}` **60.000** · `{sim:12}` **120.000** · `{sim:60}` **600.000** · `{sim:120}` **1.200.000**. Los cinco valores que declara, exactos. Ver §2.1 |
| 4 | **V-1 · medido con el RUNNER de verdad** | ✅ cumple | Instrumentación propia en `presupuestoDeEspera` (más adentro que la suya, que era en `expectEspera`) + `node qa/run.mjs 58` → `[QA7] presupuesto={"sim":120} techoMs=1200000`, **exit 0**, guion verde. Instrumentación revertida, `md5sum` idéntico |
| 5 | **V-1 · la rama de pared no cambia un byte** | ✅ cumple | `{}` → 30.000 · `{ms:15000}` → 15.000 · `{ms:120000}` → 120.000 · `{sim:4,ms:60000}` → 60.000 (manda el escrito). Y el fail-loud se conserva: `{ms:null}`, `{ms:null,sim:4}`, `{ms:4}` y `{sim:0}` **lanzan** nombrando qué llegó |
| 6 | **V-2 · mis cuatro mutantes, remedidos** | ✅ cumple | Base 41 pass · 0 fail. **B1** fail 1 · **B2** fail 1 · **B3** fail 2 · **B4** fail 1. Los dos que conmigo daban **pass 32 · fail 0** (B2 y B4) son rojos ahora, y el aserto que los mata es el nuevo. Ver §2.2 |
| 7 | **V-2 · mutaciones que NO estaban en mi tabla** | ✅ cumple (8 de 9) | `N19` (`??`) rojo · `M5` (forma equivalente) rojo · `M6` (`CORTAFUEGOS_POR_SIM`→5) rojo · `M13` (techo plano un piso más abajo) **fail 3** · `M14` (sim topado a 30) rojo · `M11` (`{...opciones}`) rojo · `M12` (alias inocente) rojo. **La novena, `M10`, sale VERDE**: ver H-7 |
| 8 | **El aserto del SITIO DE LLAMADA sujeta de verdad** | ❌ **NO cumple lo que promete** | Sujeta el ARGUMENTO (`M11` y `M12` lo ponen rojo), no la DECISIÓN. Con `opciones = { ms: 30_000, ...opciones };` insertado justo antes de la llamada: **41 pass · 0 fail**, `npm test` **2850/2850**, y el runner real devuelve `{"sim":120,"ms":30000} techoMs=30000` sobre el guion 58, que sigue **verde**. V-1 entero, otra vez. Ver **H-7** |
| 9 | **H-2b · el censo de 9 y el argumento de los 8 `frames`** | ✅ se sostiene | Censo **propio** por AST (grafo de llamadas, profundidad 3, incluidas las arrow de `const`) sobre todo `qa/**.mjs`: **9 sitios**, las MISMAS líneas que él lista, **8 en `frames()`** (37×2, 43, 58, 83, 86, 109, 112) y 1 en `veredictoDe()` del 133. Ni uno más |
| 10 | **H-2b · «espera por fotogramas» es lo contrario del defecto** | ✅ cierto, y por dos razones (una suya y una mía) | `frames()` sondea `fps().frames >= desde+n` con 20.000 ms de pared como CORTAFUEGOS, y `waitFor` **LANZA** (`EsperaExpirada`) al agotarlo: bajo carga da rojo ruidoso, no un negativo vacuo. Y la razón cuantitativa que él no da: con el clamp de 0,1 s, **bajo carga un fotograma trae MÁS mundo** (0,1 s frente a ~0,016 s a 60 fps), así que los dos asertos del 37 —`libre.metros > 0.5` y `conDialogo.metros === 0`— se REFUERZAN con la carga en vez de debilitarse. Ver §2.3 |
| 11 | **H-6 · el relleno ya no pasa** | ✅ cumple | Mi caso de la 1.ª vuelta (130 equis + `bridge`): **el test no arranca**, ZodError con las dos causas |
| 12 | **H-6 · el límite declarado (la mentira elaborada)** | ⚠️ **cierto pero SUBESTIMADO** | Confirmado: defecto real reintroducido en el 58 + exención con `sujeto` falso y prosa de 67 palabras → **7 pass · 0 fail**. Pero la vía barata es mucho más barata: `porque` = «bridge» ×20 (139 ch, 20 palabras, **1 distinta**) → **7 pass · 0 fail** igual. Ver **H-8** |
| 13 | **80 y 75, por el TEXTO y no por el color** | ✅ cumple, y mejor que su medida | **Cinco parejas** `node qa/run.mjs 80 75`: **30 líneas de aserto en las cinco** y los **30 TEXTOS byte a byte idénticos** entre las cinco (`diff` vacío, par 1 vs 2/3/4/5), incluida una corrida con rojo dentro. El aserto de #496/#497 (`…ni deja una entrada de error`) está **presente y ✔ en las cinco**. Los guiones 80 y 75 son byte-idénticos a `main` (`git diff main...HEAD --` sobre los dos: vacío). Colores: 80 **✔ 5 de 5** (él vio ✘ 4 de 5), y **75 ✘ 1 de 5** — ver §2.4 |
| 14 | **`npm run verify` verde** | ✅ cumple | `npm run build` exit 0 · `npm run verify` **exit 0 · tests 2850 · suites 506 · pass 2850 · fail 0**. Coincide con su cifra |
| 15 | **Los candados en negativo, sin cambios** | ✅ cumple | `node qa/esperas-candados-en-negativo.mjs` → 19 casos · **14 sujetan · 0 no sujetan** · 5 agujeros declarados, **0 cambiados**. `node qa/bateria-candados-en-negativo.mjs` → **10 nacen rojos/⊘ y nombran la causa · 0 que no se enteran · 0 patrón obsoleto** |
| 16 | **La batería real no se rompió** | ✅ cumple | `node qa/run.mjs 58 86 109 112 132 133 91 43 06 45 118` → **12 en verde · 0 en rojo de 12** (el filtro por subcadena metió también el 106), 178 líneas de aserto, exit 0 |
| 17 | **Deuda, CRAP y mutación** | ⚠️ no aplica, y por construcción | El diff no toca un solo fichero de producción (criterio 2), así que no hay módulo que medir ni trailer `Mutación:` que escribir. Coincido con §13.6 |

---

## 2 · Las medidas, una a una

### 2.1 · V-1 · el cortafuegos, con la función y con el runner

Con la función (`presupuestoConducido` → `presupuestoDeEspera`), que es donde vive la regla:

```
{sim:4}    → {"sim":4}    sim=4   techoMs=40000     rótulo «4.00 s de sim (cortafuegos de pared 40000 ms)»
{sim:6}    → {"sim":6}    sim=6   techoMs=60000
{sim:12}   → {"sim":12}   sim=12  techoMs=120000
{sim:60}   → {"sim":60}   sim=60  techoMs=600000
{sim:120}  → {"sim":120}  sim=120 techoMs=1200000
```

Los cinco cortafuegos que declara, exactos, y la regla ×10 de PR-4a restaurada. La rama de pared
queda intacta (`{}`→30.000, `{ms:15000}`→15.000, `{ms:120000}`→120.000) y el `ms` ESCRITO sigue
mandando sobre el proporcional (`{sim:4, ms:60000}` → 60.000).

Y el fail-loud no se ha cambiado por un defecto silencioso, que es lo que él dice haberse cazado a
sí mismo con `??`:

```
{ms:null}       → {"ms":null}        LANZA: «…son MILISEGUNDOS de pared y llegó null»
{ms:null,sim:4} → {"sim":4,"ms":null} LANZA: «el cortafuegos de pared de un presupuesto de sim…»
{ms:4}          → {"ms":4}           LANZA: «no llega ni a la cadencia de sondeo (150 ms)…»
{sim:0}         → {"sim":0}          LANZA: «son SEGUNDOS de mundo > 0»
```

**Con el runner de verdad** (mi propia instrumentación, un `console.error` dentro de
`presupuestoDeEspera` — un piso más adentro que la suya, así que ve TODAS las esperas y no solo
las de `expectEspera`):

```
$ node qa/run.mjs 58                                   # exit 0, 1 en verde de 1
[QA7] presupuesto={"sim":120} techoMs=1200000 · caminar al este PROPONE explorar la zona vecin
```

Ése es el `{sim: 120}` del guion 58:190, uno de los cuatro sitios que esta tanda convirtió.
Instrumentación revertida; `md5sum qa/lib/sonda.mjs` idéntico antes y después.

### 2.2 · V-2 · la batería de mutantes

Base de comparación: `node --import tsx --test test/sonda-de-qa.test.ts test/esperas-que-conducen.test.ts`
→ **41 tests · 41 pass · 0 fail**. Cada mutación aplicada SOLA, medida y revertida con `md5sum`
comprobado (y `git status` limpio al final).

| # | Mutación | Dónde | Antes (qa-6) | Ahora |
|---|---|---|---|---|
| **B1** | V-1 tal cual (`{ms = 30_000}` + `sim===null?{ms}:{sim,ms}`) | `sonda.mjs` | — (era el defecto) | **fail 1** ✔ |
| **B2** | `return { ms }` — se pierde `sim` | `sonda.mjs` | **pass 32 · fail 0** | **fail 1** ✔ |
| **B3** | `return { sim: ms }` | `sonda.mjs` | fail 1 | **fail 2** ✔ |
| **B4** | `sim===null?{ms}:{sim: ms, ms}` | `sonda.mjs` | **pass 32 · fail 0** | **fail 1** ✔ |
| **N19** | `ms ?? 30_000` en vez de `=== undefined` | `sonda.mjs` | — | **fail 1** ✔ |
| **M5** | `{sim, ms: sim*1000*10}` — misma conducta, otra forma | `sonda.mjs` | — | **fail 1** (ver §3.1) |
| **M6** | `CORTAFUEGOS_POR_SIM = 5` | `sonda.mjs` | — | **fail 1** ✔ («el múltiplo ya no cubre la razón medida a factor 40») |
| **M6b** | `CORTAFUEGOS_POR_SIM = 7` | `sonda.mjs` | — | **41 pass** — y está BIEN: ver §3.2 |
| **M13** | `techoMs = ms ?? Math.min(30_000, sim*10_000)` — el techo plano un piso más abajo | `sonda.mjs` | — | **fail 3** ✔ |
| **M14** | `{ sim: Math.min(sim, 30) }` — el presupuesto de mundo topado | `sonda.mjs` | — | **fail 1** ✔ |
| **M11** | `presupuestoConducido({ ...opciones })` | `run.mjs` | — | **fail 1** ✔ (el candado del sitio de llamada) |
| **M12** | `const opts = opciones; presupuestoConducido(opts)` — alias inocente | `run.mjs` | — | **fail 1** (falso positivo que falla CERRADO: §3.3) |
| **M10** | `opciones = { ms: 30_000, ...opciones };` ANTES de la llamada | `run.mjs` | — | **41 pass · 0 fail** ✘ **H-7** |

Los cuatro míos están muertos, y los cinco nuevos que apuntan a la función también. El eje que
sigue abierto es uno solo, y es el sitio de llamada.

### 2.3 · H-2b · el censo de los 9, verificado por mi cuenta

Escribí mi propio detector cruzado (AST, grafo de llamadas dentro del fichero, profundidad 3,
contando también las funciones declaradas como `const f = async () => {}`, que su descripción no
menciona) y lo corrí contra **todo** `qa/**.mjs` menos `qa/run.mjs`:

```
qa/guiones/109-…:125 llama a frames() con tecla puesta → waitFor de pared en :110 (20_000)
qa/guiones/112-…:84  llama a frames()                  → :69  (20_000)
qa/guiones/133-…:355 llama a veredictoDe()             → :87  (presupuesto)
qa/guiones/37-…:97   llama a frames()                  → :81  (20_000)
qa/guiones/37-…:170  llama a frames()                  → :81  (20_000)
qa/guiones/43-…:94   llama a frames()                  → :67  (20_000)
qa/guiones/58-…:113  llama a frames()                  → :97  (20_000)
qa/guiones/83-…:110  llama a frames()                  → :68  (20_000)
qa/guiones/86-…:122  llama a frames()                  → :107 (20_000)

TOTAL: 9 sitio(s) · por helper: frames=8 · veredictoDe=1
```

**Mismas nueve líneas que él.** El censo se sostiene y la proporción 8/9 también.

**¿Es «espera por fotogramas» lo contrario del defecto? Sí, y por dos motivos:**

1. El que él da, y es correcto: el PREDICADO cuenta `fps().frames`, o sea tics del juego; el
   presupuesto de pared (20 s) es el cortafuegos y no la condición. Y lo he comprobado donde
   importa: `waitFor` con presupuesto de pared **LANZA `EsperaExpirada`** al agotarse
   (`qa/lib/sonda.mjs:511`). Bajo carga, `frames()` no devuelve un negativo vacuo: **revienta**.
   Eso es exactamente lo inverso de #545, donde la espera se cumplía sola y el guion afirmaba.
2. El que **no** da, y refuerza su decisión: con el clamp de 0,1 s por frame, **bajo carga cada
   fotograma trae MÁS mundo** (0,1 s frente a ~0,0166 s a 60 fps), hasta ×6. Los asertos que
   cuelgan de `frames()` son del tipo `libre.metros > 0.5` (positivo) y `conDialogo.metros === 0`
   (negativo) en el guion 37: con más mundo por fotograma, el positivo tiene MÁS margen y el
   negativo MÁS oportunidad de falsarse. La carga los refuerza, no los diluye.

Conclusión: **no extender el detector está bien decidido y bien medido**, y el caso ejecutable con
control-del-control (`teclaFuera` → `[]`, `teclaDentro` → 1 sitio) es la forma correcta de dejar
declarado un agujero. Lo verifiqué en negativo por su lado: con `conTeclaMantenida` cegado, ese
caso es uno de los tres que se ponen rojos, así que su «0 sitios» es una medida y no un verde
vacío.

### 2.4 · El 80 y el 75, por el TEXTO

Cinco parejas seguidas, cada una con su log:

| pareja | exit | líneas de aserto | 75 | 80 |
|---|---|---|---|---|
| 1 | 0 | **30** | ✔ | ✔ |
| 2 | 0 | **30** | ✔ | ✔ |
| 3 | 0 | **30** | ✔ | ✔ |
| 4 | **1** | **30** | **✘** | ✔ |
| 5 | 0 | **30** | ✔ | ✔ |

Y la medida que pediste, **por el TEXTO**: extraje los 30 asertos de cada corrida quitándoles el
detalle variable y los comparé:

```
par1 vs par2: IDÉNTICO (30 asertos)
par1 vs par3: IDÉNTICO (30 asertos)
par1 vs par4: IDÉNTICO (30 asertos)   ← y ésta llevaba un ROJO dentro
par1 vs par5: IDÉNTICO (30 asertos)
```

El conjunto de asertos no se mueve entre una corrida roja y cuatro verdes: el instrumento está
intacto y el color es intermitencia. Y el aserto que H-1 había matado —el que sostiene
#496/#497— **está y sale ✔ en las cinco**: `…ni deja una entrada de error`.

**Dato nuevo, y no es de esta PR:** el rojo de mi pareja 4 no está en el 80, está **en el 75**:

```
✘ 3 · #410 · el tile que vuelve con otras salidas NO re-deriva su colisión (misma huella)
      — 2 derivaciones (había 1) — la escena servida cambió en: npcs (barkeep: position)
✘ 3 · …porque la colisión se RESTAURÓ (el store lo cuenta) y la huella es la misma
      — 0 restauraciones · huella DISTINTA
```

No es atribuible a esta PR y la cadena causal está cerrada: el guion 75 es **byte-idéntico a
`main`** (`git diff main...HEAD` sobre él: vacío), la PR no lo toca, y su única espera se escribe
`{ ms: 30_000, arg, aserto }` con el `ms` **literal** (`75:96`), así que el cambio del último
arreglo —que solo altera el presupuesto cuando NADIE escribió `ms`— no puede haberlo rozado. Lo
declaro como observación, y como **no medido sobre `main`** (§5).

---

## 3 · Hallazgos

### H-7 · IMPORTANTE (no bloqueante) — el aserto del sitio de llamada canda el ARGUMENTO, no la decisión, y su texto promete lo contrario

**Qué dice.** `test/sonda-de-qa.test.ts`, en el caso «y el runner no decide nada del presupuesto:
le pasa sus opciones TAL CUAL», y en el comentario que lo acompaña:

> Así que el defecto se hace **INEXPRESABLE**: si el runner no arma nada, no puede armarlo mal.

**Qué hace.** Lee el árbol de `qa/run.mjs` y exige que la lista de llamadas a
`presupuestoConducido` sea exactamente `[{ dentroDe: "expectEspera", argumentos: "opciones" }]`.
Eso canda el **texto del argumento**. No canda que `opciones` sea lo que el guion escribió.

**El defecto, reexpresado con UNA línea** (la llamada sigue siendo, literalmente,
`presupuestoConducido(opciones)`):

```js
// qa/run.mjs, dentro de expectEspera, justo antes de la llamada
opciones = { ms: 30_000, ...opciones };
const presupuesto = presupuestoConducido(opciones);
```

**Medido, en los tres sitios donde tenía que saltar y no saltó:**

| Qué | Salida |
|---|---|
| `node --import tsx --test test/sonda-de-qa.test.ts test/esperas-que-conducen.test.ts` | **41 pass · 0 fail** |
| `node --import tsx --test test/*.test.ts` (la casa entera, con M10 puesta) | **tests 2850 · pass 2850 · fail 0** |
| `node qa/run.mjs 58` con M10 + mi instrumentación | `[QA7] presupuesto={"sim":120,"ms":30000} techoMs=30000` · **1 en verde de 1**, exit 0 |

O sea: **V-1 entero otra vez** —cortafuegos de 30.000 ms planos para todo `{sim:N}`, ×0,025 en los
`{sim: 120}` de esta tanda— sin que se entere ni CI, ni la batería, ni el candado que se escribió
para esto. Es el mismo mecanismo de V-1, en el mismo sitio, con otra ortografía.

**Por qué NO bloquea** (y lo digo con el mismo criterio con el que V-1 sí bloqueaba): V-1 era un
umbral **bajado y embarcado**, medible en el árbol que se iba a fusionar. Esto es una puerta que
nadie ha cruzado: hoy el cortafuegos es el correcto y lo he medido con el runner real (§2.1), y
`M10` no es una forma que nadie escriba sin querer. Lo que sí hay que corregir es el **texto**:
«INEXPRESABLE» es documentación falsa el día que se escriba, y esta casa ya sabe lo que cuesta una
razón inventada al lado de una decisión correcta.

**Reproducción desde el arranque:**

```bash
cd /home/al/code/ne-fan-qa545b
# 1 · poner la línea antes de `const presupuesto = presupuestoConducido(opciones);` en qa/run.mjs
# 2 ·
cd nefan-core && node --import tsx --test test/sonda-de-qa.test.ts test/esperas-que-conducen.test.ts
#    → 41 pass · 0 fail  (el candado no se entera)
cd .. && node qa/run.mjs 58
#    → 1 en verde   (la batería tampoco)
```

**El aserto que lo cierra, ya probado en negativo por mí** (no lo aplico: es del ingeniero). Son
~12 líneas junto a `llamadasAPresupuestoConducido`: buscar en el cuerpo de `expectEspera` toda
asignación cuyo lado izquierdo sea el parámetro de opciones (`opciones`, `opciones.x`,
`opciones[k]`) y exigir **cero**. Mi prototipo:

```
$ node <prototipo> qa/run.mjs                  # HEAD limpio
parámetro de opciones: `opciones` · escrituras sobre él dentro de expectEspera: 0
✔ VERDE: nadie lo reescribe                                                    exit 0

$ node <prototipo> qa/run.mjs                  # con M10 puesta
escrituras sobre él dentro de expectEspera: 1
  run.mjs:1028 · opciones = { ms: 30_000, ...opciones }
✘ ROJO: el runner decide el presupuesto por la puerta de atrás                 exit 1
```

Va a **issue** con esta medida, o entra en la PR si el ingeniero quiere cerrarlo hoy: es aditivo,
no toca producción y no toca ningún guion.

### H-8 · MENOR-IMPORTANTE — el límite declarado de H-6 está subestimado: la vía barata es una palabra repetida

**Lo que declara** (`_comment` del contrato, §13.5 del informe): el listón sube de «relleno» a
prosa, y lo único que queda fuera es **la mentira ELABORADA** («un `sujeto` falso escrito en prosa
plausible»). El razonamiento escrito en el fuente es: *«lo que no cumple ninguna de las dos formas
de relleno es TENER PALABRAS»*.

**Es falso, y la falsación cuesta un copiar-pegar.** Un relleno tiene palabras si repites una.
Medido sobre un defecto REAL reintroducido en el guion 58 (`{sim:120}` → `{ms:120_000}`), con su
control:

| # | Exención | `porque` | Resultado |
|---|---|---|---|
| control | ninguna | — | **fail 1**, nombrando `58:186 · expectEspera(…, {ms})` ✔ |
| su N17 | `sujeto` falso | 130 equis + «bridge» | **el test no arranca** (ZodError, las dos causas) ✔ |
| su N17b | `sujeto` falso | prosa plausible, 67 palabras / 49 distintas | **7 pass · 0 fail** — su límite, confirmado |
| **mío** | `sujeto` falso (48 ch) | **`"bridge"` ×20** — 139 ch, 20 palabras, **1 distinta** | **7 pass · 0 fail** |
| mío | `sujeto` real | lorem ipsum + «bridge», 29 distintas | **7 pass · 0 fail** |

**Y hay vía barata que él no vio, con su medida:** exigir palabras **DISTINTAS**, no palabras.

```
exenciones vivas          palabras   distintas
80-el-desplegable-room         159        105
05-terreno-desde-ground         86         67
42-al-enemigo-no-se-le          65         44   ← la más apretada
43-hablando-el-teclado          82         56
133-la-parada-falsa (×2)     77, 80     46, 56
«bridge» ×20                    20          1
```

Un `.refine(f => new Set(f.toLowerCase().split(/\s+/)).size >= 20, …)` deja a las seis vivas con
**2,2× de margen** (la peor, 44) y mata el caso de arriba en seco. No cierra el lorem ipsum (29
distintas) ni la mentira elaborada: ésos siguen siendo el límite honesto y su sitio es la revisión
del diff, como está escrito. Lo que hay que corregir es **la frase**: el listón no ha subido a
«prosa plausible», ha subido a «una palabra repetida veinte veces».

Issue, con esta tabla.

---

## 4 · Observaciones que no son hallazgos

### 4.1 · El aserto nuevo mira la forma, y su comentario dice que no

El caso «…y ESPERA EN SIM» abre con `assert.deepEqual(p, { sim })`, que **sí** es la forma, mientras
su comentario dice «este caso NO mira la forma, mira lo que se va a esperar». Lo medí con `M5`
(`{sim, ms: sim*1000*10}`, conducta **idéntica** hoy): sale rojo. Defiendo el aserto —congelar el
cortafuegos en el sitio de llamada haría que un cambio de `CORTAFUEGOS_POR_SIM` no se propagase—,
pero el comentario dice lo que el código no hace. Cosmético.

### 4.2 · `CORTAFUEGOS_POR_SIM` está candado contra un SUELO medido, no contra el número 10

`M6` (→ 5) es rojo por `assert.ok(1 / CORTAFUEGOS_POR_SIM <= 0.152)`, que es la razón sim/pared
medida a ×40. `M6b` (→ 7) es **verde**, y debe serlo: 1/7 = 0,143 ≤ 0,152, o sea que ×7 todavía
cubre la carga medida. La banda verde es «7 o más». No es un agujero: es el criterio escrito, con
su medida al lado. Lo anoto para que nadie lo lea como «un umbral que se puede bajar un 30 % sin
que nadie se entere» — se puede, y está declarado por qué.

### 4.3 · El candado del sitio de llamada tiene un falso positivo, y falla CERRADO

`M12` —`const opts = opciones; presupuestoConducido(opts)`, semánticamente idéntico— sale **rojo**.
Un renombrado inocente rompe el candado. Es la dirección buena del error (falla cerrado, no
abierto) y el mensaje explica qué hacer; no pido cambiarlo.

---

## 5 · Workarounds usados

| Qué | Por qué no afecta al jugador |
|---|---|
| 13 mutaciones temporales de `qa/lib/sonda.mjs` y `qa/run.mjs`, una a una | Es la prueba en negativo. Cada una restaurada desde copia con `md5sum` comprobado; `git status --porcelain` **vacío** al final |
| Instrumentación temporal de `presupuestoDeEspera` (un `console.error`) para medir el cortafuegos con el runner real | Solo lee y escribe a stderr; revertida, `md5sum` idéntico. Es la única forma de ver el techo sin agotarlo: el `rotulo` solo se imprime cuando una espera expira SIN observador |
| Defecto real reintroducido en `qa/guiones/58…mjs` (`{sim:120}` → `{ms:120_000}`) para medir H-6 con un sitio de verdad | Restaurado con `git checkout --`; `git diff -- qa/guiones/` vacío al cerrar. Sin sitio real, una exención no prueba nada (el test la mata por «sin sujeto») |
| Exenciones falsas añadidas y quitadas del contrato | Mismo motivo; fichero restaurado, `md5sum` idéntico (`32a820f5…`) |

Ninguno es un obstáculo que el jugador vaya a encontrarse: no hay `display:none`, ni estado
sintético, ni pantalla saltada. **El único obstáculo real que dejo apuntado es H-7**, y por eso es
hallazgo y no receta.

**No dejo guion nuevo en `qa/guiones/`, y es deliberado**: lo mecánico de esta vuelta es un aserto
de unidad sobre el árbol de `qa/run.mjs` (H-7), no una comprobación sobre la página, y añadir un
fichero allí ensuciaría justo la ruta cuya limpieza es la regla dura que se me pidió verificar. El
prototipo ejecutable de ese aserto está en H-7, probado en negativo, listo para que el ingeniero lo
pegue junto a `llamadasAPresupuestoConducido`.

---

## 6 · No probado

- **Que el rojo del 75 exista en `main`**: no lo corrí allí. Lo que sí está cerrado es la cadena
  causal (guion byte-idéntico, `ms` literal, cero producción tocada), pero «pre-existente» es una
  inferencia mía, no una medida.
- **Que el cortafuegos de 1.200.000 ms sea SUFICIENTE bajo carga real**: ningún guion de hoy agota
  un presupuesto de `{sim:120}` —todos se cumplen en segundos—, así que sigue siendo razonamiento
  (razón 0,15 a ×40 ⇒ ×10 cubre) más el suelo candado de §4.2. Igual que declaró él.
- **La batería completa**: esta vuelta es focalizada. Corrí 12 guiones + 5 parejas + los dos
  scripts de candados en negativo, no los 47 de la primera vuelta.
- **#496/#497**: siguen fuera del alcance; lo único que se comprueba aquí es que el 80 vuelve a
  poder medirlos, y eso sale ✔ en las cinco parejas.
- **Gasto real de créditos**: no aplica — todo con el motor falso (`e2e-sin-creditos`); el censo de
  gasto del runner declara puertas contra el fake, no contra un proveedor.

---

## 7 · Veredicto

**APTO CON RESERVAS — se fusiona hoy.**

- **V-1**: cerrado y medido dos veces (función y runner real). Los cinco cortafuegos son los que
  promete. ✅
- **V-2**: cerrado. Mis cuatro mutantes muertos, incluidos los dos que salían verdes; y ocho de
  mis nueve mutaciones nuevas también. ✅
- **H-2b**: la frontera declarada es, por fin, la real; el censo de 9 y el argumento de los 8
  `frames()` se sostienen los dos, verificados con mi propio detector, y la decisión de no
  extender está bien tomada. ✅
- **Regla dura**: `qa/guiones/` sin tocar en el último arreglo, cero ficheros de producción en la
  rama entera. ✅
- **Reservas, las dos a issue con su medida**: **H-7** (el aserto del sitio de llamada canda el
  argumento y no la decisión; V-1 se reexpresa con una línea y nada se entera — con el aserto que
  lo cierra ya probado en negativo) y **H-8** (el límite de H-6 está subestimado: la vía barata es
  «bridge» ×20, no la prosa plausible; el arreglo cuesta un `new Set` y las seis exenciones vivas
  lo pasan con 2,2× de margen).

Si el ingeniero quiere cerrar H-7 y H-8 hoy, los dos son aditivos, no tocan producción y no tocan
ningún guion: no cambiarían nada de lo verificado arriba. Si no, la PR entra igual y los dos van a
issue con las cifras de este documento.
