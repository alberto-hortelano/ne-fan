# QA — tanda AO (#711): el reloj de pared tiene padrón

Rama `feature/tanda-ao` (`6518667c`), worktree `/home/al/code/ne-fan-tanda-ao`. Sin navegador: el sujeto es un candado de `npm test`, y así se ha probado. Logs de cada corrida en el scratchpad de la sesión (`qa-ao/01…11`).

## Criterios → veredicto

| Criterio | Veredicto | Evidencia |
|---|---|---|
| C1. Candado en `npm test`, por el árbol, sobre `fuentesDelBanco`, con padrón `data/contract/*.json` y motivo | ✅ cumple | `test/el-reloj-de-pared-tiene-padron.test.ts` entra por el glob `test/*.test.ts` (`package.json:30`); usa `fuentesDelBanco(QA)` (línea 80) y `ts.createSourceFile` (`relojes-de-pared.ts`). `npm test` limpio: `3330/3330`, exit 0 (log 04). Un `Date.now();` añadido al 109 sin declararlo → rojo nombrando `109-…: 1 relojes de pared contra 0 declarados (372:Date.now)` (log 09, N3). Una cifra mal en el padrón (157: 2→3) → rojo `2 relojes de pared contra 3 declarados` (log 11, N5). |
| C2. Devolver el denominador de `medirVelocidad` del 93 a la pared → rojo en `npm test` | ✅ cumple | Mutación real sobre disco (`const tick = (t) =>` + `out.push([t / 1000, …])`), `npm test` ENTERO: exit 1, `pass 3324 / fail 6`, el primero `93-…: 2 relojes de pared contra 0 declarados (295:raf-param, 297:raf-param)` (log 07, N1). Revertido. Y el negativo EN MEMORIA no pasa mudo: con el ancla `const tick = () => {` duplicada en el 93 (un comentario con ese texto), el `it` sale rojo diciendo `aparece 2 veces … el negativo ya no muta lo que cree` (log 08, N2); con las dos anclas a 0 veces también (log 10). |
| C3. `_lo_que_esto_NO_sujeta` medido, cada punto con su `it` | ✅ cumple, con reservas (H-1, H-2, H-3) | Siete puntos, siete `it` «LÍMITE MEDIDO», todos verdes en limpio (log 01: `22/22`). El ingeniero probó en negativo la cifra del (1) (27→26, rojo). Las reservas: hay formas de leer la pared que **ni ve ni declara** — abajo. |
| C4. Cifras de hoy medidas hoy | ✅ cumple | Censo reproducido con el detector desde un script propio (log 02 + `censo.ts`): guiones 07·2, 10·4, 131·2, 133·3, 157·2, 164·2 = 15 en 6, 0 `raf-param`, 109 = 0; `qa/lib` 27 en 6; resto de `qa/` 59 en 18. Coincide con el crítico y con el `it` «censo de hoy». Los `porque` de 07 (el `t` de `peticiones.push` no lo lee ningún aserto: `grep` a cero fuera de 57/59) y de 10 (`t0`, `llegada` y `ms` de un bucle por `setTimeout(tick, 16)` que cuenta muestras, no cronometra) casan con el código. |
| C5. Import muerto `razonDeLaMedida` retirado de `qa/bajo-carga.mjs` | ✅ cumple | `grep -c razonDeLaMedida qa/bajo-carga.mjs` → `0`; `node qa/bajo-carga.mjs` arranca y se niega por falta de guion con su mensaje de uso (exit 2, no revienta al importar). |
| Global: `typecheck:tests`, `lint` | ✅ | exit 0 los dos (logs 05, 06). `npm run verify` completo lo corrió el ingeniero; aquí se repitieron las partes que tocan al test nuevo. |

## Hallazgos

### H-1 (importante) — la regresión del 93 escrita con el idioma de la casa `requestAnimationFrame(resolve)` queda VERDE, y no está declarada

`await new Promise((r) => requestAnimationFrame(r))` resuelve la promesa **con el timestamp de pared**: `r` es un callback con un parámetro, pero es parámetro del ejecutor de `new Promise` y `resuelve()` se para en los parámetros (punto (3) del padrón, «el callback que llega por parámetro»). El punto (3) habla del callback que viene «de FUERA del fichero o de la función»; aquí el valor no viene de fuera: lo pone el rAF, y es exactamente el reloj que el 93 tiene prohibido.

