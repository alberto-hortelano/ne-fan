# QA — PR 1 de #346 «El título troceado» · los átomos y el candado

Árbol: `/home/al/code/ne-fan-346-1qa`, desprendido en `298c7145` (la punta de la PR #542, ya
rebasada sobre `main`). Base de comparación: `HEAD~1` = `91466431`.

**Veredicto: APTO CON HALLAZGOS.**

El movimiento es de verdad sin cambio de comportamiento, y no lo doy por bueno porque lo diga el
informe: lo medí en cuatro planos independientes, uno de ellos ejecutando el código de las dos
puntas con las mismas entradas. Lo que NO está terminado es la otra mitad del encargo: **el
candado tiene cuatro puertas de atrás** que el ingeniero no probó (H1). Ninguna hace daño hoy
—`ui/titulo/` solo contiene `atomos.ts`—, pero la primera hoja de verdad nace en la PR 2, y el
candado existe justamente para vigilar a las hojas.

---

## 1. Criterios de aceptación, literales

Sacados de la petición del usuario (`requisitos.md` §«Decisiones tras la crítica») y del alcance
que el coordinador fijó para ESTA PR: los átomos y el candado.

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| C1 | El movimiento **no cambia el comportamiento** | ✅ cumple | Cuatro medidas independientes: §2.1 (línea a línea), §2.2 (**ejecución** de las dos puntas, 82 comparaciones), §2.3 (ids del DOM), §2.4 (píxeles del juego real, dos capturas idénticas y las otras dos con delta ≤ 1/255) |
| C2 | Las dos URLs de servicio se resuelven en el mismo instante efectivo | ✅ cumple | §2.5: `serviceUrl` es función pura de `location.search` + registro `readonly`; nadie reescribe la URL (`grep` de `history.*State` = 0); y medido en el juego: las portadas (que salen de `ASSET_STORE_URL`) son idénticas píxel a píxel antes y después con `?ai=` y `?offset=` puestos |
| C3 | `escapeHtml`/`escapeAttr` se aplican a los mismos sitios | ✅ cumple | Los sitios de uso NO entran en el diff (`git diff HEAD~1 HEAD -- …/title-screen.ts` solo toca imports y los bloques que salen); y las dos funciones dan salida byte a byte igual sobre 10 cadenas, entre ellas `<script>`, `"'<>&` y `&#39;` (§2.2) |
| C4 | El candado impide que las hojas del título se importen entre sí | ❌ **NO cumple** del todo | §3: 10 de 14 caminos saltan; **4 se cuelan** — la vuelta larga `../../ui/titulo/…`, su variante `../../../src/ui/titulo/…`, el subdirectorio hijo→padre y el alias que da la vuelta. Verificado con la CADENA REAL (`ts.preProcessFile` → `checkArchitecture`), no con `SourceFile` fabricados |
| C5 | El candado salta con import dinámico, re-export y `import type` | ✅ cumple | §3: `await import("./hoja.js")`, `export * from`, `export { X } from`, `import type` y `require()` los cinco ROJOS por la cadena real |
| C6 | `atomos.ts` es la única excepción, y no puede importar una hoja | ✅ cumple | §3, caso A/C: `./atomos.js` verde; `atomos.ts` importando `./hoja.js` rojo |
| C7 | La batería entera VERDE, sin retocar un guion | ✅ cumple | §4: **92 en verde · 0 en rojo de 92**, exit 0, desde un árbol quieto (`git status` vacío antes y durante). Segunda corrida con el guion nuevo: **93/93**. `git diff HEAD~1 HEAD -- qa/` = vacío |
| C8 | `client-file-size.json` con el `wc -l` real en el mismo commit | ✅ cumple | `wc -l` = 1621 = la cifra del JSON; `npx tsx --test test/client-file-size.test.ts` 7/7 |
| C9 | El puntero caducado de `style-apply.ts` pasa a #513 | ✅ cumple | El campo `issue` y la prosa del `porque`, las dos cosas |
| C10 | Ningún módulo nuevo por encima de 450 | ✅ cumple | `atomos.ts` = 184; `npx eslint src` exit 0 |
| C11 | Criterio «≥ 2 dueños» símbolo por símbolo, con sus excepciones DECLARADAS | ✅ cumple | §5: medí los 17 símbolos por mi cuenta contra `HEAD~1`. Los seis de un solo dueño son exactamente los declarados (plan §3 + D1 + «van con la portada»); **ningún símbolo de un solo dueño sin declarar**, y **ningún símbolo de dos o más dueños se quedó fuera** |
| C12 | La deuda no crece | ✅ cumple | `npm run deuda`: fronteras congeladas 13 (idéntico a `HEAD~1`: la regla nueva es `error`, no `warn`, y no entra en la cuenta); mutación sin tocar (`mutacion-huella.json` no está en el diff) |
| C13 | `npm run verify` verde | ✅ cumple | 2448/2448, `exit=0`. `tsc --noEmit` OK, `npm run lint` exit 0 |
| C14 | Cero créditos en toda la verificación | ✅ cumple | Todo por `e2e-sin-creditos` y `html-fixtures`; cada guion imprime `⛨ guardarraíl: cliente y bridge declaran fake:true`, y el panel de dev de las capturas dice `gasto sesión 0,00 € · total 0,00 €` |
| C16 | El estado «bridge caído» sigue como estaba | ✅ cumple | `NEFAN_PORT_OFFSET=500 node qa/fixtures-sin-bridge.mjs` → verde (99 frames, `tile_0_0`, 6 billboards, muro y registro con su motivo). Ver §9: en ese preset el título **no llega a abrirse**, así que no cubre los átomos |
| C15 | El suelo de cobertura | ⚠️ rojo, **preexistente** | H3 |

