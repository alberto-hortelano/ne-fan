# QA — tanda X (#686): el padrón cuenta SITIOS DE USO

> **Veredicto FINAL (segunda pasada, sobre `5c148b68`): APTO CON RESERVAS.** La re-verificación está al
> final del documento (sección «Re-verificación tras la corrección»). Lo que sigue inmediatamente es la
> primera pasada, sobre `9f96a1ab`, que dio NO APTO; se conserva porque es la evidencia de por qué se
> corrigió lo que se corrigió.

## Primera pasada (sobre `d769ca8f` + `9f96a1ab`) — NO APTO, superado

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

---

# Re-verificación tras la corrección (commit `5c148b68`)

Mismo worktree, mismo método: detector y barrido NUEVOS importados de los tests reales; negativos sobre
ficheros reales, revertidos (`git status --short qa/` vacío al final, 0 restos de `capturas`, `roto`,
`lib/x.mjs`, `guiones2`, `fuera`, `self`). Árbol principal solo en lectura. Solo los criterios afectados
(B-1, I-1, M-1, M-2) más una pasada adversarial nueva. Tests aislados: padrón `24/24`, qa-lib `14/14`.
`npm run verify` reproducido: `rc=0`, `tests 3134 · pass 3134 · fail 0`.

## Hallazgos anteriores

| Hallazgo | Estado | Evidencia |
|---|---|---|
| **B-1** symlink `capturas/ultima` ponía roja la lista blanca | ✅ cerrado | Barrido único `test/banco-ficheros.ts`: symlinks por `statSync`, roto = fichero, ciclos por ancestros, `capturas/` saltado por decisión escrita (cabecera del módulo + punto (7) del padrón; `arch-rules.json` ya lo declaraba regenerable). **Contra `/home/al/code/ne-fan/qa`** (solo lectura), con el barrido nuevo: saltando `SALTOS_DEL_BANCO` → 214 rutas, foráneos `[]`; **sin saltar `capturas/`** → 15.178 rutas, foráneos `[]`, `capturas/ultima` como fichero = 0, ficheros bajo `capturas/ultima/` = 317 (el enlace se sigue como directorio). **En sitio** (worktree): `capturas/<run>/01.png` + `capturas/ultima -> <run>` → qa-lib `14/14`, padrón `24/24`; `qa/roto -> no-existe` → `13 · fail 1` y el mensaje añade la tercera salida («si es un enlace simbólico ROTO (apunta a algo borrado), bórralo», `:327`). El `it` «SABE PONERSE ROJO (el barrido)» tiene ahora enlace a directorio, enlace a fichero, enlace roto, ciclo, `capturas/ultima` y `capturas/x.mjs` en su árbol sintético |
| **I-1** tres familias de alias subcontaban sin declarar | ✅ cerrado como se anunció | Mi tabla reproducida contra el detector nuevo: **asignación** (`let pc; pc = …` ×3 → 3; condicional → 2; `({probeCollide: pc} = …)` → 2) y **envolvente** (paréntesis, coma, ternario, `??`, `.bind(w)`, `bound = pc.bind(null)` → 3 cada una) a cifra EXACTA. `let` de `probePoint` reasignado a la sonda → 4 por 3, sobrecuenta declarada en (5). **Contenedor** (`{pc: …}`, `{mov: "probeCollide"}`, `const [pc] = […]`, `for…of`) → 1, declarado en (6) con `it`. **String por argumento de `page.evaluate`** → 1, en (3) con `it` y con la cifra de los 75 `evaluate`. Absolutos retirados: `_comment` dice «totalidad SOBRE LAS FORMAS QUE EL DETECTOR RESUELVE … esa lista no se presume completa»; `_lo_que_esto_NO_sujeta` dice «La lista NO es cerrada». `grep 'La totalidad es la regla'` = 0 |
| **M-1** dos barridos, dos definiciones de banco | ✅ cerrado | `SALTOS_DEL_BANCO = {node_modules, .tmp, capturas}` compartido; el padrón afirma el conjunto exacto (`:645`) y punto (7) nuevo. Reproducido por el ingeniero y verificado el mecanismo: `fuentesDelBanco` = `ficherosDelBanco().filter(.mjs)`, importado por los dos tests (`:57`, `:128`). `banco-ficheros.ts` entra en `typecheck:tests` (`test/**/*.ts`) y no en el glob de `npm test` (`test/*.test.ts`) |
| **M-2** «diecinueve» | ✅ cerrado | `grep diecinueve` en `CLAUDE.md`, `test/`, contratos, `qa/README.md` → solo `mutation-targets.json:990`, con otro sentido |

