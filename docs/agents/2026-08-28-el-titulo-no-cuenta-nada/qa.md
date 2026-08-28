# QA — El título no cuenta nada de lo que pasa

Rama `feature/titulo-no-cuenta-nada` (`326b859` + la pasada de limpieza sin commitear).
Validado el 2026-08-28 contra la petición ORIGINAL y los cinco issues (**#282, #269, #250,
#251, #285**), no contra el plan.

**Cómo se probó**: stack real `./start.sh --preset e2e-sin-creditos` en bloque propio
(`NEFAN_PORT_OFFSET=300`), conducido con teclado y ratón REALES desde el título, más
`node qa/run.mjs` (batería entera, orden normal e inverso) y `qa/guiones/34` nuevo. Cero
créditos: el motor es siempre `fake-ai-server`.

---

## 1 · Criterios de aceptación (§4 de `requisitos.md`)

| # | Criterio literal | Veredicto | Evidencia |
|---|---|---|---|
| 1a | **#282** — `broadcastScene` sella la sesión y el cliente descarta el tile que no es de la suya | ✅ cumple | Clon limpio (hojas 404 en el borde): «Comenzar» falla, el tile llega después y **no se instala** — `tiles: []`, `descartados {"n":1}`, línea del juego `↩ evento de otra partida descartado (scene_init, sesión «1787917118-dafe5e»)`. Antes de la tanda el issue medía `tiles = ["tile_0_0"]` |
| 1b | …y el sello funciona con **dos clientes vivos** (caso que la guarda barata no cerraba) | ✅ cumple | Dos pestañas contra el mismo bridge: pestaña A en sesión `…54a91f`, pestaña B arranca `…125769`; A recibe el `scene_init` de B y lo **descarta** (`descartados {"n":1}`, mundo de A intacto: `tiles ["tile_0_0"]`, `scene tile_0_0`) |
| 1c | **Un segundo intento no hereda el mundo del primero** | ✅ cumple | (i) tras el fallo del clon limpio, el 2.º intento sale con `tiles: []`, `descartados {"n":2}`; (ii) camino más exigente — fixture `robledo_tile` pintada detrás del título (5 NPC) y «Nueva partida» encima: queda `scene tile_0_0`, **1** NPC, `pos 0.25,3.25`. La faceta `mundo` vacía antes de armar nada |
| 1d | Candado: el `ctx.log` de `qa/guiones/29:166-168` pasa a `ctx.expect` | ✅ cumple | `node qa/run.mjs 29` verde; el bloque 1 afirma `tiles === []` **y** `descartados().n ≥ 1` |
| 2a | **#269** — la rama muerta `!loader` **se borra** | ✅ cumple | `grep -rn "Scene not found"` en todo el repo (sin `node_modules`) → **0 ocurrencias**; `loadSceneFile` es hoy `await sceneModules[globKey]()` |
| 2b | El mensaje nombra **la etiqueta elegida**, no la ruta del glob | ✅ cumple | Flujo real (fixture abortada en el borde): registro `No se pudo cargar la escena «zorder_test»`, línea del juego `⚠ No se pudo cargar la escena «zorder_test»`. El crudo queda en el `detail`: `TypeError: Failed to fetch dynamically imported module: …/zorder_test.json?import` |
| 2c | …y **el desplegable no se queda mintiendo** | ✅ cumple | Tras el fallo, `#room-selector` vuelve a `robledo_tile` y el mundo sigue siendo `robledo_tile`. El `alFallar` de `paso()` corre porque `loadSceneFile` ya rechaza de verdad |
| 2d | La decisión de texto baja a `status-labels.ts` (core, con mutación) | ✅ cumple | `etiquetaDeFixture` + `motivoDeFixtureParaElJugador` en `nefan-core/src/protocol/status-labels.ts`; `populateSceneSelector` y el `change` usan **la misma** derivación |
| 3 | **#250** — **Δ 0 px de `#ts-new` a 500×480 con 0 saves** | ✅ cumple | `qa/guiones/33` a 500×480: `botonY 181 → 181` (Δ 0) con el panel creciendo de `devScroll 54` a `109` y `padding 96 → 96`. **Probado en negativo por mí**: descolgando `#dev-status` de la variable (`max-height: 110px` a mano) el guion se pone ROJO — «la columna empieza en 96px y la barra acaba en 110px» |
| 4a | **#251** — quien tenga más partidas de las que caben **se entera**, y la señal va en `this.content` | ✅ cumple | 12 partidas a 500×480: `#ts-mas` visible, área 31 000 px², dentro del viewport, texto `↓ hay 11 partidas más — desplaza la lista`; con 0 partidas está oculto. A 1280×800 con 12: `↓ hay 7 partidas más`. La banda cuelga de `this.root` y **no** mueve «Nueva partida» (`botonY` 181 con y sin lista) |
| 4b | El candado mide que la señal **existe y se ve** | ✅ cumple | `qa/guiones/33`, bloque 2; negativo del ingeniero (`hidden` forzado) → `area:0`, rojo |
| 4c | …pero el número que nombra **puede ser falso** | ❌ **NO cumple** (defecto nuevo de la tanda) | Ver hallazgo **H1**: a **1280×800 con 5 partidas** —el viewport por defecto de la batería— la banda dice `↓ hay 0 partidas más — desplaza la lista` con las **cinco** tarjetas a la vista |
| 5a | **#285** — `H` no responde mientras el título está delante | ✅ cumple | Estado real del issue (mundo pintado detrás, `data-titulo="1"`, `#game-ui` 0 px): `H` no abre el libro (`hidden` sigue `true`), ni manda `resume_session` (guion 29 bl. 3) |
| 5b | …y **ninguna** entrada de juego responde (no solo `H`) | ✅ cumple | **`qa/guiones/34` nuevo**: WASD, Shift, ←/↑, `1..5`, `E`, `R`, `G`, `B`, `H` y LMB con el título delante → `{"campos":[],"nuevas":[],"deTecla":[]}`, con el bucle de juego corriendo (control de fotogramas). **CONTROL**: cerrado el título con un clic real en `#ts-close`, las mismas responden (`pos` cambia, `ataque → precise`, `debugView`, `B · fps: colisión`, el libro se abre) |
| 5c | El candado es que el manejador pregunte a **la misma fuente** que escribe `data-titulo` | ✅ cumple | `ui/titulo-manda.ts` es el único escritor y el único lector; `dev-ui.css:122-123` lee el mismo atributo. Regla `teclas-de-juego-pasan-por-la-puerta` en `arch-rules.json`, `error`, a cero, con test de las seis formas. **Con reserva**: ver hallazgo **H4** (dos formas alcanzables que el patrón no ve) |
| 5d | Ninguna tecla que SÍ debía funcionar en el título ha dejado de hacerlo | ✅ cumple | Con el título delante siguen vivos: `#ts-close` (clic real → cierra), `#room-selector` (carga la fixture), botón «Imágenes…» (abre `#dev-menu`), toggle Dev-cache (llama al ai_server y cambia), `Tab` (foco), `Escape` (no rompe nada). La puerta no gatea `keyup` ni los listeners sobre elementos |
| 6a | **Del repositorio** — `npm run verify` verde | ✅ cumple | Verificado por el coordinador (1600 tests, EXIT=0). Yo re-corrí `test/architecture.test.ts` con el guion nuevo en el árbol: **46/46** |
| 6b | `node qa/run.mjs` entero en verde | ✅ cumple | **33/33 EXIT=0** con el guion 34 incluido (`qa/capturas/2026-08-28T11-55-58-293Z-195784`). Con `--orden inverso`: **32/32** sobre el árbol entregado y **33/33** con el guion 34 dentro |
| 6c | La deuda sin crecer | ⚠️ no probado por mí | Medido por el ingeniero (66 items / 15 fronteras contra 67/16 en main). No lo repetí: no es observable por quien juega y el coordinador ya validó `verify` |
| — | Gasto real de créditos | ⚠️ **no probado** | Todo el trabajo va contra `fake-ai-server` (preset `e2e-sin-creditos`). Ningún presupuesto real se tocó, y por tanto tampoco se comprobó |

---

## 2 · Hallazgos

### H1 · IMPORTANTE — el aviso nuevo de #251 dice «hay 0 partidas más» con todas a la vista

**Es una regresión de esta tanda**: la banda no existía antes.

`actualizarAvisoDeCorte` decide MOSTRAR con `scrollHeight > clientHeight + 1` pero CUENTA las
tarjetas cuyo borde inferior cae fuera. La columna desborda también por el `margin-bottom: 24px`
de `#ts-sessions`, así que hay una **banda de alturas tan ancha como ese margen** en la que se
avisa de un corte que no existe.

**Pasos desde el arranque**

1. `./start.sh --preset e2e-sin-creditos`, abrir la URL que imprime.
2. Jugar cinco partidas (o dejar cinco saves en `saves/`).
3. Ventana de **1280×800** — el viewport por defecto de la batería.
4. Mirar el pie del título.

**Lo que ve quien juega** (captura `qa/capturas/qa-titulo-no-cuenta-nada-2026-08-28/aviso-hay-0-partidas.png`):

```
↓ hay 0 partidas más — desplaza la lista
```

…con las **cinco** tarjetas enteras en pantalla. **Lo que esperaba**: ninguna banda, o una que
diga algo verdadero.

**Medido** (barrido de alturas, 12 partidas y 5 partidas):

| partidas | banda de alturas con el aviso falso | desborde |
|---|---|---|
| 5 | **792 – 816 px** (incluye 800) | 24 → 2 px |
| 12 | 1340 – 1362 px (un 1440p maximizado) | 24 → 2 px |

**Por qué el candado no lo ve**: el aserto del guion 33 es `/hay .* más/ && /desplaza/`, que pasa
sobre ese texto. El número no lo mira nadie. Es exactamente el modo de fallo que el propio
comentario de `actualizarAvisoDeCorte` dice querer evitar en las otras pantallas («un aviso
cierto sobre el desbordamiento y falso sobre su sujeto») — solo que aquí el sujeto son las
partidas y la pantalla es el home.

**Reproducible sin manos**: `node qa/run.mjs 34` lo imprime como
`⚠ HALLAZGO ABIERTO: el aviso de #251 dice «↓ hay 0 partidas más — desplaza la lista» con
0 tarjetas fuera (alto 806px, desborde 12px)`.

---

### H2 · IMPORTANTE — el gasto en € deja de leerse justo cuando el panel está gastando

`dev-ui.css` abre diciendo que este panel existe porque «el tema de un estilo… no puede alterar
**el panel desde el que se vigila el gasto**», y el comentario de la variable añade que bajarla
«corta antes el gasto en €, que es lo que este panel existe para vigilar». La cota de 72 px se
midió **en reposo**. En el estado que importa no llega.

**Pasos desde el arranque**

1. `./start.sh --preset e2e-sin-creditos`; ventana de **500×480**.
2. «Nueva partida» → un mundo cuyo atlas no esté en caché → «Comenzar».
3. Mirar la barra de dev mientras dice `GENERANDO atlas de superficies del tile activo…` —el
   aviso destacado y pulsante que precede a una llamada **de pago**.

**Lo que ve quien mira** (captura `qa/capturas/qa-titulo-no-cuenta-nada-2026-08-28/panel-generando-500x480.png`): la línea
`gasto sesión 0,00 € · total 0,00 €` **cortada por la mitad horizontal** en el borde de la cota.
Medido: `ds-spend` en `y 63–75` contra una cota de `72`; `scrollHeight` del panel `136` px.

**Y además**, a 500 px de ancho y en reposo, quedan **enteramente fuera** de la cota (hay que
desplazar dentro de un panel que no parece desplazable):

```
autoimg (62–76)  ·  ds-spend (63–75)  ·  ds-config (90–103)
ds-session (119–131)  ·  ds-menu-btn (117–133)     vs cota 72
```

`ds-menu-btn` es el botón **«Imágenes…»**, la única puerta al menú de generación por item. Sin la
cota (medido poniendo `max-height: none` en el navegador) el panel mide 110 px y **todo** se ve.

**El arreglo es un dial de una línea, y lo he medido**: con `--dev-status-alto: 110px` el guion
33 sigue **verde** y «Nueva partida» no se mueve (`botonY 205 → 205`, padding 120). O sea que la
promesa del apéndice §1 («deja de ser un compromiso y pasa a ser un dial») es cierta — solo que
el dial está puesto en un número que se midió en el estado equivocado.

**Reproducible sin manos**: `node qa/run.mjs 34` →
`⚠ HALLAZGO ABIERTO: el gasto en € NO se lee mientras el panel genera (1/1 muestras fuera de la
cota)`.

---

### H3 · IMPORTANTE — el candado de `--dev-status-alto` es de **un solo sentido**

El apéndice §1 afirma «Un número, un sitio, cero JavaScript» y que el candado «cambia al
invariante que de verdad puede romperse». Lo probé por los dos lados:

| Rotura | Guion 33 |
|---|---|
| `#dev-status` se descuelga de la variable (`max-height: 110px` a mano) | ✘ **ROJO** — «la columna empieza en 96px y la barra acaba en 110px» |
| **El TÍTULO se descuelga** (`padding: max(96px, min(160px,20vh))` a mano, la variable intacta) | ✔ **VERDE, los nueve asertos** |

Con el segundo sabotaje el número vuelve a vivir en dos sitios sin que nada se ponga rojo. Y el
día en que alguien use el dial de H2 (subir la cota a 110), el título se quedaría reservando 96 y
la columna nacería debajo de la barra — el bug reaparece, con un commit de por medio que no
tocó nada relacionado. Hoy la garantía la da un comentario en los dos lados, no un checker.

Sugerencia (no la aplico, reporto): una regla de texto en `arch-rules.json` que exija que
`title-screen.ts` mencione `var(--dev-status-alto)` — el mismo idioma que
`game-ui-css-sin-literales-de-color`.

---

### H4 · IMPORTANTE — la regla `teclas-de-juego-pasan-por-la-puerta` tiene dos puntos ciegos alcanzables y no declarados

El `why` declara **un** punto ciego (el receptor por alias). Hay al menos dos más, y son los dos
idiomas más cortos que existen para escribir eso. Probado contra el patrón real del contrato:

```
CAZADO   window.addEventListener("keydown"        CAZADO   window.onmousedown =
CAZADO   document.addEventListener("keydown"      CAZADO   document.onkeydown =
SE COLA  addEventListener("keydown"   ← window implícito, es JS válido y typa
SE COLA  globalThis.addEventListener("keydown"
SE COLA  self.addEventListener("keydown"
SE COLA  document.documentElement.addEventListener("keydown"
SE COLA  window.addEventListener(`keydown`   ← plantilla en vez de comillas
```

**No es teórico.** Puse una sonda real en `nefan-html/src/ui/__qa-sonda-tecla.ts` con
`addEventListener("keydown", …)` y `globalThis.addEventListener("mousedown", …)` y corrí las tres
herramientas que deberían cazarla:

```
npx tsx --test test/architecture.test.ts   → 46/46 ✔  (la regla, VERDE con la sonda puesta)
npx tsc --noEmit  (nefan-html)             → EXIT 0
npx eslint src/ui/__qa-sonda-tecla.ts      → EXIT 0
```

Un quinto manejador escrito así compila, pasa el lint, pasa el checker y **se salta la puerta**.
(La sonda está borrada; el árbol quedó con los mismos md5 con los que lo encontré.)

---

### H5 · IMPORTANTE — la batería no recorre ocho de las nueve entradas que #285 gatea

`qa/run.mjs:212` abre TODOS los guiones con `?input=scripted`, y ese id instala
`ScriptedInputProvider`: **`KeyboardInputProvider` ni se construye** (`main.ts:483`,
`input/registry.ts:17`). Sus `keydown`/`mousedown` —WASD, flechas, `1..N`, `E`, `R` y el clic de
ataque— no están registrados en ninguno de los 32 guiones anteriores. De las nueve entradas del
issue, la batería solo recorría `H` (guion 29, bloque 3).

Dicho de otro modo: el candado de comportamiento de #285 cubría **1 de 9**, y el resto lo
sostenía solo el checker de H4.

**Cerrado por mí**: `qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs` abre la página
**sin** `input=scripted` y prueba las nueve con teclado y ratón reales, con control. Probado en
negativo (quitando la guarda de `alPulsarTecla`) el guion se pone rojo nombrando el destrozo
exacto:

```
✘ con el título delante NINGUNA de las nueve entradas de juego responde (#285)
  — pos -10.25,-0.75→-10.26,-0.81 · ataque quick→precise · debugView off→collision
  · libroOculto true→false · línea del juego: ["B · fps: colisión"]
  (y en la línea del juego, además: "Hablando con Olmo…")
```

Es decir: sin la puerta, con el título delante el jugador andaba, cambiaba de ataque, ciclaba la
vista de debug, abría el libro **y hablaba con un NPC** que no podía ver. La tanda arregla eso.

---

### H6 · MENOR (preexistente, NO de esta tanda) — `superficies undefined` en el panel de dev

`superficies undefined` es un `undefined` en texto de interfaz, y **no lo introdujo esta tanda**:
`dev-status-panel.ts` no está en el diff. Es una divergencia de contrato del **banco de pruebas**:

- El contrato (`nefan-core/src/contracts/remote-gen.ts`) y el ai_server real
  (`ai_server/routers/cache_assets.py:67`) sirven `config.surface_model`.
- `labs/narrative/fake-ai-server.mjs:598` sirve `scene_model` — el nombre que el campo tenía antes
  de `192037b` (2026-08-22, «Los huérfanos del pipeline de imagen…»).

Comprobado en vivo: `curl :19065/dev/status` → `"config":{"scene_model":"fake-scene-model", …}`.
Como el fake es `.mjs` sin tipos, `test/contract-model-io.test.ts` no lo alcanza. Con el ai_server
real el panel diría `superficies nano-banana-pro`.

**Doble consecuencia**: (a) el bench muestra `undefined` a quien mire una captura, y (b) el
`surface_model` del panel no está probado contra el contrato en ningún sitio. Va a issue aparte.

---

### H7 · MENOR (preexistente) — la barra de dev tapa el botón «✕ cerrar» del título

`#ts-close` es `position:absolute; top:12px` sobre la raíz del título (y 12–37); `#dev-status`
está a `z-index:10000` sobre el título (9999).

| Ventana | Barra de dev | Botón | Resultado |
|---|---|---|---|
| 1280×800 | 0–25 | 12–37 | **`elementFromPoint` del centro devuelve `dev-status`**: el 52 % del botón no es clicable |
| 500×480 | 0–72 | 12–37 | **el botón está 100 % tapado**: el modo fixtures es inalcanzable con el ratón |

No es regresión (antes de la tanda el panel medía ~110 px a 500 de ancho y lo tapaba igual), pero
**ningún guion lo veía**: los 32 cierran el título con `ctx.nefan("closeTitle")`, que salta el
obstáculo. Mi guion 34 lo cierra con un clic de ratón real y registra la geometría; su aserto
(«tiene algún punto que la barra no tapa») se pondrá rojo el día que la cota crezca hasta 37 px —
que es justo lo que pasaría al arreglar H2 subiendo el dial. **Léase junto**: subir
`--dev-status-alto` a 110 arregla H2 y deja `#ts-close` inalcanzable a cualquier ancho. El arreglo
completo es acortar los chips o bajar el botón.

---

### H8 · MENOR — con el título delante, el fallo del selector «Room» es mudo

#269 arregló QUÉ se dice. Pero el selector es usable **con el título delante** (vive en
`#dev-status`, z-index 10000), y en ese estado los dos canales que #269 alimenta están apagados
por el interruptor de #246:

