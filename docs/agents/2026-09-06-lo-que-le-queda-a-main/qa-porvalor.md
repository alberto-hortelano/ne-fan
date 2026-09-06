# QA — `porValor` de #358: los dos `let` de facetas de `main.ts` mueren en un ayudante de core

**Veredicto: APTO CON HALLAZGOS.** El comportamiento es el de la base `95773fb0` en todos los estados alcanzables
por el camino del jugador, medido con la MISMA sonda sobre el MISMO stack en dos variantes (el commit tal cual, y
el commit con los dos sinks literales de la base reinyectados en vuelo): los contadores de `resetWorld()` y
`cerrarDialogo()` coinciden cifra a cifra en las cuatro páginas del recorrido (arranque, partida nueva, resume que
falla con el neutro repetido, otra partida, reanudar la misma, y `enter(A)` → muro → «Volver al título»). El
ayudante cumple exactamente la promesa que escribe su doc, los cinco tests distinguen cada regla de su contraria
(cinco mutantes a mano, cada uno cazado por un conjunto DISTINTO de tests; Stryker 41/41), `verify` 2.183/2.183,
CRAP verde en cuatro pasadas, 1.808 líneas / 15 `let` con el trinquete probado en rojo, cero rastros y ninguna
decisión de «aplicar o no» en el cliente. Los hallazgos son menores: el `porque` del módulo en
`mutation-targets.json` describe un módulo «sin ramas de negocio» que desde hoy tiene una (y ya decía algo falso
antes: «sin corrida todavía, la nocturna lo mide»), y el **suelo de cobertura 89 % es hoy una lotería en local**
—cinco pasadas verdes entre 89,06 y 89,09 y una roja del ingeniero en 88,98, con ruido de pasada de hasta 0,10—,
dato que no es de esta PR pero que esta PR ha destapado.

