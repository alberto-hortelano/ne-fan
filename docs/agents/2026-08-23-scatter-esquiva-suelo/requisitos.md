# El scatter derivado esquiva caminos y ríos (#174)

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

## El issue

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/174`.

Resumen: `deriveVolumesFromSchema` (`nefan-core/src/scene/blueprint/derive.ts`) tenía una banda
de exclusión que colgaba del campo retirado `terrain_features`, **que el saneador de `ai_server`
reescribía a `[]` en cada escena** — la exclusión existía en el código y no excluía nada. Al
podar el campo muerto se fue con ella. El issue insiste en que **no es una regresión**: es una
capacidad que nunca llegó a estar viva por esa vía.

La misma regla sí está viva en el otro pipeline: `buildScatterExclusions(volumes, ground)`
(`src/scene/blueprint/scatter.ts`), anclada a `ground`, que es la fuente viva. El issue propone
añadir `ground?: GroundFeature[]` a `DeriveInput` y delegar; afirma que en los dos call sites
(`nefan-html/src/main.ts`, `nefan-html/src/ui/style-apply.ts`) `ground` ya está parseado en la
línea inmediatamente anterior.

## Lo que hay que verificar, no dar por bueno

- ¿Quién consume hoy `deriveVolumesFromSchema` en producción, y llega a verlo quien juega? Si
  la respuesta es «nadie», la tarea cambia de naturaleza.
- ~~El efecto de segundo orden~~ — **RETIRADO por el crítico: es falso.** `buildScatterExclusions`
  ya excluye la banda entera del path y toda el agua del `ground` haya árbol o no; lo único que
  añade un árbol caído ahí es su anillo sobre el arcén.
- `ground` está parseado en ambos call sites: **verificado** (`nefan-html/src/main.ts:720-726`,
  `nefan-html/src/ui/style-apply.ts:171-175`).

## Criterios de aceptación — REENCUADRADOS por el crítico (2026-08-23)

Ver `critica.md`. Veredicto: **REENCUADRADA**. El problema es real y está **medido**; el alcance y
la evidencia que pedía el issue, no.

**El daño real no es decorativo: colisiona.** `src/scene/blueprint/collision.ts:271-275` estampa un
disco de tronco de radio ≥0,9 celdas por cada `tree` derivado, así que un árbol sobre el camino real
deja ~1 m de calzada bloqueada.

**Medido**: `robledo_tile` + `{type:"pino", area:"rest", density:0.5}` deriva 56 volúmenes tree/bush
y **3 caen dentro de la banda del `camino_real`** (`w:4`, y=63,5). Con cinco `scene_id` distintos:
10 sobre el camino, 9 en la franja del río.

- Test en `derive-vegetation.test.ts` que pase `ground` con un `path` y **falle hoy** — sigue siendo
  el candado, y sigue siendo cierto que hoy no se puede escribir. Después del arreglo: cero de 56.
- **Evidencia visual: el CAMINO REAL de `robledo_tile`, no el río.** La fixture declara **cero
  `vegetation_zones`** y su río es un bloque `terrain_patches` de `'w'`, **no un rasgo `ground`**:
  hoy no hay ni un árbol derivado ahí y la exclusión propuesta no lo vería. El criterio que yo había
  escrito («el río sin árboles encima») **no se cumple ni antes ni después del arreglo**. Obtener la
  evidencia exige añadir una zona de vegetación a esa fixture o a una nueva, y mirarla con
  `html-fixtures`.

### Alcance, acotado

La exclusión entra **SOLO** en el bucle de `vegetation_zones` de `deriveVolumesFromSchema` — donde
vivía el `nearBand` borrado. **No** se aplica a los volúmenes derivados de `structures` ni de
`entities`: esos los coloca el motor a mano (un pozo en la plaza, un prop sobre un deck), y
filtrarlos por `ground` los borraría en silencio, convirtiendo un arreglo de scatter en una pérdida
de geometría declarada.

### Cobertura, declarada

Anclarse en `ground` cubre el agua y los caminos declarados como **rasgos**, y deja fuera el agua
declarada como `terrain_patches` (chars `'w'` del grid) — que es como la declara la única fixture
del repo. La otra ruta (`scene-expand.ts:390-397`) mira el **grid ya rasterizado** y no tiene ese
agujero. **Cuál de las dos fuentes se usa es del arquitecto**; lo que no se admite es dejarlo sin
decir: el comentario del código debe nombrar qué queda fuera.

### Anotado, no se arregla aquí

El bridge **no** deriva volúmenes (`bridge/sim-collision.ts:66` colisiona solo con los declarados),
así que un árbol derivado bloquea al jugador y **no** al NPC. Issue aparte.

## Fuera de alcance

Reescribir el scatter de fps, que ya hace lo correcto. Cualquier cambio en el contrato de
`ground`.

## Veredicto del crítico

**REENCUADRADA.** Ver `critica.md`. Sin decisiones de producto pendientes.
