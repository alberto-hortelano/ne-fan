# Triaje: el banco de pruebas, el arranque y el State API (11 issues)

Verificado contra `main` = `5d67c8ca` el 2026-09-10, en solo lectura. Ninguna batería corrida:
todo lo de abajo sale de leer el código de hoy y de contar ocurrencias con `node`/`grep`.

| # | Qué es | Veredicto | Quién y cuánto |
|---|---|---|---|
| 424 | el aviso de `--parar` promete un barrido que `--parar-todo` no hace | **VIGENTE** | ingeniero · 1-2 h (junto con #428) |
| 428 | tres caminos de `start.sh` responden «¿de quién es este puerto?» | **VIGENTE** (valor bajo) | ingeniero · 1 h, en la misma PR que #424 |
| 463 | `GET /entity/player` 200 con jugador fantasma vs `/story` 404 | **VIGENTE** (sin decisión: el repo ya eligió) | ingeniero · 2-3 h |
| 476 | el runner miente sobre la causa (hojas base) y fabrica una URL rota | **VIGENTE** las dos mitades | ingeniero · 2 h |
| 486 | las anclas de los candados en negativo no se comprueban en CI | **VIGENTE, MENOR** (la mitad de `esperas-` no tiene sujeto) | ingeniero · 2 h |
| 494 | `sprites-sin-servicio.mjs` activa `.venv` a mano | **VIGENTE**, literal | ingeniero · 30 min |
| 496 | el bridge sirve la vida ambiental del guion anterior | **VIGENTE, MAYOR** (es del bridge, no solo del banco) | ingeniero · 3-4 h |
| 498 | el fake solo sirve `idle` → el banco juega en maniquí | **VIGENTE** (con respuesta canónica escrita en el propio banco) | ingeniero · 2-3 h |
| 501 | el lock de bloques de puertos es por árbol | **VIGENTE, MENOR** (el sondeo de puerto ya existe) | ingeniero · 1 h |
| 545 | la batería sale intermitente bajo carga | **REENCUADRADO** (+ 1 decisión del usuario, ver abajo) | ingeniero · el reproductor primero |
| 550 | `esperarListaDeSaves` espera un texto muerto | **VIGENTE, REFORZADO** (además el presupuesto no puede casar) | ingeniero · 1 h |

**Decisiones del usuario en esta familia: UNA**, y es la política de #545 (al final).

---

## #424 · el aviso final de `--parar`

**VIGENTE**, literal. `start.sh:1338` — la rama segura enumera los diez bloques
(`for off in 0 100 200 … 900`); `start.sh:1322-1328` — la rama `todo` usa `puertos=("${ALL_PORTS[@]}")`
y su propio texto dice «Solo el bloque VIGENTE (+$PORT_OFFSET)»; `start.sh:1402-1403` — el aviso
«Para llevarte también lo ajeno: `./start.sh --parar-todo`» sale con `saltados == 1`, o sea con
cualquier ajeno de cualquiera de los diez bloques.

El candado que #424 pide **no existe todavía**: `qa/parar-clasifica-los-nueve-puertos.mjs:232-240`
afirma «el aviso sale si y solo si el informe imprimió al menos un AJENO», y su señuelo se planta en
puertos del bloque VIGENTE (`P.html`, `P.fake_ai`, línea 171) — el caso que miente (ajeno en otro
bloque) no se ejerce.

**Qué hacer**: ingeniero, sin preguntar. El espacio de opciones lo cierra la regla de la casa: el
aviso no puede recomendar un arma que «no le cerréis sus servers» prohíbe, así que la salida honesta
es que el texto diga la verdad sobre lo que `--parar-todo` alcanza. Añadir al candado un señuelo en
un bloque distinto del vigente.

## #428 · la foto de dueños, una sola vez

**VIGENTE** y las tres citas casan **exactamente**: `require_port_free` en `start.sh:262`, `cmd_stop`
en `:1321`, `cleanup` en `:1427`. La primitiva de dos pasadas (resolver todos los dueños antes de
matar a ninguno, matar por PID) vive entera dentro de `cmd_stop:1345-1400` y no se puede reusar.

Es el issue **más flojo de los once**: nada está roto, y su justificación —«la próxima función que
necesite decidir a quién matar volverá a escribirlo mal»— es una predicción, no un hecho; hoy no hay
ninguna función pendiente que la necesite. No lo cierro porque el coste es de una hora y toca la
misma zona que #424: **hacerlos en la misma PR sale casi gratis**; hacerlo solo, no vale la espera.

## #463 · dos semánticas de «sin partida» para leer

**VIGENTE**, verificado por las dos puntas:
- `bridge/state-http/entity-routes.ts:32-33` devuelve `ok({… player: ctx.narrative.player})` sin mirar
  la sesión, y ese `player` es `structuredClone(DEFAULT_PLAYER)` (`src/narrative/narrative-state.ts:186`)
  — el jugador fantasma es real.
- `bridge/state-http/doc-routes.ts:33, 52, 74` devuelven 404 «no active session».
- La guarda de mutación existe y es solo para mutadoras: `state-http/dispatch.ts:87-104`
  (`if (!WorldStateApi[key].mutates) return null` → 409). No hay `requiere_sesion` en ningún sitio
  (`grep mutates` en `src/contracts/http.ts:32,42` es todo lo que hay).

**No es decisión del usuario**: no cambia lo que el banco cubre ni gasta créditos, y el repo ya eligió
para las LECTURAS — 404 es lo que hacen los documentos, y es la respuesta canónica de HTTP para un
recurso que no existe. El 409 es de las escrituras, que hablan de un conflicto de estado.
**Qué hacer**: ingeniero. La caracterización (`test/state-http-caracterizacion.test.ts:450`) afirma hoy
el 200 y hay que cambiarla en el mismo commit.

## #476 · el runner miente sobre la causa, y `--url` con query

**VIGENTE las dos mitades.**

1. `nefan-html/public/sprites/` está gitignored (`.gitignore:53`, confirmado con `git check-ignore`) y
   el cliente sabe decirlo bien (`src/protocol/status-motivo.ts:148`, «Faltan las hojas de sprites del
   personaje, que no viajan en el repositorio»). `qa/run.mjs` no comprueba nada de eso antes de
   arrancar: cero menciones de `public/sprites` en el fichero.
2. `qa/run.mjs:210` (`const BASE = opt("--url", URLS.html)`), `:247` (`URL_QS` empieza por
   `?input=scripted&…`) y `:952` (`page.goto(\`${BASE}/${URL_QS}\`)`). La concatenación es literal:
   con `--url http://x/?offset=500` sale `…/?offset=500/?input=scripted…`.

**Qué hacer**: ingeniero. Es exactamente el mismo canal que ya existe (`⊘` con motivo) aplicado antes
del primer guion. Emparentado con #494: los dos son «rojo del entorno disfrazado de rojo del juego».

## #486 · las anclas de los candados en negativo

**VIGENTE, y MENOR de lo que dice.** Tres correcciones:

- La comprobación «el patrón aparece exactamente una vez» **ya existe**, pero dentro de la corrida
  cara: `qa/bateria-candados-en-negativo.mjs:327-333`. Lo que falta es sacarla a un ejecutable
  headless. El issue lo pide bien; solo conviene saber que no hay que escribirla, sino mudarla.
- **Las ocho anclas están vivas hoy** (contadas una por una: `fixtures-del-selector.ts` ×1, guion 34
  ×4, `keyboard-input-provider.ts` ×2, guion 02 ×1). El programa #346 movió medio título y no rompió
  ninguna — el riesgo es real pero no está materializado, así que esto no es urgente.
- La segunda mitad del issue **no tiene sujeto**: `qa/esperas-candados-en-negativo.mjs` no parchea
  código de producción, **escribe guiones temporales suyos** en `qa/guiones/` (`:367`, prefijo
  `zzz-espera-en-negativo-`) y los borra. No hay ancla que se pueda pudrir ahí. Esa frase hay que
  quitarla del criterio de aceptación o el que lo haga perseguirá un fantasma.

También caducó su argumento de urgencia: citaba «quedan seis cortes en #358», y #358 y #346 están
cerrados. **Qué hacer**: ingeniero, con el alcance corregido (solo `bateria-`), undécimo paso del job
`candados-headless` (`.github/workflows/ci.yml:198-247`).

## #494 · `sprites-sin-servicio.mjs` y el `.venv`

**VIGENTE**, literal y verificado línea por línea: `qa/sprites-sin-servicio.mjs:191` y `:362` hacen
`source .venv/bin/activate`; `.gitignore:2` es `.venv/` **con barra**; y el resto del banco ya tiene
la primitiva buena (`qa/lib/python.mjs`, usada por `el-npc-cruza-ai-server-…` y
`el-ledger-de-gasto-…`). **Qué hacer**: ingeniero, media hora, sin preguntar.

## #496 · la vida ambiental del guion anterior

**VIGENTE, y MAYOR de lo que dice: no es un defecto del banco, es un agujero del bridge.**

Lo que el issue llama «difundir» es más concreto y más grave:

- `narrative_event` y `narrative_status` **llevan sello de sesión desde #282** y el cliente los filtra
  (`nefan-html/src/net/narrative-client.ts:98`, «evento de otra partida descartado»).
- **`state_update` no lleva sello**: `nefan-core/src/protocol/messages.ts:295-338` no tiene `sessionId`.
  Se sirve por `ctx.send(ws, …)` (`bridge/handlers/simulation.ts:89-96`) como respuesta al `input` de
  CUALQUIER socket, con `npcs: getNpcStates(ctx)` leídos del `NarrativeState` que el bridge tenga
  cargado. Una página sin sesión que haga tick recibe los NPC de la sesión anterior, y el cliente
  escribe la entrada de error (`nefan-html/src/world/lo-que-manda-el-bridge.ts:51-56`).
- El runner **no tiene ningún verbo que reinicie la sesión viva del bridge**: `qa/run.mjs:559-594`,
  `aisla` solo sabe `saves` (borra el directorio), `mundo` y `fake-ai`. Ninguno toca el proceso.

O sea: el mismo agujero que #282 cerró para dos canales sigue abierto en el tercero, y en partida real
es el caso «vuelvo al título y empiezo otra». La pregunta que el issue plantea al bridge («¿debe un
cliente sin sesión recibir movimientos de NPC de otra sesión?») **ya está contestada por el propio
repo para los otros dos canales**: no. **Qué hacer**: ingeniero; no hay decisión que pedir.

## #498 · el fake solo sirve `idle`

**VIGENTE**, con la cadena entera verificada:
`labs/narrative/fake-ai-server.ts:127` (`SKIN_SPRITE_MODEL ?? "paladin"`) · en disco
`nefan-html/public/sprites/paladin/` tiene **solo `idle`** (`y_bot` tiene las diez) ·
`fake-ai-server.ts:649-654` contesta **500** a lo que no encuentra ·
`nefan-core/src/session/fusible-de-skins.ts:41` cuenta como evidencia todo 5xx, umbral 3 (`:23`).

Y la respuesta canónica ya está escrita **dentro del banco**: `qa/guiones/53-…mjs:30-36` dice que
«un 404 es lo que devuelve el servidor real ante una anim que no tiene, y el cliente lo trata como lo
que es (`!backendDown`): cancela ESA anim y no cuenta contra el umbral». El fake contesta 500 donde el
real contesta 404: eso es el defecto, y arreglarlo conserva el camino de cancelación que el comentario
del fake dice querer ejercitar.

**Aviso para quien lo haga**: los guiones 51, 53 y 88 sabotean con `page.route` (no dependen del fake),
pero el **bloque D del 53** (`:277-300`) mide a propósito «lo que ve un jugador del banco» hoy, que es
el fusible saltado. Ese bloque cambia de significado con el arreglo y hay que reescribirlo, no borrarlo.

## #501 · el lock de bloques de puertos

**VIGENTE, y MENOR de lo que dice.** El directorio sigue siendo del árbol (`qa/run.mjs:144`,
`join(here, ".tmp", ".bloques")`), así que dos worktrees pueden reservar el mismo `+0`. Pero la
pregunta abierta del cuerpo —«¿el lock sí comprueba el puerto?»— **ya tiene respuesta y es que sí**:
`qa/run.mjs:184-190` sondea `fake_ai`, `bridge` y `html` del bloque antes de quedárselo. Lo único que
queda es mover el directorio fuera del árbol, para cerrar la ventana entre el sondeo y el bind (que es
justo para lo que el lock existe, `:138`).

Además, **#545 lo descarta como causa de la intermitencia** (su tercer comentario, con reproductor de
un solo árbol). Es robustez de un caso raro, no la explicación de nada. **Qué hacer**: ingeniero, barato.

