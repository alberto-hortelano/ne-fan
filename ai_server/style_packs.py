"""Style packs — imágenes de referencia de estilo por juego.

Un pack vive en `nefan-core/data/styles/{style_id}/` (style.json + imágenes;
ver StyleManifestSchema en nefan-core/src/games/loader.ts, la fuente de
verdad del formato). Las refs son LIBRES: cada imagen declara un `id`
estable, un archivo dentro de una carpeta del pack (surfaces/ | faces/ |
characters/) y una descripción. La carpeta es el ROL del contenido, no una
vista de mundo: el juego tiene UNA vista. Este módulo resuelve la referencia
de una petición de imagen por su `id` (elegido por el motor narrativo); en
`characters/`, sin elección o con id desconocido, cae a la PRIMERA ref de la
carpeta en el orden del manifest (fallback determinista) y, si esa imagen aún
no existe en disco (pack en construcción), a la siguiente de la misma
carpeta.

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

#: Carpetas admitidas en un pack (espejo de STYLE_REF_FOLDERS en
#: nefan-core/src/games/style-refs.ts). Cada una es un ROL: surfaces/ la
#: lámina de materiales, faces/ las caras temáticas, characters/ los model
#: sheets. El rol de una ref ES la carpeta de su archivo.
REF_FOLDERS = ("surfaces", "faces", "characters")


def ref_folder(file: str) -> str:
    """Carpeta (rol) de una ref por su ruta ("" si no cae en ninguna)."""
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

    def _refs_for_folder(self, manifest: dict, folder: str) -> list[dict]:
        """Refs de una carpeta, en orden de manifest (la primera es el
        fallback donde lo haya)."""
        return [
            r for r in manifest.get("refs", [])
            if ref_folder(str(r.get("file", ""))) == folder
        ]

    def resolve_character(self, style_id: str, ref_id: str) -> StyleRef | None:
        """Devuelve la ref de personaje `ref_id` (carpeta characters/). Sin
        `ref_id`, o con un id que no existe ahí, cae a la primera del
        manifest; si su imagen aún no existe en disco (pack en construcción)
        prueba las siguientes DE LA MISMA CARPETA — una ref nunca cruza de
        carpeta (un personaje no sirve de superficie). None si el pack no
        tiene ninguna imagen utilizable (el llamador degrada al estilo
        global)."""
        folder = "characters"
        manifest = self._manifest(style_id)
        if not manifest:
            return None
        candidates = self._refs_for_folder(manifest, folder)
        if not candidates:
            print(
                f"StylePacks: '{style_id}' sin refs declaradas en '{folder}/' — "
                "se usará la referencia global",
                flush=True,
            )
            return None
        chosen = next((r for r in candidates if str(r.get("id")) == ref_id), None) if ref_id else None
        if ref_id and chosen is None:
            print(
                f"StylePacks WARNING: ref '{ref_id}' no existe en '{style_id}' ({folder}/) — "
                f"fallback a la primera de la carpeta ('{candidates[0].get('id')}')",
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
            f"StylePacks: '{style_id}' sin imagen utilizable en '{folder}/' "
            "(pack aún sin generar?) — se usará la referencia global",
            flush=True,
        )
        return None

    def resolve_face(self, style_id: str, ref_id: str) -> StyleRef | None:
        """Ref temática de CARA (faces/: fachada, portón…) por id EXACTO,
        SIN fallback: una celda con ref desconocida se pinta SIN ref, con
        warning — nunca con otra imagen (el fail-loud contra el catálogo vive
        en el pre-flight de narrative-mcp)."""
        if not ref_id:
            return None
        manifest = self._manifest(style_id)
        if not manifest:
            return None
        for r in self._refs_for_folder(manifest, "faces"):
            if str(r.get("id")) != ref_id:
                continue
            loaded = self._load_image(style_id, str(r.get("file", "")))
            if loaded:
                data_uri, content_hash = loaded
                return StyleRef(
                    style_id=style_id,
                    ref_id=ref_id,
                    data_uri=data_uri,
                    content_hash=content_hash,
                    style_token=str(manifest.get("style_token", "")),
                )
            print(
                f"StylePacks WARNING: ref de cara '{ref_id}' de '{style_id}' declarada sin imagen",
                flush=True,
            )
            return None
        print(
            f"StylePacks WARNING: ref de cara '{ref_id}' no existe en '{style_id}' — celda sin ref",
            flush=True,
        )
        return None

    def resolve_sheet(self, style_id: str) -> StyleRef | None:
        """La lámina de materiales del pack (la única ref de surfaces/). No
        admite sustituto: una escena contaminaría los swatches planos. Un pack
        VÁLIDO siempre la declara (cardinalidad del StyleManifestSchema); si
        aquí sale None es que el pack está a medio generar y el atlas irá solo
        con el style_token."""
        manifest = self._manifest(style_id)
        if not manifest:
            return None
        for r in self._refs_for_folder(manifest, "surfaces"):
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
                f"StylePacks: lámina de '{style_id}' declarada pero sin imagen — "
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
