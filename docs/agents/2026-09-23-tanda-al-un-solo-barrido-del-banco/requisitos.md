# Requisitos — tanda AL: un solo barrido del banco (#704)

## Petición literal del usuario

> «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

El coordinador eligió este issue para la tanda. Sesión AUTÓNOMA: el usuario no está para dar visto bueno a mitad del ciclo; lo que haya que preguntarle se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## El issue, verbatim (cuerpo + comentarios, descargado hoy de GitHub)

### #704

> Dos copias del visitante de árbol del banco: helpers-del-banco.ts y banco-ficheros.ts exportan fuentesDelBanco, y solo una sigue symlinks
> 
> Sale de las tandas X (#686, PR #698) y AF (#678, PR #703) del 2026-09-18/20, que nacieron en paralelo y no podían tocar el mismo fichero.
> 
> ## El hecho
> 
> `nefan-core/test/banco-ficheros.ts` (X) y `nefan-core/test/helpers-del-banco.ts` (AF) exportan los dos un `fuentesDelBanco` que barre `qa/` y devuelve los `.mjs`. Medido sobre el árbol real: 213 ficheros cada uno, cero diferencia hoy. Pero el de X es symlink-aware (sigue enlaces por lo que apuntan, corta ciclos por ancestros, salta `capturas/`), y el de AF no: el día que un symlink entre en `qa/` los dos censos divergen sin que nadie lo vea.
> 
> Y el molde original, `test/la-consulta-de-movimiento-tiene-dueno.test.ts`, ya importa `banco-ficheros.ts`; ocho tests más de `test/` tienen su propio `readdirSync(qa).filter(endsWith(".mjs"))` (lista en `docs/agents/2026-09-18-tanda-x-el-padron-cuenta-llamadas/plan.md` §6).
> 
> ## Lo que hay que hacer
> 
> Un solo barrido del banco (`banco-ficheros.ts`), importado por los ocho tests y por `helpers-del-banco.ts` (que se queda solo con el visitante de AST si hace falta o desaparece). Candado: un test que afirme que ningún fichero de `test/` hace su propio `readdirSync` sobre `qa/` fuera de `banco-ficheros.ts` (por el árbol), probado en negativo.
> 
> Relacionado: #686, #678, #606.

## Criterios de aceptación

1. Un único barrido de `qa/` (`nefan-core/test/banco-ficheros.ts`, symlink-aware) del que dependen todos los tests de `test/` que enumeran ficheros del banco; `helpers-del-banco.ts` deja de exportar su propio `fuentesDelBanco`.
2. Los ocho `readdirSync(qa)…filter(".mjs")` sueltos se re-censan HOY (la lista del plan de la tanda X puede haber envejecido) y pasan por el barrido único. El número de ficheros que ve cada test no baja sin explicación (medir antes/después).
3. Candado por el ÁRBOL: un test que se pone rojo si un fichero de `test/` recorre `qa/` por su cuenta fuera de `banco-ficheros.ts`, probado en negativo, con `_lo_que_esto_NO_sujeta` medido según la costumbre.
4. `npm test` / `verify` verdes; el job `candados-headless` sigue igual.

## Contexto del coordinador

- Worktree: `/home/al/code/ne-fan-tanda-al`, rama `feature/tanda-al`, nacida de `main` = `83ea6046`. Todo el trabajo va en ese árbol, nunca en `/home/al/code/ne-fan`.
- Hay OTRAS cinco tandas en paralelo en worktrees hermanos (`ne-fan-tanda-{ah,ai,ak,al,am,an}`): #716 detector de saltos, #714 resume con tiles en clay, #709 ruff local, #704 un solo barrido del banco, #700 buscar con veces===1, #697 describe que lanza. Si esta tanda toca un fichero que otra también tocará con probabilidad (p. ej. `nefan-core/test/banco-ficheros.ts`, `package.json`, `ci.yml`), dilo en tu documento.
- Si hay que levantar un stack (qa/run.mjs), NUNCA matar procesos ajenos; `qa/run.mjs` elige bloque libre solo.
- Nada de gasto de créditos de imagen: preset `e2e-sin-creditos` / motor falso.
- Mutación: `npm run mutacion -- local <id>` si cabe en el tope; si no, se pide y no se espera.
- Commits intermedios en la rama (hubo límites de sesión que mataron agentes con trabajo sin commitear).

## Fuera de alcance

- Lo que el propio issue declara fuera.
- Issues vecinos que aparezcan: se ANOTAN (propuesta de issue nuevo en el documento), no se arreglan.

## Reencuadre del crítico, aceptado por el coordinador (2026-09-23, sesión autónoma)

Lo que sigue SUSTITUYE los criterios 1-3 de arriba.


> 1. Un único barrido RECURSIVO de `qa/`: `nefan-core/test/banco-ficheros.ts`. Pasan por él los cuatro recorridos recursivos que hoy lo duplican: `fuentesDelBanco` de `helpers-del-banco.ts` (que deja de exportarlo y se queda con el visitante de AST, sin mover ni renombrar sus otras exportaciones, porque la tanda AH (#716) las usa), y los `ficherosDelBanco` locales de `esperas-que-conducen.test.ts`, `espera-de-fotogramas-con-dueno.test.ts` y `el-cortafuegos-del-tile-tiene-dueno.test.ts`. Las exclusiones propias con motivo (p. ej. `qa/run.mjs` en `esperas-que-conducen`) se conservan como filtro sobre el barrido, no como otro barrido.
> 2. Censo antes/después de cada uno de esos cuatro consumidores (hoy 220 en los cuatro). Si sube (p. ej. por `qa/.oculto/`), se dice; si baja, es un fallo.
> 3. **Fuera, a propósito:** los lectores NO recursivos de una carpeta concreta (`un-numero-un-guion:75`, `las-anclas-de-los-candados:75`, `el-banco-declara-el-modo-de-gasto:107`, `qa-lib-tiene-quien-lo-mire:176`, `candados-headless-totalidad:309,317`, `esperas-de-qa:348`). Su sujeto es lo que `qa/run.mjs`, el job o un `import` ven en ESA carpeta, no el banco entero, y un barrido recursivo que sigue enlaces les cambiaría el significado. Uno de ellos (`el-banco-declara…:107`) lo toca la tanda AN (#697) en la misma línea.
> 4. Candado por el ÁRBOL, probado en negativo: ningún fichero de `test/` fuera de `banco-ficheros.ts` recorre `qa/` de forma RECURSIVA por su cuenta. Los lectores de carpeta del punto 3 se declaran por nombre con su motivo, no se prohíben. `_lo_que_esto_NO_sujeta` medido con su `it` (al menos: el `readdirSync` sacado de un `import()` dinámico, las rutas que no se resuelven estáticamente y `{recursive: true}`, si el detector no lo ve).
> 5. `npm test` / `verify` verdes; `candados-headless` igual. Se barre la cabecera de `helpers-del-banco.ts:1-10`, que describe la duplicación como pendiente.
>
> Nota de orden: esta tanda va ANTES de #711 (el padrón de relojes de pared tiene que nacer usando el barrido).
