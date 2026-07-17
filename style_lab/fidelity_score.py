"""Métricas de fidelidad de layout entre un blueprint compuesto y la imagen
generada — puras (sin red), para poder calibrarlas con imágenes ya pagadas.

El matching es un port literal de `matchExpected` del cliente
(nefan-html/src/scene/scene-image.ts): solape = intersección / min(áreas),
umbral 0.4, mejor candidato. Los bbox esperados se mapean de unidades de
viewBox a píxeles de imagen con la misma fórmula que `expectedFromComposed`
(escalado anisótropo sobre el viewBox completo).
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageDraw

MATCH_THRESHOLD = 0.4
#: Masks no casadas con área en este rango (fracción de la imagen) cuentan
#: como "estructura inventada" candidata (>40% = suelo; <1% = detalle).
INVENTED_AREA_MIN = 0.01
INVENTED_AREA_MAX = 0.40
#: Solape máximo con CUALQUIER esperado para considerar una mask "no explicada".
INVENTED_OVERLAP_MAX = 0.15

BUILDING_TYPES = {"building", "wall", "tower", "gate"}


@dataclass
class Expected:
    label: str
    kind: str  # type del volume (building/wall/tree/...) o "?" si no casa
    bbox: tuple[float, float, float, float]  # px: x, y, w, h


def expected_from_dump(dump: dict, img_w: int, img_h: int) -> list[Expected]:
    """Los elements solid||tall del dump del compositor, en píxeles de imagen."""
    vb = dump["view_box"]
    sx = img_w / vb["width"]
    sy = img_h / vb["height"]
    label_to_type: dict[str, str] = {}
    for v in dump.get("volumes", []):
        label_to_type.setdefault(str(v.get("label", "")), str(v.get("type", "?")))
    out: list[Expected] = []
    for el in dump["elements"]:
        if not (el.get("solid") or el.get("tall")):
            continue
        bx, by, bw, bh = el["bbox"]
        out.append(
            Expected(
                label=el["label"],
                kind=label_to_type.get(el["label"], "?"),
                bbox=((bx - vb["minX"]) * sx, (by - vb["minY"]) * sy, bw * sx, bh * sy),
            )
        )
    return out


def _inter(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return ix * iy


def overlap_ratio(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    inter = _inter(a, b)
    if inter <= 0:
        return 0.0
    denom = min(a[2] * a[3], b[2] * b[3])
    return inter / denom if denom > 0 else 0.0


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    inter = _inter(a, b)
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def centroid_offset(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    dx = (a[0] + a[2] / 2) - (b[0] + b[2] / 2)
    dy = (a[1] + a[3] / 2) - (b[1] + b[3] / 2)
    return (dx * dx + dy * dy) ** 0.5


def score(
    expected: list[Expected],
    seg_bboxes: list[tuple[float, float, float, float]],
    img_w: int,
    img_h: int,
) -> dict:
    """Métricas de alineación. Cada esperado casa con su mejor mask (umbral
    0.4, como el cliente); las masks medianas que no explican ningún esperado
    son el proxy de "estructura inventada"."""
    matches: list[tuple[Expected, tuple[float, float, float, float] | None]] = []
    for exp in expected:
        best: tuple[float, float, float, float] | None = None
        best_ratio = MATCH_THRESHOLD
        for sb in seg_bboxes:
            r = overlap_ratio(exp.bbox, sb)
            if r > best_ratio:
                best_ratio = r
                best = sb
        matches.append((exp, best))

    def _stats(subset: list[tuple[Expected, tuple[float, float, float, float] | None]]) -> dict:
        n = len(subset)
        matched = [(e, s) for e, s in subset if s is not None]
        return {
            "n": n,
            "pct_matched": round(100 * len(matched) / n, 1) if n else None,
            "mean_iou": round(sum(iou(e.bbox, s) for e, s in matched) / len(matched), 3)
            if matched
            else None,
            "mean_offset_px": round(
                sum(centroid_offset(e.bbox, s) for e, s in matched) / len(matched), 1
            )
            if matched
            else None,
            "mean_offset_pct": round(
                100 * sum(centroid_offset(e.bbox, s) for e, s in matched) / len(matched) / img_w, 1
            )
            if matched
            else None,
        }

    img_area = img_w * img_h
    invented: list[tuple[float, float, float, float]] = []
    for sb in seg_bboxes:
        frac = (sb[2] * sb[3]) / img_area
        if not (INVENTED_AREA_MIN <= frac <= INVENTED_AREA_MAX):
            continue
        if all(overlap_ratio(exp.bbox, sb) < INVENTED_OVERLAP_MAX for exp in expected):
            invented.append(sb)

    buildings = [(e, s) for e, s in matches if e.kind in BUILDING_TYPES]
    return {
        "all": _stats(matches),
        "buildings": _stats(buildings),
        "n_unmatched_big_masks": len(invented),
        "unexplained_area_pct": round(
            100 * sum(sb[2] * sb[3] for sb in invented) / img_area, 1
        ),
        "_matches": matches,
        "_invented": invented,
    }


def draw_overlay(
    image: Image.Image,
    metrics: dict,
    out_path: str,
) -> None:
    """Esperado casado = verde, no casado = rojo; su mask casada en azul fino;
    masks medianas no explicadas en magenta."""
    img = image.convert("RGB").copy()
    d = ImageDraw.Draw(img)

    def rect(b: tuple[float, float, float, float], color: str, width: int) -> None:
        d.rectangle([b[0], b[1], b[0] + b[2], b[1] + b[3]], outline=color, width=width)

    for sb in metrics["_invented"]:
        rect(sb, "#ff00ff", 2)
    for exp, seg in metrics["_matches"]:
        if seg is not None:
            rect(seg, "#4488ff", 1)
        rect(exp.bbox, "#00e050" if seg is not None else "#ff2020", 3)
        d.text((exp.bbox[0] + 2, exp.bbox[1] + 2), exp.label[:18], fill="#ffffff")
    img.save(out_path)