## #545 · la batería intermitente

**REENCUADRADO.** El issue pide «saber en qué falló el 91»; cinco comentarios de medidas ya han
contestado a la pregunta que importa, que no es cuál falló sino **por qué falla uno cualquiera**.

**El problema real, en una frase**: la batería presupuesta en **reloj de pared** el progreso de un
juego cuyo reloj de simulación **se topa a 0,1 s por frame**, así que bajo contención de CPU los dos
relojes divergen y cualquier presupuesto fijo compra menos juego del que su autor midió.

La cadena, entera y verificable:

- `nefan-html/src/main.ts:593` — `const delta = Math.min((now - lastTime)/1000, 0.1)`. Todo retraso del
  loop por encima de 100 ms es **tiempo de simulación descartado**, no recuperado.
- `nefan-html/index.html` (`?raf=timer`) — en el banco el loop lo bombea un Web Worker cada **33 ms**.
  Con la pestaña oculta ya se va a ~30 fps nominales; una parada de 300 ms del hilo principal cuesta
  200 ms de juego.
- `qa/lib/sonda.mjs:113-121` — `waitFor` sondea cada **150 ms de pared** con un `page.evaluate` (ida y
  vuelta CDP), y el `maxMs` es de pared.
- Ejemplo medible en el reproductor histórico: `qa/guiones/91-…mjs:132-168`, `empujarContra` declara
  «parado» tras **3 sondeos consecutivos** con menos de 2 cm de avance, dentro de 12 s de pared. Con el
  hilo principal starved, tres sondeos pueden caer dentro de un mismo hueco del loop: se lee una parada
  donde el jugador seguía andando, y el aserto de la caja (`:244-249`) cae con una posición falsa.

