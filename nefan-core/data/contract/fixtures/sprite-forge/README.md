# Fixtures canónicas del wire de sprite-forge

Respuestas **reales** del servicio sprite-forge (repo hermano), emitidas por su
propio código sobre un árbol de assets sintético: sin Chrome, sin FBX con
licencia, sin ninguna API de pago y deterministas (mismos bytes en cada
corrida). Son el punto de comparación que le faltaba a las copias del
contrato: el espejo TS (`src/contracts/sprite-forge.ts`), el fake del bench
(`labs/narrative/fake-ai-server.ts`) y el doble de los tests Python
(`ai_server/tests/test_sprite_forge_adapter.py`) se validan contra ELLAS, no
entre sí.

| Fichero | Qué es |
|---|---|
| `catalog.json` | `GET /catalog` — incluye una anim sana por perfil y una (`rota`) que no se puede costear, con su `skin_plan_error` |
| `sheets.json` | `POST /sheets` (formato `none`) — el meta de una hoja BASE, con `generated_at` |
| `identity.json` | `POST /identity` — el hero-shot |
| `skins.json` | `POST /skins` — el meta del sheet VESTIDO (sin `generated_at`, con bloque `skin`) y sus frames |
| `procedencia.json` | De qué versión de sprite-forge salieron y con qué comando |

**Quién las valida**: `nefan-core/test/contract-sprite-forge.test.ts` (zod del
espejo contra las fixtures; si una falta, rojo — nunca skip) y
`ai_server/tests/test_sprite_forge_adapter.py` (el sprite-forge de mentira
contesta estos cuerpos, no unos inventados).

**Regenerar** (cuando cambie el contrato de sprite-forge; requiere el repo
hermano al lado):

```bash
cd ../sprite-forge && npm run fixtures-contrato -- \
  --out "$(pwd)/../ne-fan/nefan-core/data/contract/fixtures/sprite-forge"
```

No se editan a mano: un fixture retocado ya no es la respuesta del servicio y
el candado pasa a comparar el espejo contra un deseo.
