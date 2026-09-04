"""Contador de gasto en APIs de IA de pago (Meshy, fal) para el panel de dev.

Cada llamada REAL a una API de pago (nunca los cache-hits del SceneImageCache
ni del DevApiCache) registra su coste ESTIMADO — tablas estáticas de
`meshy_client.py`, no facturación real — como una línea JSON en
`cache/spend/events.jsonl`. Los 3 procesos del stack (narrative-llm,
gpu-worker, remote-gen) escriben al mismo fichero: un append de una línea
corta es atómico en POSIX (O_APPEND), así que no hace falta lock ni IPC —
mismo patrón de estado compartido por disco que `dev_api_cache.py`. El total
lo sirve remote-gen en GET /dev/status y el cliente lo muestra en euros.

**El ledger real no se abre desde un proceso de test** (#392). Los tests del
adaptador de sprite-forge hacen POST a `/skin_sprite_sheet` contra un forge de
mentira, y ese camino llama a `SPEND.add` con el `cost_usd` de la fixture: 43
eventos y $10,32 de gasto INVENTADO por corrida, en el mismo fichero que se
mira para decidir si se sigue gastando. Cuando se descubrió, el ledger ya
arrastraba 240 eventos de test ($57,60). Aquí hay dos candados, y hacen falta
los dos: `NEFAN_SPEND_DIR` para desplazar el ledger a un temporal, y la
NEGATIVA de `SpendTracker.__init__` a construirse sobre la ruta real desde un
proceso que ya importó `unittest`. Solo la variable no bastaba: olvidarla sería
verde y sucio, que es exactamente como llegamos aquí.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Mapping
from pathlib import Path

RAIZ_REPO = Path(__file__).resolve().parent.parent

#: El ledger de gasto de ESTE checkout. Es dinero: lo que hay dentro es lo que
#: se mira para decidir si se sigue gastando.
RUTA_REAL = RAIZ_REPO / "cache" / "spend"

#: Variable que desplaza el ledger a otro directorio (#392). Precedente de
#: nombre y forma: `NEFAN_MANIFEST_DB` (#391) y `NEFAN_GAMES_DIR`/`NEFAN_SAVES_DIR`.
ENV_SPEND_DIR = "NEFAN_SPEND_DIR"


def raiz_del_ledger(env: Mapping[str, str] | None = None) -> Path:
    """Dónde escribe el singleton: `NEFAN_SPEND_DIR` si está, y si no `RUTA_REAL`.

    Una ruta absoluta pasa intacta; una relativa se resuelve contra la raíz del
    repo y no contra el cwd, para que la variable diga lo mismo se arranque
    desde donde se arranque.

    Puesta pero EN BLANCO no es «sin override»: es una variable mal puesta, y
    tragársela devolvería la ruta real — justo lo que la variable existe para
    evitar. Mismo criterio que `NEFAN_MANIFEST_DB`.
    """
    entorno = os.environ if env is None else env
    crudo = entorno.get(ENV_SPEND_DIR)
    if crudo is None:
        return RUTA_REAL
    if crudo.strip() == "":
        raise RuntimeError(
            f"{ENV_SPEND_DIR} está puesta pero vacía: quítala o dale el directorio del ledger"
        )
    ruta = Path(crudo)
    return ruta if ruta.is_absolute() else (RAIZ_REPO / ruta)


class SpendTracker:
    def __init__(self, root: Path):
        root = Path(root)
        # La garantía va en el tipo, no en la disciplina: bajo test el ledger
        # real NO SE PUEDE NOMBRAR. Se rechaza en el constructor y no en `add`
        # porque las LECTURAS también sobran — un `status()` sobre el ledger de
        # la máquina hace que el test dependa de cuánto se haya gastado hoy.
        #
        # `"unittest" in sys.modules` es un olfateo, y por eso está medido: con
        # el stack de producción (fastapi + starlette + httpx + pydantic +
        # numpy + PIL, y `routers.remote_generation` importado) es False, y
        # pytest no está instalado. Si algún día una dependencia importara
        # `unittest`, remote-gen se negaría a arrancar diciendo por qué: fallo
        # ruidoso, que es el que se arregla.
        if root.resolve() == RUTA_REAL and "unittest" in sys.modules:
            raise RuntimeError(
                f"el ledger de gasto REAL ({RUTA_REAL / 'events.jsonl'}) no se abre desde un "
                f"proceso de test: es dinero, y un test que lo escribe inventa gasto. "
                f"Pon {ENV_SPEND_DIR} a un directorio de usar y tirar, p.ej.: "
                f"{ENV_SPEND_DIR}=$(mktemp -d) python -m unittest discover -s ai_server/tests"
            )
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


SPEND = SpendTracker(raiz_del_ledger())
