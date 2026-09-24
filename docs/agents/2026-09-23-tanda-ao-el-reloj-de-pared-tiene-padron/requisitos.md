# Requisitos — tanda AO: un padrón por AST de relojes de pared en los guiones (#711)

## Petición literal del usuario

> «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## El issue, verbatim

### #711

> La cura del guion 93 (velocidad contra el reloj de sim) no tiene candado en npm test: hace falta un padrón por AST de relojes de pared en los guiones
> 
> Sale de la QA de la tanda W (#679, PR #710, 2026-09-21), hallazgo H-1.
> 
> ## El hecho
> 
> `medirVelocidad` del guion 93 mide ahora Δpos/Δsim (reloj de simulación) y la ventana va en segundos de sim. Está demostrado con el reproductor (`bajo-carga.mjs 93 --factor 40`: antes `se-rompio`, después `igual-verde` con error 0,000 %). Pero **si alguien devuelve el denominador al timestamp del `rAF` (pared), nada se pone rojo en `npm test`**: solo lo vería el reproductor bajo carga, que es una corrida manual de ~20 min.
> 
> La vía que la tanda RETIRÓ (leer el cuerpo de `run.mjs` con `new Function` desde `carga-sintetica.test.ts`) no es la que hay que reponer. Lo que la casa usa para guiones es el **padrón por AST** (`esperas-que-conducen.json`, `espera-de-fotogramas-con-dueno`, `sondas-de-movimiento.json`).
> 
> ## Lo que hay que hacer
> 
> Un padrón de RELOJES DE PARED en `qa/guiones/**`: por el árbol, no por regex (la forma real es `const tick = (t) => …; requestAnimationFrame(tick)`, y un `Date.now()` dentro de un `evaluate` es otra grafía del mismo sujeto). Medido hoy: callbacks de `rAF` con parámetro declarado → **0 ocupantes** (el 93 ya no lo usa); `performance.now`/`Date.now` → **5 guiones legítimos** (07, 10, 109, 131, 133) que se declaran con su motivo. Probado en negativo con el denominador del 93 devuelto a la pared → rojo. Con `_lo_que_esto_NO_sujeta` y su `it`.
> 
> Aparte, pre-existente: import muerto `razonDeLaMedida` en `qa/bajo-carga.mjs:134` (`eslint` no mira `qa/`).
> 
> Relacionado: #679, #545, #606.

## Criterios de aceptación

1. Un candado en `npm test`, por el ÁRBOL (no regex), que censa los relojes de pared en `qa/guiones/**` (callbacks de `requestAnimationFrame` con parámetro de tiempo, `performance.now`, `Date.now`, en cualquier grafía que el censo declare ver) usando `fuentesDelBanco` de `banco-ficheros.ts` (#704), con padrón `data/contract/*.json` de los legítimos y su motivo.
2. Probado en negativo: devolver el denominador de `medirVelocidad` del guion 93 al timestamp del rAF (pared) → rojo en `npm test`.
3. `_lo_que_esto_NO_sujeta` medido (costumbre del repo), cada punto con su `it`.
4. Cifras de hoy MEDIDAS hoy (el issue dice 0 rAF con parámetro y 5 guiones con performance.now/Date.now — verificar, no copiar).
5. El import muerto `razonDeLaMedida` en `qa/bajo-carga.mjs` se retira si sigue ahí.

## Contexto del coordinador

- Worktree `/home/al/code/ne-fan-tanda-ao`, rama `feature/tanda-ao`, nacida de `main` = `95a66594`. Todo el trabajo va ahí.
- Hoy se fusionaron #709 (ruff en verify), #716 (detector de saltos), #700 (anclas), #704 (UN barrido del banco: `nefan-core/test/banco-ficheros.ts` + candado `un-solo-barrido-del-banco` que prohíbe recorrer `qa/` por su cuenta desde `test/`). En vuelo: #697 (reporter de suites que lanzan, PR #726) y #714 (atlas de vecinos). La tanda hermana de esta ola es: AO #711 / AP #693+#694.
- Nunca matar procesos ajenos; `qa/run.mjs` elige bloque libre. Cero créditos (motor falso). Worktree sin node_modules: `npm ci` en nefan-core, narrative-mcp (y nefan-html/qa si hace falta).
- Commits intermedios en la rama. Números de guion reservados: AO 167, AP 168; QA: AO 169, AP 170.

## Fuera de alcance

- Lo que el issue declara fuera. Vecinos que aparezcan: se ANOTAN, no se arreglan.

## Precisiones del crítico (VIGENTE), incorporadas por el coordinador


> **Nota del crítico al criterio 4 (cifras del issue, verificadas el 2026-09-23):** callbacks de `requestAnimationFrame` con parámetro = 0 (confirmado). `performance.now`/`Date.now` por el ÁRBOL: **07, 10, 131, 133, 157, 164** (6, no 5). **109 NO es ocupante**: su único acierto es un comentario (`109:276`) y no debe entrar en el padrón. 157 y 164 nacieron después del issue. Los REEMPLAZOS de la función (`window.requestAnimationFrame = (cb) => …` en 133, `= () => 0` en 131/132) no son callbacks y el censo no debe contarlos.
>
> **Añadido al criterio 3:** `_lo_que_esto_NO_sujeta` declara, medido, que `qa/lib/**` queda fuera (hoy 27 usos en 6 ficheros), y dice si el censo ve o no el alias de `requestAnimationFrame`, la forma `window.requestAnimationFrame(…)` y el callback nombrado por identificador (la regresión exacta del 93 lo usa, así que ese último tiene que verse).
