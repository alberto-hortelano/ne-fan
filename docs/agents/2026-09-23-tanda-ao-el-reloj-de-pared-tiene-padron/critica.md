**VIGENTE** — el problema es real y la tarea lo ataca bien; solo las cifras del issue han envejecido (en las dos direcciones), y el criterio 4 ya obliga a medirlas.

## El problema real, en una frase

Si alguien devuelve el denominador de `medirVelocidad` del guion 93 al reloj de pared, `npm test` sigue verde y solo lo caza una corrida manual de ~20 min bajo carga. La solución propuesta (padrón por AST de relojes de pared en `qa/guiones/**`) ataca eso y además cubre el guion siguiente que cometa el mismo error, que es la forma en que la casa ya resuelve esta clase de sujeto (`esperas-que-conducen.json`, `sondas-de-movimiento.json`, `saltos-sin-observar.json`).

## La premisa, afirmación por afirmación

- **«El 93 mide contra el reloj de sim»**: cierto. `qa/guiones/93-la-velocidad-y-el-alcance-los-dice-el-config.mjs:289-297`: `const tick = () => { … out.push([reloj.sim, p.x, p.z]) … requestAnimationFrame(tick) }`. Callback SIN parámetro.
- **«Nada se pone rojo en npm test si vuelve a la pared»**: cierto. Ningún test de `nefan-core/test/` lee el cuerpo del 93, y no hay padrón de relojes en `nefan-core/data/contract/` (solo `esperas-de-tile`, `esperas-por-fotogramas`, `esperas-que-conducen`, `saltos-sin-observar`, `sondas-de-movimiento`).
- **«Callbacks de rAF con parámetro → 0 ocupantes»**: cierto hoy. Las llamadas vivas a `requestAnimationFrame` en `qa/guiones/` son `137:31`, `119:225`, `93:295/297/365`: todas con callbacks sin parámetro. **Ojo**: `133:299` (`window.requestAnimationFrame = (cb) => …`) y `131:171`/`132:148` (`= () => 0`) son REEMPLAZOS de la función, no callbacks pasados a ella; el censo tiene que distinguirlos o nace con un falso ocupante.
- **«`performance.now`/`Date.now` → 5 guiones (07, 10, 109, 131, 133)»**: **falso en las dos direcciones**.
  - **109 sobra**: su único acierto textual es un COMENTARIO (`109:276`). Por el árbol tiene 0 ocupantes; declararlo en el padrón sería una entrada muerta desde el día uno.
  - **Faltan 157 y 164**, nacidos después del issue: `157:99,103` (`performance.now()` para cronometrar la llegada de un tile) y `164:99,102` (`Date.now()` en Node, midiendo un subproceso).
  - Recuento textual de hoy: 07, 10, 131, 133, 157, 164 (+109 en comentario). Por el árbol se esperan **6**. `131:64,81` también son comentarios, pero 131 tiene código vivo (`:84`, `:89`).
- **«El import `razonDeLaMedida` de `qa/bajo-carga.mjs:134` está muerto»**: cierto. Aparece una sola vez en el fichero, en la lista del import.
- **`fuentesDelBanco` existe** (`nefan-core/test/banco-ficheros.ts:127`), así que el criterio 1 se puede cumplir sin chocar con el candado `un-solo-barrido-del-banco` (#704).

## El día después

- Para quien juega: nada. Es deuda de verificación declarada (sale de la QA de #679), así que es legítimo.
- Lo que se vuelve más difícil: todo guion nuevo que cronometre con `Date.now`/`performance.now`, aunque sea para un timeout o para medir un subproceso (el caso de 164), tiene que entrar en el padrón con su motivo. En dos días han nacido dos (157, 164), así que el padrón tendrá ese roce. Es el precio buscado: la pregunta «¿esto mide el juego contra la pared?» se hace al escribir el guion.
- Lo que parecerá arbitrario dentro de un mes: que el censo mire `qa/guiones/**` y no `qa/lib/`, donde hay **27** usos de `Date.now`/`performance.now` en 6 ficheros (`puertos`, `cable`, `sesion`, `sonda`, `carga`, `saves`). Si `medirVelocidad` se muda a un helper de `qa/lib`, el candado queda ciego. Eso tiene que figurar en `_lo_que_esto_NO_sujeta` y medirse, no callarse.
- Formas que el censo tiene que declarar si las ve o no (lección de #686, los alias): `window.requestAnimationFrame(tick)` (miembro), un alias (`const raf = requestAnimationFrame`) y el callback nombrado por identificador (`const tick = (t) => …; requestAnimationFrame(tick)`, que es justo la regresión del 93 y obliga a resolver el identificador hasta su declaración).

## Conflictos

- **#720** (trocear `test/saltos-del-guion.ts`, 860 líneas): si el detector nuevo se cuelga de ese módulo, lo engorda antes del troceo. No hay contradicción; basta con no crecerlo.
- **PR #726** (#697, suites que lanzan): es ortogonal. Un padrón cuyo test lanza al cargar tiene que salir rojo, y #726 es lo que lo garantiza.
- **#723** (tablas `rompe` que solo se cuentan al correrlas): es vecino, no solapa.
- Ninguna decisión de `CLAUDE.md` en contra: la tarea es la forma que el propio `CLAUDE.md` prescribe («candado, no prosa»).

## Coste contra valor

El coste es bajo: un detector por AST más un JSON, con el esqueleto ya hecho en tres padrones hermanos. El valor está acotado pero es real: convierte en verde/rojo de CI una cura que hoy solo defiende una corrida de 20 min que nadie lanza por rutina. Si no se hace nunca, la cura del 93 depende de la memoria, y el 93 ya cayó en ese error una vez.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

> **Nota del crítico al criterio 4 (cifras del issue, verificadas el 2026-09-23):** callbacks de `requestAnimationFrame` con parámetro = 0 (confirmado). `performance.now`/`Date.now` por el ÁRBOL: **07, 10, 131, 133, 157, 164** (6, no 5). **109 NO es ocupante**: su único acierto es un comentario (`109:276`) y no debe entrar en el padrón. 157 y 164 nacieron después del issue. Los REEMPLAZOS de la función (`window.requestAnimationFrame = (cb) => …` en 133, `= () => 0` en 131/132) no son callbacks y el censo no debe contarlos.
>
> **Añadido al criterio 3:** `_lo_que_esto_NO_sujeta` declara, medido, que `qa/lib/**` queda fuera (hoy 27 usos en 6 ficheros), y dice si el censo ve o no el alias de `requestAnimationFrame`, la forma `window.requestAnimationFrame(…)` y el callback nombrado por identificador (la regresión exacta del 93 lo usa, así que ese último tiene que verse).
