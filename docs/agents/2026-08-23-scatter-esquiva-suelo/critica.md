# REENCUADRADA — el problema es real y está medido; el alcance y la evidencia que pide, no

## El problema real, en una frase

Las DOS rutas del mismo campo `vegetation_zones` discrepan: la del grid esquiva caminos y agua, la
del blueprint no las mira siquiera — y el contrato le promete al motor la conducta de una sola. Eso
es más que «un árbol en el río»: la vegetación derivada no es decorado, **colisiona**
(`collision.ts:271-275` estampa un disco de tronco de radio ≥0,9 celdas por cada `tree`), así que un
árbol derivado sobre el camino real deja ~1 m de calzada bloqueada.

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificación |
|---|---|
| El `nearBand` colgaba de `terrain_features` y se fue con la poda | **CIERTA.** `git show d23e457 -- nefan-core/src/scene/blueprint/derive.ts` borra `RawFeature`, el campo y la línea `if (nearBand(u, v)) continue;` del bucle de zonas |
| No es una regresión: nunca estuvo viva por esa vía | **CIERTA** para `terrain_features`, que el saneador vaciaba. Pero `vegetation_zones` **sí sobrevive** al saneador (`ai_server/narrative_schemas.py:723-741`) y llega al cliente en `__format_d` (`scene-normalize.ts:268`): la ruta que hay que arreglar está alimentada hoy |
| `buildScatterExclusions` es la regla viva anclada a `ground` | **CIERTA** (`scatter.ts:451-490`); la consumen `fps-spec.ts:248` y `fps-relief.ts:105` |
| `ground` ya está parseado en la línea anterior en los dos call sites | **CIERTA**: `nefan-html/src/main.ts:720-726` y `nefan-html/src/ui/style-apply.ts:171-175` |
| ¿Quién lo consume en producción? ¿Lo ve quien juega? | **SÍ.** `main.ts:739` (`composeTilePlan`) alimenta a la vez `fpsRenderer.installTile` (`main.ts:825`) y `applyPlanCollision` (`main.ts:839` → `planCollisionGrid` → `volumeCollisionGrid`). Segundo consumidor: `style-apply.ts:182`, que paga arte con las celdas resultantes |
| Segundo orden: además excluyen el detalle fps del camino | **FALSA en lo esencial.** Los árboles derivados sí entran como `volumes` en `buildScatterExclusions` (`fps-spec.ts:248`), pero esa función **ya excluye la banda entera del path** (`w/2 + 0.5`) y toda el agua/deck del `ground`, haya árbol o no. Lo único que añade un árbol caído ahí es su anillo (huella 1,2·s ≈ 1,1 celdas) sobre el arcén |

**Daño medido** (reproducido con `deriveVolumesFromSchema` sobre `robledo_tile` + una zona
`{type:"pino", area:"rest", density:0.5}`): 56 volúmenes tree/bush derivados, **3 dentro de la
banda del camino real** (`ground` `camino_real`, `w:4`, y=63,5). Repetido con cinco `scene_id`
distintos: 10 árboles sobre el camino y 9 en la franja del río. Es real y es reproducible.

**Y la corrección que el issue no ve:** `robledo_tile.json` declara **cero `vegetation_zones`** (hoy
no deriva ni un árbol) y su río **no es un rasgo `ground`** — es un bloque `terrain_patches` de
`'w'` en `[84,0]` de 8×60 con leyenda `"agua del río Negro"` (`data/scenes/robledo_tile.json:14`);
su `ground` solo tiene `path` y `area`. Delegar en `buildScatterExclusions(volumes, ground)` vería
**la lista de agua vacía** ahí y no protegería el río de nada: el criterio «el río de robledo_tile
sin árboles encima» no se cumple ni antes ni después. La ruta B no tiene ese agujero porque no se
ancla en `ground`: mira el **grid** (`scene-expand.ts:390-397` — salta muros, `'w'`, todo char que
no sea el del bioma y un margen de 1 celda alrededor de sendas), y el grid lleva rasterizados tanto
el `ground` como los `terrain_patches`: anclar la ruta A solo en `ground` cubre estrictamente menos.

## El día después

- **Para quien juega**: se acaban los troncos invisibles en mitad de la calzada y los árboles
  flotando sobre el agua. Con una zona de densidad media, tres de cada 56.
- **Qué se vuelve más difícil**: nada de peso. `DeriveInput` gana un campo opcional, los dos call
  sites ya tienen el dato, y no queda nada muerto que borrar.