---

## 2. Cómo medí «sin cambio de comportamiento» (C1–C3)

### 2.1 Línea a línea, en las dos direcciones

No basta con «las que salieron están»: hay que mirar también qué ENTRÓ.

```
$ git diff HEAD~1 HEAD -- …/title-screen.ts | grep '^-' … > quitadas   # 141
$ git diff HEAD~1 HEAD -- …/titulo/atomos.ts | grep '^+' … > atomos    # 184
$ comm -23 <(norm quitadas) <(norm atomos)     # quitadas que NO están en atomos
import { serviceUrl } from "../net/service-urls.js";
import type { NarrativeClient, GameInfo, StyleInfo } from "../net/narrative-client.js";
```

Las **139 líneas restantes** están en `atomos.ts`, idénticas salvo el prefijo `export`; las dos
que faltan son imports que `atomos.ts` reescribe con su propia profundidad (`../../net/…`).
Y en la dirección contraria (`comm -13`), lo NUEVO son **solo comentarios, tres imports y
`DestinoDelTitulo`**: ni una línea de código se coló.

### 2.2 Ejecutando las dos puntas — la medida que el informe no tiene

Un diff de texto no distingue «el mismo código» de «el mismo código evaluado en otro orden». Saqué
los seis rangos de `HEAD~1` a un módulo aparte (fuera del árbol, en el scratchpad), importé el
`atomos.ts` de hoy, y llamé a las dos con las MISMAS entradas:

```
$ cd nefan-html && npx tsx …/diferencial.mts
82 comparaciones · 0 diferencias
```

Cubre las 9 constantes de CSS una a una, `escapeHtml`/`escapeAttr` sobre 10 cadenas (incluidas
`<script>alert(1)</script>`, `"'<>&`, `&#39;`, saltos de línea y acentos), `marcadorHtml` en sus
dos estados sobre esas 10, y `generationChipsHtml`/`coverHtml`/`worldCardHtml` sobre una matriz de
3 juegos × 4 estilos que incluye `styles_applied` ausente, un `status` desconocido, `cover_url`
ausente, `name` vacío y comillas dentro del `style_id`.

**Probado en negativo**, dos sabotajes en la copia de `HEAD~1`: `#da6`→`#db6` y un carácter menos
en la clase del `escapeHtml` → **9 diferencias**, nombrando cuál. Restaurado → 0.

Esto es lo que descarta la desviación D5 (el reordenado dentro de `atomos.ts`): no hay TDZ posible
—`INPUT_CSS` sigue detrás de `SELECT_CSS`, `COVER_BOX` detrás de `COVER_W/H`, y ninguna función se
invoca en el cuerpo del módulo— y, sobre todo, la salida es la misma.

