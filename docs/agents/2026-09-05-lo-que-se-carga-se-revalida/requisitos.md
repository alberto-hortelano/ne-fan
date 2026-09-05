# Requisitos — T11 «Lo que se carga se revalida»

Fecha: 2026-09-05 · `main` = `27a46fa` · árbol limpio · backlog 49 (37 núcleo + 12 `futuro`).

## Petición literal del usuario

> Adelente con T11

(2026-09-05, tras cerrar T10 y #439/#404.) T11 es la séptima tanda de la hoja de ruta que el usuario
fijó el 2026-09-02, cuya petición literal fue:

> Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los plugins los
> podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser plugins
> y tienen baja prioridad en cuanto a calidad del codigo. Haz una seleccion de los issues centrales y
> marca los demas para mirar a futuro.

Y la definición de la tanda en la hoja de ruta (`/home/al/.claude/plans/federated-spinning-flamingo.md`):

> **T11** «Lo que se carga se revalida» · #302 + #235 + #357 + #404 · Los tres reducidos por
> auditorías anteriores a su mitad viva: staleness de snapshots, tramo ai_server de punta a punta
> (leer el guion 40 antes), y quién mide `qa/`. #231 (tsconfig de `scripts/` y `test/`) entra aquí si
> el arquitecto lo admite: es el mismo tema.

**#404 ya está cerrado** (PR #445, 2026-09-05): el selector de mutación dejó de estar anulado. Sale de
la tanda. Quedan **tres issues fijos** (#302, #235, #357) y **uno candidato** (#231b).

## Decisiones ya tomadas que esta tanda hereda

- **Los issues se cierran cuando el código está hecho y verificado** (decisión del 2026-09-04). Ninguna
  tanda espera una corrida de mutación; si un módulo nuevo del núcleo puro queda sin medir, entra con
  `break: "sin medir"` y su candado garantiza que el suelo llega.
- **Cero créditos** en toda verificación. Servidores ajenos no se tocan: `./start.sh --preset <slug>`
  con `NEFAN_PORT_OFFSET` propio, `--parar` para lo propio, `ss -ltn` antes.
- **Pre-producción, cero compatibilidad**: lo que se sustituye se borra el mismo día, con barrido de
  prosa (`grep` a cero). Los rastros confunden a los agentes.
- **Candado, no prosa.** Un invariante que se pueda comprobar ejecutando va a un test o guion que se
  pone rojo; y se prueba EN NEGATIVO antes de darlo por candado.
- **Sin `as any`, sin baseline de errores tolerados** (tres veces escrito en #231).
- Solo se commitean `requisitos.md`, `critica.md`, `qa*.md`. Plan e implementación son efímeros.

## Los tres issues, con su alcance VIVO (lo demás ya se hizo)

### #302 — Nada revalida lo que el juego carga

**Muerto** (según sus propios comentarios del 28-08): la mitad (1), las fixtures de `data/scenes/`.
`nefan-core/test/scene-fixtures.test.ts` descubre los ficheros con `readdirSync` y pasa cada uno por
`validateScene` (hoy `describe` en `:208`).

**Vivo**: la **staleness del snapshot de mundo** (`nefan-core/data/games/*/world/tile.json`) va
solo por `world_doc_hash` (`src/games/world-snapshot.ts:114` y `:171`, medido hoy). Un snapshot
generado bajo un validador viejo sigue `ready` cuando el validador se endurece.

Dato del 29-08 que hay que verificar: 18 de 20 tiles pre-generados llevaban una `style_ref` retirada
el 22-08 y **uno se escribió el 28-08** — o `dist/` de narrative-mcp iba viejo, o hay una tercera vía
de escritura sin gate. Hoy en la máquina hay **4** `tile.json` (uno por juego base + colonia_aster),
no 20: la población cambió y hay que remedirla. La separación `EmittedSceneSchema` /
`ExpandedSceneSchema` que el issue necesitaba **ya existe** (`src/contract/model-io/scene-schema.ts`,
la usa `world-snapshot.ts`).

**Trampa medida**: los snapshots están en `.gitignore`. Un test que los recorra sale **verde vacío en
CI**. La revalidación tiene que apoyarse en artefactos commiteados o traerse los suyos.

### #235 — El tramo ai_server no se recorre de punta a punta

**Muerto** (auditoría del 30-08): «`validate_scene_response` no se ejecuta en `qa/`» — el guion 40 lo
ejecuta en subproceso Python sobre los mismos payloads que el zod, y documentó una asimetría
**deliberada** (bloques que el zod rechaza y ai_server acepta: kinds/materials desconocidos, scatter…).
La vía 3 del cuerpo (comparar salida saneada por igualdad estricta) está descartada por escrito.

**Vivo**: ninguna corrida atraviesa motor → MCP → **ai_server por HTTP** → bridge → cliente. El preset
`e2e-sin-creditos` apunta el bridge al `fake-ai-server` (`start.sh:422`), que devuelve Format D sin pasar
por `ai_server`. `clean_ent` es un **dict local** dentro de `validate_scene_response`
(`narrative_schemas.py`), no hay nada exportable.

**Criterio del issue**: una corrida automática en la que un NPC con `role` y `description` atraviesa
`ai_server` y llega al cliente con los dos campos, y que se pone **roja** si una de las dos allow-lists
deja de copiarlos.

### #357 — `qa/` es el instrumento con el que se aceptan las tandas y no lo mide nadie

Medido hoy: `qa/guiones/` = **70** guiones + **23** ejecutables sueltos, `qa/lib/` = **11** módulos,
**29.145 líneas** de `.mjs`. El CI (`.github/workflows/ci.yml`) **no toca `qa/`** (0 menciones).
Lo que sí hay: **4** tests de `nefan-core/test/` importan `qa/lib/*` (`veredictos`, `esperas-de-qa`,
`presets-clasifica`, `port-offset-paridad`; `architecture` solo lo cita en un string — corregido tras la crítica) — el precedente «el test importa al banco»,
y los guiones de candados en negativo (`bateria-`, `esperas-`, `contrato-`, `mutacion-` ×3…).

**El issue dice que la decisión ES el issue**. Las tres preguntas: (1) ¿entra `qa/lib/` en algún
perímetro de medida, y en qué dirección de dependencia? (2) ¿basta con los candados en negativo más un
candado de **totalidad** (todo módulo de `qa/lib` con caso en negativo o exención escrita)? (3) ¿corre
el CI alguna vez un subconjunto sin navegador?

### #231(b) — candidato: `test/` no pasa por `tsc`

(a) está hecha (`tsconfig.scripts.json`, `typecheck:scripts` en verify y CI). Vive (b): `test/`.
Medido hoy sobre los **120** `*.test.ts`: **102 errores en 28 ficheros** con las flags reales del build (96 con `lib ES2023`; corregido tras la crítica). Serie: 59
(23-08) → 66 → 75 → 89 (30-08) → **96** (05-09). Top hoy: `bridge-session` 13, `volume-metrics` 12,
`bridge-map` 11, `scene-normalize` 10, `fps-ambience` 7. La cabecera de `tsconfig.scripts.json` aún
cita el bloqueo por «la tanda del bosque», que caducó el 26-08 (#288): es prosa que confunde.

Entra en la tanda **si el crítico y el arquitecto lo admiten**; la razón para juntarlo es que #357 y
#231b son la misma pregunta —qué árboles del repo se comprueban y cuáles no— y la razón para
separarlo es el tamaño (96 errores en 25 ficheros es una tanda por sí sola).

## Lo que pido al crítico

1. **Re-verificar** sobre `27a46fa` cada mitad viva: la línea de `world-snapshot.ts`, los 4 tiles
   locales (¿llevan campos retirados? ¿por qué vía se escribieron?), qué hace hoy exactamente el
   guion 40, qué corre el CI.
2. Decidir por cada issue: vigente / reencuadrado / obsoleto / en conflicto / prematuro.
3. Para #357, **proponer la decisión** (no dejarla abierta): el issue lo dice, la decisión es el
   entregable.
4. Decir si #231b entra, y si entra, si es una PR propia dentro de la tanda o va a T12.
5. Buscar conflictos con T12 «La puerta del core» (#359 + #231) y con los programas abiertos (#358,
   #346, #241 harness del cliente, #388 cobertura V8).
6. Aviso: el fallo más caro de esta serie ha sido el **verde que no comprueba nada**. Cualquier
   criterio de aceptación que propongas debe decir cómo se pone rojo.

## Criterios de aceptación (borrador, sujetos a la crítica)

- **#302**: un snapshot generado bajo un validador anterior deja de servirse como `ready` cuando el
  validador cambia; hay un test que lo demuestra con un artefacto **commiteado** (no los `.gitignore`).
  Se remide la población de tiles locales y se explica el del 28-08 (o se demuestra que la vía ya no
  existe).
- **#235**: una corrida automática **sin créditos** en la que un NPC con `role` + `description`
  atraviesa `ai_server` **por HTTP** y llega al cliente con ambos; probada en negativo quitando un
  campo de una allow-list.
- **#357**: decisión escrita y ejecutada: qué perímetro mide `qa/lib`, en qué dirección, y qué
  subconjunto corre en CI. Si la respuesta es «candado de totalidad», existe y se ha visto rojo.
- **#231b** (si entra): `test/` tipa en CI con 0 errores, sin `as any` ni baseline; la cabecera de
  `tsconfig.scripts.json` deja de citar un bloqueo caducado.
- `npm run verify` verde, deuda sin crecer, ningún umbral bajado, CI verde en cada PR, honesty note de
  que CI no corre `qa/` (salvo que esta misma tanda lo cambie: entonces la nota cambia).

## Tras la crítica (2026-09-05) — alcance corregido, pendiente del visto bueno del usuario

Veredictos: **#302 reencuadrada (menor) · #235 vigente · #357 vigente con decisión propuesta · #231b entra
como PR-0**. Detalle y medidas en `critica.md`. Lo que cambia respecto a lo de arriba:

- **#302 / Vivo**: la carga del snapshot (`replayWorldSnapshot`, `bridge/handlers/session.ts:510-519`) no
  pasa por `validateScene`; lo estructural ya lo rechaza `ExpandedSceneSchema .strict()` en
  `loadWorldSnapshot` (#324, #409) y los 4 tiles locales miden `stale` hoy. El «tile del 28-08» lo
  escribió el bridge alimentado por el motor falso (`labs/narrative/fake-scenes.ts` en `0712349`) con el
  gate de escritura en `z.unknown()`: no hay tercera vía, el escritor es único (`writeSessionSnapshot`).
  Los 4 tiles son residuo de banco.
- **#302 / Criterio**: un snapshot que pasa el schema pero no `validateScene` (artefacto sintético, patrón
  `aDisco` de `test/world-snapshot.test.ts`) no se sirve como `ready`; quitar la comprobación pone el
  test rojo. Borrar los 4 tiles locales solo con permiso del usuario (material de sesión).
- **#235 / Criterio**: headless y **en proceso** si va a CI (CI no instala uvicorn); el rojo es quitar
  `role` de `ENTITY_FIELDS` en `ai_server/narrative_schemas.py`. Palancas que existen sin diseñar:
  `ANTHROPIC_BASE_URL` (SDK anthropic 0.94) y narrative-mcp por stdio. NO se toca la asimetría del guion 40.
- **#357 / Decisión** (sustituye a las tres preguntas): (1) dirección test → banco, formalizada, nunca
  `qa/lib` en mutación ni en `MEDIDOS` del CRAP; (2) candado de totalidad: todo `qa/lib/*.mjs` importado
  por algún test o eximido con motivo (7 de 11 conducen navegador/stack → exención); (3) CI corre los 8
  candados headless de `qa/`. Evidencia: `node qa/mutacion-reparto-en-lotes.mjs --solo-vigentes` está
  **rojo en `main` el 05-09** y nadie lo sabía — atenderlo en la PR.
- **#231b**: entra como **PR-0** independiente y primera; T12 se queda solo con #359. 102 errores / 28
  ficheros; ~14 son tests que mienten (`sessionStorage.write` ×8, rama retirada ×2, dobles `void` ×2,
  `side`, `inventory: never[]`). Sin `as any` ni baseline.
- **Orden**: PR-0 ∥ PR-1 (#302) ∥ PR-2 (#235); PR-3 (#357) detrás de PR-2.
- **Barrido del día después**: `tsconfig.scripts.json:11-13`, `world-snapshot.ts:47`,
  `scene-fixtures.test.ts:149,154`, `docs/arquitectura/ia-servicios.md:121`, cabeceras de
  `esperas-de-qa`/`veredictos`/`presets-clasifica` («el CI no corre qa/»), fila nueva en `CLAUDE.md`.

## Decisión del usuario (2026-09-05, literal de las cuatro respuestas)

1. #231b: «Sí, PR-0 en T11». T12 se queda solo con #359.
2. `qa/` en CI: «Sí». El CI corre los candados headless; la nota de honestidad y `CLAUDE.md` cambian.
3. Los 4 `tile.json` locales: «**borralos**». Borrados el 2026-09-05 por el coordinador (`rm`, sin
   archivo: orden explícita; eran residuo del motor falso, gitignored, y el título los regenera).
4. #302: «Sí, reencuadre» → «lo que se carga pasa por `validateScene` o no se sirve».
