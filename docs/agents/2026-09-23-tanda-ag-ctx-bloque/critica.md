**REENCUADRADA** — el agujero existe y se puede escribir mañana, pero `ctx.bloque` + migrar 157 guiones no lo cierra por construcción (el ejemplo literal del issue se le escapa) y lo que sí lo cierra es un padrón por AST en `npm test`, con unos 5 ocupantes medidos.

## El problema real, en una frase

Un guion puede dejar de medir parte de lo que promete porque falló una precondición, sin que ningún `expect` ni ninguna declaración vea ese fallo, y aun así salir verde.

`ctx.bloque(titulo, fn)` es una solución, y ataca otra cosa: mira si un bloque DECLARADO afirmó algo, no si un salto fue OBSERVADO. Solo acierta cuando el salto cae dentro de un bloque declarado.

## La premisa, afirmación por afirmación (main = 22435005)

| Afirmación | Verificación |
|---|---|
| `ctx.bloque` no existe | Cierto. Cero apariciones en `qa/run.mjs`, `qa/lib` y `qa/guiones`. La única `bloque(` es una función local de `53-…:189` |
| 157 guiones, 41 usan `sinMedirBloque` | Cierto. Además, 8 declaran `sinNavegador` y son los únicos que corren en CI (job `candados-headless`) |
| `veredictoDeGuion` exige `afirmaciones > 0`, con el contador cerrado | Cierto: `qa/run.mjs:928`, getter en `:951`, `configurable:false` en `:1199` y el incremento en `expect`, `:1183` |
| «~75 guiones con `if … return`» | La cifra no mide el agujero. Contado por AST (función principal, sin anidadas): **185** `if` con `return` en su rama; **61** declaran, afirman o lanzan dentro; **124** no. De esos 124, la inmensa mayoría es `ctx.expect("…", Boolean(x)); if (!x) return;`: la precondición SE AFIRMA, su fallo pone el guion en rojo y no hay ningún agujero (`02:39-40`, `17:122-126`, los 14 `if (!tarjeta) return` precedidos de su `expect`…) |
| Guiones con un salto de verdad no observado | Revisados a mano, **4 claros y 1 de borde**: `28-…:106` (la forma LITERAL del issue: `ctx.log("…no se puede ejercer aquí"); return;` en el nivel superior), `50-…:103-104` (`tarjeta` sin afirmar: se salta el bloque entero de reanudar), `65-…:324-332` (`nulo`: `editarLedger` devuelve null y calla), `105-…:188-189` (`if (saveB) { expect }`: `modosDelSave` devuelve null en silencio, `:102`). De borde: `07-…:176`, verde vacío si el plan anuncia 0 skins. Tres `return` son código muerto al final de la función (`129:325`, `130:359`, `90:454`). `88:255` es un hallazgo DECLARADO en el log, a propósito, no un salto |
| La otra grafía del mismo agujero | El `if` SIN `else` que envuelve asertos es el mismo salto sin `return`: son **39**. 20 no tienen su condición afirmada en las 30 líneas anteriores, pero casi todos cuelgan de un `.catch` que hace `expect(false)` (`01:79-89`, `13:176-184`, `16:120-131`) o de un `expectEspera` (`80`, `103`, `109`, `110`, `155`, `156`). Todos honestos salvo `105:189` |
| «Cierra la familia C **para siempre**» (cuerpo del issue) | **Falso**, y por dos razones que se pueden comprobar. (1) Un `return` en el nivel superior se salta las llamadas a `ctx.bloque` que vienen después, y el runner nunca se entera de que existían. Es exactamente `28:106`, en el nivel superior del `default` (`:69`). (2) La regla «un bloque sin asertos no se midió» es la de #639 una talla más fina: un bloque que afirma una vez y luego se salta la mitad sigue saliendo verde. La mudez parcial baja un nivel, no desaparece |
| «a medio migrar no canda nada» | Cierto para `ctx.bloque`, y es su coste de verdad: 157 ficheros reindentados |

Límite de mi medida: el filtro «condición afirmada antes» es heurístico y da falsos positivos cuando el identificador es una palabra española que sale en la frase de un `expect` (`dos` en `65:306`). Lo he revisado a mano en los dudosos, pero la cifra es orientativa. La que vale la dará el candado.

## Por qué el punto de corte tiene que ser estático

149 de los 157 guiones abren navegador, y la batería de navegador **no corre en CI** (CLAUDE.md, tabla de candados; `ci.yml`, job `candados-headless`). Una regla en tiempo de ejecución solo se pone roja si alguien corre la batería en local y además la precondición falla ese día. El criterio 2 pide un rojo cuando un guion **escribe** la forma que escapa, y eso solo lo da un análisis del árbol en `npm test`. Es lo que la casa ya hace para guiones: `esperas-que-conducen`, `espera-de-fotogramas-con-dueno` y `sondas-de-movimiento.json`, todos por AST, con padrón y `_lo_que_esto_NO_sujeta`.

