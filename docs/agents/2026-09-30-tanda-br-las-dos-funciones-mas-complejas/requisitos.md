# Tanda BR — Las dos funciones más complejas del core

## Petición del usuario (literal)

«Mutacion lanzada, adelante» (2026-09-30), en respuesta a la propuesta del coordinador: mientras mide la corrida completa, atacar la cola de `npm run deuda`. El marco de la jornada anterior sigue vigente: «Sigue cerrando todos los issues que puedas de forma autónoma. El objetivo es reducirlos al mínimo». Hoy los issues abiertos son solo los tres de plugins, que están aparcados, así que la cola sale de `npm run deuda`.

## Lo medido (2026-09-30, `main` 0afb76c3, `npm ci` + `npm run build` + `npm run coverage` frescos)

Bloque «Complejidad × cobertura» del core: 11 items. Los que pasan del objetivo (30) son complejidad, no falta de cobertura:
- `services/asset-store/http-server.ts:98` `handle`: CRAP 48, complejidad 46, cobertura 91 %.
- `src/scene/scene-normalize.ts:235` `formatDToWorld`: CRAP 43, complejidad 43, cobertura 100 %.
- `src/plugins/validate.ts:45` `walkValue`: 37 (complejidad 27, 76 %).
- `src/simulation/npc-behavior.ts:586` `decide`: 36 (complejidad 31, 83 %).
- `src/scene/blueprint/footprint.ts:46` `volumeFootprint`: 36 (complejidad 36, 100 %).
- `src/scene/blueprint/fps-detail.ts:296` `enrichFpsPrims`: 31.

## Qué se pide

Bajar la complejidad de las dos primeras. `handle` suena a enrutador HTTP con un `if` por ruta; `formatDToWorld` es la frontera Format D → world scene. Según «Las métricas son síntomas», no se trocea para bajar el número: se trocea donde haya responsabilidades distintas mezcladas. Si una complejidad alta es honesta (un `switch` plano de rutas, por ejemplo), el crítico lo dice y la tanda la deja estar.

El crítico decide:
- el alcance (¿solo esas dos, o también `walkValue`, `decide` o `volumeFootprint`?);
- si `formatDToWorld` debe tocarse ahora, con la mutación completa midiéndola y 66 módulos con la medida posiblemente obsoleta.

Si hay solapamiento con la tanda BQ, que va en paralelo sobre `nefan-core/scripts/`, lo avisa.

## Restricciones

- Hay una corrida de mutación completa en marcha (run 36684509746) sobre `main` 0afb76c3. No se toca el tag `mutacion-ultima` ni `reports/mutation/`. Un refactor NO puede dejar vivo un mutante que hoy muere: si el módulo cabe en el tope local, `npm run mutacion -- local <id>` antes y después.
- Todos los agentes en Opus. Guiones reservados: 310–319.
- NUNCA `git stash`. Para medir la base, `git worktree add` temporal en el scratchpad.
- Gotcha local: en el árbol principal, `nadie-inventa-un-puerto` sale rojo por los ficheros ignorados de `labs/narrative/runs/tanda-bm-20260929/`. En un worktree limpio no pasa.

## Qué se pide (reencuadrado por el crítico)

1. Probar por HTTP `POST /assets/pin` en `test/asset-store.test.ts` (éxito y 400): es la única ruta viva del store sin test (líneas 152-164 de `http-server.ts`) y es la que protege del prune el arte pagado del batch de estilo.
2. Que el router del asset-store deje de duplicar a mano `AssetStoreApi`, como hizo el State API en `bridge/state-http/routes.ts`: un endpoint del contrato sin handler, o un handler sin endpoint, no compila. `/health` entra en el contrato (o queda fuera por escrito, con motivo). Las tres fricciones con `matchRoute` —`sprite_hero`/`sprite_sheet` frente a `/cache/{kind}/{hash}`, `/styles/{id}/{file}` con subcarpeta, y el `decodeURIComponent` del unpin— se resuelven sin cambiar lo que el wire contesta hoy, y cada una con un test que lo demuestre.
3. `formatDToWorld` NO se toca en esta tanda. Se abre un issue: «`SceneRecord.scene_data` sin tipo obliga a `formatDToWorld` a re-validar a mano lo que `EntitySchema` ya garantiza (seis `throw` y dos tolerancias que el zod rechaza)», a hacer cuando la corrida 36684509746 haya dado la base del módulo `scene-normalize`.
4. `walkValue`, `decide`, `volumeFootprint`: fuera, con el motivo de `critica.md`.

Criterio de aceptación: `handle` baja del objetivo 30 como consecuencia, no como meta; `npm run verify` verde; ningún cambio de código de estado ni de cuerpo en ninguna ruta existente.

El coordinador acepta el reencuadre el 2026-09-30. El issue del punto 3 lo abre el coordinador cuando aterrice la corrida; no forma parte de esta tanda.
