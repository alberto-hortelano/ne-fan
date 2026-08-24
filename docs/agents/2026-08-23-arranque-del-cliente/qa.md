# QA — El arranque del cliente (#181 + #189 + #180)

Rama `fix/arranque-del-cliente`, cambios sin commitear sobre `d5c3382`.

**Dos vueltas.** La primera (2026-08-23) devolvió **NO APTO** con cuatro cosas que paraban la
tanda. Esta segunda (2026-08-24) valida la **ronda de corrección** C1–C6, con **QA nuevo**: no
doy por buena ninguna medida del informe anterior ni del de implementación — todo lo que aquí
lleva un número lo he medido yo, desde el arranque real (`./start.sh --preset e2e-sin-creditos`,
cero créditos), y las pruebas en negativo las he reproducido una a una restaurando el árbol con
`md5sum -c` (nunca con `git checkout --`: en un árbol sin commitear eso se lleva la ronda entera
del fichero, como descubrió el ingeniero).

**Veredicto: APTO CON RESERVAS.** Los **cuatro bloqueantes están cerrados** y cada uno tiene su
medida y su rojo demostrado. La reserva es una sola y tiene nombre: **el botón «Cerrar» del muro
del mundo vacío sigue llevando, en un click, exactamente al callejón de #189** que C5 vino a
cerrar. No lo bloquea porque el criterio literal («que el overlay ofrezca volver al título») se
cumple y la salida está justo al lado; pero el estado sin salida sigue siendo alcanzable a
propósito y eso no puede cerrarse en silencio.

---

## 1. Criterios

Sacados de `requisitos.md` —petición original, reencuadre del crítico y la ronda C1–C6—, no del
plan ni del informe de implementación.

### 1.1 Los cuatro bloqueantes de la vuelta anterior

| # | Criterio (literal) | Veredicto | Evidencia MÍA |
|---|---|---|---|
| **C1 · 3.1** | «El botón no debe desplazarse bajo el cursor al llegar la lista de saves» — Δ 0 px en **coordenadas de viewport**, con 0 y con 3 saves | ✅ **cerrado** | Medido con partidas sembradas por el camino del jugador y espía de `MutationObserver` en el instante del pintado: **0 saves 193→193 px (Δ 0)**, **3 saves 193→193 (Δ 0)**, **12 saves 193→193 (Δ 0)**, y **900×600 con 3 saves 181→181 (Δ 0)**. El bloque crece de 262 a 672 px y su borde superior no se mueve del `top: 96px`. Capturas `qa/capturas/qa2-c1-{00,03,12}-saves.png` |
| | …y el candado se pone verde **por el arreglo**, sin tocar el guion | ✅ | `qa/guiones/19` es **byte a byte el de `d5c3382`** (`md5 055e4d94…`, `git diff` vacío). Su bloque 2, que la vuelta anterior dejó rojo, sale verde: `en el viewport: 193px → 193px`. **Negativo mío**: devolviendo la única línea a `justify-content: center`, el bloque 2 se pone **rojo** (`413px → 333px`, −80 px con 2 partidas) y mi medida independiente da **−220 px con 12** |
| **C2 · §2.3 y 3.1** | Del guion 18 salen los dos asertos que pasaban con el bug puesto; ninguno de los que quedan puede quedarse verde con su bug | ✅ **cerrado** | Los dos se fueron (`el botón NO se mueve` y `el título de vuelta está VIVO`), con la cabecera diciendo qué bloque del 19 recoge cada uno. **Los cinco que quedan los he puesto rojos yo, uno a uno** (§4): la guarda de NO CONCLUYENTE incluida, que no es un sello de goma |
| **C3 · 3.3** | El **cuerpo** del overlay deja de ser volcado de motor, en los **dos** caminos | ✅ **cerrado** | En el arranque real con el motor caído: `DETALLE: El motor narrativo no responde; inténtalo de nuevo en un momento.` **Negativo mío**: devolviendo `fail(\`Error: …\`)` en `bootstrap-tile.ts` —y nada más— reaparece **literalmente** la cadena que midió la vuelta anterior, `Error: No se pudo generar la escena. fetch failed`, y `qa/guiones/20` se pone rojo en tres asertos. **El ingeniero tiene razón corrigiendo el hallazgo**: esa cadena la escribe `bootstrap-tile.ts`, no el ternario de `tile.ts` |
| **C5 · 3.2** | El fallo que responde `ok:true` y falla después deja de ser un callejón: el overlay del mundo vacío ofrece volver al título | ✅ **cerrado** | Escenario real, motor de verdad caído (§3): muro con «Volver al título» → título de vuelta **con el motivo escrito** → el título está VIVO (el segundo «Comenzar» vuelve a resolver) → aguanta **dos fallos seguidos**. Candado nuevo: **`qa/guiones/20-el-mundo-vacio-tiene-salida.mjs`**, verde y **probado en negativo cinco veces** (§5) |

