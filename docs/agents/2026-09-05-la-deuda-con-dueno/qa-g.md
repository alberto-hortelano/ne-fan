# QA-G · PR #461 (#410) — la huella del TileStore sin las salidas, y lo dice el tipo

**Veredicto: APTO CON HALLAZGOS** (ninguno bloqueante; los tres son observaciones de alcance, no defectos de lo entregado).

Worktree `/home/al/code/ne-fan-t13-qa-g`, HEAD `4b97f86` (apilada sobre `2f8b3d1`, PR-F). Diff validado: `git diff 2f8b3d1..4b97f86`
(11 ficheros). `NEFAN_PORT_OFFSET=1000`, preset `e2e-sin-creditos`, cero créditos. Fecha: 2026-09-05.

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Issue, literal**: «dos escenas iguales con `exits` distintas tienen la misma huella» | ✅ | `node --import tsx --test test/escena-servida.test.ts` → 7/7. Caso «una, dos, ninguna salida → misma huella» más negativos (`terrain_grid`, `combat.health`, `position`) |
| **Issue, literal**: «`actualizarSalidas` no cambia la huella» | ✅ | `carga-de-tile.ts:167` escribe `entry.salidas`, la huella solo se calcula en `TileStore.add` sobre `tile.escena`. En juego: guion 73 paso 2 (`exits_changed` → 0 derivaciones nuevas del tile) y paso 3 (el tile re-difundido con las salidas nuevas NO re-deriva: `tile_0_0 tras la vuelta: 1 derivación(es) · escena servida idéntica sin las salidas`) |
| **Plan §8**: la garantía va EN EL TIPO (`EscenaSinSalidas = WorldScene & { exits?: never }`) | ✅ con matiz (H1) | Fichero de prueba con 8 rutas, `tsc -p tsconfig.tests.json`: cierran la llamada directa (TS2345), el spread `{...servida}` (TS2345), el `as EscenaSinSalidas` directo (TS2352 «neither type sufficiently overlaps») y el campo `escena` del store (TS2322). Quedan abiertas: ensanchar antes a `WorldScene`, `{...s, exits: undefined}` y `as unknown as` |
| Negativo del candado de tipo | ✅ | Quitando el `@ts-expect-error` de `escena-servida.test.ts:93` → `typecheck:tests` rojo: `TS2345 … 'SceneExit[]' is not assignable to type 'undefined'`. Restaurado (`git checkout`) |
| **Plan §8**: `position_declared` y `combat` ENTRAN en la huella | ✅ | Test del PR cubre `combat` y `position`. Añadido por QA (script efímero, no commiteado): dos escenas iguales salvo `npcs[0].position_declared` → `huella distinta: true` |
| Regla `las-salidas-no-se-sellan-en-la-escena` extendida al cliente, entero | ✅ | `files` = `nefan-html/src/**/*.ts`. Negativo sobre el ÁRBOL REAL: `x.exits = []` en `src/world/`, `src/ui/` y `src/` (raíz, donde vive `main.ts`) → `architecture.test` 1 fail nombrando los TRES ficheros. Positivo: `entry.salidas = []`, `escena.exits ?? []`, `escena.exits === undefined` en `src/world/` → no salta. Ficheros borrados; árbol limpio |
| `__nefan.scene` re-sirve `{...escena, exits}` (forma del wire) | ✅ | Guiones 08 y 68 verdes (68: «las salidas van encima, como lista» en arranque y resume). `grep -rn "\.scene\b" nefan-html/src` → cero lectores de `entry.scene`; `main.ts:340` lee `entry.escena`. Los ~50 lectores de `qa/` leen `__nefan.scene`, cuya forma no cambió |
| Mutación: módulo nuevo `escena-servida` con `break: "sin medir"` | ✅ | `npm run mutacion -- pendiente` → «11859 mutantes medidos antes + **1 módulo(s) sin base: escena-servida**». `npm run deuda` (tras `coverage`) → «Deuda PARCIAL — 83 items de 2 de 3 fuentes. Sin medir: mutación» con causa «sin medir 1 de 42 módulos (1 ficheros sin dato) … (sin medida previa)». Los 83 son los del baseline |
| La batería declarada es la única que lo carga | ✅ | `npm run afectado` → `src/protocol/escena-servida.ts → escena-servida: sus baterías lo cargan`; `grep -rln escena-servida nefan-core/test` → solo `escena-servida.test.ts` |
| `npm run verify` | ✅ | rc=0, `tests 2106 · pass 2106 · fail 0` |
| `crap --check` | ✅ | «dentro de los umbrales»: tope 0 por encima, objetivo 7 por encima, cobertura 89,2 % |
| `cd nefan-html && npx tsc --noEmit` | ✅ | rc=0 |
| `main.ts` no sube | ✅ | 2374 líneas (= `client-file-size.json`); `style-apply.ts` 532 |
| Cero asignaciones `.exits =` en el cliente | ✅ | `grep -rnP "\.exits\s*=(?!=)" nefan-html/src` → 0 |
| Batería de navegador afectada | ✅ | `NEFAN_PORT_OFFSET=1000 node qa/run.mjs 01 08 64 68 73` → 5 en verde · 0 en rojo, rc=0 |
| Re-difusión con otras salidas por **Reanudar** | ⚠️ no aplica | Reanudar pasa por `resetWorld()` → `TileStore.clear()`: el tile llega a un store vacío y se deriva siempre (no hay huella previa que comparar). El camino que SÍ compara la huella es la re-difusión desde caché dentro de la misma sesión (viaje y vuelta, `request_tile` de un tile ya conocido), y es el que ejerce el guion 73 |

