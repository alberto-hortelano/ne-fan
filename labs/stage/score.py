"""labs/stage/score.py — métrica numérica de COINCIDENCIA imagen ↔ mundo.

Puntúa cuánto casan la pintura del plató y el mundo jugable derivado
(recortes + colisión + calibración). Puro sobre los artefactos que run.py ya
calcula (+ una máscara SAM del SUELO que run.py cachea igual que las demás).

Componentes (0..1, mayor = mejor):
- iou_boxes   IoU media caja de la visión vs bbox tight de la máscara SAM.
- contact_ok  fracción de puntos de contacto dentro de la tolerancia de z.
- edge_gap    LA métrica anti-muros-invisibles: distancia horizontal media
              (px) entre los bordes jugables proyectados (xStage=±W/2 con la
              proyección CALIBRADA) y el borde real de la máscara de suelo.
- scale_err   error relativo entre la altura pintada de cada elemento y la
              proyectada (h_decl · ppm_cal · s(z_pintada)) — la calidad de la
              calibración para la ESCALA de personajes.
- unexplained fracción del suelo visible ocupada por píxeles que no son ni
              suelo (máscara SAM) ni ningún elemento inventariado — cosas
              pintadas SIN identificar (pisables por error).
- recon       exp(−diff/3) del diff de reconstrucción (si hubo pelado).

Compuesto 0..100 con pesos editables (WEIGHTS). Un componente sin datos se
excluye del compuesto (renormalizando) y se reporta como null.
"""
from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

RENDER = 1024

WEIGHTS = {
    "iou_boxes": 0.20,
    "contact_ok": 0.15,
    "edge_gap": 0.25,
    "scale_err": 0.20,
    "unexplained": 0.10,
    "recon": 0.10,
}

EDGE_GAP_NORM_PX = 16.0
EDGE_SAMPLES = 10


def iou_xyxy(a: tuple, b: tuple) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def iou_boxes_metric(items: list) -> tuple[float | None, dict]:
    per = {}
    for it in items:
        if it.get("mask") is None or it.get("action") != "keep":
            continue
        x, y, w, h = it["box_px"]
        per[it["id"]] = iou_xyxy((x, y, x + w, y + h), tuple(it["mask_bbox"]))
    if not per:
        return None, per
    return float(np.mean(list(per.values()))), per


def contact_ok_metric(items: list) -> float | None:
    fracs = [it["pose"]["contact_ok_frac"] for it in items
             if it.get("pose") and "contact_ok_frac" in it["pose"]]
    return float(np.mean(fracs)) if fracs else None


def playable_edges_px(dump: dict, vy_samples: list[float],
                      world_to_px, view_to_stage) -> list[tuple[float, float, float]]:
    """[(py, left_px, right_px)] de los bordes jugables xStage=±W/2 en cada
    altura de muestra (vy en unidades de vista de la proyección calibrada)."""
    proj, vb, rect = dump["proj"], dump["view_box"], dump["rect"]
    out = []
    half_w = proj["width_m"] / 2
    cx0 = (rect["minX"] + rect["maxX"]) / 2
    for vy in vy_samples:
        st = view_to_stage(proj, proj.get("center_x", 0.0), vy)
        if st is None:
            continue
        z_stage = min(proj["depth_m"], max(0.0, st[1]))
        z_world = rect["maxZ"] - z_stage
        left = world_to_px(dump, cx0 - half_w, z_world)
        right = world_to_px(dump, cx0 + half_w, z_world)
        out.append((left[1], left[0], right[0]))
    return out