```
titulo "1" · registroEntradas 1 · registroTexto ["No se pudo cargar la escena «zorder_test»"]
errorLogVisible false · gameUiPx 0 · tsError ""
```

El mensaje se escribe bien y no lo ve nadie. Lo mismo con la confirmación del toggle Dev-cache
(`dev-cache ON — … 0 créditos por llamada` va al `#combat-log` oculto). **No es #306**: aquello
son errores que saltan solos; este lo provoca el jugador con un control que el título deja a
mano. El sitio natural sería `#ts-error`, que ya está dentro del overlay.

---

### H9 · MENOR — detalles de la banda de #251 y del entorno sin bridge

- La banda dice **«desplaza la lista»**, pero el scroller es `this.content`, o sea la **columna
  entera**: al desplazar se van hacia arriba el título, el subtítulo y «Nueva partida». La frase
  nombra un sujeto que no es el que se mueve.
- Sin bridge y a 500 px de ancho, `#error-log` (320 px fijos, 64 % del ancho) **tapa el muro de
  arranque**, y los dos textos están en inglés (`bridge did not connect within 5000ms…`,
  `WebSocket onerror on ws://…`). Preexistente; captura `…/sin-bridge-500x480.png`.
- Con el bridge caído a mitad de partida, `H` abre el libro y dice
  `No se pudo cargar la sesión: Bridge not connected` — mitad español, mitad jerga inglesa del
  bridge. Preexistente, y es justo la decisión de texto que el ingeniero declara sin cubrir en su
  §5.

