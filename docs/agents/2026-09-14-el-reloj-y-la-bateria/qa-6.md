# QA · PR-4b de #545 — el patrón de la parada, por sim

Árbol `/home/al/code/ne-fan-qa545b`, HEAD desprendido en `c5d47a65` sobre `main` = `866f50ad`.
Todo lo que sigue lo he medido yo en ESTE árbol. Del árbol del ingeniero solo he LEÍDO su
evidencia cruda (`/home/al/code/ne-fan-545b/qa/capturas/pr4b-545b/`), sin tocar nada.
Cero créditos (`e2e-sin-creditos`, motor falso, `sinMotor` en los dos guiones nuevos), ningún
servidor ajeno tocado, ni un `pkill`.

---

## 0 · Veredicto

**NO APTO** — vuelve al ingeniero. Un solo defecto lo tumba, y es en el sitio que el plan
protegía por escrito:

> **El guion 80 ya no corre.** Muere en su primera espera conducida con el fail-loud nuevo de
> `holdUntil`, antes de llegar al aserto que lo hacía útil. Su fichero está intacto —eso es
> cierto—, pero el harness cambió debajo. Y el informe (§5.4) declara justo lo contrario
> («mismo color y el MISMO aserto con los MISMOS números»), **contradicho por su propio log**.

El resto de la entrega es sólido y lo he verificado en negativo: el molde aguanta cinco mutantes
a mano y el sabotaje de su puerta, los controles del 132 discriminan de verdad en las dos
direcciones, la frontera se respeta (y lo demuestro sin depender de una corrida), y las dos
afirmaciones que el ingeniero usa para rehacer el encargo —el 91 y el censo de los 13— **son
ciertas las dos**, medidas por mi cuenta. El arreglo de lo bloqueante es de una línea.

Y tres correcciones del expediente que no bloquean la PR pero cambian lo que se escriba después:

- **H-2** · el candado nuevo **no ve el defecto en la forma en la que #545 se encontró**: corrido
  contra los 91, 86 y 109 de `main` —los tres que lo tenían— dice **0 sitios**. Muerde el
  `holdUntil` (verificado: puso rojo mi guion), y deja escribible `press` + `waitFor`, que es como
  estaban escritos los tres. El issue de seguimiento tiene que llevar este mecanismo, no el de los
  cinco ficheros con `keyboard.down`.
- **H-3** · `saltadas`, el número que el 91 registra «para decir si la carga estaba haciendo algo»,
  va **anticorrelado** con la carga: 26 y 8 en la corrida quieta, **0 y 0** en las dos frenadas.
- **H-5** · **sí hay un rojo de #545 reproducible hoy, y es el 93**: ×40, 1 de 1, con las cuatro
  medidas de velocidad hundidas a 0,40-0,56 de lo esperado. El informe razona bien por qué el 93
  está expuesto y por qué no cabía arreglarlo; lo que no hizo fue la corrida de cuatro minutos que
  lo convierte en un hecho. Eso corrige la frase «hoy no hay rojo de #545 que reproducir».

---

