# QA — tanda AE (#611) · «una exención no se cree: se deriva, o caduca» · 2026-09-20

Rama `feature/tanda-ae-la-exencion-se-deriva-o-caduca`, commit `ecc40ae0`, worktree
`/home/al/code/ne-fan-tanda-ae-la-exencion-se-deriva-o-caduca`. Árbol limpio al empezar y al acabar
(`git status --short` vacío tras cada sabotaje; cada uno restaurado con `git checkout --`). Todo
sin créditos (`e2e-sin-creditos`, «censo de gasto · 0 guion(es) tocaron alguna puerta» en las tres
corridas). Ningún proceso ajeno tocado; el stack del 80 (bloque +300) quedó parado.

## Criterios → veredicto → evidencia

| # | Criterio (de `requisitos.md`, con el reencuadre y las decisiones del coordinador) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Elección derivar/caducar escrita y tomada: DERIVAR por clase, SIN caducidad; `issue` se sujeta con el issue ABIERTO | ✅ | `critica.md` §«Por qué derivar y no caducar»; los dos contratos llevan `clases` + `clase`; no hay ninguna fecha en ninguno (`grep -n fecha` sobre los dos JSON: 0) |
| 2a | Implementado en `esperas-que-conducen.json` + su test: `clase` derivada del PREDICADO (inline o por referencia), mapa clase → lectura del hook, cada nombre existe en `nefan-hook.ts` | ✅ | `node --import tsx --test test/esperas-que-conducen.test.ts` → 12 ✔; el 133b (`TRAZA` por referencia) deriva `game loop` leyendo además `state().pos` (regla positiva, caso en el test); sabotaje (ii) `scene`→`escena` → 2 rojos («EXISTE en el hook» + derivación) |
| 2b | Hermano `esperas-por-fotogramas.json` al mismo listón: zod `.strict()`, `_lo_que_esto_NO_sujeta` obligatorio, `desc` literal como clave, `linea_orientativa` fuera, clases `derivada`/`declarada` | ✅ | `test/espera-de-fotogramas-con-dueno.test.ts` → 10 ✔; `delete _lo_que_esto_NO_sujeta` y `linea_orientativa: 69` rechazados por el zod (caso del test); `grep linea_orientativa` en contratos = 0 |
| 2c | Clave `fichero :: desc` en el hermano: un `desc` cambiado de una letra deja la exención SIN sujeto y en ROJO | ✅ | Contrato: «60 fotogramas» → «61» → **2 rojos** (`NIVEL CENSO` + `CADUCA`), 8 ✔ 2 ✖. Guion 69: «basura» → «basuras» → los mismos 2 rojos. Restaurados |
| 2d | Derivación del hermano: `cortafuegos mayor` ⇔ pared > `CORTAFUEGOS_MS`; `conducida en sim` ⇔ `{sim}` | ✅ | 69 con `30_000` → `20_000` (= `CORTAFUEGOS_MS`, ya no es mayor) → rojo «pared 20000 no es mayor que CORTAFUEGOS_MS=20000». Sabotaje (iii) 69 → «conducida en sim» → rojo «el sitio no lleva `{sim}`» |
| 3 | La MENTIRA ELABORADA N17b (58 `{sim:120}` → `{ms:120_000}` + exención «bridge» de prosa plausible), que daba 7·0, se pone ROJA | ✅ | Reproducida en el árbol en dos pasos. Sin exención: rojo «ningún guion conduce… con PARED» (11 ✔ 1 ✖). Con la exención «bridge» de 380 caracteres añadida al contrato: rojo **«58…:181 declara «bridge» (exige leer scene) y su predicado lee frontier»** (11 ✔ 1 ✖). Restaurados 58 y contrato |
| 4 | Las honestas siguen sin reescribirse; la del 80, agotada, se va y el 80 pasa a `{sim}` | ✅ | `diff` de los `porque` entre `a25d8c2f` y HEAD: en conducen solo desaparece la del 80; en el hermano **cero** cambios de `porque`. `80:122` `{ ms: 15_000 }` → `{ sim: 8 }` (única línea del diff del 80) |
| 4b | El 80 con `{sim: 8}` es la espera correcta y no un presupuesto a ojo; tres corridas aisladas | ✅ | El predicado lee `window.__nefan.playerPos` y pide ≥ 0,4 m con `tecla: "up"`: el sujeto ES el mundo, así que el reloj correcto es sim. `walk_speed` 1,9 m/s (`combat_config.json:207`) → ~0,2 s de sim para 0,4 m; `8` es la MISMA cifra que la casa usa para 0,5 m en `fixtures-las-tres-se-caminan.mjs:95`, no una inventada. `node qa/run.mjs 80` ×3 aislado, 12:52:08 / :16 / :24, load 9,3–11,7: **3/3 verde**, «✔ ocurre: el jugador anda 0.4 m» en las tres (`scratchpad/tanda-ae-80.log`) |
| 5 | `_lo_que_esto_NO_sujeta` obligatorio en los DOS, dice lo que sigue abierto y **se mide** (al menos: lectura muerta, alias fuera #686, clase no derivable del hermano) | ❌ | Los tres mínimos están y se miden (casos (1)(2)(3) en conducen; «INDISTINGUIBLE» en el hermano). **Pero dos agujeros por los que pasa una mentira NUEVA no están declarados ni medidos**, y uno de ellos contradice una frase del propio `_comment` («apunta a UNA y no ciega el fichero entero»). Ver hallazgos H-1 y H-2 |
| 6 | Capas de forma RETIRADAS (regex de proceso, veinte palabras, tirada de ocho, campo `sujeto`, `linea_orientativa`), sin rastro | ✅ | `grep -rn 'linea_orientativa\|veinte palabras\|tirada de ocho\|"sujeto"'` en `test/`, `data/contract/`, `qa/`, `docs/arquitectura/`: solo quedan las menciones que CUENTAN la retirada (docblocks, `_comment`, README) y un aserto «no vuelve». `qa/el-borrado-pregunta-a-antes.mjs:161` es otra cosa (variable de un plan de mutación). `esperas-candados-en-negativo.mjs:283` (`hallazgo-motivo-elaborado`) es de `quejaDelMotivo` de `absorbe` (#261), no del contrato: no queda falsa |
| 7 | El headless por issue: verde con #673 abierto y ROJO (nunca ⊘) en sus cuatro formas | ✅ | Verde: «control · #545 → closed ✔ / ✔ #673 open», 0,86 s, salida 0. Rojos, salida **1** los cuatro: `issue: 673` → `545` → «…por #545, que está CERRADO: la exención caducó»; PATH sin `gh` → «spawnSync gh ENOENT»; `gh` falso que sale 4 → «`gh api` salió 4 consultando #545: … set the GH_TOKEN…»; `gh` falso que contesta `open` a todo → «el control positivo falla: #545 debería leerse `closed`» |
| 8 | El paso nuevo del `ci.yml` está sujeto por `candados-headless-totalidad` | ✅ | Con el paso: 18 ✔. Quitadas sus 3 líneas (`- run:` + `env:` + `GH_TOKEN`): **2 rojos** («ejecutables de qa/ que no corre nadie: la-exencion-por-issue-tiene-issue-vivo.mjs» + «el verde depende del yml REAL»). Restaurado. `ci.yml` no declara `permissions:`, así que `github.token` conserva el `issues: read` por defecto |
| 9 | Los cuatro sabotajes de `contrato-candados-en-negativo.mjs esperas` nacen rojos | ⚠️ / ✅ a mano | El guion se NEGÓ dos veces: «⊘ NO SE TOMA EL TURNO: otra corrida de los candados EN MARCHA (pid 157634)» — es `mutacion-reparto-en-lotes.mjs` de la tanda AC (`/proc/157634/cwd`), y el turno es de máquina por uid (`qa/lib/turno-exclusivo.mjs:34`, #572): legítimo, ajeno, no se toca. Los cuatro sabotajes se aplicaron A MANO con el mismo `sed` que hace el guion, cada uno rojo: (i) 43 `motor`→`bridge` → derivación roja; (ii) `scene`→`escena` → 2 rojos; (iii) 69 → «conducida en sim» → rojo; (iv) 15 sin `issue` → el zod de MÓDULO tira el fichero, `ℹ fail 1`, salida 1. Pendiente ver el guion en verde con el turno libre (última hora de esta sesión, abajo) |
| 10 | El `parse` fuera del `describe` (desviación 3): el hallazgo del ingeniero es cierto | ✅ | Reproducido en `scratchpad/repro/a.test.mjs` con node v24.11.1: `describe(() => { throw })` → «✖ suite que lanza», `tests 0 · fail 0`, **salida 0**. A nivel de módulo: `fail 1`. Sin esa subida el sabotaje (iv) habría salido verde |
| 11 | Suite entera de `nefan-core` (arquitectura, `banco-medido` con `qa/lib/fotogramas.mjs` importado desde test, headless nuevo) | ✅ | `npm test` sobre el árbol limpio: **3127 tests · 3127 pass · 0 fail**, salida 0 (`scratchpad/npm-test.log`) |

**Cierre de sesión (13:1x):** el guion `contrato-candados-en-negativo.mjs esperas` se reintentó tres
veces y las tres devolvió `⊘ NO SE TOMA EL TURNO` (salida 3) por el pid 157634 de la tanda AC, que
seguía vivo tras 11 min. No se esperó más: los cuatro sabotajes están verificados a mano (fila 9) y
el coordinador puede lanzarlo en cuanto el turno quede libre. Árbol limpio salvo `qa.md` y
`qa-adversarial.ts` de esta carpeta.

## Hallazgos

### H-1 · BLOQUEANTE (criterio 5) — la clave `fichero :: desc` no apunta a UNA: cubre todas las que compartan texto, y la derivación solo mira la última

**Reproducción** (desde el árbol limpio):
1. En `qa/guiones/05-terreno-desde-ground.mjs`, insertar ANTES del primer `holdUntil` (línea 181):
   `await ctx.holdUntil("up", "el jugador entra en el tile recién generado", () => window.__nefan.frontier.proposal ?? null, { ms: 120_000 }, null);`
   — una espera que CONDUCE, en PARED, cuyo predicado lee `frontier` (el cliente), bajo el mismo
   `desc` que la exención honesta «bridge» del 05.
2. `cd nefan-core && node --import tsx --test test/esperas-que-conducen.test.ts` → **12 ✔ · 0 ✖**.

Es la mentira de N17b entera (pared + sujeto falso) pasando en verde, sin tocar el contrato. Por
qué: `exentos.has(clave(e))` exime a TODAS las esperas con esa clave (`:322`), y
`porClave = new Map(encontradas.map(…))` (`:342`) se queda con la ÚLTIMA, que es la honesta; la
derivación nunca ve la mentirosa. El `_comment` del contrato afirma lo contrario («apunta a UNA y no
ciega el fichero entero») y `_lo_que_esto_NO_sujeta` no lo nombra.

**El hermano tiene el mismo agujero** (`espera-de-fotogramas-con-dueno.test.ts:319` y `:356`):
copia del molde `await ctx.waitFor("el renderer emite más frames", (n) => window.__nefan.fps().frames > n + 5, 10_000, 0);`
insertada en `qa/las-fixtures-solo-chocan-con-el-agua.mjs` antes de la línea 200 → **10 ✔ · 0 ✖**:
una copia prohibida del molde entra en el banco tapada por una exención que no la nombra.

Lo que esperaba el requisito: una exención = una espera. La salida más barata es que el detector se
niegue a dos esperas con la misma clave en el mismo fichero (rojo con las dos líneas), o que la
derivación cruce TODAS las coincidencias y no la última. Si se decide no cerrarlo hoy, va a
`_lo_que_esto_NO_sujeta` con su caso medido y se corrige la frase del `_comment`.

### H-2 · IMPORTANTE (criterio 5) — el predicado por referencia se resuelve por NOMBRE, último gana y sin ver reasignaciones

`funcionesDelFichero` (`lecturas-del-predicado.ts:34-47`) mete en un `Map` toda función del fichero
por su nombre, de cualquier ámbito, y la última declaración pisa a la anterior; una reasignación
(`pred = …`) no es `VariableDeclaration` y no se ve. Dos mentiras nuevas que DERIVAN `bridge`
(banco `qa-adversarial.ts`, casos C y D):

- **Sombra**: `export default async function (ctx) { const pred = () => window.__nefan.frontier.proposal ?? null; await ctx.holdUntil("up", "anda", pred, 8_000, null); }` seguido, al final del fichero, de `const pred = () => window.__nefan.scene ? true : null;` → `lecturas = ["scene"]`.
- **Reasignación**: `let pred = () => window.__nefan.scene ? true : null; pred = () => window.__nefan.frontier.proposal ?? null;` → `lecturas = ["scene"]`.

La derivación lee una función DISTINTA de la que corre. No está en `_lo_que_esto_NO_sujeta` (el
(2)(3) son alias del hook, otra cosa). Cerrarlo barato: resolver el identificador en el ámbito léxico
de la llamada, o —más barato aún— ponerse rojo si un nombre referenciado está declarado más de una
vez en el fichero o se reasigna.

### H-3 · MENOR — el párrafo (1) «lectura muerta» dice menos de lo que el agujero es

El texto dice «lee `reloj()` y **no usa** el resultado». El agujero real es «cualquier lectura,
usada o no, en cualquier rincón del subárbol del argumento»: casos medidos en `qa-adversarial.ts`
que derivan siendo falsos —

- **A** (la pregunta literal del coordinador): `() => (window.__nefan.reloj().frames > 0 && window.__nefan.frontier.proposal) ? true : null` declarado `game loop` → deriva. La lectura de `reloj()` está VIVA; lo que decide es `frontier` (el cliente).
- **B**: lee `scene` en una `const` y decide por `playerPos` → `bridge` deriva.
- **E** expresión coma `(window.__nefan.scene, () => frontier)`; **F** envoltorio `elige(() => scene, () => frontier)` (el argumento es una `CallExpression` y se escanea entera, incluidos argumentos que no son el predicado); **O** parámetro por defecto `(s = window.__nefan.scene) => frontier`; **P** código muerto tras el `return`.

Todo cae bajo la frase «mira QUÉ se lee, no qué decide», así que en espíritu está declarado; el
caso medido debería ser el de la lectura VIVA (A), que es el que un autor escribiría, no el de la
`const` sin usar. Cazadas de verdad: la lectura dentro de un comentario (M) y dentro de un string (N).

### H-4 · MENOR — fricciones no declaradas (una honesta escrita así sale roja sin que el contrato lo diga)

Dirección segura (no dejan pasar mentira), pero no están en `_lo_que_esto_NO_sujeta` y quien las
sufra no sabrá por qué: `window["__nefan"].scene` (H), `const { scene } = window.__nefan` dentro del
predicado (I), predicado importado de `qa/lib` (K; el docblock dice «función del fichero» pero el
contrato no), método de objeto por referencia `sondas.tile` (L). La clave computada por
concatenación (G) sí está cubierta por el (4). `globalThis.__nefan.scene` (J) deriva bien.

### H-5 · MENOR — el mapa `clases` solo está sujeto contra nombres FANTASMA

El sabotaje (ii) prueba `escena`; añadir a `bridge` una clave que el hook SÍ tiene (`playerPos`,
`state`) haría derivar «bridge» a cualquier espera del mundo y ningún test lo ve. Es el fichero de
política y el diff lo enseña, igual que un umbral: se anota para que nadie crea que el mapa tiene
más candado del que tiene.

### H-6 · MENOR — `contrato-candados-en-negativo.mjs` no incluye lo que más barato se rompe

Los dos sabotajes que más directamente prueban lo NUEVO del hermano no están en el guion: el
`desc` cambiado de una letra (2c) y la pared del 69 bajada a `CORTAFUEGOS_MS` (2d). Se probaron a
mano y son un `sed` cada uno. Igual que H-1 cuando se cierre.

## Workarounds usados y veredicto

- **Sabotajes a mano en vez del guion de negativos** (criterio 9): el turno de máquina lo tenía la
  tanda AC. No afecta al usuario (el guion corre en CI sin vecinos); la evidencia es el mismo `sed`
  y el mismo test, uno a uno. Sigue siendo ⚠️ hasta verlo en verde por sí solo.
- **`gh` falso por PATH** para los rojos (c) y (d) del headless: es la única forma de observar esas
  dos salidas sin romper la red; el usuario no lo tiene delante.
- Ninguno sobre el cliente: el 80 se corrió por `qa/run.mjs` con el preset real.

## No probado

- **El paso del `ci.yml` en un runner de GitHub**: el guion se midió aquí con el `gh` del usuario.
  Si al runner le falta `gh` o el token no lee issues, sale ROJO con motivo (probado), no verde.
- **El guion `contrato-candados-en-negativo.mjs esperas` en verde de una pieza** (ver criterio 9).
- **Gasto de sim real del 80**: el runner imprime «✔ ocurre» sin el rótulo de sim consumido, así que
  la holgura de `{sim: 8}` es por cálculo (1,9 m/s) y precedente, no por lectura.
- La mutación: no aplica (nada de `src/` cambia), como dice `implementacion.md` §9.

## Cómo volver a correr lo mecánico

- Derivación, hermano, totalidad: `cd nefan-core && node --import tsx --test test/esperas-que-conducen.test.ts test/espera-de-fotogramas-con-dueno.test.ts test/candados-headless-totalidad.test.ts`
- Headless: `node qa/la-exencion-por-issue-tiene-issue-vivo.mjs` (y sus cuatro rojos: `sed 's/"issue": 673/"issue": 545/'` en el hermano; `PATH=$(dirname $(command -v node))`; un `gh` falso que salga 4; uno que imprima `open`).
- Banco adversarial de esta QA: vivió como `qa-adversarial.ts` junto a este informe en la primera
  vuelta y en la segunda pasó a tres `it` de `esperas-que-conducen.test.ts` (ver abajo).
- H-1: los dos inserts del hallazgo y el test correspondiente (verde = agujero abierto).
- El 80 aislado: `node qa/run.mjs 80` ×3.

## Veredicto de la PRIMERA vuelta (2026-09-20, sobre `ecc40ae0`)

**No apto**, por el criterio 5: la derivación cumple lo que promete sobre las cinco honestas y sobre
la mentira medida del issue (N17b roja, verificado), pero deja pasar en verde dos mentiras nuevas
—la del `desc` compartido (12·0 en conducen, 10·0 en el hermano) y la de la sombra/reasignación del
predicado por referencia— que **no están en `_lo_que_esto_NO_sujeta` ni medidas**, y la primera
contradice una frase del contrato. Las dos se cierran o se declaran con su caso en una vuelta al
mismo ingeniero; el resto (criterios 1–4, 6–8, 10) está verificado y en verde.

---

# Segunda vuelta · 2026-09-20 · commit `aafb4ea5` (rama rebasada sobre `main` = `e635159d`)

Re-verificados SOLO los criterios que tocaba la corrección (5, 9, banco adversarial) más una pasada
adversarial nueva. Árbol limpio antes y después de cada sabotaje; nada ajeno tocado; sin stack.

| # | Qué | Veredicto | Evidencia |
|---|---|---|---|
| H-1 conducen | Mi insert exacto en el 05 (espera de PARED con el `desc` de la exención honesta y el predicado de N17b) | ✅ rojo por los DOS mecanismos | 15 ✔ · **2 ✖**: «05 :: "el jugador entra en el tile recién generado" → 2 esperas, líneas 181, 233» (test H-1) y «05:181 declara «bridge» (exige leer scene) y su predicado lee frontier» (derivación de TODAS, no de la última). Antes: 12·0 |
| H-1 hermano | Copia del molde en `las-fixtures-solo-chocan-con-el-agua.mjs` con el `desc` de la honesta | ✅ rojo | 11 ✔ · **1 ✖**: «… :: "el renderer emite más frames" → 2 esperas, líneas 199, 200». Antes: 10·0 |
| H-2 sombra | `const TRAZA = () => window.__nefan.scene ?? null` añadido al final del 133 | ✅ rojo nombrándola | «133:331 declara «game loop» (exige leer reloj o fps) y su predicado llega por la referencia AMBIGUA `TRAZA` (declarada más de una vez en el fichero, o reasignada): no se deriva por adivinanza» |
| H-2 reasignación | `let TRAZA = …` + `TRAZA = () => scene` al final del 133 | ✅ rojo, mismo texto | ídem, `refAmbigua = "TRAZA"` |
| H-2 hermano | Referencia con dos dueños se mira ENTERA (detectar de más), con control del control (un dueño que no lee contador → 0 censadas) | ✅ | Caso «la referencia con VARIOS dueños se resuelve detectando de MÁS» en el test del hermano, y párrafo (5) de su `_lo_que_esto_NO_sujeta` |
| Banco adversarial | Los 16 casos A…P en el test, con su cifra; `qa-adversarial.ts` borrado | ✅ | A y B en «(1) la lectura que NO DECIDE»; C, D, M, N, J en «lo que la derivación CAZA»; E, F, O, P en «los AGUJEROS que sigue dejando pasar» (`deepEqual` contra los cuatro); G, H, I, K, L en «las FRICCIONES». `ls docs/agents/…/` sin el `.ts`; `un-numero-un-guion.test.ts` 4 ✔ en la corrida conjunta (51 ✔ · 0 ✖ los cuatro tests de la zona) |
| Marcador 8 → 6 | ¿Es verdad? | ✅ | Agujeros vivos = A, B, E, F, O, P (6); cerrados C y D (los dos H-2). Fricciones 5, declaradas y medidas |
| H-3 | El caso medido de (1) es el VIVO (`reloj().frames > 0 && frontier.proposal` bajo `game loop`) y la muerta es la segunda mitad; el párrafo dice «la lectura que NO DECIDE» | ✅ | Diff del test y del contrato |
| H-4 | Las cuatro fricciones en `_lo_que_esto_NO_sujeta` (2) con su caso | ✅ | Párrafo (2) del contrato; `it` «las FRICCIONES» |
| H-5 | El mapa `clases` es política: `it` que lo MIDE con `playerPos` añadido a `bridge`, y control con el mapa real | ✅ | `it` «lo que el mapa `clases` NO sujeta»; párrafo (4) |
| H-6 | `contrato-candados-en-negativo.mjs` 4 → 8 entradas de esperas, con las dos baratas y H-1/H-2 EN EL BANCO; cabecera «siempre en el contrato» corregida | ✅ | Diff del guion; las ocho salen 🔴 en la corrida de abajo |
| Criterio 9 (⚠️ de la primera vuelta) | El guion de negativos DE UNA PIEZA, con el turno libre | ✅ | `node qa/contrato-candados-en-negativo.mjs` 13:20:08 → 13:20:30: **30 probados · 30 nacen rojos · 0 no se enteran · 0 obsoletos**, salida 0, árbol limpio después |
| `_comment` falso de la primera vuelta | «apunta a UNA y no ciega el fichero entero» | ✅ corregido | Ahora dice que lo SUJETA UN TEST, y cuenta que antes era falso con el número (12·0 / 10·0) |
| Suite entera | `npm test` sobre el árbol limpio rebasado | ✅ | **3145 tests · 3145 pass · 0 fail**, salida 0 |

## Adversarial nueva (segunda vuelta)

| Caso | Qué esperaba | Resultado |
|---|---|---|
| **A1** · el `desc` de la espera honesta del 05 cambia UNA letra en el guion («generadO») | la exención se queda sin sujeto (rojo) y la espera queda sin eximir (rojo) | ✅ 15 ✔ · **2 ✖**: «exención(es) sin sujeto (bórralas): 05 :: "…generado"» + «05:232 · holdUntil(…, { ms: 180_000 })» |
| **A2** · se AÑADE una espera con `desc` a una letra de la honesta (la honesta se queda) | solo la nueva en rojo; la exención conserva su sujeto y H-1 no salta | ✅ 16 ✔ · **1 ✖**: «05:181 · holdUntil(…, { ms: 120_000 })»; el test H-1 verde (claves distintas) |
| **B** · la exención honesta del 05 con su predicado sustituido por `tileNuevo` importado de `../lib/tiles.mjs` (fricción K, declarada) | rojo, y que el mensaje diga qué hacer | ✅ rojo: «05:233 declara «bridge» (exige leer scene) y su predicado lee **NADA del hook**». El mensaje del aserto ofrece tres salidas (leer algo del proceso / `{sim}` / `issue`), **pero no la cuarta que es la de este caso** —traer el predicado al fichero o leer el hook dentro de él— y no remite al párrafo (2) del contrato. Ver H-8 |
| **Q** · SOMBRA POR PARÁMETRO: `const pred = () => scene` top-level; `async function espera(ctx, pred) { holdUntil(…, pred, …) }` llamado con un lector de `frontier` | que fuese AMBIGUA | ❌ `{ambigua: false, lecturas: ["scene"]}` → derivaría «bridge». Ver H-7 |
| **R** · SOMBRA POR DESTRUCTURING: `const { pred } = ctx.sondas` dentro + `const pred = () => scene` top-level | ídem | ❌ `{ambigua: false, lecturas: ["scene"]}`. Ver H-7 |
| **S** · `let pred; if (x) pred = leeFrontier` + `const pred = () => scene` top-level | ambigua | ✅ `ambigua: true` (la reasignación se ve) |
| **T** · control: única declaración honesta por referencia | deriva | ✅ `["scene"]` |

## Hallazgos de la segunda vuelta

### H-7 · MENOR (no reabre el criterio 5 si se DECLARA) — la «referencia ambigua» solo cuenta vínculos con valor función

`funcionesDelFichero` apunta en `porNombre` las `FunctionDeclaration` y las `VariableDeclaration`
cuyo inicializador es una función, y en `reasignados` los `=`; un PARÁMETRO con el mismo nombre (Q)
o un patrón de destructuring (R) no son ninguna de las dos cosas, así que un único `const pred`
top-level lector de `scene` decide la derivación mientras el que corre llega por el parámetro del
helper. Es la misma familia que C/D, requiere el mismo grado de elaboración, y la frase nueva del
contrato («una referencia que no decide una sola función ya no deriva nada») es cierta para las
declaraciones y falsa para los vínculos. Salida barata: contar como candidato CUALQUIER vínculo del
nombre (parámetros, `BindingElement`, `let` sin inicializador) y marcar ambigua si hay más de uno;
o añadirlo a `_lo_que_esto_NO_sujeta` con Q y R como caso medido junto a E/F/O/P (el helper ya lo
insinúa: «NO resuelve ÁMBITOS»). Reproducible con el scratch `adv2/q.ts` (importa el helper del repo).

### H-8 · MENOR — el rojo de la fricción K no dice la salida que le toca

Con el predicado importado, el rojo es exacto («lee NADA del hook») pero el mensaje del aserto
enumera tres salidas que no son la de este caso. Quien lo sufra tiene que ir al párrafo (2) del
contrato para enterarse de que la salida es declarar el predicado en el fichero o leer el hook
dentro. Una frase más en el mensaje cuando `lecturas` está vacío y el predicado llegó por
referencia no resuelta («¿viene importado? tráelo al fichero») lo cierra.

## Veredicto FINAL

**Apto con reservas.** Los dos agujeros por los que la primera vuelta tumbó el criterio 5 están
CERRADOS y medidos en rojo sobre el árbol por los dos mecanismos pedidos; las cinco honestas siguen
en verde; los 16 casos del banco adversarial viven como asertos con el marcador 8 → 6 verdadero; el
guion de negativos sale 30/30 de una pieza; y la suite entera está en verde. Las reservas son H-7
(una variante de H-2 por vínculos que no son declaraciones: cerrar o declarar con su caso) y H-8
(un mensaje), ninguna de las dos deja pasar la mentira medida del issue ni contradice hoy un test.
