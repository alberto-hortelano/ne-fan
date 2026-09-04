# T9 — «El arranque no se calla»

## La petición, literal

> Adelante con T9

Dicho por el usuario el **2026-09-04**, cerrando la corrida de mutación de la tanda anterior. «T9» es
la fila de la hoja de ruta acordada el 2026-09-02, que dice **exactamente** esto:

> | **T9** | «El arranque no se calla» | #306 + #341 + #393 + #392 | 4 | Fail-loud barato: errores del
> título sin canal, el muro de arranque cita el puerto sin offset, `--parar` llama ajenos a los
> propios, los tests Python escriben en el ledger de gasto real |

Y el encuadre de la serie, también literal, de la petición que la abrió el 2026-09-02:

> Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los plugins los
> podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser plugins
> y tienen baja prioridad en cuanto a calidad del codigo.

## Restricciones vigentes de la casa

- **«no le cerreis sus servers»**: en esta máquina trabajan otros agentes en paralelo. Nunca `pkill`,
  nunca matar por puerto. Arrancar solo con `./start.sh --preset <slug>`; parar solo lo propio con
  `./start.sh --parar`. Esta tanda toca `start.sh`, así que la regla **es también el sujeto**.
- **Cero créditos** en toda verificación (`e2e-sin-creditos`, `html-fixtures`, `cliente-web` sin activar
  imagen IA).
- **Pre-producción**: cero compatibilidad hacia atrás; lo que se sustituye se borra el mismo día, con
  `grep` a cero — prosa, comentarios y docs incluidos.
