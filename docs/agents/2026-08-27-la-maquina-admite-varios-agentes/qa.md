# QA — la máquina admite varios agentes a la vez

Validado sobre `feature/la-maquina-varios-agentes` el 2026-08-27, en la máquina real. **Dos
vueltas**: la primera sobre `85b0a40` + `e9fe1da` (sobre `main` `c4a6e8f`); la segunda sobre
`fb2e464` + `536c284`, donde el ingeniero cierra los tres hallazgos importantes. Todo lo de la
primera vuelta se conserva tal cual; lo que cambió lleva su propio apartado al final
(«Segunda vuelta»), y el veredicto de abajo es el final. Punto de vista: **quien trabaja en esta máquina**, no quien
juega. La pregunta es «¿pueden de verdad dos agentes trabajar a la vez sin pisarse, y sin gastar
dinero por accidente?».

Todo lo de abajo lo he **ejecutado yo**. Donde solo he leído código, lo digo.

**Dato de contexto que apareció solo, y vale más que cualquier señuelo**: durante la validación
había un `vite` de **otro proyecto de esta máquina** (`/home/al/code/heroes`) escuchando en
**:3100**, dentro del bloque +100 de ne-fan. No lo puse yo y no lo he tocado. Sirvió de sujeto
real para los criterios 1, 2 y 3: el banco lo esquivó eligiendo el bloque +200, y `./start.sh
--parar` lo enumeró como AJENO y lo dejó vivo.

---

## Criterios

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Arrancar el stack no mata nada ajeno | ✅ cumple | Señuelo propio (`nc`, cwd `/tmp`) en :3000 → `./start.sh --preset html-fixtures` sale **EXIT=1** con `❌ :3000 ocupado — cliente HTML NO arranca`, nombra al ocupante y el señuelo **sigue vivo**. Repetido a mitad de stack: señuelo en :9877 → `--preset e2e-sin-creditos` arranca fake-ai, se niega en el bridge, **el `trap` recoge el fake-ai** y el señuelo sobrevive. Guion nuevo `qa/no-mata-lo-ajeno.mjs` (EXIT=0), **probado en negativo**: devolviendo `port_busy && kill_port` a `start_html` pone 3 afirmaciones en rojo |
| 2 | La bajada se ajusta a que hay varios dueños (`k` propio, barrido bajo bandera) | ✅ cumple | `./start.sh --parar` con tres sujetos a la vez: mató el huérfano propio de :9877 (cwd `nefan-core`) **y el de :3100 del bloque +100** (cwd `qa/`), y dejó vivo el ajeno de :3000 (`⏭ AJENO, no se toca`). Con el stack real arriba dejó vivo el vite de **`~/code/heroes`** en :3100. `./start.sh --parar-todo` sí se llevó el señuelo ajeno, tras enumerarlo. `read_key` (`start.sh:750-754`): `k`→STOP, `K`→STOPALL; solo la peligrosa distingue mayúscula. **Negativo**: quitando el guardián de worktree de `cmd_stop`, el guion pone en rojo «`--parar` NO toca el proceso ajeno» |
| 3 | Dos corridas de `qa/run.mjs` a la vez terminan las dos, cada una midiendo lo suyo | ✅ cumple | `node qa/dos-corridas.mjs` **ejecutado por mí**: 13/13 afirmaciones verdes, A=0 y B=0 en 9,4 s, bloques +100 y +0, **45 muestras con los dos discos efímeros vivos a la vez**, capturas de las dos intactas, ningún `qa/.tmp` ajeno desaparecido, ninguna adoptó el stack de la otra. Los cuatro obstáculos, verificados en el código: `saves.mjs` lee solo `QA_RUN_TMP`; `limpiarTmpViejos` barre solo lo que no tiene `vivo.pid` vivo; `SHOTS` cuelga del `RUN_ID`; `run.mjs:170` exporta `NEFAN_LOG_DIR` |
| 4 | Engancharse a un stack ajeno es opt-in explícito | ✅ cumple | Con un stack arriba en el bloque base, `node qa/run.mjs 05` **no lo adoptó**: eligió `+200` (saltó el +100 porque lo ocupaba el vite de `heroes`), levantó stack propio y midió. `node qa/run.mjs 01 --adoptar` sí adopta, **lo dice** (`· stack ya arriba — lo adopto`) y avisa de que la corrida no es hermética |
| 5 | El guardarraíl de cero créditos se CONSTRUYE | ✅ cumple (con hallazgos) | `node qa/guardarrail-sin-creditos.mjs` → 8/8, los tres desenlaces del enunciado incluidos. Leído `qa/lib/sesion.mjs`: `ok = cliente.fake === true && bridge.fake === true`, las dos leídas por `fetch` desde la página; **no hay rama que devuelva `true` sin dos afirmaciones**. Ataque mío con un `?ai=` manipulado (proxy transparente al fake que solo cambia `/health` a `fake:false`): el guardarraíl contestó `ok=false · cliente: declara fake:false (backend real)`. La tautología está **borrada**: `grep backendEsFalso` y `grep ':18765('` a cero fuera de los comentarios que la explican |
| 5 bis | El bridge publica a qué motor apunta | ✅ cumple | `curl :9878/health` con el stack real arriba → `{"ok":true,…,"ai_server_url":"http://127.0.0.1:18765"}`, con `Access-Control-Allow-Origin: *` (la página puede leerlo). `ws-server.ts:80` y `:139` usan **la misma constante**, así que lo publicado es lo que el bridge usa de verdad |
| 6 | `node --test` deja de acaparar la máquina | ✅ cumple | Medido por mí, una pasada: `npm test` = **8,20 s de reloj · 606 % de CPU · 42,7 s user + 7,1 s sys**, 1542 tests en verde. Sobre 16 núcleos deja ~10 libres; antes eran 913-934 %. Coincide con los 602 % del ingeniero |
| 7 | La suite no se ejecuta dos veces por ciclo | ✅ cumple | `package.json:44` → `verify = build && typecheck:scripts && lint && npm test` (una pasada; decisión 4 del usuario respetada). `ci.yml` → `typecheck`, `lint`, `build`, **`coverage`**, `crap -- --check`: el `npm test` duplicado ya no está. Un solo recorrido de la suite a cada lado |
| 8 | Nada de esto rompe el uso de una sola persona | ✅ cumple | `./start.sh --preset html-fixtures` **sin una sola variable de entorno** → `✅ HTML client http://localhost:3000`, `curl` da **HTTP 200**, URL sin `?offset=`. Lo único que cambia es dónde caen los logs (`/tmp/nefan-ne-fan/`). `node qa/run.mjs` sin variables funciona (criterio 9) |
| 9 | `node qa/run.mjs` sigue en 30/30 con EXIT=0 | ✅ cumple | Ejecutado por mí: **30 en verde · 0 en rojo de 30**, EXIT=0. Además `build`, `typecheck:scripts`, `lint` de core y `tsc`/`lint`/`build` de `nefan-html` en verde, y `crap -- --check` dentro de umbrales (89,7 % de cobertura, 0 por encima del tope) |

