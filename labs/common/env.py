"""env.py — credenciales y raíz del repo para los labs.

Sustituye a las cuatro firmas que crecieron por copia en los benches
(load_fal_key, load_key, _load_env_file, load_env_key): una sola forma de
leer claves del entorno o del `.env` de la raíz del repo.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def load_env_file() -> None:
    """Inyecta el `.env` de la raíz en os.environ sin pisar lo ya definido."""
    env = REPO_ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_key(name: str) -> str:
    """Valor de FAL_KEY/MESHY_API_KEY/…: entorno → `.env` raíz; SystemExit si falta."""
    key = os.environ.get(name, "")
    if not key:
        env = REPO_ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith(f"{name}="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        raise SystemExit(f"{name} no está ni en el entorno ni en .env")
    return key