Es idioma vivo del banco («esperar dos fotogramas»): `qa/guiones/137:31`, `qa/lib/sesion.mjs:293`, `qa/fixtures-sin-bridge.mjs:166`, `qa/capturar-portadas.mjs:193`. Hoy los cuatro descartan el valor, así que 0 ocupantes; pero es la primera forma en que alguien reescribiría `medirVelocidad` sin `t` en el `tick`.

Reproducción (log 10, N4): en el 93 REAL se sustituyó el `tick` por `const tick = async () => { const p = …pos; const t = await new Promise((r) => requestAnimationFrame(r)); out.push([t / 1000, p.x, p.z]); …; else tick(); }`. Resultado: **«todo reloj de pared de un guion está declarado con su cuenta EXACTA» ✔ verde**; los únicos rojos son los dos `it` del negativo porque sus anclas ya no están (0 veces) — y eso se «arregla» re-anclando, con la pared dentro. Sintético equivalente (log 03, G2): `const t = await new Promise((r) => requestAnimationFrame(r)); … d / (t2 - t)` → 0 relojes.

Qué espera el usuario: o bien el detector ve el resolver (`arg` identificador que resuelve al PRIMER parámetro de la función pasada a `new Promise(...)`, y entonces 137 y `lib/sesion` pasan a ocupantes que se declaran como «se descarta el valor»), o bien un punto (8) en `_lo_que_esto_NO_sujeta` con su `it` LÍMITE MEDIDO que afirme la cifra de hoy (1 en guiones, 137) y cite que la regresión del 93 así escrita sale verde. Lo segundo cumple el criterio 3 tal como está redactado; lo primero cierra el hueco. Cualquiera de las dos vale; **lo que no vale es que no figure**.

### H-2 (importante) — el temporizador como reloj: `setTimeout`/`waitForTimeout`/contar frames

Una velocidad escrita como `p0 = pos(); await sleep(2000); v = (pos() - p0) / 2` mide contra la pared sin leer ningún reloj, y el detector da 0 (log 03, A1–A4: `setTimeout`, `page.waitForTimeout`, `setInterval` a 16 ms, contar 120 frames como 2 s). Es la segunda reescritura obvia del 93 y no está en `_lo_que_esto_NO_sujeta`. Seis guiones usan temporizadores hoy (`grep -l setTimeout|waitForTimeout|dormir|sleep qa/guiones` → 6), así que el punto tiene cifra que medir. Falta el punto y su `it`.

### H-3 (menor) — grafías que cuentan 0 sin declararse (0 ocupantes hoy)

Del log 03: `page.evaluate("performance.now()")` y `evaluate(\`…\`)` (código en string; hoy 0 usos en `qa/`), `new Function("return Date.now()")`, `globalThis["Date"].now()` y `window.window.performance.now()` (`esGlobal` solo desenvuelve UN prefijo por identificador), `performance.mark/measure/getEntries`, `process.uptime()`, `console.time/timeEnd`, `Temporal.Now`; y para el callback del rAF: método de objeto del mismo fichero (`requestAnimationFrame(o.tick)` con `o = { tick(t) {} }`), `.bind`, ternario y destructuring (`const [tick] = […]`). Se declaran de una vez en los puntos (3) y (5) con un `it` en lote, o se quedan como están si el coordinador acepta que «la lista no se presume cerrada» cubre lo de 0 ocupantes. Lo que SÍ ve, comprobado además de lo que dice el test: `Date?.now()`, `performance.now?.()`, `async (t) =>`, `(t = 0) =>`, `(...a) =>`, y la declaración DESPUÉS de la llamada (`function` y `const`).

### H-4 (desviación del plan, recomendación pedida) — la cifra EXACTA del resto de `qa/` (59 en 18) no mide nada con sentido

