"""Tool definitions and validation for Claude API narrative engine.

Los PROMPTS canónicos viven en nefan-core/data/contract/prompts/*.md,
compartidos con narrative-mcp (que los sirve tal cual al motor MCP). Este
módulo solo COMPONE los system prompts del fallback por API directa a partir
de esos archivos — editar el texto allí, nunca aquí. Fail-loud si faltan.
"""

import json
import os
import re
from pathlib import Path


_PROMPTS_DIR = Path(
    os.environ.get(
        "NEFAN_CONTRACT_PROMPTS",
        Path(__file__).resolve().parent.parent / "nefan-core" / "data" / "contract" / "prompts",
    )
)


def _prompt(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8")


_TOOLS_DIR = _PROMPTS_DIR.parent / "tools"


def _tool(name: str) -> dict:
    with open(_TOOLS_DIR / name, encoding="utf-8") as f:
        return json.load(f)


GENERATE_SCENE_PROMPT_WORLD_RULES = _prompt("world_rules.md")

GENERATE_SCENE_SYSTEM_PROMPT = (
    """You are the world builder of Never Ending Fantasy, a generative open-world RPG whose world identity comes from the request context (see WORLD & ENGINE RULES below). You produce TOP-DOWN 2D MAPS as a structured grid plus a list of named entities. The game engine takes your output and renders it; the narrative engine reads it to reason about where things are."""
    + "\n\n"
    + _prompt("scene_instructions.md")
    + "\n\n"
    + GENERATE_SCENE_PROMPT_WORLD_RULES
)

GENERATE_SCENE_TOOL = _tool("generate_scene.json")


RESERVED_TERRAIN = {
    "g": "grass", "w": "water", "_": "path", "s": "stone",
    "b": "bridge", "d": "dirt", "a": "sand", "o": "wood",
    "W": "muro",
}

VALID_ENTITY_KINDS = {"building", "prop", "item", "tree", "npc", "player", "decor"}

# Tipos de rasgo de suelo del plan de tile (`ground`). Espejo de
# GroundFeatureSchema en nefan-core/src/scene/blueprint/ground.ts.
# "hill" = relieve suave declarable (h en metros, ±6, sin colisión).
GROUND_KINDS = {"path", "area", "water", "deck", "hill"}
HILL_MAX_H_M = 6
GROUND_MATERIALS = {"dirt", "cobble", "stone", "sand", "wood", "gravel", "grass"}
MAX_GROUND_FEATURES = 64

# Tipos de volumen del plan de tile. Espejo de VolumeSchema en
# nefan-core/src/scene/blueprint/volumes.ts (zod es la fuente de verdad; aquí
# validamos shape suficiente para no persistir basura — el bridge re-valida).
VOLUME_TYPES = {"building", "wall", "tower", "gate", "tree", "bush", "rock", "fountain", "prop", "prism", "custom"}
MAX_VOLUMES = 160


TILE_CELLS = 128
# Márgenes de celda fuera del tile que admite cada schema (espejo de los
# `cell` de volumes.ts (−8..136) y ground.ts (−16..144)).
VOLUME_CELL_MARGIN = 8
GROUND_CELL_MARGIN = 16


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _num_in(v, lo, hi) -> bool:
    return _num(v) and lo <= v <= hi


def _cell_pair(v, margin: int = VOLUME_CELL_MARGIN) -> bool:
    return (
        isinstance(v, list)
        and len(v) == 2
        and all(_num_in(n, -margin, TILE_CELLS + margin) for n in v)
    )


def _drop_field(v: dict, key: str, ctx: str, why: str) -> None:
    """Campo OPCIONAL fuera de contrato: se descarta el campo con traza (el
    default del builder lo cubre) en vez de tirar el item entero."""
    print(f"validate_scene: {ctx} {key} {why} — campo descartado", flush=True)
    v.pop(key, None)


def _vol_rect(r) -> bool:
    """[col, row, ancho, fondo] de volumen (espejo del `rect` de volumes.ts:
    esquina 0..128, tamaños positivos ≤128)."""
    return (
        isinstance(r, list) and len(r) == 4
        and all(_num_in(n, 0, TILE_CELLS) for n in r[:2])
        and all(_num(n) and 0 < n <= TILE_CELLS for n in r[2:])
    )


def _doors_ok(doors) -> bool:
    """Puertas de building (espejo de volumes.ts: ≤8, edge n|s|e|w,
    at 0..128, w opcional 0<..16)."""
    if not isinstance(doors, list) or len(doors) > 8:
        return False
    for d in doors:
        if not isinstance(d, dict):
            return False
        if d.get("edge") not in ("n", "s", "e", "w"):
            return False
        if not _num_in(d.get("at"), 0, TILE_CELLS):
            return False
        w = d.get("w")
        if w is not None and not (_num(w) and 0 < w <= 16):
            return False
    return True


def _has_one_shape(f: dict) -> bool:
    """Exactamente una de rect | polygon | ellipse, bien formada y en rango
    (espejo de shapeFields en ground.ts: celdas ±16, tamaños ≤160, radios ≤96,
    polygon ≤32 puntos)."""
    m = GROUND_CELL_MARGIN
    shapes = 0
    r = f.get("rect")
    if r is not None:
        if not (
            isinstance(r, list) and len(r) == 4
            and all(_num_in(n, -m, TILE_CELLS + m) for n in r[:2])
            and all(_num(n) and 0 < n <= TILE_CELLS + 32 for n in r[2:])
        ):
            return False
        shapes += 1
    poly = f.get("polygon")
    if poly is not None:
        if not (
            isinstance(poly, list) and 3 <= len(poly) <= 32
            and all(_cell_pair(p, m) for p in poly)
        ):
            return False
        shapes += 1
    ell = f.get("ellipse")
    if ell is not None:
        if not (
            isinstance(ell, dict)
            and _cell_pair(ell.get("center"), m)
            and _num(ell.get("rx")) and 0 < ell["rx"] <= 96
            and _num(ell.get("ry")) and 0 < ell["ry"] <= 96
        ):
            return False
        shapes += 1
    return shapes == 1


def validate_ground(raw, *, field: str = "ground"):
    """Valida el array `ground` del plan (rasgos de suelo declarativos:
    path/area/water/deck/hill). Devuelve la lista LIMPIA — los rasgos inválidos se
    descartan UNO A UNO con traza (un área rota no puede borrar las calles y
    el RÍO enteros: sin el agua, la colisión desaparece). None solo si el
    campo entero es inutilizable (no-lista). Espejo laxo de parseGround
    (nefan-core/src/scene/blueprint/ground.ts); el rechazo duro por-array lo
    hace el preflight zod del MCP."""
    if not isinstance(raw, list):
        print(f"validate_scene: {field} descartado (no es lista)")
        return None
    if len(raw) > MAX_GROUND_FEATURES:
        print(f"validate_scene: {field} truncado ({len(raw)} > {MAX_GROUND_FEATURES})")
        raw = raw[:MAX_GROUND_FEATURES]
    clean = []
    seen_ids = set()
    for i, f in enumerate(raw):
        ctx = f"{field}[{i}]"
        if not isinstance(f, dict):
            print(f"validate_scene: {ctx} no es objeto — rasgo descartado")
            continue
        fid = f.get("id")
        kind = f.get("kind")
        if not isinstance(fid, str) or not fid or len(fid) > 64 or fid in seen_ids:
            print(f"validate_scene: {ctx} id inválido/duplicado — rasgo descartado")
            continue
        if kind not in GROUND_KINDS:
            print(f"validate_scene: {ctx} kind desconocido {kind!r} — rasgo descartado")
            continue
        if kind == "path":
            pts = f.get("points")
            if not (
                isinstance(pts, list) and 2 <= len(pts) <= 16
                and all(_cell_pair(p, GROUND_CELL_MARGIN) for p in pts)
            ):
                print(f"validate_scene: {ctx} path sin points válidos (2..16, en rango) — rasgo descartado")
                continue
            w = f.get("w")
            if w is not None and not (_num(w) and 0 < w <= 24):
                _drop_field(f, "w", ctx, f"fuera de rango {w!r} (0..24)")
        elif not _has_one_shape(f):
            print(f"validate_scene: {ctx} necesita exactamente una de rect|polygon|ellipse — rasgo descartado")
            continue
        if kind == "hill":
            h = f.get("h")
            if not (_num(h) and h != 0 and -HILL_MAX_H_M <= h <= HILL_MAX_H_M):
                print(f"validate_scene: {ctx} hill sin h válida (metros, ±{HILL_MAX_H_M}, ≠0) — rasgo descartado")
                continue
        mat = f.get("material")
        if mat is not None and mat not in GROUND_MATERIALS:
            print(f"validate_scene: {ctx} material desconocido {mat!r} — rasgo descartado")
            continue
        if kind == "area" and mat is None:
            # El zod del cliente exige material en area — sin él, el array
            # entero moriría en el cliente.
            print(f"validate_scene: {ctx} area sin material — rasgo descartado")
            continue
        seen_ids.add(fid)
        clean.append(f)
    if len(clean) < len(raw):
        print(
            f"validate_scene: {field}: {len(raw) - len(clean)} rasgos inválidos "
            f"descartados, {len(clean)} conservados"
        )
    return clean


_SURFACE_DESC_FACES = ("n", "s", "e", "w", "side", "roof", "door", "caps", "top")


def _surface_desc_ok(sd, vtype) -> bool:
    """Espejo laxo del union surfaceDesc de volumes.ts (string | por cara)."""
    if vtype not in ("building", "wall", "prop", "prism"):
        return False
    if isinstance(sd, str):
        return 1 <= len(sd) <= 200
    if isinstance(sd, dict) and sd:
        return all(
            k in _SURFACE_DESC_FACES and isinstance(txt, str) and 1 <= len(txt) <= 200
            for k, txt in sd.items()
        )
    return False


def _surface_ref_ok(sr, vtype) -> bool:
    """Espejo laxo del union surfaceRef de volumes.ts (string | por cara):
    id de una ref temática fps/ del pack (world.style_refs.fps_faces)."""
    if vtype not in ("building", "wall", "prop", "prism"):
        return False
    if isinstance(sr, str):
        return 1 <= len(sr) <= 64
    if isinstance(sr, dict) and sr:
        return all(
            k in _SURFACE_DESC_FACES and isinstance(r, str) and 1 <= len(r) <= 64
            for k, r in sr.items()
        )
    return False


def validate_volumes(raw, *, field: str = "volumes"):
    """Valida el array `volumes` del plan. Devuelve la lista LIMPIA — los
    items inválidos se descartan UNO A UNO con traza: un solo prop malformado
    NO puede tirar el pueblo entero (2026-08-11: un prop sin shape descartaba
    el campo completo y el tile salía sin un solo edificio, en silencio).
    None solo si el campo entero es inutilizable (no-lista). Espejo laxo de
    parseVolumes: el rechazo duro por-array lo hace el zod del bridge."""
    if not isinstance(raw, list):
        print(f"validate_scene: {field} descartado (no es lista)")
        return None
    if len(raw) > MAX_VOLUMES:
        print(f"validate_scene: {field} truncado ({len(raw)} > {MAX_VOLUMES})")
        raw = raw[:MAX_VOLUMES]
    clean = []
    seen_ids = set()
    for i, v in enumerate(raw):
        ctx = f"{field}[{i}]"
        if not isinstance(v, dict):
            print(f"validate_scene: {ctx} no es objeto — volumen descartado")
            continue
        vid = v.get("id")
        label = v.get("label")
        vtype = v.get("type")
        if not isinstance(vid, str) or not vid or len(vid) > 64 or vid in seen_ids:
            print(f"validate_scene: {ctx} id inválido/duplicado — volumen descartado")
            continue
        if not isinstance(label, str) or not label or len(label) > 48:
            print(f"validate_scene: {ctx} label inválido — volumen descartado")
            continue
        if vtype not in VOLUME_TYPES:
            print(f"validate_scene: {ctx} type desconocido {vtype!r} — volumen descartado")
            continue
        # surface_desc (vista fps): solo building|wall|prop|prism. String
        # 1..200 u objeto por cara/rol {n|s|e|w|side|roof|door|caps|top:
        # string 1..200, ≥1 clave} — espejo de surfaceDescFaces (volumes.ts).
        # El zod strict del bridge rechazaría el campo en otros tipos — aquí se
        # descarta con traza (espejo laxo, mismo criterio que el resto).
        sd = v.get("surface_desc")
        if sd is not None and not _surface_desc_ok(sd, vtype):
            _drop_field(
                v, "surface_desc", ctx,
                "inválida (string 1..200 u objeto por cara n|s|e|w|side|roof|door|caps|top; "
                "solo building|wall|prop|prism)",
            )
        # surface_ref: acompaña a surface_desc (id de ref temática fps/ del
        # pack). Espejo laxo: forma + presencia de surface_desc; el rechazo
        # duro (id contra catálogo, clave sin cara descrita) lo hacen el
        # pre-flight MCP y el zod del bridge.
        sr = v.get("surface_ref")
        if sr is not None and (
            not _surface_ref_ok(sr, vtype) or v.get("surface_desc") is None
        ):
            _drop_field(
                v, "surface_ref", ctx,
                "inválida (string 1..64 u objeto por cara; requiere surface_desc; "
                "solo building|wall|prop|prism)",
            )
        if vtype == "building":
            if not _vol_rect(v.get("rect")):
                print(f"validate_scene: {ctx} building sin rect válido (en rango) — volumen descartado")
                continue
            if v.get("cutaway") is True and "angle" in v:
                print(f"validate_scene: {ctx} building cutaway no admite angle — campo angle descartado")
                v.pop("angle", None)
            wall_h = v.get("wall_h")
            if wall_h is not None and not (_num(wall_h) and 0 < wall_h <= 24):
                _drop_field(v, "wall_h", ctx, f"fuera de rango {wall_h!r} (0..24)")
            doors = v.get("doors")
            if doors is not None and not _doors_ok(doors):
                _drop_field(v, "doors", ctx, "malformadas (≤8, edge n|s|e|w, at 0..128, w 0..16)")
        elif vtype == "wall":
            pts = v.get("points")
            if not (isinstance(pts, list) and 2 <= len(pts) <= 24 and all(_cell_pair(pp) for pp in pts)):
                print(f"validate_scene: {ctx} wall sin points válidos (2..24, en rango) — volumen descartado")
                continue
            width = v.get("width")
            if width is not None and not (_num(width) and 0 < width <= 12):
                _drop_field(v, "width", ctx, f"fuera de rango {width!r} (0..12)")
            h = v.get("h")
            if h is not None and not (_num(h) and 0 < h <= 24):
                _drop_field(v, "h", ctx, f"fuera de rango {h!r} (0..24)")
        elif vtype == "gate":
            if not _cell_pair(v.get("at")) or v.get("orient") not in ("x", "y"):
                print(f"validate_scene: {ctx} gate sin at/orient válidos — volumen descartado")
                continue
            for key, top in (("w", 24), ("h", 24)):
                val = v.get(key)
                if val is not None and not (_num(val) and 0 < val <= top):
                    _drop_field(v, key, ctx, f"fuera de rango {val!r} (0..{top})")
        elif vtype == "prop":
            has_at = _cell_pair(v.get("at"))
            has_rect = _vol_rect(v.get("rect"))
            if has_at == has_rect or v.get("shape") not in ("box", "cylinder"):
                print(f"validate_scene: {ctx} prop necesita shape y uno de at|rect (en rango) — volumen descartado")
                continue
            if has_at and "angle" in v:
                print(f"validate_scene: {ctx} prop con at no admite angle — campo angle descartado")
                v.pop("angle", None)
            h = v.get("h")
            if h is not None and not (_num(h) and 0 < h <= 16):
                _drop_field(v, "h", ctx, f"fuera de rango {h!r} (0..16)")
        elif vtype == "custom":
            # Composición 3D libre: at + parts (1..24 piezas con shape del
            # enum). El detalle fino (dims por shape, rangos) lo rechaza el
            # zod del bridge — aquí la forma gruesa (espejo laxo).
            if not _cell_pair(v.get("at")):
                print(f"validate_scene: {ctx} custom sin at válido — volumen descartado")
                continue
            parts = v.get("parts")
            if not (
                isinstance(parts, list) and 1 <= len(parts) <= 24
                and all(
                    isinstance(p, dict)
                    and p.get("shape") in ("box", "cylinder", "cone", "sphere", "gable")
                    for p in parts
                )
            ):
                print(f"validate_scene: {ctx} custom sin parts válidas (1..24, shape del enum) — volumen descartado")
                continue
        elif vtype == "prism":
            pts = v.get("points")
            if not (isinstance(pts, list) and 3 <= len(pts) <= 24 and all(_cell_pair(pp) for pp in pts)):
                print(f"validate_scene: {ctx} prism sin points válidos (3..24, en rango) — volumen descartado")
                continue
            if not (_num(v.get("h")) and 0 < v["h"] <= 24):
                print(f"validate_scene: {ctx} prism sin h válida (0..24) — volumen descartado")
                continue
        else:  # tower/tree/bush/rock/fountain
            if not _cell_pair(v.get("at")):
                print(f"validate_scene: {ctx} {vtype} sin at válido — volumen descartado")
                continue
            # Campos opcionales de tamaño, por tipo (espejo de volumes.ts).
            # Tree: el TOPE del schema es 2.5 — parseVolumes CLAMPA a 1.8 en
            # consumo; aquí NO se clampa (el harness exige fixture intacta).
            _RANGES = {
                "tower": (("r", 0, 16), ("h", 0, 32)),
                "tree": (("s", 0.4, 2.5),),
                "bush": (("s", 0.4, 2.5),),
                "rock": (("s", 0.4, 4),),
                "fountain": (("r", 0, 12),),
            }
            for key, lo, hi in _RANGES[vtype]:
                val = v.get(key)
                if val is None:
                    continue
                ok = _num(val) and (lo < val <= hi if lo == 0 else lo <= val <= hi)
                if not ok:
                    _drop_field(v, key, ctx, f"fuera de rango {val!r} ({lo}..{hi})")
        # `angle` (building/prop, GRADOS): un valor sin sentido se descarta
        # del item con traza (zod hace el rechazo duro).
        if "angle" in v and vtype in ("building", "prop", "custom"):
            a = v.get("angle")
            if not _num(a) or not -180 <= a <= 180:
                print(f"validate_scene: {ctx} angle inválido {a!r} — campo descartado")
                v.pop("angle", None)
        seen_ids.add(vid)
        clean.append(v)
    if len(clean) < len(raw):
        print(
            f"validate_scene: {field}: {len(raw) - len(clean)} volúmenes inválidos "
            f"descartados, {len(clean)} conservados"
        )
    return clean


def validate_scene_response(data: dict) -> dict:
    """Valida y normaliza una escena Map Format D del LLM.

    FAIL-LOUD en la FORMA (espejo de FormatDSceneSchema, el gate del pre-flight
    MCP): un error estructural que el modelo DEBE corregir (grid que no cuadra
    con size, entity con kind fuera del enum o sin glyph/cell/footprint, tile
    sin biome) LANZA `ValueError` con el motivo — antes se rellenaba/clampaba en
    silencio y el mapa salía deformado sin que el modelo se enterara.

    Se CONSERVAN las normalizaciones BENIGNAS que el gate del modelo tolera y
    que por tanto no pueden rechazar tras el pre-flight: defaults de
    scene_id/description, clamp de cell/footprint al grid, glifo de reserva ante
    colisión con el terreno, enriquecimiento de la leyenda y descarte de campos
    legacy/retirados.
    """
    import uuid as _uuid

    # ── Identity & description ───────────────────────────────────────────
    scene_id = (
        data.get("scene_id")
        or data.get("room_id")  # legacy alias
        or f"scene_{_uuid.uuid4().hex[:8]}"
    )
    data["scene_id"] = scene_id
    # Keep `room_id` as alias so older clients keep working.
    data["room_id"] = scene_id
    # style_ref: id de la ref de estilo del pack elegida para el repintado
    # IA (id LIBRE del manifest — el catálogo lo conoce narrative-mcp, que
    # hace el pre-flight fail-loud; aquí solo se exige forma de slug). Un
    # valor malformado se descarta con aviso (mejor sin ref que un 422 en
    # /generate_scene_image cuando el cliente lo reenvíe). `style_tag` es el
    # nombre legacy en escenas persistidas — misma regla en lectura.
    for field in ("style_ref", "style_tag"):
        if data.get(field) and not re.fullmatch(r"[A-Za-z0-9_.-]+", str(data[field])):
            print(f"validate_scene: {field} malformado '{data[field]}' — descartado", flush=True)
            data.pop(field, None)
    data["scene_description"] = (
        data.get("scene_description") or data.get("room_description") or "Un paraje desolado."
    )
    data["room_description"] = data["scene_description"]
    data["ambient_event"] = data.get("ambient_event") or ""

    # ── Tile (Format D v3, plano continuo) ───────────────────────────────
    # Un tile no lleva size/terrain (la base es biome + primitivas, expandida
    # en nefan-core). Aquí solo saneado superficial; el bridge fija las coords
    # y valida jugabilidad/costuras server-side.
    raw_tile = data.get("tile")
    is_tile = (
        isinstance(raw_tile, dict)
        and isinstance(raw_tile.get("tx"), int)
        and isinstance(raw_tile.get("ty"), int)
    )
    if is_tile:
        tx, ty = raw_tile["tx"], raw_tile["ty"]
        data["tile"] = {"tx": tx, "ty": ty}
        data["scene_id"] = f"tile_{tx}_{ty}"
        data["room_id"] = data["scene_id"]
        data.pop("size", None)
        data.pop("terrain", None)
        cols, rows = 128, 128
        if not isinstance(data.get("biome"), str) or not data["biome"]:
            # Fail-loud (espejo de FormatDSceneSchema, variante tile): el bioma
            # es la base del tile, no un default silencioso.
            raise ValueError(
                "un tile necesita `biome` (grass|forest_floor|meadow|sand|dirt|stone|snow|swamp)"
            )
        patches = data.get("terrain_patches")
        if isinstance(patches, list):
            clean_p = []
            for i, tp in enumerate(patches[:24]):
                if (
                    isinstance(tp, dict)
                    and isinstance(tp.get("at"), list) and len(tp["at"]) == 2
                    and all(isinstance(v, int) for v in tp["at"])
                    and isinstance(tp.get("rows"), list) and tp["rows"]
                    and all(isinstance(r, str) and r for r in tp["rows"])
                ):
                    clean_p.append({"at": tp["at"], "rows": tp["rows"]})
                else:
                    print(f"validate_scene_response: terrain_patches[{i}] malformado, descartado", flush=True)
            data["terrain_patches"] = clean_p
        else:
            data.pop("terrain_patches", None)
        anchors = data.get("place_anchors")
        if isinstance(anchors, list):
            clean_a = []
            for i, a in enumerate(anchors[:8]):
                if isinstance(a, dict) and isinstance(a.get("place_id"), str) and a["place_id"]:
                    entry = {"place_id": a["place_id"]}
                    rect = a.get("rect")
                    if isinstance(rect, list) and len(rect) == 4 and all(isinstance(v, int) for v in rect):
                        entry["rect"] = rect
                    clean_a.append(entry)
                else:
                    print(f"validate_scene_response: place_anchors[{i}] malformado, descartado", flush=True)
            data["place_anchors"] = clean_a
        else:
            data.pop("place_anchors", None)

    # ── Candado de las variantes retiradas (espejo de FormatDSceneSchema) ─
    # Format D tiene UNA forma: el tile del mundo continuo. La "suelta"
    # (size/terrain a elección del motor, sin sitio en el plano) se retiró con
    # el issue #172 y el `stage` proscenio con la vista que lo pintaba. El
    # mensaje nombra la alternativa para que el modelo pueda re-responder.
    if not is_tile:
        raise ValueError(
            "una escena necesita `tile` {tx,ty}: es la única variante de Format D "
            "(mundo continuo, pídela con generate_tile)"
        )
    if data.pop("stage", None) is not None:
        print("validate_scene_response: stage descartado (el plató proscenio se retiró)", flush=True)

    # ── Terrain legend ───────────────────────────────────────────────────
    # Los valores pueden ser string (legacy) u objeto {name, solid} — la forma
    # objeto declara colisión por char y debe sobrevivir el saneado (la resuelve
    # formatDToWorld en nefan-core). Un valor de otro tipo se descarta.
    raw_legend = data.get("terrain_legend")
    legend: dict = {}
    if isinstance(raw_legend, dict):
        for ch, val in raw_legend.items():
            if isinstance(val, str):
                legend[ch] = val
            elif isinstance(val, dict) and isinstance(val.get("name"), str):
                entry = {"name": val["name"]}
                if isinstance(val.get("solid"), bool):
                    entry["solid"] = val["solid"]
                legend[ch] = entry
    # El tile no trae grid que escanear: su leyenda es la declarada más las
    # reservadas (el engine sintetiza el terreno desde bioma + primitivas).
    # Merge reserved (the legend takes precedence if LLM redefined a char).
    for ch, name in RESERVED_TERRAIN.items():
        legend.setdefault(ch, name)
    data["terrain_legend"] = legend

    # ── Map plan (ground + volumes) ──────────────────────────────────────
    # Espejo de parseGround/parseVolumes en nefan-core: mismo criterio en
    # ambos lados o un plan aceptado aquí lo rechazaría el bridge al
    # persistir el retoque. Los formatos SVG antiguos (map_svg, map_ground,
    # terrain_svg) ya no se aceptan: descartar en silencio con traza — nunca
    # 422 (los saves viejos deben resumir sin error).
    for legacy in ("map_svg", "map_ground", "terrain_svg"):
        if legacy in data:
            print(f"validate_scene: {legacy} SVG legacy descartado (usa ground + volumes)")
            data.pop(legacy, None)
    if "ground" in data:
        feats = validate_ground(data.get("ground"))
        if feats is not None:
            data["ground"] = feats
        else:
            data.pop("ground", None)
    if "volumes" in data:
        vols = validate_volumes(data.get("volumes"))
        if vols is not None:
            data["volumes"] = vols
        else:
            data.pop("volumes", None)

    # ── Scatter declarativo (vista fps) ──────────────────────────────────
    # Espejo LAXO de parseScatter (nefan-core/src/scene/blueprint/scatter.ts,
    # la fuente de verdad con la gramática completa fail-loud): aquí solo la
    # forma gruesa — mal formado se descarta ENTERO con traza (generators y
    # zones van juntos: zonas sin generador no sirven).
    if "scatter_generators" in data or "scatter_zones" in data:
        gens = data.get("scatter_generators")
        zones = data.get("scatter_zones")
        ok = (
            isinstance(gens, dict) and 0 < len(gens) <= 8
            and all(
                isinstance(g, dict) and isinstance(g.get("parts"), list) and 0 < len(g["parts"]) <= 10
                for g in gens.values()
            )
            and isinstance(zones, list) and 0 < len(zones) <= 12
            and all(
                isinstance(z, dict) and z.get("kind") in gens
                and isinstance(z.get("shape"), dict)
                and isinstance(z.get("density"), (int, float)) and 0 <= z["density"] <= 1.5
                for z in zones
            )
        )
        if not ok:
            print("validate_scene: scatter_generators/scatter_zones malformados — descartados")
            data.pop("scatter_generators", None)
            data.pop("scatter_zones", None)

    # ── Entities ─────────────────────────────────────────────────────────
    raw_entities = data.get("entities")
    if not isinstance(raw_entities, list):
        raw_entities = []
    terrain_chars = set(legend.keys())

    seen_ids: set = set()
    cleaned: list = []
    for ent in raw_entities[:80]:
        if not isinstance(ent, dict):
            continue
        eid = ent.get("id") or f"ent_{_uuid.uuid4().hex[:6]}"
        if eid in seen_ids:
            eid = f"{eid}_{_uuid.uuid4().hex[:4]}"
        seen_ids.add(eid)

        # Fail-loud en la FORMA (espejo de EntitySchema): kind del enum, cell
        # par numérico, footprint par de enteros ≥1, glyph de 1 char. Se
        # CONSERVAN las normalizaciones benignas que FormatDScene tolera y que
        # por tanto NO deben rechazar tras el pre-flight: clamp de cell/footprint
        # al grid y glifo de reserva ante colisión con el terreno.
        kind = ent.get("kind")
        if kind not in VALID_ENTITY_KINDS:
            raise ValueError(f"entity '{eid}': kind '{kind}' inválido; permitidos: {sorted(VALID_ENTITY_KINDS)}")

        cell = ent.get("cell")
        if not (
            isinstance(cell, list) and len(cell) == 2
            and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in cell)
        ):
            raise ValueError(f"entity '{eid}': `cell` debe ser [col, row] numérico")
        col = max(0, min(int(cell[0]), cols - 1))
        row = max(0, min(int(cell[1]), rows - 1))

        fp = ent.get("footprint")
        if not (
            isinstance(fp, list) and len(fp) == 2
            and all(isinstance(v, int) and not isinstance(v, bool) and v >= 1 for v in fp)
        ):
            raise ValueError(f"entity '{eid}': `footprint` debe ser [ancho, alto] de enteros ≥1")
        w = max(1, min(int(fp[0]), cols - col))
        h = max(1, min(int(fp[1]), rows - row))

        glyph = ent.get("glyph")
        if not (isinstance(glyph, str) and len(glyph) == 1):
            raise ValueError(f"entity '{eid}': `glyph` debe ser un único carácter")
        if glyph in terrain_chars:
            # Colisión con un char de terreno → glifo de reserva (benigno: el
            # gate del modelo no comprueba unicidad de glyph).
            fallback_pool = "?xyzqXYZQ#&%$*+!"
            glyph = next((c for c in fallback_pool if c not in terrain_chars), "?")

        clean_ent = {
            "id": eid,
            "kind": kind,
            "name": ent.get("name") or eid,
            "cell": [col, row],
            "footprint": [w, h],
            "glyph": glyph,
        }
        if ent.get("shape") in ("box", "cylinder", "sphere", "cone"):
            clean_ent["shape"] = ent["shape"]
        # Altura en METROS (espejo de KIND_DEFAULT_HEIGHT/MAX_ENTITY_HEIGHT_M
        # en scene-normalize.ts) — sin whitelist aquí el campo se perdería.
        if (
            isinstance(ent.get("h"), (int, float))
            and not isinstance(ent.get("h"), bool)
            and 0 < ent["h"] <= 20
        ):
            clean_ent["h"] = float(ent["h"])
        # Ref de estilo del NPC ELEGIDA por el motor: `entities[].style_ref` la
        # declara generate_scene.json y de ella sale la clave de caché del skin
        # (npcSkinStyleRef, src/games/style-categories.ts). Sin whitelist aquí
        # se perdía en silencio y TODO NPC caía al rol por defecto.
        if isinstance(ent.get("style_ref"), str) and ent["style_ref"]:
            clean_ent["style_ref"] = ent["style_ref"]
        if isinstance(ent.get("texture_hash"), str):
            clean_ent["texture_hash"] = ent["texture_hash"]
        if isinstance(ent.get("model_hash"), str):
            clean_ent["model_hash"] = ent["model_hash"]
        # decor puede pedir snap al muro más cercano (lo resuelve el expander TS).
        if ent.get("attach") == "wall":
            clean_ent["attach"] = "wall"
        cleaned.append(clean_ent)
    data["entities"] = cleaned

    # ── Primitivas v2 (structures / vegetation_zones) ────────────────────
    # Passthrough con chequeo de forma superficial: la expansión determinista
    # y la validación semántica (rects dentro del grid, puertas válidas…)
    # viven en nefan-core (scene-expand.ts / scene-validate.ts). Una entrada
    # sin la forma mínima se descarta con traza — nunca tumba la escena.
    raw_structures = data.get("structures")
    if isinstance(raw_structures, list):
        clean_structures = []
        for i, s in enumerate(raw_structures[:16]):
            if (
                isinstance(s, dict)
                and s.get("type") == "room"
                and isinstance(s.get("rect"), list)
                and len(s["rect"]) == 4
                and all(isinstance(v, int) for v in s["rect"])
            ):
                clean_structures.append(s)
            else:
                print(f"validate_scene_response: structures[{i}] malformada, descartada", flush=True)
        data["structures"] = clean_structures
    else:
        data.pop("structures", None)

    raw_veg = data.get("vegetation_zones")
    if isinstance(raw_veg, list):
        clean_veg = []
        for i, z in enumerate(raw_veg[:16]):
            area_ok = z.get("area") == "rest" or (
                isinstance(z.get("area"), list)
                and len(z["area"]) == 4
                and all(isinstance(v, int) for v in z["area"])
            ) if isinstance(z, dict) else False
            if (
                isinstance(z, dict)
                and isinstance(z.get("type"), str)
                and area_ok
                and isinstance(z.get("density"), (int, float))
            ):
                clean_veg.append(z)
            else:
                print(f"validate_scene_response: vegetation_zones[{i}] malformada, descartada", flush=True)
        data["vegetation_zones"] = clean_veg
    else:
        data.pop("vegetation_zones", None)

    # ── Strip legacy fields the new schema doesn't use ───────────────────
    for legacy in ("dimensions", "sky", "fog", "vegetation", "lighting", "exits",
                   "npcs", "objects", "surfaces", "zone_type"):
        data.pop(legacy, None)

    return data