- El material pagado o de sesión va a `archivo/`, **nunca `rm`**. **El ledger de gasto es de esa
  familia**: no se toca sin confirmación explícita del usuario (lo dice el propio #392).
- Fail-loud por capa (CLAUDE.md § «Errores y logging»): `errors.push` en TS/HTML, `narrative_status:
  error` en el bridge, `HTTPException` en Python.
- **Candado, no prosa**: todo invariante de esta tanda tiene que poder ponerse **rojo**. Un criterio que
  no se puede romper a mano no es un criterio.

---

## Medidas de HOY (2026-09-04, sobre `main` = `c9a92c4`)

Las tomé antes de escribir nada, porque en esta casa **los issues caducan en horas** y la tanda
anterior ya me pilló copiando cifras de un cuerpo viejo bajo el rótulo «medido». Tres de los cuatro
issues han derivado, y uno puede estar hecho.

### #306 — los errores que saltan solos durante el título no tienen canal

**Sustancia: VIGENTE. Citas: caducadas.**

| lo que dice el issue | lo que hay hoy |
|---|---|
| «53 `errors.push`» | **62** (`grep -rn 'errors\.push' nefan-html/src \| wc -l`) |
| `title-screen.ts:380-386` | `#ts-error` se lee en `:487` y se declara en `:504` |
| `title-screen.ts:398` (lo borra `renderHome`) | sigue existiendo; verificar la línea |
| `main.ts:196` (`baseSheetsReady.catch`) | `:212` |
| `main.ts:116, :148, :334` (`errors.push("config")`) | `:116` y `:160`; el tercero hay que relocalizar |
| `dev-ui.css:103` (el interruptor de #246) | vive y **NO se toca**: es decisión deliberada |

El nudo que el issue identifica **sigue intacto y es el trabajo de verdad**: `#ts-error` guarda **un
solo** mensaje (`el.innerHTML = …`) y cada `renderHome` lo borra. «Que lo alimente el mismo
`errors.push` para no tener dos verdades» y «que lo lea quien juega sin abrir las herramientas de
desarrollo» son **incompatibles tal cual** con 62 fuentes. Alguien tiene que decidir explícitamente
cuáles merecen la pantalla de un jugador. El issue avisa además de que **no tiene candado barato** y
que eso es lo que lo dejó fuera de la tanda del título.

**Crítica: REENCUADRADA A LA BAJA — es ~6× más pequeña, y su bloqueo declarado es falso.** Mis 62 eran
el recuento crudo del grep; y sobre todo, el número que importa no es ese:

- **55 llamadas reales** (7 de las 62 son menciones en comentarios).
- De ellas, **solo 16** pueden saltar sin que el jugador pulse nada con el título delante. Las 39
  restantes cuelgan de un click o de una sesión viva, y **ya tienen canal**.
- **El canal del jugador YA EXISTE**: `setLoaderState("error", título, detalle)` con muro, texto y
  botón (`main.ts:1724-1728`), y ya lo usan las tres rutas de arranque (`:2086`, `:2103`, `:2174`) más
  `pintarFalloDelMotor` (`:1865`). Verificado por el coordinador. Así que la premisa «el que salta solo
  no tiene canal» es falsa: lo que falta es **conectar las huérfanas**, no inventar un canal.
- Huérfanas quedan **~9**: `main.ts:213` (`sprite`), `:608` (`input`), `:1461` (`render`),
  `renderer/fps-renderer.ts:91`, `renderer/sprite-renderer.ts:234`, `net/bridge-client.ts:127/137/191`,
  `ui/title-screen.ts:555`.
- **«No tiene candado barato» es premisa falsa.** Asume que el candado tendría que ENUMERAR fuentes,
  pero la población está definida por un **estado**: `html[data-titulo="1"] #game-ui, …#error-log
  { display:none }` (`ui/dev-ui.css:107-108`), con **un solo escritor** (`main.ts:1586`). Se pone ese
  estado, se inyecta un fallo dentro y se afirma qué se lee. **No depende de #241.**

**El subconjunto — DECISIÓN TOMADA, aprobada por el usuario el 04-09. No se reabre.** Merece la
pantalla el error tras el cual algo que el jugador espera que funcione está roto y él no puede saber
por qué. Cuatro familias:

1. **three.js que no carga** (`fps-renderer.ts:91`) — no hay mundo.
2. **Hojas base que no llegan** (`main.ts:213`, `sprite-renderer.ts:234`) — los personajes salen en
   maniquí y nadie lo dice.
3. **El socket del que depende la partida entera** (`bridge-client.ts:127/137/191`).
4. **La lista de partidas que el título enseña incompleta** (`title-screen.ts:555`).

**FUERA, y también decidido**: las tres de `config` (`main.ts:116`, `:160`, `:414`) son mala
configuración del desarrollador, no del jugador; y `main.ts:1461` vive dentro del bucle de render —
pintarla por fotograma es una inundación, no un canal.

**Dato para el arquitecto**: `#narrative-loader` vive DENTRO de `#game-ui` (`index.html:89`…`132`), así
que la regla de #246 también lo esconde — por eso las rutas que lo usan hacen `titleScreen.hide()`
antes. El interruptor de #246 **no se toca**.

### #341 — el muro de arranque manda a mirar a `:9877` aunque el socket lleve offset

**Sustancia: VIGENTE, y MÁS ANCHA que lo escrito. Cita: caducada.**

- El fichero del issue (`nefan-html/src/game-client.ts:247`) **ya no existe**. Hoy es
  `nefan-html/src/net/game-client.ts:253`.
- Confirmado: el muro interpola `CONFIG.ports.bridge`, el snapshot a pelo.
- **Lo que el issue no dice**: el socket real no se limita a aplicar el offset — usa
  `serviceUrl("game-gateway")` (`main.ts:1477`), que honra `?offset=` **y también `?bridge=`**, que
  puede apuntar a otro host y otro puerto enteros. O sea que el muro **también miente** en el stack E2E
  de `labs/narrative`, no solo con offset. El criterio de cierre del issue (`?offset=500` → `:10377`)
  se quedaría corto: pasaría verde con el `?bridge=` todavía roto.
- Hay vecindario para el candado: `qa/fixtures-sin-bridge.mjs` ya mira el muro.

**Crítica: VIGENTE, no reencuadre.** El «Arreglo» del issue ya dice lo general («un solo sitio calcula
el puerto; el mensaje lo cita»); lo corto es solo su criterio de cierre. Dos datos que suben su valor:
el muro interpola además **`localhost` a pelo**, así que con `?bridge=ws://otro-host:1234` miente en
host Y puerto; y **no es un hint de desarrollo, llega al jugador** — `bootstrap` lo pinta en el muro
visible con `setLoaderState("error", …, (err as Error).message)` (`main.ts:2086-2090`), el
`#narrative-loader` que `qa/fixtures-sin-bridge.mjs:105-114` ya vigila **corriendo con `?offset=`**.

**Criterio de cierre (nuevo)**: el muro cita la URL **efectiva** del socket —la que resolvió
`serviceUrl("game-gateway")`— y el candado se pone rojo tanto con `?offset=` como con `?bridge=`
apuntando a otro host.

### #393 — `--parar` llama ajenos a remote-gen y sprite-forge

**Crítica (verificado EN VIVO el 04-09, dos presets —`cliente-web` y `e2e-sin-creditos`—, `--parar`
desde otra invocación, PIDs distintos, resultado idéntico): el síntoma del issue está MUERTO.**

- «remote-gen sale ajeno» → **falso**: `cwd=/home/al/code/ne-fan` (`start.sh:445`). Sale `· :8768`.
- «sprite-forge sale ajeno» → **falso**: propio por la segunda prueba de `worktree_de_pids`, que entró
  en la PR #373 (`start.sh:207-216`); sus `args` traen `$PROJECT_DIR/assets/characters`. Sale `· :8770`.
- «`cmd_stop` no consulta `STARTED_PORTS`» → **cierto y CORRECTO**. La propiedad la demuestra el
  proceso, no la memoria de un shell muerto — y quien pulsa `k` casi nunca arrancó nada en esa
  terminal. **Aquí miente CLAUDE.md**, no el código: describe una unión `STARTED_PORTS ∪ {cwd}` que no
  existe y no debe existir. Los tres estados que pide el issue **no se piden**.

**El sujeto vivo es OTRO PUERTO, y es nuevo.** `:9878` (State API) sale `⏭ AJENO, no se toca` en **las
dos** corridas. Causa estructural, confirmada por el coordinador: el bridge y la State API son **un
solo proceso con dos puertos** (`track_started $! "$PORT_BRIDGE" "$PORT_STATE"`, `start.sh:398`) y
`ALL_PORTS` pone `PORT_BRIDGE` **antes** que `PORT_STATE` (`:1263`); cuando el bucle llega a `:9878` el
proceso ya murió por el `kill_port` de `:9877`, así que `worktree_de_pids` no puede demostrar nada
(`:1310`).

Consecuencia, que es el daño del issue original y peor: **todo teardown imprime «Para llevarte también
lo ajeno: `--parar-todo`»** por un fantasma — el arma que «no le cerreis sus servers» prohíbe. De
propina, `kill_port` deja escapar la salida de `fuser` a stdout y **parte cada línea del informe**, así
que la lista ni miente sola: además no se lee.

**Criterio de cierre (nuevo)**: tras `--parar`, ningún puerto propio sale como ajeno y el informe no se
parte con la salida de `fuser`. Y **se corrige CLAUDE.md**, que describe una unión que el código no
hace.

### #392 — los tests Python escriben en el ledger de gasto real

**VIGENTE, y PEOR de lo escrito.** Medido hoy, con el ledger respaldado antes y restaurado después
(no había ningún servicio del catálogo escuchando, así que no había otro escritor):

| | issue (2026-09-02) | medido hoy |
|---|---|---|
| eventos por corrida | 24 | **43** |
| coste falso | «$0,24 en total», «unos 5,8 $» | **$10,32** |
| alcance medido | `discover -s ai_server/tests` | **un solo fichero**, `test_sprite_forge_adapter` |

Las cifras del issue son además **incoherentes entre sí** ($0,24 es el coste de UN evento, no del
total). Creció porque T8 (#415) añadió tests a ese mismo fichero. El ledger real está en 1616 líneas y
**lo dejé como estaba**: los 43 de mi medición son míos y los quité; los que ya había, no se tocan sin
que lo diga el usuario.

**Crítica (reproducido con el singleton redirigido a un ledger temporal; el real nunca se abrió para
escribir, `md5` idéntico antes y después): la medida es exacta.** Y añade dos datos:

- La **suite completa** (`discover -s ai_server/tests`, 201 tests) escribe **los mismos 43**:
  `test_sprite_forge_adapter` es la **única** fuente, así que «un fichero» y «la suite» son la misma
  cifra.
- El ledger real **ya arrastra 240 eventos falsos, $57,60** — el **7,5 %** de los $768,58 del total.
  Verificado por el coordinador: 144 del 01-09 y 96 del 02-09, todos reconocibles por el prompt de
  test «un herrero de pelo cano».

**AUTORIZADO por el usuario el 04-09**: esos 240 se **retiran a `archivo/`** con su fecha —copia, no
borrado— dentro del trabajo de #392. El total vuelve a ser gasto real: $710,98.

Mecánica confirmada: `SPEND = SpendTracker(Path(__file__).resolve().parent.parent / "cache" / "spend")`
(`ai_server/spend_tracker.py:65`) — ruta **fija, sin variable de entorno**; los tests hacen POST a
`/skin_sprite_sheet`, que llama `SPEND.add` en `remote_generation.py:742` y `:760` (el issue decía
`:462` y `:480`).

---

## Lo que se pide de la tanda

Los cuatro issues cerrados, o **declarados obsoletos con la medida que lo demuestre** — que es un
resultado igual de bueno y más barato. En concreto:

1. **#392 y #393 en paralelo desde el primer día**: son independientes (Python / `start.sh`), no tocan
   nada de los otros dos y dejan la tanda medio cerrada.
2. **#341 ANTES que #306, y no es opcional**: `net/game-client.ts:254` es a la vez una de las 16 del
   grupo de #306 **y** el mensaje que #341 arregla. Hacer #306 primero sería cablear a la pantalla del
   jugador un texto que ya se sabe mentiroso.
3. Cada arreglo con un candado que se haya visto **rojo** antes de existir el arreglo.
4. El subconjunto de #306 **ya está decidido** arriba (usuario, 04-09): el arquitecto no lo reabre.
5. La retirada de los 240 eventos del ledger va **a `archivo/`**, dentro de #392, y está autorizada.

## Fuera de alcance

- El interruptor de #246 (`dev-ui.css`): no se revierte.
- #241 (que ni una línea de `nefan-html` esté medida): es el programa donde #306 dice que probablemente
  se resuelva su candado, pero **no se abre aquí**.
- Cualquier cosa de plugins, combate, movimiento o comercio: aparcada por decisión del usuario.