Esto explica lo que las cinco medidas del issue muestran y lo que la hipótesis del estado heredado no
explica: **fallan mecanismos distintos** (la colocación de spawns del 81 no tiene nada que ver con el
`#error-log` del 80) porque lo que falla no es un mecanismo, es el presupuesto que todos comparten.

Casos que **no** son de esta clase y hay que sacarlos del saco:
- `qa/guiones/80-…mjs:148` es el ÚNICO aserto de toda la batería que compara el **recuento global** del
  `#error-log` (contado: 31 guiones lo leen, uno solo lo afirma así). Su entrada intrusa es la de #496,
  y se cura con #496 o afirmando sobre la entrada, no sobre el total.
- **#544 es un miembro ya abierto de esta misma clase** (una espera que llega antes que el estado que
  afirma) y no está enlazado desde aquí. #545 debería nombrarlo.

**¿Hay hipótesis suficiente para arreglarlo? Sí.** Lo que falta no es diagnóstico, es **un rojo a
demanda**: hoy ningún arreglo se puede demostrar, porque el fallo aparece una vez de cada tres y solo
en la máquina de otro. Dos medidas, en este orden y las dos baratas:

1. **El reproductor**: correr 91 (o 80, u 81) con carga sintética de CPU al lado y ver el rojo salir a
   voluntad. Sin esto, cualquier PR que diga «arreglado» lo dirá sin poder enseñarlo.
