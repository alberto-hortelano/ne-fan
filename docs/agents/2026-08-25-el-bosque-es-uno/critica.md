# Crítica — El bosque es uno solo y colisiona igual para todos

**#243 REENCUADRADA · #233 REENCUADRADA · #232 REENCUADRADA.** Los tres viven, los tres son MÁS
grandes de lo que dicen, y sí: son un solo sujeto. Todo medido hoy sobre `c007e60`.

**Problema real, en una frase:** una entity estática del esquema y su volumen del plan son dos
representaciones del mismo objeto que nadie reconcilia — el cliente pinta las dos, solo el volumen
colisiona y el bridge no ve ninguna; la vegetación de masa multiplica el desajuste por 15.

## La premisa, afirmación por afirmación

| Afirmación | Verificación de hoy |
|---|---|
| #243 «planta dos veces» | **CIERTO**. `robledo_tile` @0,05: 44 entities `scattered` (`scene-expand.ts:416-428`) vs 3 `derived_veg` (`derive.ts:204`) |
| #243 «solo la primera colisiona» | **CIERTO**. `derive.ts:142` salta las `scattered`; `collision.ts:89-93` apaga los AABB del esquema en tile con plan. **10 de 52** postes caen en celda sólida, y esos 10 por solaparse con un árbol real |
| #243 «~130 postes», «4 de 40» | Número **caducado** (el paliativo bajó a 0,05: son 44); daño **vivo** |
| #243 «15-17×, estructural» | **PEOR**: 29× a 0,30, 52× a 0,60, **79×** a 1,00. La ruta A **satura en 10-11 árboles** por `minSep` 8 celdas + `attempts` 12×, no por el divisor 22 |
| #243 «eran la representación 2D/Godot» | **CIERTO y sin sujeto**: los dos clientes murieron en agosto |
| #243 salida 2 «sería un muro» | **CIERTO a la densidad de anteayer**: 131 postes × (0,5 + 2·0,4 de radio) = 74 % de la zona. A 0,05, 25 % |
| #233 «density = dos cosas» | **TRES**: fracción de celdas (B), `área·d/22` tope 48 (A) y **elementos/m²** en `scatter_zones` (`scatter.ts:168`) — otro campo, misma palabra, mismo tool |
| #233 «duplicación de la composición» | **CIERTO** (`main.ts:723-767` vs `style-apply.ts:216-248`) pero **hoy no diverge**: claves del snapshot y `scene_id` coinciden (`tile_0_0`), mismo seed, **mismas celdas de atlas**. Latente; su divergencia ya observable es **#234** |
| #232 «el bridge no deriva» | **CIERTO** (`sim-collision.ts:61-68`: solo `scene_data.volumes`) |
| #232 «los NPCs atraviesan los árboles» | **ES EL 2 %**: plan del cliente 1.580 celdas sólidas, del bridge 960; de las **620** de diferencia, **566 son EDIFICIOS**, 43 árboles (11 de vegetación), 11 props |
| §5 «se persiste en el save» | **Está commiteado**: `data/games/cuentos_oscuros/world/tile.json` = **1.049 postes de 1.052 entities**; `alta_fantasia`, 480 de 491 |
| §6 «¿claves de caché?» | **NO. Cero euros** (con y sin `scattered`: mismos 26 volúmenes, **mismas 11 identidades de celda**; las entities no entran en `buildFpsTileSpec`) |

Dos hallazgos que ningún issue trae y que cambian el alcance:

- **La doble representación no es de la vegetación, es de todo.** `formatDToWorld:210-220` emite las
  30 entities como `objects` y `fps-gl.ts:1377-1381` las pinta todas salvo los `building`: los 8
  árboles declarados de la fixture llevan un poste de 1×4×1 m dentro de su copa; los 7 `prop`, igual.
- **El canal para masa visual sin colisión ya existe**: `scatter_zones`+`scatter_generators`, que
  tampoco aparece en `collision.ts`. La ruta B lo duplica, pero con postes de 4 m.

