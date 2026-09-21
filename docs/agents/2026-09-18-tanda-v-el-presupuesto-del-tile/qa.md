# QA — Tanda V (#677 + #687): el presupuesto del tile

Validado el 2026-09-20 sobre `feature/tanda-v-el-presupuesto-del-tile` = `df713d47` (base `a25d8c2f`;
`main` ya va cuatro commits por delante, entre ellos la renumeración de la tanda U — el `152`/`153`
se renumeran al fusionar, #680). Máquina con `load` 2,5–7 durante casi toda la sesión (otras
tandas paradas); todo con el motor falso, cero créditos; nunca `pkill` ni `--parar-todo`; el stack
lo levantó y paró `qa/run.mjs` en cada corrida (comprobado al final: ningún puerto ni proceso de
este árbol en pie). Cada sabotaje restaurado con `git checkout` y comprobado con `md5sum -c` contra
la línea base tomada antes de empezar.

**Cómo leer el reencuadre.** El criterio 1 pide una MEDIDA como suelo, no como fuente del número;
el 2 pide UN cortafuegos decidido por el coste del cuelgue, censado por el árbol. Se validan tal
como quedaron tras el crítico, no como decía el issue.

## Criterios → veredicto → evidencia

| # | Criterio (literal del reencuadre) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Medida con motor falso, N ≥ 30, p50/p95/máx, reproducible en `qa/`, escrita como SUELO | ✅ cumple | Guion `152` ×3 seguidas (`node qa/run.mjs el-tile-del-falso`, load 3,8 / 5,2 / 7,0): **#1 p50 167 · p95 205 · máx 248 ms (439×)** · **#2 p50 160 · p95 195 · máx 206 ms (461×)** · **#3 p50 158 · p95 181 · máx 440 ms (496×)**; N = 32/32 `llegado`, `/generate_scene` +32 exacto las tres veces, 12–13 s de corrida entera. Cabecera, README y docblock de `MS_DEL_TILE` lo escriben como suelo y declaran fuera CI y motor real. **Negativo**: `TILE_DELAY_MS=12000 node qa/run.mjs el-tile-del-falso` → p50 12 143 · p95 12 261 · máx 12 269 ms, 7,3×; **rojo SOLO** «el cortafuegos está al menos a 10× del p95» (`12261 × 10 = 122609 contra 90000`), los otros dos asertos verdes (32 llegados, +32 del motor); 395 s de corrida, exit 1 |
| 2 | UN cortafuegos para las once esperas, decidido por el coste del cuelgue y escrito; censo por el árbol | ✅ cumple | Censo en la base `a25d8c2f` por `git show`: 05:255 `180_000` · 42:210 `180_000` · 63:134 `60_000` · 08:106, 09:92, 15:393, 74:139, 75:235, 144:164 `240_000` · 120/127 vía `MS_DEL_TILE` en `sesion.mjs:621` = 60×1 · 90×2 · 180×2 · 240×6. Ahora: los nueve presupuestan con el identificador (líneas 05:256, 42:211, 63:135, 08:107, 09:94, 15:394, 74:140, 75:236, 144:165), los dos heredan el default, una sola declaración (`tile-episodio.mjs:116 = 90_000`). La aritmética del CUELGUE está junto a la constante (esperas por guion × 90 s, antes/ahora, quién para por `viaje.error` y quién no, por qué 90 y no 60). Candado `el-cortafuegos-del-tile-tiene-dueno.test.ts` 10/10 y **tres sabotajes del padrón rojos**: `240_000` en el 08 → ✘ (a) «presupuesta con `240_000`»; `const MS_DEL_TILE = 240_000` local en el 08 → ✘ «se declara UNA vez» + ✘ (b) «DECLARACIÓN local»; `{ ms: 240_000 }` en el 120:281 → ✘ (c). Los literales `60_000`/`180_000` que quedan en esos ficheros (08:79 acuse del viaje, 63:114/168, 15:300 skin, 42:165/396/433/443 enemigo/reanudar, 74:194 acuse) NO son tiles: leídos uno a uno |
| 3 | H-3: una sola precedencia, en un solo sitio, usada por las dos mitades; la mitad que PARA con quien la mida | ✅ cumple | `sondaDeTile` devuelve la lectura cruda (sin `estado`), `veredictoDeTile` es la única precedencia; `tile-episodio.test.ts` 45/45 la ejecuta **serializada** (`new Function("window","k",…)`). Sabotajes: sonda sin `rechazos` → **1 rojo exacto** («rechazado: sonda ≠ null ⇔ veredicto ∉ {callado, descartado}»), 44 verdes; sonda con `estado: LLEGADO` → 6 rojos con `ReferenceError: LLEGADO is not defined` (lo mismo que haría Playwright). **En navegador**: `reason:"nope"` en el frame → dos ✘ «el BRIDGE RECHAZÓ el frame por unicast … la espera paró sola (no expiró)» y **el 120 SIGUE** hasta su bloque 6 (9 s de corrida). Ver «Hallazgos» H-1 sobre el límite de lo que ese test canda |
| 4 | H-4: decidido (¿aborta o acaba?), escrito junto a `ctx.absorbe`, candado si es mecánico | ✅ cumple | `laExpiracionAborta` + `throw` tras el `ctx.expect` en `sesion.mjs:746-755`, motivo del `absorbe` reescrito. **Medido**: `handleRequestTile` con `if (msg) return;` → el 127 sale en **98 s** con UN ✘ («la espera expiró a los 90000 ms … NO HAY CONSTANCIA») + UN `✘ ERROR: el tile tile_-1_-1 agotó MS_DEL_TILE (90000 ms) y el guion ABORTA…`, E0/E1 verdes y nada después; el «antes» de 650 s con 7 ✘ lo midió el ingeniero (no lo repetí: son 11 min para confirmar 7 × 90). Unit: `laExpiracionAborta` → `false` → 1 rojo («verdadera SOLO cuando la espera expiró»). El cable helper↔módulo lo canda desde hoy el guion **153** (abajo) |
| 5 | H-5: el `?? []` desaparece o falla en voz alta en el momento en que el hook no publica `tiles` | ✅ cumple (con el límite declarado, confirmado) | `grep "tiles ??" qa/lib/sesion.mjs` = 0. Hook sin getter `tiles` → el 120 muere en **7 s** con `✘ ERROR: lectura del tile: \`__nefan.tiles\` tiene que ser un array y llegó undefined…` ANTES de abrir la espera (con dos esperas, si saliera del veredicto costaría ≥ 90 s). **A mitad de espera** (getter que devuelve `undefined` desde la 2.ª lectura: el preflight pasa, la sonda rompe): **98 s** y el MISMO `TypeError` desde el veredicto — lo que el ingeniero declaró («90 s tarde») es exactamente lo que pasa; no se disfraza de «callado». Ver H-2 |
| 6 | Batería aislada y en par de los guiones tocados, tres corridas | ✅ cumple | **Aislados ×1** (los once tocados, `node qa/run.mjs <nombre>`, load 2,4–3,8): 05 · 08 · 09 · 15 · 42 · 63 · 74 · 75 · 144 · 120 · 127 → **11/11 verde, 0 ✘, 0 ⊘** (6–17 s cada uno; el 75 no parpadeó). **Par 119→120 ×3**: 3/3 «2 en verde · 0 en rojo» (53 / 36 / 38 s), ningún `timeout esperando: el título…` ni `page.click: Timeout` en los tres logs. **152 ×3** en la fila 1. El ingeniero ya corrió el conjunto de los doce ×3 y los aislados ×3; yo no repetí el ×3 de cada aislado: con 11 aislados verdes, el par crítico 3/3 y el 127 3/3 bajo carga la cifra que faltaba era la del parpadeo del 120, y no reapareció |
| — | H-7 se cierra sin trabajo | ✅ | El recibo vive en `docs/agents/2026-09-18-el-reloj-del-banco/implementacion-656.md` (gitignored), que reconoce el md5 intermedio en su §H-7. Nada en el árbol |
| — | Reparto con AF: el 63 solo cambia la línea del presupuesto; `pedirTile` intacto | ✅ | `git diff a25d8c2f -- qa/guiones/63-*` = import + `60_000 → MS_DEL_TILE` (3 líneas); `pedirTile` sin tocar |
| — | Fuera del sujeto (115:175, `regenerarMundo`/`curarMundo`) se dejan y se dice | ✅ | `115:175 { ms: 240_000 }` y `sesion.mjs:507/:549 240_000` intactos; dicho en el docblock de la constante y en el `_comment` del padrón |

