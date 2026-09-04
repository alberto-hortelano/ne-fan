# QA · carril S — «el selector deja de estar anulado» (#404)

Validado sobre `273d6b9` en el worktree desprendido `/.claude/worktrees/qa-v2-selector`
(`NEFAN_PORT_OFFSET=300`, no hizo falta arrancar nada: este carril no tiene UI y se valida
entero con `afectado --rango`, que es gratis).

**Cero corridas de mutación**: ni `npm run mutate`, ni `mutacion -- local`, ni la completa.
**Cero créditos**, cero servicios levantados, ningún proceso ajeno tocado.

El punto de vista es el de quien opera el ciclo de mutación, y el peor resultado posible tiene
nombre: **que el selector se vuelva más permisivo sin que se note**. Casi todo el esfuerzo fue
buscar falsos negativos, y hay dos vivos.

---

## 1 · Criterios, uno a uno

| # | Criterio (de `requisitos.md` y del encargo) | Veredicto | Evidencia |
|---|---|---|---|
| C1 | Una PR que **no** toca el instrumento selecciona solo sus módulos, reproducible con `afectado --rango` sobre PRs reales | ✅ cumple | Tabla §2, rehecha por mí sobre los 13 commits: 10 corridas completas → 5, con motivo nombrado en las cinco |
| C1b | El «NO EJECUTA NADA» de #422 **intacto** | ✅ cumple | `8aa3f9f^..8aa3f9f` → `NADA` antes y después. También `1f472c7` (#421) y `b9a60b2` (#435) siguen en NADA |
| C2a | Un dato que **nadie** lee → ninguno, con candado **visto rojo** | ✅ cumple | `data/contract/client-file-size.json` → `ninguno`. Verificado que sus dos únicos lectores (`nefan-html/eslint.config.js`, `test/client-file-size.test.ts`) **no están en ninguna batería** (`grep` + consulta al plan). Candado en `test/afectado.test.ts:225` |
| C2b | Un dato leído **enumerando su directorio** → esa batería, con candado **visto rojo** | ✅ cumple | `data/scenes/puerto_tile.json` → `blueprint-volumenes contrato-escena scene-validate`. Roturas A, B y D reproducidas por mí, §4 |
| C2c | *(el criterio del crítico, en su forma general)* «ningún fichero de datos puede resolverse a “no lo lee nadie” sin comprobar que ninguna batería lo lee» | ❌ **NO cumple** | Se cerró la vía del `readdirSync` y se dejó abierta la del **nombre compuesto**: 6 ficheros que la batería `contrato-sprite-forge` ABRE salen `ninguno`, y `test/fixtures/fps-plans/varied.json` también. **H-1** |
| C3 | `perTest` vuelve con un número | ⚠️ no probado | Es el carril R, no éste |
| C4 | Ninguna tanda vuelve a esperar una corrida para cerrarse | ⚠️ no probado | No se puede leer del diff de este carril |
| F1 | Forzador 1 (rama `dato`) retirado **por vía derivada**, sin lista `ruta → módulos` | ✅ cumple | `efectoDeDato` usa `ctx.leen`; `grep -n "datos:" scripts/afectado.ts` = 0. Reserva: H-1 |
| F2 | Forzador 2 (`scripts/` = TOOLING) → **cierre de runtime de `mutate.ts`/`mutacion.ts`**, cinco ficheros | ✅ cumple | `instrumentoDeMedida()` devuelve exactamente `afectado, mutacion-huella, mutacion, mutate, mutation-plan`. `.github/workflows/mutation.yml` solo invoca `npm run mutacion` y `npm run mutate` → el cierre cubre lo que CI ejecuta. `scripts/manifest-kinds-con-productor.ts` sale del instrumento y entra en `asset-store-contrato`, que es lo correcto |
| F3 | Forzador 3 (`mutation-targets.json`) evaluado **por estructura** | ⚠️ cumple a medias | Lo que declara, lo hace (§3). Pero la proyección es una **lista blanca sin candado de totalidad** y el campo `aparcado` que va a añadir PR-2 de este mismo plan **nace invisible**. **H-3** |
| G | Ocho roturas deliberadas, con la novena declarada como no-roja | ✅ cumple lo declarado | Muestra de 3 reproducida exactamente + la no-roja confirmada (§4). Pero encontré **dos roturas más que se quedan verdes**: H-2 y H-4 |
| D | Cinco desviaciones del plan, correctas | ✅ cumple | Auditadas una a una en §5; la nº 1 la remedí yo con el número delante |
| V | `npm run verify` verde | ✅ cumple | `tests 2057 · pass 2057 · fail 0` en este worktree, tras `npm ci` en `nefan-core` y `narrative-mcp` |
| Coste | «+0,29 s (+26 %)» | ✅ cumple | Medido por mí sobre el mismo rango: 1,09/1,11 s antes · 1,32/1,33 s después = **+0,22 s (+20 %)**. Del mismo orden |

