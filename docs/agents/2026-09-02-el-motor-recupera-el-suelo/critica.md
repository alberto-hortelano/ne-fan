# Crítica — T5 «El motor recupera el suelo» (#335 + #238 + #264) · `main` = `937c16d` · 2026-09-02

**Veredicto por issue: #335 REENCUADRADA · #238 VIGENTE (con tres correcciones a los requisitos) · #264 PREMATURA (fuera de la tanda, con la medida para el issue).**

## #335 — REENCUADRADA: la salida 1 le devuelve al motor una herramienta que no se ve

**El problema real en una frase**: el contrato que lee el modelo se contradice consigo mismo y con el código — ofrece `terrain_legend` para «custom chars» que ninguna primitiva ofrecida puede escribir, y lo documenta con una primitiva borrada.

**Premisa, verificada**

| Afirma (issue / plan / requisitos) | Medido hoy |
|---|---|
| `terrain_patches` «no está en `generate_scene.json`» (omisión) | **Falso como omisión**: se RETIRÓ a propósito en `dbf9fc7` (2026-08-12): «terrain_patches, place_anchors → nunca emitidos; lector conservado». Salida 1 deshace una decisión sin nombrarla |
| El prompt «menciona `terrain_legend`/`terrain_patches`» | Solo la leyenda. `scene_instructions.md:40-41` ya dice al modelo: «they are the ONLY ones you can produce: **no primitive you are offered writes a char of its own**» — y ocho líneas después (`:48-49`) enseña a declarar un char custom sólido. `tile_instructions.md:13`: «optional custom chars». `terrain_patches`: 0 en `prompts/`, 0 en `tools/`, 0 en fixtures, snapshots, saves y labs |
| «Devuelve al motor la capacidad de pintar el suelo» | **No pinta**: el grid viaja solo para colisión (`scene-normalize.ts:250-254`, comentario literal: «no para pintar — el suelo se pinta desde `ground`»); en el cliente lo leen `world/collision.ts:4` y `carga-de-tile.ts:270-326` (`createTerrainCollider`, `solid_chars`); `grep terrain_grid nefan-html/src/renderer` → 0. Los nombres de `terrain_grid.legend` no los lee nadie fuera del normalizador (grep `legend` en `src/`, `bridge/`, `nefan-html/src` → 0). El atlas sale de `surface_desc`/`part.desc` de volúmenes (`fps-spec.ts:208-247`), nunca del grid |
| Lo que SÍ hace un parche | Colisión invisible (char sólido, `W`, `w`) o nada (char pisable); crea una obligación de costura para el vecino (`tile-edges.test.ts:36`: dos `s` en el borde = crossing «road») y la vegetación no lo esquiva (`derive.ts:187`). Es una trampa, no una herramienta |
| `checkDeclaredChars` «sigue siendo útil para migraciones, snapshots y ai_server» | Sin parches no puede saltar: el bioma emite chars reservados salvo `n` de `snow` (`tile.ts:77`), que el expander declara él mismo (`scene-expand.ts:165-166`); `rasterizeGroundToGrid` escribe reservados; las 19 escenas de snapshot solo llevan reservados + `W`. Su único productor posible de un char no reservado es `terrain_patches` |
| `scene-schema.ts:23` la nombra sosteniendo el passthrough | Cierto |
| Python la sanea en silencio (`narrative_schemas.py:587-603`) | Cierto; y `:672-675` infla la leyenda con los nueve nombres reservados (se ve en los snapshots) |
| `campos-retirados-no-vuelven` no ve `structure's` | Cierto: `\bstructures\b` no casa «structure's». Añadir `structure` como término tocaría un uso legítimo (`greybox/surfaces.ts:109`); `wall_char|floor_char` entran limpios y pasan `repo-hygiene.test.ts:213-218` |