### 1.2 Las dos correcciones menores

| # | Criterio | Veredicto | Evidencia MÍA |
|---|---|---|---|
| **C4 · 3.4** | `#ts-error` deja de enseñar códigos y rutas de disco | ✅ **cerrado** | Las **cinco** cadenas que listaba el hallazgo, verificadas EN VIVO una a una: `session_not_found` → «Esa partida guardada ya no está en el disco.» (batería, guion 18); `game_load_failed` **con la ruta absoluta** → «Los datos de ese mundo están dañados y no se pueden leer.» (rompiendo el `game.json` con el selector abierto, `qa/capturas/qa2-c4-game-load-failed.png`); `Bridge not connected` → «Se ha perdido la conexión…»; `Bridge request timeout: list_games` → «El servidor del juego no contesta…» (batería, guion 19); `no games available` → «No hay ningún mundo instalado.» (68 ms, con el directorio de juegos vacío). Y el crudo **no se pierde**: la entrada `session` del `#error-log` sigue trayendo `game_load_failed` entero |
| **C6 · 3.5** | Las tres cuentas del `why` de `arch-rules.json`, corregidas contra la medida | ✅ **cerrado** | Re-medidas por mí: `main.ts` en `d5c3382^` tenía **7** `void`, de los que **3** eran mudos y los otros 4 son `void fpsAtlasController….catch(…)` — es lo que dice ahora el `why`. Los guiones que pasan por `sesion.mjs` son **13** (`grep -l` + revisión uno a uno de que los trece entran por `esperarTituloListo`), y así consta en `sesion.mjs`, en la cabecera del 18 y en el `why`. `max: 8` es el residuo real: aplicando el patrón **literal de la propia regla** salen 8, en los mismos ficheros que enumera (fps-atlas 1, dev-menu 1, dev-status-panel 2, graphics-mode 1, history-browser 1, portrait 2) |

### 1.3 Lo que ya estaba verde y sigue verde (re-verificado, no heredado)

| # | Criterio | Veredicto | Evidencia MÍA |
|---|---|---|---|
| **#181-a** | El botón escucha desde su primer pintado | ✅ | Guion 18, batería completa: el espía pulsa con `#ts-status` en «Cargando saves desde el bridge...» y el selector abre. Negativo mío **4.2**: enganche detrás del `await` → **rojo** |
| **#181-b** | El click deja de tragarse el fallo | ✅ | Guion 19 bloque 4: `#ts-error` = «No se pudo abrir el selector de mundos. El servidor del juego no contesta; inténtalo de nuevo.», entrada `title` en el log, botón restaurado |
| **#181-d** | `show()` arma `resolve` ANTES de `renderHome` | ✅ | Guion 19 bloque 1, verde: «Comenzar» dentro de la ventana de carga arranca la partida. Y la otra mitad —que la promesa se **rearme** en cada vuelta— la puse roja yo (**4.7**): bloque 3 del 19 y guion 20 en rojo. El `tituloEnMarcha` que añadió C5 **no ha debilitado ese candado** |
| **#189-1/2/3** | Repro real, vuelta a un título VIVO, motivo en pantalla y en el log | ✅ | Guion 18 + guion 19 bloque 3 + guion 20. Los tres negativos correspondientes, rojos (§4, §5) |
| **#180** | Los rótulos dejan de ser jerga de motor | ✅ | «La partida no pudo empezar» sobre un cuerpo ya traducido, en el arranque real |
| **batería** | La batería completa en verde | ✅ | **19/19** en la corrida final con el árbol de entrega (`bateria-final.log`). Y **18/18** en la primera corrida del día, antes de tocar nada |
| **núcleo** | `npm run verify`, cobertura, CRAP, deuda | ✅ | `1319 tests / 0 fail`. `1067 funciones medidas · cobertura 90,2 % · CRAP máx 126 ≤ 127` — **no es la corrida envenenada** de «0 funciones medidas». `npm run deuda`: **66 items**, los mismos, con `html-sin-promesa-muda ×8` y `title-screen.ts`/`main.ts` ausentes, y **sin aviso de medida obsoleta** |
| **cliente** | `tsc --noEmit`, `lint`, `build` | ✅ | Los tres en verde, corridos por mí |
| **mutación** | `status-labels` sin supervivientes | ✅ | Re-corrida por mí: `96 mutantes · 0 vivos · score 100,0 % (break 100)`. Lo doy por medido, no por declarado |
| **fixtures** | `qa/fixtures-sin-bridge.mjs` (el ingeniero toca el markup del loader que usa) | ✅ | `frames 14 → 41 · tiles ["tile_0_0"] · billboards 66 · ✔ html-fixtures pinta sin backend` |
| **alcance** | #224 fuera; no rediseñar el título; no tocar el modelo de saves | ✅ | El diff no toca `session-storage.ts` ni el formato de save. El único cambio visible del título es una línea de `justify-content` (§6, hallazgo menor de composición) |