Worktree `/home/al/code/ne-fan-358-pv-qa`, commit `cff03aff` sobre `95773fb0`. Cero créditos en toda la
verificación (`e2e-sin-creditos` en el bloque 600 con el motor falso; `gasto sesión 0,00 € · total 0,00 €` en
las capturas miradas, y el bridge propio de la página 4 apunta a un motor que no existe). Ningún proceso ajeno tocado: `ss -ltn` antes (solo 22/53/80/631/3636; el stack del corte 5 apareció
en el bloque 500 a mitad y `--parar` lo enumeró como AJENO sin tocarlo); mi stack parado con
`NEFAN_PORT_OFFSET=600 ./start.sh --parar` → `✅ stack cleaned` antes de la batería.

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Comportamiento = base** · arranque con el título: 0 resets | ✅ | Sonda (§4), página 1, variantes nueva y base: `{"resetWorld":0,"cerrarDialogo":0,"sesion":"","tiles":0}`; traza de `porValor` vacía (el arranque no llama a ningún sink) |
| Nueva partida → `resetWorld` UNA vez, `cerrarDialogo` UNA vez | ✅ | Página 1, las dos variantes: `resetWorld:1, cerrarDialogo:1`, `tiles:1`, `escena:true`. Traza `porValor`: `[{sessionId:"1788720702-b9f03f", vigente:"", aplica:true}` ×2 (mundo y dialogo). 3 s después, sin cambiar de sesión: siguen en 1/1 (nadie vuelve a vaciar ni a cerrar) |
| Resume fallido con el neutro repetido → 0 | ✅ | Página 2 (save de P1 borrado por otro cliente por WS, pulsar su tarjeta): aviso «No se pudo reanudar la partida. Esa partida guardada ya no está en el disco.» y `resetWorld:0, cerrarDialogo:0`; traza `[{sessionId:"", vigente:"", aplica:false}` ×2] — el `leave()` del catch con los neutros ya puestos, exactamente la medida del 2026-08-28 que cita la doc del ayudante, re-medida hoy. Base: 0/0 igual |
| Cambiar de partida → 1 | ✅ | Página 2, tras el resume fallido, partida nueva P2: `resetWorld:1, cerrarDialogo:1` (`""→P2`, `aplica:true` ×2). Base: 1/1. Y en la página 4, `enter(A)` con el motor cortado (el muro «La partida no pudo empezar») deja 1/1 y «Volver al título» (`leave()`, `A→""`) sube a **2/2** con traza `{sessionId:"", vigente:"1788720714-2da971", aplica:true}` ×2 — el cambio de id en el otro sentido también aplica. Base: 1/1 → 2/2 |
| Resume de la misma sesión → 0 | ✅ con la lectura honesta | En el cliente no existe «mismo id dos veces sin `leave()`»: `session.enter` solo se llama en las dos ramas de `unIntentoDeArrancar` (`main.ts:1690`, `:1703`), siempre tras `titleScreen.show()`, y el título solo se pinta en el bootstrap (estado nuevo), tras `volverAlTitulo()` (que hace `leave()` en `:1654`) o tras el catch (que hace `leave()` en `:1786`). Reanudar P2 desde el título (página 3, página recién cargada) es `""→P2` y vacía UNA vez (1/1) antes de que el save reponga el mundo — igual en la base. El caso «A, A → 1» lo sujetan los tests 1 y 5 y la mutación (§2) |
| Diálogo: `cerrarDialogo` al cambiar de sesión y no al repetirla | ✅ | Mismo contador que `resetWorld` en las 8 medidas (1/1, 0/0, 1/1, 1/1, 1/1→2/2): los dos sinks ven las mismas transiciones y deciden igual. Ninguna transición real ocurre con un diálogo abierto (el muro con «Volver al título» solo sale con el mundo vacío; el catch, antes de que haya escena), así que hoy `cerrarDialogo()` desde el sink siempre cierra un panel ya cerrado — igual que en la base, y es lo que dice la doc de `FacetSinks.dialogo` |
| **Diseño**: la promesa de la doc es la que cumple el código | ✅ | «Aplica solo cuando el id de sesión CAMBIA», «arranca en el neutro», «recuerda el ÚLTIMO id, no el conjunto»: las tres son literalmente las tres líneas del cuerpo (`let vigente = NO_SESSION.sessionId; if (sessionId === vigente) return; vigente = sessionId; aplicar()`). Revisión en §2 |
| Los tests distinguen cada regla de su contraria | ✅ | Cinco mutantes a mano (§2): sin memoria → caen 1, 4, 5; `!==` → caen 1, 2, 3, 4; arranque fuera del neutro → cae 3; sin guarda → caen 1, 3, 5; recordar solo el PRIMER id → caen 4, 5. Ningún par de mutantes cae con el mismo conjunto exacto salvo por inclusión; el test 4 («A → título → A = 3») es el único que separa «último id» de «primer id», que es el que el patrón de un solo elemento habría dejado pasar |
| **Mutación** `local session-facets` | ✅ | `Instrumented 1 source file(s) with 41 mutant(s)` · `session-facets.ts | 100.00 | 100.00 | 41 | 0 | 0 | 0 | 0` · `║ ok session-facets 41 mutantes · 0 vivos · score 100.0% (break 100) · 7s`. 35 → 41 (los 6 nuevos son `porValor`). La huella sigue en 35 (`run 33990281788`, 2026-09-05): `local` no la reescribe, correcto |
| **CRAP/cobertura** `npm run crap -- --check` | ✅ ×4, lotería | Cuatro pasadas mías: `✔ dentro de los umbrales`, «Cobertura de líneas mínima: 89% — ahora 89.1%» las cuatro. Cifra exacta vía `crapRows().cobGlobal` sobre cada lcov: **89,0555 % · 89,0691 % · 89,0758 % · 89,0860 %**. `porValor`: `cx 1 · cob 100 % · crap 1.0`. Tope 73: 0 por encima; objetivo 30: 7 por encima (los de siempre). Veredicto sobre el suelo en H2 |
| **Cero rastros** | ✅ | `grep -rn "mundoPintadoDe\|dialogoDeSesion"` en todo el repo salvo `node_modules`, `.git`, `dist`, `.tmp`, `capturas` y `docs/agents/`: **0**. Prosa «POR VALOR» del sink del cliente fuera de core: 0 (`main.ts:528` «por getter, no por valor» es de las deps, no de esto). `porValor` aparece solo en core (fuente, test), en los dos sinks de `main.ts` y en la crónica del JSON |
| **Trinquete** `client-file-size.json` = `wc -l` | ✅ | `"lineas": 1808` = `wc -l src/main.ts` → **1808**. En negativo: con 1836, `test/client-file-size.test.ts` → `fail 1`: «src/main.ts ADELGAZÓ a 1808 y su excepción sigue en 1836: le está regalando 28 línea(s) de recrecimiento». Restaurado, `git status` limpio |
| 15 `let` | ✅ | `grep -c '^let ' src/main.ts` = **15** (los 17 de la base menos los dos de facetas; lista: `playerModel`, `playerSkinPrompt`, `baseSheetsLoaded`, `devMenu`, `graphicsChip`, `scenesMode`, `charactersMode`, `input`, `attackCatalog`, `sessionCombatSystemId`, `gameClient`, `lastRenderError`, `ratonCapturadoAntesDelDialogo`, `lastTime`, `tituloEnMarcha`) |
| `npm run verify` | ✅ | `tests 2183 · suites 396 · pass 2183 · fail 0 · exit=0` (2.178 + 5). Cliente: `TSC_OK · LINT_OK · ✓ built in 1.57s` |
| **Lógica en core, el cliente solo pinta** | ✅ | En `main.ts` no queda ninguna comparación de id a mano: `grep "sessionId ===\|sessionId !==\|session.id ===\|=== session.id"` → 0. Los ocho sinks son `X: (…) => aplicador(…)`; los dos destructivos son `porValor(() => …)`. Las tres decisiones de pertenencia que quedan son `session.esMio(...)`, que ya eran de core. El diff de `main.ts` es −40/+6: dos `let` con sus docs, dos guardas y dos bloques de comentario fuera; un import y dos líneas de sink dentro |
| Guiones de la red sin retocar | ✅ | `git diff 95773fb0 cff03aff --stat`: cuatro ficheros, ninguno en `qa/`. Batería en §6 |
| Aritmética del plan (≈ 1.815 / 15) | ✅ | 1.808 / 15: dentro del ± 10, siete líneas menos porque los comentarios de los sinks se redujeron algo más (el del `dialogo` conserva el párrafo «Lo que esto NO hace…», que es del gate y no del «por valor» — correcto conservarlo) |

