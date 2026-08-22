#!/usr/bin/env python3
"""CLI: genera las imágenes que faltan de un style pack.

Las refs de personaje (characters/) van por Meshy i2i (`--model`); la lámina
de materiales (surfaces/) va SIEMPRE por fal nano-banana-pro y las refs
temáticas de CARA (faces/) por fal gpt-image-2.

Uso (desde la raíz del repo, con MESHY_API_KEY / FAL_KEY en .env):

    python ai_server/tools/build_style_pack.py medievo_crudo
    python ai_server/tools/build_style_pack.py medievo_crudo --only fachada,porton
    python ai_server/tools/build_style_pack.py medievo_crudo --folder faces
    python ai_server/tools/build_style_pack.py --all --model nano-banana-pro
    python ai_server/tools/build_style_pack.py medievo_crudo --dry-run
    # Staging (flujo de aprobación): re-tirada INCONDICIONAL de refs
    # concretas a un directorio aparte, sin tocar el pack ni su style.json:
    python ai_server/tools/build_style_pack.py medievo_crudo \
        --only fachada --out /tmp/staging/medievo_crudo

El pack (data/styles/{id}/style.json) debe existir con sus refs declaradas
(`--only` refiere a sus `id`); sin --out solo se generan los archivos
ausentes. Coste por imagen según el modelo (nano-banana-pro: 9 créditos =
$0.18; gpt-image-2 vía fal: $0.17). Con --dry-run lista qué generaría y el
coste estimado sin llamar a la API.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _load_dotenv() -> None:
    env = REPO_ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    _load_dotenv()
    from meshy_client import FalImageToImage, MeshyImageToImage
    from style_pack_builder import (
        FACE_AI_MODEL,
        SHEET_AI_MODEL,
        generate_missing_sync,
        missing_refs,
    )
    from style_packs import REF_FOLDERS, _styles_dir_from_config, ref_folder

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("style_ids", nargs="*", help="ids de estilos a completar")
    parser.add_argument("--all", action="store_true", help="todos los packs de data/styles")
    parser.add_argument("--model", default="nano-banana-pro",
                        choices=sorted(MeshyImageToImage.MODEL_CREDITS),
                        help="modelo Meshy de las refs de personaje")
    parser.add_argument("--only", default="", help="ids de ref concretos, separados por comas")
    parser.add_argument("--folder", default="",
                        choices=["", *REF_FOLDERS],
                        help="limitar a las refs de una carpeta del pack")
    parser.add_argument("--out", default="",
                        help="staging: generar `--only` INCONDICIONALMENTE en este "
                             "directorio, sin tocar el pack (flujo de aprobación)")
    parser.add_argument("--dry-run", action="store_true",
                        help="listar qué se generaría y el coste, sin llamar a la API")
    args = parser.parse_args()

    styles_dir = _styles_dir_from_config()
    ids = args.style_ids
    if args.all:
        ids = sorted(p.name for p in styles_dir.iterdir() if (p / "style.json").exists())
    if not ids:
        parser.error("indica style_ids o --all")
    only = [c.strip() for c in args.only.split(",") if c.strip()] or None
    folder_only = args.folder or None
    out_dir = Path(args.out) if args.out else None
    if out_dir is not None and not only:
        parser.error("--out (staging) requiere --only")
    if out_dir is not None and len(ids) > 1:
        parser.error("--out (staging) admite un solo style_id")

    def cost_of(folders: list[str]) -> float:
        out = 0.0
        for v in folders:
            if v == "surfaces":
                out += FalImageToImage.COST_USD.get(SHEET_AI_MODEL, 0.18)
            elif v == "faces":
                out += FalImageToImage.COST_USD.get(FACE_AI_MODEL, 0.17)
            else:
                out += MeshyImageToImage.cost_usd(args.model)
        return out

    total = 0.0
    for style_id in ids:
        manifest = json.loads((styles_dir / style_id / "style.json").read_text(encoding="utf-8"))
        folder_of = {
            str(r.get("id")): ref_folder(str(r.get("file", "")))
            for r in manifest.get("refs", [])
        }
        if out_dir is not None:
            todo = list(only or [])
        else:
            todo = [m["id"] for m in missing_refs(styles_dir, style_id)]
            if only:
                todo = [c for c in todo if c in only]
        unknown = [c for c in todo if c not in folder_of]
        if unknown:
            print(f"── {style_id}: ids desconocidos {unknown} (no declarados en style.json)")
            return 1
        if folder_only:
            todo = [c for c in todo if folder_of[c] == folder_only]
        est = cost_of([folder_of[c] for c in todo])
        label = "re-tirada" if out_dir is not None else "faltan"
        print(f"\n── {style_id}: {label} {len(todo)} imágenes {todo} (~${est:.2f})")
        if args.dry_run or not todo:
            total += est
            continue
        result = generate_missing_sync(
            styles_dir, style_id, args.model, only, folder_only=folder_only, out_dir=out_dir,
        )
        total += result["cost_usd"]
        print(f"── {style_id}: generadas {result['generated']} (${result['cost_usd']:.2f})")

    print(f"\nTotal {'estimado ' if args.dry_run else ''}${total:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
