"""Tool definitions and validation for Claude API narrative engine.

Los PROMPTS canónicos viven en nefan-core/data/contract/prompts/*.md,
compartidos con narrative-mcp (que los sirve tal cual al motor MCP). Este
módulo solo COMPONE los system prompts del fallback por API directa a partir
de esos archivos — editar el texto allí, nunca aquí. Fail-loud si faltan.
"""

import os
from pathlib import Path

_PROMPTS_DIR = Path(
    os.environ.get(
        "NEFAN_CONTRACT_PROMPTS",
        Path(__file__).resolve().parent.parent / "nefan-core" / "data" / "contract" / "prompts",
    )
)


def _prompt(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8")


GENERATE_SCENE_PROMPT_WORLD_RULES = _prompt("world_rules.md")

GENERATE_SCENE_SYSTEM_PROMPT = (
    """You are the world builder of Never Ending Fantasy, a generative open-world RPG whose world identity comes from the request context (see WORLD & ENGINE RULES below). You produce TOP-DOWN 2D MAPS as a structured grid plus a list of named entities. The game engine takes your output and renders it; the narrative engine reads it to reason about where things are."""
    + "\n\n"
    + _prompt("scene_instructions.md")
    + "\n\n"
    + GENERATE_SCENE_PROMPT_WORLD_RULES
)

GENERATE_SCENE_TOOL = {
    "name": "generate_scene",
    "description": (
        "Generates a top-down 2D map in Map Format D: a terrain grid (ASCII strings) "
        "plus a list of named entities with cell + footprint. The narrative engine reads "
        "it to know what is where; the game engine renders it. See system prompt for the "
        "full schema and a worked example."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "tile": {
                "type": "object",
                "description": "Continuous-plane tile coords (tile responses only).",
                "properties": {"tx": {"type": "integer"}, "ty": {"type": "integer"}},
                "required": ["tx", "ty"],
            },
            "biome": {
                "type": "string",
                "description": "Tile base fill: grass|forest_floor|meadow|sand|dirt|stone|snow|swamp (tiles only).",
            },
            "terrain_patches": {
                "type": "array",
                "description": "Optional ASCII detail stamps over the biome fill (tiles only).",
                "maxItems": 24,
                "items": {
                    "type": "object",
                    "properties": {
                        "at": {"type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2},
                        "rows": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                    },
                    "required": ["at", "rows"],
                },
            },
            "place_anchors": {
                "type": "array",
                "description": "World-map places physically living in this tile (tiles only).",
                "maxItems": 8,
                "items": {
                    "type": "object",
                    "properties": {
                        "place_id": {"type": "string"},
                        "rect": {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4},
                    },
                    "required": ["place_id"],
                },
            },
            "scene_id": {
                "type": "string",
                "description": "Unique slug identifying this map (e.g. 'tavern_clearing', 'robledo_village').",
            },
            "place_id": {
                "type": "string",
                "description": "Optional. The world-map place id this scene realizes; the engine binds the scene to that place.",
            },
            "scene_description": {
                "type": "string",
                "description": "2-3 sentence description of the scene, in Spanish.",
            },
            "size": {
                "type": "object",
                "properties": {
                    "cols": {"type": "integer", "minimum": 12, "maximum": 80},
                    "rows": {"type": "integer", "minimum": 8, "maximum": 60},
                    "meters_per_cell": {"type": "number", "description": "0.5 for interiors (furniture-scale), 2 for outdoor scenes. See system prompt."},
                },
                "required": ["cols", "rows", "meters_per_cell"],
            },
            "terrain": {
                "type": "array",
                "description": (
                    "Exactly `rows` strings, each EXACTLY `cols` characters wide. "
                    "Each char is a terrain glyph (g=grass, w=water, _=path, s=stone, "
                    "b=bridge, d=dirt, a=sand, o=wood, or any char you define in terrain_legend)."
                ),
                "items": {"type": "string"},
            },
            "terrain_legend": {
                "type": "object",
                "description": (
                    "Mapping from terrain char to terrain name. Reserved chars don't need to "
                    "appear here. Add any custom terrain chars you used. A value can also be "
                    '{"name": ..., "solid": true|false} to declare that char blocks movement '
                    "(walls, water). W and w are solid by default; b (bridge) is walkable."
                ),
                "additionalProperties": {
                    "oneOf": [
                        {"type": "string"},
                        {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "solid": {"type": "boolean"},
                            },
                            "required": ["name"],
                        },
                    ]
                },
            },
            "terrain_features": {
                "type": "array",
                "description": (
                    "Optional. Smooth vector shapes painted over the grid: thick polylines "
                    "(meandering river, curving road) or filled polygons (closed=true). "
                    "points are [col,row] cell coords (floats allowed), width in cells. "
                    "Array order = paint order (river first, bridge after)."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "description": (
                                "river|water|path|road|bridge|stone|paved|dirt|sand|wood|grass "
                                "or a free Spanish name resolved by keywords."
                            ),
                        },
                        "points": {
                            "type": "array",
                            "items": {
                                "type": "array",
                                "items": {"type": "number"},
                                "minItems": 2,
                                "maxItems": 2,
                            },
                            "minItems": 2,
                            "description": "[col,row] cell coordinates; floats allowed.",
                        },
                        "width": {"type": "number", "minimum": 0.1, "description": "Stroke width in cells (default 1). Ignored for closed polygons."},
                        "closed": {"type": "boolean", "description": "true = filled polygon (3+ points)."},
                        "color": {"type": "string", "description": "Optional #rrggbb override."},
                        "at_edges": {
                            "type": "array",
                            "description": "Tile seams: exact border cells this feature enters/exits at.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "edge": {"type": "string", "enum": ["north", "south", "east", "west"]},
                                    "at": {"type": "integer"},
                                },
                                "required": ["edge", "at"],
                            },
                        },
                    },
                    "required": ["type", "points"],
                },
                "maxItems": 24,
            },
            "terrain_svg": {
                "type": "string",
                "description": (
                    "Optional, rarely needed. SVG of pure shapes over the terrain: "
                    'viewBox EXACTLY "0 0 <cols> <rows>" (cell units), max 20KB, no '
                    "script/foreignObject/href. Use only when grid + terrain_features "
                    "cannot express the shape."
                ),
            },
            "map_ground": {
                "type": "string",
                "description": (
                    "Tiles only, strongly recommended. Ground-plane SVG of the tile "
                    '(FLAT art only): viewBox EXACTLY "0 0 128 128", max 32KB, shape '
                    "elements only, with the layers <g id=\"ground\">, <g id=\"water\"> "
                    "and optional <g id=\"deck\"> (walkable over water). Anything with "
                    "height goes in `volumes` instead."
                ),
            },
            "volumes": {
                "type": "array",
                "description": (
                    "Tiles only, strongly recommended. Everything with HEIGHT as typed "
                    "objects (building/wall/tower/gate/tree/bush/rock/fountain/prop) "
                    "with footprint in cells + height; the engine projects them to the "
                    "session perspective and derives collision from the footprints. "
                    "See the MAP PLAN section of the system prompt."
                ),
                "items": {"type": "object"},
            },
            "structures": {
                "type": "array",
                "description": (
                    "Enterable rooms/buildings stamped deterministically by the engine: "
                    "closed wall perimeter + floor + door gaps. NEVER hand-draw W borders "
                    "when a structure can do it. rect = [col,row,w,h] outer rectangle "
                    "(walls included, min 3x3); doors carve walkable gaps."
                ),
                "maxItems": 16,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["room"]},
                        "rect": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "minItems": 4,
                            "maxItems": 4,
                            "description": "[col, row, width_cells, height_cells], walls included.",
                        },
                        "wall_char": {"type": "string", "description": "Terrain char for the walls (default W, always solid)."},
                        "floor_char": {"type": "string", "description": "Terrain char for the interior floor (default o)."},
                        "doors": {
                            "type": "array",
                            "description": "1+ door gaps or the room is sealed.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "side": {"type": "string", "enum": ["north", "south", "east", "west"]},
                                    "at": {
                                        "type": "integer",
                                        "description": "Cells from the rect's top/left corner along that side (1..side-2; corners cannot be doors).",
                                    },
                                    "width": {"type": "integer", "minimum": 1},
                                },
                                "required": ["side", "at"],
                            },
                        },
                    },
                    "required": ["type", "rect"],
                },
            },
            "vegetation_zones": {
                "type": "array",
                "description": (
                    "Deterministic tree scatter (seeded by scene_id) over walkable cells "
                    "of the area, skipping rooms, doors and occupied cells. Use instead of "
                    "hand-placing many trees; hand-placed trees remain fine for landmarks."
                ),
                "maxItems": 16,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "description": "Plant name in Spanish (pino, roble, matorral)."},
                        "area": {
                            "description": "[col, row, width_cells, height_cells], or \"rest\" (tiles only: everything still bare biome).",
                            "oneOf": [
                                {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4},
                                {"type": "string", "enum": ["rest"]},
                            ],
                        },
                        "density": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                            "maximum": 1,
                            "description": "Fraction of cells planted: 0.05 sparse, 0.25 thick.",
                        },
                        "glyph": {"type": "string", "description": "Single ASCII char (default T)."},
                    },
                    "required": ["type", "area", "density"],
                },
            },
            "entities": {
                "type": "array",
                "description": "Every thing on the map that is NOT terrain.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "Unique slug (lowercase + underscore).",
                        },
                        "kind": {
                            "type": "string",
                            "enum": ["building", "prop", "item", "tree", "npc", "player", "decor"],
                        },
                        "name": {"type": "string", "description": "Spanish display name."},
                        "cell": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "minItems": 2,
                            "maxItems": 2,
                            "description": "[col, row] of the top-left of the footprint.",
                        },
                        "footprint": {
                            "type": "array",
                            "items": {"type": "integer", "minimum": 1},
                            "minItems": 2,
                            "maxItems": 2,
                            "description": "[width_cells, height_cells]; usually [1,1] for props/NPCs.",
                        },
                        "glyph": {
                            "type": "string",
                            "description": "A single printable ASCII char, distinct from terrain chars.",
                        },
                        "shape": {
                            "type": "string",
                            "enum": ["box", "cylinder", "sphere", "cone"],
                            "description": (
                                "Optional footprint shape hint (default box). cylinder = round "
                                "(barrel/well/round tower/urn/fountain), sphere = boulder/dome, "
                                "cone = tent/spire/pile, box = buildings/walls/crates."
                            ),
                        },
                        "texture_hash": {
                            "type": "string",
                            "description": "Optional. Reuse a cached texture by 16-char hash from available_assets.",
                        },
                        "model_hash": {
                            "type": "string",
                            "description": "Optional. Reuse a cached 3D model by hash.",
                        },
                        "attach": {
                            "type": "string",
                            "enum": ["wall"],
                            "description": "decor only: snap to the nearest wall cell (torches, signs, banners).",
                        },
                    },
                    "required": ["id", "kind", "name", "cell", "footprint", "glyph"],
                },
                "maxItems": 80,
            },
            "ambient_event": {
                "type": "string",
                "description": "One Spanish sentence of atmospheric flavour (wind, birdsong, smell of stew, etc.).",
            },
        },
        "required": ["scene_id", "scene_description", "entities", "ambient_event"],
    },
}