---

## 3 · Lo que el ingeniero declaró sin demostrar, y que sí funciona

Dos cosas de su §5 y del §8 del plan quedaban en el aire. Las he ejercido:

- **`replay-web` no lo he visto con mis ojos** (§5). Lo he visto. Con
  `LOG=labs/narrative/runs/2026-08-13_19-50-33/events.ndjson node labs/narrative/replay-server.mjs`
  y el cliente apuntando ahí, la película **se reproduce**: `tiles ["tile_0_0"]`, `scene tile_0_0`,
  4 NPC, panel «Salidas» con seis destinos, etiqueta `Dorel Granero, posadera` sobre un personaje,
  y **`descartados {"n":0}`** — el sello reestampado no tira ni un frame. Captura `…/replay-web.png`.
  (Gotcha para quien lo repita: los logs anteriores a agosto no traen `games_listed` con la forma
  de hoy y el selector de mundos sale vacío; y a `HOLD_MS=3000` el primer tile tarda ~40 s.)
- **«La faceta `mundo` mueve el orden del resume… señal: reanudar y quedarse en clay»** (plan §8).
  No ocurre. Con una fixture pintada detrás del título (`puerto_tile`, `textured: []`) y pulsando
  «Reanudar», sale `scene tile_0_0`, `sesion 1787916821-1b48d2`, **`textured: ["tile_0_0"]`** y la
  posición del save restaurada (`-23.75, 1.25`). El atlas lo despierta `setActiveClientTile`, como
  decía la desviación 6.

