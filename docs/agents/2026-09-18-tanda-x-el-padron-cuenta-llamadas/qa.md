# QA — tanda X (#686): el padrón cuenta SITIOS DE USO

Validado sobre la rama `feature/tanda-x-el-padron-cuenta-llamadas` (`d769ca8f` + `9f96a1ab`), en el
worktree `/home/al/code/ne-fan-tanda-x-el-padron-cuenta-llamadas`. Sin stack ni batería de navegador: el
cambio son dos tests de `nefan-core/test/` y dos JSON de contrato. El árbol principal
(`/home/al/code/ne-fan`) se ha usado SOLO en lectura, para el censo de `qa/` con capturas presentes.

Todo lo que se dice abajo se ha medido corriendo el detector y el candado NUEVOS (importados desde el
test del worktree) o los tests reales; nada se aprueba por parecido. Todos los negativos se revirtieron:
`git status --short qa/` vacío al final, `qa/capturas` y `qa/.oculto` ausentes.

## Criterios (de la petición, con las precisiones del crítico aceptadas)

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | El padrón cuenta las llamadas que cuelgan de un alias y se pone ROJO cuando N cambia; las nueve cifras iguales sin tocar guiones; el experimento de QA sobre el 119 da 8 | ✅ para las formas que el crítico fijó (`const x = ….probeCollide` / `[…"probeCollide"]` / `"probeCollide"` / desestructuración / re-alias / parámetro con defecto) — ⚠️ como promesa general: hay formas de alias que siguen valiendo 1 para N llamadas (hallazgo I-1) | Test aislado `21/21`. Padrón sin cambio de números (`git diff`: solo `apariciones`→`consultas` y prosa) y test verde ⇒ el detector nuevo reproduce 1·1·1·3·1·1·1·1·2. **Negativo 1 reproducido por mí**: siete `pc(i, i)` tras el ancla del 119 real → `pass 18 · fail 3`, con `…119…: 8 en el árbol contra 1 declaradas`; `git checkout` → limpio. Formas del coordinador: `const n = window.__nefan; n.probeCollide(a,b)` ×2 → 2 ✅; `window["__nefan"]["probeCollide"]` ×2 → 2 ✅ (y como alias con 3 usos → 3 ✅); `.call(null,a,b)` directo y sobre alias ×2 → 2 ✅ (`.apply` igual) |
| 2 | La indirección por `qa/lib/` no escapa o se declara y se MIDE; se cierran re-alias y string en `const` | ✅ | `it` re-alias por punto fijo (alias declarado DESPUÉS) = 2 ✅; `it` `const S = "probeCollide"` + 2 `ctx.nefan(S,…)` = 2 ✅; `it` LÍMITE cruce de fichero = 0 en guion y 0 en lib, y punto (4) del padrón lo declara. Verificado el sujeto: `grep -rn probeCollide qa/lib/` = 0 líneas (ni siquiera `sonda.mjs` lo escribe: despacha por `hook[p]`) |
| 3 | Los tres ficheros con alias (93, 119, 133) pasan sin cambios de código | ✅ | `git diff a25d8c2f --stat -- qa/guiones/93-* 119-* 133-*` vacío (byte a byte). Único diff bajo `qa/`: una frase de comentario del 145 (prosa, desviación declarada y correcta: era el rastro «cuenta NODOS») |
| 4 | `.ts` bajo `qa/` entra en el censo de este candado Y de `qa-lib-tiene-quien-lo-mire` (decisión: lista blanca de extensiones, §3-B) | ❌ **el candado está ROJO en cualquier checkout donde se haya corrido el banco** (hallazgo B-1). El mecanismo es correcto y su negativo funciona; el barrido clasifica mal un symlink | Premisa verificada: Node `v24.11.1`; un `g.mjs` con `import { f } from "./x.ts"` corre sin tsx (`TS-IMPORT-OK 2`). **Negativo 2 reproducido**: `touch qa/lib/x.ts` → `pass 13 · fail 1` con el mensaje del candado; `rm` → limpio. **Pero** el candado nuevo corrido sobre `/home/al/code/ne-fan/qa` (14.861 ficheros, solo lectura) da `foráneos=["qa/capturas/ultima"]`, y reproducido en sitio en el worktree (`mkdir qa/capturas/<run> && ln -s <run> qa/capturas/ultima`) → `pass 13 · fail 1`, el mismo `it` |
| 5 | `_lo_que_esto_NO_sujeta` actualizado: lo que se cierra sale; lo que queda se mide | ⚠️ parcial | Sale el (3) falso («se llama 7 veces»: `grep '7 veces'` = 0). Los cinco declarados tienen `it` y las cifras casan (nombre partido 0; `map(pc)` 1 y `f(pc)` 1; cruce 0/0; sombreado 3). Pero la pasada adversarial encontró **tres familias de alias que subcuentan y no están declaradas ni medidas** (hallazgo I-1), y el barrido del padrón excluye directorios que el candado de extensión no excluye (hallazgo M-1). «CINCO agujeros conocidos» vuelve a ser una enumeración cerrada sobre un detector con más de cinco |
| — | Greps a cero (§5 del plan) | ✅ | `"apariciones"` / `.apariciones` / `apariciones(` en `nefan-core/{test,data/contract,src}`, `CLAUDE.md`, `qa` → 0. `cuenta NODOS` en `CLAUDE.md`, contratos, tests, `qa/`, `docs/arquitectura` → 0 |
| — | `npm run verify` | ✅ | Reproducido en el worktree: `rc=0`, `tests 3131 · pass 3131 · fail 0`, 0 `not ok` |

