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

## Veredicto

**Apto con reservas.** Lo que #678 pedía, reencuadrado, está: los dos sitios que cerraban sin
esperar oyen el rechazo y lo NOMBRAN (medido en negativo en los dos), el censo es por árbol y casa
con el mío, las cifras heredadas están corregidas, el bridge no cambia y las nueve corridas son
estables con cero créditos. Las reservas son tres y vuelven al ingeniero antes de fusionar, porque
las tres son baratas y las tres son de la familia «el candado dice más de lo que mide»: **H1** (el
helper reproduce #678 si se usa mal y nadie lo ve: 3 de 5), **H2** (la coherencia se salta con
`ws.onmessage = null`) y **H3** (dos ✔ vacíos y un log falso en el 60 que nacen con este diff, y un
informe que dice que ya estaban). H4–H6 son prosa y fricción; H7 es del coordinador.
