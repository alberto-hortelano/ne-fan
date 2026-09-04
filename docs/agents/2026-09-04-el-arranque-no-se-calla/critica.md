# Crítica de T9 «El arranque no se calla»

**La tanda se hace, pero no es la que está escrita.** #392 **VIGENTE** · #341 **VIGENTE** · #393 **REENCUADRADA** (su síntoma está muerto; hay otro vivo y reproducible) · #306 **REENCUADRADA a la baja** (es ~6× más pequeña de lo que dice, y su bloqueo declarado es falso).

Verificado hoy sobre `main` = `c9a92c4`, en vivo donde tocaba. No maté nada ajeno (`ss -ltn` limpio antes y después), cero créditos, y el ledger real quedó **byte a byte idéntico** (1616 líneas, `md5 ddeb8dd154171e51600c0fa2d793293b`).

## #393 — REENCUADRADA. El sujeto es otro puerto

**Problema real**: `--parar` etiqueta como ajeno algo propio, y eso empuja a `--parar-todo`, que sí mata el stack de otro agente.

Premisa, **en vivo** (dos arranques —`cliente-web` y `e2e-sin-creditos`—, `--parar` desde otra invocación, PIDs distintos, resultado idéntico):

- «remote-gen sale ajeno» → **FALSO**: `cwd=/home/al/code/ne-fan` (`start.sh:445`). Sale `· :8768`.
- «sprite-forge sale ajeno» → **FALSO**: propio por la segunda prueba, sus `args` traen `/home/al/code/ne-fan/assets/characters` (`start.sh:516-519`) y `worktree_de_pids` la aplica desde la PR #373 (`start.sh:207-216`). Sale `· :8770`. Tu lectura estática era correcta.
- «`cmd_stop` no consulta `STARTED_PORTS`» → **CIERTO** (`start.sh:1280-1325`) **y es correcto**: la propiedad la demuestra el proceso, no la memoria de un shell muerto. Aquí **miente CLAUDE.md**, no el código: la unión `STARTED_PORTS ∪ {cwd}` que describe no existe y no hace falta. Los tres estados del issue tampoco.

**Lo vivo, y es nuevo**: `:9878` (State API) sale `⏭ AJENO, no se toca` en **las dos** corridas. Comparte proceso con el bridge (mismo PID) y `ALL_PORTS` pone `PORT_BRIDGE` antes que `PORT_STATE` (`start.sh:1263`): cuando el bucle llega a `:9878` el proceso ya murió por el `kill_port` de `:9877` y `worktree_de_pids` no puede demostrar nada → ajeno (`start.sh:1310`). Consecuencia: **todo teardown imprime «Para llevarte también lo ajeno: --parar-todo»** por un fantasma — el arma que la regla de la casa prohíbe. De propina, `kill_port` deja escapar la salida de `fuser` a stdout y parte cada línea del informe (`· :9877 …` y luego un `57419` suelto): la lista no solo miente, no se lee.

## #341 — VIGENTE. Misma tarea; solo el criterio se queda corto

**Problema real**: el muro de arranque le da al jugador un dato accionable que es falso.

Premisa cierta y peor: `net/game-client.ts:253` interpola `CONFIG.ports.bridge` **y `localhost` a pelo**; el socket sale de `serviceUrl("game-gateway")` (`main.ts:1477`), que honra `?offset=`, `?bridge=` y `?ai=` (`net/service-urls.ts:22-42`). Con `?bridge=ws://otro-host:1234` miente en **host y puerto**.

Tu pregunta: **no es reencuadre**. El «Arreglo» del issue ya dice lo correcto («un solo sitio calcula el puerto; el mensaje lo cita»); lo corto es solo el criterio de cierre, y eso no vale un reencuadre.

**No es un hint de desarrollo: llega al jugador.** `bootstrap` lo pinta en el muro visible con `setLoaderState("error", …, (err as Error).message)` (`main.ts:2086-2090`) — el `#narrative-loader` que ya vigila `qa/fixtures-sin-bridge.mjs:105-114`, guion que **ya corre con `?offset=`** (`:49`, `:91`). El candado está a una aserción de distancia.

## #306 — REENCUADRADA a la baja. Ni 62 fuentes, ni falta canal

**Problema real**: durante el título, un fallo que nadie pidió deja al jugador sin explicación.

- «62 `errors.push`» → **55 llamadas reales**; 7 son comentarios.
- «decidir cuáles de las 62 merecen la pantalla» → **falso de raíz**: solo **16** pueden saltar sin que el jugador pulse nada con el título delante; las 39 restantes cuelgan de un click o de sesión viva.
- «el que salta solo no tiene canal» → **falso**: existe `setLoaderState("error", título, detalle)` con muro, texto y botón (`main.ts:1724-1728`), y **ya lo usan** las tres rutas de arranque (`main.ts:2086`, `:2103`, `:2174` —esta hace `titleScreen.hide()` antes, deliberadamente—) más `pintarFalloDelMotor` (`:1865`); `net/game-client.ts:244` y `:254` desembocan ahí. Huérfanas quedan **~9**: `main.ts:213` (`sprite`), `:608` (`input`), `:1461` (`render`), `renderer/fps-renderer.ts:91`, `renderer/sprite-renderer.ts:234`, `net/bridge-client.ts:127/137/191`, `ui/title-screen.ts:555`.
- «no tiene candado barato» → **no verificado y probablemente falso**. El issue asume que el candado tendría que **enumerar fuentes**. La población está definida por un **estado**, no por una lista: `html[data-titulo="1"] #game-ui, html[data-titulo="1"] #error-log { display:none }` (`ui/dev-ui.css:107-108`), con un solo escritor (`main.ts:1586`). Ese estado se pone, se le inyecta un fallo dentro y se afirma qué se lee. **No depende de #241.**