### 2.3 Los ids del DOM

Reproduje la medida del informe (67 tokens `ts-*`/`data-*`, idénticos) y además la ensanché a
*todo* token con guion del fichero: los seis que aparecen de más son `arch-rules`, `god-file`,
`re-exporta`, `las-hojas-del-titulo-no-se-atan-entre-si`, `crear-mundo` y `subir-estilo` — cinco
de comentario y dos del literal de `DestinoDelTitulo`. Ninguno llega al DOM.

### 2.4 Píxeles del juego real (A/B contra el árbol de antes)

El guion nuevo (§6) mide el DOM, no el código, así que corre igual sobre las dos puntas. Volví el
árbol a `HEAD~1` **solo para tomar la foto de referencia**, corrí el guion y lo restauré:

| Captura | Píxeles distintos | Qué son |
|---|---|---|
| `03-subir-estilo` | **0 / 1.024.000** | — |
| `04-editor-de-personaje` | **0 / 1.024.000** | — |
| `01-home-con-el-save` | 372 (0,036 %) | La caja (379,394)-(526,435): el **id de sesión y la hora**, que cambian entre corridas. Recortada y mirada: badges y botones pequeños idénticos |
| `02-selector-de-mundos` | 2.503 (0,24 %) | **delta máximo = 1 de 255 por canal**, repartido por toda la página: el ruido del canvas WebGL del fondo. Cero píxeles con delta > 2 |

Y el guion salió **verde también sobre el árbol de antes de la PR**, con sus 30 afirmaciones: el
vocabulario visual es el mismo objeto medido, no dos parecidos.

Tras el A/B: `git diff --quiet HEAD -- nefan-html` → **`nefan-html IDÉNTICO a HEAD`**.

### 2.5 Las dos URLs de servicio

Es el punto donde un movimiento sí puede cambiar el momento de evaluación: `ASSET_STORE_URL` y
`AI_SERVER_HTTP` son `const` de módulo que llaman a `serviceUrl(...)` al cargar, y ahora cargan
en `atomos.ts`, o sea **antes** que el cuerpo de `title-screen.ts`. Lo verifiqué en vez de
razonarlo:

- `serviceUrl` es pura: `location.search` → `resolveServiceUrl` con el registro, cuyos
  `currentPort` son `readonly` y literales (`service-registry.ts`). No hay estado que pueda haber
  cambiado entre los dos instantes.
- Nadie reescribe la URL de la página: `grep -rn "replaceState\|pushState\|history\." nefan-html/src`
  → **0 resultados**. Los dos instantes ven el mismo `location.search`.
- Y medido en el juego, que es lo que importa: las portadas se piden a `ASSET_STORE_URL` y la
  captura del selector es idéntica (delta ≤ 1) con `?ai=` y `?offset=` puestos por el runner.

---

## 3. El candado, en negativo y por las caras que importan — **H1**

El ingeniero lo vio rojo con dos hojas de mentira en disco. Fui por las puertas que no probó, y
por la **cadena real**, no por `SourceFile` fabricados: texto → `importsOf` (que es
`ts.preProcessFile`) → `checkArchitecture(archConfig, …)`. Sin escribir nada en el árbol.

| Caso | Import desde `ui/titulo/…` | Esperado | Obtenido |
|---|---|---|---|
| A | `./selector-de-mundo.js` | ROJO | ROJO |
| B | `import type … from "./selector-de-mundo.js"` | ROJO | ROJO |
| C | `./atomos.js` | verde | verde |
| D | `../titulo/selector-de-mundo.js` | ROJO | ROJO |
| E | `await import("./selector-de-mundo.js")` | ROJO | ROJO |
| F | `export * from "./selector-de-mundo.js"` | ROJO | ROJO |
| G | `export { X } from "./selector-de-mundo.js"` | ROJO | ROJO |
| **H** | `../../ui/titulo/selector-de-mundo.js` | ROJO | **verde** |
| **I** | `../../../src/ui/titulo/selector-de-mundo.js` | ROJO | **verde** |
| **J** | desde `titulo/sub/x.ts`: `../home.js` | ROJO | **verde** |
| K | `./sub/hondo.js` | ROJO | ROJO |
| **L** | `@nefan-core/../nefan-html/src/ui/titulo/selector-de-mundo.js` | ROJO | **verde** |
| M | `require("./selector-de-mundo.js")` | ROJO | ROJO |
| N | `../async-ui.js` | verde | verde |
| O | el enrutador con `./titulo/home.js` | verde | verde |

