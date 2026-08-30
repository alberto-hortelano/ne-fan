# QA — La batería no miente (#308 #320)

Rama `feature/la-bateria-no-miente` (`b3bfc46`), tres commits sobre `main`. Todo lo que sigue está
medido HOY por mí, sobre esta rama, con el preset `e2e-sin-creditos` que levanta `qa/run.mjs`
(bloque de puertos elegido por el runner, lock atómico). **Cero créditos**: el guardarraíl declara
`fake:true` en cliente y bridge en cada corrida, y el panel marcó `gasto sesión 0,00 € · total
0,00 €` en todas las capturas. **Ningún proceso ajeno tocado**: el único stack que dejé arriba
(`--keep`) lo bajé con `./start.sh --parar`, que enumeró lo ajeno y no lo tocó.

**El sujeto de esta tanda es el instrumento con el que valido.** Así que no me he creído ninguna
corrida verde: he roto a mano cada arreglo y he exigido que el rojo aparezca Y nombre la causa, y
he reproducido el defecto ORIGINAL —la segunda fixture medida como la primera— para comprobar que
la demostración de la tanda mide ese camino y no otro.

---

## 1 · Los ocho criterios de la §7 del requisitos

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **Se sabe QUIÉN devuelve el pitch a 0**, con nombre y medida, y el arreglo ataca eso | ✅ cumple | `grep -rn "playerPitch\s*=\s*0"` en todo el árbol → **un solo escritor**: `nefan-html/src/main.ts:826` (dentro de `resetWorld()`); `:1392` es la declaración. Falsado por mí: reteniendo el JSON de la segunda fixture, el bloque 3 midió el puerto con `pitch 0.00°`; al soltarlo, `robledo_tile` |
| 2 | **Si el culpable es de producción, se arregla en producción**, no en el guion | ✅ cumple | El diff toca `nefan-html/src/main.ts` (+55/−6). El bloque 4 del guion 22 (`:316-347`) **no llama a `mirarA`**: `sed -n '316,348p' … \| grep mirarA` sale vacío. El «arreglo» que #250 avisa (tapar llamando a `mirarA`) no está |
| 3 | **Una precondición que no se cumple sale como rojo que dice lo que pasó**, no como otro aserto | ✅ cumple | Rota la promesa a mano, el 22 muere con `✘ ERROR: se pidió la fixture «puerto_tile» y el mundo se quedó en «null»: la carga no había llegado cuando loadFixture dijo que sí (#308)`. Y en el camino del bug (solo la 2ª carga sin esperar): `se pidió la fixture «robledo_tile» y el mundo se quedó en «puerto_tile»`. **Antes** ese mismo defecto caía tres asertos más abajo, en el telegraph (`✘ el borde de "quick" también está en cuadro — {"x":640,"y":713}`), sin decir que la fixture no había llegado |
| 4 | **La demostración es DETERMINISTA** (compuerta `page.route`), no «repetir la batería» | ✅ cumple · ver **H2** | Medido por mí en las dos direcciones. Con el defecto delante y la compuerta puesta: **3 rojas de 3**. Con el MISMO defecto y el guion 22 de `main` (sin compuerta): **3 verdes y 1 roja de 4**, y la roja con los números exactos del issue (`suelo de robledo: 57 calcos`, `pitch 0.00°`, `y=713`). La moneda al aire se ve, y la compuerta la quita |
| 5 | **Tres teclas muertas del 34 ⇒ rojo** | ✅ cumple | Verificado el caso DIFÍCIL, una sola: `qa/bateria-candados-en-negativo.mjs` borra `case "a"` del provider → `✘ CONTROL … movimiento=false (w 0.650 m · a 0.000 m · s 0.643 m · d 0.632 m — NO RESPONDEN: «a»)`. Con tres muertas el mismo aserto nombra las tres: cada tecla tiene su fila y ninguna puede cancelarse consigo misma |
| 6 | **Toda corrida del 22 publica el tell de QUÉ escena midió** | ✅ cumple | Corrida real: `midiendo «puerto_tile»: 57 calcos` … `midiendo «robledo_tile» (tile tile_0_0): 14 calcos · … · pitch 0.00° · pos -1.75,10.25`, más el aserto `✔ lo que se mide en campo abierto ES «robledo_tile» y no la fixture anterior`, que compara escena **y** calcos (el único número que discrimina: `topY` vale 0,105 m en las dos) |
| 7 | **El control del 34 se pone rojo si muere UNA sola tecla** | ✅ cumple | Las dos mitades medidas por mí. **Antes** (guion 34 de `main`, tecla `a` borrada del provider): `✔ CONTROL … 1 en verde · 0 en rojo` — verde con una tecla muerta. **Ahora** (guion de la rama, tecla `w` borrada): `✘ CONTROL … (w 0.000 m · a 0.640 m · s 0.619 m · d 0.635 m — NO RESPONDEN: «w», mínimo exigido 0.1 m)`. El rojo nombra la tecla, y no está cableado a `a` |
| 8 | **#308 y #320 se cierran**, o el que no lo haga lo dice con su medida | ⚠️ NO probado / pendiente · ver **H1** | `gh issue view 308 → OPEN`, `gh issue view 320 → OPEN`, `gh pr list --head feature/la-bateria-no-miente → []`. Los cierra la PR, que no existe todavía. **Pero SEIS documentos ya commiteados (ocho sitios) afirman que están CERRADOS** |

