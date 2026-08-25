# #231(a) VIGENTE · #231(b) EN CONFLICTO · #248 VIGENTE · #247 REENCUADRADA

Medido sobre `main` `c007e60`; worktree aparte para el contrafactual, árbol de trabajo intacto. Los tres comparten moraleja y nada más: distinto proyecto, distinta herramienta, distinto coste.

# #231 — tipos en `scripts/` y `test/`

**Problema real:** hay aserciones en `test/` que no se ejecutan y nadie se entera; el `include` es el síntoma por el que no se ven.

**La premisa de 2026-08-23, re-medida.** `src+bridge+services` **0** (línea base sana), `scripts/` **0**, `test/` **66 errores en 24 ficheros** (eran 59/21) → **59 reales** con `lib: ES2023` y sin `rootDir` (eran 52). **+7 en 4 tandas y 2 días, ~1,75 por tanda.** Ficheros que antes tipaban y hoy no: `state-http-dispatch` (4), `status-labels` (3), `state-http-caracterizacion` (1) — de #244 y #252. La partición en dos tareas no cambia; lo que cambia es que (b) se encarece sola mientras espera.

**El testigo sigue vivo y encogió a dos tercios.** `test/service-registry.test.ts:22` recorre hoy `["asset-store","remote-gen"]` — `gpu-worker` murió con #199. Las 2 aserciones restantes siguen sin ejecutarse nunca y seguirían fallando (8767/8768 contra `CONFIG.ai_server.port`=8765, verificado ejecutando `CONFIG`). Y las líneas 17-18 del mismo test **ya afirman lo correcto** contra `CONFIG.ports.asset_store`/`remote_gen`: el bucle es redundante *además* de muerto.

**Riesgo de alcance (pregunta 6): confirmado, y peor de lo que dice el issue.** `npm run build` de nefan-core es `tsc` con `declaration`+`composite`+`outDir`, y narrative-mcp hace `tsc -b` con project reference al core (`.github/workflows/ci.yml`). Meter `test/**` en ese `include` (i) rompería el job de narrative-mcp, (ii) falla de BUILD y no solo de `--noEmit`, porque `test/contract-fixtures.test.ts:18` importa `../../narrative-mcp/validators.ts` fuera del `rootDir` (TS6059), y (iii) cierra un ciclo de proyectos. Con `scripts/**` sí compila (0 errores, build 2,78 s) pero emite `dist/scripts/*.js`+`.d.ts`. **Salida: `tsconfig` aparte con `noEmit` para los dos árboles.** Eso NO convierte (a) en una tanda: una línea de config y una de CI.

