# Tanda BZ — Lo que recibe el motor en cada petición

## Petición literal del usuario (2026-09-30)

> «sigue con lo que falta»

Viene tras la demo. Esta tanda es uno de los hallazgos del playtest del coordinador que quedaron sin arreglar.

## Hallazgo

Lo reportó el agente que hizo de motor narrativo en el playtest de `alta_fantasia`, con estilo `acuarela_luminosa`:

- Cada `narrative_listen` trae **unos 65 KB**, sobre todo por `available_assets`. Dos veces el resultado superó el límite de la herramienta MCP y el motor tuvo que leerlo desde fichero.
- `available_assets` incluye **superficies de la colonia sci-fi** (`colonia_aster` / `acero_neon`), que no pintan nada en alta fantasía.

`available_assets` es la librería de SUPERFICIES pintadas que el motor reusa por descripción verbatim (CLAUDE.md, «Reuse de assets»). Una superficie de otro estilo reusada en este mundo mete arte incoherente, y además es un cache-hit que parece gratis.

Productores y consumidores: `ai_server/llm_client.py`, `ai_server/asset_store_client.py` (`GET /assets?limit=200&asset_type=surface`), `nefan-core/src/contracts/asset-store.ts` y `ai_server/tests/test_available_assets.py`.

## Lo que hay que verificar y decidir

1. ¿Se filtra hoy por estilo o por mundo? Si no, ¿por qué? Puede haber una decisión viva, por ejemplo que el pack de estilo NO sea el discriminante. Lo verifica el crítico.
2. ¿Qué pesa de verdad en los 65 KB? Hay que medirlo sobre una petición real, no suponerlo.
3. Lo que se pida:
   - que el motor vea solo las superficies reusables en ESTE estilo;
   - que el tamaño de la petición quepa holgado en una respuesta de tool MCP;
   - que haya un candado que lo mida.

## Restricciones de la sesión

- NUNCA `git stash`.
- No matar servidores ajenos. **El usuario tiene un stack `play` corriendo en los puertos por defecto y está jugando**: no se toca. `qa/run.mjs` elige su propio bloque.
- No tocar el tag `mutacion-ultima` ni `reports/mutation/` del árbol principal.
- `bateria-n.log` es de otra sesión.
- Hay otras tandas en paralelo: BX (terminar conversación, `dialogue-panel.ts` y `start.sh`), BY (saltar), BZ (lo que ve el motor) y CA (#790). Si tu cambio pisa sus ficheros, dilo en tu informe.

## Ajustes tras la crítica (decisión del coordinador)

- Se acepta el reencuadre. Alcance: (a) reuso HONESTO: available_assets filtrado por el mismo estilo que entra en la clave de caché (cambia el contrato de GET /assets: se hace) y el prompt deja de prometer «for free» fuera de ese estilo; (b) tamaño: se quita la indentación del JSON y los campos que el motor no usa de cada asset (hash/created_at/…, verificar cuáles usa); las INSTRUCCIONES fijas (~41 KB) NO se recortan en esta tanda — son la calidad del motor, recortarlas es otra decisión — pero el candado mide el texto COMPLETO de narrative_listen con techo = lo medido tras el cambio, para que no crezca a ciegas. (c) Orden: CA (#790) va primero; el ingeniero de BZ arranca cuando CA esté en main.


> **Corrección de la premisa (crítica BZ).** `available_assets` pesa ~7,8 KB de ~60 KB (12 %); el grueso son ~41 KB de instrucciones fijas (`tile_instructions.md` + `scene_instructions.md` + `world_rules.md`) que se reenvían en cada petición de escena, más ~4,5 KB de indentación del JSON. Y reusar una superficie de otro estilo NO es cache-hit: la clave lleva el estilo, así que es un repintado pagado.
>
> Lo que se pide, en dos partes independientes:
> 1. **Reuso honesto.** El motor solo ve superficies cuyo `style` (el mismo valor que entra en la clave de caché) es el de la partida. Hoy `GET /assets` no devuelve `extra`: el contrato del store cambia. El prompt deja de prometer «gratis» donde no lo es. Test en `test_available_assets.py` con filas de dos estilos.
> 2. **Tamaño.** La petición completa de `narrative_listen` (texto entero que devuelve la tool, no solo `available_assets`) cabe con holgura bajo el tope de la tool MCP. El candado mide ESE texto reconstruido desde un save realista y falla por encima de un umbral declarado con su motivo. El dial principal son las instrucciones fijas; los campos que el motor no usa (`hash`, `type`, `subtype`, `created_at` de cada asset) y la indentación son secundarios.
>
> Coordinar con la tanda CA (#790): las dos tocan `narrative-mcp/server.ts` y los prompts.