### Candados nuevos, pasada adversarial

| Candado | ¿Se pone rojo por el fallo que dice perseguir? | Evidencia |
|---|---|---|
| `nadie-inventa-un-puerto` | **Sí para el defecto original, no para toda su clase** | Reintroducido `const FAKE_AI_QA = "http://127.0.0.1:18765"` en `qa/run.mjs` → **rojo** (`qa/run.mjs:783 patrón prohibido`). Reintroducido `const MOTOR_QA = 18765;` (mismo número, mismo fichero, sin la palabra «port» ni URL) → **verde, 44/44**. Ver hallazgo 5 |
| `solo-se-mata-el-puerto-propio` | **Sí para una décima llamada, no para el acto** | Décima llamada `port_busy && kill_port` en `start_html` → **rojo** (`start.sh:127`). Pero `fuser -k "$PORT_HTML/tcp"` **en línea**, en la misma función, haciendo exactamente lo que la regla prohíbe → **verde, 44/44**. Ver hallazgo 4 |
| `test/port-offset-paridad.test.ts` | **Sí, en las dos implementaciones que probé** | «Simplificado» `qa/lib/stack.mjs` a `Number()` a secas → **3 casos en rojo** (`-1`, `0x10`, `" "`). Quitado el tope de rango de `start.sh` → **1 caso en rojo** (`40001`). Es el candado más sólido de la tanda |

---

## Hallazgos

### Importantes

**H1 · `qa/capturas/ultima` se congeló en la primera corrida y ya no vuelve a moverse.** — **CERRADO en `fb2e464`, verificado abajo.**
Regresión NUEVA de esta tanda. `qa/run.mjs:620` hace `rmSync(join(RAIZ_SHOTS,"ultima"), {force:true})`
sin `recursive`, y Node sigue el enlace: sobre un symlink que apunta a un **directorio** lanza
`ERR_FS_EISDIR`, así que el `symlinkSync` de la línea siguiente nunca se ejecuta y el `catch` lo
degrada a un aviso.

Reproducción desde el arranque:
```
$ node qa/run.mjs 01
· sin enlace qa/capturas/ultima (Path is a directory: …/qa/capturas/ultima) — están en …
$ ls -l qa/capturas/ultima
ultima -> 2026-08-27T12-38-28-540Z-159354      # la PRIMERA corrida del ingeniero, 14:38
```
Lo he visto en **las cinco** corridas que lancé. Lo que esperaba quien trabaja aquí: `qa/README.md`
dice «`qa/capturas/ultima` apuntando a la última» y `CLAUDE.md` manda «verificar las capturas de
`qa/capturas/`». Hoy, quien mire ahí revisa las capturas de una corrida de hace horas **creyendo
que son las de la suya**, y nada se lo dice: es el «verde que mide otra cosa» mudado a la revisión
visual, que es justo el trabajo de este rol. Antes de la tanda no podía pasar (`qa/capturas/` era
ruta fija y siempre era la de la corrida en curso).

**H2 · Un guion nuevo que dispare generación y olvide el prólogo gasta créditos y nada lo nota.
Medido, no razonado.** El hueco estaba **declarado** en `implementacion.md §6`; queda confirmado
con la medida delante. Escribí un guion temporal sin prólogo que apunta la página a un backend que
declara **`fake:false`** (un proxy transparente al motor falso que solo cambia `/health`) y arranca
una partida con personajes por imagen:

```
▶ 98-qa-hueco-del-prologo
    el guardarraíl DIRÍA: ok=false · cliente: declara fake:false (backend real) · bridge: declara fake:true
    (pero nadie se lo ha preguntado: este guion no tiene prólogo)
    peticiones que llegaron al backend que declara COBRAR: 7
      muestra: GET /dev/status | … | POST /skin_sprite_sheet
    ✔ el guion corrió entero sin que nada lo parase
1 en verde · 0 en rojo de 1      ← el runner lo dio por bueno
```
`POST /skin_sprite_sheet` es exactamente la llamada de pago que 15 y 21 existen para gatear. Y
`grep -n "gasta" qa/run.mjs` está a cero: el runner **no tiene forma de saber** qué guion gasta.
Peor: `qa/README.md`, que es donde se explica «cómo se escribe un guion», **no menciona el
guardarraíl ni una vez**. La obligación no está ni en código ni en prosa: solo copiada en tres
ficheros. **Material de issue, no de esta tanda** —el criterio 5 pedía construir el guardarraíl y
está construido— pero el hecho queda medido: la garantía no está en el tipo, está en la memoria de
quien escriba el guion 32.

**H3 · `?bridge=` mueve el gateway pero no `world-state`: la segunda vía puede avalar a un bridge
que la página no está usando.** — **CERRADO en `fb2e464`, verificado abajo.** Medido con el cliente real:
```
página: ?ai=http://127.0.0.1:18765&bridge=ws://127.0.0.1:19877
servicios(): {"game-gateway":"ws://127.0.0.1:19877","world-state":"http://127.0.0.1:9878", …}
guardarraíl: ok=true · "cliente y bridge declaran fake:true"
```
El juego habla con el gateway `:19877` y el guardarraíl le pregunta «¿con qué motor hablas?» a la
State API de **:9878**, que es de otro bridge. `envFromQuery` (`service-urls.ts:19-32`) solo mapea
`?bridge=` a `NEFAN_URL_GAME_GATEWAY`. Hoy no cuesta dinero —`qa/run.mjs` nunca pone `?bridge=`—
pero el patrón está **vivo**: `qa/guiones/20` levanta su propio bridge con puertos efímeros y entra
por `?bridge=`, así que su página ya pregunta a la State API equivocada. Es un agujero en la
identidad de la vía que el criterio 5 bis existe para cubrir: publicar a qué motor apunta el bridge
no sirve si se le pregunta al bridge de al lado.

**H4 · `solo-se-mata-el-puerto-propio` cuenta llamadas a un helper, no el acto de matar.** — **CERRADO en `fb2e464` (con límite nuevo, ver abajo).**
Con `fuser -k "$PORT_HTML/tcp"` escrito en línea dentro de `start_html` —el defecto exacto que la
regla nombra en su `why`, «las NUEVE funciones `start_*` mataban al ocupante»— el checker sale
**44/44 en verde**. Y `pkill`, que es lo que la restricción del usuario prohíbe por su nombre, no
aparece en ninguna de las 24 reglas (`grep -c pkill arch-rules.json` = 0). La casa se ha comido
esta semana cuatro candados verdes sobre el criterio incumplido; éste es de la misma familia,
aunque hoy el código esté bien. Sugerencia: que el patrón persiga `fuser -k`/`pkill`/`kill -9`
fuera de `kill_port`, no el nombre del helper.

### Menores

**H5 · `nadie-inventa-un-puerto` no caza un literal sin la palabra «port».** — **CERRADO en `fb2e464` (con límite nuevo, ver abajo).** `const MOTOR_QA = 18765;`
pasa en verde (medido). El `why` de la regla declara honestamente su alcance («se caza la FORMA de
un puerto»), pero su `desc` promete más de lo que hace: «los puertos del stack no se escriben a
mano fuera de su fuente única». Y ya hay dos supervivientes en el propio `start.sh`, que la regla
escanea: `start.sh:663` («conduce con game-emulator **:9899**») y `start.sh:1132`
(«API de control HTTP **:9899**»). Son prosa, pero son prosa **falsa con un offset**.

**H6 · Que el guardarraíl se niegue produce ROJO, no ⊘ SIN MEDIR.** En 07, 15 y 21 la negativa es
un `ctx.expect(...)` fallido → `ROJO`. Pero un guion que no corre porque su precondición de gasto
no se puede garantizar **no ha medido el juego**: es literalmente el caso de #272 y el runner tiene
las tres etiquetas para decirlo. El plan lo anticipaba así («señal: guiones 07 y 21 en `⊘
precondición no garantizada`») y la implementación no lo hizo. Consecuencia práctica: un `/health`
lento hará que la batería salga en rojo culpando al juego.

**H7 · `--parar` enumera como «AJENO» su propia State API ya muerta, y ofrece la bandera
peligrosa.** Medido parando el stack real:
```
    · :9877  MainThread  …/node
    ⏭  :9878  (desconocido)  — AJENO, no se toca
    ⏭  :3100  MainThread  node /home/al/code/heroes/…  — AJENO, no se toca
   Para llevarte también lo ajeno: ./start.sh --parar-todo (o la tecla K).
```
:9878 es el mismo proceso que :9877, que acababa de morir en la iteración anterior: `pids_del_puerto`
vuelve vacío y `worktree_de_pids ""` contesta «ajeno». La foto (`snapshot_escuchando`) se toma una
vez y los pids se piden después de haber matado. El resultado es un aviso falso, y el remedio que
sugiere (`--parar-todo`) es justo el que se lleva por delante lo de los demás. Añadido a eso, el
camino seguro mira **diez bloques**, así que en esta máquina va a enumerar el vite de `heroes` en
**cada** teardown: ruido que entrena a no leer la línea.

