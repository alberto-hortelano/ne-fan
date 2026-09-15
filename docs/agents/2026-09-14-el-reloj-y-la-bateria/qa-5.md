# QA 5 · PR-4a de #545 — el reloj de simulación, en un solo sitio

Validado en `/home/al/code/ne-fan-qa545a`, detached en `c240e4e4`, contra `requisitos.md` §4 (#545),
`plan-2.md` §4.3 y el encargo enfocado `plan-4a.md`. Cero créditos (preset `e2e-sin-creditos` y motor
falso en todas las corridas), ningún servidor ajeno tocado, ningún fichero del árbol del ingeniero
leído ni escrito. Stack propio en `NEFAN_PORT_OFFSET=500` para las sondas a mano; `qa/run.mjs` con su
propio bloque para cada corrida de batería.

**VEREDICTO: NO APTO.** El mecanismo está bien construido y el ⊘ funciona de punta a punta sobre la
página real (lo he ejercido: exit 2, resumen correcto, `absorbe` no se lo traga). Pero **el reloj que
lo alimenta cuenta segundos de mundo en estados en los que el mundo no se simula** —medido: 5,71 s de
sim en 6,00 s de pared con el título cubriendo la pantalla— y ahí la asimetría se INVIERTE: en vez de
declarar ⊘, la espera afirma «el mundo avanzó los N s pedidos y no ocurrió» sobre un mundo que no
corrió ni uno. Es el defecto que esta PR existe para matar, movido un escalón. Y **tres de los cinco
sitios de llamada de `herirHasta` con opciones se quedaron con `maxMs`**, que desde este diff se
ignora en silencio: uno de ellos (el 49) ve su presupuesto reducido a la mitad y su resultado gobierna
un `ctx.sinMedir`.

Las dos cosas son baratas de arreglar —H-1 es **una línea** y lo he demostrado ejecutándolo— y ninguna
invalida el diseño. Pero las dos falsifican afirmaciones literales del informe y del `qa/README.md`
que esta PR escribe, así que no pueden pasar sin vuelta.

**Guion nuevo:** `qa/guiones/131-el-reloj-de-sim-solo-cuenta-lo-que-el-mundo-simula.mjs`. **Hoy sale
ROJO a propósito**: es la reproducción ejecutable de H-1, y probado en negativo se pone **entero
verde** con el arreglo de una línea.

---

## 1 · Criterios de aceptación

Sacados de `plan-4a.md` («Lo que entrega esta PR, y NADA más» + la regla dura) y de `requisitos.md`
§4. La evidencia es la que medí YO, no la del informe.

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **La regla dura**: el diff solo cambia CÓMO se espera, nunca QUÉ se cuenta ni sobre qué canal | ✅ cumple | Repasado el diff entero fichero a fichero: no hay un solo aserto de conteo, canal ni umbral tocado. Los guiones 80 y 75 están fuera del diff (`git diff main...HEAD --stat` no los nombra). Los cambios en `42`/`119` son solo el nombre y la unidad de la opción |
| 2 | El reloj de sim existe y está **en un solo sitio** | ✅ cumple | `grep -rn "relojDeSim.avanza(" nefan-html/src` → 1 sola ocurrencia (`main.ts:566`). El tipo ayuda: `avanza` devuelve el delta, así que saltárselo exige borrar una llamada visible en el diff |
| 3 | …y ese reloj mide **«avanzó el juego»** | ❌ **NO cumple** | Mide «hubo frame», que no es lo mismo. Con el título delante: **5,71 s de sim y 167 frames en 6,00 s de pared, razón 0,952** — y ahí `main.ts:672` llama a `gameClient.idle()`, no a `tick(delta)`. Ver **H-1** y `qa/guiones/131` |
| 4 | El hook lo publica: `reloj() → {sim, frames}` | ✅ cumple | `__nefan.reloj()` → `{"sim":7.7388,"frames":454}` leído en la página real. `frames` es el del loop (con el rAF quitado sale **0 frames en 2,1 s**, mientras `fps()` seguiría hablando del renderer) |
| 5 | `waitFor` admite `{sim: N}` y **quien decide la expiración es el sim** | ✅ cumple | Con el mundo corriendo, `{sim:1, ms:60_000}` expira en ~1 s y no en 60. Con el reloj parado no se rinde (sigue mirando). Probado además con un reloj **parcial** (caso que el ingeniero no usó): avanzó 2,50 de 4,00 s → ⊘ con las dos cifras en el mensaje |
| 6 | El cortafuegos de pared solo declara **⊘**, nunca «no ocurrió» | ✅ cumple (con el reloj sano) | Sobre la página real, con el loop parado: `⊘ … sim pedido 4.00 s vs. sim avanzado 0.00 s (0 frames del loop en 2.1 s de pared)`. **Falla cuando el reloj miente** (H-1) y cuando el reloj devuelve `NaN` (H-6) |
| 7 | El ⊘ degrada MÁS que el rojo y no puede enmascararlo | ✅ cumple | Ejercido de punta a punta con un guion temporal: resumen `0 en verde · 0 en rojo · 1 SIN MEDIR de 1`, línea `✖ 1 guion(es) no llegaron a medir: esta corrida NO es un veredicto del juego`, **exit 2**. `exitDeCorrida` = `noMedidos ? 2 : rojos ? 1 : 0`. Y las tres bocas que consumen expiraciones NO se lo tragan: `ctx.absorbe` frente a un ⊘ → **SUBE** (medido); `expectEspera` hace `if (!exp) throw err` |
| 8 | `qa/lib/combate.mjs` pasa a sim y con él los guiones que andan y pegan | ⚠️ parcial | El fichero no decide por pared en ningún sitio (`grep` de `_000`/`maxMs`/`setTimeout` → 0). Pero **3 de los 5 sitios de llamada con opciones siguen pasando `maxMs`**, que ahora se ignora en silencio. Ver **H-3** |
| 9 | Los guiones de combate **cuentan LO MISMO** antes y después | ⚠️ no reproducido | Mi medida: **371 asertos (base, 1 rojo)** vs **370 (HEAD, 0 rojos)**, 5 entradas que difieren. Cuatro son el guion 91 cambiando de color y una es el 118 llamando a `acercarse` una vez menos. El 91 en solitario sale **verde 3/3 sobre HEAD**, así que es intermitencia de posición en la batería, no del diff — pero la prueba «371 = 371, listas idénticas» es **una sola muestra de una batería no determinista**. Ver **H-8** |
| 10 | `qa/lib/sonda.mjs` sale de los exentos y estrena batería | ✅ cumple | `banco-medido.json` → 6 exentos, `sonda.mjs` fuera; `test/sonda-de-qa.test.ts` la importa de verdad (nodo de import, que es lo que exige `qa-lib-tiene-quien-lo-mire.test.ts`). **Pero el reloj en sí no lo ejecuta ni un test**: ver **H-2** |
| 11 | Los candados nuevos se ven rojos con lo que prometen guardar | ❌ **NO cumple** (uno de los cuatro) | El ancla del reloj está **verde con el reloj muerto** (`sim += 0` → 21/21 pass) y **ROJA con el arreglo correcto** (20/21). Ver **H-2** |
| 12 | `qa/README.md` dice la regla nueva, y `NEFAN_QA_GPU=0` no se adopta con su motivo | ✅ cumple | Regla 1 reescrita con el clamp, el ⊘ y «qué va en sim y qué no»; los 6 exentos; el bloque de `NEFAN_QA_GPU=0` ya estaba de PR-3 y sigue |
| 13 | **80 y 75 no se tocan**, y su color se apunta | ✅ cumple (no se tocan) · ver §4 el color | El diff no los nombra. Mi medida sobre HEAD: ver §4 |
| 14 | Verde y deuda de la zona sin crecer | ✅ cumple | Ver §5 |
| 15 | El reloj sobrevive al bundle de producción y el verbo del banco NO | ✅ cumple | `npm run build` → `tl.avanza(Math.min((t-Ca)/1e3,.1))` en `dist/assets/index-*.js` (el reloj corre en producción); `reloj:` y `closeTitle` → **0 ocurrencias** en todo `dist/` (el gate de DEV sujeta). La sonda lo dice bien cuando falta: `⊘ … no publica window.__nefan.reloj()` en < 2 s |
| 16 | Un rojo de #545 REPRODUCIDO y arreglado sobre un guion de combate | ⚠️ no probado | Sigue sin existir, y el propio informe lo declara (§7.1). No lo intenté reproducir: el 41 aguanta ×40 en los dos árboles según su medida, y el único rojo reproducido (el 91) es de PR-4b |

---

## 2 · Hallazgos

### H-1 · BLOQUEANTE — el reloj cuenta segundos de mundo donde el mundo no se simula, y ahí la espera AFIRMA en vez de declarar ⊘

**Qué pasa.** `relojDeSim.avanza(…)` se llama en `nefan-html/src/main.ts:566`, arriba del todo del
`gameLoop`: **antes** del `if (!gameClient) { … return; }` de la 569 y muy por encima del
`titleScreen.isVisible ? gameClient.idle() : gameClient.tick(delta, …)` de la 672, cuyo propio
comentario dice «ahí no hay jugador que simular». O sea: el contador sube con el FRAME, no con el
MUNDO.

La consecuencia no es cosmética, es la inversión exacta del mecanismo. `waitFor` toma su lectura BASE
al arrancar, así que lo acumulado antes no cuenta — pero lo acumulado DURANTE la espera sí, y en el
título el presupuesto se gasta entero sin que el mundo dé un paso. Cuando eso pasa, la espera **no
declara ⊘: afirma**.

**Medido sobre el juego real** (preset `e2e-sin-creditos`, stack propio en el bloque +500):

```
=== 8 s de pared CON EL TÍTULO DELANTE (#title-screen display:flex, hidden:false) ===
antes  : {"sim":0.0893,"frames":4}
después: {"sim":7.7388,"frames":454}
sim avanzado: 7.650 s · frames: 450 · pared: 8.00 s
razón sim/pared con el título delante: 0.956
```

Y con la sonda de verdad (`ctxDeSonda`, la misma que usa la batería), un `waitFor({sim:4})` con el
título delante:

```
### CON EL TÍTULO DELANTE (el mundo NO tickea)  (título visible: true)
   veredicto : ROJO EsperaExpirada
   pared     : 3.97 s
   mensaje   : timeout esperando: … (el mundo avanzó los 4 s de simulación pedidos,
               en 4.0 s de pared, y no ocurrió; último valor: null)
```

«El mundo avanzó los 4 s de simulación pedidos» es literalmente falso: `tick(delta)` no se llamó ni
una vez. Es el mismo error que #545 vino a matar —presupuestar contra un reloj que no es el del
juego—, con la agravante de que ahora viene firmado como si lo fuera.

**Pasos de reproducción desde el arranque.** `NEFAN_PORT_OFFSET=500 ./start.sh --preset
e2e-sin-creditos`, abrir la URL que imprime, **no tocar nada** (el título es el estado 1 del sistema,
donde empieza cualquiera que juega) y leer `window.__nefan.reloj()` dos veces separadas por unos
segundos. O, sin manos: `node qa/run.mjs 131`.

**Qué esperaba el usuario.** Lo que escribe este mismo diff en `qa/lib/sonda.mjs` y en
`qa/README.md`: «quien decide la expiración es el reloj de simulación», «un guion que no pudo medir no
puede terminar diciendo que midió, ni en verde ni en rojo».

**Alcance HOY: ningún guion lo pisa, y el borde está a un helper de distancia.** Los 20 guiones de
combate llaman a `acercarse`/`herirHasta` después de `comenzar()`, que sí espera a que el título deje
de interceptar. Pero **`reanudar()` (`qa/lib/sesion.mjs:443-459`) solo espera a `status().scene`, no a
`status().title === false`** — y el comentario de `comenzar()` documenta que existe una ventana con
escena y título a la vez («medido en el guion 27»). El 49 reanuda dos veces antes de su `herirHasta`.
Y PR-4b convierte a sim **36 sitios más**, algunos pegados al título. O sea: hoy es una trampa
armada, no una herida abierta — pero está armada justo debajo de la PR siguiente.

**El guion que lo reproduce.** `node qa/run.mjs 131` sobre HEAD:

```
    con el título delante: 5.82 s de sim y 170 frames en 6.14 s de pared (razón 0.947)
    ✘ A · con el TÍTULO delante el reloj de sim NO avanza …
    ✘ B · con el TÍTULO delante, una espera de sim declara ⊘ y NO afirma «no ocurrió» — terminó «afirmó»
    con el mundo corriendo: 6.04 s de sim y 181 frames en 6.04 s de pared (razón 1.000)
    ✔ C1 · con el mundo CORRIENDO el reloj de sim sigue a la pared
    con el loop parado: 0.03 s de sim y 1 frames en 6.06 s de pared
    ✔ C2 · sin rAF el game loop se para y el reloj de sim se para con él
    ✔ C3 · con el MUNDO parado, una espera de sim declara ⊘ (el mecanismo de #545, sobre la página real)
0 en verde · 1 en rojo de 1
```

C1 es el control positivo que hace falta para que A y B signifiquen algo: **un reloj muerto pasaría A
y B**, así que sin C1 el guion sería otro candado que se satisface sin mirar.

**El arreglo, medido.** Mover la llamada al argumento del `tick`, sin añadir ni una línea:

```
-  const delta = relojDeSim.avanza(Math.min((now - lastTime) / 1000, 0.1));
+  const delta = Math.min((now - lastTime) / 1000, 0.1);
…
-    : gameClient.tick(delta, {
+    : gameClient.tick(relojDeSim.avanza(delta), {
```

`wc -l nefan-html/src/main.ts` sigue en **1395** (la cifra exacta del contrato), `npx tsc --noEmit`
exit 0, y `node qa/run.mjs 131` pasa de **1 en rojo** a **1 en verde** (`0.00 s de sim y 0 frames`
con el título delante, y el ⊘ apareciendo donde tiene que aparecer). *(Lo revertí: el árbol está
limpio — `git status` solo enseña este `qa-5.md` y el guion 131.)* Queda para el ingeniero decidir si `frames` debe
seguir contando los fotogramas del loop o los del mundo; lo que no puede es que `sim` cuente los dos.

---

### H-2 · IMPORTANTE — el candado del ancla está VERDE con el reloj muerto, y ROJO con el arreglo correcto

Los tres asertos del bloque «el reloj de sim del cliente está anclado, y es UNO» son **grep sobre el
texto** de `main.ts` y de `nefan-hook.ts`. No ejecutan el reloj: `crearRelojDeSim` **no lo llama ni un
test del repo** (`grep -rn "relojDeSim" nefan-core/test nefan-html --include=*.ts` solo devuelve el
propio fichero de test citando la regex, más los dos ficheros de producción).

**Negativo 1 — verde sin haber mirado.** Neutralicé la aritmética del reloj dejando la llamada intacta:

```
-      sim += delta;
+      sim += 0;
```

`npx tsc --noEmit` exit 0 y `npx tsx --test test/sonda-de-qa.test.ts` → **`tests 21 · pass 21 ·
fail 0`**. Con ese cambio puesto, el reloj se queda clavado en 0 y **toda espera de sim de la batería
pasaría a declarar ⊘** — y ningún candado se entera.

**Negativo 2, y es el que duele — rojo CON el arreglo bueno.** Con el parche de H-1 puesto (el que
pone el guion 131 entero en verde), el mismo fichero de test da **`pass 20 · fail 1`**:

```
✖ el delta TOPADO del game loop pasa por el reloj: no hay forma de mover el mundo sin contarlo
```

O sea: el candado no solo no caza el defecto, **defiende la posición exacta en la que vive**. Su
regex exige que la acumulación ocurra en la línea del clamp, que es arriba del `!gameClient` y arriba
del título.

**Qué le falta.** Un test que EJECUTE `crearRelojDeSim` (dos `avanza`, un `lee`, y que `avanza`
devuelva su argumento) y, sobre todo, el aserto de comportamiento que hoy no existe en ningún sitio:
que el reloj no cuente lo que el mundo no simula. Eso último es `qa/guiones/131` y necesita página.

---

### H-3 · BLOQUEANTE — tres sitios de llamada de `herirHasta` se quedaron con `maxMs`, que ahora se ignora en SILENCIO

`herirHasta` pasó de `const { maxMs = 60_000, alcance = 1.6 }` a `const { sim = 60, alcance = 1.6 }`.
El informe (§4.3) dice que la traducción se aplicó «en sus tres sitios de llamada (42 dos veces, 119
una)». Son **cinco** los que pasan presupuesto, y **tres se quedaron atrás**:

| Sitio | Lo que escribe | Lo que hace hoy | Efecto |
|---|---|---|---|
| `qa/guiones/48-…:283` | `maxMs: 90_000` | `sim: 60` (defecto) | cortafuegos de pared **300 s** en vez de 90 s |
| `qa/guiones/49-…:344` | `maxMs: 120_000` | `sim: 60` (defecto) | **el presupuesto se parte por la mitad** (~62 s de pared con la máquina quieta, contra los 120 s que pide) |
| `qa/guiones/91-…:404` | `maxMs: 45_000` | `sim: 60` (defecto) | presupuesto **más generoso** sin decirlo |

Ninguno falla: un objeto de opciones con una clave desconocida se desestructura en silencio. Es
exactamente el «presupuesto que se ha hecho más generoso sin decirlo» del encargo, y en el 49 también
el contrario — y el 49 es el peor de los tres porque **el resultado de ese `herirHasta` gobierna un
`ctx.sinMedir`**:

```
  const rematado = await herirHasta(ctx, elHostil.id, 0, { maxMs: 120_000, alcance: … });
  if (!rematado?.muerto) { … ctx.sinMedir(`no se pudo matar al hostil de runtime …`); }
```

O sea: un guion puede irse a ⊘ (exit 2, que degrada la corrida entera) porque su presupuesto se
redujo a la mitad sin que nadie lo escribiera. En mis dos corridas de 22 guiones no pasó, pero el
margen ya no es el que su autor eligió.

**Por qué no lo cazó nada.** `qa/lib/combate.mjs` **sigue exento** en
`data/contract/banco-medido.json` — la PR sacó de la lista a `sonda.mjs` y dejó dentro el fichero en
el que hizo el cambio de contrato.

**Reproducción, ejecutada.** Un `ctx` falso que solo apunta con qué presupuesto se llama a
`waitFor`, y los cuatro sitios de llamada de verdad:

```
presupuesto que llega a waitFor, en el orden 49 · 48 · 91 · 42:
    {"sim":60}      ← el 49 pidió maxMs: 120_000
    {"sim":60}      ← el 48 pidió maxMs:  90_000
    {"sim":60}      ← el 91 pidió maxMs:  45_000
    {"sim":90}      ← el 42, migrado
```

Y `git grep -n "herirHasta(" HEAD -- qa/guiones` enseña los nueve sitios de llamada, cinco de ellos
con opciones.

**Lo que esperaba el usuario.** «mismo número, unidad explícita» en TODOS los sitios, y que una opción
que ya no existe no se pueda escribir sin que algo se rompa (fail-loud, la convención de la casa).

---

### H-4 · IMPORTANTE — el cortafuegos «×10» es ×3,33 para el presupuesto más grande que la PR usa, y su justificación solo vale para el más pequeño

`presupuestoDeEspera` deriva el cortafuegos de pared como `min(sim × 1000 × 10, 300_000)`. El
comentario que lo justifica dice, con su medida al lado: «*Para que 4 s de sim quepan con razón 0,152
hacen falta 6,6 s de pared por cada uno: ×10 los cubre con margen*». Con el techo puesto, eso solo es
verdad para `sim: 4`:

```
presupuesto | techoMs | múltiplo REAL | razón sim/pared mínima que tolera
  sim: 4    |   40000 | ×10.00        | 0.100
  sim:45    |  300000 | × 6.67        | 0.150
  sim:60    |  300000 | × 5.00        | 0.200
  sim:90    |  300000 | × 3.33        | 0.300
```

Los cuatro presupuestos que la PR pone en producción son exactamente ésos. Contra las razones que el
propio ingeniero midió a ×40 en §3.4 (**0,269 · 0,289 · 0,289 · 0,304 · 0,327 · 0,328**) y las que
cita el comentario (0,152–0,309):

- `sim: 90` (guion 42, dos sitios) **no aguanta** cuatro de las seis razones medidas;
- `sim: 60` (el defecto de `herirHasta`, que heredan ~17 guiones) no aguanta la cola de 0,152;
- `sim: 45` (guion 119) está justo en el filo (0,150 vs 0,152).

O sea: bajo la MISMA carga con la que se midió la tanda, una `herirHasta` que necesite su presupuesto
entero **declara ⊘ en vez de medir**. El arreglo cubre bien el tramo de 4 s de `acercarse` y no cubre
los presupuestos grandes en el régimen que motivó #545. No es un fallo de diseño —el ⊘ es la salida
honesta— pero la justificación escrita no se sostiene para tres de los cuatro casos, y eso es
justamente lo que esta casa llama «una decisión correcta con una razón inventada».

---

### H-5 · MENOR — `herirHasta` deja la tecla «up» PULSADA cuando sube un ⊘

Antes, `.catch(() => null)` garantizaba que se llegara a `await ctx.nefan("inputDriver.release","up")`.
Ahora el ⊘ se relanza desde el `.catch` y esa línea **no se ejecuta**. Medido con un doble de `ctx`:

```
5 · herirHasta con ⊘: LANZÓ ⊘
    llamadas a inputDriver: ["inputDriver.selectAttack(quick)"]
    ¿soltó la tecla «up»? NO — se queda pulsada
```

`holdUntil` sí tiene su `finally`; `herirHasta` no. El impacto práctico es pequeño (el guion aborta y
`run.mjs` abre página nueva para el siguiente), pero la captura y el diagnóstico del ⊘ se toman con el
jugador andando, y es una asimetría dentro del mismo fichero.

*(Nota de control, porque el encargo lo pedía: el cambio de `.catch(() => null)` a «solo expiraciones»
**no** convierte en rojo nada que fuera verde por buenas razones. Antes de este diff `waitFor` solo
podía lanzar `EsperaExpirada` —los errores de la sonda se enmascaran en `{__err}` y se siguen
sondeando—, así que las dos formas son equivalentes sobre el código viejo. Lo único nuevo que pasa de
largo es el ⊘, que es el propósito.)*

---

### H-6 · MENOR — un reloj que devuelva `NaN` hace que la espera AFIRME un negativo tras UN solo sondeo

`presupuestoDeEspera` hace fail-loud con cualquier presupuesto que no entienda, y el comentario explica
por qué: «*un presupuesto que no se entiende caería en `timeoutMs = undefined` … la espera haría UN
sondeo y se daría por expirada*». La misma puerta no está puesta en la **lectura**: `typeof r?.sim ===
"number"` acepta `NaN`, y a partir de ahí `consumido` es `NaN`, `NaN < p.sim` es falso y el bucle
termina en la primera vuelta por el camino de la AFIRMACIÓN. Medido:

```
2 · reloj NaN: ROJO en 150 ms
   mensaje: timeout esperando: x (el mundo avanzó los 4 s de simulación pedidos,
            en 0.1 s de pared, y no ocurrió; último valor: null)
```

No es alcanzable desde el cliente de hoy (`delta` siempre es finito), así que va de menor — pero es la
misma clase de defecto que el fichero declara haber cerrado, en el otro extremo del mismo dato.

---

### H-7 · MENOR — la cabecera de `nefan-hook.ts` publica un rastro que este diff dejó falso

Línea 6 del fichero, intacta: «*NO es API del juego: nada de `nefan-html/src` lo consume*». Desde este
diff `main.ts` lo consume **en cada frame**, y también en producción: el bundle lleva
`tl.avanza(Math.min((t-Ca)/1e3,.1))`. El ingeniero añadió un párrafo nuevo explicando el reloj, pero
la frase vieja sigue ahí y dice lo contrario. Es el patrón que esta casa tiene fichado («los rastros
confunden a los agentes»): la retirada de una afirmación incluye el barrido de la prosa que la
sostenía.

Como juicio de la decisión que pedía el encargo: **poner el reloj en `dev/nefan-hook.ts` me parece el
mal menor bien elegido** —la alternativa era subir una excepción de tamaño congelada, que está
prohibida por escrito— y el bundle confirma que no se cuela nada del banco en producción. Pero sí es
una inversión de frontera: el `delta` del juego pasa hoy por un módulo cuyo trabajo declarado es
exponer estado al banco, y **no hay ningún candado que lo sujete** en ninguna dirección. Si se queda
así, la frontera se documenta donde toca; si no, el sitio natural es un módulo propio
(`src/simulation/reloj-de-sim.ts`) que el hook lea, y eso tampoco añade líneas a `main.ts`.

---

### H-8 · MENOR (método) — «371 asertos antes, 371 después, listas idénticas» no se reproduce

Repetí la comparación con mi propio extractor (guion + texto del ✔/✘, números normalizados, cuenta por
ocurrencias), corriendo los MISMOS 21 ids sobre el árbol base (`git checkout main --` de los ficheros
del diff) y sobre HEAD:

```
total antes 371 · total después 370 · entradas que difieren: 5
  ANTES x3 · DESPUÉS x2 · 118-… | ✔ | ocurre: el jugador LLEGA andando a # m de barkeep …
  ANTES x1 · DESPUÉS x0 · 91-…  | ✘ | en vivo, la pared de el cofre está a # m de su centro …
  ANTES x1 · DESPUÉS x0 · 91-…  | ✘ | tras reanudar, la pared de el cofre está a # m de su centro …
  ANTES x0 · DESPUÉS x1 · 91-…  | ✔ | en vivo, la pared de el cofre …
  ANTES x0 · DESPUÉS x1 · 91-…  | ✔ | tras reanudar, la pared de el cofre …
```

Base: **21 en verde · 1 en rojo**. HEAD: **22 en verde · 0 en rojo**.

**No lo atribuyo al diff, y lo comprobé**: el rojo del 91 es una medida de colisión
(`[1.55, 8.05, 7.25, 1.6]`, la más corta 1,55 vs core 1,15) y en las dos corridas el hostil murió
igual (`{"hud":0,"muerto":true}`), así que no es el presupuesto; y el 91 **en solitario sale verde 3
de 3 sobre HEAD**. Es la intermitencia por posición en la batería que #496 describe. Lo que sí queda
dicho es que la prueba dura del informe es **una sola muestra de una batería que no es determinista**,
y que una comparación de listas que casa a la primera sobre este material es suerte, no método. Si
esa prueba tiene que sostener la regla dura, necesita N corridas por árbol y hablar de distribución.

---

### H-9 · MENOR (dato) — el peor caso de pared de la batería crece ×10 y nada lo acota

`run.mjs` no tiene tope por guion. Con `{sim:4}` el cortafuegos de un tramo pasa de 4.000 ms a
40.000 ms, así que `acercarse(…, {tramos: 30})` (guion 42) pasa de un peor caso de **~2 min** a
**~20 min**, y un `herirHasta` de 60 s a 300 s. Solo se paga cuando el reloj de sim está parado —que
es cuando el ⊘ es la respuesta correcta— pero conviene que esté escrito antes de que alguien vea una
corrida «colgada» y la mate.

---

## 3 · Workarounds usados durante la prueba

| Qué hice | Por qué NO afecta al jugador | Cómo quedó |
|---|---|---|
| Neutralicé `sim += delta` → `sim += 0` para probar el candado del ancla en negativo | Experimento de QA, no un arreglo | Revertido con `cp` de la copia previa; `git status` limpio y verificado |
| Parcheé `main.ts` (mover `avanza` al argumento del `tick`) para probar el arreglo de H-1 | Ídem; sirve para demostrar que el guion 131 se pone verde con el arreglo | Revertido; `main.ts` vuelve a 1395 líneas con la llamada en la 566 |
| `git checkout main -- <ficheros del diff>` para correr la batería base, y `git checkout HEAD --` después | Es la comparación antes/después, no un apaño del producto | Revertido; `git status` solo muestra el guion 131 nuevo |
| Quité `window.requestAnimationFrame` **desde la página** para parar el loop | Es una intervención sobre la PÁGINA en la sonda, no sobre el juego: ninguna línea del cliente cambia, y es el único modo de provocar «el mundo no avanza» sin carga sintética. Un jugador no lo ve | Vive dentro del guion 131, declarado en su cabecera |
| Guion temporal `132-QA-TEMPORAL-…` para ver cómo clasifica el runner un ⊘ que propaga | Instrumento de medida | **Borrado** al terminar |
| Mi primera versión del guion 131 dormía con `setTimeout` y puso `npm run verify` en rojo | Era un defecto MÍO, no del diff, y el candado del repo lo cazó solo | Reescrito: la ventana la cierra la página con `performance.now()`; verify vuelve a 2802/2802 |

**Una contaminación que declaro aunque salió inocua**: la primera corrida de los 21 guiones sobre HEAD
se solapó ~1 minuto con el experimento del reloj neutralizado (vite sirve este mismo árbol). Salió
`22 en verde · 0 en rojo` y **cero ⊘** — con el reloj muerto habría habido ⊘ —, así que la corrida no
se vio afectada; aun así, las cifras de §1 criterio 9 salen de esa corrida y conviene saberlo.

---

## 4 · Los guiones 80 y 75 — mi propia medida

**Fuera del diff**: `git diff main...HEAD --stat` no nombra ninguno de los dos. Corridos con
`node qa/run.mjs 80 75` sobre HEAD, sin tocar una línea suya:

| corrida | árbol | 75 | 80 | aserto que cae |
|---|---|---|---|---|
| pareja 1 | **HEAD** | ✔ | **✘** | 80: `…ni deja una entrada de error — 7 → 9` |
| pareja 2 | **HEAD** | ✔ | **✘** | 80: `…ni deja una entrada de error — 7 → 9` |
| pareja 3 | **HEAD** | ✔ | ✔ | — |
| pareja 1 | base | **✘** | ✔ | 75: `2 derivaciones (había 1) — la escena servida cambió en: npcs (barkeep: position)` + `0 restauraciones · huella DISTINTA` |
| pareja 2 | base | ✔ | **✘** | 80: `…ni deja una entrada de error — 7 → 9` |

**Los dos son intermitentes en LOS DOS árboles, con los mismos asertos, y nada se ha tapado.** El 80
sale rojo **2 de 3** veces **con el diff puesto** y con el aserto idéntico (un conteo del
`#error-log`), así que el contador que #496/#497 contamina sigue pudiendo caer exactamente igual — que
es la prueba que el ingeniero aporta y que yo reproduzco por mi cuenta, en su misma dirección. El 75
cayó una vez sobre la base con la firma de #410/#496 (conteo de derivaciones y de restauraciones sobre
un canal compartido), y ninguna sobre HEAD en tres parejas; con 3 y 2 muestras eso no distingue una
mejora de la suerte, y **no lo presento como mejora**.

