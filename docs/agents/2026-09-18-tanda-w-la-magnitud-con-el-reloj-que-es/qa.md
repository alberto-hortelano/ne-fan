# QA — tanda W: el 93 mide contra el reloj de sim y la rama sin sujeto se retira (#679, #682)

Validado sobre `feature/tanda-w-la-magnitud-con-el-reloj-que-es` = `25f8e741` (base `main` = `39421b12`),
en el worktree de la tanda, el 2026-09-21 entre las 11:10 y las 12:00. Cero créditos: todo por
`qa/run.mjs` / `qa/bajo-carga.mjs` (preset `e2e-sin-creditos`, motor falso), bloque de puertos
elegido por el runner. Máquina en reposo al abrir (load 0,9) y con otras tandas en paralelo; ninguna
corrida frenada compartió CPU con `verify`.

Los criterios son los del **bloque reescrito por el crítico** (requisitos.md), con las cuatro
decisiones del coordinador: grep por TÉRMINO de categoría, evidencia del par = la fila del
clasificador (no el exit code), «en par» = `node qa/run.mjs 92 93`, y candado de reaparición en
`campos-retirados-no-vuelven`.

## Criterio → veredicto → evidencia

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | `medirVelocidad` mide `camino / Δsim`, con `sim` leído de `window.__nefan.reloj()` en el MISMO callback que `pos`; `rumboLibre` sin tocar | ✅ cumple | Diff del 93 leído entero: el `tick` del `rAF` lee `state().pos` y `reloj().sim` seguidos y empuja `[sim, x, z]`; el `t` del `rAF` ya no se lee; `segSim` = última − primera muestra interior; `Δsim ≤ 0` LANZA. `rumboLibre` (`:240-260`) no aparece en el diff y `npm test` incluye `la-consulta-de-movimiento-tiene-dueno` (3 apariciones) en verde. Exactitud medida: **32 velocidades** (4 quietas del par, 12 en `92 93` ×3, 12 a ×40, 4 a ×80) con **error 0,000 %** |
| 2 | Par a `--factor 40 --repeticiones 3`: `se-rompio` antes, `igual-verde` después, con «la carga fue REAL» en las dos | ✅ cumple | **ANTES** (árbol base `39421b12` para `qa/`, test y arch-rules, `git checkout 39421b12 --`): `93 … ✔ ✘✘✘ 3/3 se-rompio · comportamiento`, razones 0,300 / 0,296 / 0,271, 12 velocidades a 0,34-0,61 de lo esperado con el NUMERADOR clavado (12,12 / 24,24 / 18,18 / 26,06 m) y el denominador de pared hinchado (4,5-8,6 s), «✔ la carga fue REAL». **DESPUÉS** (HEAD): `93 … ✔ ✔✔✔ 0/3 igual-verde`, razones 0,268 / 0,220 / 0,233, «✔ la carga fue REAL», las 12 velocidades a 0,000 % (5,02 / 10,87 / 7,52 / 16,30 m en 1,200-1,300 s de sim). Salidas: `qa/capturas/bajo-carga/2026-09-21T09-10-37-852Z-93` y `…T09-22-55-796Z-93` |
| 3 | Retirada ENTERA: verbo, getter, `defineProperty`, cable, `tasaQueCae`, rama y frase, tests, prosa; grep por término a 0; clasificador a DOS firmas con docblock | ✅ cumple | `git grep -nE 'expectTasa\|tasaQueCae\|segundosDePared\|tasaCaida\|razonesRojas\|tasasCargado\|[`"*]comportamiento[`"*]\|por comportamiento' HEAD -- qa nefan-core/test` → **0 líneas**. En todo el árbol solo queda dentro del `pattern` de la regla que lo prohíbe. Ningún lector de `ctx.tasas` ni de `magnitudes` en `run.mjs`, `bajo-carga.mjs`, `carga.mjs` ni `README.md` (grep `\btasas?\b\|magnitud`: solo prosa histórica sobre «una tasa», ningún identificador). `comparaCorridas(quieta, cargadas)` sin `{umbral}`, firma = `presupuesto`/`sin-firma`, docblock cuenta la tercera y remite a `critica.md`. `carga-sintetica.test.ts`: 58 tests verdes (eran 91) |
| 4 | Negativo del punto 1: denominador de pared restaurado → el 93 a ×40 vuelve a rojo | ✅ cumple | Sabotaje QUIRÚRGICO (ventana en sim intacta, solo `segSim = (t_último − t_primero)/1000` del `rAF`), `--factor 40 --repeticiones 2`: `93 … ✔ ✘✘ 2/2 se-rompio · sin-firma`, razones 0,252 / 0,226, «la carga fue REAL». Las 8 velocidades caen un **50-86 %** con el **numerador idéntico** al verde (5,02 / 10,87 / 7,52 / 16,30 m). Restaurado por `git checkout` y comprobado con `md5sum -c` (OK), `git status` limpio. Salida: `…T09-33-…-93` |
| 5 | Guion 93 aislado y en par, tres corridas de cada | ✅ cumple | Aislado: 4 corridas ×1 por el reproductor (los cuatro «quieto», todos `terminó con 0`) + la corrida del sabotaje del título. En par: `node qa/run.mjs 92 93` ×3 → `2 en verde · 0 en rojo de 2` las tres veces (capturas `2026-09-21T09-43-57`, `T09-44-26`, `T09-44-58`), 12 velocidades a 0,000 %, ventana 1,203-1,237 s de sim |
| C | Candado de reaparición en `campos-retirados-no-vuelven` (decisión 4), probado en negativo | ✅ cumple | Los tres términos en un comentario del guion 92 → `node --test test/architecture.test.ts`: `✖ campos-retirados-no-vuelven`, `pass 105 · fail 1`. Restaurado, `git status` limpio |
| V | `npm run verify` | ✅ cumple | `build + typecheck:scripts + typecheck:labs + typecheck:tests + lint + test` → **3194 tests, 3194 pass, 0 fail**, EXIT 0 |