## Lo adversarial que pidió el coordinador

| Pregunta | Resultado |
|---|---|
| ¿El padrón ve una espera de tile NUEVA con literal? | **No, y está medido dos veces**: el caso «el agujero DECLARADO» del test, y en vivo: un `qa/guiones/999-de-mentira-qa.mjs` con `ctx.waitFor("el tile vecino llega…", …, 240_000)` → **10/10 verde**. Declarado en `_lo_que_esto_NO_sujeta[0]`. Ver H-3 (hay tres esperas de viaje del mismo sujeto ya en el árbol que el censo no incluye) |
| ¿Un presupuesto derivado `MS_DEL_TILE * 2`? | Directo en el `08` → ✘ (a) «presupuesta con `MS_DEL_TILE * 2`». Por alias en el `08` (`const doble = MS_DEL_TILE * 2; waitFor(…, doble)`) → ✘ (a) «presupuesta con `doble`» **y** ✘ (b) «lo compara sin estar en `lectores`». **Dentro de un `lector` declarado** el alias derivado pasa **verde** (ver H-4): (b) lo clasifica `comparacion`, que en un lector es legítimo, y (a) no lo ve porque no está en el padrón |
| ¿Qué pasa si el hook pierde `tiles` a MITAD de la espera? | 98 s y `TypeError` con el nombre del registro (criterio 5). Coste 90 s, veredicto honesto. Declarado en código, informe y test |
| ¿El 90 s aguanta con carga (~15) en el 127 tres veces seguidas? | **Sí, 3/3 verde**: 12 bucles `nice 19` durante 45 s antes y toda la corrida (load **19,1 / 20,0 / 20,9**), `node qa/run.mjs 127-el-anillo` ×3 → 34 / 30 / 31 s (17 s en reposo), 0 ✘, 0 ⊘, ninguna expiración. El 152 se corrió a load 3,8–7 (no bajo el dial: su cabecera lo excluye) |
| El 120 parpadea en el título (2/3 del ingeniero): ¿es de esta tanda? | **Confirmo que NO es de esta tanda**: (1) `git diff -U0 a25d8c2f -- qa/guiones/120-*` filtrando líneas de docblock sale **vacío** (idem el 127); (2) 1 aislado + 3 pares + los 3 conjuntos del ingeniero = 7 corridas mías/suyas del 120 sin muerte en el título hoy con load 2,5–5; (3) la firma del ingeniero —`timeout esperando: el título está en pantalla` y `page.click: Timeout 30000ms` tras la pre-generación de 9 escenas, en `esperarTituloListo`— es literalmente la de **#673** («el rojo cae siempre en `page.click("#ts-new")`, en el TÍTULO, tras la pre-generación de las 9 escenas», familia #496/#659: una página que recibe algo de una sesión que no es la suya), issue ABIERTO. Sus 3 de 9 fueron a load 11–19 con once tandas: reproducir el flake exigiría esa carga y no es de este diff. Se anota en #673 como dato (guion 120, 3/9, load 11–19), no como hallazgo de V |