## Respuesta a las dos preguntas abiertas

1. **Sí, hay una forma más barata, y además cierra más.** La forma que escapa es sintáctica y se puede decidir en el árbol: un salto (un `return` temprano, o un `if` sin `else` que envuelve asertos) cuya ausencia de medida nadie observa. «Observado» quiere decir que la rama declara (`sinMedir`/`sinMedirBloque`), afirma o lanza, o que su condición se afirmó antes. Cubre el nivel superior, donde `ctx.bloque` es ciego. El cómo es del arquitecto.
2. **La migración total no es proporcionada**: 157 ficheros para 4-5 sitios. Basta el padrón que solo encoge (criterio 4) con esos 4-5 sitios migrados o declarados con su motivo, y el padrón debería nacer vacío o casi.

## El día después (con el reencuadre)

- Para quien juega: nada. Es deuda del banco, declarada en #261/#356.
- Se vuelve más difícil escribir `if (!x) return;` sin un `expect` delante. Es justo lo que se busca, y el molde honesto ya es el 90 % del banco.
- Lo que cierra: el guion que ramifica por datos a propósito, como el 28 con uno o dos estilos. Ese guion tendrá que decir `sinMedirBloque` (⊘, exit 2) o afirmar la rama. Aceptable: es exactamente lo que el issue pide que salga caro.
- Lo que un lector verá como arbitrario dentro de un mes: los agujeros conocidos del análisis estático (helpers que devuelven `null` y afirman dentro, bucles que no se entran, `&&` que cortocircuita). Van en `_lo_que_esto_NO_sujeta` con un `it` que los MIDE, no en prosa.
- Lo que NO debe hacerse: reindentar 157 guiones dentro de `ctx.bloque`, añadir una regex sobre la prosa del log, o prohibir el `return` temprano (lo legítimo es el 97 % de los casos).

## Conflictos

- **#711** (padrón por AST de relojes de pared en guiones): la misma maquinaria de recorrer guiones por AST, en paralelo. Si se hacen por separado, se paga dos veces el recorrido del `default` y su padrón. Que el arquitecto los mire juntos, sin fusionar alcances.
- **#704** (dos copias del visitante del árbol del banco): dependencia oculta. Un tercer consumidor sobre `fuentesDelBanco` duplicado encarece #704. O esta tanda usa `banco-ficheros.ts` (el que sigue los symlinks) y lo dice, o #704 va antes.
- **#693** toca 08/15/74; ninguno de los tres está entre los ocupantes, así que no hay choque de ficheros.
- **`un-numero-un-guion`**: si la prueba en negativo se escribe como un guion nuevo, consume un número. En `nefan-core/test/` no.
- **`banco-medido.json`**: si se añade un `qa/lib/*.mjs`, hace falta que lo importe un test. Con un análisis que vive en `nefan-core/test/` no aplica.
- **Sin contradicción** con `candados-headless` ni con el `⊘` de #331: el canal ya existe y sirve tal cual.

## Coste contra valor

`ctx.bloque` + migración: el diff más grande del banco, conflicto de fusión con cualquier rama que toque un guion, y aun así deja abierto el caso literal del issue. No compensa. El padrón por AST sale a un test, unos 5 sitios y una prueba en negativo. No hacer nada deja la puerta abierta, pero la incidencia medida es baja (4-5 en 157 guiones y meses de escritura). El valor está en el guion de mañana, y por eso tiene que ser un candado en CI y no una revisión.

## Cambios a `requisitos.md` (para pegar tal cual)

> **Reencuadre (crítico, 2026-09-23).** Se sustituye «`ctx.bloque` + migrar 157 guiones» por: *un salto de un guion (un `return` temprano o un `if` sin `else` que envuelve asertos) cuya no-medida nadie observa se pone rojo en `npm test`, por el árbol de sintaxis*. «Observado» = la rama declara `sinMedir`/`sinMedirBloque`, afirma o lanza, o la condición se afirmó antes. `ctx.bloque` queda fuera: no ve un `return` en el nivel superior, que es la forma literal del issue (`28-…:106`).
>
> **Medido (AST + revisión, main 22435005):** 185 saltos con `return` y 39 `if` sin `else` con asertos; salto no observado real en `28:106`, `50:104`, `65:332`, `105:189`, y de borde en `07:176`. El resto es `expect(pre); if (!pre) return;`, que es honesto y NO se toca.
>
> Criterio 5 ampliado: los guiones que cambian de veredicto son, como mucho, esos cinco, y cada uno pasa a afirmar o a declarar `sinMedirBloque` con su causa. Criterio 3: `_lo_que_esto_NO_sujeta` MIDE al menos los helpers que devuelven `null`, los bucles que no se entran y los `&&` que cortocircuitan. Coordinar con #711 y #704 (misma maquinaria de AST sobre `qa/guiones`).