**El día después · conflicto · coste.** (a) no toca nada de nadie y cierra el agujero por el que pasó `r.rule.message`. (b) sí toca: **19 de los 59 errores reales (32 %) están en `test/volume-metrics.test.ts` (12) y `test/fps-ambience.test.ts` (7)**, y ambos prueban `src/scene/blueprint/` — el módulo que reescribe la tanda **«El bosque es uno solo» (#243 #233 #232)** (`derive.ts`, `volumes`, `collision.ts`, `scene-expand.ts`). Arreglar esos literales de fixture ahora es arreglarlos dos veces. **(b) va detrás del bosque, no a la vez.** Si no se hace nunca, siguen apareciendo aserciones muertas invisibles a razón de dos por tanda.

**Para pegar en el issue:**

> **Re-medido sobre `main` `c007e60` (2026-08-25).** La partición en dos tareas sigue en pie.
> **(a) Ahora:** `scripts/` da **0 errores**. Se hace con un `tsconfig` APARTE (`noEmit`, sin `composite`/`declaration`/`rootDir`) y un paso de CI, **no** ampliando el `include` del tsconfig de build: ese lo consume `tsc -b` desde narrative-mcp y emitiría `dist/scripts/`.
> **(b) Después, y detrás de #243/#233/#232.** `test/` da **66 errores en 24 ficheros** (59 tras `lib: ES2023` y soltar `rootDir`) frente a 59/21 el 23 de agosto: la deuda crece ~2 por tanda. 19 de esos 59 viven en `volume-metrics.test.ts` y `fps-ambience.test.ts`, cuyo sujeto (`src/scene/blueprint/`) reescribe la tanda del bosque.
> **Testigo actualizado:** el bucle muerto de `test/service-registry.test.ts:22` recorre hoy DOS servicios, no tres (`gpu-worker` se fue con #199); sus dos aserciones siguen sin ejecutarse y seguirían fallando, y las líneas 17-18 ya afirman lo correcto: sobra entero.
> **Sigue sin aceptarse `as any` ni baseline de errores tolerados.**

# #248 — `no-floating-promises` en `nefan-html`

**Problema real:** el candado persigue al que declara (`void`) y deja pasar al descuidado, y hoy hay un descuidado vivo en el selector de fixtures.

**Medido (pregunta 2).** `no-floating-promises` sola, con `projectService` acotado a `src/**/*.ts`: **2 violaciones**; lint **1,25 s → 2,03 s** (×1,6, +0,8 s; 3 corridas cada uno). No multiplica por diez: **no hay `max` que congelar, van de golpe.** `recommendedTypeChecked` entero: **40 violaciones**, 2,90 s (18 `no-unnecessary-type-assertion`, 8 `restrict-template-expressions`, **6 `no-misused-promises`**, 5 `no-base-to-string`, 2 NFP, 1 `require-await`) — es otra tarea, y las 6 de `no-misused-promises` merecen issue propio.

**La segunda violación es el ocupante que el issue predijo.** `src/main.ts:1277` (`requestPointerLock()`, rechazo perdido: el cliente no tiene handler de `unhandledrejection`) y **`src/main.ts:1332` `loadSceneFile(value)`** dentro del `change` del selector «Room»: `async function` (`main.ts:679`) llamada **sin `void`, sin `.catch`, sin `paso()`**. Si el módulo de la fixture falla, el selector es un **no-op mudo** — el modo de fallo exacto de #181, en el selector que el preset `html-fixtures` existe para conducir.

**NFP no sustituye a `html-sin-promesa-muda`.** Con `ignoreVoid: true` (defecto) acepta `void p()` sin catch; con `ignoreVoid: false` salen **7 en 5 ficheros**, justo los `void …catch(…)` que la regla declara legítimos. Son complementarias, y los otros dos puntos ciegos del issue (comentario al final de línea, línea que acaba en `)`) **sobreviven a las dos**: llevan `void`, así que NFP no los mira — decirlo en el `why` es parte del trabajo. **Gotcha:** el bloque type-checked hay que acotarlo con `files: ["src/**/*.ts"]`; `vite.config.ts` y `eslint.config.js` están fuera del `include` del tsconfig y un `projectService` global los pone rojos.

**Pregunta 3 — ¿es la misma tarea que #231? No.** #231 es que el compilador **no mira** dos árboles de nefan-core; #248 es que eslint **sí** mira los ficheros pero **sin tipos**, en nefan-html. 2 violaciones contra 59, cero ficheros compartidos. Fusionarlas solo compartiría la moraleja.

**Conflicto · coste.** `src/main.ts` lo toca también **«Reanudar te devuelve donde lo dejaste» (#245 #249)**. No es choque, es motivo de orden: **#248 primero** — con la regla puesta, cualquier promesa suelta que añada esa tanda nace roja, que es para lo que existe. Dos correcciones y +0,8 s de lint: el más barato de los tres y el único con un fallo que hoy ve quien juega. **VIGENTE sin reencuadre**; lo único que cambia es que el issue ya no tiene que elegir entre `recommendedTypeChecked` y la regla suelta, ni congelar un `max`.

# #247 — el guion 15 es una moneda al aire

**Problema real:** no es que el umbral esté mal calibrado; es que **los dos extremos de la comparación son muestras de reloj de pared**, y el hecho categórico que el aserto quiere afirmar ya existe en el sim y nadie lo mira.

**Verificado, y hay más de lo que dice el issue.** `atacarYVer` (`qa/guiones/15-…mjs:133-156`) espera desplazamiento **≥1,5 m** y el aserto pide **>1**; con picos de ~1 m la espera nunca se cumple y decide el cortafuegos de 30 s. **Dos defectos no declarados:** (i) descarta el valor que satisfizo la espera y **vuelve a medir** (línea 152), afirmando sobre un instante posterior; (ii) **`d0` también es una muestra** — `situarse` (89-113) traga su propio timeout de 4 s y sigue con la distancia que haya (9,22 y 9,16 en las dos corridas del issue).

**El precedente existe (pregunta 4)** — `telegraphEpisode`, `nefan-html/src/renderer/fps-gl.ts:488,881,1440` ← `qa/guiones/10-…mjs:74` — y la especie del arreglo es correcta. **Pero es insuficiente en sujeto:** los picos medidos son **0,97 y 1,06 m**, a caballo del umbral de 1. Recordar el máximo quita el jitter de muestreo, **no la moneda**: seguiría decidiéndose por 3 cm. **El sujeto ya viaja por el cable:** `state_update.npcs[].state` (`nefan-core/src/protocol/messages.ts:253`) lleva el modo del FSM (`flee`/`intervene`) y el sim emite `npc_fled_combat`/`npc_intervened` (`src/simulation/npc-behavior.ts:326,332`); el cliente lo tira en `__nefan.npcs()` (`nefan-html/src/main.ts:1116`, solo `{id,label,pos}`).

**Lo que NO debe hacerse: elegir umbral antes de mirar el sim.** Un mercader con `run_speed: 2.8` que huye hacia `perception_radius + 4 = 16 m` y en 30 s avanza 1 m no está huyendo: `npc-behavior.ts` tiene watchdog de atasco (`STUCK_WINDOW_S = 3`, `giveUpMove`, que conserva el modo y suelta el waypoint) y parece acorralado contra geometría. Congelar «pico ≥ 1 m» cementaría eso como comportamiento esperado.

**Pregunta 5 — ¿hay más guiones así? No; hay una regla.** Revisados los 26 `.catch()` sobre esperas de los 20 guiones: en todos los demás (08:79, 08:135, 09:191, 07:256, 11:73, 12:245, 19:254, 20:248) el timeout degrada a `null` y el `expect` siguiente se pone **rojo**. El 15 es el único donde el timeout se convierte en una segunda medida que puede salir verde por azar; no hay lista que enumerar. Lo que sí aparece es **el cuarto caso del patrón de esta tanda, gratis**: `qa-guiones-sin-espera-por-reloj` (`arch-rules.json`, severity `error`) está **verde** sobre el guion 15 — su patrón caza `waitForTimeout(` y `new Promise(setTimeout)`, y un `waitFor` cuya condición no se cumple nunca es un sleep con mejores modales. El candado que prohíbe esperar por reloj no puede ponerse rojo ante la espera por reloj que denuncia #247.

**Para pegar en el issue:**

> **Reencuadre (crítico, 2026-08-25).** El precedente de `telegraphEpisode` existe (`fps-gl.ts:488,881,1440` ← `guiones/10:74`) y la especie es correcta: que el juego RECUERDE. **Pero recordar el desplazamiento máximo no quita la moneda:** los picos medidos sobre `main` son 0,97 y 1,06 m, a caballo del umbral de 1, así que el veredicto seguiría cayendo por 3 cm.
> **El sujeto que falta ya existe:** `state_update.npcs[].state` (`protocol/messages.ts:253`) lleva el modo del FSM (`flee`/`intervene`) y el sim emite `npc_fled_combat`/`npc_intervened` (`simulation/npc-behavior.ts:326,332`); el cliente lo tira en `__nefan.npcs()` (`nefan-html/src/main.ts:1116`).
> **Dos defectos más, no declarados:** `atacarYVer` descarta el valor que satisfizo la espera y vuelve a medir (`guiones/15:152`), y `d0` es otra muestra porque `situarse` (15:89-113) traga su timeout de 4 s. Los DOS extremos de `d1 > d0 + 1` son muestras.
> **Antes de tocar el umbral, mirar el sim:** un mercader a `run_speed 2.8` que huye hacia 16 m y avanza 1 m en 30 s está acorralado (watchdog `STUCK_WINDOW_S = 3` + `giveUpMove`), no huyendo.
> **Se lleva un vecino:** `qa-guiones-sin-espera-por-reloj` está verde sobre este guion; su patrón solo caza el `sleep` literal, no un `waitFor` cuya condición nunca se cumple. **Los otros 19 guiones no tienen el defecto** (su timeout degrada a rojo).

# PARA EL USUARIO

Al verificar #247 aparece que el mercader, ante una pelea a 9 m, se desplaza ~1 m en 30 s con `run_speed: 2.8` y objetivo de fuga a 16 m. O el sim tiene un bug de steering (watchdog de atasco contra geometría), o la huida es así de tímida a propósito. **El guion 15 lleva desde su nacimiento reportando esto y se ha leído como intermitencia del guion.** Si es bug, decides tú si abre issue propio de comportamiento de NPC o entra en la tanda de #247; el aviso queda escrito en el issue para que quien implemente no elija umbral sin mirarlo. La cola no se para por esto.

# Orden propuesto (coste, no dependencia técnica)

`#248` → `#231(a)` → [bosque #243/#233/#232] → `#231(b)` → `#247`. **`#231(b)` no debe entrar en esta tanda:** chocaría de frente con el bosque.
