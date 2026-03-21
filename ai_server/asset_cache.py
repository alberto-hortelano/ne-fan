"""Disk-based asset cache using SHA256(prompt) as key."""

import hashlib
import os
import tempfile
from pathlib import Path


class AssetCache:
    def __init__(self, cache_dir: str = "cache/textures"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        print(f"AssetCache: {self.cache_dir.resolve()}")

    def hash_key(self, prompt: str) -> str:
        return hashlib.sha256(prompt.strip().lower().encode()).hexdigest()[:16]

    def get_path(self, key: str, map_type: str) -> Path:
        ext = ".glb" if map_type == "model" else ".png"
        return self.cache_dir / key / f"{map_type}{ext}"

    def has(self, prompt: str, map_type: str = "albedo") -> bool:
        key = self.hash_key(prompt)
        return self.get_path(key, map_type).exists()

    def has_all(self, prompt: str, map_types: list[str] = None) -> bool:
        if map_types is None:
            map_types = ["albedo", "normal"]
        return all(self.has(prompt, mt) for mt in map_types)

    def get(self, prompt: str, map_type: str = "albedo") -> bytes | None:
        key = self.hash_key(prompt)
        path = self.get_path(key, map_type)
        if path.exists():
            return path.read_bytes()
        return None

    def get_by_hash(self, key: str, map_type: str) -> bytes | None:
        path = self.get_path(key, map_type)
        if path.exists():
            return path.read_bytes()
        return None

    def put(self, prompt: str, map_type: str, data: bytes) -> str:
        key = self.hash_key(prompt)
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
            os.unlink(tmp)
            raise
        return key

    def list_cached(self) -> list[dict]:
        result = []
        if not self.cache_dir.exists():
            return result
        for entry in self.cache_dir.iterdir():
            if entry.is_dir():
                maps = [f.stem for f in entry.iterdir() if f.suffix == ".png"]
                result.append({"hash": entry.name, "maps": maps})
        return result