---

## 2 · La tabla de antes/después, rehecha

Sin workaround: `main` está exactamente en `07e3636`, el **padre** del commit del selector, así que
la columna ANTES sale del checkout principal `/home/al/code/ne-fan` sin tocar nada (solo lectura), y
la de DESPUÉS de mi worktree. Comando: `npx tsx scripts/afectado.ts --rango <sha>^..<sha>` en cada uno.

| commit | PR | ANTES | DESPUÉS (medido por mí) | ¿coincide con el informe? |
|---|---|---|---|---|
| `233b7b4` | #412 | 41 | **15** — `scene-normalize blueprint-volumenes blueprint-plan blueprint-suelo blueprint-derive world-map npc-director state-http-dispatch mundo-persistido contrato-escena entidades-del-tile scene-validate tile-edges consequence-handler serialize-llm` | sí |
| `81a7ce0` | #416 | 41 | **4** — `world-map npc-director state-http-dispatch asset-store-contrato` | sí |
| `8aa3f9f` | #422 | NADA | **NADA** | sí |
| `59d35b7` | #415 | 41 | **1** — `sprite-census` | sí |
| `5e1c7e6` | #414 | 41 | **41** (dos fuentes borrados) | sí |
| `4747917` | #440 | 41 | **7** — `scene-validate tile-edges ai-client consequence-handler render-mode speaker-resolve serialize-llm` | sí |
| `7357025` | #438 | 41 | **41** (instrumento) | sí |
| `7ac698e` | #434 | 41 | **41** (instrumento) | sí |
| `451d8bb` | #433 | 41 | **41** (desaparece `status-labels` + fuente borrado) | sí |
| `b9a60b2` | #435 | NADA | **NADA** | sí |
| `e67ae4d` | #423 | 41 | **NADA** | sí |
| `1f472c7` | #421 | NADA | **NADA** | sí |
| `c9a92c4` | #418 | 41 | **41** (instrumento) | sí |

**13 de 13 reproducidos exactamente.** El informe del ingeniero no exagera ni un número.
También reproducido `npm run mutacion -- pendiente`: **46 → 8** líneas «fuerza la completa», y las
ocho nombran su motivo (5 instrumento, 2 fuente borrado, 1 módulo que desaparece del plan).

### El descarte más peligroso de la tabla, auditado: #423, de 41 a **NADA**

Es el único que pasa de «mídelo todo» a «no midas nada», así que lo miré fichero a fichero. En
`nefan-core` tocó tres cosas y las tres se descartan bien:

- `data/contract/arch-rules.json` — el diff **añade una regla nueva** (`el-cliente-no-lee-el-puerto-del-snapshot`) y **no toca** `core-puro-sin-node`, que es de la única de la que sale el perímetro. Verificado con `git diff e67ae4d^..e67ae4d -- …/arch-rules.json`.
- `data/contract/client-file-size.json` — sus dos lectores no están en ninguna batería (comprobado contra el plan, no supuesto).
- `test/architecture.test.ts` — no está en la batería de ningún módulo.

Lo demás del commit es `nefan-html/**` y `qa/**`, fuera del paquete. **Descarte correcto.**

### Los otros descartes, por muestreo dirigido