RESERVED_TERRAIN = {
    "g": "grass", "w": "water", "_": "path", "s": "stone",
    "b": "bridge", "d": "dirt", "a": "sand", "o": "wood",
    "W": "muro",
}

VALID_ENTITY_KINDS = {"building", "prop", "item", "tree", "npc", "player", "decor"}

# Capas obligatorias del arte plano del suelo (map_ground). Espejo de
# GROUND_SVG_LAYERS en nefan-core/src/scene/map-svg.ts. La capa `deck`
# (transitable sobre agua) es opcional.
GROUND_SVG_LAYERS = ("ground", "water")

# Tipos de volumen del plan de tile. Espejo de VolumeSchema en
# nefan-core/src/scene/blueprint/volumes.ts (zod es la fuente de verdad; aquí
# validamos shape suficiente para no persistir basura — el bridge re-valida).
VOLUME_TYPES = {"building", "wall", "tower", "gate", "tree", "bush", "rock", "fountain", "prop"}
MAX_VOLUMES = 160


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _cell_pair(v) -> bool:
    return isinstance(v, list) and len(v) == 2 and all(_num(n) for n in v)


def validate_volumes(raw, *, field: str = "volumes"):
    """Valida el array `volumes` del plan de tile. Devuelve la lista limpia o
    None con traza del motivo (el caller degrada descartando el campo).
    Espejo laxo de parseVolumes (nefan-core/src/scene/blueprint/volumes.ts)."""
    if not isinstance(raw, list):
        print(f"validate_scene: {field} descartado (no es lista)")
        return None
    if len(raw) > MAX_VOLUMES:
        print(f"validate_scene: {field} descartado ({len(raw)} > {MAX_VOLUMES})")
        return None
    seen_ids = set()
    for i, v in enumerate(raw):
        ctx = f"{field}[{i}]"
        if not isinstance(v, dict):
            print(f"validate_scene: {ctx} no es objeto — {field} descartado")
            return None
        vid = v.get("id")
        label = v.get("label")
        vtype = v.get("type")
        if not isinstance(vid, str) or not vid or vid in seen_ids:
            print(f"validate_scene: {ctx} id inválido/duplicado — {field} descartado")
            return None
        seen_ids.add(vid)
        if not isinstance(label, str) or not label:
            print(f"validate_scene: {ctx} sin label — {field} descartado")
            return None
        if vtype not in VOLUME_TYPES:
            print(f"validate_scene: {ctx} type desconocido {vtype!r} — {field} descartado")
            return None
        if vtype == "building":
            r = v.get("rect")
            if not (isinstance(r, list) and len(r) == 4 and all(_num(n) for n in r)):
                print(f"validate_scene: {ctx} building sin rect válido — {field} descartado")
                return None
        elif vtype == "wall":
            pts = v.get("points")
            if not (isinstance(pts, list) and len(pts) >= 2 and all(_cell_pair(pp) for pp in pts)):
                print(f"validate_scene: {ctx} wall sin points válidos — {field} descartado")
                return None
        elif vtype == "gate":
            if not _cell_pair(v.get("at")) or v.get("orient") not in ("x", "y"):
                print(f"validate_scene: {ctx} gate sin at/orient válidos — {field} descartado")
                return None
        elif vtype == "prop":
            has_at = _cell_pair(v.get("at"))
            r = v.get("rect")
            has_rect = isinstance(r, list) and len(r) == 4 and all(_num(n) for n in r)
            if has_at == has_rect or v.get("shape") not in ("box", "cylinder"):
                print(f"validate_scene: {ctx} prop necesita shape y uno de at|rect — {field} descartado")
                return None
        else:  # tower/tree/bush/rock/fountain
            if not _cell_pair(v.get("at")):
                print(f"validate_scene: {ctx} {vtype} sin at válido — {field} descartado")
                return None
    return raw