---

## 4 · Lo que el coordinador pidió comprobar, punto por punto

**(a) «El número no se puede volver a separar sin que algo se ponga rojo»** → **refutado a
medias**: se puede, desde el lado del título. Es H3, con las dos medidas.

**(b) «El guion 33 deja 12 saves clonados; con `--orden inverso` los demás pagan»** →
**REFUTADO con medida**. `node qa/run.mjs --orden inverso` sobre el árbol entregado: **32/32 en
verde, EXIT=0**. El motivo es que en orden inverso el guion que corre justo después del 33 es el
**32**, que declara `aisla: ["saves"]` y los vacía; y el disco es por corrida
(`qa/.tmp/<RUN_ID>/saves`, con `limpiarTmpViejos`), así que los 12 no sobreviven a la siguiente.
Contra un stack ajeno (`--adoptar`/`--url`) `aislar` **se niega** con un mensaje explícito en vez
de medir sobre saves que no controla. **Repetido con el guion 34 dentro** (que en orden inverso
corre el PRIMERO y deja cinco partidas clonadas): **33/33 en verde**, capturas en
`qa/capturas/2026-08-28T12-07-02-051Z-202590`.

**El panel cortado a media letra** → responde H2. A las dos preguntas: **(1)** se lee como un
fallo de pintado, no como «hay más, desplaza» — el corte parte los glifos por la mitad horizontal,
que es la firma de un recorte roto, y no hay barra de desplazamiento visible, ni degradado, ni
chevrón; compárese con la propia banda de #251, que sí lo hace bien (fondo plano + degradado +
frase). **(2)** el gasto en € **deja de ser legible en el estado que importa**, así que sí, la
cota se ha llevado por delante la función declarada del panel. **El `superficies undefined` es
PREEXISTENTE y del fake-ai-server**, no de esta tanda (H6).