**H8 · Los pids de `fuser -k` se cuelan en medio de la enumeración.** `kill_port()` (`start.sh:127`)
solo silencia stderr, así que la lista de pids sale por stdout entre líneas:
`… nc -l -p 3000\n 190542✅ stack cleaned`. Es previo a la tanda, pero ahora molesta más porque la
enumeración es nueva y es lo que hay que leer antes de matar.

**H9 · `--keep` y la corrida siguiente: el stack vivo se queda sin disco.** Medido: con un stack
levantado por `node qa/run.mjs --keep`, la corrida siguiente imprimió `· 1 tmp de corridas muertas
borrados` y se llevó el `qa/.tmp/<run>` que ese stack está usando. `vivo.pid` marca la vida del
**runner**, no la del stack que dejó arriba. Es el mismo modo de fallo de #283 en el único caso que
`--keep` existe para cubrir; no es regresión (antes se borraba igual, y sin condiciones).

**H10 · La reserva de bloque tiene una ventana entre crear y escribir el lock.** Solo lectura de
código: `writeFileSync(f, pid, {flag:"wx"})` es atómico al **crear**, no al escribir. Un segundo
runner que falle el `wx` y lea el fichero en ese microsegundo obtiene `""`, y `Number("")` es `0`,
y `pidVivo(0)` es `false` → declara el lock huérfano, lo borra y se queda con el bloque. Los dos
acabarían en +0. No lo he reproducido; el arreglo barato es escribir el pid en el mismo `open`
(ya lo hace) y tratar el fichero vacío como «vivo, todavía escribiendo», no como huérfano.

**H11 · La regla `warn` nueva mete 3 items que no son deuda en `npm run deuda`.** La cola pasa de
65 a **68**, y los tres nuevos son las tres llamadas `kill_port` **legítimas** —la definición, `k`
y el `trap`—. `CLAUDE.md` dice que «un item desaparece de la cola cuando se arregla»: estos tres no
se van a arreglar nunca, porque son el diseño.

**H12 · Afirmaciones flojas en los guiones nuevos.** `dos-corridas.mjs` afirma «A/B declararon su
disco efímero propio (**logs incluidos**)» comprobando solo que la salida contenga la cadena
`disco efímero: ` — no mira ni un log. Y `guardarrail-sin-creditos.mjs` cierra con «se niega en los
**siete** desenlaces malos» cuando son ocho (siete casos de la tabla más la página sin hook).

**H13 · `qa/capturas/` ya son 30 MB en 11 corridas de un solo día.** Deuda asumida y escrita
(plan §6e), pero el reloj corre rápido: a este ritmo son ~2 GB al mes.

**H14 · `vite.config.ts` no honra `NEFAN_PORT_OFFSET` por sí solo.** Usa
`process.env.NEFAN_HTML_PORT ?? CONFIG.ports.html`, o sea el bloque BASE. Da igual por
`start.sh`, que siempre pasa `NEFAN_HTML_PORT`; pero `cd nefan-html && NEFAN_PORT_OFFSET=100 npm run dev`
sirve en :3000 mientras el resto del bloque vive en +100.

### Un quinto recurso compartido (lo que `dos-corridas.mjs` no mira)

El crítico encontró cuatro (saves, tmp, capturas, logs). Buscando el quinto con el `find` de los
ficheros escritos durante una corrida, los únicos candidatos vivos son:

- **`qa/capturas/ultima`** — es un puntero **global único** que dos corridas simultáneas se
  disputan por diseño (solo puede señalar a una), y encima hoy no señala a ninguna (H1).
  `dos-corridas.mjs` comprueba que cada corrida conserva su directorio, pero **no mira el enlace**.
- **`nefan-core/data/runtime_config.json`** — lo reescribe cada `start_bridge`, y las dos corridas
  lo hacen a la vez. Declarado por el ingeniero en §6. Comprobé que `src/config.ts` **no lee ni un
  `process.env`**, así que las dos escriben bytes idénticos y el riesgo real se queda en una
  lectura rota durante un `writeFileSync`. No es un quinto obstáculo, es un quinto recurso con la
  mordida quitada.

Descartados midiendo: `cache/`, `saves/` y `nefan-core/data/games/` **no se tocan** durante una
corrida (`find -newermt` a cero); Chromium usa perfil temporal por lanzamiento (`chromium.launch`,
no `launchPersistentContext`); `qa/.tmp/.bloques` está resuelto salvo H10.

---

## Workarounds usados durante la prueba

Ninguno hizo falta para **observar** la funcionalidad: `./start.sh --preset …` y `node qa/run.mjs`
funcionaron a pelo, sin una sola variable de entorno, que es el criterio 8 cumplido de paso. Lo que
sí monté fueron **instrumentos de medida**, todos retirados:

| Qué | Para qué | Veredicto |
|---|---|---|
| Señuelos propios (`nc` y servidores TCP de node) en :3000, :9877, :3100 | Criterios 1 y 2 | Arrancados y **retirados por mí**; ningún puerto del catálogo queda ocupado |
| `qa/guiones/98-qa-hueco-del-prologo.mjs` + un proxy al motor falso que declara `fake:false` | Medir H2 | **Borrado**. No es un apaño para ver la feature: es la feature ausente |
| Un script suelto en `qa/` para leer `__nefan.servicios()` con `?bridge=` | Medir H3 | **Borrado** |
| Roturas a mano de `start.sh`, `qa/run.mjs` y `qa/lib/stack.mjs` | Probar los candados en negativo | Restauradas; `git status` limpio salvo el guion nuevo |
| `--parar-todo` ejecutado una vez | Criterio 2 | Solo tras comprobar que **el único ocupante del catálogo era mi señuelo**. No lo repetí con offset ≠ 0: habría matado el vite de `~/code/heroes` |

**No maté ningún proceso que no hubiera arrancado yo.** Los dos vigilantes `until pgrep` que
encontré girando de una sesión anterior siguen ahí, sin tocar.

## Guion ejecutable que dejo

`qa/no-mata-lo-ajeno.mjs` — criterios 1 y 2, que hasta hoy solo existían como prosa en
`implementacion.md §4(d)(e)`. Levanta sus propios señuelos (uno con cwd fuera del worktree, otro
dentro), afirma que arrancar se niega y nombra al ocupante, que el ajeno sobrevive, que `--parar`
sí se lleva el huérfano propio y no toca el ajeno, y los retira siempre. Vive en `qa/` y **no** en
`qa/guiones/` a propósito: ejecuta `./start.sh --parar` y dentro de la batería mataría el stack que
la batería está midiendo. Tiene preflight: si hay algo del catálogo arriba, sale con 2 sin tocar
nada. **No ejerce `--parar-todo`** y dice por qué.

Probado en negativo dos veces: devolviendo `port_busy && kill_port` a `start_html` (3 rojos) y
quitando el guardián de worktree de `cmd_stop` (2 rojos). En ambos casos comprobé que el vecino de
:3100 seguía vivo. Falta una línea en `qa/README.md` junto a los otros dos guiones sueltos; no la
escribo yo para no ensuciar el diff que se está revisando.

## No probado

- **La mutación de la tanda.** 9107 mutantes, muy por encima del `tope_local`. Declarado como
  pendiente de autorizar; **no la he corrido** (restricción de CPU de esta máquina).
- **`npm run coverage` completo.** `crap -- --check` lo pasé sobre el `lcov.info` del ingeniero
  (14:39, anterior a cualquier cosa que yo tocara) y da verde dentro de umbrales. Aviso derivado de
  la decisión 4: `crap -- --check` **solo falla si el lcov FALTA**, no si está rancio; quien lo
  corra sin `coverage` delante puede leer un verde de la semana pasada. `npm run deuda` sí avisa
  («posiblemente obsoleta»), `crap` no.
- **`node qa/presets.mjs`** (arranca y para los siete presets). Vale la evidencia del ingeniero;
  no lo re-ejecuté por coste. Con su propia salvedad declarada: su veredicto solo es fiable si
  nadie toca el catálogo mientras corre.
- **`--parar-todo` con offset ≠ 0**, por lo dicho arriba: habría matado el servidor de otro
  proyecto.
- **Las teclas `k`/`K` en la TUI interactiva.** Verificadas leyendo `read_key` y ejecutando sus
  equivalentes de CLI (`--parar`, `--parar-todo`), que llaman a la misma función.
- **Dos worktrees de verdad.** Solo tengo uno; la separación por `/proc/<pid>/cwd` la probé con
  procesos de cwd distinto, que es el mismo mecanismo, pero no con dos checkouts.
- **Gasto real de créditos.** Por definición no se prueba: lo que se mide es que el guardarraíl se
  niega, y H2 mide que a quien no le pregunta nadie, no se le niega.

---


# Segunda vuelta — `fb2e464` + `536c284`

El ingeniero cierra los tres importantes. Re-verificado **solo lo afectado**, más una pasada
adversarial nueva sobre lo que cambió. Nada de esto me lo he creído: está ejecutado.

## Lo que corrí

| Qué | Resultado |
|---|---|
| `node qa/guardarrail-sin-creditos.mjs` | **12/12** — «decide bien en los 12 desenlaces (10 malos, 2 buenos)», EXIT=0 |
| `node qa/dos-corridas.mjs` | **18/18**, EXIT=0 (a la segunda; la primera dio un rojo que resultó no ser del código — ver H15) |
| `node qa/no-mata-lo-ajeno.mjs` (el mío) | **6/6**, EXIT=0, señuelos retirados |
| `node qa/run.mjs 07 15 17 20 21 25 --keep` | **6 en verde · 0 en rojo de 6**, EXIT=0 |
| `NEFAN_PORT_OFFSET=200 node qa/run.mjs 21` | **1 en verde**, EXIT=0 — el guardarraíl **también dice que sí con el bloque desplazado**, que es el caso del segundo agente |
| `npm test` | **1542/1542**, 8,66 s · **612 % de CPU** (el criterio 6 no se movió) |
| `test/architecture.test.ts` | 44/44 en limpio |

**El argumento del ingeniero de que solo cuatro guiones tocan lo cambiado se queda corto**, y por
eso corrí seis: `/health` de la State API gana un campo, y **17 y 25 también lo leen**
(`qa/guiones/17:112,415` y `qa/guiones/25:134`). Miran campos sueltos y no la forma entera, así que
no se rompen — pero eso hay que verlo, no deducirlo. Los dos en verde.