Los dos asertos que caen son **CONTADORES sobre un canal compartido**, ninguno es un presupuesto en
milisegundos, y `qa/lib/combate.mjs` no interviene en ninguno de los dos guiones (no lo importan). Es
la firma de #496/#497 que describe `critica-2.md`. **No se cierra nada de #496 ni de #497.**

---

## 5 · Verde, umbrales y deuda

```
$ cd nefan-core && npm run verify        → EXIT 0
ℹ tests 2802 · suites 498 · pass 2802 · fail 0
```

Verde **con el guion 131 dentro del árbol** (la primera corrida salió en rojo por culpa MÍA: el guion
usaba un `new Promise(r => setTimeout(...))` y lo cazó `qa-guiones-sin-espera-por-reloj` de
`arch-rules.json`. Reescrito para que la ventana la cierre la página con su propio
`performance.now()`, que además es mejor medida. El candado hizo exactamente su trabajo, y conviene
decirlo al lado de H-2, que no lo hizo).

```
$ npm run coverage && npm run crap -- --check      → CRAP_EXIT 0
1365 funciones medidas · cobertura 95.89% de 18094 líneas DE CÓDIGO · complejidad máxima 46
Tope (no empeorar): CRAP ≤ 73 — 0 por encima.
Cobertura mínima: 95% — ahora 95.89% (margen 0.89 puntos ≈ 161 líneas).
✔ dentro de los umbrales

$ npm run deuda
Deuda medida — 86 items.   (11 fronteras · 11 CRAP · 64 supervivientes)
```

