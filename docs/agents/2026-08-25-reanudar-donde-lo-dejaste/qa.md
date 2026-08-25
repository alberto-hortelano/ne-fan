# QA — «Reanudar te devuelve donde lo dejaste» (#245 · #249 · #246)

Validado sobre `fix/reanudar-donde-lo-dejaste` @ `904fb20`, árbol limpio, contra la petición
original y el addendum de `requisitos.md` (no contra el plan). Todo en vivo con el preset
`e2e-sin-creditos`, **0,00 € de gasto** (`gasto sesión 0,00 € · total 0,00 €` en las capturas) y
**GPU real** en las cuatro corridas: `webgl: ANGLE (NVIDIA … RTX 3060 …)`, no SwiftShader.

**Veredicto: NO APTO.** Un hallazgo bloqueante, reproducido tres veces, determinista: el arreglo
de #245 abre un camino de dos clicks desde el título que **corrompe el save de la partida viva** y
hace que «Reanudar» te deje en las coordenadas de un muñeco de fixture. Todo lo demás del encargo
está cumplido y bien candado.

---

## 1. Criterios de aceptación literales

Sacados de la cita del usuario y del «Criterio de terminado, ampliado» del addendum.

| Criterio | | Evidencia |
|---|---|---|
| **Guardar, salir, reanudar y estar donde estabas** — no en el origen, no dentro de un edificio; en el flujo real desde el arranque | ✅ | `node qa/run.mjs 17-la-partida --diag`, verde. `el jugador anduvo hasta {x:0.25, z:5.3149} (2.1 m)` → `reanudó en {x:0.25, z:5.3149}`, con `__player_start {x:0.25, z:3.25}`. Captura `qa/capturas/17-…-03-partida-reanudada.png`: la taberna **desde la calle**, con tejado, camino y cielo (antes salía a oscuras encerrado en el volumen) |
| **…y la distinción «persistió» vs «cayó al `__player_start`» es real** | ✅ | Separación medida 2,06–2,35 m en cuatro corridas contra una tolerancia de 0,5 m. Una implementación que dejara al jugador en `__player_start` fallaría `cerca(posDespues.z, posAntes.z)` porque \|3,25 − 5,31\| = 2,06 > 0,5. **Aserto probado en rojo por mí**: comentando `this.refreshPlayerFromRuntime()` en `NarrativeState.save()` el guion reproduce el bug original clavado — `save: [0,1,0] · vivo: {0.25,0,5.596}` y `reanudó en {x:0,y:0,z:0}`, con tres asertos en rojo. Revertido |
| **…con la vida que tenías** | ✅ | En vivo solo el caso GRUESO (guion 17: `…y con la vida que tenía`, 100→100; en el tile del bench no hay quien pegue). El caso fino —que el DAÑO sobreviva— lo canda `test/bridge-session.test.ts` «un guardado cualquiera del bridge lleva la posición y la vida VIVAS» (42 y 33 de HP leídos del `state.json`). La limitación está escrita dentro del guion, no vendida como otra cosa |
| **Un fallo tardío devuelve al título sin nada pegado del intento anterior** | ✅ | Guiones 18 (catch de `unIntentoDeArrancar`) y 20 (fallo TARDÍO real: `start_session` ok:true y el motor no responde). `__nefan.sesion()` de vuelta en el título = `NO_SESSION` exacto en los dos. **Probado en rojo por mí**: quitando `session.leave()` de `volverAlTitulo`, el guion 20 se pone rojo enseñando la sesión entera pegada (`sessionId 1787667216-343ced`, `styleId acuarela_luminosa`, `combatSystem standard`, tema del pack). Revertido |
| **Los dos caminos de vuelta al título dejan el cliente idéntico** | ✅ | El objeto `sesion()` que imprimen 18 y 20 es byte a byte el mismo, y es `NO_SESSION` |
| **…y ninguno paga una imagen** | ⚠️ | El instrumento SÍ funciona (`caché 0✓/1✗` en el arranque de una partida nueva, captura `17-…-01`), pero **el escenario de #249 no se reproduce**: en 18 el `resume` rechaza y en 20 el motor nunca contesta, así que en ninguno de los dos LLEGA un tile después del fallo — que es justo la secuencia que paga el atlas. La protección es sólida por lectura (`generationOn: () => session.active && …`, y `leave()` deja `active=false`), pero **no está medida**. Sigue haciendo falta el endpoint de fallo a petición del fake (aparcado en #231/#248/#247) |
| **`save_session` retirado entero, grep a cero** | ✅ | `grep -rn "save_session\|session_saved\|SaveSessionMessage\|SessionSavedMessage\|handleSaveSession\|saveSession"` sobre `.ts/.mjs/.py/.json/.md`: solo `next.md:37` y `docs/agents/**`, los dos **fuera de los roots** de la regla |
| **…y su línea en `campos-retirados-no-vuelven`, probada en rojo** | ✅ | Metí `// QA: save_session` en `bridge/router.ts` y `test/architecture.test.ts` cayó: `✖ [error] campos-retirados-no-vuelven`. Revertido; los 37 tests de arquitectura verdes con mi guion nuevo dentro |
| **#246: ni HUD ni error-log se leen por debajo del título** | ✅ | Asertos DOM `cajas: {gameUi: 0, errorLog: 0, devStatus: 32000}` en 18 y 20, y **captura** `qa/capturas/18-…-02-de-vuelta-en-el-titulo-con-el-motivo.png`: el título limpio, sin fantasmas de la barra de acciones ni del panel de errores |
| **La asimetría de #249 es inexpresable** | ⚠️ | Parcial. Ver §2 |
| **`simDriver` no deja hueco por el que un socket cualquiera conduzca el sim** | ❌ | Tres huecos medidos, uno de ellos alcanzable por el jugador y con corrupción de save. Ver §3 y hallazgo B1 |
| **El caso real que justifica la desviación existe** | ✅ | Guion nuevo `qa/guiones/25-…`, primera mitad verde: `en la fixture: {x:-10.25, z:-0.75} → {x:-10.25, z:-1.686} (0.94 m)` · `✔ el modo fixtures SIGUE siendo jugable después de una partida en el mismo bridge` |

