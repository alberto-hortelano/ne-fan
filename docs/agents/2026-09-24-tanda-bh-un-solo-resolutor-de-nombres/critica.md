# Crítica — tanda BH (#720 #727)

**#727: REENCUADRADA** (son dos detectores, no tres, y uno está ciego en verde: medido). **#720: REENCUADRADA** (el troceo en tres, tal como está escrito, no se puede hacer: juicio y reglas son mutuamente recursivos; lo que vale del issue es la parte AO). Orden: **#727 primero**, sin que invente el «helper común» de #720.

## El problema real, en una frase

- #727: el selector de mutación (`descubrimientosDe`) no ve dos formas de nombrar `readdirSync` que el candado del banco sí ve, y cuando no las ve devuelve **0 directorios y 0 ciegos**: selecciona de menos y calla.
- #720: cuatro detectores del banco deciden a mano «a qué se refiere este identificador», y el de saltos lo hace **sin ámbitos**, cosa que su propio comentario reconoce que puede *excusar* un salto (`saltos-del-guion.ts:340`: «un `c` ajeno sobrecuenta Y excusa»). Las 861 líneas son el síntoma, no el problema.

## La premisa, afirmación por afirmación (worktree sobre `96da8151`)

| Afirmación | Verificación |
|---|---|
| #727 «tres detectores de lectores de fs» | **Falso: son dos.** `test/afectado.test.ts:784` no detecta nada: es la batería de `descubrimientosDe`, importado de `scripts/mutation-plan.ts` (`afectado.test.ts:49-56`). Los detectores son `analizaLectura` (`mutation-plan.ts:944`, 1.304 líneas el fichero) y `recorridos`/`LECTORES` (`un-solo-barrido-del-banco.test.ts:90-190`, 576 líneas) |
| «una puede reconocer lo que otra no» | **Cierto, y medido.** Sondeo de `descubrimientosDe` con `DIR` a `data/scenes`: directo, alias `as`, `import * as fs`, `import fs`, `promises.readdir` → `["data/scenes"]`; **`const { readdirSync: r } = await import("node:fs")` → `[]`, ciegos 0**; **`const leer = readdirSync; leer(DIR)` → `[]`, ciegos 0**. Las dos las ve el barrido del banco (`un-solo-barrido…test.ts:433,438`). La causa: `alias` solo se llena desde `ImportDeclaration` con llaves (`mutation-plan.ts:1058-1062`). Y en la otra dirección: `import { readdirSync } from "./mio"` cuenta como lector de fs (falso positivo, pero en la dirección segura) |
| Hay un tercero que el issue no nombra | `qa/el-selector-ve-lo-que-la-bateria-abre.mjs:106` tiene su propio `API_ENUMERA` y reconoce **solo por nombre desnudo**. Pero es el ORÁCULO que contrasta al selector (`:97` importa `alcanceDe` para compararlo): si compartiera el helper, dejaría de ser independiente. **No debe entrar en la unificación** |
| Nota de #727 sobre el guion 163 («cae al cargar» ≡ «ningún aserto») | **Obsoleta.** `qa/guiones/163-…mjs:240-243` ya separa `EXIT N sin ningún aserto rojo nombrado` desde #749 (`b0cd7edd`) |
| #720 «861 líneas» | Cierto: `wc -l` = 861 |
| #720 «tres responsabilidades separables» | **Falso en el corte propuesto.** `afirmante` (juicio, `:615`) llama a `condicionObservada` (reglas, `:745`), que llama a `observadosAntes` (`:713`), que llama a `afirmante`. Juicio y reglas son un ciclo: tres módulos darían un import circular o moverían `afirmante` a reglas. El único corte limpio es resolución (`Modulo`, `modulo`, `aliasDeCtx`, `funcionDe`, `verbo`, `llamadaLocal`, ~`:246-460`) contra todo lo demás |
| «ni CRAP ni mutación lo miden» | Cierto: `test/` no está en `mutation-targets.json` ni en `quality-thresholds.json`. Tampoco lo está `scripts/mutation-plan.ts` (0 menciones) |
| «coordinar con #704» | Ya no aplica: #704 cerrado; `helpers-del-banco.ts` tiene 66 líneas |
| AO: «tres resolutores distintos» | Cierto, y son **cuatro con semánticas distintas**: sondas (alias por punto fijo sin ámbitos, `la-consulta-de-movimiento-tiene-dueno.test.ts:176-241`), esperas (`funcionesDelFichero`, `lecturas-del-predicado.ts:62`, cuenta vínculos y reasignaciones), relojes (`resuelve`, `relojes-de-pared.ts:98`, ámbito léxico a mano) y saltos (`aliasDeCtx`, punto fijo sin ámbitos). Ninguno usa el binder de TypeScript (`getTypeChecker` = 0 usos en `test/`, `scripts/`, `src/`) |

## El día después

