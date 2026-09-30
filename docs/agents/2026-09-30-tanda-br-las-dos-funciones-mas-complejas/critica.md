**REENCUADRADA** — solo `handle`, y no como «trocear para bajar el CRAP» sino como «el enrutador copia a mano una tabla que el contrato ya declara y nadie lee». `formatDToWorld` fuera de la tanda (su deuda real es otra y más grande); `walkValue`, `decide` y `volumeFootprint` tampoco.

## El problema real, en una frase

El asset-store tiene un contrato de endpoints (`AssetStoreApi`) sin ningún consumidor en tiempo de ejecución, y un router de 13 guardas escritas a mano que puede divergir de él sin que nada se ponga rojo; el CRAP 48 es el síntoma.

## La premisa, afirmación por afirmación

Medido hoy sobre `main` 0afb76c3 con el `coverage/lcov.info` de las 09:47 (`npm run crap`):

- **`handle` CRAP 47,8, cx 46, 91 %** — cierto (`services/asset-store/http-server.ts:98`). Es el peor de la casa; tope 73, 0 por encima; objetivo 30, 6 por encima.
- **`formatDToWorld` CRAP 43, cx 43, «100 %»** — cierto, 99 % (`src/scene/scene-normalize.ts:235`).
- **`walkValue` 37,5 · `decide` 36,1 · `volumeFootprint` 36,0 · `enrichFpsPrims` 31,0** — ciertos.
- **«`handle` es un enrutador con un `if` por ruta»** — cierto, y **no es un switch honesto**: el propio repo ya decidió que esa forma es un defecto cuando la tabla existe como dato. `bridge/state-http/routes.ts:1-14` cuenta que el State API «duplicaba en 28 guardas `method === … && path === …`» la tabla `WorldStateApi` y se sustituyó por una tabla DERIVADA del contrato donde un endpoint sin handler no compila. El asset-store es el mismo caso sin hacer: `src/contracts/asset-store.ts:265-299` declara 12 endpoints y `grep AssetStoreApi` fuera de comentarios da **cero** usos (solo `src/contracts/asset-store.ts` lo define; `http-server.ts:1` y `server.ts:2` lo mencionan en prosa).
- **Deriva ya presente**: `GET /health` se sirve (`http-server.ts:107`) y NO está en `AssetStoreApi`; su tipo de respuesta vive en el servidor (`http-server.ts:60`), no en el contrato.
- **El 9 % sin cubrir no es ruido**: son las líneas 152-164 = `POST /assets/pin` entero, sin un solo test del lado del store. Es una ruta VIVA: la llama `nefan-html/src/ui/style-apply.ts:484` para pinear el arte del batch de estilo, que es lo que lo protege del LRU de `/cache/prune` (`http-server.ts:143`). Un pin roto = arte pagado evictable, en silencio.
- **`formatDToWorld` «mezcla responsabilidades»** — sí, pero no las que un troceo arreglaría. Lo que infla su cx son (a) seis `throw` por entity (`scene-normalize.ts:273-289`) que re-validan a mano `id`, `kind`, `cell`, `footprint`, `name`: exactamente lo que ya exige `EntitySchema` (`src/contract/model-io/scene-schema.ts:91-140`), y (b) dos tolerancias (`h` inválido → default, `:337-340`; `shape` inválida → default, `:365`) que `EntitySchema` ya rechaza (`h: positive`, `shape: enum`). Todas las poblaciones que llegan pasan antes por `ExpandedSceneSchema`: el save (`narrative-state.ts:564` y `:789`), el snapshot (`world-snapshot.ts:59`) y las fixtures (candado de `test/scene-fixtures.test.ts`). La raíz es que `SceneRecord.scene_data` es `Record<string, unknown>` (`src/narrative/types.ts:100`), y la propia cabecera de la función lo admite: «tiparla es otro issue» (`scene-normalize.ts:230`). **Ese issue no existe** (`gh issue list`: solo #361-#363).
- **Solapamiento con BQ** — no hay: BQ toca `nefan-core/scripts/`; esta toca `services/asset-store/` (y, si se hiciera, `src/scene/`).

## El día después (solo `handle`)

- Para quien juega: nada visible; lo que cambia es que el pin del estilo queda probado por HTTP y que una ruta nueva del store no puede nacer sin entrada en el contrato ni al revés.
- La tarea es **mayor** de lo que parece, por dos colisiones medidas con `matchRoute` (`src/contracts/http.ts:125-163`, «gana la literal; si no, la PRIMERA con parámetros»): (1) `/cache/sprite_hero/{key}` y `/cache/sprite_sheet/…` chocan con `getBlob` `/cache/{kind}/{hash}`, que va primero en la tabla — hoy el orden de los `if` lo resuelve y hay un comentario que lo avisa (`http-server.ts:172-174`); (2) `getStyleFile` declara `/styles/{style_id}/{file}` y la ruta real admite 4 segmentos (`http-wire.ts:49-56`), que `matchRoute` no casa. Y un detalle de conducta: `unpin` hace `decodeURIComponent` (`http-server.ts:167`) y `matchRoute` no decodifica a propósito (`http.ts:103-105`). Cualquiera de las tres se resuelve o se documenta en el plan; ninguna puede resolverse cambiando la conducta del wire en silencio.
- `http-server.ts` está fuera del perímetro de mutación (`core-puro-sin-node` no incluye `services/`): la red es `test/asset-store.test.ts` (36 casos por HTTP) y `test/asset-store-server.test.ts`, no un `mutacion local`. Barato de verificar.
- Qué cierra: nada que hoy esté abierto; el asset-store no tiene cambios desde 2026-09-03 (`git log` → #416).

## Por qué NO `formatDToWorld` ahora

- Trocearla bajaría el número dejando intacta la causa: la re-validación a mano de lo que el zod ya garantiza. Eso es la trampa de «Las métricas son síntomas».
- Lo honesto es tipar la entrada como `ExpandedScene`, y eso toca `SceneRecord` y sus lectores en bridge y cliente: otra tarea, no esta.
- No es verificable en local: el módulo `scene-normalize` son 313 mutantes contra `tope_local` 120 (`mutation-targets.json`, módulo `scene-normalize`), así que la restricción de `requisitos.md` («no dejar vivo un mutante que hoy muere») exigiría otra corrida autorizada. Y la corrida 36684509746 la está midiendo AHORA: tocarla hoy deja esa medida obsoleta el día que llega.
- Lo que sí toca hacer: **abrir el issue** que su cabecera promete. **PREMATURA** hasta que la corrida en marcha aterrice y dé la base.

## Las otras tres

- `volumeFootprint` (`src/scene/blueprint/footprint.ts:46`): `switch (v.type)` plano sobre 7 tipos de volumen, 99 %. Complejidad honesta. **No tocar.**
- `walkValue` (`src/plugins/validate.ts:45`): validador del DSL de plugins, que está aparcado con sus tres issues abiertos (#361-#363, #361 es justo lo que escriben los plugins). Tocarlo ahora paga dos veces. **No tocar.**
- `decide` (`src/simulation/npc-behavior.ts:586`): cambiado por #775 y #779 en las últimas 24 h y midiéndose ahora. Su 17 % sin cubrir podría ser deuda de test real, pero juzgarlo exige la medida que aún no ha llegado. **No tocar en esta tanda.**

## Coste contra valor

`handle`: medio día de trabajo con red de tests HTTP; compra una garantía que el repo ya decidió que quería (la de `routes.ts`) y cierra un agujero de cobertura sobre el arte pagado. Vale. Si no se hiciera nunca: el asset-store sigue funcionando; el riesgo es una ruta que diverge del contrato sin que nadie lo vea, que es poco probable en un servicio parado desde el 03-09. Por eso el test de `POST /assets/pin` va primero y es lo no negociable; la tabla, después.
`formatDToWorld` troceado: coste real (corrida autorizada) y valor nulo. No hacerlo.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

> ## Qué se pide (reencuadrado por el crítico)
>
> 1. Probar por HTTP `POST /assets/pin` en `test/asset-store.test.ts` (éxito y 400): es la única ruta viva del store sin test (líneas 152-164 de `http-server.ts`) y es la que protege del prune el arte pagado del batch de estilo.
> 2. Que el router del asset-store deje de duplicar a mano `AssetStoreApi`, como hizo el State API en `bridge/state-http/routes.ts`: un endpoint del contrato sin handler, o un handler sin endpoint, no compila. `/health` entra en el contrato (o queda fuera por escrito, con motivo). Las tres fricciones con `matchRoute` —`sprite_hero`/`sprite_sheet` frente a `/cache/{kind}/{hash}`, `/styles/{id}/{file}` con subcarpeta, y el `decodeURIComponent` del unpin— se resuelven sin cambiar lo que el wire contesta hoy, y cada una con un test que lo demuestre.
> 3. `formatDToWorld` NO se toca en esta tanda. Se abre un issue: «`SceneRecord.scene_data` sin tipo obliga a `formatDToWorld` a re-validar a mano lo que `EntitySchema` ya garantiza (seis `throw` y dos tolerancias que el zod rechaza)», a hacer cuando la corrida 36684509746 haya dado la base del módulo `scene-normalize`.
> 4. `walkValue`, `decide`, `volumeFootprint`: fuera, con el motivo de `critica.md`.
>
> Criterio de aceptación: `handle` baja del objetivo 30 como consecuencia, no como meta; `npm run verify` verde; ningún cambio de código de estado ni de cuerpo en ninguna ruta existente.