2. **El número que decide**: segundos de simulación por segundo de pared, con la máquina quieta y con
   la máquina cargada. Si baja de 1 bajo carga, la cadena de arriba queda probada y cada aserto
   afectado se puede reescribir contra un reloj que el juego posea. Si no baja, mi reencuadre es falso
   y hay que volver al estado entre guiones.

## #550 · `esperarListaDeSaves`

**VIGENTE, y REFORZADO.** El cuerpo es exacto: `qa/lib/sesion.mjs:188` acepta
`/No se puede contactar al bridge/`, y esa frase solo sobrevive **dentro de un comentario** del cliente
(`nefan-html/src/ui/titulo/home.ts:184`); lo que el home escribe hoy en `#ts-status` es
«No se pudieron cargar las partidas guardadas. …» (`home.ts:189`).

Lo que el issue no dice y hace falta para arreglarlo bien: **corregir el texto no basta**. La espera
compartida tiene 30 s de presupuesto (`sesion.mjs:183`) y la petición que espera tiene **exactamente
los mismos 30 s** de timeout (`nefan-html/src/net/bridge-client.ts:243`), así que la rama del bridge
caído solo puede casar por suerte — es la «banda garantizada» contra la que avisa la regla 1 de
`qa/README.md`. La otra cara de esto es **#425** (30 s mudos con el bridge caído), que está en otra
familia; quien arregle #550 debe leerlo primero, y de paso corregir su cita: #425 apunta a
`title-screen.ts:544`, que #346 se llevó a `ui/titulo/home.ts`.