## El día después (ruta B retirada + derivación unificada en core)

- **Quien juega**: se van 44 postes atravesables en la fixture y ~1.000 en los mundos base; el
  retículo deja de encenderse sobre 44 «pino» que no son nada (`main.ts:1430`); los NPCs dejan de
  meterse dentro de las casas.
- **Se vuelve más difícil**: el motor pierde el dial de masa densa por celda; le quedan
  `scatter_zones` (tope 240/tile) y una ruta A que hoy no pasa de ~11 árboles por zona.
- **Habría que borrar y nadie borrará**: el backstop `/_z\d+_\d+$/` de `isScatterEntity`
  (`derive.ts:60`, «para saves ya guardados» — pre-producción, se va entero), el campo `scattered`,
  media frase de `generate_scene.json:101` y su gemela `tile_instructions.md:207`, y
  `MAX_ENTITY_VOLUMES = 80`, que solo existe porque «derivar cientos de trees colgaba el cliente».
- **Se puede tirar**: los dos snapshots adelgazan a ~5 % (324 KB y 344 KB) y el renderer deja de
  instanciar ~1.000 entidades por tile. **No cambia** lo que ve el motor: las entities de escena no
  entran en su contexto (`serialize-llm.ts:53` acota `state.entities`, otra lista).
- **Arbitrario en un mes**: que `density` sea fracción de celdas en un campo y elementos/m² en el de
  al lado. Si esta tanda no lo unifica, lo hereda la siguiente.

## Conflictos

- **Tanda «Reanudar» (#245 #249)**: comparten `nefan-html/src/main.ts` (ellos `runTitleFlow` /
  `save_session`, yo `composeTilePlan` / `addTile`) → choque de merge, no de diseño: **secuenciar,
  cualquiera primero**. Sinergia: #245 aparece en (0,0,0) *dentro de la taberna*, y con la
  derivación en el bridge el snapshot de posición cae del lado que conoce esa huella.
- **Tanda «Candados» (#231 #248 #247)**: comparten `arch-rules.json` (aquí hay que añadir
  `scattered` a `campos-retirados-no-vuelven`): una línea. **#231 conviene ANTES** — esta tanda toca
  tests de core y hoy `tsc` no los mira.
- **#234 es la mitad «duplicación» de #233 ya materializada**: aparte se paga dos veces el mismo
  refactor → **fundirlo aquí o cerrarlo desde aquí**. **#203**: se edita justo la descripción de
  `generate_scene.json` que nada canda; la prosa nueva nace sin guardia (no bloquea). **#259**:
  mientras `EntitySchema` sea `.passthrough()`, un `scattered` reemitido pasa mudo, y la regla de
  `arch-rules.json` es el único candado disponible.
- Sin conflicto con `solo-el-bridge-normaliza-la-escena`: admite `max: 2` llamadas a
  `formatDToWorld` en el cliente, hoy hay 2, y unificar no las sube.

## Coste contra valor

Retirar la ruta B es **borrar**: ~40 líneas de `scene-expand.ts`, un campo, un backstop, media frase
de contrato, dos snapshots regenerados. Cero euros. El riesgo está en unificar la derivación: tres
call sites (`main.ts:723`, `style-apply.ts:216` y la que le falta al bridge) sincronizados hoy por
un comentario que dice «MISMO plan que compone la partida». El seed debe seguir siendo el
`scene_id`, que en tiles reales ES el `tileKey`; la única fixture donde no coinciden es
`robledo_tile` (`robledo_tile` vs `tile_0_0`), y rotarlo repaga solo su atlas de fixture.
**No hacer nada** no es defendible en #232 (los NPCs entran en las casas) ni en #243 (se atraviesa
un bosque visible); sí lo sería en la mitad latente de #233, que muere gratis con lo demás.

## PARA EL USUARIO (dirección de producto — la cola no se para)

