# QA — tanda AH (#716): el detector de saltos cierra N1-N3

Rama `feature/tanda-ah` en `71abe6ad`, sobre `main` = `83ea6046`. Verificado sin navegador: el sujeto es un candado de `npm test` sobre el árbol de `qa/guiones/*.mjs`, no lo ve el jugador. Todo lo que sigue lo corrí yo en el worktree; las cifras son de hoy, no copiadas de `implementacion.md`.

## Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| 1. N1 (helper tautológico / condicional) cerrado en el detector con negativo | ✅ cumple | `it` «N1a» y «N1b» (42/42 verdes). Negativo probado por mí: con `esObservador` devuelto a la vara vieja (`llamaAsertador`) caen **N1a y N1b** (`pass 40, fail 2`). |
| 1. N2 (`!!true`, `expectEspera(d, true, () => true)` / `(d, false, () => false)`) cerrado con negativo | ✅ cumple | `it` «N2». Negativos: `esContradiccion` solo literal falso → cae **N2**; `esEsperaTautologica` siempre `false` → cae **N2**. Firma real confirmada en `qa/run.mjs:1106` (`desc, debeOcurrir, probeFn`): la tautología se juzga en el 3.er argumento con la polaridad del 2.º, como manda el reencuadre 5. La forma del issue `(d, () => true)` no se trata como predicado (aserto explícito en el `it`). |
| 1. N3 (IIFE con ctx renombrado) cerrado con negativo, en (1) o (12) sin punto (13) | ✅ cumple | «LÍMITE MEDIDO (1)» mide el IIFE `(async (c) => …)(ctx)` → 1 con `{helpers:true}`, 0 en el candado; «(12)» deja de prometer «otro nombre de parámetro» y mide el residuo. Negativos: sin propagación por parámetro cae **(12)**; sin siembra por verbo caen **I1 y (12)**. No hay punto (13). |
| 2. N4 no se toca | ✅ cumple | `esAsertoLaxo`, `esAsertador` y `llamaAsertador` no cambian (diff de `saltos-del-guion.ts`); la llamada con `ctx` no resuelta sigue contando como aserto. |
| 3. `npm test` y `npm run verify` verdes; el padrón no crece | ✅ cumple | `npm run verify` en el worktree: `tests 3267, pass 3267, fail 0`, exit 0. `TECHO = 1` y el array `saltos` del JSON no cambia (el diff solo toca `_comment` y `_lo_que_esto_NO_sujeta`). |
| 4. Ninguna rama antes observada pasa a no observada sin enumerarse | ✅ cumple | Reproducido por mí con el detector de `main` (extraído con `git show 83ea6046:…`) y el nuevo sobre los 157 guiones, fichero+función+línea+forma+condición+`observado`+`porque`: **219 saltos (1 rojo) / 226 con helpers (5 rojos), cero líneas de diferencia** en las dos direcciones. Arnés en scratchpad (`foto.ts`). |
| 5-8 (reencuadre) | ✅ cumple | 5: ver N2. 6: N1b se cierra porque la foto del banco da 0 cambios (medido arriba). 7: el título de (12) ya no dice «otro nombre de parámetro» y (1) mide el IIFE. 8: `helpers-del-banco.ts` y `banco-ficheros.ts` intactos (`git diff --stat`: solo los tres ficheros del plan). |

## Pasada adversarial (arnés `adv.ts`, 27 formas contra el detector nuevo)

Busqué formas NUEVAS que escapen y, en la dirección insegura, ramas que el nuevo detector EXCUSE y el viejo no. 15 salen como se espera (incluidos los controles y los falsos rojos seguros: `switch` con `default`, `do…while`, método no resoluble). 12 se desvían; ninguna tiene ocupantes hoy en `qa/` (grep de cada forma: 0; los dos `!==` del banco comparan `v.path` con `path` y `e.prompt` con `prompt`, no son `x !== x`; **1976/1976** receptores de `.expect/.expectEspera/.sinMedir/.sinMedirBloque` son `ctx`; ninguna función de `qa/` lleva `expect` desestructurado en la firma).

## Hallazgos