- **Qué parecerá arbitrario en un mes**: que la ruta A esquive el `ground` y la B el grid, cubriendo
  conjuntos distintos, sin que nada lo diga. Si el arreglo se ancla en `ground`, el comentario tiene
  que nombrar qué queda fuera (`terrain_patches`), o el siguiente creerá que hacen lo mismo.

## Conflictos

- **Contra el contrato, a favor**: `generate_scene.json:101` promete que `vegetation_zones`
  «automatically avoids paths, water, buildings and occupied cells». Hoy es media verdad; el
  arreglo cierra la mitad falsa, pero no la cierra entera si solo mira `ground`.
- **`campos-retirados-no-vuelven`** (`arch-rules.json:352`) canda `terrain_features`: el arreglo no
  puede resucitarlo — anclarse en `ground` cumple.
- **#187** (huella de `gate` disjunta de su colisión) toca el mismo par huella/colisión pero otra
  función: sin solapamiento ni orden forzado. Ningún otro issue abierto pisa esto.
- **Mutación**: cae en `blueprint-derive` (`break: 59`, batería `test/derive-vegetation.test.ts`) —
  el candado que pide el issue va justo en el módulo que ya mide este fichero.
- **Divergencia colateral, NO de este issue**: el bridge no llama a `deriveVolumesFromSchema`
  (`sim-collision.ts:66` colisiona solo con los declarados), así que ese tronco bloquea al jugador
  y no al NPC. Issue aparte; anotarlo, no arreglarlo aquí.

## Coste contra valor

Un campo opcional y una llamada a un predicado que ya existe, en un solo bucle. Contra eso: un fallo
con colisión, reproducible, en el camino principal de todo tile con carretera, en la única vista
viva. No hacer nada es sostenible (3 de 56, y el motor puede no declarar zonas), pero el contrato ya
promete lo contrario: la alternativa honesta sería retirar la promesa — más cara y peor. Se hace.

## Qué le cambiarías a `requisitos.md` — redactado para pegarse

> **Alcance, acotado.** La exclusión entra SOLO en el bucle de `vegetation_zones` de
> `deriveVolumesFromSchema` — donde vivía el `nearBand` borrado. **No** se aplica a los volúmenes
> derivados de `structures` ni de `entities`: esos los coloca el motor a mano (un pozo en la plaza,
> un prop sobre un deck), y filtrarlos por `ground` los borraría en silencio, convirtiendo un
> arreglo de scatter en una pérdida de geometría declarada.
>
> **Cobertura, declarada.** Anclarse en `ground` cubre el agua y los caminos declarados como
> rasgos, y deja fuera el agua declarada como `terrain_patches` (chars `'w'` del grid) — que es como
> la declara la única fixture del repo. La ruta B mira el grid ya rasterizado y no tiene ese
> agujero. Cuál de las dos fuentes se usa es del arquitecto; lo que no se admite es dejarlo sin
> decir: el comentario del código debe nombrar qué queda fuera.
>
> **Fuera: el efecto de segundo orden.** Retirar la frase «además excluyen el detalle fps del
> camino». Comprobado y es falso: `buildScatterExclusions` ya excluye la banda entera del path y
> toda el agua del `ground` haya árbol o no; lo único que añade uno caído ahí es su anillo sobre el
> arcén.
>
> **Criterios de aceptación, corregidos.**
> - Test en `derive-vegetation.test.ts` que pase `ground` con un `path` y falle hoy: sigue siendo el
>   candado, y sigue siendo cierto que hoy no se puede escribir. Número de referencia: `robledo_tile`
>   + `{type:"pino", area:"rest", density:0.5}` deriva 56 tree/bush, **3 dentro de la banda del
>   `camino_real`** (`w:4`, y=63,5); después del arreglo, cero.
> - **Evidencia visual: el CAMINO REAL de `robledo_tile` sin árboles encima, no el río.** La fixture
>   declara cero `vegetation_zones` y su río es un bloque `terrain_patches`, no un rasgo `ground`:
>   hoy no hay ni un árbol derivado ahí y la exclusión propuesta no lo vería. Obtener la evidencia
>   exige añadirle una zona de vegetación (a esa fixture o a una nueva) y mirarla con
>   `html-fixtures`.
>
> **Anotar, no arreglar:** el bridge no deriva volúmenes (`sim-collision.ts:66` usa solo los
> declarados), así que un árbol derivado bloquea al jugador y no al NPC. Issue aparte.
