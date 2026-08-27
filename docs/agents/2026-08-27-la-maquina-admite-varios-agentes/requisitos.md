# La máquina admite varios agentes a la vez

Issues: **#274** (los puertos del bench son constantes) · **#271** (`qa/run.mjs` con los puertos
clavados) · **#275** (la suite se corre dos veces por ciclo y `node --test` acapara la máquina).

## Petición literal del usuario

> «adelante con la tanda de la maquina»

Dicho sobre esta propuesta, que el usuario aceptó tras la revisión de los 34 issues abiertos:

> **1 · #274 + #271 + #275 — la máquina.** Es lo único que separa un agente de varios, y arregla
> de paso tu queja del procesador. Con una trampa que el crítico ya midió: el guardarraíl de cero
> créditos reconoce al motor falso **por su número de puerto**, así que un puerto por instancia lo
> dejaría ciego. Eso toca dinero y va primero. Y el primer paso ni siquiera son los puertos: es
> que `start.sh` deje de matar procesos ajenos al arrancar.

Restricción permanente del usuario, de una sesión anterior y **vigente**:

> «no le cerreis sus servers»

Hay **otras instancias de Claude trabajando en paralelo en otros proyectos de esta máquina**.
Nunca se matan procesos que no haya arrancado uno mismo. `pkill vite` / `pkill node` /
`pkill python` están **prohibidos**, y matar por puerto lo que no arrancaste, también.

Y la queja que originó #275, del 2026-08-25:

> «veo el procesador a mas del 70% muy a menudo»

## Reencuadre del crítico (2026-08-27) y decisiones del usuario

`critica.md` devolvió **REENCUADRADA**. Su frase resumen, que es la que hay que tener delante al
diseñar:

> No es que los puertos sean constantes: es que **una corrida no posee sus recursos** —puertos,
> disco efímero, logs, capturas—, y el puerto es el más visible, no el que produce el fallo más
> caro.

Dos premisas de la versión original **cayeron medidas**: que los puertos fueran el único
obstáculo (son cinco), y que el guardarraíl de dinero estuviera a punto de quedarse ciego (**ya lo
está: nunca ha medido nada**). Los criterios 2, 3 y 5 están reescritos abajo con eso dentro.

Presentado al usuario, que decide:

1. **Alcance**: *«Todo, en el orden del crítico»* — guardarraíl primero porque es lo único que
   cuesta dólares, luego dejar de matar lo ajeno, luego los cuatro obstáculos de estado, luego los
   puertos, y #275 de propina. Se acepta que la tanda es más grande de lo que pintaban los tres
   issues.
2. **La tecla `k`**: *«por defecto solo lo propio, barrido bajo bandera»*. Ver criterio 2.

Y tras leer el plan del arquitecto, dos decisiones más (2026-08-27):

3. **Qué cuenta como «propio» para la tecla `k`**: *«por worktree»*. El arquitecto avisó de que
   «solo lo que arrancó esta terminal», literal, deja la tecla **inservible en su caso real** —
   quien pulsa `k` casi nunca ha arrancado nada ahí, así que `STARTED_PORTS` está vacío y el
   huérfano propio sobrevive. Queda: `k` mata `STARTED_PORTS` **∪ los puertos del catálogo cuyo
   proceso viva en ESTE worktree** (`readlink /proc/<pid>/cwd` bajo `$PROJECT_DIR`; **ilegible =
   ajeno**, nunca al revés). El barrido de todo el catálogo sigue existiendo bajo bandera
   explícita, enumerando con `port_owner` antes.

