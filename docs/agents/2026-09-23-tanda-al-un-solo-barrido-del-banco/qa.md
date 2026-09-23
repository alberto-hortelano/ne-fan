# QA — tanda AL: un solo barrido del banco (#704)

Rama `feature/tanda-al`, sha revisado `444a5241` (dos commits sobre `main` = `83ea6046`). Rige el reencuadre del final de `requisitos.md` (criterios R1-R5). Todo lo medido aquí se midió sobre el árbol real de `/home/al/code/ne-fan-tanda-al` y, cuando se dice, también sobre `/home/al/code/ne-fan` (que tiene `qa/capturas/` y `qa/.tmp/` llenos). El material ejecutable queda en **`qa/guiones/163-el-candado-del-barrido-unico-puede-ponerse-rojo.mjs`** (headless, `sinNavegador`; corre con `node qa/run.mjs --sin-navegador 163`, 16 s).

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| R1 · Un único recorrido recursivo de `qa/` bajo `test/`: `banco-ficheros.ts`. Migran los cuatro (AF + tres `flatMap`); `helpers-del-banco.ts` pierde solo `fuentesDelBanco` y no mueve ni renombra el visitante de AST; la exclusión de `qa/run.mjs` queda como filtro | ✅ cumple | `git diff 83ea6046..444a5241`: en `helpers-del-banco.ts` el único hunk es `@@ -1,33 +1,17 @@` (cabecera + imports + la función borrada); `arbolDelBanco`/`recorre`/`cuerpoPrincipal`/`recorreSinAnidadas` intactos (AH no choca). Los tres tests llevan ahora `const mjsDelBanco = () => fuentesDelBanco(join(repoRoot,"qa")).map(f => \`qa/${f}\`)`, y `esperas-que-conducen` añade `.filter(f => f !== "qa/run.mjs")` con su comentario encima. `grep -rn "fuentesDelBanco\|ficherosDelBanco" nefan-core/test` → solo `banco-ficheros.ts` y sus importadores. El candado cuenta **1** recorrido en el dueño y 7 declarados en el padrón, ninguno con `recorre` que nombre `qa` |
| R2 · Censo antes/después de los cuatro consumidores; si sube se dice, si baja es fallo | ✅ cumple hoy · ⚠️ con una dirección de BAJADA no medida por el ingeniero (H-3) | Censo **independiente** (copia textual de las cuatro implementaciones de `83ea6046` contra las expresiones que usa cada test hoy, script en el scratchpad de QA): `el-cliente-ws 220→220 · esperas-que-conducen 219→219 · espera-de-fotogramas 220→220 · el-cortafuegos 220→220`, mismo conjunto y **mismo orden**, en los dos checkouts. En negativo, con tres siembras temporales a la vez: `qa/.oculto/x.mjs` → **sube 1** en los cuatro (declarado en la cabecera del barrido); `qa/enlace-a-guiones -> guiones` → sube ~157 en los cuatro (el barrido sigue enlaces; el padrón lo pondría rojo y ruidoso, como dice su cabecera); **`qa/capturas/y.mjs` → BAJA 1 en los tres `flatMap`** (221→220): las copias viejas no saltaban `capturas/`, el barrido sí. Hoy hay 0 `.mjs` bajo `capturas/`, `.tmp/` y `node_modules/` en los dos checkouts, así que ningún censo real baja |
| R3 · Los seis lectores de carpeta quedan fuera a propósito y se declaran por nombre | ✅ cumple | `recorridos-de-test.json` → `lectores_de_carpeta_de_qa` con los seis (`un-numero-un-guion`, `las-anclas`, `el-banco-declara-el-modo-de-gasto`, `qa-lib-tiene-quien-lo-mire`, `candados-headless-totalidad`, `esperas-de-qa`), cada uno con `carpetas[]` (regex `^qa(/|$)`) y `porque`. Ninguno de los seis se tocó en el diff (`el-banco-declara…:107` sigue igual: AN no choca). Un lector declarado sobre `data/scenes` lo rechaza el zod (medido en el `it` del zod) |
| R4 · Candado por el ÁRBOL, probado en negativo, con `_lo_que_esto_NO_sujeta` medido (al menos: import dinámico, rutas no resueltas, `{recursive:true}`) | ✅ cumple lo pedido · ⚠️ el detector tiene más agujeros de los que declara (H-1) y un límite cuya prosa contradice su medida (H-2) | `node --import tsx --test test/un-solo-barrido-del-banco.test.ts` → 17/17. Negativos que YO corrí sobre el árbol (no sobre fixtures): la copia `flatMap` vuelta a sembrar → rojo «totalidad» nombrando el fichero; declarada con `recorre:"qa"` → rojo SOLO «legalizar»; entrada caducada y cifra que no casa → rojo «totalidad». Los tres mínimos del requisito están medidos con su `it` (LÍMITES 1, 2 y el `{recursive:true}` lo ve). **Pasada adversarial**: 22 formas de recorrer un directorio sembradas como `.ts` reales bajo `test/`: 5 las ve el detector, **8 no las ve como recorrido** (solo se paran de rebote por la lista del LÍMITE 4) y **9 son invisibles del todo**, entre ellas `globSync("qa/**/*.mjs")` y `fs.promises.readdir(…, {recursive:true})`. Ninguna de esas 17 está en `_lo_que_esto_NO_sujeta`. Todo esto queda ejecutable y probado en negativo en el guion 163 (abajo) |
| R5 · `npm test` / `verify` verdes; `candados-headless` igual; cabecera de `helpers-del-banco.ts:1-10` barrida | ✅ cumple | En el worktree: `npm run typecheck:tests && npm run lint && npm test` → **3281/3281, exit 0** (antes de añadir el guion 163); con el 163 dentro del banco, `npm test` otra vez → ver «Segunda corrida» abajo. `git diff 83ea6046..444a5241 --stat`: ni `ci.yml`, ni `package.json`, ni nada bajo `qa/` → el job `candados-headless` corre lo mismo. La cabecera nueva de `helpers-del-banco.ts` ya no habla de «unificar las copias» y remite a `banco-ficheros.ts` y al candado |