El freno de `requisitos.md` **no se dispara**, y lo argumento para que puedas contradecirme: la
capacidad «bosque denso» no se pierde, cambia de canal — lo que hoy la da son postes pelados que se
atraviesan, y el canal sancionado para masa visual sin colisión (`scatter_zones`) ya existe. Lo que
sí es tuyo: **la ruta A satura en ~11 árboles por zona pase lo que pase con `density`**. Si quieres
pinares que frenen de verdad hay que subir ese techo (`minSep` 8, divisor 22, tope 48), y eso cambia
cómo se anda por un bosque. Si no se toca, los bosques serán arboledas ralas con detalle visual.

## Qué le cambiaría a `requisitos.md`

Criterio de terminado: «Un bosque en el que todo lo que se ve se comporta igual —o frena o se
atraviesa, sin dos especies conviviendo— **y un solo camino desde el esquema hasta la huella
colisionable, compartido por cliente, bridge y pre-generación**. `density`, un significado por
campo, candado. Verificable jugando». Y a la lectura: el sujeto no es la vegetación, es la doble
representación entity↔volumen; la vegetación es su caso más ruidoso.

## Texto para pegar (`gh api -X PATCH`, al final del cuerpo)

**#243** — «**Revisado 2026-08-25 (c007e60).** Premisa viva, medidas actualizadas: con la fixture
commiteada (0,05) son **44** postes y **3** árboles de blueprint, no 131/8, y el cociente empeora con
la densidad (29× a 0,30, **79×** a 1,00) porque la ruta A **satura en 10-11 árboles** (`minSep` 8
celdas), no por el divisor 22. **El sujeto es mayor que la vegetación**: TODA entity estática se
pinta dos veces —volumen del plan (colisiona) y objeto de la world scene (no)—; los 8 árboles
declarados de la fixture llevan un poste de 1×4×1 m dentro de su copa, y los 7 props igual. Y no es
solo la fixture: `data/games/cuentos_oscuros/world/tile.json` trae **1.049 postes de 1.052
entities**; `alta_fantasia`, 480 de 491. **Salida 1 confirmada como la del dominio**: la
representación 2D/Godot no tiene sujeto desde agosto, el canal para masa visual sin colisión ya
existe (`scatter_zones`) y retirarla **no toca ninguna clave de caché de imagen** (medido: mismos 26
volúmenes, mismas 11 celdas de atlas). Salida 2 descartada: a la densidad de anteayer bloqueaba el
74 % de la zona.»

**#233** — «**Revisado 2026-08-25 (c007e60).** `density` no significa dos cosas sino **tres**, y la
tercera está en el mismo tool: `scatter_zones[].density` son **elementos/m²** (`scatter.ts:168`).
Y falta el dato que decide el alcance: **alinear unidades no basta**, porque la ruta A no puede
alcanzar la densidad que nombre (satura en 10-11 árboles por zona con `minSep` 8 y `attempts` 12×,
medido de 0,05 a 1,00). La mitad «duplicación» **no diverge hoy** (mismas claves, mismo seed, mismas
celdas de atlas): es latente, y su divergencia ya observable es **#234**, que debería cerrarse con
el mismo cambio.»

**#232** — «**Revisado 2026-08-25 (c007e60).** El agujero es mayor que los árboles: en
`robledo_tile`, plan del cliente **1.580** celdas sólidas y plan del bridge **960**; de las 620 de
diferencia, **566 son EDIFICIOS**, 43 árboles (11 de vegetación derivada) y 11 props. El bridge no
ve **ningún** volumen derivado, así que en un tile sin `volumes` declarados —la fixture y los
snapshots pre-generados— los NPCs atraviesan las casas. La salida 2 («la derivación viaja resuelta»)
**es alcanzable en esta tanda**: hoy hay **tres** copias de la misma composición (`main.ts:723`,
`style-apply.ts:216` y la que le falta al bridge) sincronizadas por un comentario. Unificarlas en la
normalización de core cierra este issue, la mitad latente de #233 y #234 de una vez, sin subir el
`max: 2` de `solo-el-bridge-normaliza-la-escena`.»
