# QA — Tanda O · #659 «el canal sabe de quién es»

Árbol `/home/al/code/ne-fan-qa-o`, commit del ingeniero `5682fdfd` sobre `main` = `bb26b04a`.
Bloque de puertos propio (`NEFAN_PORT_OFFSET=1800` declarado; las corridas del banco eligen su
propio bloque libre y usaron +200 y +0). Cero créditos: todo con el motor falso y en modo maqueta.

**#673 está fuera de alcance** (descartado de la tanda con medida). Aquí solo se valida **#659**,
más el arreglo de una línea que su exención recibió.

---

## Criterios y evidencia

Los criterios salen del enunciado del issue tal como lo reescribió el plan (§1), no del resumen del
ingeniero.

| Criterio | Veredicto | Evidencia |
|---|---|---|
| (a) El `state_update` dice DE QUIÉN ES EL SIM que describe | ✅ cumple | Medido en el **socket del jugador**, no en el tipo: guion nuevo `qa/guiones/148-…`, espía sobre `window.WebSocket`. En partida, **25 de 25** frames llegan con `delSim` y el censo de sellos es exactamente `{"partida:1789723717-88bf65":25}`, `sin sello 0` |
| (b) La página descarta el que NO es suyo, y lo dice | ✅ cumple **(pero sin candado hasta este guion — ver H1)** | Guion 148 bloque 1b: se entrega por el mismo `onmessage` un frame sellado `{de:"partida","qa148-otra-partida"}` con un NPC ajeno → `tirados 0 → 1`, la línea del juego dice `↩ estado de la partida «qa148-otra-partida» descartado`, y el NPC **no** entra en el mundo |
| (b2) …y la decisión vive en core, no en un `if` del cliente | ✅ cumple | `src/protocol/dueno-del-sim.ts` + grupo nuevo en `la-logica-de-juego-no-vuelve-al-cliente` (`arch-rules.json`, token `\bdelSim\.(?:de\|sessionId)\s*[=!]==`). Sabotaje 3 del ingeniero reproducido en su informe; el token está en el contrato y lo verifiqué leyéndolo |
| (b3) Nadie descarta su propia respuesta — régimen **partida** | ✅ cumple | Guion 148 bloque 1: `tirados === 0` con 25 frames propios entrados. Ningún guion medía este régimen hasta hoy (el 80 es `sinMotor`) |
| (b4) Nadie descarta su propia respuesta — transición **partida → prueba** | ✅ cumple **(sin candado hasta este guion — ver H2)** | Guion 148 bloque 2: con la partida VIVA se carga `robledo_tile` y luego `zorder_test`; el censo pasa a `{"partida:…":33,"prueba":27}` y `tirados` se queda en su base. **Probado en negativo**: invirtiendo el orden de las dos reglas de `identidadDelCliente` → 14 y 28 descartes y siete «↩ estado de una escena de prueba descartado», **con el guion 80 VERDE en la misma corrida** |
| (b5) Nadie descarta su propia respuesta — régimen **nadie/prueba** | ✅ cumple | Guion 80 bloque 5, 6 corridas (3 en par 79→80, 3 aislado), todas verdes |
| (c) La página que vuelve al título deja de repetir el frame del sim muerto | ⚠️ **no probado — y medido como INALCANZABLE hoy** | Ver **H3**. No hay camino del jugador que produzca el síntoma: la vuelta al título exige `mundoVacio` (`src/protocol/status-rotulo.ts:185`) y toda partida sin mundo tiene el sim recién sembrado (`reseedSimForSession`), así que el frame repetido es idéntico al neutro. El sink en sí está cableado y no rompe nada (batería completa y 6/6 del par) |
| El guion 80 deja de heredar entradas del 79 | ✅ cumple | `node qa/run.mjs 79 80` ×3 → 2 ✔/0 ✘ las tres; `tiradosBase` = **1, 1, 0**. El 1 es el frame de la partida del 79 tirado en el sitio donde tenía que tirarse. Aislado ×3 → 1 ✔/0 ✘, `0 → 0` las tres. `uptime` 1,77–2,42 en las seis |
| La exención del guion 80 sale del censo y su espera se migra | ✅ cumple | `esperas-por-fotogramas.json`: 7 → **6** entradas (contadas con `json.load`, antes y después). El 80 usa `esperaDeFotogramas("loop")` y sigue midiendo lo mismo: 6/6 verde con el cortafuegos de 20 s en vez de 5 s |
| La exención del guion 15 cita **#673** | ✅ cumple | `grep -c 673` sobre el contrato = **1** (era 0) |
| Los censos en prosa retirados | ⚠️ parcial — ver **H4** | «las seis exenciones» → hoy **por clases y sin número**, correcto (7 reales entonces, 6 ahora). Los de `ws-server.ts`, `messages.ts` y `replay-server.mjs` quedan como nota de retirada. Pero el censo NUEVO de `context.ts` repite el vicio |
| `client-file-size.json` sube a 1.381 con motivo | ✅ cumple | `wc -l nefan-html/src/main.ts` = **1381**, exacto. Base `bb26b04a` = 1379 |
| `game-client.ts` no rompe el tope | ✅ cumple (y es deuda declarada) | `wc -l` = **445** de 450. La cifra del ingeniero es correcta |
| `npm run verify` (nefan-core) | ✅ cumple | Corrido entero sobre el árbol limpio: **exit 0**, `3036 tests · 3036 pass · 0 fail` |
| Batería del banco | ✅ cumple | Corrida completa sobre este árbol **con el guion nuevo dentro**: **145 en verde · 0 en rojo · 2 SIN MEDIR de 147** (`bateria-qa-o.log`). Los dos ⊘ son el 141 (declara él mismo que no hay grabaciones en este worktree) y el 97 (caso sano por diseño). Es exactamente la corrida del ingeniero (144 ✔ / 0 ✘ / 2 ⊘ de 146) **más un verde**, que es el 148 |
| Mutación de `dueno-del-sim` | ⚠️ no probado, por instrucción | Entra con `break: "sin medir"`; se me prohibió correr `npm run mutacion`. El motivo escrito en el contrato es correcto y está verificado por lectura (`permisoLocal` rechaza el coste desconocido) |
| Reestampado de `replay-server.mjs` | ⚠️ no probado | Sin grabaciones en este worktree (`labs/narrative/runs/` es material de sesión). Lo declara ya el ingeniero (§6c) |

