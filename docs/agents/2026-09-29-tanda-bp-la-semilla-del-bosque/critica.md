**REENCUADRADA**: ni (a) ni (b) tal cual. Un tile tiene dos `seed?` hermanos con dos tipos distintos. La salida es **un solo tipo, entero**, el que ya tiene `scatter_zones.seed`. Nada de unión `string|number`.

## El problema real, en una frase

En el mismo tile el motor escribe dos campos `seed?` que se llaman igual. Uno es número (`scatter_zones`) y el otro es cadena (`vegetation_zones`), y la prosa no dice el tipo de ninguno. El motor los escribe iguales y se come un rechazo.

## La premisa, afirmación por afirmación

- **«4 de 4 motores lo escriben como número»**: cierto. En `labs/narrative/runs/tanda-bm-20260929/` hay rechazos `vegetation_zones[0].seed: Expected string, received number` en `logs/motor-{A,B}.ndjson` y en `fase4/logs/motor-{A,B}.ndjson`, unos por `scene_validate` y otros con `_meta.nefan/rechazo: forma_escena`. Los mismos motores escriben `scatter_zones[].seed` como número y el contrato se lo acepta (`tiles-A.json`: `"seed": 21, 22, 23…`). Por eso el motor no se equivoca por capricho: lo aprende del campo de al lado.
- **«El zod lo rechaza»**: cierto, en `nefan-core/src/scene/blueprint/vegetation.ts:130` (`z.string().min(1).max(64).optional()`).
- **«La prosa no dice el tipo»**: cierto, y le pasa a los dos campos: `tile_instructions.md:254` (`"seed"?`) y `:308` (`seed? }]`).
- **Afirmación implícita: «(a) incluye decirlo en el schema del tool»**: eso **ya está hecho y no sirvió**. `generate_scene.json` → `input_schema.properties.vegetation_zones.description` ya dice `seed?: string to reshuffle the same zone`. Ese texto aparece **0 veces** en `logs/motor-A.ndjson` y en `fase4/logs/motor-A.ndjson`, y la prosa de `tile_instructions.md` («SPECIMENS PER m²») aparece 5 y 7 veces. El motor MCP no ve el JSON del tool, solo la prosa. Decirlo en el JSON no ataca el problema.
- **«El seed entra en la clave de determinismo del scatter»**: sí, pero **no en ninguna clave de caché de arte**.
  - Vegetación: `derive.ts:207`, `seededRng(\`${raw.seed ?? "tile"}:veg:${zi}:${fnv1a(zone.seed ?? zone.type)}\`)`. El seed solo decide las posiciones de los ejemplares.
  - Scatter: `scatter.ts:507`, `seededRng(\`${seedKey}:scatter:${zi}:${zone.seed ?? 0}\`)`, con el seed validado como número 0..1e9 en `scatter.ts:189` (`num()`, sin exigir entero).
  - Ningún fichero que menciona `vegetation` construye un hash de caché: un grep de `cache|hash` sobre esos ficheros sale vacío. Cambiar el tipo no repaga arte.
- **«Tendría que pasar por el espejo Python»**: no hace falta. `ai_server/narrative_schemas.py:990-1016` valida `type`, `area` y `density` de cada zona y **no mira `seed`**: lo pasa tal cual. Ahí no hay nada que cambiar.
- **«¿Tiene sentido un entero?»**: sí. Un seed es por naturaleza un número, y el contrato hermano ya lo trata así. `fnv1a` se come cualquier cadena, así que `String(n)` basta. Ningún consumidor usa el seed de zona como texto: **no hay ni un test, ni una fixture (`data/scenes/*.json`) ni un guion que ponga `zone.seed`** en vegetación. Hoy es un campo que nadie ejerce.

## El día después

- **Para quien juega**: el tile llega una vuelta antes. El bosque de un tile sin `seed` es **idéntico bit a bit**, porque `zone.seed ?? zone.type` no cambia con `seed` ausente, así que los saves y los snapshots no se mueven.
- **Qué se vuelve más difícil**: pedir un bosque con un seed legible («claro_sur»). Nadie lo hace, y `type` ya aporta el texto del hash.
- **Qué desaparece**: la trampa de dos tipos para una misma palabra en el mismo mensaje. Nada queda por borrar después.
- **Qué NO debe hacerse**:
  - Una unión `string|number`: son dos formas para un campo, y la prosa tendría que explicar las dos.
  - Coercionar el número a cadena en el pre-flight: sería sanear, y va contra «Fail-loud al modelo».
  - Tocar solo el JSON del tool: el motor no lo lee.

## Conflictos