---

## 5 · Workarounds usados durante la prueba, y su veredicto

| Workaround | Por qué | Veredicto |
|---|---|---|
| `page.route('**/sprites/**', abort)` | Simular el clon limpio sin hojas de personaje | **Legítimo**: es el estado REAL de quien clona el repo, y el fallo se inyecta en el BORDE (la red), no dentro del cliente. Mismo idioma que los guiones 27 y 29 |
| `page.route('**/scenes/zorder_test.json*', abort)` | Ver el fallo de fixture de #269 | **Legítimo**: es lo que pasa con una fixture ausente; idéntico al guion 24 |
| Quitar `?input=scripted` de la URL en el guion 34 | Llegar al proveedor de teclado real | **Lo contrario de un workaround**: es retirar un override de bench para llegar a la configuración del jugador. Sin él, ocho de las nueve entradas no existen (H5) |
| Pulsar `#ts-close` en `y=30` y no en su centro | El centro lo tapa la barra de dev | **HALLAZGO, no apaño** → H7. Quien juega se encuentra el mismo obstáculo, y a 500 px de ancho no tiene ningún punto donde pulsar |
| `dev.style.maxHeight='none'` en el navegador | Medir el contrafactual «sin la cota» | Medición pura, revertida en el mismo `evaluate`. No cambia lo que ve el jugador |
| Clonar saves en disco | Llegar a 5 y a 12 partidas | Mismo mecanismo que `clonarSaves` del guion 33. Ejercen el mismo `list()` del bridge; no son doce historias distintas (limitación que el ingeniero ya declara) |
| Sabotear a mano `title-screen.ts`, `dev-ui.css` y `puerta-de-teclado.ts` | Pruebas en negativo (H3, guion 34) | Restaurado desde copia y **verificado por md5**: `title-screen.ts be7b7cc4…`, `dev-ui.css 50c60718…`; `git status` sin ficheros nuevos salvo el guion entregado |
| Dos pestañas contra el mismo bridge | Probar el sello con dos sesiones vivas | Configuración real (el bridge difunde a todos los suscriptores); no fuerza ningún estado |