### 1.4 Lo que sigue sin probarse

| # | Criterio | Veredicto | Por qué |
|---|---|---|---|
| **fallo TARDÍO de sesión** | Volver al título tras un fallo POSTERIOR a `applySessionReady` **dentro** del `try` | ⚠️ **no probado** | Sigue sin camino desde el juego. Ojo: el fallo tardío MÁS probable —el motor que no genera el mundo— **sí** está cubierto ahora por C5; lo que queda sin medir es una excepción dentro del propio `try` (p. ej. `setPlayerAppearance`), que no sé provocar sin fabricar estado. Riesgo §8 del plan, vivo |
| **gasto de créditos** | — | ⚠️ **no probado** | **Cero créditos** en todo lo anterior: preset `e2e-sin-creditos`, motor falso y, para el escenario del motor caído, un puerto donde no hay nada. No se ha ejercido ningún camino con IA real |
| **mutación completa** | Los otros 18 módulos | ⚠️ **no reproducida** | Solo he re-corrido `status-labels`, que es el módulo que la ronda cambia. Los demás los leo del informe y de `npm run deuda` (39 supervivientes, sin aviso de obsolescencia), no de una corrida mía |

---

## 2. Lo que exigía escrutinio especial

### 2.1 `qa/guiones/19` no se ha tocado — comprobado, no creído

```
$ git diff d5c3382 -- qa/guiones/19-el-titulo-arranca-de-verdad.mjs
(vacío)
$ md5sum qa/guiones/19-el-titulo-arranca-de-verdad.mjs
055e4d940ce2092dc61cb401331a11a0
$ git show d5c3382:qa/guiones/19-el-titulo-arranca-de-verdad.mjs | md5sum
055e4d940ce2092dc61cb401331a11a0
```

Sus cuatro bloques, corridos enteros: **verdes**. Y los dos que dependen del código que esta ronda
toca los he puesto rojos yo (§4.6 y §4.7): el bloque 2 con `justify-content: center` y el bloque 3
con `show()` sin rearmar su promesa. **El verde del bloque 2 viene del arreglo, no de una rebaja
del guion.** De paso, el rojo del negativo enseña la trampa que destapó la vuelta anterior, en la
misma línea: `en el bloque : 97px → 97px` mientras `en el viewport: 413px → 333px`.

### 2.2 «Usé `git checkout --` y me llevé C1 y C4 por delante» — el árbol está entero

El ingeniero declara el susto y dice que reaplicó las dos ediciones. **Comprobado**: el árbol que
recibo tiene `nefan-html/src/ui/title-screen.ts` con `md5 b4a14d98e5589c442e3a9c9dbe895c37` — el
mismo hash que él dice haber verificado— y las dos correcciones **funcionan en vivo**, que es lo
que de verdad importa: C1 mide Δ 0 px en el navegador (§1.1) y C4 traduce las cinco cadenas
(§1.2). No he dado por buena ninguna corrección por leerla en el diff: las siete de la ronda están
ejercidas contra el juego corriendo.

El `git diff --stat` de entrega es exactamente el suyo (18 ficheros, +791/−186) y mi único añadido
al repositorio es `qa/guiones/20-el-mundo-vacio-tiene-salida.mjs`, sin tocar nada existente.

### 2.3 «La mutación me puso rojo y arreglé los tests, no el umbral» — cierto

Re-corrida por mí: `status-labels 96 mutantes · 0 vivos · 100,0 % (break 100)`. Y el arreglo es el
que dice: `test/status-labels.test.ts` trae ahora una **tabla código → frase EXACTA** para los ocho
códigos reales, más dos rechazos raros (`undefined`/`null` y un `string` en vez de `Error`). Un
«las siete frases son distintas» habría seguido pasando con media función borrada; una tabla, no.
El umbral (`break 100`) no se ha tocado.

### 2.4 «Tres tests pre-existentes cambian de canal, no de exigencia» — afirman MÁS, no menos

Leídos uno a uno contra su versión de `d5c3382`:

| Test | Antes | Ahora |
|---|---|---|
| `bridge-map` · bootstrap sin `place_id` | `assert.match(err.message, /place_id/)` + `/salidas/` **sobre el wire** | **igualdad exacta** de la frase que lee el jugador + las dos `match` sobre el **log del bridge** (`capturarLogDelBridge`) |
| `bridge-session-guards` ×2 (anti-takeover) | esperaba un `narrative_status` con `/descartado sin escribir/` | espera el error por el wire **y** exige el `descartado sin escribir` en el log del bridge |
| `bridge-tile` · tile no jugable | `assert.ok(err.message.includes("no es jugable"))` | **igualdad exacta** de la frase traducida |
| `bridge-session` · generación fallida | `assert.ok(err.message.includes("MCP caído"))` | **igualdad exacta** de la frase + `assert.ok(!includes("MCP caído"))` |

