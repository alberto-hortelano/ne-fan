# Crítica de #359 — «La puerta del core»

**Veredicto: REENCUADRADA.** El problema es real —la frontera browser-safe la sostiene una lista negra que
persigue— pero la solución que pide el issue (barrel o lista blanca) ataca otra cosa, cuesta churn en el
fichero que #358 está cortando, y la garantía buena ya está a mano: **derivar la pureza del grafo de imports**.
La consecuencia (1) del issue está sin medir y, medida, es cero. `main` = `0172f51`, 2026-09-05.

## El problema real, en una frase

Un módulo nuevo del core con `node:*` que el cliente alcance (directa o transitivamente) entra en el bundle de
Vite sin que ningún candado lo pare, porque hoy solo lo paran dos reglas de lista (`core-puro-sin-node` por
carpetas, `html-no-importa-core-con-node` por ficheros) y las dos tienen agujeros medibles.

## La premisa, afirmación por afirmación

| Afirmación del issue / requisitos | Verificación |
|---|---|
| «El cliente importa 36 módulos internos» | **41 rutas** (40 `.ts` + `data/combat_config.json`) desde **28 ficheros**; `grep -rhoE 'from "@nefan-core/…' nefan-html/src \| sort \| uniq -c`. `main.ts` concentra 17 |
| «`index.ts` existe y ningún fichero del cliente lo usa» | Cierto para el cliente. **Falso para el repo**: `package.json:9-15` lo publica como `exports["."]` y `narrative-mcp/server.ts:8` y `validators.ts:7-15` lo consumen vía `@nefan/core` (`ConsequenceSchema`, `NPC_DIRECTIVE_TYPES`, `PLACE_KINDS`, `parseVolumes`, `EmittedSceneSchema`…). No es un barrel huérfano: es la **puerta node** de narrative-mcp |
| «Refactorizar el core rompe el cliente y nada avisa antes de `tsc`» | Sin medir en el issue. Medido: 152 commits tocaron `nefan-core/src` en 30 días, 79 tocaron también el cliente; **0** cuerpos de commit y **0** de 169 PR mergeadas hablan de un cliente roto por el core. Y `tsc` **es** el aviso: `ci.yml:112` corre `tsc --noEmit` del cliente en cada PR, sin filtro de rutas (`ci.yml:3-6`). En un monorepo con un solo CI, un barrel no adelanta nada: el rojo sale en la misma PR |
| «Lista negra de 9 módulos escrita a mano» | 8 entradas (`arch-rules.json`, regla `html-no-importa-core-con-node`). Nació con 7 el 2026-08-20 (`9bbd214`), creció **una vez** (`146cc7f`, 08-23, `narrative-state`, preventiva: nadie lo importaba). **No tiene test negativo propio** (solo el bucle genérico de `architecture.test.ts:1736`); en 16 días no ha cazado nada |
| «Un módulo nuevo con `node:fs` pasa el checker» | **Cierto, y más ancho de lo que dice el issue**: el cierre transitivo de los 40 módulos que importa el cliente son **81 ficheros** del core (calculado con `ts.preProcessFile`, mismo lector que `arch-collect.ts:61`), **0 con `node:*`** hoy, y **10 fuera del perímetro de `core-puro-sin-node`**: `config.ts`, `types.ts`, `vec3.ts`, `rng.ts`, `narrative/types.ts`, `plugins/types.ts` y **`games/{style-categories, ui-theme, style-refs, style-application-schema}.ts`**. Un `node:fs` en `games/ui-theme.ts` mañana pasa las DOS reglas: `games/` no está en el perímetro puro y `ui-theme` no está en la lista |
| «`vite.config.ts` fuera de la regla» | Está en `scan.files` (`arch-rules.json`) pero las reglas `html-*` solo miran `nefan-html/src/**`. Importa `config.js` y `contracts/sprite-census.js` por ruta relativa (`vite.config.ts:7,12`), los dos puros. Corre en Node, así que la pureza browser-safe **no le aplica**: no es un agujero, es otro régimen |
| #344 «síntoma puntual» | Cerrado. Era un cast inline en `ai-client.ts`, no un problema de puerta |

