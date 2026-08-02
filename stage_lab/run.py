#!/usr/bin/env python3
"""stage_lab — bench de la segmentación del plató PINTADO (proscenio).

Reproduce el pipeline de recortes del cliente paso a paso sobre una imagen
pintada cacheada, con la visión EN EL BUCLE (un fichero --boxes con el mismo
contrato que la respuesta del kind MCP stage_review): SAM2 segment_boxes por
caja → máscaras de la IMAGEN → contactos → pose/huella/colisión en mundo →
(opcional) pelado con FLUX Fill → placa + diff de reconstrucción. Emite una
hoja de contactos HTML para evaluar A OJO cada paso sin quemar repintados.

JAMÁS se rasteriza el SVG declarado como máscara: lo declarado (dump del
compositor) solo aporta pistas (cajas esperadas), profundidades de huella y
la geometría de desproyección.

Uso:
  source .venv/bin/activate
  python stage_lab/run.py \
    --image cache/scenes/5769e7fb0d2b3fcc/scene.png \
    --stage stage_lab/dumps/posada_salon.json \
    --boxes stage_lab/boxes/posada_salon_v1.json \
    --name 001_salon [--peel]

Las llamadas a SAM se cachean en runs/.sam_cache por (imagen, caja): iterar
el código o los overlays es gratis; cambiar una caja solo re-segmenta esa.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import statistics
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ai_server"))

from image_review import bottom_contour, mask_bbox, mask_from_png  # noqa: E402
from scene_segmenter import crop_sprite, scene_rgb_from_png, _to_data_uri  # noqa: E402

RENDER = 1024
CELL_MPC = 0.5
PLAYER_RADIUS = 0.4
MIN_CONTACT_POINTS = 3

RUNS = Path(__file__).resolve().parent / "runs"
SAM_CACHE = RUNS / ".sam_cache"

PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0",
           "#f032e6", "#bcf60c", "#fabebe", "#008080", "#9a6324", "#800000"]


def load_env_key() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    import os
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# ── Geometría (espejo de nefan-core/src/scene/stage/{projection,segments}.ts) ──

def px_to_view(vb: dict, px: float, py: float) -> tuple[float, float]:
    return (vb["minX"] + (px / RENDER) * vb["width"],
            vb["minY"] + (py / RENDER) * vb["height"])


def view_to_px(vb: dict, vx: float, vy: float) -> tuple[float, float]:
    return (((vx - vb["minX"]) / vb["width"]) * RENDER,
            ((vy - vb["minY"]) / vb["height"]) * RENDER)


def view_to_stage(proj: dict, vx: float, vy: float) -> tuple[float, float] | None:
    s = (vy - proj["horizon_y"]) / (proj["ground_y"] - proj["horizon_y"])
    if s <= 0:
        return None
    z = (proj["focal_m"] * (1 - s)) / s
    cx = proj.get("center_x", 0.0)
    xc = proj.get("cam_x_m", 0.0)
    return ((vx - cx) / (proj["px_per_m"] * s) + xc, z)


def stage_to_view(proj: dict, xs: float, zs: float) -> tuple[float, float]:
    s = proj["focal_m"] / (proj["focal_m"] + max(0.0, zs))
    cx = proj.get("center_x", 0.0)
    xc = proj.get("cam_x_m", 0.0)
    return (cx + (xs - xc) * proj["px_per_m"] * s,
            proj["horizon_y"] + (proj["ground_y"] - proj["horizon_y"]) * s)


def stage_to_world(rect: dict, xs: float, zs: float) -> tuple[float, float]:
    return (xs + (rect["minX"] + rect["maxX"]) / 2, rect["maxZ"] - zs)


def world_to_px(dump: dict, x: float, z: float) -> tuple[float, float]:
    xs = x - (dump["rect"]["minX"] + dump["rect"]["maxX"]) / 2
    zs = dump["rect"]["maxZ"] - z
    return view_to_px(dump["view_box"], *stage_to_view(dump["proj"], xs, zs))


def calibrated_projection(proj: dict, vb: dict, floor: dict) -> dict:
    """Espejo de segments.ts:calibratedProjection — la perspectiva PINTADA
    manda: ground_y/horizon_y reajustados para que z=0 caiga en el frente
    pintado y z=depth en la base de la pared pintada. Con el trapecio lateral
    (left/right_wall_px + left/right_front_px) resuelve además px_per_m,
    focal y centro/cámara laterales (modelo vx = cx + (xs − xc)·ppm·s);
    degenerado → calibración vertical-only con aviso."""
    front_px = floor.get("front_px", RENDER)
    if not floor["wall_base_px"] < front_px:
        raise ValueError("floor.wall_base_px debe estar por encima de front_px")
    vy_wall = vb["minY"] + (floor["wall_base_px"] / RENDER) * vb["height"]
    vy_front = vb["minY"] + (front_px / RENDER) * vb["height"]
    ground = vy_front

    trap_keys = ("left_wall_px", "right_wall_px", "left_front_px", "right_front_px")
    if all(floor.get(k) is not None for k in trap_keys):
        to_vx = lambda px: vb["minX"] + (px / RENDER) * vb["width"]  # noqa: E731
        vx_lw, vx_rw = to_vx(floor["left_wall_px"]), to_vx(floor["right_wall_px"])
        vx_lf, vx_rf = to_vx(floor["left_front_px"]), to_vx(floor["right_front_px"])
        wall_w, front_w = vx_rw - vx_lw, vx_rf - vx_lf
        if wall_w > 0 and front_w > 0:
            s_d = wall_w / front_w
            if 0.05 <= s_d <= 0.95:
                focal = proj["depth_m"] * s_d / (1 - s_d)
                if 2 <= focal <= 400:
                    ppm = front_w / proj["width_m"]
                    mid_f, mid_w = (vx_lf + vx_rf) / 2, (vx_lw + vx_rw) / 2
                    u = (mid_w - mid_f) / (1 - s_d)
                    horizon = (vy_wall - ground * s_d) / (1 - s_d)
                    return {**proj, "focal_m": focal, "px_per_m": ppm,
                            "ground_y": ground, "horizon_y": horizon,
                            "center_x": mid_f + u, "cam_x_m": u / ppm}
        print(f"  [calibración] trapecio degenerado ({floor}) — vertical-only")

    s_d = proj["focal_m"] / (proj["focal_m"] + proj["depth_m"])
    horizon = (vy_wall - ground * s_d) / (1 - s_d)
    return {**proj, "ground_y": ground, "horizon_y": horizon}


def contact_to_pose(dump: dict, contact_px: list) -> dict | None:
    proj, vb, rect = dump["proj"], dump["view_box"], dump["rect"]
    raw = []
    for px, py in contact_px:
        st = view_to_stage(proj, *px_to_view(vb, px, py))
        if st is None:
            continue
        raw.append((st[0], min(proj["depth_m"], max(0.0, st[1]))))
    if len(raw) < MIN_CONTACT_POINTS:
        return None
    z_med = statistics.median(z for _, z in raw)
    # Filtro anti-saltos del contorno entre patas (espejo de segments.ts).
    filtered = [(x, z) for x, z in raw if abs(z - z_med) <= 0.75] or raw
    return {"z": z_med, "contact_world": [stage_to_world(rect, x, z) for x, z in filtered]}


def footprint_from_contact(contact_world: list, depth_m: float) -> dict:
    xs = [c[0] for c in contact_world]
    max_z = statistics.median([c[1] for c in contact_world])
    return {"minX": min(xs), "maxX": max(xs), "minZ": max_z - depth_m, "maxZ": max_z}


def collision_grid(cutouts: list, rect: dict, exits: list, mpc: float = CELL_MPC):
    cols = max(1, round((rect["maxX"] - rect["minX"]) / mpc))
    rows = max(1, round((rect["maxZ"] - rect["minZ"]) / mpc))
    solid = np.zeros((rows, cols), dtype=bool)

    def mark(x: float, z: float) -> None:
        c = int((x - rect["minX"]) // mpc)
        r = int((z - rect["minZ"]) // mpc)
        if 0 <= c < cols and 0 <= r < rows:
            solid[r, c] = True

    for cut in cutouts:
        pts = cut["contact_world"]
        for i in range(len(pts)):
            x0, z0 = pts[i]
            x1, z1 = pts[i + 1] if i + 1 < len(pts) else pts[i]
            steps = max(1, int(np.hypot(x1 - x0, z1 - z0) / (mpc / 2)) + 1)
            for s in range(steps + 1):
                t = s / steps
                x = x0 + (x1 - x0) * t
                zc = z0 + (z1 - z0) * t
                z = zc - cut["depth_m"]
                while z <= zc + 1e-9:
                    mark(x, z)
                    z += mpc / 2
                mark(x, zc)

    warnings = []
    for ex in exits:
        r_ = ex["rect"]
        c0 = max(0, int((r_["minX"] - PLAYER_RADIUS - rect["minX"]) // mpc))
        c1 = min(cols - 1, int((r_["maxX"] + PLAYER_RADIUS - rect["minX"]) // mpc))
        r0 = max(0, int((r_["minZ"] - PLAYER_RADIUS - rect["minZ"]) // mpc))
        r1 = min(rows - 1, int((r_["maxZ"] + PLAYER_RADIUS - rect["minZ"]) // mpc))
        cleared = int(solid[r0:r1 + 1, c0:c1 + 1].sum())
        if cleared:
            solid[r0:r1 + 1, c0:c1 + 1] = False
            warnings.append(f"salida '{ex['id']}': {cleared} celdas limpiadas")
    return solid, warnings


# ── SAM con caché en disco ─────────────────────────────────────────────────

def segment_boxes_cached(image_png: bytes, boxes: list) -> list:
    """Una máscara PNG por caja, cacheada por (imagen, caja) en disco."""
    from fal_client import FalSamClient

    SAM_CACHE.mkdir(parents=True, exist_ok=True)
    img_hash = hashlib.sha256(image_png).hexdigest()[:16]
    out: list[bytes | None] = [None] * len(boxes)
    todo: list[tuple[int, tuple]] = []
    for i, box in enumerate(boxes):
        key = hashlib.sha256(f"{img_hash}:{box}".encode()).hexdigest()[:24]
        path = SAM_CACHE / f"{key}.png"
        if path.exists():
            out[i] = path.read_bytes()
        else:
            todo.append((i, box))
    if todo:
        client = FalSamClient()
        print(f"SAM2 segment_boxes: {len(todo)} cajas nuevas ({len(boxes) - len(todo)} en caché)…")
        masks = client.segment_boxes(_to_data_uri(image_png), [b for _, b in todo], timeout=120.0)
        for (i, box), png in zip(todo, masks, strict=True):
            key = hashlib.sha256(f"{img_hash}:{box}".encode()).hexdigest()[:24]
            (SAM_CACHE / f"{key}.png").write_bytes(png)
            out[i] = png
    return out  # type: ignore[return-value]


# ── Pelado opcional (FLUX Fill directo, caché por paso) ────────────────────

def build_peel_prompt(behind: list[str], backdrop: str, removed: str) -> str:
    behind_txt = (f"these elements that are partially hidden behind it: {', '.join(behind)}"
                  if behind else "ONLY the empty stage floor")
    far = f" and, at the far end, the painted backdrop ({backdrop})" if backdrop else ""
    return (f"The object being removed is: {removed}. "
            f"Fill the masked region by continuing EXACTLY what lies behind it: {behind_txt}{far}. "
            f"Do NOT paint the {removed} back, nor any similar object. "
            "Extend the floor and the already-visible surfaces seamlessly. "
            "Do NOT invent any new object: no planks, fences, signs, crates, furniture, stoves, windows, doors, plants or creatures "
            "that are not listed above. Match the surrounding painting style, lighting, colours and perspective exactly.")


_LAMA = None


def peel_step_cached(image_png: bytes, mask_l: Image.Image, prompt: str, backend: str) -> bytes:
    # ±16 px: traga patas finas en sombra y halos que SAM deja fuera — el
    # hueco queda TAPADO por su recorte, así que el halo extra no se ve.
    dilated = mask_l
    for _ in range(4):
        dilated = dilated.filter(ImageFilter.MaxFilter(9))
    buf = io.BytesIO()
    dilated.save(buf, "PNG")
    mask_png = buf.getvalue()
    key = hashlib.sha256(
        image_png + mask_png + prompt.encode() + backend.encode()
    ).hexdigest()[:24]
    path = SAM_CACHE / f"peel_{key}.png"
    if path.exists():
        return path.read_bytes()
    if backend == "lama":
        global _LAMA
        if _LAMA is None:
            from plate_inpainter import PlateInpainter
            _LAMA = PlateInpainter()
        fill = _LAMA.generate(image_png, mask_png)
    else:
        from fal_client import FalFillClient
        fill = FalFillClient().fill(image_png, mask_png, prompt)
    # Composite duro: fuera de la máscara dilatada ni un píxel cambia.
    base = Image.open(io.BytesIO(image_png)).convert("RGB")
    filled = Image.open(io.BytesIO(fill)).convert("RGB").resize(base.size)
    out = Image.composite(filled, base, dilated)
    buf = io.BytesIO()
    out.save(buf, "PNG")
    path.write_bytes(buf.getvalue())
    return buf.getvalue()


# ── Overlays ───────────────────────────────────────────────────────────────

def draw_boxes_overlay(base: Image.Image, expected_hints: list, items: list) -> Image.Image:
    img = base.convert("RGB").copy()
    d = ImageDraw.Draw(img)
    for e in expected_hints:
        x, y, w, h = e["box_px"]
        for k in range(0, int(w), 12):  # caja declarada: discontinua gris
            d.line([(x + k, y), (x + min(k + 6, w), y)], fill="#999999", width=2)
            d.line([(x + k, y + h), (x + min(k + 6, w), y + h)], fill="#999999", width=2)
        for k in range(0, int(h), 12):
            d.line([(x, y + k), (x, y + min(k + 6, h))], fill="#999999", width=2)
            d.line([(x + w, y + k), (x + w, y + min(k + 6, h))], fill="#999999", width=2)
    for i, it in enumerate(items):
        x, y, w, h = it["box_px"]
        color = PALETTE[i % len(PALETTE)]
        d.rectangle([x, y, x + w, y + h], outline=color, width=3)
        d.text((x + 4, max(0, y - 14)), f"{it['id']} {it['label'][:28]}", fill=color)
    return img


def draw_masks_overlay(base: Image.Image, items: list) -> Image.Image:
    img = base.convert("RGBA").copy()
    for i, it in enumerate(items):
        mask = it.get("mask")
        if mask is None:
            continue
        color = tuple(int(PALETTE[i % len(PALETTE)][j:j + 2], 16) for j in (1, 3, 5))
        tint = Image.new("RGBA", img.size, color + (110,))
        m = Image.fromarray((mask * 255).astype(np.uint8), "L")
        img = Image.composite(tint, img, m)
    return img.convert("RGB")


def draw_contacts_overlay(base: Image.Image, items: list) -> Image.Image:
    img = base.convert("RGB").copy()
    d = ImageDraw.Draw(img)
    for i, it in enumerate(items):
        color = PALETTE[i % len(PALETTE)]
        for px, py in it.get("contact_px") or []:
            d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=color)
    return img


def draw_collision_overlay(base: Image.Image, dump: dict, solid: np.ndarray) -> Image.Image:
    """Celdas sólidas reproyectadas a la imagen: cada celda es un quad de
    suelo en mundo → stageToView → px (la banda debe caer SOBRE la base
    pintada del elemento, nunca sobre suelo libre)."""
    img = base.convert("RGBA").copy()
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rect = dump["rect"]
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
            d.polygon(quad, fill=(230, 40, 120, 90), outline=(230, 40, 120, 200))
    return Image.alpha_composite(img, layer).convert("RGB")


def full_frame_cutout(scene_rgb: np.ndarray, mask: np.ndarray) -> Image.Image:
    rgba = np.zeros((*scene_rgb.shape[:2], 4), dtype=np.uint8)
    rgba[..., :3] = scene_rgb
    rgba[..., 3] = mask.astype(np.uint8) * 255
    checker = Image.new("RGB", (RENDER, RENDER), "#c8c8c8")
    d = ImageDraw.Draw(checker)
    for y in range(0, RENDER, 32):
        for x in range(0, RENDER, 32):
            if (x // 32 + y // 32) % 2:
                d.rectangle([x, y, x + 32, y + 32], fill="#eeeeee")
    cut = Image.fromarray(rgba, "RGBA")
    checker.paste(cut, (0, 0), cut)
    return checker


# ── Main ───────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--stage", required=True, help="dump de dump_stage.ts")
    ap.add_argument("--boxes", required=True,
                    help="respuesta de visión (contrato stage_review: {expected, extras})")
    ap.add_argument("--name", required=True)
    ap.add_argument("--peel", action="store_true", help="pelar y construir la placa")
    ap.add_argument("--backend", choices=("lama", "flux"), default="lama",
                    help="relleno: lama local (no inventa; default) o FLUX Fill (créditos)")
    args = ap.parse_args()

    load_env_key()
    dump = json.loads(Path(args.stage).read_text())
    review = json.loads(Path(args.boxes).read_text())
    base = Image.open(args.image).convert("RGB")
    if base.size != (RENDER, RENDER):
        base = base.resize((RENDER, RENDER), Image.LANCZOS)
    buf = io.BytesIO()
    base.save(buf, "PNG")
    image_png = buf.getvalue()
    scene_rgb = scene_rgb_from_png(image_png)

    # Calibración: la perspectiva pintada manda (floor de la visión).
    floor = review.get("floor")
    if not floor:
        raise SystemExit("el fichero --boxes necesita floor.wall_base_px (contrato stage_review)")
    dump["proj"] = calibrated_projection(dump["proj"], dump["view_box"], floor)
    print(f"proyección calibrada: ground_y={dump['proj']['ground_y']:.1f} "
          f"horizon_y={dump['proj']['horizon_y']:.1f} (pintura ≠ blueprint)")

    hints = {e["id"]: e for e in dump["expected_elements"]}
    layers = {l["id"]: l for l in dump["layers"]}

    # Inventario unificado (espejo del endpoint).
    items = []
    missing = [e["id"] for e in review["expected"] if e["status"] == "missing"]
    for e in review["expected"]:
        if e["status"] != "found":
            continue
        hint = hints[e["id"]]
        items.append({"id": e["id"], "label": hint["label"], "source": "expected",
                      "action": "keep", "box_px": e["box_px"],
                      "solid": hint["solid"], "tall": hint["tall"]})
    for i, x in enumerate(review.get("extras", [])):
        items.append({"id": f"extra_{i}", "source": "extra", **x})

    # SAM por caja.
    boxes = [(max(0, int(b[0])), max(0, int(b[1])),
              min(RENDER, int(b[0] + b[2])), min(RENDER, int(b[1] + b[3])))
             for b in (it["box_px"] for it in items)]
    mask_pngs = segment_boxes_cached(image_png, boxes)
    for it, png in zip(items, mask_pngs, strict=True):
        mask = mask_from_png(png, (RENDER, RENDER))
        if not mask.any() or mask.sum() < 30:
            print(f"⚠️  {it['id']} ({it['label']}): máscara vacía — descartado")
            it["mask"] = None
            continue
        it["mask"] = mask
        it["mask_bbox"] = mask_bbox(mask)
        it["contact_px"] = bottom_contour(mask) if it["action"] == "keep" else None

    # Pose + huella + z (solo keep con máscara).
    cutouts = []
    for it in items:
        if it.get("mask") is None or it["action"] != "keep":
            it["pose"] = None
            continue
        pose = contact_to_pose(dump, it["contact_px"])
        it["pose"] = pose
        if pose is None:
            print(f"⚠️  {it['id']}: contacto insuficiente — sin pose (solo-inpaint)")
            continue
        layer = layers.get(it["id"])
        if layer and layer.get("footprint"):
            fp = layer["footprint"]
            depth_m = fp[3] - fp[1]
        else:
            depth_m = float(it.get("depth_cells", 2.0)) * dump["meters_per_cell"]
        it["footprint"] = footprint_from_contact(pose["contact_world"], depth_m)
        it["depth_m"] = depth_m
        declared_z = layer["z"] if layer else None
        it["declared_z"] = declared_z
        if declared_z is not None and abs(pose["z"] - declared_z) > 2.0:
            print(f"ℹ️  {it['id']}: z pintada {pose['z']:.1f} vs declarada {declared_z:.1f} (recolocado)")
        if it.get("solid", True):
            cutouts.append({"id": it["id"], "contact_world": pose["contact_world"],
                            "depth_m": depth_m})

    solid, warnings = collision_grid(cutouts, dump["rect"], dump["exits"],
                                     dump["meters_per_cell"])
    for w in warnings:
        print(f"⚠️  {w}")

    # Pelado opcional cerca→lejos por z pintada.
    plate_png = None
    peel_seq = []
    if args.peel:
        order = sorted([it for it in items if it.get("mask") is not None],
                       key=lambda it: it["pose"]["z"] if it.get("pose") else 1e9)

        def overlaps(a: tuple, b: tuple, pad: int = 16) -> bool:
            return not (a[2] + pad < b[0] or b[2] + pad < a[0]
                        or a[3] + pad < b[1] or b[3] + pad < a[1])

        current = image_png
        for i, it in enumerate(order):
            # Solo guía el relleno lo que de verdad SOLAPA el hueco en
            # pantalla — enumerar todo lo lejano invita a FLUX a pintar
            # muebles dentro del hueco (visto en el run 003).
            behind = [o["label"] for o in order[i + 1:]
                      if o["action"] == "keep" and overlaps(it["mask_bbox"], o["mask_bbox"])]
            prompt = build_peel_prompt(behind, dump.get("backdrop", ""), it["label"])
            mask_l = Image.fromarray((it["mask"] * 255).astype(np.uint8), "L")
            print(f"pelando {it['id']} ({i + 1}/{len(order)}) [{args.backend}] detrás=[{', '.join(behind) or 'suelo'}]…")
            current = peel_step_cached(current, mask_l, prompt, args.backend)
            peel_seq.append((it["id"], current))
        plate_png = current

    # Salidas.
    out = RUNS / args.name
    out.mkdir(parents=True, exist_ok=True)
    base.save(out / "00_original.png")
    draw_boxes_overlay(base, dump["expected_elements"], items).save(out / "01_cajas.png")
    draw_masks_overlay(base, items).save(out / "02_mascaras.png")
    draw_contacts_overlay(base, items).save(out / "03_contactos.png")
    draw_collision_overlay(base, dump, solid).save(out / "04_colision.png")
    for i, it in enumerate(items):
        if it.get("mask") is not None:
            full_frame_cutout(scene_rgb, it["mask"]).save(out / f"10_recorte_{it['id']}.png")
    for i, (iid, png) in enumerate(peel_seq):
        (out / f"20_pelado_{i}_{iid}.png").write_bytes(png)
    if plate_png:
        (out / "30_placa.png").write_bytes(plate_png)
        # Reconstrucción: placa + recortes lejos→cerca ≈ original.
        recon = Image.open(io.BytesIO(plate_png)).convert("RGB")
        for it in sorted([i for i in items if i.get("mask") is not None and i["action"] == "keep"],
                         key=lambda i: -(i["pose"]["z"] if i.get("pose") else 1e9)):
            m = Image.fromarray((it["mask"] * 255).astype(np.uint8), "L")
            recon = Image.composite(base, recon, m)
        recon.save(out / "31_reconstruccion.png")
        diff = np.abs(np.asarray(recon, dtype=np.int16) - np.asarray(base, dtype=np.int16)).mean()
        print(f"diff de reconstrucción (media global, halos incluidos): {diff:.2f}/255")

    summary = {
        "items": [{k: v for k, v in it.items() if k not in ("mask", "contact_px")}
                  | {"has_mask": it.get("mask") is not None,
                     "contact_points": len(it.get("contact_px") or [])}
                  for it in items],
        "missing": missing,
        "collision_cells": int(solid.sum()),
        "warnings": warnings,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    rows = "".join(
        f'<div class="card"><h3>{f.name}</h3><img src="{f.name}"></div>'
        for f in sorted(out.glob("*.png"))
    )
    (out / "index.html").write_text(f"""<!doctype html><meta charset="utf-8">
<title>stage_lab — {args.name}</title>
<style>body{{background:#1b1b20;color:#ddd;font-family:sans-serif;margin:20px}}
.card{{display:inline-block;margin:8px;vertical-align:top}}
.card img{{max-width:480px;display:block;border:1px solid #444}}
h3{{font-size:13px;margin:4px 0}}</style>
<h1>stage_lab — {args.name}</h1>
<p>missing: {missing} · celdas sólidas: {int(solid.sum())} · avisos: {warnings}</p>
{rows}""", encoding="utf-8")
    print(f"✅ hoja de contactos: {out / 'index.html'}")


if __name__ == "__main__":
    main()