---

## Hallazgos

### H1 · IMPORTANTE — el filtro del cliente, que es la mitad del issue, no lo sujetaba NADA

**Es el séptimo sabotaje que se me pidió buscar, y existe.** Con el embudo de
`nefan-html/src/net/game-client.ts` neutralizado, el juego vuelve a aplicar los `state_update` de
otra partida y **no se pone rojo nada del repositorio**.

Medido de dos formas, una por vez, restaurando con `md5sum` entre ellas:

* **7a — el cliente se compara consigo mismo** (una línea: `identidadDelCliente(…) && msg.delSim`
  como segundo argumento de `repartirEstado`, que siempre devuelve «aplicar»).
* **7b — el revert honesto**: el bloque `guarda + reparto + contador + línea` borrado entero y sus
  dos imports de `dueno-del-sim.js` con él.

| Comprobación | 7a | 7b |
|---|---|---|
| `nefan-core`: `npm test` | 3036 pass · **0 fail** | 3036 pass · **0 fail** |
| `nefan-html`: `tsc --noEmit` | exit 0 | exit 0 |
| `nefan-html`: `eslint .` | limpio | limpio |
| `nefan-html`: `npm test` | 0 fail | — |
| `node qa/run.mjs 79 80 148` | **3 en verde · 0 en rojo** | **3 en verde · 0 en rojo** |

Y la prueba de que el defecto está VIVO en esa corrida verde: el `tiradosBase` que el guion 80
registra en el par 79→80 pasa de **1 (con el arreglo) a 0 (con el sabotaje)** — o sea, el frame
heredado vuelve a aplicarse — y su aserto `0 === 0` sale verde igual, porque mide «no crece», no
«tira lo ajeno».

Por qué pasó: los cinco candados de la PR miden el otro lado. `dueno-del-sim.test.ts` mide la
FUNCIÓN, `bridge-session.test.ts` mide que el BRIDGE sella, `architecture.test.ts` mide que el `if`
no se escriba a mano, y el guion 80 mide que no se descarte **lo propio**. Ninguno mide que el
cliente LLAME a la función. Es el patrón que esta casa lleva ocho tandas cazando, aplicado a la
única línea que el issue pedía.

