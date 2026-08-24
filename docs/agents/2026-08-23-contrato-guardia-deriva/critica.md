# REENCUADRADA

El problema es real y está MEDIDO, pero el issue lo tiene del revés: teme que `generate_scene.json`
se separe del zod, y lo que pasó es que **el zod se quedó atrás del JSON, cuatro campos, en
silencio**. El guardia fuerte tal y como se pide no arregla eso: lo empeora.

## El problema real, en una frase

El contrato de escena vive en tres sitios (zod, `generate_scene.json`, Python) y nada comprueba
que declaren el mismo conjunto de campos.

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificación |
|---|---|
| «`CONTRACTS` tiene 3 entradas y la escena queda fuera» | **CIERTA**. `src/contract/model-io/schemas.ts:191-213`: narrative_event, weapon_orient, weapon_verify. Ningún prompt salvo `narrative_event.md` tiene región `SCHEMA:AUTO` |
| «Meter la escena en `CONTRACTS` no es gratis: el renderizador no soporta referencias anidadas» | **FALSA**. `toJsonSchema(FormatDSceneSchema)` **no lanza** y resuelve el anidamiento. El obstáculo no es técnico, es de TAMAÑO: 2.094 líneas frente a las 215 del JSON a mano (payload compacto 20.025 vs 8.484 bytes, ×2,4). `renderContract` produce 327 líneas, y `scene_instructions.md` entero son 200 |
| (implícita) «el JSON a mano es una copia degradada del zod» | **FALSA y al revés**. `ground` y `volumes` en el JSON son `{type:"array", description:"<gramática en prosa>"}` — 701 y 1.561 bytes que le ENSEÑAN el vocabulario al modelo; inlinados desde el zod son 5.025 y 13.166, y se pagan en cada `generate_scene` del fallback por API (`ai_server/llm_client.py:479`). `entities`, en cambio, ENCOGE (2.793 → 897): el zod tiene menos que decir que el JSON |
| (implícita) «el zod es la fuente de verdad de la escena» | **FALSA hoy**. El JSON declara 14 propiedades de nivel superior y el zod 11 (`scene-schema.ts:84-96`). Las tres que faltan —`vegetation_zones` (:99), `scatter_generators` (:110), `scatter_zones` (:114)— **están vivas y consumidas**: `scene-expand.ts:78,353`, `scene-normalize.ts:252-256`, `blueprint/scatter.ts:231-239`, `blueprint/fps-spec.ts:244`. En `entities` falta un cuarto: `style_ref` (JSON :210), que lee `npcSkinStyleRef` (`games/style-categories.ts:55`). **Cero campos en el zod que no estén en el JSON.** Python tampoco sigue al zod: `narrative_schemas.py:44` carga el JSON como SoT y `validate_scene_response` trata scatter (:581) y `style_ref` (:673) |
| «una deriva ahí da escenas que el validador rechaza» | **NO ha ocurrido**. `FormatDSceneSchema` es `.passthrough()` (`scene-schema.ts:84`): el retraso del zod es invisible en partida. El daño no es una escena rota, es que la palabra «SoT» de su cabecera y de la tabla de CLAUDE.md no es cierta |
| «es el mismo fallo que `scene_analysis` en `tile_instructions.md`» | **YA CANDADO**. `campos-retirados-no-vuelven` (`arch-rules.json`) tiene `nefan-core/data/**/*.md` entre sus roots y `scene_analysis` está a cero en los prompts: un término RETIRADO que sobreviva en un prompt ya lo coge un candado vivo |

`fbaa9f3` («vegetation_zones re-expuesto») y `d8876f7` (scatter) los añadieron al JSON y **nunca al
zod**. Dos commits, cuatro campos — y `contract-model-io` + `contract-prompts` siguen 20/20 verdes.

## ¿Habría cazado el guardia los fallos reales que ya han ocurrido?

**#173 (`role`/`description` en el contrato de entity): NO — lo habría empeorado.**
`scene-normalize.ts:189-195` lee TRES campos de la entity: `role`, `style_ref` y `description`.
El zod `EntitySchema` (`scene-schema.ts:33-48`) no declara **ninguno**; el JSON declara **uno**
(`style_ref`). Un guardia «el JSON == lo que renderiza el zod» no ve deriva donde los dos callan
—eso ES #173— y donde el JSON acierta y el zod no, **borra el campo bueno**: de 1 de 3 a 0 de 3.
De paso pone rojo `test/contract-prompts.test.ts`, que afirma «la style_ref de entidad sigue viva».

**#195 (la prosa de `normalizeGrid` que espeja «el saneador de ai_server»): NO.** Es un comentario
en `src/scene/scene-validate.ts:201-203`, un `.ts`: fuera del alcance de los dos guardias.