def edge_gap_metric(dump: dict, floor_mask: np.ndarray | None,
                    floor: dict, world_to_px, view_to_stage,
                    items_mask: np.ndarray | None = None) -> tuple[float | None, float | None, list]:
    """(score 0..1, gap medio px, muestras). Compara los bordes jugables
    proyectados con el borde real de la máscara de suelo, en EDGE_SAMPLES
    alturas entre la base de la pared y el frente. Un lado solo puntúa si el
    borde del suelo es LIBRE: interior al encuadre y no ocluido por un item
    inventariado (el suelo que muere contra una mesa no es un borde jugable)."""
    if floor_mask is None or not floor_mask.any():
        return None, None, []
    vb = dump["view_box"]
    wall_py = floor["wall_base_px"]
    front_py = floor.get("front_px", RENDER)
    py_samples = np.linspace(wall_py + 6, front_py - 6, EDGE_SAMPLES)
    vy_samples = [vb["minY"] + (py / RENDER) * vb["height"] for py in py_samples]
    edges = playable_edges_px(dump, vy_samples, world_to_px, view_to_stage)

    def side_free(row: int, edge_x: float, direction: int) -> bool:
        if not (6 < edge_x < RENDER - 6):
            return False
        if items_mask is None:
            return True
        # Ventana de 20 px hacia fuera del borde: si hay un item inventariado
        # ahí (con su sombra de por medio), el suelo muere contra el mueble.
        e = int(round(edge_x))
        lo = max(0, e + (direction * 20 if direction < 0 else 2))
        hi = min(RENDER, e + (direction * 2 if direction < 0 else 20) + 1)
        return not items_mask[row, lo:hi].any()

    gaps, samples = [], []
    for py, left_px, right_px in edges:
        row = int(round(py))
        if not (0 <= row < RENDER):
            continue
        xs = np.where(floor_mask[row])[0]
        # Filas con poco suelo visible (mobiliario encima) no dan un borde
        # fiable — se saltan.
        if xs.size < 120:
            continue
        m_left, m_right = float(xs[0]), float(xs[-1])
        side_gaps = []
        if left_px > 6 and side_free(row, m_left, -1):
            side_gaps.append(abs(left_px - m_left))
        if right_px < RENDER - 6 and side_free(row, m_right, +1):
            side_gaps.append(abs(right_px - m_right))
        if not side_gaps:
            continue
        gap = float(np.mean(side_gaps))
        gaps.append(gap)
        samples.append({"py": row, "proj": [left_px, right_px], "mask": [m_left, m_right], "gap": gap})
    if not gaps:
        return None, None, []
    mean_gap = float(np.mean(gaps))
    return math.exp(-mean_gap / EDGE_GAP_NORM_PX), mean_gap, samples


def declared_height_m(layer: dict, proj_orig: dict) -> float | None:
    """Altura declarada del volumen reconstruida de su capa del compositor:
    (baseline_y − bbox.minY) / (ppm · s(z)) con la proyección ORIGINAL."""
    if not layer:
        return None
    s = proj_orig["focal_m"] / (proj_orig["focal_m"] + max(0.0, layer["z"]))
    h_view = layer["baseline_y"] - layer["bbox"][1]
    if h_view <= 0:
        return None
    return h_view / (proj_orig["px_per_m"] * s)


def fit_sprite_scale(points: list[tuple[float, float]], proj: dict) -> tuple[float, float, float]:
    """Espejo de segments.ts:fitSpriteScale sobre (z, log_ratio): devuelve
    (k, focal_size, std de residuos log). Búsqueda en rejilla log de focales."""
    # Outliers fuera (espejo de segments.ts): a más de ×1.65 de la mediana no votan.
    if len(points) >= 3:
        med = float(np.median([r for _, r in points]))
        kept = [(z, r) for z, r in points if abs(r - med) <= 0.5]
        if len(kept) >= 2:
            points = kept
    if len(points) < 2 or (max(z for z, _ in points) - min(z for z, _ in points)) < 1.5:
        k = float(np.exp(np.median([r for _, r in points]))) if points else 1.0
        resid = float(np.std([r for _, r in points])) if points else 0.0
        return k, proj["focal_m"], resid
    best = None
    for i in range(61):
        fs = 2 * (200 ** (i / 60))
        resid = [r - np.log((fs / (fs + z)) / (proj["focal_m"] / (proj["focal_m"] + z)))
                 for z, r in points]
        mean = float(np.mean(resid))
        err = float(np.sum((np.array(resid) - mean) ** 2))
        if best is None or err < best[3]:
            best = (float(np.exp(mean)), fs, float(np.std(np.array(resid) - mean)), err)
    return best[0], best[1], best[2]


def scale_err_metric(items: list, dump: dict, layers: dict,
                     proj_orig: dict) -> tuple[float | None, float | None, dict]:
    """(score, std de residuos log tras el ajuste, detalle). El cliente ajusta
    un modelo de TALLA {k, focal_size} al mobiliario pintado y escala a los
    personajes con él — lo que importa no es el error absoluto (k lo absorbe)
    sino la CONSISTENCIA: si todos los items comparten modelo, los personajes
    casan con todo; residuos altos = items imposibles de casar a la vez."""
    proj, vb = dump["proj"], dump["view_box"]
    px_per_view = RENDER / vb["height"]
    per = {}
    points: list[tuple[float, float]] = []
    for it in items:
        if it.get("mask") is None or not it.get("pose") or it.get("action") != "keep":
            continue
        if it["source"] == "expected":
            h_m = declared_height_m(layers.get(it["id"]), proj_orig)
        else:
            h_m = it.get("h")
        if not h_m:
            continue
        z = max(0.0, it["pose"]["z"])
        s = proj["focal_m"] / (proj["focal_m"] + z)
        expected_px = h_m * proj["px_per_m"] * s * px_per_view
        painted_px = it["mask_bbox"][3] - it["mask_bbox"][1]
        if expected_px <= 0 or painted_px <= 0:
            continue
        ratio = painted_px / expected_px
        per[it["id"]] = {"painted_px": painted_px, "expected_px": expected_px,
                         "ratio": ratio, "z": z}
        points.append((z, math.log(ratio)))
    if not points:
        return None, None, per
    k, fs, resid_std = fit_sprite_scale(points, proj)
    per["_model"] = {"k": k, "focal_size_m": fs, "resid_std": resid_std}
    return math.exp(-2.0 * resid_std), resid_std, per