**Lo que no se puede tirar**: `terrain_legend` tiene un SEGUNDO sujeto, vivo y con tests, que ni el issue ni el plan nombran: la solidez de los chars RESERVADOS — `w: {solid:false}` es un vado (`scene-normalize.ts:85-104`, `plan-collision.ts:41-47`, `plan-collision.test.ts:144,208`). El prompt no lo enseña (`scene_instructions.md:48`: solo habla de chars custom). Y la heurística `SOLID_LEGEND_NAME` (`scene-normalize.ts:78`) vuelve sólido cualquier char cuyo NOMBRE suene a muro — un parche `{name:"tapia"}` bloquea sin que el modelo lo haya declarado.

**El día después de la salida 1**: el motor puede emitir parches que no cambian un píxel de la vista única, sí la colisión y las costuras; el grid pasa de raster derivado de `ground` a fuente parcial de verdad (dos orígenes del suelo, contra «colisión desde huellas, nunca desde píxeles»); `checkDeclaredChars` y el saneador Python siguen vivos por él. **El día después de la salida 2**: mueren `terrain_patches` (lector, tests `scene-expand:76-81`, `tile:77-118`, `tile-edges:36,55`, `scene-validate:60-98`, corpus golden), el saneador Python, `checkDeclaredChars`, la prosa de custom chars en tool y dos prompts; `TerrainLegendSchema` queda con un solo trabajo o ninguno. Lo que exige decisión del usuario, no del arquitecto: **si el vado (`solid:false` sobre `w`) es una capacidad que el motor debe tener**. Si sí, la leyenda se queda SOLO para eso y el prompt lo dice por primera vez; si no, `terrain_legend` sale entera y la solidez queda en `DEFAULT_SOLID_CHARS`.

**Conflictos**: contradice `dbf9fc7`; roza #302 (los snapshots llevan `structures`/`room_id`, exentos por regla). **Coste/valor**: la salida 1 cuesta más (zod + tool + Python fail-loud + prompts + candado) que la 2 y su valor observable es cero. **Qué no hacer**: no re-ofrecer `terrain_patches`.

## #238 — VIGENTE, y responde a la pregunta abierta

**Problema en una frase**: el contrato invita a poner `description` en cualquier entity y el wire la tira para las que no son NPC.

