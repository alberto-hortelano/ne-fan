**#722 VIGENTE · #723 REENCUADRADA (menor de lo que dice en valor, mayor en coste) · #717 VIGENTE, con alcance ampliado**

Crítica sobre `main` f25da654 (2026-09-24). Tres issues de banco, cero jugador: son deuda declarada del instrumento.

## #722 — VIGENTE

**Problema real:** en la corrida completa de `reparto`, un checker rojo sobre el árbol limpio no puede «cambiar» con ningún probe, y el guion lo lee como «nadie lo caza».

**Premisa, verificada:**
- La base se toma y se imprime sin juzgarla: `qa/mutacion-reparto-en-lotes.mjs:679-680`; se compara contra ella en `:698` (`CHECKERS[n]() !== base[n]`). Cierto.
- Los checkers devuelven `"<nombre>:<status>"` (`:358,364,370`); un timeout da `status null` → `"cableado:null"`, que también es base rota y el issue no lo nombra.
- Los tres hermanos se niegan: `mutacion-candados-en-negativo.mjs:366-368`, `contrato-candados-en-negativo.mjs:475-490`, `bateria-candados-en-negativo.mjs:133-147`. Cierto.
- Agravante no dicho: el checker `candados` ES `mutacion-candados-en-negativo.mjs` (`:360-364`), que sale 1 si SU base está roja; o sea, una base roja de candados deja `candados:1` fijo para todo probe.

**El día después:** la corrida completa local (~11-16 min, no la corre CI: `ci.yml:279` es `--solo-vigentes`, y ese modo no llega al bloque de `:676`) deja de inventar «SIN CANDADO». Nada se cierra. Alcance real: pequeño y solo local.

**De las dos propuestas del issue, la negativa.** «Marcar como sin medida» abre un cuarto estado en `clasifica` que ningún hermano tiene; no lo hagas.

## #723 — REENCUADRADA

**Problema real:** un ancla movida por una PR se descubre en el job `candados-headless` de CI, minutos después, y no en el `npm test` / `verify` local.

**Premisa, afirmación por afirmación:**
- «Solo `invariantes-en-negativo.mjs` se cuenta en `npm test`»: cierto, `nefan-core/test/las-anclas-de-los-candados.test.ts:40`.
- «Las demás se cuentan cuando el guion corre»: cierto, y **corren en CADA PR**: `ci.yml:299` (candados), `:305` (cableado), `:317` (contrato), y los ABIERTOS de reparto se cuentan en `:279` con `--solo-vigentes` desde #700 (pre-vuelo `reparto:655-664`, candado por el guion 164). Los tres primeros salen ≠0 con un patrón obsoleto (`candados:378-383`+`exit(ok?0:1)`, `contrato:499`, `cableado:822`+`:865`). **No hay ancla que se pudra sin que CI se ponga rojo**: lo que falta es solo latencia del bucle local.
- «Sacar cada TABLA a `qa/lib/`»: **mayor de lo que dice**. `cableado` (`:254`, 20 entradas) y `reparto` (`:374`, 10 ABIERTOS) no son tablas de datos: cada entrada lleva cierres (`mira`, `bien`, `quiere`) que llaman a helpers locales del guion (`siembraInforme`, `manifiesta`, `mutacion`, `cableado:257-260`). Mover la tabla entera arrastra el arnés a `qa/lib`; mover solo `rompe` parte cada invariante en dos ficheros. `candados` (`:56`) y `contrato` (`:118`) sí son tuplas de datos, pero `candados:88` tiene `buscar = null` (fichero entero), que `aplicarPares` rechaza con `TypeError` (`anclas.mjs:47-49`): hay que excluirla, no «contarla».
- **Tabla que el issue no nombra:** `qa/guiones/148-el-banco-del-cliente-puede-ponerse-rojo.mjs:97` (`SABOTAJES`) sustituye con `aplicarPares` (`:220`) y tampoco se cuenta en `npm test`.
- «`aplicarPares(t, [])` → ok en silencio»: cierto (`anclas.mjs:42-56`, el bucle no entra). Ningún llamador lo pasa hoy vacío (`bateria:156`, `contrato:499`, los demás con `[[b,p]]` literal), así que lanzar no rompe nada vivo.

**El día después:** el mismo rojo que hoy da CI sale antes, en local. A cambio, dos guiones con los datos lejos de su lógica, y más superficie en `qa/lib` (cada fichero nuevo exige importador: `banco-medido.json`; lo cumple el propio test).

**Coste contra valor:** el menor (`[]` lanza) es barato y vale. Las tablas de datos puros (`candados` sin su entrada `null`, `contrato`, y el 148 si su forma lo permite) valen su coste. `cableado` y `reparto` **no** valen partirse por latencia: ya están en CI, y reparto ya tiene pre-vuelo. No hacerlo nunca con esos dos es legítimo.

## #717 — VIGENTE, más ancho

**Problema real:** un guion Python del banco no arranca desde un worktree de tanda sin `NEFAN_PYTHON` a mano, y dos copias de la regla divergen sin que nada las compare.

