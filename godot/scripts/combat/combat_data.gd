## Loads combat configuration data from JSON.
##
## La matemática de parámetros efectivos (daño, área, wind-up por arma) vive
## en nefan-core (src/combat/combat-data.ts); `dump-config` la precalcula en
## data/combat_effective_params.json y aquí SÓLO se lee la tabla — Godot no
## duplica cálculos de combate ("lógica en nefan-core, Godot solo visual").
class_name CombatData
extends RefCounted

const EFFECTIVE_PARAMS_PATH := "res://data/combat_effective_params.json"

static var _effective_params: Dictionary = {}
# Cache por path: varios scripts llaman load_config() en _ready y el JSON no
# cambia en runtime — no re-parsear el mismo archivo una vez por consumidor.
static var _config_cache: Dictionary = {}


static func load_config(path: String = "res://data/combat_config.json") -> Dictionary:
	if _config_cache.has(path):
		return _config_cache[path]
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		push_error("CombatData: cannot open %s" % path)
		return {}
	var data = JSON.parse_string(file.get_as_text())
	file.close()
	if data == null or not data is Dictionary:
		push_error("CombatData: invalid JSON in %s" % path)
		return {}
	_config_cache[path] = data
	return data


static func get_effective_params(attack_type_id: String, weapon_id: String) -> Dictionary:
	"""Parámetros efectivos (weapon × attack type) precalculados por nefan-core.
	Regenerar con `cd nefan-core && npm run dump-config` si cambia combat_config."""
	if _effective_params.is_empty():
		_effective_params = load_config(EFFECTIVE_PARAMS_PATH)
		if _effective_params.is_empty():
			push_error("CombatData: combat_effective_params.json missing — run `npm run dump-config` in nefan-core")
			return {}
	var weapon_table: Dictionary = _effective_params.get(weapon_id, _effective_params.get("unarmed", {}))
	var params: Dictionary = weapon_table.get(attack_type_id, {})
	if params.is_empty():
		push_error("CombatData: no effective params for weapon='%s' attack='%s'" % [weapon_id, attack_type_id])
	return params
