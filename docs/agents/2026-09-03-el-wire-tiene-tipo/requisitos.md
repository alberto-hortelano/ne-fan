# Requisitos — T7 «El wire tiene tipo» (#378 + #397 + #399 + #400)

**Fecha**: 2026-09-03 · **Coordinador**: sesión principal · **Base**: `main` = `4ca0c50` (T6 cerrada en
PR #402; huella de la corrida completa 33672454166 en PR #403). **Rama**: `fix/el-wire-tiene-tipo`,
worktree `.claude/worktrees/t7-el-wire-tiene-tipo`.

## Petición del usuario (literal)

> «Adelante con T7»

> **Crítica (`critica.md`, 2026-09-03, medida sobre `4ca0c50`)**: #378 **VIGENTE** (mayor de lo escrito) ·
> #399 **VIGENTE** · #397 **REENCUADRADA** (el save ya conserva las dos; faltan cinco sitios, espejo Python
> incluido) · #400 **REENCUADRADA** (restos 2 y 3 vigentes; el resto 1 es PREMATURO y sale a issue propio).
> **Visto bueno del usuario (literal, 2026-09-03): «adelante».** Las correcciones están incorporadas abajo
> como bloques «Crítica:»; donde chocan con el texto original, manda la crítica.
>
> **Corte aprobado**: **PR-A** = #399 + #400 (restos 2 y 3): encoger el contrato de ENTRADA en los cinco
> procesos (zod, tool, prompts, Python, fixtures, tests, candado). **PR-B** apilada sobre A = #378 sobre la
> forma ya encogida. **PR-C** = #397, independiente (no toca `WorldScene`). El orden «#378 primero» queda
> retirado: los otros tres tocan la entrada y `formatDToWorld` no emite `glyph` ni `attach`.

T7 es la segunda tanda de la selección del núcleo aprobada el 2026-09-02
(`~/.claude/plans/federated-spinning-flamingo.md`): **«El wire tiene tipo» — #378 + #397 + #399 + #400.
Cierra 4.** Motivo del agrupamiento: los cuatro tocan la **misma forma** (la escena que produce el motor y
la world scene que consume el cliente) y los mismos ficheros (`src/scene/scene-normalize.ts`,
`src/contract/model-io/scene-schema.ts` y `schemas.ts`, `data/contract/tools/*.json`, los prompts, el espejo
Python). Orden previsto por el plan: **#378 primero**, para que lo que toquen los otros tres nazca ya
tipado; el crítico y el arquitecto pueden discutirlo.