4. **`verify` NO cambia — el usuario decide distinto de lo que recomendaba el plan.** El §4.5
   proponía `verify` = build + typecheck + lint + **coverage** (una sola pasada instrumentada).
   El usuario elige *«verify sigue con npm test»*: el bucle interno se queda en ~8 s en vez de
   irse a ~34 s. **El criterio 7 se cumple por el otro lado**: `coverage` **sale del ciclo local**
   y se queda en CI y cuando haga falta `crap -- --check`; y en CI **el duplicado que se va es
   `npm test` (`ci.yml:41`)**, porque allí `coverage` tiene que correr igualmente para que
   `crap -- --check` encuentre su `lcov.info`.
   Consecuencia asumida y escrita: **la cobertura deja de medirse en cada vuelta local**. Quien
   toque umbrales o quiera saber si la cobertura baja, corre `coverage` a mano.
   Lo que NO cambia del §4.5: el `-c ${NEFAN_TEST_CONCURRENCY:-4}` en `test` y en `coverage`, el
   `dump-config` de `precoverage`, y las dos reglas nuevas de `arch-rules.json`.

El crítico también avisa de que **el desplazamiento de puertos es el trozo más caro y el de menor
valor por euro**, y de que el incidente del 25/08 que cita #274 lo causaron el árbol compartido
(ya resuelto con worktrees) y el estado compartido — los puertos son lo único que ese incidente
**no** acusa. Se hace igualmente porque sin él no hay dos corridas simultáneas, pero se hace
**el último**: si hay que cortar por tiempo, se corta por ahí.

## Contexto que solo tiene el coordinador

**El defecto medido hoy (2026-08-27) sobre `main` `c4a6e8f`, y hay que citarlo bien porque en la
conversación se dijo mal primero:** `fuser -k` aparece **una sola vez** en `start.sh` (el helper
`kill_port`, línea 53). Lo que está mal son sus **llamadas**: **nueve funciones `start_*` matan
al ocupante de su puerto antes de arrancar**, sin preguntar de quién es:

```
162 start_bridge · 184 start_fake_ai · 196 start_replay · 205 start_asset_store
214 start_remote_gen · 243 start_sprite_forge · 277 start_narrative_mcp
297 start_ai · 311 start_html
```

Las **otras dos** llamadas a `kill_port` son legítimas y **no se tocan**:

- **L954** — la tecla `k`. Mata por puerto lo que no arrancó, pero es lo que se le pide y
  **enumera quién es cada uno antes de hacerlo** (`port_owner`).
- **L999** — el `trap EXIT`, que solo recorre `STARTED_PORTS` y lo dice: *«un puerto ajeno no se
  toca ni aunque esté en el catálogo»*.

O sea: **la intención correcta ya está escrita en el fichero, en la bajada. Lo que falta es
aplicarla también a la subida.** Eso hace la tarea más pequeña de lo que parece y da el patrón.

**Dónde están los puertos, medido:**

| Sitio | Qué |
|---|---|
| `start.sh:16-23` | `PORT_BRIDGE=9877`, `PORT_STATE=9878`, `PORT_HTML=3000`, `PORT_AI=8765`, `PORT_NARR=3737`, `PORT_ASSETS=8767`, `PORT_RGEN=8768`, `PORT_FAKE=18765`, `PORT_FORGE=8770` |
| `qa/run.mjs:67,68` | `BASE = "http://localhost:3000"`, `FAKE_AI = "http://127.0.0.1:18765"` |
| `qa/run.mjs:124-126` | la tabla de espera: `[18765, "fake-ai-server"]`, `[9877, "bridge"]`, `[3000, "cliente HTML"]` |
| `qa/run.mjs:324` | `new WebSocket("ws://127.0.0.1:9877")` |
| `qa/lib/sesion.mjs:20` | **el guardarraíl de dinero**: `/:18765(\/|$)/` |

**`qa/presets.mjs` NO es un cuarto sitio, y eso es una buena noticia**: ya deriva los puertos
**parseando `start.sh`** (`SERVICE_LABELS`, `PORT_STATE`) en vez de copiarlos, y **lanza** si una
etiqueta no declara puerto. Cualquier solución debe conservar esa propiedad: `start.sh` es la
fuente, no una copia más.

