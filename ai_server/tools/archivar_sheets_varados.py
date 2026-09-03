#!/usr/bin/env python3
"""Archiva los sheets VESTIDOS que una clave nueva ha dejado inalcanzables.

Cuando cambia la composición de `_skin_sheet_key`
(`ai_server/routers/remote_generation.py`), todo lo que hay en
`cache/sprite_sheets/` queda bajo la clave VIEJA: sigue en disco, ocupa lo
mismo y ya no lo encuentra nadie. Es arte PAGADO — cada sheet son ~4 llamadas
de imagen y su hero-shot— así que no se borra: se mueve a `archivo/`, con su
`meta.json` dentro, que es lo único que sabe con qué prompt se pidió.

Existe porque ya pasó y salió caro: el 2026-08-24, el cambio `skinforge_v2 →
v3` varó 169 sheets y 553 MB que hubo que barrer a mano después
(`archivo/cache/sprite_sheets/`). El barrido va en la MISMA PR que mueve la
clave; si no se hace ese día, no se hace.

**DRY-RUN por defecto.** Imprime la tabla de lo que movería y no toca nada.
Solo con `--ejecutar` mueve, y nunca borra: si el destino ya existe, para.

Lo que NO toca, y es deliberado:
  · `heroes/` — la clave del hero (`hero_key`) no cuelga de `base_key` ni del
    perfil de repintado, así que un cambio de la clave del sheet no lo vara.
  · `_base_keys.json` — es un índice, no arte. El adaptador lo reconstruye.

Uso:
    python ai_server/tools/archivar_sheets_varados.py            # dry-run
    python ai_server/tools/archivar_sheets_varados.py --ejecutar
    python ai_server/tools/archivar_sheets_varados.py --cache /otro/checkout/cache/sprite_sheets
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CACHE_POR_DEFECTO = REPO / "cache" / "sprite_sheets"
ARCHIVO_POR_DEFECTO = REPO / "archivo" / "cache" / "sprite_sheets"

# Lo que vive en `cache/sprite_sheets/` y NO es un sheet vestido.
NO_SON_SHEETS = {"heroes"}


def _bytes_y_frames(d: Path) -> tuple[int, int]:
    total = 0
    frames = 0
    for f in d.rglob("*"):
        if f.is_file():
            total += f.stat().st_size
            if f.suffix == ".png":
                frames += 1
    return total, frames


def sheets_varados(cache: Path) -> list[dict]:
    """Todo directorio de sheet vestido con su procedencia, ordenado por tamaño.

    «Sheet vestido» = directorio con `meta.json`. Un directorio SIN meta es un
    repintado que murió a medias (el meta se escribe el último) y también entra:
    ocupa disco y no lo va a servir nadie, pero se dice que no tiene procedencia
    en vez de inventarle una.
    """
    if not cache.is_dir():
        return []
    filas = []
    for d in sorted(p for p in cache.iterdir() if p.is_dir()):
        if d.name in NO_SON_SHEETS:
            continue
        meta_path = d / "meta.json"
        meta: dict = {}
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text())
            except (OSError, ValueError) as e:
                print(f"AVISO: {d.name}/meta.json ilegible ({e}); se archiva sin procedencia")
        nbytes, frames = _bytes_y_frames(d)
        filas.append({
            "dir": d,
            "hash": d.name,
            "model": meta.get("model", "?"),
            "anim": meta.get("anim", "?"),
            "angle": meta.get("angle", "?"),
            "prompt": (meta.get("skin") or {}).get("prompt", ""),
            "coste": (meta.get("skin") or {}).get("cost_usd"),
            "api": (meta.get("skin") or {}).get("api", ""),
            "frames": frames,
            "bytes": nbytes,
        })
    return sorted(filas, key=lambda f: -f["bytes"])


def tabla(filas: list[dict]) -> str:
    if not filas:
        return "(no hay ni un sheet vestido en la caché: nada que archivar)"
    ancho = max(len(f"{f['model']}/{f['anim']}/{f['angle']}") for f in filas)
    out = [f"{'hash':<16}  {'model/anim/angle':<{ancho}}  {'frames':>6}  {'MB':>6}  {'$':>5}  prompt"]
    for f in filas:
        triple = f"{f['model']}/{f['anim']}/{f['angle']}"
        coste = f"{f['coste']:.2f}" if isinstance(f["coste"], (int, float)) else "—"
        prompt = f["prompt"] or "(SIN PROCEDENCIA)"
        out.append(
            f"{f['hash']:<16}  {triple:<{ancho}}  {f['frames']:>6}  "
            f"{f['bytes'] / 1e6:>6.1f}  {coste:>5}  {prompt[:56]}"
        )
    tot_b = sum(f["bytes"] for f in filas)
    tot_f = sum(f["frames"] for f in filas)
    out.append(f"{'TOTAL':<16}  {len(filas)} sheets{'':<{max(0, ancho - 7)}}  {tot_f:>6}  {tot_b / 1e6:>6.1f}")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", type=Path, default=CACHE_POR_DEFECTO,
                    help="raíz de los sheets vestidos (por defecto la de este checkout)")
    ap.add_argument("--archivo", type=Path, default=ARCHIVO_POR_DEFECTO,
                    help="dónde se archivan (por defecto archivo/cache/sprite_sheets/)")
    ap.add_argument("--ejecutar", action="store_true",
                    help="mover de verdad. Sin esto NO se toca nada")
    args = ap.parse_args()

    filas = sheets_varados(args.cache)
    print(f"caché:   {args.cache}")
    print(f"archivo: {args.archivo}\n")
    print(tabla(filas))
    if not filas:
        return 0

    if not args.ejecutar:
        print("\nDRY-RUN: no se ha movido nada. Repite con --ejecutar cuando hayas leído la tabla.")
        return 0

    # Fail-loud antes de mover UNO: un destino ocupado significa que este
    # barrido ya se hizo (o que dos claves distintas dieron el mismo hash), y
    # resolverlo a medias deja la mitad del arte en cada sitio.
    choques = [f["hash"] for f in filas if (args.archivo / f["hash"]).exists()]
    if choques:
        print(f"\nERROR: ya existen en el archivo: {', '.join(choques)}. No se mueve nada.", file=sys.stderr)
        return 1

    args.archivo.mkdir(parents=True, exist_ok=True)
    for f in filas:
        shutil.move(str(f["dir"]), str(args.archivo / f["hash"]))
    print(f"\nArchivados {len(filas)} sheets ({sum(f['bytes'] for f in filas) / 1e6:.1f} MB) en {args.archivo}.")
    print("Nada borrado: el arte pagado sigue ahí, con su meta.json y su prompt.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