El riesgo de un descarte equivocado no está repartido: `efectoDeFuente` (el camino de los `.ts`) no
lo toca esta PR, así que apunté a lo que sí cambia — **datos, `scripts/` y `mutation-targets.json`**.
Para eso derivé, para los **189** ficheros de datos versionados de `nefan-core`, qué contesta el
selector, y lo contrasté con un oráculo más laxo (¿alguien del alcance menciona el basename en texto
crudo?). Solo dos discrepancias, y las dos son menciones en comentario (correcto descartarlas):
`arch-rules.json` y `mutation-targets.json`. El resto de los descartes de datos sale bien **por esa
vía**; los que fallan lo hacen por la vía que ese oráculo tampoco ve, y son H-1.

---

## 3 · Los tres forzadores, uno a uno

**F1 · la rama `dato`.** Derivada de verdad: no hay ninguna lista `ruta → módulos` en el fichero, el
defecto de un dato nuevo es calculado, y el candado «…incluida una fixture que TODAVÍA NO EXISTE»
lo demuestra. La reserva es H-1: *calculado* no es *completo*.

**F2 · `scripts/`.** El cierre está bien calculado y bien acotado:

- `instrumentoDeMedida()` = `scripts/{afectado, mutacion-huella, mutacion, mutate, mutation-plan}.ts`.
- El workflow de mutación **solo** invoca `npm run mutacion -- …` y `npm run mutate -- …`, o sea las dos entradas declaradas: no hay ningún guion de `scripts/` que participe en la medida por otra puerta.
- El `comando` del plan es `node --import tsx --test`, invocado directamente: **no pasa por npm**, así que ningún hook `pre*` de `package.json` mete otro guion en la medida.
- Un guion de `scripts/` **que entre mañana**: si lo importa `mutate`/`mutacion`, entra solo en el instrumento (verificado: vaciar `ENTRADAS_INSTRUMENTO` pone el candado rojo, §4); si es sujeto de una batería, la selecciona (caso real `manifest-kinds-con-productor.ts`); si no es ninguna de las dos, sale `ninguno` — y eso es correcto, porque nada de la corrida lo ejecuta.
- Único fichero de `scripts/` dentro de algún alcance hoy: `manifest-kinds-con-productor.ts`. `scripts/` no está en el perímetro de mutación (0 de 112) ni en el de CRAP (`quality-thresholds.json` mide `src/`, `bridge/`, `services/`), así que el cambio no mueve esa deuda.

**F3 · `mutation-targets.json` por estructura.** Ejercí `comparaObjetivos` con **19 mutaciones del
fichero real** (función pura, sin fabricar commits). Lo que selecciona y lo que no:

| Cambio | Resultado | ¿correcto? |
|---|---|---|
| `porque` de un módulo · `_comment` | NADA | sí — es prosa |
| `tope_local` · `tope_lote` | NADA | sí — no tocan a un mutante |
| subir **o bajar** el `break` de un módulo | ese módulo | sí (es literalmente #416) |
| `mutate` · `tests` · `excluidos` de un módulo | ese módulo | sí |
| `comando` | TODOS | sí |
| desaparece un módulo | TODOS | sí |
| módulo nuevo | él mismo | sí |
| `directorios_completos` (añadir o quitar) | NADA | sí, con matiz (§5, desviación 2) |
| `sin_mutar` (añadir o quitar) | NADA | sí, con matiz |
| reordenar los módulos | NADA | sí |
| **campo GLOBAL nuevo** | **NADA** | **no — H-3** |
| **campo nuevo por módulo (`aparcado`, el de PR-2)** | **NADA** | **no — H-3** |

Bajar un suelo selecciona igual que subirlo, que es lo que hay que pedirle: relajar el `break` es
justo el cambio que uno querría ver medido.

---

## 4 · Los candados, vistos rojos por mí

Baseline: `npx tsx --test test/afectado.test.ts` → **67/67 verde**.

| Rotura | Lo que dice el informe | Lo que mido yo |
|---|---|---|
| **A** · `leeElDato` deja de mirar la enumeración | 3 fail | **3 fail**, los tres mismos nombres ✔ |
| **B** · el literal `"../data/scenes"` de `test/scene-fixtures.test.ts` pasa a `[".." ,"data","scenes"].join("/")` | «3 fail» en la tabla, pero el texto enumera cuatro | **4 fail** — los tres de A **más** el candado de totalidad. El texto es correcto; el número de la tabla está mal escrito. Es lo que pedía el crítico ✔ |
| **D** · `readdirSync` nuevo en `src/scene/scene-validate.ts` | 2 fail, nombrando el fichero | **2 fail**, con `+ 'src/scene/scene-validate.ts'` en el diff del aserto ✔ |
| **«no se pone roja»** · quitar `scripts/mutacion.ts` de `ENTRADAS_INSTRUMENTO` | 67 verdes, y lo declara | **67/67 verde** ✔ — la declaración es honesta |
| *(mío)* vaciar `ENTRADAS_INSTRUMENTO` entero | — | **1 fail**: «y en el árbol REAL, el instrumento incluye lo que la medida carga y no lo demás». O sea, la derivación sí tiene candado, y `mutacion.ts` es redundante hoy, no un adorno |

**Y las dos que él no probó, y que se quedan VERDES** — están en §6 como H-2 y H-4.

Todas las roturas se aplicaron sobre copia del fichero original y se restauraron; al terminar,
`git diff HEAD` está vacío y `git status` solo muestra el guion nuevo.

---

## 5 · Las cinco desviaciones declaradas, auditadas

1. **La regla de ancestros no es la del plan.** ✅ **Correcta, y con la medida por delante.**
   Reimplementé la regla del plan tal cual (basename; si nadie, cada ancestro por `includes`, primera
   respuesta no vacía) y la corrí sobre el árbol real: `data/contract/client-file-size.json` →
   `blueprint-volumenes contrato-escena npc-director state-http-dispatch contrato-sprite-forge`, o sea
   deja de ser «ninguno» — **el criterio literal de #404 muere con la regla del plan**. Confirmo también
   el efecto colateral: con esa regla `data/contract/fixtures/scene/valid/minimal.json` sale
   `contrato-sprite-forge`, que no lo lee jamás. No es un atajo con buena prosa: es el arquitecto quien
   se equivocó y el ingeniero quien lo midió.
2. **`directorios_completos` y `sin_mutar` no fuerzan la completa.** ✅ correcta en lo que afirma:
   `grep` confirma que `mutate.ts` no los lee (solo `perimetro`/`dueñoDe`, `deuda` y el propio selector),
   así que no pueden mover un score. **Matiz que no está escrito**: sí cambian el perímetro, y con él la
   pregunta que el selector hará *mañana* por un huérfano — quitar un directorio de `directorios_completos`
   apaga en silencio un futuro «fuerza la completa». Hoy lo sujeta `test/mutation-config.test.ts`; merece
   una línea en el `porque`, no un cambio.
3. **`tope_local`/`tope_lote` tampoco.** ✅ correcta. Matiz de precisión: `mutate.ts` **sí** lee
   `tope_local` (`permisoLocal`, `mutate.ts:235`) — la frase «`mutate.ts` no los mira» vale para los otros
   dos campos, no para éste. La conclusión no cambia: es una puerta de coste, no toca a un mutante.
4. **`clasifica` manda a «fuente» cualquier `.ts` del paquete.** ✅ correcta y necesaria.
   Verificado: `git ls-files '*.ts' | grep -vE '^(src|bridge|services|test|scripts)/'` → **cero**. No
   cambia una selección de hoy y cierra la puerta permisiva antes de que se abra.
5. **No implementó PR-2.** ✅ correcto, no era su carril. Pero ver H-3: PR-2 va a chocar con esto.

---

## 6 · Hallazgos

### H-1 · BLOQUEANTE — un dato que la batería **ABRE** con el nombre compuesto se resuelve a «ninguno»

`leeElDato` contesta por dos vías: el basename aparece en un literal, o el fichero enumera un
directorio ancestro. Falta la tercera, que es la forma más normal de leer un directorio de fixtures:
**abrir por nombre compuesto**, `readFileSync(join(DIR, \`${x}.json\`))`. Ahí el basename no está en
ningún literal (solo `.json`) y no hay `readdirSync` que valga.

Dos instancias vivas, las dos con su batería delante:

| Dato | Antes (#404) | **Ahora** | Quién lo abre de verdad |
|---|---|---|---|
| `data/contract/fixtures/sprite-forge/{catalog,identity,procedencia,sheets,skins}.json` | los 41 | **NO EJECUTA NADA** | `test/contract-sprite-forge.test.ts:38` — `readFileSync(join(DIR, \`${nombre}.json\`))`, batería de **`contrato-sprite-forge`** |
| `test/fixtures/fps-plans/varied.json` | los 41 | **NO EJECUTA NADA** | `test/fps-atlas-golden.test.ts:73` — `readFileSync(join(PLANS, \`${name}.json\`))`, baterías de **`blueprint-volumenes blueprint-suelo blueprint-fps-spec greybox-superficies`** |
| `test/fixtures/fps-plans/medieval.json` | los 41 | 4 módulos, **falta `blueprint-suelo`** | el mismo golden; se salva de milagro porque `test/surfaces.test.ts` sí lo nombra entero |

**Reproducción desde cero** (worktree limpio, `npm ci` en `nefan-core`):

```
$ cd nefan-core && npx tsx scripts/afectado.ts --ficheros nefan-core/data/contract/fixtures/sprite-forge/catalog.json
  NO EJECUTA NADA — ningún módulo carga nada de lo que ha cambiado.
    data/contract/fixtures/sprite-forge/catalog.json
        → ninguno: es un dato del paquete y ninguna batería ejecuta código que lo lea:
          ni lo nombra ni enumera su directorio
```

En el checkout de `main` (07e3636), el mismo comando dice **«EJECUTA LOS 41 MÓDULOS»**.

**Qué esperaba quien opera el ciclo**: que regenerar las fixtures canónicas de sprite-forge —que es
exactamente para lo que existen: `npm run fixtures-contrato` en el repo hermano las reescribe— o tocar
el plan congelado de un golden de atlas, seleccione la batería que las valida. Lo que obtiene es
«NO EJECUTA NADA», que el propio comando presenta con la frase *«Esto NO es un visto bueno»* — pero la
PR sale verde igual y nadie mide el contrato que acaba de moverse.

**Gravedad.** Es el modo de fallo que esta tanda existía para no producir, dicho con las palabras del
crítico: *«más permisivo sin que se note»*. Y no es hipotético: es el 100 % de las fixtures de un
contrato con repo hermano y la entrada congelada de un golden.

**Candado**: escrito, ejecutable y hoy ROJO → `qa/el-selector-ve-lo-que-la-bateria-abre.mjs` (§7).

---

### H-2 · IMPORTANTE — la detección de «enumera» va por el NOMBRE de la llamada: un alias la anula

`analizaLectura` marca `enumeraDirectorios` cuando ve una llamada cuyo identificador está en
`API_ENUMERA` (`readdirSync`, `readdir`, `glob`…). Es un emparejamiento por nombre, así que
`import { readdirSync as leerDir }` —o cualquier envoltura local— lo apaga entero, y con él la única
vía por la que un fixture de `data/scenes/` selecciona su batería.

**Reproducido**, sobre la misma rotura D del informe:

```
// en src/scene/scene-validate.ts
import { readdirSync } from "node:fs";            → 2 tests ROJOS, nombrando el fichero
import { readdirSync as _qaReaddir } from "node:fs"; → 67/67 VERDE
```

O sea: el candado de totalidad de enumeradores —el que el crítico pidió— se evade renombrando un
import. No hay nada que lo diga: ni el `porque` de `API_ENUMERA`, ni el test.

---

### H-3 · IMPORTANTE — la proyección de `mutation-targets.json` es una lista blanca sin candado, y `aparcado` (PR-2 de este mismo plan) nace invisible

`proyeccionDeObjetivos` compara dos cosas escritas a mano:

- global: `JSON.stringify({ comando })` — **un solo campo**;
- por módulo: `{ mutate, tests, break, excluidos[].test }`.

Todo lo demás, presente o **futuro**, es prosa por defecto. Y `PlanSchema` no es `.strict()`, así que
una clave desconocida se strippea sin decir nada. No existe ningún test que ate la proyección a las
claves que el schema conoce.

Consecuencia inmediata y no hipotética: **PR-2 del plan del arquitecto añade
`aparcado: {porque, issue, desde}` a la entrada del módulo**, y ese campo decide si un módulo se mide
o no (`seleccionDesdeElTag` lo descuenta). Medido con `comparaObjetivos` sobre el fichero real:

```
NADA  ← APARCAR un módulo (campo nuevo `aparcado`)
NADA  ← DESAPARCARLO
NADA  ← AÑADIR UN CAMPO GLOBAL NUEVO (p.ej. concurrencia)
```

Sacar un módulo del aparcadero —el acto de «vuelve a medirse»— no seleccionará a nadie. La regla que
el informe deja escrita, *«la prosa no selecciona, la estructura sí»*, hoy se implementa al revés: lo
que selecciona es una lista de cuatro campos, y **lo nuevo es prosa hasta que alguien se acuerde**. Es
literalmente el defecto que el crítico rechazó de la opción B en #404: *«el defecto de un módulo nuevo
es el silencio»*.

Mitigación parcial que sí existe y conviene decir: para que un campo global nuevo *haga* algo hay que
tocar `mutation-plan.ts`, que es instrumento y fuerza la completa **esa vez**. La segunda vez que
alguien cambie su valor, ya no.

---

### H-4 · IMPORTANTE — el candado de totalidad acepta que se nombre CUALQUIER directorio con datos, no el que se enumera

El candado dice de sí mismo: *«todo el que enumera, **o nombra el directorio de datos que enumera**, o
está en la lista con su coste»*. Lo que comprueba es más flojo:

```ts
if (!enumeraDirectorios(f)) continue;
if (directoriosQueNombra(f).some(guardaDatos)) continue;   // ← cualquiera, no "el que enumera"
```

**Reproducido**: añadí a `src/world-map/exits.ts` (dentro de varias baterías) un enumerador **ciego**
—el directorio le llega por parámetro— y, en el mismo fichero, un literal `"data/scenes"` que no tiene
nada que ver. Resultado: **67/67 verde**. Un enumerador nuevo entró sin que nada se enterara, que es
justo lo que la rotura D del informe demuestra que *no* debe pasar… siempre que el autor no escriba
ninguna ruta más en ese fichero.

Hoy no muerde (los 7 enumeradores del alcance nombran el directorio que enumeran o están en la lista de
los 5 ciegos), pero el candado promete más de lo que sujeta y su prosa lo dice como si sujetara.

---

### H-5 · MENOR — `leeElDato` empareja por `includes(basename)`: detecta coincidencias, no lecturas

`data/styles/acero_neon/faces/fachada.jpg` → **`contrato-escena`**; sus dos hermanas del mismo pack,
`porton.jpg` y `tienda.jpg` → `ninguno`. La diferencia no es que alguien lea la primera: es que
`test/style-refs.test.ts` usa la cadena `"faces/fachada.jpg"` como **valor sintético** de una fixture
en memoria, y nunca abre el fichero. Sobre-selección, o sea inocua para la seguridad — pero enseña que
el detector no distingue «lo abro» de «uso su nombre como dato», y eso hace ruido en las dos direcciones.

---

### H-6 · MENOR (pre-existente, **no** es regresión de esta PR) — los `.ts` de `test/fixtures/` no seleccionan a quien los importa

`test/fixtures/scene-validate-corpus.ts` → `ninguno`, **antes y después** (verificado en los dos
checkouts). Es la entrada congelada de `test/scene-validate-golden.test.ts`, batería de `scene-validate`.
La rama `test` de `efectoDe` solo mira la lista `tests` del plan y no el cierre de imports, así que un
`.ts` bajo `test/` que no sea un fichero de batería cae en el vacío. Lo mismo con
`test/fixtures/{tiles,commerce-manifest}.ts`. No lo introduce esta PR, pero ahora que el selector
**descarta de verdad** deja de ser inocuo.

---

### H-7 · MENOR — la infraselección de plugins que el informe declara está **incompleta**

§5 del informe la limita a `data/plugins/economy.json` y `data/games/toledo_1200/plugins/commerce.json`.
Faltan cuatro fixtures de test que caen por lo mismo (`src/plugins/loader.ts` enumera un directorio que
recibe por parámetro):

- `test/fixtures/games/plugtest/plugins/{gold_giver,test_listener}.json` → `ninguno`
- `test/fixtures/games/plugcycle/plugins/{cycle_a,cycle_b}.json` → `ninguno`

`test/state-http-server.test.ts` y `test/state-http-caracterizacion.test.ts` (batería de `npc-director`)
arrancan sesión con el juego `plugtest`, que carga esos plugins. Su hermano `test_counter.json` sí sale
seleccionado, y solo porque la línea 22 de ese test nombra el `.json` a mano. El coste declarado se queda
corto: hay que decir que también afecta a fixtures de test que alimentan una batería viva.

---

### Observación, sin gravedad — la lista `TOOLING` sigue escrita a mano y su defecto ahora es el silencio

`nefan-core/eslint.config.js`, `tsconfig.labs.json` y `tsconfig.scripts.json` no están en `TOOLING`, así
que hoy salen `ninguno` (antes: los 41). Ninguno de los tres puede cambiar un mutante —el `comando`
invoca `node --import tsx --test`, que lee `tsconfig.json`, y ése sí está—, o sea que el descarte es
correcto. Lo anoto porque la lista de seis entradas es lo único de este fichero que **no** se deriva, y
desde esta PR equivocarse en ella ya no cuesta una corrida de más: cuesta una de menos.

---

## 7 · Guion ejecutable

`qa/el-selector-ve-lo-que-la-bateria-abre.mjs` — suelto en `qa/`, no en `qa/guiones/`, por el mismo
motivo que `qa/mutacion-candados-en-negativo.mjs`: no hay UI que conducir y `qa/run.mjs` levantaría el
stack entero para nada. Sigue su patrón (cabecera con el porqué, restaura lo que toca, exit 0/1/2).

Es un **oráculo independiente**, no una copia del selector: en vez de preguntar «¿quién nombra este
fichero?», pregunta desde el otro lado «¿qué **directorios** abre o enumera cada fichero del alcance de
una batería?» —resolviendo las constantes locales contra el disco— y exige que **todo dato que cuelgue
de ahí seleccione, como mínimo, los módulos de ese fichero**. Cubre la vía cerrada por #404
(`readdirSync`) y la que queda abierta (`join(DIR, \`${x}.json\`)`).

**Probado en las dos direcciones sobre el árbol real, que es la única prueba que vale**: hoy mira
8 puertas, aprueba 30 datos y suspende 2 directorios. No puede pasar en verde por no mirar nada —tiene
un control positivo que aborta con exit 2 si encuentra menos de dos puertas, y otro si falta
`typescript`—. Salida de hoy:

```
  ✔ test/contract-model-io.test.ts → data/contract/prompts (compuesto) — 8 dato(s) bien vistos
  ✔ test/contract-prompts.test.ts  → data/contract/tools (compuesto) — 4 dato(s) bien vistos
  ✔ test/scene-schema.test.ts      → data/scenes (enumera) — 3 dato(s) bien vistos
  ✘ test/contract-sprite-forge.test.ts → data/contract/fixtures/sprite-forge (compuesto)
      data/contract/fixtures/sprite-forge/catalog.json → NINGUNO (falta: contrato-sprite-forge)
      … 5 más
  ✘ test/fps-atlas-golden.test.ts → test/fixtures/fps-plans (compuesto)
      test/fixtures/fps-plans/medieval.json → … (falta: blueprint-suelo)
      test/fixtures/fps-plans/varied.json   → NINGUNO (falta: 4 módulos)

  8 puerta(s) miradas · 30 dato(s) bien vistos
✘ 2 directorio(s) con datos que el selector descarta y la batería SÍ lee.
```

`exit 1`. **Es H-1, ejecutable.** Cuando se arregle, este guion es su verde.

Lo que **no** automaticé, porque es juicio y no mecánica: si un descarte concreto es *deseable*
(las 77 fixtures de `data/contract/fixtures/**` salen `ninguno` y está **bien**, porque su único lector
`test/contract-fixtures.test.ts` está en `excluidos` con motivo escrito y llega al schema por el `dist/`
compilado — comprobado contra el plan, no supuesto).

---

## 8 · Workarounds usados, y su veredicto

| Workaround | Por qué | Veredicto |
|---|---|---|
| `npm ci` en `nefan-core` **y** `narrative-mcp` | el worktree venía sin `node_modules` | **No es hallazgo.** Es montar el entorno, y el propio ingeniero lo declara. Sin lo segundo, `test/contract-fixtures.test.ts` no resuelve `@nefan/core` |
| Columna ANTES leída del checkout principal `/home/al/code/ne-fan` | `main` está en `07e3636`, el padre exacto del cambio | **No es hallazgo, y evita uno**: así no tuve que modificar ficheros en mi worktree para medir la línea base. Solo lectura, nada tocado |
| Cinco roturas deliberadas de fuente (`mutation-plan.ts`, `scene-fixtures.test.ts`, `scene-validate.ts`, `exits.ts`, `afectado.ts`) | ver los candados rojos, que es lo que se pedía | **No es hallazgo.** Copia previa, restauradas una a una, y `git diff HEAD` vacío al terminar |
| Cinco guiones `.ts` temporales en `nefan-core/` para derivar alcances y proyecciones | usar las funciones REALES en vez de reimplementarlas | **No es hallazgo.** Borrados; `git status` solo muestra el guion nuevo |
| Ejercer `comparaObjetivos` con textos en memoria en vez de fabricar commits | es una función pura y separada justo para eso | **No es hallazgo**, es el diseño funcionando |

Ninguno de los cinco oculta un obstáculo del usuario: el operador del ciclo de mutación teclea
`npm run afectado`/`mutacion -- pendiente` y ve exactamente lo que yo he visto.

---

## 9 · No probado, y por qué

- **`perTest` (criterio 3)** y todo el carril R: no es este carril, y no comparte fichero.
- **«Ninguna tanda vuelve a esperar una corrida» (criterio 4)**: no es una afirmación que se pueda leer de este diff.
- **Nada medido con mutación.** No lancé ninguna corrida (restricción explícita) y, además, no habría a qué apuntar: `scripts/` no está en el perímetro. **No puedo decir si este cambio mata o deja vivo un solo mutante.**
- **`npm run deuda` = 83 items**: no reproducible en mi worktree sin correr `npm run coverage` primero (sale «PARCIAL — 72 items de 2 de 3 fuentes»). Lo que sí verifiqué es la premisa: `scripts/` no está en el perímetro de CRAP (`quality-thresholds.json` mide `src/`, `bridge/`, `services/`), así que el cambio no puede mover esa deuda.
- **El resto de las roturas del informe (C1, C2, E1, E2, E3)**: reproduje una muestra de tres más la declarada no-roja. Las cinco restantes las doy por buenas por consistencia de la muestra, no por haberlas visto.
- **La clase «un dato que solo lee un proceso hijo»**: `test/asset-store-server.test.ts` (batería `asset-store-contrato`) lanza `services/asset-store/server.ts` como **hijo** en vez de importarlo, y ese fichero no está en ningún alcance. Busqué un dato versionado que se perdiera por ahí y **no encontré ninguno vivo**; queda como clase abierta, no como hallazgo.

---

## Veredicto

**Apto con reservas.**

Lo pedido está hecho y está bien hecho: los tres forzadores salen por vía derivada y sin una sola lista
`ruta → módulos`, la tabla de 13 PRs reales se reproduce sin desviarse en un número, el «NO EJECUTA
NADA» de #422 sigue intacto, `pendiente` cae de 46 a 8 líneas con motivo en las ocho, las cinco
desviaciones son correctas —la primera, la de los ancestros, salva el criterio literal de #404 que el
plan del arquitecto habría roto— y las roturas que se declaran rojas lo están, incluida la que se
declara verde.

La reserva es **H-1, y es bloqueante para cerrar el criterio 2 en su forma general**: el agujero que el
crítico midió tenía dos mitades y solo se cerró una. Con la vía del nombre compuesto abierta, seis
fixtures de un contrato con repo hermano y el plan congelado de un golden pasan de «los 41 módulos» a
«NO EJECUTA NADA» — y esa transición, en esta familia de tareas, es exactamente el fallo que no se
puede producir. El guion queda escrito y rojo para que el arreglo tenga su verde.

Detrás van tres importantes que no bloquean la PR pero sí la siguiente: **H-3** choca de frente con el
campo `aparcado` de PR-2, y conviene resolverlo antes de escribirlo; **H-2** y **H-4** son candados que
prometen más de lo que sujetan, y los dos se ven verdes con una rotura de una línea.
