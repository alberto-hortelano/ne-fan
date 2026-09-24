# QA — tanda BF: el cliente entra en CRAP con cola aparte (#664)

Validado el 2026-09-24 contra #664 y la decisión del usuario («Entra con cola aparte»). También contra los ocho criterios del crítico que están en `requisitos.md`.
Node v26.10.0. **Cero créditos**: no se levanta ningún servicio y no hay nada que ver en el juego (criterio 8).

**Método.** La rama no se ha tocado: todo se midió en copias de `git archive`, dentro de `scratchpad/qa-bf-664/`.

| Copia | Contenido |
|---|---|
| `base` | `1880e4cf`, la base de la rama |
| `bf` | `base` más el diff de la rama |
| `reb` | `origin/main` = `7f5d5b4b` (con la tanda AX, #767) más el mismo diff |
| `adv` | copia de `bf` para las roturas |

`node_modules` va enlazado desde el worktree. Las roturas se hicieron con `probe.sh` en esa carpeta, que aplica la rotura, corre `crap --check` y el test de C4, y restaura.

## Criterios

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Hay un comando fijo, con las mismas funciones del core, y dos invocadores dan el mismo resultado | ✅ | `npm run coverage` con `node --import tsx` y con `npx tsx --test` dan 11,13 % y 11,13 %, el mismo peor CRAP (2970, `fps-gl.ts:711`) y la foto `--foto` idéntica en los dos (`cmp` → FOTOS-IDENTICAS). `medirFuentes` llama a `lineasDeCodigo`/`cuentaLineas`/`functionsOf` sin copiarlas (leído en el diff). |
| 2 | Solo cuenta `src/`; lo de `../nefan-core` se descarta | ✅ | `descartados: 14 fichero(s) del lcov de otro paquete`. Hay un unitario en `crap-del-cliente.test.ts`. |
| 3 | Monotonía: añadir un test no pone el gate rojo | ✅ | Probado en `adv` con un test que SOLO importa `eco-del-combate.ts` y `portrait.ts`, dos ficheros que ningún test cargaba (`SF:src` pasa de 20 a 22). `sin ejercer` baja de 60 a 58 ficheros, `--check` da ✔ con exit 0, **ninguna** clave de la foto sube y `procesar` baja de 240 a 227,8 (aviso «sobran»). Es monótona por construcción: lo que no se carga entra con todas sus líneas a 0 hits, que es el máximo cx²+cx; cargar solo puede bajarlo. |
| 4 | Contrato hermano con zod, tope medido y margen declarado, sin suelo de cobertura | ✅ | `client-crap.json`: tope 73, objetivo 30, 44 congeladas. `ContratoClienteSchema` es `.strict()` y rechaza congeladas duplicadas o por debajo del tope. El `$comment` cuenta el margen (el redondeo a 0,1) y el ruido medido. No trae suelo de cobertura. |
| 5 | `deuda` tiene un bloque propio con fuente, frescura y línea de lo no ejercido, con ~40 items y no ~650 | ✅ con reserva menor (H3) | El bloque «Cliente — …» tiene **41** items. Dice `fuente: nefan-html/coverage/lcov.info + client-crap.json` y `60 de 80 ficheros (7338 de 9492 líneas de código, 77 %) no los carga ningún test`. Tras un `touch` a un fuente del cliente sale «posiblemente obsoleta — cambiados después: src/ui/portrait.ts». Sin lcov dice «Sin medir: cliente» (lo comprobó el ingeniero; aquí se vio el exit 2 de `crap`). |
| 6 | El paso corre en el job `nefan-html` con `--check`, con coste marginal ≤ 2 s | ✅ (en local) | `ci.yml`: `npm run coverage` + `npm run crap -- --check` en el job `nefan-html`, que ya hace `npm ci --prefix ../nefan-core` (de ahí salen `zod`/`typescript`). No hay filtros de `paths:` en `ci.yml`, así que el job corre en toda PR, también las que solo tocan `client-crap.json` o `crap-score.ts`. El job real no se ha visto: no hay PR. |
| 7a | Una función nueva en `src/` por encima del tope pone el gate rojo | ❌ **NO siempre** (H1) | Una función nueva con nombre de cx 9 da rojo, y una anónima bajo un padre nuevo también (`nuevaConCallback>(anónima)`: `110.0 > 73`, exit 1). Pero **una anónima nueva de nivel de módulo en `main.ts` con cx 28 y CRAP 812 da ✔ con exit 0**: se funde con la congelada `<módulo>>(anónima)` = 1122. |
| 7b | Sin lcov, el comando falla | ✅ | `No hay …/nefan-html/coverage/lcov.info` → exit 2. |
| 7c | Un test del cliente en rojo pone rojo el paso de CI | ✅ | Con un test en rojo añadido, `npm run coverage` → exit 1; sin él → exit 0. |
| 8 | Sin guion de `qa/`, cero créditos | ✅ | No hay nada observable por el jugador. No añado guion en `qa/guiones/`: lo mecánico ya está en `nefan-core/test/crap-del-cliente.test.ts`, que corre en `npm test` del core en CI. Un guion en `qa/` no lo correría nadie en CI. |

### La pasada adversarial que pidió el coordinador

**¿Puede ponerse rojo de verdad en CI, en el job `nefan-html`?** Sí:

| Caso | Salida |
|---|---|
| Función nueva de cx 9 | exit 1 |
| Congelada que gana complejidad | exit 1 (lo midió el ingeniero; aquí se reprodujo por renombrado) |
| Test rojo | `coverage` sale con exit 1 |
| Sin lcov | exit 2 |

- `npm run crap` propaga el `process.exit(1)`, comprobado por el `PIPESTATUS` de `npm run`.
- Los dos pasos van en serie en el mismo job y sin `continue-on-error`.
- **Lo único no probado es el runner real.** `node-version: latest` puede adelantar a la v26.10 local, y el ruido de V8 entre máquinas no se ha medido fuera de esta. El redondeo a 0,1 solo cubre ruido pequeño. Para las 44 congeladas el riesgo es nulo: están en ficheros que ningún test carga y su cifra se sintetiza desde el fuente, sin V8.

**¿Aguanta la monotonía un renombrado o un cambio de fichero de una congelada?** Aquí no se rompe la monotonía, se rompe el trinquete, y a propósito:

| Rotura | Gate | Test C4 |
|---|---|---|
| `measureBust` → `medirBusto` | `210.0 > 73 medirBusto` + «sobran: measureBust no está», exit 1 | 1 rojo |
| `portrait.ts` → `retrato.ts` | `210.0 > 73 measureBust · src/ui/retrato.ts`, exit 1 | 1 rojo |
| Renombrar el PADRE de una anónima (`installTile` → `instalarTile`) | `2970.0 > 73 instalarTile>(anónima)`, exit 1 | 1 rojo |

- Es fail-loud y está escrito en el `$comment` («se regeneran sus entradas con `--foto`»).
- El mensaje del gate, en cambio, dice «La respuesta por defecto NO es tocar la foto», que para un renombrado es justo al revés (H4).

**¿Son estables las anónimas con `padre` cuando cambia su línea?** Sí. Se insertaron 10 líneas al principio de `fps-gl.ts` y 3 al de `main.ts`: `--check` da ✔, no sale ningún «sobran» y C4 queda en 4/4. La clave no lleva la línea. El precio es el agujero H1: la clave tampoco distingue entre anónimas hermanas.

**¿Dice la verdad el bloque de `deuda` sobre el 77 %?** Sí, en lo que dice:
- 80 `.ts` en `src/` (lo comprobé con `find`), 20 `SF:src/` en el lcov, 60 sin cargar, y 7338 de 9492 líneas = 77,3 %.
- «571 funciones con nombre a 0 % bajo el objetivo, sin item propio» cuadra con mi recuento de las 1053 filas: `nombre|0%|≤30` = 571.
- Calla dos cosas (H3): las **261 anónimas a 0 % bajo el objetivo**, y que el aviso de frescura también salta por ficheros que ningún test carga.

**¿Queda idéntico el core?** Sí. Con el MISMO lcov del core (generado en `bf`, copiado a `base`):
- `crap-score.ts` de `base` y de la rama dan la tabla `--top 60` idéntica (`diff` vacío) y `--check` idéntico (exit 0 en los dos, 96,29 %).
- En `deuda --json`, bloque a bloque:
  - Fronteras IDENTICO (11);
  - CRAP del core IDENTICO (10);
  - Mutación IDENTICO (72);
  - el bloque nuevo es Cliente, con 41 items;
  - el titular pasa de 93 a 134 items y de 2/3 a 3/4 fuentes.
- `npm run verify` del core en el worktree: exit 0, `tests 3570 · pass 3570 · fail 0`, 1 min 08 s.

**¿Cambia la foto al rebasar sobre la tanda AX (#767)?** **No.**
- `git apply` del diff sobre `7f5d5b4b` entra limpio: no hay conflicto textual en `ci.yml`, `.gitignore`, `package.json` ni los scripts.
- En `reb`:
  - `npm run coverage`: 72/72 tests;
  - `crap -- --check`: ✔, 44 congeladas y 0 por encima;
  - `--foto`: las mismas 44 claves con las mismas cifras que el contrato (0 que sobren, 0 nuevas, 0 que cambien);
  - `crap-del-cliente` + `crap-score` + `deuda` del core: 75/75.
- Las cifras de `reb` cambian pero no mueven la foto:

| | Antes | Después |
|---|---|---|
| Ficheros | 80 | 81 (llega `red-del-atlas.ts`) |
| Líneas | 9492 | 9533 |
| Cobertura | 11,15 % | 12,00 % |
| Funciones por encima del objetivo | 81 | 80 |
| `resolverYAplicar` | 46,9 | 23,5 |
| `registrarRefs` en `red-del-atlas.ts` | — | 8,9 |

- Las funciones de `fps-atlas.ts` no estaban congeladas, y `addTile`/`poblar` de `carga-de-tile.ts` conservan sus cifras.
- **Ojo:** el `$comment` y `implementacion.md` dirán «80 ficheros · 9492 líneas» sobre un `main` que ya tiene 81 · 9533. Es el mismo 77 % (7338 sin cargar), pero la cifra citada envejece el día del merge.

## Hallazgos

### H1 · IMPORTANTE — una función nueva por encima del tope entra en verde si es una anónima bajo un padre congelado

**Pasos:**
1. En `nefan-html/src/main.ts`, al final, añade un `window.addEventListener("keyup", (e) => { …cx 28… })` sin test.
2. `npm run coverage && npm run crap -- --check`.

**Resultado:** `✔ dentro de los umbrales`, exit 0. La fila existe: `812.0  28  0%  (anónima) · src/main.ts:1328`. Se funde en la clave `<módulo>>(anónima)`, congelada en 1122.

**Esperado** (criterio 7 y `nefan-html/test/README.md`: «Una función nueva de complejidad 9 sin test ya pasa del tope»): rojo.

El `_lo_que_esto_NO_sujeta` lo menciona en genérico («dos anónimas bajo el mismo padre se funden por el máximo»), pero no dice el tamaño del agujero, y el README afirma lo contrario sin matiz. Medido (script `fund.mts`), hay **7 claves congeladas compartidas por más de una función**:

| Clave | Anónimas | Cabe una nueva hasta |
|---|---|---|
| `main.ts · <módulo>>(anónima)` | **24** | cx 33 |
| `fps-gl.ts · installTile>(anónima)` | 3 | cx 54 |
| `DialoguePanel.constructor>(anónima)` | 3 | cx 21 |
| `KeyboardInputProvider.constructor` | — | cx 12 |
| `BridgeGameClient.constructor` | — | cx 10 |
| `crearPanelDePlugins` | — | cx 10 |
| `NarrativeClient.constructor` | — | cx 9 |

`main.ts` y los constructores de clientes y paneles son justo donde entra el código nuevo del cliente (listeners, callbacks del wire).

Las claves CON nombre fundidas (`title-screen.ts · ir` ×7, `main.ts · log` ×7…) no abren agujero hoy, porque ninguna está congelada y su límite es 73.

### H2 · MENOR — el README y el `$comment` prometen de más

- «Una función nueva de complejidad 9 sin test ya pasa del tope» es falso en los siete padres de H1.
- El `$comment` da «80 ficheros · 9492 líneas» como cifra del día. Tras el rebase son 81 · 9533 (sigue siendo el 77 %).

### H3 · MENOR — el bloque del cliente en `deuda` deja cosas fuera sin decirlo

- **Las anónimas a 0 % bajo el objetivo no se cuentan.** El aviso dice «571 funciones con nombre a 0 % bajo el objetivo, sin item propio», pero hay otras **261 anónimas** a 0 % bajo el objetivo que no se nombran. Desglose de las 1053 filas: anon 0 % > 30 = 10, nombre 0 % > 30 = 68, nombre > 0 % > 30 = 3, nombre 0 % ≤ 30 = 571, **anon 0 % ≤ 30 = 261**, resto > 0 %. No contradice ninguna cifra impresa, pero choca con el «nada desaparece en silencio» del plan.
- **La frescura salta con ficheros que ningún test carga.** Tras `touch src/ui/portrait.ts`, `deuda` dice «posiblemente obsoleta — cambiados después: src/ui/portrait.ts». Pero la medida de un fichero sin cargar se sintetiza del fuente y está siempre al día. Es ruido que enseña a ignorar el aviso.

### H4 · MENOR — el mensaje del gate da el consejo equivocado en un renombrado

Si renombras o mueves una congelada, el gate dice `210.0 > 73 medirBusto` y cierra con «La respuesta por defecto NO es tocar la foto: es un test, o partir la función». Para un renombrado, la respuesta correcta es regenerar la entrada. El caso se detecta solo, porque en la misma salida aparece un «sobran … no está» con la misma cifra, pero el mensaje no lo cruza. El `$comment` sí lo explica. Quien vea el rojo en CI solo lee el mensaje.

### H5 · MENOR — importar da cobertura sin ejecutar

Importar `eco-del-combate.ts` sin llamar a nada baja `procesar` de 240 a 227,8. Las líneas de firma de un método de clase cuentan como ejecutadas al evaluar la clase, y la síntesis a 0 hits no lo imita. No rompe la monotonía: solo baja. Pero sí tiene un efecto en la foto:
- si alguien la aprieta después de un test que solo importa, la cifra congelada incluye ese crédito fantasma;
- si luego el test deja de importar el fichero, el gate se pone rojo sin cambio de código.

Es un borde; lo dejo anotado.

## Workarounds usados

- **Copias con `git archive` y `git init` propio en el scratchpad (`base`, `bf`) para `deuda`**, que necesita git y el tag `mutacion-ultima`: le puse uno sintético a la copia. No afecta a nadie. Los dos lados se midieron igual, y el bloque de mutación sale «sin medir» en los dos.
- **El lcov del core generado en la copia `bf`**: 13 tests fallan en la copia porque leen historia de git (`afectado`, `repo-hygiene`) y la copia no es un repo. El lcov sirve para comparar el script antes y después, porque es el mismo fichero para los dos lados. No es una medida de cobertura del core.
- **Un tropiezo mío, sin daño a la rama.** El primer intento de copias fue sobre `scratchpad/base` y `scratchpad/bf`, que ya existían con material de otra fase. Les extraje encima el mismo `git archive` de `1880e4cf` y apliqué el diff en `bf`. No borré nada. Rehice todo en `scratchpad/qa-bf-664/`. Si alguien usaba esas dos carpetas, `bf` tiene ahora el diff de la rama aplicado.

## No probado

- **El job `nefan-html` en el runner de GitHub**: no hay PR. Todo lo de CI es una réplica local de sus pasos con Node 26.10. Tampoco el ruido de V8 con el `latest` del runner, si es distinto.
- **La mutación de `scripts/`**: no hay módulo que la mida (punto c del issue de backlog del ingeniero).

## Veredicto

**Apto con reservas.**
- El diseño cumple lo que el usuario decidió: el cliente entra con su propio comando, su propio tope por función y su propia cola.
- Cumple también la monotonía (medida), el core idéntico (medido) y la foto estable tras el rebase sobre AX (medido).
- La reserva es **H1**: el criterio 7 («una función nueva por encima del tope pone el gate rojo») no se cumple para las anónimas nuevas bajo siete padres congelados, y el más transitado es el nivel de módulo de `main.ts` (24 anónimas; entra en verde una de CRAP 812). O se cierra, o se declara con su tamaño en el contrato y el README en vez de la promesa genérica. H2–H5 son menores.
