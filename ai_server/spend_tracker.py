"""Contador de gasto en APIs de IA de pago (Meshy, fal) para el panel de dev.

Cada llamada REAL a una API de pago (nunca los cache-hits del SceneImageCache
ni del DevApiCache) registra su coste ESTIMADO — tablas estáticas de
`meshy_client.py`, no facturación real — como una línea JSON en
`cache/spend/events.jsonl`. Hoy escribe un solo proceso (remote-gen), pero el
fichero sigue siendo append-only: un append de una línea corta es atómico en
POSIX (O_APPEND), así que no hace falta lock ni IPC — mismo patrón de estado
compartido por disco que `dev_api_cache.py`. El total lo sirve remote-gen en
GET /dev/status y el cliente lo muestra en euros.

**Cada evento dice de dónde salió el dólar** (#426): `procedencia` es `real`
(un proveedor que factura: fal, Meshy, el `api` que nombre sprite-forge) o
`fixture` (sprite-forge contestando sus fixtures canónicas, o su proveedor
`fake`: arte con `cost_usd` en el cuerpo y cero en la factura). Sin el campo,
limpiar el ledger era arqueología sobre el texto del prompt, y QA demostró que
un prompt plausible entraba en el barrido. `total_usd()` suma SOLO `real`; el
enum es cerrado y solo tiene valores que tengan escritor — ni `banco` ni
`fake-ai-server`, que no escriben aquí. La procedencia la dice el PROVEEDOR
(`api` en la respuesta de sprite-forge), nunca un literal del llamante salvo
donde el proveedor no tiene doble en el árbol (fal y Meshy).

**El ledger real no se abre desde un proceso de test** (#392). Los tests del
adaptador de sprite-forge hacen POST a `/skin_sprite_sheet` contra un forge de
mentira, y ese camino llamaba a `SPEND.add` con el `cost_usd` de la fixture: 43
eventos y $10,32 de gasto INVENTADO por corrida, en el mismo fichero que se
mira para decidir si se sigue gastando. Cuando se descubrió, el ledger ya
arrastraba 240 eventos de test ($57,60). Desde #426 ese test monta su PROPIO
tracker y la suite entera deja 6 eventos ($1,07) en el temporal, pero eso no
jubila nada: el singleton se construye al IMPORTAR este módulo, así que sin la
variable la suite ni arranca. Aquí hay dos candados, y hacen falta
los dos: `NEFAN_SPEND_DIR` para desplazar el ledger a un temporal, y la
NEGATIVA de `SpendTracker.__init__` a construirse sobre la ruta real desde un
proceso que ya importó `unittest`. Solo la variable no bastaba: olvidarla sería
verde y sucio, que es exactamente como llegamos aquí.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

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


def parece_ledger_de_verdad(root: Path) -> bool:
    """¿Este directorio tiene FORMA de ledger de gasto de un checkout de ne-fan?

    O sea: `…/cache/spend`. La comparación con `RUTA_REAL` sola no bastaba, y lo
    encontró QA: `RUTA_REAL` sale del `__file__` del `spend_tracker.py` que se
    está ejecutando, así que desde un worktree —donde se trabaja a diario en
    esta casa— `NEFAN_SPEND_DIR=/home/al/code/ne-fan/cache/spend` apuntaba al
    ledger de VERDAD y no era «el real» para nadie. Medido: la suite le metía
    43 eventos. La negativa cubría el olvido; no cubría el copiado de una ruta
    absoluta desde otro terminal o desde un documento.

    Por la forma, en cambio, están cubiertos todos los checkouts a la vez, y no
    hay falso positivo posible en un test: un `mktemp -d` nunca acaba en
    `cache/spend`. Quien de verdad quiera un temporal con ese nombre exacto verá
    el mensaje y sabrá por qué.
    """
    return root.name == "spend" and root.parent.name == "cache"


#: De dónde salió el dólar. CERRADO, y solo con valores que tienen escritor:
#: `real` lo escriben fal/Meshy y un sprite-forge con proveedor de verdad;
#: `fixture` lo escribe sprite-forge cuando contesta fixtures o su `fake`.
PROCEDENCIAS: tuple[str, ...] = ("real", "fixture")
Procedencia = Literal["real", "fixture"]

#: Los nombres de `api` con los que sprite-forge dice que NO ha facturado:
#: `fixture` (las respuestas canónicas de `nefan-core/data/contract/fixtures/
#: sprite-forge/`) y `fake` (`image_client.py` del forge, cost 0). Cualquier
#: OTRO nombre es un proveedor y cuenta como dinero: un proveedor nuevo que no
#: esté aquí sale como gasto real, que es el error que se ve, y no como gasto
#: que desaparece.
APIS_QUE_NO_FACTURAN = frozenset({"fixture", "fake"})


def procedencia_segun_api(api: object) -> Procedencia:
    """La procedencia de un evento a partir del `api` que declara sprite-forge.

    `None`, no-string o vacío LANZA: una respuesta que no dice de qué proveedor
    salió no se apunta como gasto de nada — ni real (inflaría el número que se
    mira para seguir gastando) ni fixture (escondería dinero).

    DISTINGUE MAYÚSCULAS a propósito, y se dice para que nadie lo dé por
    cubierto (H4 de la QA de esta tanda): recorta espacios (`" fake "` →
    fixture) pero `"FIXTURE"` cuenta como `real`. La dirección es la segura —un
    nombre que no reconocemos se apunta como dinero, nunca desaparece— y
    sprite-forge emite en minúscula (`api.name`). Bajarlo a minúsculas haría
    que un proveedor llamado `Fixture` dejara de facturar en silencio, que es
    el error caro de los dos.
    """
    if not isinstance(api, str) or not api.strip():
        raise ValueError(
            "sprite-forge no dice de qué proveedor salió (`api` ausente): "
            "no se apunta gasto sin procedencia"
        )
    return "fixture" if api.strip() in APIS_QUE_NO_FACTURAN else "real"


class LedgerIlegible(RuntimeError):
    """El ledger tiene una línea que no se puede leer: sin `procedencia`, con
    una fuera del enum, o que no es JSON. Es dinero: no se suma a medias."""


def _remedio_para_ledger_viejo(ruta: Path) -> str:
    """Qué hacer con un ledger anterior a #426 (eventos sin `procedencia`):
    ARCHIVARLO como en T9, nunca migrarlo por script ni marcarlo `desconocida`.
    Pre-producción: cero compatibilidad hacia atrás.

    El destino sale de la FORMA de la ruta, no de subir tres niveles a ciegas
    (H3 de la QA de esta tanda): un ledger en `<checkout>/cache/spend/` se
    archiva en el `archivo/` de SU checkout, y cualquier otro —`NEFAN_SPEND_DIR`
    apuntando a un temporal— en el de ESTE repo, que es donde vive el archivo
    de verdad. Antes, un ledger viejo en `/tmp/x/` proponía `mv` a
    `/tmp/archivo/cache/spend/`: un comando que se puede copiar y pegar tiene
    que llevar a un sitio que exista por algo."""
    fecha = time.strftime("%Y-%m-%d")
    raiz = ruta.parent
    base = raiz.parent.parent if parece_ledger_de_verdad(raiz) else RAIZ_REPO
    destino = base / "archivo" / "cache" / "spend"
    return (
        f"mkdir -p {destino} && mv {ruta} {destino / f'events-sin-procedencia-{fecha}.jsonl'}"
    )


class SpendTracker:
    def __init__(self, root: Path):
        root = Path(root)
        # La garantía va en el tipo, no en la disciplina: bajo test un ledger de
        # gasto NO SE PUEDE NOMBRAR. Se rechaza en el constructor y no en `add`
        # porque las LECTURAS también sobran — un `status()` sobre el ledger de
        # la máquina hace que el test dependa de cuánto se haya gastado hoy.
        #
        # `"unittest" in sys.modules` es un olfateo, y por eso está medido: con
        # el stack de producción (fastapi + starlette + httpx + pydantic +
        # numpy + PIL, y `routers.remote_generation` importado) es False, y
        # pytest no está instalado. Si algún día una dependencia importara
        # `unittest`, remote-gen se negaría a arrancar diciendo por qué: fallo
        # ruidoso, que es el que se arregla.
        resuelto = root.resolve()
        if "unittest" in sys.modules and (resuelto == RUTA_REAL or parece_ledger_de_verdad(resuelto)):
            cual = "el de ESTE checkout" if resuelto == RUTA_REAL else "el de OTRO checkout (o worktree)"
            raise RuntimeError(
                f"un ledger de gasto REAL ({resuelto / 'events.jsonl'}, {cual}) no se abre desde "
                f"un proceso de test: es dinero, y un test que lo escribe inventa gasto. "
                f"Pon {ENV_SPEND_DIR} a un directorio de usar y tirar, p.ej.: "
                f"{ENV_SPEND_DIR}=$(mktemp -d) python -m unittest discover -s ai_server/tests"
            )
        self.root = root
        self._events_path = root / "events.jsonl"

    def add(self, usd: float, what: str, service: str, *, procedencia: Procedencia) -> None:
        """Registra una llamada a una API de pago. `what` = qué se generó
        (prompt recortado, categoría…), `service` = proceso que la lanzó,
        `procedencia` = si el dólar se facturó (`real`) o lo dijo una fixture.

        `procedencia` es keyword-only y SIN defecto: un `add` que no la
        declare es `TypeError` antes de tocar el disco. Un defecto `real`
        sería la mentira cómoda —todo lo que no se piensa cuenta como dinero—
        y un defecto `fixture` la contraria.
        """
        if procedencia not in PROCEDENCIAS:
            raise ValueError(
                f"procedencia {procedencia!r} no es ninguna de {PROCEDENCIAS}: "
                f"el enum es cerrado y solo admite valores con escritor"
            )
        # El escritor acepta EXACTAMENTE lo que el lector admite, y se comprueba
        # ANTES de tocar el disco. `float(usd)` no bastaba, y los tres bordes los
        # midió la re-QA (H7): `float("0.5")` colaba y la línea se escribía para
        # reventar DESPUÉS en el `print` —el llamante veía el error con el gasto
        # ya apuntado—; `True` se convertía en `1.0` aunque el lector rechaza los
        # bool; y `inf` escribía `usd: Infinity`, que no es JSON estándar, que el
        # lector admitía y que en el wire revienta el `JSON.parse` del navegador.
        if isinstance(usd, bool) or not isinstance(usd, (int, float)):
            raise ValueError(
                f"usd {usd!r} no es un número ({type(usd).__name__}): el importe "
                f"se apunta como lo manda quien cobra, no se convierte aquí"
            )
        importe = float(usd)
        if not math.isfinite(importe) or importe < 0:
            raise ValueError(
                f"usd {usd!r} no es una cantidad pagable: el ledger es append-only "
                f"de lo que se PAGÓ, no una cuenta con abonos ni con infinitos"
            )
        self.root.mkdir(parents=True, exist_ok=True)
        line = json.dumps(
            {
                "t": time.time(),
                "usd": round(importe, 4),
                "what": what[:120],
                "service": service,
                "procedencia": procedencia,
            },
            ensure_ascii=False,
        )
        # Un solo write en modo append: atómico entre procesos para líneas
        # cortas — nunca read-modify-write aquí.
        with open(self._events_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        print(
            f"Spend: +${importe:.2f} [{procedencia}] ({service}: {what[:60]}) — "
            f"acumulado REAL ${self.total_usd():.2f}",
            flush=True,
        )

    def _events(self) -> list[dict]:
        if not self._events_path.exists():
            return []
        # Parse estricto (fail-loud): las líneas se escriben de un solo append,
        # una línea corrupta es un bug, no ruido a tragar. Y una línea SIN
        # `procedencia` es un ledger anterior a #426: no se suma ni como real
        # ni como fixture, se archiva entero (el mensaje trae el comando).
        #
        # Se valida TODO lo que se va a leer después, no solo `procedencia`
        # (H2 de la QA de esta tanda): esto es dinero, y una línea con el campo
        # nuevo pero sin `usd` —o con `usd` en texto, o negativo— salía como
        # `KeyError`/`TypeError` anónimo desde `_suma`, o se sumaba en silencio.
        # Es el mismo agujero que #426 vino a tapar, una capa más abajo: el
        # campo que nadie comprueba.
        eventos = []
        for n, line in enumerate(self._events_path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError as err:
                raise LedgerIlegible(f"{self._events_path}:{n} no es JSON: {err}") from err
            if not isinstance(e, dict):
                raise LedgerIlegible(
                    f"{self._events_path}:{n} no es un objeto JSON, es {type(e).__name__}: "
                    f"un evento del ledger son cinco claves, no un {type(e).__name__}"
                )
            proc = e.get("procedencia")
            if proc not in PROCEDENCIAS:
                que = "sin `procedencia`" if proc is None else f"con procedencia {proc!r} fuera de {PROCEDENCIAS}"
                raise LedgerIlegible(
                    f"{self._events_path}:{n} es un evento {que}: un ledger anterior a #426 "
                    f"no se migra ni se marca, se ARCHIVA como en T9 → "
                    f"{_remedio_para_ledger_viejo(self._events_path)}"
                )
            usd = e.get("usd")
            # `bool` es `int` en Python, y `True` no es una cantidad de dinero.
            if isinstance(usd, bool) or not isinstance(usd, (int, float)):
                raise LedgerIlegible(
                    f"{self._events_path}:{n} tiene `usd` = {usd!r}, que no es un número: "
                    f"el gasto no se suma a medias ni se adivina"
                )
            # `json.loads` admite `NaN` e `Infinity` (extensión de Python sobre
            # JSON), así que una línea con un importe no finito ENTRA y se suma:
            # `total_usd` salía `inf`. Y en el wire lo rechaza el `JSON.parse`
            # del navegador, o sea que el panel se queda sin gasto por una línea.
            if not math.isfinite(usd):
                raise LedgerIlegible(
                    f"{self._events_path}:{n} tiene `usd` = {usd!r}, que no es finito: "
                    f"un importe así no es dinero y además no es JSON estándar"
                )
            if usd < 0:
                raise LedgerIlegible(
                    f"{self._events_path}:{n} tiene `usd` = {usd!r}, negativo: el ledger es "
                    f"append-only de lo que se PAGÓ, no una cuenta con abonos"
                )
            eventos.append(e)
        return eventos

    @staticmethod
    def _suma(events: list[dict], procedencia: str) -> float:
        return round(sum(e["usd"] for e in events if e["procedencia"] == procedencia), 4)

    def total_usd(self) -> float:
        """El gasto REAL: solo los eventos que facturó un proveedor."""
        return self._suma(self._events(), "real")

    def status(self, limit: int = 15) -> dict:
        """Lo que sirve GET /dev/status. `total_usd` y `call_count` son SOLO
        `real`; `calls` trae las últimas N de cualquier procedencia (cada una
        con su campo); `por_procedencia` desglosa las dos claves SIEMPRE, con
        ceros si toca — enum cerrado, dict cerrado."""
        events = self._events()
        reales = [e for e in events if e["procedencia"] == "real"]
        return {
            "total_usd": self._suma(events, "real"),
            "call_count": len(reales),
            "calls": events[-limit:],
            "por_procedencia": {
                p: {
                    "usd": self._suma(events, p),
                    "call_count": sum(1 for e in events if e["procedencia"] == p),
                }
                for p in PROCEDENCIAS
            },
        }


SPEND = SpendTracker(raiz_del_ledger())