## Pasada adversarial (las cuatro del coordinador y las mías)

**(1) La cura no tiene candado en `npm test` — ¿aceptable con issue, o hallazgo que devuelve?**
Aceptable con issue, **pero la justificación del ingeniero no es exacta y conviene corregirla en el issue**. Dice que «la única vía barata es leer el AST del guion desde un test, que es justo el patrón que esta tanda retira». No es el mismo patrón: lo retirado ejecutaba el CUERPO de `run.mjs` con `new Function` sobre el árbol; lo que la casa usa para candar guiones es el **padrón por AST** (`esperas-que-conducen`, `espera-de-fotogramas-con-dueno`, `la-consulta-de-movimiento-tiene-dueno`), y ahí cabe un «padrón de relojes de pared en guiones»: todo callback pasado a `requestAnimationFrame` que DECLARE parámetro, y todo `performance.now()`/`Date.now()` en `qa/guiones/**`, o sale del padrón con motivo o rojo. Censo de hoy: **0** callbacks de `rAF` con parámetro en guiones y `qa/lib` (la sonda de carga lee pared a propósito y vive en `qa/lib/carga.mjs`, fuera del root), y `performance.now`/`Date.now` en cinco guiones (07, 10, 109, 131, 133) que son sujetos legítimos. Una regla de TEXTO sobre `requestAnimationFrame\((\w+) =>` no vale: la vía real de vuelta es `const tick = (t) => …; requestAnimationFrame(tick)`, que es como estaba escrito, y el regex no la ve. Es un test + un JSON de contrato, no cinco líneas: **issue**, no bloqueo. Lo que sí queda hoy: `campos-retirados-no-vuelven` para la vuelta por copy-paste del verbo, y el reproductor manual.

