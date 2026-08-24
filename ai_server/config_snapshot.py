"""Snapshot de configuración compartido por los procesos Python del stack
(narrative-llm :8765, remote-gen :8768, asset-store :8767): carga del `.env`
del repo y lectura del runtime_config.json que genera
`nefan-core/scripts/dump-config.ts` (fuente única: nefan-core/src/config.ts).
"""

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger("ai_server")

REPO_ROOT = Path(__file__).resolve().parent.parent
RUNTIME_CONFIG_PATH = REPO_ROOT / "nefan-core" / "data" / "runtime_config.json"


def load_env_file(env_path: Path | None = None) -> None:
    """Load .env into os.environ (simple parser, no python-dotenv dependency)."""
    path = env_path if env_path is not None else REPO_ROOT / ".env"
    if not path.exists():
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def load_snapshot(config_path: Path | None = None) -> dict:
    """El runtime_config.json completo (incluido el bloque `ports`).

    Fail-loud: sin snapshot no hay defaults inventados. Regenerar con
    `cd nefan-core && npx tsx scripts/dump-config.ts` (o cualquier
    `npm run build/dev/test`, que lo dispara como pre-hook)."""
    path = Path(config_path) if config_path else RUNTIME_CONFIG_PATH
    if not path.exists():
        raise FileNotFoundError(
            f"runtime_config.json not found at {path}. "
            "Run `cd nefan-core && npx tsx scripts/dump-config.ts` to regenerate it."
        )
    with open(path) as f:
        return json.load(f)


def load_config(config_path: Path | None = None) -> dict:
    """El bloque `ai_server` del snapshot (config de los tres procesos).

    Fail-loud: a missing file or a missing `ai_server` block is a hard error."""
    path = Path(config_path) if config_path else RUNTIME_CONFIG_PATH
    full = load_snapshot(config_path)
    ai = full.get("ai_server")
    if not isinstance(ai, dict):
        raise ValueError(
            f"{path} has no `ai_server` block. Update nefan-core/src/config.ts."
        )
    logger.info(f"Config loaded from: {path}")
    return ai


def load_port(service_key: str) -> int:
    """Puerto de escucha de un servicio del bloque `ports` (fail-loud)."""
    ports = load_snapshot().get("ports")
    if not isinstance(ports, dict) or service_key not in ports:
        raise ValueError(
            f"runtime_config.json has no ports.{service_key}. "
            "Update nefan-core/src/config.ts and regenerate the snapshot."
        )
    return int(ports[service_key])