Ninguno pierde su sujeto: el diagnóstico se sigue exigiendo, en el canal donde ahora vive, y
además se exige que el jugador **no** lo lea. Cuatro `includes`/`match` sustituidos por igualdades
exactas es más exigencia, no menos.

Una pega pequeña, no bloqueante: `capturarLogDelBridge` pisa `console.warn`/`console.error`
globales. Dentro de un fichero de `node:test` los tests corren en serie, así que es seguro hoy;
pero el `finally` que lo suelta es lo único que separa a la suite de quedarse sin consola, y eso
conviene que siga escrito donde está.

---

## 3. El escenario que más importaba: C5 desde el arranque, con el motor caído de verdad

`start_session` contesta `ok:true` antes de generar el tile. Para ejercerlo **sin matar el
fake-ai-server que comparten los otros 18 guiones** —y sin toparme con el `trap` de `./start.sh`,
que se lleva el stack entero cuando muere un hijo— levanté un **segundo bridge** en un puerto
libre, apuntado a un ai_server que no existe:

```
NEFAN_BRIDGE_PORT=9977 NEFAN_STATE_HTTP_PORT=9978 \
NEFAN_AI_SERVER=http://127.0.0.1:9 \
NEFAN_SAVES_DIR=…/saves NEFAN_GAMES_DIR=…/games  npx tsx bridge/ws-server.ts
```

y apunté el cliente con `?bridge=ws://127.0.0.1:9977`, que es un override REAL del contrato
(`nefan-html/src/net/service-urls.ts` → `NEFAN_URL_GAME_GATEWAY`). El fallo lo produce el motor de
verdad al no estar (ECONNREFUSED), recorre el bridge de verdad y llega al cliente por el
`narrative_status` de siempre: **no es estado sintético**. El disco de juegos va sin snapshots de
mundo — con ellos `start_session` replaya y no llama al motor, y la prueba daría un verde vacío.

Salida real:

```
── 1. arranque con el motor caído ──
  TÍTULO : La partida no pudo empezar
  DETALLE: El motor narrativo no responde; inténtalo de nuevo en un momento.
  ✔ el rótulo no es jerga de motor
  ✔ el CUERPO no es una excepción cruda (#180 / C3)
  ✔ el muro ofrece VOLVER AL TÍTULO (#189 / C5)
── 2. «Volver al título» ──
  #ts-error: La partida no pudo empezar. El motor narrativo no responde; inténtalo de nuevo en un momento.
  ✔ el jugador está OTRA VEZ en el título   ✔ …y el título dice POR QUÉ ha vuelto
  ✔ …y el muro ya no está por encima
── 3. segundo fallo seguido ──
  ✔ el segundo fallo también ofrece volver   ✔ …y se vuelve al título por segunda vez
```

Cuatro cosas de golpe, y las cuatro son las que pedía el encargo. Ese escenario ya no depende de
que alguien lo repita a mano: es el guion 20 (§5).

---

## 4. Pruebas en negativo que reproduje yo

Cada una cambiando **solo lo suyo**, y restaurando el árbol reescribiendo el texto original y
verificando el hash (`md5sum -c`, verde en las once).

| # | Qué rompí | Qué se puso rojo |
|---|---|---|
| 4.1 | La marca de agua del guion 18: `statusEl.textContent = "Cargando saves…"` movido detrás del `await` | Guion 18 · **la guarda de NO CONCLUYENTE** (`status en el instante del click: ""`). No es un sello de goma |
| 4.2 | El `addEventListener` del botón, detrás del `await listSessions()` | Guion 18 · `pulsar «Nueva partida» en su primer pintado abre el selector` |
| 4.3 | `runTitleFlow` de vuelta a un solo intento | Guion 18 · muere esperando `el título vuelve con el motivo del fallo escrito` |
| 4.4 | La traducción de C4 revertida (`${que}: ${err.message}`) | Guion 18 · `…y el título dice qué ha pasado sin enseñarle el código del bridge` — `No se pudo reanudar la partida: session_not_found` |
| 4.5 | El `errors.push` del catch de sesión, retirado | Guion 18 · `…y queda registrado en el log de errores con la fuente session` |
| 4.6 | `justify-content: flex-start` → `center` | Guion **19 bloque 2** (`413px → 333px`) y mi medida independiente (`413px → 193px`, −220 px con 12 saves) |
| 4.7 | `show()` sin rearmar `resolve` entre vueltas | Guion **19 bloque 3** y guion **20** (`no hubo segundo intento`) |
| 4.8 | C3 revertido en `bootstrap-tile.ts` | Guion **20** ×3 asertos, con la cadena de la vuelta anterior **reproducida literalmente**: `Error: No se pudo generar la escena. fetch failed` |
| 4.9 | `salida` clavada a `"cerrar"` en `status-labels.ts` | Guion **20** · `el muro del mundo vacío ofrece VOLVER AL TÍTULO` |
| 4.10 | `volverAlTitulo()` sin re-entrar en `runTitleFlow` | Guion **20** · muere esperando `el título vuelve con el motivo escrito` |
| 4.11 | El guion 20 SIN borrar los snapshots de mundo | Guion **20** · muere esperando el muro: con snapshot no hay llamada al motor y la prueba no probaría nada. El gotcha que le costó una hora al ingeniero queda candado |