## H1 · `qa/capturas/ultima` — **cerrado**

- **En positivo, sin trucos**: tras `node qa/run.mjs 07 15 17 20 21 25` el enlace apuntaba a esa
  corrida (`… -> 2026-08-27T13-43-14-667Z-252272`, 15:43); tras `dos-corridas` pasó a la última de
  las dos; tras la corrida con offset, a esa. **Se mueve.** Antes llevaba congelado desde las 14:38.
- **En negativo**: devolviendo `rmSync(enlace,{force:true})` en lugar de `unlinkSync`,
  `dos-corridas.mjs` cae con **dos** rojas — `ultima apunta a "…-255649", que no es ni A ni B` y
  `las dos callaron`. El candado sujeta las dos mitades, la del enlace y la del aviso.
- **La carrera, PROVOCADA y no razonada.** El informe la daba por buena con un análisis de los
  cuatro entrelazados. La medí: cuatro procesos × 20 000 iteraciones del mismo par
  `unlinkSync`+`symlinkSync` sobre el mismo enlace.

  ```
  {"yo":"A","ok":10143,"eexist":9857,"otros":{}, …}
  {"yo":"B","ok":9414, "eexist":10586,"otros":{}, …}
  {"yo":"C","ok":10363,"eexist":9637,"otros":{}, …}
  {"yo":"D","ok":9716, "eexist":10284,"otros":{}, …}
  estado final: t/ultima -> D
  ```

  Tres cosas medidas: (a) **ningún tipo de error distinto de `EEXIST`** en 80 000 intentos, así que
  la rama que añade `536c284` es la única que hace falta y no es hipotética —bajo contención salta
  la mitad de las veces—; (b) el estado final **siempre** es un enlace válido a uno de los
  escritores; (c) hay una **ventana transitoria en la que el enlace no existe** (tres de los cuatro
  lectores vieron `ENOENT` durante la tormenta). Nada de eso afecta al banco —`dos-corridas.mjs`
  lo lee cuando las dos corridas ya han salido— pero la frase honesta es «puede no existir durante
  un instante», no «los cuatro entrelazados terminan bien».

## H3 · `?bridge=` — **cerrado, y es el que más me importaba**

Medido con el **cliente real**, no con la maqueta del guion. Mismo ataque que la primera vuelta,
y cinco más:

```
· camino normal del banco                  gateway=…:9877   → ok=true
· ?bridge= a OTRO gateway, sin ?state=      gateway=…:19877  → ok=false
     motivo: la State API es de OTRO bridge (ws://127.0.0.1:9877), la página usa ws://127.0.0.1:19877
· ?bridge= al MISMO bridge, escrito igual   gateway=…:9877   → ok=true
· ?bridge= al MISMO bridge, como localhost  gateway=localhost:9877 → ok=false   ← falso negativo, H16
· ?state= al MISMO State API, como localhost                 → ok=true
· ?state= a algo que no es una State API (el motor falso)     → ok=false
     motivo: la State API no publica gateway_url (no sé de quién es)
```

El agujero que yo medí en `ok=true` ahora da `ok=false` con el motivo exacto. **En negativo**:
anulando las dos guardas de identidad en `qa/lib/sesion.mjs`, el guion cae con 2 rojas. Y el
`gateway_url` está candado también en unidad: borrando `gateway_url: ctx.gatewayUrl` de
`session-routes.ts`, `state-http-dispatch.test.ts` se pone en rojo (39/40).

**¿Se ha convertido en un «niégate siempre»?** No, y lo comprobé por los tres caminos que
importan: el camino normal del banco (07, 15 y 21 dicen «cliente Y bridge declaran motor falso»),
un `?bridge=` explícito al bridge propio, y —el que nadie había ejercido— **el bloque desplazado**:
`NEFAN_PORT_OFFSET=200 node qa/run.mjs 21` sale en verde con el bridge en `:10077`. Ése era el
riesgo real: si `PORT` de `ws-server.ts` y la resolución del cliente hubieran divergido bajo
offset, el segundo agente —el destinatario de toda la tanda— se habría encontrado el guardarraíl
negándose siempre.

**La tercera vía: buscada, no encontrada.** El repaso completo de por dónde puede salir dinero
desde la página:

- La página resuelve **todo** por `serviceUrl` — `grep` de `fetch("http…` y `new WebSocket("` en
  `nefan-html/src` a **cero**; los dos únicos literales de loopback que quedan son un comentario y
  un mensaje de error. No hay un sexto servicio que el guardarraíl no mire.
- `?ai=` mueve `narrative-llm`, `remote-gen` y `asset-store` **a la misma URL** (medido en la
  página: los tres a `http://127.0.0.1:18765`), así que mirar el primero cubre al de pago
  (`remote-gen`). Es cierto **por construcción de `envFromQuery`**, no porque nadie lo afirme: el
  día que exista un `?rgen=`, el guardarraíl mirará el servicio equivocado. Cuesta tres líneas
  afirmarlo y lo dejo dicho.
- Los parámetros que mueven servicios son exactamente cuatro: `ai`, `bridge`, `state`, `offset`.
  `?state=` es la puerta nueva, y la comprobación de identidad la cierra para el caso accidental
  (apuntar `?state=` a otra State API se rechaza porque su `gateway_url` no casa). Para el caso
  deliberado —`?state=` a un servidor que mienta echando el gateway de vuelta— no hay defensa
  posible ni la debe haber: el modelo entero es «que lo declare el backend».