## Adversarial (qué probé para que fallara)

- **`separarSalidas` sobre una servida SIN `exits`** (fuera de tipo; el bridge siempre emite `exits: []`, `wire-scene.ts:106`, y `addTileRaw` añade `exits: []`): devuelve `exits: undefined`, `"exits" in escena === false`, y la huella coincide con la de `exits: []`. Consecuencia en cliente si el wire violara el tipo: `entry.salidas = undefined`; `travelPanel.setExits` lo tolera (`!exits`), pero el hook `escenaServida()` haría `[...undefined]` y lanzaría al leer `__nefan.scene`. Teórico: ningún productor vivo lo hace. Ver H3.
- **`actualizarSalidas` para un tile que no está en el store**: `deps.log("salidas de … antes que su escena: llegan con ella")` y return — sin cambios respecto a la base.
- **¿La huella como IDENTIDAD del tile?** `fingerprints` es privado del store, indexado por `tile.key`, y su único lector es `add` (`grep fingerprints nefan-html/src` → solo `tile-store.ts`). Dos tiles con la misma escena y distintas salidas comparten huella sin consecuencia: nadie la usa para encontrar un tile. No hay bug nuevo.
- **Orden de claves**: `huellaDeEscena` es `JSON.stringify`, así que el mismo contenido con otro orden de claves da otra huella (comprobado). Pre-existente y hoy inocuo: `formatDToWorld` es determinista y el guion 73 mide «escena servida idéntica» tras la vuelta.
- **Negativo del guion 73**: con `const fingerprint = JSON.stringify({ ...tile.escena, exits: tile.salidas })` en `tile-store.ts` (la huella de antes de #410) → ROJO exactamente donde debe: `✘ 3 · #410 … — 2 derivaciones (había 1) — la escena servida es idéntica sin las salidas: la huella lleva las salidas`; los pasos 1, 2 y 4 siguen verdes. Restaurado (`git checkout`).

## Hallazgos

### H1 · menor — la garantía del tipo es sobre la EXPRESIÓN, no sobre el valor: un `WorldScene` intermedio la deshace
- **Repro**: `const w: WorldScene = servida; huellaDeEscena(w);` compila (`EscenaServida` <: `WorldScene`, y `WorldScene` es asignable a `EscenaSinSalidas` porque no declara `exits`). También `huellaDeEscena({ ...servida, exits: undefined })` (inocuo en runtime: `JSON.stringify` omite `undefined`).
- **Qué esperaba**: el plan pide «que el overlay del wire no quepa en la huella por construcción». Cabe si alguien pasa la servida por cualquier parámetro tipado `WorldScene` antes de llegar a la huella. Hoy ningún camino del cliente lo hace (`addTile` separa en su primera línea y de ahí en adelante todo es `EscenaSinSalidas`), así que es un límite del candado, no un fallo. Vale que la PR lo diga: el candado real es la pareja tipo + regla de arquitectura, no el tipo solo.

### H2 · importante (alcance, para issue aparte; no es regresión de esta PR) — la posición VIVA de los NPC entra en la huella y hará que un tile que vuelve se re-derive igual en partida real
- **Dónde**: `alWire` → `escenaConCombateVivo` (`mundo-persistido.ts:253-256`) sobrepone `position: [...estado.posicion]` a TODO npc con entity record (`estadosDeCombate` itera `ctx.narrative.entities`, no solo hostiles). Esa `position` viva forma parte de la escena que se huella.
- **Consecuencia**: en cuanto un NPC se haya movido (NpcBehaviorSystem, roles ambientales) entre dos difusiones del mismo tile, la huella difiere y la colisión del plan se re-deriva aunque `ground`/`volumes` —lo único que la colisión derivada lee— no hayan cambiado. Es exactamente el síntoma de #410 («rehacer lo que no cambió», solo CPU) por otra puerta. La crítica y el plan decidieron que `position_declared`/`combat` entran, y el PR lo hace tal cual; lo que nadie miró es que también entra la posición viva, que es la que cambia a cada rato.
- **Evidencia**: deducido del código. **No reproducido en el bench**: los NPC del motor falso no se mueven (guion 73: «escena servida idéntica sin las salidas» tras ida y vuelta). El guion 73 lo detectaría en cuanto ocurra: nombra `npcs: <id>: position` en el diagnóstico.
- **Qué esperaba**: que la huella se calcule sobre lo que la colisión derivada lee (el plan: `__plan.ground`/`__plan.volumes`, o al menos la escena sin los overlays vivos), o que se decida por escrito que re-derivar por movimiento de NPC es aceptable. Es una decisión, no un arreglo de una línea: va a issue.

### H3 · menor — restaurar vs derivar solo se observa por una traza de dev
- **Repro**: no hay nada en `__nefan` que exponga la huella, `sceneChanged` ni si `svgCollider` se restauró; `probeCollide(x,z)` da lo mismo por los dos caminos. La única señal es `dlog("[collision] <tile>: plan aplicado …")` (`world/collision.ts:137`), gateada por `__nefan.debug(true)`.
- **Qué esperaba**: un contador o un `tileEpisodios`/`debugState` que diga «restaurado»/«derivado» por tile, para que el guion no dependa de una cadena de `console.log`. El guion 73 se construye sobre la traza y funciona (probado en negativo), pero si alguien reescribe ese texto, el guion deja de medir sin ponerse rojo: por eso exige que el tile del molino derive ≥ 1 (testigo de que el canal cuenta) y aborta con `sinMedir` si el tile de entrada no deriva ni una vez.

### Observación visual (no atribuible a la PR)
La captura `73-…-01-de-vuelta-con-las-salidas-al-dia.png` (Maqueta 3D): al volver al tile de entrada el jugador aparece pegado a un volumen oscuro que ocupa dos tercios del encuadre, con el suelo apenas visible abajo a la derecha. El panel «Salidas» muestra las dos entradas correctas (Molino, Ermita) y el HUD dice «Scene loaded: tile_0_0» dos veces (la re-difusión del issue, visible). El spawn de vuelta contra pared es del banco/fake y del spawn del viaje, no de #410.

## Workarounds usados
- `__nefan.debug(true)` para encender la traza de derivación. Es una tecla de dev del hook, no altera el estado del juego ni oculta nada al jugador; lo que revela (H3) es que sin ella el criterio no es observable. Declarado en el guion.
- Ninguno más: ni overlays ocultos, ni estado sintético. El enlace nuevo entra por el State API igual que lo hace narrative-mcp (mismo camino que el guion 64).

## No probado
- **La primera medida de mutación de `escena-servida`** (y la de PR-F): la trae la corrida pedida; `permisoLocal` rechaza medir sin coste conocido (comprobado: `pendiente` lo lista como «sin base»).
- **H2 en vivo**: hace falta un NPC que se mueva entre dos difusiones del mismo tile; el fake no mueve a nadie. El guion 73 lo nombraría (`npcs: … position`) el día que el bench lo haga.
- **Reanudar como camino de re-difusión con huella previa**: no existe (el resume vacía el store), ver tabla.

## Lo mecánico, ejecutable
- **Nuevo**: `qa/guiones/73-la-huella-del-tile-no-lleva-las-salidas.mjs` — grupo **navegador** (corrida local, `qa/run.mjs`; fila añadida en la tabla «Los guiones sembrados» de `qa/README.md`). `aisla = ["saves", "fake-ai"]`. 11 comprobaciones; verde sobre `4b97f86`, rojo con la huella de antes de #410 (paso 3), diagnóstico que separa «las salidas siguen en la huella» de «otra cosa de la escena cambió».
- Lo que ya sujeta el core: `test/escena-servida.test.ts` (7 casos, incluido el `@ts-expect-error` que `typecheck:tests` convierte en candado) y el caso del cliente en `architecture.test.ts`.

## Comandos y salidas (resumen)
```
node --import tsx --test test/escena-servida.test.ts        → pass 7 / fail 0
npm run typecheck:tests (sin @ts-expect-error)              → TS2345 (rojo, como debe)
tsc sobre 8 rutas hacia huellaDeEscena                      → cierran 4 (directa, spread, as, campo escena); abren 3 (WorldScene intermedio, exits: undefined, as unknown as)
architecture.test con x.exits=[] en world/ ui/ raíz         → 1 fail, nombra los 3; con salidas=/lectura → 0
npm run verify                                              → rc=0 · 2106/2106
npm run crap -- --check                                     → dentro de umbrales (89,2 %)
npx tsc --noEmit (nefan-html)                               → rc=0 · main.ts 2374
npm run mutacion -- pendiente                               → 1 módulo sin base: escena-servida
npm run deuda (tras coverage)                               → PARCIAL 83 items · sin medir 1 de 42 módulos (sin medida previa)
npm run afectado                                            → escena-servida ← src/protocol/escena-servida.ts, test/escena-servida.test.ts
NEFAN_PORT_OFFSET=1000 node qa/run.mjs 01 08 64 68 73       → 5 en verde · rc=0
  (73 con la huella de antes de #410)                       → 1 en rojo · «2 derivaciones (había 1) … la huella lleva las salidas»
./start.sh --parar (offset 1000)                            → nada que parar; bloque 1000 sin puertos arriba
```