## Clasificación de las 41 rutas (pregunta B)

| Clase | Rutas (usos) | Lectura |
|---|---|---|
| **Contrato de frontera** (existe para cruzarla) | `types` 11 · `protocol/messages` 11 · `contracts/sprite-census` 5 · `contracts/remote-gen` 5 · `contracts/sprite-forge` 3 · `contracts/service-registry` 1 · `protocol/status-{motivo 3, escena-servida 3, rotulo 2, reparto 1}` · `narrative/types` 3 · `world-map/{types 3, edges 1}` · `config` 4 · `games/{style-categories 4, ui-theme 2, style-refs 1, style-application-schema 1}` · `scene/scene-normalize` 3 (tipo `WorldScene` + las 2 puertas nombradas) · `scene/tile-plan` 1 (tipo) · `session/entidades-del-tile` 3 · `combat/combat-system` 2 (tipo) · `combat_config.json` 1 | **24 de 41.** No son «internas»: son la superficie de facto y ya viven en carpetas que se llaman `contracts/`, `protocol/`, `types` |
| **Lógica pura de render/colisión/vista** | `scene/greybox/{surfaces 4, common 1}` · `scene/blueprint/{index 2, fps-spec 2, fps-relief 1}` · `scene/tile` 3 · `scene/terrain-collision` 3 · `scene/aim` 1 · `simulation/{mirada 2, paso-del-jugador 1}` · `session/{mundo-persistido 2, session-facets 1, entrada 1}` · `combat/attack-area` 2 (`attackFlashQuality`: el aro) | **14.** Es exactamente «lógica en core, el cliente solo pinta»: el cliente ejecuta el mismo código puro que el bridge en vez de copiarlo |
| **Roza la simulación, pero pinta** | `store/game-store` 1 (`GameStore` es por diseño el runtime volátil del cliente, CLAUDE.md) · `systems/registry` 1 (registro genérico para `inputRegistry`, `input/registry.ts:8`) · `combat/{combat-data 1, registry 1}` (`main.ts:172,656,957`: catálogo de ataques para la barra y parámetros para el aro; el comentario de `main.ts:668` deja escrito que el combate se resuelve en el sim) | **3.** Ninguno viola «el cliente solo pinta» hoy. No hay hallazgo aparte que valga más que #359 |

Corolario: una lista blanca reproduciría 41 líneas de lo que ya dice la carpeta. Un barrel `browser.ts` sería un
segundo `index.ts` de 40 exports que **nadie más importaría** y que obligaría a reescribir 79 líneas de import
en 28 ficheros, 17 de ellas en `main.ts` (2.371 líneas, congelado exacto en `client-file-size.json`, #358 en
curso). Es documentación falsa en potencia el día que nazca, por la misma regla de la casa que el issue invoca.

## El día después (pregunta E, que es el criterio)

Mañana alguien escribe `import { x } from "@nefan-core/src/games/nuevo.js"` y `nuevo.ts` importa `node:fs`.
- **Con barrel/lista blanca**: pasa si añade `nuevo` a la lista. La lista blanca persigue igual que la negra,
  solo que en positivo, y la actualiza la misma persona que acaba de meter el `node:fs`.
- **Con la pureza derivada del grafo**: falla solo. Las piezas existen: el colector ya extrae imports de
  `nefan-core/src` y `nefan-html/src` con `ts.preProcessFile` (`arch-collect.ts:60-63`); `mutation-plan.ts`
  ya resuelve especificadores relativos con `.js→.ts` e `index.ts` (`resolverEspecificador`, :545) y calcula
  cierres (`cierreDeImports`, :629). Lo que falta es pequeño y está en el alcance: resolver `@nefan-core/*` y
  un tipo de regla que mire el **cierre** y no el especificador. Nace verde (0 `node:*` en 81 ficheros) y se
  prueba en negativo con un fichero sintético con `node:fs` a dos saltos.

