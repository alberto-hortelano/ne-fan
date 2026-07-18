"""eval_management.py — E2b: ¿puede el juego GESTIONAR una escena three.js
escrita libremente por el LLM?

Mide, para cada scene_<tile>.mjs freeform:
 1. Manifest parseable sin ejecutar three.js (extraído del propio módulo).
 2. Huellas válidas: dentro de [0,128], min<max, altura > 0.
 3. Derivabilidad del contrato del juego: grid de colisión (celdas sólidas) y
    occluders {bbox proyectado, baseline_y, footprint} desde las huellas — las
    mismas fórmulas del compositor (pt(u,v,h)=[u+h*KX, v-h*KY]).
 4. Consistencia manifest ↔ objetos del render (scene-dump del viewer, si
    existe el dump JSON capturado).
 5. Cobertura de la descripción: qué sustantivos clave de la scene_description
    tienen un objeto correspondiente en el manifest.

Uso: python3 render_lab/exp2_three/eval_management.py
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
RUN = LAB / "runs/001_alternativas"
KX, KY = -0.35, 1.0

#: Sustantivos clave por tile, sacados de la scene_description (a mano).
DESCRIPTION_KEYWORDS = {
    "medieval": ["pozo", "cambista", "taberna", "horno", "adarve", "torre", "arco", "tapia", "huerto"],
    "scifi": ["mástil", "mercado", "bloque", "vivienda", "cantina", "avenida", "plaza"],
}


def extract_manifest(mjs: Path) -> dict:
    """Evalúa el módulo en node y vuelca su export `manifest` — demuestra que
    el registro del motor es datos puros extraíbles sin renderizar."""
    out = subprocess.run(
        ["node", "--input-type=module", "-e",
         f"import {{ manifest }} from '{mjs.resolve().as_uri()}';"
         "console.log(JSON.stringify(manifest));"],
        capture_output=True, text=True, timeout=30,
    )
    if out.returncode != 0:
        raise RuntimeError(f"manifest no extraíble: {out.stderr[:300]}")
    return json.loads(out.stdout)


def project_pt(u: float, v: float, h: float) -> tuple[float, float]:
    return (u + h * KX, v - h * KY)


def derive_contract(manifest: dict) -> dict:
    """Colisión + occluders desde las huellas del manifest (fórmulas del
    compositor). Devuelve resumen numérico."""
    grid = [[False] * 128 for _ in range(128)]
    occluders = []
    for o in manifest["objects"]:
        u0, v0, u1, v1 = o["footprint"]
        if o.get("solid"):
            for vv in range(max(0, int(v0)), min(128, int(v1))):
                for uu in range(max(0, int(u0)), min(128, int(u1))):
                    grid[vv][uu] = True
        if o.get("tall"):
            h = o.get("h", 4)
            # bbox proyectado: huella ∪ tapa desplazada (+h·KX, −h·KY)
            xs = [u0, u1, u0 + h * KX, u1 + h * KX]
            ys = [v0, v1, v0 - h * KY, v1 - h * KY]
            occluders.append({
                "id": o["id"],
                "bbox": [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)],
                "baseline_y": v1,
                "footprint_cells": [u0, v0, u1, v1],
            })
    solid_cells = sum(c for row in grid for c in row)
    return {"solid_cells": solid_cells, "solid_pct": round(100 * solid_cells / (128 * 128), 1), "occluders": occluders}


def validate_footprints(manifest: dict) -> list[str]:
    errors = []
    for o in manifest["objects"]:
        fp = o.get("footprint")
        if not (isinstance(fp, list) and len(fp) == 4):
            errors.append(f"{o.get('id')}: footprint mal formado")
            continue
        u0, v0, u1, v1 = fp
        if not (0 <= u0 < u1 <= 128 and 0 <= v0 < v1 <= 128):
            errors.append(f"{o['id']}: huella fuera de rango {fp}")
        if not (isinstance(o.get("h"), (int, float)) and o["h"] > 0):
            errors.append(f"{o['id']}: altura inválida {o.get('h')}")
    return errors


def check_dump(tile: str, manifest: dict) -> dict:
    dump_path = RUN / "dumps" / f"e2b_{tile}.json"
    if not dump_path.exists():
        return {"dump": "no capturado"}
    dump = json.loads(dump_path.read_text())
    scene_names = {o["name"] for o in dump.get("objects", []) if o.get("name")}
    manifest_ids = {o["id"] for o in manifest["objects"]}
    return {
        "en_manifest_no_en_escena": sorted(manifest_ids - scene_names),
        "en_escena_no_en_manifest": sorted(n for n in scene_names - manifest_ids if n and n != "ground"),
    }


def coverage(tile: str, manifest: dict) -> dict:
    text = " ".join(
        f"{o.get('label', '')} {o.get('id', '')}" for o in manifest["objects"]
    ).lower()
    for r in manifest.get("roads", []):
        text += " " + r.get("id", "").lower()
    text += " plaza" if manifest.get("plaza") else ""
    hits = {k: (k.lower() in text or k.lower().replace("á", "a").replace("é", "e") in text)
            for k in DESCRIPTION_KEYWORDS[tile]}
    return {"cubiertos": [k for k, v in hits.items() if v], "faltan": [k for k, v in hits.items() if not v]}


def main() -> None:
    report = {}
    for tile in ("medieval", "scifi"):
        mjs = LAB / "exp2_three/freeform" / f"scene_{tile}.mjs"
        entry: dict = {}
        try:
            manifest = extract_manifest(mjs)
            entry["manifest_extraible"] = True
            entry["n_objetos"] = len(manifest["objects"])
            entry["errores_huella"] = validate_footprints(manifest)
            contract = derive_contract(manifest)
            entry["colision"] = {"solid_cells": contract["solid_cells"], "solid_pct": contract["solid_pct"]}
            entry["occluders_derivados"] = len(contract["occluders"])
            entry["dump"] = check_dump(tile, manifest)
            entry["cobertura_descripcion"] = coverage(tile, manifest)
            (RUN / "dumps").mkdir(parents=True, exist_ok=True)
            (RUN / "dumps" / f"e2b_{tile}_contract.json").write_text(
                json.dumps(contract, indent=1, ensure_ascii=False)
            )
        except Exception as err:
            entry["manifest_extraible"] = False
            entry["error"] = str(err)[:300]
        report[tile] = entry
    out = RUN / "dumps" / "e2b_management_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps(report, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
