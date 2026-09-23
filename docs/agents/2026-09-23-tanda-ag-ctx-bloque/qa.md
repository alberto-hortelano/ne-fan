# QA — tanda AG: un salto que nadie observa se pone rojo (#356)

Rama `tanda/ag-ctx-bloque`, commit `6d338bc1`, worktree `/home/al/code/ne-fan-tanda-ag`. Se valida contra
la petición y el **reencuadre aprobado** de `requisitos.md`. No se ha tocado código: todos los
sabotajes se revirtieron y al terminar `git status` estaba limpio (salvo este fichero).

## Criterios → veredicto

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Un salto por precondición sin asertar no sale verde; sale `⊘` o afirma | ✅ cumple (estático) · ⚠️ `⊘` en navegador no probado | La forma LITERAL del issue, escrita en disco en el cuerpo principal de `02-colision-desde-huella.mjs` y detrás de 4 asertos (`const precondicion = await ctx.page.evaluate(…); if (!precondicion) { ctx.log("⚠ no se pudo medir X"); return; }`), pone rojo `TOTALIDAD` y nombra el sitio: `qa/guiones/02-colision-desde-huella.mjs:56 [return] !precondicion — \`precondicion\` no se afirma antes ni lo inicializa algo que afirme`. El mensaje da las dos salidas (expect / sinMedirBloque, regla 6). Los 10 guiones con saltos pasan a afirmar o a declarar (ver fila 5) |
| 1b | La misma forma dentro de una función anidada | ⚠️ fuera del ámbito, y declarado | Como helper con parámetro `ctx` (`async function medirY(ctx)`): se pone rojo, pero de rebote, porque `LÍMITE MEDIDO (1)` compara la lista exacta de helpers (3 → 4). Como cierre sin parámetro (`const medirX = async () => {…}` que captura `ctx`): **verde, 30/30**. Está dentro del «sin funciones anidadas» del ámbito, pero la medida del punto (1) solo cuenta funciones con parámetro `ctx` (hallazgo M1) |
| 2 | Candado ejecutable por árbol, sin regex sobre la prosa | ✅ cumple | `test/un-salto-del-guion-se-observa.test.ts` + `test/saltos-del-guion.ts`, dentro de `npm test`. Recorre el AST de TypeScript y compara el 2.º argumento de `expect`, nunca la frase (unitario «la FRASE del expect no observa»). Todo el fichero de test: 30 tests, 1,3 s |
| 3 | Probado en negativo + `_lo_que_esto_NO_sujeta` medido (helpers null, bucles, `&&` como mínimo) | ✅ cumple lo pedido · ❌ **la declaración está incompleta** | Hay negativos permanentes sobre 50, 28, 105 y `qa/lib/sesion.mjs`, más el mío sobre el 02. Los 10 puntos declarados tienen su `it` LÍMITE MEDIDO y pasan. Pero la pasada adversarial encuentra formas que escapan y **no están declaradas**: I1 e I2 |
| 4 | El padrón solo encoge (trinquete) | ✅ cumple | Con `TECHO=0` sale `el padrón solo encoge: tiene 1 entradas y TECHO es 0`, y con `TECHO=2` sale `el padrón ha encogido: baja TECHO a 1`: rojo en los dos sentidos, revertido. El padrón nace con 1 entrada (73), con motivo |
| 5 | Ningún guion cambia de veredicto salvo los que se saltaban un bloque, enumerados | ✅ cumple | `node qa/run.mjs 07 14 17 28 50 65 73 74 88 105 127 134`: los 12 salen ✔ (log en `scratchpad/bateria-ag-qa.log`). Los asertos nuevos se ejecutan: `✔ el batch pidió al menos un skin…`, `✔ el alta devuelve el id…`, `✔ CONTROL: el centro de casa_concejo…`, etc. El runner filtra por subcadena y corrió 26 guiones: 25 ✔ y 1 ⊘ (141, que no tiene grabaciones en el worktree y no tiene nada que ver con esta tanda). EXIT 2 por ese ⊘ |
| 6 | No se prohíbe el `return` temprano ni se mira la prosa | ✅ cumple | El molde `expect(pre); if (!pre) return;` y la rama que declara salen observados. 215 saltos en el banco y 1 sin observar (el del padrón) |
| — | `npm run verify` | ✅ | `EXIT 0` · `ℹ tests 3255 · pass 3255 · fail 0` (`scratchpad/verify-ag-qa.log`) |
| — | ¿El candado dice lo que comprueba? (fila de CLAUDE.md y regla 6 de `qa/README.md`) | ❌ **dice más de lo que comprueba** | La fila dice «**todo** `return` temprano o `if` con una rama muda en el cuerpo de un guion está OBSERVADO … o está en el padrón». Es falso para las formas de I1 e I2, que salen verdes y no están en `_lo_que_esto_NO_sujeta`. La regla 6 remite a la lista de lo no sujeto, pero esa lista no las recoge |