## Hallazgos

Ningún bloqueante. Todo lo que sigue es deuda del BANCO (nada de esto lo ve quien juega).

**H-1 · importante — el test de equivalencia de H-3 no distingue «sin precedencia» de «con la precedencia de siempre».** Sabotaje adversarial: reescribí `sondaDeTile` con la precedencia vieja (llegado > fallo > rechazado, devolviendo en cada rama solo la señal ganadora: `{tiles, episodio: null, rechazos: []}`, …) → **45/45 verde**. La regla que canda el test es `sonda ≠ null ⇔ veredicto ∉ {callado, descartado}`, y cualquier precedencia cumple esa bicondicional, porque solo mira SI para, no CON QUÉ. El único aserto que mira el contenido («devuelve la LECTURA cruda… sin `estado`») comprueba las claves, no que sean las lecturas completas. Hoy es inocuo por la misma razón que lo era el defecto original —`parada` solo se compara con `null` y el veredicto relee todo desde la página—, pero el criterio 3 dice «una sola precedencia», y el candado que lo sujeta admite dos. Qué pediría: que el test afirme también que lo devuelto es IGUAL a la lectura (`tiles`/`episodio`/`rechazos` del `window` de mentira, `deepEqual`), que es lo que una sonda sin precedencia no puede falsear. Repro: `python3` sobre `qa/lib/tile-episodio.mjs` sustituyendo el `if` compuesto por tres `if` en cascada; `npx tsx --test test/tile-episodio.test.ts` → 45/45.