## Las dos que el ingeniero deja dichas y no declaradas (pregunta del coordinador)

**(a) `x.mjs -> y.ts`: se juzga por el nombre del enlace.** Medido en el worktree con `y.ts` que lleva
anotaciones de tipo y la sonda dentro:

- **Node lo ejecuta como TS**: `import("…/qa/lib/x.mjs")` → `NODE-EJECUTA-TS g(1)= 2` (el loader resuelve
  por `realpath` y aplica type-stripping). La premisa del ingeniero es cierta.
- **En `qa/lib/`** la lista blanca queda verde pero el fichero cae por OTRO candado: «cada módulo de qa/lib
  está importado por algún test, o eximido» → `12 · fail 2` (huérfano). Rojo, pero por la totalidad de
  `qa/lib`, no por la extensión.
- **En `qa/guiones/`** (o la raíz), donde no rige esa totalidad: qa-lib **`14/14` verde**. El padrón sí lo
  lee a través del enlace y se pone rojo por la sonda (`qa/guiones/x.mjs: 1 en el árbol contra 0`), pero
  eso es porque puse una sonda dentro; un `.ts` sin sonda correría en el banco sin que la lista blanca lo
  viera — exactamente lo que la lista blanca existe para impedir.
- **Alcanzable hoy**: solo a propósito (`git` commitea symlinks; `qa/run.mjs` crea uno pero a directorio y
  dentro de `capturas/`). Nadie lo hace sin querer.

Veredicto: **no va a `_lo_que_esto_NO_sujeta`** —esa sección es del padrón, y el padrón no lo pierde—, va
al candado de la lista blanca, que es cuya promesa se salta. Y ahí **es más barato cerrarlo que
declararlo**: cuando `isSymbolicLink()`, juzgar TAMBIÉN la extensión del `realpathSync(p)` (dos líneas en
`ficherosDelBanco` o en `extensionesForaneas` con la ruta real al lado). Si se decide declarar en vez de
cerrar, que sea en la cabecera de `banco-ficheros.ts` con un aserto en el `it` sintético (`lib/x.ts ->
b.mjs` ya está; falta el inverso `x.mjs -> y.ts` afirmando que HOY pasa).

**(b) symlink a un hermano ya recorrido DUPLICA rutas.** Medido: `qa/guiones2 -> guiones` → lista blanca
`14/14` (todo `.mjs`), padrón `22 · fail 2` con **10** líneas `qa/guiones2/<declarado>: N en el árbol
contra 0 declaradas`. Dirección **rojo y ruidoso**: el mismo día que alguien lo cree, `npm test` lo dice
con las diez rutas. Veredicto: **no es un ítem de `_lo_que_esto_NO_sujeta`** (esa lista es de verdes que
tapan, no de rojos); basta la frase que ya está en la cabecera del módulo («ciclos por ancestros, no por
todo lo visitado») ampliada con «un enlace a un hermano se recorre dos veces y sale por duplicado: rojo».

## Pasada adversarial nueva

**Barrido** (formas no listadas por nadie, medidas en sitio):

- `qa/fuera -> ../nefan-core/src` (enlace que SALE de `qa/`): se recorre; lista blanca `13 · fail 1` con
  «154 fichero(s) … qa/fuera/combat/attack-area.ts, …». Rojo y ruidoso. Observación: no hay guardia de
  «la ruta real sigue bajo `qa/`»; un enlace a un árbol enorme convertiría `npm test` en un rastreo de
  disco. Solo a propósito; dirección segura.
- `qa/self -> self` (ELOOP): `statSync` lanza `ELOOP`, que no es `ENOENT`, así que el barrido entero
  lanza → `Error: ELOOP: too many symbolic links encountered` y el fichero de test muere (`pass 10`, sin
  llegar a los `it` del banco). Rojo por caída, no por aserto: ruidoso, pero el mensaje no dice qué hacer.
  Solo a propósito.