---

## 6 · No probado, y por qué

- **Gasto real de créditos**: todo contra `fake-ai-server`. No se ha verificado ni un euro real.
- **La ventana residual del sello** que el ingeniero declara en su §5 («un evento de A emitido
  cuando el bridge ya está en B saldría sellado B»): no encontré camino de jugador que la alcance
  —`sessionChangedError` corta el job antes de difundir— y no la fuerzo. **Queda sin probar**, y
  el sello por sí solo no la impediría.
- **El título apareciendo con el pointer lock puesto**: `Escape → document.exitPointerLock()`
  (`keyboard-input-provider.ts:87`) ahora pasa por la puerta, así que con el título delante el
  código ya no lo suelta. No encontré camino de jugador a ese estado (el único retorno al título
  es el muro del loader, y `title-screen.ts` nunca pide `exitPointerLock`). El navegador suelta el
  lock con `Esc` por su cuenta, así que el riesgo parece teórico — pero **no lo he alcanzado**.
- **Presets `play` y `story-web-sin-imagenes`**: gastan créditos o exigen Claude Code en otra
  terminal.
- **Mutación**: la corrió el ingeniero (`session-facets` 34/0, `status-labels` 116/0,
  `state-http-dispatch` 103/0, `npc-director` 118/22 idéntico). No la repetí.
