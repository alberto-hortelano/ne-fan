"""Disk-based asset cache: blobs + hashing content-addressed.

The cache directory holds blob files keyed by SHA256(prompt+context)[:16].
El ÍNDICE de assets (el antiguo `AssetManifest` sobre cache/manifest.json)
vive desde F2 en el asset-store (nefan-core/services/asset-store/, SQLite);
aquí `manifest` es cualquier objeto con `.register(...)` — en producción, el
`AssetStoreClient` (HTTP). El HASHING se queda en Python a propósito:
`hash_key()` depende del str() de Python sobre el context (bools, listas) y
portarlo bifurcaría la caché entera.
"""

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Protocol


class ManifestRegistrar(Protocol):
    """Superficie mínima que AssetCache necesita del índice (duck typing)."""

    def register(
        self,
        hash_key: str,
        asset_type: str,
        subtype: str,
        prompt: str,
        size_bytes: int,
        extra: dict | None = None,
    ) -> None: ...


class AssetCache:
    def __init__(
        self,
        cache_dir: str = "cache/textures",
        asset_type: str = "texture",
        manifest: ManifestRegistrar | None = None,
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.asset_type = asset_type
        self.manifest = manifest
        print(f"AssetCache[{asset_type}]: {self.cache_dir.resolve()}")

    def hash_key(self, prompt: str, context: dict | None = None) -> str:
        """Hash a prompt, optionally with extra context (e.g. angle, style_token).

        The context dict participates in the hash so two requests with the same
        prompt but different parameters get distinct cache slots. Keys are
        sorted for deterministic hashing.
        """
        parts = [prompt.strip().lower()]
        if context:
            for k in sorted(context.keys()):
                v = context[k]
                if v is None or v == "":
                    continue
                parts.append(f"{k}={v}")
        return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:16]

    def get_path(self, key: str, map_type: str) -> Path:
        ext = ".glb" if map_type == "model" else ".png"
        return self.cache_dir / key / f"{map_type}{ext}"

    def has(self, prompt: str, map_type: str = "albedo", context: dict | None = None) -> bool:
        key = self.hash_key(prompt, context)
        return self.get_path(key, map_type).exists()

    def has_all(self, prompt: str, map_types: list[str] | None = None) -> bool:
        if map_types is None:
            map_types = ["albedo", "normal"]
        return all(self.has(prompt, mt) for mt in map_types)

    def get(self, prompt: str, map_type: str = "albedo", context: dict | None = None) -> bytes | None:
        key = self.hash_key(prompt, context)
        path = self.get_path(key, map_type)
        if path.exists():
            return path.read_bytes()
        return None

    def get_by_hash(self, key: str, map_type: str) -> bytes | None:
        path = self.get_path(key, map_type)
        if path.exists():
            return path.read_bytes()
        return None

    def put(
        self,
        prompt: str,
        map_type: str,
        data: bytes,
        context: dict | None = None,
        subtype_override: str | None = None,
    ) -> str:
        key = self.hash_key(prompt, context)
        path = self.get_path(key, map_type)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write: temp file + rename
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            os.write(fd, data)
            os.close(fd)
            os.replace(tmp, path)
        except Exception:
            os.close(fd)
            try:
                os.unlink(tmp)
            except OSError as cleanup_err:
                # Original error wins (re-raised below); we still log the
                # cleanup failure so a leaked tmp file is visible.
                print(
                    f"AssetCache: failed to remove temp file {tmp}: {cleanup_err}",
                    flush=True,
                )
            raise
        if self.manifest is not None:
            self.manifest.register(
                hash_key=key,
                asset_type=self.asset_type,
                subtype=subtype_override or map_type,
                prompt=prompt,
                size_bytes=len(data),
                extra=context or None,
            )
        return key

    def list_cached(self) -> list[dict]:
        result = []
        if not self.cache_dir.exists():
            return result
        for entry in self.cache_dir.iterdir():
            if entry.is_dir():
                maps = [
                    f.stem
                    for f in entry.iterdir()
                    if f.suffix in (".png", ".glb")
                ]
                result.append({"hash": entry.name, "maps": maps})
        return result
