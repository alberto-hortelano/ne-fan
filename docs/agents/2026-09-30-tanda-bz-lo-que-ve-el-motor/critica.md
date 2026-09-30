**REENCUADRADA.** Son dos problemas reales con un solo nombre, y la premisa que los une es falsa: `available_assets` NO es lo que pesa en los ~65 KB (son el ~12 %). Filtrar por estilo arregla la coherencia y el coste, pero no mueve el tamaño. El dial del tamaño son las instrucciones estáticas (~41 KB, el 65-70 %), que viajan idénticas en cada petición de escena.

## El problema real, en una frase

El motor recibe como «reusables gratis» unas descripciones que en este estilo no son reusables (y reusarlas cuesta un repintado), y cada petición de escena reenvía ~41 KB de prosa fija que la acercan al tope de la tool MCP.

## La premisa, afirmación por afirmación

1. **«No se filtra por estilo ni por mundo»: CIERTO.** `ai_server/llm_client.py:293-295` pide `asset_type="surface", limit=200` sin más filtro. `nefan-core/services/asset-store/manifest-db.ts:232-251` solo filtra por `type`, y además NO devuelve `extra`, que es donde está el estilo: el filtro no se puede hacer hoy desde ai_server, hay que tocar el contrato de `GET /assets`.
2. **«Hay superficies de acero_neon»: CIERTO, medido.** `cache/manifest.sqlite3` (árbol principal, copia en solo lectura): 179 filas `surface` = sombra_de_cuento 54, acuarela_luminosa 52, acero_neon 41, medievo_crudo 32. Las 30 que ve el motor hoy: medievo_crudo 17, sombra_de_cuento 8, acero_neon 3, **acuarela_luminosa 2**. En la partida de acuarela, 28 de 30 entradas son de otro estilo.
3. **«¿Hay una decisión viva de que el estilo NO sea el discriminante?»: NO la hay.** Ni en `CLAUDE.md` («Reuse de assets»), ni en `docs/arquitectura/narrativa.md:15` / `vistas.md:185`, ni en `ai_server/tests/test_available_assets.py` (4 tests: tipo, cortos, dedupe, límite; ninguno sobre estilo). La decisión viva es la contraria: la clave de caché de una celda **incluye el estilo** (`ai_server/surface_atlas_generator.py:356-363`, `style` = `"{style_id}:{style_token}"`, `routers/remote_generation.py:90,114,124`).
4. **«Una superficie de otro estilo es un cache-hit que parece gratis»: FALSO, y es peor.** Como el estilo está en la clave, una `surface_desc` de acero_neon repetida en acuarela es un **fallo de caché**: se pinta de nuevo (en `produccion`, gasta) una «colony airlock door» en acuarela. El prompt le promete al motor lo contrario (`nefan-core/data/contract/prompts/scene_instructions.md:139-147`, «cache hit … for free»). Además la clave lleva `mat`, `kind`, `hints`, `fpsref` y `cellref`: ni siquiera dentro del mismo estilo una descripción verbatim garantiza el acierto. Filtrar por estilo es necesario, no suficiente; que nadie lo venda como «ahora todo reuso es gratis».
5. **«~65 KB, sobre todo por available_assets»: FALSO.** Reconstruido desde el código (`narrative-mcp/server.ts:325-331`: `JSON.stringify({kind, world_state}, null, 2)` + `tile_instructions.md` + `scene_instructions.md` + `world_rules.md`) con `serializeForLlm` sobre dos saves reales de alta_fantasia y las 30 entradas reales del manifest:
   - instrucciones fijas: 23 752 + 12 331 + 4 817 = **40 900 B** (64-70 %);
   - `world_state` con indentación 2: 17 653 – 22 705 B; compacto sería 18 137 en vez de 22 705 (la indentación sola son ~4,5 KB);
   - `available_assets`: **7 793 B** (12 %), de los que las descripciones son 3 203; el resto son `hash`/`type`/`subtype`/`created_at`, que el motor no usa (reusa por descripción, no por hash) y la indentación;
   - total: **58,5 – 63,6 KB**, coherente con los ~65 del hallazgo (un tile real añade vecinos y lugares anclados, que aquí puse vacíos).
   Filtrar por estilo deja las mismas 30 entradas si el estilo tiene 30 descripciones: tamaño ≈ igual.