## 1 · Criterios

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **La regla dura**: el diff solo cambia CÓMO se espera, nunca QUÉ se cuenta ni sobre qué canal | ✅ cumple | Extractor propio por AST del TEXTO de cada aserto (`ctx.expect`, `expectEspera` + su `aserto`) sobre los **130 guiones de `main`**: **1.541 sitios de aserto**, y el `diff` contra HEAD (excluyendo los guiones NUEVOS 132 y 133) sale **VACÍO**. Ni uno añadido, borrado, reescrito ni cambiado de signo. Esto es una identidad estática, no una corrida: es más fuerte que los 631→639 del informe, que son una muestra de una batería no determinista. El canal tampoco cambia: en 86/109 el predicado pasa de `__nefan.playerPos` a `state().pos`, y `state()` devuelve `{...deps.playerPos}` (`nefan-html/src/dev/nefan-hook.ts:177`) — la misma fuente |
| 2 | **«El 91 ya no reproduce un rojo de #545»** | ✅ cierto | Medido por mí sobre HEAD: `node qa/bajo-carga.mjs 91 --factor 40 --repeticiones 2` → **✔ quieto, ✔✔ a ×40**, razón sim/pared **0,272 y 0,258**, frames más largos de **12.575 y 12.845 ms**, 620 y 349 frames sobre el tope. Carga REAL y verde. Con la reserva que el propio reproductor imprime: 2 muestras no son «aguanta» |
| 3 | **«El throttling de CDP no puede producir la parada falsa»** | ✅ cierto, y ahora es candado | Escribí `qa/guiones/133-…` para medirlo en vez de razonarlo. A ×40 y a ×100, dos corridas cada uno (razón **0,585 / 0,626** y **0,245 / 0,250**, las de ×100 tan frenadas como las suyas): **0 sondeos de 40 vuelven sin que el mundo haya corrido, racha máxima 0**, y el patrón viejo NO declara parada andando. Con **control**: en el estado desacoplado (loop pausado) la MISMA cuenta ve racha ≥ 3 — o sea que el 0 es un hecho del dial, no una cuenta rota |
| 4 | **«El censo de los 13 era un `grep -l quieto`»** | ✅ cierto, comprobado dos veces | `grep -l quieto qa/guiones/*.mjs` sobre `main` devuelve **exactamente** 41 42 46 62 67 73 88 91 93 110 111 113 126, con `grep -c` = **5 en el 91 y 2 en el 41**, que son los dos números que el plan citaba. Y mi censo por AST del patrón (predicado que lee posición + memoria entre sondeos + umbral de metros + cuenta de muestras quietas) da **cuatro**: 91, 118, 86, 109. Los 12 restantes llevan «quieto» en prosa o dentro del texto de un aserto |
| 5 | El patrón de la parada, en un molde con fail-loud | ✅ cumple | `qa/lib/parada.mjs` + 19 tests. **Mutado a mano por mí**: `dentroDe` ignorado → 1 rojo · `arranque` ignorado → 1 · `muestras` −1 → 3 · `referencia` invertida → 1 · `eje` colapsado a euclídea → 1 · la puerta del sim desactivada → **4**. Seis de seis mutantes muertos: la batería no es decorativa (y hace falta mirarlo a mano, porque `qa/` está fuera de Stryker por `el-banco-no-entra-en-produccion`) |
| 6 | El rojo reproducido y el par rojo/verde | ✅ cumple | Reproduje su N2: con `if (false && sim - w.sim < a.paso)`, `node qa/run.mjs 132` → **0 en verde · 1 en ROJO**, C2 con `{"muestras":3,"saltadas":0,"quietas":3}` sobre un mundo que no simuló un frame. Con la puerta: **1 en verde**, C2 «⊘» |
| 7 | Los controles del 132 significan algo | ✅ cumple | Sabotajes míos: molde que **no declara nunca** → el guion muere en A (`timeout … el mundo avanzó los 12 s`); molde que **declara siempre** → **B en rojo**. Los dos controles discriminan. Nota: con el molde que declara siempre, **C2 sigue ✔** — o sea que C2 sola no comprueba el molde, y A/B son lo que la sostiene (que es lo que el guion dice de sí mismo) |
| 8 | `holdUntil`/`expectEspera({tecla})` exigen sim (fail-loud en ejecución) | ✅ cumple | `node qa/esperas-candados-en-negativo.mjs` → 19 casos · 14 candados sujetan · 0 que no · 5 agujeros declarados, sin cambios. Los dos casos nuevos (`holdUntil` con número y sin presupuesto) salen ✘ **nombrando la causa** |
| 9 | El candado AST en CI | ⚠️ **cumple menos de lo que promete** | Es verdad que muerde en código nuevo: **puso ROJO mi guion 133** en cuanto escribí `{ms: 8_000}` en un `holdUntil`. Pero ejecuté su detector contra los tres guiones que tenían el defecto en `main` —91, 86 y 109— y ve **0 sitios en los tres**: el defecto de #545, en la forma exacta en la que #545 se encontró (`inputDriver.press` + `ctx.waitFor(pared)`), es invisible para él. Ver **H-2** |
| 10 | `npm run verify` verde y deuda sin crecer | ✅ cumple | `npm run verify` → exit 0, **2843 tests, 0 fail**. El diff no toca **ni un fichero de `nefan-core/src` ni de `nefan-html/src`** (`git diff main...HEAD --stat`: solo `qa/**`, `nefan-core/test/**` y `data/contract/**`), así que la deuda no puede crecer por construcción |
| 11 | **80 y 75, mismo color, fuera del diff** | ❌ **NO cumple** | `git diff` no los nombra (cierto). Pero `node qa/run.mjs 80 75` en MI árbol: **75 ✔ · 80 ✘ con un ERROR del harness** — `holdUntil(«el jugador anda 0.4 m…») CONDUCE al jugador… Llegó 15000`. El 80 no llega a su aserto: **30 líneas de aserto ANTES, 19 DESPUÉS**, y la cadena «entrada de error» aparece **0 veces** en el log de después. Ver **H-1** |
| 12 | Lo que deja fuera está nombrado y es honesto | ⚠️ parcial | §7.1-7.7 son correctas y la vacuidad de `118:670` está bien diagnosticada (la verifiqué: `window.__qa118 = null` antes de la espera ⇒ `antes` es `null` ⇒ `gana = true` ⇒ `arranco` nace `true` y no puede volver a `false`; darle poder a ese aserto SÍ cambiaría lo que el guion afirma, así que tiene razón en dejarlo). Faltan de la lista: el agujero real del candado (**H-2**), el desacuerdo entre los dos candados (**H-1**), el `{ms:N}` sin suelo (**H-4**) y que el 93 **sale rojo bajo carga** y nadie lo midió aunque el plan lo pedía (**H-5**) |
| 13 | El `saltadas` que el guion 91 registra dice si la carga hizo algo | ❌ **NO cumple** (la afirmación, no el código) | Medido en mi corrida del 91: **quieto → 26 y 8 sondeos saltados; ×40 → 0 y 0, en las dos corridas frenadas**. Va exactamente al revés de lo que dice el comentario del guion y §3.3 del informe. Ver **H-3** |

---

## 2 · Hallazgos

### H-1 · BLOQUEANTE — el guion 80 ya no corre, y el informe dice que sí

**Qué pasa.** `ctx.expectEspera(desc, debe, fn, {ms, tecla})` delega en `holdUntil` pasándole
`ms` **como número suelto** (`qa/run.mjs:1004` → `presupuesto = sim === null ? ms : {…}`, y
`:1015` → `ctx.holdUntil(tecla, desc, probeFn, presupuesto, arg)`). El `holdUntil` nuevo lanza
con cualquier cosa que no sea un objeto. El guion 80 tiene exactamente esa forma en su línea 123
(`{ ms: 15_000, arg: {…}, tecla: "up" }`) y el plan mandaba **no tocarlo**.

**Reproducción desde el arranque:**

```
$ cd /home/al/code/ne-fan-qa545b && node qa/run.mjs 80 75
    ✘ ERROR: 80-el-desplegable-room-dice-lo-que-se-ve: holdUntil(«el jugador anda 0.4 m (si no,
      «volvió al spawn» no distingue nada)») CONDUCE al jugador… Llegó 15000: el número suelto
      de milisegundos murió con #545…
✔ 75-la-huella-del-tile-no-lleva-las-salidas
✘ 80-el-desplegable-room-dice-lo-que-se-ve
1 en verde · 1 en rojo de 2
```

**Por qué es bloqueante y no cosmético.**

1. El 80 **deja de medir**: aborta al empezar su bloque **2 de 4** (`80:117`) y no llega a los tres de abajo — ni al contador del `#error-log`, que es el que sostiene #496/#497. En la
   propia evidencia del ingeniero: `run-80-75-ANTES-545b.log` tiene **30** líneas de aserto y el
   rojo es `…ni deja una entrada de error — 7 → 9`; `run-80-75-DESPUES-545b.log` tiene **19** y
   la cadena «entrada de error» **no aparece ni una vez**. Mismo color, otro hecho.