## 2 · Lo que se me pidió atacar, punto por punto

| Encargo | Resultado |
|---|---|
| **1 · Que ninguna corrida del 22 pueda salir verde midiendo la fixture equivocada** | ✅ **Confirmado, y medido en los dos sentidos.** Con la promesa devuelta, la escena que mide el bloque 3 se AFIRMA (no se espera) y se compara además por `calcos`. Con el defecto reintroducido no hay corrida verde posible: 3 de 3 rojas, y el rojo dice `se pidió «robledo_tile» y el mundo se quedó en «puerto_tile»` en vez de fallar por el telegraph. La contra-medida —el guion de `main` con ese mismo defecto— sale **3 verdes de 4**: la enfermedad existía y ya no |
| **2 · ¿Es determinista la demostración, o se pasa por suerte?** | ✅ **Es causal, no de reloj.** Con la respuesta HTTP retenida el módulo no puede haber llegado: el aserto solo puede pasar si la promesa funciona. Lo corrí yo (`node qa/bateria-candados-en-negativo.mjs`: 2 candados, 2 rojos que nombran la causa, 40 s) y además rompí a mano los dos arreglos por caminos que el script no cubre. **Reserva medida**: el negativo re-ejecutable no recorre el camino del bug — **H2** |
| **3 · La desviación §4.1: el rojo cae en el bloque 1, no en el 3** | ✅ **Cierta, y el criterio 4 queda satisfecho igualmente — pero la desviación es MAYOR de lo que dice.** No es solo que el rojo sea «más temprano»: es que el negativo re-ejecutable **nunca ejerce el camino de #308**. Lo medí fabricándolo (solo la 2ª carga sin esperar): el bloque 3 sale rojo 3 de 3 nombrando las dos escenas, así que el mecanismo funciona. Lo que faltaba era que ESO se volviera a demostrar solo. Lo he dejado hecho: `qa/guiones/44-…` |
| **4 · Los 21 llamantes de `loadFixture`, y el guion 24** | ✅ **Ninguno se rompe en silencio, y los tres de fuera de la batería MEDIDOS.** Dentro de la batería hay **16 sitios de llamada** en 13 guiones más los **tres** que van por `qa/lib/fixtures.mjs` (22, 23 y el 44 nuevo); todos por `await ctx.nefan(...)`, que es `page.evaluate` y por tanto **espera** la promesa devuelta (y propaga su rechazo como rojo). Batería completa **43/43 en verde**, dos veces (42/42 antes de añadir el mío). Los tres de fuera: `fixtures-sin-bridge.mjs` (lo corrió el ingeniero), y los dos que él declaró **no medidos** los he corrido yo — `captura-de-fixture.mjs` ✅ y `presupuesto-de-volumenes.mjs` ✅ (ver **H5** para su gotcha, que es anterior a la tanda). **Guion 24**: su verde es por el motivo correcto — con `loadFixture` tragándose el rechazo (`return carga.catch(() => {})`), el ÚNICO aserto que cae es el nuevo (`✘ pedir una fixture cuyo JSON no llega RECHAZA en quien la pidió — loadFixture resolvió como si la fixture hubiera cargado`) y los cinco de pantalla siguen verdes: el rechazo y la pantalla son dos hechos separados |
| **5 · Verdes que no comprueban nada: revertir el sujeto de cada aserto nuevo** | ✅ **Los seis asertos nuevos nacen rojos.** Los detalles en §3. Incluye los dos «no concluyente antes que verde» del 22, que también los probé: con el patrón de la compuerta cambiado sale `✘ … (si no, no hay negativo que valga) — {"interceptadas":0}` |
| **6 · La regla del workaround** | ✅ Ningún workaround necesario para OBSERVAR nada. Los ocho apaños que usé son roturas deliberadas para medir el rojo, y todos restaurados byte a byte (§7) |

