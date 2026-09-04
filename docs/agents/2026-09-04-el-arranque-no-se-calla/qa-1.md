# QA-1 — T9 «El arranque no se calla» · PR-1 (#341) y PR-2 (#306)

Validado sobre `183fc0d` (HEAD de `t9/cliente`) en el worktree desprendido
`/home/al/code/ne-fan/.claude/worktrees/qa-t9-cliente`, con `nefan-html/public/sprites` copiado del
checkout principal (28 MB fuera de git: sin él se mide un clon limpio, no el juego).
**`NEFAN_PORT_OFFSET=200`** en todo. Cero créditos: `e2e-sin-creditos` (fake-ai-server, guardarraíl
del runner verde en cada guion) y `html-fixtures`. Nada de `pkill` ni de matar por puerto: arranque
por `./start.sh --preset <slug>` y parada por `./start.sh --parar`, siempre desde este worktree.
`cache/spend/events.jsonl` no se ha abierto. El árbol queda como estaba: los seis negativos que hice
a mano se restauraron con `git checkout --` y `git status` solo enseña lo que aporto
(`qa/guiones/70-…` y su fila en `qa/README.md`).

---

## 1 · Criterios

Los criterios LITERALES son los de `requisitos.md`: para #341, «el muro cita la URL **efectiva** y el
candado se pone rojo tanto con `?offset=` como con `?bridge=` a otro host»; para #306, «las cuatro
familias decididas», alimentadas por el mismo `errors.push` (**una sola verdad**) y con el
interruptor de #246 intacto.