Gasto real de créditos: **no probado** (todo con el motor falso, por encargo).

---

## 2. La asimetría de #249: qué es inexpresable y qué no

Probado a mano, rompiendo y mirando (todo revertido):

| Intento | Resultado |
|---|---|
| Añadir `musicaDeAmbiente: string` a `SessionFacets` **sin neutro** | **NO COMPILA**: `error TS2741: Property 'musicaDeAmbiente' is missing … but required in type 'SessionFacets'` en `NO_SESSION`. ✅ como se prometía |
| Darle neutro y sink en `FacetSinks`, pero **no cablearlo en el cliente** | **NO COMPILA** el cliente: `nefan-html npx tsc --noEmit` → `Property 'musica' is missing … required in type 'FacetSinks'` (más los dos `session.enter`). ✅ |
| Darle neutro y sink pero **que `apply()` no lo llame** | **VERDE**. `node --import tsx --test test/session-facets.test.ts` → 6/6 pass. El «test que enumera el record» enumera `Object.keys(sinks)` del **doble del test**, y `tsc` no mira `test/**` (el `include` del `tsconfig.json` es `src`, `bridge`, `services`). Si alguien actualiza el espía, entonces sí cae: `✖ leave invoca TODOS los sinks — AssertionError: leave() no deshace el sink "musica"`. Pero **nada obliga a actualizarlo** |
| Volver al título por un **tercer camino** que se olvide de `session.leave()` | **Compila y pasa `tsc`**. Solo lo caza un guion en vivo (lo verifiqué con el 20). No hay candado de tipos ni de test de unidad sobre los CAMINOS |

