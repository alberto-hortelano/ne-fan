# QA — corte 1 de #358: el muro de carga sale de `main.ts` a `ui/muro-de-carga.ts`

**Veredicto: APTO CON HALLAZGOS.** El corte es un movimiento y no un cambio: el muro se comporta igual que en `818e65b` en todos los estados que se pudieron alcanzar por el camino del jugador, los candados están verdes, el trinquete lleva la cifra exacta y no queda ningún símbolo viejo en código. Los hallazgos no son del muro: el más gordo es que **#469 tiene el cuerpo caducado** (la reaparición «cada ~5 s» no existe con el código de hoy; lo que hay es otra cosa, medido abajo), y el resto es prosa con nombres muertos y dos huecos de la receta de trabajo que el programa va a pisar seis veces más.

Worktree `/home/al/code/ne-fan-358-1-qa`, desprendido en `9216d7c` sobre `818e65b`. Cero créditos: presets `html-fixtures` y `e2e-sin-creditos` en el bloque 500 (`NEFAN_PORT_OFFSET=500 ./start.sh --preset …` / `--parar`), y la batería completa por `qa/run.mjs`, que eligió su bloque. Ningún proceso ajeno tocado: el único que se tumba (sonda B) es el bridge de ESTE worktree, por PID y con su `/proc/<pid>/cwd` comprobado antes. La batería del ingeniero (bloque 0, PID 27668) terminó sola antes de que la mía arrancara.

Evidencia fuera del árbol (scratchpad de la sesión, `/tmp/claude-1000/-home-al-code-ne-fan/273328d5-3414-4aea-9086-e8ac99d49ac2/scratchpad/`): `sondas/sonda-{a,b,c}.mjs` (las sondas), `capturas/*.png` + `capturas/sonda-{a,b,c}.json` (timelines completas), `verify-core.log`, `html-tsc.log`, `g77-negativo.log`, `bateria-qa1.log`. Guion nuevo en el árbol: `qa/guiones/77-el-muro-cerrado-no-vuelve-mientras-el-bridge-siga-caido.mjs` (+ su fila en `qa/README.md`).

## 1 · Criterios de aceptación