| # | Criterio | | Evidencia |
|---|---|---|---|
| 341-a | El muro cita la URL efectiva con `?offset=` | ✅ | `NEFAN_PORT_OFFSET=200 node qa/fixtures-sin-bridge.mjs` → muro: «…running on **ws://127.0.0.1:10077**?», socket efectivo `ws://127.0.0.1:10077`. Con el snapshot habría dicho `:9877` |
| 341-b | …y con `?bridge=` a otro host | ✅ | Misma corrida, segunda pasada: socket `ws://127.0.0.2:10080`, muro «…running on **ws://127.0.0.2:10080**?». Host **y** puerto, los dos distintos del snapshot |
| 341-c | El candado se pone **rojo** en los dos casos | ✅ | Rehecho por mí (no me fío del informe): restaurada a mano la línea de antes de #341 → **3 rojos** («sin bridge», «bridge movido», «con `?bridge=` no nombra el host»). Restaurado con `git checkout --` |
| 341-d | Un solo sitio calcula el puerto, y no vuelve | ✅ | `grep -rn "CONFIG.ports" nefan-html/src` → **0**. Regla nueva `el-cliente-no-lee-el-puerto-del-snapshot` vista **roja** por mí sobre el árbol real: `nefan-html/src/net/game-client.ts:257 — patrón prohibido: "CONFIG.ports"`, `pass 71 · fail 1` |
| 306-1 | Familia 1 (three.js) llega al hueco del título | ✅ | `qa/run.mjs 69` → «No se puede dibujar el mundo: la vista fps no pudo cargar three.js». Negativo rehecho: sin el suscriptor de `main.ts`, timeout esperando el aviso |
| 306-2 | Familia 2 (hojas base) llega, con el remedio | ✅ | Guion 69: «Los personajes van sin vestir: set base y_bot incompleto… genéralas con sprite-forge…». 11 pushes → **1** aviso |
| 306-3a | Familia 3 · trama ilegible, con el título delante | ✅ | Guion 69: «La partida respondió algo que no se entiende: Failed to parse WS frame: }{ esto no es json» |
| 306-3b | Familia 3 · `onerror` del socket | ✅ | Dos estados distintos, los dos medidos: **sin título** (`fixtures-sin-bridge`, el muro lo dice a los ~0 ms, 5 s antes que el timeout del arranque) y **con el título delante** — bajé mi propio bridge con `./start.sh --parar` mientras el jugador miraba el título y el aviso apareció en `#ts-error` (captura `j-titulo-bridge-muerto.png`). Negativo (f) rehecho: sin la etiqueta, `fixtures-sin-bridge` rojo |
| 306-3c | Familia 3 · `Dropped '<type>' frame` | ⚠️ | **No probado.** Ningún guion lo ejerce y yo tampoco lo conseguí de forma determinista (el input del bench es `scripted`, y las tramas ruidosas cuelgan de acciones que no supe provocar con el socket ya caído). El propio ingeniero lo declara. Comparte titular con el `onerror`, que sí está medido |
| 306-4 | Familia 4 (la lista de partidas) **se lee de verdad** | ✅ | Es la que por decisión NO se etiqueta, así que había que cobrar la contrapartida. Guion nuevo `70`, bloque 2: se le quita al bridge la respuesta a `list_sessions` (solo esa) → `#ts-status` = «**No se pudieron cargar las partidas guardadas. El servidor del juego no contesta; inténtalo de nuevo.**», visible, dentro de la ventana, con alto propio y **sin código del bridge**. El aserto pide el texto del FALLO: con «Bridge OK — N partidas guardadas» habría salido verde sin fallar nada (probado en negativo) |
| 306-5 | Una sola verdad: el texto de pantalla **es** el `message` del registro | ✅ | Guion 69 compara los dos textos en el MISMO DOM, tres veces |
| 306-6 | El aviso sobrevive al repintado del home | ✅ | Guion 69. Negativo (e) rehecho: quitado el `pintarAvisos()` de `renderHome`, **solo** ese aserto y su gemelo caen; los otros once siguen verdes |
| 306-7 | No inunda: una familia rota = un aviso; tope 3 | ✅ | Guion 69; y medido a mano con las tres familias rotas a la vez: 3 avisos, 68 px a 1280×800 |
| 306-8 | #246 intacto (`#game-ui` oculto bajo `data-titulo="1"`) | ✅ | `dev-ui.css` **no aparece en el diff**. `getComputedStyle(#game-ui).display === "none"` con el título delante, medido en el guion 69 y en cuatro sondas mías |
| 306-9 | El aviso no le cuesta al jugador el botón que iba a pulsar | ❌ | **Δ 33 px** en «Nueva partida» (257→290). Guion 70, bloque 1, y **reproducido sin inyectar nada**: bridge real muerto con el título delante → mismo Δ 33 px. Ver H-2 |
| 306-10 | Los dos huecos no se contradicen | ❌ | El título llega a decir a la vez «Bridge OK — 1 partidas guardadas» y «La partida respondió algo que no se entiende». Guion 70, bloque 4. Ver H-3 |
| 306-11 | El muro no queda armado debajo del título | ❌ | `#narrative-loader` con `class="visible error"` mientras `data-titulo="1"`; al cerrar el título el jugador se come el muro a pantalla completa. Ver H-1 |
| — | Nada roto | ✅ | `npm run verify` en `nefan-core`: **1978 tests, 0 fail** · `node qa/run.mjs` con offset 200: **68 en verde, 0 en rojo de 68** |

---

## 2 · El ataque a la desviación 1 (lo que el ingeniero señaló como discutible)

El plan decía «si el título manda → título; si no → muro». Él implementó «el título apunta
**siempre**, y el muro **además** cuando el título no manda». Las tres mitades, una por una:

### 2.1 · ¿Existe la carrera? **SÍ, y está medida**

Instrumenté la página sin tocar el producto (hook de `console.error`, que es lo que `errors.push`
llama justo antes de avisar, más un sondeo de `data-titulo` desde el primer tick). Tres vueltas,
fallos inyectados en el borde:

| vuelta | familia 2 (hojas) | `data-titulo="1"` | familia 1 (three.js) |
|---|---|---|---|
| 1 | **155,2 ms** | 178,9 ms | 184,4 ms |
| 2 | **140,3 ms** | 155,6 ms | 167,6 ms |
| 3 | **130,5 ms** | 146,3 ms | 154,9 ms |

La familia 2 salta **antes** del primer `show()` en 3/3 (15–24 ms de margen). Con el enrutado del
plan ese aviso habría ido SOLO al muro, y el muro lo esconde `html[data-titulo="1"] #game-ui`
medio segundo después: **el agujero del issue seguiría abierto justo en el arranque**. La familia 1
cae del otro lado en las tres, pero por 8–13 ms: es una carrera, no un orden. Y en una cuarta
medición sobre un stack adoptado el aviso de las hojas llegó **después** del título — o sea que el
orden es genuinamente inestable. **La desviación está justificada**, y el plan estaba mal en ese punto.

### 2.2 · ¿Crea la doble verdad que el requisito prohíbe? **En el espacio no. En el TIEMPO sí**

Su argumento —los dos huecos no pueden verse a la vez porque `#narrative-loader` vive dentro de
`#game-ui`— es **cierto y lo comprobé**: `index.html:132` mete el loader dentro de `#game-ui`
(abierto en `:89`), y con `data-titulo="1"` el `display` computado de `#game-ui` es `none` en todas
mis sondas. No hay dos textos simultáneos, y el texto es el mismo `message` del mismo `errors.push`.

Pero el requisito no prohíbe «dos cajas», prohíbe **dos verdades**, y aparecen igual por dos vías
que nadie miró:

- **El muro queda ARMADO debajo** (`class="visible error"`) y sale entero cuando el jugador cierra
  el título. El mismo aviso, dos veces, separado por un click → **H-1**.
- **El aviso no caduca nunca**, así que acaba contradiciendo al propio título: «Bridge OK — 1
  partidas guardadas» con «La partida respondió algo que no se entiende» encima → **H-3**.

### 2.3 · El aviso rancio (lo que nadie había mirado)

Lo que pregunté y lo que sale:

- **¿Se queda ahí para siempre?** Sí. `avisosDelJugador` no se vacía nunca y `yaAvisados` tampoco;
  no hay quien quite un aviso. **Medido**: corrompí lo que contesta el gateway hasta que llegó el
  aviso, **dejé de corromperlo** y repinté el home por el camino del jugador (entrar al selector de
  mundos y volver). Resultado: `#ts-status` = «Bridge OK — 1 partidas guardadas.» y encima, en rojo,
  «La partida respondió algo que no se entiende». La causa se fue; el aviso no.
- **¿Un aviso que el título apunta y el jugador no ve?** Sí existe ese estado: si el bridge no está
  al arrancar, `bootstrap` falla y `runTitleFlow` no llega a correr, así que el aviso se queda
  apuntado en un título que nunca se pinta. Ahí es inocuo (el muro sí lo dice, y es lo correcto).
- **¿Le sale un aviso rancio al volver al título más tarde?** Por construcción **sí**: `TitleScreen`
  es un singleton de módulo, `volverAlTitulo()` → `runTitleFlow` → `show()` → `renderHome` →
  `pintarAvisos()` repinta el array intacto. Medí la persistencia a través del repintado del home;
  la vuelta **después de una partida completa** no la medí (hace falta un fallo fatal de sesión) y
  la declaro derivada del código, no observada.

---

## 3 · Hallazgos

### H-1 · IMPORTANTE — el muro del arranque queda armado debajo del título y salta cuando el jugador lo cierra

Cuando un aviso gana la carrera de §2.1, el suscriptor pinta el muro (`setLoaderState("error", …)`)
porque `elTituloManda()` todavía es falso. Nadie lo apaga: el título se limita a taparlo. En cuanto
el jugador sale del título por una vía que no llama a `showLoader`/`hideLoader` —el propio botón
«× cerrar (modo fixtures, sin sesión)» que el título ofrece— se encuentra un **muro a pantalla
completa** (medido: 1280×745) con un fallo que **acaba de leer en el título**, y tiene que cerrarlo
para ver nada.

Reproducción, desde el arranque:
1. `NEFAN_PORT_OFFSET=200 ./start.sh --preset e2e-sin-creditos`
2. Abrir la URL que imprime, con las hojas base no disponibles (yo aborté `**/sprites/y_bot/**`; a
   un clon limpio le pasa **sin inyectar nada**, que es el caso de #255).
3. Leer el aviso «Los personajes van sin vestir» en el título y pulsar «× cerrar (modo fixtures)».

Qué esperaba el jugador: ver las fixtures. Qué ve: un muro con spinner, el mismo mensaje otra vez y
un botón «Cerrar». Medido: `data-titulo` `1`→`0`, `#narrative-loader` `class="visible error"` en los
dos momentos, caja 1280×745 tras cerrar.

Y es desproporcionado además de repetido: «Los personajes van sin vestir» es un problema **cosmético**
—se juega igual, con maniquíes— y bloquea la pantalla entera.

*Por qué no lo dejo candado*: el disparador es la carrera, así que un aserto sobre él sería
intermitente, y en esta casa un candado intermitente es peor que ninguno. En cuanto el enrutado se
arregle, el invariante **sí** es determinista y barato: «con `data-titulo="1"`, `#narrative-loader`
nunca está en estado `error`». Lo dejo escrito para quien lo arregle.

### H-2 · IMPORTANTE — un aviso que llega tarde mueve «Nueva partida» 33 px bajo el cursor (#250 otra vez)

`renderHome` ordena su columna a propósito, y lo dice en un comentario: «todo lo que puede cambiar
DESPUÉS del primer pintado va POR DEBAJO del botón», porque un panel que crecía movía «Nueva
partida» +24 px bajo el cursor de quien lo estaba pulsando. **`#ts-error` está ENCIMA del botón**, y
desde #306 es exactamente eso: un hueco que se rellena después.

Medido de dos formas, mismo número:

- Guion 70, bloque 1 (la ruta del chunk se retiene y se suelta con el título ya pintado, así que no
  depende de la carrera): `botonY` 257 → 290, **Δ 33 px**.
- **Sin inyectar nada**: jugador en el título, todo bien, y bajo mi propio bridge con
  `./start.sh --parar`. El `onerror` llega a `#ts-error` y `botonY` 257 → 290, **Δ 33 px**.

El segundo caso es el que importa: el socket puede fallar en cualquier momento con el título
delante, así que esto no es una ventana de milisegundos del arranque — es el jugador leyendo la
pantalla cuando se le cae el bridge. Es más movimiento que el que abrió #250 (+24 px).

Reproducción: los pasos del segundo caso, tal cual. Qué esperaba el jugador: pulsar el botón que
tenía debajo del cursor. Qué pasa: el botón se va 33 px hacia abajo.

Candado: `qa/guiones/70-el-aviso-del-arranque-no-mueve-el-suelo.mjs`, bloque 1. **Rojo hoy.**

### H-3 · IMPORTANTE — el aviso no caduca y acaba contradiciendo al título

Ninguna de las dos estructuras que #306 añade tiene forma de vaciarse (`avisosDelJugador` en
`TitleScreen`, `yaAvisados` en `ErrorLog`; `clear()` documenta explícitamente que **no** toca la
segunda). El aviso es pegajoso a propósito —ese era el bug del `innerHTML`— pero pasa de pegajoso a
eterno.

Medido, sin carreras: corromper lo que contesta el gateway → llega el aviso → **dejar** de
corromperlo → entrar al selector de mundos y volver. Queda en pantalla:

```
La partida respondió algo que no se entiende: Failed to parse WS frame: }{ esto no es json
…
Bridge OK — 1 partidas guardadas.
```

Y en el caso de H-2 la contradicción es **simultánea y triple**: la barra dice «Disconnected», el
aviso dice «Sin conexión con la partida» y tres líneas más abajo, en verde, «Bridge OK — 0 partidas
guardadas». Encima «Nueva partida» sigue habilitado y con buen aspecto, invitando a pulsar algo que
ya no puede funcionar (el selector necesita `listGames`). Esto son las dos verdades que el issue
prohíbe, separadas en el tiempo en vez de en el texto.

Candado: guion 70, bloque 4. **Rojo hoy**, con un aserto de «no concluyente» delante para que el
rojo no pueda ser vacío.

### H-4 · IMPORTANTE — lo que el jugador acaba leyendo es texto técnico, y en el muro es la única línea

El ingeniero lo declara como límite conocido («el detalle sigue siendo el mensaje técnico… algunos en
inglés»), pero en el título es un pie de foto y **en el muro es el mensaje entero**. Medido con el
bridge real muerto a mitad de partida: muro a pantalla completa cuyo único texto accionable es

```
Sin conexión con la partida
WebSocket onerror on ws://127.0.0.1:10077
```

Y en el título, la familia 2 le da al jugador instrucciones de desarrollador: «genéralas con
sprite-forge, receta en docs/assets-de-personaje.md» — que es literalmente lo que el propio
`title-screen.ts` critica en el comentario de su `catch` de `listSessions` («instrucciones de
desarrollo a quien no tiene terminal») y que ahí se arregló con `motivoDeSesionParaElJugador`. Hay
un traductor en casa y este canal no lo usa.

No lo dejo candado: qué frase merece el jugador es criterio de producto, no una aserción.

### H-5 · IMPORTANTE (latente) — la cola `pendientes` está armada contra su propio caso: el cliente muere en blanco

`ErrorLog.pendientes` existe, según su comentario, porque los avisos «saltan durante la evaluación
del módulo». **Eso hoy es falso** —los cuatro emisores son asíncronos, medido en §2.1: el primero
llega a los 130 ms— así que la cola no se usa nunca. El problema es el día que se use: `main.ts`
registra el suscriptor en la línea 1613 y `onAviso` **vacía la cola de forma síncrona**; el
suscriptor llama a `setLoaderState`, que lee `loaderEl`, un `const` declarado en la línea 1687.
Zona muerta temporal.

Medido: inserté una sonda —un `errors.push` etiquetado síncrono— y cargué la página:

```
pageerror: ["ReferenceError: Cannot access 'loaderEl' before initialization"]
estado:    {"hook":false,"titulo":false,"dataTitulo":"(sin poner)"}
```

El cliente **muere entero**: sin hook, sin título, página en blanco. O sea que el mecanismo que
existe para que nada se quede callado mata al cliente en silencio el día que alguien etiquete un
push síncrono — que es exactamente lo que la cola invita a hacer. Sonda retirada, `git status` limpio.

Arreglo barato: registrar el suscriptor **después** de los `const` del loader, o que la cola se
vacíe en una microtarea. Y si la cola no va a tener nunca un emisor síncrono, sobra y su comentario
miente.

### H-6 · MENOR — con tres avisos, las partidas guardadas se van bajo el pliegue en ventana pequeña

A 500×480 (la ventana del guion 33) los tres avisos ocupan **128 px, siete líneas**, la columna
desborda (`scrollHeight > clientHeight`) y «Partidas guardadas» queda cortada al borde. «Nueva
partida» sí sigue dentro y clicable (medido con `elementFromPoint`), y eso lo dejo candado en el
guion 70, bloque 3.

### H-7 · MENOR — crítica visual: los tres avisos no tienen jerarquía y el orden es de llegada

Mirando las capturas como director de arte, no como checklist:

- Los tres van en el mismo `#a44`, mismo cuerpo, mismo peso. El **cosmético** («los personajes van
  sin vestir») grita exactamente igual que **«no se puede dibujar el mundo»**, que es el que deja el
  juego inservible.
- El orden es el de llegada, no el de gravedad: el más largo y menos urgente sale **primero** y el
  importante queda enterrado en medio.
- Titular y detalle van pegados en una sola línea corrida (`Título: detalle`) con el mismo color y
  tamaño, así que la promesa de «el titular es lo que se lee primero» no la sostiene el diseño: se
  lee un párrafo rojo.
- El bloque no dice **qué puede hacer** el jugador (salvo la familia 2, que le manda a un `.md`), y
  no se puede descartar.
- El tope de 3 descarta el **más viejo**, que es el que llegó primero y suele ser el más grave
  (three.js). Con las cuatro familias rotas se pierde justo esa.

### H-8 · MENOR — la familia 4 tarda 30 s en decir nada

El `statusEl` que justifica no etiquetar la familia 4 sale del timeout de `request` (30 s). Durante
medio minuto el título dice «Cargando saves desde el bridge...» y nada más. Cuando por fin habla, lo
hace bien (medido en el guion 70). Es previo a esta tanda, pero es la contrapartida que se aceptó a
cambio de no etiquetarla, así que conviene que conste.

---

## 4 · Workarounds usados, y su veredicto

| Qué | ¿Afecta al jugador? |
|---|---|
| Copiar `nefan-html/public/sprites` del checkout principal | **No, y era obligatorio**: sin ellas se mide un clon limpio. Directorio en `.gitignore` |
| Instalar dependencias del worktree, `narrative-mcp` incluido | **No.** Sin `narrative-mcp/node_modules`, `npm run verify` falla con `ERR_MODULE_NOT_FOUND: '@nefan/core'` en `test/contract-fixtures.test.ts` — es del entorno, no del diff. Con ellas: 1978/0 |
| Abortar peticiones del borde (`**/fps-gl*`, `**/sprites/y_bot/**`) e interceptar el WebSocket | **No**: es el mismo método del guion 69 y son fallos reales (un chunk que no llega, las hojas que no están en un clon limpio, un socket que contesta mal). No se stubea el cliente |
| Retener la ruta del chunk y soltarla cuando el guion quiere | **No.** Es una petición lenta que acaba fallando, y sirve para quitarle la carrera al aserto. Además el mismo Δ 33 px sale **sin inyectar nada**, bajando el bridge de verdad |
| Bajar mi propio bridge con `./start.sh --parar` a mitad de prueba | **No**: es el camino de la casa y solo se lleva lo de este worktree (comprobado: enumera `:10077`, `:3200`, `:18965` como propios) |
| Sonda de H-5: un `errors.push` etiquetado síncrono en `main.ts` | **Es un hallazgo, no un apaño** — está reportado como H-5. Sonda retirada y árbol limpio |
| Seis negativos rompiendo el código a mano | Restaurados con `git checkout --`; `git status` solo enseña mi guion y la fila del README |

---

## 5 · No probado

- **`Dropped '<type>' frame: bridge not connected`** (una de las seis etiquetas): no lo ejerce ningún
  guion y yo tampoco lo provoqué de forma determinista. Queda **sin medir**, no aprobado por parecido.
- **El aviso rancio tras una partida completa** (`volverAlTitulo()`): derivado del código y medido
  solo a través del repintado del home. La vuelta desde un fallo fatal de sesión no la ejercí.
- **Gasto real de créditos**: no aplica y no se tocó. Todo con `fake-ai-server`; `cache/spend/events.jsonl`
  ni se abrió.
- **PR-3 (#392) y PR-4 (#393)**: fuera de mi encargo. Dicho de paso, en cada `--parar` de esta rama
  vi el síntoma vivo de #393 (`⏭ :10078 (desconocido) — AJENO, no se toca` y el consejo de
  `--parar-todo`, con las líneas partidas por la salida de `fuser`), como manda la crítica.

---

## 6 · Lo aportado

- `qa/guiones/70-el-aviso-del-arranque-no-mueve-el-suelo.mjs` — 10 asertos, **8 verdes y 2 rojos**
  (H-2 y H-3), cada rojo con su aserto de «no concluyente» delante para que no pueda ser un rojo
  vacío. Probado en negativo, como manda `qa/README.md`: quitando el tragado de `list_sessions` el
  aserto de la familia 4 se pone rojo («Bridge OK — 1 partidas guardadas.»), y a 500×300 se ponen
  rojos los dos del botón (`dentroDelViewport:false`, `golpea:null`). Reproduce igual sobre stack
  frío y sobre stack adoptado.
- Su fila en `qa/README.md`.

## 7 · Veredicto

**Apto con reservas.**

Lo que se pidió está hecho y lo he verificado yo, no leído: #341 cumple sus dos criterios literales
con el candado visto rojo por mí en los dos; #306 lleva las cuatro familias a la pantalla del
jugador con una sola verdad textual, sobrevive al repintado, no inunda y no toca el interruptor de
#246; la batería entera sigue verde (68/68) y `npm run verify` también (1978/0). La desviación 1 —la
decisión que se señalaba como discutible— **está justificada**: la carrera existe y la medí, y con el
enrutado del plan la familia de los personajes se habría perdido en 3 de 3 arranques.

Las reservas son tres, y las tres son de jugador, no de código: el arreglo **le mueve el botón bajo
el cursor** (H-2, 33 px, reproducido con el bridge real), **le deja un muro armado a la espalda**
(H-1) y **le acaba mintiendo** cuando la causa desaparece (H-3). Ninguna es un rediseño: H-2 se cierra
moviendo `#ts-error` por debajo de «Nueva partida» —que es la regla que el propio `renderHome` ya se
aplica—, H-1 apagando el muro cuando el título toma el mando, y H-3 dándole al aviso una forma de
morir. H-5 es una línea de sitio y desactiva una mina.
