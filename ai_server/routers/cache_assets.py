"""Toggle del cache de modo dev (lo único que queda aquí tras F2).

El resto del fichero histórico —blobs /cache/*, /assets*, prune, manifest—
vive ahora en el asset-store (nefan-core/services/asset-store/, :8767);
routers/asset_proxy.py proxya esas rutas para los clientes no migrados
(Godot). /dev/api_cache se queda: es estado del ADAPTADOR de APIs de pago
(remote-gen, F4), no del almacén de assets.
"""

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from deps import deps
from dev_api_cache import DEV_API_CACHE
from spend_tracker import SPEND

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


@router.get("/dev/status")
async def dev_status():
    """Estado agregado para el panel de dev del cliente 2D (un solo poll):
    dev-cache + gasto acumulado + config de generación activa + presencia de
    claves (NUNCA sus valores). Contrato en nefan-core/src/contracts."""
    cfg = deps.config
    if not cfg:
        raise HTTPException(status_code=503, detail="config aún no cargada (lifespan)")
    missing = [
        k
        for k in ("scene_model", "stage_scene_model", "sprite_skin_model", "usd_eur_rate")
        if k not in cfg
    ]
    if missing:
        raise HTTPException(
            status_code=500,
            detail=(
                f"runtime_config.json sin {missing}: regenerar con "
                "`cd nefan-core && npx tsx scripts/dump-config.ts` y reiniciar"
            ),
        )
    return {
        "api_cache": DEV_API_CACHE.status(),
        "spend": SPEND.status(),
        "config": {
            "scene_model": cfg["scene_model"],
            "stage_scene_model": cfg["stage_scene_model"],
            "sprite_skin_model": cfg["sprite_skin_model"],
            "usd_eur_rate": cfg["usd_eur_rate"],
        },
        "keys": {
            "meshy": bool(os.environ.get("MESHY_API_KEY")),
            "fal": bool(os.environ.get("FAL_KEY")),
        },
    }