Sacados de `requisitos.md` (aceptación reencuadrada, «cada corte es una PR con…») y de la petición del coordinador para este corte. Las timelines las graba un `MutationObserver` instalado antes de que arranque la app (cada cambio de clase/texto del `#narrative-loader`, con el `data-titulo` del momento), así que no hay huecos entre muestreos.

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Movimiento, no cambio · arranque sin bridge** (`html-fixtures`): aviso del socket, muro de bootstrap, botones, contador, «Cerrar», el visor sigue vivo | ✅ | Sonda A, esc. 1: `180 ms → visible error «Sin conexión con la partida»` · `5.107 ms → visible error «No se pudo arrancar la partida» · cerrar=true · volver=false · elapsed=""` (H-5 de T9 conservado) · Cerrar a los 5.425 ms → `cls=""` · fixture `robledo_tile` pintada, `fps().frames=3598` · `data-titulo=null` (sin bridge el título no llega a pintarse, como en la base). Capturas `A1-…-muro-bootstrap-rojo.png`, `A5-…-aviso-socket-0ms.png`, `A3-…-fixture-pintada.png` |
| **Movimiento · arranque con bridge** (`e2e-sin-creditos`): título delante, muro tapado | ✅ | Sonda B, b1: `data-titulo="1"`, `#game-ui display:none`, `#narrative-loader.className=""`. `B1-e2e-titulo.png` |
| **Movimiento · aviso que llega CON el título delante** (chunk de three.js abortado en el borde) | ✅ | Sonda B, b2: el aviso «No se puede dibujar el mundo» va al hueco del título, `muroArmado=false`; timeline: `142 ms cls="" dt=null → 144 ms dt="1"` y el muro nunca pasa a `visible` (el aviso llegó tras el mando del título). `B2-e2e-aviso-con-titulo-delante.png`. Lo canda el guion 69 (verde en la batería) |
| **Movimiento · aviso que llega ANTES del primer `show()` y el título lo apaga** (`alCambiarElTitulo(true)`, H-1 de T9) | ✅ | Sonda C, 4/4 recargas con las hojas base abortadas: `149 ms [visible error · «Los personajes van sin vestir» · dt=null] → 161 ms [cls="" · dt="1"]` (y 114→115, 99→100, 96→97 ms). Es la rama positiva de `alCambiarElTitulo`, vista en la transición y no inferida del estado final. `C1-e2e-aviso-antes-del-titulo-apagado.png` |
| **Movimiento · nueva partida**: `mostrar` bajo el título, título fuera, `mostrar` de «generating», `ocultar` en `ready`; cronómetro arranca en `0s` | ✅ | Sonda B, b3 timeline: `589 ms visible «Iniciando partida...» elapsed=0s dt=1 → 661 dt=0 → 668 visible «Generando mundo inicial...» → 970 cls=""`, `scene=tile_0_0`. Con el motor falso el muro vive ~300 ms: el cronómetro no llega a pasar de `0s` (esperado) |
| **Movimiento · `progreso()` (latido del motor) y no-op con el muro oculto** | ⚠️ no probado en vivo | El motor falso no emitió `phase:"progress"` en los 300 ms de muro; tras `ready` el detalle quedó en «Generando mundo inicial...» sin cambios (b4). El cuerpo de `progreso` es byte a byte el de `updateLoaderProgress` (diff `818e65b..9216d7c`) |
| **Movimiento · bridge caído a mitad de partida** (juego delante, título no manda) | ✅ | Sonda B, b5: bridge (PID 38839, cwd de este worktree) tumbado → `7.312 ms visible error «Sin conexión con la partida» · cerrar=true · volver=false · dt="0"`; con 3 reintentos más del socket (registro `bridge` 1→4) UNA sola transición: ni repintado ni parpadeo. `B5-e2e-bridge-caido-muro.png` |
| **Movimiento · `resuelto("bridge")` apaga el muro que puso el aviso** | ✅ | Sonda B, b6: bridge relanzado como `start_bridge` (mismo env) → `27.323 ms cls=""` sin que nadie pulse nada; `avisosTitulo=[]`, `frames=1609`, partida viva. `B6-e2e-bridge-vuelve.png` |
| **Movimiento · «Cerrar» con partida detrás y sin reaparición** | ✅ | Sonda B, b7: segunda caída → muro a los 32.511 ms → Cerrar a los 32.563 → 4 reintentos más → `reaparicionesTrasCerrar=[]`. Y el guion 71 (fallo del MOTOR con partida detrás, «Cerrar» devuelve al juego) en la batería |
| **Movimiento · «Volver al título» con el motivo** (`salida:"volver-al-titulo"`, mundo vacío) | ✅ | Guion 20 en la batería (verde). Lectura: `volverAlTitulo` lee `muro.motivoDelUltimoMuro()` ANTES de `muro.ocultar()` (`main.ts:2063-2064`), como en la base (`:2211-2212`) |
| **#469 se mueve tal cual** (ni arreglado ni empeorado) | ✅ | `ui/muro-de-carga.ts:159-168` (`if (!elTituloManda()) { fallo(…); muroPuestoPorAviso = e.aviso.source; }`), `:161` (`resuelto` → `ocultar` si la fuente casa), `:178-188` (`alCambiarElTitulo`): las mismas sentencias que `main.ts:1595-1650` en `818e65b` (diff). Reproducción del bug: **no se reproduce** → H1 |
| **Cero rastros en código** (`showLoader\|hideLoader\|setLoaderState\|updateLoaderProgress\|loaderEl\|muroPuestoPorAviso\|loaderStartedAt\|loaderTicker`) | ✅ código · ⚠️ prosa | `grep -rnE` en todo el repo (sin `node_modules/dist/.git/cache/runs`): fuera de `ui/muro-de-carga.ts`, cero en `.ts`. Quedan en prosa: `qa/guiones/35:39,137,169`, `56:114`, `71:7`, `qa/README.md:201`, y la crónica histórica de `client-file-size.json` (`porque`, tramo de #306) → H2. `SalidaDelOverlay` y `elTituloManda` son símbolos VIVOS (core y `titulo-manda.ts`), no rastros |
| **Sin re-exports ni stubs** | ✅ | `grep -nE '^export' ui/muro-de-carga.ts` → 2 `interface` + `crearMuroDeCarga`. En `main.ts` solo `import { crearMuroDeCarga }` y 15 usos `muro.*` |
| **Trinquete**: cifra EXACTA en `client-file-size.json` en el mismo commit | ✅ | `wc -l main.ts` = **2222** = `"lineas": 2222` (línea 7 del JSON; las otras tres excepciones intactas: 1687/1732/531). `grep -c '^let '` = **19** (23 − 4). Funciones top-level 41 → 37. `porque` con UNA frase de crónica del corte |
| **Fichero nuevo ≤ 450** | ✅ | `wc -l ui/muro-de-carga.ts` = **190** |
| **Candados**: `npm run verify` en core; `tsc`/`lint` en html | ✅ | `verify`: `tests 2178 · pass 2178 · fail 0 · exit 0` (`verify-core.log`). `test/architecture.test.ts` solo, con el guion 77 ya en el árbol: `84/84`. `nefan-html`: `tsc exit 0`, `lint exit 0` (`html-tsc.log`) |
| **Patrón de deps de la casa** (fábrica + `Deps…`, sin objeto de contexto) | ✅ | `DepsDelMuroDeCarga { titleScreen: Pick<TitleScreen,"avisar"\|"retirarAvisos">; volverAlTitulo(): Promise<void> }` — dos deps, la mínima superficie del título y la función de la raíz. `errors`, `elTituloManda`, `paso` y el tipo `SalidaDelOverlay` entran por import de módulo (son módulos, no estado de `main.ts`), como manda el plan §4 |
| **API pequeña, no bolsa** (revisión) | ✅ | 7 métodos, todos con lector en `main.ts`: `mostrar` ×4, `ocultar` ×3, `fallo` ×4, `progreso` ×1, `visible` ×1 (`pintarFalloDelMotor`), `motivoDelUltimoMuro` ×1 (`volverAlTitulo`), `alCambiarElTitulo` ×1. `fallo()` pierde el parámetro `state:"error"` que solo admitía ese literal (bien). Orden de construcción: la fábrica se construye tras `titleScreen` y ANTES de asignar `onVisibilityChange`; la base suscribía `errors.onAviso` después — indiferente, la entrega es en microtarea (`error-log.ts:entrega`) |
| **Adversarial · `fallo()` sin `salida`** → «cerrar» | ✅ | b5 en vivo: el aviso del suscriptor llama `fallo(titulo, mensaje)` sin salida → `cerrar=true · volver=false` |
| **Adversarial · `ocultar()` dos veces** | ✅ | b7→b8 en vivo: el jugador cierra; al volver el bridge `resuelto("bridge")` vuelve a llamar `ocultar()` sobre un muro ya cerrado → `b8_timelineFinal` sin transiciones nuevas, `pageErrors: []` |
| **Adversarial · `progreso()` con el muro oculto** | ✅ lectura | `if (!loaderEl \|\| !loaderEl.classList.contains("visible")) return;` (`:83`) — idéntico a la base |
| **Adversarial · `alCambiarElTitulo(true)` con un muro que NO puso un aviso** | ✅ lectura · ⚠️ sin camino real | `if (visible && muroPuestoPorAviso !== null)` (`:184`): un muro legítimo no se toca. No hay flujo del jugador que abra el título sobre un muro legítimo: `volverAlTitulo` y el `catch` de `unIntentoDeArrancar` hacen `muro.ocultar()` antes de volver a `show()` |
| **Adversarial · `resuelto` de otra fuente** | ✅ lectura | `if (muroPuestoPorAviso === e.source) ocultar()` (`:161`); el título sí retira sus avisos de esa fuente (`retirarAvisos(e.source)`), igual que en la base |
| **Guiones que ejercen lo movido, verdes SIN retocarlos** | ✅ | Batería completa: **76 en verde · 0 en rojo de 76** (`bateria-qa1.log`, 14:30:46 → 14:37:33). La red del plan (20, 35, 50, 56, 69, 70, 71) en verde; ni un guion tocado (`git status`: solo `qa/README.md` +2 y el 77 nuevo). Ver § 6 |
| **Crítica visual: nada cambió** | ✅ | El commit no toca ni `index.html` ni ningún `.css` (`git show --stat 9216d7c`: 6 ficheros, ninguno de marcado ni estilo); los ids `#narrative-loader*` y las clases `visible`/`error` son las mismas. Capturas: A1/A5 (fallo sobre tema oscuro), B5 (fallo sobre el tema claro del estilo `acuarela_luminosa`: rojo legible sobre el fondo lavado, «Cerrar» con peso justo), C2 (espera: aro dorado, titular dorado, detalle atenuado, contador). Lo que se ve y NO es de este corte: § H6 |

## 2 · Hallazgos

### H1 · importante · **#469 tiene el cuerpo caducado** — fuera del alcance del corte 1; es la PR de #469 la que tiene que empezar por aquí

El issue dice: «cada ~5 s el reintento del socket vuelve a levantar el muro que el jugador ya cerró». Medido hoy, tres veces y de tres formas:

1. **`html-fixtures`, cerrar el muro de bootstrap** (sonda A, esc. 1): 12 reintentos del socket después (entradas `bridge` del registro 2 → 14, ≈ 60 s), **0 reapariciones**. El ingeniero midió 12 s; esto son 60.
2. **`html-fixtures`, cerrar el muro DEL SOCKET a los 352 ms** (sonda A, esc. 2): a los **5.066 ms aparece un muro** — pero es el de `bootstrap` («No se pudo arrancar la partida», el timeout de `createGameClient`), otro titular y otra causa; después, 6 reintentos más y nada. **Esto es lo que las QA de T13 vieron**: sin bridge el arranque pinta DOS muros (aviso del socket a ~180 ms, bootstrap a ~5.100 ms), y quien cierra el primero ve el segundo cinco segundos después. Los propios guiones que abrieron el issue lo describen (`las-fixtures-solo-chocan-con-el-agua.mjs:155-157`: «el del socket sale a los ~0 ms y el del arranque a los ~5 s») sin llamarlo por su nombre.
3. **`e2e-sin-creditos`, bridge caído a mitad de partida y cerrado por el jugador** (sonda B, b7): 4 reintentos, **0 reapariciones**.

Por qué no puede reproducirse: la dedupe por trío `(source, titulo, mensaje)` de `ErrorLog.avisa` (`error-log.ts:249-254`) existe desde `e67ae4d` (PR #423, 2026-09-04 12:43), y su propio comentario dice para qué («sin esto … el muro que el jugador cerró vuelve solo cada cinco segundos»). Las PR que lo observaron, #458 y #460, tienen base Y head que ya contienen `e67ae4d` (`git merge-base --is-ancestor`: SÍ en los cuatro). El #469 se abrió el 09-05 15:49, un día después del arreglo, describiendo un síntoma que ya no era ese.

Lo que SÍ hay, y es lo que la PR de #469 tendría que decidir (no lo toco):
- Dos muros consecutivos por la misma causa, con textos distintos: «Sin conexión con la partida / el socket de la partida no abre (ws://…)» y «No se pudo arrancar la partida / bridge did not connect within 5000ms — is nefan-core bridge running on ws://…?». El segundo es jerga de desarrollo en inglés, en la pantalla del jugador.
- `muroPuestoPorAviso` se queda en `"bridge"` cuando el muro de bootstrap sobreescribe al del aviso (`fallo()` no lo toca): si el bridge llegara, `resuelto("bridge")` cerraría el muro de bootstrap. Hoy es coherente (la causa es la misma) pero es política, no accidente, y hay que escribirla.
- El candado que #469 pide («que `fixtures-sin-bridge.mjs` afirme que el muro no reaparece») **ya existe desde hoy**: `qa/guiones/77-…` (§ 5), verde con el código actual y rojo con la dedupe anulada.

Propuesta: reescribir el cuerpo de #469 con estas medidas antes de abrir su PR. Con el cuerpo actual, un ingeniero buscaría un bug que no existe.

### H2 · menor · prosa con los nombres muertos — en el alcance del corte 1 (o de la PR de #469, si el coordinador prefiere no tocar guiones aquí)

`qa/guiones/35-…mjs:39,137,169` (`hideLoader`, `showLoader`), `56-…mjs:114` (`hideLoader`, `setLoaderState`), `71-…mjs:7` (`setLoaderState`), `qa/README.md:201` (`setLoaderState`). Son comentarios; el `grep` de código está a cero. El requisito dice «cero rastros … `grep` a cero» sin distinguir prosa, y la regla de la casa es que los rastros confunden a los agentes. El ingeniero lo declara (hallazgo 3) y lo aplaza a la PR de #469; retocar un comentario no es «retocar un guion para que pase», así que cabe en este corte. La crónica del `porque` de `client-file-size.json` («SUBE a 2.377 con #306: … `setLoaderState`») es histórica y puede quedarse.

### H3 · menor · el informe del ingeniero está a medias y su batería trae un rojo que no nombra — proceso

`implementacion-1.md` deja «## Batería completa» en «(Se rellena al terminar la corrida relanzada; ver abajo.)». Su corrida terminó (`bateria-completa-2.log`, PID 27668): **74 en verde · 1 en rojo de 75**, rojo `75-la-huella-del-tile-no-lleva-las-salidas`, bloque 3 (#410): «el tile que vuelve con otras salidas NO re-deriva su colisión — 2 derivaciones (había 1) — la escena servida cambió en: npcs (barkeep: position)». No tiene relación con el muro (el corte no toca tile-store, bridge ni NPCs), y en mi corrida sobre el mismo commit el 75 salió **verde**: es intermitente — la huella de la escena servida lleva la posición de un NPC que se mueve solo (vida ambiental), y según cuándo vuelva el tile la huella casa o no. Es cosa del guion 75 / #410, no de este corte, pero el informe del ingeniero tendría que decirlo en vez de dejar la sección vacía.

### H4 · importante para el programa (no para este corte) · la receta de worktree no está en el repo

El hallazgo 1 del ingeniero (`qa/node_modules` y `nefan-html/public/sprites/` ausentes; 70 y 71 rojos «sobre la base») no es un problema del corte ni de los guiones: es que **el repo no dice cómo se monta un worktree**. `docs/agents/README.md` (28 líneas) no menciona worktree, sprites ni `npm ci`; `qa/README.md:71` solo lo anota para `fake-enruta-por-pathname`. La receta vive en la memoria del coordinador («gotcha medido el 2026-09-03, dos veces el mismo día») y hoy ha mordido por tercera vez; este programa abrirá seis worktrees más. Dos formas de cerrarlo, a elegir: una sección «Montar un worktree» en `docs/agents/README.md` (los cuatro `npm ci`, la copia de `public/sprites/`), o mejor un candado: que `qa/run.mjs` salga `⊘` con el motivo si faltan las hojas base, en vez de dejar que 70/71 salgan rojos diciendo otra cosa.

### H5 · menor · dos gotchas del banco que la doc no cuenta

- **`--parar` es por worktree y mira los diez bloques a propósito** (`start.sh:1327-1337`: «quien arrancó con `NEFAN_PORT_OFFSET` no debería tener que acordarse del número para poder parar»), y `CLAUDE.md` lo dice («los puertos del catálogo (los diez bloques)»). El launcher hace lo que promete; lo que no está escrito en ningún sitio es el corolario que se llevó la batería del ingeniero: **la batería de `qa/run.mjs` es «tuya» para `--parar` porque nace de tu árbol**, así que una pasada de ojos y una batería en el mismo worktree no se pueden parar por separado. Una línea en `qa/README.md` (sección del runner) bastaría.
- **`node qa/run.mjs --url` con una URL que lleve query rompe el offset**: `--url 'http://localhost:3500/?offset=500'` produce `?offset=500/?input=scripted…` y la página lanza `NEFAN_PORT_OFFSET inválido: "500/?input=scripted"` (medido dos veces antes de darme cuenta). La forma buena es `NEFAN_PORT_OFFSET=500 node qa/run.mjs --url http://localhost:3500` (`elegirBloque` honra el entorno). El runner podría rechazar una `--url` con query en vez de fabricar una rota.

### H6 · menor · preexistente, lo que se ve en las capturas y no es de este corte

- En `e2e-sin-creditos` el título registra 4-5 errores `title` («la portada del estilo … no cargó (http://127.0.0.1:9267/…)», el asset-store no está en el preset) y el panel de errores in-game arranca con 8 entradas antes de que el jugador haga nada (`B3/B5`). Ruido de bench, pero ruido.
- El panel `#error-log` se pinta POR ENCIMA del muro (A1, B5): con el muro a pantalla completa el jugador sigue viendo el volcado técnico a la derecha. Es el dev-panel y así estaba en la base.

## 3 · Workarounds usados durante la prueba

| Workaround | ¿Lo tiene el jugador delante? | Veredicto |
|---|---|---|
| `MutationObserver` inyectado con `addInitScript` para grabar las transiciones del muro | No: observa, no altera (y se instaló sobre `document`, porque en el init script aún no existe `documentElement` — el primer intento falló por eso) | No afecta |
| Tumbar el bridge de ESTE worktree por PID (`ss -ltnp` → `/proc/<pid>/cwd` empieza por el worktree y `cmdline` es `ws-server.ts`) y relanzarlo con el mismo `env` que `start_bridge` | Es exactamente lo que le pasa al jugador cuando se le cae el bridge y vuelve | No afecta; ningún proceso ajeno tocado |
| `?bridge=ws://127.0.0.2:<bridge+3>` para apuntar la página a un socket muerto (guion 77) | Técnica ya usada por `fixtures-sin-bridge.mjs` (segunda pasada) | No afecta |
| **Foto sintética** `C2-FOTO-SINTETICA-muro-progreso.png`: clases y textos puestos a mano SOLO para la crítica visual del estado de espera, que con el motor falso dura ~300 ms y la cámara no llega | El estado real existe (timeline b3: 589→970 ms); la foto no es evidencia de comportamiento, solo del CSS | Declarado en el nombre del fichero; no sustituye a nada |
| Comentar `if (this.yaAvisados.has(clave)) return;` en `error-log.ts` para el negativo del guion 77 | Solo para probar que el guion se pone rojo | Restaurado (`git checkout`; `git status` limpio, 0 marcas) |
| Guardar las sondas en `qa/.tmp/`: `qa/run.mjs` las borró (`limpiarTmpViejos` barre los directorios sin `vivo.pid`) | Culpa mía, por diseño del runner | Reescritas en el scratchpad |

## 4 · No probado

- **`progreso()` en vivo**: el motor falso no emitió `phase:"progress"` en la ventana del muro. Cuerpo idéntico a la base.
- **`alCambiarElTitulo(true)` sobre un muro legítimo**: no hay camino real que lo alcance (el título solo vuelve tras `ocultar()`). Verificado por lectura.
- **Comparación pixel a pixel con `818e65b`**: no se levantó la base; se apoya en que el commit no toca marcado ni CSS y en que los guiones que miran el muro (20, 35, 50, 56, 69, 70, 71) están verdes sin retocarlos.
- **Motor real / gasto**: cero créditos por diseño del corte; el rótulo de un fallo de generación real (`rotuloDeStatus` → `muro.fallo(…, salida)`) queda cubierto por 71/56/20 con el motor falso.
- **Mutación / CRAP / cobertura**: no aplican al cliente (#241).

## 5 · Guion nuevo — `qa/guiones/77-el-muro-cerrado-no-vuelve-mientras-el-bridge-siga-caido.mjs`

Es el candado que #469 pedía, medido por ESTADO: apunta el socket a `127.0.0.2:<bridge+3>`, espera los dos muros del arranque en su orden, cierra el de bootstrap y espera a que el registro cuente cuatro reintentos más del socket vigilando el muro en cada sondeo. Declara `sinMotor` (sin bridge no hay partida). Fila añadida en `qa/README.md`.

- **Negativo** (`g77-negativo.log`, stack propio del runner en el bloque 0, dedupe de `ErrorLog.avisa` comentada): `✘ #469: … — reapareció tras 1 reintento(s): «Sin conexión con la partida»` · `0 en verde · 1 en rojo de 1`. Restaurado.
- **Positivo**: en la batería completa de abajo.

## 6 · Batería completa (`node qa/run.mjs`, sin retocar ningún guion)

Lanzada después de todo lo demás y con la batería del ingeniero ya terminada, desde este worktree; el runner eligió el bloque 0 (libre) y su disco efímero `qa/.tmp/2026-09-06T12-30-47-254Z-41191`.

```
76 en verde · 0 en rojo de 76 · capturas en /home/al/code/ne-fan-358-1-qa/qa/capturas/2026-09-06T12-30-47-254Z-41191
bateria exit 0        (14:30:46 → 14:37:33)
```

Ni rojos ni `⊘`. Los que ejercen el muro: `✔ 20 · ✔ 35 · ✔ 50 · ✔ 56 · ✔ 69 · ✔ 70 · ✔ 71`; el 75 que le salió rojo al ingeniero: `✔ 75`; y el nuevo, en positivo:

```
▶ 77-el-muro-cerrado-no-vuelve-mientras-el-bridge-siga-caido
    socket movido a ws://127.0.0.2:9880 (el real era ws://127.0.0.1:9877)
    ✔ el muro del arranque sin bridge ofrece «Cerrar» y no «Volver al título» (detrás queda el visor de fixtures)
    ✔ «Cerrar» cierra el muro
    tras cerrar: {"reaparecio":false,"reintentos":4}
    ✔ #469: el muro que el jugador cerró NO vuelve con los reintentos del socket
    ✔ …y el registro sí apunta cada reintento: se colapsa el AVISO, no la verdad
```

Al terminar, `ss -ltn` no muestra ningún puerto del catálogo arriba en ningún bloque.

## 7 · Veredicto

**APTO CON HALLAZGOS.** El corte 1 puede cerrarse tal como está: mueve sin cambiar, con la cifra exacta y los candados verdes. Antes de abrir la PR de #469 hay que reescribir su cuerpo con la medida de H1 (el bug que describe no existe desde #423; lo que existe son dos muros consecutivos y una política de `muroPuestoPorAviso` sin escribir), y el guion 77 ya es su candado. H2 es una decisión de dónde se barre la prosa; H4 y H5 son deuda de la receta de trabajo que el programa pagará seis veces si no se escribe.