## Hallazgos

### Importantes

**I1. Un salto cuyos asertos de detrás son helpers no cuenta como salto, y tampoco se declara.**
Un `return` solo es «salto» si detrás hay un `ctx.expect`/`ctx.expectEspera` escrito así, en el cuerpo
principal. La `rama-muda` exige también un `ctx.expect` directo en la rama. Cuando lo que se salta es
un helper que afirma (`afirmar(ctx, …)` o `afirmarPose(ctx, …)` de `qa/lib`, que es un estilo habitual
del banco), el detector ve **0 saltos** y el guion sale verde:
```js
ctx.expect("a", true);
const pre = await ctx.page.evaluate(() => 1);
if (!pre) { ctx.log("no"); return; }
await afirmarPose(ctx, pre);          // ← 0 saltos, verde
if (pre) { await afirmarPose(ctx, pre); }   // ← rama-muda no detectada, verde
```
Esto no es el punto (1) declarado: el punto (1) habla de saltos DENTRO de un helper, y aquí el salto
está en el cuerpo principal y lo que se salta es un helper. Medido en el banco real (AST, `if`+`return`
en el cuerpo principal sin `ctx.expect` detrás y con llamadas que reciben `ctx`): **2 sitios hoy**,
`68:121` (`if (!vuelta) return;`, honesto porque `reanudar` afirma) y `87:162` (declara `sinMedir`).
Hoy no hay ninguno roto, pero la forma literal del issue se puede escribir mañana en cualquier guion
que afirme con helpers.
*Reproducir:* `npx tsx scratchpad/adv2.ts`, casos X, X2 y X3.
*Qué esperaba el usuario:* que «el guion que escribe la forma que escapa» se ponga rojo. Aquí la
escribe y sale verde.

**I2. Otras formas que escapan y no están declaradas** (sintéticas, `scratchpad/adv.ts` / `adv2.ts`;
ninguna tiene ocupantes en el banco de hoy):
- **Alias o destructuring de `ctx`**: con `const c = ctx; … c.log(); return; c.expect(…)` o con
  `const { expect, log } = ctx`, el detector ve 0 saltos. `verbo()` solo reconoce el identificador
  literal `ctx`.
- **`return` dentro de un `switch`** (`switch (pre) { case 0: ctx.log(); return; }`) y **`return`
  dentro de un `catch`** en el cuerpo principal (`try {…} catch { ctx.log(); return; }`): 0 saltos. El
  punto (5) declara el `catch` que solo registra, no el `catch` que retorna y se salta el resto del
  guion, que es la forma literal del issue con otra sintaxis.
- **`ctx.expect("no se pudo medir X", true)` en la rama**: la rama cuenta como observada, suma una
  afirmación y el guion sale verde. `esExpectFalse` separa el `false` literal, pero el `true` constante
  pasa como observador. Lo mismo con un aserto previo tautológico (`expect("p", Boolean(pre) || true)`,
  `pre === pre`).
- **`return 0` hace «afirmante» a un helper**: `isNumericLiteral` cuenta cualquier número como valor
  construido, también el 0, que es falsy. `const n = await contar(ctx); if (!n) { ctx.log(); return; }`
  sale observado aunque `contar` devuelva 0 sin afirmar nada. Es un fallo de la definición, no un
  límite: el contrato dice «número» cuando debería decir «número distinto de 0».
  (`return []` con `if (!xs.length)` entra en el punto (7), el átomo por raíz.)

