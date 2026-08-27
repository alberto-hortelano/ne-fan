# REENCUADRADA

La tanda debe hacerse y su primer paso (criterio 1) es correcto. Pero su premisa central falla en las dos direcciones: **los puertos no son
el único obstáculo** (hay cuatro más, y uno produce verdes falsos) y **el guardarraíl de dinero no está a punto de quedarse ciego: ya lo
está**. Medido sobre `main` `c4a6e8f`.

## El problema real, en una frase

No es que los puertos sean constantes: es que **una corrida no posee sus recursos** —puertos, disco efímero, logs, capturas—, y el puerto
es el más visible, no el que produce el fallo más caro.

## La premisa, afirmación por afirmación

1. **«`fuser -k` una vez; nueve `start_*` matan al ocupante»** — CIERTA y exacta. `start.sh:53`; llamadas en `162,184,196,205,214,243,277,
   297,311`. Legítimas e intactas: `954` (tecla `k`), `999` (`trap EXIT`).
2. **«Los puertos son lo ÚNICO que serializa el trabajo» (#274)** — **FALSA**: ver los cuatro obstáculos de abajo. Y **no hay regla sobre
   puertos en `arch-rules.json`**: sus 22 reglas no los tocan.
3. **«`qa/presets.mjs` deriva los puertos parseando `start.sh`»** — CIERTA pero incompleta: parsea `SERVICE_LABELS` (`start.sh:390-399`),
   **cadenas de display con el puerto horneado a mano**, no las `PORT_*` (`16-24`). `start.sh` declara los puertos **dos veces**; tocar
   solo las variables deja `presets.mjs` validando los números viejos.
4. **«`backendEsFalso` mira si el `?ai=` contiene 18765»** — CIERTA, y es peor: **es una tautología**. `run.mjs:68` fija
   `FAKE_AI="http://127.0.0.1:18765"`, `:82` lo mete en `URL_QS`, `:502` es la **única** navegación, y `sesion.mjs:17-22` lo lee de vuelta.
   Ejecutado el par URL/regex: siempre `true`. **El guardarraíl nunca ha medido el backend**; lo que protege de verdad es la constante de
   `run.mjs:68`. Lo de «un desplazamiento lo deja ciego» sí es CIERTO en la dirección barata: con base +100 el regex da `false` y 07 y 21
   caen en rojo (`07:52-56`, `21:55-58`) — falso negativo, molesto pero no caro.
5. **(implícita) «el `?ai=` cubre el gasto»** — **FALSA: hay dos vías de dinero.** El bridge elige su motor con `NEFAN_AI_SERVER`
   (`ws-server.ts:57`), que `start.sh:174` solo define `if on fake-ai`, y **no publica `AI_SERVER_URL` en ningún sitio** (grep: solo `:57`
   y `:80`). La página no puede saber con quién habla el bridge.
6. **«#275 puede estar caducado»** — **NO lo está. Re-medido hoy**, load 0,21, 16 núcleos, 1526 tests / 277 suites / 97 ficheros: `npm
   test` = **8,10 s de reloj, 74,07 s de CPU, 913 %**. El 25/08: 7,9 s / 72,3 s / 919 % con 1337 tests. La suite creció un 14 % y la CPU un
   2,4 %: **las cifras de #275 valen tal cual**. La doble ejecución sigue viva (mismo glob `test/*.test.ts`, CI los encadena) y las dos
   mitades cargan peso: `crap -- --check` (`.claude/agents/ingeniero.md:24`) lee `coverage/lcov.info`.
7. **`typecheck:scripts` ya existe** — CIERTA, y **no caduca nada de #275**: #275 nunca lo mencionó. A quien toca es a **#231(b)** (`test/`
   sin typecheck), que `tsconfig.scripts.json:14-16` aplaza «detrás de la tanda del bosque» — ya mergeada en `4e0cb58`: #231(b) está
   desbloqueado.

### Los cuatro obstáculos que un desplazamiento de puertos NO arregla

- **`qa/lib/saves.mjs` lee el disco de la otra corrida — verde falso.** `directoriosDeSaves()` (`:35-41`) recorre **todos** los
  `qa/.tmp/*/saves` sin filtrar por `RUN_ID`, y `listarSaves()` (`:79`) se queda con `const [dir] = …`: el primero alfabético = el `RUN_ID`
  más ANTIGUO = la corrida del otro. Es el «sale verde midiendo otra cosa» de #271, en una capa que #271 no mira.
- **`limpiarTmpViejos()` (`run.mjs:231-237`) borra el disco VIVO del otro agente.** Elimina todo `qa/.tmp/*` que no sea el suyo, y se
  llama cuando la corrida tiene stack propio (`:452`) — justo el caso que esta tanda vuelve simultáneo. **El criterio 3 sigue fallando por
  esto solo, con puertos distintos.**
- **`qa/capturas/` es ruta fija y se borra entera al arrancar** (`run.mjs:51,439-440`); los nombres (`:415`) no llevan `RUN_ID`, y no hay variable que lo mueva.
- **Los nueve logs son globales de máquina y truncan.** `LOG_DIR="${NEFAN_LOG_DIR:-/tmp}"` (`start.sh:13`), nombres fijos
  `/tmp/nefan-{bridge,fake-ai,html,ai,asset-store,remote-gen,narrative,replay,sprite-forge}.log`. `NEFAN_LOG_DIR` existe y **nadie lo pone
  jamás** (`run.mjs:170` solo exporta saves y games). Cruza worktrees. Evidencia viva: los tres primeros están en `/tmp` ahora mismo.

Menores, misma forma: `vite.config.ts:26` no pone `strictPort` (vite salta solo a 3001 y `BASE` sigue en 3000 → B mide el cliente de A);
`manifest-db.ts:15-17` declara «este proceso es el ÚNICO que abre el `.sqlite3`»; el caché de sprite-forge (`render.mjs:33`) es absoluto.

## El día después

- **Para quien juega, nada.** Deuda declarada y capacidad de equipo: conviene decirlo para no medirla por el jugador.
- **Se vuelve más difícil parar cosas.** La tecla `k` barre `ALL_PORTS` (`start.sh:940,951-954`) «lo hubiera arrancado este launcher o no».
  Con un agente es servicial; con dos mata el stack del otro **después de enumerarlo**, que es lo que prohíbe «no le cerreis sus servers».
  El criterio 2 la declara intocable y así **conserva el arma que la tanda multiplica**.
- **Habría que borrar** `FAKE_AI` (`run.mjs:68`) y el regex (`sesion.mjs:20`); si sobreviven, sobrevive la tautología con otro número — y no se notará, porque hoy tampoco se nota.
- **Parecerá arbitrario en un mes** un `NEFAN_PORT_BASE` que suma a nueve puertos si sprite-forge —repo aparte (`start.sh:27`)— no lo
  honra, y si `config.ts:121` sigue diciendo «Puertos del stack — fuente única» mientras `start.sh`, `vite.config.ts` y `qa/run.mjs` la
  ignoran. **La fuente única ya existe y nadie la usa**: ése es el hallazgo, no que falte una.

## Conflictos

**#280** (el fake copia a mano el contrato del asset-store) toca `labs/narrative/fake-ai-server.mjs`, el mismo fichero donde aterrizaría la
declaración «soy falso»: por separado se paga dos veces. No bloquea. **#231(b)** queda desbloqueado por `4e0cb58` y su sujeto es `verify`,
que esta tanda abre: oportunidad, no conflicto. **#270**, que #271 cita como «Relacionado», **ya está cerrado** (`fb17840`) y `requisitos.md`
no lo dice. Sin conflicto con `arch-rules.json` ni con `CLAUDE.md`.

## Coste contra valor

Los **criterios 6 y 7 (#275) son casi gratis y valen solos**; el **1 es barato** y su patrón ya está escrito en la bajada del propio fichero.
El **desplazamiento de puertos es el trozo más caro y el de menor valor por euro** —nueve puertos, cinco sitios, un servicio de otro repo— y
sin los cuatro obstáculos **no compra el criterio 3**. El **criterio 5 no es «que sobreviva al desplazamiento»: es construirlo por primera
vez**, y ése vale lo que cueste.

No hacer nada es peor de lo que parece, pero por un motivo distinto al que da #274: el incidente del 25/08 que cita —commits en la rama
equivocada por compartir árbol, tres lecturas contradictorias por medir en estados distintos— lo causaron el **árbol compartido** (ya
resuelto con worktrees) y el **estado compartido** (los cuatro obstáculos). Los puertos son lo único que el propio incidente **no** acusa.

## Qué le cambiaría a `requisitos.md`

1. **Criterio 5, reescrito**: «`backendEsFalso` no verifica nada hoy: lee de vuelta la constante que el runner escribió en la URL
   (`run.mjs:68→82→502` → `sesion.mjs:17-22`) y siempre dice `true`. Se sustituye por una **declaración afirmativa del backend**: el fake
   declara que lo es, el guardarraíl consulta **la URL que la página está usando** (leída de la página, nunca una constante del runner) y
   **la ausencia del campo significa "no es falso"** — nunca "no lo sé, sigo". Prueba en negativo: (a) backend real → se niega; (b) el que
   no contesta → se niega; (c) fake en puerto desplazado → corre. Queda descartado el discriminador por ausencia de campos —hoy el real
   responde `mode`/`cache_*` (`ai_server/main.py:123-133`) y el fake solo `{status:"ready"}` (`fake-ai-server.mjs:494`)—, que bendeciría a
   cualquier cosa que conteste poco. **Es viable**: el fake ya sirve `/health` y emite CORS `*` (`:479-484`).»
2. **Criterio 5 bis, nuevo**: «El bridge publica a qué motor apunta. Hoy `AI_SERVER_URL` (`ws-server.ts:57`) no sale del proceso: la
   segunda vía de dinero es invisible para el guion.»
3. **Criterio 3, ampliado**: nombrar los cuatro obstáculos como parte del criterio; tal como está, **no se cumple cambiando puertos**. Y
   **criterio 2, matizado**: «la tecla `k` sigue existiendo, pero con dos instancias deja de poder matar por barrido del catálogo lo que no
   es suyo; enumerar antes no basta cuando el dueño es otro agente.»
4. **Pregunta abierta 1**: añadir que `start.sh` declara los puertos **dos veces** (`PORT_*:16-24` y `SERVICE_LABELS:390-399`, de donde los
   lee `presets.mjs`), que `config.ts:121,187` ya se declara «fuente única» y nadie la respeta, y que `vite.config.ts:26` no tiene
   `strictPort`.
5. **Pregunta abierta 4**: sustituir la medida del 25/08 por la de hoy (8,10 s / 74,07 s / 913 %, 1526 tests, 97 ficheros, load 0,21).
   **Fuera de alcance**: añadir #280 (mismo fichero del fake) y que #270 ya está cerrado.
