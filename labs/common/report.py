"""report.py — index.html de run y manifest idempotente compartidos.

El CSS oscuro + grid de tarjetas que cada bench copiaba se centraliza aquí;
las tarjetas (el HTML del cuerpo) siguen siendo del lab, que es quien conoce
sus campos.
"""

from __future__ import annotations

import json
from pathlib import Path

PAGE_CSS = """
  body { background:#1c1c1c; color:#ddd; font:15px/1.5 system-ui; margin:24px; }
  .card { display:grid; grid-template-columns: 560px 1fr; gap:20px;
          border-bottom:1px solid #333; padding:24px 0; }
  img { width:560px; height:auto; image-rendering:auto; }
  pre { white-space:pre-wrap; background:#252525; padding:12px; font-size:12.5px; }
  .params { color:#8fb35c; font-family:monospace; font-size:13px; }
  .note { color:#aaa; } .refs { color:#d9a24a; font-size:13px; }
  h1 { font-size:20px; } h2 { font-size:16px; margin:0 0 4px; }
"""


def render_page(title: str, body_html: str, out_path: Path, css: str = PAGE_CSS) -> None:
    out_path.write_text(
        f"""<!doctype html><meta charset="utf-8">
<title>{title}</title>
<style>{css}</style>
{body_html}
""",
        encoding="utf-8",
    )


def manifest_upsert(manifest_path: Path, entry: dict, key: str = "file") -> list[dict]:
    """Lee el manifest si existe, reemplaza la entrada con el mismo `key` y
    reescribe — el patrón append-idempotente que repetían los benches."""
    entries: list[dict] = (
        json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else []
    )
    entries = [e for e in entries if e.get(key) != entry.get(key)] + [entry]
    manifest_path.write_text(
        json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return entries