Medido: en 30 días nacieron **39 scripts en la raíz de `qa/`**, y 18 de los 42 vivos leen la pared (43 %); de los 59 relojes, **57 son `Date.now`** en pares de plazo (`t0`/`Date.now() - t0 > tope`) y **0 son `raf-param`** (log 02). O sea: cada segundo script nuevo de la raíz pone rojo el `it` (1), y ese rojo dice «expected 59, actual 61» en un test titulado «qa/lib queda fuera», sin `porque`, sin fichero y sin decisión que tomar: se sube el número y se sigue. Eso es ritual, no medida. Lo que sí mide el (1) es `qa/lib` (27 en 6): es el punto ciego NOMBRADO (si `medirVelocidad` se muda a un helper), el conjunto es pequeño y estable (7 ficheros de lib en 30 días), y además tiene el aserto que importa aparte (`carga.mjs` con exactamente 2 `raf-param`).

Recomendación: mantener `{27, 6}` para `qa/lib` y, para el resto de `qa/`, sustituir `{59, 18}` por lo que de verdad vigila la forma del 93: **`raf-param` fuera de `qa/guiones/` === 2 y los dos en `qa/lib/carga.mjs`** (hoy cierto; un script de la raíz que abra página y divida por el timestamp del rAF lo pondría rojo) más `relojes > 0`; la cifra 59/18 va a la prosa del punto (1) con su fecha. Así el (1) sigue siendo LÍMITE MEDIDO y deja de sonar con cada `Date.now()` de plazo. Si el coordinador prefiere la cifra exacta por costumbre de la casa, que sea consciente del roce medido: ~1 rojo cada 2 scripts nuevos de la raíz.

### Vecinos anotados (no son de esta tanda)

- El sello `t: Date.now()` del 07 es un reloj muerto (ya en la implementación como issue 3).
- Las anclas del negativo son, de rebote, una segunda defensa: quien reescriba el `tick` del 93 verá rojo por «ancla 0 veces» antes que por el padrón. No es un candado (se re-ancla y en paz), pero conviene que el `porque` del rojo lo diga: hoy dice «el negativo ya no muta lo que cree», que es correcto y no invita a mirar si la reescritura devolvió la pared.

## Workarounds usados

Ninguno sobre el producto. Las mutaciones sobre disco (N1–N5) son sabotajes deliberados, revertidos con `git checkout --` uno a uno; `git status` limpio al acabar (solo la carpeta `docs/agents/…` sin trackear). El censo y la batería adversarial son scripts propios en el scratchpad que importan el detector tal cual, sin tocarlo.

## Guion 169

No se produce. Lo mecánico de esta tanda ya vive como `it` dentro de `npm test` (la regresión del 93 en memoria, con anclas que no pueden pasar mudas, comprobado en N2), y un guion en `qa/` que repitiera N1–N5 sobre disco duplicaría el candado con más superficie de anclas. Lo que falta (H-1, H-2) es un límite declarado y medido dentro del mismo test, que es donde la casa los tiene, no un guion aparte.

## No probado

- El reproductor `bajo-carga.mjs 93 --factor 40` (~20 min): no aporta a esta tanda; la cura del 93 la demostró la tanda W y aquí el sujeto es el candado estático.
- CI en el runner: la rama no está subida; lo cierra el hook `ci-verde` al abrir la PR.

## Veredicto

**Apto con reservas.** Los cinco criterios se cumplen con salida real y el negativo del 93 es rojo en `npm test` entero y no puede pasar mudo. Las reservas son dos huecos SIN DECLARAR por los que la misma regresión entra verde (H-1 `rAF(resolve)`, probado sobre el 93 real; H-2 temporizadores) — el criterio 3 exige que cada límite conocido esté escrito y medido, y estos dos son los más probables. Se cierran con dos puntos y dos `it` (o cerrando H-1 en el detector), sin tocar el diseño. H-4 es una recomendación sobre una desviación del plan, no un fallo.

---

# Vuelta 2 (2026-09-24) — sobre `ddce7349`, rebasada sobre `main`

Solo los puntos corregidos más la pasada adversarial nueva sobre «cuenta solo si se usa el valor». Logs `v2-01…06` en el scratchpad.