2. Eso **destruye justo lo que el plan quería conservar**: «se corren antes y después y se apunta
   su color, y para que ese color signifique algo el fichero tiene que quedar byte a byte igual».
   El fichero está igual y aun así el color dejó de significar lo que decía: las ocho parejas
   medidas de #496/#497 se quedan sin instrumento.
3. **El informe afirma lo contrario de lo que dice su log** (§5.4: «Mismo color y el MISMO aserto
   con los MISMOS números en las dos… No hay hallazgo que reportar»). Es la decimoquinta
   aparición del patrón de la casa: un veredicto que se satisface sin haber mirado — esta vez,
   sin mirar el fichero que se acababa de generar.
4. Y deja a los dos candados **en desacuerdo**: la exención del contrato declara ese sitio
   legítimo («pared declarada»), el test AST la respeta… y el runner se niega a ejecutarlo. El
   contrato describe un estado que la batería no puede correr.

**Qué esperaba el usuario/el plan**: que el 80 saliera con el mismo color POR EL MISMO MOTIVO, o
que el cambio se reportara como hallazgo. Salió con el mismo color por un motivo nuevo y se
reportó como «no hay hallazgo».

**Salida más barata (no la aplico, es del ingeniero)**: que `expectEspera` construya el
presupuesto con la unidad puesta —`sim === null ? { ms } : { sim, ms }`— con lo que el `{ms}`
declarado del contrato pasa a ser ejecutable y el 80 vuelve a correr **sin tocar su fichero**.
Convertir el 80 a `{sim}` sería la otra salida, pero rompe la byte-identidad que el plan exige.

### H-2 · IMPORTANTE — el candado no ve el defecto en la forma en la que #545 se encontró

El informe declara su agujero como «no ve un guion que conduzca con `page.keyboard.down`» y nombra
37, 43, 58, 83, 112. Lo medí, y el agujero es más ancho en tres direcciones:

```
$ # el detector del candado, corrido contra los guiones de `main` que SÍ tenían el defecto
### 91-la-forja- → el detector ve 0 sitio(s) de pared
### 86-la-fronte → el detector ve 0 sitio(s) de pared
### 109-el-tile- → el detector ve 0 sitio(s) de pared
### 118-el-carro → el detector ve 2 sitio(s) de pared   (éste sí, porque usa holdUntil)
```

1. **La forma**: lo que se le escapa no es `page.keyboard.down`, es **mantener la tecla aparte y
   esperar con `ctx.waitFor`** — sea con `inputDriver.press` (el 91 de ayer) o con
   `keyboard.down` (86 y 109 de ayer). Es decir: el candado prohíbe escribir el defecto **con el
   verbo que el propio arreglo estrenó**, y lo deja escribible con el verbo con el que se escribió.
2. **La carpeta**: solo mira `qa/guiones` y `qa/lib`. Censo mío por AST de esperas de pared dentro
   de una función que mantiene tecla, en **todo** `qa/**.mjs`: **14 sitios en 5 ficheros** sobre
   HEAD, y uno de ellos es el patrón exacto que el plan llama «el presupuesto más apretado de
   todos»: `qa/fixtures-las-tres-se-caminan.mjs:87`, «el jugador avanza» **0,5 m en 8.000 ms de
   pared**, conduciendo con `inputDriver.press("up")`.
3. La respuesta a la pregunta de cabecera —**¿puede ponerse verde sin que ocurra lo que
   promete?**— es, por tanto, **sí**: con los tres guiones defectuosos de ayer delante, el candado
   habría salido verde. Muerde el código nuevo escrito con `holdUntil` (lo comprobé: puso rojo mi
   guion 133 al escribirle `{ms: 8_000}`), y eso vale; pero su nombre promete más de lo que hace.

No pido prohibir `keyboard.down` —esos guiones existen para ejercer el teclado—: pido que el issue
de seguimiento lleve **esta** lista y **este** mecanismo, no los cinco ficheros y el mecanismo
equivocado.

### H-3 · IMPORTANTE — `saltadas` no mide lo que el guion dice que mide

El 91 registra ahora `N muestras de mundo, M sondeos saltados sin frame`, y tanto el comentario del
guion como §3.3 del informe dicen que ese `M` «es el número de veces que la versión de pared se
habría apuntado una muestra que el mundo no respalda» y «el que dice si la carga estaba haciendo
algo». Mi corrida del reproductor dice lo contrario, y con claridad:

| corrida | razón sim/pared | saltadas |
|---|---|---|
| quieto (×1) | 0,976 | **26** y **8** |
| carga ×40 (1) | 0,272 | **0** y **0** |
| carga ×40 (2) | 0,258 | **0** y **0** |

Tiene sentido y el propio informe lo explica bien… en otra sección (§7.7): con `paso = 150 ms` y
razón ≈ 0,96, en reposo casi la mitad de los sondeos cae justo por debajo del paso. Bajo carga un
frame trae 12 s de mundo de golpe y **ningún** sondeo se salta. O sea: `saltadas` mide la cadencia,
no la carga, y va **anticorrelado** con ella. La cifra está bien; la frase que la acompaña —la que
se queda en el árbol— es falsa, y es del tipo que esta casa persigue («una decisión correcta con una
razón inventada»).

### H-4 · MENOR — `{ms: N}` dejó de tener suelo, y era la única red

PR-4a hacía LANZAR a `{ms: 400}` con el motivo escrito: «un presupuesto que no se entiende caería en
`timeoutMs = undefined` … un guion que mira una vez y afirma un negativo». PR-4b lo convierte en
pared declarada. Medido:

```
{"ms":4} → {"sim":null,"techoMs":4,"rotulo":null}     ← 4 ms: UN sondeo
{"ms":0} → {"sim":null,"techoMs":0,"rotulo":null}
```