# ----------------------------------------------------------------------
# Weapon orientation (vision-guided)
# ----------------------------------------------------------------------

WEAPON_ORIENT_SYSTEM_PROMPT = _prompt("weapon_orient.md")


WEAPON_ORIENT_TOOL = _tool("weapon_orient.json")


def validate_weapon_orient_response(data: dict) -> dict:
    """Validate and normalize a weapon orientation response from the LLM.

    Fail-loud: raises ValueError with the precise cause if the response is
    malformed beyond repair — the caller logs it, never a silent None (patrón
    validate_narrative_reaction).
    """
    if not isinstance(data, dict):
        raise ValueError(
            f"weapon_orient: payload must be an object, got {type(data).__name__}"
        )

    # Required vector fields
    for field in ("grip_point_normalized", "blade_direction", "up_direction"):
        v = data.get(field)
        if not isinstance(v, list) or len(v) != 3:
            raise ValueError(
                f"weapon_orient: {field} must be a list of 3 numbers, got {v!r}"
            )
        try:
            data[field] = [float(x) for x in v]
        except (TypeError, ValueError):
            raise ValueError(
                f"weapon_orient: {field} contains non-numeric values: {v!r}"
            ) from None

    # Clamp grip point to [0, 1]
    data["grip_point_normalized"] = [
        max(0.0, min(1.0, x)) for x in data["grip_point_normalized"]
    ]

    # Normalize direction vectors
    def _normalize(v: list) -> list | None:
        length = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) ** 0.5
        if length < 1e-6:
            return None
        return [v[0] / length, v[1] / length, v[2] / length]

    blade = _normalize(data["blade_direction"])
    up = _normalize(data["up_direction"])
    if blade is None:
        raise ValueError("weapon_orient: blade_direction has ~zero length")
    if up is None:
        raise ValueError("weapon_orient: up_direction has ~zero length")
    data["blade_direction"] = blade
    data["up_direction"] = up

    # Reject if blade and up are nearly parallel (degenerate frame)
    dot = abs(blade[0] * up[0] + blade[1] * up[1] + blade[2] * up[2])
    if dot > 0.95:
        raise ValueError(
            "weapon_orient: blade_direction and up_direction are nearly "
            f"parallel (|dot|={dot:.3f}) — degenerate orientation frame"
        )

    # Defaults for optional fields
    data.setdefault("weapon_type", "generic")
    data.setdefault("grip_length_normalized", 0.15)
    data.setdefault("notes", "")
    try:
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
    except (TypeError, ValueError):
        data["confidence"] = 0.5

    return data