def unexplained_metric(floor_mask: np.ndarray | None, items: list,
                       floor: dict) -> tuple[float | None, float | None]:
    """(score, fracción). Región del SUELO pintado (el trapecio de la visión,
    no el rectángulo — fuera del trapecio hay paredes/bastidores legítimos)
    que no es ni suelo ni ningún elemento inventariado = pintado SIN
    identificar (pisable por error)."""
    if floor_mask is None or not floor_mask.any():
        return None, None
    wall_py = max(0, int(floor["wall_base_px"]))
    front_py = min(RENDER, int(floor.get("front_px", RENDER)))
    trap = [floor.get(k) for k in ("left_wall_px", "right_wall_px", "left_front_px", "right_front_px")]
    region = np.zeros((RENDER, RENDER), dtype=bool)
    if all(v is not None for v in trap) and front_py > wall_py:
        lw, rw, lf, rf = (float(v) for v in trap)
        rows = np.arange(wall_py, front_py)
        t = (rows - wall_py) / max(1, front_py - wall_py)
        lefts = np.clip(np.round(lw + (lf - lw) * t).astype(int), 0, RENDER)
        rights = np.clip(np.round(rw + (rf - rw) * t).astype(int), 0, RENDER)
        for row, l, r in zip(rows, lefts, rights):
            if r > l:
                region[row, l:r] = True
    else:
        region[wall_py:front_py] = True
    claimed = floor_mask.copy()
    for it in items:
        if it.get("mask") is not None:
            claimed |= it["mask"]
    unexplained = region & ~claimed
    frac = float(unexplained.sum() / max(1, region.sum()))
    return max(0.0, 1.0 - frac), frac


def compute_score(*, dump: dict, items: list, floor: dict,
                  floor_mask: np.ndarray | None, layers: dict, proj_orig: dict,
                  recon_diff: float | None, world_to_px, view_to_stage) -> dict:
    iou_score, iou_per = iou_boxes_metric(items)
    contact = contact_ok_metric(items)
    items_mask = None
    item_masks = [it["mask"] for it in items if it.get("mask") is not None]
    if item_masks:
        items_mask = np.zeros_like(item_masks[0], dtype=bool)
        for m in item_masks:
            items_mask |= m
    edge_score, edge_gap_px, edge_samples = edge_gap_metric(
        dump, floor_mask, floor, world_to_px, view_to_stage, items_mask)
    scale_score, scale_err, scale_per = scale_err_metric(items, dump, layers, proj_orig)
    unexpl_score, unexpl_frac = unexplained_metric(floor_mask, items, floor)
    recon_score = math.exp(-recon_diff / 3.0) if recon_diff is not None else None

    components = {
        "iou_boxes": iou_score,
        "contact_ok": contact,
        "edge_gap": edge_score,
        "scale_err": scale_score,
        "unexplained": unexpl_score,
        "recon": recon_score,
    }
    total_w = sum(WEIGHTS[k] for k, v in components.items() if v is not None)
    composite = (
        100.0 * sum(WEIGHTS[k] * v for k, v in components.items() if v is not None) / total_w
        if total_w > 0 else 0.0
    )
    return {
        "composite": round(composite, 1),
        "components": {k: (round(v, 3) if v is not None else None) for k, v in components.items()},
        "detail": {
            "iou_per_item": {k: round(v, 3) for k, v in iou_per.items()},
            "edge_gap_px": round(edge_gap_px, 1) if edge_gap_px is not None else None,
            "edge_samples": edge_samples,
            "scale_rel_err": round(scale_err, 3) if scale_err is not None else None,
            "scale_per_item": {k: {kk: round(vv, 1) if isinstance(vv, float) else vv
                                   for kk, vv in p.items()} for k, p in scale_per.items()},
            "unexplained_frac": round(unexpl_frac, 4) if unexpl_frac is not None else None,
            "recon_diff": round(recon_diff, 2) if recon_diff is not None else None,
        },
    }


def append_csv(csv_path: Path, run_name: str, score: dict) -> None:
    exists = csv_path.exists()
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if not exists:
            w.writerow(["run", "composite", *WEIGHTS.keys()])
        w.writerow([run_name, score["composite"],
                    *[score["components"][k] for k in WEIGHTS]])


# ── Overlay side-by-side: pintura+visión | verdad jugable ──────────────────

CHARACTER_H_M = 1.7
CHARACTER_W_M = 0.45