**No es un artefacto de ficheros inexistentes**: el propio colector resuelve la vuelta larga
adentro de la carpeta —

```
verde  | H  vuelta larga
         spec=../../ui/titulo/atomos.js  resolved=nefan-html/src/ui/titulo/atomos.ts
verde  | J  subdir hijo->padre
         spec=../atomos.js               resolved=nefan-html/src/ui/titulo/atomos.ts
```

— o sea que un import que **aterriza dentro de `ui/titulo/`** puede escribirse de cuatro maneras
que la regla no mira. La causa es estructural, no un regex mal puesto: `imports.forbid` compara el
**especificador tal como lo escribió el autor**, y el colector ya calcula `ImportRef.resolved` (la
ruta del repo a la que apunta), que es lo único que expresa el invariante sin enumerar formas de
escribirlo. El tipo de regla `cierre` ya usa `resolved`; `imports` no.

**Y una quinta puerta, fuera de la letra de la regla pero dentro de su `why`**: una hoja puede
importar al ENRUTADOR (`../title-screen.js` → verde, resuelto a
`nefan-html/src/ui/title-screen.ts`). Eso cierra el anillo hoja → raíz → hoja, que es exactamente
lo que el `why` dice que no debe pasar («la navegación viaja de vuelta por el callback
`ir(destino)`, no por un import»). Hoy no lo hace nadie; el día que una hoja necesite tipar a su
llamador, es la línea que se escribe sola.

**Severidad: importante, y de esta PR.** Nada está roto hoy porque `ui/titulo/` solo tiene
`atomos.ts`. Pero el candado es la mitad del encargo de esta PR y su sujeto —las hojas— nace en la
PR 2; y la puerta J deja de ser teórica en la PR 5, donde el plan §8 riesgo 1 ya avisa de que
`selector-de-mundo.ts` roza el tope de 450 y podría partirse.

### Reproducirlo

Guardar como `puertas.ts` (fuera del árbol) y `cd nefan-core && npx tsx puertas.ts`:

```ts
import { checkArchitecture } from "<worktree>/nefan-core/src/contract/arch/check.js";
import { importsOf, archConfig } from "<worktree>/nefan-core/scripts/arch-collect.js";
const RULE = "las-hojas-del-titulo-no-se-atan-entre-si";
for (const [nombre, p, text] of [
  ["H", "nefan-html/src/ui/titulo/home.ts", `import { X } from "../../ui/titulo/selector-de-mundo.js";`],
  ["I", "nefan-html/src/ui/titulo/home.ts", `import { X } from "../../../src/ui/titulo/selector-de-mundo.js";`],
  ["J", "nefan-html/src/ui/titulo/sub/x.ts", `import { X } from "../home.js";`],
  ["L", "nefan-html/src/ui/titulo/home.ts", `import { X } from "@nefan-core/../nefan-html/src/ui/titulo/home.js";`],
  ["P", "nefan-html/src/ui/titulo/home.ts", `import type { TitleScreen } from "../title-screen.js";`],
] as Array<[string, string, string]>) {
  const imports = importsOf(p, text);
  const v = checkArchitecture(archConfig, [{ path: p, text, imports }]).filter((x) => x.ruleId === RULE);
  console.log(`${v.length ? "ROJO " : "verde"} | ${nombre} | resolved=${imports.map((i) => i.resolved).join()}`);
}
```

---

## 4. La batería, desde un árbol quieto (C7)

El ingeniero declara 92/92 y declara también un error de método suyo (editó el fichero mientras
corría la tanda y salió 91/92). Lo verifiqué desde cero, sin tocar nada mientras corría:

```
$ cd /home/al/code/ne-fan-346-1qa && git status --short        # vacío
$ node qa/run.mjs
92 en verde · 0 en rojo de 92 · capturas en qa/capturas/2026-09-09T11-43-25-475Z-59168
EXIT=0
```

Cero rojos, cero `⊘`. El guion 80 —el que a él le salió rojo— pasó con `errores 5 → 5`, el mismo
contador que él midió en su tercera corrida: su diagnóstico era correcto y el rojo era del árbol
en movimiento, no del cambio.

Segunda corrida completa, ya con el guion nuevo (§6): **93 guiones, 93 en verde, exit 0**.

`git diff HEAD~1 HEAD -- qa/` es **vacío**: ningún guion se retocó para que pasara.

---

## 5. Pasada adversarial sobre `atomos.ts` (C11)

Medí los dueños de los 17 símbolos por mi cuenta, contando por bloque de primer nivel sobre el
fichero de `HEAD~1` (no me fié de la tabla del informe). Coincide, con dos matices que el informe
no dice:

| Símbolo | Dueños medidos | ¿Declarado? |
|---|---|---|
| `escapeHtml` | 15 (9 `render*`/métodos + 6 funciones sueltas) | — |
| `escapeAttr` | 6 · `BTN_PRIMARY_CSS` 6 · `BTN_SECONDARY_CSS` 5 · `SELECT_CSS` 3 (+`INPUT_CSS`) · `INPUT_CSS` 3 | — |
| `ASSET_STORE_URL` 2 · `AI_SERVER_HTTP` 2 · `marcadorHtml` 2 · `coverHtml` 2 · `BADGE_CSS` 2 | ≥ 2 | — |
| `worldCardHtml`, `generationChipsHtml` | **1** | sí, plan §3 |
| `BTN_SMALL_PRIMARY_CSS`, `BTN_SMALL_DANGER_CSS` | **1** (`sessionRowHtml`, del home) | sí, D1 |
| `COVER_BOX`, `COVER_MARK_CSS` | **1** (y su dueño se va con ellos) | sí, «van con la portada» |

Y la pregunta que nadie hizo, **la contraria**: ¿se quedó fuera algún símbolo con dos o más
dueños? Medí los nueve que se quedan en la raíz (`MODE_BADGE_CSS`, `modeBadgeHtml`,
`sessionRowHtml`, `formatDate`, `modoDelSave`, `nombreDeModelo`, `ROTULO_DE_CARPETA`,
`ARM_TTL_MS`, `marcarTarjetaFallida`): **todos de un dueño**, y el único con dos (`modoDelSave`)
los tiene los dos dentro del home, o sea dentro de la MISMA PR 4. El corte es consistente.

Lo que sí se puede colar en `atomos.ts` y no lo ve nadie está en H5 y H6.

---

## 6. Lo mecánico, en un guion: `qa/guiones/94-el-vocabulario-visual-del-titulo-es-uno-solo.mjs`

**Ojo con el número: el 93 estaba OCUPADO** (H4). Este es el **94**.

Las dos medidas del informe (129 líneas byte a byte, 67 ids del DOM) son necesarias y **ninguna
mira el juego**: un `style="…"` sigue siendo el mismo string aunque quien lo pinta haya dejado de
importar la constante y se haya quedado con una copia. Eso compila, pasa el `tsc`, no toca ningún
id del DOM, y el candado nuevo tampoco lo ve —impide el anillo, no la copia—. Es el modo de fallo
natural de las **cinco PR que quedan**, cada una llevándose una pantalla a su módulo.

El guion conduce el juego real (`e2e-sin-creditos`, cero créditos) por las cinco pantallas —home,
selector, crear-mundo, subir-estilo, editor— y afirma dos cosas distintas:

- **Los valores**: cada átomo pinta en el `getComputedStyle` del elemento vivo exactamente lo que
  declara `atomos.ts` (primario, secundario, los dos pequeños de la fila de save, select/input,
  badge; y toda portada mide 192×128 con su marcador debajo, #218).
- **La unidad**: el primario es EL MISMO en las cinco pantallas, el secundario en tres, el
  select/input en cuatro, e `INPUT_CSS` sigue siendo `SELECT_CSS` (un `<textarea>` y un `<select>`
  comparados entre sí).

30 afirmaciones, todas verdes. **Probado en negativo, un sabotaje por vez y restaurado:**

| Sabotaje | Resultado |
|---|---|
| `atomos.ts`: `background:#da6` → `#db6` | ROJO en los 5 valores del primario · la unidad VERDE (todas las pantallas cambian a la vez, que es justo lo que la unidad no puede ver) |
| `atomos.ts`: `COVER_W` 192 → 190 | ROJO la portada, nombrando los cuatro mundos y su anchura |
| `title-screen.ts`: `#ts-create` con un literal idéntico salvo `font-family:monospace` | **valores VERDES, unidad ROJA** — el modo de fallo exacto que el bloque existe para cazar |

Tras cada sabotaje, `git status --short` solo lista el guion nuevo.

---

## 7. Hallazgos

### H1 · importante · **de esta PR** — El candado tiene cuatro puertas de atrás (cinco con el enrutador)

Detalle, tabla y receta de reproducción en §3. Lo que el usuario pidió es «un candado que impida
que las hojas del título se importen entre sí»; hoy impide 10 de los 14 caminos medidos.

- **Pasos**: no hay flujo de jugador; se reproduce con el `npx tsx` de §3 desde el árbol.
- **Qué esperaba**: que un import que ATERRIZA en `ui/titulo/<algo distinto de atomos>` salte,
  se escriba como se escriba.
- **Dónde está la palanca**: el colector ya calcula `ImportRef.resolved`; el tipo de regla
  `cierre` ya lo usa, `imports` no. Y el `it` nuevo, que hoy alimenta `checkArchitecture` con
  `imports` a mano, no puede ver ninguna de las cuatro: pasa por delante del resolutor.
- **Cuándo duele**: la PR 2 crea la primera hoja; la puerta J (subdirectorio) deja de ser teórica
  en la PR 5, donde el plan ya avisa de que el selector roza el tope.

### H2 · menor · de esta PR — El `it` no prueba lo que su comentario afirma sobre `import type`

`test/architecture.test.ts` dice, en el comentario del caso B: «`preProcessFile` reporta también
los `import type`». **Es verdad —lo comprobé por la cadena real (§3, caso B)— pero el `it` no lo
demuestra**: le pasa `imports: [{ spec: "./subir-estilo.js", line: 3 }]` ya construido, o sea
salta por encima de `preProcessFile`. Si mañana el colector dejara de reportar los type-only, el
`it` seguiría verde y la puerta quedaría abierta. El ingeniero sí lo vio de verdad, pero con dos
ficheros en disco que ya no existen: la comprobación no quedó candada.

### H3 · menor · **preexistente en `main`** — El suelo de cobertura está rojo y el CI no lo mira

```
$ npm run coverage && npm run crap -- --check
1324 funciones medidas · cobertura de líneas 88.7% · complejidad máxima 46
Tope (no empeorar): CRAP ≤ 73 — 0 por encima.
✘ la cobertura de líneas bajó a 88.7% (mínimo 89%)     → exit 1
```

Confirmo el §3.7 del ingeniero y añado la comprobación de que **no es de esta PR ni de la tanda**:
`quality-thresholds.json` no se toca desde `#288`, y el diff de esta PR no roza `nefan-core/src`
(solo un test, dos JSON de contrato y el cliente, que está fuera del perímetro de cobertura).
`npm run verify` **no** llama a `crap`, así que ningún gate lo ve: es deuda invisible de `main`.

### H4 · menor · aviso al coordinador — El 93 ya estaba cogido

El encargo decía «el siguiente número libre es el 93 (hay 92)». Hay 92 guiones **numerados hasta
el 93**, con el hueco del `04`: `93-la-velocidad-y-el-alcance-los-dice-el-config.mjs` nació con la
PR 8 de #241. Escribí el **94**. Es exactamente el choque que pasó en #358 con dos `83`; si otra
tanda va en paralelo, el libre es el 95 (o el 04).

### H5 · menor · de esta PR — Cuatro exports públicos sin un solo lector

`generationChipsHtml`, `COVER_BOX`, `COVER_MARK_CSS` y `DestinoDelTitulo` tienen **0 usos fuera de
`atomos.ts`** (medido: `grep -rn "\b<símbolo>\b" nefan-html/src --include=*.ts | grep -v titulo/atomos.ts`).
Los cuatro están declarados (D2, D3) y ninguno hace daño. Queda anotado porque en un módulo cuya
razón de ser es «solo lo compartido», una API pública sin lector es justo la grieta por donde
entra la concentración que ningún checker ve: si la PR 5 no los estrena, bajan a privados.

### H6 · menor · de esta PR — `atomos.ts` no se puede importar fuera del navegador

Es el módulo que **las siete hojas** van a importar, y hace trabajo de módulo al cargar: dos
`serviceUrl(...)` que leen `location.search`. En Node revienta con `location is not defined`. Lo
sé porque **tuve que stubear `globalThis.location` antes del `import()` dinámico** para poder
correr el diferencial de §2.2 — no es especulación, es lo que me costó medir.

No cambia nada para quien juega (en el navegador `location` existe siempre) y no es peor que
antes (la raíz hacía lo mismo). Lo digo porque el informe declara «CERO colaboradores, cero
estado» y el fichero tiene un colaborador de runtime y dos constantes calculadas al cargar; y
porque congela, para las seis PR, la imposibilidad de escribir un test unitario de cualquier hoja
en Node sin arrastrar un stub de `location`. El informe ya reconoce que «ningún test unitario
cubre `atomos.ts`»; esto explica por qué no es solo una decisión, sino hoy una imposibilidad.

### H7 · menor · **no es un fallo, es un fantasma que quiero apagar** — La cifra de mutación del informe no casa

El informe dice «Mutación — supervivientes · 58 (0 NUEVOS)». En la punta de la PR mido **64**.
No es un error suyo: su árbol salía de `f77b9504` y la punta está **rebasada sobre `main`**, que
trae `91466431` («Reparto de la corrida 34339870322»). Los inputs de `deuda` que esta PR toca son
ninguno (`mutacion-huella.json` no está en el diff, y la regla nueva es `error` y no cuenta como
deuda congelada), así que la cifra es la misma antes y después del commit: **64 a las dos puntas**.

### H8 · menor · **preexistente** — Los dos rastros de prosa ya apuntaban a nada ANTES de esta PR

La desviación D6 aplaza a la PR 3/5 los dos rastros (`qa/guiones/92-…mjs:7` y `qa/README.md:222`,
que citan `title-screen.ts:905-909` y `:1382`) y los describe como «desplazados 25 líneas». Miré
qué hay realmente en `HEAD~1:905-909`: el bloque «— no hay ningún estilo instalado —», no el
criterio de compatibilidad que la frase describe. O sea que **la referencia ya era falsa desde la
PR 7 de #241**, que es la que se llevó ese criterio a core. No es deuda que cree esta PR; sí es un
argumento para que la PR que los toque los reescriba nombrando el módulo, como manda el plan §5,
en vez de recalcular un número.

### Sin hallazgo · crítica visual

Miré las capturas como director de arte y como jugador (`home`, `selector`, `subir-estilo`,
`editor`, y las del guion 26 con las portadas del bench). El selector compone bien: las cuatro
portadas 3:2 con luz coherente entre sí, el nombre del estilo bajo cada una, los chips de
generación legibles a su tamaño y el panel derecho con la jerarquía correcta (estilo → escenarios
→ personajes → generación). La fila de save lee de un vistazo, y los dos botones pequeños
(verde/rojo apagado) distinguen la acción segura de la destructiva sin gritar. **Nada de esto lo
mueve la PR**: la comparación píxel a píxel contra el árbol de antes da 0 diferencias en dos de
las cuatro capturas y ruido de ≤ 1/255 en las otras dos.

Una observación que **no es de esta PR** y no la abro como hallazgo: a 1280×800 la cuarta tarjeta
(«Toledo, 1200») queda cortada por el borde inferior sin indicación de que hay más abajo. Es
territorio del guion 33 y del issue de UI que corresponda.

---

## 8. Workarounds usados, y su veredicto

| Workaround | Por qué | ¿Afecta al jugador? |
|---|---|---|
| Stub de `globalThis.location` antes de importar `atomos.ts` en Node (§2.2) | El módulo lee `location.search` al cargar | **No** para quien juega — en el navegador siempre existe. Sí para quien quiera testear: es **H6** |
| Revertir el árbol a `HEAD~1` para la foto de referencia del A/B (§2.4), y tres sabotajes de un fichero cada uno (§6) | Un A/B necesita las dos puntas; un guion sin negativo no demuestra nada | **No**: son técnicas de medida, no obstáculos que el jugador tenga delante. Cada una restaurada y verificada (`git diff --quiet HEAD -- nefan-html` → idéntico; `git status --short` solo lista el guion nuevo) |
| El harness del candado alimenta `checkArchitecture` con texto sintético (§3) | Para NO escribir hojas de mentira en el árbol mientras corría la batería — el error de método que el propio ingeniero declara en su §7 | **No**: pasa por la cadena real (`preProcessFile` + resolutor), que es más de lo que hace el `it` del repo |

**Ningún workaround hizo falta para OBSERVAR la feature.** El título se alcanza por el camino del
jugador (arrancar, `#ts-new`, `#ts-create-world`, `#ts-back`, `#ts-continue`); no oculté ningún
overlay ni forcé ningún estado. Regla del workaround: sin hallazgo por esta vía.

---

## 9. No probado

- **Gasto real de créditos**: todo fue por `e2e-sin-creditos` con el motor falso. Que el flujo de
  «Subir estilo» → `AI_SERVER_HTTP` cobre lo que debe **no se probó** y no se puede probar sin
  gastar; lo que sí se midió es que la constante que lo apunta vale exactamente lo mismo antes y
  después (§2.2 y §2.5).
- **`html-fixtures` (cliente sin bridge)**: **el título no llega a abrirse**, así que las
  pantallas donde viven los átomos movidos NO son alcanzables en ese preset. No lo supuse: corrí
  el candado del repo desde mi árbol y miré su captura —

  ```
  $ NEFAN_PORT_OFFSET=500 node qa/fixtures-sin-bridge.mjs
    muro: «Sin conexión con la partida» — "El servidor de la partida no responde…"
    registro (bridge): 2 entrada(s) · "bridge did not connect within 5000ms…"
  · frames emitidos: 9 → 99 · tiles: ["tile_0_0"] · billboards: 6
  ✔ html-fixtures pinta sin backend
  ```

  `qa/capturas/sin-bridge-01-error-de-arranque.png` enseña el muro y las cuatro entradas del
  registro donde debería estar el título. Ese estado del sistema queda cubierto (el cliente dice
  el error y pinta las fixtures), pero **no aporta cobertura a esta PR**, y por eso la
  verificación de los átomos va toda por `e2e-sin-creditos`.
- **Los `let` y los `render*` de la raíz**: siguen en **11** y **7**. No es criterio de esta PR
  (es el cierre del programa, PR 6), pero lo dejo medido para que la aritmética del plan tenga
  puntos de control reales.
- **Mutación**: `npm run afectado` selecciona cero módulos (el cliente está fuera del perímetro,
  `afectado.test.ts:252-259`). No hay medida pendiente que pedir por esta PR.

---

## 10. Veredicto

**APTO CON HALLAZGOS.**

El corte está bien hecho y —esta vez sí— está DEMOSTRADO: 82 comparaciones ejecutando las dos
puntas, los ids del DOM idénticos, dos capturas del juego idénticas píxel a píxel y las otras dos
con ruido de un bit, 92/92 de batería desde un árbol quieto y el criterio de los dos dueños
verificado símbolo por símbolo en las dos direcciones. No encontré ni un «sin efecto observable»
falso.

Lo que falta es la otra mitad: **H1**. Recomiendo que vuelva al ingeniero y se cierre **antes de
que la PR 2 fusione**, que es cuando nace la primera hoja de verdad y el candado deja de ser
teórico. H2 va con él (mismo fichero, mismo `it`). H5 y H6 son anotaciones para el programa; H3,
H4, H7 y H8 son para el coordinador y no bloquean.
