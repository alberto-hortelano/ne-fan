"""Los campos RETIRADOS del contrato de escena y con qué se rebotan.

Espejo de `nefan-core/src/contract/model-io/retired-terrain-fields.ts`, y por
la misma razón vive en su propio fichero: para nombrar un campo retirado hay
que escribirlo, y `campos-retirados-no-vuelven` (arch-rules.json) los caza en
todo `ai_server/**/*.py`. El checker exime por FICHERO entero, así que aquí no
hay nada más que la tabla: la ceguera que compra la exención se limita a estas
líneas.

Un campo retirado no se rebota con el genérico («no existe en el contrato»):
los dos sitios por los que vuelve son un motor que copia un ejemplo viejo y un
save o snapshot anterior a la retirada, y a los dos hay que decirles con qué
se sustituye. Los motivos son los MISMOS que los del zod, palabra por palabra:
el mismo tile no puede recibir dos textos según por dónde entre.
"""

_SUFIJO = "Si viene de un save o snapshot, bórralo o regenéralo"
_MOTIVO_DEL_TERRENO = (
    "el terreno se declara con `biome` + `ground`/`volumes` y la solidez la fija el engine "
    "(agua y muro bloquean)"
)


def _retirado(campo: str, motivo: str) -> str:
    return f"`{campo}` está retirado: {motivo}. {_SUFIJO}"


# Claves de la RAÍZ de la escena. `stage`, `style_ref` y `__expanded` llevan un
# motivo con otra forma (nombran la variante viva, el catálogo que ya no existe
# o la marca interna), como en `motivoDeClaveRetirada` del zod.
MOTIVO_DE_CLAVE_RETIRADA = {
    "stage": (
        "`stage` era el plató proscenio y se retiró con la vista que lo pintaba: una escena necesita "
        "`tile` {tx,ty}, la única variante de Format D (mundo continuo, pídela con generate_tile)"
    ),
    "style_ref": (
        "`style_ref` de escena está retirado (no existe catálogo world.style_refs.scene): "
        "quítalo. Para guiar el arte usa `surface_ref` por cara de volumen y `style_ref` en los NPCs"
    ),
    "__expanded": (
        "`__expanded` es la marca interna del expander: una escena emitida no la lleva — "
        "quítala y declara `biome` + primitivas; el engine expande y marca él"
    ),
    "terrain_legend": _retirado("terrain_legend", _MOTIVO_DEL_TERRENO),
    "terrain_patches": _retirado("terrain_patches", _MOTIVO_DEL_TERRENO),
    "ambient_event": _retirado(
        "ambient_event",
        "la frase de ambiente no la leía nadie; lo que quieras contar del lugar va en `scene_description`",
    ),
    "place_anchors": _retirado(
        "place_anchors",
        "la escena no ancla lugares: el motor los ancla con `map_upsert_place.anchor {tx, ty, rect}`, que ya existe",
    ),
}

# Claves de una ENTITY.
MOTIVO_DE_CLAVE_DE_ENTITY_RETIRADA = {
    "glyph": _retirado(
        "glyph", "el char ASCII de una entity no lo lee nadie; la entity se identifica por `id` y se rotula por `name`"
    ),
    "attach": _retirado(
        "attach", "el decor ya no se pega a un muro (los muros son `volumes`): declara la `cell` exacta donde va"
    ),
}