**0 de 2 para el guardia fuerte** — pero eso no vacía el issue, porque hay 4 huecos de campo que
nada mira. Hay que corregir a qué NIVEL mira el guardia y en qué DIRECCIÓN.

### Censo de los cinco prompts huérfanos: 3 promesas muertas de ~335 (0,9 %)

`texture_prompt`/`model_prompt` (`scene_instructions.md:146`) están a cero en `src`, `bridge`,
`narrative-mcp` y `ai_server` — y CLAUDE.md los sigue prometiendo; sus hermanos
`texture_hash`/`model_hash` sí se leen, o sea que el par está partido por la mitad. `player_choice`
(`ui_systems.md:39`) no lo emite nadie: el evento real es `dialogue_choice`
(`bridge/handlers/dialogue.ts:96`) — la clase exacta de #198, y **lo único que un guardia DÉBIL
habría cazado**. `tile_instructions.md` (el mayor, ~175 ids), `develop_world.md`, `world_rules.md`: **cero**.

## El día después (guardia fuerte, aplicado tal cual)

- **Para quien juega**: nada bueno y algo malo. El JSON regenerado desde el zod de hoy deja de
  ofrecerle al motor scatter, vegetación y la ref de personaje del NPC: escenas más pobres y skins
  desviados de clave de caché. Es una regresión, no un cero.
- **Qué se vuelve más difícil**: añadir una capacidad deja de ser «editar el JSON» y pasa por el
  zod — y la gramática en prosa de `ground`/`volumes`, que es el material didáctico del motor, la
  sustituye estructura.
- **Arbitrario en un mes**: 327 líneas auto-generadas sobre un prompt de 200.

## Conflictos

- **#173, EN VUELO ahora** (rama `feat/contrato-entity-npc`): su árbol ya añade `role`,
  `description` **y `style_ref`** al zod, y `role`+`description` al JSON. **Dependencia de orden
  dura**: si #203 aterriza primero con codegen, borra `style_ref` y pisa ese trabajo; si va
  después, el hueco de la entity se cierra solo y le quedan los tres de nivel superior.
- **`test/contract-prompts.test.ts`** se pone rojo con el JSON regenerado (aserción de `style_ref`).
- **`campos-retirados-no-vuelven`** ya cubre la mitad que motiva el issue: repetirlo es solape.

## Coste contra valor

No hacer nada tiene coste real pero acotado: el zod sigue siendo un gate parcial que se llama a sí
mismo fuente de verdad, y el próximo campo entra por el JSON otra vez sin que nadie lo note porque
`.passthrough()` lo absorbe. **Lo que no sale a cuenta es el codegen completo**: ×2,4 el payload en
cada llamada del fallback, tira la gramática en prosa y empieza borrando campos vivos. El valor
está en las dos partes baratas, que nacen señalando 4 y 3 huecos verificados, no cero.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

> **Reencuadre (medido).** `toJsonSchema` sobre `FormatDSceneSchema` NO lanza y resuelve el
> anidamiento: el obstáculo nunca fue la recursión, es que el resultado son 2.094 líneas frente a
> las 215 del JSON a mano, cuyos `ground`/`volumes` son prosa que le enseña la gramática al modelo.
>
> **Y la deriva va al revés de lo que teme el issue.** El JSON declara cuatro campos vivos y
> consumidos que el zod no tiene: `vegetation_zones`, `scatter_generators`, `scatter_zones` y
> `entities[].style_ref`. Ninguno al contrario. Python sigue al JSON, no al zod.
>
> **Alcance corregido, dos candados baratos en vez de uno caro**: (1) comparar el CONJUNTO DE CAMPOS
> de los tres artefactos (zod, `generate_scene.json`, Python) en AMBAS direcciones; (2) el guardia
> DÉBIL sobre los cinco prompts — cada término prometido al modelo debe existir en el código.
> **Fuera de alcance**: regenerar el JSON desde el zod, `SCHEMA:AUTO` en ningún prompt, la prosa de
> `ground`/`volumes`.
>
> **Censo hecho**: el débil nace con 3 sujetos de ~335 promesas — `texture_prompt`/`model_prompt`
> (`scene_instructions.md:146`) y `player_choice` (`ui_systems.md:39`, el real es
> `dialogue_choice`). `tile_instructions.md`, `develop_world.md` y `world_rules.md`, a cero.
>
> **Orden**: después de #173, que ya cierra el hueco de la entity. Al revés se pisa su trabajo.
>
> **Los dos candados nacen rojos** (4 y 3 huecos). Cerrarlos —llevando el zod al JSON, no al
> revés— es parte del trabajo, no un prerrequisito ajeno.