**Reproducción desde el arranque** (la que usé):

```bash
cd /home/al/code/ne-fan-qa-o
# 7b, el revert honesto: borrar en nefan-html/src/net/game-client.ts el bloque
#   const reparto = repartirEstado(...); if (reparto.destino === "descartado") {...}
# y el import de identidadDelCliente/repartirEstado.
(cd nefan-html && npx tsc --noEmit && npm run lint)     # limpios
(cd nefan-core && npm test)                             # 3036/3036
node qa/run.mjs 79 80                                   # 2 en verde
```

**Lo que esperaba el usuario**: que reintroducir el defecto que el issue describe pusiera algo
rojo. El plan lo pedía explícitamente en la cuarta fila de su §7 —«un `state_update` ajeno inyectado
por el `onmessage` (patrón del espía del 35/89) descartado con su línea»— y el ingeniero lo declara
como NO hecho en su §5-6.

**Estado**: **cerrado por QA en el mismo sitio en el que se abrió.** El bloque **1b** del guion
nuevo `qa/guiones/148-la-partida-que-mira-una-fixture-no-descarta-lo-suyo.mjs` entrega ese frame
ajeno y afirma las tres cosas. Con el sabotaje 7a puesto, el guion 148 sale **rojo en tres asertos**
y la evidencia es literal:

```
✘ el state_update de OTRA partida se descarta: el contador sube exactamente uno — 0 → 0
✘ …y se DICE de quién era: la línea del juego nombra «qa148-otra-partida»
✘ el NPC de la otra partida NO entra en este mundo (es la entrada de #659)
   — el bridge mueve al NPC "qa148-npc-de-otra-partida" y el cliente no lo tiene en escena
```

No hace falta código de producción: el hallazgo se cierra con el candado que faltaba.

### H2 · IMPORTANTE — la transición `partida → prueba` no tenía candado de navegador

Es la trampa que la crítica nombró («una página EN partida que abre el selector «Room»
descartaría su propia respuesta») y la razón entera de que `DuenoDelSim` tenga tres identidades en
vez de un `sessionId: string`. **Ningún guion la recorría**: el 80 es `sinMotor` y nunca tiene
sesión, así que sus dos ramas de `identidadDelCliente` dan lo mismo — el propio ingeniero lo midió
e invirtió el orden dejando el 80 verde.

Lo confirmé en la misma corrida, con el sabotaje puesto:

```
▶ 148  ✘ …y la página EN PARTIDA reconoce como suya esa respuesta — 0 → 14
       ✘ la línea del juego no dice que se haya descartado ningún estado
         — ↩ estado de una escena de prueba descartado ×7
▶ 80   ✔ (los 22 asertos, incluido el bloque 5)
1 en verde · 1 en rojo de 2
```

**Y el estado es alcanzable**: medido, `#room-selector` está a mano con la partida puesta
(`offsetParent !== null`, 4 opciones) y `load_room` cambia el sello del sim a `prueba` en caliente
(censo `{"partida:…":33,"prueba":27}` en la misma página). O sea que el orden de las dos reglas
**no es código muerto**.

**Estado**: **cerrado por QA**, bloques 1 y 2 del guion 148.

### H3 · IMPORTANTE — la mitad del `lastState` cierra con una justificación que no se sostiene

El encargo principal era comprobar EN EL JUEGO que volver al título deja de repetir el frame muerto.
**No se puede: el síntoma que justifica esa mitad no es alcanzable por ningún camino del jugador.**
La cadena, medida eslabón a eslabón:

1. **El único botón que devuelve al título dentro de la misma página** es «Volver al título» del
   muro (`ui/muro-de-carga.ts:291`), y core solo lo pinta cuando el mundo está VACÍO:
   `src/protocol/status-rotulo.ts:185`, `const salida = ctx.mundoVacio ? "volver-al-titulo" : "cerrar"`.
   Desde una partida con mundo pintado **no hay salida al título** que no sea recargar (y recargar
   tira el módulo entero, así que `lastState` nace vacío).
