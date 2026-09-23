**REENCUADRADA** — el problema es real pero menor que el issue, y la mitad de los «ocho» no son copias del barrido del banco: son lectores de UNA carpeta cuyo sujeto es otro. Meterlos en el barrido recursivo les cambia el significado.

## El problema real, en una frase

«Qué ficheros son el banco» se decide hoy en **cuatro** recorridos recursivos de `qa/` con saltos distintos, y el día que aparezca un symlink o un directorio con punto bajo `qa/` un candado verá un `.mjs` que otro no ve, sin que nadie se entere.

## La premisa, afirmación por afirmación

1. *«`helpers-del-banco.ts` y `banco-ficheros.ts` exportan los dos `fuentesDelBanco`»* — **cierto** (`helpers-del-banco.ts:21`, `banco-ficheros.ts:120`). Pero el de AF tiene **un solo** consumidor: `el-cliente-ws-del-banco-declara-como-escucha.test.ts:66`. `un-salto-del-guion-se-observa.test.ts:45` ya importa el de X.
2. *«213 ficheros cada uno, cero diferencia»* — medido hoy: **220 / 220 / 220** (X, AF y la copia `flatMap` de `esperas-que-conducen`), cero diferencia, tanto en este worktree como en `/home/al/code/ne-fan` con sus 15.748 entradas en `qa/capturas/`. La divergencia sigue siendo hipotética (ni symlinks ni directorios con punto con `.mjs` hoy en `qa/`).
3. *«Ocho tests más tienen su propio `readdirSync(qa).filter(".mjs")`»* — re-censado hoy, son **dos clases distintas**:
   - **Barrido recursivo de todo `qa/`, copia del banco (3 + el de AF):** `esperas-que-conducen.test.ts:312`, `espera-de-fotogramas-con-dueno.test.ts:290`, `el-cortafuegos-del-tile-tiene-dueno.test.ts:288`. Los tres saltan TODO directorio con punto (`banco-ficheros.ts` no salta `.oculto/`, a propósito: cabecera, líneas 26-30), NO saltan `capturas/` y no siguen enlaces. `esperas-que-conducen` además excluye `qa/run.mjs` con motivo (`:315-317`), y eso tiene que seguir así.
   - **Lectores de una carpeta concreta, NO recursivos (6 ficheros, 7 sitios):** `un-numero-un-guion.test.ts:75`, `las-anclas-de-los-candados.test.ts:75`, `el-banco-declara-el-modo-de-gasto.test.ts:107` (`qa/guiones`); `qa-lib-tiene-quien-lo-mire.test.ts:176` (`qa/lib`); `candados-headless-totalidad.test.ts:309,317` (raíz de `qa/` y `qa/lib`); `esperas-de-qa.test.ts:348` (`qa/guiones` + `qa/lib`, con `readdirSync` sacado de un `await import("node:fs")` dinámico en `:344`). Su sujeto no es «el banco»: es lo que VE `qa/run.mjs` (`run.mjs:1238`, `readdirSync(guiones)` no recursivo — que es justo lo que canda #680), lo que ejecuta el job, lo que un test importa de `lib/`. Un `qa/guiones/sub/x.mjs` o un `qa/guiones/enlace -> dir` entraría en su censo por el barrido recursivo, y `run.mjs` no lo corre nunca.
4. *«La lista está en el plan de la tanda X §6»* — el §6 (`docs/agents/2026-09-18-tanda-x-…/plan.md:109-112`) ya proponía otra cosa: `guiones()`, `lib()`, `ejecutables()` como vistas separadas, no un único barrido. El issue lo colapsó en uno.
5. *«Candado: ningún fichero de `test/` hace su propio `readdirSync` sobre `qa/`»* — con los seis lectores legítimos de arriba, el candado tal como está escrito o los prohíbe (mal) o necesita un padrón. Y decidir «sobre `qa/`» exige resolver el argumento: `join(repoRoot,"qa","guiones")`, constantes (`GUIONES`, `QA_LIB`), un array `dirs` recorrido en bucle, y un `readdirSync` desestructurado de un import dinámico. Ese es el terreno donde un censo nace ciego a la escritura (memoria del proyecto; #686).

## El día después

- Para quien juega: nada. Es deuda declarada del banco, y está bien que lo sea.
- Lo que gana: una sola definición de «el banco» para los candados que lo recorren entero; el siguiente padrón por árbol (#711) ya no nace con su quinta copia.
- Lo que se vuelve más difícil si se hace TAL CUAL: `un-numero-un-guion` dejaría de reflejar lo que `run.mjs` ve; habría que filtrar por prefijo y profundidad para rehacer a mano lo que hoy dice un `readdirSync` de una línea. A un lector dentro de un mes eso le parecerá arbitrario.
- Lo que se queda: `helpers-del-banco.ts` **no desaparece** — `saltos-del-guion.ts:73` y dos tests usan `arbolDelBanco`/`recorre`/`cuerpoPrincipal`. Solo pierde `fuentesDelBanco`, y su cabecera («Unificar las copias que quedan es trabajo del coordinador», `:9-10`) se queda sin sujeto y hay que barrerla.
- Censo que puede cambiar: las tres copias pasarían a ver `qa/.oculto/*.mjs` (hoy 0). Sube, no baja; se mide igual.
- Coste de `capturas/`: las tres copias recorren 15.748 entradas en el checkout principal, **17 ms**. No venderlo como mejora de rendimiento.

## Conflictos

- **#697 (tanda AN, «el describe que lanza»)**: toca `el-banco-declara-el-modo-de-gasto.test.ts:107`, **la misma línea** que el issue manda migrar (es uno de sus cuatro sitios: el `readdirSync`+`readFileSync` dentro del `describe`). Con el reencuadre ese fichero es lector de carpeta y queda fuera: **el conflicto desaparece**. Si se hiciera tal cual, AN primero y AL se rebasa.
- **#716 (tanda AH, detector de saltos)**: toca `saltos-del-guion.ts` y `saltos-sin-observar.json`, que importan de `helpers-del-banco.ts` solo el visitante de AST. Riesgo bajo **siempre que AL no mueva ni renombre** `arbolDelBanco`/`recorre`/`cuerpoPrincipal`/`recorreSinAnidadas`. Si AL se limita a quitar `fuentesDelBanco` y su import de `readdirSync`, no chocan.
- **#711 (pendiente, padrón de relojes de pared en `qa/guiones/**`)**: recorrido recursivo nuevo, justo la clase que el candado tiene que obligar a pasar por `banco-ficheros.ts`. **Orden correcto: AL antes que #711.** Con AL hecho, #711 nace con su barrido y no con una quinta copia.
- AN y AL añaden los dos un candado por AST sobre `test/*.ts`. No comparten fichero hoy; si el arquitecto quiere un helper común para recorrer `test/`, es una tentación que cruza tandas: no en esta.
- `banco-ficheros.ts`: hoy ninguna otra tanda de las seis lo toca (los worktrees hermanos no tienen diff, 2026-09-23).

## Coste contra valor

La parte de valor es barata: 4 recorridos → 1, tres ficheros de test y un helper, censo 220 = 220 verificable. La parte cara es el candado sobre «cualquier `readdirSync` sobre `qa/`» con resolución de rutas, y es la que menos vale, porque su mayor clientela son los lectores legítimos. Si no se hiciera nunca: no pasa nada hasta que alguien meta un symlink o un directorio con punto en `qa/`, y entonces un padrón miente en verde. Improbable, pero es la clase de verde que la casa ha decidido no tolerar. Merece la pena con el alcance recortado.

## Qué le cambiaría a `requisitos.md` (pegar en lugar de los criterios 1-3)

> 1. Un único barrido RECURSIVO de `qa/`: `nefan-core/test/banco-ficheros.ts`. Pasan por él los cuatro recorridos recursivos que hoy lo duplican: `fuentesDelBanco` de `helpers-del-banco.ts` (que deja de exportarlo y se queda con el visitante de AST, sin mover ni renombrar sus otras exportaciones, porque la tanda AH (#716) las usa), y los `ficherosDelBanco` locales de `esperas-que-conducen.test.ts`, `espera-de-fotogramas-con-dueno.test.ts` y `el-cortafuegos-del-tile-tiene-dueno.test.ts`. Las exclusiones propias con motivo (p. ej. `qa/run.mjs` en `esperas-que-conducen`) se conservan como filtro sobre el barrido, no como otro barrido.
> 2. Censo antes/después de cada uno de esos cuatro consumidores (hoy 220 en los cuatro). Si sube (p. ej. por `qa/.oculto/`), se dice; si baja, es un fallo.
> 3. **Fuera, a propósito:** los lectores NO recursivos de una carpeta concreta (`un-numero-un-guion:75`, `las-anclas-de-los-candados:75`, `el-banco-declara-el-modo-de-gasto:107`, `qa-lib-tiene-quien-lo-mire:176`, `candados-headless-totalidad:309,317`, `esperas-de-qa:348`). Su sujeto es lo que `qa/run.mjs`, el job o un `import` ven en ESA carpeta, no el banco entero, y un barrido recursivo que sigue enlaces les cambiaría el significado. Uno de ellos (`el-banco-declara…:107`) lo toca la tanda AN (#697) en la misma línea.
> 4. Candado por el ÁRBOL, probado en negativo: ningún fichero de `test/` fuera de `banco-ficheros.ts` recorre `qa/` de forma RECURSIVA por su cuenta. Los lectores de carpeta del punto 3 se declaran por nombre con su motivo, no se prohíben. `_lo_que_esto_NO_sujeta` medido con su `it` (al menos: el `readdirSync` sacado de un `import()` dinámico, las rutas que no se resuelven estáticamente y `{recursive: true}`, si el detector no lo ve).
> 5. `npm test` / `verify` verdes; `candados-headless` igual. Se barre la cabecera de `helpers-del-banco.ts:1-10`, que describe la duplicación como pendiente.
>
> Nota de orden: esta tanda va ANTES de #711 (el padrón de relojes de pared tiene que nacer usando el barrido).
