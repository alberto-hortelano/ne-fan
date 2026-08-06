"""fal.py — cliente fal.run compartido, con caché en disco y contador de gasto.

Promoción del `common.py` de labs/render (la única implementación que tenía
caché + gasto). `cache_dir`/`spend_file` son SIEMPRE parámetros: cada lab
conserva su caché histórica donde estaba (moverla invalidaría llamadas ya
pagadas).
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from pathlib import Path

import httpx

from .env import load_key

FAL_BASE = "https://fal.run"


def fal_client(timeout: float = 600.0) -> httpx.Client:
    return httpx.Client(
        headers={"Authorization": f"Key {load_key('FAL_KEY')}"},
        timeout=httpx.Timeout(timeout),
    )


# ---------------------------------------------------------------- gasto

def _spend_state(spend_file: Path) -> dict:
    if spend_file.exists():
        return json.loads(spend_file.read_text())
    return {"total_usd": 0.0, "calls": []}


def add_spend(spend_file: Path, usd: float, what: str) -> float:
    state = _spend_state(spend_file)
    state["total_usd"] = round(state["total_usd"] + usd, 4)
    state["calls"].append({"what": what, "usd": usd, "t": time.strftime("%H:%M:%S")})
    spend_file.parent.mkdir(parents=True, exist_ok=True)
    spend_file.write_text(json.dumps(state, indent=1))
    print(f"  [gasto] +${usd:.3f} ({what}) — acumulado ${state['total_usd']:.2f}")
    return state["total_usd"]


def total_spend(spend_file: Path) -> float:
    return _spend_state(spend_file)["total_usd"]


# ---------------------------------------------------------------- fal con caché

def fal_call(
    endpoint: str,
    payload: dict,
    cost_usd: float,
    client: httpx.Client,
    cache_dir: Path,
    spend_file: Path | None = None,
    tag: str = "",
    extra_key: str = "",
) -> dict:
    """POST a fal.run/<endpoint> con caché en disco. Solo cobra (add_spend) en
    llamadas reales; el replay es gratis. `extra_key` fuerza una entrada de
    caché distinta con el mismo payload (repeticiones para varianza)."""
    key = hashlib.sha256(
        json.dumps({"e": endpoint, "p": payload, "k": extra_key}, sort_keys=True).encode()
    ).hexdigest()[:24]
    cached = cache_dir / f"fal_{key}.json"
    if cached.exists():
        print(f"  [cache-hit] {endpoint} ({tag or key})")
        return json.loads(cached.read_text())
    t0 = time.time()
    resp = client.post(f"{FAL_BASE}/{endpoint}", json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"fal {endpoint} devolvió {resp.status_code}: {resp.text[:400]}")
    out = resp.json()
    out["_elapsed_s"] = round(time.time() - t0, 1)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(out))
    if spend_file is not None:
        add_spend(spend_file, cost_usd, f"{endpoint} {tag}".strip())
    return out


def download_image(entry_or_url, client: httpx.Client) -> bytes:
    url = entry_or_url["url"] if isinstance(entry_or_url, dict) else entry_or_url
    if url.startswith("data:"):
        return base64.b64decode(url.split(",", 1)[1])
    dl = client.get(url)
    dl.raise_for_status()
    return dl.content
