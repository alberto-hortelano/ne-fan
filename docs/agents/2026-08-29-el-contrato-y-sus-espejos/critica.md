# REENCUADRADA — el troceo está mal, un criterio nace verde y #237 valida dos poblaciones distintas

| Issue | Veredicto | En una línea |
|---|---|---|
| **#319** | **REENCUADRADA · EN CONFLICTO** | El criterio 1 ya está VERDE para 5 de 7 campos; el hueco real son **2**. Y es otro contrato: va con **#318**, no con estos tres |
| **#203** | **VIGENTE con alcance corregido** | Los 2 campos son exactos. El listado inverso son **87 rutas**, y las 87 caen dentro de la prosa que §5 prohíbe tocar |
| **#237** | **REENCUADRADA** | La divergencia es real y verificada. Pero los dos validadores **no vigilan la misma población**, y eso cambia la pregunta |
| **#259** | **VIGENTE — y ENTRA** | Medido: el `.passthrough()` de entity sostiene **cero** tráfico legítimo. La cláusula de escape no se activa |

## El problema real, en una frase

`generate_scene.json` es el único artefacto de contrato **escrito a mano y fuera del codegen**, y de él cuelgan cuatro consumidores que nadie compara — no que «el zod no sea la fuente de verdad».

## La premisa, afirmación por afirmación

| Afirmación del §2/§3 | Verificación |
|---|---|
| «Python carga el JSON como fuente de verdad, no el zod» (`narrative_schemas.py:44`) | **CIERTA pero engañosa.** Python hace `_tool()` **tres** veces: `:44` generate_scene, `:812` weapon_orient, `:895` narrative_react. Los **dos últimos los GENERA el zod** (`schemas.ts:189-211`) y los canda `contract-model-io.test.ts:44`. Consumir el JSON derivado es el diseño **correcto**, y ya funciona en 2 de 3. El defecto no es Python: es que `generate_scene.json` no es derivado |
| «Hay cuatro espejos» | **Son cinco.** Falta el que más muerde: los vocabularios a mano de `narrative_schemas.py` (`RESERVED_TERRAIN:47`, `VALID_ENTITY_KINDS:53`, `GROUND_KINDS:87`, `VOLUME_TYPES:95`) y la allow-list de `validate_scene_response:460`. Ese —no `GENERATE_SCENE_TOOL`— es el espejo de #237 |
| «Si el JSON es la fuente legítima, la tanda está mal planteada» | **No lo está.** El zod sí manda; el agujero es un artefacto huérfano del codegen. La tanda sigue en pie, pero su enunciado debe decir eso |
| #203: «2 campos en el JSON y no en el zod» | **EXACTO.** `scatter_generators`, `scatter_zones`, los dos de nivel superior. `style_ref` de entity ya entró: **`entities[]` casa 12 a 12, sin diferencia** |
| #203: «el listado inverso está inflado» | **Lo estaba, y por más de lo que creías.** No son 6 campos: son **87 rutas**, y **las 87 caen dentro de `ground`/`volumes`/`vegetation_zones`** — los tres bloques que el JSON declara como **prosa** (666 B / 1502 B / 1124 B de `description`, cero `properties`) y que §5 prohíbe tocar. **Cero divergencia real en el inverso** |
| #203: «censo de 3 promesas muertas» | **Caducó: hoy es 1.** `texture_prompt`/`model_prompt` los borró `c007e60` (#199) — grep a cero en los prompts. Solo sobrevive `player_choice` (`ui_systems.md:39`); el kind real es `dialogue_choice` (`llm_client.py:720`) |
| #237: la tabla de dos entradas | **CONFIRMADA ejecutando ambos lados.** zod: `entities.0.description: String must contain at least 1 character(s)` y `size: un tile no lleva 'size'`. Python **ACEPTA las dos** y devuelve la entity sin `description` y la escena sin `size` |
| #237: «las fixtures se eligieron entre las que ya coincidían» | **CIERTA.** Son 6 (`fixtures/scene/`): 4 inválidas de `role`/`tile`/`biome`, 2 válidas. Ninguna toca `description` vacía ni `size` |
| #237: «la vía de API directa no tiene pre-flight» | **CIERTA y viva.** `llm_client.py:311` → `_generate_scene_via_api:474` → `validate_scene_response:504`, sin re-respuesta |
| #259: «8 `.passthrough()` vivos» | **Son 6.** Dos de las 8 líneas del grep son comentarios (`scene-schema.ts:20` y `:156`) |
| #259: «puede estar sosteniendo campos legítimos» | **NO SOSTIENE NINGUNO.** Censadas **76.293 entities** (fixtures, tiles de juego, saves, archivo, labs): ni una clave fuera de las 12, salvo `scattered`, ya **prohibido** por `campos-retirados-no-vuelven` (`architecture.test.ts:352`). La allow-list de Python (`narrative_schemas.py:687-733`) son **las mismas 12, diff = ∅** |
| §5: «la batería es de 39 guiones» | **Son 38** (`qa/guiones/`, falta el 04) |