## 3 · Cada aserto nuevo, puesto rojo revirtiendo su sujeto

| Aserto (guion) | Cómo lo puse rojo | Salida real |
|---|---|---|
| `la compuerta retuvo de verdad el JSON` (22) | Patrón de `retenerFixture` cambiado para que no case | `✘ … — {"interceptadas":0,"porCortafuegos":false,"fallos":[]}` |
| …y con el cortafuegos: nadie suelta la compuerta | Quitada la llamada a `soltar()` antes del `await` | La batería **NO se cuelga**: a los 60 s el cortafuegos suelta, `✘ … {"interceptadas":1,"porCortafuegos":true}`, corrida de 68 s. El riesgo §8 del plan está mitigado de verdad |
| `lo que se mide en campo abierto ES «robledo_tile»` (22) | Solo la 2ª carga fire-and-forget | `✘ ERROR: se pidió la fixture «robledo_tile» y el mundo se quedó en «puerto_tile»` · 3 de 3 |
| `pedir una fixture cuyo JSON no llega RECHAZA` (24) | `return carga.catch(() => {})` | `✘ … — loadFixture resolvió como si la fixture hubiera cargado`; los 5 asertos de pantalla siguen verdes |
| `CONTROL … LAS CUATRO de movimiento` (34) | `case "w"` borrado del provider | `✘ … NO RESPONDEN: «w», mínimo exigido 0.1 m` |
| `ninguna entrada mueve al jugador ni un milímetro, medida una a una` (34) | Puerta abierta (`if (false && elTituloManda())`) | `✘ … «w» 0.653 m · «a» 0.618 m · «s» 0.631 m · «d» 0.633 m`. **Y aquí se ve por qué el libro por tecla no es cosmético**: el aserto viejo, el de extremos, solo vio la posición moverse **0,028 m** en toda la secuencia (−10,25;−0,75 → −10,23;−0,77) — las cuatro teclas se cancelaron entre sí también en el bloque 1, y lo que lo salvó fueron los OTROS campos (ataque, debugView, libro) |
| `el panel de dev ofrece «puerto_tile»` (34) | — | Verde con la fixture nombrada; se ve en la captura `mundo-detras-del-titulo` (el desplegable dice `puerto_tile`) |

## 4 · Herramientas y estado del repo

| Comprobación | Resultado |
|---|---|
| `node qa/run.mjs` (batería completa, con mi guion nuevo) | **43 en verde · 0 en rojo de 43** · `rc=0` |
| `node qa/run.mjs` (batería completa, antes de añadir el mío) | **42 en verde · 0 en rojo de 42** · `rc=0` |
| `node qa/bateria-candados-en-negativo.mjs` | 2 candados · 2 nacen rojos y nombran la causa · 0 fallidos · `rc=0` (40 s) |
| `nefan-core`: `npm run verify` | **verde**: `build` + `typecheck:scripts` + `typecheck:labs` + `lint` + `tests 1645 · pass 1645 · fail 0` · `rc=0` |
| `nefan-core`: `npx tsx --test test/architecture.test.ts` | **47/47** con el guion nuevo dentro de `qa/guiones/` |
| `nefan-core`: `npm run deuda` | **66 items** (Fronteras 15 · CRAP 12 · Mutación 39) = la línea base del plan. No sube |
| `nefan-core`: `npm run afectado` | `Mutación afectada · 17 fichero(s) cambiado(s) · main...HEAD` → **NO EJECUTA NADA — ningún módulo carga nada de lo que ha cambiado**. El diff no toca `nefan-core` |
| `nefan-html`: `npx tsc --noEmit` · `npx eslint src` | `rc=0` los dos |
| `git status --porcelain` tras cada rotura | vacío en las 8 restauraciones |

