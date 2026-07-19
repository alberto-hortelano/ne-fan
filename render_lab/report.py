"""report.py — index.html comparativo del run 001_alternativas.

Tabla resumen + tarjetas por tile con: imagen, overlay de fidelidad, métricas,
coste/latencia y badges de capacidades (colisión / oclusión+fade / gestión del
LLM) según el enfoque.

Uso: python3 render_lab/report.py
"""

from __future__ import annotations

import json
from pathlib import Path

LAB = Path(__file__).resolve().parent
RUN = LAB / "runs/001_alternativas"
MANIFEST = RUN / "manifest.json"

#: Capacidades por experimento: (colisión, oclusión+fade, gestión LLM)
BADGES = {
    "e1_repaint": ("requiere análisis SAM2 para añadidos", "occluders vía SAM2 + placa inpainted", "declarativo garantizado"),
    "e2a_three": ("nativa (huellas del plan)", "occluders nativos del plan", "declarativo garantizado"),
    "e2b_free": ("derivable del manifest", "derivable del manifest (bbox+baseline)", "manifest evaluado: perfecto en este run"),
    "e3_sprites": ("nativa (huellas del plan) — SIN SAM2", "el sprite ES el occluder (baseline declarada)", "declarativo garantizado"),
    "e3_sprites_t2i": ("nativa (huellas del plan) — SIN SAM2", "el sprite ES el occluder (baseline declarada)", "declarativo garantizado"),
    "e4_patterns": ("nativa (huellas del plan)", "occluders nativos del plan", "declarativo garantizado"),
    "e5_hybrid": ("nativa (huellas del plan)", "occluders vía SAM2 (o recorte por huella)", "declarativo garantizado"),
}
BADGE_CLASS = {"nativa": "ok", "SIN SAM2": "ok", "declarativo": "ok", "derivable": "mid", "manifest": "mid", "requiere": "warn", "SAM2": "warn"}


def badge_html(text: str) -> str:
    cls = "warn" if ("SAM2" in text and "SIN" not in text) or text.startswith("requiere") else (
        "mid" if text.startswith(("derivable", "manifest")) else "ok")
    return f'<span class="badge {cls}">{text}</span>'


def fmt_metrics(m: dict | None) -> str:
    if not m:
        return "<td>—</td><td>—</td><td>—</td><td>—</td>"
    b = m.get("buildings") or {}
    a = m.get("all") or {}
    return (
        f"<td>{b.get('pct_matched', '—')}</td><td>{b.get('mean_offset_pct', '—')}</td>"
        f"<td>{a.get('pct_matched', '—')}</td><td>{m.get('n_unmatched_big_masks', '—')}</td>"
    )


def main() -> None:
    entries = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
    by_name = {e["name"]: e for e in entries}

    # Casos extra sin score SAM (freeform: evaluación de gestión, no layout).
    mgmt = {}
    mgmt_path = RUN / "dumps/e2b_management_report.json"
    if mgmt_path.exists():
        mgmt = json.loads(mgmt_path.read_text())
    for tile in ("medieval", "scifi"):
        name = f"e2b_free__{tile}"
        if (RUN / "images" / f"{name}.png").exists() and name not in by_name:
            by_name[name] = {"name": name, "tile": tile, "exp": "e2b_free", "cost_usd": 0.0,
                             "note": "escena three.js escrita LIBREMENTE por el LLM desde la descripción",
                             "management": mgmt.get(tile)}

    rows = []
    cards = []
    order = sorted(by_name.values(), key=lambda e: (e.get("tile", ""), e.get("exp", ""), e["name"]))
    for e in order:
        name = e["name"]
        exp = e.get("exp", name.split("__")[0])
        badges = BADGES.get(exp) or BADGES.get(exp.rsplit("_", 1)[0]) or ("?", "?", "?")
        m = e.get("metrics")
        cost = e.get("cost_usd")
        cost_s = f"${cost:.2f}" if isinstance(cost, (int, float)) else "—"
        rows.append(
            f"<tr><td>{e.get('tile','')}</td><td><a href='#{name}'>{name}</a></td>"
            + fmt_metrics(m)
            + f"<td>{cost_s}</td><td>{e.get('elapsed_s', '—')}</td>"
            + f"<td>{badge_html(badges[0])}</td><td>{badge_html(badges[1])}</td><td>{badge_html(badges[2])}</td></tr>"
        )
        figs = [(f"../../fixtures/{e.get('tile')}/blueprint.png", "blueprint (referencia)"),
                (f"images/{name}.png", "generada")]
        if (RUN / "overlays" / f"{name}.png").exists():
            figs.append((f"overlays/{name}.png", "overlay (verde=casado rojo=perdido magenta=inventado)"))
        figs_html = "".join(
            f'<figure><img src="{src}" loading="lazy"><figcaption>{cap}</figcaption></figure>'
            for src, cap in figs
        )
        extra = ""
        if e.get("management"):
            extra = f"<details open><summary>evaluación de gestión (E2b)</summary><pre>{json.dumps(e['management'], indent=1, ensure_ascii=False)}</pre></details>"
        elif m:
            extra = f"<details><summary>métricas</summary><pre>{json.dumps(m, indent=1, ensure_ascii=False)}</pre></details>"
        cards.append(
            f'<section id="{name}"><h2>{name}</h2>'
            f"<p>{e.get('note', '')} · coste {cost_s}/tile · {e.get('elapsed_s', '—')}s</p>"
            f"<p>{badge_html(badges[0])} {badge_html(badges[1])} {badge_html(badges[2])}</p>"
            f'<div class="imgs">{figs_html}</div>{extra}</section>'
        )

    html = (
        "<!doctype html><meta charset=utf-8><title>render_lab 001 — alternativas de generación</title><style>"
        "body{font-family:system-ui;background:#141414;color:#ddd;margin:2rem;max-width:1500px}"
        "table{border-collapse:collapse;font-size:.85rem}td,th{border:1px solid #444;padding:.3rem .55rem}"
        "a{color:#8fc7ff}.imgs{display:flex;gap:1rem;flex-wrap:wrap}figure{margin:0}img{max-width:440px;display:block}"
        "figcaption{font-size:.8rem;color:#999}pre{white-space:pre-wrap;background:#1e1e1e;padding:.6rem;font-size:.75rem}"
        ".badge{display:inline-block;padding:.1rem .45rem;border-radius:.6rem;font-size:.72rem;margin-right:.25rem}"
        ".badge.ok{background:#1d4022;color:#9fdc9f}.badge.mid{background:#3d3a1d;color:#ded98f}.badge.warn{background:#432020;color:#e0a0a0}"
        "</style><h1>render_lab · run 001 — alternativas de generación del mapa</h1>"
        "<p>Filas por tile y enfoque. Fidelidad = % de edificios del plan que el segmentado SAM2 "
        "encuentra en su sitio (métrica del juego). Badges: cómo obtiene cada enfoque colisión, "
        "oclusión con fade y si el motor narrativo mantiene control del mapa.</p>"
        "<table><tr><th>tile</th><th>caso</th><th>edif. casados %</th><th>offset %</th>"
        "<th>casados % (todo)</th><th>masks inventadas</th><th>$/tile</th><th>t(s)</th>"
        "<th>colisión</th><th>oclusión+fade</th><th>gestión LLM</th></tr>"
        + "".join(rows) + "</table>"
        + "".join(cards)
    )
    (RUN / "index.html").write_text(html)
    print(f"index -> {RUN / 'index.html'}")


if __name__ == "__main__":
    main()