## 2 · El diseño, leído como revisor

**La firma.** `porValor(aplicar: () => void): (f: Pick<SessionFacets, "sessionId">) => void`. El tipo devuelto es
asignable a `mundo`, `dialogo`, `history` y `entrada` (los cuatro `Pick<…,"sessionId">`) y a ninguno más; como
`aplicar` no recibe el id, envolver `history` o `entrada` con él no compila con sentido (sus aplicadores necesitan
el id) — el molde solo sirve para los sinks que lo LEEN sin usarlo, que son justo los dos destructivos. Bien.

**El arranque en `NO_SESSION.sessionId`.** Es correcto y es el mismo `""` con el que arrancaban los dos `let` de la
base (`let mundoPintadoDe = ""`), así que no cambia nada; lo que gana es que si el neutro cambiara de valor, el
ayudante lo seguiría solo. El caso que «esconde» es el que ya escondía la base: un `enter({sessionId: ""})` sería
indistinguible de un `leave()` para este sink — y también para `session.active`, que es `sessionId !== ""`. Es
coherente con el módulo entero («`""` = no hay partida») y hoy el bridge nunca contesta un id vacío; no es un
hallazgo, queda dicho.

**Estado por closure.** Cada `porValor(...)` tiene su `vigente`. Los dos sinks ven exactamente las mismas
transiciones (`apply` recorre el record entero), así que no pueden divergir; la sonda lo confirma (ocho medidas,
contadores iguales). Si un día un sink se llamara fuera de `apply`, divergirían — pero eso ya no sería el módulo.

**Lo que hoy NO se ejerce en el cliente**, dicho para que nadie lo lea de más: la guarda solo devuelve `false` en
el caso «neutro repetido» (página 2). El «A dos veces» no tiene camino (fila 5 de la tabla). El ayudante vale
por lo que hace inexpresable —el sink destructivo que no mira— y por el molde para el sink que un día refresque
a mitad de partida (plan-8 § 7 c), no por un bug que hoy arregle. El ingeniero lo dice igual en su informe.

**Los cinco tests.** Los cuatro de un solo sink son de una o dos transiciones cada uno y, mirados en conjunto,
NO son «de un solo elemento»: el 4 (`A, "", A → 3`) es el que separa «recuerda el último id» de «recuerda el primero»
o «ya visto», que es el fallo que un `Set` o un `if (!vigente) vigente = id` habrían pasado con los tests 1-3 en
verde. El 5 va por `createClientSession` con los otros seis sinks espiados y afirma tres cosas a la vez (el orden
`["mundo","dialogo","mundo","dialogo"]`, que `style` se aplicó las TRES veces, y que `mundo`/`dialogo` son
primero y último del record). Mutantes a mano (`session-facets.ts` mutado con `sed`, `node --import tsx --test
test/session-facets.test.ts`, restaurado con `git checkout` tras cada uno; sin mutar: `pass 14 · fail 0`):