**Premisa:**
- JS sin paso de common-dir: `qa/lib/python.mjs:28-41`. Bash con él: `ai_server/lint.sh:40-42`. Cierto; y este mismo worktree no tiene `.venv` (common-dir = `/home/al/code/ne-fan/.git`).
- **Divergencia que el issue no ve:** `NEFAN_PYTHON` en bash admite un nombre del PATH (`lint.sh:32-33`, `command -v`); en JS exige ruta existente (`python.mjs:34`). `NEFAN_PYTHON=python3` pasa en `lint.sh` y lanza en el banco. Y bash pide `-x`, JS solo `existsSync`. La paridad tiene que cubrir la variable, no solo el common-dir.
- «Coordinarlo con #704»: #704 cerrada el 2026-09-23 18:56. Sin bloqueo.
- Consumidores: `qa/el-ledger-…:89`, `qa/el-npc-cruza-…:88`, `qa/sprites-sin-servicio.mjs:78`; test `nefan-core/test/qa-lib-python.test.ts`. Precedente de paridad: `port-offset-paridad.test.ts`.
- Tercera copia fuera de alcance: `start.sh:459,604` usa solo el `.venv` del árbol. No meterla aquí (arranca servicios, no es el banco); nómbrala en lo que no se cubre.

**El día después:** el banco Python corre desde cualquier worktree sin variable. Si se elige «`lint.sh --interprete` como única fuente», el guion 162 copia `ai_server/` a un temporal fuera de git (`162:33`): ahí el paso de common-dir no existe, y debe seguir funcionando.

## Conflictos

- **Tanda AY (lint de `qa/`/`labs/`)**, medido en su worktree: toca `qa/mutacion-reparto-en-lotes.mjs:612` (`let anclasRotas;`), `qa/lib/carga.mjs`, `qa/lib/stack.mjs` y `nefan-core/eslint.qa.config.js`, donde enciende `no-useless-assignment` y `preserve-caught-error`. No toca `anclas.mjs`, `python.mjs`, los otros tres guiones en negativo, el 148 ni los tests de BC. **Solape textual: una línea de reparto, en otro hunk que #722 (`:676-700`)**: rebase trivial. **Solape de regla, el que muerde:** todo `.mjs` que BC escriba (tabla nueva en `qa/lib`, la negativa de base) tendrá que pasar las dos reglas nuevas cuando AY entre (`let x = ""` pisado en un `try`; `throw` en `catch` sin `{ cause }`). Quien fusione segundo rebasa y corre `lint:qa` con la config de AY.
- AZ toca `qa/lib/cable.mjs`/`sesion.mjs`: sin solape. Ninguna decisión de `CLAUDE.md` ni candado de `arch-rules.json` en contra (dirección test → banco respetada).

## Criterios de aceptación

1. **#722:** con un checker cuyo status sobre el árbol limpio no sea `0` (incluido `null`), `reparto` sin `--solo-vigentes` sale ≠0 ANTES del primer probe, nombrando el checker, y sin imprimir ningún «SIN CANDADO». Probado en negativo (un checker saboteado a rojo en limpio) y restaurado byte a byte. `--solo-vigentes` no cambia de conducta (guion 164 sigue verde).
2. **#723 menor:** `aplicarPares(t, [])` lanza, con test que lo exija; los llamadores vivos siguen verdes.
3. **#723 tablas:** cada tabla contada en `npm test` es el MISMO objeto que consume su guion (no una copia); el test se pone rojo con un ancla ausente y con una duplicada en cada tabla nueva (medido). Las entradas `buscar = null` se excluyen con motivo escrito. Lo que quede fuera (previsiblemente `cableado` y `reparto`) se declara en el test con su razón: «ya lo cuenta CI en `ci.yml:<línea>`».
4. **#717:** una tabla de casos la comen JS y bash con el mismo veredicto (intérprete elegido o fallo): variable ausente/vacía/ruta/nombre de PATH, `.venv` propio, `.venv` del common-dir, ninguno. Rojo probado quitando el paso de common-dir de una de las dos. Y un guion Python del banco arranca desde este worktree SIN `NEFAN_PYTHON`.
5. Cero créditos; guiones solo en 202-205 si hacen falta.

## Qué le cambiaría a `requisitos.md`

> **#723, alcance corregido:** las cuatro tablas ya se cuentan en cada PR (`ci.yml:279,299,305,317`); lo que se gana es adelantar el rojo al `npm test` local. Se cuentan en `npm test` las tablas que son DATOS (`mutacion-candados`, sin su entrada `buscar=null`; `contrato-candados`; y `SABOTAJES` del guion 148, que el issue no nombraba). `cableado` y los ABIERTOS de `reparto` llevan cierres atados al arnés: no se mueven a `qa/lib`, y el test declara por qué y dónde los cuenta CI. El menor (`aplicarPares(t, [])` lanza) entra.
>
> **#717, alcance ampliado:** la paridad cubre también `NEFAN_PYTHON` (bash acepta un nombre del PATH, JS solo una ruta), no solo el paso de common-dir. `start.sh` queda fuera y se nombra.
>
> **#722:** la negativa de los hermanos, no el estado «sin medida». Base sana = status `0` en todos los checkers (`null` cuenta como rojo).
>
> **Coordinación con AY:** el código nuevo en `qa/` pasa `no-useless-assignment` y `preserve-caught-error`; rebasar sobre AY si entra antes.