def _sanitize_svg_field(
    svg,
    cols: int,
    rows: int,
    *,
    max_bytes: int,
    required_layers: tuple = (),
    field: str,
):
    """Valida un documento SVG de capa de escena (terrain_svg / map_ground).

    Devuelve el SVG limpio o None con traza del motivo. Solo formas puras:
    rechaza script/foreignObject/href, exige viewBox exacto "0 0 cols rows"
    y, si se piden, las capas <g id="..."> obligatorias.
    """
    if not isinstance(svg, str) or not svg.strip():
        return None
    svg = svg.strip()
    reason = None
    if len(svg.encode("utf-8")) > max_bytes:
        reason = f"supera {max_bytes // 1000}KB"
    elif not svg.startswith("<svg"):
        reason = "no empieza por <svg"
    else:
        low = svg.lower()
        if "<script" in low or "foreignobject" in low or "href=" in low:
            reason = "contiene script/foreignObject/href"
        else:
            import re as _re

            vb = _re.search(r'viewBox\s*=\s*"([\d.\s-]+)"', svg)
            parts = vb.group(1).split() if vb else []
            ok = (
                len(parts) == 4
                and float(parts[0]) == 0
                and float(parts[1]) == 0
                and abs(float(parts[2]) - cols) < 0.01
                and abs(float(parts[3]) - rows) < 0.01
            )
            if not ok:
                reason = f'viewBox debe ser "0 0 {cols} {rows}"'
            else:
                missing = [
                    layer
                    for layer in required_layers
                    if f'id="{layer}"' not in svg and f"id='{layer}'" not in svg
                ]
                if missing:
                    reason = f"faltan capas obligatorias: {', '.join(missing)}"
    if reason:
        print(f"validate_scene_response: {field} descartado ({reason})", flush=True)
        return None
    # Sin xmlns el navegador no rasteriza el SVG (Blob→Image). Los LLM lo
    # omiten a menudo: inyectarlo (espejo de sanitizeMapSvg en nefan-core).
    if "xmlns=" not in svg:
        svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    return svg