| Mutante | Tests que caen |
|---|---|
| M1 · `vigente = sessionId` borrado (sin memoria) | 1 «mismo id dos veces», 4 «A → título → A», 5 «vía createClientSession» — `fail 3` |
| M2 · `===` → `!==` | 1, 2 «de A a B», 3 «el neutro primero», 4 — `fail 4` |
| M3 · `let vigente = "nadie"` (arranca fuera del neutro) | 3 — `fail 1` |
| M4 · guarda borrada (aplica siempre) | 1, 3, 5 — `fail 3` |
| M5 · `if (vigente === NO_SESSION.sessionId) vigente = sessionId` (recuerda solo el PRIMERO) | 4, 5 — `fail 2` |

Cinco conjuntos distintos: ningún test es redundante y ninguna regla queda sin contrario que la falsifique.
Stryker dice lo mismo con 41 (0 vivos).

**Lo que la doc del ayudante afirma y se ha re-medido**: «el `leave()` de un arranque que falla llega con los
neutros ya puestos y NO dispara (medido el 2026-08-28 … `dialogo("") · vigente="" · repetido=true`)». La
página 2 de hoy lo reproduce por el camino del jugador: `{sessionId:"", vigente:"", aplica:false}` ×2.

## 3 · Hallazgos

### H1 · menor · el `porque` de `session-facets` en `mutation-targets.json` describe un módulo que ya no es — destino: **esta PR** (una frase) o el coordinador