# ============================================================================
# Narrative event reaction (Phase 3) — Claude reacts to player dialogue choices
# by emitting consequences that the engine applies to the open world.
# ============================================================================

NARRATIVE_REACT_SYSTEM_PROMPT = (
    """You are the narrative engine of a generative open-world RPG. The game's world identity travels in `context.world` (description = world brief, style_token = visual style): every reaction must fit THAT world — its peoples, factions, magic rules and tone. Do not default to generic dark fantasy."""
    + "\n\n"
    + _prompt("narrative_event.md")
    + "\n\n"
    + GENERATE_SCENE_PROMPT_WORLD_RULES
)

NARRATIVE_REACT_TOOL = _tool("narrative_react.json")


def validate_narrative_reaction(data: dict | None) -> dict:
    """Validate a Claude response to react_to_player.

    Strict mode — accepted types are exactly {dialogue, story_update,
    spawn_entity, schedule_event, noop}. Any deviation (aliases like
    show_dialogue, text instead of delta, missing required fields, malformed
    kinds) raises ValueError. The bridge surfaces the error to the client; the
    operator fixes the narrative engine's prompt.
    """
    if not isinstance(data, dict):
        raise ValueError(f"react_to_player payload must be an object, got {type(data).__name__}")
    raw = data.get("consequences")
    if not isinstance(raw, list):
        raise ValueError("react_to_player payload missing list `consequences`")
    if len(raw) > 4:
        raise ValueError(f"react_to_player returned {len(raw)} consequences, max is 4")

    valid_types = {"dialogue", "story_update", "spawn_entity", "schedule_event", "plugin_event", "noop"}
    valid_kinds = {"npc", "building", "object"}
    out: list[dict] = []
    for idx, c in enumerate(raw):
        if not isinstance(c, dict):
            raise ValueError(f"consequence[{idx}] is not an object")
        t = c.get("type")
        if t not in valid_types:
            raise ValueError(
                f"consequence[{idx}].type='{t}' is invalid; allowed: {sorted(valid_types)}"
            )
        if t == "noop":
            continue
        if t == "dialogue":
            speaker = str(c.get("speaker", "")).strip()
            text = str(c.get("text", "")).strip()
            if not speaker:
                raise ValueError(f"dialogue[{idx}] missing required field `speaker`")
            if not text:
                raise ValueError(f"dialogue[{idx}] missing required field `text`")
            entry: dict = {"type": "dialogue", "speaker": speaker, "text": text}
            raw_choices = c.get("choices")
            if raw_choices is not None:
                if not isinstance(raw_choices, list):
                    raise ValueError(f"dialogue[{idx}].choices must be a list")
                # Fail-loud como el zod SoT (choices: string[] no vacías): una
                # choice no-string o vacía es un error de forma que vuelve al
                # modelo, no algo que coercionar/filtrar en silencio.
                if len(raw_choices) > 3:
                    raise ValueError(f"dialogue[{idx}].choices has {len(raw_choices)} entries, max is 3")
                trimmed: list[str] = []
                for x in raw_choices:
                    if not isinstance(x, str) or not x.strip():
                        raise ValueError(f"dialogue[{idx}].choices entries must be non-empty strings")
                    trimmed.append(x.strip())
                if trimmed:
                    entry["choices"] = trimmed
            out.append(entry)
        elif t == "story_update":
            delta_raw = c.get("delta")
            if not isinstance(delta_raw, str) or not delta_raw.strip():
                raise ValueError(
                    f"story_update[{idx}] missing required field `delta` (non-empty string)"
                )
            out.append({"type": "story_update", "delta": delta_raw.strip()})
        elif t == "spawn_entity":
            kind = c.get("entity_kind")
            if kind not in valid_kinds:
                raise ValueError(
                    f"spawn_entity[{idx}].entity_kind='{kind}' invalid; allowed: {sorted(valid_kinds)}"
                )
            description = str(c.get("description", "")).strip()
            if not description:
                raise ValueError(f"spawn_entity[{idx}] missing required field `description`")
            entry = {
                "type": "spawn_entity",
                "entity_kind": kind,
                "description": description,
                "position_hint": str(c.get("position_hint", "near_player")),
            }
            if c.get("name"):
                entry["name"] = str(c["name"])
            if c.get("texture_hash"):
                entry["texture_hash"] = str(c["texture_hash"])
            if c.get("model_hash"):
                entry["model_hash"] = str(c["model_hash"])
            out.append(entry)
        elif t == "schedule_event":
            description = str(c.get("description", "")).strip()
            if not description:
                raise ValueError(f"schedule_event[{idx}] missing required field `description`")
            out.append({
                "type": "schedule_event",
                "description": description,
                "trigger": str(c.get("trigger", "next_scene")),
            })
        elif t == "plugin_event":
            plugin_id = str(c.get("plugin_id", "")).strip()
            event_type = str(c.get("event_type", "")).strip()
            if not plugin_id:
                raise ValueError(f"plugin_event[{idx}] missing required field `plugin_id`")
            if not event_type:
                raise ValueError(f"plugin_event[{idx}] missing required field `event_type`")
            payload = c.get("payload", {})
            if not isinstance(payload, dict):
                raise ValueError(f"plugin_event[{idx}].payload must be an object")
            out.append({
                "type": "plugin_event",
                "plugin_id": plugin_id,
                "event_type": event_type,
                "payload": payload,
            })
    return {"consequences": out}