**Lectura**: la asimetría **entre facetas** sí es inexpresable, y eso es lo que producía el bug de
#249 (entrar ponía cinco cosas y salir deshacía una). La asimetría **entre caminos** no lo es:
`session.leave()` y `resetWorld()` siguen siendo dos llamadas que cada camino tiene que recordar.
Hoy los dos caminos existentes están candados en vivo (guiones 18 y 20) y no hay más
(`runTitleFlow` tiene exactamente dos llamantes, `main.ts:2499` y `:2559`), así que **el criterio
del encargo se cumple hoy**; lo que no se cumple es la promesa más fuerte del comentario del
módulo. Y ojo al patrón que sobrevive: `despiertaElAtlasDeLaSesion()` se llama al lado de
`session.enter()`, fuera del sistema de facetas y sin simétrico — es exactamente la forma del bug
que #249 arregló, aunque en este caso sea inocua (`resetWorld` pone `activeTileKey = null`, así que
al salir no hay nada que re-emitir; comprobado leyendo `main.ts:735` y `:382`).

**Lo que de verdad importa de #249** —que un fallo tardío no pague un atlas con el estilo de la
partida que no arrancó— queda **sólido por lectura y sin medir en vivo** (fila ⚠️ de §1).

---

## 3. La desviación del plan (`isSubscribed` → `simDriver`): las dos mitades

**Mitad 1 — ¿el caso real existe?** SÍ, verificado. Guion 25: con una partida viva en ese mismo
bridge, F5, título, «✕ Cerrar (modo fixtures)» y el selector «Room», el jugador **anda** dentro de
la fixture (0,94 m medidos). Con el gate del plan (`isSubscribed`) ese jugador se quedaría clavado,
porque el bridge conserva `session_id` y el cliente de fixtures no abre sesión nunca. La desviación
está justificada.

**Mitad 2 — ¿el modelo nuevo deja hueco?** SÍ, tres, medidos con una sonda de unidad sobre
`makeCtx()` (borrada tras medir):

| Hueco | Medida | Alcanzable por |
|---|---|---|
| **A · el socket conductor se cierra y otro toma el relevo sin tomar el mundo** | `ctx.simDriver = null` (literalmente lo que hace `ws-server.ts` en `ws.on("close")`) y un socket nuevo manda un `input`: el combatiente se va a `{0,0,2}` y el siguiente `narrative.save()` lo escribe: `[12,1,-6] → [0,0,2]` | **El jugador, con un F5** (ver B1). En el bridge NO hay candado para esto: lo único que lo tapa es el `titleScreen.isVisible → gameClient.idle()` del cliente |
| **B · `respawn` no está gateado** | Un socket ajeno manda `{type:"respawn", pos:{0,0,0}}` con la partida viva: el combatiente se teletransporta y el save siguiente lo persiste (`[12,1,-6] → [0,0,0]`) | Otro cliente / bench. El ingeniero lo declara en §5, pero decía «no escribe posición en el save por sí solo»: **con `bindPlayerRuntime` sí**, cualquier guardado posterior se la lleva |
| **C · `load_room` de un socket ajeno le roba el mundo a la partida viva** | Tras un `load_room` de otro socket, el `input` del jugador REAL ya no mueve nada (`{0,0,0} → {0,0,0}`) | Dos clientes. Menor, nadie lo ejercita hoy |

Y el descubrimiento que convierte el hueco A en el hallazgo bloqueante: **la tercera pata del
modelo (`load_room` toma el mundo y suelta la atadura) es código muerto desde el cliente**. Ver B1.

---

## 4. Hallazgos

### B1 · BLOQUEANTE — asomarse a una fixture corrompe el save de la partida y «Reanudar» te deja en el muñeco

**Repro desde el arranque** (0 €, `e2e-sin-creditos`; automatizado en `qa/guiones/25-mirar-fixtures-no-se-lleva-la-partida.mjs`):