## 5 · Hallazgos

### H1 · **importante** — Seis documentos commiteados dicen que #308 y #320 están CERRADOS, y siguen ABIERTOS

**Qué pasa.** Las apostillas de `b3bfc46` afirman, literalmente: *«Apostilla 2026-08-30: #308 y #320
CERRADOS — …»*. Están en `docs/agents/2026-08-30-los-espejos-de-la-sesion/{requisitos,critica}.md`,
`2026-08-29-el-contrato-y-sus-espejos/{requisitos,critica}.md`,
`2026-08-29-el-banco-no-puede-mentir/critica.md` (×2) y
`2026-08-29-que-el-jugador-pueda-pelear/requisitos.md` — **ocho sitios en seis ficheros que sí se
commitean**, más uno en un `implementacion.md` que no. De paso: el informe dice *«Ocho sitios en cinco
documentos»* y enumera cinco; el sexto (`que-el-jugador-pueda-pelear/requisitos.md:224`) no está en
esa lista. Es una cuenta pequeña, pero la escribió la misma tanda que va de no afirmar lo que no se
midió. Hoy:

```
$ gh issue view 308 --json state → {"state":"OPEN"}
$ gh issue view 320 --json state → {"state":"OPEN"}
$ gh pr list --head feature/la-bateria-no-miente → []
```