| Afirma | Medido |
|---|---|
| `formatDToWorld` escribe `description: ent.name` (objetos) y conserva la de NPC | Cierto: `scene-normalize.ts:229` vs `:207` (el issue decía :221/:199 — caducado) |
| El tool dice «NPCs:» | Cierto (`generate_scene.json:170`). Pero el MISMO contrato dice lo contrario a cualquier entity: `scene-schema.ts:63-64` («Lo que quisieras contar de ella va en `description`») y `:117-118`; Python `narrative_schemas.py:775,872-879` la copia para todos los kinds. La contradicción ya está en el contrato de hoy |
| «Sobrevive hasta lo que se genere a partir de ella» | **Hoy no se genera nada** de una entity no NPC: se convierte en volumen derivado con `label = ent.name` (`derive.ts:150-164`), sin `surface_desc`, así que sus caras salen de material/color (`fps-spec.ts:247`); el `label` solo alimenta la heurística de valla (`fps-detail.ts:340`). El asset-store solo indexa `surface` (#257): no hay kind al que atar esa procedencia. Donde muere es SOLO el wire; el save ya la conserva (Format D en `scenes_loaded[].scene_data`) |
| `obj.description` en el cliente | Es el rótulo del objeto MIRADO: `carga-de-tile.ts:105` (`label: d.descripcion`) → `main.ts:1244-1251`. No hay panel de E para objetos (`hablar-con-un-npc.ts` es solo NPC). A4 acierta: la etiqueta es `name` |
| Frecuencia real | 0 de 59 entities no NPC en fixtures + snapshots y 0 de 579 en los 11 saves llevan `description`. El motor no la escribe hoy: el valor es honestidad del contrato + el principio de #293, y es barato |

**Correcciones a `requisitos.md`**: (1) **A3 cita el test equivocado**: `contract-model-io.test.ts` solo cubre `NarrativeReaction`/`WeaponOrient`/`WeaponVerify` (`schemas.ts:197-214`); `generate_scene.json` es «a mano» y lo guarda `contract-prompts.test.ts:188-229` (raíz ⊆ `SCENE_FIELDS`, una dirección; `entities[]` en las dos). (2) `formatDToWorld` es ya el 2.º item de CRAP de `npm run deuda` (54, complejidad 54): la rama nueva lo sube — el ingeniero debe hacerlo sin añadir decisión, o el gate de no-empeorar salta. (3) `scene-normalize` son 278 mutantes > `tope_local` 120: no cabe en local, se pide. **Conflicto suave**: #378 (`WorldScene` sin tipo) — el campo nuevo nace sin tipo; dependencia, no bloqueo.

## #264 — PREMATURA: el número no se puede medir contra tiles reales porque ninguno se acerca

Premisa exacta (`ground.ts:46,129`; `pathPrims` `ground-prims.ts:115-142`; `smoothPathSubdiv` sin caller → 2n−1 exacto). **Medido** con `groundFeaturePrims` sobre las 25 escenas con `ground` del árbol: máximo **57 prims** (`puerto_tile.json`, 15 rasgos, 6 caminos de ≤5 puntos); motor real (snapshots `toledo_1200`/`cuentos_oscuros` tile_0_0) 25 y 15; fixtures 14-15; los 99 tiles de los saves ≤12 (motor falso). El peor tile legal son 1984: la realidad está **35×** por debajo, así que cualquier tope entre 57 y 1984 se elegiría a ojo — justo lo que el issue prohíbe. Los «1594 prims / ~80 ms» del cuerpo no los asserta nadie (`ground-overlay.test.ts:116`: `> 500`, sin tiempo). Caducado: «122 de 219» → huella 224/116; `scene-validate.ts:241` → `:245`. **Desbloquea**: un coste medido por prim en la fps (bench) o un tile real que duela. Coste hoy: `ground.ts` vive en `blueprint-suelo` (507 mutantes, fuera del tope local) y `scene-validate.ts` está en `sin_mutar` (#339). **Fuera de la tanda, sigue abierto**; pegar la medida en el issue.

## Conflictos generales

T6/T7 (plugins, dispatcher) no comparten fichero con T5. #293 aparcado: #238 es su instancia, sin solapamiento de trabajo. `test/repo-hygiene.test.ts:124-127` parte la alternancia por `|` y sondea `data/<t>.json`, `data/<t>s.json`, `data/pre_<t>_x/`: términos con `_` pasan; no añadir términos con apóstrofo ni espacios.

## Qué cambiar en `requisitos.md` (pegar tal cual)

- **Alcance 1** → «**#335**: decidir con el usuario si `terrain_legend` conserva su único uso vivo (solidez de chars reservados: vado `w:{solid:false}`, `plan-collision.ts:41-47`). Con esa respuesta: retirar `terrain_patches` entera (lector `scene-expand.ts:145-163`, saneador `narrative_schemas.py:587-603`, tests y corpus), `checkDeclaredChars` (sin productor de chars no reservados) y la prosa de custom chars en `generate_scene.json:41`, `scene_instructions.md:36-50`, `tile_instructions.md:13`; `wall_char|floor_char|terrain_patches` al candado; la leyenda inflada de `narrative_schemas.py:672-675` fuera. Si la leyenda se queda, el prompt enseña el vado; si no, `terrain_legend` sale de zod, tool, prompts y Python.»
- **A1** → «Ninguna primitiva ofrecida al motor escribe chars y el contrato ya no dice lo contrario: `grep -rn "custom char\|terrain_patches\|wall_char\|floor_char" data/contract/ ai_server/` → 0; un tile con `terrain_patches` lo RECHAZA el zod nombrando el campo.»
- **A3** → «`contract-prompts.test.ts` (§#203) verde: la raíz de `generate_scene.json` ⊆ `SCENE_FIELDS` tras quitar/declarar la leyenda; `contract-model-io.test.ts` no mira este tool.»
- **A5 y Alcance 3** → fuera; sustituir por: «Comentar en #264 la medida (máx. 57 prims reales vs 1984 legales; sin coste de render medido) y dejarlo abierto.»
- **A6** añadir: «`formatDToWorld` no sube de CRAP 54 (`npm run crap -- --check`).»
