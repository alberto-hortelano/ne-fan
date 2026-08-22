"""Contador de gasto en APIs de IA de pago (Meshy, fal) para el panel de dev.

Cada llamada REAL a una API de pago (nunca los cache-hits del SceneImageCache
ni del DevApiCache) registra su coste ESTIMADO — tablas estáticas de
`meshy_client.py`, no facturación real — como una línea JSON en
`cache/spend/events.jsonl`. Los 3 procesos del stack (narrative-llm,
gpu-worker, remote-gen) escriben al mismo fichero: un append de una línea
corta es atómico en POSIX (O_APPEND), así que no hace falta lock ni IPC —
mismo patrón de estado compartido por disco que `dev_api_cache.py`. El total
lo sirve remote-gen en GET /dev/status y el cliente lo muestra en euros.
"""

from __future__ import annotations

import json
import time
from pathlib import Path


class SpendTracker:
    def __init__(self, root: Path):
        self.root = root
        self._events_path = root / "events.jsonl"

    def add(self, usd: float, what: str, service: str) -> None:
        """Registra una llamada de pago real. `what` = qué se generó (prompt
        recortado, categoría…), `service` = proceso que la lanzó."""
        self.root.mkdir(parents=True, exist_ok=True)
        line = json.dumps(
            {"t": time.time(), "usd": round(float(usd), 4), "what": what[:120], "service": service},
            ensure_ascii=False,
        )
        # Un solo write en modo append: atómico entre procesos para líneas
        # cortas — nunca read-modify-write aquí.
        with open(self._events_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        print(
            f"Spend: +${usd:.2f} ({service}: {what[:60]}) — acumulado ${self.total_usd():.2f}",
            flush=True,
        )

    def _events(self) -> list[dict]:
        if not self._events_path.exists():
            return []
        # Parse estricto (fail-loud): las líneas se escriben de un solo append,
        # una línea corrupta es un bug, no ruido a tragar.
        return [
            json.loads(line)
            for line in self._events_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def total_usd(self) -> float:
        return round(sum(e["usd"] for e in self._events()), 4)

    def status(self, limit: int = 15) -> dict:
        events = self._events()
        return {
            "total_usd": round(sum(e["usd"] for e in events), 4),
            "call_count": len(events),
            "calls": events[-limit:],
        }


SPEND = SpendTracker(Path(__file__).resolve().parent.parent / "cache" / "spend")