def validate_scene_response(data: dict) -> dict:
    """Validate and sanitize a Map Format D scene returned by the LLM.

    Tolerant pass: when the LLM gets a field slightly wrong (wrong row length,
    glyph collision, footprint out of bounds, missing glyph) we trim/fix it
    instead of rejecting the whole map. Truly broken responses degrade to a
    minimal grass-only fallback so the client never gets a 500.
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
    # style_tag: categoría de referencia de estilo para el repintado IA.
    # Valor fuera del enum se descarta con aviso (mejor sin tag que un 422 en
    # /generate_scene_image cuando el cliente lo reenvíe).
    _valid_style_tags = {"nature", "settlement", "fortress", "interior", "underground"}
    if data.get("style_tag") and data["style_tag"] not in _valid_style_tags:
        print(f"validate_scene: style_tag inválido '{data['style_tag']}' — descartado", flush=True)
        data.pop("style_tag", None)
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
            print("validate_scene_response: tile sin biome — se asume grass", flush=True)
            data["biome"] = "grass"
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

    # ── Size + terrain grid (solo escenas legacy; los tiles no llevan) ────
    if not is_tile:
        size = data.get("size") or {}
        cols = int(size.get("cols") or 24)
        rows = int(size.get("rows") or 16)
        mpc = float(size.get("meters_per_cell") or 2)
        cols = max(12, min(cols, 80))
        rows = max(8, min(rows, 60))
        data["size"] = {"cols": cols, "rows": rows, "meters_per_cell": mpc}

        raw_terrain = data.get("terrain")
        if not isinstance(raw_terrain, list) or not raw_terrain:
            # Old schema with `terrain: { type, texture_prompt }` — replace with empty grass.
            raw_terrain = []

        # Normalize each row to exactly `cols` chars: pad with "g" or truncate.
        normalized = []
        for r in range(rows):
            if r < len(raw_terrain) and isinstance(raw_terrain[r], str):
                row = raw_terrain[r]
            else:
                row = ""
            if len(row) > cols:
                row = row[:cols]
            elif len(row) < cols:
                row = row + ("g" * (cols - len(row)))
            normalized.append(row)
        data["terrain"] = normalized
    else:
        normalized = []

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
    # Ensure every char used in terrain has an entry (default = grass for unknown).
    # (solo legacy: los tiles no traen grid que escanear)
    if not is_tile:
        used_chars = set("".join(normalized))
        for ch in used_chars:
            if ch not in legend and ch not in RESERVED_TERRAIN:
                legend[ch] = "grass"
    # Merge reserved (the legend takes precedence if LLM redefined a char).
    for ch, name in RESERVED_TERRAIN.items():
        legend.setdefault(ch, name)
    data["terrain_legend"] = legend

    # ── Terrain features (vectoriales, opcionales) ───────────────────────
    # Tolerante como el resto de campos del LLM: una feature malformada se
    # descarta sin invalidar la escena. Puntos [col,row] numéricos (floats ok),
    # width > 0, color #rrggbb opcional.
    raw_features = data.get("terrain_features")
    clean_features: list = []
    if isinstance(raw_features, list):
        import re as _re

        for feat in raw_features[:24]:
            if not isinstance(feat, dict):
                continue
            ftype = feat.get("type")
            pts = feat.get("points")
            if not isinstance(ftype, str) or not ftype or not isinstance(pts, list) or len(pts) < 2:
                continue
            clean_pts = []
            for p in pts:
                if (
                    isinstance(p, list)
                    and len(p) >= 2
                    and all(isinstance(v, (int, float)) for v in p[:2])
                ):
                    clean_pts.append([float(p[0]), float(p[1])])
                else:
                    clean_pts = []
                    break
            if len(clean_pts) < 2:
                continue
            clean_feat: dict = {"type": ftype, "points": clean_pts}
            width = feat.get("width")
            if isinstance(width, (int, float)) and width > 0:
                clean_feat["width"] = float(width)
            if feat.get("closed") is True and len(clean_pts) >= 3:
                clean_feat["closed"] = True
            color = feat.get("color")
            if isinstance(color, str) and _re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                clean_feat["color"] = color
            # Costuras de tiles: celdas de borde exactas por las que la
            # feature entra/sale (las consume el expander de nefan-core).
            at_edges = feat.get("at_edges")
            if isinstance(at_edges, list):
                clean_edges = [
                    {"edge": ae["edge"], "at": ae["at"]}
                    for ae in at_edges
                    if isinstance(ae, dict)
                    and ae.get("edge") in ("north", "south", "east", "west")
                    and isinstance(ae.get("at"), int)
                ]
                if clean_edges:
                    clean_feat["at_edges"] = clean_edges
            clean_features.append(clean_feat)
    data["terrain_features"] = clean_features

    # ── Terrain SVG (capa opcional avanzada) ─────────────────────────────
    # Solo formas puras: se descarta (con traza) si excede 20 KB, si el viewBox
    # no casa con el size, o si contiene script/foreignObject/href.
    svg = _sanitize_svg_field(data.get("terrain_svg"), cols, rows, max_bytes=20_000, field="terrain_svg")
    if svg:
        data["terrain_svg"] = svg
    else:
        data.pop("terrain_svg", None)

    # ── Map plan (map_ground + volumes) ──────────────────────────────────
    # Espejo de sanitizeGroundSvg/parseVolumes en nefan-core: mismo criterio
    # en ambos lados o un plan aceptado aquí lo rechazaría el bridge al
    # persistir el retoque. map_ground exige las capas g#ground/#water.
    if "map_svg" in data:
        # Formato legacy anterior al compositor: ya no se acepta.
        print("validate_scene: map_svg legacy descartado (usa map_ground + volumes)")
        data.pop("map_svg", None)
    svg = _sanitize_svg_field(
        data.get("map_ground"),
        cols,
        rows,
        max_bytes=32_000,
        required_layers=GROUND_SVG_LAYERS,
        field="map_ground",
    )
    if svg:
        data["map_ground"] = svg
    else:
        data.pop("map_ground", None)
    if "volumes" in data:
        vols = validate_volumes(data.get("volumes"))
        if vols is not None:
            data["volumes"] = vols
        else:
            data.pop("volumes", None)

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

        kind = ent.get("kind") or "prop"
        if kind not in VALID_ENTITY_KINDS:
            kind = "prop"

        cell = ent.get("cell") or [0, 0]
        if not (isinstance(cell, list) and len(cell) == 2):
            cell = [0, 0]
        col = max(0, min(int(cell[0]), cols - 1))
        row = max(0, min(int(cell[1]), rows - 1))

        fp = ent.get("footprint") or [1, 1]
        if not (isinstance(fp, list) and len(fp) == 2):
            fp = [1, 1]
        w = max(1, min(int(fp[0]), cols - col))
        h = max(1, min(int(fp[1]), rows - row))

        glyph = ent.get("glyph")
        if not (isinstance(glyph, str) and len(glyph) == 1) or glyph in terrain_chars:
            # Pick a fallback glyph that's not used as terrain.
            fallback_pool = "?xyzqXYZQ#&%$*+!"
            glyph = next(
                (c for c in fallback_pool if c not in terrain_chars),
                "?",
            )

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


WEAPON_ORIENT_TOOL = {
    "name": "orient_weapon",
    "description": "Return the grip point and orientation vectors for a 3D weapon mesh.",
    "input_schema": {
        "type": "object",
        "required": [
            "grip_point_normalized",
            "blade_direction",
            "up_direction",
            "weapon_type",
            "confidence",
        ],
        "properties": {
            "grip_point_normalized": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 3,
                "maxItems": 3,
                "description": "Grip point in normalized bbox space [0..1]^3",
            },
            "blade_direction": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 3,
                "maxItems": 3,
                "description": "Unit vector: from grip toward tip/edge/front",
            },
            "up_direction": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 3,
                "maxItems": 3,
                "description": "Unit vector: perpendicular to blade_direction, 'up' face",
            },
            "weapon_type": {
                "type": "string",
                "enum": [
                    "sword", "shield", "axe", "mace", "staff",
                    "bow", "dagger", "spear", "generic",
                ],
            },
            "grip_length_normalized": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Fraction of the weapon length occupied by the grip",
            },
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
            },
            "notes": {
                "type": "string",
                "description": "Short rationale for debugging",
            },
        },
    },
}


def validate_weapon_orient_response(data: dict) -> dict | None:
    """Validate and normalize a weapon orientation response from the LLM.

    Returns None if the response is malformed beyond repair.
    """
    if not isinstance(data, dict):
        return None

    # Required vector fields
    for field in ("grip_point_normalized", "blade_direction", "up_direction"):
        v = data.get(field)
        if not isinstance(v, list) or len(v) != 3:
            return None
        try:
            data[field] = [float(x) for x in v]
        except (TypeError, ValueError):
            return None

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
    if blade is None or up is None:
        return None
    data["blade_direction"] = blade
    data["up_direction"] = up

    # Reject if blade and up are nearly parallel (degenerate frame)
    dot = abs(blade[0] * up[0] + blade[1] * up[1] + blade[2] * up[2])
    if dot > 0.95:
        return None

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
# Scene segment classification — el mundo derivado de la imagen: la visión
# clasifica cada región segmentada como sólida (colisión) y/o alta (occluder).
# ============================================================================

SCENE_CLASSIFY_SYSTEM_PROMPT = _prompt("scene_classify.md")


CLASSIFY_SCENE_TOOL = {
    "name": "classify_scene",
    "description": "Classify every numbered segmented region of the scene image.",
    "input_schema": {
        "type": "object",
        "required": ["segments"],
        "properties": {
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["index", "label", "solid", "tall"],
                    "properties": {
                        "index": {"type": "integer", "minimum": 0},
                        "label": {"type": "string"},
                        "solid": {"type": "boolean"},
                        "tall": {"type": "boolean"},
                    },
                },
            },
        },
    },
}


def validate_scene_classify_response(
    data: dict, expected_indices: list[int] | None = None
) -> dict | None:
    """Valida una clasificación de regiones. Devuelve el dict normalizado
    ({"segments": [...]}) o None si la forma es irrecuperable o falta algún
    índice esperado (la colisión derivada exige clasificación COMPLETA)."""
    if not isinstance(data, dict):
        return None
    segments = data.get("segments")
    if not isinstance(segments, list):
        return None
    seen: set[int] = set()
    normalized = []
    for seg in segments:
        if not isinstance(seg, dict):
            return None
        index = seg.get("index")
        label = seg.get("label")
        solid = seg.get("solid")
        tall = seg.get("tall")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            return None
        if index in seen:
            return None
        if not isinstance(label, str) or not label:
            return None
        if not isinstance(solid, bool) or not isinstance(tall, bool):
            return None
        seen.add(index)
        normalized.append({"index": index, "label": label, "solid": solid, "tall": tall})
    if expected_indices is not None:
        missing = [i for i in expected_indices if i not in seen]
        if missing:
            print(f"scene_classify: faltan índices {missing} en la respuesta", flush=True)
            return None
    return {"segments": normalized}


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

NARRATIVE_REACT_TOOL = {
    "name": "react_to_player",
    "description": "Decide if the player's dialogue choice/free-text reshapes the open world. Return zero or more consequences.",
    "input_schema": {
        "type": "object",
        "required": ["consequences"],
        "properties": {
            "consequences": {
                "type": "array",
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "required": ["type"],
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["dialogue", "story_update", "spawn_entity", "schedule_event", "plugin_event", "noop"],
                        },
                        # dialogue — an NPC reacts in-world with spoken lines.
                        # REQUIRED for free_text responses.
                        "speaker": {
                            "type": "string",
                            "description": "Display name of the NPC who speaks. Prefer an NPC already in `entities`.",
                        },
                        "text": {
                            "type": "string",
                            "description": "What the NPC says. Write in the same language as the player's free_text.",
                        },
                        "choices": {
                            "type": "array",
                            "items": {"type": "string"},
                            "maxItems": 3,
                            "description": "Optional 2-3 follow-up options for the player.",
                        },
                        # story_update
                        "delta": {
                            "type": "string",
                            "description": "Incremental update to story_so_far (1-3 sentences).",
                        },
                        # spawn_entity
                        "entity_kind": {
                            "type": "string",
                            "enum": ["npc", "building", "object"],
                        },
                        "description": {
                            "type": "string",
                            "description": "Vivid English description of the entity (used for asset generation). NPCs/enemies must be HUMANOID — never animals or non-humanoid monsters.",
                        },
                        "name": {
                            "type": "string",
                            "description": "Display name for an NPC entity.",
                        },
                        "role": {
                            "type": "string",
                            "description": (
                                "NPC ambient-behaviour role: peasant | guard | villager | "
                                "merchant. The game engine executes it (wander, face the "
                                "player, flee from fights; guards intervene). Unknown "
                                "roles degrade to villager."
                            ),
                        },
                        "position_hint": {
                            "type": "string",
                            "description": "Plausible placement: near_player, distant_east, distant_north, etc.",
                        },
                        "texture_hash": {
                            "type": "string",
                            "description": "Reuse a cached texture by hash from available_assets.",
                        },
                        "model_hash": {
                            "type": "string",
                            "description": "Reuse a cached GLB by hash from available_assets.",
                        },
                        # schedule_event
                        "trigger": {
                            "type": "string",
                            "description": "When the scheduled event fires: next_scene, timer:60s, on_player_action:..",
                        },
                        # plugin_event — dirige un evento a un plugin declarativo
                        # activo. El motor del juego ejecuta sus reglas; usar esto
                        # en vez de narrar a mano lo que un plugin ya modela
                        # (comercio, reputación, ...).
                        "plugin_id": {
                            "type": "string",
                            "description": "Id (sha256) of the active plugin that consumes the event.",
                        },
                        "event_type": {
                            "type": "string",
                            "description": "Event type from the plugin's events_consumed (e.g. trade_offered).",
                        },
                        "payload": {
                            "type": "object",
                            "description": "Event payload matching what the plugin's rules read (event.*).",
                        },
                    },
                },
            },
        },
    },
}


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
                trimmed = [str(x).strip() for x in raw_choices if str(x).strip()]
                if trimmed:
                    if len(trimmed) > 3:
                        raise ValueError(f"dialogue[{idx}].choices has {len(trimmed)} entries, max is 3")
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


def validate_blueprint_review(data: dict | None) -> dict:
    """Validate a Claude response to a blueprint_review request.

    Strict mode (mirror of narrative-mcp/server.ts:validateBlueprintReview —
    keep both in sync): the shape is { approved: bool, issues: [str],
    fixes?: { terrain?, terrain_features?, entity_moves? } }. Any deviation
    raises ValueError; the endpoint surfaces it as HTTP 422.

    `fixes` son overrides PARCIALES pero de campo completo: si viene terrain,
    son TODAS las filas; terrain_features reemplaza la lista entera. Las
    terrain_features pasan por la misma limpieza tolerante que en
    validate_scene_response (reutilizada aquí en miniatura).
    """
    if not isinstance(data, dict):
        raise ValueError(f"blueprint_review payload must be an object, got {type(data).__name__}")
    approved = data.get("approved")
    if not isinstance(approved, bool):
        raise ValueError("blueprint_review payload missing boolean `approved`")

    raw_issues = data.get("issues", [])
    if not isinstance(raw_issues, list) or any(not isinstance(i, str) for i in raw_issues):
        raise ValueError("blueprint_review `issues` must be a list of strings")
    issues = [i.strip() for i in raw_issues if i.strip()]
    if approved is False and not issues:
        raise ValueError("blueprint_review approved=false requires a non-empty `issues` list")

    out: dict = {"approved": approved, "issues": issues}

    raw_fixes = data.get("fixes")
    if raw_fixes is not None:
        if not isinstance(raw_fixes, dict):
            raise ValueError("blueprint_review `fixes` must be an object")
        allowed = {"terrain", "terrain_features", "entity_moves", "map_ground", "volumes"}
        unknown = set(raw_fixes.keys()) - allowed
        if unknown:
            raise ValueError(
                f"blueprint_review fixes has invalid keys {sorted(unknown)}; allowed: {sorted(allowed)}"
            )
        fixes: dict = {}

        terrain = raw_fixes.get("terrain")
        if terrain is not None:
            if not isinstance(terrain, list) or any(not isinstance(r, str) for r in terrain):
                raise ValueError("blueprint_review fixes.terrain must be the FULL list of row strings")
            fixes["terrain"] = terrain

        feats = raw_fixes.get("terrain_features")
        if feats is not None:
            if not isinstance(feats, list):
                raise ValueError("blueprint_review fixes.terrain_features must be a list")
            clean: list = []
            for feat in feats[:24]:
                if not isinstance(feat, dict):
                    continue
                ftype = feat.get("type")
                pts = feat.get("points")
                if not isinstance(ftype, str) or not ftype or not isinstance(pts, list) or len(pts) < 2:
                    continue
                if any(
                    not (isinstance(p, list) and len(p) >= 2 and all(isinstance(v, (int, float)) for v in p[:2]))
                    for p in pts
                ):
                    continue
                cf: dict = {"type": ftype, "points": [[float(p[0]), float(p[1])] for p in pts]}
                width = feat.get("width")
                if isinstance(width, (int, float)) and width > 0:
                    cf["width"] = float(width)
                if feat.get("closed") is True and len(pts) >= 3:
                    cf["closed"] = True
                if isinstance(feat.get("color"), str):
                    cf["color"] = feat["color"]
                clean.append(cf)
            fixes["terrain_features"] = clean

        moves = raw_fixes.get("entity_moves")
        if moves is not None:
            if not isinstance(moves, list):
                raise ValueError("blueprint_review fixes.entity_moves must be a list")
            clean_moves: list = []
            for idx, m in enumerate(moves):
                if (
                    not isinstance(m, dict)
                    or not isinstance(m.get("id"), str)
                    or not isinstance(m.get("cell"), list)
                    or len(m["cell"]) != 2
                    or any(not isinstance(v, (int, float)) for v in m["cell"])
                ):
                    raise ValueError(
                        f"blueprint_review fixes.entity_moves[{idx}] must be {{ id: str, cell: [col,row] }}"
                    )
                clean_moves.append({"id": m["id"], "cell": [m["cell"][0], m["cell"][1]]})
            fixes["entity_moves"] = clean_moves

        raw_svg = raw_fixes.get("map_ground")
        if raw_svg is not None:
            # Fail-loud (no descartar en silencio): un SVG corregido inválido
            # debe volver como 422 para que el modelo lo re-emita bien. Solo
            # aplica a tiles, cuyo viewBox es siempre 0 0 128 128.
            svg = _sanitize_svg_field(
                raw_svg, 128, 128,
                max_bytes=32_000, required_layers=GROUND_SVG_LAYERS, field="fixes.map_ground",
            )
            if svg is None:
                raise ValueError(
                    "blueprint_review fixes.map_ground is not a valid map_ground document "
                    '(viewBox "0 0 128 128", layers ground/water, ≤32KB, shapes only)'
                )
            fixes["map_ground"] = svg

        raw_vols = raw_fixes.get("volumes")
        if raw_vols is not None:
            vols = validate_volumes(raw_vols, field="fixes.volumes")
            if vols is None:
                raise ValueError(
                    "blueprint_review fixes.volumes is not a valid volumes array "
                    "(typed objects with unique id, Spanish label and per-type footprint)"
                )
            fixes["volumes"] = vols

        if fixes:
            out["fixes"] = fixes

    return out