Sale ROJO, como debe: `ctx["expect"]` dinámico, la cadena `else if`, el `if (x) {} else return`, el
`return` dentro de un `for`, el `.catch` que solo registra, el `throw` dentro de un callback de la
rama, el `expect` dentro de un callback que no se llama y el `expect(frase, true, pre)` (con la
variable en el 3.er argumento).

### Menores

**M1. El punto (1) mide menos de lo que el ámbito excluye, y su rojo invita a no arreglar.** La medida
solo cuenta funciones con un parámetro `ctx`. Un cierre que captura `ctx` (`const medirX = async () =>
{ if (!pre) { ctx.log(); return; } ctx.expect(…) }`) sale verde y no mueve ninguna cifra. En el banco
hay 1 hoy, `60:369` `reanudarYAfirmar`, que es honesto. Además, cuando un helper con `ctx` nuevo se
salta sus asertos, el rojo llega por `LÍMITE MEDIDO (1)` con el mensaje «reescribe la cifra del punto
(1)». Ese mensaje pide añadir el helper a la lista, no arreglar el salto.

**M2. Falsos rojos por flujo de datos** (en la dirección segura). Tres casos: una variable derivada de
la afirmada (`expect(Boolean(partida)); const sesion = partida?.sessionId; if (!sesion) return`), un
`await ctx.expectEspera(…)` sin capturar su resultado seguido de una lectura, y un `expect("…",
esLista(xs))` seguido de `if (!xs)`. Los tres salen rojos. En el banco real hizo falta ajustar 3 de
216: 07 (un `expect` redundante), 74 (una condición reescrita a su equivalente literal) y 73 (al
padrón). Es un coste razonable y el mensaje dice cómo salir.

**M3. La rama `⊘` del 105 no se alcanza en el flujo real.** Con `--url` contra un stack propio
(`NEFAN_PORT_OFFSET=1300 ./start.sh --preset e2e-sin-creditos`), el runner no llega a correr el 105:
`⊘ PRECONDICIÓN NO GARANTIZADA: necesita [saves] virgen y el stack no lo arrancó esta corrida`. Con
disco efímero, `esperarPartidaEnDisco` garantiza el save. Por tanto el `sinMedirBloque` de B (igual que
el de A, que ya existía) solo se toma en una carrera en la que el bridge ya lista la partida y el disco
todavía no la tiene. En ese caso el motivo, «sin disco efímero (stack adoptado)», sería falso. Es poco
probable y no es regresión.

**M4 (no es de esta tanda).** `qa/run.mjs` filtra los ids por subcadena: al pedir 12 guiones corrió
26. Hace falta saberlo para leer el log.

## Workarounds usados

- Stack propio en `+1300` y `--url` para intentar forzar el `⊘` del 105. Es un modo documentado del
  runner, no un apaño, y el runner lo rechazó por su precondición. Paré el stack con TaskStop, que solo
  cierra lo que lanzó mi launcher, y comprobé que los puertos quedaron libres. No hubo `pkill` ni
  `--parar-todo`.
- Las inyecciones en `02` y los cambios de `TECHO` se hicieron en disco y se revirtieron (con `cp` del
  respaldo y `git checkout`). La pasada adversarial se hizo con el detector en memoria, en scripts del
  scratchpad, sin tocar el repositorio.

## No probado