- **`npm run deuda`**: no lo re-medí (§1, criterio 6c).
- **Doce partidas jugadas de verdad**: las de #251 son clones.

---

## 7 · Guion entregado

**`qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs`** (`aisla: ["saves","fake-ai"]`).
Tres bloques, todos por el camino del jugador:

1. **#285 con su control.** Carga una fixture desde `#room-selector` **con el título delante**
   (el camino que el plan nombró como no cubierto: el selector vive a z-index 10000 sobre el
   overlay), comprueba que hay mundo detrás y `#game-ui` a 0 px —si no, el «no pasó nada» no
   diría nada—, pulsa las **nueve** entradas con teclado y ratón reales, y luego cierra el título
   con un **clic de ratón real** sobre `#ts-close` y las vuelve a pulsar. Afirma la DIFERENCIA.
2. **La cota del panel y el gasto** (H2), con un `MutationObserver` dentro de la página y sobre
   una generación de atlas REAL (`aisla: ["fake-ai"]` deja el motor falso sin superficies).
3. **El número del aviso de #251** (H1), calculando de la página la altura de ventana en la que
   el desborde es menor que el margen de la lista.

Sin esperas por reloj (usa avance de fotogramas y `ctx.waitFor`), sin puertos escritos (deriva la
URL de `ctx.page.url()`), y verde en la batería: **33/33** en orden alfabético.

**Probado en negativo, las tres veces**:

| Rotura | Qué salió |
|---|---|
| quitar `if (elTituloManda()) return;` de `puerta-de-teclado.ts` | ✘ «NINGUNA de las nueve entradas responde» — `pos`, `ataque quick→precise`, `debugView off→collision`, `libroOculto true→false`, `B · fps: colisión` y `Hablando con Olmo…` |
| que el aviso cuente el TOTAL en vez de las tarjetas fuera | ✘ «el aviso cuenta las partidas que quedan FUERA, no las que hay» — `dice 5 · fuera 4 · total 5` |
| (control del propio guion) medir la Δ del ataque en vez de su valor absoluto | el control degeneraba justo cuando la puerta estaba rota; corregido a un aserto absoluto leído del catálogo de la sesión (`attackKeys["5"]`) |

**Los dos `ctx.log` marcados `⚠ HALLAZGO ABIERTO` son deliberados y hay que ascenderlos a
`ctx.expect` en el commit que arregle H1 y H2** — el mismo camino que siguió el aserto del guion
24 (`qa/README.md`). Sus líneas llevan escrito qué condición poner.

---

## 8 · Veredicto

**Apto con reservas.**

Los cinco issues están implementados y demostrados en el flujo real: #282 sella y descarta de
verdad (incluido el caso de dos sesiones vivas, que la guarda barata no cerraba), #269 nombra la
etiqueta y el desplegable ya no miente, #250 da Δ 0 px donde el mecanismo estaba vivo, #251 avisa
del corte, y #285 va mucho más lejos que la tecla del issue: **nueve** entradas mudas con el
título delante, verificadas una a una con control, en un estado al que la batería no llegaba.

Las reservas son dos defectos **nuevos**, los dos de arreglo corto, los dos con guion que los
imprime en cada corrida:

- **H1**, el aviso de #251 diciendo «hay 0 partidas más» a 1280×800 con cinco partidas. Cambiar
  un aviso mudo por uno que miente es el mismo trato que esta casa rechazó en #269.
- **H2**, el gasto en € ilegible justo mientras se genera, en el panel cuya razón de existir es
  vigilarlo. El dial existe y está medido (110 px deja el guion 33 verde); ojo a H7 antes de
  girarlo.

Y tres avisos sobre los candados, que no bloquean pero conviene no dar por buenos: **H3** (el
número puede volver a separarse desde el título sin ponerse rojo), **H4** (dos formas de
registrar input que el checker no ve y que compilan y pasan el lint) y **H5** (la batería no
recorría ocho de las nueve entradas; cerrado por el guion 34).

Nada de esto justifica parar el merge, pero **#250 y #251 no deberían cerrarse** hasta que H1 y
H2 vuelvan al ingeniero.

---

## 9 · Capturas de evidencia

`qa/capturas/qa-titulo-no-cuenta-nada-2026-08-28/` (tomadas a mano en el flujo real, fuera de la
batería):

| Fichero | Qué enseña |
|---|---|
| `aviso-hay-0-partidas.png` | **H1** · 1280×800, cinco partidas enteras a la vista y la banda diciendo «↓ hay 0 partidas más — desplaza la lista» |
| `panel-generando-500x480.png` | **H2** · el gasto en € partido por la mitad mientras la barra dice «GENERANDO atlas de superficies del tile activo…» |
| `doce-saves-1280x800.png` | #251 funcionando bien: doce partidas, banda legible con «↓ hay 7 partidas más», degradado que desvanece la tarjeta cortada |
| `clon-limpio-fallo.png` | #282 · el título tras el fallo del clon limpio, con su motivo y **sin** el tile de la sesión muerta detrás |
| `reanudar-tras-fixture.png` | Reanudar con una fixture pintada detrás: el mundo del save, con atlas (`textured`) |
| `replay-web.png` | `replay-web` reproduciendo con el sello reestampado (§3) |
| `sin-bridge-500x480.png` | **H9** · sin bridge y en ventana estrecha, el error-log tapa el muro y los dos textos están en inglés |

Las de la batería, con el guion 34 dentro, en `qa/capturas/2026-08-28T11-55-58-293Z-195784`
(orden alfabético) y `qa/capturas/2026-08-28T12-07-02-051Z-202590` (orden inverso).

**`qa/capturas/` está en `.gitignore`** (capturas regenerables), así que estas siete NO viajan
en el commit: viven en la máquina donde se corrió la prueba. Las dos que cargan un hallazgo
—`aviso-hay-0-partidas.png` y `panel-generando-500x480.png`— las regenera cualquiera con
`node qa/run.mjs 34`, que además imprime las dos medidas en su salida.