**Lo que toca dinero, y por eso va primero.** `backendEsFalso` (`qa/lib/sesion.mjs:14-22`)
decide si un guion puede disparar generación mirando si el `?ai=` de la página **contiene el
puerto 18765**. Su docstring lo dice: *«el mismo click contra un stack real cuesta dólares»*. Un
desplazamiento de puertos por instancia **lo deja ciego**: el motor falso pasaría a estar en otro
puerto y el guardarraíl no lo reconocería. Los dos desenlaces son malos y hay que descartar los
dos por construcción:

1. **Falso negativo** — el guion se niega a correr contra un motor falso legítimo (molesto, no
   caro).
2. **Falso positivo** — el guardarraíl bendice como falso algo que no lo es, y una corrida
   dispara generación real. **Eso cuesta dinero.**

## Criterios de aceptación

1. **Arrancar el stack no mata nada ajeno.** Con un proceso que no arrancó este launcher
   ocupando un puerto del catálogo, `./start.sh` **no lo mata**: o usa otro puerto, o se niega
   diciendo quién lo ocupa (`port_owner` ya existe). Verificable arrancando un `nc -l` en :3000 y
   comprobando que sigue vivo después.
2. **La bajada se ajusta a que ahora hay varios dueños.** El `trap EXIT` sigue tocando solo
   `STARTED_PORTS` y no se toca. **La tecla `k` SÍ cambia** — decisión del usuario (2026-08-27),
   tras el aviso del crítico de que el criterio original conservaba el arma que esta tanda
   multiplica: *«por defecto solo lo propio, barrido bajo bandera»*. Por defecto `k` mata lo que
   arrancó ESTA instancia; el barrido de todo el catálogo sigue existiendo pero hay que pedirlo
   explícitamente, y sigue enumerando (`port_owner`) antes de matar. Enumerar no basta cuando el
   dueño es otro agente.
3. **Dos corridas de `qa/run.mjs` a la vez terminan las dos**, cada una midiendo su propio stack.
   Ninguna se engancha a la otra ni la tumba. **Esto NO se cumple cambiando puertos**: el crítico
   midió cuatro obstáculos más, y son parte del criterio:
   - `qa/lib/saves.mjs:35-41,79` — `directoriosDeSaves()` recorre **todos** los `qa/.tmp/*/saves`
     sin filtrar por `RUN_ID` y `listarSaves()` se queda con `const [dir] = …`: el primero
     alfabético es el `RUN_ID` más ANTIGUO, o sea **el disco del otro agente**. Es el «sale verde
     midiendo otra cosa» de #271 en una capa que #271 no mira. **Este es el más caro de los cuatro.**
   - `qa/run.mjs:231-237` — `limpiarTmpViejos()` **borra el disco vivo del otro agente** (todo
     `qa/.tmp/*` que no sea el suyo), y se llama justo cuando la corrida tiene stack propio (`:452`).
   - `qa/run.mjs:51,439-440` — `qa/capturas/` es ruta fija, se borra entera al arrancar y los
     nombres (`:415`) no llevan `RUN_ID`.
   - `start.sh:13` — los nueve logs son `/tmp/nefan-*.log`: nombre fijo, truncan, y cruzan
     worktrees. `NEFAN_LOG_DIR` existe y **nadie lo pone jamás** (`run.mjs:170` solo exporta saves
     y games).
   Menores de la misma forma, a decidir por el arquitecto: `vite.config.ts:26` sin `strictPort`
   (vite salta solo a 3001 y `BASE` sigue en 3000, así que B mide el cliente de A) y
   `manifest-db.ts:15-17`, que declara ser el único proceso que abre el `.sqlite3`.
4. **Engancharse a un stack ajeno es opt-in explícito.** Hoy es el comportamiento por defecto y
   sale por consola como una comodidad; pasa a requerir una bandera. Sin ella, encontrarse el
   puerto ocupado por alguien ajeno es un error que se explica, no un verde que mide otro código.