`huboSondeo` solo exige **un** sondeo bueno, así que `ctx.expectEspera(desc, false, fn, {ms: 4})`
—un `{sim: 4}` mal tecleado— sale **✔ afirmando un negativo con una sola mirada**, y ni el candado
AST (no hay `tecla`) ni el fail-loud de `holdUntil` (no es `holdUntil`) lo ven. El motivo escrito
para abrir la puerta es bueno (la pared declarada tiene que poder escribirse); lo que no está
justificado es que **no tenga suelo**. Dos salidas baratas: exigir `ms ≥ CADENCIA_MS`, o llamar a la
clave `{pared: N}`, que no se puede teclear por error en lugar de `{sim: N}`.

### H-5 · IMPORTANTE — sí hay un rojo de #545 reproducible hoy: es el 93, y nadie lo midió

El plan decía «haz lo mismo con el 93 (velocidad estable)» y el informe contesta con un análisis
correcto de por qué el 93 está expuesto (§7.5: denominador = timestamp del rAF, numerador topado a
0,1 s × v) y por qué arreglarlo cae fuera de la frontera. Lo que no hay, ni en el informe ni en la
evidencia, es **una sola corrida del 93 bajo carga**. La hice yo, y cuesta cuatro minutos:

```
$ node qa/bajo-carga.mjs 93 --factor 40 --repeticiones 1
  quieto    ⏱ ×1  · razón 0.964 · 27.5 fps · frame más largo   323 ms  → ✔
  carga×40  ⏱ ×40 · razón 0.263 ·  2.9 fps · frame más largo 12716 ms  → ✘   (1/1, «se-rompio»)
    ✘ andando, el jugador va a … 4.18 m/s — medido 1.6778 m/s (12.12 m / 7.22 s, 30 m libres)
    ✘ esprintando, … 8.36 m/s — medido 4.7005 m/s
    ✘ con speed_scale × 1.5, andando … 6.27 m/s — medido 3.3027 m/s
    ✘ …esprintando … 12.54 m/s — medido 5.8944 m/s
```

Las cuatro medidas caen a **0,40-0,56 de lo esperado**, del mismo orden que la razón sim/pared de la
corrida: es exactamente el clamp de `main.ts` contra un denominador de pared, o sea **#545 puro**.

Tres consecuencias, y por eso lo subo a importante:

1. **La premisa del informe se queda a medias.** Es cierto que el 91 ya no reproduce; no es cierto
   que hoy no haya un rojo de #545 reproducible. Lo hay, sale 1 de 1, y está **en el guion que el
   plan mandaba mirar primero** — por el motivo equivocado (no tiene el patrón de la parada), pero
   era el guion correcto.
2. **El issue de seguimiento cambia de tamaño**: no es «el 93 está expuesto en teoría», es «el 93
   sale rojo a ×40 con estas cuatro cifras». Sigo de acuerdo en que arreglarlo no cabía en esta PR
   (cambiar el denominador a `reloj().sim` es tocar una magnitud medida con su tolerancia del 2 %
   al lado) — lo que no cabe es no medirlo.
3. **El clasificador del reproductor no lo atribuye**: imprime «el fallo NO lleva firma de
   presupuesto de reloj, así que no es atribuible a #545». `qa/bajo-carga.mjs` solo reconoce #545
   cuando el rojo es una espera agotada; un #545 que sale como **magnitud medida** se le escapa y lo
   manda a la familia de #496/#497. Vale la pena escribirlo donde se lee el veredicto.

Matiz de precisión sobre §7.5, ya que estamos: «el 93 **no** divide camino entre segundos de pared»
no es exacto — `seg = (t_último − t_primero)/1000` con `t` de `requestAnimationFrame` **es** reloj de
pared. Lo cierto es que no tiene el patrón de la parada ni un presupuesto que convertir.

### H-6 · MENOR — una exención puede bendecir un sitio real, y hasta uno que el runner rechaza

Simulado en memoria con el detector real, sin tocar el árbol: se vuelve a poner el defecto en el 91
(`{ms: 12_000}` o `12_000` a secas), se añade al contrato una exención con esa `desc` y **130
caracteres de relleno** como motivo, y el test sale **VERDE** en los dos casos. El esquema solo
exige `porque.min(120)`; nada comprueba que el motivo sea verdad, ni que el sujeto sea de verdad
otro proceso, ni hay caducidad por fecha (la que hay es solo «el sitio desapareció»). Es el
compromiso normal de una exención revisable —va commiteada y se ve en el diff— y lo anoto por dos
motivos: porque el `número suelto` también se puede eximir aunque el runner lo mate (es el mecanismo
de **H-1**), y porque «la exención caduca sola» es cierto en una dirección sola.

---

## 3 · El guion que dejo

`qa/guiones/133-la-parada-falsa-bajo-carga-de-verdad.mjs` — lo mecánico de esta validación, para que
no haya que volver a razonarlo:

- **A** · la carga sintética es real (razón sim/pared quieta vs frenada), y si no lo fuera el guion
  declara ⊘ en vez de salir verde.
- **B** · la traza de 40 sondeos bajo carga: cuántos vuelven sin mundo corrido y cuál es la racha
  máxima. Es la afirmación de `qa/README.md` («el dial no puede producir la parada falsa») vuelta
  candado.
- **C** · bajo carga: el patrón viejo no declara parada andando (C1), el molde tampoco (C2) y contra
  el muro **sí** (C3, para que el arreglo no sea «no declarar nunca»).
- **D0** · el CONTROL de B: en el estado desacoplado la misma cuenta ve racha ≥ 3. Sin él, B sería
  verde aunque la cuenta estuviera rota.
- **D1/D2** · lo que al 132 le falta: con el loop **pausado y la tecla mantenida**, el patrón viejo
  declara una parada y al reanudar el loop el jugador **anda** — la parada era FALSA y se demuestra,
  en vez de ser solo una afirmación sin mirar. (En el estado C del 132 el jugador no tiene ninguna
  tecla pulsada, así que allí «parado» también sería cierto con el mundo corriendo: lo que el 132
  reproduce es la afirmación sin evidencia, no la afirmación falsa.)