**Segunda corrida de `npm test`** (con `qa/guiones/163-….mjs` y la fila del README dentro del árbol, es decir, con el 163 sometido a `un-numero-un-guion`, `el-banco-declara-el-modo-de-gasto`, `esperas-de-qa`, `un-salto-del-guion-se-observa`, `clientes-ws`, sondas, etc.): la primera versión del guion salió **3280/3281** (rojo del candado de saltos #356 sobre una rama muda del 163, ver «Workarounds»); corregido el guion, **3281/3281, exit 0**.

## Hallazgos

### H-1 · importante — el detector no ve nueve formas de recorrer `qa/`, y ninguna está declarada en `_lo_que_esto_NO_sujeta`

**Reproducción** (desde el arranque): `node qa/run.mjs --sin-navegador 163` → fila «agujeros CONOCIDOS (invisibles del todo): las 9 formas siguen saliendo «verde»». O a mano: crear `nefan-core/test/zz.ts` con `import { globSync } from "node:fs"; export const a = globSync("qa/**/*.mjs");` y correr el candado: **17/17 verde**, ni recorrido ni lectura plana.

Las nueve, medidas una a una (cero rojos en el candado con cada una sembrada):

1. `const leer = readdirSync; leer(d, {recursive:true})` — alias por asignación (el detector solo resuelve el alias del `import`).
2. **`globSync("qa/**/*.mjs")`** de `node:fs` — está en Node 24.11.1 (`typeof fs.globSync === "function"`, medido) y es la forma de UNA línea que un test nuevo escribiría.
3. `import { promises } from "node:fs"; promises.readdir(d, {recursive:true})`.
4. **`fs.promises.readdir(d, {recursive:true})`** — `fs.promises` es un acceso de dos niveles y `esLector` solo mira `identificador.readdir`.
5. `opendirSync` recursivo — otro lector de `node:fs` que no está en `LECTORES`.
6. `createRequire` + `require("node:fs")`.
7. `execSync("find qa -name *.mjs")`.
8. `import * as fs from "node:fs"; const { readdirSync } = fs;` — destructurado de un espacio de nombres, no de un `import()`.
9. **Un helper `.mjs` bajo `test/`** con la copia `flatMap`: `fuentesDeTest()` filtra por `.ts`, así que un `test/mi-barrido.mjs` importado por un `.test.ts` no se censa.

**Lo que esperaba**: que el punto (1)-(6) del padrón enumerase lo que el detector no ve, según la costumbre de la casa (#686: «un censo textual es ciego a la escritura»). El requisito R4 pedía «al menos» tres, y esos tres están; pero de los nueve de arriba, 2 y 4 son las escrituras más probables en un test nuevo y quedan fuera de la lista. No es un falso verde sobre el árbol de hoy (no hay ningún recorrido de `qa/` escrito así), es un agujero sin declarar. Lo que el ingeniero decida —extender `LECTORES`/`esLector` a `globSync`, `fs.promises.*` y `.mjs`, o declararlos con su `it`— lo mide el guion 163: si una forma pasa a verse, la fila «invisibles» se pone roja y pide subirla a sabotajes.

### H-2 · importante — el «LÍMITE MEDIDO (4)» dice lo contrario de lo que comprueba, y hoy es la única red para ocho recorridos que el detector no ve

**Reproducción**: sembrar `nefan-core/test/zz.ts` con `import { readdirSync } from "node:fs"; export const a = readdirSync("data/scenes");` (un lector plano legítimo de OTRA carpeta) y correr el candado → **rojo** en `LÍMITE MEDIDO (4): los lectores de carpeta no tienen totalidad; hoy hay estos fuera del padrón` (`deepEqual` sobre la LISTA de cuatro nombres). El texto del punto (4) del padrón dice: «uno nuevo sin declarar **pasa en verde**». No pasa. La prosa promete un agujero y la medida lo cierra por accidente, y el rojo manda al desarrollador a un `it` de «límite» en vez de al padrón.

Consecuencia medida (guion 163, tabla «rojo de rebote»): estas **ocho** formas de recorrer un directorio de forma recursiva el detector **no** las ve como recorrido (salen como `planas`), y hoy solo se paran por ese `deepEqual`:

- recursión por `this.baja(…)` (método de clase) y por `w.baja(…)` (método de objeto): `seLlama` solo cuenta `Identifier(...)`;
- `let baja; baja = (d) => … baja(…)`: sin `initializer` en la declaración;
- `const w = function baja(d) { … baja(…) }`: la autollamada usa el nombre propio de la expresión, no el de la variable;
- `.flatMap(baja)`: referencia sin llamada;
- `{ "recursive": true }`: `p.name.getText()` devuelve las comillas;
- `{ recursive: true as const }` y `{ recursive }` abreviado;
- `{ ...OPCIONES }`.

Y el mismo aserto es hoy lo único que se pone rojo si se BORRA una entrada de `lectores_de_carpeta_de_qa` (sabotaje medido en el 163: rojo, pero por el LÍMITE 4 y no por una caducidad que lo diga).

**Lo que esperaba**: o bien (a) el punto (4) se reescribe como lo que es —«los lectores planos SÍ tienen totalidad por lista; uno nuevo se declara»— y el padrón gana la lista de lectores de otras carpetas con su motivo; o bien (b) el `it` pasa a medir una cifra (como dice la prosa) y entonces las ocho formas de arriba pasan en verde y hay que declararlas o enseñárselas al detector. El guion 163 se pone rojo en cualquiera de las dos direcciones y dice cuál.

### H-3 · importante — el cambio de semántica tiene una dirección de BAJADA que no se midió ni se declaró: `capturas/`

**Reproducción**: `mkdir -p qa/capturas && echo 'export const y=1' > qa/capturas/y.mjs`, correr el censo viejo y el nuevo (o mirar el `it` de `SALTOS_DEL_BANCO`). Las tres copias `flatMap` (esperas-que-conducen, espera-de-fotogramas, el-cortafuegos) saltaban `node_modules` y «todo directorio con punto» y **no** `capturas/`; el barrido único salta `capturas/` por nombre. Medido: 221 → 220 en las tres con ese fichero sembrado. `implementacion.md` midió solo `.oculto/` («sube 1») y da por cumplido «si baja, es un fallo».

Hoy no baja nada (0 `.mjs` bajo `capturas/` en los dos checkouts), y saltar `capturas/` está bien argumentado en la cabecera de `banco-ficheros.ts` (15.000 PNG, el enlace `ultima`, `arch-rules.json`). El problema es dónde está escrito el agujero: la cabecera del barrido remite al «punto (7) de `_lo_que_esto_NO_sujeta` del padrón» — y ese punto existe **solo** en `sondas-de-movimiento.json`. Los cuatro padrones que ahora dependen del barrido (`esperas-que-conducen.json`, `esperas-por-fotogramas.json`, `esperas-de-tile.json`, `clientes-ws-del-banco.json`) no nombran `capturas`, `.tmp` ni `node_modules` en su `_lo_que_esto_NO_sujeta` (`grep -c` → 0 en los cuatro). Un `.mjs` con un `waitFor` de pared o un presupuesto de tile bajo `qa/capturas/` es invisible para esos tres candados y ninguno lo dice.

**Lo que esperaba**: la cifra de bajada en `implementacion.md` con su motivo, y una línea en cada uno de los cuatro padrones (o una remisión explícita a `SALTOS_DEL_BANCO`) que diga que lo que el barrido salta no lo ve ese candado.

### H-4 · menor — la caducidad de un lector de carpeta se mide con «alguna lectura plana en el fichero», no con SU carpeta

`cada lector de carpeta declarado existe y sigue leyendo sin bajar` acepta la entrada si `censo.get(f).planas.length > 0`, sea la lectura de la carpeta que sea. `un-numero-un-guion.test.ts` lee `qa/guiones` en `:75` y `docs/agents` (recursivo) en `:112`; `qa-lib-tiene-quien-lo-mire.test.ts` lee `qa/lib` en `:176` y `test/` en `:179`. Si uno de ellos dejara de leer la carpeta de `qa/` que declara pero conservara la otra lectura, la entrada seguiría «viva». Es coherente con el punto (5) (el destino no se resuelve), pero el nombre del aserto promete más de lo que mide. No probado en negativo sobre el árbol (obligaría a editar esos dos tests); medido leyendo el código.

### H-5 · menor — `nombraElBanco` es sensible a mayúsculas

`recorre: "QA/guiones"` pasa el aserto de «legalizar». Cae dentro del punto (5) («un `recorre` mentiroso pasa»), así que está declarado por implicación; lo anoto porque es la mentira más barata de escribir.

### Anotaciones sin hallazgo

- **Orden de rutas** (riesgo §8 del plan): no se materializó. `banco-ficheros.ts` ordena con `localeCompare` por nivel y las copias viejas usaban el orden crudo de `readdirSync`; sobre los dos checkouts el orden resultó idéntico (medido: `mismoOrden=true` en las cuatro filas).
- **Recorridos en `qa/lib` alcanzables por `import`** (punto 6 del padrón): hoy **cero** (`grep -rn 'readdir|globSync|opendir' qa/lib` → solo `mkdirSync(…, {recursive:true})`), así que el agujero declarado está vacío.
- **Conflictos con AH/AN**: verificados en el diff; ver R1 y R3.
- **Issue de backlog** que propone `implementacion.md` (unificar los tres lectores de `readdirSync` por árbol): con H-1 y H-2 encima, gana peso; que lo abra el coordinador.

## Guion 163 (lo mecánico, ejecutable)

`qa/guiones/163-el-candado-del-barrido-unico-puede-ponerse-rojo.mjs`, molde del 148/152, más su fila en `qa/README.md`:

- 9 **sabotajes** sobre el árbol real (5 siembras en `test/` + 4 reescrituras del padrón), cada uno con EXACTAMENTE los asertos que deben ponerse rojos y, para las siembras, que el mensaje nombre al fichero.
- 2 tablas de **agujeros conocidos** sembradas en bloque (una corrida por tabla; fila a fila solo si el bloque cambia): 9 invisibles (H-1) y 8 de rojo de rebote (H-2).
- Restaura byte a byte, usa `turnoDeCandados`, se niega sobre padrón sucio o con rastro.

**Corrido**: `node qa/run.mjs --sin-navegador 163` → `1 en verde · 0 en rojo`, 16 s.

**Probado en negativo** (tres roturas del candado, restauradas con `git checkout`):

1. `LECTORES = new Set([])` → rojo en «el candado viene VERDE de partida — ya está rojo: el árbol tiene sujeto…» (el candado se delata solo antes de que el guion siembre nada).
2. La totalidad ciega a los sembrados (`!f.startsWith("zz-")`) → rojas **exactamente** las cinco filas de siembra («ROMPERLO NO CAMBIA NADA») y la de «legalizar» (que también depende de la totalidad); el resto verde.
3. `nombraElBanco = () => false` → rojo en «viene VERDE de partida — ya está rojo: un `recorre` que nombra qa lo rechaza el aserto».

## Workarounds usados durante la prueba

- Siembras temporales en el árbol (`qa/.oculto/x.mjs`, `qa/capturas/y.mjs`, `qa/enlace-a-guiones`, 22 ficheros `zz-adv-*` bajo `test/`): borradas; `git status` limpio salvo lo que esta QA añade. No afectan al usuario: son la forma de medir qué ve cada barrido.
- Una regex mía en la primera versión del 163 cortaba el nombre del aserto en «(4)»: corregida antes de dar el guion por bueno (anclada a la duración final `(N.NNNms)`). El 152 usa la regex vieja y le pasaría lo mismo el día que un aserto suyo lleve un paréntesis con dígito; no lo toco (no es de esta tanda).
- La primera versión del 163 tenía un `if (fichero && exacto && …) { ctx.expect(…) }` y **el candado de saltos (#356, `un-salto-del-guion-se-observa`) lo puso rojo** en la primera corrida completa de `npm test` (3280/3281: «163:261 [rama-muda] … `fichero` no se afirma antes»). Se fundió en un solo `expect` por sabotaje con las tres causas separadas. Lo apunto como evidencia de que ese candado hace lo que dice, sobre un guion escrito sin pensar en él.
- Ninguno de los workarounds oculta algo que el jugador o el desarrollador fueran a encontrarse.

## No probado

- El job `candados-headless` en el runner de CI: no se tocan `ci.yml`, `package.json` ni `qa/` en el diff del ingeniero, y el 163 entra por la clase `sinNavegador` que ese job ya corre; solo se ha ejecutado en local.
- Mutación: no aplica (solo `test/` y `data/contract/`, sin ficheros de `mutation-targets`).
- Gasto de créditos: no aplica (cero servicios levantados; el 163 no abre el juego).
- H-4 en negativo sobre el árbol (obligaría a editar dos tests ajenos).

## Veredicto

**Apto con reservas.** Lo que se pidió está hecho y medido: un solo recorrido recursivo de `qa/`, censo idéntico en los cuatro consumidores (mismo conjunto y orden, en los dos checkouts), lectores de carpeta fuera y declarados, candado por el árbol con seis negativos del ingeniero y tres míos, `verify` verde, y ni AH ni AN chocan. Las reservas son H-1, H-2 y H-3: ninguna es un falso verde sobre el árbol de hoy, las tres son agujeros del candado o del cambio de semántica que **no están escritos donde la casa manda escribirlos** (`_lo_que_esto_NO_sujeta`), y una de ellas (H-2) es un candado cuya prosa dice lo contrario de su medida. Vuelven al mismo ingeniero; el guion 163 se pone rojo solo en cuanto cierre o declare cada uno.

---

# Vuelta 2 — re-QA sobre `6b43e2c1` (commits `47f94492` + `6b43e2c1`)

Re-verifico SOLO lo que el ingeniero dice haber corregido (H-1..H-5 y el guion 163) más una pasada adversarial nueva sobre lo que cambió. Nada de la vuelta 1 que no se tocó (R1, R2, R3) se vuelve a medir.

## Lo corregido, criterio a criterio

| Hallazgo | Veredicto | Evidencia |
|---|---|---|
| H-1 · 9 formas invisibles | ✅ 8 de 9 cerradas y la novena declarada | Candado `node --import tsx --test test/un-solo-barrido-del-banco.test.ts` → **22/22**. `node qa/run.mjs --sin-navegador 163` → **1 en verde · 0 en rojo**: las 8 (alias por asignación, `globSync`, `promises.readdir`, `fs.promises.readdir`, `opendirSync`, `createRequire`, destructurado de espacio, helper `.mjs`) salen ahora como **sabotajes** que ponen roja EXACTAMENTE la totalidad y nombran el fichero. `execSync("find")` queda en la tabla de invisibles con `fs["readdirSync"]` y «lector como valor», los tres en el punto (1) con su `it`. Efecto colateral verificado: `mutation-config.test.ts` (2 `globSync` reales, `:69,:125`) declarado en `recorridos` con `recorre` que no nombra `qa` |
| H-2 · 8 formas de rebote + LÍMITE (4) contradictorio | ✅ cerrado | Las 8 son sabotajes del 163 (rojo por totalidad, fichero nombrado). El LÍMITE (4) viejo desaparece; lo sustituye «totalidad de lectores: cada lectura plana de un directorio está declarada, por su argumento», con dos listas (`lectores_de_carpeta_de_qa` y `lectores_de_otras_carpetas`, 6 + 6 entradas) y zod que exige `argumentos` no vacío. Mutua, pila, `recursive` por parámetro y por `let` reasignado quedan como «rojo por la totalidad de lectores» en el 163 y en los puntos (2) y (3). Pero esa totalidad tiene un agujero propio: **V2-1**, abajo |
| H-3 · bajada por `capturas/` | ✅ cerrado | Punto (6) nuevo con `it` sobre un árbol temporal (`fuentesDelBanco` salta `node_modules`/`.tmp`/`capturas` y barre `.oculto`; fija `SALTOS_DEL_BANCO` a esos tres) y con la cifra 221→220 escrita. Los cuatro padrones consumidores llevan «LO QUE EL BARRIDO SALTA … punto (6)» (`grep -c capturas` → 1 en los cuatro; el de clientes-ws dice, correctamente, que su copia vieja ya saltaba `capturas/`). La cabecera de `banco-ficheros.ts` ya no remite a un «punto (7)» ajeno |
| H-4 · caducidad por «alguna lectura» | ✅ cerrado | La entrada caduca por `fichero :: argumento` (texto). Sabotaje del 163 «se DECLARA un argumento que el fichero no lee» → rojo por la totalidad de lectores (verde en la corrida base = el sabotaje funciona) |
| H-5 · mayúsculas | ✅ cerrado | `nombraElBanco` con `/i`; `it` con `QA/guiones` y `Qa`; sabotaje del 163 «`recorre` en MAYÚSCULAS» → rojo «legalizar» |
| Guion 163 | ✅ sin debilitar, y probado en negativo otra vez | 22 asertos base; 30 sabotajes; 2 tablas de agujeros (3 + 4). Negativos míos sobre el candado (restaurados con `git checkout`): **A** `pideRecursivo` siempre `false` → 163 rojo en «viene VERDE de partida — ya está rojo: totalidad…» (el propio árbol se delata: `afectado`, `mutation-config`… dejan de contarse); **B** las lecturas planas no se registran → rojo en «ya está rojo: totalidad de lectores…» (las 12 declaradas caducan). Los dos rojos llegan antes de sembrar nada, que es lo que se quiere de un guion que mide un candado |

## Pasada adversarial v2 (sobre lo que cambió)

**Bloque 1 · 15 formas nuevas sembradas bajo `test/`** (ficheros `zz-v2-*`, borrados después; `git status` limpio):

- Rojo por **totalidad de recorridos** (el detector las ve): método **estático** con `W.baja(…)`, `fs.globSync` por espacio de nombres, `{ recursive: "yes" as unknown as boolean }` (conservador: todo lo que no sea `false` literal cuenta).
- Rojo por **totalidad de lectores** (salen como plana, la red declarada): `const baja = memo((d) => readdirSync(d).flatMap(baja))` (la flecha cuelga de una llamada y `nombresDe` no le ve nombre), `readdirSync("qa", opciones())`, el lector en una función **hermana** de la recursiva (`lee(d)` / `baja`), y `readdirSync(...(["qa", {recursive:true}] as const))`.
- **Invisibles del todo** (verde, 22/22), siete: (a) `export { readdirSync } from "node:fs"` en un helper de `test/` + `import { readdirSync } from "./helper.js"` en el consumidor (ninguno de los dos ficheros ve un lector: el re-export es `ExportDeclaration`, y el import no viene de `fs`); (b) `readdirSync.call(null, …)` y `Reflect.apply(readdirSync, …)`; (c) `import("node:fs").then((fs) => fs.readdirSync(…))`; (d) `` await import(`node:fs`) `` con **template literal** (`esModuloFs` solo acepta `StringLiteral`); (e) `process.getBuiltinModule("node:fs")` (Node ≥ 22); (f) `import fs = require("node:fs")` (`ImportEqualsDeclaration`); (g) `fs` pasado como **parámetro** (`(m: typeof fs) => m.readdirSync(…)`). De las siete, (b) y (g) caen en la letra del punto (1) («lector pasado como VALOR»); **(a), (c), (d), (e) y (f) no están en ningún punto**. Ninguna existe hoy en `test/`.

**Bloque 2 · ¿la totalidad de lecturas planas se satisface sin declarar de verdad?** Sí, de dos maneras, las dos medidas sobre ficheros REALES (editados y restaurados con `git checkout`):

- **2a** — la clave es `fichero :: texto del argumento`, sin contar sitios. `esperas-de-qa.test.ts` declara `argumentos: ["dir"]`; añadí al final del fichero `export const zzSonda = (dir = join(repoRoot, "qa")) => readdirSync(dir)` (y una segunda variante con `import { readdirSync as zzLeer }` estático arriba): **22/22 verde** las dos veces. Una lectura NUEVA de `qa/` entera pasa sin declarar si comparte texto de argumento con una ya declarada, y `dir`/`d` son los textos que más se repiten (`esperas-de-qa`, `contract-fixtures` los declaran hoy).
- **2b** — `sitios` cuenta FUNCIONES recursivas, no lo que leen. En `scene-fixtures.test.ts` (declarada con `sitios: 1`) metí dentro de `escenasDe` un `readdirSync(join(…, "qa"), { withFileTypes: true })`: la llamada entra en `dentroDeRecursiva`, no es plana, `sitios` sigue en 1 → **22/22 verde**. Lo mismo vale para `corpusDe`, `anda`, `ficherosDelCliente`.

## Hallazgos de la vuelta 2

### V2-1 · importante — la totalidad de lecturas planas colapsa N lecturas en una clave, y `sitios` no ve un lector nuevo dentro de una función recursiva declarada

Es la respuesta a la pregunta del coordinador: sí se puede satisfacer sin declarar. Reproducción exacta en 2a y 2b. Ninguna de las dos está en `_lo_que_esto_NO_sujeta` (el punto (4) habla de `argumentos` que casan por texto cuando la CONSTANTE cambia de destino; esto es otra cosa: una lectura MÁS con el mismo texto, o dentro de una función ya contada). Lo que esperaba: que la clave de lector lleve su cuenta de líneas como `recorridos` lleva `sitios` (una segunda `readdirSync(dir)` en el mismo fichero cambia la cifra y sale rojo), y que un recorrido declarado cuente sus LECTORES (no solo la función), o que ambos agujeros se midan con su `it` en (2)/(4). Hasta entonces, la «red» de mutua/pila/parámetro (puntos 2 y 3) es más fina de lo que el padrón dice: basta con que la lectura reutilice el texto `dir`.

### V2-2 · menor — cinco formas nuevas invisibles sin declarar

(a) re-export desde un módulo local de `test/`, (c) `import().then(fs => …)`, (d) especificador en template literal, (e) `process.getBuiltinModule`, (f) `import x = require(…)`. Las dos primeras son las que alguien podría escribir sin querer esquivar nada (un `test/fs.ts` que re-exporte, un `.then`); las otras tres son rarezas. Van al punto (1) con su `it`, o se cierran: (d) es una línea (`ts.isNoSubstitutionTemplateLiteral`), (a) exige seguir re-exports y es más caro.

### Anotaciones

- El 163 v2 tarda 30 s (30 sabotajes + 2 bloques = 33 subprocesos). Sube de 16 s; sigue por debajo de lo que el README tolera para la clase headless. La fila del README del 163 la actualizó el ingeniero; no la retoco.
- El aserto de existencia nuevo («ninguna entrada apunta a un fichero que no existe») hace que la entrada caducada dé DOS rojos; el 163 exige los dos. Correcto.

`npm test` sobre `6b43e2c1` con el árbol limpio (corrido por QA): **3286/3286, exit 0**.

## Veredicto de la vuelta 2

**Apto con una reserva** (V2-1). Todo lo que devolví en la vuelta 1 está cerrado y medido, y las 17 formas son ahora sabotajes que se ponen rojos con nombre. La reserva es nueva y sale de lo que se construyó para cerrar H-2: la totalidad de lecturas planas es la red declarada para lo que el detector no ve como recursivo, y esa red se atraviesa con dos formas medidas sobre ficheros reales sin que ningún punto del padrón lo diga. No es un falso verde sobre el árbol de hoy. Puede cerrarse (cuenta por clave + lectores por recorrido) o declararse con su `it`; en los dos casos el 163 debería ganar el sabotaje/agujero correspondiente. V2-2 es menor y se declara.