1. `./start.sh --preset e2e-sin-creditos` y abrir la URL con `?ai=`.
2. Título → «Nueva partida» → `alta_fantasia` → Continuar → Comenzar.
3. Andar 2 m calle arriba. El save de disco ya lleva la posición viva: `[0.25, 0, 5.4926]` ✔.
4. **F5** (o cerrar y reabrir la pestaña). Sale el título; NO se pulsa «Reanudar».
5. Pulsar **«✕ Cerrar (modo fixtures, sin sesión)»** y elegir una fixture del selector «Room».
6. Andar un poco dentro de la fixture.
7. El motor escribe algo en la partida (una generación en vuelo, un evento de la agenda: en el
   guion se provoca con un `POST /map/place` del State API, que es el mismo cable de las tools MCP).

**Qué esperaba el jugador**: que mirar una escena de prueba no toque la partida que dejó a medias.
**Qué pasa**: el `state.json` de la partida pasa de `[0.25, 0, 5.4926]` a `[-10.25, 0, -1.6805]`
—la posición del muñeco de la fixture— y al pulsar «Reanudar» **aparece ahí**: otro rincón del tile,
detrás de la taberna, entre los árboles. Captura
`qa/capturas/25-mirar-fixtures-no-se-lleva-la-partida-03-de-vuelta-a-la-partida.png`.

**Reproducido 3/3 veces**, determinista, con la GPU real.

**Mecanismo** (leído y confirmado):

- `handleLoadRoom` es el ÚNICO sitio del bridge que suelta la atadura (`ctx.narrative.bindPlayerRuntime(null)`).
- El cliente **solo manda `load_room` para escenas que NO son tile**: `nefan-html/src/main.ts:1063-1069`,
  rama `else` de `isGridTile`. El único emisor del mensaje es `bridge-client.ts:228`, alcanzable
  solo desde ahí.
- Las **tres** fixtures del selector (`nefan-core/data/scenes/{puerto,robledo,zorder_test}*.json`)
  son Format D con `tile`, así que `isGridTile` es siempre `true`. **`load_room` no lo manda nadie.**
- Y tras el F5, `simDriver` vuelve a `null` (`ws-server.ts`, `ws.on("close")`), así que el socket
  nuevo pasa la guarda de `handleInput` sin haber tomado el mundo.

Es decir: el test `«cargar una fixture toma el mundo y suelta al jugador de la partida»`
(`test/bridge-session.test.ts`) está verde **contra un mensaje que el cliente ya no manda** — usa
`crypt_001`, una sala legacy sin `tile`. Es un candado sobre un camino que nadie recorre, y por eso
la afirmación del informe de implementación («mirar una fixture con una partida viva ya no puede
meter al muñeco de la fixture en su save») es falsa en el flujo real.

**Es nuevo de esta tanda**: antes `NarrativeState.player.position` no se refrescaba nunca
(`handleSaveSession` no lo llamaba nadie), así que el save siempre llevaba `[0,1,0]` y ningún muñeco
podía entrar en él. El síntoma es distinto y peor que el de #245: antes reanudabas siempre en el
origen; ahora reanudas donde estuviera un muñeco de otra escena.

**Diagnóstico verificado** (experimento de una línea, **revertido, no aplicado**): añadiendo
`ctx.narrative.bindPlayerRuntime(null)` junto al `ctx.simDriver = null` del cierre de socket, el
guion 25 sale **10/10 verde**, incluida la mitad que exige que las fixtures sigan siendo jugables.
Eso cierra la variante del F5. **No cierra** la variante de volver al título con el MISMO socket
(el botón «Volver al título» del muro) y cerrarlo luego a modo fixtures: ahí `simDriver` sigue
siendo ese socket y la atadura sigue puesta. La decisión de por dónde arreglarlo es del ingeniero;
lo que este informe afirma es el fallo y su mecanismo.

### I1 · IMPORTANTE — el candado de «nadie de fuera conduce el sim» vive en el cliente, no en el bridge