**86 items, la misma cifra que el ingeniero midió en su árbol y la misma que midió QA-4 sobre `main`
el 2026-09-14.** Ningún umbral tocado: `client-file-size.json` sigue con `src/main.ts` en **1395** y
`wc -l` da 1395; `quality-thresholds.json` intacto.

**Dónde NO puede haber crecido deuda, y por qué**: el diff no toca ni un fichero de `nefan-core/src`,
`bridge/` ni `services/`. Lo que toca de producción es `nefan-html`, que no entra en CRAP ni en
mutación, y `qa/lib`, que está fuera por la regla escrita `el-banco-no-entra-en-produccion`. Lo
comprobé con `git diff main...HEAD --stat`: `nefan-core` solo aparece por `data/contract/banco-medido.json`
(una entrada MENOS) y por el fichero de test nuevo.

**Mutación**: no aplica y no hay petición que dejar pendiente — coincido con el informe (§6).

---

## 6 · No probado, y por qué

- **Un rojo de #545 reproducido y arreglado sobre un guion de combate.** Sigue sin existir; el informe
  lo declara y no lo discuto. No gasté máquina en repetir `bajo-carga.mjs` sobre el 41: la medida del
  ingeniero (×40, igual-verde 0/3 en los dos árboles) es coherente con lo que yo veo, y el único rojo
  reproducido (el 91) es de PR-4b.