**Detector** (40 formas; las de mis tablas ya están arriba). Cifras del detector contra llamadas reales:

| Forma | Reales | Detector | Juicio |
|---|---|---|---|
| `let pc; pc ??= …probeCollide; pc×3` (y `\|\|=`) | 3 | 1 | subcuenta; misma rama que la asignación, un `SyntaxKind` más |
| `let a, b; a = b = …probeCollide; a×2; b×1` | 3 | 1 | subcuenta (`b` sí, `a` no: la derecha de `a =` es una asignación) |
| `s.pc = …probeCollide; s.pc×3` · `window.pc = …` | 3 | 1 | subcuenta; es el CONTENEDOR por asignación a propiedad — el motivo de (6) («no se siguen propiedades») lo cubre, su texto no lo nombra |
| `const pc = (() => …probeCollide)(); pc×3` · `const pc = await Promise.resolve(…probeCollide); pc×2` | 3 / 2 | 1 / 1 | subcuenta; el valor pasa por el RETORNO de una llamada: no es envolvente ni contenedor; sin flujo no se cierra |
| `let pc; (pc = …probeCollide)(1,2); pc×2` | 3 | 2 | subcuenta exactamente en la invocación en sitio: la asignación entera va a `declaraciones` y su llamada envolvente se salta |
| `let pc; ({ probeCollide: pc = noop } = …); pc×2` | 2 | 1 | subcuenta; el `initializer` de la propiedad es `pc = noop`, no un `Identifier` |
| `const sondas = […probeCollide, …]; sondas[0]×3` · `const pc = […][0]` | 3 | 1 | (6), «elementos» |
| `.bind(a).bind(b)`, `&&`, `\|\|`, ternario anidado, parámetro con default envuelto, `pc?.()`, `pc(...a)`, string por asignación `nombre = "probeCollide"` | — | exacto | ✅ |
| `const q = { pc }; q.pc×3` | 3 | 4 | sobrecuenta: `q.pc` cuenta porque el NOMBRE de propiedad coincide con el alias (sin ámbitos ni distinción propiedad/variable); mismo motivo que (5) |
| `let pc = noop; pc = …probeCollide; pc×2` | 2 | 3 | sobrecuenta: la declaración con inicializador no-sonda cuenta su nombre; (5) lo cubre en espíritu |

Ninguna de las seis subcuentas tiene sujeto en el banco (grep de `??=`, `\|\|=`, asignación encadenada a
una sonda, IIFE sobre `__nefan`: 0) y todas son formas que nadie escribe sin querer. El padrón ya declara
la lista como abierta. Aun así, criterio 5 dice «lo que queda se mide»: un solo `it` «otras ligaduras que
HOY no se resuelven» con estas seis y su cifra las convierte de hallazgo de QA en límite medido; y tres de
ellas (`??=`/`||=`, `({p: pc = d} = …)`, la encadenada) se cierran en la misma rama del punto fijo por
menos de lo que cuesta declararlas. Es la reserva del veredicto, no un motivo de rechazo.

## No probado

- CI de la rama: no observado. `qa/capturas/` está en `.gitignore`, así que el runner no ejercita el
  camino de B-1; la evidencia de B-1 es la medida local sobre el árbol principal (0 foráneos) y el `it`
  sintético con `capturas/ultima`.
- Batería de navegador y mutación: como en la primera pasada, fuera del cambio.

## Veredicto final

**Apto con reservas.** Los cuatro hallazgos están cerrados con medida, no con prosa: la lista blanca da 0
foráneos sobre el árbol principal con y sin `capturas/`, el `ultima` real queda verde en sitio, las dos
familias de alias que subcontaban dan la cifra exacta en las diez formas, las otras dos están declaradas
con `it`, los absolutos se han retirado y el barrido es uno. Reservas, ninguna bloqueante: (1) las seis
ligaduras exóticas de la tabla, a medir en un `it` o cerrar las tres baratas; (2) el enlace `x.mjs -> y.ts`
se salta la promesa de la lista blanca —Node lo ejecuta como TS— y conviene cerrarlo por `realpath` en vez
de dejarlo dicho; (3) el enlace a hermano y el que sale de `qa/` van en rojo y no necesitan más que una
frase en la cabecera del módulo; `ELOOP` mata el test sin decir qué hacer.