Es un guardián que no puede ponerse rojo: por criterio, defecto, no decisión. Lo usan 20+ guiones,
pero solo por la rama viva (`^Bridge OK`), así que el arreglo es contenido.

---

## La única decisión del usuario de esta familia

Sale de #545, y no es sobre cómo arreglarlo (eso es ingeniería) sino sobre **qué promete la batería
mientras se arregla**. Hoy la promesa que se está usando —«93/93 sin retocar un guion» valida un
corte— es falsa con la máquina compartida, y las cuatro medidas del issue dicen que es cierta con la
máquina quieta. Con 2 ingenieros + 2 QA en paralelo, eso hay que pagarlo de alguna forma:

> **¿Serializo las baterías de la máquina mientras se arreglan los asertos?** Un lock global (una
> batería a la vez en el checkout entero) haría que cada corrida volviera a ser un veredicto, al
> precio de que hasta tres agentes esperen su turno — del orden de una hora de espera acumulada por
> tanda. La alternativa es dejarlas convivir y aceptar que un rojo de la batería larga no significa
> nada hasta reproducirlo aislado, que es lo que ya se está haciendo a mano.
>
> Opciones: **(a)** lock global ya, y se retira cuando los asertos dejen de medir por holgura ·
> **(b)** nada: la batería sigue siendo indicativa bajo carga y el veredicto es la corrida aislada ·
> **(c)** ninguna de las dos, y la batería se declara «solo válida con la máquina quieta» en
> `qa/README.md`, que es documentar lo que ya pasa.
>
> Mi recomendación: **(b) + arreglar los asertos**, porque (a) cuesta tiempo suyo todas las tandas y
> el reproductor bajo carga sintética da el rojo a demanda sin quitarle la máquina a nadie. Pero el
> precio de esperar lo paga usted, así que lo decide usted.

Nada más de esta familia necesita su decisión: los otros diez son defectos con dueño y con respuesta
canónica ya escrita en el repo, y ninguno gasta créditos ni cambia lo que el banco cubre.