- #727 hecho: el selector deja de callar dos formas de lectura. Para quien juega, nada; es deuda del instrumento que decide qué NO se mide, y ahí un verde falso cuesta.
- #720 hecho como está escrito: tres ficheros donde había uno, el mismo ciclo repartido entre dos, y ninguna métrica que se mueva, porque nada en `test/` se mide. Nadie lo notaría salvo quien busque `afirmante`. **Mover líneas, no reducir complejidad.**
- Lo que se volvería arbitrario dentro de un mes: un `ambito-del-guion.ts` escrito a mano, «compartido» por cuatro detectores que resuelven cosas distintas (ctx, una propiedad, una función, un import de fs) y parametrizado con semillas y banderas para contentar a cada uno. Sería un quinto resolutor.

## Conflictos

- **Solapamiento #727 ↔ #720**: las dos piden «un helper de resolución de nombres». Si #727 escribe su helper de fs en `scripts/` y #720 escribe `ambito-del-guion.ts` en `test/`, pagamos dos resolutores nuevos. Lo que comparten es solo la **búsqueda de la declaración de un identificador** (con ámbitos). Reconocer fs (qué módulo, `promises`, `import()`, `require`, `recursive`) es del dominio de fs y no le sirve a nadie más.
- **Dirección de dependencias**: `mutation-plan.ts` vive en `scripts/`, y hoy ningún `scripts/` importa de `test/` (grep = 0). El helper de fs no puede vivir en `test/`.
- Números de guion 222-225: ninguno de los dos issues es observable desde el arranque. No hace falta un guion; basta con negativos en `npm test`.

## Coste contra valor

- #727: M pequeño, con un fallo medido que hace verde el selector. **Vale.** Si no se hiciera nunca, el selector seguiría saltándose módulos que leen por `import()` desestructurado o por asignación, sin decirlo.
- #720 como troceo: coste M, valor ≈ 0 medible. **No hacerlo solo.** Lo que tiene valor es cerrar el «sin ámbitos que excusa» del detector de saltos, que es un verde posible. El troceo solo se justifica si lo exige ese cambio.
- Helper común: no hay que escribir un resolutor léxico a mano antes de medir el que ya trae TypeScript. **Medido aquí**: un programa `noLib/noResolve` sobre los 184 guiones resuelve con `getSymbolAtLocation` los 85.474 identificadores en ~1,0 s, y resuelve bien los tres casos de sombreado (parámetro, import y `const` de bloque con el mismo nombre). No resuelve el flujo de valor (`const x = y`): eso sigue siendo un punto fijo propio de cada detector. Decidir binder o mano es cosa del arquitecto; lo que **no** debe hacerse es un `ambito-del-guion.ts` genérico sin esa comparación.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **#727 (reencuadrada).** Son DOS detectores: `analizaLectura` (`scripts/mutation-plan.ts`) y `recorridos` (`test/un-solo-barrido-del-banco.test.ts`). `test/afectado.test.ts` es la batería del primero, no un tercero. `qa/el-selector-ve-lo-que-la-bateria-abre.mjs` se queda FUERA a propósito: es el oráculo independiente del selector. Un solo reconocedor de lectores de `node:fs`, en `scripts/` (los scripts no importan de `test/`), que usen los dos. La nota del guion 163 está cerrada por #749.
> Criterios: (1) `descubrimientosDe` sobre `const { readdirSync: r } = await import("node:fs"); r(DIR)` y sobre `const leer = readdirSync; leer(DIR)` da `["data/scenes"]` (hoy `[]`, ciegos 0: negativo que nace rojo). (2) Las catorce formas de nombre de `un-solo-barrido…test.ts:424-439` las ven los DOS detectores, en una tabla compartida. (3) `import { readdirSync } from "./mio"` no cuenta como lector en ninguno de los dos. (4) `npm run afectado` sobre `main` selecciona lo mismo o MÁS, nunca menos; el diff de la selección va en el informe. (5) Los `_lo_que_esto_NO_sujeta` de los dos dicen lo mismo sobre nombres.
>
> **#720 (reencuadrada).** El objetivo no son las 861 líneas: es que el detector de saltos resuelve el ctx SIN ÁMBITOS y eso puede EXCUSAR un salto (`saltos-del-guion.ts:340`). No trocear en tres: juicio y reglas son mutuamente recursivos (`afirmante` → `condicionObservada` → `observadosAntes` → `afirmante`). Si se trocea, que sea por el único corte limpio (resolución contra el resto), y solo si el cambio de resolución lo pide.
> Criterios: (1) Primero, un negativo que nace ROJO: un guion con un `c` ajeno, sombreado, que hoy excusa un salto. (2) La foto de `saltosDelGuion` sobre los 184 guiones (fichero, condición, `observado`, `porque`), guardada antes, idéntica después, salvo los cambios que el negativo explica uno a uno. (3) Antes de escribir un resolutor de ámbito compartido, el plan compara el binder de TypeScript (medido: ~1 s, 184 guiones) contra la mano sobre la batería de sombreado de `el-reloj-de-pared-tiene-padron.test.ts`, y elige con números. (4) No hay helper «común» parametrizado para cuatro semánticas: se comparte como mucho la búsqueda de declaración; el flujo de valor sigue siendo de cada detector.
