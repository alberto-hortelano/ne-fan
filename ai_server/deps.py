"""Estado runtime del ai_server — sustituye a los 18 globals de main.py.

Un único objeto `deps` (singleton de proceso) que el lifespan de FastAPI
puebla al arrancar y los endpoints/routers leen. Ventajas sobre los globals:
un solo home tipado, sin sentencias `global`, y los routers por dominio
(routers/*.py) pueden importarlo sin ciclos con main.py. Los tests pueden
sustituir atributos individuales por fakes.

Las anotaciones son strings a propósito: importar aquí los generadores
arrastraría dependencias pesadas al import de cualquier módulo que solo
quiera leer `deps.config`.
"""
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from asset_cache import AssetCache
    from asset_store_client import AssetStoreClient
    from llm_client import LLMClient
    from style_packs import StylePackResolver


class Deps:
    llm_client: "LLMClient | None" = None
    style_packs: "StylePackResolver | None" = None
    # Librería de superficies de la vista fps (kind "surface", remote-gen).
    surface_cache: "AssetCache | None" = None
    surface_atlas_gen = None
    # Cliente HTTP del asset-store (F2) — conserva el nombre histórico porque
    # AssetCache/llm_client lo consumen por duck typing (register/list_assets).
    asset_manifest: "AssetStoreClient | None" = None
    config: dict = {}


deps = Deps()
