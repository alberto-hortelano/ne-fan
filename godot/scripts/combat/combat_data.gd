## Loads and merges combat configuration data from JSON.
class_name CombatData
extends RefCounted


static func load_config(path: String = "res://data/combat_config.json") -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		push_error("CombatData: cannot open %s" % path)
		return {}
	var data = JSON.parse_string(file.get_as_text())
	file.close()
	if data == null or not data is Dictionary:
		push_error("CombatData: invalid JSON in %s" % path)
		return {}
	return data


static func get_effective_params(attack_type_id: String, attack_types: Dictionary, weapon_data: Dictionary) -> Dictionary:
	var base: Dictionary = attack_types.get(attack_type_id, {})
	if base.is_empty():
		push_error("CombatData: unknown attack type '%s'" % attack_type_id)
		return {}

	var mods: Dictionary = weapon_data.get("modifiers", {}).get(attack_type_id, {})
	var wup_global: float = weapon_data.get("wind_up_modifier", 1.0)

	return {
		"optimal_distance": base.get("optimal_distance", 1.5) + mods.get("optimal_distance_offset", 0.0),
		"distance_tolerance": base.get("distance_tolerance", 1.0),
		"area_radius": base.get("area_radius", 1.0) * mods.get("area_radius_multiplier", 1.0),
		"base_damage": base.get("base_damage", 10.0) * mods.get("damage_multiplier", 1.0),
		"damage_reduction": base.get("damage_reduction", 0.0),
		"wind_up_time": get_effective_wind_up(base, weapon_data, attack_type_id),
	}


static func get_effective_wind_up(attack_type_data: Dictionary, weapon_data: Dictionary, attack_type_id: String = "") -> float:
	var base_wup: float = attack_type_data.get("wind_up_time", 0.3)
	var global_mod: float = weapon_data.get("wind_up_modifier", 1.0)
	var type_mod: float = 1.0
	if attack_type_id != "":
		var mods: Dictionary = weapon_data.get("modifiers", {}).get(attack_type_id, {})
		type_mod = mods.get("wind_up_multiplier", 1.0)
	return base_wup * global_mod * type_mod
