"""Style packs — imágenes de referencia de estilo por juego.

Un pack vive en `nefan-core/data/styles/{style_id}/` (style.json + imágenes;
ver StyleManifestSchema en nefan-core/src/games/loader.ts, la fuente de
verdad del formato). Las refs son LIBRES: cada imagen declara un `id`
estable, un archivo dentro de la carpeta de su vista (overworld/ |
proscenium/ | fps/ | characters/) y una descripción. Este módulo resuelve la
referencia de una petición de imagen por su `id` (elegido por el motor
narrativo); sin elección o con id desconocido cae a la PRIMERA ref de la
vista en el orden del manifest (fallback determinista) y, si esa imagen aún
no existe en disco (pack en construcción), a la siguiente de la misma vista.

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

#: Carpetas de vista admitidas en un pack (espejo de STYLE_REF_FOLDERS en
#: nefan-core/src/games/style-refs.ts; "characters" es pseudo-vista de model
#: sheets compartidos). La vista de una ref ES la carpeta de su archivo.
REF_FOLDERS = ("overworld", "proscenium", "fps", "characters")

#: Rol especial: la lámina de materiales del atlas fps (resolve_fps_sheet).
ROLE_FPS_SURFACES = "fps_surfaces"


def ref_folder(file: str) -> str:
    """Carpeta de vista de una ref por su ruta ("" si no cae en ninguna)."""
    folder = str(file).split("/", 1)[0] if "/" in str(file) else ""
    return folder if folder in REF_FOLDERS else ""


@dataclass(frozen=True)
class StyleRef:
    """Referencia resuelta de un pack: lista para pasar a Meshy."""

    style_id: str
    ref_id: str
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

    def _refs_for_view(self, manifest: dict, view: str) -> list[dict]:
        """Refs elegibles de una vista, en orden de manifest (la primera es
        el fallback). La lámina fps_surfaces queda fuera — no es temática."""
        out: list[dict] = []
        for r in manifest.get("refs", []):
            if str(r.get("role") or "") == ROLE_FPS_SURFACES:
                continue
            if ref_folder(str(r.get("file", ""))) == view:
                out.append(r)
        return out

    def resolve(self, style_id: str, ref_id: str, view: str) -> StyleRef | None:
        """Devuelve la referencia `ref_id` del pack para la vista `view`
        (overworld|proscenium|fps|characters). Sin `ref_id`, o con un id que
        no existe en esa vista, cae a la primera ref de la vista en orden de
        manifest; si su imagen aún no existe en disco (pack en construcción)
        prueba las siguientes DE LA MISMA VISTA — una ref nunca cruza de
        vista (una cenital contaminaría un plató y viceversa). None si el
        pack no tiene ninguna imagen utilizable (el llamador degrada al
        estilo global)."""
        if view not in REF_FOLDERS:
            print(f"StylePacks WARNING: vista desconocida '{view}' — usando overworld", flush=True)
            view = "overworld"
        manifest = self._manifest(style_id)
        if not manifest:
            return None
        candidates = self._refs_for_view(manifest, view)
        if not candidates:
            print(
                f"StylePacks: '{style_id}' sin refs declaradas para la vista '{view}' — "
                "se usará la referencia global",
                flush=True,
            )
            return None
        chosen = next((r for r in candidates if str(r.get("id")) == ref_id), None) if ref_id else None
        if ref_id and chosen is None:
            print(
                f"StylePacks WARNING: ref '{ref_id}' no existe en '{style_id}' ({view}) — "
                f"fallback a la primera de la vista ('{candidates[0].get('id')}')",
                flush=True,
            )
        order = ([chosen] if chosen else []) + [r for r in candidates if r is not chosen]
        for r in order:
            loaded = self._load_image(style_id, str(r.get("file", "")))
            if loaded:
                data_uri, content_hash = loaded
                return StyleRef(
                    style_id=style_id,
                    ref_id=str(r.get("id", "")),
                    data_uri=data_uri,
                    content_hash=content_hash,
                    style_token=str(manifest.get("style_token", "")),
                )
        print(
            f"StylePacks: '{style_id}' sin imagen utilizable para la vista '{view}' "
            "(pack aún sin generar?) — se usará la referencia global",
            flush=True,
        )
        return None

    def resolve_fps_sheet(self, style_id: str) -> StyleRef | None:
        """La lámina de materiales del pack (ref con role fps_surfaces). No
        admite sustituto: una escena contaminaría los swatches planos. Existe
        o None (el atlas degrada a solo style_token)."""
        manifest = self._manifest(style_id)
        if not manifest:
            return None
        for r in manifest.get("refs", []):
            if str(r.get("role") or "") != ROLE_FPS_SURFACES:
                continue
            loaded = self._load_image(style_id, str(r.get("file", "")))
            if loaded:
                data_uri, content_hash = loaded
                return StyleRef(
                    style_id=style_id,
                    ref_id=str(r.get("id", "")),
                    data_uri=data_uri,
                    content_hash=content_hash,
                    style_token=str(manifest.get("style_token", "")),
                )
            print(
                f"StylePacks: lámina fps de '{style_id}' declarada pero sin imagen — "
                "el atlas irá solo con el style_token",
                flush=True,
            )
            return None
        return None

    def list_styles(self) -> list[dict]:
        """Estilos disponibles (id, nombre, descripción) — para que el motor
        narrativo sugiera uno al desarrollar un mundo de usuario."""
        out: list[dict] = []
        if not self._styles_dir.exists():
            return out
        for child in sorted(self._styles_dir.iterdir()):
            # Directorios de soporte (p. ej. _plantilla) no son estilos.
            if not child.is_dir() or child.name.startswith(("_", ".")):
                continue
            manifest = self._manifest(child.name)
            if manifest:
                out.append({
                    "style_id": str(manifest.get("style_id", child.name)),
                    "name": str(manifest.get("name", child.name)),
                    "description": str(manifest.get("description", "")),
                    # Etiquetas temáticas: el motor elige un estilo compatible
                    # con las del mundo que desarrolla (develop_world).
                    "tags": [str(t) for t in manifest.get("tags", [])],
                })
        return out

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
