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

**Varado, no «todo lo que hay»**, y la diferencia importa porque este guion es
rerunnable: la primera versión archivaba cualquier directorio con `meta.json`,
así que volver a correrlo después de regenerar arte se lo habría llevado. Un
sheet es ALCANZABLE cuando la clave viva —`_skin_sheet_key`, **la de
producción**, importada, no una copia— recompuesta desde su propio `meta.json`
da exactamente el nombre de su directorio. Si da otra cosa (`varado`), o si al
meta le falta con qué recomponerla (`no recomponible`), no lo alcanza nadie.

Punto ciego, escrito porque es real: el `meta.json` **no guarda el style_key**
(el pack de estilo con el que se pidió), así que un sheet generado con estilo no
se puede recomponer y sale como varado. `--style-key` permite comprobar contra
uno concreto. Que la procedencia del arte de personaje esté incompleta es
justamente #376.

**DRY-RUN por defecto.** Imprime la tabla de lo que movería y no toca nada.
Solo con `--ejecutar` mueve, y nunca borra: si el destino ya existe, para.

Lo que NO toca, y es deliberado:
  · los sheets ALCANZABLES — se listan aparte y se quedan donde están.
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


def _clave_viva(meta: dict, style_key: str) -> str | None:
    """La clave que el adaptador compondría HOY para este sheet, o `None` si su
    `meta.json` no trae con qué recomponerla.

    Usa `_skin_sheet_key` **de producción** (importada, no copiada): una segunda
    implementación de la clave aquí sería el espejo que deriva, y este guion
    existe justo por lo que pasa cuando la clave se mueve.

    El perfil sale del meta del sheet VESTIDO, que es el efectivo con el que se
    pintó: `frame_count` son sus keyframes y `fps` su `play_fps`.
    """
    sys.path.insert(0, str(REPO / "ai_server"))
    from routers.remote_generation import _skin_sheet_key  # noqa: PLC0415

    skin = meta.get("skin") or {}
    campos = (meta.get("model"), meta.get("anim"), meta.get("angle"),
              skin.get("base_key"), skin.get("prompt"), skin.get("ai_model"))
    kf, fps = meta.get("frame_count"), meta.get("fps")
    if not all(isinstance(c, str) and c for c in campos):
        return None
    if not isinstance(kf, int) or kf <= 0 or not isinstance(fps, (int, float)) or fps <= 0:
        return None
    return _skin_sheet_key(skin["base_key"], meta["model"], meta["anim"], meta["angle"],
                           skin["prompt"], skin["ai_model"], style_key, (kf, float(fps)))


def _bytes_y_frames(d: Path) -> tuple[int, int]:
    total = 0
    frames = 0
    for f in d.rglob("*"):
        if f.is_file():
            total += f.stat().st_size
            if f.suffix == ".png":
                frames += 1
    return total, frames


def censar(cache: Path, style_key: str = "") -> list[dict]:
    """Los sheets vestidos de la caché, cada uno con su ESTADO, por tamaño.

    Tres estados, y el guion solo mueve el último:
      · `alcanzable` — la clave viva recompuesta desde su meta ES el nombre de
        su directorio: arte perfectamente servible, se queda donde está.
      · `no recomponible` — al meta le falta algo para recomponer la clave. En
        la práctica es `skin.base_key`: los sheets anteriores al traslado a
        sprite-forge (2026-08-24) no lo llevan, y sin la identidad de su hoja
        base no los alcanza nadie, con perfil o sin él.
      · `varado` — la clave viva da OTRA cosa: quedó bajo una clave que ya no se
        compone.
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
                print(f"AVISO: {d.name}/meta.json ilegible ({e}); no recomponible")
        viva = _clave_viva(meta, style_key) if meta else None
        estado = "no recomponible" if viva is None else ("alcanzable" if viva == d.name else "varado")
        nbytes, frames = _bytes_y_frames(d)
        filas.append({
            "dir": d,
            "hash": d.name,
            "estado": estado,
            "clave_viva": viva,
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


def sheets_varados(cache: Path, style_key: str = "") -> list[dict]:
    """Solo los que este guion mueve: los que ya no alcanza la clave viva."""
    return [f for f in censar(cache, style_key) if f["estado"] != "alcanzable"]


def tabla(filas: list[dict]) -> str:
    if not filas:
        return "(no hay ni un sheet vestido en la caché)"
    ancho = max(len(f"{f['model']}/{f['anim']}/{f['angle']}") for f in filas)
    out = [f"{'hash':<16}  {'estado':<15}  {'model/anim/angle':<{ancho}}  {'frames':>6}  {'MB':>6}  {'$':>5}  prompt"]
    for f in filas:
        triple = f"{f['model']}/{f['anim']}/{f['angle']}"
        coste = f"{f['coste']:.2f}" if isinstance(f["coste"], (int, float)) else "—"
        prompt = f["prompt"] or "(sin meta)"
        out.append(
            f"{f['hash']:<16}  {f['estado']:<15}  {triple:<{ancho}}  {f['frames']:>6}  "
            f"{f['bytes'] / 1e6:>6.1f}  {coste:>5}  {prompt[:52]}"
        )
    mueve = [f for f in filas if f["estado"] != "alcanzable"]
    tot_b = sum(f["bytes"] for f in mueve)
    tot_f = sum(f["frames"] for f in mueve)
    quedan = len(filas) - len(mueve)
    out.append(
        f"{'TOTAL A ARCHIVAR':<16}  {len(mueve)} sheets · {tot_f} frames · {tot_b / 1e6:.1f} MB"
        + (f"   ({quedan} alcanzable(s) se quedan donde están)" if quedan else "")
    )
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", type=Path, default=CACHE_POR_DEFECTO,
                    help="raíz de los sheets vestidos (por defecto la de este checkout)")
    ap.add_argument("--archivo", type=Path, default=ARCHIVO_POR_DEFECTO,
                    help="dónde se archivan (por defecto archivo/cache/sprite_sheets/)")
    ap.add_argument("--style-key", default="",
                    help="style_key con el que comprobar la alcanzabilidad (el meta no lo guarda)")
    ap.add_argument("--ejecutar", action="store_true",
                    help="mover de verdad. Sin esto NO se toca nada")
    args = ap.parse_args()

    censo = censar(args.cache, args.style_key)
    filas = [f for f in censo if f["estado"] != "alcanzable"]
    print(f"caché:   {args.cache}")
    print(f"archivo: {args.archivo}")
    print(f"alcanzable = la clave viva recompuesta desde su meta (style_key={args.style_key!r}) "
          f"es el nombre de su directorio\n")
    print(tabla(censo))
    if not filas:
        print("\nNada varado: todo lo que hay en la caché lo alcanza la clave viva.")
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