def draw_side_by_side(base: Image.Image, dump: dict, floor: dict, items: list,
                      solid: np.ndarray, floor_mask: np.ndarray | None,
                      world_to_px, view_to_stage, stage_to_view, view_to_px) -> Image.Image:
    """Izquierda: la pintura con el trapecio del suelo de la VISIÓN + cajas.
    Derecha: la misma pintura con la VERDAD JUGABLE reproyectada — celdas de
    colisión, bordes jugables (deben calcar el trapecio), exits y siluetas de
    personaje a z=0, D/2, D para juzgar la escala calibrada."""
    proj, vb, rect = dump["proj"], dump["view_box"], dump["rect"]

    left = base.convert("RGB").copy()
    d = ImageDraw.Draw(left)
    trap = [floor.get(k) for k in ("left_wall_px", "right_wall_px", "left_front_px", "right_front_px")]
    wall_py, front_py = floor["wall_base_px"], floor.get("front_px", RENDER)
    if all(v is not None for v in trap):
        lw, rw, lf, rf = trap
        d.line([(lf, front_py), (lw, wall_py)], fill="#ffd24a", width=3)
        d.line([(rf, front_py), (rw, wall_py)], fill="#ffd24a", width=3)
    d.line([(0, wall_py), (RENDER, wall_py)], fill="#ffd24a", width=2)
    if front_py < RENDER:
        d.line([(0, front_py), (RENDER, front_py)], fill="#ffd24a", width=2)
    for it in items:
        if it.get("action") != "keep":
            continue
        x, y, w, h = it["box_px"]
        color = "#ff5a5a" if it.get("solid", True) else "#4ad2ff"
        d.rectangle([x, y, x + w, y + h], outline=color, width=2)
        d.text((x + 3, max(0, y - 13)), it["label"][:30], fill=color)
    d.text((10, 8), "VISIÓN: trapecio del suelo + cajas", fill="#ffd24a")

    right = base.convert("RGBA").copy()
    layer = Image.new("RGBA", right.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    rows, cols = solid.shape
    mpc = (rect["maxX"] - rect["minX"]) / cols
    for r in range(rows):
        for c in range(cols):
            if not solid[r, c]:
                continue
            x0 = rect["minX"] + c * mpc
            z0 = rect["minZ"] + r * mpc
            quad = [world_to_px(dump, x, z) for x, z in
                    ((x0, z0), (x0 + mpc, z0), (x0 + mpc, z0 + mpc), (x0, z0 + mpc))]
            dr.polygon(quad, fill=(230, 40, 120, 80), outline=(230, 40, 120, 180))
    # Bordes jugables proyectados (xStage=±W/2 y zStage∈{0, depth}).
    half_w = proj["width_m"] / 2
    cx0 = (rect["minX"] + rect["maxX"]) / 2
    corners = [world_to_px(dump, cx0 + sx * half_w, rect["minZ" if back else "maxZ"])
               for sx, back in ((-1, True), (1, True), (1, False), (-1, False))]
    dr.polygon(corners, outline=(80, 255, 120, 230))
    for ex in dump["exits"]:
        r_ = ex["rect"]
        quad = [world_to_px(dump, x, z) for x, z in
                ((r_["minX"], r_["minZ"]), (r_["maxX"], r_["minZ"]),
                 (r_["maxX"], r_["maxZ"]), (r_["minX"], r_["maxZ"]))]
        dr.polygon(quad, outline=(255, 200, 60, 220))
    # Siluetas de personaje: z=0, D/2, D en el eje central calibrado.
    px_per_view = RENDER / vb["height"]
    for z_stage in (0.0, proj["depth_m"] / 2, proj["depth_m"]):
        s = proj["focal_m"] / (proj["focal_m"] + z_stage)
        vx, vy = stage_to_view(proj, proj.get("cam_x_m", 0.0), z_stage)
        px, py = view_to_px(vb, vx, vy)
        w = CHARACTER_W_M * proj["px_per_m"] * s * px_per_view
        h = CHARACTER_H_M * proj["px_per_m"] * s * px_per_view
        dr.rectangle([px - w / 2, py - h, px + w / 2, py], outline=(120, 220, 255, 240), width=3)
        dr.ellipse([px - w / 2, py - w / 6, px + w / 2, py + w / 6], fill=(120, 220, 255, 90))
    out_r = Image.alpha_composite(right, layer).convert("RGB")
    dr2 = ImageDraw.Draw(out_r)
    dr2.text((10, 8), "JUEGO: colisión + bordes jugables + escala de personaje", fill="#50ff78")

    combo = Image.new("RGB", (RENDER * 2 + 8, RENDER), "#101014")
    combo.paste(left, (0, 0))
    combo.paste(out_r, (RENDER + 8, 0))
    return combo