**Decisión del usuario que manda sobre esta tanda (2026-09-02, literal)**: «La parte central hay que
dejarla bien pero los plugins los podemos dejar para más adelante, el combate, el movimiento, el
comercio... todo eso deben ser plugins y tienen baja prioridad en cuanto a calidad del código». Nada
de esta tanda debe entrar en `src/combat/`, `src/simulation/npc-behavior.ts` ni en la infraestructura de
plugins (#360-#364, `futuro`).

Vigente de la serie: subir el número de issues abriendo un defecto derivado **medido** es preferible a
bajarlo callándolo. Los cuerpos de los issues tienen citas de línea de otro `main`: **se comenta en cada
uno lo que se midió**, no se cita el cuerpo. Y un tipo que se cumple «en verde» sin candar nada
(`[k: string]: unknown` dentro, un `as` al abrirlo) no cierra #378: la garantía va en el tipo
(`feedback_garantia_en_el_tipo`).

## Los cuatro issues y su premisa (según el issue; el crítico la verifica contra `4ca0c50`)

### #378 — `WorldScene = Record<string, unknown>`: el contrato de render que más viaja no tiene tipo

| Afirma el issue (2026-09-01) | Medido hoy por el coordinador |
|---|---|
| `WorldScene` es `Record<string, unknown>` (`scene-normalize.ts:23`); lo produce `formatDToWorld`, lo sirve `bridge/wire-scene.ts`, lo pinta el cliente y lo cargan las fixtures | `scene-normalize.ts:24` (`export type WorldScene = Record<string, unknown>`), `:95` (`formatDToWorld(raw: Record<string, unknown>): WorldScene`). El nombre `WorldScene` aparece en 4 ficheros: `scene-normalize.ts`, `bridge/wire-scene.ts`, `nefan-html/src/world/tile-store.ts` (comentario), `nefan-html/src/ui/style-apply.ts` |
| Cada consumidor la abre con `as`; `addTile` (`main.ts`) media docena de casts | Hoy el consumidor grande ya no es `addTile` (T4/#358 lo repartió): `nefan-html/src/world/carga-de-tile.ts:312` (`data as Record<string, unknown>`), `main.ts:324` (`entry.scene as { scene_description?: string }`), `main.ts:2022-2031` (`effect.data…scene`, `__format_d`, `tile`). Los del bridge y `mundo-persistido`/`entidades-del-tile` los censa el crítico |
| Campos opcionales según origen: `__plan`, `__player_start`, `terrain_grid`, `world_rect`, `exits`, `tile` → un tipo honesto es una unión, no una interfaz plana | **`exits` ya NO es campo de la world scene** desde T6 (#179, candado `las-salidas-no-se-sellan-en-la-escena`): las calcula `alWire` al servir. El crítico lista qué campos siguen siendo opcionales y por qué |
| `position_declared` entra por la constante `POSICION_DECLARADA` (`mundo-persistido.ts`): lo mejor posible sin tipo, insuficiente | Sigue así. Con tipo, el campo es un miembro declarado |
| Comentario de #238: `objects[]` lleva `name` + `description?` como `npcs[]`, sin tipo; el único lector tipado es `ObjetoDeclarado` (`entidades-del-tile.ts`) | Cierto; forman parte de la forma a declarar |
| Relación con #358: el troceo de `main.ts` se apoya en este tipo | `main.ts` = 2321 líneas, congelado por `client-file-size.json`. **No suma líneas** en esta tanda |

**Lo que hay que decidir** (crítico/arquitecto): dónde vive el tipo (el issue dice `scene-normalize.ts`; el
cliente lo importa del core sin `node:*`), si es unión o interfaz con opcionales **justificados uno a uno**,
y qué pasa con los campos `__` (`__plan`, `__player_start`, `__format_d`): ¿son parte del contrato de
render o marcas internas que no deberían viajar?

### #397 — `spawn_entity` dice lo contrario que `generate_scene`

| Afirma el issue (2026-09-02, sobre `937c16d`) | Medido hoy |
|---|---|
| `schemas.ts:36-41`: `description` obligatoria, `name` opcional «Nombre propio (NPCs)»; en `generate_scene` `name` es la etiqueta obligatoria y `description` la procedencia opcional | `schemas.ts` (`SpawnEntityConsequence`): `description: z.string().min(1)`, `name: z.string().optional()`. Cierto |
| `main.ts:1900`: rótulo `effect.name ?? effect.description ?? effect.entityId` | `main.ts:1900`, literal. Cierto |
| Mismo modelo, dos semánticas de `description` según la puerta | — |

**Criterio de cierre (del issue, vigente)**: los dos zod **comparten el vocabulario** (no dos copias),
`name` obligatorio y es lo que se rotula, `description` opcional y es la procedencia, y sobrevive a
`materializeSpawn` y al save (`state.entities`) sin pisar la etiqueta. El prompt de consecuencias lo
dice igual que el tool de escena. Test de contrato que lo compare.

### #399 — `decor.attach:"wall"` busca un char `W` que nadie escribe

| Afirma el issue (2026-09-02, sobre `05ed97a`) | Medido hoy |
|---|---|
| Contrato ofrece `attach:"wall"` (`scene-schema.ts:81`, `generate_scene.json:150`, `scene_instructions.md:65`); `scene-expand.ts` busca `WALL_CHAR = "W"` en radio 3; ningún productor escribe `W` desde #333 | `scene-expand.ts:7,32-36,45,127` siguen ahí. Que ningún productor escriba `W` lo re-mide el crítico (`grep` de `"W"` en `src/scene/**` productores) |

**Decisión que pide el issue**: retirar (tool, prompt, zod, expander, tests, y `attach`/`WALL_CHAR` al
candado `campos-retirados-no-vuelven`) **o** darle sujeto (pegar el decor a la cara del `volume` más
cercano). **Postura del coordinador para el crítico**: retirar, por la regla de la casa (un formato/capacidad
sin sujeto se borra el mismo día) y porque «darle sujeto» es una funcionalidad nueva sin petición del
usuario; si el crítico ve que el motor la usa de verdad en snapshots/saves/labs, que lo diga con cifras.

### #400 — Tres restos del formato ASCII sin sujeto

| Resto | Afirma el issue | Medido hoy |
|---|---|---|
| 1. Rama «escena legacy centrada en el origen» | `scene-normalize.ts:118`, `terrain-collision.ts:107,160`, `bridge/sim-collision.ts:73`, `tile-plan.ts:83,98`; `EmittedSceneSchema` rechaza escenas sin `tile` desde #172 | Los cinco sitios siguen (`scene-normalize.ts:117-118`, `terrain-collision.ts:107,160`, `sim-collision.ts:73`, `tile-plan.ts:83,98`). Cobertura de esas ramas: la mide el ingeniero |
| 2. `.passthrough()` de escena | `scene-schema.ts:20-30,245`; lo sostienen `ambient_event` (fixtures) y `place_anchors` (snapshots + saneador Python) | `scene-schema.ts:245` y **también `:341`** (segundo `.passthrough()` que el issue no cita: el crítico dice qué schema es). `ai_server/narrative_schemas.py:540,580-591` lee `ambient_event` y `place_anchors` |
| 3. `glyph` de entity | cero lectores fuera de `src/contract` y del tipo; el motor lo escribe porque el tool lo pide | `glyph` aparece en: `scene-normalize.ts`, `scene-schema.ts`, `narrative_schemas.py`, `test_scene_validate.py`, `tile_instructions.md`, `scene_instructions.md` y **16 fixtures** de `data/contract/fixtures/scene/`. Cero en `nefan-html/src` y `bridge` |

**Criterio de cierre (del issue, vigente)**: `grep` a cero fuera de `archivo/` para cada resto, candado
donde aplique, y ningún comentario que describa la escena sin `tile` o el grid como formato del motor.
Con #378 hecho, el resto 2 (`.strict()`) y el 3 (`glyph` fuera) son cambios de la MISMA forma: se
declaran juntos.

## Alcance

**Dentro**
1. **#378**: *Crítica, añade:* el tipo declara `exits` como overlay del wire o como miembro, pero lo decide el
   tipo (`wire-scene.ts:105`, `carga-de-tile.ts:143,164`); `SessionData.scenes_loaded` en el wire deja de
   tiparse como Format D (`types.ts:87`, `wire-scene.ts:143`); `__format_d` deja de viajar entero: su único
   lector es `place_id` (`main.ts:2029`) y pesa el 44 % del tile; `__plan`/`__plan_warnings`/`__player_start`
   SÍ son contrato de render (lectores en `carga-de-tile`, `style-apply`, `sim-collision`) y se tipan;
   `WorldSceneDelBatch` (`style-apply.ts:40-45`) desaparece. Casts a sustituir: 14 cliente + 1 bridge
   (`sim-collision.ts:77`); 6 firmas del core sobre `Record`/`unknown`. Original:  `WorldScene` tiene un tipo que canda sus miembros: escribirlo mal no compila, y ningún
   consumidor del core, del bridge ni del cliente lo abre con `as` para leer un campo que el tipo ya
   declara. `formatDToWorld` lo devuelve tipado; `alWire` (`wire-scene.ts`) lo sirve tipado; el cliente lo
   recibe tipado por `bridge-client.ts`. `POSICION_DECLARADA` deja de ser una cadena compartida y pasa a
   ser un miembro del tipo (o desaparece si el arquitecto encuentra algo mejor). `name`/`description` de
   `objects[]` y `npcs[]` declarados.
2. **#397**: *Crítica, sustituye el criterio:* `name` obligatorio y rotulado, `description` opcional, en
   los CINCO sitios: `schemas.ts`, `narrative/types.ts:131-143,356-364`, `consequence-handler.ts:95-135`
   (sin el default mudo `c.description ?? "an entity"`), `mundo-persistido.ts:436-443`,
   `ai_server/narrative_schemas.py:1048-1056`. El save YA conserva las dos (`recordEntitySpawned` guarda la
   consecuencia entera; `spawnsDeRuntime` rehidrata): el guion solo lo demuestra. El envoltorio `scene_init`
   (`bridge/context.ts:334-340`, un `spawn_entity` sin `name`) se adapta o se saca de `spawn_entity`.
   `narrative_event.md` y `narrative_react.json` se renderizan del zod. Original: un solo vocabulario de entity para `generate_scene` y `spawn_entity`; el rótulo de lo
   spawneado es `name`; `description` es procedencia y sobrevive al save. Prompt de consecuencias y
   `spawn_entity.json` dicen lo mismo que `generate_scene.json`.
3. **#399**: *Crítica, añade:* reapuntar `qa/contrato-candados-en-negativo.mjs:65-69` (borra `attach` del
   zod y espera rojo); decidir `W` en `DEFAULT_SOLID_CHARS` (0 productores) en la misma PR o abrir
   derivado; `tile_instructions.md:321` y `CLAUDE.md:183` entran en el barrido; `hasUnexpandedPrimitives`
   se reduce a `tile !== undefined`. Original: `attach:"wall"` desaparece del contrato, del prompt, del zod, del expander y de los tests, o
   hace algo observable. Término en `campos-retirados-no-vuelven`.
4. **#400**: *Crítica, sustituye:* SOLO restos 2 y 3. `.strict()` en `EmittedSceneSchema` (`:245`) Y
   `ExpandedSceneSchema` (`:341`, gate del loader) declarando `ambient_event` (el saneador Python lo escribe
   SIEMPRE), `place_anchors` y, solo en el loader, `place_id` (lo estampa el bridge). `glyph` fuera de 17
   JSON, 25 tests (98 ocurrencias), Python (`narrative_schemas.py:769-779` + 3 tests), tool, 2 prompts,
   `labs/narrative/fake-scenes.ts` y `check-scene.ts`, `qa/presupuesto-de-volumenes.mjs`, guiones 40 y 46,
   y `CLAUDE.md:183`. **El resto 1 (rama «centrada en el origen») sale de T7** a issue propio: tiene tres
   sujetos vivos (camino principal de los tests, `tile` opcional en el loader, camino no-grid del cliente).
   Original: los tres restos fuera con `grep` a cero; escena a `.strict()` con `ambient_event` y
   `place_anchors` declarados (y el saneador Python alineado); `glyph` fuera del tool, del zod, del
   Python y de las 16 fixtures.
5. Cada issue cerrado con **su comentario de medida** (qué se midió sobre `4ca0c50` y qué cambió).
6. *Crítica:* `npm run mutacion -- local` NO aplica a ningún módulo de la tanda (scene-normalize 229,
   mundo-persistido 308, entidades-del-tile 139, scene-schema 170 > tope 120): todo se pide y se sigue.
   `scene-expand.ts`, `schemas.ts`, `terrain-collision.ts` están en `sin_mutar`. Cada PR fuerza la corrida
   completa (#404): se dice en el comentario de medida. Original: `npm run verify` verde; deuda (`npm run deuda`) no crece; **`formatDToWorld` CRAP 48 no sube** (mejor
   si baja: quitar la rama legacy y `glyph` debería bajarla); `main.ts` no suma líneas; mutación local de
   los módulos que quepan en `tope_local` (120); `scene-normalize` (229 mutantes hoy) **se pide y se
   sigue**; `contrato-escena` (225) igual.
7. Sin créditos: toda verificación con `e2e-sin-creditos` / `html-fixtures` / `cliente-web` en Maqueta 3D.

**Fuera**
- Trocear `main.ts` (#358, programa aparte). Aquí solo se sustituyen casts por el tipo, sin sumar líneas.
- La trazabilidad general de procedencia (#293).
- Dar sujeto nuevo a `attach` como funcionalidad (si el crítico no lo reencuadra).
- Cualquier cambio en `src/combat/`, `npc-behavior.ts` o plugins.
- Compatibilidad con saves/snapshots anteriores: cero (pre-producción). Si un snapshot de
  `data/games/*/` o una fixture trae `glyph`, se regenera o se edita, no se tolera.

## Criterios de aceptación (verificables)

- **A1 (#378)** `grep -rn "as Record<string, unknown>" nefan-html/src/world nefan-html/src/main.ts
  nefan-html/src/ui/style-apply.ts nefan-core/bridge/wire-scene.ts nefan-core/bridge/sim-collision.ts`
  → 0 sobre la escena; `WorldSceneDelBatch` desaparece; `WorldScene` no contiene `[k: string]: unknown` ni `Record<string, unknown>`;
  un test de tipos (o `tsc` sobre un fichero de aserciones) demuestra que `position_declred` NO compila.
- **A2 (#378)** El cliente pinta una fixture del selector «Room» y el guion de resume (60 o 65) sigue
  verde: el tipo no cambia el wire, solo lo canda.
- **A3 (#397)** Guion QA sin créditos: un `spawn_entity` con `name` y `description` distintos → el rótulo
  del cliente es `name`, y tras guardar y reanudar `state.entities[id]` conserva las dos. Test de
  contrato: los dos zod comparten el objeto de vocabulario.
- **A4 (#399)** `grep -rn "attach\|WALL_CHAR" nefan-core/src nefan-core/data/contract ai_server
  narrative-mcp` → 0 fuera de `archivo/` y del candado; fixture inválida con `attach` rechazada.
- **A5 (#400)** `grep -rn "glyph" nefan-core nefan-html/src ai_server narrative-mcp` → 0 fuera de
  `archivo/` y del candado; `EmittedSceneSchema` y `ExpandedSceneSchema` son `.strict()` y rechazan
  `ambient_evnt`; una escena de ai_server (con `ambient_event` saneado) sigue pasando.
- **A6** `npm run verify` verde, `npm run deuda` no crece, `npm test` de nefan-html verde, batería
  `qa/run.mjs` entera verde (con los guiones nuevos), CI verde en la PR.

## Preguntas abiertas para el crítico

1. ¿`WorldScene` en `scene-normalize.ts` o en un módulo de contrato (`src/contract/...` o
   `src/protocol/`) que el cliente pueda importar sin arrastrar `node:*`? ¿Ya existe una puerta
   browser-safe (#359 la pide) o hay que abrirla mínima?
2. ¿Los campos `__plan`, `__player_start`, `__format_d` son contrato de render o marcas internas? Si
   viajan, se tipan; si no deberían viajar, ¿es esta tanda quien los saca o es otro issue?
3. ¿Es realista hacer #378 primero y los otros tres encima sin que la tanda se salga de un contexto de
   ingeniero? Si no, el arquitecto propone el corte (dos PR apiladas es aceptable).
4. #399: ¿algún snapshot/save/lab del árbol usa `attach`? Cifra.