**H-2 · menor — H-5 a mitad de espera cuesta 90 s y lo dice el veredicto, no la sonda.** Medido (98 s, `TypeError` correcto). Está declarado en tres sitios; lo apunto porque `waitFor` ya tiene la cifra que lo distinguiría (`rotos === muestras`) y no la usa para cortar. Es «otro sujeto», como dice el informe; issue del banco, no de esta tanda.

**H-3 · menor — el censo de «once» es el del padrón, no el del árbol: hay tres esperas más del mismo sujeto con literal.** `49:147` («el jugador llega al destino (otro tile)», `180_000`), `60:213` (idem, `180_000`) y `65:115` («el jugador llega a «X» (otro tile que Y)», `180_000`): las tres son un viaje por «Salidas» con `currentTile !== t`, o sea el BRIDGE generando el destino —el mismo predicado que 09/74/75/144 y el mismo `runTileGeneration`—. Las tres van dentro de `absorbe`/`sinMedir`, así que su coste de cuelgue es 180 s cada una y no ponen rojo nada; pero el criterio 2 dice «UN cortafuegos para las esperas del sujeto tile del bridge», y el crítico y el plan censaron por número de literal (`240_000|180_000`) filtrando los guiones del issue, no el árbol entero. Es exactamente el agujero declarado (`_lo_que_esto_NO_sujeta[0]`) con tres sujetos ya vivos. No es regresión de V; pido decidir a propósito: o entran al padrón con `MS_DEL_TILE` (tres líneas y tres entradas) o se dice en el `_comment` por qué se quedan a 180 (el 49:164 «vuelve al tile de partida» es de la misma familia).

**H-4 · menor — dentro de un `lector` declarado, el presupuesto derivado por alias pasa verde.** Guion de mentira registrado en `lectores` con `const doble = MS_DEL_TILE * 2; ctx.waitFor("el tile vecino…", fn, doble, k)` → 10/10 verde: (b) lo clasifica `comparacion` (legítimo en un lector) y (a) no lo ve. Hoy el único lector es el 152 y no lo hace. El informe presenta el «por RANGO» como cierre del agujero del derivado; lo cierra para la forma directa y para los no-lectores, no para un lector. Cabe declararlo en `_lo_que_esto_NO_sujeta` o exigir a los lectores que no tengan `waitFor`/`holdUntil` con presupuesto que no sea la constante.

**H-5 · menor — dos frases de prosa que ya no casan con lo medido.** (a) Cabecera del 127 y README: «98 s de corrida entera» aparece atribuido a una corrida del 127 con «UNA espera y no dos» — el de dos esperas es el 120; el 127 tiene siete (yo medí 98 s en el 127 y el ingeniero 99/98 en los dos, así que el número está bien y el texto mezcla los guiones). (b) `_lo_que_esto_NO_sujeta[1]`: «el guion 152 solo acota por abajo» y dice que un `valor_ms` de 900 000 pasaría — cierto; pero conviene añadir que el test de declaración compara el VALOR con formato `90_000` (`toLocaleString` + `_`): escribir `90000` en el fuente da rojo con «vale lo que dice», que es un falso rojo cosmético.

**H-6 · menor — la rama necesita rebase antes de la PR.** `main` va cuatro commits por delante (`243fcf9f`), incluida la renumeración de la tanda U (el `126`/`150`/`151` ya existen allí) y el padrón de sondas #698 que toca `sondas-de-movimiento.json` y `la-consulta-de-movimiento-tiene-dueno.test.ts`; el `git diff main` de este árbol enseña ese ruido. El 152 → 157 (y el 153 de QA → el siguiente libre) al fusionar, como está previsto.

