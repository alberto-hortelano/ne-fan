# El contrato de escena entra en el guardia de deriva (#203)

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

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/203`.

Resumen: `test/contract-model-io.test.ts` garantiza que los prompts y tools que ve el modelo no
divergen del zod. Recorre `CONTRACTS` (`src/contract/model-io/schemas.ts`), que tiene **tres**
entradas de los ocho prompts y cuatro tools que hay en `data/contract/`. Queda fuera **el contrato
central del juego**: `tools/generate_scene.json` + `prompts/scene_instructions.md`, más
`tile_instructions.md`, `develop_world.md`, `ui_systems.md` y `world_rules.md`.

El issue plantea dos salidas: guardia **fuerte** (meter la escena en `CONTRACTS`, lo que exige que
el renderizador soporte referencias anidadas) o guardia **débil** (que cada término que el prompt le
promete al modelo exista en el zod). Y dice que «débil es infinitamente mejor que nada aquí».

## Reencuadre del crítico (2026-08-23), medido

Veredicto: **REENCUADRADA**. Ver `critica.md`.

### La pregunta falsable: 0 de 2

El guardia fuerte **no habría cazado ninguno** de los dos fallos reales, y en uno de ellos **habría
empeorado las cosas**:

- **#173 — NO, y al revés.** `src/scene/scene-normalize.ts:189-195` lee **tres** campos de la
  entity: `role`, `style_ref` y `description`. El zod `EntitySchema` no declara **ninguno**;
  `generate_scene.json` declara **uno** (`style_ref`). Un guardia que exija «el JSON == lo que
  renderiza el zod» no ve deriva donde los dos callan —eso *es* #173— y donde el JSON acierta y el
  zod no, **borra el campo bueno**. Pasaría el contrato de 1 de 3 a 0 de 3.
- **#195 — NO.** Es un comentario en un `.ts`, fuera del alcance de ambos guardias.

### La deriva es real, y va al revés de lo que teme el issue

1. **`toJsonSchema(FormatDSceneSchema)` no lanza.** Resuelve el anidamiento. El obstáculo nunca fue
   la recursión: es que produce **2.094 líneas frente a las 215** del JSON a mano (payload ×2,4).
   `ground`/`volumes` en el JSON son deliberadamente `{type:"array", description:"<gramática en
   prosa>"}` — 701 y 1.561 bytes que **enseñan el vocabulario**; inlinados serían 5.025 y 13.166.
   Y `entities` **encoge** (2.793 → 897): el zod tiene menos que decir que el JSON.
2. **El zod no es la fuente de verdad de la escena.** El JSON declara 14 propiedades de nivel
   superior y el zod 11. Las tres que faltan —`vegetation_zones`, `scatter_generators`,
   `scatter_zones`— están **vivas y consumidas**. Con `entities[].style_ref`, son cuatro.
   **Cero al revés.** Python tampoco sigue al zod: `ai_server/narrative_schemas.py:44` carga el
   **JSON** como fuente de verdad. Dos commits añadieron esos campos al JSON y nunca al zod, y las
   suites de contrato siguen 20/20 verdes con el hueco dentro.

### El censo de promesas muertas

**3 de ~335 (0,9 %)**: `texture_prompt`/`model_prompt` (`scene_instructions.md:146`, cero en los
cuatro procesos — y `CLAUDE.md` los sigue prometiendo) y `player_choice` (`ui_systems.md:39`; el
evento real es `dialogue_choice`). Esa es la clase exacta del fallo de #198, y **lo único que un
guardia débil habría cazado**. `tile_instructions.md`, `develop_world.md` y `world_rules.md`: cero.

### Alcance corregido: dos candados baratos en vez de uno caro

1. Comparar el **conjunto de campos** de los tres artefactos (zod, `generate_scene.json`, Python) en
   **ambas** direcciones.
2. El guardia **débil** sobre los cinco prompts: cada término prometido al modelo debe existir en el
   código.

**Los dos nacen rojos** (4 y 3 huecos verificados). Cerrarlos —llevando el zod al JSON, **no al
revés**— es parte del trabajo, no un prerrequisito ajeno.

**Fuera de alcance**: regenerar el JSON desde el zod, `SCHEMA:AUTO` en ningún prompt, y la prosa de
`ground`/`volumes`.

### Orden

**Después de #173**, que ya cierra el hueco de la entity. Al revés se le pisa el trabajo: el
ingeniero de `feat/contrato-entity-npc` ya está añadiendo `role`, `description` **y `style_ref`** al
zod.

## Criterios de aceptación de la tanda (para después de tu veredicto)

- El contrato central del juego deja de poder separarse del zod sin que nada avise.
- La elección entre guardia fuerte y débil sale de una **medida**, no de una preferencia.
- El candado se prueba en negativo: se pone rojo al separar a mano el prompt del zod.

## Fuera de alcance

Reescribir los prompts. Cambiar el contrato de escena.

## Veredicto del crítico

**REENCUADRADA.** Ver `critica.md`. Sin decisiones de producto pendientes.