**Por qué importa.** El plan (§1a) eligió apostillar en vez de borrar precisamente para no hacer el
registro falso «en la otra dirección», y la apostilla que escribió lo hace falso justo así: afirma
un estado que todavía no existe. Y el mecanismo que lo volvería verdad **no está puesto**: los tres
commits nombran `(#308 #320)` a secas, y en este repo lo que cierra un issue es un `Closes #NNN` en
el cuerpo de la PR (convención de la PR #327, que abre con `Closes #323` / `Closes #322`).

**Qué esperaba.** O la apostilla dice *«cerrados por la PR de «La batería no miente»»*, o la PR lleva
`Closes #308` y `Closes #320`. Si la PR se abre sin esas dos líneas, el árbol queda con nueve
afirmaciones falsas sobre GitHub y dos issues abiertos que nadie va a volver a mirar — que es el
mismo modo de fallo que esta tanda vino a cerrar, un piso más arriba.

**Reproducción**: `gh issue view 308 --json state` y `grep -rn "Apostilla 2026-08-30" docs/agents/`.

### H2 · **menor** — El negativo re-ejecutable de #308 no recorre el camino del bug (la desviación §4.1, medida)

**Qué pasa.** `qa/bateria-candados-en-negativo.mjs` rompe `loadFixture` para **todas** las cargas, así
que el guion 22 muere en su **bloque 1** —la PRIMERA fixture, `se quedó en «null»`— y la compuerta del
bloque 3, que es lo que esta tanda construyó, **nunca llega a ejercerse**. El ingeniero lo declara
(§4.1) y no lo vende por más de lo que es; lo que añado es la medida de cuánto se pierde:

| Escenario (mismo defecto: la 2ª carga no se espera) | Guion 22 de `main` | Guion 22 de la rama |
|---|---|---|
| 4 corridas | **3 verdes · 1 roja** (`57 calcos`, `pitch 0.00°`, `y=713`) | — |
| 3 corridas | — | **0 verdes · 3 rojas**, y el rojo nombra las dos escenas |

O sea: el mecanismo del bloque 3 **funciona y es determinista**, pero hoy solo lo demuestra quien lo
fabrique a mano. Corolario incómodo: si mañana alguien deja el guion 22 con una sola fixture, el
script de negativos **seguiría en verde** (el rojo le llegaría por el bloque 1) mientras la especie
de #308 se queda sin candado.

**Qué he dejado hecho**: `qa/guiones/44-la-carga-de-una-fixture-no-dice-hecho-antes-de-tiempo.mjs`
(§6), que afirma el INSTANTE y no el estado final, y cuya precondición NO usa el helper afirmativo
justo para que su rojo caiga siempre en su propio sujeto.

**Sugerencia para el ingeniero** (una línea): añadir a `INVARIANTES` un tercer par que rompa solo la
segunda carga, o apuntar el invariante #308 al guion 44 en vez de al 22.

### H3 · **menor** — La demostración re-ejecutable no está en el mapa de `qa/`

`qa/README.md` enumera con nombre y comando `guardarrail-sin-creditos.mjs`, `dos-corridas.mjs`,
`fixtures-sin-bridge.mjs`, `presets.mjs` y `sprites-sin-servicio.mjs`, y **no menciona ninguno de los
tres `*-candados-en-negativo.mjs`** (el nuevo tampoco). Es un patrón anterior a esta tanda —ya
faltaban los otros dos—, pero aquí muerde distinto: la tesis de la tanda es que una demostración en
prosa no vale porque nadie la vuelve a correr, y un ejecutable que no está en el mapa se lee igual de
poco. Dos líneas en el README lo cierran.

### H4 · **menor** — Guion 34: si la fixture nombrada desaparece del selector, el rojo llega con ruido

`34-…:255-260` afirma la precondición (`el panel de dev ofrece «puerto_tile»`) y **sigue**:
`await ctx.page.selectOption("#room-selector", opcion.valor)` revienta con un `TypeError` sobre
`null`. El criterio 3 se cumple —la causa está nombrada en la línea de arriba—, pero la corrida
acaba con dos rojos, uno de ellos ilegible. Un `if (!opcion) return;` tras el `expect` lo deja limpio.

### H5 · **menor, ANTERIOR a la tanda** — `qa/presupuesto-de-volumenes.mjs` falla la primera vez contra un cliente ya arrancado

Corriéndolo tal como documenta su cabecera (cliente en otra terminal, luego el script), la primera
corrida muere con `page.evaluate: Error: fixture "perf_120_0_0" no está en el selector; hay: -- Room --,
puerto_tile, robledo_tile, zorder_test`: vite no reevalúa el `import.meta.glob` de `main.ts` para
ficheros creados después de arrancar. **No es de esta tanda** y lo comprobé: con el `main.ts` de
`main` puesto en el mismo stack pasa exactamente igual la primera vez, y la segunda corrida va bien en
las DOS versiones (`120 (120) 573.5 fps (1.7 ms) 96.3 fps (10.4 ms) 77.4 fps (12.9 ms)` en la rama).
La guarda que lanza (`if (!option) throw`) es de `main`, sin tocar. Lo dejo escrito porque me costó
media medida creer que era un hallazgo, y al siguiente le costará lo mismo.

### Lo que MIRÉ y está bien (para que no se vuelva a mirar)

- **El jugador no ve nada de esto, y es correcto.** `loadFixture` vive bajo
  `import.meta.env.DEV`; lo único que el cambio añade al camino de producción es
  `ultimaCargaDeFixture = carga` dentro del manejador del `change`. `paso(carga, …)` engancha su
  `.catch` **sobre la misma promesa**, así que la promesa que ahora se guarda **no** puede quedar
  como `unhandledrejection` aunque nadie la espere (`nefan-html/src/ui/async-ui.ts:91`). El runner
  cuenta las excepciones de página (`run.mjs:873`) y la batería no reportó ninguna.
- **El `throw` nuevo de `loadFixture` es inalcanzable por accidente**: el manejador solo se salta la
  carga con `value` vacío (`main.ts:1609`), y el único modo de llegar ahí es `loadFixture("")`, que
  seleccionaría la opción `-- Room --`. El mensaje lo dice.
- **Crítica visual.** Las capturas del 22 enseñan el parche del telegraph con su rampa roja en el
  borde y el punto dulce verde, **integrado en el suelo** y sin z-fighting con el embarcadero
  (holgura 0,02 m), y —esto es nuevo— el desplegable de la barra de dev dice `puerto_tile` en la
  captura del bloque 2 y `robledo_tile` en la del bloque 3: **el tell también está en la foto**, que
  es donde lo mira una persona. Antes las dos podían decir `puerto_tile` sin que nadie lo notara.
  La del 34 (`mundo-detras-del-titulo`) enseña el estado de #285 con el mundo apagado detrás y el
  panel de dev encima, con `puerto_tile` a la vista: el sujeto del bloque ya no es anónimo.
- **Cero créditos, y no por confianza**: en la batería completa 18 guiones declaran `sinMotor` y
  el resto pasa el guardarraíl, que exige que cliente y bridge declaren `fake:true` antes de
  ejecutar el cuerpo (`⛨ guardarraíl: cliente y bridge declaran fake:true (http://127.0.0.1:18765 …)`).
  El único contador que se mueve es el de rutas del motor FALSO. Y en las capturas que miré, el panel
  de dev marca `gasto sesión 0,00 € · total 0,00 €`.

## 6 · El guion que dejo — `qa/guiones/44-la-carga-de-una-fixture-no-dice-hecho-antes-de-tiempo.mjs`

Lo mecánico que no estaba cubierto: **el instante**. El 22 afirma qué escena midió *después* de
soltar la compuerta y el 24 afirma el rechazo; ninguno afirma que la promesa **no se asiente antes de
tiempo**, y el contrato de producción solo está vigilado como efecto lateral de un guion cuyo sujeto
es el telegraph.

```
▶ 44-la-carga-de-una-fixture-no-dice-hecho-antes-de-tiempo
    ⛨ sin motor: carga dos fixtures del selector con el JSON de la segunda retenido; nunca arranca partida
    midiendo «robledo_tile»: 14 calcos · tile tile_0_0
    ✔ el hook de fixtures devuelve algo que se puede esperar (una promesa), no «nada»
    con el JSON de puerto_tile retenido, tras 5 frames: {"asentada":false,"error":null,"escena":"robledo_tile"}
    ✔ el mundo sigue en «robledo_tile» mientras el JSON de «puerto_tile» está retenido
    ✔ …y la carga de «puerto_tile» sigue PENDIENTE: el hook no dice «hecho» con la respuesta retenida (#308)
    compuerta sobre puerto_tile.json: {"interceptadas":1,"porCortafuegos":false,"fallos":[]}
    ✔ la compuerta retuvo de verdad el JSON de la fixture (si no, no hay negativo que valga)
    midiendo «puerto_tile»: 57 calcos · asentada con la escena en «puerto_tile»
    ✔ la carga de «puerto_tile» resuelve sin error
    ✔ …y cuando se asienta, el mundo YA es «puerto_tile»: la promesa no va por delante del estado
    ✔ el suelo que se mide ahora es el de «puerto_tile» y no el de «robledo_tile»
```

Cuatro decisiones, y las cuatro están medidas:

- **La precondición NO usa `cargarFixture`.** Usa `ctx.nefan("loadFixture", …)` + un `waitFor`. Es lo
  contrario de lo que hace el 22 a propósito: con el helper afirmativo en la precondición, cualquier
  regresión del hook mata el guion en la primera línea (que es justo lo que le pasa al 22 y de lo que
  va **H2**). Aquí el rojo cae SIEMPRE en el sujeto del guion.
- **El orden de las fixtures es el inverso del 22** (`robledo_tile` → `puerto_tile`): si el defecto
  dependiera de cuál va primero, dos guiones con el mismo orden no se enterarían.
- **Se espera por FRAMES**, nunca por reloj; y esperar de más solo hace más fuerte el negativo,
  porque con la respuesta retenida la promesa correcta no puede asentarse.
- **Dos «no concluyente antes que verde»**: que el mundo siga en la primera fixture mientras se
  retiene, y que la compuerta interceptara de verdad.

**Probado en negativo, dos veces** (y las dos con el árbol restaurado byte a byte):

| Rotura en `nefan-html/src/main.ts` | Guion 44 |
|---|---|
| `const carga = Promise.resolve();` (fire-and-forget total) | 🔴 3 asertos rojos: `asentada=true con el mundo en «robledo_tile»` · `escena al asentarse: «robledo_tile»` · `14 calcos ahora · 14 antes` |
| Solo la 2ª carga sin esperar (el camino EXACTO de #308) | 🔴 los mismos tres |

Coste: dos cargas de fixture y cinco fotogramas, cero créditos. Y no rompe a sus vecinos:
`39-la-lista-de-exenciones-del-guardarrail` sigue verde con el `sinMotor` nuevo dentro, y
`test/architecture.test.ts` sigue 47/47 con el fichero en `qa/guiones/`.

## 7 · Workarounds usados, y su veredicto

Ninguno fue necesario para **observar** la funcionalidad: el flujo real (arrancar, título, selector
«Room», teclado y ratón de verdad) llega a todo. Los ocho de abajo son roturas deliberadas para medir
el rojo, que es el trabajo, no un apaño.

| Apaño | Para qué | ¿Afecta al usuario? |
|---|---|---|
| `loadFixture` → `Promise.resolve()` | Negativo de #308 (total) | No. Restaurado; `git status` vacío |
| `loadFixture` → solo la 2ª carga sin esperar | Reproducir el camino EXACTO del bug | No. Restaurado |
| `loadFixture` → `carga.catch(() => {})` | Negativo del aserto nuevo del 24 | No. Restaurado |
| `case "a"` / `case "w"` fuera del provider | Negativo del control del 34 | No. Restaurado (lo verifica el propio script byte a byte) |
| `if (false && elTituloManda())` | Negativo del bloque 1 del 34 | No. Restaurado |
| Patrón de `retenerFixture` que no casa | Probar el «no concluyente» | No. Restaurado |
| Guion 22 sin soltar la compuerta | Probar el cortafuegos | No. Restaurado |
| Guion 22 y 34 de `main` en el árbol | Medir el ANTES de los dos arreglos | No. Restaurados |

Y uno operativo: dejé un stack arriba con `--keep` para correr los dos scripts que el ingeniero no
había medido, y lo bajé con `./start.sh --parar`, que **enumeró lo ajeno (`:9878`) y no lo tocó**.

## 8 · No probado

- **CI verde**: no hay PR abierta todavía; verde en local no es verde. Es la mitad que falta del
  criterio 8, junto con **H1**.
- **Mutación**: no hay nada que medir y lo dice la herramienta, no yo: `npm run afectado` → *«NO EJECUTA NADA — ningún módulo carga nada de lo que ha cambiado»* (los 17 ficheros del diff están fuera de `nefan-core` o son docs). No pedí corrida pendiente porque no habría módulo al que apuntarla
- **Gasto real de créditos contra el backend que cobra**: por construcción no se ejerce (preset
  `e2e-sin-creditos` + guardarraíl). No es una omisión: es la restricción de la tanda.
- **El camino del jugador con un build de producción**: `window.__nefan` no existe fuera de DEV, así
  que el hook no es alcanzable ahí. Lo que sí corre en producción —la línea nueva del manejador del
  `change`— lo cubre el razonamiento de §5 y la batería entera, no una medida propia.

## 9 · Veredicto

**APTO CON RESERVAS.**

Los siete criterios técnicos se cumplen y —esto es lo que importa cuando el sujeto es el
instrumento— **se cumplen midiendo, no afirmando**: he reproducido el defecto original, he visto la
moneda al aire de `main` (3 verdes de 4 con el bug delante) convertirse en 3 rojas de 3, y he puesto
rojo cada aserto nuevo revirtiendo su sujeto. El guion 22 ya no puede salir verde midiendo el puerto
dos veces, y el control del 34 ya no puede pasar con una tecla muerta.

Las dos reservas:

1. **H1 es bloqueante para el criterio 8**, y no es cosmética: hay ocho afirmaciones commiteadas
   diciendo que dos issues están cerrados cuando están abiertos. Se cierra con dos líneas
   `Closes #308` / `Closes #320` en el cuerpo de la PR — pero hay que ponerlas, y hasta entonces el
   criterio 8 está **sin cumplir**.
2. **H2** deja la demostración re-ejecutable un paso por debajo de lo que la tanda predica. No lo
   considero bloqueante porque el mecanismo funciona (lo medí) y porque el guion 44 lo cubre desde
   hoy; sí conviene apuntar el invariante #308 del script de negativos al camino que de verdad se
   rompió.

Nada de esto toca al jugador: el cambio de producción es un hook de desarrollo y una línea en el
manejador del selector. Lo que cambia es que **la batería ya no miente**, y eso vale para todas las
tandas que vengan detrás.
