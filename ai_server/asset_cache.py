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
    """Blobs PNG de UN kind bajo `cache_dir/{hash}/{map_type}.png`. El único
    productor vivo es remote_gen_main.py con el kind `surface` (#257); los
    defaults son ese kind y no otro para que instanciarlo sin argumentos no
    resucite un directorio sin productor."""

    def __init__(
        self,
        cache_dir: str = "cache/surfaces",
        asset_type: str = "surface",
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
        return self.cache_dir / key / f"{map_type}.png"

    def has(self, prompt: str, map_type: str, context: dict | None = None) -> bool:
        key = self.hash_key(prompt, context)
        return self.get_path(key, map_type).exists()

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
                subtype=map_type,
                prompt=prompt,
                size_bytes=len(data),
                extra=context or None,
            )
        return key