**Qué cubre esto exactamente, sin redondear** (22 asertos vivos en los tres guiones del título):

| Guion | Asertos | Rojos demostrados por MÍ | Guardas de NO CONCLUYENTE | Heredados |
|---|---|---|---|---|
| 18 | 5 | **5** (4.1–4.5) | — | — |
| 19 | 9 | **2** (4.6 bloque 2, 4.7 bloque 3) | 2 (`el «Comenzar» cae DENTRO`, `hay al menos una partida listada`) | 5 — el aserto de `show()` del bloque 1 y los cuatro del bloque 4, cuyos negativos probó el QA anterior sobre un guion que he verificado **byte a byte idéntico** y cuyo código de referencia esta ronda no cambia (el orden de `show()` y el `paso()` del click siguen siendo los mismos; C4 solo cambió el TEXTO que ese handler escribe, y ese texto sí lo he puesto rojo yo en 4.4) |
| 20 | 8 | **7** (4.7–4.10) | 1 (`el fallo deja el mundo VACÍO`, y 4.11 demuestra que su incumplimiento mata el guion en vez de aprobarlo) | — |

**Ninguno de los 22 puede quedarse verde con su bug puesto**, y los 14 que dependen de código que
esta ronda toca los he puesto rojos yo.

---

## 5. Lo que dejo ejecutable

**`qa/guiones/20-el-mundo-vacio-tiene-salida.mjs`** (nuevo). Canda C5 y la mitad de C3 que vive en
el arranque — lo único mecánico de la ronda que se quedaba sin candado (el ingeniero lo declara en
su §7, y decía que hacía falta un `/dev/fail_next_scene` en el motor falso; hace falta esto, que no
toca el motor falso de nadie).