2. **Toda partida con el mundo vacío tiene el sim recién sembrado**: `reseedSimForSession`
   (`bridge/handlers/session.ts:266`) hace `sim.reset()` y mete al jugador con el HP y la posición
   del NarrativeState. Sin escena no hay NPCs ni enemigos, y el HP de una partida nueva es 100 — que
   es EXACTAMENTE el neutro al que vuelve `olvidarElUltimoFrame()`. El frame repetido y el neutro
   son el mismo objeto campo a campo.
3. **La única vía que quedaba** —reanudar una partida HERIDA cuyo mundo no vuelve— la construí y la
   medí. Con un save editado a 37 PV y `scenes_loaded` vacío, sobre un bridge propio con el motor
   apuntado a un puerto muerto: el título se va, **el HUD marca 37**, el registro gana
   `el bridge mueve al NPC "barkeep" y el cliente no lo tiene en escena`… y **el muro con «Volver al
   título» no aparece nunca** (esperado 120 s; el estado queda clavado en «Generando escena...»).
   El motivo está escrito en el propio código: el reintento del bootstrap se retiró
   (`session.ts:711-717`) porque desde #279 **no nacen saves de cero escenas** — o sea que el estado
   que yo fabriqué tampoco es alcanzable.

Conclusión: el sink `estadoDelSim` es defensa barata y correcta, **y no tiene sujeto vivo**. Lo que
sobra es la afirmación, que está escrita en cuatro sitios como si fuera un síntoma observado —
`session-facets.ts` («volvía "el bridge mueve al NPC X…" y el HUD se quedaba con el HP anterior»),
el docblock de `idle()` en `game-client.ts`, `critica.md` y el §1 del plan—. Es el patrón
«justificación que se escribe después y se congela como documentación falsa».

**Qué pido**: no revertir nada (el cableado es consistente y no cuesta), pero **corregir esa prosa**
para que diga lo que está medido —«riesgo latente: hoy no hay camino del jugador que lo produzca,
porque la vuelta al título exige mundo vacío y un mundo vacío implica sim recién sembrado»— y, si se
quiere sujeto, abrir issue por lo que de verdad falta: **un jugador con partida y mundo no tiene
ninguna forma de volver al título**. Eso sí es una carencia de producto, y es la que haría
observable esta mitad.

**Reproducción de lo medido** (el bridge propio y la cirugía del save están en el histórico de mi
sesión; lo reproducible en un comando es el eslabón 1):

```bash
grep -n "mundoVacio ? " nefan-core/src/protocol/status-rotulo.ts
# 185:  const salida: SalidaDeFallo = ctx.mundoVacio ? "volver-al-titulo" : "cerrar";
grep -n "sim.reset()" nefan-core/bridge/handlers/session.ts     # 266
```

### H4 · MENOR — el censo nuevo de `context.ts` repite el vicio que la PR retira

`bridge/context.ts` (docblock de `broadcastNarrative`) dice, palabra por palabra:

> «el número de hoy —MEDIDO el 2026-09-18, 31 llamadas en 11 ficheros— **se queda fuera del
> comentario a propósito**, porque envejece en la primera PR que añada una»

y lo escribe **dentro del comentario**. Dos problemas, y el segundo es el de siempre:

1. La frase se contradice con el sitio donde está.
2. **No se reproduce.** Medido hoy en este mismo árbol, con las tres formas razonables de contar:

   | Forma de contar | Llamadas | Ficheros |
   |---|---|---|
   | `.broadcastNarrative(` en `bridge/` + `src/` (producción) | 29 | 10 |
   | …añadiendo `test/` (las 5 fixtures de `architecture.test.ts`) | 34 | 11 |
   | …añadiendo además `.enviarNarrativo(`, el hermano unicast | 36 | 12 |

   Ninguna da **31 en 11**, y no encontré la forma de contar que lo dé.

