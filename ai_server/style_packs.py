"""Style packs — imágenes de referencia de estilo por juego.

Un pack vive en `nefan-core/data/styles/{style_id}/` (style.json + imágenes;
ver GameMetaSchema/StyleManifestSchema en nefan-core/src/games/loader.ts, la
fuente de verdad del formato). Este módulo resuelve, para una petición de
imagen, la referencia más apropiada del pack: por `style_tag` explícito del
scene JSON, con fallback a un orden razonable de categorías.

Degradación esperable (pack sin imágenes aún, estilo inexistente): se avisa y
se devuelve None — el llamador usa su referencia global de siempre. Un
style.json malformado sí es error del pack y se loguea como tal.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

RUNTIME_CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "nefan-core" / "data" / "runtime_config.json"
)
REPO_ROOT = Path(__file__).resolve().parent.parent

ENV_CATEGORIES = ("nature", "settlement", "fortress", "interior", "underground")
CHARACTER_CATEGORIES = ("character_commoner", "character_noble", "character_warrior")

# Orden de fallback cuando la categoría pedida no existe en el pack: primero
# lo pedido, luego los entornos más frecuentes en tiles.
_ENV_FALLBACK_ORDER = ("settlement", "nature", "interior", "fortress", "underground")
_CHARACTER_FALLBACK_ORDER = CHARACTER_CATEGORIES


@dataclass(frozen=True)
class StyleRef:
    """Referencia resuelta de un pack: lista para pasar a Meshy."""

    style_id: str
    category: str
    data_uri: str
    #: sha256[:12] del archivo — entra en las claves de cache de imagen.
    content_hash: str
    style_token: str


class StylePackResolver:
    """Carga y cachea style.json + imágenes por mtime (editar un pack en dev
    no requiere reiniciar ai_server, a diferencia del estilo global)."""

    def __init__(self, styles_dir: Path | None = None):
        self._styles_dir = styles_dir if styles_dir is not None else _styles_dir_from_config()
        # style_id -> (mtime de style.json, manifest dict)
        self._manifests: dict[str, tuple[float, dict]] = {}
        # (style_id, file) -> (mtime, data_uri, content_hash)
        self._images: dict[tuple[str, str], tuple[float, str, str]] = {}
        print(f"StylePacks: dir={self._styles_dir}", flush=True)

    def _manifest(self, style_id: str) -> dict | None:
        path = self._styles_dir / style_id / "style.json"
        if not path.exists():
            print(f"StylePacks WARNING: estilo '{style_id}' sin style.json ({path})", flush=True)
            return None
        mtime = path.stat().st_mtime
        cached = self._manifests.get(style_id)
        if cached and cached[0] == mtime:
            return cached[1]
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"StylePacks ERROR: style.json malformado para '{style_id}': {e}", flush=True)
            return None
        self._manifests[style_id] = (mtime, manifest)
        return manifest

    def style_token(self, style_id: str) -> str:
        manifest = self._manifest(style_id)
        return str(manifest.get("style_token", "")) if manifest else ""

    def resolve(self, style_id: str, category: str) -> StyleRef | None:
        """Devuelve la referencia del pack para `category`, con fallback a
        categorías hermanas si esa imagen aún no existe. None si el pack no
        tiene ninguna imagen utilizable (el llamador degrada al estilo global).
        """
        manifest = self._manifest(style_id)
        if not manifest:
            return None
        refs = {r.get("category"): r.get("file") for r in manifest.get("refs", [])}
        is_char = category in CHARACTER_CATEGORIES
        order = (category, *(_CHARACTER_FALLBACK_ORDER if is_char else _ENV_FALLBACK_ORDER))
        for cat in dict.fromkeys(order):  # dedupe conservando orden
            file = refs.get(cat)
            if not file:
                continue
            loaded = self._load_image(style_id, str(file))
            if loaded:
                data_uri, content_hash = loaded
                return StyleRef(
                    style_id=style_id,
                    category=cat,
                    data_uri=data_uri,
                    content_hash=content_hash,
                    style_token=str(manifest.get("style_token", "")),
                )
        print(
            f"StylePacks: '{style_id}' sin imagen utilizable para '{category}' "
            f"(pack aún sin generar?) — se usará la referencia global",
            flush=True,
        )
        return None

    def _load_image(self, style_id: str, file: str) -> tuple[str, str] | None:
        path = self._styles_dir / style_id / file
        if not path.exists():
            return None
        mtime = path.stat().st_mtime
        key = (style_id, file)
        cached = self._images.get(key)
        if cached and cached[0] == mtime:
            return cached[1], cached[2]
        raw = path.read_bytes()
        content_hash = hashlib.sha256(raw).hexdigest()[:12]
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        w, h = img.size
        scale = min(1.0, 1024 / max(w, h))
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        data_uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        self._images[key] = (mtime, data_uri, content_hash)
        return data_uri, content_hash


def _styles_dir_from_config() -> Path:
    """Lee content.styles_dir del runtime_config (path relativo a la raíz del
    repo). Fail-loud: sin bloque content la config está desactualizada."""
    if not RUNTIME_CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"runtime_config.json not found at {RUNTIME_CONFIG_PATH}. "
            "Run `cd nefan-core && npx tsx scripts/dump-config.ts`."
        )
    full = json.loads(RUNTIME_CONFIG_PATH.read_text(encoding="utf-8"))
    content = full.get("content")
    if not isinstance(content, dict) or "styles_dir" not in content:
        raise ValueError(
            f"{RUNTIME_CONFIG_PATH} has no `content.styles_dir`. "
            "Update nefan-core/src/config.ts and regenerate the snapshot."
        )
    return REPO_ROOT / str(content["styles_dir"])