Con eso, la lista negra **se borra el mismo día** (es lo que canda `core-puro-sin-node` + el cierre, sin lista) y
`html-sin-node-ni-rutas-crudas` se queda como está (sigue siendo útil contra la ruta relativa).

## `index.ts` (pregunta C)

No tocarlo en esta tarea. Es la puerta de `@nefan/core` para narrative-mcp (dos ficheros, ~12 símbolos), y
reexporta `session-storage` (`node:fs`) a propósito: narrative-mcp corre en Node. Convertirlo en browser-safe
rompe `narrative-mcp` (`npm run build` = `tsc -b`, `ci.yml:93`); borrarlo también. Partirlo en `index`/`browser`
crea el barrel huérfano del párrafo anterior. Si algún día el cliente sale del monorepo, la puerta se hará
entonces, versionando `exports` en `package.json`, no hoy.

## Conflictos (pregunta D)

- **#358** (troceo de `main.ts`): un barrel toca las 17 líneas de import de `main.ts` y obliga a reajustar la
  cifra exacta de `client-file-size.json`. La derivación por grafo no toca ni una línea del cliente. **Solapa
  con el barrel, no con el reencuadre.**
- **#241** (harness del cliente): independiente. Un checker de grafo vive en `nefan-core/test`, no mide el
  cliente ni pretende hacerlo.
- **#306**: cerrado; sin relación.
- `core-puro-sin-node` y `mutation-targets.json`: el perímetro de la mutación se **define** por esa regla
  (`mutation-targets.json:2`, «EL REPARTO ES TOTAL… el que declara `core-puro-sin-node`»). Ampliar sus `files`
  para tapar el hueco de `games/` **arrastraría `games/` al perímetro de mutación** y pondría `npm test` en
  rojo por `games/loader.ts` (`node:fs`). Por eso la garantía nueva tiene que ser una regla APARTE que mire el
  cierre desde el cliente, no ensanchar la existente. Es la dependencia oculta de esta tarea.

## Coste contra valor

Barrel/lista blanca: ~2 h de churn en 28 ficheros, una lista de 40 líneas que nadie más lee, cero incidentes
evitados (0 en 30 días) y colisión con #358. No hacerlo: el hueco de `games/` sigue abierto, hoy vacío.
Derivar del grafo: una regla y su negativo, borrar 8 líneas de lista negra, nada en el cliente; cierra el hueco
de los 10 ficheros fuera del perímetro **y** el caso del módulo que aún no existe. Vale lo que cuesta.

## Qué NO debe hacerse

- No crear `browser.ts`, ni reescribir los 79 imports del cliente, ni tocar `index.ts` ni `exports`.
- No ampliar `files` de `core-puro-sin-node` a `games/` o `src/*.ts` (mueve el perímetro de mutación).
- No convertir la lista negra en lista blanca: es la misma persecución con el signo cambiado.
- No duplicar tipos en el cliente para «importar menos del core» (restricción de `requisitos.md`).

## Cambio para `requisitos.md` (pegar tal cual)

> **Aceptación reencuadrada.** La pureza browser-safe se **deriva del grafo**: un candado en
> `nefan-core/test/architecture.test.ts` calcula el cierre transitivo de imports de todo módulo de `nefan-core`
> que alcance `nefan-html/src` (alias `@nefan-core/*` + relativos, `.js→.ts`, `index.ts`) y falla si algún
> fichero del cierre importa `node:*`; medido al nacer: 40 entradas → 81 ficheros → 0 `node:*` (nace verde).
> Probado en negativo con un `node:fs` a dos saltos. Con él, `html-no-importa-core-con-node` **se borra** el
> mismo día (`grep` a cero). No se crea barrel ni lista blanca; `index.ts` y `package.json#exports` no se tocan
> (son la puerta node de narrative-mcp). `core-puro-sin-node` no cambia sus `files` (define el perímetro de
> mutación). Cero líneas cambiadas en `nefan-html/src`. Cerrar #359 desde la PR con este texto.