**El subconjunto, que es lo que me pediste**: merece la pantalla el error tras el cual algo que el jugador espera que funcione está roto y él no puede saber por qué. De las ~9, cuatro familias: **three.js que no carga** (`fps-renderer.ts:91` — no hay mundo), **hojas base que no llegan** (`main.ts:213`, `sprite-renderer.ts:234` — los personajes salen en maniquí y nadie lo dice), **el socket del que depende la partida entera** (`bridge-client.ts:127/137/191`) y **la lista de partidas que el título enseña incompleta** (`title-screen.ts:555`). Fuera: las tres de `config` (`main.ts:116`, `:160`, `:414`) son mala configuración del desarrollador, y `main.ts:1461` vive dentro del bucle de render — pintarla por fotograma es una inundación, no un canal.

## #392 — VIGENTE. Tu medida es exacta, y falta contexto

Reproducido con el singleton redirigido a un ledger temporal (el real nunca se abrió para escribir): **43 eventos, $10,32**, y `md5` del real idéntico antes y después. Dos datos que faltan: la **suite completa** (`discover -s ai_server/tests`: 201 tests, 0 fallos) escribe **los mismos 43** — `test_sprite_forge_adapter` es la **única** fuente, así que «un fichero» y «la suite» son la misma cifra —; y el ledger real **ya arrastra 240 eventos falsos, $57,60**, todos del 01 y 02 de septiembre (15 % de las líneas, 7,5 % del total de 768,58). Mecánica confirmada: `spend_tracker.py:65` fija la ruta sin variable de entorno; `remote_generation.py:742` y `:760` (el issue decía `:462`/`:480`).

## Conflictos

- **#341 antes que #306, y no es opcional**: `net/game-client.ts:254` es una de las 16 del grupo A **y** es el texto que #341 arregla. Hacer #306 primero es cablear a la pantalla del jugador un mensaje que se sabe mentiroso. Mismo ingeniero, o #341 primero.
- **#392 y #393 no tocan nada de los otros dos** (Python / `start.sh`): en paralelo desde el primer día; son los baratos y dejan la tanda medio cerrada.
- **T10-T12: cero solapamiento** (mutación, snapshots/`ai_server`, puerta del core). **#241 sigue abierto y sin tanda**: #306 lo cita como su salida; con lo de arriba deja de ser su bloqueo, y no se abre aquí.
- **Sin contradicción con #246**: `dev-ui.css:107-108` no se toca. Dato para el arquitecto: `#narrative-loader` vive **dentro de `#game-ui`** (`index.html:89`…`132`), así que la misma regla lo esconde — por eso las rutas que lo usan hacen `titleScreen.hide()` antes.

## Coste contra valor

**#392** es el más valioso y de los baratos: el número que se mira para decidir si se gasta arrastra $57,60 falsos, y no hacerlo suma $10,32 por corrida. **#393** es barato en cuanto el alcance cae a un bug de orden; no hacerlo deja saliendo siempre el aviso de `--parar-todo`, que alguien acabará obedeciendo. **#341** es una línea y una aserción en un guion que ya existe. **#306** es el único caro, y **mucho más barato de lo que el issue vende**; no hacerlo es defendible, hacerlo con el alcance escrito (62 fuentes) no lo es.

## Qué le cambiaría a `requisitos.md`

1. **#393**: sustituir el bloque entero por «síntoma **muerto**, verificado en vivo el 04-09 en dos presets; lo vivo es **`:9878` clasificado AJENO en todo teardown** porque comparte proceso con el bridge y `ALL_PORTS` lo evalúa después de matarlo. Cierre: tras `--parar` ningún puerto propio sale como ajeno y el informe no se parte con la salida de `fuser`. Además, **corregir CLAUDE.md**: describe una unión `STARTED_PORTS ∪ {cwd}` que el código no hace y no debe hacer. Los tres estados no se piden».
2. **#341**: criterio nuevo — «el muro cita la URL **efectiva** del socket, la que resolvió `serviceUrl("game-gateway")`, y el candado se pone rojo tanto con `?offset=` como con `?bridge=` apuntando a otro host».
3. **#306**: cambiar «62 fuentes» por «**16** pueden saltar solas con el título delante, **~9** sin canal»; borrar «no tiene candado barato» (la población es el estado `data-titulo="1"`, no una lista); y escribir el subconjunto de arriba **como decisión ya tomada**, para que el arquitecto no la reabra.
4. **#392**: mantener tus 43 / $10,32 y añadir que la suite completa da los mismos 43 (única fuente) y que el ledger **ya contiene 240 eventos falsos, $57,60**, del 01 y 02 de septiembre — material del usuario: se le dice, no se toca.
5. En «Lo que se pide»: **#341 antes que #306**; **#392 y #393 en paralelo desde el principio**.
