# QA — Tanda AF · «Un rechazo del bridge llega a alguien» (#678)

Validado sobre `feature/tanda-af-el-rechazo-llega-a-alguien` = `c9f7993b` (base `a25d8c2f`), el
2026-09-20, en el worktree de la tanda. Cero créditos: todo con el preset `e2e-sin-creditos` que
levanta `qa/run.mjs` (el guardarraíl declaró `fake:true` en cliente y bridge en cada corrida). Nada
tocado en el árbol salvo mi guion nuevo (`qa/guiones/152-…`) y su fila del README; cada sabotaje se
restauró y se verificó con `md5sum -c`.

Criterios tomados de `requisitos.md` con el reencuadre del crítico aceptado por el coordinador
(C2 y C3 reescritos, C4 cerrado). Y la restricción de la casa que aplica a todo candado nuevo:
«se prueba EN NEGATIVO y se declara por escrito lo que NO cubre».

## Criterios

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| C1 | Censo por el ÁRBOL de los sitios de `qa/` que abren un WS, con decisión escrita por sitio | ✅ cumple | `npx tsx --test test/el-cliente-ws-del-banco-declara-como-escucha.test.ts` → `censo: 19 socket(s) en 18 fichero(s) · declarados {"una-respuesta":15,"todo":4,"nada":0}`, 16/16. Mi recuento independiente con `grep -rnE "new (window\.)?WebSocket\b" qa --include=*.mjs`: 19 líneas en 18 ficheros (`sesion.mjs` dos), el mismo conjunto. Cada socket lleva `escucha` + `porque` propio (≥12 palabras distintas, sin copia; lo canda el test) |
| C1b | Las cifras de la prosa casan con el árbol (el ingeniero encontró tres falsas heredadas) | ✅ cumple | Padrón, cabecera del test y README dicen **quince** `una-respuesta`, **diecisiete** espías de `window.WebSocket`, **seis** `routeWebSocket`. Medido hoy: `grep -rlE "window\.WebSocket *=" qa` → 17 (todos en `guiones/`), `grep -rl routeWebSocket qa` → 6, padrón 15 `una-respuesta` + 4 `todo`. `grep -nowE "dieciséis\|16"` sobre padrón, test, `cable.mjs` y el párrafo del README → 0 restos |
| C2 | Los dos sitios que cerraban sin esperar (63 y 60) deciden EN EL SITIO y, si oyen el rechazo, lo NOMBRAN en negativo con `reason:"nope"` | ✅ cumple | **63** saboteado (`reason:"nope"`, 1 ocurrencia): `⊘ … el tile (1,0) pedido por el cable no llegó al save — el bridge RECHAZÓ el frame (protocolo): El juego mandó un mensaje que el servidor no reconoce.: sin dos tiles no hay negativo que medir` (rc=2, 71 s). **60** saboteado: `✘ A3 · el request_tile de la re-difusión pasó el contrato del bridge (nadie lo rechazó por unicast) — el bridge RECHAZÓ el frame (protocolo): …` (rc=1, 20 s). Los dos restaurados, `md5sum -c` OK. Ninguno pasa por `pedirYEsperarTile`; comentario en el sitio en los dos |
| C3 | Los «dispara y olvida» quedan en un sitio candado (contrato + test), probado en negativo con un cliente nuevo que cierre sin esperar y sin declararlo | ✅ cumple, **con reservas** | Cinco sabotajes, cinco rojos con el aserto que toca (tabla abajo). PERO el candado se salta con una línea (`ws.onmessage = null` → **16/16 verde** declarado `una-respuesta`, S6), y el defecto de #678 se reproduce A TRAVÉS del helper nuevo sin que nada lo vea (sonda D: **3 de 5 rechazos perdidos**). Ninguno de los dos está en `_lo_que_esto_NO_sujeta`. Hallazgos H1 y H2 |
| C3b | Lo que el candado NO cubre está declarado por escrito y medido | ❌ NO cumple del todo | Los cuatro agujeros declarados existen y tienen su aserto. Faltan **tres** que encontré en la pasada adversarial: el oyente no atado al socket (H2), el mal uso del cable (H1) y el oyente en otra función que da rojo con mensaje falso (H4). Y el (1) está escrito más estrecho de lo que es (H5) |
| C4 | El bridge no cambia; propuesta con medida si hiciera falta | ✅ cumple | `git diff a25d8c2f --stat -- nefan-core/bridge nefan-core/src nefan-html/src banco-medido.json arch-rules.json quality-thresholds.json la-consulta-de-movimiento-tiene-dueno.test.ts` → vacío. La decisión (dead-letter NO, contador en State API si algún día) está escrita en el padrón, en el plan y en `cable.mjs` |
| C5 | Guiones tocados aislados y en par, tres corridas | ✅ cumple | 63 aislado ×3: `1 en verde · 0 en rojo de 1`, 11 ✔ cada una (19/17/14 s). 60 aislado ×3: `1 en verde`, 28 ✔ cada una (13/13/13 s). Par 60+63 ×1 (extra mío): `2 en verde · 0 en rojo de 2`, 39 ✔ (20 s). Ni un ⊘ ni un ✘. El ingeniero midió el par ×3 |
| — | `npm run verify` y `npm test` con mi guion nuevo en el árbol | ✅ cumple | verify: tsc ×4 + eslint + `3146 pass · 0 fail` (rc=0). `npm test` de nuevo con `152-…mjs` presente: 3146/3146 (los candados que barren `qa/guiones` no protestan) |
| — | Rebase pendiente | ⚠️ aviso | `main` avanzó a `e635159d` mientras se validaba (#695 «un número, un guion», #696, críticas AA/Y). El diff contra `main` a secas MUESTRA la retirada del párrafo #683 del README: es el desfase de base, no un cambio de la tanda (`git diff a25d8c2f -- qa/README.md` = solo lo de AF). **`main` ya tiene un 150 y un 151** en `qa/guiones/`; por eso mi guion nace como **152** y su número se confirma al fusionar (#680) |

### Los cinco sabotajes del padrón (headless, restaurado con `md5sum -c` → OK)

| Sabotaje | Resultado |
|---|---|
| S1 `999-tmp…mjs` con la forma vieja, SIN declarar | **fail 2**: `999-tmp…: 1 en el árbol (líneas 4) contra 0 declarados` + complemento («un socket sin oyente en el árbol») |
| S2 el mismo, declarado `una-respuesta` | **fail 2**: `…:4 declara \`una-respuesta\` y no tiene ningún oyente de "message"` + complemento |
| S3 el mismo, declarado `nada` con motivo | **fail 1**: `hay un \`nada\` declarado: si es legítimo, sube aquí el número esperado con su motivo` (el complemento del árbol SÍ lo descuenta: el arreglo 2 del ingeniero es verdad) |
| S4 se borra la entrada de `qa/lib/cable.mjs` | **fail 1**: `qa/lib/cable.mjs: 1 en el árbol (líneas 50) contra 0 declarados` |
| S5 un socket de más en `qa/lib/saves.mjs` | **fail 1**: `qa/lib/saves.mjs: 1 en el árbol (líneas 83) contra 2 declarados` |
| **S6 (extra QA)** la forma vieja + `ws.onmessage = null;`, declarada `una-respuesta` | **pass 16 · fail 0** ← el candado se salta con una línea |

### Pasada adversarial sobre el detector (`socketsDe` con fixtures, script en scratchpad)

| Caso | `socketsDe` | Lectura |
|---|---|---|
| A `const W = WebSocket; new W(u)` | `[]` | agujero (1), declarado y con aserto ✅ |
| B `new window.WebSocket(u)` dentro de `page.evaluate`, sin oyente | `[{oyentes:0}]` | lo ve y lo da por mudo ✅ |
| C `ws.addEventListener("message")` registrado en OTRA función | `[{oyentes:0}]` | **falso MUDO** → H4 |
| C2 `oir(ws)` con `ws.onmessage = …` en el helper | `[{oyentes:0}]` | **falso MUDO** → H4 |
| D `mandarPorElCable` + `ws.close()` inmediato desde el guion | `[]` | invisible → H1 |
| E `new (window.WebSocket)(u)` | `[]` | familia del alias, no nombrada → H5 |
| F `new window["WebSocket"](u)` | `[]` | ídem → H5 |
| G `import { WebSocket as WS } from "ws"; new WS(u)` | `[]` | ídem (es la forma natural de un cliente Node nuevo) → H5 |
| H `process.on("message", h)` en el mismo ámbito, socket mudo | `[{oyentes:1}]` | **falso OYENTE** → H2 |
| I `ws.onmessage = null` | `[{oyentes:1}]` | **falso OYENTE** → H2 (S6 lo demuestra sobre el árbol real) |
| J `otro.onmessage = h` | `[{oyentes:1}]` | **falso OYENTE** → H2 |
| K forma vieja CON `onmessage` colgado y `close()` en el mismo tick | `[{oyentes:1}]` | agujero (3), declarado ✅ |
| M `page.addScriptTag({content: "new WebSocket(u)…"})` | `[]` | código dentro de un string: el test lo llama «prosa» y aquí abre un socket → H5 |

## Hallazgos

### H1 · IMPORTANTE — `cable.mjs` reproduce el defecto de #678 si se usa mal, y nada lo ve

**Qué pasa.** La garantía del helper («deja el socket abierto para que el rechazo tenga a quién
llegar») depende de que el LLAMANTE cierre DESPUÉS de esperar. Un guion que haga
`mandarPorElCable` y `cerrarElCable` seguidos pierde el rechazo igual que la copia vieja, y el
padrón está verde: el `new WebSocket` es el de `cable.mjs`, declarado `todo`.

**Medido en navegador** (guion temporal, borrado después; partida real con el motor falso,
`reason:"nope"` ×5, cerrando nada más mandar):
`intento 1: RECHAZÓ · 2: no rechazó · 3: no rechazó · 4: RECHAZÓ · 5: no rechazó` →
`rechazos vistos por intento: [1,0,0,1,0]`. **Intermitente**, que es la peor forma: el guion que
lo escriba saldrá verde unas veces y `fraseDeRechazos([])` dirá «no rechazó por este socket».

**Qué esperaba el usuario.** #678 pedía que el rechazo llegue a alguien; el helper lo consigue
en 60 y 63, pero el tercer sitio que lo use mal vuelve al punto de partida sin que ningún candado
lo diga. Como mínimo: agujero (5) en `_lo_que_esto_NO_sujeta` con aserto. Mejor: que el propio
helper lo haga inexpresable (por ejemplo, `cerrarElCable` que exija haber pasado por una espera,
o un `mandarYEsperarPorElCable(ctx, msg, predicado)` que cierre él). Lo decide el ingeniero; yo
no toco código. Reproducción: `qa/guiones/152-…` agujero 3 (árbol) y el guion temporal descrito
(navegador).

### H2 · IMPORTANTE — «la coherencia se MIDE» mide menos de lo que dice: el oyente no se ata al socket

**Qué pasa.** `esOyente` cuenta el IDENTIFICADOR `onmessage` (cualquiera, de cualquier objeto,
también `= null`) y cualquier `on/once/addEventListener("message")` (también `process.on`) dentro
del ámbito léxico del `new`. No mira a qué se cuelga ni si escucha. Resultado: la forma vieja con
`ws.onmessage = null;` delante, declarada `una-respuesta`, pasa **16/16** (S6, sobre el árbol
real). El padrón afirma «declarar “espera” sobre un socket mudo es rojo»: no siempre.

**Qué esperaba el usuario.** Que un cliente nuevo que cierre sin esperar y sin declararlo ponga
el candado rojo (criterio 3). Con una línea de ruido deja de ponerse. No está en
`_lo_que_esto_NO_sujeta`. Reproducción: `152-…` agujero 1; fixtures H/I/J arriba.

### H3 · IMPORTANTE — en el 60, con el frame rechazado, los asertos viejos de A3 salen VERDES vacíamente, y eso lo INTRODUCE esta tanda

La pregunta del coordinador: ¿hallazgo de esta tanda o issue aparte? **De esta tanda.** El
ingeniero escribe «no es un defecto que esta tanda introduzca —ya era así—», y no es cierto:

- Antes, el sabotaje expiraba el `waitFor` y `waitFor` **LANZA** (`EsperaExpirada`,
  `qa/lib/sonda.mjs:511`): el guion moría ahí y los asertos de después **no corrían**.
- Ahora la segunda salida del predicado devuelve `"rechazado"`, el `waitFor` **resuelve**, el
  `finally` pone su ✘… y el guion **sigue**: `A3 · tile_0_0 re-añadido con su POST retenido (1
  retenido(s)); se suelta` (falso: nada se re-añadió), `✔ A3 · la misma clave disparada dos veces
  en el mismo tick se pide UNA vez` (no hubo segundo disparo: `1 POST · 23 celdas · 0 repetidas`) y
  `✔ A3 · y el tile activo acaba texturado igual`. Está en mi log `neg-60`, líneas finales.

El color del guion es correcto (✘) y el ✘ nombra la causa: el criterio 2 se cumple. Pero dos ✔
afirman lo que no ocurrió y un `log` miente, que es exactamente la categoría «verde que no
comprueba nada» de la casa, y nace con este diff. El arreglo es barato (abortar el bloque A3
cuando `rechazos.length > 0`, o hacer que la segunda salida LANCE con la frase en vez de
resolver). Que lo haga el ingeniero.

### H4 · MENOR — un cliente CORRECTO con el oyente en otra función sale ROJO con un mensaje FALSO

`const ws = new WebSocket(u); oir(ws)` donde `oir` cuelga el `onmessage`: `socketsDe` lo da por
mudo, la coherencia dice `declara \`una-respuesta\` y no tiene ningún oyente de "message"` (falso)
y las dos salidas son mentir (`nada`, que además rompe el complemento) o aflojar el detector. No
es agujero en la dirección del verde, pero tampoco está declarado, y el molde del banco es
justamente hacer helpers. Reproducción: `152-…` agujero 4 (hoy sale rojo por coherencia; el día
que el detector ate el oyente al socket el guion pide subirlo).

### H5 · MENOR — el agujero (1) está escrito más estrecho de lo que es

Dice «`const W = WebSocket` y `Reflect.construct`». Lo que de verdad no ve es **cualquier `new`
cuyo callee no se llame `WebSocket` en el nodo**: paréntesis (`new (window.WebSocket)(u)`), acceso
por índice (`new window["WebSocket"](u)`), **import renombrado** (`import { WebSocket as WS } from
"ws"` — la forma natural de un cliente Node nuevo, que es donde más probable es) y el código dentro
de un string que se evalúa (`addScriptTag`, `page.evaluate("…")`), que el test bendice como
«prosa». Basta con redactarlo así y añadir el import renombrado al aserto «NO ve el alias».

### H6 · MENOR — el 63 se queda 60 s sabiendo ya la causa

El 60 ganó una segunda salida (23 s en el sabotaje); el 63 espera en disco (`esperarEnElSave`,
60 s) sin mirar `window.__qaCables`, así que con el frame rechazado quema los 60 s (mi corrida:
71 s) para decir al final lo que sabía a los pocos ms. Fricción, no corrección. Si se hace, que la
espera del 63 sondee también los rechazos del cable (o que el helper ofrezca esa espera; ver H1).

### H7 · NOTA — numeración y rebase

`main` ya tiene `150-dos-rotulos-alineados…` y `151-el-candado-del-prefijo…`; mi guion es el
**152** y el candado del prefijo (#695) lo juzga al fusionar. El README de la tanda toca la zona
de «lo que corre el CI» donde `main` metió el párrafo de #683: el hunk es distinto y debería
fusionar solo, pero el `git diff main` de hoy engaña (parece borrar #683). Rebase antes de fusionar.

## Workarounds usados durante la prueba

- **Ninguno para observar la feature.** El negativo de C2 se hizo sobre el flujo real del guion
  (partida nueva → cable → espera), cambiando solo `reason` y restaurando (`md5sum -c` OK ×2).
- Los sabotajes S1–S6 escriben el padrón y un fichero temporal; el guion **152** lo hace con el
  turno de candados, se niega sobre árbol sucio y restaura byte a byte (aserto propio).
- La sonda D fue un guion temporal en `qa/guiones/` (borrado; `git status` limpio de él). No es
  un paso para que nada pase: es la prueba del agujero H1.

## Guion dejado

`qa/guiones/152-el-padron-de-clientes-ws-puede-ponerse-rojo.mjs` (+ fila en `qa/README.md`), molde
del 148, clase headless (`sinNavegador`, entra en `candados-headless` al nacer). Cinco sabotajes con
sus asertos EXACTOS y cuatro agujeros conocidos (H1, H2, H4 y el alias). Salida real:
`1 en verde · 0 en rojo de 1`, 30 s. **Probado en negativo dos veces**: con `esOyente` roto de base
→ `✘ el detector viene VERDE de partida — ya está rojo: …`; con el aserto de coherencia VACIADO
(`assert.deepEqual([], [])`) → `✘ sabotaje · el mismo, declarado una-respuesta…` y `✘ agujero … oyente
en OTRA función` (los dos que dependen de él), el resto verde. Restaurado, `md5sum -c` OK.

## No probado

- **El cuelgue mudo de los quince `una-respuesta`** ante un rechazo de intake: fuera de alcance
  (issue del coordinador). No lo reproduje.
- **El unicast REAL en `cable.mjs` desde `test/cable-de-qa.test.ts`**: usa un doble; lo real lo
  cubren los negativos de C2, que sí corrí.
- **Fugas de sockets en el bridge** (emparejar `client connected/closed` en su log durante una
  corrida con fallo aguas arriba): no lo miré. Los dos `cerrarElCable` están en `finally`.
- **La corrida en CI** de los tests nuevos y del 152: solo local (verde).
- **`--parar` con offset 900**: no hizo falta; `qa/run.mjs` eligió el bloque +100 y lo bajó él.

## Estado del stack al terminar

Bloque +100 (el que usaron mis nueve corridas y la sonda): `:3100`, `:9977`, `:9978`, `:18865`
libres; ningún proceso con `cwd` en este árbol. Lo que sigue arriba (`:3000/:9877`, `0.lock`) es de
`ne-fan-tanda-v-el-presupuesto-del-tile` y no se ha tocado.

## Veredicto de la primera vuelta (sobre `c9f7993b`)

**Apto con reservas.** Lo que #678 pedía, reencuadrado, está: los dos sitios que cerraban sin
esperar oyen el rechazo y lo NOMBRAN (medido en negativo en los dos), el censo es por árbol y casa
con el mío, las cifras heredadas están corregidas, el bridge no cambia y las nueve corridas son
estables con cero créditos. Las reservas son tres y vuelven al ingeniero antes de fusionar, porque
las tres son baratas y las tres son de la familia «el candado dice más de lo que mide»: **H1** (el
helper reproduce #678 si se usa mal y nadie lo ve: 3 de 5), **H2** (la coherencia se salta con
`ws.onmessage = null`) y **H3** (dos ✔ vacíos y un log falso en el 60 que nacen con este diff, y un
informe que dice que ya estaban). H4–H6 son prosa y fricción; H7 es del coordinador.


---

# Segunda vuelta — sobre `87ce8336` (rama rebasada sobre `main` = `e635159d`), 2026-09-20

Re-verificado SOLO lo afectado por H1–H6 y por la edición del guion 152. Mismo worktree; sabotajes
restaurados con `md5sum -c` OK (padrón, 60, 63); stack parado (bloque +100 libre al terminar).

| Hallazgo | Veredicto | Evidencia |
|---|---|---|
| **H1** cable mal usado | ✅ cerrado en el tipo, residuo declarado | `Object.keys(import("qa/lib/cable.mjs"))` = `fraseDeRechazos, porElCable, porRondasHastaRechazo, rechazosDelCable`. Escribir el mal uso: `import { mandarPorElCable, cerrarElCable }` → `SyntaxError: does not provide an export named 'cerrarElCable'`. `porElCable` sin `espera` lanza por tipo; aserto «no exporta nada con lo que cerrar el cable a mano» en `cable-de-qa.test.ts:48`. El residuo (`async () => {}`) está en el padrón como agujero **(5)** y lo mide el 152 (agujero 2, verde = sigue abierto) |
| **H2** oyente atado al socket | ✅ cerrado, con un residuo menor (H8) | S6 repetido sobre el árbol real (temporal en `qa/lib/`, `ws.onmessage = null`, declarado `una-respuesta`) → **fail 2**: `…:4 declara \`una-respuesta\` y a \`ws\` no se le cuelga ningún oyente de "message" EN SU MISMA FUNCIÓN…` + complemento. Fixtures H/I/J (`process.on`, `= null`, `otro.onmessage`) → `oyentes: 0`. Los 19 sockets reales siguen: censo `19 socket(s) en 18 fichero(s)`, detector 21/21, cable 22/22 (43 en total) |
| **H3** ✔ vacíos del 60 | ✅ cerrado | `neg-60` (`reason:"nope"`): `✘ A3 · … pasó el contrato … — el bridge RECHAZÓ el frame (protocolo)` **más** `⊘ bloque no medido: A3 · ni el POST que no se repite ni el texturado se midieron…`. Conteo de los dos asertos antes vacíos (`✔ A3 · la misma clave…`, `✔ A3 · y el tile activo…`): **0** en el sabotaje, **2** en la corrida verde; el `log` «re-añadido con su POST retenido»: 0 y 1 |
| **H4** oyente en otra función | ✅ atendido como declarado | Sigue rojo (fixture C → `oyentes: 0`), pero el mensaje ya dice «EN SU MISMA FUNCIÓN» y a dónde ir; agujero (4) del padrón; y el socket sin nombre (`sockets.push(new WebSocket(u))`) tiene su propio mensaje (`ligado: null`) |
| **H5** agujero (1) estrecho | ✅ atendido | E `new (window.WebSocket)(u)` y F `new window["WebSocket"](u)` → **vistos** (`oyentes: 1` cada uno). G import renombrado y M código en string → `[]`, ahora DECLARADOS en (1) con aserto («NO ve el constructor RENOMBRADO», «NO ve el código dentro de un STRING») |
| **H6** el 63 quemaba 60 s | ✅ atendido | `neg-63` → mismo ⊘ nombrando el rechazo en **8 s** (antes 71); `porRondasHastaRechazo` con rondas de 2 s |
| **152** editado por el ingeniero | ✅ sigue en verde y dice la verdad, salvo una cifra del README (H9) | Headless: `1 en verde · 0 en rojo de 1`; **seis** sabotajes ✔ (el sexto es el `onmessage = null`, ahora rojo donde antes pasaba 16/16) y **tres** agujeros ✔ con su «↳ hoy …». La tabla del guion casa con lo que hay: alias/import renombrado → `[]` (declarado 1); espera que no espera → verde (declarado 5); oyente en otra función → rojo con mensaje veraz (declarado 4). Su cabecera dice «los tres de hoy» y explica el que se cerró |
| 60 y 63 aislados ×1 | ✅ | 63: `1 en verde · 0 en rojo de 1`, 11 ✔ (14 s). 60: `1 en verde`, 28 ✔ (16 s). Cero créditos, `fake:true` |
| `npm run verify` | ✅ | `3171 pass · 0 fail`, rc=0 (los 25 de más son los tests que trajo el rebase) |
| Retirada completa de la API vieja | ✅ | `grep -rn "mandarPorElCable\|cerrarElCable"` fuera de `docs/agents`: solo prosa histórica que cuenta por qué murió (cabecera de `cable.mjs`, `cable-de-qa.test.ts:16,50`, 152:32,174). Ningún uso vivo |

### Hallazgos nuevos de la segunda vuelta

**H8 · MENOR — `esVacio` mide solo `null`/`undefined`: la misma línea con otro literal sigue pasando.**
Sobre el árbol real, la forma vieja + `ws.onmessage = 0;` declarada `una-respuesta` → **21/21 verde**
(también `= ''`, `addEventListener("message", 0)` y `ws.onmessage = ws.onmessage`, fixtures S6b–e).
Es el residuo de H2: la cabecera del test y el padrón dicen «con `<algo>` que no sea `null` ni
`undefined`», así que la afirmación es exacta, pero la medida sigue siendo «hay una asignación» y no
«se cuelga algo que escucha». Nadie escribe `= 0` sin querer, igual que nadie escribía `= null`; la
salida barata es exigir que lo colgado sea función, flecha o identificador, o declararlo en (3).

**H9 · MENOR — la fila del 152 en `qa/README.md` (l. 603) dice «CINCO sabotajes» y el guion tiene
SEIS**, y «el agujero 4 salen ✘» cuando la tabla de agujeros ya tiene tres y el «otra función» es el
tercero. Es la cifra que cambió con la edición del ingeniero y no se recontó: la misma lección de
«la medida de hoy hay que medirla hoy» que esta tanda ya pagó una vez con «dieciséis».

**Notas, no hallazgos.** (a) `rechazosDelCable` está exportada y una `espera` puede cerrar el socket
desde la página por `window.__qaCables` o pasar `techoMs: 0` a `porRondasHastaRechazo`: todo eso es
la familia del agujero (5) («una espera que no espera») y se lee en la llamada; no lo cuento aparte.
(b) Los oyentes «legítimos» que el detector NO ve (`ws["onmessage"] = f`, `let ws; ws = new…`,
`this.ws = new…`, `Object.assign(ws, {onmessage})`, `??=`) salen ROJOS con el mensaje de (4) —falso
positivo honesto, ninguno en el banco hoy—; no es agujero en la dirección del verde.

### No probado en esta vuelta
- El emparejado `client connected/closed` en el log del bridge (tampoco lo miró el ingeniero).
- La corrida en CI (`candados-headless` con el 152 y el job `nefan-core` con los dos tests): local.
- El par 60+63: en la primera vuelta ×1 y el ingeniero ×3; esta vez solo aislados, como se pidió.

## Veredicto final

**Apto.** Las tres reservas importantes de la primera vuelta están cerradas y medidas: H1 en el tipo
(no se puede escribir el mal uso; el residuo está declarado y candado por el 152), H2 con el oyente
atado al socket (mi sabotaje sale rojo, los 19 reales pasan), H3 con `⊘ bloque no medido` y 0
asertos vacíos en el sabotaje. H4–H6 atendidos. Quedan dos menores nuevos (H8, un literal distinto
de `null` sigue pasando por oyente; H9, una cifra del README desfasada) que no bloquean la fusión:
pueden ir en el mismo commit de rebase o en el issue del coordinador de los quince `una-respuesta`.
