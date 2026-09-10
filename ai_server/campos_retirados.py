"""Los campos RETIRADOS del contrato de escena y con qué se rebotan.

NO se copian: se LEEN del snapshot `nefan-core/data/contract/campos-retirados.json`
que vuelca `scripts/dump-campos-retirados.ts` desde la fuente única
(`nefan-core/src/contract/model-io/retired-terrain-fields.ts`). Mismo patrón que
`physics.json`, y aprendido igual de caro: hasta #466 este fichero declaraba los
motivos a mano prometiendo ser «los MISMOS que los del zod, palabra por palabra»,
y `qa/los-dos-gates-rebotan-igual.mjs` midió CINCO divergencias — dos de las
claves de entity no estaban en la tabla de la raíz (se rebotaban con el
genérico) y la entity se rotulaba de otra forma. El mismo tile recibía dos
textos según por dónde entrase.

Que el snapshot esté fresco lo canda `nefan-core/test/contract-campos-retirados.test.ts`;
que los dos gates digan lo mismo de punta a punta, el guion de QA de arriba.

Como aquí ya no se escribe ningún nombre de campo retirado, este fichero dejó de
necesitar exención en `campos-retirados-no-vuelven` (arch-rules.json).
"""

import json
import os
from pathlib import Path

CAMPOS_RETIRADOS_PATH = Path(
    os.environ.get(
        "NEFAN_CONTRACT_CAMPOS_RETIRADOS",
        Path(__file__).resolve().parent.parent / "nefan-core" / "data" / "contract" / "campos-retirados.json",
    )
)


def _load(path: Path | None = None) -> dict:
    """El snapshot. Fail-loud: sin él no hay motivos inventados — inventarlos es
    exactamente cómo se diverge."""
    p = Path(path) if path else CAMPOS_RETIRADOS_PATH
    if not p.exists():
        raise FileNotFoundError(
            f"campos-retirados.json not found at {p}. "
            "Run `cd nefan-core && npm run dump-campos-retirados` to regenerate it."
        )
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    for key in ("motivos", "motivos_solo_de_raiz", "rotulo_de_entity", "rotulo_de_entity_sin_id"):
        if key not in data:
            raise ValueError(
                f"{p} has no `{key}`. Regenerate it with `npm run dump-campos-retirados`."
            )
    return data


_SNAP = _load()

# Claves de una ENTITY: la tabla COMPARTIDA del zod (`MOTIVOS` en
# retired-terrain-fields.ts). Es la misma que sirve a la raíz, porque ninguna
# clave está en las dos y así quien pregunte por una recibe UNA respuesta.
MOTIVO_DE_CLAVE_DE_ENTITY_RETIRADA = dict(_SNAP["motivos"])

# Claves de la RAÍZ de la escena: las compartidas más las tres cuyo motivo tiene
# otra forma (nombran la variante viva, el catálogo que ya no existe o la marca
# interna del expander), igual que `mensajeDeClaveRetiradaDeRaiz` del zod.
MOTIVO_DE_CLAVE_RETIRADA = {**_SNAP["motivos"], **_SNAP["motivos_solo_de_raiz"]}

# Cómo se nombra a la entity que trae la clave, con y sin `id`.
ROTULO_DE_ENTITY = _SNAP["rotulo_de_entity"]
ROTULO_DE_ENTITY_SIN_ID = _SNAP["rotulo_de_entity_sin_id"]


def rotulo_de_entity(eid) -> str:
    """Espejo de `rotuloDeEntity` (nefan-core): con su `id` si lo trae."""
    return ROTULO_DE_ENTITY.replace("{id}", eid) if isinstance(eid, str) and eid else ROTULO_DE_ENTITY_SIN_ID