- El `⊘` del 28 en navegador. El bench ofrece 4 estilos para `cuentos_oscuros` y solo se forzaría
  editando datos de juego, que es un workaround y no lo hice. El canal `sinMedirBloque` es maquinaria
  previa (#261); lo que aporta esta tanda es estático y está cubierto por el negativo permanente del 28.
- El `⊘` del 105: ver M3.

## Guion ejecutable

No añado ninguno en `qa/guiones/`. El candado vive en `nefan-core/test/` y corre en cada PR con `npm
test`, y un guion de navegador no correría en CI ni aportaría nada que el test no mida ya. Lo mecánico
de esta QA son los casos adversariales. Su sitio natural es el propio test: cada forma de I1 e I2 debe
entrar como regla nueva (con su negativo) o como punto `LÍMITE MEDIDO` en `_lo_que_esto_NO_sujeta`. Los
arneses están en el scratchpad de la sesión (`adv.ts`, `adv2.ts`, `adv3.ts`, `medir-x.ts`,
`medir-cierres.ts`) para que el ingeniero los copie.

## Veredicto

**Apto con reservas.** El caso literal del issue se pone rojo en `npm test` y nombra el sitio. El
trinquete funciona en los dos sentidos, `verify` y la batería de los 12 guiones salen verdes, y no hay
cambios de veredicto sin explicar. La reserva es el criterio 3 y la honestidad del candado: la fila de
CLAUDE.md promete «todo `return` temprano», y hay formas sencillas que escapan sin estar declaradas. La
más importante es I1 (asertos de detrás en helpers), seguida de alias o destructuring de `ctx`,
`switch`/`catch` con `return`, `expect(…, true)` y `return 0`. Antes de cerrar #356 hay que cerrarlas o
declararlas con su medida.

---

# Vuelta 2 (commit `a3af3ee5`)

Se re-verifica la corrección de I1, I2, M1 y M3. Reverti todos los sabotajes; `git status` quedó limpio antes de commitear este fichero.

## Criterios → veredicto (vuelta 2)

| Criterio | Veredicto | Evidencia |
|---|---|---|
| I1: asertos de detrás hechos en helpers | ✅ cerrado | Los casos X, X2 y X3 de `adv2.ts` salen ROJOS. En el banco real, 68:121 y 87:162 cuentan ahora como saltos, y los dos salen observados. Lo saboteé en disco en el 68 (`reanudar(…)` → `ctx.page.evaluate(() => 1)`): rojo con `68-…:121 [return] !vuelta — \`vuelta\` no se afirma antes…`, y después lo revertí |
| I2: alias, `switch`, `catch`, `expect(true)`, `return 0` | ✅ cerrado o declarado | Salen ROJOS A, A2, B, F, F2, I, D, D2, D4, M y W. `const {expect: e} = ctx`, `expect(frase, 1)` y `expect(frase, "si")` también salen rojos |
| Cierres que capturan `ctx` (M1) | ✅ | Inyecté en disco, en el 02, el cierre `const medirX = async () => { if (!pre) { ctx.log(); return; } ctx.expect(…) }`. Sale rojo por la medida del punto (1), y el mensaje ahora pide «lo primero es ARREGLARLO… solo si es honesto… se añade aquí». Revertido |
| Trinquete `TECHO` | ✅ | Con 0 sale «solo encoge»; con 2 sale «baja TECHO a 1». Revertido |
| La redacción de CLAUDE.md y `qa/README.md` frente al test | ✅ dicen lo que comprueba | La fila enumera las formas (`return` tras `if`/`case`/`catch` o sin guarda, y la rama muda, con asertos propios o de helpers) y dice «NO es “todo salto”», con remisión a los 12 puntos. El README dice «Parte de esto ya no es prosa… No ve todas las formas». Una sola imprecisión: la fila dice que no ve las funciones anidadas, pero en la práctica un salto nuevo en una de ellas SÍ se pone rojo por la medida del punto (1). Dice menos de lo que hace, que es la dirección buena |
| `npm run verify` | ✅ | `EXIT 0` · `tests 3264 · pass 3264 · fail 0` (`scratchpad/verify-v2-ag-qa.log`) |
| Navegador: 105 (con la «A» = el bloque `saveA`), 68 y 87 | ✅ | `node qa/run.mjs 105-una 68-la 87-el` → 3 ✔, EXIT 0. En el 105 se ejecutan los asertos nuevos: `✔ el save de A está en el disco efímero de la corrida`, `✔ el save de B está en el disco efímero…` y `✔ y el save de B guarda image…` (`scratchpad/bateria-v2-ag-qa.log`). M3 queda resuelto: el motivo falso («stack adoptado») desaparece y ahora es un `expect` tras esperar al `state.json` |

## Arneses de la vuelta 1, uno por uno

De 38 casos en `adv.ts` quedan 12 verdes, de 6 en `adv2.ts` queda 1, y de 7 en `adv3.ts` quedan 4. Coincide con lo que dice el ingeniero.

| Verde restante | ¿Correcto o declarado Y medido? |
|---|---|
| C (el `throw` que se traga su `catch`), O (observador condicionado) | Declarados en (9), con su `it` |
| D5 (`typeof`), S (`NO === false`) | Declarados en (11), la tautología por valor |
| E (rancia), E2 (sombreado) | Declarados en (6) |
| E3 | **Correcto**: es la misma `x` del módulo, y está afirmada |
| G (callback de Promise) | Declarado en (1) |
| J2 (afirmante que siempre devuelve `true`) | **Correcto**: esa rama no se puede tomar |
| J4, W2 | Declarados en (7), el átomo por raíz |
| K (`break <etiqueta>`) | Declarado en (4) |
| R (`while` con `break`) | Declarado en (2) y (4) |
| h1, h2, h6, h7 | **Correctos**: son moldes honestos |

## Reglas nuevas: ¿abren falsos verdes o falsos rojos? (`scratchpad/adv4.ts`)

**Falsos verdes nuevos, ninguno declarado.** Los cinco son menores: ninguno tiene ocupantes en el banco, y hay que escribirlos casi a propósito.
- **N1.** Un **asertador tautológico o condicional** excusa la rama. `if (!pre) { await afirmaTrue(ctx); return; }`, con `afirmaTrue` que solo hace `ctx.expect("ok", true)`, sale observado. Lo mismo con un helper que afirma bajo `if (globalThis.DEBUG)`. `esTautologia` solo mira el `expect` directo, y el «cuerpo aserta» del asertador no aplica la tautología ni la condición. Es (9) y (11) un nivel más abajo, y ninguno de los dos lo dice.
- **N2.** `ctx.expect("x", !!true)` y `ctx.expectEspera("x", () => true)` en la rama pasan por observadores. La forma `!!true` no la reconoce, y la tautología no se aplica al predicado de `expectEspera`. (11) dice «solo se reconoce por la forma», pero estas también son formas.
- **N3.** Un IIFE con el parámetro renombrado, `await (async (c) => { … if (!pre) { c.log(); return; } c.expect(…) })(ctx)`, sale verde. Es una función anidada (1), pero la medida del punto (1) solo cuenta funciones que usan el identificador `ctx`, así que tampoco lo cuenta.

**Falsos rojos.**
- **N4.** Un guarda seguido solo de una llamada **no resuelta** que recibe `ctx` (por ejemplo `import * as lib`, luego `if (!hayMas) return; await lib.limpiar(ctx);`) se pone ROJO. Es la regla «llamada con ctx no resuelta cuenta como aserto». La dirección es la segura, y hoy hay **0** guiones con `import *`, así que no afecta al banco.
- **Sin falso rojo:** un guarda seguido de un helper resuelto que no asierta, de `ctx.shot` o de un callback con `ctx` no cuenta como salto. Un `catch`/`case` con `sinMedir` o `expect(…, false)` sale observado. En el banco real siguen 217 saltos con 1 sin observar (el 73 del padrón).

## Veredicto final

**Apto.** La reserva de la vuelta 1 queda resuelta:
- I1 e I2 están cerrados.
- Lo que el detector no ve está declarado, en 12 puntos medidos.
- CLAUDE.md y el README ya no prometen «todo salto».
- M1 y M3 están corregidos, con el 105 afirmando en navegador.
- `verify` sale verde y el trinquete aguanta.

Lo que queda (N1 a N4) son formas que hay que escribir casi a propósito y que no tienen ocupantes en el banco. Se pueden resolver en una línea cada una, sin nueva vuelta: añadirlas a (9) y (11) de `_lo_que_esto_NO_sujeta` (asertador tautológico o condicional, `!!true`, `expectEspera(() => true)`), y a (1) el IIFE con `ctx` renombrado.
