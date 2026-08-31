# Requisitos — Las puertas que esquivan el contrato (#334 + #195 + #336, candidato #337)

## Petición del usuario (literal)

La petición de fondo de la serie es:

> «Vamos a seguir priorizando reducir el numero de issues»

Tras el triaje crítico del 2026-08-30 (auditoría de los 32 issues abiertos contra `3f6feab`,
pedida con «Revisa los issues y como ir resolviendolos. Se critico y no asumas nada como bueno,
estas en una conversacion iniciada con opus y puede haber fallos en lo que se ha hecho»), el
usuario aprobó la hoja de ruta y arrancó esta tanda con:

> «vamos con la tanda 1»

La tanda 1 de la hoja de ruta aprobada es: **«Las puertas que esquivan el contrato» — #334 +
#195 + #336 (+#337 si el arquitecto lo admite sin engordar)**.

## El problema real (una frase)

Hay entradas de escena que llegan al juego sin pasar por el contrato zod — el save al cargarse,
la escena del banco, la tool MCP `scene_validate` y el `.passthrough()` de `narrative_respond` —
y cuando el contenido inválido cruza, el fallo es un 500 mudo o un estado corrupto en vez del
error accionable que el proyecto tiene decidido dar al modelo (doctrina fail-loud).

## Fuentes de verdad

Los cuatro issues llevan **comentarios de auditoría del 2026-08-30** (medidos sobre `3f6feab`)
que corrigen o amplían sus cuerpos. Leer cuerpo + comentarios, no solo el cuerpo:

```bash
gh api repos/alberto-hortelano/ne-fan/issues/334 --jq '.body'
gh api repos/alberto-hortelano/ne-fan/issues/334/comments --jq '.[].body'
# ídem 195, 336, 337
```

Resumen verificado (todas las citas a HEAD `3f6feab`):

### #334 — el bridge no corre el zod

- `git grep "EmittedSceneSchema\|ExpandedSceneSchema" -- bridge/` → 0 usos ejecutables (solo el
  comentario `bridge/context.ts:342`).
- **Instancia A**: `loadSession` (`src/narrative/narrative-state.ts:373-397`) asigna
  `scenes_loaded` a pelo mirando solo `schema_version`. Un save con `footprint:[8,8]` en una
  entity npc carga, se conserva y el NPC se pinta a 1,75 m de donde el sim lo tiene.
- **Instancia B**: el banco (`labs/narrative/fake-ai-server.ts:339,470`) emite `style_ref` a
  nivel de escena, que `EmittedSceneSchema` rechaza (`scene-schema.ts:272-289`) — y entra igual
  porque nadie corre el zod en ese camino. Si se valida la carga, el banco empieza a fallar:
  **las dos instancias van juntas**.
- Puerta de escritura: `recordSceneLoaded` (`narrative-state.ts:474`).

### #195 — `POST /scene/validate` responde 500; el 500 tiene DOS puertas y tres vectores

- La ruta sigue sin try/catch: `bridge/state-http/scene-routes.ts:44-50`; el 500 lo fabrica
  `state-http-server.ts:101-103`. El throw vive en `tile-edges.ts:69`, alcanzado desde la sexta
  pasada (`scene-validate.ts:951`).
- **Puerta 1**: tool MCP `scene_validate` (`narrative-mcp/server.ts:608-637`) — `JSON.parse` +
  `bridgePost` sin zod.
- **Puerta 2**: `narrative_respond` con `kind === 'scene'` — su gate es `EmittedSceneSchema`,
  que es **`.passthrough()`** (`scene-schema.ts:243`) y solo comprueba `terrain.length > 0`
  (`:266`). `__expanded: true` + `terrain: []` → throw en `computeTileEdges`; sin `terrain` →
  `TypeError` en `normalizeGrid` (`scene-validate.ts:269`). Esta puerta la cruza el motor real.
- **Vector 3**: `biome: "bogus"` con grid perfecto → 500 vía `resolveBiome` (`tile-edges.ts:72`).
- La crítica del 2026-08-23 (`docs/agents/2026-08-23-grid-mal-formado/critica.md`) ya descartó
  la salida 1 del cuerpo (hacer alcanzable el normalizador tolerante = reintroducir el saneo
  mudo que el repo retiró): la dirección es **rechazo temprano con error accionable y
  `normalizeGrid` fuera** — leerla antes de planificar.
