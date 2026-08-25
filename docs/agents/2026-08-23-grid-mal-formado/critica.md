# REENCUADRADA

No hay duda que preguntar al usuario: la doctrina la decide sola. Y además la premisa del issue es
falsa en su parte central — el 500 que describe **no se reproduce** con la carga que el motor sabe
producir, y el normalizador **no es inalcanzable**: se ejecuta en cada validación.

## El problema real, en una frase

`validateScene` puede **lanzar** en vez de devolver `{ok:false,errors}` y sus dos llamadores no lo
capturan, pero solo por una puerta que el motor no sabe abrir; lo que de verdad sobra es un
normalizador tolerante que sanea en silencio, prohibido por doctrina y sin un test que lo ejerza.

## La premisa, afirmación por afirmación

1. **«`computeTileEdges` se llama sin condición y lanza si no es 128×128»** — **CIERTO**:
   `src/scene/scene-validate.ts:688`, `src/scene/tile-edges.ts:66-70`.

2. **«Cae ahí cualquier grid que el normalizador estaba pensado para arreglar»** — **FALSO**.
   Ejecutado contra el código: un tile con `terrain` de 127 filas, o con una fila corta, devuelve
   resultado estructurado, no un throw:
   `ok=false errors=["un tile no lleva size/terrain completos: la base es 'biome' + primitivas…"]`
   Sale de `prepareTileBase` (`src/scene/scene-expand.ts:171-174`), que `openTile` ya captura y
   convierte en error del motor (`scene-validate.ts:265-273`). El camino accionable **ya existe**.

3. **«El normalizador es inalcanzable: el throw es antes»** — **FALSO, y al revés**. `normalizeGrid`
   vive en `openTile` (`scene-validate.ts:200-210`), lo **primero** que hace `validateScene`
   (`:686`); `computeTileEdges` es la sexta pasada (`:688`). Su salida `view.grid` alimenta las
   pasadas 1, 2, 4 y 8. Lo inalcanzable no es el normalizador: es su **tolerancia**.
   El hallazgo que el issue no ve: hay **dos grids** — `view.grid` (normalizado) para todas las
   pasadas y `view.scene.terrain` (crudo) para `computeTileEdges`. Dos fuentes de verdad del mismo
   grid; si la tolerancia llegara a morder, divergirían en silencio.

4. **«`POST /scene/validate` responde 500»** — **CIERTO, pero solo con `__expanded: true`** en el
   cuerpo, que es el marcador **interno** de idempotencia del expander (`scene-expand.ts:75`,
   `:458`), no un campo del contrato del modelo. Con él, tres formas de 500 verificadas (127 filas ·
   fila corta · fila no-string) y una cuarta que el issue no menciona: `__expanded:true` **sin**
   `terrain` → `TypeError: Cannot read properties of undefined` dentro de `normalizeGrid`, o sea
   **antes** de `computeTileEdges`.
   El pre-flight de `narrative_respond` (`narrative-mcp/server.ts:530`) manda la escena ya parseada
   por zod, cuyo `superRefine` rechaza cualquier `terrain` no vacío en un tile
   (`src/contract/model-io/scene-schema.ts:100`) → **por ahí el 500 es inalcanzable**. La única
   puerta viva es la tool `scene_validate` (`narrative-mcp/server.ts:626`), que postea JSON
   arbitrario sin zod porque `SceneValidateRequestSchema` acepta cualquier objeto
   (`src/contracts/request-schemas.ts:148-153`).

5. **Segundo call site** — **CONFIRMADO**: `src/narrative/narrative-state.ts:358`
   (`recordSceneLoaded`) llama a `computeTileEdges(sceneData)` sin condición ni try/catch. Hoy no
   está vivo —los cuatro llamadores le pasan escena ya expandida (`bridge/handlers/tile.ts:153-156`,
   `bootstrap-tile.ts:85-87`, `scene.ts:104`, `session.ts:432`)— pero es la misma mina sin espoleta.

6. **Red de #194** — **puesta y verde**: `npx tsx --test test/scene-validate-golden.test.ts` → 34/34,
   33 casos. Trae hallazgo propio: el helper `tileExpandido`
   (`test/fixtures/scene-validate-corpus.ts:52`) se anuncia como el modo de «darle al normalizador
   filas cortas, largas y de sobra» y se usa en **un** caso (`:151`), con grid perfecto de 128×128.
   La tolerancia tiene **cero** cobertura: no puede ponerse roja.

7. **La justificación del normalizador está caducada.** Su comentario dice «mismo criterio tolerante
   que el saneador de ai_server». Ese saneador hoy hace `data.pop("terrain", None)` para los tiles
   (`ai_server/narrative_schemas.py:476`): no rellena filas, **borra el campo**.

