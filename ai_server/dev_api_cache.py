"""Cache de modo desarrollo para las APIs de IA de pago (Meshy, fal).

Con el modo activo, cada llamada a una API externa devuelve el ÚLTIMO
resultado que esa API produjo — cache por API/canal, NO por petición — para
ejercitar los pipelines completos sin gastar créditos. Si un canal aún no
tiene valor guardado, la primera llamada pasa de verdad y queda cacheada.

El último payload de cada canal se guarda SIEMPRE (también con el modo
apagado): al encender el toggle ya está disponible "la última respuesta real"
de cada API. Estado y payloads persisten en `cache/dev_api_cache/` y
sobreviven reinicios. El toggle vive en la top bar del cliente 2D (sustituyó
a Auto-img) vía GET/POST /dev/api_cache.

IMPORTANTE para los endpoints: los artefactos derivados de respuestas
rancias (sheets skinneados, imágenes de escena, GLBs) NO deben contaminar el
cache real. Cualquier clave de cache derivado debe incluir
`namespace_context()` / `namespace_suffix()` mientras el modo está activo.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Awaitable, Callable
from pathlib import Path


def _safe_channel(channel: str) -> str:
    if not re.fullmatch(r"[a-z0-9_]+", channel):
        raise ValueError(f"dev_api_cache: canal inválido {channel!r} (usar [a-z0-9_]+)")
    return channel


class DevApiCache:
    def __init__(self, root: Path):
        self.root = root
        self._state_path = root / "state.json"
        self._enabled = False
        self._state_sig: tuple[int, int] | None = None
        self._refresh_enabled()

    def _refresh_enabled(self) -> None:
        """Relee state.json si cambió en disco. El toggle (POST /dev/api_cache)
        vive en UN proceso (remote-gen tras F4) pero el flag lo consumen TODOS
        (gpu-worker namespacea claves de modelo, narrative-llm cachea canales
        fal): un stat() por acceso mantiene la vista compartida sin IPC. La
        firma incluye el inode además del mtime: set_enabled escribe vía
        tmp+replace (inode nuevo), así dos toggles dentro del mismo tick del
        reloj no pasan desapercibidos."""
        try:
            st = self._state_path.stat()
        except FileNotFoundError:
            self._enabled = False
            self._state_sig = None
            return
        sig = (st.st_mtime_ns, st.st_ino)
        if sig == self._state_sig:
            return
        self._enabled = bool(json.loads(self._state_path.read_text()).get("enabled", False))
        self._state_sig = sig

    @property
    def enabled(self) -> bool:
        self._refresh_enabled()
        return self._enabled

    def set_enabled(self, on: bool) -> None:
        self._enabled = bool(on)
        self.root.mkdir(parents=True, exist_ok=True)
        # Escritura atómica: otro proceso puede estar releyendo el flag justo
        # ahora — un write_text a medias le rompería el json.loads.
        tmp = self._state_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"enabled": self._enabled}))
        tmp.replace(self._state_path)
        st = self._state_path.stat()
        self._state_sig = (st.st_mtime_ns, st.st_ino)
        print(f"DevApiCache: {'ON — sirviendo últimas respuestas' if on else 'OFF — llamadas reales'}")

    # Sufijo/context para namespacear claves de caches derivados en modo dev.
    def namespace_suffix(self) -> str:
        return "devcache" if self.enabled else ""

    def namespace_context(self, context: dict | None = None) -> dict | None:
        if not self.enabled:
            return context
        return {**(context or {}), "devcache": True}

    # ── Almacenamiento: lista de blobs por canal (fal devuelve varias
    #    máscaras; Meshy un solo PNG/GLB — se guarda como [blob]). ──

    def _paths(self, channel: str) -> tuple[Path, Path]:
        c = _safe_channel(channel)
        return self.root / f"{c}.bin", self.root / f"{c}.json"

    def put(self, channel: str, blobs: list[bytes], note: str = "") -> None:
        bin_path, meta_path = self._paths(channel)
        self.root.mkdir(parents=True, exist_ok=True)
        bin_path.write_bytes(b"".join(blobs))
        meta_path.write_text(json.dumps({
            "saved_at": time.time(),
            "note": note[:120],
            "sizes": [len(b) for b in blobs],
        }))

    def get(self, channel: str) -> list[bytes] | None:
        """El último payload del canal, solo con el modo activo."""
        if not self.enabled:
            return None
        bin_path, meta_path = self._paths(channel)
        if not (bin_path.exists() and meta_path.exists()):
            return None
        sizes = json.loads(meta_path.read_text())["sizes"]
        raw = bin_path.read_bytes()
        blobs, off = [], 0
        for s in sizes:
            blobs.append(raw[off:off + s])
            off += s
        return blobs

    # ── Wrappers para los call sites ──

    async def through(
        self, channel: str, call: Callable[[], Awaitable[list[bytes]]], note: str = ""
    ) -> tuple[list[bytes], bool]:
        cached = self.get(channel)
        if cached is not None:
            print(f"DevApiCache: {channel} ← cache (0 llamadas API)")
            return cached, True
        blobs = await call()
        self.put(channel, blobs, note)
        return blobs, False

    def through_sync(
        self, channel: str, call: Callable[[], list[bytes]], note: str = ""
    ) -> tuple[list[bytes], bool]:
        cached = self.get(channel)
        if cached is not None:
            print(f"DevApiCache: {channel} ← cache (0 llamadas API)")
            return cached, True
        blobs = call()
        self.put(channel, blobs, note)
        return blobs, False

    def status(self) -> dict:
        channels = {}
        if self.root.exists():
            for meta_path in sorted(self.root.glob("*.json")):
                if meta_path.name == "state.json":
                    continue
                meta = json.loads(meta_path.read_text())
                channels[meta_path.stem] = {
                    "saved_at": meta["saved_at"],
                    "note": meta.get("note", ""),
                    "bytes": sum(meta["sizes"]),
                    "blobs": len(meta["sizes"]),
                }
        return {"enabled": self.enabled, "channels": channels}


DEV_API_CACHE = DevApiCache(
    Path(__file__).resolve().parent.parent / "cache" / "dev_api_cache"
)