| Punto | Veredicto | Evidencia |
|---|---|---|
| H-1 cerrado: el resolver de `new Promise` pasado a rAF y `new Promise(requestAnimationFrame)` cuentan cuando el valor se usa | ✅ | Regresión `rAF(resolve)` aplicada al 93 REAL en disco (tres anclas del `it` nuevo): «todo reloj de pared … cuenta EXACTA» ✖, `fail 7` (log v2-03). Revertido. En memoria, el `it` de la línea 203 verde con las anclas a `veces === 1`. `asentarElLayout` (`lib/sesion.mjs:293`) cuenta 1 porque su promesa se DEVUELVE — sobrecuenta en la dirección segura y está declarada en el (1). |
| H-2: límite (8) medido, 3 guiones (10, 19, 90) | ✅ | Mi cifra de 6 era de `grep`: 115 y 123 nombran `setTimeout` en un COMENTARIO y 152 dentro de un STRING. Por el árbol son 3, y el `it` lo afirma con lista, no con número. |
| H-3: límite (9) en bloque | ✅ | Nueve grafías en un bucle con `assert.equal(cuenta(f), 0, f)` + `stringsConReloj` sobre los guiones = `[]`. |
| H-4 aplicado | ✅ | `qa/lib` `{28, 6}` (subió 1 con `asentarElLayout`, correcto); `raf-param` fuera de guiones = `carga×2 + sesion×1` por FICHERO; resto de `qa/` solo `> 0`, con el 59/18 en prosa con fecha. |
| Censo tras la rebase: 17 relojes en 7 guiones (entra el 166 con 2 `Date.now`) | ✅ | `it` «censo de hoy» verde; padrón con 7 entradas. |
| Global | ✅ | `npm test` entero limpio `3358/3358` exit 0 (log v2-04); `typecheck:tests` y `lint` exit 0. |

## Pasada adversarial: ¿se puede USAR el valor y contar 0?

Batería de 23 formas (log v2-02). La regla aguanta en todas las formas directas: asignación, `return`, `.then`, `Promise.all`, ternario, `function` como ejecutor, parámetro con valor por defecto, `evaluate` con `return` en bloque, helper en variable (`const frame = () => new Promise(…)`) → 1; sentencia, `void`, `await page.evaluate(() => …)` tirado → 0. Sobrecuenta en la dirección segura cuando la promesa se asigna y luego se tira.

Sí se puede usar el valor y contar 0, cuatro formas, **ninguna con ocupante hoy** (`withResolvers` a 0 en `qa/`):

- **V-1 (menor, sin declarar):** `const { promise, resolve } = Promise.withResolvers(); requestAnimationFrame(resolve); const t = await promise;` → 0. Idioma moderno (Node 22 / Chrome 119); la desestructuración no se resuelve.
- **V-2 (menor, sin declarar):** `(0, requestAnimationFrame)(r)` → 0 (la coma no se desenvuelve).
- **V-3 (menor, cubierto por el (3) en espíritu, no por su texto):** el alias del resolver DENTRO del ejecutor, `new Promise((r) => { const f = r; requestAnimationFrame(f); })` con la promesa asignada → 0. El (3) habla del callback «asignado después»; aquí es `const f = r` con inicializador que no es función.
- **V-4 (menor, y el comentario del test es FALSO):** `const t = await new Promise((_, rej) => requestAnimationFrame(rej)).catch((t) => t)` → 0. El `it` de la línea 238 afirma que el SEGUNDO parámetro «no es el timestamp»; sí lo es: rAF llama `rej(timestamp)` y la promesa rechaza CON la pared, que `.catch` lee. El aserto (0) es aceptable como límite; la frase no, porque documenta una razón inventada. Que diga «no se resuelve el reject» y entre en el (9).

Qué espera el usuario: V-1, V-2 y V-4 en la prosa del (9) con sus tres líneas en el bucle del `it`, y la frase de la 238 corregida. No cambia el diseño ni la cuenta de hoy.

## Veredicto de la vuelta 2

**Apto.** Los cuatro hallazgos están cerrados con salida real y el negativo que los motivó (la regresión del 93 por `rAF(resolve)`) es rojo en disco y en memoria. Lo que queda (V-1…V-4) son grafías sin ocupante que van al (9) en una línea cada una; V-4 incluye una frase falsa en un comentario que conviene corregir antes de fusionar, pero no bloquea.
