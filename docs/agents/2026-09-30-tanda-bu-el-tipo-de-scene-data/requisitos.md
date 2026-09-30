# Tanda BU — #782: `SceneRecord.scene_data` sin tipo

## Petición del usuario (literal)

«Mutacion lanzada. Adelante con las dos» (2026-09-30). Responde a la propuesta del coordinador: «#782: tiparlo ahora que la base de `scene-normalize` está medida».

## El issue (#782, abierto por el coordinador el 2026-09-30 a partir de la crítica de la tanda BR)

## Problema

`SceneRecord.scene_data` es `Record<string, unknown>` (`nefan-core/src/narrative/types.ts:100`). Por eso `formatDToWorld` (`src/scene/scene-normalize.ts:235`) vuelve a validar a mano lo que `EntitySchema` (`src/contract/model-io/scene-schema.ts:91-140`) ya garantiza:

- seis `throw` por entity (`scene-normalize.ts:273-289`): `id`, `kind`, `cell`, `footprint` y `name`;
- dos tolerancias que el zod RECHAZA: `h` inválido cae al valor por defecto (`:337-340`) y `shape` inválida cae al valor por defecto (`:365`).

Todo lo que llega a `formatDToWorld` ha pasado antes por `ExpandedSceneSchema`: el save (`narrative-state.ts:564`, `:789`), el snapshot (`world-snapshot.ts:59`) y las fixtures (candado de `test/scene-fixtures.test.ts`). La propia cabecera de la función lo admite: «tiparla es otro issue» (`scene-normalize.ts:230`). Este es ese issue.

## Por qué importa

- `formatDToWorld` es la función más compleja del core: CRAP 43 y complejidad 43 (medido el 2026-09-30). Esa complejidad es validación duplicada, no lógica de conversión.
- Las dos tolerancias contradicen el fail-loud: si alguna vez entrara una escena que no pasó por el zod, el defecto la taparía en silencio.
- Trocear la función bajaría el número y dejaría la causa intacta (crítica de la tanda BR, `docs/agents/2026-09-30-tanda-br-las-dos-funciones-mas-complejas/critica.md`).

## Qué haría falta

Tipar la entrada como `ExpandedScene`. Eso toca `SceneRecord` y sus lectores en el bridge y el cliente. Los `throw` y las tolerancias se borran solo donde el tipo ya lo garantice.

## Cuándo

El módulo `scene-normalize` son 313 mutantes, por encima del `tope_local` de 120, así que no se mide en local. La corrida 36684509746 (2026-09-30) le da la base. Cualquier cambio necesita otra corrida autorizada para verificarse.


## Qué se pide

Que la entrada de `formatDToWorld` tenga el tipo que el zod ya garantiza (`ExpandedScene` o el que corresponda), y que desaparezca la validación a mano que ese tipo hace redundante. Las dos tolerancias que contradicen al zod (`h` y `shape` inválidos caen al valor por defecto) desaparecen o pasan a fail-loud. La norma es pre-producción, cero compatibilidad: no se conserva nada por los saves viejos.

El crítico verifica la premisa contra el código de hoy:
- ¿es verdad que TODO lo que llega a `formatDToWorld` pasó por `ExpandedSceneSchema`? Incluye el cliente HTML con las fixtures, el resume del bridge, `sessionDataForClient` y el spawn de runtime;
- ¿dónde se rompería el tipo?

Y decide el alcance. El módulo `scene-normalize` (313 mutantes, suelo 98) no cabe en local, así que la mutación la medirá la próxima corrida autorizada. Un borrado de `throw` NO puede dejar vivo un mutante que hoy muere sin que se diga.

## Restricciones

- Hay una corrida de mutación en marcha (36698868790) sobre `main` f6401993. No se toca el tag `mutacion-ultima` ni `reports/mutation/` del árbol principal. La base medida de `scene-normalize` está en `/home/al/code/ne-fan/nefan-core/reports/mutation/scene-normalize.json` (corrida 36684509746), solo lectura.
- Todos los agentes en Opus. Guiones reservados: 340–349.
- NUNCA `git stash`. Para medir la base, `git worktree add` temporal en el scratchpad.
- En paralelo va la tanda BT (tests de `greybox/volume-prims.ts` y `blueprint/footprint.ts`). No debería solaparse; si lo hace, se avisa.
- La PR cierra #782.

## Reencuadre del crítico (aceptado por el coordinador el 2026-09-30)

**Corrección de premisa (crítica BU).** La entrada de `formatDToWorld` es HOY dos poblaciones: la EXPANDIDA (bridge: `alWire`, `sim-collision`; cliente: snapshot en `style-apply`) y la CRUDA de las fixtures (`fixtures-del-selector.ts:102`, `addTileRaw`, cinco `.mjs` de `candados-headless` y `labs/narrative/check-scene.ts`). La cruda sobrevive gracias a la expansión interna de `scene-normalize.ts:238`. El candado de `scene-fixtures.test.ts` valida el fichero, no el camino. El plan decide si la expansión sube a los llamantes crudos o si la firma es honesta sobre las dos, pero no puede declarar `ExpandedScene` y seguir aceptando crudas por dentro.

**Alcance.** (1) Que el tipo lo den los que PARSEAN: `recordSceneLoaded` (`narrative-state.ts:804`) y la carga del save (`:721`) guardan hoy el objeto crudo y tiran `gate.data`/`parsed.data`. `expandScenePrimitives` devuelve `Record`. (2) Se borran los OCHO `throw` por entity (`:276-332`) y el bloque `isFormatD` (`:239-252`) donde el tipo lo garantice, y las tolerancias de `h` (`:337`) y `shape` (`:363`) dejan de tolerar. (3) **`cell` no está garantizado finito por el zod** (`cell:[Infinity,1]` pasa, medido): o `EntitySchema` gana `.finite()` en `cell` (cambio de contrato, con su espejo Python), o ese `throw` se queda con su motivo. (4) El cliente NO tiene lectores del `scene_data` crudo (`SceneRecordEnElWire`, `messages.ts:282`): no hay nada que tipar ahí más allá de las dos llamadas a `formatDToWorld`.

**Verificación.** `npm run verify`; `tsc` de `nefan-html`; los cinco guiones de `candados-headless` en local (`node qa/<guion>.mjs`), porque son `.mjs` y ningún typecheck los ve; el selector «Room» carga las tres fixtures (preset `html-fixtures`). La mutación la mide la próxima corrida autorizada, con `comparar` ANTES de `repartir`. El informe mata por fichero de test y no por `it()`, así que la pregunta «¿algún mutante de la conversión solo moría por los tests de los `throw`?» la contesta ese delta y nada más. Se espera que el denominador de `scene-normalize.ts` baje en torno a 100 y que desaparezcan los vivos `:238`, `:250`, `:289` y `:337`. Cualquier NUEVO vivo en la conversión se mata o se explica en la PR. CRAP de `formatDToWorld` re-medido con `npm run coverage && npm run crap`, no copiado.

**Decisión del coordinador sobre (3):** `EntitySchema` gana `.finite()` en `cell`, con su espejo Python y lo que genere el contrato (prompts y tools), y el `throw` de finitos se borra. El motivo es que JSON no tiene `Infinity`, pero `1e400` se parsea como `Infinity`: se rechaza en la puerta, fail-loud al modelo con su motivo, y no dentro de la conversión.
