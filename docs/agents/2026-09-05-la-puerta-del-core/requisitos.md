# T12 «La puerta del core» — #359

## La petición, literal

Mandato del 2026-09-02: «Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero
los plugins los podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser
plugins y tienen baja prioridad en cuanto a calidad del codigo. Haz una seleccion de los issues centrales y
marca los demas para mirar a futuro».

Orden aprobado el 2026-09-05 («Me parece un buen orden, empieza con T11»): T13 → #439 → **T12** → programas.
Hoy, tras cerrar #439 y #471: «adelante».

## El issue, tal como está escrito (#359, revisión de arquitectura del 2026-09-01)

El alias `@nefan-core` está candado (`html-sin-node-ni-rutas-crudas`) pero apunta al árbol ENTERO: el
cliente importa módulos internos del core; `nefan-core/src/index.ts` existe y ningún fichero del cliente lo
usa. Consecuencia doble: (1) refactorizar un módulo interno del core rompe el cliente y nada avisa antes de
`tsc`; (2) la frontera browser-safe la sostiene una **lista negra de 8 módulos escrita a mano**
(`html-no-importa-core-con-node`): un módulo nuevo del core con `node:fs` que el cliente importe pasa el
checker hasta que alguien lo añada.

**Aceptación del issue**: superficie pública explícita (barrel o lista blanca de módulos exportados al
cliente) con candado que la sujete, y que la pureza browser-safe se **derive** de esa superficie en vez de
una lista negra que persigue.

## Medido hoy (2026-09-05, `main` = `0cd7e31`), no recordado

- El cliente importa **41 rutas distintas** de `@nefan-core/` (40 `.ts` + `data/combat_config.json`) desde
  **28 ficheros** de `nefan-html/src/`. El issue decía 36. Las más usadas: `src/types.js` (11),
  `src/protocol/messages.js` (11), `contracts/sprite-census.js` (5), `contracts/remote-gen.js` (5).
- `nefan-core/src/index.ts` tiene 80 líneas y **re-exporta `session-storage`** (`node:fs`, `node:path`) y
  `narrative-state`, `ai-client`: **no sirve como puerta browser-safe tal cual**. Nadie lo importa desde el
  cliente; hay que ver quién lo importa (bridge, narrative-mcp, tests) antes de tocarlo.
- La lista negra tiene 8 entradas (`games/loader`, `games/style-application`, `games/vocabulary`,
  `games/world-snapshot`, `narrative/narrative-state`, `narrative/session-storage`, `plugins/loader`,
  `contracts/common`). El propio `why` de la regla admite que persigue.
- Ya existe una regla del checker «módulos puros sin `node:*`» (CLAUDE.md: fronteras). Hay que ver si la
  pureza browser-safe puede derivarse del **grafo de imports** (cierre transitivo sin `node:*`) en vez de una
  lista, y si el checker ya tiene esa capacidad (`arch-rules.json` compara imports por regex; el selector de
  mutación `afectado.ts` ya traza cierres de imports con `ts.preProcessFile`).
- `vite.config.ts` también importa del core por ruta relativa (`../nefan-core/src/config.js`,
  `contracts/sprite-census.js`): está fuera de `nefan-html/src/**` y de la regla.
- #344 (síntoma puntual que citaba el issue) está **cerrado**.

## Restricciones que no se negocian

- **No se matan servidores ajenos**: arrancar con `./start.sh --preset <slug>` y `NEFAN_PORT_OFFSET` propio;
  parar con `./start.sh --parar`. Prohibido `pkill`, prohibido matar por puerto.
- **Cero créditos.** La verificación del cliente con `html-fixtures` o `e2e-sin-creditos`.
- **Candado, no prosa**, visto rojo antes de darlo por bueno. Si la garantía puede ir en el tipo o en el
  grafo, va ahí, no en una lista.
- **Pre-producción**: lo que se sustituya (la lista negra, `index.ts` si muere) se borra el mismo día,
  `grep` a cero de sus rastros.
- **Lógica en core, el cliente solo pinta**: la puerta no puede convertirse en excusa para duplicar tipos ni
  para que el cliente deje de importar del core.
- Mutación: `local <id>` dentro de `tope_local`; ninguna corrida completa la lanza un agente; ningún umbral
  se toca. Los issues se cierran con el código hecho y verificado.
- Tope de tamaño de ficheros del cliente (`client-file-size.json`): `main.ts` 2371 líneas no puede subir.

## Preguntas para el crítico

1. ¿La lista blanca/barrel es la solución del dominio, o la garantía buena es **derivar** la pureza del
   grafo (cierre de imports de cada módulo que el cliente alcance, sin `node:*`) y entonces la «puerta» sobra
   o se reduce a un candado? ¿Qué compra un barrel además de eso, medido (¿cuántos refactors del core
   rompieron el cliente en los últimos 30 días? `git log` lo dice)?
2. ¿41 rutas son «internas» o son ya la superficie de facto? ¿Cuántas son contratos (`contracts/`,
   `protocol/`) que existen precisamente para cruzar la frontera?
3. ¿Qué hacer con `index.ts`: puerta browser-safe, borrarlo, o partirlo? ¿Quién lo importa hoy?
4. Conflictos: programas #358 (troceo de `main.ts`), #241 (harness del cliente), #241/#306 candados del
   cliente; `vite.config.ts` fuera de la regla.