El hueco A de §3 no lo tapa nada en `nefan-core`: lo tapa `titleScreen.isVisible ? gameClient.idle() : …`
en `nefan-html/src/main.ts`. El propio informe de implementación lo dice a medias («el candado del
cliente solo se ve en rojo con el otro también fuera»); la medida es más dura: **para el caso del
F5 —el que motivó el gate— el candado del cliente es el ÚNICO**, y vive en la capa que este
proyecto define como «solo pinta». Cualquier socket que no sea `nefan-html` (el bench de
`labs/narrative`, una segunda pestaña, el `replay-server`) reproduce el hueco sin pasar por él.

### I2 · IMPORTANTE — «ninguno paga una imagen» no está medido

Ver la fila ⚠️ de §1. El contador `caché H✓/M✗` es un instrumento válido (marca `0✓/1✗` en el
arranque de una partida nueva), pero ni el guion 18 ni el 20 llegan a producir la secuencia que
describe #249: un tile que LLEGA después de que el cliente ya haya vuelto al título. El fake no
sabe fallar tarde y luego acertar. Queda como el mejor argumento a favor del endpoint de fallo a
petición de #231/#248/#247.

### I3 · IMPORTANTE — `handleRespawn` sí puede escribir en el save

El informe lo declara como «no lo toqué, no escribe posición en el save por sí solo». Con
`bindPlayerRuntime` atado, **sí**: cualquier `narrative.save()` posterior persiste el
teletransporte. Medido (hueco B de §3). No es alcanzable con un solo cliente, pero la razón por la
que se dejó fuera ya no vale.

### M1 · MENOR — el «test que enumera el record» depende de un doble que nada obliga a completar

Ver §2, tercera fila. `tsc` no cubre `test/**`, así que un sink nuevo sin llamar en `apply()` pasa
`npm run verify` entero. El daño posible es simétrico (la faceta no se aplica ni se deshace), no la
asimetría de #249, pero la promesa escrita en el módulo («o el test que enumera el record se pone
rojo») es más fuerte de lo que el candado sostiene.

### M2 · MENOR — el botón «✕ Cerrar (modo fixtures)» sigue medio tapado por la barra de dev

Visible en `qa/capturas/18-…-02` y `20-…-02`: el botón queda cortado bajo `#dev-status`
(z-index 10000). Es preexistente y territorio de #250/#251, pero esta tanda **reafirma la
decisión** (la regla nueva de `dev-ui.css` esconde `#game-ui` y `#error-log` y deja `#dev-status`
a propósito, con su motivo escrito). Si el título es la primera pantalla del juego, su único botón
de escape ilegible es una fricción real. Con la regla de #246 puesta, esconderlo también mientras
el título está arriba sería un carácter — pero se pierde justo la vigilancia del gasto que motivó
dejarlo. Decisión de producto, no la tomo yo.

### M3 · MENOR — las etiquetas de mundo no ocluyen

En `qa/capturas/17-…-03-partida-reanudada.png` la etiqueta «Tabernero corpulento» flota sobre el
vano de la puerta con el NPC **detrás de la pared**: se lee como si el tabernero estuviera en la
calle. Preexistente y ajeno a esta tanda (ya lo anotó el ingeniero); lo confirmo porque sale en la
captura que es la evidencia principal del encargo.

### M4 · MENOR — crítica visual del primer frame de una partida nueva

`qa/capturas/17-…-01-partida-recien-empezada.png`: el jugador nace con la cámara a ~2 m de la
fachada de la taberna y mirándola de frente, con el alero llenando el tercio superior de la pantalla
de una banda naranja plana. Como primer fotograma de una partida es pobre: no hay lectura de
espacio, ni horizonte, ni sensación de pueblo. Es el `__player_start` del tile del motor falso, no
del código de esta tanda, pero es el encuadre que hereda cualquiera que mire estas capturas.
Lo bueno, para contraste: la captura de la partida REANUDADA (03) sí compone —fachada entera,
tejado con pendiente legible, camino que guía la mirada, cielo con degradado y luz única
coherente—, y es exactamente el criterio del encargo cumplido.

