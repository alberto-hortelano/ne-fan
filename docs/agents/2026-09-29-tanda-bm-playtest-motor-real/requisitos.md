# Tanda BM — Playtest con el motor real (#239, #465)

## Petición del usuario (literal)

2026-09-29, preguntado «#239 y #465 necesitan un playtest con el motor narrativo real. ¿Lo autorizas ya?»:

> «Sí, lánzalo»

Lo que se le ofreció: «Levanto playtest-motor con un subagente como motor y compruebo role y anchor.rect».

## Issue #239

> Origen: QA de la tanda #173 + #175 (`docs/agents/2026-08-23-contrato-escena-campos/qa.md`, hallazgo importante 1). **No es un bug conocido: es la única pregunta abierta de la tanda, y el sitio exacto donde hay que mirar en el próximo playtest.**
> 
> ## Qué cambió
> 
> `entities[].role` pasa a ser un vocabulario CERRADO (`peasant | guard | villager | merchant`). Antes, un `role` inventado por el motor no llegaba a ninguna parte (la allow-list de `ai_server` lo tiraba en silencio) y la escena se pintaba igual. Ahora se **rechaza**.
> 
> ## El camino de rechazo, medido
> 
> - **Vía MCP (la viva)**: `narrative-mcp/server.ts:460` valida con `FormatDSceneSchema` **antes** de «response sent» y devuelve `isError: true` con un mensaje que nombra al NPC por su id, el rol ofensor, los cuatro valores y dónde va el oficio:
> 
>   > `Invalid scene shape — fix it and call narrative_respond again (do NOT drop the rest of the scene): entities[1].role: el NPC "boris_herrero" declara role "herrero", que no es un rol de conducta. Los únicos son peasant | guard | villager | merchant (los mismos que en spawn_entity). El oficio —herrero, alcaldesa, molinero— va en `name` y en `description`, que es de donde sale su aspecto; `role` solo elige cómo se comporta.`
> 
>   El motor re-responde, en bucle, y ningún tile se pierde.
> - **`ai_server`** solo lanza si su lista y la del zod **divergen**, y `llm_client.py` lo trata explícitamente como divergencia de reglas (`return None` → `narrative_status: error`). Esa divergencia tiene candado (`contract-prompts.test.ts` compara el enum del tool con `NPC_ROLES`, probado en rojo) y sus propias fixtures compartidas.
> - **Vía de API directa** (`llm_client.generate_scene`, fallback sin MCP): no hay pre-flight ni re-respuesta. Ahí un `role` malo mata el tile — igual que ya lo mataban un `kind`, un `cell`, un `footprint` o un `glyph` malos, que `clean_ent` rechaza desde antes de esta tanda. Es la misma clase de fallo, no una nueva.
> 
> ## Lo que sigue sin saberse
> 
> Si la prosa del prompt (`data/contract/prompts/scene_instructions.md`, sección `DRESSING AND BEHAVIOUR OF AN NPC`) basta para que un modelo real NO escriba oficios en `role`. Ningún test puede contestar eso.
> 
> ## Qué hacer
> 
> En el próximo playtest con motor real (`./start.sh --preset playtest-motor` + segunda terminal con `narrative_listen` + `labs/narrative/game-emulator.mjs`), pedir un tile de pueblo con oficios variados y contar cuántas veces aparece el rechazo.
> 
> - **Cero o una vez**: el diseño funciona, cerrar el issue.
> - **Repetido**: el arreglo es la PROSA del prompt, o ampliar `NPC_ROLES` con un preset de conducta de verdad detrás. **No** relajar el enum a `z.string()`: eso devuelve el fail-silent que #173 vino a cerrar.
> 

## Issue #465