El loop se pausa **guardando** las callbacks de `requestAnimationFrame` en vez de tirarlas, que es lo
que permite reanudarlo con la misma tecla pulsada. Cero créditos (`sinMotor`, fixture del selector).

**Probado en negativo** (además de los sabotajes del molde de §1): sus propios controles lo cazan —
la primera versión salió **roja** en C2 por un rumbo reutilizado (el jugador se había comido los 25 m
libres y estaba parado contra algo de verdad) y en D1 por un frame que aún venía en vuelo. Los dos
rojos eran míos y los dos se arreglaron midiendo, no bajando el listón.

**Y lo cazaron dos candados de la casa, que es dato sobre ellos y no solo sobre mí:**

1. El candado nuevo de esta PR (`test/esperas-que-conducen.test.ts`) lo puso **rojo** en cuanto
   escribí `ctx.holdUntil(…, { ms: 8_000 })`. Mordió código nuevo el mismo día: eso vale, y es la
   mitad buena de **H-2**.
2. `qa-guiones-sin-espera-por-reloj` (de `arch-rules.json`) lo puso rojo por mis tres
   `new Promise(r => setTimeout(…))` de muestreo. La salida no fue una exención: el muestreo pasó a
   hacerlo **el bucle de `waitFor`** (un predicado que apunta reloj y posición en cada sondeo y no
   se cumple hasta tener 40), que además es más honesto — mide con la cadencia real de la batería,
   que es justo lo que el guion dice medir. `npm run verify` vuelve a salir **2843/2843**.

---

## 4 · Medidas propias

Todas en este árbol, con su orden y su salida. La cruda queda en `qa/capturas/qa545b/`
(gitignorada, como la del ingeniero).

| # | Orden | Salida |
|---|---|---|
| 1 | `cd nefan-core && npm run verify` | **exit 0** · `tests 2843 · pass 2843 · fail 0`, sobre su árbol tal cual **y** con mi guion 133 dentro. (Entre medias salió **rojo** dos veces, las dos por mi guion: ver §3 — es dato sobre los candados) |
| 2 | `node qa/run.mjs 01 02 05 06 10 109 11 118 13 130 14 15 16 17 25 30 31 42 45 73 75 80 86 90 91 129 132 133` (el filtro casa por subcadena: entraron **47**) | **46 en verde · 1 en ROJO de 47**, 667 líneas de aserto. El único rojo es el **80**, y es el ERROR del harness de **H-1**. Todos los guiones convertidos, verdes · `bateria-qa545b.log` |
| 3 | `node qa/run.mjs 132` | **1 en verde**; A con 6 muestras de mundo y 4 sondeos saltados; C con 0,04 s de sim y 1 frame tras quitar el rAF |
| 4 | 132 con la puerta del sim desactivada (`if (false && …)`) | **0 en verde · 1 en ROJO** · C2 `{"muestras":3,"saltadas":0,"quietas":3}` y C2-bis ✘ |
| 5 | 132 con el molde que **no declara nunca** | **ROJO en A** (`timeout … el mundo avanzó los 12 s de simulación pedidos`) |
| 6 | 132 con el molde que **declara siempre** | **ROJO en B**; A, C1, C2 y C2-bis siguen ✔ (o sea: C2 sola no comprueba el molde) |
| 7 | `node qa/run.mjs 133` (mío, ×40) | **1 en verde** · razón quieta 1,038 → frenada **0,626** · 40 sondeos en 10,0 s de pared y 7,54 s de mundo, **0 sin mundo corrido, racha 0** · D0 ve racha ≥ 3 con el loop pausado |
| 8 | `QA133_FACTOR=100 node qa/run.mjs 133` | **1 en verde** · razón **0,250** (tan frenada como las suyas) · 40 sondeos en 22,9 s de pared y 7,80 s de mundo, **0 sin mundo corrido**. Repetido dos veces (0,245 y 0,250): mismo 0 |
| 9 | `node qa/bajo-carga.mjs 91 --factor 40 --repeticiones 2` | **✔ quieto · ✔✔ ×40** · razones **0,272 / 0,258**, frames más largos 12.575 / 12.845 ms · «la carga fue REAL y está medida» |
| 10 | `node qa/esperas-candados-en-negativo.mjs` | 19 casos · **14 sujetan · 0 no sujetan** · 5 agujeros declarados, 0 cambiados |
| 11 | Seis mutantes a mano de `qa/lib/parada.mjs` contra `test/parada-de-qa.test.ts` | `dentroDe` 1 rojo · `arranque` 1 · `muestras−1` 3 · `referencia` invertida 1 · `eje` colapsado 1 · puerta del sim 4. **6 de 6 muertos** |
| 12 | Extractor propio de asertos (AST) sobre los 130 guiones de `main` vs HEAD | **1.541 sitios**, `diff` **vacío** excluyendo 132 y 133 |
| 13 | Detector del candado (`esperasDeParedQueConducen`) sobre `main` y sobre HEAD | `main`: **31 sitios en 22 ficheros**. HEAD: **3**, los tres exentos. Y sobre 91/86/109 **de `main`**: **0** (H-2) |
| 14 | Censo propio de esperas de pared dentro de una función que mantiene tecla, en TODO `qa/**` | **17 sitios en 8 ficheros** en `main` → **14 en 5** en HEAD; los que quedan, invisibles al candado (H-2) |
| 15 | `node qa/bateria-candados-en-negativo.mjs` (la toca el diff vía `invariantes-en-negativo.mjs`) | **10 candados probados · 10 nacen rojos/⊘ y NOMBRAN la causa · 0 que no se enteran · 0 patrón obsoleto** |
| 16 | `node qa/bajo-carga.mjs 93 --factor 40 --repeticiones 1` (lo que el plan pedía y no se midió) | **quieto ✔ · ×40 ✘ (1/1)**: razón 0,263, frame más largo 12.716 ms; caen las **cuatro** medidas de velocidad (1,68 vs 4,18 m/s…). Ver **H-5** |
| 17 | `npm run deuda` | 75 items de 2 de 3 fuentes (no corrí `coverage`). Da igual para juzgar: **el diff no toca un solo fichero de `nefan-core/src` ni de `nefan-html/src`** |

