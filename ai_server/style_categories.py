"""Categorías de estilo — FUENTE ÚNICA del lado Python.

Espejo de nefan-core/src/games/style-categories.ts. El codegen TS
(`npm run gen:contract`) emite nefan-core/data/contract/style_categories.json
desde esa fuente; tests/test_style_categories_sync.py compara este módulo con
ese JSON — una categoría añadida o retirada en un solo lado rompe CI.

De aquí derivan style_packs.py (resolución de refs), narrative_schemas.py
(descarte de style_tag inválido) y routers/remote_generation.py (patrón del
campo style_tag). Módulo de constantes puras: sin imports pesados para que
cualquier test lo cargue sin deps de GPU/PIL.
"""

# Zonas de mundo abierto: cada referencia es una escena completa con varios
# elementos y transiciones a las zonas vecinas (ver data/styles/README.md).
ENV_CATEGORIES = (
    "settlement", "farmland", "forest", "wetland", "desert", "snow",
    "fortress", "interior", "underground",
)

CHARACTER_CATEGORIES = ("character_commoner", "character_noble", "character_warrior")

# Categorías de PLATÓ (vista proscenio): referencias a nivel de suelo.
STAGE_CATEGORIES = (
    "stage_interior", "stage_street", "stage_plaza",
    "stage_nature", "stage_harbor", "stage_gate",
)

# Categorías de la vista FPS: fps_surfaces es una LÁMINA DE MUESTRAS de
# materiales (rejilla de swatches frontales a 90°), no una escena — 2ª ref de
# cada página del atlas de superficies. Su resolver NUNCA cae a las zonas
# cenitales; sin lámina el atlas degrada a solo style_token.
FPS_CATEGORIES = ("fps_surfaces",)

# Alias legacy: packs y escenas anteriores al set de zonas usaban "nature".
LEGACY_ALIASES = {"nature": "forest"}

# Zona cenital → plató más cercano: red de seguridad para escenas proscenio
# etiquetadas con vocabulario de zona (motor legacy, fixtures viejas).
ZONE_TO_STAGE = {
    "interior": "stage_interior",
    "underground": "stage_interior",
    "settlement": "stage_street",
    "farmland": "stage_street",
    "fortress": "stage_gate",
    "forest": "stage_nature",
    "wetland": "stage_nature",
    "desert": "stage_nature",
    "snow": "stage_nature",
    "nature": "stage_nature",
}

# style_tag admitido en el wire: zonas + platós + alias legacy (se tolera en
# entrada; las superficies OFRECIDAS al modelo — tool JSON, prompts — no lo
# incluyen).
ALL_STYLE_TAGS = frozenset(ENV_CATEGORIES) | frozenset(STAGE_CATEGORIES) | frozenset(LEGACY_ALIASES)

# Patrón Pydantic del campo style_tag ("" = sin tag). Orden estable para que
# el openapi generado sea determinista.
STYLE_TAG_PATTERN = "^(" + "|".join(sorted(ALL_STYLE_TAGS)) + ")?$"
