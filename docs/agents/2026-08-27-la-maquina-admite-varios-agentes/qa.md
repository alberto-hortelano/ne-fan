# QA — la máquina admite varios agentes a la vez

Validado sobre `feature/la-maquina-varios-agentes` (`85b0a40` + `e9fe1da` sobre `main` `c4a6e8f`),
el 2026-08-27, en la máquina real. Punto de vista: **quien trabaja en esta máquina**, no quien
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

**H1 · `qa/capturas/ultima` se congeló en la primera corrida y ya no vuelve a moverse.**
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
que la página no está usando.** Medido con el cliente real:
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

**H4 · `solo-se-mata-el-puerto-propio` cuenta llamadas a un helper, no el acto de matar.**
Con `fuser -k "$PORT_HTML/tcp"` escrito en línea dentro de `start_html` —el defecto exacto que la
regla nombra en su `why`, «las NUEVE funciones `start_*` mataban al ocupante»— el checker sale
**44/44 en verde**. Y `pkill`, que es lo que la restricción del usuario prohíbe por su nombre, no
aparece en ninguna de las 24 reglas (`grep -c pkill arch-rules.json` = 0). La casa se ha comido
esta semana cuatro candados verdes sobre el criterio incumplido; éste es de la misma familia,
aunque hoy el código esté bien. Sugerencia: que el patrón persiga `fuser -k`/`pkill`/`kill -9`
fuera de `kill_port`, no el nombre del helper.

### Menores

**H5 · `nadie-inventa-un-puerto` no caza un literal sin la palabra «port».** `const MOTOR_QA = 18765;`
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

## Veredicto

**Apto con reservas.**

Los nueve criterios (más el 5 bis) se cumplen y los he ejecutado yo, incluidos los tres que no se
pueden afirmar leyendo: dos corridas simultáneas, el guardarraíl en sus ocho desenlaces malos, y el
señuelo real en un puerto del catálogo. La tanda hace lo que dice: hoy el arranque no mata a nadie,
`k` distingue de quién es cada puerto, dos baterías conviven, y el guardarraíl de dinero —que
llevaba meses siendo una tautología— pide dos afirmaciones leídas de los backends y falla cerrado
en todos los caminos que probé, incluido un `?ai=` manipulado.

La reserva es **H1**: `qa/capturas/ultima` se congeló en la primera corrida y toda revisión visual
que mire ahí está mirando otra corrida sin que nada se lo diga. Es una regresión nueva, es del
oficio de este rol, y el arreglo es una línea (`rmSync` con `recursive`, o `unlinkSync` sobre el
enlace). Pediría cerrarla antes de mergear.

Lo demás no bloquea: **H2** (el prólogo que nadie exige) está declarado, ahora está **medido**, y
es material de issue con el número al lado —7 peticiones, una de ellas `POST /skin_sprite_sheet`—;
**H3** y **H4** son dos candados que dan verde sobre una parte de su criterio, y merecen issue
antes de que alguien los cite como garantía.
