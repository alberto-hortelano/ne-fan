**REENCUADRADA** — el problema es real y la dirección es buena, pero la premisa central («todo lo que llega a `formatDToWorld` pasó por `ExpandedSceneSchema`») es falsa en un camino entero: las fixtures crudas. La entrada son DOS poblaciones, no una; y el cliente no tiene ningún lector del `scene_data` crudo.

## El problema real, en una frase

`formatDToWorld` no sabe qué recibe porque nadie le da un tipo, y por eso valida a mano (y a veces tapa en silencio) lo que el contrato ya rechaza.

## La premisa, afirmación por afirmación (main f6401993)

- **`scene_data: Record<string, unknown>`** — cierto (`src/narrative/types.ts:100`).
- **«seis `throw` por entity (:273-289)»** — son **ocho**: null `:276`, id `:277`, kind `:279`, cell `:282`, footprint `:285`, finitos `:290`, name de npc `:303`, name de objeto `:332`. Además está el bloque `isFormatD` (`:239-252`, con `throw` en `:248`), que es igual de redundante para un `ExpandedScene`.
- **«lo que `EntitySchema` ya garantiza»** — casi todo. Lo he medido con `EntitySchema.safeParse` sobre una entity válida: `cell:[NaN,1]` → rechazada; `shape:"pyramid"` → rechazada; `h:0` → rechazada; `footprint:[Infinity,1]` → rechazada (`.int()`). **Pero `cell:[Infinity,1]` → ACEPTADA** (`cell: z.tuple([z.number(), z.number()])`, `scene-schema.ts:99`) y **`h:Infinity` → ACEPTADA** (`.positive()`). El `throw` de finitos (`:289-290`) no es redundante para `cell` por tipo: por JSON no llega un `Infinity`, pero el tipo no lo dice. En `h`, el `Math.min(h, MAX_ENTITY_HEIGHT_M)` de `:338` lo absorbe.
- **Tolerancias `h` (`:337-340`) y `shape` (`:363`, no `:365`)** — ciertas: el zod rechaza las dos y el código cae al valor por defecto. Lo legítimo que queda es `h` ausente → `KIND_DEFAULT_HEIGHT` y árbol sin `shape` → cilindro.
- **«el save (`narrative-state.ts:564`, `:789`) y el snapshot (`world-snapshot.ts:59`) pasan por el zod»** — cierto, pero **los dos TIRAN el resultado del parse**: `recordSceneLoaded` guarda `sceneData` crudo (`:804`), no `gate.data`, y la carga guarda `data.scenes_loaded` tal cual (`:721`). La costura sin tipo está ahí, no en `formatDToWorld`. El productor, `expandScenePrimitives`, devuelve `Record<string, unknown>` (`scene-expand.ts:197`).
- **Los caminos del bridge** — todos pasan por el gate. `alWire` (`bridge/wire-scene.ts:105`) sirve a `broadcastScene` (`bridge/context.ts:501`) y a `sessionDataForClient` (`wire-scene.ts:140`, el resume). Cada `broadcastScene` recibe una escena ya registrada: `tile.ts:215-216`, `:282`, `:307`, `:356`; `bootstrap-tile.ts:95`; `scene.ts:159/192`; `session.ts:637`. `sim-collision.ts:208` lee `rec.scene_data`. **El spawn de runtime no toca `scene_data`**: va a `this.entities` (`narrative-state.ts:868`) y no pasa por `formatDToWorld`.
- **«y las fixtures (candado de `test/scene-fixtures.test.ts`)»** — **FALSO como garantía de tiempo de ejecución.** Las fixtures de `data/scenes/` están en disco CRUDAS (Emitted). El test solo candea el fichero commiteado (`scene-fixtures.test.ts:158`: «cruda ⇒ EmittedSceneSchema; expandida ⇒ ExpandedSceneSchema»). En el camino vivo nadie parsea ni expande antes de llamar: la red `if (hasUnexpandedPrimitives(raw)) raw = expandScenePrimitives(raw)` (`scene-normalize.ts:238`) lo hace DENTRO. Hoy entran crudas por aquí:
  - el cliente: `fixtures-del-selector.ts:102` (glob de Vite, `Record<string, unknown>`, `:24`) y el gancho del banco `addTileRaw` (`:105`, seis usos en `qa/`);
  - cinco `.mjs` del job `candados-headless` de CI (`ci.yml:356,362,378,387,419`): `equivalencia-de-cajas`, `la-puerta-de-la-reaparicion`, `nadie-se-queda-encerrado`, `los-candados-miden-el-mundo-del-cliente` y `la-consulta-de-punto-no-tiene-origen`, que hacen `JSON.parse` de `data/scenes/*.json` → `formatDToWorld`. Son `.mjs`, **ningún `tsc` los ve**: si la red de `:238` desaparece, se rompen en CI en tiempo de ejecución, no al compilar;
  - `labs/narrative/check-scene.ts:118`, que ya expande él mismo.