5. **El guardarraíl de cero créditos se CONSTRUYE, porque hoy no existe.** El crítico lo midió
   ejecutando el par URL/regex: `backendEsFalso` es una **tautología** que siempre devuelve `true`.
   `run.mjs:68` fija la constante `FAKE_AI="http://127.0.0.1:18765"`, `:82` la mete en la query,
   `:502` es la **única** navegación del banco y `sesion.mjs:17-22` la lee de vuelta. **Nunca ha
   medido el backend**; lo que protege de verdad es esa constante.
   Se sustituye por una **declaración afirmativa del backend**: el fake declara que lo es, el
   guardarraíl consulta **la URL que la página está usando** (leída de la página, nunca una
   constante del runner), y **la ausencia del campo significa «no es falso»**, nunca «no lo sé,
   sigo». Es viable: el fake ya sirve `/health` con CORS `*` (`fake-ai-server.mjs:479-494`).
   **Queda descartado** discriminar por ausencia de campos —el real responde `mode`/`cache_*`
   (`ai_server/main.py:123-133`) y el fake solo `{status:"ready"}`—, porque bendeciría como falso
   a cualquier cosa que conteste poco.
   La garantía **no es un test más**: el estado malo tiene que ser inexpresable. Prueba en negativo
   obligatoria de los tres desenlaces: (a) backend real → se niega; (b) backend que no contesta →
   se niega; (c) fake en puerto desplazado → corre.
   **Al terminar hay que BORRAR** `FAKE_AI` (`run.mjs:68`) y el regex (`sesion.mjs:20`): si
   sobreviven, sobrevive la tautología con otro número — y no se notará, porque hoy tampoco se nota.
5 bis. **El bridge publica a qué motor apunta.** Segunda vía de dinero que el `?ai=` nunca cubrió:
   el bridge elige su motor con `NEFAN_AI_SERVER` (`bridge/ws-server.ts:57`), que `start.sh:174`
   solo define en el preset del fake, y **`AI_SERVER_URL` no sale del proceso**. Hoy la página no
   puede saber con quién habla el bridge.
6. **`node --test` deja de acaparar la máquina.** Con la suite corriendo, quedan núcleos libres
   para quien esté delante. El número se elige **midiendo**, no a ojo, y se anota el reloj antes
   y después: #275 midió que `-c 4` cuesta +0,2 s en `test` y +1,7 s en `coverage`.
7. **La suite no se ejecuta dos veces por ciclo**, o queda escrito por qué sí. Hoy `verify`
   incluye `npm test` y el ciclo corre `npm run coverage` detrás, que es la misma suite
   instrumentada: **72 s de CPU por pasada son repetición literal**. El CI hace lo mismo
   (`ci.yml`: `npm test` y luego `npm run coverage`). Contrapartida a decidir, no a ignorar: si
   `verify` deja de correr los tests, deja de ser autosuficiente para quien lo use sin coverage
   detrás.
8. **Nada de esto rompe el uso de una sola persona.** `./start.sh` sin argumentos y
   `node qa/run.mjs` siguen funcionando igual de simples, sin exigir variables de entorno.
9. `node qa/run.mjs` sigue en **30/30 con EXIT=0**, que es donde está hoy.

## Fuera de alcance

- **Los worktrees en sí.** Ya funcionan (`node_modules` enlazados, probado el 2026-08-25). Esta
  tanda quita el último obstáculo, no monta la infraestructura.
- **Un canal de comunicación entre agentes.** #274 dice explícitamente que no es eso lo que costó
  dinero.
- **Una tabla global de puertos** o un registro central de instancias: #274 avisa de que rompería
  la distinción entre matar lo propio y lo ajeno, que es justo lo que aquí se refuerza.
- **#241 / #224** (el cliente ligero, el techo de `saves/`), aunque `saves/` se cruce: el
  aislamiento por corrida de QA ya existe (`qa/.tmp/<run-id>/saves`).
- Cualquier reorganización de `qa/guiones/`. Los guiones no se tocan salvo que un puerto
  desplazado los obligue.