---

## 5 · Workarounds usados

| Qué | Por qué no afecta al jugador |
|---|---|
| Sabotajes temporales de `qa/lib/parada.mjs` (6 mutantes) y re-ejecución de su batería y del 132 | Es la prueba en negativo. Restaurado desde una copia y `git status` limpio tras cada uno (queda solo mi guion 133, sin seguimiento) |
| Simulación EN MEMORIA de exenciones y del defecto del 91 (`esperasDeParedQueConducen` importado del test) | No toca el árbol: el texto se modifica en memoria. Es la única forma de medir «¿basta una exención?» sin escribir en el contrato |
| Extracción de `main` a `/tmp/...:/main-qa` con `git archive` | Lectura del árbol base sin tocar el worktree del ingeniero |
| `QA133_FACTOR=100` para la segunda medida del dial | Variable del propio guion, documentada en él; el defecto (40) es el del reproductor |

Ninguno de los cuatro es un obstáculo que el jugador vaya a encontrarse: no hay `display:none`,
ni estado sintético, ni pantalla saltada. **Lo que sí es un obstáculo real —y por eso es hallazgo y
no receta— es H-1**: para ver correr el guion 80 hoy hay que editarlo o editar el runner.

---

## 6 · No probado

- **Que la frontera aguante estadísticamente.** Mi identidad de asertos es **estática** (fuerte para
  «qué afirma el guion», ciega a cuántas veces se ejecuta un bucle: el ±1 del 118 es eso). Sostener
  «631 = 639 − 8» con autoridad pediría N corridas por árbol; ni él ni yo las hemos hecho.
- **La frecuencia del rojo del 91 bajo carga**: 2 corridas frenadas, no 6. El propio reproductor lo
  dice en su salida.
- **Los 55 supervivientes y el CRAP**: el diff no toca producción, así que no hay nada que medir
  (coincido con §7.6: sin trailer de mutación).
- **#496/#497**: no se tocan, y **hoy no se pueden medir** por H-1.

---

## 7 · El color de 80 y 75, en mi medida

| corrida | 75 | 80 | qué cae |
|---|---|---|---|
| mi árbol (HEAD, `c5d47a65`) | ✔ | **✘** | **ERROR del harness** en `holdUntil(…)`: el guion aborta en su bloque 2 |
| su log ANTES (base) | ✔ | ✘ | `…ni deja una entrada de error — 7 → 9` (30 líneas de aserto) |
| su log DESPUÉS (su árbol) | ✔ | ✘ | **el mismo ERROR que mido yo** (19 líneas de aserto, «entrada de error» ×0) |

El color no cambió. **El motivo sí**, y por eso es hallazgo y no éxito — que es literalmente lo que
el encargo mandaba mirar.

---

# Segunda vuelta · commit `04dc2fcc` (rama rebasada sobre `main` = `e55c5067`)

Verificación **focalizada** de los seis hallazgos, no una QA entera. Mismo árbol
(`/home/al/code/ne-fan-qa545b`), `git checkout 04dc2fcc` + `npm run build` en `nefan-core`
(**exit 0**) antes de creerme ningún color. Nada de §0-§7 se retoca: lo de arriba es el dictamen de
la primera vuelta y se queda como está.

**Mis dos ficheros llegaron sin tocar una línea**, comprobado por hash antes y después del checkout:
`qa-6.md` → `67809afc…`, `133-…mjs` → `dfd9d164…`, y `diff` vacío contra mis copias.

## V-0 · Veredicto de la vuelta: **NO APTO** (uno bloqueante, uno importante; los seis, resueltos)

Los seis hallazgos están atendidos y cinco de los seis, bien. **El arreglo de H-1 introdujo un
defecto nuevo** que ninguna prueba sujeta, y es de los que esta casa nombra por su nombre: **baja un
umbral sin decirlo**, justo el que PR-4a había hecho proporcional con un motivo medido.

| | Qué | Prioridad |
|---|---|---|
| **V-1** | el arreglo de H-1 cambia el cortafuegos de pared de TODA espera conducida con `{sim:N}` sin `ms` escrito: de `N × 10.000 ms` a **30.000 ms planos**. Para los cuatro sitios que esta misma PR convirtió (`{sim: 120}` en 58, 86, 109 y 112) es **×0,025** | **bloqueante** |
| **V-2** | el candado nuevo (N11) sujeta la mitad `{ms}` y **no la mitad `{sim}`**: dos mutaciones que devuelven toda espera conducida al reloj de pared dejan `npm run verify` en **2847/2847 verde** | importante |

## V-1 · BLOQUEANTE · el arreglo de H-1 baja un umbral, y es el que PR-4a subió a propósito

`expectEspera` desestructura `const { ms = 30_000, … } = opciones` y ahora le pasa **ese `ms` ya
defectado** a `presupuestoConducido`. Antes le pasaba `opciones.ms`, que es `undefined` cuando el
guion no lo escribe — y ese `undefined` es justo lo que hacía que `presupuestoDeEspera` aplicara la
regla ×10 de PR-4a. Medido con la función, no leído:

```
{sim:  4} · cortafuegos ANTES     40000 ms · AHORA  30000 ms  → ×0.750
{sim:  6} · cortafuegos ANTES     60000 ms · AHORA  30000 ms  → ×0.500
{sim: 12} · cortafuegos ANTES    120000 ms · AHORA  30000 ms  → ×0.250
{sim: 60} · cortafuegos ANTES    600000 ms · AHORA  30000 ms  → ×0.050
{sim:120} · cortafuegos ANTES   1200000 ms · AHORA  30000 ms  → ×0.025
```

Por qué importa, en orden de gravedad:

