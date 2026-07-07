#!/usr/bin/env python3
"""CLI: genera las imágenes que faltan de un style pack vía Meshy i2i.

Uso (desde la raíz del repo, con MESHY_API_KEY en .env):

    python ai_server/tools/build_style_pack.py medievo_crudo
    python ai_server/tools/build_style_pack.py medievo_crudo --only nature,settlement
    python ai_server/tools/build_style_pack.py --all --model nano-banana-pro
    python ai_server/tools/build_style_pack.py medievo_crudo --dry-run

El pack (data/styles/{id}/style.json) debe existir con sus refs declaradas;
solo se generan los archivos ausentes. Coste por imagen según el modelo
(nano-banana-pro: 9 créditos = $0.18). Con --dry-run lista qué generaría y el
coste estimado sin llamar a la API.
"""
import argparse
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
    from meshy_client import MeshyImageToImage
    from style_pack_builder import generate_missing_sync, missing_categories
    from style_packs import _styles_dir_from_config

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("style_ids", nargs="*", help="ids de estilos a completar")
    parser.add_argument("--all", action="store_true", help="todos los packs de data/styles")
    parser.add_argument("--model", default="nano-banana-pro",
                        choices=sorted(MeshyImageToImage.MODEL_CREDITS))
    parser.add_argument("--only", default="", help="categorías concretas, separadas por comas")
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

    per_image = MeshyImageToImage.cost_usd(args.model)
    total = 0.0
    for style_id in ids:
        todo = missing_categories(styles_dir, style_id)
        if only:
            todo = [c for c in todo if c in only]
        est = len(todo) * per_image
        print(f"\n── {style_id}: faltan {len(todo)} imágenes {todo} (~${est:.2f})")
        if args.dry_run or not todo:
            total += est
            continue
        result = generate_missing_sync(styles_dir, style_id, args.model, only)
        total += result["cost_usd"]
        print(f"── {style_id}: generadas {result['generated']} (${result['cost_usd']:.2f})")

    print(f"\nTotal {'estimado ' if args.dry_run else ''}${total:.2f} ({args.model})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