**(2) ¿`SIM_DE_MEDIDA_S = 1,2` con `FRAMES_TOPE = 600` puede quedarse sin medir en verde bajo carga extrema? ¿Qué pasa a `--factor 80`?**
No. Bajo carga cada frame vale COMO MUCHO 0,1 s de sim (tope del loop), así que la ventana se llena antes (13 intervalos + 10 de recorte ≈ 23 frames), nunca más tarde: el tope de 600 solo se alcanza si el sim avanza < 2 ms por frame, o sea un mundo parado. **Medido a `--factor 80`** (1 repetición, 471 s de pared, razón sim/pared **0,156**, frame más largo 23,8 s, «carga REAL»): `93 … ✔ ✔ 0/1 igual-verde` con las cuatro velocidades a 0,000 % y **los mismos metros que a ×40** (5,02 / 10,87 / 7,52 / 16,30 m en 1,200-1,300 s de sim) — la geometría es idéntica porque el tope de 0,1 s la fija. Y si el tope de 600 saltara con Δsim > 0, la medida sería más corta pero seguiría siendo `Δpos/Δsim` exacta: no hay verde por ventana corta. Lo que sí hay, y se anota como observación: `libre` = 30 es el TOPE de sondeo de `rumboLibre`, no el campo real; el trayecto TOTAL a ×40/×80 (ventana interior 1,3 s + 10 muestras de recorte a 0,1 s + la pulsación hasta el `releaseAll`) roza los 30 m esprintando ×1,5. El aserto «cupo en el campo libre» solo mira la ventana interior (16,3 m), que es lo que se mide; si algún día un tile más cerrado deja el jugador contra un muro en la cola no medida, no cambia la velocidad medida. No es hallazgo.

**(3) ¿`Δsim = 0` falla en voz alta con el título delante?**
Sí, medido: `medirVelocidad` insertada ANTES de `comenzar(ctx)` (título abierto) → `✘ ERROR: el mundo no simuló durante la medida (Δsim = 0 s en 590 muestras interiores de 600, con 83.400 m de camino): el reloj de sim solo cuenta lo que el mundo simula, así que esto es el título delante o el driver sin efecto…` → `0 en verde · 1 en rojo de 1`, EXIT 1. Es ROJO y no ⊘: `relojDeSimNoAvanzoEn` reconoce la clase `RelojDeSimNoAvanzo`, no el texto, así que un `Error` plano cae en la rama `fatal` del runner y no puede colarse por el canal «no medido». El tope de 600 frames hizo su trabajo (~10 s y salió). Dato que sale de rebote y vale la pena leer: con el título delante el driver programático SÍ movió al jugador **83,4 m** (es el agujero declarado en `reloj-de-sim.ts`: el paso está gateado por el diálogo y el reloj por el título); el mensaje lo cubre con «el título delante» y además imprime el camino, así que quien lo lea no se confunde. Fuera de esta tanda.

**(4) ¿Queda algún lector de `ctx.tasas`/`magnitudes` en `run.mjs` o en el README?**
No. `git grep -nE '\btasas?\b|magnitud' HEAD -- qa/run.mjs qa/README.md qa/bajo-carga.mjs qa/lib/carga.mjs`: en `run.mjs` **cero**; en los otros tres solo prosa («la magnitud es la razón sim/pared», «una tasa contra la pared… se CURA»), ningún identificador ni ningún cable. El volcado de `CARGA_JSON` emite `{nombre, estado, fallos, motivo, carga}` y `comparaCorridas` no lee otra cosa.

**Mías.** (a) `rs75` en negativo: `firmaDePresupuesto → () => true` pone ROJO el aserto «y aun así NO es atribuible: un contador que sube no lleva firma» (4 fallos de 58); la no-regresión de #496/#497 sigue midiendo. (b) La palabra suelta `comportamiento` sigue en 20 sitios ajenos (tests de core, guiones 53/94, README:921): todos hablan de conducta, ninguno de la categoría — es exactamente por lo que el criterio se decidió por TÉRMINO. (c) Los `assert.match` de las frases del veredicto siguen casando texto LITERAL (`no es atribuible a #545` + `#496/#497`), no `/./`. (d) `TOL_REL` sigue en 0,03 y su docblock dice ahora la verdad: es separación de señal, no presupuesto de error (32 medidas a 0,000 %).

## Hallazgos