**Bonus, del tipo «justificación escrita después»**: la cabecera de `scene-schema.ts:20-24` justifica el `.passthrough()` con `exits` y `ambient_event`. Los dos son de nivel **escena**, no de entity — y `exits` **el modelo no lo emite**: Python lo borra (`narrative_schemas.py:798-800`) y el bridge lo inyecta después del gate (`bridge/context.ts:231`). La razón escrita no sostiene el campo que dice sostener.

## El criterio que nace verde (hallazgo de primer orden)

El criterio 1 dice: *«Renombrar un campo en `cache_assets.py` rompe algo. Hoy: no rompe nada en ningún proceso.»* **Falso.** Renombré los 7 campos de la respuesta uno a uno y corrí `python -m unittest discover -s ai_server/tests` (135 tests):

| Campo renombrado | Hoy |
|---|---|
| `api_cache`, `spend`, `config`, `keys`, `config.usd_eur_rate` | **ROJO** — `test_spend_tracker.py:59-84 test_dev_status_shape` |
| `config.surface_model`, `config.sprite_skin_model` | **VERDE** — no rompe nada |

**5 de 7 ya están candados; el hueco son 2 campos**, justo los que ese test no asevera (solo comprueba `body["config"]["usd_eur_rate"] == 0.86`). El criterio, como está escrito, se cierra sin tocar nada. Y hay un segundo hueco que **no** captura: si Python renombra *y actualiza su propio test*, el TS queda obsoleto y sigue sin romperse nada. Eso solo lo caza un test que **lea el contrato TS**.

## El día después

- **#237 vigila dos poblaciones distintas, y eso es el reencuadre.** Pasé el zod por los tiles pre-generados del árbol: **rechaza 20 de 20** (`data/games/*/world/tile.json`), y los motivos son `size` (20×), `terrain` completo (20×) y `style_ref` de escena (18×). O sea: la regla «un tile no lleva `size`» describe lo que el **modelo** emite (pre-expansión); los tiles guardados son **post-expansión** y llevan `size` legítimamente. Python hace `pop("size")` porque su saneador ve las dos poblaciones. **Decidir «cuál de los dos lados tiene razón» sin decidir antes qué población vigila cada uno produce un arreglo que rompe el arranque**, no un contrato alineado. Nadie audita hoy esos 20 (`scene-fixtures.test.ts:24` solo mira `data/scenes/**`).
- **El guardia de campos, si se escribe «en ambas direcciones» sin acotar nivel, nace rojo por 87 motivos prohibidos** y solo se pondría verde inlinando la prosa — lo que §5 veta. Hay que acotarlo a raíz y `entities[]`, los dos niveles donde ambos declaran estructura.
- **Trampa del criterio 3**: `ground`/`volumes`/`vegetation_zones` reutilizan zod existente; **`scatter` no tiene zod** — `parseScatter` (`scatter.ts:228`) valida a mano y sus mensajes están congelados en `scene-validate-golden.json:198,227`. Llevar `scatter_*` al zod es (a) `z.unknown()`, que es verde que no comprueba nada, (b) un **sexto** espejo, o (c) portar `parseScatter` y rotar el golden. Ninguna es gratis; hay que elegirla a propósito.
- **Qué se puede tirar**: la promesa `player_choice` (`ui_systems.md:39`) y el comentario falso de `scene-schema.ts:20-24`.

## Conflictos

- **#319 ↔ #318** (abierto hoy, 45 min antes). **Es el mismo trabajo**: contrato TS de `remote-gen` no atado al servicio Python. #318 es `/skin_sprite_sheet` (`cached` fuera de `SkinSpriteSheetResponse`, cliente redefiniendo la forma en `style-apply.ts:438-443`); #319 es `/dev/status` + el enrutado con query. Mismo fichero (`src/contracts/remote-gen.ts`), mismo mecanismo, misma familia (#280, #309). Hacerlos por separado **paga dos veces**.
- **#237 ↔ #302** («nada revalida lo que el juego carga: fixtures commiteadas y snapshots que caducan»). Los 20 tiles rechazados **son exactamente su sujeto**. Tocar el gate sin mirar #302 es arreglar el espejo y dejar el cristal.
- **#259 ↔ #238**. #238 propone como opción 3 «cerrar `description` a NPCs en el zod y RECHAZARLO en el resto»: eso **es** endurecer `EntitySchema` (#259), y toca la misma entrada que #237. Tres issues sobre el mismo schema.
- **#320** (guion 34 intermitente, 1 de cada 4 baterías). La línea base de QA de §5 **no es estable**: un 34 rojo aparecerá y se atribuirá a esta tanda. Declararlo antes, no después.
  *Apostilla 2026-08-30: #308 y #320 CERRADOS — el 22 no era intermitente sino un guion que medía la fixture anterior, y el control del 34 pasaba en verde con tres de las cuatro teclas muertas. Ya no hay ajenos que declarar.*

## Riesgo de arte: NO en los cuatro, y por construcción