**H1 — importante (dirección insegura, hueco que la prosa nueva casi niega).** El ctx desestructurado **en la firma** del helper —`async function av({ expect }, y) { expect("z", y.ok); }`, llamado `av(ctx, x)`— no se sigue: `aliasDeCtx` solo propaga el parámetro si es identificador (`ts.isIdentifier(p)`), y el patrón no entra en `sueltos`. Consecuencias medidas: (a) un salto DETRÁS de ese helper no se detecta, en el **mismo módulo** y en `qa/lib` (arnés: `N3-param-pattern-*` → 0 rojos, esperaba 1); (b) la medida (1) no ve el IIFE `(async ({ expect, log }) => …)(ctx)` (0, esperaba 1). El padrón (12) solo declara «el parámetro de un helper de **OTRO** módulo que nunca llama a un verbo por su nombre», y el comentario del `it` (12) afirma «En el MISMO módulo el parámetro se sigue aunque solo se desestructure» — cierto para `const { expect } = c`, **falso** para `({ expect })` en la firma. Es el mismo tipo de hueco que abrió #716: un residuo real que el padrón no nombra. Qué esperaba: o se cierra (cuando `p` es un `ObjectBindingPattern`, volcar sus elementos en `sueltos`, simétrico al caso de declaración) con su negativo, o (12) dice «desestructurado en la firma, en cualquier módulo» con un `it` que lo mida. Reproducción: los tres casos del arnés. Cero ocupantes; existía ya en `main`, no es regresión.

**H2 — menor.** `esContradiccion` no es el espejo de `esTautologia`: `!(x && false)` y `!(x !== x)` son tautologías **por forma** y pasan por observadores (`N1-!(y&&false)`, `N2-!(x&&false)`, `N1-!(y!==y)` → 0), y `ctx.expect("pre", !(x && false))` además «observa» `x` por átomos delante de `if (!x) return` (`N2-pre-!(x&&false)` → 0). El punto (11) lista las formas con «…», así que no miente de plano, pero es exactamente la pareja de `!!true` que este issue cerró. Sin ocupantes.

**H3 — menor (prosa > código).** La sonda de `expectEspera` en línea con MÁS de una sentencia (`() => { ctx.log("p"); return true; }`) no se juzga (`devuelveLaSonda` exige un único `return`), pero (11) y la cabecera dicen «la sonda … escrita en línea con una polaridad literal» sin decir «con un único `return`». Sin ocupantes (0 `expectEspera` con sonda de bloque en `qa/`).

**H4 — menor (dirección segura, pero castiga la forma honesta).** La salida honesta que el propio padrón recomienda, dentro de un helper —`if (!y) { ctx.sinMedirBloque("sin y"); return; } ctx.expect("z", y.ok);`— **no afirma siempre** (`N1-guarda-honesta` → 1 rojo, esperaba 0): la regla «un `if` cuenta solo si afirman sus dos ramas» no ve que la rama que retorna ya declaró. Está escrito en la prosa, así que no es hueco callado, y hoy ningún salto del banco se excusa por un helper (medido en `implementacion.md` y coherente con mi foto). Pero es el riesgo que el plan §8 nombró: empujar a reescribir helpers honestos para contentar al detector. Propuesta: en `secuenciaAfirma`, un `if` cuya rama `then` afirma y contiene el `return` no corta la secuencia.

**H5 — menor (dirección insegura, sintético).** La siembra por verbo no tiene ámbitos y la prosa la vende solo como «SOBRECUENTA» (dirección segura). No solo detecta: también **excusa**. Con un objeto ajeno `t.expect(…)` en el guion, `const e = t.expect` pasa a verbo suelto y `e("z", x.ok)` en la rama la observa (`N3-sobrecuenta-suelto` → 0; con el detector de `main` esa rama era roja). Hoy 1976/1976 receptores son `ctx`, así que no muerde; conviene que el comentario de `aliasDeCtx` diga que sobrecontar también excusa.

**H6 — trivial.** `x ? true : true` y `` `ok${y}` `` como 2.º argumento no se reconocen como tautología. Caben en el «…» de (11); sin ocupantes.

## Workarounds usados

- Ninguno sobre el sujeto. El detector de `main` lo copié al scratchpad con el import de `helpers-del-banco` en absoluto para la foto del banco; no toca el árbol.
- Mi primer sabotaje S3 (`m.ctxs.add(p.text)` → `void p` dejando `cambio = true`) colgó el punto fijo: error de mi receta, no del detector; se repitió anulando la condición entera. Los cinco sabotajes se restauraron con `git checkout --` y `git status` queda limpio (solo la carpeta de la tarea sin trackear).
- No se mató ningún proceso: el `node --test` con la suite entera que apareció en `pgrep` es de otra sesión.

## No probado

- Mutación, CRAP y `ejercicio`: los tres ficheros viven en `test/` y `data/contract/`, fuera del núcleo medido; no aplican.
- Navegador / `qa/run.mjs`: el cambio no toca ningún guion ni nada que el jugador vea. No hay guion 161: lo mecánico ya vive en los `it` de `un-salto-del-guion-se-observa.test.ts` (corren en cada PR), y un `.mjs` en `qa/guiones/` no puede importar el detector TS sin tsx. Las 27 formas del arnés adversarial están enumeradas arriba con su resultado para que el ingeniero las pegue como casos.

## Veredicto