O sea que el censo nuevo nace ya desfasado, exactamente como los tres que esta PR retira. Los otros
dos barridos (el de `espera-de-fotogramas-con-dueno.test.ts`, que pasó a clases sin número, y el
`grep` del #673) los recuenté y están bien.

**Arreglo pedido**: borrar el número del comentario (que es lo que la propia frase dice que va a
hacer), o derivarlo en un test. Es una línea.

### H5 · MENOR — el guion 147 no tiene fila en `qa/README.md`

No es de esta PR (viene de `a8e63da6`), pero lo vi al añadir la mía y la nota de la tabla ya enumera
cinco guiones sin fila. Se está volviendo costumbre.

---

## Lo que QA añade al árbol

* **`qa/guiones/148-la-partida-que-mira-una-fixture-no-descarta-lo-suyo.mjs`** (nuevo, 11 asertos).
  Recorre las tres identidades desde el socket del jugador: juega una partida real, mide los sellos
  en el cable con un espía de `window.WebSocket` (patrón de los guiones 35 y 89, sin tocar
  producción), entrega un frame ajeno y comprueba que se tira **diciendo de quién era**, y abre el
  selector «Room» con la partida puesta para recorrer `partida → prueba`.
  **Probado en negativo con dos sabotajes distintos** (H1 y H2), restaurando con `md5sum` entre
  ellos. Estabilidad: **3 corridas aisladas, 3 verdes** (`uptime` 2,0–2,4).
* **Fila en `qa/README.md`** con lo que mide, lo que NO mide y los dos negativos con su salida real.

## Workarounds usados durante la prueba, y su veredicto

| Workaround | Para qué | Veredicto |
|---|---|---|
| Espía sobre `window.WebSocket` + entregar un frame por `sock.onmessage` | Contar los `state_update` que ENTRAN (la mitad positiva) y producir un frame ajeno, que en una batería de un solo bridge no se puede pedir de verdad | **No es hallazgo.** Es el seam que ya existe (`bridge-client.ts` asigna `this.ws.onmessage`) y el patrón establecido de los guiones 35 y 89; no toca una línea de producción y el jugador no tiene ese obstáculo delante |
| Bridge propio con el motor en `127.0.0.1:9` y disco propio | Alcanzar el muro del mundo vacío sin matar el fake-ai compartido | **No es hallazgo.** Técnica del guion 20, ya en el banco |
| Editar un save en disco (`player.health = 37`, `scenes_loaded = {}`) | Intentar producir un `lastState` distinto del neutro en la vuelta al título | **SÍ es hallazgo, y es H3.** Tuve que fabricar un estado que el juego ya no produce (#279 impide saves de cero escenas) y aun así el muro no llegó. Que haga falta eso para ver la feature es la medida de que la feature no tiene sujeto vivo. **No forma parte de la receta final**: el guion 148 no lo usa |

## No probado, y por qué

* **Mutación de `dueno-del-sim`**: prohibido por instrucción del coordinador (nace `sin medir` por
  diseño y el número lo trae una corrida autorizada). El motivo escrito en `mutation-targets.json`
  lo verifiqué por lectura y es correcto.
* **`replay-web`**: el reestampado de `delSim` en `labs/narrative/replay-server.mjs` no tiene
  material contra el que ejercerse en este worktree (sin `labs/narrative/runs/`). Ya declarado por
  el ingeniero (§6c); no lo doy por bueno ni por malo.
* **Gasto real de créditos**: nada se probó contra servicios de pago. Todas las corridas con el
  motor falso y el guardarraíl declarando `fake:true`; el guion nuevo va en `vector`/`vector`.
* **El escenario de dos pestañas** (una en partida con fixture cargada, otra reanudando la misma
  sesión) como vía al `enPrueba` colgado: **verificado inalcanzable por lectura, no por corrida** —
  `handleInput` no contesta a un socket que no conduce (`if (!ctx.world.canDrive(ws)) return;`,
  `bridge/handlers/simulation.ts`) y `claimForFixture` se niega si el mundo lo tiene otro socket.

## Las tres identidades contra el régimen de fixtures — cobertura real

Se me pidió ejercitarlo «de verdad, y al revés». Lo que hay, medido:

| Transición | ¿Alcanzable? | ¿Ejercida? |
|---|---|---|
| `nadie → prueba` (título cerrado → fixture) | Sí, es el camino del jugador a las fixtures (`#ts-close`, guion 25) | Sí, guion **80** bloque 5 |
| `partida → prueba` (partida viva → selector «Room») | **Sí**, medido: con la partida puesta el `#room-selector` está a mano y `load_room` cambia el sello en caliente | Sí, guion **148** bloque 2 — **nuevo** |
| `partida → partida ajena` (recibir el frame de otra) | Sí (bridge compartido, socket sin dueño: es #659) | Sí, guion **148** bloque 1b — **nuevo** |
| `prueba → partida` («y al revés»: mirar una fixture y luego empezar partida en la MISMA página) | **No**, y lo verifiqué leyendo: `#ts-close` oculta el título **sin resolver la promesa de `show()`** (`ui/titulo/chasis.ts:222-226`, `title-screen.ts:71`), así que desde el modo fixtures no se llega a `session.enter`. El único camino de vuelta al título es `entrarPorElTitulo`, que se llama desde la oferta de #478 y **construye un `BridgeGameClient` NUEVO** (`main.ts:1159`), con lo que el `enPrueba` del anterior no viaja | No procede |

## Sobre el estado malo que el ingeniero declara todavía expresable (`enPrueba` colgado)

Su formulación —`session.enter(A)` dos veces sin `leave()` en medio— **es inalcanzable**, y lo
verifiqué: los dos únicos `session.enter` viven dentro de `unIntentoDeArrancar` (`main.ts:1261` y
`:1275`), y el bucle de `runTitleFlow` solo vuelve a ese cuerpo por el `catch`, que llama a
`session.leave()` antes de devolver el aviso; el camino de éxito hace `titleScreen.hide()` y sale.

La variante que **sí** encontré alcanzable y que él no nombra es más simple: **cargar una fixture
DENTRO de una partida deja `enPrueba = true` para el resto de esa sesión**, porque el sink solo
dispara al cambiar el id. Hoy es inofensiva —mientras el sim siga siendo `prueba`, las identidades
casan, y lo medí: 27 frames `prueba` aplicados, 0 tirados— y la única forma de desalinearla sería
que el sim volviera a `{de:"partida", A}` sin cambiar de sesión, lo que exige un `claimForSession`
de otro socket; ese camino está cerrado por `canDrive` (ver arriba). **Lo dejo dicho, no como
defecto, sino porque la garantía descansa hoy en `canDrive` y no en el tipo.**

## Corridas de referencia

* `npm test` (nefan-core, árbol limpio): **3036 · 3036 pass · 0 fail**.
* `node qa/run.mjs 79 80` ×3 → **2 ✔ / 0 ✘** las tres · `tiradosBase` 1, 1, 0.
* `node qa/run.mjs 80` ×3 → **1 ✔ / 0 ✘** las tres · `0 → 0`.
* `node qa/run.mjs 148` ×3 → **1 ✔ / 0 ✘** las tres.
* `uptime` durante las nueve: `load average` entre **1,77 y 2,42** (máquina tranquila; ningún rojo
  que re-correr).
* `npm run verify` (nefan-core, árbol limpio): **exit 0**.
* `node qa/run.mjs` completo, con el guion nuevo: **145 ✔ · 0 ✘ · 2 ⊘ de 147**, `load average`
  3,04–3,85 al cerrar. Log en `/home/al/code/ne-fan-qa-o/bateria-qa-o.log` (artefacto de sesión, sin
  commitear).

---

## Veredicto

**APTO CON HALLAZGOS.**

El cambio es correcto en las dos mitades que tocan al código: el sello viaja, lo escribe un solo
verbo del transporte desde la única fuente que lo sabe, la decisión vive en core y el cliente
entrega. Lo he ejercido desde el socket del jugador en los dos regímenes y en las tres identidades,
y no he encontrado ninguna forma de que el juego aplique un frame que no es suyo.

Lo que no estaba bien es lo de siempre: **de los cinco candados, ninguno sujetaba la línea que el
issue pedía** (H1) y **el régimen que justifica el diseño entero no lo recorría nadie** (H2). Los dos
quedan cerrados con el guion 148, que es trabajo de QA y no exige tocar producción.

Quedan para el ingeniero **dos correcciones de prosa, ninguna de código**:

1. **H3** — la justificación de la mitad del `lastState`, que afirma un síntoma que no es
   alcanzable. Es la lección «una decisión correcta con una razón inventada», y está escrita en
   cuatro sitios.
2. **H4** — el censo de `context.ts`: quitar el número (o derivarlo), porque la propia frase dice
   que se queda fuera y no se queda, y porque hoy ya no cuadra (34 en 11, no 31 en 11).

Con esas dos, y con el guion nuevo dentro, #659 se puede cerrar.