## ¿Decide la doctrina? Sí — y por eso no es una duda

La salida 1 («hacer el normalizador alcanzable») es rellenar y recortar el grid del modelo en
silencio: literalmente el `validate_scene_response` que **este repositorio ya retiró por eso**, y lo
dice la cabecera del zod que lo sustituyó, `src/contract/model-io/scene-schema.ts:4-7` — «DEGRADABA
en silencio (terrain no lista → todo hierba, filas mal → padding…), así que un error de forma del
modelo nunca volvía al modelo». Reintroducirla sería deshacer esa decisión en el fichero de al lado.
La salida 2 es la doctrina. **No hay elección de producto: hay una decisión tomada que este fichero
no ha aplicado.**

## El día después

- **Para quien juega**: nada. Honestidad de contrato y deuda declarada, no funcionalidad.
- **Qué se vuelve más difícil**: nada; ninguna carga viva depende de la tolerancia.
- **Qué habría que borrar y nadie borrará**: `normalizeGrid`, su comentario caducado y el reclamo
  del helper `tileExpandido`.
- **Qué parecerá arbitrario en un mes**: que `computeTileEdges` reciba `view.scene` mientras todo lo
  demás lee `view.grid`. Si el arreglo no cierra eso, el próximo lector repite este issue.

## Conflictos

- **#199** (gpu-worker devuelve 500 en vez de fail-loud) es el **mismo patrón** en otro proceso. Sin
  solapamiento de código ni orden obligado; conviene el mismo criterio de «error del cliente ≠ 500».
- **#203** está fuera de alcance y no colisiona: aquí no se toca `generate_scene.json` ni el zod.
- **`arch-rules.json`**: sus dos reglas de fail-loud hablan de errores **tragados**, no de throws que
  cruzan una frontera HTTP. Este invariante **no tiene candado hoy**.
- `git log` reciente (mutación por módulo, #176/#168) no toca `src/scene/`.

## Coste contra valor

Trabajo pequeño, acotado a `src/scene/scene-validate.ts` más dos try/catch, con la red de 33 casos
verde para demostrar que no toca nada más. El valor **no** es el que dice el issue (el motor no
recibe 500 hoy): es cerrar la puerta de 500 de la tool `scene_validate`, desactivar la mina de
`recordSceneLoaded` y **borrar un saneo silencioso que contradice una decisión escrita**. No hacerlo
nunca es sostenible —nada se rompe—, pero deja en el repo el patrón exacto que se retiró hace dos
meses, con un test que promete cubrirlo y no lo cubre.

## Qué le cambiarías a `requisitos.md` (para pegar tal cual)

> **Corrección de premisa (crítica).** El #195 describe mal el fallo. Verificado ejecutando
> `validateScene`: un tile con `terrain` malformado y **sin** `__expanded` NO revienta — devuelve el
> error accionable de `prepareTileBase`. El 500 solo se alcanza si el cuerpo trae `__expanded: true`
> (marcador interno del expander), y el pre-flight de `narrative_respond` no puede producirlo porque
> el zod rechaza `terrain` en un tile: **la única puerta viva es la tool MCP `scene_validate`**, que
> postea JSON sin zod. Tampoco es cierto que el normalizador sea inalcanzable: `normalizeGrid` corre
> en `openTile`, antes que todo; lo inalcanzable es su *tolerancia*.
>
> **La decisión ya está tomada, no se pregunta.** De las dos salidas, la 1 (normalizar en silencio)
> es el `validate_scene_response` que el repo retiró por degradar sin avisar
> (`src/contract/model-io/scene-schema.ts:4-7`). Se toma la **salida 2**: rechazo con error propio y
> legible, y `normalizeGrid` se borra entero.
>
> **Alcance corregido, cuatro puntos:** (a) rechazar el grid malformado con error estructurado
> **antes** de construir la `TileView` — cubre también `__expanded:true` sin `terrain`, hoy un
> `TypeError` dentro de `normalizeGrid`; (b) `computeTileEdges` debe leer el **mismo** grid que las
> demás pasadas (hoy recibe `view.scene`, ellas `view.grid`); (c) `validateScene` no puede lanzar
> hacia `bridge/state-http-server.ts:282` ni hacia `src/narrative/narrative-state.ts:358` (segundo
> call site, ausente del issue); (d) al borrar `normalizeGrid`, corregir el reclamo del helper
> `tileExpandido` (`test/fixtures/scene-validate-corpus.ts:52`), que promete cubrir filas cortas y
> largas y no cubre ninguna.
>
> **Sin preguntas para el usuario.**