## Guion que deja QA

`qa/guiones/153-la-espera-del-tile-esta-cableada-al-modulo-puro.mjs` (headless, `sinNavegador`;
entra solo en `candados-headless` porque el job corre la clase entera con `--sin-navegador`; fila
añadida en `qa/README.md`; 0,2 s). Lee el ÁRBOL de `qa/lib/sesion.mjs` y exige el CABLE entre
`pedirYEsperarTile` y el módulo puro, que ningún test de core mira: (1) los tres nombres y la
constante vienen importados de `./tile-episodio.mjs`; (2) `exigeLecturaDeTile(...)` va ANTES de
`ctx.absorbe(...)`; (3) la sonda del `ctx.waitFor` es el identificador `sondaDeTile`; (4) hay un
`if (laExpiracionAborta(…))` que LANZA y va después del `ctx.expect`; (5) no queda `hook.tiles ?? …`.
Positivo: 6/6 ✔. **Negativos** (cada uno restaurado, md5 OK): preflight debajo del `absorbe` → ✘ solo el 2 («preflight en línea 742 · absorbe en línea 717»); sonda inline → ✘ solo el 3; `if`/`throw` quitados → ✘ solo el 4 («aborto en línea —»); `window.__nefan.tiles ?? []` → ✘ solo el 5 («línea 696»). Cuatro sabotajes, cuatro rojos distintos, uno cada vez. Los candados que
censan `qa/guiones` (`candados-headless-totalidad`, `el-banco-declara-el-modo-de-gasto`,
`esperas-que-conducen`, `el-cortafuegos-del-tile-tiene-dueno`) siguen verdes con él: 39/39.

## Workarounds usados durante la prueba

- Sabotajes de fuente (bridge `tile.ts`, hook `nefan-hook.ts`, `sesion.mjs`, `tile-episodio.mjs`,
  guiones 08/120, padrón) para provocar los rojos: son el método de negativo, no un obstáculo del
  usuario; todos restaurados y comprobados con `md5sum -c`, `git status` limpio salvo el guion 153
  y su fila del README.
- Un guion de mentira `999-…` en `qa/guiones/` y una entrada de mentira en `lectores` para medir
  los dos agujeros del padrón; borrados los dos.
- Carga sintética para el 127 (12 bucles `nice 19`), retirada al terminar.
- Ninguno para observar la feature en el flujo normal: los guiones se corren tal cual con
  `node qa/run.mjs <nombre>`.

## No probado

- El «antes» de H-4 (650 s, 7 ✘) — lo midió el ingeniero; yo medí solo el «ahora» (98 s).
- El motor REAL y CI: fuera por decisión escrita (créditos; sin runner de navegador).
- `npm run verify` completo: corrí los cuatro tests de core que censan `qa/` y los dos de la tanda
  (55/55 + 39/39); el ingeniero reporta 3146/3146.
- Que el CI de la PR salga verde tras el rebase sobre `main` (cuatro commits por delante, con la
  renumeración de guiones de la tanda U y el padrón de sondas #698): no hay PR abierta todavía.

## Veredicto

**Apto con reservas.** Los seis criterios se cumplen y cada uno tiene su negativo medido por mí, no leído: la medida existe y es un suelo a 439–496× (rojo solo el aserto del suelo con el falso a 12 s), el cortafuegos es uno y el padrón se pone rojo en las tres formas, la expiración aborta (98 s con UN ✘ frente a los 650 del ingeniero), el hook sin `tiles` revienta en 7 s antes de abrir la espera, el rechazo por unicast no aborta, y los guiones tocados salen verdes aislados, en par y bajo load 20. Las reservas son las de siempre en esta casa —«el candado cubre menos de lo que su nombre promete»—: el test de H-3 acepta una sonda con precedencia propia (H-1), y el «once» es el del padrón y no el del árbol (H-3: tres esperas de viaje más a 180 s). Ninguna de las dos hace falso lo entregado; las dos merecen una vuelta corta del mismo ingeniero antes de fusionar (H-1 es un `deepEqual` en el test; H-3 es una decisión escrita, no código). El guion 153 queda como cable en `candados-headless`.
