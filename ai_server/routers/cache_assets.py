"""Toggle del cache de modo dev (lo único que queda aquí tras F2).

El resto del fichero histórico —blobs /cache/*, /assets*, prune, manifest—
vive ahora en el asset-store (nefan-core/services/asset-store/, :8767);
routers/asset_proxy.py proxya esas rutas para los clientes no migrados
(Godot). /dev/api_cache se queda: es estado del ADAPTADOR de APIs de pago
(remote-gen, F4), no del almacén de assets.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from dev_api_cache import DEV_API_CACHE

router = APIRouter()


class DevApiCacheRequest(BaseModel):
    enabled: bool


@router.get("/dev/api_cache")
async def dev_api_cache_status():
    """Estado del cache de modo dev (toggle de la top bar del cliente 2D):
    on/off + último payload guardado por canal de API."""
    return DEV_API_CACHE.status()


@router.post("/dev/api_cache")
async def dev_api_cache_toggle(body: DevApiCacheRequest):
    """Enciende/apaga el modo dev: con él activo, cada API de IA de pago
    (Meshy i2i, Meshy 3D, fal) devuelve su última respuesta cacheada en vez
    de llamar de verdad. Persiste en disco (sobrevive reinicios)."""
    DEV_API_CACHE.set_enabled(body.enabled)
    return DEV_API_CACHE.status()