- **«toca sus lectores en el cliente»** — **no hay ninguno.** El cliente recibe `SceneRecordEnElWire` (`protocol/messages.ts:282`), que sustituye `scene_data` por `EscenaServida`. Los dos `formatDToWorld` del cliente son las fixtures (arriba) y `ui/style-apply.ts:206`. Este último recibe el snapshot ya validado en el bridge (`bridge/handlers/style-apply.ts:32`), pero por el wire como `Record` y con un `as` a una interfaz local (`style-apply.ts:112`, `:151`).
- **CRAP 43, cx 43** — citado de `data/contract/quality-thresholds.json:6` (medido el 2026-09-30 en la tanda BR). No lo he re-medido.

## Mutación: lo que dice `reports/mutation/scene-normalize.json` (corrida 36684509746)

- El módulo son 300 mutantes (228 en `scene-normalize.ts` y 72 en `tile-plan.ts`), no 313. En `scene-normalize.ts`: 224 muertos y 4 vivos. La fuente no ha cambiado desde la corrida (último commit, #580).
- En la función (`:235-420`) hay 177 mutantes. **~115 están en las líneas de validación**: `isFormatD` 32 · throws `:276-291` 46 · names 15 · `h` 13 · `shape` 9. Todos mueren menos tres.
- **Los cuatro vivos del fichero están en lo que se borraría**: `:238` (la red de expansión forzada a `true`, que es idempotente), `:250` (el texto del error de `isFormatD`) y `:289` y `:337` (validación). Borrar no deja vivos: los mata con el código.
- **Límite del instrumento, y hay que decirlo en el plan**: `killedBy` es **por FICHERO de test** (el id del test es `test/scene-normalize.test.ts`), no por `it()`. El informe no puede decir qué mutantes de la CONVERSIÓN mueren solo gracias a los tests de los `throw` (`scene-normalize.test.ts:600-665`, que se irían con ellos). Ese es el riesgo real de «un borrado que deja vivo un mutante que hoy muere», y solo lo contesta `npm run mutacion -- comparar` tras la próxima corrida autorizada. El denominador baja (~100 mutantes) con la fuente cambiada, así que `repartir` no se niega (#596), pero el delta hay que LEERLO: no vale con que el número suba.

## El día después

- Para quien juega no cambia nada. Es deuda declarada (el issue lleva la etiqueta `deuda`, y la cabecera de `:230-233` lo pide).
- Se vuelve más difícil meter a mano en `formatDToWorld` una escena a medio hacer. Eso es lo que se busca, pero **cierra la puerta que usan hoy el banco y el selector «Room»**: o la red de `:238` sigue (y entonces la entrada no es `ExpandedScene`), o la expansión sube a cada llamante crudo (cliente + cinco `.mjs` + `addTileRaw`).
- Lo que nadie borrará si no se dice: los 64 `formatDToWorld(` de `test/scene-normalize.test.ts` con payloads a mano, que acabarán con `as unknown as` si no se decide qué población construyen; y la interfaz `SnapshotScene` de `style-apply.ts:112`.
- Lo que parecerá arbitrario dentro de un mes: un tipo `ExpandedScene` en la firma cuyos dos productores reales (`recordSceneLoaded`, la carga) guardan el objeto SIN parsear.

## Conflictos

- Cola abierta: #782 y #361-#363 (plugins). Sin solapamiento.
- Tanda BT (`greybox/volume-prims.ts`, `blueprint/footprint.ts`): ficheros y módulos de mutación distintos. Sin solapamiento.
- La crítica de BR (`docs/agents/2026-09-30-tanda-br-…/critica.md:17,30,51`) es el origen de este issue y copió los mismos números: «seis throw», `:365` y «las fixtures pasan por el zod». Hay que corregirlos aquí, no heredarlos.
- `arch-rules.json`: ninguna regla lo impide. El cliente ya importa `formatDToWorld` de core. **No** debe acabar convirtiendo celdas (candado `cliente-no-convierte-celdas-a-metros`) si la expansión sube al cliente: `expandScenePrimitives` es de core y se importa, no se porta.

## Coste contra valor

Coste medio: el cambio de tipos se queda en core y bridge (los parámetros aguas abajo, `composeTilePlan`, `tileCoordDe`, `computeTileEdges` y `registerSceneNpcs`, aceptan un alias de zod como `Record<string, unknown>` sin tocarlos); a eso se suma el camino de las fixtures y una corrida autorizada. Valor real: se borran ~115 mutantes de validación duplicada y tres vivos, el fail-loud deja de tener dos agujeros (`h` y `shape`) y el tipo deja de mentir en `SceneRecord`. Si no se hiciera nunca, hoy no pasaría nada: nada inválido entra por el bridge. El riesgo es el día que alguien añada una puerta sin gate, porque las tolerancias la taparían. Merece la pena, **pero** solo si el tipo se apoya en el resultado del parse y no en un `as`.

**Qué NO debería hacerse:** trocear la función (BR ya lo descartó); añadir un `safeParse` DENTRO de `formatDToWorld` (se pagaría en cada broadcast y en cada resume, y dejaría la costura sin tipo donde está); y borrar la red de `:238` sin arreglar antes a los cinco `.mjs` de CI.

## Qué le cambiaría a `requisitos.md` (para pegar tras «Qué se pide»)

> **Corrección de premisa (crítica BU).** La entrada de `formatDToWorld` es HOY dos poblaciones: la EXPANDIDA (bridge: `alWire`, `sim-collision`; cliente: snapshot en `style-apply`) y la CRUDA de las fixtures (`fixtures-del-selector.ts:102`, `addTileRaw`, cinco `.mjs` de `candados-headless` y `labs/narrative/check-scene.ts`). La cruda sobrevive gracias a la expansión interna de `scene-normalize.ts:238`. El candado de `scene-fixtures.test.ts` valida el fichero, no el camino. El plan decide si la expansión sube a los llamantes crudos o si la firma es honesta sobre las dos, pero no puede declarar `ExpandedScene` y seguir aceptando crudas por dentro.
>
> **Alcance.** (1) Que el tipo lo den los que PARSEAN: `recordSceneLoaded` (`narrative-state.ts:804`) y la carga del save (`:721`) guardan hoy el objeto crudo y tiran `gate.data`/`parsed.data`. `expandScenePrimitives` devuelve `Record`. (2) Se borran los OCHO `throw` por entity (`:276-332`) y el bloque `isFormatD` (`:239-252`) donde el tipo lo garantice, y las tolerancias de `h` (`:337`) y `shape` (`:363`) dejan de tolerar. (3) **`cell` no está garantizado finito por el zod** (`cell:[Infinity,1]` pasa, medido): o `EntitySchema` gana `.finite()` en `cell` (cambio de contrato, con su espejo Python), o ese `throw` se queda con su motivo. (4) El cliente NO tiene lectores del `scene_data` crudo (`SceneRecordEnElWire`, `messages.ts:282`): no hay nada que tipar ahí más allá de las dos llamadas a `formatDToWorld`.
>
> **Verificación.** `npm run verify`; `tsc` de `nefan-html`; los cinco guiones de `candados-headless` en local (`node qa/<guion>.mjs`), porque son `.mjs` y ningún typecheck los ve; el selector «Room» carga las tres fixtures (preset `html-fixtures`). La mutación la mide la próxima corrida autorizada, con `comparar` ANTES de `repartir`. El informe mata por fichero de test y no por `it()`, así que la pregunta «¿algún mutante de la conversión solo moría por los tests de los `throw`?» la contesta ese delta y nada más. Se espera que el denominador de `scene-normalize.ts` baje en torno a 100 y que desaparezcan los vivos `:238`, `:250`, `:289` y `:337`. Cualquier NUEVO vivo en la conversión se mata o se explica en la PR. CRAP de `formatDToWorld` re-medido con `npm run coverage && npm run crap`, no copiado.
