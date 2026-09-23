# Requisitos — tanda AG: un bloque que no aserta no se midió (#356)

## Petición literal del usuario

> «Que le falta a 356 para poder cerrarlo?»
>
> (tras la respuesta del coordinador) «Lanza la tanda con el ciclo completo»

## El problema (del issue #356 y su re-medida del 2026-09-17)

Un guion de `qa/guiones/` que aserta otras cosas y se salta UN bloque con un `if` de
precondición sale VERDE:

```js
if (!precondicion) { ctx.log("⚠ no se pudo medir X"); return; }   // ← sale VERDE
```

#639 (PR #650) ya impide el guion MUDO entero (`veredictoDeGuion` exige `afirmaciones > 0`,
contador cerrado en el tipo). Sigue abierta la mudez PARCIAL. `ctx.sinMedir` / `ctx.sinMedirBloque`
existen como salida honesta, pero **no declarar** sigue saliendo gratis.

La propuesta del issue (§3-C de `docs/agents/2026-09-01-el-timeout-que-decide/plan.md`, si aún
existe en disco; si no, el cuerpo del issue): `ctx.bloque(titulo, fn)` con la regla «un bloque
declarado que no aserta nada no se midió».

## Medido hoy por el coordinador (main = 22435005)

- `ctx.bloque` NO existe (cero apariciones en `qa/`).
- 157 guiones en `qa/guiones/`; 41 usan `sinMedirBloque`.
- ~75 guiones contienen algún `if … return` temprano (grep textual, orientativo: no distingue
  returns legítimos). **Verificar, no copiar.**

## Criterios de aceptación

1. Un guion que se salta un bloque por precondición sin asertar nada en él NO sale verde; sale
   con el veredicto honesto de «sin medir» (canal `⊘`), nombrando el bloque.
2. Lo anterior no depende de la buena voluntad de quien escribe el guion mañana: hay un candado
   ejecutable (test o regla) que se pone ROJO si un guion escribe la forma que escapa. Nada de
   regex sobre la prosa del log (9 de 14 líneas con «no se midió» eran descripciones legítimas).
3. El candado está probado en NEGATIVO (sabotaje que sale rojo) y declara lo que NO sujeta
   (`_lo_que_esto_NO_sujeta` o equivalente medido), según la costumbre del repo.
4. «A medio migrar no canda nada»: o la migración es total, o la frontera de lo migrado es ella
   misma un candado (padrón con los pendientes y su motivo, que solo puede encoger).
5. La batería sigue verde donde lo estaba: ningún guion cambia de veredicto salvo los que de
   verdad se saltaban un bloque, y esos se enumeran con su causa.
6. Prohibir el `return` temprano NO es el objetivo (es legítimo), ni perseguir la prosa del log.

## Fuera de alcance

- Cambiar el juego. Esto es el banco de QA.
- Reescribir lo que miden los guiones.

## Preguntas abiertas (para el crítico)

- ¿Sigue vigente tal cual, o hay una forma más barata que `ctx.bloque` + migrar 157 guiones que
  cierre el mismo agujero (p. ej. derivar los bloques de algo que ya existe)?
- ¿Es la migración total proporcionada, o basta un padrón que encoge?

## Reencuadre aprobado por el usuario (2026-09-23: «Adelante»)


> **Reencuadre (crítico, 2026-09-23).** Se sustituye «`ctx.bloque` + migrar 157 guiones» por: *un salto de un guion (un `return` temprano o un `if` sin `else` que envuelve asertos) cuya no-medida nadie observa se pone rojo en `npm test`, por el árbol de sintaxis*. «Observado» = la rama declara `sinMedir`/`sinMedirBloque`, afirma o lanza, o la condición se afirmó antes. `ctx.bloque` queda fuera: no ve un `return` en el nivel superior, que es la forma literal del issue (`28-…:106`).
>
> **Medido (AST + revisión, main 22435005):** 185 saltos con `return` y 39 `if` sin `else` con asertos; salto no observado real en `28:106`, `50:104`, `65:332`, `105:189`, y de borde en `07:176`. El resto es `expect(pre); if (!pre) return;`, que es honesto y NO se toca.
>
> Criterio 5 ampliado: los guiones que cambian de veredicto son, como mucho, esos cinco, y cada uno pasa a afirmar o a declarar `sinMedirBloque` con su causa. Criterio 3: `_lo_que_esto_NO_sujeta` MIDE al menos los helpers que devuelven `null`, los bucles que no se entran y los `&&` que cortocircuitan. Coordinar con #711 y #704 (misma maquinaria de AST sobre `qa/guiones`).