1. **Es un umbral bajado sin declararlo**, y la regla de la casa en este encargo es literal:
   «Ningún umbral se baja, ni se sube uno para acomodar lo que acaba de crecer».
2. **Deshace una decisión medida de PR-4a.** Su H-4 (qa-5) pedía «×10 de verdad o el techo con
   motivo medido», y se verificó: `techoMs = sim × 10.000` para 4, 45, 60, 90 y 600 — «el techo de
   300 s ya no aplasta a los grandes». Esto vuelve a poner un techo plano, y **más bajo que el que
   se quitó**.
3. **Para N ≳ 29 el presupuesto de sim ya no se puede gastar ni en una máquina ociosa**: 60 s de
   mundo necesitan ~62 s de pared y el techo son 30. Esas esperas ya solo pueden terminar porque la
   condición ocurra, o en **⊘**. Y el ⊘ sería falso: el mundo sí corría, lo que faltó fue pared.
4. **Cae sobre los cuatro sitios que esta PR acaba de convertir** (58, 86, 109, 112: `{ms: 120_000}`
   → `{sim: 120}`). En `main` esperaban 120 s de pared; ahora, 30. Una propuesta de frontera que no
   llegue deja de dar el rojo que la nombra y pasa a dar un ⊘ a los 30 s.
5. **Ninguna prueba lo sujeta** (ver V-2) y **la batería no puede verlo**: esas esperas se cumplen en
   segundos, así que hoy todo sale verde. Lo comprobé: 58, 86, 109, 112, 43, 91, 132 y 133 → **8 en
   verde de 8**; y el 30 a ×100 (razón 0,120, frames de 22 s) consume sus 6 s de sim en 21 sondeos y
   **afirma su negativo** — pasa por 10 segundos de margen.

**Arreglo**: pasar `opciones.ms` (sin defectar) y dejar que el defecto de 30 s viva solo en la rama
de pared, que es donde estaba.

## V-2 · IMPORTANTE · el candado nuevo sujeta la mitad `{ms}` y no la mitad `{sim}`

N11 es real y hace lo que dice **para el defecto del 80**: lo rompí por los dos lados que él
declara y se puso rojo. Pero probé dos mutaciones más, y las dos pasan:

| # | Mutación de `presupuestoConducido` | `test/sonda-de-qa.test.ts` | Qué significaría en la batería |
|---|---|---|---|
| **B1** | `return sim === null ? ms : {sim, ms}` (el defecto de H-1, tal cual) | **fail 1** ✔ | el 80 vuelve a morir |
| **B3** | `return { sim: ms }` | **fail 1** ✔ | disparate visible |
| **B2** | `return { ms }` — **se pierde `sim`** | **pass 32 · fail 0** ✘ | TODA espera conducida vuelve a medir en PARED |
| **B4** | `return sim === null ? {ms} : {sim: ms, ms}` — el valor de sim es el de ms | **pass 32 · fail 0** ✘ | el presupuesto de mundo lo fija el reloj de máquina |

Y con **B2 puesta sobre todo el árbol**, la casa entera sigue verde:

```
$ cd nefan-core && npm run verify        → exit 0 · tests 2847 · pass 2847 · fail 0
$ node qa/run.mjs 02 30                  → 4 en verde · 0 en rojo de 4   (02, 30, 102, 130)
```

O sea: **se puede borrar el reloj de simulación de todas las esperas conducidas de la batería y no
se entera ni CI ni la batería.** El test que nació de H-1 comprueba «es un objeto» y «la sonda no
lanza», que es la mitad que costó el 80; lo que no comprueba es **que el presupuesto que sale lleve
el sim que entró**. Dos asertos lo cierran:
`deepEqual(presupuestoConducido({sim:4}), {sim:4, ms:<lo que toque>})` y
`equal(presupuestoDeEspera(presupuestoConducido({sim:4}),"x").sim, 4)` — el segundo, además, habría
cazado V-1.

## V-3 · Los seis hallazgos, uno a uno