## H4 y H5 · Las dos reglas — **cerradas, con el límite más grande de lo que dice**

Mis dos ataques de la primera vuelta están **en rojo**, y también `pkill`:

```
const MOTOR_QA = 18765;                          → ✖ qa/run.mjs:837 — "= 18765"
fuser -k "$PORT_HTML/tcp"  (en línea, subida)    → ✖ start.sh:489 — "fuser -k"   (max 1)
pkill -f vite              (en línea, subida)    → ✖ start.sh:489 — "pkill"
```

El cambio de sujeto —del helper al **acto**— es el correcto, y `pkill` entrando por su nombre es
justo lo que pedía la restricción del usuario.

**Pero el límite declarado no es el límite real.** El `why` dice que la enumeración «caza los que
ya existen **los escriba como los escriba**», y que lo único que se escapa es «un puerto NUEVO
fuera del bloque y con un nombre sin *port* (`const CTRL = 9955`)». Probé cuatro formas más y
**las cuatro pasan en verde**:

| Evasión | Verde | Por qué importa |
|---|---|---|
| `const PUERTOS_QA = [[18765,"fake-ai-server"],[9877,"bridge"],[3000,"cliente HTML"]]` | 44/44 | Es **la tabla original que esta tanda borró** (`run.mjs:123-127`), reintroducida palabra por palabra. El número va detrás de `[`, no de `:` ni de `=` |
| `PORT_HTML_QA="3000"` en `start.sh` | 44/44 | El puerto **entrecomillado**, que es como se escriben las variables en bash. La comilla rompe las dos ramas, incluso con «PORT» en el nombre |
| `fuser --kill "$PORT/tcp"` | 44/44 | El mismo acto con el flag largo; el patrón exige `-k` |
| `kill -9 $(pids_del_puerto "$PORT_HTML")` | 44/44 | Matar **por puerto** disfrazado de PID, usando un helper que ya vive en `start.sh` doce líneas más arriba |

Las dos primeras están **dentro** de la clase que el `why` dice cubrir, así que el texto promete
más de lo que el regex hace; la cuarta cae en el hueco que el `why` declara a propósito («matar
por PID no entra»), pero `kill $(pids_del_puerto …)` no es matar por PID: es matar por puerto con
un paso intermedio, y es la forma más natural de reintroducir el defecto en ese fichero. Las reglas
**valen más que antes** —cazan los dos ataques que las tumbaron y `pkill`— y ninguna de estas
evasiones está hoy en el código. Lo que hay que corregir es la **prosa**, que es lo que alguien
citará dentro de tres meses como garantía.

## Hallazgos nuevos de esta vuelta

**H15 · `dos-corridas.mjs` da un rojo FALSO si una corrida anterior usó `--keep`.** Medido: la
primera pasada cayó con `✘ nadie borra el disco de otra corrida — desaparecieron:
2026-08-27T13-43-14-667Z-252272`. Ese directorio era el `qa/.tmp` que había dejado mi corrida con
`--keep`: su runner ya había salido, así que su `vivo.pid` apunta a un pid muerto y
`limpiarTmpViejos` lo barre **correctamente**. La segunda pasada, ya sin él, dio **18/18 en verde**
sin tocar una línea de código. El guion tiene preflight de puertos y **no** de `qa/.tmp`: su
veredicto no es hermético contra el estado que deja `--keep`. Es la cara opuesta del candado que da
verde sin medir —éste da rojo sin que falle nada— y de la misma familia: un veredicto que no
significa lo que dice. Refuerza **H9**.

**H16 · La identidad del gateway se compara por igualdad de cadena.** `ws://localhost:9877` y
`ws://127.0.0.1:9877` son **el mismo bridge** y el guardarraíl los da por distintos (medido). Es el
desenlace barato —se niega con un stack legítimo, no bendice uno que cobra—, así que no cuesta
dinero; pero es una trampa para quien escriba el próximo guion con `?bridge=`: se llevará un rojo
que culpa al juego. Nótese que `qa/guiones/20` ya usa `?bridge=` (con `127.0.0.1`, por suerte) y
**no** usa el `?state=` nuevo, así que su página sigue emparejada con la State API de la batería.

## Lo que sigue abierto de la primera vuelta

Ninguno estaba entre los tres que se mandaron cerrar, y ninguno bloquea: **H2** (el prólogo del
guardarraíl que nadie exige — medido, material de issue), **H6** (negarse produce ROJO y no ⊘),
**H7** (`--parar` enumera como AJENO su propia State API ya muerta, y sigue ofreciendo
`--parar-todo`; lo volví a ver en las dos paradas de esta vuelta), **H8** (los pids de `fuser -k`
en medio de la enumeración), **H9** (`--keep` + corrida siguiente), **H10** (la ventana del lock de
bloque), **H11** (la regla `warn` mete items que no son deuda — ahora es 1 en vez de 3), **H13**
(`qa/capturas/` crece sin poda), **H14** (`vite.config.ts` sin offset propio). De **H12** se
arregló la mitad —el guion ya cuenta sus desenlaces en vez de decir «siete»— y sigue viva la otra:
`dos-corridas.mjs` afirma «logs incluidos» mirando solo que la salida contenga `disco efímero: `.