- **#280** (el fake copia a mano el contrato del asset-store). Toca
  `labs/narrative/fake-ai-server.mjs`, el mismo fichero donde aterriza la declaración «soy falso»
  del criterio 5, así que por separado se paga dos veces entrar ahí. **No bloquea**: si al
  ingeniero le sale gratis de paso, que lo diga; si no, se queda en su issue.
- **#231(b)** (`test/` sin typecheck). Su sujeto es `verify`, que esta tanda abre, y `4e0cb58`
  acaba de desbloquearlo. Es una oportunidad, no un conflicto: se anota, no se hace aquí.

**Corrección de referencia**: #271 cita a #270 como «Relacionado», pero **#270 ya está cerrado**
(`fb17840`).

## Preguntas abiertas, con su suposición por defecto

1. **¿De dónde sale el desplazamiento?** Por defecto: una variable de entorno explícita
   (`NEFAN_PORT_BASE` o equivalente) con un valor por defecto que reproduce **exactamente** los
   puertos de hoy. Derivarlo del nombre del worktree es tentador y frágil (dos worktrees de
   nombre parecido colisionan y nadie se entera).
   **Tres datos del crítico que cambian esta pregunta**: (a) `start.sh` declara los puertos **dos
   veces** — las variables `PORT_*` (`16-24`) y otra vez a mano dentro de `SERVICE_LABELS`
   (`390-399`), que es **de donde los lee `presets.mjs`**; tocar solo las variables deja el banco
   validando los números viejos. (b) `nefan-core/src/config.ts:121,187` **ya se declara «fuente
   única» de puertos y nadie la respeta** — el hallazgo no es que falte una fuente única, es que
   sobra todo lo que la ignora. (c) `vite.config.ts:26` no pone `strictPort`, así que vite se
   desplaza solo y en silencio. Ojo también con sprite-forge: vive en **otro repo**
   (`start.sh:27`), así que un desplazamiento que él no honre parecerá arbitrario en un mes.
2. **¿Cómo sabe el guardarraíl que un backend es falso, si no es por el puerto?** Por defecto: que
   lo diga el propio backend (un campo en su respuesta) en vez de deducirlo de la URL — la
   dirección que este repositorio ya ha elegido dos veces («cada capa dice lo que sabe en vez de
   que la siguiente lo deduzca»). El crítico debe confirmarlo o tumbarlo: es el punto que toca
   dinero.
3. **¿`verify` deja de correr `npm test`, o `coverage` deja de estar en el ciclo?** Por defecto:
   decidirlo el arquitecto con el criterio de que **nadie ejecute la suite dos veces sin saberlo**,
   sea cual sea la mitad que se mueva.
4. **¿Cuántos núcleos?** Medida **de hoy** (el crítico re-midió porque las de #275 eran del 25 de
   agosto): `npm test` = **8,10 s de reloj, 74,07 s de CPU, 913 %**, con 1526 tests / 277 suites /
   97 ficheros y load 0,21. El 25/08 fueron 7,9 s / 72,3 s / 919 % con 1337 tests: la suite creció
   un 14 % y la CPU un 2,4 %, así que **las cifras de #275 valen tal cual**, incluido que `-c 4`
   cuesta +0,2 s en `test` y +1,7 s en `coverage`.
   Por defecto: se mide en esta máquina (16 núcleos) y se elige el valor que
   deje trabajar a quien está delante sin alargar el reloj de forma perceptible. Se anota la
   medida, no solo el número — el precedente del `tope_local` de mutación dice que un número sin
   medida detrás insinúa una precisión que no existe.

## Cómo se verifica que funciona de verdad

El criterio 3 no se puede afirmar leyendo: hay que **arrancar dos corridas a la vez** y ver que
las dos terminan. Y el criterio 1, arrancando un proceso señuelo en un puerto del catálogo y
comprobando que sobrevive. Ninguno de los dos es un test unitario.