- Un grid de 127 filas SIN `__expanded` NO revienta hoy (sale `{ok:false}` accionable): eso no
  hay que «arreglarlo», hay que no romperlo.
- La red de caracterización existe: `test/fixtures/scene-validate-golden.json` (33 escenas,
  ~30 KB). Tocar el camino la toca: revisar el diff del golden a mano, no regenerar a ciegas.
- El helper `tileExpandido` (`test/fixtures/scene-validate-corpus.ts:52`) anuncia tolerancia con
  un solo uso y grid perfecto: la tolerancia tiene cero cobertura.

### #336 — borrar la migración v3→v4

- `src/narrative/migrations.ts` (~100 líneas, CRAP 23) + fixture `test/fixtures/saves-v3/v3_aldea`
  + sus dos tests. Doctrina de `CLAUDE.md`: pre-producción, los saves viejos no importan.
- No es un rincón inerte: en #300 el footprint inflado de la migración hacía un segundo trabajo
  sin declararlo (recentrar al NPC). Cada tanda que toca footprint/remuestreo lo redescubre.
- Decisión pendiente (§ Preguntas abiertas): qué hace el arranque con un save v3.

### #337 (candidato) — el error de spawn nombra causas equivocadas

- `scene-validate.ts:493`: «celda "g" u ocupada por un footprint». La causa «footprint» está
  **muerta** (`buildWalkableMap` ya no estampa huellas; comentario en `scene-validate.ts:378-382`),
  el char puede ser transitable (impreciso), y la causa real —el anillo de colisión de un volumen
  del plan (`blueprint/collision.ts:141-152`, compuesto en `scene-validate.ts:415`)— no se nombra.
- Arreglo: el mensaje distingue las fuentes REALES de bloqueo (char del grid sólido / masa de un
  volumen del plan, con el **id del volumen**) y deja de nombrar la muerta. Reescribir, no añadir
  una cuarta rama.
- Entra en la tanda solo si el arquitecto lo admite sin engordarla: es el mensaje del mismo
  `scene-validate.ts`.

## Criterios de aceptación (deben poder nacer rojos)

*(Corregidos el 2026-08-31 con los hallazgos de `critica.md` — leerla antes de discrepar.)*

1. **El save se valida al cargarse**: un save cuya entity viola el contrato (p. ej.
   `footprint:[8,8]` en un kind móvil) NO llega al cliente — la carga falla con error que
   nombra la entity y el campo, por un canal **distinguible de «el save no existe»** (`Result`
   o throw; el `return false` del `loadSession` actual colapsaría ambos y sería el descarte
   silencioso que este requisito prohíbe). Test que hoy nace rojo, con un **save v4 construido
   en el test** (la fixture `saves-v3` muere en el criterio 7).