| # | Qué pedía | Veredicto | Lo que medí YO |
|---|---|---|---|
| **H-1** | que el 80 vuelva a correr, con el texto y los números de `main` | ✅ **resuelto** | **Cinco parejas seguidas** `node qa/run.mjs 80 75`: las cinco con **30 líneas de aserto** (eran 19), el 75 ✔ en las cinco, y el 80 **✘ en 2 de 5** con el aserto `…ni deja una entrada de error — **7 → 9**` — el mismo TEXTO y los mismos números que en `main`. La intermitencia de #496/#497 restaurada, ni tapada ni inventada. Y la línea que moría ahora sale ✔: `ocurre: el jugador anda 0.4 m…`. **Pero ver V-1** |
| **H-1b** | que la regla salga de `run.mjs` y se pueda ejercer sin navegador | ✅ **resuelto**, ⚠️ a medias | `presupuestoConducido` vive en `qa/lib/sonda.mjs` y N11 lo ejerce. Roto por su lado (B1) → **1 rojo en `npm run verify`**, sin navegador. Roto por el otro (B2/B4) → verde: **V-2** |
| **H-2** | que el candado vea el defecto en la forma en la que #545 se encontró | ✅ **resuelto** | Su detector, contra los MISMOS ficheros de `main` donde yo medí 0, 0, 0: **91:150 (1) · 86 (2) · 109 (2) · 118 (2)**. Y el reverso funciona: una espera **después** de soltar la tecla no se marca, y con `{sim}` tampoco (lo probé con material propio). Además mira **todo `qa/**.mjs`** — `fixtures-las-tres-se-caminan.mjs` ya está dentro |
| **H-2b** | que la frontera declarada sea la real | ❌ **NO cumple** | Declara como única frontera «conducir desde dentro de `page.evaluate`». Hay otra, **más probable y viva en el árbol ahora mismo**: la tecla la pulsa el LLAMANTE y la espera vive en un **helper**. Probado con material propio (`press` en el guion + `waitFor` de pared en otra función) → **0 sitios**. Y no es teórico: mi propio `veredictoDe` del guion 133 espera en pared con la tecla puesta y el candado no lo ve (ve 2 sitios en el 133, los dos exentos, y ése no). Tercera vez en esta PR que el agujero declarado es más estrecho que el real |
| **H-3** | que la frase de `saltadas` diga lo que mide | ✅ **resuelto** | Reescrita en los dos sitios donde vive (`qa/lib/parada.mjs` y el log del 91) con mis números dentro (26 y 8 en reposo, 0 y 0 a ×40) y con lo que sí mide: la cadencia frente al paso |
| **H-4** | suelo para `{ms:N}` | ✅ **resuelto** | `presupuestoDeEspera({ms: 0 \| 1 \| 4 \| 149})` **lanza** («no llega ni a la cadencia de sondeo»). El número suelto sigue sin suelo **y me parece bien**: `4` no es lo que sale de teclear `{sim: 4}`, `expectEspera` no lo acepta como presupuesto (se desestructura a `ms = 30_000`), y hay un caso que mira una vez a propósito. **No es una puerta equivalente**: la que se cerró era la confundible |
| **H-5** | medir el rojo del 93 y anotarlo como lo que es | ✅ **resuelto** | §12.5 trae su corrida (×40, 1/1, las cuatro velocidades a 0,38-0,63 de lo esperado — las mías dieron 0,40-0,56) y la frase honesta: «lo hay, es el 93, y NO es el patrón de la parada». Corrige además su §7.5 sobre el denominador de pared, y manda a issue el clasificador de `bajo-carga.mjs` |
| **H-6** | que una exención no pueda ser relleno | ✅ **resuelto en lo que se podía** | Mi relleno de 130 caracteres **ya no arranca el test**: ZodError «el motivo tiene que NOMBRAR el proceso al que se espera». Pero probé la vía que queda y **funciona**: reintroduje el defecto en el 58 (el candado lo cazó: `58:186 expectEspera(…, {ms})`) y lo silencié con una exención de **sujeto falso** («el BRIDGE decidiendo cuándo hay propuesta» — la decide el cliente en su `tick`, y su propio contrato lo dice para el 42) y un `porque` de 40 equis con la palabra «bridge» dentro → **6 pass · 0 fail**. El listón sube de «relleno» a «relleno con una palabra clave»; lo demás lo hace la revisión del diff, que es lo que él declara |
| **H-6b** | que sus exenciones nuevas estén justificadas por su sujeto | ✅ cumple | `43:205`: la tecla mantenida es **`e`** (interactuar), no una de movimiento, y el sujeto es el motor contestando — verificado en el fuente (`43:203`). Las dos del guion 133 son mías y son correctas: con el loop pausado un presupuesto de sim no se gastaría nunca |

## V-4 · La regla dura, otra vez, con los cinco sitios nuevos

Es la primera vez que la PR toca guiones que no estaban en ninguna lista (58, 86, 109, 112 y
`fixtures-las-tres-se-caminan.mjs`), así que repetí la identidad estática contra el `main` nuevo
(`e55c5067`): **1.541 sitios de aserto en los 130 guiones, `diff` VACÍO** excluyendo el 132 y el 133.
Las cinco conversiones son literales (`{ms: 120_000}` → `{sim: 120}`, `8000` → `{sim: 8}`), sin tocar
un texto, un canal ni un umbral **del guion**. El umbral que sí se movió no está en los guiones, está
en el runner, y es **V-1**.

## V-5 · Medidas de la vuelta

| # | Orden | Salida |
|---|---|---|
| 1 | `npm run build` (nefan-core) | **exit 0** |
| 2 | `npm run verify` | **exit 0 · 2847 · pass 2847 · fail 0** |
| 3 | `node qa/run.mjs 80 75` ×5 parejas | 75 ✔✔✔✔✔ · 80 **✘✔✘✔✔** (2 de 5) · **30 líneas de aserto en las cinco** · el rojo, `…ni deja una entrada de error — 7 → 9` |
| 4 | `node qa/run.mjs 58 86 109 112 132 133 91 43` | **8 en verde · 0 en rojo de 8** |
| 5 | `node qa/fixtures-las-tres-se-caminan.mjs` | ✔ las tres pintan, se caminan y colisionan |
| 6 | Detector del candado contra `main`: 91, 86, 109, 118 | **1 · 2 · 2 · 2** sitios (antes 0 · 0 · 0 · 2) |
| 7 | Reverso del detector (material propio) | espera tras soltar la tecla → **0**; con `{sim}` → **0**; cross-función → **0** (**H-2b**) |
| 8 | Cuatro mutaciones de `presupuestoConducido` | B1 y B3 **rojas**; **B2 y B4 verdes** (V-2) |
| 9 | `npm run verify` + `node qa/run.mjs 02 30` con B2 puesta | **2847/2847 verde** y **4 guiones verdes** — nadie se entera |
| 10 | Exención con sujeto falso sobre un sitio real reintroducido | **6 pass · 0 fail** (H-6, residual medido) |
| 11 | Exención de puro relleno (mi caso de la 1.ª vuelta) | **el test no arranca** (ZodError) ✔ |
| 12 | `presupuestoConducido({sim:N})` → techo de pared | **30.000 ms planos** para todo N (V-1) |
| 13 | `node qa/bajo-carga.mjs 30 --factor 100` | ✔ verde con razón **0,120** y frames de 22 s: los 6 s de sim se consumen en 21 sondeos, a 10 s del techo nuevo |

## V-6 · No probado en esta vuelta

- **Que V-1 rompa un guion hoy**: no lo reproduje, y lo digo — todas las esperas afectadas se
  cumplen en segundos. Lo que está medido es el cambio de techo (×0,025 en los sitios de 120 s) y
  que nada lo sujeta. El día que una propuesta tarde, el rojo será un ⊘ falso.
- **La batería entera**: esta vuelta es focalizada. Corrí 8 guiones + 5 parejas + el script de
  fixtures, no los 47 de la primera vuelta.
- **#496/#497**: siguen fuera, y ahora el 80 vuelve a poder medirlos (que era el punto).
