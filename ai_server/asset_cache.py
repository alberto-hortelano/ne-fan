"""Disk-based asset cache with shared manifest of generated assets.

The cache directory holds blob files keyed by SHA256(prompt)[:16]. The shared
`AssetManifest` (one JSON file per cache root) tracks every blob along with its
prompt, so the narrative engine can browse what already exists and reuse it.
"""

import hashlib
import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AssetManifest:
    """Shared, append-only index of all generated assets across cache types."""

    def __init__(self, manifest_path: Path):
        self.path = Path(manifest_path)
        self._lock = threading.Lock()
        self._entries: list[dict] = []
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text())
            if isinstance(data, list):
                self._entries = data
        except (json.JSONDecodeError, OSError) as e:
            print(f"AssetManifest: failed to load {self.path}: {e}")

    def _save_locked(self) -> None:
        # Caller must hold self._lock.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self._entries, indent=2, ensure_ascii=False)
        )
        os.replace(tmp, self.path)

    def register(
        self,
        hash_key: str,
        asset_type: str,
        subtype: str,
        prompt: str,
        size_bytes: int,
        extra: dict | None = None,
    ) -> None:
        with self._lock:
            for e in self._entries:
                if (
                    e.get("hash") == hash_key
                    and e.get("type") == asset_type
                    and e.get("subtype") == subtype
                ):
                    return
            self._entries.append(
                {
                    "hash": hash_key,
                    "type": asset_type,
                    "subtype": subtype,
                    "prompt": prompt,
                    "created_at": _now(),
                    "size_bytes": int(size_bytes),
                    "extra": extra or {},
                }
            )
            self._save_locked()

    def list_assets(
        self,
        asset_type: str | None = None,
        limit: int = 50,
        collapse_subtypes: bool = True,
    ) -> list[dict]:
        with self._lock:
            entries = list(self._entries)
        if asset_type:
            entries = [e for e in entries if e.get("type") == asset_type]
        entries.reverse()
        if collapse_subtypes:
            seen: set[tuple[str, str]] = set()
            collapsed: list[dict] = []
            for e in entries:
                key = (e.get("hash", ""), e.get("type", ""))
                if key in seen:
                    continue
                seen.add(key)
                collapsed.append(
                    {
                        "hash": e.get("hash"),
                        "type": e.get("type"),
                        "prompt": e.get("prompt"),
                        "created_at": e.get("created_at"),
                    }
                )
            entries = collapsed
        return entries[:limit]

    def find_by_hash(self, hash_key: str) -> list[dict]:
        with self._lock:
            return [e for e in self._entries if e.get("hash") == hash_key]

    def find_by_prompt(
        self, prompt: str, asset_type: str | None = None
    ) -> list[dict]:
        normalized = prompt.strip().lower()
        with self._lock:
            return [
                e
                for e in self._entries
                if e.get("prompt", "").strip().lower() == normalized
                and (asset_type is None or e.get("type") == asset_type)
            ]

    def total_count(self) -> int:
        with self._lock:
            return len(self._entries)

    def scan_directory(
        self,
        cache_dir: Path,
        asset_type: str,
        subtypes_by_filename: dict[str, str],
    ) -> int:
        """One-shot scan of a cache directory to rebuild manifest entries for
        existing files. Used to recover assets generated before the manifest
        existed. Adds entries with empty `prompt` (unknown). Returns count added."""
        if not cache_dir.exists():
            return 0
        added = 0
        for entry in cache_dir.iterdir():
            if not entry.is_dir():
                continue
            hash_key = entry.name
            for f in entry.iterdir():
                subtype = subtypes_by_filename.get(f.name)
                if subtype is None:
                    continue
                with self._lock:
                    already = any(
                        e.get("hash") == hash_key
                        and e.get("type") == asset_type
                        and e.get("subtype") == subtype
                        for e in self._entries
                    )
                    if already:
                        continue
                    try:
                        size = f.stat().st_size
                    except OSError:
                        size = 0
                    self._entries.append(
                        {
                            "hash": hash_key,
                            "type": asset_type,
                            "subtype": subtype,
                            "prompt": "",  # unknown — file pre-dates manifest
                            "created_at": _now(),
                            "size_bytes": size,
                            "extra": {"recovered": True},
                        }
                    )
                    added += 1
        if added > 0:
            with self._lock:
                self._save_locked()
        return added


class AssetCache:
    def __init__(
        self,
        cache_dir: str = "cache/textures",
        asset_type: str = "texture",
        manifest: AssetManifest | None = None,
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
            except OSError:
                pass
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