2. **La escritura también**: `recordSceneLoaded` valida la población expandida contra
   `ExpandedSceneSchema` y rechaza lo que el zod rechaza (p. ej. `footprint:[8,8]` en npc, que
   ambos schemas rechazan). OJO: `style_ref` de escena NO vale como ejemplo aquí —
   `ExpandedSceneSchema` lo tolera por decisión escrita (#237, `scene-schema.ts:305-308`) y
   18/20 escenas de snapshot commiteadas lo llevan; rechazarlo apagaría el arranque de
   alta_fantasia y colonia_aster. Test que hoy nace rojo.
3. **El banco emite escenas que el contrato del rol acepta**: el fake deja de emitir `style_ref`
   a nivel de escena, y el candado es un **test del fake contra `EmittedSceneSchema`** (el
   contrato del rol que suplanta). No puede serlo «la validación del bridge ejercida por la
   batería»: el gate de lectura tolera `style_ref` (ver criterio 2).
4. **`POST /scene/validate` no puede responder 500 por una escena mal formada**. Los tres
   vectores medidos (`__expanded:true` + `terrain:[]`; `__expanded:true` sin `terrain`;
   `__expanded:true` + grid perfecto + `biome` inválido — sin la marca ya da `{ok:false}`)
   devuelven `{ok:false, errors:[...]}` con mensaje accionable. Tests que hoy nacen rojos.
   Incluye cerrar lo que el reencuadre del 23-08 dejó escrito y nadie borrará si no está aquí:
   `normalizeGrid` borrado, el reclamo falso de `tileExpandido`
   (`scene-validate-corpus.ts:52`) corregido, y `computeTileEdges` leyendo el mismo grid que
   las demás pasadas (hoy hay doble fuente: `view.grid` vs `view.scene.terrain`).
5. **El `.passthrough()` deja de ser una puerta**: `__expanded` no puede cruzar el gate de
   `narrative_respond`. Mecanismo: **rechazo dirigido en el `superRefine`, mismo patrón que
   `style_ref`**. Del menú original, `strip` está proscrito (los schemas son predicados que no
   reescriben — candado en `scene-schema.test.ts` — y tirar en silencio lo emitido es saneo
   mudo) y «schema estricto» arrastra el censo del passthrough (`place_anchors` del motor real,
   `ambient_event`, `terrain_patches`/#335) — fuera de esta tanda.
6. **Un grid de 127 filas sin `__expanded` sigue dando `{ok:false}` accionable** (no regresión;
   ya existe, debe quedar cubierto si no lo está).
7. **`migrations.ts` muere entero** (158 líneas): la v3→v4, `migrateWorldMapFromV1` (v1→v2) y
   el shim v2→v3 (`plugins ?? []`) — misma doctrina, mismo fichero. Suelo único:
   `schema_version < SCHEMA_VERSION` → fallo ruidoso (comportamiento a confirmar en
   § Preguntas abiertas). Fixture `saves-v3` y sus tests, borrados con él, declarando la
   cobertura que se pierde.
8. Si #337 entra: ante spawn bloqueado por volumen del plan, el error nombra el **id del volumen**;
   la palabra «footprint» desaparece del mensaje; test que hoy nace rojo (hoy el mensaje nombra
   el char de debajo). Coste real medido por el crítico: la máscara compuesta no guarda
   procedencia celda→volumen — nombrar el id exige atribución (lógica nueva, acotada: las
   funciones de marcado por-volumen existen). Si al arquitecto le engorda la tanda, #337 sale
   sin dolor.
9. `npm run verify` verde; deuda que toca sin crecer; golden revisado a mano si cambia; issues
   cerrados desde la PR con `Closes #N` (en inglés — «Cierra» no autocierra).

## Fuera de alcance

- #332 / #331 (los guiones y el canal `⊘`) — tanda 2, aunque son «la misma familia».
- #302 (staleness de snapshots) y #335 (`terrain_patches` vs `terrain_legend`) — decisión aparte.
- Cualquier validación de saves más allá del contrato de escena/entities (no se diseña un
  esquema nuevo de save).
- Cambiar el comportamiento de `validateScene` para grids reparables que hoy ya dan error
  accionable.

## Decisiones tomadas (visto bueno del usuario, 2026-08-31)

1. **Save viejo o que no valida → FALLO RUIDOSO**: la carga falla con error que nombra el save
   y el motivo, por canal distinguible de «no existe». Decidido por el usuario tras la crítica.
2. **`migrations.ts` muere ENTERO** (las dos migraciones y el shim), no solo la v3→v4 del
   issue. Decidido por el usuario tras la crítica.

## Preguntas abiertas

1. ¿#337 entra en la tanda o queda fuera? Lo decide el arquitecto por tamaño (coste real:
   atribución celda→volumen, ver criterio 8).

## Restricciones operativas

- Rama + PR (nada directo a main: hay código). El hook `Stop` exige CI verde de la PR.
- Cero créditos: nada de servicios de imagen; el banco es el fake.
- No matar procesos ajenos (otras instancias de Claude trabajan en esta máquina); si hace falta
  stack, `NEFAN_PORT_OFFSET` libre o `qa/run.mjs` que ya lo gestiona.
- `gh` 2.4: sin `--json` en `pr checks`; espera de CI con
  `until ! gh pr checks <N> 2>&1 | grep -q "pending"; do sleep 30; done`.
- Tests obsoletos se borran con el cambio que los deja sin sentido, declarando qué cobertura se
  pierde.
