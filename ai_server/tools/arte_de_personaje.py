#!/usr/bin/env python3
"""Le da dueño al arte de personaje que ya está en disco: hero-shots (#376).

Desde #376 el adaptador (`/skin_sprite_sheet`) indexa en el asset-store el
hero-shot y el sheet de cada personaje que sirve, venga de generarse o de la
caché. Con eso, todo sheet vestido que quede en `cache/sprite_sheets/` se indexa
solo la primera vez que alguien lo pide, con su prompt REAL, que está en su
`meta.json`. **Los hero-shots no.** Un hero es un PNG desnudo llamado por un
hash bajo `heroes/`: no lleva metadatos, y si su sheet ya no existe (archivado,
o de una clave anterior) nadie puede volver a nombrarlo — el adaptador solo
indexa el hero de un sheet que se está sirviendo.

Este guion cierra ese hueco UNA vez, y solo con procedencia REAL:

  · **nombrable** — recomponiendo `hero_key(prompt, model, angle, ai_model,
    style_key)` desde algún `meta.json` legible sale EXACTAMENTE el nombre del
    fichero. Eso no es una conjetura: es una comprobación criptográfica de que
    ese PNG se pidió con ese texto. Se registra con su prompt y el store lo pina.
  · **sin procedencia** — ningún meta da su clave. Va a
    `archivo/cache/sprite_sheets/heroes-sin-procedencia/`, con el resto del arte
    archivado. **Nunca se borra**: es material pagado.

Lo que NO se hace, y es la regla dura: **jamás se inventa un prompt.** Un hero
en el índice con la descripción vacía, o con la del vecino, es exactamente la
mentira que #376 denuncia — con la agravante de que estaría escrita en el sitio
del que alguien va a fiarse para regenerar el arte. El zod del store lo rechaza
igualmente (`prompt` no vacío en los kinds de personaje), pero la decisión es de
aquí.

Punto ciego heredado de `archivar_sheets_varados.py`: el `meta.json` **no
guarda el style_key**, así que un personaje pintado con pack de estilo no se
puede recomponer con `--style-key ""`. `--style-key` permite probar contra uno
concreto. Medido el 2026-09-03 con los 16 candidatos de los packs del repo: no
recupera ninguno más.

**DRY-RUN por defecto.** Imprime la tabla y no toca nada. Solo con `--ejecutar`
registra y mueve.

Uso:
    python ai_server/tools/arte_de_personaje.py                 # dry-run
    python ai_server/tools/arte_de_personaje.py --ejecutar
    python ai_server/tools/arte_de_personaje.py --style-key medievo_crudo:abc123
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
SUBDIR_SIN_PROCEDENCIA = "heroes-sin-procedencia"


def _hero_key():
    """`hero_key` de PRODUCCIÓN, importada. Una segunda implementación aquí
    sería el espejo que deriva, y este guion decide qué se archiva."""
    sys.path.insert(0, str(REPO / "ai_server"))
    from routers.remote_generation import hero_key  # noqa: PLC0415

    return hero_key


def claves_conocidas(raices: list[Path], style_key: str = "") -> dict[str, dict]:
    """`hero_key` → procedencia, recompuesta desde todos los `meta.json` legibles.

    Se miran las raíces que se le den (la caché viva Y el archivo): el hero de
    un personaje sobrevive a que sus sheets se archiven, así que el único sitio
    donde queda su texto puede ser un `meta.json` de `archivo/`.
    """
    hero_key = _hero_key()
    conocidas: dict[str, dict] = {}
    for raiz in raices:
        if not raiz.is_dir():
            continue
        for d in sorted(p for p in raiz.iterdir() if p.is_dir()):
            meta_path = d / "meta.json"
            if not meta_path.is_file():
                continue
            try:
                meta = json.loads(meta_path.read_text())
            except (OSError, ValueError) as e:
                print(f"AVISO: {raiz.name}/{d.name}/meta.json ilegible ({e}); se ignora")
                continue
            skin = meta.get("skin") or {}
            campos = (skin.get("prompt"), meta.get("model"), meta.get("angle"), skin.get("ai_model"))
            if not all(isinstance(c, str) and c for c in campos):
                continue
            prompt, model, angle, ai_model = campos
            k = hero_key(prompt, model, angle, ai_model, style_key)
            entrada = conocidas.setdefault(
                k,
                {"prompt": prompt, "model": model, "angle": angle,
                 "ai_model": ai_model, "style_key": style_key, "sheets": []},
            )
            entrada["sheets"].append(d.name)
    return conocidas


def censar(cache: Path, archivo: Path, style_key: str = "") -> list[dict]:
    """Los hero-shots en disco, cada uno con su estado, por tamaño descendente."""
    heroes = cache / "heroes"
    if not heroes.is_dir():
        return []
    conocidas = claves_conocidas([cache, archivo], style_key)
    filas = []
    for f in sorted(p for p in heroes.iterdir() if p.is_file() and p.suffix == ".png"):
        proc = conocidas.get(f.stem)
        filas.append({
            "fichero": f,
            "hero_key": f.stem,
            "estado": "nombrable" if proc else "sin procedencia",
            "prompt": proc["prompt"] if proc else "",
            "model": proc["model"] if proc else "?",
            "angle": proc["angle"] if proc else "?",
            "ai_model": proc["ai_model"] if proc else "?",
            "style_key": proc["style_key"] if proc else "",
            "sheets": len(proc["sheets"]) if proc else 0,
            "bytes": f.stat().st_size,
        })
    return sorted(filas, key=lambda x: -x["bytes"])


def tabla(filas: list[dict]) -> str:
    if not filas:
        return "(no hay ni un hero-shot en la caché)"
    out = [f"{'hero_key':<16}  {'estado':<15}  {'sheets':>6}  {'MB':>6}  prompt"]
    for f in filas:
        out.append(
            f"{f['hero_key']:<16}  {f['estado']:<15}  {f['sheets']:>6}  "
            f"{f['bytes'] / 1e6:>6.2f}  {f['prompt'][:54] or '—'}"
        )
    nom = [f for f in filas if f["estado"] == "nombrable"]
    sin = [f for f in filas if f["estado"] != "nombrable"]
    out.append(
        f"{'TOTAL':<16}  {len(nom)} nombrable(s) · {sum(f['bytes'] for f in nom) / 1e6:.2f} MB "
        f"al índice   |   {len(sin)} sin procedencia · "
        f"{sum(f['bytes'] for f in sin) / 1e6:.2f} MB al archivo"
    )
    return "\n".join(out)


def registrar(filas: list[dict], manifest) -> int:
    """Apunta los nombrables en el asset-store con su prompt REAL. Fail-loud."""
    from routers.remote_generation import KIND_HERO  # noqa: PLC0415

    n = 0
    for f in filas:
        if f["estado"] != "nombrable":
            continue
        if not f["prompt"]:
            # Inalcanzable por construcción (`nombrable` exige prompt no
            # vacío), pero es la línea que no puede fallar: sin este guardián,
            # un cambio en `claves_conocidas` podría meter una fila muda.
            raise RuntimeError(f"{f['hero_key']}: nombrable sin prompt — no se inventa uno")
        manifest.register(
            f["hero_key"], KIND_HERO, KIND_HERO, f["prompt"], f["bytes"],
            {"character_ref": f["hero_key"], "model": f["model"], "angle": f["angle"],
             "ai_model": f["ai_model"], "style_key": f["style_key"]},
        )
        n += 1
    return n


def archivar(filas: list[dict], destino: Path) -> int:
    """Mueve los que no tienen procedencia. Nunca borra; un destino ocupado para."""
    sin = [f for f in filas if f["estado"] != "nombrable"]
    if not sin:
        return 0
    choques = [f["hero_key"] for f in sin if (destino / f["fichero"].name).exists()]
    if choques:
        raise RuntimeError(f"ya existen en {destino}: {', '.join(choques)}. No se mueve nada.")
    destino.mkdir(parents=True, exist_ok=True)
    for f in sin:
        shutil.move(str(f["fichero"]), str(destino / f["fichero"].name))
    return len(sin)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", type=Path, default=CACHE_POR_DEFECTO,
                    help="raíz del arte de personaje (por defecto la de este checkout)")
    ap.add_argument("--archivo", type=Path, default=ARCHIVO_POR_DEFECTO,
                    help="dónde vive el arte archivado (de ahí salen también los meta.json)")
    ap.add_argument("--style-key", default="",
                    help="style_key con el que recomponer la clave (el meta no lo guarda)")
    ap.add_argument("--ejecutar", action="store_true",
                    help="registrar y mover de verdad. Sin esto NO se toca nada")
    args = ap.parse_args()

    filas = censar(args.cache, args.archivo, args.style_key)
    print(f"caché:   {args.cache / 'heroes'}")
    print(f"archivo: {args.archivo / SUBDIR_SIN_PROCEDENCIA}")
    print(f"nombrable = hero_key(prompt, model, angle, ai_model, style_key={args.style_key!r}) "
          f"recompuesta desde algún meta.json ES el nombre del fichero\n")
    print(tabla(filas))
    if not filas:
        return 0

    if not args.ejecutar:
        print("\nDRY-RUN: no se ha registrado ni movido nada. "
              "Repite con --ejecutar cuando hayas leído la tabla.")
        return 0

    sys.path.insert(0, str(REPO / "ai_server"))
    from asset_store_client import AssetStoreClient  # noqa: PLC0415

    store = AssetStoreClient()
    try:
        n = registrar(filas, store)
    finally:
        store.close()
    print(f"\nindexados {n} hero-shots con su prompt (el store los pina al registrarlos)")
    movidos = archivar(filas, args.archivo / SUBDIR_SIN_PROCEDENCIA)
    print(f"archivados {movidos} sin procedencia en {args.archivo / SUBDIR_SIN_PROCEDENCIA}")
    print("Nada borrado: el arte pagado sigue ahí, aunque no se sepa con qué texto se pidió.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