## El día después (de la tarea tal como está escrita)

- Para quien juega: deja de ver fachadas sci-fi repintadas en acuarela y deja de pagarlas. Eso vale.
- Si el arreglo se queda en «filtrar available_assets», la petición sigue en ~60 KB y el motor sigue leyendo desde fichero. El candado de tamaño, si mide solo `available_assets`, nacería verde midiendo el 12 % que no importa: un verde que no comprueba nada.
- Puerta que se cierra: si el filtro se hace por `style_id` a secas, un cambio de `style_token` deja entradas que ya no son hit; el discriminante honesto es el mismo `style` que entra en la clave.

## Conflictos

- **#790 / tanda CA** toca `narrative-mcp/server.ts` y los prompts (retira `weapon_orient`/`weapon_verify`). Si esta tanda adelgaza el texto de `narrative_listen` o los `.md` de instrucciones, pisa los mismos ficheros: ordenar (CA primero, que solo borra) o avisar para rebase.
- `world_vocabulary` (`nefan-core/bridge/context.ts:317`, `docs/arquitectura/ia-servicios.md:132`) es la otra vía de reuso por descripción, ya por mundo; no choca, pero quien toque la promesa de «cache-hit gratis» del prompt debe tocar las dos redacciones.
- `test/contract-model-io.test.ts` sujeta prompts contra zod: recortar instrucciones pasa por ahí.
- Sin solape con BX (`dialogue-panel.ts`, `start.sh`) ni BY.

## Coste contra valor

- Filtro por estilo: barato (contrato de `GET /assets` + `_inject_available_assets` + un test), valor alto (arte coherente y dinero). Hacerlo.
- Quitar campos muertos e indentación del payload: barato, ~6-8 KB. Hacerlo si se toca.
- Tamaño de verdad: está en los 41 KB fijos por petición. Es la parte cara y la única que resuelve «quepa holgado»; no hacerla deja el síntoma del playtest intacto.
- No hacer nada: el motor sigue funcionando (lee desde fichero), pero con arte incoherente pagado y un prompt que le miente sobre el coste.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Corrección de la premisa (crítica BZ).** `available_assets` pesa ~7,8 KB de ~60 KB (12 %); el grueso son ~41 KB de instrucciones fijas (`tile_instructions.md` + `scene_instructions.md` + `world_rules.md`) que se reenvían en cada petición de escena, más ~4,5 KB de indentación del JSON. Y reusar una superficie de otro estilo NO es cache-hit: la clave lleva el estilo, así que es un repintado pagado.
>
> Lo que se pide, en dos partes independientes:
> 1. **Reuso honesto.** El motor solo ve superficies cuyo `style` (el mismo valor que entra en la clave de caché) es el de la partida. Hoy `GET /assets` no devuelve `extra`: el contrato del store cambia. El prompt deja de prometer «gratis» donde no lo es. Test en `test_available_assets.py` con filas de dos estilos.
> 2. **Tamaño.** La petición completa de `narrative_listen` (texto entero que devuelve la tool, no solo `available_assets`) cabe con holgura bajo el tope de la tool MCP. El candado mide ESE texto reconstruido desde un save realista y falla por encima de un umbral declarado con su motivo. El dial principal son las instrucciones fijas; los campos que el motor no usa (`hash`, `type`, `subtype`, `created_at` de cada asset) y la indentación son secundarios.
>
> Coordinar con la tanda CA (#790): las dos tocan `narrative-mcp/server.ts` y los prompts.