`nefan-core/data/contract/mutation-targets.json`, módulo `session-facets`: «treinta líneas sin ramas de negocio,
y sus dos únicos mutantes interesantes —quitar la llamada a un sink dentro de `apply`, o cambiar el neutro de una
faceta en `NO_SESSION`—». Desde `cff03aff` el módulo tiene una rama de negocio (`if (sessionId === vigente)
return`) cuyos seis mutantes son exactamente los interesantes de `porValor` (§2). La misma entrada termina en
«Sin corrida todavía: la nocturna lo mide (queda anotado en el informe de implementación)», que ya era falso
antes de esta PR: la huella tiene al módulo medido (`run 33990281788`, 2026-09-05, 35 mutantes, `con base`,
dueño #474) y CLAUDE.md dice que **no hay** nocturna («La mutación se PIDE… No hay cron»). El ingeniero vio la
segunda frase y la dejó por no ser suya; la primera la deja obsoleta él. Regla del repo: los rastros confunden
a los agentes. **Repro**: leer la entrada; **esperado**: que diga lo que el módulo es hoy y cómo se mide.

### H2 · dato para el issue del coordinador (no es de esta PR) · el suelo de cobertura 89 % es hoy una lotería en local

Medidas conocidas hoy sobre `cff03aff` (misma revisión, mismo entorno): ingeniero **88,9844 %** (ROJA) y
89,0792 %; mías **89,0555 · 89,0691 · 89,0758 · 89,0860 %** (verdes, las cuatro «89.1%» al redondear). Base
`95773fb0` según el ingeniero: 89,0090 %. Seis pasadas, una roja; el margen sobre el suelo es de 0,06-0,09 puntos
y el ruido de pasada observado llega a 0,10 (88,98 → 89,08 en el mismo árbol). El ruido es real y no de
`session-facets` (236/236 líneas cubiertas en todas mis pasadas): entre mis pasadas 1 y 2 cambian ±1 línea **29
ficheros** que esta PR no toca (`arch/check.ts` 425→424, `volume-prims.ts` 504→502, `npc-behavior.ts` 705→706,
`reducers.ts` 110→111, `blob-store.ts` 135→136…), el artefacto conocido de V8. La propia nota del umbral declara
«ruido de pasada 0,1» y «CI mide 0,6 por encima de local», y fijó el suelo con 1,1 puntos de margen sobre
90,1 %: ese punto se ha ido consumiendo PR a PR sin que ninguna lo dijera. **Veredicto**: en local, hoy, el
candado NO es un candado —sale rojo o verde según la pasada— y su respuesta por defecto («mirar qué función se
quedó sin quien la ejerza») es la que toca, no bajarlo; en CI probablemente sigue verde por los +0,6 documentados,
que **no he medido hoy**. No toco `quality-thresholds.json`.

### Observaciones laterales (fuera de la PR, sin perseguir)

- En el muro «La partida no pudo empezar» (captura `pv-nueva-4-muro.png`) el aro del loader sigue dibujado junto
  al título en rojo y el botón «Volver al título»; el mismo texto aparece a la vez en el panel de errores arriba a
  la derecha. UX pre-existente del muro (guion 20 lo afirma), no de esta PR.
- La vista reanudada del banco (`pv-nueva-3-p2-reanudada.png`) es el interior de la taberna con el atlas falso a
  cuadros y la barra del bandido; es el `fake-surface-model` del banco, no arte. Nada que juzgar de esta PR: el
  renderer no se toca.

## 4 · La sonda, y los workarounds usados (con veredicto)

Sonda `scratchpad/sonda-porvalor.mjs` (Playwright sobre el Chrome del banco, `abrirNavegador` de `qa/lib`), URL
del runner (`?input=scripted&ai=<fake>&raf=timer&offset=600`), sin tocar el fuente ni el árbol:

1. **Instrumentación en vuelo del `main.ts` que sirve Vite** (`page.route` sobre `/src/main.ts`): un contador en
   `window.__qaSonda` al entrar en `function resetWorld() {` y `function cerrarDialogo() {`; y sobre
   `session-facets.ts`, una anotación `{sessionId, vigente, aplica}` antes de la guarda de `porValor`. La sonda
   LANZA si no encuentra el patrón (no hay verde por casualidad). Veredicto: es medida, no apaño — el código que
   corre es el del commit más un incremento; el jugador no ve nada de esto ni lo necesita.
2. **Variante `base`**: además sustituye en vuelo `mundo: porValor(() => resetWorld())` y `dialogo: porValor(() =>
   cerrarDialogo())` por los dos closures literales de `95773fb0` con sus dos variables en `window.__qaBase`. Es
   la forma de medir la base con la MISMA receta y el MISMO stack sin un segundo worktree. La traza de `porValor`
   sale vacía en esa variante (prueba de que la sustitución fue efectiva).
3. **Bridge propio con el motor cortado** (`NEFAN_AI_SERVER=http://127.0.0.1:9`, disco propio, `?bridge=`/`?state=`):
   la técnica del guion 20, y el único camino REAL a «Volver al título» (`volverAlTitulo` → `leave()`) sin recargar.
   El fallo lo produce un motor que no está; el jugador lo vive igual. Parado por PID de su propio grupo al acabar.
4. **Borrar el save «como otro cliente»** por WS `delete_session` (técnica de los guiones 18/19/52): el camino real
   al resume que falla con el neutro repetido.
5. `raf=timer` e `input=scripted`: los del runner.

Ningún `display:none`, ningún estado forzado en el cliente, ningún fichero del árbol tocado salvo los cinco
mutantes y el trinquete en negativo, restaurados con `git checkout` (`git status --short` vacío después).

Traza literal (variante nueva; la base coincide cifra a cifra en los dos contadores):

```
P1 título:            resetWorld=0 cerrarDialogo=0 · pv=[]
P1 nueva partida:     resetWorld=1 cerrarDialogo=1 · tiles=1 · pv=[{"" → 1788720702-b9f03f, aplica:true} ×2]
P1 3 s después:       resetWorld=1 cerrarDialogo=1
P2 título:            0/0
P2 resume fallido:    0/0 · «No se pudo reanudar la partida. Esa partida guardada ya no está en el disco.» · pv=[{"" → "", aplica:false} ×2]
P2 nueva partida P2:  1/1 · pv=[{"" → 1788720708-a8d445, aplica:true} ×2]
P3 reanudar P2:       1/1 · tiles=1 · pv=[{"" → 1788720708-a8d445, aplica:true} ×2]
P4 enter(A), muro:    1/1 · «La partida no pudo empezar» · pv=[{"" → 1788720714-2da971, aplica:true} ×2]
P4 «Volver al título»: 2/2 · pv=[{1788720714-2da971 → "", aplica:true} ×2]
```

Capturas en el scratchpad: `pv-{nueva,base}-1-p1-en-marcha.png`, `-2-resume-fallido.png`, `-3-p2-reanudada.png`,
`-4-muro.png`, `-4b-vuelta-al-titulo.png`.

## 5 · Guion ejecutable: por qué esta vez no hay uno nuevo en `qa/guiones/`

Lo mecánico de esta PR es «cuántas veces se llama a `resetWorld()`/`cerrarDialogo()` por transición», y eso NO
es observable desde `window.__nefan` sin instrumentar `main.ts` (regla 2-3 del README: los asertos van contra el
hook, no contra código inyectado). Lo que SÍ es observable en el flujo real —el mundo a cero y la sesión vacía tras
un fallo, el título de vuelta con su motivo, el mundo repuesto al reanudar— ya lo afirman los guiones 20 (`A → ""`
deja el cliente como antes de empezar), 27, 46, 48 y 60, todos en verde sin retocar. Y ninguno de esos guiones
podría ponerse ROJO quitando `porValor`: en todo camino alcanzable el mundo ya está vacío cuando el sink vacía
(§2), así que un guion nuevo aquí sería un verde que no comprueba nada. La especificación ejecutable de este cambio
son los cinco tests de core (que sí se ponen rojos, §2) más el suelo 100 de mutación del módulo. Si algún día se
quiere medir el recuento desde el banco, el camino honesto es el que ya dicta el README: que el juego lo RECUERDE
(`__nefan` con un contador de vaciados), no una sonda que parchee el fuente. No lo propongo como hallazgo: hoy
no hay ningún camino en que ese número distinga un cliente sano de uno roto.

## 6 · Batería completa

`node qa/run.mjs` entero sobre `cff03aff`, sin retocar ningún guion, con mi stack del 600 parado antes
(`✅ stack cleaned`) y ninguna otra corrida de `qa/run.mjs` en la máquina (`pgrep` vacío); el runner eligió el
bloque +100 solo:
```
79 en verde · 1 en rojo de 80 · capturas en /home/al/code/ne-fan-358-pv-qa/qa/capturas/2026-09-06T18-57-06-913Z-349586
✘ 80-el-desplegable-room-dice-lo-que-se-ve
    · …ni deja una entrada de error — 4 → 5
bateria_exit=1
```
Los otros 79 en verde, incluidos los diez de la red del ingeniero (20, 27, 37, 41, 48, 69, 70, 71, 77, 78), el 75
(intermitente en los cortes 1 y 4) y el 81 (el guion de qa-4). El 80 **no es de esta PR** —es el selector de
fixtures (`sinMotor`), y el commit no toca `fixtures-del-selector.ts`, el panel de errores ni nada que el guion
lea— y lo medí en vez de suponerlo: solo, sobre el mismo árbol, `✔ 80 · 1 en verde · 0 en rojo de 1` (capturas
`…T19-05-00-449Z-361877`). Es exactamente el rojo que qa-4 vio en la batería larga del corte 4 (mismo aserto,
mismo «4 → 5»): una entrada asíncrona del guion anterior o del stack cae en la ventana en que el bloque
«-- Room --» afirma que el contador no sube. Sigue siendo para el backlog de intermitentes del coordinador, y ya
van dos tandas seguidas. `ss -ltn` después de todo: solo 22/53/80/631/3636; `git status --short`: solo este
fichero.

## 7 · No probado, y por qué

- **«El mismo id dos veces sin `leave()`»** en el cliente: no hay camino (fila 5 de §1, leído en `main.ts`
  `:1654`, `:1690`, `:1703`, `:1786`). Cubierto por los tests 1 y 5 y por Stryker, no por navegador.
- **P1 → título → P2 en la MISMA página con P1 arrancada**: no hay camino — el título solo vuelve con el mundo
  vacío (`status-rotulo.ts:120`: `salida = ctx.mundoVacio ? "volver-al-titulo" : "cerrar"`). Lo más cerca que
  llega el jugador es la página 4 (`enter(A)` sin tile → muro → volver), medida.
- **Un diálogo ABIERTO al cambiar de sesión**: no hay camino (el muro con salida al título no se abre con un
  diálogo delante; el catch ocurre antes de que haya escena). `cerrarDialogo()` desde el sink siempre cierra un
  panel cerrado hoy, igual que en la base.
- **CI**: la brecha «+0,6 puntos de cobertura» de la nota del umbral no se ha medido hoy; H2 lo dice.
- **La base `95773fb0` en ejecución**: medida por reinyección de sus dos sinks literales sobre el mismo árbol
  (workaround 2), no con un checkout de la base; el resto del cliente es idéntico en los dos commits salvo esos
  dos sinks y los comentarios (`git diff --stat`: cuatro ficheros).
- Gasto real de créditos: el banco es el motor falso.