**Importante**
- **H-1 · La cura del 93 no tiene candado en `npm test`, y el motivo escrito para no ponerlo no es exacto.** Ver adversarial (1). Qué esperaba el usuario: que lo que se retira no vuelva sin que nada se ponga rojo. Hoy solo lo para el reproductor manual (~25 min) y la regla de reaparición por NOMBRE. Reproducción: restaurar `segSim` a pared en `medirVelocidad` → `npm run verify` verde, `node qa/run.mjs 93` verde; solo `bajo-carga.mjs 93 --factor 40` lo ve. Propuesta: issue con el padrón por AST descrito arriba (0 ocupantes hoy para el `rAF` con parámetro), no prosa. No bloquea: el criterio no lo pedía y el ingeniero lo declaró.

**Menor**
- **H-2 · Import muerto pre-existente en `qa/bajo-carga.mjs:134`** (`razonDeLaMedida`, sin uso; `eslint` no mira `qa/`). Viene de `main`, el ingeniero lo señaló y no lo tocó; se confirma. Issue de una línea o arreglo en la siguiente tanda que toque el fichero.
- **H-3 · Cifras del informe que no casan con el árbol**: `implementacion.md` dice que `carga-sintetica.test.ts` queda en 56 `it`; son **58** (contados con `node --test`). Sin efecto: el fichero no se commitea.

## Workarounds usados y su veredicto

- **Árbol base para el «antes»**: `git checkout 39421b12 -- qa nefan-core/test/carga-sintetica.test.ts nefan-core/data/contract/arch-rules.json` (todo el diff de la tanda, porque el 93 viejo llama a `ctx.expectTasa` y no corre sobre el `run.mjs` nuevo), y vuelta con `git checkout HEAD -- …`. No afecta al usuario: es la forma de tener las dos mitades del par en la misma máquina y por el mismo camino.
- **Tres sabotajes temporales** (denominador a pared; términos en un comentario del 92; `medirVelocidad` antes de `comenzar`; `firmaDePresupuesto → true`), cada uno restaurado y comprobado (`md5sum -c` / `git status` limpio). Son negativos, no pasos para ver la feature.
- **Ninguno para observar la feature**: el 93 se ve verde por su camino normal desde el título.

## No probado

- **La firma `sin-firma` sobre el rojo REAL del 75 a ×20** (lo pedía el plan §7 a QA): corrido una vez, `75 … ✔ ✔ 0/1 igual-verde` con razón 0,313 y carga REAL — el rojo del 75 es probabilístico y esta vez no salió, así que el clasificador no llegó a clasificar nada en vivo. Queda cubierto por el unitario `rs75` (probado en negativo); el 75 no lo toca esta tanda.
- **Gasto real de créditos**: no aplica (motor falso; el reproductor imprime el guardarraíl).
- **Reproducibilidad estadística de «aguanta»**: 3 + 1 muestras verdes bajo carga no son «aguanta» (lo dice el propio reproductor). Aquí el argumento es más fuerte que la frecuencia —el numerador y el denominador salen bit a bit iguales en 16 medidas frenadas— pero se declara igual.

## Guion ejecutable

No se añade guion nuevo. Lo mecánico de esta tanda ya tiene dueño ejecutable: la exactitud
`Δpos/Δsim` la afirma el propio 93 (`node qa/run.mjs 93`, con el error relativo en el `ctx.log` de
cada velocidad), el par bajo carga es `node qa/bajo-carga.mjs 93 --factor 40 --repeticiones 3`, y la
reaparición de los nombres la canda `campos-retirados-no-vuelven` en `npm test`. Lo que falta de
candado es H-1, y es un test de `nefan-core/test`, no un guion de navegador.

## Veredicto

**Apto.** Los cinco criterios del crítico se cumplen y están medidos en esta máquina: el par
`3/3 se-rompio` → `0/3 igual-verde` con carga real en las dos mitades, el negativo quirúrgico devuelve
el rojo con el numerador intacto, el grep por término está a cero, el candado de reaparición y el
`rs75` se ponen rojos al sabotearlos, `verify` 3194/3194, y la desviación (ventana en segundos de
sim) es la mitad de la cura que faltaba, no una desviación de alcance — a ×80 la geometría es la misma
que a ×40. H-1 va a issue con la corrección de su motivo; no bloquea.