- **El comportamiento bajo carga REAL de los presupuestos grandes** (H-4). La aritmética del
  cortafuegos la medí ejecutando `presupuestoDeEspera`; que un `{sim:90}` acabe en ⊘ a ×40 es
  deducción de esas cifras más las razones que midió el ingeniero, **no una corrida frenada mía**.
- **Mutación.** No aplica: el diff no toca `nefan-core/src`, y ni `nefan-html` ni `qa/lib` entran en
  `mutation-targets.json`.
- **Que Playwright serialice bien la función del reloj hacia el navegador** sí está probado, y por dos
  vías distintas a la batería: mis sondas a mano y el guion 131.

---

## 7 · Qué tiene que volver

1. **H-1** — que el reloj cuente el mundo y no el frame (una línea, probada). Con ella, el guion 131
   se pone entero verde.
2. **H-2** — el candado del ancla tiene que poder ponerse rojo con el reloj muerto, y tiene que dejar
   pasar el arreglo de H-1. Hoy hace lo contrario de las dos cosas.
3. **H-3** — los tres `maxMs` huérfanos, y una puerta que impida escribir una opción que ya no existe.
4. **H-4** — o se corrige la justificación del cortafuegos con las cifras de verdad, o se sube el
   techo con su motivo medido. Lo que no puede quedarse es el número ×10 escrito para los cuatro casos
   cuando solo vale para uno.
5. **H-5**, **H-6**, **H-7**, **H-8**, **H-9** — a criterio del ingeniero; ninguno bloquea si se
   escriben.

**Nada de esto toca #496/#497**, y el color del 80 y del 75 se apunta en §4 sin cerrar nada de
ninguna de las dos.