## Workarounds y limpieza de esta vuelta

Mismo trato que la primera: todo instrumento, ninguno un apaño para ver la feature. Roturas a mano
de `qa/lib/sesion.mjs`, `qa/run.mjs`, `start.sh` y `session-routes.ts` para los negativos, **todas
restauradas** (`git status` limpio). Un script suelto en `qa/` para atacar H3 con el cliente real,
**borrado**. El martillo de la carrera vivió en el scratchpad, fuera del repo, y está borrado.
Señuelos propios arrancados y **retirados**; ningún puerto del catálogo queda ocupado por mí. No
maté ningún proceso que no arrancara yo, y no ejercí `--parar-todo` en esta vuelta.

**Sobre el vecino de `:3100`, dicho con precisión porque es la restricción del usuario**: lo
comprobé vivo después de cada una de mis paradas, incluida la última (`15:47`, tras el
`./start.sh --parar` de mi propio guion, donde salió enumerado como `⏭ AJENO, no se toca`). Al
cerrar el informe (`15:50`) ya no escuchaba nadie en `:3100`, y el resto de procesos de
`~/code/heroes` siguen arriba. Entre las dos comprobaciones solo corrí `npm test`, una rotura y
restauración de `session-routes.ts` y las escrituras de este fichero: nada que toque un puerto —el
banco solo **sondea** (abre y cierra una conexión) y `salir()` mata su propio grupo de procesos por
PID—. Lo más probable es que lo parara su dueño. No puedo demostrar una negación; dejo dicho qué
observé y cuándo, que es lo único honesto.

---

## Veredicto final

**Apto.**

La reserva de la primera vuelta está **cerrada y verificada en las dos direcciones**: `ultima`
vuelve a moverse, el candado que lo sujeta se pone rojo si se deshace el arreglo, y la carrera que
el informe solo razonaba la he provocado —80 000 intentos, ningún error fuera de `EEXIST`, estado
final siempre válido—.

El que cuesta dinero está **mejor de lo que estaba antes de que yo lo rompiera**: el guardarraíl ya
no se limita a preguntar «¿con qué motor hablas?», ahora comprueba primero **a quién** se lo
pregunta, y lo hace sin volverse un «niégate siempre» —lo confirmé en el camino normal, con
`?bridge=` propio y, sobre todo, **con el bloque desplazado**, que es el escenario para el que
existe la tanda—. La tercera vía la busqué y no está: la página no alcanza ningún backend fuera de
`serviceUrl`, y los cuatro parámetros que mueven servicios están cubiertos.

Lo que queda son **dos issues y una corrección de prosa**, ninguno bloqueante: el prólogo del
guardarraíl que nadie exige (H2, medido: 7 peticiones a un backend que declara cobrar, una de ellas
`POST /skin_sprite_sheet`); el rojo falso de `dos-corridas.mjs` tras un `--keep` (H15); y el `why`
de `nadie-inventa-un-puerto`, que promete cazar los puertos del bloque «los escriba como los
escriba» cuando la tabla que esta tanda borró vuelve a entrar sin que salte nada. Esa frase hay que
bajarla a lo que el regex hace, porque es la que alguien citará como garantía.

---

## Nota de cierre del coordinador (2026-08-27)

Este informe valida hasta `536c284`. **Después hubo un commit más**, `8238354` («Las dos reglas
dicen lo que hacen, y hacen más de lo que decían»), que cierra las cuatro evasiones que este
mismo informe destapó en su segunda vuelta:

| Evasión encontrada por QA | Estado tras `8238354` |
|---|---|
| la tabla de puertos que la tanda borró, reintroducida palabra por palabra | **cazada** |
| `PORT_HTML_QA="3000"` (asignación entrecomillada, como se escribe en bash) | **cazada** |
| `fuser --kill` (forma larga de `-k`) | **cazada** |
| `kill -9 $(pids_del_puerto …)` | **declarada fuera** en el `why`, con sus palabras |

Y, lo que más pesaba: los dos `why` se bajaron a lo que el regex hace de verdad. Cada uno
empieza por «LO QUE ESTA REGLA CAZA, exactamente» y termina por «LO QUE NO CAZA, dicho para que
nadie lo cite como garantía». La prosa que promete cobertura que el patrón no da es peor que una
modesta, porque desarma al siguiente que se la crea.

**Ese commit no lo re-verificó QA.** Lo comprobó el coordinador de forma independiente sobre la
evasión que más pesaba —reintroducir la tabla borrada en `qa/run.mjs` y correr
`test/architecture.test.ts`— y la regla salta:

```
✖ [error] nadie-inventa-un-puerto
  Los puertos del bloque no se escriben a mano; y un identificador «port»
  no se inicializa con un literal
ℹ pass 43 · fail 1
```

Los otros tres casos quedan afirmados solo por el informe del ingeniero, que sí los reprodujo en
verde antes de arreglarlos. Se dice para que nadie lea este documento como si cubriera el HEAD
entero.

Mergeado en `1aa0de1`. Issues abiertos desde aquí: **#295** (el prólogo del guardarraíl que nadie
exige, con la medida de 7 peticiones a un backend de pago), **#296** (`qa/presets.mjs` atribuye a
un preset un puerto ajeno) y **#297** (la ventana del enlace `ultima`).
