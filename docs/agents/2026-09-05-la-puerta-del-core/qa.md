# QA #359 reencuadrado — «la pureza browser-safe se deriva del grafo»

**Veredicto: APTO CON HALLAZGOS** (ninguno bloqueante; uno importante, el resto menores).

Worktree desprendido `/home/al/code/ne-fan-359-qa`, HEAD `1a70c73`, base `main` = `0023eba`. 2026-09-05. Criterio:
la **aceptación reencuadrada** de `requisitos.md`. Nada se arregló; todas las roturas se hicieron y revirtieron aquí
(`git status` limpio al final, salvo este fichero y el guion nuevo `qa/el-cierre-ve-el-node-a-saltos.mjs`).
Sin mutación lanzada, sin servicios, sin créditos, sin push.

## Criterios → veredicto → evidencia

| Criterio (aceptación reencuadrada) | Veredicto | Evidencia (comando + salida resumida) |
|---|---|---|
| El candado calcula el cierre transitivo desde `nefan-html/src` (alias + relativos, `.js→.ts`, `index.ts`) y falla si algo del cierre importa `node:*`; nace verde **40/41 → 81/82 → 0** | ✅ cumple | Guion propio sobre el colector real (`medir-cierre.ts`): `entradas 50 · rutas @nefan-core 41 · cierre 82 (ts 81) · con node:* 0 · fuera de core-puro-sin-node 11 · no escaneados 0 · violaciones error 0`. Idéntico a la cifra del ingeniero; la aceptación decía 40→81 porque contaba solo `.ts` |
| Probado en negativo con un `node:fs` a dos saltos | ✅ cumple | A1: `node:fs` en `src/rng.ts` → 1 violación, solo la regla nueva: `nefan-core/src/rng.ts:1 — "node:fs" entra en el cliente por: nefan-html/src/renderer/fps-gl.ts → nefan-core/src/scene/blueprint/fps-relief.ts → nefan-core/src/rng.ts → node:fs`. `core-puro-sin-node` y `html-solo-alcanza-core-por-el-alias` verdes: es exactamente el hueco que se cerraba. Y a TRES saltos (A3, `src/vec3.ts`): cadena `main.ts → combat/registry.ts → combat/basic-combat-system.ts → vec3.ts → node:fs` |
| `html-no-importa-core-con-node` se borra, `grep` a cero | ✅ cumple | `grep -rn "html-no-importa-core-con-node\|html-sin-node-ni-rutas-crudas"` (sin node_modules/.git/dist/coverage/.tmp): solo `docs/agents/2026-09-05-la-puerta-del-core/{requisitos,critica}.md` (el registro de la tarea). Ninguna aparición en código, contratos, CI ni docs de arquitectura |
| `core-puro-sin-node` no cambia sus `files` | ✅ cumple | `diff` de la lista `files` entre `0023eba` y HEAD: **IDÉNTICOS** (10 globs). Solo cambió el `why` |
| `index.ts` y `package.json#exports` intactos; cero líneas en `nefan-html/src` | ✅ cumple | `git diff --numstat 0023eba..1a70c73 -- nefan-html/src nefan-core/src/index.ts nefan-core/package.json nefan-html/tsconfig.json nefan-html/vite.config.ts` → **0 líneas** |
| No hay barrel ni lista blanca | ✅ cumple | El diff son 11 ficheros: checker, colector, especificador, plan de mutación, contratos, tests, CLAUDE.md. Ningún `browser.ts`, ninguna lista de módulos |
| El mensaje sirve a quien lo lee en CI | ✅ cumple | Nombra fichero culpable + línea (`rng.ts:1`), el camino entero desde el fichero del cliente y el import prohibido al final; sale por `formatFailure` con el `desc` de la regla y la pista de reparación. Ver hallazgos 4 y 6 para los matices |
| `npm run verify` | ✅ cumple | exit 0, `real 0m29,4s`, `tests 2163 · pass 2163 · fail 0` |
| `npm run coverage && npm run crap -- --check` | ✅ cumple | `1252 funciones · cobertura 89.1% · complejidad máx 46 · CRAP ≤ 73 — 0 por encima · mínima 89% — ahora 89.1% · ✔ dentro de los umbrales` |
| `npm run deuda` → fronteras 13 | ✅ cumple | `Fronteras — deuda congelada · 13`; `sin medir 2 de 43 módulos` (escena-servida, arch-cierre) |
| `tsc --noEmit` del cliente | ✅ cumple | `TSC_OK` con 0 líneas cambiadas allí |
| `npm run mutacion -- pendiente` dice `arch-cierre` sin base | ✅ cumple | `Se medirían 43 de 43 módulos (COMPLETA: el selector no puede descartar nada) · 11859 mutantes medidos antes + 2 módulo(s) sin base: escena-servida, arch-cierre`. La completa la fuerzan `mutation-plan.ts`/`mutate.ts`/`mutacion.ts`/`stryker.config.json` (instrumento), como asumía el plan |
| `npm run mutacion -- lotes` sin cambios salvo el módulo nuevo | ✅ cumple | `diff` antes (instrumento de `main`) / después: única diferencia `lote 8 SIN MEDIDA DE RELOJ arch-cierre` (escena-servida pasa a lote 9). Los 7 lotes medidos idénticos |
| Deduplicación de `especificador.ts`: `afectado` da EXACTAMENTE lo mismo | ✅ cumple (con la salvedad esperada) | Con el instrumento de `main` (`git checkout 0023eba -- nefan-core/scripts …`) y con HEAD: `--rango 78e3d92^..78e3d92` → 9 módulos **IGUALES**; `--rango 2bfdcc3^..2bfdcc3` (#456) → 14 **IGUALES**; `--rango 90d001b^..90d001b` (#455) → antes `[]`, después `['arch-cierre']` — #455 tocó `src/contract/arch/check.ts`, que la batería del módulo nuevo carga (`→ arch-cierre: sus baterías lo cargan`): es «salvo el módulo nuevo», no un cambio de resolución |
| Candados en negativo del motor (dos formas distintas a las del ingeniero) | ✅ cumple (6 de 8 rojos; los 2 verdes son hallazgos 1 y 2) | N1 poda del destino no escaneado en `cierreDesde` (antes de `padres.set`) → `fail 1`; N2 padre sobreescrito (queda el camino largo) → `fail 3`; N3 solo se juzgan las entradas → `fail ≥ 9` en las dos baterías; N6 entrada eximida abre el grafo (`check.ts`) → `fail 1`; N7 sin guarda de ciclo → `fail 5` (el test del ciclo cae a los 2,8 s, no cuelga); N8 detalle sin camino → `fail 5`. **N4** (colector: import roto vuelve a «paquete») → **94/94 verde**; **N5** (`aliasDeTsconfig` ignora en vez de lanzar) → **94/94 verde** |
| Pasada adversarial: ¿qué NO ve el cierre? | ✅ ve todo lo probado | A4 `import type … from "node:fs"` → salta; A5a `export * from` y A5b `export { x } from` → aristas, salta en el re-exportado; A6 `import("./x.js")` dinámico literal → salta; A7 `@nefan-core/data/no-existe.json` → «no lo escanea… el import está roto», camino incluido; A8 core importa `nefan-html` → lo ve `core-src-no-importa-bridge-ni-cliente`; A9 directorio `./qa-dir` → `qa-dir/index.ts` → salta; A10 `.ts` explícito → salta; A11 import roto en el core → salta en `rng.ts:1` con el camino; A12 `paths` con dos destinos → LANZA (ver hallazgo 3); A13 `node:fs` directo en el cliente → una sola violación; A14 `import type` del cliente a `session-storage` → salta (ver hallazgo 5); A15 alias sin extensión (`@nefan-core/src/rng`, válido con `moduleResolution: bundler`) → resuelve y salta |
| Guion ejecutable de lo mecánico | ✅ | `qa/el-cierre-ve-el-node-a-saltos.mjs` (abajo): 8 bloques con el colector REAL en un clon en `qa/.tmp/`, ~9 s, verde en HEAD; **probado en negativo** con N3 (6 bloques rojos), N4 (bloque 5 rojo) y `paths_de: []` (bloque 0 rojo, cierre 0) |

## Hallazgos

1. **[importante] La desviación 2 («un import roto o fuera del árbol lo denuncia el cierre») no tiene candado en la
   batería.** Revertirla en `scripts/arch-collect.ts` (`primeroEnDisco(base) ?? base` → devolver `undefined` cuando
   nada existe en disco) deja `test/arch-cierre.test.ts` + `test/architecture.test.ts` en **94/94 verde**. Es la única
   pieza que impide que un destino que no está en disco se cuele como «paquete» y pode el grafo; el motor
   (`violacionesDeCierre`) sí está probado en sintético, pero la unión colector↔motor no.
   Repro: `python3` reemplazando esas 3 líneas (ver `negativos.sh`, bloque N4) → `node --import tsx --test
   test/arch-cierre.test.ts test/architecture.test.ts` → verde. Qué esperaba: un test con el colector real (un
   `SourceFile` cuyo `resolved` apunte a un fichero inexistente; o `resolverImport("nefan-core/src/rng.ts",
   "./no-existe.js") === "nefan-core/src/no-existe.js"`). El guion nuevo lo cubre (bloque 5 se pone rojo con N4),
   así que pasa a menor el día que el guion entre en `candados-headless`. Mitiga: un import inexistente también
   rompe `tsc`/`npm run build` en CI; el agujero real es el destino que **existe pero no está en `scan.roots`**,
   y ese sí lo denuncia hoy (A7/A11) — sin test que lo defienda.

2. **[menor] La desviación 3 (`aliasDeTsconfig` LANZA ante otra forma de `paths`) tampoco tiene candado.**
   Cambiar el `throw` por `continue` → 94/94 verde. La pérdida TOTAL del alias sí la caza el `it` de «≥ 80
   ficheros» (probado: `paths_de: []` → `fail 1`), pero una forma nueva ignorada en silencio con la actual intacta
   no. Repro: `negativos.sh` N5. Qué esperaba: un test unitario de `especificador.ts` con un tsconfig sintético
   (`{"@x/*": ["a/*", "b/*"]}` → lanza; `{"@x": ["a"]}` → lanza).

3. **[menor, observación] Un `paths` que el lector no entiende tumba a los CUATRO consumidores del colector al
   cargar el módulo**, no a una regla: `architecture.test.ts` sale `tests 1 · pass 0 · fail 1` (el fichero entero
   no llega a definir sus 82 tests), y `deuda.ts`, `deuda.test.ts` y `repo-hygiene.test.ts` caerían igual. El
   mensaje es bueno (`el alias "@nefan-core/*" → [...] no tiene la forma "x/*" → ["dir/*"], la única que sabe
   resolver scripts/especificador.ts — amplía el lector antes de usarlo`) y es lo que el plan quería («falla
   ruidoso»). Lo anoto para quien lo reciba en CI: el rojo no viene de una regla, viene del `import`.

4. **[menor, aceptable] Dos reglas rojas por la misma línea cuando el culpable está DENTRO del perímetro**
   (A2, `node:fs` en `src/scene/aim.ts`): salta `el-cliente-no-alcanza-node-ni-a-traves-del-core` (con el camino
   `main.ts → aim.ts → node:fs`) y `core-puro-sin-node` (`import prohibido: "node:fs"`). No es ruido: dicen cosas
   distintas (el módulo sale del perímetro de mutación / el bundle carga node) y la del cierre aporta el camino
   que la otra no tiene. Fuera del perímetro (A1, A3) salta solo la nueva. Lo dejo como está.

5. **[menor, decisión a confirmar] Las aristas de solo-tipo cuentan.** `import type { Stats } from "node:fs"`
   en el core (A4) y `import type { SessionStorage } from "@nefan-core/src/narrative/session-storage.js"` desde el
   cliente (A14) saltan, aunque TypeScript los borre y el bundle no cargue nada. Es conservador y coherente con la
   lista negra que sustituye (también prohibía el especificador sin mirar si era tipo) y con `core-puro-sin-node`
   (mismo criterio sobre `spec`). El repo ya sabe distinguir aristas de runtime (`aristasDeRuntime` en
   `mutation-plan.ts`); si algún día un tipo legítimo de un módulo node produce un falso positivo, la salida es una
   excepción con motivo o reutilizar esa distinción — hoy no hay ninguno (0 violaciones). Yo lo prefiero así:
   `import type` de `node:*` en algo que va al navegador es un olor, y un `import type` de `session-storage` en
   el cliente es justo la «importación por accidente» que la crítica describía.

6. **[menor] El orden de las pistas del mensaje de destino no escaneado.** `el cierre alcanza "…/qa-no-existe.js" y
   el checker no lo escanea (amplía scan.roots o scan.files en arch-rules.json; si el fichero no existe, el import
   está roto)`. El caso más probable es el typo; quien lo lea probará antes ampliar `scan.roots`. Sugerencia:
   «si el fichero no existe, el import está roto; si existe, amplía scan.roots…». Además el destino se nombra con
   la ruta base (`.js`), no con el `.ts` que se buscó — correcto, pero puede despistar.

7. **[menor, acción del coordinador] El guion nuevo no está registrado**: `ci.yml` job `candados-headless` corre
   un paso por ejecutable y `qa/README.md` («Lo que corre el CI») los lista con su tiempo; `qa/el-cierre-ve-el-node-
   a-saltos.mjs` (~9 s, necesita git y el `node_modules` de nefan-core, como `el-borrado-pregunta-a-antes.mjs`)
   hay que añadirlo a los dos sitios. No lo hago yo (no arreglo, reporto).

8. **[nota, no hallazgo]** `pendiente` fuerza la corrida COMPLETA (43 de 43) porque el diff toca el instrumento
   (`mutation-plan.ts`). Asumido en el plan §7 y en `implementacion.md`; el módulo nuevo `arch-cierre` va en lote
   propio «SIN MEDIDA DE RELOJ», como debe.

## Guion nuevo — `qa/el-cierre-ve-el-node-a-saltos.mjs`

Por qué merece guion: la batería del ingeniero es sintética (imports YA resueltos que ella inventa) y el único
test con el colector real solo comprueba «≥ 80 ficheros». La rotura real (A) del ingeniero se hizo a mano una vez
y no se repite. El guion hace roturas REALES (escribir `node:fs` en ficheros del core) en un clon superficial en
`qa/.tmp/`, con el instrumento del árbol de trabajo copiado encima, y pregunta al mismo
`checkArchitecture(archConfig, loadArchFiles())` que corre `npm test`. Elige los sujetos del cierre de hoy (un
fichero fuera del perímetro puro a 2 saltos y otro a 3), así no caduca si alguien mueve `rng.ts`.

Bloques: 0 árbol intacto verde y cierre ≥ 80 · 1 `node:fs` a dos saltos → SOLO la regla nueva, con el camino ·
2 a tres saltos, cadena de cuatro ficheros · 3 `export * from` es arista · 4 import de directorio · 5 import roto
denunciado en quien lo escribe («el import está roto») · 6 `import()` dinámico literal · 7 `node:fs` directo en
el cliente, una sola vez. Exit 0/1/2; borra el clon también con SIGINT/SIGTERM; no toca el árbol.

Corrido: verde en HEAD (`real 0m9,2s`). **En negativo**: N3 → 6 bloques rojos; N4 → bloque 5 rojo (es el candado
que falta al hallazgo 1); `paths_de: []` → bloque 0 rojo («solo alcanza 0 ficheros del core»). Con el guion
presente: `architecture.test.ts`, `repo-hygiene.test.ts`, `deuda.test.ts`, `esperas-de-qa.test.ts`,
`qa-lib-tiene-quien-lo-mire.test.ts` verdes (119 + 47); `prettier --check` limpio.

## Workarounds usados

- Ninguno sobre la funcionalidad: todo se observó por el camino real (`loadArchFiles` + `checkArchitecture`,
  `node --test`, `npm run …`). El colector no admite otra entrada que el disco, así que cada ataque fue una
  edición real del árbol, revertida con `git checkout -- .` + `git clean` (estado final limpio).
- Para el «antes» de `afectado`/`lotes` sustituí el instrumento en el worktree (`git checkout 0023eba --
  nefan-core/scripts nefan-core/data/contract/mutation-targets.json`, borrando `especificador.ts`) y lo restauré con
  `git checkout 1a70c73 -- …`. Es el método de medida, no un apaño sobre la feature.
- La primera versión de mi guion escribía los ficheros auxiliares en `nefan-core/src/` mientras el sujeto vivía en
  `src/plugins/`: el checker denunció (bien) un import roto. Error mío, corregido en el guion; la corrección lo hizo
  independiente de dónde caiga el sujeto.

## Las cinco desviaciones del ingeniero

1. `cierre.quien` — sin agujero; el mensaje sale como pedía el brief y el default «el cierre» está probado.
2. `resolverImport` devuelve la base cuando nada existe — funciona (A7, A11) pero **sin candado** (hallazgo 1).
3. `aliasDeTsconfig` lanza — funciona (A12) pero **sin candado** (hallazgo 2) y tumba el módulo entero (hallazgo 3).
4. Test de anchura extra — visto: N2 (padre sobreescrito) cae por él y por otros dos.
5. `excluidos: architecture.test.ts` en `arch-cierre` — coherente con `check.ts` en `sin_mutar`; el selector lo
   respeta (el módulo se selecciona por `check.ts`, que su batería sintética sí carga). Sin agujero.

## No probado

- **Mutación de `arch-cierre`**: prohibido lanzarla; queda «sin base» hasta la corrida autorizada. Lo que hay son
  los 4 mutantes del ingeniero + mis 8 (6 muertos por la batería; los 2 vivos son los hallazgos 1 y 2, y no son
  del módulo `cierre.ts` sino del colector y del lector de alias, fuera del perímetro de mutación).
- **`qa/run.mjs` / navegador**: no se arrancó nada. Nada observable por el jugador cambia (0 líneas en cliente,
  bridge o datos de juego) y el plan lo excluía explícitamente.
- Imports dinámicos con especificador **no literal** (`import(join(...))`): `ts.preProcessFile` no los ve; el
  cliente no tiene ninguno hacia el core. Documentado por el ingeniero.
- `tsconfig.json` con `extends`: `ts.readConfigFile` no resuelve herencia, así que un `paths` heredado se
  perdería — pero entonces el cierre cae a 0 y el `it` de «≥ 80» se pone rojo (probado con `paths_de: []`). Hoy
  el tsconfig del cliente no usa `extends`.
- El comportamiento en el runner de CI (otro sistema de ficheros): `npm run verify` verde solo en local.
