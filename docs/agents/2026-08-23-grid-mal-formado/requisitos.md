# `/scene/validate` ante un grid mal formado (#195)

## La petición del usuario, literal

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudar la cola:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Tu veredicto no necesita permiso: REENCUADRADA reescribe el issue y sigue, OBSOLETA lo cierra y
pasa al siguiente. Solo se para si obliga a elegir dirección de producto.

**Este issue era una de las tres «dudas» que se iban a preguntar al usuario**, porque plantea dos
salidas y dice que «hay que elegir una». Separar el problema de la solución propuesta es tu
trabajo: elige tú si el repositorio ya ha decidido esto en otro sitio, y sube al usuario solo si
de verdad es dirección de producto.

## El issue

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/195`.

Resumen: `validateScene` llama a `computeTileEdges(view.scene)` sin condición, y `tile-edges.ts`
lanza en cuanto el tile no es exactamente 128×128. Cae ahí cualquier grid que el normalizador
tolerante estaba pensado para arreglar — **y ese normalizador es hoy inalcanzable**, porque el
throw es antes. Como `bridge/state-http-server.ts` llama a `validateScene` **sin try/catch**,
`POST /scene/validate` responde **500** en vez del `{ok:false, errors:[...]}` que promete su
contrato. Ese endpoint respalda la tool MCP `scene_validate`: el motor pregunta «¿es jugable
esto?» y recibe un fallo de servidor en lugar de «tu grid tiene 127 filas, necesita 128».

Las dos salidas que plantea: hacer el normalizador alcanzable, o borrarlo y rechazar el grid con
un error propio antes de `computeTileEdges`.

## Corrección de premisa (crítico, 2026-08-23)

Veredicto: **REENCUADRADA**. Ver `critica.md`. **No era una duda**: la doctrina la decide sola.

**El issue describe mal el fallo.** Verificado ejecutando `validateScene` contra cargas reales: un
tile con `terrain` de 127 filas, o con una fila corta, **NO revienta** — devuelve
`ok=false, errors=["un tile no lleva size/terrain completos…"]`, el error accionable que ya existe,
de `prepareTileBase`. El 500 **solo** se alcanza si el cuerpo trae `__expanded: true`, que es el
marcador interno de idempotencia del expander, no un campo del contrato del modelo. Y el pre-flight
de `narrative_respond` no puede producirlo, porque el zod rechaza `terrain` en un tile.
**La única puerta viva es la tool MCP `scene_validate`**, que postea JSON arbitrario sin zod.

**Tampoco es cierto que el normalizador sea inalcanzable**: `normalizeGrid` corre dentro de
`openTile`, que es lo *primero* que hace `validateScene`; `computeTileEdges` es la sexta pasada. Lo
inalcanzable es su **tolerancia**.

**Y ahí está lo que el issue no ve: hay DOS grids.** Las pasadas leen `view.grid` (normalizado) y
`computeTileEdges` lee `view.scene.terrain` (crudo). Dos fuentes de verdad del mismo grid.

### La decisión ya está tomada — no se pregunta

De las dos salidas, la 1 («hacer el normalizador alcanzable») es rellenar y recortar el grid del
modelo en silencio: literalmente el `validate_scene_response` que este repositorio **ya retiró por
eso**. Lo dice la cabecera del zod que lo sustituyó (`src/contract/model-io/scene-schema.ts:4-7`):

> «DEGRADABA en silencio (terrain no lista → todo hierba, filas mal → padding…), así que un error de
> forma del modelo nunca volvía al modelo».

Reintroducirlo en el validador de jugabilidad sería deshacer esa decisión en el fichero de al lado.
**Se toma la salida 2**: rechazo con error propio y legible, y `normalizeGrid` se borra entero.

### Alcance corregido, cuatro puntos

a. Rechazar el grid mal formado con error estructurado **antes** de construir la `TileView` — cubre
   también `__expanded:true` sin `terrain`, hoy un `TypeError` dentro del propio `normalizeGrid`
   (cuarto camino a 500 que el issue no menciona).
b. `computeTileEdges` debe leer el **mismo** grid que las demás pasadas.
c. `validateScene` no puede lanzar hacia `bridge/state-http-server.ts:282` **ni** hacia
   `src/narrative/narrative-state.ts:358` — el segundo call site existe, confirmado; hoy no está
   vivo (los cuatro llamadores pasan escena ya expandida), pero es la misma mina sin espoleta.
d. Al borrar `normalizeGrid`, corregir el reclamo del helper `tileExpandido`
   (`test/fixtures/scene-validate-corpus.ts:52`), que **promete** cubrir filas cortas, largas y de
   sobra y **no cubre ninguna**: se usa en un solo caso, con un grid perfecto de 128×128. La
   tolerancia tiene cero cobertura y no puede ponerse roja.

**Dato para el arquitecto**: las dos reglas de fail-loud de `arch-rules.json` hablan de errores
*tragados*, no de throws que cruzan una frontera HTTP. **Este invariante no tiene candado hoy.**

**Nota caducada**: el comentario que justifica el normalizador espeja «el saneador de ai_server»,
que hoy hace `data.pop("terrain", None)` para los tiles — no rellena filas, borra el campo.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- `POST /scene/validate` **no puede** responder 500 por una escena mal formada: eso es error del
  cliente, no del servidor.
- El motor recibe un error que le permite corregir («tu grid tiene 127 filas, necesita 128»).
- Si se borra el normalizador, se borra entero y sus tests con él, declarando qué se pierde.

## Fuera de alcance

Cambiar el contrato de escena o el tamaño de tile. El guardia de deriva del contrato es #203.

## Veredicto del crítico

**REENCUADRADA**, salida 2. Ver `critica.md`. **Sin preguntas para el usuario**: no era una duda,
era una decisión ya tomada que este código no había aplicado.