- **Issues abiertos**: `gh issue list` no trae nada sobre seed, vegetation o scatter.
- **CLAUDE.md**: «cero compatibilidad» ampara cambiar el tipo sin rama legacy.
- **`contract-prompts.test.ts:170-190`**: declara adrede que `vegetation_zones` se describe en PROSA y que no hay guardia zod→JSON en ese nivel. No choca, pero el texto del JSON hay que editarlo a mano.
- **Mutación**: `vegetation.ts` y `derive.ts` están en `mutation-targets.json` (≈l.404-416). Hoy ningún test ejerce `zone.seed`, así que un mutante sobre `zone.seed ?? zone.type` vive. Los tests del plan lo cierran de paso.

## Coste contra valor

- **Coste**: una línea del zod, una de `derive.ts`, dos frases de prosa, una del JSON y tests.
- **Valor**: una vuelta al motor por tile con bosque, en el 100 % de los motores medidos.
- **Si no se hace nunca**: cada tile con `vegetation_zones` y `seed` paga un rechazo, y a veces el motor quita la zona entera en vez de corregirla. Vale lo que cuesta.

## Qué le cambiaría a `requisitos.md` (para pegar)

> Salida elegida (crítico): **el `seed` de `vegetation_zones` pasa a ser un ENTERO ≥ 0, con el mismo rango que `scatter_zones.seed` (0..1e9)**. No es una unión con cadena, no hay coerción y no hay rama legacy. La prosa de `tile_instructions.md` dice el tipo en los DOS `seed?` del tile, y el JSON del tool se alinea. El espejo Python no se toca porque no lee `seed`. Ninguna clave de caché de arte depende del seed, y un bosque sin seed sale idéntico al de hoy.

## PLAN para el ingeniero (no hace falta arquitecto: solo toca el contrato del seed)

**Ficheros**
1. `nefan-core/src/scene/blueprint/vegetation.ts:130`: `seed: z.number().int().min(0).max(1e9).optional()`, con un comentario de una línea: mismo tipo y rango que `scatter_zones.seed` (`scatter.ts:189`). Si se quiere que el rechazo enseñe, se le puede poner un mensaje propio al `.int()`/`number`, por ejemplo «seed es un entero ≥ 0, como el de scatter_zones».
2. `nefan-core/src/scene/blueprint/derive.ts:207`: `fnv1a(zone.seed === undefined ? zone.type : String(zone.seed))`. La rama `undefined` **debe** seguir siendo `zone.type` literal para que los bosques sin seed no cambien.
3. `nefan-core/data/contract/prompts/tile_instructions.md:254` → `"seed"?: integer ≥ 0 (reshuffles the same zone)`, y `:308` → `seed?: integer ≥ 0`.
4. `nefan-core/data/contract/tools/generate_scene.json`: en la description de `vegetation_zones`, `seed?: string to reshuffle…` → `seed?: integer ≥ 0 to reshuffle…`. En `scatter_zones`, `seed?` → `seed?: integer ≥ 0`.
5. `ai_server/narrative_schemas.py`: **nada**. Se comprueba con un grep que sigue sin leer `seed`.
6. Si el ingeniero compila narrative-mcp con dist, lo recompila para que el motor lea la prosa nueva.

**Tests** (en `test/derive-vegetation.test.ts` y el de contrato que ya guarda la prosa)
- `parseVegetationZones` **acepta** `seed: 7` y `seed: 0`.
- **Prueba en negativo**: **rechaza** `seed: "claro"`, `seed: 1.5`, `seed: -1` y `seed: 1e10`, y el mensaje nombra `vegetation_zones[i].seed`. El test se pone rojo si se revierte el zod a `z.string()`: comprobarlo a mano una vez y decirlo en `implementacion.md`.
- **El seed manda**: la misma zona y el mismo tile con `seed: 1` y con `seed: 2` dan posiciones distintas, y con el mismo seed dan posiciones idénticas. Hoy no existe y mata el mutante sobre `zone.seed`.
- **Sin seed no cambia nada**: un golden de las posiciones de un bosque sin `seed` capturado ANTES del cambio (ids y `at` de los N primeros ejemplares) y comparado después. Es la prueba de que la rama `undefined` es la de hoy.
- `contract-prompts.test.ts`: aserto de que `tile_instructions.md` dice el tipo en ambos seed, por ejemplo con un regex `seed"?\??:\s*integer` que aparezca dos veces. Negativo: volver a poner `"seed"?` a pelo lo pone rojo.

**Verificación**
- `npm run verify`.
- `npm run mutacion -- local <módulo de vegetation/derive>` si cabe en el tope; si no, pedirla.
- Guion de QA, del rango 290–299: un tile Format D con `vegetation_zones[0].seed: 3` pasa `scene_validate` sin error, y con `"3"` falla nombrando el campo.