---

## 5. Guion ejecutable entregado

`qa/guiones/25-mirar-fixtures-no-se-lleva-la-partida.mjs` (+ su fila en `qa/README.md`).

```
node qa/run.mjs 25-mirar --diag     # e2e-sin-creditos, 0 €, ~35 s
```

Cubre lo mecánico de la desviación del plan, que no cubría ningún guion:

1. el modo fixtures sigue siendo jugable después de una partida en el mismo bridge (la mitad que
   justifica `simDriver` frente a `isSubscribed`), y
2. asomarse a una fixture no toca el `state.json` de la partida viva, ni al reanudar.

**Declara `aisla: ["saves"]`** (stack propio, no contamina la batería). Entra por el camino del
jugador: título → Comenzar → andar → F5 → «✕ Cerrar (modo fixtures)» → selector «Room». Ningún
overlay ocultado a mano, ningún estado fabricado.

**Probado en negativo, en los dos sentidos**:

- **Nace ROJO** por el hallazgo B1 (3/3 corridas), no por deuda ajena.
- **Sale VERDE 10/10** con el experimento de diagnóstico de una línea descrito en B1 — que fue
  revertido. Eso es lo que demuestra que el aserto discrimina y no está rojo por construcción.
- El aserto «el jugador se ha ALEJADO del arranque» es un no-concluyente antes que un verde: si el
  paseo no ocurre, el guion cae ahí en vez de aprobar una medida que no distingue nada.

Los guiones 17, 18 y 20 de la tanda **los probé yo en negativo también**, y los tres discriminan:

| Candado | Cómo lo rompí | Qué se puso rojo |
|---|---|---|
| El save lleva la posición viva | comentar `this.refreshPlayerFromRuntime()` en `save()` | guion 17: `✘ el state.json … lleva la posición VIVA` · `✘ reanudar deja al jugador DONDE ESTABA` (`reanudó en {0,0,0}`) · `✘ …y no en (0,0)` |
| Los dos caminos dejan el cliente igual | quitar `session.leave()` de `volverAlTitulo` | guion 20: `✘ un fallo TARDÍO devuelve el cliente al estado del título` con la sesión entera pegada |
| `save_session` no vuelve | escribir `save_session` en `bridge/router.ts` | `✖ [error] campos-retirados-no-vuelven` |
| Faceta sin neutro | añadir un campo a `SessionFacets` | `tsc`: `TS2741` en `NO_SESSION` |

Todo revertido; `git status` limpio salvo el guion nuevo y la fila del README.

---

## 6. Workarounds usados

Ninguno que afecte a lo que verifico. Los tres apoyos que usé y por qué no son trampa:

| Apoyo | Veredicto |
|---|---|
| `__nefan.sesion()` para leer las facetas de vuelta en el título | Es un hook de lectura que expone esta misma tanda; no fuerza estado ni oculta nada. Sin él, «los dos caminos dejan el cliente idéntico» no sería medible |
| Provocar el guardado del bridge con un `POST /map/place` del State API mientras el jugador está en otra pantalla (lo hacen el guion 17 y el mío) | **No es un apaño: es el caso real.** El motor escribe por ese mismo cable durante la partida (una generación en vuelo, un evento de la agenda), y ese es el instante exacto en el que se pierde la posición. Sin provocarlo, el fichero no se reescribe y el aserto sería un verde incapaz de ponerse rojo — el propio ingeniero lo corrigió así en el 17 |
| Sonda de unidad sobre `makeCtx()` para medir los huecos de `simDriver` (§3) | Herramienta de diagnóstico, borrada al terminar. El hueco A además **está reproducido en vivo** por el camino del jugador (B1), así que no descansa en la sonda |

Ningún `display:none`, ningún estado sintético, ninguna pantalla saltada.

---

## 7. No probado