## Hallazgos

### B-1 (bloqueante) — La lista blanca se pone roja con `qa/capturas/ultima`, que lo crea CADA corrida del banco

**Reproducción desde el arranque**: en cualquier checkout, `node qa/run.mjs` (o un solo guion) y después
`cd nefan-core && npm test`. `qa/run.mjs:549` (`apuntarUltima`, se llama desde `salir()`) deja
`qa/capturas/ultima -> <RUN_ID>`, un **symlink a directorio** documentado en `qa/README.md:38` y afirmado
por `qa/dos-corridas.mjs`. `readdirSync(…, {withFileTypes:true})` no lo da como directorio
(`isDirectory()` es `false` en un enlace), así que `ficherosBajo` lo empuja como fichero, `ultima` no
tiene punto, `extensionesForaneas` lo señala y el `it` «bajo qa/ no hay ninguna extensión fuera de la
lista blanca» falla.

**Medido**: sobre el árbol principal, `ficherosBajo("/home/al/code/ne-fan/qa")` = 14.861 rutas,
`extensionesForaneas` = `["qa/capturas/ultima"]`. En sitio (worktree, symlink sintético igual al real):
`pass 13 · fail 1`. `ls -la /home/al/code/ne-fan/qa/capturas/ultima` →
`lrwxrwxrwx … ultima -> 2026-09-18T10-35-16-926Z-443939`.

**Por qué no lo vio el ingeniero**: midió «0 fuera de la lista blanca» con `find -type f`, que **no lista
symlinks**. La medida no medía lo que el barrido ve. Es la lección repetida de la casa: el candado
comprueba menos (aquí, otra cosa) de lo que dice su medida.

**Qué esperaba el usuario**: que `npm test` siga verde después de correr el banco, que es el flujo que
`CLAUDE.md` prescribe («Tests automatizados tras cada cambio visual — `node qa/run.mjs`»). El día de la
fusión, el árbol principal del coordinador está rojo. El CI no lo verá (`qa/capturas/` está en
`.gitignore`, `ci.yml:139` corre sobre un clon limpio): es un rojo que solo aparece en local, en todas
las máquinas, y que el runner no puede avisar.

**Y el mensaje no da salida**: dice «Si el fichero NO es ejecutable, amplía `EXTENSIONES_DEL_BANCO`; si lo
es, escríbelo en `.mjs`». Ninguna de las dos aplica a un symlink a directorio sin extensión: el
desarrollador se queda con un rojo y dos instrucciones que no puede seguir.

No propongo el arreglo (no me toca); sí que el negativo del `it` «SABE PONERSE ROJO (el barrido)» debería
incluir un symlink a directorio en su árbol sintético, porque hoy ese `it` es verde con el defecto vivo.

### I-1 (importante) — Tres familias de alias siguen valiendo 1 para N llamadas, y ninguna está declarada ni medida

El defecto de #686 es «N llamadas detrás de UN nodo». El detector lo cierra para las ligaduras que
enumera (`VariableDeclaration`/`Parameter` con inicializador que sea acceso a propiedad, índice, string
u otro alias; `BindingElement`). Cualquier otra forma de ligar el mismo valor cuenta **1 al introducirla**
(el nodo `probeCollide` del inicializador) y **0 por cada llamada**. O sea: introducir el alias dispara el
padrón (+1, hay que declararlo), y a partir de ahí las llamadas crecen gratis — exactamente la forma de
#686 con otra ropa. Medido con el detector NUEVO (`consultas` importada del test), llamadas reales
contra cifra del detector:

| Familia | Forma (sintética) | Reales | Detector | ¿Declarada? | ¿`it`? |
|---|---|---|---|---|---|
| **Asignación** (no declaración) | `let pc; pc = window.__nefan.probeCollide; pc(1,2); pc(3,4); pc(5,6);` | 3 | 1 | no | no |
| | `let pc = …probePoint; pc = …probeCollide; pc×3` | 3 | 1 | no | no |
| | `let pc; if (x) pc = …probeCollide; else pc = …probePoint; pc×2` | 2 | 1 | no | no |
| | `let pc; ({ probeCollide: pc } = window.__nefan); pc×2` | 2 | 1 | no | no |
| **Expresión envolvente** | `const pc = (window.__nefan.probeCollide); pc×3` | 3 | 1 | no | no |
| | `const pc = (0, window.__nefan.probeCollide); pc×3` | 3 | 1 | no | no |
| | `const pc = c ? …probeCollide : …probePoint; pc×3` | 3 | 1 | no | no |
| | `const pc = window.__nefan.probeCollide ?? noop; pc×3` | 3 | 1 | no | no |
| | `const pc = window.__nefan.probeCollide.bind(window.__nefan); pc×3` | 3 | 1 | no | no |
| | `const pc = …probeCollide; const bound = pc.bind(null); bound×3` | 3 | 1 | no | no |
| **Contenedor** | `const s = { pc: window.__nefan.probeCollide }; s.pc×3` | 3 | 1 | no | no |
| | `const N = { mov: "probeCollide" }; ctx.nefan(N.mov,…)×3` | 3 | 1 | no | no |
| | `const [pc] = [window.__nefan.probeCollide]; pc×2` | 2 | 1 | no | no |
| | `for (const pc of [window.__nefan.probeCollide]) { pc×2 }` | 2 | 1 | no | no |

Las que el coordinador pidió expresamente y SÍ cuentan bien: objeto intermedio `const n = window.__nefan;
n.probeCollide(…)` (2/2), doble índice `window["__nefan"]["probeCollide"]` (2/2 y 3/3 como alias),
`.call`/`.apply` directo y sobre alias (2/2). También bien: `?.` en el alias y en la llamada, `var`,
desestructuración con valor por defecto, desestructuración anidada `{__nefan: {probeCollide: pc}}`,
alias por template literal, re-alias transitivo doble `q = pc; r = q`.

**El alias por argumento de `page.evaluate`**: `page.evaluate((pc) => { pc×3 }, window.__nefan.probeCollide)`
→ 1 (y no es serializable en Playwright, así que nadie lo escribe). La forma que SÍ se escribe en un
guion de Playwright es con el **string**: `page.evaluate((nombre) => { window.__nefan[nombre](…)×3 }, "probeCollide")`
→ 1, y su gemela `const sonda = (nombre, x, z) => ctx.nefan(nombre, x, z)…; sonda("probeCollide", …)` → 1.
El punto (3) del padrón cubre el MECANISMO («un parámetro SIN inicializador no liga nada»), pero su texto
habla de «EL ALIAS pasado como valor» y su `it` mide solo `f(pc)` con identificador: la variante con string,
que es la realista (hoy hay **75** `page.evaluate((arg) => …)` con parámetro en el banco), no está ni en la
prosa ni en el `it`.

**Realismo, medido en el banco real** (`grep` sobre `/home/al/code/ne-fan/qa`): `??`/`?.` sobre
`window.__nefan.*` existe (guiones 131, 144, 74; `run.mjs:1714`); propiedades de objeto con
`window.__nefan.X` están por todas partes (hoy campos de datos, no sondas); ternarios sobre `__nefan.*`
en 49, 07, 15, 74, 53. `let` reasignado a una sonda, `.bind` sobre una sonda y `ctx.nefan(variable)`:
cero hoy. Ninguna familia tiene sujeto con `probeCollide` HOY, por eso no es bloqueante; pero el
`_comment` del padrón vuelve a decir «La totalidad es la regla: toda consulta está aquí con su cuenta
EXACTA … o el test se pone rojo», que es el absoluto que `_lo_que_esto_NO_sujeta` existe para evitar, y
«CINCO agujeros conocidos» es una lista cerrada que la tabla de arriba desmiente.

**Qué esperaba el usuario** (criterio 1 literal): «si un fichero declara un alias, el padrón sabe cuántas
llamadas cuelgan de él … y se pone ROJO cuando N cambia». Para las catorce formas de arriba, N cambia y
nada se pone rojo. O se cierran las baratas (paréntesis/coma con `ts.skipParentheses`; `??`, ternario y
`.bind` mirando dentro de la expresión; asignación `pc = …` como ligadura más del punto fijo), o se
declaran como familias en el punto (3)/(6) con un `it` por familia que MIDA la cifra, como manda el
criterio 5. Las dos salidas valen; lo que no vale es que no estén.