| Aserto | Probado en negativo |
|---|---|
| el fallo deja el mundo VACÍO (guarda de NO CONCLUYENTE) | 4.11 — con snapshot de mundo el guion muere, no aprueba |
| el muro del ARRANQUE no le enseña la excepción del motor (#180) | 4.8 |
| …y le dice qué ha pasado en una frase que puede accionar | 4.8 |
| el muro del mundo vacío ofrece VOLVER AL TÍTULO (#189) | 4.9 |
| «Volver al título» devuelve al título, con el motivo y sin el muro encima | 4.10 |
| …y el motivo tampoco es jerga de motor | 4.8 |
| el título de vuelta está VIVO: «Comenzar» vuelve a resolver | 4.7 |
| …y el segundo fallo seguido también ofrece la salida | 4.7 y 4.9 |

Detalles que el guion declara dentro, para que nadie los tenga que deducir:

- **Instrumentación, no estado sintético**: el segundo bridge de §3. No oculta ningún obstáculo —
  produce uno que el jugador tiene el día que el ai_server no está.
- **Puertos 9977/9978**, fuera del catálogo de `start.sh`; si están ocupados el guion **falla
  diciéndolo** en vez de dar un verde raro.
- **Mata el GRUPO de procesos**, no el `npx`: matando solo al envoltorio, el `tsx` de dentro se
  queda con el puerto y la corrida siguiente muere en el arranque. Medido — me pasó.
- **Un aserto que quité antes de entregarlo**: «el mundo queda a cero tras la vuelta». En este
  camino el mundo ya nace vacío, así que pasaba con `resetWorld()` puesto y quitado. Queda como
  `ctx.log`. (Y de paso: `window.__nefan.status()` **no** expone `tiles`; el libro bueno es
  `window.__nefan.tiles`. Con el accesor equivocado ese aserto medía `undefined` y siempre daba 0.)

Comprobado además que **no envenena la batería**: 19/19 con él dentro, y `--orden inverso` (el
guion 20 primero, el 18 después) también verde. Deja los puertos libres al terminar.

---

## 6. Hallazgos

### 6.1 IMPORTANTE — «Cerrar» sigue llevando al callejón de #189, en un click

**Qué esperaba el usuario** (#189, literal): *«la pantalla a la que no se puede volver cuando algo
falla»*, *«la única salida es recargar»*.

**Qué pasa.** El muro del mundo vacío ofrece dos botones del mismo peso visual: «Volver al título»
y, justo debajo, «Cerrar». Pulsar «Cerrar» deja al jugador **exactamente** en el estado que midió
la vuelta anterior en su §3.2:

```
título visible: false · muro: false · tiles: 0
clicables: ["#room-selector","#ds-menu-btn","1Quick","2Heavy","3Medium","4Defensive","5Precise","#gfx-chip"]
```

Cielo vacío, barra de vida al 100 %, cinco botones de ataque y **ninguna forma de volver que no sea
recargar**. La lista de clicables es la misma, elemento por elemento, que la del informe anterior.
Captura: `qa/capturas/qa2-c5-03-tras-cerrar.png`.

**Reproducción desde el arranque**: el escenario de §3 (o `node qa/run.mjs 20` y, en vez de pulsar
«Volver al título», pulsar «Cerrar»). Tres servicios por separado si se hace a mano: `./start.sh`
mata el stack entero por su `trap` cuando muere un hijo.

**Por qué no lo llamo bloqueante**: el encargo C5 pedía que el overlay *«ofrezca volver al título
en vez de solo cerrarse»*, y lo ofrece; la salida está a un centímetro del trampolín. El ingeniero
justifica conservar «Cerrar» porque lo pulsa `qa/fixtures-sin-bridge.mjs` sobre el muro de
arranque — y **eso es correcto**: comprobado que los tres `setLoaderState` del muro de arranque
usan la `salida` por defecto (`"cerrar"`) y ahí el botón «Volver al título» ni aparece. Lo que no
se sostiene es que en el mundo vacío convivan la salida y la trampa con el mismo aspecto.

**Salidas posibles** (no las decido yo): que en el mundo vacío «Cerrar» no se pinte; o que ahí
«Cerrar» haga lo mismo que «Volver al título». Candarlo cuesta **un aserto** en el guion 20, al
lado de los que ya hay.

### 6.2 MENOR (pre-existente, fuera del alcance) — el botón SÍ se sigue moviendo, por otra causa

En un viewport estrecho el botón se desplaza **+24 px** bajo el cursor después de pintarse, y **no
es la lista de saves**: pasa igual con 0 partidas.

```
500×800 · 3 saves : #ts-new VIEWPORT 181px → 205px (Δ +24) · bloque 96px → 120px
500×800 · 0 saves : #ts-new VIEWPORT 181px → 205px (Δ +24)
```

**Mecanismo, medido y aislado**: `reserveDevPanelSpace()` (`title-screen.ts:258-274`) fija
`paddingTop = max(96, devBottom + 10)` y lo re-mide con un `ResizeObserver`. El panel de dev
`#dev-status` se **rellena de forma asíncrona** (chips de coste y de servicios), y en anchos
estrechos ese relleno le añade una línea. Traza del propio panel:

```
devBottom=  55  #ts-new.top=  181  «… Bridge img: inactivo caché 0✓/0✗ Dev-cache Im»
devBottom= 110  #ts-new.top=  181  «… Bridge img: inactivo caché 0✓/0✗ Dev-cache ga»   ← +55 px de panel
```

A 1280×800 el panel cabe en una línea y el efecto es **0 px** — por eso ni el guion 19 ni yo lo
vimos en las medidas principales. `#dev-status` **no está gateado por `import.meta.env.DEV`**:
vive en `index.html` y `DevStatusPanel` se construye siempre, así que un jugador con la ventana
estrecha lo tiene igual.

**No bloquea**: el criterio literal dice *«al llegar la lista de saves»*, y por esa vía el
desplazamiento es 0 px con 0, 3 y 12 partidas y a 1280 y 900 de ancho. **Es pre-existente** (el
`ResizeObserver` y el `padding` calculado ya estaban; con `center` pasaba lo mismo) y la vuelta
anterior lo rozó sin medirlo — era justo la razón que daba el guion 18 viejo para medir contra el
padre. Va a issue. Candarlo es correr el bloque 2 del guion 19 también a 500×800.

### 6.3 MENOR (pre-existente) — un `list_games` que revienta deja al cliente esperando 30 s y luego le miente

Con el directorio de juegos **inexistente** (no vacío: ausente), `handleListGames` lanza y **nadie
contesta**:

```
Bridge: unhandled rejection: Error: games directory not found: …/games
    at listGames (src/games/loader.ts:308:11)
    at handleListGames (bridge/handlers/session.ts:97:12)
    at routeMessage (bridge/router.ts:53:7)
```

El cliente agota su timeout de request (30 s) y entonces —correctamente, según la traducción
nueva— dice «El servidor del juego no contesta; inténtalo de nuevo.» El problema es que ahora esa
frase suena **plausible y es falsa**: el servidor está vivo y lo que pasa es que la instalación
está rota. Antes al menos el silencio no afirmaba nada.

Es un agujero de fail-loud del bridge (`router.ts` no envuelve el handler), **no lo introduce esta
tanda** y está fuera de su alcance, pero cae justo sobre la superficie que la tanda abre. Con el
directorio **existente y vacío** el camino sí es correcto: «No hay ningún mundo instalado.» en
68 ms.

### 6.4 MENOR — `#ts-status`, el hermano de `#ts-error`, sigue hablándole al desarrollador

C4 tradujo `#ts-error`. Justo debajo, `#ts-status` sigue escribiendo, cuando el bridge no contesta
a `listSessions`:

> «No se puede contactar al bridge (…). Arranca `./start.sh` y elige un preset con bridge (p. ej.
> "Cliente web (dev)").»

Mismo hueco, mismo párrafo de pantalla, misma clase de jerga; el encargo nombraba `#ts-error` y el
ingeniero se ciñó a él, que es lo correcto. A issue, con `motivoDeSesionParaElJugador` ya escrito
al lado.

### 6.5 MENOR (crítica visual) — el estado vacío del título queda descompensado, y es más de lo que dice el informe

El informe dice que con 0 partidas *«queda un tercio de pantalla vacío por debajo»*. **Medido: son
476 px de 800, un 60 %.** El contenido termina en `y=324` y por debajo no hay nada.

Mirándolo como director de arte y no como checklist: con 3 y con 12 partidas la composición
**aguanta bien** —jerarquía de arriba abajo, título → frase → acción primaria → lista, sin saltos—
y el anclaje arriba es claramente lo correcto. Con **0 partidas**, que es lo primero que ve quien
estrena el juego, la pantalla se lee **inacabada** más que aireada: una columna pegada al borde
superior y medio lienzo negro debajo, con la costura del fondo del juego asomando al 3 % por el
`rgba(8,8,12,0.97)`.

**No pido volver a `center`** —es la causa del bug— ni compensar con márgenes inventados, que es
justo lo que el encargo prohibía. Es material para un issue del estado vacío del título (dar
presencia a «— Ninguna partida todavía —», o una portada). Lo digo porque el encargo pedía
mirarlo y decirlo, y porque el número del informe se queda corto por la mitad.

### 6.6 Observación — la lista larga se corta sin avisar

Con 12 partidas el bloque llega a su `max-height` (672 px) y la última tarjeta queda cortada por el
borde inferior, sin ninguna señal de que haya más. Pre-existente, idéntico antes y después de C1, y
vecino de #224 (que el crítico separó). Lo dejo anotado, no lo cuento como hallazgo de esta ronda.
Captura: `qa/capturas/qa2-c1-12-saves.png`.

### 6.7 Lo que sigue vivo del informe anterior

- **3.6 · el HUD y el `#error-log` se leen por debajo del título** — sigue igual, y ahora **pesa
  más**: con C5, volver al título con una partida a medias detrás deja de ser un caso raro y pasa
  a ser el camino normal de un arranque fallido. Se ve en `qa/capturas/c5-de-vuelta-en-el-titulo.png`
  (barra de vida, botones de ataque y los avisos del motor asomando). Ya iba a issue.
- **3.7 · el rótulo del viaje repite el principio del cuerpo** — no hecho, con el motivo medido por
  el ingeniero: el `narrative_status` de un tile no lleva el nombre del lugar, así que no salía
  gratis. Correcto tal como estaba previsto.
- **3.8 · el guion 15 es una moneda al aire** — **confirmado otra vez**: en mis dos corridas verdes
  el mercader recorrió 1,37 m y 1,06 m contra un umbral de 1 m (márgenes de 37 y 6 cm), con la
  espera interna pidiendo 1,5 m que nunca llega a cumplirse. Sigue decidiéndolo el cortafuegos de
  pared. Ya iba a issue.
- **`no-floating-promises` no activo en `nefan-html`** — sigue siendo el punto ciego grande del
  candado nuevo: quitar el `void` lo desactiva. Ya iba a issue.
- **Una errata sin consecuencia**: `implementacion.md` §C6 cita `grep -c "paso(" main.ts` = 3, y
  hoy son **4** — C5 añadió `paso(volverAlTitulo(), …)`. El `why` de `arch-rules.json`, que es el
  fichero de contrato, dice lo correcto (tres mudos en `d5c3382^`); la línea rancia está solo en
  el informe efímero.

---

## 7. Workarounds e instrumentación

Ninguno oculta un obstáculo que el jugador vaya a tener. Los declaro todos, con su veredicto.

| Qué | Veredicto |
|---|---|
| **Segundo bridge en :9977 apuntado a un ai_server inexistente**, elegido con `?bridge=` | **No es un hallazgo.** Produce un estado que el jugador tiene (el ai_server caído) por el camino real, y evita matar el motor falso compartido o disparar el `trap` de `./start.sh`. El override `?bridge=` es contrato, no puerta trasera |
| Disco de juegos propio para ese bridge, **sin snapshots de mundo** | **No es un hallazgo, es la precondición**: con snapshot, `start_session` replaya y no llama al motor. Está candado en el guion 20 (4.11) |
| Romper el `game.json` en ese disco con el selector ya pintado | **No es un hallazgo**: instalación corrupta, estado real. Restaurado desde `.bak` al terminar |
| Vaciar / apartar el directorio de juegos de ese disco | **Vaciarlo** no es hallazgo (instalación sin mundos). **Apartarlo entero** destapó 6.3, que sí es hallazgo |
| Matar `:9977` con el título abierto | **No es un hallazgo**: el servidor caído es estado real. Sirvió para la frase «Se ha perdido la conexión…» |
| Sembrar 12 partidas jugando 12 veces desde el título | **No es un hallazgo**: es el camino del jugador, solo que repetido |
| Espía `MutationObserver` que anota dónde nace `#ts-new` | **No es un hallazgo**: solo mira, no cambia nada. Es la única forma de fotografiar el instante del primer pintado |
| Restaurar la **mtime** de `bootstrap-tile.ts` y `status-labels.ts` tras las pruebas en negativo | **Declarado**: mis reversiones dejaron los ficheros con contenido idéntico (`md5` verificado) pero fecha nueva, y `npm run deuda` los marcaba como «medida posiblemente obsoleta» sin serlo. Devolví la fecha; el contenido no se tocó y `deuda` vuelve a salir limpio |
| Once ediciones en negativo sobre el árbol | **Restauradas y verificadas** con `md5sum -c` las once, reescribiendo el texto original — nunca con `git checkout --` |

---

## 8. Veredicto

**APTO CON RESERVAS.**

Los **cuatro bloqueantes de la vuelta anterior están cerrados**, y no de palabra:

1. **#181-c cumple** — Δ **0 px** en viewport con 0, 3 y 12 partidas, y a 1280 y 900 de ancho.
   El bloque 2 del guion 19, que estaba rojo, sale verde **con el guion intacto byte a byte**, y
   vuelve a ponerse rojo en cuanto devuelvo la línea a `center`.
2. **No queda ningún aserto incapaz de ponerse rojo** en los guiones del título: los dos falsos
   verdes salieron del 18 con su cobertura recogida en el 19, y de los **22** asertos vivos de los
   guiones 18, 19 y 20, **14 los he puesto rojos yo**, 3 son guardas de NO CONCLUYENTE y 5 los
   hereda el guion 19 —intacto byte a byte— del QA anterior, sobre código que esta ronda no
   cambia (§4).
3. **#180 está cerrado por los dos caminos**, y el hallazgo apuntaba al fichero equivocado: la
   cadena que leía el jugador la escribía `bootstrap-tile.ts`. Lo demuestro al revés — devolviendo
   solo esa línea, reaparece literalmente.
4. **#189 cubre el fallo que responde `ok` y falla después**, ejercido con el motor caído de
   verdad y ahora candado en `qa/guiones/20`.

Y con ellos: `#ts-error` sin códigos ni rutas de disco (las cinco cadenas verificadas en vivo), las
tres cuentas del `why` correctas contra mi propia medida, `1319 tests / 0 fail`, CRAP y cobertura
sin moverse, deuda en los mismos 66 items, `status-labels` con 96 mutantes y **0 vivos**
re-corridos por mí, la batería **19/19** y `fixtures-sin-bridge` verde.

**La reserva, una sola y con nombre**: el botón «Cerrar» del muro del mundo vacío sigue llevando en
un click al callejón exacto de #189 (§6.1), con la misma lista de elementos clicables que midió la
vuelta anterior. Cerrar la tanda dejando eso sin decir sería cerrar #189 a medias por segunda vez.
No pido otra vuelta del ciclo: pido que **se abra el issue con la repro de §6.1 y se diga por
escrito que queda fuera**, o que se gaste el aserto que ya tiene sitio en el guion 20.

A issue, sin bloquear: 6.2 (el panel de dev sigue moviendo el botón en anchos estrechos), 6.3 (el
`list_games` que revienta y deja al cliente 30 s esperando), 6.4 (`#ts-status` sigue hablando de
`./start.sh`), 6.5 (el estado vacío del título) y lo que ya venía de la vuelta anterior (3.6, 3.8,
`no-floating-promises`).