- **Gasto real de créditos**: todo con el motor falso, por encargo. «Ninguno paga una imagen» está
  medido como «no hubo generación», que es la señal correcta, pero no es una factura.
- **La secuencia de #249 (tile que llega DESPUÉS del fallo tardío)**: el fake no sabe fallar tarde y
  acertar después. Ver I2.
- **Variante de B1 sin F5**: partida → muro → «Volver al título» → «✕ Cerrar (modo fixtures)». Por
  lectura, ahí `simDriver` sigue siendo el mismo socket y la atadura sigue puesta, así que el fallo
  debería ser el mismo; no lo he medido porque el bench no llega a esa combinación en un guion.
  **Quien arregle B1 tiene que cubrir las dos variantes**, no solo la del F5.
- **`npm run mutate` de `session-facets`**: no lo corro (política #266). Mi lectura, por si sirve:
  **no deja un hueco real**. Los dos mutantes interesantes que nombra el `porque` del target —quitar
  una llamada a un sink dentro de `apply` y cambiar un neutro de `NO_SESSION`— los matan hoy el
  aserto de enumeración y el `deepEqual` de llamadas (lo verifiqué a mano: con un sink sin llamar y
  el espía completo, el test cae con `leave() no deshace el sink "musica"`). El agujero que sí existe
  en ese módulo es M1, y **la mutación tampoco lo vería**: es un problema del alcance de `tsc`, no
  de la potencia de la batería. La nocturna puede recogerlo sin prisa.
- **Batería completa**: no la repetí (política de frugalidad + el usuario delante). Corrí 17, 18, 20
  y 25 en cuatro stacks propios. El `15` sigue rojo por #247/#262 y es ajeno; el ingeniero midió
  22/23 verdes con esta rama y mi guion 25 confirma en vivo la mitad que a ellos les importaba (las
  fixtures siguen siendo jugables tras una sesión en el mismo bridge).

---

## 8. PARA EL USUARIO

1. **B1 es una decisión de producto además de un bug**: hoy el título ofrece un botón «✕ Cerrar
   (modo fixtures, sin sesión)» que es una puerta de desarrollo dentro de la pantalla de inicio del
   juego. El arreglo mínimo (soltar la atadura) tapa el daño; la pregunta más grande es si esa
   puerta debe seguir estando ahí para quien juega, o si el bridge debería enterarse de que el
   jugador se fue al título (el backlog que el plan §6 ya proponía como issue y que **no se ha
   abierto**).
2. **M2**: el botón de escape del título queda ilegible bajo la barra de dev. Esconder la barra con
   el título arriba es un carácter, pero pierde la vigilancia del gasto que motivó dejarla. Dígalo
   usted.
3. **El daño persiste al reanudar** (asunción del addendum, confirmada en el código y en los tests).
   Si prefiere que reanudar cure, es cambiar una línea.
4. **Issues que el ingeniero dejó apuntados y no abrió**: trocear `main.ts`; el bridge que no se
   entera de que el jugador se fue al título; `inpaint_scene_plate`/`peel_scene_layer` a
   `campos-retirados-no-vuelven`. Añado: **I3** (gatear `handleRespawn`) y **M1**.

---

## Veredicto

**NO APTO.** #249 y #246 están cumplidos y bien candados, y #245 está cumplido **en el camino
principal** —guardar, salir, reanudar y aparecer donde estabas con la vida que tenías, verificado en
el flujo real desde el arranque y con la captura que antes salía a oscuras dentro de la taberna—.
Pero el mecanismo que lo consigue deja al save escuchando al sim de forma permanente, y el único
candado que lo suelta (`handleLoadRoom`) es inalcanzable desde el cliente de hoy: dos clicks desde
el título bastan para escribir en la partida guardada la posición de un muñeco de otra escena. Un
save que se corrompe en silencio es peor que uno que no guarda, porque el jugador se entera al
reanudar y no antes.

Vuelve al ingeniero con B1 (bloqueante, con guion), I1, I2 e I3.
