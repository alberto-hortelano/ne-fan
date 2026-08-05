"""Cliente HTTP del asset-store (S6, :8767) — sustituye a AssetManifest.

Desde F2 el índice de assets vive en el proceso asset-store
(nefan-core/services/asset-store/, SQLite). Este cliente expone SOLO los
métodos que ai_server usa de verdad, con la misma firma que tenía
AssetManifest (duck typing: AssetCache.put() y llm_client no se tocan):

- register()      → POST /assets       (fail-loud: si el store no responde,
                    la generación DEBE fallar ruidosa — igual que fallaba el
                    rewrite del manifest.json con un OSError)
- list_assets()   → GET /assets        (available_assets del LLM)
- total_count()   → GET /health        (log de arranque)
- total_bytes()   → GET /health        (health de ai_server; best-effort → 0)
- prune()         → POST /cache/prune  (arranque; best-effort)

El hashing NO viaja: hash_key() sigue en AssetCache (Python) y el store
recibe el hash hecho.
"""
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_S = 5.0


class AssetStoreClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (
            base_url
            or os.environ.get("NEFAN_URL_ASSET_STORE")
            or "http://127.0.0.1:8767"
        ).rstrip("/")
        self._client = httpx.Client(base_url=self.base_url, timeout=_TIMEOUT_S)

    # ── Escritura (fail-loud) ──

    def register(
        self,
        hash_key: str,
        asset_type: str,
        subtype: str,
        prompt: str,
        size_bytes: int,
        extra: dict | None = None,
    ) -> None:
        payload = {
            "hash": hash_key,
            "type": asset_type,
            "subtype": subtype,
            "prompt": prompt,
            "size_bytes": size_bytes,
        }
        if extra is not None:
            payload["extra"] = extra
        # Un retry único con backoff corto cubre arranques solapados del
        # stack; a partir de ahí, fail-loud (el caller decide).
        last_err: Exception | None = None
        for attempt in range(2):
            try:
                res = self._client.post("/assets", json=payload)
                res.raise_for_status()
                return
            except httpx.HTTPError as err:
                last_err = err
                if attempt == 0:
                    time.sleep(0.5)
        raise RuntimeError(
            f"asset-store register failed ({self.base_url}/assets): {last_err}"
        ) from last_err

    # ── Lectura ──

    def list_assets(self, asset_type: str | None = None, limit: int = 50) -> list[dict]:
        params: dict = {"limit": limit}
        if asset_type:
            params["asset_type"] = asset_type
        res = self._client.get("/assets", params=params)
        res.raise_for_status()
        return res.json().get("assets", [])

    def _health(self) -> dict:
        res = self._client.get("/health")
        res.raise_for_status()
        return res.json()

    def total_count(self) -> int:
        """Best-effort: el log de arranque no debe tumbar el server."""
        try:
            return int(self._health().get("total_count", 0))
        except httpx.HTTPError as err:
            logger.warning("asset-store total_count unavailable: %s", err)
            return 0

    def total_bytes(self) -> int:
        """Best-effort: /health de ai_server sigue vivo con el store caído."""
        try:
            return int(self._health().get("total_bytes", 0))
        except httpx.HTTPError as err:
            logger.warning("asset-store total_bytes unavailable: %s", err)
            return 0

    def prune(self) -> dict:
        """Best-effort (arranque): el 400 'sin límite' o el store caído se
        degradan a no-op con warning."""
        try:
            res = self._client.post("/cache/prune")
            if res.status_code == 400:
                logger.warning("asset-store prune rechazado: %s", res.text)
                return {"pruned": 0, "freed_bytes": 0, "total_bytes": 0}
            res.raise_for_status()
            return res.json()
        except httpx.HTTPError as err:
            logger.warning("asset-store prune unavailable: %s", err)
            return {"pruned": 0, "freed_bytes": 0, "total_bytes": 0}

    def close(self) -> None:
        self._client.close()
