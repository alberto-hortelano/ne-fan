# QA — tanda BH (#727, #720 reencuadrados)

Worktree `ne-fan-tanda-bh`, diff sin commitear sobre `1880e4cf`. Node v26.10.0 (`nvm use node`). Cero créditos: no se arrancó ningún servicio. No hay nada que el jugador vea. Todo lo que se prueba son instrumentos (el selector de mutación, el barrido del banco y el detector de saltos). Por eso el «flujo real» aquí es `npm run verify`, el oráculo y el guion 163 sobre el árbol real, más una pasada adversarial comparando la versión de HEAD con la nueva sobre el mismo texto.

Método de comparación: en el scratchpad monté un espejo de `nefan-core` con `scripts/mutation-plan.ts` y los cuatro `test/*` tocados en su versión de HEAD (el resto son enlaces al worktree). Después pasé la misma entrada por el código viejo y por el nuevo.

## Criterios

| Criterio | Estado | Evidencia |
|---|---|---|
| C1 · `descubrimientosDe` ve `const {readdirSync: r} = await import("node:fs")` y `const leer = readdirSync` | ✅ | Hay tests en `afectado.test.ts` (#727). Saboteé el reconocedor en una copia (quité la rama `.then`) y se pusieron rojos «ve TODAS las formas de la tabla compartida» y los dos del barrido (2 fail en cada batería) |
| C2 · las 14 formas (ahora 19) las ven los dos detectores, desde una tabla compartida | ✅ | Las dos baterías importan `test/formas-de-nombrar-fs.ts`. El sabotaje de arriba pone rojas las DOS |
| C3 · `import { readdirSync } from "./mio"` no cuenta | ✅ | Hay un `it` en cada batería. Sonda: una función local llamada `readdirSync` da 0 en el selector nuevo (el viejo la contaba) |
| C4 · la selección de `afectado` sobre main: igual o MÁS, nunca menos | ✅ en el árbol real / ❌ en código plausible | Pasé los **793** `.ts/.mts/.mjs/.js` versionados del repo entero por el viejo y el nuevo. Solo difiere 1 fichero, `nefan-html/src/world/fixtures-del-selector.ts`: `import.meta.glob(...)`, que pasa de ciegos 1 a **ciegos 0**. Está fuera del alcance del selector, así que la selección real no cambia. Pero en formas plausibles el selector nuevo ve MENOS y lo calla: ver H1 |
| C5 · los `_lo_que_esto_NO_sujeta` dicen lo mismo sobre nombres | ⚠️ parcial | Se cumple la letra: `recorridos-de-test.json` (1), la cabecera de `lectores-de-fs.ts` e `INVISIBLES` enumeran las mismas 5 formas. Pero los tres omiten las formas que se perdieron de H1 |
| C6 · negativo que nace ROJO: un `c` sombreado/ajeno que excusaba | ✅ | Guion sintético `if (!x) { const ctx = {expect(){}}; ctx.expect("z", x); return; }`: el viejo da `!x:OBS` y el nuevo `!x:SIN`. En una copia forcé `valorDesconocido` a `true` y se pusieron rojos los dos tests #720 (43 pass / 2 fail) |
| C7 · foto de `saltosDelGuion` idéntica | ✅ | 187 guiones, en modo cuerpo y en modo `helpers`, con el objeto `Salto` entero: viejo `503 saltos · 6 sin observar · sha 68c5a1c0ce59f24e`, nuevo idéntico. Los dos corren sobre el mismo `qa/` del worktree |
| C8 · binder contra mano, elegido con números | ✅ | Está en la §3 de `plan.md` (A/B/C con tiempos y la batería de sombreado) |
| C9 · no hay un helper común para cuatro semánticas | ✅ | `ctx-del-guion.ts` solo lo importa `saltos-del-guion.ts`, y `lectores-de-fs.ts` solo el selector y el barrido. Relojes, esperas y sondas no se tocan |
| C10 · foto (b) idéntica byte a byte a (a) | ✅ (inferido) | No hay foto intermedia que pueda reproducir. HEAD y el final son idénticos (C7), y de ahí se deduce que (a) = (b) salvo que un cambio se compense con otro. Me fío del sha del ingeniero para el paso intermedio |
| Guion 163 (editado) | ✅ | En el worktree no corre: con el padrón sucio se niega, que es lo que tiene que hacer. Lo corrí en un clon del scratchpad con el diff COMMITEADO (sin `assume-unchanged`): `✔ 163`, los 5 «cerrado en #727» rojos cuando toca, «las 5 formas siguen saliendo verde» y el padrón vuelve byte a byte |
| `npm run verify` | ✅ | EXIT 0 · 3556/3556 · `duration_ms 45557` · 63,8 s de reloj |
| Oráculo `qa/el-selector-ve-lo-que-la-bateria-abre.mjs` | ✅ | `✔ ningún dato que una batería abre se queda por debajo` (8 puertas, 38 datos) |
| Candados sin navegador | ✅ | 16 de 17 en verde. El rojo es el 163 negándose por el padrón sin commitear, y en el clon commiteado sale verde |
| Coste de `npm test` | ✅ | A/B del fichero que paga el checker (`un-salto-del-guion-se-observa.test.ts`), 3 corridas: viejo 2,19 / 2,13 / 2,18 s, nuevo 2,45 / 2,48 / 2,43 s, **+0,3 s**. La regla de corte del plan era +1,0 s |

## Pasada adversarial

### Selector: ¿ve MENOS que antes?
Sondas sintéticas con `DIR` resuelto a `data/scenes`, en el formato viejo → nuevo:

| Forma | Viejo | Nuevo | ¿Declarada? |
|---|---|---|---|
| `const io = { readdirSync }; io.readdirSync(DIR)` (objeto de dependencias) | `data/scenes` | **[] · 0 ciegos** | **No** |
| `class X { fs = fs; … this.fs.readdirSync(DIR) }` | `data/scenes` | **[] · 0** | **No** |
| `import fse from "fs-extra"`, `graceful-fs` → `.readdirSync(DIR)` | `data/scenes` | **[] · 0** | **No** |
| `import { glob } from "glob"; glob(DIR)` | `data/scenes` | **[] · 0** | **No** |
| `import { globSync } from "tinyglobby"; globSync(join(DIR,"*.json"))` | ciegos 1 | **ciegos 0** | **No** |
| `(import.meta).glob("../data/scenes/*.json")` (Vite) | ciegos 1 | **ciegos 0** | **No** |
| `function lista(f) { f.readdirSync(DIR) }` (receptor que viene de fuera) | `data/scenes` | [] · 0 | Sí (INVISIBLES) |
| `const fs = req("node:fs")` (`require` con otro nombre) | `data/scenes` | [] · 0 | Sí |
| `function readdirSync(){}` local | `data/scenes` | [] · 0 | Correcto por C3 |
| `promises as fsp`, default de `fs/promises`, `require("fs").promises`, `fs?.readdirSync`, `opendir`, `globSync` de node:fs | = | = | — |

¿Lo caza el oráculo? Lo probé en una copia del scratchpad: cambié `test/scene-schema.test.ts` para que lea con `const io = { readdirSync: nodefs.readdirSync, … }; io.readdirSync(SCENES)`. El selector nuevo pasa de `data/scenes` a `[]`, 0 ciegos. **El oráculo sigue verde** (otra ruta del mismo módulo tapa ese dato), así que ninguna red se entera.

### Detector de saltos: ¿el ctx por símbolo deja un falso verde nuevo?
Sondas, viejo → nuevo:
- Un `ctx` sombreado dentro de la rama: OBS → **SIN** (el arreglo).
- `const c2 = globalThis.__ctx; c2.expect(...)`: OBS → SIN. Se vuelve más estricto, que es la dirección segura.
- `m({expect(){}})`, `for (const t of [fake])`, `var` redeclarado, `let c = ctx; c = fake`, `h({ ctx: fake })`: igual en los dos. Lo que queda está declarado en (6) y (12).
- **Nuevo falso verde, estrecho:** el guion `import { listo } from "../lib/l.mjs"; …; ctx.expect("x", x); if (!x || !listo) return;`, con un `const listo` en OTRA función del fichero, da SIN → **OBS**. El viejo trataba `listo` como átomo por nombre, porque algún local se llamaba así. El nuevo lo resuelve al import y lo DESCARTA de los átomos. El agujero de fondo ya existía y **no está declarado**: un átomo que no es una variable del fichero (un import o un global) se descarta sin decir nada dentro de una conjunción. `if (!x || !process.env.Q) return` con `x` afirmado sale OBS en los dos.

### Corte y dependencias
`ctx-del-guion.ts` importa `helpers-del-banco.js` y `typescript`. No importa `saltos-del-guion.ts`, así que no hay ciclo. `lectores-de-fs.ts` solo importa `typescript`, y ningún `scripts/` importa de `test/`. Tampoco quedan copias de `MODULOS_FS`, `desnuda`, `cargaFs` ni `nombresLigados`. `desnuda` (fs) y `sinEnvoltorio` (ctx) se parecen, pero pelan cosas distintas: no son un duplicado.

### Qué mide la foto
Mide que, sobre los 187 guiones reales, el cambio NO altera nada. **No puede ver el arreglo**, porque el banco real tiene 0 receptores ajenos y 0 sombreados. El arreglo lo sujetan solo los negativos sintéticos, que se ponen rojos al sabotearlo. Además, la foto no está commiteada: es un script efímero del ingeniero (y otro mío) y nadie la volverá a correr.

## Hallazgos

1. **Importante: el selector de mutación pierde en silencio formas plausibles que antes veía (H1).** Para reproducirlo, en un test del alcance se lee `data/scenes` con `const io = { readdirSync }; io.readdirSync(DIR)`, con `this.fs.readdirSync`, con `fs-extra`/`graceful-fs`, con un paquete `glob` o con `import.meta.glob`. `descubrimientosDe` pasa de `["data/scenes"]` (o 1 ciego) a `[]` con **0 ciegos**, y el oráculo no se entera. Se esperaba lo que dice C4: «nunca menos», y si no se ve, al menos que cuente como ciego. `implementacion.md` §Desviaciones 2 dice que solo se pierden tres formas sintéticas, y eso es falso: se pierden al menos seis más, y ninguna está en `INVISIBLES` ni en las cabeceras. Hoy no hay ninguna en el árbol, así que no cambia ninguna selección real. Arreglo sugerido (lo decide el ingeniero): que el selector cuente como CIEGO una llamada cuyo nombre desnudo está en `API_ENUMERA`/`API_ABRE` y que el reconocedor NO ata a fs, en vez de descartarla. Así C3 se cumple sin callar. Si no, al menos meter estas formas en `INVISIBLES` como LÍMITE MEDIDO.
2. **Menor: un átomo que no es variable del fichero se descarta sin decirlo en el detector de saltos.** Es anterior a la tanda (`if (!x || !process.env.Q) return` ya pasaba). #720 le suma el caso del import con el nombre sombreado en otro sitio (SIN → OBS). No figura en `_lo_que_esto_NO_sujeta` de `saltos-sin-observar.json`. Hay que declararlo con su medida o hacer que ese átomo cuente como no observado.
3. **Menor: la foto C7/C10 es efímera.** No es un defecto de la entrega, pero conviene saberlo: el criterio «byte a byte» no deja candado, y la próxima tanda que toque el detector no tiene contra qué compararse.

## Workarounds usados
- Guion 163 corrido en un clon del scratchpad con el diff commiteado. Motivo: el guion se niega con el padrón sucio, y eso es correcto. El usuario (el CI) lo corre commiteado, así que no es un obstáculo real. El ingeniero usó `git update-index --assume-unchanged` sobre el worktree. No lo repetí.
- Sabotajes y sondas hechos en copias del scratchpad, nunca en el worktree. El worktree queda como lo entregó el ingeniero, salvo este `qa.md`.

## No probado
- La mutación completa que pide `afectado` (toca el instrumento): no se lanza sin autorización.
- C10 como paso intermedio (a) contra (b): no tengo el estado (a). Lo deduzco de que HEAD = final.
- Guion nuevo en `qa/guiones/`: **no se escribe**. No hay nada observable desde el arranque, y todo lo mecánico ya está en `npm test` con sabotaje comprobado. Las sondas de H1 y H2 se quedan en el scratchpad (`probe.mts`, `probe3.mts`). Su sitio natural es la tabla `INVISIBLES` o un `it` del detector, no un guion de navegador.

## Veredicto
**Apto con reservas.** Se cumplen C1-C3, C6-C10, el coste y los candados, sin cambio en ninguna selección ni en ninguna foto real. La reserva es H1: el selector, justo el instrumento que decide qué NO se mide, ahora calla (0 ciegos) ante formas plausibles que antes veía, y el informe lo niega. Antes de commitear, que vuelva al ingeniero para que esas llamadas cuenten como ciegas o, como mínimo, queden declaradas y medidas.