`validateContract` (`validate.ts:32-36`) hace `safeParse` y **tira el resultado**: devuelve `{ok:true}`, nunca los datos parseados. **El zod no reescribe ninguna escena**, así que ningún cambio en él puede alterar el valor de un campo que ya viaja, ni rotar la clave de una escena que hoy pasa. La clave que se paga es `[desc, mat, kind, hints, ref]` por celda (`asset_cache.py:46-60` + `surface_atlas_generator.py:333-368`), y sale de `volumes[].surface_desc`.

**Medido, no razonado** — el plan `varied`, que ya trae scatter, con y sin él:

```
CON scatter: 273 prims, 26 celdas, cells=23e82540af3acff1
SIN scatter: 153 prims, 26 celdas, cells=23e82540af3acff1   ← idéntico
```

120 prims de diferencia, **cero celdas**: las prims de scatter nacen `cat:"decor"` (`scatter.ts:373`) y `classify` (`surfaces.ts:167-201`) no tiene rama para `decor` → clay, coste 0. Las entities **sí** llegan a celdas, pero *derivadas* (`tile-plan.ts:122-131` → `derive.ts:50-57`), y `derive` lee solo `kind, cell, footprint, id, name, shape`: los seis declarados, así que `.strict()` no pierde nada consumido.

**Método para la PR**: `npx tsx --test test/fps-atlas-golden.test.ts` (hoy 6/6 verde; congela el digest `cells`, el que cuesta €) más el censo sobre las escenas reales, cuya línea base sobre `364d4c6` es **30 celdas únicas, digest `f40115caa4e361bc…`**. **A, B, C, D → NO rotan.** Lo que sí cambian A/B/C es *qué escenas se aceptan*: una escena rebotada al modelo vuelve distinta, y una escena distinta es arte distinto. Ese es el riesgo de € real, y es indirecto.

## Coste contra valor

#259 es el más barato y de los que más pagan: cierra un fail-silent hacia el modelo (doctrina escrita) y la medida dice que no rompe nada. #237 es barato de escribir y **caro de decidir** — la decisión de población es el trabajo, no las dos fixtures. #203 es el caro y el que hay que acotar; sin acotar no sale a cuenta. #319 está casi hecho (5 de 7) y en el sitio equivocado de la cola. **No hacer nada** no es defendible en #259 (coste ~cero, sostiene cero) ni en #237 (la vía de API directa está viva); sí lo sería en #203 si hubiera que inlinar la prosa.

## Qué le cambiaría a `requisitos.md`

1. **§2** → *«El zod SÍ manda: `narrative_react.json` y `weapon_orient.json` los genera él y `contract-model-io.test.ts` los canda. El defecto es que `generate_scene.json` es el único tool escrito a mano fuera del codegen, y que `narrative_schemas.py` tiene un QUINTO espejo —sus vocabularios a mano y la allow-list de `validate_scene_response:460`— que no es el mismo artefacto que `GENERATE_SCENE_TOOL`.»*
2. **Sacar #319 de la tanda y emparejarlo con #318.** Son el contrato de servicio de `remote-gen`, no el de escena. Si se queda, su criterio debe nombrar los dos campos que de verdad están sueltos.
3. **Criterio 1** → *«Renombrar `config.surface_model` o `config.sprite_skin_model` rompe algo. Hoy los otros 5 ya rompen `test_dev_status_shape`; estos dos no. Y renombrar en Python actualizando su propio test debe romper igualmente algo del lado TS.»*
4. **Criterio 2** → añadir: *«La comparación se acota a la RAÍZ y a `entities[]`, los dos niveles donde ambos artefactos declaran estructura. `ground`/`volumes`/`vegetation_zones` son prosa deliberada en el JSON y quedan fuera: sin acotar, el guardia nace rojo por 87 rutas que §5 prohíbe cerrar. Hoy: 2 en la raíz, 0 en `entities[]`.»*
5. **Criterio 3** → añadir: *«`scatter` no tiene zod (`parseScatter` valida a mano, mensajes congelados en `scene-validate-golden.json`). Elegir explícitamente entre `z.unknown()`, un zod nuevo o portar `parseScatter`, y escribir por qué.»*
6. **Criterio 4** → *«Hoy queda 1 promesa muerta, no 3: `player_choice` en `ui_systems.md:39` (el kind real es `dialogue_choice`, `llm_client.py:720`).»*
7. **Criterio 5** → sustituir «decidir cuál de los dos lados tiene razón» por: *«decidir primero QUÉ POBLACIÓN vigila cada validador. El zod rechaza 20 de 20 tiles pre-generados de `data/games/*/world/tile.json` por `size`, `terrain` y `style_ref` de escena: su regla describe lo que el modelo EMITE, no lo que el juego CARGA. Alinear sin separar las dos poblaciones rompe el arranque. Mirar #302 antes.»*
8. **Criterio 7** → **#259 ENTRA.** *«Medido: 76.293 entities censadas, cero claves fuera de las 12; la allow-list de Python es idéntica al zod (diff = ∅). El `.passthrough()` de entity no sostiene nada. Corregir además la justificación falsa de `scene-schema.ts:20-24`.»*
9. **§5** → «39 guiones» pasa a **38**, y la línea base se declara con #320 (guion 34 intermitente) ya conocido.