> **Reescrito el 2026-09-24 tras la tanda BE (#772).**
> 
> ## Lo que ya está hecho, sin gastar
> 
> - `AnchorSchema` (`nefan-core/src/contracts/world-map-schema.ts`) es la ÚNICA fuente de las reglas del rect:
>   - valores enteros;
>   - `col,row ≥ 0` y `w,h ≥ 1`;
>   - `col+w ≤ 128` y `row+h ≤ 128`.
> - Aplican ese mismo zod tres puertas:
>   - `POST /map/place`;
>   - el pre-flight de la tool `map_upsert_place` (`narrative-mcp/validators.ts:validateAnchor`), con un test sobre el árbol que exige la llamada;
>   - el `world_map` del snapshot y del save (`WorldMapSchema`).
> - `tile_instructions.md` documenta el rect: su forma, sus unidades, sus cotas y su efecto. `contract-prompts.test.ts` contrasta esas cotas con el zod.
> 
> ## Lo que queda, y solo se puede medir gastando (sesión con el usuario, junto a #239)
> 
> 1. ¿El motor real llama a `map_upsert_place` con `anchor.rect` cuando construye un lugar en `generate_tile.place`? ¿El rect cae sobre lo que declaró?
> 2. Rects pegados al borde del tile: `sitioParaAparecer` solo consulta los tiles cargados y puede dejar al jugador hasta 0,40 m fuera del rect (H4 de la tanda G). ¿El motor real produce rects así?
> 3. Viene de #578. Cuando la entrada de un mundo pre-generado se regenera sin `bootstrap_world_map` y con vecinos:
>    - ¿el motor real continúa las costuras del anillo?
>    - ¿se abstiene de sembrar lugares?
> 
> El guion 144 ya es el candado de ese camino.

## Restricciones del coordinador

- **Cero créditos de imagen.** Solo narrativa: nada de remote-gen, sprite-forge ni generación de atlas. El motor es Claude (Max), y eso no es crédito de API.
- El stack sube desde el checkout principal `/home/al/code/ne-fan`, en `main` y con offset 0: el `.venv` vive allí. Los informes van a ESTA carpeta del worktree `/home/al/code/ne-fan-tanda-bm`.
- **No tocar los saves del usuario** en `saves/`. Usar `NEFAN_GAMES_DIR` o una sesión nueva, y NUNCA reanudar una partida ajena.
- No matar procesos ajenos. Al terminar, parar por PID lo que se arrancó.
- Motor FRESCO por mundo (ver el protocolo).

## Fase 2 (2026-09-29): arreglar lo que midió el playtest

El playtest (qa.md) cerró #239 y el punto 2 de #465. El resto de #465 sigue abierto por tres defectos que vería el jugador:
- **H1:** los lugares anclados dentro de una entrada regenerada conservan los rects de la entrada anterior.
- **H2:** el rect llega DESPUÉS de `narrative_respond`, en una carrera con la llegada.
- **H3:** el rect marca el punto de llegada y no la huella del lugar, así que los triggers solo saltan en unos pocos m².

H4 (los rechazos no quedan en el log de narrative-mcp) entra si es barato. H5 (`--allowedTools` no restringe al motor en modo auto) es del banco y entra si es barato.

La tanda cierra #465 con los tres defectos arreglados y candados con el motor falso cuando se pueda. No se abren issues nuevos. Guiones reservados: 280–289.

### Decisiones del usuario sobre la fase 2 (2026-09-29, literales)

- H2 → **«Solo prosa (Recomendado)»**: `tile_instructions.md` y la tool `map_upsert_place` piden declarar el rect ANTES de `narrative_respond`. No se toca el contrato.
- Cierre de #465 → **«Playtest corto tras el merge (Recomendado)»**: después de fusionar, un playtest breve con el motor real mide la prosa de H2 y H3, y #465 se cierra con esos números. La PR cita #465 SIN cerrarlo.
- El alcance es el que recomienda critica.md: H1 (contexto con el rect de `place` y todos los lugares anclados en el tile), H2 (prosa), H3 (el rect es la huella del lugar, y el anidamiento se resuelve por área, gana el más pequeño) y H4. H5 queda fuera.