**Apto con reservas.** Los cuatro criterios y el reencuadre se cumplen, cada negativo lo vi ponerse rojo, y el banco no cambia ni una línea. La reserva es H1: el patrón desestructurado en la firma es un residuo real en la dirección insegura que la prosa nueva de (12) acota a «OTRO módulo» y que un comentario del test da por seguido; o se cierra o se declara con su `it` antes de mergear, porque la tanda existe para que el padrón no prometa lo que no mide. H2-H6 son backlog.

## Vuelta 2 (re-QA sobre `6977286f`)

Re-verificados SOLO los hallazgos H1-H5 y una pasada adversarial nueva sobre lo que cambió (`evidenciaDeCtx`, `esContradiccion` espejo, `devuelveLaSonda` por todos sus `return`, la medida (1) por verbo suelto). Cifras de hoy, corridas por mí.

| Hallazgo | Estado | Evidencia |
|---|---|---|
| H1 patrón `{ expect }` en la firma | ✅ cerrado | Arnés: mismo módulo, `qa/lib`, IIFE con patrón en la firma, patrón con rename `{ expect: e }` y anidado `{ ctx: { expect } }` → todos 1 rojo (antes 0). Negativo: `evidenciaDeCtx` devolviendo `null` para patrones → caen **(1) y (12)**. El comentario falso «en el MISMO módulo el parámetro se sigue aunque solo se desestructure» ya no existe; (12) acota el residuo a la clave calculada `c[v](…)` y su `it` lo mide (arnés: 0, como declara). |
| H2 espejo de la contradicción | ✅ cerrado | `!(y && false)`, `!(y !== y)` en helper y en rama, y `ctx.expect("pre", !(x && false))` como precondición → 1 rojo cada uno. Negativo: `esContradiccion` sin la parte binaria → cae **N2**. |
| H3 sonda de varias sentencias | ✅ cerrado | `() => { ctx.log("p"); return true; }` y `() => { if (x) return true; return !!true; }` → 1 rojo; `() => { if (x) return true; return x.ok; }` sigue observando. Negativo: sonda limitada a un único `return` → cae **N2**. |
| H4 guarda honesta en helper | ✅ declarado y contado | En `_comment` (OBSERVADOR: «la guarda honesta DENTRO de un helper … no afirma siempre»), en la cabecera del detector y con aserto en `N1b` (1 rojo, mensaje que dice qué retirar si se cierra). Dirección segura. |
| H5 siembra sin ámbitos excusa | ✅ declarado con cifra | (12) dice ahora que un objeto AJENO con `.expect` «no solo sobrecuenta saltos, también los EXCUSA» y el `it` (12) recorre TODO `fuentesDelBanco(QA)` con `evidenciaDeCtx` exigiendo `["ctx"]`: cualquier receptor o patrón con verbo que no sea `ctx` lo pone rojo. Mi censo independiente: **2010 receptores de `.expect/.expectEspera/.sinMedir/.sinMedirBloque` (llamados o leídos), todos `ctx`; 0 patrones con esos nombres** que no vengan de `ctx`. |

**¿Reconocer el ctx por verbo excusa ramas que antes se detectaban?** En el banco, no: foto `main` → `6977286f` con y sin `{helpers:true}`: 219 (1 rojo) / 226 (5 rojos), cero líneas de diferencia. En sintético, sí, y solo por objetos o patrones AJENOS con nombre de verbo (`const { expect } = otro()`, `const e = t.expect`, un helper de lib con `const { expect } = harness()` llamado sin ctx: los tres excusan la rama). Los tres caen bajo la cifra del `it` (12), que hoy es 0. Un efecto de segundo orden de la misma raíz: un patrón ajeno con un verbo vuelca **todos** sus elementos en `sueltos`, y si uno de ellos se llama como una función local asertadora (`const { expect, comprobar } = cfg(); async function comprobar(c, y) {…}`), la llamada deja de resolverse y el salto que la deja detrás se pierde (arnés `V2-colision-fn-local` → 0; con `main`, 1). Mismo cortafuegos: la cifra de (12) lo pone rojo en cuanto exista un patrón así. Lo anoto para que la prosa no lo pierda; no bloquea.

Además: `npm run verify` sobre `6977286f`: `tests 3267, pass 3267, fail 0`, exit 0; test del detector 42/42; negativo extra: la medida (1) sin la entrada por verbo suelto → cae **(1)**. Solo cambiaron los tres ficheros del plan; `git status` limpio tras los sabotajes.

**Restos (triviales, sin ocupantes, backlog):** una sonda cuyo bloque no acaba en `return` (`() => { try { return true; } catch { return true; } }`) no se juzga (`devuelveLaSonda` → `null`) y cuenta como observador; y (12) mide patrones y receptores pero no dice en prosa el efecto de colisión de nombres de arriba.

**Veredicto de la vuelta 2: APTO.** H1-H3 cerrados con negativo visto en rojo, H4-H5 declarados con cifra medida, el banco no cambia ni una línea, `verify` verde.
