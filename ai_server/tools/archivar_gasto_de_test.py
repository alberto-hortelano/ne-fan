#!/usr/bin/env python3
"""Archiva del ledger de gasto los eventos que escribió la SUITE DE TESTS.

`cache/spend/events.jsonl` es el número que se mira para decidir si se sigue
gastando. Hasta #392, correr `python -m unittest discover -s ai_server/tests`
le añadía 43 eventos y $10,32 de gasto INVENTADO: los tests del adaptador de
sprite-forge hacen POST a `/skin_sprite_sheet` contra un forge de mentira que
sirve las fixtures canónicas, y ese camino llama a `SPEND.add` con el
`cost_usd` de la fixture. Cuando se descubrió, el ledger arrastraba 240 de esos
eventos ($57,60 sobre $768,58: el 7,5 % del total).

Esto los saca del ledger. **Nunca borra**: los mueve a
`archivo/cache/spend/events-de-test-<fecha>.jsonl`, línea a línea y enteros,
como manda la casa con todo lo pagado o de sesión. Si mañana resulta que uno
era real, está ahí con su `t`, su `usd` y su `what`.

**El criterio tiene dos mitades, y son distintas a propósito.**

1 · **Fixture VIVA — derivada, nunca copiada.** Un evento es de test cuando su
`what` CONTIENE el prompt con el que la suite pide arte hoy, y ese prompt se lee
de las **fixtures canónicas**
(`nefan-core/data/contract/fixtures/sprite-forge/*.json` → `…skin.prompt`), que
son la respuesta REAL del servicio commiteada en el repo. Copiar aquí la cadena
a mano habría sido la quinta copia del contrato y la única que nadie compara con
nada — el mismo error que mataron esas fixtures. `contains` vale aquí porque el
prompt vivo es largo y descriptivo.

2 · **Fixtures RETIRADAS — declaradas, fechadas y por igualdad EXACTA.** El
prompt de una fixture anterior ya no está en el repo, así que no hay de dónde
derivarlo: se DECLARA en `FIXTURES_RETIRADAS`, con su commit de procedencia y su
ventana de fechas, y la ventana se COMPRUEBA antes de mover nada. Y se
selecciona por igualdad exacta del `what` completo, no por `contains`: el prompt
retirado (`un herrero`) es corto y genérico, y un `contains` se llevaría por
delante cualquier `hero: un herrero de la aldea del norte` que un jugador
hubiera pedido de verdad. Las tres formas exactas que produce el código de
producción (`f"hero: {prompt[:50]}"`, `f"skin {anim}: {prompt[:44]}"`) sí son
inconfundibles.

**DRY-RUN por defecto.** Imprime la tabla de lo que movería, el total que
quedaría y qué se queda, y no toca nada. Solo con `--ejecutar` mueve.

Es rerunnable: al segundo pase no queda nada que seleccionar y sale sin tocar
el fichero. El orden importa y es deliberado —primero se escribe el archivo,
se relee para comprobar que está entero, y solo entonces se reescribe el
ledger con el resto (por fichero temporal + `os.replace`, atómico)—: si algo
revienta a medias, sobran líneas en el archivo, nunca faltan en el dinero.

Uso:
    python ai_server/tools/archivar_gasto_de_test.py              # dry-run
    python ai_server/tools/archivar_gasto_de_test.py --ejecutar
    python ai_server/tools/archivar_gasto_de_test.py --ledger /otro/checkout/cache/spend/events.jsonl
    python ai_server/tools/archivar_gasto_de_test.py --destino …/events-de-otro-lote.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "nefan-core" / "data" / "contract" / "fixtures" / "sprite-forge"
ARCHIVO_POR_DEFECTO = REPO / "archivo" / "cache" / "spend"

sys.path.insert(0, str(REPO / "ai_server"))
from spend_tracker import RUTA_REAL  # noqa: E402

LEDGER_POR_DEFECTO = RUTA_REAL / "events.jsonl"

#: Un prompt más corto que esto seleccionaría medio ledger por accidente. Es
#: dinero: si la fixture cambiara a algo así de genérico, este guion PARA en vez
#: de hacer lo que le pidan.
MINIMO_DISCRIMINANTE = 8

#: Lotes de gasto de test cuya fixture YA NO ESTÁ en el repo. No se pueden
#: derivar —el prompt se fue con su commit—, así que se declaran aquí con su
#: procedencia documental y su ventana de fechas, y la ventana se COMPRUEBA
#: antes de mover nada: un evento con ese `what` fuera de rango para el guion en
#: vez de archivarlo, porque significaría que la fuga no era la que se cree.
#:
#: `whats` son las cadenas EXACTAS y completas, no fragmentos: se selecciona por
#: igualdad, nunca por `contains`. Ver el punto 2 de la cabecera.
FIXTURES_RETIRADAS = (
    {
        "id": "sprite-forge-a31a6f4",
        "prompt": "un herrero",
        "whats": ("hero: un herrero", "skin walk: un herrero", "skin run: un herrero"),
        "commit": "a31a6f4",
        "desde": "2026-08-24",
        "hasta": "2026-08-31",
        # Procedencia, verificada en el repo y no por parecido de nombres:
        # `git show a31a6f4:ai_server/tests/test_sprite_forge_adapter.py` trae
        # en su `_pedir()` el cuerpo {"model": "y_bot", "anim": "walk",
        # "angle": "frontal_8", "prompt": "un herrero"} contra
        # POST /skin_sprite_sheet — el mismo endpoint que llama a SPEND.add —,
        # y un `self._pedir(anim="run")` que explica la tercera forma. La
        # fixture de aquella versión declaraba cost_usd 0.24 para /identity y
        # 0.96 para /skins, que son EXACTAMENTE los dos únicos importes de este
        # lote en el ledger: es una huella numérica, no un parecido de texto.
        "procedencia": "a31a6f4 (2026-08-24) — test_sprite_forge_adapter._pedir(prompt='un herrero')",
    },
)


def _prompts_anidados(nodo) -> list[str]:
    """Todo `skin.prompt` que haya dentro de una fixture, a cualquier nivel."""
    fuera: list[str] = []
    if isinstance(nodo, dict):
        skin = nodo.get("skin")
        if isinstance(skin, dict) and isinstance(skin.get("prompt"), str) and skin["prompt"]:
            fuera.append(skin["prompt"])
        for v in nodo.values():
            fuera += _prompts_anidados(v)
    elif isinstance(nodo, list):
        for v in nodo:
            fuera += _prompts_anidados(v)
    return fuera


def prompts_de_test(fixtures: Path = FIXTURES) -> list[str]:
    """Los prompts con los que la suite pide arte, leídos de las fixtures.

    Fail-loud si no hay ninguno: sin criterio no se selecciona nada, y un
    criterio vacío que "no encuentra nada" se confundiría con un ledger limpio.
    """
    if not fixtures.is_dir():
        raise RuntimeError(f"no están las fixtures canónicas en {fixtures}: sin ellas no hay criterio")
    encontrados: set[str] = set()
    for f in sorted(fixtures.glob("*.json")):
        encontrados.update(_prompts_anidados(json.loads(f.read_text(encoding="utf-8"))))
    if not encontrados:
        raise RuntimeError(f"ninguna fixture de {fixtures} declara un skin.prompt: no hay criterio que aplicar")
    cortos = [p for p in encontrados if len(p) < MINIMO_DISCRIMINANTE]
    if cortos:
        raise RuntimeError(
            f"prompt de fixture demasiado genérico para usarlo de criterio: {cortos!r}. "
            "Seleccionaría gasto real; no se toca el ledger."
        )
    return sorted(encontrados)


def leer(ledger: Path) -> tuple[str, list[tuple[str, dict]]]:
    """El texto crudo del ledger y sus pares (línea, evento).

    Se devuelve el crudo porque es la HUELLA contra la que se comprueba, antes
    de reescribir, que nadie ha escrito mientras mirábamos. La línea cruda es
    además lo que se mueve: se archiva el byte que se escribió, no una
    reserialización que podría cambiar el orden de las claves.
    """
    if not ledger.is_file():
        return "", []
    crudo = ledger.read_text(encoding="utf-8")
    pares = []
    for n, linea in enumerate(crudo.splitlines(), 1):
        if not linea.strip():
            continue
        try:
            pares.append((linea, json.loads(linea)))
        except ValueError as e:
            # Fail-loud: una línea corrupta aquí es un bug de escritura, y
            # tragársela sería reescribir el ledger perdiéndola.
            raise RuntimeError(f"{ledger}:{n} no es JSON ({e}); no se toca nada") from e
    return crudo, pares


def whats_retirados(lotes=FIXTURES_RETIRADAS) -> set[str]:
    """Las cadenas `what` COMPLETAS de las fixtures retiradas. Se comparan por
    igualdad, así que aquí no hay riesgo de barrer de más: o el evento se llama
    exactamente así, o no es de este lote."""
    fuera: set[str] = set()
    for lote in lotes:
        fuera.update(lote["whats"])
    return fuera


def es_de_test(evento: dict, prompts: list[str], retirados: set[str] | None = None) -> bool:
    what = evento.get("what")
    if not isinstance(what, str):
        return False
    # Fixture retirada: igualdad EXACTA del `what` entero.
    if what in (retirados if retirados is not None else whats_retirados()):
        return True
    # Fixture viva: el prompt es largo y descriptivo, así que `contains` basta
    # y además sobrevive al recorte de `what[:120]`.
    return any(p in what for p in prompts)


def comprobar_ventanas(pares, lotes=FIXTURES_RETIRADAS) -> None:
    """Cada lote retirado declara la ventana de fechas en la que se produjo. Si
    aparece un evento suyo FUERA de ella, este guion para.

    No es burocracia: la ventana es la mitad comprobable de la procedencia. Un
    evento con ese `what` en otra fecha significaría que la fuga no fue la que
    dice el commit declarado, y entonces el criterio no está justificado.
    """
    for lote in lotes:
        suyos = [e for _, e in pares if e.get("what") in lote["whats"]]
        fuera = sorted({_fecha(e) for e in suyos if not (lote["desde"] <= _fecha(e) <= lote["hasta"])})
        if fuera:
            raise RuntimeError(
                f"el lote {lote['id']} declara {lote['desde']}→{lote['hasta']} pero hay eventos suyos "
                f"en {', '.join(fuera)}. La procedencia ({lote['procedencia']}) no explicaría esos: "
                "no se toca el ledger."
            )


def _usd(pares) -> float:
    return round(sum(float(e["usd"]) for _, e in pares), 2)


def _fecha(e: dict) -> str:
    return datetime.fromtimestamp(float(e["t"])).strftime("%Y-%m-%d")


def tabla(elegidos, resto) -> str:
    out = []
    if elegidos:
        out.append(f"{'eventos':>8}  {'$':>8}  concepto")
        for what, n in Counter(e["what"] for _, e in elegidos).most_common():
            usd = round(sum(float(e["usd"]) for _, e in elegidos if e["what"] == what), 2)
            out.append(f"{n:>8}  {usd:>8.2f}  {what[:60]}")
        dias = Counter(_fecha(e) for _, e in elegidos)
        out.append(f"{'':>8}  {'':>8}  por día: " + ", ".join(f"{d} × {n}" for d, n in sorted(dias.items())))
    out.append(f"\nA ARCHIVAR: {len(elegidos)} eventos · ${_usd(elegidos):.2f}")
    out.append(f"SE QUEDAN:  {len(resto)} eventos · ${_usd(resto):.2f}")
    if resto:
        out.append("\nLo que se queda, por concepto (top 10) — para que se vea qué NO entra en el criterio:")
        for what, n in Counter(e["what"] for _, e in resto).most_common(10):
            usd = round(sum(float(e["usd"]) for _, e in resto if e["what"] == what), 2)
            out.append(f"{n:>8}  {usd:>8.2f}  {what[:60]}")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ledger", type=Path, default=LEDGER_POR_DEFECTO,
                    help="ledger de gasto (por defecto el de este checkout)")
    ap.add_argument("--archivo", type=Path, default=ARCHIVO_POR_DEFECTO,
                    help="dónde se archiva (por defecto archivo/cache/spend/)")
    ap.add_argument("--fecha", default=date.today().isoformat(),
                    help="fecha del fichero de archivo (por defecto, hoy)")
    ap.add_argument("--destino", type=Path, default=None,
                    help="fichero de archivo concreto (por defecto events-de-test-<fecha>.jsonl). "
                         "Dale uno propio cuando retires un lote distinto el mismo día: mezclarlos "
                         "en un fichero borra la frontera entre dos procedencias")
    ap.add_argument("--ejecutar", action="store_true", help="mover de verdad. Sin esto NO se toca nada")
    args = ap.parse_args(argv)

    prompts = prompts_de_test()
    retirados = whats_retirados()
    crudo, pares = leer(args.ledger)
    comprobar_ventanas(pares)
    elegidos = [p for p in pares if es_de_test(p[1], prompts, retirados)]
    resto = [p for p in pares if not es_de_test(p[1], prompts, retirados)]
    destino = args.destino or (args.archivo / f"events-de-test-{args.fecha}.jsonl")

    print(f"ledger:  {args.ledger}  ({len(pares)} eventos · ${_usd(pares):.2f})")
    print(f"archivo: {destino}")
    print("criterio · fixture VIVA (contiene, DERIVADO de las fixtures canónicas de sprite-forge): "
          + ", ".join(repr(p) for p in prompts))
    for lote in FIXTURES_RETIRADAS:
        print(f"criterio · fixture RETIRADA {lote['id']} (igualdad exacta, {lote['desde']}→{lote['hasta']}, "
              f"procedencia {lote['procedencia']}):")
        for w in lote["whats"]:
            print(f"             {w!r}")
    print()
    print(tabla(elegidos, resto))

    if not elegidos:
        print("\nNada que archivar: en el ledger no queda gasto con ninguno de los criterios.")
        return 0
    if not args.ejecutar:
        print("\nDRY-RUN: no se ha movido nada. Repite con --ejecutar cuando hayas leído la tabla.")
        return 0

    # El ledger es append-only desde 3 procesos: si alguien escribió mientras
    # mirábamos, reescribirlo con "el resto" que leímos se comería su evento.
    if args.ledger.read_text(encoding="utf-8") != crudo:
        print("\nERROR: el ledger ha cambiado mientras se leía (¿remote-gen escribiendo?). "
              "Para los servicios y repite. No se ha tocado nada.", file=sys.stderr)
        return 1

    # 1 · Primero el archivo, y se relee para comprobar que está entero.
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(destino, "a", encoding="utf-8") as f:
        for linea, _ in elegidos:
            f.write(linea + "\n")
    archivadas = set(destino.read_text(encoding="utf-8").splitlines())
    faltan = [linea for linea, _ in elegidos if linea not in archivadas]
    if faltan:
        print(f"\nERROR: {len(faltan)} líneas no llegaron al archivo. El ledger NO se toca.", file=sys.stderr)
        return 1

    # 2 · Y solo entonces el ledger, por temporal + replace (atómico).
    tmp = args.ledger.with_suffix(args.ledger.suffix + ".tmp")
    tmp.write_text("".join(linea + "\n" for linea, _ in resto), encoding="utf-8")
    os.replace(tmp, args.ledger)

    print(f"\nArchivados {len(elegidos)} eventos (${_usd(elegidos):.2f}) en {destino}.")
    print(f"El ledger queda en {len(resto)} eventos · ${_usd(resto):.2f} de gasto real.")
    print("Nada borrado: cada línea archivada conserva su t, su usd y su what.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