Sobrecuentas encontradas (dirección segura, no son hallazgo): `let pc = …probeCollide; pc = …probePoint;
pc×3` → 4 contra 0; sombreado con alias de `probePoint` del mismo nombre → 3 contra 1 (declarado en (5));
alias real + parámetro con defecto del mismo nombre en otra función → 3 contra 1.

### M-1 (menor) — El barrido del padrón excluye `capturas/` y TODO dot-dir; la lista blanca no; un `.mjs` ahí es invisible al padrón y legal para la lista blanca

`fuentesDelBanco` (padrón) salta `node_modules`, `capturas` y `e.name.startsWith(".")`;
`ficherosBajo` (lista blanca) salta solo `node_modules` y `.tmp`. El ingeniero cerró «cualquier dot-dir»
para el segundo (buen `it`, `.oculto/x.ts` se ve) y dejó el primero como estaba. Consecuencia, **medida**:
`qa/capturas/x.mjs` y `qa/.oculto/x.mjs`, cada uno con `window.__nefan.probeCollide(1, 2)` directo →
padrón `21/21` verde, lista blanca `14/14` verde. Las dos frases nuevas del `_comment` —«parsea TODO
`qa/**/*.mjs`» y «`qa/**/*.mjs` es TODO lo ejecutable del banco porque el banco es `.mjs` y solo
`.mjs`»— no son ciertas para esos dos directorios. Realismo bajo (nadie pone un helper en `capturas/`),
pero es la misma forma que el `.oculto/x.ts` que se acaba de cerrar, y no está en `_lo_que_esto_NO_sujeta`.
Salida barata: que los dos barridos compartan la lista de directorios excluidos, o declararlo.

### M-2 (menor) — Prosa no verificada: «los diecinueve sitios»

El mensaje del candado y dos cabeceras citan «diecinueve sitios que deciden qué es el banco». No lo he
contado ni lo cuenta ningún test; es una cifra de prosa que caducará en silencio. No es un defecto de
la tanda; se anota para que nadie la lea como medida.

## Workarounds usados

Ninguno sobre el sistema bajo prueba. El detector y el candado se han ejercido importándolos del test real
del worktree (no copias), y los negativos en sitio se han hecho sobre los ficheros reales y revertidos.
Importar el fichero de test ejecuta sus `describe` de paso: ruido en la salida, sin efecto en la medida.

## No probado, y por qué

- **CI de la rama**: no observado por mí (sin PR abierta que yo haya consultado). Nota: aunque estuviera
  verde, NO desmiente B-1 — el clon del runner no tiene `qa/capturas/`.
- **Batería de navegador**: no corrida. Ningún guion cambia código (solo una frase de comentario en el 145),
  y el cambio es estático; correrla mediría otra cosa.
- **Mutación / CRAP**: fuera de perímetro (`test/` y `data/contract/`), como dice el informe.
- **Que las siete reglas de `arch-rules.json` con glob `qa/**/*.mjs` queden «correctas por construcción»**:
  es cierto SOLO mientras la lista blanca esté verde y alguien la mire. Con B-1 vivo, la garantía nace
  rota en local desde el primer día, y un desarrollador que aprenda a ignorar ese rojo ignora también el
  `.ts` que el candado existe para cazar.

## Para el ingeniero: qué haría este informe ejecutable

No dejo guion en `qa/guiones/`: la batería conduce un navegador y esto es un detector estático; su forma
ejecutable son `it`s en los dos tests. Los casos de I-1 están en la tabla con fuente y cifra esperada,
listos para pegar (o para pegarse como «LÍMITE MEDIDO» si se decide declararlos); el de B-1 es un symlink
a directorio en el árbol sintético del `it` «SABE PONERSE ROJO (el barrido)», que hoy no lo tiene y por
eso no se puso rojo. El guion adversarial con el que se midió vive en el scratchpad de esta sesión
(`adv.mts`, 36 formas + la lista blanca sobre el árbol principal); es efímero a propósito: lo durable
tiene que ser el `it`.

## Veredicto

**No apto.** Un solo motivo basta: la lista blanca —la pieza que sostiene el criterio 4 entero y las
garantías «por construcción» de diecinueve sitios— está roja en todo checkout donde se haya corrido el
banco, por un symlink que el propio banco crea en cada corrida y que la medida del ingeniero no podía
ver. El detector de sitios de uso, en cambio, hace lo que el crítico acotó y su negativo permanente es
real; lo que le falta (I-1, M-1) es declarar o cerrar lo que la pasada adversarial ha medido, que es el
criterio 5 tal y como está escrito.
